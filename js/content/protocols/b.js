// Protocols, part B: SPI, CAN, USB, roles and terminology.

const lessons = [
  // ------------------------------------------------------------------ 5
  {
    id: 'proto-spi', title: 'SPI: a shift register with a clock', minutes: 45,
    summary: 'Four wires, four clock modes, chip-select framing, and how to read the timing diagram that serves as the specification.',
    skills: ['proto-spi-mode'],
    blocks: [
      `## The problem
A display needs 150 kB of pixel data per refresh. At I2C Fast-mode that takes over three seconds. You need a bus where edges are driven hard in both directions, so the clock can run at tens of megahertz.

**SPI** (serial peripheral interface) is that bus. It is also the least standardised bus in this section: there is no SPI specification document in the sense that I2C has one. Each chip's datasheet defines what it expects, and your job is to read it.

## The four wires
| Signal | Driven by | Purpose | Other names you will meet |
|---|---|---|---|
| **SCLK** | controller | clock | SCK, CLK |
| **MOSI** | controller | data to the peripheral | COPI, PICO, SDO (on the controller), SDI or DIN (on the peripheral) |
| **MISO** | peripheral | data to the controller | CIPO, POCI, SDI (on the controller), SDO or DOUT (on the peripheral) |
| **CS** | controller | selects one peripheral, active low | SS, nCS, CSn, CE |

All four are push-pull. That is safe because each wire has one driver, with one exception: MISO is shared by all peripherals, so a peripheral must put its MISO pin into high impedance whenever its CS is high. A part that does not (some do not) cannot share a bus without a buffer.

## What actually happens: two shift registers in a ring
Inside the controller is a shift register; inside the peripheral is another. MOSI connects the output of the first to the input of the second, and MISO closes the ring. Every clock pulse moves one bit out of each register and into the other. After eight pulses the two bytes have **swapped places**.

Two consequences follow, and both surprise people:

- SPI is always **full duplex**. You cannot receive without sending, or send without receiving. To read a byte you transmit a dummy byte (often 0x00 or 0xFF) and keep what comes back. While you send a command, whatever arrives on MISO is usually meaningless and you discard it.
- There is no acknowledge. If no peripheral is connected, the controller clocks in whatever level MISO floats or is pulled to, and happily reports **0xFF or 0x00**. SPI cannot tell you that nobody is there.

## Chip select frames the transaction
CS does three jobs. It tells one peripheral that the clocks are meant for it. Its **falling edge resets the peripheral's bit counter**, so both sides agree on where byte 0, bit 7 is. And its rising edge ends the command. Most peripherals interpret the first byte after CS falls as a command or register address, so CS must stay low for the whole multi-byte transaction and go high between transactions. Toggling CS between every byte, or holding it low permanently, breaks most devices.

## Clock modes: CPOL and CPHA
Controller and peripheral must agree on two things about the clock:

- **CPOL** (clock polarity): the level SCLK idles at. 0 = idles low, 1 = idles high.
- **CPHA** (clock phase): which edge data is **sampled** on. 0 = the first edge after CS falls (the leading edge), 1 = the second (trailing) edge. Data is **shifted** (changed) on the opposite edge.

| Mode | CPOL | CPHA | Clock idles | Sample edge | Shift edge |
|---|---|---|---|---|---|
| 0 | 0 | 0 | low | rising | falling |
| 1 | 0 | 1 | low | falling | rising |
| 2 | 1 | 0 | high | falling | rising |
| 3 | 1 | 1 | high | rising | falling |

Modes 0 and 3 both sample on the **rising** edge and differ only in the idle level; many chips accept either. Modes 1 and 2 sample on the falling edge.`,
      { t: 'ascii', caption: 'One byte, 0xA5 = 1010 0101, MSB first, in mode 0 and in mode 3. ^ marks the sampling edge.',
        text:
`Mode 0 (CPOL=0, CPHA=0)
CS    ‾‾\\_________________________________________________/‾‾
SCLK  _____/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\__/‾\\________
MOSI  ---<  1  ><  0 ><  1 ><  0 ><  0 ><  1 ><  0 ><  1 >---
           ^     ^     ^     ^     ^     ^     ^     ^
      first bit is on the wire BEFORE the first clock edge

Mode 3 (CPOL=1, CPHA=1)
CS    ‾‾\\_________________________________________________/‾‾
SCLK  ‾‾‾‾‾\\_/‾‾\\_/‾‾\\_/‾‾\\_/‾‾\\_/‾‾\\_/‾‾\\_/‾‾\\_/‾‾‾‾‾‾‾‾
MOSI  -----<  1 ><  0 ><  1 ><  0 ><  0 ><  1 ><  0 ><  1 >--
              ^     ^     ^     ^     ^     ^     ^     ^
      first falling edge puts the bit out, the rising edge samples it` },
      { t: 'predict', q: 'A controller in mode 0 talks to a peripheral that expects mode 1 (same idle level, opposite sampling edge). What does the peripheral receive?',
        choices: [
          { t: 'Data that looks like the right bytes shifted by one bit, because it samples just as the line is changing to the next bit', ok: true, why: 'Sampling on the edge where the sender shifts means reading either the previous or the next bit, consistently. The bytes come out rotated by one position.' },
          { t: 'Nothing at all: mismatched modes block the transfer', why: 'Nothing in SPI checks the mode. Every clock edge still moves a bit, so data always arrives; it is just the wrong data.' },
          { t: 'The correct data with the bit order reversed', why: 'Bit order (MSB or LSB first) is a separate setting. The clock mode changes when a bit is read, not the order the bits are sent in.' },
        ],
        reveal: 'A wrong mode gives values that are **almost** right: 0x9F read as 0x3E or 0xCF, an ID of 0x42 read as 0x84 or 0x21. Seeing a known constant arrive doubled, halved or off by a bit is the fingerprint of a CPHA error. Read the device\'s ID register first, precisely because you know what it should be.' },
      { t: 'widget', name: 'spi-analyzer', props: { mode: 0 }, caption: 'Run the ID read in mode 0, then change only the controller\'s mode and compare the bytes it reads.' },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'spi-mode0' }, caption: 'Decode MOSI and MISO by hand: find CS falling, then read each data line at the rising clock edges.' },
      `## The datasheet timing diagram is the specification
Because nothing is standard, every SPI datasheet has a timing diagram. Read it in this order:

1. **Idle level of the clock** while CS is high → CPOL.
2. **Which edge has the data stable around it** (drawn as a steady bus between the "X" crossings, with set-up time t_SU before the edge and hold time t_H after) → the sampling edge, and with CPOL, CPHA.
3. **Bit order**: is the first bit labelled D7/MSB or D0/LSB?
4. **Word structure**: command byte, address bytes, dummy bytes, data; which bit is the read/write flag.
5. **Limits**: maximum SCLK frequency (often lower for reads than for writes), CS set-up time before the first clock, CS hold time after the last, and the minimum time CS must stay high between transactions.

If the diagram shows SCLK low while CS falls and data stable across the rising edges, it is mode 0. If the clock is high at both ends and data is stable across rising edges, mode 3.`,
      { t: 'exercise', prompt: 'A datasheet timing diagram shows SCLK **high** while CS is high. After CS falls, SDI changes on each **falling** edge of SCLK and is drawn stable (with t_SU and t_H marked) around each **rising** edge. Which SPI mode is this? Answer 0, 1, 2 or 3.',
        hints: ['The idle level of the clock gives CPOL.', 'Clock idles high → CPOL = 1. Now: is the sampling edge the first edge after idle or the second?', 'From idle-high the first edge is falling, the second is rising. Sampling on the second edge means CPHA = 1.'],
        solution: 'CPOL = 1 (idles high). The first edge is falling, where data changes; the second edge is rising, where it is sampled → CPHA = 1. **Mode 3.**',
        answer: { type: 'number', value: 3, tol: 0 } },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'spi-mode3' }, caption: 'The same kind of transaction from a mode 3 device. Check the clock\'s idle level first, then decide which edges to read on.' },
      { t: 'code', lang: 'c', status: 'reviewed', caption: 'Reading a 3-byte ID with ESP-IDF\'s SPI controller driver (written against the driver documentation; not run on a board here)',
        code: String.raw`#include "driver/spi_master.h"

static spi_device_handle_t dev;

void flash_init(void)
{
    const spi_bus_config_t bus = {
        .mosi_io_num = 23, .miso_io_num = 19, .sclk_io_num = 18,
        .quadwp_io_num = -1, .quadhd_io_num = -1,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));

    const spi_device_interface_config_t cfg = {
        .clock_speed_hz = 1 * 1000 * 1000,   /* start slow; raise it once it works */
        .mode = 0,                           /* CPOL = 0, CPHA = 0, from the datasheet */
        .spics_io_num = 27,
        .queue_size = 1,
    };
    ESP_ERROR_CHECK(spi_bus_add_device(SPI2_HOST, &cfg, &dev));
}

esp_err_t flash_read_id(uint8_t id[3])
{
    uint8_t tx[4] = { 0x9F, 0, 0, 0 };       /* command, then three dummy bytes */
    uint8_t rx[4];
    spi_transaction_t t = { .length = 8 * sizeof tx, .tx_buffer = tx, .rx_buffer = rx };
    esp_err_t err = spi_device_transmit(dev, &t);
    if (err == ESP_OK) { id[0] = rx[1]; id[1] = rx[2]; id[2] = rx[3]; }
    return err;
}`,
        explain: [
          { lines: '13-18', md: 'Mode, speed and the CS pin belong to the **device**, not the bus, because different chips on the same three wires may need different settings. The driver reprograms the peripheral before each transaction.' },
          { lines: '24-26', md: 'One transaction of 32 clocks with CS held low throughout. `length` is in **bits**. The three zero bytes exist only to generate clocks for the reply.' },
          { lines: '28', md: '`rx[0]` was clocked in while the command was going out; the peripheral had nothing to say yet, so it is discarded. Forgetting this offset is a common off-by-one.' },
          { lines: '27', md: 'A return of `ESP_OK` means the clocks were generated. It says nothing about whether a device answered. Validate the ID against the datasheet value.' },
        ] },
      `## More than one peripheral
- **Separate chip selects**: SCLK, MOSI and MISO are shared; each peripheral gets its own CS line. Simple, any device can be addressed alone, and each can use its own mode and speed. Costs one pin per device.
- **Daisy chain**: one CS for all; the data output of each device feeds the data input of the next, forming one long shift register. To write three 8-bit devices you clock 24 bits and raise CS, at which point all three latch their part. Saves pins; works only with parts designed for it (shift registers, some DACs and LED drivers), and every transfer is as long as the whole chain.

## Speed and wiring
SPI's clock edges are fast, and the data path is a round trip: the controller's clock edge travels to the peripheral, the peripheral takes some nanoseconds to put its bit on MISO (the clock-to-output time in its datasheet), and that bit travels back, all before the controller's next sampling edge. Long wires add delay and ringing. On a breadboard with 15 cm jumpers, a few megahertz is realistic; tens of megahertz need short traces on a PCB with a solid ground. When an SPI link is unreliable, the first experiment is always to **lower the clock**: if errors disappear, the problem is signal integrity or timing, not your protocol code.`,
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'spi-mode' }, caption: 'A sensor whose ID register reads back a value that is nearly, but not quite, the one in the datasheet.' },
      { t: 'callout', kind: 'mistake', title: 'All 0xFF or all 0x00 is not data',
        md: 'Every byte reading 0xFF usually means MISO is being pulled high and nothing is driving it: wrong CS pin, CS polarity inverted, the device unpowered or held in reset, or MISO not connected. Every byte 0x00 points to MISO shorted or stuck low, or a device that is selected but received a command it does not answer. In both cases the peripheral is not talking, and no amount of changing the mode will help. Check CS at the device\'s pin first.' },
      { t: 'callout', kind: 'decision', title: 'Why SPI here and not I2C?',
        md: 'Choose SPI for speed and for streaming large amounts of data: displays, flash memory, SD cards, fast ADCs. You pay with pins (three plus one per device), with the absence of any presence detection, and with having to read a different timing diagram for every chip. For a handful of slow sensors I2C is less wiring and tells you when a device is missing.' },
      `## A harder case
A flash chip's datasheet allows 50 MHz for most commands but 20 MHz for the plain "read data" command, and an accelerometer on the same bus allows 10 MHz and uses mode 3 while the flash uses mode 0. Can they share SCLK, MOSI and MISO?

Yes: speed and mode are per-transaction properties, set while that device's CS is low. What must hold is that each device ignores the bus while its CS is high (including clock edges in a mode it does not use — true of well-behaved parts, because CS high resets their logic) and releases MISO. The risk is the clock's idle level changing between transactions: the driver must set the new idle level **before** asserting the next CS, or the peripheral sees a spurious edge. A logic analyser on CS and SCLK shows this immediately.`,
      { t: 'refs', items: [
        { title: 'ESP-IDF: SPI master driver (docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/spi_master.rst', note: 'Modes, timing considerations, transaction structure.' },
      ] },
    ],
    quiz: [
      { q: 'How does an SPI controller read one byte from a peripheral?', kind: 'concept', choices: [
        { t: 'It transmits a dummy byte; the eight clocks that send it also shift the peripheral\'s byte in', ok: true, why: 'The two shift registers form a ring, so every transferred byte is an exchange. Reading requires generating clocks, which means sending something.' },
        { t: 'It sets a read/write line and waits for the peripheral to clock the data out', why: 'A peripheral never generates the clock, and SPI has no direction line. Any read/write flag is a bit inside the command byte, defined by the device.' },
        { t: 'It releases MOSI and the peripheral drives both data lines', why: 'Each data line has a fixed direction. The peripheral only ever drives MISO.' },
      ] },
      { q: 'A capture shows SCLK low before CS falls, and MOSI changing on falling clock edges. Which mode is the controller using?', kind: 'concept', choices: [
        { t: 'Mode 0', ok: true, why: 'Idle low gives CPOL 0. Data changes on falling edges, so it is sampled on rising edges, which are the first edges after idle: CPHA 0.' },
        { t: 'Mode 1', why: 'Mode 1 also idles low, but it changes data on the rising edge and samples on the falling edge.' },
        { t: 'Mode 3', why: 'Mode 3 samples on rising edges too, but its clock idles high, which is not what the capture shows.' },
      ] },
      { q: 'Every byte read from a newly wired SPI sensor is 0xFF, in all four modes. What should you check first?', kind: 'circuit', choices: [
        { t: 'That CS actually reaches the device and goes low, and that the device is powered', ok: true, why: 'A constant 0xFF means nothing is driving MISO. An unselected or unpowered device leaves the line to its pull-up, whatever the mode.' },
        { t: 'The bit order setting', why: 'Reversing the bit order of 0xFF still gives 0xFF. The line never changes, so no setting that reinterprets the bits can matter.' },
        { t: 'Whether the clock is too slow for the device', why: 'SPI peripherals are static logic clocked by SCLK. Most have no minimum clock frequency, and a slow clock does not stop MISO being driven.' },
      ] },
      { q: 'Firmware raises CS after the command byte and lowers it again before reading the reply. The device returns nonsense. Why?', kind: 'code', choices: [
        { t: 'CS rising ended the transaction and reset the device\'s state, so the following bytes were taken as a new command', ok: true, why: 'CS frames the transaction. Most devices clear their bit counter and command decoder when it goes high.' },
        { t: 'CS must be toggled between every byte, and the firmware toggled it too few times', why: 'A few parts want that, but the usual rule is the opposite: CS stays low across command, address and data.' },
        { t: 'Raising CS changes the clock mode', why: 'CS has no effect on polarity or phase. Its role is selection and framing.' },
      ] },
      { q: 'Three 8-bit shift-register outputs are daisy-chained on one CS. The controller clocks out the bytes 0x11, 0x22, 0x33 in that order and raises CS. Which device ends up holding 0x11?', kind: 'arch', choices: [
        { t: 'The one furthest from the controller', ok: true, why: 'The chain is one 24-bit shift register. The first byte in is pushed along by the later ones and ends at the far end.' },
        { t: 'The one nearest the controller', why: 'The nearest device holds whatever was shifted in last. Earlier bits have moved on down the chain.' },
        { t: 'All three, since they share MOSI', why: 'In a daisy chain only the first device is connected to MOSI. The others take their input from the previous device\'s output.' },
      ] },
      { q: 'An SPI link works at 1 MHz on a breadboard and gives occasional wrong bits at 20 MHz. The settings are correct. What is the most likely explanation?', kind: 'circuit', choices: [
        { t: 'Wire delay, ringing and the peripheral\'s clock-to-output time no longer fit within half a clock period', ok: true, why: 'At 20 MHz half a period is 25 ns. Long jumpers and the device\'s output delay can use that up, so MISO is sampled before it is valid.' },
        { t: 'The peripheral changed mode at high speed', why: 'A device\'s mode is fixed by its design. Higher speed shrinks timing margins; it does not alter polarity or phase.' },
        { t: 'The pull-up resistors are too large', why: 'SPI lines are driven push-pull in both directions, so edge speed is not set by pull-ups.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 6
  {
    id: 'proto-can', title: 'CAN bus: many nodes, no controller', minutes: 45,
    summary: 'Differential dominant and recessive bits, arbitration by identifier, the frame fields, and the error handling that makes CAN dependable.',
    skills: ['proto-can-arb'],
    blocks: [
      `## The problem
A vehicle has dozens of control units spread over several metres of wiring, next to ignition coils and motors. Any unit may need to report something at any moment; the brake message must not wait behind the seat-heater message; no single unit may be a point of failure; and a unit that goes mad must not take the network down.

UART has no way to share a wire. I2C and SPI need one device in charge and reach a few tens of centimetres. **CAN** (controller area network) was designed by Bosch for exactly this list of requirements and is standardised as ISO 11898.

## The physical layer
CAN uses one twisted pair: **CAN_H** and **CAN_L**. A bit is the *difference* between them.

- **Recessive** (logic 1): no node drives the bus. Both wires sit near 2.5 V; the difference is about 0 V.
- **Dominant** (logic 0): a node drives CAN_H up towards 3.5 V and CAN_L down towards 1.5 V; the difference is about 2 V.

If any node sends dominant, the bus is dominant, whatever the others do. That is the same **wired-AND** idea as an open-drain line, built with a differential pair so that noise picked up along the cable, which hits both wires equally, cancels at the receiver.

Each end of the cable has a **120 Ω** resistor between CAN_H and CAN_L. The resistors match the cable's characteristic impedance, which stops edges reflecting from the ends, and they are what pulls the pair back together for a recessive bit. A quick check on an unpowered bus: a multimeter between CAN_H and CAN_L should read about **60 Ω** (two 120 Ω resistors in parallel). 120 Ω means one terminator is missing; 40 Ω means there is one too many.

A microcontroller cannot drive this itself. Its CAN **controller** (the logic) has two ordinary logic pins, TX and RX, and you add a CAN **transceiver** chip that converts them to and from the differential pair. On Espressif chips the controller peripheral is called **TWAI** (two-wire automotive interface); it speaks classical CAN, and it too needs an external transceiver.`,
      { t: 'ascii', caption: 'A CAN bus: a line with a terminator at each end and short stubs to each node',
        text:
`        120 Ω                                                   120 Ω
   +----/\\/\\/----+                                         +----/\\/\\/----+
   |             |                                         |             |
 CAN_H ==========+===========+================+============+========== CAN_H
 CAN_L ==========+===========+================+============+========== CAN_L
                 |           |                |
            [transceiver] [transceiver]  [transceiver]
              TX | RX       TX | RX        TX | RX
            [ MCU + CAN  ] [ MCU + CAN ] [ ESP32 TWAI ]
             controller     controller     controller` },
      `## Messages have identifiers, not addresses
A CAN frame is not sent *to* anyone. It carries an **identifier** that says what the message *is* ("engine speed", "door status"), and every node receives every frame and keeps the ones it cares about. The identifier is 11 bits in the base format and 29 bits in the extended format.

The identifier is also the message's **priority**.

## Arbitration
Any node may start transmitting when the bus is idle. If two start in the same bit time, both transmit their identifier, most significant bit first, and **each reads the bus back while sending**.

- A node that sends recessive (1) and reads recessive carries on.
- A node that sends recessive (1) and reads **dominant (0)** knows someone else is sending a 0 there. It has lost: it stops transmitting at once and becomes a receiver.
- A node that sends dominant always reads dominant, and carries on.

At the first bit where the identifiers differ, the node with the 0 wins. So the **numerically lowest identifier wins**, and — this is the remarkable part — the winning frame is not damaged. No time is lost and nothing is retransmitted. The loser simply tries again when the bus is next idle.`,
      { t: 'predict', q: 'Three nodes start transmitting at the same instant with identifiers 0x65A, 0x659 and 0x6D0. Which one wins arbitration, and at which point do the others drop out?',
        choices: [
          { t: '0x659 wins. 0x6D0 drops out first (at the bit worth 0x080), 0x65A drops out at the second-to-last bit', ok: true, why: '0x65A = 110 0101 1010, 0x659 = 110 0101 1001, 0x6D0 = 110 1101 0000. Reading from the left, 0x6D0 is first to send a 1 where the others send 0; 0x65A and 0x659 then differ at bit 1.' },
          { t: '0x6D0 wins, because it has the most 0 bits', why: 'The count of zeros is irrelevant. What decides it is who has a 0 at the first bit position, reading from the most significant end, where the identifiers differ.' },
          { t: '0x65A wins, because it started first', why: 'All three started in the same bit time, and nothing favours a sender except the bits of its identifier.' },
          { t: 'Nobody wins; the collision corrupts all three frames and they retry after a random delay', why: 'That is how collision-detecting networks without bitwise arbitration behave. On a wired-AND bus the lowest identifier passes through undamaged.' },
        ],
        reveal: 'Lowest identifier wins: 0x659. Design consequence: assign low identifiers to urgent messages. Two nodes must never transmit the **same** identifier with different data, because then arbitration cannot separate them and the frames collide in the data field.' },
      { t: 'widget', name: 'can-arbitration', caption: 'Give the nodes identifiers and step through bit by bit. At each bit, say which nodes are still transmitting before you advance.' },
      `## The frame`,
      { t: 'ascii', caption: 'Classical CAN data frame, base format (11-bit identifier). Field widths in bits.',
        text:
`| SOF | Identifier | RTR | IDE | r0 | DLC |    Data     |   CRC   | CRC del | ACK | ACK del |  EOF  |
|  1  |     11     |  1  |  1  | 1  |  4  | 0..64 (0-8B)|   15    |    1    |  1  |    1    |   7   |
|<---- arbitration ----->|<--- control --->|             |<-- CRC field -->|<- ACK field ->|
|<---------------- bit stuffing applies from SOF to the end of the CRC ---->|` },
      `- **SOF**: one dominant bit. Its falling edge synchronises every node.
- **Identifier** and **RTR**: the arbitration field. RTR is dominant for a data frame, recessive for a remote request, so data beats a request for the same identifier.
- **IDE**: distinguishes base from extended format. **DLC**: data length code, 0 to 8 bytes.
- **Data**: up to 8 bytes.
- **CRC**: a 15-bit CRC over everything before it. Every receiver computes it too.
- **ACK slot**: the transmitter sends recessive. **Every node that received the frame with a correct CRC drives this bit dominant.** The transmitter therefore learns that at least one node heard it. A node alone on a bus gets no ACK, counts an error, and retransmits for ever — a classic first-day symptom.
- **EOF**: seven recessive bits.

### Bit stuffing
There is no clock wire, so receivers stay aligned using the edges in the data. A long run of identical bits has no edges. CAN therefore requires the transmitter to insert a bit of the **opposite** level after every five identical bits; receivers remove it. The data 0x00 0x00 goes onto the wire as groups of five 0s each followed by a 1. This is why a CAN frame's length on the wire depends on its content, and why a run of six identical bits is illegal — which gives CAN its error signal.

### Errors
Every node checks every frame for stuffing violations, CRC mismatch, wrong fixed-format bits, a missing ACK, and (when transmitting) a bit read back different from the one sent. A node that detects an error immediately sends an **error frame**: six dominant bits, a deliberate stuffing violation that destroys the frame for everyone. All nodes discard it and the transmitter sends it again automatically. Either everybody accepts a frame or nobody does.

To stop a faulty node from destroying every frame for ever, each controller keeps a **transmit error counter** and a **receive error counter**. Errors add to them, successful frames subtract. Above 127 a node becomes **error passive** and may no longer send dominant error flags; if its transmit counter exceeds 255 it goes **bus-off** and stops transmitting entirely until it is restarted. A broken node removes itself.

### Bit timing, in outline
Each bit is divided into time quanta. You configure how many quanta lie before and after the **sample point**, typically placed around 75–87 % of the way through the bit so that the signal has had time to travel the length of the cable and settle. All nodes must be configured for the same bit rate, and the sample points should be similar. Because arbitration needs a bit to travel to the far end and back within one bit time, bus length limits the bit rate: 1 Mbit/s is usable to a few tens of metres, 125 kbit/s to several hundred.

**CAN FD** (flexible data rate) keeps the arbitration scheme and adds two things: up to 64 data bytes per frame, and a switch to a higher bit rate for the data portion, after arbitration is over and only one node is transmitting. Classical-only controllers do not tolerate FD frames; check what each node supports, including whether your chip's TWAI controller supports FD (see its ESP-IDF documentation).`,
      { t: 'exercise', prompt: 'A classical CAN data frame with 8 data bytes has 111 bits including the 3-bit gap that must follow it, before any stuff bits. At 500 kbit/s, how many microseconds does it occupy the bus (ignoring stuff bits)?',
        hints: ['One bit at 500 kbit/s lasts 1 / 500 000 s.', 'That is 2 µs per bit.', '111 bits × 2 µs.'],
        solution: '111 × 2 µs = **222 µs**. Stuff bits can add up to roughly 20 % in the worst case. So a 500 kbit/s bus carries at most about 4000 full frames per second, and a low-priority message waits behind every higher-priority one: worst-case latency is a system design calculation, not a property of one node.',
        answer: { type: 'number', value: 222, tol: 2, unit: 'µs' } },
      { t: 'callout', kind: 'mistake', title: 'One node on the bench',
        md: 'A single CAN node, correctly wired and terminated, appears broken: it transmits the same frame over and over and its error counter climbs. Nothing is wrong. Nobody is there to fill the ACK slot. Add a second node (a USB-CAN adapter in normal, not listen-only, mode counts), or use the controller\'s self-test or no-ACK mode for a first check. The opposite mistake is leaving an analyser in normal mode on someone else\'s bus, where it acknowledges frames that would otherwise have gone unacknowledged; use listen-only mode to observe.' },
      { t: 'callout', kind: 'security', title: 'CAN has no notion of who sent a frame',
        md: 'Any node can transmit any identifier, and receivers have no way to tell. The CRC detects accidental corruption only. A node that is compromised, or a device plugged into the bus, can impersonate any message, and can also force another node bus-off by corrupting its frames. Authenticity has to be added above CAN with a message authentication code and a freshness counter; the security section covers how. Experiment only on a bench network you own.' },
      `## A harder case
A three-node bus works on the bench with 30 cm of wire and no termination at all. Installed in a machine with 25 m of cable, it produces bursts of error frames at 500 kbit/s but runs at 125 kbit/s.

On 30 cm the reflections from the unterminated ends die away within a fraction of a bit, and the transceivers' internal biasing is enough to return the bus to recessive. Over 25 m an edge takes on the order of 125 ns each way, reflections arrive well into the bit, and without the terminators the recessive level recovers slowly. At 125 kbit/s (8 µs bits) the sample point is still after the mess; at 500 kbit/s (2 µs) it is not. The fix is two 120 Ω terminators at the two physical ends — verified with the 60 Ω measurement — not a lower bit rate.`,
      { t: 'refs', items: [
        { title: 'ESP-IDF: TWAI driver (docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-reference/peripherals/twai.rst', note: 'Espressif\'s CAN-compatible controller; transceiver wiring, bit timing, error states.' },
      ] },
    ],
    quiz: [
      { q: 'Nodes with identifiers 0x120 and 0x0F0 begin transmitting simultaneously. What happens?', kind: 'concept', choices: [
        { t: '0x0F0 wins at the first differing bit; 0x120 stops and retries later; the 0x0F0 frame is undamaged', ok: true, why: '0x0F0 has a 0 in the bit worth 0x100 where 0x120 has a 1. Dominant overrides recessive, and the node that sent recessive withdraws.' },
        { t: '0x120 wins because higher identifiers have higher priority', why: 'Priority follows the electrical rule that a dominant 0 overrides a recessive 1, so smaller numbers win.' },
        { t: 'Both frames are destroyed and both nodes retransmit', why: 'Destruction is what happens on buses without bitwise arbitration. Here the losing node stops before it has disturbed any bit of the winner.' },
      ] },
      { q: 'With power off, a multimeter between CAN_H and CAN_L reads 120 Ω. What does that tell you?', kind: 'circuit', choices: [
        { t: 'Only one termination resistor is present; the bus needs one at each end', ok: true, why: 'Two 120 Ω terminators in parallel read 60 Ω. A reading of 120 Ω means one of them is missing.' },
        { t: 'The bus is correctly terminated', why: 'Correct termination is two resistors, one at each end, and they are in parallel as seen by the meter.' },
        { t: 'There is a short between the two wires', why: 'A short would read close to 0 Ω, not the value of a single terminator.' },
      ] },
      { q: 'Why does CAN insert a stuff bit after five identical bits?', kind: 'concept', choices: [
        { t: 'To guarantee edges often enough for receivers to stay synchronised, since there is no clock wire', ok: true, why: 'Receivers re-align on transitions. Without stuffing, a long run of equal bits would let their timing drift.' },
        { t: 'To pad every frame to the same length', why: 'Stuffing makes frame length depend on content. It does the opposite of equalising lengths.' },
        { t: 'To add error-correction information', why: 'Stuff bits carry no information about the data. Detection comes from the CRC and from stuffing-rule violations; nothing in CAN corrects errors.' },
      ] },
      { q: 'A newly built node is the only device on a correctly terminated bus. It sends one frame. What do you observe?', kind: 'arch', choices: [
        { t: 'It retransmits the frame continuously, because no other node fills the ACK slot', ok: true, why: 'The transmitter needs at least one receiver to drive the ACK bit dominant. Without it the frame counts as failed and is sent again.' },
        { t: 'It sends the frame once and reports success', why: 'Success requires an acknowledgement from another node. A lone transmitter never gets one.' },
        { t: 'It goes bus-off immediately', why: 'Missing acknowledgements make the node error passive, but by the standard\'s rules that particular error then stops increasing the counter, so it keeps retrying instead.' },
      ] },
      { q: 'Why can a microcontroller with a built-in CAN (or TWAI) controller not be wired straight to the bus?', kind: 'circuit', choices: [
        { t: 'The controller has logic-level TX and RX pins; a transceiver is needed to create and read the differential dominant/recessive levels', ok: true, why: 'The controller implements the protocol. Driving and sensing the differential pair, with its fault tolerance, is the transceiver\'s job.' },
        { t: 'The controller cannot generate the CRC without a transceiver', why: 'CRC, stuffing, arbitration and error handling are all done by the controller logic. The transceiver is purely electrical.' },
        { t: 'It can, using two open-drain GPIOs and pull-ups', why: 'Open-drain pins give a single-ended wired-AND, not a differential pair with the voltage levels and common-mode range other CAN nodes expect.' },
      ] },
      { q: 'What stops a node with a faulty transmitter from blocking a CAN bus for ever?', kind: 'security', choices: [
        { t: 'Its transmit error counter rises with each failed frame until the controller goes bus-off and stops transmitting', ok: true, why: 'Fault confinement is built into every controller: persistent errors take the node itself off the bus.' },
        { t: 'The other nodes vote to disconnect it', why: 'No node has authority over another and there is no such message. Each controller judges only itself, using its own counters.' },
        { t: 'The termination resistors absorb the faulty frames', why: 'Terminators are passive parts that prevent reflections. They have no effect on which frames are sent.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 7
  {
    id: 'proto-usb', title: 'USB fundamentals', minutes: 40,
    summary: 'Enough USB to understand what happens when you plug a board in, and why it shows up as the device node it does.',
    skills: ['proto-usb-enum'],
    blocks: [
      `## The problem
You plug in an ESP32 board and \`/dev/ttyUSB0\` appears. You plug in an ESP32-S3 board and get \`/dev/ttyACM0\` instead. A third board appears as nothing at all until you install a driver. All three are "USB serial". Why are they different, and how would you find out what a device is?

USB is far more complex than the other buses here, and you will rarely implement it from scratch. This lesson gives you the model at overview depth: enough to read \`lsusb\` output, pick a device class, and debug a board that does not appear.

## One host, many devices
USB is strictly **host-driven**. The host (your PC) starts every transfer; a device speaks only when asked. There is no arbitration because there is never anyone to arbitrate with: the host polls. Hubs fan the bus out into a tree with the host at the root. A device cannot talk to another device.

(USB On-The-Go and USB-C role swapping let one port play either role, but at any moment one end is the host.)

## The wires
A USB 2.0 cable has four conductors: **VBUS** (5 V from the host), **GND**, and a twisted pair **D+** and **D−** carrying half-duplex differential data.

| Speed name | Bit rate | Typical use |
|---|---|---|
| Low speed | 1.5 Mbit/s | keyboards, mice |
| Full speed | 12 Mbit/s | serial adapters, most microcontrollers |
| High speed | 480 Mbit/s | storage, cameras, logic analysers |

USB 3.x adds further pairs for much higher rates and falls back to these on the original pair.

A device announces itself with a 1.5 kΩ **pull-up**: on D+ for full speed, on D− for low speed. With nothing attached, the host's pull-down resistors hold both lines low. The host sees one line rise and knows that a device is present and what speed it is. If your custom board is invisible to the PC, that pull-up (often inside the MCU and enabled by software) is the first suspect, followed by D+ and D− being swapped.

There is no clock wire. Like CAN, USB recovers timing from the data and uses bit stuffing (after six 1s) to guarantee transitions.

## Enumeration: what happens when you plug in
1. The host detects the pull-up and **resets** the port. The device now answers at **address 0**.
2. The host asks address 0 for the first part of the **device descriptor**.
3. The host assigns a unique **address** (1–127) with a Set Address request.
4. The host reads the full device descriptor, then the **configuration descriptor** with its **interface** and **endpoint** descriptors, and any **string descriptors**.
5. The operating system uses those descriptors to choose a driver.
6. The host selects a configuration (Set Configuration). The device is now usable.

If any step fails, Linux logs something like "device descriptor read error" in \`dmesg\`. That message means the electrical link or the device's firmware failed in step 2, before any driver was involved.

## Descriptors
Descriptors are small data structures the device returns to describe itself:

- **Device descriptor**: USB version, **vendor ID (VID)** and **product ID (PID)**, device class, number of configurations. \`lsusb\` prints the VID:PID pair.
- **Configuration descriptor**: power requirement, number of interfaces.
- **Interface descriptor**: one *function* of the device, with a **class**, subclass and protocol code. A device with several interfaces is a **composite device** — one cable, several functions.
- **Endpoint descriptor**: one data pipe: its number, direction, transfer type and maximum packet size.

## Endpoints and transfer types
An **endpoint** is a numbered buffer in the device. Directions are named from the host's point of view: **IN** is device-to-host, **OUT** is host-to-device. Endpoint 0 always exists and carries control requests.

| Transfer type | Guarantees | Used for |
|---|---|---|
| **Control** | reliable, structured request/response | enumeration, configuration (endpoint 0) |
| **Bulk** | reliable, no timing guarantee, uses spare bus time | serial data, storage |
| **Interrupt** | reliable, polled at a guaranteed maximum interval | keyboards, mice, status notifications |
| **Isochronous** | guaranteed bandwidth, **no retry** on error | audio, video |

"Interrupt" is a misnomer: the device cannot interrupt anyone. The host promises to ask often enough.

## Device classes
A **class** is a standard protocol on top of USB, so that one generic driver in the operating system works for every conforming device:

- **CDC-ACM** (communications device class, abstract control model): a virtual serial port. Linux binds its \`cdc_acm\` driver and creates \`/dev/ttyACM0\`.
- **HID** (human interface device): keyboards, mice, game controllers, and any device that exchanges small reports. No driver install on any OS, which also makes it popular for custom devices.
- **MSC** (mass storage class): the device looks like a disk.
- **DFU** (device firmware upgrade): a standard way to download firmware over USB, used by many bootloaders.
- **Vendor-specific** (class 0xFF): no standard; needs the vendor's driver.

## So why ttyUSB0 on one board and ttyACM0 on another?
Many development boards do not connect the MCU to USB at all. They carry a separate **USB-to-UART bridge** chip (families such as CP210x, CH340 and FT232). The bridge uses a **vendor-specific** protocol; Linux has a driver for each family under its "USB serial" framework, and those drivers create **\`/dev/ttyUSB*\`**. Behind the bridge is a real UART with a real baud rate, wired to the MCU's UART0, and usually two of the bridge's modem-control outputs (DTR and RTS) are wired to the reset and boot-mode pins so the flashing tool can put the chip into its bootloader.

Other chips have a USB device controller inside and present a **CDC-ACM** interface themselves, so they appear as **\`/dev/ttyACM*\`**. The ESP32-S3, C3 and C6 contain a fixed-function **USB Serial/JTAG controller** that provides a CDC-ACM console, flashing and JTAG debugging over one cable (on the ESP32-S3 its D+ and D− are GPIO20 and GPIO19). There is no UART in that path at all: the "baud rate" you select is ignored, because bytes travel in USB packets. The original ESP32 has no USB hardware, which is why its boards always carry a bridge. The ESP32-S3 additionally has a USB OTG controller on which your firmware can implement its own device classes.

The name tells you the driver, and the driver tells you the hardware. To see for yourself:`,
      { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Identifying a USB serial device on Linux (standard tools; output depends on your hardware)',
        code: String.raw`lsusb                          # one line per device: bus, address, VID:PID, name
sudo dmesg --follow            # leave running, then plug the board in
lsusb -v -d 303a:              # full descriptors for devices with this vendor ID
udevadm info -q property -n /dev/ttyACM0 | grep -E 'ID_VENDOR|ID_MODEL|ID_USB_DRIVER'
ls -l /dev/serial/by-id/       # stable names that do not change with plug order`,
        explain: [
          { lines: '2', md: 'The kernel log shows enumeration as it happens: the new address, the VID:PID, the strings, and which driver claimed which interface. If nothing at all appears when you plug in, the fault is electrical: cable (many are charge-only, with no data wires), pull-up, or power.' },
          { lines: '3', md: 'Prints the descriptor tree described above. Look for `bInterfaceClass`: 2 and 10 are the CDC control and data interfaces, 3 is HID, 8 is mass storage, 255 is vendor-specific. Replace the vendor ID with the one `lsusb` printed for your device.' },
          { lines: '5', md: '`ttyUSB0` and `ttyACM0` are handed out in plug order. The `by-id` links are derived from the descriptors and serial number, so scripts should use those.' },
        ] },
      { t: 'predict', q: 'You open the serial monitor on an ESP32-S3 board connected through its built-in USB Serial/JTAG port, with the monitor set to 9600 baud. The firmware prints to the console. What do you see?',
        choices: [
          { t: 'Correct text: there is no UART in the path, so the baud setting has no effect', ok: true, why: 'The bytes travel as USB bulk packets from the chip\'s USB controller. A CDC-ACM device receives the requested baud rate as a control message and, having no UART, is free to ignore it.' },
          { t: 'Garbage, because the firmware\'s console is 115200 baud', why: 'A baud mismatch needs an asynchronous UART link with two clocks. Here the data is carried in USB packets with their own timing and error checking.' },
          { t: 'Nothing, because CDC-ACM requires a matching baud rate to open the port', why: 'Opening the port sends the line settings to the device as information. The device does not have to act on them and the host does not wait for agreement.' },
        ],
        reveal: 'Correct text. The same test on a board with a bridge chip gives garbage, because there the setting configures a real UART inside the bridge. This is a quick way to tell which kind of board you have, alongside the device name.' },
      { t: 'exercise', prompt: 'A full-speed bulk endpoint has a maximum packet size of 64 bytes. Suppose the host fits 19 such packets for this device into every 1 ms frame. What throughput is that in kilobytes per second (1 kB = 1000 bytes)?',
        hints: ['Bytes per frame = packets per frame × bytes per packet.', '19 × 64 = 1216 bytes per millisecond.', 'Multiply by 1000 frames per second and divide by 1000 for kB.'],
        solution: '19 × 64 = 1216 bytes per 1 ms frame = **1216 kB/s**, about 1.2 MB/s. That is the order of the ceiling for full-speed bulk transfers, and bulk has no guaranteed share: other devices on the same bus reduce it. Compare 11.5 kB/s for a 115200-baud UART — the reason native-USB boards flash so much faster.',
        answer: { type: 'number', value: 1216, tol: 5, unit: 'kB/s' } },
      { t: 'callout', kind: 'mistake', title: 'The charge-only cable',
        md: 'Many USB cables shipped with chargers and gadgets contain only the two power wires. The board powers up, its LED lights, and the computer sees nothing — no `dmesg` line at all. Before debugging drivers, try a cable you have personally used for data. Label the charge-only ones or throw them away.' },
      { t: 'callout', kind: 'security', title: 'A USB device is whatever its descriptors claim',
        md: 'The host trusts the descriptors. A microcontroller can enumerate as a keyboard and type commands, which is the basis of "bad USB" attacks, and a device you are testing may expose a DFU or debug interface that hands over its firmware. When you assess a device you own, read its full descriptor tree: unexpected interfaces are entry points. When you design one, expose only the interfaces the product needs.' },
      `## A harder case
A custom board with a native-USB MCU enumerates on one laptop but gives "device descriptor read/64, error -71" on another, through the same cable. Where do you look?

The failure is in step 2 of enumeration, so no driver or class is involved yet: this is signal quality or power. The differences between two hosts are their port's drive strength, the VBUS voltage under load, and timing margins. Candidates in order: VBUS sagging when the board's regulator starts (measure it at the board); missing or wrong series resistors and long, unmatched D+/D− traces; the MCU's USB clock coming from an RC oscillator that is outside USB's tolerance — full-speed USB demands a far more accurate clock than a UART does, which is why USB designs use a crystal or a clock-recovery scheme. You have used the same reasoning as for a UART tolerance budget, at a different scale.`,
      { t: 'refs', items: [
        { title: 'USB-IF document library', url: 'https://www.usb.org/documents', note: 'USB 2.0 specification and class specifications (CDC, HID, MSC, DFU). URL not load-tested from this environment.' },
        { title: 'ESP-IDF: USB Serial/JTAG controller console (docs source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst', note: 'Which chips have it, which pins, and its limitations.' },
      ] },
    ],
    quiz: [
      { q: 'A board appears as `/dev/ttyUSB0`. What does that most likely tell you about its hardware?', kind: 'arch', choices: [
        { t: 'A separate USB-to-UART bridge chip sits between the USB connector and the MCU\'s UART', ok: true, why: 'ttyUSB names are created by the kernel\'s vendor-specific USB-serial drivers, which serve bridge chips. A real UART lies behind it.' },
        { t: 'The MCU implements the CDC-ACM class itself', why: 'A CDC-ACM interface is claimed by the cdc_acm driver, which names its ports ttyACM.' },
        { t: 'The board is a USB host', why: 'A host does not appear as a device node on another host. The board enumerated as a device.' },
      ] },
      { q: 'In which order do these enumeration steps happen?', kind: 'concept', choices: [
        { t: 'Reset → read device descriptor at address 0 → set address → read configuration descriptors → set configuration', ok: true, why: 'The device must first be reachable at the default address so the host can identify it, then be given its own address before the detailed descriptors are read and a configuration chosen.' },
        { t: 'Set address → reset → read descriptors → set configuration', why: 'A reset returns the device to address 0, so an address assigned before the reset would be lost.' },
        { t: 'Set configuration → read descriptors → set address → reset', why: 'The host cannot choose a configuration it has not read yet, and the reset comes first because it puts the device into a known state.' },
      ] },
      { q: 'Which transfer type suits a USB microphone, and why?', kind: 'concept', choices: [
        { t: 'Isochronous: guaranteed bandwidth every frame, and a late sample is useless so there is no retry', ok: true, why: 'Audio needs a steady rate more than perfection. Retransmitting a damaged packet would only delay the samples behind it.' },
        { t: 'Bulk: it is reliable, so no audio is lost', why: 'Bulk gets whatever bus time is left over, with no timing guarantee. Reliable delivery that arrives late produces gaps in audio.' },
        { t: 'Interrupt: the microphone interrupts the host when it has data', why: 'No USB device can initiate a transfer. Interrupt endpoints are polled by the host and are meant for small, occasional reports.' },
      ] },
      { q: 'A custom device needs to exchange 32-byte status reports with a PC application, and users must not have to install a driver on any operating system. Which class is the usual choice?', kind: 'arch', choices: [
        { t: 'HID, using generic reports', ok: true, why: 'Every major OS ships a HID driver and lets applications exchange reports with generic HID devices.' },
        { t: 'Vendor-specific', why: 'A vendor-specific interface has no standard driver, so each operating system needs one supplied or configured.' },
        { t: 'Mass storage', why: 'Mass storage presents a block device with a file system. Passing small live reports through it would mean abusing files as a message channel.' },
      ] },
      { q: 'You plug in a board. Its power LED lights, but `dmesg` shows no new lines at all. What is the most likely cause?', kind: 'circuit', choices: [
        { t: 'The host never saw a pull-up on D+ or D−: a charge-only cable, or the device has not enabled its pull-up', ok: true, why: 'Attachment is detected purely by a data line being pulled high. With no data wires, or no pull-up, the host has nothing to react to.' },
        { t: 'The driver for the device is not installed', why: 'A missing driver still produces kernel messages showing the new device and its IDs. Complete silence means enumeration never began.' },
        { t: 'The baud rate is wrong', why: 'Baud rate is a property of a UART behind a bridge. It plays no part in whether the host detects a USB device.' },
      ] },
      { q: 'An endpoint is described as "EP1 IN, bulk". Which way does its data flow?', kind: 'concept', choices: [
        { t: 'From the device to the host', ok: true, why: 'Directions are always named from the host\'s side: IN means into the host.' },
        { t: 'From the host to the device', why: 'That would be an OUT endpoint. The naming follows the host\'s point of view even in device firmware.' },
        { t: 'Both ways, since bulk endpoints are bidirectional', why: 'Only the control endpoint carries data in both directions. Every other endpoint has one fixed direction.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 8
  {
    id: 'proto-roles', title: 'Roles on a bus: controller and peripheral', minutes: 25,
    summary: 'Who drives the clock, who may speak when, and how to read documents written with either the old or the new names.',
    skills: ['proto-roles'],
    blocks: [
      `## The problem
One datasheet labels a pin **SDO**. Another labels the pin you must connect it to **MISO**; a third calls it **POCI**; a 2012 application note for the same bus talks about the "slave". A schematic has a net named \`SPI_MOSI\` running to a pin called \`DIN\`. Before you can wire anything you have to know which names mean the same wire, and which device is in charge.

## What a role is
On every bus in this section, devices are not equal. A role answers three questions:

1. **Who generates the clock** (or the timing)?
2. **Who may start a transfer?**
3. **Who decides which device is being spoken to?**

| Bus | Who clocks | Who may start | How a device is selected |
|---|---|---|---|
| UART | each end times itself | either end, at any time | point-to-point: there is only one other device |
| SPI | controller | controller only | a chip-select wire per peripheral |
| I2C | controller (target may stretch) | any controller | 7-bit address in the first byte |
| CAN | every node times itself | any node when the bus is idle | not selected: frames carry a message identifier |
| USB | host | host only | device address assigned at enumeration |
| RS-485 | each end times itself | decided by the protocol on top | usually an address byte in the frame |

Two patterns cover nearly everything. In a **controller/peripheral** bus (SPI, I2C, USB) one device runs the conversation and the others only answer. The peripheral cannot report an event on its own; it must be **polled**, or it needs an extra wire — an interrupt or "data ready" pin outside the bus — to ask for attention. In a **peer** bus (CAN, UART) any node may transmit without being asked, which then requires a rule for simultaneous senders, or a guarantee that there is only one sender per wire.

The role belongs to the **transaction**, not to the chip. An ESP32 is an I2C controller towards its sensors and can at the same time be an SPI peripheral of a larger processor.

## The names
The roles were historically called **master** and **slave**. Standards bodies and vendors have been replacing those terms. You need to recognise both generations, because datasheets stay in circulation for decades.

**I2C.** The NXP specification UM10204 changed its wording in revision 7 (2021): *master* became **controller** and *slave* became **target**. Signal names SDA and SCL did not change.

**SPI.** There is no single authority, so several naming schemes coexist:

| Function | Traditional | Controller/peripheral forms | Device-centred |
|---|---|---|---|
| Data, controller → peripheral | MOSI | **COPI**, **PICO** | SDO on the controller, SDI / DIN on the peripheral |
| Data, peripheral → controller | MISO | **CIPO**, **POCI** | SDI on the controller, SDO / DOUT on the peripheral |
| Select | SS | **CS** | CS, nCS, CE |
| Clock | SCK, SCLK | SCK, SCLK | CLK |

MOSI/MISO, COPI/CIPO and PICO/POCI name the **wire**: the same name appears at both ends, and you connect like to like. SDI/SDO and DIN/DOUT name the **pin** from that chip's point of view: one chip's SDO goes to the other's SDI. Mixing the two conventions is how MOSI ends up wired to an output.

**UART** has no controller, but TX and RX are also pin-centred: TX connects to RX.

**USB** uses host and device (or function); **CAN** just says node.

This course writes controller/peripheral, uses target for I2C where the specification does, and keeps MOSI/MISO as signal names because most current datasheets and tools still print them.`,
      { t: 'predict', q: 'A sensor\'s datasheet labels its SPI pins SCLK, CS, SDI and SDO. Your MCU\'s SPI peripheral has pins named SCK, MOSI, MISO and a GPIO for chip select. Which MCU pin connects to the sensor\'s SDO?',
        choices: [
          { t: 'MISO', ok: true, why: 'SDO is the sensor\'s serial data output. Data leaving the peripheral travels to the controller on the wire the controller calls MISO.' },
          { t: 'MOSI', why: 'MOSI is the controller\'s output. Joining it to the sensor\'s output puts two push-pull drivers on one wire.' },
          { t: 'Either, because the driver can swap the pins', why: 'Some chips can remap pins, but the electrical fact stands: an output must go to an input. The names are what you have to translate first.' },
        ],
        reveal: 'SDO (sensor out) → MISO (controller in); SDI (sensor in) ← MOSI (controller out). When pins are named from the chip\'s own point of view, cross them; when they are named after the wire (MOSI, MISO, COPI, CIPO), connect like to like.' },
      { t: 'exercise', prompt: 'An older document shows an I2C "slave address 0x3C" and an SPI pin called "SS". Write the modern I2C role name for the device that owns address 0x3C (one word).',
        hints: ['It is the term used in UM10204 revision 7 for the device that responds to an address.', 'Controller is the other role.'],
        solution: '**Target.** The address 0x3C itself is unchanged. "SS" (slave select) is the same wire as CS (chip select).',
        answer: { type: 'text', accept: ['^\\s*target\\s*$', '^\\s*peripheral\\s*$'], nudge: 'Think of the I2C specification\'s current pair of role names: controller and …' } },
      `## What the role costs the peripheral
Because a peripheral cannot speak first, events that originate at the peripheral need a plan:

- **Polling**: the controller asks periodically. Simple; costs bus time and adds up to one polling interval of delay.
- **Interrupt line**: the peripheral has an extra output (INT, DRDY, ALERT) wired to a GPIO on the controller. It asserts the line; the controller then reads the cause over the bus. This is the usual design for sensors.
- **Switch to a peer bus**: if many nodes generate events, a bus designed for it (CAN) may fit better than polling everyone.

And because a peripheral must respond to a clock it does not control, **being** an I2C target or SPI peripheral in firmware is harder than being the controller: the response must be ready when the controller's clock arrives. I2C lets a target stretch the clock to gain time; SPI gives no such help, which is why SPI peripheral firmware prepares its reply before CS falls.`,
      { t: 'widget', name: 'spi-analyzer', props: { mode: 3 }, caption: 'Watch which lines the controller drives and which the peripheral drives during the register read, and note when MISO first carries meaningful data.' },
      { t: 'callout', kind: 'mistake', title: 'Two controllers by accident',
        md: 'Two development boards joined by SPI or I2C, both running example code written for the controller role, will both drive SCLK (push-pull contention on SPI) or both issue START conditions and wait for a target that does not exist (I2C). One side must be configured, and written, as the peripheral or target. When joining two MCUs, decide the roles on paper first, and consider whether a UART — which has no roles — is the simpler link.' },
      { t: 'callout', kind: 'decision', title: 'Which side should be the controller?',
        md: 'Make the controller the device that knows *when* data is needed and has the more flexible timing — usually the main processor. Make the peripheral the device with simple, fixed behaviour. If both sides have events to report at arbitrary times and neither is obviously in charge, a peer link (UART with a framed protocol, or CAN) avoids the polling problem altogether.' },
      `## A harder case
In the 2024 eCTF design, the reference code makes the application processor the I2C controller and the two components I2C peripherals (see \`docs/FACTS.md\`). Suppose a component must tell the application processor about an event within 10 ms, and no spare wire exists for an interrupt.

The component cannot start a transfer. The application processor must poll each component at least every 10 ms, less the time a poll takes; and it must cope with a component that does not answer (a NACK, or a stretched clock that never ends) without stalling the poll of the other. Notice what the role assignment has done to the security picture as well: the controller decides who speaks, so a peripheral that needs to *refuse* something can only do it in the content of its reply. Role is an architectural decision with consequences well beyond wiring.`,
    ],
    quiz: [
      { q: 'A temperature sensor on I2C detects an over-temperature condition. How can it get the controller\'s attention?', kind: 'arch', choices: [
        { t: 'Through a separate alert/interrupt pin wired to a controller GPIO, or by being polled; it cannot start an I2C transfer', ok: true, why: 'A target only responds when addressed. Event signalling needs either polling or a wire outside the bus.' },
        { t: 'By sending a START condition followed by the controller\'s address', why: 'Starting a transfer is the controller role. An ordinary sensor has no logic for it, and the MCU is usually not listening as a target.' },
        { t: 'By holding SCL low until the controller notices', why: 'Stretching is only legitimate inside a transfer addressed to that device. Holding the clock at other times blocks the bus for everyone.' },
      ] },
      { q: 'Chip A has pins DIN and DOUT; chip B (the controller) has pins labelled COPI and CIPO. Which connection is correct?', kind: 'circuit', choices: [
        { t: 'COPI → DIN and CIPO ← DOUT', ok: true, why: 'COPI is controller-out, so it feeds the peripheral\'s data input; the peripheral\'s data output feeds CIPO, controller-in.' },
        { t: 'COPI → DOUT and CIPO ← DIN', why: 'That joins the controller\'s output to the peripheral\'s output, and leaves two inputs facing each other with nothing driving them.' },
        { t: 'It depends on the SPI mode', why: 'The mode sets clock polarity and phase. Which pin is an output and which is an input is fixed by the hardware.' },
      ] },
      { q: 'A 2014 datasheet says "the master generates SCL; the slave may hold SCL low". In current I2C terminology this reads:', kind: 'concept', choices: [
        { t: 'The controller generates SCL; the target may stretch the clock', ok: true, why: 'UM10204 revision 7 renamed the roles controller and target. The behaviour described is unchanged.' },
        { t: 'The host generates SCL; the device may stretch the clock', why: 'Host and device are the role names USB uses. The I2C specification chose different words.' },
        { t: 'The transmitter generates SCL; the receiver may stretch the clock', why: 'Transmitter and receiver describe the direction of the current byte, which changes within a transaction. The clock always comes from the same role.' },
      ] },
      { q: 'Which bus allows a node to transmit without being asked, while more than two nodes share the wires?', kind: 'concept', choices: [
        { t: 'CAN', ok: true, why: 'Any CAN node may start a frame when the bus is idle, and bitwise arbitration resolves simultaneous starts.' },
        { t: 'SPI', why: 'An SPI peripheral can only shift data while the controller selects it and supplies clocks.' },
        { t: 'USB', why: 'A USB device waits for the host to poll it, even on its so-called interrupt endpoints.' },
      ] },
      { q: 'Two MCUs must exchange messages; both produce events at unpredictable times. Which link needs the least protocol machinery to let either side speak first?', kind: 'arch', choices: [
        { t: 'A UART, because each direction has its own wire and either end may transmit at any time', ok: true, why: 'Full duplex on separate wires with no roles means no polling, no arbitration and no interrupt line.' },
        { t: 'SPI, with one MCU as peripheral', why: 'The peripheral MCU cannot start a transfer, so it needs an extra request line or constant polling by the other.' },
        { t: 'I2C, with one MCU as target', why: 'The target MCU has the same limitation: it speaks only when addressed, so its events must be polled for.' },
      ] },
    ],
  },
];

export default { lessons };
