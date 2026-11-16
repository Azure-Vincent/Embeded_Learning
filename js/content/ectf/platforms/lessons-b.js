// eCTF platforms track, lessons 4-6: MSPM0L2228 (eCTF 2026), cross-platform comparison, reading competition docs.
// Every hardware / tooling / year statement is taken from docs/FACTS.md. Nothing here was run on hardware.
import { S, NOT_LOADED as N, src } from './src.js';

const mspm0 = {
  id: 'ectf-plat-mspm0',
  title: 'Texas Instruments MSPM0L2228 (eCTF 2026)',
  minutes: 55,
  summary: 'A Cortex-M0+ whose RAM starts at 0x20200000, built with TI Arm Clang in Docker. Read the memory map before you port a single line.',
  skills: ['ectf-plat-mspm0-map'],
  blocks: [
    `## The problem: a HardFault before main

You have a tidy bare-metal project from the MAX78000: startup code, a linker script, a UART driver behind a small interface. For eCTF 2026 you change the compiler flags to Cortex-M0+, swap the UART driver, keep the linker script's RAM line — \`0x20000000\`, as on every Cortex-M part you have used — and flash it. The processor faults before \`main\` is reached.

Nothing is wrong with the C. The chip has no RAM at that address.`,

    `## The chip

- **Core.** Arm Cortex-M0+ (r0p1) with an MPU, a relocatable vector table (VTOR present) and 2 NVIC priority bits, i.e. four interrupt priority levels${src('mspm0l222x.h', S.tiHdr)}. The 2026 reference Makefile builds with \`-mcpu=cortex-m0plus -march=thumbv6m -mfloat-abi=soft\`${src('2026 firmware Makefile', S.y2026make)}: ARMv6-M, no floating-point unit.
- **Main flash.** Origin **\`0x00000000\`**, length \`0x40000\` (256 KB)${src('mspm0l2228.cmd', S.tiCmd)}.
- **SRAM.** Origin **\`0x20200000\`** — *not* \`0x20000000\` — length \`0x8000\` (32 KB)${src('mspm0l2228.cmd', S.tiCmd)}.
- **NONMAIN configuration memory.** A separate flash region holding boot configuration: \`BCR_CONFIG\` at \`0x41C00000\` and \`BSL_CONFIG\` at \`0x41C00100\`${src('mspm0l2228.cmd', S.tiCmd)}.
- **Peripherals** in the device header: UART0–4, I2C0–2, SPI0–1, ADC0, a comparator, a voltage reference, general-purpose timers (TIMG0/4/5/8/12) and an advanced timer (TIMA0), GPIO ports A, B and C, DMA, an **LCD** controller, an RTC, a window watchdog, and a low-frequency subsystem (**LFSS**)${src('mspm0l222x.h', S.tiHdr)}.
- **Security modules** in the device header: **AESADV** (an AES accelerator), **TRNG**, **KEYSTORECTL** (a key store controller) and a CRC unit${src('mspm0l222x.h', S.tiHdr)}.`,

    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'mspm0l2228' }, caption: 'Compare with the MAX78000 diagram from the last lesson: one core instead of two, a quarter of the RAM, and security blocks with different names.' },

    `## The unusual SRAM base

Many Cortex-M microcontrollers place SRAM at \`0x20000000\`. The Arm architecture reserves the range \`0x20000000\`–\`0x3FFFFFFF\` *for* SRAM; it does not say where inside that range a vendor must put it. TI put this part's SRAM at \`0x20200000\`.

So the valid RAM addresses are \`0x20200000\` up to, but not including, \`0x20208000\`. Everything a linker script or startup file derives from the RAM base moves with it: where \`.data\` is copied to, where \`.bss\` is zeroed, where the heap starts, and the initial stack pointer in the first word of the vector table.`,

    { t: 'widget', name: 'memory-map', props: { platform: 'mspm0l2228' }, caption: 'Use the "where does this address live?" quiz. Try 0x20000000, 0x20200000 and 0x20207FFC before reading on.' },

    { t: 'predict', q: `Take the opening scenario: the linker script still says RAM starts at 0x20000000 with length 0x8000, so the vector table's first word (the initial stack pointer) is 0x20008000. On a Cortex-M, the reset handler is ordinary C-callable code. At what point does the processor first fault, and why does it happen *before* any of your C statements run?`,
      choices: [
        { t: 'At the first stack access or the first write of .data/.bss in the startup code, because those addresses are not backed by memory on this part', ok: true, why: 'Reset loads SP and PC without touching RAM. The first push, or the first store while initialising .data/.bss, addresses memory that does not exist and raises a fault.' },
        { t: 'At reset itself, because the core validates the stack pointer when loading it', why: 'The core loads the initial SP value from the vector table without checking that memory exists there; nothing is accessed until an instruction uses it.' },
        { t: 'Never — writes to unmapped addresses are ignored and reads return zero', why: 'Some buses behave that way, but you cannot assume it; a Cortex-M normally raises a fault on an access to an address with no memory behind it.' },
        { t: 'Only when the heap is first used', why: 'The stack and the static data initialisation both come long before any heap use, and both use the wrong base.' },
      ],
      reveal: `The core fetches the initial SP from the first vector-table word and the reset vector from the second, then starts executing. The startup code runs before \`main\`: it copies \`.data\` from flash to RAM and zeroes \`.bss\`, and any function prologue pushes to the stack. With the base wrong, the first of those accesses hits an address with no RAM behind it.

The symptom is easy to misread as "the board is dead" or "the flash failed", because no output ever appears. The check takes one minute: compare the RAM \`ORIGIN\` in your linker script with the vendor's linker file${src('mspm0l2228.cmd', S.tiCmd)}, and look at the first vector-table word of your image — it must lie between \`0x20200000\` and \`0x20208000\` inclusive of the top.` },

    { t: 'callout', kind: 'why', title: 'The transferable lesson', md: `"SRAM is at 0x20000000" was never a fact about Cortex-M; it was a habit formed on particular chips. The memory map is defined by the *device*, not by the core. On every new part, open the vendor's linker file or device header and write down flash base, flash size, RAM base and RAM size before you write or port anything. It costs minutes and removes a whole class of faults that look like hardware failure.` },

    `## The eCTF 2026 layout on top of the chip

The 2026 reference \`firmware.ld\` divides the 256 KB of flash${src('2026 firmware.ld', S.y2026ld)}:`,

    { t: 'ascii', text: `eCTF 2026 reference layout on the MSPM0L2228 (from firmware.ld)

0x0003FFFF ┌───────────────────────────┐
           │ APP2          len 0x5C00  │  0x0003A400
0x0003A400 ├───────────────────────────┤
           │ FAT           len 0x0400  │  0x0003A000   <- file allocation table, fixed address
0x0003A000 ├───────────────────────────┤
           │ FLASH (team)  len 0x34000 │  0x00006000   <- your firmware is linked here
0x00006000 ├───────────────────────────┤
           │ BOOTLOADER    len 0x6000  │  0x00000000   <- "Bootloader flash - unusable"
0x00000000 └───────────────────────────┘

0x20207FFF ┌───────────────────────────┐
           │ SRAM          len 0x8000  │  0x20200000
0x20200000 └───────────────────────────┘

0x41C00100   BSL_CONFIG   (NONMAIN)
0x41C00000   BCR_CONFIG   (NONMAIN)`, caption: 'Check: 0x6000 + 0x34000 + 0x400 + 0x5C00 = 0x40000, the whole 256 KB. The linker script also sets a stack size of 256.' },

    `Three things to notice.

1. **You do not own address zero.** A Cortex-M0+ takes its initial stack pointer and reset vector from the vector table, which after reset is at address 0. That is inside the BOOTLOADER region, so something there runs first and then transfers control to the team image at \`0x6000\`; the core has a VTOR register that lets the vector table be moved${src('mspm0l222x.h', S.tiHdr)}. *How* the 2026 MITRE bootloader does this, how it is installed and how it is put into update mode are **not verified here** — confirm in the 2026 rules (${S.rules}, not load-tested).
2. **The file allocation table has a fixed address,** \`0x0003A000\`, because, in the reference design's words, "the data structure location must be known by the secure bootloader"${src('2026 firmware.ld', S.y2026ld, 'filesystem.h', S.y2026fs)}. A layout constraint that comes from the functional specification is not yours to move.
3. **The stack is small.** With 32 KB of RAM in total and a 256 setting for stack size in the reference linker script, deep call chains, large local buffers and recursion are design risks, not style issues. (Confirm the unit and how the script uses that value in \`firmware.ld\` itself.)`,

    `## The 2026 system

The reference design is "an insecure example design for an eCTF Hardware Security Module". From the firmware headers${src('commands.h', S.y2026cmds, 'filesystem.h', S.y2026fs, 'security.h', S.y2026sec, 'host_messaging.h', S.y2026msg)}:

- The HSM stores **files** in slots: up to 8 files, names up to 32 bytes, contents up to 8192 bytes, each with a 16-byte UUID.
- Each file belongs to a 16-bit **group ID**. An HSM holds per-group permissions: \`R\` (read), \`W\` (write), \`C\` (receive); up to 8 permission entries.
- A **PIN** of 6 hex characters protects operations.
- Commands, as one-byte opcodes: LIST \`L\`, READ \`R\`, WRITE \`W\`, RECEIVE \`C\`, INTERROGATE \`I\`, LISTEN \`N\`; plus ACK \`A\`, DEBUG \`D\` and ERROR \`E\`. Each packet has a header: magic byte \`%\`, the command byte and a 16-bit length.
- The reference design stores each file in 9 flash pages of 1024 bytes, starting at \`0x10000\`.

The **named security requirements** for 2026 are on the rules site and were not opened. Search-engine summaries of them exist but disagree with each other on wording, so this course does not quote them. Read the 2026 specification pages yourself.

MITRE's README also tells teams **not to fork** the repository: clone it and push to a private repository instead${src('2026 README', S.y2026readme)}. A public fork of your secure design is readable by the teams who will later attack it.`,

    `## Pins, GPIO and serial configuration

The reference design uses two UARTs at 115200 baud and two GPIOs${src('ti_msp_dl_config.h', S.y2026dl, 'simple_uart.h', S.y2026uart)}:

| Function | Peripheral | Pins |
|---|---|---|
| Control interface (host ↔ HSM) | UART0 | PA10 TX, PA11 RX |
| Transfer interface (HSM ↔ HSM) | UART1 | PA8 TX, PA9 RX |
| Status LED | GPIO | PB14 |
| Button S2 | GPIO | PB21 |

The CPU clock is configured as 32 MHz (\`CPUCLK_FREQ 32000000\`). That is what the reference design configures; it is not confirmed here as the part's maximum — see the datasheet's clock specifications.

On this family, pin and peripheral setup goes through TI's **driverlib** (the reference Makefile links the driverlib build for \`mspm0l122x_l222x\`${src('2026 firmware Makefile', S.y2026make)}). TI's SDK also provides **SysConfig**, a graphical tool that generates configuration code${src('SDK tools docs', S.tiTools)}. The reference design's \`ti_msp_dl_config.h\` carries the file name SysConfig conventionally generates; whether MITRE generated it with SysConfig or wrote it by hand is not something the fact sheet establishes, and you do not need SysConfig to build the reference design.

Whichever way the code is produced, bringing up a UART on an MSPM0 follows this order. The function names are from memory of TI's driverlib and are **not verified here**: confirm each in the SDK's \`dl_gpio.h\` and \`dl_uart_main.h\`, and copy the real sequence from the reference design's configuration source.`,

    { t: 'code', lang: 'c', status: 'pseudo', caption: 'Order of operations for a UART on MSPM0 driverlib. Illustrative; names and arguments must be checked against the SDK headers.', code: String.raw`/* 1. Power the peripherals. An unpowered peripheral ignores register writes. */
DL_GPIO_enablePower(GPIOA);
DL_UART_Main_enablePower(UART0);

/* 2. Route the pins. Each pad has an IOMUX entry selecting GPIO or a peripheral function. */
DL_GPIO_initPeripheralOutputFunction(IOMUX_PA10, IOMUX_PA10_FUNC_UART0_TX);
DL_GPIO_initPeripheralInputFunction (IOMUX_PA11, IOMUX_PA11_FUNC_UART0_RX);

/* 3. Give the UART a clock, then frame format and baud-rate divisors for 115200 at that clock. */
DL_UART_Main_setClockConfig(UART0, &uart_clock_cfg);
DL_UART_Main_init(UART0, &uart_cfg);
/* ...baud-rate divisor call, computed from the UART clock... */

/* 4. Enable it last. */
DL_UART_Main_enable(UART0);`,
      explain: [
        { lines: '1-3', md: 'MSPM0 peripherals have their own power-enable control. Skipping this is the classic first-day bug on this family: every later write appears to do nothing.' },
        { lines: '5-7', md: 'Pin multiplexing is a separate step from peripheral setup. The pad for PA10 must be told it carries UART0 TX; otherwise the UART runs and nothing leaves the chip. The macro names here are placeholders.' },
        { lines: '9-12', md: 'The divisors depend on the UART’s clock source and frequency. If the clock tree changes (for example from the 32 MHz the reference design configures), the baud rate changes with it.' },
      ] },

    { t: 'callout', kind: 'mistake', title: 'Talking to the wrong UART', md: `The 2026 reference design has **two** serial interfaces with different jobs: UART0 on PA10/PA11 is the host control interface, UART1 on PA8/PA9 carries HSM-to-HSM transfers${src('simple_uart.h', S.y2026uart)}. A USB-serial adapter on the wrong pair, or TX and RX swapped, looks exactly like dead firmware. It also matters for security: the two interfaces face different parties, so input arriving on one deserves different trust from input arriving on the other.` },

    `## Toolchain and build

The reference build is a **Docker** image (\`firmware/Dockerfile\`, \`FROM ubuntu:24.04\`) containing the **TI MSPM0 SDK** at tag \`mspm0_sdk_2_06_00_05\` and **TI Arm Clang** \`ti-cgt-armllvm_4.0.3.LTS\` (\`tiarmclang\`, \`tiarmobjcopy\`). It is **not** \`arm-none-eabi-gcc\`${src('2026 Dockerfile', S.y2026docker, '2026 firmware Makefile', S.y2026make)}.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'eCTF 2026 reference build, as given in the 2026 repository. The docker run mounts are elided in the fact sheet: copy the full command from the README. Not run here.', code: `# 1. build the container image (wraps: docker build -t build-hsm ./firmware/)
make docker

# 2. generate global secrets for your groups (uses uv; ectf26_design needs Python >= 3.12)
uvx --with-editable ./ectf26_design --from ectf26_design secrets global.secrets <groups>

# 3. build one HSM image with its PIN and permissions
docker run ... -e HSM_PIN=<pin> -e PERMISSIONS='<group>=RWC' build-hsm
#   build.sh runs secrets_to_c_header.py, then make -> hsm.elf and hsm.bin`,
      explain: [
        { lines: '5', md: 'Secrets are produced by the team’s own Python package. Whatever ends up in `global.secrets` is shared by every HSM built from it.' },
        { lines: '8-9', md: 'The PIN and permission set are per-device build inputs passed as environment variables; a script turns the secrets into a C header that is compiled into the image. Anything in that header is in flash in plain form unless your design does something about it.' },
      ] },

    `Source for the commands${src('2026 README', S.y2026readme, 'root Makefile', S.y2026rootmake)}.`,

    { t: 'callout', kind: 'decision', title: 'Stay on TI Arm Clang unless you have a reason', md: `TI's SDK supports several compilers — TI Arm Clang, GCC, IAR and Keil${src('SDK tools docs', S.tiTools)} — so building with \`arm-none-eabi-gcc\` is possible in principle. The reference design chose TI Arm Clang, and its linker script, startup code and flags are written for it. Switching compiler means porting those, re-checking code size against a 208 KB team region and a small stack, and owning every difference in code generation. On a Cortex-M0+ with no divide instruction and no FPU, library routines for division and floating point are supplied by the toolchain, so their size *and timing* depend on the compiler. Make that switch deliberately and early, or not at all.` },

    `## Debugging and flashing

- **Probe.** TI's SDK documentation names the **XDS110** debug probe (JTAG and SWD) alongside SEGGER, PEmicro and Lauterbach probes${src('debug_program.rst', S.tiDebug)}. Which probe the 2026 kit's board carries is **not verified** — see the board-name note below.
- **OpenOCD.** The MSPM0 family is supported in **upstream** OpenOCD: the flash driver \`src/flash/nor/mspm0.c\` has part-table entries for the MSPM0L2228, and the board file \`tcl/board/ti/mspm0-launchpad.cfg\` selects the XDS110 interface and the MSPM0 target${src('mspm0.c', S.oocdMspm0, 'mspm0-launchpad.cfg', S.oocdLp)}.
- **Vendor tools.** Code Composer Studio and UniFlash are TI's own debug and flashing tools${src('SDK tools docs', S.tiTools)}.
- **The competition's path.** Whether teams flash 2026 images with OpenOCD, UniFlash or a MITRE bootloader tool is **not verified here**. The linker script's "Bootloader flash - unusable" region shows a bootloader is involved; the procedure is in the 2026 rules.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Attaching upstream OpenOCD and GDB to an MSPM0 LaunchPad with an XDS110. Written from the OpenOCD repository layout; not run here, and only applicable if your board and the rules allow a debug probe.', code: `# terminal 1: OpenOCD with the upstream MSPM0 LaunchPad board file
openocd -f board/ti/mspm0-launchpad.cfg

# terminal 2: GDB with the ELF from the Docker build, for symbols
gdb-multiarch <output-dir>/hsm.elf -ex "target extended-remote :3333"`,
      explain: [
        { lines: '2', md: 'The board file pulls in `interface/xds110.cfg` and `target/ti/mspm0.cfg`. If your OpenOCD reports that it cannot find the file, the installed version predates MSPM0 support.' },
        { lines: '5', md: '`<output-dir>` is wherever your `docker run` mounted the build output. Port 3333 is OpenOCD’s default GDB port.' },
      ] },

    `## Boot architecture and hardware security, as far as the sources go

**NONMAIN boot configuration.** The device reads boot policy from the NONMAIN region. The options exposed in TI's \`boot_config.h\` for this part include: debug access (enabled, enabled with password, or disabled); SWD port enable/disable; TI failure-analysis enable; mass erase and factory reset (enabled, password-protected, or disabled); bootstrap loader (BSL) pin invoke and bootloader mode; fast boot; static write protection of NONMAIN; a bank-swap policy; a flag saying a Customer Secure Code image exists; and a secure-boot application check by CRC or hash${src('boot_config.h', S.tiBootCfg)}.

**Customer Secure Code (CSC).** TI's MCUboot-based secure-boot stage for this device family. It verifies images with ECDSA P-256 and SHA-256, uses under 18 kB of flash per bank ("allowing for two 110kB images on a 256kB device"), sets up write, read and IP-protect firewalls, the KEYSTORE and the bank-swap policy, provides rollback protection, and has an optional CMAC fast-boot check. TI states it "does not guarantee a full secure boot implementation on a device"${src('CSC user guide', S.tiCsc)}.

**Peripherals and SDK examples.** The SDK's LP_MSPM0L2228 examples cover AES in CBC, CTR, ECB, CMAC and GCM modes with 128- and 256-bit keys, tamper I/O (heartbeat, timestamp on tamper, scratchpad erase on tamper), flash ECC and dynamic memory protection, and writing NONMAIN${src('SDK examples', S.tiExamples)}.`,

    { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, caption: 'Step the MSPM0 boot sequence. Which stages read NONMAIN, and which stages belong to the competition bootloader rather than to TI?' },

    { t: 'callout', kind: 'security', title: 'The chip having a feature does not mean you may use it', md: `NONMAIN can disable debug access and SWD, and can restrict mass erase and factory reset. A wrong write there can lock you out of your own board, and in a competition the bootloader region and its configuration belong to the organisers. Before touching NONMAIN, CSC, the key store or the firewalls: (1) read the 2026 rules on what teams may configure; (2) read the TRM chapter on NONMAIN and the boot configuration routine so you know which settings are reversible; (3) only then try it, on a board you own and can afford to lose. Whether the eCTF 2026 bootloader uses CSC or any of these features is **not verified here**.` },

    { t: 'callout', kind: 'note', title: 'Not verified here — where to check', md: `| Item | Where to confirm |
|---|---|
| **Exact 2026 board name.** The repository proves only the MCU. TI's evaluation board for this part is the LP-MSPM0L2228 LaunchPad${src('SDK README', S.tiReadme)}, but unopened search results mention a board called "MSP-LITO-L2228" for 2026 | eCTF 2026 rules, getting-started / hardware page |
| On-board debugger of the 2026 board, and of the LP-MSPM0L2228 | Board user guide; 2026 rules |
| How the 2026 MITRE bootloader is installed, entered and used to flash | eCTF 2026 rules, bootloader / getting-started pages |
| Maximum CPU frequency | MSPM0L2228 datasheet, clock specifications |
| Dual-bank flash details; presence and size of data flash (OpenOCD lists a family-level DATA region at \`0x41D00000\`, not confirmed for this part) | MSPM0L2228 datasheet memory section; MSPM0 L-series TRM, flash chapter |
| ADC resolution, tamper pin count, operating voltage | MSPM0L2228 datasheet |
| ROM bootstrap loader interfaces and how it is invoked | TRM, BSL chapter; BSL user guide in the SDK docs |
| Static write protection semantics | TRM, NONMAIN / flash protection chapter |

Candidate vendor pages (not load-tested): ${S.tiProduct} , ${S.tiLp} .` },

    { t: 'exercise', prompt: `You are porting startup code to the 2026 platform. The linker script places the stack at the very top of SRAM, growing downward (the usual full-descending Cortex-M stack). What value must the first word of your image's vector table hold? Give it in hex.`,
      hints: [
        `The first vector-table word is the initial stack pointer. With a full-descending stack placed at the top of RAM, it points one byte past the last RAM byte.`,
        `SRAM origin is 0x20200000 and its length is 0x8000.`,
        `Add them. The result is not a valid RAM address itself — the first push decrements SP before writing.`,
      ],
      solution: `\`0x20200000 + 0x8000 = 0x20208000\`.

That address is one past the end of RAM, which is correct: a Cortex-M push decrements SP first, so the first stacked word lands at \`0x20207FFC\`. A value of \`0x20008000\` here is the fingerprint of a linker script carried over from a chip with RAM at \`0x20000000\`.

Two follow-ups. In the eCTF 2026 layout, *your* vector table is at \`0x6000\`, not at 0, so it is the bootloader's hand-off (not the reset itself) that uses this word. And whether the reference script actually puts the stack at the top of RAM is for you to read in \`firmware.ld\` — the method is the same wherever it is.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?2020[_ ]?8000\\s*$'], nudge: 'Add the SRAM length to the SRAM origin — and check which origin you used.' } },

    { t: 'exercise', prompt: `The reference design stores each file in 9 flash pages of 1024 bytes, starting at 0x10000, and allows 8 files. **Assume** the 8 slots are contiguous (confirm this in the filesystem source). (a) What is the first address after the last slot? (b) Does the file area lie entirely inside the team FLASH region? (c) File contents are at most 8192 bytes: what does the ninth page suggest? Enter the address for (a) in hex.`,
      hints: [
        `One slot is 9 × 1024 bytes. Eight slots is 72 × 1024 bytes.`,
        `72 × 1024 = 73 728 = 0x12000. Add that to 0x10000.`,
        `The team FLASH region runs from 0x6000 to 0x3A000. For (c): 8192 bytes is exactly 8 pages.`,
      ],
      solution: `(a) 8 × 9 × 1024 = 73 728 = \`0x12000\`, so the area ends at \`0x10000 + 0x12000 = 0x22000\`.

(b) Yes: \`0x10000\`–\`0x22000\` is inside the team region \`0x6000\`–\`0x3A000\`. Note what it implies: under that assumption, the file area sits in the middle of the region your code is linked into, so code placed from \`0x6000\` has \`0xA000\` bytes (40 KB) before it would reach the first file slot. Whether the linker script or the code guards against that overlap is something to read in the repository, not to assume.

(c) 8192 bytes of contents fill exactly 8 pages, so the ninth page is most plausibly for metadata such as name, group, UUID and length. That is an inference; \`filesystem.h\` is where to confirm it.

The security-relevant observation: files and code share one flash region with no hardware boundary established by the layout itself. What stops a write of file data from landing on code, or a read from returning another group's file, is firmware logic — which is exactly what an attacker examines first.`,
      answer: { type: 'text', accept: ['^\\s*(0x)?0*22000\\s*$'], nudge: 'Start address plus 8 slots of 9 pages of 1024 bytes each.' } },

    `## Harder application

The MAX78000 design you might be porting from had 128 KB of RAM, a hardware FPU, however many interrupt priority levels its header's \`__NVIC_PRIO_BITS\` gives (look it up — it is not recorded in this course's fact sheet) and 8 KB flash pages. The MSPM0L2228 has 32 KB of RAM, no FPU, four priority levels and — per the reference design — 1 KB flash pages. For a design that (i) buffers a whole 8192-byte file in RAM while verifying it, (ii) uses floating point in a rate limiter, (iii) relies on five distinct interrupt priorities, and (iv) keeps a monotonic counter in its own flash page: say for each whether it ports unchanged, ports with a cost, or must be redesigned, and what you would measure to be sure. Lesson 5 gives you the comparison tool for this.`,

    { t: 'refs', items: [
      { title: 'MITRE eCTF 2026 insecure example (ectfmitre)', url: S.y2026 },
      { title: 'TI MSPM0 SDK (repository)', url: S.ti },
      { title: 'MSPM0 SDK: MSPM0L2228 linker command file (memory origins and lengths)', url: S.tiCmd },
      { title: 'MSPM0 SDK: MSPM0L222x device header', url: S.tiHdr },
      { title: 'MSPM0 SDK: boot configuration options for the L2228', url: S.tiBootCfg },
      { title: 'MSPM0 SDK: Customer Secure Code user guide (source)', url: S.tiCsc },
      { title: 'OpenOCD: MSPM0 flash driver', url: S.oocdMspm0 },
      { title: 'OpenOCD: MSPM0 LaunchPad board configuration', url: S.oocdLp },
      { title: 'TI MSPM0L2228 product page (datasheet, TRM)', url: S.tiProduct, note: 'Not load-tested.' },
      { title: 'MITRE eCTF rules', url: S.rules, note: 'Not load-tested; the authority for the 2026 board, bootloader and requirements.' },
    ] },
  ],
  quiz: [
    { kind: 'arch', q: `A generic Cortex-M linker script with \`RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 32K\` is used unchanged for the MSPM0L2228. The build succeeds. What should you expect on the board?`,
      choices: [
        { t: 'A fault during startup, because the stack and static data are placed at addresses where this part has no RAM', ok: true, why: 'This part’s SRAM begins at 0x20200000. The linker cannot know that; it places data wherever the script says, and the first access fails.' },
        { t: 'Normal operation, because all Cortex-M parts have SRAM at 0x20000000', why: 'The architecture reserves a range for SRAM but each vendor chooses where within it memory actually exists.' },
        { t: 'A link error, because the linker checks addresses against the chip', why: 'The linker has no knowledge of the silicon; the script is its only description of memory.' },
        { t: 'Correct operation but with only half the RAM available', why: 'No part of the range the script names is backed by RAM on this device, so nothing works rather than half.' },
      ] },
    { kind: 'concept', q: `The 2026 reference Dockerfile installs \`ti-cgt-armllvm\`. A teammate’s laptop has \`arm-none-eabi-gcc\` and they want to build natively "to save time". What is the strongest argument for using the container?`,
      choices: [
        { t: 'The reference linker script, startup code and flags target TI Arm Clang at a pinned SDK version; another compiler yields a different, untested image', ok: true, why: 'Reproducibility is the purpose of the pinned container. A different compiler changes code generation, runtime library routines and possibly layout.' },
        { t: 'GCC cannot generate code for the Cortex-M0+', why: 'GCC supports ARMv6-M, and TI’s SDK lists GCC among supported compilers; capability is not the issue.' },
        { t: 'Docker builds run faster than native builds', why: 'Containers do not speed compilation; the benefit is that everyone builds the same thing.' },
        { t: 'The rules forbid any compiler other than TI Arm Clang', why: 'That would be a rules question, and the rules were not verified here; do not assert a rule you have not read.' },
      ] },
    { kind: 'security', q: `TI’s boot configuration for this part can disable the SWD port. A team wants to do this to their eCTF 2026 board immediately. What should they do first?`,
      choices: [
        { t: 'Read the 2026 rules on what teams may configure and the TRM on which NONMAIN settings are reversible, and trial it on a spare board they own', ok: true, why: 'NONMAIN is boot policy that can lock out debugging and recovery, and in a competition it may not be the team’s to change. Know both before writing it.' },
        { t: 'Do it at once — disabling debug is always the secure choice', why: 'A control applied without knowing whether it is permitted or reversible can disqualify a design or destroy the only board.' },
        { t: 'Nothing; NONMAIN cannot be written by user code', why: 'The SDK includes an example that writes NONMAIN, so it can be written, which is why care is needed.' },
        { t: 'Disable it in software by not calling the SWD driver', why: 'Debug access is a hardware port governed by boot configuration, not a driver the application chooses to call.' },
      ] },
    { kind: 'arch', q: `The file allocation table is fixed at \`0x0003A000\` because the bootloader must know where it is. Your design would be simpler with the table elsewhere. What follows?`,
      choices: [
        { t: 'The location is part of the interface between your firmware and the bootloader, so it is a constraint to design around, not a parameter to change', ok: true, why: 'When another component you do not control reads a structure at a fixed address, moving it breaks that component’s assumptions.' },
        { t: 'Move it and update the linker script; the linker will inform the bootloader', why: 'The bootloader is a separate, pre-built image; nothing in your link step can change what address it reads.' },
        { t: 'Keep a second copy elsewhere and ignore the fixed one', why: 'The bootloader would then act on stale or empty data, and two copies that can disagree create a consistency problem of their own.' },
        { t: 'It only matters during the attack phase', why: 'A fixed layout requirement from the functional specification applies whenever the bootloader runs, in every phase.' },
      ] },
    { kind: 'code', q: `On this Cortex-M0+ you write \`uint32_t avg = total / count;\` inside a function that compares a PIN attempt. Why might that line deserve a second look on this chip in particular?`,
      choices: [
        { t: 'ARMv6-M has no divide instruction, so the division becomes a library call whose execution time can depend on the operand values', ok: true, why: 'Software division routines commonly take data-dependent time; next to secret-dependent code that can become a timing signal worth measuring.' },
        { t: 'Division is undefined behaviour on a Cortex-M0+', why: 'Integer division is fully defined in C whenever the divisor is non-zero; the question is how it is implemented.' },
        { t: 'The M0+ computes division in floating point, which is disabled', why: 'Integer division does not go through floating point; the build uses a soft-float ABI but that concerns float types.' },
        { t: 'The result is 16 bits wide on this core', why: 'The core is 32-bit and `uint32_t` arithmetic is 32-bit; width is unaffected.' },
      ] },
    { kind: 'concept', q: `Which statement about the eCTF 2026 hardware is supported by this course’s fact sheet?`,
      choices: [
        { t: 'The MCU is the MSPM0L2228, established by the reference Makefile’s `-D__MSPM0L2228__`; the board’s exact name and on-board debugger are unconfirmed', ok: true, why: 'The repository proves the part; the board name appears only in unopened pages, with a conflicting candidate name.' },
        { t: 'The kit is the LP-MSPM0L2228 LaunchPad and is flashed with OpenOCD', why: 'Both halves are assumptions: the board name is unverified and so is the official flashing path.' },
        { t: 'The part has 512 KB of flash at 0x10000000', why: 'Those are the MAX78000’s figures from 2024–2025; this part has 256 KB at address zero.' },
        { t: 'The reference design enables TI’s Customer Secure Code', why: 'CSC exists for this family, but whether the 2026 bootloader or reference design uses it was not established.' },
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
