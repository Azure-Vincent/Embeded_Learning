// Tests for the Debugging tools: firmware-inspector, disasm-lab, debug-session, and the Thumb simulator behind them.
// The simulator is checked against code that clang compiled (js/sim/fwimages.js), not against hand-made encodings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { ArmSim, CFSR, HFSR_FORCED } from '../js/sim/armsim.js';
import { INSPECTOR_IMAGES, DEBUG_PROGRAMS, DISASM, b64ToBytes } from '../js/sim/fwimages.js';
import { parseElf, shannon, blockEntropy, extractStrings, decodeVectors, searchBytes, parseNum, imageFacts, tasksFor } from '../js/widgets/firmware-inspector.js';
import { CHALLENGES, ARCHS, NOTES, CHEATS, questionsFor } from '../js/widgets/disasm-lab.js';
import { GdbSession, scenarioInfo, gdbString, SCENARIO_PROGRAM } from '../js/widgets/debug-session.js';

const SETUP = ['target extended-remote :3333', 'monitor reset halt', 'load', 'monitor reset halt'];
const session = (name, cmds = SETUP) => { const s = new GdbSession(name); for (const c of cmds) s.exec(c); return s; };

/* ---------------- firmware-inspector ---------------- */

test('parseElf reads the demo ELF: sections, load addresses, symbols', () => {
  const elf = parseElf(b64ToBytes(INSPECTOR_IMAGES.demo.elf));
  assert.equal(elf.header.machine, 40);
  assert.equal(elf.header.entry & 1, 1, 'entry point has the Thumb bit');
  const sec = (n) => elf.sections.find((s) => s.name === n);
  assert.equal(sec('.vectors').addr, 0x08000000);
  assert.equal(sec('.bss').typeName, 'NOBITS');
  assert.equal(sec('.data').addr, 0x20000000);
  assert.ok(sec('.data').lma >= 0x08000000 && sec('.data').lma < 0x08010000, '.data is stored in flash');
  assert.equal(sec('.text').lma, sec('.text').addr);
  const main = elf.symbols.find((s) => s.name === 'main');
  assert.equal(main.typeName, 'FUNC');
  assert.throws(() => parseElf(b64ToBytes(INSPECTOR_IMAGES.demo.bin)), /not an ELF/);
});

test('the .bin is the ELF sections laid out at their load addresses', () => {
  const elfBytes = b64ToBytes(INSPECTOR_IMAGES.demo.elf);
  const elf = parseElf(elfBytes);
  const bin = b64ToBytes(INSPECTOR_IMAGES.demo.bin);
  for (const s of elf.sections.filter((x) => x.flags & 2 && x.type === 1 && x.size)) {
    assert.deepEqual([...bin.subarray(s.lma - 0x08000000, s.lma - 0x08000000 + s.size)], [...elfBytes.subarray(s.offset, s.offset + s.size)], s.name);
  }
});

test('entropy: constant block is 0, all byte values is 8, updater has padding and a compressed block', () => {
  assert.equal(shannon(new Uint8Array(64).fill(0xff)), 0);
  assert.equal(shannon(Uint8Array.from({ length: 256 }, (_, i) => i)), 8);
  assert.equal(shannon(new Uint8Array(0)), 0);
  const f = imageFacts('updater');
  const blocks = blockEntropy(f.bytes, 256);
  assert.ok(blocks.some((b) => b.bits === 0), 'an erased-flash block');
  const payload = blocks.filter((b) => b.off >= f.payloadOff && b.len === 256);
  assert.ok(payload.every((b) => b.bits > 6.8), 'compressed data is near the ceiling');
  assert.ok(blockEntropy(f.bytes, 64).every((b) => b.bits <= 6 + 1e-9), 'a 64-byte block cannot exceed 6 bits');
});

test('the updater payload is a real zlib stream and the key slot holds a 65-byte uncompressed point', () => {
  const f = imageFacts('updater');
  assert.equal(f.bytes[f.payloadOff], 0x78);
  const text = inflateSync(Buffer.from(f.bytes.subarray(f.payloadOff, f.payloadOff + f.sec('.payload').size))).toString('latin1');
  assert.match(text, /^\[0000\] /);
  assert.equal(String.fromCharCode(...f.bytes.subarray(f.pkeyOff, f.pkeyOff + 4)), 'PKEY');
  assert.equal(f.bytes[f.pkeyOff + 5], 65);
  assert.equal(f.bytes[f.keyOff], 0x04);
});

test('strings, vectors and search', () => {
  const lock = imageFacts('lockbox');
  const strs = extractStrings(lock.bytes, 6);
  assert.ok(strs.some((s) => s.text === 'svc:KESTREL-7741-open' && s.off === lock.credOff));
  assert.ok(extractStrings(lock.bytes, 12).length < extractStrings(lock.bytes, 4).length);
  assert.ok(extractStrings(lock.bytes, 8).every((s) => s.text.length >= 8));
  const good = decodeVectors(lock.bytes, 0x08004000);
  assert.equal(good[0].value, 0x20010000);
  assert.ok(good.filter((v) => v.index > 0 && v.value).every((v) => v.thumb && v.inImage));
  assert.ok(decodeVectors(lock.bytes, 0).filter((v) => v.index > 0 && v.value).every((v) => !v.inImage));
  assert.equal(good[7].value, 0, 'reserved vector');
  const up = imageFacts('updater');
  assert.equal(searchBytes(up.bytes, '98 2f 8a 42').hits.length, 1);
  assert.deepEqual(searchBytes(up.bytes, 'PKEY').hits, [up.pkeyOff]);
  assert.deepEqual(searchBytes(up.bytes, '').hits, []);
  assert.equal(parseNum('0x0800_4000'), 0x08004000);
  assert.ok(Number.isNaN(parseNum('8000h')));
});

test('inspector tasks: the stated solution passes, wrong answers get specific feedback, facts match the images', () => {
  for (const name of Object.keys(INSPECTOR_IMAGES)) {
    const tasks = tasksFor(name);
    assert.ok(tasks.length >= 3);
    for (const t of tasks) {
      assert.equal(t.check(t.solution).ok, true, `${name}/${t.id}`);
      assert.equal(t.check('0x12345').ok, false, `${name}/${t.id}`);
      assert.ok(t.commands.length && t.hints.length);
    }
  }
  const demo = imageFacts('demo');
  assert.equal(demo.base, 0x08000000);
  assert.equal(demo.bytes[demo.varOff], 250, 'initial value of blink_period_ms at its load offset');
  assert.notEqual(demo.varLma, demo.varVma);
  const byId = (n, id) => tasksFor(n).find((t) => t.id === id);
  assert.match(byId('demo', 'lma').check('0x20000000').msg, /run-time address/);
  assert.match(byId('lockbox', 'base').check('0x08004041').msg, /reset vector itself/);
  assert.match(byId('lockbox', 'base').check('0').msg, /outside/);
  assert.equal(byId('lockbox', 'base').check('0x08004000').ok, true);
  assert.equal(byId('updater', 'key').check('0x' + (imageFacts('updater').base + imageFacts('updater').keyOff).toString(16)).ok, true);
  assert.match(byId('updater', 'key').check(String(imageFacts('updater').pkeyOff)).msg, /tag/);
  assert.equal(byId('updater', 'hash').check('sha256').ok, true);
});

/* ---------------- simulator ---------------- */

function thumbImage() {
  const sim = new ArmSim();
  for (const c of DISASM.thumb.chunks) {
    const b = b64ToBytes(c.bytes);
    if (c.addr >= 0x20000000) sim.ram.set(b, c.addr - 0x20000000); else sim.loadFlash(c.addr, b);
  }
  const addr = (n) => DISASM.thumb.symbols.find((s) => s.name === n).addr;
  const put = (a, str) => { for (let i = 0; i <= str.length; i++) sim.ram[a - 0x20000000 + i] = i < str.length ? str.charCodeAt(i) : 0; };
  return { sim, addr, put };
}

test('simulator runs clang-compiled SHA-256 and CRC-32 correctly', () => {
  const u = INSPECTOR_IMAGES.updater;
  for (const msg of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'The quick brown fox jumps over the lazy dog, twice over, to cross a 64-byte block boundary!']) {
    const sim = new ArmSim();
    sim.loadFlash(0x08000000, b64ToBytes(u.bin));
    for (let i = 0; i < msg.length; i++) sim.ram[0x1000 + i] = msg.charCodeAt(i);
    sim.call(u.truth.symbols.find((s) => s.name === 'sha256').addr, [0x20001000, msg.length, 0x20002000]);
    assert.equal(Buffer.from(sim.ram.subarray(0x2000, 0x2020)).toString('hex'), createHash('sha256').update(msg).digest('hex'), JSON.stringify(msg.slice(0, 8)));
  }
  const d = INSPECTOR_IMAGES.demo;
  const sim = new ArmSim();
  sim.loadFlash(0x08000000, b64ToBytes(d.bin));
  for (let i = 0; i < 9; i++) sim.ram[0x1000 + i] = '123456789'.charCodeAt(i);
  assert.equal(sim.call(d.truth.symbols.find((s) => s.name === 'crc32_update').addr, [0, 0x20001000, 9]), 0xcbf43926);
});

test('simulator: the disassembly-lab functions behave like their C source', () => {
  const { sim, addr, put } = thumbImage();
  for (const [a, b] of [[7, 10], [0, 0], [-3, 1], [100000, -7]]) assert.equal(sim.call(addr('scale_add'), [a, b]) | 0, a * 5 + b - 3);
  [5, 6, 7, 0xfffffff0].forEach((v, i) => sim.poke(0x20000100 + 4 * i, 4, v));
  assert.equal(sim.call(addr('sum_array'), [0x20000100, 4]), 2);
  assert.equal(sim.call(addr('sum_array'), [0x20000100, 0]), 0);
  put(0x20000200, 'hello'); put(0x20000300, 'hello'); put(0x20000400, 'help'); put(0x20000500, 'hell'); put(0x20000580, '');
  assert.equal(sim.call(addr('str_equal'), [0x20000200, 0x20000300]), 1);
  assert.equal(sim.call(addr('str_equal'), [0x20000200, 0x20000400]), 0);
  assert.equal(sim.call(addr('str_equal'), [0x20000200, 0x20000500]), 0);
  assert.equal(sim.call(addr('str_equal'), [0x20000500, 0x20000200]), 0);
  assert.equal(sim.call(addr('str_equal'), [0x20000580, 0x20000580]), 1);
  put(0x20000600, '4921'); put(0x20000700, '4920'); put(0x20000800, '5921');
  assert.equal(sim.call(addr('check_pin'), [0x20000600]), 1);
  assert.equal(sim.call(addr('check_pin'), [0x20000700]), 0);
  assert.equal(sim.call(addr('check_pin'), [0x20000800]), 0);
  put(0x20000900, '1234x');
  assert.equal(sim.call(addr('parse_number'), [0x20000900]), 1234);
  sim.call(addr('led_on'));
  assert.equal(sim.periph.gpioOut, 0x20);
});

test('simulator: check_pin with its mismatch branch replaced by a no-op accepts any PIN (the patch the lab asks about)', () => {
  const { sim, addr, put } = thumbImage();
  put(0x20000700, '0000');
  assert.equal(sim.call(addr('check_pin'), [0x20000700]), 0);
  const q = questionsFor('thumb', 'pin-check').at(-1);
  sim.flash[q.answer - sim.flashBase] = 0xc0; sim.flash[q.answer - sim.flashBase + 1] = 0x46; // mov r8, r8
  assert.equal(sim.call(addr('check_pin'), [0x20000700]), 1);
});

test('simulator: read_number keeps its buffer and saved lr where the lab says, and an over-long line overwrites lr', () => {
  const { sim, addr } = thumbImage();
  const qs = questionsFor('thumb', 'stack-buffer');
  sim.r[13] = 0x20008000;
  const sp0 = sim.r[13];
  sim.r[14] = 0x08000201; sim.r[15] = addr('read_number'); sim.T = 1; sim.lockup = false;
  for (let i = 0; i < 4; i++) sim.step(); // push, add r7, sub sp, add r4
  const buf = sim.r[4];
  assert.equal(buf - sim.r[13], qs[1].answer);
  assert.equal(sim.peek32(buf + qs[3].answer), 0x08000201, 'saved lr at the stated offset');
  assert.equal(sp0 - 16 - buf, qs[2].answer, 'room before the saved registers');
});

test('simulator: flags, faults and the exception frame', () => {
  const sim = new ArmSim();
  assert.equal(sim.lockup, true, 'erased flash locks the core up');
  assert.equal(sim.r[15], 0xfffffffe);
  // vector table + a few hand-checked encodings: movs r0,#1; lsls r0,r0,#31; adds r0,r0,r0 (carry, zero, overflow); ldr r1,[r0] from 0 -> faults? no: read 0x30000000
  const words = [0x20001000, 0x08000041, 0, 0x08000061];
  const code = [0x2001, 0x07c0, 0x1800, 0x2103, 0x0709, 0x6808, 0xe7fe]; // movs r0,#1; lsls r0,#31; adds r0,r0,r0; movs r1,#3; lsls r1,#28; ldr r0,[r1]; b .
  const img = new Uint8Array(0x70);
  words.forEach((w, i) => { for (let k = 0; k < 4; k++) img[i * 4 + k] = (w >>> (8 * k)) & 0xff; });
  code.forEach((c, i) => { img[0x40 + 2 * i] = c & 0xff; img[0x41 + 2 * i] = c >> 8; });
  img[0x60] = 0xfe; img[0x61] = 0xe7;
  sim.loadFlash(0x08000000, img); sim.reset();
  assert.equal(sim.r[13], 0x20001000); assert.equal(sim.r[15], 0x08000040);
  sim.step(); sim.step();
  assert.equal(sim.r[0], 0x80000000); assert.equal(sim.N, 1);
  sim.step();
  assert.deepEqual([sim.r[0], sim.Z, sim.C, sim.V, sim.N], [0, 1, 1, 1, 0]);
  sim.step(); sim.step();
  assert.equal(sim.r[1], 0x30000000);
  sim.step(); // ldr from an unmapped address
  assert.equal(sim.event.type, 'hardfault');
  assert.equal(sim.r[15], 0x08000060);
  assert.equal(sim.r[14], 0xfffffff9);
  assert.equal(sim.cfsr, CFSR.PRECISERR | CFSR.BFARVALID);
  assert.equal(sim.bfar, 0x30000000);
  assert.equal(sim.hfsr, HFSR_FORCED);
  assert.equal(sim.peek32(sim.r[13] + 24), 0x0800004a, 'stacked pc is the faulting instruction');
  assert.equal(sim.peek32(0xe000ed28), sim.cfsr);
  assert.equal(sim.ipsr, 3);
  // return from the handler: bx lr re-executes the faulting load and faults again
  sim.flash[0x60] = 0x70; sim.flash[0x61] = 0x47;
  sim.step();
  assert.equal(sim.r[15], 0x0800004a); assert.equal(sim.ipsr, 0); assert.equal(sim.r[13], 0x20001000);
});

/* ---------------- disasm-lab ---------------- */

test('disasm-lab: every instruction has a note and every note belongs to an instruction', () => {
  for (const arch of Object.keys(ARCHS)) {
    assert.ok(CHEATS[arch].length >= 6);
    for (const fn of Object.values(CHALLENGES)) {
      const lines = DISASM[arch].functions[fn].lines;
      assert.ok(lines.length >= 5, `${arch}/${fn}`);
      assert.deepEqual(Object.keys(NOTES[arch][fn]).map(Number).sort((a, b) => a - b), lines.map((l) => l.addr), `${arch}/${fn}`);
      assert.ok(DISASM[arch].functions[fn].c.includes(fn + '('));
    }
  }
});

test('disasm-lab: answers pass, and address answers point at the kind of instruction the question names', () => {
  const at = (arch, addr) => Object.values(DISASM[arch].functions).flatMap((f) => f.lines).find((l) => l.addr === addr);
  for (const arch of Object.keys(ARCHS)) {
    for (const id of Object.keys(CHALLENGES)) {
      const qs = questionsFor(arch, id);
      assert.ok(qs.length >= 3);
      for (const q of qs) {
        const good = q.kind === 'choice' ? q.answer : q.kind === 'num' ? String(q.answer) : q.answer;
        assert.equal(q.check(good).ok, true, `${arch}/${id}: ${q.q}`);
        assert.equal(q.check(q.kind === 'choice' ? (q.answer + 1) % q.options.length : '0x7777').ok, false);
        if (q.kind === 'num' && q.answer > 0x08000000 && /address of the (instruction|conditional)|Which conditional branch/.test(q.q)) {
          const line = at(arch, q.answer);
          assert.ok(line, `${arch}/${id}: ${q.answer.toString(16)} is in the listing`);
          assert.match(line.text, /compar|Give the address of the instruction that compares/.test(q.q) && arch === 'thumb' ? /^cmp/ : /^b(ne|eq|nez|eqz)/, `${arch}/${id}: ${line.text}`);
        }
      }
    }
  }
  assert.match(at('thumb', 0x8000170).text, /^sub sp, #0x18/);
  assert.match(at('riscv', 0x800001ac).text, /^sw ra, 0x1c\(sp\)/);
  assert.match(at('riscv', 0x800001b0).text, /^addi a0, sp, 0x8/);
  assert.equal(DISASM.thumb.symbols.find((s) => s.name === 'stored_pin').addr, 0x20000000);
});

/* ---------------- debug-session ---------------- */

test('gdb strings', () => {
  assert.equal(gdbString([70, 82, 0, 0]), '"FR\\000"');
  assert.equal(gdbString([12, 7, 30, 5, 9, 21]), '"\\f\\a\\036\\005\\t\\025"');
  assert.equal(gdbString([65, 66, 0, 67], true), '"AB"');
  assert.equal(gdbString(new Array(8).fill(0)), '"\\000\\000\\000\\000\\000\\000\\000"');
  assert.equal(gdbString([97, ...new Array(15).fill(0)]), '"a", \'\\000\' <repeats 14 times>');
});

test('session: order of connection, load and reset matters', () => {
  const s = new GdbSession('tour');
  assert.equal(s.exec('continue'), 'The program is not being run.');
  assert.match(s.exec('monitor reset halt'), /not supported by this target/);
  assert.match(s.exec('target extended-remote :4444'), /Connection timed out/);
  assert.match(s.exec('target extended-remote :3333'), /0xfffffffe in \?\? \(\)/);
  assert.match(s.exec('continue'), /lockup/);
  assert.match(s.exec('load'), /Loading section \.text, size 0x[0-9a-f]+ lma 0x8000040[\s\S]*Start address 0x08000040/);
  assert.match(s.exec('monitor reset halt'), /pc: 0x08000040 msp: 0x20010000/);
  assert.ok(s.ocd.some((l) => /Listening on port 3333 for gdb connections/.test(l)));
  assert.ok(s.ocd.some((l) => /accepting 'gdb' connection/.test(l)));
  assert.equal(s.exec('frobnicate'), 'Undefined command: "frobnicate".  Try "help".');
  assert.match(s.exec('help'), /target extended-remote/);
});

test('tour: every guided step can be completed and the answers come out of the session', () => {
  const info = scenarioInfo('tour');
  const s = new GdbSession('tour');
  const outputs = info.steps.map(([, , cmd]) => s.exec(cmd));
  for (const [flag] of info.steps) assert.ok(s.flags.has(flag), flag);
  const all = outputs.join('\n');
  assert.match(all, /Breakpoint 1, checksum \(data=0x[0-9a-f]+ <samples> ".*", len=6\) at src\/dbg_tour\.c:\d+/);
  assert.match(all, /#1 {2}0x[0-9a-f]{8} in main \(\) at src\/dbg_tour\.c:(\d+)/);
  assert.match(all, /<samples>:\t0x0c\t0x07\t0x1e\t0x05\t0x09\t0x15/);
  const q = Object.fromEntries(info.questions.map((x) => [x.id, x]));
  assert.equal(q.ret.check(all.match(/Value returned is \$\d+ = (\d+)/)[1]).ok, true);
  assert.equal(q.line.check(all.match(/in main \(\) at src\/dbg_tour\.c:(\d+)/)[1]).ok, true);
  assert.equal(q.pc.check('0x08000040').ok, true);
  assert.equal(s.exec('p total'), '$2 = 0', 'finish stops before the caller stores the result');
  s.exec('next');
  assert.equal(s.exec('p total'), '$3 = 84');
  assert.equal(s.exec('p/x total'), '$4 = 0x54');
  assert.match(s.exec('p &total'), /= \(uint32_t \*\) 0x20000000 <total>/);
  assert.match(s.exec('info registers pc'), /^pc\s+0x[0-9a-f]+\s+0x[0-9a-f]+ <main\+\d+>$/);
});

test('stepping: step enters a function, next steps over it, finish returns, locals are read from the stack', () => {
  const s = session('tour', [...SETUP, 'break main', 'continue']);
  let out = '';
  for (let i = 0; i < 6 && !/checksum \(/.test(out); i++) out = s.exec('step');
  assert.match(out, /^checksum \(data=.*len=6\) at src\/dbg_tour\.c:\d+\n\d+\t\s+uint32_t sum = 0;/);
  for (let i = 0; i < 3; i++) s.exec('next');
  assert.match(s.exec('info locals'), /i = 0\nsum = 12/);
  assert.match(s.exec('bt'), /#0 {2}checksum[\s\S]*#1 {2}0x[0-9a-f]+ in main \(\)[\s\S]*#2 {2}0x[0-9a-f]+ in Reset_Handler \(\)/);
  assert.match(s.exec('frame 1'), /^#1 {2}0x[0-9a-f]+ in main/);
  assert.match(s.exec('info locals'), /count = 0/);
  s.exec('frame 0');
  assert.match(s.exec('finish'), /Run till exit[\s\S]*Value returned is \$1 = 84/);
  s.exec('set var count = 41');
  assert.equal(s.exec('p count + 1'), '$2 = 42');
  // next over a call must not stop inside it
  const t = session('tour', [...SETUP, 'break main', 'continue']);
  for (let i = 0; i < 4; i++) assert.doesNotMatch(t.exec('next'), /checksum \(/);
  assert.equal(t.exec('p total'), '$1 = 84');
});

test('hardfault: evidence in the session matches the expected answers', () => {
  const info = scenarioInfo('hardfault');
  const q = Object.fromEntries(info.questions.map((x) => [x.id, x]));
  const s = session('hardfault');
  assert.equal(s.exec('continue'), 'Continuing.');
  assert.equal(s.running, true);
  assert.match(s.exec('bt'), /target is running/);
  const stop = s.interrupt();
  assert.match(stop, /Program received signal SIGINT, Interrupt\.\n(0x[0-9a-f]+ in )?HardFault_Handler \(\) at src\/startup\.c/);
  assert.equal(q.where.check('HardFault_Handler').ok, true);
  assert.match(s.exec('bt'), /#1 {2}<signal handler called>\n#2 {2}0x00000000 in \?\? \(\)/);
  const words = s.exec('x/8xw $sp').split('\n').flatMap((l) => l.split('\t').slice(1));
  assert.equal(words.length, 8);
  assert.equal(q.pc.check(words[6]).ok, true);
  assert.equal(q.lr.check(words[5]).ok, true);
  const lr = parseInt(words[5], 16);
  const lineAt = (a) => s.exec(`info line *0x${a.toString(16)}`).match(/^Line (\d+)/)[1];
  assert.equal(q.line.check(lineAt((lr & ~1) - 2)).ok, true);
  assert.equal(q.line.check(lineAt(lr & ~1)).ok, false, 'the return address belongs to the next line');
  assert.match(q.line.check(lineAt(lr & ~1)).msg, /instruction after the call/);
  assert.match(s.exec('x/2i 0x' + ((lr & ~1) - 2).toString(16)), /blx\tr0/);
  assert.equal(s.exec('x/xw 0xE000ED28'), '0xe000ed28:\t0x00020000');
  assert.equal(s.exec('x/xw 0xE000ED2C'), '0xe000ed2c:\t0x40000000');
  assert.equal(s.exec('monitor mdw 0xE000ED28'), '0xe000ed28: 00020000 ');
  assert.equal(q.cfsr.check('invstate').ok, true);
  assert.match(s.exec('p handlers'), /= \{0x[0-9a-f]+ <on_button>, 0x[0-9a-f]+ <on_timer>, 0x0\}/);
  assert.equal(q.event.check('2').ok, true);
  assert.match(s.exec('info registers lr'), /0xfffffff9/);
  // a breakpoint on the handler catches the fault without Ctrl-C
  const b = session('hardfault', [...SETUP, 'break HardFault_Handler']);
  assert.match(b.exec('continue'), /Breakpoint 1, HardFault_Handler \(\)/);
});

test('stuck-loop: the loop reads ADC_STATUS, which holds 1, and tests bit 1', () => {
  const info = scenarioInfo('stuck-loop');
  const q = Object.fromEntries(info.questions.map((x) => [x.id, x]));
  const s = session('stuck-loop', [...SETUP, 'break main', 'continue', 'next']);
  assert.equal(s.exec('next'), '', 'next over adc_read never returns');
  assert.equal(s.running, true);
  assert.match(s.interrupt(), /in adc_read \(channel=3\) at src\/dbg_stuck\.c:\d+/);
  assert.match(s.exec('bt'), /#0 .*adc_read[\s\S]*#1 .*main/);
  assert.equal(q.func.check('adc_read').ok, true);
  const dis = s.exec('disassemble');
  assert.match(dis, /\.word\t0x40003004/);
  assert.match(dis, /lsls\tr0, r0, #0x1e/);
  assert.equal(s.exec('x/xw 0x40003004'), '0x40003004:\t0x00000001');
  assert.equal(s.exec('p/x *(uint32_t *)0x40003004'), '$1 = 0x1');
  assert.equal(q.reg.check('0x40003004').ok, true);
  assert.equal(q.val.check('1').ok, true);
  assert.equal(q.bit.check('1').ok, true);
  assert.equal(q.bit.check('0').ok, false);
  assert.equal(s.exec('x/xw 0x40000004'), '0x40000004:\t0x00000000');
  // skipping the loop shows the rest of the program works
  const after = dis.split('\n').find((l) => /ldr\tr0, \[pc.*0x800011c/.test(l)).match(/0x[0-9a-f]{8}/)[0];
  s.exec(`set var $pc = ${after}`);
  s.exec('continue'); s.interrupt();
  assert.equal(s.exec('x/xw 0x40000004'), '0x40000004:\t0x00000020');
});

test('bad-pointer: the watchpoint finds the out-of-bounds write', () => {
  const prog = DEBUG_PROGRAMS[SCENARIO_PROGRAM['bad-pointer']];
  const g = (n) => prog.globals.find((x) => x.name === n).addr;
  assert.equal(g('door_locked'), g('name_buf') + 8, 'door_locked directly follows name_buf');
  const info = scenarioInfo('bad-pointer');
  const q = Object.fromEntries(info.questions.map((x) => [x.id, x]));
  const s = session('bad-pointer');
  assert.equal(q.addr.check(s.exec('p &door_locked').match(/0x[0-9a-f]+/)[0]).ok, true);
  assert.equal(s.exec('watch door_locked'), 'Hardware watchpoint 1: door_locked');
  assert.match(s.exec('continue'), /Old value = 0\nNew value = 1\n.*main \(\)/);
  const hit = s.exec('continue');
  assert.match(hit, /Hardware watchpoint 1: door_locked\n\nOld value = 1\nNew value = 0\nset_name \(src=0x[0-9a-f]+ "FRONTDR1"\)/);
  assert.equal(q.func.check('set_name').ok, true);
  assert.equal(q.i.check(s.exec('p i').split('= ')[1]).ok, true);
  assert.equal(s.exec('p name_buf'), '$3 = "FRONTDR1"');
  assert.match(s.exec('x/12xb &name_buf'), /<door_locked>:\t0x00\t0x00\t0x00\t0x00/);
  assert.match(prog.sources[prog.file].split('\n')[+q.line.answer - 1], /i <= NAME_LEN/);
  assert.equal(q.line.check(q.line.answer).ok, true);
  assert.match(s.exec('info breakpoints'), /hw watchpoint.*door_locked\n\tbreakpoint already hit 2 times/);
  s.exec('delete');
  assert.equal(s.exec('info breakpoints'), 'No breakpoints or watchpoints.');
});

test('expressions and error messages', () => {
  const s = session('hardfault', [...SETUP, 'break dispatch', 'continue']);
  assert.equal(s.exec('p event'), '$1 = 1');
  assert.equal(s.exec('p script[3]'), "$2 = 2 '\\002'");
  assert.equal(s.exec('p/x script'), '$3 = {0x1, 0x0, 0x1, 0x2, 0x0}');
  assert.equal(s.exec('p sizeof(handlers)'), '$4 = 12');
  assert.equal(s.exec('p 1 << 5 | 3'), '$5 = 35');
  assert.equal(s.exec('p -7 / 2'), '$6 = -3');
  assert.equal(s.exec('p $5 + $'), '$7 = 32');
  assert.equal(s.exec('whatis handlers'), 'type = handler_t[3]');
  assert.equal(s.exec('p nosuch'), 'No symbol "nosuch" in current context.');
  assert.equal(s.exec('x/4xw 0x30000000'), 'Cannot access memory at address 0x30000000');
  assert.match(s.exec('p 1 +'), /syntax error/);
  assert.match(s.exec('break nowhere'), /Function "nowhere" not defined\./);
  assert.match(s.exec('p *(uint32_t *)0x08000004'), /= 134217793$/);
  assert.match(s.exec('p {uint32_t}0x08000000'), /= 536936448$/);
  assert.match(s.exec('info symbol 0x080000e4'), /^dispatch \+ 4 in section \.text$/);
  assert.match(s.exec('list dispatch'), /\d+\tstatic void dispatch\(uint32_t event\)/);
  assert.match(s.exec('set var script[0] = 9'), /flash/);
  assert.equal(s.exec('monitor mww 0x40000004 0x20'), '');
  assert.equal(s.exec('x/xw 0x40000004'), '0x40000004:\t0x00000020');
});
