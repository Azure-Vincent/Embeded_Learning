// eCTF platforms track, lessons 1-3: year-by-year hardware, ESP32 as the learning platform, MAX78000FTHR.
// Every hardware / tooling / year statement is taken from docs/FACTS.md. Nothing here was run on hardware.
import { S, NOT_LOADED as N, src } from './src.js';

const history = {
  id: 'ectf-plat-history',
  title: 'What MITRE eCTF is and how its hardware has changed',
  minutes: 35,
  summary: 'Ten years of reference designs, six processor families. The platform is a variable; the year’s rules are the authority.',
  skills: ['ectf-plat-year-map'],
  blocks: [
    `## The problem: you prepared for the wrong chip

A team spends the autumn getting very good at one microcontroller. They know its flash base, its debugger, its SDK's quirks. In January the competition kit arrives and it is a different vendor, a different core, a different compiler and a different way of getting code onto the board. How much of the autumn was wasted?

The answer depends on *what* they learned. If they learned "the address of the UART register on chip X", almost all of it is gone. If they learned "how to find the memory map, boot flow and flashing procedure of any chip from its primary documents", almost none of it is. This lesson shows, with evidence, why the second kind of preparation is the only kind that survives.`,

    `## What eCTF is

MITRE's Embedded Capture the Flag (eCTF) is a competition in which teams are given a functional specification, a set of security requirements and an **insecure reference design** that meets the functional requirements but not the security ones. Teams first build their own secure design on the specified hardware, and later attack other teams' designs. That design-then-attack shape is visible in the public repositories: each year MITRE publishes an "insecure example" repository, and from 2024 the READMEs refer to a MITRE-provided bootloader used during the design phase${src('2024 README', S.y2024readme)}.

Two things this course cannot give you, and says so:

- The **authoritative wording** of a year's rules, scoring and security requirements. Those live on MITRE's rules site, [rules.ectf.mitre.org](${S.rules}), which hosts 2026 and — marked "archived past competition, for reference only" — 2024 and 2025. This track summarises what those pages say and links them; when a summary and the page differ, the page wins. No rules site was found for 2017–2023.
- Anything official. The exercises and scenarios in this track are written for this course. They copy the *shape* of eCTF work, not its content.`,

    { t: 'callout', kind: 'warn', title: 'The repositories are not where you might guess', md: `MITRE's public reference designs for 2016–2025 are under [github.com/mitre-cyber-academy](${S.mcaOrg}). The 2026 reference design is under [github.com/ectfmitre](${S.y2026}). The account \`github.com/ectf\` is **not** MITRE's: it is an unrelated account with a single 2016 repository${src('account page', S.notEctf, 'MITRE org repository list', S.mcaRepos)}. Cloning the wrong repository is a cheap mistake to make and an expensive one to discover late.` },

    `## Year by year, from the reference repositories

Every row below comes from a file in that year's reference repository (README, Makefile, project file or linker script). "Theme" is the wording the repository itself uses; where a README does not give an official theme name, the cell says what the system *is* rather than inventing a title.

| Year | System in the reference design | MCU / board | Build and flash tooling | Repository |
|---|---|---|---|---|
| 2017 | Secure bootloader plus host tools; host talks to the bootloader over UART1 | Atmel \`atmega1284p\` on a "Protostack board", programmed with an AVR Dragon over the 6-pin ISP header | Vagrant + VirtualBox VM, \`avrdude\`, Python host tools | [2017](${S.y2017}) |
| 2018 | ATM / bank system: bank server, ATM backend, a card and a security module (HSM) | Cypress PSoC 4, device \`CY8C4245AXI-483\` | Docker for the servers; PSoC Creator and PSoC Programmer (Windows) for firmware | [2018](${S.y2018}) |
| 2019 | Game-console-like system ("MES" in the repo): U-Boot stage, game loader, Linux kernel and filesystem | Digilent Arty Z7 (Xilinx Zynq), boots from SD card | Vagrant VM, Xilinx PetaLinux, Vivado hardware project, \`bootgen\` | [2019](${S.y2019}), [hardware](${S.y2019hw}) |
| 2020 | Audio DRM player: Linux-side \`miPod\` driver plus a DRM module on a soft-core MicroBlaze in the FPGA | Digilent Cora Z7-07S (Xilinx Zynq), boots from SD card | Vagrant VM, Vivado board files, \`bootgen\` | [2020](${S.y2020}) |
| 2021 | Secure Common Embedded Wireless Link (SCEWL): bus controller, CPU running user code, SSS, radio emulator | **Emulated** in the reference design: Stellaris \`lm3s6965\` under \`qemu-system-arm\` | Docker, QEMU, root Makefile | [2021](${S.y2021}) |
| 2022 | Secure Avionics Flight Firmware Installation Routine (SAFFIRe): bootloader installing protected firmware and configuration | TI Tiva C \`TM4C123GH6PM\`; emulated (custom QEMU image) and physical modes — physical was "not supported in the initial code release" | Docker, custom QEMU, Code Composer Studio for the physical MCU, PySerial | [2022](${S.y2022}) |
| 2023 | Protected Automotive Remote Entry Device (PARED): car and key-fob firmware | TI TM4C123G LaunchPad Evaluation Kit (\`TM4C123GH6PM\`) | Docker, Python 3.7+, Stellaris ICDI drivers, TI UniFlash; OpenOCD and the Arm GNU toolchain recommended | [2023](${S.y2023}) |
| 2024 | "MISC" system protecting a medical device from supply-chain attacks: one Application Processor and two Components on I2C | Three Analog Devices **MAX78000FTHR** boards on MITRE's eCTF breakout board (\`BOARD=FTHR_RevA\`) | **Nix** shell + **Poetry**; MSDK tag \`v2023_06\`; MITRE eCTF bootloader for flashing | [2024](${S.y2024}) |
| 2025 | Satellite TV System: a Decoder that decodes frames for subscribed channels | One **MAX78000FTHR** (\`BOARD=FTHR_RevA\`) | **Docker** + pip/venv; MSDK tag \`v2024_02\`; MITRE eCTF bootloader | [2025](${S.y2025}) |
| 2026 | Hardware Security Module (HSM): permissioned file storage and transfer, with group permissions and a PIN | Texas Instruments **MSPM0L2228** on the custom **MSP-LITO-L2228** board, with an external XDS110 probe | **Docker** with TI MSPM0 SDK and **TI Arm Clang**; \`uv\` for the tools; TI **UniFlash** to install the MITRE bootloader | [2026](${S.y2026}) |

Sources per year: 2017${src('README', S.y2017readme, 'bootloader Makefile', S.y2017make)}; 2018${src('README', S.y2018readme, 'CARD project file', S.y2018proj)}; 2019${src('README', S.y2019readme)}; 2020${src('README', S.y2020readme)}; 2021${src('README', S.y2021readme, 'controller README', S.y2021ctrl)}; 2022${src('README', S.y2022readme, 'bootloader Makefile', S.y2022make)}; 2023${src('README', S.y2023readme, 'tools README', S.y2023tools, 'car Makefile', S.y2023make)}; 2024${src('README', S.y2024readme, 'shell.nix', S.y2024nix)}; 2025${src('README', S.y2025readme, 'Dockerfile', S.y2025docker)}; 2026${src('README', S.y2026readme, 'Dockerfile', S.y2026docker, 'firmware Makefile', S.y2026make)}. Board names for 2024–2026 are from the rules pages${src('2024 architecture', S.r24arch, '2025 board', S.r25board, '2026 board', S.r26board)}.`,

    { t: 'callout', kind: 'note', title: 'What this table does not claim', md: `- The READMEs for 2017 and 2018 do not state an official theme name, and the 2019 README does not expand "MES". Those cells describe the system, nothing more.
- For 2024–2026 the board names come from the rules pages, not the repositories: a repository proves the MCU (a compiler define, a board support package), never the board in the box. The 2026 board is the example to remember — the MCU's obvious evaluation board is TI's LP-MSPM0L2228 LaunchPad, but the kit is a custom **MSP-LITO-L2228** that is not sold commercially; the rules call the LaunchPad "largely interchangeable"${src('2026 board page', S.r26board)}.
- No rules site was found for 2017–2023; those READMEs point at older MITRE pages.
- None of the rows is an ESP32. This course teaches on the ESP32 for reasons given in the next lesson, not because eCTF used it.` },

    `## Reading the table as an engineer

Sort the rows by what actually changes between years:

- **Processor family.** An Atmel AVR (2017), a Cypress PSoC 4 (2018), Zynq boards running Linux with FPGA fabric (2019, 2020), an emulated Stellaris part (2021), TI Tiva C (2022, 2023), a Cortex-M4F with a RISC-V coprocessor (2024, 2025), a Cortex-M0+ (2026). The cores of the 2024–2026 parts are established from vendor headers in lessons 3 and 4. For the earlier parts the fact sheet records part numbers, not cores — look the core up in each manufacturer's datasheet rather than trusting memory.
- **Whether there is physical hardware at all.** 2021 was emulated; 2022 was both.
- **How code reaches the chip.** An ISP programmer (2017), a vendor IDE's programmer (2018), an SD card image (2019, 2020), a vendor flashing tool (2023), a MITRE bootloader over serial (2024, 2025), and in 2026 both: a vendor tool once to install the MITRE bootloader, then the bootloader over serial.
- **How the build is made reproducible.** Vagrant VMs, then Docker, then Nix, then Docker again.

What does *not* change: every year has a functional specification, security requirements, host tools that talk to the device over a defined interface, a build that injects per-device secrets, and a reference design that is deliberately insecure.`,

    { t: 'predict', q: `Two consecutive years, 2024 and 2025, used the same MCU and the same board support package. A team member proposes reusing the 2024 build environment unchanged for 2025 "because it's the same chip". Before reading on: what, specifically, would you check first, and what do you expect to find?`,
      reveal: `Check the build files of the two reference repositories, not the chip. You would find that almost everything around the chip changed${src('2024 shell.nix', S.y2024nix, '2025 Dockerfile', S.y2025docker)}:

- Environment: Nix shell + Poetry (2024) became Docker + plain \`venv\`/pip (2025).
- SDK version: MSDK tag \`v2023_06\` (2024) became \`v2024_02\` (2025).
- Host tools: console scripts named \`ectf_*\` (2024) became \`python -m ectf25.*\` modules (2025).
- System shape: several boards on I2C (2024) became one Decoder board talking to the host over UART (2025).

What stayed the same is narrow and worth knowing precisely: the linker layout. Both years place the MITRE bootloader at \`0x10000000\` and team firmware at \`0x1000E000\`${src('2024 firmware.ld', S.y2024ld, '2025 firmware.ld', S.y2025ld)}. "Same chip" told you one true thing and hid four changes.` },

    { t: 'callout', kind: 'mistake', title: 'Preparing for last year’s board', md: `The common error is to treat the most recent reference design as a preview of next year. The table shows consecutive-year reuse exactly twice in ten years (TM4C123 in 2022–2023, MAX78000 in 2024–2025), and in both cases the tooling or the hardware mode changed anyway. Use old reference designs to practise *the process* — reading a spec, finding the trust boundary, building reproducibly — and treat every chip-specific fact as provisional until the current year's kit and rules are in your hands.` },

    { t: 'callout', kind: 'decision', title: 'Why this track goes deep on three platforms only', md: `It would be possible to give every year a chapter. This track instead covers the ESP32 (the board this course's labs use), the MAX78000 (eCTF 2024 and 2025) and the MSPM0L2228 (eCTF 2026). Three is enough to make every comparison three-sided — Xtensa/RISC-V vs Cortex-M4F vs Cortex-M0+ — and the two eCTF parts are the ones whose reference repositories and SDKs were actually read for the fact sheet. The older years are evidence for one claim only: the platform changes.` },

    { t: 'exercise', prompt: `Without opening a browser, use the table to answer: in how many of the ten years 2017–2026 could a team have completed the *reference* build and flash flow using only \`arm-none-eabi-gcc\` and OpenOCD, with no vendor-specific build or flashing tool? Write the number, then justify each year you counted.`,
      hints: [
        `Go row by row and ask two questions: is the core an Arm microcontroller at all, and does the row name a tool that is not GCC/OpenOCD as part of the reference flow?`,
        `2017 is AVR. 2018 uses PSoC Creator. 2019 and 2020 are Zynq boards built with PetaLinux/Vivado. 2021 is emulated (nothing to flash). 2024 and 2025 flash through a MITRE bootloader, and 2024 uses an Analog Devices OpenOCD fork. 2026 uses TI Arm Clang.`,
        `That leaves 2022 and 2023. Look at what the 2023 row lists as *required* versus *recommended*.`,
      ],
      solution: `**Zero**, on a strict reading — and that is the point of the exercise.

- 2017: AVR, \`avrdude\`. 2018: PSoC Creator. 2019/2020: Zynq, PetaLinux/Vivado/\`bootgen\`. 2021: emulated under QEMU.
- 2022: the reference flow is Docker plus a custom QEMU image; the physical MCU is debugged with Code Composer Studio.
- 2023: the closest. The firmware is built in Docker and OpenOCD plus the Arm GNU toolchain are *recommended*, but the *required* list includes TI UniFlash and the Stellaris ICDI drivers.
- 2024/2025: Arm GCC builds the firmware, but flashing goes through the MITRE bootloader and its host tool, and 2024 packages an Analog Devices fork of OpenOCD.
- 2026: the reference design compiles with TI Arm Clang, not \`arm-none-eabi-gcc\`, and the MITRE bootloader is installed with TI UniFlash.

If you answered 1 (for 2023) you read the table carefully; the difference is whether "recommended" counts. Either way the transferable conclusion is the same: a generic toolchain is necessary background, and each year adds something you have to learn from that year's documents.`,
      answer: { type: 'number', value: 0, tol: 1 } },

    `## What the security requirements looked like, 2024–2026

The functional system changes completely each year. Read the three sets of security requirements side by side and notice what *kind* of statement they are. These are paraphrases; the linked pages are the wording that counts.

| Year | Requirement (summary) | Property |
|---|---|---|
| 2024 | SR1: the Application Processor boots only if every expected Component is present and valid | Authenticity of peers |
| | SR2: Components boot only when commanded by a valid AP that has confirmed integrity | Authenticity of peers |
| | SR3: the Attestation PIN and Replacement Token stay confidential | Confidentiality of credentials |
| | SR4: Component Attestation Data stays confidential | Confidentiality of data |
| | SR5: integrity and authenticity of post-boot messages (confidentiality not required) | Integrity, authenticity |
| 2025 | SR1: frames cannot be decoded without a Decoder holding a valid, currently active subscription for that channel | Access control, confidentiality |
| | SR2: a Decoder decodes only genuine frames from the Satellite System it was provisioned for | Authenticity |
| | SR3: a Decoder decodes only frames with strictly increasing timestamps | Freshness |
| 2026 | SR1: no file action without a validly provisioned HSM holding the matching permission for that file's group | Access control |
| | SR2: no PIN-protected action without knowing the PIN, and the PIN itself must not leak | Authentication, confidentiality |
| | SR3: an HSM receives only files generated by a valid HSM with write permission for that group | Integrity, authenticity |

Sources${src('2024 security requirements', S.r24sec, '2025 security requirements', S.r25sec, '2026 security requirements', S.r26sec)}.

Every row is a statement about what an attacker must **not** achieve, and none names a mechanism or a chip feature. That is why the requirements transfer between platforms even though no line of driver code does: "authenticity", "freshness" and "the secret must not leak" have to be re-implemented on each year's hardware with whatever that hardware offers. One 2026 number is worth carrying into the security section of this course: any operation with an invalid PIN may take up to **5 seconds**${src('2026 detailed specifications', S.r26detail)} — the specification deliberately leaves room for a delay that makes guessing a 6-hex-digit PIN slow.`,

    `## Harder application: predicting the unknown year

Suppose next year's kit is announced with only a part number you have never seen. From the pattern above, write down — before you have any documents — the list of questions whose answers you will need in the first two days. A good list has at least: core and instruction set; flash and RAM base addresses and sizes; who owns the first bytes of flash (a provided bootloader, or you); how firmware is transferred (debug probe, serial bootloader, mass storage); compiler and SDK version pinned by the reference build; how per-device secrets get into the image; which interfaces the host tools use; and which hardware security features exist *and are permitted by the rules*. Lesson 6 turns that list into a procedure, and the lab makes you run it.`,

    { t: 'refs', items: [
      { title: 'MITRE eCTF reference designs, 2016–2025 (mitre-cyber-academy)', url: S.mcaRepos },
      { title: 'MITRE eCTF 2026 insecure example (ectfmitre)', url: S.y2026 },
      { title: 'MITRE eCTF rules site (2026; 2024 and 2025 archived)', url: S.rules, note: 'The authority for those years’ rules.' },
      { title: 'eCTF 2026 security requirements', url: S.r26sec },
      { title: 'eCTF 2025 security requirements', url: S.r25sec },
      { title: 'eCTF 2024 security requirements', url: S.r24sec },
    ] },
  ],
  quiz: [
    { kind: 'concept', q: `A classmate says "eCTF is an Arm Cortex-M competition". Which evidence from the reference repositories best tests that claim?`,
      choices: [
        { t: 'The 2017 bootloader Makefile sets `MCU = atmega1284p`, an 8-bit AVR', ok: true, why: 'A universal claim is tested by looking for a counter-example. An AVR is outside the Cortex-M family, and the 2019–2020 Zynq boards running Linux are too.' },
        { t: 'The 2023 README recommends the Arm GNU toolchain and OpenOCD for development', why: 'One year recommending an Arm toolchain supports the claim for that year only; a general claim needs a check against every year.' },
        { t: 'The 2021 design runs its controller under `qemu-system-arm` rather than on a board', why: 'That shows an Arm target was emulated in one year; it says nothing about the years that used other families.' },
        { t: 'The 2026 Makefile passes `-mcpu=cortex-m0plus` to the TI Arm Clang compiler', why: 'This confirms the claim for one year. A universal statement is tested by looking for counter-examples, not confirming instances.' },
      ] },
    { kind: 'arch', q: `In 2024 and 2025 team firmware is linked at \`0x1000E000\` although MAX78000 flash begins at \`0x10000000\`. What does that gap tell you about how firmware reaches the board in those years?`,
      choices: [
        { t: 'Something else owns the first 0xE000 bytes and is what receives and starts your image', ok: true, why: 'The linker scripts name that region BOOTLOADER: the MITRE bootloader lives there, and team images are transferred through it rather than written from the base of flash.' },
        { t: 'The first 0xE000 bytes of flash are factory test data on that part and must be skipped by every application', why: 'Linker regions express ownership decisions made by a design, not properties of the silicon; look at what the region is called in the script.' },
        { t: 'The vector table of every Cortex-M4 must sit 0xE000 above the flash base for the core to find it', why: 'The architecture does not fix such an offset; where the table sits is a property of the particular boot arrangement.' },
        { t: 'The RISC-V core boots from the first 0xE000 bytes, so the Arm core’s code has to start after it', why: 'Nothing in the linker script assigns that region to the second core; the region’s name says what it is for.' },
      ] },
    { kind: 'concept', q: `Before the 2026 kit arrives, a teammate orders spare boards. The reference Makefile says \`-D__MSPM0L2228__\`, so they buy TI’s LP-MSPM0L2228 LaunchPad and assume it *is* the competition board. What does the evidence support?`,
      choices: [
        { t: 'The Makefile proves the MCU only; the rules name a custom board, the MSP-LITO-L2228', ok: true, why: 'A compiler define identifies the chip. The board in the kit is defined by the rules, which describe the LaunchPad as "largely interchangeable" — close, with a different button, LED and probe arrangement.' },
        { t: 'The Makefile define identifies the board as well, since each TI microcontroller has exactly one evaluation board', why: 'A microcontroller can sit on any number of boards. The define selects device headers, not a PCB.' },
        { t: 'The LaunchPad cannot be used at all, because eCTF firmware only runs on boards supplied by MITRE', why: 'The rules provide a separate bootloader build for LaunchPad boards, so they are usable; they are just not identical.' },
        { t: 'Nothing can be known about the 2026 hardware until the physical kit has been opened and inspected', why: 'The rules site and the reference repository are public and state both the MCU and the board before any kit arrives.' },
      ] },
    { kind: 'security', q: `You are asked to practise for an upcoming eCTF by attacking the 2023 PARED reference design. Which framing is correct?`,
      choices: [
        { t: 'Attack your own build of it, on hardware or emulation you control, to practise method', ok: true, why: 'Reference designs are intentionally vulnerable and public, which makes them legitimate practice targets when you run them yourself. Expect next year’s platform and system to differ.' },
        { t: 'Its vulnerabilities are the ones that will appear in this year’s designs, so memorise the list', why: 'Each year has a new system and new requirements; the transferable part is the method of finding weaknesses, not the list.' },
        { t: 'It is representative of how production car key fobs are built, so findings apply to real vehicles', why: 'It is a teaching design built to be insecure; drawing conclusions about commercial products from it is unsupported.' },
        { t: 'Because the code is public, any device running similar firmware is a fair target for the same attacks', why: 'Authorisation comes from owning the target or having permission, never from the availability of example code.' },
      ] },
    { kind: 'concept', q: `Across the ten years, which element of the competition setup has been the most stable?`,
      choices: [
        { t: 'A functional specification, security requirements and an insecure reference design', ok: true, why: 'Every repository has this shape, whatever the chip: a reference implementation, host-side tools and a defined interface between them.' },
        { t: 'The use of Docker containers to make every reference build reproducible', why: 'Vagrant, Nix and vendor IDEs all appear in the table; containerisation was used in some years, not all.' },
        { t: 'Flashing team firmware over a debug probe with a recent OpenOCD', why: 'Flashing has used ISP programmers, SD cards, vendor tools and serial bootloaders in different years.' },
        { t: 'A 32-bit microcontroller with at least 256 KB of internal flash', why: 'The 2017 part is 8-bit and two years used Linux-class boards booting from SD; memory size is not a constant.' },
      ] },
    { kind: 'security', q: `eCTF 2025 SR2 says a Decoder decodes only genuine frames from its own Satellite System; SR3 says it decodes only frames with strictly increasing timestamps. An attacker records a genuine frame and sends it again an hour later. Which requirement is the one that forbids decoding it?`,
      choices: [
        { t: 'SR3: the frame is authentic, but it is not fresh', ok: true, why: 'A replayed frame carries a valid proof of origin, so an authenticity check passes. Only a freshness rule — here, timestamps that must increase — rejects it.' },
        { t: 'SR2: a frame that has been sent before is no longer a genuine frame from the satellite', why: 'Genuineness concerns who produced the frame. A bit-for-bit copy of a real frame was produced by the real system.' },
        { t: 'Neither: both requirements are met, because the frame was valid when it was first transmitted', why: 'SR3 is evaluated when the frame arrives at the decoder, against the timestamps it has already seen.' },
        { t: 'Both equally: authenticity and freshness are two names for the same property', why: 'They are separate properties with separate mechanisms; a design can have either one without the other.' },
      ] },
  ],
};

const esp32 = {
  id: 'ectf-plat-esp32',
  title: 'ESP32 as the introductory platform',
  minutes: 40,
  summary: 'A cheap board with real secure boot, flash encryption and eFuses to learn on — and a different machine from any eCTF kit.',
  skills: ['ectf-plat-esp32-security'],
  blocks: [
    `## The problem: which board do you learn on?

You want to practise secure boot, key storage and debug lock-down before a competition. The competition board is announced late, costs more, and — as the last lesson showed — may be a different chip next year. You need a board you can buy now, that has real hardware security features with public documentation, and whose mistakes you can afford.

This course uses the ESP32 family for that. This lesson explains what you get from it, and — just as important — exactly where it stops being a guide to competition hardware.`,

    `## "ESP32" is a family, and the members differ

The name covers chips with different instruction sets. From ESP-IDF v6.1's own configuration files${src('Kconfig', S.idfKconfig, 'ESP32 caps', S.idfCaps32, 'S3 caps', S.idfCapsS3, 'C3 caps', S.idfCapsC3, 'C6 caps', S.idfCapsC6)}:

| Chip | Architecture | Cores | CPU frequency options up to | Notable |
|---|---|---|---|---|
| ESP32 (original) | Xtensa | 2 | 240 MHz | Wi-Fi + Bluetooth |
| ESP32-S3 | Xtensa | 2 | 240 MHz | USB OTG and USB Serial/JTAG |
| ESP32-C3 | RISC-V | 1 | 160 MHz | USB Serial/JTAG |
| ESP32-C6 | RISC-V | 1 | 160 MHz | Wi-Fi + Bluetooth + IEEE 802.15.4, USB Serial/JTAG |

The core names come from the datasheets, not the configuration files: the ESP32 has "single-/dual-core 32-bit **LX6** microprocessor(s)" and the ESP32-S3 an "Xtensa 32-bit **LX7** dual-core microprocessor"${src('ESP32 datasheet v5.3', S.esp32ds, 'ESP32-S3 datasheet v2.2', S.esp32s3ds)}. A common module, the ESP32-WROOM-32E, carries an ESP32-D0WD-V3 chip and 4, 8 or 16 MB of flash${src('module datasheet', S.espWroom32e)}.

Neither Xtensa nor RISC-V is Arm. The eCTF 2024–2025 part (MAX78000) and the eCTF 2026 part (MSPM0L2228) both have an Arm Cortex-M core as their main processor (lessons 3 and 4). So the ESP32 already differs from those kits at the level of the instruction set, the exception model and the debugger.`,

    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'esp32' }, caption: 'Click through the ESP32 blocks. Note what is on the chip and what is outside it — in particular, where program flash lives.' },

    `## Where the code lives: external flash

On the original ESP32 the program is stored in an SPI flash chip *outside* the SoC: GPIO6–11 (and usually GPIO16–17) are wired to the module's SPI flash/PSRAM${src('ESP-IDF GPIO reference', S.idfGpio)}. The CPU reaches it through a cache that maps flash into the address space (IROM at \`0x400D0000\`–\`0x40400000\`, DROM at \`0x3F400000\`–\`0x3F800000\`), while internal RAM appears as DRAM at \`0x3FFAE000\`–\`0x40000000\` and IRAM at \`0x40080000\`–\`0x400AA000\`${src('soc.h', S.idfSoc)}.

This one fact shapes the whole security design. Anyone with a soldering iron or a clip can read an external flash chip without touching the CPU. Two features exist because of it:

- **Flash encryption** makes what is stored on that external chip unreadable without a key held inside the SoC.
- **Secure boot** makes the SoC refuse to run flash contents that are not correctly signed.

They answer different threats — confidentiality of stored code and data versus authenticity of what runs — and are usually enabled together.`,

    { t: 'widget', name: 'memory-map', props: { platform: 'esp32' }, caption: 'Find the regions that are backed by external flash through the cache, and the ones that are internal RAM or mask ROM.' },

    `## Boot chain and Secure Boot V2

After reset, code in the mask ROM (\`0x40000000\`–\`0x40070000\` on the ESP32${src('soc.h', S.idfSoc)}) runs first. It loads a **second-stage bootloader** from a flash offset that the ROM fixes: \`0x1000\` on the original ESP32, \`0x0\` on ESP32-S3, -C3 and -C6. The second-stage bootloader reads the partition table (default offset \`0x8000\`) and starts the application (factory app default \`0x10000\`)${src('ROM caps, ESP32', S.idfRom32, 'ROM caps, C3', S.idfRomC3, 'partition tables', S.idfPart)}.

**Secure Boot V2** turns that chain into a chain of verification: the ROM bootloader verifies the second-stage bootloader's signature, and the second-stage bootloader verifies the app. The default scheme is RSA-PSS with RSA-3072 keys. It is available on the ESP32 only from chip revision v3.0, and on the ESP32-C3 from v0.3; ESP32-C6 supports RSA-3072 or ECDSA-256${src('secure-boot-v2.rst', S.idfSb2)}. The older **Secure Boot V1**, for ESP32 before revision v3.0, is an AES-based scheme with a 256-bit key in eFuse BLOCK2, enabled permanently by the \`ABS_DONE_0\` eFuse${src('secure-boot-v1.rst', S.idfSb1)}.

The trust anchor is the part an attacker cannot rewrite: the mask ROM and the [[eFuse]] bits that hold (a digest of) the public key and the enable flags.`,

    { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' }, caption: 'Step from reset to app. At each stage ask: who verified this stage, and with what key stored where?' },

    `## Flash encryption: two different schemes under one name

- **Original ESP32:** *not* XTS. AES-256 with the key in the \`flash_encryption\` eFuse (BLOCK1). Each 32-byte block is encrypted with a key derived by XORing the main key with the block's flash offset (a "key tweak", controlled by \`FLASH_CRYPT_CONFIG\`, recommended value \`0xF\`). The enable state is a counter eFuse, \`FLASH_CRYPT_CNT\`: 7 bits, and an odd number of set bits means encryption is on.
- **Newer chips (S3, C3, C6):** XTS-AES (IEEE Std 1619-2007). ESP32-S3 supports a 256-bit or 512-bit key; ESP32-C3 and -C6 support the 256-bit key only. Keys live in \`BLOCK_KEYN\` eFuses with a key-purpose eFuse, and the counter is \`SPI_BOOT_CRYPT_CNT\`.

Source for both${src('flash-encryption.rst', S.idfFe)}.

Two consequences an engineer should draw without being told. First, a tutorial written for one family member can be wrong for another even though both say "flash encryption". Second, neither scheme authenticates: encryption stops reading, it does not stop an attacker *changing* ciphertext. That is secure boot's job.`,

    { t: 'callout', kind: 'security', title: 'eFuses are one-way, and fault injection is a documented limit', md: `eFuse bits can be programmed once and not cleared. That is what makes them a trust anchor, and also what makes a mistake permanent: a board with secure boot enabled against a key you have lost is finished. Practise the whole flow on a board you are prepared to lose, and read the ESP-IDF security guides end to end first.

Hardware protections also have published limits. Espressif's own vulnerability list records CVE-2023-35818, advisory AR2023-005: bypassing Secure Boot and Flash Encryption using electromagnetic fault injection, applicable to ESP32 chip revisions v3.0/v3.1${src('vulnerabilities.rst', S.idfVuln)}. Two earlier advisories concern older silicon: CVE-2019-15894 (fault injection bypasses the Secure Boot digest check at start-up) and CVE-2019-17391 (a fault just after reset defeats eFuse read protection and exposes the flash-encryption and secure-boot keys). For the second, Espressif states there is no software mitigation for deployed parts and that the ESP32-D0WD-V3 "has checks in ROM which prevent this attack"${src('CVE-2019-15894 advisory', S.espAdv15894, 'CVE-2019-17391 advisory', S.espAdv17391)}.

Put those together carefully. Revision 3 closed *those two* attacks; AR2023-005 then showed a different fault-injection attack on revision 3 itself, and says there is "no immediate mitigation". So "V3 fixes fault injection" is false. The accurate sentence is: V3 has ROM checks against the 2019 attacks and is still subject to the 2023 one. (The researchers' own write-ups and the NVD entries were not read for this course; the statements above are Espressif's.)

Defence, and how to check it: treat physical access as a threat-model decision, not something secure boot makes disappear; keep long-term secrets off devices that will be in an attacker's hands where the design allows; and verify eFuse state on your own board with the read-only summary command in Espressif's esptool suite (confirm the exact command name in the [esptool repository](${S.esptool})).` },

    { t: 'callout', kind: 'mistake', title: 'Assuming GPIO is GPIO', md: `On the original ESP32, GPIO0, 2, 5, 12 and 15 are strapping pins sampled at reset; GPIO34–39 are input-only with no software pull resistors; GPIO12–15 are the JTAG pins; and ADC2 pins cannot be used while Wi-Fi is in use${src('ESP-IDF GPIO reference', S.idfGpio)}. A circuit that pulls a strapping pin the wrong way stops the board booting. None of these particular rules carries over to a MAX78000 or an MSPM0 — but every chip has *some* list like this, and finding it is a first-day job.` },

    { t: 'predict', q: `You have a working flashing script for an original ESP32 that writes the second-stage bootloader at offset 0x1000, the partition table at 0x8000 and the app at 0x10000. You point the same script, unchanged, at an ESP32-C3 board with a bootloader built for the C3. What happens at reset, and why?`,
      choices: [
        { t: 'The ROM finds no valid bootloader where it looks, so the board does not start the app', ok: true, why: 'The C3 ROM expects the second-stage bootloader at flash offset 0x0. The image written at 0x1000 is intact but the ROM never looks there.' },
        { t: 'It boots normally; the ROM scans flash for the bootloader header', why: 'The ROM does not search. The bootloader offset is a fixed property of each chip’s ROM.' },
        { t: 'It boots but with the partition table ignored', why: 'The partition table is read by the second-stage bootloader, which has to be found and started first.' },
        { t: 'The C3 refuses the image because it was signed for Xtensa', why: 'No signing is involved in this scenario, and the bootloader was built for the right chip; think about where the ROM reads from.' },
      ],
      reveal: `The ROM-fixed bootloader offset is \`0x1000\` on the original ESP32 and \`0x0\` on the S3, C3 and C6${src('ROM caps, ESP32', S.idfRom32, 'ROM caps, C3', S.idfRomC3)}. Same vendor, same SDK, same word "ESP32" on the box — different offset. If two members of one family differ in where the first-stage loader looks, assume nothing about a chip from a different vendor.` },

    `## Why it is a good learning board

- The security features are real hardware features with public, versioned documentation in the ESP-IDF repository, so you can cite the exact file a claim comes from.
- The newer chips have a built-in USB Serial/JTAG controller that gives a serial console, flashing and JTAG debugging over one USB cable at the same time (D+/D− on GPIO19/18 for the C3, GPIO20/19 for the S3, GPIO13/12 for the C6)${src('usb-serial-jtag-console.rst', S.idfUsbJtag)}, so you can practise debugger-based work without a separate probe.
- The family contains two instruction sets, so you meet "same SDK, different core" early.
- The external flash makes the confidentiality threat concrete: you can see why flash encryption exists.

## Why it is not a substitute for a competition board

| Question | ESP32 answer | Why that does not transfer |
|---|---|---|
| Where is the program? | External SPI flash, mapped through a cache | The MAX78000 (eCTF 2024, 2025) and MSPM0L2228 (eCTF 2026) have internal flash at fixed addresses (lessons 3 and 4) |
| What is the core? | Xtensa or RISC-V | Those kits are Cortex-M4F (+RISC-V) and Cortex-M0+: different exception model, stack frames, toolchain and disassembly |
| How is firmware installed? | esptool through the ROM's serial download mode, or USB Serial/JTAG | 2024/2025 used a MITRE bootloader dropped onto a DAPLink drive; 2026 uses a MITRE bootloader installed once with TI UniFlash through an external probe |
| Who chooses the security features? | You, in ESP-IDF configuration | The competition rules decide what you may enable; a feature the chip has can be off-limits |
| What runs underneath? | ESP-IDF, which is built on FreeRTOS | The eCTF reference designs are structured around the vendor SDK for that year; whether an RTOS is used is a per-year, per-team decision to check |`,

    { t: 'callout', kind: 'decision', title: 'Learn the mechanism on the ESP32, then re-derive the facts', md: `The alternative would be to learn directly on a past competition board. That gives accurate facts for one year and the same transfer problem next year, at higher cost and with thinner public material. The choice here is to learn the *mechanisms* — a ROM that anchors trust, keys in one-time-programmable storage, a verified boot chain, encrypted storage, debug lock-down — where they are cheapest to practise, and then to practise re-deriving the chip-specific facts for the MAX78000 and MSPM0L2228 from their own documents.` },

    { t: 'exercise', prompt: `An ESP32-based product stores a per-device secret in its application image. The team enables flash encryption but not secure boot, arguing "the attacker cannot read the flash, so they cannot learn the secret or do anything useful". Using only what this lesson has said about what each feature does, describe one concrete attack the team has not ruled out, and say which feature addresses it.`,
      hints: [
        `Separate the two properties: who can *read* stored bytes, and who decides *what code runs*.`,
        `Flash encryption as described here does not authenticate. What can someone with physical access to the flash chip still do to its contents, even without understanding them?`,
        `If the device will execute whatever is in flash, think about what an attacker would want it to execute, and what the device would do with its own key on the attacker's behalf.`,
      ],
      solution: `Flash encryption gives confidentiality of the stored bytes; it does not decide what the CPU is allowed to execute. Without secure boot nothing verifies the bootloader or app before they run, so the remaining attack is on **authenticity**: an attacker with access to the flash chip (or to the download interface, if it has not been restricted) tries to get the device to run code of their choosing, and that code runs with the device's own decryption in effect, so it can simply output the secret. How much work that takes depends on details — whether the attacker can produce validly encrypted content, whether download mode has been locked down — which is exactly why "they cannot read it" is not an argument. Modifying ciphertext to corrupt or roll back code is also not prevented by encryption alone.

The feature that addresses it is **secure boot**: the ROM verifies the second-stage bootloader and the bootloader verifies the app, so unsigned code does not run. The general rule: confidentiality and authenticity are separate properties and each needs its own mechanism. To verify the defence on a board you own, enable both, then confirm that an unsigned image is refused at boot and that the eFuse summary shows the enable bits set.` },

    `## Working on the board: pins, electrical limits and interfaces

The rest of this lesson is the practical half: what you need to know to wire, build, flash and debug an original ESP32, with the same headings the next two lessons use for the eCTF parts.

**Communication interfaces.** ESP-IDF's capability header for the ESP32 counts 3 UARTs, 2 I2C controllers, 3 SPI peripherals (one of them shares the bus of the module's flash), 1 TWAI (CAN) controller, 2 DAC channels and 40 GPIO numbers${src('soc_caps.h', S.idfCaps32h)}. Most peripheral signals can be routed to most pins, which is convenient and is also why the pin *restrictions* matter: the routing is flexible, the electrical and boot-time rules are not.

**Logic levels and drive.** From the DC characteristics table of the datasheet (Table 5-3, at 3.3 V and 25 °C)${src('ESP32 datasheet v5.3', S.esp32ds)}:

| Parameter | Value |
|---|---|
| Input high, V_IH | at least 0.75 × VDD, at most VDD + 0.3 V |
| Input low, V_IL | at most 0.25 × VDD |
| Output high, V_OH | at least 0.8 × VDD |
| Output low, V_OL | at most 0.1 × VDD |
| Source current I_OH, drive strength at maximum | 40 mA typical (20 mA in the VDD_SDIO domain) |
| Sink current I_OL, drive strength at maximum | 28 mA typical |
| Internal pull-up / pull-down | 45 kΩ typical |
| Supply pins, absolute maximum (Table 5-1) | 3.6 V |

Two things that table does **not** contain, although you will read both online: a 5 V-tolerance statement (the only input limit given is VDD + 0.3 V, so a 5 V signal needs a divider or level shifter), and a "recommended 12 mA per pin" figure. Designing for a few milliamps per pin is sound conservative practice — the 40 mA and 28 mA entries are *typical* values at maximum drive strength, not guaranteed minimums — but it is your design margin, not a datasheet number.

**ADC.** Two 12-bit SAR ADCs. The reference is 1100 mV by design and varies from chip to chip, which is why ESP-IDF has a calibration layer. The usable input range depends on the attenuation setting (datasheet Table 4-4): 100–950 mV, 100–1250 mV, 150–1750 mV and 150–2450 mV for attenuation 0 to 3${src('ESP32 datasheet v5.3', S.esp32ds, 'adc_calibration.rst', S.idfAdcCal)}. The ADC does not read down to 0 V or up to 3.3 V.`,

    { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Configuring one output and one input with the ESP-IDF v6.1 GPIO driver. Each call and constant was checked against driver/gpio.h; the fragment was not compiled as a program or run on a board.', code: String.raw`#include "driver/gpio.h"

void pins_init(void)
{
    gpio_config_t led = {
        .pin_bit_mask = 1ULL << GPIO_NUM_4,
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&led);

    gpio_config_t button = {
        .pin_bit_mask = 1ULL << GPIO_NUM_27,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&button);

    gpio_set_level(GPIO_NUM_4, 1);
    int pressed = (gpio_get_level(GPIO_NUM_27) == 0);
    (void)pressed;
}`,
      explain: [
        { lines: '5-12', md: '`pin_bit_mask` is a 64-bit mask, one bit per GPIO number, so one call can configure several pins. `gpio_config` routes the pad to the GPIO function and enables its output driver. GPIO4 is chosen because it is not a strapping pin, not a flash pin and not input-only.' },
        { lines: '14-21', md: 'An input with the internal pull-up (about 45 kΩ) enabled: the pin reads 1 when the button is open and 0 when the button connects it to ground. The same code on GPIO34–39 would leave the pin floating, because those pads have no internal pull resistors.' },
        { lines: '23-24', md: '`gpio_set_level` writes the output register; `gpio_get_level` samples the pad. "Pressed" is level 0 because the button pulls the pin low.' },
      ] },

    `## Development environment, build and flash

1. **Install.** Since ESP-IDF v6.0 the default on Linux is the ESP-IDF Installation Manager: add Espressif's APT repository, \`sudo apt install eim\`, then \`eim install\`${src('eim-install-idf.rst', S.idfEim, 'linux-setup.rst', S.idfLinux)}. The rendered "stable" documentation showed v6.1.1 when it was checked; this course's code is checked against v6.1.
2. **Select the chip.** \`idf.py set-target esp32\` (or \`esp32s3\`, \`esp32c3\`, …). This is the step that picks the toolchain, the memory layout and the bootloader offset from the last section; it also clears any existing build and configuration in the project.
3. **Build.** \`idf.py build\` compiles the second-stage bootloader, the partition table and your application.
4. **Flash and watch.** \`idf.py -p PORT flash monitor\` writes all three at the offsets for the selected target using esptool through the ROM's serial download mode, then opens the serial console${src('start-project.rst', S.idfStart)}.

You should see the ROM's boot messages, then the second-stage bootloader's log, then your application's output. If nothing appears, the usual causes are the wrong serial port, or a strapping pin held at the wrong level by your circuit.

## Debugging workflow

- **Serial log first.** \`idf.py monitor\` shows the boot chain's own messages, so you can tell *which stage* failed — the single most useful fact in a boot problem.
- **JTAG when you need to stop the CPU.** On the original ESP32, JTAG is on GPIO12–15 and needs an external probe or a board with one built in; \`idf.py openocd\` starts Espressif's OpenOCD and \`idf.py gdb\` connects GDB to it${src('using-debugger.rst', S.idfJtagUse, 'JTAG guide', S.idfJtag)}. The board configuration file depends on your hardware (the guide's example for the ESP-WROVER-KIT is \`board/esp32-wrover-kit-3.3v.cfg\`). The S3, C3 and C6 need no probe: their USB Serial/JTAG controller does it over the USB cable.
- **JTAG is also an attack surface.** By default, enabling Secure Boot or flash encryption makes the bootloader disable JTAG permanently by eFuse on the first boot${src('secure-boot-v2.rst', S.idfSb2, 'flash-encryption.rst', S.idfFe)}; that is one of the irreversible steps to rehearse on a spare board.

## Hardware limitations to design around

- Program storage is outside the chip; anything not encrypted is readable with a flash clip.
- Five strapping pins, six input-only pins without pull resistors, the flash pins, and ADC2 lost to Wi-Fi: pin choice is a design decision.
- Inputs are limited to VDD + 0.3 V; the ADC covers roughly 0.1–2.45 V at most and needs calibration.
- eFuse changes are permanent, and published fault-injection attacks exist for every revision of the original ESP32.`,

    { t: 'exercise', prompt: `A sensor board powered from 1.8 V drives a logic output straight into an ESP32 GPIO. The ESP32's VDD is 3.3 V. Using the datasheet thresholds in this lesson: (a) what is the lowest input voltage the ESP32 is guaranteed to read as a 1? Enter it in volts. (b) Will the sensor's "high" of at most 1.8 V be read reliably? (c) Is the ESP32's own output high safe for the sensor's 1.8 V input?`,
      hints: [
        `Which row of the table tells you what the *input* needs, as opposed to what the output delivers?`,
        `V_IH is at least 0.75 × VDD. The region between V_IL and V_IH is not guaranteed to read as either level.`,
        `Multiply 0.75 by 3.3 V, and 0.25 by 3.3 V. Then place 1.8 V on that scale. For (c), compute the ESP32's minimum output high, 0.8 × VDD, and ask what the sensor's input limit would have to be.`,
      ],
      solution: `(a) V_IH(min) = 0.75 × 3.3 V = **2.475 V**. V_IL(max) = 0.25 × 3.3 V = 0.825 V.

(b) No. 1.8 V lies between 0.825 V and 2.475 V, where the datasheet guarantees nothing. It may read as 1 on your bench and as 0 on a colder day or another chip — the worst kind of fault, because it passes a first test.

(c) Not without checking the sensor's datasheet: the ESP32 drives at least 0.8 × 3.3 V = 2.64 V, well above a 1.8 V supply. Unless the sensor's inputs are specified to tolerate that, it needs level shifting in this direction too.

The fix is a level shifter (or a sensor variant with 3.3 V I/O). The method transfers to any chip: find V_IH and V_IL as fractions of the supply in the DC characteristics table, compute them for *your* supply, and compare with the other device's guaranteed output levels — both directions.`,
      answer: { type: 'number', value: 2.475, tol: 0.03, unit: 'V' } },

    `## Harder application

Take the table "why it is not a substitute" and turn each row into a question you could answer about *any* chip in ten minutes with its documentation: where is the program stored; what core; how is firmware installed; who is allowed to turn on which security feature; what software layer sits under the application. Then answer them for the ESP32-C3 using only the sources cited in this lesson, noting for each answer the file it came from. Lessons 3 and 4 answer the same questions for the two eCTF parts, and lesson 5 puts the three side by side.`,

    { t: 'refs', items: [
      { title: 'ESP-IDF v6.1: Secure Boot V2', url: S.idfSb2 },
      { title: 'ESP-IDF v6.1: Flash encryption', url: S.idfFe },
      { title: 'ESP-IDF v6.1: Security vulnerabilities list (includes AR2023-005 / CVE-2023-35818)', url: S.idfVuln },
      { title: 'ESP-IDF v6.1: ESP32 GPIO notes (strapping pins, input-only pins, ADC2)', url: S.idfGpio },
      { title: 'ESP-IDF v6.1: ESP32 memory map (soc.h)', url: S.idfSoc },
      { title: 'ESP32 Series Datasheet (v5.3): core, DC characteristics (Table 5-3), ADC (Table 4-4)', url: S.esp32ds },
      { title: 'Espressif advisory: fault injection and eFuse protections (CVE-2019-17391)', url: S.espAdv17391 },
      { title: 'Espressif advisory: fault injection and Secure Boot (CVE-2019-15894)', url: S.espAdv15894 },
      { title: 'ESP-IDF v6.1: JTAG debugging guide', url: S.idfJtag },
      { title: 'ESP-IDF Programming Guide (rendered; "stable" showed v6.1.1 when checked)', url: S.idfGuide },
    ] },
  ],
  quiz: [
    { kind: 'security', q: `A design enables Secure Boot V2 on an ESP32 but leaves flash encryption off. Which threat remains open by design?`,
      choices: [
        { t: 'Reading the firmware, and any secrets in it, from the external flash chip', ok: true, why: 'Secure boot checks signatures; it does not hide the stored bytes, and on this chip the program sits in a flash device outside the SoC.' },
        { t: 'Running an application image that has not been signed with the project’s key', why: 'Refusing unsigned code is precisely what the verified boot chain provides.' },
        { t: 'Replacing the second-stage bootloader with one that carries no valid signature', why: 'The ROM verifies the second-stage bootloader under Secure Boot V2, so this is the case the feature covers.' },
        { t: 'Clearing the secure-boot eFuses again so that the chip accepts any image', why: 'eFuse bits are one-time programmable; they cannot be returned to the unprogrammed state.' },
      ] },
    { kind: 'arch', q: `You are handed an "ESP32" board and asked whether Secure Boot V2 can be enabled. What do you need to find out first?`,
      choices: [
        { t: 'Which family member it is, and its chip revision', ok: true, why: 'Availability depends on both: for example the original ESP32 needs revision v3.0 or later, and the C3 needs v0.3 or later.' },
        { t: 'How much flash the module carries: 4, 8 or 16 MB', why: 'Flash size affects what fits, not whether the ROM contains the V2 verification scheme.' },
        { t: 'Whether the application is going to use Wi-Fi or Bluetooth', why: 'Radio use constrains ADC2 pins on some chips; it has no bearing on the ROM’s boot verification.' },
        { t: 'Whether the board exposes a USB Serial/JTAG connector', why: 'That affects how you debug and flash, not which secure boot scheme the silicon supports.' },
      ] },
    { kind: 'concept', q: `Why does the original ESP32’s use of external SPI flash matter to a threat model more than the internal flash of a typical Cortex-M microcontroller?`,
      choices: [
        { t: 'The image can be read or rewritten at the flash chip’s pins, bypassing the CPU', ok: true, why: 'An external memory device is a separate attack surface with its own accessible bus, so storage needs its own protection.' },
        { t: 'External flash is slower than internal flash, which makes timing attacks on the firmware easier', why: 'Speed of storage is not what timing side channels on secret-dependent code depend on.' },
        { t: 'External flash cannot hold signed images, so secure boot is unavailable on such chips', why: 'Signature blocks are just data in the image; the storage location does not prevent signing.' },
        { t: 'Internal flash can never be read by an attacker, whereas external flash always can', why: 'Internal flash is harder to reach, not unreachable; debug ports and fault injection exist. The point is relative exposure.' },
      ] },
    { kind: 'concept', q: `A blog post describes ESP32 flash encryption as "XTS-AES". For which chip is that description wrong, according to ESP-IDF’s documentation?`,
      choices: [
        { t: 'The original ESP32, which uses AES-256 with a per-block key tweak', ok: true, why: 'The original chip’s scheme derives a per-block key from the main key and the flash offset; XTS-AES arrived with the newer chips.' },
        { t: 'The ESP32-S3, which uses a 256-bit or 512-bit key held in eFuses', why: 'The S3 is one of the chips documented as using XTS-AES, with a 256- or 512-bit key.' },
        { t: 'The ESP32-C3, which supports only the 256-bit key option', why: 'The C3 is documented as XTS-AES with the 256-bit key option only.' },
        { t: 'None of them, because the whole family shares a single scheme', why: 'The documentation describes two distinct schemes within the family, which is why chip-specific reading matters.' },
      ] },
    { kind: 'security', q: `A datasheet for a module says it contains an ESP32-D0WD-V3. A colleague concludes: "V3 fixed the fault-injection attacks, so with Secure Boot V2 and flash encryption a stolen device keeps its keys." Which reply matches Espressif’s advisories?`,
      choices: [
        { t: 'V3’s ROM checks block the 2019 attacks; AR2023-005 is a later attack on v3.0/v3.1', ok: true, why: 'CVE-2019-17391 and CVE-2019-15894 are addressed in the V3 ROM. CVE-2023-35818 then showed an EMFI bypass on v3.0 and v3.1 with no immediate mitigation, so physical access stays in the threat model.' },
        { t: 'Correct: revision 3 added ROM checks, and no fault-injection advisory applies to revision 3 parts', why: 'Espressif’s own vulnerability list records an advisory that names chip revisions v3.0 and v3.1 specifically.' },
        { t: 'Wrong, because V3 changed nothing: the 2019 eFuse read-out attack works unchanged on every revision', why: 'The advisory for that attack states that the D0WD-V3 has checks in ROM which prevent it. The remaining exposure is a different, later attack.' },
        { t: 'Correct, provided the device also runs the latest ESP-IDF release, which patches the remaining issue', why: 'The 2023 advisory states there is no immediate mitigation; a fault injected into the boot ROM’s execution is not repaired by application software.' },
      ] },
    { kind: 'circuit', q: `A 5 V sensor output is wired straight to an ESP32 GPIO because "a forum says the pins are 5 V tolerant". What does the ESP32 datasheet (v5.3) actually give you to decide with?`,
      choices: [
        { t: 'An input maximum of VDD + 0.3 V, and no 5 V-tolerance statement', ok: true, why: 'With VDD at 3.3 V the stated limit is 3.6 V. A 5 V signal exceeds it, so it needs a divider or a level shifter whatever a forum reports.' },
        { t: 'A statement that all digital inputs tolerate 5 V as long as the pin is configured as an input', why: 'No such statement appears in the datasheet’s electrical characteristics; the only input limit given is tied to VDD.' },
        { t: 'A 12 mA recommended input current, which a series resistor can be sized to respect', why: 'That figure is widely quoted but does not appear in the datasheet, and a current figure would not replace a voltage limit anyway.' },
        { t: 'An absolute maximum of 3.6 V on the supply pins only, which places no limit on signal pins', why: 'The supply limit is one row; the DC characteristics separately bound the input voltage relative to VDD.' },
      ] },
  ],
};

const max78000 = {
  id: 'ectf-plat-max78000',
  title: 'Analog Devices MAX78000FTHR (eCTF 2024 and 2025)',
  minutes: 50,
  summary: 'A Cortex-M4F with a RISC-V coprocessor, flash at 0x10000000, an on-board DAPLink — and two years of quite different build tooling around it.',
  skills: ['ectf-plat-max78000-map'],
  blocks: [
    `## The problem: the image builds, and the board does nothing

It is the first week with the eCTF 2024 kit. You build a "hello" example straight from Analog Devices' SDK, convert it to a \`.bin\`, send it to the board with the competition's update tool, and nothing runs. The same source built inside the reference design's project works. The C is identical. What differs?

To answer that you need the chip's memory map, the layout the competition imposes on top of it, and how an image gets from your disk into flash. This lesson builds those three things from the SDK headers and the reference repositories.`,

    `## The chip

Analog Devices describes the MAX78000 as an "Artificial Intelligence Microcontroller with Ultra-Low-Power Convolutional Neural Network Accelerator"; the supported boards include the MAX78000FTHR feather board${src('MSDK user guide', S.msdkGuide)}.

- **Cores.** An Arm Cortex-M4 with FPU and MPU (the device header sets \`__FPU_PRESENT 1\`, \`__MPU_PRESENT 1\`), plus a RISC-V core. The header has a separate RV32 interrupt map; the RISC-V core has to be set up and started by the Arm core, and is debugged over a separate JTAG port${src('max78000.h', S.maxHdr, 'MSDK user guide', S.msdkGuide)}. The Cortex-M4 implements the ARMv7-M architecture (Thumb-2 instructions), which is why the reference builds use \`arm-none-eabi-gcc\`.
- **Clocks.** Internal oscillators, nominal: IPO 100 MHz, ISO 60 MHz, IBRO 7.3728 MHz, ERTCO 32.768 kHz, INRO about 30 kHz${src('system_max78000.h', S.maxSys)}. The header lists oscillators; the maximum CPU frequency as a specification is not verified here — check the MAX78000 datasheet's electrical characteristics.
- **Memory.** Flash at **\`0x10000000\`**, size \`0x80000\` (512 KB), page size \`0x2000\` (8 KB). SRAM at **\`0x20000000\`**, size \`0x20000\` (128 KB). ROM at \`0x00000000\`${src('max78000.h', S.maxHdr, 'max78000.ld', S.maxLd)}.
- **Peripherals** (instance counts from the header): UART ×4 (UART3 is the low-power UART), I2C ×3, SPI ×2 on the Arm core, timers ×6 (two low-power), GPIO ports ×4, watchdog ×2, ADC, DMA, RTC, wake-up timer, 1-Wire master, I2S, a parallel camera interface, a low-power comparator, and 8 semaphores for communication between the two cores${src('max78000.h', S.maxHdr)}.
- **Security-relevant peripherals:** an AES engine with separate AES key registers, a true random number generator (TRNG) and a CRC unit${src('max78000.h', S.maxHdr)}.`,

    { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'max78000' }, caption: 'Locate the two cores, the flash, the SRAM and the security peripherals. Which blocks does the Cortex-M4 own at reset?' },

    { t: 'callout', kind: 'note', title: 'Still not verified — look these up before you rely on them', md: `The MAX78000 facts in this lesson come from Analog Devices' SDK on GitHub and from MITRE's rules pages. Analog Devices' own site returned an empty reply to every request when the fact sheet was checked, so **no MAX78000 datasheet or user guide was read**. The following are therefore not stated here:

| Item | Where to confirm |
|---|---|
| Maximum CPU frequency as a specification (only the 100 MHz and 60 MHz oscillator constants are verified) | MAX78000 datasheet, electrical characteristics |
| Which RV32 variant the RISC-V core is | MAX78000 datasheet, features; user guide, RISC-V chapter |
| Secure-boot and ROM bootloader variants (only the *existence* of a serial boot ROM interface is verified, through MITRE's procedure) | MAX78000 datasheet ordering information; user guide, bootloader chapter |
| ADC resolution (the driver header shows inputs AIN0–AIN3 plus internal selections, not the resolution) | MAX78000 datasheet, ADC electrical characteristics |
| TRNG and CNN accelerator details | MAX78000 datasheet and user guide |
| The feather board's microphone part number | MAX78000FTHR board data sheet and schematic |

Verified since the first version of this lesson: the AES driver's key sizes (128, 192 and 256 bits)${src('aes.h', S.maxAes)}, and the board parts the BSP builds drivers for (see below). Product page (not read): ${N.max78000}.` },

    `## The board: MAX78000FTHR

The board support package the 2024 and 2025 reference designs select is \`FTHR_RevA\`${src('2024 README', S.y2024readme, '2025 README', S.y2025readme)}. From that BSP${src('board.h', S.maxBoardH, 'board.c', S.maxBoardC)}:

- Console on UART0 at 115200 baud.
- An RGB LED made of three LEDs on P2.0 (red), P2.1 (green) and P2.2 (blue), **active low**.
- Two push-buttons, on P0.2 and P1.7.
- Drivers built by the BSP: an **OV7692** camera, a **MAX20303** power-management IC (it switches camera, microphone and SD-card power), a **MAX9867** audio codec and a serial SRAM${src('board.mk', S.maxBoardMk, 'board.c', S.maxBoardC)}.

MITRE's 2025 board page lists the same headline features: Cortex-M4 core, RISC-V core, 512 KB flash, 128 KB SRAM, 16 KB cache, neural-network accelerator, camera, audio interface and a DAPLink debugger${src('2025 board page', S.r25board)}. In 2024 each team had **three** of these boards — one Application Processor and two Components — plugged into MITRE's eCTF breakout board, which joins them on a shared I2C bus and adds a Bootloader Button${src('2024 architecture', S.r24arch, 'breakout board', S.r24breakout)}.

The board carries its own debug adapter: "an integrated MAX32625PICO ('PICO') debug adapter", which appears to the host as a **DAPLINK** mass-storage drive. Holding SW5 while plugging in puts the adapter into MAINTENANCE mode for updating the adapter's own firmware. Dropping a file named \`erase.act\` on the DAPLINK drive mass-erases the target${src('MAX78000 Feather README', S.maxFthr)}.`,

    { t: 'callout', kind: 'hw', title: 'Two processors share that USB cable', md: `The USB connector is wired to the debug adapter (a separate MAX32625 microcontroller), not directly to the MAX78000. When "the board" misbehaves, decide which of the two you are talking to: the DAPLINK drive and the debug connection belong to the adapter; your firmware's console output is the MAX78000's UART0 relayed through it. The MAINTENANCE drive is the *adapter's* bootloader, not the target's.` },

    `## Memory map, and the layout eCTF puts on top of it

The chip gives you 512 KB of flash from \`0x10000000\`. The stock MSDK linker script lets an application use it from the start${src('max78000.ld', S.maxLd)}. The eCTF 2024 and 2025 reference designs do not. Their \`firmware.ld\` divides flash like this${src('2024 firmware.ld', S.y2024ld, '2025 firmware.ld', S.y2025ld)}:`,

    { t: 'ascii', text: `eCTF 2024 / 2025 reference layout on the MAX78000 (from firmware.ld)

0x1007FFFF ┌──────────────────────────┐
           │ ROM_BL_PAGE   len 0x2000 │  0x1007E000
0x1007E000 ├──────────────────────────┤
           │ RESERVED     len 0x38000 │  0x10046000
0x10046000 ├──────────────────────────┤
           │ FLASH (team) len 0x38000 │  0x1000E000   <- your firmware is linked here
0x1000E000 ├──────────────────────────┤
           │ BOOTLOADER    len 0xE000 │  0x10000000   <- MITRE eCTF bootloader
0x10000000 └──────────────────────────┘

0x2001FFFF ┌──────────────────────────┐
           │ SRAM         len 0x20000 │  0x20000000
0x20000000 └──────────────────────────┘`, caption: 'Region names and lengths are those in the reference linker scripts. Check: 0xE000 + 0x38000 + 0x38000 + 0x2000 = 0x80000, the whole 512 KB.' },

    { t: 'widget', name: 'memory-map', props: { platform: 'max78000' }, caption: 'Explore the chip-level map, then overlay the eCTF layout above in your head: which chip-level region does each linker region sit inside?' },

    `That is the answer to the opening problem. An example built with the stock linker script is linked to run from \`0x10000000\`. The eCTF bootloader occupies that address and expects a team image linked at \`0x1000E000\`. Same C, different addresses baked into the vector table and every absolute reference — so it does not run.`,

    { t: 'predict', q: `The 2025 flashing tool defines \`PAGE_SIZE = 8192\` and \`APP_PAGES = 28\`. Before calculating anything: do you expect 28 × 8192 to equal the length of one of the linker regions above? Which one, and what would it mean if it did not?`,
      reveal: `28 × 8192 = 229 376 = \`0x38000\`, exactly the length of the team FLASH region${src('flash.py', S.y2025flash, '2025 firmware.ld', S.y2025ld)}. And 8192 = \`0x2000\` is the chip's flash page size from the device header. Three independent files — the vendor header, the linker script and the host flasher — agree, which is how you gain confidence in a layout you cannot yet test on hardware.

If they had *disagreed*, that would be a finding: either the tool can write beyond the region the linker uses, or part of the region can never be updated. Cross-checking constants between the host tool and the firmware's linker script is a cheap habit that finds real bugs.` },

    `## Boot process, as far as the sources go

1. Reset. The chip has ROM at \`0x00000000\`${src('max78000.h', S.maxHdr)}. One thing about it is verified: a **serial boot ROM interface** exists. MITRE's procedure for unlocking attack boards enters it by holding the UART0 RX and SWDCLK pads low at power-up and then talks to it at 115200 baud${src('2025 secure-bootloader removal', S.r25sbl)}. What else the ROM does, and whether a part variant's ROM performs a secure-boot check, is **not verified here** (datasheet ordering information; user guide, bootloader chapter). The reference linker script reserves a \`ROM_BL_PAGE\` at the top of flash, which tells you the ROM cares about that page, not what it does with it.
2. In the 2024 and 2025 systems, the **MITRE eCTF bootloader** sits at the start of flash (\`0x10000000\`, \`0xE000\` bytes = 7 pages) and starts the team image at \`0x1000E000\`. It has two modes. **Update mode** is entered by resetting the board while holding **SW1** (in 2024 also the breakout board's Bootloader Button); the LED blinks blue and the bootloader accepts a new image over serial. Otherwise it starts the installed image${src('2025 bootloader', S.r25boot, '2024 bootloader', S.r24boot)}.
3. Your image's startup code runs, then \`main\`.

There are two builds of that bootloader. Design-phase boards ship **without** any bootloader; you install the unprotected \`insecure.bin\`. Attack-phase boards arrive with a keyed **secure bootloader** preinstalled, "which disables debug functionality"${src('2025 secure-bootloader removal', S.r25sbl)}. What the secure build checks, and how images for it are protected, is not published — only its externally visible behaviour is verified.`,

    { t: 'widget', name: 'boot-sequence', props: { platform: 'max78000' }, caption: 'Step the boot sequence. Mark each stage as "verified from a source" or "check the user guide" — the widget shows which is which.' },

    `## The 2024 system and its tooling

**System.** One **Application Processor** (AP) and several **Components**. The AP is the I2C controller (\`MXC_I2C1\`, 100 kHz, messages up to 256 bytes); Components are I2C peripherals. The example AP is provisioned for two components with IDs \`0x11111124\` and \`0x11111125\`. Host tools expose four functions: **list** components, **boot**, **replace** a component using a token, and read **attestation** data using a PIN. In the insecure example the PIN is \`123456\` and the token is \`0123456789abcdef\`${src('2024 README', S.y2024readme, 'simple_i2c_controller.h', S.y2024i2c, 'application_processor.c', S.y2024ap)}.

**Security requirements (five, summarised).** SR1: the AP boots only if all expected Components are present and valid. SR2: Components boot only when commanded by a valid AP that has confirmed integrity. SR3: the Attestation PIN and Replacement Token stay confidential. SR4: Component Attestation Data stays confidential. SR5: integrity and authenticity of post-boot messages${src('2024 security requirements', S.r24sec)}. Limits from the detailed specification: wake within 1 s, attest/list/boot within 3 s, replace within 5 s${src('2024 detailed specifications', S.r24detail)}.

**Tooling.** A **Nix** shell (\`shell.nix\` provides gnumake, Python 3.9, \`gcc-arm-embedded\`, Poetry, minicom and a packaged Analog Devices fork of OpenOCD) plus **Poetry** for the \`ectf_tools\` Python package. The MSDK is pinned to tag \`v2023_06\`. Build entry points are \`ectf_build_depl\`, \`ectf_build_ap\` and \`ectf_build_comp\`; build parameters are injected into a generated header, \`ectf_params.h\`${src('shell.nix', S.y2024nix, 'pyproject.toml', S.y2024py)}.

**Flashing.** First install the provided bootloader by dragging it onto the DAPLINK drive (\`insecure.bin\` for the design phase); a flashing blue LED indicates success. After that, put the board in update mode (hold SW1 or the Bootloader Button during reset) and send images through the bootloader: \`ectf_update --infile <img> --port <serial>\`${src('2024 README', S.y2024readme, '2024 bootloader', S.r24boot)}.`,

    `## The 2025 system and its tooling

**System.** A **Satellite TV System**. The team's encoder (host Python) encodes frames; the satellite broadcasts them; a TV on the host forwards encoded frames over serial to a **Decoder** — the firmware on the MAX78000 — and gets back decoded frames. Constants in the reference decoder: up to 8 channels, channel 0 is an emergency channel that the reference design always decodes and refuses subscriptions for, frames are 64 bytes, timestamps are 64-bit. Subscriptions carry a device ID, start and end timestamps and a channel. The decoder's commands are: list channels, update subscription, decode frame${src('2025 README', S.y2025readme, 'decoder.c', S.y2025dec)}. The functional requirements add that subscriptions must persist across power loss and that the decoder must keep up with 1,000 64-byte frames per second${src('2025 functional requirements', S.r25func, '2025 detailed specifications', S.r25detail)}.

**Security requirements (three, summarised).** SR1: a frame must not be decodable without a Decoder holding a valid, currently active subscription for its channel. SR2: a Decoder decodes only genuine frames from the Satellite System it was provisioned for. SR3: a Decoder decodes only frames with strictly increasing timestamps${src('2025 security requirements', S.r25sec)}. Notice that SR3 is *freshness*, a different property from SR2's authenticity: a recorded genuine frame passes SR2 and must still be refused.

**Tooling.** **Docker**. The decoder's Dockerfile starts from \`ubuntu:24.04\`, installs \`gcc-arm-none-eabi\`, \`gdb-multiarch\` and make, and downloads MSDK tag \`v2024_02\`. Host Python is a plain \`venv\` with \`pip install\`, Python 3.11 or later${src('Dockerfile', S.y2025docker, 'tools pyproject', S.y2025py)}.`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'eCTF 2025 reference build and flash, as given in the 2025 repository. Not run here.', code: `# host tools and design package
python -m venv .venv && . .venv/bin/activate
pip install ./tools/
pip install -e ./design/

# 1. secrets for channels 1, 3 and 4
python -m ectf25_design.gen_secrets secrets/secrets.json 1 3 4

# 2. build the decoder image inside the container
cd decoder
docker build -t decoder .
docker run --rm -v ./build_out:/out -v ./:/decoder \\
    -v ./../secrets:/secrets -e DECODER_ID=0xdeadbeef decoder

# 3. flash through the eCTF bootloader (update mode: hold SW1 during reset; LED blinks blue)
python -m ectf25.utils.flash ./build_out/max78000.bin /dev/ttyACM0`,
      explain: [
        { lines: '7', md: 'Secrets are generated by the *team’s* Python code and written to a JSON file. Whatever that file contains is what the firmware build and the encoder share, so its design is a security decision.' },
        { lines: '11-13', md: 'The container gets three mounts: the source, the secrets, and an output directory. `DECODER_ID` is the per-device identity injected at build time. The build emits `max78000.elf` and `max78000.bin`.' },
        { lines: '15-16', md: 'The flasher talks to the MITRE bootloader over the serial port at 115200 baud and writes the team region page by page. It only gets an answer if the board is in update mode. The port name is an example; yours will differ.' },
      ] },

    `Source for the commands${src('2025 README', S.y2025readme, 'flash.py', S.y2025flash, '2025 bootloader', S.r25boot)}.

**What changed from 2024 to 2025**, all from the two repositories: Nix + Poetry became Docker + pip/venv; MSDK \`v2023_06\` became \`v2024_02\`; \`ectf_*\` console scripts became \`python -m ectf25.*\` modules; a multi-board I2C system became a single board on UART; and a secrets JSON generated by team Python replaced the \`deployment/\` Makefile. The linker layout did not change.`,

    { t: 'callout', kind: 'mistake', title: 'Using whatever MSDK you already have installed', md: `The reference builds pin the SDK: \`v2023_06\` in 2024, \`v2024_02\` in 2025. Building the same source against a different MSDK release can change driver behaviour, startup code or default clock setup. If your image behaves differently from a teammate's, compare the toolchain and SDK versions before you compare the C. The whole purpose of the Nix shell and the Dockerfile is to make that comparison unnecessary — so build inside them.` },

    { t: 'callout', kind: 'decision', title: 'Flash through the bootloader, debug through the probe', md: `There are two ways to put bytes into the MAX78000's flash: the MITRE bootloader over serial, and the on-board debug adapter (drag-and-drop on DAPLINK, or OpenOCD with a debugger). The reference flow uses the bootloader for team images because that is the path the competition infrastructure uses. The debug adapter remains the tool for *understanding* your firmware — the MSDK toolchain includes an OpenOCD build and GDB for this${src('MSDK README', S.msdkReadme)} — but writing the whole flash through it, or mass-erasing with \`erase.act\`, clears the flash that holds the bootloader at \`0x10000000\`, so expect to reinstall it. Whether a debugger may be attached at all in a given phase is a rules question; check that year's rules.` },

    `## Debugging workflow

1. Build inside the pinned environment so the ELF matches what you flash.
2. Start Analog Devices' fork of OpenOCD (installed with the MSDK; in 2024 packaged by \`shell.nix\`) against the board's DAPLink adapter. The 2025 rules give the command: \`openocd -s scripts/ -f interface/cmsis-dap.cfg -f target/max78000.cfg -c "bindto 0.0.0.0; init"\`, which opens a GDB server on port 3333${src('2025 OpenOCD page', S.r25openocd)}. Upstream OpenOCD is not the documented tool for this part.
3. Connect GDB (\`arm-none-eabi-gdb\`, or \`gdb-multiarch\` as installed by the 2025 Dockerfile) with the ELF for symbols: \`target remote :3333\`.
4. Keep a serial terminal on the console UART (115200) open alongside.
5. Know when this stops working: attack-phase boards carry the secure bootloader, which disables debug. Everything you learn with a debugger, you learn on design-phase boards.

The RISC-V core is a separate debug target on a separate JTAG port${src('MSDK user guide', S.msdkGuide)}; if your design never starts it, it is not part of your debug session, but it *is* part of your attack-surface inventory.`,

    `## Security capabilities and hardware limits

What the sources establish: the chip has an MPU on the Cortex-M4, an AES engine with dedicated key registers, a TRNG and a CRC unit${src('max78000.h', S.maxHdr)}; the AES driver accepts 128-, 192- and 256-bit keys${src('aes.h', S.maxAes)}; and debug access *can* be disabled, because MITRE's secure bootloader does it on attack boards${src('2025 secure-bootloader removal', S.r25sbl)}. What they do not establish, and you must read before designing around: whether keys in the AES key registers survive reset or can be read back; the TRNG's health tests and throughput; whether flash has read or write protection; and by what mechanism debug is locked. For each, go to the MAX78000 user guide chapter for that peripheral — and remember that a hardware AES engine says nothing about side-channel resistance.

Limits you can already reason about from verified facts:

- **All flash is internal and uniformly addressed.** There is no separate secure storage visible in the header beyond the AES key registers; anything you store in the team flash region is protected only by whatever access control the chip and bootloader provide.
- **8 KB flash pages.** Erase granularity is a page, so a single updatable secret costs a whole 8 KB page, and with 28 pages in the team region you cannot scatter many of them.
- **Two cores, eight shared semaphores.** A second processor that can be started by the first is extra capability and extra attack surface.
- **A debug adapter on the board.** Physical possession of the board includes a ready-made debug connection unless something disables it.`,

    `## GPIO and peripheral configuration

On the MAX78000 a pin is described by one structure and configured by one call. The LED and button tables below are the ones in the \`FTHR_RevA\` board support package${src('board.c', S.maxBoardC, 'gpio.h', S.maxGpio)}.`,

    { t: 'code', lang: 'c', status: 'reviewed', caption: 'MAX78000FTHR: the red LED (P2.0) and the push-button on P0.2 with the MSDK GPIO driver. Names and fields were checked against gpio.h, uart.h and board.c on the MSDK main branch; the eCTF years pin older tags (v2023_06, v2024_02), so check the same headers at your tag. Not compiled or run here.', code: String.raw`#include "mxc_device.h"
#include "gpio.h"
#include "uart.h"

static const mxc_gpio_cfg_t led_red = {
    MXC_GPIO2, MXC_GPIO_PIN_0, MXC_GPIO_FUNC_OUT,
    MXC_GPIO_PAD_NONE, MXC_GPIO_VSSEL_VDDIOH, MXC_GPIO_DRVSTR_0 };

static const mxc_gpio_cfg_t button = {
    MXC_GPIO0, MXC_GPIO_PIN_2, MXC_GPIO_FUNC_IN,
    MXC_GPIO_PAD_PULL_UP, MXC_GPIO_VSSEL_VDDIOH, MXC_GPIO_DRVSTR_0 };

void board_pins_init(void)
{
    MXC_GPIO_Config(&led_red);
    MXC_GPIO_Config(&button);

    MXC_GPIO_OutClr(led_red.port, led_red.mask);          /* LED on  */
    if (MXC_GPIO_InGet(button.port, button.mask) == 0) {  /* pressed */
        MXC_GPIO_OutSet(led_red.port, led_red.mask);      /* LED off */
    }

    MXC_UART_Init(MXC_UART0, 115200, MXC_UART_IBRO_CLK);  /* console */
}`,
      explain: [
        { lines: '5-7', md: 'Port, pin mask, function, pad (pull) setting, I/O supply selection and drive strength — the six fields of `mxc_gpio_cfg_t`. `MXC_GPIO_FUNC_OUT` makes P2.0 a plain output; the `ALT1`–`ALT4` values of the same field hand the pad to a peripheral instead. That one field is this chip’s pin multiplexer.' },
        { lines: '9-11', md: 'The button input uses the pad’s pull-up, so an open button reads 1 and a pressed one reads 0. `VSSEL` chooses which of the chip’s two I/O supply rails the pad uses: a per-pin electrical decision that has no equivalent on the ESP32 or the MSPM0.' },
        { lines: '18-20', md: 'The board’s LEDs are **active low**: clearing the output bit drives the pin low and lights the LED. `OutSet` turns it off. Getting this backwards is the commonest first-hour confusion on this board.' },
        { lines: '23', md: 'The console is UART0 at 115200 baud, clocked here from the 7.3728 MHz IBRO as the BSP does. It reaches your PC through the DAPLink adapter’s serial bridge, not through a USB port on the MAX78000 itself.' },
      ] },

    `**Communication interfaces as the eCTF designs used them.** 2024: \`MXC_I2C1\` at 100 kHz between the Application Processor (controller) and the Components (peripherals), messages up to 256 bytes — a shared bus that anyone holding the hardware can watch and drive. 2025: UART0 at 115200 baud to the host. The chip also has two more UARTs, a low-power UART, two SPI ports, I2S and a 1-Wire master that neither design uses; unused peripherals still belong on your attack-surface list if their pins are reachable.

**Interrupt priorities.** The device header sets \`__NVIC_PRIO_BITS\` to 3, so the Cortex-M4 here has 8 priority levels${src('max78000.h', S.maxHdr)}. Keep the number in mind for lesson 5.`,

    { t: 'exercise', prompt: `Your 2025 decoder firmware has grown. The linker reports the image's flash usage as 232 000 bytes. Using only the layout in this lesson: (a) does it fit in the team FLASH region, and by how many bytes does it fit or overflow? (b) How many whole 8 KB pages does the team region contain? Enter the answer to (b).`,
      hints: [
        `The team FLASH region has length 0x38000. Convert it to decimal.`,
        `0x38000 = 3 × 65536 + 8 × 4096 = 196 608 + 32 768.`,
        `Divide the region length by the page size 0x2000 (8192). Then compare 232 000 with the region length.`,
      ],
      solution: `(a) \`0x38000\` = 229 376 bytes. 232 000 − 229 376 = 2 624 bytes too large: it does **not** fit. The linker should refuse to place it; if it does not, the flasher — which writes exactly 28 pages — cannot transfer the tail.

(b) 229 376 / 8 192 = **28** pages, matching \`APP_PAGES = 28\` in the 2025 flasher.

Transfer: the RESERVED region above the team region is the same length, but its name tells you it is not yours. Before "fixing" an overflow by enlarging the FLASH region in the linker script, find out from the rules who owns the memory you would be taking.`,
      answer: { type: 'number', value: 28, tol: 0, unit: 'pages' } },

    `## Harder application

In 2024, an Application Processor and two Components were three separate MAX78000 boards on one I2C bus, each with its own DAPLink adapter and its own copy of the bootloader. Draw the system and mark every place a secret could exist (AP flash, each Component's flash, the host's deployment files, RAM at run time) and every wire an attacker with the hardware could reach (I2C, three UARTs, three debug ports). Then do the same for the 2025 single-decoder system. Which system has more trust boundaries, and which of them are created by the *hardware* rather than by the specification? Keep the drawing — the scenarios later in this track use the same technique.`,

    { t: 'refs', items: [
      { title: 'Analog Devices MSDK (repository)', url: S.msdk },
      { title: 'MSDK: MAX78000 device header (cores, memory, peripherals)', url: S.maxHdr },
      { title: 'MaximAI_Documentation: MAX78000 Feather README (PICO debug adapter, DAPLINK)', url: S.maxFthr },
      { title: 'MITRE eCTF 2024 insecure example', url: S.y2024 },
      { title: 'MITRE eCTF 2025 insecure example', url: S.y2025 },
      { title: 'MITRE eCTF 2024 breakout board design files', url: S.y2024breakout },
      { title: 'eCTF 2025 rules: MAX78000FTHR board', url: S.r25board },
      { title: 'eCTF 2025 rules: eCTF bootloader (update mode, insecure and secure builds)', url: S.r25boot },
      { title: 'eCTF 2025 rules: OpenOCD', url: S.r25openocd },
      { title: 'eCTF 2025 rules: security requirements', url: S.r25sec },
      { title: 'eCTF 2024 rules: security requirements', url: S.r24sec },
      { title: 'MSDK User Guide (rendered)', url: N.msdkGuideSite, note: 'URL taken from the MSDK README; not load-tested.' },
    ] },
  ],
  quiz: [
    { kind: 'arch', q: `An MSDK example built with the stock \`max78000.ld\` runs when programmed directly with the debug adapter on a bare board, but not when sent through the eCTF 2025 bootloader. What is the most likely cause?`,
      choices: [
        { t: 'It is linked for 0x10000000, but team images must be linked at 0x1000E000', ok: true, why: 'The stock script uses flash from its base; the competition layout reserves the first 0xE000 bytes for the bootloader, so the image’s absolute addresses are wrong.' },
        { t: 'The example uses the FPU, which the bootloader leaves disabled when it starts an image', why: 'Nothing in the sources says the bootloader changes FPU state; look at what differs between the two linker scripts.' },
        { t: 'Images built inside Docker are big-endian, while the bare board expects little-endian', why: 'Byte order is a property of the target and toolchain configuration, not of building in a container.' },
        { t: 'The SRAM base address differs between the stock script and the eCTF script', why: 'Both linker scripts place SRAM at 0x20000000 with the same length; the difference is in flash.' },
      ] },
    { kind: 'concept', q: `The MAX78000FTHR enumerates on USB as a DAPLINK drive. Which statement is correct?`,
      choices: [
        { t: 'The drive is presented by the on-board MAX32625PICO debug adapter', ok: true, why: 'The adapter is a separate microcontroller from the MAX78000; the mass-storage drive, debug connection and serial bridge are all its functions.' },
        { t: 'The drive is the MAX78000’s internal flash, exposed to the host as a small filesystem', why: 'The target’s flash is not a filesystem; files dropped on the drive are interpreted by the adapter, which then programs the target.' },
        { t: 'The drive is provided by the MITRE bootloader once it has been installed', why: 'The bootloader communicates over serial; the drive exists even on a blank target because the adapter provides it.' },
        { t: 'The drive appears only in MAINTENANCE mode, when SW5 is held', why: 'MAINTENANCE mode is the adapter’s own firmware-update mode; normal operation shows DAPLINK.' },
      ] },
    { kind: 'security', q: `A teammate proposes storing a long-term key in the last page of the team FLASH region "because nobody will look there". Which objection is grounded in what this lesson established?`,
      choices: [
        { t: 'It is ordinary internal flash; an obscure location adds no protection', ok: true, why: 'What matters is whether flash can be read via debug, bootloader or software, and that must be established from the user guide and the rules — not where in the region the bytes sit.' },
        { t: 'The last page of the team region is erased by the bootloader on every boot, so the key would be lost', why: 'Nothing in the sources says any team page is erased at boot; do not invent behaviour for the bootloader.' },
        { t: 'Keys must be stored in the RISC-V core’s private memory, which the Arm core cannot read', why: 'The sources describe no private key storage belonging to the second core.' },
        { t: 'The AES key registers make it impossible to keep key bytes anywhere in flash', why: 'The key registers are a peripheral you may use; they do not prevent data being written to flash.' },
      ] },
    { kind: 'concept', q: `Which change between the 2024 and 2025 reference designs would most affect a team’s *threat model*, as opposed to its build scripts?`,
      choices: [
        { t: 'Three boards on a shared I2C bus became one board on a UART to the host', ok: true, why: 'The set of devices, the buses between them and who can sit on those buses defines the trust boundaries; that changed completely.' },
        { t: 'The Nix shell and Poetry environment were replaced by Docker and a plain pip install', why: 'That changes how the build is reproduced, not which parties and channels exist in the deployed system.' },
        { t: 'The pinned MSDK release moved from tag v2023_06 to tag v2024_02', why: 'An SDK update can fix or introduce bugs, but it does not redefine the system’s assets and adversaries.' },
        { t: 'Host tools were renamed from `ectf_*` console scripts to `python -m ectf25.*` modules', why: 'Invocation syntax is an interface detail for the developer, not a change in what an attacker can reach.' },
      ] },
    { kind: 'arch', q: `Your 2025 practice design uses AES-192 through the MAX78000’s hardware engine. You are now planning the same design for the MSPM0L2228. What do the sources tell you?`,
      choices: [
        { t: 'It does not carry over: the MAX78000 driver offers 128/192/256, TI’s AESADV 128/256', ok: true, why: 'Two blocks both called "AES" differ in supported key sizes. The MSDK header and the TI datasheet each state their own list, and 192 appears in only one.' },
        { t: 'It carries over unchanged, because every hardware AES engine implements all three standard key sizes', why: 'The AES standard defines three key sizes; a given hardware block need not implement all of them. Read each vendor’s list.' },
        { t: 'Neither chip supports AES-192, since low-power microcontrollers only implement the 128-bit variant', why: 'Power class does not determine key size; that is a guess, and the MSDK driver header lists 192.' },
        { t: 'It cannot be decided, because neither vendor documents key sizes outside the datasheet', why: 'The MAX78000 key sizes are in the public MSDK driver header, and the TI ones are in its datasheet.' },
      ] },
    { kind: 'code', q: `The 2025 flasher uses \`PAGE_SIZE = 8192\` and \`APP_PAGES = 28\`; the linker gives the team region length \`0x38000\`. A teammate edits the linker script to make the team region \`0x3A000\` long to fit a larger image. What happens?`,
      choices: [
        { t: 'The link succeeds, but the flasher still transfers only 28 pages', ok: true, why: 'The last 0x2000 bytes are never written, and that page belongs to another region. A linker script describes where you intend code to go; it grants no ownership.' },
        { t: 'The flasher adapts automatically, because it reads the region size from the ELF file', why: 'The flasher works from fixed constants and a binary file; it does not derive the region size from your link.' },
        { t: 'The linker rejects the script, because a region length must be a power of two', why: 'Region lengths need not be powers of two; the existing length 0x38000 is not one either.' },
        { t: 'The extra page is taken from the top of SRAM, reducing the space left for the stack', why: 'Flash and SRAM are separate address ranges; enlarging a flash region cannot consume RAM.' },
      ] },
    { kind: 'concept', q: `During the 2025 attack phase a teammate cannot attach GDB to an attack board with the command that worked all through the design phase. The wiring and the OpenOCD version are unchanged. What is the most likely reason?`,
      choices: [
        { t: 'Attack boards carry the secure bootloader, which disables debug', ok: true, why: 'The rules state that the preinstalled secure bootloader disables debug functionality. The design-phase boards ran the unprotected build, which leaves the debug port open.' },
        { t: 'The DAPLink adapter was put into MAINTENANCE mode when the board was shipped to the team', why: 'MAINTENANCE mode is entered by holding SW5 while plugging in, and it changes the drive name; it is not a property a board ships with.' },
        { t: 'GDB can only attach while the board is in update mode with the blue LED blinking', why: 'Update mode concerns the serial bootloader protocol; on design boards the debug port works in either mode.' },
        { t: 'The RISC-V core has taken over the debug port, which it shares with the Arm core', why: 'The second core is debugged over a separate JTAG port and does not start unless the Arm core starts it.' },
      ] },
  ],
};

export default [history, esp32, max78000];
