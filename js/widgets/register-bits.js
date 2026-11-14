// A 32-bit register with clickable bits and a C-expression box. Challenges must be solved with an expression.
import { h, clear, hex } from '../core/dom.js';

// ------------------------------------------------------------------------------------------------ evaluator
// A small evaluator for C integer statements with 32-bit unsigned semantics. No eval(), no Function().
const TYPES = new Set(['uint32_t', 'uint16_t', 'uint8_t', 'unsigned', 'int', 'long', 'volatile', 'const', 'static']);
const OPS3 = ['<<=', '>>='];
const OPS2 = ['<<', '>>', '|=', '&=', '^=', '+=', '-=', '*=', '==', '!=', '<=', '>=', '&&', '||'];
const ASSIGN = new Set(['=', '|=', '&=', '^=', '+=', '-=', '*=', '<<=', '>>=']);

export function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (/[0-9]/.test(ch)) {
      const m = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uUlL]*)/.exec(src.slice(i));
      const body = m[1]; let v;
      if (/^0[xX]/.test(body)) v = parseInt(body.slice(2), 16); else if (/^0[bB]/.test(body)) v = parseInt(body.slice(2), 2); else v = parseInt(body, 10);
      if (/^[A-Za-z_0-9]/.test(src[i + m[0].length] || '')) throw new Error(`"${src.slice(i, i + m[0].length + 1)}…" is not a valid number`);
      if (v > 0xFFFFFFFF) throw new Error(`${body} does not fit in 32 bits`);
      out.push({ t: 'num', v: v >>> 0 }); i += m[0].length; continue;
    }
    if (/[A-Za-z_]/.test(ch)) { const m = /^[A-Za-z_]\w*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
    const three = OPS3.find((o) => src.startsWith(o, i)); if (three) { out.push({ t: 'op', v: three }); i += 3; continue; }
    const two = OPS2.find((o) => src.startsWith(o, i)); if (two) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%&|^~!<>=();'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    throw new Error(`unexpected character "${ch}"`);
  }
  return out;
}

const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
function binop(op, a, b) {
  switch (op) {
    case '||': return (a || b) ? 1 : 0; case '&&': return (a && b) ? 1 : 0;
    case '|': return (a | b) >>> 0; case '^': return (a ^ b) >>> 0; case '&': return (a & b) >>> 0;
    case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
    case '<<': case '>>':
      if (b >= 32) throw new Error(`shift by ${b}: shifting a 32-bit value by 32 or more is undefined behaviour in C`);
      return op === '<<' ? (a << b) >>> 0 : a >>> b;
    case '+': return (a + b) >>> 0; case '-': return (a - b) >>> 0; case '*': return Math.imul(a, b) >>> 0;
    case '/': case '%': if (b === 0) throw new Error('division by zero'); return op === '/' ? Math.floor(a / b) >>> 0 : a % b;
  }
  throw new Error('unknown operator ' + op);
}

/**
 * Run statements such as `reg |= (1u << 5); x = (reg >> 8) & 0xF;` against `env` (name → number).
 * Returns { env, error, stmts: [{ target, op, readsTarget }] }. All arithmetic is uint32_t.
 */
export function run(src, env0 = {}) {
  const env = { ...env0 };
  const stmts = [];
  try {
    const toks = tokenize(String(src));
    let p = 0, reads;
    const peek = () => toks[p]; const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const expr = (lvl = 0) => {
      if (lvl === BIN.length) return unary();
      let a = expr(lvl + 1);
      while (peek() && peek().t === 'op' && BIN[lvl].includes(peek().v)) { const op = toks[p++].v; a = binop(op, a, expr(lvl + 1)); }
      return a;
    };
    const unary = () => {
      if (isOp('~')) { p++; return (~unary()) >>> 0; }
      if (isOp('!')) { p++; return unary() ? 0 : 1; }
      if (isOp('-')) { p++; return (-unary()) >>> 0; }
      if (isOp('+')) { p++; return unary(); }
      return primary();
    };
    const primary = () => {
      const t = toks[p];
      if (!t) throw new Error('the expression ends too early');
      if (t.t === 'num') { p++; return t.v; }
      if (t.t === 'id') {
        if (TYPES.has(t.v)) throw new Error(`"${t.v}" is a type, not a value`);
        if (!(t.v in env)) throw new Error(`unknown name "${t.v}"`);
        p++; reads.add(t.v); return env[t.v] >>> 0;
      }
      if (t.v === '(') {
        p++;
        if (toks[p] && toks[p].t === 'id' && TYPES.has(toks[p].v)) { // a cast
          let mask = 0xFFFFFFFF;
          while (toks[p] && toks[p].t === 'id' && TYPES.has(toks[p].v)) { if (toks[p].v === 'uint8_t') mask = 0xFF; if (toks[p].v === 'uint16_t') mask = 0xFFFF; p++; }
          if (!isOp(')')) throw new Error('expected ")" after the cast type'); p++;
          return (unary() & mask) >>> 0;
        }
        const v = expr();
        if (!isOp(')')) throw new Error('missing ")"'); p++;
        return v;
      }
      throw new Error(`unexpected "${t.v}"`);
    };
    while (p < toks.length) {
      if (isOp(';')) { p++; continue; }
      reads = new Set();
      while (toks[p] && toks[p].t === 'id' && TYPES.has(toks[p].v) && toks[p + 1] && toks[p + 1].t === 'id') p++; // optional declaration type
      if (toks[p].t === 'id' && toks[p + 1] && toks[p + 1].t === 'op' && ASSIGN.has(toks[p + 1].v)) {
        const target = toks[p].v, op = toks[p + 1].v; p += 2;
        if (TYPES.has(target)) throw new Error(`"${target}" is a type name`);
        const rhs = expr();
        if (op !== '=' && !(target in env)) throw new Error(`unknown name "${target}"`);
        env[target] = op === '=' ? rhs : binop(op.slice(0, -1), env[target] >>> 0, rhs);
        stmts.push({ target, op, readsTarget: op !== '=' || reads.has(target) });
      } else { const v = expr(); env._ = v; stmts.push({ target: null, op: null, readsTarget: false }); }
      if (p < toks.length && !isOp(';')) throw new Error(`unexpected "${toks[p].v}" — is an operator or ";" missing?`);
    }
    return { env, error: null, stmts };
  } catch (e) { return { env: { ...env0 }, error: e.message, stmts }; }
}

// ------------------------------------------------------------------------------------------------ challenges
const TESTS = [0xA5A50F5A, 0x00000000, 0xFFFFFFFF, 0x12345678];
export const CHALLENGES = {
  'set-bit': {
    title: 'Set a bit', consts: {},
    prompt: 'Bit 5 of `reg` is ENABLE. Write one statement that sets bit 5 and leaves every other bit as it was.',
    expect: (r) => ({ reg: (r | 0x20) >>> 0 }),
    diagnose(r, got) {
      if (got.reg === 0x20) return 'Your statement left reg = 0x00000020: bit 5 is set, and all 31 other bits are now 0. Plain `=` replaces the whole register. On hardware you would have switched off everything the other bits controlled. Use `|=` so the old value is kept.';
      if (got.reg === ((r | 5) >>> 0)) return 'You ORed in the number 5, which is binary 101: bits 0 and 2. "Bit 5" means the bit worth 2⁵, written `1u << 5` or 0x20.';
      if (got.reg === ((r ^ 0x20) >>> 0)) return 'XOR toggles. It sets the bit only when it was 0; when ENABLE was already 1 your statement cleared it. Setting must work whatever the old value was.';
      if (got.reg === ((r | 0x10) >>> 0) || got.reg === ((r | 0x40) >>> 0)) return 'Off by one: bits are numbered from 0, so bit 5 is the sixth from the right, value 0x20.';
      return null;
    },
  },
  'clear-bit': {
    title: 'Clear a bit', consts: {},
    prompt: 'Bit 3 of `reg` is IRQ_EN. Write one statement that clears bit 3 and leaves the rest alone.',
    expect: (r) => ({ reg: (r & ~8) >>> 0 }),
    diagnose(r, got) {
      if (got.reg === ((r & 8) >>> 0)) return 'You forgot the `~`. `reg &= (1u << 3)` keeps bit 3 and clears the other 31 bits — the exact opposite. The mask for clearing must be 1 everywhere except the bit to clear: `~(1u << 3)`.';
      if (got.reg === 0) return 'reg is now 0: every bit was cleared, not just bit 3.';
      if (got.reg === ((r ^ 8) >>> 0)) return 'XOR toggles: it clears the bit only if it was 1, and sets it if it was 0. Clearing must work whatever the old value was.';
      if (got.reg === ((r | 8) >>> 0)) return 'That sets bit 3. OR can only turn bits on; clearing needs AND with a mask that has a 0 in that position.';
      if (got.reg === ((r - 8) >>> 0)) return 'Subtracting 8 clears bit 3 only when it was set; otherwise it borrows from the higher bits and corrupts them.';
      return null;
    },
  },
  toggle: {
    title: 'Toggle a bit', consts: {},
    prompt: 'Bit 7 of `reg` drives an LED. Write one statement that inverts bit 7 and leaves the rest alone.',
    expect: (r) => ({ reg: (r ^ 0x80) >>> 0 }),
    diagnose(r, got) {
      if (got.reg === ((~r) >>> 0)) return '`~reg` inverts all 32 bits. Only bit 7 should change: XOR with a mask that has a 1 in bit 7 only.';
      if (got.reg === ((r | 0x80) >>> 0)) return 'That sets bit 7. It turns the LED on but never off again.';
      if (got.reg === 0x80) return 'Plain `=` replaced the whole register with 0x80.';
      return null;
    },
  },
  'field-write': {
    title: 'Write a multi-bit field', consts: { MASK: 0x70, POS: 4 }, vals: [5, 2, 7, 0],
    prompt: 'Bits [6:4] of `reg` are the 3-bit MODE field. `MASK` is `0x7u << 4`, `POS` is 4, and `val` holds the new mode (0–7). Write one statement that sets MODE to `val` and leaves the rest alone.',
    expect: (r, e) => ({ reg: ((r & ~0x70) | (e.val << 4)) >>> 0 }),
    diagnose(r, got, e) {
      if (got.reg === ((r | (e.val << 4)) >>> 0)) return `You ORed the new value in without clearing the field first. OR cannot turn bits off: if MODE was 010 and you write 101 you get 111. With reg = ${hex(r)} and val = ${e.val}, MODE became ${(got.reg >> 4) & 7} instead of ${e.val}. Clear the field with \`& ~MASK\`, then OR.`;
      if (got.reg === ((e.val << 4) >>> 0)) return 'The field is right but every other bit of reg is now 0. Keep the rest: `(reg & ~MASK) | …`.';
      if (got.reg === (((r & ~0x70) | e.val) >>> 0)) return 'You cleared the field correctly but ORed `val` into bits [2:0]. The value has to be moved to where the field is: `val << POS`.';
      if (got.reg === (((r & 0x70) | (e.val << 4)) >>> 0)) return 'You forgot the `~`: `reg & MASK` keeps the old field and clears everything else. To clear only the field, AND with `~MASK`.';
      return null;
    },
  },
  'field-read': {
    title: 'Read a multi-bit field', consts: {}, target: 'x',
    prompt: 'Bits [11:8] of `reg` are the 4-bit DIV field. Write one statement that puts the value of DIV (0–15) into `x`. `reg` must not change.',
    expect: (r) => ({ reg: r >>> 0, x: (r >>> 8) & 0xF }),
    diagnose(r, got) {
      if (got.reg !== r) return 'Your statement changed reg. Reading a field must not write the register: assign to x and use `>>` and `&`, not `>>=` or `&=`.';
      if (got.x === ((r & 0xF00) >>> 0)) return `You masked but did not shift: x = ${hex(got.x)} still has the field sitting in bits [11:8]. For DIV = 5 you would get 0x500 (1280), not 5. Shift right by 8.`;
      if (got.x === (r >>> 8)) return `You shifted but did not mask, so the bits above the field came along: x = ${hex(got.x)}. AND with 0xF to keep four bits.`;
      if (got.x === ((r & 0xF) >>> 0)) return 'That reads bits [3:0]. Shift right by 8 first so DIV is at the bottom, then mask.';
      if (got.x === (((r >>> 8) & 0xF00) >>> 0)) return 'After shifting right by 8 the field is in bits [3:0], so the mask must be 0xF, not 0xF00.';
      return null;
    },
  },
};

/** Check a learner's statement against every test value. Returns { ok, text, shown } where `shown` is the env for the first test. */
export function checkChallenge(id, src) {
  const c = CHALLENGES[id];
  let shown = null;
  for (let i = 0; i < TESTS.length; i++) {
    const r = TESTS[i];
    const e0 = { reg: r, x: 0, ...c.consts, ...(c.vals ? { val: c.vals[i] } : {}) };
    const res = run(src, e0);
    if (i === 0) shown = res.env;
    if (res.error) return { ok: false, text: 'That does not parse as a C statement: ' + res.error + '.', shown: null };
    if (!res.stmts.some((s) => s.target)) return { ok: false, text: 'That is an expression with no assignment, so nothing is stored. Write a statement such as `reg |= …;` or `x = …;`.', shown };
    const want = c.expect(r, e0);
    const got = { reg: res.env.reg >>> 0, x: (res.env.x ?? 0) >>> 0 };
    const bad = Object.keys(want).some((k) => got[k] !== want[k]);
    if (bad) {
      const d = c.diagnose(r, got, e0);
      const k = 'x' in want && got.reg === r ? 'x' : 'reg';
      return { ok: false, text: (d || `Starting from reg = ${hex(r)}${c.vals ? ', val = ' + e0.val : ''}, your statement gives ${k} = ${hex(got[k])}; it should be ${hex(want[k])}.`) + (i > 0 ? ` (It happened to work for reg = ${hex(TESTS[0])}; a register can hold any value.)` : ''), shown };
    }
  }
  return { ok: true, text: 'Correct for every starting value tested.', shown };
}

// ------------------------------------------------------------------------------------------------ UI
const md = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>');

export default function mount(el, props = {}, ctx) {
  const fixed = CHALLENGES[props.challenge] ? props.challenge : null;
  let cid = fixed;                   // null = free play
  let env = { reg: TESTS[0], x: 0 };
  let msg = null; const solved = new Set();
  const root = h('div', { class: 'register-bits' });
  el.append(root);
  const input = h('input', { type: 'text', class: 'mono register-bits-in', 'aria-label': 'C statement', spellcheck: 'false', autocomplete: 'off', placeholder: 'reg |= (1u << 5);' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const view = h('div', {});

  function setChallenge(id) {
    cid = id; msg = null; input.value = '';
    env = { reg: TESTS[0], x: 0, ...(id ? CHALLENGES[id].consts : {}), ...(id && CHALLENGES[id].vals ? { val: CHALLENGES[id].vals[0] } : {}) };
    draw();
  }
  function go() {
    const src = input.value.trim(); if (!src) return;
    if (cid) {
      const res = checkChallenge(cid, src);
      if (res.shown) env = { ...env, ...res.shown };
      msg = { cls: res.ok ? 'ok' : 'bad', text: res.text, retry: !res.ok };
      if (res.ok) { solved.add(cid); if (!fixed || fixed === cid) ctx?.complete?.(); }
    } else {
      const res = run(src, env);
      if (res.error) msg = { cls: 'bad', text: res.error };
      else { env = res.env; msg = { cls: '', text: res.stmts.some((s) => s.target) ? 'Done.' : `Value: ${hex(env._)} = ${env._}` }; }
    }
    draw(); input.focus();
  }

  function draw() {
    clear(view);
    const c = cid ? CHALLENGES[cid] : null;
    if (!fixed) view.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Mode' },
      h('button', { type: 'button', class: 'w-tab' + (!cid ? ' on' : ''), onclick: () => setChallenge(null) }, 'Free play'),
      Object.entries(CHALLENGES).map(([id, t]) => h('button', { type: 'button', class: 'w-tab' + (id === cid ? ' on' : ''), onclick: () => setChallenge(id) }, (solved.has(id) ? '✓ ' : '') + t.title))));
    if (c) view.append(h('div', { class: 'w-task' }, h('p', { html: md(c.prompt) }),
      h('p', { class: 'w-note' }, 'Solve it by typing a C statement. Clicking bits is switched off here: on a real register you only have the expression.')));

    const reg = env.reg >>> 0;
    const bits = h('div', { class: 'register-bits-row', role: 'group', 'aria-label': 'Bits 31 down to 0' });
    for (let nib = 7; nib >= 0; nib--) {
      const g = h('div', { class: 'register-bits-nib' });
      for (let b = nib * 4 + 3; b >= nib * 4; b--) {
        const on = (reg >>> b) & 1;
        g.append(h('button', { type: 'button', class: 'w-bit register-bits-b' + (on ? ' on' : ''), disabled: !!c, 'aria-label': `bit ${b}, ${on}`, 'aria-pressed': String(!!on),
          onclick: () => { env.reg = (reg ^ (1 << b)) >>> 0; msg = null; draw(); view.querySelector(`[data-bit="${b}"]`)?.focus(); }, 'data-bit': b },
          h('span', { class: 'n' }, b), h('span', { class: 'v' }, on)));
      }
      g.append(h('div', { class: 'register-bits-hx w-mono' }, ((reg >>> (nib * 4)) & 0xF).toString(16).toUpperCase()));
      bits.append(g);
    }
    view.append(bits);
    const bin = reg.toString(2).padStart(32, '0').replace(/(.{8})(?=.)/g, '$1 ');
    const ro = h('div', { class: 'w-readout' },
      h('div', {}, h('div', { class: 'k' }, 'reg (hex)'), h('div', { class: 'v' }, hex(reg))),
      h('div', {}, h('div', { class: 'k' }, 'reg (decimal)'), h('div', { class: 'v' }, String(reg))),
      h('div', {}, h('div', { class: 'k' }, 'x'), h('div', { class: 'v' }, `${hex(env.x >>> 0)} = ${env.x >>> 0}`)));
    for (const [k, v] of Object.entries(env)) if (!['reg', 'x', '_'].includes(k)) ro.append(h('div', {}, h('div', { class: 'k' }, k), h('div', { class: 'v' }, k === 'MASK' ? hex(v) : String(v))));
    view.append(ro, h('p', { class: 'w-mono register-bits-bin' }, 'binary ' + bin));
    view.append(h('div', { class: 'row register-bits-form' }, input, h('button', { type: 'button', class: 'btn small', onclick: go }, c ? 'Check' : 'Run'),
      c && msg?.retry ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => setChallenge(cid) }, 'Restore reg and retry') : null,
      !c ? h('button', { type: 'button', class: 'btn small ghost', onclick: () => { env = { reg: 0, x: 0 }; msg = null; draw(); } }, 'Clear') : null));
    if (msg) view.append(h('p', { class: 'w-msg ' + msg.cls, 'aria-live': 'polite', html: md(msg.text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))) }));
    if (!c) view.append(h('p', { class: 'w-note' }, 'Try: ', ['reg |= (1u << 5);', 'reg &= ~(0x7u << 4);', 'reg = (reg & ~0xF00u) | (9u << 8);', 'x = (reg >> 8) & 0xF;', 'reg ^= 1u << 31;'].map((t) =>
      h('button', { type: 'button', class: 'linkbtn w-mono register-bits-eg', onclick: () => { input.value = t; input.focus(); } }, t))));
    view.append(h('p', { class: 'w-note' }, 'Model: every value is a uint32_t and arithmetic wraps modulo 2³². Supported: numbers (decimal, 0x, 0b, with u/U/L suffixes), names, ( ), ~ ! - * / % + - << >> & ^ | comparisons, and assignments = |= &= ^= += -= <<= >>=. Real C would do some of this arithmetic as signed int when you leave off the `u`; write `1u << n`, because `1 << 31` on a signed int is undefined behaviour.'));
  }
  root.append(view);
  setChallenge(cid);
}
