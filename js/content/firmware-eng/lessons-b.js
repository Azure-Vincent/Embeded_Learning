// Firmware engineering, part B: hardware abstraction, drivers, architecture.
// Code blocks marked host-tested are verbatim copies of files that were compiled and run (see examples/firmware-eng).
import { clFakeHal, clTimeout, clUartTx, clI2cSensor, clImageHeader } from './clabs.js';

const C = String.raw;

/* ============================================================== 4. HAL */
const hal = {
  id: 'fw-hal', title: 'Hardware abstraction layers', minutes: 50,
  summary: 'Where to draw the line between logic and hardware, two ways to implement the boundary in C, and how the same application runs on a PC, a fake and a microcontroller.',
  skills: ['fw-hal-design', 'fw-host-test'],
  blocks: [
    `## The problem

Your door-lock firmware works on an ESP32. Two things happen in the same month:

- The eCTF target for the year is a different chip (it has changed from the MAX78000FTHR in 2024–2025 to the TI MSPM0L2228 in 2026). Register names, SDK functions, pin numbers and the UART API are all different.
- A bug report arrives: "after about seven weeks of uptime the lock opened and stayed open". You cannot wait seven weeks for each test.

If the lock logic calls \`gpio_set_level()\` and \`esp_timer_get_time()\` directly, both problems are hard: porting means editing every file, and testing means a board, a serial cable and a calendar.

If the logic only ever calls five functions *you* defined, both are easy. Porting means rewriting those five. Testing means implementing them on a PC, where "seven weeks" is one assignment to a variable.

That set of functions is a **hardware abstraction layer (HAL)**.`,

    `## What a HAL is

A HAL is an **interface**: a header file declaring what the application needs from the hardware, written in the application's terms. Behind it sit one or more **implementations** (also called ports or backends), one per target.

\`\`\`
        application logic          (ring buffer, parser, state machine: no hardware)
   ───────────── hal.h ─────────────   the interface: 5 function declarations
   hal_esp32.c │ hal_benchmcu.c │ hal_posix.c │ hal_fake.c      one is linked in
\`\`\`

The complete interface of this section's example:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/include/hal.h (excerpt)',
      code: C`typedef enum { HAL_PIN_LATCH, HAL_PIN_LED, HAL_PIN_COUNT } hal_pin_t;

void     hal_init(void);
bool     hal_uart_read(uint8_t *byte);         /* true if a byte was fetched; never blocks */
void     hal_uart_write(uint8_t byte);         /* may wait for the transmitter, bounded    */
uint32_t hal_millis(void);                     /* monotonic, wraps after 2^32 ms           */
void     hal_gpio_write(hal_pin_t pin, bool level);`,
      explain: [
        { lines: '1', md: 'Pins are named by **role** (`HAL_PIN_LATCH`), not by number. Which physical pin the latch is on is the port\'s business. The application cannot even express "GPIO 32".' },
        { lines: '4', md: '`hal_uart_read` never blocks: it returns false when nothing is waiting. The contract is in the comment because the type cannot express it. A port that blocks here would freeze the whole application.' },
        { lines: '6', md: 'Time is exposed as "milliseconds since boot, wrapping", the one thing the lock logic needs. Not a timer handle, not a prescaler.' },
      ] },

    `### What to abstract, and what not to

A HAL earns its keep by being **small**. Decide what goes in it with three questions:

| Question | If yes | Example |
|---|---|---|
| Does the application's *logic* need it? | Put the need, not the mechanism, in the interface | "write the latch" yes; "set pin drive strength" no |
| Does it differ between targets? | It belongs behind the interface | UART registers, clock setup, pin numbers |
| Is it the same everywhere? | It is not hardware: keep it above the HAL | CRC calculation, parsing, state machines |

What does **not** belong in the application-facing HAL:

- **One-time configuration** such as clock trees, pin multiplexing and baud rates. That happens inside \`hal_init()\` and is different on every chip. Trying to make "configure a UART" portable produces a struct with forty fields that no two chips interpret the same way.
- **Every feature of every peripheral.** Abstract what you use. An interface designed for hypothetical future needs is always wrong about them.
- **Timing-critical inner loops.** If a bit-banged protocol needs 200 ns edges, the loop lives in the port.`,
    { t: 'callout', kind: 'note', title: 'HAL, BSP and driver: three words used loosely', md: `Vendors call their peripheral libraries "HAL" (STM32 HAL, ESP-IDF's \`hal\` component, TI DriverLib, the MSDK peripheral drivers). Those abstract over *one vendor's chip family*. The HAL in this lesson is **yours**: it abstracts over vendors, and on each target it is implemented *using* that vendor's library. A **BSP** (board support package) describes one board: which pin is the LED, which UART is the console. The MSDK's \`FTHR_RevA\` board files are a BSP: they record, for example, that the Feather's console is UART0 at 115200 and its RGB LED is on P2.0–P2.2, active low.` },

    `## Two ways to implement the boundary in C

### Link-time substitution

Declare plain functions in \`hal.h\`. Provide several \`.c\` files that each define all of them. The **build system** chooses which one to compile and link. This is what the example's Makefile does:

\`\`\`make
# The application test links the real application against the fake HAL.
$(BUILD)/test_app: tests/test_app.c $(APP) port/hal_fake.c | $(BUILD)

# Same application sources, different HAL: link-time substitution.
$(BUILD)/doorlock: $(APP) port/hal_posix.c port/main_posix.c | $(BUILD)
\`\`\`

\`$(APP)\` is the same four source files in both rules. Only the last file changes.

### A table of function pointers

Put the operations in a struct and pass a pointer to it:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'A HAL as a table of function pointers: two backends in one program.',
      code: C`#include <stdint.h>
#include <stdio.h>

/* Interface: a table of operations. One instance per backend. */
typedef struct {
    void     (*uart_write)(uint8_t byte);
    uint32_t (*millis)(void);
} hal_ops_t;

/* The application receives the table; it never names a backend. */
static void app_greet(const hal_ops_t *hal)
{
    const char *msg = "ready\n";
    while (*msg != '\0') hal->uart_write((uint8_t)*msg++);
}

/* Backend A: the host's stdout. */
static void host_uart_write(uint8_t byte) { putchar(byte); }
static uint32_t host_millis(void) { return 0; }
static const hal_ops_t host_hal = { host_uart_write, host_millis };

/* Backend B: a recorder for tests. */
static char rec[16];
static unsigned rec_len;
static void rec_uart_write(uint8_t byte) { if (rec_len < sizeof rec - 1) rec[rec_len++] = (char)byte; }
static const hal_ops_t rec_hal = { rec_uart_write, host_millis };

int main(void)
{
    app_greet(&host_hal);                 /* both backends in ONE program, chosen at run time */
    app_greet(&rec_hal);
    printf("recorded %u bytes\n", rec_len);
    return 0;
}`,
      explain: [
        { lines: '5-8', md: 'The struct is the interface. Each member is the address of a function with a fixed signature.' },
        { lines: '14', md: '`hal->uart_write(...)` loads the function address from the table and makes an indirect call. On Cortex-M that is a load plus `blx`: a few cycles more than a direct call, and the compiler cannot inline through it.' },
        { lines: '20', md: 'A `const` table lives in flash. That matters for security as well as RAM: a table in RAM is a set of function pointers an attacker with a memory-write bug can redirect.' },
      ] },
    { t: 'callout', kind: 'decision', title: 'Which one?', md: `**Link-time substitution** is the default for firmware: zero run-time cost, direct calls the compiler can inline, no pointers to corrupt, and a missing function is a link error instead of a NULL call. Its limit: one implementation per program.

**Function-pointer tables** are for when one image needs several implementations *at the same time*: two I2C buses with different hardware behind the same sensor driver, or a storage layer over both internal flash and an SD card. Drivers for bus devices almost always take a bus object for that reason (next lesson).

Avoid the third way, \`#ifdef TARGET_ESP32\` scattered through application code. Every new target touches every file, and no single build ever compiles all the branches, so they rot.` },

    `## Worked example: one application, four backends

\`examples/firmware-eng/port/\` contains four implementations of the same five functions:

| File | Target | UART | Time | Status |
|---|---|---|---|---|
| \`hal_fake.c\` | unit tests | scripted input, recorded output | a variable the test sets | host-tested (\`make test\`) |
| \`hal_posix.c\` | a PC program | non-blocking stdin / stdout | \`clock_gettime\` | host-tested (\`make demo\`) |
| \`hal_benchmcu.c\` | Bench-MCU | UART0 registers | TIMER0 expiry flag | compiled on the host (\`make port-check\`); runs in the C lab |
| \`hal_esp32.c\` | ESP32, ESP-IDF | IDF UART driver | \`esp_timer_get_time\` | compiled for the \`esp32\` target with ESP-IDF v6.1; not run on a board |

Here is the heart of the fake, the one you will use most:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/port/hal_fake.c (excerpt): inputs are scripted, outputs recorded, time is a variable.',
      code: C`void hal_init(void) { }

bool hal_uart_read(uint8_t *byte)
{
    if (s_rx_pos == s_rx_len) return false;
    *byte = s_rx[s_rx_pos++];
    return true;
}

void hal_uart_write(uint8_t byte)
{
    assert(s_tx_len + 1u < FAKE_BUF);
    s_tx[s_tx_len++] = (char)byte;
    s_tx[s_tx_len] = '\0';
}

uint32_t hal_millis(void) { return s_now; }

void hal_gpio_write(hal_pin_t pin, bool level)
{
    assert(pin < HAL_PIN_COUNT);
    s_pins[pin] = level;
}`,
      explain: [
        { lines: '3-8', md: 'The "UART" hands out bytes a test pushed earlier, and reports no data when they run out: the same contract as the real port.' },
        { lines: '10-15', md: 'Transmitted bytes are appended to a string the test can compare. The `assert` guards the fake itself: test tooling that silently overflows would produce confusing failures.' },
        { lines: '17', md: 'Time does not pass by itself. A test advancing it by 30 000 ms takes nanoseconds.' },
      ] },
    `And a test that uses it. Read it as a specification of the product:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/tests/test_app.c (excerpt)',
      code: C`static void test_wrong_pin_three_times_locks_out(void)
{
    start();
    send("PIN 0000\n");  CHECK_STR(fake_tx(), "DENIED\n");
    send("PIN 1111\n");  CHECK_STR(fake_tx(), "DENIED\n");
    send("PIN 2222\n");  CHECK_STR(fake_tx(), "LOCKOUT\n");
    CHECK(fake_pin(HAL_PIN_LED));
    send("PIN 4921\n");  CHECK_STR(fake_tx(), "LOCKOUT\n");   /* right PIN, still refused */
    CHECK(!fake_pin(HAL_PIN_LATCH));
    fake_advance_ms(LOCK_LOCKOUT_MS);
    app_poll();
    CHECK(!fake_pin(HAL_PIN_LED));
    send("PIN 4921\n");  CHECK_STR(fake_tx(), "OK\n");
}`,
      explain: [
        { lines: '4-6', md: 'Each `send` pushes text into the fake UART, runs one `app_poll()` and leaves the reply in `fake_tx()`.' },
        { lines: '8', md: 'The security-relevant line: the correct PIN, during lockout, is refused.' },
        { lines: '10-11', md: 'Thirty seconds pass instantly. On a bench this test would take half a minute per run and nobody would run it.' },
      ] },

    { t: 'predict', q: 'The fake HAL\'s clock starts at 0 for every test. The seven-week bug from the start of this lesson concerns the millisecond counter wrapping at 2³². Which fake-HAL capability lets a test reproduce it in microseconds?',
      choices: [
        { t: 'A function that sets the fake clock to any value', ok: true, why: 'With `fake_set_ms(0xFFFFF000)` the test starts just before the wrap, unlocks, advances past it and checks that the relock still happens at the right time.' },
        { t: 'A loop that advances the fake clock one millisecond at a time, 4 billion times', why: 'Advancing one millisecond per iteration would work in principle and take minutes per test; the fake can simply be told what time it is.' },
        { t: 'It cannot be tested on a host, because host integers are 64-bit', why: 'The code uses `uint32_t`, which is exactly 32 bits on every platform, so the wrap happens identically on the host.' },
      ],
      reveal: '`tests/test_lock.c` contains exactly this test (`test_timeout_across_counter_wrap`). It starts at `0xFFFFF000`, crosses the wrap, and passes because `lock.c` compares times with a wrapped subtraction.' },

    { t: 'widget', name: 'c-lab', props: clFakeHal },
    { t: 'callout', kind: 'mistake', title: 'A fake that is kinder than the hardware', md: `If the fake UART never reports "no data", never drops a byte and transmits instantly, the application is only tested against a device that does not exist. A fake must honour the **contract** of the interface, including the awkward parts: "read may return false", "write may take time", "time wraps". The best fakes also let a test *inject* faults: make the next write fail, deliver bytes one at a time, jump the clock.` },
    { t: 'callout', kind: 'security', md: `A HAL is also a security boundary you can review. If the only way to drive the latch is \`hal_gpio_write(HAL_PIN_LATCH, …)\`, then a search for that one call shows every place the door can open (in the example: exactly one line in \`app.c\`). When any file can write any GPIO register, that question has no short answer.` },

    { t: 'exercise', prompt: `**Design exercise: where does the boundary go, and how is it implemented?** A battery-powered soil sensor measures moisture, shows it on a small display and sends it by radio once a minute. Version 1 uses an analogue probe on an ADC pin; version 2 will use a digital probe on I2C. The firmware must be unit-tested on a PC.

Three interfaces have been proposed for the measurement:

- **A** \`uint16_t hal_adc_read(uint8_t channel);\` and the application converts counts to percent.
- **B** \`bool hal_moisture_permille(uint16_t *out);\` returning false if no valid reading is available.
- **C** \`#ifdef PROBE_ANALOG … #else … #endif\` around the measurement code in the application.

Choose one, and choose link-time substitution or a function-pointer table to implement it. Justify both choices by saying what breaks, and when, with the options you rejected.`,
      hints: [
        'What does the *application* need to know: a voltage, or how wet the soil is? Which of the three keeps working unchanged when the probe changes?',
        'Think about failure. An I2C probe can be unplugged or not acknowledge. Which signatures can report that, and what would the others return instead?',
        'For the implementation: does one firmware image ever contain both probes at once? If not, what does a table of function pointers buy, and what does it cost in RAM, speed and attack surface?',
      ],
      solution: `**Interface B, by link-time substitution.**

- **A** exports the mechanism. The calibration from ADC counts to moisture belongs to one particular probe, so it ends up in the application; version 2 has no ADC channel to read, and the application has to be rewritten exactly where it should have been stable. It also cannot say "no reading": a missing probe returns some number that looks like dry soil.
- **C** works on the day it is written. But each build compiles only one branch, so the other rots unnoticed; a third probe touches every \`#ifdef\`; and the host test has to pick one branch, so the other is never tested.
- **B** states the need in the application's units and can fail. Each port (analogue, I2C, and the fake for tests) hides its own conversion. The fake can return any value, or false, on demand, which is how the "probe unplugged" path gets tested.

**Link-time substitution** because one image contains exactly one probe: calls are direct, a missing implementation is a link error, and there is no pointer table in memory to corrupt. A **function-pointer table** would be the right answer only if a single image had to support both probes at once and pick one at run time (for example by detecting which is fitted at boot); you would then pay an indirect call and a NULL check per use.

What decides it is the question "what changes independently of what?" The probe changes; the meaning of "moisture" does not. The boundary goes between them.` },

    `## Harder application

The lock gains a keypad read over I2C and must store the bad-attempt counter in non-volatile memory so that power-cycling does not reset the lockout. Design the additions to \`hal.h\`: write the function declarations and, for each, one comment line stating its contract (blocking? units? what can fail?). Then decide what the fake needs so that a test can (a) simulate a power cycle and (b) simulate a write to non-volatile memory that fails.

Things to check in your answer: Did "I2C" appear in the application-facing interface, or did you abstract the *keypad* ("is a key waiting, and which")? Does your storage function return a status? Can the fake keep its storage across \`app_init()\` so that a "reboot" is just a second call to it?`,
    { t: 'refs', items: [
      { title: 'ESP-IDF Programming Guide: UART driver', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/uart.html' },
      { title: 'Analog Devices MSDK: FTHR_RevA board.h (a board support package)', url: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/Boards/MAX78000/FTHR_RevA/Include/board.h' },
      { title: 'GNU Make manual', url: 'https://www.gnu.org/software/make/manual/make.html' },
    ] },
  ],
  quiz: [
    { q: 'Which declaration belongs in an application-facing HAL for a thermostat?', kind: 'arch', choices: [
      { t: '`int32_t hal_temperature_millic(void);`', ok: true, why: 'It states what the application needs (a temperature, with units) and leaves the sensor type, bus and conversion to the port.' },
      { t: '`void hal_i2c1_write_reg(uint8_t addr, uint8_t reg, uint8_t val);`', why: 'It names a specific bus instance and a register-level operation. A target with an analogue sensor on an ADC could not implement it.' },
      { t: '`void hal_set_gpio_alternate_function(int port, int pin, int af);`', why: 'Pin multiplexing is one-time, chip-specific configuration. It belongs inside the port\'s init, not in what the logic can call.' },
      { t: '`uint32_t hal_read_register(uint32_t address);`', why: 'This exports the hardware wholesale instead of abstracting it; application code using it is tied to one chip\'s register map.' },
    ] },
    { q: 'With link-time substitution, what happens if a port forgets to implement `hal_millis()`?', kind: 'code', choices: [
      { t: 'The build stops at the link with "undefined reference to `hal_millis`"', ok: true, why: 'The application\'s object file contains an unresolved symbol and no linked object defines it. The error appears at build time, which is the safest possible moment.' },
      { t: 'The program crashes at run time when the function is called', why: 'That is the failure mode of a function-pointer table with a NULL entry. A missing plain function cannot get past the linker.' },
      { t: 'The compiler substitutes a default returning 0', why: 'C has no default implementations; a declared but undefined function is an error at link time (weak symbols are an explicit opt-in).' },
    ] },
    { q: 'Why is a fake HAL with a controllable clock more useful for testing timeouts than a real board?', kind: 'concept', choices: [
      { t: 'Tests can set time to any value instantly and repeatably, even across the counter wrap', ok: true, why: 'Determinism and speed: a 30-second lockout or a 49-day wrap is one assignment, and the outcome does not depend on scheduling or bench conditions.' },
      { t: 'The PC clock that drives the fake is far more accurate than an MCU crystal', why: 'Accuracy is irrelevant; the fake does not use the PC clock at all. Its value is that time is under the test\'s control.' },
      { t: 'A real board cannot run a timeout of more than a few seconds without its watchdog resetting it', why: 'Boards run long timeouts fine; what is impractical is waiting for them in every test run.' },
    ] },
    { q: 'A sensor driver must work on two I2C buses in the same firmware, one hardware I2C and one bit-banged. Which technique fits?', kind: 'arch', choices: [
      { t: 'Pass the driver a bus object containing function pointers', ok: true, why: 'Two implementations must coexist in one image and be selected per device instance, which is what a run-time table provides.' },
      { t: 'Link-time substitution: build the driver once and link both bus files', why: 'The linker can bind each function name to only one definition per image, so both buses could not be present together.' },
      { t: '`#ifdef` around each bus call in the driver, selecting the bus per build', why: 'A compile-time switch also selects one implementation for the whole build, and it scatters target knowledge through the driver.' },
    ] },
    { q: 'Application code contains `#ifdef CONFIG_IDF_TARGET_ESP32 … #else … #endif` in eleven places. What is the main maintenance problem?', kind: 'arch', choices: [
      { t: 'No build compiles every branch, so the untested ones rot unnoticed', ok: true, why: 'Conditional compilation multiplies the code variants while each build only checks one of them. A HAL confines the differences to one file per target.' },
      { t: 'Each `#ifdef` is evaluated at run time, so eleven of them slow the firmware down', why: 'Conditional compilation is resolved before the compiler proper runs and has no run-time cost. The cost is in human maintenance and untested code.' },
      { t: '`#ifdef` on a `CONFIG_` symbol is not valid C11 and only works with GCC', why: 'It is standard C. The objection is to where it is used, not to its legality.' },
    ] },
    { q: 'In the example\'s `hal.h`, why is the pin type an enum of roles (`HAL_PIN_LATCH`) instead of an integer pin number?', kind: 'security', choices: [
      { t: 'The application cannot name a pin it has no business driving, and each board maps roles to pins', ok: true, why: 'A role enum narrows what the logic can do to what it should do, and moves board knowledge into the port.' },
      { t: 'An enum is passed in a register, so it is faster than an integer pin number', why: 'They compile to the same integer operations. The benefit is in what the interface permits, not in speed.' },
      { t: 'GPIO numbers above 31 do not fit in an `int`, so chips with more pins need a different type', why: 'They fit easily. The design reason is restricting and decoupling, not range.' },
    ] },
  ],
};

/* ============================================================== 5. Drivers */
const drivers = {
  id: 'fw-drivers', title: 'Device drivers', minutes: 65,
  summary: 'The anatomy of a driver, how blocking, interrupt-driven and DMA designs differ, and the habits that make one trustworthy: status codes, timeouts on every wait, and a stated reentrancy rule.',
  skills: ['fw-driver-write'],
  blocks: [
    `## The problem

A temperature logger hangs about once a week. The debugger shows the program counter inside this loop:

\`\`\`c
while (!(I2C_STATUS & I2C_DONE)) { }      /* wait for the transfer to finish */
\`\`\`

The sensor's cable was bumped, a clock edge was lost, and the I2C peripheral is waiting for an acknowledgement that will never come. The loop has no other exit. One flaky connector has turned a missing reading into a dead product.

A **driver** is the code that owns a peripheral or an external device. Its job is not only to make the hardware work when everything is fine, but to give the rest of the firmware an honest answer when it is not.`,

    `## Anatomy of a driver

Almost every driver has the same parts:

| Part | Purpose | Typical signature |
|---|---|---|
| **init** | Bring the hardware to a known state; may fail | \`status_t dev_init(const dev_config_t *cfg)\` |
| **configure** | Change settings after init | \`status_t dev_set_rate(uint32_t hz)\` |
| **read / write** | Move data | \`status_t dev_read(uint8_t *buf, size_t len, uint32_t timeout_ms)\` |
| **control** | Everything else: flush, sleep, query status. The Unix name for this catch-all is *ioctl* | \`status_t dev_control(dev_cmd_t cmd, void *arg)\` |
| **interrupt handler** | Service the hardware promptly; private | \`void dev_irq_handler(void)\` |
| **private state** | Buffers, flags, counters: \`static\` in the \`.c\` file | not in the header |

Two kinds of driver appear in every project:

- A **peripheral driver** talks to registers of the MCU itself (UART, ADC, timer).
- A **device driver** (bus-device driver) talks to an external chip *through* a peripheral driver (a temperature sensor over I2C, a flash chip over SPI). It knows the device's registers and protocol; it must not know which pins or which bus instance carry them.`,

    `## Worked example: a register-level ADC driver for Bench-MCU

Bench-MCU's ADC has three registers (see \`docs/BENCH_MCU.md\`): \`ADC_CTRL\` (bit 0 \`START\`, bits 4–7 channel), \`ADC_STATUS\` (bit 0 \`DONE\`) and \`ADC_DATA\` (12-bit result). A complete driver:`,
    { t: 'code', lang: 'c', status: 'interp', caption: 'A polling ADC driver for Bench-MCU. Run in the course interpreter with two queued samples (2048, 100); it printed status 0 with those values, then −1 for each bad argument.',
      code: C`#include <stdint.h>
#include <stdio.h>

/* ---- adc.h: the driver's public interface ---- */
typedef enum { ADC_OK = 0, ADC_ERR_ARG = -1, ADC_ERR_TIMEOUT = -2, ADC_ERR_BUSY = -3 } adc_status_t;

void         adc_init(void);
adc_status_t adc_read(uint8_t channel, uint16_t *out);

/* ---- adc.c: private to the driver ---- */
#define ADC_START        (1u << 0)
#define ADC_CH_SHIFT     4u
#define ADC_CH_MASK      (0xFu << ADC_CH_SHIFT)
#define ADC_DONE         (1u << 0)
#define ADC_MAX_CHANNEL  15u
#define ADC_POLL_LIMIT   100u

static uint8_t s_busy;                 /* reentrancy guard: one conversion at a time */
static uint32_t s_timeouts;            /* diagnostics */

void adc_init(void)
{
    ADC_CTRL = 0u;                     /* known state: no conversion, channel 0 */
    s_busy = 0u;
    s_timeouts = 0u;
}

adc_status_t adc_read(uint8_t channel, uint16_t *out)
{
    uint32_t polls = ADC_POLL_LIMIT;

    if (out == NULL || channel > ADC_MAX_CHANNEL) return ADC_ERR_ARG;
    if (s_busy) return ADC_ERR_BUSY;
    s_busy = 1u;

    ADC_CTRL = ((uint32_t)channel << ADC_CH_SHIFT) | ADC_START;   /* select channel, start */

    while ((ADC_STATUS & ADC_DONE) == 0u) {                       /* wait, with a way out */
        if (polls == 0u) {
            s_timeouts++;
            s_busy = 0u;
            return ADC_ERR_TIMEOUT;
        }
        polls--;
    }

    *out = (uint16_t)(ADC_DATA & 0x0FFFu);                        /* 12-bit result */
    s_busy = 0u;
    return ADC_OK;
}

/* ---- application ---- */
int main(void)
{
    uint16_t raw = 0;
    adc_status_t st;

    adc_init();
    st = adc_read(3u, &raw);
    printf("ch3: status=%d raw=%u\n", (int)st, (unsigned)raw);
    st = adc_read(0u, &raw);
    printf("ch0: status=%d raw=%u\n", (int)st, (unsigned)raw);
    st = adc_read(16u, &raw);
    printf("ch16: status=%d\n", (int)st);
    st = adc_read(1u, NULL);
    printf("null: status=%d\n", (int)st);
    return 0;
}`,
      explain: [
        { lines: '5', md: 'One status type for the whole driver. Zero is success; each failure has its own negative value so the caller can tell "you called me wrongly" from "the hardware did not answer".' },
        { lines: '11-16', md: 'Bit positions and limits are named once. `ADC_CH_MASK` documents the field even though this function builds the whole register value.' },
        { lines: '18', md: 'Private state is `static`: invisible outside this file. Nothing else can set `s_busy`.' },
        { lines: '32', md: 'Arguments are validated before any register is touched. A channel of 16 shifted into the register would spill into bit 8.' },
        { lines: '33-34', md: 'The reentrancy guard. If an interrupt handler calls `adc_read` while the main loop is in the middle of a conversion, it gets `ADC_ERR_BUSY` instead of restarting the converter under the first caller. (On a real target the test-and-set of `s_busy` would itself need to be atomic: do it with interrupts masked.)' },
        { lines: '36', md: 'One write selects the channel and sets START. Writing the whole register is deliberate: there are no other bits to preserve, and a single store cannot be interrupted halfway.' },
        { lines: '38-45', md: 'The wait has a budget. On timeout the driver counts the event, releases the guard and reports. Every exit path clears `s_busy`: forgetting that on an error path locks the driver for ever.' },
        { lines: '47', md: 'Mask to 12 bits. If reserved upper bits ever read non-zero, they do not leak into the result.' },
      ] },

    `### Blocking, interrupt-driven, DMA

The same peripheral can be driven three ways. The difference is who waits.

| Style | How it works | CPU while waiting | Use when |
|---|---|---|---|
| **Blocking (polling)** | Start the operation, loop on the status flag | Stuck in the loop | Start-up code, very short operations (an ADC conversion of a few µs), early bring-up |
| **Interrupt-driven** | Start it and return; the peripheral's interrupt delivers each byte or the completion | Free | Anything that takes longer than you can afford to stall: UART at any speed, I2C, slow ADCs |
| **DMA** | Hardware copies data between peripheral and RAM by itself; one interrupt at the end (or half-way) | Free, and not interrupted per byte | High data rates: audio, fast SPI, UART above a few hundred kbaud |

Interrupt-driven and DMA drivers are **asynchronous**: the call returns before the work is done. The driver then needs a way to report completion: a callback, a flag the main loop polls, or an RTOS semaphore or queue. That is state, so an asynchronous driver is a small state machine (idle → busy → done / error).`,
    { t: 'code', lang: 'c', status: 'pseudo', caption: 'Shape of an interrupt-driven UART receive path: the ISR is the ring buffer\'s producer.',
      code: C`/* Called by hardware when a byte has arrived. Keep it short. */
void uart0_rx_isr(void)
{
    uint32_t status = UART_STATUS;            /* read status once */
    if (status & UART_RX_OVERRUN) s_overruns++;
    while (UART_STATUS & UART_RX_AVAIL) {     /* drain everything that is there */
        uint8_t b = (uint8_t)UART_DATA;       /* reading DATA clears the request */
        (void)rb_put(&s_rx_fifo, b);          /* producer side; full = counted drop */
    }
}

/* Called from the main loop. Never waits. */
bool uart0_read_byte(uint8_t *out)
{
    return rb_get(&s_rx_fifo, out);           /* consumer side */
}`,
      explain: [
        { lines: '5', md: 'An overrun means bytes were lost *in the hardware*, before the ISR ran. Counting it separately from FIFO drops tells you which of two different problems you have: interrupts masked too long, or the main loop too slow.' },
        { lines: '6-9', md: 'Drain in a loop: several bytes may be waiting, and leaving one behind can mean no further interrupt on some UARTs.' },
      ] },

    `### The five rules

**1. Every function that can fail returns a status, and callers check it.** \`void\` is for functions that cannot fail. If \`init\` can fail (device absent, wrong ID), it returns a status.

**2. Every wait has a timeout.** No \`while (!flag) {}\` without a second exit. This applies to polling loops, to waiting for an interrupt-set flag, and to RTOS calls (\`portMAX_DELAY\` is a hang with a nicer name).

**3. Outputs are untouched on failure.** If \`adc_read\` fails, \`*out\` keeps its old value. Half-written results get used.

**4. State the reentrancy rule.** For each function, say whether it may be called from an ISR, from several tasks, or only from one context, and enforce what you can (a busy flag, a mutex).

**5. Validate what comes from outside**: arguments from callers, lengths and IDs from devices. A device on a bus is outside.`,
    { t: 'widget', name: 'c-lab', props: clTimeout },
    { t: 'predict', q: 'A UART transmit function writes each byte to the data register without checking the transmitter-ready flag. It is asked to send `"HELLO\\r\\n"` at 115200 baud on a CPU that executes millions of instructions per second. What appears on the wire?',
      choices: [
        { t: 'Only some of the bytes: a write during the previous byte\'s shifting is lost', ok: true, why: 'One byte takes about 87 µs to send. The loop writes the next one within a microsecond or so, long before the shift register is free.' },
        { t: 'All bytes, because a UART queues every byte written to its data register', why: 'A UART without a FIFO has room for one byte in flight (plus at most one holding register). Even with a hardware FIFO, an unchecked loop overruns it once the message is longer than the FIFO.' },
        { t: 'All bytes, but squeezed together at a higher baud rate than the one that was configured', why: 'The baud rate comes from the divisor register and does not depend on how fast the software writes.' },
        { t: 'Nothing at all: the first collision makes the transmitter shut down', why: 'The first write finds the transmitter idle and is sent normally, and a collision does not disable anything; it is the following bytes that are affected.' },
      ],
      reveal: 'The symptom on a terminal is a message with letters missing (`HLO`), which people often misdiagnose as a baud-rate or wiring problem. Now write the driver properly:' },
    { t: 'widget', name: 'c-lab', props: clUartTx },
    { t: 'callout', kind: 'mistake', title: 'Returning an error that nobody reads', md: `\`sensor_read(&t);\` with the return value ignored, followed by code that uses \`t\`. On a failed read \`t\` is whatever was there before, often a plausible old temperature, so the system runs on stale data and looks healthy. Build with \`-Wall -Wextra\`, mark status-returning functions \`__attribute__((warn_unused_result))\` (GCC and Clang), and treat the warning as an error.` },

    `## A bus-device driver layered on an I2C HAL

A device driver's inputs are a **bus** and an **address**. It turns "read the temperature" into bus transactions and bus bytes into engineering units. The bus is passed in as an object, so the same driver source serves two sensors on two different buses, and a test can hand it a fake bus.

You can see what a register read looks like on the wire here: start, address + write, register number, repeated start, address + read, data bytes, stop.`,
    { t: 'widget', name: 'i2c-visualizer', props: { device: 'tmp102' }, caption: 'The I2C transaction a temperature-sensor driver issues for one reading.' },
    { t: 'widget', name: 'c-lab', props: clI2cSensor },
    { t: 'callout', kind: 'decision', title: 'Where does unit conversion belong?', md: `In the device driver. Raw counts are meaningful only together with the device's datasheet, and the driver is the one place that has read it. The application should see \`int32_t\` milli-degrees, not a 12-bit left-justified two's-complement value. Use integers scaled to the smallest unit you need (m°C, mV, µA); floating point costs code size and, on cores without an FPU such as the Cortex-M0+ in the MSPM0L2228 (built with \`-mfloat-abi=soft\` in the 2026 eCTF reference design), considerable time.` },

    { t: 'exercise', prompt: `**Design exercise: blocking, interrupt-driven or DMA?** For each data path choose a driver style and justify it with a number. Assume a single-core MCU executing roughly 10 million instructions per second, on which taking any interrupt costs about 5 µs of CPU time in total (entry, a short handler, exit).

1. Reading a 12-bit ADC whose conversion takes 2 µs, once every 100 ms, from the main loop.
2. Receiving console commands on a UART at 115200 baud (8N1).
3. Streaming audio samples to an SPI DAC at 2 Mbit/s, continuously.
4. Reading a temperature sensor over I2C at 100 kbit/s: 4 bytes on the bus, once per second, in a superloop whose other duties need service every 1 ms.`,
      hints: [
        'For each path work out two numbers: how long one operation takes, and how many bytes (or events) per second arrive.',
        'An interrupt per byte costs about 5 µs. Multiply by the byte rate: what fraction of each second would the CPU spend in the handler? When the wait is *shorter* than the interrupt overhead, what is the cheapest thing to do?',
        'I2C at 100 kbit/s moves one byte (9 clock periods with its acknowledge bit) in 90 µs. How long does a 4-byte transaction take, and what is the superloop\'s budget?',
      ],
      solution: `1. **Blocking (polling), with a poll limit.** The wait is 2 µs: shorter than the 5 µs it would cost just to take an interrupt, and invisible next to a 100 ms period. An interrupt-driven driver would be slower *and* more complicated.
2. **Interrupt-driven RX into a ring buffer.** 11 520 bytes/s × 5 µs ≈ 58 ms of handler time per second, about 6 % of the CPU in the worst case, and far less for typed commands. Polling from the main loop would lose bytes whenever a pass takes longer than one byte time (87 µs) times the hardware FIFO depth. DMA would work but buys little at this rate and makes "a line has arrived" harder to detect.
3. **DMA.** 2 Mbit/s is 250 000 bytes/s. One interrupt per byte would need 250 000 × 5 µs = 1.25 s of CPU per second: impossible. DMA moves the bytes in hardware and interrupts once per half-buffer, a few hundred times a second.
4. **Interrupt-driven (or a state machine stepped by the I2C interrupt), not blocking.** Four bytes plus addressing is about 0.4–0.5 ms of bus time: half the superloop's 1 ms budget if you block for it, and a hang if the sensor does not answer and there is no timeout. Started from the loop and completed by the interrupt, it costs the loop microseconds. Blocking with a timeout would be defensible only if the 1 ms duty were relaxed.

The method, not the answers, is what transfers: **compare the wait with the cost of an interrupt, and the event rate with the CPU you can spare.**` },

    `## Harder application

Design the driver for an SPI flash chip used to store firmware update images. Write only the header: function names, parameters, the status enum, and a comment on each function giving its blocking behaviour and reentrancy rule.

Constraints to design around: a page program takes on the order of a millisecond and a sector erase tens to hundreds of milliseconds (take the real figures from the part's datasheet, AC characteristics table); the device reports "busy" through a status register you must poll; writes can only clear bits, so a sector must be erased first; and an update must survive power loss at any moment.

Check your design against these questions. Is erase blocking for hundreds of milliseconds, or is there a \`flash_busy()\` poll so the main loop keeps running? What does \`flash_write\` return if the device is still busy, and if the range crosses the end of the chip? Is there a read-back verify? Who is allowed to call it: could the logging module and the updater interleave commands?`,
    { t: 'refs', items: [
      { title: 'SEI CERT C: ERR33-C. Detect and handle standard library errors', url: 'https://wiki.sei.cmu.edu/confluence/display/c/ERR33-C.+Detect+and+handle+standard+library+errors' },
      { title: 'GCC manual: common function attributes (warn_unused_result)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Common-Function-Attributes.html' },
      { title: 'Texas Instruments MSPM0 SDK (DriverLib source and examples)', url: 'https://github.com/TexasInstruments/mspm0-sdk' },
      { title: 'Analog Devices MSDK (peripheral drivers for MAX78000)', url: 'https://github.com/analogdevicesinc/msdk' },
    ] },
  ],
  quiz: [
    { q: 'What is wrong with this driver function?', kind: 'code', code: C`void i2c_wait_done(void)
{
    while ((I2C_STATUS & I2C_DONE) == 0) { }
}`, choices: [
      { t: 'It has no timeout and no way to report failure', ok: true, why: 'The only exit depends on the hardware behaving. A stuck bus, a missing device or a lost clock edge makes the loop infinite, and `void` leaves the caller no way to learn of it.' },
      { t: 'Polling a status register is not allowed; interrupts must be used', why: 'Polling is a legitimate technique for short waits. The defect is the unbounded wait, not the polling.' },
      { t: 'The loop body is empty, so the compiler will remove the loop', why: 'The register is accessed through a `volatile` pointer, so each iteration really reads it; the loop is not removed.' },
      { t: '`== 0` should be `!= 0`', why: 'The loop is meant to continue while DONE is clear; that comparison is as intended.' },
    ] },
    { q: 'An interrupt-driven UART driver and the main loop share a ring buffer. In which function is `rb_put` called?', kind: 'arch', choices: [
      { t: 'In the RX interrupt handler; the main loop only calls `rb_get`', ok: true, why: 'The ISR moves each byte from the hardware into the FIFO immediately; the main loop consumes at its own pace. One writer per index keeps it lock-free.' },
      { t: 'In the main loop, after it has polled the UART and found a byte available', why: 'Then the byte waits in the single hardware register until the main loop gets round to it, which is exactly the overrun the buffer is there to prevent.' },
      { t: 'In both the handler and the main loop, so that no byte can be missed', why: 'Two producers would both write the head index, breaking the single-producer rule and corrupting the buffer.' },
    ] },
    { q: 'When does DMA have a clear advantage over a per-byte interrupt?', kind: 'concept', choices: [
      { t: 'At high data rates, where an interrupt per byte would eat most of the CPU', ok: true, why: 'Each interrupt costs entry, handler and exit time. At hundreds of kilobytes per second that overhead dominates; DMA moves the bytes in hardware and interrupts once per block.' },
      { t: 'Whenever a transfer is longer than a single byte, because DMA costs nothing to set up', why: 'For short, slow transfers the setup cost and complexity of DMA outweigh a handful of interrupts.' },
      { t: 'When the peripheral has no status register for an interrupt handler to read', why: 'DMA is triggered by the same peripheral requests as interrupts; it does not replace status reporting.' },
    ] },
    { q: 'A driver\'s `read` function fails halfway. What should it do with the caller\'s output buffer?', kind: 'concept', choices: [
      { t: 'Leave it as it was, or report how many bytes are valid, and return an error', ok: true, why: 'Callers that mishandle the error then at least operate on old or obviously absent data, and callers that check it know precisely what they have.' },
      { t: 'Fill it with zeros so that no stale data remains, and return success', why: 'Zero is a valid reading for many sensors. Reporting success with invented data hides the failure completely.' },
      { t: 'Leave the partial data in place and return success, since most of the bytes are valid', why: 'The caller would treat a mixture of new and stale bytes as a complete, valid result.' },
    ] },
    { q: 'A temperature driver\'s `init` reads the device\'s ID register and compares it with the expected value. What does this buy you?', kind: 'concept', choices: [
      { t: 'It tells "no device", "bus fault" and "wrong device" apart at start-up', ok: true, why: 'An identity check converts three silent failure modes into explicit error codes at the earliest possible moment.' },
      { t: 'It calibrates the driver to the individual part, which makes readings more accurate', why: 'Accuracy is a property of the sensor and its configuration; the ID check only establishes that the right part is answering.' },
      { t: 'The I2C specification requires an ID read before any other register access', why: 'I2C defines addressing and acknowledgement only. ID registers are a convention of individual devices, and using them is a design choice.' },
    ] },
    { q: 'Why must an ISR-callable driver function not take a mutex?', kind: 'arch', choices: [
      { t: 'The interrupted code may hold the mutex and cannot run to release it until the ISR returns', ok: true, why: 'An ISR cannot block: the holder of the mutex is below it on the same CPU and will not progress, so the wait would never end. RTOSes forbid blocking calls in ISRs for this reason.' },
      { t: 'Taking and releasing a mutex costs too many cycles for the microsecond budget of an interrupt handler', why: 'The issue is not speed but deadlock: waiting in an ISR for a resource owned by interrupted code can never succeed.' },
      { t: 'ISRs run on a separate interrupt core, where the task-level mutex does not exist', why: 'On a single-core MCU the ISR runs on the same CPU, which is exactly why it cannot wait for the code it interrupted.' },
    ] },
  ],
};

/* ============================================================== 6. Architecture */
const arch = {
  id: 'fw-arch', title: 'Modular firmware architecture', minutes: 60,
  summary: 'Layers and the direction dependencies may point, how to keep state out of global-variable soup, when a superloop is enough and when it is not, and firmware-wide policies for errors, assertions, logging and versions.',
  skills: ['fw-architecture'],
  blocks: [
    `## The problem

A firmware project starts as one \`main.c\`. Six months later it is 4000 lines, and these are true:

- \`extern\` declarations of the same forty globals are copied into nine files.
- The display code sets \`uart_busy = 1\` to stop the logger printing during a refresh.
- Nobody dares change the ADC code, because the motor code reads its internal buffer directly.
- Some functions return −1 on error, some return 0, some return 1, and \`flash_write\` returns nothing.

None of these is a bug. Together they mean every change risks breaking something unrelated, and no part can be tested on its own. **Architecture** is the set of rules that prevents this: which code may know about which other code.`,

    `## Layers and the dependency rule

Firmware divides naturally into layers:`,
    { t: 'ascii', text:
`  ┌───────────────────────────────────────────────────────────────┐
  │ Application      what the product does: lock policy, commands │   app.c
  ├───────────────────────────────────────────────────────────────┤
  │ Services         reusable logic, no hardware: ring buffer,    │   ringbuf.c line_rx.c
  │                  parser, state machine, CRC, logging          │   lock.c
  ├───────────────────────────────────────────────────────────────┤
  │ Device drivers   external chips, via a bus interface          │   (tsense.c, flash.c)
  ├───────────────────────────────────────────────────────────────┤
  │ HAL              your interface to the MCU's peripherals      │   hal.h + hal_<target>.c
  ├───────────────────────────────────────────────────────────────┤
  │ BSP              this board: pins, clocks, which UART         │   board.h, pin table
  ├───────────────────────────────────────────────────────────────┤
  │ Vendor SDK / registers   ESP-IDF, MSDK, TI DriverLib, CMSIS   │   not your code
  └───────────────────────────────────────────────────────────────┘
        ▲ calls go DOWN.  Nothing calls UP: lower layers reach upward only
          through callbacks or events that the upper layer registered.`,
      caption: 'Layers of a firmware project, with the files of examples/firmware-eng mapped onto them.' },
    `**The dependency rule:** a file may \`#include\` headers from its own layer and from layers *below* it. Never from above.

Why it matters:

- A lower layer that knows nothing about the application can be reused in the next product and tested alone.
- A change in the application cannot break a driver, because the driver does not contain a single name from the application.
- You can check the rule mechanically: \`grep '#include "app' src/drivers/\` should print nothing.

**How does data flow upward, then?** A UART driver has to tell someone a byte arrived. It must not call \`app_handle_byte()\` by name. Either the upper layer *polls* (\`hal_uart_read\` returns a byte or false), or the upper layer *registers a callback* at init (\`uart_set_rx_handler(my_fn)\`). In both cases the driver only knows a function-pointer type, not who is behind it.`,

    `## Avoiding global-variable soup

A global variable is an interface with no rules: any line in the program may read or write it at any time. Three steps out, in order of preference:

**1. Make it \`static\` in one \`.c\` file.** State belongs to a module. Other modules get functions, not variables.

**2. Expose behaviour, not data.** Instead of \`extern uint32_t rx_dropped;\` offer \`uint32_t app_rx_dropped(void);\`. Readers cannot corrupt it, and you can later change how it is stored.

**3. Put a module's state in a context struct** when there can be more than one instance (two UARTs, three sensors, or a unit test that wants a fresh one):`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/src/app.c (excerpt): module state is file-local; outputs are derived from state in one place.',
      code: C`/* All module state is file-local. Other modules reach it only through app.h. */
static uint8_t   s_rx_storage[APP_RX_FIFO_SIZE];
static ringbuf_t s_rx;
static line_rx_t s_line;
static lock_t    s_lock;

void app_poll(void)
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
        { lines: '2-5', md: '`static` at file scope gives internal linkage: these names do not exist for the linker outside `app.o`. The `nm` output in the next lesson shows them with a lower-case `b`.' },
        { lines: '3-5', md: 'The services (`ringbuf_t`, `line_rx_t`, `lock_t`) are context structs: the service code has no state of its own, so the tests can create as many as they like.' },
        { lines: '13', md: 'The portable pump: on a port with an RX interrupt, the ISR calls `app_on_rx_byte` and `hal_uart_read` simply returns false.' },
        { lines: '21-23', md: 'The only two lines in the application that drive outputs.' },
      ] },
    { t: 'callout', kind: 'mistake', title: 'The "utils.h" that includes everything', md: `A header such as \`common.h\` or \`globals.h\` that every file includes and that declares every shared variable. It removes the compile errors that would have told you about bad dependencies, makes every file depend on every other, and forces a full rebuild on any change. Each module gets its own header containing only what its *users* need.` },

    `### Configuration

Values that differ between products, boards or builds should be found in one place, not sprinkled as literals:

| Kind | Mechanism | Example |
|---|---|---|
| Fixed for a build | \`#define\` or \`static const\` in a config header; \`-D\` from the build system | \`APP_RX_FIFO_SIZE\`, \`LOG_LEVEL\` |
| Per board | The BSP: a \`board.h\` with pin and peripheral assignments | \`LOCK_PIN_LATCH\` |
| Per device (changes in the field) | A versioned, checksummed struct in non-volatile storage | calibration, user PIN |
| Large, structured options | The SDK's configuration system | ESP-IDF's Kconfig (\`sdkconfig\`), TI's SysConfig |

Check configuration at compile time where you can. C11 has \`_Static_assert\`:

\`\`\`c
_Static_assert((APP_RX_FIFO_SIZE & (APP_RX_FIFO_SIZE - 1u)) == 0, "FIFO size must be a power of two");
\`\`\`

A wrong value then fails the build instead of the product.`,

    `## Superloop or RTOS?

The **superloop** is \`for (;;) { poll_a(); poll_b(); poll_c(); }\` with interrupts doing the time-critical capture. An **RTOS** gives each activity its own task and stack and switches between them pre-emptively.`,
    { t: 'callout', kind: 'decision', title: 'How to choose', md: `Stay with a **superloop** while all of these hold: every \`poll\` function is non-blocking; the worst-case time for one full pass is shorter than your tightest *main-loop* deadline (interrupts cover the microsecond-level ones); and the number of activities is small enough to reason about. It needs no kernel, one stack, and its timing is easy to measure: the worst loop time.

Move to an **RTOS** when: activities have very different deadlines (a 1 ms control loop next to a 200 ms flash write); you need blocking-style code for a complex protocol stack; or the vendor's middleware requires it. ESP-IDF applications always run on FreeRTOS: \`app_main\` is itself a task. The price is one stack per task (each needs its own budget from the stack lesson), shared-data hazards between tasks, and new failure modes such as priority inversion and deadlock, which the RTOS section covers.

The modules in this section work in both: \`app_poll()\` is called from a superloop on Bench-MCU and from a FreeRTOS task on ESP32.` },
    { t: 'predict', q: 'A superloop has three poll functions taking 0.2 ms, 0.3 ms and (when it writes a log line to flash) up to 25 ms. UART bytes arrive at 115200 baud and are read by *polling* in the first function, with no RX interrupt and a UART that holds one received byte. What happens during a flash write?',
      choices: [
        { t: 'About 290 bytes arrive during the 25 ms and all but one are lost to overrun', ok: true, why: '11 520 bytes/s × 0.025 s = 288 bytes. With no interrupt and a one-byte receiver, each new byte overwrites the unread one.' },
        { t: 'Nothing is lost: the bytes wait in the UART until the loop comes round to read them', why: 'There is nowhere for them to wait. Without an interrupt-fed FIFO the hardware keeps only the most recent byte.' },
        { t: 'The UART slows the sender down automatically until the loop is reading again', why: 'Only if hardware flow control (RTS/CTS) is wired and enabled, which was not stated. A plain three-wire UART has no back-pressure.' },
      ],
      reveal: 'This is "missed events in a superloop". The cure is one of: capture in an interrupt into a ring buffer sized for the 25 ms (the first lesson\'s calculation: 512 bytes); split the slow operation into steps that each take well under a byte time times the hardware FIFO depth; or move the slow work to a lower-priority RTOS task.' },

    `## An error-handling strategy

Decide once, for the whole firmware, and write it down:

**Expected failures are return values.** A sensor does not answer, a packet has a bad CRC, a command is malformed. These *will* happen in normal operation. Functions return a status; callers check it and decide: retry, report, fall back, or pass it up.

**Programming errors are assertions.** A NULL pointer where the contract forbids one, an index that the caller guaranteed to be in range, a state that cannot occur. These mean the code is wrong. An assertion stops immediately, close to the cause, with a file and line.

**Never use an assertion on outside input.** If an attacker can trigger an assert, they have a reset button. Outside input gets validated and rejected with an error code.

**Define the safe state.** When something unrecoverable happens (assertion, hard fault, stack overflow hook), what do the outputs do? For a lock: latch closed. For a heater: off. Then record why (a reset-reason code in a no-init RAM section or a flash log) and reset or halt.`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'Compile-time log levels, a firmware assert, and the distinction between a caller\'s bad input and an internal bug. Output shown below.',
      code: C`#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

/* ---- log.h ---- */
#define LOG_ERROR 1
#define LOG_WARN  2
#define LOG_INFO  3
#define LOG_DEBUG 4

#ifndef LOG_LEVEL
#define LOG_LEVEL LOG_INFO            /* set per build: -DLOG_LEVEL=LOG_DEBUG */
#endif

/* The comparison is between two constants, so the compiler deletes disabled calls,
 * including their format strings, from the image. */
#define LOG(level, tag, ...) \
    do { if ((level) <= LOG_LEVEL) { printf("[%s] ", (tag)); printf(__VA_ARGS__); printf("\n"); } } while (0)

/* ---- assert.h for firmware ---- */
static void assert_failed(const char *file, int line)
{
    printf("ASSERT %s:%d\n", file, line);   /* target: record file/line, then reset or halt */
    exit(3);
}
#define ASSERT(cond) do { if (!(cond)) assert_failed(__FILE__, __LINE__); } while (0)

/* ---- a module using both ---- */
typedef enum { ERR_OK = 0, ERR_ARG = -1, ERR_RANGE = -2 } err_t;

static uint8_t s_table[4] = { 10, 20, 30, 40 };

/* Internal helper: callers inside this module guarantee idx < 4. A violation is OUR bug. */
static uint8_t table_get(uint32_t idx)
{
    ASSERT(idx < 4u);
    return s_table[idx];
}

/* Public entry point: channel comes from a command line. A bad value is THEIR input. */
static err_t channel_gain(uint32_t channel, uint8_t *gain)
{
    if (gain == NULL) return ERR_ARG;
    if (channel >= 4u) {
        LOG(LOG_WARN, "gain", "channel %lu out of range", (unsigned long)channel);
        return ERR_RANGE;
    }
    *gain = table_get(channel);
    LOG(LOG_DEBUG, "gain", "channel %lu -> %u", (unsigned long)channel, (unsigned)*gain);
    return ERR_OK;
}

int main(void)
{
    uint8_t g = 0;
    err_t rc;
    LOG(LOG_INFO, "app", "start");
    rc = channel_gain(2, &g);
    printf("rc=%d gain=%u\n", (int)rc, (unsigned)g);
    rc = channel_gain(9, &g);
    printf("rc=%d\n", (int)rc);
    (void)table_get(7);                      /* simulate an internal logic error */
    return 0;
}`,
      explain: [
        { lines: '11-13', md: 'The level is chosen per build. `-DLOG_LEVEL=LOG_ERROR` on the compiler command line overrides the default.' },
        { lines: '17-18', md: '`(level) <= LOG_LEVEL` compares two constants, so the optimiser removes the whole statement for disabled levels. In this file, built with `-Os`, the object\'s text section was 234 bytes at `LOG_ERROR` and 497 bytes at `LOG_DEBUG`. The `do { } while (0)` makes the macro behave as one statement after an `if`.' },
        { lines: '21-26', md: 'On a target this handler would put outputs in their safe state, save file and line where they survive a reset, and reset. `__FILE__` strings cost flash; some projects log a numeric module ID instead.' },
        { lines: '34-38', md: 'An internal helper asserts its precondition. If this fires, the module has a bug.' },
        { lines: '41-51', md: 'The public function validates and returns an error. A bad channel number from a command line is a normal event, logged at WARN.' },
      ] },
    `Built with the default level and run, it prints:

\`\`\`
[app] start
rc=0 gain=30
[gain] channel 9 out of range
rc=-2
ASSERT logassert.c:36
\`\`\`

and exits with status 3 from the assert handler.`,
    { t: 'callout', kind: 'security', title: 'Logging and secrets', md: `Debug logs are a classic leak: a log line that prints a received packet prints the PIN inside it, and a UART console left enabled in a release build hands that to anyone with a serial adapter. Decide per level what may be printed, compile \`LOG_DEBUG\` out of release images, and never log keys, PINs or raw authentication data at any level. The course's \`vuln-device\` simulations include devices that fail in exactly this way so you can see it from the attacker's side.` },

    `## Versioning the firmware image

Once more than one device exists you must be able to answer: *exactly which build is running on this unit?* Put the answer in the image:

- A **semantic version** (\`MAJOR.MINOR.PATCH\`) that humans assign.
- The **source revision** (a git commit hash) injected by the build system, so the version can never lie about what was compiled.
- Ideally not the build date: it makes two builds of the same source differ (the reproducible-builds lesson explains why that matters).

An updater or bootloader also needs a machine-readable **image header** at a fixed position: magic number, version, length, integrity check. Field order matters because the struct's in-memory layout *is* the file format. Explore that here, then write the validator.`,
    { t: 'widget', name: 'struct-layout', props: { source: `struct image_header {
    uint32_t magic;
    uint16_t ver_major;
    uint16_t ver_minor;
    uint32_t length;
    uint32_t crc;
};` }, caption: 'The image header packs into 16 bytes with no padding. Try moving a uint16_t between two uint32_t fields and watch padding appear.' },
    { t: 'widget', name: 'c-lab', props: clImageHeader },

    `## Harder application

You inherit a 4000-line \`main.c\` for a battery-powered sensor node: it reads a sensor over I2C every 10 s, keeps a rolling average, sends readings over a radio module on UART, blinks a status LED, and accepts configuration commands over the same UART.

Propose a module breakdown. For each module give: its layer, its public functions (names only), what state it owns, and which other modules it may include. Then answer: which modules can be unit-tested on the host unchanged? What is the smallest HAL that supports them? Where does the conversion from raw sensor counts to physical units happen, and where is the decision "the battery is low, stop transmitting" made?

A sound answer has the averaging filter, command parser and transmit policy as hardware-free services, a sensor driver taking a bus object, and an application that owns the policy decisions. If your design has the sensor driver deciding when to transmit, the dependency arrow is pointing up.`,
    { t: 'refs', items: [
      { title: 'ESP-IDF Programming Guide: Project Configuration (Kconfig)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/kconfig.html' },
      { title: 'SEI CERT C: DCL15-C. Declare file-scope objects or functions that do not need external linkage as static', url: 'https://wiki.sei.cmu.edu/confluence/display/c/DCL15-C.+Declare+file-scope+objects+or+functions+that+do+not+need+external+linkage+as+static' },
      { title: 'Semantic Versioning 2.0.0', url: 'https://semver.org/' },
      { title: 'MISRA C (coding guidelines; the documents are sold by MISRA, context only)', url: 'https://misra.org.uk/' },
    ] },
  ],
  quiz: [
    { q: 'A UART driver file contains `#include "app.h"` so that its ISR can call `app_on_rx_byte()`. What is the architectural objection?', kind: 'arch', choices: [
      { t: 'A lower layer now depends on the application and cannot be reused or tested without it', ok: true, why: 'The dependency arrow points upward. The same effect is achieved without it by having the application register a callback or poll the driver.' },
      { t: 'An ISR is not allowed to call any function defined in another source file', why: 'They may call functions (short, non-blocking ones). The issue is which layer the function\'s name belongs to.' },
      { t: 'Every header a driver includes adds that module\'s declarations to the driver\'s RAM footprint', why: 'A header of declarations adds nothing to RAM. The cost is coupling, not memory.' },
    ] },
    { q: 'Which is the best use of an assertion?', kind: 'code', choices: [
      { t: 'Checking an index that callers inside the module must keep in range', ok: true, why: 'A violated internal precondition is a programming error; stopping at once with file and line is the fastest route to the bug.' },
      { t: 'Checking that a length byte received over UART is within the buffer size', why: 'Received data is outside input and will be wrong sometimes, by accident or on purpose. If that trips an assert, anyone on the wire can reset the device at will.' },
      { t: 'Checking whether an I2C sensor acknowledged its address', why: 'A missing acknowledgement is an expected run-time failure of the environment, to be reported with a status code and handled.' },
      { t: 'Checking that the user typed the correct PIN', why: 'A wrong PIN is ordinary input the product must handle as part of its normal behaviour.' },
    ] },
    { q: 'Why should release builds compile debug logging out, not merely disable it at run time?', kind: 'security', choices: [
      { t: 'The code and its strings are absent from the image, so there is nothing to dump or re-enable', ok: true, why: 'Strings in the image reveal internals to anyone who dumps it, and a run-time switch is one corrupted variable away from turning the leak back on.' },
      { t: 'A run-time check of the log level on every call is too slow for real-time firmware', why: 'A single integer comparison is cheap. The reasons are image size and exposure, not speed.' },
      { t: 'The C standard forbids `printf`-style logging once `NDEBUG` is defined', why: 'The language says nothing about build configurations; this is an engineering policy.' },
    ] },
    { q: 'Module A needs to read module B\'s packet counter. Which interface is best?', kind: 'arch', choices: [
      { t: '`uint32_t b_packet_count(void);` in `b.h`; the counter is `static` in `b.c`', ok: true, why: 'A gets read access only, B keeps the freedom to change the representation, and no other file can modify the counter.' },
      { t: '`extern uint32_t b_packet_count;` in `b.h`; the counter is a global in `b.c`', why: 'Every file that includes the header can now write the counter as well as read it, and its type and atomicity are frozen as part of the interface.' },
      { t: 'Write `extern uint32_t packet_count;` at the top of `a.c`, so that no header is needed', why: 'A private extern bypasses the header, so the compiler cannot check that the declaration matches the definition if either changes.' },
    ] },
    { q: 'A design has a 2 ms motor control loop, a display update taking 30 ms, and a network stack that is written in blocking style. Superloop or RTOS, and why?', kind: 'arch', choices: [
      { t: 'RTOS: the 2 ms loop must pre-empt the 30 ms update, and the network code needs to block', ok: true, why: 'Pre-emption lets the 2 ms loop interrupt the 30 ms update, and separate task stacks let blocking code wait without holding up anything else.' },
      { t: 'Superloop: its fixed calling order is more deterministic, which is exactly what a 2 ms loop needs', why: 'A superloop\'s worst-case latency is the sum of everything else in the loop, here at least 30 ms, which breaks the 2 ms requirement.' },
      { t: 'RTOS: the scheduler makes every activity run faster than it would in a loop', why: 'An RTOS adds context-switch overhead. It improves responsiveness of high-priority work, not raw speed.' },
    ] },
    { q: 'A firmware image header is defined as `struct { uint8_t type; uint32_t length; uint16_t version; }` and written to flash with `memcpy` of the struct. What is the hidden problem on a 32-bit ABI?', kind: 'code', choices: [
      { t: 'Padding: 3 bytes after `type` and 2 at the end, so 12 bytes are stored, some of them unspecified', ok: true, why: 'Natural alignment places `length` at offset 4 and rounds the size up to a multiple of 4. A tool or another compiler that assumes 7 packed bytes will misread every field after the first.' },
      { t: '`memcpy` copies only the first member of a struct; the rest must be copied field by field', why: 'It copies any object byte for byte, all members and the padding included, which is precisely how the gaps end up in flash.' },
      { t: 'On a little-endian CPU the fields are stored in reverse order, `version` first', why: 'Endianness affects the byte order within each multi-byte field, not the order of the fields.' },
    ] },
  ],
};

export default [hal, drivers, arch];
