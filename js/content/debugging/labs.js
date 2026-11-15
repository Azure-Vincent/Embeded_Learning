// Debugging labs. Nothing here was run on physical hardware; board steps say what you should see and how to check.

const labs = [
  // ------------------------------------------------------------------ Lab A
  {
    id: 'dbg-lab-first-session', title: 'Lab A: a first OpenOCD and GDB session on your own board', kind: 'Guided lab', minutes: 120,
    summary: 'Rehearse the commands on a simulated target and on a host program, then halt, inspect, break and watch on a board you own.',
    skills: ['dbg-openocd-run', 'dbg-gdb-drive', 'dbg-fault-decode', 'dbg-probe-choose'],
    objectives: [
      'Start OpenOCD with the correct configuration for your board and read its log',
      'Connect GDB, reset and halt the target, and confirm the ELF matches the flash',
      'Set a breakpoint and a watchpoint, step, and inspect locals, registers, memory and one peripheral register',
      'Read the vector table of your own firmware from the target and explain each of the first two words',
      'Provoke a fault deliberately and trace it to a source line',
    ],
    hardware: [
      'One development board you own with a debug connection: an ESP32-S3 or ESP32-C3 board with its USB Serial/JTAG port, a MAX78000FTHR (on-board DAPLink), an MSPM0L2228 board with its debug probe, or another Cortex-M board with an on-board probe',
      'A data-capable USB cable',
      'Optional: a USB-to-UART adapter if the board\'s console is not on the debug USB port',
      'No board? Steps 1–3 need none, and steps 4–9 can be followed in the simulated session',
    ],
    software: [
      'This app\'s debug-session tool (steps 1 and 2)',
      'gcc and gdb on a Linux host (step 3)',
      'The vendor SDK for your board: ESP-IDF, the Analog Devices MSDK, or the TI MSPM0 SDK',
      'The matching OpenOCD: Espressif\'s (installed with ESP-IDF), the MSDK\'s, or a recent upstream build for MSPM0',
      'The matching GDB: xtensa-esp32s3-elf-gdb / riscv32-esp-elf-gdb, or arm-none-eabi-gdb / gdb-multiarch',
    ],
    background: [
      `A debug session has four layers, and each can fail on its own: **USB to the probe**, **probe to the chip**, **OpenOCD's knowledge of the chip**, and **GDB's symbols matching the flash**. The lab brings them up one at a time and has you prove each before relying on it.

Rehearsal comes first because a debugger is a poor place to learn a debugger. In the simulated session nothing can be mis-wired, so every surprise is about GDB itself. On the host, \`gdb\` runs a real program with real memory. Only then do you add hardware.`,
      { t: 'callout', kind: 'sim', md: `The debug-session tool is a simulation of a Cortex-M target behind a GDB-style console, running small programs bundled with this app (compiled for the ARMv6-M instruction subset; the simulated core also has the ARMv7-M fault status registers). Its output is not a measurement from a board. It accepts the common commands (\`break\`, \`continue\`, \`next\`, \`step\`, \`finish\`, \`info registers\`, \`x/\`, \`bt\`, \`watch\`, \`print\`), not all of GDB.` },
    ],
    diagram: [
      { t: 'ascii', text: `  Terminal 1                 Terminal 2
  ----------                 ----------
  openocd -f <board cfg>     <prefix>-gdb build/app.elf
      |  listens on :3333        |  target extended-remote :3333
      |  listens on :4444        |
      +----------- TCP ----------+
      |
     USB
      |
  [ probe: on-board DAPLink / XDS110 / built-in USB Serial/JTAG ]
      |  SWD or JTAG, GND, (reset)
  [ target MCU ]----UART or USB CDC----> serial monitor (Terminal 3)`, caption: 'Three terminals: OpenOCD, GDB, and the serial console. Keep all three visible.' },
      `| Board | Debug connection | OpenOCD start (see the OpenOCD lesson for details) |
|---|---|---|
| ESP32-S3 / ESP32-C3 | USB cable to the chip's own USB pins | \`idf.py openocd\` |
| Original ESP32 | External JTAG probe on GPIO12–15 | \`idf.py openocd --openocd-commands "-f <your board or interface+target files>"\` |
| MAX78000FTHR | On-board MAX32625PICO (DAPLink) | MSDK OpenOCD with \`interface/cmsis-dap.cfg\` and \`target/max78000.cfg\` |
| MSPM0L2228 board with XDS110 | On-board or external XDS110 | Upstream OpenOCD with \`board/ti/mspm0-launchpad.cfg\` |`,
    ],
    steps: [
      { title: 'Rehearse the tour', md: `Open the simulated session. Its flash starts erased at \`0x0800_0000\`. Before typing anything, write down what you expect \`pc\` and \`msp\` to be after \`monitor reset halt\` on an erased chip, and what they will be once a program is loaded and the chip is reset again. Then follow the tool's ten steps (connect, reset, load, reset again, \`break checksum\`, \`continue\`, \`bt\`, \`info args\`, \`x/6xb data\`, \`finish\`) and answer its three questions.\n\nThen explore on your own: \`break main\`, restart with \`monitor reset halt\` and \`continue\`, \`next\` twice, \`step\` into the call, \`info locals\`, \`x/8xw $sp\`, \`x/2xw 0x08000000\`.\n\nYou should be able to say, for the last command, which word is the initial stack pointer and which is the reset vector, and why the second is odd.`,
        blocks: [ { t: 'widget', name: 'debug-session', props: { scenario: 'tour' } } ] },
      { title: 'Rehearse a hang and a fault', md: `Run the \`stuck-loop\` scenario: let it run, interrupt it, and find what the loop is waiting for. Then run \`hardfault\`: when the target lands in its fault handler, dump eight words from the stack and pick out the stacked PC and LR. The stacked PC will not be a code address, so find the source line from the stacked LR (step 7 of the procedure in the post-mortem lesson), then read CFSR.\n\nThe simulated core provides the ARMv7-M fault status registers so that you can practise reading them. On a real Cortex-M0+ such as the MSPM0L2228 they do not exist: do the first four questions again in your head without CFSR and notice that the frame alone was enough to find the line.`,
        blocks: [ { t: 'widget', name: 'debug-session', props: { scenario: 'stuck-loop' } }, { t: 'widget', name: 'debug-session', props: { scenario: 'hardfault' } } ] },
      { title: 'Rehearse on the host with real GDB', md: `Build and debug \`examples/debugging/gdb_practice.c\`. Find the bug with a watchpoint, as in the GDB lesson, but this time predict the new value of \`state.armed\` before you \`continue\`.`,
        lang: 'sh', status: 'host-tested', code: String.raw`cd examples/debugging
gcc -Wall -Wextra -std=c11 -g -O0 -fno-stack-protector -o gdb_practice gdb_practice.c
./gdb_practice                 # name=pressure armed=0x0000412d samples=6
gdb -q ./gdb_practice
# (gdb) break set_name
# (gdb) run
# (gdb) print *s
# (gdb) watch state.armed
# (gdb) continue
# (gdb) bt
# (gdb) x/16xb &state` },
      { title: 'Build a known firmware with debug information', md: `Build the SDK's simplest example for your board (a "hello world" or blink) **with debug symbols and low optimisation**. In ESP-IDF, set the optimisation level to "Debug (-Og)" in \`menuconfig\`. In an MSDK or MSPM0 makefile project, check that \`-g\` is present and optimisation is \`-Og\` or \`-O0\`.\n\nFlash it by the vendor's normal method and confirm on the serial console that it runs. Do not involve the debugger until the plain build-flash-run loop works: otherwise you will not know which layer is at fault.\n\nNote the path of the ELF. You should see it in the build output: \`build/<project>.elf\` for ESP-IDF, \`build/<project>.elf\` or \`.out\` for the others.`,
        blocks: [ { t: 'widget', name: 'uart-terminal', props: { baud: 115200 }, caption: 'A reminder of what a correct and an incorrect baud setting look like before you open the real console.' } ] },
      { title: 'Start OpenOCD and read its log', md: `Start OpenOCD for your board in its own terminal and leave it running. Read the log from the top. You should see, in order: the probe being found, a clock speed, the debug port or TAP being detected with an ID, the core being examined (with its breakpoint and watchpoint counts on Arm targets), and "Listening on port 3333 for gdb connections".\n\nRecord the ID value and the number of hardware breakpoints. If the log stops with an error, classify it using the table in the OpenOCD lesson **before** changing anything: probe, wiring, or build.`,
        lang: 'sh', status: 'reviewed', code: String.raw`# ESP32-S3 / C3 (inside an ESP-IDF environment, in the project directory).
# With no arguments idf.py uses board/esp32s3-builtin.cfg or board/esp32c3-builtin.cfg and prints its choice.
idf.py openocd

# MAX78000FTHR (MSDK environment)
openocd -s "$MAXIM_PATH/Tools/OpenOCD/scripts" -f interface/cmsis-dap.cfg -f target/max78000.cfg

# MSPM0L2228 with XDS110 (upstream OpenOCD with the mspm0 driver)
openocd -f board/ti/mspm0-launchpad.cfg` },
      { title: 'Connect GDB and verify the image', md: `In a second terminal start the matching GDB with your ELF and connect. Reset and halt. Then check that the ELF and the flash agree.\n\nYou should see each loadable section reported as "matched" by \`compare-sections\`. If any reports "MIS-MATCHED", stop: reflash from this exact ELF.`,
        lang: 'text', status: 'reviewed', code: String.raw`$ arm-none-eabi-gdb build/hello.elf          # or: idf.py gdb   (its generated init file connects, resets, halts and runs to app_main)
(gdb) target extended-remote :3333
(gdb) monitor reset halt
(gdb) compare-sections
(gdb) info registers
(gdb) x/2xw <flash base of your part>` },
      { title: 'Break, step and look', md: `Set a temporary breakpoint on your application's entry function (\`main\`, or \`app_main\` on ESP-IDF) and continue. Then:\n\n1. \`next\` over a few lines and \`step\` into one function of your own.\n2. \`bt\` and \`info locals\` in each frame (\`up\`, \`down\`).\n3. \`p/x $sp\` and \`x/8xw $sp\`. Compare the stack pointer with the RAM range of your part.\n4. \`info breakpoints\`. Note that GDB reports hardware breakpoints for code in flash.\n5. \`disassemble /s\` for the current function, and match three instructions to their source lines.\n\nWrite down one thing that surprised you.` },
      { title: 'Drive a peripheral from the debugger', md: `Find the address of the GPIO output register for your board's LED in the vendor header or reference manual. Halted at a point after the pin has been configured as an output, read the register with \`x/1xw\`, then write it with \`set *(unsigned int *)ADDR = VALUE\` to change only the LED's bit.\n\nYou should see the LED change state while the processor is halted. That proves the pin, the LED polarity and the address independently of your driver code. Restore the original value afterwards.\n\nOn the MAX78000FTHR the RGB LED is on P2.0–P2.2 and is active low. On other boards take the pin from the board documentation.` },
      { title: 'Catch a write with a watchpoint', md: `Add a global counter to the example that is incremented somewhere in its main loop, rebuild, reflash, and reconnect. Set \`watch counter\` and \`continue\`. Each stop should show the old and new value and the line that wrote it.\n\nThen use a condition to stop only on a particular value: \`watch counter if counter == 10\`. Note how many watchpoints your core has (from the OpenOCD log) and what GDB says when you exceed that.` },
      { title: 'Cause a fault on purpose and trace it', md: `Add a function that writes through an invalid pointer when a condition is met, for example a write to an address in an unmapped region taken from your part's memory map. Build, flash, run **without** a breakpoint, and let it crash.\n\n- **Cortex-M board**: halt. You should find the PC in the fault handler. Read \`$lr\` for EXC_RETURN, dump eight words from the indicated stack pointer, and take the stacked PC and LR. On a Cortex-M4 also read CFSR at \`0xE000ED28\` and BFAR at \`0xE000ED38\`, and check your reading with \`examples/debugging/cfsr_decode.c\`. On a Cortex-M0+ there are no such registers: use the frame alone.\n- **ESP32 board**: read the Guru Meditation report on the console. Note the cause, the faulting address register and the backtrace, and confirm that \`idf.py monitor\` resolves the backtrace to your function.\n\nIn both cases finish with \`info line *<stacked PC>\` (or the decoded backtrace) and confirm it names the line you wrote.`,
        lang: 'sh', status: 'host-tested', code: String.raw`# Host helper for the Cortex-M4 case: paste CFSR and the eight stacked words (hex)
gcc -Wall -Wextra -std=c11 -o cfsr_decode examples/debugging/cfsr_decode.c
./cfsr_decode 00008200 20000100 00000004 40001000 0 0 08000431 0800026a 61000000` },
    ],
    walkthrough: [
      `**What \`monitor reset halt\` does to the chip.** OpenOCD sets a "catch reset" bit in the core's debug registers (on Cortex-M, the vector-catch bit in \`DEMCR\`), then triggers a reset. The core loads SP and PC from the vector table and halts before executing the first instruction. That is why \`info registers\` immediately afterwards shows \`sp\` equal to the first word of the vector table and \`pc\` equal to the second word with bit 0 cleared.

**What a breakpoint in flash is.** \`break main\` programs one of the core's address comparators with the address of \`main\`. When the PC matches, the core enters debug state and OpenOCD reports the halt to GDB. Nothing in flash was modified.

**What a watchpoint is.** \`watch counter\` programs a data comparator with the variable's address and "write" as the access type. The store instruction completes and then the core halts, which is why GDB reports the line that performed the write (or the one just after it).

**What the peripheral write did.** \`set *(unsigned int *)ADDR = VALUE\` became a memory-write packet to OpenOCD, which performed a bus write through the MEM-AP. The GPIO peripheral could not distinguish it from a write by your firmware. The pin changed while the CPU was not executing anything.

**What the fault did.** The invalid write caused a bus error. The core pushed R0–R3, R12, LR, PC and xPSR to the active stack, loaded EXC_RETURN into LR and fetched the HardFault vector. Everything you needed was already in those eight words before the handler's first instruction ran.`,
    ],
    testing: [
      `You have completed the lab when you can show, from your own notes:

- the OpenOCD log lines for the probe, the ID and the breakpoint count on your board;
- \`compare-sections\` output with every section matched;
- the first two words of your firmware's vector table (Cortex-M) or the entry address from \`image_info\` (ESP32), with an explanation of each;
- the LED changing under a \`set\` command with the core halted;
- a watchpoint stop showing old value, new value and source line;
- for the deliberate fault: the stacked PC (or decoded backtrace) and the source line it maps to, which should be the line you wrote.

If a result differs from what you predicted, the difference is the most valuable part of the lab. Write down what you expected, what you saw, and what explains it.`,
    ],
    troubleshooting: [
      { symptom: 'OpenOCD exits with a USB or "device not found" error', cause: 'Probe not visible to the OS, missing permissions, or another program has it open.', fix: 'Check `lsusb`, install the udev rules shipped with your OpenOCD, close the IDE and any serial flasher using the same interface.' },
      { symptom: 'OpenOCD finds the probe but cannot read the debug port', cause: 'Target unpowered, wrong USB connector (UART bridge instead of the chip\'s USB on ESP32-S3/C3 boards), or firmware has reconfigured the debug pins.', fix: 'Use the connector wired to the chip\'s USB pins; put the chip in download mode or connect under reset; reflash a firmware that leaves the pins alone.' },
      { symptom: 'GDB connects but `break main` reports no symbol', cause: 'GDB was started without the ELF, or the build has no debug information.', fix: 'Start GDB with the ELF path, or use `file build/<name>.elf`; rebuild with `-g`.' },
      { symptom: '`compare-sections` reports MIS-MATCHED', cause: 'The flash holds a different build from the ELF.', fix: 'Flash again from this build and re-run the comparison before continuing.' },
      { symptom: 'The board resets a few seconds after halting', cause: 'A watchdog is still running while the core is stopped.', fix: 'Use the SDK\'s option to disable or freeze the watchdog for debug builds.' },
      { symptom: 'The deliberate bad write does not fault', cause: 'The chosen address is actually mapped (for example low addresses on a part with flash at 0), so the access succeeds.', fix: 'Choose an address in a region the memory map marks as reserved, and confirm with `x/1xw` from the debugger that reading it is refused.' },
    ],
    challenge: [
      `Write a fault handler for your board that records the stacked PC, LR and (where available) CFSR in a small structure in RAM that survives a reset, then resets the chip. At start-up, if the structure holds a valid record, print it on the console and clear it. You will need a section that the startup code does not zero and a marker value to tell a valid record from power-on noise.

Then answer in your notes: what does this record reveal to someone with console access, and under what conditions should a production build print it?`,
    ],
    quiz: [
      { q: 'OpenOCD is running and GDB says "Connection refused" for `target extended-remote :3333`. Which layer is at fault?', kind: 'concept', choices: [
        { t: 'The TCP link: OpenOCD is not listening on that port', ok: true, why: 'A refused connection is decided by the host\'s network stack before any debug protocol is spoken. Check that OpenOCD is still running and read its "Listening on port" line.' },
        { t: 'The SWD wiring between the probe and the target\'s debug pins', why: 'Wiring problems are reported by OpenOCD in its own log. GDB would still be able to open the TCP port.' },
        { t: 'The ELF file, which GDB checks before it opens a connection', why: 'The ELF affects symbols, not whether a TCP connection can be opened.' },
      ] },
      { q: 'After `monitor reset halt` on a Cortex-M target, `info registers` shows `sp = 0x20020000`. Where did that value come from?', kind: 'arch', choices: [
        { t: 'The core loaded it from the first word of the vector table at reset', ok: true, why: 'Reset loads the initial stack pointer from vector-table entry 0 before any instruction executes.' },
        { t: 'The startup code set it before the debugger stopped the core', why: 'No code has run yet: the core was halted before its first instruction.' },
        { t: 'GDB read it from the ELF\'s symbol table', why: 'GDB displays what the target reports. The value is in the chip\'s register, put there by the reset sequence.' },
      ] },
      { q: 'You toggle an LED with a GDB `set` command while the core is halted. What does that prove?', kind: 'circuit', choices: [
        { t: 'The register address, pin configuration and LED wiring are right', ok: true, why: 'The write reached the peripheral through the debug port without any firmware executing, so a non-working LED after this would have to be a hardware issue.' },
        { t: 'The firmware\'s LED driver is correct, since the LED responded to a write', why: 'The driver did not run. The test deliberately bypasses it.' },
        { t: 'The CPU clock is running, because the write took effect', why: 'The core was halted. The peripheral responded to a bus write from the debug access port.' },
      ] },
      { q: 'A deliberate write to address 0x00000004 on an MSPM0L2228 does not behave like a null-pointer crash on an ESP32. Why?', kind: 'arch', choices: [
        { t: 'Flash is mapped at address 0 there, so the lowest addresses are real memory', ok: true, why: 'Whether a low address faults depends on what the memory map puts there. On this part it is the start of main flash.' },
        { t: 'Cortex-M0+ cores cannot take faults, so bad accesses are ignored', why: 'They take HardFaults like other Cortex-M cores. They lack only the detailed status registers.' },
        { t: 'GDB intercepts writes through null pointers on TI parts and discards them', why: 'The debugger does not filter the program\'s memory accesses. The behaviour comes from the chip\'s memory map.' },
      ] },
      { q: 'Why rehearse on the simulated session and the host before using a board?', kind: 'concept', choices: [
        { t: 'It separates learning the debugger from diagnosing probes and wiring', ok: true, why: 'Bringing up one layer at a time is the same divide-and-measure method used throughout the section.' },
        { t: 'The simulation is more accurate than a board, so its results are the reference', why: 'It is a simplified model. Its value is that nothing outside the debugger can go wrong.' },
        { t: 'Boards can only be debugged a limited number of times', why: 'There is no such limit. The reason is to reduce the number of unknowns at each step.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ Lab B
  {
    id: 'dbg-lab-firmware-analysis', title: 'Lab B: analyse a firmware image and write the hardening report', kind: 'Scenario', minutes: 150,
    summary: 'Take a raw synthetic firmware dump from bytes to behaviour, then report what it does, what it gives away and how it should be hardened.',
    skills: ['dbg-elf-inspect', 'dbg-fw-triage', 'dbg-disasm-read', 'dbg-boot-analyse', 'dbg-fw-extract'],
    objectives: [
      'Practise readelf, nm, size, strings and objcopy on an ELF you build, and predict what survives conversion to a raw binary',
      'Determine a raw image\'s load address, RAM base and boot arrangement from its vector table',
      'Use strings, constants and entropy to map an image before reading any code',
      'Read short Thumb and RISC-V functions and identify the comparison that makes a security decision',
      'Write a findings report that pairs each weakness with a defence and a way to verify it',
    ],
    hardware: [
      'None. The images are synthetic and bundled with this app.',
      'Optional: a board you own, to repeat steps 3–5 on your own firmware read back with the vendor tool',
    ],
    software: [
      'This app\'s firmware-inspector and disasm-lab tools',
      'gcc and GNU binutils on a Linux host (step 1)',
      'Optional: Ghidra, to repeat the analysis on a file of your own',
    ],
    requirements: {
      functional: [
        'State the load address, initial stack pointer and reset handler address of lockbox.bin, with the bytes that justify each',
        'Describe in two or three sentences what the device does, from evidence in the image',
        'Identify every credential or secret-like value in the image and its memory address',
        'Identify the function that compares codes and describe its loop from the disassembly of the equivalent function in the disassembly tool',
        'For updater.bin: version, hash algorithm, key location and format, and the nature of the high-entropy region',
      ],
      security: [
        'Each finding states impact, the evidence, a specific fix and how the fix would be verified',
        'The report distinguishes values that must be secret from values that are public by design',
        'The report covers how the image could be obtained from a device and which lock addresses each path',
        'No finding relies on obscurity (stripping, unusual formats, unpopulated headers) as a defence',
      ],
    },
    background: [
      `The scenario: you have joined a team that ships a keypad door-lock controller. Before the next release you are asked for an independent look at the firmware, with no source access, to find out what an outsider who obtained one unit could learn. You are given \`lockbox.bin\`, a raw dump, and \`updater.bin\`, the bootloader-style updater that installs it.

Both images are **synthetic**: small programs written for this course, compiled for a Cortex-M0+ with clang, and never run on hardware. \`lockbox\` is intentionally vulnerable. Nothing here is a real product or official MITRE material.

The method is the one from the static-analysis lesson: evidence first, code last. Keep a running notes file with three columns: *observation*, *what it implies*, *how sure*.`,
      { t: 'callout', kind: 'security', md: `The techniques in this lab are the ones you would use to audit your own release. Apply them to firmware you wrote, to these bundled images, or to devices you own. The deliverable is a hardening report, not an exploit.` },
    ],
    diagram: [
      { t: 'ascii', text: `   bytes ──► triage ──────────────► map ───────────────► read code ─────► report
            vector table            strings                the functions     finding
            load address            constants              that strings      impact
            RAM base                entropy                and vectors       fix
            "is there a             code / data            lead to           verification
             bootloader?"           boundaries`, caption: 'The order of work. Each stage narrows where the next one has to look.' },
      `| Image | What you are given | Linked at |
|---|---|---|
| \`demo.bin\` + ELF | Warm-up with symbols available | Start of flash |
| \`lockbox.bin\` | Raw dump, no symbols | To be determined by you |
| \`updater.bin\` | Raw dump, no symbols | To be determined by you |`,
    ],
    steps: [
      { title: 'Warm up on an ELF you built', md: `Build the host demo and answer from tool output alone, without opening \`fw.c\`:\n\n1. Which symbol is the largest RAM object, and how big is it?\n2. At what file offset in \`fw.bin\` is the string that looks like a key, and what address does that correspond to?\n3. How many of \`fw.bin\`'s 8260 bytes are real content, and why is the rest there?\n4. After \`strip\`, which of your answers can still be obtained?\n\nThis is an x86-64 host ELF used to learn the tools. On firmware use the prefixed commands (\`arm-none-eabi-nm\` and so on).`,
        lang: 'sh', status: 'host-tested', code: String.raw`make -C examples/debugging/elfdemo
cd examples/debugging/elfdemo
size fw.elf
nm -S --size-sort fw.elf | tail -3
strings -t x -n 6 fw.bin
readelf -l -W fw.elf
strip -o /tmp/fw.stripped fw.elf && nm /tmp/fw.stripped     # "no symbols"
strings -n 6 /tmp/fw.stripped | head` },
      { title: 'Calibrate on an image with symbols', md: `Open \`demo.bin\` in the inspector. It has an ELF view, so you can check every conclusion you draw from raw bytes against the section table. Complete its tasks: the initial stack pointer, where the initial value of a \`.data\` variable is stored in flash, its offset in the file, and how much of the file \`.bss\` occupies.\n\nThe point is calibration: learn how far raw-byte reasoning gets you while you can still check the answer.`,
        blocks: [ { t: 'widget', name: 'firmware-inspector', props: { image: 'demo' } } ] },
      { title: 'Triage lockbox.bin', md: `Switch to \`lockbox.bin\`. There is no ELF view. From the Vectors view and the hex view, record:\n\n- the initial stack pointer, and what it says about RAM;\n- the reset vector, and the reset handler's address;\n- the load address, with your arithmetic;\n- whether the image starts at the beginning of flash, and what follows if it does not.\n\nState how you would test your load address before trusting it.`,
        blocks: [ { t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' } } ] },
      { title: 'Map it with strings', md: `Use the Strings view. Group what you find: product identification, user prompts, result messages, anything that looks like a credential, anything that mentions a special mode.\n\nFor each credential-like string compute the **memory address** it has when the image is in flash (file offset + load address). That is the value a disassembler will show in the literal pool of the function that uses it.\n\nWrite down, before reading any code, your hypothesis for how the device decides to open.` },
      { title: 'Read the comparison', md: `The image compares the entered line against stored codes with a string-comparison function. The disassembly tool contains the same function shape (\`str_equal\`) and a PIN check (\`check_pin\`) built from the same source style. For each:\n\n1. Identify the two pointer arguments and where each byte is loaded.\n2. Find the compare instruction and the branch that leaves the loop.\n3. Decide whether the loop's run time depends on the data.\n4. Find where the reference value comes from (a literal-pool address).\n\nThen do the same in the RISC-V tab and note what changes and what does not.`,
        blocks: [ { t: 'widget', name: 'disasm-lab', props: { arch: 'thumb' } }, { t: 'widget', name: 'disasm-lab', props: { arch: 'riscv' } } ] },
      { title: 'Audit the updater', md: `Open \`updater.bin\` and complete its tasks: version, the embedded key's offset and format, the compressed block and the hash algorithm. Then fill in the boot-analysis table from the bootloader lesson for the pair *updater → application*, using only what the image shows. Mark every cell that is an inference from a string and not from code.`,
        blocks: [ { t: 'widget', name: 'firmware-inspector', props: { image: 'updater' } } ] },
      { title: 'Consider how the image would be obtained', md: `For a real controller built on each course platform, list the paths by which an owner of one unit could read this image, and the lock that applies:\n\n| Path | ESP32 family | MSPM0L2228 | MAX78000 |\n|---|---|---|---|\n| Debug port | | | |\n| ROM / serial bootloader | | | |\n| External memory | | | |\n\nFill it in from the extraction lesson and the vendor documents it cites. Where you are not certain of a mechanism, write "check the datasheet / security guide" and name the document. Do not guess.` },
      { title: 'Write the report', md: `One to two pages, in this structure:\n\n1. **Summary**: what the firmware does, in plain language.\n2. **Method**: tools and the order of work.\n3. **Facts established**: load address, memory layout, boot arrangement, each with its evidence.\n4. **Findings**: one per weakness, each with *evidence*, *impact*, *fix* and *verification*.\n5. **Not findings**: things that look alarming and are fine (for example the public key), with the reason.\n6. **Open questions**: what the image alone cannot tell you.\n\nA finding without a verification step is incomplete.` },
    ],
    walkthrough: [
      `**Why the vector table gives the load address.** The processor reads the reset vector as an absolute address. The linker computed it as *load address + offset of the reset handler*. The handler's offset in the file is visible (it follows the table), so subtracting gives the base. Everything else absolute in the image, including every pointer to a string, was computed with the same base, which is why a correct base makes literal-pool values land exactly on string starts.

**Why a string in the image is a finding.** The comparison function receives a pointer to the reference value. On the processor that pointer is loaded from a literal pool, and the bytes it points at are in \`.rodata\`, which is stored in flash exactly as written in the source. No tool is needed to "extract" it beyond printing printable bytes. Any value the device compares against in plain form is readable by whoever reads the flash.

**Why the fix is not "hide the string".** Splitting it, XOR-ing it with a constant, or computing it at run time all leave a program that reconstructs the value, and that program is in the same image. The real fixes change the design: remove the maintenance credential entirely; or store only a salted hash of a per-device code; or replace a shared secret with a challenge signed by a service key that never leaves the manufacturer. Then lock the readout paths so that obtaining the image is itself hard, and assume it will still happen to one unit.

**Why the early exit matters.** In the compare loop, the branch that leaves on the first mismatch makes the loop count equal to the length of the matching prefix. On hardware that is a measurable time difference at the UART. A constant-time comparison removes it; rate-limiting and lock-out after failed attempts limit what any guessing strategy can achieve. The image increments a failure counter, and you should ask what, if anything, it does with it.

**What the updater shows.** A public key, a hash table and a signature-check message indicate the intended design: hash the image, verify an ECDSA signature. That is the right shape. The image cannot show whether the bootloader itself is protected from replacement, whether the signature covers the header, or whether old versions are refused. Those go under open questions, with the test that would answer each.`,
    ],
    testing: [
      `Check your work against the tools:

- The inspector marks each task when your answer is right. All tasks for \`demo\`, \`lockbox\` and \`updater\` should be complete.
- Your load address for \`lockbox.bin\` should make the credential's memory address equal to file offset plus base, and the inspector accepts that address.
- For each disassembly function you should have written what it does *before* revealing the C source, and your description should match.
- In step 1, your four answers should agree with the tool output: the largest RAM object is \`rx_buffer\` at 0x100 bytes; the key-like string is at file offset 0x2030, address 0x403030; 307 bytes are content and the rest is gap fill between page-aligned sections; after \`strip\` the strings and sizes remain and the symbol names do not.

Then test the report itself. Give it to someone else, or reread it after a day, and ask of each finding: could an engineer act on this without asking a question? Is there a concrete check that would show the fix worked?`,
    ],
    troubleshooting: [
      { symptom: 'The load address you computed makes string addresses land in the middle of strings', cause: 'The reset handler does not immediately follow the vector table, or the table length was misjudged.', fix: 'Use more than one clue: several handler addresses, and literal-pool pointers that should point at string starts. Adjust the base until they agree.' },
      { symptom: 'The strings view shows many short meaningless strings', cause: 'Code bytes that happen to be printable.', fix: 'Raise the minimum length to 6 or 8. Real text is longer and clusters in one region.' },
      { symptom: 'You cannot tell where code ends and data begins', cause: 'Looking at bytes alone without landmarks.', fix: 'Use the vector table for the start of code, the first long string for the start of constants, and the entropy view for compressed regions.' },
      { symptom: 'The report lists the embedded public key as a leaked secret', cause: 'Treating all keys alike.', fix: 'A public key is meant to be known. The question to ask is whether it can be replaced, not whether it can be read.' },
      { symptom: 'A finding says only "encrypt the firmware"', cause: 'Naming a mechanism without saying where the key lives or what it protects.', fix: 'State what is encrypted, with what key, where that key is stored, who can read it, and how you would confirm a dump is ciphertext.' },
    ],
    challenge: [
      `Repeat the analysis on firmware of your own. Take a project you built for one of the course platforms, read it back from your board with the vendor tool (or use the build's \`.bin\`), and run the same triage with \`strings\`, a hex viewer and, if you have it, Ghidra with the correct language and base address.

Write the same report about your own work. Most people find at least one of: a debug message that reveals too much, a test credential left in, a Wi-Fi password in plain text, or an unlocked debug port. Then fix one finding and show the verification.`,
    ],
    rubric: [
      { criterion: 'Facts established from evidence', points: 20, evidence: 'Load address, SP, reset handler and boot arrangement each quoted with the bytes or arithmetic that support them' },
      { criterion: 'Behaviour described correctly', points: 15, evidence: 'A plain-language description of what the device does that matches the strings and code shape' },
      { criterion: 'Disassembly read correctly', points: 15, evidence: 'Arguments, compare, loop exit and return value identified for the comparison in both architectures' },
      { criterion: 'Findings are complete', points: 25, evidence: 'Each has evidence, impact, a specific fix and a verification step; public values are not reported as secrets' },
      { criterion: 'Extraction paths and locks', points: 15, evidence: 'Per-platform table filled from cited vendor documents, with uncertainty marked instead of guessed' },
      { criterion: 'Open questions', points: 10, evidence: 'States what the image cannot show and the test that would settle each' },
    ],
    quiz: [
      { q: 'A raw image\'s reset vector is 0x08004041 and its vector table is 0x40 bytes with the reset handler directly after. What does the load address tell you about the device?', kind: 'arch', choices: [
        { t: 'It is 0x08004000, so something else owns the first 16 kB of flash', ok: true, why: '0x08004040 minus 0x40 gives the base, and a base above the start of flash means another image owns the beginning.' },
        { t: 'It is 0x08000000, since Cortex-M images always start at the beginning of flash', why: 'The base must be consistent with the vector. An image linked at the start of flash would have a reset vector just above 0x08000000.' },
        { t: 'Nothing can be concluded without symbols', why: 'The vector table is defined by the architecture, so its entries can be interpreted in any image regardless of symbols.' },
      ] },
      { q: 'You find a plain-text maintenance code in a firmware image. Which fix addresses the weakness itself?', kind: 'security', choices: [
        { t: 'Remove the shared credential, or verify without any stored shared secret', ok: true, why: 'Any value the device can compare against in plain form can be read by whoever reads the flash. Only changing what is stored removes the problem.' },
        { t: 'Store the code XOR-ed with a constant that only the firmware knows', why: 'The constant and the code that undoes the XOR are in the same image. The secret is recovered by reading a few more instructions.' },
        { t: 'Strip the ELF before producing the binary, so the string has no name', why: 'Stripping removes symbol names. The credential is program data and is unaffected.' },
        { t: 'Move the code to a different address, away from the other strings', why: 'A string search finds it wherever it is placed.' },
      ] },
      { q: 'Why does the report list the updater\'s embedded P-256 public key under "not findings"?', kind: 'security', choices: [
        { t: 'It is public by design; what matters is whether it can be replaced', ok: true, why: 'Knowing a public key does not let anyone forge signatures. The risk to assess is modification of the key or of the code that uses it.' },
        { t: 'Because it is encrypted, so reading it reveals nothing useful', why: 'It is stored in the clear, recognisable by its format. It simply does not need to be confidential.' },
        { t: 'Because P-256 public keys cannot be located in or extracted from a flash dump', why: 'It was found by format in a few minutes. Extractability is not what makes it harmless.' },
      ] },
      { q: 'Which statement in a findings report is verifiable?', kind: 'security', choices: [
        { t: '"OpenOCD on a locked production unit must fail to read address X; logs are attached"', ok: true, why: 'It names the action, the expected result and the evidence, so anyone can repeat it and see pass or fail.' },
        { t: '"The device should be made more secure against readout by all known tools"', why: 'There is no action or observable outcome, so nobody can tell whether it has been done.' },
        { t: '"Readout protection is believed to be enabled on all units shipped since March"', why: 'A belief is not a test. The statement gives no way to confirm or refute it.' },
      ] },
      { q: 'The compare loop exits on the first mismatching byte, and the firmware increments a failure counter that nothing reads. Which pair of changes best limits code guessing?', kind: 'security', choices: [
        { t: 'A constant-time comparison, and a lock-out driven by the counter', ok: true, why: 'The first removes the timing signal that makes guessing efficient, and the second bounds the number of guesses whatever the strategy.' },
        { t: 'A faster processor clock and a longer prompt string, to blur the timing', why: 'Neither changes what an attacker can measure or how many attempts they get. A faster clock only shrinks the timing differences without removing them.' },
        { t: 'Printing "ACCESS DENIED" before doing the comparison, to hide its duration', why: 'The message order does not change the time taken by the comparison, which can still be measured around it.' },
      ] },
    ],
  },
];

const troubleshooting = [
  { symptom: 'Every debug attempt fails after enabling a security setting', area: 'Locks', causes: 'The setting disabled the debug port or bootloader, possibly irreversibly.', fix: 'Check the vendor\'s recovery options (mass erase, factory reset, password) before enabling locks; practise on a spare board and record each setting.' },
];

export default { skills: [], lessons: [], labs, glossary: [], troubleshooting, refs: [] };
