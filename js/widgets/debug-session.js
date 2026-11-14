// GDB + OpenOCD session against a simulated Cortex-M target.
// The programs are real compiled code (tools/fwimages), executed instruction by instruction by js/sim/armsim.js.
// The GDB front end below is a re-implementation of a subset of GDB's commands and output formats: a scripted
// stand-in for practising the workflow, not GDB itself.
import { h, clear } from '../core/dom.js';
import { ArmSim, SCB } from '../sim/armsim.js';
import { DEBUG_PROGRAMS, b64ToBytes, TOOLCHAIN } from '../sim/fwimages.js';

/* ------------------------------------------------------------------ helpers */

const hx = (n) => '0x' + (n >>> 0).toString(16);
const hx8 = (n) => '0x' + (n >>> 0).toString(16).padStart(8, '0');
const REG_NAMES = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'sp', 'lr', 'pc'];
const BASE_TYPES = {
  'unsigned int': [4, 0], int: [4, 1], 'unsigned char': [1, 0], char: [1, 0], 'signed char': [1, 1], short: [2, 1], 'unsigned short': [2, 0],
  long: [4, 1], 'unsigned long': [4, 0], uint8_t: [1, 0], uint16_t: [2, 0], uint32_t: [4, 0], int8_t: [1, 1], int16_t: [2, 1], int32_t: [4, 1], unsigned: [4, 0],
};
const CHARLIKE = new Set(['char', 'unsigned char', 'signed char', 'uint8_t', 'int8_t']);
const T_INT = { k: 'int', size: 4, signed: 1, name: 'int' };
const T_UINT = { k: 'int', size: 4, signed: 0, name: 'unsigned int' };
const T_LONG = { k: 'int', size: 4, signed: 1, name: 'long' };

class GdbError extends Error {}

/** gdb's rendering of a byte inside a string or character literal. */
function escChar(c, quote) {
  const named = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 27: '\\033', 92: '\\\\' };
  if (named[c]) return named[c];
  if (c === quote) return '\\' + String.fromCharCode(c);
  if (c >= 32 && c < 127) return String.fromCharCode(c);
  return '\\' + c.toString(8).padStart(3, '0');
}
/** gdb's rendering of a char array: quoted segments, runs longer than 9 collapsed, trailing NULs dropped. */
export function gdbString(bytes, stopAtNul = false) {
  let arr = [...bytes];
  if (stopAtNul) { const z = arr.indexOf(0); if (z >= 0) arr = arr.slice(0, z); }
  else if (arr.length && arr.every((b) => b === 0)) return arr.length > 9 ? `'\\000' <repeats ${arr.length - 1} times>` : '"' + '\\000'.repeat(arr.length - 1) + '"';
  else { // print elements up to the last non-NUL, as gdb does with "print null-stop off"
    let end = arr.length; while (end > 0 && arr[end - 1] === 0) end--;
    const tail = arr.length - end;
    if (tail > 9) { const head = gdbString(arr.slice(0, end), true); return `${head}, '\\000' <repeats ${tail - 1} times>`; }
    arr = arr.slice(0, Math.max(end, arr.length - 1)); // one terminating NUL is implied by the closing quote
    if (tail > 1) arr = [...bytes].slice(0, bytes.length - 1);
  }
  const parts = [];
  let cur = '';
  for (let i = 0; i < arr.length;) {
    let j = i; while (j < arr.length && arr[j] === arr[i]) j++;
    if (j - i > 9) { if (cur) { parts.push('"' + cur + '"'); cur = ''; } parts.push(`'${escChar(arr[i], 39)}' <repeats ${j - i} times>`); i = j; }
    else { cur += escChar(arr[i], 34); i++; }
  }
  if (cur || !parts.length) parts.push('"' + cur + '"');
  return parts.join(', ');
}

/* ------------------------------------------------------------------ the session */

export const SCENARIO_PROGRAM = { tour: 'tour', hardfault: 'hardfault', 'stuck-loop': 'stuck', 'bad-pointer': 'badptr' };

const HELP = `[sim] Commands this simulation understands (abbreviations as in GDB):
  target extended-remote :3333      connect to the OpenOCD GDB server
  monitor reset halt | halt | mdw <addr> [n] | mww <addr> <val>     passed to OpenOCD
  load                              write the ELF's loadable sections to flash
  break <func|line|file:line|*addr>, tbreak, delete [n], disable/enable n, info breakpoints
  watch <lvalue>                    stop when a variable or memory location changes
  continue, step, next, stepi, nexti, finish, until/advance <location>     (Ctrl-C interrupts a running target)
  bt, frame [n], up, down, info frame
  info registers [reg], info locals, info args, info symbol <addr>, info line [*addr|line]
  print[/xdutc] <expr>, set var <lvalue> = <expr>, whatis <expr>, x/<n><f><u> <addr>   (f: x d u t c s i, u: b h w)
  list [line|func|file:line|*addr], disassemble [func]
Expressions: variables, $pc $sp $lr $r0.., numbers, casts such as *(uint32_t *)0x40003004, {int}0x20000000, a[i], &x, *p, x@n.
Not modelled: threads, tbreak conditions, display, python, TUI, flash commands other than load.`;

export class GdbSession {
  constructor(scenario = 'tour') {
    this.scenario = SCENARIO_PROGRAM[scenario] ? scenario : 'tour';
    this.prog = DEBUG_PROGRAMS[SCENARIO_PROGRAM[this.scenario]];
    this.sim = new ArmSim();
    this.connected = false; this.loaded = false; this.running = false;
    this.bps = []; this.nextBp = 1; this.hist = []; this.sel = 0; this.flags = new Set();
    this.last = ''; this.listPos = null; this.xNext = null; this.xFmt = { n: 1, f: 'x', u: 4 };
    this.ocd = [
      '$ openocd -f interface/cmsis-dap.cfg -f target/bench_mcu.cfg',
      'Open On-Chip Debugger (simulated)',
      'Info : CMSIS-DAP: Interface ready',
      'Info : clock speed 1000 kHz',
      'Info : [bench.cpu] Cortex-M4 r0p1 processor detected',
      'Info : [bench.cpu] target has 6 breakpoints, 4 watchpoints',
      'Info : starting gdb server for bench.cpu on 3333',
      'Info : Listening on port 3333 for gdb connections',
    ];
    const p = this.prog;
    this.rows = p.lines.map(([addr, file, line, fl]) => ({ addr, file, line, stmt: fl & 1, pe: fl & 2, end: fl & 4 }));
    const st = this.rows.filter((r) => r.stmt || r.end || r.line === 0);
    this.stmtRows = st.filter((r, i) => !(st[i + 1] && st[i + 1].addr === r.addr));
    this.src = Object.fromEntries(Object.entries(p.sources).map(([f, t]) => [f, t.split('\n')]));
    this.mainFile = p.file;
    this.intro = `$ arm-none-eabi-gdb ${p.elfName}\nReading symbols from ${p.elfName}...`;
  }

  /* ---------- symbols, lines, types ---------- */
  funcAt(pc) { return this.prog.funcs.find((f) => pc >= f.lo && pc < f.hi) || null; }
  func(name) { return this.prog.funcs.find((f) => f.name === name) || null; }
  sym(addr) {
    addr >>>= 0;
    const f = this.funcAt(addr);
    if (f) return f.name + (addr > f.lo ? '+' + (addr - f.lo) : '');
    const o = this.prog.symbols.find((s) => s.kind === 'object' && addr >= s.addr && addr < s.addr + Math.max(s.size, 1));
    return o ? o.name + (addr > o.addr ? '+' + (addr - o.addr) : '') : null;
  }
  symTag(addr) { const s = this.sym(addr); return s ? ` <${s}>` : ''; }
  stmtAt(pc) {
    const rs = this.stmtRows;
    let i = -1;
    for (let k = 0; k < rs.length && rs[k].addr <= pc; k++) i = k;
    if (i < 0 || rs[i].end || rs[i].line === 0 || !rs[i + 1]) return null;
    return { file: rs[i].file, line: rs[i].line, start: rs[i].addr, end: rs[i + 1].addr };
  }
  srcLine(file, line) { const l = this.src[file]; return l && l[line - 1] !== undefined ? `${line}\t${l[line - 1]}` : `${line}\tin ${file}`; }
  afterPrologue(f) { const r = this.rows.find((x) => x.addr >= f.lo && x.addr < f.hi && x.pe); return r ? r.addr : f.lo; }
  parseType(text) {
    let t = text.replace(/\b(const|volatile)\b/g, '').replace(/\s+/g, ' ').trim().replace(/ \*/g, '*').replace(/\*/g, ' *').replace(/ +/g, ' ');
    const name = text.trim();
    let m = t.match(/^(.*)\[(\d+)\]$/);
    if (m) return { k: 'arr', of: this.parseType(m[1]), n: +m[2], name };
    if (/\(\s?\*\)/.test(t)) return { k: 'ptr', to: { k: 'func', name: 'void ()' }, name };
    if (t.endsWith('*')) return { k: 'ptr', to: this.parseType(t.slice(0, -1)), name };
    if (t === 'void') return { k: 'void', name: 'void', size: 1 };
    if (BASE_TYPES[t]) return { k: 'int', size: BASE_TYPES[t][0], signed: BASE_TYPES[t][1], char: CHARLIKE.has(t), name };
    if (this.prog.typedefs[t]) { const u = this.parseType(this.prog.typedefs[t]); return { ...u, name }; }
    throw new GdbError(`No symbol "${t}" in current context.`);
  }
  sizeOf(t) { return t.k === 'arr' ? t.n * this.sizeOf(t.of) : t.k === 'ptr' ? 4 : t.k === 'func' ? 1 : t.size; }

  /* ---------- memory ---------- */
  mem(addr, size) {
    const v = this.sim.peek(addr >>> 0, size);
    if (v === undefined) throw new GdbError(`Cannot access memory at address ${hx(addr)}`);
    return v;
  }
  bytes(addr, n) { const out = []; for (let i = 0; i < n; i++) out.push(this.mem(addr + i, 1)); return out; }
  cstring(addr, max = 200) { const out = []; for (let i = 0; i < max; i++) { const b = this.mem(addr + i, 1); if (!b) break; out.push(b); } return out; }

  /* ---------- frames ---------- */
  frames() {
    if (this._frames) return this._frames;
    const s = this.sim, out = [];
    let pc = s.r[15], sp = s.r[13], r7 = s.r[7], lr = s.r[14];
    const p16 = (a) => s.peek(a, 2) ?? 0;
    for (let level = 0; level < 16; level++) {
      const f = this.funcAt(pc);
      out.push({ pc, sp, func: f, inner: out.length === 0 });
      if (!f) break;
      const i0 = p16(f.lo);
      const isPush = (i0 & 0xff00) === 0xb500;
      let n = 0; for (let b = 0; b < 9; b++) if (i0 & (1 << b)) n++;
      let ret, cfa, r7c = r7;
      try {
        if (isPush) {
          if (pc === f.lo) { if (lr === undefined) break; ret = lr; cfa = sp; }
          else if (pc === f.lo + 2) { cfa = sp + 4 * n; ret = this.mem(cfa - 4, 4); r7c = this.mem(cfa - 8, 4); }
          else { cfa = r7 + 8; ret = this.mem(r7 + 4, 4); r7c = this.mem(r7, 4); }
        } else {
          if (lr === undefined) break;
          const sub = (i0 & 0xff80) === 0xb080 ? (i0 & 0x7f) * 4 : 0;
          ret = lr; cfa = sp + (pc > f.lo && p16(pc) !== 0x4770 ? sub : 0);
        }
        if (ret === 0xffffffff) break;
        if (ret >>> 28 === 0xf) { // EXC_RETURN: the caller is an exception frame on the stack
          out.push({ sig: true, cfa });
          pc = this.mem(cfa + 24, 4) & ~1; lr = this.mem(cfa + 20, 4);
          sp = cfa + 32 + ((this.mem(cfa + 28, 4) >>> 9) & 1) * 4; r7 = r7c;
          out[out.length - 1].frame = cfa;
          continue;
        }
      } catch (e) { break; }
      pc = (ret & ~1) >>> 0; sp = cfa >>> 0; r7 = r7c; lr = undefined;
    }
    this._frames = out;
    return out;
  }
  frame() { const fr = this.frames(); return fr[Math.min(this.sel, fr.length - 1)]; }
  /** Line lookup for a frame: outer frames hold a return address, so look up the instruction before it. */
  frameLine(fr) { return fr.sig ? null : this.stmtAt(fr.inner ? fr.pc : fr.pc - 1); }
  varsOf(fr, params) {
    if (!fr.func) return [];
    const at = fr.inner ? fr.pc : fr.pc - 1;
    return fr.func.vars.filter((v) => v.param === params && at >= v.lo && at < v.hi);
  }
  localValue(fr, v) { const t = this.parseType(v.type); return this.load(t, (fr.sp + v.sp) >>> 0); }
  describe(fr, level) {
    const tag = level === undefined ? '' : `#${String(level).padEnd(3)}`;
    if (fr.sig) return `${tag}<signal handler called>`;
    if (!fr.func) return `${tag}${hx8(fr.pc)} in ?? ()`;
    const ln = this.frameLine(fr);
    const args = this.varsOf(fr, true).map((v) => { let t; try { t = this.fmt(this.localValue(fr, v), null, false); } catch (e) { t = '<error>'; } return `${v.name}=${t}`; }).join(', ');
    const mid = !ln || (fr.inner ? fr.pc !== ln.start : true);
    return `${tag}${mid && (level === undefined || level > 0 || (ln && fr.pc !== ln.start) || !ln) ? hx8(fr.pc) + ' in ' : ''}${fr.func.name} (${args})${ln ? ` at src/${ln.file}:${ln.line}` : ''}`;
  }
  /** What gdb prints when the target stops: frame line (if the function changed) and the source line. */
  where(prevFunc) {
    this._frames = null; this.sel = 0;
    const fr = this.frames()[0];
    const ln = this.frameLine(fr);
    if (!fr.func) return this.describe(fr);
    const lines = [];
    const mid = ln && fr.pc !== ln.start;
    if (fr.func !== prevFunc) lines.push(this.describe(fr));
    if (ln) { lines.push((mid && fr.func === prevFunc ? hx8(fr.pc) + '\t' : '') + this.srcLine(ln.file, ln.line)); this.listPos = { file: ln.file, line: ln.line, centre: true }; }
    return lines.join('\n');
  }
  ocdHalt(reason) {
    const s = this.sim;
    this.ocd.push(`target halted due to ${reason}, current mode: ${s.ipsr === 3 ? 'Handler HardFault' : 'Thread'}`, `xPSR: ${hx8(s.xpsr)} pc: ${hx8(s.r[15])} msp: ${hx8(s.r[13])}`);
  }

  /* ---------- values and expressions ---------- */
  load(t, addr) {
    if (t.k === 'arr' || t.k === 'func') return { t, addr };
    if (t.k === 'void') throw new GdbError('Attempt to take contents of a non-pointer value.');
    let v = this.mem(addr, t.k === 'ptr' ? 4 : t.size);
    if (t.k === 'int' && t.signed) { const sh = 32 - 8 * t.size; v = (v << sh) >> sh; }
    return { t, v, addr };
  }
  rval(x) {
    if (x.t.k === 'arr') return { t: { k: 'ptr', to: x.t.of, name: x.t.of.name + ' *' }, v: x.addr };
    if (x.t.k === 'func') return { t: { k: 'ptr', to: x.t, name: 'void (*)()' }, v: x.addr };
    return x;
  }
  store(lv, value) {
    if (lv.reg !== undefined) {
      if (lv.reg === 16) this.sim.xpsr = value >>> 0; else this.sim.r[lv.reg] = lv.reg === 15 ? value & ~1 : value;
      this._frames = null; return;
    }
    if (lv.addr === undefined || lv.t.k === 'arr') throw new GdbError('Left operand of assignment is not an lvalue.');
    const size = lv.t.k === 'ptr' ? 4 : lv.t.size;
    if (!this.sim.poke(lv.addr, size, value >>> 0)) {
      if (this.sim.region(lv.addr)) throw new GdbError(`[sim] ${hx(lv.addr)} is flash. Writing a RAM value does not change it; a real GDB would need a flash write through the probe.`);
      throw new GdbError(`Cannot access memory at address ${hx(lv.addr)}`);
    }
  }
  fmt(x, f, top = true) {
    const t = x.t;
    if (t.k === 'arr') {
      const size = this.sizeOf(t.of);
      if (!f && t.of.k === 'int' && t.of.char) return gdbString(this.bytes(x.addr, t.n));
      const items = [];
      for (let i = 0; i < t.n; i++) items.push(this.fmt(this.load(t.of, x.addr + i * size), f, false));
      const out = [];
      for (let i = 0; i < items.length;) { let j = i; while (j < items.length && items[j] === items[i]) j++; if (j - i > 9) out.push(`${items[i]} <repeats ${j - i} times>`); else for (let k = i; k < j; k++) out.push(items[k]); i = j; }
      return `{${out.join(', ')}}`;
    }
    if (t.k === 'func') return `{${t.name}} ${hx(x.addr)}${this.symTag(x.addr)}`;
    const v = x.v;
    if (f === 'x') return hx(v);
    if (f === 'd') return String(v | 0);
    if (f === 'u') return String(v >>> 0);
    if (f === 't') return (v >>> 0).toString(2);
    if (f === 'c') return `${v & 0xff} '${escChar(v & 0xff, 39)}'`;
    if (f === 'a') return hx(v) + this.symTag(v);
    if (t.k === 'ptr') {
      const u = v >>> 0;
      if (t.to.k === 'func') return `${top ? `(${t.name}) ` : ''}${hx(u)}${this.symTag(u)}`;
      if (t.to.k === 'int' && t.to.char) { let str = ''; try { str = ' ' + gdbString(this.cstring(u), true); } catch (e) { str = ''; } return `${hx(u)}${this.symTag(u)}${str}`; }
      return `${top ? `(${t.name}) ` : ''}${hx(u)}${this.symTag(u)}`;
    }
    if (t.char) return `${v} '${escChar(v & 0xff, 39)}'`;
    return String(t.signed ? v | 0 : v >>> 0);
  }

  tokens(text) {
    const out = [];
    const re = /\s*(0x[0-9a-fA-F]+|\d+|\$[A-Za-z_]\w*|\$\$?\d*|[A-Za-z_]\w*|<<|>>|==|!=|<=|>=|&&|\|\||->|[-+*\/%&|^~!<>=()[\]{}@.,])/y;
    let pos = 0;
    while (pos < text.length) {
      if (/^\s*$/.test(text.slice(pos))) break;
      re.lastIndex = pos;
      const m = re.exec(text);
      if (!m) throw new GdbError(`Invalid character '${text.slice(pos).trim()[0]}' in expression.`);
      out.push(m[1]); pos = re.lastIndex;
    }
    return out;
  }
  isTypeWord(w) { return w !== undefined && (w in BASE_TYPES || w in this.prog.typedefs || ['void', 'const', 'volatile', 'signed'].includes(w)); }
  /** Evaluate a C-like expression in the selected frame. */
  eval(text) {
    const tk = this.tokens(text);
    if (!tk.length) throw new GdbError('Argument required (expression to compute).');
    let i = 0;
    const peek = () => tk[i], take = () => tk[i++];
    const expect = (c) => { if (take() !== c) throw new GdbError('A syntax error in expression, near `' + tk.slice(i - 1).join(' ') + "'."); };
    const num = (x) => { const r = this.rval(x); if (r.v === undefined) throw new GdbError('Attempt to use a non-scalar value in arithmetic.'); return r; };
    const arith = (a, b, v) => ({ t: (a.t.k === 'int' && !a.t.signed && a.t.size === 4) || (b.t.k === 'int' && !b.t.signed && b.t.size === 4) ? T_UINT : T_INT, v });
    const typeName = () => {
      const words = [];
      while (this.isTypeWord(peek())) words.push(take());
      let t = words.join(' ');
      while (peek() === '*') { take(); t += ' *'; }
      if (peek() === '(' && tk[i + 1] === '*' && tk[i + 2] === ')') { i += 3; if (peek() === '(') { while (take() !== ')') { /* skip parameter list */ } } t = 'void (*)()'; }
      return this.parseType(t);
    };
    const primary = () => {
      const t = take();
      if (t === undefined) throw new GdbError('A syntax error in expression, near `\'.');
      if (t === '(') { const v = assign(); expect(')'); return v; }
      if (t === '{') { const ty = typeName(); expect('}'); const a = num(unary()); return this.load(ty, a.v >>> 0); }
      if (/^(0x[0-9a-fA-F]+|\d+)$/.test(t)) { const v = Number(t); return { t: v > 0x7fffffff ? T_UINT : T_INT, v }; }
      if (t[0] === '$') {
        const name = t.slice(1).toLowerCase();
        if (name === '' || /^\$?\d*$/.test(name)) {
          const idx = name === '' ? this.hist.length : name === '$' ? this.hist.length - 1 : name[0] === '$' ? this.hist.length - +name.slice(1) : +name;
          if (!this.hist.length || idx < 1 || idx > this.hist.length) throw new GdbError(this.hist.length ? `History has not yet reached $${idx}.` : 'History is empty.');
          return this.hist[idx - 1];
        }
        const alias = { fp: 7, cpsr: 16, xpsr: 16, r13: 13, r14: 14, r15: 15, msp: 13 };
        const r = name in alias ? alias[name] : REG_NAMES.indexOf(name);
        if (r < 0) return { t: { k: 'void', name: 'void' }, v: undefined, voidval: true };
        this.needTarget();
        const fr = this.frame();
        const v = r === 16 ? this.sim.xpsr : this.sel > 0 && r === 15 ? fr.pc : this.sel > 0 && r === 13 ? fr.sp : this.sim.r[r];
        const ty = r === 15 ? { k: 'ptr', to: { k: 'func', name: 'void ()' }, name: 'void (*)()' } : r === 13 ? { k: 'ptr', to: { k: 'void', name: 'void' }, name: 'void *' } : T_LONG;
        return { t: ty, v: ty === T_LONG ? v | 0 : v, reg: r };
      }
      if (/^[A-Za-z_]/.test(t)) {
        if (t === 'sizeof') { const paren = peek() === '('; if (paren && this.isTypeWord(tk[i + 1])) { take(); const ty = typeName(); expect(')'); return { t: T_UINT, v: this.sizeOf(ty) }; } const v = unary(); return { t: T_UINT, v: this.sizeOf(v.t) }; }
        if (this.connected) {
          const fr = this.frame();
          if (fr && fr.func) { const lv = [...this.varsOf(fr, false), ...this.varsOf(fr, true)].find((v) => v.name === t); if (lv) return this.localValue(fr, lv); }
        }
        const g = this.prog.globals.find((v) => v.name === t);
        if (g) { this.needTarget(); return this.load(this.parseType(g.type), g.addr); }
        const f = this.func(t);
        if (f) return { t: { k: 'func', name: `${f.ret} (${f.vars.filter((v) => v.param).map((v) => v.type).join(', ') || 'void'})` }, addr: f.lo };
        throw new GdbError(`No symbol "${t}" in current context.`);
      }
      throw new GdbError('A syntax error in expression, near `' + tk.slice(i - 1).join(' ') + "'.");
    };
    const postfix = () => {
      let v = primary();
      while (peek() === '[') {
        take(); const idx = num(assign()); expect(']');
        const p = this.rval(v);
        if (p.t.k !== 'ptr') throw new GdbError('cannot subscript something of type `' + v.t.name + "'");
        v = this.load(p.t.to, (p.v + idx.v * this.sizeOf(p.t.to)) >>> 0);
      }
      if (peek() === '.' || peek() === '->') throw new GdbError('[sim] struct members are not modelled; the bundled programs have none.');
      return v;
    };
    const unary = () => {
      const t = peek();
      if (t === '(' && this.isTypeWord(tk[i + 1])) {
        take(); const ty = typeName(); expect(')');
        const v = num(unary());
        if (ty.k === 'int') { const sh = 32 - 8 * ty.size; return { t: ty, v: ty.signed ? (v.v << sh) >> sh : ty.size === 4 ? v.v >>> 0 : v.v & ((1 << (8 * ty.size)) - 1) }; }
        return { t: ty, v: v.v >>> 0 };
      }
      if (t === '-') { take(); const v = num(unary()); return { t: v.t.k === 'int' ? v.t : T_INT, v: v.t.signed === 0 ? -v.v >>> 0 : -v.v | 0 }; }
      if (t === '~') { take(); const v = num(unary()); return { t: v.t, v: v.t.signed === 0 ? ~v.v >>> 0 : ~v.v }; }
      if (t === '!') { take(); return { t: T_INT, v: num(unary()).v ? 0 : 1 }; }
      if (t === '*') {
        take(); const v = this.rval(unary());
        if (v.v === undefined) throw new GdbError('Attempt to take contents of a non-pointer value.');
        if (v.t.k === 'ptr') { if (v.t.to.k === 'func') return { t: v.t.to, addr: v.v & ~1 }; return this.load(v.t.to, v.v >>> 0); }
        return this.load(T_INT, v.v >>> 0); // gdb lets you dereference a plain number as int
      }
      if (t === '&') {
        take(); const v = unary();
        if (v.addr === undefined) throw new GdbError(v.reg !== undefined ? 'Attempt to take address of value not located in memory.' : 'Attempt to take address of value not located in memory.');
        const name = v.t.k === 'arr' ? `${v.t.of.name} (*)[${v.t.n}]` : v.t.k === 'func' ? 'void (*)()' : v.t.name + ' *';
        return { t: { k: 'ptr', to: v.t, name }, v: v.addr };
      }
      return postfix();
    };
    const LEVELS = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['@'], ['+', '-'], ['*', '/', '%']];
    const binary = (lvl) => {
      if (lvl === LEVELS.length) return unary();
      let a = binary(lvl + 1);
      while (LEVELS[lvl].includes(peek())) {
        const op = take();
        const braw = binary(lvl + 1);
        if (op === '@') {
          if (a.addr === undefined) throw new GdbError('Only values in memory can be extended with \'@\'.');
          const n = num(braw).v; if (n <= 0) throw new GdbError('Invalid number ' + n + ' of repetitions.');
          a = { t: { k: 'arr', of: a.t, n, name: `${a.t.name} [${n}]` }, addr: a.addr }; continue;
        }
        const x = num(a), y = num(braw);
        if ((op === '+' || op === '-') && x.t.k === 'ptr' && y.t.k !== 'ptr') { const sz = this.sizeOf(x.t.to); a = { t: x.t, v: (x.v + (op === '+' ? 1 : -1) * y.v * sz) >>> 0 }; continue; }
        if (op === '+' && y.t.k === 'ptr' && x.t.k !== 'ptr') { a = { t: y.t, v: (y.v + x.v * this.sizeOf(y.t.to)) >>> 0 }; continue; }
        if (op === '-' && x.t.k === 'ptr' && y.t.k === 'ptr') { a = { t: T_INT, v: ((x.v - y.v) / this.sizeOf(x.t.to)) | 0 }; continue; }
        const uns = arith(x, y, 0).t === T_UINT || x.t.k === 'ptr' || y.t.k === 'ptr';
        const p = uns ? x.v >>> 0 : x.v | 0, q = uns ? y.v >>> 0 : y.v | 0;
        let v;
        switch (op) {
          case '+': v = p + q; break; case '-': v = p - q; break; case '*': v = Math.imul(p, q); break;
          case '/': case '%': if (q === 0) throw new GdbError('Division by zero'); v = op === '/' ? Math.trunc(p / q) : p % q; break;
          case '<<': v = p << (q & 31); break; case '>>': v = uns ? p >>> (q & 31) : p >> (q & 31); break;
          case '&': v = p & q; break; case '|': v = p | q; break; case '^': v = p ^ q; break;
          case '==': v = p === q ? 1 : 0; break; case '!=': v = p !== q ? 1 : 0; break;
          case '<': v = p < q ? 1 : 0; break; case '>': v = p > q ? 1 : 0; break; case '<=': v = p <= q ? 1 : 0; break; case '>=': v = p >= q ? 1 : 0; break;
          case '&&': v = p && q ? 1 : 0; break; default: v = p || q ? 1 : 0;
        }
        const cmp = ['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op);
        a = { t: cmp ? T_INT : uns ? T_UINT : T_INT, v: cmp ? v : uns ? v >>> 0 : v | 0 };
      }
      return a;
    };
    const assign = () => {
      const a = binary(0);
      if (peek() === '=') {
        take(); const b = num(assign());
        this.needTarget();
        this.store(a, b.v);
        return a.reg !== undefined ? { ...a, v: a.reg === 15 ? b.v & ~1 : b.v } : this.load(a.t, a.addr);
      }
      return a;
    };
    const v = assign();
    if (i < tk.length) throw new GdbError('A syntax error in expression, near `' + tk.slice(i).join(' ') + "'.");
    return v;
  }
  /** Numeric value of an address expression (arrays and functions give their address). */
  addrOf(text) { const v = this.eval(text); if (v.t.k === 'arr' || v.t.k === 'func') return v.addr >>> 0; if (v.v === undefined) throw new GdbError('Attempt to use a void value as an address.'); return v.v >>> 0; }

  /* ---------- locations ---------- */
  resolve(spec) {
    spec = spec.trim();
    if (spec.startsWith('*')) { const addr = this.addrOf(spec.slice(1)) & ~1; return { addr }; }
    let m = spec.match(/^(?:(?:src\/)?([\w.]+):)?(\d+)$/);
    if (m) {
      let file = m[1];
      if (!file) { const fr = this.connected && !this.sim.lockup ? this.frame() : null; const ln = fr && !fr.sig ? this.frameLine(fr) : null; file = ln ? ln.file : (this.listPos ? this.listPos.file : this.mainFile); }
      if (!this.src[file]) throw new GdbError(`No source file named ${m[1]}.`);
      const cands = this.stmtRows.filter((r) => r.file === file && r.line >= +m[2] && r.line > 0 && !r.end);
      if (!cands.length) throw new GdbError(`Line ${m[2]} out of range; "src/${file}" has ${this.src[file].length} lines.`);
      const line = Math.min(...cands.map((r) => r.line));
      const addr = Math.min(...cands.filter((r) => r.line === line).map((r) => r.addr));
      return { addr, file, line };
    }
    m = spec.match(/^(?:(?:src\/)?[\w.]+:)?([A-Za-z_]\w*)$/);
    if (m) {
      const f = this.func(m[1]);
      if (!f) throw new GdbError(`Function "${m[1]}" not defined.`);
      const addr = this.afterPrologue(f);
      const ln = this.stmtAt(addr);
      return { addr, file: ln && ln.file, line: ln && ln.line, func: f };
    }
    throw new GdbError(`[sim] Location "${spec}" not understood. Use a function name, a line number, file:line or *address.`);
  }
  locText(addr) { const ln = this.stmtAt(addr); return ln ? `file src/${ln.file}, line ${ln.line}.` : ''; }

  /* ---------- running ---------- */
  needTarget() { if (!this.connected) throw new GdbError('[sim] Not connected to a target. Start with: target extended-remote :3333'); }
  needRunnable() {
    if (!this.connected) throw new GdbError('The program is not being run.');
    if (this.sim.lockup) throw new GdbError(this.loaded
      ? '[sim] The core is in lockup at 0xfffffffe. Reset it: monitor reset halt'
      : '[sim] The core is in lockup at 0xfffffffe: flash is erased, so there was no valid vector table to start from. Use load, then monitor reset halt.');
  }
  bpAt(pc) { return this.bps.find((b) => b.kind === 'bp' && b.on && b.addr === pc); }
  /** One instruction. Returns a stop reason for watchpoints and lockup, else null. */
  stepInsn() {
    const wps = this.bps.filter((b) => b.kind === 'wp' && b.on);
    const before = wps.map((w) => this.sim.peek(w.addr, w.size));
    this.sim.step();
    this._frames = null;
    if (this.sim.event && this.sim.event.type === 'lockup') return { type: 'lockup' };
    for (let k = 0; k < wps.length; k++) { const now = this.sim.peek(wps[k].addr, wps[k].size); if (now !== before[k]) return { type: 'wp', wp: wps[k], old: before[k], now }; }
    return null;
  }
  report(stop, prevFunc) {
    this.running = false;
    if (stop.type === 'bp') {
      stop.bp.hits++;
      this.ocdHalt('breakpoint');
      const out = `\n${stop.bp.temp ? 'Temporary breakpoint' : 'Breakpoint'} ${stop.bp.num}, ${this.where(null)}`;
      if (stop.bp.temp) this.bps = this.bps.filter((b) => b !== stop.bp);
      const f = this.funcAt(this.sim.r[15]); if (f) this.flags.add('hit:' + f.name);
      return out;
    }
    if (stop.type === 'wp') {
      stop.wp.hits++;
      this.ocdHalt('watchpoint');
      this.flags.add('wphit');
      const show = (v) => this.fmt({ t: stop.wp.t, v: stop.wp.t.signed ? (v << (32 - 8 * stop.wp.size)) >> (32 - 8 * stop.wp.size) : v }, null, false);
      return `\nHardware watchpoint ${stop.wp.num}: ${stop.wp.expr}\n\nOld value = ${show(stop.old)}\nNew value = ${show(stop.now)}\n${this.where(null)}`;
    }
    if (stop.type === 'lockup') { this.ocdHalt('debug-request'); this._frames = null; return '[sim] The core entered lockup (a fault with no way to run a handler).\n0xfffffffe in ?? ()'; }
    if (stop.type === 'sigint') { this.ocdHalt('debug-request'); return `\nProgram received signal SIGINT, Interrupt.\n${this.where(null)}`; }
    return this.where(prevFunc);
  }
  /** Run until a breakpoint, watchpoint or the budget. `until(sim)` adds a private stop condition. */
  run(until, budget = 300000, skipFirst = true) {
    for (let n = 0; n < budget; n++) {
      const pc = this.sim.r[15];
      if (!(n === 0 && skipFirst)) { const bp = this.bpAt(pc); if (bp) return { type: 'bp', bp }; }
      if (until && n > 0 && until(this.sim)) return { type: 'done' };
      const s = this.stepInsn();
      if (s) return s;
    }
    if (until && until(this.sim)) return { type: 'done' };
    return null;
  }
  goRunning() { this.running = true; this.flags.add('ran-away'); return null; }
  cmdContinue() {
    this.needRunnable();
    const stop = this.run(null);
    if (!stop) { this.goRunning(); return 'Continuing.'; }
    return 'Continuing.\n' + this.report(stop);
  }
  interrupt() {
    if (!this.running) return '';
    return this.report({ type: 'sigint' });
  }
  cmdStepi(over) {
    this.needRunnable();
    const f0 = this.funcAt(this.sim.r[15]);
    const pc = this.sim.r[15];
    const insn = this.sim.peek(pc, 2);
    let stop = this.stepInsn();
    if (!stop && over && (insn & 0xf800) === 0xf000) { // nexti over BL
      const ret = pc + 4, sp = this.sim.r[13];
      stop = this.run((s) => s.r[15] === ret && s.r[13] >= sp, 300000, false);
      if (!stop) { this.goRunning(); return ''; }
      if (stop.type === 'done') stop = null;
    }
    if (stop) return this.report(stop);
    this._frames = null; this.sel = 0;
    const fr = this.frames()[0], ln = this.frameLine(fr);
    if (!fr.func) return this.describe(fr);
    if (fr.func !== f0) return this.where(f0);
    this.listPos = ln ? { file: ln.file, line: ln.line, centre: true } : this.listPos;
    return ln ? (fr.pc !== ln.start ? hx8(fr.pc) + '\t' : '') + this.srcLine(ln.file, ln.line) : this.describe(fr);
  }
  /** Source-level step. `over` = next (step over calls). Follows gdb's rules: stop at the start of a different line. */
  cmdStep(over) {
    this.needRunnable();
    const s = this.sim;
    const f0 = this.funcAt(s.r[15]);
    let range = this.stmtAt(s.r[15]);
    if (!range) throw new GdbError(`Cannot find bounds of current function`);
    const startLine = range.line, startFile = range.file;
    for (let n = 0; n < 300000; n++) {
      const pc = s.r[15], insn = s.peek(pc, 2), sp = s.r[13];
      let stop = this.stepInsn();
      if (stop) return this.report(stop);
      let now = s.r[15];
      if (n > 0 || now !== pc) { const bp = this.bpAt(now); if (bp && !(now >= range.start && now < range.end && now !== range.start)) return this.report({ type: 'bp', bp }); }
      const isCall = ((insn & 0xf800) === 0xf000 || (insn & 0xff87) === 0x4780) && !s.event;
      if (isCall) {
        const callee = this.funcAt(now);
        const ret = (s.r[14] & ~1) >>> 0;
        if (over || !callee || !this.stmtAt(this.afterPrologue(callee))) {
          stop = this.run((x) => x.r[15] === ret && x.r[13] >= sp, 300000, false);
          if (!stop) return this.goRunning() || '';
          if (stop.type !== 'done') return this.report(stop);
          now = s.r[15];
        } else {
          const target = this.afterPrologue(callee);
          stop = this.run((x) => x.r[15] === target, 1000, false);
          if (stop && stop.type !== 'done') return this.report(stop);
          return this.report({ type: 'step' }, f0);
        }
      }
      if (now >= range.start && now < range.end) continue;
      const here = this.stmtAt(now);
      if (!here) { if (!this.funcAt(now)) return this.report({ type: 'step' }, f0); continue; }
      if (now === here.start && (here.line !== startLine || here.file !== startFile)) return this.report({ type: 'step' }, f0);
      if (here.line === startLine && here.file === startFile) range = here; // still in the same line (a loop back, or a return into it)
      else range = here; // landed in the middle of another line: run on to the start of the next one
    }
    return this.goRunning() || '';
  }
  cmdFinish() {
    this.needRunnable();
    const fr = this.frames();
    const cur = fr[this.sel], up = fr[this.sel + 1];
    if (!up || up.sig || !cur.func) throw new GdbError('"finish" not meaningful in the outermost frame.');
    const head = `Run till exit from ${this.describe(cur, this.sel)}`;
    const ret = up.pc, sp = up.sp;
    const stop = this.run((x) => x.r[15] === ret && x.r[13] >= sp);
    if (!stop) { this.goRunning(); return head; }
    if (stop.type !== 'done') return head + '\n' + this.report(stop);
    this.flags.add('finish');
    let out = head + '\n' + this.where(null);
    if (cur.func.ret !== 'void') { const v = { t: this.parseType(cur.func.ret), v: this.sim.r[0] }; this.hist.push(v); out += `\nValue returned is $${this.hist.length} = ${this.fmt(v)}`; }
    return out;
  }

  /* ---------- commands ---------- */
  cmdX(arg) {
    this.needTarget();
    let m = arg.match(/^\/(\d*)([a-z]*)\s*(.*)$/);
    let expr = arg;
    if (m) {
      if (m[1]) this.xFmt.n = +m[1]; else this.xFmt.n = 1;
      for (const c of m[2]) { if ('bhw'.includes(c)) this.xFmt.u = { b: 1, h: 2, w: 4 }[c]; else if (c === 'g') throw new GdbError('[sim] 8-byte units are not modelled.'); else if ('xduotcsia'.includes(c)) this.xFmt.f = c; else throw new GdbError(`Invalid format letter "${c}".`); }
      expr = m[3];
    } else this.xFmt.n = 1;
    let addr = expr.trim() ? this.addrOf(expr) : this.xNext;
    if (addr == null) throw new GdbError('Argument required (starting display address).');
    const { n, f, u } = this.xFmt;
    const lines = [];
    if (f === 's') {
      for (let k = 0; k < n; k++) { const bytes = this.cstring(addr, 400); lines.push(`${hx(addr)}${this.symTag(addr)}:\t${gdbString(bytes, true)}`); addr += bytes.length + 1; }
    } else if (f === 'i') {
      for (let k = 0; k < n; k++) {
        const d = this.prog.disasm[addr & ~1];
        const a = addr & ~1;
        const mark = this.connected && a === this.sim.r[15] ? '=> ' : '   ';
        if (!d) { this.mem(a, 2); lines.push(`${mark}${hx(a)}${this.symTag(a)}:\t[sim] no listing for this address`); addr = a + 2; continue; }
        lines.push(`${mark}${hx(a)}${this.symTag(a)}:\t${d[1].replace(/^(\S+) /, '$1\t')}`);
        addr = a + d[0].replace(/ /g, '').length / 2;
      }
    } else {
      const per = u === 4 ? 4 : 8;
      for (let k = 0; k < n; k += per) {
        const cells = [];
        for (let j = k; j < Math.min(n, k + per); j++) {
          const v = this.mem(addr + j * u, u);
          const sh = 32 - 8 * u;
          cells.push(f === 'x' || f === 'a' ? '0x' + v.toString(16).padStart(u * 2, '0') : f === 'd' ? String((v << sh) >> sh) : f === 't' ? v.toString(2).padStart(u * 8, '0') : f === 'c' ? `${v & 0xff} '${escChar(v & 0xff, 39)}'` : f === 'o' ? '0' + v.toString(8) : String(v));
        }
        const a = addr + k * u;
        lines.push(`${hx(a)}${this.symTag(a)}:\t${cells.join('\t')}`);
      }
      addr += n * u;
    }
    this.xNext = addr;
    this.flags.add('x');
    return lines.join('\n');
  }
  cmdList(arg) {
    let file, centre;
    arg = arg.trim();
    if (arg) {
      const loc = arg.startsWith('*') ? (() => { const a = this.addrOf(arg.slice(1)) & ~1; const ln = this.stmtAt(a); if (!ln) throw new GdbError(`No line number information available for address ${hx(a)}${this.symTag(a)}`); return { file: ln.file, line: ln.line, addr: a, star: true }; })() : this.resolve(arg);
      if (!loc.file) throw new GdbError('No line number information for that location.');
      const fn = loc.func ? loc.func.line : loc.line;
      this.listPos = { file: loc.file, line: fn, centre: true };
      const head = loc.star ? `${hx(loc.addr)} is in ${this.funcAt(loc.addr) ? this.funcAt(loc.addr).name : '??'} (src/${loc.file}:${loc.line}).\n` : '';
      return head + this.listMore();
    }
    if (!this.listPos) { const f = this.func('main'); this.listPos = { file: f.file, line: f.line, centre: true }; }
    void file; void centre;
    return this.listMore();
  }
  listMore() {
    const p = this.listPos, src = this.src[p.file];
    let first = p.centre ? Math.max(1, p.line - 5) : p.line;
    if (first > src.length) throw new GdbError(`Line number ${first} out of range; "src/${p.file}" has ${src.length} lines.`);
    const last = Math.min(src.length, first + 9);
    const out = [];
    for (let l = first; l <= last; l++) out.push(`${l}\t${src[l - 1]}`);
    this.listPos = { file: p.file, line: last + 1, centre: false };
    return out.join('\n');
  }
  cmdInfo(arg) {
    const [sub = '', ...rest] = arg.trim().split(/\s+/);
    const tail = rest.join(' ');
    const is = (name, min = 1) => sub.length >= min && name.startsWith(sub);
    if (is('registers') || sub === 'r' || is('all-registers', 2)) {
      this.needTarget();
      const s = this.sim;
      const row = (name, v, nat) => `${name.padEnd(15)}${hx(v).padEnd(19)}${nat}`;
      const all = REG_NAMES.map((name, i) => row(name, s.r[i], i === 13 ? hx(s.r[i]) : i === 15 ? hx(s.r[i]) + this.symTag(s.r[i]) : String(s.r[i] | 0)));
      all.push(row('xpsr', s.xpsr, String(s.xpsr | 0)));
      if (tail) { const want = tail.replace(/^\$/, '').toLowerCase(); const idx = want === 'xpsr' || want === 'cpsr' ? 16 : REG_NAMES.indexOf(want); if (idx < 0) throw new GdbError(`Invalid register \`${want}'`); return all[idx]; }
      this.flags.add('regs');
      return all.join('\n');
    }
    if (is('breakpoints') || is('watchpoints')) {
      if (!this.bps.length) return 'No breakpoints or watchpoints.';
      const out = ['Num     Type           Disp Enb Address    What'];
      for (const b of this.bps) {
        if (b.kind === 'bp') { const f = this.funcAt(b.addr), ln = this.stmtAt(b.addr); out.push(`${String(b.num).padEnd(8)}breakpoint     ${b.temp ? 'del ' : 'keep'} ${b.on ? 'y' : 'n'}   ${hx8(b.addr)} ${f ? `in ${f.name} at src/${ln ? ln.file + ':' + ln.line : '?'}` : ''}`); }
        else out.push(`${String(b.num).padEnd(8)}hw watchpoint  keep ${b.on ? 'y' : 'n'}              ${b.expr}`);
        if (b.hits) out.push(`\tbreakpoint already hit ${b.hits} time${b.hits > 1 ? 's' : ''}`);
      }
      return out.join('\n');
    }
    if (is('locals', 2) || is('args', 1) && sub !== 'a' || sub === 'args') {
      this.needRunnable();
      const fr = this.frame();
      if (fr.sig || !fr.func) throw new GdbError('No symbol table info available.');
      const params = sub.startsWith('a');
      const vars = this.varsOf(fr, params);
      this.flags.add(params ? 'args' : 'locals');
      if (!vars.length) return params ? 'No arguments.' : 'No locals.';
      return vars.slice().reverse().map((v) => `${v.name} = ${this.fmt(this.localValue(fr, v))}`).join('\n');
    }
    if (is('symbol', 1)) {
      const a = this.addrOf(tail);
      const sm = this.sym(a);
      if (!sm) return `No symbol matches ${tail}.`;
      const sec = this.prog.sections.find((x) => a >= x.addr && a < x.addr + x.size);
      return `${sm.replace('+', ' + ')} in section ${sec ? sec.name : '?'}`;
    }
    if (is('line', 2)) {
      let addr, ln;
      if (!tail) { this.needRunnable(); addr = this.frame().pc; ln = this.stmtAt(addr); }
      else if (tail.startsWith('*')) { addr = this.addrOf(tail.slice(1)) & ~1; ln = this.stmtAt(addr); }
      else { const loc = this.resolve(tail); addr = loc.addr; ln = this.stmtAt(addr); if (loc.line && ln) { addr = ln.start; } }
      if (!ln) return `No line number information available for address ${hx(addr)}${this.symTag(addr)}`;
      const mid = tail.startsWith('*') && addr !== ln.start;
      return `Line ${ln.line} of "src/${ln.file}" starts at address ${hx(ln.start)}${this.symTag(ln.start)} and ends at ${hx(ln.end)}${this.symTag(ln.end)}.`.replace(/^Line (\d+) of ("[^"]+")/, mid ? `Line $1 of $2` : 'Line $1 of $2');
    }
    if (is('frame', 1)) {
      this.needRunnable();
      const frs = this.frames(), fr = frs[this.sel];
      if (fr.sig) return `Stack level ${this.sel}, frame at ${hx(fr.cfa)}:\n <signal handler called>: an exception frame of 8 words starts at ${hx(fr.cfa)}`;
      const up = frs[this.sel + 1];
      return `Stack level ${this.sel}, frame at ${hx(up ? (up.sig ? up.cfa : up.sp) : fr.sp)}:\n pc = ${hx(fr.pc)}${fr.func ? ` in ${fr.func.name}` : ''}${up && !up.sig ? `; saved pc = ${hx(up.pc)}` : ''}\n${up ? ` called by frame at a higher address` : ' outermost frame'}\n sp in this frame = ${hx(fr.sp)}`;
    }
    if (is('source', 2) || is('files', 2) || is('functions', 2)) return `[sim] Source files: ${Object.keys(this.src).map((f) => 'src/' + f).join(', ')}. Functions: ${this.prog.funcs.map((f) => f.name).join(', ')}.`;
    throw new GdbError(sub ? `Undefined info command: "${sub}".  Try "help info".` : '[sim] info needs a subcommand: registers, breakpoints, locals, args, frame, symbol, line.');
  }
  cmdMonitor(arg) {
    if (!this.connected) throw new GdbError('"monitor" command not supported by this target.');
    const [c, ...a] = arg.trim().split(/\s+/);
    const s = this.sim;
    if (c === 'reset') {
      if (a[0] && !['halt', 'init', 'run'].includes(a[0])) throw new GdbError(`[sim] monitor reset ${a[0]}: use reset halt.`);
      s.reset(); this._frames = null; this.sel = 0; this.running = false;
      for (const b of this.bps) b.hits = 0;
      if (a[0] === 'run' || !a[0]) return '[sim] reset run would let the program go. Use monitor reset halt to stop at the reset vector.';
      this.flags.add(this.loaded ? 'reset-loaded' : 'reset');
      const lines = [`target halted due to debug-request, current mode: Thread`, `xPSR: ${hx8(s.xpsr)} pc: ${hx8(s.r[15])} msp: ${hx8(s.r[13])}`];
      this.ocd.push(...lines);
      if (s.lockup) lines.push('[sim] Flash is erased: the vector table read back as 0xffffffff and the core locked up.');
      return lines.join('\n');
    }
    if (c === 'halt') { this.running = false; this.ocdHalt('debug-request'); return ''; }
    if (c === 'mdw' || c === 'mdb' || c === 'mdh') {
      const size = { mdw: 4, mdh: 2, mdb: 1 }[c];
      const addr = Number(a[0]); const n = a[1] ? Number(a[1]) : 1;
      if (!a[0] || isNaN(addr) || isNaN(n)) throw new GdbError(`${c} ['phys'] address [count]`);
      const out = [];
      for (let k = 0; k < n; k += 8) { const cells = []; for (let j = k; j < Math.min(n, k + 8); j++) { const v = s.peek(addr + j * size, size); if (v === undefined) throw new GdbError(`Failed to read memory at ${hx8(addr + j * size)}`); cells.push(v.toString(16).padStart(size * 2, '0')); } out.push(`${hx8(addr + k * size)}: ${cells.join(' ')} `); }
      this.flags.add('mdw'); this.ocd.push('> ' + arg.trim(), ...out);
      return out.join('\n');
    }
    if (c === 'mww') {
      const addr = Number(a[0]), v = Number(a[1]);
      if (isNaN(addr) || isNaN(v)) throw new GdbError('mww [\'phys\'] address value [count]');
      if (!s.poke(addr, 4, v)) throw new GdbError(`Failed to write memory at ${hx8(addr)}`);
      this.ocd.push('> ' + arg.trim());
      return '';
    }
    if (c === 'reg') return this.cmdInfo('registers');
    return `invalid command name "${c}"\n[sim] OpenOCD commands modelled here: reset halt, halt, mdw, mdh, mdb, mww.`;
  }
  cmdBreak(arg, temp) {
    if (!arg.trim()) { this.needRunnable(); arg = '*' + hx(this.frame().pc); }
    const loc = this.resolve(arg);
    const b = { kind: 'bp', num: this.nextBp++, addr: loc.addr >>> 0, on: true, hits: 0, temp };
    this.bps.push(b);
    this.flags.add('break');
    const lt = this.locText(b.addr);
    return `${temp ? 'Temporary breakpoint' : 'Breakpoint'} ${b.num} at ${hx(b.addr)}${lt ? ': ' + lt : ''}`;
  }

  /** Execute one command line; returns the text GDB would print (possibly empty). */
  exec(line) {
    let text = line.trim();
    if (this.running) return '[sim] The target is running, so GDB is not reading commands. Press Ctrl-C to interrupt it.';
    if (!text) { if (/^(s|step|n|next|si|stepi|ni|nexti|x\b|l|list)/.test(this.last)) text = /^x\b/.test(this.last) ? 'x' : /^(l|list)\b/.test(this.last) ? 'list' : this.last; else return ''; }
    else this.last = text;
    try { return this.dispatch(text) || ''; } catch (e) { if (e instanceof GdbError) return e.message; throw e; }
  }
  dispatch(text) {
    const m = text.match(/^([A-Za-z-]+)(\/\S*)?\s*(.*)$/);
    if (!m) throw new GdbError(`Undefined command: "${text.split(/\s/)[0]}".  Try "help".`);
    const c = m[1], fmt = m[2] || '', arg = m[3];
    const is = (name, min = 1) => c.length >= min && name.startsWith(c);
    if (c === 'target' || is('target', 3)) {
      const t = arg.match(/^(extended-remote|remote)\s+(\S+)$/);
      if (!t) throw new GdbError('[sim] Use: target extended-remote :3333');
      const port = t[2].replace(/^localhost/, '');
      if (port !== ':3333') return `${t[2]}: Connection timed out.\n[sim] OpenOCD's GDB server listens on port 3333 (see the left pane; 4444 is its telnet console, 6666 its Tcl port).`;
      if (this.connected) return '[sim] Already connected.';
      this.connected = true; this.flags.add('connect');
      this.ocd.push("Info : accepting 'gdb' connection on tcp/3333");
      this.ocdHalt('debug-request');
      return `Remote debugging using :3333\n${this.sim.lockup ? '0xfffffffe in ?? ()' : this.where(null)}`;
    }
    if (is('monitor', 3)) return this.cmdMonitor(arg);
    if (c === 'load') {
      if (!this.connected) throw new GdbError("You can't do that when your target is `exec'");
      const secs = this.prog.sections.filter((x) => !x.nobits);
      const bin = b64ToBytes(this.prog.bin);
      const base = secs[0].lma;
      this.sim.eraseFlash(); this.sim.loadFlash(base, bin);
      this.sim.lockup = false; this.sim.r[15] = this.prog.entry & ~1; this.sim.T = 1; this._frames = null;
      this.loaded = true; this.flags.add('load');
      this.ocd.push(`Info : flash: erased and wrote ${bin.length} bytes at ${hx8(base)} (simulated)`);
      return secs.map((x) => `Loading section ${x.name}, size ${hx(x.size)} lma ${hx(x.lma)}`).join('\n') + `\nStart address ${hx8(this.prog.entry & ~1)}, load size ${secs.reduce((a, x) => a + x.size, 0)}` +
        '\n[sim] load set PC to the entry point but SP still holds its old value. Run monitor reset halt so SP and PC come from the new vector table.';
    }
    if (c === 'help' || c === 'h') return HELP;
    if (is('break', 1) || c === 'br') return this.cmdBreak(arg, false);
    if (is('tbreak', 2)) return this.cmdBreak(arg, true);
    if (is('watch', 2)) {
      this.needTarget();
      const v = this.eval(arg);
      if (v.addr === undefined || v.t.k === 'arr' && this.sizeOf(v.t) > 4) throw new GdbError(v.addr === undefined ? 'Cannot watch constant value `' + arg + "'." : '[sim] Watch regions larger than 4 bytes are not modelled; watch one element, such as name_buf[0].');
      const b = { kind: 'wp', num: this.nextBp++, addr: v.addr, size: this.sizeOf(v.t), t: v.t.k === 'arr' ? T_UINT : v.t, expr: arg.trim(), on: true, hits: 0 };
      this.bps.push(b); this.flags.add('watch');
      return `Hardware watchpoint ${b.num}: ${b.expr}`;
    }
    if (c === 'rwatch' || c === 'awatch') throw new GdbError('[sim] Only write watchpoints (watch) are modelled.');
    if (is('delete', 1)) {
      if (!arg) { this.bps = []; return ''; }
      for (const n of arg.split(/\s+/)) { if (!this.bps.some((b) => b.num === +n)) throw new GdbError(`No breakpoint number ${n}.`); this.bps = this.bps.filter((b) => b.num !== +n); }
      return '';
    }
    if (is('disable', 4) || is('enable', 2)) {
      const on = c[0] === 'e';
      for (const b of this.bps) if (!arg || arg.split(/\s+/).includes(String(b.num))) b.on = on;
      return '';
    }
    if (is('continue', 1) || c === 'cont') return this.cmdContinue();
    if (c === 's' || is('step', 4)) return this.cmdStep(false);
    if (c === 'n' || is('next', 4)) return this.cmdStep(true);
    if (c === 'si' || is('stepi', 5)) return this.cmdStepi(false);
    if (c === 'ni' || is('nexti', 5)) return this.cmdStepi(true);
    if (is('finish', 3)) return this.cmdFinish();
    if (is('until', 1) || is('advance', 3)) {
      this.needRunnable();
      if (!arg) return this.cmdStep(true);
      const loc = this.resolve(arg);
      const stop = this.run((x) => x.r[15] === loc.addr);
      if (!stop) return this.goRunning() || '';
      return stop.type === 'done' ? this.where(null) : this.report(stop);
    }
    if (c === 'bt' || is('backtrace', 4) || c === 'where') {
      this.needRunnable();
      const fr = this.frames();
      this.flags.add('bt');
      const out = fr.map((f, i) => this.describe(f, i));
      const lastF = fr[fr.length - 1];
      if (!lastF.func && !lastF.sig) out.push('[sim] The frame above is the faulting context: the processor tried to execute at that address. Whether a real GDB can unwind further from there varies; read the exception frame on the stack by hand (x/8xw $sp).');
      return out.join('\n');
    }
    if (is('frame', 1) || c === 'up' || is('down', 3)) {
      this.needRunnable();
      const fr = this.frames();
      let n = this.sel;
      if (c === 'up') n += arg ? +arg : 1; else if (is('down', 3)) n -= arg ? +arg : 1; else if (arg) n = +arg;
      if (isNaN(n) || n < 0) throw new GdbError('Bottom (innermost) frame selected; you cannot go down.');
      if (n >= fr.length) throw new GdbError(c === 'up' ? 'Initial frame selected; you cannot go up.' : 'No frame at level ' + arg + '.');
      this.sel = n;
      const f = fr[n], ln = f.sig ? null : this.frameLine(f);
      if (ln) this.listPos = { file: ln.file, line: ln.line, centre: true };
      return this.describe(f, n) + (ln ? '\n' + this.srcLine(ln.file, ln.line) : '');
    }
    if (is('info', 1)) return this.cmdInfo(arg);
    if (c === 'p' || is('print', 2) || is('inspect', 3) || c === 'call') {
      const f = fmt.replace('/', '');
      if (f && !/^[xdutcas]$/.test(f)) throw new GdbError(`Undefined output format "${f}".`);
      const v = arg ? this.eval(arg) : this.hist[this.hist.length - 1];
      if (!v) throw new GdbError('History is empty.');
      if (v.voidval) return `$${this.hist.push(v)} = void`;
      const out = f === 's' ? this.fmt(v, null) : this.fmt(v, f || null);
      this.hist.push(v.t.k === 'arr' || v.t.k === 'func' ? v : { t: v.t, v: v.v });
      this.flags.add('print');
      return `$${this.hist.length} = ${out}`;
    }
    if (c === 'set') {
      const a = arg.replace(/^var(iable)?\s+/, '');
      if (/^(confirm|pagination|print|height|width|listsize)\b/.test(a)) return '';
      if (!a.includes('=')) throw new GdbError('[sim] Use: set var <lvalue> = <expression>');
      this.eval(a); this.flags.add('set');
      return '';
    }
    if (is('whatis', 2) || is('ptype', 2)) { const v = this.eval(arg); return `type = ${v.t.name}`; }
    if (c === 'x') return this.cmdX(fmt + (fmt && arg ? ' ' : '') + arg);
    if (is('list', 1)) return this.cmdList(arg);
    if (is('disassemble', 5)) {
      const f = arg ? this.func(arg.trim()) || this.funcAt(this.addrOf(arg)) : (this.needRunnable(), this.frame().func);
      if (!f) throw new GdbError('No function contains specified address.');
      const out = [`Dump of assembler code for function ${f.name}:`];
      for (const [a, d] of Object.entries(this.prog.disasm)) { const ad = +a; if (ad >= f.lo && ad < f.hi) out.push(`${this.connected && ad === this.sim.r[15] ? '=> ' : '   '}${hx8(ad)} <+${ad - f.lo}>:\t${d[1].replace(/^(\S+) /, '$1\t')}`); }
      out.push('End of assembler dump.');
      this.flags.add('disas');
      return out.join('\n');
    }
    if (is('quit', 1) || is('detach', 3) || is('kill', 1)) return '[sim] Use the Restart button to begin the session again.';
    if (is('run', 1) || c === 'start') return '[sim] run starts a program on your own computer. On a microcontroller the program is already on the chip: use monitor reset halt, then continue.';
    if (is('file', 2)) return `Reading symbols from ${this.prog.elfName}...`;
    throw new GdbError(`Undefined command: "${c}".  Try "help".`);
  }
}

/* ------------------------------------------------------------------ scenarios */

const num = (t) => { const s = String(t).trim().replace(/_/g, ''); return /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^-?\d+$/.test(s) ? parseInt(s, 10) : NaN; };
const lineOf = (prog, needle) => prog.sources[prog.file].split('\n').findIndex((l) => l.includes(needle)) + 1;
const A = (ok, msg) => ({ ok, msg });
const SETUP = ['target extended-remote :3333', 'monitor reset halt', 'load', 'monitor reset halt'];

/** Scenario definitions. Expected answers are derived from the compiled programs, not typed in by hand. */
export function scenarioInfo(name) {
  const prog = DEBUG_PROGRAMS[SCENARIO_PROGRAM[name]];
  const fn = (n) => prog.funcs.find((f) => f.name === n);
  if (name === 'tour') {
    const sum = [12, 7, 30, 5, 9, 21].reduce((a, b) => a + b, 0);
    const callLine = lineOf(prog, 'total = checksum');
    return {
      title: 'Guided first session',
      brief: 'The board is connected through a debug probe and OpenOCD is already running (left). The flash is erased. Bring the program up and stop inside checksum().',
      steps: [
        ['connect', 'Connect GDB to OpenOCD', 'target extended-remote :3333'],
        ['reset', 'Reset the core and halt it', 'monitor reset halt'],
        ['load', 'Write the program to flash', 'load'],
        ['reset-loaded', 'Reset again so SP and PC are read from the new vector table', 'monitor reset halt'],
        ['break', 'Set a breakpoint on checksum', 'break checksum'],
        ['hit:checksum', 'Run to it', 'continue'],
        ['bt', 'See who called it', 'bt'],
        ['args', 'Look at its arguments', 'info args'],
        ['x', 'Examine the table it was given: six bytes at data', 'x/6xb data'],
        ['finish', 'Run until checksum returns', 'finish'],
      ],
      questions: [
        { id: 'pc', q: 'After the second monitor reset halt, what is pc? (OpenOCD prints it.)', hints: ['It is word 1 of the vector table with the Thumb bit cleared.', 'Read the "xPSR: … pc: … msp: …" line.'],
          check: (t) => { const v = num(t); if (isNaN(v)) return A(false, 'Type the address, for example 0x08000100.'); if (v === (prog.entry & ~1)) return A(true, `Yes, ${hx8(v)}: Reset_Handler. The core loaded it, and SP, from the vector table.`); if (v === prog.entry) return A(false, 'That is the vector as stored, with bit 0 set to mark Thumb. The pc register itself holds the even address.'); if (v === 0xfffffffe) return A(false, 'That was the lockup address while flash was still erased. Reset again after load.'); return A(false, 'Not that. Run monitor reset halt after load and read the pc value OpenOCD reports.'); }, answer: hx8(prog.entry & ~1) },
        { id: 'ret', q: 'What value does checksum return? (finish prints it.)', hints: ['finish runs to the end of the current function and prints "Value returned".'],
          check: (t) => { const v = num(t); if (v === sum) return A(true, `Yes, ${sum}: the sum of the six table bytes, returned in r0.`); if (isNaN(v)) return A(false, 'Type a number.'); return A(false, 'Not that. Stop inside checksum, then use finish. If you stepped past the return, look at total with p total.'); }, answer: String(sum) },
        { id: 'line', q: `According to bt, which line of dbg_tour.c called checksum?`, hints: ['Frame #1 in the backtrace is the caller; the number after the colon is the line.'],
          check: (t) => { const v = num(t); if (v === callLine) return A(true, `Yes, line ${callLine}. Frame #1 shows the return address inside main and the line it belongs to.`); if (v === fn('checksum').line || (v > fn('checksum').line && v < fn('checksum').line + 8)) return A(false, 'That line is inside checksum itself (frame #0). The caller is frame #1.'); return A(false, 'Not that. Break in checksum, run bt and read frame #1.'); }, answer: String(callLine) },
      ],
      wrap: 'That is the whole loop: connect, reset, load, reset, break, run, inspect. Everything else in a debug session is a variation on it.',
    };
  }
  if (name === 'hardfault') {
    const d = fn('dispatch');
    const callLine = lineOf(prog, 'fn();');
    const blx = +Object.keys(prog.disasm).find((a) => +a >= d.lo && +a < d.hi && /^blx/.test(prog.disasm[a][1]));
    const lr = (blx + 2) | 1;
    return {
      title: 'HardFault: where did it crash?',
      brief: 'This firmware handles a few events and then stops responding. Load it, let it run, interrupt it and find out where it is and how it got there. A fault pushes eight words onto the stack before the handler runs; they are your evidence.',
      questions: [
        { id: 'where', q: 'Let it run, then interrupt it with Ctrl-C. Which function is it in?', hints: ['After the setup commands, continue. Nothing more will happen: press Ctrl-C.', 'GDB prints the function name after "Program received signal SIGINT".'],
          check: (t) => /^hardfault(_handler)?(\(\))?$/i.test(t.trim()) ? A(true, 'Yes. HardFault_Handler is an endless loop, which is why the device looked dead. The interesting question is what sent it there.') : /default/i.test(t) ? A(false, 'Close, but read the name again: each exception has its own vector, and this one is more specific.') : A(false, 'Not that. Run continue, press Ctrl-C and read the line GDB prints.'), answer: 'HardFault_Handler' },
        { id: 'pc', q: 'On exception entry the core pushed r0, r1, r2, r3, r12, lr, pc, xpsr. Dump them with x/8xw $sp. What is the stacked pc (the seventh word)?', hints: ['The handler has not moved sp, so the frame starts exactly at $sp.', 'Words are numbered from the lowest address: r0 is first, pc is at $sp+24.'],
          check: (t) => { const v = num(t); if (v === 0) return A(true, 'Yes: 0x00000000. The processor was trying to execute at address zero. That tells you what went wrong (a call through a null pointer) but not where it was called from.'); if (v === lr || v === (lr & ~1)) return A(false, 'That is the sixth word, the stacked lr. pc is the one after it.'); if (isNaN(v)) return A(false, 'Type the 32-bit value, such as 0x08000123.'); return A(false, 'Not that. Count: r0, r1, r2, r3, r12, lr, pc, xpsr.'); }, answer: '0x00000000' },
        { id: 'lr', q: 'What is the stacked lr (the sixth word)?', hints: ['It is at $sp+20.'],
          check: (t) => { const v = num(t); if (v === lr) return A(true, `Yes: ${hx8(lr)}. A call stores its return address in lr, so this points just after the call instruction that jumped to zero. Bit 0 is the Thumb bit; the instruction address is ${hx8(lr & ~1)}.`); if (v === (lr & ~1) >>> 0) return A(false, 'That is the address with the Thumb bit removed. Give the word exactly as it is on the stack.'); if (v === 0xfffffff9) return A(false, 'That is the live lr register: EXC_RETURN, the magic value that means "return from exception". The lr of the interrupted code is the one saved on the stack.'); return A(false, 'Not that. Read the sixth word of x/8xw $sp.'); }, answer: hx8(lr) },
        { id: 'line', q: 'Which line of dbg_hardfault.c contains the call that faulted?', hints: ['info line *<address> or list *<address> turns an address into a source line.', 'lr is a return address: it belongs to the instruction after the call. Look up an address inside the call instruction itself, for example lr minus the Thumb bit minus 2.', 'x/3i with an address a little before lr shows the blx.'],
          check: (t) => { const v = num(t); if (v === callLine) return A(true, `Yes, line ${callLine}: fn(). The pointer it called through was null.`); if (v === callLine + 1) return A(false, 'That is the line the return address belongs to: the instruction after the call. The call itself is one instruction earlier. This off-by-one catches everyone once.'); if (v === callLine - 1) return A(false, 'That line loads the pointer from the table. The jump happens on the next one.'); return A(false, 'Not that. Use info line *<address> with an address just before the stacked lr.'); }, answer: String(callLine) },
        { id: 'cfsr', q: 'Read the Configurable Fault Status Register: x/xw 0xE000ED28. Which fault bit is set? Give its name (see the table below).', hints: ['The value has exactly one bit set. Which bit number is it?', 'Bit 17 is in the UsageFault part of CFSR.'],
          check: (t) => { const s = t.trim().toUpperCase(); if (s === 'INVSTATE') return A(true, 'Yes, INVSTATE. Address 0 has bit 0 clear, so the branch tried to switch the core out of Thumb state, which a Cortex-M does not have. HFSR (0xE000ED2C) shows FORCED: the UsageFault handler is not enabled, so the fault escalated to HardFault.'); if (/^(0X)?0*20000$/.test(s) || s === '17') return A(false, 'That is the value (bit 17). Now name the bit using the table.'); if (s === 'UNDEFINSTR') return A(false, 'That is bit 16. Count again: 0x00020000 is bit 17.'); if (/BUS|PRECIS|IBUS/.test(s)) return A(false, 'A bus fault would set a bit in 8 to 15 and, for a data access, record the address in BFAR. Here the set bit is higher.'); return A(false, 'Not that. Convert the value to a bit number and look it up.'); }, answer: 'INVSTATE' },
        { id: 'event', q: 'Which event number has no handler? (Inspect the handlers table.)', hints: ['p handlers prints the three function pointers.', 'Array indices start at 0.'],
          check: (t) => /^(2|ev_uart)$/i.test(t.trim()) ? A(true, 'Yes: index 2, EV_UART. The table has three slots and only two were filled, so the third is zero. Fixes: check the pointer before calling, install a default handler in every slot, and add a build-time check that the table is full. Then verify by sending every event in a test.') : A(false, 'Not that. Print the table with p handlers and find the entry that is 0x0.'), answer: '2' },
      ],
      wrap: 'The method, on any Cortex-M: stop in the fault handler, dump eight words at the stack pointer that was in use, read pc and lr, translate them to source lines, then read the fault status registers. If the handler has pushed registers of its own, the frame is further up the stack. Cortex-M0 and M0+ cores (such as the MSPM0) have no CFSR or HFSR: there the stacked frame is all you get.',
    };
  }
  if (name === 'stuck-loop') {
    return {
      title: 'Stuck: waiting for a bit that never sets',
      brief: 'This firmware should read the ADC once and light the LED. The LED never comes on and nothing crashes. Find out what it is waiting for.',
      questions: [
        { id: 'func', q: 'Let it run and interrupt it. Which function is it stuck in?', hints: ['continue, then Ctrl-C. Interrupt a few times: is it always in the same few instructions?'],
          check: (t) => /^adc_read(\(\))?$/i.test(t.trim()) ? A(true, 'Yes. Every interrupt lands in the same while loop.') : /main/i.test(t) ? A(false, 'main is the caller (frame #1 in bt). The innermost frame is where the processor is.') : A(false, 'Not that. Use continue, Ctrl-C, then bt.'), answer: 'adc_read' },
        { id: 'reg', q: 'Which peripheral register does the loop keep reading? Give its address.', hints: ['disassemble shows the loop. It loads an address from the literal pool, then reads through it.', 'The ".word" lines at the end of the function are the literal pool. Follow the ldr that the loop executes.', 'Or read the source: list adc_read, then p &ADC… does not work because macros are not in the debug info; the address is in bench.h and in the literal pool.'],
          check: (t) => { const v = num(t); if (v === 0x40003004) return A(true, 'Yes: 0x40003004, ADC_STATUS in the Bench-MCU register map.'); if (v === 0x40003000) return A(false, 'That is ADC_CTRL, written once before the loop to start the conversion. The loop reads a different register.'); if (v === 0x40003008) return A(false, 'That is ADC_DATA, read after the loop, which is never reached.'); return A(false, 'Not that. Look at the instructions between the two branches of the loop in disassemble.'); }, answer: '0x40003004' },
        { id: 'val', q: 'What value does that register hold right now?', hints: ['x/xw 0x40003004 reads it through the debug probe, or: p/x *(uint32_t *)0x40003004'],
          check: (t) => { const v = num(t); if (v === 1) return A(true, 'Yes: 1. Bit 0 is set, so the peripheral is reporting something. The loop is still spinning, so it must be looking at a different bit.'); if (v === 0) return A(false, 'Read it again on the halted target after the conversion was started.'); return A(false, 'Not that. Use x/xw with the address.'); }, answer: '0x00000001' },
        { id: 'bit', q: 'Which bit number is the loop testing?', hints: ['In the source the mask is ADC_READY. Find its definition with list 1,10.', 'In the disassembly: lsls r0, r0, #30 moves one bit into the sign position, and bmi branches if it is set. Which bit ends up at bit 31 after a shift left by 30?'],
          check: (t) => { const v = num(t.replace(/^bit\s*/i, '')); if (v === 1) return A(true, 'Yes, bit 1. The register map (docs/BENCH_MCU.md) defines DONE as bit 0 of ADC_STATUS; this code defines ADC_READY as 1 << 1. The conversion finishes, bit 0 goes high, and the loop waits forever for bit 1. Fix the mask, and add a timeout to every wait on hardware so that a wrong bit, a dead clock or a missing device becomes an error you can report instead of a silent hang.'); if (v === 0) return A(false, 'Bit 0 is the one that is set. If the loop tested it, the loop would have ended.'); if (v === 2) return A(false, 'The mask value is 2, which is bit number 1.'); if (v === 30 || v === 31) return A(false, 'That is the shift amount or the sign bit. Work out which bit of the register arrives at bit 31 after shifting left by 30.'); return A(false, 'Not that. Read the mask in the source or work it out from the shift in the disassembly.'); }, answer: '1' },
      ],
      wrap: 'You can prove the diagnosis without rebuilding: with the target halted in the loop, set var $pc to the address after the loop (disassemble shows it) and continue; the LED bit in GPIO_OUT (x/xw 0x40000004) comes on.',
    };
  }
  const wline = lineOf(prog, 'i <= NAME_LEN');
  const g = (n) => prog.globals.find((x) => x.name === n).addr;
  return {
    title: 'A variable that changes by itself',
    brief: 'A door controller sets door_locked = 1, stores the door name, and then finds door_locked is 0 and releases the strike. No line of the program assigns 0 to door_locked. Find the write.',
    questions: [
      { id: 'addr', q: 'Where is door_locked in memory? Give its address.', hints: ['p &door_locked'],
        check: (t) => { const v = num(t); if (v === g('door_locked')) return A(true, `Yes, ${hx8(v)}. Now look at what sits just below it: p &name_buf, p sizeof(name_buf).`); if (v === g('name_buf')) return A(false, 'That is name_buf. door_locked is its neighbour.'); return A(false, 'Not that. Print the address with p &door_locked.'); }, answer: hx8(g('door_locked')) },
      { id: 'func', q: 'Set a watchpoint on door_locked and continue until it changes from 1 to 0. Which function is executing?', hints: ['watch door_locked, then continue. The first stop is the legitimate assignment in main (0 to 1). Continue again.', 'GDB prints Old value, New value and the location.'],
        check: (t) => /^set_name(\(\))?$/i.test(t.trim()) ? A(true, 'Yes: set_name, which never mentions door_locked. A watchpoint uses a hardware comparator in the core, so it catches the write whoever makes it.') : /main/i.test(t) ? A(false, 'main makes the first change, 0 to 1. Continue to the next one.') : A(false, 'Not that. Use watch door_locked and continue twice.'), answer: 'set_name' },
      { id: 'i', q: 'What is i at that moment?', hints: ['info locals, or p i, while stopped at the watchpoint.', 'The watchpoint reports after the store, before i is incremented.'],
        check: (t) => { const v = num(t); if (v === 8) return A(true, 'Yes, 8. name_buf has 8 elements, indices 0 to 7. Index 8 is the first byte of whatever comes next in memory, and that is door_locked.'); if (v === 9) return A(false, 'You have stepped past the increment. At the moment the watchpoint fires i is one less.'); if (v === 7) return A(false, 'Index 7 is the last valid element, and writing it does not touch door_locked.'); return A(false, 'Not that. Stop at the second watchpoint hit and print i.'); }, answer: '8' },
      { id: 'line', q: 'Which line of dbg_badptr.c contains the mistake?', hints: ['The store is correct for indices 0 to 7. Which line lets i reach 8?', 'Compare the loop condition with the size of the array.'],
        check: (t) => { const v = num(t); if (v === wline) return A(true, `Yes, line ${wline}: "i <= NAME_LEN" runs nine times. The ninth copy is the string's terminating zero, which lands on the low byte of door_locked and turns 1 into 0. Fix: "<", and pass the destination size to every copy. Verify with the same watchpoint: it must fire once only. In a product this is the classic one-byte overflow; where the neighbour is a lock flag, a length or a pointer, it is exploitable.`); if (v === wline + 1) return A(false, 'That line does the store, and it is the right store for a correct index. The fault is in what allows the index to go one too far.'); return A(false, 'Not that. Look at the loop in set_name.'); }, answer: String(wline) },
    ],
    wrap: 'Without a watchpoint you can find the same thing by inspection: x/12xb &name_buf before and after set_name shows the ninth byte changing. Watchpoints are a limited resource (a Cortex-M4 typically has four comparators), so remove them when you are done.',
  };
}

/* ------------------------------------------------------------------ UI */

const SCENARIOS = ['tour', 'hardfault', 'stuck-loop', 'bad-pointer'];
const QUICK = { tour: ['info registers', 'list', 'step', 'next', 'p total'], hardfault: ['continue', 'bt', 'x/8xw $sp', 'p handlers', 'x/xw 0xE000ED28'], 'stuck-loop': ['continue', 'bt', 'disassemble', 'x/xw 0x40003004'], 'bad-pointer': ['watch door_locked', 'continue', 'info locals', 'x/12xb &name_buf'] };

export default function mount(el, props = {}, ctx = { complete() {}, isDone: () => false }) {
  clear(el);
  el.classList.add('debug-session');
  let name = SCENARIOS.includes(props.scenario) ? props.scenario : 'tour';
  let sess, info, solved, hintN, tries, history, hpos;

  const tabs = h('div', { class: 'w-tabs', role: 'tablist', 'aria-label': 'Scenario' });
  const task = h('div', { class: 'w-task' });
  const ocd = h('div', { class: 'w-term dbg-ocd', tabindex: 0, role: 'log', 'aria-label': 'OpenOCD output' });
  const out = h('div', { class: 'w-term dbg-gdb', tabindex: 0, role: 'log', 'aria-label': 'GDB console', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', class: 'w-term-in', 'aria-label': 'GDB command', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'type a GDB command, Enter to run' });
  const intBtn = h('button', { class: 'btn small', type: 'button', disabled: true, onclick: () => interrupt() }, 'Ctrl-C (interrupt)');
  const prompt = h('span', { class: 'dbg-prompt w-mono' }, '(gdb)');
  const quick = h('div', { class: 'row dbg-quick' });
  const qbox = h('div', { class: 'dbg-questions' });
  const srcBox = h('details', { class: 'dbg-src' });
  const refBox = h('div', {});

  const print = (text, cls) => { if (text === '' || text == null) return; out.append(h('span', { class: cls || null }, text + '\n')); out.scrollTop = out.scrollHeight; };
  const syncOcd = () => { clear(ocd); ocd.append(sess.ocd.join('\n') + '\n'); ocd.scrollTop = ocd.scrollHeight; };
  const setRunning = () => { intBtn.disabled = !sess.running; prompt.textContent = sess.running ? '(running)' : '(gdb)'; el.classList.toggle('dbg-running', sess.running); };

  function run(cmd) {
    print(`(gdb) ${cmd}`, 'dbg-cmd');
    let res;
    try { res = sess.exec(cmd); } catch (e) { res = `[sim] internal error: ${e.message}`; }
    print(res);
    after();
  }
  function interrupt() { if (!sess.running) return; print('^C', 'dbg-cmd'); print(sess.interrupt()); after(); input.focus(); }
  function after() { syncOcd(); setRunning(); renderSteps(); renderSource(); }

  function renderSteps() {
    clear(task).append(h('p', {}, h('strong', {}, info.title + '. '), info.brief));
    if (info.steps) {
      const firstOpen = info.steps.findIndex(([flag]) => !sess.flags.has(flag));
      task.append(h('ol', { class: 'dbg-steps' }, info.steps.map(([flag, label, cmd], i) => h('li', { class: sess.flags.has(flag) ? 'done' : i === firstOpen ? 'next' : null },
        label, sess.flags.has(flag) || i === firstOpen ? h('code', {}, ' ' + cmd) : null, sess.flags.has(flag) ? ' ✓' : ''))));
    }
    checkDone();
  }
  function checkDone() {
    const stepsOk = !info.steps || info.steps.every(([flag]) => sess.flags.has(flag) || solvedSteps.has(flag));
    if (info.steps) for (const [flag] of info.steps) if (sess.flags.has(flag)) solvedSteps.add(flag);
    if (stepsOk && info.questions.every((q) => solved[q.id])) {
      if (!el.querySelector('.dbg-wrap')) qbox.append(h('p', { class: 'w-msg ok dbg-wrap' }, info.wrap));
      ctx.complete();
    }
  }
  let solvedSteps = new Set();

  function renderQuestions() {
    clear(qbox).append(h('h4', {}, 'Questions'));
    info.questions.forEach((q, i) => {
      const msg = h('div', { class: 'w-msg', hidden: true, 'aria-live': 'polite' });
      const hints = h('div', {});
      const reveal = h('div', {});
      const field = h('input', { type: 'text', class: 'w-mono', 'aria-label': `Answer to question ${i + 1}`, autocomplete: 'off', spellcheck: 'false' });
      const hintBtn = h('button', { class: 'btn small ghost', type: 'button', onclick: () => { hintN[q.id] = Math.min((hintN[q.id] || 0) + 1, q.hints.length); clear(hints).append(q.hints.slice(0, hintN[q.id]).map((x) => h('p', { class: 'w-note' }, 'Hint: ' + x))); hintBtn.disabled = hintN[q.id] >= q.hints.length; } }, 'Hint');
      qbox.append(h('div', { class: 'dbg-q' }, h('p', {}, h('strong', {}, `${i + 1}. `), q.q),
        h('form', { class: 'row', onsubmit: (e) => {
          e.preventDefault();
          const r = q.check(field.value);
          tries[q.id] = (tries[q.id] || 0) + 1;
          msg.hidden = false; msg.className = 'w-msg ' + (r.ok ? 'ok' : 'bad'); msg.textContent = r.msg;
          if (r.ok) { solved[q.id] = true; checkDone(); }
          else if (tries[q.id] >= 3 && !reveal.firstChild) reveal.append(h('button', { class: 'btn small ghost', type: 'button', onclick: () => clear(reveal).append(h('p', { class: 'w-note' }, 'Answer: ', h('code', {}, q.answer), '. Reproduce it in the console before moving on.')) }, 'Show the answer'));
        } }, field, h('button', { class: 'btn small', type: 'submit' }, 'Check'), hintBtn), hints, msg, reveal));
    });
  }

  function renderSource() {
    const file = sess.prog.file;
    const lines = sess.src[file];
    let cur = 0;
    if (sess.connected && !sess.sim.lockup && !sess.running) { const fr = sess.frames()[0]; const ln = fr && !fr.sig ? sess.frameLine(fr) : null; if (ln && ln.file === file) cur = ln.line; }
    const open = srcBox.open;
    clear(srcBox).append(h('summary', {}, `Source: src/${file}` + (cur ? ` (stopped at line ${cur})` : '')),
      h('pre', { class: 'w-mono dbg-code' }, lines.map((t, i) => h('span', { class: i + 1 === cur ? 'dbg-cur' : null }, `${String(i + 1).padStart(3)}  ${t}\n`))),
      h('p', { class: 'w-note' }, 'startup.c (vector table and Reset_Handler) is part of the program too: list Reset_Handler shows it.'));
    srcBox.open = open;
  }

  function renderRef() {
    clear(refBox);
    if (name === 'hardfault') {
      refBox.append(h('details', { class: 'dbg-ref', open: true }, h('summary', {}, 'Reference: exception frame and fault registers'),
        h('div', { class: 'w-grid' },
          h('div', {}, h('p', {}, h('strong', {}, 'Stack frame pushed on exception entry')), h('pre', { class: 'w-mono' }, 'sp+0   r0\nsp+4   r1\nsp+8   r2\nsp+12  r3\nsp+16  r12\nsp+20  lr   (return address of the interrupted code)\nsp+24  pc   (instruction that faulted or was interrupted)\nsp+28  xpsr'),
            h('p', { class: 'w-note' }, 'In the handler the lr register holds EXC_RETURN (0xFFFFFFF9 here: return to thread mode using the main stack), not a code address.')),
          h('div', {}, h('p', {}, h('strong', {}, 'System Control Block, ARMv7-M (Cortex-M3/M4/M7)')), h('pre', { class: 'w-mono' }, '0xE000ED28  CFSR   bits 0-7   MemManage: IACCVIOL 0, DACCVIOL 1,\n                              MUNSTKERR 3, MSTKERR 4, MMARVALID 7\n                   bits 8-15  BusFault: IBUSERR 8, PRECISERR 9,\n                              IMPRECISERR 10, UNSTKERR 11,\n                              STKERR 12, BFARVALID 15\n                   bits 16-31 UsageFault: UNDEFINSTR 16, INVSTATE 17,\n                              INVPC 18, NOCP 19, UNALIGNED 24,\n                              DIVBYZERO 25\n0xE000ED2C  HFSR   VECTTBL 1, FORCED 30 (escalated from another fault)\n0xE000ED34  MMFAR  faulting address, valid if MMARVALID\n0xE000ED38  BFAR   faulting address, valid if BFARVALID'),
            h('p', { class: 'w-note' }, 'CFSR bits are sticky: write 1 to clear them, or the next fault adds to the old ones.')))));
    }
  }

  function start(n) {
    name = n; sess = new GdbSession(name); info = scenarioInfo(name);
    solved = {}; hintN = {}; tries = {}; history = []; hpos = 0; solvedSteps = new Set();
    clear(tabs).append(SCENARIOS.map((sc) => h('button', { class: 'w-tab' + (sc === name ? ' on' : ''), role: 'tab', 'aria-selected': String(sc === name), onclick: () => start(sc) }, sc)));
    clear(out); print(sess.intro);
    clear(quick).append(
      name !== 'tour' ? h('button', { class: 'btn small', type: 'button', title: SETUP.join(' ; '), onclick: () => { if (sess.running) return; for (const c of SETUP) run(c); input.focus(); } }, 'Run the four setup commands') : null,
      QUICK[name].map((c) => h('button', { class: 'btn small ghost w-mono', type: 'button', onclick: () => { input.value = c; input.focus(); } }, c)),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => run('help') }, 'help'),
      h('button', { class: 'btn small ghost', type: 'button', onclick: () => start(name) }, 'Restart'));
    renderQuestions(); renderRef(); after();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'c' && e.ctrlKey) { if (sess.running) { e.preventDefault(); interrupt(); } else if (input.selectionStart === input.selectionEnd) { e.preventDefault(); print('(gdb) ' + input.value + '^C', 'dbg-cmd'); input.value = ''; } return; }
    if (e.key === 'Enter') { e.preventDefault(); const c = input.value; input.value = ''; if (c.trim()) { history.push(c); } hpos = history.length; run(c); return; }
    if (e.key === 'ArrowUp') { if (hpos > 0) { hpos--; input.value = history[hpos]; e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { if (hpos < history.length) { hpos++; input.value = history[hpos] || ''; e.preventDefault(); } }
  });

  el.append(
    h('p', { class: 'w-msg warn dbg-banner' }, h('strong', {}, 'This is a simulation of the workflow, not GDB or OpenOCD. '),
      'The programs are real compiled code run by a small Cortex-M simulator in the page; the consoles imitate a subset of GDB commands and the form of OpenOCD\'s log. Lines starting with [sim] are from the simulation, not something GDB would print. No hardware is involved.'),
    tabs, task,
    h('div', { class: 'dbg-panes' },
      h('div', { class: 'dbg-pane' }, h('div', { class: 'dbg-title' }, 'Terminal 1: OpenOCD (talks to the probe, serves GDB on port 3333)'), ocd),
      h('div', { class: 'dbg-pane' }, h('div', { class: 'dbg-title' }, 'Terminal 2: GDB (talks to OpenOCD, knows your symbols)'), out,
        h('div', { class: 'dbg-inrow' }, prompt, input, intBtn))),
    quick, srcBox, qbox, refBox,
    h('details', { class: 'dbg-real' }, h('summary', {}, 'Starting a real session'),
      h('p', {}, 'Two programs, two terminals. OpenOCD drives the debug probe and exposes a GDB server; GDB loads your ELF for symbols and connects to it.'),
      h('p', {}, h('strong', {}, 'Cortex-M with a CMSIS-DAP probe')),
      h('pre', { class: 'w-mono' }, '# terminal 1\nopenocd -f interface/cmsis-dap.cfg -f target/<chip>.cfg\n# terminal 2\narm-none-eabi-gdb build/app.elf\n(gdb) target extended-remote :3333\n(gdb) monitor reset halt\n(gdb) load\n(gdb) monitor reset halt\n(gdb) break main\n(gdb) continue'),
      h('p', {}, h('strong', {}, 'TI MSPM0 LaunchPad with its on-board XDS110. '), 'Upstream OpenOCD has an MSPM0 flash driver whose part table includes the MSPM0L2228, and a board file that selects interface/xds110.cfg and target/ti/mspm0.cfg:'),
      h('pre', { class: 'w-mono' }, 'openocd -f board/ti/mspm0-launchpad.cfg'),
      h('p', { class: 'w-note' }, 'You need an OpenOCD build recent enough to contain those files; check with your installed version. The MSPM0L2228 is a Cortex-M0+: it has no CFSR or HFSR.'),
      h('p', {}, h('strong', {}, 'ESP32 family. '), 'ESP-IDF wraps both terminals:'),
      h('pre', { class: 'w-mono' }, 'idf.py openocd gdb'),
      h('p', { class: 'w-note' }, 'OpenOCD still needs the board configuration that matches your probe and chip. For example, openocd -f board/esp32-wrover-kit-3.3v.cfg is for that one kit only; use the config for your hardware and follow the JTAG debugging chapter of the ESP-IDF Programming Guide. Chips with a built-in USB Serial/JTAG controller (ESP32-C3, ESP32-S3, ESP32-C6) can be debugged over their USB pins without an external probe. The original ESP32 is an Xtensa core: the workflow is the same, the registers and fault reports are not.')),
    h('p', { class: 'w-note' }, `Model: Bench-MCU, a fictional target (flash at 0x08000000, RAM at 0x20000000, see the Bench-MCU reference). The programs were compiled with ${TOOLCHAIN} at -O0 -g for the ARMv6-M instruction subset so the simulator can execute every instruction; the simulated core adds the ARMv7-M fault status registers. Instruction text in x/i and disassemble is llvm-objdump's, which differs slightly from GDB's. Not modelled: timing, interrupts, flash programming details, probe errors, RTOS threads, and most of GDB.`));

  start(name);
}
