// Embedded C lab: a register-level GPIO and UART driver for Bench-MCU, built in five tested steps.
import { C, clab, code } from './util.js';

/* Shared source fragments, so each step starts from the previous step's finished code. */
const GPIO_TYPES = C`
typedef enum { GPIO_INPUT = 0, GPIO_OUTPUT = 1 } gpio_dir_t;

#define GPIO_PIN_COUNT 16u
#define LED_PIN    5u      /* LED, lit when the pin is high            */
#define BUTTON_PIN 2u      /* push button to ground: pressed reads 0   */
`;

const GPIO_INIT = C`
static void gpio_init(uint32_t pin, gpio_dir_t dir, bool pullup)
{
    if (pin >= GPIO_PIN_COUNT) {
        return;
    }
    uint32_t mask = 1u << pin;

    if (dir == GPIO_OUTPUT) {
        GPIO_DIR |= mask;
    } else {
        GPIO_DIR &= ~mask;
    }

    if (pullup && dir == GPIO_INPUT) {
        GPIO_PULLUP |= mask;
    } else {
        GPIO_PULLUP &= ~mask;
    }
}
`;

const GPIO_RW = C`
static void gpio_write(uint32_t pin, bool level)
{
    if (pin >= GPIO_PIN_COUNT) {
        return;
    }
    if (level) {
        GPIO_SET = 1u << pin;
    } else {
        GPIO_CLR = 1u << pin;
    }
}

static bool gpio_read(uint32_t pin)
{
    if (pin >= GPIO_PIN_COUNT) {
        return false;
    }
    return (GPIO_IN & (1u << pin)) != 0;
}
`;

const UART_BITS = C`
#define UART_CTRL_EN   (1u << 0)
#define UART_ST_TX_RDY (1u << 0)
#define UART_ST_RX_AVL (1u << 1)
`;

const UART_INIT_PUTC = C`
static void uart_init(uint32_t divisor)
{
    UART_BAUD = divisor;
    UART_CTRL |= UART_CTRL_EN;
}

static void uart_putc(char c)
{
    while ((UART_STATUS & UART_ST_TX_RDY) == 0) {
        /* transmitter busy: wait */
    }
    UART_DATA = (uint8_t)c;
}
`;

const UART_PUTS_HEX = C`
static void uart_puts(const char *s)
{
    while (*s != '\0') {
        uart_putc(*s);
        s++;
    }
}

static void uart_put_hex8(uint8_t value)
{
    static const char digits[] = "0123456789ABCDEF";
    uart_putc(digits[(value >> 4) & 0xFu]);
    uart_putc(digits[value & 0xFu]);
}
`;

const HEAD = C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
`;

/* ---- step 1 ---- */
const step1Main = C`
int main(void)
{
    gpio_init(LED_PIN, GPIO_OUTPUT, false);
    gpio_init(BUTTON_PIN, GPIO_INPUT, true);

    gpio_init(9, GPIO_OUTPUT, false);
    gpio_init(9, GPIO_INPUT, false);      /* reconfigured: must become an input again */
    gpio_init(8, GPIO_INPUT, true);
    gpio_init(8, GPIO_INPUT, false);      /* reconfigured: the pull-up must be off again */
    gpio_init(3, GPIO_OUTPUT, true);      /* a pull-up makes no sense on an output    */
    gpio_init(16, GPIO_OUTPUT, false);    /* there is no pin 16                       */

    printf("DIR=%04X PULLUP=%04X\n", GPIO_DIR, GPIO_PULLUP);
    return 0;
}
`;
const step1 = clab({
  title: 'Step 1: gpio_init',
  prompt: `Implement \`gpio_init(pin, dir, pullup)\`.

- Ignore pin numbers of 16 and above.
- \`GPIO_OUTPUT\` sets the pin's bit in \`GPIO_DIR\`; \`GPIO_INPUT\` clears it.
- Enable the pull-up (bit in \`GPIO_PULLUP\`) only when \`pullup\` is true **and** the pin is an input; otherwise clear it.
- Never disturb the configuration of any other pin.

Expected: \`DIR=0028 PULLUP=0004\`.`,
  starter: HEAD + GPIO_TYPES + C`
static void gpio_init(uint32_t pin, gpio_dir_t dir, bool pullup)
{
    /* TODO */
}
` + step1Main,
  solution: HEAD + GPIO_TYPES + GPIO_INIT + step1Main,
  tests: [{ name: 'direction and pull-up bits for each pin', stdout: 'DIR=0028 PULLUP=0004\n', regs: { GPIO_DIR: 0x28, GPIO_PULLUP: 0x04 }, noWarning: ['bits 16-31', 'write-only'] }],
  hints: [
    'For each of the two registers, list the cases in which the pin\'s bit must end up 1 and the cases in which it must end up 0. Does your code write the bit in every case, including when a pin is configured a second time?',
    'Build `mask = 1u << pin` once, after rejecting `pin >= GPIO_PIN_COUNT`.',
    'Both branches of the direction must be written: `|= mask` for output and `&= ~mask` for input. Otherwise the second call for pin 9 leaves it as an output. The pull-up follows the same set-or-clear pattern, with the condition `pullup && dir == GPIO_INPUT`.',
  ],
  explain: `An init function must handle *re*-configuration, so it clears as well as sets. The range check matters more than it looks: \`1u << 32\` is undefined behaviour, and \`1u << 16\` would write a bit that does not correspond to a pin. On a real chip this is also the function that would enable the port's clock and select the pin's GPIO function first (see the last step).`,
});

/* ---- step 2 ---- */
const step2Main = C`
int main(void)
{
    gpio_init(LED_PIN, GPIO_OUTPUT, false);
    gpio_init(BUTTON_PIN, GPIO_INPUT, true);
    gpio_init(0, GPIO_OUTPUT, false);

    gpio_write(0, true);
    gpio_write(LED_PIN, true);
    gpio_write(LED_PIN, false);
    gpio_write(20, true);                              /* ignored */
    printf("OUT=%04X\n", GPIO_OUT);

    bool pressed = !gpio_read(BUTTON_PIN);             /* active low */
    gpio_write(LED_PIN, pressed);
    printf("pressed=%d led=%d pin0=%d\n", pressed, gpio_read(LED_PIN), gpio_read(0));
    return 0;
}
`;
const step2 = clab({
  title: 'Step 2: gpio_write and gpio_read',
  prompt: `Add the two data functions.

- \`gpio_write(pin, level)\` drives an output pin high or low. Use the \`GPIO_SET\` and \`GPIO_CLR\` registers so that the write is a single store.
- \`gpio_read(pin)\` returns the pin's level from \`GPIO_IN\` as a \`bool\`.
- Both ignore pins 16 and above (\`gpio_read\` returns \`false\`).

The button on pin 2 connects the pin to ground when pressed and relies on the pull-up when released, so it is **active low**. The tests run the program once with the button held and once with it released.`,
  starter: HEAD + GPIO_TYPES + GPIO_INIT + C`
static void gpio_write(uint32_t pin, bool level)
{
    /* TODO */
}

static bool gpio_read(uint32_t pin)
{
    /* TODO */
    return false;
}
` + step2Main,
  solution: HEAD + GPIO_TYPES + GPIO_INIT + GPIO_RW + step2Main,
  tests: [
    { name: 'button held down: LED follows', gpioIn: { value: 0x0000, mask: 0x0004 }, stdout: 'OUT=0001\npressed=1 led=1 pin0=1\n', regs: { GPIO_OUT: 0x21 }, noWarning: ['bits 16-31', 'write-only'] },
    { name: 'button released: pull-up reads high, LED off', gpioIn: { value: 0x0000, mask: 0x0000 }, stdout: 'OUT=0001\npressed=0 led=0 pin0=1\n', regs: { GPIO_OUT: 0x01 }, noWarning: ['bits 16-31', 'write-only'] },
  ],
  hints: [
    'Check the access column of the register table for `GPIO_SET`, `GPIO_CLR` and `GPIO_IN`. Which assignment operator makes sense for a write-only register, and which register tells you the level actually on a pin?',
    '`GPIO_SET = 1u << pin;` sets one output bit; `GPIO_CLR = 1u << pin;` clears one. Plain `=`: these registers ignore the zeros.',
    '`gpio_read` masks `GPIO_IN` with the pin\'s bit and compares the result with 0, so the answer is exactly `true` or `false`. If `pressed` is wrong in the released test, check that the pull-up is enabled: an undriven input without one has no defined level.',
  ],
  explain: `Set/clear registers make \`gpio_write\` safe to call from both the main program and an interrupt handler: there is no read-modify-write to interrupt. \`GPIO_IN\` reports the actual pin level, which for an output pin is the latch value, so \`gpio_read(LED_PIN)\` reads back what was written. The inversion for the active-low button belongs in the caller (or a \`button_pressed()\` helper), not in \`gpio_read\`, which should report the electrical level.`,
});

/* ---- step 3 ---- */
const step3Main = C`
int main(void)
{
    uart_init(104);

    const char msg[] = "Hello\n";
    for (uint32_t i = 0; msg[i] != '\0'; i++) {
        uart_putc(msg[i]);
    }
    printf("BAUD=%u CTRL=%X\n", UART_BAUD, UART_CTRL);
    return 0;
}
`;
const step3 = clab({
  title: 'Step 3: uart_init and uart_putc',
  prompt: `The UART functions below were written quickly. Run the program and look at the UART output: characters are missing.

Two things are wrong:

1. \`uart_init\` is supposed to enable the UART. Work out the value it actually writes to \`UART_CTRL\`.
2. \`uart_putc\` writes to \`UART_DATA\` without waiting for \`TX_READY\` (bit 0 of \`UART_STATUS\`), which goes low for a few ticks after every byte.

Fix both so the UART sends \`Hello\` and a newline, with \`UART_BAUD\` 104 and only the \`ENABLE\` bit set in \`UART_CTRL\`.`,
  starter: HEAD + UART_BITS + C`
static void uart_init(uint32_t divisor)
{
    UART_BAUD = divisor;
    UART_CTRL = UART_CTRL & ~UART_CTRL_EN;       /* "configure" the UART */
}

static void uart_putc(char c)
{
    UART_DATA = (uint8_t)c;
}
` + step3Main,
  solution: HEAD + UART_BITS + UART_INIT_PUTC + step3Main,
  tests: [{ name: 'every byte is transmitted', uartTx: 'Hello\n', stdout: 'BAUD=104 CTRL=1\n', regs: { UART_BAUD: 104, UART_CTRL: 0x1 }, noWarning: ['bits 16-31', 'write-only'] }],
  hints: [
    'Evaluate the right-hand side of the assignment in `uart_init` by hand, starting from the reset value 0. Then read the simulator note under the failed test: it names the condition under which a written byte is thrown away.',
    '`UART_CTRL & ~UART_CTRL_EN` *clears* the enable bit. Transmission is dropped while it is 0. Set it with `|=`.',
    'After enabling, you will see some characters but not all. Each write to `UART_DATA` while the transmitter is busy is lost. Before the store in `uart_putc`: `while ((UART_STATUS & UART_ST_TX_RDY) == 0) { }`.',
  ],
  explain: `A UART shifts a byte out one bit at a time, which takes far longer than the CPU needs to offer the next byte. \`TX_READY\` is the hardware's "I can take another" signal, and the polling loop is the simplest correct way to honour it. The cost is that \`uart_putc\` blocks the CPU while it waits; interrupt-driven transmission with a ring buffer removes that cost and is the natural next refinement.`,
});

/* ---- step 4 ---- */
const step4Main = C`
int main(void)
{
    uart_init(104);
    gpio_init(LED_PIN, GPIO_OUTPUT, false);
    gpio_write(LED_PIN, true);

    uart_puts("boot ok\n");
    uart_puts("");
    uart_puts("OUT=0x");
    uart_put_hex8((uint8_t)GPIO_OUT);
    uart_puts(" id=0x");
    uart_put_hex8(0x0A);
    uart_putc('\n');
    return 0;
}
`;
const step4 = clab({
  title: 'Step 4: uart_puts and uart_put_hex8',
  prompt: `Build two output helpers on top of \`uart_putc\`.

- \`uart_puts(s)\` sends every character of a C string, not including the terminating zero. An empty string sends nothing.
- \`uart_put_hex8(value)\` sends a byte as exactly two upper-case hexadecimal digits (\`0x0A\` → \`0A\`).

Neither may touch the UART registers directly: they call \`uart_putc\`, which already handles the handshake.

Expected UART output: \`boot ok\`, then \`OUT=0x20 id=0x0A\`.`,
  starter: HEAD + GPIO_TYPES + UART_BITS + GPIO_INIT + GPIO_RW + UART_INIT_PUTC + C`
static void uart_puts(const char *s)
{
    /* TODO */
}

static void uart_put_hex8(uint8_t value)
{
    /* TODO */
}
` + step4Main,
  solution: HEAD + GPIO_TYPES + UART_BITS + GPIO_INIT + GPIO_RW + UART_INIT_PUTC + UART_PUTS_HEX + step4Main,
  tests: [{ name: 'strings and hex bytes', uartTx: 'boot ok\nOUT=0x20 id=0x0A\n', noWarning: ['bits 16-31', 'write-only'] }],
  hints: [
    'What marks the end of a C string, and should that byte be transmitted? For the hex function: how many bits does one hex digit stand for, and which of the two digits must be sent first?',
    '`uart_puts` walks the string with the pointer until `*s` is `\'\\0\'`, calling `uart_putc(*s)` and then `s++`. The high digit is `(value >> 4) & 0xF`, the low digit is `value & 0xF`.',
    'Turn a number 0–15 into a character by indexing a table: `static const char digits[] = "0123456789ABCDEF";`.',
  ],
  explain: `Layering keeps the hardware knowledge in one place: only \`uart_putc\` knows about \`TX_READY\`. \`uart_put_hex8\` is the tool you will use most during bring-up, because it prints register values without dragging in \`printf\`, which on a small MCU can cost several kilobytes of flash and a lot of stack. The digit table is \`static const\`, so it lives in flash.`,
});

/* ---- step 5 ---- */
const step5Main = C`
int main(void)
{
    uart_init(104);
    gpio_init(LED_PIN, GPIO_OUTPUT, false);
    gpio_init(BUTTON_PIN, GPIO_INPUT, true);

    uart_puts("ready\n");
    command_loop();
    uart_puts("bye\n");
    return 0;
}
`;
const step5 = clab({
  title: 'Step 5: uart_getc and a command loop',
  prompt: `Finish the driver with a receive function and use everything in a small command interpreter.

\`uart_getc()\` waits until \`RX_AVAIL\` (bit 1 of \`UART_STATUS\`) is set and returns the byte read from \`UART_DATA\`.

\`command_loop()\` reads one character at a time and acts on it until it receives \`q\`:

| Command | Action | Reply |
|---|---|---|
| \`1\` | LED on | \`ok\` |
| \`0\` | LED off | \`ok\` |
| \`t\` | toggle the LED | \`ok\` |
| \`b\` | report the button (active low) | \`pressed\` or \`released\` |
| \`q\` | leave the loop | (none) |
| anything else | nothing | \`err\` |

Every reply ends with a newline. Use only the driver functions; no register access in \`command_loop\`.`,
  starter: HEAD + GPIO_TYPES + UART_BITS + GPIO_INIT + GPIO_RW + UART_INIT_PUTC + UART_PUTS_HEX + C`
static char uart_getc(void)
{
    /* TODO: wait for RX_AVAIL, then return the received byte */
    return 'q';
}

static void command_loop(void)
{
    /* TODO: read commands until 'q' */
}
` + step5Main,
  solution: HEAD + GPIO_TYPES + UART_BITS + GPIO_INIT + GPIO_RW + UART_INIT_PUTC + UART_PUTS_HEX + C`
static char uart_getc(void)
{
    while ((UART_STATUS & UART_ST_RX_AVL) == 0) {
        /* nothing received yet */
    }
    return (char)UART_DATA;
}

static void command_loop(void)
{
    for (;;) {
        char cmd = uart_getc();
        switch (cmd) {
        case '1':
            gpio_write(LED_PIN, true);
            uart_puts("ok\n");
            break;
        case '0':
            gpio_write(LED_PIN, false);
            uart_puts("ok\n");
            break;
        case 't':
            gpio_write(LED_PIN, !gpio_read(LED_PIN));
            uart_puts("ok\n");
            break;
        case 'b':
            uart_puts(gpio_read(BUTTON_PIN) ? "released\n" : "pressed\n");
            break;
        case 'q':
            return;
        default:
            uart_puts("err\n");
            break;
        }
    }
}
` + step5Main,
  tests: [
    { name: 'LED on, button held, quit', uartRx: '1bq', gpioIn: { value: 0x0000, mask: 0x0004 }, uartTx: 'ready\nok\npressed\nbye\n', regs: { GPIO_OUT: 0x20 }, noWarning: ['bits 16-31', 'write-only'] },
    { name: 'on, toggle, off, toggle, unknown, button released', uartRx: '1t0txbq', gpioIn: { value: 0x0000, mask: 0x0000 }, uartTx: 'ready\nok\nok\nok\nok\nerr\nreleased\nbye\n', regs: { GPIO_OUT: 0x20 }, noWarning: ['bits 16-31', 'write-only'] },
    { name: 'quit immediately leaves the LED off', uartRx: 'q', uartTx: 'ready\nbye\n', regs: { GPIO_OUT: 0x00 }, noWarning: ['bits 16-31', 'write-only'] },
    { name: 'slow typist: on, then toggle back off, with long pauses between keys', uartRx: { data: '1tq', interval: 400, start: 600 }, uartTx: 'ready\nok\nok\nbye\n', regs: { GPIO_OUT: 0x00 }, noWarning: ['bits 16-31', 'write-only'] },
  ],
  hints: [
    'The tests type the commands slowly, so `uart_getc` is often called when nothing has arrived yet. What does `UART_DATA` return then, and which status bit tells you a byte is really there?',
    '`uart_getc` mirrors `uart_putc`: poll a status bit, then access `UART_DATA` once. Reading `UART_DATA` twice would throw a byte away.',
    'A `for (;;)` loop around `switch (cmd)` with one `case` per command. `return` from the `q` case; every other case ends with `break`. Toggle with the functions you have: `gpio_write(LED_PIN, !gpio_read(LED_PIN));` works because `GPIO_IN` reads back the output latch for an output pin.',
  ],
  explain: `This is the skeleton of most serial consoles and bootloader command handlers: block for a byte, dispatch on it, reply, repeat. The \`default\` case matters: input from outside is never guaranteed to be one of the expected values. Its limits are the ones the lessons named. \`uart_getc\` waits for ever if nothing arrives (add a timeout), and while the loop is busy transmitting a reply it is not reading, so a fast sender could overrun the receiver (receive by interrupt into a ring buffer).`,
});

export default [{
  id: 'ec-lab-gpio-uart-driver',
  title: 'Lab: write a register-level GPIO and UART driver for Bench-MCU',
  kind: 'Guided lab',
  minutes: 120,
  summary: 'Build gpio_init, gpio_write, gpio_read, uart_putc with TX_READY polling, uart_puts and a command loop directly on the registers, one tested step at a time, then work out what changes on a real chip.',
  skills: ['ec-gpio-driver', 'ec-uart-driver', 'ec-port-driver', 'ec-reg-bits'],
  objectives: [
    'Turn a register table into working driver functions using masks, shifts and the correct write idiom for each register type.',
    'Implement a polled UART transmit and receive path and explain what the status bits protect against.',
    'Structure a driver in layers so that only the lowest functions touch registers.',
    'List what must be added or changed to move the driver to a real microcontroller, and where to find each fact.',
  ],
  hardware: [
    'None. Every step runs in the browser on Bench-MCU, a fictional simulated microcontroller. Its register map matches no real chip.',
    'Assumed board for the exercises: an LED on GPIO pin 5 (lit when high) and a push button from GPIO pin 2 to ground, using the internal pull-up.',
    'Optional, for the porting discussion only: any development board you own and its reference manual. Nothing in this lab was run on physical hardware.',
  ],
  software: [
    'The C lab in this app (C interpreter and Bench-MCU peripheral model).',
    'docs/BENCH_MCU.md: the register map and the supported C subset.',
  ],
  background: [
    `A **driver** is the small body of code that knows a peripheral's registers so that the rest of the program does not
have to. Its interface speaks the application's language (\`gpio_write(LED_PIN, true)\`); its implementation speaks the
datasheet's (\`GPIO_SET = 1u << 5\`). Everything from the lessons on bitwise operations, register manipulation and
\`volatile\` is used here on a complete, if small, example.

You will write the driver the way you would for a new chip: read the register description, decide the correct access
idiom for each register, write one function, test it against the hardware model, and only then build the next layer.`,
    { t: 'callout', kind: 'sim', title: 'Bench-MCU is fictional', md: 'The addresses, register names and bit positions below belong to the teaching simulator only. The method transfers to real chips. The numbers do not. The final step of the lab is about exactly that difference.' },
    `### The registers you need

**GPIO, base \`0x4000_0000\`** (16 pins, bit *n* = pin *n*)

| Register | Offset | Access | Use in this lab |
|---|---|---|---|
| \`GPIO_DIR\` | 0x00 | RW | 1 = output. Read-modify-write. |
| \`GPIO_OUT\` | 0x04 | RW | output latch. Read it; write it through SET/CLR. |
| \`GPIO_IN\` | 0x08 | RO | pin levels. Outputs read back the latch. |
| \`GPIO_SET\` | 0x0C | WO | write 1 to set bits of \`GPIO_OUT\`. Plain write. |
| \`GPIO_CLR\` | 0x10 | WO | write 1 to clear bits of \`GPIO_OUT\`. Plain write. |
| \`GPIO_PULLUP\` | 0x18 | RW | 1 = pull-up on an input pin. Read-modify-write. |

**UART0, base \`0x4000_1000\`**

| Register | Offset | Access | Use in this lab |
|---|---|---|---|
| \`UART_DATA\` | 0x00 | RW | write: send a byte. read: take the next received byte. |
| \`UART_STATUS\` | 0x04 | RO | bit 0 \`TX_READY\`, bit 1 \`RX_AVAIL\`, bit 2 \`RX_OVERRUN\` |
| \`UART_CTRL\` | 0x08 | RW | bit 0 \`ENABLE\`, bit 1 \`RX_IRQ_EN\` |
| \`UART_BAUD\` | 0x0C | RW | divisor (stored only; the simulator is not timing-accurate) |

The header that defines \`GPIO_DIR\`, \`UART_DATA\` and the rest as \`(*(volatile uint32_t *)address)\` is included
automatically in the C lab.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'The assumed board and the driver layers. The simulator\'s test bench plays the part of the button and the serial terminal.', text:
`                 Bench-MCU (simulated)
               +-----------------------+
 3V3 --[pull-up, internal]--+          |
                            |          |
 button --------------------+ GPIO 2   |        application:  command_loop()
   |                        |          |                          |
  GND                       | GPIO 5 --+--[R]--|>|-- GND          v
                            |          |      LED       helpers:  uart_puts()  uart_put_hex8()
 terminal TX -------------->| UART RX  |                          |
 terminal RX <--------------| UART TX  |                          v
               +-----------------------+        driver:  gpio_init() gpio_write() gpio_read()
                                                         uart_init() uart_putc()  uart_getc()
                                                                  |
                                                                  v
                                                registers: GPIO_DIR GPIO_SET GPIO_CLR GPIO_IN GPIO_PULLUP
                                                           UART_DATA UART_STATUS UART_CTRL UART_BAUD` },
  ],
  steps: [
    { title: 'Configure pins: gpio_init',
      md: `Start with configuration. A pin has a direction and, as an input, an optional pull-up. Before writing code, decide for each register whether the right idiom is a plain write or a read-modify-write, and why.`,
      blocks: [step1] },
    { title: 'Drive and read pins: gpio_write and gpio_read',
      md: `Now the data path. The finished \`gpio_init\` from step 1 is included. Note which register each function uses: the output is changed through the set and clear registers, the input is read from the pin-level register, never from the output latch.`,
      blocks: [step2] },
    { title: 'Send one byte reliably: uart_init and uart_putc',
      md: `This step is a debugging exercise, because the mistake in it is the one almost everyone makes with their first UART: writing the data register without asking whether the transmitter is ready.`,
      blocks: [step3] },
    { title: 'Send text and numbers: uart_puts and uart_put_hex8',
      md: `With a reliable \`uart_putc\`, everything else is ordinary C on top of it. The GPIO functions are included again so that the program can report a register value over the UART.`,
      blocks: [step4] },
    { title: 'Receive and act: uart_getc and the command loop',
      md: `The last piece is input. The complete driver from steps 1–4 is provided. The tests type different command sequences into the simulated UART and set the button's state.`,
      blocks: [step5] },
    { title: 'What changes on a real chip',
      md: `The functions you wrote keep their names, parameters and structure on any microcontroller. Their bodies change, and usually **more has to happen before the first register write has any effect**. Work through this list with the reference manual of a chip you own or plan to use. Nothing below was run on hardware here; each item tells you what to look for.

**1. Clock enable.** To save power, most MCUs keep a peripheral's clock switched off after reset. Until it is enabled in a clock-control or power-control register, writes to that peripheral are typically ignored and reads return zero, and on some families the access faults. A driver that "does nothing" on a new board has usually missed this step. *Look for:* the clock/reset/power chapter, and the peripheral's "initialisation" section.

**2. Pin multiplexing.** A physical pin can be routed to several internal functions (GPIO, UART TX, timer output, analogue input). The UART's transmitter drives nothing until the pin is switched to the UART function in a pin-mux or alternate-function register, and the reset default is often not GPIO either. *Look for:* the pin function table in the datasheet and the I/O-mux chapter in the reference manual.

**3. Electrical configuration.** Drive strength, open-drain mode, pull-up and pull-down selection and input enable may each have their own register fields. Bench-MCU has only a pull-up bit.

**4. Baud rate.** The divisor is computed from the peripheral clock frequency, and the formula (integer, fractional, oversampling factor) is specific to the UART design. A wrong peripheral clock assumption gives garbage characters. *Look for:* the baud-rate generation section, and confirm the actual clock that feeds the UART.

**5. Register names, addresses and bit positions.** Take them from the vendor's device header, which is generated from the same source as the manual. Expect CMSIS-style structs on Cortex-M parts (\`UARTx->CTRL\`-style access, with the register names of that vendor). Expect differences in kind as well as in name: status flags may be write-1-to-clear or cleared by reading, the data register may front a FIFO with its own level flags, and "transmit ready" may be expressed as "transmit FIFO not full".

**6. Interrupt plumbing.** On real hardware an interrupt needs the peripheral's enable bit, the interrupt controller's enable for that line, a handler with the exact name or vector slot the start-up code expects, and correct acknowledgement in the handler.

**7. Use the vendor's layer when there is one.** Vendors ship HAL or SDK functions for all of this. In an ESP-IDF project, for example, you would normally call the GPIO and UART driver APIs (\`gpio_set_direction\`, \`gpio_set_level\`, \`uart_write_bytes\`) and not write to registers at all; check the ESP-IDF API reference for the version you use. Writing a register-level driver is how you learn what those functions do and how to debug them when they do not.`,
      blocks: [
        { t: 'ascii', caption: 'The same gpio_init on Bench-MCU and on a typical real MCU. The lines marked + do not exist in the simulator.', text:
`Bench-MCU                              typical real MCU (names differ per vendor)
---------------------------------      ----------------------------------------------
                                     + enable the GPIO port's clock / power domain
                                     + select the GPIO function for this pin in the pin mux
set or clear the bit in GPIO_DIR       set or clear the direction (or output-enable) bit
set or clear the bit in GPIO_PULLUP    program pull-up / pull-down / drive strength fields
                                     + enable the input buffer, if the family has one` },
        { t: 'callout', kind: 'hw', title: 'How to check each step on a board', md:
`You should be able to confirm every stage independently, and doing so in order localises a fault quickly. With a debugger, read the clock-enable register and the pin-mux register back after initialisation and compare them with the values you intended. With a multimeter or logic analyser on the pin, you should see the LED pin change level when \`gpio_write\` runs, and you should see a start bit, eight data bits and a stop bit of the expected width on the TX pin when one character is sent. If the registers are right and the pin is silent, suspect the pin mux; if the bit widths are wrong, suspect the clock or the divisor.` },
      ] },
  ],
  walkthrough: [
    `### What each important line does at the hardware level`,
    code(C`
GPIO_DIR |= mask;                              /* (1) */
GPIO_SET = 1u << pin;                          /* (2) */
return (GPIO_IN & (1u << pin)) != 0;           /* (3) */
while ((UART_STATUS & UART_ST_TX_RDY) == 0) { }   /* (4) */
UART_DATA = (uint8_t)c;                        /* (5) */
return (char)UART_DATA;                        /* (6) */
`, 'interp', { caption: 'The six register accesses the whole driver is built from. Each appears in a step you ran in the C lab.', explain: [
      { lines: '1', md: 'Load the 32-bit word at `0x40000000`, OR in one bit, store it back. The pin\'s output driver is switched on. Three bus operations: safe here because it runs once at start-up, before any interrupt uses the port.' },
      { lines: '2', md: 'One store to `0x4000000C`. The peripheral sets the corresponding latch bit itself; the zeros in the written value are ignored. Nothing is read, so nothing can be stale.' },
      { lines: '3', md: 'Load `0x40000008`, which samples the pins at that moment, mask one bit, and normalise to 0 or 1. `volatile` in the register definition guarantees a fresh load on every call.' },
      { lines: '4', md: 'Repeated loads of `0x40001004`. Each iteration really reads the register because it is `volatile`; without that, an optimiser could turn this into the infinite loop shown in the volatile lesson.' },
      { lines: '5', md: 'One store to `0x40001000`. This write has a side effect: the UART copies the byte into its shift register and starts clocking it out. `TX_READY` drops until it has finished.' },
      { lines: '6', md: 'One load from `0x40001000`. Also a side effect: the byte is removed from the receive buffer and `RX_AVAIL` falls if no more are waiting. Reading twice loses data.' },
    ] }),
    `### Why the layers are worth having

Count the places that mention a register address or a status bit: six functions. \`uart_puts\`, \`uart_put_hex8\` and
\`command_loop\` contain none. When this code moves to another chip, only those six bodies are rewritten and everything
above them is reused unchanged. The firmware engineering section develops this idea into a hardware abstraction layer.`,
  ],
  testing: [
    `Each step has automated tests that load your code into the simulator, drive its inputs (button level, bytes on the
UART receive line, ADC values) and compare register contents and UART output with the expected result. Use them as you
would use instruments on a bench:

- **Register expectations** (\`GPIO_DIR\`, \`GPIO_OUT\`, \`UART_CTRL\`) correspond to reading registers back in a debugger.
- **UART transmit expectations** correspond to watching a serial terminal or a logic analyser on the TX pin. Missing characters there mean the handshake is wrong, not the string.
- **The button input** is set by the test bench the way a finger would set it. Run the released case and confirm you understand why the pin reads 1 with nothing driving it.

When a test fails, read the difference it reports before changing code. Then predict what the registers *should* hold
after each line and find the first line where the simulator disagrees with you.

On a real board you should see the same behaviour through real instruments: the LED follows the command, and a terminal
set to the right baud rate shows the replies. That statement is a prediction for you to verify, not a measurement made
here.`,
  ],
  troubleshooting: [
    { symptom: 'Nothing at all appears on the UART output.', cause: 'The ENABLE bit in UART_CTRL is 0, so every write to UART_DATA is dropped. Commonly caused by `UART_CTRL = …` with a value that does not include the bit, or `&= ~` where `|=` was meant.', fix: 'Set the bit with `UART_CTRL |= UART_CTRL_EN;` in uart_init and check the UART_CTRL register expectation in the test.' },
    { symptom: 'Only some characters arrive, for example "Hlo" instead of "Hello".', cause: 'uart_putc writes UART_DATA while TX_READY is low. The transmitter is still busy with the previous byte and the new one is lost.', fix: 'Poll `(UART_STATUS & UART_ST_TX_RDY) == 0` in a loop before every write to UART_DATA.' },
    { symptom: 'Configuring a second pin undoes the first one.', cause: 'gpio_init assigns to GPIO_DIR or GPIO_PULLUP with `=` instead of updating one bit.', fix: 'Use `|= mask` and `&= ~mask` on the RW configuration registers.' },
    { symptom: 'The button always reads as pressed, or reads unpredictably.', cause: 'The pull-up was not enabled, so the released pin is not pulled to a defined level; or the active-low sense was forgotten.', fix: 'Call gpio_init(BUTTON_PIN, GPIO_INPUT, true) and treat a 0 level as "pressed".' },
    { symptom: 'The command loop skips every second command.', cause: 'UART_DATA is read more than once per byte (for example once to test it and once to use it). Each read removes a byte from the receive buffer.', fix: 'Read UART_DATA exactly once into a local variable and use the variable.' },
    { symptom: 'The program stops with "stopped after … steps — probably an infinite loop".', cause: 'A polling loop is waiting for a bit that will never be set: RX_AVAIL with no more input, the wrong status bit, or a comparison with the wrong sense.', fix: 'Check the mask and the condition. Make sure the command loop returns on `q` and that the test input ends with it.' },
    { symptom: 'gpio_write appears to work but GPIO_OUT reads back with extra bits set.', cause: '`GPIO_SET |= …` or `GPIO_OUT = ~mask` style writes. SET/CLR are write-only; inverting a mask and assigning it sets every other bit.', fix: 'Write the single-bit mask with plain `=` to GPIO_SET or GPIO_CLR.' },
  ],
  challenge: [
    `Extend the driver on your own. No solutions are provided; the C lab's free-play mode on the Workbench and the register map in \`docs/BENCH_MCU.md\` are all you need.

1. **Timeouts.** Give \`uart_getc\` a variant that returns \`false\` after a bounded number of polls, and make the command loop print \`idle\` and carry on when it does.
2. **Interrupt-driven receive.** Replace polling in \`uart_getc\` with the UART receive interrupt and the ring buffer from the interrupt lesson. Report \`RX_OVERRUN\` if it is ever set.
3. **A second instance.** Rewrite the UART functions to take a pointer to a register struct (\`uart_regs_t *\`) so that one set of functions could serve several UARTs. Bench-MCU has only one, but the code should not care.
4. **A new command.** Add \`a\`, which starts an ADC conversion on channel 0 and replies with the result as four hex digits. You will need a \`uart_put_hex16\`.
5. **Port it on paper.** Pick a real MCU, open its reference manual, and for each of your six register-level functions write down the registers and bits it would need, including the clock-enable and pin-mux steps. Note every fact you had to look up and where you found it.`,
  ],
  quiz: [
    { q: 'Why does `gpio_write` use `GPIO_SET = 1u << pin;` and not `GPIO_OUT |= 1u << pin;`?', kind: 'arch', choices: [
      { t: 'A single store leaves no gap in which an ISR\'s change to another pin is lost', ok: true, why: 'There is no read whose result could be stale by the time of the write.' },
      { t: '`GPIO_OUT` cannot be written directly on Bench-MCU, only through SET and CLR', why: 'The register table lists it as read/write. Writing it works; it is just not atomic with respect to interrupts.' },
      { t: 'Because `|=` on `GPIO_OUT` would also change the pin directions', why: 'Directions live in a different register. The concern with `|=` is the gap between its read and its write.' },
      { t: 'To make the pin change level faster than a read-modify-write could', why: 'The difference is correctness under interruption, not the speed of the edge on the pin.' },
    ] },
    { q: 'A program sends "READY" with a `uart_putc` that does not poll `TX_READY`. What appears on the line, and why?', kind: 'concept', choices: [
      { t: 'Only some characters: those written while the transmitter was idle', ok: true, why: 'A write while the transmitter is busy is lost. The CPU is far faster than the bit rate, so most writes arrive too early.' },
      { t: 'All five characters, but with the bits of each one corrupted', why: 'On this UART model a byte offered too early is dropped whole. It does not disturb the byte in progress.' },
      { t: 'Nothing at all, because the UART locks up after the first early write', why: 'The first byte is accepted and sent normally. Only the bytes that arrive while it is busy are lost.' },
      { t: 'The whole string, because the UART queues writes automatically', why: 'There is no transmit queue here unless the driver implements one. The status bit exists precisely because the hardware holds one byte.' },
    ] },
    { q: 'The same `gpio_init` is ported to a real MCU. The direction register reads back correctly in the debugger, but the pin never changes. Which cause should you check first?', kind: 'arch', choices: [
      { t: 'The pin is still routed to another function in the pin multiplexer', ok: true, why: 'If the direction bit is stored, the GPIO block is clocked and working. A pin routed to a different peripheral ignores the GPIO output.' },
      { t: 'The GPIO port\'s clock is disabled, so the port ignores every write', why: 'With the clock off, writes are normally not stored, so the direction register would not read back the value you wrote.' },
      { t: '`volatile` is missing from the register definition', why: 'A missing qualifier could drop or reorder accesses under optimisation, but here the register demonstrably holds the written value.' },
      { t: 'The stack is too small for the driver\'s functions', why: 'A stack problem shows up as corrupted variables or faults, not as a correctly configured register with a silent pin.' },
    ] },
    { q: 'Which part of this lab\'s code would need to be rewritten for a different microcontroller?', kind: 'concept', choices: [
      { t: 'The bodies of the six register-level functions; the helpers and command loop stay as they are', ok: true, why: 'Only those functions contain addresses, bit positions and access idioms. Everything above them speaks through their interface.' },
      { t: 'Everything, since register addresses appear throughout the code', why: 'They appear only in the lowest layer. `uart_puts`, `uart_put_hex8` and `command_loop` never name a register.' },
      { t: 'Only the baud-rate divisor, because the registers are standard across vendors', why: 'Register names, addresses, bit meanings and required start-up steps all differ between chips, not just one constant.' },
      { t: 'Nothing; C is portable, so the same source runs on any chip', why: 'The language is portable. The meaning of address `0x40001000` is not.' },
    ] },
    { q: 'In `command_loop`, why is a `default:` case that replies `err` important?', kind: 'security', choices: [
      { t: 'Any byte value can arrive from outside, and each needs a defined, harmless outcome', ok: true, why: 'Without it, unexpected bytes are silently ignored at best. In larger handlers, unhandled values are where unintended behaviour hides.' },
      { t: 'The C compiler requires every `switch` statement to have a default case', why: 'A switch without `default` compiles. The requirement comes from defensive design, not from the language.' },
      { t: 'It makes the loop faster, because unknown bytes are rejected early', why: 'The default case has no bearing on speed. It defines behaviour for values the other cases do not cover.' },
      { t: 'It prevents the UART receive buffer from overflowing with unread bytes', why: 'Overflow is avoided by reading bytes promptly. How a byte is interpreted after reading does not affect the buffer.' },
    ] },
  ],
}];
