// Debugging, part B: debug interfaces, probes, OpenOCD, GDB and post-mortem analysis.
// Nothing here was run on physical hardware. GDB output marked host-tested is from an x86-64 host session.

const skills = [
  { id: 'dbg-jtag-swd-id', name: 'Explain what JTAG and SWD carry, identify their pins and read an IDCODE or DPIDR', track: 'hardware' },
  { id: 'dbg-probe-choose', name: 'Choose and wire a debug probe for a given target', track: 'hardware' },
  { id: 'dbg-openocd-run', name: 'Start OpenOCD for a target and use it to halt, read memory and program flash', track: 'hardware' },
  { id: 'dbg-gdb-drive', name: 'Drive a remote GDB session with breakpoints, watchpoints, memory and register inspection', track: 'hardware' },
  { id: 'dbg-fault-decode', name: 'Trace a Cortex-M HardFault or an ESP32 panic back to a source line', track: 'hardware' },
];

const lessons = [
  // ------------------------------------------------------------------ 5
  {
    id: 'dbg-jtag-swd', title: 'Debug interfaces: JTAG and SWD', minutes: 50,
    summary: 'How a few pins give an outside tool control of the processor: the TAP, the DAP, and why two wires are enough.',
    skills: ['dbg-jtag-swd-id'],
    blocks: [
      `## The problem

Your firmware hangs before it initialises the UART. There is no log, because the code that would print it never ran. \`printf\` debugging needs working firmware to debug broken firmware.

What you want is a way to stop the processor from the outside, read its registers and memory, and step it, without any cooperation from the code. Every modern microcontroller has hardware for exactly this, reached through a handful of dedicated pins. The two interfaces you will meet are **JTAG** and **SWD**.`,
      `## Theory: JTAG

JTAG (IEEE 1149.1) was designed for testing soldered boards, and debug was added on top. It is a way of shifting bits through registers inside a chip.

| Signal | Direction (from the probe) | Role |
|---|---|---|
| **TCK** | out | Clock. Everything happens on its edges |
| **TMS** | out | Mode select: steers the state machine |
| **TDI** | out | Serial data into the chip |
| **TDO** | in | Serial data out of the chip |
| TRST (optional) | out | Resets the test logic only |
| nRESET / SRST (separate) | out | Resets the whole chip. Not part of JTAG proper, but usually on the same connector |

Inside the chip is a **TAP** (Test Access Port) controller: a 16-state machine clocked by TCK whose next state depends only on TMS. You do not need to memorise it. The shape is what matters:

- There is one **instruction register (IR)** and several **data registers (DR)**.
- The state machine has two near-identical columns, one for the IR and one for a DR, each with *capture → shift → update* states.
- In a shift state, each TCK moves one bit in from TDI and one bit out on TDO. The chip samples TMS and TDI on the **rising** edge of TCK and changes TDO on the **falling** edge, so the probe reads TDO on the following rising edge.
- The value in the IR selects **which** data register sits between TDI and TDO.
- Holding TMS high for five clocks reaches **Test-Logic-Reset** from any state, which is how a tool gets to a known starting point.

So every JTAG operation is: write an instruction into the IR, then shift a data register.`,
      { t: 'ascii', text: `                 Test-Logic-Reset  <-- TMS=1 held for 5 clocks, from anywhere
                        |
                  Run-Test/Idle
                   /          \\
        Select-DR-Scan       Select-IR-Scan
              |                    |
          Capture-DR           Capture-IR      load a value into the shift register
              |                    |
           Shift-DR             Shift-IR       one bit in (TDI), one bit out (TDO) per TCK
              |                    |
          Update-DR            Update-IR       the shifted value takes effect
     (pause/exit states omitted: 16 states in total)`, caption: 'The TAP state machine, reduced to its idea. TMS chooses the path; data moves only in the two shift states.' },
      `### IDCODE

One standard data register is **IDCODE**, 32 bits that identify the device. After a TAP reset the IR selects IDCODE (or the 1-bit BYPASS register if the device has none), so a tool can read IDs without knowing anything about the chip.

| Bits | Field |
|---|---|
| 31:28 | Version |
| 27:12 | Part number |
| 11:1 | Manufacturer, as a JEDEC JEP106 code |
| 0 | Always 1 |

Bit 0 being 1 is how a tool tells an IDCODE from a BYPASS register, which captures 0.

### Boundary scan

JTAG's original purpose is the **boundary-scan register**: one cell at every pin, chained together. Through it a tester can read and drive each pin of a soldered chip without running any code, which finds open joints and shorts in manufacturing. It also means that anyone with JTAG access can observe and drive a chip's pins, which matters for security.

### Daisy chains

Several TAPs can share TCK and TMS, with one device's TDO feeding the next device's TDI. The tool must know every device's IR length to address one of them while putting the others in BYPASS. This is why OpenOCD target files declare a TAP with its \`-irlen\`, and why a wrong chain description produces confusing errors.`,
      `## Theory: SWD

Arm's **Serial Wire Debug** gives the same access as JTAG over two pins:

- **SWCLK**: clock from the probe.
- **SWDIO**: one **bidirectional** data line.

Two wires suffice because JTAG's four are redundant for debug. JTAG needs TMS to walk a state machine and separate TDI/TDO to shift in both directions at once. SWD replaces the state machine with **packets**, and takes turns on one data wire:

1. The probe sends an 8-bit **request**: read or write, which register, parity.
2. The line **turns around** (the probe stops driving, the target starts).
3. The target answers with a 3-bit **ACK**: OK, WAIT or FAULT.
4. 32 bits of **data** plus a parity bit follow, driven by whichever side is the source.

On most Cortex-M chips the pins are shared: SWCLK is on the TCK pin and SWDIO on the TMS pin. A tool selects SWD by sending a defined switching sequence on those pins: a line reset (at least 50 clocks with SWDIO held high), then the 16-bit pattern \`0xE79E\` sent least-significant bit first, then another line reset.

### What is at the other end: the DAP

On Arm chips the debug pins do not connect to the processor directly. They connect to a **Debug Access Port (DAP)**:

- The **Debug Port (DP)** is the part that speaks JTAG or SWD. It has an identification register (\`DPIDR\`), a control/status register that powers up the debug logic, and a \`SELECT\` register that chooses an access port.
- One or more **Access Ports (APs)** hang off the DP. The important one is the **MEM-AP**, a bus master that can read and write the chip's memory map.

A MEM-AP has three registers that do nearly all the work: \`CSW\` (access size and options), \`TAR\` (the address) and \`DRW\` (the data). To read a word of memory the tool writes the address to TAR and reads DRW.

That is the whole trick. The processor's debug control registers are themselves **memory-mapped** (in the \`0xE000_Exxx\` region on Cortex-M), as are flash, RAM and every peripheral. A debugger that can read and write memory can therefore halt the core, read its registers, set breakpoints and program flash, all with ordinary memory accesses through the MEM-AP.`,
      { t: 'figure', caption: 'The path from your keyboard to a register. Each box only understands the layer next to it.',
        svg: `<svg viewBox="0 0 640 150" role="img" aria-label="GDB to OpenOCD to probe to debug port to access port to memory bus">
<g fill="none" stroke="var(--line)" stroke-width="1.5">
<rect x="6" y="50" width="76" height="46" rx="6"/><rect x="112" y="50" width="88" height="46" rx="6"/><rect x="230" y="50" width="76" height="46" rx="6"/>
<rect x="352" y="26" width="282" height="96" rx="8" stroke-dasharray="5 4"/>
<rect x="364" y="50" width="56" height="46" rx="6"/><rect x="446" y="50" width="76" height="46" rx="6"/><rect x="548" y="38" width="76" height="70" rx="6"/></g>
<g stroke="var(--sig1)" stroke-width="2" fill="none"><path d="M82 73h30M200 73h30M306 73h58M420 73h26M522 73h26"/></g>
<g fill="currentColor" font-size="12" text-anchor="middle" font-family="sans-serif">
<text x="44" y="77">GDB</text><text x="156" y="77">OpenOCD</text><text x="268" y="70">Debug</text><text x="268" y="85">probe</text>
<text x="392" y="77">DP</text><text x="484" y="70">MEM-AP</text><text x="484" y="85">TAR, DRW</text>
<text x="586" y="62">flash, RAM</text><text x="586" y="78">peripherals</text><text x="586" y="94">core debug</text>
<text x="97" y="64" font-size="10">TCP</text><text x="215" y="64" font-size="10">USB</text><text x="335" y="64" font-size="10">SWD/JTAG</text>
<text x="493" y="140" font-size="11">inside the microcontroller</text></g></svg>` },
      `### SWO

Cortex-M3 and larger cores can have a third, optional pin: **SWO** (Serial Wire Output), a one-way trace output. Firmware writes to the Instrumentation Trace Macrocell and the bytes come out on SWO with almost no timing cost, which makes a \`printf\` channel that needs no UART. SWO shares the pin used for JTAG's TDO, so it is available with SWD only. Cortex-M0 and M0+ cores do not have it.`,
      `## On real hardware

**Arm Cortex-M (MAX78000's Arm core, MSPM0L2228).** Debug is through a DAP. The MSPM0L2228 is a Cortex-M0+, and its debug port can be enabled, password-protected or disabled, and its SWD port switched off, through the device's NONMAIN boot configuration (see the BCR options in TI's SDK). The MAX78000 also contains a RISC-V core, which is debugged over a separate JTAG port according to the MSDK user guide.

**Original ESP32.** JTAG on GPIO12–GPIO15 (MTDI, MTCK, MTMS, MTDO in the chip's naming), which needs an external probe. Two of those pins are also strapping pins, so check the board's schematic before attaching anything that pulls them at reset.

**ESP32-S3, ESP32-C3, ESP32-C6.** A built-in **USB Serial/JTAG controller** provides a serial console and JTAG together over the chip's USB D+/D− pins (ESP32-C3 GPIO19/18, ESP32-S3 GPIO20/19, ESP32-C6 GPIO13/12). No probe is needed: a USB cable to those pins is the debug connection.

**Connectors.** Common ones are the 10-pin 1.27 mm Cortex Debug connector and the older 20-pin 2.54 mm header. Besides the signals they carry ground, reset and a **VTref** pin. VTref is an *input to the probe*: the target tells the probe what its logic level is. It does not power the target.`,
      `## Worked example: reading an ID

OpenOCD prints the ID it finds when it connects. Lines of these two forms are typical:

\`\`\`
Info : JTAG tap: chip.cpu tap/device found: 0x4ba00477 (mfg: 0x23b (ARM Ltd), part: 0xba00, ver: 0x4)
Info : SWD DPIDR 0x2ba01477
\`\`\`

Decode \`0x4BA00477\` by hand, as an IDCODE:

- Binary of the low 12 bits \`0x477\` = \`0100 0111 0111\`. Bit 0 is 1: this is an IDCODE.
- Bits 11:1 = \`0x477 >> 1\` = \`0x23B\`. That is Arm's JEP106 code.
- Bits 27:12 = \`0xBA00\`: the part number, here an Arm debug port.
- Bits 31:28 = \`0x4\`: version.

So the ID identifies the **debug port designed by Arm**, not the microcontroller vendor's chip. Many Cortex-M parts from different vendors show the same value. To identify the actual microcontroller, a tool goes on to read vendor ID registers and the ROM table through the MEM-AP.

The method, for any ID you meet:

1. Is bit 0 a 1? If not, it is not an IDCODE (a BYPASS register, or a dead line).
2. Take the last three hex digits (bits 11:0) and shift right once: that is the 11-bit manufacturer field.
3. The next four hex digits (bits 27:12) are the part number, and the top digit is the version.
4. Compare with what the tool's target file expects. OpenOCD warns when the ID it finds differs from the one in the configuration, which is the first sign that you are using the wrong target file or looking at a different chip.`,
      { t: 'predict', q: 'A JTAG chain has two devices. You connect a probe and OpenOCD reports an IDCODE of 0x00000000 for every scan, however many devices you declare. What is the most likely cause?',
        choices: [
          { t: 'Both devices have no IDCODE register', why: 'A device without IDCODE selects BYPASS, which contributes a single 0 bit, but a chip with a debug port almost always implements IDCODE. All zeros for the entire scan suggests no data is coming back at all.' },
          { t: 'TDO is not reaching the probe: stuck low, unconnected, or the target is unpowered', ok: true, why: 'All-zero data means the probe is sampling a line that never goes high. All ones (0xFFFFFFFF) is the same fault with the line floating or pulled high.' },
          { t: 'The clock is too slow', why: 'JTAG is fully static: it works at any clock rate below the maximum. Slowing down is a fix for marginal wiring, never a cause of failure.' },
        ],
        reveal: `All zeros or all ones is a wiring or power symptom, not a protocol one. Check target power and VTref, ground, and continuity of each signal. Then lower the adapter speed. Only after the electrical layer is good do chain descriptions and configuration files matter.` },
      { t: 'callout', kind: 'mistake', title: 'Reusing the debug pins as GPIO', md: `Debug pins can usually be reconfigured as ordinary GPIO, and firmware that does so early in \`main()\` cuts off the debugger a few microseconds after reset. The probe then "cannot connect" to a perfectly healthy chip. The way back in is **connect under reset**: the probe holds the reset line low, starts talking, and halts the core before the firmware has run. This needs the reset line wired to the probe, which is the reason to route it on your own boards.` },
      { t: 'callout', kind: 'decision', title: 'JTAG or SWD?', md: `Use **SWD** on Cortex-M when you can: two signal pins, SWO available, and every Cortex-M probe supports it. Use **JTAG** when the chip is not Arm (the original ESP32, RISC-V parts), when several devices share a chain, or when you need boundary scan. Many chips offer both on the same pins, and the tool's \`transport select\` decides.` },
      { t: 'exercise', prompt: `An OpenOCD log shows \`JTAG tap: x.cpu tap/device found: 0x120034e5\`. Extract the 11-bit manufacturer field (bits 11:1) and give it in hexadecimal.`,
        hints: [
          'Which hex digits of the ID hold bits 11 down to 0? Write those digits out in binary before doing anything else.',
          'Bit 0 is the always-1 marker, not part of the manufacturer code. Which operation removes it and moves bits 11:1 down to bits 10:0?',
          'Method: keep the last three hex digits, shift the 12-bit value right by one place, and write the 11-bit result in hex. Sanity check: the result must be below 0x800.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0x)?0*272\\s*$'], nudge: 'Take 0x4E5, drop bit 0 by shifting right once, and write the result in hex.' },
        solution: `Low 12 bits: \`0x4E5\`. Shift right by one: \`0x272\`. So the manufacturer field is **0x272**. The JEP106 code is split into a 7-bit identity (\`0x72\`) and a 4-bit bank number (\`0x4\`, meaning four continuation bytes, i.e. bank 5). Look the pair up in the JEP106 list to name the vendor. The part number is \`0x2003\` and the version \`0x1\`.\n\nThis is the ID Espressif's JTAG guide shows for each of the two CPU TAPs of the original ESP32; OpenOCD prints it as \`mfg: 0x272 (Tensilica), part: 0x2003, ver: 0x1\`, because the Xtensa core's TAP carries its designer's code. The RISC-V chips carry Espressif's own code instead, as a quiz question below asks you to work out.` },
      `## Harder application: the debug port as an attack surface, and its defences

Everything in this lesson works for anyone who can reach the pins. With an open debug port an attacker who owns a device can read all of flash (the firmware and any keys in it), read RAM while the device runs, change memory, and bypass any check by setting the program counter.

For each defence below, state what it stops and what it does not.

| Defence | Stops | Does not stop | Verify by |
|---|---|---|---|
| Not populating the debug header | Casual connection | Anyone with a soldering iron or probes on the pads | It is not a control. Do not count it |
| Firmware remaps the debug pins as GPIO | A debugger attaching to a *running* device | Connect-under-reset, which gets in before the remap | Attach with reset held, on a production unit |
| The chip's debug-disable or readout-protection setting (option bytes, NONMAIN configuration, eFuses, depending on vendor) | Debug access as defined by the vendor: check exactly what the level permits | Fault-injection attacks on the check itself, which is why some chips' protections have published bypasses | Try to attach to a locked unit with the vendor's tool and with OpenOCD; attempt a read |
| Password or challenge-protected debug | Access without the secret | Leakage of the secret; one shared password for all units | Confirm the password is per-device and never stored in firmware |
| Not storing long-term secrets where the debug port can reach them | Key extraction even if debug is opened | Abuse of the key while the device is running | Dump a development unit and search for the key |

The settings are chip-specific and some are irreversible. For the MSPM0L2228 the relevant options (debug access enabled / with password / disabled, SWD port enable, mass erase and factory reset policy) are in the NONMAIN boot configuration. For Espressif chips they are eFuses described in the ESP-IDF security guides. For the MAX78000, check the user guide and datasheet for what debug locking the part provides. Always read the vendor's description of what a locked state still allows, and test it on a unit you can afford to lose.`,
      { t: 'refs', items: [
        { title: 'TI MSPM0 SDK: L2228 boot configuration options (boot_config.h)', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h' },
        { title: 'ESP-IDF: USB Serial/JTAG controller', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/api-guides/usb-serial-jtag-console.rst' },
        { title: 'Arm developer documentation (ADIv5 Debug Interface, Cortex-M user guides)', url: 'https://developer.arm.com/documentation', note: 'Not load-tested from this project.' },
      ] },
    ],
    quiz: [
      { q: 'In JTAG, what determines which data register is connected between TDI and TDO?', kind: 'arch', choices: [
        { t: 'The value currently held in the instruction register', ok: true, why: 'The IR is a selector. Writing an instruction such as IDCODE or BYPASS chooses the data register for subsequent DR scans.' },
        { t: 'The level of TMS during shifting', why: 'TMS only moves the TAP state machine between states. It carries no register selection.' },
        { t: 'The frequency of TCK', why: 'TCK only paces the shifting. JTAG behaves identically at any legal clock rate.' },
      ] },
      { q: 'Why can SWD do with two wires what JTAG does with four?', kind: 'arch', choices: [
        { t: 'It uses request/acknowledge packets on one bidirectional data line instead of a state machine and separate in/out lines', ok: true, why: 'Turn-taking on SWDIO replaces TDI and TDO, and the packet header replaces the navigation done with TMS.' },
        { t: 'It runs at twice the clock rate', why: 'Clock rate does not reduce pin count. The saving comes from the protocol\'s structure.' },
        { t: 'It gives up access to memory and only reads CPU registers', why: 'SWD reaches the same debug port and access ports as JTAG. Memory access through the MEM-AP is fully available.' },
      ] },
      { q: 'A debugger wants to read the word at 0x20000100 on a Cortex-M chip. What does it do at the MEM-AP?', kind: 'arch', choices: [
        { t: 'Writes 0x20000100 to TAR, then reads DRW', ok: true, why: 'TAR holds the address and DRW performs the transfer on the chip\'s internal bus.' },
        { t: 'Shifts the address into the boundary-scan register', why: 'Boundary scan controls pins, not the internal memory bus.' },
        { t: 'Asks the firmware to send the word over the debug pins', why: 'No firmware is involved. The access port is a hardware bus master that works even with the core halted.' },
      ] },
      { q: 'OpenOCD reports IDCODE 0xFFFFFFFF. What should you check first?', kind: 'circuit', choices: [
        { t: 'Target power, ground and the TDO connection', ok: true, why: 'All ones means the probe is reading a line that is never driven low: floating, pulled up or disconnected.' },
        { t: 'The IR length in the target configuration', why: 'A wrong IR length gives wrong but varied data. A constant all-ones pattern points below the protocol, at the wiring.' },
        { t: 'Whether the flash is erased', why: 'Erased flash reads as 0xFF bytes, but the IDCODE comes from a hard-wired register that does not depend on flash contents.' },
      ] },
      { q: 'A product ships with firmware that turns the SWD pins into GPIO inputs during start-up. How much protection does that give?', kind: 'security', choices: [
        { t: 'Little: a probe that connects while holding reset halts the core before that code runs', ok: true, why: 'The remap is done by firmware, and firmware has not executed yet when the chip comes out of reset under debugger control.' },
        { t: 'Complete: once the pins are GPIO the debug port no longer exists', why: 'The debug logic is still in the chip and the pins are in their default debug role at every reset.' },
        { t: 'None, because GPIO pins can still carry SWD packets', why: 'While remapped, the pins really are disconnected from the debug port. The weakness is the window before the remap, not after it.' },
      ] },
      { q: 'OpenOCD\'s log for an ESP32-C3 on its built-in USB JTAG contains `tap/device found: 0x00005c25`. How does that ID decode?', kind: 'arch', choices: [
        { t: 'Manufacturer field 0x612, part number 0x0005, version 0', ok: true, why: 'The low 12 bits are 0xC25; bit 0 is the marker, and shifting right once gives 0x612, which OpenOCD names as Espressif Systems. Bits 27:12 are 0x0005 and bits 31:28 are 0.' },
        { t: 'Manufacturer field 0xC25, part number 0x0005, version 0', why: 'This keeps the marker bit as part of the code. The manufacturer field is bits 11:1 only, so the 12-bit value has to be shifted right by one first.' },
        { t: 'Manufacturer field 0x25, part number 0x005C, version 0', why: 'The fields are not aligned to whole bytes. The manufacturer field is 11 bits wide and the part number starts at bit 12.' },
        { t: 'It is not an IDCODE: the upper half is zero, so this is a BYPASS register', why: 'A BYPASS register captures a single 0 in bit 0. Here bit 0 is 1, which is exactly what marks a real IDCODE; a version of 0 and a small part number are perfectly legal.' },
      ] },
      { q: 'What is the VTref pin on a debug connector for?', kind: 'circuit', choices: [
        { t: 'It tells the probe the target\'s logic voltage so the probe can set its I/O levels', ok: true, why: 'It is a sense input on the probe side. A probe that sees no voltage there often refuses to drive its outputs.' },
        { t: 'It powers the target from the probe', why: 'Some probes have a separate, optional supply output, but VTref itself is an input that draws almost nothing.' },
        { t: 'It is the reference clock for adaptive clocking', why: 'Adaptive clocking uses a returned clock signal (RTCK). VTref is a DC level.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 6
  {
    id: 'dbg-probes', title: 'Debug probes: what the box between USB and the chip does', minutes: 30,
    summary: 'CMSIS-DAP, J-Link, ST-Link, XDS110, DAPLink and Espressif\'s options, and how to choose and wire one.',
    skills: ['dbg-probe-choose'],
    blocks: [
      `## The problem

Your computer has USB. The chip has SWD or JTAG at 1.8 V or 3.3 V with tight timing. Something has to sit between them, and the market offers a dozen names: J-Link, ST-Link, CMSIS-DAP, DAPLink, XDS110, ESP-Prog, FT2232 boards. Development kits add to the confusion by having one of these built in.

You need to know what the box does, which software can drive which box, and what the wiring must include.`,
      `## Theory: a probe is a protocol converter

A **debug probe** (or debug adapter) receives commands over USB and turns them into precisely timed SWD or JTAG waveforms at the target's voltage. It has no idea what your program is. The intelligence lives in the host software (OpenOCD, pyOCD, a vendor IDE), which knows the chip and decides which bits to shift.

Probes differ in three ways:

1. **The USB protocol they speak**, which determines which host software can use them.
2. **How much they do themselves.** A simple probe executes "shift these bits". A smart one executes "read 4 kB of memory" internally, which is much faster.
3. **What else is on board**: a USB serial port wired to the target's UART, target power, level shifting, trace capture.

| Probe | What it is | Host software |
|---|---|---|
| **CMSIS-DAP** | An open USB protocol from Arm for debug probes, plus reference firmware. Many inexpensive and on-board probes implement it | OpenOCD, pyOCD, most Arm IDEs |
| **DAPLink** | Arm's open firmware implementing CMSIS-DAP, plus a USB serial port and a **drag-and-drop mass-storage drive** for programming | Same as CMSIS-DAP |
| **SEGGER J-Link** | A commercial probe with its own protocol and software; fast, with wide device support | SEGGER tools, OpenOCD, most IDEs |
| **ST-Link** | STMicroelectronics' probe, built into their development boards | ST tools, OpenOCD |
| **TI XDS110** | Texas Instruments' probe; supports IEEE 1149.1 JTAG, 1149.7 cJTAG and SWD, with an auxiliary UART and EnergyTrace | Code Composer Studio, UniFlash, OpenOCD |
| **FTDI FT2232H-based** | A general USB-to-serial chip used in MPSSE mode to generate JTAG. Espressif's **ESP-Prog** is one | OpenOCD |
| **Built-in USB Serial/JTAG** | Not a separate box: logic inside ESP32-S3/C3/C6 that appears on USB as a serial port and a JTAG adapter | Espressif's OpenOCD |`,
      `## On real hardware: the course platforms

**MAX78000FTHR.** The board has an integrated **MAX32625PICO** debug adapter. It runs DAPLink firmware, so it enumerates as a CMSIS-DAP probe, a serial port and a drive named DAPLINK. Copying a binary to the drive programs the target, and according to Analog Devices' board documentation, dropping a file named \`erase.act\` on the drive mass-erases the target. Holding SW5 while plugging in puts the *adapter* into MAINTENANCE mode for updating its own firmware. The 2024 eCTF reference flow used this drag-and-drop path to install the competition bootloader; the 2025 flow likewise required the MITRE bootloader to be on the board before team firmware could be flashed through it.

**MSPM0L2228.** TI's debug-probe documentation for the MSPM0 SDK lists the XDS110 alongside SEGGER, PEmicro and Lauterbach probes. Upstream OpenOCD has a board file that pairs \`interface/xds110.cfg\` with the MSPM0 target. Which probe is physically on your evaluation board is something to confirm from that board's user guide.

**Original ESP32.** No on-chip USB. Use an external JTAG probe on GPIO12–15, such as an FT2232H-based ESP-Prog, or a development board that has one built in.

**ESP32-S3 / C3 / C6.** The built-in USB Serial/JTAG controller. Connect USB to the chip's own USB pins (many boards have a second connector for this, separate from the one that goes to a USB-UART bridge).`,
      { t: 'ascii', text: `  Probe side                         Target side
  ----------                         -----------
  GND     ------------------------   GND          always; more than one ground wire if possible
  VTref   <-----------------------   VDD (I/O)    target tells the probe its voltage
  SWCLK   ----------------------->   SWCLK
  SWDIO   <---------------------->   SWDIO
  nRESET  ----------------------->   nRESET       needed for connect-under-reset
  SWO     <-----------------------   SWO          optional, Cortex-M3 and above
  (5V/3V3 supply pin)   leave open unless the target has no supply of its own`, caption: 'Minimum SWD wiring. For JTAG replace SWCLK/SWDIO with TCK, TMS, TDI, TDO.' },
      `## Worked example: choosing for three situations

**A MAX78000FTHR on your desk.** Use the on-board DAPLink. Nothing to wire. OpenOCD's interface is CMSIS-DAP.

**A bare Cortex-M0+ on your own PCB, 1.8 V I/O.** You need a probe whose I/O follows VTref down to 1.8 V. Check the probe's specification for its supported target voltage range; several low-cost probes are fixed at 3.3 V and must not be used here. Route a 10-pin header with GND, VTref, SWCLK, SWDIO and nRESET.

**An ESP32-C3 module on a breadboard.** Wire a USB connector to GPIO18 (D−) and GPIO19 (D+) and you have console, flashing and JTAG with no probe at all. If the application reconfigures those two pins, the connection is lost until the next reset into download mode.`,
      { t: 'predict', q: 'A board has an on-board DAPLink probe. You connect an external J-Link to the same target\'s SWD header and leave the board\'s USB plugged in. Both probes are idle. What is the likely result when the J-Link tries to connect?',
        choices: [
          { t: 'It works normally, because an idle probe does not drive anything', why: 'Whether an idle probe releases the lines depends on the probe and its firmware. Many keep driving SWCLK and reset, so "idle" cannot be assumed to mean "disconnected".' },
          { t: 'Unreliable or failed connection, because two probes may be driving the same lines', ok: true, why: 'Two outputs on SWCLK, SWDIO or reset contend. Boards that support an external probe provide jumpers or solder bridges to isolate the on-board one.' },
          { t: 'The target is damaged immediately', why: 'Contention between two logic outputs at the same voltage is bad practice and causes malfunctions, but it rarely destroys anything at once. The realistic symptom is a flaky connection.' },
        ],
        reveal: `Check the board's schematic or user guide for how to disconnect the on-board probe (jumpers, a "debug out" mode, or cutting solder bridges). The same reasoning applies to the UART: an on-board USB serial bridge drives the target's RX pin, so an external adapter on that pin fights it.` },
      { t: 'callout', kind: 'mistake', title: 'Powering the target from two places', md: `Some probes have a pin that supplies 3.3 V or 5 V to the target. If the target has its own supply and you connect that pin as well, you have joined two supplies, the same mistake as connecting VCC on a UART adapter. Wire **VTref**, which is a sense input, and leave any supply output unconnected unless the probe is meant to be the target's only power source.` },
      { t: 'callout', kind: 'decision', title: 'Why prefer the on-board probe while learning?', md: `It is already wired correctly, at the right voltage, with reset connected, and the vendor's documentation and configuration files assume it. Every one of those is a thing that can go wrong with an external probe. Move to an external probe when you design your own board, need more speed or trace, or need to debug a target with no probe of its own.` },
      { t: 'exercise', prompt: `You must debug a custom board with a Cortex-M4 whose I/O runs at 1.8 V. The firmware reconfigures SWDIO as a GPIO 2 ms after reset. You have a CMSIS-DAP probe that supports 1.65–5.5 V targets. List the **five** connections you need between probe and board, and say which one makes it possible to get in despite the pin remap.`,
        hints: [
          'Two wires carry SWD itself. One is the reference for all of them.',
          'The probe needs to know the target runs at 1.8 V.',
          'To beat a 2 ms window you need control of the chip before its firmware starts.',
        ],
        answer: { type: 'text', accept: ['[Rr][Ee][Ss][Ee][Tt]', '[Nn][Rr][Ss][Tt]', '[Ss][Rr][Ss][Tt]'], nudge: 'Which signal lets the probe hold the chip still while it connects?' },
        solution: `GND, VTref (to the 1.8 V I/O rail), SWCLK, SWDIO and **nRESET**. The reset line is the one that defeats the remap: the probe asserts reset, begins the SWD connection, sets the core to halt on reset, and releases the line. The core stops at the first instruction, before the code that reconfigures the pin. Without nRESET you would have to win a 2 ms race by hand.` },
      `## Harder application: when the probe is the thing that is broken

You plug in a development board and the debug tool reports "no probe found". Before touching the target, divide the problem as you would any other:

1. **Does USB see the probe?** \`lsusb\` on Linux, Device Manager on Windows. Nothing listed means cable (many USB cables are charge-only), port or the probe's own firmware.
2. **Does the OS let your user open it?** On Linux a probe typically needs a udev rule. OpenOCD ships a rules file for the probes it supports; "LIBUSB_ERROR_ACCESS" is this problem.
3. **Is another program holding it?** An IDE, a second OpenOCD, or a vendor flashing tool still open.
4. **Is the probe's firmware what the tool expects?** On-board probes can sometimes be reflashed between firmwares (for example DAPLink and a vendor's own), and the tool must match.
5. Only now: **is the target answering?** That is the wiring, power and reset checklist from the previous lesson.

Write down which step failed. "It doesn't connect" is five different problems with five different fixes.`,
      { t: 'refs', items: [
        { title: 'MAX78000 Feather board documentation (MAX32625PICO, DAPLINK drive, erase.act)', url: 'https://github.com/analogdevicesinc/MaximAI_Documentation/blob/main/MAX78000_Feather/README.md' },
        { title: 'TI MSPM0 SDK: debug and programming tools guide (XDS110)', url: 'https://github.com/TexasInstruments/mspm0-sdk/tree/main/docs/english/tools/doc_guide/_sources/doc_guide-srcs' },
        { title: 'OpenOCD: MSPM0 LaunchPad board file', url: 'https://github.com/openocd-org/openocd/blob/master/tcl/board/ti/mspm0-launchpad.cfg' },
      ] },
    ],
    quiz: [
      { q: 'Where does the knowledge of "how to halt this particular microcontroller" live?', kind: 'arch', choices: [
        { t: 'In the host software, such as OpenOCD and its target configuration', ok: true, why: 'The probe generates waveforms. The host software knows the chip\'s debug registers and decides what to shift.' },
        { t: 'In the probe hardware', why: 'A generic probe works with thousands of chips it has never heard of, because it only converts USB commands into pin activity.' },
        { t: 'In the firmware being debugged', why: 'Debugging must work when the firmware is broken or absent, so it cannot depend on it.' },
      ] },
      { q: 'What does CMSIS-DAP standardise?', kind: 'concept', choices: [
        { t: 'The USB protocol between host software and a debug probe', ok: true, why: 'Any host tool that speaks CMSIS-DAP can use any probe that implements it, whoever made either.' },
        { t: 'The pinout of the debug connector', why: 'Connector pinouts are defined separately. CMSIS-DAP is about the host-to-probe conversation.' },
        { t: 'The format of firmware files', why: 'File formats such as ELF and HEX are unrelated to how a probe is commanded.' },
      ] },
      { q: 'On a MAX78000FTHR, you copy a .bin file onto the DAPLINK drive. What performs the flash programming?', kind: 'arch', choices: [
        { t: 'The MAX32625PICO adapter\'s firmware, which programs the target over its debug connection', ok: true, why: 'The drive is presented by the adapter. Its firmware turns a file write into debug-port flash operations.' },
        { t: 'A bootloader inside the MAX78000 that reads the USB drive', why: 'The target is not on USB at all here. The drive belongs to the separate adapter chip.' },
        { t: 'The host computer\'s file system driver', why: 'The host only writes a file to what it believes is a disk. It has no knowledge of the target.' },
      ] },
      { q: 'An ESP32-C3 application reconfigures GPIO18 and GPIO19 as ordinary outputs. What is the effect on debugging over the built-in USB Serial/JTAG?', kind: 'arch', choices: [
        { t: 'The USB connection is lost, because those pins are the controller\'s D− and D+', ok: true, why: 'The built-in controller needs its two USB pins. Repurposing them disconnects both console and JTAG until the chip is reset into a state where they are USB again.' },
        { t: 'None, because JTAG uses separate internal wiring', why: 'The JTAG logic is internal, but its only route to the host is through those two USB pins.' },
        { t: 'Only the serial console is lost; JTAG continues', why: 'Console and JTAG share one USB device on the same pair of pins. They go together.' },
      ] },
      { q: 'A probe with fixed 3.3 V I/O is connected to a target whose debug pins run at 1.8 V. What is the concern?', kind: 'circuit', choices: [
        { t: 'The probe drives 3.3 V into 1.8 V pins, exceeding their rating unless they are tolerant', ok: true, why: 'Over-voltage on an input forward-biases its protection structure and can damage the pin or raise the rail.' },
        { t: 'The connection will just be slower', why: 'Speed is not the issue. The issue is the absolute maximum voltage on the target\'s pins.' },
        { t: 'Nothing, because VTref adapts any probe automatically', why: 'VTref only helps on probes designed to follow it. A fixed-voltage probe ignores it.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 7
  {
    id: 'dbg-openocd', title: 'OpenOCD: from USB probe to a debug server', minutes: 50,
    summary: 'Interface, target and board files, the three servers, and the commands that halt, read memory and program flash.',
    skills: ['dbg-openocd-run'],
    blocks: [
      `## The problem

GDB understands C, symbols and stack frames. It knows nothing about SWD, flash controllers or your probe. The probe knows nothing about C. You need a program in the middle that speaks GDB's remote protocol on one side and drives the probe on the other, and that knows your chip well enough to halt it and to erase and write its flash.

**OpenOCD** (Open On-Chip Debugger) is the common open-source program for this. The price of its flexibility is configuration: you must tell it which probe, which transport and which chip.`,
      `## Theory

### Three kinds of configuration file

OpenOCD is configured with Tcl scripts, loaded with \`-f\`, searched for under its \`scripts\` directory.

| Directory | Describes | Example |
|---|---|---|
| \`interface/\` | The **probe**: which USB driver, which pins | \`interface/cmsis-dap.cfg\`, \`interface/xds110.cfg\` |
| \`target/\` | The **chip**: its TAPs or DAP, the core type, RAM work area, flash driver | \`target/ti/mspm0.cfg\` |
| \`board/\` | A **specific board**: includes the right interface and target files and adds reset wiring and quirks | \`board/ti/mspm0-launchpad.cfg\` |

Use a board file if one exists. Otherwise give an interface file and then a target file, in that order.

### Three servers

Once running, OpenOCD listens on three TCP ports (the defaults, each configurable):

| Port | Server | For |
|---|---|---|
| **3333** | GDB remote protocol | \`target extended-remote :3333\` from GDB |
| **4444** | Telnet command line | Typing OpenOCD commands by hand |
| **6666** | Tcl RPC | Scripts and tools sending commands programmatically |

OpenOCD keeps running in its terminal and prints a log. That log is your first diagnostic: read it before reading anything else.

### Commands worth knowing

| Command | Effect |
|---|---|
| \`init\` | Connect to the probe and examine the target. Implied at the end of startup |
| \`targets\` | List targets and their state (halted, running) |
| \`halt\` / \`resume\` | Stop / continue the core |
| \`reset halt\` | Reset the chip and stop it at the first instruction |
| \`reset run\` / \`reset init\` | Reset and run / reset, halt and run the board's init script |
| \`reg\` | Show core registers (target must be halted) |
| \`mdw addr [count]\` | Memory display, 32-bit words. \`mdh\` 16-bit, \`mdb\` bytes |
| \`mww addr value\` | Memory write, 32-bit word. \`mwh\`, \`mwb\` likewise |
| \`flash banks\`, \`flash info 0\` | What flash OpenOCD knows about |
| \`flash write_image erase file [offset]\` | Erase the needed sectors and program a file |
| \`program file verify reset exit\` | A convenience wrapper: flash, verify, reset, quit |
| \`dump_image file addr size\` | Read target memory into a file on the host |
| \`adapter speed kHz\` | Set the debug clock |
| \`transport select swd\` | Choose SWD or JTAG, before \`init\` |

\`mdw\` and \`mww\` read and write **any** address the debug port can reach: RAM, flash, and peripheral registers. Reading a peripheral register can have side effects (a UART data register pops a byte; some status flags clear on read), exactly as it would from code.`,
      { t: 'callout', kind: 'why', title: 'Why reset halt?', md: `Attaching to a running program shows you wherever it happens to be, with peripherals in an unknown state. \`reset halt\` gives you a defined starting point: the core stopped at its reset vector, nothing initialised. Flash programming is done from this state because the code that would otherwise be running might disable the debug pins, enter a low-power mode, or be overwritten while executing.` },
      `## On real hardware: three platforms, three OpenOCD builds

OpenOCD exists as the upstream project and as vendor forks that carry support not yet (or never) merged upstream. Using the wrong build is a common reason for "unknown target" errors.

### MSPM0L2228: upstream OpenOCD

Upstream OpenOCD contains a flash driver for the MSPM0L and MSPM0G families, with part-table entries for the MSPM0L2228, and a LaunchPad board file that uses the XDS110 interface.`,
      { t: 'code', lang: 'sh', status: 'reviewed', caption: 'MSPM0 with an XDS110, upstream OpenOCD. Written against the files in the OpenOCD repository; not run on a board here. Requires an OpenOCD build recent enough to include the mspm0 driver.',
        code: String.raw`openocd -f board/ti/mspm0-launchpad.cfg

# One-shot programming without an interactive session:
openocd -f board/ti/mspm0-launchpad.cfg -c "program hsm.elf verify reset exit"`,
        explain: [
          { lines: '1', md: 'The board file pulls in `interface/xds110.cfg` and `target/ti/mspm0.cfg`. OpenOCD then waits for GDB on 3333 and telnet on 4444.' },
          { lines: '4', md: '`-c` runs a command after the configuration. `program` halts the chip, erases and writes the loadable segments of the ELF at the addresses in the file, reads them back to verify, resets and exits.' },
        ] },
      `### MAX78000: the MSDK's OpenOCD

Analog Devices ships its own OpenOCD build as part of the MSDK toolchain, with the MAX78000 target file. The 2024 eCTF reference environment likewise packaged a custom Analog Devices OpenOCD. Use that build; do not expect a distribution's stock OpenOCD to know the part.`,
      { t: 'code', lang: 'sh', status: 'reviewed', caption: 'MAX78000FTHR through its on-board DAPLink, using the OpenOCD installed with the MSDK. Paths and file names follow the MSDK user guide; confirm them against your installation.',
        code: String.raw`# MAXIM_PATH points at the MSDK installation
openocd -s "$MAXIM_PATH/Tools/OpenOCD/scripts" \
        -f interface/cmsis-dap.cfg -f target/max78000.cfg`,
        explain: [
          { lines: '2', md: '`-s` adds a script search directory, so the interface and target files are taken from the MSDK and match the binary.' },
          { lines: '3', md: 'The on-board MAX32625PICO is a CMSIS-DAP probe. The target file describes the Arm core; the RISC-V core is reached through a separate JTAG port and is a separate setup.' },
        ] },
      `### ESP32 family: Espressif's OpenOCD

Espressif maintains a fork (\`openocd-esp32\`) that is installed with the ESP-IDF tools, and \`idf.py\` knows how to start it for the configured target.`,
      { t: 'code', lang: 'sh', status: 'reviewed', caption: 'ESP-IDF wrappers and the equivalent direct invocations. Command and file names checked against the ESP-IDF v6.1 tree (tools/idf_py_actions/debug_ext.py and docs/en/api-guides/jtag-debugging); not run on a board here.',
        code: String.raw`idf.py openocd                 # start Espressif's OpenOCD with the default config for the project's target
idf.py openocd gdb             # ...and a GDB session connected to it
idf.py openocd gdbtui          # ...with GDB's text UI
idf.py openocd --openocd-commands "-f interface/ftdi/esp_ftdi.cfg -f target/esp32.cfg" gdb

# Direct forms, run in an ESP-IDF environment:
openocd -f board/esp32s3-builtin.cfg       # ESP32-S3 built-in USB Serial/JTAG
openocd -f board/esp32c3-builtin.cfg       # ESP32-C3 built-in USB Serial/JTAG
openocd -f board/esp32-wrover-kit-3.3v.cfg # original ESP32 on an ESP-WROVER-KIT (FT2232H on board)
openocd -f interface/ftdi/esp_ftdi.cfg -f target/esp32.cfg   # original ESP32 + ESP-Prog`,
        explain: [
          { lines: '1-3', md: '`idf.py openocd` runs OpenOCD in the background with a default board file for the project\'s target (`board/esp32-wrover-kit-3.3v.cfg` for the original ESP32, `board/esp32s3-builtin.cfg` for the S3, `board/esp32c3-builtin.cfg` for the C3) and prints the arguments it chose. `gdb` and `gdbtui` start the target\'s GDB with the project ELF and a generated init file.' },
          { lines: '4', md: 'The default only suits one board per chip. For anything else pass your own arguments with `--openocd-commands`, or set the `OPENOCD_COMMANDS` environment variable. `idf.py` moves background actions such as `openocd` to the front, so the order on the command line does not matter.' },
          { lines: '7-8', md: 'The "builtin" board files select the on-chip USB JTAG adapter. Nothing but a USB cable to the chip\'s USB pins is required.' },
          { lines: '9-10', md: 'For the original ESP32 the probe is an FT2232H wired to GPIO12–15. A `board/` file names a whole kit. `interface/ftdi/esp_ftdi.cfg` is the adapter file Espressif documents for the ESP-WROVER-KIT and ESP-Prog, combined here with the chip\'s `target/` file.' },
        ] },
      `## Worked example: a session over telnet

With OpenOCD running against a Cortex-M4 target, open a second terminal. The transcript below is illustrative of what you should see; the addresses are for a part with flash at \`0x1000_0000\`.`,
      { t: 'code', lang: 'text', status: 'pseudo', caption: 'An OpenOCD telnet session, annotated. Illustrative: exact messages vary by version and target.',
        code: String.raw`$ telnet localhost 4444
> reset halt
[max78000.cpu] halted due to debug-request, current mode: Thread
xPSR: 0x01000000 pc: 0x10000228 msp: 0x20020000
> mdw 0x10000000 2
0x10000000: 20020000 10000229
> mdw 0xE000ED00
0xe000ed00: 410fc241
> reg pc
pc (/32): 0x10000228
> resume`,
        explain: [
          { lines: '2-4', md: 'The core is stopped at the reset handler. `msp` already holds the initial stack pointer and `pc` the reset vector with its low bit cleared.' },
          { lines: '5-6', md: 'The first two words of the vector table: initial stack pointer `0x20020000` (top of a 128 KB RAM at `0x20000000`) and reset vector `0x10000229`. The odd low bit marks Thumb code; the handler is at `0x10000228`, which is what `pc` shows.' },
          { lines: '7-8', md: '`0xE000ED00` is the CPUID register in the System Control Block. `0x410FC241` decodes as implementer `0x41` (Arm), part number `0xC24` (Cortex-M4). This is how a tool confirms what core it is talking to.' },
        ] },
      { t: 'predict', q: 'A target is running. Without halting it, you type `mdw 0x20000000 4` in the telnet session. On a Cortex-M chip, what happens?',
        choices: [
          { t: 'An error, because memory can only be read while halted', why: 'That is true of the core\'s own registers, which live inside the processor. Memory is reached through the MEM-AP, a separate bus master.' },
          { t: 'The four words are displayed, read while the program keeps running', ok: true, why: 'The MEM-AP accesses the bus independently of the core. Reads are interleaved with the program\'s own accesses.' },
          { t: 'The target halts, the words are read, and it resumes automatically', why: 'OpenOCD does not halt a Cortex-M core for a plain memory read. The debug architecture was designed so that it need not.' },
        ],
        reveal: `Reading memory on a running Cortex-M is normal and useful: you can watch a variable change without stopping the control loop. The values are a snapshot of an instant, so multi-word structures can be caught half-updated. Core registers (\`reg\`) are different: they require the core to be halted.` },
      { t: 'callout', kind: 'mistake', title: 'Blaming the target for a configuration problem', md: `Read the first error in the OpenOCD log, not the last. "unable to find a matching CMSIS-DAP device" and "LIBUSB_ERROR_ACCESS" are about the probe and USB permissions. "Error connecting DP: cannot read IDR" is about wiring, power or a locked chip. "Unknown flash device" or "invalid command name" means this OpenOCD build does not include your chip, so you need the vendor's build or a newer one. Each has a different fix, and only one of them involves the target.` },
      { t: 'callout', kind: 'decision', title: 'OpenOCD or the vendor tool?', md: `Vendor tools (UniFlash, esptool, DAPLink drag-and-drop, the IDE's flash button) are the reliable way to *program* a board, and for chip-specific configuration such as security settings they are the documented route. OpenOCD is the tool for *debugging* with GDB and for scripted memory access. Using each for what it is good at avoids most trouble.` },
      { t: 'exercise', prompt: `After \`reset halt\`, \`mdw 0x00000000 2\` on a Cortex-M0+ target prints \`0x00000000: 20208000 000000c1\`. At what address is the first instruction the core will execute? Give it in hex.`,
        hints: [
          'The core reads two words from the vector table at reset. Which of the two is an address in flash, and which is an address in RAM?',
          'The second word is the reset vector. It is odd. Can an instruction start at an odd address on a Cortex-M?',
          'Method: bit 0 of a vector is the Thumb marker, not part of the address. Clear it to get the address the pc register will hold.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0[xX])?0*[cC]0\\s*$'], nudge: 'Take the second word and clear its lowest bit.' },
        solution: `The reset vector is \`0x000000C1\`. Clearing the Thumb bit gives **0x000000C0**. The first word, \`0x20208000\`, is the initial stack pointer: the top of a 32 KB RAM that starts at \`0x20200000\`, which is the MSPM0L2228's SRAM base.` },
      `## Harder application: dumping your own firmware, and what stops others doing it

On a development board you own, with debug access open, reading the whole flash is one command. For a part with 512 KB of flash at \`0x1000_0000\`:

\`\`\`
> reset halt
> dump_image backup.bin 0x10000000 0x80000
\`\`\`

This is a legitimate and useful thing to do: it is how you back up a board before experimenting, and how you confirm what is really programmed. It is also exactly what an attacker does first.

Work through the consequences for a design that stores an AES key as a C array in flash:

1. The key is in \`backup.bin\`. Finding it is a search problem, which later lessons make easy.
2. Encrypting the firmware image for distribution does not help: the chip holds the plaintext, and the dump is taken from the chip.
3. What does help is the chip's own mechanism for refusing this command. On an MSPM0L2228 that is the NONMAIN debug-access policy. On Espressif chips, flash encryption makes a raw flash read return ciphertext, and eFuses can disable JTAG. On other parts it is a readout-protection level.
4. Verification is the same command on a locked unit. You should see OpenOCD fail to connect or fail to read, and you should check that the vendor's own tool fails too.

The competition flows for the 2024–2026 eCTF hardware put a MITRE bootloader between teams and the flash, so that attack-phase firmware cannot simply be read out. How that bootloader behaves is defined by each year's rules, which you should read directly.`,
      `## Practise: OpenOCD commands on the simulated target

The simulated session below shows OpenOCD's log in terminal 1 and takes OpenOCD commands in terminal 2 through GDB's \`monitor\` prefix, exactly as a real session does. Its target is the fictional Bench-MCU (flash at \`0x0800_0000\`, GPIO at \`0x4000_0000\`). Of the commands in the table above it models \`reset halt\`, \`halt\`, \`mdw\`/\`mdh\`/\`mdb\` and \`mww\`.

Work in this order, and predict each result before you press Enter:

1. \`target extended-remote :3333\`, then \`monitor reset halt\`. Read the \`pc\` and \`msp\` OpenOCD reports. The flash is erased: what must the first two words of the vector table be?
2. \`monitor mdw 0x08000000 2\` to check your prediction.
3. \`load\`, then the same \`mdw\` again. The two words have changed. From them alone, predict the \`pc\` and \`msp\` the next \`monitor reset halt\` will print, then run it.
4. Now use the debug port as a bus master, with no firmware running: \`monitor mww 0x40000000 0x20\` makes pin 5 an output (\`GPIO_DIR\`), and a second \`mww\` to \`GPIO_OUT\` at \`0x40000004\` drives it high. Read \`GPIO_OUT\` back with \`mdw\`.

The guided steps in the tool's own task list continue from there into GDB, which the next lesson covers.`,
      { t: 'widget', name: 'debug-session', props: { scenario: 'tour' }, caption: 'Simulated OpenOCD and GDB. For this lesson use only target extended-remote, load and the monitor commands.' },
      { t: 'exercise', prompt: `In the simulated session, after \`monitor reset halt\` on the **erased** chip, OpenOCD reports a \`pc\` that is not a flash address at all. Read it from the log. What value is it, and why is that the value? Enter the \`pc\` in hex.`,
        hints: [
          'Erased NOR flash reads as all ones. What does the core therefore load as its reset vector?',
          'The reset vector read back is 0xFFFFFFFF. The pc register never holds the Thumb bit: what is that value with bit 0 cleared?',
          'Run the two commands of step 1 in the tool and read the "xPSR: … pc: … msp: …" line.',
        ],
        answer: { type: 'text', accept: ['^\\s*(0[xX])?[fF]{7}[eE]\\s*$'], nudge: 'It is the erased reset vector, 0xFFFFFFFF, with bit 0 cleared.' },
        solution: `\`pc: 0xfffffffe\`. The core read \`0xFFFFFFFF\` from both vector-table words: the stack pointer became \`0xFFFFFFFC\` (the low two bits of SP always read as zero) and the pc became the vector with its Thumb bit cleared, \`0xFFFFFFFE\`. There is nothing to execute there. On a real Cortex-M that address is also the core's lockup address, so "pc = 0xfffffffe" in an OpenOCD log is a recognisable sign of a blank or corrupted vector table. After \`load\` the same two words read \`20010000 08000041\`, and the next reset gives \`msp: 0x20010000\`, \`pc: 0x08000040\`.` },
      { t: 'refs', items: [
        { title: 'OpenOCD source and bundled configuration files', url: 'https://github.com/openocd-org/openocd' },
        { title: 'OpenOCD MSPM0 flash driver', url: 'https://github.com/openocd-org/openocd/blob/master/src/flash/nor/mspm0.c' },
        { title: 'Analog Devices MSDK (toolchain includes an OpenOCD build)', url: 'https://github.com/analogdevicesinc/msdk' },
        { title: 'ESP-IDF (JTAG debugging guide is under docs/en/api-guides/jtag-debugging)', url: 'https://github.com/espressif/esp-idf' },
        { title: 'OpenOCD User\'s Guide', url: 'https://openocd.org/doc/', note: 'Not load-tested from this project.' },
      ] },
    ],
    quiz: [
      { q: 'Which pair of files does OpenOCD need when no board file exists for your hardware?', kind: 'concept', choices: [
        { t: 'An interface file for the probe, then a target file for the chip', ok: true, why: 'The interface file selects the probe driver and the target file describes the chip. The interface comes first because the target file may depend on the transport.' },
        { t: 'The firmware ELF and the linker script', why: 'OpenOCD needs neither to connect. It works from descriptions of the probe and chip, not of your program.' },
        { t: 'A GDB init file and a udev rules file', why: 'Those help GDB and USB permissions respectively. Neither tells OpenOCD what hardware it is driving.' },
      ] },
      { q: 'GDB should connect to which default OpenOCD port?', kind: 'concept', choices: [
        { t: '3333', ok: true, why: '3333 is the default GDB remote-protocol port for the first target.' },
        { t: '4444', why: 'That port is the human command line. It expects typed OpenOCD commands, not GDB\'s packet protocol.' },
        { t: '6666', why: 'That port accepts Tcl commands from scripts. GDB cannot speak to it.' },
      ] },
      { q: 'Why is flash normally programmed after `reset halt` and not on a running target?', kind: 'arch', choices: [
        { t: 'A halted, freshly reset core cannot interfere: it is not executing code that is being erased, sleeping, or reconfiguring pins', ok: true, why: 'Programming needs exclusive, predictable control of the flash controller and a stable debug connection.' },
        { t: 'Flash memory can only be written while the CPU clock is stopped', why: 'The flash controller needs clocks to operate. The point is to stop the *program*, not the clock.' },
        { t: 'It makes programming faster', why: 'Speed is set by the flash and the probe. The reason is correctness and safety of the operation.' },
      ] },
      { q: 'OpenOCD prints "Error: unable to find a matching CMSIS-DAP device". Where is the fault?', kind: 'concept', choices: [
        { t: 'Between the host and the probe: USB cable, permissions, another program holding the probe, or wrong interface file', ok: true, why: 'OpenOCD never got as far as the target. It could not open the probe itself.' },
        { t: 'In the target\'s flash contents', why: 'Nothing has been read from the target at this point. The message is about finding a USB device.' },
        { t: 'In the SWD wiring to the target', why: 'Wiring faults appear after the probe is opened, as failures to read the debug port.' },
      ] },
      { q: 'You run `mdw` on a UART receive-data register while debugging a serial driver. Why might the driver then miss a byte?', kind: 'arch', choices: [
        { t: 'Reading that register has a side effect: it removes the byte from the receiver, whoever reads it', ok: true, why: 'The debug port performs a real bus read. Peripherals cannot tell it from a read by the CPU.' },
        { t: 'mdw halts the UART clock', why: 'A memory read does not touch clocks. The effect is the same as the firmware reading the register one extra time.' },
        { t: 'The debugger overwrites the register with zero after reading it', why: 'A display command only reads. The data is consumed by the read itself, as the peripheral is designed to do.' },
      ] },
      { q: 'A stock distribution OpenOCD reports that it cannot find `target/max78000.cfg`. What is the right response?', kind: 'concept', choices: [
        { t: 'Use the OpenOCD build shipped with the MSDK, which includes that target', ok: true, why: 'Vendor builds carry support that the installed upstream package lacks, along with matching script files.' },
        { t: 'Use a target file for a different Cortex-M4 chip instead', why: 'The core would be recognised, but the flash driver and memory layout would be wrong, so programming would fail or damage the image.' },
        { t: 'Conclude that the MAX78000 does not support debugging', why: 'The chip has a standard Arm debug port. The missing piece is software support in that particular build.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 8
  {
    id: 'dbg-gdb', title: 'GDB on a remote target', minutes: 60,
    summary: 'Connecting, breakpoints in flash, watchpoints, stepping, memory and registers, and debugging optimised code.',
    skills: ['dbg-gdb-drive'],
    blocks: [
      `## The problem

A variable called \`armed\` is supposed to be zero. Somewhere in a 12,000-line firmware, something sets it to a nonzero value. No line of code assigns to it that way. Adding \`printf\` calls shows that it is zero before a function and nonzero after, and each rebuild-flash-run cycle to narrow it down takes a minute.

A debugger answers the question directly: stop the processor at the instant that memory location is written, and show the call stack.`,
      `## Theory

### Connecting: the first session, in order

GDB runs on your computer and needs two things: the **ELF file**, for symbols and source-line information, and a **remote target**, for the actual memory and registers. Use the GDB built for the target's architecture: \`arm-none-eabi-gdb\` (or \`gdb-multiarch\`) for Cortex-M, \`xtensa-esp32-elf-gdb\` or \`riscv32-esp-elf-gdb\` for Espressif chips.

\`\`\`
arm-none-eabi-gdb build/firmware.elf
(gdb) target extended-remote :3333
(gdb) monitor reset halt
(gdb) load
(gdb) break main
(gdb) continue
\`\`\`

- \`target extended-remote :3333\` connects to OpenOCD's GDB server. (\`target remote :3333\` also works; the extended form keeps GDB attached if the program is restarted.)
- \`monitor <cmd>\` passes a command straight through to OpenOCD. Anything you could type on port 4444 works after \`monitor\`.
- \`load\` writes the ELF's loadable sections to the target through OpenOCD's flash driver. If the firmware is already flashed, skip it, but then be sure the ELF matches what is on the chip. A mismatched ELF gives breakpoints on the wrong lines and nonsense variable values.

A first session is always the same moves in the same order. Check the stated result before going on, because each step depends on the one before it.

| Step | Where | You type | You should see | If you do not |
|---|---|---|---|---|
| 1 | terminal 1 | \`openocd -f …\` | the probe found, an ID, the breakpoint count, "Listening on port 3333 for gdb connections" | classify the first error in the log (previous lesson) |
| 2 | terminal 2 | \`arm-none-eabi-gdb build/firmware.elf\` | "Reading symbols from …" | "No symbol table": wrong file, or built without \`-g\` |
| 3 | GDB | \`target extended-remote :3333\` | "Remote debugging using :3333" | "Connection refused": OpenOCD has exited or uses another port |
| 4 | GDB | \`monitor reset halt\` | OpenOCD's "halted due to debug-request" line with \`pc\` and \`msp\` | reset line, wiring, or firmware that disables the debug pins |
| 5 | GDB | \`load\` | one "Loading section" line per loadable section, then "Start address" | flash driver or write protection |
| 6 | GDB | \`monitor reset halt\` again | \`msp\` = word 0 of the vector table, \`pc\` = word 1 with bit 0 cleared | the image is not where the core looks for its vectors |
| 7 | GDB | \`break main\`, \`continue\` | "Breakpoint 1, main () at file.c:NN" | out of hardware breakpoints, or the startup code never reaches \`main\` |

Step 6 is the one people leave out. \`load\` sets the program counter to the ELF's entry point, but the stack pointer still holds whatever it had before the new image existed. Only a reset makes the core read **both** from the new vector table.

**A worked case.** The transcript below is illustrative, for a part with flash at \`0x1000_0000\` and 128 KB of RAM at \`0x2000_0000\`; your addresses and messages will differ.

\`\`\`
(gdb) target extended-remote :3333
Remote debugging using :3333
(gdb) monitor reset halt
[max78000.cpu] halted due to debug-request, current mode: Thread
xPSR: 0x01000000 pc: 0x10000228 msp: 0x20020000
(gdb) load
Loading section .text, size 0x4a30 lma 0x10000000
Loading section .data, size 0x200 lma 0x10004a30
Start address 0x10000228, load size 19504
(gdb) monitor reset halt
xPSR: 0x01000000 pc: 0x10000228 msp: 0x20020000
(gdb) x/2xw 0x10000000
0x10000000:	0x20020000	0x10000229
(gdb) break main
Breakpoint 1 at 0x10000a54: file main.c, line 41.
(gdb) continue
Breakpoint 1, main () at main.c:41
\`\`\`

Three things to read off it. The two vector-table words explain the registers: \`msp\` is word 0, and \`pc\` is word 1 (\`0x10000229\`) without its Thumb bit. The load size is the sum of the sections, \`0x4A30 + 0x200 = 0x4C30\` = 19,504 bytes, and \`.data\` is loaded at a **flash** address although its variables live in RAM: the startup code copies it, which is why a global reads as garbage or zero until execution has passed the start-up code. And the breakpoint address is in flash, so it must be a hardware one, which is the next topic.

### Breakpoints: software and hardware

A **software breakpoint** works by overwriting an instruction in memory with a special breakpoint instruction (\`BKPT\` on Arm). When the core executes it, it halts, and the debugger puts the original instruction back. That requires the code to be in **writable memory**.

Firmware runs from **flash**, which cannot be modified by an ordinary write. So for code in flash the debugger uses a **hardware breakpoint**: a comparator inside the core's debug unit that watches the program counter and halts on a match. Comparators are real circuits, so their number is small and fixed by the chip designer. A Cortex-M4 commonly has six and a Cortex-M0+ can have at most four; the original ESP32 has two. Check your chip's documentation, or just read OpenOCD's log, which reports the count when it examines the target. ESP-IDF's headers give 2 breakpoints and 2 watchpoints for the ESP32 and ESP32-S3 and 8 of each for the ESP32-C3. Espressif's OpenOCD additionally emulates a number of flash breakpoints by rewriting flash, so on those chips running out looks different: the JTAG guide notes that with every breakpoint in use, \`next\` behaves like \`step\`.

GDB chooses automatically when OpenOCD gives it a memory map that marks flash as read-only. You can force the choice with \`hbreak\`. When you run out, GDB says so ("cannot insert hardware breakpoint"), and the fix is to delete some. \`tbreak\` sets a temporary breakpoint that frees its comparator after one hit.

### Watchpoints

A **watchpoint** halts on a data access instead of an instruction address. It uses a second set of comparators (the DWT unit on Cortex-M).

- \`watch var\` halts when \`var\` is **written** with a new value.
- \`rwatch var\` halts when it is read; \`awatch var\` on either.
- \`watch *(uint32_t *)0x20000418\` watches an address when there is no convenient symbol.

A watchpoint is the direct answer to "who is corrupting this variable?". The core stops just after the offending store, and \`bt\` shows who did it.

### Stepping

| Command | Meaning |
|---|---|
| \`next\` (\`n\`) | Run to the next source line, stepping **over** calls |
| \`step\` (\`s\`) | Run to the next source line, stepping **into** calls |
| \`finish\` | Run until the current function returns, and print its return value |
| \`until\` | Run until a line greater than the current one is reached (useful to leave a loop) |
| \`stepi\` / \`nexti\` | One machine instruction |
| \`continue\` (\`c\`) | Run until the next breakpoint, watchpoint or fault |

### Looking at state

| Command | Shows |
|---|---|
| \`bt\` | Backtrace: the chain of calls that led here |
| \`frame N\`, \`up\`, \`down\` | Select a stack frame, so that \`print\` and \`info locals\` refer to it |
| \`info locals\`, \`info args\` | Local variables and arguments of the selected frame |
| \`print expr\`, \`p/x expr\` | Any C expression; \`/x\` for hex, \`/t\` binary, \`/d\` decimal |
| \`info registers\` | Core registers. \`p $pc\`, \`p $sp\`, \`p/x $lr\` for single ones |
| \`x/NFU addr\` | Examine memory: N units, format F, unit size U |
| \`display expr\` | Print an expression every time the program stops |
| \`list\`, \`info line *ADDR\` | Source around the current line; which source line an address belongs to |
| \`disassemble /s\` | Machine code of the current function with source interleaved |

The \`x\` command is worth learning precisely. \`x/8xw $sp\` means: 8 units, hexadecimal, word (4 bytes) each, starting at the stack pointer. Unit letters are \`b\` (1), \`h\` (2), \`w\` (4), \`g\` (8). Formats include \`x\` hex, \`d\` decimal, \`s\` string, \`i\` instruction. So \`x/4i $pc\` disassembles four instructions at the program counter and \`x/s buf\` prints a C string.

**Peripherals** are just memory. \`x/1xw 0x40001004\` reads a register, and with a cast you can write one: \`set *(uint32_t *)0x40001004 = 0x20\`. You can turn an LED on from the debugger to prove the wiring before any driver exists. IDEs add named peripheral views by loading the vendor's SVD file; underneath it is the same memory read.`,
      `## On real hardware

**.gdbinit.** GDB reads commands from a file at startup, so the connection sequence need not be retyped. A project-local file must be explicitly allowed (GDB prints the line to add to your home \`.gdbinit\`), because a debugger that runs commands from any directory it starts in is a security risk.`,
      { t: 'code', lang: 'text', status: 'reviewed', caption: 'A project .gdbinit for a Cortex-M target behind OpenOCD. Start it with `arm-none-eabi-gdb build/firmware.elf`.',
        code: String.raw`set confirm off
set pagination off
target extended-remote :3333
monitor reset halt
tbreak main
continue`,
        explain: [
          { lines: '3', md: 'Connects to OpenOCD, which must already be running in another terminal.' },
          { lines: '4', md: 'Resets the chip through OpenOCD and halts at the reset vector, so every session starts from the same state.' },
          { lines: '5-6', md: 'A temporary breakpoint at `main`, then run. The startup code copies `.data` and clears `.bss` on the way, so globals are valid when you arrive.' },
        ] },
      `**TUI.** \`gdb -tui\`, or \`tui enable\` inside GDB, splits the terminal into a source window and a command window. \`layout split\` adds disassembly and \`layout regs\` adds registers. \`Ctrl-L\` redraws when target output scrambles the screen.

**ESP-IDF.** \`idf.py openocd gdb\` starts both programs. The build generates the GDB init file for you; in ESP-IDF v6.1 its connect part is \`target remote :3333\`, \`monitor reset halt\`, \`maintenance flush register-cache\`, \`thbreak app_main\`, \`continue\`: the same procedure as above, with a temporary hardware breakpoint at \`app_main\` and no \`load\`, because the image was already flashed with \`idf.py flash\`. FreeRTOS tasks appear as GDB threads: \`info threads\` lists them and \`thread N\` switches, so you can take a backtrace of every task.

**Halting stops the core, not the world.** Timers may keep counting, a watchdog may keep running and reset the chip while you read a variable, and the other end of a UART or radio link does not wait. Many chips have debug-freeze options for timers and watchdogs; look for them in the reference manual. Espressif's OpenOCD is expected to take care of the chip's watchdogs while the target is halted (a property of that fork, not checked in this project); if an ESP32 board still resets under the debugger, look at the watchdog options in \`menuconfig\`.`,
      `## Worked example: catching a corruption with a watchpoint

The file \`examples/debugging/gdb_practice.c\` is a small **host** program with the bug from the problem statement. It is here so you can practise the commands with nothing but \`gcc\` and \`gdb\`. The same commands work on a target.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/debugging/gdb_practice.c (extract). Built with gcc -Wall -Wextra -std=c11 -g -O0 -fno-stack-protector: no warnings. Running it prints name=pressure armed=0x0000412d samples=6.',
        code: String.raw`struct sensor_state {
    char    name[8];      /* 8 bytes */
    uint32_t armed;       /* sits directly after name[] in memory */
    uint32_t samples;
};

static struct sensor_state state = { "idle", 0, 0 };

static void set_name(struct sensor_state *s, const char *new_name)
{
    /* BUG: copies the terminating NUL too, and never checks the destination size. */
    memcpy(s->name, new_name, strlen(new_name) + 1);
}

int main(void)
{
    take_samples(&state, 4);
    set_name(&state, "pressure-A");     /* 10 characters + NUL into an 8-byte field */
    ...`,
        explain: [
          { lines: '1-5', md: 'Fields are laid out in order. `armed` occupies the four bytes immediately after the eight bytes of `name`.' },
          { lines: '12', md: 'Eleven bytes are written starting at `name`. Bytes 8, 9 and 10 land on `armed`: `-`, `A` and the NUL, which is 0x2D, 0x41, 0x00. Little-endian, that reads as 0x0000412D.' },
        ] },
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'A real GDB session on the x86-64 host build (output trimmed; addresses will differ on your machine). On a microcontroller the addresses would be in RAM at 0x2000_0000-style locations, and the memcpy frame would be the C library\'s Arm implementation.',
        code: String.raw`(gdb) break set_name
Breakpoint 1 at 0x119d: file gdb_practice.c, line 23.
(gdb) run
Breakpoint 1, set_name (s=0x555555558010 <state>, new_name=0x555555556008 "pressure-A") at gdb_practice.c:23
23	    memcpy(s->name, new_name, strlen(new_name) + 1);
(gdb) print *s
$1 = {name = "idle\000\000\000", armed = 0, samples = 6}
(gdb) print sizeof(s->name)
$2 = 8
(gdb) watch state.armed
Hardware watchpoint 2: state.armed
(gdb) continue
Hardware watchpoint 2: state.armed
Old value = 0
New value = 16685
__memcpy_avx512_unaligned_erms () at ../sysdeps/x86_64/multiarch/memmove-vec-unaligned-erms.S:368
(gdb) bt
#0  __memcpy_avx512_unaligned_erms () at ../sysdeps/x86_64/multiarch/memmove-vec-unaligned-erms.S:368
#1  0x00005555555551c0 in set_name (s=0x555555558010 <state>, new_name=0x555555556008 "pressure-A") at gdb_practice.c:23
#2  0x0000555555555238 in main () at gdb_practice.c:35
(gdb) x/16xb &state
0x555555558010 <state>:	0x70	0x72	0x65	0x73	0x73	0x75	0x72	0x65
0x555555558018 <state+8>:	0x2d	0x41	0x00	0x00	0x06	0x00	0x00	0x00`,
        explain: [
          { lines: '6-9', md: 'Before the copy: the structure is intact and the destination is 8 bytes.' },
          { lines: '10-11', md: 'GDB reports a *hardware* watchpoint: it is using a CPU debug comparator, so the program runs at full speed until the write.' },
          { lines: '13-15', md: 'The write happened. 16685 is 0x412D. Execution is inside `memcpy`, which is not where anyone would have looked.' },
          { lines: '17-20', md: 'The backtrace names the caller and the line. Frame 1 is the bug.' },
          { lines: '21-23', md: 'Raw memory confirms it: "pressure" fills the 8 bytes of `name`, then `2d 41 00` has overwritten the first three bytes of `armed`.' },
        ] },
      { t: 'predict', q: 'Your firmware is in flash on a Cortex-M0+ with four hardware breakpoint comparators. You have four breakpoints set and type `next` on a line that calls a function. What is likely to happen?',
        choices: [
          { t: '`next` works, because stepping does not use breakpoints', why: 'Stepping over a call is implemented by placing a temporary breakpoint at the return address and running. In flash that temporary breakpoint needs a hardware comparator too.' },
          { t: 'GDB reports that it cannot insert a breakpoint, because `next` needs a temporary one and none are free', ok: true, why: 'All four comparators are taken by your breakpoints, so the internal temporary breakpoint for stepping over the call cannot be placed.' },
          { t: 'GDB silently converts one of your breakpoints to a software breakpoint', why: 'A software breakpoint needs to overwrite the instruction, which is not possible in flash through a normal memory write, and GDB does not quietly change what you asked for.' },
        ],
        reveal: `Keep one comparator free for the debugger's own use. If you get "Cannot insert hardware breakpoint" or "Could not insert single-step breakpoint", delete or disable a breakpoint (\`info breakpoints\`, \`delete N\`, \`disable N\`) and retry. The reason is worth holding on to: \`next\` is not a primitive. GDB implements it as "plant a breakpoint at the return address, then continue", so it consumes the same scarce resource as your own breakpoints.` },
      { t: 'callout', kind: 'mistake', title: 'Debugging with an ELF that does not match the flash', md: `GDB trusts the ELF for every symbol address and line number, and the target for every byte of memory. If you rebuilt without reflashing, or flashed a different build, the two disagree: breakpoints land in the middle of other functions, \`print\` shows garbage, and stepping jumps around. When a session makes no sense, verify first. In GDB, \`compare-sections\` checks the ELF's loadable sections against target memory; in OpenOCD, \`verify_image\` does the same for a file.` },
      `### Debugging optimised code

Release firmware is built with optimisation, and the debugger's picture gets strange:

- **\`<optimized out>\`**: the variable has no storage at this point. It lives in a register that has been reused, or was folded into a constant.
- **Stepping jumps backwards and forwards**: the compiler reordered instructions, so consecutive instructions belong to non-consecutive lines.
- **Missing frames in a backtrace**: functions were inlined, or a tail call replaced call-and-return with a jump.
- **Breakpoints that never hit**: the function was inlined everywhere, so no separate copy is called.

Options, in order of preference: build with \`-Og\`, which optimises without destroying debuggability; mark one function with \`__attribute__((optimize("O0")))\` or the variable \`volatile\` while investigating; or read the disassembly (\`disassemble /s\`, \`info registers\`) and reason at machine level, which always tells the truth.`,
      { t: 'callout', kind: 'decision', title: 'Why not just debug at -O0?', md: `Unoptimised code is larger and slower. It may not fit in flash, and it changes timing, which can hide the very race or deadline miss you are chasing. A bug that appears only at \`-O2\` is often undefined behaviour or a missing \`volatile\`, and it has to be debugged in the build where it occurs. Use \`-O0\` or \`-Og\` to understand logic. Use the release build to understand a failure that only the release build has.` },
      { t: 'widget', name: 'debug-session', props: { scenario: 'tour' }, caption: 'A simulated Cortex-M target behind a GDB console. Follow the tool\'s ten steps (they are the table above, with break checksum in place of break main), then answer its three questions from what the session printed.' },
      { t: 'exercise', prompt: `A halted Cortex-M target has \`sp = 0x20001F40\`. You type \`x/6xw $sp\`. How many bytes of memory does GDB read, and what is the address of the last word displayed? Give the address in hex.`,
        hints: [
          'Read the command as count, format, unit. Which letter is the unit, and how many bytes is it?',
          'Six words are displayed, but the first one starts at sp itself. How many steps of 4 bytes separate the first word from the sixth?',
          'Method: bytes read = count × unit size; address of the last word = sp + unit size × (count − 1).',
        ],
        answer: { type: 'text', accept: ['20001[fF]54'], nudge: 'Six 4-byte words starting at 0x20001F40: the last one starts 20 bytes later.' },
        solution: `6 words × 4 bytes = 24 bytes. The words start at \`0x20001F40, …44, …48, …4C, …50, …54\`, so the last is at **0x20001F54**. Because the stack grows downward, these are the six most recently pushed words, the newest first.` },
      `## Harder application: the stuck loop

A board stops responding. No fault, no reset, it just hangs. Plan the session before reading the suggested one.

1. **Attach without resetting.** A reset would destroy the evidence. Connect and \`halt\` (in GDB, \`Ctrl-C\` after \`continue\`, or \`monitor halt\`).
2. **\`bt\`.** Where is it? A hang is nearly always a loop waiting for something that never happens.
3. **\`list\` and \`info locals\`.** Read the loop condition. Typical forms: \`while (!(STATUS & READY)) {}\`, a wait on a flag set by an interrupt, a retry loop with no limit.
4. **Examine what the condition depends on.** If it is a peripheral status bit, \`x/1xw\` the register. If it is a flag set by an ISR, check whether the interrupt is enabled and pending.
5. **Form the hypothesis and test it in place.** If you believe the loop waits for a bit that will never be set because the peripheral clock is off, turn the clock on from the debugger with \`set\` and \`continue\`. If the program proceeds, you have found the cause without a rebuild.
6. **Fix it properly**: every wait on hardware gets a timeout and an error path.

Try it in the simulated session below.`,
      { t: 'widget', name: 'debug-session', props: { scenario: 'stuck-loop' }, caption: 'The target hangs. Halt it, find the loop, and work out what it is waiting for.' },
      { t: 'refs', items: [
        { title: 'GDB documentation', url: 'https://sourceware.org/gdb/documentation/', note: 'Not load-tested from this project.' },
        { title: 'ESP-IDF (docs/en/api-guides/jtag-debugging covers GDB with OpenOCD)', url: 'https://github.com/espressif/esp-idf' },
      ] },
    ],
    quiz: [
      { q: 'Why can a debugger not use an ordinary software breakpoint on code executing from flash?', kind: 'arch', choices: [
        { t: 'A software breakpoint replaces an instruction in memory, and flash cannot be changed by a simple write', ok: true, why: 'Flash needs an erase-and-program sequence through the flash controller, so patching in a breakpoint instruction on the fly is not possible.' },
        { t: 'Flash is too slow to execute a breakpoint instruction', why: 'Flash executes breakpoint instructions like any other. The obstacle is getting the instruction into flash in the first place.' },
        { t: 'The debug port cannot read flash addresses', why: 'The debug port reads flash without difficulty, which is how firmware is verified and dumped. Writing is the restriction.' },
      ] },
      { q: 'A global is being overwritten by unknown code. Which command finds the culprit most directly?', kind: 'code', choices: [
        { t: '`watch the_global`, then `continue`, then `bt` when it stops', ok: true, why: 'A write watchpoint halts the core right after the store, and the backtrace identifies the code that performed it.' },
        { t: '`break main`, then `next` repeatedly while printing the variable', why: 'This works in principle but may take thousands of steps, and stepping over a call hides which function inside it did the write.' },
        { t: '`rwatch the_global`', why: 'That halts on reads. The program may read the variable many times without any of those reads being the corruption.' },
      ] },
      { q: 'What does `x/4xw 0x20000000` display?', kind: 'code', choices: [
        { t: 'Four 32-bit words in hexadecimal, starting at 0x20000000', ok: true, why: 'The count is 4, the format x is hex and the unit w is a 4-byte word.' },
        { t: 'Four bytes in hexadecimal', why: 'Bytes use the unit letter b. The w unit is four bytes, so sixteen bytes are read in total.' },
        { t: 'The word at 0x20000000 written four times in different formats', why: 'The number is a repeat count over consecutive memory, not a list of formats.' },
      ] },
      { q: 'In an optimised build, `print count` says `<optimized out>`. What does that mean?', kind: 'code', choices: [
        { t: 'At this point in the code the variable has no location the debugger can read', ok: true, why: 'The compiler kept it in a register that has since been reused, or eliminated it altogether. The debug information says so honestly.' },
        { t: 'The variable is zero', why: 'No value is being reported at all. Zero would be printed as 0.' },
        { t: 'The ELF file has no debug information', why: 'Without debug information GDB would not know the variable exists. Here it knows the variable and knows it cannot be located.' },
      ] },
      { q: 'You halt a target for a minute to read some variables. When you continue, the chip immediately resets. What is a likely cause?', kind: 'arch', choices: [
        { t: 'A watchdog timer kept counting while the core was halted and expired', ok: true, why: 'Halting stops instruction execution. Peripherals with their own clocks carry on unless a debug-freeze option stops them.' },
        { t: 'GDB always resets the target on continue', why: 'Continue resumes from the current program counter. A reset has to come from the chip or from an explicit command.' },
        { t: 'Reading variables corrupted the stack', why: 'Reads through the debug port do not modify memory. Something on the chip that depends on time passed its limit.' },
      ] },
      { q: 'What does `monitor reset halt` do when typed in GDB connected to OpenOCD?', kind: 'concept', choices: [
        { t: 'It sends `reset halt` to OpenOCD, which resets the chip and stops it at the reset vector', ok: true, why: '`monitor` is a passthrough to the remote debug server\'s own command interpreter.' },
        { t: 'It resets GDB\'s own state without touching the target', why: 'GDB commands that manage its own state do not use the monitor prefix. This one is forwarded to the server.' },
        { t: 'It sets a breakpoint at the reset handler', why: 'No breakpoint is involved. The halt comes from the debug logic catching the reset.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 9
  {
    id: 'dbg-postmortem', title: 'Post-mortem: HardFaults, panics and core dumps', minutes: 50,
    summary: 'From a crash to a source line: the Cortex-M exception frame and CFSR, and the ESP32 Guru Meditation report.',
    skills: ['dbg-fault-decode'],
    blocks: [
      `## The problem

A device in the field stops, or resets every few hours. With a debugger attached you find the processor spinning in a function called \`HardFault_Handler\` or \`Default_Handler\`: an empty infinite loop. The program that crashed is gone from the program counter. The backtrace shows one frame.

It looks as if there is nothing to go on. In fact the processor wrote down exactly where it was and why it faulted. You need to know where to read it.`,
      `## Theory: what a Cortex-M does on a fault

When a Cortex-M core takes any exception, including a fault, it **pushes eight words onto the current stack** before running the handler:

| Offset from SP | Register | Why it matters |
|---|---|---|
| +0 | R0 | Often a pointer argument: frequently the bad pointer itself |
| +4 | R1 | |
| +8 | R2 | |
| +12 | R3 | |
| +16 | R12 | |
| +20 | **LR** | The interrupted code's link register: the return address of its most recent call. Usually this names the caller (see step 6 of the procedure below for when it does not) |
| +24 | **PC** | The instruction that faulted (or the next one) |
| +28 | xPSR | Flags, the Thumb bit (bit 24), and the active exception number in the low bits |

It then loads a special value, **EXC_RETURN**, into LR. That value tells you which stack the frame is on: bit 2 clear means the main stack (MSP), bit 2 set means the process stack (PSP), which RTOS tasks use. \`0xFFFFFFF9\` is "return to thread mode, MSP" and \`0xFFFFFFFD\` is "return to thread mode, PSP". On a core with a floating-point unit, such as the MAX78000's Cortex-M4, bit 4 matters too: if it is **clear** (\`0xFFFFFFE9\`, \`0xFFFFFFED\`) the core also pushed floating-point state, 18 more words above the eight. The eight words in the table are still at the same offsets.

So the stacked **PC** is where it crashed and the stacked **LR** is who called that function. Those two numbers, turned into source lines, solve most faults.

### Why it faulted: the fault status registers (ARMv7-M)

Cortex-M3, M4 and M7 record the cause in the System Control Block:

| Register | Address | Contents |
|---|---|---|
| **CFSR** | \`0xE000ED28\` | Configurable Fault Status: three sub-registers packed together |
| HFSR | \`0xE000ED2C\` | HardFault Status: bit 30 FORCED (a lower fault escalated), bit 1 VECTTBL |
| MMFAR | \`0xE000ED34\` | Address of a memory-management fault, valid if CFSR.MMARVALID |
| BFAR | \`0xE000ED38\` | Address of a bus fault, valid if CFSR.BFARVALID |

CFSR's three parts:

- bits 7:0 **MMFSR**, memory-management faults (MPU violations);
- bits 15:8 **BFSR**, bus faults (access to an address where nothing responds);
- bits 31:16 **UFSR**, usage faults (undefined instruction, invalid state, divide by zero if trapping is enabled).

The bits you will meet most:

| Bit | Name | Typical cause |
|---|---|---|
| 9 | PRECISERR | Read or write of an invalid address. Stacked PC points at the instruction; BFAR holds the address |
| 10 | IMPRECISERR | A buffered write failed later. Stacked PC is *not* the culprit: look a few instructions earlier |
| 12 | STKERR | Faulted while pushing the exception frame: the stack pointer itself is bad, usually stack overflow |
| 16 | UNDEFINSTR | Executed something that is not an instruction: jumped into data or erased flash |
| 17 | INVSTATE | Branched to an even address (Thumb bit clear): a corrupted function pointer or return address |
| 1 | DACCVIOL | Data access blocked by the MPU; MMFAR holds the address |

By default the separate BusFault, MemManage and UsageFault handlers are disabled, so every one of these **escalates to HardFault**, with HFSR.FORCED set. CFSR still tells you the original cause.`,
      { t: 'callout', kind: 'hw', title: 'Cortex-M0 and M0+ are different', md: `ARMv6-M cores, including the **MSPM0L2228's Cortex-M0+**, have **no CFSR, HFSR, BFAR or MMFAR**. Every fault is a HardFault and the only evidence is the stacked frame. The method still works: stacked PC and LR locate the crash, and the instruction at that PC together with the stacked R0–R3 usually shows which register held the bad address. The MAX78000's Cortex-M4 has the full set of fault registers.` },
      `## On real hardware: the procedure

Halted inside the fault handler, work in this order. Each step tells you whether the next can be trusted.

1. **Which stack?** \`p/x $lr\`. Inside the handler LR is EXC_RETURN: bit 2 clear means the frame is on MSP, set means PSP.
2. **Dump the frame**: \`x/8xw $msp\` (or \`$psp\`). In a handler that is a bare loop and has pushed nothing, \`$sp\` is the same address. Label the eight words r0, r1, r2, r3, r12, lr, pc, xpsr.
3. **Is the frame believable?** A healthy stacked xPSR has bit 24 (Thumb) set, and a healthy stacked PC is an even address in flash. If either is wrong, that is itself the main clue (step 7).
4. **Why?** On ARMv7-M read CFSR and HFSR. Read BFAR or MMFAR only if the matching VALID bit is set in CFSR; otherwise they hold stale values.
5. **Where?** \`info line *<stacked PC>\` and \`list *<stacked PC>\` turn the stacked PC into a source line.
6. **Who called?** The stacked LR, with bit 0 cleared, is a *return address*: the instruction **after** a call. The call itself is just before it (2 bytes back for \`blx rN\`, 4 for \`bl\`), so ask about an address inside the call: \`info line *(<stacked LR> - 3)\`. Asking about the return address itself often reports the *next* source line. Caveat: LR names the caller only if the faulting function has not made a call of its own since it was entered. If it has, LR is the return address of that later call, inside the faulting function.
7. **If the stacked PC is not code** (zero, a RAM address, an odd-looking value): the fault was taken on a *jump*. The PC is where the processor tried to go, and there is nothing to look up there. If the jump was a call through a bad function pointer, the stacked LR points just after that call and step 6 finds the line. If it was a corrupted *return* address, no register remembers where it came from, and you have to read the stack memory above the frame.
8. **Write it down**: the eight words, EXC_RETURN and the status registers, before you reset anything.

As commands:

\`\`\`
(gdb) p/x $lr                      # EXC_RETURN: 0xfffffff9 -> frame is on MSP
(gdb) x/8xw $msp                   # r0 r1 r2 r3 r12 lr pc xpsr
(gdb) p/x *(uint32_t *)0xE000ED28  # CFSR   (M3/M4/M7 only)
(gdb) p/x *(uint32_t *)0xE000ED38  # BFAR, if BFARVALID
(gdb) info line *0x0800026a        # stacked PC -> file and line
(gdb) list *0x0800026a
(gdb) info symbol 0x08000430       # stacked LR -> calling function
(gdb) info line *(0x08000431 - 3)  # an address inside the call instruction
\`\`\`

If the handler has pushed anything before you halted, the frame is no longer exactly at the stack pointer. Fault handlers written for diagnosis therefore begin with a few instructions of assembly that capture MSP or PSP before any C code runs, and pass it to a C function as a pointer to the frame.

Without a debugger attached, the same information can be saved: the handler copies the eight words and CFSR to a RAM region that survives reset, or to flash, and the firmware reports it over the console on the next boot. That is how a fault in the field becomes a bug report with a line number.`,
      `## Worked example: decoding a fault

A Cortex-M4 firmware faults. In the handler you read:

\`\`\`
lr   = 0xfffffff9
x/8xw $msp:
  0x20000100 0x00000004 0x40001000 0x00000000
  0x00000000 0x08000431 0x0800026a 0x61000000
CFSR = 0x00008200
BFAR = 0x40001000
\`\`\`

Step by step:

1. \`lr = 0xFFFFFFF9\`: bit 2 is clear, so the frame is on MSP. Good, that is where we looked.
2. \`CFSR = 0x00008200\`: bits 15 and 9. BFSR is \`0x82\`: **PRECISERR** and **BFARVALID**.
3. So this is a precise bus fault and \`BFAR = 0x40001000\` is the address that was accessed.
4. Stacked PC is \`0x0800026A\`: even, in flash, and xPSR \`0x61000000\` has bit 24 set, so the frame is believable and this is the faulting instruction. Stacked LR is \`0x08000431\`: the caller returns to \`0x08000430\`, so the call is the instruction just before that address.
5. Stacked R2 is \`0x40001000\`, the same as BFAR: the instruction was using R2 as the address.
6. \`0x4000_1000\` is in the peripheral region. A bus fault on a peripheral register most often means the peripheral's clock is not enabled, or the address is not a register on this chip.

The program \`examples/debugging/cfsr_decode.c\` automates steps 2–4. It was compiled and run on the host with exactly these numbers.`,
      { t: 'code', lang: 'text', status: 'host-tested', caption: 'Output of ./cfsr_decode 00008200 20000100 00000004 40001000 0 0 08000431 0800026a 61000000 (host program; the numbers are the worked example\'s, not a measurement from a board).',
        code: String.raw`CFSR = 0x00008200
  MMFSR = 0x00  BFSR = 0x82  UFSR = 0x0000
  bit  9 PRECISERR   precise data bus error: stacked PC is the faulting instruction
  bit 15 BFARVALID   BFAR (0xE000ED38) holds the faulting address
Stacked frame (lowest address first):
  r0   = 0x20000100
  r1   = 0x00000004
  r2   = 0x40001000
  r3   = 0x00000000
  r12  = 0x00000000
  lr   = 0x08000431
  pc   = 0x0800026A
  xpsr = 0x61000000
  -> fault taken at (or just after) pc 0x0800026A; caller return address 0x08000430` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/debugging/cfsr_decode.c: the table-driven core. The bit positions are those of the ARMv7-M CFSR.',
        code: String.raw`struct bit_name { unsigned bit; const char *name; const char *meaning; };

static const struct bit_name cfsr_bits[] = {
    { 9,  "PRECISERR",   "precise data bus error: stacked PC is the faulting instruction" },
    { 10, "IMPRECISERR", "imprecise data bus error: stacked PC is NOT the culprit" },
    { 12, "STKERR",      "bus fault while stacking for exception entry (stack pointer is bad)" },
    { 15, "BFARVALID",   "BFAR (0xE000ED38) holds the faulting address" },
    { 16, "UNDEFINSTR",  "undefined instruction executed" },
    { 17, "INVSTATE",    "invalid EPSR state, typically a branch to an even address (Thumb bit clear)" },
    /* ...the full table is in the file... */
};

for (size_t i = 0; i < sizeof cfsr_bits / sizeof cfsr_bits[0]; i++) {
    if (cfsr & (1ul << cfsr_bits[i].bit)) {
        printf("  bit %2u %-11s %s\n", cfsr_bits[i].bit, cfsr_bits[i].name, cfsr_bits[i].meaning);
    }
}`,
        explain: [
          { lines: '3-11', md: 'One row per status bit. Keeping the meaning next to the bit number means the decoder and the documentation cannot drift apart.' },
          { lines: '13-17', md: 'Test each bit with a mask. Several can be set at once: a precise bus fault normally sets both PRECISERR and BFARVALID.' },
        ] },
      { t: 'predict', q: 'A Cortex-M4 faults with CFSR = 0x00020000. The stacked PC is 0x20000400 and the stacked xPSR is 0x60000000. What happened?',
        choices: [
          { t: 'A null pointer was dereferenced', why: 'A bad data access would set a bus-fault or memory-management bit in the lower half of CFSR. Here only a usage-fault bit is set, and the PC itself is the odd thing.' },
          { t: 'The program jumped to an address in RAM with the Thumb bit clear, typically through a corrupted function pointer or return address', ok: true, why: 'Bit 17 is INVSTATE, xPSR bit 24 (T) is 0, and the PC is in RAM where no code should be. Something loaded the PC with a data value.' },
          { t: 'The stack overflowed', why: 'An overflow that breaks exception stacking sets STKERR in the bus-fault byte. This fault is about the execution state, not about stacking.' },
        ],
        reveal: `Cortex-M cores execute only Thumb code, so every valid branch target has bit 0 set. A function pointer or saved return address that was overwritten with data usually has it clear, and the core faults with INVSTATE on the first instruction. The stacked LR tells you which function made the jump. From a security point of view this is also what a failed attempt to hijack control flow looks like, which is why crash reports are worth reading carefully.` },
      { t: 'callout', kind: 'mistake', title: 'An empty default handler', md: `Vendor startup files route every unused exception to one infinite loop. In the field that turns every crash into a silent hang until a watchdog fires, and the evidence is lost. At minimum the fault handler should capture the stacked PC and LR (and CFSR where it exists), store them where they survive a reset, and then reset the system deliberately. Do not print from inside the handler using the normal driver: the fault may have been in that driver or in the stack it needs.` },
      `## ESP32: Guru Meditation and core dumps

ESP-IDF's panic handler does this work for you and prints a report on the console. On the Xtensa chips it has this shape:

\`\`\`
Guru Meditation Error: Core  0 panic'ed (LoadProhibited). Exception was unhandled.

Core  0 register dump:
PC      : 0x400d5e2b  PS      : 0x00060830  A0      : 0x800d1234  A1      : 0x3ffb4f60
...
EXCVADDR: 0x00000004  ...

Backtrace: 0x400d5e28:0x3ffb4f60 0x400d1231:0x3ffb4f80 0x400d0f44:0x3ffb4fa0
\`\`\`

(The values above are illustrative.) Read it the same way as a Cortex-M frame:

- The **cause** is in words: \`LoadProhibited\` and \`StoreProhibited\` are a read or write of an invalid address; \`IllegalInstruction\` and \`InstrFetchProhibited\` mean the PC went somewhere bad.
- **EXCVADDR** is the address that was accessed, the equivalent of BFAR. A small value such as \`0x00000004\` is a field at offset 4 of a **null** structure pointer.
- **PC** is the faulting instruction.
- **Backtrace** is a list of \`PC:SP\` pairs, innermost first.

\`idf.py monitor\` decodes those addresses into function names and \`file:line\` automatically, using the project's ELF. Without it, the toolchain's \`addr2line\` does the same: \`xtensa-esp32-elf-addr2line -pfiaC -e build/app.elf 0x400d5e28\`. On the RISC-V chips (C3, C6) the report lists RISC-V registers (\`MEPC\` is the faulting PC, \`MTVAL\` the bad address) and the idea is the same.

A **core dump** goes further. With the core-dump component enabled, the panic handler saves every task's registers and stack to a flash partition or prints them over UART. \`idf.py coredump-info\` summarises it and \`idf.py coredump-debug\` opens it in GDB, where \`bt\`, \`info threads\` and \`print\` work as if the device were halted at the moment of the crash.`,
      { t: 'callout', kind: 'security', md: `A crash report is a description of the firmware's internals: addresses, register contents, sometimes stack memory. A core dump is a copy of RAM, which may include keys and user data. In production, decide deliberately where this information goes. Store it encrypted or restrict it, do not print stack contents on an open console, and treat the core-dump partition as sensitive. The defence is not to stop collecting crash data, which you need, but to control who can read it.` },
      { t: 'callout', kind: 'decision', title: 'Halt or reset in the fault handler?', md: `During development, halt: \`while (1)\` or a breakpoint instruction keeps the state for the debugger. In production, record and reset: a device that hangs for ever is worse than one that restarts and reports. Many projects select between the two with a build flag, and trigger the debugger only if one is attached.` },
      { t: 'widget', name: 'debug-session', props: { scenario: 'hardfault' }, caption: 'The simulated target ends up in its HardFault handler. This case is step 7 of the procedure: the stacked PC is not code, so the stacked LR has to find the line. The simulated core runs ARMv6-M code but has the ARMv7-M fault status registers, so CFSR and HFSR can be read; on a real Cortex-M0+ they do not exist.' },
      { t: 'exercise', prompt: `In a HardFault handler on a Cortex-M4 you read \`lr = 0xFFFFFFFD\` and \`CFSR = 0x00001000\`. (a) Which stack holds the exception frame? (b) Name the CFSR bit that is set.`,
        hints: [
          'Two separate questions. For (a): which single bit of EXC_RETURN tells MSP from PSP, and what is the last hex digit in binary?',
          'For (b): 0x1000 has one bit set. Which bit number, and which of the three CFSR sub-registers (bits 7:0, 15:8, 31:16) contains it?',
          'Method: look the bit number up in the table of CFSR bits above. The name describes *when* the bus fault happened, which also tells you whether the stacked frame can be trusted.',
        ],
        answer: { type: 'text', accept: ['[Ss][Tt][Kk][Ee][Rr][Rr]'], nudge: 'Bit 12 of CFSR, in the BusFault status byte: the fault happened while pushing the frame.' },
        solution: `(a) Bit 2 of \`0xFFFFFFFD\` is set, so the frame is on the **process stack (PSP)**: an RTOS task was running. (b) Bit 12 is **STKERR**: a bus fault occurred while the core was pushing the exception frame. That means the task's stack pointer pointed outside valid memory, and the usual cause is that the task overflowed its stack. The stacked frame is not trustworthy here, because stacking is what failed. Check the task's stack size and its high-water mark.` },
      `## Harder application: the same fault on three platforms

A structure pointer is null and the code reads the field at offset 4. Predict what each platform reports, and how you reach the source line.

| Platform | What you see | Where the line number comes from |
|---|---|---|
| MAX78000 (Cortex-M4) | The device header places ROM at address 0, so whether a read of address 4 faults depends on whether that ROM is readable by application code, which this project has not established: test it. If it faults: HardFault with HFSR.FORCED, CFSR shows PRECISERR and BFARVALID, BFAR = 4 | Stacked PC → \`info line\` or \`addr2line\` |
| MSPM0L2228 (Cortex-M0+) | Main flash starts at address 0, so a **read** of address 4 does not fault at all: it silently returns the reset vector. A write through the pointer does not change flash; whether it raises a HardFault is for TI's documentation or a test to settle, and there are no status registers either way | If it faults: stacked PC. If it does not: wrong data propagates, and you need a watchpoint or an assertion |
| ESP32 | \`Guru Meditation Error ... (LoadProhibited)\`, EXCVADDR = 0x00000004 | The printed backtrace, decoded by \`idf.py monitor\` |

The middle row is the lesson. On a chip with memory mapped at address zero, a null-pointer read is not caught by hardware. The only protection is your own check, or an MPU region covering the low addresses if the core has an MPU and you configure it. Do not rely on a crash to tell you a pointer was null.`,
      { t: 'widget', name: 'debug-session', props: { scenario: 'bad-pointer' }, caption: 'A pointer goes wrong before the crash. Use a watchpoint to find where.' },
      { t: 'refs', items: [
        { title: 'Arm CMSIS 6 (core headers define SCB, CFSR bit positions)', url: 'https://github.com/ARM-software/CMSIS_6' },
        { title: 'TI MSPM0 device header (Cortex-M0+ configuration of the L222x)', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/mspm0l222x.h' },
        { title: 'ESP-IDF (docs/en/api-guides/fatal-errors and core_dump)', url: 'https://github.com/espressif/esp-idf' },
      ] },
    ],
    quiz: [
      { q: 'In a Cortex-M exception frame, which stacked value tells you the instruction that was executing when the fault occurred?', kind: 'arch', choices: [
        { t: 'The stacked PC, at offset 24 from the frame\'s start', ok: true, why: 'The core saves the address of the interrupted instruction as the return address of the exception.' },
        { t: 'The LR register as seen inside the handler', why: 'Inside the handler LR holds EXC_RETURN, a special code describing how to return, not a code address.' },
        { t: 'The stacked R0', why: 'R0 is the first argument or scratch register of the interrupted code. It is data, often useful, but not a location in the program.' },
      ] },
      { q: 'CFSR reads 0x00000400 on a Cortex-M7. The stacked PC points at a harmless-looking instruction. Why?', kind: 'arch', choices: [
        { t: 'Bit 10 is IMPRECISERR: the failing write was buffered and reported later, so the PC has moved on', ok: true, why: 'With an imprecise fault the offending store is some instructions before the stacked PC. Search backwards for a write through a suspect pointer.' },
        { t: 'The stack frame is corrupt', why: 'Nothing indicates a stacking fault. The frame is valid; it simply records a later point in the program than the faulty access.' },
        { t: 'The fault was caused by an interrupt, not by code', why: 'A bus fault is the result of an access made by executing code. The delay is in reporting it, not in what caused it.' },
      ] },
      { q: 'Why does the fault-analysis method differ on an MSPM0L2228 compared with a MAX78000?', kind: 'arch', choices: [
        { t: 'The MSPM0L2228 is a Cortex-M0+, which has no CFSR or fault address registers, so only the stacked frame is available', ok: true, why: 'ARMv6-M implements only HardFault and omits the configurable fault status registers found on ARMv7-M cores such as the Cortex-M4.' },
        { t: 'The MSPM0L2228 does not push an exception frame', why: 'All Cortex-M cores stack the same eight registers on exception entry. That part of the method is identical.' },
        { t: 'TI chips use a different register for the program counter', why: 'The core is licensed from Arm and its registers are the standard ones. The difference is the architecture version, not the vendor.' },
      ] },
      { q: 'In a HardFault handler on a Cortex-M4 the frame reads: stacked PC = 0x00000000, stacked LR = 0x08001235, stacked xPSR = 0x00000000, CFSR = 0x00020000. The firmware calls callbacks through a table of function pointers. Where do you look for the faulty line?', kind: 'code', choices: [
        { t: 'At the instruction just before 0x08001234, the call whose return address was saved', ok: true, why: 'The stacked PC is the destination of a jump to a null pointer, not a place in the program. A call stores its return address in LR, so the stacked LR minus its Thumb bit is the instruction after the call.' },
        { t: 'At address 0x00000000, because the stacked PC is the faulting instruction', why: 'For a bad data access that would be right. Here the PC is not code at all and the T bit of xPSR is clear: the PC shows where the processor was sent, not which instruction sent it.' },
        { t: 'At 0x08001235 exactly, because LR holds the address of the call instruction', why: 'LR holds a return address with the Thumb bit set. The odd value is not an address, and even with bit 0 cleared it is the instruction after the call.' },
        { t: 'Nowhere in the frame: with the PC destroyed, only CFSR and BFAR can help', why: 'BFAR is meaningful only when BFARVALID is set, and here the only bit set is in the usage-fault half. The frame still holds one good code address.' },
      ] },
      { q: 'An ESP32 panic shows `StoreProhibited` and `EXCVADDR: 0x0000000c`. What is the most likely bug?', kind: 'code', choices: [
        { t: 'A write to a member at offset 12 of a structure whose pointer is null', ok: true, why: 'A store to a small address is a null base pointer plus a field offset.' },
        { t: 'A stack overflow', why: 'Overflows show up as stack canary or stack-overflow reports, or as corruption far from address zero. An access at 0xC points at a null base pointer.' },
        { t: 'An illegal instruction', why: 'That would be reported with its own cause name and concerns the PC, not a data address.' },
      ] },
      { q: 'Why should a production fault handler avoid calling the normal `printf` path?', kind: 'code', choices: [
        { t: 'The fault may have come from the code, stack or heap that `printf` depends on, causing a second fault', ok: true, why: 'A handler must assume as little as possible is working. Recording raw values with minimal code is far more robust.' },
        { t: '`printf` cannot print hexadecimal addresses', why: 'It prints hexadecimal perfectly well. The concern is whether it can run at all in a damaged system.' },
        { t: 'Exception handlers are not allowed to call functions', why: 'Handlers call functions routinely. The issue is which functions are safe after a fault.' },
      ] },
      { q: 'A device stores core dumps in an unencrypted flash partition. What is the security concern?', kind: 'security', choices: [
        { t: 'A dump is a copy of RAM and may contain keys and user data, readable by anyone who can read the flash', ok: true, why: 'Crash data is valuable to the developer and to an attacker for the same reason: it exposes internal state.' },
        { t: 'Core dumps slow the device down in normal operation', why: 'Dumps are written only on a crash. Normal performance is unaffected.' },
        { t: 'There is none, because dumps contain only addresses', why: 'They contain memory contents, including stacks, which hold whatever the tasks were processing.' },
      ] },
    ],
  },
];

const glossary = [
  { term: 'JTAG', def: 'IEEE 1149.1: a four-wire serial interface (TCK, TMS, TDI, TDO) for shifting bits through registers in a chip. Used for board test and for debug.' },
  { term: 'TAP', def: 'Test Access Port: the JTAG state machine and registers inside a device. TMS steers it, TCK clocks it.' },
  { term: 'IDCODE', def: 'A 32-bit JTAG register holding version, part number and JEP106 manufacturer code. Bit 0 is always 1.' },
  { term: 'Boundary scan', def: 'A JTAG shift register with a cell at each pin, allowing pins to be read and driven without running code.' },
  { term: 'SWD', def: 'Serial Wire Debug: Arm\'s two-wire (SWCLK, SWDIO) packet-based alternative to JTAG for debug access.' },
  { term: 'SWO', def: 'Serial Wire Output: an optional one-way trace pin on Cortex-M3 and above, used for low-overhead logging. Absent on Cortex-M0/M0+.' },
  { term: 'DAP', def: 'Debug Access Port: the Arm debug block reached over SWD or JTAG, made of a Debug Port and one or more Access Ports.' },
  { term: 'Debug Port (DP)', def: 'The part of the DAP that speaks SWD or JTAG and selects an Access Port. Its ID register is DPIDR.' },
  { term: 'MEM-AP', def: 'A memory Access Port: a bus master controlled by the debugger through its TAR (address) and DRW (data) registers.' },
  { term: 'Debug probe', def: 'Hardware that converts USB commands into SWD or JTAG signals at the target\'s voltage. Also called a debug adapter.' },
  { term: 'CMSIS-DAP', def: 'Arm\'s open USB protocol for debug probes, implemented by many inexpensive and on-board probes.' },
  { term: 'DAPLink', def: 'Open probe firmware implementing CMSIS-DAP, a USB serial port and drag-and-drop programming. The MAX78000FTHR\'s on-board MAX32625PICO runs it.' },
  { term: 'XDS110', def: 'Texas Instruments\' debug probe, supporting JTAG, cJTAG and SWD, with an auxiliary UART.' },
  { term: 'USB Serial/JTAG controller', def: 'Fixed-function logic in ESP32-S3, C3 and C6 that provides a serial console and JTAG over the chip\'s own USB pins.' },
  { term: 'VTref', def: 'The pin on a debug connector by which the target tells the probe its I/O voltage. A sense input, not a supply.' },
  { term: 'Connect under reset', def: 'Attaching a debugger while holding the target in reset, so the core is halted before any firmware runs.' },
  { term: 'OpenOCD', def: 'Open On-Chip Debugger: host software that drives a probe and offers GDB (3333), telnet (4444) and Tcl (6666) servers.' },
  { term: 'GDB', def: 'The GNU debugger. With a remote target it combines an ELF\'s symbols on the host with memory and registers read from the chip.' },
  { term: 'Hardware breakpoint', def: 'A comparator in the core\'s debug logic that halts execution at an address. Needed for code in flash; limited in number.' },
  { term: 'Software breakpoint', def: 'A breakpoint made by replacing an instruction in RAM with a breakpoint instruction.' },
  { term: 'Watchpoint', def: 'A debug comparator that halts execution when a chosen memory address is written or read.' },
  { term: 'Exception frame', def: 'The eight words (R0–R3, R12, LR, PC, xPSR) a Cortex-M core pushes on the stack when it takes an exception.' },
  { term: 'EXC_RETURN', def: 'The value in LR inside a Cortex-M handler. It encodes which stack holds the frame and which mode to return to.' },
  { term: 'CFSR', def: 'Configurable Fault Status Register at 0xE000ED28 on ARMv7-M cores, combining the MemManage, BusFault and UsageFault status bits. Not present on Cortex-M0/M0+.' },
  { term: 'HardFault', def: 'The Cortex-M catch-all fault exception. On ARMv6-M it is the only fault; on ARMv7-M other faults escalate to it unless enabled.' },
  { term: 'Guru Meditation Error', def: 'ESP-IDF\'s panic report: cause, register dump and backtrace printed on the console when a fatal exception occurs.' },
  { term: 'Core dump', def: 'A saved copy of registers and task stacks at the time of a crash, for later analysis in GDB.' },
];

const troubleshooting = [
  { symptom: 'OpenOCD cannot find the probe', area: 'Debug probe', causes: 'Charge-only USB cable, missing udev rule or driver, another program holding the probe, or the wrong interface file.', fix: 'Check `lsusb`, install OpenOCD\'s udev rules, close IDEs and other OpenOCD instances, and match the interface file to the probe\'s firmware.' },
  { symptom: 'IDCODE or DPIDR reads as all zeros or all ones', area: 'JTAG/SWD', causes: 'Target unpowered, missing ground or VTref, a signal not connected, or an on-board probe contending with an external one.', fix: 'Measure target supply and VTref, check continuity of each line, isolate the on-board probe, lower `adapter speed`.' },
  { symptom: 'Debugger connects only immediately after power-up, or not at all on a board that otherwise runs', area: 'JTAG/SWD', causes: 'Firmware reconfigures the debug pins or enters a low-power mode that stops the debug clock.', fix: 'Connect under reset with the reset line wired to the probe, then erase or fix the firmware.' },
  { symptom: 'OpenOCD reports an unknown target or flash driver', area: 'OpenOCD', causes: 'This OpenOCD build lacks support for the chip.', fix: 'Use the vendor\'s build (MSDK for MAX78000, Espressif\'s fork for ESP32) or a recent upstream build (MSPM0).' },
  { symptom: 'GDB: "Cannot insert hardware breakpoint"', area: 'GDB', causes: 'All the core\'s breakpoint comparators are in use, including the one stepping needs.', fix: 'Delete or disable breakpoints, use `tbreak`, and keep one comparator free.' },
  { symptom: 'Breakpoints hit on the wrong lines and variables show nonsense', area: 'GDB', causes: 'The ELF given to GDB is not the build that is in flash.', fix: 'Reflash from the same ELF, or run `compare-sections` to confirm the mismatch.' },
  { symptom: 'Variables show <optimized out> and stepping jumps around', area: 'GDB', causes: 'Optimised build: variables live in registers and instructions are reordered.', fix: 'Build with `-Og`, or read the disassembly and registers directly.' },
  { symptom: 'Target resets while halted in the debugger', area: 'GDB', causes: 'A watchdog continued to run while the core was stopped.', fix: 'Enable the chip\'s debug-freeze option for the watchdog, or disable the watchdog in debug builds.' },
  { symptom: 'Device hangs with the PC in Default_Handler or HardFault_Handler', area: 'Faults', causes: 'An unhandled exception. The cause is recorded in the stacked frame, and in CFSR on Cortex-M3/M4/M7.', fix: 'Read EXC_RETURN, dump eight words from the indicated stack, convert the stacked PC and LR to source lines.' },
  { symptom: 'ESP32 prints a Guru Meditation Error with raw addresses', area: 'Faults', causes: 'A fatal exception; the terminal in use does not decode addresses.', fix: 'Use `idf.py monitor`, or run the toolchain\'s `addr2line -e build/<app>.elf` on the backtrace addresses.' },
];

const refs = [
  { org: 'OpenOCD', title: 'OpenOCD source, configuration scripts and flash drivers', url: 'https://github.com/openocd-org/openocd' },
  { org: 'Arm', title: 'CMSIS 6 core headers (SCB and fault register definitions)', url: 'https://github.com/ARM-software/CMSIS_6' },
  { org: 'Analog Devices', title: 'MSDK (includes the OpenOCD build and MAX78000 target files)', url: 'https://github.com/analogdevicesinc/msdk' },
  { org: 'Analog Devices', title: 'MAX78000 Feather board documentation', url: 'https://github.com/analogdevicesinc/MaximAI_Documentation/blob/main/MAX78000_Feather/README.md' },
  { org: 'Texas Instruments', title: 'MSPM0 SDK', url: 'https://github.com/TexasInstruments/mspm0-sdk' },
  { org: 'Espressif', title: 'ESP-IDF (JTAG debugging, fatal errors and core dump guides under docs/en/api-guides)', url: 'https://github.com/espressif/esp-idf' },
];

export default { skills, lessons, labs: [], glossary, troubleshooting, refs };
