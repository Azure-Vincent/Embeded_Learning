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

export default { skills, lessons: [], labs: [p6], glossary: [], troubleshooting: [], refs: [] };
