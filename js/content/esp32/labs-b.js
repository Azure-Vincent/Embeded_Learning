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
        { lines: '7-10', md: 'The whole chip is 16 flip-flops. Keeping the shift and storage registers separate in the model is what lets you see why outputs do not flicker while bits move.' },
        { lines: '15-20', md: 'One rising edge on SRCLK. The value returned is what QH\' presented *before* the edge, because a second chip clocked by the same edge samples the old value.' },
        { lines: '26-33', md: 'An SPI master sending one byte is eight of those edges with a chosen bit order.' },
        { lines: '57-63', md: 'In a chain, the first byte you send is pushed through into the far chip. Send the far chip\'s data first.' },
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
        { lines: '7-16', md: 'A second device on the same host: same three bus wires, its own CS pin, its own clock speed. The driver reprograms the clock divider and asserts the right CS for each transaction.' },
        { lines: '20-25', md: 'SPI is always full duplex: 32 clocks send four bytes and receive four bytes. The three zero bytes are only there to generate clocks for the reply.' },
        { lines: '26-29', md: 'While the command byte was going out, the flash was not yet driving a reply. The byte received in that slot is meaningless and must be skipped.' },
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
        { lines: '64-74', md: 'The security-relevant lines. The length is compared with the buffer size *before* it is stored or used. Every later write to `payload` is safe because of this check.' },
        { lines: '82-86', md: '`idx` can never reach `FRAME_MAX_PAYLOAD` because `len` was bounded above and the state changes when `idx == len`.' },
        { lines: '93-101', md: 'Only now, with the CRC matching, is the frame reported to the caller. A bad frame is counted, not silently dropped: counters are how you find a flaky link.' },
        { lines: '103-104', md: 'An unreachable default path for a valid enum, but RAM can be corrupted. Falling back to a known state costs two lines.' },
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


// ───────────────────────────── Project 8: Wi-Fi device ─────────────────────────────
const p8States = (() => {
  let b = state(15, 40, 110, 42, 'STARTING', '', 0) + state(200, 40, 130, 42, 'CONNECTING', 'bit clear', 2) + state(440, 40, 135, 42, 'CONNECTED', 'has IP, bit set', 4) + state(200, 170, 130, 42, 'BACKOFF', 'timer armed', 3);
  b += arr(125, 61, 200, 61) + T(162, 34, 'STA_START', 'middle', 'font-size="10"') + T(162, 80, 'connect()', 'middle', 'font-size="10" opacity=".7"');
  b += arr(330, 61, 440, 61, 4) + T(385, 34, 'GOT_IP', 'middle', 'font-size="10"') + T(385, 80, 'attempt = 0', 'middle', 'font-size="10" opacity=".7"');
  b += arr(240, 82, 240, 170, 3) + T(234, 122, 'DISCONNECTED', 'end', 'font-size="10"') + T(234, 135, '(join failed)', 'end', 'font-size="10" opacity=".7"');
  b += arr(290, 170, 290, 82, 2) + T(297, 122, 'timer fires', 'start', 'font-size="10"') + T(297, 135, 'connect()', 'start', 'font-size="10" opacity=".7"');
  b += wire('508,82 508,191 337,191', 3) + arr(345, 191, 330, 191, 3) + T(514, 130, 'DISCONNECTED', 'start', 'font-size="10"') + T(514, 143, '(link lost)', 'start', 'font-size="10" opacity=".7"');
  b += T(265, 232, 'wait = 1 s, 2 s, 4 s ... capped at 30 s', 'middle', 'font-size="10" opacity=".8"');
  return svg(620, 245, b);
})();

const p8Arch = (() => {
  let b = box(15, 30, 140, 46, 'Wi-Fi driver task', 'radio, association')
    + box(215, 30, 180, 46, 'Event loop task', 'runs on_event()')
    + box(455, 22, 170, 30, 'CONNECTED_BIT')
    + box(455, 86, 170, 46, 'app_main, report task', 'block on the bit')
    + box(215, 116, 180, 46, 'esp_timer one-shot', 'retry_cb()')
    + box(215, 206, 180, 46, 'HTTP server task', 'root_get, status_get')
    + box(15, 206, 140, 46, 'Browser on your LAN', '');
  b += arr(155, 53, 215, 53, 1) + T(185, 46, 'events', 'middle', `font-size="10" fill="${col(1)}"`);
  b += arr(395, 42, 455, 38, 4) + T(425, 30, 'set / clear', 'middle', `font-size="10" fill="${col(4)}"`);
  b += arr(540, 52, 540, 86, 4);
  b += arr(305, 76, 305, 116, 3) + T(311, 100, 'start_once(wait)', 'start', `font-size="10" fill="${col(3)}"`);
  b += wire('215,139 85,139 85,84', 2) + arr(85, 90, 85, 76, 2) + T(150, 133, 'esp_wifi_connect()', 'middle', `font-size="10" fill="${col(2)}"`);
  b += arr(155, 222, 215, 222, 5) + T(185, 216, 'GET', 'middle', `font-size="10" fill="${col(5)}"`) + arr(215, 240, 155, 240, 5) + T(185, 256, 'JSON', 'middle', `font-size="10" fill="${col(5)}"`);
  b += T(410, 226, 'handlers run in the server’s task,', 'start', 'font-size="10" opacity=".75"') + T(410, 239, 'never in the event loop', 'start', 'font-size="10" opacity=".75"');
  return svg(640, 268, b);
})();

const p8 = {
  id: 'esp-p8', title: 'Project 8: Wi-Fi-connected embedded device', kind: 'Project', minutes: 180,
  summary: 'Join a Wi-Fi network in station mode with event handlers and backoff reconnect, serve a status page from the device, and report over HTTPS with certificate verification — with no credentials in the source code.',
  skills: ['esp-pb-wifi-sta', 'esp-pb-net-sec', 'esp-pb-debug-link'],
  objectives: [
    'Describe the ESP-IDF network start-up sequence and which task runs each piece of your code.',
    'Write Wi-Fi and IP event handlers that never block, and reconnect with exponential backoff.',
    'Serve a JSON endpoint and a small page with `esp_http_server`.',
    'Keep credentials out of the repository with Kconfig, and explain what that does and does not protect.',
    'Make an HTTPS request that verifies the server certificate, and explain what is lost if verification is turned off.',
    'Build bounded strings safely and treat every length that reaches a send call as a security boundary.',
  ],
  hardware: [
    'ESP32 DevKit and a USB cable (no external parts are needed)',
    'A 2.4 GHz Wi-Fi network you control, with WPA2 or WPA3 (the original ESP32 has no 5 GHz radio)',
    'A phone or PC on the same network, to open the status page',
    'A USB port or supply that can deliver the current peaks of Wi-Fi transmission (see troubleshooting)',
  ],
  software: [
    'ESP-IDF v6.1',
    'A web browser and `curl`',
    'gcc on your PC for the helper tests',
    'For the HTTPS step: an HTTPS endpoint you own or are permitted to post to',
  ],
  background: [
    `### The problem

A device that works on your desk meets a different world when it is deployed: the access point reboots at 3 a.m., the signal fades when a door closes, the password gets changed. A connected device is judged by what it does *then*. And the moment it has a radio, everything in its firmware — including any password you typed into the source — is exposed to people you have never met. This project is about both halves: staying connected, and not being the weak point of the network you joined.

### What "connecting" consists of

Wi-Fi station mode means the ESP32 acts as a client of an access point. Getting from reset to a usable IP address is a chain of steps, each of which can fail on its own:

1. The driver starts the radio (\`esp_wifi_start\`).
2. The station scans for the configured SSID and **associates** with the access point.
3. The WPA2/WPA3 **handshake** proves both sides know the passphrase and derives session keys.
4. A **DHCP** client asks the network for an IP address.

Only after step 4 can you open a socket. That is why the application waits for the *got IP* event and not for the *connected* event.

### Events, not return values

None of those steps completes inside the function call that starts it. \`esp_wifi_connect()\` returns immediately; the outcome arrives later as an **event** posted to the default event loop, a task that calls the handlers you registered. Three events carry the whole life cycle:

| Event | Meaning | What your handler does |
|---|---|---|
| \`WIFI_EVENT_STA_START\` | radio is up | call \`esp_wifi_connect()\` |
| \`IP_EVENT_STA_GOT_IP\` | DHCP finished | mark the network usable |
| \`WIFI_EVENT_STA_DISCONNECTED\` | join failed, or the link was lost | mark it unusable, schedule a retry |

The disconnected event covers both "wrong password" and "access point went away", and carries a reason code. The driver does **not** reconnect by itself; if your handler does nothing, the device stays offline for ever.`,
    { t: 'figure', svg: p8States, caption: 'Connection life cycle as a state machine. Every arrow is an event or a timer, never a delay inside a handler.' },
    { t: 'callout', kind: 'decision', title: 'Why backoff, and why a timer instead of a delay', md: `Retrying at once is right for a momentary drop and wrong for an outage: a thousand devices hammering an access point that is trying to boot keep it from recovering, and each failed attempt costs transmit power. Exponential backoff — 1 s, 2 s, 4 s, up to a cap — gives fast recovery from short faults and low load during long ones.

The wait must not happen inside the handler. All handlers share the one event loop task; a handler that sleeps for 30 s stops every other event in the system from being delivered for 30 s, including the got-IP event of a connection that succeeded. So the handler arms a one-shot timer and returns, and the timer's callback makes the next attempt.` },
    `### Credentials do not belong in source code

A passphrase in \`main.c\` ends up in version control, in every clone, in backups and in screenshots. Kconfig moves it out: you declare configuration items, set them with \`idf.py menuconfig\`, and the build generates a header with \`CONFIG_…\` macros. The values live in the file \`sdkconfig\`, which you keep out of the repository.

Be precise about what this achieves. It keeps the secret out of your *repository*. The secret is still compiled into the firmware image and sits in the flash chip as readable text; anyone who holds the device and can read its flash can recover it unless flash encryption is enabled. And a single passphrase built into every unit is a fleet-wide secret: extracting it from one device exposes the network for all. Real products provision each device individually at first use, and store what they are given in encrypted storage.`,
    { t: 'callout', kind: 'security', title: 'The rules for a device on a network', md: `- **Never ship default or shared credentials.** No \`admin/admin\`, no password printed in the manual, no key that is the same in every unit. Networks of compromised cameras and routers were built almost entirely from default passwords.
- **Use TLS and verify the peer.** Encryption without certificate verification stops passive eavesdropping only. Anyone who can redirect the connection can present their own certificate, and the device will hand over its data and accept whatever comes back.
- **Treat everything from the network as hostile input**: lengths, URLs, JSON, headers. Bound every buffer.
- **Expose as little as possible.** The status page in this project is plain HTTP with no login, which is acceptable only for read-only, non-sensitive data on a network you control. Anything that changes the device's behaviour needs authentication and TLS.
- **Do not log secrets.** A serial log is read by whoever has a USB cable.` },
    `### Two ways to move data

- **The device is a server** (\`esp_http_server\`): a browser on the same network fetches a page from it. Good for local configuration and diagnostics. It only works while the client can reach the device's address.
- **The device is a client** (\`esp_http_client\`): it makes outgoing requests to a server you run. This passes through home routers without any set-up and is how nearly all deployed devices report data.

You will build the first, then add the second with TLS.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Connections. This project is about architecture; the only wire is USB.', text: `
ESP32 DevKit        Connects to            Notes
------------        -------------------    ----------------------------------------------
USB                 PC                     power, flashing, serial monitor (UART0)
On-board antenna    2.4 GHz access point   keep metal, hands and the breadboard's power
                                           rails away from the antenna end of the module
(none)              GPIOs                  nothing required

If you add a sensor to report:
GPIO32-GPIO39       analog source          ADC1 only. ADC2 pins cannot be used while Wi-Fi
                                           is in use on the original ESP32.
` },
    { t: 'figure', svg: p8Arch, caption: 'Which task runs what. The event handler only sets a flag or arms a timer; anything that waits happens in a task of its own.' },
    { t: 'callout', kind: 'note', title: 'Adapting to other chips', md: `The code is the same on the ESP32-S3, ESP32-C3 and ESP32-C6; set the target with \`idf.py set-target\`. All of them are 2.4 GHz for Wi-Fi in the variants covered by this course's fact sheet. The ADC2-with-Wi-Fi restriction is chip-specific: check the ADC page for your chip before picking an analog pin.` },
  ],
  steps: [
    { title: 'Test the helpers on your PC', blocks: [
      `Two pieces of this project are plain arithmetic and string formatting. Test them where it is easy.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'net_util.h', code: String.raw`/* net_util.h - pure helpers for the Wi-Fi project. No ESP-IDF includes. */
#ifndef NET_UTIL_H
#define NET_UTIL_H

#include <stddef.h>
#include <stdint.h>

#define BACKOFF_FIRST_MS   1000u
#define BACKOFF_MAX_MS    30000u

/* Delay before reconnect attempt number attempt (0 = first retry). */
uint32_t backoff_ms(unsigned attempt);

/* Write the status JSON into out. Returns its length, or -1 if it did
 * not fit (out is then an empty string, never a truncated document). */
int status_json(char *out, size_t out_size,
                uint32_t uptime_s, uint32_t free_heap, int rssi_dbm);

#endif` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'net_util.c', code: String.raw`#include "net_util.h"
#include <inttypes.h>
#include <stdio.h>

uint32_t backoff_ms(unsigned attempt)
{
    uint32_t d = BACKOFF_FIRST_MS;
    while (attempt-- > 0 && d < BACKOFF_MAX_MS) d *= 2u;   /* 1 s, 2 s, 4 s ... */
    return d > BACKOFF_MAX_MS ? BACKOFF_MAX_MS : d;
}

int status_json(char *out, size_t out_size,
                uint32_t uptime_s, uint32_t free_heap, int rssi_dbm)
{
    if (out == NULL || out_size == 0) return -1;
    int n = snprintf(out, out_size,
                     "{\"uptime_s\":%" PRIu32 ",\"free_heap\":%" PRIu32 ",\"rssi_dbm\":%d}",
                     uptime_s, free_heap, rssi_dbm);
    if (n < 0 || (size_t)n >= out_size) {   /* snprintf reports the length it WANTED */
        out[0] = '\0';
        return -1;
    }
    return n;
}`, explain: [
        { lines: '5-10', md: 'Doubling stops as soon as the cap is reached, so a huge attempt count cannot overflow the 32-bit delay.' },
        { lines: '16-23', md: '`snprintf` never writes past `out_size`, but it returns the length the full text *would* have had. Comparing that return value with the buffer size is the only way to know the output is complete. A truncated JSON document is worse than none, so the function reports failure and leaves an empty string.' },
      ] },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'net_util_test.c — gcc -Wall -Wextra -std=c11 net_util.c net_util_test.c -o net_util_test && ./net_util_test', code: String.raw`/* Build: gcc -Wall -Wextra -std=c11 net_util.c net_util_test.c -o net_util_test */
#include "net_util.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void)
{
    assert(backoff_ms(0) == 1000 && backoff_ms(1) == 2000 && backoff_ms(4) == 16000);
    assert(backoff_ms(5) == 30000 && backoff_ms(1000000) == 30000);

    char buf[96];
    int n = status_json(buf, sizeof buf, 75, 201344, -61);
    assert(n == (int)strlen(buf));
    assert(strcmp(buf, "{\"uptime_s\":75,\"free_heap\":201344,\"rssi_dbm\":-61}") == 0);
    printf("%s\n", buf);

    char tiny[16];
    assert(status_json(tiny, sizeof tiny, 75, 201344, -61) == -1 && tiny[0] == '\0');
    assert(status_json(NULL, 0, 0, 0, 0) == -1);

    printf("net_util: all checks passed\n");
    return 0;
}` },
      `You should see the JSON line \`{"uptime_s":75,"free_heap":201344,"rssi_dbm":-61}\` and \`net_util: all checks passed\`.`,
    ] },
    { title: 'Declare the configuration and keep it out of the repository', blocks: [
      `Create \`main/Kconfig.projbuild\` (the file name matters; the build system looks for it):`,
      { t: 'code', lang: 'text', status: 'reviewed', caption: 'main/Kconfig.projbuild', code: String.raw`menu "Bench project 8"

    config BENCH_WIFI_SSID
        string "Wi-Fi SSID"
        default ""
        help
            Network name the device joins. Leave empty in the repository.

    config BENCH_WIFI_PASSWORD
        string "Wi-Fi password"
        default ""
        help
            WPA2/WPA3 passphrase. Stored in sdkconfig, which must not be committed.

    config BENCH_REPORT_URL
        string "HTTPS URL to POST readings to (optional)"
        default ""
        help
            Must start with https://. Leave empty to disable reporting.

endmenu` },
      `Add \`sdkconfig\` and \`sdkconfig.old\` to \`.gitignore\` **before** the next step. Then run \`idf.py menuconfig\`, open *Bench project 8*, and enter the SSID and passphrase of a network you control. Leave the report URL empty for now.

Check your work: \`grep BENCH sdkconfig\` should show your values, and \`git status\` should not list \`sdkconfig\`. Search the source tree for your passphrase; you should find it nowhere except \`sdkconfig\`.`,
      { t: 'predict', q: 'After building, is the passphrase present in the firmware binary in `build/`?', choices: [
        { t: 'Yes, as a plain string', ok: true, why: 'Kconfig values become C string literals in a generated header and are compiled into the image. Run `strings build/*.bin` and search for it after your first build. Keeping a secret out of git and keeping it out of the product are different problems.' },
        { t: 'No, Kconfig values are stored separately from the firmware', why: 'They are turned into `#define` lines in a generated header and compiled in like any other constant. Nothing stores them apart from the image.' },
        { t: 'Yes, but encrypted by the build system', why: 'The build does not encrypt anything by default. Flash encryption is a separate feature that must be enabled deliberately and protects the flash contents as a whole.' },
      ], reveal: 'You will verify this with `strings` in the testing section. It is the reason the background says a build-time passphrase is acceptable for a bench exercise and not for a product.' },
    ] },
    { title: 'Connect, with reconnect, and print the address', blocks: [
      CMAKE_NOTE({ srcs: '"main.c" "net_util.c"', req: 'esp_wifi esp_netif esp_event nvs_flash esp_http_server esp_timer' }),
      `This is the complete program for steps 3 to 5. Read \`on_event\` before flashing.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'main/main.c', code: String.raw`/* Project 8: Wi-Fi station with reconnect and a small status server. */
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "sdkconfig.h"
#include "net_util.h"

#define CONNECTED_BIT (1 << 0)

static const char *TAG = "p8";
static EventGroupHandle_t s_net_events;
static esp_timer_handle_t s_retry_timer;
static unsigned s_attempt;

static void retry_cb(void *arg)
{
    (void)arg;
    esp_wifi_connect();              /* returns at once; result arrives as an event */
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *d = data;
        uint32_t wait = backoff_ms(s_attempt++);
        xEventGroupClearBits(s_net_events, CONNECTED_BIT);
        ESP_LOGW(TAG, "disconnected, reason %d, retry in %u ms",
                 (int)d->reason, (unsigned)wait);
        /* Do NOT delay here: this runs in the event loop task. Arm a timer. */
        esp_timer_start_once(s_retry_timer, (uint64_t)wait * 1000u);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *e = data;
        ESP_LOGI(TAG, "got ip " IPSTR, IP2STR(&e->ip_info.ip));
        s_attempt = 0;
        xEventGroupSetBits(s_net_events, CONNECTED_BIT);
    }
}

static void wifi_start(void)
{
    s_net_events = xEventGroupCreate();

    const esp_timer_create_args_t targs = { .callback = retry_cb, .name = "wifi_retry" };
    ESP_ERROR_CHECK(esp_timer_create(&targs, &s_retry_timer));

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, NULL));

    wifi_config_t wc = { 0 };
    strlcpy((char *)wc.sta.ssid, CONFIG_BENCH_WIFI_SSID, sizeof wc.sta.ssid);
    strlcpy((char *)wc.sta.password, CONFIG_BENCH_WIFI_PASSWORD, sizeof wc.sta.password);
    wc.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;   /* refuse open, WEP and WPA1 */

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());                /* -> WIFI_EVENT_STA_START */
}

static esp_err_t status_get(httpd_req_t *req)
{
    char body[96];
    int rssi = 0;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) rssi = ap.rssi;

    int n = status_json(body, sizeof body,
                        (uint32_t)(esp_timer_get_time() / 1000000),
                        esp_get_free_heap_size(), rssi);
    if (n < 0) return httpd_resp_send_500(req);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, body, n);
}

static esp_err_t root_get(httpd_req_t *req)
{
    static const char page[] =
        "<!doctype html><meta charset=utf-8><title>Bench device</title>"
        "<h1>Bench device</h1><pre id=o>loading</pre>"
        "<script>setInterval(()=>fetch('/api/status').then(r=>r.text())"
        ".then(t=>o.textContent=t),2000)</script>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, page, HTTPD_RESP_USE_STRLEN);
}

static void http_start(void)
{
    httpd_handle_t server = NULL;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(httpd_start(&server, &cfg));

    static const httpd_uri_t root   = { .uri = "/",           .method = HTTP_GET, .handler = root_get };
    static const httpd_uri_t status = { .uri = "/api/status", .method = HTTP_GET, .handler = status_get };
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &root));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &status));
}

void app_main(void)
{
    if (strlen(CONFIG_BENCH_WIFI_SSID) == 0) {
        ESP_LOGE(TAG, "no SSID configured: run idf.py menuconfig -> Bench project 8");
        return;
    }

    /* The Wi-Fi driver keeps calibration data in NVS. */
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    wifi_start();
    xEventGroupWaitBits(s_net_events, CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
    http_start();
    ESP_LOGI(TAG, "status page is up");
}` },
      { t: 'predict', q: 'You flash with a deliberately wrong passphrase. Which events will the handler see, and what will the log show?', reveal: 'You should see `WIFI_EVENT_STA_START` handled silently, then a repeating `disconnected, reason N, retry in 1000 ms`, then 2000, 4000 … up to 30000 ms, and never `got ip`. The handshake fails, and that is reported as a disconnect with a reason code; there is no separate "wrong password" event. The reason codes are listed in the Wi-Fi driver documentation. Try it now, then correct the passphrase with `idf.py menuconfig`.' },
      `With the right passphrase you should see \`got ip 192.168.x.y\` (your network's range) within a few seconds, followed by \`status page is up\`.`,
    ] },
    { title: 'Open the status page', blocks: [
      `From a phone or PC on the same network, open \`http://<the address from the log>/\`. You should see a page titled *Bench device* whose text updates every two seconds.

From a terminal:

\`\`\`
curl -i http://<address>/api/status
\`\`\`

You should see \`HTTP/1.1 200 OK\`, a \`Content-Type: application/json\` header and a body like \`{"uptime_s":42,"free_heap":…,"rssi_dbm":-55}\`. Walk away from the access point with the board on a USB battery, or cup your hand around the antenna, and watch \`rssi_dbm\` fall: more negative means weaker.`,
      { t: 'callout', kind: 'security', title: 'What you have just exposed', md: `Any device on that network can now read this page: there is no login and no encryption. For uptime and signal strength that is tolerable on a network you control. It would not be for a door lock's state or a camera image, and it would never be acceptable for an endpoint that *changes* something. Before adding any control to this page, decide who is allowed to use it and how the device will know it is them.` },
    ] },
    { title: 'Break the connection and watch it recover', blocks: [
      `With the monitor open, switch the access point off (or disable its 2.4 GHz radio, or block the device in its admin page).`,
      { t: 'predict', q: 'The access point stays off for five minutes. Roughly how many reconnect attempts does the device make with this backoff, compared with retrying once a second?', choices: [
        { t: 'About 13 instead of about 300', ok: true, why: 'The waits are 1, 2, 4, 8 and 16 s (five attempts in the first 31 s), then 30 s each: the remaining 269 s hold eight more. Each attempt powers the transmitter and occupies air time, so this is a real saving in energy and in load on a recovering access point.' },
        { t: 'About 300 in both cases; backoff only changes the log', why: 'The delay is real time during which the radio is not attempting to join. Add up the waits for the first few attempts and see how quickly they pass a minute.' },
        { t: 'About 5, because it stops at the 30 s cap', why: 'The cap limits how long each wait can grow, it does not stop the retries. The device keeps trying every 30 s for as long as the outage lasts.' },
      ], reveal: 'You should see the retry interval double up to 30000 ms and stay there. Switch the access point back on: within one retry interval you should see `got ip` again, and the status page should respond. Note that `uptime_s` kept counting: the device did not reset to recover, and the HTTP server was never stopped.' },
    ] },
    { title: 'Report over HTTPS with certificate verification', blocks: [
      `Now the device becomes a client. Set *HTTPS URL to POST readings to* in menuconfig to an endpoint **you own or are permitted to use**, starting with \`https://\`. Add \`esp_http_client\` and \`mbedtls\` to \`PRIV_REQUIRES\` (the certificate bundle is part of the mbedtls component), then add this code.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'Additions to main.c', code: String.raw`/* Step 6: push a reading to your own HTTPS endpoint.
 * Extra includes: "esp_http_client.h" and "esp_crt_bundle.h". */
static esp_err_t report_post(const char *json, int len)
{
    esp_http_client_config_t cfg = {
        .url               = CONFIG_BENCH_REPORT_URL,     /* https://... */
        .method            = HTTP_METHOD_POST,
        .timeout_ms        = 8000,
        .crt_bundle_attach = esp_crt_bundle_attach,       /* verify the server's certificate */
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (c == NULL) return ESP_FAIL;

    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_post_field(c, json, len);

    esp_err_t err = esp_http_client_perform(c);           /* blocks: call from a task */
    if (err == ESP_OK)
        ESP_LOGI(TAG, "POST -> HTTP %d", esp_http_client_get_status_code(c));
    else
        ESP_LOGW(TAG, "POST failed: %s", esp_err_to_name(err));

    esp_http_client_cleanup(c);
    return err;
}

static void report_task(void *arg)
{
    (void)arg;
    char body[96];
    while (1) {
        xEventGroupWaitBits(s_net_events, CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
        int n = status_json(body, sizeof body,
                            (uint32_t)(esp_timer_get_time() / 1000000),
                            esp_get_free_heap_size(), 0);
        if (n > 0) report_post(body, n);
        vTaskDelay(pdMS_TO_TICKS(60 * 1000));
    }
}
/* In app_main, after http_start():
 *     if (strlen(CONFIG_BENCH_REPORT_URL) > 0)
 *         xTaskCreate(report_task, "report", 8192, NULL, 4, NULL);          */`, explain: [
        { lines: '5-10', md: '`crt_bundle_attach` gives the TLS layer a bundle of root certificates compiled into the firmware. During the handshake the server\'s certificate chain is checked against them and the host name in the URL is checked against the certificate. If either check fails, the connection is refused before any of your data is sent.' },
        { lines: '17', md: 'This call does everything: DNS lookup, TCP connect, TLS handshake, request, response. It can take seconds. It must run in a task that is allowed to wait, never in an event handler.' },
        { lines: '31-32', md: 'The task waits for the connected bit before each report, so an outage costs nothing: it simply sleeps until the network is back.' },
      ] },
      `You should see \`POST -> HTTP 200\` (or whatever status your endpoint returns) once a minute, and the request arriving at your server.

Then test that verification is real. Change the URL to an HTTPS host with a known-bad certificate that you control, such as a local server with a self-signed certificate, and rebuild. You should see \`POST failed\` with a TLS or connection error and **no** request arriving at that server. A device that still posts in this test is not verifying anything.`,
      { t: 'callout', kind: 'mistake', title: '"It only works if I turn verification off"', md: `When a TLS connection fails, the quick fix found in forum posts is to skip the certificate check. The connection then succeeds — with anyone. The actual causes are usually: the server uses a private or self-signed certificate (embed that certificate, or its root, in the firmware and point the client configuration at it), the root is not in the bundle, or certificate dates are being checked and the device does not know the time (run SNTP first). Check the ESP-TLS documentation for how validity dates are handled in your configuration. Fix the cause; verification is the property you were using TLS for.` },
    ] },
    { title: 'Debugging exercises', blocks: [
      { t: 'exercise', prompt: `**Exercise A.** A device takes over a minute to notice it is back online after a short Wi-Fi drop, and during that time other parts of the firmware that use the default event loop also stop responding. The handler is below. What is wrong, and what should it do instead?`, code: String.raw`static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "lost Wi-Fi, waiting before retry");
        vTaskDelay(pdMS_TO_TICKS(30000));
        esp_wifi_connect();
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        xEventGroupSetBits(s_net_events, CONNECTED_BIT);
    }
}`, hints: ['Which task is executing this function?', 'How many handlers can that task run at the same time?', 'What can wait for 30 s without holding a task hostage?'], answer: { type: 'text', accept: ['block', 'delay', 'event loop', 'timer', 'sleep'], nudge: 'Think about which task runs handlers and what it cannot do while this one is sleeping.' }, solution: `The handler sleeps for 30 s **in the event loop task**. That task delivers every event posted to the default loop, one at a time; while it sleeps, nothing is delivered. Events queue up, and if the queue fills, posts start to fail. A handler must return quickly: record the fact, then hand the waiting to something else. Here that is a one-shot \`esp_timer\` armed with the backoff delay whose callback calls \`esp_wifi_connect()\`, as in the project code; a dedicated task waiting on a queue would also do.` },
      { t: 'exercise', prompt: `**Exercise B.** A security review flags this status handler as an information leak, although the developer points out that \`snprintf\` "can't overflow". The device name is set by the user and can be up to 64 characters. Explain the leak.`, code: String.raw`static esp_err_t status_get(httpd_req_t *req)
{
    char body[48];
    int n = snprintf(body, sizeof body,
                     "{\"name\":\"%s\",\"uptime_s\":%u}", device_name, uptime_s());
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body, n);
}`, hints: ['What does `snprintf` return when the text does not fit?', 'How many bytes does `httpd_resp_send` transmit, and from where?'], answer: { type: 'text', accept: ['return', 'truncat', 'over-?read', 'past', 'beyond', 'length', 'stack'], nudge: 'Compare the number `snprintf` returns with the number of bytes it actually wrote.' }, solution: `\`snprintf\` writes at most 48 bytes but **returns the length the full text would have had**. With a long name \`n\` is, say, 90. \`httpd_resp_send(req, body, 90)\` then transmits 90 bytes starting at \`body\`: the 48 bytes of the buffer and 42 bytes of whatever lies above it on the stack — saved registers, return addresses, pieces of other variables. This is an over-read, the same class of bug as Heartbleed, and return addresses leaked this way help an attacker defeat other protections. The fix is in \`status_json\`: check \`n < 0 || n >= sizeof body\` and send an error instead. The developer was right that nothing was overwritten, and wrong that this makes the code safe.` },
      { t: 'exercise', prompt: `**Exercise C.** A soil-moisture probe on GPIO25 worked in project 4. After Wi-Fi was added, \`adc_oneshot_read\` returns an error or a timeout on most calls, and works again whenever Wi-Fi is not started. Nothing is wrong with the probe. What is the cause and the fix?`, hints: ['Which ADC unit does GPIO25 belong to on the original ESP32?', 'What else uses that unit?'], answer: { type: 'text', accept: ['adc\\s*2', 'adc1', 'gpio\\s*3[2-9]'], nudge: 'Look up which ADC unit the pin is on.' }, solution: `On the original ESP32, GPIO25 is an **ADC2** input, and ADC2 is also used by the Wi-Fi driver; the pins cannot be used for conversions while Wi-Fi is in use. Move the probe to an **ADC1** pin (GPIO32 to GPIO39) and change the unit and channel in the code. Since several of those pins are input-only, that suits a sensor. This is a pin-budget error: the conflict is visible on paper before any wire is placed, which is why project 10 starts with a pin table.` },
    ] },
  ],
  walkthrough: [
    `### Start-up order, and what each call creates

**\`nvs_flash_init()\`** mounts the non-volatile storage partition. The Wi-Fi driver keeps radio calibration data there; without it, \`esp_wifi_init\` fails. The erase-and-retry branch handles a partition that is full or was written by an incompatible version.

**\`esp_netif_init()\`** starts the TCP/IP stack, which runs in its own task. **\`esp_event_loop_create_default()\`** creates the default event loop: a queue and a task that takes events off it and calls the registered handlers. **\`esp_netif_create_default_wifi_sta()\`** creates the network interface object that glues the Wi-Fi driver to the IP stack and owns the DHCP client.

**\`esp_wifi_init(&init)\`** allocates the driver's buffers and starts the Wi-Fi task. The radio is still off. **\`esp_wifi_set_config\`** stores the SSID, passphrase and the minimum security level; \`threshold.authmode = WIFI_AUTH_WPA2_PSK\` makes the station ignore any access point offering only open, WEP or WPA1 security, so someone who sets up a fake open network with the same name does not get your device to join it. **\`esp_wifi_start()\`** powers the radio and causes \`WIFI_EVENT_STA_START\`.

### Three tasks, one flag

After start-up your code runs in four places, and it matters which is which:

- **The event loop task** runs \`on_event\`. It may set flags, post to queues, arm timers. It must not wait.
- **The esp_timer task** runs \`retry_cb\`. Same rule: short, non-blocking. \`esp_wifi_connect()\` only asks the Wi-Fi task to start and returns.
- **The HTTP server task** runs \`root_get\` and \`status_get\`. These may take a little time, but while one runs no other request is served.
- **Your own tasks** (\`app_main\`, \`report_task\`) are the only places where long waits belong.

They are coordinated by a single bit in an **event group**. \`xEventGroupWaitBits\` blocks a task, using no CPU, until the bit is set. The handler sets the bit on got-IP and clears it on disconnect. \`s_attempt\` is touched only by the event loop task, so it needs no lock.

### An HTTP request, end to end

\`httpd_start\` opens a listening TCP socket on port 80 and starts the server task. When a browser connects, the server parses the request line, finds the handler whose URI and method match, and calls it. \`status_get\` gathers three numbers — \`esp_timer_get_time()\` is a 64-bit microsecond counter driven by a hardware timer; \`esp_get_free_heap_size()\` asks the allocator; \`esp_wifi_sta_get_ap_info\` reads the signal strength the radio measured — formats them into a buffer on the server task's stack, and \`httpd_resp_send\` writes the status line, the headers and the body to the socket. The \`Cache-Control: no-store\` header stops a browser from showing a stale reading.

### What TLS adds to the POST

Before the HTTP request, the client and server perform a handshake. The server sends a certificate chain; the client checks that the chain leads to a root it already trusts (the bundle), that the certificate names the host it meant to reach, and that the server holds the private key matching the certificate. Only then are session keys agreed and the request sent, encrypted and integrity-protected. The handshake needs tens of kilobytes of heap and a deep stack, which is why \`report_task\` is given 8192 bytes; measure the real requirement with the stack high-water mark from project 9.`,
  ],
  testing: [
    `| Test | How | You should see |
|---|---|---|
| Helpers | \`./net_util_test\` on the PC | \`net_util: all checks passed\` |
| No credentials in source | Search the repository for your passphrase; \`git status\` | Found only in \`sdkconfig\`, which git ignores |
| Secret is in the binary | \`strings build/*.bin\` piped to a search for your SSID | It is there. Write down what an attacker with the device could do with it |
| Empty SSID | Clear the SSID in menuconfig, rebuild | \`no SSID configured\` and no crash |
| Wrong passphrase | Set a wrong one | Repeating \`disconnected, reason …\` with intervals 1000, 2000, 4000 … 30000 ms |
| Join | Correct passphrase | \`got ip a.b.c.d\` then \`status page is up\` |
| JSON endpoint | \`curl -i http://a.b.c.d/api/status\` | \`200 OK\`, \`application/json\`, well-formed JSON |
| Unknown path | \`curl -i http://a.b.c.d/nope\` | \`404\` |
| Outage | Access point off for 2 minutes, then on | Backoff in the log; \`got ip\` again; page answers; \`uptime_s\` did not restart |
| Many requests | \`for i in $(seq 200); do curl -s http://a.b.c.d/api/status > /dev/null; done\` then read \`free_heap\` | \`free_heap\` returns to about the value it had before: no leak per request |
| TLS accepts a good server | POST to your endpoint | \`POST -> HTTP 2xx\` and the request in your server's log |
| TLS rejects a bad server | Point the URL at a host with an untrusted certificate | \`POST failed\` and nothing in that server's log |`,
    { t: 'callout', kind: 'note', title: 'Measuring instead of believing', md: `Two of these tests measure something that cannot be seen by "it works": the heap test catches a leak that would take a deployed device down after days, and the bad-certificate test is the only evidence that verification is on. If you have a second computer, capture the device's traffic on your own network with Wireshark: you should be able to read the status page's HTTP in clear text, and see only a TLS handshake and encrypted records for the POST.` },
  ],
  troubleshooting: [
    { symptom: 'Resets or `Brownout detector was triggered` when Wi-Fi starts', cause: 'The supply cannot deliver the transmit current peaks: weak USB port, long thin cable, or a hub', fix: 'Use a short cable on a port that can supply the current; power the board from a proper 5 V supply. Check the peak figure in the module datasheet\'s power consumption table.' },
    { symptom: 'Endless `disconnected` with the same reason code', cause: 'Wrong passphrase, SSID misspelt (it is case-sensitive), a 5 GHz-only network, or the access point offers only security below the configured threshold', fix: 'Look the reason code up in the Wi-Fi documentation. Confirm the network is 2.4 GHz and WPA2 or WPA3.' },
    { symptom: 'Connects, but never logs `got ip`', cause: 'DHCP is not answering: address pool exhausted, MAC filtering, or a guest network that isolates clients', fix: 'Check the access point\'s client list and DHCP settings.' },
    { symptom: 'Device has an IP but the page does not open', cause: 'Client isolation on the access point, the phone is on mobile data or another network, or the browser forced `https://`', fix: 'Ping the address from a PC on the same network. Type `http://` explicitly.' },
    { symptom: 'ADC readings fail once Wi-Fi is started', cause: 'The pin is on ADC2, which the Wi-Fi driver uses on the original ESP32', fix: 'Move the signal to an ADC1 pin (GPIO32–39).' },
    { symptom: 'HTTPS POST fails with a certificate or handshake error', cause: 'Root not in the bundle, private or self-signed server certificate, wrong host name in the URL, or date checks without a valid clock', fix: 'Embed the right root certificate, fix the URL, or set the time by SNTP first. Do not disable verification.' },
    { symptom: 'Stack overflow panic in the task that does the POST', cause: 'TLS handshakes need far more stack than ordinary code', fix: 'Raise the task\'s stack size, then measure the high-water mark and trim.' },
    { symptom: 'Device goes offline after hours and never returns', cause: 'A blocking call inside an event handler, a handler that ignores the disconnected event, or a retry timer that is not re-armed', fix: 'Review every handler for calls that wait. Test with a deliberate five-minute access point outage.' },
  ],
  challenge: `Remove the build-time passphrase altogether by adding **provisioning**.

- On first boot, or when a button is held during reset, the device has no credentials. Design how it receives them. One common approach is to start a temporary access point with a setup page; ESP-IDF also provides a provisioning component. Read the options and pick one.
- Store the credentials in NVS, not in the image. Add a factory-reset action that erases them.
- The setup mode itself must not be a hole. Write down: who can reach the setup page, for how long, what stops a neighbour from configuring your device before you do, and whether the passphrase crosses the air unencrypted during setup.
- Each device's setup secret must differ from every other device's. Decide where it comes from.
- Use the threat-model worksheet in the Workbench to list assets, adversaries and entry points for this device, and state which threats you accept and why.

No solution is given. A good answer includes the threat model, the state machine of the provisioning flow, and a test for each way the flow can be interrupted.`,
  quiz: [
    { kind: 'arch', q: 'Why does the application wait for `IP_EVENT_STA_GOT_IP` before starting its network work, and not for the Wi-Fi connected event?', choices: [
      { t: 'Association and the WPA handshake give a link, but sockets need an IP address, which arrives only when DHCP completes', ok: true, why: 'They are different layers. A station can be associated for a long time with no address if DHCP fails, and any socket call in that window fails.' },
      { t: 'The connected event is never delivered in station mode', why: 'It is delivered. It simply marks an earlier stage than the one the application needs.' },
      { t: 'Because the got-IP event carries the passphrase check result', why: 'The passphrase is checked during the WPA handshake, before DHCP starts. A failure there shows up as a disconnect with a reason code.' },
    ] },
    { kind: 'code', q: 'A handler for `WIFI_EVENT_STA_DISCONNECTED` calls `vTaskDelay(pdMS_TO_TICKS(10000))` and then `esp_wifi_connect()`. What is the system-level effect?', choices: [
      { t: 'No event of any kind is delivered from the default loop for 10 s, because all handlers share one task', ok: true, why: 'The handler runs in the event loop task. Sleeping there stalls the delivery of every queued event, not just Wi-Fi ones.' },
      { t: 'Only this handler is delayed; other handlers run in parallel', why: 'Handlers on one event loop are called one after another by a single task. There is no parallelism to fall back on.' },
      { t: 'The delay is ignored inside handlers', why: '`vTaskDelay` works in any task context, including the event loop task. That is exactly why it is harmful here.' },
    ] },
    { kind: 'security', q: 'A team stores the Wi-Fi passphrase with Kconfig and excludes `sdkconfig` from git. Which statement about the shipped product is true?', choices: [
      { t: 'The passphrase is in every device\'s flash as plain text unless flash encryption is enabled, and it is the same in every unit', ok: true, why: 'Kconfig solved the repository problem only. Physical access to one device reveals a secret shared by the fleet.' },
      { t: 'The passphrase cannot be recovered from a device because it is not in the source code', why: 'The compiled image contains the string. Where the value was typed has no effect on where it ends up.' },
      { t: 'The passphrase is protected because firmware binaries are not human-readable', why: 'A tool such as `strings` lists every text literal in a binary in seconds. Unreadable to a person is not the same as protected.' },
    ] },
    { kind: 'security', q: 'An HTTPS client is configured to skip server certificate verification because "the data is encrypted anyway". What can an attacker who controls the local network do?', choices: [
      { t: 'Answer the connection themselves with any certificate, then read and alter everything in both directions', ok: true, why: 'Encryption protects the channel to whoever is at the other end. Without verification the device cannot tell the real server from an impostor, so the attacker simply becomes the other end.' },
      { t: 'Nothing, because the traffic is still encrypted with TLS', why: 'It is encrypted — to the attacker, if the attacker is who the device completed the handshake with. Think about who chose the key.' },
      { t: 'Only see the size and timing of messages', why: 'That is what a passive observer of a properly verified connection learns. An active attacker facing no verification gets far more.' },
    ] },
    { kind: 'code', q: '`char b[32]; int n = snprintf(b, sizeof b, "%s", s);` and `s` is 50 characters long. What are the contents of `b` and the value of `n`?', choices: [
      { t: '`b` holds the first 31 characters and a terminator; `n` is 50', ok: true, why: '`snprintf` truncates safely but reports the untruncated length, so that the caller can detect truncation. Using `n` as a byte count for sending reads past the buffer.' },
      { t: '`b` holds the first 31 characters and a terminator; `n` is 31', why: 'That would make truncation undetectable. The return value is defined as the length that was needed, and it must be compared with the buffer size.' },
      { t: '`b` overflows by 18 bytes; `n` is 50', why: 'The size argument is the whole point of the `n` variant: it never writes past it. The hazard lies in how the return value is used afterwards.' },
    ] },
    { kind: 'concept', q: 'Why is exponential backoff with a cap better than a fixed 1 s retry for a fleet of devices?', choices: [
      { t: 'Short outages still recover quickly, while long outages cause few attempts, saving energy and letting the access point recover', ok: true, why: 'The first retries are fast; later ones are spaced out. The cap keeps the worst-case recovery delay bounded.' },
      { t: 'It guarantees that a device reconnects within one second', why: 'After several failures the wait is up to the cap, 30 s here. Backoff trades worst-case recovery time for lower load.' },
      { t: 'It makes the Wi-Fi handshake itself faster', why: 'The handshake takes the time it takes. Backoff only decides how long to wait between attempts.' },
    ] },
  ],
};


// ───────────────────────────── Project 9: FreeRTOS application ─────────────────────────────
const p9Figure = (() => {
  let b = box(10, 40, 100, 44, 'ADC1 ch 6', 'GPIO34, pot')
    + box(150, 34, 130, 56, 'sensor_task', 'prio 6, every 100 ms')
    + box(460, 34, 130, 56, 'process_task', 'prio 5, filter')
    + box(460, 150, 130, 50, 's_stats', 'guarded by mutex')
    + box(150, 147, 130, 56, 'report_task', 'prio 4')
    + box(10, 153, 100, 44, 'UART0 log', '')
    + box(10, 250, 100, 40, 'Button', 'GPIO27')
    + box(150, 250, 130, 40, 'button_isr', 'GPIO interrupt');
  // queue cells
  for (let i = 0; i < 6; i++) b += `<rect x="${316 + i * 18}" y="50" width="18" height="24" fill="var(--surface)" stroke="${col(1)}" stroke-width="1.5"/>`;
  b += T(370, 42, 's_samples (queue, 8)', 'middle', `font-size="10" fill="${col(1)}"`) + T(370, 90, 'sample_t by value', 'middle', 'font-size="10" opacity=".7"');
  b += arr(110, 62, 150, 62) + arr(280, 62, 316, 62, 1) + arr(424, 62, 460, 62, 1);
  b += arr(525, 90, 525, 150, 3) + T(531, 124, 'take, update, give', 'start', `font-size="10" fill="${col(3)}"`);
  b += arr(460, 175, 280, 175, 3) + T(370, 168, 'take, copy, give', 'middle', `font-size="10" fill="${col(3)}"`);
  b += arr(150, 175, 110, 175);
  b += arr(110, 270, 150, 270) + arr(215, 250, 215, 203, 4);
  b += `<circle cx="215" cy="226" r="9" fill="var(--surface)" stroke="${col(4)}" stroke-width="1.8"/>` + T(230, 230, 's_button (binary semaphore)', 'start', `font-size="10" fill="${col(4)}"`);
  b += T(215, 20, 'feeds task watchdog', 'middle', 'font-size="10" opacity=".75"') + T(525, 20, 'feeds task watchdog', 'middle', 'font-size="10" opacity=".75"');
  b += T(330, 286, 'Data moves by copy through the queue; only s_stats is shared, and only under the mutex.', 'start', 'font-size="10" opacity=".75"');
  return svg(760, 300, b);
})();

const p9 = {
  id: 'esp-p9', title: 'Project 9: FreeRTOS multitasking application', kind: 'Project', minutes: 210,
  summary: 'Split a measurement application into three tasks joined by a queue, wake a task from a button interrupt with a semaphore, protect shared data with a mutex, and instrument it with stack high-water marks and the task watchdog.',
  skills: ['esp-pb-rtos-pipeline', 'esp-pb-rtos-health', 'esp-pb-debug-link'],
  objectives: [
    'Decide how to divide work into tasks and assign priorities from deadlines, not from importance.',
    'Pass data between tasks by value through a queue and explain why that removes most sharing problems.',
    'Signal a task from an interrupt with the `FromISR` API and explain why the ordinary API must not be used there.',
    'Protect a shared structure with a mutex, keep the locked region short, and say what priority inheritance does.',
    'Measure each task\'s stack headroom and size stacks from measurements.',
    'Use the task watchdog to turn a silent hang into a diagnosable reset.',
  ],
  hardware: [
    'ESP32 DevKit and a USB cable',
    '10 kΩ potentiometer (any value from 1 kΩ to 100 kΩ works) as the "sensor"',
    'Push button',
    'Breadboard and jumper wires',
    'Optional: logic analyser, to time the button-to-response latency',
  ],
  software: [
    'ESP-IDF v6.1',
    'gcc on your PC for the filter test',
  ],
  background: [
    `### The problem

A device samples a sensor ten times a second, filters the data, prints a report every two seconds and must react to a button at once. Written as one loop, each job waits for the others: while the report is being printed, samples are late; while the loop sleeps until the next sample, the button is ignored. You can patch this with flags and timestamps, and for three jobs it is manageable. For ten it is the main source of bugs.

An RTOS lets you write each job as its own loop — a **task** — that blocks when it has nothing to do. The scheduler always runs the highest-priority task that is ready. The cost is that tasks now interleave, and anything they share needs a rule.

### Four tools and what each is for

| Tool | Carries | Use it when |
|---|---|---|
| **Queue** | copies of data, in order | one task produces values another consumes |
| **Binary semaphore** | "something happened", no data | an interrupt or task must wake another task |
| **Mutex** | ownership of a resource | two tasks must not use a thing at the same moment |
| **Task notification** | a wake-up or a small value to one specific task | a lighter replacement for a semaphore when there is one known receiver |

A semaphore and a mutex look alike in code and are not interchangeable. A mutex has an **owner**: only the task that took it may give it, and while a low-priority task holds it, the kernel temporarily raises that task to the priority of the highest task waiting (**priority inheritance**), so a medium-priority task cannot keep a high-priority one waiting indefinitely. A binary semaphore has no owner, which is why an interrupt can give it — and why it must not be used to guard data.

### Priorities are about deadlines

The sampler has the tightest timing requirement: 100 ms periods with little jitter. Printing a report can be a few hundred milliseconds late and nobody notices. So the sampler gets the highest priority and the reporter the lowest of the three, even though the report is what the user sees. A high-priority task must block most of the time; if it never blocks, nothing below it ever runs.`,
    { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'preemptive' }, caption: 'Change priorities and periods and watch who runs. Give the busiest task the highest priority and see what happens to the others.' },
    `### Interrupts are not tasks

An interrupt service routine (ISR) runs outside the scheduler, above every task. It cannot block, because there is no task to put to sleep. That gives two rules:

1. An ISR does the minimum — capture the event — and **defers** the real work to a task.
2. An ISR may only call the kernel functions whose names end in \`FromISR\`. They never block, and they report through a flag whether they made a higher-priority task ready, so that the scheduler can switch to it as the ISR returns.`,
    { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'isr-defer' }, caption: 'An interrupt gives a semaphore; the waiting task runs as soon as the ISR returns.' },
    `### Stacks are finite, and you choose their size

Every task has its own stack, allocated when it is created, for its local variables, call chain and saved registers. Too small and the task writes beyond it, corrupting whatever lies next in memory; the symptoms appear somewhere else, later. Too large and you waste RAM that ten tasks multiply. The kernel records the lowest amount of free stack each task has ever had — the **high-water mark** — so you can size stacks from measurements instead of guesses.

### A watchdog for tasks

A hung task is silent: the rest of the system carries on and the device looks alive. The ESP-IDF **task watchdog** (TWDT) is a timer that each subscribed task must reset regularly. If one does not within the timeout, the watchdog prints which task failed and, if configured, resets the chip. A reset that names the culprit is far better than a device that quietly stops measuring.`,
    { t: 'callout', kind: 'decision', title: 'Why a queue between sensor and processing instead of a shared variable', md: `A shared "latest sample" variable with a mutex would work for one value. A queue is better here for three reasons. It **decouples timing**: the sampler never waits for the filter, and short bursts are absorbed. It **keeps order and count**: every sample is processed once, or its loss is detected because the send fails. And it **copies**: after the send, the sampler and the processor hold separate copies, so there is nothing to lock. The mutex is kept for the one thing that really is shared state read by a different task at its own pace: the statistics.` },
  ],
  diagram: [
    { t: 'ascii', caption: 'Pin-by-pin wiring.', text: `
ESP32 DevKit        Part                    Notes
------------        --------------------    ----------------------------------------------
3V3                 Potentiometer end 1     never 5 V: the ADC input must stay within 0..3.3 V
GND                 Potentiometer end 2
GPIO34 (ADC1 ch 6)  Potentiometer wiper     input-only pin, on ADC1 so it also works with Wi-Fi
GPIO27              Button, one side        internal pull-up enabled in firmware
GND                 Button, other side      pressed = low, falling edge triggers the interrupt

Optional logic analyser
CH0                 GPIO27 (button)
CH1                 a spare GPIO you toggle at the top of report_task, to time the response
GND                 GND
` },
    { t: 'figure', svg: p9Figure, caption: 'Tasks, the queue between them, the mutex-guarded statistics and the interrupt path. Arrows show the direction data or a signal travels.' },
    { t: 'callout', kind: 'note', title: 'Adapting to other chips', md: `ADC channel numbers map to different GPIOs on each chip: on the ESP32-C3, ADC1 is on GPIO0 to GPIO4. Use \`adc_oneshot_io_to_channel()\` to look up the unit and channel for a GPIO, and change \`PIN_BUTTON\` to a free non-strapping pin. The original ESP32 and the S3 have two cores and the C3 and C6 one; with two cores, two tasks really can run at the same instant, which makes every sharing rule in this project matter more, not less.` },
  ],
  steps: [
    { title: 'Test the filter on your PC', blocks: [
      `The moving average is the only arithmetic in the project, so it is separated out and tested first.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'movavg.h', code: String.raw`/* movavg.h - fixed-size moving average over the last MOVAVG_N samples.
 * Integer only, O(1) per sample, no ESP-IDF includes. */
#ifndef MOVAVG_H
#define MOVAVG_H

#include <stdint.h>

#define MOVAVG_N 8u

typedef struct {
    int32_t  buf[MOVAVG_N];
    int32_t  sum;
    uint32_t head;    /* index of the oldest sample = next slot to overwrite */
    uint32_t count;   /* how many slots hold real data (<= MOVAVG_N)         */
} movavg_t;

void    movavg_init(movavg_t *m);
int32_t movavg_push(movavg_t *m, int32_t sample);   /* returns the new average */

#endif` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'movavg.c', code: String.raw`#include "movavg.h"
#include <string.h>

void movavg_init(movavg_t *m) { memset(m, 0, sizeof *m); }

int32_t movavg_push(movavg_t *m, int32_t sample)
{
    if (m->count == MOVAVG_N)
        m->sum -= m->buf[m->head];      /* the oldest sample leaves the window */
    else
        m->count++;
    m->buf[m->head] = sample;
    m->sum += sample;
    m->head = (m->head + 1u) % MOVAVG_N;
    return m->sum / (int32_t)m->count;  /* average of what we have so far */
}`, explain: [
        { lines: '8-11', md: 'A running sum makes each update O(1): subtract the sample that leaves the window, add the one that enters. Until the window is full there is nothing to subtract, and the divisor is the number of real samples so start-up values are not dragged toward zero.' },
        { lines: '14', md: '`head` wraps around the fixed array: a ring buffer. No memory moves and no allocation happens, so the function takes the same time on every call.' },
      ] },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'movavg_test.c — gcc -Wall -Wextra -std=c11 movavg.c movavg_test.c -o movavg_test && ./movavg_test', code: String.raw`/* Build: gcc -Wall -Wextra -std=c11 movavg.c movavg_test.c -o movavg_test */
#include "movavg.h"
#include <assert.h>
#include <stdio.h>

int main(void)
{
    movavg_t m;
    movavg_init(&m);
    assert(movavg_push(&m, 100) == 100);          /* one sample: no dilution by zeros */
    assert(movavg_push(&m, 200) == 150);
    for (int i = 0; i < 6; i++) movavg_push(&m, 200);
    assert(m.count == MOVAVG_N && m.sum == 100 + 7 * 200);
    assert(movavg_push(&m, 200) == 200);          /* the 100 has left the window */

    /* A step from 0 to 4095 takes exactly MOVAVG_N samples to settle. */
    movavg_init(&m);
    for (unsigned i = 0; i < MOVAVG_N; i++) movavg_push(&m, 0);
    int steps = 0;
    while (movavg_push(&m, 4095) != 4095) steps++;
    assert(steps == (int)MOVAVG_N - 1);

    /* Long run: the running sum never drifts from a recomputed sum. */
    uint32_t x = 12345;
    for (int i = 0; i < 100000; i++) {
        x = x * 1664525u + 1013904223u;
        movavg_push(&m, (int32_t)(x >> 20));      /* 0..4095 like a 12-bit ADC */
    }
    int32_t check = 0;
    for (unsigned i = 0; i < MOVAVG_N; i++) check += m.buf[i];
    assert(check == m.sum);

    printf("movavg: all checks passed\n");
    return 0;
}` },
      `You should see \`movavg: all checks passed\`. The last test pushes 100 000 pseudo-random samples and then recomputes the sum from the buffer: a running sum is exactly where an off-by-one would accumulate, so it is checked against a recomputed sum.`,
    ] },
    { title: 'Wire the potentiometer and the button', md: `Wire the circuit from the table. Before flashing anything, measure the wiper with a multimeter against ground while turning the knob. You should see the voltage sweep smoothly between 0 V and about 3.3 V. If it reaches 5 V, an end of the potentiometer is on the wrong rail; fix that before connecting it to GPIO34.` },
    { title: 'Build and run the three tasks', blocks: [
      CMAKE_NOTE({ srcs: '"main.c" "movavg.c"', req: 'esp_adc esp_driver_gpio esp_system' }),
      `If the build cannot find \`esp_task_wdt.h\`, look up that header's component in the watchdog documentation and add it to \`PRIV_REQUIRES\`.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'main/main.c', code: String.raw`/* Project 9: three tasks, a queue, a mutex, an ISR-given semaphore,
 * stack monitoring and the task watchdog. */
#include <limits.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_attr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "movavg.h"

#define PIN_BUTTON   27               /* to GND when pressed; internal pull-up */
#define ADC_CH       ADC_CHANNEL_6    /* ADC1 channel 6 = GPIO34 on the original ESP32 */
#define SAMPLE_MS    100

typedef struct {
    uint32_t t_ms;
    int      raw;
} sample_t;

typedef struct {
    int      last, avg, min, max;
    uint32_t count;
    uint32_t dropped;
} stats_t;

static const char *TAG = "p9";
static QueueHandle_t     s_samples;       /* sensor -> process, holds sample_t by value */
static SemaphoreHandle_t s_button;        /* binary: given by the ISR */
static SemaphoreHandle_t s_stats_lock;    /* mutex: guards s_stats */
static stats_t           s_stats = { .min = INT_MAX, .max = INT_MIN };
static TaskHandle_t      s_h_sensor, s_h_process, s_h_report;
static adc_oneshot_unit_handle_t s_adc;

static void IRAM_ATTR button_isr(void *arg)
{
    (void)arg;
    BaseType_t woke = pdFALSE;
    xSemaphoreGiveFromISR(s_button, &woke);
    if (woke) portYIELD_FROM_ISR();       /* run the waiting task right after the ISR */
}

static void sensor_task(void *arg)
{
    (void)arg;
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    TickType_t next = xTaskGetTickCount();
    while (1) {
        sample_t s = { .t_ms = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS) };
        if (adc_oneshot_read(s_adc, ADC_CH, &s.raw) == ESP_OK) {
            if (xQueueSend(s_samples, &s, 0) != pdTRUE) {      /* full: drop, do not wait */
                xSemaphoreTake(s_stats_lock, portMAX_DELAY);
                s_stats.dropped++;
                xSemaphoreGive(s_stats_lock);
            }
        }
        esp_task_wdt_reset();
        vTaskDelayUntil(&next, pdMS_TO_TICKS(SAMPLE_MS));      /* fixed period, no drift */
    }
}

static void process_task(void *arg)
{
    (void)arg;
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    movavg_t filter;
    movavg_init(&filter);
    sample_t s;
    while (1) {
        if (xQueueReceive(s_samples, &s, pdMS_TO_TICKS(1000)) == pdTRUE) {
            int avg = (int)movavg_push(&filter, s.raw);        /* work OUTSIDE the lock */
            xSemaphoreTake(s_stats_lock, portMAX_DELAY);
            s_stats.last = s.raw;
            s_stats.avg  = avg;
            if (s.raw < s_stats.min) s_stats.min = s.raw;
            if (s.raw > s_stats.max) s_stats.max = s.raw;
            s_stats.count++;
            xSemaphoreGive(s_stats_lock);
        } else {
            ESP_LOGW(TAG, "no samples for 1 s");
        }
        esp_task_wdt_reset();
    }
}

static void report_task(void *arg)
{
    (void)arg;
    TickType_t last_press = 0;
    while (1) {
        /* Wake on a button press, or every 2 s to print anyway. */
        BaseType_t pressed = xSemaphoreTake(s_button, pdMS_TO_TICKS(2000));
        TickType_t now = xTaskGetTickCount();
        if (pressed == pdTRUE && (now - last_press) < pdMS_TO_TICKS(200))
            continue;                                          /* contact bounce */

        stats_t snap;
        xSemaphoreTake(s_stats_lock, portMAX_DELAY);
        if (pressed == pdTRUE) {
            last_press = now;
            s_stats.min = INT_MAX;
            s_stats.max = INT_MIN;
        }
        snap = s_stats;                                        /* copy, then release */
        xSemaphoreGive(s_stats_lock);

        ESP_LOGI(TAG, "%s last=%d avg=%d min=%d max=%d n=%u dropped=%u",
                 pressed == pdTRUE ? "[reset]" : "[tick] ",
                 snap.last, snap.avg, snap.min, snap.max,
                 (unsigned)snap.count, (unsigned)snap.dropped);
        ESP_LOGI(TAG, "stack free (bytes): sensor=%u process=%u report=%u",
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_sensor),
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_process),
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
    }
}

void app_main(void)
{
    s_samples    = xQueueCreate(8, sizeof(sample_t));
    s_button     = xSemaphoreCreateBinary();
    s_stats_lock = xSemaphoreCreateMutex();
    configASSERT(s_samples && s_button && s_stats_lock);

    adc_oneshot_unit_init_cfg_t unit = { .unit_id = ADC_UNIT_1 };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit, &s_adc));
    adc_oneshot_chan_cfg_t chan = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc, ADC_CH, &chan));

    const gpio_config_t btn = {
        .pin_bit_mask = 1ULL << PIN_BUTTON,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .intr_type    = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn));
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(PIN_BUTTON, button_isr, NULL));

    /* Stack sizes are in bytes in ESP-IDF. Higher number = higher priority. */
    xTaskCreate(sensor_task,  "sensor",  3072, NULL, 6, &s_h_sensor);
    xTaskCreate(process_task, "process", 3072, NULL, 5, &s_h_process);
    xTaskCreate(report_task,  "report",  4096, NULL, 4, &s_h_report);
}` },
      { t: 'predict', q: 'The sensor task has the highest priority of the three and loops forever. Why do the other two tasks get to run at all?', choices: [
        { t: 'Because it blocks in `vTaskDelayUntil` for nearly all of each 100 ms period', ok: true, why: 'A blocked task is not ready, so the scheduler picks the next highest ready task. The sampler needs the CPU for microseconds every 100 ms. Priority only decides who wins when several tasks are ready at once.' },
        { t: 'Because FreeRTOS gives every task an equal time slice regardless of priority', why: 'Time slicing happens only among ready tasks of the *same* priority. A ready higher-priority task always runs before a lower one.' },
        { t: 'Because the ESP32 has two cores, one for each remaining task', why: 'A second core helps, but the design must not depend on it: the same code has to behave on a single-core chip. Look for what the task does between samples.' },
      ], reveal: 'Remove the `vTaskDelayUntil` line as an experiment only if you are ready to see the task watchdog fire for the tasks that no longer run. Put it back afterwards.' },
      `You should see a \`[tick]\` line every 2 s with \`last\`, \`avg\`, \`min\`, \`max\`, a count rising by about 20 per line (ten samples per second) and \`dropped=0\`, followed by a line of free stack bytes for each task. Turn the potentiometer: \`last\` should follow at once and \`avg\` should catch up over the next eight samples.`,
    ] },
    { title: 'React to the button from an interrupt', blocks: [
      `Press the button. You should see a \`[reset]\` line immediately, without waiting for the 2 s tick, and \`min\` and \`max\` restarting from the current reading.`,
      { t: 'predict', q: 'A mechanical button bounces: one press produces several falling edges within a few milliseconds, so the ISR runs several times. How many times is the report task woken?', reveal: 'The semaphore is binary: giving it when it is already available changes nothing. Edges that arrive before the task has taken it collapse into one. Edges that arrive after the task has taken it and gone back to wait cause another wake-up, and the 200 ms check in the task discards those. So you should see one `[reset]` line per press. Notice where the debounce lives: the ISR stays three lines long and all timing logic is in the task.' },
      `If you have an analyser, toggle a spare GPIO at the point where \`report_task\` returns from \`xSemaphoreTake\`, and measure from the falling edge on GPIO27 to that toggle. You should see a delay far below a millisecond: that is the interrupt latency plus one context switch, and it does not depend on the 2 s report period or the 100 ms sample period.`,
    ] },
    { title: 'Read the stack numbers and size the stacks', blocks: [
      `Let the program run for a few minutes, press the button several times and turn the knob. Write down the smallest \`stack free\` value you see for each task. That value is the least headroom the task has ever had since it started.`,
      { t: 'predict', q: 'In ESP-IDF, `xTaskCreate(..., 3072, ...)` and a reported high-water mark of 1900. What do those numbers mean?', choices: [
        { t: 'The stack is 3072 bytes and at its deepest the task still had 1900 bytes unused, so it has used about 1170', ok: true, why: 'ESP-IDF measures task stacks in bytes (standard FreeRTOS ports use words). The high-water mark is minimum free space, so used = size − mark.' },
        { t: 'The task has used 1900 bytes of 3072', why: 'The mark counts what was never touched, not what was used. Reading it the wrong way round leads to shrinking a stack that is nearly full.' },
        { t: 'The stack is 3072 words, 12 288 bytes', why: 'That is the unit in upstream FreeRTOS on a 32-bit port. ESP-IDF\'s port takes the size in bytes; check the FreeRTOS page of its documentation.' },
      ], reveal: 'A common sizing rule: run every code path, including error paths and the longest log line, take the peak usage, and add a margin of a quarter to a half. Then enable stack overflow checking in menuconfig for development builds. Logging with long format strings is often the deepest call chain in a task, which is why `report_task` was given more.' },
    ] },
    { title: 'Make the watchdog fire on purpose', blocks: [
      `The sensor and process tasks are subscribed to the task watchdog and reset it every loop. Simulate a hang: in \`process_task\`, add a counter and, after 50 samples, enter \`while (1) { }\`.`,
      { t: 'predict', q: 'After `process_task` enters the infinite loop, what do you expect to see, and what happens to `report_task`, which has lower priority?', reveal: 'About one watchdog timeout later (the period is set in menuconfig under the ESP System Settings; look up the default there) you should see a task-watchdog message naming `process` as the task that did not reset in time, with a backtrace of where it is stuck. Whether the chip then resets depends on the watchdog\'s panic option. Meanwhile the busy loop never blocks, so on the core it occupies nothing of lower priority runs: `report_task` may stop printing if it shares that core. On a two-core chip it may carry on from the other core, which is a reminder that "it still prints" does not mean "it still works". `dropped` starts rising as the queue fills. Remove the loop afterwards.' },
      `Decode the backtrace addresses: the IDF monitor does it for you if it was started with \`idf.py monitor\` from the project directory. You should see the file and line of your \`while (1)\`.`,
    ] },
    { title: 'Debugging exercises', blocks: [
      { t: 'exercise', prompt: `**Exercise A.** This ISR works most of the time. Occasionally the device crashes or asserts inside the kernel when the button is pressed during heavy activity. What is wrong? Give the corrected two lines.`, code: String.raw`static void IRAM_ATTR button_isr(void *arg)
{
    button_evt_t e = { .pin = PIN_BUTTON };
    xQueueSend(s_button_events, &e, portMAX_DELAY);
}`, hints: ['Which API family is allowed in an interrupt?', 'What would "wait for ever" mean inside an ISR?'], answer: { type: 'text', accept: ['fromisr', 'from.?isr'], nudge: 'Look at the name of the kernel call and at its last argument.' }, solution: `\`xQueueSend\` is the task-level API. It may try to block the caller (here with \`portMAX_DELAY\`) and it manipulates scheduler state assuming it runs in a task. In an ISR there is no task to block, so when the queue is full, or when the call interrupts the kernel at a bad moment, the kernel's data structures are corrupted or an assertion fires. It works "most of the time" because the queue is usually not full. Correct version:

\`\`\`c
BaseType_t woke = pdFALSE;
xQueueSendFromISR(s_button_events, &e, &woke);
if (woke) portYIELD_FROM_ISR();
\`\`\`

The \`FromISR\` call never blocks; if the queue is full it returns failure, which you may count.` },
      { t: 'exercise', prompt: `**Exercise B.** Two tasks each need both the display and the SD card. After hours of running, the device freezes; the watchdog names both tasks. Explain the freeze and give a rule that prevents it.`, code: String.raw`void logger_task(void *arg) {
    for (;;) {
        xSemaphoreTake(sd_lock, portMAX_DELAY);
        xSemaphoreTake(display_lock, portMAX_DELAY);
        write_log_and_show_icon();
        xSemaphoreGive(display_lock);
        xSemaphoreGive(sd_lock);
    }
}

void ui_task(void *arg) {
    for (;;) {
        xSemaphoreTake(display_lock, portMAX_DELAY);
        xSemaphoreTake(sd_lock, portMAX_DELAY);
        draw_file_list();
        xSemaphoreGive(sd_lock);
        xSemaphoreGive(display_lock);
    }
}`, hints: ['Stop each task right after its first take. Who holds what?', 'What is each task waiting for at that point?'], answer: { type: 'text', accept: ['deadlock', 'order', 'same order', 'circular'], nudge: 'Interleave the two tasks by hand, one line at a time.' }, solution: `A **deadlock**. If \`logger_task\` takes \`sd_lock\` and is then pre-empted, and \`ui_task\` takes \`display_lock\`, each now waits for ever for the mutex the other holds. It takes hours to appear because the pre-emption must land in a window a few instructions wide. Rule: **every task takes multiple locks in the same global order** (say, always \`sd_lock\` before \`display_lock\`), which makes a circular wait impossible. Better still, avoid holding two locks: give each resource one owner task with a queue. Using a timeout instead of \`portMAX_DELAY\` turns the freeze into an error you can log, which helps find it but does not remove it.` },
      { t: 'widget', name: 'rtos-scheduler', props: { scenario: 'deadlock' }, caption: 'Watch the two-lock deadlock happen, then change the lock order.' },
      { t: 'exercise', prompt: `**Exercise C.** After adding a "dump the last readings" feature, the device panics at random, sometimes in the Wi-Fi code, sometimes in a task that was not changed. The new code is below; the task was created with \`xTaskCreate(report_task, "report", 3072, NULL, 4, NULL)\`. What is the bug, why do the crashes appear elsewhere, and name two different fixes.`, code: String.raw`static void dump_readings(void)
{
    char line[4096];                    /* room for a long CSV line */
    int n = 0;
    for (int i = 0; i < HISTORY_LEN; i++)
        n += snprintf(line + n, sizeof line - n, "%d,", history[i]);
    ESP_LOGI(TAG, "%s", line);
}`, hints: ['Where does `line` live?', 'Compare its size with the stack the task was given.', 'What lies below a task\'s stack in memory?'], answer: { type: 'text', accept: ['stack', 'overflow', '4096', '3072'], nudge: 'Add up what this function needs and compare with what the task has.' }, solution: `\`line\` is a 4096-byte local variable, so it is allocated **on the task's stack**, which is 3072 bytes in total. Entering the function moves the stack pointer below the bottom of the stack; writing the text then overwrites whatever the heap placed there: another task's stack, a control block, a driver's buffer. The victim crashes later, which is why the panics look unrelated. Fixes: make the buffer \`static\` (it moves to .bss; the function is then not re-entrant), allocate it from the heap and free it, format and log the readings in small chunks so that no large buffer is needed, or raise the task's stack size. Chunking is usually best. Enable stack overflow detection in menuconfig and watch the high-water mark: both would have pointed at \`report\` straight away. Note also that the \`snprintf\` loop trusts its return value: once \`n\` exceeds the buffer size, \`sizeof line - n\` wraps to a huge unsigned number.` },
      { t: 'widget', name: 'race-condition', props: { scenario: 'counter' }, caption: 'Why s_stats needs the mutex: interleave two tasks\' load, add and store steps by hand until an update disappears.' },
    ] },
  ],
  walkthrough: [
    `### Creation: what exists after \`app_main\`

\`xQueueCreate(8, sizeof(sample_t))\` allocates one block from the heap holding the queue's control structure and room for eight \`sample_t\` copies. \`xSemaphoreCreateBinary()\` creates a semaphore that starts empty, so the first \`xSemaphoreTake\` blocks until the ISR gives it. \`xSemaphoreCreateMutex()\` creates a mutex that starts available. \`configASSERT\` stops at once if any allocation failed, instead of crashing later on a null handle.

\`xTaskCreate\` allocates a stack of the given number of bytes and a task control block, builds an initial stack frame so that the first context switch "returns" into the task function, and puts the task on the ready list. \`app_main\` itself is a task; when it returns, ESP-IDF deletes it and the three tasks carry on.

### The sampling loop and the hardware timer behind it

The tick interrupt fires at the configured tick rate and advances the kernel's tick count. \`vTaskDelayUntil(&next, period)\` puts the task on the delayed list until tick \`next + period\` and updates \`next\`. Because the wake-up time is computed from the previous wake-up time and not from "now", the time spent reading the ADC does not accumulate as drift, as it would with plain \`vTaskDelay\`.

\`adc_oneshot_read\` selects the channel in the ADC's multiplexer, starts one conversion, waits for the done flag and returns the raw code. With 12 dB attenuation the input range covers most of 0 to 3.3 V; the exact usable range and the ADC's non-linearity are described in the ADC documentation, and calibrated millivolts need the calibration driver.

\`xQueueSend(s_samples, &s, 0)\` enters a critical section, copies the 8 bytes of \`s\` into the next free slot, and, if \`process_task\` is blocked waiting on the queue, moves it to the ready list. The timeout of 0 means that a full queue returns failure at once. A sampler that waited for space would lose its timing; dropping and counting keeps the timing and makes the overload visible.

### The interrupt path, instruction by instruction

The falling edge on GPIO27 sets a bit in the GPIO interrupt status register. The CPU finishes its current instruction, saves its context and enters the GPIO driver's common handler, which finds the pin and calls \`button_isr\`. \`xSemaphoreGiveFromISR\` marks the semaphore available and, because \`report_task\` is blocked on it, moves that task to the ready list and sets \`woke\`. \`portYIELD_FROM_ISR()\` requests a context switch so that, as the interrupt returns, execution resumes in \`report_task\` and not in whatever was interrupted. Without the yield the task would still run, but only at the next tick.

### The mutex and the copy

\`process_task\` computes the average **before** taking the mutex and holds it only for five assignments. \`report_task\` copies the whole structure to a local \`snap\` and releases the mutex before formatting and printing, which take milliseconds at 115200 baud. Had it logged while holding the lock, \`process_task\` — a higher-priority task — would have been stuck behind a UART for that time, and the queue would have filled. Keep the locked region to memory operations.

### The watchdog

\`esp_task_wdt_add(NULL)\` subscribes the calling task. From then on, if the task does not call \`esp_task_wdt_reset()\` within the timeout, the watchdog's handler reports it. \`process_task\` waits on the queue with a 1 s timeout rather than for ever so that it keeps feeding the watchdog even when no samples arrive, and logs that condition itself; the sampler's own subscription covers the case where sampling stops.`,
  ],
  testing: [
    `| Test | How | You should see |
|---|---|---|
| Filter | \`./movavg_test\` on the PC | \`movavg: all checks passed\` |
| Sample rate | Difference in \`n\` between two \`[tick]\` lines 2 s apart | 20, give or take one |
| Range | Turn the knob end to end | \`last\` from near 0 to near 4095; no jumps with the knob still |
| Filter response | Turn the knob quickly and stop | \`avg\` reaches \`last\` within 8 samples (under a second) |
| No loss | Run for 5 minutes | \`dropped=0\` |
| Button | Press once | Exactly one \`[reset]\` line, at once; \`min\` and \`max\` restart |
| Bounce | Press 20 times at normal speed | 20 \`[reset]\` lines, not more |
| Latency (optional) | Analyser: GPIO27 falling edge to a toggled spare pin in \`report_task\` | Well under 1 ms, independent of the report period |
| Stack headroom | Lowest \`stack free\` per task after exercising everything | Every task keeps at least a quarter of its stack free |
| Overload | Temporarily add \`vTaskDelay(pdMS_TO_TICKS(300))\` in \`process_task\`'s loop | \`dropped\` rises; samples continue at 100 ms; nothing crashes |
| Watchdog | Infinite loop in \`process_task\` | A task-watchdog report naming \`process\`, with a backtrace into your loop |`,
    { t: 'callout', kind: 'note', title: 'Concurrency bugs do not show up on demand', md: `A test that passes once proves little about a race, because the fault needs a particular interleaving. Raise the odds: run for a long time, add load (the overload test above), and make windows wider on purpose — for example, temporarily add a \`vTaskDelay(1)\` between two steps you believe are safe to separate and see whether anything breaks. And reason about it: for every variable touched by more than one task or ISR, write down the rule that protects it.` },
  ],
  troubleshooting: [
    { symptom: 'Task watchdog reports the idle task did not reset', cause: 'A task at a higher priority never blocks (a loop with no delay, queue wait or semaphore wait), so the idle task is starved', fix: 'Find the busy loop from the backtrace; make the task block for its event instead of polling.' },
    { symptom: 'Panic mentioning a stack overflow or stack canary in a task', cause: 'Stack too small for the deepest call chain, often formatted logging or a large local array', fix: 'Raise the stack, read the high-water mark, move big buffers off the stack.' },
    { symptom: 'Random crashes in unrelated code', cause: 'An undetected stack overflow, or a kernel call from an ISR without `FromISR`', fix: 'Enable stack overflow checking; audit every ISR for task-level API calls and for anything that can block.' },
    { symptom: 'ADC reading is noisy or stuck at 0 or 4095', cause: 'Wiper not connected, pot ends both on the same rail, or a pin that is not on ADC1', fix: 'Measure the wiper voltage with a multimeter. Confirm the channel-to-GPIO mapping for your chip.' },
    { symptom: 'Several `[reset]` lines per button press', cause: 'Contact bounce longer than the 200 ms window, or the debounce comparison uses the wrong time base', fix: 'Capture the button on an analyser and measure the bounce; adjust the window; add 100 nF across the button if needed.' },
    { symptom: 'Button does nothing', cause: 'ISR service not installed, wrong pin, wrong edge, or the button is wired to 3V3 with a pull-up so the level never changes', fix: 'Probe GPIO27: it must rest high and go low when pressed.' },
    { symptom: '`dropped` keeps rising', cause: 'The consumer is slower than the producer: logging or other slow work inside `process_task`, or its priority is too low', fix: 'Move slow work out of the consumer or lower the sample rate; a longer queue only delays the overflow.' },
    { symptom: 'System freezes, watchdog names two tasks', cause: 'Deadlock: two mutexes taken in opposite orders, or a task taking a mutex it already holds', fix: 'Fix one global lock order; use timeouts on takes during development so the failure is logged.' },
    { symptom: 'Values in the report are inconsistent with each other (max below min)', cause: 'The structure was read while it was being updated, without the mutex', fix: 'Copy the whole structure under the mutex, then use the copy.' },
  ],
  challenge: `Turn the logger into a controller with a deadline.

- Add an output: an LED or buzzer on an LEDC PWM channel whose duty cycle follows the filtered reading, updated by a new task.
- Requirement: the output must respond to a change at the input within 150 ms, always. Design the task set and priorities to meet it. Decide whether the output task reads from a queue, a length-1 "latest value" queue written with \`xQueueOverwrite\`, or a task notification, and justify the choice.
- Prove the deadline with a measurement: toggle a GPIO when a sample is taken and another when the output is updated, capture both for at least a minute while pressing the button repeatedly and with the overload delay active, and report the worst case, not the average.
- Then break it deliberately: have the report task hold the statistics mutex across its logging, and show on the same measurement how far the worst case moves. Explain the result using priority inheritance.
- Replace the binary semaphore with a direct-to-task notification and state what was gained and what was lost.

No solution is given. The deliverable is the task table (name, priority, period, stack, what it blocks on), the worst-case measurements, and the explanation.`,
  quiz: [
    { kind: 'code', q: 'Why does the button ISR call `xSemaphoreGiveFromISR` and not `xSemaphoreGive`?', choices: [
      { t: 'The task-level call assumes it runs in a task that may be blocked and rescheduled; in an ISR there is no such task, so only the non-blocking `FromISR` variant is safe', ok: true, why: 'The `FromISR` functions never block and hand back a flag instead of switching context themselves; the port then switches as the interrupt exits.' },
      { t: 'The `FromISR` variant is faster, which matters in interrupts', why: 'Speed is a side effect. The reason is correctness: the ordinary call can corrupt scheduler state when used outside a task.' },
      { t: 'A binary semaphore can only ever be given from an interrupt', why: 'Tasks give semaphores too. The rule is about which *function* is legal in which context.' },
    ] },
    { kind: 'arch', q: 'A task that drives a motor every 5 ms and a task that updates a display every 500 ms. Which gets the higher priority, and why?', choices: [
      { t: 'The motor task: its deadline is tighter, and it runs briefly then blocks, so the display task still gets the CPU', ok: true, why: 'Priority follows urgency. A short, frequent, well-behaved high-priority task costs the lower ones very little.' },
      { t: 'The display task, because it does more work per run and needs more CPU', why: 'Giving the heavier task priority means the 5 ms deadline is missed whenever a redraw is in progress. Amount of work is not urgency.' },
      { t: 'Equal priorities, so the scheduler shares time fairly', why: 'Round-robin among equals switches at tick boundaries. A 5 ms deadline cannot rely on waiting for a redraw to use up its time slice.' },
    ] },
    { kind: 'concept', q: 'What does a mutex give you that a binary semaphore does not?', choices: [
      { t: 'Ownership and priority inheritance: the holder is temporarily raised to the priority of the highest waiter', ok: true, why: 'That bounds how long a high-priority task can be kept waiting by a low-priority holder that is being pre-empted by medium-priority work.' },
      { t: 'It can be given from an interrupt', why: 'That is the property of the semaphore. A mutex has an owner task, and an ISR is not a task, so mutexes must not be used from interrupts.' },
      { t: 'It carries a data value to the receiver', why: 'Neither carries data. A queue does.' },
    ] },
    { kind: 'code', q: 'A task created with a 4096-byte stack reports a high-water mark of 180. What should you conclude?', choices: [
      { t: 'At its deepest it had only 180 bytes left; one deeper call path or a longer log line could overflow it, so the stack should be enlarged', ok: true, why: 'The mark is the minimum free space ever observed. 180 bytes of margin is less than a single formatted-print call can need.' },
      { t: 'It uses only 180 bytes, so the stack can be reduced to about 512', why: 'That reads the number as usage. It is the opposite: the amount never used.' },
      { t: 'The stack has already overflowed by 180 bytes', why: 'An overflow would show as a mark of zero and, with checking enabled, a panic. A positive mark means there was still room — just very little.' },
    ] },
    { kind: 'arch', q: 'Why does `report_task` copy `s_stats` into a local variable and release the mutex before calling `ESP_LOGI`?', choices: [
      { t: 'Logging is slow; holding the mutex across it would block the higher-priority processing task for milliseconds and let the queue fill', ok: true, why: 'The locked region should contain memory operations only. The copy gives the reporter a consistent snapshot to print at leisure.' },
      { t: '`ESP_LOGI` cannot be called while any mutex is held', why: 'It can; nothing forbids it. The problem is how long the lock would be held and who would be waiting.' },
      { t: 'To save stack space in the report task', why: 'The copy costs stack space. It is paid for the sake of a short critical section.' },
    ] },
    { kind: 'concept', q: 'The sensor task sends to a full queue with a timeout of 0 and counts the failure. What is the reasoning behind not waiting for space?', choices: [
      { t: 'Waiting would make the sampling period depend on the consumer; dropping keeps the timing and makes the overload measurable', ok: true, why: 'A periodic producer that blocks on its consumer inherits the consumer\'s delays. A drop counter turns a hidden timing fault into a visible number.' },
      { t: 'A timeout of 0 makes the queue lossless', why: 'It does the opposite: it allows loss, deliberately, and reports it through the return value.' },
      { t: 'FreeRTOS does not allow a high-priority task to block on a queue', why: 'Any task may block on a queue. The choice here is a design decision about what should give way under overload.' },
    ] },
  ],
};


// ───────────────────────────── Project 10: custom device ─────────────────────────────
const p10Block = (() => {
  let b = box(260, 16, 170, 40, 'USB 5 V', 'power, console, flashing')
    + box(260, 96, 170, 150, 'ESP32', '')
    + box(15, 70, 160, 44, 'I2C sensor', 'address from datasheet')
    + box(15, 140, 160, 44, 'OLED display', 'SSD1306-style, I2C')
    + box(15, 226, 160, 40, 'Button', 'to GND, pull-up')
    + box(515, 70, 160, 44, 'Buzzer driver', 'transistor + buzzer')
    + box(515, 140, 160, 40, 'Status LED', 'with resistor')
    + box(515, 214, 160, 44, 'Access point', 'then your server')
    + box(260, 276, 170, 36, 'NVS in module flash', '');
  b += arr(345, 56, 345, 96);
  b += wire('175,92 215,92 215,162 175,162', 1) + dot(215, 127, 1) + wire('215,127 260,127', 1) + T(218, 84, 'I2C bus', 'start', `font-size="10" fill="${col(1)}"`);
  b += T(266, 131, 'GPIO21 SDA', 'start', 'font-size="10"') + T(266, 145, 'GPIO22 SCL', 'start', 'font-size="10"');
  b += arr(175, 246, 260, 222, 4) + T(266, 226, 'GPIO27 in', 'start', 'font-size="10"');
  b += arr(430, 127, 515, 96, 3) + T(424, 131, 'GPIO25 PWM', 'end', 'font-size="10"');
  b += arr(430, 165, 515, 162, 2) + T(424, 169, 'GPIO26 out', 'end', 'font-size="10"');
  b += arr(430, 222, 515, 234, 5, true) + T(424, 226, 'Wi-Fi 2.4 GHz', 'end', 'font-size="10"');
  b += wire('345,246 345,276', 0, true);
  b += T(95, 204, '4.7 kΩ pull-ups to 3V3', 'middle', 'font-size="10" opacity=".7"') + T(95, 216, 'on SDA and SCL (once)', 'middle', 'font-size="10" opacity=".7"');
  return svg(690, 322, b);
})();

const p10States = (() => {
  let b = state(30, 40, 130, 44, 'NORMAL', 'buzzer off', 4) + state(400, 40, 130, 44, 'ALARM', 'buzzer on', 3) + state(400, 190, 130, 44, 'SILENCED', 'buzzer off', 2) + state(30, 190, 130, 44, 'FAULT', 'sensor failed', 5);
  b += arr(160, 52, 400, 52, 3) + T(280, 44, 'sample ≥ threshold', 'middle', 'font-size="10"');
  b += arr(400, 74, 160, 74, 4) + T(280, 90, 'sample < threshold − hysteresis', 'middle', 'font-size="10"');
  b += arr(465, 84, 465, 190, 2) + T(471, 140, 'button', 'start', 'font-size="10"');
  b += arr(400, 200, 150, 84, 4) + T(300, 160, 'sample < threshold − hysteresis', 'start', 'font-size="10"');
  b += arr(80, 190, 80, 84, 4) + T(74, 140, 'good', 'end', 'font-size="10"') + T(74, 152, 'sample', 'end', 'font-size="10"');
  b += arr(400, 222, 160, 222, 5, true) + T(280, 240, 'sensor error (from every state)', 'middle', `font-size="10" fill="${col(5)}"`);
  return svg(560, 256, b);
})();

const p10 = {
  id: 'esp-p10', title: 'Project 10: Custom embedded device combining multiple peripherals', kind: 'Project', minutes: 480,
  summary: 'Specify, design, build and test a device of your own that combines a sensor, a display, a button, a PWM output, Wi-Fi reporting and stored settings. You get the engineering method and a skeleton; the design decisions are yours.',
  skills: ['esp-pb-system-design', 'esp-pb-rtos-pipeline', 'esp-pb-net-sec', 'esp-pb-debug-link'],
  objectives: [
    'Write requirements that can be tested, and separate what the device must do from how it will do it.',
    'Draw a block diagram and derive a pin budget that survives the chip\'s restrictions.',
    'Estimate a power budget from datasheet figures and check it against the supply.',
    'Assign every peripheral and every piece of shared data to exactly one owner, and draw the task and queue diagram.',
    'Express the device\'s behaviour as a state machine, implement it as pure C and test it on a PC.',
    'Integrate one peripheral at a time with a test for each, and store validated settings in NVS.',
    'Write a test plan that covers faults — sensor missing, network down, corrupt settings — as well as normal operation.',
  ],
  hardware: [
    'ESP32 DevKit and a USB cable',
    'An I2C sensor of your choice that runs at 3.3 V (temperature, humidity, pressure, light, distance …) and its datasheet',
    'A small display — a 128×64 SSD1306-style I2C OLED is the reference choice — or no display, with a serial dashboard instead',
    'Push button',
    'Alarm output: a piezo buzzer or an LED, with a transistor and resistor if the load needs more current than a pin may supply',
    'Two 4.7 kΩ resistors for I2C pull-ups if your breakout boards do not already carry them',
    'Breadboard, jumper wires, multimeter, logic analyser',
  ],
  software: [
    'ESP-IDF v6.1',
    'gcc on your PC for the logic tests',
    'A drawing tool or paper for the diagrams: they are deliverables, not decoration',
    'A server endpoint you control if you report over the network',
  ],
  background: [
    `### The problem

Projects 1 to 9 each asked for one thing. Real devices fail at the joins: the display and the sensor share a bus and corrupt each other's transfers; the pin that was free turns out to be a strapping pin; the alarm stops because the network library is waiting for a server that is down; a setting saved by last month's firmware crashes this month's. None of these is hard to fix once seen. All of them are cheap to prevent on paper and expensive to find on a breadboard.

This project is therefore mostly method. The reference design is an **environmental monitor**: it measures a quantity, shows it, raises an alarm above a threshold, lets the user silence the alarm, reports over Wi-Fi and remembers its settings. You may build that, or specify a different device of similar scope. Either way you produce the same artefacts, in this order:

1. Requirements
2. Block diagram
3. Pin budget
4. Power budget
5. Task and queue diagram, with an owner for every resource
6. State machine
7. Test plan
8. Then firmware, integrated one peripheral at a time

### Requirements that can be tested

"The device shows the temperature" cannot be failed. "The display shows the last reading, in °C with one decimal, and is no more than 2 s old; if the sensor has failed it shows a fault indication and never a stale number" can. Write each requirement so that a specific test could prove it false. Include the unhappy paths: what must still work when Wi-Fi is down, when the sensor is unplugged, when the stored settings are garbage.

### One owner per resource

The rule that prevents most integration bugs: every peripheral, and every piece of state, has exactly one task that touches it. Everything else sends that task a message. If two tasks must share something — an I2C bus used by a sensor driver and a display driver, say — then either one task owns the whole bus and serves both, or a single mutex guards every transaction on it. Decide which, write it on the diagram, and never make an exception.`,
    { t: 'callout', kind: 'decision', title: 'Why the logic is kept apart from the hardware', md: `In the skeleton, the file \`app_logic.c\` knows nothing about FreeRTOS, GPIO or Wi-Fi. It answers one question: given the current state and an event, what is the next state? Tasks only gather events and act on states. This costs a little indirection and buys three things: the decisions are tested on a PC in milliseconds, including faults that are awkward to produce on a bench; the behaviour is one function you can read from top to bottom; and changing the sensor or the display cannot break the alarm rules.` },
    `### Hysteresis

A threshold with a single trip point chatters: a reading hovering at 30.0 °C with ±0.1 °C of noise would switch the alarm on and off several times a second. Hysteresis uses two points — on at the threshold, off only when the reading has fallen a margin below it — so that noise smaller than the margin cannot cause a transition. It is the same idea as the Schmitt trigger input from the electronics section, applied in software.

### Failing safe

Decide, for each fault, which way the device should fail. A monitor that cannot read its sensor does not know whether conditions are safe. Showing the last good value hides the fault; the reference design enters a distinct FAULT state and says so. A corrupted state variable also leads to FAULT. Stored settings that fail validation are replaced by defaults, and that event is logged.`,
    { t: 'callout', kind: 'security', title: 'Security requirements are requirements', md: `A device with a radio and stored settings has assets: the Wi-Fi credentials, the integrity of its readings, the settings that decide when it alarms. Write security requirements beside the functional ones and test them the same way. At minimum: no secrets in the repository; TLS with certificate verification for anything leaving the device; every input from the network, the button and storage validated before use; no unauthenticated way to change a setting over the network. If the device's alarm protects something, also ask what an attacker gains by silencing it.` },
    { t: 'widget', name: 'threat-model', props: { template: 'blank' }, caption: 'Fill in assets, adversaries and entry points for your device. Export it to your notebook; it is part of the hand-in.' },
  ],
  diagram: [
    { t: 'figure', svg: p10Block, caption: 'Block diagram of the reference design. Yours will differ; draw it before choosing pins.' },
    { t: 'ascii', caption: 'Pin budget for the reference design on an original ESP32 DevKit. Fill in the same table for your own device before placing a single wire.', text: `
GPIO   Dir   Function            Peripheral   Electrical notes                      Checked against
----   ---   -----------------   ----------   -----------------------------------   -------------------------
21     I/O   I2C SDA             I2C0         open-drain, 4.7 kΩ pull-up to 3V3     not strapping, not flash
22     I/O   I2C SCL             I2C0         open-drain, 4.7 kΩ pull-up to 3V3     not strapping, not flash
27     in    Button              GPIO + ISR   to GND, internal pull-up, falling     has pull-up (not 34-39)
25     out   Buzzer PWM          LEDC         via transistor if load > pin limit    ADC2 pin: ADC not needed
26     out   Status LED          GPIO         series resistor                       ADC2 pin: ADC not needed
34     in    spare analog input  ADC1 ch 6    0..3.3 V only                         ADC1, usable with Wi-Fi
1, 3   -     console             UART0        reserved for log and flashing         do not reuse
0, 2, 5, 12, 15                               strapping pins: left unconnected
6-11                                          module flash: never use
--     --    Wi-Fi               radio        no pins; ADC2 unavailable for ADC     current peaks on 3V3

I2C address map (fill in from YOUR datasheets; two devices must not share an address)
Device          Address     Source
-------------   ---------   ---------------------------------------
Sensor          0x__        datasheet, section ______
Display         0x__        module documentation (often selectable by a solder jumper)
` },
    { t: 'ascii', caption: 'Task and queue diagram of the skeleton. Each box is a task; each arrow is a queue carrying copies. No arrow means no communication.', text: `
sensor_task ──(app_msg_t: EV_SAMPLE / EV_SENSOR_ERROR)──┐
  owns: sensor                                          ▼
                                                   ┌──────────────┐      s_view_ui (len 1, overwrite)
button_task ──(app_msg_t: EV_BUTTON)──────────────▶│ controller   │────────────────────────────────▶ display_task
  owns: button GPIO, debounce        s_events (8)  │ owns: state, │                                    owns: display
                                                   │ settings,    │      s_view_net (len 1, overwrite)
                                                   │ buzzer PWM   │────────────────────────────────▶ network_task
                                                   └──────────────┘                                    owns: Wi-Fi, HTTP
Rules
 - Only the controller changes state or settings. It never waits on I/O.
 - Display and network get a COPY of the latest view. If they are slow or stuck, the
   controller overwrites the old copy and carries on. The alarm never depends on them.
 - If sensor and display share the I2C bus: one mutex around every transaction, or one
   bus-owner task. Write down which.
` },
    { t: 'figure', svg: p10States, caption: 'Alarm state machine of the reference design. From FAULT, a good sample leads to NORMAL or directly to ALARM, depending on its value (only the NORMAL arrow is drawn).' },
    { t: 'callout', kind: 'note', title: 'Adapting to other chips', md: `The method is identical on the ESP32-S3, C3 and C6; the pin budget is not. Redo the table from that chip's GPIO page: strapping pins, flash pins, USB pins (GPIO19/20 on the S3, GPIO18/19 on the C3, GPIO12/13 on the C6) and the ADC-channel-to-GPIO map all differ. A pin table copied from another chip is the most common way to lose an evening.` },
  ],
  steps: [
    { title: 'Write the requirements', blocks: [
      `Start a design document. Write 8 to 12 numbered functional requirements and 4 to 6 security requirements for **your** device. The requirements listed for this project further down are those of the reference design; use them as a model for the level of detail, and change them to describe what you are building.

For each requirement, write one line saying how you will test it. If you cannot think of a test, the requirement is not finished.`,
      { t: 'exercise', prompt: `Rewrite this requirement so that it can be tested: *"The alarm should be reliable and respond quickly."* Include at least one fault condition.`, hints: ['Reliable against what? Name the conditions.', 'Quickly: put a number and a starting point on it.', 'What must the alarm do when the network is down or the sensor is missing?'], solution: `One possible answer, as three requirements:

- *F-a.* When a reading at or above the threshold is taken, the alarm output is active within 500 ms of that reading.
- *F-b.* The alarm behaviour of F-a is unaffected by the state of the Wi-Fi connection or the reporting server; tested with the access point switched off and with the server address unreachable.
- *F-c.* If the sensor cannot be read for 3 consecutive attempts, the device enters a fault state within 5 s, shows a fault indication distinct from any reading, and does not display the last good value as current.

Each has a number, a condition and an observation, so each can fail a test. "Reliable" was three different claims hiding in one word.` },
    ] },
    { title: 'Draw the block diagram and choose the parts', md: `Draw every part of the system as a box and every connection as a line labelled with its interface (I2C, GPIO, PWM, Wi-Fi) and voltage. Include power. For each part, open its datasheet and note: supply voltage range, interface and address, typical and peak current, and anything it needs externally (pull-ups, decoupling, a reset line).

Check each connection with the three questions from project 7: is the high level high enough, is the low level low enough, and does anything exceed an absolute maximum? A 5 V display module on a 3.3 V I2C bus is a common trap: its pull-ups may go to 5 V.` },
    { title: 'Make the pin budget', blocks: [
      `Fill in the pin table for your design. For every signal, check it against the chip's restrictions and write what you checked in the last column.`,
      { t: 'predict', q: 'A learner\'s first pin budget for an original ESP32 puts the button on GPIO0, the buzzer on GPIO12, a second analog sensor on GPIO26 and the display\'s reset line on GPIO34. The device will use Wi-Fi. How many of these four choices are faulty?', choices: [
        { t: 'All four', ok: true, why: 'GPIO0 is a strapping pin: a button held to ground at reset puts the chip in download mode. GPIO12 is a strapping pin too, and a load pulling it at reset can stop the module booting. GPIO26 is an ADC2 input, unusable for analog readings while Wi-Fi runs. GPIO34 is input-only and cannot drive a reset line. Each is found by reading one page of documentation, and none is visible in a quick bench test until it bites.' },
        { t: 'Two: only the strapping pins are a problem', why: 'The strapping pins are indeed wrong. Now check the direction capability of the pin chosen for an output, and which ADC unit the analog pin belongs to.' },
        { t: 'One: only GPIO34, because it cannot be an output', why: 'That one is real. Look also at what GPIO0 and GPIO12 do during reset, and at what else uses the ADC behind GPIO26.' },
        { t: 'None, since all are valid GPIO numbers', why: 'Existing as a GPIO is not the same as being free. Several pins have duties at reset or hardware limits that the number alone does not show.' },
      ], reveal: 'Go through your own table with the same four questions: strapping? flash? input-only? ADC2 with Wi-Fi? Then one more: does anything on the board already use this pin (an on-board LED, a USB bridge)?' },
    ] },
    { title: 'Estimate the power budget', blocks: [
      `Make a table with one row per consumer and these columns: supply rail, typical current, peak current, duty (what fraction of the time it is in each condition), and the datasheet section the numbers came from. Do not use numbers from memory or from a web search; the point of the exercise is to find them in the primary source.

\`\`\`
Consumer         Rail   Typical   Peak     When the peak occurs        Source
--------------   ----   -------   ------   -------------------------   ------------------------
ESP32, Wi-Fi     3V3    ____ mA   ____ mA  transmit bursts             module datasheet, § ____
Sensor           3V3    ____ µA   ____ mA  during a conversion         sensor datasheet, § ____
Display          3V3    ____ mA   ____ mA  all pixels lit              display datasheet, § ____
Buzzer           ____   ____ mA   ____ mA  alarm active                buzzer datasheet
LED              3V3    ____ mA   -        (3.3 V − Vf) / R            your calculation
--------------   ----   -------   ------
Total            3V3    ____ mA   ____ mA
\`\`\`

Then answer three questions in writing:

1. Is the **peak** total on the 3.3 V rail within what the DevKit's regulator can supply? Find the regulator's part number on your board and read its datasheet.
2. Is the total drawn from USB within what the port provides? A standard USB 2.0 port is specified for 500 mA.
3. If this ran from a battery of capacity C mAh, how long would it last at the **average** current (typical currents weighted by duty)? What single change would extend that the most?

Verify one number by measurement: put a multimeter in series with the 5 V supply, or use a USB power meter, and compare the average with your estimate. A meter will not show the short transmit peaks; that is what the datasheet figure and the bulk capacitor near the module are for.`,
      { t: 'callout', kind: 'mistake', title: 'Powering the load from a GPIO', md: `A GPIO is a signal, not a supply. A buzzer, a relay, a motor or a strip of LEDs must take its current from a rail through a transistor that the GPIO only controls, with a flyback diode across anything inductive. Check the pin's maximum current in the ESP32 datasheet before connecting any load directly, and remember that the limit for all pins together is lower than the per-pin limit multiplied by the number of pins.` },
    ] },
    { title: 'Assign owners and draw the task diagram', blocks: [
      `List every resource: each peripheral, each bus, each piece of state (current state, settings, latest reading). Give each exactly one owner task. Then draw the queues. For each queue decide: what type travels on it, how long it is, what the sender does when it is full, and whether old data should be kept (a normal queue) or replaced (\`xQueueOverwrite\` on a length-1 queue).

Fill in a task table:

| Task | Priority | Blocks on | Period or deadline | Stack (measured) | Owns |
|---|---|---|---|---|---|
| controller | highest | \`s_events\` | reacts within 10 ms | … | state, settings, buzzer |
| sensor | … | delay | 1 s | … | sensor |
| button | … | semaphore from ISR | 50 ms | … | button |
| display | low | \`s_view_ui\` | 200 ms | … | display |
| network | lowest | \`s_view_net\`, timeouts | minutes | … | Wi-Fi, HTTP |`,
      { t: 'predict', q: 'In the skeleton the controller sends the view to the display with `xQueueOverwrite` on a queue of length 1, not `xQueueSend` on a queue of length 8. Why?', choices: [
        { t: 'The display only needs the newest state; overwriting never blocks the controller and never shows a backlog of stale views', ok: true, why: 'With a normal queue, a slow display would either block the controller when the queue fills or fall seconds behind. A mailbox that holds only the latest value suits "show the current state".' },
        { t: 'Because a length-1 queue uses less RAM', why: 'It does, slightly, but that is not the reason. Think about what happens to the alarm logic when the display stops reading.' },
        { t: 'Because `xQueueSend` cannot carry a struct', why: 'Any queue carries items of whatever size it was created with, structs included. The two calls differ in what they do when the queue is full.' },
      ], reveal: 'The same reasoning does **not** apply to `s_events`: button presses and samples are events that must each be processed once, so that queue is a normal one, and the sender counts failures.' },
    ] },
    { title: 'Write and test the state machine on your PC', blocks: [
      `Draw the state diagram for your device: every state, every event, every transition, and what the outputs are in each state. Then check it for completeness by making a table with states down the side and events across the top; every cell must say what happens, even if the answer is "nothing".

The reference design's logic follows. Adapt it to your device and extend the test until every cell of your table is exercised.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'app_logic.h', code: String.raw`/* app_logic.h - the decisions of the device, with no hardware in them.
 * Everything here compiles and is tested on a PC. */
#ifndef APP_LOGIC_H
#define APP_LOGIC_H

#include <stdbool.h>
#include <stdint.h>

/* ---- settings (stored in NVS on the device) ---- */
typedef struct {
    int16_t  alarm_on_c10;    /* alarm threshold, tenths of a degree C   */
    int16_t  hysteresis_c10;  /* how far below it we must fall to clear  */
    uint16_t report_period_s; /* Wi-Fi report interval                   */
} settings_t;

void settings_defaults(settings_t *s);
bool settings_valid(const settings_t *s);

/* ---- alarm state machine ---- */
typedef enum { AL_NORMAL, AL_ALARM, AL_SILENCED, AL_FAULT } alarm_state_t;

typedef enum {
    EV_SAMPLE,        /* a new temperature is available (value in arg) */
    EV_SENSOR_ERROR,  /* the sensor read failed                        */
    EV_BUTTON         /* the user pressed the button                   */
} app_event_t;

alarm_state_t alarm_step(alarm_state_t st, app_event_t ev, int16_t temp_c10,
                         const settings_t *cfg);
bool          alarm_buzzer_on(alarm_state_t st);

#endif` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'app_logic.c', code: String.raw`#include "app_logic.h"

void settings_defaults(settings_t *s)
{
    s->alarm_on_c10    = 300;   /* 30.0 C */
    s->hysteresis_c10  = 10;    /*  1.0 C */
    s->report_period_s = 60;
}

/* Never trust what comes out of storage: a fresh chip, a half-written
 * page or an old firmware's layout can all hand you nonsense. */
bool settings_valid(const settings_t *s)
{
    return s->alarm_on_c10 >= -400 && s->alarm_on_c10 <= 1250 &&
           s->hysteresis_c10 >= 1  && s->hysteresis_c10 <= 100 &&
           s->report_period_s >= 5 && s->report_period_s <= 3600;
}

alarm_state_t alarm_step(alarm_state_t st, app_event_t ev, int16_t temp_c10,
                         const settings_t *cfg)
{
    int16_t off_below = (int16_t)(cfg->alarm_on_c10 - cfg->hysteresis_c10);

    if (ev == EV_SENSOR_ERROR) return AL_FAULT;       /* from any state */

    switch (st) {
    case AL_NORMAL:
        if (ev == EV_SAMPLE && temp_c10 >= cfg->alarm_on_c10) return AL_ALARM;
        return AL_NORMAL;

    case AL_ALARM:
        if (ev == EV_BUTTON) return AL_SILENCED;
        if (ev == EV_SAMPLE && temp_c10 < off_below) return AL_NORMAL;
        return AL_ALARM;

    case AL_SILENCED:                 /* still too hot, but acknowledged */
        if (ev == EV_SAMPLE && temp_c10 < off_below) return AL_NORMAL;
        return AL_SILENCED;

    case AL_FAULT:                    /* leave only on a good sample */
        if (ev == EV_SAMPLE)
            return temp_c10 >= cfg->alarm_on_c10 ? AL_ALARM : AL_NORMAL;
        return AL_FAULT;
    }
    return AL_FAULT;                  /* unknown state: fail safe */
}

bool alarm_buzzer_on(alarm_state_t st) { return st == AL_ALARM; }`, explain: [
        { lines: '12-17', md: 'Range checks on everything read from storage. Erased flash reads as all ones, which as an `int16_t` is −1 and as a `uint16_t` is 65535; the checks reject that pattern.' },
        { lines: '24', md: 'A sensor error leads to FAULT from any state. Putting it before the `switch` means no state can forget to handle it.' },
        { lines: '31-34', md: 'Hysteresis: the alarm switches on at the threshold and off only below `off_below`. Between the two, the state does not change.' },
        { lines: '36-38', md: 'SILENCED remembers that the user has acknowledged the alarm. It ends only when the condition has cleared, so a new excursion alarms again.' },
        { lines: '45', md: 'An impossible state value means memory was corrupted. The function returns FAULT instead of guessing.' },
      ] },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'app_logic_test.c — gcc -Wall -Wextra -std=c11 app_logic.c app_logic_test.c -o app_logic_test && ./app_logic_test', code: String.raw`/* Build: gcc -Wall -Wextra -std=c11 app_logic.c app_logic_test.c -o app_logic_test */
#include "app_logic.h"
#include <assert.h>
#include <stdio.h>

int main(void)
{
    settings_t cfg;
    settings_defaults(&cfg);
    assert(settings_valid(&cfg));

    settings_t erased = { -1, -1, 0xFFFF };    /* what blank flash looks like */
    assert(!settings_valid(&erased));

    alarm_state_t st = AL_NORMAL;
    st = alarm_step(st, EV_SAMPLE, 299, &cfg);  assert(st == AL_NORMAL);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);    assert(st == AL_NORMAL);
    st = alarm_step(st, EV_SAMPLE, 300, &cfg);  assert(st == AL_ALARM);
    assert(alarm_buzzer_on(st));

    /* Hysteresis: hovering just under the threshold does not clear it. */
    st = alarm_step(st, EV_SAMPLE, 295, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_SAMPLE, 290, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_SAMPLE, 289, &cfg);  assert(st == AL_NORMAL);

    /* Silence: buzzer off, state remembered until it cools down. */
    st = alarm_step(st, EV_SAMPLE, 310, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);    assert(st == AL_SILENCED);
    assert(!alarm_buzzer_on(st));
    st = alarm_step(st, EV_SAMPLE, 320, &cfg);  assert(st == AL_SILENCED);
    st = alarm_step(st, EV_SAMPLE, 200, &cfg);  assert(st == AL_NORMAL);

    /* Sensor fault from any state, recovery straight into the right state. */
    st = alarm_step(AL_SILENCED, EV_SENSOR_ERROR, 0, &cfg);  assert(st == AL_FAULT);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);                 assert(st == AL_FAULT);
    st = alarm_step(st, EV_SAMPLE, 350, &cfg);               assert(st == AL_ALARM);
    st = alarm_step(AL_FAULT, EV_SAMPLE, 210, &cfg);         assert(st == AL_NORMAL);

    /* A corrupted state variable fails safe. */
    assert(alarm_step((alarm_state_t)99, EV_SAMPLE, 0, &cfg) == AL_FAULT);

    printf("app_logic: all checks passed\n");
    return 0;
}` },
      `You should see \`app_logic: all checks passed\`.`,
      { t: 'exercise', prompt: `With the default settings (alarm at 30.0 °C, hysteresis 1.0 °C) the device is in ALARM. It then receives the samples 29.5, 29.1, 29.0, 28.9, 29.6, 30.0 in that order (values in °C). After which sample does it leave ALARM, and what state is it in at the end?`, hints: ['Compute the switch-off point: threshold minus hysteresis.', 'The comparison in the code is `<`, not `<=`.', 'After it returns to NORMAL, which sample is at or above the threshold?'], answer: { type: 'text', accept: ['28\\.9.*alarm', 'fourth.*alarm', '4th.*alarm', '289.*alarm'], nudge: 'Give both parts: the sample at which it leaves ALARM, and the final state.' }, solution: `The switch-off point is 30.0 − 1.0 = 29.0 °C and the test is strictly less than. 29.5, 29.1 and 29.0 all leave it in ALARM (29.0 is not below 29.0). **28.9** returns it to NORMAL. 29.6 is below the threshold, so it stays NORMAL. 30.0 is at the threshold (\`>=\`), so it ends in **ALARM** again. Add exactly this sequence to the test file as a new case and confirm it.` },
    ] },
    { title: 'Bring up the skeleton, then one peripheral at a time', blocks: [
      CMAKE_NOTE({ srcs: '"main.c" "app_logic.c"', req: 'nvs_flash esp_driver_gpio esp_driver_i2c esp_driver_ledc' }),
      `Add further components (\`esp_wifi\`, \`esp_http_client\`, …) as you add the features that need them.`,
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'main/main.c — a skeleton, not a finished design', code: String.raw`/* Project 10 reference skeleton. It shows the SHAPE of the firmware:
 * who owns which peripheral, what flows through which queue, where the
 * state machine runs. Every TODO is a design decision that is yours. */
#include <stdbool.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "app_logic.h"

/* One message type for everything the controller reacts to. */
typedef struct {
    app_event_t ev;
    int16_t     temp_c10;      /* valid when ev == EV_SAMPLE */
} app_msg_t;

/* What the display and the network need to know. Sent BY VALUE so the
 * receivers never touch the controller's own variables. */
typedef struct {
    alarm_state_t state;
    int16_t       temp_c10;
    bool          sensor_ok;
} view_t;

static const char *TAG = "p10";
static QueueHandle_t s_events;     /* sensor task, button task -> controller */
static QueueHandle_t s_view_ui;    /* controller -> display task  (length 1) */
static QueueHandle_t s_view_net;   /* controller -> network task  (length 1) */
static settings_t    s_cfg;        /* written only by the controller task    */

/* ---- settings in NVS ---- */
static void settings_load(settings_t *out)
{
    settings_defaults(out);
    nvs_handle_t h;
    if (nvs_open("app", NVS_READONLY, &h) != ESP_OK) return;    /* first boot */
    settings_t tmp;
    size_t len = sizeof tmp;
    if (nvs_get_blob(h, "cfg", &tmp, &len) == ESP_OK &&
        len == sizeof tmp && settings_valid(&tmp)) {
        *out = tmp;
    } else {
        ESP_LOGW(TAG, "stored settings missing or invalid, using defaults");
    }
    nvs_close(h);
}

static esp_err_t settings_save(const settings_t *in)
{
    if (!settings_valid(in)) return ESP_ERR_INVALID_ARG;
    nvs_handle_t h;
    esp_err_t err = nvs_open("app", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(h, "cfg", in, sizeof *in);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

/* ---- tasks ---- */
static void sensor_task(void *arg)
{
    (void)arg;
    /* This task is the ONLY code that touches the sensor. If the display
     * shares the I2C bus, decide now: one bus-owner task, or a mutex. */
    while (1) {
        app_msg_t m = { .ev = EV_SENSOR_ERROR };
        /* TODO: read your sensor; on success set m.ev = EV_SAMPLE and
         *       m.temp_c10. Range-check the value before you believe it. */
        xQueueSend(s_events, &m, 0);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void controller_task(void *arg)
{
    (void)arg;
    alarm_state_t st = AL_NORMAL;
    view_t v = { .state = st };
    app_msg_t m;
    while (1) {
        if (xQueueReceive(s_events, &m, portMAX_DELAY) != pdTRUE) continue;

        st = alarm_step(st, m.ev, m.temp_c10, &s_cfg);
        if (m.ev == EV_SAMPLE)       { v.temp_c10 = m.temp_c10; v.sensor_ok = true; }
        if (m.ev == EV_SENSOR_ERROR) { v.sensor_ok = false; }
        v.state = st;

        /* TODO: drive the alarm output from alarm_buzzer_on(st) (LEDC PWM). */
        xQueueOverwrite(s_view_ui, &v);      /* latest value wins; never blocks */
        xQueueOverwrite(s_view_net, &v);
    }
}

static void display_task(void *arg)
{
    (void)arg;
    view_t v;
    while (1) {
        if (xQueueReceive(s_view_ui, &v, portMAX_DELAY) == pdTRUE) {
            /* TODO: draw to your display. Until it exists, a serial dashboard: */
            ESP_LOGI(TAG, "state=%d temp_c10=%d sensor=%s", (int)v.state,
                     (int)v.temp_c10, v.sensor_ok ? "ok" : "FAULT");
        }
    }
}

/* TODO: button_task  - debounced press -> EV_BUTTON into s_events (project 9).
 * TODO: network_task - Wi-Fi with reconnect; every s_cfg.report_period_s take the
 *                      latest view from s_view_net and report it (project 8).
 *                      The device must keep measuring and alarming with no network. */

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    settings_load(&s_cfg);
    (void)settings_save;           /* call it from your settings UI */

    s_events   = xQueueCreate(8, sizeof(app_msg_t));
    s_view_ui  = xQueueCreate(1, sizeof(view_t));
    s_view_net = xQueueCreate(1, sizeof(view_t));
    configASSERT(s_events && s_view_ui && s_view_net);

    xTaskCreate(controller_task, "ctrl",    4096, NULL, 6, NULL);
    xTaskCreate(sensor_task,     "sensor",  4096, NULL, 5, NULL);
    xTaskCreate(display_task,    "display", 4096, NULL, 3, NULL);
}` },
      `Flash the skeleton unchanged first. The sensor task has no sensor yet and reports an error every second, so you should see \`state=3 temp_c10=0 sensor=FAULT\` once a second: the pipeline from sensor task through controller to display task works, and the fault path is the first thing you have tested.

Then integrate in this order, proving each stage before starting the next:

1. **A fake sensor.** Make \`sensor_task\` produce a slow ramp from 25.0 to 32.0 °C and back. You should see NORMAL → ALARM as the ramp crosses 30.0 and back to NORMAL below 29.0. The whole application now runs with no hardware attached.
2. **The button.** Reuse the ISR, semaphore and debounce from project 9. You should see ALARM → SILENCED on a press during the alarm, and no effect in NORMAL.
3. **The alarm output.** Drive it from \`alarm_buzzer_on(st)\` with LEDC. You should hear or see it only in ALARM.
4. **The real sensor.** Scan the I2C bus first and confirm the address against the datasheet. Read the identification register if the part has one. Only then read measurements, and compare them with a second instrument.
5. **The display.** Start with one fixed string. Then draw from \`view_t\`.
6. **Settings in NVS**, with a way to change them (step 8).
7. **Wi-Fi reporting**, last, from project 8. Then switch the access point off and confirm that steps 1 to 6 are unaffected.`,
      { t: 'callout', kind: 'why', title: 'Why the fake sensor comes first', md: `With a fake, you control the input exactly: you can produce a threshold crossing on demand, hold a value in the hysteresis band, or inject an error every tenth reading. When the real sensor is fitted and something misbehaves, you already know the logic is sound, so the fault is in the new part. Integrating everything at once means every fault could be anywhere.` },
    ] },
    { title: 'Store and validate settings', blocks: [
      `The skeleton's \`settings_load\` and \`settings_save\` keep the settings as one blob in NVS and run every value through \`settings_valid\` in both directions. Add a way to change a setting — a long button press that steps the threshold, or a command typed on the serial console — and call \`settings_save\` from the controller task.

Test the three cases that matter:

- **First boot.** Erase the flash (\`idf.py erase-flash\`), then flash and run. You should see the defaults in use and no error.
- **Persistence.** Change the threshold, power-cycle the board. You should see the new value after restart.
- **Corruption.** Temporarily make \`settings_save\` skip validation and store a threshold of 30000, restart, and you should see \`stored settings missing or invalid, using defaults\`. Then restore the validation.`,
      { t: 'predict', q: 'A later firmware version adds a field to `settings_t`. A device updated in the field still has the old, shorter blob in NVS. What does `settings_load` do, as written?', reveal: '`nvs_get_blob` is asked for `sizeof tmp` bytes of the new, larger structure. The stored blob is shorter, so the returned `len` is not equal to `sizeof tmp`; the code treats that as invalid and falls back to defaults. That is safe, but the user\'s settings are silently lost on every update that changes the structure. A product would store a version number with the settings and migrate old layouts. Decide what your device does and write it in the design document.' },
      { t: 'callout', kind: 'security', title: 'What NVS does and does not protect', md: `NVS is ordinary flash. Anyone with the device and a USB cable can read it, and modify it, unless NVS encryption and flash encryption are enabled. Do not store a secret there and assume it is hidden, and do not assume a value read from it is one your firmware wrote. Validation on load is a safety measure and also a security measure.` },
    ] },
    { title: 'Write and run the test plan', md: `Turn every requirement into at least one test case with: an identifier, the requirement it covers, the set-up, the action, the expected observation ("you should see …") and space for the result. Include a capture or log extract as evidence for the ones that need it. Then run the plan from start to finish on the finished device and record the results honestly, including failures.

A requirement with no test is untested; a test with no requirement is either unnecessary or reveals a requirement you forgot to write. The testing section below lists the minimum set for the reference design.` },
    { title: 'Debugging exercises', blocks: [
      { t: 'exercise', prompt: `**Exercise A.** The sensor and the OLED are on the same I2C bus. Each works perfectly alone. With both tasks running, the display shows corrupted rows every few minutes and the sensor occasionally returns an error. A capture during a failure shows a start condition and an address byte for the sensor in the middle of a long display data transfer. What is the cause, and what are the two sound ways to fix it?`, hints: ['How many tasks issue transactions on the bus?', 'What happens if one task is pre-empted part-way through a transfer made of several driver calls?'], answer: { type: 'text', accept: ['mutex', 'lock', 'owner', 'share', 'interleav', 'one task'], nudge: 'Think about who is allowed to start a transaction and when.' }, solution: `Two tasks use one bus with nothing coordinating them. A multi-part display update is pre-empted by the higher-priority sensor task, whose transaction lands inside it; the display interprets what follows as its own data, and the sensor's transfer may be rejected. It is rare because the pre-emption must fall inside a transfer. Fix one: a single **mutex** taken around every complete logical transaction on the bus by both drivers. Fix two: a single **bus-owner task** that performs all I2C work and takes requests from a queue. Either way the rule is one owner per resource. Check whether your I2C driver already serialises individual calls; even if it does, a sequence of calls that must not be split still needs your own lock.` },
      { t: 'exercise', prompt: `**Exercise B.** In testing, switching the access point off makes the alarm respond up to 10 s late, and the display freezes for the same time. The controller is below. Find the design error.`, code: String.raw`static void controller_task(void *arg)
{
    app_msg_t m;
    for (;;) {
        xQueueReceive(s_events, &m, portMAX_DELAY);
        st = alarm_step(st, m.ev, m.temp_c10, &s_cfg);
        set_buzzer(alarm_buzzer_on(st));
        update_display(st, m.temp_c10);
        if (m.ev == EV_SAMPLE)
            http_post_reading(m.temp_c10);     /* timeout_ms = 10000 */
    }
}`, hints: ['Which call can take seconds?', 'While that call is waiting, what happens to events arriving in `s_events`?', 'Which requirement of the reference design does this violate?'], answer: { type: 'text', accept: ['block', 'network', 'post', 'http', 'separate task', 'synchronous'], nudge: 'Look for the one call whose duration depends on something outside the device.' }, solution: `The controller makes a **blocking network call**. With the access point down, \`http_post_reading\` waits for its 10 s timeout, and for that time the controller is not reading \`s_events\`: button presses and samples queue up, the alarm and display lag. The task that owns the safety behaviour must never wait on I/O it does not control. Move reporting to a network task that receives a copy of the latest view through a length-1 overwrite queue, as in the skeleton, and move the display out likewise. The requirement violated is that measuring and alarming continue with no network — and the test that found it is exactly the one that is tempting to skip.` },
      { t: 'exercise', prompt: `**Exercise C.** A device in the field starts sounding its alarm continuously at 21 °C after a firmware update. The update changed \`settings_t\` by inserting a new first field. The new firmware's load function is below. Explain the failure, and list what should have prevented it.`, code: String.raw`static void settings_load(settings_t *out)
{
    nvs_handle_t h;
    size_t len = sizeof *out;
    if (nvs_open("app", NVS_READONLY, &h) == ESP_OK) {
        nvs_get_blob(h, "cfg", out, &len);
        nvs_close(h);
    }
}`, hints: ['What bytes are in the stored blob, and which fields do they land on now?', 'What is checked after the read?', 'What does `out` contain if the read fails entirely?'], answer: { type: 'text', accept: ['valid', 'version', 'layout', 'default', 'check', 'length'], nudge: 'Follow the old bytes into the new structure.' }, solution: `The old blob's bytes are copied into the new structure, whose fields have moved: the old threshold lands in the new first field, the old hysteresis is read as the threshold, and so on. A hysteresis of 10 (1.0 °C) interpreted as the alarm threshold means "alarm above 1.0 °C". Nothing is checked: not the return code, not the length, not the values. And if the read fails, \`out\` is left uninitialised. What should have prevented it: load defaults first; check the return value and that \`len\` matches; run every field through a range check; store a **layout version** and migrate or reject old layouts; and have a test in the plan that boots new firmware on top of settings written by the old one.` },
    ] },
  ],
  walkthrough: [
    `### How the skeleton is put together

**Messages, not shared variables.** \`app_msg_t\` is the only way anything reaches the controller. The sensor task and the button task each build one on their own stack and \`xQueueSend\` copies it into the queue's storage. From then on there is no shared memory between sender and receiver, so there is nothing to lock.

**The controller is a loop around one pure function.** It blocks in \`xQueueReceive\` using no CPU. When a message arrives, \`alarm_step\` computes the next state from the old state, the event and the settings; the controller then updates the view and the outputs. It makes no call that can wait on a bus, a display or a network. Its worst-case response time is therefore the time to run a few dozen instructions plus the time for which higher-priority tasks or interrupts hold the CPU.

**\`xQueueOverwrite\` as a mailbox.** \`s_view_ui\` and \`s_view_net\` have length 1. Overwrite replaces the stored item if one is there and never blocks. The display task wakes when a view is available, takes its copy, and may spend as long as it likes drawing; meanwhile the controller may have overwritten the mailbox several times, and the display then gets only the newest. That is exactly the wanted behaviour for "show the current state".

**Settings have one writer.** \`s_cfg\` is written only by the controller task (at start-up in \`app_main\` before the tasks exist, and later from the settings UI running in the controller). Other tasks that need a setting receive it in a message. This is why it needs no mutex. If you let another task read it directly, you have created shared state and must protect it.

### What NVS does on the flash

\`nvs_open("app", …)\` finds or creates a namespace, a prefix that keeps your keys apart from those of the Wi-Fi driver and other components. \`nvs_set_blob\` appends a new entry for the key to a log-structured page in the NVS partition; flash bits can only be changed from 1 to 0 without an erase, so NVS never rewrites in place and instead marks the old entry as superseded. \`nvs_commit\` makes sure the entry is written out. When a page fills, live entries are copied to a fresh page and the old one is erased, which also spreads erase cycles across the partition. The consequence for you: writing a setting is cheap, but writing it every second for years will wear the flash out. Save when the user changes something, not periodically.

### Where each earlier project fits

| Part of the device | Comes from | What to carry over |
|---|---|---|
| Sensor on I2C | project 5 | address scan first; check every return code |
| Button | projects 2 and 9 | ISR gives a semaphore; debounce in the task |
| Buzzer or LED PWM | project 3 | LEDC timer and channel; transistor for the load |
| Display over I2C or SPI | projects 5 and 6 | one owner for the bus; verify with a capture |
| Wi-Fi reporting | project 8 | events and backoff; TLS with verification; no blocking in handlers |
| Task structure | project 9 | queue by value; mutex only for true shared state; stack marks; watchdog |
| A second board as remote display | project 7 | framed protocol with CRC |`,
  ],
  testing: [
    `Minimum test plan for the reference design. Extend it to cover every requirement of your own device.

| ID | Covers | Action | You should see |
|---|---|---|---|
| T1 | logic | \`./app_logic_test\` on the PC | \`app_logic: all checks passed\` |
| T2 | F1, F2 | Normal running; compare with a second thermometer | Display and log within the sensor's stated accuracy of the reference; updated every period |
| T3 | F3 | Warm the sensor past the threshold (hand, warm air — not a flame) | Alarm output active within the required time of the crossing sample |
| T4 | F4 | Let it cool slowly through the threshold | No chatter; alarm clears only below threshold minus hysteresis |
| T5 | F5 | Press the button during an alarm | Output off at once; display shows the silenced state; re-alarms on the next excursion |
| T6 | F6 | Unplug the sensor's SDA wire while running | Fault state within the required time; no stale reading shown; recovery when reconnected |
| T7 | F7 | Change the threshold; power-cycle | New value in use after restart |
| T8 | F7, S3 | Boot with erased flash; boot with an invalid stored value | Defaults used; a log line says so; no crash |
| T9 | F8 | Normal running with network | A report at your server each period, with plausible values |
| T10 | F9 | Switch the access point off for 10 minutes, repeat T3 and T5 during the outage | Alarm and button behave exactly as before; reporting resumes afterwards |
| T11 | S1 | Search the repository and its history for the passphrase | Not present |
| T12 | S2 | Point the report URL at a host with an untrusted certificate | Report refused; nothing received by that host |
| T13 | robustness | Run for an hour; read the stack marks and free heap at start and end | Every stack keeps a margin; free heap is not falling steadily |
| T14 | robustness | Hang one task deliberately | The task watchdog names it |
| T15 | bus | Capture I2C during a display update and a sensor read | Complete, non-overlapping transactions; every address acknowledged |`,
    { t: 'callout', kind: 'note', title: 'Evidence', md: `For each test keep something another person could inspect: a log extract with timestamps, a capture file, a photograph of the meter. "It worked when I tried it" is not a result. Nothing in this course's material was itself run on hardware, so your records are the first real measurements of your design — treat any expected value given here as a prediction to be checked.` },
  ],
  troubleshooting: [
    { symptom: 'Each peripheral works alone but they fail together', cause: 'A shared bus or shared pin without a single owner; or two drivers configuring the same peripheral instance', fix: 'Go back to the ownership table. Capture the bus during a failure and look for interleaved transactions.' },
    { symptom: 'Board no longer boots or flashes once everything is wired', cause: 'A load or pull resistor on a strapping pin, or something connected to GPIO6–11', fix: 'Disconnect peripherals one by one until it boots; re-check the pin budget against the strapping pin list.' },
    { symptom: 'Resets when the buzzer sounds or Wi-Fi transmits', cause: 'Supply droop: load powered through a GPIO or from a rail that cannot supply the peak; no bulk capacitance', fix: 'Redo the power budget with peak currents; drive the load through a transistor from the 5 V rail; add capacitance near the load.' },
    { symptom: 'I2C scan finds nothing', cause: 'Missing pull-ups, SDA and SCL swapped, device unpowered, or wrong pins in the bus configuration', fix: 'Measure SDA and SCL idle: both must sit at 3.3 V. Capture the scan: every address should at least be clocked out.' },
    { symptom: 'Display shows garbage or half a screen', cause: 'Wrong controller or resolution assumed, wrong address, or transfers interrupted by another bus user', fix: 'Confirm the controller from the module documentation; send one known pattern; check bus ownership.' },
    { symptom: 'Alarm flickers on and off near the threshold', cause: 'No hysteresis, or hysteresis smaller than the sensor noise', fix: 'Log raw readings to see the noise amplitude; set the margin above it or filter the readings first.' },
    { symptom: 'Everything stalls for seconds when the network is down', cause: 'A blocking network call in a task that also does local work', fix: 'Move all network I/O to its own low-priority task fed by an overwrite queue.' },
    { symptom: 'Settings revert to defaults after every update', cause: 'The settings structure changed size or layout and the stored blob fails validation', fix: 'Add a layout version and a migration path; test updates on top of old stored settings.' },
    { symptom: 'Device works for hours, then resets or hangs', cause: 'Stack exhaustion on a rare path, a slow heap leak, or a deadlock', fix: 'Log stack marks and free heap periodically; subscribe tasks to the watchdog; read the reset reason at start-up.' },
  ],
  challenge: `Take your device from "works on the bench" to something you would leave running unattended for a month, and then hand it to someone else to attack.

- **Update path.** Add over-the-air update using ESP-IDF's OTA support with two application partitions. State what verifies an image before it is run, and what happens if power fails half-way through an update. Test both.
- **Recovery.** Read the reset reason at start-up and count unexpected resets in NVS. Decide what the device does after three watchdog resets in a row.
- **Hardening review.** Go through the security requirements with a second person playing the attacker, with physical access to a unit you own: what can they read over the serial port, from the flash, from the network? Which ESP-IDF features (secure boot, flash encryption, NVS encryption) would change the answer, and which of those are irreversible once enabled? Do **not** enable eFuse-based features on a board you are not prepared to dedicate to that purpose; write the plan instead.
- **Soak test.** Run for at least 24 hours with periodic access-point outages. Report uptime, reset count, minimum stack margins, heap trend, and reports sent versus expected.

No solution is given. The deliverable is the updated design document, the soak-test log, and a one-page list of what an attacker with the device in hand can still do.`,
  requirements: {
    functional: [
      '**F1.** The device measures the chosen quantity at least once per second and discards any reading outside the sensor\'s specified range.',
      '**F2.** The display (or serial dashboard) shows the latest reading with its unit, and the current state, no more than 2 s after the reading was taken.',
      '**F3.** When a reading is at or above the configured threshold, the alarm output becomes active within 500 ms of that reading.',
      '**F4.** The alarm clears only when a reading falls below the threshold minus the configured hysteresis.',
      '**F5.** A button press during an alarm silences the output until the condition has cleared; a later excursion alarms again.',
      '**F6.** If the sensor cannot be read, the device enters a fault state within 5 s, indicates the fault distinctly, and never presents a stale reading as current.',
      '**F7.** Threshold, hysteresis and report period are stored in NVS, survive power loss, and are replaced by defaults if missing or invalid.',
      '**F8.** While the network is available, the device reports the latest reading and state to a configured server once per report period.',
      '**F9.** Requirements F1 to F7 hold with the network unavailable for any length of time, and reporting resumes without a reset when the network returns.',
      '**F10.** A hung task is detected by a watchdog and results in a logged, diagnosable reset.',
    ],
    security: [
      '**S1.** No credential, key or token appears in the source repository or its history.',
      '**S2.** All data leaving the device over the network uses TLS with server certificate verification; a server with an untrusted certificate is refused.',
      '**S3.** Every value taken from storage, the network or the user is range-checked before use; no input can cause a write or read outside a buffer.',
      '**S4.** No setting can be changed over the network without authentication; if no authenticated channel is implemented, settings are changeable only locally.',
      '**S5.** The serial log contains no secrets, and the design document states what an attacker with physical access to the device can read and modify.',
      '**S6.** The device has no default or shared password; any per-device secret is unique to that device.',
    ],
  },
  rubric: [
    { criterion: 'Requirements', points: 10, evidence: 'Numbered, testable functional and security requirements, each with a named test; fault conditions included.' },
    { criterion: 'Block diagram and part selection', points: 10, evidence: 'Every part and interface shown with voltages; datasheet references for supply range, interface, address and current.' },
    { criterion: 'Pin budget', points: 10, evidence: 'Completed table; each pin checked against strapping, flash, input-only and ADC2 restrictions; I2C address map without conflicts.' },
    { criterion: 'Power budget', points: 10, evidence: 'Typical and peak currents from datasheets with sections cited; comparison with regulator and USB limits; one measured value compared with the estimate.' },
    { criterion: 'Task architecture', points: 15, evidence: 'Task and queue diagram; ownership table with one owner per resource; task table with priorities justified by deadlines; measured stack margins.' },
    { criterion: 'State machine and host tests', points: 15, evidence: 'State diagram and complete state/event table; pure-C implementation; PC tests covering every transition, hysteresis and the fault paths, all passing.' },
    { criterion: 'Implementation quality', points: 10, evidence: 'No blocking I/O in the controller or in event handlers; return codes checked; no shared state without a stated rule; builds without warnings.' },
    { criterion: 'Test plan and results', points: 10, evidence: 'Executed plan with evidence per test, including network-down, sensor-missing and corrupt-settings cases; failures recorded honestly.' },
    { criterion: 'Security', points: 10, evidence: 'Threat model; S1 to S6 each demonstrated or explicitly marked as not met with the reason; bad-certificate test result.' },
  ],
  quiz: [
    { kind: 'arch', q: 'A sensor driver task and a display driver task both use the same I2C bus. Which arrangement is sound?', choices: [
      { t: 'One mutex taken around every complete transaction by both, or a single bus-owner task serving requests from a queue', ok: true, why: 'Both give the bus one owner at a time for the whole of a logical transaction, so transfers cannot interleave.' },
      { t: 'Give the sensor task a higher priority so that its transfers always finish first', why: 'Higher priority is precisely what lets it interrupt the display task in the middle of a transfer. Priority orders tasks; it does not make a sequence of bus operations indivisible.' },
      { t: 'Nothing special: I2C addresses keep the two devices apart', why: 'Addresses select which device listens. They do not stop one controller-side task from starting a new transaction inside another task\'s unfinished one.' },
    ] },
    { kind: 'circuit', q: 'On an original ESP32 that uses Wi-Fi, which pin assignment is acceptable?', choices: [
      { t: 'An analog sensor on GPIO34', ok: true, why: 'GPIO34 is an ADC1 input, which is unaffected by Wi-Fi, and an analog sensor needs only an input, which is all GPIO34 can be.' },
      { t: 'An analog sensor on GPIO27', why: 'GPIO27 is on ADC2, which the Wi-Fi driver uses; conversions there are not available while Wi-Fi is in use.' },
      { t: 'An LED on GPIO35', why: 'GPIO34 to GPIO39 are input-only. The pin has no output driver to light an LED.' },
      { t: 'A push button to ground on GPIO0', why: 'GPIO0 is sampled at reset to choose the boot mode. A button holding it low during reset stops the application from starting.' },
    ] },
    { kind: 'concept', q: 'The alarm threshold is 30.0 °C with 1.0 °C hysteresis and readings carry ±0.3 °C of noise. Why does the alarm not chatter when the true temperature sits at 30.0 °C?', choices: [
      { t: 'Once on, it stays on until a reading falls below 29.0 °C, and noise of ±0.3 °C cannot carry a 30.0 °C value that far', ok: true, why: 'Two separate trip points mean the noise would have to span the gap between them to cause repeated transitions.' },
      { t: 'Because hysteresis averages the readings', why: 'No averaging takes place. The readings are compared as they are, but against two different levels depending on the current state.' },
      { t: 'Because the alarm is only evaluated once per minute', why: 'It is evaluated on every sample. What prevents chatter is the gap between the on and off levels.' },
    ] },
    { kind: 'arch', q: 'Why must the controller task never perform an HTTP request itself?', choices: [
      { t: 'The request can block for seconds when the network is down, and during that time the controller would not process sensor or button events', ok: true, why: 'The task that owns the alarm behaviour must have a response time that does not depend on anything outside the device.' },
      { t: 'HTTP functions can only be called from the main task', why: 'They can be called from any task with enough stack. The issue is what the calling task fails to do while it waits.' },
      { t: 'It would use too much flash', why: 'The HTTP code takes the same flash whichever task calls it. The concern is time, not size.' },
    ] },
    { kind: 'security', q: 'Settings are loaded from NVS at start-up. Why validate them even though only your own firmware writes them?', choices: [
      { t: 'Flash can be blank, partly written, written by an older layout, or modified by someone with physical access; unvalidated values then drive the device\'s behaviour', ok: true, why: 'Storage is an input like any other. Validation protects against accidents and against tampering with the same few lines.' },
      { t: 'NVS returns random data on every read unless the values are validated', why: 'NVS returns what was stored. The danger is that what was stored may not be what the current firmware expects.' },
      { t: 'Validation is needed only if NVS encryption is enabled', why: 'Encryption hides contents from a reader; it does not make an old layout or an out-of-range value meaningful to new firmware.' },
    ] },
    { kind: 'concept', q: 'Why is the fake-sensor stage worth doing before the real sensor is connected?', choices: [
      { t: 'It proves the tasks, queues and state machine with fully controlled input, so that later faults can be attributed to the newly added hardware', ok: true, why: 'Integrating one unknown at a time keeps the search space for any fault small, and the fake can produce cases the real sensor cannot produce on demand.' },
      { t: 'Real sensors must warm up for several hours before use', why: 'Some sensors do need settling time, but that is not why a fake is used. The reason is control over the input and isolation of faults.' },
      { t: 'The ESP32 cannot run I2C and FreeRTOS tasks until the logic has been tested', why: 'There is no such restriction. The order is an engineering choice to make faults easy to locate.' },
    ] },
  ],
};


// ───────────────────────────── section-level material ─────────────────────────────
const glossary = [
  { term: 'SPI mode', def: 'One of four combinations of clock polarity (CPOL, the level SCLK rests at) and clock phase (CPHA, whether data is sampled on the first or second edge). Controller and peripheral must use a mode in which data changes on the edge opposite to the one it is sampled on.' },
  { term: 'Chip select', def: 'The active-low line (CS, also SS or nCS) with which an SPI controller selects one peripheral and marks the start and end of a transaction.' },
  { term: 'Shift register', def: 'A chain of flip-flops that moves each stored bit one stage along on every clock edge. A serial-in, parallel-out part such as the 74HC595 turns a serial bit stream into several output pins.' },
  { term: 'JEDEC ID', def: 'Three bytes (manufacturer, memory type, capacity) that an SPI NOR flash chip returns in response to command `0x9F`. Reading it is a standard first test of an SPI bus, because the expected value is in the datasheet.' },
  { term: 'Loopback test', def: 'Connecting a transmitter to its own receiver so that one device can verify its configuration and pins without a second device.' },
  { term: 'Framing', def: 'The rules that divide a stream of bytes into messages: typically a start marker, a length, the payload and a check value.' },
  { term: 'CRC', def: 'Cyclic redundancy check. The remainder of dividing a message, treated as a binary polynomial, by a fixed generator polynomial. It detects accidental corruption very well and offers no protection against deliberate forgery, since it uses no secret.' },
  { term: 'Logic-level compatibility', def: 'Whether one part\'s output voltages are valid inputs for another: output-high above the receiver\'s VIH, output-low below its VIL, and nothing above the receiver\'s absolute maximum input voltage.' },
  { term: 'Station mode', def: 'The Wi-Fi role in which a device joins an existing access point as a client, as opposed to acting as an access point itself.' },
  { term: 'Event loop', def: 'In ESP-IDF, a queue plus a task that delivers posted events to registered handler functions one at a time. A handler that blocks delays every other event on that loop.' },
  { term: 'Exponential backoff', def: 'Doubling the wait between retries after each failure, up to a cap, so that short faults recover quickly and long ones cause little load.' },
  { term: 'Certificate verification', def: 'The TLS client\'s check that the server\'s certificate chains to a trusted root, names the intended host and is backed by the matching private key. Without it, TLS encrypts the connection to whoever answers.' },
  { term: 'Kconfig', def: 'The configuration system used by ESP-IDF. Options declared in `Kconfig` files are set with `idf.py menuconfig`, stored in `sdkconfig` and exposed to C code as `CONFIG_…` macros.' },
  { term: 'Binary semaphore', def: 'An RTOS object with two states, available or not, used to signal that an event happened. It has no owner, so an interrupt may give it; it is not suitable for protecting data.' },
  { term: 'Mutex', def: 'An RTOS lock with an owner, used to ensure that only one task at a time uses a resource. FreeRTOS mutexes apply priority inheritance to the holder.' },
  { term: 'Priority inheritance', def: 'Temporarily raising a mutex holder\'s priority to that of the highest-priority task waiting for the mutex, which bounds how long that task can be kept waiting.' },
  { term: 'Stack high-water mark', def: 'The smallest amount of free stack a task has had since it started, as recorded by the kernel. In ESP-IDF it is reported in bytes.' },
  { term: 'Task watchdog', def: 'An ESP-IDF timer that subscribed tasks must reset periodically. A task that fails to do so is reported by name, and the chip can be made to reset.' },
  { term: 'Deadlock', def: 'A state in which two or more tasks each wait for a resource another of them holds, so none can proceed. Taking locks in one fixed global order prevents it.' },
  { term: 'Hysteresis', def: 'Using different thresholds for switching on and switching off, so that noise smaller than the gap cannot cause repeated transitions.' },
  { term: 'Pin budget', def: 'A table assigning every signal of a design to a pin, checked against the chip\'s restrictions (strapping pins, flash pins, input-only pins, peripheral conflicts) before any hardware is built.' },
  { term: 'NVS', def: 'Non-volatile storage: ESP-IDF\'s key–value store kept in a flash partition. It survives resets and power loss, is wear-levelled, and is readable by anyone with the device unless encryption is enabled.' },
];

const troubleshooting = [
  { symptom: 'SPI peripheral gives no sign of life although the function calls return ESP_OK', area: 'SPI', causes: 'SPI has no acknowledgement, so the driver cannot detect a missing or miswired device. Typical causes are a wrong CS pin, the peripheral unpowered, or MOSI and MISO swapped.', fix: 'Capture CS, SCLK and MOSI at the peripheral\'s own pins. Read a register with a known value, such as an ID, to prove both directions.' },
  { symptom: 'SPI data is shifted by one bit or correct only some of the time', area: 'SPI', causes: 'Mode mismatch: the controller changes data on the edge the peripheral samples on. Less often, ringing on a long clock wire produces extra edges.', fix: 'Derive CPOL and CPHA from the datasheet timing diagram and confirm on a capture that data is stable across every sampling edge.' },
  { symptom: 'UART link between two boards receives nothing', area: 'UART', causes: 'TX connected to TX, wrong pins passed to `uart_set_pin`, or the link placed on pins used by the module\'s flash.', fix: 'Loopback-test each board alone, then probe each RX pin for the other board\'s traffic.' },
  { symptom: 'UART link works on the bench and fails when the boards have separate supplies', area: 'UART', causes: 'No common ground. Shared USB power had been providing the reference.', fix: 'Connect ground between the boards alongside the data wires.' },
  { symptom: 'Receiver gets out of step and misreads every following message', area: 'Protocols', causes: 'Raw bytes with no framing, or a parser with no timeout that waits for ever for the rest of a truncated frame.', fix: 'Frame messages with a start marker, length and CRC; abandon a partial frame after a period of silence.' },
  { symptom: 'Device never rejoins Wi-Fi after the access point restarts', area: 'Wi-Fi', causes: 'The disconnected event is not handled, the handler blocks the event loop, or a retry timer is not re-armed.', fix: 'Handle `WIFI_EVENT_STA_DISCONNECTED` by scheduling `esp_wifi_connect()` with backoff from a timer; test with a deliberate outage.' },
  { symptom: 'Brownout reset when Wi-Fi starts or transmits', area: 'Power', causes: 'The supply or cable cannot deliver the transmit current peaks.', fix: 'Use a short cable and a capable port or supply; add bulk capacitance near the module; check the peak current in the module datasheet.' },
  { symptom: 'HTTPS request fails until certificate checking is disabled', area: 'Wi-Fi', causes: 'The server\'s root certificate is not trusted by the firmware, the URL host name does not match the certificate, or dates are checked without a valid clock.', fix: 'Embed the correct root or use the certificate bundle, fix the host name, set the time. Leave verification on.' },
  { symptom: 'Random crashes far from recently changed code', area: 'RTOS', causes: 'A task stack overflow overwriting neighbouring memory, or a task-level kernel call made from an ISR.', fix: 'Enable stack overflow checking, log high-water marks, and audit ISRs for calls without `FromISR`.' },
  { symptom: 'Task watchdog fires and names the idle task', area: 'RTOS', causes: 'A higher-priority task runs without ever blocking.', fix: 'Make the task wait on a queue, semaphore or delay instead of polling in a loop.' },
  { symptom: 'System freezes and the watchdog names two tasks', area: 'RTOS', causes: 'Deadlock from two mutexes taken in opposite orders.', fix: 'Adopt one lock order everywhere, or give each resource an owner task so that no task holds two locks.' },
  { symptom: 'Alarm or user interface lags whenever the network is slow', area: 'Architecture', causes: 'Blocking network I/O performed in the task that also handles local events.', fix: 'Move network work to its own task and pass it copies of the data through a queue.' },
];

const refs = [
  { org: 'Espressif', title: 'ESP-IDF v6.1: SPI master driver', url: IDF + 'api-reference/peripherals/spi_master.rst', note: 'Documentation source on GitHub; the URL path was not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: UART driver', url: IDF + 'api-reference/peripherals/uart.rst', note: 'Documentation source on GitHub; not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: GPIO summary for the original ESP32 (strapping, input-only, flash and ADC2 pins)', url: IDF + 'api-reference/peripherals/gpio/esp32.inc' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: ADC oneshot driver (ADC2 and Wi-Fi)', url: IDF + 'api-reference/peripherals/adc/adc_oneshot.rst' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: Wi-Fi driver guide (events, reason codes)', url: IDF + 'api-guides/wifi.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: HTTP server', url: IDF + 'api-reference/protocols/esp_http_server.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: HTTP client', url: IDF + 'api-reference/protocols/esp_http_client.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: certificate bundle', url: IDF + 'api-reference/protocols/esp_crt_bundle.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: FreeRTOS in ESP-IDF (stack sizes in bytes, dual-core behaviour)', url: IDF + 'api-reference/system/freertos_idf.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: watchdogs', url: IDF + 'api-reference/system/wdts.rst', note: 'Not load-tested.' },
  { org: 'Espressif', title: 'ESP-IDF v6.1: non-volatile storage', url: IDF + 'api-reference/storage/nvs_flash.rst', note: 'Not load-tested.' },
  { org: 'FreeRTOS', title: 'FreeRTOS kernel source (queue.c, tasks.c, semphr.h)', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel' },
  { org: 'Texas Instruments', title: 'SN74HC595 datasheet (pinout, timing diagram, current limits)', url: 'https://www.ti.com/lit/ds/symlink/sn74hc595.pdf', note: 'Not load-tested. Use the datasheet from the manufacturer of the part you actually have.' },
  { org: 'sigrok', title: 'PulseView logic analyser software', url: 'https://github.com/sigrokproject/pulseview' },
];

export default { skills, lessons: [], labs: [p6, p7, p8, p9, p10], glossary, troubleshooting, refs };
