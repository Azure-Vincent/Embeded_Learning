// Embedded C, part C: interrupt-safe programming, memory alignment, defensive C.
import { C, clab, code } from './util.js';
import { writerLab, copyLab } from './labs-extra.js';

/* ------------------------------------------------------------------ lesson 9 */
const isrSafe = {
  id: 'ec-interrupt-safe',
  title: 'Interrupt-safe programming',
  minutes: 65,
  summary: 'What can go wrong when an interrupt handler and the main program touch the same data, and the small set of patterns that make sharing safe.',
  skills: ['ec-isr-shared-data', 'ec-ring-buffer'],
  blocks: [
    `## The problem: a counter that loses counts

A flow meter produces one pulse per millilitre. A pin interrupt adds each pulse to \`pending_ml\`; the main loop takes
pulses off that counter as it accounts for them. On the bench the totals match. In a long test the device reports less
liquid than was actually delivered, by a small and different amount each run. No line of code looks wrong.

The cause is that a C statement is not one indivisible step, and an interrupt can arrive between any two machine
instructions.

## Theory

### An interrupt handler is a function you did not call

When an enabled interrupt becomes pending, the CPU finishes the instruction it is executing, saves its state, and runs
the handler (the interrupt service routine, **ISR**). When the handler returns, the main program resumes at the next
instruction, unaware that anything happened. Anything the main program had copied into a CPU register *before* the
interrupt is still there afterwards, even if the ISR has changed the variable it was copied from.

### Read-modify-write is not atomic

\`pending--;\` on a variable in memory compiles to three steps on a load-store CPU such as Arm or RISC-V:`,
    { t: 'ascii', caption: 'The main program decrements while the ISR increments. One of the two updates is lost.', text:
`main:  LOAD   r0 <- pending        (r0 = 5)
                                              <-- interrupt here
ISR:          LOAD r1 <- pending   (r1 = 5)
ISR:          ADD  r1 <- r1 + 1    (r1 = 6)
ISR:          STORE pending <- r1  (pending = 6)
                                              <-- ISR returns
main:  SUB    r0 <- r0 - 1         (r0 = 4)   stale copy
main:  STORE  pending <- r0        (pending = 4)   should be 5: one pulse lost` },
    `An operation is **atomic** if it cannot be observed half-done. A single aligned load or store of a value no wider
than the CPU's word is atomic on the MCUs in this course. A read-modify-write is not. This is a **race condition**: the
result depends on timing. It is also the reason such bugs survive testing: the window is a few instructions wide and
the interrupt has to land inside it.`,
    { t: 'widget', name: 'race-condition', props: { scenario: 'counter' }, caption: 'Interleave the load, modify and store steps by hand until an update disappears, then protect them.' },
    `### Multi-word reads can be torn

Even a plain read is unsafe when the value is wider than the CPU can load in one instruction: a \`uint32_t\` on an 8- or
16-bit MCU, a \`uint64_t\` on a 32-bit one, or any struct with several related fields. The reader gets part of the old
value and part of the new. The model below plays the part of an 8-bit CPU reading a 16-bit tick counter one byte at a
time, with the timer interrupt arriving between the two byte reads:`,
    code(C`
#include <stdint.h>
#include <stdio.h>

static uint8_t tick_lo = 0xFF, tick_hi = 0x00;      /* a 16-bit counter holding 0x00FF */

static void timer_isr(void)                          /* increments the 16-bit counter   */
{
    tick_lo++;
    if (tick_lo == 0) {
        tick_hi++;
    }
}

int main(void)
{
    uint8_t lo = tick_lo;        /* main reads the low byte ...                 */
    timer_isr();                 /* ... the interrupt fires between the reads   */
    uint8_t hi = tick_hi;        /* ... then main reads the high byte           */

    uint16_t seen = (uint16_t)((hi << 8) | lo);
    printf("before=0x00FF after=0x0100 main saw=0x%04X\n", seen);
    return 0;
}
`, 'host-tested', { caption: 'Prints "before=0x00FF after=0x0100 main saw=0x01FF". The value 0x01FF never existed: it is nearly twice the true count. This is a model on a PC in which the "interrupt" is an ordinary function call placed at the worst moment.' }),
    `## Making shared access safe

### 1. Critical sections

Disable interrupts, do the short operation, restore them. While interrupts are masked the handler cannot run, so the
sequence is atomic with respect to it. On Bench-MCU the calls are \`irq_disable()\` and \`irq_enable()\`.

Real code should **save and restore** the previous interrupt state instead of unconditionally re-enabling, so the
helper can be used from code that already has interrupts off:`,
    code(C`
#include <stdint.h>
#include "cmsis_compiler.h"      /* via the device header on a Cortex-M project */

static volatile uint32_t pending_ml;

uint32_t take_pending(void)
{
    uint32_t primask = __get_PRIMASK();   /* remember whether interrupts were enabled */
    __disable_irq();                      /* mask all configurable interrupts         */

    uint32_t n = pending_ml;              /* the protected sequence: keep it short    */
    pending_ml = 0;

    __set_PRIMASK(primask);               /* restore the previous state               */
    return n;
}
`, 'reviewed', { caption: 'Cortex-M form using the CMSIS-Core functions __get_PRIMASK, __disable_irq and __set_PRIMASK. Not compiled here (it needs a CMSIS device header) and not run on hardware. Other architectures and RTOSes provide equivalents, such as portENTER_CRITICAL in FreeRTOS-based SDKs.' }),
    `The price of a critical section is **interrupt latency**: an event that occurs while interrupts are masked waits. Keep
critical sections to a few statements and never call anything slow inside one.

### 2. Make the access atomic by design

- Use the hardware's set/clear registers instead of RMW on shared registers (previous lesson).
- Share a single word-sized flag or counter that only **one side writes**. If the ISR is the only writer and main only reads a word-sized value, no critical section is needed for that read.
- For a multi-word value, read it twice and retry until both reads agree, or copy it inside a critical section.

### 3. A queue with one writer per index

The standard way to pass a stream of bytes from an ISR to the main loop is a **ring buffer** (circular buffer): a
fixed array with a \`head\` index where the producer writes and a \`tail\` index where the consumer reads. Both indices
wrap to 0 at the end of the array.`,
    { t: 'ascii', caption: 'An 8-slot ring buffer holding three bytes. Empty when head == tail; full when advancing head would make it equal to tail, so one slot always stays unused.', text:
`index:    0     1     2     3     4     5     6     7
        +-----+-----+-----+-----+-----+-----+-----+-----+
data:   |     |     | 'a' | 'b' | 'c' |     |     |     |
        +-----+-----+-----+-----+-----+-----+-----+-----+
                      ^                 ^
                     tail              head
                 (consumer reads,   (producer writes,
                  then advances)     then advances)

count = (head - tail) mod 8        next(i) = (i + 1) mod 8` },
    `With exactly **one producer and one consumer** (SPSC), this needs no critical section on a CPU where storing an
index is atomic:

- only the producer ever writes \`head\`; only the consumer ever writes \`tail\`;
- the producer writes the data byte **first** and publishes it by updating \`head\` **afterwards**, so the consumer never sees a slot that is not filled yet;
- each side reads the other's index once; a stale value only makes the buffer look slightly fuller or emptier than it is, which is safe.

The indices must be \`volatile\`, since each side sees the other's index change. With two producers (two ISRs, or an ISR
and main both writing) this reasoning no longer holds and you need a critical section again. On multi-core chips such
as the ESP32, lock-free sharing also depends on memory ordering between cores; use the RTOS queue primitives there.

## Rules for interrupt handlers`,
    { t: 'callout', kind: 'decision', title: 'Do the minimum in the ISR, the rest in main', md:
`An ISR should capture what is urgent (read the data register, note the time, clear the flag), hand it to the main
program through a flag or a queue, and return. Processing belongs in the main loop or a task, because:

- while an ISR runs, interrupts of the same or lower priority wait: a long ISR makes every other response late;
- the main program can use functions that an ISR must not.

**Do not call from an ISR:** anything that blocks or waits (delays, polling loops for another peripheral), \`printf\` and
other buffered I/O, \`malloc\`/\`free\`, and in general any function that is not **reentrant**.` },
    `A function is **reentrant** if it can be interrupted in the middle and safely called again before the first call
finishes. That requires that it uses only its arguments and locals, with no static buffers, no shared hardware state
and no unprotected global data. \`printf\` and \`malloc\` usually fail all three: they keep internal buffers and free
lists, and an ISR that enters them while the main program is halfway through an update of those structures corrupts
them. Some C library functions with hidden static state (\`strtok\`, \`rand\`) are non-reentrant too.`,
    { t: 'callout', kind: 'mistake', title: 'Forgetting to acknowledge the interrupt source', md:
`Most peripherals keep their interrupt request asserted until the handler clears the status flag (often write-1-to-clear)
or reads the data register. If the handler returns without doing so, the interrupt fires again immediately and the main
program never runs. The symptom is a device that appears frozen while a debugger shows it is always inside the same
handler. The opposite mistake, clearing *all* flags with \`|=\`, discards events that arrived in the meantime.` },
    { t: 'predict',
      q: 'A 32-bit Cortex-M program shares `volatile uint32_t ms_ticks` between a timer ISR, which does `ms_ticks++`, and main, which only reads it with `uint32_t now = ms_ticks;`. Is a critical section needed around the read?',
      choices: [
        { t: 'No: a single aligned 32-bit load is atomic on this CPU and main never writes the variable', ok: true, why: 'Main gets either the old or the new value, both valid. The ISR\'s increment cannot be disturbed because nothing else writes.' },
        { t: 'Yes: every access to a shared variable needs interrupts disabled', why: 'The danger is in sequences an interrupt can split. One word-sized load cannot be split, and there is no competing write from main.' },
        { t: 'No, because `volatile` makes all accesses atomic', why: 'Volatile only forces the access to be performed. The read is safe here because of the variable\'s size and the single-writer design.' },
        { t: 'Yes, because the ISR\'s `++` is a read-modify-write', why: 'It is, but the ISR itself cannot be interrupted by main, and main does not write. The RMW would matter if main also modified the variable.' },
      ],
      reveal: 'Change any one condition and the answer flips: a `uint64_t` counter, an 8-bit MCU, or main also writing the variable each need protection.' },
    clab({
      title: 'Debug: pulses that go missing',
      prompt: `A timer interrupt stands in for the flow-meter pulse: each one adds to \`produced\` and \`pending\`. The main loop takes pulses off \`pending\` one at a time and counts them in \`handled\`. At the end \`produced - handled\` should be 0.

The decrement is written as three statements to match the load, modify and store instructions a compiler emits for \`pending--\`. Run it and look at \`lost\`: the pulses arrive while main is in the middle of a decrement. Then make the decrement safe with a critical section (\`irq_disable()\` / \`irq_enable()\`). Keep the critical section as short as you can.

Keep the three statements. Folding them back into \`pending--\` makes the loss disappear **only in this simulator**, which delivers interrupts between statements; a real CPU can take the interrupt between the load and the store inside that one statement.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static volatile uint32_t pending;     /* pulses not yet accounted for */
static volatile uint32_t produced;    /* every pulse ever seen        */

static void timer_isr(void)
{
    TIM_STATUS = 1u;                  /* acknowledge (write 1 to clear) */
    produced++;
    pending++;
}

int main(void)
{
    uint32_t handled = 0;

    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 7;                     /* pulses arrive faster than main handles them */
    TIM_CTRL = 0x7u;                  /* ENABLE | AUTO_RELOAD | IRQ_EN */

    while (produced < 40) {
        if (pending > 0) {
            uint32_t tmp = pending;   /* load   */
            tmp = tmp - 1;            /* modify */
            pending = tmp;            /* store  */
            handled++;
        }
    }

    TIM_CTRL = 0;                     /* stop the pulses, then drain what is left */
    while (pending > 0) {
        pending = pending - 1;
        handled++;
    }

    printf("lost=%u\n", produced - handled);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static volatile uint32_t pending;     /* pulses not yet accounted for */
static volatile uint32_t produced;    /* every pulse ever seen        */

static void timer_isr(void)
{
    TIM_STATUS = 1u;                  /* acknowledge (write 1 to clear) */
    produced++;
    pending++;
}

int main(void)
{
    uint32_t handled = 0;

    irq_attach(IRQ_TIMER, timer_isr);
    TIM_LOAD = 7;                     /* pulses arrive faster than main handles them */
    TIM_CTRL = 0x7u;                  /* ENABLE | AUTO_RELOAD | IRQ_EN */

    while (produced < 40) {
        if (pending > 0) {
            irq_disable();
            uint32_t tmp = pending;   /* load   */
            tmp = tmp - 1;            /* modify */
            pending = tmp;            /* store  */
            irq_enable();
            handled++;
        }
    }

    TIM_CTRL = 0;                     /* stop the pulses, then drain what is left */
    while (pending > 0) {
        pending = pending - 1;
        handled++;
    }

    printf("lost=%u\n", produced - handled);
    return 0;
}
`,
      tests: [{ name: 'no pulse is lost', stdout: 'lost=0\n' }],
      hints: [
        'Suppose `pending` is 5 and the interrupt arrives right after `tmp = pending`. Follow `pending` and `tmp` through the ISR and the two remaining statements. What should `pending` be at the end, and what is it?',
        'A pulse is lost when the ISR runs after `tmp = pending` and before `pending = tmp`: the store puts back a value that does not include the ISR\'s increment.',
        'Those three statements must not be separated by the interrupt. Mask interrupts just before the load and unmask just after the store. `handled++` is a local of `main` that the ISR never touches, so it stays outside.',
      ],
      explain: `With interrupts masked for three statements, the timer's request simply waits and is served right after \`irq_enable()\`, so nothing is lost and the delay is tiny. \`volatile\` was present all along and did not help: it guarantees the accesses happen, not that they stay together. Bench-MCU delivers interrupts between statements, which is why the decrement was spelled out; on real hardware the single statement \`pending--\` has the same three-step window.`,
    }),
    clab({
      title: 'Write: a single-producer, single-consumer ring buffer',
      prompt: `Implement the two operations of an 8-slot ring buffer that holds at most 7 bytes.

- \`rb_put(rb, byte)\` (the producer, normally an ISR): if the buffer is full return \`false\` and store nothing. Otherwise write the byte at \`head\`, **then** advance \`head\`, and return \`true\`.
- \`rb_get(rb, &byte)\` (the consumer, normally main): if the buffer is empty return \`false\`. Otherwise read the byte at \`tail\`, advance \`tail\`, and return \`true\`.

\`RB_SIZE\` is a power of two, so an index wraps with \`& (RB_SIZE - 1)\`. \`rb_put\` must never write \`tail\` and \`rb_get\` must never write \`head\`.

\`main\` first tests the two functions on their own. In phase 2 it produces 200 bytes while a timer interrupt consumes them between the statements of your \`rb_put\`. Every byte must arrive, and none may be a stale one.`,
      starter: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RB_SIZE 8u                      /* power of two; capacity is RB_SIZE - 1 */

typedef struct {
    uint8_t data[RB_SIZE];
    volatile uint32_t head;             /* written only by the producer */
    volatile uint32_t tail;             /* written only by the consumer */
} ring_t;

static bool rb_put(ring_t *rb, uint8_t byte)
{
    /* TODO */
    return false;
}

static bool rb_get(ring_t *rb, uint8_t *out)
{
    /* TODO */
    return false;
}

static ring_t rb;

static volatile uint32_t got;           /* phase 2: bytes the interrupt-side consumer received */
static volatile uint32_t wrong;         /* ... and how many of them were not the byte that was sent */

static void consumer_isr(void)          /* phase 2: the consumer runs as a timer interrupt */
{
    uint8_t c;
    TIM_STATUS = 1u;
    while (rb_get(&rb, &c)) {
        got++;
        if (c != 0x55u) wrong++;
    }
}

static void drain(int max)
{
    uint8_t c;
    while (max > 0 && rb_get(&rb, &c)) {
        putchar(c);
        max--;
    }
    putchar('\n');
}

int main(void)
{
    int accepted = 0;
    for (uint8_t c = 'a'; c <= 'j'; c++) {          /* ten bytes offered */
        if (rb_put(&rb, c)) accepted++;
    }
    printf("accepted %d\n", accepted);

    drain(3);

    accepted = 0;
    for (uint8_t c = 'W'; c <= 'Z'; c++) {          /* four more offered */
        if (rb_put(&rb, c)) accepted++;
    }
    printf("accepted %d\n", accepted);

    drain(100);

    uint8_t c = '?';
    printf("get on empty: %d %c\n", rb_get(&rb, &c), c);

    /* Phase 2: main produces 200 bytes of 0x55 while a timer interrupt consumes them. */
    irq_attach(IRQ_TIMER, consumer_isr);
    TIM_LOAD = 5;
    TIM_CTRL = 0x7u;                                /* ENABLE | AUTO_RELOAD | IRQ_EN */
    for (int i = 0; i < 200; i++) {
        while (!rb_put(&rb, 0x55u)) { }             /* full: wait for the consumer */
    }
    while (got < 200) { }                           /* let the consumer finish */
    TIM_CTRL = 0;
    printf("stream: got %u, wrong %u\n", got, wrong);
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RB_SIZE 8u                      /* power of two; capacity is RB_SIZE - 1 */

typedef struct {
    uint8_t data[RB_SIZE];
    volatile uint32_t head;             /* written only by the producer */
    volatile uint32_t tail;             /* written only by the consumer */
} ring_t;

static bool rb_put(ring_t *rb, uint8_t byte)
{
    uint32_t head = rb->head;
    uint32_t next = (head + 1u) & (RB_SIZE - 1u);
    if (next == rb->tail) {
        return false;                   /* full */
    }
    rb->data[head] = byte;              /* fill the slot first ...      */
    rb->head = next;                    /* ... then publish it          */
    return true;
}

static bool rb_get(ring_t *rb, uint8_t *out)
{
    uint32_t tail = rb->tail;
    if (tail == rb->head) {
        return false;                   /* empty */
    }
    *out = rb->data[tail];
    rb->tail = (tail + 1u) & (RB_SIZE - 1u);
    return true;
}

static ring_t rb;

static volatile uint32_t got;           /* phase 2: bytes the interrupt-side consumer received */
static volatile uint32_t wrong;         /* ... and how many of them were not the byte that was sent */

static void consumer_isr(void)          /* phase 2: the consumer runs as a timer interrupt */
{
    uint8_t c;
    TIM_STATUS = 1u;
    while (rb_get(&rb, &c)) {
        got++;
        if (c != 0x55u) wrong++;
    }
}

static void drain(int max)
{
    uint8_t c;
    while (max > 0 && rb_get(&rb, &c)) {
        putchar(c);
        max--;
    }
    putchar('\n');
}

int main(void)
{
    int accepted = 0;
    for (uint8_t c = 'a'; c <= 'j'; c++) {          /* ten bytes offered */
        if (rb_put(&rb, c)) accepted++;
    }
    printf("accepted %d\n", accepted);

    drain(3);

    accepted = 0;
    for (uint8_t c = 'W'; c <= 'Z'; c++) {          /* four more offered */
        if (rb_put(&rb, c)) accepted++;
    }
    printf("accepted %d\n", accepted);

    drain(100);

    uint8_t c = '?';
    printf("get on empty: %d %c\n", rb_get(&rb, &c), c);

    /* Phase 2: main produces 200 bytes of 0x55 while a timer interrupt consumes them. */
    irq_attach(IRQ_TIMER, consumer_isr);
    TIM_LOAD = 5;
    TIM_CTRL = 0x7u;                                /* ENABLE | AUTO_RELOAD | IRQ_EN */
    for (int i = 0; i < 200; i++) {
        while (!rb_put(&rb, 0x55u)) { }             /* full: wait for the consumer */
    }
    while (got < 200) { }                           /* let the consumer finish */
    TIM_CTRL = 0;
    printf("stream: got %u, wrong %u\n", got, wrong);
    return 0;
}
`,
      tests: [{ name: 'fill, overflow, wrap-around and empty', stdout: 'accepted 7\nabc\naccepted 3\ndefgWXY\nget on empty: 0 ?\nstream: got 200, wrong 0\n' }],
      hints: [
        'How do you tell an empty buffer from a full one if all you have is two indices? And in `rb_put`: at which statement does the consumer first become able to see the new slot?',
        'Empty is `head == tail`. Full is `((head + 1) & (RB_SIZE - 1)) == tail`.',
        'In `rb_put`: compute `next`, return `false` if it equals `tail`, otherwise store the byte at `data[head]` and only then assign `head = next`. In `rb_get`: if `tail == head` return `false`; otherwise copy `data[tail]` to `*out` and advance `tail` with the same wrap expression.',
      ],
      explain: `Seven of the ten bytes fit because one slot is kept empty to tell "full" from "empty". After three are read, three more fit, and the second batch wraps past the end of the array to index 0. The order inside \`rb_put\` is the whole safety argument: until \`head\` is updated, the consumer cannot see the slot, so it never reads a byte that has not been written. Each function reads its own index into a local once and writes it once. Phase 2 is the proof: swap the two statements in \`rb_put\` (advance \`head\`, then store) and the interrupt occasionally runs between them, reads the slot before it is filled, and \`wrong\` is no longer 0.`,
    }),
    clab({
      title: 'Modify: receive by interrupt instead of polling',
      prompt: `The ring buffer from the previous exercise is provided, and \`main\` already takes bytes out of it, converts lower-case letters to upper case and transmits them until it sees a newline. Nothing ever puts bytes *in*.

Add the missing half:

1. Write \`uart_rx_isr\`: read the received byte from \`UART_DATA\` (this also clears the request) and \`rb_put\` it. If the buffer is full, count the byte in \`dropped\`.
2. In \`main\`, attach the handler to \`IRQ_UART_RX\` and enable the UART with its receive interrupt (\`UART_CTRL\` bit 0 \`ENABLE\`, bit 1 \`RX_IRQ_EN\`).

The ISR must not transmit or print anything.

The second test sends a burst of 20 bytes while \`main\` is still busy starting up. The ring holds 15, so exactly 5 must be counted as dropped, and the line that arrives later must still get through.`,
      starter: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RB_SIZE 16u

typedef struct {
    uint8_t data[RB_SIZE];
    volatile uint32_t head;
    volatile uint32_t tail;
} ring_t;

static ring_t rx_ring;
static volatile uint32_t dropped;

static bool rb_put(ring_t *rb, uint8_t byte)
{
    uint32_t head = rb->head;
    uint32_t next = (head + 1u) & (RB_SIZE - 1u);
    if (next == rb->tail) return false;
    rb->data[head] = byte;
    rb->head = next;
    return true;
}

static bool rb_get(ring_t *rb, uint8_t *out)
{
    uint32_t tail = rb->tail;
    if (tail == rb->head) return false;
    *out = rb->data[tail];
    rb->tail = (tail + 1u) & (RB_SIZE - 1u);
    return true;
}

static void uart_putc(uint8_t c)
{
    while ((UART_STATUS & UART_TX_READY) == 0) { }
    UART_DATA = c;
}

static void uart_rx_isr(void)
{
    /* TODO: move one received byte into rx_ring, or count it as dropped */
}

int main(void)
{
    /* TODO: attach the handler and enable the UART with its RX interrupt */
    UART_CTRL = 0x1u;

    /* Start-up work that takes a while. The sender does not wait for it. */
    for (volatile uint32_t i = 0; i < 300; i++) { }

    bool done = false;
    while (!done) {
        uint8_t c;
        if (rb_get(&rx_ring, &c)) {
            if (c >= 'a' && c <= 'z') {
                c = (uint8_t)(c - 'a' + 'A');
            }
            uart_putc(c);
            if (c == '\n') {
                done = true;
            }
        }
    }
    printf("dropped=%u\n", dropped);
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define RB_SIZE 16u

typedef struct {
    uint8_t data[RB_SIZE];
    volatile uint32_t head;
    volatile uint32_t tail;
} ring_t;

static ring_t rx_ring;
static volatile uint32_t dropped;

static bool rb_put(ring_t *rb, uint8_t byte)
{
    uint32_t head = rb->head;
    uint32_t next = (head + 1u) & (RB_SIZE - 1u);
    if (next == rb->tail) return false;
    rb->data[head] = byte;
    rb->head = next;
    return true;
}

static bool rb_get(ring_t *rb, uint8_t *out)
{
    uint32_t tail = rb->tail;
    if (tail == rb->head) return false;
    *out = rb->data[tail];
    rb->tail = (tail + 1u) & (RB_SIZE - 1u);
    return true;
}

static void uart_putc(uint8_t c)
{
    while ((UART_STATUS & UART_TX_READY) == 0) { }
    UART_DATA = c;
}

static void uart_rx_isr(void)
{
    uint8_t byte = (uint8_t)UART_DATA;
    if (!rb_put(&rx_ring, byte)) {
        dropped++;
    }
}

int main(void)
{
    irq_attach(IRQ_UART_RX, uart_rx_isr);
    UART_CTRL = 0x3u;                   /* ENABLE | RX_IRQ_EN */

    /* Start-up work that takes a while. The sender does not wait for it. */
    for (volatile uint32_t i = 0; i < 300; i++) { }

    bool done = false;
    while (!done) {
        uint8_t c;
        if (rb_get(&rx_ring, &c)) {
            if (c >= 'a' && c <= 'z') {
                c = (uint8_t)(c - 'a' + 'A');
            }
            uart_putc(c);
            if (c == '\n') {
                done = true;
            }
        }
    }
    printf("dropped=%u\n", dropped);
    return 0;
}
`,
      tests: [
        { name: 'a line is received by interrupt and echoed in upper case', uartRx: 'bench mcu\n', uartTx: 'BENCH MCU\n', stdout: 'dropped=0\n' },
        { name: 'a 20-byte burst during start-up: 15 kept, 5 counted as dropped', uartRx: [[0, 'abcdefghijklmnopqrst'], [3000, 'done\n']], uartTx: 'ABCDEFGHIJKLMNODONE\n', stdout: 'dropped=5\n' },
      ],
      hints: [
        'Three things must all be true before a handler runs: it is attached, the peripheral\'s interrupt enable bit is set, and the request is pending. Which of them does the starter provide? And what makes the request go away again?',
        'The ISR is two statements: read `UART_DATA` into a local, then `rb_put` it (and increment `dropped` if that returns `false`).',
        '`irq_attach(IRQ_UART_RX, uart_rx_isr);` registers the handler. It only runs if the peripheral\'s interrupt enable bit is also set: `UART_CTRL = 0x3u;` sets both `ENABLE` and `RX_IRQ_EN`.',
      ],
      explain: `The ISR does the one urgent thing, emptying the receiver before the next byte arrives, and defers everything else. The slow part (waiting for \`TX_READY\`) happens in \`main\`, where being interrupted is harmless. The ISR is the only writer of \`head\` and \`main\` the only writer of \`tail\`, so no critical section is needed. Counting dropped bytes instead of silently discarding them gives you a number to check when sizing the buffer. The burst test shows why polling from the main loop is not an alternative: while \`main\` is busy, nobody empties the receiver. Here the interrupt moved 15 bytes to the ring and counted 5 it had no room for; a polling design would have left the bytes in the UART's own small FIFO and lost the overflow without any count.`,
    }),
    { t: 'exercise',
      prompt: 'An ISR updates a `struct { int16_t x, y, z; }` accelerometer sample in a global variable. The main loop copies the struct with `sample_t s = latest;` and computes the vector magnitude. Occasionally the magnitude is implausible. Explain why, and give two different fixes.',
      hints: [
        'How many bytes is the struct? Can a 32-bit CPU copy it with one instruction?',
        'If the ISR runs in the middle of the copy, which fields are old and which are new?',
        'Either prevent the ISR from running during the copy, or detect that it did.',
      ],
      solution: 'The struct is 6 bytes, so the copy takes several load/store instructions. An interrupt in the middle yields, for example, the old `x` with the new `y` and `z` — a sample that was never measured. Fix 1: a critical section around the copy (mask interrupts, copy, restore). Fix 2: a sequence counter the ISR increments on every update; main reads the counter, copies, reads the counter again, and retries if it changed. A third option is a ring buffer of whole samples, with the ISR publishing each sample by advancing `head` only after all three fields are written.' },
    `## A harder case: the lock that the ISR cannot wait for

A developer protects a shared log buffer with a flag: \`while (busy) {} busy = true; … busy = false;\`. Main takes the
"lock" and is interrupted. The ISR also wants to log, finds \`busy\` set, and waits for it to clear. Main can only clear
it after the ISR returns. The ISR can only return after main clears it. The system is deadlocked with interrupts
effectively blocked for ever.

An interrupt handler can never wait for the code it interrupted. The safe designs are the ones in this lesson: mask the
interrupt around main's access, or give the ISR its own queue that main drains. (The flag "lock" also has a race in the
test-then-set itself.) The RTOS section extends this to tasks, where waiting *is* possible and brings its own problems.`,
    { t: 'refs', items: [
      { title: 'Arm CMSIS-Core: core register access (__get_PRIMASK, __set_PRIMASK, __disable_irq)', url: 'https://arm-software.github.io/CMSIS_6/latest/Core/group__Core__Register__gr.html' },
      { title: 'C11 draft N1570 §5.1.2.3 (program execution; volatile sig_atomic_t and asynchronous interruption), §7.14', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'SEI CERT C: SIG30-C and CON43-C (asynchronous handlers and data races)', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard', note: 'written for signals and threads; the reasoning carries over to ISRs' },
    ] },
  ],
  quiz: [
    { q: 'Main executes `flags |= 0x01;` and an ISR executes `flags |= 0x80;` on the same `volatile uint8_t`. What can go wrong?', kind: 'concept', choices: [
      { t: 'If the ISR runs between main\'s load and store, main writes back a value without bit 7 and the ISR\'s update is lost', ok: true, why: 'Main\'s copy in a CPU register predates the ISR\'s change and overwrites it on the store.' },
      { t: 'Nothing: the two statements change different bits', why: 'They change different bits of the *same byte*, and each statement rewrites the whole byte.' },
      { t: 'Nothing: the variable is volatile', why: 'Volatile forces the load and the store to happen. It does not stop an interrupt arriving between them.' },
      { t: 'The ISR\'s write is lost only if both run in the same millisecond', why: 'The window is the few instructions between load and store, not a unit of time you can reason about in milliseconds.' },
    ] },
    { q: 'Why should a critical-section helper restore the previous interrupt state instead of always enabling interrupts on exit?', kind: 'arch', choices: [
      { t: 'It may be called from code that already had interrupts disabled, and enabling them there would break the caller\'s protection', ok: true, why: 'Nested use is common. Unconditional enabling silently ends the outer critical section early.' },
      { t: 'Enabling interrupts takes much longer than restoring a saved value', why: 'Both are a single short instruction. The reason is correctness, not speed.' },
      { t: 'Interrupts cannot be re-enabled once disabled without a reset', why: 'Masking is fully reversible. The question is only which state to return to.' },
      { t: 'Restoring also clears any pending interrupt flags', why: 'Pending requests are kept and served as soon as interrupts are unmasked. Nothing is cleared.' },
    ] },
    { q: 'In a single-producer, single-consumer ring buffer, why must the producer store the data byte before it advances `head`?', kind: 'concept', choices: [
      { t: 'Advancing `head` is what makes the slot visible to the consumer, so the slot must already contain valid data', ok: true, why: 'If `head` moved first, the consumer could run in between and read a byte that has not been written yet.' },
      { t: 'Because writing `head` first would overwrite the oldest byte', why: 'The full check prevents overwriting. The ordering is about when the consumer may look at the new slot.' },
      { t: 'To keep the ISR as short as possible', why: 'Both orders take the same time. Only one of them is correct.' },
      { t: 'It makes no difference as long as both variables are volatile', why: 'Volatile preserves the order you wrote. It cannot repair an order that exposes an unfilled slot.' },
    ] },
    { q: 'Which of these is acceptable inside an interrupt handler?', kind: 'code', choices: [
      { t: 'Reading the peripheral\'s data register into a ring buffer and clearing its flag', ok: true, why: 'Short, bounded, and touches only data designed to be shared with the main program.' },
      { t: '`printf("got byte %02X\\n", b);`', why: '`printf` is slow, usually blocks on the output device, and uses internal buffers that the interrupted code may be in the middle of updating.' },
      { t: '`buf = malloc(len);`', why: 'The heap\'s free list may be half-updated by the code that was interrupted, and allocation time is unbounded.' },
      { t: 'A loop that waits 10 ms for a sensor to finish converting', why: 'Everything of equal or lower priority is blocked for those 10 ms, and many missed events can pile up.' },
    ] },
    { q: 'A handler returns without clearing its peripheral\'s interrupt flag. What is the typical symptom?', kind: 'arch', choices: [
      { t: 'The handler is re-entered immediately and endlessly; the main loop stops making progress', ok: true, why: 'The request line is still asserted when the handler returns, so the CPU takes the same interrupt again at once.' },
      { t: 'The interrupt never fires again', why: 'That is the symptom of the opposite problem, such as disabling the source and not re-enabling it.' },
      { t: 'The CPU resets through the watchdog on the first interrupt', why: 'A watchdog reset may follow eventually if one is enabled, but it is a consequence of the main loop starving, not the direct effect.' },
      { t: 'The flag clears itself after one more clock cycle', why: 'Level-type status flags stay set until software acknowledges them in the way the datasheet specifies.' },
    ] },
    { q: 'On a 32-bit MCU, a `volatile uint64_t uptime_us` is incremented in a timer ISR and read in main. What is needed for a correct read?', kind: 'code', choices: [
      { t: 'A critical section around the read, or reading twice until both reads agree', ok: true, why: 'A 64-bit load is two 32-bit loads. The ISR can run between them and carry from the low word into the high word.' },
      { t: 'Nothing, since main only reads', why: 'Read-only is sufficient only when the read is a single instruction. Here it is two.' },
      { t: 'Declaring it `const volatile`', why: '`const` would stop the ISR from updating it and does nothing about the two-part read.' },
      { t: 'Compiling with -O0 so the compiler reads it in one step', why: 'No optimisation level changes the width of the CPU\'s registers.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 10 */
const alignment = {
  id: 'ec-alignment',
  title: 'Memory alignment',
  minutes: 70,
  summary: 'Why types have alignment requirements, where padding comes from, what packed structs cost, and how to move data to and from a wire format without relying on any of it.',
  skills: ['ec-alignment-padding', 'ec-serialize'],
  blocks: [
    `## The problem: the same parser faults on a smaller chip

A protocol parser reads a 32-bit sequence number that starts at byte 1 of a received packet:`,
    code(C`
uint32_t seq = *(uint32_t *)&packet[1];
`, 'pseudo', { caption: 'Runs on the Cortex-M4 prototype. On the Cortex-M0+ production board it ends in a HardFault.' }),
    `Nothing changed in the source. What changed is how the CPU treats a 4-byte load from an address that is not a
multiple of 4.

## Theory: alignment

An address is **aligned** for a type if it is a multiple of that type's **alignment requirement**. On the 32-bit ABIs
used by Cortex-M and RISC-V32 toolchains, each basic type's alignment equals its size up to 4 bytes:

| Type | Size | Alignment (typical 32-bit MCU ABI) |
|---|---|---|
| \`uint8_t\`, \`char\` | 1 | 1 |
| \`uint16_t\` | 2 | 2 |
| \`uint32_t\`, pointers | 4 | 4 |
| \`uint64_t\` | 8 | 8 on Arm EABI (4 on some other ABIs) |

The requirement comes from hardware. Memory is accessed in word-sized pieces, and a word that straddles two of them
takes two bus accesses and extra logic to stitch together. CPU designs deal with a misaligned access in one of three
ways:

- **Do it anyway**, more slowly (x86, and Armv7-M cores such as Cortex-M3/M4/M7 for ordinary single loads and stores).
- **Refuse**: raise a fault. Armv6-M cores (Cortex-M0, M0+) do not support unaligned word or halfword access, and Armv7-M cores can be configured to trap it too. Some multi-register and exclusive-access instructions fault on any Cortex-M.
- **Depends on the implementation**: the RISC-V specification lets an implementation either support misaligned access or raise an address-misaligned exception.

So code with a misaligned access can work on your development board and fault on the product. In C, merely converting a
pointer to a type for which it is not correctly aligned is already undefined behaviour (C11 §6.3.2.3 ¶7), before any
dereference, which also gives the optimiser licence to assume it never happens.

### Padding in structs

To keep every field aligned, the compiler:

1. places each field at the next offset that is a multiple of the field's alignment, inserting padding bytes before it if needed;
2. gives the struct the alignment of its most strictly aligned field;
3. pads the end so the total size is a multiple of that alignment (otherwise the second element of an array of them would be misaligned).

Padding bytes have unspecified contents. Two consequences: comparing structs with \`memcmp\` is unreliable, and sending
a struct's raw bytes can leak stale memory contents to the outside.`,
    code(C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {            /* declared in "natural" order      */
    uint8_t  id;
    uint32_t timestamp;
    uint8_t  flags;
    uint16_t value;
} loose_t;

typedef struct {            /* same fields, largest first       */
    uint32_t timestamp;
    uint16_t value;
    uint8_t  id;
    uint8_t  flags;
} tight_t;

typedef struct __attribute__((packed)) {   /* GCC/Clang extension: no padding */
    uint8_t  id;
    uint32_t timestamp;
    uint8_t  flags;
    uint16_t value;
} packed_t;

int main(void)
{
    printf("loose : size %zu, timestamp@%zu flags@%zu value@%zu\n", sizeof(loose_t),
           offsetof(loose_t, timestamp), offsetof(loose_t, flags), offsetof(loose_t, value));
    printf("tight : size %zu, value@%zu id@%zu flags@%zu\n", sizeof(tight_t),
           offsetof(tight_t, value), offsetof(tight_t, id), offsetof(tight_t, flags));
    printf("packed: size %zu, timestamp@%zu flags@%zu value@%zu\n", sizeof(packed_t),
           offsetof(packed_t, timestamp), offsetof(packed_t, flags), offsetof(packed_t, value));
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "loose : size 12, timestamp@4 flags@8 value@10", "tight : size 8, value@4 id@6 flags@7", "packed: size 8, timestamp@1 flags@5 value@6". The same numbers apply on a 32-bit MCU.',
      explain: [
        { lines: '5-10', md: 'Three padding bytes after `id` so `timestamp` starts at 4; one after `flags` so `value` starts at an even offset. A third of the struct is padding.' },
        { lines: '12-17', md: 'Ordering fields from largest to smallest alignment leaves no gaps. The cost is nothing at all, and an array of 1000 records shrinks by 4000 bytes.' },
        { lines: '19-24', md: 'Packing also reaches 8 bytes, but by placing `timestamp` at offset 1, a misaligned address.' },
      ] }),
    { t: 'widget', name: 'struct-layout', props: { source: 'struct sample {\n  uint8_t  id;\n  uint32_t timestamp;\n  uint8_t  flags;\n  uint16_t value;\n};' }, caption: 'Reorder the fields until the padding is gone, then switch on "packed" and compare the offsets.' },
    `## Packed structs: what they cost

\`__attribute__((packed))\` (a compiler extension, not standard C) removes padding. It is used to describe on-disk and
on-wire layouts. When you access a field **through the packed struct type**, the compiler knows the field may be
misaligned and generates safe code, byte by byte if the CPU requires it. That is slower and larger than an aligned
access. The traps:

- **Taking the address of a packed field** (\`uint32_t *p = &pkt.timestamp;\`) produces an ordinary pointer that the compiler assumes is aligned. Dereferencing it elsewhere is a misaligned access again. GCC warns with \`-Waddress-of-packed-member\`.
- Packing fixes padding but **not byte order**. A packed struct still stores fields in the CPU's own endianness.
- The attribute spelling and exact behaviour are compiler-specific.`,
    { t: 'callout', kind: 'mistake', title: 'Casting a byte buffer to a wider pointer', md:
`\`*(uint32_t *)&buf[1]\`, \`(struct header *)rx_buf\`, and \`uint16_t *p = (uint16_t *)byte_ptr\` all tell the compiler
"this address is suitably aligned" when nothing guarantees it. Even when the buffer happens to start at an aligned
address, the field offset inside it may not be. This is the single most common cause of alignment faults when code is
ported from a Cortex-M4 to a Cortex-M0+ or a RISC-V core.` },
    `## The second reason the cast is wrong: strict aliasing

Suppose the address *is* aligned. \`*(uint32_t *)&packet[4]\` is still not valid C, for a reason that has nothing to do
with the CPU. The standard says an object may be accessed only through an lvalue of **its own type** (allowing for
\`const\`/\`volatile\` and for the signed/unsigned twin), or through a **character type** (C11 §6.5 ¶7). This is the
**effective type** rule, usually called **strict aliasing**. \`packet\` is an array of \`uint8_t\`; reading four of its
elements as one \`uint32_t\` breaks the rule and is undefined behaviour.

The rule exists so the optimiser may assume that pointers to *different* types never refer to the same memory. That
lets it keep a value in a CPU register across a store through an unrelated pointer. When the assumption is false, the
generated code is wrong:`,
    code(C`
#include <stdint.h>
#include <stdio.h>

/* The compiler may assume that w and h never point into the same object:
   a uint32_t object is not allowed to be accessed through a uint16_t lvalue. */
static __attribute__((noinline)) uint32_t store_both(uint32_t *w, uint16_t *h)
{
    *w = 1;
    *h = 0;          /* "cannot" change *w, so ...                    */
    return *w;       /* ... the compiler may return the constant 1    */
}

int main(void)
{
    uint32_t word = 0;
    uint32_t r = store_both(&word, (uint16_t *)&word);   /* the cast breaks the rule */
    printf("returned %u, word is now %u\n", (unsigned)r, (unsigned)word);
    return 0;
}
`, 'host-tested', {
      caption: 'Compiled with gcc 13.3 on the x86-64 host, with no warning at -Wall -Wextra. At -O0 it prints "returned 0, word is now 0". At -O2 it prints "returned 1, word is now 0": the function returns a value the variable does not hold. With -O2 -fno-strict-aliasing it prints "returned 0" again. The program has undefined behaviour, so neither output is "the right one"; other compilers and versions may differ.',
      explain: [
        { lines: '8-10', md: 'At \`-O2\` GCC does not reload \`*w\` after the store through \`h\`: the types differ, so by the rule the store cannot have touched it, and the function returns the constant 1.' },
        { lines: '16', md: 'Both pointers refer to \`word\`. The cast silences the type checker; it does not make the access legal.' },
      ] }),
    `What is and is not allowed:

| You want to… | Allowed? | Write |
|---|---|---|
| look at any object's bytes | **yes**: character types may alias anything | \`const uint8_t *b = (const uint8_t *)&obj;\` then \`b[i]\` |
| read a \`uint32_t\` out of a byte buffer | **no** through \`(uint32_t *)\` | shifts, or \`memcpy(&v, p, sizeof v)\` |
| reinterpret one value as another type | through a **union** object, in C | \`u.word = x; … u.bytes[0]\` |
| overlay a struct on a receive buffer | **no** (aliasing, alignment and padding all at once) | parse field by field |

The exception runs in one direction only: bytes may be used to inspect a \`uint32_t\`, but a \`uint32_t\` lvalue may not
be used to read an array that was declared as bytes. (\`uint8_t\` is \`unsigned char\` on every mainstream compiler,
which is why byte-wise code is safe.) Memory-mapped registers are a separate case: \`(volatile uint32_t *)0x40001000\`
names hardware, not a declared C object, and is the accepted, implementation-specific way to reach it.

Some projects build with \`-fno-strict-aliasing\`, which makes GCC and Clang stop using the assumption. That is a
property of the build, not of the code: a library compiled elsewhere, or a different compiler, does not honour it.
Code that uses \`memcpy\` or shifts is correct everywhere and compiles to the same instructions.

## The portable way: serialise byte by byte

Treat the wire format as a sequence of bytes defined by the protocol, and the C struct as a convenient in-memory form
defined by the compiler. Convert between the two explicitly:`,
    code(C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static void put_u32_be(uint8_t *out, uint32_t v)
{
    out[0] = (uint8_t)(v >> 24);
    out[1] = (uint8_t)(v >> 16);
    out[2] = (uint8_t)(v >> 8);
    out[3] = (uint8_t)v;
}

static uint32_t get_u32_be(const uint8_t *in)
{
    return ((uint32_t)in[0] << 24) | ((uint32_t)in[1] << 16) |
           ((uint32_t)in[2] << 8)  |  (uint32_t)in[3];
}

int main(void)
{
    uint8_t packet[8] = { 0 };
    put_u32_be(&packet[1], 0xCAFE1234u);          /* an odd offset is fine */

    for (size_t i = 0; i < sizeof(packet); i++) {
        printf("%02X ", packet[i]);
    }
    printf("\n%08X\n", (unsigned)get_u32_be(&packet[1]));
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "00 CA FE 12 34 00 00 00" and "CAFE1234".',
      explain: [
        { lines: '5-11', md: 'Four single-byte stores. A byte has alignment 1, so any address is legal. The shifts pick the bytes in the order the protocol defines, here most significant first.' },
        { lines: '13-17', md: 'Four byte loads combined with shifts. No pointer cast, no dependence on the CPU\'s byte order, no padding involved.' },
      ] }),
    `This is a few instructions longer than a cast and correct on every CPU. When the data really is in the machine's own
byte order and only the alignment is in doubt, \`memcpy(&value, &buf[1], sizeof value)\` is the other correct tool:
compilers turn a small fixed-size \`memcpy\` into the best instruction sequence the target allows.`,
    { t: 'callout', kind: 'decision', title: 'Reorder, pack, or serialise?', md:
`- Data that stays **inside** the program: order fields largest-first and let the compiler pad. Fast, portable, small.
- Data that **leaves** the program (wire, flash, another CPU): serialise field by field. You control size, byte order and padding, and the format survives a change of compiler or MCU.
- \`packed\` structs: acceptable when a vendor SDK or an existing protocol stack already uses them and all parties share a compiler family and byte order. Never take the address of their fields.` },
    { t: 'predict',
      q: 'On a 32-bit MCU, what is `sizeof(struct { uint16_t a; uint8_t b; })`?',
      choices: [
        { t: '4', ok: true, why: 'The fields need 3 bytes. The struct\'s alignment is 2 (from the `uint16_t`), so the size is rounded up to the next multiple of 2.' },
        { t: '3', why: 'That is the sum of the field sizes. A struct\'s size must be a multiple of its alignment so that arrays of it keep every element aligned.' },
        { t: '8', why: 'Padding rounds up to the struct\'s own strictest field alignment, which here is 2, not to the CPU word size.' },
        { t: '2', why: 'The struct cannot be smaller than its contents, which total 3 bytes before any padding.' },
      ],
      reveal: 'Trailing padding is easy to forget. It is why `sizeof` of a struct is not the offset of the last field plus its size.' },
    clab({
      title: 'Modify: shrink a struct without packing it',
      prompt: `A logger keeps 500 of these records in RAM. As declared, each takes 12 bytes. Reorder the fields (do not use \`packed\`, do not change any type) so that \`sizeof(log_entry_t)\` is 8.

The program must still print the same field values. Expected output:

\`size=8\`
\`7 100000 3 500\`
\`aligned=1\``,
      starter: C`
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t  id;
    uint32_t timestamp;
    uint8_t  flags;
    uint16_t value;
} log_entry_t;

int main(void)
{
    log_entry_t e;
    e.id = 7;
    e.timestamp = 100000;
    e.flags = 3;
    e.value = 500;

    printf("size=%d\n", (int)sizeof(log_entry_t));
    printf("%d %u %d %d\n", e.id, e.timestamp, e.flags, e.value);
    printf("aligned=%d\n", ((uint8_t *)&e.timestamp - (uint8_t *)&e) % 4 == 0 &&
                           ((uint8_t *)&e.value - (uint8_t *)&e) % 2 == 0);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint32_t timestamp;
    uint16_t value;
    uint8_t  id;
    uint8_t  flags;
} log_entry_t;

int main(void)
{
    log_entry_t e;
    e.id = 7;
    e.timestamp = 100000;
    e.flags = 3;
    e.value = 500;

    printf("size=%d\n", (int)sizeof(log_entry_t));
    printf("%d %u %d %d\n", e.id, e.timestamp, e.flags, e.value);
    printf("aligned=%d\n", ((uint8_t *)&e.timestamp - (uint8_t *)&e) % 4 == 0 &&
                           ((uint8_t *)&e.value - (uint8_t *)&e) % 2 == 0);
    return 0;
}
`,
      tests: [{ name: 'eight bytes, same contents, every field still aligned', stdout: 'size=8\n7 100000 3 500\naligned=1\n' }],
      hints: [
        'Write down the offset of every field in the original, and mark the bytes that belong to no field. Why did the compiler leave each gap?',
        'The original: `id` 0, padding 1–3, `timestamp` 4–7, `flags` 8, padding 9, `value` 10–11.',
        'Padding appears whenever a field with a larger alignment follows a smaller one. Order the fields from largest to smallest: the 4-byte field, then the 2-byte field, then the two single bytes.',
      ],
      explain: `Largest-first ordering puts every field on a multiple of its own size with no gaps: \`timestamp\` 0–3, \`value\` 4–5, \`id\` 6, \`flags\` 7. Across 500 records that saves 2000 bytes of RAM, every access stays aligned and fast, and the code that uses the fields by name did not change.`,
    }),
    clab({
      title: 'Write: pack and unpack a reading for the wire',
      prompt: `A sensor reading is sent as exactly 7 bytes: \`id\` (1 byte), \`timestamp\` (4 bytes, big-endian), \`temp_centi\` (2 bytes, big-endian, two's complement).

- \`pack_reading(out, cap, r)\` writes the 7 bytes and returns 7, or returns 0 without writing if \`cap\` is less than 7.
- \`unpack_reading(in, len, r)\` fills \`*r\` from 7 bytes and returns \`true\`, or returns \`false\` if \`len\` is less than 7.

Do not cast the byte pointers to any other pointer type and do not \`memcpy\` the struct.`,
      starter: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t  id;
    uint32_t timestamp;
    int16_t  temp_centi;
} reading_t;

#define WIRE_SIZE 7

static size_t pack_reading(uint8_t *out, size_t cap, const reading_t *r)
{
    /* TODO */
    return 0;
}

static bool unpack_reading(const uint8_t *in, size_t len, reading_t *r)
{
    /* TODO */
    return false;
}

int main(void)
{
    reading_t r = { 0x2A, 0x01020304u, -2 };
    uint8_t wire[WIRE_SIZE] = { 0 };

    printf("too small: %d", (int)pack_reading(wire, 6, &r));
    printf(" (wire[0] still %02X)\n", wire[0]);

    size_t n = pack_reading(wire, sizeof(wire), &r);
    printf("packed %d:", (int)n);
    for (size_t i = 0; i < n; i++) {
        printf(" %02X", wire[i]);
    }
    printf("\n");

    reading_t back = { 0, 0, 0 };
    printf("short input: %d", unpack_reading(wire, 6, &back));
    printf(" (id still %d)\n", back.id);
    if (unpack_reading(wire, sizeof(wire), &back)) {
        printf("%d %u %d\n", back.id, back.timestamp, back.temp_centi);
    }
    printf("struct is %d bytes in memory\n", (int)sizeof(reading_t));
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t  id;
    uint32_t timestamp;
    int16_t  temp_centi;
} reading_t;

#define WIRE_SIZE 7

static size_t pack_reading(uint8_t *out, size_t cap, const reading_t *r)
{
    if (cap < WIRE_SIZE) {
        return 0;
    }
    uint16_t t = (uint16_t)r->temp_centi;
    out[0] = r->id;
    out[1] = (uint8_t)(r->timestamp >> 24);
    out[2] = (uint8_t)(r->timestamp >> 16);
    out[3] = (uint8_t)(r->timestamp >> 8);
    out[4] = (uint8_t)r->timestamp;
    out[5] = (uint8_t)(t >> 8);
    out[6] = (uint8_t)t;
    return WIRE_SIZE;
}

static bool unpack_reading(const uint8_t *in, size_t len, reading_t *r)
{
    if (len < WIRE_SIZE) {
        return false;
    }
    r->id = in[0];
    r->timestamp = ((uint32_t)in[1] << 24) | ((uint32_t)in[2] << 16) |
                   ((uint32_t)in[3] << 8)  |  (uint32_t)in[4];
    r->temp_centi = (int16_t)(uint16_t)(((uint16_t)in[5] << 8) | in[6]);
    return true;
}

int main(void)
{
    reading_t r = { 0x2A, 0x01020304u, -2 };
    uint8_t wire[WIRE_SIZE] = { 0 };

    printf("too small: %d", (int)pack_reading(wire, 6, &r));
    printf(" (wire[0] still %02X)\n", wire[0]);

    size_t n = pack_reading(wire, sizeof(wire), &r);
    printf("packed %d:", (int)n);
    for (size_t i = 0; i < n; i++) {
        printf(" %02X", wire[i]);
    }
    printf("\n");

    reading_t back = { 0, 0, 0 };
    printf("short input: %d", unpack_reading(wire, 6, &back));
    printf(" (id still %d)\n", back.id);
    if (unpack_reading(wire, sizeof(wire), &back)) {
        printf("%d %u %d\n", back.id, back.timestamp, back.temp_centi);
    }
    printf("struct is %d bytes in memory\n", (int)sizeof(reading_t));
    return 0;
}
`,
      tests: [{ name: 'seven wire bytes, round trip, short buffers rejected', stdout: 'too small: 0 (wire[0] still 00)\npacked 7: 2A 01 02 03 04 FF FE\nshort input: 0 (id still 0)\n42 16909060 -2\nstruct is 12 bytes in memory\n' }],
      hints: [
        'Two questions before any code: what must each function check before it touches a single byte, and which byte of a big-endian field goes first on the wire?',
        'Check the size first in both functions, before any store. A serialiser that writes into a too-small buffer is a buffer overflow.',
        'Big-endian means most significant byte first: `out[1] = (uint8_t)(r->timestamp >> 24);` and so on down to a shift of 0. For the signed field, convert to `uint16_t` before shifting when packing, and assemble a `uint16_t` then cast to `int16_t` when unpacking.',
      ],
      explain: `The in-memory struct is 12 bytes with padding and little-endian fields; the wire form is 7 bytes, big-endian, no padding. The two functions are the only place that knows both. −2 is \`0xFFFE\` in 16-bit two's complement, so the last two bytes are \`FF FE\`. Converting the signed value to unsigned before shifting avoids shifting a negative number, and the cast back relies on GCC's documented conversion behaviour.`,
    }),
    writerLab,
    { t: 'exercise',
      prompt: 'A `struct { uint8_t type; uint64_t serial; uint16_t crc; }` is compiled for 32-bit Arm (EABI), where `uint64_t` has alignment 8. Give the offset of each field and the total size.',
      hints: [
        '`serial` must start at a multiple of 8.',
        '`crc` follows directly after `serial`. Is its offset a multiple of 2?',
        'The whole struct takes the alignment of `serial`. Round the size up to a multiple of 8.',
      ],
      solution: '`type` at 0, seven padding bytes, `serial` at 8–15, `crc` at 16–17, six trailing padding bytes: total 24. Of 24 bytes, 13 are padding. Reordered as `serial, crc, type` it is 8 + 2 + 1 = 11, rounded up to 16.',
      answer: { type: 'number', value: 24, tol: 0, unit: 'bytes' } },
    `## A harder case: a fault that depends on the link order

A DMA or radio driver receives packets into \`static uint8_t rx_buf[64];\` and the parser casts \`rx_buf + 4\` to a
\`uint32_t *\`. It works for months. Then someone adds an unrelated one-byte global variable, the linker places
\`rx_buf\` at an odd address, and the product starts faulting.

A \`uint8_t\` array has alignment 1: the linker may put it anywhere. The earlier success was luck. This is why alignment
bugs are worth removing at the source level and not by experiment: use byte-wise access or \`memcpy\`, or, where a
buffer truly must be word-aligned for hardware reasons (some DMA controllers require it; check the peripheral's
documentation), state it with \`_Alignas(4)\` or the compiler's \`aligned\` attribute so that the requirement is in the
code and enforced by the toolchain.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.2.8 (alignment of objects), §6.3.2.3 ¶7 (pointer conversion and alignment), §6.5 ¶6–7 (effective type and permitted aliasing), §6.7.5 (_Alignas)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'GCC manual: common type attributes (packed, aligned)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Common-Type-Attributes.html' },
      { title: 'GCC manual: warning options (-Waddress-of-packed-member, -Wcast-align, -Wpadded)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html' },
      { title: 'Arm: Armv6-M Architecture Reference Manual (alignment behaviour) ', url: 'https://developer.arm.com/documentation/ddi0419/latest/', note: 'section on alignment support: unaligned accesses generate a fault' },
      { title: 'SEI CERT C: EXP36-C. Do not cast pointers into more strictly aligned pointer types', url: 'https://wiki.sei.cmu.edu/confluence/display/c/EXP36-C.+Do+not+cast+pointers+into+more+strictly+aligned+pointer+types' },
    ] },
  ],
  quiz: [
    { q: 'Code that executes `*(uint32_t *)(buf + 1)` works on a Cortex-M4 and HardFaults on a Cortex-M0+. Why?', kind: 'arch', choices: [
      { t: 'The M0+ (Armv6-M) does not support unaligned word access, while the M4 performs it', ok: true, why: 'The address is not a multiple of 4. One core completes the access in several bus cycles; the other raises a fault.' },
      { t: 'The M0+ has less RAM, so the address is out of range', why: 'The address is inside the same buffer on both. The difference is how each core handles its alignment.' },
      { t: 'The M0+ is big-endian', why: 'Both are normally little-endian, and a byte-order difference would give a wrong value, not a fault.' },
      { t: 'The compiler for the M0+ has a bug', why: 'The compiler emitted the word load the source asked for. The cast promised an alignment that was not there.' },
    ] },
    { q: 'What does `__attribute__((packed))` change, and what does it leave unchanged?', kind: 'concept', choices: [
      { t: 'It removes padding; fields keep the CPU\'s byte order and may now be misaligned', ok: true, why: 'Packing is only about layout gaps. Endianness is untouched, and alignment becomes the compiler\'s problem on direct accesses and yours through pointers.' },
      { t: 'It removes padding and converts fields to network byte order', why: 'No attribute changes byte order. Packed fields are stored exactly as the CPU would store them anywhere else.' },
      { t: 'It only reorders fields to minimise padding', why: 'The compiler never reorders struct fields. Packing keeps the declared order and drops the gaps.' },
      { t: 'It makes accesses to the struct faster', why: 'Access to misaligned fields is slower, since the compiler must assemble them from bytes on cores that require alignment.' },
    ] },
    { q: 'Why is `memcmp(&a, &b, sizeof a) == 0` an unreliable way to compare two structs for equality?', kind: 'security', choices: [
      { t: 'Padding bytes have unspecified contents and may differ even when all fields are equal', ok: true, why: 'Assigning fields does not write the padding, so it holds whatever was in memory before.' },
      { t: '`memcmp` stops at the first zero byte', why: 'That is the behaviour of string functions such as `strcmp`. `memcmp` compares exactly the number of bytes requested.' },
      { t: '`sizeof` of a struct excludes padding', why: '`sizeof` includes internal and trailing padding, which is exactly why the padding gets compared.' },
      { t: 'Structs cannot be passed to functions taking `void *`', why: 'A pointer to any object converts to `void *`. The call is valid; its result is the problem.' },
    ] },
    { q: 'Which is the most portable way to read a little-endian `uint16_t` stored at an arbitrary offset in a byte buffer?', kind: 'code', choices: [
      { t: '`(uint16_t)(p[0] | (p[1] << 8))`', ok: true, why: 'Two byte loads and a shift: no alignment requirement and no dependence on the CPU\'s byte order.' },
      { t: '`*(uint16_t *)p`', why: 'This assumes `p` is 2-byte aligned and that the CPU is little-endian. Neither is guaranteed.' },
      { t: '`(uint16_t)(p[0] << 8 | p[1])`', why: 'This assembles the bytes in big-endian order: the first byte becomes the high byte.' },
      { t: '`((union { uint8_t b[2]; uint16_t w; } *)p)->w`', why: 'A cast to a union pointer has the same alignment and byte-order assumptions as the direct cast.' },
    ] },
    { q: 'A struct has fields `uint8_t a; uint32_t b; uint8_t c; uint8_t d;` (12 bytes). Which order gives the smallest size without packing?', kind: 'code', choices: [
      { t: '`uint32_t b; uint8_t a; uint8_t c; uint8_t d;` — 8 bytes', ok: true, why: '4 + 1 + 1 + 1 = 7, rounded up to the struct alignment of 4.' },
      { t: '`uint8_t a; uint8_t c; uint32_t b; uint8_t d;` — 7 bytes', why: 'After two single bytes the 4-byte field still needs two padding bytes, and trailing padding follows `d`: 12 bytes again.' },
      { t: 'Any order gives 7 bytes; the compiler reorders fields itself', why: 'C compilers must keep the declared order, and the size must be a multiple of 4 here.' },
      { t: 'No order is smaller than 12 bytes', why: 'Grouping the three single bytes together removes the internal gap entirely.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 11 */
const defensive = {
  id: 'ec-defensive-c',
  title: 'Defensive C',
  minutes: 70,
  summary: 'Every copy has a bound, every length from outside is checked, every return value is looked at, and size arithmetic is done so that it cannot wrap.',
  skills: ['ec-bounded-copy', 'ec-validate-lengths'],
  blocks: [
    `## The problem: a device name that unlocks the device

A configuration command lets a user set a device name. The handler copies the name into a field of a settings struct:
\`strcpy(settings.name, received_name);\`. The field is 16 bytes. Next to it in the struct is \`admin_enabled\`. A name
of 16 characters or more writes past the field, and the 17th byte lands in the flag.

Nothing here is exotic. The language has no bounds checks, the library function copies until it finds a zero byte, and
the data came from outside. This lesson is the set of habits that make this class of bug hard to write. It is the
bridge to the security section, where you will exploit exactly these mistakes in a simulated device and then verify
the fixes. All such exercises in this course run against intentionally vulnerable simulations.

## Rule 1: every copy has a bound, and the bound is the destination's size

A copy needs three facts: where from, where to, and **how much the destination can hold**. Functions that take only the
first two cannot be used safely with data you do not control.

| Function | Bounded by | Terminates the string? | Notes |
|---|---|---|---|
| \`strcpy(d, s)\` | nothing | yes | overflows if \`s\` is longer than \`d\` |
| \`strncpy(d, s, n)\` | \`n\` | **only if \`s\` is shorter than \`n\`** | pads the rest of \`d\` with zeros |
| \`snprintf(d, n, "%s", s)\` | \`n\` | yes (if \`n\` > 0) | returns the length it *wanted* to write |
| \`memcpy(d, s, n)\` | \`n\` | not applicable | \`n\` must not exceed either buffer |
| \`sprintf\`, \`strcat\`, \`gets\` | nothing | yes | do not use on external data; \`gets\` was removed from C11 |

### The strncpy trap

\`strncpy\` was designed for fixed-width fields, not as a "safe strcpy". If the source has \`n\` or more characters, it
fills the destination completely and writes **no terminator**. The overflow is avoided, but the next \`printf("%s")\`
or \`strlen\` reads on past the end of the field until it finds a zero somewhere in memory.

### snprintf semantics

\`snprintf(dst, size, …)\` never writes more than \`size\` bytes and always terminates (for \`size\` > 0). Its return
value is the number of characters the full output needs, not counting the terminator. So \`ret >= size\` means the
output was **truncated**, and you can decide whether that is acceptable. A negative return means an encoding error.`,
    code(C`
#include <stdio.h>
#include <string.h>

int main(void)
{
    char field[8];
    const char *input = "ALEXANDRA";              /* 9 characters */

    /* strncpy: bounded, but leaves the field unterminated when the input is too long */
    memset(field, '#', sizeof(field));
    strncpy(field, input, sizeof(field) - 1);     /* copy at most 7 ...            */
    field[sizeof(field) - 1] = '\0';              /* ... and always terminate      */
    printf("strncpy+terminate: %s\n", field);

    /* snprintf: bounded, terminated, and reports truncation */
    int need = snprintf(field, sizeof(field), "%s", input);
    printf("snprintf: %s (needed %d, have %zu)%s\n", field, need, sizeof(field),
           (need >= (int)sizeof(field)) ? " TRUNCATED" : "");

    need = snprintf(field, sizeof(field), "id=%d", 42);
    printf("snprintf: %s (needed %d)\n", field, need);
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "strncpy+terminate: ALEXAND", "snprintf: ALEXAND (needed 9, have 8) TRUNCATED", "snprintf: id=42 (needed 5)". GCC notes the deliberate truncation with a -Wformat-truncation warning on the first snprintf call.',
      explain: [
        { lines: '11-12', md: 'The idiom: copy at most `size - 1` characters and write the terminator yourself. Without line 12, and with a full-size copy, the field would hold `ALEXANDR` with no zero byte after it.' },
        { lines: '16-18', md: '`need` is 9: the input needed 9 characters plus a terminator, but only 7 plus a terminator fit. Comparing the return value with the buffer size detects it.' },
      ] }),
    { t: 'callout', kind: 'mistake', title: 'Bounding the copy by the source instead of the destination', md:
`\`strncpy(dst, src, strlen(src))\` and \`memcpy(dst, src, src_len)\` are bounded by the wrong buffer: they protect nothing
and the first also guarantees a missing terminator. The limit must come from the destination: \`sizeof(dst)\` when
\`dst\` is an array in scope, or a size parameter passed alongside the pointer. And remember that \`sizeof\` of a pointer
parameter is 4, not the buffer size.` },
    clab({
      title: 'Debug: the name that prints the PIN',
      prompt: `An account record stores a name and a PIN in adjacent 8-byte fields. \`set_name\` uses \`strncpy\` with the field size, so it cannot overflow. Yet greeting a user with a long name prints the PIN after it.

Fix \`set_name\` so that the name field always holds a properly terminated string. Expected output:

\`hello ALEXAND\`
\`hello bo\`
\`pin intact: 1\``,
      starter: C`
#include <stdio.h>
#include <string.h>

typedef struct {
    char name[8];
    char pin[8];
} account_t;

static void set_name(account_t *a, const char *name)
{
    strncpy(a->name, name, 8);
}

int main(void)
{
    account_t acct;
    memset(&acct, '#', sizeof(acct));         /* stand-in for whatever was in this memory before */
    strcpy(acct.pin, "4321");

    set_name(&acct, "ALEXANDRA");
    printf("hello %s\n", acct.name);

    set_name(&acct, "bo");
    printf("hello %s\n", acct.name);
    printf("pin intact: %d\n", strcmp(acct.pin, "4321") == 0);
    return 0;
}
`,
      solution: C`
#include <stdio.h>
#include <string.h>

typedef struct {
    char name[8];
    char pin[8];
} account_t;

static void set_name(account_t *a, const char *name)
{
    strncpy(a->name, name, 7);
    a->name[7] = '\0';
}

int main(void)
{
    account_t acct;
    memset(&acct, '#', sizeof(acct));         /* stand-in for whatever was in this memory before */
    strcpy(acct.pin, "4321");

    set_name(&acct, "ALEXANDRA");
    printf("hello %s\n", acct.name);

    set_name(&acct, "bo");
    printf("hello %s\n", acct.name);
    printf("pin intact: %d\n", strcmp(acct.pin, "4321") == 0);
    return 0;
}
`,
      tests: [{ name: 'names are terminated and the PIN stays private', stdout: 'hello ALEXAND\nhello bo\npin intact: 1\n' }],
      hints: [
        'How does `printf("%s")` know where a string ends? After the first `set_name`, look at the 8 bytes of `name`: is the thing it looks for among them?',
        '`printf("%s")` prints until it meets a zero byte. With none in `name`, it continues into the next field of the struct.',
        'Copy at most 7 characters and store `\'\\0\'` in `name[7]` unconditionally.',
      ],
      explain: `\`strncpy\` filled all eight bytes with \`ALEXANDR\` and, as specified, added no terminator. No write went out of bounds; the later *read* did, and it disclosed the neighbouring field. This is an information leak, not a crash. Truncating silently is a design decision too: a real system might prefer to reject a name that does not fit.`,
    }),
    copyLab,
    `## Rule 2: lengths that arrive from outside are claims, not facts

Any length, count, index or offset that comes from a packet, a file, a user or another device was chosen by someone
else. Before it is used as a loop bound, copy size or array index, check it against **both** of the following:

- the amount of data actually received (or you read past the end of the input: an over-read that leaks memory), and
- the capacity of the destination (or you write past it).

A received packet \`[len][payload…]\` whose \`len\` says 200 when 10 bytes arrived must be rejected, not trusted.

## Rule 3: size arithmetic must not wrap

Checks are arithmetic, and arithmetic on fixed-width integers wraps. The natural-looking test

\`if (offset + length > capacity) reject();\`

is defeated by \`length = 0xFFFFFFF0\`: the sum wraps to a small number, the test passes, and the copy runs wild. The
robust form never adds attacker-influenced values. It subtracts from the trusted bound, after establishing that the
subtraction cannot go negative:

\`if (offset > capacity || length > capacity - offset) reject();\`

The same care applies to multiplication in allocation sizes: \`count * sizeof(item)\` can wrap to a small number, and
then the buffer is far smaller than the loop that fills it expects. Check \`count > MAX / sizeof(item)\` first. And keep
sizes unsigned (\`size_t\`): a signed length that goes negative converts to a huge unsigned value at the first
\`memcpy\`.`,
    { t: 'widget', name: 'integer-overflow', props: { challenge: 'length-check' }, caption: 'Find a length that passes the check and still overflows the buffer. This is a simulation of an intentionally vulnerable routine.' },
    { t: 'predict',
      q: 'A handler receives `uint8_t hdr_len` and `uint8_t body_len` from a packet and checks them with the code below before copying `hdr_len + body_len` bytes into a 64-byte buffer. Can a packet get past the check with more than 64 bytes?',
      code: C`
uint8_t total = hdr_len + body_len;
if (total > 64) {
    return ERR_TOO_LONG;
}
memcpy(buf, pkt, hdr_len + body_len);`,
      choices: [
        { t: 'Yes: with 200 and 100 the 8-bit `total` is 44, but the copy uses the untruncated int sum 300', ok: true, why: 'The check and the use compute the "same" expression at different widths. Storing into `uint8_t` truncates; the `memcpy` argument does not.' },
        { t: 'No: both values are at most 255 and the check rejects anything above 64', why: 'The check tests a truncated copy of the sum. The value passed to `memcpy` is computed again, as an `int`, and is not truncated.' },
        { t: 'No: `uint8_t` addition saturates at 255', why: 'C integer types never saturate. Unsigned results are reduced modulo 2ⁿ when stored.' },
        { t: 'Yes, but only when `hdr_len` is 0', why: 'Zero is the harmless case. The problem needs the true sum to exceed 255 so that the stored value wraps.' },
      ],
      reveal: 'Compute a size once, in a type wide enough to hold it, check that variable, and use that same variable.' },
    clab({
      title: 'Debug: the append that wraps',
      prompt: `\`buf_append\` adds bytes to a 16-byte message buffer and is supposed to refuse anything that does not fit. The first three calls behave. The fourth passes a length close to 2³² (as a corrupted or malicious length field would) and the program dies with a bus fault inside \`memcpy\`.

Rewrite the bounds check so that it cannot be defeated by wrap-around. Expected output:

\`append 10: 1 (len 10)\`
\`append 6: 1 (len 16)\`
\`append 1: 0 (len 16)\`
\`append huge: 0 (len 10)\``,
      starter: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define MSG_CAP 16u

typedef struct {
    uint8_t data[MSG_CAP];
    size_t  len;
} msg_buf_t;

static bool buf_append(msg_buf_t *b, const uint8_t *src, size_t n)
{
    if (b->len + n > MSG_CAP) {
        return false;
    }
    memcpy(b->data + b->len, src, n);
    b->len += n;
    return true;
}

int main(void)
{
    static const uint8_t src[16] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
    msg_buf_t m;
    m.len = 0;

    printf("append 10: %d", buf_append(&m, src, 10));
    printf(" (len %u)\n", (unsigned)m.len);
    printf("append 6: %d", buf_append(&m, src, 6));
    printf(" (len %u)\n", (unsigned)m.len);
    printf("append 1: %d", buf_append(&m, src, 1));
    printf(" (len %u)\n", (unsigned)m.len);

    m.len = 10;
    printf("append huge: %d", buf_append(&m, src, 0xFFFFFFFAu));
    printf(" (len %u)\n", (unsigned)m.len);
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define MSG_CAP 16u

typedef struct {
    uint8_t data[MSG_CAP];
    size_t  len;
} msg_buf_t;

static bool buf_append(msg_buf_t *b, const uint8_t *src, size_t n)
{
    if (b->len > MSG_CAP || n > MSG_CAP - b->len) {
        return false;
    }
    memcpy(b->data + b->len, src, n);
    b->len += n;
    return true;
}

int main(void)
{
    static const uint8_t src[16] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
    msg_buf_t m;
    m.len = 0;

    printf("append 10: %d", buf_append(&m, src, 10));
    printf(" (len %u)\n", (unsigned)m.len);
    printf("append 6: %d", buf_append(&m, src, 6));
    printf(" (len %u)\n", (unsigned)m.len);
    printf("append 1: %d", buf_append(&m, src, 1));
    printf(" (len %u)\n", (unsigned)m.len);

    m.len = 10;
    printf("append huge: %d", buf_append(&m, src, 0xFFFFFFFAu));
    printf(" (len %u)\n", (unsigned)m.len);
    return 0;
}
`,
      tests: [{ name: 'fits, exactly fits, overflows by one, wraps', stdout: 'append 10: 1 (len 10)\nappend 6: 1 (len 16)\nappend 1: 0 (len 16)\nappend huge: 0 (len 10)\n' }],
      hints: [
        'Compute `10 + 0xFFFFFFFA` in 32 bits. What does the check compare with 16?',
        'The sum wraps to 4, which is not greater than 16, so the copy of four billion bytes goes ahead. Which of the two operands do you trust, and can you rearrange the test so that the untrusted one is never added to anything?',
        'Avoid the addition. The free space is `MSG_CAP - b->len` (safe once you know `len <= MSG_CAP`); reject if `n` is greater than that.',
      ],
      explain: `\`len + n\` wrapped modulo 2³² and the check approved the copy. \`n > MSG_CAP - len\` has no operation that can wrap: \`len\` is at most 16, so the subtraction stays in range, and the comparison is against the untouched \`n\`. Checking \`len > MSG_CAP\` first protects the subtraction even if the struct itself has been corrupted.`,
    }),
    { t: 'widget', name: 'integer-overflow', props: { challenge: 'alloc-size' }, caption: 'The multiplication version of the same mistake: a count times an element size that wraps to a small allocation.' },
    `## Rule 4: look at every return value

C reports failure through return values, and ignoring one is silent. Typical consequences in firmware:

- an I²C read fails (sensor unplugged), the buffer keeps its previous contents or stack garbage, and the control loop acts on a stale temperature;
- \`malloc\` returns \`NULL\` and the next line writes to address 0;
- a flash write fails and the device reports "settings saved";
- a signature verification function returns an error code that is treated as "true" because it is non-zero.

Decide for each call what the system should do on failure (retry, use a safe default, enter a fault state, report it)
and write it down as code. If a result really is irrelevant, say so with \`(void)\` so the next reader knows it was a
decision. GCC's \`warn_unused_result\` attribute lets a function insist that its callers check.`,
    { t: 'callout', kind: 'security', title: 'Fail closed', md:
`When a check cannot be completed — a length is out of range, a read failed, a state variable has an impossible value —
take the **safe** path: reject the packet, keep the lock locked, stop the motor. Code structured as "assume success
unless an error is detected" fails open when an error path is forgotten. Initialise result variables to the failure
value and set them to success only at the single point where every check has passed. The security section returns to
this when it covers fault injection.` },
    clab({
      title: 'Write: parse a length-prefixed command without trusting the length',
      prompt: `A command packet is \`[len][len bytes of text]\`. Implement \`extract_text\`, which copies the text into \`out\` as a terminated C string.

Return the text length on success. Return −1, and make \`out\` an empty string when \`out_size\` is at least 1, if:

- the packet is empty (\`pkt_len\` is 0),
- the length byte claims more bytes than the packet actually contains, or
- the text plus its terminator does not fit in \`out\`.

\`pkt_len\` is the number of bytes really received, including the length byte. With \`out_size\` 0 there is no room even for a terminator: return −1 and write nothing at all (the last line of the test).`,
      starter: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int extract_text(const uint8_t *pkt, size_t pkt_len, char *out, size_t out_size)
{
    /* TODO: validate, then copy and terminate */
    return -1;
}

static void show(const char *label, const uint8_t *pkt, size_t pkt_len, size_t out_size)
{
    char out[8];
    memset(out, 'x', sizeof(out));
    out[sizeof(out) - 1] = '\0';
    int r = extract_text(pkt, pkt_len, out, out_size);
    printf("%s: %d [%s]\n", label, r, out);
}

int main(void)
{
    static const uint8_t ok[]      = { 3, 'L', 'E', 'D' };
    static const uint8_t lying[]   = { 200, 'h', 'i' };
    static const uint8_t toolong[] = { 8, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H' };
    static const uint8_t fits[]    = { 7, 'A', 'B', 'C', 'D', 'E', 'F', 'G' };
    static const uint8_t empty[]   = { 0 };

    show("ok", ok, sizeof(ok), 8);
    show("claims 200, has 2", lying, sizeof(lying), 8);
    show("8 chars into 8 bytes", toolong, sizeof(toolong), 8);
    show("7 chars into 8 bytes", fits, sizeof(fits), 8);
    show("zero-length text", empty, sizeof(empty), 8);
    show("no bytes received", ok, 0, 8);
    show("truncated packet", ok, 3, 8);
    show("no output space at all", ok, sizeof(ok), 0);
    return 0;
}
`,
      solution: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int extract_text(const uint8_t *pkt, size_t pkt_len, char *out, size_t out_size)
{
    if (out_size > 0) {
        out[0] = '\0';                      /* fail closed: empty unless proven valid */
    }
    if (pkt_len == 0) {
        return -1;
    }
    size_t len = pkt[0];
    if (len > pkt_len - 1) {
        return -1;                          /* claims more than was received */
    }
    if (out_size == 0 || len > out_size - 1) {
        return -1;                          /* no room for text + terminator */
    }
    memcpy(out, &pkt[1], len);
    out[len] = '\0';
    return (int)len;
}

static void show(const char *label, const uint8_t *pkt, size_t pkt_len, size_t out_size)
{
    char out[8];
    memset(out, 'x', sizeof(out));
    out[sizeof(out) - 1] = '\0';
    int r = extract_text(pkt, pkt_len, out, out_size);
    printf("%s: %d [%s]\n", label, r, out);
}

int main(void)
{
    static const uint8_t ok[]      = { 3, 'L', 'E', 'D' };
    static const uint8_t lying[]   = { 200, 'h', 'i' };
    static const uint8_t toolong[] = { 8, 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H' };
    static const uint8_t fits[]    = { 7, 'A', 'B', 'C', 'D', 'E', 'F', 'G' };
    static const uint8_t empty[]   = { 0 };

    show("ok", ok, sizeof(ok), 8);
    show("claims 200, has 2", lying, sizeof(lying), 8);
    show("8 chars into 8 bytes", toolong, sizeof(toolong), 8);
    show("7 chars into 8 bytes", fits, sizeof(fits), 8);
    show("zero-length text", empty, sizeof(empty), 8);
    show("no bytes received", ok, 0, 8);
    show("truncated packet", ok, 3, 8);
    show("no output space at all", ok, sizeof(ok), 0);
    return 0;
}
`,
      tests: [{ name: 'valid, lying, oversized, exact, empty and truncated packets', stdout: 'ok: 3 [LED]\nclaims 200, has 2: -1 []\n8 chars into 8 bytes: -1 []\n7 chars into 8 bytes: 7 [ABCDEFG]\nzero-length text: 0 []\nno bytes received: -1 []\ntruncated packet: -1 []\nno output space at all: -1 [xxxxxxx]\n' }],
      hints: [
        'List every array index and every subtraction your function will perform. For each one: which earlier check guarantees it is in range, or cannot go below zero?',
        'Do not read `pkt[0]` until you know `pkt_len` is at least 1, and do not write `out[0]` unless `out_size` is at least 1.',
        'Two separate comparisons: `len > pkt_len - 1` (input too short for its claim) and `len > out_size - 1` (output too small, counting the terminator). Make sure neither subtraction can go below zero. Set `out[0] = \'\\0\'` at the very top (when `out_size > 0`) so that every error path leaves an empty string, then overwrite it on success.',
      ],
      explain: `The length byte is checked against the real input size (no over-read: the "claims 200" packet would otherwise copy 198 bytes of whatever follows it in memory) and against the output capacity including the terminator (no overflow: 8 characters need 9 bytes). Writing the failure result first and the success result last is the fail-closed shape: a forgotten check cannot leave stale data in \`out\`.`,
    }),
    { t: 'exercise',
      prompt: 'A firmware update routine receives `uint32_t offset` and `uint32_t length` and must write `length` bytes at `offset` inside a 0x8000-byte application region. Write the validation condition that rejects every request that would write outside the region, and explain why `offset + length <= 0x8000` is not good enough.',
      hints: [
        'Pick `offset = 0x7000` and a `length` so large that the 32-bit sum wraps around to a small value.',
        'Check `offset` on its own first.',
        'Then compare `length` with the space remaining after `offset`.',
      ],
      solution: 'Reject if `offset > 0x8000 || length > 0x8000 - offset`. With the naive form, `offset = 0x7000` and `length = 0xFFFFA000` sum to `0x100001000`, which truncates to `0x1000`, passing the test while describing a write of four gigabytes starting inside the region. In a bootloader that means overwriting whatever follows the application area, possibly the bootloader itself. The subtraction form cannot wrap because `offset` has already been shown to be at most `0x8000`.' },
    `## A harder case: a checklist for any function that takes external data

Take any handler that processes a packet, a command line or a stored record, and go through it with these questions.
This is how a reviewer reads C, and how the security section will ask you to attack it.

1. **Where does each length, count and index come from?** Mark the ones an outsider controls.
2. **Is each checked before its first use**, against the real input size and the destination capacity?
3. **Can any arithmetic in a check wrap or truncate?** Look for additions and multiplications of unchecked values, narrow types, and signed/unsigned mixing.
4. **Is the same value that was checked the one that is used?** No recomputation at a different width, no re-reading of a field that could have changed.
5. **Is every string terminated** after every bounded copy?
6. **Is every return value handled**, and does every failure path leave the system in a safe state?
7. **What do the tools say?** Build with \`-Wall -Wextra\` (add \`-Wconversion -Wshadow -Wformat=2\` for new code), treat warnings as defects, and run unit tests on a PC with \`-fsanitize=address,undefined\`, which catches most of this lesson's bugs at the moment they happen.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §7.24.2.4 (strncpy), §7.21.6.5 (snprintf), §7.24.2.1 (memcpy)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'SEI CERT C: STR31-C. Guarantee that storage for strings has sufficient space for character data and the null terminator', url: 'https://wiki.sei.cmu.edu/confluence/display/c/STR31-C.+Guarantee+that+storage+for+strings+has+sufficient+space+for+character+data+and+the+null+terminator' },
      { title: 'SEI CERT C: INT30-C. Ensure that unsigned integer operations do not wrap', url: 'https://wiki.sei.cmu.edu/confluence/display/c/INT30-C.+Ensure+that+unsigned+integer+operations+do+not+wrap' },
      { title: 'SEI CERT C: ERR33-C. Detect and handle standard library errors', url: 'https://wiki.sei.cmu.edu/confluence/display/c/ERR33-C.+Detect+and+handle+standard+library+errors' },
      { title: 'GCC manual: warning options; instrumentation options (-fsanitize)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html' },
    ] },
  ],
  quiz: [
    { q: 'After `char id[4]; strncpy(id, "ABCD", sizeof(id));`, what does `printf("%s", id)` do?', kind: 'code', choices: [
      { t: 'Prints `ABCD` and then continues with whatever bytes follow `id` in memory until a zero byte', ok: true, why: 'The four characters fill the array, and `strncpy` adds a terminator only when the source is shorter than the count.' },
      { t: 'Prints `ABC`, because `strncpy` reserves the last byte for the terminator', why: 'That is the behaviour people expect. `strncpy` reserves nothing; it copies up to the count and stops.' },
      { t: 'Prints `ABCD` exactly; the array size tells `printf` where to stop', why: '`printf` receives only a pointer. It has no knowledge of the array\'s size and relies on the zero byte.' },
      { t: 'Fails to compile because the literal is too long for the array', why: 'The literal is passed as a function argument, not used as an initialiser, so no size check applies.' },
    ] },
    { q: '`int n = snprintf(buf, 16, "%s:%d", name, port);` returns 21. What does that tell you?', kind: 'concept', choices: [
      { t: 'The output was truncated to 15 characters plus a terminator; the full text needs 21 characters', ok: true, why: 'The return value is the length the complete output would have had. Anything at or above the buffer size means truncation.' },
      { t: '21 bytes were written, so the buffer has overflowed', why: '`snprintf` never writes more than the size it was given. That is the purpose of the size argument.' },
      { t: 'An error occurred; errors are reported as values above the size', why: 'Errors are reported as negative values. A large positive value is information about truncation.' },
      { t: 'The buffer contains 21 characters and no terminator', why: 'For a non-zero size the output is always terminated, within the given size.' },
    ] },
    { q: 'Which bounds check correctly rejects all out-of-range requests when `off` and `len` are `uint32_t` values from a packet and `cap` is the buffer size?', kind: 'security', choices: [
      { t: '`if (off > cap || len > cap - off) reject();`', ok: true, why: 'No addition of untrusted values, and the subtraction is safe because `off <= cap` has been established first.' },
      { t: '`if (off + len > cap) reject();`', why: 'The sum can wrap past 2³² to a small number, which then passes the comparison.' },
      { t: '`if ((int)(off + len) > (int)cap) reject();`', why: 'Casting to signed makes a large wrapped sum negative, which is "less than" the capacity and is accepted.' },
      { t: '`if (len > cap) reject();`', why: 'This ignores the offset altogether: a small length at a large offset is still outside the buffer.' },
    ] },
    { q: 'A function calls `i2c_read(SENSOR, buf, 2)` and ignores its return value. The sensor is disconnected. What does the caller most likely compute with?', kind: 'concept', choices: [
      { t: 'Whatever was already in `buf`: a previous reading or uninitialised stack bytes', ok: true, why: 'A failed read usually leaves the buffer untouched, so the code proceeds with stale or random data as if it were fresh.' },
      { t: 'Zeros, because failed reads clear the buffer', why: 'Drivers generally do not clear the caller\'s buffer on failure. Assuming zeros is itself a hidden dependency.' },
      { t: 'Nothing; the program stops with an error', why: 'C has no exceptions. A returned error code that nobody reads has no effect on control flow.' },
      { t: 'The value 0xFF, since an idle I²C line reads high', why: 'That may occur with some drivers that clock in data regardless, but it cannot be relied on, and it is still not a valid measurement.' },
    ] },
    { q: 'An authentication routine is written as below. What is the design flaw?', code: C`
bool authorised = true;
if (check_pin(input) != PIN_OK) authorised = false;
if (check_lockout() == LOCKED)  authorised = false;
return authorised;`, kind: 'security', choices: [
      { t: 'It fails open: the default is "authorised", so any check that is skipped, forgotten or returns an unexpected code grants access', ok: true, why: 'A safer structure starts from "not authorised" and sets success only after every check has positively passed.' },
      { t: 'It evaluates both checks even when the first fails', why: 'Running both checks is not a flaw in itself, and can even help to keep timing uniform.' },
      { t: '`bool` cannot be returned from a function', why: 'Returning `bool` is ordinary C99. The problem is the initial value, not the type.' },
      { t: 'It should use `strcmp` to compare the PIN', why: 'How the PIN is compared is inside `check_pin`. The flaw asked about is in the structure of this function.' },
    ] },
    { q: 'Why keep sizes and lengths in `size_t` or another unsigned type instead of `int`?', kind: 'concept', choices: [
      { t: 'A negative `int` length passes checks such as `len < MAX` and then converts to a huge unsigned value when given to `memcpy`', ok: true, why: 'The comparison is done as signed and succeeds; the conversion at the call turns −1 into 4 294 967 295.' },
      { t: 'Unsigned arithmetic is faster on microcontrollers', why: 'Addition and comparison cost the same either way. The reason is correctness of range checks.' },
      { t: 'Unsigned values cannot overflow', why: 'They wrap, which is defined but still dangerous. That is why checks are written with subtraction from a trusted bound.' },
      { t: '`int` is only 8 bits on most MCUs', why: '`int` is at least 16 bits everywhere and 32 bits on the cores used in this course.' },
    ] },
  ],
};

export default [isrSafe, alignment, defensive];
