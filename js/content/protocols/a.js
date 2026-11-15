// Protocols, part A: serial basics, UART, baud rates and clocks, I2C.

// ---- small helpers that draw digital waveforms as inline SVG ----
const CELL = 44;
function trace(levels, yHigh, yLow, x0 = 70, cell = CELL) {
  let d = `M${x0} ${levels[0] ? yHigh : yLow}`;
  levels.forEach((v, i) => { const y = v ? yHigh : yLow; d += ` L${x0 + i * cell} ${y} L${x0 + (i + 1) * cell} ${y}`; });
  return d;
}
const txt = (x, y, s, extra = '') => `<text x="${x}" y="${y}" font-size="12" fill="currentColor" text-anchor="middle" ${extra}>${s}</text>`;

// 'A' = 0x41 = 0100 0001, sent LSB first: 1 0 0 0 0 0 1 0
const uartLevels = [1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 1];
const uartNames = ['idle', 'start', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'stop', 'idle'];
const uartFrameSvg = `<svg viewBox="0 0 640 150" role="img" aria-label="UART frame for the byte 0x41">
  <path d="${trace(uartLevels, 40, 90)}" fill="none" stroke="var(--sig1)" stroke-width="2.5"/>
  ${uartNames.map((n, i) => txt(70 + i * CELL + CELL / 2, 112, n)).join('')}
  ${uartLevels.map((v, i) => txt(70 + i * CELL + CELL / 2, 30, v)).join('')}
  ${uartNames.map((n, i) => (i >= 1 && i <= 10 ? `<line x1="${70 + i * CELL + CELL / 2}" y1="46" x2="${70 + i * CELL + CELL / 2}" y2="96" stroke="var(--sig3)" stroke-dasharray="3 3"/>` : '')).join('')}
  ${txt(34, 44, '3.3 V')}${txt(34, 94, '0 V')}
  ${txt(320, 138, 'dashed lines: where the receiver samples (middle of each bit)')}
</svg>`;

// I2C: start, a few clocked bits, stop
const i2cSvg = `<svg viewBox="0 0 640 170" role="img" aria-label="I2C start condition, data bits and stop condition">
  ${txt(30, 49, 'SDA')}${txt(30, 119, 'SCL')}
  <path d="M60 35 L110 35 L110 65 L170 65 L170 35 L250 35 L250 65 L530 65 L530 35 L600 35" fill="none" stroke="var(--sig2)" stroke-width="2.5"/>
  <path d="M60 105 L140 105 L140 135 L190 135 L190 105 L230 105 L230 135 L270 135 L270 105 L310 105 L310 135 L350 135 L350 105 L390 105 L390 135 L490 135 L490 105 L600 105" fill="none" stroke="var(--sig1)" stroke-width="2.5"/>
  <rect x="96" y="22" width="52" height="124" fill="none" stroke="var(--sig3)" stroke-dasharray="4 3"/>
  <rect x="504" y="22" width="52" height="124" fill="none" stroke="var(--sig3)" stroke-dasharray="4 3"/>
  ${txt(122, 162, 'START')}${txt(530, 162, 'STOP')}
  ${txt(210, 162, 'bit = 1')}${txt(290, 162, 'bit = 0')}${txt(370, 162, 'bit = 0')}
  ${txt(320, 14, 'SDA may change only while SCL is low; it is read while SCL is high')}
</svg>`;

const lessons = [
  // ------------------------------------------------------------------ 1
  {
    id: 'proto-basics', title: 'Signals on a wire: serial communication basics', minutes: 35,
    summary: 'Parallel or serial, clocked or not, who may drive the line, and what the line does when nobody is talking.',
    skills: ['proto-line-states'],
    blocks: [
      `## The problem
A sensor board 30 cm away has an 8-bit reading for your microcontroller. The obvious way is eight wires, one per bit, plus a ninth that says "the value is valid now". It works on a breadboard. Then the product needs four sensors, the cable becomes a 40-way ribbon, and at higher speeds the bits stop arriving at the same instant.

Every protocol in this section is an answer to the same four questions:

1. **How many wires carry the data?** (parallel or serial)
2. **How does the receiver know *when* to look at the wire?** (a shared clock, or an agreement about timing)
3. **Who is allowed to drive a wire, and when?** (direction, duplex, output type)
4. **What does the wire do when nobody is talking?** (the idle state)

If you can answer those four for a bus you have never seen, you can read its waveform.

## Parallel and serial
A **parallel** link sends several bits at the same time on several wires. A **serial** link sends them one after another on one wire.

Parallel sounds faster, and inside a chip it is. Between boards it has three costs. It uses pins, and pins are the scarcest thing on a small microcontroller. It uses copper and connector positions. And the bits do not travel identically: each wire has a slightly different length and capacitance, so the bits arrive at slightly different times ([[Skew]]). The receiver has to wait until the slowest bit has settled, and that wait limits the speed.

A serial link has one data signal, so there is nothing to be skewed against. That is why almost every link that leaves a chip today — USB, Ethernet, SATA, CAN, and everything in this section — is serial, even the very fast ones.

## How the receiver knows when to sample
A wire carries a voltage that changes over time. To turn that into bits the receiver must sample it at the right instants. There are two ways to agree on those instants.

**Synchronous**: the sender provides a second wire, the **clock**. Each clock edge says "sample now". SPI and I2C work like this. The two ends do not need accurate oscillators, because the receiver never measures time; it just follows the edges. The sender can even pause mid-byte.

**Asynchronous**: there is no clock wire. Both ends agree in advance on how long a bit lasts (the [[Baud rate]]), and the receiver uses its own oscillator to time the samples, re-aligning at the start of every byte. UART works like this. It saves a wire, but both oscillators must be accurate, and nothing on the wire tells you the speed.

Some buses hide the clock inside the data (CAN, USB): the receiver recovers timing from the data edges themselves, and the protocol guarantees that edges happen often enough. You will meet that in the CAN lesson as [[Bit stuffing]].

## Direction: simplex, half duplex, full duplex
- **Simplex**: data flows one way only, ever. A sensor that only streams readings.
- **Half duplex**: both directions, but one at a time, usually sharing the same wire. I2C, CAN, RS-485 on two wires. Somebody has to decide whose turn it is.
- **Full duplex**: both directions at the same time, on separate wires. UART (TX and RX), SPI (MOSI and MISO).

Half duplex saves wires and costs you a rule about turns. Much of what makes a bus protocol complicated is that rule.`,
      { t: 'ascii', caption: 'The four questions, answered for the buses in this section', text:
`Bus      data wires        clock           direction       outputs        idle state
-------  ----------------  --------------  --------------  -------------  ---------------------
UART     TX, RX            none (baud)     full duplex     push-pull      high
I2C      SDA               SCL (shared)    half duplex     open-drain     SDA high, SCL high
SPI      MOSI, MISO (+CS)  SCLK            full duplex     push-pull      CS high; SCLK per mode
CAN      CAN_H / CAN_L     in the data     half duplex     "dominant 0"   recessive (logic 1)
USB FS   D+ / D-           in the data     half duplex     differential   J state (D+ high)` },
      `## Who drives the line: push-pull and open-drain
A **push-pull** output has two transistors: one connects the pin to the supply (drives high), the other connects it to ground (drives low). It produces sharp edges in both directions and is what a GPIO does by default.

Now connect two push-pull outputs to the same wire and let one drive high while the other drives low. You have built a low-resistance path from 3.3 V through two transistors to ground. The line sits at some undefined voltage in between, a large current flows, and something gets hot. This is **bus contention**. Push-pull is safe only when the protocol guarantees a single driver per wire.

An **open-drain** output has only the low-side transistor. It can pull the line to ground or let go; it can never drive high. A resistor to the supply — the [[Pull-up resistor]] — makes the line high when everybody lets go. Any number of open-drain outputs can share a wire safely: if anyone pulls low, the line is low. The wire computes a logical AND of everyone's intent, which is why this arrangement is called **wired-AND**.

Open-drain buys you a shared wire with no risk of contention and a free way to detect that someone else is talking (you let go, but the line stays low). It costs you speed: the rising edge is not driven by a transistor, it is the pull-up resistor charging the wire's capacitance, an RC curve. I2C's speed limits come directly from that curve.

On an ESP32 you choose the output type per pin (in ESP-IDF, \`GPIO_MODE_OUTPUT\` or \`GPIO_MODE_OUTPUT_OD\`). The chip has internal pull-ups, but they are weak; their value is in the datasheet's DC characteristics table, and for a bus you normally fit external resistors.`,
      { t: 'predict', q: 'Two push-pull GPIOs on different boards are wired together by mistake. Board A drives the wire high (3.3 V); board B drives it low. What does a voltmeter on the wire show?',
        choices: [
          { t: 'A voltage between 0 V and 3.3 V, with a large current through both pins', ok: true, why: 'Each output is a transistor with some on-resistance. The two form a voltage divider straight across the supply. The reading depends on which transistor is stronger and it can damage either pin.' },
          { t: '3.3 V, because a driven high level overrides a driven low one', why: 'Nothing gives a high level priority. Each side is a low-resistance switch to its own rail and neither can overpower the other cleanly.' },
          { t: '0 V, because low always wins when two outputs share a wire', why: 'Low wins on an open-drain bus, where nobody actively drives high. Here one output is actively sourcing current from the 3.3 V rail.' },
          { t: 'It alternates between 0 V and 3.3 V as the two outputs take turns winning', why: 'Both outputs are static, so there is nothing to make the line switch. The result is a steady, invalid level.' },
        ],
        reveal: 'The line settles at an in-between voltage set by the two transistors\' on-resistances, and the current is limited only by them. A logic input looking at that wire may read 0 or 1. This is why UART is strictly point-to-point (one TX per wire) and why shared wires such as I2C use open-drain.' },
      { t: 'widget', name: 'gpio-electrical', caption: 'Switch the pin between push-pull and open-drain. In open-drain mode, remove the pull-up and watch what "high" becomes.' },
      `## Idle states
Every bus defines what its wires do when no data is being sent. This is not a detail. The idle state is how a receiver recognises that a transmission has *started*, and it is the first thing you check with a multimeter when a link is dead.

Idle is nearly always **high**, for two practical reasons. A wire that has fallen off, or a device that has lost power, usually reads low, so idle-high makes "broken" look different from "quiet". And on open-drain buses high is the only state that costs no current.

A habit worth forming now: before connecting a logic analyser, measure each line with a multimeter while the bus is quiet. UART TX at 0 V, or SDA at 1.2 V, tells you there is a wiring or power fault before you have decoded a single bit.`,
      { t: 'callout', kind: 'mistake', title: 'The signal wire is only half of the circuit',
        md: 'A voltage is a difference between two points. A receiver measures its input pin **against its own ground**. If two boards share a signal wire but not a ground wire, the receiver is comparing against a reference the sender does not share, and it reads noise. Every single-ended link in this section needs a ground connection between the two boards, in addition to the signal wires. Two boards powered from the same laptop sometimes work by accident through the USB shields; do not rely on it.' },
      `## Bit-banging: being the peripheral yourself
A hardware UART, I2C or SPI peripheral is a shift register plus a small state machine that moves bits on and off the pins for you. You can do the same job in software, toggling GPIOs from your own code. That is **bit-banging**.

Here is a transmitter for a made-up synchronous link with one data wire and one clock wire, most significant bit first:`,
      { t: 'code', lang: 'c', status: 'pseudo', caption: 'Bit-banged synchronous transmit (illustrative: gpio_write and delay_us stand for your platform\'s calls)',
        code: String.raw`void shift_out(uint8_t value)
{
    for (int i = 7; i >= 0; i--) {          /* MSB first */
        gpio_write(PIN_DATA, (value >> i) & 1);
        delay_us(2);                        /* data set-up time before the edge */
        gpio_write(PIN_CLK, 1);             /* rising edge: receiver samples here */
        delay_us(2);
        gpio_write(PIN_CLK, 0);
    }
}`,
        explain: [
          { lines: '3', md: 'The loop index selects which bit goes out. Counting down from 7 sends the most significant bit first; counting up from 0 would send the least significant first. Both ends must agree.' },
          { lines: '4-5', md: 'The data pin is set **before** the clock edge and held still for a moment. The receiver\'s input needs the level to be stable for a minimum time before it samples (its set-up time).' },
          { lines: '6-8', md: 'One full clock period. With two 2 µs delays the clock cannot be faster than 250 kHz, and in practice it is slower because the GPIO writes and the loop take time too.' },
        ] },
      `Bit-banging a **synchronous** protocol as the clock owner is robust. If an interrupt delays your loop by 50 µs, one clock period is stretched and nothing is lost, because the receiver only acts on edges.

Bit-banging an **asynchronous** protocol is fragile. A UART bit at 115200 baud lasts 8.68 µs, and the receiver judges it against a stopwatch. One interrupt in the middle of a byte moves every later edge, and the byte is corrupted. It also costs CPU time: the processor does nothing else while it counts microseconds. That is the real reason hardware peripherals exist: they keep exact timing while the CPU does other work.

Use bit-banging when the protocol is slow or you own the clock, when you have run out of hardware peripherals, or when you need a strange protocol no peripheral speaks. Use the hardware peripheral for everything else.`,
      { t: 'exercise', prompt: 'The \`shift_out\` loop above takes about 5 µs per bit in total once the GPIO calls are included. Ignoring any gaps between bytes, how many milliseconds does it take to send 1024 bytes?',
        hints: ['How many bits is 1024 bytes on a link with no start or stop bits?', '1024 × 8 = 8192 bits. Each one takes 5 µs.', '8192 × 5 µs = 40 960 µs. Convert to milliseconds.'],
        solution: '1024 bytes × 8 bits = 8192 bits. 8192 × 5 µs = 40 960 µs ≈ **41 ms**, during which the CPU can do nothing else. A hardware SPI peripheral at 10 MHz moves the same data in 0.82 ms without occupying the CPU.',
        answer: { type: 'number', value: 40.96, tol: 0.5, unit: 'ms' } },
      { t: 'callout', kind: 'decision', title: 'Choosing a link type',
        md: `- **Two devices, both directions, long-ish cable, simple wiring** → asynchronous (UART). No clock wire to radiate or skew; costs you accurate oscillators.
- **Many slow chips on one board, few pins** → a shared open-drain bus with addresses (I2C).
- **One fast chip, short traces** → a clocked push-pull bus (SPI). Fastest, most pins.
- **Many nodes over metres of cable in electrical noise** → differential signalling with built-in arbitration (CAN) or a differential physical layer under a UART (RS-485).

The rest of this section is those four choices in detail.` },
      `## A harder case
A product has a main board and a display board joined by a 6-wire, 50 cm cable. Two wires are power and ground. The display needs about 20 kB/s of data from the main board and must send back touch coordinates at about 200 B/s.

Before reading on, decide: which wires would you allocate, and to what kind of link? There is more than one defensible answer. A UART pair uses two wires, is full duplex, and tolerates 50 cm easily at 250 kbaud (25 kB/s). An SPI link would be far faster than needed, uses all four remaining wires, and its fast clock edges are harder to keep clean over a cable. I2C at 400 kHz carries about 40 kB/s, uses two wires, but 50 cm of cable adds capacitance that slows its rising edges. The engineering answer is the UART, with two wires spare — and you now know which questions led there.`,
    ],
    quiz: [
      { q: 'Why can a synchronous link work when the two devices have inaccurate oscillators?', kind: 'concept', choices: [
        { t: 'The receiver samples on the clock wire\'s edges and never measures time itself', ok: true, why: 'The clock signal carries the timing. The receiver reacts to edges, however far apart they are.' },
        { t: 'Synchronous links run slowly enough that small timing errors between the two ends do not matter', why: 'Synchronous buses are usually the faster ones. Their tolerance comes from how sampling instants are communicated, not from low speed.' },
        { t: 'Both devices lock their oscillators together at the start of each transfer and stay matched', why: 'No locking takes place. One device simply supplies the timing as a signal and the other follows it.' },
      ] },
      { q: 'Three devices have open-drain outputs on one wire with a single pull-up to 3.3 V. Device A pulls low; B and C release the line. What is the level, and how much current flows?', kind: 'circuit', choices: [
        { t: 'Low; only the current through the pull-up resistor flows, into A', ok: true, why: 'Released outputs are high impedance. The only path is supply → pull-up → A\'s transistor → ground, limited by the resistor.' },
        { t: 'Undefined; two devices want high and one wants low, so the line settles in between', why: 'Releasing the line is not the same as driving it high. B and C contribute nothing, so there is no conflict to resolve.' },
        { t: 'Low; a damaging short-circuit current flows between A and the two others', why: 'A short needs someone actively driving high through a transistor. Here the only source of "high" is a resistor, which limits the current.' },
        { t: 'High; two of the three devices agree, and the majority level wins', why: 'A wired bus does not count votes. Any single device pulling low gives a low level.' },
      ] },
      { q: 'A UART link between two boards prints garbage. Each board works alone with a USB adapter. The boards are joined by TX→RX and RX→TX only and powered from separate batteries. What is the first thing to fix?', kind: 'circuit', choices: [
        { t: 'Add a ground wire between the boards', ok: true, why: 'With separate supplies and no ground connection the receiver has no shared reference for the signal voltage.' },
        { t: 'Lower the baud rate until the text is readable', why: 'A lower rate helps with marginal timing or slow edges. It cannot fix a signal whose voltage reference is missing.' },
        { t: 'Add pull-up resistors on TX and RX at both boards', why: 'UART outputs are push-pull and already drive both levels. Pull-ups would not supply the missing return path.' },
      ] },
      { q: 'Which statement about bit-banging is correct?', kind: 'code', choices: [
        { t: 'An interrupt mid-byte corrupts a bit-banged UART byte but not a link you clock yourself', ok: true, why: 'A stretched clock period just delays the edge. An asynchronous receiver is timing bits against its own oscillator and will sample the wrong ones.' },
        { t: 'It is always slower than a hardware peripheral but otherwise behaves identically on the wire', why: 'Speed is one difference. The more important ones are timing jitter from interrupts and the CPU time spent doing nothing but waiting.' },
        { t: 'It cannot be used for open-drain buses, because a GPIO always drives both levels', why: 'An open-drain GPIO mode, or switching a pin between output-low and input, bit-bangs I2C perfectly well.' },
      ] },
      { q: 'You measure a quiet bus with a multimeter: SDA reads 3.3 V, SCL reads 0.0 V. What does this tell you?', kind: 'circuit', choices: [
        { t: 'SCL is held low or has no pull-up: the bus is not idle', ok: true, why: 'Both I2C lines idle high. A steady low means a missing pull-up, a short to ground, or a device holding the line.' },
        { t: 'The bus is idle and healthy: only the data line has to rest high', why: 'An idle open-drain bus has every line pulled up. One line at ground is a fault you can find before using any other tool.' },
        { t: 'A transfer is in progress and the meter caught the clock low', why: 'During a transfer the clock toggles, so a multimeter would show an average somewhere between the rails, not a solid 0 V.' },
      ] },
      { q: 'Why did board-to-board links move from parallel to serial as speeds increased?', kind: 'concept', choices: [
        { t: 'Bits on separate wires arrive at slightly different times, which limits the rate', ok: true, why: 'Skew between wires grows in importance as bit times shrink. One data signal has nothing to be skewed against.' },
        { t: 'A serial link carries more bits per clock edge than a parallel one of the same speed', why: 'A serial link carries one bit per edge, fewer than a parallel bus. It wins by allowing much shorter bit times.' },
        { t: 'Parallel links cannot be made bidirectional, and modern buses need both directions', why: 'Bidirectional parallel buses exist, for example memory data buses. Direction was not the limitation.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 2
  {
    id: 'proto-uart', title: 'UART in depth', minutes: 50,
    summary: 'The frame on the wire bit by bit, how the receiver finds the middle of each bit, and the three electrical standards that carry it.',
    skills: ['proto-uart-decode', 'proto-uart-wire'],
    blocks: [
      `## The problem
You connect an ESP32 to a GPS module with two wires. The GPS sends text once a second. There is no clock wire and no "data valid" wire, only a line that sits at 3.3 V and occasionally wiggles. How does the ESP32 know where a byte starts, where each bit is, and where the byte ends?

The device that solves this is the **UART** (universal asynchronous receiver/transmitter): a shift register, a baud-rate timer and a small state machine. "Serial port" in everyday speech means a UART.

## The frame
A UART sends one byte at a time, wrapped in a **frame**:`,
      { t: 'figure', svg: uartFrameSvg, caption: 'The byte 0x41 (ASCII "A") in 8N1 format. Binary 0100 0001, sent least significant bit first, so the data bits appear on the wire as 1 0 0 0 0 0 1 0.' },
      `1. **Idle**: the line is high. It can stay there for any length of time.
2. **Start bit**: one bit time low. The falling edge is the only synchronisation event in the whole frame: it tells the receiver "a byte begins now".
3. **Data bits**: normally 8, **least significant bit first**. This is the opposite of how you write binary, and it is the most common mistake when decoding a capture by eye.
4. **Parity bit** (optional): one bit chosen so that the number of 1s in data plus parity is even (even parity) or odd (odd parity). It detects any single flipped bit and misses any two.
5. **Stop bit(s)**: one or two bit times high. The stop bit guarantees the line returns to idle, so that the next start bit produces a falling edge even if the last data bit was 0.

The format is written as data bits, parity, stop bits: **8N1** means 8 data bits, no parity, 1 stop bit. It is the default almost everywhere. 8E1 (even parity) appears in industrial equipment such as Modbus RTU; 7E1 in old text terminals.

In 8N1, ten bits on the wire carry eight bits of data: two extra bits for every eight (25 % on top of the data, or 20 % of the line time). That is the price of having no clock wire.

## How the receiver finds each bit
The receiver does not know when a byte will arrive, so its hardware samples the RX pin much faster than the bit rate — typically **16 times per bit** (×16 oversampling).

- While idle it watches for a low sample: a possible start bit.
- It then counts 8 sample ticks, which lands it in the **middle** of the start bit, and checks that the line is still low. If not, it was a noise glitch and it goes back to waiting.
- From there it counts 16 ticks at a time, landing in the middle of each data bit, and shifts the sampled level into its register. Many UARTs take three samples around the centre and use the majority, which rejects short spikes.
- At the stop bit position it expects high. If it finds low, it raises a **framing error**: the frame did not end where it should have.

Sampling in the middle matters because that is the point furthest from both edges, where the level has settled and a small timing error does no harm. The next lesson turns "small" into a number.`,
      { t: 'predict', q: 'A UART configured as 8N1 transmits the byte 0x53 (ASCII "S", binary 0101 0011). Reading the wire left to right in time, starting with the start bit, what sequence of ten levels do you see?',
        choices: [
          { t: '0 · 1 1 0 0 1 0 1 0 · 1', ok: true, why: 'Start bit 0, then the data from bit 0 upward: 1,1,0,0,1,0,1,0, then the stop bit 1.' },
          { t: '0 · 0 1 0 1 0 0 1 1 · 1', why: 'That writes the data bits in the order you would write the binary number, most significant first. The UART shifts out from the other end.' },
          { t: '1 · 1 1 0 0 1 0 1 0 · 0', why: 'The data order is right, but the start bit must differ from the idle level so that it produces an edge, and the stop bit must return the line to idle.' },
        ],
        reveal: 'Bit 0 leaves first. 0x53 = 0101 0011, so bits 0…7 are 1,1,0,0,1,0,1,0. With the start bit in front and the stop bit behind: 0 1 1 0 0 1 0 1 0 1. When you decode a capture by hand, write the bits down as they arrive and then **reverse** them before converting to hex.' },
      { t: 'widget', name: 'uart-terminal', props: { baud: 115200, format: '8N1', peer: 'echo' }, caption: 'Type a character and read its frame. Then change the format to 8E1 on your side only and see which characters still get through, and why.' },
      { t: 'exercise', prompt: 'A logic capture of one 8N1 frame shows these levels, one per bit time, starting at the falling edge: \`0 0 1 0 1 1 0 1 0 1\`. What byte was sent? Answer in hex (for example 0x41).',
        hints: ['Strip the first level (start bit) and the last (stop bit). Eight levels remain.', 'The remaining levels are 0 1 0 1 1 0 1 0, in the order bit 0, bit 1, … bit 7.', 'Reverse them to write the byte the usual way: 0101 1010.'],
        solution: 'Data bits in arrival order: 0,1,0,1,1,0,1,0 = bit0…bit7. Written most significant first: 0101 1010 = **0x5A** (ASCII "Z").',
        answer: { type: 'text', accept: ['^\\s*(0x)?5a\\s*$', '^\\s*90\\s*$', '^\\s*[zZ]\\s*$'], nudge: 'Remember the first data bit on the wire is bit 0. Reverse the eight data bits before converting.' } },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-9600-hello' }, caption: 'A captured UART line at 9600 baud. Place cursors on the first falling edge, measure one bit time, and decode the first two bytes by hand before turning on the decoder.' },
      `## Wiring: TX goes to RX
Each UART has a transmit output (TX) and a receive input (RX). The link is two independent one-way channels, so the wires **cross over**: your TX goes to their RX, their TX goes to your RX. Plus ground.`,
      { t: 'ascii', caption: 'A minimal UART link: three wires',
        text:
`   Device A                Device B
   ---------               ---------
   TX  ------------------>  RX
   RX  <------------------  TX
   GND --------------------  GND

   optional hardware flow control
   RTS ------------------>  CTS     "I have room, you may send to me"
   CTS <------------------  RTS` },
      { t: 'callout', kind: 'mistake', title: 'TX to TX',
        md: 'Connecting TX to TX and RX to RX is the most common UART wiring error, helped along by boards that label the header from the *other* device\'s point of view. With TX-to-TX both outputs idle high, so nothing is damaged while the line is quiet, but nothing is received either, and when one side transmits its output fights the other. If a link is completely silent in both directions, swap the two wires first. The idle level tells you which pin is an output: with nothing else connected, a TX pin measures a solid 3.3 V; an RX pin floats or sits at whatever its pull-up gives it.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'tx-rx-swapped' }, caption: 'A link that worked on the bench is silent after re-wiring. Use the probes to work out why.' },
      `## Flow control
A UART transmitter sends whenever it likes. If the receiver's software is busy and its buffer fills, later bytes are lost; the hardware reports an **overrun error** and that is all. Flow control lets the receiver say "stop".

- **Hardware (RTS/CTS)**: two extra wires. A device drives its **RTS** output to the active level when it has buffer space; the other side's transmitter only sends while its **CTS** input is active. The UART hardware can do this automatically. This is the reliable choice for fast or binary links.
- **Software (XON/XOFF)**: the receiver sends the byte 0x13 to pause and 0x11 to resume. No extra wires, but it steals two byte values, so it cannot be used for raw binary data without escaping, and it reacts slowly.
- **None**: fine when the receiver is certain to keep up, or when a higher-level protocol acknowledges and retries (you will build one in Lab B).

## Three electrical standards, one frame format
A UART defines the **logical** frame. Several electrical standards carry it. They are not compatible with each other.

| | Logic-level ("TTL") UART | RS-232 | RS-485 |
|---|---|---|---|
| Logic 1 / idle | supply voltage (3.3 V or 5 V) | **negative**, −3 V to −15 V | differential: A below B |
| Logic 0 | 0 V | **positive**, +3 V to +15 V | differential: A above B |
| Wires | TX, RX, GND | TX, RX, GND (+ handshake) | one twisted pair (half duplex) or two |
| Devices | 2 | 2 | many on one pair |
| Typical reach | tens of centimetres | several metres | hundreds of metres at low speed |

**RS-232** is the standard behind the 9-pin PC serial port. It is inverted and it swings both ways around ground. A microcontroller pin sees an RS-232 "idle" as a negative voltage well beyond its absolute maximum rating.`,
      { t: 'callout', kind: 'warn', title: 'Never connect RS-232 levels to a microcontroller pin',
        md: 'An RS-232 output may swing to ±12 V or more. A 3.3 V GPIO is typically rated for a few tenths of a volt outside its supply rails (see "absolute maximum ratings" in the datasheet). Connecting the two directly can destroy the pin or the chip. Between them you need a level translator such as a MAX3232-type transceiver, which also performs the inversion. The same care applies between 5 V and 3.3 V logic: check whether the 3.3 V part\'s inputs are 5 V tolerant before connecting a 5 V TX to them, and if they are not, use a divider or a level shifter. A "USB-to-serial" adapter may be 3.3 V logic, 5 V logic or true RS-232: read its label before plugging it into a board.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'level-mismatch' }, caption: 'Two devices with the same frame format and baud rate that still cannot talk. Measure the idle levels.' },
      `**RS-485** sends each bit as the *difference* between two wires, A and B, driven in opposite directions. Noise that couples into the cable lands on both wires equally and cancels at the receiver, which only looks at the difference. That is what lets it run over long cables in factories. Many transceivers can share one pair, so it is a bus: every node's driver must be switched off (via the transceiver's driver-enable pin) except while that node is transmitting, and the cable is terminated with a resistor matching its impedance (typically 120 Ω) at each end. Who gets to transmit is decided by the protocol on top, not by the wire; the arbitration lesson returns to this.

## On an ESP32
ESP-IDF's UART driver configures the format, installs interrupt-driven ring buffers and routes the signals to pins of your choice:`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'A second UART on an ESP32 with ESP-IDF (every call, type and constant checked against the ESP-IDF v6.1 headers; not compiled as a whole and not run on a board)',
        code: String.raw`#include "freertos/FreeRTOS.h"
#include "driver/uart.h"

#define LINK_UART  UART_NUM_1
#define LINK_TX    25
#define LINK_RX    26

void link_init(void)
{
    const uart_config_t cfg = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    ESP_ERROR_CHECK(uart_driver_install(LINK_UART, 1024, 1024, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LINK_UART, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(LINK_UART, LINK_TX, LINK_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));
}

void link_demo(void)
{
    uint8_t buf[64];
    uart_write_bytes(LINK_UART, "ping\r\n", 6);
    int n = uart_read_bytes(LINK_UART, buf, sizeof buf, pdMS_TO_TICKS(100));
    /* n = bytes received within 100 ms, 0 on timeout, -1 on error */
    (void)n;
}`,
        explain: [
          { lines: '10-17', md: 'This struct is 8N1 at 115200 spelled out. The driver turns the baud rate into a clock divider for the UART peripheral; \`source_clk\` selects which clock is divided.' },
          { lines: '18', md: 'Allocates receive and transmit ring buffers of 1024 bytes each and installs the interrupt handler that moves bytes between them and the hardware FIFO. Without the driver the hardware FIFO would overflow as soon as your task was busy.' },
          { lines: '20', md: 'The ESP32 can route a UART signal to almost any GPIO through its GPIO matrix. RTS and CTS are left unconnected here. Check \`docs/FACTS.md\` and your module\'s pin table before choosing pins: some are strapping pins or wired to the flash chip.' },
          { lines: '1', md: '\`pdMS_TO_TICKS\` comes from the FreeRTOS header. The driver\'s timeouts are in RTOS **ticks**, 10 ms each with the default \`CONFIG_FREERTOS_HZ=100\`, so a timeout shorter than one tick rounds down to 0 and the call returns at once.' },
          { lines: '27', md: '\`uart_read_bytes\` blocks the calling task for up to the timeout. A timeout here is information, not just a failure: silence for longer than expected is how higher-level protocols detect the end of a message or a dead peer.' },
        ] },
      `UART0 is normally the console and the port the ROM bootloader uses for flashing, which is why this example uses UART1.

## Under the driver: polling a status register
Strip away the driver and a UART transmitter is two registers: a data register you write the byte into, and a status flag that says whether the transmitter can take another. The Bench-MCU simulator has exactly that. Writing while the transmitter is busy loses the byte — on real parts too.`,
      { t: 'widget', name: 'c-lab', title: 'Send a string without losing bytes',
        props: {
          title: 'UART transmit with TX_READY polling',
          prompt: `Implement \`uart_putc\` and \`uart_puts\` for the Bench-MCU UART.

- Enable the UART by setting bit 0 of \`UART_CTRL\`.
- Before each write to \`UART_DATA\`, wait until the \`UART_TX_READY\` bit of \`UART_STATUS\` is 1.
- \`main\` must send the text \`Bench\` followed by \`\\r\\n\`.

The starter writes the bytes back to back. Run it and look at what actually leaves the pin.`,
          starter: String.raw`#include <stdint.h>

void uart_putc(char c)
{
    /* TODO: wait for the transmitter, then write the byte */
    UART_DATA = (uint8_t)c;
}

void uart_puts(const char *s)
{
    /* TODO: send every character up to (not including) the terminating 0 */
    uart_putc(s[0]);
}

int main(void)
{
    /* TODO: enable the UART first */
    uart_puts("Bench\r\n");
    return 0;
}
`,
          solution: String.raw`#include <stdint.h>

void uart_putc(char c)
{
    while ((UART_STATUS & UART_TX_READY) == 0) {
        /* busy-wait: the previous byte is still being shifted out */
    }
    UART_DATA = (uint8_t)c;
}

void uart_puts(const char *s)
{
    while (*s != 0) {
        uart_putc(*s);
        s++;
    }
}

int main(void)
{
    UART_CTRL = UART_CTRL | 1u;
    uart_puts("Bench\r\n");
    return 0;
}
`,
          tests: [{ name: 'sends "Bench\\r\\n" complete and in order', uartTx: 'Bench\r\n' }],
          hints: [
            'Transmission is dropped while the ENABLE bit of `UART_CTRL` is 0. Set it before the first write.',
            '`UART_STATUS & UART_TX_READY` is non-zero when the transmitter can accept a byte. Loop while it is zero.',
            'In `uart_puts`, walk the pointer until it points at the 0 byte: `while (*s) { uart_putc(*s); s++; }`.',
          ],
          explain: 'The busy-wait loop is the simplest correct transmitter. Its cost is CPU time: at 9600 baud each byte holds the processor for about a millisecond. Real firmware lets the "transmitter empty" interrupt pull the next byte from a buffer instead; the ESP-IDF driver you saw above does exactly that.',
        } },
      { t: 'widget', name: 'uart-terminal', props: { baud: 115200, format: '8N1', peer: 'console' }, caption: 'A device with a small command shell, the kind you find on debug headers. Type help. Then set your side to 7E1 and compare what comes back with the case below.' },
      `## A harder case
A device sends 7E1 frames. Your terminal is set to 8N1 at the same baud rate. Both are ten bits long (start + 7 data + parity + stop, against start + 8 data + stop), so there are no framing errors. What do you see?

Your receiver takes the sender's parity bit as data bit 7. Characters with an even number of 1s arrive unchanged (parity bit 0); the others arrive with the top bit set, as values above 0x7F. The text is recognisable but sprinkled with odd symbols. When output is *almost* right like that, suspect the frame format rather than the baud rate; a baud mismatch scrambles everything.`,
      { t: 'refs', items: [
        { title: 'ESP-IDF: UART driver (docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/uart.rst', note: 'Configuration, pin routing, flow control, RS-485 mode.' },
      ] },
    ],
    quiz: [
      { q: 'In an 8N1 capture you read, from the start bit onward: `0 1 0 0 0 1 1 0 0 1`. Which byte is it?', kind: 'concept', choices: [
        { t: '0x31', ok: true, why: 'Data bits in arrival order are 1,0,0,0,1,1,0,0 = bit0…bit7, so the byte is 0011 0001 = 0x31.' },
        { t: '0x8C', why: 'That reads the eight data levels in arrival order as if the first were the most significant bit. The UART sends the other end first.' },
        { t: '0x46', why: 'That includes the start bit as a data bit. The first low level only marks the beginning of the frame.' },
      ] },
      { q: 'What is the purpose of the stop bit?', kind: 'concept', choices: [
        { t: 'It returns the line to idle so the next start bit is always a falling edge', ok: true, why: 'Without a guaranteed high period, a frame ending in 0 followed immediately by a start bit would show no edge to synchronise on.' },
        { t: 'It tells the receiver how many data bits were in the frame that just ended', why: 'The number of data bits is configured on both sides in advance. Nothing in the frame encodes it.' },
        { t: 'It carries an error-detection code computed over the data bits before it', why: 'Error detection, when used, is the parity bit. The stop bit has a fixed level regardless of the data.' },
      ] },
      { q: 'Why does a UART receiver sample each bit near its centre rather than at its edge?', kind: 'concept', choices: [
        { t: 'The centre is furthest from both edges, so the level has settled', ok: true, why: 'Edges are where the signal is changing and where clock mismatch shows first. The middle gives the largest margin on both sides.' },
        { t: 'The transmitter only guarantees the level during the middle part of each bit time', why: 'The transmitter holds the level for the whole bit time. The receiver chooses the centre for margin.' },
        { t: 'Sampling at the edge would need a faster oversampling clock than sampling mid-bit', why: 'The same ×16 clock could sample anywhere in the bit. The position is chosen for robustness, not because of clock speed.' },
      ] },
      { q: 'A 3.3 V microcontroller must talk to equipment with a 9-pin RS-232 port. What goes between them?', kind: 'circuit', choices: [
        { t: 'An RS-232 transceiver, which shifts and inverts the levels', ok: true, why: 'RS-232 idles at a negative voltage and swings to a positive one. A transceiver translates both the voltage range and the polarity.' },
        { t: 'A resistor divider on each RS-232 output to scale it down to 3.3 V', why: 'A divider scales a positive voltage. It still passes a negative voltage to the pin, and it does not undo the inversion.' },
        { t: 'Nothing, provided both ends use the same baud rate and frame format', why: 'Matching settings make the frames agree logically. The voltages are a separate layer, and here they would exceed the pin\'s ratings.' },
        { t: 'Pull-up resistors to 3.3 V on both data lines', why: 'Pull-ups define an otherwise floating level. They cannot protect a pin from a driven ±12 V signal.' },
      ] },
      { q: 'A device streams binary sensor data at 921600 baud into a microcontroller that occasionally spends 5 ms writing to flash. Bytes go missing. Which fix addresses the cause?', kind: 'arch', choices: [
        { t: 'Hardware flow control (RTS/CTS), so the sender pauses while the buffer is full', ok: true, why: 'The loss is an overrun: data arrives while nobody empties the buffer. RTS/CTS tells the sender to wait.' },
        { t: 'XON/XOFF software flow control, which needs no extra wires and works with any data', why: 'XON/XOFF reserves two byte values as control codes. Raw binary data contains those values, so it would pause and resume at random unless escaped.' },
        { t: 'A parity bit on every byte, so the receiver can detect and recover what was lost', why: 'Parity detects a flipped bit within a byte that did arrive. It cannot recover bytes the receiver never stored.' },
      ] },
      { q: 'With nothing connected to it, you measure a board\'s unlabelled UART pin at a steady 3.3 V, and it does not move when you touch it with a 10 kΩ resistor to ground. What is it most likely?', kind: 'circuit', choices: [
        { t: 'The TX output, idling high and driven push-pull', ok: true, why: 'A driven output holds its level against a 10 kΩ load. A floating or weakly pulled-up input would be dragged down.' },
        { t: 'The RX input, held high by its internal pull-up resistor', why: 'An input does not drive its pin. With a weak pull-up at most, a 10 kΩ resistor to ground would visibly lower the voltage.' },
        { t: 'A ground pin, since its level does not move under load', why: 'A ground pin measures 0 V relative to the board\'s ground, not 3.3 V.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 3
  {
    id: 'proto-baud', title: 'Baud rates and clock synchronisation', minutes: 40,
    summary: 'Bit time, divider error, and how far apart two clocks may drift before a UART frame breaks — with the arithmetic.',
    skills: ['proto-baud-budget'],
    blocks: [
      `## The problem
A board with a 16 MHz oscillator talks at 9600 baud without trouble. Someone changes the setting to 115200 "to make logging faster" and the output becomes garbage — not always, but most of the time, and it gets worse when the board is warm. The settings are identical on both sides. What changed?

Nothing is wrong with the frame. The two ends no longer agree on how long a bit is.

## Bit time
The **baud rate** is the number of symbols per second. For a UART a symbol is one bit, so baud and bits per second are the same number. The duration of one bit is

**t_bit = 1 / baud**

| Baud | Bit time | 8N1 bytes per second |
|---|---|---|
| 9600 | 104.2 µs | 960 |
| 115200 | 8.68 µs | 11 520 |
| 921600 | 1.085 µs | 92 160 |

Each 8N1 byte costs 10 bit times, so throughput in bytes per second is baud ÷ 10.

## Where the baud rate comes from
A UART has no knob marked "115200". It has a clock input and an integer **divider**. A typical design with ×16 oversampling produces

**baud = f_clock / (16 × divider)**

so the divider you want is f_clock / (16 × baud). If that is not a whole number you must round it, and the baud rate you actually get is not the one you asked for.

### Worked example: 16 MHz, 115200 baud
divider = 16 000 000 / (16 × 115 200) = 8.68. The nearest integer is 9.

actual baud = 16 000 000 / (16 × 9) = 111 111

error = (111 111 − 115 200) / 115 200 = **−3.55 %**

At 9600 baud the same clock needs 104.17, rounds to 104, and gives 9615 baud: an error of +0.16 %. Same oscillator, same code, very different result. This is the answer to the opening problem.

This is why "strange" crystal frequencies such as 14.7456 MHz or 11.0592 MHz exist: 14 745 600 / (16 × 115 200) = 8 exactly. They are standard baud rates multiplied by a power of two.

Modern UARTs reduce the problem with **fractional dividers** (the ESP32's UART has one) or lower oversampling factors, so the achievable rates are much finer-grained. The principle remains: the driver computes a divider, and you should know what rate you really got. On an unfamiliar chip, calculate it or measure a bit with a logic analyser.

## How much error is too much?
The receiver re-synchronises on the falling edge of every start bit, then free-runs for the rest of the frame using its own clock. If its clock is slightly fast or slow relative to the sender's, each sample lands a little further from the centre of its bit. The error **accumulates** across the frame and is thrown away at the next start bit.

So the question is: by the last sample of the frame, has the sampling point drifted out of the bit it was aimed at?`,
      { t: 'ascii', caption: 'A receiver running 4 % slow. Each sample (^) lands later within its bit; the last one is close to the edge.',
        text:
`sender   | start |  D0  |  D1  |  D2  |  D3  |  D4  |  D5  |  D6  |  D7  | stop |
ideal        ^      ^      ^      ^      ^      ^      ^      ^      ^      ^
4% slow      ^      ^       ^      ^       ^       ^       ^       ^        ^        ^
             0.52   1.56   2.60   3.64   4.68   5.72   6.76   7.80   8.84   9.88   (sender bit times)
                                                                              |
                                              stop bit spans 9.0 to 10.0: still inside, with 0.12 bit to spare` },
      `### The tolerance budget for 8N1
- The receiver aims its last sample at the centre of the stop bit, which is **9.5 bit times** after the start edge.
- A sample is good as long as it lands inside its own bit: at most **±0.5 bit** away from the centre.
- So the total mismatch between the two clocks must be less than 0.5 / 9.5 = **5.26 %**.

That is the theoretical limit with perfect edges. Now subtract real effects:

- With ×16 oversampling the receiver only notices the start edge at its next sample tick, up to 1/16 of a bit late. The budget shrinks to (0.5 − 0.0625) / 9.5 = **4.6 %**.
- Real edges take time to rise and fall, and cables and level shifters delay rising and falling edges differently. That eats some more.
- The budget is **shared**. If the sender is 2.3 % fast and the receiver is 2.3 % slow, the mismatch is 4.6 %.

The usual engineering rule that comes out of this: keep **each end within about ±2 %** of the nominal rate, and prefer much better. The 16 MHz board at −3.55 % breaks that rule on its own, before the other end contributes anything.

A longer frame is less tolerant: 8E2 has 12 bits, so the last stop-bit sample is at 11.5 bit times and the ideal limit falls to 0.5 / 11.5 = 4.3 %.`,
      { t: 'predict', q: 'A transmitter is 3 % fast and a receiver is 3 % slow, both 8N1. Which bits of the frame are most likely to be read wrongly?',
        choices: [
          { t: 'The last ones: bit 7 and the stop bit', ok: true, why: 'Drift grows linearly from the start edge. A 6 % mismatch moves the last sample by about 0.57 of a bit, past the edge; early bits are still sampled safely.' },
          { t: 'All bits equally, because the two clocks differ by the same amount throughout the frame', why: 'The receiver re-aligns at the start edge, so its first samples are nearly perfect. The error has to build up before it matters.' },
          { t: 'The first ones: the start bit and bit 0, before the receiver has locked on', why: 'Those are sampled right after synchronisation, when the two clocks have had the least time to drift apart.' },
        ],
        reveal: 'At a 6 % mismatch the sample aimed at 9.5 bit times lands near 10.07 or 8.93 — in the wrong bit. Slightly smaller mismatches corrupt only frames where the neighbouring bit differs. That is the signature of a marginal baud error: mostly correct text with occasional wrong characters whose **high bits** are affected, plus framing errors.' },
      { t: 'exercise', prompt: 'An MCU clocks its UART from 8 MHz with ×16 oversampling and an integer divider. You ask for 115200 baud. What is the baud-rate error, in percent, with the best integer divider? Give the magnitude.',
        hints: ['The hardware can only divide by a whole number. What divider would give exactly 115200, and what happens to the rate when you round it?', 'Ideal divider = 8 000 000 / (16 × 115 200) = 4.34, so the nearest integer is 4.', 'Actual baud = 8 000 000 / (16 × 4) = 125 000. Error = (actual − wanted) / wanted.'],
        solution: 'Divider 4.34 → 4. Actual rate 125 000 baud. Error = (125 000 − 115 200) / 115 200 = **+8.5 %**: far outside the budget, the link cannot work. Options: a different clock, a UART with a fractional divider or ×8 oversampling, or a rate the clock can make exactly, such as 125 000 or 250 000 baud if the other end allows it.',
        answer: { type: 'number', value: 8.51, tol: 0.2, unit: '%' } },
      { t: 'exercise', prompt: 'How long, in microseconds, is one bit at 57600 baud?',
        hints: ['Bit time is the reciprocal of the baud rate.', '1 / 57 600 s. Multiply by 1 000 000 for microseconds.'],
        solution: '1 / 57 600 = 17.36 µs. A full 8N1 byte is ten of those: 173.6 µs.',
        answer: { type: 'number', value: 17.36, tol: 0.1, unit: 'µs' } },
      `## Why crystals matter
The divider error is only half of the budget. The other half is the oscillator itself.

- A **quartz crystal** is typically accurate to tens of parts per million. 50 ppm is 0.005 %: irrelevant to a UART.
- An **internal RC oscillator** is far less accurate and moves with temperature and supply voltage. Factory-trimmed ones are often specified at around a percent at room temperature and worse across the full temperature range; the exact figure is in the clock section of your chip's datasheet.

Two devices running from RC oscillators can each be inside their own specification and still be too far apart for a UART. That is the "worse when warm" in the opening problem. If a design must use a UART and has no crystal, check the oscillator's tolerance **over temperature** against the ±2 % rule, or have one side measure the other's bit time and adapt (auto-baud).`,
      { t: 'widget', name: 'uart-terminal', props: { baud: 9600, format: '8N1', peer: 'sensor' }, caption: 'The simulated sensor has its own settings. Change your baud rate a little at a time and note at what mismatch the first errors appear, and in which characters.' },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-unknown-baud' }, caption: 'Nothing tells you the baud rate of this capture. Find the narrowest pulse, measure it with the cursors, and take the reciprocal.' },
      { t: 'callout', kind: 'note', title: 'Finding an unknown baud rate',
        md: 'The shortest low or high pulse in a long enough capture is one bit time (a single 0 between 1s, or the reverse). Measure it and compute 1 / t. Then pick the nearest **standard** rate: 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600. A measured 8.7 µs is 115200, not "114 943". If the result is not near any standard rate, you may have measured two bits, or the device uses a custom rate.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'baud-mismatch' }, caption: 'A device that prints readable text for some people and garbage for others. Measure before you guess.' },
      `## Why synchronous buses do not have this problem
On SPI and I2C the controller sends a clock edge for every bit. The receiving side has no stopwatch running, so there is nothing to drift. The controller's clock can be 5 % off, or change speed mid-transfer, or stop for a second between two bits, and the transfer is still correct. This is the single largest practical advantage of a clock wire, and it is why cheap sensors without crystals speak I2C or SPI rather than UART.

What a synchronous bus asks for instead is that data be stable for a short time around each clock edge (set-up and hold times), which limits how *fast* the clock may go.

### Clock stretching
I2C adds one refinement. Because SCL is open-drain, the device that is *not* generating the clock can still hold it low. A slow peripheral that needs time — to finish a conversion, say — keeps SCL low after a bit; the controller releases SCL, sees that it has not risen, and waits. This is **clock stretching**: flow control built into the clock wire. It only works because the controller reads SCL back instead of assuming it went high, and a controller that does not check (some bit-banged ones, and some hardware ones by configuration) will corrupt transfers with such a peripheral.

## A harder case
A battery-powered sensor uses its internal RC oscillator, specified by its datasheet as ±1.5 % from 0 to 50 °C, and a divider that gives +0.8 % error at the chosen rate. The receiver is crystal-driven with a fractional divider and negligible error. Is 8N1 safe?

Worst case the sender is 1.5 + 0.8 = 2.3 % off; the receiver contributes nothing, so the mismatch is 2.3 % against a budget of about 4.6 % before edge effects. That works, with margin. Now replace the receiver with an identical sensor: both can be 2.3 % off in opposite directions, 4.6 % in total, and the margin is gone. The same part is fine in one system and marginal in another. Tolerance is a property of the **pair**.`,
    ],
    quiz: [
      { q: 'A UART is clocked at 16 MHz with ×16 oversampling and an integer divider. Which requested rate will have the larger percentage error?', kind: 'concept', choices: [
        { t: '115200: its ideal divider is small, so rounding changes it by a large fraction', ok: true, why: 'Rounding 8.68 to 9 changes the divider by 3.7 %. Rounding 104.17 to 104 changes it by 0.16 %.' },
        { t: '9600: slower rates accumulate more drift over the longer duration of each bit', why: 'Drift is measured in fractions of a bit, so it does not depend on how long a bit is. What matters is the relative rounding of the divider.' },
        { t: 'Both the same, since the error comes from the oscillator and that is unchanged', why: 'The oscillator is the same, but the divider is a different integer in each case, and rounding hurts small integers far more.' },
      ] },
      { q: 'For 8N1 the last sample is taken 9.5 bit times after the start edge. What does this imply about a 9-data-bit frame with parity and two stop bits?', kind: 'concept', choices: [
        { t: 'It tolerates less mismatch: drift builds up over more bit times', ok: true, why: 'The allowed half-bit of drift is divided by a longer distance, so the percentage budget is smaller.' },
        { t: 'It tolerates more mismatch: the extra stop bit gives the receiver time to recover', why: 'A second stop bit adds idle time between frames. The receiver still has to sample every earlier bit correctly using the same free-running clock.' },
        { t: 'It tolerates the same mismatch: only the baud rate sets the budget, not the frame', why: 'The budget is a fraction of a bit spread across the frame length, so the number of bits in the frame directly sets it.' },
      ] },
      { q: 'Text from a device is mostly readable, but some characters are wrong and the errors increase when the device warms up. What is the most likely cause?', kind: 'circuit', choices: [
        { t: 'The baud rates are marginally matched and one oscillator drifts when warm', ok: true, why: 'A marginal mismatch corrupts only some frames, and an RC oscillator\'s frequency shifts with temperature, pushing it over the edge.' },
        { t: 'TX and RX are swapped, and the fault shows more as the connector warms up', why: 'Swapped data lines give no communication at all. They cannot produce mostly correct text.' },
        { t: 'The frame format is 7E1 on one side and 8N1 on the other, which corrupts some characters', why: 'A format mismatch produces the same wrong characters consistently and does not depend on temperature.' },
      ] },
      { q: 'Why can an SPI controller use an inaccurate RC oscillator where a UART could not?', kind: 'arch', choices: [
        { t: 'The peripheral samples on the controller\'s clock edges, so only one clock is involved', ok: true, why: 'With the timing delivered on a wire, the absolute frequency and its stability do not affect correctness.' },
        { t: 'SPI resynchronises at every byte like a UART, but its bytes are too short to drift far', why: 'SPI does not resynchronise because it never free-runs. Every bit has its own edge from the controller.' },
        { t: 'SPI peripherals contain their own crystals, so the controller\'s accuracy is irrelevant', why: 'Most SPI peripherals have no oscillator involved in the bus timing at all. They are clocked by SCLK.' },
      ] },
      { q: 'The narrowest pulse in a UART capture measures 26 µs. What baud rate should you try first?', kind: 'concept', choices: [
        { t: '38400', ok: true, why: '1 / 26 µs ≈ 38 460 baud, and the nearest standard rate is 38400.' },
        { t: '19200', why: '19200 baud has a 52 µs bit. A 26 µs pulse would be half a bit, which a UART never produces.' },
        { t: '26000', why: 'The number of microseconds is not the baud rate. Take the reciprocal of the bit time and then pick the nearest standard rate.' },
        { t: '115200', why: 'At 115200 a bit lasts 8.7 µs, so a 26 µs pulse would be three bits, and shorter single-bit pulses would appear elsewhere in the capture.' },
      ] },
      { q: 'An I2C controller releases SCL and immediately drives the next data bit without checking the line. A peripheral that stretches the clock is added to the bus. What happens?', kind: 'arch', choices: [
        { t: 'The controller moves on while the peripheral still holds SCL low, and data is corrupted', ok: true, why: 'Clock stretching only works if the controller reads SCL back and waits for it to actually rise.' },
        { t: 'The peripheral is damaged by contention when both devices drive SCL to different levels', why: 'SCL is open-drain, so one device releasing while another pulls low causes no contention. The failure is logical, not electrical.' },
        { t: 'Nothing changes: the pull-up resistor makes the controller wait until SCL has risen', why: 'The pull-up only supplies the high level when everyone has released the line. It cannot make the controller wait.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 4
  {
    id: 'proto-i2c', title: 'I2C: two wires, many devices', minutes: 55,
    summary: 'Open-drain lines, start and stop conditions, addresses and ACKs, the register-pointer convention, and how to size the pull-ups.',
    skills: ['proto-i2c-read', 'proto-i2c-pullup'],
    blocks: [
      `## The problem
A board needs a temperature sensor, a real-time clock, an EEPROM and a small display. With UARTs that is four ports and eight pins. With SPI it is three shared wires plus four chip selects. You have two free pins.

**I2C** (inter-integrated circuit, also written I²C or IIC, and called TWI by some vendors) connects all of them with two wires by giving each device an **address**.

## The wires
- **SDA**: serial data, bidirectional.
- **SCL**: serial clock, driven by the controller.

Both are **open-drain** with one pull-up resistor each. Every device connects straight to both lines. Because nobody ever drives high, the controller and a peripheral can take turns on SDA with no direction-control signal, and two devices driving at once cannot damage each other.

The device that starts transfers and generates SCL is the **controller**; the devices that respond to an address are **targets**. Older documents say master and slave. The roles lesson covers the naming.

## The rules of the wire
Two rules define everything else:

1. **While SCL is high, SDA must not change** during normal data transfer. The receiver reads SDA while SCL is high; the sender changes SDA only while SCL is low.
2. Rule 1 is broken deliberately in exactly two places, and that is how frames are marked:
   - **START (S)**: SDA falls while SCL is high.
   - **STOP (P)**: SDA rises while SCL is high.

Because these two patterns cannot occur inside data, every device can find the beginning of a transaction at any time, even if it was powered up in the middle of one.`,
      { t: 'figure', svg: i2cSvg, caption: 'START, three data bits and STOP. Inside the dashed boxes SDA changes while SCL is high; everywhere else it changes only while SCL is low.' },
      `## A transaction
Everything is sent in 9-clock units: 8 bits from the sender, **most significant bit first**, then one bit from the receiver.

1. **START.**
2. **Address byte**: 7 address bits, then the **R/W bit**: 0 = the controller will write, 1 = the controller will read.
3. **ACK**: on the 9th clock the controller releases SDA. The addressed target pulls SDA **low** to acknowledge. If nobody has that address, nobody pulls, the pull-up keeps SDA high, and the controller reads a **NACK**.
4. **Data bytes**, each followed by an acknowledge bit from whoever is *receiving* it.
5. **STOP.**

ACK is a 0 and NACK is a 1 because of the open-drain bus: "nobody answered" and "NACK" are the same electrical state. A missing device costs no special detection logic.

During a **read**, the controller is the receiver, so the controller sends the ACKs. It ACKs every byte it wants more after, and **NACKs the last byte** to tell the target to stop driving SDA, so the controller can issue STOP.

### Address byte arithmetic
The 7-bit address occupies the top seven bits of the first byte. A device at address 0x48 appears on the wire as (0x48 << 1) | 0 = **0x90** for a write and (0x48 << 1) | 1 = **0x91** for a read. Datasheets and logic analysers quote either form. If a datasheet lists two addresses that differ by one ("0x90 write / 0x91 read"), it is giving the 8-bit form and the address you pass to most drivers is half of that.`,
      { t: 'predict', q: 'A controller sends START and then the byte 0xA1. What has it just asked for?',
        choices: [
          { t: 'A read from the device at 7-bit address 0x50', ok: true, why: '0xA1 = 1010 0001. The top seven bits are 101 0000 = 0x50 and the last bit is 1, which means read.' },
          { t: 'A write to the device at address 0xA1', why: 'An address byte holds only seven bits of address. The lowest bit is the direction, so an 8-bit value is never the address itself.' },
          { t: 'A write to the device at 7-bit address 0x50', why: 'The address is right, but the least significant bit of the byte is 1, and 1 selects the read direction.' },
          { t: 'A read from the device at address 0x21', why: 'That takes the low seven bits. The address is in the high seven, with the direction bit at the bottom.' },
        ],
        reveal: 'Shift right by one for the address, look at bit 0 for the direction: 0xA1 >> 1 = 0x50, bit 0 = 1 = read. 0x50 is the usual base address of 24-series serial EEPROMs.' },
      `## The register-pointer convention
The I2C specification says nothing about what data bytes mean. Nearly every sensor uses the same convention on top:

- The device contains numbered **registers** and an internal **register pointer**.
- The first data byte of a **write** sets the pointer. Further bytes in the same write are stored at the pointer, which then usually increments.
- A **read** returns bytes starting at the current pointer.

So reading register 0x00 of a temperature sensor at address 0x48 takes two phases: a write of one byte (the pointer), then a read. Between them you do not want a STOP, because a STOP releases the bus and, on a bus with more than one controller, lets another controller in. Instead the controller issues a second START without a STOP: a **repeated start (Sr)**.`,
      { t: 'ascii', caption: 'Reading two bytes from register 0x00 of a device at 0x48. Upper case: driven by the controller. Lower case: driven by the target.',
        text:
`S  1001000 0  a   00000000  a   Sr  1001000 1  a   dddddddd  A   dddddddd  N   P
|  addr 0x48 W ack  pointer  ack  |  addr 0x48 R ack  byte 1   ACK  byte 2   NACK |
START         = 0x90 = 0x00       repeated     = 0x91       controller      last  STOP
                                  start                     wants more      byte` },
      { t: 'widget', name: 'i2c-visualizer', props: { device: 'tmp102' }, caption: 'Step through a temperature read. At each ninth clock, say who is driving SDA before you look.' },
      `### Worked example: a TMP102-style temperature sensor
Texas Instruments' TMP102 is a typical small I2C sensor. With its address pin tied to ground it answers at 0x48, and its temperature register is at pointer 0x00. In its default mode the reading is a 12-bit two's-complement number, left-justified in two bytes, most significant byte first, with one count equal to 0.0625 °C. (Confirm these against the current datasheet before designing with the part.)

Suppose the two bytes read back are 0x19 and 0x80.

- Combine, MSB first: 0x1980.
- The value is left-justified in 16 bits, so shift right by 4: 0x198 = 408.
- 408 × 0.0625 °C = **25.5 °C**.

Three decisions hide in those lines: byte order, alignment and scale. None is defined by I2C. All come from the datasheet's register description, and getting one wrong gives a plausible-looking wrong temperature.`,
      { t: 'code', lang: 'c', status: 'idf-checked', caption: 'The same read with ESP-IDF\'s I2C controller driver (every call, type and field checked against the ESP-IDF v6.1 headers; not compiled as a whole and not run on a board)',
        code: String.raw`#include "driver/i2c_master.h"

static i2c_master_dev_handle_t tmp;

void tmp_init(void)
{
    const i2c_master_bus_config_t bus_cfg = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = 21,
        .scl_io_num = 22,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
    };
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_cfg, &bus));

    const i2c_device_config_t dev_cfg = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address  = 0x48,            /* 7-bit form */
        .scl_speed_hz    = 100000,
    };
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &dev_cfg, &tmp));
}

/* Returns the temperature in units of 1/16 degree C. */
esp_err_t tmp_read(int16_t *sixteenths)
{
    const uint8_t pointer = 0x00;
    uint8_t raw[2];
    esp_err_t err = i2c_master_transmit_receive(tmp, &pointer, 1, raw, 2, 100);
    if (err != ESP_OK) return err;          /* NACK or timeout: no such device, or bus fault */
    *sixteenths = (int16_t)((raw[0] << 8) | raw[1]) >> 4;
    return ESP_OK;
}`,
        explain: [
          { lines: '7-13', md: 'Selects the I2C peripheral and its pins. The driver configures both pins as open-drain. External pull-up resistors are assumed; the driver can switch on the internal ones (\`.flags.enable_internal_pullup\`), but they are too weak to rely on at anything but short, slow buses. \`glitch_ignore_cnt\` is the width, in peripheral clock cycles, of spikes the input filter removes.' },
          { lines: '17-21', md: 'The address is given in 7-bit form; the driver shifts it and appends the R/W bit. \`scl_speed_hz\` sets the SCL frequency for this device.' },
          { lines: '30', md: 'One call produces the whole sequence in the diagram above: START, address+W, pointer byte, repeated START, address+R, two data bytes with ACK then NACK, STOP. The last argument is a timeout in milliseconds.' },
          { lines: '31', md: 'An error here usually means the address byte was not acknowledged. Treat that as a normal run-time condition: sensors get unplugged.' },
          { lines: '32', md: 'Assemble MSB first, cast to a signed 16-bit type, then shift right by 4. The shift of a negative signed value is arithmetic on the compilers used for these chips (implementation-defined in C), which preserves the sign for temperatures below zero.' },
        ] },
      { t: 'widget', name: 'i2c-visualizer', props: { device: 'eeprom' }, caption: 'An EEPROM write followed by a read-back. Find the repeated start, and watch what the device does if you address it again immediately after the write.' },
      { t: 'callout', kind: 'note', title: 'Why an EEPROM stops answering after a write',
        md: 'After the STOP that ends a write, a serial EEPROM spends some milliseconds programming its cells (the write-cycle time in its datasheet). During that time it does not acknowledge its address. That NACK is not a fault. The standard technique is **acknowledge polling**: keep sending START + address until the device ACKs again.' },
      `## Electrical design: sizing the pull-ups
The pull-up resistor is a design decision with a lower and an upper limit. Both come from the I2C specification (NXP UM10204).

**Lower limit: do not ask a device to sink more than it can.** When a device pulls the line low, the current through the resistor is (V_DD − V_OL) / R_p. Standard-mode and Fast-mode devices are specified to sink 3 mA while keeping the line at or below 0.4 V:

**R_p(min) = (V_DD − V_OL(max)) / I_OL = (3.3 V − 0.4 V) / 3 mA ≈ 967 Ω**

**Upper limit: the line must rise fast enough.** The rising edge is the pull-up charging the bus capacitance C_b — every pin, pad, trace and centimetre of cable. The specification's rise time is measured from 30 % to 70 % of V_DD, and an RC curve takes 0.8473 × R × C to cover that span, so

**R_p(max) = t_r(max) / (0.8473 × C_b)**

| Mode | Bit rate | t_r(max) | Sink current | C_b(max) |
|---|---|---|---|---|
| Standard-mode | 100 kbit/s | 1000 ns | 3 mA | 400 pF |
| Fast-mode | 400 kbit/s | 300 ns | 3 mA | 400 pF |
| Fast-mode Plus | 1 Mbit/s | 120 ns | 20 mA | 550 pF |

### Worked example
A 3.3 V Fast-mode bus with an estimated 100 pF of capacitance:

- R_p(min) = 2.9 V / 3 mA = 967 Ω
- R_p(max) = 300 ns / (0.8473 × 100 pF) = 3.54 kΩ

Any value in between satisfies the specification; 2.2 kΩ is a comfortable standard value. The familiar 4.7 kΩ is fine on this bus at 100 kbit/s (limit 1000 ns / (0.8473 × 100 pF) = 11.8 kΩ) but out of specification at 400 kbit/s: it gives a rise time of 0.8473 × 4.7 kΩ × 100 pF ≈ 400 ns against a 300 ns limit. Such a bus often still works on the bench, which is exactly why the mistake survives until a cable or a second device is added. And at 400 pF, the Fast-mode upper limit is 885 Ω — below the lower limit. No resistor works: that bus needs less capacitance, a lower speed, or a bus buffer.

There is exactly **one** pull-up per line for the whole bus. Breakout boards often each carry their own; plug in four and you have four resistors in parallel, which may fall below the lower limit.`,
      { t: 'exercise', prompt: 'A 3.3 V I2C bus must run in Fast-mode (400 kbit/s, t_r ≤ 300 ns). You estimate the bus capacitance at 200 pF. What is the **largest** pull-up resistance that meets the rise-time limit, in ohms?',
        hints: ['Which of the two limits does a *large* resistor threaten: the current a device must sink, or the time the line takes to rise?', 'It is the rise time: R_p(max) = t_r / (0.8473 × C_b). Keep the units straight: 300 ns = 300 × 10⁻⁹ s, 200 pF = 200 × 10⁻¹² F.', '300e-9 / (0.8473 × 200e-12) = 300e-9 / 169.5e-12.'],
        solution: 'R_p(max) = 300 ns / (0.8473 × 200 pF) ≈ **1770 Ω**. With R_p(min) ≈ 967 Ω at 3.3 V, the usable window is roughly 1.0 kΩ to 1.7 kΩ; 1.5 kΩ is a standard value inside it. Doubling the capacitance halved the upper limit: this is why long I2C cables do not work at speed.',
        answer: { type: 'number', value: 1770, tol: 30, unit: 'Ω' } },
      { t: 'exercise', prompt: 'On a 5 V Standard-mode bus, what is the **smallest** allowed pull-up resistance, in ohms? (Devices sink 3 mA at V_OL = 0.4 V.)',
        hints: ['A *small* resistor lets more current flow into the device that is pulling low. What limits that current?', 'The resistor has V_DD − V_OL across it when a device pulls low, and the device is only specified to sink 3 mA.', '(5.0 − 0.4) V / 0.003 A.'],
        solution: 'R_p(min) = 4.6 V / 3 mA ≈ **1533 Ω**. Anything smaller would force a device to sink more than the 3 mA it is specified for, and its low level could rise above the valid threshold.',
        answer: { type: 'number', value: 1533, tol: 20, unit: 'Ω' } },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'no-pullups' }, caption: 'A bus where every address is NACKed. Look at the shape of the edges, not just the decoded bytes.' },
      { t: 'callout', kind: 'mistake', title: 'Relying on internal pull-ups',
        md: 'A microcontroller\'s internal pull-ups are typically tens of kilohms. With even 50 pF of bus capacitance that gives rise times of microseconds, far beyond the 300 ns Fast-mode limit, and the waveform turns into shark fins that never reach a clean high level. It may work at 100 kHz on a short bench set-up and fail when a second device or a longer wire is added. Fit external resistors and look at the rising edge on a scope at least once per design.' },
      `## Finding devices, and when two share an address
A **bus scan** sends START + address + STOP for each address in turn and records which ones ACK. Addresses 0x00–0x07 and 0x78–0x7F are reserved by the specification, leaving 112 usable 7-bit addresses.`,
      { t: 'widget', name: 'i2c-visualizer', props: { device: 'scan' }, caption: 'A scan in progress. Compare an address that is acknowledged with one that is not, on the ninth clock.' },
      `A device's address is fixed by its manufacturer, usually with one to three pins that set the lowest bits. Two identical sensors with the same pin setting will both acknowledge and both drive data, and you read garbage that still looks like valid I2C. This is an **address conflict**. The fixes are: set the address pins differently; use a second I2C port; put an I2C multiplexer (such as a TCA9548A-type part) between the controller and the conflicting devices; or choose a different part.

The specification also defines **10-bit addressing**: a first byte of the form 11110xx plus R/W, carrying the top two address bits, followed by a second byte with the remaining eight. It is rare in practice. You should recognise it in a capture; you will seldom need it.

## When the bus hangs
A peripheral drives SDA during a read. If the controller is reset in the middle of that byte, the peripheral is left waiting for more clocks, possibly holding SDA low. The restarted controller sees SDA low, cannot generate a START (which needs SDA to *fall*), and reports the bus as busy forever.

The recovery procedure from the specification: the controller sends up to **nine clock pulses** on SCL (as a GPIO if necessary) while leaving SDA released. The stuck device shifts out its remaining bits, eventually releases SDA at an acknowledge position, and the controller can then issue a STOP. If a device has a reset pin, using it is the more certain fix. Firmware that talks to I2C devices should run this recovery at start-up, because a watchdog reset in mid-transfer is exactly when you need it. ESP-IDF's controller driver provides it as \`i2c_master_bus_reset(bus)\`.

## Clock stretching and multiple controllers, briefly
- A target may hold SCL low to make the controller wait (**clock stretching**, from the previous lesson). Controllers must tolerate it, and should enforce a timeout so one faulty device cannot freeze the bus for ever.
- More than one controller may share the bus. If two start at the same time, **arbitration** on SDA picks a winner without corrupting the message. The arbitration lesson shows how.`,
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'i2c-read' }, caption: 'Decode this capture by hand: mark START, read the address byte, identify each ACK and who sent it, then check yourself with the decoder.' },
      { t: 'widget', name: 'i2c-visualizer', props: { device: 'decode' }, caption: 'No decoder this time. Read the address, the direction and the data byte straight off SDA at the SCL high periods, and check your answer. Use "New capture" until you can do it without counting on your fingers.' },
      { t: 'callout', kind: 'decision', title: 'Why use I2C here and not SPI?',
        md: 'I2C wins when there are several slow devices and few pins: sensors, clocks, small EEPROMs, power-management chips. Two wires serve all of them and the ACK tells you whether a device is present. It loses when you need speed (the pull-up edge limits it to roughly 1 Mbit/s in ordinary modes), long wires (capacitance), or strict timing. For a display, an SD card or a fast ADC, use SPI.' },
      `## A harder case
A scan of a working board finds devices at 0x48 and 0x68. You add a second board with a display on a 40 cm cable, and now the scan shows devices at *every* address — or sometimes at none. Nothing was changed in software.

Reason it through before reading on. "Every address ACKs" means SDA is low at every ninth clock, which a line stuck low would produce. "Sometimes none" suggests a marginal signal rather than a hard short. The new cable added perhaps 50–100 pF, and the display board added a second set of pull-ups (lowering R_p) and possibly a different supply voltage. The checks, in order: idle voltage of both lines with a multimeter; the display board's supply and whether its pull-ups go to 5 V while the controller is 3.3 V; then the rising edge on a scope against the rise-time limit. The method lesson at the end of this section generalises this.`,
      { t: 'refs', items: [
        { title: 'NXP UM10204: I2C-bus specification and user manual', url: 'https://www.nxp.com/docs/en/user-guide/UM10204.pdf', note: 'START/STOP, ACK, arbitration, clock stretching, bus clear, pull-up sizing, mode tables. URL not load-tested from this environment.' },
        { title: 'ESP-IDF: I2C driver (docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/i2c.rst' },
      ] },
    ],
    quiz: [
      { q: 'On the ninth clock after an address byte, SDA is high. What happened?', kind: 'concept', choices: [
        { t: 'No device pulled SDA low: a NACK, nothing answered at that address', ok: true, why: 'An acknowledge is an active pull to low. With nobody pulling, the pull-up leaves the line high.' },
        { t: 'The addressed device acknowledged by driving SDA high for one clock', why: 'No I2C device can drive a line high. High is simply the state when every device has let go.' },
        { t: 'The controller acknowledged its own address byte before the target could respond', why: 'The acknowledge after an address comes from the addressed target. The controller releases SDA on that clock and listens.' },
      ] },
      { q: 'A logic analyser shows `S 0xD0 A 0x75 A Sr 0xD1 A 0x68 N P`. What is the 7-bit address and what was done?', kind: 'concept', choices: [
        { t: 'Address 0x68: pointer set to 0x75, then one byte (0x68) read back', ok: true, why: '0xD0 >> 1 = 0x68 with W; 0x75 is the pointer; after the repeated start 0xD1 is the same address with R; one byte is read and NACKed as the last.' },
        { t: 'Address 0xD0: the bytes 0x75 and 0xD1 were written, then 0x68 was read', why: 'The byte after a repeated start is always a new address byte with its direction bit, not data.' },
        { t: 'Address 0x68: the value 0x68 was written to register 0x75', why: 'The second phase has its direction bit set to read, and the final byte is followed by the controller\'s NACK, which marks the last byte of a read.' },
      ] },
      { q: 'During a multi-byte read, who sends the acknowledge bit after each data byte, and what does the last one look like?', kind: 'concept', choices: [
        { t: 'The controller; it ACKs every byte except the last, which it NACKs', ok: true, why: 'The receiver of a byte acknowledges it. The NACK tells the target not to drive another byte, leaving SDA free for the STOP.' },
        { t: 'The target; it ACKs each byte it sends so the controller knows the byte is complete', why: 'A device does not acknowledge its own data. The acknowledge always comes from the receiving side.' },
        { t: 'The controller; it ACKs every byte including the last, then sends STOP', why: 'If the last byte were ACKed, the target would start driving the next byte and could hold SDA low when the controller tries to send STOP.' },
      ] },
      { q: 'A 3.3 V Fast-mode bus has 4.7 kΩ pull-ups and about 150 pF of capacitance. Is it within the specification?', kind: 'circuit', choices: [
        { t: 'No: the limit for a 300 ns rise is about 2.4 kΩ, so the edges are too slow', ok: true, why: '300 ns / (0.8473 × 150 pF) ≈ 2.36 kΩ. A 4.7 kΩ resistor gives roughly twice the allowed rise time.' },
        { t: 'Yes: 4.7 kΩ is the standard I2C value and suits every bus at 3.3 V', why: '4.7 kΩ is common because it suits short Standard-mode buses. The right value depends on speed and capacitance and has to be calculated.' },
        { t: 'No: 4.7 kΩ is below the minimum, so devices would have to sink too much current', why: 'The minimum at 3.3 V is under 1 kΩ. The problem with a larger resistor is the slow rising edge, not the current.' },
      ] },
      { q: 'Four breakout boards, each with its own 4.7 kΩ pull-ups to 3.3 V, are plugged into one bus. What is the effective pull-up, and is it a problem?', kind: 'circuit', choices: [
        { t: 'About 1.2 kΩ: still above the 967 Ω minimum, but a fifth board would not be', ok: true, why: 'Four equal resistors in parallel give a quarter of the value: 1175 Ω. A fifth brings it to 940 Ω, below the minimum for 3 mA devices.' },
        { t: '18.8 kΩ: the resistances add up, so the edges become too slow for the bus', why: 'Resistors to the same rail on the same line are in parallel, so the value goes down, not up.' },
        { t: '4.7 kΩ: identical pull-ups to the same rail do not combine, so nothing changes', why: 'Each resistor provides its own path from the supply to the line. Parallel paths always lower the total resistance.' },
      ] },
      { q: 'After a watchdog reset, the firmware reports "I2C bus busy" until power is cycled. SDA measures 0 V, SCL 3.3 V. What should the start-up code do?', kind: 'code', choices: [
        { t: 'Toggle SCL up to nine times with SDA released, then send a STOP', ok: true, why: 'A target interrupted in the middle of sending a byte is waiting for clocks. Clocking it lets it finish and release SDA.' },
        { t: 'Drive SDA high as a push-pull output for a moment to force the line back up', why: 'That fights the device holding the line low: bus contention, with a short-circuit current through both pins and no guarantee the device lets go.' },
        { t: 'Increase the I2C timeout so the stuck transfer has time to finish', why: 'A longer timeout only waits longer. The target will hold SDA indefinitely until it receives clock pulses or is reset.' },
        { t: 'Send the START condition repeatedly until the target responds', why: 'A START needs SDA to fall while SCL is high. With SDA already held low by another device, the controller cannot produce that edge.' },
      ] },
      { q: 'Two identical sensors with the same address are on one bus. What does a read return?', kind: 'arch', choices: [
        { t: 'A bitwise AND of what the two would send, with no error indicated', ok: true, why: 'Both acknowledge and both drive SDA. On a wired-AND line any 0 wins, so the result is a mix that still looks like a normal transaction.' },
        { t: 'The data from whichever sensor is electrically closer to the controller', why: 'Position on the bus gives no priority. Both devices respond and their outputs combine on the shared line.' },
        { t: 'A NACK, because the bus detects that two devices answered the same address', why: 'Both devices pull the acknowledge low together, which is indistinguishable from one device acknowledging.' },
      ] },
    ],
  },
];

export default { lessons };
