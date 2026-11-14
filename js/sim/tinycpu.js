// T16 — the teaching CPU behind the `cpu-stepper` widget. It is not a real processor.
//
// Machine
//   8 registers R0..R7, each 16 bits. PC and SP are separate 8-bit registers. Flags N Z C V.
//   Memory: 256 words of 16 bits, word-addressed (address 0x00..0xFF). Code and data share it.
//   Memory-mapped output: a store to address 0xF0 (LED) drives 8 LEDs from the low 8 bits. It reads back.
//   Stack: SP starts at 0xF0 and grows downward. CALL: SP <- SP-1, mem[SP] <- return address. RET pops.
//
// Instruction word (16 bits):   [15:12] opcode   [11] I   [10:8] rd (or condition)   [7:0] operand
//   I = 0: operand = rs in bits [7:5], 5-bit unsigned offset in bits [4:0]
//   I = 1: operand = 8-bit immediate or absolute address
//
//   0 HALT                      stop
//   1 MOV rd, rs  | LDI rd, #n  rd <- rs | rd <- n (zero-extended)             flags unchanged
//   2 LD  rd, [rs+off] | [addr] rd <- mem[...]                                 flags unchanged
//   3 ST  rd, [rs+off] | [addr] mem[...] <- rd                                 flags unchanged
//   4 ADD rd, rs|#n             rd <- rd + x                                   N Z C V
//   5 SUB rd, rs|#n             rd <- rd - x                                   N Z C V  (C = 1 means no borrow, as on ARM)
//   6 AND   7 OR   8 XOR        rd <- rd op x                                  N Z
//   9 SHL  A SHR  rd, rs|#n     logical shift by x & 15                        N Z, C = last bit shifted out
//   B CMP rd, rs|#n             flags of rd - x, result discarded              N Z C V
//   C B / BEQ / BNE / BCS / BCC / BMI / BPL addr     PC <- addr if condition   (condition in the rd field)
//   D CALL addr                 push PC, PC <- addr
//   E RET                       PC <- pop
//   F NOP
//
// Each instruction takes three phases, which step() performs one at a time:
//   fetch   : MAR <- PC, IR <- mem[MAR], PC <- PC + 1
//   decode  : split IR into fields, select operands
//   execute : ALU / memory access / branch, write-back

export const LED_ADDR = 0xF0;
export const SP_INIT = 0xF0;
export const MEM_SIZE = 256;

const OPS = ['HALT', 'MOV', 'LD', 'ST', 'ADD', 'SUB', 'AND', 'OR', 'XOR', 'SHL', 'SHR', 'CMP', 'B', 'CALL', 'RET', 'NOP'];
const OPCODE = Object.fromEntries(OPS.map((n, i) => [n, i]));
const CONDS = ['B', 'BEQ', 'BNE', 'BCS', 'BCC', 'BMI', 'BPL'];
const COND_TEXT = ['always', 'Z = 1', 'Z = 0', 'C = 1', 'C = 0', 'N = 1', 'N = 0'];
const ALU_OPS = new Set(['ADD', 'SUB', 'AND', 'OR', 'XOR', 'SHL', 'SHR', 'CMP']);
const h2 = (n) => '0x' + (n & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const h4 = (n) => '0x' + (n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');

// ----------------------------------------------------------------------------------------------- assembler
function parseNum(tok, syms) {
  let t = tok.trim().replace(/^#/, '');
  let neg = false;
  if (t.startsWith('-')) { neg = true; t = t.slice(1); }
  let v;
  if (/^0x[0-9a-f]+$/i.test(t)) v = parseInt(t.slice(2), 16);
  else if (/^0b[01]+$/i.test(t)) v = parseInt(t.slice(2), 2);
  else if (/^\d+$/.test(t)) v = parseInt(t, 10);
  else if (/^[A-Za-z_]\w*$/.test(t)) {
    if (!syms) return 0;
    if (!(t in syms)) throw new Error(`unknown name "${t}"`);
    v = syms[t];
  } else throw new Error(`cannot read "${tok.trim()}" as a number or name`);
  return neg ? -v : v;
}
const regNum = (tok) => { const m = /^r([0-7])$/i.exec(tok.trim()); return m ? +m[1] : -1; };
function needReg(tok, what) {
  const r = regNum(tok || '');
  if (r < 0) throw new Error(`${what} must be a register r0–r7, found "${(tok || '').trim() || 'nothing'}"`);
  return r;
}
function range(v, lo, hi, what) {
  if (v < lo || v > hi) throw new Error(`${what} ${v} does not fit (allowed ${lo}..${hi})`);
  return v;
}
function splitArgs(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '[') depth++; if (ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Encode one instruction. `syms` null on the first pass (names resolve to 0). */
function encode(mn, args, syms) {
  const op = (name, i, rd, operand) => ((OPCODE[name] << 12) | (i << 11) | (rd << 8) | (operand & 0xFF)) >>> 0;
  const argc = (n) => { if (args.length !== n) throw new Error(`${mn} takes ${n} operand${n === 1 ? '' : 's'}, found ${args.length}`); };
  if (mn === 'HALT' || mn === 'RET' || mn === 'NOP') { argc(0); return op(mn, 0, 0, 0); }
  if (mn === 'LDI') { argc(2); return op('MOV', 1, needReg(args[0], 'destination'), range(parseNum(args[1], syms), 0, 255, 'immediate')); }
  if (mn === 'MOV') {
    argc(2); const rd = needReg(args[0], 'destination'); const rs = regNum(args[1]);
    if (rs >= 0) return op('MOV', 0, rd, rs << 5);
    return op('MOV', 1, rd, range(parseNum(args[1], syms), 0, 255, 'immediate'));
  }
  if (mn === 'LD' || mn === 'ST') {
    argc(2); const rd = needReg(args[0], mn === 'LD' ? 'destination' : 'source');
    const m = /^\[(.*)\]$/.exec(args[1]);
    if (!m) throw new Error(`${mn} needs a memory operand in brackets, e.g. [r1], [r1+2] or [LED]`);
    const inner = m[1].trim();
    const parts = inner.split('+').map((x) => x.trim());
    const rs = regNum(parts[0]);
    if (rs >= 0) {
      if (parts.length > 2) throw new Error('only [register+offset] is allowed');
      const off = parts.length === 2 ? range(parseNum(parts[1], syms), 0, 31, 'offset') : 0;
      return op(mn, 0, rd, (rs << 5) | off);
    }
    return op(mn, 1, rd, range(parseNum(inner, syms), 0, 255, 'address'));
  }
  if (ALU_OPS.has(mn)) {
    argc(2); const rd = needReg(args[0], 'first operand'); const rs = regNum(args[1]);
    if (rs >= 0) return op(mn, 0, rd, rs << 5);
    return op(mn, 1, rd, range(parseNum(args[1], syms), 0, 255, 'immediate'));
  }
  if (CONDS.includes(mn)) { argc(1); return op('B', 1, CONDS.indexOf(mn), range(parseNum(args[0], syms), 0, 255, 'branch target')); }
  if (mn === 'CALL') { argc(1); return op('CALL', 1, 0, range(parseNum(args[0], syms), 0, 255, 'call target')); }
  throw new Error(`unknown instruction "${mn}"`);
}

/**
 * Assemble T16 source.
 * Syntax: `label:`  `MNEMONIC a, b`  `.word 1, 2, 0x10`  `.org 0x80`  `.equ NAME, value`  comments with `;` or `//`.
 * Returns { ok, words: Uint16Array(256), errors: [{line, msg}], labels, lineOf: {addr: line}, used: Set(addr) }.
 */
export function assemble(src) {
  const lines = String(src).split('\n');
  const errors = [];
  const syms = { LED: LED_ADDR };
  const items = []; // {line, addr, kind:'ins'|'word', mn, args}
  let addr = 0;
  const err = (line, msg) => errors.push({ line, msg });
  lines.forEach((raw, i) => {
    const line = i + 1;
    let t = raw.replace(/(;|\/\/).*$/, '').trim();
    if (!t) return;
    try {
      let m;
      while ((m = /^([A-Za-z_]\w*)\s*:\s*/.exec(t))) {
        const name = m[1];
        if (regNum(name) >= 0) throw new Error(`"${name}" is a register name and cannot be a label`);
        if (name in syms) throw new Error(`name "${name}" is defined twice`);
        syms[name] = addr; t = t.slice(m[0].length);
      }
      if (!t) return;
      const sp = t.search(/\s/);
      const head = (sp < 0 ? t : t.slice(0, sp));
      const rest = sp < 0 ? '' : t.slice(sp + 1);
      const args = splitArgs(rest);
      if (head.startsWith('.')) {
        const d = head.toLowerCase();
        if (d === '.equ') {
          if (args.length !== 2 || !/^[A-Za-z_]\w*$/.test(args[0])) throw new Error('.equ needs a name and a value: .equ COUNT, 5');
          if (args[0] in syms && args[0] !== 'LED') throw new Error(`name "${args[0]}" is defined twice`);
          syms[args[0]] = parseNum(args[1], syms);
        } else if (d === '.org') {
          if (args.length !== 1) throw new Error('.org needs one address');
          addr = range(parseNum(args[0], syms), 0, MEM_SIZE - 1, 'address');
        } else if (d === '.word') {
          if (!args.length) throw new Error('.word needs at least one value');
          for (const a of args) { items.push({ line, addr, kind: 'word', arg: a }); addr++; }
        } else throw new Error(`unknown directive "${head}"`);
      } else {
        const mn = head.toUpperCase();
        encode(mn, args, null); // syntax check now; names resolved in pass 2
        items.push({ line, addr, kind: 'ins', mn, args }); addr++;
      }
      if (addr > MEM_SIZE) throw new Error('program does not fit in 256 words of memory');
    } catch (e) { err(line, e.message); }
  });
  const words = new Uint16Array(MEM_SIZE);
  const lineOf = {}; const used = new Set();
  for (const it of items) {
    try {
      if (it.addr >= MEM_SIZE) continue;
      if (used.has(it.addr)) throw new Error(`address ${h2(it.addr)} is written twice (check .org)`);
      const w = it.kind === 'word' ? range(parseNum(it.arg, syms), -32768, 65535, 'word value') & 0xFFFF : encode(it.mn, it.args, syms);
      words[it.addr] = w; used.add(it.addr);
      if (it.kind === 'ins') lineOf[it.addr] = it.line;
    } catch (e) { if (!errors.some((x) => x.line === it.line)) err(it.line, e.message); }
  }
  errors.sort((a, b) => a.line - b.line);
  return { ok: errors.length === 0, words, errors, labels: syms, lineOf, used };
}

// ----------------------------------------------------------------------------------------------- decode / disassemble
export function decode(word) {
  const op = (word >> 12) & 0xF, I = (word >> 11) & 1, rd = (word >> 8) & 7, operand = word & 0xFF;
  return { op, name: OPS[op], I, rd, operand, rs: (operand >> 5) & 7, off: operand & 0x1F, imm: operand };
}
export function disasm(word) {
  const d = decode(word);
  const src = d.I ? '#' + d.imm : 'r' + d.rs;
  switch (d.name) {
    case 'HALT': case 'RET': case 'NOP': return d.name;
    case 'MOV': return d.I ? `LDI r${d.rd}, #${d.imm}` : `MOV r${d.rd}, r${d.rs}`;
    case 'LD': case 'ST': return `${d.name} r${d.rd}, ` + (d.I ? `[${h2(d.imm)}]` : `[r${d.rs}${d.off ? '+' + d.off : ''}]`);
    case 'B': return `${CONDS[d.rd] || 'B?'} ${h2(d.imm)}`;
    case 'CALL': return `CALL ${h2(d.imm)}`;
    default: return `${d.name} r${d.rd}, ${src}`;
  }
}

// ----------------------------------------------------------------------------------------------- machine
export function createCpu(words) {
  const mem = new Uint16Array(MEM_SIZE);
  if (words) mem.set(words.slice ? words.slice(0, MEM_SIZE) : words);
  return {
    r: new Uint16Array(8), pc: 0, sp: SP_INIT, ir: 0, mar: 0,
    flags: { N: 0, Z: 0, C: 0, V: 0 },
    mem, phase: 'fetch', halted: false, error: null, cycles: 0, instrs: 0, ledWrites: 0,
    dec: null,
  };
}

function setNZ(c, v) { c.flags.N = (v >> 15) & 1; c.flags.Z = (v & 0xFFFF) === 0 ? 1 : 0; }

/** The ALU alone, so it can be tested: returns {result, N, Z, C, V} (C/V null when the operation leaves them alone). */
export function alu(name, a, b) {
  a &= 0xFFFF; b &= 0xFFFF;
  let res, C = null, V = null;
  switch (name) {
    case 'ADD': { const s = a + b; res = s & 0xFFFF; C = s > 0xFFFF ? 1 : 0; V = (~(a ^ b) & (a ^ res) & 0x8000) ? 1 : 0; break; }
    case 'SUB': case 'CMP': { const s = a - b; res = s & 0xFFFF; C = a >= b ? 1 : 0; V = ((a ^ b) & (a ^ res) & 0x8000) ? 1 : 0; break; }
    case 'AND': res = a & b; break;
    case 'OR': res = a | b; break;
    case 'XOR': res = a ^ b; break;
    case 'SHL': { const n = b & 15; res = (a << n) & 0xFFFF; if (n) C = (a >> (16 - n)) & 1; break; }
    case 'SHR': { const n = b & 15; res = a >>> n; if (n) C = (a >> (n - 1)) & 1; break; }
    default: throw new Error('not an ALU operation: ' + name);
  }
  return { result: res, N: (res >> 15) & 1, Z: res === 0 ? 1 : 0, C, V };
}

const condTrue = (cond, fl) => [true, fl.Z === 1, fl.Z === 0, fl.C === 1, fl.C === 0, fl.N === 1, fl.N === 0][cond];

/**
 * Perform one phase. Returns a description of what happened:
 * { phase, text, parts: [datapath block ids that were active], read: addr|null, write: addr|null }.
 * Datapath ids: pc, mar, mem, ir, dec, regs, alu, flags, sp, led.
 */
export function step(c) {
  if (c.halted) return { phase: 'halted', text: c.error || 'The CPU has halted. Reset to run again.', parts: [], read: null, write: null };
  c.cycles++;
  if (c.phase === 'fetch') {
    c.mar = c.pc;
    c.ir = c.mem[c.mar];
    const text = `Fetch: the address in PC (${h2(c.pc)}) goes to memory; the word there (${h4(c.ir)}) is copied into the instruction register. PC becomes ${h2(c.pc + 1)} so it already points at the next instruction.`;
    c.pc = (c.pc + 1) & 0xFF;
    c.phase = 'decode';
    return { phase: 'fetch', text, parts: ['pc', 'mar', 'mem', 'ir'], read: c.mar, write: null };
  }
  if (c.phase === 'decode') {
    const d = decode(c.ir);
    c.dec = d;
    const bits = c.ir.toString(2).padStart(16, '0');
    const fields = `${bits.slice(0, 4)} ${bits[4]} ${bits.slice(5, 8)} ${bits.slice(8)}`;
    let text = `Decode: IR = ${fields} → opcode ${d.op} (${d.name}), I = ${d.I}, `;
    if (d.name === 'B') text += `condition ${d.rd} (${COND_TEXT[d.rd] || 'undefined'}), target ${h2(d.imm)}.`;
    else if (d.name === 'CALL') text += `target ${h2(d.imm)}.`;
    else if (d.name === 'HALT' || d.name === 'RET' || d.name === 'NOP') text += 'no operands.';
    else text += `rd = r${d.rd}, ` + (d.I ? `immediate/address ${h2(d.imm)}.` : `rs = r${d.rs}` + ((d.name === 'LD' || d.name === 'ST') ? `, offset ${d.off}.` : '.'));
    text += ` This is "${disasm(c.ir)}".`;
    c.phase = 'execute';
    return { phase: 'decode', text, parts: ['ir', 'dec'], read: null, write: null };
  }
  // execute
  const d = c.dec || decode(c.ir);
  const out = { phase: 'execute', text: '', parts: [], read: null, write: null };
  const x = d.I ? d.imm : c.r[d.rs];
  const xs = d.I ? `#${d.imm}` : `r${d.rs} (${h4(c.r[d.rs])})`;
  c.phase = 'fetch'; c.instrs++;
  switch (d.name) {
    case 'HALT':
      c.halted = true; out.text = 'Execute: HALT. The clock keeps running on a real chip; here the model simply stops.'; out.parts = ['dec'];
      break;
    case 'NOP': out.text = 'Execute: NOP does nothing for one instruction time.'; out.parts = ['dec']; break;
    case 'MOV':
      c.r[d.rd] = x; out.text = `Execute: r${d.rd} ← ${xs} = ${h4(c.r[d.rd])}. Flags are not changed.`; out.parts = d.I ? ['ir', 'regs'] : ['regs'];
      break;
    case 'LD': case 'ST': {
      const ea = d.I ? d.imm : (c.r[d.rs] + d.off) & 0xFF;
      const how = d.I ? `absolute address ${h2(ea)}` : `r${d.rs} + ${d.off} = ${h2(ea)}`;
      c.mar = ea;
      if (d.name === 'LD') {
        c.r[d.rd] = c.mem[ea]; out.read = ea;
        out.text = `Execute: effective address ${how}. r${d.rd} ← mem[${h2(ea)}] = ${h4(c.r[d.rd])}.` + (ea === LED_ADDR ? ' That address is the LED port: the load reads back the output latch, not memory.' : '');
      } else {
        c.mem[ea] = c.r[d.rd]; out.write = ea;
        out.text = `Execute: effective address ${how}. mem[${h2(ea)}] ← r${d.rd} = ${h4(c.r[d.rd])}.`;
        if (ea === LED_ADDR) { c.ledWrites++; out.text += ' That address is the LED port: the same store instruction that writes memory now changes pins.'; }
      }
      out.parts = ['regs', 'mar', 'mem'].concat(ea === LED_ADDR ? ['led'] : [], d.I ? ['ir'] : ['alu']);
      break;
    }
    case 'B': {
      if (d.rd >= CONDS.length) { c.halted = true; c.error = `Undefined branch condition ${d.rd} at ${h2((c.pc - 1) & 0xFF)}.`; out.text = c.error; break; }
      const take = condTrue(d.rd, c.flags);
      if (take) c.pc = d.imm;
      out.text = d.rd === 0 ? `Execute: PC ← ${h2(d.imm)}. The next fetch comes from there.`
        : `Execute: ${CONDS[d.rd]} tests ${COND_TEXT[d.rd]}. ${take ? `True, so PC ← ${h2(d.imm)}.` : `False, so PC stays ${h2(c.pc)} and execution falls through.`}`;
      out.parts = d.rd === 0 ? ['ir', 'pc'] : ['flags', 'ir', 'pc'];
      break;
    }
    case 'CALL': {
      const below = (c.sp - 1) & 0xFF;
      c.sp = below; c.mem[c.sp] = c.pc; out.write = c.sp; c.mar = c.sp;
      out.text = `Execute: push the return address. SP ← ${h2(c.sp)}, mem[${h2(c.sp)}] ← ${h2(c.pc)} (the instruction after the CALL). Then PC ← ${h2(d.imm)}.`;
      c.pc = d.imm; out.parts = ['pc', 'sp', 'mar', 'mem', 'ir'];
      break;
    }
    case 'RET': {
      c.mar = c.sp; const ra = c.mem[c.sp] & 0xFF; out.read = c.sp;
      out.text = `Execute: pop the return address. PC ← mem[${h2(c.sp)}] = ${h2(ra)}, SP ← ${h2(c.sp + 1)}. The word stays in memory; only SP moved.`;
      c.pc = ra; c.sp = (c.sp + 1) & 0xFF; out.parts = ['pc', 'sp', 'mar', 'mem'];
      break;
    }
    default: { // ALU
      const a = c.r[d.rd];
      const res = alu(d.name, a, x);
      const sym = { ADD: '+', SUB: '−', CMP: '−', AND: '&', OR: '|', XOR: '^', SHL: '<<', SHR: '>>' }[d.name];
      if (d.name !== 'CMP') c.r[d.rd] = res.result;
      c.flags.N = res.N; c.flags.Z = res.Z;
      if (res.C != null) c.flags.C = res.C;
      if (res.V != null) c.flags.V = res.V;
      out.text = `Execute: ALU computes r${d.rd} (${h4(a)}) ${sym} ${xs} = ${h4(res.result)}. ` +
        (d.name === 'CMP' ? 'CMP throws the result away and keeps only the flags. ' : `r${d.rd} ← ${h4(res.result)}. `) +
        `Flags: N=${c.flags.N} Z=${c.flags.Z} C=${c.flags.C} V=${c.flags.V}.`;
      out.parts = ['regs', 'alu', 'flags'].concat(d.I ? ['ir'] : []);
    }
  }
  if (!c.halted && c.sp < 0x10) { /* nothing: the model lets the stack run into code, as a real CPU would */ }
  return out;
}

/** Run phases until the current instruction completes. Returns the list of phase descriptions. */
export function stepInstruction(c) {
  const out = [];
  do { out.push(step(c)); } while (!c.halted && c.phase !== 'fetch');
  return out;
}
/** Run until HALT or `maxInstr` instructions. Returns {halted, instrs}. */
export function run(c, maxInstr = 2000) {
  let n = 0;
  while (!c.halted && n < maxInstr) { stepInstruction(c); n++; }
  return { halted: c.halted, instrs: n };
}

// ----------------------------------------------------------------------------------------------- bundled programs
export const PROGRAMS = {
  blink: {
    title: 'blink — toggle a port bit',
    note: 'Runs forever, as firmware does. Watch the store to the LED address: it is the same ST instruction used for memory.',
    source: `; blink: toggle LED bit 0 forever
        LDI  r1, 1          ; mask for bit 0
loop:   LD   r0, [LED]      ; read the port (address 0xF0)
        XOR  r0, r1         ; flip bit 0, leave the others
        ST   r0, [LED]      ; write it back: the LED changes here
        LDI  r2, 3          ; crude delay: count 3 down to 0
delay:  SUB  r2, #1
        BNE  delay
        B    loop
`,
  },
  sum: {
    title: 'sum — add up an array',
    note: 'A loop with a pointer (r1), a counter (r2) and an accumulator (r0). The array is data placed after the code.',
    source: `; sum: add the 5 words at "table", show the low byte on the LEDs
        LDI  r0, 0          ; r0 = running total
        LDI  r1, table      ; r1 = address of the next element
        LDI  r2, 5          ; r2 = elements left
next:   LD   r3, [r1]       ; fetch one element
        ADD  r0, r3
        ADD  r1, #1         ; advance the pointer
        SUB  r2, #1         ; one fewer to go; sets Z when it reaches 0
        BNE  next
        ST   r0, [total]
        ST   r0, [LED]
        HALT
table:  .word 3, 9, 27, 1, 2
total:  .word 0
`,
  },
  call: {
    title: 'call — subroutines and the stack',
    note: 'CALL pushes the return address; RET pops it. "quad" calls "dbl" twice, so two return addresses are on the stack at once.',
    source: `; call: r0 = quad(5), using a nested call
        LDI  r0, 5
        CALL quad           ; pushes the address of the next line
        ST   r0, [LED]      ; 20 = 0x14
        HALT

quad:   CALL dbl            ; nested: a second return address is pushed
        CALL dbl
        RET

dbl:    ADD  r0, r0
        RET
`,
  },
};
