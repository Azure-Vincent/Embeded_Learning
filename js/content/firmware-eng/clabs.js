// C-lab exercises for the firmware-eng section. Each export is the `props` object of a `c-lab` widget.
// Programs that touch no Bench-MCU register were also compiled with host gcc and their output compared.
const C = String.raw;

/* ------------------------------------------------------------------ 1. ring buffer put/get */
const rbHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define RB_SIZE 8u                  /* power of two; holds RB_SIZE-1 bytes */
#define RB_MASK (RB_SIZE - 1u)

static uint8_t rb_buf[RB_SIZE];
static volatile uint16_t rb_head;   /* next slot to write: producer only */
static volatile uint16_t rb_tail;   /* next slot to read:  consumer only */
`;
const rbMain = C`
int main(void)
{
    uint8_t b = 0;
    int i;
    int accepted = 0;

    for (i = 0; i < 10; i++) {               /* try to store 10 bytes in a FIFO that holds 7 */
        if (rb_put((uint8_t)('a' + i))) accepted++;
    }
    printf("accepted=%d\n", accepted);

    for (i = 0; i < 3; i++) {                /* read three back */
        if (rb_get(&b)) putchar(b);
    }
    putchar('\n');

    for (i = 0; i < 3; i++) rb_put((uint8_t)('X' + i));   /* these wrap past the end of rb_buf */
    while (rb_get(&b)) putchar(b);
    putchar('\n');

    b = '?';
    i = rb_get(&b) ? 0 : 1;                  /* a get from an empty FIFO must not touch b */
    printf("empty=%d b=%c\n", i, b);
    printf("head=%u tail=%u\n", (unsigned)rb_head, (unsigned)rb_tail);
    return 0;
}
`;
export const clRingPutGet = {
  title: 'Implement ring buffer put and get',
  prompt: `Write \`rb_put\` and \`rb_get\` for an 8-slot byte FIFO that keeps **one slot empty** (so it holds 7 bytes).

- \`rb_put\` returns \`false\` and stores nothing when the FIFO is full.
- \`rb_get\` returns \`false\` and leaves \`*b\` alone when the FIFO is empty.
- Indices wrap with \`& RB_MASK\`. Only \`rb_put\` may write \`rb_head\`; only \`rb_get\` may write \`rb_tail\`.

\`main\` is the test bench: do not change it.`,
  starter: rbHead + C`
/* Store one byte. Return false if the FIFO is full. */
bool rb_put(uint8_t b)
{
    /* TODO: compute the next head, refuse if it would collide with tail,
       otherwise store the byte and then publish the new head */
    (void)b;
    return false;
}

/* Fetch the oldest byte. Return false if the FIFO is empty. */
bool rb_get(uint8_t *b)
{
    /* TODO */
    (void)b;
    return false;
}
` + rbMain,
  solution: rbHead + C`
/* Store one byte. Return false if the FIFO is full. */
bool rb_put(uint8_t b)
{
    uint16_t head = rb_head;
    uint16_t next = (uint16_t)((head + 1u) & RB_MASK);
    if (next == rb_tail) return false;   /* full: one slot stays empty */
    rb_buf[head] = b;                    /* store first */
    rb_head = next;                      /* publish second */
    return true;
}

/* Fetch the oldest byte. Return false if the FIFO is empty. */
bool rb_get(uint8_t *b)
{
    uint16_t tail = rb_tail;
    if (tail == rb_head) return false;   /* empty */
    *b = rb_buf[tail];
    rb_tail = (uint16_t)((tail + 1u) & RB_MASK);
    return true;
}
` + rbMain,
  tests: [{ name: 'fill, drain, wrap', stdout: 'accepted=7\nabc\ndefgXYZ\nempty=1 b=?\nhead=2 tail=2\n' }],
  hints: [
    'Empty is `head == tail`. If "full" were also `head == tail` you could not tell them apart, which is why one slot is sacrificed.',
    'Full means: *if I advanced head by one, it would equal tail*. Compute `next = (head + 1) & RB_MASK` and compare that with `rb_tail`.',
    'In `rb_put`, write `rb_buf[head] = b` **before** `rb_head = next`. In `rb_get`, read the byte before advancing `rb_tail`.',
  ],
  explain: `The order inside \`rb_put\` matters once the producer is an interrupt: the consumer decides "there is data" by looking at \`rb_head\`. If you published the new head first and were interrupted before storing the byte, the consumer would read a slot that still holds stale data. Store, then publish.

The final line shows \`head=2 tail=2\`: ten puts were accepted in total (7 + 3), and 10 & 7 = 2. The indices went past the end of the array and came back, and the data stayed in order.`,
};

/* ------------------------------------------------------------------ 2. off-by-one in full / count */
const obHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define RB_SIZE 8u
#define RB_MASK (RB_SIZE - 1u)

static uint8_t rb_buf[RB_SIZE];
static uint16_t rb_head, rb_tail;
`;
const obTail = C`
static bool rb_put(uint8_t b)
{
    if (rb_full()) return false;
    rb_buf[rb_head] = b;
    rb_head = (uint16_t)((rb_head + 1u) & RB_MASK);
    return true;
}

static bool rb_get(uint8_t *b)
{
    if (rb_head == rb_tail) return false;
    *b = rb_buf[rb_tail];
    rb_tail = (uint16_t)((rb_tail + 1u) & RB_MASK);
    return true;
}

int main(void)
{
    uint8_t b = 0;
    int i;
    int accepted = 0;

    /* Scenario A: a burst of 9 bytes arrives before the main loop reads anything. */
    for (i = 0; i < 9; i++) {
        if (rb_put((uint8_t)('1' + i))) accepted++;
    }
    printf("A: accepted=%d count=%d\n", accepted, rb_count());
    printf("A: data=");
    while (rb_get(&b)) putchar(b);
    putchar('\n');

    /* Scenario B: move the indices near the end, then store 3 bytes so head wraps. */
    rb_head = 6; rb_tail = 6;
    for (i = 0; i < 3; i++) rb_put((uint8_t)('w' + i));
    printf("B: head=%u tail=%u count=%d\n", (unsigned)rb_head, (unsigned)rb_tail, rb_count());
    return 0;
}
`;
export const clRingOffByOne = {
  title: 'Debug: the FIFO that loses everything',
  prompt: `A field report says: *"if the host sends a long burst, the device ignores the whole burst, not just the tail of it."*

Run the program. Scenario A stores 9 bytes into a FIFO that holds 7. Expected: 7 accepted, data \`1234567\`. Scenario B stores 3 bytes across the end of the array and expects \`count=3\`.

There are **two** bugs, both in the two short helper functions at the top. Find and fix them. Do not change \`rb_put\`, \`rb_get\` or \`main\`.`,
  starter: obHead + C`
static bool rb_full(void)
{
    return rb_head + 1u == rb_tail;
}

static int rb_count(void)
{
    return rb_head - rb_tail;
}
` + obTail,
  solution: obHead + C`
static bool rb_full(void)
{
    return ((rb_head + 1u) & RB_MASK) == rb_tail;
}

static int rb_count(void)
{
    return (int)((rb_head - rb_tail) & RB_MASK);
}
` + obTail,
  tests: [{ name: 'burst and wrapped count', stdout: 'A: accepted=7 count=7\nA: data=1234567\nB: head=1 tail=6 count=3\n' }],
  hints: [
    'Trace scenario A by hand: after 7 puts, `head` is 7 and `tail` is 0. What does `rb_head + 1u == rb_tail` evaluate to?',
    '`7 + 1` is 8, and no index is ever 8. The comparison must use the *wrapped* next index. After the bad eighth put, head wraps to 0 = tail, which is the definition of empty: seven good bytes vanish.',
    'In scenario B, head (1) is numerically smaller than tail (6). `1 - 6` is −5, and dropping the sign gives 5, which is the number of *free* positions, not the 3 bytes stored. Wrap the difference instead: `(head - tail) & RB_MASK`.',
  ],
  explain: `The first bug is the dangerous one. A missing mask in the full check does not lose one byte: it lets head catch up with tail, and \`head == tail\` means *empty*, so everything queued is silently discarded. It only shows when the head is at the last index at the moment the buffer fills, which is why it survives casual testing.

Both fixes are the same idea: every index computation ends with the wrap. Unsigned subtraction followed by the mask gives the right count even when head is behind tail.`,
};

/* ------------------------------------------------------------------ 3. length-prefixed frame */
const frHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

#define PAYLOAD_MAX 8u

/* Frame on the wire:  [len][payload: len bytes][sum]   sum = low 8 bits of the payload sum */
typedef struct {
    uint8_t len;
    uint8_t payload[PAYLOAD_MAX];
    uint8_t is_admin;        /* set elsewhere after authentication; lives right behind the payload */
} session_t;
`;
const frMain = C`
int main(void)
{
    session_t s;
    bool ok;
    static const uint8_t good[]  = { 3, 'a', 'b', 'c', 0x26 };
    static const uint8_t evil[]  = { 12, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 12 };
    static const uint8_t trunc[] = { 6, 'x', 'y', 'z' };              /* claims 6, carries 3 */
    static const uint8_t badsum[] = { 2, 'h', 'i', 0x00 };
    static const uint8_t full[]  = { 8, 1, 2, 3, 4, 5, 6, 7, 8, 36 };  /* exactly PAYLOAD_MAX */

    memset(&s, 0, sizeof s);
    ok = frame_parse(&s, good, sizeof good);
    printf("good=%d len=%u\n", ok ? 1 : 0, (unsigned)s.len);
    printf("evil=%d\n", frame_parse(&s, evil, sizeof evil));
    printf("trunc=%d\n", frame_parse(&s, trunc, sizeof trunc));
    printf("cut=%d\n", frame_parse(&s, good, sizeof good - 1u));     /* the good frame, checksum byte not yet received */
    printf("none=%d\n", frame_parse(&s, NULL, 0u));                  /* nothing received: there is no in[0] to read */
    printf("badsum=%d\n", frame_parse(&s, badsum, sizeof badsum));
    printf("kept: len=%u payload=%c%c%c\n", (unsigned)s.len, s.payload[0], s.payload[1], s.payload[2]);
    printf("full=%d\n", frame_parse(&s, full, sizeof full));
    printf("is_admin=%u\n", (unsigned)s.is_admin);
    return 0;
}
`;
export const clFrameBounds = {
  title: 'Debug: a length byte you should not have trusted',
  prompt: `\`frame_parse\` copies a length-prefixed frame into a session structure. It believes the length byte.

Run it: the frame called \`evil\` claims 12 payload bytes, and after parsing it \`is_admin\` is no longer 0, although nothing authenticated anyone.

Fix \`frame_parse\` so that it returns \`false\` **without writing anything** to \`*s\` when
1. the claimed length is larger than \`PAYLOAD_MAX\`,
2. the input is too short to contain the length byte, \`len\` payload bytes and the checksum byte (\`n\` is the number of bytes received; with \`n == 0\` not even \`in[0]\` may be read), or
3. the checksum is wrong.

A frame of exactly \`PAYLOAD_MAX\` bytes is legal. The test bench checks that the session still holds the last *good* frame after every rejected one.`,
  starter: frHead + C`
static bool frame_parse(session_t *s, const uint8_t *in, size_t n)
{
    uint8_t len = in[0];
    uint8_t sum = 0;
    size_t i;

    memcpy(s->payload, &in[1], len);          /* trusts len */
    s->len = len;
    for (i = 0; i < len; i++) sum = (uint8_t)(sum + in[1 + i]);
    return sum == in[1 + len];
}
` + frMain,
  solution: frHead + C`
static bool frame_parse(session_t *s, const uint8_t *in, size_t n)
{
    uint8_t len;
    uint8_t sum = 0;
    size_t i;

    if (n < 2u) return false;                 /* need at least len + sum */
    len = in[0];
    if (len > PAYLOAD_MAX) return false;      /* would not fit the destination */
    if ((size_t)len + 2u > n) return false;   /* would read past the source */

    for (i = 0; i < len; i++) sum = (uint8_t)(sum + in[1 + i]);
    if (sum != in[1 + len]) return false;     /* validate before committing */

    memcpy(s->payload, &in[1], len);
    s->len = len;
    return true;
}
` + frMain,
  tests: [{ name: 'good, oversized, truncated, bad checksum, maximum', stdout: 'good=1 len=3\nevil=0\ntrunc=0\ncut=0\nnone=0\nbadsum=0\nkept: len=3 payload=abc\nfull=1\nis_admin=0\n' }],
  hints: [
    'There are two different bounds: the size of the *destination* (`PAYLOAD_MAX`) and the number of bytes actually *received* (`n`). A parser has to check the length field against both.',
    'A frame with `len` payload bytes occupies `len + 2` bytes in total. Compare that with `n` before reading `in[1 + len]`.',
    'Do all checks, including the checksum, before the `memcpy`. A function that rejects a frame should leave the session untouched.',
  ],
  explain: `With the original code the 12-byte copy ran off the end of the 8-byte \`payload\` array and into the next member of the same struct. No crash, no warning: just a flag that changed value. This is the most common shape of an embedded memory-corruption bug, and the security section returns to it.

The rule: **a length that arrived from outside is data, not a fact.** Check it against the destination capacity and against what was received, in that order, before using it as a size or an index.`,
};

/* ------------------------------------------------------------------ 4. stack painting */
const spHead = C`#include <stdint.h>
#include <stdio.h>

#define STACK_WORDS 64u
#define PAINT 0xA5A5A5A5u

/* A pretend task stack. Like a real one it is used from the TOP index downward,
   so the words nearest index 0 are the last to be touched. */
static uint32_t task_stack[STACK_WORDS];
static uint32_t next_object;   /* NOT part of the stack: whatever the linker placed right after it */
`;
const spMain = C`
/* Test bench: pretend a function call chain used the top words of the stack. */
static void simulate_use(uint32_t words)
{
    uint32_t i;
    for (i = 0; i < words; i++) task_stack[STACK_WORDS - 1u - i] = 0x20000000u + i;
}

int main(void)
{
    next_object = PAINT;             /* the neighbour happens to hold the same bit pattern */
    stack_paint();
    printf("fresh: free=%u\n", (unsigned)stack_high_water());
    simulate_use(10);
    task_stack[STACK_WORDS - 4u] = PAINT;   /* one of the ten used words is a saved value equal to the pattern */
    printf("after 10: free=%u\n", (unsigned)stack_high_water());
    simulate_use(40);
    printf("after 40: free=%u\n", (unsigned)stack_high_water());
    simulate_use(5);                 /* a shallower call later does not "give back" the mark */
    printf("after 5: free=%u\n", (unsigned)stack_high_water());
    simulate_use(64);
    printf("after 64: free=%u\n", (unsigned)stack_high_water());
    return 0;
}
`;
export const clStackPaint = {
  title: 'Measure stack use by painting',
  prompt: `Implement the two functions behind every "stack high-water mark" feature.

- \`stack_paint()\` fills the whole stack area with the pattern \`PAINT\`.
- \`stack_high_water()\` returns how many words have **never been written**: count from index 0 upward while the word still equals \`PAINT\`, and stop at the first word that differs.

The stack is used from the top index downward, so untouched words are at the low indices.`,
  starter: spHead + C`
void stack_paint(void)
{
    /* TODO */
}

/* Number of words never used since stack_paint(). */
uint32_t stack_high_water(void)
{
    /* TODO */
    return 0;
}
` + spMain,
  solution: spHead + C`
void stack_paint(void)
{
    uint32_t i;
    for (i = 0; i < STACK_WORDS; i++) task_stack[i] = PAINT;
}

/* Number of words never used since stack_paint(). */
uint32_t stack_high_water(void)
{
    uint32_t n = 0;
    while (n < STACK_WORDS && task_stack[n] == PAINT) n++;
    return n;
}
` + spMain,
  tests: [{ name: 'high-water mark only ever shrinks', stdout: 'fresh: free=64\nafter 10: free=54\nafter 40: free=24\nafter 5: free=24\nafter 64: free=0\n' }],
  hints: [
    'Painting is a plain loop over all `STACK_WORDS` entries.',
    'Scan from index 0. The loop needs two conditions: still inside the array, and the word still equals `PAINT`.',
    'Check the bound first: `while (n < STACK_WORDS && task_stack[n] == PAINT)`. With the tests the other way round you read one word past the array when the stack is completely untouched. With no bound at all the scan walks on into the neighbouring object, where the test bench has put the same pattern, and reports 65 free words out of 64.',
  ],
  explain: `This is what FreeRTOS does for \`uxTaskGetStackHighWaterMark()\`: task stacks are filled with a known byte when the task is created, and the function counts how much of the fill survives. The answer is the *minimum free space ever observed*, which is why the fourth line still says 24.

The scan stops at the **first** word that differs, on purpose. Counting every word that still equals the pattern would also count a used word whose value happens to be \`0xA5A5A5A5\` (the test bench plants one), and would report more free stack than there is: the unsafe direction for this measurement.

Two limits to remember. A function that reserves a big local array but never writes the far end of it leaves paint intact, so the mark can under-report. And \`free=0\` means the stack was at least completely used: it may have gone further and corrupted whatever lies below.`,
};

/* ------------------------------------------------------------------ 4b. recursion -> iteration */
const rcHead = C`#include <stdint.h>
#include <stdio.h>

#define N_SAMPLES 12000u

static uint8_t samples[N_SAMPLES];
`;
const rcMain = C`
int main(void)
{
    uint32_t i;
    for (i = 0; i < N_SAMPLES; i++) samples[i] = (uint8_t)(i & 0x0Fu);
    printf("sum(10)=%u\n", (unsigned)sum_samples(samples, 10u));
    printf("sum(all)=%u\n", (unsigned)sum_samples(samples, N_SAMPLES));
    return 0;
}
`;
export const clRecursion = {
  title: 'Remove a recursion that eats the stack',
  prompt: `\`sum_samples\` adds up a buffer recursively: one stack frame per sample. With 10 samples that is harmless. With 12000 samples it needs 12000 frames, and Bench-MCU has 64 KiB of RAM for *everything*.

Run it and read the failure. Then rewrite \`sum_samples\` so that its stack use does not depend on \`n\`. Keep the signature.`,
  starter: rcHead + C`
uint32_t sum_samples(const uint8_t *p, uint32_t n)
{
    if (n == 0u) return 0u;
    return p[0] + sum_samples(p + 1, n - 1u);    /* one frame per element */
}
` + rcMain,
  solution: rcHead + C`
uint32_t sum_samples(const uint8_t *p, uint32_t n)
{
    uint32_t sum = 0u;
    uint32_t i;
    for (i = 0u; i < n; i++) sum += p[i];        /* one frame, whatever n is */
    return sum;
}
` + rcMain,
  tests: [{ name: 'small and large buffers', stdout: 'sum(10)=45\nsum(all)=90000\n' }],
  hints: [
    'Each call pushes at least a return address, a saved frame pointer and the two arguments. Multiply by 12000 and compare with 64 KiB.',
    'What does the recursion actually carry from one level to the next? A running total and a position. Both fit in two local variables of a loop.',
    'Write a `for` loop over `i` from 0 to `n` that adds `p[i]` to a total. The total can reach 12000 × 15, so it needs a type wider than 16 bits.',
  ],
  explain: `Recursion depth that depends on input data is a stack size that depends on input data. On a desktop the stack is megabytes and grows on demand; on a microcontroller it is a fixed few hundred bytes to a few kilobytes and what lies beyond it is somebody else's memory.

Many embedded coding standards simply forbid recursion (MISRA C has a rule to that effect) because then the worst-case stack depth can be computed from the call graph.`,
};

/* ------------------------------------------------------------------ 5. debounce FSM */
const dbHead = C`#include <stdint.h>
#include <stdio.h>

#define STABLE_TICKS 3u     /* samples in a row needed to believe a change */

typedef enum { BTN_UP, BTN_MAYBE_DOWN, BTN_DOWN, BTN_MAYBE_UP } btn_state_t;

static btn_state_t btn_state = BTN_UP;
static uint8_t btn_count;
`;
const dbMain = C`
int main(void)
{
    /* One character per 5 ms sample: '1' = contact closed. Bounce on press and on release,
       plus one short glitch that must not count as a press. */
    const char *samples = "0010110111111101001000000110000111100";
    static const char names[] = "udDU";      /* u=UP d=MAYBE_DOWN D=DOWN U=MAYBE_UP */
    int presses = 0;
    int i;

    for (i = 0; samples[i] != '\0'; i++) {
        presses += debounce_step(samples[i] == '1');
        putchar(names[btn_state]);
    }
    printf("\npresses=%d\n", presses);
    return 0;
}
`;
export const clDebounce = {
  title: 'Write a debounce state machine',
  prompt: `Implement \`debounce_step\`, called once per 5 ms tick with the raw contact reading. It returns 1 on the single tick where a press is **confirmed**, otherwise 0.

| State | Input | Action |
|---|---|---|
| \`BTN_UP\` | raw 1 | count = 1, go to \`BTN_MAYBE_DOWN\` |
| \`BTN_MAYBE_DOWN\` | raw 1 | count++; when count reaches \`STABLE_TICKS\`: go to \`BTN_DOWN\`, **return 1** |
| \`BTN_MAYBE_DOWN\` | raw 0 | back to \`BTN_UP\` (it was bounce or noise) |
| \`BTN_DOWN\` | raw 0 | count = 1, go to \`BTN_MAYBE_UP\` |
| \`BTN_MAYBE_UP\` | raw 0 | count++; when count reaches \`STABLE_TICKS\`: go to \`BTN_UP\` |
| \`BTN_MAYBE_UP\` | raw 1 | back to \`BTN_DOWN\` |

Anything not listed: stay. The test bench prints one letter per tick for the state after the step.`,
  starter: dbHead + C`
/* Advance the machine by one sample. Returns 1 when a press is confirmed. */
int debounce_step(int raw)
{
    switch (btn_state) {
    case BTN_UP:
        /* TODO */
        break;
    case BTN_MAYBE_DOWN:
        /* TODO */
        break;
    case BTN_DOWN:
        /* TODO */
        break;
    case BTN_MAYBE_UP:
        /* TODO */
        break;
    }
    (void)raw;
    return 0;
}
` + dbMain,
  solution: dbHead + C`
/* Advance the machine by one sample. Returns 1 when a press is confirmed. */
int debounce_step(int raw)
{
    switch (btn_state) {
    case BTN_UP:
        if (raw) { btn_count = 1; btn_state = BTN_MAYBE_DOWN; }
        break;
    case BTN_MAYBE_DOWN:
        if (raw) {
            btn_count++;
            if (btn_count >= STABLE_TICKS) { btn_state = BTN_DOWN; return 1; }
        } else {
            btn_state = BTN_UP;
        }
        break;
    case BTN_DOWN:
        if (!raw) { btn_count = 1; btn_state = BTN_MAYBE_UP; }
        break;
    case BTN_MAYBE_UP:
        if (!raw) {
            btn_count++;
            if (btn_count >= STABLE_TICKS) btn_state = BTN_UP;
        } else {
            btn_state = BTN_DOWN;
        }
        break;
    }
    return 0;
}
` + dbMain,
  tests: [{ name: 'bouncy press, glitch, second press', stdout: 'uududduddDDDDDUDUUDUUuuuudduuuuddDDUU\npresses=2\n' }],
  hints: [
    'Each `case` only needs to look at `raw` and at `btn_count`. Nothing waits: the function returns immediately every time.',
    'The first sample that differs is already sample number 1, so set `btn_count = 1` when you *enter* a MAYBE state and compare with `STABLE_TICKS` after incrementing.',
    'Return 1 at exactly one place: the transition `BTN_MAYBE_DOWN` → `BTN_DOWN`.',
  ],
  explain: `Count the presses a naive \`if (raw && !last_raw) presses++\` would have reported on the same samples: every rising edge of the bounce, plus the glitch. The state machine reports two, one per real press, and it never called a delay function to do so. The cost is latency: a press is reported \`STABLE_TICKS\` samples (15 ms here) after the contact first closes.`,
};

/* ------------------------------------------------------------------ 6. blocking blink -> non-blocking */
const nbHead = C`#include <stdint.h>
#include <stdio.h>

#define LED_BIT      (1u << 0)
#define TIM_ENABLE   (1u << 0)
#define TIM_RELOAD   (1u << 1)
#define TIM_EXPIRED  (1u << 0)
#define BLINKS       6u

static uint32_t polls;       /* how many times the button was looked at */

/* Stand-in for "everything else the firmware must keep doing". */
static void poll_button(void)
{
    polls++;
}
`;
export const clNonBlocking = {
  title: 'Make a blocking blink non-blocking',
  prompt: `This superloop toggles an LED each time TIMER0 expires and is also supposed to keep polling a button. As written it sits in a \`while\` loop waiting for the timer, so the button is looked at only once per blink: a press shorter than the blink period is missed.

Rewrite the loop body so that it **never waits**. Each pass should
1. check \`TIM_STATUS\` once; if \`EXPIRED\` is set, clear it (write 1), toggle the LED and count the toggle,
2. call \`poll_button()\`.

The test passes when all 6 toggles happen *and* the button was polled at least 5 times per toggle.`,
  starter: nbHead + C`
int main(void)
{
    uint32_t toggles = 0;

    GPIO_DIR |= LED_BIT;
    TIM_LOAD = 40;                           /* expire every 40 ticks */
    TIM_CTRL = TIM_ENABLE | TIM_RELOAD;

    while (toggles < BLINKS) {
        while ((TIM_STATUS & TIM_EXPIRED) == 0u) {
            /* blocked: nothing else runs while we sit here */
        }
        TIM_STATUS = TIM_EXPIRED;            /* write 1 to clear */
        GPIO_TOGGLE = LED_BIT;
        toggles++;

        poll_button();
    }

    printf("toggles=%u responsive=%d\n", (unsigned)toggles, polls >= BLINKS * 5u ? 1 : 0);
    return 0;
}
`,
  solution: nbHead + C`
int main(void)
{
    uint32_t toggles = 0;

    GPIO_DIR |= LED_BIT;
    TIM_LOAD = 40;                           /* expire every 40 ticks */
    TIM_CTRL = TIM_ENABLE | TIM_RELOAD;

    while (toggles < BLINKS) {
        if ((TIM_STATUS & TIM_EXPIRED) != 0u) {   /* look once, do not wait */
            TIM_STATUS = TIM_EXPIRED;             /* write 1 to clear */
            GPIO_TOGGLE = LED_BIT;
            toggles++;
        }
        poll_button();                            /* runs on every pass */
    }

    printf("toggles=%u responsive=%d\n", (unsigned)toggles, polls >= BLINKS * 5u ? 1 : 0);
    return 0;
}
`,
  tests: [{ name: 'six toggles, button polled throughout', stdout: 'toggles=6 responsive=1\n', regs: { GPIO_DIR: 1, GPIO_OUT: 0 } }],
  hints: [
    'The inner `while` is the problem: it is a delay, just spelled differently.',
    'Turn "wait until the flag is set" into "if the flag is set, handle it". An `if` instead of a `while`.',
    '`poll_button()` must be outside the `if`, so it runs whether or not the timer expired on this pass.',
  ],
  explain: `The only change is \`while\` → \`if\`, and it changes what the processor does with its time. Before, almost every cycle was spent re-reading \`TIM_STATUS\`. After, the loop spins freely and each activity gets a turn on every pass. The timer hardware keeps time; the code only asks "has it happened yet?".

This is the core move of non-blocking firmware: no function is allowed to wait for something. It records what it is waiting for (here the hardware flag does that for you) and returns.`,
};

/* ------------------------------------------------------------------ 7. UART line receiver */
const lrHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define LINE_CAP 16u          /* longest accepted line, not counting the terminator */

typedef enum { LINE_COLLECT, LINE_DISCARD } line_state_t;

static line_state_t line_state = LINE_COLLECT;
static char    line_buf[LINE_CAP + 1u];
static uint8_t line_len;
static uint32_t overlong;
`;
const lrMain = C`
int main(void)
{
    uint32_t idle = 0;

    UART_CTRL = 1u;                              /* ENABLE */
    while (idle < 400u) {                        /* the simulator stops us once the line goes quiet */
        if ((UART_STATUS & UART_RX_AVAIL) != 0u) {
            uint8_t c = (uint8_t)UART_DATA;      /* reading DATA pops the byte */
            idle = 0;
            if (line_feed(c)) printf("[%s]\n", line_buf);
        } else {
            idle++;
        }
    }
    printf("overlong=%u\n", (unsigned)overlong);
    return 0;
}
`;
export const clLineReceiver = {
  title: 'Write a UART line receiver',
  prompt: `Bytes arrive one at a time from UART0. Implement \`line_feed\`, a two-state machine that assembles them into lines.

- Ignore \`'\\r'\` completely (so both \`\\n\` and \`\\r\\n\` endings work).
- In \`LINE_COLLECT\`: on \`'\\n'\` terminate \`line_buf\` with \`'\\0'\`, reset \`line_len\` and return \`true\`. Otherwise store the byte, **unless** the buffer already holds \`LINE_CAP\` characters: then count the line in \`overlong\`, reset \`line_len\`, and switch to \`LINE_DISCARD\`.
- In \`LINE_DISCARD\`: throw bytes away until \`'\\n'\`, then go back to \`LINE_COLLECT\` (returning \`false\`: the damaged line is never reported).

A line of exactly 16 characters must be accepted. \`main\` is the test bench.`,
  starter: lrHead + C`
/* Feed one byte. Returns true when a complete line is ready in line_buf. */
bool line_feed(uint8_t c)
{
    /* TODO */
    (void)c;
    return false;
}
` + lrMain,
  solution: lrHead + C`
/* Feed one byte. Returns true when a complete line is ready in line_buf. */
bool line_feed(uint8_t c)
{
    if (c == '\r') return false;

    switch (line_state) {
    case LINE_COLLECT:
        if (c == '\n') {
            line_buf[line_len] = '\0';
            line_len = 0;
            return true;
        }
        if (line_len >= LINE_CAP) {          /* no room left for this byte */
            line_len = 0;
            overlong++;
            line_state = LINE_DISCARD;
            return false;
        }
        line_buf[line_len] = (char)c;
        line_len++;
        return false;

    case LINE_DISCARD:
        if (c == '\n') line_state = LINE_COLLECT;
        return false;
    }
    return false;
}
` + lrMain,
  tests: [
    { name: 'two endings, an over-long line, recovery', uartRx: 'LOCK\r\nSTATUS\nTHIS LINE IS MUCH TOO LONG TO FIT\nOK\n', stdout: '[LOCK]\n[STATUS]\n[OK]\noverlong=1\n' },
    { name: 'exactly 16 characters is accepted', uartRx: '0123456789ABCDEF\n0123456789ABCDEFG\n\nPIN 4921\n', stdout: '[0123456789ABCDEF]\n[]\n[PIN 4921]\noverlong=1\n' },
  ],
  hints: [
    'Handle `\\r` first with an early return, then `switch (line_state)`.',
    '`line_buf` has `LINE_CAP + 1` bytes. The largest index you may store a character at is `LINE_CAP - 1`; index `LINE_CAP` is reserved for the terminator.',
    'The check before storing is `if (line_len >= LINE_CAP)`. With `>` you would store a 17th character where the terminator belongs and then write `\\0` one past the array.',
    'Why a DISCARD state instead of just resetting `line_len`? Because the tail of an over-long line would otherwise be parsed as if it were a new line. Think about what `xxxxxxxxxxxxxxxxxPIN 4921` should do.',
  ],
  explain: `The second state is the part people leave out. Without it, an attacker (or line noise) can pad a line so that its tail lands at the start of the buffer and is interpreted as a command that was never sent as a line of its own. Resynchronising only at a real line boundary closes that.

The complete, host-tested version of this parser is \`examples/firmware-eng/src/line_rx.c\`, with its tests in \`tests/test_line_rx.c\`.`,
};

/* ------------------------------------------------------------------ 8. table-driven FSM */
const tdHead = C`#include <stdint.h>
#include <stdio.h>

typedef enum { ST_LOCKED0, ST_LOCKED1, ST_LOCKED2, ST_UNLOCKED, ST_LOCKOUT, N_STATES } state_t;
typedef enum { EV_GOOD_PIN, EV_BAD_PIN, EV_TIMEOUT, EV_LOCK, N_EVENTS } event_t;
`;
const tdMain = C`
int main(void)
{
    static const char names[] = "012UX";     /* one letter per state */
    state_t st = ST_LOCKED0;
    int c;

    while ((c = getchar()) > 0) {            /* one event per input character */
        event_t ev;
        if (c == 'g') ev = EV_GOOD_PIN;
        else if (c == 'b') ev = EV_BAD_PIN;
        else if (c == 't') ev = EV_TIMEOUT;
        else if (c == 'l') ev = EV_LOCK;
        else if (c == '?') ev = (event_t)9;      /* an event number that does not exist */
        else if (c == '#') {                     /* a corrupted state variable */
            putchar(fsm_step((state_t)7, EV_LOCK) == (state_t)7 ? 'k' : '!');
            continue;
        }
        else continue;
        st = fsm_step(st, ev);
        putchar(names[st]);
    }
    putchar('\n');
    return 0;
}
`;
export const clTableFsm = {
  title: 'Implement a table-driven state machine',
  prompt: `Here the door lock is written as **data**: a table with one row per state and one column per event. \`ST_LOCKED0/1/2\` are "locked, with 0, 1 or 2 wrong PINs so far".

Fill in \`next_state\` and write \`fsm_step\`.

| Current state | GOOD_PIN | BAD_PIN | TIMEOUT | LOCK |
|---|---|---|---|---|
| LOCKED0 | UNLOCKED | LOCKED1 | stay | stay |
| LOCKED1 | UNLOCKED | LOCKED2 | stay | stay |
| LOCKED2 | UNLOCKED | LOCKOUT | stay | stay |
| UNLOCKED | stay | stay | LOCKED0 | LOCKED0 |
| LOCKOUT | stay | stay | LOCKED0 | stay |

\`fsm_step\` must return the current state unchanged if either index is out of range. Input letters: \`g\` good PIN, \`b\` bad PIN, \`t\` timeout, \`l\` lock. The test bench also sends \`?\` (an event number outside the table) and \`#\` (it calls \`fsm_step\` with state 7 and prints \`k\` if 7 comes back).`,
  starter: tdHead + C`
/* Row = current state, column = event. */
static const uint8_t next_state[N_STATES][N_EVENTS] = {
    /*               GOOD_PIN     BAD_PIN      TIMEOUT      LOCK        */
    /* LOCKED0  */ { ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0 },
    /* LOCKED1  */ { ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0 },
    /* LOCKED2  */ { ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0 },
    /* UNLOCKED */ { ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0 },
    /* LOCKOUT  */ { ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0,  ST_LOCKED0 },
};

state_t fsm_step(state_t st, event_t ev)
{
    /* TODO: bounds-check both indices, then look the answer up */
    (void)ev;
    return st;
}
` + tdMain,
  solution: tdHead + C`
/* Row = current state, column = event. */
static const uint8_t next_state[N_STATES][N_EVENTS] = {
    /*               GOOD_PIN     BAD_PIN      TIMEOUT      LOCK        */
    /* LOCKED0  */ { ST_UNLOCKED, ST_LOCKED1,  ST_LOCKED0,  ST_LOCKED0  },
    /* LOCKED1  */ { ST_UNLOCKED, ST_LOCKED2,  ST_LOCKED1,  ST_LOCKED1  },
    /* LOCKED2  */ { ST_UNLOCKED, ST_LOCKOUT,  ST_LOCKED2,  ST_LOCKED2  },
    /* UNLOCKED */ { ST_UNLOCKED, ST_UNLOCKED, ST_LOCKED0,  ST_LOCKED0  },
    /* LOCKOUT  */ { ST_LOCKOUT,  ST_LOCKOUT,  ST_LOCKED0,  ST_LOCKOUT  },
};

state_t fsm_step(state_t st, event_t ev)
{
    if ((unsigned)st >= N_STATES || (unsigned)ev >= N_EVENTS) return st;
    return (state_t)next_state[st][ev];
}
` + tdMain,
  tests: [
    { name: 'two bad PINs then a good one', stdin: 'bbg', stdout: '12U\n' },
    { name: 'lockout ignores the right PIN until timeout', stdin: 'bbbgltg', stdout: '12XXX0U\n' },
    { name: 'timeout and explicit lock', stdin: 'gtbgl', stdout: 'U01U0\n' },
    { name: 'a good PIN clears the bad count', stdin: 'bbglbb', stdout: '12U012\n' },
    { name: 'timeout and lock do not clear the bad count', stdin: 'btlbtlb', stdout: '111222X\n' },
    { name: 'unlocked and lockout ignore PINs', stdin: 'ggbtbbbblt', stdout: 'UUU012XXX0\n' },
    { name: 'out-of-range indices leave the state alone', stdin: 'b?#b', stdout: '11k2\n' },
  ],
  hints: [
    '"stay" means the cell holds the row\'s own state: in the LOCKED1 row, the TIMEOUT cell is `ST_LOCKED1`.',
    'The dispatch function is one line once the indices are known to be valid: `return (state_t)next_state[st][ev];`',
    'In the LOCKOUT row only TIMEOUT leaves. If your second test prints `U` too early, a GOOD_PIN cell in that row is wrong.',
  ],
  explain: `Every cell of the table had to be filled in, so every (state, event) pair got a decision. A \`switch\` lets you forget a case silently; a table does not. It also makes review easy: the table *is* the specification.

Notice what it cost: "number of bad PINs so far" became three separate states. If the limit were 10 you would need ten rows. That is the usual hybrid in real firmware: a small table or \`switch\` for the modes, plus a few **extended state variables** (a counter, a deadline) for quantities. \`examples/firmware-eng/src/lock.c\` does exactly that.`,
};

/* ------------------------------------------------------------------ 9. HAL with fake backend */
const fhHead = C`#include <stdint.h>
#include <stdio.h>

/* ---- HAL interface: all the application knows about hardware ---- */
typedef struct {
    void     (*led_write)(int on);
    uint32_t (*millis)(void);
} hal_t;

/* ---- Application: toggle the LED every 500 ms, without blocking ---- */
typedef struct {
    const hal_t *hal;
    uint32_t next_toggle_ms;
    int led_on;
} blinker_t;

void blinker_init(blinker_t *b, const hal_t *hal)
{
    b->hal = hal;
    b->led_on = 0;
    b->next_toggle_ms = hal->millis() + 500u;
    hal->led_write(0);
}

void blinker_poll(blinker_t *b)
{
    uint32_t now = b->hal->millis();
    if ((int32_t)(now - b->next_toggle_ms) >= 0) {
        b->led_on = !b->led_on;
        b->hal->led_write(b->led_on);
        b->next_toggle_ms += 500u;
    }
}

/* ---- Fake HAL for tests ---- */
static uint32_t fake_now_ms;        /* the test sets this: time moves only when the test says so */
static char     fake_log[32];       /* one character per led_write call: '1' or '0' */
static uint32_t fake_log_len;
`;
const fhMain = C`
int main(void)
{
    blinker_t b;
    uint32_t t;

    fake_now_ms = 0;
    blinker_init(&b, &fake_hal);

    for (t = 0; t <= 2600u; t += 100u) {     /* 2.6 simulated seconds, in an instant */
        fake_now_ms = t;
        blinker_poll(&b);
    }
    fake_log[fake_log_len] = '\0';
    printf("led calls: %s\n", fake_log);
    printf("count=%u\n", (unsigned)fake_log_len);

    for (; t <= 20000u; t += 100u) {         /* keep going: more LED writes than the log can hold */
        fake_now_ms = t;
        blinker_poll(&b);
    }
    printf("after 20 s: count=%u now=%u\n", (unsigned)fake_log_len, (unsigned)fake_now_ms);
    return 0;
}
`;
export const clFakeHal = {
  title: 'Write a fake HAL and test an application on it',
  prompt: `The blinker application above talks to hardware only through the two function pointers in \`hal_t\`. That means you can test it with no hardware at all.

Complete the **fake backend**:
- \`fake_led_write(on)\` appends \`'1'\` or \`'0'\` to \`fake_log\` (never writing past the last usable index, 30) and advances \`fake_log_len\`.
- \`fake_millis()\` returns \`fake_now_ms\`.
- \`fake_hal\` must point at these two functions.

The test bench runs 2.6 simulated seconds and prints every LED write the application made. It then runs on to 20 s, which is more writes than the log can hold: the fake must stop recording at 31 entries and must not damage the variables next to the log.`,
  starter: fhHead + C`
static void fake_led_write(int on)
{
    /* TODO: record the call */
    (void)on;
}

static uint32_t fake_millis(void)
{
    /* TODO */
    return 0;
}

static void todo_led(int on) { (void)on; }
static uint32_t todo_millis(void) { return 0; }

/* TODO: make this table point at the fake functions */
static const hal_t fake_hal = { todo_led, todo_millis };
` + fhMain,
  solution: fhHead + C`
static void fake_led_write(int on)
{
    if (fake_log_len < sizeof fake_log - 1u) {
        fake_log[fake_log_len] = on ? '1' : '0';
        fake_log_len++;
    }
}

static uint32_t fake_millis(void)
{
    return fake_now_ms;
}

static const hal_t fake_hal = { fake_led_write, fake_millis };
` + fhMain,
  tests: [{ name: 'LED writes over 2.6 simulated seconds', stdout: 'led calls: 010101\ncount=6\nafter 20 s: count=31 now=20000\n' }],
  hints: [
    'The fake does not *do* anything with the LED. It only remembers that it was asked.',
    'The initialiser order follows the struct: `{ fake_led_write, fake_millis }`.',
    'Expected log: one `0` from `blinker_init`, then a toggle at 500, 1000, 1500, 2000 and 2500 ms.',
    'If the last line is wrong, your recorder wrote past `fake_log`. Index 31 is reserved for the terminator the test bench adds, so record only while `fake_log_len < sizeof fake_log - 1u`.',
  ],
  explain: `The test checked *behaviour over time* (five toggles, 500 ms apart, starting from off) in a few hundred simulated statements, with no timer peripheral and no waiting. On real hardware the same \`blinker_poll\` would be handed a table whose \`led_write\` writes \`GPIO_SET\`/\`GPIO_CLR\` and whose \`millis\` reads a tick counter. The application source would not change by one character.

Because the fake owns the clock, it can also test things that are impractical on a bench, such as what happens when the millisecond counter wraps after 49.7 days.`,
};

/* ------------------------------------------------------------------ 10. timeout on polling loop */
const toHead = C`#include <stdint.h>
#include <stdio.h>

typedef enum { DRV_OK = 0, DRV_TIMEOUT = -1 } drv_status_t;
`;
const toMain = C`
int main(void)
{
    int i;
    UART_CTRL = 1u;                              /* ENABLE */
    for (i = 0; i < 3; i++) {
        uint8_t c = '?';
        drv_status_t st = uart_getc(&c, 500u);
        if (st == DRV_OK) printf("got %c\n", c);
        else printf("timeout, c=%c\n", c);       /* c must still be '?' */
    }
    return 0;
}
`;
export const clTimeout = {
  title: 'Add a timeout to a polling loop',
  prompt: `\`uart_getc\` waits for a byte. The sender transmits two bytes and then its cable falls out. As written, the third call never returns: the firmware is hung, the watchdog (if there is one) resets it, and nobody finds out why.

Give the wait a budget. \`uart_getc(out, max_polls)\` must
- return \`DRV_OK\` and store the byte in \`*out\` as soon as \`RX_AVAIL\` is set,
- return \`DRV_TIMEOUT\` (leaving \`*out\` alone) after checking the status \`max_polls\` times without success.`,
  starter: toHead + C`
drv_status_t uart_getc(uint8_t *out, uint32_t max_polls)
{
    (void)max_polls;
    while ((UART_STATUS & UART_RX_AVAIL) == 0u) {
        /* wait for ever */
    }
    *out = (uint8_t)UART_DATA;
    return DRV_OK;
}
` + toMain,
  solution: toHead + C`
drv_status_t uart_getc(uint8_t *out, uint32_t max_polls)
{
    while ((UART_STATUS & UART_RX_AVAIL) == 0u) {
        if (max_polls == 0u) return DRV_TIMEOUT;   /* budget spent: report, do not hang */
        max_polls--;
    }
    *out = (uint8_t)UART_DATA;
    return DRV_OK;
}
` + toMain,
  tests: [
    { name: 'two bytes, then silence', uartRx: 'AB', stdout: 'got A\ngot B\ntimeout, c=?\n' },
    { name: 'nothing connected at all', uartRx: '', stdout: 'timeout, c=?\ntimeout, c=?\ntimeout, c=?\n' },
  ],
  hints: [
    'Every `while (!(STATUS & FLAG))` needs a second way out.',
    'Count down `max_polls` inside the loop and return `DRV_TIMEOUT` when it reaches zero.',
    'Be careful not to decrement an unsigned zero: test for zero *before* subtracting.',
  ],
  explain: `A poll count is the crudest possible timeout: its real duration depends on the CPU clock and the optimisation level. Production drivers compare against a time base instead (\`hal_millis()\` in this section's examples), but the structure is identical: **every loop that waits for hardware has an exit that does not depend on the hardware.**

Then the caller has to do something sensible with \`DRV_TIMEOUT\`. Returning an error that every caller ignores is only slightly better than hanging.`,
};

/* ------------------------------------------------------------------ 11. UART TX driver */
const txHead = C`#include <stdint.h>
#include <stdio.h>

#define UART_ENABLE     (1u << 0)
#define TX_POLL_LIMIT   1000u

typedef enum { DRV_OK = 0, DRV_TIMEOUT = -1 } drv_status_t;
`;
const txMain = C`
/* Test bench: six bytes handed to the driver back to back, as fast as the CPU can call it. */
int main(void)
{
    int failed = 0;

    uart_init();
    failed += (uart_putc('T') != DRV_OK);
    failed += (uart_putc('=') != DRV_OK);
    failed += (uart_putc('2') != DRV_OK);
    failed += (uart_putc('A') != DRV_OK);
    failed += (uart_putc('\r') != DRV_OK);
    failed += (uart_putc('\n') != DRV_OK);
    printf("failed=%d\n", failed);
    return 0;
}
`;
export const clUartTx = {
  title: 'Write a register-level UART transmit driver',
  prompt: `Write the two lowest functions of a UART driver for Bench-MCU's UART0.

- \`uart_init()\` sets the \`ENABLE\` bit in \`UART_CTRL\` (bytes written while it is 0 are dropped).
- \`uart_putc(byte)\` waits until \`TX_READY\` is set in \`UART_STATUS\`, then writes the byte to \`UART_DATA\` and returns \`DRV_OK\`. If \`TX_READY\` has not appeared after \`TX_POLL_LIMIT\` checks it returns \`DRV_TIMEOUT\` without writing.

The starter "works" in the sense that it compiles and returns OK. Run it and look at what actually comes out of the UART. Then add \`uart_init\` only and run again before you fix \`uart_putc\`: which characters arrive?`,
  starter: txHead + C`
void uart_init(void)
{
    /* TODO */
}

drv_status_t uart_putc(uint8_t byte)
{
    UART_DATA = byte;        /* fires bytes at the transmitter without asking if it is ready */
    return DRV_OK;
}
` + txMain,
  solution: txHead + C`
void uart_init(void)
{
    UART_CTRL |= UART_ENABLE;
}

drv_status_t uart_putc(uint8_t byte)
{
    uint32_t polls = TX_POLL_LIMIT;
    while ((UART_STATUS & UART_TX_READY) == 0u) {    /* transmitter still busy with the last byte */
        if (polls == 0u) return DRV_TIMEOUT;
        polls--;
    }
    UART_DATA = byte;                                /* this write starts the transmission */
    return DRV_OK;
}
` + txMain,
  tests: [{ name: 'every byte arrives, in order', uartTx: 'T=2A\r\n', stdout: 'failed=0\n' }],
  hints: [
    'Set a bit without disturbing the others: `UART_CTRL |= UART_ENABLE;`',
    'After each write to `UART_DATA`, `TX_READY` goes low for a few ticks. A write during that time is lost.',
    'Use the same counted wait as in the timeout exercise, with the condition `(UART_STATUS & UART_TX_READY) == 0u`.',
  ],
  explain: `A real UART has a shift register that takes ten bit-times to send a byte (about 87 µs at 115200 baud, during which a fast MCU executes thousands of instructions). Writing the data register while it is busy either overwrites the byte in flight or is ignored, depending on the chip. The status flag is the hardware's way of telling you when it is safe.

Note that the return value of the starter was a lie: it said \`DRV_OK\` for bytes that never left. A driver's status must describe what happened on the wire, not whether the function reached its last line.`,
};

/* ------------------------------------------------------------------ 12. sensor driver on I2C HAL */
const i2Head = C`#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

/* ---- I2C HAL: one combined write-then-read transaction. Returns 0, or -1 if the device did not ACK. ---- */
typedef struct {
    int (*write_read)(uint8_t addr, const uint8_t *tx, size_t tx_len, uint8_t *rx, size_t rx_len);
} i2c_bus_t;

#define TSENSE_ADDR      0x48u
#define TSENSE_REG_TEMP  0x00u
#define TSENSE_REG_ID    0x0Fu
#define TSENSE_ID_VALUE  0xA1u

#define TS_OK        0
#define TS_ERR_BUS  -1      /* no ACK or bus failure         */
#define TS_ERR_ID   -2      /* something answered, but not this part */
#define TS_ERR_ARG  -3
`;
const i2Main = C`
/* ---- Fake bus used by the test bench: one device at 0x48 with two registers ---- */
static uint8_t fake_temp_hi, fake_temp_lo, fake_id = 0xA1u;
static uint32_t fake_transactions;

static int fake_write_read(uint8_t addr, const uint8_t *tx, size_t tx_len, uint8_t *rx, size_t rx_len)
{
    fake_transactions++;
    if (addr != TSENSE_ADDR) return -1;                  /* nobody home: NACK */
    if (tx_len != 1u) return -1;
    if (tx[0] == TSENSE_REG_TEMP && rx_len == 2u) { rx[0] = fake_temp_hi; rx[1] = fake_temp_lo; return 0; }
    if (tx[0] == TSENSE_REG_ID && rx_len == 1u) { rx[0] = fake_id; return 0; }
    return -1;
}

static const i2c_bus_t fake_bus = { fake_write_read };

int main(void)
{
    int32_t mc = 12345;
    int rc;

    printf("init=%d\n", tsense_init(&fake_bus, TSENSE_ADDR));
    printf("init wrong addr=%d\n", tsense_init(&fake_bus, 0x49u));

    fake_temp_hi = 0x19; fake_temp_lo = 0x80;            /* +25.5 C  */
    rc = tsense_read_millic(&fake_bus, TSENSE_ADDR, &mc);
    printf("rc=%d mC=%d\n", rc, (int)mc);

    fake_temp_hi = 0xFF; fake_temp_lo = 0xC0;            /* -0.25 C  */
    rc = tsense_read_millic(&fake_bus, TSENSE_ADDR, &mc);
    printf("rc=%d mC=%d\n", rc, (int)mc);

    mc = 777;
    rc = tsense_read_millic(&fake_bus, 0x49u, &mc);      /* no such device */
    printf("rc=%d mC=%d\n", rc, (int)mc);

    mc = 777;
    rc = tsense_read_millic(&fake_bus, TSENSE_ADDR, NULL);
    printf("null out=%d\n", rc);
    rc = tsense_read_millic(NULL, TSENSE_ADDR, &mc);
    printf("null bus=%d mC=%d init=%d\n", rc, (int)mc, tsense_init(NULL, TSENSE_ADDR));

    fake_id = 0x55u;                                     /* a different chip at the same address */
    printf("init wrong id=%d\n", tsense_init(&fake_bus, TSENSE_ADDR));
    return 0;
}
`;
export const clI2cSensor = {
  title: 'Write a bus-device driver on top of an I2C HAL',
  prompt: `Write a driver for an imaginary temperature sensor that behaves like the common TMP102 family: I2C address \`0x48\`, a 1-byte ID register (\`0x0F\`, reads \`0xA1\`) and a 2-byte temperature register (\`0x00\`).

The temperature is a **12-bit two's-complement number, left-justified** in the 16 bits, most significant byte first. One count is 0.0625 °C, i.e. 62.5 m°C.

- \`tsense_init(bus, addr)\`: read the ID register. Return \`TS_ERR_ARG\` for a NULL \`bus\`, \`TS_ERR_BUS\` if the bus call fails, \`TS_ERR_ID\` if the value is not \`TSENSE_ID_VALUE\`, else \`TS_OK\`.
- \`tsense_read_millic(bus, addr, out)\`: read the two temperature bytes and store the temperature in thousandths of a degree in \`*out\`. On any error return the code and **leave \`*out\` unchanged**. A NULL \`bus\` or \`out\` is \`TS_ERR_ARG\`.

The driver must use only \`bus->write_read\`. It has no idea which pins or which I2C peripheral are underneath.`,
  starter: i2Head + C`
int tsense_init(const i2c_bus_t *bus, uint8_t addr)
{
    /* TODO */
    (void)bus; (void)addr;
    return TS_OK;
}

int tsense_read_millic(const i2c_bus_t *bus, uint8_t addr, int32_t *out)
{
    /* TODO */
    (void)bus; (void)addr; (void)out;
    return TS_OK;
}
` + i2Main,
  solution: i2Head + C`
int tsense_init(const i2c_bus_t *bus, uint8_t addr)
{
    uint8_t reg = TSENSE_REG_ID;
    uint8_t id = 0;

    if (bus == NULL) return TS_ERR_ARG;
    if (bus->write_read(addr, &reg, 1u, &id, 1u) != 0) return TS_ERR_BUS;
    if (id != TSENSE_ID_VALUE) return TS_ERR_ID;
    return TS_OK;
}

int tsense_read_millic(const i2c_bus_t *bus, uint8_t addr, int32_t *out)
{
    uint8_t reg = TSENSE_REG_TEMP;
    uint8_t rx[2];
    int16_t raw16;
    int32_t counts;

    if (bus == NULL || out == NULL) return TS_ERR_ARG;
    if (bus->write_read(addr, &reg, 1u, rx, 2u) != 0) return TS_ERR_BUS;

    raw16 = (int16_t)(((uint16_t)rx[0] << 8) | rx[1]);   /* MSB first; the cast keeps the sign */
    counts = raw16 / 16;                                 /* drop the 4 unused low bits         */
    *out = counts * 625 / 10;                            /* 62.5 m°C per count, integer maths  */
    return TS_OK;
}
` + i2Main,
  tests: [{ name: 'identify, positive, negative, missing device, wrong chip', stdout: 'init=0\ninit wrong addr=-1\nrc=0 mC=25500\nrc=0 mC=-250\nrc=-1 mC=777\nnull out=-3\nnull bus=-3 mC=777 init=-3\ninit wrong id=-2\n' }],
  hints: [
    'A register read is one transaction: send 1 byte (the register number), then read N bytes. That is exactly what `write_read` offers.',
    'Combine the bytes as `((uint16_t)rx[0] << 8) | rx[1]`, then cast to `int16_t` so that a set top bit becomes a negative number.',
    'The low 4 bits are always zero, so dividing the signed 16-bit value by 16 gives the 12-bit count exactly, for negative values too.',
    '62.5 m°C per count without floating point: `counts * 625 / 10`. Check: 0x198 = 408 counts → 25500.',
  ],
  explain: `Layering is what made this testable: the driver knows the *device's* protocol (which register, how many bytes, what the bits mean) and nothing about the *bus's* hardware. The fake bus knows nothing about temperature. Each can be replaced without touching the other.

Check the real part's datasheet before reusing any of this: the register layout here is modelled on the TMP102 family's 12-bit format but the ID register is invented for the exercise. Reading an identification register in \`init\` is a real and valuable habit, though: it turns "wrong part fitted", "wrong address" and "bus not working" into three different error codes instead of one mysterious wrong reading.`,
};

/* ------------------------------------------------------------------ 13. image header */
const ihHead = C`#include <stdint.h>
#include <string.h>
#include <stdio.h>

#define IMG_MAGIC 0x4D495746u        /* bytes 'F' 'W' 'I' 'M' in memory order on a little-endian CPU */

typedef struct {
    uint32_t magic;
    uint16_t ver_major;
    uint16_t ver_minor;
    uint32_t length;                 /* payload bytes that follow the header */
    uint32_t crc;                    /* not checked in this exercise */
} image_header_t;                    /* 16 bytes, no padding */

#define IMG_OK            0
#define IMG_ERR_SHORT    -1          /* not even a whole header        */
#define IMG_ERR_MAGIC    -2
#define IMG_ERR_LENGTH   -3          /* claims more payload than exists */
#define IMG_ERR_ROLLBACK -4          /* older than we are allowed to run */
`;
const ihMain = C`
int main(void)
{
    /* header: magic, version 2.1, length 4, crc 0  + 4 payload bytes */
    static const uint8_t good[20] = { 'F','W','I','M', 2,0, 1,0, 4,0,0,0, 0,0,0,0, 1,2,3,4 };
    static const uint8_t oldv[20] = { 'F','W','I','M', 1,0, 9,0, 4,0,0,0, 0,0,0,0, 1,2,3,4 };
    static const uint8_t magic[20] = { 'F','W','I','N', 2,0, 1,0, 4,0,0,0, 0,0,0,0, 1,2,3,4 };
    static const uint8_t longer[20] = { 'F','W','I','M', 2,0, 1,0, 5,0,0,0, 0,0,0,0, 1,2,3,4 };
    static const uint8_t huge[20] = { 'F','W','I','M', 2,0, 1,0, 0xF8,0xFF,0xFF,0xFF, 0,0,0,0, 1,2,3,4 };
    static const uint8_t oldlong[20] = { 'F','W','I','M', 1,0, 9,0, 5,0,0,0, 0,0,0,0, 1,2,3,4 };   /* old AND too long */
    static const uint8_t empty[16] = { 'F','W','I','M', 2,0, 0,0, 0,0,0,0, 0,0,0,0 };              /* length 0 */

    printf("good=%d\n", image_check(good, sizeof good, 2));
    printf("short=%d\n", image_check(good, 10u, 2));
    printf("short, bad magic=%d\n", image_check(magic, 10u, 2));
    printf("magic=%d\n", image_check(magic, sizeof magic, 2));
    printf("rollback=%d\n", image_check(oldv, sizeof oldv, 2));
    printf("longer=%d\n", image_check(longer, sizeof longer, 2));
    printf("old and longer=%d\n", image_check(oldlong, sizeof oldlong, 2));
    printf("huge=%d\n", image_check(huge, sizeof huge, 2));
    printf("header only=%d\n", image_check(good, 16u, 2));      /* claims 4 payload bytes, none received */
    printf("zero length=%d\n", image_check(empty, sizeof empty, 2));
    return 0;
}
`;
export const clImageHeader = {
  title: 'Validate a firmware image header',
  prompt: `A bootloader or updater reads a 16-byte header in front of each firmware image. Write \`image_check(img, avail, min_major)\`, where \`avail\` is how many bytes were actually received. Check, **in this order**:

1. \`avail\` is at least \`sizeof(image_header_t)\`, else \`IMG_ERR_SHORT\`.
2. \`magic\` equals \`IMG_MAGIC\`, else \`IMG_ERR_MAGIC\`.
3. \`length\` is not larger than the bytes available after the header, else \`IMG_ERR_LENGTH\`.
4. \`ver_major\` is at least \`min_major\`, else \`IMG_ERR_ROLLBACK\`.

Copy the header out of the byte buffer with \`memcpy\` rather than casting the pointer: the buffer may not be aligned for a \`uint32_t\`. Watch the arithmetic in check 3: the image called \`huge\` claims a length of \`0xFFFFFFF8\`.`,
  starter: ihHead + C`
int image_check(const uint8_t *img, uint32_t avail, uint16_t min_major)
{
    /* TODO */
    (void)img; (void)avail; (void)min_major;
    return IMG_OK;
}
` + ihMain,
  solution: ihHead + C`
int image_check(const uint8_t *img, uint32_t avail, uint16_t min_major)
{
    image_header_t h;

    if (avail < sizeof h) return IMG_ERR_SHORT;
    memcpy(&h, img, sizeof h);                       /* alignment-safe copy out of the byte stream */

    if (h.magic != IMG_MAGIC) return IMG_ERR_MAGIC;
    if (h.length > avail - sizeof h) return IMG_ERR_LENGTH;   /* subtract on the trusted side: cannot wrap */
    if (h.ver_major < min_major) return IMG_ERR_ROLLBACK;
    return IMG_OK;
}
` + ihMain,
  tests: [{ name: 'good, short, bad magic, rollback, too long, wrapping length, check order', stdout: 'good=0\nshort=-1\nshort, bad magic=-1\nmagic=-2\nrollback=-4\nlonger=-3\nold and longer=-3\nhuge=-3\nheader only=-3\nzero length=0\n' }],
  hints: [
    'Declare a local `image_header_t h;` and `memcpy(&h, img, sizeof h);` after you know there are at least 16 bytes.',
    'The obvious length check is `sizeof h + h.length > avail`. Work out `16 + 0xFFFFFFF8` in 32-bit arithmetic.',
    'It wraps to 8, which is not greater than 20, so the check passes. Rearrange so the untrusted number stands alone: `h.length > avail - sizeof h`. The subtraction is safe because check 1 already guaranteed `avail >= sizeof h`.',
  ],
  explain: `Three habits in one small function. **Order of checks**: nothing is read until you know it is there. **memcpy, not a cast**: on Cortex-M0+ and many other cores an unaligned 32-bit load faults, and in any case the cast is undefined behaviour. **No arithmetic on untrusted values before they are bounded**: add or multiply an attacker's number and it can wrap to something small and innocent.

The header layout only works as a wire format because every member sits on its natural alignment with no padding, and because both ends are little-endian. Use the struct layout tool below to see what happens when you reorder the fields. Real update formats also authenticate the image (a signature or MAC over header and payload): a CRC only detects accidents. The security section covers that.`,
};

/* ------------------------------------------------------------------ 14. sanitizer finding */
const saHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define LINE_CAP 24u

typedef struct {
    uint8_t len;
    char buf[LINE_CAP];
    uint8_t unlocked;        /* the neighbour that gets hurt */
} console_t;
`;
const saMain = C`
int main(void)
{
    console_t con = { 0 };
    /* 30 x 'A'; then a line of 23 characters (the longest that fits), one of 24 (too long), and a normal one */
    const char *input = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"
                        "12345678901234567890123\n"
                        "123456789012345678901234\n"
                        "STATUS\n";
    int lines = 0;
    int i;

    for (i = 0; input[i] != '\0'; i++) {
        if (line_feed(&con, (uint8_t)input[i])) {
            lines++;
            printf("line: %s\n", con.buf);
        }
    }
    printf("lines=%d unlocked=%u\n", lines, (unsigned)con.unlocked);
    return 0;
}
`;
export const clSanitizerFix = {
  title: 'Fix the bug the sanitizer reported',
  prompt: `On the host, this line receiver passed its (too gentle) tests. Built with \`-fsanitize=address,undefined\` and fed a long line, the tools reported:

\`\`\`
bugs/line_rx_oob.c:27:24: runtime error: store to address 0x7fe5c8a00039 with insufficient
space for an object of type 'char'
\`\`\`

Here the same code runs on Bench-MCU with a flag placed right after the buffer, so you can see what the stray write does. Run it: \`unlocked\` ends up non-zero although nothing in the program ever sets it.

Fix \`line_feed\`. Requirements: at most \`LINE_CAP - 1\` characters are stored (the last byte of \`buf\` is for the terminator); a line that does not fit is dropped entirely, including its tail; the following line must still be received. The test bench sends the 30-character line, then a 23-character line (must be kept), a 24-character line (must be dropped) and \`STATUS\`.`,
  starter: saHead + C`
static bool discarding;

static bool line_feed(console_t *con, uint8_t c)
{
    if (c == '\n') {
        con->buf[con->len] = '\0';
        con->len = 0;
        return true;
    }
    if (con->len > LINE_CAP) {         /* the length check */
        con->len = 0;
        return false;
    }
    con->buf[con->len++] = (char)c;
    (void)discarding;
    return false;
}
` + saMain,
  solution: saHead + C`
static bool discarding;

static bool line_feed(console_t *con, uint8_t c)
{
    if (discarding) {                          /* tail of a line that was too long */
        if (c == '\n') discarding = false;
        return false;
    }
    if (c == '\n') {
        con->buf[con->len] = '\0';             /* len <= LINE_CAP-1: in bounds */
        con->len = 0;
        return true;
    }
    if (con->len >= LINE_CAP - 1u) {           /* no room for this byte plus the terminator */
        con->len = 0;
        discarding = true;
        return false;
    }
    con->buf[con->len++] = (char)c;
    return false;
}
` + saMain,
  tests: [{ name: 'over-long lines dropped, longest legal line kept, neighbour intact', stdout: 'line: 12345678901234567890123\nline: STATUS\nlines=2 unlocked=0\n' }],
  hints: [
    '`buf` has indices 0 to 23. With the check `len > LINE_CAP`, what is the largest `len` at which a byte is still stored?',
    'It stores at index 24, which is `unlocked`. The check has to stop storing while there is still one byte left for `\\0`: `len >= LINE_CAP - 1u`.',
    'Fixing the bound alone still prints a bogus line made of the tail of the long input. Use the `discarding` flag to skip everything up to the next `\\n`.',
  ],
  explain: `Without sanitizers this bug printed plausible output and exited with status 0 on the host: the stray byte landed in padding or in a variable nobody looked at. That is the normal behaviour of an out-of-bounds write, on a PC and on an MCU. It is not that the bug "does not happen"; it is that the damage is somewhere you are not looking.

ASan and UBSan cannot run on a 32 KiB microcontroller, but they can run on your host tests. Every module you can compile for the host gets this checking for free, which is one of the strongest arguments for keeping logic out of the hardware-dependent files.`,
};

/* ------------------------------------------------------------------ 15. regression tests drive a fix */
const puHead = C`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>
`;
const puMain = C`
/* ---- unit tests ---- */
static int n_pass, n_fail;

static void check(const char *text, bool want_ok, uint8_t want_value)
{
    uint8_t got = 0xEE;                       /* sentinel: must be untouched on failure */
    bool ok = parse_u8(text, &got);
    bool pass = (ok == want_ok) && (ok ? got == want_value : got == 0xEE);
    if (pass) n_pass++;
    else { n_fail++; printf("FAIL \"%s\": ok=%d value=%u\n", text, ok ? 1 : 0, (unsigned)got); }
}

int main(void)
{
    check("0", true, 0);
    check("7", true, 7);
    check("42", true, 42);
    check("255", true, 255);
    check("007", true, 7);
    check("256", false, 0);                   /* one past the maximum          */
    check("300", false, 0);
    check("1000", false, 0);                  /* 1000 & 0xFF = 232: must not pass as 232 */
    check("65580", false, 0);                 /* 65536 + 44: wraps a 16-bit accumulator to 44 */
    check("4294967300", false, 0);            /* 2^32 + 4: wraps a 32-bit accumulator to 4 */
    check("", false, 0);                      /* empty string is not a number  */
    check("12a", false, 0);
    check("-1", false, 0);
    check(" 5", false, 0);
    printf("%d passed, %d failed\n", n_pass, n_fail);
    return 0;
}
`;
export const clParseTests = {
  title: 'Let failing tests drive the fix',
  prompt: `\`parse_u8\` converts a decimal string such as \`"42"\` to a \`uint8_t\`. It is used to parse a brightness command. A user found that the command \`BRIGHT 300\` sets brightness 44.

Fourteen unit tests are already written in \`main\`. Run them and read which ones fail. Fix \`parse_u8\` until the last line reads \`14 passed, 0 failed\`.

Contract: return \`true\` and store the value only if the string is one or more decimal digits and the value is 0–255. Otherwise return \`false\` and do not write to \`*out\`.`,
  starter: puHead + C`
bool parse_u8(const char *s, uint8_t *out)
{
    uint8_t value = 0;
    while (*s != '\0') {
        if (*s < '0' || *s > '9') return false;
        value = (uint8_t)(value * 10u + (uint8_t)(*s - '0'));
        s++;
    }
    *out = value;
    return true;
}
` + puMain,
  solution: puHead + C`
bool parse_u8(const char *s, uint8_t *out)
{
    uint32_t value = 0;                        /* wider than the result, so overflow is visible */
    if (*s == '\0') return false;              /* at least one digit */
    while (*s != '\0') {
        if (*s < '0' || *s > '9') return false;
        value = value * 10u + (uint32_t)(*s - '0');
        if (value > 255u) return false;        /* checked every digit: cannot grow without bound */
        s++;
    }
    *out = (uint8_t)value;
    return true;
}
` + puMain,
  tests: [{ name: 'all fourteen unit tests pass', stdout: '14 passed, 0 failed\n' }],
  hints: [
    'Six tests fail, with two different causes. Start with `""`: how many times does the loop body run?',
    '`300` becomes 44 because the running value is kept in a `uint8_t`: 300 mod 256 = 44. Accumulate in a wider type.',
    'Compare against 255 after **every** digit, not once at the end. Otherwise a long enough string wraps the wider type too: that is what the last two failing tests are for.',
  ],
  explain: `The tests that failed were all at **boundaries**: the empty input, the first value past the maximum, a value far past it. The ones that passed were the "normal" inputs a developer tries by hand. That is the pattern to learn from: for each input, test the smallest, the largest, one beyond each, and the malformed.

When a bug like \`BRIGHT 300\` is found in the field, the first step is not to fix it. It is to write the test that fails because of it. Then the fix is finished when the test passes, and the bug cannot quietly return.`,
};

/* ------------------------------------------------------------------ 16. lab: port to Bench-MCU */
const ptHead = C`#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>

/* ======================= HAL interface (same as examples/firmware-eng/include/hal.h) ======= */
typedef enum { HAL_PIN_LATCH, HAL_PIN_LED, HAL_PIN_COUNT } hal_pin_t;

void     hal_init(void);
bool     hal_uart_read(uint8_t *byte);
void     hal_uart_write(uint8_t byte);
uint32_t hal_millis(void);
void     hal_gpio_write(hal_pin_t pin, bool level);

/* ======================= Board description for Bench-MCU ================================== */
#define PIN_LATCH_BIT  (1u << 4)
#define PIN_LED_BIT    (1u << 5)
#define TICKS_PER_MS   100u    /* timer ticks per "millisecond": scaled down so the simulator can cover 5 s */
#define TX_WAIT_LIMIT  1000u
`;
const ptApp = C`
/* ======================= Portable code below: identical on every target =================== */

/* ---- ring buffer ---- */
#define RB_SIZE 64u
#define RB_MASK (RB_SIZE - 1u)
static uint8_t rb_buf[RB_SIZE];
static volatile uint16_t rb_head, rb_tail;

static bool rb_put(uint8_t b)
{
    uint16_t next = (uint16_t)((rb_head + 1u) & RB_MASK);
    if (next == rb_tail) return false;
    rb_buf[rb_head] = b;
    rb_head = next;
    return true;
}

static bool rb_get(uint8_t *b)
{
    if (rb_head == rb_tail) return false;
    *b = rb_buf[rb_tail];
    rb_tail = (uint16_t)((rb_tail + 1u) & RB_MASK);
    return true;
}

/* ---- line receiver ---- */
#define LINE_CAP 24u
static char line_buf[LINE_CAP + 1u];
static uint8_t line_len;
static bool line_discard;

static bool line_feed(uint8_t c)
{
    if (c == '\r') return false;
    if (line_discard) { if (c == '\n') line_discard = false; return false; }
    if (c == '\n') { line_buf[line_len] = '\0'; line_len = 0; return true; }
    if (line_len >= LINE_CAP) { line_len = 0; line_discard = true; return false; }
    line_buf[line_len] = (char)c;
    line_len++;
    return false;
}

/* ---- door-lock state machine ---- */
#define LOCK_UNLOCK_MS   5000u
#define LOCK_LOCKOUT_MS 30000u
#define LOCK_MAX_BAD        3u
typedef enum { LOCK_LOCKED, LOCK_UNLOCKED, LOCK_LOCKOUT } lock_state_t;
typedef enum { LOCK_EV_PIN_OK, LOCK_EV_PIN_BAD, LOCK_EV_LOCK, LOCK_EV_TICK } lock_event_t;
static lock_state_t lock_state = LOCK_LOCKED;
static uint8_t lock_bad;
static uint32_t lock_deadline;

static bool time_reached(uint32_t now, uint32_t deadline)
{
    return (int32_t)(now - deadline) >= 0;
}

static void lock_dispatch(lock_event_t ev, uint32_t now)
{
    switch (lock_state) {
    case LOCK_LOCKED:
        if (ev == LOCK_EV_PIN_OK) {
            lock_bad = 0; lock_deadline = now + LOCK_UNLOCK_MS; lock_state = LOCK_UNLOCKED;
        } else if (ev == LOCK_EV_PIN_BAD) {
            lock_bad++;
            if (lock_bad >= LOCK_MAX_BAD) { lock_deadline = now + LOCK_LOCKOUT_MS; lock_state = LOCK_LOCKOUT; }
        }
        break;
    case LOCK_UNLOCKED:
        if (ev == LOCK_EV_LOCK || (ev == LOCK_EV_TICK && time_reached(now, lock_deadline))) lock_state = LOCK_LOCKED;
        break;
    case LOCK_LOCKOUT:
        if (ev == LOCK_EV_TICK && time_reached(now, lock_deadline)) { lock_bad = 0; lock_state = LOCK_LOCKED; }
        break;
    }
}

/* ---- application ---- */
#define APP_PIN "4921"

static void reply(const char *s)
{
    while (*s != '\0') hal_uart_write((uint8_t)*s++);
    hal_uart_write('\n');
}

static bool pin_matches(const char *candidate)
{
    uint8_t diff = 0;
    uint32_t i;
    if (strlen(candidate) != strlen(APP_PIN)) return false;
    for (i = 0; i < strlen(APP_PIN); i++) diff |= (uint8_t)(candidate[i] ^ APP_PIN[i]);
    return diff == 0;
}

static void handle_line(const char *line, uint32_t now)
{
    if (strncmp(line, "PIN ", 4) == 0) {
        if (lock_state == LOCK_LOCKOUT) { reply("LOCKOUT"); return; }
        if (lock_state == LOCK_UNLOCKED) { reply("OK"); return; }
        if (pin_matches(line + 4)) { lock_dispatch(LOCK_EV_PIN_OK, now); reply("OK"); }
        else {
            lock_dispatch(LOCK_EV_PIN_BAD, now);
            if (lock_state == LOCK_LOCKOUT) reply("LOCKOUT"); else reply("DENIED");
        }
    } else if (strcmp(line, "LOCK") == 0) {
        lock_dispatch(LOCK_EV_LOCK, now);
        reply("OK");
    } else if (strcmp(line, "STATUS") == 0) {
        if (lock_state == LOCK_LOCKED) reply("LOCKED");
        else if (lock_state == LOCK_UNLOCKED) reply("UNLOCKED");
        else reply("LOCKOUT");
    } else if (line[0] != '\0') {
        reply("ERR");
    }
}

static bool app_poll(void)                      /* returns true if it had any input to work on */
{
    uint32_t now = hal_millis();
    bool busy = false;
    uint8_t b;

    while (hal_uart_read(&b)) { rb_put(b); busy = true; }
    while (rb_get(&b)) {
        if (line_feed(b)) handle_line(line_buf, now);
    }
    lock_dispatch(LOCK_EV_TICK, now);
    hal_gpio_write(HAL_PIN_LATCH, lock_state == LOCK_UNLOCKED);
    hal_gpio_write(HAL_PIN_LED, lock_state == LOCK_LOCKOUT);
    return busy;
}

int main(void)
{
    uint32_t idle = 0;
    hal_init();
    /* Real firmware loops for ever. Here the loop ends once the input has dried up
       and the latch has closed again, so the tests can see the relock timeout. */
    while (idle < 400u || lock_state == LOCK_UNLOCKED) {
        if (app_poll()) idle = 0; else idle++;
    }
    return 0;
}
`;
export const clPortBench = {
  title: 'Port the door lock to Bench-MCU',
  prompt: `Everything below the "Portable code" line is the application you tested on the host, pasted into one file because the simulator takes one file. **Do not change it.**

Write the Bench-MCU HAL above it: the five functions declared at the top.

- \`hal_init\`: make the latch and LED pins outputs; set UART \`ENABLE\`; start TIMER0 in auto-reload mode with a period of \`TICKS_PER_MS\`.
- \`hal_uart_read\`: if \`RX_AVAIL\` is set, read \`UART_DATA\` into \`*byte\` and return \`true\`; otherwise return \`false\` at once.
- \`hal_uart_write\`: wait (at most \`TX_WAIT_LIMIT\` polls) for \`TX_READY\`, then write the byte.
- \`hal_millis\`: each time the timer's \`EXPIRED\` flag is found set, clear it and add one to a millisecond counter; return the counter.
- \`hal_gpio_write\`: drive the pin with \`GPIO_SET\` / \`GPIO_CLR\`.

Register names and bit meanings are in the Bench-MCU reference (\`docs/BENCH_MCU.md\`).

The tests check the UART replies, the pin directions, that the latch is **still open** 250 000 simulator ticks after a correct PIN (2500 timer periods: a \`hal_millis\` that counts calls instead of timer expiries has relocked by then) and that it **does close** once 5000 ms have been counted. If the simulator stops with "probably an infinite loop", your \`hal_millis\` is not advancing.`,
  starter: ptHead + C`
/* ======================= Your port: the HAL for Bench-MCU ================================== */
static uint32_t s_ms;

void hal_init(void)
{
    /* TODO */
}

bool hal_uart_read(uint8_t *byte)
{
    /* TODO */
    (void)byte;
    return false;
}

void hal_uart_write(uint8_t byte)
{
    /* TODO */
    (void)byte;
}

uint32_t hal_millis(void)
{
    /* TODO */
    return s_ms;
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    /* TODO */
    (void)pin; (void)level;
}
` + ptApp,
  solution: ptHead + C`
/* ======================= Your port: the HAL for Bench-MCU ================================== */
static uint32_t s_ms;

void hal_init(void)
{
    GPIO_DIR |= PIN_LATCH_BIT | PIN_LED_BIT;
    UART_CTRL = 1u;                              /* ENABLE */
    TIM_LOAD = TICKS_PER_MS;
    TIM_CTRL = (1u << 0) | (1u << 1);            /* ENABLE | AUTO_RELOAD */
}

bool hal_uart_read(uint8_t *byte)
{
    if ((UART_STATUS & UART_RX_AVAIL) == 0u) return false;
    *byte = (uint8_t)UART_DATA;
    return true;
}

void hal_uart_write(uint8_t byte)
{
    uint32_t guard = TX_WAIT_LIMIT;
    while ((UART_STATUS & UART_TX_READY) == 0u) {
        if (guard == 0u) return;                 /* transmitter stuck: drop the byte, do not hang */
        guard--;
    }
    UART_DATA = byte;
}

uint32_t hal_millis(void)
{
    if ((TIM_STATUS & 1u) != 0u) {
        TIM_STATUS = 1u;                         /* write 1 to clear EXPIRED */
        s_ms++;
    }
    return s_ms;
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    uint32_t bit = (pin == HAL_PIN_LATCH) ? PIN_LATCH_BIT : PIN_LED_BIT;
    if (level) GPIO_SET = bit; else GPIO_CLR = bit;
}
` + ptApp,
  tests: [
    { name: 'status, wrong PIN, right PIN: latch high and still high 2500 timer periods later', uartRx: 'STATUS\nPIN 0000\nPIN 4921\nSTATUS\n', ticks: 250000, uartTx: 'LOCKED\nDENIED\nOK\nUNLOCKED\n', regs: { GPIO_OUT: 0x10, GPIO_DIR: { value: 0x30, mask: 0x30 } } },
    { name: 'the latch closes by itself once 5000 ms have been counted', uartRx: 'PIN 4921\n', uartTx: 'OK\n', gpioTrace: { mask: 0x30, values: [0x10, 0x00] }, regs: { GPIO_OUT: 0x00 } },
    { name: 'three wrong PINs: lockout LED on, right PIN refused', uartRx: 'PIN 1\r\nPIN 2\r\nPIN 3\r\nPIN 4921\r\n', uartTx: 'DENIED\nDENIED\nLOCKOUT\nLOCKOUT\n', regs: { GPIO_OUT: 0x20 } },
    { name: 'unlock then explicit lock: both pins low', uartRx: 'PIN 4921\nLOCK\nBOGUS\n', uartTx: 'OK\nOK\nERR\n', regs: { GPIO_OUT: 0x00 } },
  ],
  hints: [
    'Start with `hal_uart_read` and `hal_uart_write`: with those two alone the first test\'s UART output appears.',
    '`hal_uart_write` is the same counted wait for `TX_READY` you wrote in the UART driver exercise.',
    '`hal_gpio_write`: map the pin enum to its bit, then write that bit to `GPIO_SET` or `GPIO_CLR`. Writing to `GPIO_OUT` directly would also work but needs a read-modify-write.',
    'Do not forget `GPIO_DIR` in `hal_init`: a pin that is not an output does not drive, whatever you write to the latch.',
    '`hal_millis`: test bit 0 of `TIM_STATUS`. Only if it is set, write 1 to it (that clears it) and add one to `s_ms`. The timer needs `ENABLE` and `AUTO_RELOAD` in `TIM_CTRL`, or it expires once and never again.',
  ],
  explain: `You wrote about twenty lines of register code and a complete, already-tested application came up on a new target. The portable part was never modified, so the host tests still describe its behaviour.

Two honest limitations of this port. \`hal_millis\` only notices one timer expiry per call, so if the main loop ever took longer than a millisecond between polls, time would run slow; a real port counts milliseconds in the timer interrupt. And reception is polled: at high baud rates a real port puts \`rb_put\` in the UART RX interrupt, which is precisely why the ring buffer has separate producer and consumer indices.`,
};

export const ALL_CLABS = {
  clRingPutGet, clRingOffByOne, clFrameBounds, clStackPaint, clRecursion, clDebounce, clNonBlocking, clLineReceiver,
  clTableFsm, clFakeHal, clTimeout, clUartTx, clI2cSensor, clImageHeader, clSanitizerFix, clParseTests, clPortBench,
};
