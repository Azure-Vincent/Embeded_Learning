// Embedded C: additional graded C exercises on pointers to structs, in-place buffer handling, register fields,
// explicit-endian serialisation, bounded copies and function-pointer tables. Each is placed in a lesson by lessons-*.js.
import { C, clab } from './util.js';

/* ------------------------------------------------------------------ pointer arithmetic: in-place insert */
const insertMain = C`
static void show(const char *label, bool ok, const uint8_t *buf, size_t len)
{
    printf("%s: %d [", label, ok);
    for (size_t i = 0; i < len; i++) {
        printf(i ? " %02X" : "%02X", buf[i]);
    }
    printf("]\n");
}

int main(void)
{
    uint8_t buf[6] = { 0x11, 0x22, 0x33, 0x44, 0xEE, 0xEE };
    size_t len = 4;
    bool ok;

    ok = buf_insert(buf, &len, sizeof(buf), 1, 0xAA);      /* in the middle */
    show("middle", ok, buf, len);
    ok = buf_insert(buf, &len, sizeof(buf), 0, 0xBB);      /* at the very start */
    show("start", ok, buf, len);
    ok = buf_insert(buf, &len, sizeof(buf), 3, 0xCC);      /* buffer is full */
    show("full", ok, buf, len);

    uint8_t two[4] = { 0x01, 0x02, 0xEE, 0xEE };
    len = 2;
    ok = buf_insert(two, &len, sizeof(two), 2, 0x03);      /* at the end: nothing to move */
    show("end", ok, two, len);
    ok = buf_insert(two, &len, sizeof(two), 5, 0x09);      /* position beyond the data */
    show("beyond", ok, two, len);
    return 0;
}
`;
const insertHead = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
`;
export const insertLab = clab({
  title: 'Debug: the insert that smears one byte',
  prompt: `\`buf_insert\` makes room at index \`pos\` by moving the bytes from \`pos\` onwards up by one, then stores the new byte. The bounds checks are correct. The move is not: inserting \`AA\` at index 1 of \`11 22 33 44\` gives \`11 AA 22 22 22\`.

Source and destination of the move **overlap**. Work out in which order the bytes must be copied so that no byte is overwritten before it has been read, and fix the loop. Expected output:

\`middle: 1 [11 AA 22 33 44]\`
\`start: 1 [BB 11 AA 22 33 44]\`
\`full: 0 [BB 11 AA 22 33 44]\`
\`end: 1 [01 02 03]\`
\`beyond: 0 [01 02 03]\``,
  starter: insertHead + C`
static bool buf_insert(uint8_t *buf, size_t *len, size_t cap, size_t pos, uint8_t value)
{
    if (*len >= cap || pos > *len) {
        return false;                       /* no room, or pos is past the data */
    }
    for (size_t i = pos; i < *len; i++) {
        buf[i + 1] = buf[i];                /* make room */
    }
    buf[pos] = value;
    *len += 1;
    return true;
}
` + insertMain,
  solution: insertHead + C`
static bool buf_insert(uint8_t *buf, size_t *len, size_t cap, size_t pos, uint8_t value)
{
    if (*len >= cap || pos > *len) {
        return false;                       /* no room, or pos is past the data */
    }
    for (size_t i = *len; i > pos; i--) {
        buf[i] = buf[i - 1];                /* highest byte first: nothing unread is overwritten */
    }
    buf[pos] = value;
    *len += 1;
    return true;
}
` + insertMain,
  tests: [{ name: 'insert in the middle, at the start, at the end; full and out-of-range refused', stdout: 'middle: 1 [11 AA 22 33 44]\nstart: 1 [BB 11 AA 22 33 44]\nfull: 0 [BB 11 AA 22 33 44]\nend: 1 [01 02 03]\nbeyond: 0 [01 02 03]\n' }],
  hints: [
    'Trace the loop by hand for `pos = 1`, `len = 4`. Which byte does the first iteration destroy, and was it still needed?',
    'Copying upwards, each store lands on the byte the *next* iteration wants to read. Start from the top instead: the last byte moves first, into a slot nobody needs any more.',
    'Count down with an unsigned index the way the first lesson showed: `for (size_t i = *len; i > pos; i--) buf[i] = buf[i - 1];`. A loop written as `i >= pos` never ends when `pos` is 0. `memmove(buf + pos + 1, buf + pos, *len - pos)` does the same job.',
  ],
  explain: `When a block is moved to a **higher** address within the same buffer, copy from the last byte down; when it is moved to a **lower** address (deleting a byte, discarding the front of a receive buffer), copy from the first byte up. The wrong direction reads bytes that the copy itself has already replaced. \`memmove\` chooses the direction for you and is defined for overlapping ranges. \`memcpy\` is **not**: with overlapping arguments its behaviour is undefined, and which bytes survive depends on how the library happens to implement it.`,
});

/* ------------------------------------------------------------------ registers: field helpers with mask macros */
const fieldTop = C`
#include <stdint.h>
#include <stdio.h>

/* One clock-configuration register of an imaginary peripheral, modelled as a variable so you can watch it. */
static volatile uint32_t clk_cfg;

/* A field is described by the position of its lowest bit and its width in bits. */
#define FIELD_MASK(shift, width)  (((1u << (width)) - 1u) << (shift))

#define CFG_EN_SHIFT     0u
#define CFG_EN_WIDTH     1u
#define CFG_SRC_SHIFT    4u      /* clock source, bits 5:4   */
#define CFG_SRC_WIDTH    2u
#define CFG_DIV_SHIFT    8u      /* divider, bits 10:8       */
#define CFG_DIV_WIDTH    3u
#define CFG_GAIN_SHIFT   16u     /* gain, bits 19:16         */
#define CFG_GAIN_WIDTH   4u
`;
const fieldMain = C`
int main(void)
{
    printf("masks %08X %08X %08X\n", FIELD_MASK(CFG_SRC_SHIFT, CFG_SRC_WIDTH),
           FIELD_MASK(CFG_DIV_SHIFT, CFG_DIV_WIDTH), FIELD_MASK(CFG_GAIN_SHIFT, CFG_GAIN_WIDTH));

    /* Pure functions first: easy to test, no hardware involved. */
    printf("%08X\n", field_set(0x00000000u, CFG_DIV_SHIFT, CFG_DIV_WIDTH, 5));
    printf("%08X\n", field_set(0xFFFFFFFFu, CFG_DIV_SHIFT, CFG_DIV_WIDTH, 5));    /* old value 7 must go */
    printf("%08X\n", field_set(0x00000000u, CFG_SRC_SHIFT, CFG_SRC_WIDTH, 6));    /* 6 does not fit in 2 bits */
    printf("%u %u %u\n", field_get(0x000A0713u, CFG_DIV_SHIFT, CFG_DIV_WIDTH),
           field_get(0x000A0713u, CFG_SRC_SHIFT, CFG_SRC_WIDTH),
           field_get(0x000A0713u, CFG_GAIN_SHIFT, CFG_GAIN_WIDTH));

    /* Then the register itself. */
    clk_cfg = 0x00030731u;
    cfg_set_divider(2);
    cfg_set_gain(12);
    printf("cfg=%08X div=%u\n", clk_cfg, cfg_get_divider());
    return 0;
}
`;
export const fieldLab = clab({
  title: 'Write: field helpers built on a mask macro',
  prompt: `Real drivers do not repeat \`& ~(0x7u << 8)\` by hand at every use. They describe each field once (shift and width) and funnel every access through two helpers. Write them.

- \`field_get(reg, shift, width)\` returns the field's value as a small number.
- \`field_set(reg, shift, width, value)\` returns \`reg\` with the field replaced by \`value\`. Every bit outside the field is unchanged, and a \`value\` too large for the field must not spill into its neighbours.
- \`cfg_set_divider(div)\`, \`cfg_set_gain(gain)\` and \`cfg_get_divider()\` apply them to \`clk_cfg\`. Each setter reads the register **once** and writes it **once**.

\`FIELD_MASK(shift, width)\` is given.`,
  starter: fieldTop + C`
static uint32_t field_get(uint32_t reg, uint32_t shift, uint32_t width)
{
    /* TODO */
    return 0;
}

static uint32_t field_set(uint32_t reg, uint32_t shift, uint32_t width, uint32_t value)
{
    /* TODO */
    return reg;
}

static void cfg_set_divider(uint32_t div)
{
    /* TODO: one read of clk_cfg, one write */
}

static void cfg_set_gain(uint32_t gain)
{
    /* TODO */
}

static uint32_t cfg_get_divider(void)
{
    /* TODO */
    return 0;
}
` + fieldMain,
  solution: fieldTop + C`
static uint32_t field_get(uint32_t reg, uint32_t shift, uint32_t width)
{
    return (reg & FIELD_MASK(shift, width)) >> shift;
}

static uint32_t field_set(uint32_t reg, uint32_t shift, uint32_t width, uint32_t value)
{
    uint32_t mask = FIELD_MASK(shift, width);
    return (reg & ~mask) | ((value << shift) & mask);
}

static void cfg_set_divider(uint32_t div)
{
    clk_cfg = field_set(clk_cfg, CFG_DIV_SHIFT, CFG_DIV_WIDTH, div);
}

static void cfg_set_gain(uint32_t gain)
{
    clk_cfg = field_set(clk_cfg, CFG_GAIN_SHIFT, CFG_GAIN_WIDTH, gain);
}

static uint32_t cfg_get_divider(void)
{
    return field_get(clk_cfg, CFG_DIV_SHIFT, CFG_DIV_WIDTH);
}
` + fieldMain,
  tests: [{ name: 'masks, replace in zeros and in ones, oversized value, extraction, register update',
    stdout: 'masks 00000030 00000700 000F0000\n00000500\nFFFFFDFF\n00000020\n7 1 10\ncfg=000C0231 div=2\n',
    mem: [{ sym: 'clk_cfg', size: 4, value: 0x000C0231 }] }],
  hints: [
    'Two questions decide `field_set`: which bits of the old `reg` are allowed to survive, and which bits of `value << shift` are allowed in? Both answers are the same mask, used once inverted and once as it is.',
    '`field_get`: AND with `FIELD_MASK(shift, width)`, then shift right by `shift`. `field_set`: clear with `reg & ~mask`, then OR in `(value << shift) & mask`.',
    'The second test line is the one that catches a missing clear (the old field is 7, the new value 5: the result must be `FFFFFDFF`). The third catches a missing `& mask` on the new value (6 in a 2-bit field must leave only its low two bits, `10`, giving `00000020`). Each register setter is one line: `clk_cfg = field_set(clk_cfg, …);`.',
  ],
  explain: `\`(reg & ~mask) | ((value << shift) & mask)\` is the whole of multi-bit register programming; everything else is naming. Describing a field by shift and width, and deriving the mask from them, removes the commonest slip, a hand-written mask that does not match the shift. Vendor headers do the same thing with \`_Pos\` and \`_Msk\` constants. Two limits of this particular macro are worth knowing: \`FIELD_MASK(0, 32)\` shifts by the full width of the type, which is undefined, so a 32-bit "field" needs a special case; and the setters are read-modify-write sequences, so a register that an interrupt handler also changes needs a critical section around them.`,
});

/* ------------------------------------------------------------------ structs: pointer-to-struct traversal */
const walkTop = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t id;
    bool    enabled;
    int16_t temp_centi;      /* hundredths of a degree; can be negative */
} sensor_t;
`;
const walkMain = C`
static void report(const char *label, const sensor_t *s)
{
    if (s == NULL) {
        printf("%s: none\n", label);
    } else {
        printf("%s: id %d at %d\n", label, s->id, s->temp_centi);
    }
}

int main(void)
{
    sensor_t bank[5] = {
        { 10, true,  2150 },
        { 11, false, 9900 },     /* disabled: its reading must be ignored */
        { 12, true,  2475 },
        { 13, true,  -300 },
        { 14, true,  2475 },     /* ties go to the first one found */
    };
    sensor_t cold[2] = { { 20, true, -1200 }, { 21, true, -450 } };

    report("hottest", hottest(bank, 5));
    report("first three", hottest(bank, 3));
    report("all below zero", hottest(cold, 2));
    report("empty table", hottest(bank, 0));

    printf("disabled %d\n", (int)disable_above(bank, 5, 2400));
    report("hottest now", hottest(bank, 5));
    printf("disabled %d\n", (int)disable_above(bank, 5, 2400));
    printf("enabled flags: %d%d%d%d%d\n", bank[0].enabled, bank[1].enabled, bank[2].enabled,
           bank[3].enabled, bank[4].enabled);
    return 0;
}
`;
export const walkLab = clab({
  title: 'Write: walk a table of records through a pointer',
  prompt: `A driver keeps its sensors in an array of structs and hands other modules a pointer to the first one plus a count. Implement two functions that walk the table with a \`sensor_t *\` and use \`->\` to reach the fields.

- \`hottest(first, count)\` returns a pointer to the **enabled** sensor with the highest \`temp_centi\`, the earliest one if several are equal, or \`NULL\` if no sensor is enabled (or \`count\` is 0). Temperatures can be negative.
- \`disable_above(first, count, limit)\` clears \`enabled\` on every enabled sensor whose reading is above \`limit\` and returns how many it switched off.

Neither function may read or write beyond \`count\` records.`,
  starter: walkTop + C`
static const sensor_t *hottest(const sensor_t *first, size_t count)
{
    /* TODO */
    return NULL;
}

static size_t disable_above(sensor_t *first, size_t count, int16_t limit)
{
    /* TODO */
    return 0;
}
` + walkMain,
  solution: walkTop + C`
static const sensor_t *hottest(const sensor_t *first, size_t count)
{
    const sensor_t *best = NULL;
    const sensor_t *end = first + count;          /* one past the last record */
    for (const sensor_t *s = first; s < end; s++) {
        if (s->enabled && (best == NULL || s->temp_centi > best->temp_centi)) {
            best = s;
        }
    }
    return best;
}

static size_t disable_above(sensor_t *first, size_t count, int16_t limit)
{
    size_t changed = 0;
    for (sensor_t *s = first; s < first + count; s++) {
        if (s->enabled && s->temp_centi > limit) {
            s->enabled = false;
            changed++;
        }
    }
    return changed;
}
` + walkMain,
  tests: [{ name: 'maximum among enabled records, negatives, ties, empty table, in-place update',
    stdout: 'hottest: id 12 at 2475\nfirst three: id 12 at 2475\nall below zero: id 21 at -450\nempty table: none\ndisabled 2\nhottest now: id 10 at 2150\ndisabled 0\nenabled flags: 10010\n' }],
  hints: [
    'What should "the best so far" be before you have looked at any record? A number such as 0 is a trap here: check the test with only negative readings. And how far does `s++` move a `sensor_t *`?',
    'Keep a pointer `best` that starts as `NULL` and loop `for (s = first; s < first + count; s++)`. `s++` advances by one whole record (4 bytes here). Skip a record when `s->enabled` is false.',
    'In `hottest`: `if (s->enabled && (best == NULL || s->temp_centi > best->temp_centi)) best = s;` — strictly greater, so that the first of two equal readings wins. In `disable_above`, count only records that were enabled *and* above the limit, and write `s->enabled = false;` through the pointer.',
  ],
  explain: `\`s++\` on a \`sensor_t *\` adds \`sizeof(sensor_t)\` to the address, and \`s->temp_centi\` adds the field's offset and loads two bytes: the scaling rule from pointer arithmetic and the offset rule from structs working together. Returning a pointer into the caller's table (and \`NULL\` for "no such record") avoids copying a record and lets the caller read whichever fields it wants. Starting from "no best yet" and not from a made-up number is what makes the all-negative table work. The \`const\` in \`hottest\`'s parameter says the function only looks; \`disable_above\` has to drop it because it writes through the pointer.`,
});

/* ------------------------------------------------------------------ structs: function-pointer dispatch table */
const dispTop = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef int (*handler_fn)(int arg);          /* pointer to a function taking int, returning int */

typedef struct {
    char        key;                         /* the command character         */
    const char *name;                        /* for the help listing          */
    handler_fn  run;                         /* what to call; NULL = reserved */
} command_t;

static int led_state;

static int cmd_on(int arg)     { (void)arg; led_state = 1; return led_state; }
static int cmd_off(int arg)    { (void)arg; led_state = 0; return led_state; }
static int cmd_add(int arg)    { return arg + 100; }
`;
const dispMain = C`
static void try_key(char key, int arg)
{
    int result = -1;
    bool ok = dispatch(key, arg, &result);
    printf("%c: ok=%d result=%d led=%d\n", key, ok, result, led_state);
}

int main(void)
{
    try_key('1', 0);
    try_key('t', 0);
    try_key('t', 0);
    try_key('a', 5);
    try_key('r', 0);          /* in the table, but reserved: no handler */
    try_key('z', 0);          /* not in the table at all */
    try_key('0', 0);
    printf("%d commands\n", (int)COMMAND_COUNT);
    return 0;
}
`;
export const dispatchLab = clab({
  title: 'Modify: a command table of function pointers',
  prompt: `Command handlers are collected in a \`const\` table: each entry holds a key, a name and a **pointer to the function** that implements it. \`dispatch\` finds the entry for a key and calls through that pointer, so adding a command means adding a row, not editing a \`switch\`.

1. Write \`cmd_toggle\`: it inverts \`led_state\` and returns the new state. Add it to the table under the key \`'t'\`.
2. Implement \`dispatch(key, arg, result)\`: search the table; if the key is found **and** its handler is not \`NULL\`, call the handler with \`arg\`, store what it returns in \`*result\` and return \`true\`. Otherwise return \`false\` and leave \`*result\` alone.

Use \`COMMAND_COUNT\` for the loop bound.`,
  starter: dispTop + C`
/* TODO: cmd_toggle */

static const command_t commands[] = {
    { '1', "on",       cmd_on  },
    { '0', "off",      cmd_off },
    { 'a', "add 100",  cmd_add },
    { 'r', "reserved", NULL    },
    /* TODO: 't' */
};

#define COMMAND_COUNT (sizeof(commands) / sizeof(commands[0]))

static bool dispatch(char key, int arg, int *result)
{
    /* TODO */
    return false;
}
` + dispMain,
  solution: dispTop + C`
static int cmd_toggle(int arg) { (void)arg; led_state = !led_state; return led_state; }

static const command_t commands[] = {
    { '1', "on",       cmd_on  },
    { '0', "off",      cmd_off },
    { 'a', "add 100",  cmd_add },
    { 'r', "reserved", NULL    },
    { 't', "toggle",   cmd_toggle },
};

#define COMMAND_COUNT (sizeof(commands) / sizeof(commands[0]))

static bool dispatch(char key, int arg, int *result)
{
    for (size_t i = 0; i < COMMAND_COUNT; i++) {
        const command_t *c = &commands[i];
        if (c->key == key) {
            if (c->run == NULL) {
                return false;                /* known key, nothing to call */
            }
            *result = c->run(arg);           /* indirect call through the table */
            return true;
        }
    }
    return false;                            /* unknown key */
}
` + dispMain,
  tests: [{ name: 'calls through the table, new command works, reserved and unknown keys are refused',
    stdout: '1: ok=1 result=1 led=1\nt: ok=1 result=0 led=0\nt: ok=1 result=1 led=1\na: ok=1 result=105 led=1\nr: ok=0 result=-1 led=1\nz: ok=0 result=-1 led=1\n0: ok=1 result=0 led=0\n5 commands\n' }],
  hints: [
    'Two things can go wrong for a key: it is not in the table, or it is there with nothing to call. What happens on a microcontroller if you call through a pointer that holds 0? Decide what `dispatch` returns in each case before writing the loop.',
    'Loop `i` from 0 to `COMMAND_COUNT`, compare `commands[i].key` with `key`. A function pointer is called like a function: `commands[i].run(arg)`.',
    'Inside the match: `if (commands[i].run == NULL) return false;` then `*result = commands[i].run(arg); return true;`. After the loop: `return false;`. The new row is `{ \'t\', "toggle", cmd_toggle },` and `cmd_toggle` must be defined above the table.',
  ],
  explain: `The name of a function, used without parentheses, is its address; the table stores five such addresses in flash, and \`c->run(arg)\` is an indirect call: load the address from the table, branch to it. The \`NULL\` check is not optional. Calling through a null function pointer on a microcontroller jumps to address 0, which on a Cortex-M typically ends in a fault because the word found there is not code. \`COMMAND_COUNT\` is computed from the array, so the loop bound can never disagree with the number of rows. Because the table is \`const\`, an attacker who can write to RAM cannot redirect a command; a table of function pointers in **RAM** is a classic target, which the security section returns to.`,
});

/* ------------------------------------------------------------------ alignment: little-endian frame with a cursor */
const wrTop = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

typedef struct {
    uint8_t *start;      /* first byte of the output buffer          */
    uint8_t *next;       /* where the next byte will be written      */
    uint8_t *end;        /* one past the last byte of the buffer     */
    bool     ok;         /* false once any write did not fit         */
} writer_t;

static void w_init(writer_t *w, uint8_t *buf, size_t cap)
{
    w->start = buf;
    w->next = buf;
    w->end = buf + cap;
    w->ok = true;
}
`;
const wrMain = C`
/* Frame: marker A5 | length u16 LE | sequence u32 LE | value u16 LE */
static size_t build_frame(uint8_t *buf, size_t cap, uint32_t seq, uint16_t value)
{
    writer_t w;
    w_init(&w, buf, cap);
    w_u8(&w, 0xA5);
    w_u16_le(&w, 6);
    w_u32_le(&w, seq);
    w_u16_le(&w, value);
    return w.ok ? (size_t)(w.next - w.start) : 0;
}

static void dump(const char *label, size_t n, const uint8_t *buf, size_t total)
{
    printf("%s: %d |", label, (int)n);
    for (size_t i = 0; i < total; i++) {
        printf(" %02X", buf[i]);
    }
    printf("\n");
}

int main(void)
{
    uint8_t big[10];
    uint8_t small[8];
    for (size_t i = 0; i < sizeof(big); i++) big[i] = 0xEE;
    for (size_t i = 0; i < sizeof(small); i++) small[i] = 0xEE;

    dump("fits", build_frame(big, 9, 0x11223344u, 0xBEEF), big, sizeof(big));

    /* Only 6 bytes of room: the u32 does not fit. Nothing after that point may be written,
       even though the final u16 on its own would. */
    dump("too small", build_frame(small, 6, 0x11223344u, 0xBEEF), small, sizeof(small));
    return 0;
}
`;
export const writerLab = clab({
  title: 'Write: a little-endian frame through a bounds-checked cursor',
  prompt: `Serialising a frame field by field means repeating "is there room? store the bytes, advance". A small **writer** object does the bookkeeping once: it holds a moving pointer, the end of the buffer and a sticky error flag.

Implement the three write functions. This protocol is **little-endian**: least significant byte first.

- Each function first checks that its bytes fit between \`next\` and \`end\`.
- If they fit, store them and advance \`next\`.
- If they do not fit, or \`ok\` is already \`false\`, write nothing, leave \`next\` alone and set \`ok\` to \`false\`.

No pointer casts, no \`memcpy\` of multi-byte values.`,
  starter: wrTop + C`
static void w_u8(writer_t *w, uint8_t v)
{
    /* TODO */
}

static void w_u16_le(writer_t *w, uint16_t v)
{
    /* TODO */
}

static void w_u32_le(writer_t *w, uint32_t v)
{
    /* TODO */
}
` + wrMain,
  solution: wrTop + C`
/* True if n more bytes fit; otherwise latches the error. */
static bool w_room(writer_t *w, size_t n)
{
    if (!w->ok || (size_t)(w->end - w->next) < n) {
        w->ok = false;
        return false;
    }
    return true;
}

static void w_u8(writer_t *w, uint8_t v)
{
    if (!w_room(w, 1)) {
        return;
    }
    *w->next++ = v;
}

static void w_u16_le(writer_t *w, uint16_t v)
{
    if (!w_room(w, 2)) {
        return;
    }
    *w->next++ = (uint8_t)v;                 /* low byte first */
    *w->next++ = (uint8_t)(v >> 8);
}

static void w_u32_le(writer_t *w, uint32_t v)
{
    if (!w_room(w, 4)) {
        return;
    }
    *w->next++ = (uint8_t)v;
    *w->next++ = (uint8_t)(v >> 8);
    *w->next++ = (uint8_t)(v >> 16);
    *w->next++ = (uint8_t)(v >> 24);
}
` + wrMain,
  tests: [{ name: 'nine bytes in little-endian order; a frame that does not fit stops at the first field that fails',
    stdout: 'fits: 9 | A5 06 00 44 33 22 11 EF BE EE\ntoo small: 0 | A5 06 00 EE EE EE EE EE\n' }],
  hints: [
    'How many bytes are left between `next` and `end`, and how do you compute that from two pointers? What must a write do when an *earlier* write has already failed?',
    'The room left is `(size_t)(w->end - w->next)`. Refuse when that is less than the field size or when `w->ok` is already false, and set `w->ok = false`. A shared helper keeps the three functions short.',
    'Little-endian: store `(uint8_t)v` first, then `(uint8_t)(v >> 8)`, and for 32 bits continue with `>> 16` and `>> 24`. `*w->next++ = byte;` stores through the pointer and then advances it.',
  ],
  explain: `The frame bytes are \`A5 | 06 00 | 44 33 22 11 | EF BE\`: each multi-byte field has its low byte first because the code says so, not because Bench-MCU happens to be little-endian. The same source produces the same bytes on a big-endian CPU. The room check subtracts two pointers into the same buffer and compares with the size needed; it never adds a length to a pointer, so it cannot overshoot the end of the buffer. The sticky \`ok\` flag is what makes the second frame safe: without it the 4-byte field is skipped but the final 2-byte field still "fits" and is written, producing a frame that looks complete and is missing its sequence number. Check once at the end, and treat a failed frame as no frame.`,
});

/* ------------------------------------------------------------------ defensive: bounded string copy */
const cpyTop = C`
#include <stddef.h>
#include <stdio.h>
#include <string.h>
`;
const cpyMain = C`
static void show(const char *src, size_t cap)
{
    struct {
        char field[8];
        char guard[4];           /* stands for whatever lies after the field */
    } box;
    memset(box.field, '#', sizeof(box.field));
    memcpy(box.guard, "GRD", 4);

    size_t need = copy_str(box.field, cap, src);

    box.field[sizeof(box.field) - 1] = '\0';                 /* so that printing is safe whatever happened */
    printf("cap %d \"%s\": need %d, field \"%s\"%s%s\n", (int)cap, src, (int)need, box.field,
           need >= cap ? " TRUNCATED" : "", strcmp(box.guard, "GRD") == 0 ? "" : " GUARD OVERWRITTEN");
}

int main(void)
{
    show("LED", 8);
    show("SEVENCH", 8);          /* 7 characters + terminator: fits exactly */
    show("EIGHTCHR", 8);         /* one too many */
    show("a much longer name", 8);
    show("x", 1);                /* room for the terminator only */
    show("x", 0);                /* no room at all: the field must not be touched */
    return 0;
}
`;
export const copyLab = clab({
  title: 'Write: a bounded copy that always terminates and reports truncation',
  prompt: `Write the copy function that \`strncpy\` is so often mistaken for. \`copy_str(dst, cap, src)\`:

- copies at most \`cap − 1\` characters of the string \`src\` into \`dst\` and **always** terminates the result when \`cap\` is at least 1;
- writes nothing at all when \`cap\` is 0;
- never writes more than \`cap\` bytes;
- returns the length of \`src\`, so the caller can detect truncation with \`return value >= cap\`.

This is the contract of BSD \`strlcpy\`. You may use \`strlen\` and \`memcpy\`.`,
  starter: cpyTop + C`
static size_t copy_str(char *dst, size_t cap, const char *src)
{
    /* TODO */
    return 0;
}
` + cpyMain,
  solution: cpyTop + C`
static size_t copy_str(char *dst, size_t cap, const char *src)
{
    size_t need = strlen(src);
    if (cap > 0) {
        size_t n = (need < cap - 1) ? need : cap - 1;     /* cap - 1 is safe: cap is at least 1 here */
        memcpy(dst, src, n);
        dst[n] = '\0';
    }
    return need;
}
` + cpyMain,
  tests: [{ name: 'fits, fits exactly, truncates, terminator-only and zero-size destinations',
    stdout: 'cap 8 "LED": need 3, field "LED"\ncap 8 "SEVENCH": need 7, field "SEVENCH"\ncap 8 "EIGHTCHR": need 8, field "EIGHTCH" TRUNCATED\ncap 8 "a much longer name": need 18, field "a much " TRUNCATED\ncap 1 "x": need 1, field "" TRUNCATED\ncap 0 "x": need 1, field "#######" TRUNCATED\n' }],
  hints: [
    'Work out three numbers for a destination of `cap` bytes: the most characters you may copy, the index where the terminator goes, and what `cap - 1` evaluates to when `cap` is 0 and the type is `size_t`.',
    'The number of characters to copy is the smaller of `strlen(src)` and `cap - 1`, and the terminator goes at that index. Compute `cap - 1` only inside `if (cap > 0)`.',
    '`size_t need = strlen(src); if (cap > 0) { size_t n = need < cap - 1 ? need : cap - 1; memcpy(dst, src, n); dst[n] = \'\\0\'; } return need;`',
  ],
  explain: `The bound comes from the destination (\`cap\`), the terminator is written on every path that writes anything, and the return value tells the caller what was lost. The two edge cases are where hand-written copies fail: with \`cap\` 0 the expression \`cap - 1\` wraps to 4 294 967 295 and an unguarded copy runs through memory, and with \`cap\` 1 there is room for the terminator only. Returning the *needed* length and not the copied length is what lets one comparison detect truncation; what to do then (reject the input, or accept a shortened name) is a decision for the caller, and for anything security-relevant the answer is to reject.`,
});
