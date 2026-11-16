// Pure-logic tests for the architecture widgets and their simulation modules. Run: node --test tests/architecture.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PLATFORMS, COMPARE, AXES, regionAt, show, UNVERIFIED, fmtSize } from '../js/sim/platforms.js';
import { assemble, createCpu, step, stepInstruction, run as runCpu, alu, disasm, PROGRAMS, LED_ADDR, SP_INIT } from '../js/sim/tinycpu.js';
import { BLOCKS, TRACES } from '../js/widgets/mcu-block-diagram.js';
import { quizFor, checkAnswer } from '../js/widgets/memory-map.js';
import { buildSteps, SCENARIOS as IRQ_SCENARIOS } from '../js/widgets/interrupt-flow.js';
import { runProgram, createHeap, PROGRAMS as SH_PROGRAMS } from '../js/widgets/stack-heap.js';
import { toBytes, fromBytes, bswap32, htonl, parseBytes, parseValue, CHALLENGES as EN_CH } from '../js/widgets/endianness.js';
import { firstMutableStage } from '../js/widgets/boot-sequence.js';
import { timerCalc, checkTick, simulateWatchdog, CHALLENGES as WD } from '../js/widgets/timer-lab.js';
import { run, checkChallenge, CHALLENGES as RB } from '../js/widgets/register-bits.js';
import { QUESTIONS, COMPARE_IDS } from '../js/widgets/platform-compare.js';

// ---- platforms
test('platform memory facts match docs/FACTS.md', () => {
  const r = (p, id) => PLATFORMS[p].regions.find((x) => x.id === id);
  assert.equal(r('mspm0l2228', 'sram').base, 0x20200000); assert.equal(r('mspm0l2228', 'sram').size, 32 * 1024);
  assert.equal(r('mspm0l2228', 'flash').base, 0); assert.equal(r('mspm0l2228', 'flash').size, 256 * 1024);
  assert.equal(r('mspm0l2228', 'nonmain').base, 0x41C00000);
  assert.equal(r('max78000', 'flash').base, 0x10000000); assert.equal(r('max78000', 'flash').size, 512 * 1024);
  assert.equal(r('max78000', 'sram').base, 0x20000000); assert.equal(r('max78000', 'sram').size, 128 * 1024);
  assert.equal(r('esp32', 'drom').base, 0x3F400000); assert.equal(r('esp32', 'drom').base + r('esp32', 'drom').size, 0x3F800000);
  assert.equal(r('esp32', 'dram').base, 0x3FFAE000); assert.equal(r('esp32', 'dram').base + r('esp32', 'dram').size, 0x40000000);
  assert.equal(r('esp32', 'rom').base + r('esp32', 'rom').size, 0x40070000);
  assert.equal(r('esp32', 'iram').base + r('esp32', 'iram').size, 0x400AA000);
  assert.equal(r('esp32', 'irom').base, 0x400D0000);
  assert.equal(PLATFORMS.generic.illustrative, true);
});
test('every fact carries a source URL and unverified facts never print a value', () => {
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, path + '[' + i + ']'));
    if ('v' in o || ('base' in o && 'kind' in o)) assert.match(o.src || '', /^https:\/\/(github\.com|www\.ti\.com|www\.espressif\.com|docs\.espressif\.com|rules\.ectf\.mitre\.org)\//, path);
    if ('v' in o && o.v == null) assert.ok(show(o).includes(UNVERIFIED), path);
    for (const [k, v] of Object.entries(o)) walk(v, path + '.' + k);
  };
  walk(PLATFORMS, 'PLATFORMS'); walk(COMPARE, 'COMPARE');
  assert.equal(show(null), UNVERIFIED);
  assert.ok(!/github\.com\/ectf\//.test(JSON.stringify([PLATFORMS, COMPARE])));
});
test('regionAt, sizes, compare axes complete', () => {
  assert.equal(regionAt('mspm0l2228', 0x20200010).id, 'sram');
  // One 32 KB SRAM, three views (SLASF94A Table 8-4): ECC-checked, parity-checked, unchecked.
  assert.equal(regionAt('mspm0l2228', 0x20000010).id, 'sram_ecc');
  assert.equal(regionAt('mspm0l2228', 0x20100010).id, 'sram_par');
  assert.equal(regionAt('mspm0l2228', 0x20008000), null);          // 32 KB only: nothing just past the end of a view
  assert.equal(regionAt('mspm0l2228', 0x20208000), null);
  for (const id of ['sram_ecc', 'sram_par']) {
    const a = PLATFORMS.mspm0l2228.regions.find((x) => x.id === id);
    assert.equal(a.size, 32 * 1024); assert.equal(a.aliasOf, 'sram'); assert.match(a.src, /ti\.com/); assert.match(a.what, /same (physical memory|32 KB)/);
  }
  assert.deepEqual(PLATFORMS.mspm0l2228.regions.filter((x) => x.check).map((x) => [x.base, x.check]),
    [[0x20000000, 'ECC-checked'], [0x20100000, 'parity-checked'], [0x20200000, 'unchecked']]);
  assert.equal(regionAt('max78000', 0x1007FFFF).id, 'flash');
  assert.equal(regionAt('max78000', 0x10080000), null);
  assert.equal(regionAt('esp32', 0x40000400).id, 'rom');
  assert.equal(fmtSize(512 * 1024), '512 KB');
  for (const p of COMPARE_IDS) for (const a of AXES) assert.ok(COMPARE[p][a.id]?.length > 0, p + '/' + a.id);
  assert.equal(AXES.length, 10);
  for (const p of Object.values(PLATFORMS)) for (const id of Object.keys(BLOCKS)) if (id !== 'bus') assert.ok(id in p.blocks, p.id + ' block ' + id);
  for (const t of Object.values(TRACES)) for (const st of t.steps) for (const b of st.on) assert.ok(BLOCKS[b], b);
});

// ---- tinycpu
test('bundled programs assemble and behave', () => {
  for (const [id, p] of Object.entries(PROGRAMS)) assert.deepEqual(assemble(p.source).errors, [], id);
  let c = createCpu(assemble(PROGRAMS.sum.source).words);
  assert.equal(runCpu(c).halted, true); assert.equal(c.r[0], 42); assert.equal(c.mem[LED_ADDR], 42);
  c = createCpu(assemble(PROGRAMS.call.source).words);
  let minSp = SP_INIT; while (!c.halted) { step(c); minSp = Math.min(minSp, c.sp); }
  assert.equal(c.r[0], 20); assert.equal(c.sp, SP_INIT); assert.equal(minSp, SP_INIT - 2);
  c = createCpu(assemble(PROGRAMS.blink.source).words);
  const seen = []; for (let i = 0; i < 60; i++) { stepInstruction(c); seen.push(c.mem[LED_ADDR] & 1); }
  assert.ok(seen.includes(1) && seen.lastIndexOf(0) > seen.indexOf(1)); assert.equal(c.halted, false);
});
test('phases go fetch, decode, execute', () => {
  const c = createCpu(assemble('LDI r1, 7\nHALT').words);
  assert.equal(step(c).phase, 'fetch'); assert.equal(c.pc, 1); assert.equal(c.r[1], 0);
  assert.equal(step(c).phase, 'decode'); assert.equal(c.r[1], 0);
  const e = step(c); assert.equal(e.phase, 'execute'); assert.equal(c.r[1], 7);
  stepInstruction(c); assert.equal(c.halted, true); assert.equal(step(c).phase, 'halted');
});
test('ALU flags', () => {
  assert.deepEqual(alu('ADD', 0xFFFF, 1), { result: 0, N: 0, Z: 1, C: 1, V: 0 });
  assert.deepEqual(alu('ADD', 0x7FFF, 1), { result: 0x8000, N: 1, Z: 0, C: 0, V: 1 });
  assert.deepEqual(alu('SUB', 5, 5), { result: 0, N: 0, Z: 1, C: 1, V: 0 });
  assert.deepEqual(alu('SUB', 0, 1), { result: 0xFFFF, N: 1, Z: 0, C: 0, V: 0 });
  assert.equal(alu('SHL', 0x8001, 1).C, 1); assert.equal(alu('SHR', 3, 1).result, 1); assert.equal(alu('XOR', 5, 5).Z, 1);
});
test('assembler reports errors with line numbers', () => {
  const a = assemble('LDI r0, 1\nFOO r1\nLDI r9, 2\nLDI r1, 300\nB nowhere\nLD r0, r1\nx: .word 1\nx: .word 2');
  assert.equal(a.ok, false);
  assert.deepEqual(a.errors.map((e) => e.line), [2, 3, 4, 5, 6, 8]);
  assert.match(a.errors[0].msg, /unknown instruction/); assert.match(a.errors[3].msg, /nowhere/);
  const b = assemble('.equ N, 3\n  LDI r0, N ; c\nloop: SUB r0, #1 // c\n BNE loop\n ST r0, [r1+2]\n HALT');
  assert.equal(b.ok, true); assert.equal(disasm(b.words[0]), 'LDI r0, #3'); assert.equal(disasm(b.words[2]), 'BNE 0x01'); assert.equal(disasm(b.words[3]), 'ST r0, [r1+2]');
});

// ---- memory-map
test('memory-map quiz answers', () => {
  for (const p of Object.keys(PLATFORMS)) {
    const items = quizFor(p); assert.ok(items.length >= 5, p);
    for (const it of items) assert.ok(PLATFORMS[p].regions.some((r) => checkAnswer(p, it, r.id).ok), p + ' ' + it.id);
  }
  const g = quizFor('generic'); const by = (id) => g.find((x) => x.id === id);
  assert.equal(checkAnswer('generic', by('const-table'), 'flash').ok, true);
  assert.equal(checkAnswer('generic', by('const-table'), 'sram').ok, false);
  assert.equal(checkAnswer('generic', by('local-array'), 'sram').ok, true);
  assert.equal(checkAnswer('generic', by('periph-reg'), 'periph').ok, true);
  assert.equal(checkAnswer('generic', by('reset-vector'), 'flash').ok, true);
  assert.equal(checkAnswer('generic', by('global-counter'), 'flash').ok, false);
  assert.ok(!quizFor('max78000').some((x) => x.id === 'reset-vector'));
  assert.equal(checkAnswer('esp32', quizFor('esp32').find((x) => x.id === 'const-table'), 'drom').ok, true);
  assert.equal(checkAnswer('esp32', quizFor('esp32').find((x) => x.id === 'function-code'), 'irom').ok, true);
});

// ---- interrupt-flow
test('Cortex-M entry stacks 8 words and sets EXC_RETURN', () => {
  const s = buildSteps('cortex-m', 'basic');
  const stacked = s.find((x) => x.title === 'Stacking');
  assert.equal(stacked.sp, 0x20001000 - 0x20);
  assert.deepEqual(stacked.stack.map((w) => w.label), ['R0', 'R1', 'R2', 'R3', 'R12', 'LR', 'PC', 'xPSR']);
  assert.equal(stacked.stack[0].addr, stacked.sp); assert.equal(stacked.stack[6].val, 0x324);
  const v = s.find((x) => x.title === 'Vector fetch');
  assert.equal(v.regs.LR, 0xFFFFFFF9); assert.equal(v.regs.PC, 0x410); assert.equal(v.regs.xPSR & 0x1FF, 21); assert.equal(v.mode, 'Handler');
  const end = s.at(-1); assert.equal(end.sp, 0x20001000); assert.equal(end.stack.length, 0); assert.equal(end.regs.R0, 0x11); assert.equal(end.mode, 'Thread');
});
test('Cortex-M nesting and stuck flag', () => {
  const n = buildSteps('cortex-m', 'nested');
  assert.equal(Math.min(...n.map((x) => x.sp)), 0x20001000 - 0x40);
  assert.ok(n.some((x) => x.regs.LR === 0xFFFFFFF1 && x.active.length === 2));
  assert.equal(n.at(-1).stack.length, 0); assert.equal(n.at(-1).regs.R1, 0x22);
  const st = buildSteps('cortex-m', 'stuck');
  assert.equal(st.at(-1).mainProgress, 0); assert.ok(st.at(-1).isrRuns >= 3); assert.equal(st.at(-1).stack.length, 8);
});
test('RISC-V trap entry and mret', () => {
  const s = buildSteps('riscv', 'basic');
  const t = s.find((x) => x.title === 'Trap entry');
  assert.equal(t.csr.mepc, 0x324); assert.equal(t.csr.mcause, 0x8000000B); assert.equal(t.csr['mstatus.MIE'], 0); assert.equal(t.csr['mstatus.MPIE'], 1);
  assert.equal(t.regs.pc, t.csr.mtvec); assert.equal(t.stack.length, 0); assert.equal(t.sp, 0x20001000);
  assert.equal(s.find((x) => x.stack.length === 16).sp, 0x20001000 - 64);
  const end = s.at(-1); assert.equal(end.csr['mstatus.MIE'], 1); assert.equal(end.stack.length, 0); assert.equal(end.regs.a0, 0x11);
  const n = buildSteps('riscv', 'nested');
  assert.equal(Math.max(...n.map((x) => x.stack.length)), 34); assert.equal(n.at(-1).stack.length, 0); assert.equal(n.at(-1).sp, 0x20001000);
  assert.equal(n.at(-2).csr.mepc, 0x324);
  assert.equal(buildSteps('riscv', 'stuck').at(-1).mainProgress, 0);
  for (const a of ['cortex-m', 'riscv']) for (const sc of Object.keys(IRQ_SCENARIOS)) assert.ok(buildSteps(a, sc).length >= 6);
});

// ---- stack-heap
test('heap allocator: first fit, coalescing, fragmentation', () => {
  const hp = createHeap(0x100, 0x100 + 320);
  const a = hp.malloc(96, 'a'), b = hp.malloc(96, 'b'), c = hp.malloc(96, 'c');
  assert.deepEqual([a, b, c], [0x108, 0x170, 0x1D8]);
  hp.free(a); hp.free(c);
  assert.equal(hp.freeBytes(), 216); assert.equal(hp.largestFree(), 112);
  assert.equal(hp.malloc(160, 'big'), 0);
  assert.equal(hp.malloc(96, 'again'), a);
  hp.free(b); assert.equal(hp.free(b), false);
});
test('stack-heap scenarios', () => {
  for (const id of Object.keys(SH_PROGRAMS)) { const s = runProgram(id); assert.equal(s.length, SH_PROGRAMS[id].script.length + 1, id); for (const x of s) assert.ok(x.line <= SH_PROGRAMS[id].source.split('\n').length); }
  const n = runProgram('nested');
  assert.equal(Math.max(...n.map((x) => x.frames.length)), 3); assert.equal(n.at(-1).frames[0].slots.find((x) => x.name === 'result').value, 300);
  assert.equal(n.at(-1).statics.find((x) => x.name === 'samples_taken').value, 1);
  const r = runProgram('recursion');
  assert.ok(r.findIndex((x) => x.pastLimit) < r.findIndex((x) => x.corrupt.length)); assert.ok(r.at(-1).corrupt.length);
  const f = runProgram('fragmentation'); assert.ok(f.some((x) => x.failed)); assert.equal(f.at(-1).frames[0].slots.find((x) => x.name === 'big').value, 'NULL');
  const d = runProgram('dangling'); assert.equal(d.at(-1).frames[0].slots.find((x) => x.name === 'v').value, 0xDEAD);
});

// ---- endianness
test('endianness helpers and challenges', () => {
  assert.deepEqual(toBytes(0x12345678, 'le'), [0x78, 0x56, 0x34, 0x12]); assert.deepEqual(toBytes(0x12345678, 'be'), [0x12, 0x34, 0x56, 0x78]);
  assert.equal(fromBytes([0x12, 0x34, 0x56, 0x78], 'le'), 0x78563412); assert.equal(fromBytes([0x01, 0x2C], 'be'), 300);
  assert.equal(bswap32(0xDEADBEEF), 0xEFBEADDE); assert.equal(htonl(0x0A0B0C0D, 'le'), 0x0D0C0B0A); assert.equal(htonl(0x0A0B0C0D, 'be'), 0x0A0B0C0D);
  assert.deepEqual(parseBytes('78 56 34 12', 4), [0x78, 0x56, 0x34, 0x12]); assert.deepEqual(parseBytes('0x78,0x56,0x34,0x12', 4), [0x78, 0x56, 0x34, 0x12]);
  assert.equal(parseBytes('78 56', 4), null); assert.equal(parseBytes('zz', 1), null);
  assert.equal(parseValue('0x12c'), 300); assert.equal(parseValue('300'), 300); assert.equal(parseValue('abc'), null);
  assert.equal(EN_CH['cast-read'].answer, fromBytes([0x12, 0x34, 0x56, 0x78], 'le')); assert.equal(EN_CH['wire-field'].answer, 300);
  assert.match(EN_CH['wire-field'].diagnose(0x2C01), /little-endian/); assert.match(EN_CH['store-le'].diagnose([0x12, 0x34, 0x56, 0x78]), /big-endian/);
});

// ---- boot-sequence
test('boot chains', () => {
  assert.equal(PLATFORMS.generic.boot[firstMutableStage('generic')].id, 'vectors');
  for (const p of ['esp32', 'max78000', 'mspm0l2228']) assert.equal(PLATFORMS[p].boot[firstMutableStage(p)].id, 'bl2');
  const esp = JSON.stringify(PLATFORMS.esp32.boot);
  for (const s of ['0x1000', '0x8000', 'RSA-3072', '0x0 on the ESP32-S3']) assert.ok(esp.includes(s), s);
  assert.ok(show(PLATFORMS.max78000.boot[1].does).includes(UNVERIFIED));
  assert.match(PLATFORMS.generic.boot[0].does.v, /Word 0 becomes the initial stack pointer/);
  assert.match(PLATFORMS.generic.boot[2].does.v, /\.data.*\.bss/);
});

// ---- timer-lab
test('timer arithmetic and 1 ms check', () => {
  assert.equal(timerCalc({ clkHz: 32e6, div: 32, reload: 999 }).periodS, 1e-3);
  assert.equal(checkTick({ clkHz: 32e6, div: 32, reload: 999 }).ok, true);
  assert.equal(checkTick({ clkHz: 32e6, div: 1, reload: 31999 }).ok, true);
  assert.equal(checkTick({ clkHz: 100e6, div: 2, reload: 49999 }).ok, true);
  assert.match(checkTick({ clkHz: 32e6, div: 32, reload: 1000 }).text, /Off by one/);
  assert.match(checkTick({ clkHz: 100e6, div: 1, reload: 99999 }).text, /does not fit/);
  assert.match(checkTick({ clkHz: 32e6, div: 3, reload: 999 }).text, /not a whole number/);
  assert.equal(checkTick({ clkHz: 8e6, div: 8, reload: 99 }).ok, false);
});
test('watchdog simulation', () => {
  assert.deepEqual(simulateWatchdog({ timeoutMs: 200, feeds: [0, 100, 200], endMs: 250 }), { resetAt: null, reason: null });
  assert.deepEqual(simulateWatchdog({ timeoutMs: 200, feeds: [0, 100], endMs: 500 }), { resetAt: 300, reason: 'timeout' });
  assert.deepEqual(simulateWatchdog({ timeoutMs: 200, windowMs: 50, feeds: [0, 30], endMs: 100 }), { resetAt: 30, reason: 'early' });
  const r = (id) => simulateWatchdog(WD[id]);
  assert.equal(r('blocking').reason, 'timeout'); assert.equal(r('blocking').resetAt, 288);
  assert.equal(r('conditional').reason, 'timeout'); assert.equal(r('window').reason, 'early');
  for (const c of Object.values(WD)) assert.ok(c.options.some((o) => o[0] === c.answer));
});

// ---- register-bits
test('expression evaluator: 32-bit unsigned semantics', () => {
  const ev = (s, env) => run(s, { reg: 0, x: 0, ...env });
  assert.equal(ev('reg |= (1u << 5);').env.reg, 0x20);
  assert.equal(ev('reg &= ~(0x7u << 4);', { reg: 0xFFFFFFFF }).env.reg, 0xFFFFFF8F);
  assert.equal(ev('reg = (reg & ~MASK) | (val << POS);', { reg: 0xFF, MASK: 0x70, POS: 4, val: 2 }).env.reg, 0xAF);
  assert.equal(ev('x = (reg >> 8) & 0xF;', { reg: 0xABCD }).env.x, 0xB);
  assert.equal(ev('reg = 1u << 31; x = reg >> 31').env.x, 1);
  assert.equal(ev('reg = 0 - 1').env.reg, 0xFFFFFFFF); assert.equal(ev('reg = ~0u; reg += 2').env.reg, 1);
  assert.equal(ev('x = 1 + 2 * 3 << 1 | 1').env.x, 15); assert.equal(ev('x = 6 & 3 == 3').env.x, 0);
  assert.equal(ev('uint32_t y = 0b101; x = (uint8_t)(y + 0x1FF)').env.x, 4);
  assert.equal(ev('0xF0 >> 4').env._, 0xF);
  assert.match(ev('reg = 1 << 32').error, /undefined behaviour/); assert.match(ev('reg = foo').error, /unknown name/);
  assert.match(ev('reg = (1 << 2').error, /missing/); assert.match(ev('reg = 1 2').error, /unexpected/); assert.match(ev('x = 1 / 0').error, /zero/);
  assert.equal(ev('reg = 5; alert(1)').error != null, true); assert.equal(ev('reg = 7 $ 1').error != null, true);
  assert.equal(ev('reg |= 1').stmts[0].readsTarget, true); assert.equal(ev('reg = 1').stmts[0].readsTarget, false);
});
test('register challenges accept correct forms and explain typical mistakes', () => {
  const ok = { 'set-bit': ['reg |= (1u << 5);', 'reg = reg | 0x20'], 'clear-bit': ['reg &= ~(1u << 3);', 'reg = reg & 0xFFFFFFF7;'], toggle: ['reg ^= 1u << 7;'],
    'field-write': ['reg = (reg & ~MASK) | (val << POS);', 'reg &= ~MASK; reg |= val << 4;'], 'field-read': ['x = (reg >> 8) & 0xF;', 'x = (reg & 0xF00) >> 8'] };
  for (const [id, list] of Object.entries(ok)) for (const s of list) assert.equal(checkChallenge(id, s).ok, true, id + ': ' + s);
  assert.deepEqual(Object.keys(RB), ['set-bit', 'clear-bit', 'toggle', 'field-write', 'field-read']);
  assert.match(checkChallenge('set-bit', 'reg = (1u << 5);').text, /replaces the whole register/);
  assert.match(checkChallenge('set-bit', 'reg |= 5;').text, /bits 0 and 2/);
  assert.match(checkChallenge('set-bit', 'reg ^= 0x20;').text, /toggles/);
  assert.match(checkChallenge('clear-bit', 'reg &= (1u << 3);').text, /forgot the `~`/);
  assert.match(checkChallenge('field-write', 'reg |= val << POS;').text, /without clearing/);
  assert.match(checkChallenge('field-write', 'reg = (reg & ~MASK) | val;').text, /val << POS/);
  assert.match(checkChallenge('field-read', 'x = reg & 0xF00;').text, /did not shift/);
  assert.match(checkChallenge('field-read', 'x = reg >> 8;').text, /did not mask/);
  assert.match(checkChallenge('field-read', 'reg >>= 8; x = reg & 0xF;').text, /changed reg/);
  assert.match(checkChallenge('set-bit', 'reg | 0x20').text, /no assignment/);
  assert.match(checkChallenge('set-bit', 'reg = 0xA5A50F7A;').text, /any value|replaces|should be/);
  assert.equal(checkChallenge('toggle', 'reg = 0xA5A50FDA').ok, false);
});

// ---- platform-compare
test('platform-compare questions', () => {
  assert.deepEqual(COMPARE_IDS, ['esp32', 'max78000', 'mspm0l2228']);
  assert.ok(QUESTIONS.length >= 3); assert.ok(QUESTIONS.some((q) => /three things/.test(q.q)));
  for (const q of QUESTIONS) assert.ok(q.a.length >= 3);
});
