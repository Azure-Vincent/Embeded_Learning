// Address-space explorer with a "where does this live?" quiz.
import { h, clear, hex } from '../core/dom.js';
import { PLATFORMS, PLATFORM_IDS, getPlatform, fmtSize, rangeText, regionAt, show, UNVERIFIED } from '../sim/platforms.js';

/** C objects the quiz asks about. `role` must match a region's `holds` list. */
export const QUIZ_ITEMS = [
  { id: 'const-table', code: 'static const uint8_t crc_table[256] = { … };', role: 'rodata',
    why: 'It is `const` and never changes, so the linker puts it in .rodata, which lives in non-volatile memory with the code. It costs no RAM.',
    wrong: { ram: 'If constants were placed in RAM they would have to be copied there at every boot, and a 256-byte table would use RAM that small MCUs do not have to spare. `const` at file scope goes to .rodata in flash.' } },
  { id: 'global-counter', code: 'uint32_t packet_count = 0;   // file scope, incremented at run time', role: 'bss',
    why: 'It must be writable, so it lives in RAM. Because its initial value is zero it goes in .bss, which start-up code clears; it takes no space in the flash image.',
    wrong: { flash: 'Flash cannot be modified by an ordinary store instruction. `packet_count++` would have no effect (or fault). Writable globals live in RAM.' } },
  { id: 'init-global', code: 'int threshold = 512;   // file scope, changed later by a command', role: 'data',
    why: 'The variable itself lives in RAM (.data) because it is written at run time. Its initial value 512 is also stored in flash, and start-up code copies it to RAM before main().',
    wrong: { flash: 'Only the initial value is in flash. The variable the program reads and writes is the RAM copy; a store to the flash address would not change it.' } },
  { id: 'local-array', code: 'void handle(void) { uint8_t buf[64]; … }', role: 'stack',
    why: 'A non-static local exists only while the function runs. It is carved out of the stack by moving the stack pointer, and the stack is in RAM.',
    wrong: { flash: 'A local array is created and destroyed on every call and must be writable, so it cannot be in flash. It lives in the current stack frame, in RAM.' } },
  { id: 'malloc-block', code: 'uint8_t *p = malloc(128);   // where are the 128 bytes?', role: 'heap',
    why: 'malloc hands out memory from the heap, a region of RAM between the end of .bss and the stack. The pointer `p` itself is a local on the stack.',
    wrong: { flash: 'The heap must be writable and is managed at run time. It is in RAM, above .bss.' } },
  { id: 'periph-reg', code: '*(volatile uint32_t *)UART0_DATA = \'A\';   // the UART transmit register', role: 'periph',
    why: 'A peripheral register is hardware, not memory. Its address falls in the peripheral region, and the store reaches the UART instead of a RAM cell.',
    wrong: { ram: 'RAM would simply remember the byte; nothing would be transmitted. Peripheral registers have their own address range and the bus routes the store to the peripheral.', flash: 'A store to flash does not write, and nothing would be transmitted. Peripheral registers have their own address range.' } },
  { id: 'reset-vector', code: 'The reset vector — word 1 of the application\'s vector table', role: 'vector',
    why: 'The vector table is constant data placed at the very start of the application\'s flash image, so the address of the reset handler is there after power-up, before any code has run.',
    wrong: { ram: 'RAM is empty at power-up. The CPU needs the reset vector before any code has run, so it has to be in non-volatile memory.' } },
  { id: 'function-code', code: 'int add(int a, int b) { return a + b; }   // the machine code', role: 'code',
    why: 'Machine code is .text. It is stored in non-volatile memory and normally executed in place from there.',
    wrong: { ram: 'RAM loses its contents without power, so code cannot be stored there. (Code can be copied to RAM to run, but it still has to live in flash.)' } },
];

const LIVES_IN = { rodata: '.rodata', bss: '.bss', data: '.data', stack: 'stack', heap: 'heap', periph: 'a peripheral register', vector: 'the vector table', code: '.text' };

/** Quiz items a platform can pose: C objects whose role some region holds, plus one raw address per sized region. */
export function quizFor(platformId) {
  const p = getPlatform(platformId);
  const items = [];
  for (const q of QUIZ_ITEMS) {
    if (q.role === 'vector' && platformId === 'max78000') continue; // ROM-vs-flash reset path is not verified for this part
    if (p.regions.some((r) => r.holds.includes(q.role))) items.push({ ...q, kind: 'object' });
  }
  for (const r of p.regions) {
    if (r.size == null) continue;
    const addr = (r.base + Math.min(r.size - 4, 0x124)) >>> 0;
    items.push({ id: 'addr-' + r.id, kind: 'address', addr, answer: r.id, code: 'The address ' + hex(addr) });
  }
  return items;
}

/** Check a clicked region. Returns { ok, text }. */
export function checkAnswer(platformId, item, regionId) {
  const p = getPlatform(platformId);
  const r = p.regions.find((x) => x.id === regionId);
  if (!r) return { ok: false, text: 'Pick a region.' };
  if (item.kind === 'address') {
    const right = regionAt(platformId, item.addr);
    if (right && right.id === regionId) return { ok: true, text: `${hex(item.addr)} is ${hex(item.addr - r.base, 1)} bytes past the start of ${r.name} (${rangeText(r)}).` };
    const rel = r.size == null ? `${r.name} starts at ${hex(r.base)}` : `${r.name} covers ${rangeText(r)}`;
    return { ok: false, text: `${rel}, so ${hex(item.addr)} is not in it. Compare the top hex digits of the address with each region's base.` };
  }
  if (r.holds.includes(item.role)) return { ok: true, text: item.why };
  const kind = r.kind === 'ram' ? 'ram' : (r.kind === 'flash' || r.kind === 'rom') ? 'flash' : r.kind;
  let text = item.wrong?.[kind];
  if (!text) {
    if (r.kind === 'periph' || r.kind === 'system') text = `${r.name} is hardware registers, not storage. A value written there changes hardware state; it is not kept as data.`;
    else if (r.kind === 'config') text = `${r.name} holds device configuration, not program data.`;
    else if (r.kind === 'ram' && item.role !== 'ramcode') text = `${r.name} is RAM, but not where this kind of object goes on this chip. Read what each RAM region is for.`;
    else text = `Not ${r.name}. Ask two questions: must it survive power-off, and must the program be able to write it?`;
  }
  return { ok: false, text };
}

const STREAK = 5;

export default function mount(el, props = {}, ctx) {
  let pid = PLATFORM_IDS.includes(props.platform) ? props.platform : 'generic';
  let mode = props.mode === 'quiz' ? 'quiz' : 'explore';
  let sel = null, streak = 0, qi = 0, queue = [], last = null, attempted = false;
  const root = h('div', { class: 'memory-map' });
  el.append(root);

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function newQuiz() { queue = shuffle(quizFor(pid)); qi = 0; last = null; attempted = false; }
  newQuiz();

  function draw() {
    clear(root);
    const p = getPlatform(pid);
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Platform' }, PLATFORM_IDS.map((id) =>
      h('button', { type: 'button', class: 'w-tab' + (id === pid ? ' on' : ''), 'aria-pressed': String(id === pid), onclick: () => { pid = id; sel = null; streak = 0; newQuiz(); draw(); } }, PLATFORMS[id].short))));
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Mode' },
      [['explore', 'Explore'], ['quiz', 'Quiz: where does this live?']].map(([m, t]) =>
        h('button', { type: 'button', class: 'w-tab' + (m === mode ? ' on' : ''), 'aria-pressed': String(m === mode), onclick: () => { mode = m; sel = null; last = null; draw(); } }, t))));
    if (p.illustrative) root.append(h('p', { class: 'w-msg warn' }, 'Illustrative layout, not a real chip. ' + p.summary));

    const item = queue[qi];
    if (mode === 'quiz') {
      root.append(h('div', { class: 'w-task' },
        h('p', {}, item.kind === 'address' ? 'Which region contains this address? Select it in the map.' : 'Where does this live while the program runs? Select the region in the map.'),
        h('p', { class: 'w-mono memory-map-q' }, item.code),
        h('p', { class: 'w-note' }, `Streak ${streak} of ${STREAK}` + (ctx?.isDone?.() ? ' · solved before' : ''))));
    }

    const regions = [...p.regions].sort((a, b) => b.base - a.base);
    const bar = h('div', { class: 'memory-map-bar', role: 'group', 'aria-label': 'Address space, highest address at the top' });
    regions.forEach((r, i) => {
      const prev = regions[i - 1];
      if (prev && r.size != null && prev.base > r.base + r.size) bar.append(h('div', { class: 'memory-map-gap', 'aria-hidden': 'true' }, '⋮ unlisted or unused'));
      const lg = r.size == null ? 10 : Math.log2(r.size);
      const hpx = Math.round(30 + Math.max(0, lg - 10) * 2.6);
      bar.append(h('button', { type: 'button', class: `memory-map-r k-${r.kind}` + (sel === r.id ? ' sel' : ''), style: { minHeight: hpx + 'px' }, 'aria-pressed': String(sel === r.id),
        onclick: () => pick(r.id) },
        h('span', { class: 'memory-map-rn' }, r.name),
        h('span', { class: 'memory-map-ra' }, r.size == null ? hex(r.base) + ' …' : rangeText(r)),
        h('span', { class: 'memory-map-rs' }, r.size == null ? 'size: see datasheet' : fmtSize(r.size))));
    });

    const side = h('div', { class: 'memory-map-side', 'aria-live': 'polite' });
    if (mode === 'explore') {
      const r = p.regions.find((x) => x.id === sel);
      if (!r) side.append(h('p', { class: 'w-note' }, 'Select a region to see what lives there.'));
      else {
        side.append(h('h4', {}, r.name), h('dl', { class: 'w-kv' },
          h('dt', {}, 'Base'), h('dd', {}, hex(r.base)),
          h('dt', {}, 'Size'), h('dd', {}, r.size == null ? UNVERIFIED : `${fmtSize(r.size)} (${hex(r.size, 1)} bytes)`),
          h('dt', {}, 'End'), h('dd', {}, r.size == null ? UNVERIFIED : hex(r.base + r.size - 1))),
          h('p', {}, r.what),
          h('p', { class: 'w-note' }, 'Source: ', h('a', { href: r.src, target: '_blank', rel: 'noopener' }, p.illustrative ? 'Arm CMSIS (architecture; sizes illustrative)' : r.src.replace('https://github.com/', ''))));
      }
      if (p.regionNotes) side.append(h('ul', { class: 'w-note' }, p.regionNotes.map((n) => h('li', {}, show(n)))));
    } else if (last) {
      side.append(h('p', { class: 'w-msg ' + (last.ok ? 'ok' : 'bad') }, (last.ok ? 'Correct. ' : 'Not there. ') + last.text));
      if (last.ok) side.append(h('button', { type: 'button', class: 'btn small', onclick: () => { qi++; if (qi >= queue.length) newQuiz(); last = null; sel = null; attempted = false; draw(); root.querySelector('.memory-map-r')?.focus(); } }, 'Next question'));
      if (streak >= STREAK) side.append(h('p', { class: 'w-msg ok' }, `${STREAK} in a row on the first try. You can place objects in this memory map.`));
    } else side.append(h('p', { class: 'w-note' }, 'Regions are drawn on a logarithmic scale, so a 32 KB RAM and a 512 MB peripheral region both stay visible. Highest address at the top.'));

    root.append(h('div', { class: 'memory-map-grid' }, bar, side));
    root.append(h('p', { class: 'w-note' }, 'Model: region heights are log-scaled, not proportional, and gaps are compressed. Where the linker puts .data, .bss, heap and stack inside RAM is set by the linker script, not by the chip.'));
  }

  function pick(id) {
    sel = id;
    if (mode === 'quiz') {
      if (last?.ok) return;
      const item = queue[qi];
      const res = checkAnswer(pid, item, id);
      if (res.ok) { streak = attempted ? 0 : streak + 1; if (streak >= STREAK) ctx?.complete?.(); }
      else { streak = 0; attempted = true; }
      last = res;
    }
    draw();
    root.querySelector('.memory-map-r.sel')?.focus();
  }
  draw();
}
export { LIVES_IN };
