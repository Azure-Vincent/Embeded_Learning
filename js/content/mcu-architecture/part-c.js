// Microcontroller architecture, part C: DMA and data converters, boot, memory maps and linker scripts.
const R = String.raw;

export default [
  // ───────────────────────────────────────────────────────────────── 9
  {
    id: 'mcu-dma-adc',
    title: 'DMA, ADC and DAC peripherals',
    minutes: 45,
    summary: 'Moving data without the CPU, and the digital side of analogue conversion: how a SAR converter spends its clock cycles and who tells it when to start.',
    skills: ['mcu-sk-dma-adc'],
    blocks: [
      `## The problem

An ADC must sample a vibration sensor at 100 kHz, and a UART receives a 921,600 baud stream. With one interrupt per
sample and one per byte, the CPU takes about 190,000 interrupts a second. At roughly a microsecond of entry, exit and
handler each, a fifth of the processor disappears into moving single words from a register to an array, and one
long critical section anywhere in the firmware loses data. The work is trivial. Why is the CPU doing it?`,

      `## Theory: DMA

A **direct memory access (DMA) controller** is a small bus master. It is given a source address, a destination
address, a count and a trigger. Each time the trigger fires (a peripheral saying "I have data" or "I need data"), the
controller performs one read and one write on the bus by itself, adjusts the addresses, and decrements the
count. The CPU is not interrupted until the count reaches zero, or half-way if you ask for that too.

A channel's configuration is always the same handful of fields:

| Field | UART receive example | ADC example |
|---|---|---|
| Source address | UART data register (fixed) | ADC result register (fixed) |
| Destination address | buffer in RAM (incrementing) | sample array in RAM (incrementing) |
| Transfer width | 8 bits | 16 or 32 bits |
| Count | buffer length | number of samples |
| Trigger | "receive data available" | "conversion complete" |
| Mode | circular, or one-shot | circular with half/full interrupts |

**Circular mode** wraps the destination back to the start when the count runs out, giving a continuously filled ring
buffer. With **half-transfer and transfer-complete interrupts** the firmware processes one half of the buffer while
the hardware fills the other.

### What it costs you

DMA makes a second writer of memory that the compiler knows nothing about.

- **Ownership.** While a transfer is active, the buffer belongs to the hardware. Reading the half that is being
  filled gives a mixture of old and new samples. Decide, for every buffer, which side owns which part at which time.
- **Lifetime.** A buffer on the stack of a function that returns while DMA is still running becomes a hardware-driven
  stack corruption. DMA buffers are static or otherwise outlive the transfer.
- **Length.** The controller writes exactly *count* items. A count larger than the buffer is a buffer overflow that
  no bounds check sees. On a system with no MMU it will overwrite whatever follows.
- **Caches.** On cores with a data cache (Cortex-M7 class and above, application processors), the CPU may read a
  stale cached copy of memory that DMA has changed, or DMA may transmit stale RAM because the new data is still in
  the cache. Drivers must flush before a transmit and invalidate after a receive, and buffers must be aligned to
  cache lines. The Cortex-M4 and M0+ in this course have no data cache, so the problem does not arise there; it
  will arise on the next chip you use.
- **Variable-length input.** DMA counts items, it does not know where a message ends. For UART reception combine it
  with an idle-line or timeout interrupt, then compute how many bytes arrived from the remaining count.`,

      { t: 'ascii', caption: 'UART receive into a circular buffer by DMA. The CPU runs only at the half and full marks, and on idle.',
        text: R`   UART RX reg ──(trigger: byte ready)──► DMA ──► buf[0] buf[1] ... buf[31] | buf[32] ... buf[63]
                                                  └────── first half ──────┘ └──── second half ────┘
   half interrupt : CPU may read buf[0..31]   (hardware is writing buf[32..63])
   full interrupt : CPU may read buf[32..63]  (hardware has wrapped to buf[0])
   idle interrupt : bytes received so far = 64 - DMA_remaining_count` },

      { t: 'callout', kind: 'decision', title: 'Polling, interrupt per item, or DMA?',
        md: `- **Polling**: the data rate is low and the loop is fast, or simplicity matters most (bootloaders).
- **Interrupt per item**: up to a few tens of kilohertz of events, or when each item needs a decision.
- **DMA**: steady streams faster than that, or any stream where a single missed deadline corrupts the data (audio, ADC sampling, high-speed serial, driving LED strips).
DMA is the hardest of the three to debug. Do not reach for it until the arithmetic says the interrupt version cannot work.` },

      `## Theory: the SAR ADC as a peripheral

The electronics section covered references, resolution and quantisation. Here is what the converter does with its
clock. Most MCU ADCs are **successive-approximation (SAR)** converters:

1. **Sample.** A switch connects the selected input pin to a small internal capacitor for the *sample time*.
2. **Hold.** The switch opens; the capacitor's voltage is the thing to be measured.
3. **Convert.** A binary search, one bit per ADC clock: an internal DAC is set to half scale and a comparator says
   whether the held voltage is above or below it. That decides the top bit. Then three quarters or one quarter,
   deciding the next bit, and so on. An N-bit result takes about N clock cycles.
4. **Result.** The code is written to the data register and a "done" flag is set.`,

      { t: 'ascii', caption: 'A 4-bit successive approximation of 0.69 × Vref. Result 1011 = 11/16 = 0.6875.',
        text: R`  step  trial code  DAC output   input >= DAC?   bit kept
  ────  ──────────  ───────────  ──────────────  ────────
   1     1000       0.5000 Vref   yes             1
   2     1100       0.7500 Vref   no              0
   3     1010       0.6250 Vref   yes             1
   4     1011       0.6875 Vref   yes             1` },

      `### Sample time

The sampling capacitor charges through the source's output resistance plus the internal switch resistance: an RC
circuit. To settle within half an LSB of an N-bit converter the capacitor needs about (N + 1) × ln 2 time constants:
roughly 9 τ for 12 bits. A high-impedance source (a 100 kΩ divider) with too short a sample time gives readings that
are low, noisy, and that depend on which channel was converted *before*, because the capacitor still holds part of
the previous channel's voltage. Fixes: lengthen the sample time, lower the source impedance, or add a capacitor at
the pin much larger than the sampling capacitor.

### Triggers and references

- **Software trigger**: write a start bit, wait for done. The sample instant has the jitter of your code.
- **Hardware trigger**: a timer event starts each conversion. The sample instants are exact to a clock cycle.
  Signal processing needs this. Pair it with DMA and the whole acquisition runs with no CPU involvement.
- **Reference**: the code is a ratio to V_ref. A reference tied to the supply moves with the supply; an internal
  or external reference does not. The MSPM0L2228 has a VREF module; whether to use it, the supply, or an external
  reference is a board-level decision, and the available voltages are in the datasheet.

### Platform notes

- The MSPM0L2228 ADC is 12-bit, 1.68 Msps, with up to 26 external channels (TI datasheet SLASF94A, Features, p.1).
  The original ESP32 has two 12-bit SAR ADCs with 18 channels in total (ESP32 Series Datasheet v5.3, section 4.9.1).
- The MAX78000 ADC resolution is a datasheet item this course has not verified (Analog Devices' site could not be
  read when the facts were checked); look it up. The MSDK driver shows external inputs AIN0–AIN3.
- On the original ESP32, the pins of ADC2 cannot be used for conversions while Wi-Fi is in use, because the radio
  uses that converter. Plan analogue inputs on ADC1.
- A **DAC** is the reverse: a register value sets an output voltage, code / 2^N × V_ref. It is updated by
  software or, for waveforms, by a timer trigger with DMA feeding samples from a table. The output is a weak source and
  normally needs a buffer amplifier. Many MCUs have no DAC and use filtered PWM instead; check the device header's
  peripheral list.`,

      { t: 'predict',
        q: 'An ADC reads two channels in turn: channel A is a 3.0 V rail through a 1 MΩ / 1 MΩ divider (so 1.5 V), channel B is tied to ground. Sample time is at its shortest setting. What does channel A read?',
        choices: [
          { t: '1.5 V, the divider output, because an ADC input draws no current', why: 'That would require the sampling capacitor to fully charge through 500 kΩ in a fraction of a microsecond.' },
          { t: 'Less than 1.5 V, pulled toward the previous channel', ok: true, why: 'The capacitor starts at channel B\'s voltage and cannot charge through such a high source resistance within the sample window.' },
          { t: 'Exactly 0 V, because the capacitor keeps the previous channel\'s charge', why: 'Some charge does flow during the sample window, so the reading moves part of the way toward the true value.' },
        ],
        reveal: 'The source resistance seen by the ADC is the two divider resistors in parallel, 500 kΩ. With a sampling capacitance of a few picofarads plus pin capacitance, τ is several microseconds, and nine of those are needed. A 100 nF capacitor from the pin to ground acts as a charge reservoir and solves it, at the cost of slowing how fast the reading follows the rail.' },

      { t: 'callout', kind: 'mistake', title: 'Starting the next DMA transfer from a buffer the CPU is still reading',
        md: 'One-shot DMA into a buffer, then "process" in main code while the completion handler has already restarted the transfer into the same buffer. Data changes under the processing code. Use two buffers and swap them, or circular mode with strict half ownership.' },

      { t: 'exercise',
        prompt: `A 12-bit SAR ADC is driven from a source whose resistance, together with the internal switch, is 20 kΩ. The sampling capacitance is 10 pF. Using the rule of 9 time constants for 12-bit settling, what is the minimum sample time in microseconds?`,
        hints: [
          'What kind of circuit do a resistance and the sampling capacitor form, and what single number describes how fast it settles?',
          'τ = R × C = 20,000 Ω × 10 × 10⁻¹² F. Keep track of the powers of ten.',
          'τ = 0.2 µs. The rule in the lesson says how many of these a 12-bit result needs.',
        ],
        answer: { type: 'number', value: 1.8, tol: 0.05, unit: 'µs' },
        solution: `τ = 20 kΩ × 10 pF = 200 ns. 9 τ = **1.8 µs**. Choose the next sample-time setting above that. The capacitance and switch resistance for a real part are in the ADC section of its datasheet's electrical characteristics.` },

      `## Harder application

Design the acquisition for the opening problem: 100 kHz sampling, processed in blocks of 256 samples. State the
trigger source, the DMA mode, the buffer size, which interrupts are enabled, how many interrupts per second the CPU now
takes, and how long the processing code has for each block before data is overwritten. (Timer compare event at
100 kHz triggers the ADC; DMA in circular mode into a 512-sample static buffer; half and full interrupts; 100,000 / 256
≈ 391 interrupts per second instead of 100,000; each block must be processed within 2.56 ms, the time the hardware
takes to fill the other half.)`,
    ],
    quiz: [
      { q: 'What does a DMA controller do when its trigger fires?', kind: 'arch', choices: [
        { t: 'Copies one item from source to destination without the CPU', ok: true, why: 'It is a bus master that copies one item per trigger and counts down.' },
        { t: 'Raises an interrupt so that the CPU can copy the item to its destination', why: 'That describes interrupt-driven I/O, the thing DMA is designed to replace.' },
        { t: 'Speeds up the peripheral clock so the data arrives sooner', why: 'DMA moves data; it has no influence on clock rates.' },
      ] },
      { q: 'A function declares `uint8_t buf[64];` locally, starts a DMA receive into it, and returns. What is the consequence?', kind: 'security', choices: [
        { t: 'DMA keeps writing into stack memory that other functions now use', ok: true, why: 'The hardware holds the raw address; it neither knows nor cares that the stack frame has been released.' },
        { t: 'The transfer is cancelled automatically when the function returns', why: 'Nothing links a C scope to a hardware channel; the transfer continues until its count expires or it is stopped.' },
        { t: 'The compiler reports an error, because a local array cannot be given to hardware', why: 'Passing a local array\'s address to a function is legal C; the compiler cannot see what the hardware does later.' },
      ] },
      { q: 'How many comparator decisions does a 12-bit SAR conversion make after sampling?', kind: 'concept', choices: [
        { t: '12, one per result bit', ok: true, why: 'A binary search over 4096 levels needs log2(4096) = 12 steps.' },
        { t: '4096, one per possible code', why: 'That is how a counting (ramp) converter works; successive approximation halves the search range each step.' },
        { t: '1, the comparator outputs all bits at once', why: 'A single comparator gives one bit of information per decision; all-at-once conversion needs one comparator per level.' },
      ] },
      { q: 'ADC readings of a high-impedance source change depending on which channel was converted previously. Which change addresses the cause?', kind: 'circuit', choices: [
        { t: 'Increase the sample time or add a capacitor at the pin', ok: true, why: 'Both let the sampling capacitor reach the source voltage instead of retaining charge from the previous channel.' },
        { t: 'Increase the ADC resolution setting so the error falls below one count', why: 'More bits measure the unsettled voltage more finely; the voltage is still wrong.' },
        { t: 'Average more readings in software to cancel the error', why: 'Averaging reduces random noise, but this error is systematic and has the same sign every time.' },
      ] },
      { q: 'Why trigger an ADC from a timer rather than from a software loop when the samples feed a digital filter?', kind: 'concept', choices: [
        { t: 'Sample spacing becomes exact; software jitter would act as noise', ok: true, why: 'Jitter in the sampling instant becomes noise in the sampled signal.' },
        { t: 'Software-triggered conversions have fewer valid bits', why: 'The number of result bits is the same whichever way the conversion is started.' },
        { t: 'A timer trigger makes each conversion complete faster', why: 'Conversion time is set by the ADC clock and sample time, not by what starts it.' },
      ] },
      { q: 'On which of this course\'s cores must a driver flush or invalidate a data cache around DMA transfers?', kind: 'arch', choices: [
        { t: 'Neither: they have no data cache', ok: true, why: 'The hazard exists on cached cores such as the Cortex-M7 and application processors, so the habit matters when you move to those.' },
        { t: 'Both, on every transfer, because DMA bypasses the CPU', why: 'A flush operates on a cache; these two cores do not have one between the CPU and RAM.' },
        { t: 'Only the Cortex-M0+, the smaller core', why: 'The smallest core in the family is the least likely to carry a data cache, not the most.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 10
  {
    id: 'mcu-boot',
    title: 'Reset, bootloaders and the first instruction',
    minutes: 50,
    summary: 'From the reset pin being released to main(): reset causes, ROM code, vector tables, second-stage bootloaders, and what each stage trusts.',
    skills: ['mcu-sk-boot'],
    blocks: [
      `## The problem

A freshly assembled board does nothing. No LED, no serial output. Is the fault in your application, the bootloader,
the flash contents, the strapping resistors, or the power supply? You can only narrow it down if you know the
sequence of stages between power-on and \`main()\`, and what evidence each stage leaves.`,

      `## Theory

### Reset causes

Reset forces the CPU and peripherals into a defined state. Chips record *why* in a reset-cause register, and good
firmware reads it on every boot.

| Cause | Trigger | What it tells you |
|---|---|---|
| **Power-on reset (POR)** | Supply rising through a threshold | Normal start; RAM contents undefined |
| **Brown-out reset (BOR)** | Supply dipped below a threshold | Power integrity problem: weak regulator, load step, flat battery |
| **External reset** | Reset pin pulled low | Button, debugger, supervisor IC |
| **Watchdog reset** | Watchdog expired | Firmware hung or was too slow |
| **Software reset** | Firmware requested it | Deliberate: after an update, or a fatal-error handler |
| **Lockup / fault reset** | Unrecoverable CPU fault | Bug: bad pointer, stack overflow |

Only the first two remove or disturb power. After all the others, SRAM still holds its previous contents.

### What the CPU does first

Each architecture defines a fixed first action:

- **Arm Cortex-M**: read the 32-bit word at the start of the vector table into the main stack pointer, read the next
  word into PC, and start executing. No code has run yet; the hardware did both loads.
- **RISC-V**: set PC to an implementation-defined reset address and start executing. Software must set up the stack
  pointer itself.
- **Xtensa (ESP32, ESP32-S3)**: start at a fixed reset vector inside the mask ROM.`,

      { t: 'figure', caption: 'Start of a Cortex-M vector table. Exceptions 4–6 exist only on ARMv7-M (for example Cortex-M4); on ARMv6-M (Cortex-M0+) those entries are reserved.',
        svg: `<svg viewBox="0 0 640 330" xmlns="http://www.w3.org/2000/svg" font-family="monospace" font-size="12" fill="currentColor">
  <g fill="none" stroke="currentColor" stroke-width="1.2">
    <rect x="150" y="20" width="260" height="290"/>
    <path d="M150 49 h260 M150 78 h260 M150 107 h260 M150 136 h260 M150 165 h260 M150 194 h260 M150 223 h260 M150 252 h260 M150 281 h260"/>
    <rect x="150" y="20" width="260" height="29" stroke="var(--sig1)" stroke-width="2"/>
    <rect x="150" y="49" width="260" height="29" stroke="var(--sig2)" stroke-width="2"/>
  </g>
  <text x="30" y="39">base + 0x00</text><text x="162" y="39">initial main stack pointer</text><text x="424" y="39" fill="var(--sig1)">loaded into SP at reset</text>
  <text x="30" y="68">base + 0x04</text><text x="162" y="68">1  Reset handler</text><text x="424" y="68" fill="var(--sig2)">loaded into PC at reset</text>
  <text x="30" y="97">base + 0x08</text><text x="162" y="97">2  NMI</text>
  <text x="30" y="126">base + 0x0C</text><text x="162" y="126">3  HardFault</text>
  <text x="30" y="155">base + 0x10</text><text x="162" y="155">4  MemManage</text><text x="424" y="155">ARMv7-M only</text>
  <text x="30" y="184">base + 0x14</text><text x="162" y="184">5  BusFault</text><text x="424" y="184">ARMv7-M only</text>
  <text x="30" y="213">base + 0x18</text><text x="162" y="213">6  UsageFault</text><text x="424" y="213">ARMv7-M only</text>
  <text x="30" y="242">base + 0x2C</text><text x="162" y="242">11 SVCall</text>
  <text x="30" y="271">+0x38, +0x3C</text><text x="162" y="271">14 PendSV, 15 SysTick</text>
  <text x="30" y="300">base + 0x40 ...</text><text x="162" y="300">16+ peripheral IRQs</text><text x="424" y="300">chip-specific</text>
</svg>` },

      `Every handler address in a Cortex-M vector table has **bit 0 set** (it is odd). That bit marks Thumb state, the
only instruction state a Cortex-M has; the real address of the code is the value with bit 0 cleared. A table of
even handler addresses is not a valid image.

Where the table sits is chip-specific. On the MSPM0L2228, flash starts at \`0x0000_0000\`, so the table of whatever is
at the start of flash is the one the core uses at reset. On the MAX78000, address \`0x0000_0000\` is ROM; the ROM code
runs first and then transfers control to the image in flash at \`0x1000_0000\`. On cores that have it (the M4, and
this M0+ too), a register called **VTOR** holds the table's base address so that a bootloader can hand over to an
application whose table is elsewhere.

### Stages

Almost every modern MCU boots in stages, each loading or validating the next:

1. **Mask ROM (first stage).** Written at the factory, cannot be changed. Reads configuration (strapping pins,
   eFuses or a configuration flash region), decides between "boot from flash" and "serial download mode", and on
   chips with secure boot, verifies the next stage. Because it is immutable it is the **root of trust**: every
   later check relies on this one being correct.
2. **Second-stage bootloader.** In flash, replaceable, written by the vendor or by you. Chooses an application
   image (factory, or one of two update slots), may verify its signature, may decrypt, and jumps to it.
3. **Startup code** (\`Reset_Handler\`, \`crt0\`). Part of your application. Initialises RAM for C (next lesson), sets up
   the clock, calls \`main()\`.

### The three platforms

**ESP32 family.** The ROM samples the strapping pins at reset (on the original ESP32: GPIO0, 2, 5, 12, 15) to choose
between normal boot and serial download mode. In normal boot it loads the second-stage bootloader from a fixed flash
offset: **\`0x1000\` on the original ESP32, \`0x0\` on ESP32-S3, C3 and C6**. The bootloader reads the **partition table**
(default offset \`0x8000\`), selects an application partition (the factory app is at \`0x10000\` by default), maps its
segments through the flash cache, and jumps to it. With Secure Boot V2 the ROM verifies the bootloader's signature
and the bootloader verifies the application's.

**MAX78000.** ROM at \`0x0000_0000\` runs first, then the image at the start of flash (\`0x1000_0000\`). In the 2024
and 2025 eCTF, a MITRE-supplied bootloader occupied the first \`0xE000\` bytes of flash and team firmware was linked at
\`0x1000_E000\`. The ROM's own bootloader features and options are described in the device user guide; check there
rather than assuming.

**MSPM0L2228.** Boot behaviour is governed by the **NONMAIN** configuration memory (\`BCR_CONFIG\` at \`0x41C0_0000\`,
\`BSL_CONFIG\` at \`0x41C0_0100\`): debug access policy, whether the ROM bootstrap loader may be invoked, mass-erase
policy, and an optional application integrity check. The boot configuration routine (BCR) is the first code after
reset; it applies the debug policy and static write protection, can check application flash with a 32-bit CRC,
and can start the ROM bootstrap loader (BSL), which talks over UART or I2C and always requires a 256-bit password
(TRM SLAU847F, sections 1.4.2 and 1.4.3). A CRC detects corruption; it is not an authenticity check. TI also
supplies an optional MCUboot-based secure-boot stage (Customer Secure Code). In the 2026 eCTF layout a bootloader
occupies \`0x0000_0000\`–\`0x0000_5FFF\` and team firmware is linked at \`0x0000_6000\`. Development boards arrive
without that bootloader: you flash MITRE's insecure bootloader with TI UniFlash through an XDS110 probe, put the
board in update mode by holding S2 (PB21) during reset (LED D1 on PB14 flashes red), and load firmware with the eCTF
tools (\`uvx ectf hw <port> flash ...\`), per the 2026 rules.`,

      { t: 'widget', name: 'boot-sequence', props: { platform: 'generic' }, title: 'A generic boot chain',
        caption: 'At each stage ask: what does this stage trust, and who could have changed it?' },
      { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' }, title: 'ESP32 boot' },
      { t: 'widget', name: 'boot-sequence', props: { platform: 'max78000' }, title: 'MAX78000 boot' },
      { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, title: 'MSPM0L2228 boot' },

      `## Worked example: decode the first eight bytes of an image

A hex dump of the start of a firmware binary built for the 2026 eCTF layout (linked at \`0x0000_6000\`, SRAM
\`0x2020_0000\`–\`0x2020_7FFF\`) begins:

\`\`\`
00 80 20 20  C1 60 00 00  ...
\`\`\`

Cortex-M is little-endian, so the first word is \`0x2020_8000\` and the second is \`0x0000_60C1\`.

- \`0x2020_8000\` is the initial stack pointer: exactly one past the end of the 32 KB SRAM. The stack is "full
  descending": the first push decrements SP to \`0x2020_7FFC\` and writes there. Plausible.
- \`0x0000_60C1\` is the reset handler. Bit 0 is set (Thumb). The code is at \`0x0000_60C0\`, which is inside the team
  flash region that starts at \`0x6000\`. Plausible.

If the second word had been \`0x0000_00C1\`, the image was linked for address 0 and would jump into the bootloader's
region when started from \`0x6000\`: the classic "application linked at the wrong address" failure.`,

      { t: 'predict',
        q: 'A bootloader at the start of flash jumps to an application at `0x0000_6000` by loading the application\'s reset handler address and branching to it. It does not change VTOR or the stack pointer. The application runs, then enables a timer interrupt. What happens on the first timer interrupt?',
        choices: [
          { t: 'The application\'s timer handler runs, because that image is now executing', why: 'The CPU finds handlers through the vector table whose base it currently knows. Which table is that?' },
          { t: 'The bootloader\'s handler for that interrupt number runs, or a fault occurs', ok: true, why: 'The core still indexes the bootloader\'s vector table, so the application\'s handlers are never looked up.' },
          { t: 'Nothing: interrupts cannot occur after a bootloader jump', why: 'Nothing about a branch disables interrupts; the request is taken as normal.' },
        ],
        reveal: 'A correct handover does four things: disable and clear interrupts the bootloader used, set VTOR to the application\'s table, load the main stack pointer from the application\'s first word, then jump to its second word. Missing the VTOR step produces an application that works perfectly until its first interrupt.' },

      { t: 'callout', kind: 'mistake', title: 'Leaving a strapping pin to chance',
        md: 'A strapping pin that floats, or that is pulled the wrong way by an attached circuit (an LED, a level shifter, a sensor\'s output), makes the ROM choose download mode or the wrong flash voltage on some power-ups and not others. Give every strapping pin a defined level with a resistor and check that nothing else on the net overrides it during reset.' },

      { t: 'callout', kind: 'security', title: 'The boot chain is the security chain',
        md: `Each stage decides whether to run the next. If any stage can be replaced by an attacker and the stage before it does not check, everything after it is under the attacker's control. Three questions for every stage: **Who can write it? Who verifies it, with which key? Where is that key, and who can change that?** The chain must end in something immutable (ROM plus eFuses or locked configuration). The secure-boot lessons and the \`secure-boot-chain\` tool in the security section build directly on this. Also remember the ROM's serial download mode and debug port are entry points too; on a product they must be disabled or authenticated, and you verify that by trying them.` },

      { t: 'callout', kind: 'decision', title: 'Do you need your own bootloader?',
        md: 'Write one only if you need something the ROM and vendor bootloader do not give: field updates over your own transport, image verification with your own keys, A/B slots with rollback. A bootloader is the one piece of firmware you cannot easily update, so it must be small, have no unbounded loops, and be reviewed more carefully than anything else you ship.' },

      { t: 'exercise',
        prompt: `An image for the MAX78000 linked at the start of flash (\`0x1000_0000\`, SRAM \`0x2000_0000\` with length \`0x20000\`) begins with these eight bytes:

\`\`\`
00 00 02 20  39 01 00 10
\`\`\`

What is the address of the first instruction the image executes? Answer in hex.`,
        hints: [
          'Which of the two words does the core load into PC at reset, and in what byte order are the words stored?',
          'Assemble each group of four bytes as a little-endian 32-bit word: the last byte of the group is the most significant.',
          'The second word is 0x10000139. What does bit 0 mean in a Cortex-M vector, and is it part of the address?',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?1000_?0138h?\\s*$'], nudge: 'Clear the Thumb bit of the reset vector.' },
        solution: `First word: \`0x2002_0000\`, the initial stack pointer (top of the 128 KB SRAM). Second word: \`0x1000_0139\`. Clearing bit 0 (the Thumb marker) gives the address of the first instruction: **\`0x1000_0138\`**.` },

      `## Harder application

A board based on an original ESP32 module prints nothing from the application, but a terminal on UART0 at the ROM's
baud rate shows a short message after every reset. Write a decision procedure with at most five checks that separates:
(a) strapping pin holding the chip in download mode, (b) bootloader missing or at the wrong offset, (c) partition
table missing, (d) application image invalid. For each, say which stage emits the evidence. (The ROM message states
the boot mode: that settles (a). If the ROM reports a flash read or checksum failure, suspect (b): on this chip the
bootloader must be at \`0x1000\`, not \`0x0\`. If the second-stage bootloader's own log appears and then complains about
partitions, (c). If it lists partitions and then rejects the image, (d).)`,

      { t: 'refs', items: [
        { title: 'ESP-IDF: partition tables', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/partition-tables.rst' },
        { title: 'ESP-IDF: Secure Boot V2', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst' },
        { title: 'TI MSPM0 SDK: boot configuration options for the L2228', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h' },
        { title: '2026 eCTF reference design linker script', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/firmware.ld' },
        { title: 'MITRE eCTF 2026 rules: bootloader (UniFlash, update mode, eCTF tools)', url: 'https://rules.ectf.mitre.org/2026/system/bootloader.html' },
        { title: 'TI: MSPM0 L-Series Technical Reference Manual (SLAU847)', url: 'https://www.ti.com/lit/pdf/slau847', note: 'Sections 1.4.2 (BCR, NONMAIN security settings) and 1.4.3 (BSL).' },
      ] },
    ],
    quiz: [
      { q: 'What are the first two things a Cortex-M core does when reset is released?', kind: 'arch', choices: [
        { t: 'Loads SP from the first word of the vector table and PC from the second', ok: true, why: 'Both loads are done by hardware before any instruction executes.' },
        { t: 'Executes the instruction at address 0, which sets up the stack', why: 'That is how some other architectures start; on this one, address 0 of the table holds data, not an instruction.' },
        { t: 'Copies initialised data from flash to RAM', why: 'That is done later by startup code, which is software in your image.' },
      ] },
      { q: 'On an original ESP32, the second-stage bootloader was flashed at offset `0x0`. What will happen?', kind: 'arch', choices: [
        { t: 'The ROM reads 0x1000, finds no valid image, and boot fails', ok: true, why: 'The offset is fixed by the ROM and differs between the original ESP32 and the S3/C3/C6.' },
        { t: 'It boots normally, because the ROM searches the flash for a bootloader header', why: 'The ROM does not search; it reads from one fixed offset per chip.' },
        { t: 'The partition table is used instead to locate it', why: 'The partition table is read by the second-stage bootloader, which has not been loaded yet.' },
      ] },
      { q: 'Firmware reads the reset-cause register at boot and finds "brown-out". What should you investigate?', kind: 'circuit', choices: [
        { t: 'The power supply: regulator, load transients, battery', ok: true, why: 'A brown-out reset means the supply voltage fell below the detector threshold.' },
        { t: 'An infinite loop in the main code that stopped the watchdog being fed', why: 'A hang leads to a watchdog reset, which is reported as a different cause.' },
        { t: 'A null-pointer dereference', why: 'A bad pointer produces a fault or lockup reset, not a supply-voltage event.' },
      ] },
      { q: 'Why is the mask ROM called the root of trust?', kind: 'security', choices: [
        { t: 'It cannot be modified, and every later check depends on it', ok: true, why: 'Trust has to start from something an attacker cannot replace.' },
        { t: 'It contains the application\'s encryption keys, which never leave the chip', why: 'ROM is identical on every chip of that type, so per-device secrets cannot live there.' },
        { t: 'It runs at the highest clock speed', why: 'Trust is about who can alter the code, not how fast it runs.' },
      ] },
      { q: 'A vector table entry reads `0x0800_0200`. On a Cortex-M this is:', kind: 'arch', choices: [
        { t: 'Invalid as a handler address, because bit 0 is clear', ok: true, why: 'Bit 0 must be 1 to indicate Thumb state; branching to an even address through a vector causes a fault.' },
        { t: 'A valid entry for a handler whose code is located at 0x0800_0200', why: 'The code might be there, but the stored vector must carry the state bit, so the entry would be the odd value one higher.' },
        { t: 'The initial stack pointer', why: 'Only the very first entry is a stack pointer, and it would point into RAM, not flash.' },
      ] },
      { q: 'What must a bootloader do before jumping to an application whose vector table is not at the default location (on a core that has VTOR)?', kind: 'code', choices: [
        { t: 'Set VTOR to the application\'s table and load its initial stack pointer', ok: true, why: 'Otherwise exceptions keep using the bootloader\'s table, and the application starts on the bootloader\'s stack.' },
        { t: 'Erase its own vector table so the application\'s is used instead', why: 'Erasing the bootloader would brick the device at the next reset, when the core reads that table again.' },
        { t: 'Copy the application to address 0', why: 'Applications are linked for their own address and execute in place; copying would break every absolute address in them.' },
      ] },
    ],
  },

  // ───────────────────────────────────────────────────────────────── 11
  {
    id: 'mcu-memory-map-linker',
    title: 'Memory maps and linker scripts',
    minutes: 55,
    summary: 'How the build decides which address every function and variable gets, why initialised variables exist twice, and how to read the map file that records it all.',
    skills: ['mcu-sk-linker'],
    blocks: [
      `## The problem

Three bug reports:

1. "The build succeeds, but the board dies after I added a 20 KB lookup table."
2. "My global \`int threshold = 50;\` reads as garbage at start-up; \`static int count;\` is fine."
3. "The same source runs on the MAX78000 but hard-faults before \`main\` on the MSPM0, after I reused the MAX78000 linker script."

None is a C bug. All three are answered by one file you have probably never opened: the linker script.`,

      `## Theory

### The memory map

A 32-bit CPU can address 4 GB. A microcontroller populates a tiny part of it, at addresses chosen by the chip
designer. The **memory map** is the table of what lives where.`,

      { t: 'ascii', caption: 'Program-relevant regions of the three course platforms (from the vendor SDK headers and linker files listed in the references)',
        text: R`                     MAX78000                MSPM0L2228              ESP32 (original)
  ROM                0x0000_0000             (boot ROM, see TRM)     0x4000_0000 mask ROM
  Program flash      0x1000_0000  512 KB     0x0000_0000  256 KB     external SPI flash, cache-mapped:
                     (8 KB pages)                                      0x3F40_0000 read-only data (DROM)
                                                                       0x400D_0000 code (IROM)
  SRAM               0x2000_0000  128 KB     0x2020_0000  32 KB (*)  0x3FFA_E000 data RAM (DRAM)
                                                                     0x4008_0000 instruction RAM (IRAM)
  Peripherals        0x4000_0000 ...         0x4000_0000 ...         0x3FF0_0000 ...
  Config memory      -                       0x41C0_0000 NONMAIN     eFuse block (via registers)

  (*) One 32 KB memory seen at three addresses (TI datasheet SLASF94A, Table 8-4):
      0x2000_0000 ECC-checked, 0x2010_0000 parity-checked, 0x2020_0000 unchecked.
      TI's linker file and the 2026 eCTF reference design use 0x2020_0000.` },

      { t: 'widget', name: 'memory-map', props: { platform: 'max78000' }, title: 'MAX78000 address space',
        caption: 'Take the "where does this address live?" quiz until you can place an address by its top hex digits alone.' },
      { t: 'widget', name: 'memory-map', props: { platform: 'mspm0l2228' }, title: 'MSPM0L2228 address space',
        caption: 'Note the SRAM row. The datasheet memory map (SLASF94A, Table 8-4) shows the same 32 KB at three addresses: 0x2000_0000 (ECC-checked), 0x2010_0000 (parity-checked) and 0x2020_0000 (unchecked). TI\'s linker file and the 2026 eCTF reference design choose 0x2020_0000. The explorer may draw only that view. Do not carry a RAM address or length over from another chip: read the map, then see which view the linker script uses.' },

      `### Sections

The compiler does not choose addresses. It sorts everything it emits into named **sections**:

| Section | Contents | Example | Needs flash? | Needs RAM? |
|---|---|---|---|---|
| \`.text\` | Machine code | function bodies | yes | no |
| \`.rodata\` | Constants | \`const\` tables, string literals | yes | no |
| \`.data\` | Variables with a non-zero initial value | \`int threshold = 50;\` | yes (the initial values) | yes (the live variable) |
| \`.bss\` | Variables that start at zero | \`static int count;\`, \`int buf[256];\` | no | yes |
| vectors | The vector table | array of handler addresses | yes | no |
| stack, heap | Reserved space, no contents | — | no | yes |

### The linker script

The **linker** collects the sections from every object file and assigns addresses according to a **linker
script**, which has two parts:

- \`MEMORY\`: the regions that exist, with origin, length and permissions. This is the chip's memory map written
  down for the tool.
- \`SECTIONS\`: which input sections go into which region, in which order, and which symbols mark the boundaries.`,

      { t: 'code', lang: 'ld', status: 'reviewed',
        caption: 'MEMORY for a MAX78000 application in the 2024/2025 eCTF layout. Origins and lengths are those in the reference designs\' firmware.ld; comments are added here.',
        code: R`MEMORY {
    BOOTLOADER  (rx) : ORIGIN = 0x10000000, LENGTH = 0x0000E000  /* MITRE bootloader   */
    FLASH       (rx) : ORIGIN = 0x1000E000, LENGTH = 0x00038000  /* team firmware      */
    RESERVED    (rw) : ORIGIN = 0x10046000, LENGTH = 0x00038000
    ROM_BL_PAGE (rw) : ORIGIN = 0x1007E000, LENGTH = 0x00002000
    SRAM       (rwx) : ORIGIN = 0x20000000, LENGTH = 0x00020000  /* 128 KB             */
}`,
        explain: [
          { lines: '2-3', md: 'The application does not start at the beginning of flash. Its vector table will be at \`0x1000E000\`, and every absolute address in the image is computed for that origin.' },
          { lines: '3', md: '\`0x38000\` = 224 KB available to the team, out of the chip\'s 512 KB.' },
          { lines: '6', md: 'All of \`.data\`, \`.bss\`, heap and stack must fit in \`0x20000\` bytes.' },
        ] },

      { t: 'code', lang: 'ld', status: 'reviewed',
        caption: 'The same idea on the MSPM0L2228 in the 2026 eCTF layout (values from the reference design\'s firmware.ld; written here in GNU ld form for comparison; open the real file for its exact syntax). One difference from the rules: firmware.ld gives APP2 a length of 0x5C00, but the 2026 detailed specifications give APP2 0x5800 and reserve the last page (0x3FC00, length 0x400) for the bootloader. The rules are the specification. SRAM here is the unchecked view of the chip\'s one 32 KB memory, which the datasheet also maps at 0x20000000 (ECC-checked) and 0x20100000 (parity-checked).',
        code: R`MEMORY {
    BOOTLOADER (rx) : ORIGIN = 0x00000000, LENGTH = 0x00006000  /* unusable by teams  */
    FLASH      (rx) : ORIGIN = 0x00006000, LENGTH = 0x00034000  /* team firmware      */
    FAT        (rw) : ORIGIN = 0x0003A000, LENGTH = 0x00000400  /* file allocation table, fixed by the spec */
    APP2       (rw) : ORIGIN = 0x0003A400, LENGTH = 0x00005C00  /* rules: 0x5800, then 0x3FC00 reserved */
    SRAM      (rwx) : ORIGIN = 0x20200000, LENGTH = 0x00008000  /* 32 KB, unchecked view */
    /* BCR_CONFIG at 0x41C00000 and BSL_CONFIG at 0x41C00100: NONMAIN boot configuration */
}` },

      { t: 'code', lang: 'ld', status: 'pseudo',
        caption: 'A minimal SECTIONS block for a Cortex-M (GNU ld). Real scripts add C++ and library sections.',
        code: R`SECTIONS {
    .text : {
        KEEP(*(.isr_vector))        /* vector table first, never garbage-collected */
        *(.text*)
        *(.rodata*)
        _etext = .;
    } > FLASH

    .data : {
        _data = .;
        *(.data*)
        . = ALIGN(4);
        _edata = .;
    } > SRAM AT > FLASH             /* runs in SRAM (VMA), stored in FLASH (LMA) */
    _data_load = LOADADDR(.data);

    .bss (NOLOAD) : {
        _bss = .;
        *(.bss*)
        *(COMMON)
        . = ALIGN(4);
        _ebss = .;
    } > SRAM

    _stack_top = ORIGIN(SRAM) + LENGTH(SRAM);
}`,
        explain: [
          { lines: '3', md: '\`KEEP\` stops the linker discarding the table as "unreferenced". Nothing in C refers to it; only the CPU does.' },
          { lines: '7', md: '\`> FLASH\` places the output section in the FLASH region. The location counter \`.\` advances as input is added.' },
          { lines: '9-14', md: 'Two addresses for one section. The **VMA** (virtual, or run-time, address) is in SRAM: that is where code expects the variables. The **LMA** (load address) is in flash: that is where the initial values are stored in the image.' },
          { lines: '12', md: 'Round the end of the section up to a multiple of 4, because the startup loop below copies whole 32-bit words.' },
          { lines: '15', md: 'A symbol holding the LMA, so startup code knows where to copy from.' },
          { lines: '17', md: '\`NOLOAD\`: the section occupies address space but contributes no bytes to the image. Zeros are not stored in flash.' },
          { lines: '25', md: 'The initial stack pointer: the first word of the vector table refers to this symbol.' },
        ] },

      `### Startup code: making RAM match what C promises

C guarantees that \`threshold\` is 50 and \`count\` is 0 when \`main\` starts. After power-on, RAM is undefined. The
reset handler bridges the gap using the linker's symbols:`,

      { t: 'code', lang: 'c', status: 'reviewed', caption: 'The essential work of a reset handler (vendor startup files do the same thing, often in assembly)',
        code: R`#include <stdint.h>

extern uint32_t _data_load, _data, _edata, _bss, _ebss;
int main(void);

void Reset_Handler(void)
{
    uint32_t *src = &_data_load;
    uint32_t *dst = &_data;

    while (dst < &_edata) {
        *dst++ = *src++;            /* copy .data initial values, flash -> RAM */
    }
    for (dst = &_bss; dst < &_ebss; dst++) {
        *dst = 0u;                  /* zero .bss */
    }
    main();
    for (;;) { }                    /* main must not return */
}`,
        explain: [
          { lines: '3', md: 'These are not variables. They are symbols whose *addresses* the linker defined; only \`&symbol\` is meaningful.' },
          { lines: '11-13', md: 'Load from the LMA in flash, store to the VMA in RAM. This is why every byte of \`.data\` costs both flash and RAM.' },
          { lines: '14-16', md: 'Zeroing costs time proportional to the size of \`.bss\` but no flash.' },
          { lines: '18', md: 'There is nothing to return to. If \`main\` returns, stay here (or reset).' },
        ] },

      `### The copy, one variable at a time

Take the image described by the map file further down: \`.text\` ends at \`0x1001_3A34\`, so that is where the linker
puts the stored copy of \`.data\`. \`int threshold = 50;\` is the first variable in \`.data\`, and \`count\` is somewhere
in \`.bss\`. Follow them from the build to \`main\`:

\`\`\`
                               flash 0x1001_3A34 (LMA)    RAM 0x2000_0000 (VMA)     RAM, count in .bss
 after linking / flashing      32 00 00 00                (no power)                (no power)
 power-on, before any code     32 00 00 00                ?? ?? ?? ??               ?? ?? ?? ??
 after the .data copy loop     32 00 00 00                32 00 00 00               ?? ?? ?? ??
 after the .bss zero loop      32 00 00 00                32 00 00 00               00 00 00 00
 main runs: threshold = 75     32 00 00 00                4B 00 00 00               00 00 00 00
 reset (power stays on)        32 00 00 00                4B 00 00 00  (stale)      whatever it held
 after startup code again      32 00 00 00                32 00 00 00               00 00 00 00
\`\`\`

Three things to take from the table:

- Every instruction that uses \`threshold\` was compiled with the address \`0x2000_0000\` (the VMA). No code except
  the copy loop ever refers to \`0x1001_3A34\` (the LMA).
- The flash copy never changes at run time. It is the "factory setting" the variable returns to at every start.
- \`count\` has no bytes in the image at all. It is zero only because a loop wrote zeros over whatever was in RAM.

A common wrong picture is that initialised variables "live in flash" or that the linker "puts 50 into RAM". The
linker cannot put anything into RAM: RAM is empty when power arrives. All it can do is store the value in flash
and leave symbols behind so that startup code can do the copying.

Now the three bug reports:

1. The table was not \`const\`, so it went to \`.data\`: 20 KB of RAM as well as 20 KB of flash. Either the link failed
   with "region SRAM overflowed", or it fit and left too little room for the stack, which then grew down into \`.bss\`.
2. The \`.data\` copy is not happening (custom startup code, wrong symbol names, or an image flashed without its
   \`.data\` load region). \`.bss\` variables look fine because the zeroing loop still runs, or because that RAM
   happened to hold zeros anyway.
3. The image was linked with the MAX78000's RAM region: \`0x2000_0000\`, 128 KB, so the initial stack pointer is
   \`0x2002_0000\`. The MSPM0L2228 has 32 KB of SRAM. A stack pointer 128 KB above the RAM base is outside a 32 KB
   memory wherever it is mapped, so the first push faults. Note what did *not* cause the fault: the base address.
   The MSPM0L2228 datasheet's memory map (SLASF94A, Table 8-4) shows the same 32 KB at three addresses with
   different error checking: \`0x2000_0000\` (ECC-checked), \`0x2010_0000\` (parity-checked) and \`0x2020_0000\`
   (unchecked). TI's linker file and the 2026 eCTF reference design use the \`0x2020_0000\` view, but
   \`0x2000_0000\`–\`0x2000_7FFF\` is valid RAM on this chip too. The borrowed script was wrong in its *length* (and in
   its flash origin, \`0x1000_0000\`, where this chip has no flash). Read the memory map before you decide which
   line of a borrowed script is the bug.

### Reading a map file

Ask the linker for a map (\`-Wl,-Map=firmware.map\` with GCC). It lists every output section with its address and
size, and every input object's contribution.`,

      { t: 'ascii', caption: 'Excerpt of a GNU ld map file (illustrative values for an image linked at 0x1000E000)',
        text: R`.text           0x1000e000     0x5a34
 *(.isr_vector)
 .isr_vector    0x1000e000      0x1b0 build/startup_max78000.o
 *(.text*)
 .text.main     0x1000e1b0       0x9c build/main.o
 .text.uart_tx  0x1000e24c       0x48 build/uart.o
 ...
 .rodata.sine   0x10011a34     0x2000 build/tables.o
                0x10013a34                _etext = .

.data           0x20000000      0x124 load address 0x10013a34
 .data.threshold
                0x20000000        0x4 build/main.o
 ...
.bss            0x20000124     0x1e40
 .bss.rx_buf    0x20000124      0x400 build/uart.o` },

      `How to read it:

- **First column**: section name. **Second**: address (VMA). **Third**: size in bytes. **Fourth**: the object file.
- \`.data\` shows both addresses: VMA \`0x20000000\` and "load address" in flash.
- Flash used = size of \`.text\` (which here includes \`.rodata\`) + size of \`.data\` = \`0x5a34 + 0x124\`.
- Static RAM used = \`.data\` + \`.bss\` = \`0x124 + 0x1e40\`. What remains of SRAM is for heap and stack.
- To find what is eating flash, sort the input sections by size. Here \`.rodata.sine\` is 8 KB.`,

      { t: 'predict',
        q: 'A firmware has `static uint8_t log_buf[16384];` (never given an initial value) and `static uint8_t lut[16384] = {1, 2, 3};`. How much flash do the two arrays use, in total?',
        choices: [
          { t: '32 KB: both arrays are stored in the image', why: 'One of these arrays has no contents worth storing. Which section does an uninitialised static go in?' },
          { t: '16 KB: only the initialised array is stored', ok: true, why: 'log_buf is .bss (no bytes in the image); lut is .data, whose full 16 KB of initial values, mostly zeros, sit in flash.' },
          { t: '3 bytes: only the non-zero initialisers are stored', why: 'The linker stores the whole object; it does not compress the trailing zeros of an initialised array.' },
        ],
        reveal: 'An array with even one non-zero initialiser goes entirely into .data. If the table never changes, make it \`const\`: it then lives in .rodata, costs 16 KB of flash and no RAM. If it does change but starts as mostly zero, leave it uninitialised and fill the three entries in code.' },

      { t: 'callout', kind: 'mistake', title: 'Forgetting const on lookup tables',
        md: 'A non-const table is copied to RAM at every boot and stays there. On a 32 KB part, a 4 KB table of font data or CRC constants that was meant to be read-only is an eighth of all RAM. Check the map file: read-only tables belong under \`.rodata\`.' },

      { t: 'callout', kind: 'decision', title: 'Why keep initial values in flash and copy them, instead of running variables from flash?',
        md: 'Variables must be writable at bus speed, and flash is not. The alternatives are worse: initialising each variable with generated code costs more flash than a block copy, and requiring the programmer to initialise everything by hand contradicts the language. A single copy loop driven by linker symbols is the cheapest way to deliver C\'s guarantee.' },

      { t: 'callout', kind: 'security', title: 'The linker script decides what an overflow hits',
        md: 'Section order in RAM determines what lies next to what. A buffer in \`.bss\` that overflows writes into whichever variables the linker placed after it, perhaps a function pointer or an authentication flag. The map file tells you, and tells an attacker with the same build. It is also where you confirm that secrets are not in a section that gets dumped or logged, and that code you believe is read-only is really in a non-writable region.' },

      { t: 'exercise',
        prompt: `A map file for the MSPM0L2228 reports: \`.text\` size \`0x7C00\` (including \`.rodata\`), \`.data\` size \`0x200\`, \`.bss\` size \`0x1E00\`. SRAM is \`0x8000\` bytes and the stack is at the top. How many bytes of SRAM remain for heap and stack together? Answer in decimal.`,
        hints: [
          'For each of the three sections, ask: does it occupy RAM at run time, flash, or both?',
          'RAM used by static data is .data + .bss. .text does not use RAM.',
          'Add the two sizes in hex, subtract the sum from 0x8000, then convert to decimal.',
        ],
        answer: { type: 'number', value: 24576, tol: 0, unit: 'bytes' },
        solution: `Static RAM = \`0x200 + 0x1E00 = 0x2000\` (8192 bytes). Remaining = \`0x8000 − 0x2000 = 0x6000\` = **24,576 bytes**. Flash used is \`0x7C00 + 0x200 = 0x7E00\` (32,256 bytes), because \`.data\`'s initial values are stored in flash too.` },

      `## Harder application

You are porting firmware from the 2025 eCTF layout (MAX78000, application at \`0x1000_E000\`, SRAM \`0x2000_0000\`,
128 KB) to the 2026 layout (MSPM0L2228, application at \`0x0000_6000\`, SRAM linked at \`0x2020_0000\`, 32 KB). List every place
an address or size assumption could be hiding: the linker script, hard-coded flash addresses for stored data, the flash
page size used by the storage code (8 KB versus 1 KB), stack size, any buffer sized for 128 KB of RAM, and
alignment or instruction-set assumptions from moving from a Cortex-M4F to a Cortex-M0+. Which of these does the
compiler or linker catch for you, and which fail silently at run time?`,

      { t: 'refs', items: [
        { title: 'MSDK linker script for the MAX78000', url: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Source/GCC/max78000.ld' },
        { title: 'TI linker command file for the MSPM0L2228', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/linker_files/ticlang/mspm0l2228.cmd' },
        { title: '2025 eCTF reference design linker script (MAX78000)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/firmware.ld' },
        { title: 'TI: MSPM0L222x, MSPM0L122x datasheet (SLASF94A)', url: 'https://www.ti.com/lit/ds/symlink/mspm0l2228.pdf', note: 'Table 8-4 is the memory map: the three SRAM views and the two flash banks.' },
        { title: 'MITRE eCTF 2026 rules: detailed specifications (flash layout)', url: 'https://rules.ectf.mitre.org/2026/specs/detailed_specs.html' },
        { title: 'ESP32 address ranges (soc.h)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/components/soc/esp32/include/soc/soc.h' },
      ] },
    ],
    quiz: [
      { q: 'Where does `static const uint16_t table[4] = {1, 2, 3, 4};` end up?', kind: 'code', choices: [
        { t: 'In .rodata, in flash only', ok: true, why: 'It is constant, so it can be read in place from non-volatile memory and needs no RAM copy.' },
        { t: 'In .data: stored in flash and copied to RAM', why: 'That is the treatment for writable initialised variables; this one is declared read-only.' },
        { t: 'In .bss', why: 'That section holds only objects whose initial value is all zeros.' },
      ] },
      { q: 'What do LMA and VMA mean for the .data section?', kind: 'arch', choices: [
        { t: 'LMA: where the initial values are stored. VMA: where the variables live at run time', ok: true, why: 'Startup code copies from the first to the second before main.' },
        { t: 'LMA is the address on the host PC; VMA is the address on the target', why: 'Both are target addresses; the host is not involved in either.' },
        { t: 'They are the start and end addresses of the section', why: 'Start and end are marked by separate boundary symbols; these two terms name two different placements of the same bytes.' },
      ] },
      { q: 'After custom startup code was introduced, initialised globals contain garbage while zero-initialised ones seem fine. What is the most likely defect?', kind: 'code', choices: [
        { t: 'The .data copy from flash to RAM is missing', ok: true, why: 'Without the copy, RAM holds whatever was there; zero-initialised variables may look right by luck or because the zeroing loop still runs.' },
        { t: 'The stack pointer is not initialised, so globals are read from the wrong place', why: 'A missing stack pointer would crash at the first function call rather than selectively affect initialised variables.' },
        { t: 'The variables are declared volatile', why: 'That qualifier affects how the compiler accesses them, not whether their initial values are loaded.' },
      ] },
      { q: 'Firmware is linked with the MAX78000\'s RAM region (`0x2000_0000`, 128 KB) and flashed onto an MSPM0L2228. That chip has 32 KB of SRAM, which its datasheet maps at `0x2000_0000` (ECC-checked), `0x2010_0000` (parity-checked) and `0x2020_0000` (unchecked; the view TI\'s linker file uses). Consider only the RAM side of the mistake. What happens at reset?', kind: 'arch', choices: [
        { t: 'The initial SP is not inside the chip\'s RAM, so the first push faults', ok: true, why: 'The stack starts at the top of the linked RAM region, 0x2002_0000. The base 0x2000_0000 is valid RAM on this chip, but only 0x8000 bytes of it exist, so an address 128 KB above the base is outside the memory.' },
        { t: 'It runs normally, because the chip relocates RAM references to its own base at load time', why: 'There is no automatic remapping; addresses in the image are used exactly as linked.' },
        { t: 'It runs until the program has used the first 32 KB of its RAM', why: 'The very first thing the core uses is the stack pointer, and that already points beyond 32 KB of RAM.' },
      ] },
      { q: 'In a GNU ld map file, which sum gives the flash consumed by an XIP firmware image?', kind: 'code', choices: [
        { t: '.text + .rodata + .data', ok: true, why: 'Code, constants and the initial values of initialised variables are all stored in flash.' },
        { t: '.text + .rodata + .data + .bss', why: 'The zero-initialised section occupies RAM only; no bytes for it are placed in the image.' },
        { t: '.text only', why: 'Constants and initial values also need non-volatile storage.' },
      ] },
      { q: 'An image has `.text` plus `.rodata` of 20 KB, `.data` of 1 KB and `.bss` of 8 KB. `objcopy -O binary` turns it into the raw file that is programmed into flash. Roughly how large is that file?', kind: 'code', choices: [
        { t: '21 KB', ok: true, why: 'Code, constants and the stored initial values of .data are bytes in the image. .bss is only an address range that startup code clears.' },
        { t: '29 KB', why: 'That includes 8 KB of zeros for the zero-initialised section. Check whether that section has a load address at all.' },
        { t: '20 KB', why: 'The initial values of the initialised variables have to be kept somewhere that survives power-off.' },
      ] },
      { q: 'Why is the vector table wrapped in `KEEP(...)` in a linker script?', kind: 'arch', choices: [
        { t: 'Nothing references it, so garbage collection would discard it', ok: true, why: 'Only the CPU hardware uses the table; the linker sees no symbol dependency on it.' },
        { t: 'To make it writable at run time for installing handlers', why: 'KEEP affects whether a section is retained, not its memory permissions.' },
        { t: 'To place it in RAM', why: 'Placement is decided by the region the output section is assigned to.' },
      ] },
    ],
  },
];
