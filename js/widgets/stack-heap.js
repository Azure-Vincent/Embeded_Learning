// Step small C programs and watch .data/.bss, heap blocks and stack frames in a deliberately tiny RAM.
// The programs are scripted (each step is a hand-written machine operation), not compiled or interpreted.
import { h, clear, hex } from '../core/dom.js';

export const RAM_BASE = 0x20000000;
export const RAM_SIZE = 0x200;          // 512 bytes: small enough that problems show up within a few steps
const HDR = 8;                          // allocator bookkeeping per block in this model
const up8 = (n) => (n + 7) & ~7;

/** First-fit heap with splitting and coalescing over [start, limit). Exported for tests. */
export function createHeap(start, limit) {
  const blocks = []; // {addr (of header), size (incl. header), free, name}
  let brk = start;
  return {
    blocks, get brk() { return brk; },
    malloc(n, name) {
      const need = up8(n) + HDR;
      for (const b of blocks) {
        if (!b.free || b.size < need) continue;
        if (b.size - need >= HDR + 8) { blocks.splice(blocks.indexOf(b) + 1, 0, { addr: b.addr + need, size: b.size - need, free: true, name: '' }); b.size = need; }
        b.free = false; b.name = name; b.req = n; return b.addr + HDR;
      }
      if (brk + need > limit) return 0;
      blocks.push({ addr: brk, size: need, free: false, name, req: n }); brk += need;
      return brk - need + HDR;
    },
    free(ptr) {
      const b = blocks.find((x) => x.addr + HDR === ptr && !x.free);
      if (!b) return false;
      b.free = true; b.name = '';
      for (let i = 0; i < blocks.length - 1;) {
        if (blocks[i].free && blocks[i + 1].free) { blocks[i].size += blocks[i + 1].size; blocks.splice(i + 1, 1); } else i++;
      }
      const last = blocks[blocks.length - 1];
      if (last && last.free) { brk = last.addr; blocks.pop(); }
      return true;
    },
    freeBytes() { return blocks.filter((b) => b.free).reduce((a, b) => a + b.size, 0) + (limit - brk); },
    largestFree() { return Math.max(limit - brk, ...blocks.filter((b) => b.free).map((b) => b.size), 0); },
  };
}

// Each program: C source (shown as-is), statics, heap size, and a script of operations tied to source lines.
export const PROGRAMS = {
  nested: {
    title: 'Nested calls',
    heapSize: 0x40,
    statics: [{ name: 'gain', sect: '.data', size: 4, value: 3 }, { name: 'samples_taken', sect: '.bss', size: 4, value: 0 }],
    source: `int gain = 3;               // .data: has an initial value
int samples_taken;          // .bss: starts at zero

int scale(int raw) {
    int out = raw * gain;
    return out;
}
int read_sensor(void) {
    int raw = 100;
    int v = scale(raw);
    samples_taken++;
    return v;
}
int main(void) {
    int result = read_sensor();
    for (;;) { }
}`,
    script: [
      { line: 14, op: 'call', fn: 'main', locals: [['result', 4, '?']], text: 'Start-up code has copied 3 into gain and zeroed samples_taken. It calls main(), which reserves a frame: the saved return address and frame pointer, and space for result. A local has no value until it is assigned.' },
      { line: 15, op: 'call', fn: 'read_sensor', locals: [['raw', 4, '?'], ['v', 4, '?']], text: 'Calling read_sensor() moves SP down again. The new frame sits below main()\'s: the stack grows toward lower addresses.' },
      { line: 9, op: 'set', name: 'raw', value: 100, text: 'raw = 100 is a store into the current frame, at an address relative to SP.' },
      { line: 10, op: 'call', fn: 'scale', locals: [['out', 4, '?']], text: 'A third frame. The argument raw travels in register R0, so it does not appear in memory here. Three functions are active; all three frames exist at once.' },
      { line: 5, op: 'set', name: 'out', value: 300, text: 'out = raw * gain. gain is read from its fixed address in .data; out is in the frame.' },
      { line: 6, op: 'ret', text: 'Return: SP moves back up past scale()\'s frame. Nothing is erased — the bytes below SP still hold 300 — but they no longer belong to anyone.' },
      { line: 10, op: 'set', name: 'v', value: 300, text: 'The return value arrived in R0 and is stored into v.' },
      { line: 11, op: 'static', name: 'samples_taken', value: 1, text: 'samples_taken++ writes to a fixed address in .bss. Statics keep their address and value for the whole run; that is the difference from a local.' },
      { line: 12, op: 'ret', text: 'read_sensor() returns. Its frame is released the same way.' },
      { line: 15, op: 'set', name: 'result', value: 300, text: 'result = 300. Peak stack use was three frames deep: that peak, not the average, is what the stack must be sized for.' },
    ],
  },
  recursion: {
    title: 'Recursion until the stack overflows',
    heapSize: 0x80,
    statics: [{ name: 'depth_seen', sect: '.bss', size: 4, value: 0 }, { name: 'log', sect: '.bss', size: 4, value: 0 }],
    source: `int depth_seen;
char *log;

void walk(int n) {
    char path[48];
    path[0] = (char)n;
    depth_seen = n;
    walk(n + 1);            // bug: no base case
}
int main(void) {
    log = malloc(64);
    walk(1);
    for (;;) { }
}`,
    script: [
      { line: 10, op: 'call', fn: 'main', locals: [], text: 'main() starts. The linker script reserved the top of RAM for the stack and 128 bytes above .bss for the heap. Nothing enforces that boundary at run time.' },
      { line: 11, op: 'malloc', into: 'log', isStatic: true, size: 64, name: 'log buffer', text: 'malloc(64) takes 72 bytes from the heap (64 plus an 8-byte header in this model) and returns the address just past the header.' },
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ line: 4, op: 'call', fn: `walk(${n})`, locals: [['path[48]', 48, n]], also: { name: 'depth_seen', value: n },
        text: n === 1 ? 'walk(1): 56 bytes of frame — 48 for path plus the saved registers.' : n === 6 ? 'walk(6). Only 32 bytes are left in the area the linker reserved for the stack: less than one more frame.' : `walk(${n}) calls itself: another 56 bytes.` })),
      { line: 4, op: 'call', fn: 'walk(7)', locals: [['path[48]', 48, 7]], also: { name: 'depth_seen', value: 7 }, text: 'walk(7). SP is now below the stack\'s reserved area, inside the heap\'s. No exception, no warning: a plain Cortex-M core has no idea where the stack was supposed to end. The program still appears to work.' },
      { line: 4, op: 'call', fn: 'walk(8)', locals: [['path[48]', 48, 8]], also: { name: 'depth_seen', value: 8 }, text: 'walk(8). This frame overlaps the block malloc returned. Writing path[] overwrites the log buffer, and a later write to the log would overwrite walk\'s saved return address. The crash, when it comes, will be somewhere unrelated.' },
      { line: 8, op: 'note', text: 'One more call would run through .bss; a few more would reach the bottom of RAM, and only then would the CPU fault. Defences: no unbounded recursion, measure worst-case stack depth, enable a stack limit register or MPU guard region where the core has one, and fill the stack with a known pattern to check the high-water mark.' },
    ],
  },
  fragmentation: {
    title: 'malloc and free: fragmentation',
    heapSize: 320,
    statics: [],
    source: `int main(void) {
    char *a = malloc(96);
    char *b = malloc(96);
    char *c = malloc(96);
    free(a);
    free(c);
    char *big = malloc(160);    // 216 bytes are free...
    if (big == NULL) { error(); }
    for (;;) { }
}`,
    script: [
      { line: 1, op: 'call', fn: 'main', locals: [['a', 4, '?'], ['b', 4, '?'], ['c', 4, '?'], ['big', 4, '?']], text: 'The heap is 320 bytes. main()\'s four pointers are locals on the stack; what they will point to is in the heap.' },
      { line: 2, op: 'malloc', into: 'a', size: 96, name: 'a', text: 'a: 104 bytes used (96 + header).' },
      { line: 3, op: 'malloc', into: 'b', size: 96, name: 'b', text: 'b follows a.' },
      { line: 4, op: 'malloc', into: 'c', size: 96, name: 'c', text: 'c follows b. 312 of 320 bytes are in use.' },
      { line: 5, op: 'free', ptr: 'a', text: 'free(a) leaves a 104-byte hole at the start of the heap. The pointer a still holds the old address: using it now would be a use-after-free.' },
      { line: 6, op: 'free', ptr: 'c', text: 'free(c): the block joins the 8 unused bytes at the end, giving 112 free bytes there. Total free: 216 bytes, in two pieces with b between them.' },
      { line: 7, op: 'malloc', into: 'big', size: 160, name: 'big', text: 'malloc(160) needs 168 contiguous bytes. The largest free piece is 112. It returns NULL although 216 bytes are free. The allocator cannot move b: the program holds its address.' },
      { line: 8, op: 'note', text: 'This is fragmentation. On a device that must run for months, a failure that depends on allocation history is why many firmware designs allocate only at start-up, or use fixed-size pools, or do not use malloc at all.' },
    ],
  },
  dangling: {
    title: 'Returning a pointer to a local',
    heapSize: 0x40,
    statics: [],
    source: `int *get_reading(void) {
    int reading = 42;
    return &reading;        // bug: address of a local
}
void other_work(void) {
    int scratch = 0xDEAD;
}
int main(void) {
    int *p = get_reading();
    other_work();
    int v = *p;             // what is v?
    for (;;) { }
}`,
    script: [
      { line: 8, op: 'call', fn: 'main', locals: [['p', 4, '?'], ['v', 4, '?']], text: 'main() has two locals: a pointer p and an int v.' },
      { line: 1, op: 'call', fn: 'get_reading', locals: [['reading', 4, '?']], text: 'get_reading() gets a frame with room for reading.' },
      { line: 2, op: 'set', name: 'reading', value: 42, text: 'reading = 42, stored in the frame. Note its address.' },
      { line: 3, op: 'ret', ret: { name: 'p', valueOf: 'reading' }, text: 'The function returns the address of reading, and its frame is released. p now points below SP, into memory no function owns. The 42 is still there — for now — which is why this bug often passes a quick test.' },
      { line: 5, op: 'call', fn: 'other_work', locals: [['scratch', 4, '?']], text: 'The next call gets a frame at the same addresses get_reading() used.' },
      { line: 6, op: 'set', name: 'scratch', value: 0xDEAD, text: 'scratch = 0xDEAD lands at the exact address p points to.' },
      { line: 7, op: 'ret', text: 'other_work() returns.' },
      { line: 11, op: 'deref', into: 'v', ptr: 'p', text: 'v = *p reads whatever is at that address now: 0xDEAD, not 42. With an interrupt in between it could be anything. Fixes: return the value, have the caller pass a pointer to storage it owns, or use static storage (and accept it is shared).' },
    ],
  },
};

/** Run a program's script; returns one snapshot per step (index 0 = before main). */
export function runProgram(id) {
  const prog = PROGRAMS[id] || PROGRAMS.nested;
  let a = RAM_BASE;
  const statics = [];
  for (const sect of ['.data', '.bss']) for (const sv of prog.statics.filter((x) => x.sect === sect)) { statics.push({ ...sv, addr: a }); a += up8(sv.size) === sv.size ? sv.size : 4; }
  const heapStart = up8(a), heapLimit = heapStart + prog.heapSize;
  const heap = createHeap(heapStart, heapLimit);
  const top = RAM_BASE + RAM_SIZE;
  let sp = top; const frames = []; let ghost = null;
  const snaps = [];
  const findLocal = (name) => { for (let i = frames.length - 1; i >= 0; i--) { const sl = frames[i].slots.find((x) => x.name === name); if (sl) return sl; } return null; };
  const setVar = (name, value, isStatic) => { const t = isStatic ? statics.find((x) => x.name === name) : findLocal(name); if (t) t.value = value; };
  const snap = (step, extra = {}) => {
    const corrupt = heap.blocks.filter((b) => !b.free && sp < b.addr + b.size).map((b) => b.addr);
    snaps.push(JSON.parse(JSON.stringify({ line: step.line, text: step.text, sp, top, heapStart, heapLimit, brk: heap.brk, statics, frames, ghost,
      blocks: heap.blocks, freeBytes: heap.freeBytes(), largestFree: heap.largestFree(), pastLimit: sp < heapLimit, corrupt, ...extra })));
  };
  snap({ line: 0, text: 'Before main(): start-up code has initialised .data and .bss. The stack pointer is at the top of RAM and the heap is empty.' });
  for (const st of prog.script) {
    const extra = {};
    if (st.op === 'call') {
      const size = up8(8 + st.locals.reduce((n, l) => n + up8(l[1]) / (l[1] <= 4 ? 2 : 1), 0));
      const base = sp; sp -= size; let at = base - 8;
      const slots = [{ name: 'saved LR, FP', addr: base - 8, size: 8, value: '' }];
      for (const [name, sz, value] of st.locals) { at -= sz <= 4 ? 4 : up8(sz); slots.push({ name, addr: at, size: sz, value }); }
      frames.push({ fn: st.fn, base, sp, size, slots });
      if (ghost && ghost.sp >= sp) ghost = null;
      if (st.also) setVar(st.also.name, st.also.value, true);
    } else if (st.op === 'ret') {
      const fr = frames.pop(); let retVal;
      if (st.ret) retVal = fr.slots.find((x) => x.name === st.ret.valueOf).addr;
      sp = fr.base; ghost = fr;
      if (st.ret) setVar(st.ret.name, hex(retVal));
    } else if (st.op === 'set') setVar(st.name, st.value);
    else if (st.op === 'static') setVar(st.name, st.value, true);
    else if (st.op === 'malloc') { const p = heap.malloc(st.size, st.name); setVar(st.into, p ? hex(p) : 'NULL', st.isStatic); extra.failed = !p; }
    else if (st.op === 'free') { const sl = findLocal(st.ptr); heap.free(parseInt(sl.value, 16)); }
    else if (st.op === 'deref') {
      const addr = parseInt(findLocal(st.ptr).value, 16);
      const src = (ghost ? ghost.slots : []).concat(...frames.map((f) => f.slots)).find((x) => x.addr === addr);
      setVar(st.into, src ? src.value : '?'); extra.readAddr = addr;
    }
    snap(st, extra);
  }
  return snaps;
}

const fmtVal = (v) => typeof v === 'number' ? (v > 255 ? hex(v, 1) : String(v)) : String(v);

export default function mount(el, props = {}, ctx) {
  let pid = PROGRAMS[props.program] ? props.program : 'nested';
  let snaps = runProgram(pid), i = 0;
  const root = h('div', { class: 'stack-heap' });
  el.append(root);

  function draw() {
    clear(root);
    const prog = PROGRAMS[pid], sn = snaps[i];
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Program' }, Object.entries(PROGRAMS).map(([id, p]) =>
      h('button', { type: 'button', class: 'w-tab' + (id === pid ? ' on' : ''), 'aria-pressed': String(id === pid), onclick: () => { pid = id; snaps = runProgram(id); i = 0; draw(); } }, p.title))));

    const src = h('pre', { class: 'stack-heap-src w-mono', 'aria-label': 'C source' }, prog.source.split('\n').map((ln, k) =>
      h('div', { class: 'stack-heap-ln' + (k + 1 === sn.line ? ' cur' : '') }, h('span', { class: 'n' }, String(k + 1).padStart(2, ' ')), ' ' + ln)));

    const mem = h('div', { class: 'stack-heap-mem' });
    const head = (t, sub) => h('div', { class: 'stack-heap-h' }, h('span', {}, t), sub ? h('span', { class: 'w-mono' }, sub) : null);
    mem.append(head('Stack — grows down', 'top of RAM ' + hex(sn.top)));
    for (const f of sn.frames) {
      const bad = sn.corrupt.length && f.sp < Math.max(...sn.blocks.filter((b) => sn.corrupt.includes(b.addr)).map((b) => b.addr + b.size));
      mem.append(h('div', { class: 'stack-heap-frame' + (f.sp < sn.heapLimit ? ' over' : '') + (bad ? ' hit' : '') },
        h('div', { class: 'fn' }, f.fn, h('span', { class: 'w-mono' }, ` ${f.size} bytes`)),
        f.slots.map((sl) => h('div', { class: 'stack-heap-slot w-mono' + (sn.readAddr === sl.addr ? ' rd' : '') }, h('span', {}, hex(sl.addr)), h('span', {}, sl.name), h('span', {}, fmtVal(sl.value))))));
    }
    mem.append(h('div', { class: 'stack-heap-sp w-mono' }, 'SP = ' + hex(sn.sp)));
    if (sn.ghost) mem.append(h('div', { class: 'stack-heap-frame ghost' }, h('div', { class: 'fn' }, 'released: ' + sn.ghost.fn, h('span', { class: 'w-mono' }, ' bytes still in memory')),
      sn.ghost.slots.slice(1).map((sl) => h('div', { class: 'stack-heap-slot w-mono' + (sn.readAddr === sl.addr ? ' rd' : '') }, h('span', {}, hex(sl.addr)), h('span', {}, sl.name), h('span', {}, fmtVal(sl.value))))));
    const gap = sn.sp - sn.brk;
    mem.append(h('div', { class: 'stack-heap-gap w-mono' + (gap < 0 ? ' bad' : sn.pastLimit ? ' warn' : '') },
      gap < 0 ? `stack and heap overlap by ${-gap} bytes` : `${gap} bytes between SP and the heap's used end` + (sn.pastLimit ? ` — SP is below the stack's reserved limit ${hex(sn.heapLimit)}` : '')));
    mem.append(head('Heap — grows up', `${hex(sn.heapStart)}–${hex(sn.heapLimit - 1)} · ${sn.freeBytes} free, largest piece ${sn.largestFree}`));
    if (!sn.blocks.length) mem.append(h('div', { class: 'stack-heap-blk free w-mono' }, 'empty'));
    for (const b of [...sn.blocks].reverse()) mem.append(h('div', { class: 'stack-heap-blk w-mono' + (b.free ? ' free' : '') + (sn.corrupt.includes(b.addr) ? ' hit' : '') },
      h('span', {}, hex(b.addr)), h('span', {}, b.free ? 'free' : b.name + (sn.corrupt.includes(b.addr) ? ' — overwritten by the stack' : '')), h('span', {}, b.size + ' bytes')));
    mem.append(head('Static data', hex(RAM_BASE)));
    if (!sn.statics.length) mem.append(h('div', { class: 'stack-heap-slot w-mono' }, h('span', {}, ''), h('span', {}, 'none in this program'), h('span', {}, '')));
    for (const sv of [...sn.statics].reverse()) mem.append(h('div', { class: 'stack-heap-slot w-mono' }, h('span', {}, hex(sv.addr)), h('span', {}, `${sv.name} (${sv.sect})`), h('span', {}, fmtVal(sv.value))));

    const flags = [];
    if (sn.failed) flags.push(h('p', { class: 'w-msg bad' }, 'malloc returned NULL.'));
    if (sn.corrupt.length) flags.push(h('p', { class: 'w-msg bad' }, 'Stack overflow: the current frame overlaps live heap data.'));
    else if (sn.pastLimit && sn.frames.length) flags.push(h('p', { class: 'w-msg warn' }, 'The stack has left the region the linker reserved for it. Nothing has detected this.'));

    root.append(h('div', { class: 'stack-heap-grid' },
      h('div', {}, src,
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn small ghost', disabled: i === 0, onclick: () => { i--; draw(); } }, 'Back'),
          h('button', { type: 'button', class: 'btn small', disabled: i === snaps.length - 1, onclick: () => { i++; if (i === snaps.length - 1) ctx?.complete?.(); draw(); root.querySelector('.row .btn:not(.ghost)')?.focus(); } }, 'Step'),
          h('span', { class: 'w-mono' }, `${i} / ${snaps.length - 1}`)),
        h('div', { 'aria-live': 'polite' }, h('p', { class: 'w-msg' }, sn.text), flags)),
      mem));
    root.append(h('p', { class: 'w-note' }, `Model: RAM is ${RAM_SIZE} bytes at ${hex(RAM_BASE)} so that limits are reached quickly. The steps are scripted by hand to match what a typical unoptimised Arm build does; a real compiler may keep locals in registers, merge frames or remove unused variables. The 8-byte heap header and first-fit policy are one common design, not a standard.`));
  }
  draw();
}
