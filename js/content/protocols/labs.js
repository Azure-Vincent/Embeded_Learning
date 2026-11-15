// Protocols: the two labs.
import { BF_PART1, BF_PART2, BF_PART3, BF_PART4 } from './bframe-src.js';

const labs = [
  // ------------------------------------------------------------------ Lab A
  {
    id: 'proto-lab-decode', title: 'Lab A: Decode it yourself', kind: 'Guided lab', minutes: 150,
    summary: 'Decode UART, I2C and SPI traffic by hand and with decoders: first in the simulated logic analyser, then on a real ESP32 with an 8-channel analyser and PulseView.',
    skills: ['proto-logic-analyzer', 'proto-uart-decode', 'proto-i2c-read', 'proto-spi-mode', 'proto-debug'],
    objectives: [
      'Decode a UART byte, an I2C transaction and an SPI transfer from raw waveforms without a decoder',
      'Determine an unknown baud rate and an unknown SPI mode from a capture',
      'Set up a logic analyser correctly: ground, threshold, sample rate, trigger, decoder',
      'Identify which lines of an unlabelled header carry which bus',
      'Compare what the decoder reports with what the firmware intended, and explain any difference',
    ],
    hardware: [
      'Part 1 needs no hardware (simulation only)',
      'Part 2: an ESP32 development board (any variant) and USB data cable',
      'Part 2: an 8-channel USB logic analyser supported by sigrok (the common 24 MHz FX2-based units are) with flying leads and clips',
      'Part 2: any I2C sensor breakout for 3.3 V (for example a TMP102 or similar temperature sensor), breadboard, jumper wires',
      'Part 2: two pull-up resistors of 2.2 kΩ to 4.7 kΩ if the breakout has none fitted',
    ],
    software: [
      'This course\'s logic-analyzer tool (part 1)',
      'PulseView and sigrok-cli (part 2)',
      'ESP-IDF, installed as in the ESP32 section (part 2)',
    ],
    background: [
      `A decoder is a convenience, not an authority. It applies the settings you give it and prints bytes, right or wrong. The skill this lab builds is being able to check it: to look at edges and say "that is a start bit, the bit time is 104 µs, the data bits are 0 0 0 1 0 0 1 0, so the byte is 0x48".

Part 1 uses simulated captures. They are ideal waveforms: perfectly square, no noise, no slow edges. Part 2 repeats the exercise on real hardware, where you will also meet the practical problems — a forgotten ground clip, a sample rate that is too low, a probe on the wrong pin.`,
      { t: 'callout', kind: 'sim', md: 'Part 1 is a simulation. Its captures are generated from the same encoders the other protocol tools use; they are not recordings of hardware.' },
      { t: 'callout', kind: 'hw', md: 'Part 2 needs physical hardware. Nothing in this course was run on a physical board, so the observations in part 2 are written as what you **should** see, with a way to check each one. If your result differs, that is a finding to investigate with the troubleshooting ladder, not an error in your technique by default.' },
    ],
    diagram: [
      { t: 'ascii', caption: 'Part 2 wiring. Pin numbers are for the original ESP32; adapt them to your board and check its pinout for strapping and flash pins.',
        text:
`ESP32 pin        connects to                         analyser channel
---------        ----------------------------------  ----------------
GND              sensor GND, analyser GND (first!)    GND
3V3              sensor VCC (and pull-ups, if needed)
GPIO25 (TX1)     nothing else (or a peer's RX)        D0
GPIO21 (SDA)     sensor SDA  (+ pull-up to 3V3)       D1
GPIO22 (SCL)     sensor SCL  (+ pull-up to 3V3)       D2
GPIO27 (CS)      nothing else                         D3
GPIO18 (SCLK)    nothing else                         D4
GPIO23 (MOSI)    jumper to GPIO19 (MISO): loopback    D5
GPIO19 (MISO)    jumper from GPIO23                   D6` },
      { t: 'callout', kind: 'warn', md: 'Everything here is 3.3 V logic. Check that your analyser\'s inputs accept 3.3 V signals and that the sensor breakout is rated for 3.3 V. Do not probe RS-232 lines or anything above the analyser\'s stated input range.' },
    ],
    steps: [
      { title: 'Part 1.1: UART at a known rate', md: `Open the capture below. Before adding a decoder:

1. Find the first falling edge on D0. That is a start bit.
2. Put the two cursors on that edge and on the next edge that is exactly one bit later, or measure the narrowest pulse. You should measure about 104 µs.
3. Step along in units of that bit time, reading the level in the **middle** of each bit: 1 start, 8 data, 1 stop. Write down the eight data levels.
4. Reverse them (LSB first on the wire) and convert to hex, then to ASCII.

Decode the first two characters this way, then add a UART decoder at 9600 8N1 and read the rest.`,
        blocks: [{ t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-9600-hello' } }] },
      { title: 'Part 1.2: UART at an unknown rate', md: `Nobody recorded the baud rate of this one. Find the narrowest pulse anywhere in the capture, measure it, take the reciprocal, and choose the nearest standard rate. Set the decoder to that rate. If the decoder reports framing errors, your pulse was probably two bits wide: halve the bit time and try again.`,
        blocks: [{ t: 'widget', name: 'logic-analyzer', props: { capture: 'uart-unknown-baud' } }] },
      { title: 'Part 1.3: I2C', md: `Two lines. Decide which is SCL: it is the one with evenly spaced pulses, and the other only changes while it is low — except at START and STOP.

1. Find START (SDA falls while SCL is high).
2. Read SDA at each of the next eight rising edges of SCL, most significant bit first. The first seven bits are the address, the eighth is R/W.
3. Read the ninth bit. Low = ACK. Who drove it?
4. Continue byte by byte. Mark any repeated START, and the final NACK and STOP.

Write the transaction in the notation from the I2C lesson before you turn the decoder on.`,
        blocks: [{ t: 'widget', name: 'logic-analyzer', props: { capture: 'i2c-read' } }] },
      { title: 'Part 1.4: SPI in two modes', md: `For each capture: find CS and the span where it is low; note the level of SCLK just before CS falls (CPOL); then read MOSI and MISO at the edges where they are **stable**, not where they change. Count clocks: they should come in multiples of eight.

State the mode of each capture and the bytes on both data lines. Then set the decoder to the wrong mode on purpose and note how the bytes change. You will recognise that pattern on a bench one day.`,
        blocks: [
          { t: 'widget', name: 'logic-analyzer', props: { capture: 'spi-mode0' } },
          { t: 'widget', name: 'logic-analyzer', props: { capture: 'spi-mode3' } },
        ] },
      { title: 'Part 1.5: the unlabelled header', md: `Four probes on four unknown test points. Not every channel is part of a bus. Use idle levels, pulse regularity and which line changes when, as in the troubleshooting lesson, to name the protocol and its lines. Then decode it.`,
        blocks: [{ t: 'widget', name: 'logic-analyzer', props: { capture: 'mystery' } }] },
      { title: 'Part 2.1: install the tools and find the analyser', md: `On Debian or Ubuntu, PulseView and the command-line tool are packaged. Plug the analyser in and confirm that sigrok sees it. If the scan finds nothing, check \`dmesg\` for the device and whether your user has permission to open it (the sigrok packages install udev rules; you may need to re-plug or log in again).`,
        lang: 'bash', status: 'hw',
        code: String.raw`sudo apt install pulseview sigrok-cli
sigrok-cli --scan            # should list your analyser and its driver
pulseview &` },
      { title: 'Part 2.2: firmware that talks on three buses', md: `Flash firmware that, once a second: prints a line on UART1; reads two bytes from your I2C sensor; and sends four bytes on SPI with MOSI looped back to MISO. Use the driver calls from the UART, I2C and SPI lessons. The sketch below shows the loop; the three \`*_init\` functions are the ones from those lessons, with the sensor address and register changed to match **your** sensor's datasheet.`,
        lang: 'c', status: 'reviewed',
        code: String.raw`void app_main(void)
{
    link_init();                 /* UART1 on GPIO25/26, 115200 8N1    (UART lesson) */
    tmp_init();                  /* I2C on GPIO21/22, 100 kHz          (I2C lesson)  */
    flash_init();                /* SPI on GPIO18/23/19, CS 27, mode 0 (SPI lesson)  */

    for (;;) {
        uart_write_bytes(UART_NUM_1, "Bench\r\n", 7);

        int16_t t;
        esp_err_t err = tmp_read(&t);            /* S addr+W ptr Sr addr+R b1 b2 P */
        printf("i2c: %s raw=%d\n", esp_err_to_name(err), (int)t);

        uint8_t id[3];
        flash_read_id(id);                       /* sends 9F 00 00 00; loopback returns the same */
        printf("spi: %02X %02X %02X\n", id[0], id[1], id[2]);

        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}` },
      { title: 'Part 2.3: capture and decode the UART', md: `Connect analyser **GND first**, then D0 to GPIO25. In PulseView choose a sample rate of at least 1 MHz (about 9 samples per bit at 115200; 2 MHz or more is better), a capture length of about two seconds, and a falling-edge trigger on D0.

You should see bursts of seven frames once a second on a line that idles high. Measure one bit: you should read close to 8.7 µs. Decode the first byte by hand — "B" is 0x42, so after the start bit you should see 0 1 0 0 0 0 1 0 — then add the UART decoder (115200, 8N1) and confirm it prints \`Bench\` followed by 0x0D 0x0A.

Now set the decoder to 57600 and look at what it reports. This is what a receiver at the wrong baud rate would have "heard".` },
      { title: 'Part 2.4: capture and decode the I2C read', md: `Move to D1 (SDA) and D2 (SCL). Sample at 1 MHz or more for a 100 kHz bus. Trigger on a falling edge of SDA.

You should see START, the address byte with W and an ACK, the pointer byte and an ACK, a repeated START, the address byte with R and an ACK, two data bytes — the first ACKed by the controller, the second NACKed — and STOP. Check the address byte: it should be your sensor's 7-bit address shifted left by one, plus the R/W bit.

Then unplug the sensor's SDA wire and capture again. You should see the address byte followed by a NACK and an immediate STOP, and the firmware should print an error. That is what "device not present" looks like.

If you have an oscilloscope, look at the rising edges of SCL as well: they are curves, not vertical lines. Estimate the rise time and compare it with the 1000 ns Standard-mode limit.` },
      { title: 'Part 2.5: capture SPI and prove the mode', md: `Probe D3–D6 on CS, SCLK, MOSI and MISO. The firmware's clock is 1 MHz, so sample at 8 MHz or more. Trigger on the falling edge of CS.

You should see CS low for 32 clocks, SCLK idling low (mode 0), MOSI carrying 9F 00 00 00 and — because of the loopback jumper — MISO carrying the same. Add the SPI decoder with CPOL 0, CPHA 0.

Experiments, one at a time, each followed by a capture: change \`.mode\` to 3 in the firmware and observe the clock's idle level; set the **decoder** to mode 1 while the firmware uses mode 0 and note the shifted bytes; remove the loopback jumper and note what MISO reads (it depends on whether the pin floats or is pulled).` },
      { title: 'Part 2.6: the sample-rate experiment', md: `Capture the 1 MHz SPI transfer again at a sample rate of 2 MHz, then at 1 MHz. Compare with the 8 MHz capture: count the clock pulses in each and look at where the data appears to change relative to the clock. Write down the lowest rate at which the decode was still correct, and compare it with the "at least 4 samples per clock period" rule.` },
    ],
    walkthrough: `**What each tool was telling you.**

- The **cursor measurement** of a bit time is the primary observation; the baud rate is derived from it. A decoder set to the wrong rate does not fail loudly, it produces different bytes, which is why you measure first.
- In the I2C capture, the **ninth clock** of each byte is where the direction of SDA reverses. Whoever is receiving the byte drives it. During the read phase that is the controller, and its NACK on the last byte is deliberate.
- In the SPI capture, the firmware's four bytes on MOSI are one transaction because **CS stays low**. The first byte returned on MISO lines up in time with the command byte: on a real device (without the loopback) it would be meaningless, which is why driver code discards it.
- The **loopback** jumper turns the ESP32 into its own peripheral. It is a standard bring-up technique: if the controller reads back what it sends, its pins, mode and driver are working, and any remaining problem is at the other device.
- The low-sample-rate captures show that an analyser can be confidently wrong. The capture file contains no hint that it missed anything.`,
    testing: `You are done with part 1 when every capture in the tool is marked solved and you can explain each answer without the decoder.

For part 2, check each of these against your own captures:

- UART: the measured bit time is within a few percent of 8.68 µs, and the decoded text matches what the firmware sends, with no framing errors.
- I2C: the address byte equals (7-bit address << 1) | R/W for your sensor; the transaction contains exactly one repeated START; the last data byte is followed by a NACK.
- SPI: 32 clock pulses per transaction; MISO equals MOSI with the loopback fitted; SCLK idles low in mode 0 and high in mode 3.
- With the sensor disconnected, the capture shows an address NACK and the firmware reports an error instead of printing a temperature.

Save one capture of each bus (PulseView's \`.sr\` session files) with a note of sample rate and settings. A capture you can reopen is evidence; a memory of one is not.`,
    troubleshooting: [
      { symptom: 'Every channel shows a flat line or random noise', cause: 'The analyser\'s ground is not connected to the circuit ground, or the probe is on the wrong pin.', fix: 'Connect ground first. Touch a probe to 3V3 and to GND to confirm the channel reads 1 and 0.' },
      { symptom: 'sigrok-cli --scan finds nothing', cause: 'The device is not enumerating, the user lacks permission to open it, or the analyser needs firmware the package did not install.', fix: 'Check dmesg and lsusb for the device. Re-plug after installing the packages so the udev rules apply. See the sigrok wiki page for your device.' },
      { symptom: 'UART decoder shows framing errors on every byte', cause: 'Wrong baud rate or format in the decoder, sample rate too low, or the probe is on RX instead of TX.', fix: 'Measure a bit with the cursors and set the rate from that. Sample at 10× the baud rate or more.' },
      { symptom: 'I2C lines never go high, or the capture shows no START', cause: 'Missing pull-ups, the sensor unpowered, or SDA and SCL swapped at the analyser.', fix: 'Measure both lines with a multimeter at idle: both should read 3.3 V. Swap the decoder\'s channel assignment.' },
      { symptom: 'I2C address is NACKed although the sensor is connected', cause: 'Wrong address for the breakout\'s strap setting, or the 8-bit form of the address was passed to the driver.', fix: 'Read the address byte in the capture, shift it right by one, and compare with the datasheet table.' },
      { symptom: 'SPI decode shows 7 or 9 bits per word, or bytes that change between captures', cause: 'Sample rate too low for the clock, or the capture started in the middle of a transaction.', fix: 'Raise the sample rate to at least 4× (better 10×) the SPI clock. Trigger on CS falling and tell the decoder which channel is CS.' },
      { symptom: 'MISO reads 00 or FF with the loopback fitted', cause: 'The jumper is on the wrong pins, or the firmware\'s pin numbers do not match the wiring.', fix: 'Check continuity from the MOSI pin to the MISO pin. Compare the pin numbers in the bus configuration with the board\'s silk screen.' },
    ],
    challenge: `Pick any device you own that has an accessible I2C or SPI bus or a UART header — a sensor module, an old router, a display. Without its documentation, capture its traffic at power-up, identify the bus and its settings, and write a one-page description: lines, levels, speed, mode or address, and what the first transaction appears to do. Then find the datasheet and mark what you got right and wrong.`,
    quiz: [
      { q: 'You capture a UART at a sample rate equal to twice its baud rate. The decode is unreliable. Why?', kind: 'concept', choices: [
        { t: 'Each edge may be recorded up to half a bit late, so mid-bit samples are unsafe', ok: true, why: 'With two samples per bit the timing uncertainty is as large as the margin a mid-bit sample has. Four is a minimum; ten is comfortable.' },
        { t: 'It should work: two samples per bit is the theoretical minimum, so something else is wrong', why: 'A bare minimum for representing a frequency is not enough to locate asynchronous edges precisely, which is what decoding needs.' },
        { t: 'The analyser\'s threshold is wrong for this logic level', why: 'A threshold problem would persist at any sample rate. The symptom here depends on how often the line is observed.' },
      ] },
      { q: 'In an I2C capture, the ninth bit after the second data byte of a read is high, followed by STOP. What does it mean?', kind: 'concept', choices: [
        { t: 'The controller NACKed the last byte: the normal end of a read', ok: true, why: 'The receiver acknowledges, and during a read that is the controller. A NACK tells the target to stop sending.' },
        { t: 'The target failed to acknowledge the second byte, so the read failed', why: 'During a read the target is the sender of data bytes. It does not acknowledge its own bytes.' },
        { t: 'The bus lost its pull-up for one clock period', why: 'Without a pull-up the line could not be high at all. A high ninth bit shows the pull-up working with nobody pulling low.' },
      ] },
      { q: 'With MOSI jumpered to MISO, the controller reads back exactly what it sent. What has this test established?', kind: 'arch', choices: [
        { t: 'The controller\'s pins, clock and driver work; nothing about any external device', ok: true, why: 'Loopback exercises only the controller\'s side. It isolates faults to one end of the link.' },
        { t: 'That the SPI mode is the one the sensor expects, since the data came back intact', why: 'In loopback the controller samples its own output, which works in every mode. No peripheral\'s timing is involved.' },
        { t: 'That chip select is wired correctly, since the transfer completed', why: 'The loopback path does not depend on CS at all. The data returns whatever CS does.' },
      ] },
      { q: 'Why must the analyser\'s ground lead be connected before the signal probes?', kind: 'circuit', choices: [
        { t: 'Its inputs measure against its own ground; without it there is no reference', ok: true, why: 'As with any single-ended measurement, the reference must be shared for the threshold comparison to mean anything.' },
        { t: 'To power the analyser\'s input stage from the target board\'s supply', why: 'The analyser is powered over USB. The ground lead carries the measurement reference, not supply current.' },
        { t: 'It is only a safety formality at 3.3 V and does not affect the readings', why: 'At these voltages the issue is not safety but correctness: an unreferenced input reads noise.' },
      ] },
      { q: 'A decoder set to SPI mode 1 is applied to a capture of a mode 0 transfer of the byte 0x9F. Which result is plausible?', kind: 'concept', choices: [
        { t: '0x3F or 0xCF: the same bits shifted by one position', ok: true, why: 'Sampling on the edge where data changes picks up the neighbouring bit each time, which shifts the whole byte by one place.' },
        { t: '0xF9: the same bits in reverse order, last bit first', why: 'Reversal comes from the bit-order setting. The clock mode affects when each bit is read, not their sequence.' },
        { t: '0x60: every bit inverted, because the phase is opposite', why: 'Inversion would require the data line\'s polarity to change. Clock phase moves the sampling instant only.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ Lab B
  {
    id: 'proto-lab-framed', title: 'Lab B: Design a framed protocol', kind: 'Project', minutes: 210,
    summary: 'Specify, implement and test a small request/response protocol: frame format, CRC-16, sequence numbers, timeouts and retries, error counters — with a host-tested C reference and corrupted-frame tests.',
    skills: ['proto-frame-design', 'proto-crc', 'proto-reliable', 'proto-debug'],
    objectives: [
      'Write a protocol specification precise enough that someone else could implement the other end',
      'Implement encode and a byte-at-a-time receive state machine that cannot overflow and always resynchronises',
      'Use sequence numbers so that a retried request is answered but not executed twice',
      'Choose timeouts from the link\'s arithmetic, and bound retries',
      'Test the parser with every single- and double-bit corruption of a frame and with random garbage',
      'Expose error counters and use them to observe a degraded link',
    ],
    hardware: [
      'None for the reference implementation and its tests (they run on your computer)',
      'Optional hardware part: two ESP32 boards, three jumper wires (TX→RX, RX→TX, GND), and a logic analyser',
    ],
    software: ['gcc (any recent version) on Linux, macOS or WSL', 'Optional: ESP-IDF for the hardware part'],
    requirements: {
      functional: [
        'F1. A requester sends PING, READ and ADD requests; a responder answers each with a response frame carrying the same sequence number.',
        'F2. A frame that fails its CRC, or whose length field exceeds the maximum, is dropped and counted; it never reaches the application.',
        'F3. A request with no valid response within the timeout is retried up to 3 times, then reported as failed.',
        'F4. A request that is retried is executed at most once by the responder.',
        'F5. After any amount of garbage on the line, the receiver accepts the next valid frame that follows a silent gap.',
        'F6. Both ends keep counters: frames accepted, CRC errors, length errors, bytes skipped, retries, timeouts, failures.',
      ],
      security: [
        'S1. No input, however malformed, may write outside the frame buffer.',
        'S2. State clearly in the specification that the CRC provides no protection against deliberate modification or replay; authentication is out of scope for this lab and is added in the security section.',
      ],
    },
    background: [
      `A UART gives you an unreliable stream of bytes. Applications want reliable messages: "add 1 to the counter, and tell me the result — exactly once". This lab builds the layer in between. It is small, but it contains every element of real link protocols: framing, integrity checking, acknowledgement, retransmission, and duplicate suppression.

The one subtle part is the last. When a response is lost, the requester cannot tell whether the **request** or the **response** went missing. It retries. If the request had in fact arrived, the responder now sees it twice. For PING or READ that is harmless: such requests are **idempotent**. For ADD it is a bug: the counter goes up twice. The cure is a sequence number: the responder remembers the last sequence number it served and the response it gave, and answers a repeat by replaying that response without acting again.`,
      { t: 'callout', kind: 'decision', title: 'Design choices made for you, and why',
        md: `- **Start marker + length + CRC-16**, not COBS: simplest to implement and inspect; the price is that a false start marker can cost a frame, which the retry mechanism absorbs. Switching to COBS is the challenge at the end.
- **CRC-16/CCITT-FALSE**: frames are at most 39 bytes; a 16-bit CRC is ample and the non-zero initial value protects against leading zeros.
- **CRC covers VER through PAYLOAD**, not SOF: SOF is a constant, and covering it adds nothing.
- **Big-endian multi-byte fields**: an arbitrary choice, stated once and used everywhere.
- **Stop-and-wait**: one request outstanding at a time. Enough for a command link, and it keeps the state small.` },
    ],
    diagram: [
      { t: 'ascii', caption: 'The specification: frame layout',
        text:
`offset  field    size  meaning
------  -------  ----  ---------------------------------------------------------
0       SOF      1     0x7E
1       VER      1     protocol version, currently 1
2       TYPE     1     0x01 PING, 0x02 READ, 0x03 ADD; response = request | 0x80; 0xFF = NAK
3       SEQ      1     sequence number chosen by the requester; echoed in the response
4       LEN      1     payload length in bytes, 0..32
5       PAYLOAD  LEN   PING: any bytes (echoed).  READ: empty.  ADD: 1 byte, the amount.
                       responses to READ/ADD: counter, 4 bytes, big-endian.  NAK: 1 byte error code
5+LEN   CRC      2     CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0)
                       over bytes 1 .. 4+LEN, high byte first. Check value for "123456789": 0x29B1

example: PING, SEQ 1, payload "hi"  ->  7E 01 01 01 02 68 69 86 39` },
      { t: 'ascii', caption: 'The specification: behaviour and timing (for a 115200-baud UART)',
        text:
`requester                                  responder
---------                                  ---------
send request (SEQ = previous + 1)  ----->  parse; on a valid frame:
start response timer (50 ms)                 SEQ == last served?  -> resend cached response
                                             otherwise            -> execute, cache, respond
valid response with same SEQ?      <-----
  yes -> done
  no, timer expires -> retry (same SEQ), at most 3 retries, then report failure

either side: no byte for 5 ms while inside a frame -> parser returns to hunting for SOF

largest frame: 39 bytes = 390 bit times = 3.4 ms at 115200 baud
response timeout must exceed: request time + processing + response time  (about 7 ms + processing)` },
    ],
    steps: [
      { title: 'Write the specification first', md: `Copy the two tables above into your notebook and extend them until they answer every question an implementer of the *other* end could ask: what happens on an unknown TYPE? On a wrong VER? On a LEN that does not suit the TYPE? What are the NAK error codes? Is SEQ 0 special? What does the responder do before it has served any request?

The reference implementation answers them like this: unknown TYPE → NAK code 3; wrong VER → NAK code 1; wrong LEN for the TYPE → NAK code 2; SEQ is an 8-bit counter that wraps, no value is special; before the first request nothing is cached, so nothing can be replayed. Decide whether you agree, and note one weakness you can already see (there is at least one: think about what happens when the requester reboots).` },
      { title: 'Frame layout, CRC and encoder', md: `Create \`bframe.c\` and put the four parts from this step and the next three into it, in order. Part 1 defines the frame and serialises it. Notice that the encoder refuses a frame that does not fit, and that every multi-byte quantity is written with shifts, never by copying a struct.`,
        lang: 'c', status: 'host-tested', code: BF_PART1 },
      { title: 'The receive parser', md: `One byte in, one verdict out. The parser owns the error counters. Find, in the code, the two places that enforce requirement S1: the length test that runs before any payload byte is stored, and the fact that every error path returns to \`ST_SOF\`.`,
        lang: 'c', status: 'host-tested', code: BF_PART2 },
      { title: 'The responder and duplicate detection', md: `The responder is the "application": a counter. The first lines of \`bf_respond\` are the duplicate check. The \`dedupe\` flag exists only so that the tests can switch the protection off and show the bug it prevents.`,
        lang: 'c', status: 'host-tested', code: BF_PART3 },
      { title: 'The requester, a lossy wire, and the tests', md: `On your computer there is no UART, so the test harness plays the wire: a function that loses some frames outright and flips a bit in others, driven by a small repeatable random-number generator. \`transact\` is the requester's retry loop. A real port would replace the direct calls with UART writes and a timed wait; the logic is the same.`,
        lang: 'c', status: 'host-tested', code: BF_PART4 },
      { title: 'Build and run', md: `Compile with warnings on and run. In this environment the program printed the lines below; yours should match exactly, because the "random" wire is seeded.

\`\`\`
vector: 7E 01 01 01 02 68 69 86 39
bit-flip test: 7260 corrupted frames, 0 accepted
garbage test: skipped 972060, bad length 3329, bad CRC 496, falsely accepted 0
resynchronised after 1 frame(s)
dedupe on : counter 1998, requests that reached the peer 1998, retries 1012, failed 29
dedupe off: counter 2444, requests that reached the peer 1998  <- acted more than once
all protocol tests pass
\`\`\``,
        lang: 'bash', status: 'host-tested',
        code: String.raw`gcc -Wall -Wextra -std=c11 bframe.c -o bframe && ./bframe` },
      { title: 'Break it on purpose', md: `A test you have never seen fail is a test you cannot trust. Make each change below **alone**, rebuild, note which test fails and how, then undo it:

1. In \`bf_feed\`, delete the \`if (b > BF_MAX_PAYLOAD)\` check. (Compile with \`-fsanitize=address\` as well, and watch the garbage test.)
2. In \`bf_encode\`, start the CRC loop at index 0 instead of 1.
3. Swap the order of the two CRC bytes in the encoder only.
4. In \`bf_respond\`, compare with \`last_seq + 1\` instead of \`last_seq\`.
5. In \`transact\`, change \`++q->seq\` to \`q->seq\` so every request uses the same sequence number. Explain the result.` },
      { title: 'Optional hardware part: two ESP32 boards', md: `Port the protocol to two boards joined by UART1 (TX→RX, RX→TX, GND), using the UART set-up from the UART lesson. Keep parts 1 to 3 unchanged. Replace the test harness with:

- **Requester task**: build the request, \`uart_write_bytes\`, then loop on \`uart_read_bytes\` with a short timeout, feeding each byte to \`bf_feed\`, until a valid response with the right SEQ arrives or 50 ms have passed. Retry up to 3 times.
- **Responder task**: \`uart_read_bytes\` with a 5 ms timeout; on timeout call \`bf_reset\`; on \`BF_FRAME\` call \`bf_respond\` and send the result.
- Once a second, print all the counters on the console UART.

You should see the counter increase by one per ADD and all error counters stay at zero. Then pull the TX wire out for a second and push it back: you should see timeouts and retries rise, possibly a failure, and the link carry on afterwards with the counter still equal to the number of successful ADDs plus any that were executed but whose responses were lost. Capture a retry with the logic analyser and identify the repeated SEQ.`,
        blocks: [{ t: 'callout', kind: 'hw', md: 'This step needs physical hardware and was not run here. Treat the expected observations as predictions to check.' }] },
    ],
    walkthrough: `**Encoder.** \`bf_encode\` validates before it writes, so a caller cannot make it overrun \`out\`. The CRC loop starts at index 1: SOF is not covered.

**Parser.** Five states. \`ST_HEADER\` handles the four header bytes with an index; the moment the fourth (LEN) arrives it is compared with \`BF_MAX_PAYLOAD\`. Only then can the parser enter \`ST_PAYLOAD\`, where \`idx\` is always less than \`len\`, which is at most 32, the size of the buffer. That chain of reasoning is the proof of requirement S1; the garbage test (a million random bytes) and the address sanitiser are the evidence.

The running CRC is updated as each covered byte arrives, so the frame never has to be stored a second time to be checked. The two received CRC bytes are compared with it at the end.

**Why the bit-flip test must find zero.** This CRC detects all single- and double-bit errors in frames of this size. But a flipped bit can also hit SOF (the frame is never seen) or LEN (the parser waits for a different number of bytes and then finds a CRC mismatch, or runs out of input). The test confirms that none of these paths delivers a frame.

**Why the garbage test may not find zero in general.** Random bytes contain 0x7E about once in 256, and a plausible LEN after it about one time in eight; each such candidate then has a 1 in 65 536 chance of a matching CRC. Over a million bytes that is about 500 candidates, and the expected number of false frames is under 0.01. The run printed 0, but a 16-bit CRC cannot make it impossible. This is the real meaning of "undetected error rate", and why long-running links on noisy lines use 32-bit CRCs.

**Responder.** The cached response makes retries safe. With \`dedupe\` off, 446 extra additions were applied in the test run (2444 against 1998): every one of them a case where the response, not the request, was lost.

**Requester.** \`++q->seq\` happens once per transaction, outside the retry loop: retries reuse the number, which is what lets the responder recognise them. The response is accepted only if its SEQ matches, so a late response to an earlier request cannot be mistaken for the current one.

**The 29 failures.** With 10 % loss and 10 % corruption in each direction, one attempt succeeds about 66 % of the time; four attempts all fail about 1.4 % of the time, roughly 28 in 2000. Reliability built from retries is a probability you can calculate, not an absolute.`,
    testing: `The reference is tested when \`./bframe\` prints \`all protocol tests pass\` and exits with status 0, and each of the five deliberate breakages makes it fail.

For your own extensions, keep the same four kinds of test:

1. **Known vector**: a frame whose bytes you worked out by hand. It catches byte-order and coverage mistakes that a round-trip test cannot, because encoder and decoder would share the mistake.
2. **Round trip** at every length, including 0 and the maximum.
3. **Corruption**: every single-bit and double-bit flip must be rejected; random garbage must never crash the parser. Build with \`-fsanitize=address,undefined\` for these runs.
4. **Behaviour under loss**: the counter must equal the number of requests that reached the responder.

On hardware you should additionally see, with a logic analyser on the requester's TX: a request of 8 bytes for ADD (5 header, 1 payload, 2 CRC) lasting about 0.7 ms at 115200 baud, and, when a retry happens, a second identical frame about 50 ms after the first.`,
    troubleshooting: [
      { symptom: 'The known-vector test fails but round trips pass', cause: 'Encoder and parser agree with each other but not with the specification: CRC coverage, initial value or byte order differs.', fix: 'Compute the CRC of bytes 01 01 01 02 68 69 with the lesson\'s reference function: it must be 0x8639. Check the loop bounds and the order of the two CRC bytes.' },
      { symptom: 'Bit-flip test reports accepted frames', cause: 'The CRC is not covering some header field, or the comparison uses only one of the two CRC bytes.', fix: 'Print which bit positions are accepted. They identify the uncovered byte.' },
      { symptom: 'Crash or sanitiser error in the garbage test', cause: 'A path stores a payload byte without the length having been range-checked, or the index is not reset at the start of a frame.', fix: 'Confirm the length test runs when LEN arrives and that idx is zeroed before entering the payload state.' },
      { symptom: 'Counter is higher than the number of requests', cause: 'Duplicate detection is not working: the response cache is not updated, or the requester changes SEQ between retries.', fix: 'Log SEQ for every frame at both ends. A retry must carry the same SEQ as the original.' },
      { symptom: 'On hardware: every request times out although frames are visible on the wire', cause: 'TX/RX not crossed, baud mismatch, or the responder\'s 5 ms reset fires in the middle of frames because the read timeout is rounded down to zero ticks.', fix: 'Walk the ladder: idle levels, crossover, a capture with the UART decoder. Check how the read timeout converts to RTOS ticks.' },
      { symptom: 'On hardware: occasional CRC errors with short wires', cause: 'Receive buffer overrun while the task is busy printing; missing ground; baud divider error on one board.', fix: 'Check the driver\'s overrun events, enlarge the RX buffer, reduce console printing, and measure the actual bit time.' },
    ],
    challenge: `Choose at least two.

1. **Requester reboot.** After a reset the requester's SEQ starts again and may equal the responder's cached SEQ, so a new request is answered with a stale response. Design and implement a fix (a RESET/SYNC message, or a random starting SEQ, or a session identifier) and add a test that fails without it.
2. **COBS framing.** Replace SOF + LEN with COBS encoding and a 0x00 delimiter, using the encoder from the framing lesson. Compare how the two versions behave in the garbage test, and say what the LEN field is still good for.
3. **Inter-byte timeout in the tests.** The harness resets the parser before each frame. Extend the simulated wire to truncate frames mid-way and show that, without a timeout-driven reset, the next frame is lost.
4. **Threat model.** List what an attacker with access to the wire can do to this protocol (forge an ADD, replay a recorded one, block responses to force retries). For each, name the property that is missing. Do not implement the defences yet; the security section does that with a MAC and a counter.`,
    quiz: [
      { q: 'A response to an ADD request is lost. The requester retries with the same sequence number. What must the responder do?', kind: 'arch', choices: [
        { t: 'Recognise the repeated sequence number and resend the stored response', ok: true, why: 'The request already took effect. Replaying the cached answer gives the requester its result while keeping the action exactly-once.' },
        { t: 'Execute the request again, since a request that arrives must be served', why: 'That applies the addition twice. The requester cannot know whether its first request was received, so the responder has to tell the cases apart.' },
        { t: 'Ignore it without replying, since the request has already been served once', why: 'Silence would make the requester time out again and eventually report failure for an operation that actually succeeded.' },
      ] },
      { q: 'Why does the requester keep the same sequence number across retries but increment it for each new request?', kind: 'concept', choices: [
        { t: 'So the responder can tell a retry from a new request with the same content', ok: true, why: 'Two ADD(1) requests look the same byte for byte except for SEQ. The number carries the requester\'s intent.' },
        { t: 'So that the CRC differs between consecutive frames and stale ones are rejected', why: 'The CRC does not need consecutive frames to differ. The sequence number serves matching and duplicate detection.' },
        { t: 'So that frames can be put back in order if they arrive out of sequence', why: 'With one request outstanding at a time there is nothing to reorder. The number identifies the transaction.' },
      ] },
      { q: 'The parser range-checks LEN as soon as it arrives, before the CRC is known. Why is acting on an unverified field acceptable here?', kind: 'security', choices: [
        { t: 'It only bounds what the parser stores; rejecting a too-large value is always safe', ok: true, why: 'Bounding work on untrusted input is always safe. What must wait for the CRC is treating the frame\'s content as meaningful.' },
        { t: 'Because the length field is covered by its own checksum, separate from the CRC', why: 'In this format LEN has no separate check. It is simply compared with the buffer size.' },
        { t: 'It is not acceptable: the check should be moved after the CRC has been verified', why: 'After the CRC is too late: the payload bytes, in whatever number LEN claimed, would already have been written.' },
      ] },
      { q: 'With 10 % of frames lost in each direction and no corruption, roughly what fraction of single attempts (request and response) succeed?', kind: 'concept', choices: [
        { t: 'About 81 %', ok: true, why: 'Both the request and the response must get through: 0.9 × 0.9 = 0.81.' },
        { t: 'About 90 %', why: 'That accounts for one direction only. A transaction needs two frames to survive.' },
        { t: 'About 80 %', why: 'Subtracting the two loss rates double-counts the case where both are lost. The probabilities multiply.' },
      ] },
      { q: 'A million random bytes are fed to the parser and it reports one "valid" frame. Is the implementation wrong?', kind: 'concept', choices: [
        { t: 'Not necessarily: random data occasionally passes a 16-bit CRC by chance', ok: true, why: 'Each candidate frame passes a 16-bit check by chance once in 65 536. The rate is low but not zero, which is why noisier or longer-lived links use wider CRCs.' },
        { t: 'Yes: a correct parser never accepts random data as a valid frame', why: 'No finite check value can exclude every random pattern. The design goal is a known, acceptably small probability.' },
        { t: 'Yes: the CRC polynomial must be faulty to let random data through', why: 'Any 16-bit CRC, however good its polynomial, accepts about one in 65 536 random candidates.' },
      ] },
    ],
    rubric: [
      { criterion: 'Specification', points: 20, evidence: 'Frame table, CRC parameters with check value, byte order, behaviour for every error case, timeouts with their derivation' },
      { criterion: 'Parser safety', points: 25, evidence: 'Length checked before use; garbage and bit-flip tests pass under the address sanitiser' },
      { criterion: 'Reliability', points: 25, evidence: 'Retries bounded; duplicate detection demonstrated by the dedupe on/off comparison' },
      { criterion: 'Observability', points: 15, evidence: 'Error counters at both ends, printed and explained for a degraded link' },
      { criterion: 'Analysis', points: 15, evidence: 'Written answers for the five deliberate breakages and a stated list of what the protocol does not protect against' },
    ],
  },
];

export default { labs };
