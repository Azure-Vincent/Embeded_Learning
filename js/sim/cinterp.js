// Bench-MCU C interpreter. Implements docs/BENCH_MCU.md: a C subset running on a simulated 32-bit
// little-endian machine with byte-addressed flash/SRAM, memory-mapped peripherals and a real stack.
// Pure JS, no DOM. Pipeline: lexer -> preprocessor -> single-pass parser that type-checks and emits
// JS closures -> execution against Uint8Array memory. Nothing here models a real chip.

export const FLASH_BASE = 0x08000000, SRAM_BASE = 0x20000000, MEM_SIZE = 0x10000, PERIPH_BASE = 0x40000000;
export const STACK_TOP = SRAM_BASE + MEM_SIZE;
export const REGISTERS = {
  GPIO_DIR: 0x40000000, GPIO_OUT: 0x40000004, GPIO_IN: 0x40000008, GPIO_SET: 0x4000000C, GPIO_CLR: 0x40000010,
  GPIO_TOGGLE: 0x40000014, GPIO_PULLUP: 0x40000018,
  UART_DATA: 0x40001000, UART_STATUS: 0x40001004, UART_CTRL: 0x40001008, UART_BAUD: 0x4000100C,
  TIM_CTRL: 0x40002000, TIM_LOAD: 0x40002004, TIM_COUNT: 0x40002008, TIM_STATUS: 0x4000200C,
  ADC_CTRL: 0x40003000, ADC_STATUS: 0x40003004, ADC_DATA: 0x40003008,
};
const REG_NAME = new Map(Object.entries(REGISTERS).map(([k, v]) => [v, k]));
export const UART_TX_BUSY_TICKS = 4, UART_RX_INTERVAL = 16, UART_RX_FIFO = 16, ADC_CONVERSION_TICKS = 3;
const START_RET = FLASH_BASE + 4, IRQ_RET = FLASH_BASE + 8, CODE_BASE = FLASH_BASE + 0x100, LIB_BASE = FLASH_BASE + 0xF000;

class CError extends Error { constructor(line, msg) { super(msg); this.line = line; } }
class Halt { constructor(kind, msg, code) { this.kind = kind; this.msg = msg; this.code = code; } }

const hex8 = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

// ---------------------------------------------------------------- types
const mkInt = (name, size, signed, rank) => ({ k: 'int', name, size, signed, rank });
const T = {
  void: { k: 'void', name: 'void', size: 0 },
  bool: { k: 'int', name: '_Bool', size: 1, signed: false, rank: 0, bool: true },
  char: mkInt('char', 1, true, 1), schar: mkInt('signed char', 1, true, 1), uchar: mkInt('unsigned char', 1, false, 1),
  short: mkInt('short', 2, true, 2), ushort: mkInt('unsigned short', 2, false, 2),
  int: mkInt('int', 4, true, 3), uint: mkInt('unsigned int', 4, false, 3),
  long: mkInt('long', 4, true, 4), ulong: mkInt('unsigned long', 4, false, 4),
  llong: mkInt('long long', 8, true, 5), ullong: mkInt('unsigned long long', 8, false, 5),
};
const ptrTo = (to) => ({ k: 'ptr', to, size: 4 });
const arrOf = (of, n) => ({ k: 'arr', of, n });
const isInt = (t) => t.k === 'int';
const isPtr = (t) => t.k === 'ptr';
const isScalar = (t) => t.k === 'int' || t.k === 'ptr';
const is64 = (t) => t.k === 'int' && t.size === 8;
const constOf = (t) => (t.const ? t : { ...t, const: true });
const isConstType = (t) => !!t.const || (t.k === 'arr' && isConstType(t.of));

/** Lay out fields on the Bench-MCU ABI. fields: [{size, align}] -> { offsets, size, align } */
export function layoutStruct(fields, { union = false, packed = false } = {}) {
  let off = 0, align = 1, size = 0;
  const offsets = [];
  for (const f of fields) {
    const a = packed ? 1 : Math.max(1, f.align);
    if (a > align) align = a;
    if (union) { offsets.push(0); if (f.size > size) size = f.size; continue; }
    off = Math.ceil(off / a) * a;
    offsets.push(off);
    off += f.size;
  }
  if (!union) size = off;
  size = Math.ceil(size / align) * align;
  return { offsets, size, align };
}
function sizeOf(t, line) {
  switch (t.k) {
    case 'arr': if (t.n == null) return 0; return t.n * sizeOf(t.of, line);
    case 'struct': if (!t.def.complete) throw new CError(line || 0, `'${typeStr(t)}' is used before its fields are defined (incomplete type)`); return t.def.size;
    case 'func': return 1;
    case 'void': return 1;
    default: return t.size;
  }
}
function alignOf(t) {
  switch (t.k) {
    case 'arr': return alignOf(t.of);
    case 'struct': return t.def.align || 1;
    case 'func': case 'void': return 1;
    default: return t.size;
  }
}
function sameType(a, b) {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  switch (a.k) {
    case 'int': return a.size === b.size && a.signed === b.signed && !!a.bool === !!b.bool;
    case 'ptr': return sameType(a.to, b.to);
    case 'arr': return (a.n == null || b.n == null || a.n === b.n) && sameType(a.of, b.of);
    case 'struct': return a.def === b.def;
    case 'func': return sameType(a.ret, b.ret) && a.params.length === b.params.length && a.params.every((p, i) => sameType(p.ty, b.params[i].ty));
    default: return true;
  }
}
function baseName(t) {
  if (t.k === 'struct') return (t.const ? 'const ' : '') + (t.def.alias || `${t.def.union ? 'union' : 'struct'} ${t.def.name || '<anonymous>'}`);
  return (t.const ? 'const ' : '') + t.name;
}
/** C declaration text for a type: typeStr(ptr(char),'p') -> "char *p" */
export function typeStr(t, name = '') {
  switch (t.k) {
    case 'arr': return typeStr(t.of, `${name}[${t.n == null ? '' : t.n}]`);
    case 'ptr': { const q = t.const ? ' const' : ''; return t.to.k === 'func' || t.to.k === 'arr' ? typeStr(t.to, `(*${q}${name})`) : typeStr(t.to, `*${q}${q && name ? ' ' : ''}${name}`); }
    case 'func': return typeStr(t.ret, `${name}(${t.params.length ? t.params.map((p) => typeStr(p.ty)).join(', ') + (t.varargs ? ', ...' : '') : 'void'})`);
    default: return baseName(t) + (name ? (name[0] === '*' || name[0] === '(' ? ' ' : ' ') + name : '');
  }
}

// ---------------------------------------------------------------- byte/string helpers
function toBytes(s) {
  if (s == null) return [];
  if (typeof s !== 'string') return Array.from(s, (v) => v & 0xFF);
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x100) out.push(c);
    else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
// Source text -> bytes: non-ASCII characters in string literals become UTF-8.
function srcBytes(s) { const out = []; for (const ch of s) out.push(...utf8(ch.codePointAt(0))); return out; }
function utf8(c) {
  if (c < 0x80) return [c];
  if (c < 0x800) return [0xC0 | (c >> 6), 0x80 | (c & 63)];
  if (c < 0x10000) return [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  return [0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
}
// Bytes -> display string: valid UTF-8 sequences are decoded, any other byte maps to the same code point.
function bytesToStr(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c < 0x80) { s += String.fromCharCode(c); continue; }
    const n = c >= 0xF0 && c < 0xF8 ? 3 : c >= 0xE0 ? 2 : c >= 0xC2 && c < 0xE0 ? 1 : 0;
    let ok = n > 0 && i + n < b.length;
    for (let j = 1; ok && j <= n; j++) if ((b[i + j] & 0xC0) !== 0x80) ok = false;
    if (!ok) { s += String.fromCharCode(c); continue; }
    let cp = n === 1 ? c & 0x1F : n === 2 ? c & 0x0F : c & 0x07;
    for (let j = 1; j <= n; j++) cp = (cp << 6) | (b[i + j] & 63);
    s += String.fromCodePoint(cp); i += n;
  }
  return s;
}

// ---------------------------------------------------------------- lexer
const PUNCT = ['...', '<<=', '>>=', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '##',
  '+', '-', '*', '/', '%', '&', '|', '^', '~', '!', '<', '>', '=', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '#'];
const ESC = { n: 10, t: 9, r: 13, 0: 0, a: 7, b: 8, f: 12, v: 11, e: 27, '\\': 92, "'": 39, '"': 34, '?': 63 };
function lex(src, fixedLine) {
  const toks = [], n = src.length;
  let i = 0, line = 1, ll = 0, ws = true;
  const L = () => (fixedLine != null ? fixedLine : line);
  function quoted(q) { // returns bytes of a string/char literal body; i is just after the opening quote
    const out = [];
    for (;;) {
      if (i >= n || src[i] === '\n') throw new CError(L(), q === '"' ? 'unterminated string literal (missing closing ")' : "unterminated character literal (missing closing ')");
      let c = src[i++];
      if (c === q) return out;
      if (c !== '\\') { const cp = src.codePointAt(i - 1); if (cp > 0xFFFF) i++; out.push(...utf8(cp)); continue; }
      c = src[i++];
      if (c === 'x') { let h = ''; while (/[0-9a-fA-F]/.test(src[i] || '')) h += src[i++]; if (!h) throw new CError(L(), '\\x needs hex digits'); out.push(parseInt(h, 16) & 0xFF); }
      else if (c >= '0' && c <= '7') { let o = c; while (o.length < 3 && src[i] >= '0' && src[i] <= '7') o += src[i++]; out.push(parseInt(o, 8) & 0xFF); }
      else if (c in ESC) out.push(ESC[c]);
      else throw new CError(L(), `unknown escape sequence \\${c}`);
    }
  }
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; ll++; i++; ws = true; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { line++; i += src[i + 1] === '\r' ? 3 : 2; ws = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; ws = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const s = L(); i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      if (i >= n) throw new CError(s, 'unterminated /* comment');
      i += 2; ws = true; continue;
    }
    const start = i, tok = { t: 'p', v: c, line: L(), ll, ws };
    ws = false;
    if (/[A-Za-z_]/.test(c)) {
      while (i < n && /\w/.test(src[i])) i++;
      tok.t = 'id'; tok.v = src.slice(start, i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      while (i < n && (/[\w.]/.test(src[i]) || ((src[i] === '+' || src[i] === '-') && /[eE]/.test(src[i - 1]) && !/^0[xX]/.test(src.slice(start, i))))) i++;
      const text = src.slice(start, i);
      Object.assign(tok, number(text, tok.line));
    } else if (c === '"') { i++; tok.t = 'str'; tok.v = quoted('"'); }
    else if (c === "'") {
      i++; const b = quoted("'");
      if (b.length !== 1) throw new CError(tok.line, b.length ? "a character literal holds one character; use double quotes for a string" : 'empty character literal');
      tok.t = 'num'; tok.ty = T.int; tok.v = b[0] > 127 ? b[0] - 256 : b[0];
    } else {
      const pch = PUNCT.find((q) => src.startsWith(q, i));
      if (!pch) throw new CError(tok.line, `unexpected character '${c}'`);
      tok.v = pch; i += pch.length;
    }
    tok.raw = src.slice(start, i);
    toks.push(tok);
  }
  return toks;
}
function number(text, line) {
  const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)$/.exec(text);
  if (!m) {
    if (/^[0-9.]/.test(text) && /[.eEfF]/.test(text) && !/^0[xX]/.test(text)) throw new CError(line, `floating point is not supported on Bench-MCU ('${text}'); use integers (for example fixed-point millivolts)`);
    throw new CError(line, `'${text}' is not a valid number`);
  }
  const d = m[1], suf = m[2].toLowerCase();
  const dec = !/^0[xXbB]/.test(d) && !(d.length > 1 && d[0] === '0');
  let v;
  if (/^0[bB]/.test(d)) v = BigInt('0b' + d.slice(2));
  else if (d.length > 1 && d[0] === '0' && !/^0[xX]/.test(d)) { if (/[89]/.test(d)) throw new CError(line, `'${text}' starts with 0 so it is octal, and 8/9 are not octal digits`); v = BigInt('0o' + d.slice(1)); }
  else v = BigInt(d);
  const u = suf.includes('u'), ls = suf.replace('u', '');
  if (!/^(|l|ll)$/.test(ls) || suf.split('u').length > 2) throw new CError(line, `bad integer suffix in '${text}'`);
  const cands = [];
  if (ls === '') { if (!u) cands.push(T.int); if (u || !dec) cands.push(T.uint); }
  if (ls !== 'll') { if (!u) cands.push(T.long); if (u || !dec) cands.push(T.ulong); }
  if (!u) cands.push(T.llong);
  cands.push(T.ullong);
  let ty = cands.find((t) => v <= (t.signed ? (1n << BigInt(t.size * 8 - 1)) - 1n : (1n << BigInt(t.size * 8)) - 1n));
  if (!ty) throw new CError(line, `integer constant '${text}' is too large for any type`);
  if (ls === '' && (ty.rank === 4)) ty = ty.signed ? T.int : T.uint; // unsuffixed constants never need 'long' on ILP32
  return { t: 'num', ty, v: ty.size === 8 ? v : Number(v) };
}

// ---------------------------------------------------------------- preprocessor
function preprocess(source, macros) {
  let R = { src: source, pos: 0, pb: [], noDir: false };
  const cond = [];
  const active = () => cond.length === 0 || cond[cond.length - 1].active;
  function ppEval(toks, line) {
    let i = 0;
    const PREC = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
    function prim() {
      const t = toks[i++];
      if (!t) throw new CError(line, '#if needs an expression');
      if (t.t === 'num') return Number(t.v);
      if (t.t === 'id') return 0;
      if (t.v === '(') { const v = tern(); if (!toks[i] || toks[i].v !== ')') throw new CError(line, "missing ')' in #if"); i++; return v; }
      if (t.v === '!') return prim() ? 0 : 1;
      if (t.v === '-') return -prim();
      if (t.v === '+') return prim();
      if (t.v === '~') return ~prim();
      throw new CError(line, `unexpected '${t.raw}' in #if`);
    }
    function bin(min) {
      let a = prim();
      for (;;) {
        const t = toks[i], pr = t && t.t === 'p' ? PREC[t.v] : 0;
        if (!pr || pr < min) return a;
        i++;
        const b = bin(pr + 1);
        switch (t.v) {
          case '||': a = a || b ? 1 : 0; break; case '&&': a = a && b ? 1 : 0; break;
          case '|': a |= b; break; case '^': a ^= b; break; case '&': a &= b; break;
          case '==': a = a === b ? 1 : 0; break; case '!=': a = a !== b ? 1 : 0; break;
          case '<': a = a < b ? 1 : 0; break; case '>': a = a > b ? 1 : 0; break; case '<=': a = a <= b ? 1 : 0; break; case '>=': a = a >= b ? 1 : 0; break;
          case '<<': a <<= b; break; case '>>': a >>= b; break; case '+': a += b; break; case '-': a -= b; break; case '*': a *= b; break;
          case '/': case '%': if (!b) throw new CError(line, 'division by zero in #if'); a = t.v === '/' ? Math.trunc(a / b) : a % b; break;
        }
      }
    }
    function tern() { const c = bin(1); if (toks[i] && toks[i].v === '?') { i++; const a = tern(); if (!toks[i] || toks[i].v !== ':') throw new CError(line, "missing ':' in #if"); i++; const b = tern(); return c ? a : b; } return c; }
    const v = tern();
    if (i < toks.length) throw new CError(line, `unexpected '${toks[i].raw}' in #if`);
    return v;
  }
  function evalIf(toks, line) {
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'id' && t.v === 'defined') {
        let j = i + 1; const par = toks[j] && toks[j].v === '(';
        if (par) j++;
        if (!toks[j] || toks[j].t !== 'id') throw new CError(line, "'defined' needs a macro name");
        out.push({ t: 'num', v: macros.has(toks[j].v) ? 1 : 0, ty: T.int, line, ll: t.ll, raw: '0' });
        i = par ? j + 1 : j;
      } else out.push(t);
    }
    return ppEval(expandList(out), line) !== 0;
  }
  function directive() {
    const hash = R.src[R.pos], ll = hash.ll, line = hash.line, toks = [];
    R.pos++;
    while (R.pos < R.src.length && R.src[R.pos].ll === ll) toks.push(R.src[R.pos++]);
    if (!toks.length) return;
    const name = toks[0].v, rest = toks.slice(1);
    switch (name) {
      case 'if': case 'ifdef': case 'ifndef': {
        if (!active()) { cond.push({ active: false, taken: true, parent: false, line }); return; }
        let v;
        if (name === 'if') v = evalIf(rest, line);
        else { if (!rest[0] || rest[0].t !== 'id') throw new CError(line, `#${name} needs a macro name`); v = macros.has(rest[0].v) === (name === 'ifdef'); }
        cond.push({ active: v, taken: v, parent: true, line }); return;
      }
      case 'elif': case 'else': case 'endif': {
        const top = cond[cond.length - 1];
        if (!top) throw new CError(line, `#${name} without a matching #if`);
        if (name === 'endif') { cond.pop(); return; }
        if (!top.parent) return;
        if (top.taken) top.active = false;
        else { const v = name === 'else' ? true : evalIf(rest, line); top.active = v; top.taken = v; }
        return;
      }
    }
    if (!active()) return;
    switch (name) {
      case 'define': {
        const nm = rest[0];
        if (!nm || nm.t !== 'id') throw new CError(line, '#define needs a name');
        let params = null, variadic = false, k = 1;
        if (rest[1] && rest[1].v === '(' && !rest[1].ws) {
          params = []; k = 2;
          if (rest[k] && rest[k].v === ')') k++;
          else for (;;) {
            const t = rest[k++];
            if (t && t.v === '...') { variadic = true; params.push('__VA_ARGS__'); }
            else if (t && t.t === 'id') params.push(t.v);
            else throw new CError(line, `bad parameter list in #define ${nm.v}`);
            const sep = rest[k++];
            if (sep && sep.v === ')') break;
            if (!sep || sep.v !== ',') throw new CError(line, `bad parameter list in #define ${nm.v} (missing ')')`);
          }
        }
        macros.set(nm.v, { name: nm.v, params, variadic, body: rest.slice(k) });
        return;
      }
      case 'undef': if (rest[0]) macros.delete(rest[0].v); return;
      case 'include': case 'pragma': case 'line': return;
      case 'error': throw new CError(line, '#error ' + rest.map((t) => t.raw).join(' '));
      default: throw new CError(line, `unknown preprocessor directive #${name}`);
    }
  }
  function rawNext() {
    if (R.pb.length) return R.pb.pop();
    for (;;) {
      if (R.pos >= R.src.length) return null;
      const t = R.src[R.pos];
      if (!R.noDir && t.t === 'p' && t.v === '#' && (R.pos === 0 || R.src[R.pos - 1].ll !== t.ll)) { directive(); continue; }
      R.pos++;
      if (!R.noDir && !active()) continue;
      return t;
    }
  }
  function expandList(list) {
    const save = R, out = [];
    R = { src: list, pos: 0, pb: [], noDir: true };
    let t;
    while ((t = next())) out.push(t);
    R = save;
    return out;
  }
  function collectArgs(call, m) {
    const args = [[]];
    let depth = 0;
    for (;;) {
      const t = rawNext();
      if (!t) throw new CError(call.line, `unterminated call to macro ${m.name} (missing ')')`);
      if (t.t === 'p' && t.v === '(') depth++;
      else if (t.t === 'p' && t.v === ')') { if (depth === 0) break; depth--; }
      else if (t.t === 'p' && t.v === ',' && depth === 0 && !(m.variadic && args.length === m.params.length)) { args.push([]); continue; }
      args[args.length - 1].push(t);
    }
    if (m.params.length === 0 && args.length === 1 && args[0].length === 0) args.length = 0;
    if (m.variadic && args.length === m.params.length - 1) args.push([]);
    if (args.length !== m.params.length) throw new CError(call.line, `macro ${m.name} takes ${m.params.length} argument${m.params.length === 1 ? '' : 's'}, but ${args.length} given`);
    return args;
  }
  function substitute(m, args, call) {
    const out = [], body = m.body;
    const mark = (t) => { const hs = new Set(t.hs || []); if (call.hs) for (const h of call.hs) hs.add(h); hs.add(m.name); return { ...t, line: call.line, ll: call.ll, hs }; };
    const pidx = (t) => (args && t.t === 'id' ? m.params.indexOf(t.v) : -1);
    for (let i = 0; i < body.length; i++) {
      const t = body[i];
      if (args && t.t === 'p' && t.v === '#' && body[i + 1] && pidx(body[i + 1]) >= 0) {
        const a = args[pidx(body[++i])];
        const text = a.map((x, j) => (j && x.ws ? ' ' : '') + x.raw).join('');
        out.push(mark({ t: 'str', v: srcBytes(text), raw: JSON.stringify(text), ws: t.ws }));
        continue;
      }
      const pasteNext = body[i + 1] && body[i + 1].t === 'p' && body[i + 1].v === '##';
      const pastePrev = i > 0 && body[i - 1].t === 'p' && body[i - 1].v === '##';
      if (t.t === 'p' && t.v === '##') {
        const rhsTok = body[++i];
        if (!rhsTok || !out.length) throw new CError(call.line, `'##' cannot be at the edge of macro ${m.name}`);
        const ri = pidx(rhsTok), rhs = ri >= 0 ? args[ri] : [rhsTok];
        const lhs = out.pop();
        const glued = lex((lhs.raw || '') + (rhs[0] ? rhs[0].raw : ''), call.line);
        for (const g of glued) out.push(mark({ ...g, ll: call.ll }));
        for (const r of rhs.slice(1)) out.push(mark(r));
        continue;
      }
      const pi = pidx(t);
      if (pi >= 0) { for (const a of (pasteNext || pastePrev ? args[pi] : expandList(args[pi]))) out.push(mark(a)); if (pasteNext && !args[pi].length) out.push(mark({ t: 'p', v: '', raw: '' })); }
      else out.push(mark(t));
    }
    return out.filter((t) => t.raw !== '' || t.t !== 'p');
  }
  function next() {
    for (;;) {
      const t = rawNext();
      if (!t) return null;
      if (t.t !== 'id') return t;
      if (t.v === '__LINE__') return { t: 'num', ty: T.int, v: t.line, line: t.line, ll: t.ll, raw: String(t.line) };
      const m = macros.get(t.v);
      if (!m || (t.hs && t.hs.has(t.v))) return t;
      let args = null;
      if (m.params) {
        const p = rawNext();
        if (!p || !(p.t === 'p' && p.v === '(')) { if (p) R.pb.push(p); return t; }
        args = collectArgs(t, m);
      }
      const exp = substitute(m, args, t);
      for (let i = exp.length - 1; i >= 0; i--) R.pb.push(exp[i]);
    }
  }
  const out = [];
  let t;
  while ((t = next())) out.push(t);
  if (cond.length) throw new CError(cond[cond.length - 1].line, '#if without a matching #endif');
  return out;
}

const PRELUDE = `
typedef signed char int8_t; typedef unsigned char uint8_t; typedef short int16_t; typedef unsigned short uint16_t;
typedef int int32_t; typedef unsigned int uint32_t; typedef long long int64_t; typedef unsigned long long uint64_t;
typedef unsigned int size_t; typedef int ssize_t; typedef int ptrdiff_t; typedef unsigned int uintptr_t; typedef int intptr_t;
typedef long long intmax_t; typedef unsigned long long uintmax_t; typedef _Bool bool;
#define true 1
#define false 0
#define NULL ((void *)0)
#define EOF (-1)
#define stdin 0
#define CHAR_BIT 8
#define INT8_MIN (-128)
#define INT8_MAX 127
#define UINT8_MAX 255
#define INT16_MIN (-32768)
#define INT16_MAX 32767
#define UINT16_MAX 65535
#define INT32_MIN (-2147483647 - 1)
#define INT32_MAX 2147483647
#define UINT32_MAX 4294967295u
#define INT64_MAX 9223372036854775807ll
#define INT64_MIN (-9223372036854775807ll - 1)
#define UINT64_MAX 18446744073709551615ull
#define INT_MIN (-2147483647 - 1)
#define INT_MAX 2147483647
#define UINT_MAX 4294967295u
#define LONG_MAX 2147483647l
#define LONG_MIN (-2147483647l - 1)
#define ULONG_MAX 4294967295ul
#define SCHAR_MIN (-128)
#define SCHAR_MAX 127
#define CHAR_MIN (-128)
#define CHAR_MAX 127
#define UCHAR_MAX 255
#define SHRT_MIN (-32768)
#define SHRT_MAX 32767
#define USHRT_MAX 65535
#define SIZE_MAX 4294967295u
#define RAND_MAX 32767
#define REG32(addr) (*(volatile uint32_t *)(addr))
#define GPIO_BASE 0x40000000u
#define UART_BASE 0x40001000u
#define UART0_BASE 0x40001000u
#define TIMER_BASE 0x40002000u
#define TIMER0_BASE 0x40002000u
#define TIM_BASE 0x40002000u
#define ADC_BASE 0x40003000u
#define GPIO_DIR REG32(GPIO_BASE + 0x00)
#define GPIO_OUT REG32(GPIO_BASE + 0x04)
#define GPIO_IN REG32(GPIO_BASE + 0x08)
#define GPIO_SET REG32(GPIO_BASE + 0x0C)
#define GPIO_CLR REG32(GPIO_BASE + 0x10)
#define GPIO_TOGGLE REG32(GPIO_BASE + 0x14)
#define GPIO_PULLUP REG32(GPIO_BASE + 0x18)
#define UART_DATA REG32(UART_BASE + 0x00)
#define UART_STATUS REG32(UART_BASE + 0x04)
#define UART_CTRL REG32(UART_BASE + 0x08)
#define UART_BAUD REG32(UART_BASE + 0x0C)
#define UART_TX_READY (1u << 0)
#define UART_RX_AVAIL (1u << 1)
#define UART_RX_OVERRUN (1u << 2)
#define UART_ENABLE (1u << 0)
#define UART_RX_IRQ_EN (1u << 1)
#define UART_CTRL_ENABLE (1u << 0)
#define UART_CTRL_RX_IRQ_EN (1u << 1)
#define TIM_CTRL REG32(TIMER_BASE + 0x00)
#define TIM_LOAD REG32(TIMER_BASE + 0x04)
#define TIM_COUNT REG32(TIMER_BASE + 0x08)
#define TIM_STATUS REG32(TIMER_BASE + 0x0C)
#define TIM_ENABLE (1u << 0)
#define TIM_AUTO_RELOAD (1u << 1)
#define TIM_IRQ_EN (1u << 2)
#define TIM_EXPIRED (1u << 0)
#define TIM_CTRL_ENABLE (1u << 0)
#define TIM_CTRL_AUTO_RELOAD (1u << 1)
#define TIM_CTRL_IRQ_EN (1u << 2)
#define TIM_STATUS_EXPIRED (1u << 0)
#define ADC_CTRL REG32(ADC_BASE + 0x00)
#define ADC_STATUS REG32(ADC_BASE + 0x04)
#define ADC_DATA REG32(ADC_BASE + 0x08)
#define ADC_START (1u << 0)
#define ADC_DONE (1u << 0)
#define ADC_CTRL_START (1u << 0)
#define ADC_STATUS_DONE (1u << 0)
#define IRQ_UART_RX 0
#define IRQ_TIMER 1
#define assert(e) ((e) ? (void)0 : __assert_fail(#e))
int printf(const char *fmt, ...); int sprintf(char *dst, const char *fmt, ...); int snprintf(char *dst, size_t n, const char *fmt, ...);
int putchar(int c); int puts(const char *s); int getchar(void); char *gets(char *s); char *fgets(char *s, int n, int stream);
void *memcpy(void *dst, const void *src, size_t n); void *memmove(void *dst, const void *src, size_t n);
void *memset(void *dst, int c, size_t n); int memcmp(const void *a, const void *b, size_t n); void *memchr(const void *s, int c, size_t n);
size_t strlen(const char *s); char *strcpy(char *dst, const char *src); char *strncpy(char *dst, const char *src, size_t n);
int strcmp(const char *a, const char *b); int strncmp(const char *a, const char *b, size_t n);
char *strcat(char *dst, const char *src); char *strncat(char *dst, const char *src, size_t n); char *strchr(const char *s, int c); char *strrchr(const char *s, int c); char *strstr(const char *h, const char *n);
void *malloc(size_t n); void *calloc(size_t n, size_t size); void free(void *p);
int abs(int v); long labs(long v); int atoi(const char *s); int rand(void); void srand(unsigned int seed); void exit(int code); void abort(void);
int isdigit(int c); int isalpha(int c); int isalnum(int c); int isspace(int c); int isupper(int c); int islower(int c); int isxdigit(int c); int isprint(int c); int toupper(int c); int tolower(int c);
void irq_attach(int irq, void (*fn)(void)); void irq_enable(void); void irq_disable(void);
void __assert_fail(const char *expr);
`;
let preludeToks = null;

// ---------------------------------------------------------------- compiler + machine
function compile(source, opts = {}) {
  const warnings = [], warnSeen = new Set();
  function warn(line, msg, kind) {
    const k = line + '|' + (kind || msg);
    if (warnSeen.has(k) || warnings.length >= 100) return;
    warnSeen.add(k); warnings.push({ line, msg });
  }

  // ------------------------------------------------ machine state
  const flash = new Uint8Array(MEM_SIZE).fill(0xFF), sram = new Uint8Array(MEM_SIZE);
  let fp = STACK_TOP, sp = STACK_TOP, steps = 0, curLine = 0, retVal, loading = false;
  let heapBase = SRAM_BASE, heapTop = SRAM_BASE, heapLim = SRAM_BASE, irqOn = true, inIsr = false;
  let maxSteps = 2000000, stopAt = -1, breakLine = -1;
  const frames = [], blocks = [], fnByAddr = new Map(), handlers = [null, null], irqCounts = [0, 0];
  const out = [], uartTx = [], gpioTrace = [];
  let stdin = [], stdinPos = 0;
  const P = { dir: 0, out: 0, pull: 0, uctrl: 0, ubaud: 0, txBusy: 0, overrun: 0, tctrl: 0, tload: 0, tcount: 0, tstatus: 0, actrl: 0, adone: 0, adata: 0, abusy: 0 };
  let rxSched = [], rxNext = 0, gpioSched = [{ t: 0, value: 0, mask: 0 }], gpioIdx = 0, adcList = [], adcByCh = null, adcPos = 0, adcLast = 0;
  const rxFifo = [];
  const stats = { txDropped: 0, txLost: 0, rxOverrun: 0, hijacks: [] };

  const fault = (msg) => { throw new Halt('fault', msg); };
  function busFault(a, n, write) {
    a >>>= 0;
    let why;
    if (a < 0x1000) why = a === 0 ? 'is this pointer NULL?' : `that is NULL plus ${a} — a member or element accessed through a NULL pointer?`;
    else if (a >= FLASH_BASE && a < FLASH_BASE + MEM_SIZE && write) why = 'flash is read-only at run time (string literals and const data live there)';
    else if (a >= STACK_TOP && a < STACK_TOP + 0x1000) why = 'that is just past the top of SRAM (0x2000FFFF): a write ran off the end of the stack';
    else if (a >= PERIPH_BASE && a < PERIPH_BASE + 0x10000) why = 'there is no peripheral register at that address (see the Bench-MCU register map)';
    else why = 'nothing is mapped there (flash 0x08000000-0x0800FFFF, SRAM 0x20000000-0x2000FFFF, peripherals from 0x40000000)';
    fault(`bus fault ${write ? 'writing' : 'reading'} ${n} byte${n === 1 ? '' : 's'} at ${hex8(a)} — ${why}`);
  }
  function findBlock(a) { // heap block whose header or payload contains a
    let lo = 0, hi = blocks.length - 1, r = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (blocks[mid].addr - 8 <= a) { r = blocks[mid]; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  function heapCheck(a, n, write) {
    const b = findBlock(a);
    if (!b) return;
    if (a >= b.addr && a + n <= b.addr + b.size) {
      if (b.free) warn(curLine, `use after free: ${write ? 'writing' : 'reading'} ${n} byte${n === 1 ? '' : 's'} at ${hex8(a)}, inside a block that was freed on line ${b.freeLine}. The memory still holds stale data, and malloc may hand it to someone else`, 'uaf');
    } else warn(curLine, `heap overflow: ${write ? 'writing' : 'reading'} at ${hex8(a)}, outside the ${b.size}-byte block that malloc returned at ${hex8(b.addr)} (allocated on line ${b.line})`, 'heapovf');
  }
  function rd(a, n) {
    const o = a - SRAM_BASE;
    if (o >= 0 && o + n <= MEM_SIZE) {
      if (a < heapLim && a >= heapBase) heapCheck(a, n, false);
      return n === 1 ? sram[o] : n === 2 ? sram[o] | (sram[o + 1] << 8) : (sram[o] | (sram[o + 1] << 8) | (sram[o + 2] << 16) | (sram[o + 3] << 24)) >>> 0;
    }
    const f = a - FLASH_BASE;
    if (f >= 0 && f + n <= MEM_SIZE) return n === 1 ? flash[f] : n === 2 ? flash[f] | (flash[f + 1] << 8) : (flash[f] | (flash[f + 1] << 8) | (flash[f + 2] << 16) | (flash[f + 3] << 24)) >>> 0;
    if (a >= PERIPH_BASE && a < PERIPH_BASE + 0x4000 && ((a & 3) + n) <= 4) {
      const v = regRead(a & ~3, a, n);
      return n === 4 ? v : (v >>> ((a & 3) * 8)) & (n === 1 ? 0xFF : 0xFFFF);
    }
    return busFault(a, n, false);
  }
  function wr(a, n, v) {
    const o = a - SRAM_BASE;
    if (o >= 0 && o + n <= MEM_SIZE) {
      if (a < heapLim && a >= heapBase) heapCheck(a, n, true);
      sram[o] = v;
      if (n > 1) { sram[o + 1] = v >>> 8; if (n > 2) { sram[o + 2] = v >>> 16; sram[o + 3] = v >>> 24; } }
      return;
    }
    const f = a - FLASH_BASE;
    if (f >= 0 && f + n <= MEM_SIZE && loading) { for (let i = 0; i < n; i++) flash[f + i] = v >>> (8 * i); return; }
    if (a >= PERIPH_BASE && a < PERIPH_BASE + 0x4000 && ((a & 3) + n) <= 4) {
      if (n === 4) return regWrite(a, v >>> 0, a, n);
      const sh = (a & 3) * 8, mask = (n === 1 ? 0xFF : 0xFFFF) << sh;
      return regWrite(a & ~3, ((regPeek(a & ~3) & ~mask) | ((v << sh) & mask)) >>> 0, a, n);
    }
    busFault(a, n, true);
  }
  function peek8(a) { // no side effects, null when unmapped
    a >>>= 0;
    if (a >= SRAM_BASE && a < STACK_TOP) return sram[a - SRAM_BASE];
    if (a >= FLASH_BASE && a < FLASH_BASE + MEM_SIZE) return flash[a - FLASH_BASE];
    if (REG_NAME.has((a & ~3) >>> 0)) return (regPeek((a & ~3) >>> 0) >>> ((a & 3) * 8)) & 0xFF;
    return null;
  }
  function readMem(addr, size = 4) {
    let v = 0n;
    for (let i = size - 1; i >= 0; i--) { const b = peek8(addr + i); if (b == null) return null; v = (v << 8n) | BigInt(b); }
    return size > 6 ? v : Number(v);
  }
  function cstr(a, what) {
    const b = [];
    if (a === 0) fault(`${what || 'a string function'} was given a NULL pointer`);
    for (;;) { const c = rd(a++, 1); if (c === 0) return b; b.push(c); if (b.length > 65536) fault('string has no terminating \\0 within 64 KiB'); a >>>= 0; }
  }

  // ------------------------------------------------ peripherals
  function gpioNow() { while (gpioIdx + 1 < gpioSched.length && gpioSched[gpioIdx + 1].t <= steps) gpioIdx++; return gpioSched[gpioIdx]; }
  function gpioIn() { const g = gpioNow(); return ((P.out & P.dir) | (~P.dir & ((g.value & g.mask) | (P.pull & ~g.mask)))) & 0xFFFF; }
  function setOut(v) { v &= 0xFFFF; if (v !== P.out) { P.out = v; if (gpioTrace.length < 10000) gpioTrace.push({ tick: steps, value: v }); } }
  function regPeek(a) {
    switch (a) {
      case 0x40000000: return P.dir; case 0x40000004: return P.out; case 0x40000008: return gpioIn(); case 0x40000018: return P.pull;
      case 0x40001004: return (P.txBusy ? 0 : 1) | (rxFifo.length ? 2 : 0) | (P.overrun ? 4 : 0);
      case 0x40001008: return P.uctrl; case 0x4000100C: return P.ubaud;
      case 0x40002000: return P.tctrl; case 0x40002004: return P.tload; case 0x40002008: return P.tcount; case 0x4000200C: return P.tstatus;
      case 0x40003000: return (P.actrl & 0xF0) | (P.abusy ? 1 : 0); case 0x40003004: return P.adone; case 0x40003008: return P.adata;
      default: return 0;
    }
  }
  function regRead(a, orig, n) {
    switch (a) {
      case 0x4000000C: case 0x40000010: case 0x40000014: warn(curLine, `${REG_NAME.get(a)} is write-only; reading it returns 0. Read GPIO_OUT to see the latch`); return 0;
      case 0x40001000: { P.overrun = 0; return rxFifo.length ? rxFifo.shift() : 0; }
      case 0x40003008: if (P.abusy) warn(curLine, 'ADC_DATA was read while a conversion was still running, so it holds the previous result. Wait for ADC_STATUS bit 0 (DONE) first'); return P.adata;
      default: if (!REG_NAME.has(a)) busFault(orig, n, false); return regPeek(a);
    }
  }
  function regWrite(a, v, orig, n) {
    switch (a) {
      case 0x40000000: P.dir = v & 0xFFFF; return;
      case 0x40000004: setOut(v); return;
      case 0x4000000C: setOut(P.out | v); return;
      case 0x40000010: setOut(P.out & ~v); return;
      case 0x40000014: setOut(P.out ^ v); return;
      case 0x40000018: P.pull = v & 0xFFFF; return;
      case 0x40001000:
        if (!(P.uctrl & 1)) { stats.txDropped++; warn(curLine, 'UART_DATA was written while UART_CTRL bit 0 (ENABLE) is 0, so the byte was dropped. Enable the UART first', 'uart-off'); return; }
        if (P.txBusy) { stats.txLost++; warn(curLine, 'UART_DATA was written while TX_READY was 0, so the byte was lost. Wait for UART_STATUS bit 0 before each write', 'uart-busy'); return; }
        uartTx.push(v & 0xFF); P.txBusy = UART_TX_BUSY_TICKS; return;
      case 0x40001008: P.uctrl = v & 3; return;
      case 0x4000100C: P.ubaud = v; return;
      case 0x40002000: if ((v & 1) && !(P.tctrl & 1)) P.tcount = P.tload; P.tctrl = v & 7; return;
      case 0x40002004: P.tload = v; P.tcount = v; return;
      case 0x4000200C: P.tstatus &= ~(v & 1); return;
      case 0x40003000: P.actrl = v & 0xF0; if (v & 1) { P.abusy = ADC_CONVERSION_TICKS; P.adone = 0; } return;
      case 0x40000008: case 0x40001004: case 0x40002008: case 0x40003004: case 0x40003008:
        warn(curLine, `${REG_NAME.get(a)} is read-only; the write was ignored`); return;
      default: busFault(orig, n, true);
    }
  }
  function adcDone() {
    const ch = (P.actrl >> 4) & 15;
    let v;
    if (adcByCh) { const l = adcByCh[ch] || []; const st = adcByCh._pos || (adcByCh._pos = {}); const i = st[ch] || 0; v = l.length ? l[Math.min(i, l.length - 1)] : 0; st[ch] = i + 1; if (i >= l.length) warn(curLine, `the test bench has no more ADC samples for channel ${ch}; the last value repeats`, 'adc-empty'); }
    else { if (adcPos < adcList.length) adcLast = adcList[adcPos++]; else warn(curLine, 'the test bench has no more ADC samples; the last value repeats', 'adc-empty'); v = adcLast; }
    P.adata = v & 0xFFF; P.adone = 1;
  }
  function rxArrive() {
    while (rxNext < rxSched.length && rxSched[rxNext].t <= steps) {
      const b = rxSched[rxNext++].b;
      if (rxFifo.length >= UART_RX_FIFO) { P.overrun = 1; stats.rxOverrun++; warn(curLine, `UART receive overrun: a byte arrived while the ${UART_RX_FIFO}-byte receive FIFO was full and was lost. The program is not reading UART_DATA often enough`, 'rx-overrun'); }
      else rxFifo.push(b);
    }
  }
  function dispatchIrq() {
    const irq = rxFifo.length && (P.uctrl & 2) && handlers[0] ? 0 : (P.tstatus & 1) && (P.tctrl & 4) && handlers[1] ? 1 : -1;
    if (irq < 0) { warn(curLine, `${rxFifo.length && (P.uctrl & 2) ? 'IRQ_UART_RX' : 'IRQ_TIMER'} is pending and enabled, but no handler is attached (use irq_attach)`, 'no-handler'); return; }
    const saveLine = curLine, saveRet = retVal;
    inIsr = true; irqCounts[irq]++;
    callUser(handlers[irq], [], IRQ_RET);
    inIsr = false; curLine = saveLine; retVal = saveRet;
  }
  function tick(line) {
    curLine = line;
    if (++steps > maxSteps) throw new Halt('limit');
    if ((P.tctrl & 1) && P.tcount > 0 && --P.tcount === 0) { P.tstatus |= 1; if (P.tctrl & 2) P.tcount = P.tload; }
    if (P.txBusy) P.txBusy--;
    if (rxNext < rxSched.length && rxSched[rxNext].t <= steps) rxArrive();
    if (P.abusy && --P.abusy === 0) adcDone();
    if (steps === stopAt) throw new Halt('ticks');
    if (irqOn && !inIsr && (((P.tstatus & 1) && (P.tctrl & 4)) || (rxFifo.length && (P.uctrl & 2)))) dispatchIrq();
    if (line === breakLine) { breakLine = -1; throw new Halt('break'); }
  }

  // ------------------------------------------------ calls
  function callUser(f, vals, ra) {
    if (!f.body) fault(`function '${f.name}' is declared but has no body`);
    const sp0 = sp, savedFp = fp;
    sp -= f.argSize;
    if (sp - 8 - f.frameSize < heapTop + 32) fault(`stack overflow: calling '${f.name}' would push the stack (which grows down from ${hex8(STACK_TOP)}) below ${hex8(heapTop + 32)}, into the heap and globals — runaway recursion, or a local array that is too large?`);
    const ps = f.params;
    for (let i = 0; i < ps.length && i < vals.length; i++) ps[i].st(sp + ps[i].slot, vals[i]);
    sp -= 4; wr(sp, 4, ra);
    sp -= 4; wr(sp, 4, fp);
    fp = sp; sp -= f.frameSize;
    frames.push({ fn: f, fp });
    retVal = undefined;
    let cur = f, hijacked = false;
    let code = f.body();
    if (code !== 3 && f.ty.ret.k !== 'void' && f.name !== 'main') { warn(f.endLine, `control reached the end of '${f.name}' without a return statement; the caller gets 0 here, and garbage on real hardware`); }
    const result = code === 3 ? retVal : (f.ty.ret.k === 'void' ? undefined : (is64(f.ty.ret) ? 0n : 0));
    for (;;) {
      sp = fp;
      const sfp = rd(sp, 4); sp += 4;
      const r = rd(sp, 4); sp += 4;
      frames.pop();
      if (r === ra) { if (sfp !== savedFp && !hijacked) warn(cur.endLine, `the saved frame pointer in the stack frame of '${cur.name}' was overwritten (now ${hex8(sfp)}): something wrote past the end of a local array`); break; }
      const g = fnByAddr.get(r);
      curLine = cur.endLine;
      if (!g || !g.body) {
        if (hijacked) fault(`'${cur.name}' returned to ${hex8(r)}, which is not the start of a function. After a hijacked return the stack no longer holds a valid return address, so the program crashes here`);
        fault(`'${cur.name}' tried to return to ${hex8(r)}, which is not code. The return address saved in its stack frame was overwritten — look for a write past the end of a local array in '${cur.name}'`);
      }
      warn(cur.endLine, `the return address of '${cur.name}' was overwritten with ${hex8(r)}, the address of '${g.name}': execution continues there instead of returning to the caller`, 'hijack' + r);
      stats.hijacks.push({ from: cur.name, to: g.name });
      hijacked = true;
      if (sp - 4 - g.frameSize < heapTop + 32) fault('stack overflow');
      sp -= 4; wr(sp, 4, sfp);
      fp = sp; sp -= g.frameSize;
      frames.push({ fn: g, fp, hijacked: true });
      cur = g;
      g.body();
    }
    fp = savedFp; sp = sp0;
    return result;
  }
  function fnAt(a) {
    const f = fnByAddr.get(a);
    if (!f) fault(a === 0 ? 'call through a NULL function pointer' : `call through a function pointer that holds ${hex8(a)}, which is not the address of a function`);
    return f;
  }

  // ------------------------------------------------ typed load/store
  const asI = BigInt.asIntN, asU = BigInt.asUintN;
  function loader(t, line) {
    if (t.k === 'struct') { const n = sizeOf(t, line); return (a) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rd(a + i, 1); return b; }; }
    if (t.k === 'void') throw new CError(line, 'a void value cannot be read (cast the void* to a real pointer type first)');
    if (t.k === 'ptr') return (a) => rd(a, 4);
    switch (t.size) {
      case 1: return t.signed ? (a) => (rd(a, 1) << 24) >> 24 : (a) => rd(a, 1);
      case 2: return t.signed ? (a) => (rd(a, 2) << 16) >> 16 : (a) => rd(a, 2);
      case 4: return t.signed ? (a) => rd(a, 4) | 0 : (a) => rd(a, 4);
      default: return t.signed ? (a) => asI(64, BigInt(rd(a, 4)) | (BigInt(rd(a + 4, 4)) << 32n)) : (a) => BigInt(rd(a, 4)) | (BigInt(rd(a + 4, 4)) << 32n);
    }
  }
  function storer(t, line) {
    if (t.k === 'struct') { const n = sizeOf(t, line); return (a, v) => { for (let i = 0; i < n; i++) wr(a + i, 1, v[i]); }; }
    if (t.k === 'ptr') return (a, v) => wr(a, 4, v);
    if (t.k !== 'int') throw new CError(line, `cannot store a value of type '${typeStr(t)}'`);
    switch (t.size) {
      case 1: return (a, v) => wr(a, 1, v & 0xFF);
      case 2: return (a, v) => wr(a, 2, v & 0xFFFF);
      case 4: return (a, v) => wr(a, 4, v >>> 0);
      default: return (a, v) => { const u = asU(64, v); wr(a, 4, Number(u & 0xFFFFFFFFn)); wr(a + 4, 4, Number(u >> 32n)); };
    }
  }
  function fromBuf(t, line) { // read a member out of a struct rvalue (Uint8Array)
    const n = sizeOf(t, line);
    if (t.k === 'struct') return (b, o) => b.slice(o, o + n);
    if (t.k === 'arr') throw new CError(line, 'cannot use an array inside a struct returned by value; store the struct in a variable first');
    const cvt = cv(n === 8 ? T.ullong : T.uint, t);
    return (b, o) => { let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[o + i]); const x = n === 8 ? v : Number(v); return cvt ? cvt(x) : x; };
  }
  // value conversion from type `from` to type `to`; null means "no change needed"
  function cv(from, to) {
    if (to.k === 'void' || to.k === 'struct' || from.k === 'struct') return null;
    const f8 = is64(from), fs = from.k === 'int' && from.signed, fsz = from.k === 'ptr' ? 4 : from.size;
    if (to.bool) return f8 ? (v) => (v !== 0n ? 1 : 0) : from.bool ? null : (v) => (v !== 0 ? 1 : 0);
    if (to.k === 'ptr') { if (f8) return (v) => Number(asU(32, v)); return fs ? (v) => v >>> 0 : null; }
    if (to.size === 8) {
      if (f8) return fs === to.signed ? null : to.signed ? (v) => asI(64, v) : (v) => asU(64, v);
      return to.signed || !fs ? (v) => BigInt(v) : (v) => asU(64, BigInt(v));
    }
    const wrap = to.size === 1 ? (to.signed ? (v) => (v << 24) >> 24 : (v) => v & 0xFF) : to.size === 2 ? (to.signed ? (v) => (v << 16) >> 16 : (v) => v & 0xFFFF) : to.signed ? (v) => v | 0 : (v) => v >>> 0;
    if (f8) return (v) => wrap(Number(asU(32, v)));
    if ((fsz < to.size && (!fs || to.signed)) || (fsz === to.size && fs === to.signed)) return null;
    return wrap;
  }

  // ------------------------------------------------ parser state
  if (!preludeToks) preludeToks = lex(PRELUDE, 0);
  const macros = new Map();
  let toks;
  {
    const userToks = lex(source);
    const base = preludeToks.length ? preludeToks[preludeToks.length - 1].ll + 1 : 0;
    for (const t of userToks) t.ll += base;
    toks = preprocess(preludeToks.concat(userToks), macros);
  }
  const lastLine = toks.length ? toks[toks.length - 1].line : 1;
  toks.push({ t: 'eof', v: '<end of file>', raw: 'end of file', line: lastLine });
  let p = 0;
  const scopes = [new Map()], tagScopes = [new Map()];
  const globals = [], functions = [], strings = new Map(), structDefs = [];
  let curFn = null, loopDepth = 0, switchDepth = 0, inConstInit = false;

  const err = (msg, line) => { throw new CError(line != null ? line : toks[p].line, msg); };
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const isP = (v, k = 0) => { const t = peek(k); return t.t === 'p' && t.v === v; };
  const isId = (v, k = 0) => { const t = peek(k); return t.t === 'id' && t.v === v; };
  const accept = (v) => (isP(v) ? (p++, true) : false);
  const show = (t) => (t.t === 'eof' ? 'the end of the file' : t.t === 'str' ? 'a string' : `'${t.raw != null ? t.raw : t.v}'`);
  function expect(v, ctx) {
    if (isP(v)) { p++; return; }
    const prev = toks[p - 1], here = toks[p];
    if (v === ';' && prev) err(`missing ';' after ${show(prev)}`, prev.line);
    err(`expected '${v}'${ctx ? ' ' + ctx : ''} but found ${show(here)}`, (v === ')' || v === ']' || v === '}') && prev && here.t === 'eof' ? prev.line : here.line);
  }
  function ident(what) { const t = peek(); if (t.t !== 'id' || KEYWORDS.has(t.v)) err(`expected ${what || 'a name'} but found ${show(t)}`); p++; return t.v; }
  function lookup(name) { for (let i = scopes.length - 1; i >= 0; i--) { const s = scopes[i].get(name); if (s) return s; } return null; }
  function lookupTag(name) { for (let i = tagScopes.length - 1; i >= 0; i--) { const s = tagScopes[i].get(name); if (s) return s; } return null; }
  const pushScope = () => { scopes.push(new Map()); tagScopes.push(new Map()); };
  const popScope = () => { scopes.pop(); tagScopes.pop(); };
  function define(name, sym, line) {
    const s = scopes[scopes.length - 1], old = s.get(name);
    if (old && !(old.prelude) && !(old.kind === 'typedef' && sym.kind === 'typedef')) err(`'${name}' is already declared in this scope${old.line ? ` (line ${old.line})` : ''}`, line);
    sym.line = line; if (line === 0) sym.prelude = true;
    s.set(name, sym);
    return sym;
  }
  const TYPE_KW = new Set(['void', 'char', 'short', 'int', 'long', 'signed', 'unsigned', '_Bool', 'struct', 'union', 'enum', 'const', 'volatile', 'static', 'extern', 'typedef', 'register', 'inline', 'float', 'double', '__attribute__', 'auto', 'restrict', '_Noreturn', '__signed__', '__inline', '__inline__', '__volatile__', '__restrict']);
  function isTypeStart(k = 0) {
    const t = peek(k);
    if (t.t !== 'id') return false;
    if (TYPE_KW.has(t.v)) return true;
    const s = lookup(t.v);
    return !!s && s.kind === 'typedef';
  }

  // ------------------------------------------------ declarations
  function parseAttrs(attrs) {
    while (isId('__attribute__')) {
      p++; expect('('); expect('(');
      while (!isP(')')) {
        const name = ident('an attribute name').replace(/^__|__$/g, '');
        let arg;
        if (accept('(')) { if (!isP(')')) { if (name === 'interrupt') arg = constExpr(); else { let d = 0; while (!(isP(')') && d === 0)) { if (peek().t === 'eof') err("missing ')' in __attribute__"); if (isP('(')) d++; if (isP(')')) d--; p++; } } } expect(')'); }
        if (name === 'interrupt') attrs.interrupt = arg != null ? arg : true;
        else if (name === 'packed') attrs.packed = true;
        if (!accept(',')) break;
      }
      expect(')'); expect(')');
    }
    return attrs;
  }
  function declSpec() {
    const start = p, line = peek().line, attrs = {};
    let storage = null, isConst = false, base = null, sign = null, size = null, kw = null;
    loop: for (;;) {
      const t = peek();
      if (t.t !== 'id') break;
      switch (t.v) {
        case 'typedef': case 'static': case 'extern': storage = t.v; p++; continue;
        case 'register': case 'auto': case 'inline': case '__inline': case '__inline__': case 'volatile': case '__volatile__': case 'restrict': case '__restrict': case '_Noreturn': p++; continue;
        case 'const': isConst = true; p++; continue;
        case '__attribute__': parseAttrs(attrs); continue;
        case 'signed': case '__signed__': sign = 's'; p++; continue;
        case 'unsigned': sign = 'u'; p++; continue;
        case 'short': size = 'short'; p++; continue;
        case 'long': size = size === 'long' ? 'llong' : 'long'; p++; continue;
        case 'char': case 'int': case 'void': case '_Bool': kw = t.v; p++; continue;
        case 'float': case 'double': err('floating point is not supported on Bench-MCU; use integer types (for example millivolts in an int)');
        case 'struct': case 'union': base = structSpec(); continue;
        case 'enum': base = enumSpec(); continue;
        default: {
          if (base || kw || sign || size) break loop;
          const s = lookup(t.v);
          if (s && s.kind === 'typedef') { base = s.ty; p++; continue; }
          break loop;
        }
      }
    }
    if (p === start) return null;
    if (!base) {
      if (kw === 'void') base = T.void;
      else if (kw === '_Bool') base = T.bool;
      else if (kw === 'char') base = sign === 'u' ? T.uchar : sign === 's' ? T.schar : T.char;
      else if (size === 'short') base = sign === 'u' ? T.ushort : T.short;
      else if (size === 'long') base = sign === 'u' ? T.ulong : T.long;
      else if (size === 'llong') base = sign === 'u' ? T.ullong : T.llong;
      else if (kw === 'int' || sign || size) base = sign === 'u' ? T.uint : T.int;
      else err(`expected a type but found ${show(peek())}`);
    }
    if (isConst) base = constOf(base);
    return { ty: base, storage, attrs, line };
  }
  function structSpec() {
    const kwTok = toks[p++], union = kwTok.v === 'union', attrs = parseAttrs({});
    let tag = null;
    if (peek().t === 'id' && !isP('{') && !KEYWORDS.has(peek().v)) tag = toks[p++].v;
    if (!isP('{')) {
      if (!tag) err(`expected a name or '{' after '${kwTok.v}'`);
      let def = lookupTag(tag);
      if (def && def.kind !== 'struct') err(`'${tag}' is not a ${kwTok.v}`);
      if (!def) { def = { kind: 'struct', name: tag, union, fields: [], size: 0, align: 1, complete: false, line: kwTok.line }; tagScopes[tagScopes.length - 1].set(tag, def); }
      return { k: 'struct', def };
    }
    p++;
    let def = tag ? tagScopes[tagScopes.length - 1].get(tag) : null;
    if (def && def.complete) err(`${kwTok.v} ${tag} is already defined (line ${def.line})`, kwTok.line);
    if (!def) { def = { kind: 'struct', name: tag, union, fields: [], size: 0, align: 1, complete: false, line: kwTok.line }; if (tag) tagScopes[tagScopes.length - 1].set(tag, def); }
    def.line = kwTok.line;
    const fields = [];
    while (!isP('}')) {
      if (peek().t === 'eof') err(`missing '}' at the end of ${kwTok.v} ${tag || ''}`, kwTok.line);
      const spec = declSpec();
      if (!spec) err(`expected a field type but found ${show(peek())}`);
      if (isP(';')) { // anonymous struct/union member
        if (spec.ty.k !== 'struct') err('a field needs a name');
        fields.push({ name: null, ty: spec.ty, line: spec.line }); p++; continue;
      }
      for (;;) {
        const d = declarator(spec.ty, false);
        if (isP(':')) err(`bit-fields are not supported on Bench-MCU; use masks and shifts on a whole integer for '${d.name}'`);
        if (d.ty.k === 'func') err(`a struct cannot contain a function; use a function pointer: (*${d.name})(...)`, d.line);
        if (d.ty.k === 'struct' && !d.ty.def.complete) err(`field '${d.name}' has incomplete type '${typeStr(d.ty)}'; a struct can only contain a pointer to itself`, d.line);
        if (fields.some((f) => f.name === d.name)) err(`duplicate field '${d.name}'`, d.line);
        fields.push({ name: d.name, ty: d.ty, line: d.line });
        if (!accept(',')) break;
      }
      expect(';');
    }
    p++;
    parseAttrs(attrs);
    const packed = !!attrs.packed || !!opts.forcePacked;
    const lay = layoutStruct(fields.map((f) => ({ size: sizeOf(f.ty, f.line), align: alignOf(f.ty) })), { union, packed });
    fields.forEach((f, i) => { f.off = lay.offsets[i]; });
    Object.assign(def, { fields, size: lay.size, align: lay.align, complete: true, packed });
    if (kwTok.line > 0) structDefs.push(def);
    return { k: 'struct', def };
  }
  function enumSpec() {
    const kwTok = toks[p++];
    let tag = null;
    if (peek().t === 'id' && !KEYWORDS.has(peek().v)) tag = toks[p++].v;
    const ty = { ...T.int, name: tag ? `enum ${tag}` : 'enum' };
    if (!accept('{')) { if (!tag) err("expected a name or '{' after 'enum'"); return ty; }
    let v = 0;
    while (!isP('}')) {
      const line = peek().line, name = ident('an enumerator name');
      if (accept('=')) v = constExpr();
      define(name, { kind: 'enum', val: v | 0 }, line);
      v++;
      if (!accept(',')) break;
    }
    expect('}', "at the end of the enum");
    if (tag) tagScopes[tagScopes.length - 1].set(tag, { kind: 'enum' });
    return ty;
  }
  function paramList() { // after '('
    const params = [];
    let varargs = false, old = false;
    if (accept(')')) return { params, varargs, old: true };
    if (isId('void') && isP(')', 1)) { p += 2; return { params, varargs, old }; }
    for (;;) {
      if (accept('...')) { varargs = true; break; }
      const spec = declSpec();
      if (!spec) err(`expected a parameter type but found ${show(peek())}`);
      const d = declarator(spec.ty, true);
      let ty = d.ty, wasArray = false;
      if (ty.k === 'arr') { ty = ptrTo(ty.of); wasArray = true; } else if (ty.k === 'func') ty = ptrTo(ty);
      if (ty.k === 'void') err("a parameter cannot have type void (use 'void' alone for no parameters)", d.line);
      params.push({ name: d.name, ty, wasArray, line: d.line });
      if (!accept(',')) break;
    }
    expect(')', 'after the parameters');
    return { params, varargs, old };
  }
  // Parses a declarator and returns { name, ty, line, attrs }. abstractOk: the name may be missing (casts, parameters).
  function declarator(base, abstractOk) {
    const d = declPart(abstractOk);
    return { name: d.name, ty: d.build(base), line: d.line, attrs: d.attrs };
  }
  function declPart(abstractOk) {
    const ptrs = [], attrs = {}, line = peek().line;
    parseAttrs(attrs);
    while (accept('*')) {
      let c = false;
      for (;;) { if (isId('const')) { c = true; p++; } else if (isId('volatile') || isId('restrict') || isId('__restrict')) p++; else break; }
      ptrs.push(c);
    }
    parseAttrs(attrs);
    let name = null, inner = null, nline = line;
    if (isP('(') && (isP('*', 1) || isP('(', 1) || isP('[', 1) || (peek(1).t === 'id' && !isTypeStart(1) && !abstractOk) || isId('__attribute__', 1))) { p++; inner = declPart(abstractOk); expect(')', 'in the declarator'); name = inner.name; nline = inner.line; Object.assign(attrs, inner.attrs); }
    else if (peek().t === 'id' && !KEYWORDS.has(peek().v)) { nline = peek().line; name = toks[p++].v; }
    else if (!abstractOk) err(`expected a name but found ${show(peek())}`);
    const suffixes = [];
    for (;;) {
      if (accept('[')) {
        let n = null;
        if (!isP(']')) { const l = peek().line; const e = condExpr(); if (e.k === undefined || !isInt(e.ty)) err('variable-length arrays are not supported: an array size must be a constant', l); n = Number(e.k); if (n < 0) err('array size cannot be negative', l); }
        expect(']');
        suffixes.push({ arr: n });
      } else if (isP('(')) { p++; suffixes.push({ fn: paramList() }); }
      else break;
    }
    parseAttrs(attrs);
    const build = (t) => {
      for (const c of ptrs) { t = ptrTo(t); if (c) t.const = true; }
      for (let i = suffixes.length - 1; i >= 0; i--) {
        const s = suffixes[i];
        if (s.fn) { if (t.k === 'arr' || t.k === 'func') err('a function cannot return an array or a function', line); t = { k: 'func', ret: t, params: s.fn.params, varargs: s.fn.varargs, old: s.fn.old }; }
        else { if (t.k === 'func') err('an array of functions is not allowed; use an array of function pointers', line); if (t.k === 'void') err('an array of void is not allowed', line); if (t.k === 'struct' && !t.def.complete) sizeOf(t, line); if (t.k === 'arr' && t.n == null) err('only the first dimension of an array may be left empty', line); t = arrOf(t, s.arr); }
      }
      return inner ? inner.build(t) : t;
    };
    return { name, build, line: nline, attrs };
  }
  function typeName() {
    const spec = declSpec();
    if (!spec) err(`expected a type but found ${show(peek())}`);
    const d = declarator(spec.ty, true);
    if (d.name) err(`unexpected name '${d.name}' in a type`, d.line);
    return d.ty;
  }
  function internString(bytes) {
    const key = bytes.join(',');
    let s = strings.get(key);
    if (!s) { s = { addr: 0, bytes }; strings.set(key, s); }
    return s;
  }

  // ------------------------------------------------ initialisers
  function parseInit() {
    if (!isP('{')) return assignExpr();
    const line = peek().line, items = [];
    p++;
    while (!isP('}')) {
      const des = [];
      while (isP('.') || isP('[')) { if (accept('.')) des.push(ident('a field name')); else { p++; des.push(constExpr()); expect(']'); } }
      if (des.length) expect('=', 'after the designator');
      items.push({ des, init: parseInit() });
      if (!accept(',')) break;
    }
    expect('}', 'at the end of the initialiser list');
    return { list: items, line };
  }
  // Returns { ty (array size completed), run(base) }.
  function genInit(ty0, init, line, zeroFirst) {
    let ops = [];
    const count = (t) => (t.k === 'arr' ? (t.n == null ? Infinity : t.n) : t.def.fields.length);
    const elem = (t, i) => (t.k === 'arr' ? { ty: t.of, off: i * sizeOf(t.of, line) } : { ty: t.def.fields[i].ty, off: t.def.fields[i].off });
    const isCharArr = (t) => t.k === 'arr' && t.of.k === 'int' && t.of.size === 1;
    function one(t, off, v) {
      if (v.list) {
        if (isScalar(t)) { if (v.list.length !== 1 || v.list[0].init.list) err('too many values in braces for a single variable', v.line); return one(t, off, v.list[0].init); }
        fill(t, off, v.list.slice(), 0, true);
      } else if (isCharArr(t) && v.strlit) {
        if (t.n != null && v.strlit.length > t.n) err(`the string needs ${v.strlit.length + 1} bytes (with its terminating \\0) but the array has only ${t.n}`, line);
        if (t.n != null && v.strlit.length === t.n) warn(line, `the array has room for the ${t.n} characters but not for the terminating \\0, so it is not a valid C string`);
        ops.push({ off, bytes: v.strlit.concat(t.n == null || v.strlit.length < t.n ? [0] : []) });
      } else if (t.k === 'arr') err('an array must be initialised with a brace list { ... } or, for char arrays, a string', line);
      else ops.push({ off, st: storer(t, line), ev: coerce(rv(v), t, 'initialisation', line) });
    }
    function fill(t, off, items, pos, top) {
      let idx = 0, max = 0;
      const isUnion = t.k === 'struct' && t.def.union;
      while (pos < items.length) {
        let it = items[pos];
        if (it.des.length) {
          if (!top) break;
          const d = it.des[0];
          if (typeof d === 'number') { if (t.k !== 'arr') err('[index] designator used on something that is not an array', line); idx = d; }
          else { if (t.k !== 'struct') err(`.${d} designator used on something that is not a struct`, line); idx = t.def.fields.findIndex((f) => f.name === d); if (idx < 0) err(`'${typeStr(t)}' has no field named '${d}'`, line); }
          if (idx >= count(t)) err(`index ${idx} is outside the array`, line);
          if (it.des.length > 1) { const e = elem(t, idx); fill(e.ty, off + e.off, [{ des: it.des.slice(1), init: it.init }], 0, true); pos++; idx++; if (idx > max) max = idx; continue; }
          it = items[pos] = { des: [], init: it.init };
        }
        if (idx >= count(t) || (isUnion && idx > 0 && !it.des.length && max > 0)) { if (top) err(`too many initialisers for '${typeStr(t)}'`, line); break; }
        const e = elem(t, idx), v = it.init;
        if (v.list || isScalar(e.ty) || (e.ty.k === 'struct' && v.ty && v.ty.k === 'struct') || (isCharArr(e.ty) && v.strlit)) { one(e.ty, off + e.off, v); pos++; }
        else pos = fill(e.ty, off + e.off, items, pos, false)[0];
        idx++; if (idx > max) max = idx;
        if (isUnion && !top) break;
      }
      return [pos, max];
    }
    let ty = ty0;
    if (ty.k === 'arr' && ty.n == null) {
      let n;
      if (init.strlit && isCharArr(ty)) n = init.strlit.length + 1;
      else if (init.list) { n = fill(ty, 0, init.list.slice(), 0, true)[1]; ops = []; }
      else err('an array must be initialised with a brace list { ... } or, for char arrays, a string', line);
      ty = arrOf(ty.of, n); if (ty0.const) ty.const = true;
    }
    one(ty, 0, init);
    const size = sizeOf(ty, line), aggregate = !isScalar(ty) && !(init.ty && init.ty.k === 'struct');
    return {
      ty,
      run(base) {
        if (zeroFirst && aggregate) for (let i = 0; i < size; i++) wr(base + i, 1, 0);
        for (const o of ops) { if (o.bytes) for (let i = 0; i < o.bytes.length; i++) wr(base + o.off + i, 1, o.bytes[i]); else o.st(base + o.off, o.ev()); }
      },
    };
  }

  // ------------------------------------------------ expressions
  const num = (ty, v) => ({ ty, k: v, ev: () => v });
  function lval(ty, addr, line, extra) {
    const n = { ty, addr, lv: true, line, ...extra };
    if (ty.k !== 'arr' && ty.k !== 'func' && ty.k !== 'void') { const L = loader(ty, line); n.ev = () => L(addr()); }
    return n;
  }
  function rv(n) { // array and function designators decay to pointers
    if (n.ty.k === 'arr') return { ty: ptrTo(n.ty.of), ev: n.addr, strlit: n.strlit, line: n.line };
    if (n.ty.k === 'func') return { ty: ptrTo(n.ty), ev: n.addr, fn: n.fn, line: n.line };
    if (!n.ev) err('this expression has no value', n.line);
    return n;
  }
  const promT = (t) => (t.rank < 3 ? T.int : t.const ? { ...t, const: false } : t);
  const promote = (n) => (n.ty.rank < 3 ? { ...n, ty: T.int, lv: false, addr: undefined } : n);
  function common(a, b) {
    a = promT(a); b = promT(b);
    if (a.signed === b.signed) return a.rank >= b.rank ? a : b;
    const u = a.signed ? b : a, s = a.signed ? a : b;
    if (u.rank >= s.rank) return u;
    if (s.size > u.size) return s;
    return s.size === 8 ? T.ullong : T.ulong;
  }
  function conv(n, to) { // value conversion without diagnostics
    const c = cv(n.ty, to);
    if (!c) return { ...n, ty: to, lv: false, addr: undefined };
    const e = n.ev, r = { ty: to, ev: () => c(e()), line: n.line };
    if (n.k !== undefined) { r.k = c(n.k); r.ev = () => r.k; }
    return r;
  }
  function fold(n, a, b) {
    if (a.k !== undefined && (!b || b.k !== undefined)) { try { const k = n.ev(); n.k = k; n.ev = () => k; } catch (e) { if (e instanceof CError) throw e; } }
    return n;
  }
  const truth = (n) => { n = rv(n); if (!isScalar(n.ty)) err(`a ${typeStr(n.ty)} cannot be used as a condition`, n.line); const e = n.ev; return is64(n.ty) ? () => e() !== 0n : () => e() !== 0; };
  const toNumEv = (n) => { const e = n.ev; return is64(n.ty) ? () => Number(asI(64, e())) : e; };
  function ovf(line, x, op, y, r) { warn(line, `signed integer overflow: ${x} ${op} ${y} does not fit in a ${typeof r === 'bigint' ? 'long long' : 'int'} and wraps to ${r}. This is undefined behaviour in C; a real compiler may assume it never happens`, 'ovf'); return r; }
  const divZero = () => fault('division by zero');
  function opFn(op, ct, line) {
    const cmp = { '<': (x, y) => (x < y ? 1 : 0), '>': (x, y) => (x > y ? 1 : 0), '<=': (x, y) => (x <= y ? 1 : 0), '>=': (x, y) => (x >= y ? 1 : 0), '==': (x, y) => (x === y ? 1 : 0), '!=': (x, y) => (x !== y ? 1 : 0) }[op];
    if (cmp) return cmp;
    if (ct.size === 8) {
      const w = ct.signed ? asI : asU, s = ct.signed, MIN = -(1n << 63n), MAX = (1n << 63n) - 1n;
      const chk = (x, sym, y, r) => (s && (r > MAX || r < MIN) ? ovf(line, x, sym, y, w(64, r)) : w(64, r));
      switch (op) {
        case '+': return (x, y) => chk(x, '+', y, x + y);
        case '-': return (x, y) => chk(x, '-', y, x - y);
        case '*': return (x, y) => chk(x, '*', y, x * y);
        case '/': return (x, y) => (y === 0n ? divZero() : chk(x, '/', y, x / y));
        case '%': return (x, y) => (y === 0n ? divZero() : w(64, x % y));
        case '&': return (x, y) => w(64, x & y);
        case '|': return (x, y) => w(64, x | y);
        default: return (x, y) => w(64, x ^ y);
      }
    }
    if (ct.signed) switch (op) {
      case '+': return (x, y) => { const r = x + y; return r > 2147483647 || r < -2147483648 ? ovf(line, x, '+', y, r | 0) : r; };
      case '-': return (x, y) => { const r = x - y; return r > 2147483647 || r < -2147483648 ? ovf(line, x, '-', y, r | 0) : r; };
      case '*': return (x, y) => { const r = x * y; return r > 2147483647 || r < -2147483648 ? ovf(line, x, '*', y, Math.imul(x, y)) : r; };
      case '/': return (x, y) => (y === 0 ? divZero() : y === -1 && x === -2147483648 ? ovf(line, x, '/', y, x) : (x / y) | 0);
      case '%': return (x, y) => (y === 0 ? divZero() : (x % y) | 0);
      case '&': return (x, y) => x & y;
      case '|': return (x, y) => x | y;
      default: return (x, y) => x ^ y;
    }
    switch (op) {
      case '+': return (x, y) => (x + y) >>> 0;
      case '-': return (x, y) => (x - y) >>> 0;
      case '*': return (x, y) => Math.imul(x, y) >>> 0;
      case '/': return (x, y) => (y === 0 ? divZero() : Math.floor(x / y));
      case '%': return (x, y) => (y === 0 ? divZero() : x % y);
      case '&': return (x, y) => (x & y) >>> 0;
      case '|': return (x, y) => (x | y) >>> 0;
      default: return (x, y) => (x ^ y) >>> 0;
    }
  }
  function shiftFn(op, rt, line) {
    const bits = rt.size * 8;
    const bad = (n, r) => { warn(line, `shifting a ${bits}-bit value by ${n} is undefined behaviour (the count must be 0..${bits - 1}); this simulator gives ${r}`, 'shift'); return r; };
    if (rt.size === 8) {
      const w = rt.signed ? asI : asU;
      return op === '<<' ? (x, n) => (n < 0 || n >= 64 ? bad(n, 0n) : w(64, x << BigInt(n))) : (x, n) => (n < 0 || n >= 64 ? bad(n, 0n) : x >> BigInt(n));
    }
    if (rt.signed) return op === '<<'
      ? (x, n) => { if (n < 0 || n >= 32) return bad(n, 0); const r = x << n; if (x < 0 || (r >> n) !== x) warn(line, `left shift overflows a signed int (${x} << ${n} gives ${r}): undefined behaviour in C. Shift an unsigned value instead, for example ${x === 1 ? '1u' : '(uint32_t)x'} << ${n}`, 'shl'); return r; }
      : (x, n) => (n < 0 || n >= 32 ? bad(n, x < 0 ? -1 : 0) : x >> n);
    return op === '<<' ? (x, n) => (n < 0 || n >= 32 ? bad(n, 0) : (x << n) >>> 0) : (x, n) => (n < 0 || n >= 32 ? bad(n, 0) : x >>> n);
  }
  function pointee(t, line) { const s = t.to.k === 'void' || t.to.k === 'func' ? 1 : sizeOf(t.to, line); return s || 1; }
  function binary(op, a, b, line) {
    a = rv(a); b = rv(b);
    const A = a.ty, B = b.ty, rel = op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=';
    if (A.k === 'struct' || B.k === 'struct' || A.k === 'void' || B.k === 'void') err(`operator '${op}' cannot be applied to '${typeStr(A)}' and '${typeStr(B)}'`, line);
    if (isInt(A) && isInt(B)) {
      if (op === '<<' || op === '>>') {
        const pa = promote(a), f = shiftFn(op, pa.ty, line), x = pa.ev, c = toNumEv(b);
        return fold({ ty: promT(pa.ty), ev: () => f(x(), c()), line }, a, b);
      }
      const ct = common(A, B), ca = conv(a, ct), cb = conv(b, ct), f = opFn(op, ct, line);
      let x = ca.ev, y = cb.ev;
      if (rel && !ct.signed) { // a negative signed operand silently becomes a huge unsigned value
        const wrapChk = (n, e) => { if (!promT(n.ty).signed || n.k !== undefined) return e; const c = cv(promT(n.ty), ct), raw = promote(n).ev; return () => { const r = raw(); if (r < 0) warn(line, `comparison between signed and unsigned: the signed value ${r} is converted to unsigned and becomes ${c ? c(r) : r} before '${op}' is evaluated`, 'signcmp'); return c ? c(r) : r; }; };
        x = wrapChk(a, x); y = wrapChk(b, y);
      }
      return fold({ ty: rel ? T.int : ct, ev: () => f(x(), y()), line }, a, b);
    }
    const x = isPtr(A) ? a.ev : toNumEv(a), y = isPtr(B) ? b.ev : toNumEv(b);
    if (rel) {
      if (isPtr(A) && isPtr(B)) { if (!sameType(A.to, B.to) && A.to.k !== 'void' && B.to.k !== 'void') warn(line, `comparing pointers to different types ('${typeStr(A)}' and '${typeStr(B)}')`); }
      else { const i = isPtr(A) ? b : a; if (i.k !== 0) warn(line, 'comparing a pointer with an integer; cast one side if this is intended'); }
      const f = opFn(op, T.uint, line), xu = isPtr(A) ? x : () => x() >>> 0, yu = isPtr(B) ? y : () => y() >>> 0;
      return { ty: T.int, ev: () => f(xu(), yu()), line };
    }
    if (op === '+' && (isPtr(A) !== isPtr(B))) {
      const pt = isPtr(A) ? A : B, pe = isPtr(A) ? x : y, ie = isPtr(A) ? y : x, sz = pointee(pt, line);
      return { ty: pt, ev: () => (pe() + ie() * sz) >>> 0, line };
    }
    if (op === '-' && isPtr(A) && isInt(B)) { const sz = pointee(A, line); return { ty: A, ev: () => (x() - y() * sz) >>> 0, line }; }
    if (op === '-' && isPtr(A) && isPtr(B)) {
      if (!sameType(A.to, B.to)) err(`cannot subtract pointers to different types ('${typeStr(A)}' and '${typeStr(B)}')`, line);
      const sz = pointee(A, line);
      return { ty: T.int, ev: () => (((x() - y()) | 0) / sz) | 0, line };
    }
    return err(`operator '${op}' cannot be applied to '${typeStr(A)}' and '${typeStr(B)}'`, line);
  }
  // Implicit conversion as in assignment, argument passing, return and initialisation. Returns an evaluator.
  function coerce(n, to, what, line) {
    const from = n.ty;
    if (from.k === 'void') err(`a void value cannot be used in ${what}`, line);
    if (to.k === 'struct' || from.k === 'struct') {
      if (to.k !== 'struct' || from.k !== 'struct' || to.def !== from.def) err(`incompatible types in ${what}: cannot convert '${typeStr(from)}' to '${typeStr(to)}'`, line);
      return n.ev;
    }
    if (to.k === 'ptr') {
      if (from.k === 'int') { if (n.k !== 0 && n.k !== 0n) warn(line, `${what} makes a pointer ('${typeStr(to)}') from an integer without a cast`); }
      else if (to.to.k !== 'void' && from.to.k !== 'void' && !sameType(to.to, from.to)) warn(line, `${what} from incompatible pointer type: '${typeStr(from)}' used as '${typeStr(to)}'`);
      else if (isConstType(from.to) && !isConstType(to.to) && from.to.k !== 'func') warn(line, `${what} discards 'const': '${typeStr(from)}' used as '${typeStr(to)}'`);
    } else if (from.k === 'ptr' && !to.bool) warn(line, `${what} makes an integer ('${typeStr(to)}') from a pointer without a cast`);
    if (to.k === 'int' && !to.bool && n.k !== undefined && from.k === 'int') {
      const c = cv(from, to), r = c ? c(n.k) : n.k;
      if (BigInt(r) !== BigInt(n.k) && BigInt(n.k) > 0n) warn(line, `${n.k} does not fit in '${typeStr(to)}'; ${what} stores ${r}`);
    }
    return conv(n, to).ev;
  }
  function modifiable(n, line, what) {
    if (!n.addr || !n.lv) err(`${what} needs something that can be assigned to (a variable, *pointer, array[i] or struct.field)`, line);
    if (n.ty.k === 'arr') err('an array cannot be assigned to as a whole; copy its elements (memcpy or strcpy)', line);
    if (n.ty.k === 'func') err('a function cannot be assigned to', line);
    if (isConstType(n.ty)) err(`cannot modify ${n.name ? `'${n.name}'` : 'this object'}: it is declared const`, line);
    if (n.ty.k === 'struct' && !n.ty.def.complete) sizeOf(n.ty, line);
  }
  function assign(op, lhs, rhs, line, post) {
    modifiable(lhs, line, op === '=' ? 'assignment' : `'${op}'`);
    const st = storer(lhs.ty, line), la = lhs.addr;
    if (op === '=') {
      const e = coerce(rv(rhs), lhs.ty, 'assignment', line);
      return { ty: lhs.ty, ev: () => { const v = e(); st(la(), v); return v; }, line, assign: true };
    }
    if (!isScalar(lhs.ty)) err(`'${op}' cannot be applied to '${typeStr(lhs.ty)}'`, line);
    let cur;
    const L = loader(lhs.ty, line), r = binary(op.slice(0, -1), { ty: lhs.ty, ev: () => cur, line }, rhs, line);
    const back = conv({ ty: r.ty, ev: r.ev }, lhs.ty).ev;
    if (post) return { ty: lhs.ty, ev: () => { const a = la(); const old = cur = L(a); st(a, back()); return old; }, line };
    return { ty: lhs.ty, ev: () => { const a = la(); cur = L(a); const v = back(); st(a, v); return v; }, line };
  }
  function findField(def, name) {
    for (const f of def.fields) {
      if (f.name === name) return { ty: f.ty, off: f.off };
      if (f.name === null) { const r = findField(f.ty.def, name); if (r) return { ty: r.ty, off: r.off + f.off }; }
    }
    return null;
  }
  function member(base, name, line, arrow) {
    let st = base.ty;
    if (arrow) { base = rv(base); st = base.ty; if (st.k !== 'ptr' || st.to.k !== 'struct') err(st.k === 'struct' ? `'->' needs a pointer; use '.${name}' on a struct value` : `'->' used on '${typeStr(st)}', which is not a pointer to a struct`, line); st = st.to; }
    else if (st.k !== 'struct') err(st.k === 'ptr' && st.to.k === 'struct' ? `this is a pointer to a struct; use '->${name}' instead of '.${name}'` : `'.${name}' used on '${typeStr(st)}', which is not a struct`, line);
    if (!st.def.complete) sizeOf(st, line);
    const f = findField(st.def, name);
    if (!f) err(`'${typeStr(st)}' has no field named '${name}'`, line);
    const fty = st.const && !isConstType(f.ty) ? constOf(f.ty) : f.ty, off = f.off;
    if (arrow) { const be = base.ev; return lval(fty, off ? () => (be() + off) >>> 0 : be, line, { name }); }
    if (base.addr) { const ba = base.addr; return lval(fty, off ? () => ba() + off : ba, line, { name, lv: base.lv }); }
    const be = base.ev, g = fromBuf(fty, line);
    return { ty: fty, ev: () => g(be(), off), line };
  }
  function call(fnNode, args, line) {
    if (inConstInit) err('the initialiser of a global or static variable must be a constant; a function call is not allowed here (assign it inside main instead)', line);
    let fty, direct = null, target = null;
    if (fnNode.ty.k === 'func') { fty = fnNode.ty; direct = fnNode.fn || null; target = fnNode.addr; }
    else { const r = rv(fnNode); if (r.ty.k !== 'ptr' || r.ty.to.k !== 'func') err(`${fnNode.name ? `'${fnNode.name}'` : 'this expression'} is not a function and cannot be called`, line); fty = r.ty.to; target = r.ev; }
    const ps = fty.params, name = direct ? direct.name : 'the function';
    if (!fty.old && (args.length < ps.length || (args.length > ps.length && !fty.varargs)))
      err(`${direct ? `'${name}'` : name} takes ${ps.length} argument${ps.length === 1 ? '' : 's'}${fty.varargs ? ' or more' : ''}, but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`, line);
    const tys = [], evs = args.map((a, i) => {
      a = rv(a);
      if (i < ps.length) { tys.push(ps[i].ty); return coerce(a, ps[i].ty, `argument ${i + 1} of ${direct ? name : 'the call'}`, line); }
      if (a.ty.k === 'struct') err('a struct cannot be passed to a variadic function', line);
      a = isInt(a.ty) ? promote(a) : a; tys.push(a.ty); return a.ev;
    });
    const n = evs.length, caller = curFn, site = caller ? caller.sites++ : 0;
    return {
      ty: fty.ret, line,
      ev: () => {
        const vals = new Array(n);
        for (let i = 0; i < n; i++) vals[i] = evs[i]();
        const f = direct || fnAt(target());
        const r = f.native ? f.native(vals, tys, line) : callUser(f, vals, caller ? caller.addr + 4 + 4 * site : START_RET);
        curLine = line;
        return r;
      },
    };
  }
  function primary() {
    const t = peek(), line = t.line;
    if (t.t === 'num') { p++; return { ...num(t.ty, t.v), line }; }
    if (t.t === 'str') {
      let bytes = [];
      while (peek().t === 'str') bytes = bytes.concat(toks[p++].v);
      const s = internString(bytes);
      return { ty: arrOf(T.char, bytes.length + 1), addr: () => s.addr, strlit: bytes, line };
    }
    if (isP('(')) { p++; const e = expression(); expect(')', 'to close the parenthesis'); return { ...e, assign: false, isRel: false }; }
    if (t.t === 'id') {
      if (t.v === 'offsetof' || t.v === '__builtin_offsetof') {
        p++; expect('(');
        const ty = typeName(); expect(',');
        if (ty.k !== 'struct') err('offsetof needs a struct or union type', line);
        let f = findField(ty.def, ident('a field name')), off;
        if (!f) err(`'${typeStr(ty)}' has no such field`, line);
        off = f.off;
        while (isP('.') || isP('[')) {
          if (accept('.')) { if (f.ty.k !== 'struct') err('not a struct', line); const g = findField(f.ty.def, ident()); if (!g) err('no such field', line); off += g.off; f = g; }
          else { p++; const i = constExpr(); expect(']'); if (f.ty.k !== 'arr') err('not an array', line); off += i * sizeOf(f.ty.of, line); f = { ty: f.ty.of }; }
        }
        expect(')');
        return { ...num(T.uint, off), line };
      }
      if (KEYWORDS.has(t.v)) err(`unexpected '${t.v}' in an expression`);
      p++;
      const s = lookup(t.v);
      if (!s) err(isP('(') ? `function '${t.v}' is not declared. Check the spelling, and define it (or write a prototype) above this line` : `'${t.v}' is not declared. Check the spelling, or declare it before this line`, line);
      if (s.kind === 'enum') return { ...num(T.int, s.val), line };
      if (s.kind === 'typedef') err(`'${t.v}' is a type, but a value is needed here`, line);
      if (s.kind === 'func') { const f = s.fn; return { ty: f.ty, addr: () => f.addr, fn: f, line, name: t.v }; }
      if (s.g) { const g = s.g; return lval(s.ty, () => g.addr, line, { name: t.v, wasArray: false }); }
      const off = s.off;
      return lval(s.ty, () => fp + off, line, { name: t.v, wasArray: s.wasArray });
    }
    return err(`expected an expression but found ${show(t)}`);
  }
  function postfix() {
    let n = primary();
    for (;;) {
      const line = peek().line;
      if (accept('[')) {
        const i = expression(); expect(']', 'after the array index');
        let a = rv(n), b = rv(i);
        if (!isPtr(a.ty) && isPtr(b.ty)) [a, b] = [b, a];
        if (!isPtr(a.ty) || !isInt(b.ty)) err(`'[...]' needs an array or pointer and an integer index, not '${typeStr(n.ty)}' and '${typeStr(i.ty)}'`, line);
        if (a.ty.to.k === 'void') err('cannot index a void*; cast it to a real pointer type first', line);
        if (a.ty.to.k === 'struct' && !a.ty.to.def.complete) sizeOf(a.ty.to, line);
        const sz = pointee(a.ty, line), be = a.ev, ie = toNumEv(b);
        n = lval(a.ty.to, b.k !== undefined ? (b.k === 0 ? be : () => (be() + Number(b.k) * sz) >>> 0) : () => (be() + ie() * sz) >>> 0, line, { name: n.name });
      } else if (accept('(')) {
        const args = [];
        if (!isP(')')) for (;;) { args.push(assignExpr()); if (!accept(',')) break; }
        expect(')', 'after the arguments');
        n = call(n, args, line);
      } else if (accept('.')) n = member(n, ident('a field name'), line, false);
      else if (accept('->')) n = member(n, ident('a field name'), line, true);
      else if (isP('++') || isP('--')) { const op = toks[p++].v; n = assign(op[0] + '=', n, num(T.int, 1), line, true); }
      else return n;
    }
  }
  function unary() {
    const t = peek(), line = t.line;
    if (t.t === 'p') switch (t.v) {
      case '++': case '--': { p++; const n = unary(); return assign(t.v[0] + '=', n, num(T.int, 1), line, false); }
      case '&': {
        p++; const n = castExpr();
        if (n.ty.k === 'func') return rv(n);
        if (!n.addr) err("'&' needs something that has an address (a variable, array element or struct field)", line);
        return { ty: ptrTo(n.ty), ev: n.addr, line };
      }
      case '*': {
        p++; const n = rv(castExpr());
        if (!isPtr(n.ty)) err(`'*' needs a pointer, but this is '${typeStr(n.ty)}'`, line);
        if (n.ty.to.k === 'void') err('cannot dereference a void*; cast it to a real pointer type first', line);
        if (n.ty.to.k === 'func') return { ty: n.ty.to, addr: n.ev, line };
        return lval(n.ty.to, n.ev, line);
      }
      case '+': case '-': case '~': {
        p++; const n0 = rv(castExpr());
        if (!isInt(n0.ty)) err(`unary '${t.v}' needs an integer, not '${typeStr(n0.ty)}'`, line);
        const n = promote(n0), e = n.ev, ty = promT(n.ty);
        if (t.v === '+') return { ...n, ty, line };
        let f;
        if (ty.size === 8) { const w = ty.signed ? asI : asU; f = t.v === '-' ? (x) => (ty.signed && x === -(1n << 63n) ? ovf(line, 0, '-', x, x) : w(64, -x)) : (x) => w(64, ~x); }
        else if (ty.signed) f = t.v === '-' ? (x) => (x === -2147483648 ? ovf(line, 0, '-', x, x) : -x) : (x) => ~x;
        else f = t.v === '-' ? (x) => (-x) >>> 0 : (x) => (~x) >>> 0;
        return fold({ ty, ev: () => f(e()), line }, n);
      }
      case '!': { p++; const n = rv(castExpr()), c = truth(n); return fold({ ty: T.int, ev: () => (c() ? 0 : 1), line }, n); }
    }
    if (isId('sizeof') || isId('_Alignof') || isId('__alignof__')) {
      p++;
      let ty;
      if (isP('(') && isTypeStart(1)) { p++; ty = typeName(); expect(')'); }
      else { const save = curFn ? curFn.sites : 0; const n = unary(); if (curFn) curFn.sites = save; ty = n.ty; if (n.wasArray) warn(line, `sizeof(${n.name}) is the size of a pointer (4), not of the caller's array: an array parameter is really a pointer. Pass the length as a separate argument`); }
      if (t.v !== 'sizeof') return { ...num(T.uint, alignOf(ty)), line };
      if (ty.k === 'func') err('sizeof cannot be applied to a function', line);
      if (ty.k === 'arr' && ty.n == null) err('sizeof cannot be applied to an array of unknown size', line);
      if (ty.k === 'void') err('sizeof(void) is not valid C', line);
      return { ...num({ ...T.uint, name: 'size_t' }, sizeOf(ty, line)), line };
    }
    return postfix();
  }
  function castExpr() {
    if (isP('(') && isTypeStart(1)) {
      const line = peek().line;
      p++; const to = typeName(); expect(')', 'after the type in the cast');
      if (isP('{')) err('compound literals are not supported; declare a variable instead', line);
      const n = rv(castExpr());
      if (to.k === 'void') { const e = n.ev; return { ty: T.void, ev: () => { e(); }, line }; }
      if (to.k === 'struct' || to.k === 'arr' || to.k === 'func' || n.ty.k === 'struct') { if (to.k === 'struct' && n.ty.k === 'struct' && to.def === n.ty.def) return n; err(`cannot cast '${typeStr(n.ty)}' to '${typeStr(to)}'`, line); }
      if (n.ty.k === 'void') err('cannot cast a void value', line);
      const r = conv(n, to); r.line = line; r.fn = undefined; r.strlit = undefined;
      return r;
    }
    return unary();
  }
  const BIN_PREC = { '*': 10, '/': 10, '%': 10, '+': 9, '-': 9, '<<': 8, '>>': 8, '<': 7, '>': 7, '<=': 7, '>=': 7, '==': 6, '!=': 6, '&': 5, '^': 4, '|': 3, '&&': 2, '||': 1 };
  function binExpr(min) {
    let a = castExpr();
    for (;;) {
      const t = peek(), pr = t.t === 'p' ? BIN_PREC[t.v] : 0;
      if (!pr || pr < min) return a;
      p++;
      const b = binExpr(pr + 1), line = t.line;
      if (t.v === '&&' || t.v === '||') {
        const x = truth(a), y = truth(b), and = t.v === '&&';
        const n = { ty: T.int, ev: and ? () => (x() && y() ? 1 : 0) : () => (x() || y() ? 1 : 0), line };
        a = fold(n, rv(a), rv(b));
      } else {
        if ((t.v === '==' || t.v === '!=') && (a.strlit || b.strlit)) warn(line, `'${t.v}' compares the addresses of the strings, not their characters; use strcmp(...) == 0`);
        if ((t.v === '&' || t.v === '|' || t.v === '^') && (a.isRel || b.isRel) ) warn(line, `'${t.v}' binds less tightly than '==' and '<': this parses as x ${t.v} (y == z). Add parentheses around the '${t.v}' part`);
        a = binary(t.v, a, b, line);
        if (pr === 6 || pr === 7) a.isRel = true;
      }
    }
  }
  function condExpr() {
    const c = binExpr(1);
    if (!isP('?')) return c;
    const line = toks[p++].line, ct = truth(c);
    let a = rv(expression()); expect(':', "in the '?:' expression");
    let b = rv(condExpr());
    let ty;
    if (isInt(a.ty) && isInt(b.ty)) { ty = common(a.ty, b.ty); a = conv(a, ty); b = conv(b, ty); }
    else if (a.ty.k === 'void' || b.ty.k === 'void') { ty = T.void; }
    else if (isPtr(a.ty) && (isPtr(b.ty) || b.k === 0)) ty = a.ty.to.k === 'void' && isPtr(b.ty) ? b.ty : a.ty;
    else if (isPtr(b.ty) && a.k === 0) ty = b.ty;
    else if (a.ty.k === 'struct' && b.ty.k === 'struct' && a.ty.def === b.ty.def) ty = a.ty;
    else err(`the two branches of '?:' have incompatible types ('${typeStr(a.ty)}' and '${typeStr(b.ty)}')`, line);
    const x = a.ev, y = b.ev;
    const n = { ty, ev: () => (ct() ? x() : y()), line };
    if (c.k !== undefined && a.k !== undefined && b.k !== undefined) { n.k = (is64(c.ty) ? c.k !== 0n : c.k !== 0) ? a.k : b.k; n.ev = () => n.k; }
    return n;
  }
  const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);
  function assignExpr() {
    const lhs = condExpr(), t = peek();
    if (t.t === 'p' && ASSIGN_OPS.has(t.v)) { p++; return assign(t.v, lhs, assignExpr(), t.line, false); }
    return lhs;
  }
  function expression() {
    let a = assignExpr();
    while (isP(',')) { const line = toks[p++].line; const b = rv(assignExpr()), x = rv(a).ev, y = b.ev; a = { ty: b.ty, ev: () => { x(); return y(); }, line }; }
    return a;
  }
  function constExpr() {
    const line = peek().line, e = condExpr();
    if (e.k === undefined || !isInt(e.ty)) err('a constant integer expression is needed here', line);
    return Number(e.k);
  }

  // ------------------------------------------------ statements
  const NOP = () => 0;
  function allocLocal(ty, line) {
    const size = sizeOf(ty, line), al = Math.min(alignOf(ty), 4);
    curFn.cur = Math.ceil((curFn.cur + size) / al) * al;
    return -curFn.cur;
  }
  function typedefSym(name, ty, line) {
    if (ty.k === 'int') ty = { ...ty, name };
    else if (ty.k === 'struct' && !ty.def.alias && !ty.def.name) ty.def.alias = name;
    define(name, { kind: 'typedef', ty }, line);
  }
  function newGlobal(name, ty, line, isStatic) {
    const g = { name, ty, addr: 0, init: null, line, fn: isStatic && curFn ? curFn.name : null };
    globals.push(g);
    return g;
  }
  function globalInit(g, line) {
    const save = inConstInit, saveFn = curFn;
    inConstInit = true; curFn = null;
    const gi = genInit(g.ty, parseInit(), line, false);
    inConstInit = save; curFn = saveFn;
    g.ty = gi.ty; g.init = gi;
  }
  function checkObject(ty, name, line) {
    if (ty.k === 'void') err(`variable '${name}' cannot have type void`, line);
    if (ty.k === 'arr' && ty.n == null) err(`array '${name}' needs a size, or an initialiser to take its size from`, line);
    sizeOf(ty, line);
  }
  function localDecl() {
    const spec = declSpec(), line = spec.line;
    if (accept(';')) return NOP;
    const inits = [];
    for (;;) {
      const d = declarator(spec.ty, false);
      let ty = d.ty;
      if (spec.storage === 'typedef') typedefSym(d.name, ty, d.line);
      else if (ty.k === 'func') declareFunc(d.name, ty, d.line);
      else if (spec.storage === 'extern') { const s = scopes[0].get(d.name); if (!s || s.kind !== 'var') err(`'${d.name}' is declared extern but there is no such global`, d.line); define(d.name, { kind: 'var', ty: s.ty, g: s.g }, d.line); }
      else if (spec.storage === 'static') {
        const g = newGlobal(d.name, ty, d.line, true);
        if (accept('=')) globalInit(g, d.line);
        checkObject(g.ty, d.name, d.line);
        define(d.name, { kind: 'var', ty: g.ty, g }, d.line);
      } else {
        let gi = null;
        if (accept('=')) { gi = genInit(ty, parseInit(), d.line, true); ty = gi.ty; }
        checkObject(ty, d.name, d.line);
        const off = allocLocal(ty, d.line);
        define(d.name, { kind: 'var', ty, off }, d.line);
        curFn.locals.push({ name: d.name, ty, off, line: d.line });
        if (gi) inits.push(() => gi.run(fp + off));
      }
      if (!accept(',')) break;
    }
    expect(';');
    if (inits.length === 1) { const i0 = inits[0]; return () => { tick(line); i0(); return 0; }; }
    return () => { tick(line); for (let i = 0; i < inits.length; i++) inits[i](); return 0; };
  }
  function condition(what) {
    expect('(', `after '${what}'`);
    const line = peek().line, e = expression();
    if (e.assign) warn(line, `'=' inside the ${what} condition assigns, it does not compare. If you meant to compare, use '=='`);
    expect(')', `to close the ${what} condition`);
    return truth(e);
  }
  function seq(list) {
    const n = list.length;
    if (n === 0) return NOP;
    if (n === 1) return list[0];
    if (n === 2) { const a = list[0], b = list[1]; return () => a() || b(); }
    return () => { for (let i = 0; i < n; i++) { const c = list[i](); if (c) return c; } return 0; };
  }
  function block(scope = true) {
    const open = peek().line;
    expect('{');
    if (scope) pushScope();
    const list = [];
    while (!isP('}')) {
      if (peek().t === 'eof') err("missing '}' — this block is never closed", open);
      list.push(statement());
    }
    p++;
    if (scope) popScope();
    return seq(list);
  }
  function statement() {
    const t = peek(), line = t.line;
    if (t.t === 'p') {
      if (t.v === '{') return block();
      if (t.v === ';') { p++; return NOP; }
    }
    if (t.t === 'id') switch (t.v) {
      case 'if': {
        p++; const c = condition('if');
        if (isP(';')) warn(line, "this 'if' is followed directly by ';', so it controls nothing and the next statement always runs");
        const a = statement();
        if (isId('else')) { p++; const b = statement(); return () => { tick(line); return c() ? a() : b(); }; }
        return () => { tick(line); return c() ? a() : 0; };
      }
      case 'while': {
        p++; const c = condition('while');
        loopDepth++; const body = statement(); loopDepth--;
        return () => { for (;;) { tick(line); if (!c()) return 0; const r = body(); if (r) { if (r === 1) return 0; if (r === 3) return 3; } } };
      }
      case 'do': {
        p++; loopDepth++; const body = statement(); loopDepth--;
        if (!isId('while')) err("expected 'while' after the body of 'do'");
        const wl = toks[p++].line, c = condition('while'); expect(';');
        return () => { for (;;) { const r = body(); if (r) { if (r === 1) return 0; if (r === 3) return 3; } tick(wl); if (!c()) return 0; } };
      }
      case 'for': {
        p++; expect('(', "after 'for'"); pushScope();
        let init = NOP, c = null, step = null;
        if (isTypeStart()) init = localDecl();
        else if (accept(';')) init = NOP;
        else { const e = rvOrVoid(expression()).ev; expect(';'); init = () => { tick(line); e(); return 0; }; }
        if (!isP(';')) { const cl = peek().line, e = expression(); if (e.assign) warn(cl, "'=' inside the for condition assigns, it does not compare"); c = truth(e); }
        expect(';');
        if (!isP(')')) step = rvOrVoid(expression()).ev;
        expect(')', "to close the 'for' header");
        loopDepth++; const body = statement(); loopDepth--;
        popScope();
        return () => {
          init();
          for (;;) { tick(line); if (c && !c()) return 0; const r = body(); if (r) { if (r === 1) return 0; if (r === 3) return 3; } if (step) step(); }
        };
      }
      case 'switch': return switchStmt();
      case 'case': case 'default': err(`'${t.v}' must be directly inside the braces of a switch`);
      case 'break': p++; expect(';'); if (!loopDepth && !switchDepth) err("'break' is only allowed inside a loop or a switch", line); return () => { tick(line); return 1; };
      case 'continue': p++; expect(';'); if (!loopDepth) err("'continue' is only allowed inside a loop", line); return () => { tick(line); return 2; };
      case 'return': {
        p++;
        const rt = curFn.ty.ret;
        if (accept(';')) { if (rt.k !== 'void' && curFn.name !== 'main') warn(line, `'return' with no value in '${curFn.name}', which should return ${typeStr(rt)}`); return () => { tick(line); retVal = is64(rt) ? 0n : 0; return 3; }; }
        const e = expression(); expect(';');
        if (rt.k === 'void') { if (e.ty.k !== 'void') err(`'${curFn.name}' returns void, so 'return' cannot have a value`, line); const x = e.ev; return () => { tick(line); x(); return 3; }; }
        const x = coerce(rv(e), rt, 'return', line);
        return () => { tick(line); retVal = x(); return 3; };
      }
      case 'goto': err("'goto' is not supported on Bench-MCU; use loops, break/continue or an early return");
      case 'else': err("'else' without a matching 'if' (is there a stray ';' or a missing brace above?)");
      case '_Static_assert': case 'static_assert': { staticAssert(); return NOP; }
      default:
        if (isP(':', 1) && !lookup(t.v)) err("labels and 'goto' are not supported on Bench-MCU");
    }
    if (isTypeStart()) return localDecl();
    const e = rvOrVoid(expression()).ev;
    expect(';');
    return () => { tick(line); e(); return 0; };
  }
  function rvOrVoid(n) { return n.ty.k === 'void' ? n : n.ty.k === 'arr' || n.ty.k === 'func' ? rv(n) : n; }
  function staticAssert() {
    const line = toks[p++].line; expect('(');
    const v = constExpr(); let msg = '';
    if (accept(',')) { if (peek().t !== 'str') err('expected a message string'); msg = bytesToStr(toks[p++].v); }
    expect(')'); expect(';');
    if (!v) err(`static assertion failed${msg ? ': ' + msg : ''}`, line);
  }
  function switchStmt() {
    const line = toks[p++].line;
    expect('(', "after 'switch'");
    const e0 = rv(expression()); expect(')');
    if (!isInt(e0.ty)) err('switch needs an integer expression', line);
    const e = promote(e0), ev = e.ev, big = is64(e.ty);
    if (!isP('{')) err("expected '{' after switch (...)");
    p++; pushScope(); switchDepth++;
    const cases = new Map(), list = [];
    let def = -1;
    while (!isP('}')) {
      if (peek().t === 'eof') err("missing '}' at the end of the switch", line);
      if (isId('case')) {
        const cl = toks[p++].line, ce = condExpr();
        if (ce.k === undefined || !isInt(ce.ty)) err('a case label must be a constant integer', cl);
        expect(':', 'after the case value');
        let k = conv(ce, e.ty).k; if (big) k = k.toString();
        if (cases.has(k)) err(`duplicate case value ${k}`, cl);
        cases.set(k, list.length);
      } else if (isId('default')) { const dl = toks[p++].line; expect(':', "after 'default'"); if (def >= 0) err("a switch can have only one 'default'", dl); def = list.length; }
      else list.push(statement());
    }
    p++; switchDepth--; popScope();
    const n = list.length;
    return () => {
      tick(line);
      let v = ev(); if (big) v = v.toString();
      let i = cases.get(v);
      if (i === undefined) { if (def < 0) return 0; i = def; }
      for (; i < n; i++) { const c = list[i](); if (c) return c === 1 ? 0 : c; }
      return 0;
    };
  }

  // ------------------------------------------------ top level
  function declareFunc(name, ty, line) {
    const old = scopes[0].get(name);
    if (old) {
      if (old.kind !== 'func') err(`'${name}' is already declared as something that is not a function (line ${old.line})`, line);
      if (!old.fn.native && !old.fn.body) old.fn.ty = ty;
      if (!old.fn.native && old.fn.body && line > 0 && !sameType(old.fn.ty, ty)) err(`this declaration of '${name}' does not match its definition on line ${old.fn.line}`, line);
      return old.fn;
    }
    const fn = { name, ty, addr: 0, body: null, params: [], argSize: 0, frameSize: 0, sites: 0, cur: 0, line, endLine: line, locals: [], native: line === 0 ? NATIVES[name] || null : null };
    functions.push(fn);
    scopes[0].set(name, { kind: 'func', fn, line, prelude: line === 0 });
    return fn;
  }
  function functionDef(spec, d) {
    if (curFn) err('a function cannot be defined inside another function', d.line);
    const fn = declareFunc(d.name, d.ty, d.line);
    if (fn.body) err(`function '${d.name}' is already defined on line ${fn.line}`, d.line);
    if (fn.native) { fn.native = null; }
    fn.ty = d.ty; fn.line = d.line; fn.userDefined = true;
    const attrs = { ...spec.attrs, ...d.attrs };
    if (attrs.interrupt != null) fn.isr = attrs.interrupt;
    if (d.ty.varargs) err("variadic functions ('...') cannot be defined on Bench-MCU; only the printf family is variadic", d.line);
    if (d.ty.ret.k === 'struct') sizeOf(d.ty.ret, d.line);
    curFn = fn; pushScope();
    let slot = 0;
    fn.params = d.ty.params.map((prm, i) => {
      if (!prm.name) err(`parameter ${i + 1} of '${d.name}' needs a name`, d.line);
      const size = sizeOf(prm.ty, d.line), my = slot;
      slot += Math.max(4, (size + 3) & ~3);
      define(prm.name, { kind: 'var', ty: prm.ty, off: 8 + my, wasArray: prm.wasArray }, prm.line);
      return { name: prm.name, ty: prm.ty, slot: my, off: 8 + my, st: storer(prm.ty, d.line) };
    });
    fn.argSize = slot;
    const saveL = loopDepth, saveS = switchDepth; loopDepth = 0; switchDepth = 0;
    fn.body = NOP; // marks "being defined" so recursion type-checks
    const body = block(false);
    fn.endLine = toks[p - 1].line;
    loopDepth = saveL; switchDepth = saveS;
    popScope(); curFn = null;
    fn.body = body; fn.frameSize = (fn.cur + 3) & ~3;
  }
  function topLevel() {
    while (peek().t !== 'eof') {
      if (accept(';')) continue;
      if (isId('_Static_assert') || isId('static_assert')) { staticAssert(); continue; }
      const t = peek(), spec = declSpec();
      if (!spec) {
        if (t.t === 'id' && isP('(', 1) && !KEYWORDS.has(t.v)) err(`'${t.v}(...)' appears outside any function. Statements must be inside a function such as main (or a return type is missing in front of '${t.v}')`);
        if (t.t === 'id' && KEYWORDS.has(t.v)) err(`'${t.v}' appears outside any function — is there an extra '}' above this line?`);
        if (t.t === 'id' && peek(1).t === 'id') err(`unknown type '${t.v}'. Check the spelling, or define it (typedef/struct) above this line`);
        err(`expected a declaration but found ${show(t)}`);
      }
      if (accept(';')) continue;
      for (let first = true; ; first = false) {
        const d = declarator(spec.ty, false);
        if (d.ty.k === 'func' && spec.storage !== 'typedef') {
          if (first && isP('{')) { functionDef(spec, d); break; }
          const fn = declareFunc(d.name, d.ty, d.line);
          const attrs = { ...spec.attrs, ...d.attrs }; if (attrs.interrupt != null) fn.isr = attrs.interrupt;
        } else if (spec.storage === 'typedef') typedefSym(d.name, d.ty, d.line);
        else {
          const old = scopes[0].get(d.name);
          let g;
          if (old && old.kind === 'var' && !old.prelude) {
            if (!sameType(old.ty, d.ty)) err(`'${d.name}' was declared with a different type on line ${old.line}`, d.line);
            g = old.g;
            if (isP('=') && g.init) err(`'${d.name}' is already defined on line ${old.line}`, d.line);
          } else { g = newGlobal(d.name, d.ty, d.line, false); define(d.name, { kind: 'var', ty: d.ty, g }, d.line); }
          if (accept('=')) { globalInit(g, d.line); scopes[0].get(d.name).ty = g.ty; }
          if (spec.storage !== 'extern') checkObject(g.ty, d.name, d.line);
        }
        if (!accept(',')) { expect(';'); break; }
      }
    }
  }

  // ------------------------------------------------ library
  function emit(bytes) { for (let i = 0; i < bytes.length; i++) out.push(bytes[i]); if (out.length > 262144) fault('the program printed more than 256 KiB; stopping (is a print inside an endless loop?)'); }
  function format(fa, vals, tys, ai) {
    const o = [];
    const big = (i) => { const v = vals[i]; return typeof v === 'bigint' ? v : BigInt(v); };
    for (;;) {
      let c = rd(fa++, 1);
      if (c === 0) break;
      if (c !== 37) { o.push(c); continue; }
      let flags = '', width = -1, prec = -1, len = '';
      c = rd(fa++, 1);
      while (c === 45 || c === 48 || c === 43 || c === 32 || c === 35) { flags += String.fromCharCode(c); c = rd(fa++, 1); }
      const numArg = () => { if (ai >= vals.length) { warn(curLine, 'printf: the format string asks for more arguments than were passed', 'fmtargs'); return 0; } return Number(asI(32, big(ai++))); };
      if (c === 42) { width = numArg(); if (width < 0) { flags += '-'; width = -width; } c = rd(fa++, 1); } else if (c >= 48 && c <= 57) { width = 0; while (c >= 48 && c <= 57) { width = width * 10 + c - 48; c = rd(fa++, 1); } }
      if (c === 46) { prec = 0; c = rd(fa++, 1); if (c === 42) { prec = numArg(); c = rd(fa++, 1); } else while (c >= 48 && c <= 57) { prec = prec * 10 + c - 48; c = rd(fa++, 1); } }
      while (c === 104 || c === 108 || c === 122 || c === 106 || c === 116) { len += String.fromCharCode(c); c = rd(fa++, 1); }
      const ch = String.fromCharCode(c);
      if (c === 0) { o.push(37); break; }
      if (ch === '%') { o.push(37); continue; }
      let body, prefix = '';
      const have = ai < vals.length;
      if (!have && 'diuxXcsp'.includes(ch)) { warn(curLine, `printf: no argument was passed for '%${ch}'; real hardware would print whatever is on the stack`, 'fmtargs'); }
      const ty = have ? tys[ai] : T.int;
      const bits = len === 'll' || len === 'j' ? 64 : len === 'hh' ? 8 : len === 'h' ? 16 : 32;
      if ('diuxX'.includes(ch)) {
        if (have && isPtr(ty)) warn(curLine, `printf: '%${len}${ch}' expects an integer but argument ${ai + 1} is a pointer ('${typeStr(ty)}'); use %p or %s`, 'fmt' + ai);
        else if (have && (is64(ty) !== (bits === 64))) warn(curLine, `printf: '%${len}${ch}' expects a ${bits === 64 ? '64-bit (long long)' : '32-bit'} argument but argument ${ai + 1} is '${typeStr(ty)}'. On real hardware this prints garbage; use %${is64(ty) ? 'll' : ''}${ch}`, 'fmt' + ai);
        let v = have ? big(ai++) : 0n;
        if (ch === 'd' || ch === 'i') { v = asI(bits, v); if (v < 0n) { prefix = '-'; v = -v; } else if (flags.includes('+')) prefix = '+'; else if (flags.includes(' ')) prefix = ' '; body = v.toString(); }
        else { v = asU(bits, v); body = ch === 'u' ? v.toString() : v.toString(16); if (ch === 'X') body = body.toUpperCase(); if (flags.includes('#') && ch !== 'u' && v !== 0n) prefix = ch === 'X' ? '0X' : '0x'; }
        if (prec >= 0) body = prec === 0 && v === 0n ? '' : body.padStart(prec, '0');
        else if (flags.includes('0') && !flags.includes('-') && width > 0) body = body.padStart(width - prefix.length, '0');
        body = toBytes(prefix + body);
      } else if (ch === 'c') body = [have ? Number(asU(8, big(ai++))) : 0];
      else if (ch === 's') {
        if (have && !isPtr(ty)) warn(curLine, `printf: '%s' expects a char* but argument ${ai + 1} is '${typeStr(ty)}'. The value is used as an address`, 'fmt' + ai);
        const a = have ? Number(asU(32, big(ai++))) : 0;
        if (a === 0) body = toBytes('(null)');
        else { body = []; let q = a; for (;;) { if (prec >= 0 && body.length >= prec) break; const b = rd(q, 1); q = (q + 1) >>> 0; if (b === 0) break; body.push(b); if (body.length > 65536) fault('printf("%s"): the string has no terminating \\0'); } }
      } else if (ch === 'p') body = toBytes('0x' + (have ? Number(asU(32, big(ai++))) : 0).toString(16).padStart(8, '0'));
      else { warn(curLine, `printf: '%${ch}' is not supported on Bench-MCU${'feEgG'.includes(ch) ? ' (no floating point)' : ''}`, 'fmtconv'); body = toBytes('%' + ch); }
      const pad = width - body.length;
      if (pad > 0 && !flags.includes('-')) for (let i = 0; i < pad; i++) o.push(32);
      for (let i = 0; i < body.length; i++) o.push(body[i]);
      if (pad > 0 && flags.includes('-')) for (let i = 0; i < pad; i++) o.push(32);
    }
    if (ai < vals.length) warn(curLine, `printf: ${vals.length - ai} argument${vals.length - ai === 1 ? ' was' : 's were'} passed but not used by the format string`, 'fmtextra');
    return o;
  }
  function putStr(a, bytes) { for (let i = 0; i < bytes.length; i++) wr((a + i) >>> 0, 1, bytes[i]); }
  function malloc(n) {
    const size = Math.max(8, (n + 7) & ~7);
    for (let i = blocks.length - 1; i >= 0; i--) { const b = blocks[i]; if (b.free && b.cap === size) { b.free = false; b.size = n; b.line = curLine; return b.addr; } }
    const addr = heapTop + 8;
    if (n > MEM_SIZE || addr + size > sp - 256) return 0;
    heapTop = addr + size; heapLim = heapTop + 8;
    const o = addr - 8 - SRAM_BASE; sram[o] = size | 1; sram[o + 1] = size >> 8; sram[o + 2] = 0; sram[o + 3] = 0;
    blocks.push({ addr, size: n, cap: size, free: false, line: curLine, freeLine: 0 });
    return addr;
  }
  let seed = 1;
  const cmpBytes = (a, b, n, str) => { for (let i = 0; i < n; i++) { const x = rd((a + i) >>> 0, 1), y = rd((b + i) >>> 0, 1); if (x !== y) return x < y ? -1 : 1; if (str && x === 0) return 0; } return 0; };
  const NATIVES = {
    printf: (v, t) => { const b = format(v[0], v, t, 1); emit(b); return b.length; },
    sprintf: (v, t) => { const b = format(v[1], v, t, 2); putStr(v[0], b.concat([0])); return b.length; },
    snprintf: (v, t) => { const b = format(v[2], v, t, 3); if (v[1] > 0) putStr(v[0], b.slice(0, v[1] - 1).concat([0])); return b.length; },
    putchar: (v) => { emit([v[0] & 0xFF]); return v[0] & 0xFF; },
    puts: (v) => { emit(cstr(v[0], 'puts')); emit([10]); return 0; },
    getchar: () => (stdinPos < stdin.length ? stdin[stdinPos++] : -1),
    gets: (v) => { if (stdinPos >= stdin.length) return 0; let a = v[0]; while (stdinPos < stdin.length) { const c = stdin[stdinPos++]; if (c === 10) break; wr(a, 1, c); a = (a + 1) >>> 0; } wr(a, 1, 0); return v[0]; },
    fgets: (v) => { if (stdinPos >= stdin.length || v[1] <= 0) return 0; let a = v[0], n = 0; while (n < v[1] - 1 && stdinPos < stdin.length) { const c = stdin[stdinPos++]; wr(a, 1, c); a = (a + 1) >>> 0; n++; if (c === 10) break; } wr(a, 1, 0); return v[0]; },
    memcpy: (v) => { for (let i = 0; i < v[2]; i++) wr((v[0] + i) >>> 0, 1, rd((v[1] + i) >>> 0, 1)); return v[0]; },
    memmove: (v) => { const b = []; for (let i = 0; i < v[2]; i++) b.push(rd((v[1] + i) >>> 0, 1)); putStr(v[0], b); return v[0]; },
    memset: (v) => { for (let i = 0; i < v[2]; i++) wr((v[0] + i) >>> 0, 1, v[1] & 0xFF); return v[0]; },
    memcmp: (v) => cmpBytes(v[0], v[1], v[2], false),
    memchr: (v) => { for (let i = 0; i < v[2]; i++) if (rd((v[0] + i) >>> 0, 1) === (v[1] & 0xFF)) return (v[0] + i) >>> 0; return 0; },
    strlen: (v) => cstr(v[0], 'strlen').length,
    strcpy: (v) => { if (!v[1]) fault('strcpy was given a NULL source'); for (let i = 0; ; i++) { const c = rd((v[1] + i) >>> 0, 1); wr((v[0] + i) >>> 0, 1, c); if (c === 0) break; if (i > 70000) fault('strcpy: the source string has no terminating \\0'); } return v[0]; },
    strncpy: (v) => { let end = false; for (let i = 0; i < v[2]; i++) { const c = end ? 0 : rd((v[1] + i) >>> 0, 1); if (c === 0) end = true; wr((v[0] + i) >>> 0, 1, c); } return v[0]; },
    strcmp: (v) => { if (!v[0] || !v[1]) fault('strcmp was given a NULL pointer'); return cmpBytes(v[0], v[1], 0x7fffffff, true); },
    strncmp: (v) => cmpBytes(v[0], v[1], v[2], true),
    strcat: (v) => { const n = cstr(v[0], 'strcat').length; putStr((v[0] + n) >>> 0, cstr(v[1], 'strcat').concat([0])); return v[0]; },
    strncat: (v) => { const n = cstr(v[0], 'strncat').length; putStr((v[0] + n) >>> 0, cstr(v[1], 'strncat').slice(0, v[2]).concat([0])); return v[0]; },
    strchr: (v) => { for (let a = v[0]; ; a = (a + 1) >>> 0) { const c = rd(a, 1); if (c === (v[1] & 0xFF)) return a; if (c === 0) return 0; } },
    strrchr: (v) => { const s = cstr(v[0], 'strrchr'); s.push(0); const i = s.lastIndexOf(v[1] & 0xFF); return i < 0 ? 0 : (v[0] + i) >>> 0; },
    strstr: (v) => { const h = bytesRaw(cstr(v[0], 'strstr')), n = bytesRaw(cstr(v[1], 'strstr')); const i = h.indexOf(n); return i < 0 ? 0 : (v[0] + i) >>> 0; },
    malloc: (v) => malloc(v[0]),
    calloc: (v) => { const n = Math.imul(v[0], v[1]) >>> 0, a = malloc(n); if (a) sram.fill(0, a - SRAM_BASE, a - SRAM_BASE + n); return a; },
    free: (v) => {
      if (v[0] === 0) return;
      const b = blocks.find((x) => x.addr === v[0]);
      if (!b) fault(`free(${hex8(v[0])}): that address was not returned by malloc`);
      if (b.free) fault(`double free: the block at ${hex8(v[0])} was already freed on line ${b.freeLine}`);
      b.free = true; b.freeLine = curLine;
    },
    abs: (v) => (v[0] === -2147483648 ? ovf(curLine, 0, '-', v[0], v[0]) : Math.abs(v[0])),
    labs: (v) => Math.abs(v[0]) | 0,
    atoi: (v) => { const m = /^\s*([+-]?\d+)/.exec(bytesRaw(cstr(v[0], 'atoi'))); return m ? Number(asI(32, BigInt(m[1]))) : 0; },
    rand: () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) & 0x7FFF; },
    srand: (v) => { seed = v[0] >>> 0; },
    exit: (v) => { throw new Halt('exit', null, v[0]); },
    abort: () => fault('abort() was called'),
    isdigit: (v) => (v[0] >= 48 && v[0] <= 57 ? 1 : 0),
    isalpha: (v) => ((v[0] | 32) >= 97 && (v[0] | 32) <= 122 ? 1 : 0),
    isalnum: (v) => ((v[0] >= 48 && v[0] <= 57) || ((v[0] | 32) >= 97 && (v[0] | 32) <= 122) ? 1 : 0),
    isspace: (v) => (v[0] === 32 || (v[0] >= 9 && v[0] <= 13) ? 1 : 0),
    isupper: (v) => (v[0] >= 65 && v[0] <= 90 ? 1 : 0),
    islower: (v) => (v[0] >= 97 && v[0] <= 122 ? 1 : 0),
    isxdigit: (v) => ((v[0] >= 48 && v[0] <= 57) || ((v[0] | 32) >= 97 && (v[0] | 32) <= 102) ? 1 : 0),
    isprint: (v) => (v[0] >= 32 && v[0] < 127 ? 1 : 0),
    toupper: (v) => (v[0] >= 97 && v[0] <= 122 ? v[0] - 32 : v[0]),
    tolower: (v) => (v[0] >= 65 && v[0] <= 90 ? v[0] + 32 : v[0]),
    irq_attach: (v) => { if (v[0] !== 0 && v[0] !== 1) fault(`irq_attach: there is no interrupt ${v[0]} (IRQ_UART_RX is 0, IRQ_TIMER is 1)`); const f = fnAt(v[1]); if (f.native) fault('irq_attach: a library function cannot be an interrupt handler'); handlers[v[0]] = f; },
    irq_enable: () => { irqOn = true; },
    irq_disable: () => { irqOn = false; },
    __assert_fail: (v) => fault(`assertion failed: ${bytesToStr(cstr(v[0]))}`),
  };
  const bytesRaw = (b) => String.fromCharCode(...b);

  // ------------------------------------------------ compile + link
  topLevel();
  const mainFn = functions.find((f) => f.name === 'main' && f.body);
  if (!opts.declsOnly && !mainFn) err('there is no main() function; execution starts at main', lastLine);
  const align = (v, a) => Math.ceil(v / a) * a;
  {
    let a = CODE_BASE;
    for (const f of functions) {
      if (f.native) continue;
      f.addr = a; f.size = align(8 + 4 * f.sites, 16);
      if (a + f.size > LIB_BASE) err('the program has too much code for the 64 KiB flash', f.line);
      for (let i = 0; i < f.size; i += 2) { flash[a - FLASH_BASE + i] = 0x00; flash[a - FLASH_BASE + i + 1] = 0xBF; }
      fnByAddr.set(a, f); a += f.size;
    }
    let l = LIB_BASE;
    for (const f of functions) if (f.native) { f.addr = l; f.size = 8; fnByAddr.set(l, f); l += 8; }
    for (const g of globals) if (isConstType(g.ty)) { g.section = 'rodata'; a = align(a, alignOf(g.ty)); g.addr = a; g.size = sizeOf(g.ty, g.line); a += g.size; }
    for (const s of strings.values()) { s.addr = a; a += s.bytes.length + 1; }
    if (a > LIB_BASE) err('the constant data does not fit in the 64 KiB flash', lastLine);
    let d = SRAM_BASE;
    for (const sec of ['data', 'bss']) for (const g of globals) {
      if (isConstType(g.ty) || (sec === 'data') !== !!g.init) continue;
      g.section = sec; d = align(d, alignOf(g.ty)); g.addr = d; g.size = sizeOf(g.ty, g.line); d += g.size;
    }
    if (d > STACK_TOP - 1024) err('the global variables do not fit in the 64 KiB SRAM (leave room for the stack)', lastLine);
    heapBase = heapTop = align(d, 8);
    loading = true;
    for (const s of strings.values()) { putStr(s.addr, s.bytes); wr(s.addr + s.bytes.length, 1, 0); }
    try { for (const g of globals) if (g.init) { curLine = g.line; g.init.run(g.addr); } }
    catch (e) { if (e instanceof Halt) throw new CError(curLine, `the initialiser of a global must be a constant (${e.msg || 'it cannot be computed before main runs'})`); throw e; }
    loading = false;
    for (const f of functions) {
      if (f.isr == null || !f.body) continue;
      if (typeof f.isr === 'number') { if (f.isr !== 0 && f.isr !== 1) err(`interrupt(${f.isr}): there is no such interrupt (IRQ_UART_RX is 0, IRQ_TIMER is 1)`, f.line); handlers[f.isr] = f; }
      else if (/uart|rx|serial/i.test(f.name)) handlers[0] = f;
      else if (/tim|tick|systick/i.test(f.name)) handlers[1] = f;
      else { if (!handlers[0]) handlers[0] = f; if (!handlers[1]) handlers[1] = f; }
    }
  }

  // ------------------------------------------------ inspection helpers
  const symName = (a) => { const f = fnByAddr.get(a); if (f) return f.name; const g = globals.find((x) => x.addr === a); return g ? g.name : REG_NAME.get(a) || null; };
  function fmtValue(ty, a, depth = 0) {
    const n = ty.k === 'arr' || ty.k === 'struct' ? 0 : ty.k === 'ptr' ? 4 : ty.size;
    switch (ty.k) {
      case 'int': {
        const raw = readMem(a, n);
        if (raw == null) return '<unmapped>';
        const u = BigInt(raw), v = ty.signed ? asI(n * 8, u) : u;
        if (ty.bool) return u ? 'true' : 'false';
        if (n === 1 && u >= 32n && u < 127n) return `${v} '${String.fromCharCode(Number(u))}'`;
        return `${v}${u > 9n ? ` (0x${u.toString(16).toUpperCase()})` : ''}`;
      }
      case 'ptr': { const v = readMem(a, 4); if (v == null) return '<unmapped>'; const s = v ? symName(v) : null; return v === 0 ? 'NULL' : hex8(v) + (s ? ` <${s}>` : ''); }
      case 'arr': {
        const es = sizeOf(ty.of), cnt = ty.n || 0;
        if (ty.of.k === 'int' && ty.of.size === 1) {
          let s = '"';
          for (let i = 0; i < Math.min(cnt, 48); i++) { const c = peek8(a + i); if (c == null) break; s += c >= 32 && c < 127 && c !== 34 && c !== 92 ? String.fromCharCode(c) : c === 0 ? '\\0' : '\\x' + c.toString(16).padStart(2, '0'); }
          return s + (cnt > 48 ? '…' : '') + '"';
        }
        if (depth > 1) return '[…]';
        const parts = [];
        for (let i = 0; i < Math.min(cnt, 16); i++) parts.push(fmtValue(ty.of, a + i * es, depth + 1));
        return `[${parts.join(', ')}${cnt > 16 ? ', …' : ''}]`;
      }
      case 'struct': if (depth > 1) return '{…}'; return `{ ${ty.def.fields.map((f) => `${f.name || ''}${f.name ? ': ' : ''}${fmtValue(f.ty, a + f.off, depth + 1)}`).join(', ')} }`;
      default: return '';
    }
  }
  const describe = (name, ty, addr) => ({ name, addr, size: sizeOf(ty), type: typeStr(ty), decl: typeStr(ty, name), value: fmtValue(ty, addr) });
  function snapshotFrames() {
    return frames.map((fr, i) => ({
      func: fr.fn.name, fp: fr.fp, sp: i + 1 < frames.length ? frames[i + 1].fp + 8 + frames[i + 1].fn.argSize : sp, hijacked: !!fr.hijacked,
      savedFp: readMem(fr.fp, 4), retAddr: readMem(fr.fp + 4, 4), retSym: symName((readMem(fr.fp + 4, 4) || 0) & ~0xF) || (readMem(fr.fp + 4, 4) === START_RET ? '_start' : readMem(fr.fp + 4, 4) === IRQ_RET ? 'interrupt return' : null),
      params: fr.fn.params.map((q) => describe(q.name, q.ty, fr.fp + q.off)),
      locals: fr.fn.locals.map((q) => describe(q.name, q.ty, fr.fp + q.off)),
    })).reverse();
  }
  function regs() { const r = {}; for (const [name, a] of Object.entries(REGISTERS)) r[name] = regPeek(a) >>> 0; return r; }
  function symbol(name) {
    const g = globals.find((x) => x.name === name) ;
    if (g) return { addr: g.addr, size: g.size, type: typeStr(g.ty), section: g.section };
    const f = functions.find((x) => x.name === name);
    if (f) return { addr: f.addr, size: f.size, type: typeStr(f.ty), section: 'text' };
    if (REGISTERS[name] != null) return { addr: REGISTERS[name], size: 4, type: 'volatile uint32_t', section: 'peripheral' };
    return null;
  }

  // ------------------------------------------------ execution
  function exec(o = {}) {
    stdin = toBytes(o.stdin); stdinPos = 0;
    if (o.maxSteps) maxSteps = o.maxSteps;
    if (o.ticks != null && o.ticks > 0) { stopAt = Math.floor(o.ticks); if (stopAt >= maxSteps) maxSteps = stopAt + 1; }
    if (o.breakLine) breakLine = o.breakLine;
    const gp = (v) => (typeof v === 'number' ? { value: v & 0xFFFF, mask: 0xFFFF } : { value: (v.value || 0) & 0xFFFF, mask: (v.mask == null ? 0xFFFF : v.mask) & 0xFFFF });
    if (Array.isArray(o.gpioIn)) { gpioSched = o.gpioIn.map(([t, v]) => ({ t, ...gp(v) })).sort((a, b) => a.t - b.t); if (!gpioSched.length || gpioSched[0].t > 0) gpioSched.unshift({ t: 0, value: 0, mask: 0 }); }
    else if (o.gpioIn != null) gpioSched = [{ t: 0, ...gp(o.gpioIn) }];
    if (o.uartRx != null) {
      const rx = o.uartRx;
      if (Array.isArray(rx) && rx.length && Array.isArray(rx[0])) { for (const [t, s] of rx) toBytes(s).forEach((b, i) => rxSched.push({ t: t + i * UART_RX_INTERVAL, b })); rxSched.sort((a, b) => a.t - b.t); }
      else { const data = typeof rx === 'object' && !Array.isArray(rx) && rx.data != null ? rx : { data: rx }; const iv = data.interval || UART_RX_INTERVAL, st = data.start != null ? data.start : iv; rxSched = toBytes(data.data).map((b, i) => ({ t: st + i * iv, b })); }
    }
    if (Array.isArray(o.adc)) adcList = o.adc; else if (o.adc && typeof o.adc === 'object') adcByCh = { ...o.adc };
    let exit = null, stopped = 'exit', error = null;
    try {
      const r = callUser(mainFn, [0, 0], START_RET);
      exit = mainFn.ty.ret.k === 'void' ? 0 : Number(r) | 0;
      if (stopAt > 0) for (;;) tick(mainFn.endLine);
    } catch (e) {
      if (e instanceof Halt) {
        stopped = e.kind;
        if (e.kind === 'exit') exit = e.code | 0;
        else if (e.kind === 'fault') error = { line: curLine, msg: e.msg };
        else if (e.kind === 'limit') error = { line: curLine, msg: `stopped after ${maxSteps.toLocaleString('en-US')} steps — probably an infinite loop (it was at line ${curLine}). Firmware that is meant to run forever needs a tick budget ('ticks') instead` };
      } else if (e instanceof RangeError) { stopped = 'fault'; error = { line: curLine, msg: 'stack overflow: the recursion is too deep (does it have a base case?)' }; }
      else throw e;
    }
    if (stats.txDropped) warn(0, `UART: ${stats.txDropped} byte(s) were written while the UART was disabled and were dropped`);
    if (stats.txLost) warn(0, `UART: ${stats.txLost} byte(s) were written while TX_READY was low and were lost`);
    return result({ ok: !error, exit, stopped, errors: error ? [error] : [] });
  }
  function result(base) {
    return {
      ...base, stdout: bytesToStr(out), uartTx: bytesToStr(uartTx), warnings, steps, ticks: steps, regs: regs(), line: curLine,
      gpioTrace, irqCounts: { IRQ_UART_RX: irqCounts[0], IRQ_TIMER: irqCounts[1] }, hijacks: stats.hijacks, uart: { dropped: stats.txDropped, lost: stats.txLost, overruns: stats.rxOverrun },
      readMem, symbol, sp, fp,
      globals: globals.map((g) => ({ ...describe(g.name, g.ty, g.addr), section: g.section, func: g.fn })),
      functions: functions.filter((f) => !f.native && f.line > 0).map((f) => ({ name: f.name, addr: f.addr, size: f.size, line: f.line })),
      frames: snapshotFrames(),
      heap: { start: heapBase, top: heapTop, blocks: blocks.map((b) => ({ addr: b.addr, size: b.size, free: b.free })) },
      hexdump(addr, len = 64) { const rows = []; addr = (addr & ~15) >>> 0; for (let a = addr; a < addr + len; a += 16) { const bytes = []; for (let i = 0; i < 16; i++) bytes.push(peek8(a + i)); rows.push({ addr: a, bytes }); } return rows; },
    };
  }
  return { exec, structDefs, warnings, result };
}

const KEYWORDS = new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'goto', 'sizeof', 'typedef', 'struct', 'union', 'enum', 'static', 'const', 'volatile', 'extern', 'inline', 'register', 'void', 'char', 'short', 'int', 'long', 'signed', 'unsigned', 'float', 'double', '_Bool', 'auto', 'restrict', '__attribute__', '_Static_assert', '_Alignof']);

function emptyResult(errors) {
  const regs = {}; for (const k of Object.keys(REGISTERS)) regs[k] = 0;
  return { ok: false, stdout: '', uartTx: '', exit: null, stopped: 'compile', errors, warnings: [], steps: 0, ticks: 0, regs, line: errors[0] ? errors[0].line : 0, gpioTrace: [], irqCounts: { IRQ_UART_RX: 0, IRQ_TIMER: 0 }, hijacks: [], uart: { dropped: 0, lost: 0, overruns: 0 },
    readMem: () => null, symbol: () => null, sp: STACK_TOP, fp: STACK_TOP, globals: [], functions: [], frames: [], heap: { start: SRAM_BASE, top: SRAM_BASE, blocks: [] }, hexdump: () => [] };
}

/**
 * Compile and run a C program on Bench-MCU.
 * opts: { stdin, gpioIn, uartRx, adc, maxSteps, ticks, breakLine }
 *   gpioIn: number (all 16 pins driven) | {value, mask} (mask = driven pins) | [[tick, number|{value,mask}], ...]
 *   uartRx: string/bytes (one byte every UART_RX_INTERVAL ticks) | {data, interval, start} | [[tick, string], ...]
 *   adc:    [samples in order] | { channel: [samples] }
 *   ticks:  run for exactly this many ticks (firmware with an endless main loop), then stop without an error
 */
export function run(source, opts = {}) {
  let prog;
  try { prog = compile(String(source), {}); }
  catch (e) {
    if (e instanceof CError) return emptyResult([{ line: e.line, msg: e.message }]);
    if (e instanceof RangeError) return emptyResult([{ line: 0, msg: 'the program is nested too deeply to compile' }]);
    throw e;
  }
  return prog.exec(opts);
}

const show = (s) => JSON.stringify(s.length > 400 ? s.slice(0, 400) + '…' : s);
const hx = (n) => '0x' + (typeof n === 'bigint' ? n : (n >>> 0)).toString(16).toUpperCase();
function firstDiff(exp, got) {
  const e = exp.split('\n'), g = got.split('\n');
  for (let i = 0; i < Math.max(e.length, g.length); i++) if (e[i] !== g[i]) return `first difference on output line ${i + 1}: expected ${e[i] === undefined ? 'nothing more' : show(e[i])}, got ${g[i] === undefined ? 'nothing more' : show(g[i])}`;
  return '';
}
/**
 * Run one c-lab test. test: inputs { stdin, gpioIn, uartRx, adc, ticks, maxSteps } and expectations
 * { stdout, stdoutIncludes, exit, regs, uartTx, uartTxIncludes, mem, gpioTrace, fault }.
 * Returns { pass, message, result }.
 */
export function runTest(source, test = {}) {
  const r = run(source, { stdin: test.stdin, gpioIn: test.gpioIn, uartRx: test.uartRx, adc: test.adc, ticks: test.ticks, maxSteps: test.maxSteps });
  const fails = [];
  if (r.stopped === 'compile') return { pass: false, message: `does not compile — line ${r.errors[0].line}: ${r.errors[0].msg}`, result: r };
  const faulted = r.errors.length > 0;
  if (faulted && !test.fault) fails.push(`the program stopped with an error on line ${r.errors[0].line}: ${r.errors[0].msg}`);
  if (test.fault && !faulted) fails.push('expected the program to stop with a fault, but it finished normally');
  if (typeof test.fault === 'string' && faulted && !r.errors[0].msg.includes(test.fault)) fails.push(`expected a fault mentioning ${show(test.fault)}, got: ${r.errors[0].msg}`);
  const trimEnd = (s) => String(s).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (test.stdout != null) {
    const e = trimEnd(test.stdout), g = trimEnd(r.stdout);
    if (e !== g) fails.push(`expected output ${show(e)}, got ${show(g)}${e.includes('\n') || g.includes('\n') ? ' — ' + firstDiff(e, g) : ''}`);
  }
  if (test.stdoutIncludes != null) for (const s of [].concat(test.stdoutIncludes)) if (!r.stdout.includes(s)) fails.push(`expected the output to contain ${show(s)}, got ${show(r.stdout)}`);
  if (test.exit != null && r.exit !== test.exit) fails.push(`expected exit code ${test.exit}, got ${r.exit === null ? 'no exit (the program did not finish)' : r.exit}`);
  if (test.regs) for (const [name, want] of Object.entries(test.regs)) {
    if (!(name in r.regs)) { fails.push(`unknown register ${name} in test`); continue; }
    const mask = want && typeof want === 'object' ? (want.mask >>> 0) : 0xFFFFFFFF, val = (want && typeof want === 'object' ? want.value : want) >>> 0;
    const got = r.regs[name];
    if (((got & mask) >>> 0) !== ((val & mask) >>> 0)) fails.push(`expected ${name}${mask !== 0xFFFFFFFF ? ` & ${hx(mask)}` : ''} to be ${hx(val & mask)}, got ${hx(got & mask)}${mask !== 0xFFFFFFFF ? ` (whole register ${hx(got)})` : ''}`);
  }
  if (test.uartTx != null && r.uartTx !== test.uartTx) fails.push(`expected UART transmit ${show(test.uartTx)}, got ${show(r.uartTx)}`);
  if (test.uartTxIncludes != null) for (const s of [].concat(test.uartTxIncludes)) if (!r.uartTx.includes(s)) fails.push(`expected the UART output to contain ${show(s)}, got ${show(r.uartTx)}`);
  if (test.gpioTrace) {
    const mask = Array.isArray(test.gpioTrace) ? 0xFFFF : test.gpioTrace.mask, want = Array.isArray(test.gpioTrace) ? test.gpioTrace : test.gpioTrace.values;
    const got = []; for (const g of r.gpioTrace) { const v = g.value & mask; if (!got.length ? true : got[got.length - 1] !== v) got.push(v); }
    if (got.length !== want.length || got.some((v, i) => v !== (want[i] & mask))) fails.push(`expected GPIO_OUT to go through [${want.map(hx).join(', ')}], got [${got.slice(0, 40).map(hx).join(', ')}${got.length > 40 ? ', …' : ''}]`);
  }
  for (const m of test.mem || []) {
    const sym = m.sym != null ? r.symbol(m.sym) : null;
    if (m.sym != null && !sym) { fails.push(`the program has no global named '${m.sym}'`); continue; }
    const addr = sym ? sym.addr + (m.offset || 0) : m.addr >>> 0, where = m.sym != null ? `'${m.sym}'` : hx(addr);
    const cmp = (a, size, want, label) => {
      const got = r.readMem(a, size);
      if (got == null) { fails.push(`${label} at ${hx(a)} is not mapped memory`); return; }
      const w = BigInt.asUintN(size * 8, BigInt(want));
      if (BigInt(got) !== w) fails.push(`expected ${label} to be ${want}${w > 9n ? ` (${hx(w)})` : ''}, got ${BigInt(got)}${BigInt(got) > 9n ? ` (${hx(BigInt(got))})` : ''}`);
    };
    if (typeof m.value === 'string') { const want = toBytes(m.value), got = []; for (let i = 0; i < want.length; i++) got.push(r.readMem(addr + i, 1)); if (got.some((b, i) => b !== want[i])) fails.push(`expected ${where} to hold ${show(m.value)}, got ${show(bytesToStr(got.map((b) => b || 0)))}`); }
    else if (Array.isArray(m.value)) { const size = m.size || 1; m.value.forEach((v, i) => cmp(addr + i * size, size, v, `${where}[${i}]`)); }
    else cmp(addr, m.size || (sym ? Math.min(sym.size, 8) : 4), m.value, where);
  }
  if (!fails.length) return { pass: true, message: 'ok', result: r };
  const notes = r.warnings.filter((w) => /UART|ADC|IRQ|overwritten|use after free|heap overflow|read-only|write-only/.test(w.msg)).slice(0, 4).map((w) => (w.line ? `line ${w.line}: ` : '') + w.msg);
  return { pass: false, message: fails.join('; ') + (notes.length ? ` [simulator notes: ${notes.join(' | ')}]` : ''), result: r };
}

/**
 * Struct/union layouts of every struct defined in `source` (declarations only; no main needed).
 * Returns { ok, error, structs: [{ name, kind, size, align, packed, fields: [{name, type, decl, offset, size, align}], padding: [{offset, size}] }] }
 */
export function layoutOf(source, { packed = false } = {}) {
  let prog;
  try { prog = compile(String(source), { declsOnly: true, forcePacked: packed }); }
  catch (e) { if (e instanceof CError) return { ok: false, error: { line: e.line, msg: e.message }, structs: [] }; throw e; }
  const structs = prog.structDefs.map((d) => {
    const fields = d.fields.map((f) => ({ name: f.name || '(anonymous)', type: typeStr(f.ty), decl: typeStr(f.ty, f.name || ''), offset: f.off, size: sizeOf(f.ty), align: d.packed ? 1 : alignOf(f.ty), line: f.line }));
    return { name: d.alias || d.name || '(anonymous)', kind: d.union ? 'union' : 'struct', size: d.size, align: d.align, packed: !!d.packed, line: d.line, fields, padding: d.union ? [] : paddingOf(fields, d.size) };
  });
  return { ok: true, error: null, structs };
}
/** Gaps between fields and at the tail: [{offset, size}] */
export function paddingOf(fields, size) {
  const pad = [];
  let at = 0;
  for (const f of [...fields].sort((a, b) => a.offset - b.offset)) { if (f.offset > at) pad.push({ offset: at, size: f.offset - at }); at = Math.max(at, f.offset + f.size); }
  if (size > at) pad.push({ offset: at, size: size - at });
  return pad;
}
