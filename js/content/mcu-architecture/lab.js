// Microcontroller architecture: guided laboratory.
const R = String.raw;

export default [
  {
    id: 'mcu-lab-map-chip',
    title: 'Map an unfamiliar microcontroller',
    kind: 'Guided laboratory',
    minutes: 150,
    summary: 'Given only documentation, produce a one-page architecture summary of a chip: cores, memory map, clocks, boot path, debug interface and vector table location. Do it three times with help, then once alone.',
    skills: ['mcu-sk-map-chip', 'mcu-sk-register', 'mcu-sk-boot', 'mcu-sk-linker', 'mcu-sk-classify'],
    objectives: [
      'Extract the six facts that define a microcontroller\'s architecture from vendor documentation and SDK sources.',
      'Fill in a one-page architecture summary for the ESP32, the MAX78000 and the MSPM0L2228.',
      'Locate each fact in a primary document you download yourself, and record the document, section and page.',
      'Separate what you have verified from what you have assumed.',
      'Repeat the procedure unaided on a chip you have never used.',
    ],
    hardware: [
      'None. This lab is a documentation exercise. If you own one of the three boards, keep it nearby to compare silkscreen and part markings with what you read, but nothing here requires powering it.',
    ],
    software: [
      'This app: the block-diagram, memory-map and boot-sequence tools, and the notebook.',
      'A PDF reader with text search.',
      'A web browser to download the documents listed in step 1.',
      'Optional: git, to clone the vendor SDKs and search their headers with grep.',
    ],
    background: [
      `Every new project starts the same way: someone hands you a part number. Before you write a line of code you
need a picture of the machine. Experienced engineers build that picture in an hour or two by going to the same few
places in the documentation every time. This lab makes that routine explicit.

The six questions:

1. **Cores**: which architecture and profile, how many, FPU/MPU, maximum clock?
2. **Memory map**: where are ROM, flash, SRAM, peripherals and configuration memory, and how big?
3. **Clock sources**: which oscillators exist, which is the default after reset, what feeds the peripherals?
4. **Boot path**: what runs first, what decides the boot mode, where does the first user-controlled code sit?
5. **Debug interface**: SWD, JTAG, USB? Which pins? Can it be locked, and how?
6. **Vector table**: where does the CPU find its exception handlers at reset, and can the table be moved?`,
      { t: 'callout', kind: 'note', title: 'Where the facts in this lab come from',
        md: 'The pre-filled values below were taken from vendor SDK sources on GitHub (device headers, linker scripts, documentation sources). Datasheets and reference manuals could not be opened when this course was written, so anything that normally lives only in those documents is marked **look up**. Finding those is your job in steps 5 and 6, and it is the part of the lab that matters most.' },
      `### Which document answers which question

| Document | What it is for | Answers |
|---|---|---|
| **Datasheet** | Electrical limits, pinout, package, feature list, memory sizes | 1, 2 (sizes), 3 (accuracy), 5 (pins) |
| **Reference manual / TRM / user guide** | How every peripheral and system block works, register by register | 2, 3, 4, 5, 6 |
| **Architecture manual** (Arm, RISC-V) | The CPU itself: registers, exceptions, instruction set | 1, 6 |
| **SDK device header** | Base addresses, interrupt numbers, core options, as code | 1, 2, 6 |
| **SDK linker script** | The memory regions an application may use | 2, 6 |
| **Board user guide and schematic** | What is connected to which pin; the on-board debugger | 5 |
| **Errata** | Where the silicon does not match the manual | all |`,
    ],
    diagram: [
      { t: 'ascii', caption: 'The one-page architecture summary. Copy it into the notebook once per chip.',
        text: R`  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ PART:                      BOARD:                    DATE:                   │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 1 CORES      architecture / profile:            count:                       │
  │              FPU:      MPU:      max clock:     endianness:                  │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 2 MEMORY     region        base          size        notes                   │
  │              ROM                                                             │
  │              flash                                   erase unit:             │
  │              SRAM                                                            │
  │              peripherals                                                     │
  │              config / OTP                                                    │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 3 CLOCKS     source        frequency     accuracy    default after reset?    │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 4 BOOT       reset -> ............ -> ............ -> main()                 │
  │              boot-mode selection:              first user code at:           │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 5 DEBUG      interface:        pins:           probe:        lockable by:    │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ 6 VECTORS    table at reset:           relocatable (how):                    │
  ├──────────────────────────────────────────────────────────────────────────────┤
  │ SOURCES      for every line: document, section, page - or "ASSUMED"          │
  └──────────────────────────────────────────────────────────────────────────────┘` },
      { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'generic' }, caption: 'The generic picture every chip is a variation of. Keep it in mind as the template you are filling in.' },
    ],
    steps: [
      { title: 'Collect the documents',
        md: `For each of the three platforms, download and save locally:

- **ESP32**: the ESP32 datasheet, the ESP32 Technical Reference Manual, and the datasheet of the module you would use (for example an ESP32-WROOM-32E). They are on Espressif's documentation site.
- **MAX78000**: the MAX78000 datasheet and the MAX78000 user guide from Analog Devices, and the MAX78000FTHR board data sheet with schematic.
- **MSPM0L2228**: the MSPM0L222x datasheet (SLASF94), the MSPM0 L-series technical reference manual (SLAU847), and the LP-MSPM0L2228 LaunchPad user's guide from TI. The 2026 eCTF board is a different, custom board (MSP-LITO-L2228, not sold); the 2026 rules link a user manual for the near-identical MSP-LITO-G3507, which this course has not read.
- **Architecture**: the Cortex-M4 and Cortex-M0+ Devices Generic User Guides from Arm.

Record each document's title, revision and date in the notebook. Documents are revised; a page number without a revision is not a citation.

Then open, in a browser or a local clone, the SDK sources listed in this section's references: the MSDK device header and linker script, the MSPM0 device header and linker command file, and ESP-IDF's \`soc.h\` for the ESP32.` },

      { title: 'Summarise the MSPM0L2228 (guided)',
        md: `Start with the simplest of the three: one core, internal flash, flash at address zero.

| Item | Value | Source |
|---|---|---|
| Core | Arm Cortex-M0+ (ARMv6-M), 1 core, no FPU, MPU present, VTOR present, 2 priority bits | SDK device header |
| Max clock | 32 MHz ("frequency up to 32MHz"). The 2026 eCTF reference design configures 32 MHz; that the configured value is also the limit is something only the datasheet can tell you | datasheet SLASF94A, Features, p.1 |
| Supply | 1.62 V to 3.6 V | datasheet SLASF94A, Features, p.1 |
| Flash | base \`0x0000_0000\`, 256 KB, in two 128 KB banks (bank 1 from \`0x0002_0000\`) with address swap; no data-flash region is listed for this part | SDK linker command file; datasheet SLASF94A, Table 8-4 |
| SRAM | 32 KB, one memory visible at three addresses: \`0x2000_0000\` (ECC-checked), \`0x2010_0000\` (parity-checked), \`0x2020_0000\` (unchecked). The SDK linker command file and the eCTF reference design use \`0x2020_0000\` | datasheet SLASF94A, Table 8-4; SDK linker command file |
| Config memory | NONMAIN: \`BCR_CONFIG\` at \`0x41C0_0000\`, \`BSL_CONFIG\` at \`0x41C0_0100\` | SDK linker command file |
| Flash erase unit | 1 KB sectors (the eCTF reference code uses the same 1 KB page constant). Endurance differs between the lower 32 KB and the rest: **look up** both figures | datasheet SLASF94A, section 8.10 |
| Clock sources | **look up**: internal oscillators, low-frequency source, crystal options, default after reset | TRM, clock chapter |
| Boot path | reset → boot configuration routine (BCR) in ROM reads NONMAIN (debug policy, static write protection, optional 32-bit CRC check of the application, optional start of the bootstrap loader, which uses UART or I2C and requires a 256-bit password) → application at start of main flash | TRM SLAU847F, sections 1.4.2 and 1.4.3; SDK \`boot_config.h\` lists the options |
| Debug | SWD; XDS110 probe (on board on the LP-MSPM0L2228 LaunchPad; external, on eight jumper wires, for the 2026 eCTF MSP-LITO-L2228 board). NONMAIN selects one of three SWD security levels: no restrictions, custom (debug, mass erase and factory reset each enabled, password-protected or disabled), or SWD fully disabled | TRM SLAU847F, section 1.4.2.1; 2026 eCTF rules; pins from the datasheet |
| Vector table | start of main flash (\`0x0000_0000\`) at reset; relocatable through VTOR | device header, Cortex-M0+ guide |

Fill the summary sheet. For each **look up** row, find the value in the datasheet or TRM and write the section and page next to it.`,
        blocks: [
          { t: 'widget', name: 'memory-map', props: { platform: 'mspm0l2228' }, caption: 'Check your memory rows against the explorer, then use its quiz mode.' },
          { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, caption: 'Check your boot row. Which stage reads NONMAIN?' },
        ] },

      { title: 'Summarise the MAX78000 (guided)',
        md: `Two cores of different architectures, and ROM at address zero.

| Item | Value | Source |
|---|---|---|
| Cores | Arm Cortex-M4 with FPU and MPU (ARMv7E-M); plus one RISC-V core that the Arm core must start | MSDK device header and user guide |
| RISC-V variant, max clocks | **look up** | MAX78000 user guide / datasheet |
| ROM | base \`0x0000_0000\` | MSDK linker script |
| Flash | base \`0x1000_0000\`, 512 KB, 8 KB pages | MSDK device header and linker script |
| SRAM | base \`0x2000_0000\`, 128 KB | same |
| Peripherals | from \`0x4000_0000\` (for example AES at \`0x4000_7400\`, TRNG at \`0x4004_D000\`) | device header |
| Clock sources | IPO 100 MHz, ISO 60 MHz, IBRO 7.3728 MHz, ERTCO 32.768 kHz, INRO about 30 kHz (nominal). Default after reset and accuracy: **look up** | \`system_max78000.h\`; user guide |
| Boot path | reset → ROM → image at start of flash. ROM bootloader features: **look up** | user guide |
| Debug | SWD for the Arm core through the on-board MAX32625PICO (DAPLink); the RISC-V core has a separate JTAG port. Pins and lock options: **look up** | board documentation; user guide |
| Vector table | at the start of the application image in flash (\`0x1000_0000\` for a stand-alone build), relocatable through VTOR | linker script; Cortex-M4 guide |

Add one line for the eCTF 2024/2025 layout: bootloader at \`0x1000_0000\` (length \`0xE000\`), team firmware and its vector table at \`0x1000_E000\`.`,
        blocks: [
          { t: 'widget', name: 'memory-map', props: { platform: 'max78000' } },
          { t: 'widget', name: 'boot-sequence', props: { platform: 'max78000' } },
        ] },

      { title: 'Summarise the ESP32 (guided)',
        md: `The odd one out: not a Cortex-M, no internal program flash, and a cache between the CPU and its code.

| Item | Value | Source |
|---|---|---|
| Cores | Xtensa LX6, 2 cores, up to 240 MHz (the ESP32-S3 uses Xtensa LX7) | ESP32 Series Datasheet v5.3, Product Overview; ESP-IDF Kconfig / SoC capability files |
| Mask ROM | \`0x4000_0000\`–\`0x4007_0000\` | ESP-IDF \`soc.h\` |
| Flash | external SPI flash on the module; size depends on the module (an ESP32-WROOM-32E is offered with 4, 8 or 16 MB: module datasheet v2.1, section 1 and Table 1; **look up** the ordering code of yours). Mapped through the cache: read-only data at \`0x3F40_0000\`, code at \`0x400D_0000\` | \`soc.h\` |
| RAM | data RAM \`0x3FFA_E000\`–\`0x4000_0000\`; instruction RAM \`0x4008_0000\`–\`0x400A_A000\`; RTC memories at \`0x3FF8_0000\`, \`0x400C_0000\`, \`0x5000_0000\` | \`soc.h\` |
| Config / OTP | eFuses (keys, security configuration) | ESP-IDF security docs; TRM eFuse chapter |
| Clock sources | **look up**: main crystal, PLL, internal oscillators, 32 kHz options | TRM, reset and clock chapter |
| Boot path | reset → ROM samples strapping pins (GPIO0, 2, 5, 12, 15) → second-stage bootloader at flash offset \`0x1000\` → partition table at \`0x8000\` → application (factory default \`0x10000\`) | ESP-IDF docs and ROM capability files |
| Debug | JTAG on GPIO12–15; serial download through the ROM on UART0. The original ESP32 has no built-in USB (the S3, C3 and C6 have a USB Serial/JTAG controller). Disabling: eFuses (**look up** which) | ESP-IDF GPIO and security docs |
| Vector table | Xtensa uses a set of fixed-offset exception vectors placed in instruction RAM by ESP-IDF, at an address held in a CPU register (VECBASE): **look up** the details in the Xtensa and TRM documentation. It is not a Cortex-M style table | TRM; ESP-IDF sources |

Notice how much of this sheet says "depends on the module" or "look up". That is normal for a chip whose minimum system spans several components.`,
        blocks: [
          { t: 'widget', name: 'mcu-block-diagram', props: { platform: 'esp32' } },
          { t: 'widget', name: 'memory-map', props: { platform: 'esp32' } },
          { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' } },
        ] },

      { title: 'Verify three facts per chip in a primary document',
        md: `For each chip choose three rows you copied from the tables above and confirm them in the datasheet or reference manual you downloaded. Suggested:

- the flash and SRAM base addresses (look for a "memory map" figure or table);
- the list of clock sources and which one is selected after reset;
- the debug pins.

For each, write: document title and revision, section number, page, and the exact value found. If the document disagrees with the table in this lab, the document wins: record the discrepancy. If two vendor documents disagree with each other, check the errata and note both.

Useful search terms in a PDF: "memory map", "boot", "reset", "strapping", "clock tree", "SWD", "JTAG", "vector".` },

      { title: 'Find one peripheral register from scratch',
        md: `On each chip, find the register that drives a GPIO pin high *atomically* (a set or write-1-to-set register). Record:

1. the peripheral's base address (reference manual memory map, or the device header);
2. the register's name and offset;
3. its access type;
4. what must be enabled first (clock gate, power enable, pin function).

Starting points: ESP32 TRM, "IO MUX and GPIO Matrix" chapter, register summary (cross-check against ESP-IDF's \`components/soc/esp32/register/soc/gpio_reg.h\` and \`reg_base.h\`, which give the same base and offsets as C macros); MSDK \`gpio_regs.h\` for the MAX78000; MSPM0 TRM GPIO chapter or the SDK's GPIO header. Then write the one-line C macro for it in the style of the registers lesson. Mark the code as unverified: you have not run it.`,
        code: R`/* Template: fill in from the reference manual. Not compiled, not run. */
#define GPIOx_BASE      0x________u
#define GPIOx_OUT_SET   (*(volatile uint32_t *)(GPIOx_BASE + 0x__u))

/* prerequisites, in order: 1) ............  2) ............  3) ............ */`,
        lang: 'c', status: 'pseudo' },

      { title: 'Do it alone on a chip you have never used',
        md: `Pick a microcontroller from a different vendor: for example an STM32, an nRF52, an RP2040 or an AVR. Download its datasheet and reference manual. Set a timer for 60 minutes and fill in a blank summary sheet, with a source for every line. Write "ASSUMED" where you guessed, and "NOT FOUND" where you ran out of time.

Afterwards, note which of the six questions took longest. That is the one to practise.` },
    ],
    walkthrough: [
      `### Why these six facts, in hardware terms

- **Cores** fix the instruction set your compiler must target, what the exception frame looks like, whether floating
  point is done in hardware, and how many interrupt priority levels you have to share out.
- **The memory map** is the linker script. Every address in your image is derived from it. One wrong region (a 128 KB RAM
  length copied from another chip onto an MSPM0L2228, which has 32 KB) and the first stack push faults. The map also
  holds surprises that only the document shows: that chip's one 32 KB RAM appears at \`0x2000_0000\`, \`0x2010_0000\` and
  \`0x2020_0000\` with different error checking, and the linker script chooses which view the program uses.
- **Clock sources** determine every time-dependent number: baud divisors, timer periods, ADC sample times, flash
  timing. The default after reset tells you what the chip is doing before your clock setup runs.
- **The boot path** tells you which code runs before yours, what it trusts, and where your image must be placed for
  that code to find it. It is also the list of places an attacker can try to get in before your checks run.
- **The debug interface** is how you will load and inspect code, and it is the first thing to lock on a product.
- **The vector table location** is where the CPU will look for the reset handler and every interrupt handler. If
  your table is not where the core looks, nothing in your image runs, however correct it is.`,
      { t: 'callout', kind: 'why', title: 'Why record sources so strictly',
        md: 'Half of the hard bugs in board bring-up come from a "fact" someone remembered from a different chip in the same family, an older document revision, or a forum post. A summary sheet with a source on every line can be checked by someone else in ten minutes. One without sources has to be redone.' },
      { t: 'callout', kind: 'security', title: 'The same sheet is the first page of a threat model',
        md: 'Boot path, debug interface, configuration memory and the memory map are exactly the entry points and assets an attacker studies first. When you reach the security section you will extend this sheet with: which boot stages are verified, which keys live where, and what state the debug port is in on a shipped unit.' },
    ],
    testing: [
      `You cannot "run" a document, so test the summary by using it.

1. **Address quiz.** Use the memory-map tool's quiz for each platform. With your sheet in front of you, you should
   be able to place every address without opening the explorer view.
2. **Cross-check with a build artefact.** Open the linker scripts named in the references. Every \`ORIGIN\` and
   \`LENGTH\` should match a row of your memory table. If you have a toolchain installed, build any SDK example and
   read its map file: the vector table's address should be the one on your sheet.
3. **Peer check.** Give a colleague only your sheet and ask three questions: "Where would firmware linked for this
   chip place its stack?", "Which document says which pins are the debug port?", "What runs before \`main\`?" They
   should be able to answer from the sheet alone.
4. **Count the unknowns.** A finished sheet has no blank cells: each is a value with a source, or an explicit
   "ASSUMED" / "NOT FOUND".

If you have the hardware and a debug probe, you can later confirm some rows directly: after connecting, you should
see the stack pointer inside the SRAM range on your sheet and the program counter inside the flash range. Nothing
in this lab was checked on physical hardware by the course authors.`,
    ],
    troubleshooting: [
      { symptom: 'The datasheet has no memory map', cause: 'For many vendors the datasheet covers electrical and package data only; the address map is in the reference manual or user guide.', fix: 'Search the reference manual for "memory map" or "address space". As a cross-check, read the SDK linker script and device header.' },
      { symptom: 'Two documents give different flash sizes', cause: 'One describes the family (maximum size) and the other a specific part number; or one is an older revision.', fix: 'Decode the exact part number using the ordering-information table in the datasheet, and use the newest revisions of both documents.' },
      { symptom: 'You cannot find where the vector table is', cause: 'It is defined by the CPU architecture, not the chip vendor, so the vendor manual may only mention it in passing.', fix: 'Read the exception model chapter of the architecture\'s generic user guide, then look at the first section placed in flash by the SDK linker script and at the startup file.' },
      { symptom: 'The SDK header shows peripherals the datasheet does not list', cause: 'Headers often cover a whole family; smaller family members lack some instances.', fix: 'Trust the datasheet for the specific part number. Treat header-only peripherals as absent until confirmed.' },
      { symptom: 'Clock chapter is overwhelming', cause: 'Clock trees are drawn with every option at once.', fix: 'Trace only two paths at first: reset default to CPU, and reset default to one UART. Add the others when you need them.' },
      { symptom: 'The boot description mentions modes you cannot find pins for', cause: 'Boot mode may be selected by configuration memory or eFuses rather than pins, or the pins are named differently on the module.', fix: 'Search for "strapping", "boot configuration" and "BSL"; then check the module or board schematic for the pin names.' },
    ],
    challenge: [
      `**Compare and decide.** A product needs: an authenticated firmware update, a debug port that can be permanently
closed, storage for a 256-bit device key that software cannot read back out after boot, and wake from sleep on a UART
byte. Using only your three summary sheets and the primary documents, write one page that says, for each of the three
platforms, which requirements the *architecture* supports directly, which need extra work, and which facts you would
still have to verify on hardware before committing. Cite a document and section for every claim. No model answer is
provided; a good answer is one a sceptical reviewer cannot poke holes in.`,
    ],
    quiz: [
      { q: 'You need the base address of SRAM for a linker script. Which source is the most direct and least likely to be out of date for your exact part?', kind: 'arch', choices: [
        { t: 'The reference manual\'s memory map, cross-checked with the vendor linker script', ok: true, why: 'Two independent primary sources that agree are as good as documentation gets.' },
        { t: 'A linker script from another chip in the same family, which shares the map', why: 'Bases and sizes vary within families, and a script also encodes choices the map alone does not force: TI\'s MSPM0L2228 file links RAM at 0x2020_0000, one of three views of the same 32 KB. A copied script carries another part\'s sizes and another author\'s choices.' },
        { t: 'The feature list on the first page of the datasheet', why: 'It gives sizes, not addresses.' },
      ] },
      { q: 'An SDK example configures the CPU clock to 32 MHz. What can you conclude about the chip\'s maximum CPU frequency?', kind: 'concept', choices: [
        { t: 'Only that 32 MHz is a supported setting', ok: true, why: 'A configuration in example code is a choice, not a limit. For the MSPM0L2228 the datasheet does give 32 MHz as the maximum, but you learn that from the datasheet\'s first page, not from the example.' },
        { t: 'That 32 MHz is the maximum, since examples run the chip at full speed', why: 'Examples often run below the maximum to save power or to avoid needing a crystal. An example cannot tell you which case you are looking at.' },
        { t: 'That the chip has no PLL', why: 'The clock source used by one example says nothing about which sources exist.' },
      ] },
      { q: 'On which of the three course platforms is address `0x0000_0000` the start of the user\'s program flash?', kind: 'arch', choices: [
        { t: 'The MSPM0L2228', ok: true, why: 'Its main flash originates at zero, so the vector table of the image at the start of flash is at address zero.' },
        { t: 'The MAX78000', why: 'On that chip address zero is ROM; flash begins higher up.' },
        { t: 'The original ESP32', why: 'Its program flash is an external device seen through cache windows at high addresses.' },
      ] },
      { q: 'Why does the summary sheet ask "can the debug interface be locked, and how"?', kind: 'security', choices: [
        { t: 'An open debug port gives full memory access, bypassing software protections', ok: true, why: 'Debug access bypasses every software protection; knowing how it is disabled, and whether that is reversible, is essential.' },
        { t: 'A locked debug port lets firmware run faster, because debug logic stops stealing cycles', why: 'Debug logic has no effect on execution speed when not in use.' },
        { t: 'The linker script depends on the debug access policy', why: 'Linking depends on the memory map, not on debug access policy.' },
      ] },
      { q: 'Your sheet says "flash erase unit: 4 KB (ASSUMED)". What is the right next action before writing a storage driver?', kind: 'concept', choices: [
        { t: 'Find the value in the reference manual or flash datasheet and cite it', ok: true, why: 'Erase granularity shapes the whole storage design; an assumption here becomes data loss later.' },
        { t: 'Proceed: 4 KB is the standard erase unit for all flash memories', why: 'Erase units in this course alone range from 1 KB to 8 KB.' },
        { t: 'Measure it by erasing and seeing how much changes', why: 'An experiment can confirm documentation, but designing from an undocumented observation risks missing conditions the manual would state.' },
      ] },
    ],
    rubric: [
      { criterion: 'Three summary sheets complete, no blank cells', points: 30, evidence: 'Notebook pages for ESP32, MAX78000 and MSPM0L2228' },
      { criterion: 'Primary-source citations', points: 25, evidence: 'Document, revision, section and page for at least three facts per chip, found by the learner' },
      { criterion: 'Atomic GPIO set register located on each chip', points: 15, evidence: 'Base, offset, access type and prerequisites, with source' },
      { criterion: 'Unaided summary of a fourth chip within 60 minutes', points: 20, evidence: 'Completed sheet with ASSUMED / NOT FOUND clearly marked' },
      { criterion: 'Honest separation of verified and assumed facts', points: 10, evidence: 'No uncited value presented as fact' },
    ],
  },
];
