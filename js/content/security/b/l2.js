import { C, code, widget, SCOPE } from './util.js';

const RANGE_OK = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* True if [offset, offset + len) lies inside a buffer of buf_size bytes.
 * Written so that no intermediate result can wrap. */
bool range_ok(size_t offset, size_t len, size_t buf_size)
{
    if (offset > buf_size) {
        return false;
    }
    return len <= buf_size - offset;    /* offset <= buf_size, so this cannot wrap */
}

/* count * size with overflow detection. On success stores the product. */
bool mul_size(size_t count, size_t size, size_t *out)
{
    if (size != 0u && count > SIZE_MAX / size) {
        return false;                   /* the true product does not fit in size_t */
    }
    *out = count * size;
    return true;
}
`;

const BUILTINS = C`
#include <stdbool.h>
#include <stdint.h>

/* GCC and Clang: the builtin computes the mathematically exact result and
 * returns true if it does not fit in the type of *out. */
bool total_len(uint16_t header, uint16_t payload, uint16_t *out)
{
    return !__builtin_add_overflow(header, payload, out);
}

bool record_bytes(uint32_t count, uint32_t record_size, uint32_t *out)
{
    return !__builtin_mul_overflow(count, record_size, out);
}
`;

const PARSE_FIXED = C`
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define STORE_SIZE 256u
static uint8_t store[STORE_SIZE];

/* msg: [0..1] offset (LE), [2..3] count (LE), [4..] data. Returns 0 on success. */
int store_write(const uint8_t *msg, size_t msg_len)
{
    size_t offset, count;

    if (msg_len < 4u) {
        return -1;                              /* header incomplete */
    }
    offset = (size_t)msg[0] | ((size_t)msg[1] << 8);
    count  = (size_t)msg[2] | ((size_t)msg[3] << 8);

    if (count > msg_len - 4u) {
        return -1;                              /* claims more data than was received */
    }
    if (offset > STORE_SIZE || count > STORE_SIZE - offset) {
        return -1;                              /* would leave the store */
    }
    memcpy(&store[offset], &msg[4], count);
    return 0;
}
`;

export default {
  id: 'sec-b-integer-overflow',
  title: 'Integer overflows and length handling',
  minutes: 45,
  summary: 'Fixed-width arithmetic wraps. When the wrapped value feeds a bounds check or an allocation, the check passes and the copy does not fit.',
  skills: ['sec-b-safe-length', 'sec-b-sanitizer-tests'],
  blocks: [
    `## The problem

A firmware update handler receives \`offset\` and \`len\` in each packet and writes \`len\` bytes at \`offset\` into a 256-byte staging buffer. The author did write a bounds check:

\`\`\`c
uint16_t end = offset + len;
if (end > 256) return ERR_RANGE;
memcpy(&staging[offset], data, len);
\`\`\`

A reviewer sends \`offset = 65530\` and \`len = 10\`. The check passes. The copy starts 65 kilobytes past the buffer.

## What the weakness is

Every C integer type has a fixed number of bits. When a result does not fit, something other than the mathematical answer is stored:

- **Unsigned** arithmetic is defined to wrap modulo 2ⁿ. \`65530 + 10\` in 16 bits is \`4\`.
- **Signed** overflow is [[Undefined behaviour]]. The hardware usually wraps in two's complement, but the compiler is entitled to assume it never happens and may delete checks that could only be true after an overflow.
- **Conversions** to a narrower type discard high bits; conversions between signed and unsigned keep the bit pattern and change the meaning, so \`-1\` becomes the largest unsigned value.

The weakness (CWE-190, integer overflow or wraparound; CWE-191 for underflow) is not the wrap itself. It is that the wrapped value is then *trusted* as a length, an index or a size. The usual end result is the buffer overflow of the previous lesson, reached through a check that looks correct.

## How it arises

The processor's adder is 32 bits wide on a Cortex-M or RV32 core. It sets a carry flag when an unsigned result does not fit and an overflow flag for signed results, but compiled C code does not look at those flags after ordinary arithmetic. The rules that decide what your expression computes are in the language:

1. **Integer promotion.** Operands narrower than \`int\` (\`uint8_t\`, \`uint16_t\`, \`char\`, \`short\`) are converted to \`int\` before arithmetic. On a 32-bit MCU, \`uint16_t a = 65530, b = 10; a + b\` is the \`int\` 65540. No wrap yet.
2. **The wrap happens on the conversion back.** Assigning 65540 to a \`uint16_t\`, or casting it, keeps the low 16 bits: 4.
3. **Usual arithmetic conversions.** If one operand is unsigned and at least as wide as \`int\`, a signed operand is converted to unsigned. \`if (len < sizeof buf)\` with \`int len = -1\` compares 4294967295 with the size.
4. **Promotion can create signed overflow.** \`uint16_t x = 65535; x * x\` multiplies two \`int\`s; 4294836225 does not fit in a 32-bit \`int\`, so this unsigned-looking expression is undefined behaviour.

Four patterns produce most real defects:

| Pattern | Example | What goes wrong |
|---|---|---|
| Sum in a bounds check | \`if (off + len > size)\` | the sum wraps to a small number and passes |
| Product for a size | \`malloc(count * size)\` | the product wraps; the buffer is smaller than the loop that fills it expects |
| Subtraction of a header | \`n = len - HDR\` with \`len < HDR\` | unsigned underflow gives a huge length |
| Signed length | \`if (len > MAX) reject;\` with negative \`len\` | negative passes the test, then converts to a huge \`size_t\` in \`memcpy\` |

## What an adversary gains

The same three levels as a buffer overflow — reset, changed data, changed control flow — because that is where the wrapped length ends up. The condition is that the adversary controls a number that takes part in size arithmetic: a length field, a count, an offset. Protocol headers consist largely of such numbers, which is why parsers are the first place to look.`,
    { t: 'predict', q: 'On a 32-bit MCU, `offset` and `len` are `uint16_t`, and the buffer holds 256 bytes. The check is `uint16_t end = offset + len; if (end > 256) reject;`. Which input is accepted although it does not fit?', choices: [
      { t: 'offset = 65530, len = 10', ok: true, why: 'The sum 65540 is computed as an int, then truncated to 16 bits on assignment: 65540 − 65536 = 4, which is not greater than 256.' },
      { t: 'offset = 250, len = 10', why: 'The sum is 260, which fits easily in 16 bits and is correctly rejected. A wrap needs the true sum to exceed the type, not just the buffer.' },
      { t: 'offset = 0, len = 256', why: 'This one fits exactly: bytes 0 to 255. It is accepted, and correctly so.' },
      { t: 'None: the sum is computed in 32 bits because of integer promotion, so it cannot wrap', why: 'Promotion does make the addition 32 bits wide, but the result is then stored in a 16-bit variable, which keeps only the low 16 bits.' },
    ], reveal: 'Promotion delays the wrap until the assignment to `end`. Had the code compared `offset + len > 256` directly, without the 16-bit temporary, this particular case would have been caught on a 32-bit target and missed again on a 16-bit one. Correctness that depends on the width of `int` is not correctness.' },
    { t: 'callout', kind: 'sim', md: SCOPE },
    widget('integer-overflow', { challenge: 'length-check' }, 'Find an offset and length that the device accepts although the write does not fit. Then change the type the check is computed in and see whether your values still pass.'),
    widget('integer-overflow', { challenge: 'alloc-size' }, 'Now a multiplication: choose a record count and size whose true product is large but whose stored product is small.'),
    `### Debrief

In the first task the device compared the *wrapped* sum with the buffer size and then copied the *true* length. In the second, the allocation used the wrapped product while the loop that fills the records used the original count. In both cases two parts of the program disagreed about a size, and the smaller figure was the one that was checked.

Widening the type moves the problem; it does not remove it. A check done in 32 bits still wraps for 32-bit inputs. The reliable fix is to order the check so that no intermediate value can exceed the type.

## How a team detects it

**Review questions:**

- For every \`+\`, \`*\`, \`-\` and \`<<\` on a value derived from input: what are the largest and smallest operands, and does the result fit in the type of the expression *and* in the variable it is stored in?
- Is any length or index held in a signed type? Is any size held in something narrower than \`size_t\`?
- When a header length is subtracted, where is it proven that the total is at least the header length?
- Do the check and the use operate on the same value in the same type?

**Tools:**

- \`-Wconversion\` and \`-Wsign-conversion\` report every implicit narrowing and sign change; \`-Wsign-compare\` (in \`-Wextra\`) reports mixed comparisons. They are noisy on old code. On a parser, that noise is the review list.
- [[UndefinedBehaviorSanitizer]] in host builds: \`-fsanitize=undefined\` catches signed overflow, bad shifts and out-of-range array indices at run time. Unsigned wraparound is defined behaviour and is *not* reported by default; Clang offers \`-fsanitize=unsigned-integer-overflow\` as an extra, and GCC does not.
- Static analysers and CERT C checkers flag INT30-C (unsigned wrap), INT31-C (lossy conversion) and INT32-C (signed overflow).
- Fuzzing with length fields set to 0, 1, the maximum, and the maximum minus small numbers.

## The defence

**Rule 1: do size arithmetic in \`size_t\`, and convert input fields to it once, at the edge.**

**Rule 2: rearrange the check so it subtracts from the known-good limit instead of adding to the unknown input.** \`len <= size - offset\` cannot wrap once you know \`offset <= size\`.

**Rule 3: check multiplication by dividing the limit**, or use the compiler's checked-arithmetic builtins.`,
    code(RANGE_OK, 'host-tested', { caption: 'Overflow-safe range and size checks. Tested with offsets and lengths at 0, the boundary, and SIZE_MAX.', explain: [
      { lines: '9-11', md: 'First establish that `offset` itself is inside (or exactly at the end of) the buffer. Without this the subtraction on the next line could wrap.' },
      { lines: '12', md: 'The subtraction is done on trusted values and yields the space remaining. The untrusted `len` is only compared, never added.' },
      { lines: '18-20', md: 'If `count` exceeds the largest value whose product with `size` still fits, the multiplication would wrap. The division uses only the constant limit and one operand, so it cannot overflow.' },
    ] }),
    code(BUILTINS, 'host-tested', { caption: 'The same intent with GCC/Clang checked-arithmetic builtins. C23 standardises equivalents in <stdckdint.h> (ckd_add, ckd_mul); check that your toolchain provides the header before relying on it.', explain: [
      { lines: '8', md: 'The addition is performed as if with unlimited precision, the low 16 bits are stored in `*out`, and the return value says whether information was lost. On Arm this compiles to an add followed by a test of the carry, with no branches in your source.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'Checking for overflow after it happened, in signed arithmetic', md: `\`if (a + b < a)\` is a valid wrap test for **unsigned** operands. For signed operands the overflow in \`a + b\` is undefined behaviour, the compiler may assume it cannot happen, and at \`-O2\` it can remove the test entirely. Test before the operation (\`if (b > INT_MAX - a)\`), or use \`__builtin_add_overflow\`, which is defined for signed types.` },
    { t: 'callout', kind: 'decision', title: 'Reject or clamp?', md: `When a length is out of range you can refuse the message or clamp the length to what fits. Clamp only where a shorter result is still *correct*, such as filling a display line. For commands, firmware blocks, keys and anything covered by a MAC or CRC, clamping changes the meaning of the data and hides the fact that the peer is misbehaving. Reject, count the rejection, and make the counter visible in diagnostics.` },
    `## Verifying the defence

- **Boundary tests at the type limits as well as the buffer limits.** For a 16-bit field: 0, 1, size−1, size, size+1, 0x7FFF, 0x8000, 0xFFFF, and pairs whose sum is exactly 2¹⁶ and 2¹⁶+1.
- Run them in a host build with \`-fsanitize=address,undefined\`; ASan catches the copy that the wrapped check let through.
- Compile the parser with \`-Wconversion -Wsign-conversion -Werror\` so that a later edit which reintroduces a narrow temporary fails the build.
- If the code must also run on a 16-bit target, run the tests there or under an emulator: promotion results differ when \`int\` is 16 bits.`,
    { t: 'exercise', prompt: `Review this function from a configuration store. \`msg\` points to \`msg_len\` received bytes. There are three distinct length defects. Name each, give an input that triggers it, and write a corrected version.`, code: C`
#define STORE_SIZE 256u
static uint8_t store[STORE_SIZE];

/* msg: [0..1] offset (LE), [2..3] count (LE), [4..] data */
int store_write(const uint8_t *msg, uint8_t msg_len)
{
    uint16_t offset = msg[0] | (msg[1] << 8);
    uint16_t count  = msg[2] | (msg[3] << 8);
    uint16_t end    = offset + count;

    if (end > STORE_SIZE) {
        return -1;
    }
    memcpy(&store[offset], &msg[4], count);
    return 0;
}`, hints: [
      'Start before the arithmetic: what does the function read from `msg` if `msg_len` is 2?',
      '`count` says how many data bytes follow the header. Is it ever compared with how many bytes were actually received?',
      'Then the sum: find an `offset` and `count` whose 16-bit sum is small.',
    ], solution: `**Defects**

1. **Header read without a length check** (CWE-125). With \`msg_len < 4\` the function reads bytes that were never received.
2. **\`count\` is never compared with the received length.** A 6-byte message claiming \`count = 200\` makes \`memcpy\` read 198 bytes past the message: stale buffer contents, possibly secrets, are copied into the store where a later read command can return them.
3. **16-bit wraparound in \`offset + count\`** (CWE-190). \`offset = 0xFFF0, count = 0x0020\` gives \`end = 0x0010\`, the check passes, and the write starts 65,520 bytes past the store.

(\`msg_len\` being a \`uint8_t\` is a fourth smell: a caller with a longer buffer silently truncates the length.)

**Corrected version** (compiled with \`-Wall -Wextra -Wconversion\` and tested under ASan/UBSan):

\`\`\`c
${PARSE_FIXED}\`\`\`

**Tests:** \`msg_len\` 0, 3, 4; count one more than the data received; offset 256 with count 0 (accepted, writes nothing) and count 1 (rejected); offset 0xFFF0 with count 0x20; a full 256-byte write at offset 0.` },
    widget('c-lab', {
      title: 'Fix the wrapping bounds check',
      prompt: `\`write_block\` guards a 16-byte buffer, but the check is computed in 8 bits. The tests call it with ordinary values and with values chosen so that the sum wraps. Rewrite the check so that no input can make it pass when the block does not fit. Keep the function signature.`,
      starter: C`
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#define BUF_SIZE 16u

struct dev {
    uint8_t buf[BUF_SIZE];
    uint8_t armed;              /* must never change */
};

static struct dev d;

int write_block(uint8_t offset, uint8_t len, uint8_t fill)
{
    uint8_t end = (uint8_t)(offset + len);   /* defect: wraps at 256 */
    if (end > BUF_SIZE) {
        return -1;
    }
    for (uint32_t i = 0; i < len; i++) {
        d.buf[offset + i] = fill;
    }
    return 0;
}

int main(void)
{
    d.armed = 0;
    printf("%d\n", write_block(0, 16, 1));     /* fits exactly */
    printf("%d\n", write_block(8, 9, 2));      /* one too many */
    printf("%d\n", write_block(16, 0, 3));     /* empty write at the end */
    printf("%d\n", write_block(16, 240, 4));   /* 16 + 240 = 256 */
    printf("%d\n", write_block(255, 2, 5));    /* 255 + 2 = 257 */
    printf("armed=%d\n", d.armed);
    return 0;
}
`,
      solution: C`
#include <stdio.h>
#include <stdint.h>
#include <string.h>

#define BUF_SIZE 16u

struct dev {
    uint8_t buf[BUF_SIZE];
    uint8_t armed;              /* must never change */
};

static struct dev d;

int write_block(uint8_t offset, uint8_t len, uint8_t fill)
{
    if (offset > BUF_SIZE || len > BUF_SIZE - offset) {
        return -1;
    }
    for (uint32_t i = 0; i < len; i++) {
        d.buf[offset + i] = fill;
    }
    return 0;
}

int main(void)
{
    d.armed = 0;
    printf("%d\n", write_block(0, 16, 1));     /* fits exactly */
    printf("%d\n", write_block(8, 9, 2));      /* one too many */
    printf("%d\n", write_block(16, 0, 3));     /* empty write at the end */
    printf("%d\n", write_block(16, 240, 4));   /* 16 + 240 = 256 */
    printf("%d\n", write_block(255, 2, 5));    /* 255 + 2 = 257 */
    printf("armed=%d\n", d.armed);
    return 0;
}
`,
      tests: [{ name: 'boundary and wraparound cases', stdout: '0\n-1\n0\n-1\n-1\narmed=0' }],
      hints: [
        'Work out `(uint8_t)(16 + 240)` by hand. Is it greater than 16?',
        'Avoid adding the two untrusted numbers. What is the space remaining after `offset`, and can that subtraction wrap if you check `offset` first?',
        '`if (offset > BUF_SIZE || len > BUF_SIZE - offset) return -1;`',
      ],
      explain: 'The starter accepted the fourth call because 256 truncates to 0, and wrote 240 bytes starting at the end of the buffer, through `armed` and beyond. The corrected check compares the untrusted length with the space that remains and performs no arithmetic on untrusted values that could wrap.',
    }),
    `## Harder application

A bootloader receives an image header with a 32-bit \`image_size\` and a 32-bit \`load_offset\` within a 0x38000-byte application slot. It erases \`(image_size + PAGE_SIZE - 1) / PAGE_SIZE\` pages and then writes the image. Identify every place a wrap could occur — including the rounding expression — and write the two-line check that makes all later arithmetic safe. Then decide which tests you would add to the bootloader's host test suite, and why \`image_size = 0xFFFFFFFF\` must be one of them.`,
    { t: 'refs', items: [
      { title: 'CWE-190: Integer Overflow or Wraparound', url: 'https://cwe.mitre.org/data/definitions/190.html' },
      { title: 'CWE-191: Integer Underflow (Wrap or Wraparound)', url: 'https://cwe.mitre.org/data/definitions/191.html' },
      { title: 'SEI CERT C Coding Standard', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard', note: 'Rules INT30-C, INT31-C, INT32-C' },
      { title: 'GCC manual: Built-in Functions to Perform Arithmetic with Overflow Checking', url: 'https://gcc.gnu.org/onlinedocs/gcc/Integer-Overflow-Builtins.html' },
    ] },
  ],
  quiz: [
    { q: 'On a 32-bit MCU, what does this print?', code: C`
uint8_t a = 200, b = 100;
uint8_t c = a + b;
printf("%d %d\n", a + b, c);`, kind: 'code', choices: [
      { t: '`300 44`', ok: true, why: 'Both operands are promoted to int, so the expression is 300. Storing it in a uint8_t keeps the low 8 bits: 300 − 256 = 44.' },
      { t: '`44 44`', why: 'That would require the addition itself to be done in 8 bits, but operands narrower than int are promoted before arithmetic.' },
      { t: '`300 300`', why: 'An 8-bit variable cannot hold 300; the assignment discards the bits that do not fit.' },
      { t: '`300 255`', why: 'C integer conversions truncate rather than saturate. Saturation exists only where you write it.' },
    ] },
    { q: 'A handler is declared `void rx(const uint8_t *p, int len)` and begins `if (len > 64) return; memcpy(buf, p, len);` with `uint8_t buf[64]`. Which input class defeats the check?', kind: 'security', choices: [
      { t: 'A negative `len`: it is not greater than 64, and converts to a huge `size_t` in the call to `memcpy`', ok: true, why: 'The comparison is signed; the copy length is unsigned. The same bits mean two different numbers.' },
      { t: '`len` equal to 64', why: 'Sixty-four bytes fit exactly in a 64-byte array, and no terminator is involved in a raw byte copy.' },
      { t: '`len` equal to 0', why: 'A zero-length copy writes nothing. It may be a protocol error, but it is not a memory-safety defect.' },
      { t: 'No input: the check is complete', why: 'The check has an upper bound but no lower bound, and the type allows values below zero.' },
    ] },
    { q: 'Which rewrite of `if (offset + len > size) reject;` is safe for all `size_t` inputs?', kind: 'code', choices: [
      { t: '`if (offset > size || len > size - offset) reject;`', ok: true, why: 'After the first test the subtraction cannot wrap, and the untrusted length is only compared.' },
      { t: '`if ((uint64_t)offset + len > size) reject;` on every platform', why: 'This happens to work where size_t is 32 bits, but the idea fails as soon as the operands are already as wide as the widest type; it is a habit that does not scale.' },
      { t: '`if (len > size || offset + len > size) reject;`', why: 'Bounding one operand does not stop the sum wrapping when the other operand is near the type maximum.' },
      { t: '`if (offset + len > size || offset + len < 0) reject;`', why: 'An unsigned value is never less than zero, so the added test is always false and the compiler removes it.' },
    ] },
    { q: 'Your host tests run with `-fsanitize=undefined` under GCC and pass. A colleague says this proves the 16-bit length arithmetic never wraps. Is that right?', kind: 'concept', choices: [
      { t: 'No. Unsigned wraparound is defined behaviour, so UBSan does not report it; only its consequence, such as an out-of-bounds copy, may be caught by ASan', ok: true, why: 'UBSan reports undefined behaviour. Modulo arithmetic on unsigned types is fully defined by the standard.' },
      { t: 'Yes. UBSan instruments every arithmetic operation', why: 'It instruments the operations whose overflow is undefined, which for integers means the signed ones.' },
      { t: 'No, because sanitizers only work on 64-bit integers', why: 'Sanitizers instrument arithmetic at every width; the gap is about which overflows count as errors.' },
      { t: 'Yes, provided the tests reach 100% line coverage', why: 'Coverage shows which lines ran, not which values flowed through them. A wrap needs particular operand values.' },
    ] },
    { q: 'A parser computes `payload_len = total_len - HEADER_LEN` where both are `size_t` and `HEADER_LEN` is 8. What is the required check, and where?', kind: 'security', choices: [
      { t: '`total_len >= HEADER_LEN`, before the subtraction', ok: true, why: 'With a shorter message the unsigned subtraction wraps to a number near SIZE_MAX, which then passes for a length.' },
      { t: '`payload_len >= 0`, after the subtraction', why: 'An unsigned result is always at least zero, so this test cannot fail and protects nothing.' },
      { t: '`payload_len < total_len`, after the subtraction', why: 'A test placed after the subtraction relies on the reader recognising a wrap idiom, and by then the wrapped value exists and may already have been used. State the precondition instead.' },
      { t: 'No check is needed because the protocol specification says messages are at least 8 bytes', why: 'The specification binds honest senders. The parser receives bytes from whoever is connected.' },
    ] },
    { q: 'Why can `uint16_t w, h; uint32_t area = w * h;` misbehave on a 32-bit target for `w = h = 65535`?', kind: 'arch', choices: [
      { t: 'Both operands are promoted to signed `int`; the product exceeds INT_MAX, which is undefined behaviour, before it is ever converted to `uint32_t`', ok: true, why: 'The type of the destination does not influence the type the multiplication is done in. Cast one operand to uint32_t first.' },
      { t: 'The product is computed in 16 bits and truncated', why: 'Operands narrower than int are widened to int before the multiplication, so the operation is 32 bits wide.' },
      { t: 'It cannot misbehave: the result is assigned to a 32-bit unsigned variable, which is wide enough', why: 'The mathematical result does fit in 32 unsigned bits, but the expression is evaluated in a signed type whose maximum is half that.' },
      { t: 'The hardware multiplier of a Cortex-M cannot multiply 16-bit numbers', why: 'The multiplier handles 32-bit operands; the issue is in the language rules, not the instruction set.' },
    ] },
  ],
};
export const TESTED = { RANGE_OK, BUILTINS, PARSE_FIXED };
