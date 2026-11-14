// ESP32 projects 6-10: SPI, UART link, Wi-Fi, FreeRTOS, and a learner-specified device.
// Firmware targets ESP-IDF v6.1 and is status `reviewed`: it was written against the ESP-IDF
// documentation and was not compiled or run on a board. The pure-C helpers (shift-register model,
// frame codec, network helpers, moving average, application logic) are `host-tested`: each was
// compiled with gcc -Wall -Wextra -std=c11 and run with the test main shown beside it.

// ---- small SVG helpers so every diagram uses the same strokes and theme colours ----
const FONT = 'font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"';
const svg = (w, h, body) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img" ${FONT} font-size="11" fill="currentColor">${body}</svg>`;
const col = (n) => (n ? `var(--sig${n})` : 'currentColor');
const T = (x, y, str, anchor = 'start', extra = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}" ${extra}>${str}</text>`;
const box = (x, y, w, h, title, sub = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="var(--surface)" stroke="currentColor" stroke-width="1.5"/>` +
  T(x + w / 2, y + 17, title, 'middle', 'font-weight="700"') + (sub ? T(x + w / 2, y + 31, sub, 'middle', 'opacity=".7" font-size="10"') : '');
const wire = (pts, n = 0, dash = false) => `<polyline points="${pts}" fill="none" stroke="${col(n)}" stroke-width="1.6" stroke-linejoin="round"${dash ? ' stroke-dasharray="4 3"' : ''}/>`;
const dot = (x, y, n = 0) => `<circle cx="${x}" cy="${y}" r="2.6" fill="${col(n)}"/>`;
// arrow from (x1,y1) to (x2,y2) with a filled head
const arr = (x1, y1, x2, y2, n = 0, dash = false) => {
  const a = Math.atan2(y2 - y1, x2 - x1), L = 7, W = 3.2;
  const bx = x2 - L * Math.cos(a), by = y2 - L * Math.sin(a);
  const p = (dx, dy) => `${(bx + dx).toFixed(1)},${(by + dy).toFixed(1)}`;
  return `<line x1="${x1}" y1="${y1}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col(n)}" stroke-width="1.6"${dash ? ' stroke-dasharray="4 3"' : ''}/>` +
    `<polygon points="${x2},${y2} ${p(-W * Math.sin(a), W * Math.cos(a))} ${p(W * Math.sin(a), -W * Math.cos(a))}" fill="${col(n)}"/>`;
};
// horizontal resistor, 30 wide, starting at (x,y)
const res = (x, y) => `<polyline points="${x},${y} ${x + 4},${y} ${x + 7},${y - 5} ${x + 12},${y + 5} ${x + 17},${y - 5} ${x + 22},${y + 5} ${x + 25},${y} ${x + 30},${y}" fill="none" stroke="currentColor" stroke-width="1.4"/>`;
// horizontal LED pointing right (anode at x), 16 wide
const led = (x, y) => `<polygon points="${x},${y - 6} ${x},${y + 6} ${x + 11},${y}" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="${x + 11}" y1="${y - 6}" x2="${x + 11}" y2="${y + 6}" stroke="currentColor" stroke-width="1.6"/><line x1="${x + 11}" y1="${y}" x2="${x + 16}" y2="${y}" stroke="currentColor" stroke-width="1.4"/><path d="M${x + 5},${y - 9} l4,-5 M${x + 10},${y - 9} l4,-5" stroke="currentColor" stroke-width="1" fill="none"/>`;
const gnd = (x, y) => `<path d="M${x},${y} v6 M${x - 7},${y + 6} h14 M${x - 4},${y + 9} h8 M${x - 1.5},${y + 12} h3" stroke="currentColor" stroke-width="1.4" fill="none"/>`;
// state bubble
const state = (x, y, w, h, name, sub = '', n = 0) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="var(--surface)" stroke="${col(n)}" stroke-width="1.8"/>` +
  T(x + w / 2, y + (sub ? h / 2 - 1 : h / 2 + 4), name, 'middle', 'font-weight="700"') + (sub ? T(x + w / 2, y + h / 2 + 12, sub, 'middle', 'opacity=".7" font-size="10"') : '');

const IDF = 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/';

const skills = [
  { id: 'esp-pb-spi-txn', name: 'Configure an SPI master transaction (mode, bit order, chip select) and verify it on a capture', track: 'programming' },
  { id: 'esp-pb-shiftreg', name: 'Expand outputs with a shift register and predict where each bit lands', track: 'hardware' },
  { id: 'esp-pb-uart-link', name: 'Wire and bring up a UART link between two boards, including logic-level compatibility', track: 'hardware' },
  { id: 'esp-pb-framing', name: 'Design a framed serial protocol with length and CRC and write a receiver that resynchronises', track: 'programming' },
  { id: 'esp-pb-wifi-sta', name: 'Bring up Wi-Fi station mode with event-driven reconnect and serve or publish data over HTTP', track: 'programming' },
  { id: 'esp-pb-net-sec', name: 'Keep credentials out of source and verify the TLS peer on a connected device', track: 'security' },
  { id: 'esp-pb-rtos-pipeline', name: 'Structure firmware as tasks joined by queues, semaphores and mutexes', track: 'programming' },
  { id: 'esp-pb-rtos-health', name: 'Measure stack headroom and supervise tasks with a watchdog', track: 'programming' },
  { id: 'esp-pb-debug-link', name: 'Diagnose a broken bus, link or task interaction from symptoms and a capture', track: 'hardware' },
  { id: 'esp-pb-system-design', name: 'Turn requirements into a pin budget, task diagram, state machine, power budget and test plan', track: 'programming' },
];

const CMAKE_NOTE = (reqs) => `Create a project from the ESP-IDF \`hello_world\` example or with \`idf.py create-project\`. In \`main/CMakeLists.txt\` list the source files and the components whose headers you include:

\`\`\`
idf_component_register(SRCS ${reqs.srcs}
                       INCLUDE_DIRS "."
                       PRIV_REQUIRES ${reqs.req})
\`\`\`

If the build stops with a header not found, the component that owns that header is missing from \`PRIV_REQUIRES\`; the ESP-IDF API reference page for the header names its component. Then \`idf.py set-target esp32\`, \`idf.py build\`, \`idf.py -p PORT flash monitor\` (leave the monitor with Ctrl+]).`;


// ───────────────────────────── Project 6: SPI ─────────────────────────────
const p6Figure = (() => {
  const outs = ['QA 15', 'QB  1', 'QC  2', 'QD  3', 'QE  4', 'QF  5', 'QG  6', 'QH  7'];
  let b = box(10, 30, 120, 220, 'ESP32 DevKit') + box(270, 30, 130, 262, '74HC595');
  // ESP32 pins
  [['3V3', 62], ['GPIO23 MOSI', 100], ['GPIO18 SCLK', 130], ['GPIO4 CS', 160], ['GND', 220]].forEach(([n, y]) => { b += T(124, y + 4, n, 'end'); });
  // 595 left pins
  [['16 VCC', 62], ['10 SRCLR', 80], ['14 SER', 100], ['11 SRCLK', 130], ['12 RCLK', 160], ['13 OE', 190], [' 8 GND', 220]].forEach(([n, y]) => { b += T(276, y + 4, n); });
  b += wire('130,62 270,62') + dot(232, 62) + wire('232,62 232,80 270,80');
  b += wire('130,100 270,100', 1) + T(200, 95, 'data', 'middle', `fill="${col(1)}" font-size="10"`);
  b += wire('130,130 270,130', 2) + T(200, 125, 'clock', 'middle', `fill="${col(2)}" font-size="10"`);
  b += wire('130,160 270,160', 3) + T(200, 155, 'latch', 'middle', `fill="${col(3)}" font-size="10"`);
  b += wire('130,220 270,220') + dot(246, 220) + wire('246,220 246,190 270,190');
  b += T(200, 240, '100 nF across', 'middle', 'font-size="10" opacity=".7"') + T(200, 252, 'pins 16 and 8', 'middle', 'font-size="10" opacity=".7"');
  outs.forEach((n, i) => {
    const y = 50 + i * 26;
    b += T(394, y + 4, n, 'end') + wire(`400,${y} 440,${y}`, 4) + res(440, y) + wire(`470,${y} 492,${y}`) + led(492, y) + wire(`508,${y} 545,${y}`) + dot(545, y) + T(553, y + 4, 'D' + i);
  });
  b += T(394, 276, "QH' 9", 'end') + T(408, 276, 'not connected (cascade output)', 'start', 'font-size="10" opacity=".7"');
  b += wire('545,50 545,296') + gnd(545, 296);
  b += T(455, 36, '1 kΩ each', 'middle', 'font-size="10" opacity=".7"');
  return svg(600, 320, b);
})();

const p6Timing = `
          one transaction = one byte (0x81 shown), SPI mode 0, MSB first

CS/RCLK ‾‾‾\\_________________________________________________/‾‾‾‾   rising edge copies the
                                                                   shift register to QA..QH
SCLK    _______/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\________    idle LOW (CPOL = 0)
               ^    ^    ^    ^    ^    ^    ^    ^                595 samples SER on each rising edge
MOSI    ____/‾‾‾‾‾\\___________________________________/‾‾‾‾‾\\___    master changes MOSI on falling edges
            b7=1   b6=0 b5=0 b4=0 b3=0 b2=0 b1=0     b0=1

After 8 clocks:  b7 is in QH, b0 is in QA.  0x81 lights D7 and D0.
`;

const p6 = {
  id: 'esp-p6', title: 'Project 6: SPI peripheral communication', kind: 'Project', minutes: 150,
  summary: 'Drive eight LEDs through a 74HC595 shift register with the ESP-IDF SPI master driver, prove the clock mode and bit order on a logic analyser, then read the JEDEC ID of an SPI flash chip on the same bus.',
  skills: ['esp-pb-spi-txn', 'esp-pb-shiftreg', 'esp-pb-debug-link'],
  objectives: [
    'Explain what SCLK, MOSI, MISO and CS each do, and why SPI needs no addresses or acknowledgements.',
    'Choose the SPI mode (CPOL, CPHA) and bit order for a part from its datasheet timing diagram.',
    'Build a transaction with `spi_transaction_t` and say what the hardware does for each field.',
    'Predict which output of a shift register a given bit of a byte reaches, for one chip and for a chain.',
    'Capture a transaction with a logic analyser and decide from the capture whether a fault is in wiring, mode, bit order or length.',
    'Read a device identifier over full-duplex SPI and account for the byte received while the command is sent.',
  ],
  hardware: [
    'ESP32 DevKit (original ESP32, for example a board with an ESP32-WROOM-32 module) and a USB cable',
    '74HC595 shift register in a DIP-16 package (74HC, not 74HCT is fine at 3.3 V; both work here)',
    '8 LEDs and 8 resistors of 1 kΩ',
    '100 nF ceramic capacitor for decoupling',
    'Breadboard and jumper wires',
    'Logic analyser with at least 3 channels (an 8-channel 24 MS/s USB analyser is enough)',
    'For the extension: an SPI NOR flash breakout that runs at 3.3 V (for example a W25Q-series module)',
  ],
  software: [
    'ESP-IDF v6.1 (current stable when this was written) with the `idf.py` command working',
    'PulseView (sigrok) or the software that came with your logic analyser, with an SPI decoder',
    'gcc on your PC, to run the shift-register model',
  ],
  background: [
    `### The problem

You want eight indicator LEDs but you have three GPIOs to spare. A shift register turns three pins into eight outputs, and with a second chip into sixteen. The bus that drives it, SPI, is the same one used by flash memory, displays, ADCs and SD cards, so the habits you form here carry over.

### What SPI is, electrically

SPI is two shift registers connected in a ring, one in the controller and one in the peripheral, plus a clock that only the controller drives.

| Signal | Driven by | Job |
|---|---|---|
| SCLK | controller | every bit moves on a clock edge; no clock, no data |
| MOSI | controller | controller-out, peripheral-in data |
| MISO | peripheral | peripheral-out, controller-in data |
| CS (active low) | controller | selects one peripheral and marks where a transaction starts and ends |

All lines are push-pull, so there are no pull-ups and the bus can run at megahertz rates. The price is that there is no acknowledgement. If the peripheral is missing, unpowered or wired wrong, the controller cannot tell: a write "succeeds" and a read returns whatever level MISO floats to, usually \`0xFF\` or \`0x00\`. That is why you verify SPI with a capture or with a read of a known value.

### Mode: which edge samples

Two settings describe the clock. **CPOL** is the level SCLK rests at. **CPHA** says whether data is sampled on the first or the second edge after CS falls.

| Mode | CPOL | CPHA | SCLK idles | Data sampled on | Data changes on |
|---|---|---|---|---|---|
| 0 | 0 | 0 | low | rising edge | falling edge |
| 1 | 0 | 1 | low | falling edge | rising edge |
| 2 | 1 | 0 | high | falling edge | rising edge |
| 3 | 1 | 1 | high | rising edge | falling edge |

The rule for getting it right: find the timing diagram in the peripheral's datasheet, see which edge it samples on, and choose a mode in which the controller changes MOSI on the *opposite* edge. That gives the data half a clock period to settle before it is sampled.`,
    { t: 'callout', kind: 'hw', title: 'The 74HC595 in one paragraph', md: `The 74HC595 contains an 8-stage **shift register** and an 8-bit **storage register**. On each rising edge of SRCLK (pin 11) the level on SER (pin 14) enters stage A and every stage passes its bit to the next; stage H also appears on QH' (pin 9) for cascading. Nothing reaches the output pins until a rising edge on RCLK (pin 12) copies all eight stages into the storage register, which drives QA to QH. OE (pin 13, active low) enables the outputs; SRCLR (pin 10, active low) clears the shift register. Supply range, output current per pin and the total current limit for the package are in the datasheet's recommended operating conditions; with 1 kΩ resistors at 3.3 V each LED draws roughly (3.3 V − 2 V) / 1 kΩ ≈ 1.3 mA, far inside any 74HC595's limits.` },
    `### Why the chip-select line can be the latch

The 74HC595 has no chip select. But look at what CS does in a transaction: it falls before the first clock and **rises** after the last one. A rising edge after the last bit is exactly what RCLK needs. So you connect the driver's CS output to RCLK and the latch happens for free at the end of every transaction, with all eight outputs changing at the same instant.`,
    { t: 'callout', kind: 'decision', title: 'Why the SPI peripheral instead of toggling GPIOs', md: `You could bit-bang this with three \`gpio_set_level\` calls per bit. It works for a shift register and is a good way to understand it. The hardware SPI peripheral is the better default because the timing is produced by a clock divider, not by how long your code takes; it is unaffected by interrupts; it reaches megahertz speeds; and the same driver later talks to flash, displays and sensors with DMA. Bit-banging is the fallback when you have run out of SPI hosts or need an odd bit count the peripheral cannot make.` },
    { t: 'widget', name: 'spi-analyzer', props: { mode: 0 }, caption: 'Change the mode and the bit order and watch which edge the data is sampled on. Find the mode where the controller changes MOSI on the same edge the peripheral samples.' },
  ],
  diagram: [
    { t: 'ascii', caption: 'Pin-by-pin wiring. Pin numbers are for the DIP-16 package; pin 1 is left of the notch with the notch facing up.', text: `
ESP32 DevKit        74HC595 pin         Notes
------------        ----------------    ------------------------------------------
3V3                 16  VCC             100 nF from pin 16 to pin 8, close to the chip
3V3                 10  SRCLR (/MR)     held high = never clear the shift register
GND                  8  GND
GND                 13  OE              held low  = outputs always enabled
GPIO23 (MOSI)       14  SER             serial data in
GPIO18 (SCLK)       11  SRCLK           shift clock, rising edge
GPIO4  (CS)         12  RCLK            latch clock, rising edge
(nothing)            9  QH'             cascade output, leave open for now

74HC595 output      Load
--------------      -----------------------------------------------
15  QA              1 kΩ -> LED D0 anode, cathode -> GND
 1  QB              1 kΩ -> LED D1 -> GND
 2  QC              1 kΩ -> LED D2 -> GND
 3  QD              1 kΩ -> LED D3 -> GND
 4  QE              1 kΩ -> LED D4 -> GND
 5  QF              1 kΩ -> LED D5 -> GND
 6  QG              1 kΩ -> LED D6 -> GND
 7  QH              1 kΩ -> LED D7 -> GND

Logic analyser      Probe
--------------      -----------------------------------------------
CH0                 GPIO4  (CS / RCLK)
CH1                 GPIO18 (SCLK)
CH2                 GPIO23 (MOSI)
GND                 breadboard ground rail (always connect this first)
` },
    { t: 'figure', svg: p6Figure, caption: 'ESP32 to 74HC595 to eight LEDs. Three signal wires carry data, clock and latch; OE and SRCLR are tied off so the chip is always enabled and never cleared.' },
    { t: 'ascii', text: p6Timing, caption: 'What one transaction should look like. Timing is not to scale.' },
    { t: 'callout', kind: 'note', title: 'Why these pins, and adapting to other chips', md: `GPIO18, GPIO23 and GPIO4 are ordinary outputs on the original ESP32: none is a strapping pin (GPIO0, 2, 5, 12, 15), none belongs to the module's flash (GPIO6–11) and none is input-only (GPIO34–39). The driver routes \`SPI2_HOST\` to any pins through the GPIO matrix; the maximum clock is lower through the matrix than on the host's dedicated pins (the limit is in the SPI master documentation), which does not matter at 100 kHz.

On an **ESP32-S3** or **ESP32-C3** keep \`SPI2_HOST\` (the C3 has only that one general-purpose host) and change the three pin numbers. Avoid that chip's strapping pins and its USB pins: GPIO19/20 on the S3 and GPIO18/19 on the C3 carry the USB Serial/JTAG signals. Check the chip's GPIO page before choosing.` },
  ],
  steps: [
    { title: 'Wire the shift register with the ESP32 unplugged', blocks: [
      `Place the 74HC595 across the breadboard's centre gap. Wire power first: pin 16 to 3V3, pin 8 to GND, the 100 nF capacitor directly between them. Tie pin 10 (SRCLR) to 3V3 and pin 13 (OE) to GND. Add the eight resistor and LED pairs from QA…QH to ground, cathode (short leg, flat side) to ground. Leave the three signal wires off for now.

Plug in USB so the board supplies 3.3 V.`,
      { t: 'predict', q: 'No data has been sent. What will the LEDs show at power-up?', choices: [
        { t: 'All off, because the chip resets itself', why: 'The 74HC595 has no power-on reset. SRCLR clears only the shift register, and only while it is held low.' },
        { t: 'An arbitrary pattern that can differ from one power-up to the next', ok: true, why: 'The storage-register flip-flops power up in whatever state they settle into. Nothing defines it until the first latch. This is why the firmware writes 0x00 before anything else, and why a real product would hold OE high (outputs off) until that first write.' },
        { t: 'All on, because the inputs float high', why: 'Floating inputs do not load the storage register; only a rising edge on RCLK does. A floating RCLK might produce such an edge from noise, but then the pattern is still undefined.' },
      ], reveal: 'Whatever you see, write it down, then power-cycle twice and compare. Undefined power-up state is a design problem you solve in hardware (a pull-up on OE that the firmware later overrides) when the outputs drive something that matters.' },
    ] },
    { title: 'Run the shift-register model on your PC', blocks: [
      `Before touching firmware, settle the question that causes most confusion: for a byte sent most-significant-bit first, which output does bit 0 reach? The model below is the chip reduced to two bytes of state and two functions, one per clock pin.`,
      { t: 'predict', q: 'You send the byte `0x01` MSB first to one 74HC595, then pulse RCLK. Which LED lights?', choices: [
        { t: 'D0 on QA', ok: true, why: 'The first bit sent (bit 7) is pushed furthest along and ends in QH. The last bit sent (bit 0) has only just entered and sits in QA. So with MSB first, bit n of the byte drives output number n.' },
        { t: 'D7 on QH', why: 'That would be true if bit 0 were sent first: it would then be pushed along by the seven bits that follow. Work out which bit enters last.' },
        { t: 'None until a second byte is sent', why: 'Eight clocks move eight bits fully into the eight stages. The latch edge after them makes the result visible; no second byte is needed.' },
      ], reveal: 'Compile and run the model to check your answer, then read its `main`: it also shows what LSB-first does and where bytes land in a two-chip chain.' },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'sr595_model.c — gcc -Wall -Wextra -std=c11 sr595_model.c -o sr595 && ./sr595', code: String.raw`/* Software model of one or more cascaded 74HC595 shift registers.
 * Bit 0 of .shift is stage QA (nearest SER), bit 7 is QH (feeds QH'). */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t shift;   /* the 8 shift-register flip-flops */
    uint8_t latch;   /* the 8 storage-register flip-flops that drive QA..QH */
} sr595_t;

/* Rising edge on SRCLK: every stage takes its neighbour's value and SER
 * enters QA. Returns the bit that was on QH' before the edge, which is
 * what a second chip wired to QH' would sample on that same edge. */
static int sr595_srclk_rise(sr595_t *s, int ser)
{
    int qh_out = (s->shift >> 7) & 1;
    s->shift = (uint8_t)((s->shift << 1) | (ser & 1));
    return qh_out;
}

/* Rising edge on RCLK: copy the shift register to the output pins. */
static void sr595_rclk_rise(sr595_t *s) { s->latch = s->shift; }

/* What an SPI master does for one byte, to a chain of n chips. */
static void spi_send_byte(sr595_t *chain, int n, uint8_t value, int msb_first)
{
    for (int i = 0; i < 8; i++) {
        int bit = msb_first ? (value >> (7 - i)) & 1 : (value >> i) & 1;
        for (int c = 0; c < n; c++)      /* bit ripples down the chain */
            bit = sr595_srclk_rise(&chain[c], bit);
    }
}

/* Bar-graph pattern: level 0..8 -> that many low-order outputs on. */
static uint8_t bar_pattern(unsigned level)
{
    if (level >= 8) return 0xFF;
    return (uint8_t)((1u << level) - 1u);
}

int main(void)
{
    sr595_t one = {0, 0};

    /* MSB first: bit n of the byte lands on output Q(A+n). */
    spi_send_byte(&one, 1, 0x01, 1);
    assert(one.latch == 0x00);           /* nothing visible until RCLK rises */
    sr595_rclk_rise(&one);
    assert(one.latch == 0x01);           /* only QA is high */

    /* LSB first: the byte comes out mirrored, 0x01 lights QH instead. */
    spi_send_byte(&one, 1, 0x01, 0);
    sr595_rclk_rise(&one);
    assert(one.latch == 0x80);

    /* Two chips: the FIRST byte sent ends up in the FAR chip. */
    sr595_t two[2] = {{0, 0}, {0, 0}};
    spi_send_byte(two, 2, 0xAA, 1);
    spi_send_byte(two, 2, 0x0F, 1);
    sr595_rclk_rise(&two[0]);
    sr595_rclk_rise(&two[1]);
    assert(two[0].latch == 0x0F && two[1].latch == 0xAA);

    assert(bar_pattern(0) == 0x00 && bar_pattern(3) == 0x07);
    assert(bar_pattern(8) == 0xFF && bar_pattern(200) == 0xFF);

    printf("sr595 model: all checks passed\n");
    return 0;
}`, explain: [
        { lines: '8-11', md: 'The whole chip is 16 flip-flops. Keeping the shift and storage registers separate in the model is what lets you see why outputs do not flicker while bits move.' },
        { lines: '16-21', md: 'One rising edge on SRCLK. The value returned is what QH\' presented *before* the edge, because a second chip clocked by the same edge samples the old value.' },
        { lines: '27-35', md: 'An SPI master sending one byte is eight of those edges with a chosen bit order.' },
        { lines: '58-64', md: 'In a chain, the first byte you send is pushed through into the far chip. Send the far chip\'s data first.' },
      ] },
    ] },
    { title: 'Send bytes from the ESP32', blocks: [
      CMAKE_NOTE({ srcs: '"main.c"', req: 'esp_driver_spi' }),
      `Connect the three signal wires (GPIO23 → pin 14, GPIO18 → pin 11, GPIO4 → pin 12), then flash this program.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'main/main.c', code: String.raw`/* Project 6: 74HC595 on SPI. ESP-IDF, original ESP32 DevKit. */
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "esp_err.h"
#include "esp_log.h"

#define SR_HOST    SPI2_HOST
#define PIN_SCLK   18      /* -> 74HC595 pin 11 SRCLK */
#define PIN_MOSI   23      /* -> 74HC595 pin 14 SER   */
#define PIN_MISO   19      /* not used by the 595; used by the flash extension */
#define PIN_LATCH  4       /* -> 74HC595 pin 12 RCLK, driven as chip select */

static const char *TAG = "p6";
static spi_device_handle_t s_sr;

static void sr_write(uint8_t value)
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA,   /* data lives inside the struct */
        .length  = 8,                      /* in BITS, not bytes */
        .tx_data = { value },
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_sr, &t));
}

void app_main(void)
{
    spi_bus_config_t bus = {
        .sclk_io_num   = PIN_SCLK,
        .mosi_io_num   = PIN_MOSI,
        .miso_io_num   = PIN_MISO,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SR_HOST, &bus, SPI_DMA_CH_AUTO));

    spi_device_interface_config_t dev = {
        .mode           = 0,               /* CPOL=0, CPHA=0 */
        .clock_speed_hz = 100 * 1000,      /* slow enough to see on a cheap analyser */
        .spics_io_num   = PIN_LATCH,       /* low during the byte, rises after it */
        .queue_size     = 1,
        /* .flags = SPI_DEVICE_BIT_LSBFIRST,   <- try this in step 5 */
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SR_HOST, &dev, &s_sr));

    sr_write(0x00);                        /* known state: shift register powers up random */
    ESP_LOGI(TAG, "walking one bit across QA..QH");

    uint8_t pattern = 0x01;
    while (1) {
        sr_write(pattern);
        ESP_LOGI(TAG, "wrote 0x%02X", pattern);
        pattern = (uint8_t)(pattern << 1);
        if (pattern == 0) pattern = 0x01;
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}` },
      `You should see one LED lit, moving from D0 to D7 four times a second, and the monitor printing \`wrote 0x01\`, \`0x02\`, \`0x04\` … in step with it. If the light moves from D7 to D0, or several LEDs are lit, do not fix it yet: note the symptom and go to the next step, where the capture tells you which of the possible causes it is.`,
    ] },
    { title: 'Capture one transaction and decode it', blocks: [
      `Clip analyser ground to the breadboard ground rail, then CH0 to CS, CH1 to SCLK, CH2 to MOSI. Set the sample rate to at least 1 MS/s: the clock is 100 kHz, so that is 10 samples per clock period, enough to see edges in the right order. Trigger on a falling edge of CH0. Add the SPI decoder with CPOL 0, CPHA 0, MSB first, CS active low.

Measure these with the cursors and write them down:

- SCLK period. You should see 10 µs (100 kHz).
- The number of clock pulses between CS falling and CS rising. You should see exactly 8.
- The level of SCLK while CS is high. You should see low.
- Whether MOSI changes on falling or rising edges of SCLK. You should see falling.
- The decoded bytes of consecutive transactions. You should see \`01 02 04 08 10 20 40 80\`.`,
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'spi-mode0' }, caption: 'Practise on a simulated capture first: place cursors, count clocks, read the byte by hand before turning the decoder on.' },
      { t: 'callout', kind: 'mistake', title: 'Analyser ground left off', md: `Without the ground clip the analyser has no reference and every channel shows noise or a copy of mains hum. It is the first thing to check when a capture looks like nonsense. Connect ground before the signal probes, every time.` },
    ] },
    { title: 'Break it on purpose: bit order and mode', blocks: [
      `Change one thing at a time and predict before you flash.

**Bit order.** Uncomment \`.flags = SPI_DEVICE_BIT_LSBFIRST\` in the device configuration.`,
      { t: 'predict', q: 'With LSB-first enabled and the firmware still writing 0x01, 0x02, 0x04 …, what will the LEDs do?', reveal: 'The light walks the other way, D7 to D0. The byte values in the log are unchanged; only the order the bits leave the pin changed, so bit 0 is now sent first and pushed all the way to QH. On the capture, the decoder set to MSB-first now shows `80 40 20 …`. Remove the flag again.' },
      `**Mode.** Set \`.mode = 1\`. The controller now changes MOSI on the rising edge, the same edge the 74HC595 samples on.`,
      { t: 'predict', q: 'What do you expect with mode 1, and how confident can you be?', reveal: 'The honest answer is "it depends on nanoseconds". The chip needs the data to be stable for a set-up time before the rising edge and a hold time after it. In mode 1 the data changes just after that edge, so the chip most likely captures the *previous* bit: the pattern appears shifted by one position, with the extra bit coming from wherever MOSI rested. On some boards it may look correct, or fail only when warm. A design that works by luck on timing is a fault that has not happened yet. Look at the capture: MOSI transitions now line up with rising clock edges. Set the mode back to 0.' },
      `Finally try \`.mode = 3\`. You should see the LEDs behave correctly, because mode 3 also samples on the rising edge; on the capture the only difference is that SCLK rests high. Many parts accept both mode 0 and mode 3 for this reason. Return to mode 0.`,
    ] },
    { title: 'Extension: read a flash chip\'s JEDEC ID on the same bus', blocks: [
      `A write-only device cannot prove MISO works. An SPI NOR flash chip can: command \`0x9F\` makes it return three identification bytes (manufacturer, memory type, capacity) defined by its datasheet.

Wire the flash breakout: VCC to 3V3, GND to GND, CLK to GPIO18, DI (MOSI) to GPIO23, DO (MISO) to GPIO19, CS to GPIO27. If the breakout exposes WP and HOLD pins, tie both to 3V3 so they are inactive. Confirm on the breakout's documentation that it is a 3.3 V part before connecting it.

Add the code below, call \`flash_attach()\` after the shift register is added, then read and log the ID once.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'Additions to main.c', code: String.raw`/* Extension: read the JEDEC ID of an external SPI NOR flash chip that
 * shares SCLK/MOSI/MISO with the shift register and has its own CS. */
#define PIN_FLASH_CS  27

static spi_device_handle_t s_flash;

static void flash_attach(void)
{
    spi_device_interface_config_t dev = {
        .mode           = 0,
        .clock_speed_hz = 1 * 1000 * 1000,
        .spics_io_num   = PIN_FLASH_CS,
        .queue_size     = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SR_HOST, &dev, &s_flash));
}

static void flash_read_jedec_id(uint8_t id[3])
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA | SPI_TRANS_USE_RXDATA,
        .length  = 32,                          /* 1 command byte + 3 reply bytes */
        .tx_data = { 0x9F, 0x00, 0x00, 0x00 },  /* 0x9F = Read JEDEC ID */
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_flash, &t));
    id[0] = t.rx_data[1];   /* manufacturer */
    id[1] = t.rx_data[2];   /* memory type  */
    id[2] = t.rx_data[3];   /* capacity     */
    /* rx_data[0] was clocked in while the command went out: ignore it. */
}`, explain: [
        { lines: '10-16', md: 'A second device on the same host: same three bus wires, its own CS pin, its own clock speed. The driver reprograms the clock divider and asserts the right CS for each transaction.' },
        { lines: '21-25', md: 'SPI is always full duplex: 32 clocks send four bytes and receive four bytes. The three zero bytes are only there to generate clocks for the reply.' },
        { lines: '27-30', md: 'While the command byte was going out, the flash was not yet driving a reply. The byte received in that slot is meaningless and must be skipped.' },
      ] },
      { t: 'predict', q: 'While the ESP32 talks to the flash chip, SCLK and MOSI are also connected to the 74HC595. Do the LEDs change?', choices: [
        { t: 'No. The shift register fills with flash traffic, but the outputs keep their old values', ok: true, why: 'SRCLK toggles, so the 595\'s shift register does take in those bits. But RCLK is the 595\'s own CS line, which stays high during a flash transaction, so there is no rising edge and the storage register keeps driving the LEDs with the last latched byte. The next sr_write() shifts in a full new byte before latching, so the garbage never becomes visible.' },
        { t: 'Yes, they show the flash command bytes', why: 'They would only if RCLK saw a rising edge during or after the flash transaction. Check which signal drives RCLK and what it does while a different device is selected.' },
        { t: 'No, because the 74HC595 ignores the clock while it is not selected', why: 'The 595 has no select input at all. Its shift register follows SRCLK whenever SRCLK moves. Something else is protecting the outputs.' },
      ], reveal: 'This only works because one transaction always shifts a whole byte before latching. If you ever latched without shifting eight fresh bits first, the flash traffic would appear on the LEDs.' },
      `You should see three bytes that match the ID table in your flash chip's datasheet. For Winbond parts the manufacturer byte is \`0xEF\`; look up the other two rather than trusting a web page. If you see \`FF FF FF\` or \`00 00 00\`, the flash is not driving MISO: add MISO to the analyser on CH3 and check wiring and CS.`,
    ] },
    { title: 'Debugging exercises', blocks: [
      `Each of these is a fault somebody really makes. Decide what is wrong from the symptom and the code before opening the solution.`,
      { t: 'exercise', prompt: `**Exercise A.** A colleague's function writes the shift register. The capture shows CS going low, a single clock pulse, and CS going high. On the board, each call makes the whole LED pattern move one place along instead of showing the new value. What is the bug?`, code: String.raw`static void sr_write(uint8_t value)
{
    spi_transaction_t t = {
        .flags   = SPI_TRANS_USE_TXDATA,
        .length  = 1,
        .tx_data = { value },
    };
    ESP_ERROR_CHECK(spi_device_polling_transmit(s_sr, &t));
}`, hints: ['Count the clock pulses in the capture and compare with what one byte needs.', 'Look up the unit of the `length` field in `spi_transaction_t`.'], answer: { type: 'text', accept: ['bit', 'length', '\\b8\\b'], nudge: 'Think about the unit of one of the fields.' }, solution: `\`length\` is in **bits**. With \`.length = 1\` the driver clocks out only the top bit of \`value\`, then CS rises and latches. Each call therefore shifts the existing contents by one stage and inserts one new bit, which looks like the pattern crawling along. Set \`.length = 8\`. The capture gave it away: one clock pulse per transaction.` },
      { t: 'exercise', prompt: `**Exercise B.** A board uses a display driver whose datasheet timing diagram shows data sampled on the **falling** edge of a clock that idles **high**. The firmware configures \`.mode = 0\`. Most commands work on the bench; in the field some units show corrupted characters when cold. Which mode should it be, and why did mode 0 appear to work?`, hints: ['Clock idles high: that fixes CPOL.', 'With CPOL = 1 the first edge after CS falls is a falling edge. Is the sampling edge the first or the second?', 'In the wrong mode, when does the controller change MOSI relative to the peripheral\'s sampling edge?'], answer: { type: 'text', accept: ['mode\\s*2', '\\b2\\b', 'cpol\\s*=?\\s*1.*cpha\\s*=?\\s*0'], nudge: 'Work out CPOL from the idle level, then CPHA from whether the sampling edge is the first or second edge.' }, solution: `Idle high means CPOL = 1. The first edge is then falling, and the part samples on it, so CPHA = 0: **mode 2**. In mode 0 the controller changes MOSI on falling edges, the very edge this peripheral samples on. Whether the old or the new bit is captured depends on propagation delays of a few nanoseconds, which shift with temperature, supply voltage and trace length. It "worked" on the bench by timing margin that was never guaranteed. Verify the fix on a capture: MOSI must change on rising edges and be stable across every falling edge.` },
      { t: 'exercise', prompt: `**Exercise C.** The JEDEC ID code below prints \`FF EF 40\` for a chip whose datasheet says the ID is \`EF 40 16\`. Wiring is correct. What is wrong?`, code: String.raw`ESP_ERROR_CHECK(spi_device_polling_transmit(s_flash, &t));
id[0] = t.rx_data[0];
id[1] = t.rx_data[1];
id[2] = t.rx_data[2];`, hints: ['How many bytes are received during a 32-bit full-duplex transaction?', 'What was the flash chip doing while the command byte was being clocked in?'], answer: { type: 'text', accept: ['first', 'rx_data\\[1\\]', 'offset', 'command', 'dummy', 'skip', 'full.?duplex'], nudge: 'Think about what is on MISO during the first eight clocks.' }, solution: `The reply starts **after** the command byte. During the first eight clocks the flash is still receiving \`0x9F\` and its output is high-impedance, so the controller reads \`0xFF\` into \`rx_data[0]\`. The ID is in \`rx_data[1]\` to \`rx_data[3]\`. The printed bytes are the right bytes one position late, which is the signature of forgetting that SPI receives a byte for every byte it sends.` },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'spi-mode' }, caption: 'A simulated broken SPI link to diagnose from its symptoms and capture.' },
    ] },
  ],
  walkthrough: [
    `### What the driver calls do to the hardware

**\`spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO)\`** claims one of the chip's SPI controllers and connects its internal signals to the three pads you named. On the ESP32 any peripheral signal can reach almost any pad through the GPIO matrix, a large multiplexer; the driver programs it and sets each pad's direction. \`quadwp_io_num\` and \`quadhd_io_num\` are the two extra data lines of quad SPI, unused here, so they are \`-1\`. The last argument lets the driver pick a DMA channel for long transfers; the 1-byte transfers in this project fit in the controller's own data buffer and do not use it.

**\`spi_bus_add_device(...)\`** does not touch the pins yet. It records the settings for one peripheral: the mode, the CS pad, and a clock divider computed from the peripheral clock so that SCLK is at or just below \`clock_speed_hz\`. Several devices with different settings can share one host; the driver reprograms the controller at the start of each transaction.

**\`spi_device_polling_transmit(s_sr, &t)\`** performs one transaction and returns when it is finished:

1. It takes the bus, loads this device's mode and divider into the controller's registers.
2. It copies \`tx_data\` into the controller's data buffer register and writes the bit count (\`length\`) to the length register.
3. It drives CS low and sets the controller's start bit. From here on hardware runs alone: a counter shifts one bit onto MOSI per SCLK period, most-significant bit first unless told otherwise.
4. It waits in a loop for the controller to clear the start bit (that is the "polling"), then raises CS.

The register names for steps 2 to 4 are in the SPI chapter of the ESP32 Technical Reference Manual; reading that chapter next to the capture is a good way to connect the two.

### Why \`tx_data\` and not a pointer

\`spi_transaction_t\` normally carries \`tx_buffer\`, a pointer to your data. For up to four bytes, \`SPI_TRANS_USE_TXDATA\` stores the bytes inside the structure itself. That avoids a pointer to a local variable outliving the function, and avoids DMA alignment rules for tiny transfers.

### Polling versus interrupt transactions

\`spi_device_transmit\` blocks the calling task and lets the SPI interrupt wake it when the transfer ends. \`spi_device_polling_transmit\` spins instead. For an 80 µs transfer, spinning costs less than two context switches. For a 4 kB display update the interrupt-driven call is the right one, because other tasks can run meanwhile.

### What happens at the pins of the 74HC595

For \`sr_write(0x81)\`: CS (RCLK) falls, which does nothing because the 595 only acts on a rising RCLK. MOSI is set to bit 7, a 1. SCLK rises: the 595's first flip-flop captures the 1. SCLK falls: the controller puts bit 6, a 0, on MOSI. This repeats eight times, each rising edge pushing earlier bits one stage along. After the eighth clock CS rises: all eight stages are copied to the storage register at once, and QA and QH go high together. The LEDs never show an intermediate pattern, which is the reason the chip has two registers.`,
  ],
  testing: [
    `Work through these in order. Each one names what you should see and how to measure it.

| Test | How | You should see |
|---|---|---|
| Walking light | Watch the LEDs | Exactly one LED lit, moving D0 → D7, a step every 250 ms |
| Log agrees with LEDs | Compare monitor output to the lit LED | \`0x01\` with D0, \`0x80\` with D7 |
| Clock frequency | Cursors across 8 SCLK periods, divide by 8 | 10 µs per period (100 kHz), within the analyser's resolution |
| Clock count | Count pulses between CS edges | 8, never 7 or 9 |
| Mode | Decoder set to mode 0 MSB-first | \`01 02 04 08 10 20 40 80\` repeating, no framing warnings |
| Idle levels | Look between transactions | CS high, SCLK low |
| Latch timing | Zoom on the end of a transaction | CS rises after the last falling SCLK edge, never before the eighth rising edge |
| All outputs | Temporarily make the loop write \`0xFF\` then \`0x00\` | All eight LEDs on, then all off: finds a dead LED or a missing resistor |
| JEDEC ID (extension) | Log the three bytes; add MISO on CH3 | The ID from the datasheet's table; decoder shows \`9F\` on MOSI followed by three bytes on MISO |`,
    { t: 'callout', kind: 'note', title: 'What a correct capture proves, and what it does not', md: `A clean capture at the ESP32 pins proves the firmware and the driver configuration. It does not prove the chip received it: a wire in the wrong breadboard row still gives a perfect capture. When the capture is right and the LEDs are wrong, move the probes to the 74HC595's own pins 14, 11 and 12 and capture again there.` },
  ],
  troubleshooting: [
    { symptom: 'No LED ever lights', cause: 'OE (pin 13) floating or tied high, LEDs reversed, or the chip has no power', fix: 'Measure pin 16 to pin 8: 3.3 V. Measure pin 13: 0 V. Check each LED\'s cathode goes to ground. Write `0xFF` to rule out a pattern problem.' },
    { symptom: 'LEDs show a random pattern that never changes', cause: 'RCLK never sees a rising edge: the CS wire is on the wrong pin, or `spics_io_num` does not match the wiring', fix: 'Probe pin 12 of the 595 itself. You should see it go low and high once per write.' },
    { symptom: 'Pattern walks D7 to D0 instead of D0 to D7', cause: 'Bit order is LSB first, or the LEDs are wired to the outputs in reverse order', fix: 'Remove `SPI_DEVICE_BIT_LSBFIRST`. If the capture decodes `01 02 04` MSB-first, the firmware is right and the wiring is mirrored.' },
    { symptom: 'Pattern is off by one position or occasionally wrong', cause: 'Mode 1 or 2 (data changing on the sampling edge), or long loose wires causing ringing on SCLK so the chip sees extra clock edges', fix: 'Confirm mode 0 on the capture. Shorten the clock wire, keep ground close, lower the clock speed and see if the error rate changes.' },
    { symptom: 'LEDs change one position per write regardless of the value', cause: '`length` set in bytes (1) instead of bits (8)', fix: 'Count clocks per transaction on the capture; set `.length = 8`.' },
    { symptom: 'All LEDs flicker dimly while data is being sent', cause: 'RCLK tied to SRCLK (a common shortcut in tutorials), so the outputs follow the shift register one clock behind', fix: 'Give RCLK its own signal (the CS line) so outputs change only at the end of a transaction.' },
    { symptom: '`spi_bus_initialize` returns `ESP_ERR_INVALID_STATE`', cause: 'The host is already initialised, by your own code running twice or by another component', fix: 'Initialise the bus once at start-up; add devices to it as needed.' },
    { symptom: 'Board fails to boot or flash after wiring', cause: 'A signal was connected to a strapping pin (GPIO0, 2, 5, 12 or 15) and holds it at the wrong level during reset', fix: 'Move the signal to a non-strapping GPIO. Disconnect the wire and confirm the board boots again.' },
    { symptom: 'JEDEC ID reads `FF FF FF` or `00 00 00`', cause: 'Flash not driving MISO: wrong CS pin, MISO not connected, HOLD or WP floating low, or the part is not powered', fix: 'Probe CS at the flash chip and MISO during the transaction. Tie HOLD and WP high.' },
  ],
  challenge: `Build a 16-LED bar graph from **two** cascaded 74HC595s (QH' of the first into SER of the second, SRCLK and RCLK shared) that shows a level from 0 to 16.

- Decide the byte order from the model before writing firmware, and extend \`sr595_model.c\` with a test that proves your \`bar16()\` function lights LEDs in order from the first chip to the second.
- Send both bytes in **one** transaction so all 16 outputs change on the same latch edge. Show on a capture that there are 16 clocks between the CS edges.
- Add brightness control without adding a GPIO per LED: drive OE from an LEDC PWM channel. Work out which duty cycle means "off" given that OE is active low, and make sure the outputs are disabled from reset until your first write.
- Write down the worst-case current through each chip's supply pin with all LEDs on and compare it with the datasheet's limit.

No solution is given. Your evidence is the passing model test, the capture, and the current calculation.`,
  quiz: [
    { kind: 'concept', q: 'A sensor\'s datasheet shows the clock idling low and data sampled on the falling edge. Which SPI mode do you configure?', choices: [
      { t: 'Mode 1', ok: true, why: 'Idle low is CPOL = 0. The first edge after CS falls is then rising, so a falling-edge sample is the second edge: CPHA = 1. CPOL 0, CPHA 1 is mode 1.' },
      { t: 'Mode 0', why: 'Mode 0 also idles low, but it samples on the first (rising) edge. The controller would then be changing data exactly when this sensor samples it.' },
      { t: 'Mode 2', why: 'Mode 2 does sample on a falling edge, but its clock idles high, so the edge count after CS falls would be off by one edge for this part.' },
      { t: 'Mode 3', why: 'Mode 3 idles high and samples on the rising edge; both properties are the opposite of what this datasheet shows.' },
    ] },
    { kind: 'circuit', q: 'Two 74HC595s are cascaded. You send byte `A` then byte `B` in one transaction and latch. Where do they end up?', choices: [
      { t: '`B` in the chip connected to MOSI, `A` in the far chip', ok: true, why: 'The first byte is pushed through the near chip and out of QH\' by the eight clocks of the second byte. First sent travels furthest.' },
      { t: '`A` in the chip connected to MOSI, `B` in the far chip', why: 'That assumes each chip keeps the first byte it sees. A shift register keeps nothing: every clock moves every bit one stage further along.' },
      { t: 'Both chips hold `B`', why: 'Both chips would hold the same byte only if both SER pins were wired to MOSI in parallel. In a cascade the second chip is fed from the first chip\'s QH\' output.' },
    ] },
    { kind: 'code', q: 'What does this transaction put on the wire?', code: String.raw`spi_transaction_t t = {
    .flags   = SPI_TRANS_USE_TXDATA,
    .length  = 12,
    .tx_data = { 0xAB, 0xCD },
};`, choices: [
      { t: '12 clock pulses: all of 0xAB, then the top four bits of 0xCD', ok: true, why: '`length` is a bit count. The driver sends bytes in order, most-significant bit first, and stops after 12 bits: 1010 1011 1100.' },
      { t: '12 bytes, the last ten of them zero', why: 'That reads `length` as a byte count. Check the unit in the `spi_transaction_t` documentation; it also would overrun the 4-byte `tx_data` array.' },
      { t: '16 clock pulses, because SPI always sends whole bytes', why: 'The controller has a bit counter, not a byte counter. Parts with 12-bit or 9-bit words depend on that.' },
    ] },
    { kind: 'concept', q: 'You write a configuration register of an SPI sensor and the function returns `ESP_OK`. What does that tell you about the sensor?', choices: [
      { t: 'Nothing: SPI has no acknowledgement, so the call succeeds even with no sensor connected', ok: true, why: 'The controller only generates clocks and data. To know the write arrived you must read something back, such as the same register or an ID register.' },
      { t: 'The sensor acknowledged the write', why: 'An acknowledge bit is a feature of I2C. SPI has no line on which a peripheral could signal that.' },
      { t: 'The sensor is present, because otherwise the transfer would time out', why: 'A time-out needs something to wait for. The controller does not wait for the peripheral at any point in an SPI transfer.' },
    ] },
    { kind: 'circuit', q: 'A learner ties RCLK and SRCLK of a 74HC595 together to save a pin. What is the visible effect?', choices: [
      { t: 'The outputs follow the shift register during shifting, so LEDs ghost through intermediate patterns', ok: true, why: 'Every clock now also latches, so the storage register is no longer a buffer that hides the bits in transit. The outputs also lag the shift register by one clock.' },
      { t: 'Nothing changes; the two clocks are equivalent', why: 'They have different jobs: one moves bits, the other publishes them. Merging them removes the reason the chip has two registers.' },
      { t: 'The chip stops shifting', why: 'SRCLK still gets its edges, so shifting continues. Think about what the storage register does on each of those same edges.' },
    ] },
    { kind: 'arch', q: 'Why is `spi_device_polling_transmit` a reasonable choice for writing one byte at 100 kHz but a poor one for sending a 4 kB display buffer?', choices: [
      { t: 'Polling keeps the CPU busy for the whole transfer; that is 80 µs for a byte but a long time for 4 kB, during which lower-priority tasks cannot run', ok: true, why: 'For short transfers the busy-wait is cheaper than blocking and being woken by an interrupt. For long ones, the interrupt-driven call lets the scheduler run other work.' },
      { t: 'Polling transfers cannot use chip select', why: 'CS handling is the same for both call types. The difference lies in what the calling task does while the hardware shifts bits.' },
      { t: 'Polling transfers are limited to four bytes', why: 'Four bytes is the size of the inline `tx_data` field, which is unrelated to whether the driver polls or waits for an interrupt.' },
    ] },
  ],
};


// ───────────────────────────── Project 7: UART link ─────────────────────────────
const p7Figure = (() => {
  let b = box(20, 40, 150, 170, 'Board A', 'ESP32, NODE_ID 1') + box(430, 40, 150, 170, 'Board B', 'ESP32, NODE_ID 2');
  [['GPIO25 TX', 100], ['GPIO26 RX', 140], ['GND', 185]].forEach(([n, y]) => { b += T(164, y + 4, n, 'end') + T(436, y + 4, n); });
  // crossover
  b += wire('170,100 250,100 350,140 430,140', 1) + wire('430,100 350,100 250,140 170,140', 2);
  b += arr(232, 100, 246, 100, 1) + arr(368, 100, 354, 100, 2);
  b += T(300, 88, 'TX crosses to RX', 'middle', 'font-size="10" opacity=".8"');
  b += wire('170,185 430,185') + T(300, 178, 'common ground: the voltage reference', 'middle', 'font-size="10" opacity=".8"');
  b += wire('95,210 95,246', 0, true) + wire('505,210 505,246', 0, true);
  b += box(40, 246, 110, 30, 'USB: PC') + box(450, 246, 110, 30, 'USB: PC or supply');
  b += T(300, 262, 'UART0 on each board stays the', 'middle', 'font-size="10" opacity=".7"') + T(300, 274, 'log and flashing port', 'middle', 'font-size="10" opacity=".7"');
  return svg(600, 290, b);
})();

const p7Frame = (() => {
  const cells = [['SOF', '0xA5', 70, 3], ['LEN', '0..32', 70, 1], ['TYPE', '1 byte', 70, 1], ['PAYLOAD', 'LEN bytes', 150, 2], ['CRC hi', '', 70, 4], ['CRC lo', '', 70, 4]];
  let x = 20, b = '';
  for (const [name, sub, w, n] of cells) {
    b += `<rect x="${x}" y="30" width="${w}" height="44" fill="var(--surface)" stroke="${col(n)}" stroke-width="1.8"/>` + T(x + w / 2, 49, name, 'middle', 'font-weight="700"') + T(x + w / 2, 65, sub, 'middle', 'font-size="10" opacity=".75"');
    x += w;
  }
  b += wire('90,84 90,94 380,94 380,84', 4) + T(235, 110, 'CRC-16/CCITT-FALSE covers LEN, TYPE and PAYLOAD', 'middle', `fill="${col(4)}"`);
  b += T(20, 20, 'first byte on the wire') + T(520, 20, 'last', 'end');
  b += T(20, 136, 'Example, PING from node 1, sequence 0:   A5 03 01 01 00 00 BE 5A', 'start', 'font-size="11"');
  return svg(540, 146, b);
})();

const p7 = {
  id: 'esp-p7', title: 'Project 7: UART communication between two microcontrollers', kind: 'Project', minutes: 180,
  summary: 'Link two ESP32 boards over a second UART, then turn a raw byte stream into a protocol: frames with a length and a CRC, parsed by a state machine that survives noise, truncated frames and hostile lengths.',
  skills: ['esp-pb-uart-link', 'esp-pb-framing', 'esp-pb-debug-link'],
  objectives: [
    'Wire a UART link correctly: TX to RX in both directions and a common ground, and explain what each wire is for.',
    'Configure a second UART with the ESP-IDF driver while UART0 stays free for logs.',
    'Decide whether two parts with different supply voltages can be connected directly, using VIH, VOH and absolute maximum ratings.',
    'Explain why a byte stream needs framing, and design a frame with start marker, length, type and CRC.',
    'Implement the receiver as a state machine that validates the length before using it and recovers from errors.',
    'Test protocol code on a PC before it ever runs on a board, and confirm frames on a logic analyser.',
  ],
  hardware: [
    'Two ESP32 DevKit boards and two USB cables',
    'Three jumper wires (female to female if the boards have header pins)',
    'Logic analyser with at least 2 channels',
    'Optional, for the 5 V discussion: a 1 kΩ and a 2 kΩ resistor, or a level-shifter module',
  ],
  software: [
    'ESP-IDF v6.1',
    'Two serial monitors (`idf.py -p PORT monitor` in two terminals, one per board)',
    'gcc on your PC for the protocol tests',
    'PulseView or equivalent with a UART decoder',
  ],
  background: [
    `### The problem

One board measures something; another needs the measurement. A UART is the simplest link between them: two wires and no clock. But a UART delivers *bytes*, with no idea where a message starts or ends, and it delivers them unchecked. Plug the cable in half-way through a transmission, or let a motor inject one noise spike, and the receiver sees garbage that looks exactly like data. This project builds the link, then builds the layer that makes it trustworthy.

### What is on the wire

A UART line rests high. A byte starts with one low **start bit**, then eight data bits least-significant first, then a high **stop bit**: 10 bit times per byte with the common 8N1 format. There is no clock wire, so both ends must agree on the bit time in advance. At 115200 baud a bit lasts 1/115200 s ≈ 8.68 µs and a byte about 86.8 µs. The receiver finds the falling edge of the start bit and samples the middle of each following bit by its own clock; the two clocks may differ by a few percent before the last sample drifts into the wrong bit.

### Three wires, each for a reason

- **TX of A to RX of B**, and **TX of B to RX of A**. The names describe each board's own point of view. Connecting TX to TX joins two outputs: nothing is received, and whenever the two outputs disagree they fight each other through the pin drivers.
- **Ground to ground.** A voltage is always measured between two points. "3.3 V on the RX pin" means 3.3 V above *that board's* ground. Without a shared ground, the receiver has no reference for the sender's signal and the link works by accident or not at all.`,
    { t: 'callout', kind: 'mistake', title: 'The missing ground that works on your desk', md: `Two boards plugged into the same PC already share a ground through the USB cables, so the link works with only two wires. Move one board to a battery or a separate charger and it produces garbage. Always fit the ground wire; do not rely on a path through someone's computer.` },
    `### Are the logic levels compatible?

Two ESP32 boards are both 3.3 V, so they connect directly. Before connecting any two different parts, check three things in both datasheets:

1. **Will the receiver see a valid high?** The sender's minimum output-high voltage (VOH) must exceed the receiver's minimum input-high voltage (VIH).
2. **Will the receiver see a valid low?** The sender's maximum VOL must be below the receiver's maximum VIL.
3. **Will the receiver survive?** The sender's high level must not exceed the receiver's absolute maximum input voltage.

For a 5 V microcontroller talking to an ESP32:

- **5 V TX into ESP32 RX fails check 3.** The ESP32's pins are not specified as 5 V tolerant; the limit is in the absolute maximum ratings table of its datasheet. Reduce the voltage with a divider (1 kΩ on top, 2 kΩ to ground gives 5 V × 2/3 ≈ 3.3 V) or a level shifter.
- **ESP32 TX into 5 V RX is check 1.** The ESP32 drives close to 3.3 V. A 5 V CMOS input often requires 0.6 or 0.7 × VCC, that is 3.0 V or 3.5 V. At 3.0 V it works with little margin; at 3.5 V it does not, and you need a level shifter. Read the VIH line of that part's DC characteristics; do not guess from the family name.`,
    { t: 'widget', name: 'voltage-divider', props: { challenge: 'level-shift-5v-3v3' }, caption: 'Design the divider for a 5 V TX driving a 3.3 V RX, then consider what its resistance does to edge speed at high baud rates.' },
    `### Why bytes are not messages

Suppose board A sends a 2-byte temperature every second and board B starts listening in the middle. B takes the second byte of one reading and the first byte of the next as a pair, and is wrong forever after. A protocol needs:

- a way to **find the start** of a message (a start-of-frame marker, SOF),
- a way to know **how long** it is (a length field),
- a way to tell **what it means** (a type field),
- a way to **detect corruption** (a checksum or, better, a CRC),
- and a rule for **what to do when any of that fails** (drop, count, resynchronise).`,
    { t: 'figure', svg: p7Frame, caption: 'The frame used in this project. Every field exists to answer one of the questions above.' },
    { t: 'callout', kind: 'decision', title: 'Why a CRC and not a simple sum, and why length is checked first', md: `An additive checksum misses swapped bytes and many double-bit errors, because the sum is unchanged. A CRC treats the message as a polynomial and keeps the remainder of a division; a 16-bit CRC detects every single-bit and double-bit error in frames this short, every odd number of bit errors for this polynomial family, and every burst of up to 16 bits. It costs a few lines of code.

The length byte arrives **before** the CRC can vouch for it. A receiver that trusts it blindly and copies that many bytes into a fixed buffer has a buffer overflow that anyone with access to the wire can trigger. So the length is range-checked the moment it arrives, and the CRC is checked before the payload is used. A CRC protects against accidents, not attackers: anyone can compute a valid CRC for a malicious frame. Authenticity needs a keyed MAC, which is a topic of the security section.` },
    { t: 'widget', name: 'packet-explorer', props: { challenge: 'fix-crc' }, caption: 'Flip a bit and watch the checksum and the CRC react. Find a corruption that the simple checksum misses.' },
  ],
  diagram: [
    { t: 'ascii', caption: 'Pin-by-pin wiring. UART0 (the USB port) is untouched on both boards.', text: `
Board A (NODE_ID 1)      Board B (NODE_ID 2)      Purpose
-------------------      -------------------      -----------------------------------
GPIO25  (UART1 TX)  ---> GPIO26  (UART1 RX)       data A to B
GPIO26  (UART1 RX)  <--- GPIO25  (UART1 TX)       data B to A
GND                 ---- GND                      shared voltage reference
USB                      USB                      power, flashing, log output (UART0)

Logic analyser           Probe
--------------           ------------------------------------------
CH0                      Board A GPIO25 (A's TX = traffic from A)
CH1                      Board A GPIO26 (A's RX = traffic from B)
GND                      either board's GND
` },
    { t: 'figure', svg: p7Figure, caption: 'Two boards, three wires. The crossover is the whole trick: each transmitter drives the other board\'s receiver.' },
    { t: 'callout', kind: 'note', title: 'Why UART1 on GPIO25 and GPIO26, and adapting to other chips', md: `UART0 carries the boot log, \`ESP_LOG\` output and flashing, so the link needs another port. UART1's default pins on the original ESP32 are in the range used by the module's flash, so they must be remapped with \`uart_set_pin\`; GPIO25 and GPIO26 are free, are not strapping pins and can be outputs. \`UART_NUM_1\` also exists on the **ESP32-C3** (which has only two UARTs) and the **ESP32-S3**; choose two free GPIOs there, avoiding strapping pins and the USB pins (GPIO18/19 on the C3, GPIO19/20 on the S3).` },
  ],
  steps: [
    { title: 'Test the protocol code on your PC first', blocks: [
      `The frame codec has no ESP-IDF calls in it, on purpose. It compiles with any C compiler, so you can run hundreds of test cases in a second, including ones that are tedious to produce on a wire: every possible single-bit error, a truncated frame, a hostile length.

Create \`frame.h\`, \`frame.c\` and \`frame_test.c\` in a folder on your PC.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'frame.h', code: String.raw`/* frame.h - a small framed protocol for a UART link. No ESP-IDF includes:
 * this file and frame.c compile unchanged on a PC.
 *
 *   SOF   LEN   TYPE   PAYLOAD[LEN]   CRC_HI  CRC_LO
 *   0xA5  0..32  any    LEN bytes      CRC-16/CCITT-FALSE over LEN..PAYLOAD
 */
#ifndef FRAME_H
#define FRAME_H

#include <stddef.h>
#include <stdint.h>

#define FRAME_SOF          0xA5u
#define FRAME_MAX_PAYLOAD  32u
#define FRAME_OVERHEAD     5u     /* SOF + LEN + TYPE + 2 CRC bytes */

typedef enum {
    FP_WAIT_SOF, FP_LEN, FP_TYPE, FP_PAYLOAD, FP_CRC_HI, FP_CRC_LO
} fp_state_t;

typedef enum {
    FP_NONE,      /* byte consumed, no complete frame yet            */
    FP_FRAME,     /* a valid frame is in .type / .len / .payload     */
    FP_ERR_LEN,   /* LEN field larger than FRAME_MAX_PAYLOAD         */
    FP_ERR_CRC    /* frame arrived complete but the CRC did not match */
} fp_result_t;

typedef struct {
    fp_state_t state;
    uint8_t    len;
    uint8_t    type;
    uint8_t    idx;
    uint8_t    payload[FRAME_MAX_PAYLOAD];
    uint16_t   crc_calc;   /* running CRC of what has arrived   */
    uint16_t   crc_rx;     /* CRC taken from the wire           */
    uint32_t   n_ok, n_bad_crc, n_bad_len, n_timeout;
} frame_parser_t;

uint16_t    crc16_ccitt(uint16_t crc, const uint8_t *data, size_t len);
size_t      frame_encode(uint8_t type, const uint8_t *payload, uint8_t len,
                         uint8_t *out, size_t out_size);
void        frame_parser_init(frame_parser_t *p);
void        frame_parser_timeout(frame_parser_t *p);
fp_result_t frame_parser_feed(frame_parser_t *p, uint8_t byte);

#endif` },
      { t: 'predict', q: 'Before reading `frame.c`: the receiver is in the middle of a payload when a byte equal to 0xA5 (the SOF value) arrives. What should it do?', choices: [
        { t: 'Store it as payload like any other byte', ok: true, why: 'Inside a frame, position decides meaning: the length field already said how many payload bytes follow. 0xA5 is only a start marker when the parser is waiting for one. A corrupted frame is caught by the CRC, not by guessing.' },
        { t: 'Restart the frame, because SOF always marks a start', why: 'Then no payload could ever contain 0xA5 — a counter passing through 165 would break the link. Protocols that want that property must escape the marker inside payloads (byte stuffing), which this one does not.' },
        { t: 'Report an error and discard the frame', why: 'The byte is legal data. Rejecting it would make the protocol unable to carry one of the 256 byte values.' },
      ], reveal: 'The cost of this choice: after a corrupted length the parser may be out of step until it happens to find a real SOF. The inter-byte timeout and the CRC bound how long that lasts. Step 5 lets you watch it.' },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'frame.c', code: String.raw`/* frame.c - CRC, encoder and receive state machine. Pure C11. */
#include "frame.h"
#include <string.h>

/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no bit
 * reflection, no final XOR. Check value for "123456789" is 0x29B1.
 * Pass 0xFFFF as crc for the first call; pass the previous result to
 * continue over more data. */
uint16_t crc16_ccitt(uint16_t crc, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)((uint16_t)data[i] << 8);
        for (int b = 0; b < 8; b++) {
            if (crc & 0x8000u)
                crc = (uint16_t)((crc << 1) ^ 0x1021u);
            else
                crc = (uint16_t)(crc << 1);
        }
    }
    return crc;
}

/* Returns the number of bytes written to out, or 0 if it does not fit. */
size_t frame_encode(uint8_t type, const uint8_t *payload, uint8_t len,
                    uint8_t *out, size_t out_size)
{
    size_t total = (size_t)len + FRAME_OVERHEAD;
    if (len > FRAME_MAX_PAYLOAD || out_size < total) return 0;
    if (len > 0 && payload == NULL) return 0;

    out[0] = FRAME_SOF;
    out[1] = len;
    out[2] = type;
    if (len > 0) memcpy(&out[3], payload, len);
    uint16_t crc = crc16_ccitt(0xFFFFu, &out[1], (size_t)len + 2u);
    out[3 + len] = (uint8_t)(crc >> 8);
    out[4 + len] = (uint8_t)(crc & 0xFFu);
    return total;
}

void frame_parser_init(frame_parser_t *p)
{
    memset(p, 0, sizeof *p);
    p->state = FP_WAIT_SOF;
}

/* Call when the line has been silent for longer than a frame can pause.
 * A half-received frame is abandoned so the next SOF starts cleanly. */
void frame_parser_timeout(frame_parser_t *p)
{
    if (p->state != FP_WAIT_SOF) {
        p->n_timeout++;
        p->state = FP_WAIT_SOF;
    }
}

fp_result_t frame_parser_feed(frame_parser_t *p, uint8_t byte)
{
    switch (p->state) {
    case FP_WAIT_SOF:
        if (byte == FRAME_SOF) p->state = FP_LEN;
        return FP_NONE;                      /* anything else is noise */

    case FP_LEN:
        if (byte > FRAME_MAX_PAYLOAD) {      /* check BEFORE using it  */
            p->n_bad_len++;
            p->state = FP_WAIT_SOF;
            return FP_ERR_LEN;
        }
        p->len = byte;
        p->idx = 0;
        p->crc_calc = crc16_ccitt(0xFFFFu, &byte, 1);
        p->state = FP_TYPE;
        return FP_NONE;

    case FP_TYPE:
        p->type = byte;
        p->crc_calc = crc16_ccitt(p->crc_calc, &byte, 1);
        p->state = (p->len == 0) ? FP_CRC_HI : FP_PAYLOAD;
        return FP_NONE;

    case FP_PAYLOAD:
        p->payload[p->idx++] = byte;         /* idx < len <= MAX here  */
        p->crc_calc = crc16_ccitt(p->crc_calc, &byte, 1);
        if (p->idx == p->len) p->state = FP_CRC_HI;
        return FP_NONE;

    case FP_CRC_HI:
        p->crc_rx = (uint16_t)((uint16_t)byte << 8);
        p->state = FP_CRC_LO;
        return FP_NONE;

    case FP_CRC_LO:
        p->crc_rx |= byte;
        p->state = FP_WAIT_SOF;
        if (p->crc_rx == p->crc_calc) {
            p->n_ok++;
            return FP_FRAME;
        }
        p->n_bad_crc++;
        return FP_ERR_CRC;
    }
    p->state = FP_WAIT_SOF;                  /* corrupted state: recover */
    return FP_NONE;
}`, explain: [
        { lines: '9-21', md: 'Bitwise CRC: XOR the byte into the top of the 16-bit register, then for each of its 8 bits shift left and, if a 1 fell out of the top, XOR in the polynomial 0x1021. It is long division in base 2 where subtraction is XOR. Slow but tiny; a table-driven version trades 512 bytes of flash for speed.' },
        { lines: '24-39', md: 'The encoder refuses anything that does not fit rather than truncating. The CRC is computed over the bytes already placed in the output buffer, so what is checked is exactly what is sent.' },
        { lines: '49-55', md: 'The escape hatch. If the line goes quiet in the middle of a frame, the rest is not coming; abandon it so the next SOF is recognised.' },
        { lines: '64-73', md: 'The security-relevant lines. The length is compared with the buffer size *before* it is stored or used. Every later write to `payload` is safe because of this check.' },
        { lines: '81-85', md: '`idx` can never reach `FRAME_MAX_PAYLOAD` because `len` was bounded above and the state changes when `idx == len`.' },
        { lines: '92-100', md: 'Only now, with the CRC matching, is the frame reported to the caller. A bad frame is counted, not silently dropped: counters are how you find a flaky link.' },
        { lines: '102-103', md: 'An unreachable default path for a valid enum, but RAM can be corrupted. Falling back to a known state costs two lines.' },
      ] },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'frame_test.c — gcc -Wall -Wextra -std=c11 frame.c frame_test.c -o frame_test && ./frame_test', code: String.raw`/* frame_test.c - PC test for frame.c.
 * Build: gcc -Wall -Wextra -std=c11 frame.c frame_test.c -o frame_test */
#include "frame.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* Feed a buffer; return how many good frames came out, remember the last. */
static int feed(frame_parser_t *p, const uint8_t *buf, size_t n,
                fp_result_t *last_err)
{
    int good = 0;
    for (size_t i = 0; i < n; i++) {
        fp_result_t r = frame_parser_feed(p, buf[i]);
        if (r == FP_FRAME) good++;
        else if (r != FP_NONE && last_err) *last_err = r;
    }
    return good;
}

int main(void)
{
    /* 1. Published check value for this CRC variant. */
    assert(crc16_ccitt(0xFFFFu, (const uint8_t *)"123456789", 9) == 0x29B1u);

    /* 2. Byte-at-a-time CRC equals one-shot CRC. */
    uint16_t c = 0xFFFFu;
    for (int i = 0; i < 9; i++) c = crc16_ccitt(c, (const uint8_t *)"123456789" + i, 1);
    assert(c == 0x29B1u);

    /* 3. Encode a frame and print it so you can compare with a capture. */
    uint8_t buf[FRAME_MAX_PAYLOAD + FRAME_OVERHEAD];
    const uint8_t ping[2] = { 0x00, 0x2A };
    size_t n = frame_encode(0x01, ping, sizeof ping, buf, sizeof buf);
    assert(n == 7 && buf[0] == 0xA5 && buf[1] == 2 && buf[2] == 0x01);
    printf("PING frame:");
    for (size_t i = 0; i < n; i++) printf(" %02X", buf[i]);
    printf("\n");

    /* 4. Round trip. */
    frame_parser_t p;
    frame_parser_init(&p);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(p.type == 0x01 && p.len == 2 && memcmp(p.payload, ping, 2) == 0);

    /* 5. Every single-bit error in the frame is rejected (none yields a frame). */
    for (size_t bit = 0; bit < n * 8; bit++) {
        uint8_t bad[sizeof buf];
        memcpy(bad, buf, n);
        bad[bit / 8] ^= (uint8_t)(1u << (bit % 8));
        frame_parser_t q;
        frame_parser_init(&q);
        int good = feed(&q, bad, n, NULL);
        frame_parser_timeout(&q);          /* line goes quiet afterwards */
        assert(good == 0);
    }

    /* 6. Noise before the frame, then two frames back to back. */
    const uint8_t noise[] = { 0x00, 0xFF, 0x13, 0x37 };
    frame_parser_init(&p);
    assert(feed(&p, noise, sizeof noise, NULL) == 0);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(p.n_ok == 2);

    /* 7. Oversized LEN is refused before any payload byte is stored. */
    const uint8_t huge[] = { 0xA5, 0xFF };
    fp_result_t err = FP_NONE;
    frame_parser_init(&p);
    feed(&p, huge, sizeof huge, &err);
    assert(err == FP_ERR_LEN && p.n_bad_len == 1 && p.state == FP_WAIT_SOF);

    /* 8. A frame cut off half way, a silence, then a good frame. */
    frame_parser_init(&p);
    feed(&p, buf, 4, NULL);
    frame_parser_timeout(&p);
    assert(p.n_timeout == 1);
    assert(feed(&p, buf, n, NULL) == 1);

    /* 9. Zero-length payload and maximum-length payload. */
    n = frame_encode(0x7F, NULL, 0, buf, sizeof buf);
    assert(n == 5);
    frame_parser_init(&p);
    assert(feed(&p, buf, n, NULL) == 1 && p.len == 0);
    uint8_t big[FRAME_MAX_PAYLOAD];
    for (unsigned i = 0; i < sizeof big; i++) big[i] = (uint8_t)i;
    n = frame_encode(0x02, big, (uint8_t)sizeof big, buf, sizeof buf);
    assert(n == sizeof buf);
    assert(feed(&p, buf, n, NULL) == 1 && p.len == FRAME_MAX_PAYLOAD);
    assert(frame_encode(0x02, big, 33, buf, sizeof buf) == 0);
    assert(frame_encode(0x02, big, 8, buf, 12) == 0);

    printf("frame: all checks passed\n");
    return 0;
}` },
      `You should see a line \`PING frame: A5 02 01 00 2A DB B0\` and then \`frame: all checks passed\`. If an assertion fails, the program stops and prints the file and line. Test 5 is worth reading closely: it flips each of the 56 bits of a frame in turn and confirms that not one of the damaged frames is accepted.`,
      { t: 'widget', name: 'state-machine', props: { machine: 'uart-parser' }, caption: 'Step a frame parser one byte at a time and watch the state change. Feed it a bad length and a truncated frame.' },
    ] },
    { title: 'Loopback: prove one board\'s UART and pins', blocks: [
      CMAKE_NOTE({ srcs: '"main.c" "frame.c"', req: 'esp_driver_uart' }),
      `Copy \`frame.h\` and \`frame.c\` into the project's \`main\` folder. Start from the full program in step 4, but for now replace the body of the \`while (1)\` loop in \`app_main\` with the raw test below and do not create \`rx_task\` yet.

On **one** board, connect a single jumper from GPIO25 to GPIO26: its own TX to its own RX.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'Raw send and receive, for bring-up only', code: String.raw`/* Step 2: prove the UART and the wire before adding any protocol.
 * Replace the body of app_main's while loop with this. */
const char msg[] = "hello\n";
uart_write_bytes(LINK_UART, msg, sizeof msg - 1);

uint8_t rx[32];
int n = uart_read_bytes(LINK_UART, rx, sizeof rx, pdMS_TO_TICKS(100));
if (n > 0) {
    ESP_LOGI(TAG, "received %d byte(s)", n);
    ESP_LOG_BUFFER_HEXDUMP(TAG, rx, n, ESP_LOG_INFO);
} else {
    ESP_LOGW(TAG, "nothing received");
}
vTaskDelay(pdMS_TO_TICKS(1000));` },
      `You should see \`received 6 byte(s)\` and a hex dump of \`68 65 6c 6c 6f 0a\` every second. Pull the jumper out: you should see \`nothing received\`. A loopback proves the UART configuration, both pin assignments and your monitor, with only one board involved. If two boards later fail to talk, you already know each one works alone.`,
    ] },
    { title: 'Connect two boards and exchange raw bytes', blocks: [
      `Flash the same raw test to the second board. Unplug both boards, wire the three connections from the table (TX to RX twice, ground to ground), and plug both in. Open a monitor on each.`,
      { t: 'predict', q: 'Both boards send "hello\\n" once a second and neither knows when the other started. Will each read always return exactly the 6 bytes of one message?', choices: [
        { t: 'No. A read returns whatever bytes have arrived by then, which may be part of a message or more than one', ok: true, why: '`uart_read_bytes` knows nothing about your messages. It returns after the timeout with what is in the driver\'s buffer. Depending on the phase between the two boards\' loops you will see 6 bytes, sometimes fewer, sometimes 12. That is the problem framing solves.' },
        { t: 'Yes. The UART delivers each write as one unit', why: 'A UART has no concept of a write. On the wire the bytes of one call and the next are just consecutive characters with idle time between them.' },
        { t: 'Yes, as long as the baud rates match', why: 'Matching baud rates make each *byte* arrive intact. They say nothing about how bytes are grouped by the reader.' },
      ], reveal: 'Leave it running for a minute and look for a read that does not return 6 bytes. Now capture CH0 and CH1 with the UART decoder at 115200 8N1: you should see the idle level high, each byte 10 bits long, and one bit lasting about 8.7 µs. Sample at 1 MS/s or more so each bit gets at least 8 samples.' },
    ] },
    { title: 'Run the framed protocol', blocks: [
      `Replace the test with the full program. Flash it to both boards, with \`NODE_ID\` set to 1 on one and 2 on the other.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'main/main.c — same file on both boards except NODE_ID', code: String.raw`/* Project 7: framed UART link between two ESP32 boards. Flash the same
 * program to both; set NODE_ID to 1 on one board and 2 on the other. */
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_err.h"
#include "esp_log.h"
#include "frame.h"

#define NODE_ID      1
#define LINK_UART    UART_NUM_1
#define PIN_LINK_TX  25
#define PIN_LINK_RX  26
#define LINK_BAUD    115200

#define TYPE_PING    0x01
#define TYPE_PONG    0x02

static const char *TAG = "p7";

static void link_send(uint8_t type, const uint8_t *payload, uint8_t len)
{
    uint8_t buf[FRAME_MAX_PAYLOAD + FRAME_OVERHEAD];
    size_t n = frame_encode(type, payload, len, buf, sizeof buf);
    if (n == 0) {
        ESP_LOGE(TAG, "frame too long (%u)", (unsigned)len);
        return;
    }
    uart_write_bytes(LINK_UART, buf, n);
}

static void rx_task(void *arg)
{
    (void)arg;
    frame_parser_t fp;
    frame_parser_init(&fp);
    uint8_t chunk[64];

    while (1) {
        /* Wait up to 50 ms for bytes. A return of 0 means the line was quiet. */
        int n = uart_read_bytes(LINK_UART, chunk, sizeof chunk, pdMS_TO_TICKS(50));
        if (n <= 0) {
            frame_parser_timeout(&fp);
            continue;
        }
        for (int i = 0; i < n; i++) {
            switch (frame_parser_feed(&fp, chunk[i])) {
            case FP_FRAME:
                ESP_LOGI(TAG, "rx type=0x%02X len=%u", fp.type, (unsigned)fp.len);
                if (fp.len > 0) ESP_LOG_BUFFER_HEX(TAG, fp.payload, fp.len);
                if (fp.type == TYPE_PING)
                    link_send(TYPE_PONG, fp.payload, fp.len);   /* echo it back */
                break;
            case FP_ERR_CRC:
                ESP_LOGW(TAG, "bad CRC (total %u)", (unsigned)fp.n_bad_crc);
                break;
            case FP_ERR_LEN:
                ESP_LOGW(TAG, "bad length (total %u)", (unsigned)fp.n_bad_len);
                break;
            case FP_NONE:
                break;
            }
        }
    }
}

void app_main(void)
{
    const uart_config_t cfg = {
        .baud_rate  = LINK_BAUD,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    /* 1024-byte RX ring buffer, no TX buffer (writes block until sent to the FIFO),
     * no event queue. */
    ESP_ERROR_CHECK(uart_driver_install(LINK_UART, 1024, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LINK_UART, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(LINK_UART, PIN_LINK_TX, PIN_LINK_RX,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    xTaskCreate(rx_task, "link_rx", 4096, NULL, 5, NULL);

    uint16_t seq = 0;
    while (1) {
        uint8_t payload[3] = { NODE_ID, (uint8_t)(seq >> 8), (uint8_t)seq };
        link_send(TYPE_PING, payload, sizeof payload);
        ESP_LOGI(TAG, "tx PING seq=%u", (unsigned)seq);
        seq++;
        vTaskDelay(pdMS_TO_TICKS(NODE_ID == 1 ? 1000 : 1700));
    }
}` },
      `You should see, on each board, \`tx PING seq=N\` at its own interval, \`rx type=0x01 len=3\` with the other board's node number and sequence, and \`rx type=0x02 len=3\` echoing its own PING back. The two intervals differ (1.0 s and 1.7 s) so the boards drift relative to each other and sometimes transmit at the same moment; a UART link is full duplex, so that must work.

On the analyser, the first PING from node 1 should decode as \`A5 03 01 01 00 00 BE 5A\`, lasting 8 × 86.8 µs ≈ 0.69 ms, and the reply on the other channel as \`A5 03 02 01 00 00 25 86\`.`,
    ] },
    { title: 'Attack your own link', blocks: [
      `A receiver is only proven when it has been fed bad input. With both boards running and both monitors visible:

1. **Pull the A-to-B data wire out for a second and push it back.** You should see board B log nothing or a \`bad CRC\` for the interrupted frame, then resume with correct sequence numbers. It must not print a frame with wrong contents.
2. **Touch the loose end of that wire to GND and 3V3 a few times** before reconnecting it, which injects edges the UART interprets as bytes. You should see \`bad CRC\` or \`bad length\` counts rise and normal reception continue afterwards.
3. **Reset board A in the middle of traffic.** While it boots, its TX pin is not driven by the UART. You should see board B's counters possibly increase and then clean frames again.`,
      { t: 'predict', q: 'In `rx_task`, what would happen if you deleted the call to `frame_parser_timeout()` and a frame was cut off after its LEN byte announced 32 bytes?', reveal: 'The parser would sit in the payload state waiting for the rest. When the next good frame arrived, its bytes — including its SOF — would be consumed as the old frame\'s payload, and its CRC check would fail. One truncated frame costs you the next one or more good frames. The timeout bounds the damage to the frame that was actually broken. Try it: remove the call, repeat test 1 several times, and compare the `bad CRC` count.' },
    ] },
    { title: 'Debugging exercises', blocks: [
      { t: 'exercise', prompt: `**Exercise A.** Two boards are wired GPIO25 to GPIO25, GPIO26 to GPIO26, and ground to ground. Each board passes the loopback test alone. Together, neither receives anything. With a multimeter, both data wires read about 3.3 V when idle. Name the fault and say why measuring idle voltage could not find it.`, hints: ['What does a UART TX pin rest at? What does a floating RX pin with nothing driving it read?', 'Which pins are outputs, and what are they connected to?'], answer: { type: 'text', accept: ['tx.*tx', 'cross', 'swap', 'rx.*rx'], nudge: 'Look at which signal on one board meets which signal on the other.' }, solution: `TX is wired to TX and RX to RX. Both TX outputs rest high, so the TX–TX wire reads 3.3 V whether it is right or wrong; the RX–RX wire is driven by nobody and reads whatever the inputs float or are pulled to. Idle voltage looks plausible in both cases. Worse, when one board sends a start bit (low) while the other's TX is high, the two push-pull outputs are shorted against each other for a bit time. The fix is the crossover. The way to find it is a capture on each board's RX pin: no activity ever appears there.` },
      { t: 'exercise', prompt: `**Exercise B.** A sensor node on a battery pack sends frames to a base board on USB. Two wires connect them: node TX to base RX, and base TX to node RX. The base logs about one \`bad CRC\` in three frames, and the rate changes when someone touches the battery pack. When the node is powered from the same PC by USB for debugging, the error rate is zero. What is missing, and why does USB hide it?`, hints: ['What is the voltage on the node\'s TX pin measured relative to?', 'Trace every conductor between the two boards in each of the two power arrangements.'], answer: { type: 'text', accept: ['ground', 'gnd', 'reference', 'common'], nudge: 'Count the conductors that join the two boards in each arrangement.' }, solution: `There is no common ground. With both boards on the same PC, their grounds are joined through the USB cables and the PC, so the two signal wires have a reference. On the battery, the node's ground floats relative to the base; the only return paths are stray capacitance and whatever leaks through the data pins' protection structures, so the level the base sees wanders with every disturbance, including a hand near the battery. Add the ground wire. Then confirm with the analyser, grounded at the base: the node's TX should swing cleanly between 0 V and 3.3 V.` },
      { t: 'exercise', prompt: `**Exercise C.** This receiver "worked for months" and then a board started resetting at random when a noisy pump ran nearby. Find the bug and say how a single corrupted byte triggers it.`, code: String.raw`static uint8_t payload[32];
static uint8_t len, idx;

void feed(uint8_t byte)
{
    switch (state) {
    case WAIT_SOF: if (byte == 0xA5) state = LEN;  break;
    case LEN:      len = byte; idx = 0; state = PAYLOAD; break;
    case PAYLOAD:  payload[idx++] = byte;
                   if (idx == len) state = CRC_HI;
                   break;
    /* ... CRC states check the CRC and reject bad frames ... */
    }
}`, hints: ['Which field is used before the CRC has been checked?', 'What is the largest value `len` can take, and how big is `payload`?', 'There is a second bug for `len == 0`.'], answer: { type: 'text', accept: ['len', 'length', 'bound', 'overflow', 'range', '32'], nudge: 'Follow one byte of noise into the LEN state.' }, solution: `\`len\` is taken from the wire and never compared with the buffer size. One noise byte interpreted as SOF, followed by any byte above 32, makes the parser write up to 255 bytes into a 32-byte array, overwriting whatever the linker placed after it. The CRC check comes too late: the damage is done while the payload is being stored. On a link an attacker can reach, this is a remotely triggerable memory corruption. The fix is the check in \`frame.c\`: reject \`byte > FRAME_MAX_PAYLOAD\` in the LEN state. Second bug: with \`len == 0\`, \`idx == len\` is tested only after one byte has been stored and \`idx\` is 1, so the parser runs on until \`idx\` wraps. A zero-length frame must skip the payload state.` },
      { t: 'widget', name: 'packet-explorer', props: { challenge: 'find-length-bug' }, caption: 'The same class of bug in a simulated frame parser.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'no-common-ground' }, caption: 'Diagnose a simulated link from its capture. Also try the tx-rx-swapped and level-mismatch scenarios in the Workbench.' },
    ] },
  ],
  walkthrough: [
    `### The UART driver and the hardware under it

**\`uart_driver_install(LINK_UART, 1024, 0, 0, NULL, 0)\`** allocates a 1024-byte software ring buffer for received data and installs the UART interrupt handler. The hardware UART has a small receive FIFO (its depth is in the chip's reference manual). When the FIFO passes a threshold, or when bytes are waiting and the line has been idle for a few character times, the UART raises an interrupt and the driver's handler moves the bytes from the FIFO to the ring buffer. Your task never touches the FIFO. With a TX buffer size of 0, \`uart_write_bytes\` blocks until all bytes have been handed to the transmit FIFO.

**\`uart_param_config\`** writes the frame format and programs the baud-rate divider: the UART clock divided by an integer-plus-fraction value gives the bit clock. \`UART_SCLK_DEFAULT\` selects the default clock source for the chip.

**\`uart_set_pin\`** routes UART1's TX and RX signals through the GPIO matrix to GPIO25 and GPIO26 and sets pad directions. RTS and CTS are left unconnected because hardware flow control is off.

### Receiving: who waits for what

\`uart_read_bytes(..., pdMS_TO_TICKS(50))\` blocks \`rx_task\` until the requested number of bytes are available or 50 ms pass, and returns what it has. While blocked the task uses no CPU. A return of 0 therefore means "50 ms of silence", which this design uses as the inter-frame timeout: a whole 37-byte maximum frame takes about 3.2 ms at 115200 baud, so 50 ms of nothing in the middle of a frame means the rest is not coming.

Each byte then goes through \`frame_parser_feed\`. The parser never blocks and never allocates; it is a pure function of its state and one input byte. That separation — a driver task that waits, and protocol logic that does not — is what made the logic testable on a PC.

### Sending

\`link_send\` builds the complete frame in a local buffer and makes **one** \`uart_write_bytes\` call. If the frame were written field by field from two tasks, their bytes could interleave on the wire. Here both the main task and \`rx_task\` call \`link_send\`; each call's bytes go out as a block because the driver serialises writers. If you move to a design with a TX ring buffer or longer frames, give the link one owner task with a queue in front of it.

### What the CRC line does to the bits

For each input byte, \`crc ^= byte << 8\` lines the byte up with the top of the 16-bit remainder. The inner loop then performs eight steps of binary long division: shift left one bit; if the bit shifted out was 1, subtract the divisor, which in this arithmetic is XOR with 0x1021. What remains after the last byte is the CRC. The receiver runs the same division over the same bytes and compares. Sending the high byte first is a convention of this protocol; both ends only need to agree.`,
  ],
  testing: [
    `| Test | How | You should see |
|---|---|---|
| Host tests | \`./frame_test\` on the PC | \`frame: all checks passed\` |
| Loopback | One board, GPIO25 jumpered to GPIO26 | 6 bytes \`68 65 6c 6c 6f 0a\` each second; \`nothing received\` with the jumper removed |
| Bit time | Cursors across one byte's start bit, or across 10 bits divided by 10 | 8.7 µs per bit, 86.8 µs per byte |
| Idle level | Capture with no traffic | Both data lines high |
| Frame bytes | UART decoder, 115200 8N1, on board A's TX | \`A5 03 01 01 00 00 BE 5A\` for node 1's first PING |
| Echo | Decoder on board A's RX | \`A5 03 02 01 00 00 25 86\` within a few milliseconds of the PING |
| Sequence | Read both monitors for a minute | Every PING answered by a PONG with the same sequence; no gaps |
| Wire pulled | Disconnect and reconnect one data wire | At most one \`bad CRC\`; reception resumes; no frame with wrong contents is logged |
| Noise injected | Tap the loose wire on GND / 3V3 | Error counters rise; no crash, no reset; clean frames afterwards |
| Ground removed | Power board B from a USB charger, remove the ground wire | Errors or silence; restoring ground restores the link |`,
    { t: 'callout', kind: 'note', title: 'Decoding a UART byte by hand', md: `Do this once without the decoder. From the falling edge of the start bit, step one bit time (8.68 µs) at a time and read the level in the middle of each bit. The first data bit after the start bit is bit 0. For \`0xA5\` (1010 0101) the line shows: start 0, then 1 0 1 0 0 1 0 1, then stop 1. Reading it left to right gives the byte backwards, which is the most common mistake when decoding by eye.` },
    { t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-9600-hello' }, caption: 'Practise decoding a simulated UART capture by hand: measure the bit time, find the start bit, read LSB first.' },
  ],
  troubleshooting: [
    { symptom: 'Nothing received on either board', cause: 'TX wired to TX, or the pins in `uart_set_pin` do not match the wiring', fix: 'Run the loopback test on each board alone. Then probe each board\'s RX pin: traffic from the other board must be visible there.' },
    { symptom: 'Garbage bytes, about the right number of them', cause: 'Baud rate or frame format differs between the two ends', fix: 'Measure one bit time on a capture and compute the baud rate (1 / bit time). Compare with both configurations.' },
    { symptom: 'Works on one PC, fails on battery or with separate power supplies', cause: 'No common ground; the USB cables were providing it', fix: 'Add the ground wire between the boards.' },
    { symptom: 'Occasional `bad CRC`, more often with long wires', cause: 'Noise coupling, ground bounce, or edges slowed by cable capacitance', fix: 'Shorten the wires, keep the ground wire next to the signal wires, lower the baud rate and see whether the rate falls.' },
    { symptom: 'Boot log or strange characters appear on the link', cause: 'The link was put on UART0 pins, which also carry the ROM boot messages and the application log', fix: 'Use UART1 on remapped pins as shown; keep UART0 for the console.' },
    { symptom: 'Board resets with a panic mentioning the flash, or will not boot, after `uart_driver_install`', cause: 'UART1 left on its default pins, which are wired to the module\'s flash on the original ESP32', fix: 'Call `uart_set_pin` with free GPIOs before using the port.' },
    { symptom: 'Frames are lost when the other board sends a burst', cause: 'RX ring buffer too small for the burst, or `rx_task` starved by higher-priority work', fix: 'Enlarge the RX buffer, raise the task priority, or check the driver\'s buffer-full and FIFO-overflow events through an event queue.' },
    { symptom: 'A 5 V board receives nothing from the ESP32, but the ESP32 receives from it', cause: 'ESP32\'s 3.3 V high is below the 5 V part\'s VIH', fix: 'Fit a level shifter on that direction. And check the other direction is divided down: 5 V into an ESP32 pin exceeds its ratings.' },
  ],
  challenge: `Make the link **reliable**, not just checked. At present a corrupted PING is detected and thrown away, and the sender never finds out.

- Add an acknowledgement: every data frame carries a sequence number and must be answered by an ACK frame with that number. The sender retransmits after a timeout, a limited number of times, then reports a link failure.
- The receiver must not act twice on a frame whose ACK was lost and which was therefore sent again. Decide how it tells a retransmission from a new frame.
- Write the retransmission logic as pure C with the time passed in as an argument, and test on the PC the cases: frame lost, ACK lost, duplicate delivered, link dead.
- Demonstrate it on hardware by pulling the wire, and show the retransmission on a capture.
- Then write half a page: an attacker who can inject bytes on this wire can forge any frame, since the CRC has no secret. What would you have to add to stop that, and what would stop a recorded valid frame from being replayed later?

No solution is given.`,
  quiz: [
    { kind: 'circuit', q: 'A 5 V microcontroller and an ESP32 must exchange UART data. Which connection is acceptable as it stands?', choices: [
      { t: 'Neither direction can be assumed safe: 5 V into the ESP32 exceeds its input rating, and 3.3 V into the 5 V part must be checked against its VIH', ok: true, why: 'One direction is a survival question (absolute maximum input voltage), the other is a threshold question (does 3.3 V count as high). Both are answered from datasheet tables, and at least the 5 V to 3.3 V direction needs a divider or level shifter.' },
      { t: 'Both directions directly, because UART is a standard', why: 'UART standardises the frame of bits, not the voltages. The voltages are whatever each chip\'s supply and I/O cells make them.' },
      { t: 'Both directions directly, as long as the grounds are connected', why: 'A common ground is necessary for any link, but it does not lower a 5 V output to a level a 3.3 V input can survive.' },
    ] },
    { kind: 'concept', q: 'At 115200 baud, 8N1, roughly how long does a 37-byte frame occupy the wire?', choices: [
      { t: 'About 3.2 ms', ok: true, why: 'Each byte is 10 bits (start, 8 data, stop): 370 bits at 8.68 µs each is 3.2 ms.' },
      { t: 'About 2.6 ms', why: 'That counts 8 bits per byte. On the wire every byte also carries a start bit and a stop bit.' },
      { t: 'About 0.32 ms', why: 'Check the bit time: 1/115200 s is 8.68 µs, and there are several hundred bits.' },
    ] },
    { kind: 'security', q: 'Why does the parser compare LEN with the buffer size the moment the LEN byte arrives, rather than relying on the CRC to reject bad frames?', choices: [
      { t: 'The CRC is only known after the payload has been stored, so an unchecked LEN would already have caused writes past the buffer', ok: true, why: 'Order of operations is the point. Validation must happen before the value is used, and the first use of LEN is storing payload bytes.' },
      { t: 'The CRC cannot detect errors in the LEN field', why: 'LEN is covered by the CRC in this frame. The issue is when the check happens relative to the writes, not what it covers.' },
      { t: 'Checking LEN makes the parser faster', why: 'Speed is not the motivation; an out-of-range length is a memory-safety problem, and it exists whether the parser is fast or slow.' },
    ] },
    { kind: 'concept', q: 'A frame arrives with a valid CRC. What can the receiver conclude?', choices: [
      { t: 'The frame was very probably not corrupted by accident; it says nothing about who sent it', ok: true, why: 'A CRC is public arithmetic. Random errors almost never produce a matching CRC, but anyone can compute the right CRC for any content they choose.' },
      { t: 'The frame came from the paired board', why: 'Nothing in a CRC depends on a secret or an identity. A device that needs to know the sender must use a keyed MAC or a signature.' },
      { t: 'The frame is new and not a repeat of an earlier one', why: 'A recorded frame replays with the same valid CRC. Freshness needs a counter or a nonce that the receiver tracks.' },
    ] },
    { kind: 'code', q: 'What is the purpose of calling `frame_parser_timeout()` when `uart_read_bytes` returns 0?', choices: [
      { t: 'To abandon a half-received frame so that the next frame\'s SOF is recognised as a start', ok: true, why: 'Without it, a truncated frame leaves the parser waiting for payload, and it would swallow the beginning of the next good frame as data.' },
      { t: 'To retransmit the last frame', why: 'This protocol has no retransmission; the function only changes receiver state. Reliability on top of detection is the independent challenge.' },
      { t: 'To clear the UART hardware FIFO', why: 'The function is pure C and does not know a UART exists. It resets the parser\'s state variable and counts the event.' },
    ] },
    { kind: 'arch', q: 'Why is the frame codec kept free of ESP-IDF includes?', choices: [
      { t: 'So it can be compiled and tested on a PC, where error cases are cheap to generate, and reused on any microcontroller', ok: true, why: 'Logic that depends only on its inputs can be exercised with thousands of cases in a second. Hardware is then needed only to prove the wiring and the driver.' },
      { t: 'Because ESP-IDF headers cannot be included from more than one file', why: 'They can be included anywhere. The separation is a design choice about testability and portability.' },
      { t: 'Because CRC code must not run inside a FreeRTOS task', why: 'It runs inside `rx_task` on the board. What matters is that it does not *call* the RTOS or drivers itself.' },
    ] },
  ],
};

export default { skills, lessons: [], labs: [p6, p7], glossary: [], troubleshooting: [], refs: [] };
