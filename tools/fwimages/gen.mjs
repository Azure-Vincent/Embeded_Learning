// Reads the build outputs of build.sh and writes js/sim/fwimages.js.
// Everything in that file is copied from tool output: bytes from llvm-objcopy, listings from llvm-objdump,
// line tables and variable locations from llvm-dwarfdump, symbols and sections from the ELF files themselves.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseElf } from '../../js/widgets/firmware-inspector.js';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node gen.mjs <build dir>'); process.exit(1); }
const here = new URL('.', import.meta.url);
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
const b64 = (buf) => Buffer.from(buf).toString('base64');
const src = (name) => readFileSync(new URL('./src/' + name, here), 'utf8');
const clangVersion = run('clang', ['--version']).split('\n')[0].trim();

function elfFacts(path) {
  const elf = parseElf(new Uint8Array(readFileSync(path)));
  const loadable = elf.sections.filter((s) => s.flags & 2 && s.size > 0);
  return {
    entry: elf.header.entry,
    sections: loadable.map((s) => ({ name: s.name, addr: s.addr, lma: s.lma, size: s.size, nobits: s.type === 8 })),
    symbols: elf.symbols
      .filter((s) => s.name && !s.name.startsWith('$') && (s.type === 1 || s.type === 2 || s.type === 0) && s.shndx !== 0 && s.type !== 4)
      .map((s) => ({ name: s.name, addr: s.type === 2 ? s.value & ~1 : s.value, size: s.size, kind: s.type === 2 ? 'func' : s.type === 1 ? 'object' : 'label' }))
      .sort((a, b) => a.addr - b.addr),
  };
}

/* ---------- objdump listing ---------- */
function listing(path, extra = []) {
  const text = run('llvm-objdump', ['-d', ...extra, path]);
  const funcs = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    let m = raw.match(/^([0-9a-f]+) <([^>]+)>:$/);
    if (m) {
      if (m[2].startsWith('.')) continue; // compiler-local label inside a function
      cur = { name: m[2], addr: parseInt(m[1], 16), lines: [] };
      funcs.push(cur);
      continue;
    }
    m = raw.match(/^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2,8} )+)\s*\t(.*)$/);
    if (m && cur) {
      const t = m[3].replace(/\s*@ imm = #-?0x[0-9a-f]+/, '').replace(/\t/g, ' ').replace(/ +@/, '  @').trim();
      cur.lines.push({ addr: parseInt(m[1], 16), bytes: m[2].trim(), text: t });
    }
  }
  return funcs;
}

/* ---------- DWARF (text output of llvm-dwarfdump) ---------- */
function dwarfTree(path) {
  const text = run('llvm-dwarfdump', ['--debug-info', path]);
  const root = { tag: 'root', attrs: {}, kids: [] };
  const stack = [{ depth: -1, node: root }];
  let node = null;
  for (const raw of text.split('\n')) {
    let m = raw.match(/^0x[0-9a-f]+:(\s+)(DW_TAG_\w+|NULL)/);
    if (m) {
      if (m[2] === 'NULL') { node = null; continue; }
      const depth = (m[1].length - 1) / 2;
      node = { tag: m[2].slice(7), attrs: {}, kids: [] };
      while (stack[stack.length - 1].depth >= depth) stack.pop();
      stack[stack.length - 1].node.kids.push(node);
      stack.push({ depth, node });
      continue;
    }
    m = raw.match(/^\s+DW_AT_(\w+)\t\((.*)\)$/);
    if (m && node) node.attrs[m[1]] = m[2];
  }
  return root;
}
const unq = (s) => (s || '').replace(/^"|"$/g, '');
const typeName = (a) => { const m = (a || '').match(/^0x[0-9a-f]+ "(.*)"$/); return m ? m[1] : 'void'; };
const base = (p) => unq(p).split('/').pop();

function debugInfo(path, symAddr) {
  const tree = dwarfTree(path);
  const globals = [];
  const funcs = [];
  const typedefs = {};
  const collectVars = (n, f, lo, hi) => {
    for (const k of n.kids) {
      if (k.tag === 'variable' || k.tag === 'formal_parameter') {
        const loc = (k.attrs.location || '').match(/DW_OP_breg13 SP([+-]\d+)/);
        if (!loc) throw new Error('unexpected local location: ' + k.attrs.location);
        f.vars.push({ name: unq(k.attrs.name), type: typeName(k.attrs.type), sp: +loc[1], param: k.tag === 'formal_parameter', lo, hi });
      } else if (k.tag === 'lexical_block') {
        collectVars(k, f, parseInt(k.attrs.low_pc, 16), parseInt(k.attrs.high_pc, 16));
      }
    }
  };
  for (const cu of tree.kids) {
    for (const n of cu.kids) {
      if (n.tag === 'typedef') typedefs[unq(n.attrs.name)] = typeName(n.attrs.type);
      if (n.tag === 'variable' && n.attrs.location) {
        const name = unq(n.attrs.name);
        if (!(name in symAddr)) throw new Error('no symbol for global ' + name);
        globals.push({ name, type: typeName(n.attrs.type), addr: symAddr[name], file: base(n.attrs.decl_file) });
      }
      if (n.tag === 'subprogram' && n.attrs.low_pc) {
        const f = { name: unq(n.attrs.name), lo: parseInt(n.attrs.low_pc, 16), hi: parseInt(n.attrs.high_pc, 16),
          ret: n.attrs.type ? typeName(n.attrs.type) : 'void', file: base(n.attrs.decl_file), line: +n.attrs.decl_line, vars: [] };
        collectVars(n, f, f.lo, f.hi);
        funcs.push(f);
      }
    }
  }
  funcs.sort((a, b) => a.lo - b.lo);
  return { globals, funcs, typedefs };
}

function lineTable(path) {
  const text = run('llvm-dwarfdump', ['--debug-line', path]);
  const rows = [];
  let files = [];
  let pendingIdx = null;
  for (const raw of text.split('\n')) {
    if (/^debug_line\[/.test(raw)) { files = []; continue; }
    let m = raw.match(/^file_names\[\s*(\d+)\]:/);
    if (m) { pendingIdx = +m[1]; continue; }
    m = raw.match(/^\s+name: "(.*)"/);
    if (m && pendingIdx != null) { files[pendingIdx] = m[1].split('/').pop(); pendingIdx = null; continue; }
    m = raw.match(/^0x([0-9a-f]{16})\s+(\d+)\s+\d+\s+(\d+)\s+\d+\s+\d+\s+\d+\s*(.*)$/);
    if (m) {
      rows.push({ addr: parseInt(m[1], 16), line: +m[2], file: files[+m[3]], stmt: /is_stmt/.test(m[4]),
        pe: /prologue_end/.test(m[4]), end: /end_sequence/.test(m[4]) });
    }
  }
  rows.sort((a, b) => a.addr - b.addr || (a.end ? -1 : 1));
  return rows;
}

/* ---------- firmware inspector images ---------- */
const inspector = {};
for (const [name, about] of Object.entries({
  demo: { title: 'demo.bin', blurb: 'A small blink-and-report firmware. The ELF it was converted from is available too.', sources: ['fw_demo.c'] },
  lockbox: { title: 'lockbox.bin', blurb: 'A raw dump of a keypad lock controller. No ELF, no symbols: this is what you get from a device.', sources: ['fw_lockbox.c'] },
  updater: { title: 'updater.bin', blurb: 'A raw dump of a bootloader-style updater that checks image signatures.', sources: ['fw_updater.c'] },
})) {
  inspector[name] = {
    ...about,
    bin: b64(readFileSync(`${OUT}/${name}.bin`)),
    elf: name === 'demo' ? b64(readFileSync(`${OUT}/${name}.elf`)) : null,
    truth: elfFacts(`${OUT}/${name}.elf`),
  };
}

/* ---------- debug-session programs ---------- */
const debug = {};
for (const name of ['tour', 'hardfault', 'stuck', 'badptr']) {
  const elfPath = `${OUT}/dbg_${name}.elf`;
  const facts = elfFacts(elfPath);
  const symAddr = Object.fromEntries(facts.symbols.map((s) => [s.name, s.addr]));
  const info = debugInfo(elfPath, symAddr);
  const dis = {};
  for (const f of listing(elfPath, ['--mcpu=cortex-m0plus'])) for (const l of f.lines) dis[l.addr] = [l.bytes, l.text];
  debug[name] = {
    file: `dbg_${name}.c`, elfName: `build/${name}.elf`,
    bin: b64(readFileSync(`${OUT}/dbg_${name}.bin`)),
    ...facts, ...info,
    lines: lineTable(elfPath).map((r) => [r.addr, r.file, r.line, (r.stmt ? 1 : 0) | (r.pe ? 2 : 0) | (r.end ? 4 : 0)]),
    disasm: dis,
    sources: { 'startup.c': src('startup.c'), [`dbg_${name}.c`]: src(`dbg_${name}.c`) },
  };
}

/* ---------- disassembly lab ---------- */
const funcsC = src('disasm_funcs.c');
const cOf = (fn) => {
  const m = funcsC.match(new RegExp(`^[\\w ]+\\b${fn}\\(.*\\)\\n\\{\\n[\\s\\S]*?^\\}`, 'm'));
  if (!m) throw new Error('no C source for ' + fn);
  return m[0];
};
const wanted = ['scale_add', 'sum_array', 'led_on', 'str_equal', 'check_pin', 'read_number'];
const disasm = {};
for (const [arch, extra] of [['thumb', ['--mcpu=cortex-m0plus']], ['riscv', []]]) {
  const elfPath = `${OUT}/dis_${arch}.elf`;
  const all = listing(elfPath, extra);
  const facts = elfFacts(elfPath);
  const elf = parseElf(new Uint8Array(readFileSync(elfPath)));
  const bytes = new Uint8Array(readFileSync(elfPath));
  disasm[arch] = {
    functions: Object.fromEntries(wanted.map((w) => { const f = all.find((x) => x.name === w); return [w, { addr: f.addr, lines: f.lines, c: cOf(w) }]; })),
    callees: Object.fromEntries(['uart_read_line', 'parse_number'].map((w) => { const f = all.find((x) => x.name === w); return [w, { addr: f.addr, lines: f.lines }]; })),
    symbols: facts.symbols,
    chunks: elf.sections.filter((s) => s.flags & 2 && s.type === 1 && s.size > 0)
      .map((s) => ({ addr: s.addr, bytes: b64(bytes.subarray(s.offset, s.offset + s.size)) })),
  };
}

const js = `// GENERATED by tools/fwimages/gen.mjs from the outputs of tools/fwimages/build.sh. Do not edit by hand.
//
// Every firmware image here is synthetic: written for this course, compiled from the C sources in
// tools/fwimages/src with ${clangVersion} and linked with ld.lld. None of it was run on physical hardware.
//   bytes      llvm-objcopy -O binary (inspector images: --gap-fill 0xff)
//   listings   llvm-objdump -d (Thumb: --mcpu=cortex-m0plus), copied verbatim apart from whitespace
//   line tables, locals, types   llvm-dwarfdump --debug-line / --debug-info
//   sections, symbols            read from the ELF files
// Targets: thumbv6m-none-eabi -mcpu=cortex-m0plus (16-bit Thumb plus BL, so js/sim/armsim.js can execute all of it)
// and riscv32-unknown-elf -march=rv32im. Flags: inspector images -Os, debug programs -O0 -g, disassembly lab -Oz.
// The P-256 public key in the updater image is derived from a published string and protects nothing.

export const TOOLCHAIN = ${JSON.stringify(clangVersion)};

export function b64ToBytes(s) {
  if (typeof atob === 'function') { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export const INSPECTOR_IMAGES = ${JSON.stringify(inspector, null, 1)};

export const DEBUG_PROGRAMS = ${JSON.stringify(debug, null, 1)};

export const DISASM = ${JSON.stringify(disasm, null, 1)};
`;
writeFileSync(new URL('../../js/sim/fwimages.js', here), js);
console.log(`js/sim/fwimages.js written (${js.length} bytes)`);
