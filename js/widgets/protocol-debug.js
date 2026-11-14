// Communication troubleshooting: a broken link, a symptom, a list of checks that each cost a step, then a diagnosis
// and a fix. Waveforms and garbage text come from js/sim/signals.js; meter readings are scripted, illustrative values.
import { h, clear, append } from '../core/dom.js';
import { uartEncode, uartDecode, i2cEncode, spiEncode, spiPeripheral, spiDecode, sample } from '../sim/signals.js';
import { drawWaves, waveBox, onResize } from './_wave.js';
import { runDecoder } from './logic-analyzer.js';

const codes = (t) => [...t].map((c) => c.charCodeAt(0));
const hx = (b) => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0');
const flat = (v) => [{ t: 0, v }];
/** What a terminal shows for received bytes: printable ASCII as is, everything else as a block. */
export const termText = (bytes) => bytes.map((b) => (b === 10 ? '\n' : b === 13 ? '' : b >= 0x20 && b < 0x7F ? String.fromCharCode(b) : '▒')).join('');

/** Add short opposite-level pulses to an edge list at the given times (skipping any that would overlap an edge). */
export function addGlitches(edges, times, width) {
  const out = edges.map((e) => ({ ...e }));
  for (const t of times) {
    if (edges.some((e, i) => i > 0 && e.t >= t - width && e.t <= t + 2 * width)) continue;
    const v = sample(edges, t);
    out.push({ t, v: 1 - v }, { t: t + width, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** The SPI mode scenario, simulated: a controller in `ctrlMode` talks to a peripheral that only works in mode 0. */
export function spiModeSim(ctrlMode) {
  const c = spiEncode({ mosi: [0x8F, 0x00], miso: [], mode: ctrlMode });
  const p = spiPeripheral({ cs: c.cs, sclk: c.sclk, mosi: c.mosi }, { mode: 0, respond: (rx, n) => (n >= 1 && rx[0] === 0x8F ? 0x5A : 0x00) });
  const d = spiDecode({ cs: c.cs, sclk: c.sclk, mosi: c.mosi, miso: p.miso }, { mode: ctrlMode });
  return { sig: { ...c, miso: p.miso }, peripheralSaw: p.rx, controllerRead: d.miso };
}
/** The baud scenario, simulated: text sent at one rate and received at another. */
export function baudGarbage(text, txBaud, rxBaud) {
  const u = uartEncode(codes(text), { baud: txBaud, idleBefore: 2 / rxBaud, idleAfter: 12 / rxBaud });
  const frames = uartDecode(u.edges, { baud: rxBaud });
  return { edges: u.edges, duration: u.duration, bytes: frames.map((f) => f.byte), framingErrors: frames.filter((f) => f.framingError).length };
}

// ---- evidence builders ----
const W = (channels, extra = {}) => ({ channels, ...extra });
const uartWave = (text, baud, name = 'TX') => { const u = uartEncode(codes(text), { baud, idleBefore: 2 / baud, idleAfter: 2 / baud }); return { edges: u.edges, duration: u.duration, name }; };

const bootMsg = uartWave('ok\n', 115200);
const garb = baudGarbage('Temp: 23 C\r\n', 115200, 9600);
const garbLine = termText(garb.bytes) || '▒▒';
const tempWave = uartWave('Te', 115200);
const badAddr = i2cEncode([{ start: true }, { addr: 0x10, rw: 0, ack: false }, { stop: true }]);
const badAddrCh = [{ name: 'SCL', edges: badAddr.scl }, { name: 'SDA', edges: badAddr.sda }];
const spiBad = spiModeSim(1);
const spiCh = [{ name: 'CS', edges: spiBad.sig.cs }, { name: 'SCLK', edges: spiBad.sig.sclk }, { name: 'MOSI', edges: spiBad.sig.mosi }, { name: 'MISO', edges: spiBad.sig.miso }];
const gndClean = uartWave('Hi', 115200, 'RX');
const gndNoisy = addGlitches(gndClean.edges, [0.6, 2.4, 3.3, 5.5, 7.7, 9.2, 11.4, 13.6, 15.5, 17.3, 19.6].map((k) => (k / 115200) + 2 / 115200), 0.18 / 115200);
const lvl = uartWave('AT', 9600);

export const SCENARIOS = {
  'tx-rx-swapped': {
    title: 'UART: nothing arrives',
    setup: 'A 3.3 V microcontroller board is wired to a USB-serial adapter with three jumper wires. The firmware prints "ok" once a second at 115200 baud.',
    symptom: { text: 'The terminal on the PC stays empty. Typing into it does nothing either.', term: '$ screen /dev/ttyUSB0 115200\n\n(no output)' },
    checks: [
      { id: 'wiring', label: 'Trace each jumper wire end to end', short: 'TX wired to TX and RX wired to RX', text: 'Wire 1: MCU pin labelled TX → adapter pin labelled TXD. Wire 2: MCU RX → adapter RXD. Wire 3: GND → GND.' },
      { id: 'mcu-tx', label: 'Analyser on the MCU TX pin with the jumper removed', short: 'clean 115200-baud frames on the MCU TX pin', text: 'With nothing else attached the pin shows clean frames. The firmware is transmitting.',
        wave: W([{ name: 'MCU TX', edges: bootMsg.edges }], { t1: bootMsg.duration, decode: { proto: 'uart', ch: 0, baud: 115200 }, caption: 'Decoded at 115200 8N1: "ok" and a newline.' }) },
      { id: 'adapter-rx', label: 'Analyser on the adapter RXD pin, as wired', short: 'no edges at all on the adapter RXD pin', text: 'Not a single edge in ten seconds. Nothing is driving this wire: it joins two inputs.',
        wave: W([{ name: 'adapter RXD', edges: flat(1) }], { t1: bootMsg.duration, caption: 'Flat. (An undriven input may read high or low; this one happened to read high.)' }) },
      { id: 'meter-tx', label: 'Multimeter on the TX–TXD wire while the MCU is sending', short: 'the TX–TXD wire carries two outputs', meter: ['3.28 V', 'DC, TX–TXD wire to GND'], text: 'Reads as idle high. Both ends of this wire are outputs and both idle high, so most of the time they agree; during each low bit one pulls down while the other pulls up. A meter averages that away.' },
      { id: 'loopback', label: 'Loopback: jumper the adapter TXD to its own RXD and type', short: 'the adapter and PC echo correctly in loopback', text: 'Every typed character appears. The adapter, its driver and the terminal program are working.', term: 'hello\n(typed characters echo back)' },
      { id: 'baud', label: 'Compare the baud settings', short: 'both sides are set to 115200 8N1', text: 'Firmware: uart_init(115200). Terminal: 115200 8N1. They match.' },
    ],
    diagnoses: [
      { id: 'swap', right: true, text: 'TX is connected to TX and RX to RX: the data lines are not crossed', fb: 'Yes. A transmitter has to feed a receiver. Here both outputs share one wire and both inputs share the other, so nothing reaches either receiver.' },
      { id: 'baud', text: 'The baud rates do not match', rule: 'baud', fb: 'A baud mismatch produces garbage or framing errors, not silence: the receiver still sees edges.' },
      { id: 'dead', text: 'The USB-serial adapter is faulty', rule: 'loopback', fb: 'Possible in general, but it needs evidence.' },
      { id: 'fw', text: 'The firmware is not transmitting', rule: 'mcu-tx', fb: 'That would also give silence, so it is worth ruling out.' },
    ],
    fixes: [
      { id: 'cross', right: true, text: 'Connect MCU TX to adapter RXD and MCU RX to adapter TXD', fb: 'Correct. Labels describe each device\'s own point of view: its TX is where it talks. Two push-pull outputs tied together also fight on every low bit, which stresses both pins, so do not leave it wired that way while you think.' },
      { id: 'pull', text: 'Add a pull-up resistor to each data line', fb: 'A pull-up gives an undriven line a defined level. It does not route the MCU\'s transmitter to the adapter\'s receiver, so the terminal stays empty.' },
      { id: 'slow', text: 'Lower both sides to 9600 baud', fb: 'The receiver sees no edges at any speed, because no transmitter is connected to it.' },
      { id: 'gnd', text: 'Add a second ground wire', fb: 'Ground is already connected. The data wires are the problem.' },
    ],
  },
  'baud-mismatch': {
    title: 'UART: garbage characters',
    setup: 'A sensor board prints a temperature line once a second. It is wired to a USB-serial adapter: TX to RXD, RX to TXD, GND to GND.',
    symptom: { text: 'Something arrives once a second, exactly when a line is expected, but it is a few rubbish characters instead of a temperature. It is the same rubbish every time, and the terminal counts framing errors.', term: `${garbLine}\n${garbLine}\n${garbLine}\n(framing errors: ${Math.max(1, garb.framingErrors) * 3})` },
    checks: [
      { id: 'measure', label: 'Capture the line and measure the narrowest pulse', short: 'the narrowest pulse is 8.68 µs, which is 115200 baud', text: 'Cursors on the narrowest pulse: Δt = 8.68 µs, 1/Δt = 115.2 kHz. One bit lasts 8.68 µs, so the sender is running at 115200 baud.',
        wave: W([{ name: 'TX', edges: tempWave.edges }], { t1: tempWave.duration, cursors: 'narrowest', decode: { proto: 'uart', ch: 0, baud: 115200 }, caption: 'First two characters. Decoded at 115200 they read "Te".' }) },
      { id: 'term', label: 'Read the terminal program\'s port settings', short: 'the terminal is set to 9600 8N1', text: 'Port settings: 9600 baud, 8 data bits, no parity, 1 stop bit.' },
      { id: 'gnd', label: 'Continuity between the two grounds', short: 'the grounds are connected (0.2 Ω)', meter: ['0.2 Ω', 'continuity, GND to GND'], text: 'The meter beeps. The grounds are joined.' },
      { id: 'level', label: 'Multimeter on the idle TX line', short: 'the idle line sits at 3.29 V', meter: ['3.29 V', 'DC, TX to GND, idle'], text: 'A healthy idle-high level for 3.3 V logic.' },
      { id: 'swap', label: 'Check that TX goes to RXD', short: 'TX is wired to RXD', text: 'MCU TX → adapter RXD, MCU RX → adapter TXD. Crossed correctly, and data is clearly reaching the receiver.' },
    ],
    diagnoses: [
      { id: 'baud', right: true, text: 'The two ends use different baud rates', fb: 'Yes. The sender\'s bits are 8.68 µs long; a 9600-baud receiver samples every 104 µs, so each of its "bits" spans about twelve real ones. It reads a few arbitrary levels, usually finds a low where the stop bit should be, and reports a framing error.' },
      { id: 'swap', text: 'TX and RX are swapped', rule: 'swap', fb: 'With swapped data lines the receiver sees no edges and the terminal stays empty. Here bytes do arrive.' },
      { id: 'gnd', text: 'There is no common ground', rule: 'gnd', fb: 'A missing ground gives erratic results that change when you touch things. This garbage is the same every second.' },
      { id: 'parity', text: 'The parity setting is wrong', rule: 'term', fb: 'A parity mismatch leaves most characters readable and flags parity errors. It does not turn every character into rubbish.' },
      { id: 'noise', text: 'Electrical noise on the line', rule: 'measure', fb: 'Noise corrupts some characters at random. Here every character is wrong, the same way every time.' },
    ],
    fixes: [
      { id: 'match', right: true, text: 'Set the terminal to 115200 baud so both ends agree', fb: 'Correct. UART has no clock wire, so both ends must be configured to the same rate in advance; a few percent of error is tolerated, a factor of twelve is not.' },
      { id: 'slow', text: 'Use a shorter cable', fb: 'Cable length matters at high rates over long runs. A receiver sampling twelve times too slowly reads rubbish over any cable.' },
      { id: 'pull', text: 'Add a pull-up to the TX line', fb: 'The idle level is already a solid 3.3 V. The receiver would still sample at the wrong instants.' },
      { id: 'cross', text: 'Swap the TX and RX wires', fb: 'They are already crossed correctly. Swapping them would turn garbage into silence.' },
    ],
  },
  'no-pullups': {
    title: 'I2C: bus scan finds nothing',
    setup: 'A bare sensor chip on a home-made adapter board is wired to a 3.3 V microcontroller: SDA, SCL, 3.3 V and GND. The firmware scans every I2C address at 100 kHz.',
    symptom: { text: 'The scan reports no devices, and each attempt ends in a timeout rather than a NACK.', term: 'i2c scan, 100 kHz\n0x08..0x77: no device found\ni2c0: error: bus busy / timeout (SCL or SDA stuck low)' },
    checks: [
      { id: 'idle', label: 'Multimeter on SDA and on SCL with the bus idle', short: 'both idle lines read about 0.1 V instead of 3.3 V', meter: ['0.11 V', 'DC, SDA to GND, idle (SCL: 0.09 V)'], text: 'Both lines sit near 0 V and the reading wanders when you touch the wire. An idle I2C bus should read the supply voltage on both lines.' },
      { id: 'capture', label: 'Capture SDA and SCL during a scan', short: 'the capture shows both lines flat low, never rising', text: 'Neither line ever goes high, so there is no start condition and no clock.',
        wave: W([{ name: 'SCL', edges: flat(0) }, { name: 'SDA', edges: flat(0) }], { t1: 2e-4, caption: 'Both lines low for the whole capture.' }) },
      { id: 'board', label: 'Inspect the adapter board', short: 'the adapter board has no resistors on SDA or SCL', text: 'The chip, a decoupling capacitor and four header pins. There are no resistors from SDA or SCL to 3.3 V anywhere, on the adapter or on the MCU board.' },
      { id: 'power', label: 'Multimeter on the sensor supply pin', short: 'the sensor supply measures 3.30 V', meter: ['3.30 V', 'DC, sensor VDD to GND'], text: 'The sensor is powered.' },
      { id: 'pins', label: 'Read the pin configuration in the firmware', short: 'the pins are open-drain with internal pull-ups off', text: 'Both pins are configured as open-drain I2C pins. Internal pull-ups are not enabled.' },
      { id: 'addr', label: 'Look up the sensor address', short: 'the address is inside the scanned range', text: 'The datasheet address is inside the scanned range. But the scan fails before any address is acknowledged or refused.' },
    ],
    diagnoses: [
      { id: 'pull', right: true, text: 'There are no pull-up resistors on SDA and SCL', fb: 'Yes. I2C devices only ever pull a line low; they rely on a resistor to bring it back high. Without one the line never reaches a valid high level, so the controller sees a bus that is permanently busy.' },
      { id: 'addr', text: 'The firmware uses the wrong address', rule: 'capture', fb: 'A wrong address gives a clean start, eight address bits and a NACK. A scan tries every address anyway.' },
      { id: 'power', text: 'The sensor has no power', rule: 'power', fb: 'An unpowered chip can load the bus, so it is a fair suspicion.' },
      { id: 'swap', text: 'SDA and SCL are swapped', rule: 'idle', fb: 'Swapped lines still idle high and still show activity; the device just never answers.' },
    ],
    fixes: [
      { id: 'add', right: true, text: 'Fit a pull-up resistor (4.7 kΩ is a common starting value) from SDA to 3.3 V and another from SCL to 3.3 V', fb: 'Correct: one resistor per line for the whole bus. Many breakout boards include them, which is why bare chips catch people out. The MCU\'s internal pull-ups are much weaker (check the datasheet for their value); they can work on a short, slow bus but give slow rising edges.' },
      { id: 'pp', text: 'Configure SDA and SCL as push-pull outputs', fb: 'That would produce edges, but I2C depends on any device being able to hold a line low: for ACK, for clock stretching, for arbitration. A push-pull pin driving high against a device pulling low is a short circuit across the supply.' },
      { id: 'slow', text: 'Lower the bus speed to 10 kHz', fb: 'A weak pull-up can be helped by a slower clock. No pull-up at all cannot: the line never rises, however long you wait.' },
      { id: 'addr', text: 'Try the alternative address listed in the datasheet', fb: 'The bus never gets as far as sending an address. Both lines are stuck low.' },
    ],
  },
  'wrong-address': {
    title: 'I2C: NACK on address',
    setup: 'A temperature sensor on a breakout board (with pull-ups fitted) is wired to a 3.3 V microcontroller. The driver was written from the sensor datasheet.',
    symptom: { text: 'Every transfer fails immediately with an address NACK.', term: 'sensor_init: i2c_write(addr=0x90, len=2)\ni2c0: NACK on address\nsensor_init failed: -2' },
    checks: [
      { id: 'capture', label: 'Capture SDA and SCL during the failing write', short: 'the capture shows address 0x10 on the wire, answered with NACK', text: 'A clean start condition, then the byte 0x20: 7-bit address 0x10 with the write bit. Nobody pulls SDA low on the ninth clock, so it is a NACK, and the controller sends a stop.',
        wave: W(badAddrCh, { t1: badAddr.duration, decode: { proto: 'i2c', scl: 0, sda: 1 }, caption: 'Decoder: START, address 0x10 write, NACK, STOP.' }) },
      { id: 'scan', label: 'Run a bus scan', short: 'a scan finds one device, at 0x48', text: 'One device answers.', term: 'i2c scan, 100 kHz\nfound device at 0x48\n1 device found' },
      { id: 'sheet', label: 'Read the address section of the sensor datasheet', short: 'the datasheet gives the address as bytes 0x90 (write) and 0x91 (read)', text: 'The datasheet for this (fictional) part says: "Slave address byte: 1001 000x. Write: 0x90. Read: 0x91." That is the whole first byte on the wire, R/W bit included.' },
      { id: 'api', label: 'Read the documentation of i2c_write()', short: 'i2c_write() expects a 7-bit address and shifts it left itself', text: 'From the HAL: "addr: 7-bit device address. The function shifts it left and appends the R/W bit." Passing 0x90 puts (0x90 << 1) & 0xFF = 0x20 on the wire.' },
      { id: 'idle', label: 'Multimeter on idle SDA and SCL', short: 'both lines idle at 3.3 V', meter: ['3.29 V', 'DC, SDA to GND, idle (SCL: 3.29 V)'], text: 'Both lines idle high. The pull-ups are doing their job.' },
      { id: 'power', label: 'Multimeter on the sensor supply pin', short: 'the sensor supply measures 3.30 V', meter: ['3.30 V', 'DC, sensor VDD to GND'], text: 'The sensor is powered.' },
    ],
    diagnoses: [
      { id: 'addr', right: true, text: 'The code passes the 8-bit address byte (0x90) to a function that expects the 7-bit address (0x48)', fb: 'Yes. Datasheets quote either form. The same seven bits, 1001000, read as 0x48 on their own and as 0x90 or 0x91 once the R/W bit is appended. The HAL shifted an already-shifted value and addressed a device that does not exist.' },
      { id: 'pull', text: 'The pull-up resistors are missing', rule: 'idle', fb: 'Without pull-ups the bus would be stuck low and time out. A NACK needs a working bus: the controller clocked out nine clean bits.' },
      { id: 'dead', text: 'The sensor is damaged or unpowered', rule: 'scan', fb: 'A dead sensor would also NACK, so the symptom alone cannot exclude it.' },
      { id: 'swap', text: 'SDA and SCL are swapped', rule: 'capture', fb: 'Swapped lines would not produce a well-formed start, address and stop.' },
      { id: 'fast', text: 'The bus is too fast for the sensor', rule: 'scan', fb: 'The bus runs at 100 kHz, the slowest standard speed, and the sensor answers at that speed when asked for the right address.' },
    ],
    fixes: [
      { id: '48', right: true, text: 'Pass 0x48 to i2c_write()', fb: 'Correct. When a datasheet gives two addresses that differ only in the last bit, it is quoting 8-bit bytes: shift right by one for the 7-bit address. A capture or a bus scan settles which form you have in seconds.' },
      { id: '91', text: 'Pass 0x91, the read address, instead', fb: '0x91 shifted left by the HAL is 0x22 on the wire: address 0x11. Still not the sensor, still a NACK.' },
      { id: 'pull', text: 'Use stronger pull-ups (1 kΩ)', fb: 'The edges are already clean and the idle level is right. The address on the wire would still be 0x10.' },
      { id: 'retry', text: 'Retry the transfer up to ten times', fb: 'The same wrong address gets the same NACK ten times. Retries are for a device that is temporarily busy, not for one that is never addressed.' },
    ],
  },
  'spi-mode': {
    title: 'SPI: ID register reads zero',
    setup: `A (fictional) SPI sensor is wired to a microcontroller: CS, SCLK, MOSI, MISO, 3.3 V, GND. To read its ID the firmware sends 0x8F and clocks one more byte; the datasheet says the answer is 0x5A.`,
    symptom: { text: 'The ID always reads 0x00. The result is the same on every attempt.', term: `spi: tx 8F 00\nspi: rx ${spiBad.controllerRead.map(hx).join(' ')}\nsensor id = 0x${hx(spiBad.controllerRead[1])} (expected 0x5A)` },
    checks: [
      { id: 'capture', label: 'Capture all four lines and decode as the sensor would (mode 0)', short: `sampled on rising edges, MOSI reads ${spiBad.peripheralSaw.map(hx).join(' ')} and not 8F 00`, text: `Sampling MOSI on each rising clock edge, as the sensor does, gives ${spiBad.peripheralSaw.map(hx).join(' ')}. The controller changes MOSI just after each rising edge, so the sensor latches the previous bit every time: 0x8F arrives shifted right by one as 0x${hx(spiBad.peripheralSaw[0])}. That is not a command the sensor knows, so it sends nothing back.`,
        wave: W(spiCh, { t1: spiBad.sig.duration, decode: { proto: 'spi', cs: 0, sclk: 1, mosi: 2, miso: 3, mode: 0 }, caption: 'Annotations show what a mode-0 receiver reads. The "?" marks samples taken while the line is about to change.' }) },
      { id: 'sheet', label: 'Read the timing diagram in the sensor datasheet', short: 'the datasheet specifies clock idle low, data latched on the rising edge (mode 0)', text: '"SCLK idles low. SDI is latched on the rising edge of SCLK; SDO changes on the falling edge." That is CPOL = 0, CPHA = 0: mode 0.' },
      { id: 'code', label: 'Read the SPI initialisation in the firmware', short: 'the firmware configures SPI mode 1', text: 'spi_init(SPI0, 1000000, SPI_MODE_1);  /* CPOL = 0, CPHA = 1 */' },
      { id: 'slow', label: 'Drop the clock to 100 kHz and retry', short: 'the result is identical at 100 kHz', text: 'Still 0x00 on every read. Speed is not the problem.', term: 'spi: 100 kHz\nsensor id = 0x00 (expected 0x5A)' },
      { id: 'cs', label: 'Check chip select on the capture', short: 'CS goes low for the whole 16-clock transfer', text: 'CS falls before the first clock and rises after the sixteenth. The sensor is being selected.' },
      { id: 'cont', label: 'Continuity check on MOSI and MISO', short: 'MOSI and MISO are wired to the right pins', meter: ['0.3 Ω', 'continuity, MCU MOSI to sensor SDI'], text: 'MCU MOSI reaches the sensor\'s data input and the sensor\'s data output reaches MCU MISO.' },
    ],
    diagnoses: [
      { id: 'mode', right: true, text: 'The controller is in the wrong SPI mode: it changes MOSI on the clock edge the sensor samples on', fb: 'Yes. Mode 1 and mode 0 share the same idle clock level, so the capture looks plausible at a glance. Only the phase differs, and that moves every bit by half a clock.' },
      { id: 'swap', text: 'MOSI and MISO are swapped', rule: 'cont', fb: 'Swapped data lines would also read as zeros, so it is worth excluding.' },
      { id: 'fast', text: 'The clock is too fast for the wiring', rule: 'slow', fb: 'Signal-integrity problems get better when you slow down.' },
      { id: 'cs', text: 'Chip select is not reaching the sensor', rule: 'cs', fb: 'An unselected sensor leaves MISO undriven, which also reads as a constant.' },
      { id: 'order', text: 'The bit order is wrong (LSB first)', rule: 'capture', fb: 'Reversed bit order would turn 0x8F into 0xF1 at the sensor, a mirror image, not a one-bit shift.' },
    ],
    fixes: [
      { id: 'mode0', right: true, text: 'Configure the controller for SPI mode 0', fb: 'Correct. With CPHA = 0 the controller sets MOSI up half a clock before each rising edge and the sensor latches a stable bit. Always take the mode from the peripheral\'s timing diagram, not from an example for a different chip.' },
      { id: 'slow', text: 'Lower the clock frequency further', fb: 'You saw the same result at a tenth of the speed. The data changes on the wrong edge at any frequency.' },
      { id: 'pull', text: 'Add a pull-up resistor to MISO', fb: 'That would change the constant you read from 0x00 to 0xFF. The sensor still receives a command it does not recognise.' },
      { id: 'swap', text: 'Swap the MOSI and MISO wires', fb: 'They are wired correctly. Swapping them connects two outputs together and two inputs together.' },
    ],
  },
  'no-common-ground': {
    title: 'UART between two boards: erratic data',
    setup: 'Board A runs from a laptop USB port and sends "Hi" repeatedly at 115200 baud. Board B runs from a battery pack and should print what it receives. One jumper wire joins A\'s TX to B\'s RX.',
    symptom: { text: 'Board B prints a mix of correct and wrong characters. It changes when you touch either board or move the wire.', term: 'Hi▒iHiH▒▒Hi▒▒▒HiHi▒H▒i▒▒\n(different every time)' },
    checks: [
      { id: 'wires', label: 'List every connection between the two boards', short: 'the only wire between the boards is TX to RX', text: 'One wire: A TX → B RX. Nothing else joins the boards. They have separate power sources.' },
      { id: 'cont', label: 'Continuity from A\'s GND pin to B\'s GND pin', short: 'there is no continuity between the two grounds', meter: ['OL', 'continuity, GND(A) to GND(B): open'], text: 'No beep. The two grounds are not connected.' },
      { id: 'dcv', label: 'Multimeter DC volts from A\'s GND to B\'s GND', short: 'the voltage between the two grounds wanders', meter: ['0.4 … 1.9 V', 'DC, GND(A) to GND(B), unstable'], text: 'The reading never settles. With no connection between them the two grounds have no defined relationship; the meter is reading stray coupling.' },
      { id: 'cap-b', label: 'Analyser on B\'s RX, analyser ground clipped to board B', short: 'at board B the signal is full of spurious pulses', text: 'The frames are recognisable but there are narrow extra pulses all over them. Measured against B\'s ground, A\'s signal has no stable reference.',
        wave: W([{ name: 'B RX', edges: gndNoisy }], { t1: gndClean.duration, decode: { proto: 'uart', ch: 0, baud: 115200 }, caption: 'Synthetic illustration of a floating reference, not a physical noise model.' }) },
      { id: 'cap-a', label: 'Analyser on A\'s TX, analyser ground clipped to board A', short: 'at board A, against A\'s own ground, the signal is clean', text: 'Measured against its own ground, A\'s output is clean and decodes as "Hi".',
        wave: W([{ name: 'A TX', edges: gndClean.edges }], { t1: gndClean.duration, decode: { proto: 'uart', ch: 0, baud: 115200 }, caption: 'Decoded at 115200 8N1: "Hi".' }) },
      { id: 'baud', label: 'Compare the baud settings', short: 'both boards are set to 115200 8N1', text: 'Both boards: 115200 8N1.' },
    ],
    diagnoses: [
      { id: 'gnd', right: true, text: 'The two boards have no common ground', fb: 'Yes. A voltage is always measured between two points. Board A drives its TX pin relative to A\'s ground; board B compares its RX pin with B\'s ground. With no wire joining those grounds, "3.3 V" at A means nothing definite at B.' },
      { id: 'baud', text: 'The baud rates do not match', rule: 'baud', fb: 'A baud mismatch gives the same wrong characters every time. This changes when you touch the board.' },
      { id: 'swap', text: 'TX and RX are swapped', rule: 'wires', fb: 'Then B would receive nothing at all. Some characters do arrive correctly.' },
      { id: 'tx', text: 'Board A\'s transmitter is faulty', rule: 'cap-a', fb: 'A faulty driver is possible, so look at its output directly.' },
    ],
    fixes: [
      { id: 'gnd', right: true, text: 'Connect a ground pin on board A to a ground pin on board B', fb: 'Correct. Every signal needs a return path and a shared reference; "one wire" serial links are really two wires. The same rule applies to a logic analyser or oscilloscope: connect its ground first.' },
      { id: 'slow', text: 'Lower the baud rate', fb: 'Slower bits tolerate a little more noise, but the receiver still has no defined reference for the signal. It will stay erratic.' },
      { id: 'pull', text: 'Add a pull-up on B\'s RX to B\'s 3.3 V', fb: 'That ties the idle level to B\'s supply, but A still drives the line relative to a ground B does not share.' },
      { id: 'shield', text: 'Replace the jumper with a shielded cable', fb: 'A shield is only useful once it is connected to ground, and the grounds here are not connected to each other at all.' },
    ],
  },
  'level-mismatch': {
    title: 'UART to a 5 V module: commands ignored',
    setup: 'A 3.3 V microcontroller sends "AT" commands at 9600 baud to a (fictional) radio module powered from 5 V. TX and RX are crossed correctly and the grounds are joined.',
    symptom: { text: 'The module answers some commands and ignores most of them. Which ones get through seems random.', term: '> AT\n> AT\nOK\n> AT\n> AT\n> AT\nOK\n> AT\n(no reply to 5 of 7 commands)' },
    checks: [
      { id: 'mcu-high', label: 'Multimeter on the idle MCU TX line', short: 'the MCU drives its TX line high to only 3.28 V', meter: ['3.28 V', 'DC, MCU TX to GND, idle high'], text: 'The MCU drives a logic high of about 3.3 V, as a 3.3 V part must.' },
      { id: 'mod-sheet', label: 'Read the input levels in the module datasheet', short: 'the module needs at least 3.5 V to see a logic high', text: '"VDD = 5 V. Input high voltage, minimum: 0.7 × VDD." That is 3.5 V. A 3.3 V high is below the guaranteed threshold: the module may or may not see it as a 1.' },
      { id: 'mod-high', label: 'Multimeter on the idle module TX line (into the MCU RX pin)', short: 'the module drives 4.97 V into the MCU RX pin', meter: ['4.97 V', 'DC, module TX to GND, idle high'], text: 'The module drives its output to its own 5 V supply, straight into the MCU\'s RX pin.' },
      { id: 'mcu-sheet', label: 'Read the absolute maximum ratings of the MCU', short: 'the MCU pins are not 5 V tolerant', text: 'This MCU\'s pins are not 5 V tolerant: the maximum input voltage is only slightly above its 3.3 V supply (check the datasheet of your own part for the figure). 5 V on RX is outside the rating.' },
      { id: 'capture', label: 'Logic analyser on the MCU TX line', short: 'the analyser decodes the commands correctly', text: 'Every command decodes correctly. The analyser has its own input threshold, well below 3.3 V, so it sees clean data even where the module does not.',
        wave: W([{ name: 'MCU TX', edges: lvl.edges }], { t1: lvl.duration, decode: { proto: 'uart', ch: 0, baud: 9600 }, caption: 'Decoded at 9600 8N1: "AT". A logic analyser shows 0 and 1, not volts.' }) },
      { id: 'baud', label: 'Compare the baud settings', short: 'both sides are set to 9600 8N1', text: 'MCU: 9600 8N1. Module default: 9600 8N1.' },
      { id: 'gnd', label: 'Continuity between the two grounds', short: 'the grounds are connected', meter: ['0.2 Ω', 'continuity, GND to GND'], text: 'The grounds are joined.' },
    ],
    diagnoses: [
      { id: 'level', right: true, text: 'Logic levels do not match: 3.3 V is too low for the module\'s inputs, and its 5 V output is too high for the MCU', fb: 'Yes, and there are two separate problems. MCU to module is unreliable because 3.3 V sits below the 3.5 V the module is guaranteed to accept. Module to MCU "works" but overdrives a pin that is not 5 V tolerant, which can damage it over time.' },
      { id: 'baud', text: 'The baud rates do not match', rule: 'baud', fb: 'A mismatch would garble every command, and the analyser decode would not make sense at 9600.' },
      { id: 'gnd', text: 'There is no common ground', rule: 'gnd', fb: 'A missing ground does cause erratic behaviour, so it is right to check.' },
      { id: 'fw', text: 'The firmware sends malformed commands', rule: 'capture', fb: 'Then the same commands would fail every time, not at random.' },
    ],
    fixes: [
      { id: 'shift', right: true, text: 'Put a level shifter between the two (or a 5 V-input buffer one way and a resistor divider the other)', fb: 'Correct. Both directions need attention: raise the MCU\'s 3.3 V output to a proper 5 V high for the module, and bring the module\'s 5 V output down to 3.3 V for the MCU. Work out the divider with the voltage divider tool.' },
      { id: 'pull5', text: 'Add a pull-up from the MCU TX line to 5 V', fb: 'The MCU\'s output is push-pull: it actively drives 3.3 V and the resistor cannot lift it. The pull-up would instead push current into a pin that is not rated for 5 V.' },
      { id: 'vdd', text: 'Power the microcontroller from 5 V so the levels match', fb: 'A 3.3 V part run from 5 V is outside its supply rating. Expect it to fail, possibly permanently.' },
      { id: 'slow', text: 'Lower the baud rate to 1200', fb: 'The voltage of a logic high does not depend on how long the bit lasts. 3.3 V is below the module\'s threshold at any speed.' },
    ],
  },
};

/** Feedback for a diagnosis, tied to the evidence the learner has (or has not) gathered. `seen` is a Set of check ids. */
export function judgeDiagnosis(scenarioId, diagnosisId, seen) {
  const sc = SCENARIOS[scenarioId], d = sc.diagnoses.find((x) => x.id === diagnosisId);
  if (!d) return { ok: false, msg: 'Unknown diagnosis.' };
  if (d.right) {
    const support = sc.checks.filter((c) => seen.has(c.id)).map((c) => c.short);
    return { ok: true, msg: d.fb + (support.length ? ' Evidence you gathered: ' + support.join('; ') + '.' : '') };
  }
  const rule = sc.checks.find((c) => c.id === d.rule);
  if (rule && seen.has(rule.id)) return { ok: false, msg: `${d.fb} Your own evidence rules it out: ${rule.short}.` };
  if (rule) return { ok: false, msg: `${d.fb} You have not tested it yet: "${rule.label}" would confirm or exclude it.` };
  return { ok: false, msg: d.fb };
}

export default function mount(el, props = {}, ctx = {}) {
  const fixed = SCENARIOS[props.scenario] ? props.scenario : null;
  clear(el); el.classList.add('protocol-debug');
  const solved = {};
  const picker = h('div', { class: 'pd-pick' });
  const stage = h('div', {});
  append(el, [fixed ? null : picker, stage]);

  function drawPicker(current) {
    clear(picker);
    append(picker, [h('p', {}, current ? 'Scenario:' : 'Choose a broken link to diagnose. Each one starts with what you would actually see at the bench.'),
      h('div', { class: 'w-tabs' }, Object.entries(SCENARIOS).map(([k, sc]) => h('button', { type: 'button', class: 'w-tab' + (k === current ? ' on' : ''), 'aria-pressed': String(k === current), onclick: () => run(k) }, sc.title + (solved[k] ? ' ✓' : ''))))]);
  }

  function evidence(c) {
    const kids = [];
    if (c.meter) kids.push(h('div', { class: 'pd-meter', role: 'img', 'aria-label': `Multimeter reads ${c.meter[0]}. ${c.meter[1]}` }, h('span', { class: 'pd-mv' }, c.meter[0]), h('span', { class: 'pd-mk' }, c.meter[1])));
    if (c.term) kids.push(h('pre', { class: 'w-term pd-term' }, c.term));
    if (c.text) kids.push(h('p', {}, c.text));
    if (c.wave) {
      const w = c.wave, box = waveBox(0, c.label || 'Capture');
      const dec = w.decode ? runDecoder(w.channels, w.decode, 'hex') : null;
      let cursors = [];
      if (w.cursors === 'narrowest') {
        const e = w.channels[0].edges; let best = null;
        for (let i = 2; i < e.length; i++) if (!best || e[i].t - e[i - 1].t < best[1] - best[0] - 1e-12) best = [e[i - 1].t, e[i].t];
        if (best) cursors = [{ t: best[0], label: 'A' }, { t: best[1], label: 'B', color: 'var(--sig5)' }];
      }
      const colors = ['var(--sig1)', 'var(--sig3)', 'var(--sig4)', 'var(--sig6)'];
      const chans = w.channels.map((ch, i) => ({ color: colors[i % 4], ...ch }));
      const paint = () => drawWaves(box.svg, chans, { t0: 0, t1: w.t1, height: 26, cursors, annotations: dec ? dec.annotations : [], labelWidth: Math.max(58, 8 * Math.max(...chans.map((ch) => ch.name.length)) + 8) });
      kids.push(box.wrap);
      if (w.caption) kids.push(h('p', { class: 'w-note' }, w.caption));
      queueMicrotask(paint); onResize(box.wrap, paint);
    }
    return kids;
  }

  function run(id) {
    const sc = SCENARIOS[id];
    const seen = new Set();
    let steps = 0, diagnosed = false, done = false;
    if (!fixed) drawPicker(id);
    clear(stage);
    const stepsOut = h('span', { class: 'pd-steps', 'aria-live': 'polite' }, 'Steps used: 0');
    const log = h('div', { class: 'pd-log', 'aria-live': 'polite' });
    const checks = h('div', { class: 'pd-checks' });
    const diag = h('div', { class: 'pd-q' }), fix = h('div', { class: 'pd-q' });
    const bump = (n) => { steps += n; stepsOut.textContent = `Steps used: ${steps}`; };

    const drawChecks = () => {
      clear(checks);
      for (const c of sc.checks) checks.append(h('button', { type: 'button', class: 'btn small ghost', disabled: seen.has(c.id), onclick: () => {
        seen.add(c.id); bump(1);
        const entry = h('div', { class: 'pd-ev' }, h('div', { class: 'pd-evh' }, `Step ${steps}: ${c.label}`), evidence(c));
        log.append(entry); drawChecks(); drawDiag();
        entry.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
      } }, c.label + (seen.has(c.id) ? ' (done)' : '')));
    };
    const options = (box, list, onPick, state) => h('div', { class: 'opts' }, list.map((o) => h('button', { type: 'button', class: 'opt' + (state.tried.has(o.id) ? (o.right ? ' right' : ' wrong') : ''), disabled: state.locked || state.tried.has(o.id), onclick: () => onPick(o) }, o.text)));
    const dState = { tried: new Set(), locked: false, msg: null }, fState = { tried: new Set(), locked: false, msg: null };
    function drawDiag() {
      clear(diag);
      append(diag, [h('h4', {}, 'Diagnosis'),
        seen.size === 0 ? h('p', { class: 'muted' }, 'Gather at least one piece of evidence before you commit to a cause. A guess from the symptom alone is how the wrong part gets replaced.')
          : options(diag, sc.diagnoses, (o) => {
            const r = judgeDiagnosis(id, o.id, seen);
            dState.tried.add(o.id); dState.msg = r;
            if (r.ok) { dState.locked = true; diagnosed = true; drawFix(); } else bump(2);
            drawDiag();
          }, dState),
        dState.msg ? h('div', { class: 'w-msg ' + (dState.msg.ok ? 'ok' : 'bad'), role: 'status' }, dState.msg.msg + (dState.msg.ok ? '' : ' (A wrong diagnosis costs two steps.)')) : null]);
    }
    function drawFix() {
      clear(fix);
      if (!diagnosed) return;
      append(fix, [h('h4', {}, 'Fix'), options(fix, sc.fixes, (o) => {
        fState.tried.add(o.id); fState.msg = o;
        if (o.right) { fState.locked = true; done = true; if (!solved[id]) { solved[id] = true; ctx.complete?.(); } if (!fixed) drawPicker(id); } else bump(2);
        drawFix();
      }, fState),
      fState.msg ? h('div', { class: 'w-msg ' + (fState.msg.right ? 'ok' : 'bad'), role: 'status' }, fState.msg.fb) : null,
      done ? h('p', {}, `Solved in ${steps} steps, using ${seen.size} of ${sc.checks.length} available checks. `, steps <= 4 ? 'That is an efficient diagnosis.' : 'Try again and see whether fewer, better-chosen checks get you there: the first check should be the one that splits the possible causes most evenly.') : null]);
    }

    append(stage, [
      h('div', { class: 'w-task' }, h('p', {}, h('strong', {}, sc.title + '. '), sc.setup), h('p', {}, 'Find the cause, then choose the fix. Each check costs one step and each wrong answer two.')),
      h('div', { class: 'pd-ev pd-symptom' }, h('div', { class: 'pd-evh' }, 'Symptom'), evidence(sc.symptom)),
      h('div', { class: 'row pd-bar' }, h('strong', {}, 'Checks you can make'), stepsOut),
      checks, log, diag, fix,
      h('p', { class: 'w-note' }, 'Model: scripted scenarios. Waveforms and garbled text are produced by the same signal simulator as the other protocol tools; meter readings are illustrative values, not measurements. Parts described as fictional have no real datasheet.')]);
    drawChecks(); drawDiag();
  }

  if (fixed) run(fixed); else { drawPicker(null); }
}
