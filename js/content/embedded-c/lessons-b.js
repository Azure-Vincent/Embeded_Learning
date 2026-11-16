// Embedded C, part B: registers, structs/unions/enums, volatile and const, static vs dynamic allocation.
import { C, clab, code } from './util.js';
import { fieldLab, walkLab, dispatchLab } from './labs-extra.js';

/* ------------------------------------------------------------------ lesson 5 */
const registers = {
  id: 'ec-registers',
  title: 'Bit masking and register manipulation',
  minutes: 80,
  summary: 'Set, clear, toggle and test single bits, update multi-bit fields without disturbing their neighbours, and recognise registers where the usual idioms are wrong.',
  skills: ['ec-reg-bits', 'ec-reg-fields', 'ec-reg-w1c'],
  blocks: [
    `## The problem: turning on one LED turns off another

A board has LEDs on GPIO pins 3, 5 and 9. A first driver looks reasonable:`,
    code(C`
void led_on(uint32_t pin)
{
    GPIO_OUT = 1u << pin;
}
`, 'pseudo', { caption: 'led_on(3) lights LED 3. led_on(5) lights LED 5 and LED 3 goes dark.' }),
    `\`=\` writes all 32 bits of the register. The value \`1u << 5\` has a 1 in bit 5 and **zeros everywhere else**, and
those zeros are written too. A register shared by sixteen pins needs operations that change one bit and leave the other
fifteen exactly as they were.

## Theory: read, modify, write

To change part of a register the CPU has to do three things: **read** the current value, **modify** the bits of
interest in a CPU register, and **write** the whole value back. C's compound assignment operators express exactly that:

| Goal | Idiom | Why it works |
|---|---|---|
| Set bit *n* | \`reg |= (1u << n);\` | OR with 1 forces a 1; OR with 0 keeps the old bit |
| Clear bit *n* | \`reg &= ~(1u << n);\` | the inverted mask has a 0 only at bit *n*; AND with 0 forces 0, AND with 1 keeps |
| Toggle bit *n* | \`reg ^= (1u << n);\` | XOR with 1 inverts; XOR with 0 keeps |
| Test bit *n* | \`if (reg & (1u << n))\` | every other bit is masked to 0, so the result is non-zero only if bit *n* is 1 |

\`reg |= mask\` is shorthand for \`reg = reg | mask\`: one load from the register's address, one OR, one store.`,
    { t: 'widget', name: 'register-bits', props: { challenge: 'set-bit' }, caption: 'Set one bit without changing any other. Type a C expression and watch which bits change.' },
    { t: 'widget', name: 'register-bits', props: { challenge: 'clear-bit' }, caption: 'Clear one bit. The mask must be inverted before the AND.' },
    { t: 'widget', name: 'register-bits', props: { challenge: 'toggle' }, caption: 'Toggle a bit with XOR.' },
    clab({
      title: 'Debug: LEDs that switch each other off',
      prompt: `Three LEDs are on pins 3, 5 and 9. The program configures all three as outputs, turns all three on, then turns LED 5 off. Afterwards pins 3 and 9 should be outputs driving high and pin 5 an output driving low:

\`DIR=0228 OUT=0208\`

Run it, read the register values, and fix the three driver functions.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static void led_init(uint32_t pin)
{
    GPIO_DIR = 1u << pin;
}

static void led_on(uint32_t pin)
{
    GPIO_OUT = 1u << pin;
}

static void led_off(uint32_t pin)
{
    GPIO_OUT = ~(1u << pin);
}

int main(void)
{
    led_init(3);
    led_init(5);
    led_init(9);

    led_on(3);
    led_on(5);
    led_on(9);
    led_off(5);
    led_off(5);          /* switching off an LED that is already off must change nothing */

    printf("DIR=%04X OUT=%04X\n", GPIO_DIR & 0xFFFFu, GPIO_OUT & 0xFFFFu);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static void led_init(uint32_t pin)
{
    GPIO_DIR |= 1u << pin;
}

static void led_on(uint32_t pin)
{
    GPIO_OUT |= 1u << pin;
}

static void led_off(uint32_t pin)
{
    GPIO_OUT &= ~(1u << pin);
}

int main(void)
{
    led_init(3);
    led_init(5);
    led_init(9);

    led_on(3);
    led_on(5);
    led_on(9);
    led_off(5);
    led_off(5);          /* switching off an LED that is already off must change nothing */

    printf("DIR=%04X OUT=%04X\n", GPIO_DIR & 0xFFFFu, GPIO_OUT & 0xFFFFu);
    return 0;
}
`,
      tests: [{ name: 'only the addressed pin changes', stdout: 'DIR=0228 OUT=0208\n', regs: { GPIO_DIR: 0x228, GPIO_OUT: 0x208 } }],
      hints: [
        'Print `GPIO_DIR` after each `led_init` call (or reason it through). How many bits of the register does `=` write, and what value do the bits other than `pin` receive?',
        'After the three `led_init` calls only pin 9 is an output: each call replaced the whole direction register. `led_off` is the worst of the three: `~(1u << 5)` has a 1 in *every* other position, and `=` writes them all.',
        'Use `|=` to set and `&= ~(...)` to clear, in all three functions.',
      ],
      explain: `Plain assignment replaces the register; \`|=\` and \`&= ~\` update one bit of it. The inverted mask is right in \`led_off\`, but it belongs on the right of an AND, where its 1 bits mean "keep". Plain \`=\` is correct only when you intend to define every bit, for example once during initialisation.`,
    }),
    `## Multi-bit fields

Many settings need more than one bit. On Bench-MCU the ADC channel number occupies bits 7:4 of \`ADC_CTRL\`. Real chips
are full of such fields: a pin's function select, a clock divider, a UART word length. A field is described by its
**shift** (position of its lowest bit) and its **mask** (ones across its width, in place):`,
    code(C`
#define ADC_CTRL_CH_SHIFT  4
#define ADC_CTRL_CH_MASK   (0xFu << ADC_CTRL_CH_SHIFT)     /* 0x000000F0 */

/* Read the field: isolate it, then move it down to bit 0. */
uint32_t ch = (ADC_CTRL & ADC_CTRL_CH_MASK) >> ADC_CTRL_CH_SHIFT;

/* Write the field: clear all of its bits, then OR in the new value. */
uint32_t tmp = ADC_CTRL;                               /* read             */
tmp &= ~ADC_CTRL_CH_MASK;                              /* clear the field  */
tmp |= (new_ch << ADC_CTRL_CH_SHIFT) & ADC_CTRL_CH_MASK;   /* insert       */
ADC_CTRL = tmp;                                        /* write once       */
`, 'pseudo', {
      caption: 'The two field idioms. Complete, running versions are in the labs below.',
      explain: [
        { lines: '5', md: 'Mask first, then shift. The result is a small number, 0 to 15.' },
        { lines: '9', md: 'Without this step, ORing channel 2 (`0010`) onto an existing channel 5 (`0101`) would leave `0111`, channel 7. A field must be cleared before it is written, because OR can only add 1s.' },
        { lines: '10', md: 'The final `& MASK` stops an out-of-range `new_ch` (say 16) from spilling into the bits above the field.' },
        { lines: '11', md: 'A single store. The hardware never sees the half-finished value with the field cleared, which matters when a field selects something live such as a clock source.' },
      ] }),
    { t: 'widget', name: 'register-bits', props: { challenge: 'field-read' }, caption: 'Extract a multi-bit field as a number.' },
    { t: 'widget', name: 'register-bits', props: { challenge: 'field-write' }, caption: 'Replace a field without disturbing the bits around it.' },
    { t: 'predict',
      q: 'A control register holds `0x0000_0050` (channel field, bits 7:4, is 5). Code selects channel 2 with `CTRL |= (2u << 4);`. What channel is selected afterwards?',
      choices: [
        { t: '7', ok: true, why: '`0101 | 0010` is `0111`. OR cannot turn the existing 1 bits off, so the old and new values are merged.' },
        { t: '2', why: 'That needs the old field cleared first. OR alone only ever adds 1 bits to what is already there.' },
        { t: '5', why: 'The OR does change the register: bit 5 of the register (value bit 1 of the field) goes from 0 to 1.' },
        { t: '0', why: 'Nothing in this statement clears bits. A field only becomes 0 through an AND with an inverted mask.' },
      ],
      reveal: 'This bug hides during bring-up, when the field starts at 0 after reset and the first write appears to work.' },
    clab({
      title: 'Write: select an ADC channel and convert',
      prompt: `Implement \`adc_read(channel)\` for the Bench-MCU ADC (see the register table in \`docs/BENCH_MCU.md\`):

1. Replace the channel field (bits 7:4 of \`ADC_CTRL\`) with \`channel\`, leaving the other bits alone.
2. Set the \`START\` bit (bit 0). It clears itself.
3. Wait until \`DONE\` (bit 0 of \`ADC_STATUS\`) is set.
4. Return \`ADC_DATA\`.

The last line printed shows \`ADC_CTRL\` in hex. After reading channels 3, 10 and 1 it must show channel 1 only.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

#define ADC_CTRL_START     (1u << 0)
#define ADC_CTRL_CH_SHIFT  4
#define ADC_CTRL_CH_MASK   (0xFu << ADC_CTRL_CH_SHIFT)
#define ADC_STATUS_DONE    (1u << 0)

static uint32_t adc_read(uint32_t channel)
{
    /* TODO: field update, start, wait for DONE, return the result */
    ADC_CTRL |= channel << ADC_CTRL_CH_SHIFT;
    return 0;
}

int main(void)
{
    printf("ch3=%u\n", adc_read(3));
    printf("ch10=%u\n", adc_read(10));
    printf("ch1=%u\n", adc_read(1));
    printf("ctrl=%02X\n", ADC_CTRL);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

#define ADC_CTRL_START     (1u << 0)
#define ADC_CTRL_CH_SHIFT  4
#define ADC_CTRL_CH_MASK   (0xFu << ADC_CTRL_CH_SHIFT)
#define ADC_STATUS_DONE    (1u << 0)

static uint32_t adc_read(uint32_t channel)
{
    uint32_t ctrl = ADC_CTRL;
    ctrl &= ~ADC_CTRL_CH_MASK;
    ctrl |= (channel << ADC_CTRL_CH_SHIFT) & ADC_CTRL_CH_MASK;
    ADC_CTRL = ctrl | ADC_CTRL_START;

    while ((ADC_STATUS & ADC_STATUS_DONE) == 0) {
        /* conversion in progress */
    }
    return ADC_DATA;
}

int main(void)
{
    printf("ch3=%u\n", adc_read(3));
    printf("ch10=%u\n", adc_read(10));
    printf("ch1=%u\n", adc_read(1));
    printf("ctrl=%02X\n", ADC_CTRL);
    return 0;
}
`,
      tests: [{ name: 'three conversions, channel field replaced each time', adc: [1000, 4095, 7], stdout: 'ch3=1000\nch10=4095\nch1=7\nctrl=10\n' }],
      hints: [
        'The starter ORs the channel in. What does the field hold after channels 3, 10 and 1 have each been ORed into it? What has to happen to the old channel before the new one goes in?',
        'Read `ADC_CTRL` into a local, AND it with `~ADC_CTRL_CH_MASK`, OR in `(channel << SHIFT) & MASK`, and write it back together with the START bit.',
        'Poll with `while ((ADC_STATUS & ADC_STATUS_DONE) == 0) { }` before reading `ADC_DATA`.',
      ],
      explain: `Clear-then-insert is the only way to *replace* a field. Building the new value in a local and writing once also lets the channel and the START bit arrive in the same store. The polling loop is the software half of a hardware handshake: the converter needs time, and \`DONE\` is how it says the data register is valid.`,
    }),
    `## Registers where read-modify-write is wrong

RMW assumes the register behaves like memory: what you read is what was last written, and writing the same value back
changes nothing. Peripheral registers often break that assumption. The datasheet marks each bit's **access type**:

| Type | Meaning | Consequence |
|---|---|---|
| RW | read/write | behaves like memory; RMW is fine |
| RO | read-only | writes are ignored |
| WO | write-only | reads return 0 or garbage; RMW is meaningless |
| W1C | write 1 to clear | writing 1 clears the flag, writing 0 does nothing |
| W1S / W1T | write 1 to set / toggle | used in dedicated set, clear and toggle registers |
| RC | clear on read | merely *reading* (even in a debugger's register view) clears the flags |

### Write-1-to-clear status flags

Interrupt and status flags are commonly W1C, so that software can acknowledge one event without a read-modify-write
racing against the hardware setting another. Bench-MCU's \`TIM_STATUS\` bit 0 (\`EXPIRED\`) is W1C.

Suppose a status register has two W1C flags, \`RX_DONE\` (bit 0) and \`ERROR\` (bit 2), and both are pending: it reads
\`0x05\`. You want to acknowledge only \`RX_DONE\`. Compare:

- \`STATUS = RX_DONE;\` writes \`0x01\`. Bit 0 is cleared, bit 2 is written with 0, which does nothing. **Correct.**
- \`STATUS |= RX_DONE;\` reads \`0x05\`, ORs to \`0x05\`, writes \`0x05\`. **Both flags are cleared.** The error is acknowledged without anyone having handled it.
- \`STATUS &= ~RX_DONE;\` reads \`0x05\`, writes \`0x04\`. Bit 0 gets a 0 (no effect) and bit 2 gets a 1 (cleared). It leaves the flag you meant to clear and clears the one you did not.

The model below runs on a PC. It represents the hardware side of a W1C register with a function, and replays the three statements:`,
    code(C`
#include <stdint.h>
#include <stdio.h>

static uint32_t hw_flags;                              /* what the peripheral holds   */

static uint32_t status_read(void)        { return hw_flags; }
static void     status_write(uint32_t v) { hw_flags &= ~v; }   /* W1C: 1s clear       */

#define RX_DONE (1u << 0)
#define ERROR   (1u << 2)

int main(void)
{
    hw_flags = RX_DONE | ERROR;
    status_write(RX_DONE);                              /* STATUS = RX_DONE;           */
    printf("plain write : %02X\n", (unsigned)hw_flags);

    hw_flags = RX_DONE | ERROR;
    status_write(status_read() | RX_DONE);              /* STATUS |= RX_DONE;          */
    printf("|=          : %02X\n", (unsigned)hw_flags);

    hw_flags = RX_DONE | ERROR;
    status_write(status_read() & ~RX_DONE);             /* STATUS &= ~RX_DONE;         */
    printf("&= ~        : %02X\n", (unsigned)hw_flags);
    return 0;
}
`, 'host-tested', { caption: 'Prints "plain write : 04", "|=          : 00", "&= ~        : 01". Only the plain write leaves the unhandled ERROR flag pending and clears RX_DONE. This is a software model of the register behaviour, not a hardware measurement.' }),
    { t: 'callout', kind: 'mistake', title: '|= on a write-1-to-clear register', md:
`It looks like "set the bit" and it compiles to a read, an OR and a write. The write carries a 1 for **every flag that was
pending at the moment of the read**, so all of them are cleared. The symptom is an interrupt or error that occasionally
goes missing. For W1C registers, write the mask with plain \`=\`.` },
    `### Set, clear and toggle registers

RMW has a second weakness: it takes several instructions. If an interrupt handler changes the same register between
your read and your write, your write puts the stale value back and the handler's change is lost (the interrupt lesson
works through this). Many GPIO blocks therefore provide write-only companion registers. Bench-MCU has \`GPIO_SET\`,
\`GPIO_CLR\` and \`GPIO_TOGGLE\`; real parts have equivalents such as \`BSRR\`, \`OUTSET\`/\`OUTCLR\` or \`W1TS\`/\`W1TC\` (the
names are vendor-specific: check the GPIO chapter of your chip's reference manual).

\`GPIO_SET = 1u << 5;\` is a single store. Bits written as 0 are ignored, so there is nothing to read first and nothing
to lose. Note the operator: **plain \`=\`, not \`|=\`**. A write-only register has no meaningful value to OR with.`,
    { t: 'callout', kind: 'decision', title: 'RMW or set/clear registers?', md:
`- If the peripheral offers set/clear/toggle registers, **use them for pins and flags that an interrupt handler also touches**. One store cannot be interrupted half-way.
- For multi-bit fields there is usually no such register. Use RMW, and if an ISR writes the same register, protect the sequence with a critical section.
- For configuration done once at start-up before interrupts are enabled, either is fine; choose what reads most clearly.` },
    clab({
      title: 'Debug: the flag that will not clear',
      prompt: `The program should toggle the LED on pin 0 once per timer period for three periods, then stop the timer and leave \`EXPIRED\` cleared. \`TIM_STATUS\` bit 0 is **write-1-to-clear**.

It prints \`periods=3\` almost immediately and reports \`flag=1\`: the loop is counting the same expiry three times. Fix the acknowledgement so the output is:

\`periods=3\`
\`waited for each one: yes\`
\`flag=0\`

(\`polls\` counts passes of the wait loop. Three real 200-tick periods need far more than 100 of them.)`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

#define TIM_CTRL_ENABLE      (1u << 0)
#define TIM_CTRL_AUTO_RELOAD (1u << 1)
#define TIM_STATUS_EXPIRED   (1u << 0)

int main(void)
{
    GPIO_DIR |= 1u << 0;

    TIM_LOAD = 200;
    TIM_CTRL = TIM_CTRL_ENABLE | TIM_CTRL_AUTO_RELOAD;

    uint32_t periods = 0;
    uint32_t polls = 0;                            /* how often the loop looked at the flag */
    while (periods < 3) {
        polls++;
        if (TIM_STATUS & TIM_STATUS_EXPIRED) {
            TIM_STATUS &= ~TIM_STATUS_EXPIRED;     /* acknowledge */
            GPIO_TOGGLE = 1u << 0;
            periods++;
        }
    }

    TIM_CTRL = 0;
    printf("periods=%u\n", periods);
    printf("waited for each one: %s\n", polls > 100 ? "yes" : "no");
    printf("flag=%u\n", TIM_STATUS & TIM_STATUS_EXPIRED);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

#define TIM_CTRL_ENABLE      (1u << 0)
#define TIM_CTRL_AUTO_RELOAD (1u << 1)
#define TIM_STATUS_EXPIRED   (1u << 0)

int main(void)
{
    GPIO_DIR |= 1u << 0;

    TIM_LOAD = 200;
    TIM_CTRL = TIM_CTRL_ENABLE | TIM_CTRL_AUTO_RELOAD;

    uint32_t periods = 0;
    uint32_t polls = 0;                            /* how often the loop looked at the flag */
    while (periods < 3) {
        polls++;
        if (TIM_STATUS & TIM_STATUS_EXPIRED) {
            TIM_STATUS = TIM_STATUS_EXPIRED;       /* write 1 to clear */
            GPIO_TOGGLE = 1u << 0;
            periods++;
        }
    }

    TIM_CTRL = 0;
    printf("periods=%u\n", periods);
    printf("waited for each one: %s\n", polls > 100 ? "yes" : "no");
    printf("flag=%u\n", TIM_STATUS & TIM_STATUS_EXPIRED);
    return 0;
}
`,
      tests: [{ name: 'three real periods, flag acknowledged', stdout: 'periods=3\nwaited for each one: yes\nflag=0\n', regs: { GPIO_OUT: 0x1, TIM_STATUS: 0x0 } }],
      hints: [
        'Expand the acknowledgement into its three steps: what is read, what is computed, what is written? Then look up in the access-type table what the register does with that written value.',
        '`&= ~` reads 1, computes 0 and writes 0. Writing 0 to a W1C bit does nothing. The flag is cleared by writing a **1** to it, inside the loop, each time an expiry is handled.',
        '`TIM_STATUS = TIM_STATUS_EXPIRED;` — a plain write of the mask. No read is needed.',
      ],
      explain: `\`&= ~\` reads 1, computes 0 and writes 0, which a W1C bit ignores. The flag stayed set, so the next two loop passes saw the same expiry. With only one flag in this register, \`|=\` would have happened to work; on a register with several flags it clears all pending ones. The habit that is always right for W1C: plain assignment of exactly the bits you have handled.`,
    }),
    clab({
      title: 'Modify: add toggle and masked write to a pin driver',
      prompt: `\`pin_set\` and \`pin_clear\` work and use the atomic set/clear registers. Extend the driver:

- \`pin_toggle(pin)\` inverts one output pin.
- \`pins_write(mask, value)\` makes every pin whose bit is 1 in \`mask\` equal to the corresponding bit of \`value\`, and leaves all other pins unchanged. (Used to drive a 4-bit bus on some of the pins of a port.)

Do not change \`main\`.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static void pin_set(uint32_t pin)   { GPIO_SET = 1u << pin; }
static void pin_clear(uint32_t pin) { GPIO_CLR = 1u << pin; }

static void pin_toggle(uint32_t pin)
{
    /* TODO */
}

static void pins_write(uint32_t mask, uint32_t value)
{
    /* TODO */
}

int main(void)
{
    GPIO_DIR = 0xFFu;

    pin_set(0);
    pin_set(7);
    pin_set(6);
    pin_clear(6);
    printf("%02X\n", GPIO_OUT);

    pins_write(0x3Cu, 0x28u);
    printf("%02X\n", GPIO_OUT);

    pins_write(0x0Fu, 0xF6u);
    printf("%02X\n", GPIO_OUT);

    pin_toggle(7);
    pin_toggle(4);
    printf("%02X\n", GPIO_OUT);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static void pin_set(uint32_t pin)   { GPIO_SET = 1u << pin; }
static void pin_clear(uint32_t pin) { GPIO_CLR = 1u << pin; }

static void pin_toggle(uint32_t pin)
{
    GPIO_TOGGLE = 1u << pin;
}

static void pins_write(uint32_t mask, uint32_t value)
{
    GPIO_OUT = (GPIO_OUT & ~mask) | (value & mask);
}

int main(void)
{
    GPIO_DIR = 0xFFu;

    pin_set(0);
    pin_set(7);
    pin_set(6);
    pin_clear(6);
    printf("%02X\n", GPIO_OUT);

    pins_write(0x3Cu, 0x28u);
    printf("%02X\n", GPIO_OUT);

    pins_write(0x0Fu, 0xF6u);
    printf("%02X\n", GPIO_OUT);

    pin_toggle(7);
    pin_toggle(4);
    printf("%02X\n", GPIO_OUT);
    return 0;
}
`,
      tests: [{ name: 'toggle and masked write', stdout: '81\nA9\nA6\n36\n', regs: { GPIO_OUT: 0x36 } }],
      hints: [
        'Look at the register table: which register inverts output bits when written? For `pins_write`, split the problem in two: which bits of the old `GPIO_OUT` must survive, and which bits of `value` may be used?',
        '`pin_toggle` is one store to `GPIO_TOGGLE`, in the same style as the two functions above it. For `pins_write`, keep the unmasked bits (`GPIO_OUT & ~mask`) and take the masked bits from `value` (`value & mask`).',
        'The third call passes `value = 0xF6` with `mask = 0x0F`. If the high nibble changes, you forgot `& mask` on the value.',
      ],
      explain: `\`(old & ~mask) | (value & mask)\` is the general "replace these bits" expression; a field update is the same thing with a shift. An alternative with no read is two stores: \`GPIO_CLR = mask & ~value; GPIO_SET = mask & value;\`. That version cannot lose an interrupt handler's change to another pin, but the pins pass through an intermediate state between the two writes. Which matters more depends on what is wired to the pins.`,
    }),
    fieldLab,
    `## Three ways to name a register

The same store instruction can be written three ways. Vendor code uses all of them, so you need to read each.

**1. Macros that dereference a cast address**, as in the Bench-MCU header. Simple, and the address is visible. Field
helpers written as macros have the argument-evaluation hazards from the first lesson.

**2. \`static inline\` functions** wrapping the access. They are type-checked, evaluate arguments once, can be stepped in
a debugger, and compile to the same instructions at any optimisation level above \`-O0\`.

**3. A struct laid over the peripheral**, the style of Arm's CMSIS device headers. One struct type describes the
register block, and a macro casts the block's base address to a pointer to it: \`UART0->CTRL |= 1u;\`. The struct lesson
builds one and covers the cautions.`,
    code(C`
#include <stdint.h>

/* 1. macro */
#define TIM_STATUS_REG  (*(volatile uint32_t *)0x4000200Cu)

/* 2. inline functions */
static inline uint32_t reg_read(const volatile uint32_t *reg)
{
    return *reg;
}

static inline void reg_write_field(volatile uint32_t *reg, uint32_t mask,
                                   unsigned shift, uint32_t value)
{
    *reg = (*reg & ~mask) | ((value << shift) & mask);
}

/* 3. struct overlay */
typedef struct {
    volatile uint32_t CTRL;      /* offset 0x00 */
    volatile uint32_t LOAD;      /* offset 0x04 */
    volatile uint32_t COUNT;     /* offset 0x08 */
    volatile uint32_t STATUS;    /* offset 0x0C */
} timer_regs_t;

#define TIMER0 ((timer_regs_t *)0x40002000u)

void timer_ack(void)
{
    TIMER0->STATUS = 1u;                         /* same store as TIM_STATUS_REG = 1u */
    reg_write_field(&TIMER0->CTRL, 0x3u, 0, 0x3u);
    (void)reg_read(&TIMER0->COUNT);
}
`, 'reviewed', { caption: 'Written against docs/BENCH_MCU.md; the addresses are Bench-MCU\'s and mean nothing on a real chip. Checked for compile errors with gcc -Wall -Wextra -std=c11 -c, not run.' }),
    { t: 'exercise',
      prompt: 'A clock-control register `CLKCTRL` has a 3-bit divider field at bits 10:8. Write a single C statement (or two) that sets the divider to 5 without changing any other bit. Then give the hex value of the register afterwards if it previously held `0x0000_0713`.',
      hints: [
        'Mask: three 1 bits at position 8, `0x7u << 8` = `0x700`.',
        'Clear with `& ~0x700`, insert with `| (5u << 8)`.',
        'Old value `0x713`: the field (digit at bits 11:8, lower three bits) is 7. Replace it with 5 and keep `0x13`.',
      ],
      solution: '`CLKCTRL = (CLKCTRL & ~(0x7u << 8)) | (5u << 8);` The old field value 7 is cleared and 5 inserted: `0x0000_0513`. Using `|=` alone would have left 7 (`111 | 101 = 111`).',
      answer: { type: 'text', accept: ['(0x)?[0_ ]*513h?'], nudge: 'Give the final register value in hex. Only bits 10:8 change; bits 7:0 keep `0x13`.' } },
    `## A harder case: reading a datasheet register description

On a chip you have not used before, every register write should be preceded by four questions, answered from the
register description in the reference manual:

1. **What is the reset value?** Fields you do not write keep it.
2. **What is each bit's access type?** RW, W1C, RC and "reserved" each need different handling. Reserved bits should be written with their reset value or preserved by RMW, as the manual instructs.
3. **Does a write have side effects?** Writing a data register starts a transmission. Reading one pops a FIFO.
4. **Is there an ordering rule?** Some fields may only change while the peripheral is disabled; some registers need an unlock key written first.

Apply this to Bench-MCU's \`UART_DATA\`: it is RW, but a read *pops the receive buffer*. Reading it twice "to be sure"
discards a byte, and a debugger's live register view can do the same. Not every register is memory.`,
    { t: 'refs', items: [
      { title: 'Arm CMSIS-Core: peripheral access conventions', url: 'https://arm-software.github.io/CMSIS_6/latest/Core/group__peripheral__gr.html', note: 'struct-per-peripheral layout and the __IO/__I/__O access qualifiers' },
      { title: 'CMSIS-SVD: register and field access types', url: 'https://arm-software.github.io/CMSIS_5/SVD/html/elem_registers.html', note: 'defines read-write, writeOnly, oneToClear and similar terms' },
      { title: 'C11 draft N1570 §6.5.16.2 (compound assignment)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
    ] },
  ],
  quiz: [
    { q: 'Which statement clears bit 4 of `CTRL` and leaves every other bit unchanged?', kind: 'code', choices: [
      { t: '`CTRL &= ~(1u << 4);`', ok: true, why: 'The inverted mask has a single 0 at bit 4. AND forces that bit to 0 and preserves the rest.' },
      { t: '`CTRL = CTRL & (1u << 4);`', why: 'Without the inversion the mask keeps only bit 4 and clears the other 31 bits.' },
      { t: '`CTRL = ~(1u << 4);`', why: 'Plain assignment writes 1 to all the other bits, whatever they were before.' },
      { t: '`CTRL ^= (1u << 4);`', why: 'XOR inverts the bit. It clears it only if it happened to be set.' },
    ] },
    { q: 'A W1C interrupt status register reads `0x0A` (flags 1 and 3 pending). The handler has dealt with flag 1 only. Which acknowledgement is correct?', kind: 'code', choices: [
      { t: '`STATUS = (1u << 1);`', ok: true, why: 'A 1 is written only to flag 1. The 0 written to flag 3 has no effect, so it stays pending.' },
      { t: '`STATUS |= (1u << 1);`', why: 'The value read back already contains flag 3, so the write carries a 1 for it too and acknowledges an event nobody handled.' },
      { t: '`STATUS &= ~(1u << 1);`', why: 'This writes 0 to the flag you want gone (no effect) and 1 to the other pending flag (cleared).' },
      { t: '`STATUS = 0;`', why: 'Writing 0 to a write-1-to-clear bit does nothing at all, so the interrupt would fire again immediately.' },
    ] },
    { q: 'Why do GPIO blocks provide separate SET and CLR registers when `OUT |= mask` already works?', kind: 'arch', choices: [
      { t: 'A single store cannot be split by an interrupt, so concurrent changes to other pins are not lost', ok: true, why: 'Read-modify-write is several instructions. A handler that changes another bit in between has its change overwritten by the stale value.' },
      { t: 'A write to SET or CLR completes faster on the bus than a write to OUT', why: 'Each is one bus write of the same duration. The benefit is the missing read and the atomicity, not the speed of the store.' },
      { t: 'OUT is read-only on most microcontrollers, so it cannot be used to drive pins', why: 'The output data register is normally read/write. The extra registers exist in addition to it.' },
      { t: 'They let you change pins on several ports at once with one instruction, which OUT cannot do', why: 'Each set/clear register belongs to one port, just like the output register it controls.' },
    ] },
    { q: 'A 2-bit field at bits 5:4 currently holds 3. What does `REG |= (1u << 4);` leave in the field?', kind: 'code', choices: [
      { t: '3', ok: true, why: 'OR can only add 1 bits. The field was `11`, and ORing `01` onto it changes nothing.' },
      { t: '1', why: 'Replacing the field with 1 needs both of its bits cleared first with an AND.' },
      { t: '0', why: 'OR never turns a bit off, so a non-zero field cannot become 0 this way.' },
      { t: '4', why: 'A 2-bit field can only hold 0 to 3. The value 4 is the mask\'s position, not a field content.' },
    ] },
    { q: 'In a field-update helper, why is the new value written as `(value << SHIFT) & MASK` rather than just `value << SHIFT`?', kind: 'security', choices: [
      { t: 'So that a value too large for the field cannot alter the neighbouring bits', ok: true, why: 'Without the mask, an out-of-range argument silently alters adjacent configuration bits, which may control something unrelated.' },
      { t: 'To clear the old contents of the field before the new value is ORed into the register', why: 'Clearing the old contents is done by the separate `& ~MASK` on the register value, not by masking the new value.' },
      { t: 'Because a shift is undefined unless it is followed by an AND with a mask', why: 'A shift by a valid count is fully defined. The mask is about range, not about the shift.' },
      { t: 'It makes the write to the register atomic with respect to interrupts', why: 'Masking is arithmetic in a CPU register. It has no influence on whether the read and the write can be separated by an interrupt.' },
    ] },
    { q: 'A debugger\'s peripheral view is open on a UART whose data register pops the receive FIFO when read. What might you observe?', kind: 'arch', choices: [
      { t: 'Received bytes go missing from the firmware\'s point of view', ok: true, why: 'The debugger\'s reads have the same side effect as the firmware\'s: each one removes a byte.' },
      { t: 'Nothing; a debugger reads registers through a path without side effects', why: 'A debugger reads memory-mapped registers through the same bus as the CPU. The peripheral cannot tell the difference.' },
      { t: 'The UART transmits an extra byte each time the view refreshes', why: 'Transmission is triggered by writes to the data register. The view only reads.' },
      { t: 'The baud rate changes because the divisor register is rewritten', why: 'Reading registers does not modify the divisor. The side effect here is confined to the receive FIFO.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 6 */
const structs = {
  id: 'ec-structs-unions-enums',
  title: 'Structs, unions and enums',
  minutes: 85,
  summary: 'How aggregate types are laid out in memory, how a struct is placed over a peripheral, how a table of structs can hold functions to call, and where reinterpreting bytes through a union stops being portable.',
  skills: ['ec-struct-layout', 'ec-struct-overlay', 'ec-byte-order'],
  blocks: [
    `## The problem: twelve bytes where you counted seven

You define a sensor record to store in a log and send over a radio link: a 1-byte tag, a 4-byte value, a 2-byte CRC.
That is 7 bytes. \`sizeof\` says 12. The receiver, written for a different MCU, decodes garbage. To understand both
facts you need to know how the compiler lays out a \`struct\`.

## Structs: fields at fixed offsets

A \`struct\` groups named fields into one object. The fields are stored **in declaration order**, each at a fixed
**offset** from the start. \`s.value\` compiles to "address of \`s\` plus the offset of \`value\`"; \`p->value\` is
\`(*p).value\`, the same access through a pointer.

The compiler may insert unused **padding** bytes between fields, and after the last one, so that every field sits at an
address its type requires (the alignment lesson explains why). It never reorders fields.`,
    code(C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t  tag;      /* 1 byte                     */
    uint32_t value;    /* 4 bytes, must start at a multiple of 4 */
    uint16_t crc;      /* 2 bytes                    */
} record_t;

int main(void)
{
    printf("sizeof=%zu\n", sizeof(record_t));
    printf("tag@%zu value@%zu crc@%zu\n",
           offsetof(record_t, tag), offsetof(record_t, value), offsetof(record_t, crc));

    record_t r = { .tag = 7, .value = 1000, .crc = 0xBEEF };
    record_t *p = &r;
    p->value += 1;
    printf("%d %u %04X\n", r.tag, (unsigned)r.value, r.crc);
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "sizeof=12", "tag@0 value@4 crc@8", "7 1001 BEEF". These particular numbers are the same on x86-64 and on 32-bit Arm and RISC-V.',
      explain: [
        { lines: '5-9', md: 'Layout: `tag` at offset 0, three padding bytes, `value` at 4–7, `crc` at 8–9, two trailing padding bytes so that the total size is a multiple of the strictest alignment (4).' },
        { lines: '17', md: 'Designated initialisers name the fields. Any field not named is set to zero.' },
        { lines: '19', md: '`p->value` loads the pointer, adds offset 4, and does a 32-bit load and store there.' },
      ] }),
    { t: 'widget', name: 'struct-layout', props: { source: 'struct record {\n  uint8_t  tag;\n  uint32_t value;\n  uint16_t crc;\n};' }, caption: 'The record from the example. Find the padding, then reorder the fields to make it smaller.' },
    `## On hardware: a struct laid over a peripheral

A peripheral's registers sit at consecutive offsets from a base address: on Bench-MCU the UART has \`DATA\` at +0,
\`STATUS\` at +4, \`CTRL\` at +8 and \`BAUD\` at +12. A struct of four \`uint32_t\` fields has exactly those offsets.
Casting the base address to a pointer to that struct gives named access to every register:`,
    code(C`
typedef struct {
    volatile uint32_t DATA;      /* 0x00 */
    volatile uint32_t STATUS;    /* 0x04 */
    volatile uint32_t CTRL;      /* 0x08 */
    volatile uint32_t BAUD;      /* 0x0C */
} uart_regs_t;

#define UART0 ((uart_regs_t *)0x40001000u)

/* UART0->CTRL |= 1u;   compiles to: load from 0x40001008, OR, store to 0x40001008 */
`, 'interp', { caption: 'Bench-MCU addresses (fictional). You will complete and run this in the lab below.' }),
    `This is the style of Arm's CMSIS device headers, and vendors generate such headers from a machine-readable
description of the chip. A second UART is the same struct type at a different base address, so one driver can serve
both by taking a \`uart_regs_t *\` parameter.`,
    { t: 'callout', kind: 'warn', title: 'Cautions for register overlays', md:
`- **Every field must be the register's exact width** and the struct must have no unintended padding. Gaps in the register map need explicit \`uint32_t reserved[n];\` fields. Verify offsets with \`_Static_assert(offsetof(uart_regs_t, CTRL) == 0x08, "…");\`.
- **Every field must be \`volatile\`.** Otherwise the optimiser may drop or merge accesses (next lesson).
- **Do not use bit-fields for register bits** in portable code. The order in which a compiler allocates bit-fields within a word is implementation-defined, and a bit-field write is a hidden read-modify-write of the whole register, which is wrong for W1C and write-only bits.
- **Prefer the vendor's header** over writing your own. It was generated from the same data as the reference manual.` },
    clab({
      title: 'Write: a UART through a register struct',
      prompt: `The overlay type and the \`UART0\` pointer are given. Implement:

- \`uart0_init(divisor)\`: store the divisor in \`BAUD\` and set the \`ENABLE\` bit (bit 0) of \`CTRL\` without clearing other bits.
- \`uart0_putc(c)\`: wait until \`TX_READY\` (bit 0 of \`STATUS\`) is 1, then write the character to \`DATA\`.

The program should transmit \`OK\` and a newline, and print the size of the register block.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

typedef struct {
    volatile uint32_t DATA;      /* 0x00 */
    volatile uint32_t STATUS;    /* 0x04 */
    volatile uint32_t CTRL;      /* 0x08 */
    volatile uint32_t BAUD;      /* 0x0C */
} uart_regs_t;

#define UART0 ((uart_regs_t *)0x40001000u)

#define UART_STATUS_TX_READY (1u << 0)
#define UART_CTRL_ENABLE     (1u << 0)

static void uart0_init(uint32_t divisor)
{
    /* TODO */
}

static void uart0_putc(char c)
{
    /* TODO */
}

int main(void)
{
    UART0->CTRL = 1u << 1;       /* start-up code has already set RX_IRQ_EN (bit 1) */
    uart0_init(104);
    uart0_putc('O');
    uart0_putc('K');
    uart0_putc('\n');
    printf("%d\n", (int)sizeof(uart_regs_t));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

typedef struct {
    volatile uint32_t DATA;      /* 0x00 */
    volatile uint32_t STATUS;    /* 0x04 */
    volatile uint32_t CTRL;      /* 0x08 */
    volatile uint32_t BAUD;      /* 0x0C */
} uart_regs_t;

#define UART0 ((uart_regs_t *)0x40001000u)

#define UART_STATUS_TX_READY (1u << 0)
#define UART_CTRL_ENABLE     (1u << 0)

static void uart0_init(uint32_t divisor)
{
    UART0->BAUD = divisor;
    UART0->CTRL |= UART_CTRL_ENABLE;
}

static void uart0_putc(char c)
{
    while ((UART0->STATUS & UART_STATUS_TX_READY) == 0) {
        /* transmitter busy */
    }
    UART0->DATA = (uint8_t)c;
}

int main(void)
{
    UART0->CTRL = 1u << 1;       /* start-up code has already set RX_IRQ_EN (bit 1) */
    uart0_init(104);
    uart0_putc('O');
    uart0_putc('K');
    uart0_putc('\n');
    printf("%d\n", (int)sizeof(uart_regs_t));
    return 0;
}
`,
      tests: [{ name: 'UART configured, RX_IRQ_EN preserved, three bytes sent', uartTx: 'OK\n', stdout: '16\n', regs: { UART_BAUD: 104, UART_CTRL: 0x3 } }],
      hints: [
        '`UART0` is a pointer to the struct. Which operator reaches a field through a pointer? And `main` has already set bit 1 of `CTRL`: which assignment operator keeps it?',
        'Registers are reached with `->`: `UART0->BAUD = divisor;`. Transmission is dropped while `ENABLE` is 0. Set it with `|=` in `uart0_init`; a plain `=` would clear `RX_IRQ_EN`.',
        'In `uart0_putc`, loop while `(UART0->STATUS & UART_STATUS_TX_READY) == 0`, then store to `UART0->DATA`. Without the wait, the `K` is written while the transmitter is still busy with the `O` and is lost.',
      ],
      explain: `\`UART0->CTRL\` is the 32-bit object at base + 8, exactly what the macro \`UART_CTRL\` in the predefined header names. The struct adds no code; it only lets the compiler compute the offsets. \`TX_READY\` drops for a short time after each write, so the polling loop is what makes consecutive characters arrive.`,
    }),
    walkLab,
    `## Unions: several types at one address

A \`union\` looks like a struct, but all its members start at offset 0 and share the same bytes. Its size is that of
the largest member. Writing one member and reading another reinterprets the bytes; this is called **type punning**. C
(since C99) permits it when the read is made **through the union object itself** (\`v.bytes[0]\`), provided the bytes form a
valid value of the member you read. C++ does not permit it at all. Taking pointers to two different members and handing
them to other code is not covered by this permission; the alignment lesson explains the rule (strict aliasing) behind that.

Two legitimate uses:

- **A value that is one of several kinds**, with a separate tag saying which (a message that carries either a temperature or an error code). Only the member last written is read.
- **Looking at the bytes of a value**, for example to serialise it or to inspect its layout.

The second use exposes a property of the *machine*, not of C: **byte order**. A little-endian CPU (every Cortex-M and
RISC-V MCU in normal configuration, the ESP32, x86) stores the least significant byte at the lowest address. A
big-endian system stores the most significant byte first, and so do most network protocols ("network byte order").`,
    code(C`
#include <stdint.h>
#include <stdio.h>

typedef union {
    uint32_t word;
    uint8_t  bytes[4];
} word_view_t;

int main(void)
{
    word_view_t v;
    v.word = 0x11223344u;
    printf("%02X %02X %02X %02X\n", v.bytes[0], v.bytes[1], v.bytes[2], v.bytes[3]);
    printf("sizeof=%zu\n", sizeof(v));
    return 0;
}
`, 'host-tested', { caption: 'On the little-endian host this prints "44 33 22 11" and "sizeof=4". A big-endian machine would print "11 22 33 44" from the same source: the output depends on the CPU.' }),
    { t: 'widget', name: 'endianness', props: { value: 0x11223344 }, caption: 'The same 32-bit value in little- and big-endian memory.' },
    { t: 'callout', kind: 'mistake', title: 'Parsing a protocol by overlaying a struct or union on the bytes', md:
`It is tempting to cast a receive buffer to a \`struct header *\` and read the fields. Three separate things can be wrong:
the protocol's **byte order** may differ from the CPU's, the struct's **padding** may not match the wire layout, and the
buffer may not be **aligned** for the struct's wider fields. The code can work on one compiler and target for years and
fail when either changes. Parse wire formats explicitly, byte by byte, with shifts. The alignment lesson shows the
pattern.` },
    { t: 'predict',
      q: 'A packet carries a 16-bit length in **big-endian** order: the bytes `0x01 0x02` arrive in that order and are stored at `buf[0]` and `buf[1]`. A little-endian MCU executes `uint16_t len; memcpy(&len, buf, 2);`. What is `len`?',
      choices: [
        { t: '513 (0x0201)', ok: true, why: 'The CPU treats the byte at the lower address as the least significant. `0x01` becomes the low byte and `0x02` the high byte.' },
        { t: '258 (0x0102)', why: 'That is the value the sender meant. It would need the first byte to be treated as the most significant, which a little-endian CPU does not do.' },
        { t: '3', why: 'The two bytes are not added; they occupy different positions within the 16-bit value.' },
        { t: 'It depends on the compiler', why: 'The compiler copies two bytes either way. The interpretation depends on the CPU\'s byte order, and that is fixed for a given MCU.' },
      ],
      reveal: 'The portable decode is `(uint16_t)((buf[0] << 8) | buf[1])`. It says which byte is the high one, so it gives 258 on every CPU.' },
    clab({
      title: 'Debug: a length that is far too large',
      prompt: `Packets on this link are \`[type][length high][length low][payload…]\`, with the 16-bit length in big-endian order. \`packet_length\` returns nonsense on Bench-MCU, which is little-endian.

Fix it so it prints \`len=258\` and \`len=16\`, on a CPU of either byte order.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static uint16_t packet_length(const uint8_t *pkt)
{
    uint16_t len;
    memcpy(&len, &pkt[1], sizeof(len));
    return len;
}

int main(void)
{
    static const uint8_t a[] = { 0x01, 0x01, 0x02, 0xAA };
    static const uint8_t b[] = { 0x02, 0x00, 0x10, 0xBB };

    printf("len=%d\n", packet_length(a));
    printf("len=%d\n", packet_length(b));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static uint16_t packet_length(const uint8_t *pkt)
{
    return (uint16_t)(((uint16_t)pkt[1] << 8) | pkt[2]);
}

int main(void)
{
    static const uint8_t a[] = { 0x01, 0x01, 0x02, 0xAA };
    static const uint8_t b[] = { 0x02, 0x00, 0x10, 0xBB };

    printf("len=%d\n", packet_length(a));
    printf("len=%d\n", packet_length(b));
    return 0;
}
`,
      tests: [{ name: 'big-endian length decoded', stdout: 'len=258\nlen=16\n' }],
      hints: [
        'Write the two wrong results in hexadecimal and put them next to the two length bytes of each packet. What has happened to the bytes?',
        '`memcpy` into a `uint16_t` uses the CPU\'s own byte order. The protocol defines a different one.',
        'Build the value arithmetically: the first length byte shifted left by 8, ORed with the second.',
      ],
      explain: `\`memcpy\` (like a union or a pointer cast) reproduces the machine's byte order: \`01 02\` became \`0x0201\`. The shift-and-OR form states the protocol's order in the code and is independent of the CPU. A length that is 256 times too large, used unchecked as a copy size, is how a parsing mistake becomes a buffer overflow.`,
    }),
    `## Enums: named states

An \`enum\` gives names to a set of integer constants. The first is 0 unless you say otherwise, and each following one
is one more than its predecessor.`,
    code(C`
#include <stdio.h>

typedef enum {
    LOCK_IDLE,          /* 0 */
    LOCK_AWAIT_PIN,     /* 1 */
    LOCK_OPEN = 10,
    LOCK_ALARM          /* 11 */
} lock_state_t;

static const char *state_name(lock_state_t s)
{
    switch (s) {
    case LOCK_IDLE:      return "idle";
    case LOCK_AWAIT_PIN: return "await-pin";
    case LOCK_OPEN:      return "open";
    case LOCK_ALARM:     return "alarm";
    default:             return "invalid";
    }
}

int main(void)
{
    lock_state_t s = LOCK_AWAIT_PIN;
    printf("%d %s\n", s, state_name(s));
    printf("%d %s\n", LOCK_ALARM, state_name(LOCK_ALARM));
    printf("%s\n", state_name((lock_state_t)99));
    return 0;
}
`, 'host-tested', { caption: 'Prints "1 await-pin", "11 alarm", "invalid".' }),
    `Enums make state machines and command codes readable, and with \`-Wall\` GCC warns when a \`switch\` over an enum
misses a case (\`-Wswitch\`). Know their limits:

- An enum variable is **just an integer**. Nothing stops it holding 99, whether through a cast, a corrupted byte, or a deliberately glitched instruction. Always handle the unexpected value: a \`default:\` that goes to a safe state.
- The **size** of an enum type is implementation-defined. GCC uses 4 bytes on most targets (RISC-V, Xtensa, x86, Arm Linux), but with \`-fshort-enums\` it uses the smallest integer type that fits, and the bare-metal Arm toolchain \`arm-none-eabi-gcc\` has that option **on by default** because the Arm EABI specifies it. The same enum can therefore be 1 byte in the firmware and 4 bytes in the PC test build. So do not put an enum type directly into a struct that describes a wire format or a register. Use \`uint8_t\` there and convert.
- For security-relevant states, values such as 0 and 1 are one bit-flip apart. The security section discusses choosing constants with a larger Hamming distance.`,
    clab({
      title: 'Read: layout of a struct, a union and an enum',
      prompt: `**Predict first.** Bench-MCU aligns 4-byte types to 4 and 2-byte types to 2, and is little-endian. Write down all seven lines, then run.`,
      readOnly: true,
      starter: C`
#include <stdint.h>
#include <stdio.h>

typedef enum { ST_IDLE, ST_ARMED, ST_FIRING = 10, ST_FAULT } state_t;

typedef struct {
    uint8_t  tag;
    uint32_t value;
    uint16_t crc;
} record_t;

typedef union {
    uint32_t word;
    uint16_t half[2];
    uint8_t  bytes[4];
} view_t;

int main(void)
{
    printf("%d %d %d\n", ST_ARMED, ST_FIRING, ST_FAULT);

    record_t r;
    printf("%d\n", (int)sizeof(record_t));
    printf("%d %d\n", (int)((uint8_t *)&r.value - (uint8_t *)&r),
                      (int)((uint8_t *)&r.crc - (uint8_t *)&r));

    view_t v;
    v.word = 0x11223344u;
    printf("%02X %02X\n", v.bytes[0], v.bytes[3]);
    printf("%04X\n", v.half[1]);
    v.bytes[1] = 0xFF;
    printf("%08X\n", v.word);
    printf("%d\n", (int)sizeof(view_t));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

typedef enum { ST_IDLE, ST_ARMED, ST_FIRING = 10, ST_FAULT } state_t;

typedef struct {
    uint8_t  tag;
    uint32_t value;
    uint16_t crc;
} record_t;

typedef union {
    uint32_t word;
    uint16_t half[2];
    uint8_t  bytes[4];
} view_t;

int main(void)
{
    printf("%d %d %d\n", ST_ARMED, ST_FIRING, ST_FAULT);

    record_t r;
    printf("%d\n", (int)sizeof(record_t));
    printf("%d %d\n", (int)((uint8_t *)&r.value - (uint8_t *)&r),
                      (int)((uint8_t *)&r.crc - (uint8_t *)&r));

    view_t v;
    v.word = 0x11223344u;
    printf("%02X %02X\n", v.bytes[0], v.bytes[3]);
    printf("%04X\n", v.half[1]);
    v.bytes[1] = 0xFF;
    printf("%08X\n", v.word);
    printf("%d\n", (int)sizeof(view_t));
    return 0;
}
`,
      tests: [{ name: 'output', stdout: '1 10 11\n12\n4 8\n44 11\n1122\n1122FF44\n4\n' }],
      hints: [
        'Enum values count up from the last explicit value.',
        'For the struct: where is the first multiple of 4 after the 1-byte `tag`? Is the total a multiple of 4?',
        'For the union: every member starts at the same address. On a little-endian machine `bytes[0]` is the *low* byte of `word`, and `half[1]` is its upper half.',
      ],
      explain: `\`ST_FAULT\` follows \`ST_FIRING = 10\`, so it is 11. The struct has three padding bytes after \`tag\` and two at the end: offsets 0, 4, 8, size 12. In the union the bytes in memory are \`44 33 22 11\`; \`half[1]\` covers the two upper bytes, \`0x1122\`; overwriting \`bytes[1]\` replaces the \`33\`. A union is as large as its largest member, 4 bytes.`,
    }),
    `## A field can hold a function: dispatch tables

Functions have addresses too: the address of their first instruction in flash. A **function pointer** is a variable
that holds one, and its type records the parameters and the return type so that a call through it is checked like any
other call.

| Declaration | Read as |
|---|---|
| \`int (*fn)(int);\` | \`fn\` is a pointer to a function taking \`int\` and returning \`int\` |
| \`typedef void (*isr_t)(void);\` | \`isr_t\` is the type "pointer to a function with no parameters and no result" |
| \`int *fn(int);\` | **not** a pointer: a function that returns \`int *\`. The parentheses around \`*fn\` matter |

The name of a function used without \`()\` converts to its address, and a pointer is called with the ordinary call
syntax: \`fn = add_one; fn(3);\`. You have already met two tables of function pointers without the name: the
**interrupt vector table** is an array of handler addresses that the CPU indexes with the interrupt number, and
\`irq_attach(IRQ_TIMER, timer_isr)\` on Bench-MCU stores one. Put a function pointer in a struct and you get the
standard firmware pattern for commands, protocol message types, state handlers and driver interfaces: a
**dispatch table**.`,
    code(C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef uint16_t (*convert_fn)(uint16_t raw);          /* one conversion routine */

static uint16_t to_millivolts(uint16_t raw) { return (uint16_t)((uint32_t)raw * 3300u / 4095u); }
static uint16_t to_percent(uint16_t raw)    { return (uint16_t)((uint32_t)raw * 100u / 4095u); }

typedef struct {
    uint8_t     channel;
    const char *unit;
    convert_fn  convert;                               /* which routine this channel uses */
} channel_cfg_t;

static const channel_cfg_t channels[] = {
    { 0, "mV", to_millivolts },
    { 3, "%",  to_percent    },
    { 5, "?",  NULL          },                        /* not configured */
};

int main(void)
{
    for (size_t i = 0; i < sizeof(channels) / sizeof(channels[0]); i++) {
        const channel_cfg_t *c = &channels[i];
        if (c->convert == NULL) {
            printf("ch%d: no conversion\n", c->channel);
            continue;
        }
        printf("ch%d: %d %s\n", c->channel, c->convert(2048), c->unit);
    }
    printf("entry size %zu\n", sizeof(channel_cfg_t));
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "ch0: 1650 mV", "ch3: 50 %", "ch5: no conversion", then "entry size 24" on the 64-bit host (two 8-byte pointers). On a 32-bit MCU an entry is 12 bytes.',
      explain: [
        { lines: '5', md: 'The typedef names the pointer type once. Without it the struct field would be written `uint16_t (*convert)(uint16_t raw);`.' },
        { lines: '16-20', md: 'The table is `const`, so the linker places it in flash. Each row stores the address of a function. Adding a channel is adding a row.' },
        { lines: '26-29', md: 'A null function pointer must be checked like any other pointer. Calling through it branches to address 0.' },
        { lines: '30', md: '`c->convert(2048)` loads the address from the table entry and performs an indirect call (`blx` on Arm, `jalr` on RISC-V). The compiler cannot inline it, which is the price of the flexibility.' },
      ] }),
    { t: 'callout', kind: 'security', title: 'A function pointer in RAM is a target', md:
`A function pointer decides where the CPU goes next. If it lives in writable memory next to a buffer, an out-of-bounds
write can replace it and the next call through it runs code of the attacker's choosing. Keep dispatch tables \`const\`
(flash), validate any index or key from outside *before* using it to select an entry, and never call through an entry
without checking it for \`NULL\`. Calling through a pointer whose type does not match the function's real signature is
undefined behaviour, even if a cast makes the compiler accept it.` },
    dispatchLab,
    { t: 'exercise',
      prompt: 'You must describe a register block with `CTRL` at offset 0x00, `STATUS` at 0x04, nothing documented at 0x08 and 0x0C, and `DATA` at 0x10. Write the struct, and one line that makes the compiler verify the offset of `DATA`.',
      hints: [
        'Fields are placed consecutively. To move `DATA` to offset 0x10, something 8 bytes long has to occupy 0x08–0x0F.',
        'An array `uint32_t reserved[2];` is the conventional filler.',
        '`_Static_assert(offsetof(type, field) == value, "message");` fails the build if the layout is wrong.',
      ],
      solution: '`typedef struct { volatile uint32_t CTRL; volatile uint32_t STATUS; uint32_t reserved[2]; volatile uint32_t DATA; } dev_regs_t;` and `_Static_assert(offsetof(dev_regs_t, DATA) == 0x10, "DATA offset");` (with `<stddef.h>` included). Forgetting the reserved words would place `DATA` at 0x08 and every access would silently hit the wrong register.' },
    `## A harder case: one driver, two byte orders

A sensor library must run on a little-endian Cortex-M and be unit-tested on a build server, and one customer uses a
big-endian processor. The sensor's registers are big-endian. If the library assembles values with shifts
(\`(hi << 8) | lo\`), the same source is correct on all three with no \`#ifdef\`. If it uses a union or a pointer cast, it
needs a byte swap on two of the three machines and a compile-time switch to know which. Arithmetic on values is
independent of byte order; looking at a value's bytes in memory is not. Prefer the first whenever data crosses a wire
or is stored for another system to read.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.7.2.1 (structure and union specifiers), §6.7.2.2 (enumerations), §6.5.2.3 footnote 95 (union type punning)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'Arm CMSIS-Core: device header file and peripheral structs', url: 'https://arm-software.github.io/CMSIS_6/latest/Core/group__peripheral__gr.html' },
      { title: 'GCC manual: structures, unions, enumerations and bit-fields implementation', url: 'https://gcc.gnu.org/onlinedocs/gcc/Structures-unions-enumerations-and-bit-fields-implementation.html' },
    ] },
  ],
  quiz: [
    { q: 'On a 32-bit MCU, what is `sizeof(struct { uint8_t a; uint32_t b; uint8_t c; })`?', kind: 'code', choices: [
      { t: '12', ok: true, why: '`a` at 0, three bytes of padding, `b` at 4–7, `c` at 8, then three trailing padding bytes to make the size a multiple of 4.' },
      { t: '6', why: 'That is the sum of the field sizes. The 4-byte field must start at a multiple of 4, which forces padding.' },
      { t: '8', why: 'This forgets that `c` comes after `b` in memory. The compiler does not move it into the gap after `a`.' },
      { t: '16', why: 'That rounds each of the three fields up to a full word and adds one more. Only the struct as a whole is rounded, to its own alignment of 4: 9 bytes of fields and internal padding become the next multiple of 4.' },
    ] },
    { q: 'Why must each field of a peripheral register struct be declared `volatile`?', kind: 'concept', choices: [
      { t: 'So the compiler must perform every read and write exactly as written', ok: true, why: 'Without it the optimiser may cache a status value in a CPU register or merge two writes into one.' },
      { t: 'To place the struct at the peripheral\'s address instead of in RAM', why: 'The address comes from the cast of the base address. `volatile` says nothing about location.' },
      { t: 'To prevent the compiler from inserting padding between the fields', why: 'Padding is decided by field types and alignment. Qualifiers do not alter the layout.' },
      { t: 'To make each access atomic with respect to interrupt handlers', why: 'A `volatile` read-modify-write is still three separate steps that an interrupt can split.' },
    ] },
    { q: 'A union has members `uint32_t w` and `uint8_t b[4]`. On a little-endian MCU, after `u.w = 0xCAFE0001;`, what is `u.b[3]`?', kind: 'code', choices: [
      { t: '0xCA', ok: true, why: 'The most significant byte is stored at the highest address, which is index 3.' },
      { t: '0x01', why: 'That is the least significant byte, which a little-endian machine stores at the lowest address, index 0.' },
      { t: '0xFE', why: 'That is the second most significant byte and lives at index 2.' },
      { t: '0x00', why: 'The zero byte is the second least significant one, at index 1.' },
    ] },
    { q: 'A state variable of enum type is read in a `switch` with a case for every enumerator and no `default`. A memory corruption sets it to 37. What happens?', kind: 'security', choices: [
      { t: 'No case matches, so the switch is skipped and execution continues after it', ok: true, why: 'An enum variable can hold any value of its underlying integer type. Without a `default`, an unexpected value falls through silently.' },
      { t: 'The program faults, because 37 is not a valid value for the enum type', why: 'C performs no run-time validation of enum values. Nothing detects it.' },
      { t: 'The first case is executed, because it is the fallback when nothing matches', why: 'A switch jumps only to a matching label or to `default`. It does not pick a nearest or first case.' },
      { t: 'The compiler prevents this at build time by checking every enumerator', why: 'The compiler can warn about missing enumerators, but it cannot know what value memory will contain at run time.' },
    ] },
    { q: 'A message handler table is `static handler_fn handlers[4];` in RAM, and the receive code calls `handlers[msg_type](payload);` where `msg_type` is a byte taken from the packet. What is the most serious problem?', kind: 'security', choices: [
      { t: 'A `msg_type` of 4 or more calls through whatever bytes lie after the table', ok: true, why: 'The index comes from outside and is never checked, so the CPU loads an "address" from memory that is not part of the table and branches to it. Check `msg_type < 4` and that the entry is not `NULL` before the call.' },
      { t: 'An indirect call is slower than a `switch`, so messages may be handled too late', why: 'An indirect call costs a few cycles more than a direct one. That is a performance detail, and it does not let a sender choose where the CPU jumps.' },
      { t: 'Function pointers cannot be stored in an array, only in a struct', why: 'An array of function pointers is valid C; the interrupt vector table is exactly that.' },
      { t: 'The table is `static`, so handlers defined in other source files cannot be called through it', why: '`static` makes the *name* of the table private to its file. A pointer in it can hold the address of any function of the right type, wherever that function is defined.' },
    ] },
    { q: 'Why is casting a received byte buffer to a `struct packet *` a fragile way to parse a protocol?', kind: 'concept', choices: [
      { t: 'Padding, byte order and alignment are set by the compiler and CPU, not by the protocol', ok: true, why: 'Any of the three can differ from the wire format, and they change with the target or compiler options.' },
      { t: 'A struct cannot contain `uint8_t` fields, so single bytes of the packet are lost', why: 'They can. The trouble comes from the wider fields and the gaps around them.' },
      { t: 'The cast copies the whole buffer into a new struct, which is slow and uses the stack', why: 'A pointer cast copies nothing. It only changes how the same bytes are interpreted.' },
      { t: 'Casting between pointer types is a compile error in standard C, so it needs an extension', why: 'C accepts explicit pointer casts between object types without complaint, which is why this mistake is common.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 7 */
const volatileConst = {
  id: 'ec-volatile-const',
  title: 'volatile and const',
  minutes: 55,
  summary: 'What the optimiser is entitled to do with memory it thinks it understands, how volatile stops it, where const data lives, and why volatile is not a lock.',
  skills: ['ec-volatile', 'ec-const-placement'],
  blocks: [
    `## The problem: works in the debug build, hangs in the release build

Firmware waits for a button interrupt before starting a measurement. The interrupt handler sets a flag; \`main\` waits
for it. During development (\`-O0\`) it works. The release build (\`-O2\`) hangs for ever in the wait loop, although the
handler demonstrably runs. Here is the wait function:`,
    code(C`
#include <stdbool.h>

bool data_ready;            /* set by an interrupt handler elsewhere */

void wait_for_data(void)
{
    while (!data_ready) {
        /* wait */
    }
}
`, 'reviewed', { caption: 'This file was compiled with gcc 13.3 (x86-64) using -Wall -Wextra -std=c11 -O2 -S to produce the assembly below. It was not run: it has no main, and the optimised version does not terminate.' }),
    `## What the compiler is allowed to assume

The C standard describes the behaviour of a program as if it ran on an "abstract machine", and lets the compiler
generate **any** instructions that produce the same observable behaviour. In that model, an ordinary variable changes
only when the program's own visible code changes it.

Inside \`wait_for_data\` nothing assigns to \`data_ready\`, and the loop calls no function that might. The compiler
concludes that the value cannot change while the loop runs. It therefore reads the flag **once**, and if it was false,
loops without ever looking again. This is the code GCC generated at \`-O2\`:`,
    { t: 'code', lang: 'asm', status: 'host-tested', caption: 'Output of gcc 13.3 -O2 -S for x86-64, assembler directives removed. The compiler and flags are the ones used on a PC; an Arm or RISC-V build shows the same structure with different mnemonics.',
      code: C`
wait_for_data:
	endbr64
	cmpb	$0, data_ready(%rip)
	jne	.L1
.L3:
	jmp	.L3
.L1:
	ret
`,
      explain: [
        { lines: '3-4', md: 'One load-and-compare of `data_ready`. If it is already non-zero, jump to the `ret`.' },
        { lines: '5-6', md: '`.L3: jmp .L3` — an unconditional jump to itself. The flag is never read again. The interrupt handler can set it as often as it likes.' },
      ] },
    `The compiler is not wrong. The program told it nothing about interrupts. At \`-O0\` the compiler reloads every
variable on every use, which is why the bug is invisible in a debug build.

## volatile: every access is observable

Declaring the object \`volatile\` tells the compiler that it may change in ways the compiler cannot see, and that reads
and writes may have effects of their own. The rule that follows: **every read and every write in the source must be
performed, exactly once each, in the order written.** With \`volatile bool data_ready;\` and the same flags:`,
    { t: 'code', lang: 'asm', status: 'host-tested', caption: 'Same compiler and flags, with the single change `volatile bool data_ready;`.',
      code: C`
wait_for_data:
	endbr64
.L2:
	movzbl	data_ready(%rip), %eax
	testb	%al, %al
	je	.L2
	ret
`,
      explain: [
        { lines: '3-6', md: 'The load from `data_ready` is now inside the loop. Each pass fetches the byte from memory again, tests it, and loops while it is zero.' },
      ] },
    `## Where volatile is required

1. **Memory-mapped peripheral registers.** A status register changes because of hardware events. Two writes of the same value to a data register send two bytes; the compiler must not merge them. This is why \`REG32\` in the Bench-MCU header and every CMSIS register field are \`volatile\`.
2. **Variables shared between an interrupt handler and the main program** (or between tasks, when not protected by something that already forces reloading).
3. **Variables a debugger or another agent modifies**, and deliberately "useless" loops such as a crude delay counter that the optimiser would otherwise delete.

\`volatile\` qualifies a type the same way \`const\` does, and the same right-to-left reading applies:
\`volatile uint32_t *p\` is a pointer to a volatile register (the usual case); \`uint32_t *volatile p\` is a volatile
pointer variable to ordinary memory (rarely wanted).`,
    { t: 'callout', kind: 'mistake', title: 'volatile is not atomicity', md:
`\`volatile uint32_t count;\` followed by \`count++;\` still compiles to a load, an add and a store. An interrupt between
the load and the store can change \`count\`, and the store then overwrites that change. On an 8- or 16-bit MCU even
*reading* a \`volatile uint32_t\` takes several instructions and can catch the value half-updated. \`volatile\` makes
the accesses happen. It does nothing to keep them together. The interrupt lesson covers what does.` },
    { t: 'predict',
      q: 'A receive routine is compiled at -O2. `UART_DATA` is declared **without** volatile as `#define UART_DATA (*(uint32_t *)0x40001000u)`. What is the compiler entitled to do with this code?',
      code: C`
uint8_t a = (uint8_t)UART_DATA;   /* first received byte  */
uint8_t b = (uint8_t)UART_DATA;   /* second received byte */`,
      choices: [
        { t: 'Read the register once and use the same value for both `a` and `b`', ok: true, why: 'To the compiler these are two reads of the same ordinary memory location with nothing in between that could change it, so the second read is redundant.' },
        { t: 'Nothing unusual: two reads are written, so two reads are generated', why: 'That guarantee exists only for volatile objects. For ordinary memory the compiler preserves results, not individual accesses.' },
        { t: 'Reject the code, because the address is not a declared variable', why: 'Casting an integer to a pointer and dereferencing it is valid C. The compiler has no idea what is at the address.' },
        { t: 'Swap the order of the two reads', why: 'Reordering would not help it; eliminating the duplicate does. The outcome is one read, not two in a different order.' },
      ],
      reveal: 'Each read of this register pops a byte from the receive buffer, so merging the reads loses a byte and duplicates another. With `volatile`, both reads are kept.' },
    `## const: a promise not to write

\`const\` says the program will not modify an object through that name. The compiler rejects attempts to do so. It has two
further consequences in firmware.

**Placement.** An object defined \`const\` at file scope (or \`static const\`), with an initialiser, does not need to
be writable, so the toolchain puts it in the \`.rodata\` section, which the linker script locates in **flash**. A
non-const initialised table lives in RAM *and* has its initial values stored in flash to be copied at start-up, costing
both. On an MCU with 16 KiB of RAM, a 4 KiB lookup table declared without \`const\` uses a quarter of it. String
literals also live in flash.

**Interfaces.** A \`const uint8_t *\` parameter documents and enforces that a function only reads its input.

\`const\` does not mean "compile-time constant", and it is not a security boundary: a cast can remove it, and writing to
an object that was *defined* const is undefined behaviour. On an MCU the write goes to a flash address, where it is
ignored or raises a fault, depending on the chip.`,
    code(C`
#include <stdint.h>
#include <stdio.h>

static const uint16_t sine_lut[8] = { 0, 707, 1000, 707, 0, 707, 1000, 707 };  /* .rodata: flash */
static uint16_t       gain_table[4] = { 1, 2, 4, 8 };                           /* .data: RAM + flash copy */
static uint32_t       sample_count;                                             /* .bss: RAM, zeroed at start-up */

int main(void)
{
    const char *version = "v1.2";         /* pointer in RAM/stack, characters in flash */
    char        editable[] = "v1.2";      /* 5 bytes on the stack, copied from flash    */

    editable[1] = '9';
    gain_table[0] = 3;
    sample_count++;
    printf("%s %s %u %u %u\n", version, editable,
           (unsigned)sine_lut[1], (unsigned)gain_table[0], (unsigned)sample_count);
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "v1.2 v9.2 707 3 1". The section names in the comments are what a typical GCC linker script does with each definition on an MCU; on the PC they are separate regions of the process image.',
      explain: [
        { lines: '4', md: 'Never written, so it can stay in flash and is read in place. No RAM, no start-up copy.' },
        { lines: '5', md: 'Writable and initialised: the start-up code copies its initial values from flash into RAM before `main` runs.' },
        { lines: '10-11', md: '`version` points at a string literal, which must not be modified. `editable` is an array initialised *from* the literal; its bytes are ordinary writable memory.' },
      ] }),
    `## const volatile: read-only hardware

The two qualifiers answer different questions and combine naturally. \`const\` says *this code* will not write.
\`volatile\` says *something else* may change the value. A read-only status or input register is exactly that:

\`#define GPIO_IN_REG (*(const volatile uint32_t *)0x40000008u)\`

The compiler will reject \`GPIO_IN_REG = 1;\` and will re-read the register every time it is used. CMSIS spells these
combinations \`__I\` (\`volatile const\`), \`__O\` (\`volatile\`, write-only by convention) and \`__IO\` (\`volatile\`).`,
    { t: 'callout', kind: 'decision', title: 'When to add volatile, and when not', md:
`Add it to registers and to data genuinely shared with an interrupt handler. Do **not** sprinkle it on variables "to be
safe" or to make a bug go away: every access to a volatile object is a real memory access, so the optimiser can no longer
keep the value in a CPU register, and the code gets slower and larger. If adding \`volatile\` to an unrelated variable
fixes a problem, the real cause is elsewhere (usually undefined behaviour or a race) and has only been hidden.` },
    clab({
      title: 'Debug: writing to a string that lives in flash',
      prompt: `\`capitalise\` upper-cases the first letter of a string in place. The program stops with a bus fault instead of printing \`Hello\`.

Read the fault message: which address was written, and which memory region is that (see the memory map in \`docs/BENCH_MCU.md\`)? Fix \`main\` so the string is writable. Do not change \`capitalise\`.`,
      starter: C`
#include <stdio.h>

static void capitalise(char *s)
{
    if (s[0] >= 'a' && s[0] <= 'z') {
        s[0] = (char)(s[0] - 'a' + 'A');
    }
}

int main(void)
{
    char *greeting = "hello";
    capitalise(greeting);
    puts(greeting);
    return 0;
}
`,
      solution: C`
#include <stdio.h>

static void capitalise(char *s)
{
    if (s[0] >= 'a' && s[0] <= 'z') {
        s[0] = (char)(s[0] - 'a' + 'A');
    }
}

int main(void)
{
    char greeting[] = "hello";
    capitalise(greeting);
    puts(greeting);
    return 0;
}
`,
      tests: [{ name: 'the string is modified in RAM', stdout: 'Hello\n' }],
      hints: [
        'Look up the faulting address in the Bench-MCU memory map. Which region is it in, and what kind of data does the toolchain put there?',
        'The address starts with `0x0800`: flash, where string literals are stored. `char *greeting = "hello";` makes a pointer to the literal itself. No writable copy exists.',
        'Declare an array instead: `char greeting[] = "hello";` reserves six bytes on the stack and copies the literal into them.',
      ],
      explain: `A string literal is constant data in flash. C lets a plain \`char *\` point at it for historical reasons, so the compiler does not object, and the write fails at run time. Declaring such pointers \`const char *\` turns the mistake into a compile error. GCC's \`-Wwrite-strings\` enforces that for you.`,
    }),
    clab({
      title: 'Write: wait for a byte, but not for ever',
      prompt: `A loop that waits for hardware must be able to give up, or a disconnected cable hangs the device. Implement \`uart_getc_timeout\`:

- Poll the UART status register up to \`max_polls\` times.
- If \`RX_AVAIL\` (bit 1) is seen, read the byte from \`UART_DATA\`, store it in \`*out\` and return \`true\`.
- If the polls run out, return \`false\` and leave \`*out\` unchanged.

Access the status register through the \`const volatile\` pointer provided, so the compiler would reject an accidental write to it.`,
      starter: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RX_AVAIL_BIT (1u << 1)

static const volatile uint32_t *const uart_status = (const volatile uint32_t *)0x40001004u;

static bool uart_getc_timeout(uint8_t *out, uint32_t max_polls)
{
    /* TODO */
    return false;
}

int main(void)
{
    UART_CTRL = 1u;

    for (int i = 0; i < 3; i++) {
        uint8_t c = '?';
        if (uart_getc_timeout(&c, 2000)) {
            printf("got %c\n", c);
        } else {
            printf("timeout (c=%c)\n", c);
        }
    }
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RX_AVAIL_BIT (1u << 1)

static const volatile uint32_t *const uart_status = (const volatile uint32_t *)0x40001004u;

static bool uart_getc_timeout(uint8_t *out, uint32_t max_polls)
{
    while (max_polls > 0) {
        if ((*uart_status & RX_AVAIL_BIT) != 0) {
            *out = (uint8_t)UART_DATA;
            return true;
        }
        max_polls--;
    }
    return false;
}

int main(void)
{
    UART_CTRL = 1u;

    for (int i = 0; i < 3; i++) {
        uint8_t c = '?';
        if (uart_getc_timeout(&c, 2000)) {
            printf("got %c\n", c);
        } else {
            printf("timeout (c=%c)\n", c);
        }
    }
    return 0;
}
`,
      tests: [
        { name: 'two bytes arrive, third wait times out', uartRx: 'AB', stdout: 'got A\ngot B\ntimeout (c=?)\n' },
        { name: 'nothing connected: every wait times out', uartRx: '', stdout: 'timeout (c=?)\ntimeout (c=?)\ntimeout (c=?)\n' },
      ],
      hints: [
        'A wait loop needs two ways out. What are they here, and which one may touch `*out`?',
        '`*uart_status` reads the register; test bit 1 with `& RX_AVAIL_BIT`. Count `max_polls` down inside a `while (max_polls > 0)` loop and return `true` from inside the loop as soon as a byte is available.',
        'Read `UART_DATA` exactly once per byte: each read pops the receive buffer.',
      ],
      explain: `Every pass of the loop dereferences a \`volatile\` pointer, so the status register is read afresh each time. That is the property the opening example lacked. A poll count is a crude timeout because its duration depends on CPU speed and optimisation level; production code compares against a hardware timer instead, but the structure is the same: every wait has an exit.`,
    }),
    { t: 'exercise',
      prompt: 'For each declaration say where a typical MCU toolchain places the object (flash or RAM) and whether the compiler must reload it on every use: (a) `static const uint8_t font[96][5] = {…};` (b) `volatile uint32_t tick_ms;` (c) `static uint8_t rx_buf[64];` (d) `#define ID_REG (*(const volatile uint32_t *)0x40004000u)`',
      hints: [
        '`const` with an initialiser at file scope → read-only data. Anything writable → RAM.',
        'Only `volatile` forces a reload on every use.',
        'A register is neither flash nor RAM: it is at whatever address the hardware decodes.',
      ],
      solution: '(a) Flash (`.rodata`); not reloaded — the compiler may even fold known entries into constants. (b) RAM (`.bss`, zero at start-up); reloaded on every use. (c) RAM (`.bss`); not reloaded, so if an ISR fills it, the code that reads it needs the shared *indices* or flags to be volatile or otherwise synchronised. (d) Neither: it is a peripheral register at a fixed address; reloaded on every use, and writes are rejected at compile time.' },
    `## A harder case: the delay loop that disappears

A common bring-up trick is a busy-wait delay: \`for (uint32_t i = 0; i < 100000; i++) { }\`. At \`-O2\` the loop has no
observable effect, so the compiler deletes it and the delay becomes zero. Making \`i\` volatile forces each increment
to go through memory and brings the delay back, but its length still depends on the compiler, the optimisation level and
the clock frequency. The lesson generalises: when timing matters, use a hardware timer, which counts real clock cycles
regardless of how the C was compiled. And when behaviour changes between \`-O0\` and \`-O2\`, the first two suspects are a
missing \`volatile\` and undefined behaviour.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.7.3 (type qualifiers), §5.1.2.3 (program execution, the as-if rule)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'GCC manual: when is a volatile object accessed?', url: 'https://gcc.gnu.org/onlinedocs/gcc/Volatiles.html' },
      { title: 'GCC manual: options that control optimization', url: 'https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html' },
      { title: 'SEI CERT C: DCL22-C. Use volatile for data that cannot be cached', url: 'https://wiki.sei.cmu.edu/confluence/display/c/DCL22-C.+Use+volatile+for+data+that+cannot+be+cached' },
    ] },
  ],
  quiz: [
    { q: 'A flag set in an ISR is polled by `while (!flag) {}` in `main`. It works at -O0 and hangs at -O2. What is the most likely cause?', kind: 'concept', choices: [
      { t: 'The flag is not volatile, so its read was hoisted out of the loop', ok: true, why: 'Nothing visible in the loop changes the flag, so the compiler may hoist the read out of the loop.' },
      { t: 'The optimiser removed the interrupt handler because nothing calls it', why: 'A handler referenced from the vector table is kept. The handler runs; the loop simply never looks at the result.' },
      { t: '-O2 makes the loop so fast that the interrupt cannot occur', why: 'Interrupts are taken between instructions regardless of how tight the loop is.' },
      { t: 'Optimised code needs more stack, and the stack is too small', why: 'Optimised code usually uses less stack, and a stack problem would not produce a clean infinite loop at this exact spot.' },
    ] },
    { q: 'What does `volatile` guarantee about `counter++` where `counter` is a `volatile uint32_t` shared with an ISR?', kind: 'concept', choices: [
      { t: 'The load and the store both happen, but an interrupt can still come between them', ok: true, why: 'Volatile controls whether accesses are performed, not whether a sequence of them is indivisible.' },
      { t: 'The increment is performed as one uninterruptible machine instruction', why: 'Load-store architectures have no such instruction for memory, and the qualifier does not ask for one.' },
      { t: 'Interrupts are disabled automatically for the duration of the statement', why: 'Nothing in the language disables interrupts. That takes explicit code.' },
      { t: 'The variable is placed in a protected memory region that an ISR cannot write while main uses it', why: 'A volatile variable lives in ordinary RAM. Only the compiler\'s treatment of accesses changes.' },
    ] },
    { q: 'A 2 KiB lookup table is defined as `uint16_t lut[1024] = { … };` at file scope and is never modified. What is the cost compared with adding `const`?', kind: 'arch', choices: [
      { t: 'It uses 2 KiB of RAM as well as 2 KiB of flash, and is copied at start-up', ok: true, why: 'Writable initialised data lives in RAM and is initialised from an image in flash before `main`.' },
      { t: 'None; the linker notices it is never written and moves it to flash', why: 'Placement follows the declared qualifiers. The toolchain does not prove that an object is never written through some pointer.' },
      { t: 'It uses 2 KiB of RAM but no flash, because the values are computed at start-up', why: 'The initial values have to be stored somewhere non-volatile, or they would be lost at power-off.' },
      { t: 'It is slower to read, because RAM is slower than flash', why: 'RAM access is at least as fast as flash on typical MCUs. The cost is memory, not read speed.' },
    ] },
    { q: 'Which declaration best describes a read-only hardware status register?', kind: 'code', choices: [
      { t: '`const volatile uint32_t *status`', ok: true, why: 'The program may not write it (`const`), and its value changes on its own, so every read must be performed (`volatile`).' },
      { t: '`const uint32_t *status`', why: 'Without `volatile` the compiler may assume the value never changes and reuse an old reading.' },
      { t: '`volatile uint32_t *const status`', why: 'This makes the pointer itself constant but still permits writes to the register through it.' },
      { t: '`static uint32_t *status`', why: '`static` affects linkage and lifetime of the pointer variable. It says nothing about how the register behaves.' },
    ] },
    { q: 'A developer "fixes" a sporadic crash by marking several unrelated local variables `volatile`. What is the best assessment?', kind: 'concept', choices: [
      { t: 'It changed the generated code and hid the real defect instead of fixing it', ok: true, why: 'Volatile on locals changes stack layout and timing. A bug that responds to that has not been found, only moved.' },
      { t: 'It is the correct fix; locals should be volatile in embedded code', why: 'Locals that are not shared with an ISR or accessed by hardware gain nothing from the qualifier and become slower.' },
      { t: 'It proves that the compiler has a bug in its optimiser', why: 'Compiler bugs exist but are rare. Sensitivity to optimisation is the classic signature of a defect in the program.' },
      { t: 'It has no effect at all, so the crash must have been fixed by something else', why: 'It does have an effect: every access now goes through memory, which changes layout and timing enough to mask problems.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 8 */
const allocation = {
  id: 'ec-static-vs-dynamic',
  title: 'Static allocation versus dynamic allocation',
  minutes: 55,
  summary: 'Where each kind of variable lives and for how long, the several meanings of static, and why firmware prefers fixed buffers and pools to malloc.',
  skills: ['ec-storage-duration', 'ec-pool-allocator'],
  blocks: [
    `## The problem: it ran for nineteen days

A data logger allocates a buffer with \`malloc\` for each incoming message, sized to the message, and frees it after
processing. It passes every test. In the field, units stop logging after about three weeks. They have not crashed;
\`malloc\` has started returning \`NULL\`, although the total free memory is more than enough. On a PC you would
restart the program. A device in a ceiling void has nobody to restart it.

To see what went wrong, and why most firmware avoids the question entirely, start with where C objects live.

## Three storage durations

| Storage duration | Declared as | Lives | Located | Initial value |
|---|---|---|---|---|
| **Static** | at file scope, or with \`static\` inside a function | for the whole run of the program | \`.data\` / \`.bss\` in RAM at a fixed address chosen by the linker (\`.rodata\` in flash if \`const\`) | the initialiser, or zero |
| **Automatic** | inside a function, without \`static\` | until the enclosing block ends | the stack (or a CPU register) | **indeterminate** unless initialised |
| **Allocated** | obtained from \`malloc\` | until \`free\` is called | the heap | indeterminate (\`calloc\` zeroes) |

The size of all static objects is known when the program is linked: it is printed in the map file and by the
\`size\` tool. If they do not fit in RAM, **the build fails**. Stack and heap usage are decided at run time, and when
they do not fit, the program fails in the field.`,
    { t: 'widget', name: 'stack-heap', props: { program: 'nested' }, caption: 'Step a small program and watch static data and stack frames appear and disappear.' },
    `## The meanings of static

The keyword does two unrelated jobs depending on where it appears.

- **On a variable inside a function**: static storage duration. The variable keeps its value between calls and exists for the whole program, but its name is visible only inside the function.
- **On a variable or function at file scope**: internal linkage. The name is private to this \`.c\` file. Another file can define its own \`static\` function of the same name without conflict, and cannot call yours. This is C's module-level \`private\`.

\`extern\` is the opposite of the second meaning: a declaration that says "this object is defined in some other file".`,
    code(C`
#include <stdint.h>
#include <stdio.h>

static uint32_t error_count;           /* file scope + static: private to this file */

static uint32_t next_sequence(void)    /* private function                          */
{
    static uint32_t seq = 100;         /* initialised once, before main             */
    uint32_t scratch = 0;              /* created afresh on every call              */
    scratch++;
    seq++;
    return seq + scratch - 1;
}

int main(void)
{
    uint32_t a = next_sequence();
    uint32_t b = next_sequence();
    uint32_t c = next_sequence();
    printf("%u %u %u errors=%u\n", (unsigned)a, (unsigned)b, (unsigned)c, (unsigned)error_count);
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "101 102 103 errors=0".',
      explain: [
        { lines: '4', md: 'Lives in `.bss`: the start-up code zeroes it before `main`. No other source file can name it.' },
        { lines: '8', md: 'One object at a fixed RAM address, shared by every call. The initialiser is applied once, as part of the `.data` copy at start-up, not each time the function runs.' },
        { lines: '9', md: 'A stack slot (or register) that exists only during the call. Without the `= 0` it would contain leftovers.' },
      ] }),
    { t: 'callout', kind: 'warn', title: 'A static local makes a function non-reentrant', md:
`All callers share the one object. If the function can be entered again before it has finished — from an interrupt
handler, another task, or simply by being called twice before the first result is used — the calls interfere. The debug
lab below shows the second case, and the interrupt lesson the first.` },
    `## Why malloc is avoided in firmware

\`malloc\` and \`free\` are available on most MCU toolchains. Coding standards for dependable systems restrict or ban
them after initialisation (MISRA C has rules to that effect) for three reasons.

**Fragmentation.** The heap is one region of RAM that the allocator carves into blocks. After a history of allocations
and frees of different sizes, the free space is scattered in pieces. A request fails when no *single* piece is big
enough, however much is free in total. A desktop has gigabytes and virtual memory to hide this. An MCU has kilobytes and
no memory management unit to move things around.`,
    { t: 'ascii', caption: 'A 64-byte heap after a mixed history. 28 bytes are free in total, but the largest free block is 12 bytes, so malloc(16) returns NULL.', text:
`address  0        16       24      36      44     52      64
         |  used  | free 8 | used  | free 8| used | free 12|
         +--------+--------+-------+-------+------+--------+
                    ^                ^               ^
                    +--- 8 + 8 + 12 = 28 bytes free, largest block 12 ---+` },
    { t: 'widget', name: 'stack-heap', props: { program: 'fragmentation' }, caption: 'Step through a sequence of malloc and free calls until a request fails with memory still free.' },
    `**Failure handling.** \`malloc\` can return \`NULL\` at any call, so every call site needs an answer to "and then
what?". In a control loop there is rarely a good one. A design that cannot run out of memory is easier to make correct
than one that must recover from running out at an arbitrary point.

**Determinism.** The time \`malloc\` takes depends on the state of the free list, so its worst case is hard to bound.
That is unacceptable inside an interrupt handler or a hard real-time loop. Standard allocators are also not safe to
call from an ISR.

Leaks and use-after-free complete the picture: with no operating system to reclaim memory, a leak of 16 bytes per hour
is a field failure with a countdown.

## What firmware does instead

- **Static buffers sized for the worst case.** \`static uint8_t rx_buf[256];\` cannot fail, costs nothing at run time, and appears in the map file.
- **Fixed-block pools.** When objects really do come and go (network packets, queued messages), reserve an array of *N* identical blocks and hand them out. Every block is the same size, so fragmentation is impossible, allocation takes bounded time, and "out of blocks" is a clearly defined, testable condition. Most RTOSes provide this.
- **Allocate once at start-up, never free.** Using \`malloc\` only during initialisation gives run-time flexibility without fragmentation.
- **The stack**, for small short-lived data. Keep large arrays off it; stacks on MCUs are often 1–4 KiB.`,
    { t: 'callout', kind: 'decision', title: 'Choosing where a buffer lives', md:
`- Size known at build time and needed for the whole run → **static**.
- Small, needed only during one function call, and the function is not deeply nested → **automatic** (stack).
- Many same-sized objects with overlapping lifetimes → **pool**.
- Sizes genuinely unknown until run time *and* the system can tolerate allocation failure → heap, with every result checked. This is rare in small firmware. Environments such as ESP-IDF, which run a full RTOS with a managed heap, use dynamic allocation routinely, and provide tools to monitor it.` },
    { t: 'predict',
      q: 'What is wrong with this function?',
      code: C`
const char *device_name(uint8_t id)
{
    char name[12];
    name[0] = 'D'; name[1] = (char)('0' + id); name[2] = 0;
    return name;
}`,
      choices: [
        { t: 'It returns the address of an automatic array that no longer exists', ok: true, why: 'The caller receives a pointer into a dead stack frame. The next function call reuses those bytes.' },
        { t: 'A function cannot return a pointer to `char`, only an integer value', why: 'Returning pointers is normal. What matters is whether the pointed-to object outlives the call.' },
        { t: 'The array is too small for the string it has to hold', why: 'Three bytes are written into twelve. The size is not the problem here.' },
        { t: 'Nothing; the string is copied to the caller when the function returns', why: 'Only the 4-byte address is returned. C never copies an array on return.' },
      ],
      reveal: 'GCC warns ("function returns address of local variable"). The fixes are a caller-supplied buffer, or a static buffer with the reentrancy caveat above.' },
    clab({
      title: 'Debug: two labels, one buffer',
      prompt: `\`format_id\` builds a label such as \`ID-BEEF\` and returns it. \`main\` formats two IDs and prints both. The output should be:

\`ID-BEEF ID-0042\`

Run it and observe. The function returns a pointer to a local array. Making that array \`static\` is the usual first idea: try it, and work out why the output is still wrong. Then change the interface so that the **caller** provides the buffer and its size.`,
      starter: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static const char HEX[] = "0123456789ABCDEF";

static const char *format_id(uint16_t id)
{
    char buf[8];
    buf[0] = 'I';
    buf[1] = 'D';
    buf[2] = '-';
    buf[3] = HEX[(id >> 12) & 0xF];
    buf[4] = HEX[(id >> 8) & 0xF];
    buf[5] = HEX[(id >> 4) & 0xF];
    buf[6] = HEX[id & 0xF];
    buf[7] = 0;
    return buf;
}

int main(void)
{
    const char *a = format_id(0xBEEF);
    const char *b = format_id(0x0042);
    printf("%s %s\n", a, b);
    return 0;
}
`,
      solution: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static const char HEX[] = "0123456789ABCDEF";

static void format_id(uint16_t id, char *out, size_t out_size)
{
    if (out == NULL || out_size < 8) {
        if (out != NULL && out_size > 0) {
            out[0] = 0;
        }
        return;
    }
    out[0] = 'I';
    out[1] = 'D';
    out[2] = '-';
    out[3] = HEX[(id >> 12) & 0xF];
    out[4] = HEX[(id >> 8) & 0xF];
    out[5] = HEX[(id >> 4) & 0xF];
    out[6] = HEX[id & 0xF];
    out[7] = 0;
}

int main(void)
{
    char a[8];
    char b[8];
    format_id(0xBEEF, a, sizeof(a));
    format_id(0x0042, b, sizeof(b));
    printf("%s %s\n", a, b);
    return 0;
}
`,
      tests: [{ name: 'both labels survive', stdout: 'ID-BEEF ID-0042\n' }],
      hints: [
        'For each of the two pointers in \`main\`, name the object it points at and say when that object stops existing. Then ask the same question for the \`static\` version: how many buffers are there?',
        'With the local array, both pointers refer to a released stack frame. With `static char buf[8]` the storage survives, but there is only one buffer: `a` and `b` are the same address, so both print the last ID.',
        'Change the signature to `void format_id(uint16_t id, char *out, size_t out_size)`, give `main` two arrays, and pass `sizeof` of each.',
      ],
      explain: `Three designs, three lifetimes. Automatic: the result is dead on return. Static: the result is overwritten by the next call (and by an interrupt handler that calls the same function). Caller-supplied: each caller owns its storage and decides how long it lives. Passing the size alongside the pointer lets the function refuse a buffer that is too small. This is the standard shape of an embedded formatting or driver API.`,
    }),
    clab({
      title: 'Write: a fixed-block pool allocator',
      prompt: `Implement a pool of \`POOL_BLOCKS\` blocks of \`BLOCK_SIZE\` bytes each, backed by one static array.

- \`pool_alloc()\` returns a pointer to the lowest-numbered free block and marks it used, or returns \`NULL\` when every block is in use.
- \`pool_free(p)\` returns \`true\` and marks the block free if \`p\` is the start of a block that is currently in use. It returns \`false\` for \`NULL\`, a pointer outside the pool, a pointer into the middle of a block, or a block that is already free.

\`main\` exercises exhaustion, reuse, a pointer into the middle of a block, a pointer to a different buffer and a double free, and finally checks that the data the owners wrote into blocks 0 and 3 is still there.`,
      starter: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define POOL_BLOCKS 4
#define BLOCK_SIZE  16

static bool    pool_used[POOL_BLOCKS];
static uint8_t pool_mem[POOL_BLOCKS * BLOCK_SIZE];
static uint8_t other_buf[BLOCK_SIZE];        /* some other module's buffer: not part of the pool */

static void *pool_alloc(void)
{
    /* TODO */
    return NULL;
}

static bool pool_free(void *p)
{
    /* TODO */
    return false;
}

static int block_index(void *p)
{
    if (p == NULL) {
        return -1;
    }
    return (int)(((uint8_t *)p - pool_mem) / BLOCK_SIZE);
}

int main(void)
{
    void *b[5];
    for (int i = 0; i < 5; i++) {
        b[i] = pool_alloc();
        printf("alloc -> %d\n", block_index(b[i]));
        if (b[i] != NULL) {
            memset(b[i], 0xA0 + i, BLOCK_SIZE);      /* the owner uses its whole block */
        }
    }

    printf("free block 1: %d\n", pool_free(b[1]));
    printf("alloc -> %d\n", block_index(pool_alloc()));

    printf("free middle of block: %d\n", pool_free(pool_mem + 3));
    printf("free a buffer outside the pool: %d\n", pool_free(other_buf));
    printf("free NULL: %d\n", pool_free(NULL));

    printf("free block 2: %d\n", pool_free(b[2]));
    printf("free block 2 again: %d\n", pool_free(b[2]));

    printf("block contents: %02X %02X %02X %02X\n", pool_mem[0], pool_mem[BLOCK_SIZE - 1],
           pool_mem[3 * BLOCK_SIZE], pool_mem[4 * BLOCK_SIZE - 1]);
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define POOL_BLOCKS 4
#define BLOCK_SIZE  16

static bool    pool_used[POOL_BLOCKS];
static uint8_t pool_mem[POOL_BLOCKS * BLOCK_SIZE];
static uint8_t other_buf[BLOCK_SIZE];        /* some other module's buffer: not part of the pool */

static void *pool_alloc(void)
{
    for (int i = 0; i < POOL_BLOCKS; i++) {
        if (!pool_used[i]) {
            pool_used[i] = true;
            return &pool_mem[i * BLOCK_SIZE];
        }
    }
    return NULL;
}

static bool pool_free(void *p)
{
    uint8_t *q = (uint8_t *)p;
    if (q == NULL || q < pool_mem || q >= pool_mem + POOL_BLOCKS * BLOCK_SIZE) {
        return false;
    }
    uint32_t offset = (uint32_t)(q - pool_mem);
    if (offset % BLOCK_SIZE != 0) {
        return false;
    }
    uint32_t index = offset / BLOCK_SIZE;
    if (!pool_used[index]) {
        return false;
    }
    pool_used[index] = false;
    return true;
}

static int block_index(void *p)
{
    if (p == NULL) {
        return -1;
    }
    return (int)(((uint8_t *)p - pool_mem) / BLOCK_SIZE);
}

int main(void)
{
    void *b[5];
    for (int i = 0; i < 5; i++) {
        b[i] = pool_alloc();
        printf("alloc -> %d\n", block_index(b[i]));
        if (b[i] != NULL) {
            memset(b[i], 0xA0 + i, BLOCK_SIZE);      /* the owner uses its whole block */
        }
    }

    printf("free block 1: %d\n", pool_free(b[1]));
    printf("alloc -> %d\n", block_index(pool_alloc()));

    printf("free middle of block: %d\n", pool_free(pool_mem + 3));
    printf("free a buffer outside the pool: %d\n", pool_free(other_buf));
    printf("free NULL: %d\n", pool_free(NULL));

    printf("free block 2: %d\n", pool_free(b[2]));
    printf("free block 2 again: %d\n", pool_free(b[2]));

    printf("block contents: %02X %02X %02X %02X\n", pool_mem[0], pool_mem[BLOCK_SIZE - 1],
           pool_mem[3 * BLOCK_SIZE], pool_mem[4 * BLOCK_SIZE - 1]);
    return 0;
}
`,
      tests: [{ name: 'exhaustion, reuse and invalid frees', stdout: 'alloc -> 0\nalloc -> 1\nalloc -> 2\nalloc -> 3\nalloc -> -1\nfree block 1: 1\nalloc -> 1\nfree middle of block: 0\nfree a buffer outside the pool: 0\nfree NULL: 0\nfree block 2: 1\nfree block 2 again: 0\nblock contents: A0 A0 A3 A3\n' }],
      hints: [
        'Block *i* starts how many bytes into `pool_mem`? Going the other way: given a pointer, how do you get its byte offset, and which two properties must that offset have before you may use it as an index into `pool_used`?',
        '`pool_alloc`: scan `pool_used` for the first `false`, set it to `true`, and return `&pool_mem[i * BLOCK_SIZE]`.',
        '`pool_free`: convert to `uint8_t *`, reject NULL and anything below `pool_mem` or at/after `pool_mem + POOL_BLOCKS * BLOCK_SIZE`. The byte offset `q - pool_mem` must be a multiple of `BLOCK_SIZE`. Offset divided by `BLOCK_SIZE` is the block index; reject it if `pool_used[index]` is already false.',
      ],
      explain: `Because every block has the same size, any free block satisfies any request: the pool cannot fragment. Allocation is at most \`POOL_BLOCKS\` steps, so its worst-case time is known. Exhaustion is an explicit \`NULL\` that the design can plan for ("drop the packet and count it"). The validation in \`pool_free\` turns a double free or a stray pointer, which would silently corrupt a general-purpose heap, into a detectable error. Without the range check, \`pool_free(other_buf)\` computes index 4 and reads \`pool_used[4]\`, which is not a flag at all but the first data byte of block 0; it then "frees" it by writing a zero there, which is why the last line of the test prints the block contents. One point of strict C: comparing pointers into *different* objects with \`<\` is formally undefined (C11 §6.5.8), although it works on every flat-address MCU; code that must be strictly conforming converts both to \`uintptr_t\` first and compares the integers. If a pool is used from both an ISR and the main loop, the scan-and-mark must be protected by a critical section.`,
    }),
    { t: 'exercise',
      prompt: 'An MCU has 8 KiB of RAM. The map file shows `.data` 300 bytes and `.bss` 5 200 bytes. The stack is given 1 024 bytes. A function called from `main` declares `uint8_t frame[2048];` as a local. How many bytes of RAM remain for the heap, and what happens when that function is called?',
      hints: [
        '8 KiB is 8 192 bytes. Subtract the static sections and the stack reservation.',
        'The local array is automatic: it is taken from the stack, not from the remaining space.',
        'Compare the array size with the stack size.',
      ],
      solution: '8 192 − 300 − 5 200 − 1 024 = 1 668 bytes remain for a heap. The call needs 2 048 bytes of stack for `frame` alone, twice what the stack has. The stack pointer moves down past the end of the stack region and the function writes over whatever lies below it (heap or `.bss`, depending on the linker script). Nothing checks this by default: the result is corrupted variables, not an error message. The array should be static, or the frame processed in smaller pieces.',
      answer: { type: 'number', value: 1668, tol: 0, unit: 'bytes' } },
    `## A harder case: budgeting memory before writing code

A sensor node has 16 KiB of RAM and must hold: a 512-byte UART receive buffer, a queue of up to 8 outgoing packets of at
most 128 bytes, a 1 KiB TLS-style crypto work area, and two task stacks. With static allocation you can add these up at
design time (512 + 8 × 128 + 1 024 = 2 560 bytes plus stacks) and the linker confirms the total on every build. With a
heap you would instead have to show that no order of packet arrivals and departures can fragment it, which is much harder
to argue and to test. This is the engineering argument for static allocation and pools: they move a question from "what
happens at run time" to "does it link".`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.2.4 (storage durations of objects), §6.2.2 (linkages of identifiers), §7.22.3 (memory management functions)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'SEI CERT C: MEM30-C, MEM31-C, MEM34-C (memory management rules) and DCL30-C (declare objects with appropriate storage durations)', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard' },
      { title: 'GNU ld manual: linker map files and section placement', url: 'https://sourceware.org/binutils/docs/ld/' },
    ] },
  ],
  quiz: [
    { q: 'What does `static` mean on a function defined at file scope?', kind: 'concept', choices: [
      { t: 'The function\'s name is visible only within that source file', ok: true, why: 'Internal linkage: the linker does not export the symbol, so other files cannot call it or clash with it.' },
      { t: 'The function\'s local variables keep their values between calls', why: 'That requires `static` on each local variable. On the function itself the keyword affects only name visibility.' },
      { t: 'The function is placed in RAM instead of flash', why: 'Code placement is decided by sections and the linker script, not by this keyword.' },
      { t: 'The function cannot be interrupted', why: 'No C keyword influences interrupt masking.' },
    ] },
    { q: 'A heap has 600 bytes free in total and `malloc(256)` returns NULL. What is the most likely reason?', kind: 'arch', choices: [
      { t: 'The free memory is split into pieces, none of them 256 bytes long', ok: true, why: 'An allocation needs one contiguous block. Fragmentation leaves plenty of total space with no usable piece.' },
      { t: '`malloc` can only hand out blocks whose size is a power of two', why: 'Some allocators round sizes up, but 256 is already a power of two, and rounding does not explain a failure with 600 bytes free.' },
      { t: 'The heap\'s bookkeeping is corrupted, which always shows up as NULL', why: 'Corruption is possible but shows up as crashes or wild behaviour. A clean NULL with free space remaining is the ordinary signature of fragmentation.' },
      { t: 'The stack has overflowed into the heap and used the space', why: 'A stack overflow corrupts memory rather than making the allocator report failure in an orderly way.' },
    ] },
    { q: 'Why does a fixed-block pool not suffer from fragmentation?', kind: 'concept', choices: [
      { t: 'All blocks are the same size, so any free block fits any request', ok: true, why: 'Fragmentation is the problem of free pieces being the wrong size. With one size there is no wrong size.' },
      { t: 'It compacts memory after every free, moving live blocks together', why: 'Compaction would require moving live objects and updating pointers to them, which a C allocator cannot do.' },
      { t: 'It never returns memory, so no holes can appear between blocks', why: 'Blocks are returned to the pool and reused. That is the point of a pool over allocate-once.' },
      { t: 'It takes its blocks from the stack instead of the heap, which cannot fragment', why: 'A pool is normally a static array. Its blocks outlive any single function call.' },
    ] },
    { q: 'What value does an uninitialised local `uint32_t total;` hold when a function starts?', kind: 'code', choices: [
      { t: 'Whatever earlier code left in that stack slot or register', ok: true, why: 'Automatic variables are not initialised. Reading one before assigning it is undefined behaviour.' },
      { t: '0, because C sets every variable to zero when it is created', why: 'Zero initialisation applies to static storage only (`.bss`). The stack is reused without clearing.' },
      { t: '0xFFFFFFFF, because unused memory reads as erased', why: 'That pattern belongs to erased flash. RAM holds whatever was last written there.' },
      { t: 'None: the compiler refuses to compile any use of it', why: 'At most the compiler warns (`-Wuninitialized`), and only when it can see the path.' },
    ] },
    { q: 'A function keeps its result in a `static char buf[32]` and returns `buf`. Which use is broken?', code: 'printf("%s %s\\n", to_hex(a), to_hex(b));', kind: 'code', choices: [
      { t: 'This one: both arguments are the same pointer, so one text is printed twice', ok: true, why: 'Both calls finish before `printf` runs, and the second call overwrote the single shared buffer.' },
      { t: 'None; static storage makes each returned result permanent', why: 'The storage is permanent, but its contents are replaced by every call.' },
      { t: 'It fails only when `a` equals `b`, because only then is the buffer written twice', why: 'With equal inputs the output would happen to look right. The failure appears precisely when they differ.' },
      { t: 'It leaks 32 bytes of memory on every call', why: 'A static buffer is allocated once by the linker. Nothing is allocated per call, so nothing can leak.' },
    ] },
  ],
};

export default [registers, structs, volatileConst, allocation];
