// Microcontroller architecture, part B: GPIO, clocks, interrupts, timers and watchdogs.
const R = String.raw;

export default [
  // ───────────────────────────────────────────────────────────────── 5
  {
    id: 'mcu-gpio-arch',
    title: 'GPIO architecture',
    minutes: 40,
    summary: 'What sits between a register bit and a package pin: direction, output latch, input synchroniser, the pin multiplexer, pulls and drive strength.',
    skills: ['mcu-sk-gpio', 'mcu-sk-bitops'],
    blocks: [
      `## The problem

Main code toggles a status LED on pin 3 with ¬GPIO_OUT ^= (1u << 3);¬. A timer interrupt drives a stepper-motor
step pulse on pin 7 of the same port with ¬GPIO_OUT |= (1u << 7);¬. Once every few hours the motor misses a step.
Both statements are correct C. Each works alone. What goes wrong when they share a port?`,

      `## Theory: the pin's signal chain

The electronics section covered the pin's output transistors and input thresholds. Here is the digital logic behind them.`,

      { t: 'figure', caption: 'One GPIO pin, simplified. Real chips add analogue switches, wake-up logic and interrupt edge detectors.',
        svg: `<svg viewBox="0 0 640 300" xmlns="http://www.w3.org/2000/svg" font-family="monospace" font-size="12" fill="currentColor" stroke="currentColor">
  <g fill="none" stroke-width="1.5">
    <rect x="20" y="30" width="110" height="34" rx="4"/><rect x="20" y="84" width="110" height="34" rx="4"/>
    <rect x="20" y="138" width="110" height="34" rx="4"/><rect x="20" y="230" width="110" height="34" rx="4"/>
    <path d="M230 40 L290 60 L290 110 L230 130 Z"/>
    <path d="M360 62 L420 85 L360 108 Z" stroke="var(--sig1)"/>
    <rect x="530" y="70" width="34" height="34" rx="3"/>
    <path d="M430 220 L370 247 L430 274 Z" stroke="var(--sig2)"/>
    <rect x="250" y="230" width="80" height="34" rx="4"/>
    <path d="M130 47 H230 M130 101 H180 V70 H230 M290 85 H360 M420 85 H530"/>
    <path d="M130 155 H390 V97" stroke-dasharray="4 3"/>
    <path d="M480 85 V247 H430 M370 247 H330 M250 247 H130"/>
    <path d="M480 85 V30 M470 30 h20 M480 30 v-0" stroke="var(--sig3)"/>
    <path d="M472 34 l8 6 l8 -6 l-8 6 l-8 6 l8 6" stroke="var(--sig3)" transform="translate(0,-18) scale(1,0.7)"/>
  </g>
  <g stroke="none">
    <text x="30" y="52">peripheral out</text><text x="30" y="106">OUT latch bit</text>
    <text x="30" y="160">DIR / OE bit</text><text x="30" y="252">IN register bit</text>
    <text x="238" y="90">MUX</text><text x="222" y="150">(function select)</text>
    <text x="352" y="52" fill="var(--sig1)">output driver</text>
    <text x="536" y="92">pin</text><text x="496" y="24" fill="var(--sig3)">pull-up (pull-down similar)</text>
    <text x="366" y="210" fill="var(--sig2)">Schmitt input</text><text x="258" y="252">2-FF sync</text>
    <text x="150" y="282">input path also feeds peripherals and the interrupt edge detector</text>
  </g>
</svg>` },

      `**Registers you will find on every MCU, under different names:**

| Role | Bench-MCU | ESP32 | MSPM0 | MAX78000 (MSDK) |
|---|---|---|---|---|
| Direction / output enable | ¬GPIO_DIR¬ | ¬GPIO_ENABLE_REG¬ | ¬DOE31_0¬ | ¬outen¬ |
| Output latch | ¬GPIO_OUT¬ | ¬GPIO_OUT_REG¬ | ¬DOUT31_0¬ | ¬out¬ |
| Pin level | ¬GPIO_IN¬ | ¬GPIO_IN_REG¬ | ¬DIN31_0¬ | ¬in¬ |
| Atomic set / clear / toggle | ¬GPIO_SET/CLR/TOGGLE¬ | ¬…_W1TS¬ / ¬…_W1TC¬ | ¬DOUTSET/CLR/TGL31_0¬ | ¬out_set¬ / ¬out_clr¬ |
| Function select | — | IO MUX and GPIO matrix | ¬IOMUX PINCM¬ registers | ¬en0/en1/en2¬ alternate-function bits |

Register names for the real chips are as they appear in the vendor headers; open the header or reference manual for
offsets and bit positions.

### Output latch and input register are different things

Writing the **output** register sets a flip-flop. Reading the **input** register samples the actual voltage on the
pin through a Schmitt-trigger buffer and a two-flip-flop synchroniser. They can disagree: the pin may be configured
as an input, overloaded, shorted, or simply not yet settled (a few nanoseconds). To know what you *commanded*,
read the output latch. To know what the *world* is doing, read the input register.

The **Schmitt trigger** has hysteresis: the rising threshold is higher than the falling one, so a slow or noisy edge
produces one clean transition instead of a burst. The **synchroniser** aligns an asynchronous external edge to the
system clock, at the cost of two or so clock cycles of delay.

### Why set and clear registers exist

¬GPIO_OUT |= mask¬ is load, OR, store. If an interrupt changes another bit of the same register between the load
and the store, the store writes back a stale copy and the interrupt's change is erased. That is the missed step
pulse from the opening problem: the main loop loaded ¬GPIO_OUT¬, the timer interrupt set pin 7, and the main loop
stored its old copy with pin 7 low.

A **set register** removes the read. Writing ¬1u << 7¬ to ¬GPIO_SET¬ is a single store; the hardware ORs it
into the latch. Bits written as 0 are untouched. There is no window, so no lock is needed. Use set/clear/toggle
registers for every output change in code that shares a port with an interrupt or another task.

### Pin multiplexing

A package has fewer pins than the chip has signals. Each pin has a **multiplexer** choosing which internal signal
drives it and which peripherals listen to it: plain GPIO, UART TX, a timer output, an analogue input. Until you select
the function, the peripheral is running but connected to nothing.

- **Fixed alternate functions** (MAX78000, MSPM0, most Cortex-M parts): each pin offers a short list, such as
  "GPIO, UART0 TX, timer capture". The table is in the datasheet's pin description.
- **Routing matrix** (ESP32): most digital peripheral signals can be routed to almost any pin through the GPIO
  matrix, at the cost of extra delay; a few high-speed functions use fixed IO MUX pins. Some pins have restrictions
  that no routing can fix: on the original ESP32, GPIO34–39 are input-only with no pulls, and GPIO6–11 are normally
  taken by the module flash.

### Pulls and drive strength

- **Internal pull-up / pull-down**: a weak resistor, typically tens of kilohms, switchable per pin. Enough to define
  the level of an unconnected input or a push-button. Too weak for I2C at speed. The exact value is a wide range in the
  datasheet's electrical table.
- **Drive strength**: many chips let you choose how hard the output transistors drive (in mA). Higher strength gives
  faster edges and more current, but more ringing, EMI and supply noise. Use the lowest setting that meets your timing.
- **Open-drain mode**: only the low-side transistor is used. Required for shared lines such as I2C.`,

      { t: 'predict',
        q: 'Pin 4 is configured as an output and firmware writes 1 to its output latch. The pin is accidentally shorted to ground on the PCB. What do the output register and the input register read?',
        choices: [
          { t: 'Both read 1', why: 'One of these registers is a flip-flop your code wrote; the other reports a voltage. Which voltage is on the pin?' },
          { t: 'Output register 1, input register 0', ok: true, why: 'The latch still holds what was written; the input path samples the real pin, which the short holds low.' },
          { t: 'Both read 0, because the short forces the latch low', why: 'A pin cannot write back into the output flip-flop; there is no path from pad to latch.' },
        ],
        reveal: 'This difference is a free diagnostic. After driving a pin, read it back through the input register: a mismatch means a short, contention with another driver, or a pin that is not muxed to GPIO at all. Also note the output transistor is now sourcing its short-circuit current; that is how pins get damaged.' },

      { t: 'callout', kind: 'mistake', title: 'Configuring the peripheral but not the pin',
        md: 'The UART is enabled, the baud rate is right, the transmit register accepts bytes, and the scope shows a flat line. The peripheral is working; its TX signal was never routed to the pin. On every chip, "bring up a peripheral" has three separate steps: enable its clock (and power, on MSPM0), select the pin function, then configure the peripheral.' },

      { t: 'callout', kind: 'decision', title: 'Internal pull-up or external resistor?',
        md: 'Use the internal pull for buttons and for defining unused inputs: it costs nothing. Use an external resistor when the value matters (I2C rise time, a defined level *before* firmware runs, for example on a MOSFET gate or a strapping pin) because internal pulls are off at reset on most chips and their value is loosely specified.' },

      { t: 'widget', name: 'c-lab', title: 'C lab: change outputs with no read-modify-write',
        props: {
          title: 'Atomic set, clear and toggle',
          prompt: `Bench-MCU has write-only ¬GPIO_SET¬ (offset ¬0x0C¬), ¬GPIO_CLR¬ (¬0x10¬) and ¬GPIO_TOGGLE¬ (¬0x14¬) registers. The predefined header already declares them.

¬board_init()¬ sets up six outputs with a starting pattern. Complete ¬update_outputs()¬ so that pin 5 is set, pin 0 is cleared and pin 9 is toggled, **without ever reading ¬GPIO_OUT¬** and with exactly three stores. Other pins must not change.`,
          starter: R`#include <stdint.h>
#include <stdio.h>

static void board_init(void)
{
    GPIO_DIR = 0x0333u;    /* pins 0,1,4,5,8,9 are outputs */
    GPIO_OUT = 0x0113u;    /* pins 0,1,4,8 start high      */
}

static void update_outputs(void)
{
    /* TODO: set pin 5, clear pin 0, toggle pin 9.
       Use GPIO_SET, GPIO_CLR and GPIO_TOGGLE only. */
}

int main(void)
{
    board_init();
    update_outputs();
    printf("OUT=%x\n", GPIO_OUT);
    return 0;
}
`,
          solution: R`#include <stdint.h>
#include <stdio.h>

static void board_init(void)
{
    GPIO_DIR = 0x0333u;
    GPIO_OUT = 0x0113u;
}

static void update_outputs(void)
{
    GPIO_SET = (1u << 5);
    GPIO_CLR = (1u << 0);
    GPIO_TOGGLE = (1u << 9);
}

int main(void)
{
    board_init();
    update_outputs();
    printf("OUT=%x\n", GPIO_OUT);
    return 0;
}
`,
          tests: [
            { name: 'pin 5 set, pin 0 cleared, pin 9 toggled, others unchanged', regs: { GPIO_OUT: 0x0332, GPIO_DIR: 0x0333 }, stdoutIncludes: 'OUT=332' },
          ],
          hints: [
            'Each of the three registers takes a mask: a 1 means "act on this pin", a 0 means "leave it".',
            'These registers are write-only. Use ¬=¬, never ¬|=¬: an OR would first read a register that has no meaningful read value.',
            'Work out the expected result by hand first: start ¬0x0113¬, set bit 5, clear bit 0, toggle bit 9.',
          ],
          explain: 'Each statement compiles to a single store. An interrupt can arrive between any two of them, change other pins of the port, and nothing is lost, because no statement carries a stale copy of the latch.',
        } },

      { t: 'exercise',
        prompt: `Main code runs ¬GPIO_OUT ^= 0x08;¬ (toggle pin 3). ¬GPIO_OUT¬ is ¬0x00¬ beforehand. An interrupt handler that executes ¬GPIO_OUT |= 0x80;¬ (set pin 7) runs after main's load and before main's store. What is ¬GPIO_OUT¬ after both have finished? Answer in hex.`,
        hints: [
          'Main loaded 0x00 into a register before the interrupt.',
          'The handler makes the latch 0x80. Then main computes 0x00 ^ 0x08 from its stale copy and stores it.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?0?8h?\\s*$'], nudge: 'Which copy of the register does main store back?' },
        solution: `Main loads ¬0x00¬. The handler sets the latch to ¬0x80¬. Main stores ¬0x00 ^ 0x08 = 0x08¬. Final value **0x08**: pin 7 is low again and the step pulse lasted only as long as the gap between handler exit and main's store, perhaps a hundred nanoseconds. With ¬GPIO_TOGGLE = 0x08¬ and ¬GPIO_SET = 0x80¬ the result would be ¬0x88¬.` },

      `## Harder application

A board uses an ESP32 pin as a strapping pin (it is sampled at reset to choose the boot mode) and, after boot, as a
chip-select output for an SPI device whose select line has an external pull-up. List what the pin's state is at each
of these moments, and whether anything conflicts: (a) during reset, (b) in the ROM before your code runs,
(c) after your GPIO setup. Then check your reasoning against the strapping-pin table in the ESP32 datasheet. The
general lesson: a pin has a life before ¬main()¬, and external parts see all of it.`,
    ],
    quiz: [
      { q: 'Why does writing a mask to a "set" register avoid the race that `OUT |= mask` has?', kind: 'arch', choices: [
        { t: 'It is one store with no preceding load, so there is no stale copy to write back', ok: true, why: 'The hardware performs the OR inside the peripheral in the same clock cycle as the write.' },
        { t: 'The set register disables interrupts while it is written', why: 'No masking takes place; the benefit comes from removing the software read step.' },
        { t: 'The compiler generates an atomic instruction for it', why: 'The compiler emits an ordinary store. Atomicity comes from how the register is implemented in hardware.' },
      ] },
      { q: 'A pin is an input with no pull and nothing connected. Reading it returns:', kind: 'circuit', choices: [
        { t: 'An unpredictable level that may change with nearby signals or a finger', ok: true, why: 'A floating CMOS input has no defined voltage; it follows leakage and coupled noise.' },
        { t: '0, because nothing is driving it', why: '"Not driven" is not the same as "driven low"; no current path defines the voltage.' },
        { t: '1, because inputs default high', why: 'A default high level requires a pull-up, which is not enabled here.' },
      ] },
      { q: 'A UART transmits correctly according to its status flags, but the TX pin never moves. What is the first thing to check?', kind: 'arch', choices: [
        { t: 'Whether the pin\'s function select routes the UART TX signal to it', ok: true, why: 'Without the mux setting the pin remains a GPIO or high-impedance, whatever the UART does.' },
        { t: 'Whether the baud rate divisor is correct', why: 'A wrong divisor still produces edges on the pin, only at the wrong rate.' },
        { t: 'Whether the receive FIFO is full', why: 'Receive state does not gate the transmitter\'s pin.' },
      ] },
      { q: 'What does the Schmitt trigger on a digital input provide?', kind: 'circuit', choices: [
        { t: 'Different rising and falling thresholds, so slow or noisy edges give one clean transition', ok: true, why: 'Hysteresis stops the input from chattering while the voltage passes through the threshold region.' },
        { t: 'Protection against voltages above the supply', why: 'Over-voltage is handled (to a limited extent) by clamp structures, not by the input buffer\'s thresholds.' },
        { t: 'Removal of mechanical switch bounce', why: 'Bounce is a real, full-swing series of edges lasting milliseconds; hysteresis of a few hundred millivolts does not hide it.' },
      ] },
      { q: 'On the original ESP32, a design needs an output with an internal pull-up on GPIO35. What is the problem?', kind: 'circuit', choices: [
        { t: 'GPIO34–39 are input-only and have no internal pulls', ok: true, why: 'These pads lack output drivers and pull resistors; no register setting changes that.' },
        { t: 'GPIO35 is connected to the module flash', why: 'The flash pins on the module are a different group of pins.' },
        { t: 'GPIO35 is a strapping pin', why: 'The strapping pins on this chip are a different set; check the list in the pin documentation.' },
      ] },
      { q: 'Why choose a lower drive-strength setting when the timing budget allows it?', kind: 'circuit', choices: [
        { t: 'Slower edges reduce ringing, radiated noise and supply bounce', ok: true, why: 'Edge rate, not frequency, determines the high-frequency content of a signal.' },
        { t: 'It lowers the output voltage to protect the load', why: 'Drive strength changes available current and edge speed, not the logic-high voltage into a light load.' },
        { t: 'It makes the pin 5 V tolerant', why: 'Voltage tolerance is a property of the pad structure and is not changed by drive settings.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 6
  {
    id: 'mcu-clocks',
    title: 'Clock systems and oscillators',
    minutes: 40,
    summary: 'Every flip-flop in the chip waits for a clock edge. Where those edges come from, how accurate they are, and what happens to a peripheral whose clock is off.',
    skills: ['mcu-sk-clock'],
    blocks: [
      `## The problem

Two symptoms from two boards on the same day:

1. A UART link works at room temperature and prints garbage when the enclosure sits in the sun.
2. A new driver writes a configuration value to a timer register, reads it back, and gets zero. Every time.

Neither is a wiring fault. Both are clock faults.`,

      `## Theory

### Sources

| Source | Typical accuracy | Start-up | Cost | Use |
|---|---|---|---|---|
| Internal **RC oscillator** | around ±1 % after factory trim; worse over temperature and voltage (datasheet) | Microseconds | Free | Default system clock, fast wake-up |
| **Crystal** oscillator | tens of parts per million (0.001–0.005 %) | Milliseconds | Crystal, two capacitors, two pins | Radio, USB, CAN, accurate baud rates, timekeeping |
| Low-frequency **32.768 kHz crystal** | tens of ppm | Hundreds of ms | Small crystal | Real-time clock: 32768 = 2¹⁵ divides to exactly 1 Hz |
| Internal low-power RC (tens of kHz) | several percent | Fast | Free | Watchdog, wake-up timer in deep sleep |

### PLL

A **phase-locked loop** multiplies a reference frequency. It compares the divided-down output of a
voltage-controlled oscillator with the reference and steers the oscillator until they match, so
f_out = f_ref × N / M. It inherits the accuracy of the reference, takes time to lock, and draws current. It is how a
40 MHz crystal becomes a 240 MHz CPU clock on an ESP32.

### Clock tree

Sources feed a multiplexer that selects the **system clock**; dividers derive the CPU clock and one or more
peripheral bus clocks; each peripheral then has a **clock gate**, an enable bit that passes or blocks the clock to
that peripheral's flip-flops.`,

      { t: 'ascii', caption: 'A generic clock tree. Draw this for any new chip before writing a driver.',
        text: R`  internal RC ──┐
  crystal ──────┼─► [ MUX ] ─► SYSCLK ─► [ /div ] ─► CPU clock
  crystal ─► PLL┘                 │
                                  ├─► [ /div ] ─► peripheral bus clock ─┬─[gate]─► UART0
                                  │                                     ├─[gate]─► TIMER0
                                  │                                     └─[gate]─► ADC
  32.768 kHz crystal ─────────────┴─► RTC, low-power timers
  low-power RC ─────────────────────► watchdog, wake-up timer` },

      `### A peripheral with its clock off ignores you

Registers are flip-flops; a flip-flop only changes on a clock edge. With the gate closed, writes to the peripheral's
registers are lost, reads return zero or stale values, and on some chips the access faults. That is symptom 2. The fix
is one bit in a clock-control register, set **before** any other access.

Gating exists to save power: dynamic power is proportional to switched capacitance × V² × frequency, and a
gated peripheral switches nothing. Chips reset with most gates closed for that reason.

### Why baud rates depend on clock accuracy

A UART has no clock wire. Each side counts its own clock to decide where the bits are: the baud rate is
f_clk divided by an integer (or fractional) divisor. The receiver resynchronises on the start bit, then samples the
middle of each of the following bits. Over a 10-bit frame the timing error accumulates; if it reaches about half a
bit by the last sample, the stop bit is read wrongly. Half a bit over roughly 9.5 bit-times is about 5 % *total*
mismatch between the two ends. Allowing margin for edge distortion and sampling granularity, the usual budget is
**about ±2 % per side**.

So there are two error sources to add:

- **Divisor rounding**: 16 MHz / 115200 = 138.89; an integer divisor of 139 gives 115,108 baud, −0.08 %. Negligible.
  With coarser dividers (an oversampling-by-16 UART needs 16 MHz / (16 × 115200) = 8.68, which rounds to 9: −3.5 %) it
  can use the whole budget by itself.
- **Oscillator tolerance**: an RC oscillator at ±1 % at room temperature that drifts a further percent or two when
  hot. That is symptom 1.

This is why odd frequencies such as 7.3728 MHz exist: 7,372,800 / 115,200 = 64 exactly.`,

      `## On real hardware

**MAX78000.** The device header lists five oscillators (nominal): IPO 100 MHz and ISO 60 MHz internal oscillators,
IBRO 7.3728 MHz (the baud-rate-friendly one), ERTCO 32.768 kHz crystal for the RTC, and INRO around 30 kHz for
low-power timing. Peripheral clocks are gated through the global control block's peripheral clock-disable
registers; MSDK drivers open the gate in their ¬_Init¬ functions.

**MSPM0L2228.** The 2026 eCTF reference design runs the CPU at 32 MHz from the internal oscillator. MSPM0
peripherals go a step further than a clock gate: each has its own power-enable register, and reads or writes before
power is enabled do not take effect. TI's driver library calls this ¬DL_<peripheral>_enablePower()¬, and generated
code calls it first.

**ESP32.** A 40 MHz crystal on the module feeds a PLL; the CPU clock is selectable up to 240 MHz, and most peripherals run from an
80 MHz bus clock (APB). Peripheral clocks are enabled and held in reset through system-level registers; ESP-IDF
drivers do it for you. Changing the CPU frequency for power saving can change the APB clock, and with it every
baud rate and timer period derived from it: the driver must be told.`,

      { t: 'predict',
        q: 'A driver for TIMER0 writes its reload register, then enables the timer clock gate, then starts the timer. The reload value was 1000. What period does the timer run with?',
        choices: [
          { t: '1000 counts: the write was stored and took effect once the clock arrived', why: 'Storing a value needs a clock edge at the register. Was there one at the time of the write?' },
          { t: 'Whatever the reload register\'s reset value gives, because the first write was lost', ok: true, why: 'With the gate closed the register never clocked the data in. Only accesses after the gate opens count.' },
          { t: 'The timer does not run at all', why: 'The start command came after the gate was opened, so it does take effect; it is the earlier write that vanished.' },
        ],
        reveal: 'Order matters: clock (and power), then reset release if the chip has one, then configuration, then enable. A driver that "sometimes works" depending on what ran before it usually has this ordering wrong and is being rescued by another driver that shares the same gate.' },

      `## Worked example: is the internal oscillator good enough?

Link: 115,200 baud between an MCU on its internal RC oscillator and a PC adapter with a crystal.

- PC side: crystal, about ±0.01 %. Ignore.
- MCU divisor error: 32 MHz / 115200 = 277.78; with a fractional divider this can be made well under 0.1 %.
- MCU oscillator: suppose the datasheet gives ±1.2 % over the full temperature and voltage range (an assumed figure;
  use yours).
- Total ≈ 1.3 %. Under the ±2 % budget on this side, with the far side contributing nearly nothing: acceptable.

Now connect two such MCUs to each other: worst case one is +1.3 %, the other −1.3 %, total 2.6 % of a roughly 5 %
ceiling, before any cable effects. Marginal, and it will fail first when the two boards are at different
temperatures. Fit a crystal, lower the baud rate tolerance requirement with a protocol that resynchronises more
often, or calibrate the RC oscillator against a known reference.`,

      { t: 'callout', kind: 'mistake', title: 'Changing the system clock and forgetting everything derived from it',
        md: 'Baud divisors, timer prescalers, ADC sample times, flash wait states and the SysTick reload were all computed for the old frequency. Switching the clock source without recomputing them breaks every one at once. Keep one function that owns the clock configuration, and derive the rest from a single ¬system_clock_hz¬ value.' },

      { t: 'callout', kind: 'decision', title: 'RC or crystal?',
        md: `Choose the internal RC when cost, board area, start-up time and sleep current dominate and the only timing-sensitive interface is a UART to a crystal-clocked partner. Choose a crystal when the chip has a radio, USB or CAN, when two RC-clocked devices must talk at high baud rates, or when you keep wall-clock time. Many designs use both: RC for a fast wake, crystal once it has stabilised.` },

      { t: 'callout', kind: 'security', title: 'The clock is an attack surface',
        md: 'An attacker who controls an external clock input can insert one short cycle (a clock glitch) so that an instruction is fetched or executed incorrectly, for instance skipping the branch after a signature check. Internal oscillators are harder to glitch than an external clock pin. The fault-injection material in the security section builds on this lesson\'s clock tree.' },

      { t: 'exercise',
        prompt: `A UART divides its clock by an integer divisor: baud = f_clk / divisor. With f_clk = 8,000,000 Hz and a target of 115,200 baud, choose the nearest integer divisor and give the resulting baud-rate error in percent (sign not required, one decimal place).`,
        hints: [
          '8,000,000 / 115,200 = 69.44. Nearest integer is 69.',
          'Actual baud = 8,000,000 / 69. Error = (actual − target) / target.',
        ],
        answer: { type: 'number', value: 0.6, tol: 0.1, unit: '%' },
        solution: `Divisor 69 → 8,000,000 / 69 = 115,942 baud. Error = (115,942 − 115,200) / 115,200 = **+0.64 %**. That leaves about 1.3 % of the ±2 % budget for the oscillator itself.` },

      `## Harder application

A sensor node sleeps with only a 32.768 kHz crystal running and wakes once an hour to transmit. Its crystal is
specified at ±20 ppm. A receiver opens a listening window around the expected time. After 24 hours without
resynchronising, how wide must the window be to guarantee it catches the transmission, if the receiver's clock is
equally inaccurate? (Each clock can drift 20 ppm × 86,400 s ≈ 1.7 s; the two may drift in opposite directions, so
the window must cover about ±3.5 s. Radio protocols resynchronise on every exchange precisely to keep this window,
and the energy spent listening, small.)`,
    ],
    quiz: [
      { q: 'A register write to a peripheral has no effect and reads back zero. The address is correct. What is the most likely cause?', kind: 'arch', choices: [
        { t: 'The peripheral\'s clock gate (or power enable) has not been turned on', ok: true, why: 'Without a clock the register flip-flops cannot capture the written value.' },
        { t: 'The register is volatile', why: 'That is a C type qualifier affecting the compiler, not a hardware property that discards writes.' },
        { t: 'The CPU is running too fast for the peripheral', why: 'The bus protocol handles speed differences with wait states; writes are not silently dropped for being fast.' },
      ] },
      { q: 'Why can a UART link fail when one end heats up, although both ends are set to the same baud rate?', kind: 'circuit', choices: [
        { t: 'An RC oscillator\'s frequency drifts with temperature, so the actual bit times no longer match', ok: true, why: 'The configured divisor is the same, but the clock it divides has changed.' },
        { t: 'Heat increases the resistance of the wire enough to attenuate the signal', why: 'Copper resistance changes by a fraction of an ohm over this range, far too little to affect logic levels.' },
        { t: 'The divisor register loses its value at high temperature', why: 'Registers hold their contents across the whole operating range; it is the analogue oscillator that moves.' },
      ] },
      { q: 'What does a PLL do to the accuracy of its reference?', kind: 'concept', choices: [
        { t: 'It preserves it: the output has the same fractional error as the reference', ok: true, why: 'The loop locks output to a ratio of the reference, so ppm error carries through unchanged.' },
        { t: 'It improves it, because the loop filters out error', why: 'The loop filters short-term jitter, but a reference that is 1 % fast produces an output that is 1 % fast.' },
        { t: 'It multiplies the error by the multiplication factor', why: 'The absolute error in hertz scales, but the fractional error, which is what baud rates care about, does not.' },
      ] },
      { q: 'Why is 32.768 kHz used for real-time clock crystals?', kind: 'concept', choices: [
        { t: 'It is 2^15 Hz, so a 15-stage binary divider yields exactly 1 Hz', ok: true, why: 'A power-of-two frequency needs only a ripple counter to produce seconds.' },
        { t: 'It is the lowest frequency a crystal can oscillate at', why: 'Lower-frequency resonators exist; this value was chosen for the divider arithmetic and low power.' },
        { t: 'It matches common UART baud rates', why: 'Standard baud rates are multiples of 300, which do not divide evenly from this frequency.' },
      ] },
      { q: 'Firmware lowers the CPU clock from 80 MHz to 20 MHz to save power, and the UART output becomes garbage. Why?', kind: 'code', choices: [
        { t: 'The baud divisor was computed for the old peripheral clock and was not recalculated', ok: true, why: 'Baud rate is clock divided by divisor; a quarter of the clock with the same divisor gives a quarter of the baud rate.' },
        { t: 'UARTs cannot run below 80 MHz', why: 'A UART needs only a clock comfortably above the baud rate; 20 MHz is ample for 115,200.' },
        { t: 'The transmit pin loses its function select when the clock changes', why: 'Pin multiplexing is independent of clock frequency.' },
      ] },
      { q: 'Which peripheral is most reasonably clocked from a separate low-power RC oscillator rather than the main system clock?', kind: 'arch', choices: [
        { t: 'The watchdog timer', ok: true, why: 'It must keep running if the main clock fails or the system clock is misconfigured, and in sleep modes.' },
        { t: 'The USB interface', why: 'USB requires timing accuracy of a small fraction of a percent, far beyond a low-power RC.' },
        { t: 'The CPU core', why: 'Running the CPU at tens of kilohertz is possible but is a deliberate low-power mode, not the normal arrangement.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 7
  {
    id: 'mcu-interrupts',
    title: 'Interrupts and interrupt service routines',
    minutes: 50,
    summary: 'How hardware forces the CPU to stop what it is doing, what it saves for you, what it does not, and the rules that keep handlers from breaking the rest of the program.',
    skills: ['mcu-sk-irq'],
    blocks: [
      `## The problem

A UART delivers a byte every 87 µs at 115,200 baud. The main loop takes 4 ms per pass because it updates a display.
If the loop is the only thing that reads the UART, 45 bytes arrive per pass and the receive register holds one.
Polling faster is not an option. The hardware needs a way to say "now", and the CPU needs a way to obey without the
main loop knowing.`,

      `## Theory

An **interrupt** is a hardware-initiated function call. A peripheral raises a request line; if the request is
enabled and has sufficient priority, the CPU finishes the current instruction, saves enough state to resume later,
and jumps to a handler whose address it looks up in a table. When the handler returns, the saved state is restored
and the interrupted code continues, unaware.

### Three bits per source, in three places

| State | Where it lives | Meaning |
|---|---|---|
| **Flag** (event) | Peripheral status register | The event happened. Usually W1C or cleared by reading data |
| **Enable** (local) | Peripheral interrupt-enable register | Let this flag raise the peripheral's request line |
| **Enable** (controller) and **priority** | Interrupt controller (NVIC on Cortex-M) | Let this request line reach the CPU, and at what urgency |
| **Pending** | Interrupt controller | A request has arrived and is waiting for its turn |
| **Global mask** | CPU (PRIMASK on Cortex-M, ¬mstatus.MIE¬ on RISC-V) | All maskable interrupts held off |

An interrupt fires only when the whole chain is open. When a handler "never runs", walk the chain with a debugger:
is the flag set, is the local enable set, is it pending in the controller, is it enabled there, is the global mask
clear, is something of equal or higher priority already running?

### The vector table

The **vector table** is an array of handler addresses at a known location. Entry *n* belongs to exception *n*. The
CPU does not search or call a dispatcher: on Cortex-M it reads the entry and loads it into PC. On Cortex-M the table
also holds the initial stack pointer and the reset handler, so it doubles as the boot record (see the boot lesson).

### What the hardware saves

The interrupted code has live values in registers. Something must preserve them.

- **Arm Cortex-M**: the hardware pushes eight words onto the current stack (r0–r3, r12, LR, PC and the status
  register) and loads LR with a special marker value. Those are exactly the registers the C calling convention lets
  a function overwrite, so **a handler is an ordinary C function**. Returning to the marker value triggers the
  unstacking.
- **RISC-V**: the hardware saves almost nothing on the stack. It copies PC to the ¬mepc¬ register, records the
  cause in ¬mcause¬, disables interrupts, and jumps to the address in ¬mtvec¬. **Software** must save and restore
  every register it uses; the compiler does it for functions marked ¬__attribute__((interrupt))¬, or an assembly
  stub does it.`,

      { t: 'widget', name: 'interrupt-flow', props: { arch: 'cortex-m' }, title: 'Interrupt on a Cortex-M',
        caption: 'Step from the pending request to the first handler instruction. Count the memory writes that happen before any of your code runs.' },
      { t: 'widget', name: 'interrupt-flow', props: { arch: 'riscv' }, title: 'The same event on RISC-V',
        caption: 'Compare: which registers did hardware save this time, and where?' },

      `### Latency

**Interrupt latency** is the time from the request to the first instruction of the handler. Its parts:

1. Finishing or abandoning the current instruction.
2. Hardware entry (stacking and vector fetch): of the order of a dozen or so clock cycles on Cortex-M parts; the
   exact figure is in the core's documentation and assumes zero-wait-state memory.
3. Any time interrupts are **masked** by software. This is usually the largest term and it is entirely under your
   control: the longest critical section in the whole program is your worst-case latency.
4. Any higher- or equal-priority handler already running.

### Priority and nesting

Each interrupt has a priority. A request of **higher** priority than the running handler preempts it (nesting); one
of equal or lower priority waits, pending. On Cortex-M a *lower number* is a *higher* priority. Cortex-M0+ parts
such as the MSPM0L2228 have 2 priority bits (4 levels); Cortex-M4 parts have between 3 and 8 bits, chosen by the
chip maker.

### Rules for handlers

1. **Clear the cause.** If the flag that requested the interrupt is still set on return, the handler is entered
   again immediately, forever. Main code never runs.
2. **Be short.** While a handler runs, everything of equal or lower priority waits. Copy the data, set a flag or
   push to a queue, and leave. Parsing, printing, and anything with a loop of unknown length belong in main code or a task.
3. **Never block.** No delays, no waiting for another interrupt, no mutexes.
4. **Treat shared data as dangerous.** Any variable written in a handler and read in main code (or the reverse)
   can change between two instructions of the main code. Declare it ¬volatile¬ so the compiler re-reads it; that
   alone does not make multi-step updates safe.`,

      { t: 'code', lang: 'c', status: 'reviewed', caption: 'The standard shape: the handler captures, the main loop processes',
        code: R`#include <stdint.h>
#include <stdbool.h>

#define RX_BUF_SIZE 64u                 /* power of two */

static volatile uint8_t  rx_buf[RX_BUF_SIZE];
static volatile uint32_t rx_head;       /* written only by the ISR  */
static volatile uint32_t rx_tail;       /* written only by main     */

void uart_rx_isr(void)
{
    uint8_t  byte = (uint8_t)UART_DATA;             /* read clears the request */
    uint32_t next = (rx_head + 1u) & (RX_BUF_SIZE - 1u);

    if (next != rx_tail) {                          /* drop the byte if full */
        rx_buf[rx_head] = byte;
        rx_head = next;
    }
}

bool uart_get(uint8_t *out)
{
    if (rx_tail == rx_head) {
        return false;                               /* empty */
    }
    *out = rx_buf[rx_tail];
    rx_tail = (rx_tail + 1u) & (RX_BUF_SIZE - 1u);
    return true;
}`,
        explain: [
          { lines: '6-8', md: 'A ring buffer with one writer per index. The ISR only writes ¬rx_head¬; main only writes ¬rx_tail¬. Each index is a single aligned 32-bit word, which a 32-bit CPU loads or stores in one instruction, so neither side ever sees a half-updated index.' },
          { lines: '12', md: 'Reading the data register pops the byte and, on most UARTs, removes the interrupt request. Do it first.' },
          { lines: '15-18', md: 'The data byte is stored *before* the index is advanced. Main code cannot see the new slot until it is filled.' },
          { lines: '23-28', md: 'Main reads ¬rx_head¬ once. If the ISR runs right after, main simply sees the extra byte on its next call.' },
        ] },

      { t: 'predict',
        q: 'A timer handler does its work but does not clear the timer\'s EXPIRED flag. The timer is in auto-reload mode with a 1 s period. What does the system do after the first expiry?',
        choices: [
          { t: 'The handler runs once per second as intended; flags clear themselves on handler exit', why: 'What clears a flag in a peripheral register? Check the access type the register table gives it.' },
          { t: 'The handler is re-entered immediately on every return, and the main loop stops making progress', ok: true, why: 'The request line stays asserted, so the interrupt is pending again the moment the handler returns.' },
          { t: 'The handler runs once and never again', why: 'For it to never run again the request would have to go away; here it never goes away.' },
        ],
        reveal: 'This is the most common first-interrupt bug. The symptom looks like a hang: the debugger always halts inside the handler. A stuck handler also starves the watchdog feed in main code, so the next thing you see may be a watchdog reset loop.' },

      { t: 'callout', kind: 'mistake', title: 'printf in a handler',
        md: 'Formatted output can take milliseconds, may take a lock that the interrupted code already holds, and usually depends on another interrupt (UART TX) that cannot run while your handler does. It works on the bench and deadlocks in the field. Set a flag and print from main code.' },

      { t: 'callout', kind: 'decision', title: 'Interrupt or polling?',
        md: 'Use an interrupt when the event is rare relative to the main loop or must be answered faster than the loop period. Poll when the event rate is high and regular (a tight sampling loop) or when the code must be simple enough to verify by inspection, as in a small bootloader: no interrupts means no concurrency bugs.' },

      { t: 'exercise',
        prompt: `A system has three interrupt sources. Their handlers take: A (highest priority) 20 µs, B 150 µs, C (lowest) 400 µs. Main code masks all interrupts for at most 50 µs. Hardware entry time is negligible. What is the worst-case delay, in µs, from B's request to the *start* of B's handler? Assume A can occur at most once in that interval, and that a lower-priority handler is preempted by a higher-priority request.`,
        hints: [
          'C has lower priority than B, so a running C handler is preempted and adds no delay.',
          'Two things can delay B: the longest masked section, and the higher-priority handler A running first.',
        ],
        answer: { type: 'number', value: 70, tol: 0, unit: 'µs' },
        solution: `B waits for the masked section (up to 50 µs) and for A if A becomes pending in the same window (20 µs). C does not delay B because B preempts it. Worst case **70 µs**. If priorities were all equal, B could also wait for all of C: 470 µs.` },

      `## Harder application

A 32-bit CPU keeps a 64-bit millisecond counter that a tick interrupt increments. Main code reads it with
¬uint64_t now = ticks;¬. Explain how ¬now¬ can come out wrong by about 49.7 days, and give two fixes. (The read is
two 32-bit loads. If the tick increments from ¬0x00000000_FFFFFFFF¬ to ¬0x00000001_00000000¬ between them, main
combines the old low word with the new high word, or the reverse, and is off by 2³² ms. Fixes: mask the interrupt
around the read, or read high, low, high again and retry if the high words differ. This is the "shared data hazard"
in its smallest form; the RTOS section generalises it.)`,
    ],
    quiz: [
      { q: 'A handler never runs although the peripheral\'s flag is set. Which of these would NOT explain it?', kind: 'arch', choices: [
        { t: 'The handler function is longer than 100 lines', ok: true, why: 'Length affects how long other interrupts wait, not whether this one is entered.' },
        { t: 'The interrupt is not enabled in the interrupt controller', why: 'A request blocked at the controller never reaches the CPU, so this would indeed stop the handler.' },
        { t: 'The global interrupt mask is set', why: 'With the CPU-level mask set, every maskable request stays pending, which would produce exactly this symptom.' },
        { t: 'The peripheral\'s own interrupt-enable bit is clear', why: 'A set flag only drives the request line when its local enable is set, so this would block it too.' },
      ] },
      { q: 'On a Cortex-M, why can an interrupt handler be written as a plain C function?', kind: 'arch', choices: [
        { t: 'The hardware stacks the registers that the C calling convention allows a function to overwrite', ok: true, why: 'r0–r3, r12, LR, PC and the status word are saved on entry and restored on return, matching the caller-saved set.' },
        { t: 'The compiler detects handlers by name and adds save code', why: 'Names are only a link-time convention for filling the vector table; no extra code is generated for them.' },
        { t: 'Handlers run on a separate CPU core', why: 'The same core runs them; it borrows the current context and puts it back afterwards.' },
      ] },
      { q: 'What must a RISC-V trap handler do that a Cortex-M handler does not?', kind: 'arch', choices: [
        { t: 'Save and restore the general-purpose registers it uses, in software', ok: true, why: 'RISC-V hardware records only PC and cause in CSRs; the integer registers are untouched.' },
        { t: 'Look up its own address in the vector table', why: 'By the time the handler is running, the jump to it has already happened.' },
        { t: 'Re-enable the peripheral clock', why: 'Clock gating is unaffected by taking an interrupt on either architecture.' },
      ] },
      { q: 'Which is the best division of work for a UART receive interrupt?', kind: 'code', choices: [
        { t: 'Handler copies the byte to a ring buffer; main code parses messages', ok: true, why: 'The handler stays short and bounded, and parsing can take as long as it needs without blocking other interrupts.' },
        { t: 'Handler parses the complete message and calls the command function', why: 'Command execution time is unbounded and would hold off every equal- or lower-priority interrupt.' },
        { t: 'Handler disables the UART until main code has time to read the byte', why: 'Bytes that arrive while the UART is disabled are lost, which is the problem the interrupt was meant to solve.' },
      ] },
      { q: 'A flag `volatile bool ready` is set in a handler. Main code does `if (ready) { ready = false; process(); }`. What can go wrong?', kind: 'code', choices: [
        { t: 'A second event arriving between the test and the clear is erased without being processed', ok: true, why: 'The clear overwrites a flag that was set again in the gap; one event is lost. A counter or queue avoids it.' },
        { t: 'Nothing: volatile makes the test and clear atomic', why: 'The qualifier forces real loads and stores; it does not join them into one indivisible step.' },
        { t: 'The compiler removes the test because the flag is never set in main code', why: 'That is the failure when the qualifier is missing; here it is present, so the load is kept.' },
      ] },
      { q: 'What usually dominates worst-case interrupt latency in a real firmware project?', kind: 'concept', choices: [
        { t: 'The longest stretch of code that runs with interrupts masked', ok: true, why: 'Hardware entry is a fixed handful of cycles; software masking can be arbitrarily long.' },
        { t: 'The time to fetch the vector from flash', why: 'That is one memory read, a tiny fixed cost.' },
        { t: 'The size of the vector table', why: 'The table is indexed directly; its size has no effect on lookup time.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 8
  {
    id: 'mcu-timers-watchdog',
    title: 'Timers, counters and watchdogs',
    minutes: 50,
    summary: 'A timer is a counter with a clock. From that one idea come delays, PWM, input measurement, the system tick, and the supervisor that resets a hung system.',
    skills: ['mcu-sk-timer', 'mcu-sk-wdt'],
    blocks: [
      `## The problem

You need a 1 kHz control loop, a 20 kHz PWM for a motor, a measurement of a pulse width that varies from 1 to 2 ms,
and a guarantee that if the firmware ever hangs the motor is switched off within 100 ms. A delay loop can do none of
these accurately. One peripheral type does all four.`,

      `## Theory: the timer

A **timer** is a register that increments (or decrements) once per clock edge. Everything else is decoration around
that counter:

- **Prescaler**: divides the input clock before the counter. With a prescaler setting of P the counter clock is
  f_clk / (P + 1) on most chips (the +1 because a register value of 0 means "divide by 1"; check your part).
- **Auto-reload (period) register**: when the counter reaches it, the counter restarts and an *update* (overflow)
  event is raised. Counting 0…ARR takes ARR + 1 ticks.
- **Update period**: T = (PSC + 1) × (ARR + 1) / f_clk.
- **Compare channel**: a register continuously compared with the counter. On match it can set a flag, raise an
  interrupt, or change an output pin in hardware.
- **Capture channel**: on an edge at an input pin, the current counter value is copied into the capture register in
  hardware. The timestamp is exact to one counter tick no matter how late the software reads it.

### PWM from a compare channel

Let the counter run 0…ARR repeatedly. Drive the pin high at reload and low on compare match:

- frequency = f_cnt / (ARR + 1)
- duty = CCR / (ARR + 1)
- resolution = ARR + 1 steps

Frequency and resolution trade against each other: with an 80 MHz counter clock and a 20 kHz PWM, ARR + 1 = 4000
steps (just under 12 bits). At 200 kHz it is 400 steps. This is the same trade-off the ESP32 LEDC peripheral
exposes as "duty resolution versus frequency".

### Measuring with capture

Timestamp the rising edge, then the falling edge; the difference × the counter tick is the pulse width. Subtract as
unsigned numbers of the counter's width and a single wrap between the two edges cancels out.

### The system tick

An RTOS or a ¬millis()¬ function needs a periodic interrupt. Cortex-M cores include a dedicated 24-bit down-counter
for this, **SysTick**, so the same OS code works on any vendor's chip. RISC-V defines ¬mtime¬ and ¬mtimecmp¬ for the
same purpose. On the ESP32, ESP-IDF configures a hardware timer for the FreeRTOS tick.`,

      { t: 'widget', name: 'timer-lab', props: { mode: 'timer' }, title: 'Clock, prescaler, counter, compare',
        caption: 'Set up a 1 ms update period from the given clock. Then find a second prescaler/reload pair that gives the same period and say which you would prefer, and why.' },

      `## Worked example

Clock 32 MHz (the CPU clock used by the 2026 eCTF reference design), 16-bit timer, wanted: 1 kHz update interrupt.

- Total division needed: 32,000,000 / 1,000 = 32,000.
- Option A: PSC = 0, ARR = 31,999. Fits in 16 bits. Finest possible compare resolution (31.25 ns per count).
- Option B: PSC = 31, ARR = 999. The counter now ticks in exact microseconds, which makes compare values readable.
- For a 2 Hz blink: division 16,000,000 does not fit in 16 bits without a prescaler. PSC = 499 gives a 64 kHz counter;
  ARR = 31,999 gives 0.5 s.

Always check the +1s and the register widths against the reference manual; they are the usual source of periods that
are off by one count or one factor of two.`,

      { t: 'widget', name: 'c-lab', title: 'C lab: poll a timer flag',
        props: {
          title: 'Three timer periods, by polling',
          prompt: `Use Bench-MCU TIMER0 (base ¬0x4000_2000¬; the predefined header declares ¬TIM_CTRL¬, ¬TIM_LOAD¬, ¬TIM_COUNT¬, ¬TIM_STATUS¬).

- ¬TIM_CTRL¬: bit 0 ¬ENABLE¬, bit 1 ¬AUTO_RELOAD¬
- ¬TIM_STATUS¬: bit 0 ¬EXPIRED¬, **write 1 to clear**

Complete ¬wait_period()¬ so that it blocks until the timer expires and then acknowledges the flag. ¬main¬ toggles pin 0 once per period, three times. If you forget to clear the flag, the second and third waits return at once; the program still prints the right text, so read the hint about how to see the difference.

Bench-MCU advances one simulated tick per executed statement; timing here is illustrative, not cycle-accurate.`,
          starter: R`#include <stdint.h>
#include <stdio.h>

#define TIM_ENABLE       (1u << 0)
#define TIM_AUTO_RELOAD  (1u << 1)
#define TIM_EXPIRED      (1u << 0)

static uint32_t polls;

static void wait_period(void)
{
    /* TODO: loop until EXPIRED is set, counting iterations in polls,
       then clear the flag the way a W1C bit must be cleared. */
}

int main(void)
{
    int i;

    GPIO_DIR = (1u << 0);
    TIM_LOAD = 40u;
    TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD;

    for (i = 0; i < 3; i++) {
        wait_period();
        GPIO_TOGGLE = (1u << 0);
    }
    TIM_CTRL = 0u;

    printf("toggles=3 waited=%d\n", polls >= 30u ? 1 : 0);
    return 0;
}
`,
          solution: R`#include <stdint.h>
#include <stdio.h>

#define TIM_ENABLE       (1u << 0)
#define TIM_AUTO_RELOAD  (1u << 1)
#define TIM_EXPIRED      (1u << 0)

static uint32_t polls;

static void wait_period(void)
{
    while ((TIM_STATUS & TIM_EXPIRED) == 0u) {
        polls++;
    }
    TIM_STATUS = TIM_EXPIRED;
}

int main(void)
{
    int i;

    GPIO_DIR = (1u << 0);
    TIM_LOAD = 40u;
    TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD;

    for (i = 0; i < 3; i++) {
        wait_period();
        GPIO_TOGGLE = (1u << 0);
    }
    TIM_CTRL = 0u;

    printf("toggles=3 waited=%d\n", polls >= 30u ? 1 : 0);
    return 0;
}
`,
          tests: [
            { name: 'waits for three real expiries and leaves pin 0 high', regs: { GPIO_OUT: 0x0001 }, stdoutIncludes: 'toggles=3 waited=1' },
          ],
          hints: [
            'The loop condition is "flag bit is still 0". Mask the status register with ¬TIM_EXPIRED¬ before comparing.',
            'Put ¬polls++¬ in the loop body. The final ¬waited=1¬ is only printed if the three waits together polled at least 30 times, which they cannot do unless each wait really spans a timer period.',
            'To clear a write-1-to-clear bit, assign the mask: ¬TIM_STATUS = TIM_EXPIRED;¬. Writing 0 does nothing.',
          ],
          explain: 'With a 40-tick period and three waits, a correct program polls far more than 30 times. If the flag is never cleared, only the first wait blocks. On real hardware the same bug shows as a "delay" that works once and then returns instantly.',
        } },

      `## The watchdog

Firmware hangs: a loop waits for a flag that never comes, a pointer is corrupted, a peripheral locks up after an
ESD strike. A **watchdog timer (WDT)** is a counter that resets the chip when it expires. Healthy firmware restarts
("feeds", "kicks") it periodically. If the firmware stops doing so, the reset happens without any software cooperating.

Properties of a good watchdog:

- **Independent clock**, so it survives failure of the main oscillator.
- **Hard to disable** once started. Some can be locked until the next reset.
- **Windowed** operation: a feed that comes *too early* also causes a reset. This catches firmware that is stuck in a
  tight loop which happens to include the feed.
- **Reset cause** recorded in a status register so that the next boot can log "this was a watchdog reset".

The MAX78000 has two watchdog instances; the MSPM0L2228 has a windowed watchdog (WWDT0). ESP-IDF runs both an
interrupt watchdog and a task watchdog on top of hardware timers. Timeout ranges and lock behaviour differ per chip:
read the watchdog chapter of the reference manual before relying on it.`,

      { t: 'widget', name: 'timer-lab', props: { mode: 'watchdog' }, title: 'Watchdog timeline',
        caption: 'Make the system hang at different points and see when the reset comes. Then try feeding too early with the window enabled.' },

      { t: 'predict',
        q: 'To make sure the watchdog is fed reliably, a developer moves the feed into a 10 ms timer interrupt. The main loop later deadlocks waiting on an I2C device. What happens?',
        choices: [
          { t: 'The watchdog resets the system within one timeout period', why: 'The watchdog only fires if feeding stops. What is still running while the main loop is stuck?' },
          { t: 'Nothing: the timer interrupt keeps feeding, and the system stays hung indefinitely', ok: true, why: 'Interrupts continue to run when main code is stuck in a loop, so the watchdog sees a healthy system.' },
          { t: 'The timer interrupt stops because main code is blocked', why: 'Interrupts preempt main code regardless of what it is doing; that is their purpose.' },
        ],
        reveal: 'A feed must be evidence that the thing you care about is making progress. A timer interrupt proves only that the timer works. This is the classic watchdog anti-pattern.' },

      `### Feeding strategy

- Feed from **one place**, at the end of a complete pass of the main loop, after the work is done.
- In a multi-task system, each task sets a "still alive" bit when it completes a cycle; a supervisor feeds the
  watchdog only when **all** bits are set, then clears them.
- Choose the timeout from the system's needs: longer than the worst legitimate loop time (including flash erases),
  shorter than the time in which a hang becomes dangerous.
- Do not feed inside long blocking loops "to keep it happy". Give those loops their own timeout and error path.
- On every boot, read the reset cause. Count watchdog resets; a product that silently reboots daily has a bug.`,

      { t: 'callout', kind: 'mistake', title: 'Disabling the watchdog "for now" during development',
        md: 'Code written without a watchdog accumulates long blocking calls. Turning it on a week before release produces dozens of resets and no time to fix their causes. Keep it enabled from the first day, with a generous timeout, and pause it only while halted in the debugger (most chips have a debug-freeze option for exactly this).' },

      { t: 'callout', kind: 'security', title: 'A watchdog reset is also an attacker\'s tool',
        md: 'A reset restarts the boot sequence, which is the favourite target for glitching, and leaves RAM contents intact. An attacker who can cause hangs can cause unlimited boot attempts. Count consecutive abnormal resets in non-volatile storage and slow down or lock out after too many; verify by forcing resets and checking that the delay really increases.' },

      { t: 'exercise',
        prompt: `A 16-bit timer is clocked at 48 MHz. You need a PWM frequency of exactly 25 kHz with no prescaler (PSC = 0). What value goes in the auto-reload register, given that the counter counts from 0 to ARR inclusive?`,
        hints: [
          'Counts per PWM period = 48,000,000 / 25,000.',
          'Counting 0…ARR is ARR + 1 counts.',
        ],
        answer: { type: 'number', value: 1919, tol: 0 },
        solution: `48,000,000 / 25,000 = 1920 counts per period, so **ARR = 1919**. That gives 1920 duty steps (almost 11 bits). Writing 1920 would give 24,987 Hz: a 0.05 % error that nobody notices on a motor and that breaks a protocol expecting exact timing.` },

      `## Harder application

A product has a main loop that normally takes 5 ms but takes up to 600 ms when it erases a flash page. Safety analysis
says a hang must be detected within 200 ms. A single watchdog timeout cannot satisfy both. Propose a design. (One
answer: split the erase into steps that return to the main loop between pages, so the loop time is bounded by one page
erase; if one page erase alone exceeds 200 ms, put the outputs into their safe state before starting the erase and
lengthen the timeout only for that phase, restoring it afterwards. What you must not do is feed blindly inside the
erase routine: that removes the protection during exactly the operation most likely to hang.)`,
    ],
    quiz: [
      { q: 'A timer has f_clk = 1 MHz, PSC = 9, ARR = 999, counting 0 to ARR. What is the update period?', kind: 'code', choices: [
        { t: '10 ms', ok: true, why: '(9 + 1) × (999 + 1) / 1,000,000 = 10,000 / 1,000,000 s.' },
        { t: '8.991 ms', why: 'This multiplies the raw register values without the +1 on each; both the prescaler and the counter include the zero count.' },
        { t: '1 ms', why: 'This ignores the prescaler, which divides the clock by ten before the counter sees it.' },
      ] },
      { q: 'Why does input capture give a more accurate timestamp than reading the counter in a GPIO interrupt handler?', kind: 'arch', choices: [
        { t: 'Hardware latches the count at the edge, so interrupt latency does not affect the value', ok: true, why: 'The software can read the capture register late; the number it reads is still the count at the edge.' },
        { t: 'Capture uses a faster clock than the counter', why: 'Capture copies the same counter, at the same clock; no extra resolution is created.' },
        { t: 'Capture interrupts have the highest priority', why: 'Priority is configurable and is not what makes the timestamp exact.' },
      ] },
      { q: 'You raise a PWM frequency by a factor of 10 while keeping the same counter clock. What happens to duty-cycle resolution?', kind: 'concept', choices: [
        { t: 'It drops by a factor of 10, because the period contains a tenth as many counts', ok: true, why: 'Resolution equals the number of counter ticks per period.' },
        { t: 'It is unchanged, because resolution depends only on the register width', why: 'Register width is an upper limit; the usable steps are set by the reload value.' },
        { t: 'It increases, because edges occur more often', why: 'More frequent edges do not add counter states within each period.' },
      ] },
      { q: 'Which watchdog feed location gives the most meaningful protection in a single-loop firmware?', kind: 'code', choices: [
        { t: 'Once, at the end of the main loop, after all work for the pass has completed', ok: true, why: 'The feed then proves that every part of the loop ran to completion.' },
        { t: 'In the periodic tick interrupt', why: 'The tick keeps running when main code is stuck, so the hang would go undetected.' },
        { t: 'Before and after every function call, to be safe', why: 'Feeds scattered everywhere mean a loop stuck in almost any small region still feeds, hiding the hang.' },
      ] },
      { q: 'What extra fault does a *windowed* watchdog detect compared with a simple one?', kind: 'concept', choices: [
        { t: 'Firmware that feeds too often, such as a runaway loop containing the feed', ok: true, why: 'An early feed violates the window and causes a reset, so "too fast" becomes detectable as well as "too slow".' },
        { t: 'Failure of the main oscillator', why: 'That is addressed by giving the watchdog an independent clock, with or without a window.' },
        { t: 'Stack overflow', why: 'Neither kind of watchdog observes memory; overflow is detected only indirectly if it causes a hang.' },
      ] },
      { q: 'Two capture values from a 16-bit free-running counter are 0xFFF0 (rising edge) and 0x0010 (falling edge). The counter ticks at 1 MHz and wrapped once at most. What is the pulse width?', kind: 'code', choices: [
        { t: '32 µs', ok: true, why: '(uint16_t)(0x0010 − 0xFFF0) = 0x0020 = 32 counts; unsigned subtraction absorbs the wrap.' },
        { t: '65,504 µs', why: 'That is the result of subtracting the other way round; the falling edge came after the rising edge.' },
        { t: 'It cannot be determined because the counter wrapped', why: 'A single wrap is handled exactly by modular arithmetic of the counter\'s width.' },
      ] },
    ],
  },
];
