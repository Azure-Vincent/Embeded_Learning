// Firmware engineering lab: a portable, tested firmware module.
import { clPortBench } from './clabs.js';

const C = String.raw;

const lab = {
  id: 'fw-lab-portable', title: 'Lab: a portable, tested firmware module', kind: 'Guided lab', minutes: 180,
  summary: 'Build a line-oriented command parser, a ring buffer and a door-lock state machine behind a HAL; unit-test them on the host under ASan and UBSan; then port the unchanged application to Bench-MCU and, optionally, to an ESP32 UART.',
  skills: ['fw-ringbuf', 'fw-framing', 'fw-fsm-design', 'fw-hal-design', 'fw-host-test', 'fw-sanitizers', 'fw-toolchain-inspect', 'fw-architecture'],
  objectives: [
    'Build and run a host test suite with AddressSanitizer and UndefinedBehaviorSanitizer enabled.',
    'Read the module boundaries of a firmware project from its headers and from `nm` output.',
    'Add a feature test-first: write failing tests, then the code.',
    'Break a bounds check on purpose and read the sanitizer report that results.',
    'Port the application to a new target by writing only a HAL, on the simulated Bench-MCU.',
    'Optional, with hardware: bring the same application up on an ESP32 UART.',
  ],
  hardware: [
    'None required for parts 1–4 (host PC and the browser simulator).',
    'Optional part 5: an ESP32 development board, a USB cable, a 3.3 V USB-to-serial adapter and three jumper wires; an LED with a 330 Ω series resistor to stand in for the latch.',
  ],
  software: [
    'GCC 10 or later (or Clang), GNU Make, binutils. On Debian/Ubuntu: `sudo apt install build-essential`.',
    'This repository, for `examples/firmware-eng/`.',
    'Optional part 5: ESP-IDF, installed as described in the ESP32 section.',
  ],
  background: [
    `You will work with the door-lock controller that the lessons of this section took apart. It accepts text commands on a UART (\`PIN 4921\`, \`LOCK\`, \`STATUS\`, \`VERSION\`), drives a latch output and a lockout LED, relocks after 5 s and refuses all PINs for 30 s after three consecutive wrong ones.

The point of the lab is not the lock. It is the **shape** of the code: everything that decides behaviour is hardware-independent and tested on your PC; the only target-specific file is a HAL of five functions. You will first prove the logic on the host, then move it to two targets without editing it.`,
    { t: 'callout', kind: 'sim', md: 'Parts 1–3 run real code on your own computer. Part 4 runs in the course\'s C interpreter on **Bench-MCU**, a fictional MCU: its registers match no real chip. Part 5 is the only part that involves hardware. Its code was compiled for the `esp32` target with ESP-IDF v6.1 but has **not been run on a board** by the authors.' },
    { t: 'callout', kind: 'security', md: 'The demo PIN is a constant in the source and therefore readable in the firmware image by anyone who can dump it. That is deliberate here, so the lab can focus on structure, and it is one of the first things the security section teaches you to find and then to fix.' },
  ],
  diagram: [
    { t: 'ascii', text:
`                         ┌──────────────────────────────────────────────┐
   UART RX bytes ───────►│ hal_uart_read()                               │
                         │      │                                        │
                         │      ▼            portable code (src/)        │
                         │  ringbuf  ──►  line_rx  ──►  handle_line      │
                         │  (FIFO)       (bytes→line)   (commands)       │
                         │                                  │ events     │
                         │                                  ▼            │
                         │   hal_millis() ──► TICK ──►   lock FSM        │
                         │                                  │ state      │
   UART TX bytes ◄───────│ hal_uart_write()  ◄── replies ───┤            │
   LATCH pin     ◄───────│ hal_gpio_write(HAL_PIN_LATCH) ◄──┤            │
   LED pin       ◄───────│ hal_gpio_write(HAL_PIN_LED)   ◄──┘            │
                         └──────────────────────────────────────────────┘
        hal.h is implemented by ONE of:
        port/hal_fake.c (tests)   port/hal_posix.c (PC)   port/hal_benchmcu.c   port/hal_esp32.c`,
      caption: 'Data flow of the application. Only the five hal_ functions touch hardware.' },
    { t: 'ascii', text:
`Optional part 5 wiring (ESP32 dev board, 3.3 V logic). Check your board's pinout first.

  USB-serial adapter        ESP32
  ------------------        -----------------------------
  TX   ───────────────────► GPIO26  (LOCK_UART_RX)
  RX   ◄─────────────────── GPIO25  (LOCK_UART_TX)
  GND  ──────────────────── GND                  (common ground is mandatory)

  GPIO32 (latch) ──[330 Ω]──►|── GND             LED stands in for the latch driver
  GPIO33 (lockout LED) ──[330 Ω]──►|── GND

  Do NOT connect the adapter's 5 V or 3.3 V pin: the board is powered from its own USB port.
  The adapter must be a 3.3 V type; a 5 V TX line can damage the ESP32's input.`,
      caption: 'Wiring for the optional hardware part. Not built or measured by the authors.' },
  ],
  steps: [
    { title: 'Part 1: build and run the tests', md: `In a terminal:

\`\`\`
cd examples/firmware-eng
make test
\`\`\`

You should see each test program list the tests it ran, then four summary lines and \`ALL TESTS PASSED\`:

\`\`\`
test_ringbuf: 4043 checks, 0 failures
test_line_rx: 18 checks, 0 failures
test_lock: 18 checks, 0 failures
test_app: 28 checks, 0 failures
ALL TESTS PASSED
\`\`\`

Open the \`Makefile\` and find: the warning flags (\`WARN\`), the sanitizer flags (\`SAN\`), and the rule for \`test_app\`. Which source files does \`test_app\` link that \`test_lock\` does not, and why?

Then build the PC port and talk to it:

\`\`\`
make demo
./build/doorlock
STATUS
PIN 1111
PIN 4921
STATUS
\`\`\`

Type each command and press Enter. You should see \`LOCKED\`, \`DENIED\`, \`OK\`, \`UNLOCKED\`, a \`[pin] LATCH = 1\` message on stderr when the latch opens and \`[pin] LATCH = 0\` five seconds later. Stop it with Ctrl-C.` },
    { title: 'Part 2: read the architecture from the tools', md: `Without opening \`src/app.c\`, find out what it depends on:

\`\`\`
gcc -std=c11 -O1 -Iinclude -c src/app.c -o /tmp/app.o
nm /tmp/app.o
\`\`\`

Answer in your notebook: (a) Which symbols are marked \`T\`, and where are they declared? (b) Which are \`U\`, and which layer does each belong to? (c) Which are lower-case \`b\`, and what does that tell you about who can modify them?

Then run \`make inspect\` and open \`build/doorlock.map\`. Find the \`.bss\` contribution of the application object. Predict what it becomes if \`APP_RX_FIFO_SIZE\` in \`include/app.h\` changes from 64 to 128; change it, rebuild and check. Change it back.

Finally run \`make su\` and identify the function in \`bugs/stack_hog.c\` that could not run on a target whose stack is 256 bytes.` },
    { title: 'Part 3a: break it, and read the report', md: `In \`src/line_rx.c\` change the length check

\`\`\`c
if (lr->len >= LINE_CAP) {
\`\`\`

to \`>\` and run \`make test\`. You should see the sanitizer stop \`test_line_rx\` with a \`runtime error\` naming \`line_rx.c\` and the line of the store, before the test's own checks get a chance to report. Read the message: which array, which index, which test was running (the last \`ran …\` line shows the one before it)?

Restore \`>=\` and confirm \`make test\` passes again. Then run \`make bug-demo\` to see the same class of bug in the stand-alone file used in the lesson.` },
    { title: 'Part 3b: add a feature test-first', md: `New requirement: **a \`COUNT\` command replies with the number of wrong PIN attempts since the last successful unlock, as a decimal number.**

1. In \`tests/test_app.c\` add a test \`test_count_command\` and register it in \`main\` with \`RUN\`. Cover: 0 after boot; 2 after two wrong PINs; 0 again after a correct PIN; and the value during lockout (decide what it should be, from the requirement's wording, before you look at the code).
2. Run \`make test\`. It must **fail**, with \`got "ERR\\n"\`. If it passes, your test is not testing the new command.
3. Implement it. The count lives in the lock's state, so add an accessor to \`lock.h\`/\`lock.c\` instead of reaching into the struct from \`app.c\`. You need to format a small number as text without \`printf\`: write a helper, and give it its own boundary test.
4. \`make test\` until everything is green, old tests included.`,
      code: C`static void test_count_command(void)
{
    start();
    send("COUNT\n");     CHECK_STR(fake_tx(), "0\n");
    send("PIN 0000\n");
    send("PIN 0001\n");
    send("COUNT\n");     CHECK_STR(fake_tx(), "2\n");
    send("PIN 4921\n");
    send("COUNT\n");     CHECK_STR(fake_tx(), "0\n");
}`, lang: 'c', status: 'pseudo' },
    { title: 'Part 4: port to Bench-MCU', md: `Now move the application to a microcontroller it has never run on. In the simulator the whole program has to be one file, so the portable code is pasted below a HAL section that you write. This is the same task as writing \`port/hal_benchmcu.c\`; compare with that file afterwards.

The test bench feeds command lines into UART0's receiver and checks what is transmitted, the pin directions, the state of \`GPIO_OUT\`, and the relock timeout: the latch must still be open 2500 timer periods after a correct PIN and must close once your \`hal_millis\` has counted 5000 ms. (The lab's board constant is 100 timer ticks per millisecond, not the 1000 in \`port/hal_benchmcu.c\`, so that the simulator can cover five seconds.)`,
      blocks: [{ t: 'widget', name: 'c-lab', props: clPortBench }] },
    { title: 'Part 5 (optional, hardware): bring it up on an ESP32', md: `This part needs a board. The files \`port/hal_esp32.c\` and \`port/main_esp32.c\` implement the HAL with the ESP-IDF UART and GPIO drivers. **They were compiled for the \`esp32\` target with ESP-IDF v6.1 in this repository's environment, and have not been run on a board by the authors.** A clean build proves the API calls exist and type-check; it proves nothing about pins, levels or timing. If you use a different IDF version, treat the first build as a review exercise and read every API call against that version's documentation.

1. Create an ESP-IDF project (\`idf.py create-project doorlock\`). Copy this example's \`include/\` and \`src/\` into a directory \`shared/\` inside it, and the two ESP32 port files into \`main/\`.
2. Replace \`main/CMakeLists.txt\` with the component registration shown below.
3. Check the four pin macros at the top of \`hal_esp32.c\` against your board. Wire the serial adapter and LEDs as in the wiring table above.
4. \`idf.py set-target esp32\`, \`idf.py build\`, \`idf.py -p <port> flash\`.
5. Open the *adapter's* port in a terminal at 115200 baud, 8N1 (not the board's USB port, which carries the IDF log) and send \`STATUS\`.

You should see \`LOCKED\`. After \`PIN 4921\` you should see \`OK\` and the latch LED lit for about five seconds. Measure it with a stopwatch or a logic analyser, and write down what you measured, not what you expected.`,
      code: C`# main/CMakeLists.txt
idf_component_register(
    SRCS         "main_esp32.c" "hal_esp32.c"
                 "../shared/src/app.c" "../shared/src/ringbuf.c"
                 "../shared/src/line_rx.c" "../shared/src/lock.c"
    INCLUDE_DIRS "../shared/include"
    PRIV_REQUIRES esp_driver_uart esp_driver_gpio esp_timer
)`, lang: 'cmake', status: 'idf-checked' },
  ],
  walkthrough: [
    `What the important lines do at the level of memory and hardware.`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/src/app.c: one pass of the application',
      code: C`void app_poll(void)
{
    uint32_t now = hal_millis();
    uint8_t b;

    /* Ports without an RX interrupt are pumped here; ISR-driven ports return false. */
    while (hal_uart_read(&b)) app_on_rx_byte(b);

    while (rb_get(&s_rx, &b)) {
        if (line_feed(&s_line, b)) handle_line(s_line.buf, now);
    }

    lock_dispatch(&s_lock, LOCK_EV_TICK, now);

    /* Outputs are a pure function of state, written in one place. */
    hal_gpio_write(HAL_PIN_LATCH, lock_latch_open(&s_lock));
    hal_gpio_write(HAL_PIN_LED, s_lock.state == LOCK_LOCKOUT);
}`,
      explain: [
        { lines: '3', md: 'One read of the time base per pass. Every decision in this pass uses the same `now`, so two timeouts cannot disagree about what time it is.' },
        { lines: '7', md: 'Moves bytes from the HAL into the FIFO. On Bench-MCU each `hal_uart_read` is a load of `UART_STATUS`, a bit test, and a load of `UART_DATA` that pops the hardware\'s byte. On a port with an RX interrupt this loop finds nothing and the ISR is the producer.' },
        { lines: '9-11', md: 'The consumer side. Each byte goes through the two-state line machine; only a complete, in-bounds line reaches the command handler.' },
        { lines: '13', md: 'A TICK event on every pass. It costs one comparison in the states that have no deadline and replaces every delay the blocking version needed.' },
        { lines: '16-17', md: 'Two register writes per pass (on Bench-MCU: `GPIO_SET` or `GPIO_CLR`). Writing them every pass, from state, means a glitched or forgotten write is corrected a few microseconds later.' },
      ] },
    { t: 'code', lang: 'c', status: 'interp', caption: 'examples/firmware-eng/port/hal_benchmcu.c (excerpt): the same functions as the part 4 solution, which runs in the course interpreter.',
      code: C`bool hal_uart_read(uint8_t *byte)
{
    if ((UART_STATUS & UART_RX_AVAIL) == 0) return false;
    *byte = (uint8_t)UART_DATA;                  /* reading DATA pops the byte */
    return true;
}

void hal_uart_write(uint8_t byte)
{
    uint32_t guard = TX_WAIT_LIMIT;
    while ((UART_STATUS & UART_TX_READY) == 0) {
        if (--guard == 0) return;                /* transmitter stuck: give up, do not hang */
    }
    UART_DATA = byte;
}

uint32_t hal_millis(void)
{
    if (TIM_STATUS & 1u) {                       /* EXPIRED: one millisecond has elapsed */
        TIM_STATUS = 1u;                         /* write 1 to clear */
        s_ms++;
    }
    return s_ms;
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    uint32_t bit = (pin == HAL_PIN_LATCH) ? PIN_LATCH_BIT : PIN_LED_BIT;
    if (level) GPIO_SET = bit; else GPIO_CLR = bit;
}`,
      explain: [
        { lines: '1-6', md: 'A non-blocking read: test bit 1 of the status register; only if it is set, read the data register. Reading `UART_DATA` when nothing is available would return 0, indistinguishable from a real zero byte.' },
        { lines: '8-15', md: 'Transmit waits for `TX_READY` with a counted guard. If the transmitter never becomes ready the byte is dropped and the application keeps running: for a console, losing output is better than hanging a lock.' },
        { lines: '17-24', md: 'Time is counted by polling the timer\'s EXPIRED flag and clearing it with a write of 1. Simple, and wrong if the caller ever stays away for more than one period; an interrupt-driven tick removes that weakness.' },
        { lines: '26-30', md: '`GPIO_SET` and `GPIO_CLR` change only the bits written as 1. No read-modify-write of `GPIO_OUT`, so an interrupt that also drives a pin cannot be undone by this code.' },
      ] },
  ],
  testing: [
    `**Host (parts 1–3).** \`make test\` must end with \`ALL TESTS PASSED\` and exit status 0 (\`echo $?\`). Any sanitizer message is a failure even if a summary line says 0 failures. After part 3b, \`test_app\` should report more checks than the original 28.

**Negative check.** A test suite you have never seen fail is unproven. For at least two tests, change the code so that they should fail (for example \`LOCK_MAX_BAD\` to 4, or remove the \`'\\r'\` handling), confirm that the expected test and only a plausible set of others goes red, and restore the code.

**Bench-MCU (part 4).** All four tests in the C lab must pass: the UART transmit text must match exactly; \`GPIO_OUT\` must read \`0x10\` while the latch is open, go back to \`0x00\` by itself after the 5000 ms timeout, read \`0x20\` during lockout and \`0x00\` after an explicit \`LOCK\`.

**ESP32 (part 5).** You should see, on the adapter's terminal: \`LOCKED\` in reply to \`STATUS\`; \`DENIED\`, \`DENIED\`, \`LOCKOUT\` for three wrong PINs with the lockout LED on; \`LOCKOUT\` in reply to the correct PIN during the next 30 s. With a logic analyser on the latch pin you should see a high pulse of about 5 s after a correct PIN. These are expectations from the code, not measurements made by the authors.`,
  ],
  troubleshooting: [
    { symptom: '`make test` fails to link with "cannot find -lasan" or "libubsan"', cause: 'The sanitizer run-time libraries are not installed (common on minimal containers and with some MinGW toolchains).', fix: 'Install them (`libasan`/`libubsan` packages matching your GCC version), or use Clang: `make CC=clang test`. As a last resort run once with `make SAN= test` to check the logic, knowing memory errors are then unchecked.' },
    { symptom: 'The test output stops after a `ran …` line with `runtime error:` or `AddressSanitizer:`', cause: 'A sanitizer found undefined behaviour or a bad memory access in the test that was running next.', fix: 'Read the first file:line in the report: that is the faulting access. The stack trace below it shows which test called it.' },
    { symptom: '`./build/doorlock` prints nothing when you type', cause: 'The command is only processed when a newline arrives, and a terminal sends the line when you press Enter. Or the command is longer than 24 characters and was discarded.', fix: 'Press Enter after each command. Check for trailing spaces. `STATUS` is a good first command.' },
    { symptom: 'Part 3b: the new test passes before you implement anything', cause: 'The test was not added to `main` with `RUN`, or it compares against the reply that the unknown-command path already gives.', fix: 'Confirm the test name appears in the `ran …` output and that it expects a number, not `ERR`.' },
    { symptom: 'Part 4: UART output is empty or missing characters', cause: '`UART_CTRL` ENABLE was not set in `hal_init`, or `hal_uart_write` writes `UART_DATA` without waiting for `TX_READY`.', fix: 'Set bit 0 of `UART_CTRL`; poll `UART_STATUS & UART_TX_READY` before each write, with a bounded count.' },
    { symptom: 'Part 4: replies are correct but the `GPIO_OUT` check fails', cause: 'The pins were never made outputs (`GPIO_DIR`), or the wrong bit is written for a pin role.', fix: 'Set bits 4 and 5 of `GPIO_DIR` in `hal_init`; map `HAL_PIN_LATCH` to bit 4 and `HAL_PIN_LED` to bit 5.' },
    { symptom: 'Part 4: the simulator stops with "probably an infinite loop", or the latch closes far too early', cause: 'Time is wrong. If `hal_millis` never advances (timer not enabled, no auto-reload, EXPIRED never tested) the latch never relocks and the loop never ends. If it adds one on every call, or never clears EXPIRED, 5000 "milliseconds" pass in a fraction of the real time.', fix: 'In `hal_init` write `TIM_LOAD` and set ENABLE and AUTO_RELOAD in `TIM_CTRL`. In `hal_millis` count one millisecond only when `TIM_STATUS` bit 0 is set, and clear the flag by writing 1 to it.' },
    { symptom: 'Part 5: garbage characters on the terminal', cause: 'Baud rate or format mismatch, or the terminal is attached to the board\'s console port, which carries the bootloader and IDF log.', fix: 'Use the adapter\'s port at 115200 8N1. If still garbled, check that both sides share ground.' },
    { symptom: 'Part 5: nothing received and no reply', cause: 'TX and RX not crossed, or the chosen pins are in use on your board.', fix: 'Adapter TX goes to the ESP32 RX pin and vice versa. Check the board\'s schematic for the pins; the Protocols section\'s `protocol-debug` tool has this fault as a scenario.' },
    { symptom: 'Part 5: build fails on an include or a `PRIV_REQUIRES` name', cause: 'Driver component names and header locations have changed between ESP-IDF major versions (in older v5 releases the UART and GPIO drivers were part of a single `driver` component instead of `esp_driver_uart` and `esp_driver_gpio`). The port was built with v6.1 only.', fix: 'Look up the UART, GPIO and esp_timer pages for your IDF version and adjust the includes and component names. This is the review the step asked for.' },
  ],
  challenge: [
    `No solutions are given for these.

1. **Interrupt-driven receive on Bench-MCU.** Change your part 4 port so that the UART RX interrupt (\`UART_CTRL\` bit 1, \`irq_attach(IRQ_UART_RX, …)\`) calls \`rb_put\` and \`hal_uart_read\` always returns false. The portable code must stay untouched. What has to be true of \`rb_head\` and \`rb_tail\` for this to be safe, and is it?
2. **Binary framing.** Replace the text protocol with length-prefixed frames carrying a start byte, a command, a length, a payload and a CRC-8, with a parser written as an explicit state machine and a test for every malformed frame you can think of. Keep the lock and the HAL unchanged.
3. **A fault-injecting fake.** Extend \`hal_fake.c\` so a test can make the next N calls to \`hal_uart_write\` drop their byte, and can deliver received bytes one per poll. Find out whether any existing test depended on the fake being kind.
4. **Stack budget.** Using \`-fstack-usage\` on \`src/*.c\`, compute the deepest call path of \`app_poll\` on the host. If you have an Arm toolchain installed, repeat with \`arm-none-eabi-gcc -mcpu=cortex-m0plus -mthumb -Os\` and compare with the 256-byte stack of the 2026 eCTF reference design.
5. **Persistence.** Make the bad-attempt counter survive a reset, so that power-cycling does not clear a lockout. Extend the HAL with storage functions, give the fake a way to simulate a power cut between two writes, and decide what the lock should do if the stored value is corrupt.`,
  ],
  quiz: [
    { q: 'In this lab, which file had to be written to move the application from the PC to Bench-MCU?', kind: 'arch', choices: [
      { t: 'Only the HAL implementation; every file under `src/` was reused unchanged', ok: true, why: 'The application calls five functions declared in `hal.h`. A new target supplies those five and nothing else changes, which is why the host tests still describe the ported behaviour.' },
      { t: 'The state machine, because timers differ between targets', why: 'The state machine receives the time as a parameter and never touches a timer. Only the HAL knows how time is obtained.' },
      { t: 'The ring buffer, because Bench-MCU is 32-bit and the PC is 64-bit', why: 'The buffer uses fixed-width types (`uint8_t`, `uint16_t`) and behaves identically on both.' },
      { t: 'All of them: firmware must be rewritten for each MCU', why: 'That is what happens when logic and register access are mixed. Separating them is the purpose of the HAL.' },
    ] },
    { q: 'You change `>=` to `>` in the line receiver and run `make test`. The sanitizer aborts before the test\'s own `CHECK` reports anything. Why is that the better outcome?', kind: 'concept', choices: [
      { t: 'It reports the exact faulting store, whereas the test would at best notice a wrong result later and might notice nothing', ok: true, why: 'An overflow by one byte often leaves results intact. The sanitizer checks the access itself, so detection does not depend on the damage being visible.' },
      { t: 'Because sanitizer output is shorter', why: 'It is usually longer. Its value is precision: file, line and the object that was overrun.' },
      { t: 'It is not better: tests should always finish', why: 'Continuing after memory corruption produces results that cannot be trusted; stopping at the first invalid access is the safer behaviour.' },
    ] },
    { q: 'In part 3b the instructions insist that the new test must fail before you implement `COUNT`. What would a pass at that point most likely mean?', kind: 'concept', choices: [
      { t: 'The test is not being run or does not check what you think, so it would also "pass" with a broken implementation', ok: true, why: 'A test that cannot fail gives no evidence. Seeing it red first proves it is wired in and sensitive to the missing behaviour.' },
      { t: 'The feature already exists', why: 'The command handler replies `ERR` to unknown commands; a correct test expecting a number cannot pass against that.' },
      { t: 'The compiler optimised the test away', why: 'Tests with observable output and side effects are not removed by the optimiser.' },
    ] },
    { q: 'The Bench-MCU `hal_millis` counts one millisecond each time it is called and finds the timer\'s EXPIRED flag set. Under what condition does time run slow?', kind: 'code', choices: [
      { t: 'When more than one timer period elapses between two calls: several expiries are counted as one', ok: true, why: 'A single flag cannot say how many times the timer expired. If the main loop stalls for 3 ms, only one millisecond is added.' },
      { t: 'When the UART is transmitting', why: 'Transmission itself does not affect the timer; only the time the main loop spends away from `hal_millis` matters.' },
      { t: 'Never: the timer hardware keeps exact time', why: 'The timer does, but the software count derived from polling its flag can miss expiries.' },
    ] },
    { q: 'Why does `test_app.c` link `port/hal_fake.c` while `test_lock.c` links no HAL at all?', kind: 'arch', choices: [
      { t: '`lock.c` has no hardware dependency: events and time are parameters. `app.c` calls the HAL, so some implementation must be linked', ok: true, why: 'The dependency lists (`nm` `U` symbols) differ: `lock.o` needs nothing external; `app.o` needs the five `hal_` functions.' },
      { t: 'The lock test is less important', why: 'Linking is determined by what a module references, not by the importance of its tests.' },
      { t: 'A HAL can only be linked once per project', why: 'Each test is a separate program with its own link; any of them could link a HAL if its code needed one.' },
    ] },
  ],
  requirements: {
    functional: [
      'R1: `PIN <correct>` in LOCKED replies `OK` and drives the latch output high.',
      'R2: the latch output returns low 5000 ms after opening, or immediately on `LOCK`.',
      'R3: three consecutive wrong PINs reply `LOCKOUT`, turn the LED on and refuse every PIN for 30 000 ms.',
      'R4: a line longer than 24 characters produces no reply and does not affect the following line.',
      'R5: no function called from the main loop blocks.',
    ],
    security: [
      'S1: the correct PIN is refused during lockout.',
      'S2: PIN comparison time does not depend on how many leading characters are correct.',
      'S3: no input sequence writes outside any buffer (checked under ASan/UBSan on the host).',
      'S4: a corrupted state variable results in the LOCKED state.',
    ],
  },
  rubric: [
    { criterion: 'Host tests', points: 20, evidence: '`make test` output ending in ALL TESTS PASSED, built with sanitizers.' },
    { criterion: 'Architecture reading', points: 15, evidence: 'Notebook answers for part 2: T/U/b symbols classified by layer; predicted and measured .bss change.' },
    { criterion: 'Sanitizer report interpretation', points: 15, evidence: 'The report from part 3a with the faulting line, the array and the index identified.' },
    { criterion: 'Test-first feature', points: 25, evidence: 'The failing test output before implementation, then the passing run; an accessor in lock.h instead of direct struct access; a boundary test for the number formatter.' },
    { criterion: 'Bench-MCU port', points: 25, evidence: 'All four C-lab tests pass with the portable section unmodified.' },
  ],
};

export default [lab];
