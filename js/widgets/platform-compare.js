// Side-by-side comparison of ESP32 / MAX78000 / MSPM0L2228 on selectable axes. Every cell cites its source.
import { h, clear } from '../core/dom.js';
import { PLATFORMS, AXES, COMPARE, show } from '../sim/platforms.js';

export const COMPARE_IDS = Object.keys(COMPARE);

/** Transfer questions: the learner writes an answer first, then compares with a model answer. */
export const QUESTIONS = [
  { id: 'gpio-transfer',
    q: 'You know how to toggle a GPIO on an ESP32 with ESP-IDF. What are the three things you must find out before you can do it on the MSPM0L2228?',
    a: ['Which pin, and how it becomes a GPIO: the port and pin number on the board (in the eCTF 2026 reference design the LED is PB14), and the pin-mux setting that selects the GPIO function for it.',
      'How the peripheral is switched on and addressed: whether the GPIO port needs power or a clock enabled first, and its register addresses or driverlib calls. These come from the device header and the MSPM0 SDK, not from memory of another chip.',
      'How the tools get your code onto the chip: the SDK and compiler (the eCTF 2026 design uses TI Arm Clang, not GCC), the linker script with this chip\'s memory map (SRAM at 0x20200000), and the probe or bootloader used to flash it.',
      'What carries over unchanged is the idea: configure direction, write an output register, and never assume a pin is free without reading the board documentation.'] },
  { id: 'same-core',
    q: 'The MAX78000 and the MSPM0L2228 both contain an Arm Cortex-M core. Name two things that are therefore the same for firmware, and two that are not.',
    a: ['Same, because Arm defines them: the exception model (vector table, automatic stacking of R0–R3, R12, LR, PC, xPSR) and the core peripherals at fixed addresses — NVIC at 0xE000E100, SysTick at 0xE000E010.',
      'Not the same: the instruction set subset (Cortex-M4 with FPU versus Cortex-M0+, which has no hardware floating point and only 4 interrupt priority levels on this part), and everything the vendor designed — memory map (flash at 0x10000000 versus 0x00000000, SRAM at 0x20000000 versus 0x20200000), peripheral registers, clocks, boot configuration, SDK.',
      'A similar architecture is not equivalent hardware. A binary built for one will not run on the other, and a driver written for one will not compile for the other.'] },
  { id: 'attack-surface',
    q: 'An ESP32 design and an MSPM0L2228 design both "store a secret key in flash". Why is the first question an attacker asks different for each?',
    a: ['On the ESP32 the program flash is a separate SPI chip on the module. The first question is whether flash encryption is enabled, because otherwise the chip can be read with a clip and a programmer without touching the CPU.',
      'On the MSPM0L2228 flash is inside the microcontroller. The first question is whether the debug port and the bootstrap loader are still open — both are policies in the NONMAIN boot configuration — because those are the designed ways to read internal memory.',
      'Same requirement, different hardware, different first attack. This is why a threat model has to be redone for each platform rather than copied.'] },
  { id: 'esp32-family',
    q: 'A colleague says "it runs on ESP32, so it will run on the ESP32-C3". Which facts in this table should make you cautious?',
    a: ['The ESP32 is Xtensa with two cores; the ESP32-C3 is RISC-V with one. Compiled code, assembly and anything that assumes two cores does not carry over.',
      'The ROM loads the second-stage bootloader from flash offset 0x1000 on the ESP32 and from 0x0 on the C3, so flashing scripts differ.',
      'Flash encryption is a different scheme (AES with a key tweak on the ESP32, XTS-AES on the C3), and the debug path differs (JTAG pins versus built-in USB Serial/JTAG).',
      'ESP-IDF hides much of this behind the same API, which is what makes the claim often true for application code — but it is the SDK doing the work, not the hardware being the same.'] },
];

export default function mount(el, props = {}, ctx) {
  let plats = Array.isArray(props.platforms) ? props.platforms.filter((p) => COMPARE[p]) : [...COMPARE_IDS];
  if (plats.length < 2) plats = [...COMPARE_IDS];
  let axes = Array.isArray(props.axes) ? props.axes.filter((a) => AXES.some((x) => x.id === a)) : ['cpu', 'memory', 'debug', 'boot'];
  if (!axes.length) axes = ['cpu', 'memory', 'debug', 'boot'];
  const answers = {}; const shown = new Set();
  let note = '';
  const root = h('div', { class: 'platform-compare' });
  el.append(root);
  const tableBox = h('div', {});
  const pickBox = h('div', {});

  const cite = (fact) => h('a', { class: 'platform-compare-src', href: fact.src, target: '_blank', rel: 'noopener', title: fact.src }, 'source');
  function cell(pid, aid) {
    const facts = COMPARE[pid][aid] || [];
    return h('ul', { class: 'platform-compare-facts' }, facts.map((f) => h('li', { class: f.v == null ? 'unv' : '' }, show(f), ' ', cite(f))));
  }

  function drawPick() {
    clear(pickBox);
    const chk = (label, on, toggle, disabled) => { const c = h('input', { type: 'checkbox', checked: on, disabled, onchange: () => { toggle(c.checked); } }); return h('label', { class: 'platform-compare-chk' }, c, ' ' + label); };
    pickBox.append(
      h('fieldset', {}, h('legend', {}, 'Platforms (two or three)'), COMPARE_IDS.map((id) => chk(PLATFORMS[id].short, plats.includes(id), (on) => {
        if (on) plats = COMPARE_IDS.filter((x) => plats.includes(x) || x === id);
        else if (plats.length > 2) plats = plats.filter((x) => x !== id);
        else note = 'A comparison needs at least two platforms.';
        drawPick(); drawTable();
      }))),
      h('fieldset', {}, h('legend', {}, 'Axes'), AXES.map((a) => chk(a.title, axes.includes(a.id), (on) => {
        axes = AXES.map((x) => x.id).filter((x) => (x === a.id ? on : axes.includes(x)));
        drawTable();
      })),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn small ghost', onclick: () => { axes = AXES.map((a) => a.id); drawPick(); drawTable(); } }, 'All axes'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => { axes = []; drawPick(); drawTable(); } }, 'None'))));
    if (note) { pickBox.append(h('p', { class: 'w-msg warn', 'aria-live': 'polite' }, note)); note = ''; }
  }

  function drawTable() {
    clear(tableBox);
    if (!axes.length) { tableBox.append(h('p', { class: 'w-note' }, 'Select at least one axis.')); return; }
    tableBox.append(h('div', { class: 'platform-compare-wrap' }, h('table', { class: 'platform-compare-t n' + plats.length },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Axis'), plats.map((p) => h('th', { scope: 'col' }, PLATFORMS[p].name)))),
      h('tbody', {}, AXES.filter((a) => axes.includes(a.id)).map((a) => h('tr', {}, h('th', { scope: 'row' }, a.title), plats.map((p) => h('td', { 'data-p': PLATFORMS[p].short }, cell(p, a.id)))))))));
  }

  const qBox = h('div', { class: 'platform-compare-qs' }, QUESTIONS.map((q, i) => {
    const ta = h('textarea', { rows: 3, 'aria-label': 'Your answer to question ' + (i + 1), placeholder: 'Write your answer first.' });
    const out = h('div', { 'aria-live': 'polite' });
    const btn = h('button', { type: 'button', class: 'btn small', onclick: () => {
      clear(out);
      if (ta.value.trim().length < 30) { out.append(h('p', { class: 'w-msg warn' }, 'Write a real attempt first — a few sentences. The comparison is only useful against something you committed to.')); return; }
      answers[q.id] = ta.value; shown.add(q.id);
      out.append(h('div', { class: 'w-msg' }, h('strong', {}, 'A model answer — compare it with yours:'), h('ul', {}, q.a.map((t) => h('li', {}, t)))));
      if (shown.size === QUESTIONS.length) ctx?.complete?.();
    } }, 'Compare with a model answer');
    return h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, `Transfer question ${i + 1}. `), q.q), ta, h('div', { class: 'row' }, btn), out);
  }));

  root.append(
    h('p', { class: 'w-msg warn' }, 'A similar architecture is not equivalent hardware. Two chips with "an Arm core" or "the ESP32 name" share ideas and sometimes tools; they do not share memory maps, peripheral registers, boot behaviour or attack surface. Use this table to find what transfers and what must be looked up again.'),
    pickBox, tableBox,
    h('p', { class: 'w-note' }, 'Every statement links to the vendor or MITRE repository file it was taken from (docs/FACTS.md). Datasheets and reference manuals were not available when the fact sheet was compiled, so some cells say "not verified here — see datasheet" instead of giving a number. None of this was measured on hardware. The "attack surface" row lists exposures that follow from the cited facts; it is a starting point for a threat model, not a complete one.'),
    h('h4', {}, 'What transfers?'), qBox);
  drawPick(); drawTable();
}
