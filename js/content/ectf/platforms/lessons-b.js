// eCTF platforms track, lessons 4-6: MSPM0L2228 (eCTF 2026), cross-platform comparison, reading competition docs.
// Every hardware / tooling / year statement is taken from docs/FACTS.md (round 2) or from the primary document cited
// next to it (TI datasheet SLASF94A, TRM SLAU847F, the 2026 rules pages and reference repository). Nothing was run on hardware.
import { S, NOT_LOADED as N, src } from './src.js';

const mspm0 = {
  id: 'ectf-plat-mspm0',
  title: 'Texas Instruments MSPM0L2228 (eCTF 2026)',
  minutes: 65,
  summary: 'A Cortex-M0+ with one 32 KB RAM visible at three addresses, built with TI Arm Clang in Docker and loaded through a MITRE bootloader. Read the memory map before you port a single line.',
  skills: ['ectf-plat-mspm0-map'],
  blocks: [
    `## The problem: two engineers, two RAM addresses, both sure

First week of eCTF 2026. One teammate reviews the reference linker script and flags a "typo": SRAM origin \`0x20200000\`. Every Cortex-M part she has used has RAM at \`0x20000000\`. A second teammate opens TI's datasheet and finds SRAM listed at \`0x20000000\` — and at \`0x20100000\`, and at \`0x20200000\`. A third has a debugger attached and reports that a variable the map file puts at \`0x20200010\` can also be read at \`0x20000010\`.

Nobody is wrong, and nothing is broken. But a design decision is hiding in that address, and you cannot make it until you know what the three ranges are. This lesson works it out from the memory map, then builds the rest of the 2026 platform around it: the board, the bootloader, the build, the debugger and the security features.`,

    `## The chip and the board

- **Core.** Arm Cortex-M0+ (r0p1) with an MPU, a relocatable vector table (VTOR present) and 2 NVIC priority bits, i.e. four interrupt priority levels${src('mspm0l222x.h', S.tiHdr)}. Maximum CPU frequency **32 MHz**; supply 1.62 V to 3.6 V${src('datasheet SLASF94A, Features', S.tiDs)}. The 2026 reference Makefile builds with \`-mcpu=cortex-m0plus -march=thumbv6m -mfloat-abi=soft\`${src('2026 firmware Makefile', S.y2026make)}: ARMv6-M, no floating-point unit, no divide instruction.
- **Main flash.** 256 KB with ECC at **\`0x00000000\`**, organised as two 128 KB banks (bank 1 starts at \`0x00020000\`) that can swap addresses, in 1 KB sectors. Endurance is 100 000 program/erase cycles for the lowest 32 KB and 10 000 for the rest. No data-flash region is listed for this part${src('datasheet Table 8-4 and section 8.10', S.tiDs)}.
- **SRAM.** One 32 KB memory "with ECC or parity", reachable through three address ranges — the subject of the next section.
- **NONMAIN configuration memory.** 1 KB of flash at \`0x41C00000\` holding boot policy: \`BCR_CONFIG\` at \`0x41C00000\` and \`BSL_CONFIG\` at \`0x41C00100\`${src('mspm0l2228.cmd', S.tiCmd, 'datasheet Table 8-4', S.tiDs)}.
- **Peripherals** in the device header: UART0–4, I2C0–2, SPI0–1, a 12-bit ADC, a comparator, a voltage reference, general-purpose timers (TIMG0/4/5/8/12) and an advanced timer (TIMA0), GPIO ports A, B and C, DMA, a segment **LCD** controller, an RTC, a window watchdog, and a battery-backed low-frequency subsystem (**LFSS**)${src('mspm0l222x.h', S.tiHdr)}.
- **Security modules:** **AESADV** (AES accelerator), **TRNG**, **KEYSTORECTL** (key store) and a CRC unit${src('mspm0l222x.h', S.tiHdr)}. Details below.

**The board** is the **MSP-LITO-L2228**, a custom board that TI designed and donated for the competition. It is not sold; MITRE describes TI's LP-MSPM0L2228 LaunchPad as "largely interchangeable" for teams buying extra boards. The debug probe is **not on the board**: an external TI **XDS110** is connected with 8 female-to-female jumper wires, matching the silkscreen labels on both sides, and appears to the host as a serial device${src('2026 board page', S.r26board)}. (The LaunchPad, by contrast, has an XDS110 on board${src('LaunchPad page', S.tiLp)}.) The MSP-LITO-L2228's schematic is distributed to teams and was not read for this course.`,

    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'mspm0l2228' }, caption: 'Compare with the MAX78000 diagram from the last lesson: one core instead of two, a quarter of the RAM, and security blocks with different names.' },

    `## One RAM, three views

The Arm architecture reserves \`0x20000000\`–\`0x3FFFFFFF\` for SRAM and leaves the rest to the vendor. TI maps this part's single 32 KB SRAM into that range **three times**${src('datasheet SLASF94A Table 8-4', S.tiDs, 'TRM SLAU847F section 1.3.2', S.tiTrm)}:

| Address range | View | What an access through it gets |
|---|---|---|
| \`0x20000000\`–\`0x20007FFF\` | Default, **ECC-checked** | 8 check bits per 64 data bits: single-bit errors corrected, double-bit errors detected. Writes take two cycles |
| \`0x20100000\`–\`0x20107FFF\` | **Parity-checked** | 1 parity bit per byte: single-bit errors detected, not corrected |
| \`0x20200000\`–\`0x20207FFF\` | **Unchecked** | No integrity check at all |
| \`0x20300000\`–\`0x20307FFF\` | ECC / parity code | Reads back the check bits themselves |

These are **aliases**: the same physical memory cells answer at each range. In TI's words, writing data to \`0x20000000\` "will cause the same data to appear at" \`0x20200000\`. There are 32 KB in total, not 96.

TI's linker file for the part, and the eCTF 2026 reference \`firmware.ld\`, both declare \`SRAM : origin = 0x20200000, length = 0x8000\`${src('mspm0l2228.cmd', S.tiCmd, '2026 firmware.ld', S.y2026ld)} — the unchecked view. So in the opening scene the linker script has no typo, the datasheet reader is right that \`0x20000000\` is valid RAM, and the debugger shows two views of one cell.

What differs is behaviour under error, and two rules from the TRM that bite in practice:

1. **Pick one view per memory location.** The check bits are written by whichever view you write through. Write through the parity view and read through the ECC view, and the stored code is the wrong kind: "an ECC error may be generated".
2. **Initialise before you read through a checked view.** SRAM contents are random at power-up, so the check bits do not match the data. A read of a never-written location through the ECC or parity view can raise an error and hard-fault the processor.`,

    { t: 'widget', name: 'memory-map', props: { platform: 'mspm0l2228' }, caption: 'Select each of the three SRAM views in turn and compare base, size and error checking. Then use the quiz: which view contains 0x20100124?' },

    { t: 'predict', q: `The reference firmware is linked against the unchecked view, so its start-up code initialises \`.data\` and \`.bss\` through \`0x202xxxxx\` addresses. A teammate adds a "free integrity check": a routine that re-reads one important global through its \`0x200xxxxx\` (ECC-checked) address instead. Nothing else changes. What should you expect?`,
      choices: [
        { t: 'The same bytes are there, but the ECC code for them was never written, so the checked read may report an error or fault', ok: true, why: 'Check bits are only maintained by writes made through a checked view. Data stored through the unchecked view has no valid ECC code, so a checked read of it can flag an error that is not real.' },
        { t: 'A bus fault on every read, because this chip has no memory mapped at 0x20000000', why: 'The datasheet memory map lists 0x20000000 as the default view of the SRAM. The address is valid; think about what an access through that particular view checks.' },
        { t: 'A different value, because 0x20000000 and 0x20200000 are separate 32 KB memories', why: 'The part has 32 KB of SRAM in total. The three ranges are aliases onto the same cells, so the stored bytes are identical whichever range you use.' },
        { t: 'Silent correction of any bit that flipped since boot, because ECC is computed when the read happens', why: 'A read can only compare the data against a code stored at write time. If no code was stored through this view, there is nothing valid to compare with.' },
      ],
      reveal: `The data is the same — aliases share cells — but integrity checking is a property of the *whole history* of a location, not of one read. The ECC code is stored when a write goes through the ECC view. The start-up code and every assignment in the program wrote through the unchecked view, so the code bits for that global are whatever they happened to be. TI's TRM warns against exactly this mixing, and says a checked read of a location not initialised through that view can hard-fault${src('TRM SLAU847F section 1.3.2', S.tiTrm)}.

If you want ECC on some data, do it properly: give that data its own linker region in the \`0x200xxxxx\` range, make sure start-up code initialises it through the same range, decide what the fault handler does when an error is reported, and accept the two-cycle writes. Until then the checked views are not a free upgrade.` },

    { t: 'callout', kind: 'why', title: 'The transferable lesson', md: `"SRAM is at 0x20000000" is a habit, not a fact about Cortex-M, and so is "RAM has one address". The memory map belongs to the *device*. On every new part, open the datasheet's memory-map table and the vendor's linker file together and write down, for flash and RAM: base, size, and **anything listed more than once**. Here that table tells you there is one RAM with three views and different error checking — information a linker script alone would never give you, and a design choice (which view, for which data) you would otherwise not know you had.` },

    { t: 'callout', kind: 'security', title: 'Why a security design cares which view it uses', md: `Fault-injection attacks work by flipping bits: in a comparison result, a loop counter, a "PIN verified" flag. Through the unchecked view a flipped bit in RAM is simply the new value. Through the ECC view a single flipped bit is corrected and a double flip is reported. That makes the checked views one possible layer against glitching *stored* state — with limits: they do not protect CPU registers or the instruction being executed, they only help if the fault handler fails closed, and the cost is slower writes and the initialisation rules above. Whether to use them is a design decision to make deliberately and test on a board you own, not a default to inherit from the reference linker script.` },

    `## The eCTF 2026 layout on top of the chip

The 2026 rules divide the 256 KB of flash like this${src('2026 detailed specifications', S.r26detail)}:`,

    { t: 'ascii', text: `eCTF 2026 flash layout on the MSPM0L2228 (from the rules; SRAM line from firmware.ld)

0x0003FFFF ┌───────────────────────────┐
           │ RESERVED      len 0x0400  │  0x0003FC00   <- reserved for the bootloader
0x0003FC00 ├───────────────────────────┤
           │ APP2          len 0x5800  │  0x0003A400   <- team firmware, second region
0x0003A400 ├───────────────────────────┤
           │ FAT           len 0x0400  │  0x0003A000   <- file allocation table, fixed address
0x0003A000 ├───────────────────────────┤
           │ APP1 (FLASH)  len 0x34000 │  0x00006000   <- team firmware is linked here
0x00006000 ├───────────────────────────┤
           │ BOOTLOADER    len 0x6000  │  0x00000000   <- MITRE eCTF bootloader
0x00000000 └───────────────────────────┘

0x20207FFF ┌───────────────────────────┐
           │ SRAM          len 0x8000  │  0x20200000   <- the unchecked view of the one 32 KB RAM
0x20200000 └───────────────────────────┘

0x41C00100   BSL_CONFIG   (NONMAIN)
0x41C00000   BCR_CONFIG   (NONMAIN)`, caption: 'Check: 0x6000 + 0x34000 + 0x400 + 0x5800 + 0x400 = 0x40000, the whole 256 KB.' },

    `Four things to notice.

1. **You do not own address zero.** A Cortex-M0+ takes its initial stack pointer and reset vector from the vector table, which after reset is at address 0. That is inside the BOOTLOADER region, so MITRE's bootloader runs first and then hands over to the team image at \`0x6000\`; the core's VTOR register is what lets a vector table live there${src('mspm0l222x.h', S.tiHdr)}.
2. **The file allocation table has a fixed address,** \`0x0003A000\`, because, in the reference design's words, "the data structure location must be known by the secure bootloader"${src('2026 firmware.ld', S.y2026ld, 'filesystem.h', S.y2026fs)}. The rules define it as 8 entries of 24 bytes (UUID, length, padding, address). A layout constraint that comes from the specification is not yours to move.
3. **The rules and the reference linker script disagree by one sector.** The published \`firmware.ld\` gives APP2 a length of \`0x5C00\`, which runs to the very end of flash; the rules give \`0x5800\` and reserve the last \`0x400\` bytes for the bootloader. The rules are the specification. If your image grows into APP2, the last sector is not yours — exactly the kind of difference you only find by reading both documents.
4. **The stack is small.** The reference linker script passes \`--stack_size=256\` and places \`.stack\` at the high end of SRAM${src('2026 firmware.ld', S.y2026ld)}: 256 bytes of stack out of 32 KB of RAM. Deep call chains, large local buffers and recursion are design risks here, not style issues.`,

    `## The 2026 system and its requirements

The system is a **Hardware Security Module**: a "permissioned file storage and transfer system". From the rules and the firmware headers${src('2026 functional requirements', S.r26func, '2026 detailed specifications', S.r26detail, 'commands.h', S.y2026cmds, 'filesystem.h', S.y2026fs, 'security.h', S.y2026sec, 'host_messaging.h', S.y2026msg)}:

- The HSM stores **files** in 8 slots: names up to 32 bytes, contents up to 8192 bytes, each with a 16-byte UUID.
- Each file belongs to a 16-bit **group ID**. An HSM holds per-group permissions: \`R\` (read), \`W\` (write), \`C\` (receive), written like \`1234=RW-:aabb=RWC\`.
- A **PIN** of exactly 6 lowercase hex characters protects operations.

| Command | Needs | What it does |
|---|---|---|
| List | PIN | Lists the files on this HSM |
| Read | PIN + read permission for the file's group | Returns a file's contents |
| Write | PIN + write permission | Stores a file in a slot (overwrites it); must survive power loss |
| Listen | no PIN | Serves exactly one request from a neighbouring HSM |
| Interrogate | PIN | Lists the neighbour's files for which this HSM has receive permission |
| Receive | PIN + receive permission | Copies a file (name, UUID, group, contents) from the neighbour |

On the wire, each packet has a header — magic byte \`%\`, a one-byte opcode (\`L\`, \`R\`, \`W\`, \`C\`, \`I\`, \`N\`, plus \`A\` ack, \`D\` debug, \`E\` error) and a 16-bit length. Timing maxima: wake 1 s, list 500 ms, read/write/receive 3 s, interrogate 1 s, and **any operation with an invalid PIN 5 s**.

**Security requirements (three, summarised)**${src('2026 security requirements', S.r26sec)}:

- **SR1.** No file action without a validly provisioned HSM that holds the matching permission for that file's group. (Receive permission also gates Interrogate.)
- **SR2.** No PIN-protected action without prior knowledge of the PIN — and the PIN itself must not leak.
- **SR3.** An HSM only receives files that were generated by a valid HSM with write permission for that group: file integrity and authenticity.

In the attack phase the attacker is modelled as an insider Technician who has one HSM *and its PIN*${src('2026 attack flags', S.r26flags)}. So the PIN is not the last line of defence for other groups' files: permissions (SR1) have to hold against someone who can legitimately log in.

MITRE's README also tells teams **not to fork** the repository: clone it and push to a private repository instead${src('2026 README', S.y2026readme)}. A public fork of your secure design is readable by the teams who will later attack it.`,

    `## Pins, GPIO and peripheral configuration

The reference design uses two UARTs at 115200 baud and two GPIOs${src('ti_msp_dl_config.h', S.y2026dl, 'simple_uart.h', S.y2026uart, '2026 board page', S.r26board)}:

| Function | Peripheral | Pins |
|---|---|---|
| Control interface (host ↔ HSM) | UART0 | PA10 TX, PA11 RX |
| Transfer interface (HSM ↔ HSM) | UART1 | PA8 TX, PA9 RX — crossed TX↔RX between the two boards, shared ground |
| Status LED D1 | GPIO | PB14 |
| Button S2 | GPIO | PB21 (internal pull-up) |

The CPU clock is configured as 32 MHz (\`CPUCLK_FREQ 32000000\`), which is also the part's maximum.

On this family, pin and peripheral setup goes through TI's **driverlib** (the reference Makefile links the driverlib build for \`mspm0l122x_l222x\`${src('2026 firmware Makefile', S.y2026make)}). The reference design's \`ti_msp_dl_config.c\` says in its header that it was generated by TI's **SysConfig** tool; you do not need SysConfig to build the design, but you do need to understand what it generated, because the order matters. The fragment below is condensed from that file${src('ti_msp_dl_config.c', S.y2026dlc)}.`,

    { t: 'code', lang: 'c', status: 'reviewed', caption: 'UART0, the LED and the button on the MSPM0L2228, condensed from the eCTF 2026 reference design\'s SysConfig-generated ti_msp_dl_config.c. Transcribed, not compiled or run here.', code: String.raw`/* 1. Reset, then power the peripherals. An unpowered peripheral ignores register writes. */
DL_GPIO_reset(GPIOA);
DL_UART_Main_reset(UART0);
DL_GPIO_enablePower(GPIOA);
DL_GPIO_enablePower(GPIOB);
DL_UART_Main_enablePower(UART0);
delay_cycles(POWER_STARTUP_DELAY);

/* 2. Route the pads: each has an IOMUX entry selecting GPIO or a peripheral function. */
DL_GPIO_initPeripheralOutputFunction(IOMUX_PINCM25, IOMUX_PINCM25_PF_UART0_TX);  /* PA10 */
DL_GPIO_initPeripheralInputFunction (IOMUX_PINCM26, IOMUX_PINCM26_PF_UART0_RX);  /* PA11 */
DL_GPIO_initDigitalOutput(IOMUX_PINCM35);                                        /* PB14, LED */
DL_GPIO_initDigitalInputFeatures(IOMUX_PINCM63,                                  /* PB21, S2  */
    DL_GPIO_INVERSION_DISABLE, DL_GPIO_RESISTOR_PULL_UP,
    DL_GPIO_HYSTERESIS_DISABLE, DL_GPIO_WAKEUP_DISABLE);
DL_GPIO_setPins(GPIOB, DL_GPIO_PIN_14);
DL_GPIO_enableOutput(GPIOB, DL_GPIO_PIN_14);

/* 3. Clock the UART, set the frame format, then the baud-rate divisors. */
DL_UART_Main_setClockConfig(UART0, &uart_clock_cfg);   /* BUSCLK, divide by 1 */
DL_UART_Main_init(UART0, &uart_cfg);                   /* 8 data bits, no parity, 1 stop bit */
DL_UART_Main_setOversampling(UART0, DL_UART_OVERSAMPLING_RATE_16X);
DL_UART_Main_setBaudRateDivisor(UART0, 17, 23);        /* 115200 baud from 32 MHz */

/* 4. Enable it last. */
DL_UART_Main_enable(UART0);`,
      explain: [
        { lines: '1-7', md: 'MSPM0 peripherals have their own reset and power-enable controls, and need a short delay after power-up. Skipping this is the classic first-day bug on this family: every later write appears to do nothing.' },
        { lines: '9-11', md: 'Pin multiplexing is a separate step. The IOMUX entry is named after the *pad* (`PINCM25` is PA10 on this package), not the port pin, which is why the reference header defines both. If the pad is not switched to the UART function, the UART runs and nothing leaves the chip.' },
        { lines: '12-17', md: 'PB14 becomes a digital output and is driven high before its output driver is enabled, so the LED starts in a known state. PB21 is an input with the internal pull-up: S2 reads 1 when released and 0 when pressed — the level the bootloader samples at reset.' },
        { lines: '19-23', md: 'The UART is clocked from the 32 MHz bus clock with 16× oversampling. The divisor is 32 000 000 / (16 × 115 200) = 17.36: integer part 17, fraction in 64ths ≈ 23. If the clock tree changes, these two numbers must change with it.' },
      ] },

    { t: 'callout', kind: 'mistake', title: 'Talking to the wrong UART', md: `The 2026 design has **two** serial interfaces with different jobs: UART0 on PA10/PA11 is the host control interface, UART1 on PA8/PA9 carries HSM-to-HSM transfers${src('simple_uart.h', S.y2026uart)}. An adapter on the wrong pair, TX and RX not crossed, or two boards without a common ground all look exactly like dead firmware. It also matters for security: the two interfaces face different parties. UART1's peer is *another device*, which in the attack phase may be modified or simulated by the attacker, and the Listen command answers it without any PIN.` },

    `## Development environment and build

**Host software:** Git, Docker and **uv**. The MITRE tools run as \`uvx ectf …\`, so nothing else is installed on the host${src('2026 machine setup', S.r26setup)}. Pre-approved languages are C, C++ and Rust.

The firmware build is a **Docker** image (\`firmware/Dockerfile\`, \`FROM ubuntu:24.04\`) containing the **TI MSPM0 SDK** at tag \`mspm0_sdk_2_06_00_05\` and **TI Arm Clang** \`ti-cgt-armllvm_4.0.3.LTS\` (\`tiarmclang\`, \`tiarmobjcopy\`). It is **not** \`arm-none-eabi-gcc\`${src('2026 Dockerfile', S.y2026docker, '2026 firmware Makefile', S.y2026make)}.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'eCTF 2026 reference build, from the repository and the rules. The volume mounts of docker run are elided: copy the full command from the rules. Not run here.', code: `# 1. build the container image
docker build -t build-hsm ./firmware/

# 2. generate global secrets for your groups (ectf26_design needs Python >= 3.12)
uvx --with-editable ./ectf26_design --from ectf26_design secrets global.secrets <groups>

# 3. build one HSM image with its PIN and permissions
docker run ... -e HSM_PIN='1a2b3c' -e PERMISSIONS='1234=R--:4321=RWC' build-hsm
#   build.sh runs secrets_to_c_header.py, then make -> /out/hsm.elf and /out/hsm.bin`,
      explain: [
        { lines: '5', md: 'Global Secrets are produced once per deployment by the team’s own Python package and are read-only afterwards. Whatever ends up in `global.secrets` is shared by every HSM built from it.' },
        { lines: '8-9', md: 'The PIN and the permission string are per-device build inputs passed as environment variables; a script turns the secrets into a C header that is compiled into the image. Anything in that header is in flash in plain form unless your design does something about it.' },
      ] },

    `Source for the commands${src('2026 README', S.y2026readme, 'root Makefile', S.y2026rootmake, '2026 functional requirements', S.r26func)}.`,

    { t: 'callout', kind: 'decision', title: 'Stay on TI Arm Clang unless you have a reason', md: `TI's SDK supports several compilers — TI Arm Clang, GCC, IAR and Keil${src('SDK tools docs', S.tiTools)} — so building with \`arm-none-eabi-gcc\` is possible in principle. The reference design chose TI Arm Clang, and its linker script, startup code and flags are written for it. Switching compiler means porting those, re-checking code size against a 208 KB team region and a 256-byte stack, and owning every difference in code generation. On a Cortex-M0+ with no divide instruction and no FPU, library routines for division and floating point are supplied by the toolchain, so their size *and timing* depend on the compiler. Make that switch deliberately and early, or not at all.` },

    `## Flashing: bootloader first, then your image

Design-phase boards ship **without** the bootloader. Getting firmware onto a board is therefore two procedures, done with two different tools${src('2026 bootloader page', S.r26boot, '2026 boot reference', S.r26bootref)}.

**Once per board — install the MITRE insecure bootloader with TI UniFlash.**

1. Wire the XDS110 to the board (8 jumpers, labels matching) and plug it in.
2. In UniFlash choose the device **MSPM0L2228** and the connection **Texas Instruments XDS110 USB Debug Probe**. (If UniFlash auto-detects some LaunchPad, ignore it and configure manually.)
3. Select the downloaded \`insecure.out\`. LaunchPad owners use \`launchpad.out\` instead, which uses button S1 (PA18) and a blue LED.
4. Under "Settings & Utilities" choose the erase setting **"Erase MAIN and NONMAIN necessary sectors only"**, then load the image.

**Every time — load your firmware through the bootloader.**

1. Enter **update mode**: reset the board while holding **S2 (PB21)**. You should see LED **D1 (PB14) flashing red**.
2. Use the eCTF tools.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Loading a team image through the eCTF 2026 bootloader, as given in the rules. The port name is an example. Not run here.', code: `uvx ectf hw /dev/ttyACM0 erase
uvx ectf hw /dev/ttyACM0 flash ./build/hsm.bin -n hsm
uvx ectf hw /dev/ttyACM0 start`,
      explain: [
        { lines: '1-2', md: 'The bootloader erases the team region and writes `hsm.bin` into it over the serial link. It only answers in update mode (red flashing LED).' },
        { lines: '3', md: 'Leaves update mode and starts the image. If nothing responds afterwards, the image is running and has a problem of its own — a different failure from "the flash did not work".' },
      ] },

    { t: 'callout', kind: 'warn', title: 'The erase setting is not a detail', md: `UniFlash can erase MAIN flash, NONMAIN, or both. NONMAIN holds the boot policy — debug access, mass-erase and factory-reset permissions, bootstrap-loader configuration. Erasing or misprogramming it is how MSPM0 boards get locked or bricked, which is why the rules name the exact setting to use. On **attack boards** the stakes are higher: they come with a keyed *secure* bootloader that loads encrypted \`.prot\` images. A UniFlash factory reset removes it, and it cannot be put back.` },

    `## Debugging workflow

OpenOCD is the documented **debugging** tool for 2026 — not the flashing tool. (The rules page's paragraph about flashing with OpenOCD is commented out in its source, with a warning that erasing the wrong sector can brick the device.) The MSPM0L2228 needs the latest OpenOCD pre-release; older packaged versions predate the driver${src('2026 OpenOCD page', S.r26openocd, 'OpenOCD mspm0 driver', S.oocdMspm0)}.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Attaching OpenOCD and GDB to the MSPM0L2228 through the external XDS110, from the 2026 rules. Not run here; design-phase boards only.', code: `# terminal 1: OpenOCD over the XDS110 (SWD); leaves a GDB server on port 3333
openocd -s ./share/openocd/scripts/ -f interface/xds110.cfg -f target/ti/mspm0.cfg \\
        -c 'bindto 0.0.0.0; init; halt'

# terminal 2: GDB with the ELF from the Docker build, for symbols
gdb-multiarch ./build/hsm.elf -ex "target extended-remote :3333"`,
      explain: [
        { lines: '2-3', md: '`interface/xds110.cfg` selects the probe, `target/ti/mspm0.cfg` the chip. You should see OpenOCD report a Cortex-M0+ with 4 breakpoints and 2 watchpoints — a budget to plan around.' },
        { lines: '6', md: 'Use the `.elf`, not the `.bin`: the ELF carries the symbols that turn addresses into function and variable names. Remember that variables will show `0x202xxxxx` addresses, the unchecked SRAM view.' },
      ] },

    `Alongside the debugger: the XDS110 also carries a serial channel, the control UART at 115200 baud is your log, and the LED tells you which mode the bootloader is in. TI's own tools — Code Composer Studio and UniFlash — are the vendor alternative${src('SDK tools docs', S.tiTools, 'debug_program.rst', S.tiDebug)}.

## Boot architecture and hardware security

**What runs first.** After reset, TI's ROM boot configuration routine (BCR) runs before any flash code. It applies the policy stored in NONMAIN: the debug policy, any pending mass erase or factory reset, static write protection, an optional **32-bit CRC** check of application flash, and whether to start the bootstrap loader${src('TRM SLAU847F section 1.4.2', S.tiTrm)}. A CRC detects corruption; it is not a signature and says nothing about who wrote the image.

**Debug lock-down.** NONMAIN selects one of three SWD security levels: **0**, no restrictions (the factory default); **1**, custom — application debug, mass erase and factory reset each enabled, password-protected (128-bit) or disabled; **2**, the debug port fully disabled. The critical fields use 16-bit patterns so that a single flipped bit falls to the most secure state rather than the least${src('TRM SLAU847F sections 1.4.1–1.4.2', S.tiTrm)}.

**Bootstrap loader (BSL).** A ROM loader over **UART or I2C**, enabled by default, always protected by a **256-bit password**, and possible to disable in NONMAIN. It starts on the BSL-invoke pin at boot, automatically on a blank device, or on request from software${src('datasheet section 8.34', S.tiDs, 'TRM section 1.4.3', S.tiTrm)}.

**Static write protection.** Per sector for the first 32 sectors of main flash and per 8 sectors after that; NONMAIN can be locked too. Application code and the BSL cannot modify protected sectors — but an SWD mass erase or factory reset **overrides** the protection unless those commands are themselves password-protected or disabled${src('TRM section 1.4.2.3', S.tiTrm)}. Write protection without a debug policy protects against bugs, not against a person with a probe.

**Crypto and keys.** AESADV handles 128-bit blocks with **128- or 256-bit keys** (no 192) in GCM/GMAC, CCM/CBC-MAC, CBC and CTR modes. The **keystore** holds up to four AES keys so that the engine can use a key without software being able to read it; it is meant to be loaded during a Customer Secure Code stage. The TRNG produces 32-bit outputs intended to seed a deterministic generator${src('datasheet sections 8.19–8.21', S.tiDs)}.

**Tamper.** The battery-backed LFSS has an RTC, an independent watchdog, 32 bytes of scratchpad memory and up to three tamper inputs (TIO0–TIO2, package dependent) with event timestamps${src('datasheet', S.tiDs, 'SDK examples', S.tiExamples)}.

**Customer Secure Code (CSC).** TI's MCUboot-based secure-boot stage for this family: ECDSA P-256 with SHA-256 image verification, firewalls, keystore set-up, bank-swap policy and rollback protection, in under 18 kB per bank. It ends by writing \`INITDONE\`, after which its protections are locked in. TI states it "does not guarantee a full secure boot implementation on a device"${src('CSC user guide', S.tiCsc, 'TRM', S.tiTrm)}.`,

    { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, caption: 'Step the MSPM0 boot sequence. Which stages read NONMAIN, and which stages belong to the competition bootloader rather than to TI?' },

    { t: 'callout', kind: 'security', title: 'The chip having a feature does not mean you may use it', md: `On 2026 attack boards the MITRE secure bootloader "functions as a CSC and issues INITDONE", and the rules tell teams to work out from TI's documentation how that affects the hardware security features they plan to use${src('2026 bootloader page', S.r26boot)}. Read that as a warning: anything that can only be configured *before* INITDONE — loading the keystore, setting firewalls — is decided by the stage that runs before you, and that stage is not yours. NONMAIN is in the same position: it is boot policy for a board whose bootloader belongs to the organisers.

Before designing around any of these features: (1) read the 2026 rules on what teams may configure; (2) read TRM section 1.4 so you know which settings are reversible; (3) only then try it, on a design-phase board you can afford to lose. What the secure bootloader verifies internally is not published.` },

    { t: 'callout', kind: 'note', title: 'Still not verified — where to check', md: `| Item | Where to confirm |
|---|---|
| MSP-LITO-L2228 schematic and on-board parts. The user manual MITRE links is for the near-identical MSP-LITO-G3507 | Schematics distributed to teams; that user manual |
| What the MITRE secure bootloader checks and how \`.prot\` images are protected | Not published; only its visible behaviour is documented |
| Exact BCR boot timing and the full NONMAIN field layout | TRM SLAU847, section 1.4 and the NONMAIN register tables |
| Known silicon errata | TI's errata sheet for the MSPM0L222x (not read) |
| Electrical limits of the GPIO pins (thresholds, drive current) | Datasheet SLASF94A, section 7 — read them before wiring anything to another board |

Everything else in this lesson cites the document it came from: [datasheet](${S.tiDs}), [TRM](${S.tiTrm}), [2026 rules](${S.rules}).` },

    `## Hardware limitations to design around

- **32 KB of RAM and a 256-byte stack** in the reference configuration. One 8192-byte file is a quarter of all RAM.
- **32 MHz, no divide instruction, no FPU.** Public-key operations are slow and software division has data-dependent timing — against a 3-second limit for read/write/receive and a 5-second ceiling on a wrong PIN.
- **Flash endurance of 10 000 cycles** outside the lowest 32 KB, in 1 KB sectors. A counter that erases a sector on every event has a budget.
- **Four interrupt priority levels.**
- **An external probe on jumper wires** is your only debug access, and attack boards do not give you even that in a useful form.
- **4 breakpoints and 2 watchpoints** when you do have it.`,

    { t: 'exercise', prompt: `Your team decides to keep the reference design's choice of the unchecked SRAM view. The linker script places the stack at the very top of SRAM, growing downward (the usual full-descending Cortex-M stack). What value must the first word of your image's vector table hold? Give it in hex.`,
      hints: [
        `What does the first vector-table word mean to the processor, and where does a downward-growing stack start?`,
        `With a full-descending stack at the top of RAM, the initial stack pointer is one byte past the last RAM byte. Which view's origin is the image linked against?`,
        `SRAM origin 0x20200000 plus length 0x8000. The result is not itself a RAM address — the first push decrements SP before writing.`,
      ],
      solution: `\`0x20200000 + 0x8000 = 0x20208000\`.

That address is one past the end of RAM, which is correct: a Cortex-M push decrements SP first, so the first stacked word lands at \`0x20207FFC\`.

Three follow-ups. (1) An image linked against the ECC view would hold \`0x20008000\` here — on this chip that is also a legal value, which is exactly why you cannot spot a view mix-up by eye; check that *every* RAM address in the map file starts with the same three hex digits. (2) In the eCTF 2026 layout your vector table is at \`0x6000\`, not at 0, so it is the bootloader's hand-off, not the reset itself, that loads this word. (3) With \`--stack_size=256\`, the stack occupies only \`0x20207F00\`–\`0x20207FFF\`; anything deeper silently overwrites whatever the linker placed below.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?2020[_ ]?8000\\s*$'], nudge: 'Add the SRAM length to the origin of the view the reference linker script uses.' } },

    { t: 'exercise', prompt: `The reference design stores each file in 9 flash pages of 1024 bytes, starting at 0x10000, and allows 8 files. **Assume** the 8 slots are contiguous (confirm this in the filesystem source). (a) What is the first address after the last slot? (b) Does the file area lie entirely inside the team region APP1? (c) File contents are at most 8192 bytes: what does the ninth page suggest? Enter the address for (a) in hex.`,
      hints: [
        `How many bytes is one slot, and how many slots are there?`,
        `One slot is 9 × 1024 bytes; eight slots is 72 × 1024 = 73 728 = 0x12000 bytes. Add that to the start address.`,
        `APP1 runs from 0x6000 to 0x3A000. For (c): 8192 bytes is exactly 8 pages.`,
      ],
      solution: `(a) 8 × 9 × 1024 = 73 728 = \`0x12000\`, so the area ends at \`0x10000 + 0x12000 = 0x22000\`.

(b) Yes: \`0x10000\`–\`0x22000\` is inside APP1, \`0x6000\`–\`0x3A000\`. Note what it implies: under that assumption the file area sits in the middle of the region your code is linked into, so code placed from \`0x6000\` has \`0xA000\` bytes (40 KB) before it would reach the first file slot. Whether the linker script or the code guards against that overlap is something to read in the repository, not to assume. It also straddles the boundary between the two flash banks at \`0x20000\`.

(c) 8192 bytes of contents fill exactly 8 pages, so the ninth page is most plausibly for metadata such as name, group, UUID and length. That is an inference; \`filesystem.h\` is where to confirm it.

The security-relevant observation: files and code share one flash region with no hardware boundary established by the layout itself. What stops a write of file data from landing on code, or a read from returning another group's file, is firmware logic — which is exactly what an attacker examines first.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?0*22000\\s*$'], nudge: 'Start address plus 8 slots of 9 pages of 1024 bytes each.' } },

    { t: 'exercise', prompt: `A teammate wants to run the UART from a 4 MHz clock instead of 32 MHz to save power, keeping 115200 baud and 16× oversampling. Using the method in the code walkthrough (divisor = clock / (16 × baud); integer part, then the fraction in 64ths, rounded): (a) what is the integer divisor? (b) what is the fractional setting? (c) how far off is the resulting baud rate, and is that acceptable? Enter the answer to (b).`,
      hints: [
        `Do the 32 MHz case first and check you get the reference design's 17 and 23.`,
        `4 000 000 / (16 × 115 200) = 2.170. The integer part is 2; the fraction is 0.170.`,
        `0.170 × 64 = 10.9, which rounds to 11. Then compute the real rate: 4 000 000 / (16 × (2 + 11/64)).`,
      ],
      solution: `(a) 4 000 000 / 1 843 200 = 2.1701, so the integer divisor is **2**.

(b) 0.1701 × 64 = 10.89, rounded to **11**.

(c) Actual rate = 4 000 000 / (16 × (2 + 11/64)) = 4 000 000 / 34.75 = 115 108 baud, an error of about −0.08 %. A UART tolerates a few percent of total mismatch between the two ends, so this is fine.

Check of the method against the reference: 32 000 000 / 1 843 200 = 17.361 → 17 and 0.361 × 64 = 23.1 → 23, giving 115 211.5 baud, the figure in the generated file's comment.

The point is not the arithmetic. Baud divisors are derived from the clock, so any change to the clock tree — for power, or because a different oscillator is selected after a fault — silently changes every serial link unless the divisors are recomputed. And slowing the CPU by 8× has a much larger effect on whether your cryptography meets the 3-second limits.`,
      answer: { type: 'number', value: 11, tol: 0 } },

    `## Harder application

The MAX78000 design you might be porting from had 128 KB of RAM, a hardware FPU, 8 interrupt priority levels and 8 KB flash pages. The MSPM0L2228 has 32 KB of RAM, no FPU, four priority levels, 1 KB sectors and 10 000 erase cycles on most of its flash. For a design that (i) buffers a whole 8192-byte file in RAM while verifying it, (ii) uses floating point in a rate limiter, (iii) relies on five distinct interrupt priorities, and (iv) counts failed PIN attempts by erasing and rewriting one flash sector per failure: say for each whether it ports unchanged, ports with a cost, or must be redesigned, and what you would measure to be sure. For (iv), work out how many wrong PINs the sector survives, and what an attacker who can send wrong PINs all day does to a design that stops counting when the sector wears out. Then decide, with reasons, which SRAM view the failed-attempt state should live in while the device is running. Lesson 5 gives you the comparison tool for this.`,

    { t: 'refs', items: [
      { title: 'MITRE eCTF 2026 insecure example (ectfmitre)', url: S.y2026 },
      { title: 'eCTF 2026 rules: MSP-LITO-L2228 board and debugger', url: S.r26board },
      { title: 'eCTF 2026 rules: eCTF bootloader', url: S.r26boot },
      { title: 'eCTF 2026 rules: OpenOCD', url: S.r26openocd },
      { title: 'eCTF 2026 rules: detailed specifications (limits, flash layout)', url: S.r26detail },
      { title: 'eCTF 2026 rules: security requirements', url: S.r26sec },
      { title: 'TI MSPM0L222x / MSPM0L122x datasheet, SLASF94A (memory map: Table 8-4)', url: S.tiDs },
      { title: 'TI MSPM0 L-series technical reference manual, SLAU847F (SRAM views: section 1.3.2; NONMAIN, SWD levels, BSL: section 1.4)', url: S.tiTrm },
      { title: 'TI MSPM0 SDK (repository)', url: S.ti },
      { title: 'MSPM0 SDK: MSPM0L2228 linker command file', url: S.tiCmd },
      { title: 'MSPM0 SDK: Customer Secure Code user guide (source)', url: S.tiCsc },
      { title: 'OpenOCD: MSPM0 flash driver', url: S.oocdMspm0 },
    ] },
  ],
  quiz: [
    { kind: 'arch', q: `A generic Cortex-M linker script with \`RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 32K\` is used unchanged for the MSPM0L2228, with start-up code that initialises all of \`.data\` and \`.bss\`. What does that script actually select on this chip?`,
      choices: [
        { t: 'The ECC-checked view of the same 32 KB that TI’s linker file reaches at 0x20200000', ok: true, why: 'The datasheet maps one SRAM at three ranges. 0x20000000 is the default, ECC-checked view: valid RAM, with slower writes and faults on detected errors.' },
        { t: 'Nothing: the part has no memory there, so the first stack push raises a bus fault before main', why: 'That is true of some chips, but this part’s memory-map table lists 0x20000000 as SRAM. Check the table before assuming a hole.' },
        { t: 'A second, separate 32 KB of RAM, so the chip effectively has 64 KB if both ranges are used', why: 'The ranges are aliases of the same cells. Using two of them for different data would make the data overlap, not double the memory.' },
        { t: 'The parity-checked view, because parity is the default integrity check on Cortex-M0+ parts', why: 'The core does not define RAM checking at all; the device does. On this part the default range is ECC-checked and parity has its own range.' },
      ] },
    { kind: 'concept', q: `The 2026 reference Dockerfile installs \`ti-cgt-armllvm\`. A teammate’s laptop has \`arm-none-eabi-gcc\` and they want to build natively "to save time". What is the strongest argument for using the container?`,
      choices: [
        { t: 'The linker script, startup code and flags target TI Arm Clang at a pinned SDK version', ok: true, why: 'Reproducibility is the purpose of the pinned container. A different compiler changes code generation, runtime library routines and possibly layout, giving an image nobody else has tested.' },
        { t: 'GCC cannot generate code for the Cortex-M0+, which needs a vendor compiler for ARMv6-M', why: 'GCC supports ARMv6-M, and TI’s SDK lists GCC among supported compilers; capability is not the issue.' },
        { t: 'Docker builds finish faster than native builds because the container caches the SDK', why: 'Containers do not speed compilation; the benefit is that everyone builds exactly the same thing.' },
        { t: 'The rules forbid every compiler other than TI Arm Clang for 2026 designs', why: 'The rules pre-approve languages (C, C++, Rust), not a single compiler. Do not assert a rule you have not read.' },
      ] },
    { kind: 'security', q: `A team sets static write protection on the flash sectors holding their key material and leaves the SWD policy at its factory default. Against which attacker does this protect the sectors?`,
      choices: [
        { t: 'Against a bug in their own firmware, but not against someone with a debug probe', ok: true, why: 'Application code and the BSL cannot modify protected sectors, but an SWD mass erase or factory reset overrides the protection unless those commands are password-protected or disabled.' },
        { t: 'Against anyone, since protected sectors cannot be changed until the chip is replaced', why: 'The protection is policy stored in NONMAIN, and the TRM describes debug-port commands that override it when they are left enabled.' },
        { t: 'Against a debug probe, but not against the team’s own firmware writing by mistake', why: 'It is the other way round: static write protection stops code running on the chip, and at the default level the debug port is unrestricted.' },
        { t: 'Against reading the key, because write protection also blocks read access to the sector', why: 'Write protection concerns modification. Whether data can be read out is governed by other mechanisms, such as the debug policy.' },
      ] },
    { kind: 'arch', q: `Your image has grown past APP1 into APP2. The reference \`firmware.ld\` gives APP2 a length of \`0x5C00\`; the 2026 rules give \`0x5800\` and a reserved region at \`0x3FC00\`. Your image ends at \`0x3FD00\`. What follows?`,
      choices: [
        { t: 'The link succeeds, but the last 0x100 bytes sit in a sector the rules reserve for the bootloader', ok: true, why: 'The rules are the specification; the linker script is one implementation of it. A link succeeding shows the script is self-consistent, not that the memory is yours.' },
        { t: 'Nothing: the linker script ships with the reference design, so its region lengths are authoritative', why: 'A reference implementation can differ from the specification. When they disagree, the specification decides what you may use.' },
        { t: 'The link fails, because TI’s linker checks region lengths against the rules’ flash layout', why: 'A linker knows only what its script says. Nothing connects it to the competition’s documentation.' },
        { t: 'The image overflows physical flash, because 0x3FD00 is beyond the end of the 256 KB', why: '256 KB ends at 0x40000, so the address exists. The question is who is entitled to that last sector.' },
      ] },
    { kind: 'code', q: `On this Cortex-M0+ you write \`uint32_t avg = total / count;\` inside a function that compares a PIN attempt. Why might that line deserve a second look on this chip in particular?`,
      choices: [
        { t: 'ARMv6-M has no divide instruction, so it becomes a library call whose time can depend on the operands', ok: true, why: 'Software division routines commonly take data-dependent time; next to secret-dependent code that can become a timing signal worth measuring.' },
        { t: 'Unsigned division is undefined behaviour in C on cores that lack a hardware divider, so the result may vary', why: 'Integer division is fully defined in C whenever the divisor is non-zero; the question is how it is implemented.' },
        { t: 'The M0+ performs division in floating point, which this build has disabled with a soft-float ABI', why: 'Integer division does not go through floating point; the soft-float ABI concerns float and double types.' },
        { t: 'The quotient is only 16 bits wide on this core, so large totals are silently truncated', why: 'The core is 32-bit and `uint32_t` arithmetic is 32-bit; width is unaffected.' },
      ] },
    { kind: 'concept', q: `A teammate with an LP-MSPM0L2228 LaunchPad follows the 2026 bootloader instructions written for the competition board: flashes \`insecure.out\`, holds S2 during reset, and sees no flashing red LED. What is the most likely explanation?`,
      choices: [
        { t: 'The LaunchPad needs the separate `launchpad.out` build, which uses button S1 (PA18) and a blue LED', ok: true, why: '"Largely interchangeable" is not "identical": the boards wire the button and LED differently, so MITRE publishes a second bootloader build for the LaunchPad.' },
        { t: 'LaunchPads cannot run the eCTF bootloader at all, because their XDS110 is on the board rather than external', why: 'Where the probe sits does not change what the MCU can run; the rules provide a bootloader build for the LaunchPad.' },
        { t: 'The LaunchPad carries a different MCU, so an image built for the MSPM0L2228 does not start on it', why: 'The LP-MSPM0L2228 carries the same MSPM0L2228; what differs is the board around the chip.' },
        { t: 'UniFlash erased NONMAIN, which permanently disables the bootloader button on LaunchPad boards', why: 'The button is an ordinary GPIO read by the bootloader. Think about which pin each board connects its button to.' },
      ] },
    { kind: 'security', q: `In the 2026 attack phase the attacker is an insider who holds one legitimate HSM and knows its PIN. Which security requirement does the PIN check, on its own, do least to enforce against that attacker?`,
      choices: [
        { t: 'SR1: file actions require the matching permission for the file’s group', ok: true, why: 'The attacker passes the PIN check legitimately. What must still stop them reading or receiving other groups’ files is the permission system, enforced by something they cannot forge or edit.' },
        { t: 'SR2: PIN-protected actions require prior knowledge of the PIN, which must not leak', why: 'SR2 is the requirement the PIN check implements directly, for HSMs whose PIN the attacker does not have.' },
        { t: 'None: an insider with a valid PIN is out of scope, so no requirement applies to them', why: 'The attack flags describe exactly this attacker. A threat the rules name is in scope by definition.' },
        { t: 'All three equally, because a correct PIN check is sufficient to satisfy every requirement', why: 'The requirements are separate properties. Authentication of a user says nothing about which files that user’s device may touch.' },
      ] },
  ],
};

const compare = {
  id: 'ectf-plat-compare',
  title: 'Cross-platform comparison laboratory: similar architecture is not equivalent hardware',
  minutes: 50,
  summary: 'Put the ESP32, MAX78000 and MSPM0L2228 side by side on ten axes and work out what has to be re-checked when the chip changes.',
  skills: ['ectf-plat-compare'],
  blocks: [
    `## The problem: a porting estimate

Your team has a working secure design on the MAX78000 from eCTF 2025 practice. The 2026 kit is an MSPM0L2228. The captain asks for an estimate: "They're both Arm Cortex-M with a UART, AES and a TRNG. A week to port?"

Both statements in that sentence are true. The estimate is still wrong, and this lesson is about seeing why *before* the week is spent. You will compare three platforms axis by axis, and for each axis decide whether a design decision survives the move, survives with a cost, or has to be made again.`,

    { t: 'widget', name: 'platform-compare', props: {}, title: 'Platform comparison', caption: 'Select axes and read across. Every cell links to its source; cells that could not be verified say so.' },

    `## How to use the comparison

For each axis below, do three things: read the row in the widget, read the notes here, and write one sentence in your notebook of the form "moving from A to B, I must re-check ___ because ___". The table summarises what the fact sheet supports. "Check" means the fact sheet does not establish it, with the document to read.

| Axis | ESP32 family | MAX78000 (eCTF 2024, 2025) | MSPM0L2228 (eCTF 2026) |
|---|---|---|---|
| CPU architecture | Xtensa (ESP32, S3) or RISC-V (C3, C6); 1 or 2 cores | Arm Cortex-M4 with FPU and MPU, plus a RISC-V core started by the Arm core | Arm Cortex-M0+ with MPU; single core |
| Instruction set | Xtensa or RISC-V | ARMv7-M Thumb-2 with hardware floating point; RV32 on the second core (variant: check datasheet) | ARMv6-M Thumb, soft-float; no divide instruction |
| Memory organisation | Program in **external** SPI flash mapped through a cache; internal RAM split into DRAM/IRAM regions | Internal flash \`0x10000000\`, 512 KB, 8 KB pages; SRAM \`0x20000000\`, 128 KB | Internal flash \`0x0\`, 256 KB; SRAM \`0x20200000\`, 32 KB; NONMAIN at \`0x41C00000\` |
| Peripherals | Wi-Fi/Bluetooth radios; pin rules such as strapping pins and input-only pins on the original ESP32 | UART ×4, I2C ×3, SPI ×2, timers ×6, camera interface, CNN accelerator, inter-core semaphores | UART ×5, I2C ×3, SPI ×2, LCD controller, RTC, LFSS, tamper I/O (per SDK examples) |
| Debug interface | JTAG (GPIO12–15 on the original ESP32); built-in USB Serial/JTAG on S3/C3/C6 | On-board MAX32625PICO DAPLink adapter for the Arm core; separate JTAG port for the RISC-V core | XDS110 named by TI's docs, SWD; SWD can be disabled by boot configuration. 2026 board's probe: check rules |
| Development environment | ESP-IDF (v6.1 current at research time), installed with EIM | MSDK with GNU Arm Embedded, RISC-V GCC, ADI OpenOCD; eCTF 2024 Nix + Poetry, 2025 Docker | MSPM0 SDK with driverlib and SysConfig; eCTF 2026 Docker with TI Arm Clang |
| RTOS support | ESP-IDF is built on FreeRTOS | Check the MSDK \`Libraries\` directory and that year's reference design | Check the MSPM0 SDK examples and the 2026 reference design |
| Security features | Secure Boot V2 (RSA-3072 by default), flash encryption (two schemes), eFuse key storage | AES engine with key registers, TRNG, CRC, MPU. Secure boot / ROM bootloader: check datasheet and user guide | AESADV, TRNG, KEYSTORECTL, CRC, MPU; NONMAIN boot policy; TI's CSC secure-boot stage; firewalls |
| Boot process | Mask ROM → second-stage bootloader at a ROM-fixed offset (\`0x1000\` or \`0x0\`) → partition table → app | ROM at \`0x0\` (behaviour: check user guide) → in eCTF 2024/2025, MITRE bootloader at \`0x10000000\` → team image at \`0x1000E000\` | Boot configuration from NONMAIN → in eCTF 2026, bootloader region at \`0x0\` → team image at \`0x6000\` (bootloader details: check rules) |
| Hardware attack surface | External flash bus, strapping pins, serial download mode, JTAG, documented EMFI advisory for v3.0/v3.1 | On-board debug adapter and its mass-erase, second core, I2C bus between boards (2024), serial bootloader | SWD, BSL invoke pin, NONMAIN writes, two UARTs facing different parties (2026), serial bootloader |

Sources: ESP32${src('Kconfig', S.idfKconfig, 'soc.h', S.idfSoc, 'secure-boot-v2', S.idfSb2, 'flash-encryption', S.idfFe, 'GPIO notes', S.idfGpio, 'USB Serial/JTAG', S.idfUsbJtag, 'release', S.idfRelease)}; MAX78000${src('max78000.h', S.maxHdr, 'MSDK user guide', S.msdkGuide, 'MSDK README', S.msdkReadme, 'Feather README', S.maxFthr, '2025 firmware.ld', S.y2025ld)}; MSPM0L2228${src('mspm0l222x.h', S.tiHdr, 'mspm0l2228.cmd', S.tiCmd, 'boot_config.h', S.tiBootCfg, 'CSC guide', S.tiCsc, 'SDK examples', S.tiExamples, '2026 firmware.ld', S.y2026ld)}. The instruction-set rows for the two Arm cores follow from the core type (Cortex-M4 implements ARMv7-M, Cortex-M0+ implements ARMv6-M) and the 2026 Makefile's \`-march=thumbv6m -mfloat-abi=soft\`.`,

    { t: 'callout', kind: 'sim', title: 'What kind of laboratory this is', md: `This is a documentation laboratory. You compare what primary sources say about three chips; the widgets render that information and nothing in them is a measurement. No statement in this lesson comes from running code on any of the three boards.` },

    `## Axis notes: where "the same" hides a difference

**Two Arm cores, two architectures.** The M4 and M0+ share the Cortex-M exception model in outline — a vector table, automatic stacking, an NVIC — which is why porting feels easy. The differences are the ones that bite security code: the M0+ has fewer interrupt priority levels (2 priority bits on this part), no hardware divide, no FPU, and a smaller instruction set, so the same C compiles to different sequences with different timing and size.

**Memory organisation.** Three different answers to "where is flash": external at an offset, internal at \`0x10000000\`, internal at \`0x0\`. Two different answers to "where is RAM" among the Arm parts alone. And a 4× difference in RAM between the two eCTF parts.

**Erase granularity.** 8 KB pages on the MAX78000; the 2026 reference design uses a 1024-byte page size on the MSPM0L2228. Any scheme that stores counters, logs or wrapped keys in flash is designed around this number.

**Security features with similar names.** All three have "AES" and a random number generator. The ESP32's AES is tied into flash encryption with keys in eFuses; the MAX78000 has an AES engine with key registers whose properties you must read; the MSPM0L2228 has an AES accelerator with a separate key store controller. None of these is a drop-in replacement for another: what matters is where the key lives, who can read it back, and what survives reset.

**Boot.** Each chip has code or configuration that runs before yours and that you cannot change (mask ROM; ROM; NONMAIN-driven boot). In the eCTF years there is additionally a MITRE bootloader that owns the start of flash. Your design's root of trust is whichever of these the *rules* let you rely on.`,

    { t: 'predict', q: `Your MAX78000 design defends against PIN brute force with a counter of failed attempts, stored in its own flash page and erased/rewritten on each failure. You port it to the MSPM0L2228 keeping "one page per counter". Before reading on: name two things about this mechanism that change on the new chip, and one that does not.`,
      reveal: `**Changes.** (1) The page is 1024 bytes in the 2026 reference design instead of 8 KB, so the flash cost per counter falls by a factor of eight — but so does the amount of other data that could share the page. (2) Everything about *how* flash is written changes: a different flash controller, different driver calls, different erase/program timing and endurance, and possibly protection features (ECC, write protection) that were absent before. Erase and program times, and how many cycles a page endures, are datasheet numbers you have not read yet for the new part.

**Does not change.** The logic of the defence and its weakness: if an attacker can cut power between "PIN was wrong" and "counter is committed", the attempt is not counted. That is a property of the design's ordering, not of the chip — and it must be re-tested on the new chip because the *window* is set by the new flash's timing.

The pattern: mechanism survives, parameters do not, and the security argument has to be re-run with the new parameters.` },

    { t: 'callout', kind: 'mistake', title: 'Porting the code and assuming the security argument came with it', md: `A secure design is code plus an argument: "this key cannot be read because…", "this comparison is constant-time because…", "this counter cannot be skipped because…". Each "because" rests on hardware facts. Teams port the code, see the functional tests pass, and never revisit the arguments. Functional tests cannot tell you that a constant-time comparison stopped being constant-time when the compiler and core changed, or that a key you believed unreadable now sits in ordinary flash.` },

    { t: 'callout', kind: 'decision', title: 'Put a hardware abstraction layer under the security code, not through it', md: `One response to changing platforms is to write everything against a thin hardware abstraction layer (HAL): \`flash_write_page\`, \`uart_send\`, \`trng_read\`, \`aes_encrypt\`. That is worth doing for I/O. It is dangerous for security primitives if the abstraction hides differences the security argument depends on — for example an \`aes_encrypt\` that uses a hardware key slot on one chip and a key in RAM on another. The choice here: abstract *transport and storage mechanics*, but make key storage, randomness quality and boot trust explicit, per-platform decisions that are written down and reviewed each time.` },

    `## What must be re-checked when you move chips

Use this as the checklist the opening estimate was missing.

1. **Memory map.** Flash base and size, RAM base and size, page size, any regions owned by a bootloader. Update the linker script from the vendor's file, not from memory.
2. **Startup and vector table.** Where the table is, who sets VTOR (or the equivalent), initial stack pointer, stack size against the new RAM budget.
3. **Toolchain.** Compiler, version, flags, runtime library. Rebuild and compare sizes; re-examine any code whose timing matters.
4. **Arithmetic the core no longer does in hardware.** Division and floating point on an M0+ are library calls.
5. **Clocks and timing.** Clock tree, baud-rate divisors, timer prescalers, and every delay or timeout defined in loop counts.
6. **Pins and peripherals.** Pin multiplexing model, power/clock gating for peripherals, electrical limits, boot-strapping or special-function pins.
7. **Interrupt model.** Number of priority levels; which handlers relied on preempting which.
8. **Flash behaviour.** Erase granularity, write alignment, endurance, protection and ECC features.
9. **Randomness.** TRNG presence, how it is started, what health checks the driver performs, throughput.
10. **Key storage.** Where each key lives on the new chip and who can read it: debugger, bootloader, other code.
11. **Debug access.** Probe, protocol, how access is restricted, and whether restricting it is reversible and permitted.
12. **Boot chain.** What runs before you, what it verifies, what it leaves configured.
13. **Rules.** Which hardware features this year's rules allow, require or forbid.
14. **The security arguments.** Re-run each one with the new facts.`,

    { t: 'exercise', prompt: `Return to the captain's estimate. The MAX78000 design has these features: (a) an 8192-byte receive buffer plus a second 8192-byte buffer for decrypted data, both static; (b) a 1 KB stack-hungry signature verification routine called from an interrupt handler; (c) keys loaded into the MAX78000's AES key registers at boot; (d) a UART protocol handler written against a HAL. For each, state whether it ports to the MSPM0L2228 unchanged, with a cost, or needs redesign, citing the fact from the comparison that decides it.`,
      hints: [
        `Start with numbers you have: how much RAM does each chip have, and what stack size does the 2026 reference linker script set?`,
        `(a) is 16 KB of static buffers. (b) needs about 1 KB of stack in handler context. Compare both with 32 KB of RAM and a 256 stack-size setting.`,
        `(c) names a specific peripheral of one chip. What is the corresponding block on the other chip, and do you know its properties yet? (d) is the kind of code a HAL exists for.`,
      ],
      solution: `**(a) Redesign, or at least a cost.** 16 KB of static buffers is half of the MSPM0L2228's 32 KB of SRAM (it was an eighth of the MAX78000's 128 KB). It may fit, but it leaves little for everything else; process the data in place or in chunks instead.

**(b) Redesign.** The 2026 reference linker script sets a stack size of 256; a routine needing about 1 KB of stack does not fit that budget, and running it in an interrupt handler means the worst case stacks on top of whatever was interrupted. Move it out of the handler and size the stack deliberately — and measure, because without an FPU or divide instruction the routine's stack use and run time will both differ from the M4 build.

**(c) Redesign of the decision, not just the code.** The MAX78000's AES key registers and the MSPM0L2228's AESADV plus KEYSTORECTL are different mechanisms. Until you have read the TRM on what the key store protects against, you do not know whether the old argument ("keys are in the hardware key registers") has an equivalent. Also check the rules on whether the feature may be used.

**(d) Ports with a cost.** Rewrite the HAL's UART backend against TI's driverlib (power enable, pin mux, clock, baud divisors), then re-test framing and timeouts at 115200 with the new clock. The protocol logic itself is unchanged.

A week covers (d). Items (a)–(c) are design work, and each ends with re-running a security argument.` },

    `## Harder application

Pick one defence from the security section of this course — a constant-time PIN comparison, an anti-replay counter, or an encrypted-and-authenticated update. Write its security argument as three or four "because" statements. Then, for each of the three platforms in the widget, mark every "because" as *holds from verified facts*, *needs a datasheet/TRM check* (name the chapter), or *does not hold*. You will find the ESP32 column is the best documented and the least like the other two — which is the argument of this whole track in one table.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF v6.1 (docs sources under docs/en)', url: S.idf },
      { title: 'Analog Devices MSDK: MAX78000 device header', url: S.maxHdr },
      { title: 'TI MSPM0 SDK: MSPM0L222x device header', url: S.tiHdr },
      { title: 'TI MSPM0 SDK: MSPM0L2228 linker command file', url: S.tiCmd },
      { title: 'Arm documentation (Cortex-M4 and Cortex-M0+ user guides, ARMv7-M and ARMv6-M reference manuals)', url: N.armDocs, note: 'Not load-tested.' },
    ] },
  ],
  quiz: [
    { kind: 'arch', q: `Two boards both carry "an Arm Cortex-M microcontroller with 256 KB or more of flash and a UART". Which additional fact is the *most* important to obtain before reusing a linker script between them?`,
      choices: [
        { t: 'The base addresses and sizes of flash and RAM on each, plus any region reserved for a bootloader', ok: true, why: 'A linker script is nothing but those numbers. The MAX78000 and MSPM0L2228 differ in every one of them despite fitting the description.' },
        { t: 'The maximum CPU frequency of each', why: 'Clock speed affects timing and baud divisors, not where code and data are placed.' },
        { t: 'Whether each has a hardware AES engine', why: 'Peripheral availability affects drivers; it has no effect on memory placement.' },
        { t: 'The vendor of the debug probe', why: 'The probe determines how you connect, not what addresses the image must be linked for.' },
      ] },
    { kind: 'security', q: `A constant-time comparison routine was reviewed and measured on a Cortex-M4 build. It is recompiled unchanged for a Cortex-M0+ with a different compiler. What is its status?`,
      choices: [
        { t: 'Unverified until re-examined: the compiler and instruction set changed, so the generated code and its timing must be checked again', ok: true, why: 'Constant-time behaviour is a property of the machine code on a given core. New compiler plus new core means a new artefact to inspect and measure.' },
        { t: 'Still constant-time, because the C source did not change', why: 'C does not specify timing. Compilers may introduce branches or call library routines differently on another target.' },
        { t: 'Certainly broken, because the M0+ has no constant-time instructions', why: 'The M0+ can execute constant-time sequences; the point is that you no longer have evidence it does here.' },
        { t: 'Irrelevant, because the M0+ is too slow for timing attacks', why: 'A slower core makes timing differences larger and easier to measure, not harder.' },
      ] },
    { kind: 'concept', q: `Why is the ESP32’s flash encryption feature not a model for how to protect stored secrets on the MAX78000 or MSPM0L2228?`,
      choices: [
        { t: 'It exists to protect an external flash chip using keys in eFuses; the other two have internal flash and different key-storage mechanisms, so the threat and the tools both differ', ok: true, why: 'The feature answers a specific exposure of that architecture. A chip with internal flash has a different exposure and different protections to evaluate.' },
        { t: 'The other two chips have no AES hardware', why: 'Both device headers list an AES block; the difference lies in how storage is exposed and where keys live.' },
        { t: 'Flash encryption is only useful with Wi-Fi', why: 'It protects stored contents regardless of whether any radio is used.' },
        { t: 'Internal flash is always encrypted by the manufacturer', why: 'There is no such general guarantee; whether and how internal flash is protected must be read for each part.' },
      ] },
    { kind: 'arch', q: `Firmware written for a Cortex-M4 part uses six distinct interrupt priority levels to guarantee that a watchdog-feeding timer preempts everything except a tamper handler. On the MSPM0L2228 the device header reports 2 NVIC priority bits. What must happen?`,
      choices: [
        { t: 'The priority scheme has to be redesigned for four levels, deciding which handlers may now share a level and what that does to the guarantee', ok: true, why: 'Two bits give four levels. Six distinct levels cannot be represented, so some preemption relationships disappear and must be reasoned about again.' },
        { t: 'Nothing; the NVIC silently extends to as many levels as software requests', why: 'Unimplemented priority bits are ignored by the hardware, which collapses distinct values onto the same level rather than extending.' },
        { t: 'Interrupts must be replaced by polling on a Cortex-M0+', why: 'The M0+ has a full NVIC; only the number of levels is smaller.' },
        { t: 'The two extra levels can be supplied by the MPU', why: 'The MPU controls memory access permissions, not interrupt preemption.' },
      ] },
    { kind: 'concept', q: `In the comparison table several MAX78000 and MSPM0L2228 cells say "check". What is the correct way to treat such a cell when planning a design?`,
      choices: [
        { t: 'As an open question with a named document to read before any design decision depends on it', ok: true, why: 'An unverified cell is a task, not a fact. Recording where the answer lives turns uncertainty into a bounded piece of work.' },
        { t: 'As "the feature is absent"', why: 'Not having verified something says nothing about whether the silicon has it.' },
        { t: 'As "probably the same as the ESP32"', why: 'The chips come from different vendors with different architectures; similarity is the assumption this lesson warns against.' },
        { t: 'As safe to fill in from a forum post', why: 'Secondary sources can be wrong or describe another part revision; chip facts belong to the datasheet, TRM or vendor SDK.' },
      ] },
  ],
};

const docs = {
  id: 'ectf-plat-docs',
  title: 'Reading competition documentation like an engineer',
  minutes: 45,
  summary: 'Extract the requirements, the hardware definition, the build and flash flow and the host interface from a reference repository and a rules document.',
  skills: ['ectf-plat-read-docs', 'ectf-plat-first-day'],
  blocks: [
    `## The problem: forty pages and a repository, due yesterday

Kick-off day. You receive a rules site with a functional specification, security requirements and getting-started pages; a reference repository with firmware, host tools and build scripts; and a box with a board in it. Three weeks later the teams that are ahead are not the ones who typed fastest. They are the ones who, in the first two days, extracted the right dozen facts and wrote them down where everyone could see them.

This lesson is a method for that extraction. It uses the public reference repositories as the worked material, because those are what this course could actually read. The rules documents themselves were not reachable, so wherever the method says "from the rules", you are being told where to look, not what it says.`,

    `## Two documents, two kinds of authority

| Source | What it is authoritative for | What it is *not* authoritative for |
|---|---|---|
| Rules and specification (MITRE's rules site) | What the system must do, what security properties it must have, what you may and may not change, scoring, phases, the official hardware and flashing procedure | How to implement any of it |
| Reference repository | One working implementation of the functional requirements; the exact build, the host-tool interface, the memory layout, pinned versions | Security. It is *deliberately insecure*. Its behaviour beyond the specification is not a requirement |
| Vendor documentation (datasheet, TRM / user guide, SDK) | What the chip is and does | Anything about the competition |

When they disagree, the rules win over the reference design, and the datasheet wins over everyone on questions of silicon. A constant in the reference code is a *fact about the reference code* until the specification says it is a requirement.`,

    { t: 'callout', kind: 'mistake', title: 'Treating reference-design behaviour as the specification', md: `The 2025 reference decoder defines \`MAX_CHANNEL_COUNT 8\` and always decodes channel 0${src('decoder.c', S.y2025dec)}. Is "8 channels" a requirement or an implementation choice? Is "channel 0 always decodes" a functional requirement or a convenience? You cannot tell from the code. Teams lose points both ways: by breaking a requirement they thought was optional, and by faithfully reimplementing an insecure behaviour they thought was required. Every constant you take from the reference design goes in your notes with a column: "confirmed in spec section …" — empty until you have found it.` },

    `## Extraction 1: functional requirements

Functional requirements say what a correct system does for a legitimate user. Find them from both ends and reconcile.

- **From the rules:** the functional-requirements page. List each requirement as one testable sentence.
- **From the repository:** the host tools. Each host tool or command is a function the system exposes. Their arguments are the interface; their help strings often name the concept.

Worked example, eCTF 2024, from the repository alone: the host tools are \`ectf_list\`, \`ectf_boot\`, \`ectf_replace\` and \`ectf_attestation\`${src('2024 README', S.y2024readme)}. So the system must at least: list components, boot, replace a component given a token, and return attestation data given a PIN. Four tools, four functional areas — and two of them take a secret, which is your first pointer to the security requirements.`,

    `## Extraction 2: security requirements

Security requirements say what an attacker must *not* be able to do. They live in the rules, not in the repository. For each one, write down:

1. **The asset** it protects (a key, a file's contents, the ability to perform an action).
2. **The attacker** it assumes (remote over the interface? holding the device? holding a *different* legitimate device?).
3. **The mechanism in the reference design** that fails to provide it — find the exact lines.
4. **How you would test** that your design provides it.

Then map every functional operation to the requirements that constrain it. An operation constrained by none is suspicious: either you missed a requirement or the operation is an unguarded entry point.

For 2024, 2025 and 2026 the named requirements are not reproduced in this course because the rules site could not be opened. The reference repositories give you only hints: in 2026, the firmware headers define a PIN, per-group permissions \`R\`/\`W\`/\`C\` and a file store${src('security.h', S.y2026sec, 'filesystem.h', S.y2026fs)}, so expect the requirements to be about who may read, write and receive which files, and what the PIN protects — then go and read what they actually say.`,

    { t: 'predict', q: `From the 2026 firmware headers alone you know there are six host-visible commands (LIST, READ, WRITE, RECEIVE, INTERROGATE, LISTEN), a 6-hex-character PIN, and two UARTs: one facing the host, one facing another HSM. Before reading the specification: which interface do you expect an attacker to find more interesting, and what question would you take to the rules to find out whether you are right?`,
      reveal: `There is no certain answer without the rules — which is the point — but an engineer's prior is that the **HSM-to-HSM transfer interface** deserves at least as much attention as the host interface. The host interface is the obvious front door and is where a PIN is naturally checked. The transfer interface connects your device to *another device*, which in an attack phase may be one the attacker controls or has modified. Commands like RECEIVE, INTERROGATE and LISTEN${src('commands.h', S.y2026cmds)} suggest one HSM asking another for data.

Questions to take to the rules: Which operations require the PIN, and on which device is it entered? What may an HSM learn from a peer without any PIN? What does the specification say an attacker-controlled peer must not be able to obtain? Is the peer assumed to be a genuine HSM from the same deployment?

Forming the question first is what makes a forty-page document quick to read: you are searching, not absorbing.` },

    `## Extraction 3: the hardware definition

From the repository's build files you can pin down the hardware more reliably than from prose:

- **MCU:** compiler defines and CPU flags. 2026: \`-D__MSPM0L2228__\`, \`-mcpu=cortex-m0plus\`${src('2026 firmware Makefile', S.y2026make)}. 2024/2025: \`BOARD=FTHR_RevA\` selects the board support package${src('2025 README', S.y2025readme)}.
- **Memory layout:** the linker script. Regions, their names, and comments such as "Bootloader flash - unusable"${src('2026 firmware.ld', S.y2026ld)}.
- **Pins and interfaces:** board or configuration headers. 2026: two UARTs with their pins, an LED, a button${src('ti_msp_dl_config.h', S.y2026dl)}. 2024: which I2C instance and at what speed${src('simple_i2c_controller.h', S.y2024i2c)}.
- **SDK and versions:** the Dockerfile or environment file.

What the repository will *not* tell you: the board's name, its on-board debugger, its jumpers, what else is on the PCB, and what is in the kit. That is the rules' hardware page and the board's user guide. The 2026 board name is the standing example: the repository proves the MCU only.`,

    `## Extraction 4: the build and flash flow

Write the flow as a pipeline with inputs and outputs at every stage, because every arrow is a place where a secret is created, copied or exposed.`,

    { t: 'ascii', text: `eCTF 2026 reference flow (from the README, Makefile, Dockerfile and build.sh)

 group list ──► [secrets generator: ectf26_design, via uvx] ──► global.secrets
                                                                    │
 HSM_PIN, PERMISSIONS (env) ─────────────────────────────┐          │
                                                         ▼          ▼
 firmware source ──► [Docker: build-hsm image] ──► secrets_to_c_header.py ──► generated C header
   TI Arm Clang 4.0.3 LTS, MSPM0 SDK 2_06_00_05              │
                                                             ▼
                                                           make ──► hsm.elf, hsm.bin
                                                                        │
                                              [flash procedure: see 2026 rules] ──► board`, caption: 'Every box is a tool, every label on an arrow is an artefact. The last arrow is deliberately unspecified: the 2026 flashing procedure was not verified.' },

    `Questions this diagram makes you ask: Who can read \`global.secrets\`? Is it the same for every HSM in a deployment? What exactly ends up in the generated header, and is it in the binary in plain form? Is the PIN stored, or something derived from it? Does anything differ between two HSMs built from the same secrets other than PIN and permissions? You answer these by reading \`secrets_to_c_header.py\` and the generated header — then by looking for those bytes in \`hsm.bin\`.

Do the same exercise for the year you are working on. The 2024 and 2025 pipelines are in lesson 3.`,

    { t: 'callout', kind: 'security', title: 'The build is part of the attack surface', md: `In the attack phase, other teams receive your design's artefacts under whatever terms the rules define. Anything the build bakes into every image, or derives predictably from public inputs, should be assumed known. Defence: list every secret in the pipeline, state for each which artefacts contain it and who receives those artefacts, and keep per-device secrets genuinely per-device. Verify by building two devices with different inputs and comparing the binaries: the differences should be exactly the ones you intended.` },

    `## Extraction 5: the host-tool interface

The host tools define the wire protocol, and you do not get to change them (the 2025 tools package is marked "DO NOT MODIFY"${src('2025 README', S.y2025readme)}). From the reference firmware and tools, extract:

- **Framing.** 2026: header of magic byte \`%\`, one command byte and a \`uint16_t\` length${src('host_messaging.h', S.y2026msg)}.
- **Opcodes** and the direction of each.
- **Maximum sizes.** 2026: name 32, contents 8192${src('filesystem.h', S.y2026fs)}. 2025: frame 64 bytes${src('decoder.c', S.y2025dec)}.
- **Serial parameters.** 115200 baud in 2025 and 2026.
- **Acknowledgement and error behaviour.** 2026 has ACK, DEBUG and ERROR message types.

Every field in that list is attacker-controlled input. A 16-bit length field can claim 65 535 bytes for a buffer that holds 8192; what the reference firmware does with such a packet is one of the first things an attacker will try, and one of the first things you should read.`,

    { t: 'callout', kind: 'decision', title: 'Write the platform brief before writing firmware', md: `It is tempting to start coding from the reference design on day one. The alternative chosen here is to spend the first day producing a short written brief — memory map, boot flow, flash/debug procedure, toolchain, security features with limits, requirement table — with a citation for every line. It feels slower. It is faster by the end of the first week, because every design discussion that follows refers to the same agreed facts, and every "I thought it was…" is settled by a link rather than by an argument.` },

    `## First day on a new platform: the checklist

1. **Identify the authority.** Find this year's rules, the correct reference repository (check the organisation name), and the vendor's datasheet, reference manual and SDK. Record URLs and versions.
2. **Pin the part.** MCU part number from the build flags; board name from the rules. If they do not obviously agree, ask.
3. **Memory map.** Flash and RAM base and size from the vendor's linker file; then the competition layout from the reference linker script. Draw it.
4. **Boot flow.** What runs before your code, who owns it, what it checks, how it hands over.
5. **Build.** Reproduce the reference build in its container, unchanged. Record compiler and SDK versions.
6. **Flash.** Follow the official procedure exactly once with the unmodified reference image.
7. **Talk to it.** Run every host tool against the reference image. Capture one exchange per command.
8. **Debug access.** What probe, what software, what the rules allow in each phase.
9. **Requirements table.** One row per functional and security requirement: asset, attacker, reference-design weakness, test.
10. **Security features inventory.** For each hardware feature: what it does, its documented limits, whether the rules permit it. "Not yet read" is an acceptable entry; a guess is not.
11. **Constraints list.** RAM, stack, flash, page size, timing limits in the specification.
12. **Open questions.** Everything you could not establish, with the document or person that can answer it.

Steps 5–7 need the board. Steps 1–4 and 8–12 need only documents, and can be done before the kit arrives.`,

    { t: 'exercise', prompt: `Using only facts quoted in this track from the 2025 reference repository, fill in this host-interface summary for the Decoder and identify one field an attacker fully controls that the firmware must validate: (a) physical link and speed; (b) the three commands; (c) the size of a frame; (d) the fields of a subscription. Then state which of these you would still need to confirm in the 2025 specification before treating it as a requirement.`,
      hints: [
        `Lesson 3 gives the link (serial through the bootloader/flash tool at a stated baud rate) and the decoder's three commands.`,
        `Frames are 64 bytes; subscriptions carry four fields. Which of those fields decides *whether a frame may be decoded*?`,
        `For the last part, apply the rule from this lesson: a constant in reference code is a fact about the reference code until the specification confirms it.`,
      ],
      solution: `(a) Serial (UART) between the host's TV process and the Decoder, 115200 baud. (b) List channels, update subscription, decode frame. (c) 64 bytes (\`FRAME_SIZE 64\`). (d) Device ID, start timestamp, end timestamp, channel.

Attacker-controlled fields that must be validated: essentially all of them, but the instructive ones are the **channel number** in a decode request (the reference design has 8 channel slots and treats channel 0 specially — what happens for channel 9, or 0xFFFFFFFF?), the **timestamps** in both subscriptions and frames, and the **device ID** in a subscription (is this subscription really for *this* decoder?). An update-subscription message is the most valuable target because it changes what the decoder will agree to decode later.

Still to confirm in the 2025 specification before calling anything a requirement: the maximum channel count, the special status of channel 0, the frame size, the exact subscription format, and the baud rate. All five are true of the reference code; this course did not open the specification to see which are mandated.` },

    `## Harder application

Choose a reference repository from a year you have *not* studied in this track — 2023 (PARED: car and fob) is a good one, since its README and Makefile are short. Without reading any write-ups, produce checklist items 1–4 and 9 from the repository and the TM4C123GH6PM documentation: part and board, memory map, boot flow, and a requirements table in which the "security requirement" column is your own inference from the system's purpose, clearly marked as inference. Then find that year's actual rules, if you can reach them, and mark where your inference was wrong. The gap between the two columns is the measure of how much a reference design does not tell you.`,

    { t: 'refs', items: [
      { title: 'MITRE eCTF 2026 insecure example (ectfmitre)', url: S.y2026 },
      { title: 'MITRE eCTF 2025 insecure example', url: S.y2025 },
      { title: 'MITRE eCTF 2024 insecure example', url: S.y2024 },
      { title: 'MITRE eCTF 2023 insecure example', url: S.y2023 },
      { title: 'MITRE eCTF rules site', url: S.rules, note: 'Not load-tested; the authority for requirements, hardware and procedures.' },
      { title: 'MITRE eCTF home page', url: N.ectf, note: 'Not load-tested.' },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `The reference firmware accepts file names up to 32 bytes. Your design would be simpler with a 16-byte limit. How do you decide whether that is allowed?`,
      choices: [
        { t: 'Find the name-length statement in the functional specification; the reference constant alone does not make 32 a requirement or an option', ok: true, why: 'A reference implementation shows one compliant behaviour. Only the specification says which of its properties are mandatory.' },
        { t: 'It is allowed, because the reference design is only an example', why: 'The reference design may well reflect a mandatory limit; "example" does not mean every constant is optional.' },
        { t: 'It is forbidden, because every reference constant is a requirement', why: 'Reference code contains many incidental choices; treating all of them as requirements imports its insecure behaviour too.' },
        { t: 'Test whether the host tools still work with 16', why: 'Host tools passing on your inputs shows nothing about the cases the organisers’ tests will use.' },
      ] },
    { kind: 'security', q: `While mapping requirements to operations you find a command in the reference firmware that no security requirement appears to constrain. What is the best next step?`,
      choices: [
        { t: 'Treat it as a likely entry point: re-read the requirements for one you missed, and examine what the command reveals or changes without authorisation', ok: true, why: 'An operation with no guard is either covered by a requirement you overlooked or genuinely unprotected; both deserve attention before an attacker gives it.' },
        { t: 'Remove the command to reduce attack surface', why: 'If the functional specification requires it, removing it fails functional tests; check before deleting.' },
        { t: 'Ignore it, since unconstrained means out of scope', why: 'Attackers are not limited to operations the requirements mention; unguarded paths are where they start.' },
        { t: 'Add a PIN check to it', why: 'A guard not called for by the specification may break required behaviour, such as an operation that must work without the PIN.' },
      ] },
    { kind: 'arch', q: `You need the flash base address of this year’s MCU. Which source do you trust first, and why?`,
      choices: [
        { t: 'The vendor’s linker file or device header for that exact part, cross-checked against the reference design’s linker script', ok: true, why: 'The vendor’s files define the silicon’s map; the reference script shows the competition’s layout on top. Agreement between them is your confidence.' },
        { t: 'Last year’s notes, since eCTF usually keeps the same chip', why: 'The history shows the platform changes often, and even a repeated chip is no guarantee the layout is unchanged.' },
        { t: 'A forum answer about the same core type', why: 'The memory map belongs to the device, not the core; two parts with the same core can place memory differently.' },
        { t: 'Whatever address makes the reference build link without errors', why: 'A link succeeding proves only that the script is self-consistent, not that memory exists at those addresses.' },
      ] },
    { kind: 'security', q: `In the 2026 build flow, \`secrets_to_c_header.py\` converts secrets into a C header compiled into the firmware. What should a designer conclude?`,
      choices: [
        { t: 'Whatever is in that header is in the image; unless the design protects it, anyone who obtains the binary or reads flash obtains it', ok: true, why: 'Compiling a value into firmware places it in flash. Its confidentiality then rests on who can get the binary and who can read the chip.' },
        { t: 'Header files are not part of the binary, so the secrets stay on the build machine', why: 'A header’s definitions are compiled into the objects that include it; they end up in the output image.' },
        { t: 'Docker encrypts build outputs automatically', why: 'Containers isolate the build environment; they apply no protection to the files the build produces.' },
        { t: 'The secrets are safe because the reference design was written by MITRE', why: 'The reference design is intentionally insecure; its authorship is no evidence of protection.' },
      ] },
    { kind: 'concept', q: `Which first-day checklist items can be completed before the hardware kit arrives?`,
      choices: [
        { t: 'Identifying sources, pinning the part, drawing the memory map and boot flow, and building the requirements table', ok: true, why: 'All of these are done from documents and the repository. Only building against real hardware, flashing and exercising the host tools need the board.' },
        { t: 'None; nothing useful can be done without the board', why: 'Most of the early work is reading and recording, which needs no hardware at all.' },
        { t: 'Only installing the toolchain', why: 'Toolchain setup is one item, but the map, boot flow and requirements are equally document-based.' },
        { t: 'All twelve, by simulating the board', why: 'Flashing the real image and capturing real host-tool exchanges cannot be signed off from documents; saying otherwise would overstate what was done.' },
      ] },
  ],
};

export default [mspm0, compare, docs];
