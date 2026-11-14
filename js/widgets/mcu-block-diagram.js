// Clickable block diagram of a microcontroller, with button-stepped traces of three operations across the blocks.
import { h, s, clear } from '../core/dom.js';
import { PLATFORMS, PLATFORM_IDS, getPlatform, show, UNVERIFIED } from '../sim/platforms.js';

/** What each block is, independent of the chip. */
export const BLOCKS = {
  cpu: { label: 'CPU core', what: 'Executes instructions one after another: fetch from memory, decode, execute. It has no idea what a "pin" or a "UART" is — it only reads and writes addresses on the bus.' },
  flash: { label: 'Flash', what: 'Non-volatile memory: keeps its contents without power. Holds the program and constants. Slow to write (erase a whole page first), so the running program treats it as read-only.' },
  sram: { label: 'SRAM', what: 'Volatile read/write memory for variables, the stack and the heap. Contents are undefined after power-up until start-up code initialises them.' },
  rom: { label: 'ROM / boot', what: 'Code or configuration fixed by the manufacturer that runs or is consulted before your program. It is the first link in any chain of trust because it cannot be reflashed.' },
  debug: { label: 'Debug port', what: 'A side door onto the bus. A debug probe can halt the CPU and read or write memory and registers. Invaluable in development; a liability if left open on a product.' },
  bus: { label: 'System bus', what: 'The shared wires — address, data and control — that connect the CPU to everything else. An address decoder watches the address and enables exactly one block per access. That is what "memory-mapped" means.' },
  clock: { label: 'Clock', what: 'Oscillators, dividers and gates that produce the clock for the CPU and each peripheral. A peripheral with its clock gated off does nothing and usually ignores register writes.' },
  intc: { label: 'Int. ctrl', what: 'The interrupt controller. Collects interrupt request lines from peripherals, applies enable bits and priorities, and tells the CPU to stop what it is doing and run a handler.' },
  timers: { label: 'Timers', what: 'Counters driven by a clock. They measure time, generate periodic interrupts and PWM, and — as a watchdog — reset the chip if firmware stops responding.' },
  gpio: { label: 'GPIO', what: 'General-purpose I/O. Registers whose bits are wired to pin drivers and input buffers: write a bit to drive a pin high or low, read a bit to sample a pin.' },
  uart: { label: 'UART', what: 'Asynchronous serial port: shifts bytes out and in one bit at a time at an agreed baud rate, with start and stop bits. No shared clock wire.' },
  i2c: { label: 'I2C', what: 'Two-wire bus (SDA, SCL) for talking to several addressed chips. Open-drain, so it needs pull-up resistors.' },
  spi: { label: 'SPI', what: 'Clocked serial bus with a chip-select per device. Fast and simple; data moves in both directions on every clock edge.' },
  adc: { label: 'ADC', what: 'Analog-to-digital converter: samples a pin voltage and turns it into a number relative to a reference voltage.' },
  security: { label: 'Security', what: 'Hardware that firmware cannot easily replace: cipher engines, a true random number generator, protected key storage, one-time-programmable configuration, tamper inputs.' },
  pins: { label: 'External pins', what: 'The package pins. Each is shared by several functions; a pin-mux setting decides whether a pin is GPIO, UART TX, an ADC input, and so on.' },
};

/** Operation traces. Each step lights the blocks involved; nothing plays by itself. */
export const TRACES = {
  'gpio-write': {
    title: 'Write a GPIO output',
    steps: [
      { on: ['cpu', 'flash', 'bus'], text: 'The CPU fetches a store instruction from flash. In C this was something like `*GPIO_OUT |= (1u << 5);`.' },
      { on: ['cpu', 'bus'], text: 'Executing it, the CPU puts the register\'s address on the address bus, the new value on the data bus, and asserts "write".' },
      { on: ['bus', 'gpio'], text: 'The address decoder sees an address in the GPIO block\'s range and enables GPIO — not SRAM, not flash. Same instruction as a memory store; different destination.' },
      { on: ['gpio', 'clock'], text: 'On the next clock edge the GPIO output register latches the value. If the GPIO block\'s clock were gated off, nothing would be latched.' },
      { on: ['gpio', 'pins'], text: 'The output driver for bit 5 turns on its high-side transistor. The pin goes to the supply voltage, provided the pin-mux gives that pin to GPIO and the direction bit says "output".' },
    ],
  },
  'uart-rx-irq': {
    title: 'UART receive interrupt',
    steps: [
      { on: ['pins', 'uart'], text: 'A start bit arrives: the RX pin falls from idle-high to low.' },
      { on: ['uart', 'clock'], text: 'The UART samples the line at the baud rate, derived from its clock, and shifts eight data bits into a shift register. The CPU is not involved; it is running other code.' },
      { on: ['uart', 'intc'], text: 'After the stop bit the byte moves to the receive data register and the "RX ready" flag is set. If that interrupt is enabled in the UART, its request line to the interrupt controller goes high.' },
      { on: ['intc', 'cpu'], text: 'The interrupt controller checks the enable bit and the priority. If nothing more urgent is running, it signals the CPU.' },
      { on: ['cpu', 'sram', 'bus'], text: 'The CPU finishes the current instruction and saves the interrupted context on the stack, which is in SRAM.' },
      { on: ['cpu', 'flash', 'bus'], text: 'It reads the handler\'s address from the vector table and jumps there. The handler\'s code is in flash.' },
      { on: ['cpu', 'bus', 'uart'], text: 'The handler reads the receive data register over the bus. On most UARTs that read also clears the "RX ready" flag; if the flag were left set, the interrupt would fire again immediately.' },
      { on: ['cpu', 'sram'], text: 'The handler stores the byte in a buffer in SRAM and returns. The saved context is restored and the interrupted code continues, unaware.' },
    ],
  },
  'adc-read': {
    title: 'ADC read',
    steps: [
      { on: ['cpu', 'bus', 'adc'], text: 'The CPU writes the ADC control register: select a channel, start a conversion. This is one store instruction to an address in the ADC block.' },
      { on: ['pins', 'adc'], text: 'The ADC connects the selected pin to its sampling capacitor for the sample time. A high-impedance source needs a longer sample time to charge it.' },
      { on: ['adc', 'clock'], text: 'The converter works out the code over several ADC clock cycles. The CPU keeps running instructions in the meantime.' },
      { on: ['adc', 'intc'], text: 'When finished, the ADC sets a "done" flag and writes the result register. Firmware can poll the flag or let it raise an interrupt.' },
      { on: ['cpu', 'bus', 'adc'], text: 'The CPU reads the result register over the bus: a load from an address in the ADC block.' },
      { on: ['cpu', 'sram'], text: 'The number is only a ratio: code ÷ full-scale × reference voltage. Firmware converts and stores it in SRAM.' },
    ],
  },
};

const TOP = [['cpu', 20, 150], ['flash', 190, 110], ['sram', 316, 110], ['rom', 442, 110], ['debug', 568, 110]];
const BOT = ['clock', 'intc', 'timers', 'gpio', 'uart', 'i2c', 'spi', 'adc', 'security'];
const HAS_PINS = new Set(['gpio', 'uart', 'i2c', 'spi', 'adc']);
const HAS_IRQ = new Set(['timers', 'gpio', 'uart', 'i2c', 'spi', 'adc']);

export default function mount(el, props = {}, ctx) {
  let pid = PLATFORM_IDS.includes(props.platform) ? props.platform : 'generic';
  let sel = 'cpu';
  let trace = null, ti = 0;
  const root = h('div', { class: 'mcu-block-diagram' });
  el.append(root);

  function blockFact(id) {
    const p = getPlatform(pid);
    if (id === 'bus') return null;
    return p.blocks[id];
  }

  function draw() {
    clear(root);
    const p = getPlatform(pid);
    const lit = new Set(trace ? TRACES[trace].steps[ti].on : []);
    root.append(h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Platform' }, PLATFORM_IDS.map((id) =>
      h('button', { type: 'button', class: 'w-tab' + (id === pid ? ' on' : ''), 'aria-pressed': String(id === pid), onclick: () => { pid = id; draw(); } }, PLATFORMS[id].short))));
    if (p.illustrative) root.append(h('p', { class: 'w-msg warn' }, 'Illustrative layout, not a real chip. ' + p.summary));
    else root.append(h('p', { class: 'w-note' }, p.summary));

    const svg = s('svg', { viewBox: '0 0 760 440', class: 'w-svg mcu-block-diagram-svg', role: 'group', 'aria-label': 'Block diagram of ' + p.name });
    const block = (id, x, y, w, hgt, label) => {
      const absent = id !== 'bus' && id !== 'pins' && p.blocks[id] === null;
      const cls = 'mcu-block-diagram-b' + (sel === id ? ' sel' : '') + (lit.has(id) ? ' lit' : '') + (absent ? ' absent' : '');
      const pick = () => { sel = id; draw(); root.querySelector('[data-b="' + id + '"]')?.focus(); };
      const g = s('g', { class: cls, tabindex: 0, role: 'button', 'data-b': id, 'aria-label': (label || BLOCKS[id].label) + (absent ? ' (not present in this layout)' : ''), 'aria-pressed': String(sel === id),
        onclick: pick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } },
        s('rect', { x, y, width: w, height: hgt, rx: 4 }),
        s('text', { x: x + w / 2, y: y + hgt / 2 + 5, 'text-anchor': 'middle', 'font-size': 14 }, label || BLOCKS[id].label));
      svg.append(g);
    };
    // wires first so blocks paint over them
    const wire = (x1, y1, x2, y2, cls = '') => svg.append(s('line', { x1, y1, x2, y2, class: 'mcu-block-diagram-w ' + cls }));
    for (const [id, x, w] of TOP) wire(x + w / 2, 90, x + w / 2, 150, lit.has(id) && lit.has('bus') ? 'lit' : '');
    BOT.forEach((id, i) => {
      const x = 20 + i * 81 + 36;
      if (id !== 'clock') wire(x, 180, x, 260, lit.has(id) && lit.has('bus') ? 'lit' : '');
      if (HAS_PINS.has(id)) wire(x, 320, x, 380, lit.has(id) && lit.has('pins') ? 'lit' : '');
      if (HAS_IRQ.has(id)) wire(x + 22, 260, x + 22, 222, 'irq' + (lit.has(id) && lit.has('intc') ? ' lit' : ''));
    });
    wire(20 + 81 + 58, 222, 20 + 7 * 81 + 58, 222, 'irq');
    wire(20 + 81 + 58, 222, 20 + 81 + 58, 260, 'irq' + (lit.has('intc') ? ' lit' : ''));
    wire(60, 90, 60, 236, 'irq' + (lit.has('intc') && lit.has('cpu') ? ' lit' : ''));
    wire(60, 236, 20 + 81 + 20, 236, 'irq' + (lit.has('intc') && lit.has('cpu') ? ' lit' : ''));
    wire(20 + 81 + 20, 236, 20 + 81 + 20, 260, 'irq' + (lit.has('intc') && lit.has('cpu') ? ' lit' : ''));
    svg.append(s('text', { x: 300, y: 216, 'font-size': 11, class: 'mcu-block-diagram-lbl' }, 'interrupt request lines (dashed)'));
    wire(678, 55, 740, 55, lit.has('debug') ? 'lit' : '');
    svg.append(s('text', { x: 742, y: 44, 'font-size': 11, 'text-anchor': 'end', class: 'mcu-block-diagram-lbl' }, 'debug pins'));

    for (const [id, x, w] of TOP) block(id, x, 20, w, 70, id === 'cpu' ? (p.cores.length > 1 && pid !== 'mspm0l2228' ? 'CPU cores' : 'CPU core') : null);
    block('bus', 20, 150, 720, 30, 'System bus — address · data · control');
    BOT.forEach((id, i) => block(id, 20 + i * 81, 260, 73, 60));
    block('pins', 20 + 3 * 81, 380, 5 * 81 - 8, 34, 'External pins');
    root.append(h('div', { class: 'mcu-block-diagram-scroll' }, svg));

    // trace controls
    const tsel = h('div', { class: 'row' }, h('span', { class: 'w-mono' }, 'Trace an operation:'),
      Object.entries(TRACES).map(([id, t]) => h('button', { type: 'button', class: 'btn small' + (trace === id ? '' : ' ghost'), 'aria-pressed': String(trace === id),
        onclick: () => { trace = trace === id ? null : id; ti = 0; draw(); } }, t.title)));
    root.append(tsel);
    if (trace) {
      const t = TRACES[trace];
      root.append(h('div', { class: 'mcu-block-diagram-trace', 'aria-live': 'polite' },
        h('div', { class: 'w-mono' }, `${t.title} — step ${ti + 1} of ${t.steps.length}`),
        h('p', {}, t.steps[ti].text),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn small ghost', disabled: ti === 0, onclick: () => { ti--; draw(); } }, 'Back'),
          h('button', { type: 'button', class: 'btn small', disabled: ti === t.steps.length - 1, onclick: () => { ti++; if (ti === t.steps.length - 1) ctx?.complete?.(); draw(); root.querySelector('.mcu-block-diagram-trace .btn:not(.ghost)')?.focus(); } }, 'Next step'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: () => { trace = null; draw(); } }, 'End trace'))));
    }

    // detail panel
    const b = BLOCKS[sel];
    const fact = blockFact(sel);
    const dl = h('dl', { class: 'w-kv mcu-block-diagram-kv' });
    const row = (k, v) => dl.append(h('dt', {}, k), h('dd', {}, v));
    row('What it does', b.what);
    if (sel === 'bus') row('On ' + p.short, 'Every block below is reached through the bus by address. Select a block to see its address range.');
    else if (fact === null) row('On ' + p.short, 'This layout has no such block.');
    else {
      row('On ' + p.short, show(fact));
      if (fact.v == null || 'reach' in fact) row('How the CPU reaches it', fact.v == null || fact.reach == null ? 'Base address ' + UNVERIFIED + ' (or the device header file).' : 'Memory-mapped at ' + fact.reach);
      if (fact.src) row('Source', h('a', { href: fact.src, target: '_blank', rel: 'noopener' }, p.illustrative ? 'Arm CMSIS (architecture; values illustrative)' : fact.src.replace('https://github.com/', '')));
    }
    root.append(h('div', { class: 'mcu-block-diagram-detail', 'aria-live': 'polite' }, h('h4', {}, b.label === 'Int. ctrl' ? 'Interrupt controller' : b.label), dl));
    root.append(h('p', { class: 'w-note' }, 'Model: a functional block diagram. Real chips have several buses with bridges between them, DMA paths that bypass the CPU, and a clock tree to every block; none of that is drawn. Trace steps describe the general mechanism, not one vendor\'s register names.'));
  }
  draw();
}
