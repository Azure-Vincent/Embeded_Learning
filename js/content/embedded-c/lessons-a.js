// Embedded C, part A: the language model, pointers, pointer arithmetic, bitwise operators.
import { C, clab, code } from './util.js';
import { insertLab } from './labs-extra.js';

/* ------------------------------------------------------------------ lesson 1 */
const cModel = {
  id: 'ec-c-model',
  title: 'C for people who already program',
  minutes: 60,
  summary: 'What the compiler does with your source, how wide each type really is, and the conversion rules that silently change your numbers.',
  skills: ['ec-fixed-width', 'ec-predict-conversions', 'ec-split-header-source'],
  blocks: [
    `## The problem: a loop that never ends

You know Python, JavaScript or Java. You write a first loop for a microcontroller that sends 300 calibration pulses:`,
    code(C`
#include <stdint.h>

void send_pulses(void)
{
    for (uint8_t i = 0; i < 300; i++) {
        pulse();
    }
}
`, 'pseudo', { caption: 'It compiles. It never returns.' }),
    `Nothing in a high-level language prepares you for this. In Python an integer grows as needed. In C a \`uint8_t\` is
exactly eight bits of storage. It can hold 0 to 255, so \`i < 300\` is true for every value \`i\` can ever have. After 255
the increment wraps to 0 and the loop carries on. GCC will warn about it (\`comparison is always true due to limited
range of data type\`) but only if warnings are switched on and somebody reads them.

C is a thin layer over the machine. A variable is a fixed number of bytes at a fixed place, an operator is a handful of
instructions, and the rules for mixing types were designed around what a CPU register can do. This lesson covers the parts
of that model that surprise people arriving from managed languages.

## From source text to bytes in flash

A C program is not run by an interpreter and has no runtime that loads modules. It is **translated ahead of time** in
separate steps, and each step has its own kind of error message:

| Step | Input → output | What it does | Typical error |
|---|---|---|---|
| Preprocess | \`.c\` + \`.h\` → one translation unit | Pastes in every \`#include\`, expands every \`#define\`, removes \`#if\` branches. Pure text substitution. | \`No such file or directory\` |
| Compile | translation unit → \`.o\` object file | Checks types, generates machine code for *this file only*. A call to a function in another file is left as a named hole. | \`implicit declaration of function\` |
| Link | all \`.o\` files → \`.elf\` | Fills the holes with addresses and places code and data at the addresses the linker script names. | \`undefined reference to\` |
| Convert, flash | \`.elf\` → \`.bin\`/\`.hex\` → chip | Copies the bytes into flash. | — |

The consequence that matters most: **the compiler sees one \`.c\` file at a time**. It does not look into other source
files to find out what \`uart_putc\` is. It only knows what has been *declared* earlier in the same translation unit.
That is the whole reason header files exist.

### Declaration and definition

- A **declaration** tells the compiler a name and its type: \`void uart_putc(char c);\`. It reserves nothing.
- A **definition** creates the thing: the function body, or the storage for a variable.

A header (\`uart.h\`) carries declarations so that any file can \`#include\` it and call the functions. Exactly one source
file (\`uart.c\`) carries the definitions. Break the rule in either direction and the linker tells you: no definition gives
\`undefined reference\`, two definitions give \`multiple definition\`.`,
    { t: 'ascii', caption: 'A two-file module. main.c never sees uart.c; it sees only the declarations in uart.h.', text:
`uart.h   (declarations: the interface)        uart.c   (definitions: the implementation)
---------------------------------------       ----------------------------------------
#ifndef UART_H                                #include "uart.h"
#define UART_H
#include <stdint.h>                           static uint32_t tx_count;   /* private   */

void uart_init(uint32_t baud);                void uart_init(uint32_t baud) { ... }
void uart_putc(char c);                       void uart_putc(char c)        { ... }

#endif

main.c:   #include "uart.h"   ...   uart_putc('A');
          compile main.c -> main.o  (hole: uart_putc)
          compile uart.c -> uart.o  (provides: uart_init, uart_putc)
          link main.o + uart.o -> firmware.elf` },
    `The \`#ifndef UART_H\` / \`#define\` / \`#endif\` wrapper is an **include guard**. Because \`#include\` is text pasting,
a header included twice (directly and through another header) would otherwise declare its types twice.

\`static\` on \`tx_count\` makes the name private to \`uart.c\`. The lesson on allocation returns to it.

## Types are sizes

In C the type of a variable decides how many bytes it occupies and how its bits are interpreted. The language standard
fixes only *minimum* ranges for the classic names:

| Type | Standard guarantees | 8-bit AVR | Cortex-M / RISC-V32 / ESP32 | 64-bit Linux PC |
|---|---|---|---|---|
| \`char\` | at least 8 bits | 1 byte | 1 byte | 1 byte |
| \`short\` | at least 16 bits | 2 | 2 | 2 |
| \`int\` | at least 16 bits | **2** | 4 | 4 |
| \`long\` | at least 32 bits | 4 | **4** | **8** |
| \`long long\` | at least 64 bits | 8 | 8 | 8 |
| pointer | — | 2 | 4 | 8 |

So \`int\` is not "a 32-bit integer". On a 16-bit \`int\` target, \`1000 * 60\` overflows. And \`long\` differs between your
test PC and the board. Even plain \`char\` is ambiguous: whether it is signed or unsigned is the compiler's choice (it is
unsigned by default on Arm, signed on x86).

Embedded code talks to hardware whose registers and protocol fields have exact widths. So it uses the **fixed-width
types** from \`<stdint.h>\`:

| Type | Width | Range |
|---|---|---|
| \`uint8_t\` / \`int8_t\` | 8 bits | 0…255 / −128…127 |
| \`uint16_t\` / \`int16_t\` | 16 bits | 0…65 535 / −32 768…32 767 |
| \`uint32_t\` / \`int32_t\` | 32 bits | 0…4 294 967 295 / about ±2.1 × 10⁹ |
| \`uint64_t\` / \`int64_t\` | 64 bits | — |
| \`size_t\` (from \`<stddef.h>\`) | pointer-sized, unsigned | the type of \`sizeof\` and of object sizes |`,
    { t: 'callout', kind: 'decision', title: 'Which integer type?', md:
`- A value with a width fixed by hardware or a protocol (a register, a packet field, a sample): **\`uintN_t\`** of exactly that width.
- A size or an array index: **\`size_t\`**.
- A small loop counter or general arithmetic: plain \`int\` or \`uint32_t\` is fine and usually fastest on a 32-bit core. A \`uint8_t\` counter saves nothing in a register and adds wrap-around risk.
- Bit patterns: always **unsigned**. Shifts and masks on signed values have corner cases covered in the bitwise lesson.` },
    `## The rules that change your numbers

### Integer promotion

Before any arithmetic, C converts every operand whose type is narrower than \`int\` (\`char\`, \`short\`, \`uint8_t\`,
\`uint16_t\`, \`bool\`) to \`int\`. This is called **integer promotion**. The exact rule: the operand becomes \`int\` if
\`int\` can represent every value of its type, otherwise \`unsigned int\`. On a 32-bit MCU that means \`uint8_t\` and
\`uint16_t\` both turn into **signed** \`int\`; on a 16-bit-\`int\` MCU a \`uint16_t\` turns into \`unsigned int\`.
\`uint8_t + uint8_t\` is therefore computed as \`int + int\`. The addition itself cannot overflow at 8 bits. The truncation
happens later, when you *store* the result back into a narrow variable.

### Usual arithmetic conversions

When the two operands still differ after promotion, both are brought to one common type. If one type is wider and can
represent every value of the other, the narrower operand is converted to it (\`int\` with \`long long\` gives
\`long long\`; \`unsigned int\` with a 64-bit \`long long\` also gives \`long long\`). When they have the
same width but differ in signedness, **the signed one is converted to unsigned**. That is how \`-1 < 1u\` becomes false:
\`-1\` converted to \`unsigned int\` is 4 294 967 295.

### What happens on overflow

- **Unsigned** arithmetic wraps modulo 2ⁿ. This is defined behaviour and code may rely on it.
- **Signed** overflow is **undefined behaviour**. The compiler is allowed to assume it never happens and to optimise on that assumption: GCC at \`-O2\` turns \`if (x + 1 < x)\` on an \`int\` into "never true" and deletes the branch. Because of promotion this reaches unsigned-looking code too: with a 32-bit \`int\`, \`uint16_t a = 65535; a * a\` is a signed multiplication that overflows.
- Converting an out-of-range value *to a signed type* (for example \`(int8_t)0xF0\`) is **implementation-defined**: each compiler documents what it does. GCC and Clang keep the low bits, giving −16.

Those three terms have precise meanings and you will meet them in every later lesson:

| Term | Meaning | Example |
|---|---|---|
| Implementation-defined | The compiler must pick a behaviour and document it. Portable code must not depend on which. | size of \`int\`, signedness of \`char\`, right shift of a negative value |
| Unspecified | One of several allowed behaviours, no documentation required. | order in which function arguments are evaluated, so \`f(g(), h())\` may call \`h\` first |
| Undefined behaviour (UB) | The standard places no requirement at all. The program may crash, appear to work, or change when the optimisation level changes. | signed overflow, out-of-bounds access, reading an uninitialised local, dereferencing an invalid pointer |

"It worked in the debug build" is the usual signature of undefined behaviour. Nothing checks for it at run time on a
microcontroller. There is no exception, no stack trace, only whatever the generated instructions happen to do.`,
    code(C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 200, b = 100;
    uint8_t sum8 = a + b;        /* computed as int 300, then truncated to 8 bits */
    int     sum  = a + b;        /* computed as int 300, kept                      */
    printf("sum8=%d sum=%d\n", sum8, sum);

    uint16_t x = 60000;
    x += 10000;                  /* 70000 does not fit in 16 bits: 70000 - 65536   */
    printf("x=%d\n", x);

    int      n = -1;
    unsigned u = 1;
    printf("n < u is %d\n", n < (int)u);   /* compare as signed: true              */
    printf("n < u is %d\n", (unsigned)n < u); /* what C does without the cast     */

    printf("sizeof: char=%zu short=%zu int=%zu long=%zu ptr=%zu\n",
           sizeof(char), sizeof(short), sizeof(int), sizeof(long), sizeof(void *));
    return 0;
}
`, 'host-tested', {
      caption: 'On the 64-bit Linux host used to check this lesson the output is: sum8=44 sum=300 / x=4464 / n < u is 1 / n < u is 0 / sizeof: char=1 short=2 int=4 long=8 ptr=8. On a 32-bit MCU the last line ends long=4 ptr=4.',
      explain: [
        { lines: '7', md: 'Both operands are promoted to `int`, the CPU adds two full registers to get 300 (`0x12C`), and the store keeps only the low byte `0x2C` = 44.' },
        { lines: '12', md: '`x += 10000` is `x = (uint16_t)((int)x + 10000)`. The result 70000 is `0x11170`; the low 16 bits are `0x1170` = 4464.' },
        { lines: '17-18', md: 'Written plainly as `n < u`, the compiler converts `n` to `unsigned` first. `-Wextra` reports it as "comparison of integer expressions of different signedness". The two lines spell out both interpretations so the file compiles without that warning.' },
      ] }),
    { t: 'predict',
      q: 'This function is meant to return the average of two 8-bit ADC samples. What does `average(200, 100)` return?',
      code: C`
uint8_t average(uint8_t a, uint8_t b)
{
    return (a + b) / 2;
}`,
      choices: [
        { t: '150', ok: true, why: 'Both operands are promoted to `int`, so the sum is 300 with no loss, the division gives 150, and 150 fits in the `uint8_t` return value. Promotion saved this code. It would break if the operands were `uint32_t` near their maximum, because then there is no wider type to promote to.' },
        { t: '22', why: 'That would be the answer if the addition were done in 8 bits (300 wraps to 44, halved is 22). C never does arithmetic narrower than `int`: operands are promoted first.' },
        { t: '44', why: '44 is 300 truncated to 8 bits, but the truncation happens only when a value is stored into a `uint8_t`, and here the division happens before that.' },
        { t: 'It is undefined behaviour', why: 'Undefined behaviour needs signed overflow of the promoted type. 300 is nowhere near the limit of `int`.' },
      ],
      reveal: 'Promotion to `int` is why small-type arithmetic usually "just works", and also why the bug moves to wherever the value is stored or compared.' },
    clab({
      title: 'Read: widths and conversions on Bench-MCU',
      prompt: `**Predict first.** Write down the six lines this program prints on Bench-MCU (32-bit, \`int\` and \`long\` both 4 bytes, pointers 4 bytes). Then run it and compare. Explain every line you got wrong before moving on.`,
      readOnly: true,
      starter: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 200, b = 100;
    uint8_t sum8 = a + b;
    int sum = a + b;
    printf("%d %d\n", sum8, sum);

    int8_t t = (int8_t)0xF0;
    printf("%d\n", t);

    uint32_t big = 0xFFFFFFFFu;
    big = big + 1;
    printf("%u\n", big);

    int n = -1;
    unsigned int u = 1;
    if (n < u) {
        puts("-1 is less than 1");
    } else {
        puts("-1 is NOT less than 1");
    }

    uint8_t count = 250;
    count += 10;
    printf("%d\n", count);

    printf("%d %d %d\n", (int)sizeof(int), (int)sizeof(long), (int)sizeof(char *));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 200, b = 100;
    uint8_t sum8 = a + b;
    int sum = a + b;
    printf("%d %d\n", sum8, sum);

    int8_t t = (int8_t)0xF0;
    printf("%d\n", t);

    uint32_t big = 0xFFFFFFFFu;
    big = big + 1;
    printf("%u\n", big);

    int n = -1;
    unsigned int u = 1;
    if (n < u) {
        puts("-1 is less than 1");
    } else {
        puts("-1 is NOT less than 1");
    }

    uint8_t count = 250;
    count += 10;
    printf("%d\n", count);

    printf("%d %d %d\n", (int)sizeof(int), (int)sizeof(long), (int)sizeof(char *));
    return 0;
}
`,
      tests: [{ name: 'output matches the conversion rules', stdout: '44 300\n-16\n0\n-1 is NOT less than 1\n4\n4 4 4\n' }],
      hints: [
        'Work each expression in two stages: first the arithmetic at the width of `int` (or wider), then the store into the destination type.',
        '`0xF0` is 240. An `int8_t` holds −128…127, so the stored bit pattern `1111 0000` is read as a two\'s complement number: 240 − 256.',
        'For `n < u`, the signed operand is converted to unsigned before the comparison. What is −1 as a 32-bit unsigned value?',
      ],
      explain: `Line by line: 300 truncated to 8 bits is 44, kept as \`int\` it is 300. \`0xF0\` as a signed byte is −16. \`0xFFFFFFFF + 1\` wraps to 0, which is defined for unsigned types. \`-1\` becomes 4 294 967 295 in the comparison, so it is not less than 1. 250 + 10 = 260, minus 256 is 4. Every basic type from \`int\` up to a pointer is 4 bytes on a 32-bit MCU; on your PC \`long\` and pointers are 8.`,
    }),
    `## Control flow and functions: what is different

The statements look like Java or JavaScript: \`if\`/\`else\`, \`for\`, \`while\`, \`do … while\`, \`switch\`. The differences are in
what is *not* checked.

- **Any integer is a condition.** Zero is false, everything else is true. \`if (x = 5)\` assigns, then tests 5, and is always true. \`-Wall\` warns.
- **\`switch\` falls through.** Without \`break\`, execution continues into the next \`case\`.
- **Arguments are passed by value.** A function receives *copies*. To let a function change the caller's variable you pass its address. That is the subject of the next lesson.
- **A function must be declared before it is called.** In C99 and later, calling an undeclared function is an error or at least a loud warning (\`implicit declaration of function\`).
- **\`void f(void)\`** means "no parameters". **A local variable has no default value**: until you assign it, it holds whatever bytes were left on the stack.
- **There are no exceptions.** Functions report failure through a return value and nothing forces the caller to look at it.

## The preprocessor is a text editor

\`#define\` does not create a variable or a function. It records a text replacement that is applied before the compiler
parses anything. That makes macros useful for constants and register addresses, and treacherous when they take arguments:`,
    code(C`
#include <stdio.h>

#define BAD_DOUBLE(x)  x + x
#define GOOD_DOUBLE(x) ((x) + (x))

int main(void)
{
    printf("%d\n", 10 * BAD_DOUBLE(3));    /* expands to 10 * 3 + 3      */
    printf("%d\n", 10 * GOOD_DOUBLE(3));   /* expands to 10 * ((3) + (3)) */
    return 0;
}
`, 'host-tested', { caption: 'Prints 33, then 60. The macro argument and the whole expansion both need parentheses.' }),
    { t: 'callout', kind: 'mistake', title: 'Macro arguments are evaluated every time they appear', md:
`\`GOOD_DOUBLE(read_adc())\` expands to \`((read_adc()) + (read_adc()))\` and starts **two** conversions. \`GOOD_DOUBLE(i++)\`
modifies \`i\` twice with no **sequence point** between the two changes (a sequence point is a place, such as the end of a full expression or the \`;\` of a statement, where all earlier side effects are guaranteed complete), which is undefined behaviour. When a macro behaves like a function,
write a \`static inline\` function instead: it is type-checked, evaluates each argument once, and compiles to the same
instructions.` },
    clab({
      title: 'Debug: the countdown that runs off the start of the buffer',
      prompt: `\`print_reversed\` should print the bytes of a buffer from last to first. Run it: it does not stop at index 0. Find out why the loop condition can never be false, fix the loop, and make sure it also handles a length of 0.

Expected output:

\`[44][33][22][11]\` on the first line, then an empty line for the zero-length call.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static void print_reversed(const uint8_t *buf, uint32_t n)
{
    for (uint32_t i = n - 1; i >= 0; i--) {
        printf("[%02X]", buf[i]);
    }
    printf("\n");
}

int main(void)
{
    uint8_t data[4] = { 0x11, 0x22, 0x33, 0x44 };
    print_reversed(data, 4);
    print_reversed(data, 0);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static void print_reversed(const uint8_t *buf, uint32_t n)
{
    for (uint32_t i = n; i > 0; i--) {
        printf("[%02X]", buf[i - 1]);
    }
    printf("\n");
}

int main(void)
{
    uint8_t data[4] = { 0x11, 0x22, 0x33, 0x44 };
    print_reversed(data, 4);
    print_reversed(data, 0);
    return 0;
}
`,
      tests: [{ name: 'prints four bytes reversed, then nothing for n = 0', stdout: '[44][33][22][11]\n\n' }],
      hints: [
        'What type is `i`? List the values for which `i >= 0` is false.',
        'When `i` is 0 and the loop runs `i--`, the value wraps to 4 294 967 295. `buf[i]` then reads far outside the array. And what is the starting value `n - 1` when `n` is 0?',
        'Count from `n` down to 1 and index with `i - 1`. The condition `i > 0` *can* become false, and `n == 0` runs zero times.',
      ],
      explain: `An unsigned value is never negative, so \`i >= 0\` is always true. The idiom for counting down with an unsigned index is \`for (i = n; i > 0; i--) use(buf[i - 1]);\`. Changing \`i\` to \`int\` also works for small buffers but reintroduces a signed/unsigned comparison against \`n\`. With \`n = 0\`, the original also computed \`0 - 1\` and started at index 4 294 967 295.`,
    }),
    clab({
      title: 'Debug: a unit-conversion macro',
      prompt: `The timer on this board ticks 10 times per millisecond. \`MS_TO_TICKS\` converts milliseconds to ticks, but both results below are wrong. Work out the text the preprocessor actually produces for each use, then fix the macro (or replace it with a function) so the program prints:

\`timeout = 250 ticks\`
\`reloads = 20\``,
      starter: C`
#include <stdint.h>
#include <stdio.h>

#define TICKS_PER_MS 10
#define MS_TO_TICKS(ms) ms * TICKS_PER_MS

int main(void)
{
    uint32_t base = 20, extra = 5;

    uint32_t timeout = MS_TO_TICKS(base + extra);
    printf("timeout = %u ticks\n", timeout);

    uint32_t reloads = 1000 / MS_TO_TICKS(5);
    printf("reloads = %u\n", reloads);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

#define TICKS_PER_MS 10
#define MS_TO_TICKS(ms) ((ms) * TICKS_PER_MS)

int main(void)
{
    uint32_t base = 20, extra = 5;

    uint32_t timeout = MS_TO_TICKS(base + extra);
    printf("timeout = %u ticks\n", timeout);

    uint32_t reloads = 1000 / MS_TO_TICKS(5);
    printf("reloads = %u\n", reloads);
    return 0;
}
`,
      tests: [{ name: 'both conversions are correct', stdout: 'timeout = 250 ticks\nreloads = 20\n' }],
      hints: [
        'The preprocessor pastes the argument text into the replacement text and knows nothing about precedence. Write out, character for character, what each of the two uses becomes. Which operator in each result binds first?',
        'The first use becomes `base + extra * 10`. The second becomes `1000 / 5 * 10`, and division and multiplication have equal precedence and group left to right.',
        'Parenthesise the parameter *and* the whole replacement: `((ms) * TICKS_PER_MS)`.',
      ],
      explain: `The buggy macro printed 70 (\`20 + 5 * 10\`) and 2000 (\`(1000 / 5) * 10\`). Two sets of parentheses fix two different problems: \`(ms)\` protects against low-precedence operators inside the argument, the outer pair protects against operators around the macro use. A \`static inline uint32_t ms_to_ticks(uint32_t ms)\` has neither problem.`,
    }),
    { t: 'exercise',
      prompt: 'A battery monitor on an MCU with a **16-bit** `int` computes `uint32_t mv = adc * 3300 / 4095;` where `adc` is a `uint16_t` holding 4000. The intended result is 3223. Explain what goes wrong and give the smallest change that fixes it on every target.',
      hints: [
        'What is the type of `adc * 3300` after promotion on a target where `int` is 16 bits? Is 13 200 000 representable in it?',
        'On that target a `uint16_t` cannot be represented in a 16-bit `int`, so it promotes to `unsigned int`, also 16 bits. The multiplication wraps modulo 65 536 before the result is ever widened.',
        'The type of the *destination* does not affect how the right-hand side is computed. Make one operand 32 bits wide before multiplying.',
      ],
      solution: 'The multiplication is carried out in 16-bit `unsigned int`, so 4000 × 3300 = 13 200 000 wraps to 13 200 000 mod 65 536 = 27 264, and 27 264 / 4095 = 6. The assignment to `uint32_t` happens after the damage. Fix: `uint32_t mv = (uint32_t)adc * 3300u / 4095u;` (or write the constant as `3300UL`). On a 32-bit MCU the original line happens to work because `int` is wide enough, which is exactly why this bug survives until the code is ported.' },
    `## A harder case: the same line on two targets

Code is routinely developed on one chip and reused on another. Consider \`uint32_t elapsed = now - start;\` where both are
\`uint16_t\` timer captures and the timer wrapped between them (\`start = 65000\`, \`now = 200\`).

- If you store the difference in a **\`uint16_t\`**, you get \`(200 − 65000) mod 65536 = 736\`, the true elapsed count. Unsigned wrap-around makes timer differences work.
- Stored in a \`uint32_t\` on a 32-bit target, the subtraction happens in \`int\`, gives −64 800, and converts to 4 294 902 496.

The rule to take away: decide the width in which each calculation must happen and state it with a cast or a correctly
typed intermediate variable. Do not let the promotion rules decide for you.`,
    { t: 'refs', items: [
      { title: 'ISO/IEC 9899:201x committee draft N1570 (C11)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf', note: '§6.3.1 conversions, §3.4 behaviour definitions, §5.1.1.2 translation phases' },
      { title: 'GCC manual: C implementation-defined behaviour — integers', url: 'https://gcc.gnu.org/onlinedocs/gcc/Integers-implementation.html' },
      { title: 'SEI CERT C: INT30-C, INT31-C, INT02-C', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard' },
    ] },
  ],
  quiz: [
    { q: 'The linker reports `undefined reference to \'adc_read\'`. The file that calls it includes `adc.h`, which declares the function. What is the most likely cause?', kind: 'concept', choices: [
      { t: 'No object file in the link defines `adc_read`', ok: true, why: 'The compiler was satisfied by the declaration. The linker found no object file that *defines* the symbol.' },
      { t: 'The header `adc.h` is missing its include guard', why: 'A missing guard causes duplicate declarations or redefinition errors at compile time. It cannot make a definition disappear at link time.' },
      { t: 'The function was called before it was declared', why: 'That is diagnosed by the compiler as an implicit declaration, one step earlier than the linker.' },
      { t: 'The return type in the header does not match the definition', why: 'A mismatched declaration is a compile-time conflict (if the definition is visible) or silent misbehaviour. The symbol name would still resolve.' },
    ] },
    { q: 'What does this print on a 32-bit MCU?', code: C`
uint8_t x = 0;
x = x - 1;
printf("%d\n", x);`, kind: 'code', choices: [
      { t: '255', ok: true, why: '`x - 1` is computed as `int` and equals −1. Storing −1 into a `uint8_t` keeps the low eight bits, `0xFF`.' },
      { t: '-1', why: 'The subtraction does produce −1 as an `int`, but the result is stored back into an unsigned 8-bit variable before it is printed.' },
      { t: '4294967295', why: 'That would be −1 converted to a 32-bit unsigned type. The variable is only 8 bits wide.' },
      { t: 'Undefined behaviour', why: 'Conversion to an unsigned type is fully defined: the value is reduced modulo 2⁸.' },
    ] },
    { q: 'A protocol document says a packet starts with "a 16-bit length, then a 32-bit sequence number". Which declarations express that reliably on every compiler?', kind: 'concept', choices: [
      { t: '`uint16_t length; uint32_t sequence;`', ok: true, why: 'Fixed-width types have exactly the stated width on every implementation that provides them.' },
      { t: '`short length; long sequence;`', why: '`long` is 4 bytes on a 32-bit MCU and 8 on 64-bit Linux, so host-side test tools would disagree with the firmware.' },
      { t: '`int length; int sequence;`', why: '`int` is 16 bits on small MCUs and 32 on larger ones. Neither field would have a dependable width.' },
      { t: '`unsigned length; unsigned long long sequence;`', why: 'Both have only minimum widths, and on common targets these are 32 and 64 bits, not 16 and 32.' },
    ] },
    { q: 'A function checks a user-supplied index with `if (index < sizeof(table))`, where `index` is an `int` holding −1. What happens?', kind: 'security', choices: [
      { t: 'The check fails, because −1 is converted to a huge unsigned value', ok: true, why: '`sizeof` yields `size_t`, an unsigned type, so the signed operand is converted. Here the conversion happens to reject the bad index; reverse the comparison or mix in arithmetic and the same rule lets bad values through.' },
      { t: 'The check passes, because −1 is less than any size a table can have', why: 'That is the mathematical answer. C compares after converting both sides to a common type, and the common type here is unsigned.' },
      { t: 'The compiler rejects the comparison of an `int` with a `size_t`', why: 'Mixed comparisons are legal C. At most you get a warning with `-Wextra`.' },
      { t: 'The behaviour is undefined, because a negative index is compared', why: 'Signed-to-unsigned conversion is well defined (modulo 2ⁿ). It is surprising, not undefined.' },
    ] },
    { q: 'Which statement about undefined behaviour is correct?', kind: 'concept', choices: [
      { t: 'The compiler may assume it never happens, so the visible effect can change with optimisation level', ok: true, why: 'Optimisers reason "this cannot overflow / cannot be NULL here" and delete or reorder code on that basis.' },
      { t: 'It always causes a HardFault or a reset on a microcontroller', why: 'A fault is one possible outcome. Silent corruption or apparently correct operation are just as allowed and more common.' },
      { t: 'The compiler must document what it does in each case it meets', why: 'That obligation belongs to implementation-defined behaviour. For undefined behaviour there is no requirement at all.' },
      { t: 'It only matters on desktop compilers; embedded compilers generate what you wrote', why: 'Embedded toolchains are the same GCC and Clang with the same optimiser. `-O2` and `-Os` are the normal settings for firmware.' },
    ] },
    { q: 'What does `SQUARE(n + 1)` evaluate to when `n` is 3?', code: '#define SQUARE(x) x * x', kind: 'code', choices: [
      { t: '7', ok: true, why: 'The text becomes `n + 1 * n + 1`, which is `3 + 3 + 1`.' },
      { t: '16', why: 'That is what a function would return. A macro substitutes text, and without parentheses the multiplication binds tighter than the additions.' },
      { t: '10', why: 'Check the expansion again: there is only one multiplication, `1 * n`.' },
      { t: 'It does not compile', why: 'The expansion `n + 1 * n + 1` is a perfectly valid expression, which is what makes this bug hard to see.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 2 */
const pointers = {
  id: 'ec-pointers',
  title: 'Pointers and memory addresses',
  minutes: 55,
  summary: 'A pointer is an address with a type attached. Everything a driver does to hardware goes through one.',
  skills: ['ec-pointers-read-write', 'ec-out-params'],
  blocks: [
    `## The problem: reaching one specific address

The Bench-MCU datasheet (\`docs/BENCH_MCU.md\`) says the GPIO output latch is the 32-bit register at address
\`0x4000_0004\`. To turn on an LED you must store a number at exactly that address. Python and Java give you no way to say
"the four bytes at address X". C does, and the mechanism is the **pointer**.

The same mechanism solves an ordinary programming problem too. A C function returns one value and receives copies of its
arguments, so how does \`read_sensor()\` return both a reading and a success flag? It is handed the *address* of a variable
belonging to the caller and stores the reading there.

## Theory: an address plus a type

Memory is a long row of bytes, each with a numbered address. A pointer is a variable whose value is one of those numbers.
Its **type** records what lives at that address, and so tells the compiler two things:

1. how many bytes to read or write when the pointer is followed (1 for \`uint8_t *\`, 4 for \`uint32_t *\`), and
2. how to interpret them (signed, unsigned, a struct with fields, …).

Two operators do all the work:

| Operator | Reads as | Example | Result |
|---|---|---|---|
| \`&x\` | "address of \`x\`" | \`uint32_t *p = &x;\` | \`p\` now holds the address where \`x\` is stored |
| \`*p\` | "the object \`p\` points to" (dereference) | \`*p = 7;\` | writes 7 into the object at that address — here, \`x\` |

The \`*\` in a declaration (\`uint32_t *p\`) is not the dereference operator. It is part of the type and means "\`p\` is a
pointer to \`uint32_t\`".`,
    { t: 'ascii', caption: 'After `uint32_t x = 5; uint32_t *p = &x;` on a 32-bit little-endian MCU. The addresses are examples.', text:
`address       contents (bytes)        C name     value
0x2000FFF8    05 00 00 00             x          5
0x2000FFF4    F8 FF 00 20             p          0x2000FFF8   (the address of x)

*p = 7;   -> CPU loads 0x2000FFF8 from p, then stores 07 00 00 00 at that address
x         -> now 7` },
    `On a 32-bit MCU every pointer is 4 bytes, whatever it points to, because an address is 32 bits.

## On hardware: a register is a dereferenced constant address

A peripheral register is not a variable. Nobody declared it and it has no name the linker knows. You manufacture a
pointer from the number in the datasheet with a cast:`,
    code(C`
#include <stdint.h>

#define GPIO_OUT_ADDR 0x40000004u

void led_on(void)
{
    volatile uint32_t *gpio_out = (volatile uint32_t *)GPIO_OUT_ADDR;
    *gpio_out = 1u << 5;       /* store 0x20 at address 0x40000004 */
}

/* The same thing folded into one macro, as vendor headers do: */
#define GPIO_OUT (*(volatile uint32_t *)0x40000004u)
/* GPIO_OUT = 1u << 5; */
`, 'reviewed', {
      caption: 'Written against docs/BENCH_MCU.md. It compiles on a PC, but running it there would crash: address 0x40000004 is only a register on Bench-MCU. Try it in the lab below.',
      explain: [
        { lines: '7', md: 'The cast turns the integer `0x40000004` into "pointer to a 32-bit unsigned object at that address". `volatile` tells the compiler that this object can change, or have effects, outside the program\'s view; it has its own lesson.' },
        { lines: '8', md: 'The CPU executes a 32-bit store. The address decodes to the GPIO block on the peripheral bus rather than to RAM, so the value lands in the output latch and pin 5 goes high.' },
        { lines: '12', md: 'Read the macro from the inside out: the number, cast to a pointer, dereferenced. The result behaves like a variable called `GPIO_OUT`.' },
      ] }),
    `## Worked example: out parameters`,
    code(C`
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

/* Converts a raw 12-bit ADC code to millivolts. Returns false if raw is out of range. */
static bool adc_to_mv(uint16_t raw, uint32_t *mv_out)
{
    if (raw > 4095 || mv_out == NULL) {
        return false;                    /* *mv_out is left untouched */
    }
    *mv_out = (uint32_t)raw * 3300u / 4095u;
    return true;
}

int main(void)
{
    uint32_t mv = 0;
    if (adc_to_mv(2048, &mv)) {
        printf("ok, %u mV\n", (unsigned)mv);
    }
    if (!adc_to_mv(5000, &mv)) {
        printf("rejected, mv still %u\n", (unsigned)mv);
    }
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "ok, 1650 mV" then "rejected, mv still 1650".',
      explain: [
        { lines: '6', md: 'The return value carries success or failure. The result travels through `mv_out`, a copy of the *address* of the caller\'s variable.' },
        { lines: '8', md: 'A function that receives a pointer from elsewhere checks it before use. `NULL` is the conventional "points at nothing" value.' },
        { lines: '11', md: 'One store through the pointer writes into `mv` in `main`\'s stack frame.' },
        { lines: '18', md: '`&mv` passes the address. Passing `mv` would be a type error; passing an uninitialised pointer variable would compile and write to a random address.' },
      ] }),
    `## NULL, and why it is weaker on a microcontroller

\`NULL\` is a pointer value guaranteed not to point at any object. Dereferencing it is undefined behaviour. On a PC the
operating system leaves address 0 unmapped, so the program dies at once with a segmentation fault. A microcontroller has
no operating system. On many Cortex-M parts address 0 is the start of flash or an alias of the vector table, so **reading**
through a null pointer quietly returns the bytes found there (typically the initial stack pointer value), and a
\`p->field\` read at a small offset returns part of a vector. Writes to flash addresses usually fault or are ignored. Do
not expect a crash to tell you a pointer was null. Check it.

## Pointers to pointers

A pointer is itself a variable with an address, so you can point at it. \`char **pp\` is "the address of a variable that
holds the address of a \`char\`". The practical use is the out-parameter pattern again: to let a function change *where
the caller's pointer points* (advance a parse cursor, return a buffer), pass the address of that pointer.

## const and pointers

There are two things that can be read-only: the pointer, and what it points at. Read the declaration from right to left.

| Declaration | Read as | \`*p = 1\` | \`p = &other\` |
|---|---|---|---|
| \`uint8_t *p\` | pointer to \`uint8_t\` | allowed | allowed |
| \`const uint8_t *p\` | pointer to read-only \`uint8_t\` | **error** | allowed |
| \`uint8_t *const p\` | read-only pointer to \`uint8_t\` | allowed | **error** |
| \`const uint8_t *const p\` | read-only pointer to read-only \`uint8_t\` | **error** | **error** |

\`const uint8_t *data\` in a parameter list is a promise from the function, checked by the compiler, that it will not modify the
caller's buffer. Use it on every pointer parameter that is only read. It documents the interface and lets callers pass
data that lives in flash.`,
    { t: 'callout', kind: 'mistake', title: 'Declaring a pointer is not the same as having somewhere to point', md:
`\`uint32_t *result; read_sensor(result);\` passes whatever bytes happened to be in the local variable \`result\`. The
function then writes four bytes to that arbitrary address. The correct form is \`uint32_t result; read_sensor(&result);\`.
A second classic: \`int *a, b;\` declares one pointer and one \`int\`, because the \`*\` binds to the name, not to the type.` },
    { t: 'predict',
      q: 'What does this program print?',
      code: C`
void reset(uint32_t value) { value = 0; }
void clear(uint32_t *value) { *value = 0; }

int main(void)
{
    uint32_t a = 42, b = 42;
    reset(a);
    clear(&b);
    printf("%u %u\n", a, b);
}`,
      choices: [
        { t: '42 0', ok: true, why: '`reset` zeroes its own copy of 42, which is discarded on return. `clear` receives the address of `b` and stores 0 there.' },
        { t: '0 0', why: 'This assumes arguments are passed by reference, as objects are in Java or Python. C copies the value of every argument, including the 42.' },
        { t: '42 42', why: '`clear` does not change its local pointer; it writes through it, and the write lands in `main`\'s `b`.' },
        { t: '0 42', why: 'Check which function was given an address. Only that one can reach a variable in `main`.' },
      ],
      reveal: 'C has only pass-by-value. "Pass by reference" is done by hand: pass the value of an address.' },
    clab({
      title: 'Read: follow the pointers',
      prompt: `**Predict first.** Draw three boxes for \`level\`, \`other\` and \`p\`, and update them line by line. Write down the five lines of output, then run the program.`,
      readOnly: true,
      starter: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint16_t level = 100;
    uint16_t *p = &level;

    *p = *p + 5;
    printf("%d\n", level);

    uint16_t copy = *p;
    copy++;
    printf("%d %d\n", level, copy);

    uint16_t other = 7;
    p = &other;
    *p = 9;
    printf("%d %d\n", level, other);

    uint16_t **pp = &p;
    **pp = 11;
    *pp = &level;
    *p = 1;
    printf("%d %d\n", level, other);

    printf("%d %d\n", (int)sizeof(*p), (int)sizeof(p));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint16_t level = 100;
    uint16_t *p = &level;

    *p = *p + 5;
    printf("%d\n", level);

    uint16_t copy = *p;
    copy++;
    printf("%d %d\n", level, copy);

    uint16_t other = 7;
    p = &other;
    *p = 9;
    printf("%d %d\n", level, other);

    uint16_t **pp = &p;
    **pp = 11;
    *pp = &level;
    *p = 1;
    printf("%d %d\n", level, other);

    printf("%d %d\n", (int)sizeof(*p), (int)sizeof(p));
    return 0;
}
`,
      tests: [{ name: 'output', stdout: '105\n105 106\n105 9\n1 11\n2 4\n' }],
      hints: [
        '`copy = *p` copies the *value* found through the pointer. After that, `copy` has no connection to `level`.',
        '`**pp = 11` follows two arrows: `pp` → `p` → whatever `p` points at right now. Which variable is that?',
        '`*pp = &level` changes `p` itself, so the following `*p = 1` writes to `level`.',
      ],
      explain: `\`*p\` on the left of \`=\` writes to the pointed-to object, on the right it reads it. Re-aiming \`p\` (\`p = &other\`) changes nothing in either variable. \`pp\` holds the address of \`p\`, so \`*pp\` *is* \`p\`. The last line: the thing \`p\` points at is 2 bytes, the pointer is 4 bytes on a 32-bit machine.`,
    }),
    clab({
      title: 'Write: return two results through out parameters',
      prompt: `Implement \`divmod\`. It divides \`a\` by \`b\` and stores the quotient in \`*q\` and the remainder in \`*r\`.

- Return \`true\` on success.
- If \`b\` is 0, or either pointer is \`NULL\`, return \`false\` and **write nothing** through the pointers.

\`main\` is already written and must not need changes.`,
      starter: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>

static bool divmod(int a, int b, int *q, int *r)
{
    /* TODO: validate, then store the quotient in *q and the remainder in *r */
    return false;
}

static void show(int a, int b)
{
    int q = -1, r = -1;
    bool ok = divmod(a, b, &q, &r);
    printf("%d / %d: ok=%d q=%d r=%d\n", a, b, ok, q, r);
}

int main(void)
{
    show(17, 5);
    show(100, 10);
    show(7, 0);
    int only = -1;
    printf("null q: ok=%d\n", divmod(8, 2, NULL, &only));
    bool ok = divmod(8, 2, &only, NULL);     /* a separate statement: argument order is unspecified */
    printf("null r: ok=%d only=%d\n", ok, only);
    return 0;
}
`,
      solution: C`
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>

static bool divmod(int a, int b, int *q, int *r)
{
    if (b == 0 || q == NULL || r == NULL) {
        return false;
    }
    *q = a / b;
    *r = a % b;
    return true;
}

static void show(int a, int b)
{
    int q = -1, r = -1;
    bool ok = divmod(a, b, &q, &r);
    printf("%d / %d: ok=%d q=%d r=%d\n", a, b, ok, q, r);
}

int main(void)
{
    show(17, 5);
    show(100, 10);
    show(7, 0);
    int only = -1;
    printf("null q: ok=%d\n", divmod(8, 2, NULL, &only));
    bool ok = divmod(8, 2, &only, NULL);     /* a separate statement: argument order is unspecified */
    printf("null r: ok=%d only=%d\n", ok, only);
    return 0;
}
`,
      tests: [{ name: 'results, divide by zero and NULL handling', stdout: '17 / 5: ok=1 q=3 r=2\n100 / 10: ok=1 q=10 r=0\n7 / 0: ok=0 q=-1 r=-1\nnull q: ok=0\nnull r: ok=0 only=-1\n' }],
      hints: [
        'What does the caller see if the function stores `*q` and only then discovers that `r` is NULL? In what order must the checks and the stores come?',
        'Do every check before the first store. Inside the function `q` is an address; `*q = a / b;` stores into the caller\'s variable.',
        'The whole body is one `if` with three conditions joined by `||`, two stores, and `return true;`.',
      ],
      explain: `Validate, then commit. The \`7 / 0\` line shows \`q\` and \`r\` still at −1: a failed call left the caller's variables alone. The last line needs both NULL checks to happen before any store, otherwise \`only\` would have been overwritten with 4. Integer division by zero is undefined behaviour in C (so is \`INT_MIN / -1\`, whose result does not fit), and on a Cortex-M it can raise a UsageFault if the divide-by-zero trap is enabled. The last call is made in its own statement on purpose: written as \`printf("…", divmod(8, 2, &only, NULL), only)\`, the compiler would be free to read \`only\` before or after the call.`,
    }),
    clab({
      title: 'Debug: the cursor that does not move',
      prompt: `\`read_number\` parses a decimal number from a string and is supposed to leave the caller's cursor on the first character after it, so that three calls read three numbers from \`"12,345,6"\`. It prints \`12 12 12\`.

Fix it so that the output is \`12 345 6\`. You will need to change the function's parameter type and how \`main\` calls it.`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static uint32_t read_number(const char *cursor)
{
    uint32_t value = 0;
    while (*cursor >= '0' && *cursor <= '9') {
        value = value * 10 + (uint32_t)(*cursor - '0');
        cursor++;
    }
    return value;
}

int main(void)
{
    const char *p = "12,345,6";

    uint32_t a = read_number(p);
    if (*p == ',') p++;
    uint32_t b = read_number(p);
    if (*p == ',') p++;
    uint32_t c = read_number(p);

    printf("%u %u %u\n", a, b, c);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static uint32_t read_number(const char **cursor)
{
    uint32_t value = 0;
    const char *s = *cursor;
    while (*s >= '0' && *s <= '9') {
        value = value * 10 + (uint32_t)(*s - '0');
        s++;
    }
    *cursor = s;
    return value;
}

int main(void)
{
    const char *p = "12,345,6";

    uint32_t a = read_number(&p);
    if (*p == ',') p++;
    uint32_t b = read_number(&p);
    if (*p == ',') p++;
    uint32_t c = read_number(&p);

    printf("%u %u %u\n", a, b, c);
    return 0;
}
`,
      tests: [{ name: 'three numbers are parsed', stdout: '12 345 6\n' }],
      hints: [
        'Which variable does `cursor++` change: `main`\'s `p`, or something else? Check by printing `*p` in `main` right after the first call.',
        '`cursor++` inside the function advances a *copy* of `p`. The caller\'s `p` still points at the `1`.',
        'To change a caller\'s `int` you pass `int *`. To change a caller\'s `const char *` you pass a pointer to it: `const char **`. Inside the function, `*cursor` is the caller\'s pointer and `**cursor` is the current character. Copy `*cursor` to a local, walk the local, then store it back with `*cursor = s;`.',
      ],
      explain: `Pointers are passed by value like everything else. The fix is one more level of indirection: the function receives the address of the caller's cursor and stores the advanced position through it. Working on a local copy and writing back once is easier to read than \`(**cursor)\` everywhere. Standard-library \`strtoul(str, &end, 10)\` uses the same pattern.`,
    }),
    { t: 'exercise',
      prompt: 'A function is declared `void log_frame(const uint8_t *const frame, size_t len);`. State which of these lines inside the function compile, and why: (a) `frame[0] = 0;` (b) `frame++;` (c) `uint8_t first = frame[0];` (d) `const uint8_t *q = frame + 1;`',
      hints: [
        'Split the declaration at the `*`. To the left is what is pointed at, to the right is the pointer itself.',
        '`const uint8_t` on the left: the bytes are read-only through this pointer. `*const` on the right: the pointer variable cannot be re-aimed.',
      ],
      solution: '(a) does not compile: the pointed-to bytes are `const`. (b) does not compile: the pointer itself is `const`. (c) compiles: reading is always allowed. (d) compiles: it creates a *new* pointer; `frame` is not modified, and `q` keeps the promise not to write to the bytes.' },
    `## A harder case: who owns the memory?

A pointer says where something is. It says nothing about **how long it stays there**. Consider a function that formats
a device ID into a local \`char buf[16]\` and returns \`buf\`. The address it returns is in a stack frame that no longer
exists once the function returns; the next function call reuses those bytes. The caller holds a **dangling pointer**, and
the string it prints depends on what ran in between. You will fix exactly this bug in the allocation lesson. For now,
adopt the habit that prevents it: for every pointer, be able to name the object it points at and when that object stops
existing.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.5.3.2 (address and indirection operators), §6.3.2.3 (pointers)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'SEI CERT C: EXP34-C. Do not dereference null pointers', url: 'https://wiki.sei.cmu.edu/confluence/display/c/EXP34-C.+Do+not+dereference+null+pointers' },
    ] },
  ],
  quiz: [
    { q: 'On a 32-bit MCU, what is `sizeof(p)` for `uint8_t *p` and for `uint64_t *p`?', kind: 'concept', choices: [
      { t: '4 and 4', ok: true, why: 'A pointer stores an address, and every address on this machine is 32 bits, whatever the pointed-to type.' },
      { t: '1 and 8', why: 'Those are the sizes of the objects pointed at (`sizeof(*p)`), not of the pointers.' },
      { t: '8 and 8', why: 'That is the answer on a 64-bit PC. Pointer size follows the address width of the target.' },
      { t: '4 and 8', why: 'The pointed-to type changes how many bytes a dereference touches, but not how many bytes the address itself needs.' },
    ] },
    { q: 'What is wrong with this code?', code: C`
void get_temperature(int16_t *out);

void task(void)
{
    int16_t *t;
    get_temperature(t);
}`, kind: 'code', choices: [
      { t: '`t` was never given an address, so the write lands somewhere arbitrary', ok: true, why: 'No `int16_t` object was ever created. It should be `int16_t t; get_temperature(&t);`.' },
      { t: 'The call should pass `*t`, the object the pointer refers to', why: '`*t` would read an `int16_t` through the uninitialised pointer and then pass a value where an address is expected.' },
      { t: 'Out parameters must be declared `const` so the callee cannot misuse them', why: '`const` on the pointed-to type would forbid exactly the write that an out parameter exists to perform.' },
      { t: 'Nothing; the argument type matches the parameter, so the call is correct', why: 'The types do match, which is why the compiler accepts it. Type correctness does not make the address valid.' },
    ] },
    { q: 'Firmware on a Cortex-M device reads `cfg->baud` where `cfg` is NULL and `baud` is the first field. The device does not crash. What is the most likely explanation?', kind: 'arch', choices: [
      { t: 'Address 0 is readable on that chip (flash or the vector table), so the read returns what is stored there', ok: true, why: 'There is no operating system to unmap page zero. The read succeeds and returns the first vector-table word.' },
      { t: 'The compiler inserts a null check and substitutes a default value for the missing field', why: 'C compilers insert no run-time checks on pointer dereferences. If anything, the optimiser removes checks it considers redundant.' },
      { t: 'NULL is not address 0 on Arm, so the pointer refers to an ordinary variable', why: 'On all mainstream embedded toolchains the null pointer is represented as address 0.' },
      { t: 'The C standard defines reads through NULL to return 0', why: 'The C standard defines no result at all for this; what you get is the content of physical address 0.' },
    ] },
    { q: 'A driver function only reads the buffer it is given. Which prototype is best?', kind: 'concept', choices: [
      { t: '`void spi_send(const uint8_t *data, size_t len);`', ok: true, why: 'The compiler enforces that the function cannot modify the caller\'s data, and callers can pass constant tables stored in flash.' },
      { t: '`void spi_send(uint8_t *const data, size_t len);`', why: 'This makes the local pointer variable unchangeable, which is of no interest to the caller, and still permits writes to the buffer.' },
      { t: '`void spi_send(uint8_t *data, size_t len);`', why: 'It works, but callers holding `const` data need a cast, and nothing stops the function scribbling on the buffer.' },
      { t: '`void spi_send(uint8_t data[], const size_t len);`', why: 'An array parameter is just a pointer in disguise, and `const` on a by-value `len` protects nothing the caller cares about.' },
    ] },
    { q: 'Why does a function that must advance the caller\'s `char *cursor` take a `char **`?', kind: 'concept', choices: [
      { t: 'Because the cursor is passed by value; changing it requires its address', ok: true, why: 'The same rule as for any other variable: to modify a caller\'s `T`, receive a `T *`. Here `T` is `char *`.' },
      { t: 'Because a string is a two-dimensional array of characters, which needs two stars', why: 'A C string is a one-dimensional run of bytes ending in 0. The second `*` is about reaching the caller\'s pointer variable.' },
      { t: 'Because `char *` parameters are read-only inside the called function', why: 'Nothing is read-only here. The function can freely change its own copy; the problem is that it is only a copy.' },
      { t: 'To avoid copying the whole string each time the function is called', why: 'Passing `char *` already avoids copying the characters. Only the 4-byte address is copied either way.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 3 */
const ptrArith = {
  id: 'ec-pointer-arithmetic',
  title: 'Pointer arithmetic and arrays',
  minutes: 65,
  summary: 'Adding to a pointer moves it by whole elements. Arrays are contiguous memory with no length attached, so every bound is your job.',
  skills: ['ec-pointer-arith', 'ec-bounds'],
  blocks: [
    `## The problem: the checksum that covers four bytes

A colleague writes a checksum routine and tests it on a 4-byte frame. It works. In the product, frames are 64 bytes long
and corrupted frames are accepted as valid. The function is three lines long:`,
    code(C`
uint32_t checksum(const uint8_t *data)
{
    uint32_t sum = 0;
    for (size_t i = 0; i < sizeof(data); i++) sum += data[i];
    return sum;
}
`, 'pseudo', { caption: 'It always sums exactly 4 bytes on a 32-bit MCU (8 on a 64-bit PC).' }),
    `To see why, you need to know what an array is in C, what happens to it when it is passed to a function, and what
\`sizeof\` measures.

## Theory

### An array is elements side by side

\`uint32_t samples[4];\` reserves 16 consecutive bytes: four 4-byte elements with nothing between them and **nothing
stored alongside** — no length field, no type tag, no bounds. \`samples[i]\` is compiled to "address of the array plus
\`i\` × 4".

### Pointer arithmetic is scaled

Adding an integer to a pointer moves it by that many **elements**, not bytes. The compiler multiplies by \`sizeof\` of
the pointed-to type:

| Expression | \`p\` is \`uint8_t *\` at 0x2000_0100 | \`p\` is \`uint32_t *\` at 0x2000_0100 |
|---|---|---|
| \`p + 1\` | 0x2000_0101 | 0x2000_0104 |
| \`p + 3\` | 0x2000_0103 | 0x2000_010C |
| \`p++\` | advances 1 byte | advances 4 bytes |

Subtracting two pointers into the same array gives the number of elements between them. Comparing them (\`p < end\`) is
how loops walk a buffer.

### Indexing is pointer arithmetic

By definition \`a[i]\` means \`*(a + i)\`. The two spellings generate identical code. Use indexing when you think in
positions and a moving pointer when you think in "the next byte".

### Arrays decay to pointers

In almost every expression, the name of an array is converted to a pointer to its first element. In particular, **an
array passed to a function arrives as a pointer**. The parameter \`const uint8_t data[]\` is exactly the same as
\`const uint8_t *data\`. The length is lost.

That explains the opening bug. \`sizeof\` is evaluated by the compiler from the *type* of its operand:

- \`sizeof(frame)\` where \`frame\` is declared \`uint8_t frame[64]\` in the same scope → 64.
- \`sizeof(data)\` where \`data\` is a pointer parameter → the size of a pointer, 4.

So **every function that takes a buffer also takes its length**. The element-count idiom for a real array is
\`sizeof(arr) / sizeof(arr[0])\`.`,
    code(C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static uint32_t sum_indexed(const uint8_t *data, size_t len)
{
    uint32_t sum = 0;
    for (size_t i = 0; i < len; i++) {
        sum += data[i];
    }
    return sum;
}

static uint32_t sum_walking(const uint8_t *data, size_t len)
{
    uint32_t sum = 0;
    const uint8_t *end = data + len;      /* one past the last element */
    while (data < end) {
        sum += *data++;
    }
    return sum;
}

int main(void)
{
    uint8_t  frame[10] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    uint32_t words[4]  = { 10, 20, 30, 40 };
    uint32_t *wp = words;

    printf("%u %u\n", (unsigned)sum_indexed(frame, sizeof(frame)),
                      (unsigned)sum_walking(frame, sizeof(frame)));
    printf("elements=%zu\n", sizeof(words) / sizeof(words[0]));
    printf("byte distance of wp+1: %d\n", (int)((char *)(wp + 1) - (char *)wp));
    printf("%u %u %u\n", (unsigned)words[2], (unsigned)*(words + 2), (unsigned)2[words]);
    return 0;
}
`, 'host-tested', {
      caption: 'Prints "55 55", "elements=4", "byte distance of wp+1: 4", "30 30 30".',
      explain: [
        { lines: '17', md: '`data + len` points one element past the end. C allows you to *form* and compare this address, but not to dereference it.' },
        { lines: '19', md: '`*data++` reads the byte at the current address, then advances the pointer by one element. On a Cortex-M this is a single load instruction with post-increment.' },
        { lines: '33', md: 'Casting both pointers to `char *` measures the distance in bytes: one `uint32_t` step is 4 bytes.' },
        { lines: '34', md: '`2[words]` is `*(2 + words)`. It is legal and you should never write it; it is here only to show that indexing is addition.' },
      ] }),
    `## On hardware: there is no bounds check

When \`buf[i]\` is executed with \`i\` too large, the CPU computes the address and performs the access. What is there?

- Another variable placed next to the buffer by the linker, or the next field of the same struct. It is silently changed.
- For a local array: the saved registers and return address of the current function. That is how a stack overflow turns into a jump to the wrong place.
- An address that maps to nothing. The bus reports an error and the core takes a fault exception (HardFault or BusFault on Cortex-M, a load/store access fault on RISC-V).

The first two are far more common than the third. Bench-MCU models this faithfully: memory is a flat byte array and an
out-of-range write lands on whatever is next.`,
    { t: 'callout', kind: 'mistake', title: 'Off by one', md:
`An array of \`N\` elements has valid indices \`0\` to \`N − 1\`. The loop \`for (i = 0; i <= N; i++)\` performs \`N + 1\` iterations
and touches one element past the end. The safe shape is always \`i < N\`. For strings, remember the terminating zero byte:
a 7-character name needs an 8-byte array.` },
    { t: 'predict',
      q: 'On a 32-bit little-endian MCU, `uint16_t *p` points at address `0x2000_0010`. After `p += 3;`, what address does it hold?',
      choices: [
        { t: '0x2000_0016', ok: true, why: 'Three elements of 2 bytes each: 0x10 + 3 × 2 = 0x16.' },
        { t: '0x2000_0013', why: 'That adds 3 bytes. Pointer arithmetic counts in elements of the pointed-to type, and a `uint16_t` is 2 bytes.' },
        { t: '0x2000_001C', why: 'That would be right for a 4-byte element such as `uint32_t`. Check the size of the type this pointer refers to.' },
        { t: '0x2000_0040', why: 'Adding to a pointer is not a shift or a multiplication of the address itself; only the offset is scaled.' },
      ],
      reveal: 'The scaling is why casting a pointer to a different type changes what `+ 1` means. Byte-level work is done through `uint8_t *`.' },
    clab({
      title: 'Read: steps, sizes and bytes',
      prompt: `**Predict first.** Bench-MCU is little-endian with 4-byte pointers. Write down the seven lines, then run.`,
      readOnly: true,
      starter: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint32_t words[4] = { 0x11111111u, 0x22222222u, 0x33333333u, 0x44434241u };
    uint32_t *wp = words;
    uint8_t  *bp = (uint8_t *)words;

    printf("%d\n", (int)((uint8_t *)(wp + 1) - (uint8_t *)wp));
    printf("%d\n", (int)((bp + 1) - bp));
    printf("%X\n", *(wp + 2));
    printf("%d\n", words[3] == *(words + 3));
    printf("%c%c%c\n", bp[12], bp[13], bp[14]);
    printf("%d %d\n", (int)sizeof(words), (int)sizeof(wp));
    printf("%d\n", (int)(&words[3] - &words[0]));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint32_t words[4] = { 0x11111111u, 0x22222222u, 0x33333333u, 0x44434241u };
    uint32_t *wp = words;
    uint8_t  *bp = (uint8_t *)words;

    printf("%d\n", (int)((uint8_t *)(wp + 1) - (uint8_t *)wp));
    printf("%d\n", (int)((bp + 1) - bp));
    printf("%X\n", *(wp + 2));
    printf("%d\n", words[3] == *(words + 3));
    printf("%c%c%c\n", bp[12], bp[13], bp[14]);
    printf("%d %d\n", (int)sizeof(words), (int)sizeof(wp));
    printf("%d\n", (int)(&words[3] - &words[0]));
    return 0;
}
`,
      tests: [{ name: 'output', stdout: '4\n1\n33333333\n1\nABC\n16 4\n3\n' }],
      hints: [
        'Lines 1 and 2 ask how many *bytes* one step of each pointer type covers.',
        '`bp[12]` is the first byte of `words[3]`. On a little-endian machine the least significant byte of `0x44434241` is stored first. 0x41 is ASCII `A`.',
        'Subtracting two `uint32_t *` values gives a count of elements, not bytes.',
      ],
      explain: `One step of a \`uint32_t *\` is 4 bytes, of a \`uint8_t *\` 1 byte. \`*(wp + 2)\` is \`words[2]\`. Bytes 12, 13, 14 are 0x41, 0x42, 0x43 because the low byte comes first in memory. \`sizeof(words)\` sees the array type (16 bytes); \`sizeof(wp)\` sees a pointer (4). The pointer difference is 3 elements.`,
    }),
    clab({
      title: 'Debug: sizeof of a pointer',
      prompt: `This is the checksum from the start of the lesson. It should print \`55\` and \`300\`. Run it, explain both wrong numbers, then fix the function's interface and its callers.`,
      starter: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static uint32_t checksum(const uint8_t *data)
{
    uint32_t sum = 0;
    for (size_t i = 0; i < sizeof(data); i++) {
        sum += data[i];
    }
    return sum;
}

int main(void)
{
    uint8_t frame[10] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    uint8_t tiny[3]   = { 100, 100, 100 };

    printf("%u\n", checksum(frame));
    printf("%u\n", checksum(tiny));
    return 0;
}
`,
      solution: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static uint32_t checksum(const uint8_t *data, size_t len)
{
    uint32_t sum = 0;
    for (size_t i = 0; i < len; i++) {
        sum += data[i];
    }
    return sum;
}

int main(void)
{
    uint8_t frame[10] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    uint8_t tiny[3]   = { 100, 100, 100 };

    printf("%u\n", checksum(frame, sizeof(frame)));
    printf("%u\n", checksum(tiny, sizeof(tiny)));
    return 0;
}
`,
      tests: [{ name: 'checksums cover the whole buffer and nothing more', stdout: '55\n300\n' }],
      hints: [
        'Inside `checksum`, what is the type of `data`? What does `sizeof` return for that type on this machine?',
        'For `frame` only 1+2+3+4 is summed. For `tiny` the loop reads a fourth byte that belongs to something else.',
        'Add a `size_t len` parameter and pass `sizeof(frame)` from `main`, where `frame` is still an array.',
      ],
      explain: `\`sizeof(data)\` is the size of a pointer: 4. The first call under-reads (10 instead of 55), the second over-reads one byte past a 3-byte array, so its result depends on what the compiler placed next to \`tiny\`. \`sizeof\` knows an array's size only in the scope where the array is declared. GCC warns about this pattern with \`-Wsizeof-pointer-memaccess\` / \`-Wsizeof-array-argument\` in some forms, but not in all.`,
    }),
    clab({
      title: 'Debug: one byte too many',
      prompt: `A user record stores a name and an access level. After \`clear_name\` and \`set_name\`, the access level that was set to 3 reads back as 0. No code assigns to \`access_level\` after the first line of \`main\`.

Find the write that goes out of bounds and fix it, without changing the struct. Expected output:

\`user=dana level=3\`
\`user=root level=9\`
\`size=9\``,
      starter: C`
#include <stdint.h>
#include <stdio.h>

#define NAME_LEN 8

typedef struct {
    char    name[NAME_LEN];
    uint8_t access_level;
} user_t;

static void clear_name(user_t *u)
{
    for (int i = 0; i <= NAME_LEN; i++) {
        u->name[i] = 0;
    }
}

static void set_name(user_t *u, const char *s)
{
    int i = 0;
    while (s[i] != 0 && i < NAME_LEN - 1) {
        u->name[i] = s[i];
        i++;
    }
    u->name[i] = 0;
}

int main(void)
{
    static user_t users[2];
    users[0].access_level = 3;
    users[1].access_level = 9;
    set_name(&users[1], "root");

    clear_name(&users[0]);
    set_name(&users[0], "dana");

    printf("user=%s level=%d\n", users[0].name, users[0].access_level);
    printf("user=%s level=%d\n", users[1].name, users[1].access_level);
    printf("size=%d\n", (int)sizeof(user_t));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

#define NAME_LEN 8

typedef struct {
    char    name[NAME_LEN];
    uint8_t access_level;
} user_t;

static void clear_name(user_t *u)
{
    for (int i = 0; i < NAME_LEN; i++) {
        u->name[i] = 0;
    }
}

static void set_name(user_t *u, const char *s)
{
    int i = 0;
    while (s[i] != 0 && i < NAME_LEN - 1) {
        u->name[i] = s[i];
        i++;
    }
    u->name[i] = 0;
}

int main(void)
{
    static user_t users[2];
    users[0].access_level = 3;
    users[1].access_level = 9;
    set_name(&users[1], "root");

    clear_name(&users[0]);
    set_name(&users[0], "dana");

    printf("user=%s level=%d\n", users[0].name, users[0].access_level);
    printf("user=%s level=%d\n", users[1].name, users[1].access_level);
    printf("size=%d\n", (int)sizeof(user_t));
    return 0;
}
`,
      tests: [{ name: 'the neighbouring field and the next record survive, layout unchanged', stdout: 'user=dana level=3\nuser=root level=9\nsize=9\n' }],
      hints: [
        'Nothing assigns to `access_level`, so some other write must be landing on its byte. Which byte of the struct holds `access_level`, counted from the start of the struct?',
        'Count the iterations of the loop in `clear_name`. The last one uses `i == 8`.',
        '`<=` must be `<`. `name[8]` does not exist; that address is `access_level`.',
      ],
      explain: `\`name[8]\` is one past the end of an 8-element array, and the next byte of the struct is \`access_level\`. Nothing in the language or the CPU objects. Moving \`access_level\` in front of the name, or making the array one byte longer, does not fix the loop: the stray write then lands on the next record in the array, or the record grows and every stored copy of it changes size. That is why the test also prints the second record and \`sizeof\`. Here the overflow wrote a 0, lowering a privilege level; had it written attacker-controlled data, it would raise one. That is the whole mechanism of a buffer overflow, and the security section builds on it.`,
    }),
    clab({
      title: 'Write: search a buffer with a moving pointer',
      prompt: `Implement \`find_byte\`. It returns a pointer to the first byte equal to \`value\` among the \`n\` bytes starting at \`buf\`, or \`NULL\` if there is none. It must never read \`buf[n]\` or beyond.

\`main\` uses it to locate the \`0x7E\` frame markers in a received buffer.`,
      starter: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static const uint8_t *find_byte(const uint8_t *buf, size_t n, uint8_t value)
{
    /* TODO */
    return NULL;
}

static void report(const uint8_t *base, const uint8_t *hit)
{
    if (hit == NULL) {
        printf("none\n");
    } else {
        printf("offset %d\n", (int)(hit - base));
    }
}

int main(void)
{
    static const uint8_t rx[6] = { 0x10, 0x20, 0x7E, 0x30, 0x7E, 0x99 };

    const uint8_t *first = find_byte(rx, 5, 0x7E);
    report(rx, first);

    if (first != NULL) {
        size_t remaining = 5 - (size_t)(first + 1 - rx);
        report(rx, find_byte(first + 1, remaining, 0x7E));
    }

    report(rx, find_byte(rx, 5, 0x99));   /* 0x99 is at index 5: outside the 5 bytes */
    report(rx, find_byte(rx, 2, 0x7E));
    report(rx, find_byte(rx, 0, 0x10));
    return 0;
}
`,
      solution: C`
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static const uint8_t *find_byte(const uint8_t *buf, size_t n, uint8_t value)
{
    const uint8_t *end = buf + n;
    while (buf < end) {
        if (*buf == value) {
            return buf;
        }
        buf++;
    }
    return NULL;
}

static void report(const uint8_t *base, const uint8_t *hit)
{
    if (hit == NULL) {
        printf("none\n");
    } else {
        printf("offset %d\n", (int)(hit - base));
    }
}

int main(void)
{
    static const uint8_t rx[6] = { 0x10, 0x20, 0x7E, 0x30, 0x7E, 0x99 };

    const uint8_t *first = find_byte(rx, 5, 0x7E);
    report(rx, first);

    if (first != NULL) {
        size_t remaining = 5 - (size_t)(first + 1 - rx);
        report(rx, find_byte(first + 1, remaining, 0x7E));
    }

    report(rx, find_byte(rx, 5, 0x99));   /* 0x99 is at index 5: outside the 5 bytes */
    report(rx, find_byte(rx, 2, 0x7E));
    report(rx, find_byte(rx, 0, 0x10));
    return 0;
}
`,
      tests: [{ name: 'finds markers and respects the length', stdout: 'offset 2\noffset 4\nnone\nnone\nnone\n' }],
      hints: [
        'What is the address of the first byte you are *not* allowed to read? Can you compute it once, before the loop, and compare the moving pointer against it?',
        '`end = buf + n` is that address; loop while `buf < end`. Inside the loop compare `*buf` with `value`; return `buf` itself on a match, otherwise `buf++`.',
        'If the loop finishes, nothing matched within `n` bytes: return `NULL`. With `n == 0` the loop body must not run at all.',
      ],
      explain: `The function returns an address inside the caller's buffer, and the caller turns it back into an offset by pointer subtraction. The third call proves the bound is honoured: the value is physically present at index 5, but the caller said only 5 bytes are valid. A receive routine that searched past the valid length would be parsing stale data from an earlier frame.`,
    }),
    insertLab,
    { t: 'exercise',
      prompt: 'A function receives `uint8_t *rx` and `size_t len`, and must interpret the 4 bytes starting at offset `off` as a field. Write the condition that rejects every `off` for which the read would go out of bounds. Be careful: `off` and `len` are both `size_t`.',
      hints: [
        'The obvious condition is `off + 4 <= len`. What happens to `off + 4` when `off` is close to the maximum `size_t`?',
        '`len - 4` is also dangerous: if `len` is 2, the unsigned subtraction wraps to a huge number.',
        'Check the two things separately, in an order that makes each subtraction safe.',
      ],
      solution: '`if (len < 4 || off > len - 4) { reject; }`. The first test makes `len - 4` safe to compute; the second then compares without any addition that could wrap. The tempting `off + 4 > len` wraps for `off = 0xFFFFFFFE` (the sum is 2) and lets the read through. The defensive C lesson returns to this.',
      answer: { type: 'text', accept: ['.*len\\s*<\\s*4\\s*\\)?\\s*\\|\\|.*off\\s*>\\s*\\(?\\s*len\\s*-\\s*4.*', '.*off\\s*>=?\\s*len\\s*\\)?\\s*\\|\\|.*len\\s*-\\s*off\\s*<\\s*4.*', '.*len\\s*<\\s*4\\s*\\)?\\s*\\|\\|.*len\\s*-\\s*4\\s*\\)?\\s*<\\s*off.*'], nudge: 'Type the whole reject condition, two tests joined by `||`. Look for a form that subtracts from `len` only after checking that the subtraction cannot wrap, and never adds to `off`.' } },
    `## A harder case: two-dimensional data and type-changing casts

A display driver holds a frame buffer \`uint8_t fb[64][128]\` (64 rows of 128 bytes). \`fb[r]\` is itself an array of 128
bytes, so \`fb + 1\` advances by a whole row of 128 bytes, while \`fb[0] + 1\` advances by one byte. The same scaling rule
applies; only the element type changed.

The rule also explains a real hazard. Casting \`uint8_t *rx\` to \`uint32_t *\` to "read a word at offset 1" changes the
step size, and it creates a pointer that may not be suitably aligned for a 4-byte load. Whether that works depends on
the CPU. The alignment lesson shows what happens and what to write instead.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.5.6 (additive operators), §6.3.2.1 (array-to-pointer conversion), §6.5.2.1 (subscripting)', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'SEI CERT C: ARR30-C. Do not form or use out-of-bounds pointers or array subscripts', url: 'https://wiki.sei.cmu.edu/confluence/display/c/ARR30-C.+Do+not+form+or+use+out-of-bounds+pointers+or+array+subscripts' },
      { title: 'SEI CERT C: ARR01-C. Do not apply the sizeof operator to a pointer when taking the size of an array', url: 'https://wiki.sei.cmu.edu/confluence/display/c/ARR01-C.+Do+not+apply+the+sizeof+operator+to+a+pointer+when+taking+the+size+of+an+array' },
    ] },
  ],
  quiz: [
    { q: 'What does this print on a 32-bit MCU?', code: C`
void show(uint16_t table[8])
{
    printf("%d\n", (int)sizeof(table));
}`, kind: 'code', choices: [
      { t: '4', ok: true, why: 'An array parameter is adjusted to a pointer; the `8` is ignored by the compiler. A pointer is 4 bytes here.' },
      { t: '16', why: 'That is the size of a real `uint16_t[8]` array. A parameter declared with array syntax is a pointer, so `sizeof` measures the pointer.' },
      { t: '8', why: 'Neither the element count nor a 64-bit pointer size applies on this target.' },
      { t: '2', why: 'That would be `sizeof(table[0])`, one element.' },
    ] },
    { q: '`uint32_t *p` holds `0x2000_0000`. Which expression reads the byte at address `0x2000_0005`?', kind: 'code', choices: [
      { t: '`*((uint8_t *)p + 5)`', ok: true, why: 'Convert to a byte pointer first, so that `+ 5` advances 5 bytes, then dereference one byte.' },
      { t: '`*(uint8_t *)(p + 5)`', why: 'Here `+ 5` is applied while the pointer is still `uint32_t *`, moving 20 bytes before the cast.' },
      { t: '`*(p + 5)`', why: 'This advances five 4-byte elements and reads a whole 32-bit word at `0x2000_0014`.' },
      { t: '`p[1] >> 5`', why: 'A shift moves bits within a value. It does not select a byte by address.' },
    ] },
    { q: 'A local `char cmd[16]` is filled by a loop that runs while `i <= 16`. On a typical MCU, what is the most likely immediate effect of the final iteration?', kind: 'arch', choices: [
      { t: 'A byte next to the array on the stack is overwritten, with no error', ok: true, why: 'The CPU performs the store at `cmd + 16`, which is valid RAM belonging to another local or saved register.' },
      { t: 'The CPU raises a bounds-check exception when the index reaches 16', why: 'There is no bounds information in the generated code, and mainstream MCU cores have no such exception for ordinary RAM.' },
      { t: 'The compiler refuses to compile a loop that can run past the array', why: 'The index is a run-time value. At best some compilers warn in simple cases with optimisation enabled.' },
      { t: 'The write is ignored because the array is already full', why: 'Arrays have no "full" state. A store instruction to a RAM address always stores.' },
    ] },
    { q: 'Why is `const uint8_t *end = buf + len;` followed by `while (p < end)` a valid loop bound, even though `end` points outside the array?', kind: 'concept', choices: [
      { t: 'C permits forming and comparing a one-past-the-end pointer, but not dereferencing it', ok: true, why: 'The one-past-the-end address is explicitly allowed for exactly this idiom.' },
      { t: 'Because reading one element past the end is harmless on a microcontroller', why: 'Reading it is undefined behaviour. The loop is correct only because it never dereferences `end`.' },
      { t: 'Because every array has a hidden terminator element after the last one, like a string', why: 'Only string literals get a terminating zero. Ordinary arrays have nothing after the last element that belongs to them.' },
      { t: 'It is not valid; it works only by accident on common compilers', why: 'This is one of the few guarantees the standard makes about addresses outside an object.' },
    ] },
    { q: 'A function needs the number of elements in `static const uint16_t lut[] = {…};` defined in the same file. Which is correct?', kind: 'code', choices: [
      { t: '`sizeof(lut) / sizeof(lut[0])`', ok: true, why: 'In the scope where `lut` is an array, `sizeof(lut)` is the total size in bytes; dividing by the element size gives the count.' },
      { t: '`sizeof(lut)`', why: 'That is the size in bytes. For 2-byte elements it is twice the element count, so a loop would run off the end.' },
      { t: '`strlen(lut)`', why: '`strlen` counts bytes up to the first zero byte in a `char` string. A lookup table may contain zeros or none at all.' },
      { t: '`sizeof(lut) / sizeof(&lut[0])`', why: 'Taking the address of the first element gives a pointer, and `sizeof` then reports the pointer size.' },
    ] },
  ],
};

/* ------------------------------------------------------------------ lesson 4 */
const bitwise = {
  id: 'ec-bitwise',
  title: 'Bitwise operations',
  minutes: 50,
  summary: 'AND, OR, XOR, NOT and shifts on fixed-width values, the traps with signed operands, and reading hexadecimal without a calculator.',
  skills: ['ec-bitwise-ops', 'ec-hex-fluency'],
  blocks: [
    `## The problem: one number, sixteen switches

The Bench-MCU register \`GPIO_OUT\` controls sixteen pins with one 32-bit number: bit 0 drives pin 0, bit 5 drives pin 5.
A UART status register packs "transmitter ready", "byte available" and "overrun" into bits 0, 1 and 2. Hardware is
described bit by bit, so firmware needs operators that work bit by bit. Arithmetic (\`+ 32\` to turn on pin 5?) breaks as
soon as the bit is already set.

## Hexadecimal: the notation that shows the bits

One hex digit is exactly four bits, so a 32-bit register is eight hex digits and you can see each group of four pins at a
glance. Memorise the sixteen patterns; everything else follows.

| Hex | Binary | Hex | Binary | Hex | Binary | Hex | Binary |
|---|---|---|---|---|---|---|---|
| 0 | 0000 | 4 | 0100 | 8 | 1000 | C | 1100 |
| 1 | 0001 | 5 | 0101 | 9 | 1001 | D | 1101 |
| 2 | 0010 | 6 | 0110 | A | 1010 | E | 1110 |
| 3 | 0011 | 7 | 0111 | B | 1011 | F | 1111 |

Single bits are worth knowing by sight: bit 0 = \`0x01\`, bit 4 = \`0x10\`, bit 5 = \`0x20\`, bit 7 = \`0x80\`, bit 8 = \`0x100\`,
bit 15 = \`0x8000\`, bit 31 = \`0x8000_0000\`. To find the value of bit *n*: the hex digit is at position \`n / 4\` from the
right, and its value is \`1 << (n % 4)\`, that is 1, 2, 4 or 8.

## The six operators

Each acts on every bit position independently.

| Operator | Name | Each result bit is 1 when… | Used to |
|---|---|---|---|
| \`a & b\` | AND | both bits are 1 | keep selected bits, zero the rest; test a bit |
| \`a | b\` | OR | at least one bit is 1 | force selected bits to 1 |
| \`a ^ b\` | XOR | the bits differ | flip selected bits; compare |
| \`~a\` | NOT | the bit is 0 | build the inverse of a mask |
| \`a << n\` | left shift | — | move a value up to a bit position; multiply by 2ⁿ |
| \`a >> n\` | right shift | — | bring a field down to bit 0; divide unsigned by 2ⁿ |

Do not confuse them with the logical operators \`&&\`, \`||\` and \`!\`, which treat each operand as one true/false value:
\`0x04 & 0x01\` is 0, \`0x04 && 0x01\` is 1.

A **mask** is a constant with 1s in the positions you care about. \`1u << n\` is the mask for bit *n*; \`0xFu << 4\` is the
mask for the four bits 4 to 7.`,
    code(C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 0xA5;                      /* 1010 0101 */

    printf("%02X\n", a & 0x0F);            /* 0000 0101  keep low nibble   */
    printf("%02X\n", a | 0x0F);            /* 1010 1111  set low nibble    */
    printf("%02X\n", a ^ 0xFF);            /* 0101 1010  flip every bit    */
    printf("%02X\n", (uint8_t)(a << 4));   /* 0101 0000  top nibble lost   */
    printf("%02X\n", a >> 4);              /* 0000 1010  high nibble down  */
    printf("%X\n", (unsigned)~a);          /* NOT happens at int width     */
    printf("%02X\n", (uint8_t)~a);         /* 0101 1010  after truncation  */
    printf("%d\n", (a & 0x04) != 0);       /* is bit 2 set?                */
    return 0;
}
`, 'host-tested', {
      caption: 'Prints 05, AF, 5A, 50, 0A, FFFFFF5A, 5A, 1.',
      explain: [
        { lines: '11', md: '`a << 4` is computed as `int` and equals `0xA50`. The cast to `uint8_t` keeps the low byte. Without the cast, `%02X` would print `A50`.' },
        { lines: '13', md: '`a` is promoted to the `int` value `0x000000A5` *before* `~` is applied, so all 24 upper bits become 1. This matters whenever you compare `~x` with an 8- or 16-bit value.' },
        { lines: '15', md: 'AND with a single-bit mask gives either 0 or the mask value (here 4), never 1. Compare with `!= 0` to obtain a clean true/false.' },
      ] }),
    `## Shifts: three rules that prevent undefined behaviour

1. **Shift unsigned values.** Right-shifting a negative signed value is implementation-defined (GCC and Clang copy the sign bit, an *arithmetic* shift). Left-shifting a negative value is undefined behaviour, and so is left-shifting a non-negative signed value when the mathematical result does not fit in the type, which includes moving a 1 into the sign bit (C11 §6.5.7).
2. **The shift count must be non-negative and less than the width of the promoted left operand.** \`x << 32\` on a 32-bit \`x\` is undefined, not zero (a Cortex-M and an x86 give different answers for it). The usual victim is a computed mask such as \`(1u << nbits) - 1\` when \`nbits\` can be 32.
3. **The literal \`1\` is a signed \`int\`.** \`1 << 31\` moves a 1 into the sign bit: undefined behaviour. Write \`1u << 31\`. In mask definitions, always put the \`u\` suffix: \`(1u << n)\`.

Promotion adds a fourth, subtle trap: a \`uint8_t\` operand is promoted to **signed** \`int\` before shifting.`,
    code(C`
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t  msb = 0x80;
    uint32_t ok  = (uint32_t)msb << 24;         /* unsigned shift: 0x80000000   */
    uint64_t good = (uint64_t)msb << 24;        /* widen first                  */
    int32_t  neg = -8;

    printf("%08" PRIX32 "\n", ok);
    printf("%016" PRIX64 "\n", good);
    printf("%d\n", neg >> 1);                   /* implementation-defined: GCC gives -4 */
    printf("%" PRIX32 "\n", (uint32_t)neg >> 28); /* logical shift of the bit pattern  */
    return 0;
}
`, 'host-tested', {
      caption: 'Prints 80000000, 0000000080000000, -4, F. Written without the casts, `msb << 24` is a signed-int shift into the sign bit, and assigning that negative int to a uint64_t gives FFFFFFFF80000000.',
      explain: [
        { lines: '8', md: 'The cast makes the left operand a 32-bit unsigned value before the shift, so bit 7 can move to bit 31 without touching a sign bit.' },
        { lines: '14', md: 'An arithmetic right shift keeps the sign: `1111…1000` becomes `1111…1100`. The C standard lets a compiler choose a logical shift instead. GCC documents that it sign-extends.' },
        { lines: '15', md: 'After the cast to unsigned, zeros are shifted in from the left, so only the top four bits (all 1) remain.' },
      ] }),
    { t: 'callout', kind: 'mistake', title: 'Precedence: == binds tighter than &', md:
`\`if (status & 0x04 == 0x04)\` is parsed as \`status & (0x04 == 0x04)\`, which is \`status & 1\`. Shifts bind tighter than \`&\`
but looser than \`+\`: \`x & 0xF0 >> 4\` is \`x & 0x0F\`, and \`1 << n + 1\` is \`1 << (n + 1)\`. Parenthesise every bitwise
sub-expression. \`-Wall\` includes \`-Wparentheses\`, which reports the first form.` },
    { t: 'predict',
      q: 'A status byte holds `0x5C`. What is `(status >> 2) & 0x07`?',
      choices: [
        { t: '7', ok: true, why: '`0x5C` is `0101 1100`. Shifted right by 2 it is `0001 0111`; the low three bits are `111`.' },
        { t: '4', why: 'That is `0x5C & 0x07` without the shift. The shift happens first because of the parentheses.' },
        { t: '0x17', why: 'That is the value after the shift alone. The AND then discards everything above bit 2.' },
        { t: '0x1C', why: 'That would be masking with `0x1C` in place, leaving the field at its original position instead of moving it down to bit 0.' },
      ],
      reveal: 'Shift-then-mask extracts a multi-bit field as a small number. The next lesson uses it on real registers.' },
    clab({
      title: 'Read: operators at int width',
      prompt: `**Predict first.** Write each value in binary if it helps. Nine lines; note which ones are affected by promotion to \`int\`.`,
      readOnly: true,
      starter: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 0x3C;
    uint8_t b = 0x0F;

    printf("%02X\n", a & b);
    printf("%02X\n", a | b);
    printf("%02X\n", a ^ b);
    printf("%X\n", ~b);
    printf("%02X\n", (uint8_t)~b);
    printf("%X\n", a << 4);
    printf("%02X\n", (uint8_t)(a << 4));
    printf("%X\n", 1u << 31);
    printf("%X\n", 0x80000000u >> 31);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

int main(void)
{
    uint8_t a = 0x3C;
    uint8_t b = 0x0F;

    printf("%02X\n", a & b);
    printf("%02X\n", a | b);
    printf("%02X\n", a ^ b);
    printf("%X\n", ~b);
    printf("%02X\n", (uint8_t)~b);
    printf("%X\n", a << 4);
    printf("%02X\n", (uint8_t)(a << 4));
    printf("%X\n", 1u << 31);
    printf("%X\n", 0x80000000u >> 31);
    return 0;
}
`,
      tests: [{ name: 'output', stdout: '0C\n3F\n33\nFFFFFFF0\nF0\n3C0\nC0\n80000000\n1\n' }],
      hints: [
        '`0x3C` is `0011 1100` and `0x0F` is `0000 1111`. Line the bits up in columns.',
        '`~b` is applied after `b` has been promoted to a 32-bit `int`. How many 1 bits does the result have?',
        '`a << 4` is also an `int`: nothing falls off the top until you cast back to 8 bits.',
      ],
      explain: `AND keeps the overlap (\`0C\`), OR the union (\`3F\`), XOR the difference (\`33\`). \`~b\` is \`0xFFFFFFF0\` because the operand was widened first; the cast recovers \`F0\`. \`a << 4\` is \`0x3C0\` as an \`int\`, \`C0\` as a byte. The last two lines show bit 31 reached safely with an unsigned operand.`,
    }),
    clab({
      title: 'Write: count and reverse bits',
      prompt: `Implement two small bit utilities using only bitwise operators and loops.

- \`popcount32(x)\` returns the number of 1 bits in \`x\`. (UART parity and Hamming distance are built on this.)
- \`reverse8(x)\` returns \`x\` with its bit order reversed: bit 0 becomes bit 7, bit 1 becomes bit 6, and so on. (Needed when a device sends least-significant-bit first.)`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

static int popcount32(uint32_t x)
{
    /* TODO */
    return 0;
}

static uint8_t reverse8(uint8_t x)
{
    /* TODO */
    return x;
}

int main(void)
{
    printf("%d %d %d %d\n", popcount32(0), popcount32(0x80000001u),
           popcount32(0xFFu), popcount32(0xFFFFFFFFu));
    printf("%02X %02X %02X %02X\n", reverse8(0x01), reverse8(0xF0),
           reverse8(0xA6), reverse8(0xFF));
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

static int popcount32(uint32_t x)
{
    int count = 0;
    while (x != 0) {
        count += (int)(x & 1u);
        x >>= 1;
    }
    return count;
}

static uint8_t reverse8(uint8_t x)
{
    uint8_t out = 0;
    for (int i = 0; i < 8; i++) {
        out = (uint8_t)(out << 1);
        out |= (uint8_t)(x & 1u);
        x >>= 1;
    }
    return out;
}

int main(void)
{
    printf("%d %d %d %d\n", popcount32(0), popcount32(0x80000001u),
           popcount32(0xFFu), popcount32(0xFFFFFFFFu));
    printf("%02X %02X %02X %02X\n", reverse8(0x01), reverse8(0xF0),
           reverse8(0xA6), reverse8(0xFF));
    return 0;
}
`,
      tests: [{ name: 'popcount and bit reversal', stdout: '0 2 8 32\n80 0F 65 FF\n' }],
      hints: [
        'Which expression gives you only the lowest bit of `x`, and which operation brings the next bit down into that position? For the reversal: if you take bits from the bottom of `x`, at which end of the result must each one be inserted?',
        '`x & 1u` is the lowest bit; `x >>= 1` discards it and brings the next one down. For `popcount32`, loop while `x != 0`, adding the low bit each time. Because `x` is unsigned, zeros shift in at the top and the loop ends.',
        'For `reverse8`, run exactly 8 times: shift `out` left by one, OR in the low bit of `x`, shift `x` right by one.',
      ],
      explain: `Both functions consume the input from the bottom with \`& 1\` and \`>> 1\`. \`reverse8\` builds its output from the other end, so the first bit taken ends up at the top after eight left shifts. The loop in \`popcount32\` terminates only because \`x\` is unsigned: with a negative signed value and an arithmetic shift, 1s would be shifted in for ever.`,
    }),
    clab({
      title: 'Debug: the status decoder',
      prompt: `A sensor returns one status byte: bit 2 is an error flag and bits 5:4 hold a 2-bit mode number. \`decode\` prints wrong results for most inputs although every constant is correct.

Expected output:

\`error mode=2\`, \`ok mode=1\`, \`error mode=3\`, \`ok mode=0\` (one per line).`,
      starter: C`
#include <stdint.h>
#include <stdio.h>

#define ST_ERROR      0x04u
#define ST_MODE_MASK  0x30u
#define ST_MODE_SHIFT 4

static void decode(uint8_t status)
{
    if (status & ST_ERROR == ST_ERROR) {
        printf("error ");
    } else {
        printf("ok ");
    }

    uint8_t mode = status & ST_MODE_MASK >> ST_MODE_SHIFT;
    printf("mode=%d\n", mode);
}

int main(void)
{
    decode(0x24);
    decode(0x11);
    decode(0x35);
    decode(0x01);
    return 0;
}
`,
      solution: C`
#include <stdint.h>
#include <stdio.h>

#define ST_ERROR      0x04u
#define ST_MODE_MASK  0x30u
#define ST_MODE_SHIFT 4

static void decode(uint8_t status)
{
    if ((status & ST_ERROR) == ST_ERROR) {
        printf("error ");
    } else {
        printf("ok ");
    }

    uint8_t mode = (uint8_t)((status & ST_MODE_MASK) >> ST_MODE_SHIFT);
    printf("mode=%d\n", mode);
}

int main(void)
{
    decode(0x24);
    decode(0x11);
    decode(0x35);
    decode(0x01);
    return 0;
}
`,
      tests: [{ name: 'flag and field are decoded', stdout: 'error mode=2\nok mode=1\nerror mode=3\nok mode=0\n' }],
      hints: [
        'Where does the compiler put the implied parentheses in `status & ST_ERROR == ST_ERROR` and in `status & ST_MODE_MASK >> ST_MODE_SHIFT`? Look up the precedence of `==`, `>>` and `&` before answering.',
        '`==` and `>>` both bind tighter than `&`. The `if` is really `status & (ST_ERROR == ST_ERROR)`, i.e. `status & 1`: it tests bit 0.',
        'The mode line is really `status & (0x30 >> 4)`, i.e. `status & 3`. Write `(status & ST_MODE_MASK) >> ST_MODE_SHIFT`.',
      ],
      explain: `Two precedence bugs. The flag test examined bit 0 instead of bit 2, and the field extraction masked the low two bits instead of bits 5:4. C's precedence for \`&\`, \`^\` and \`|\` is lower than for comparisons, a historical accident its designers later acknowledged. Parenthesise every mask operation and build with \`-Wall\`.`,
    }),
    { t: 'exercise',
      prompt: 'Without a calculator: a 32-bit register reads `0x0000_A040`. Which bit numbers are set?',
      hints: [
        'Write the non-zero hex digits in binary: `A` = 1010, `4` = 0100.',
        'The rightmost digit covers bits 3:0, the next 7:4, then 11:8, then 15:12.',
      ],
      solution: 'Digit `4` is in the second position (bits 7:4) and is `0100`, so bit 6 is set. Digit `A` is in the fourth position (bits 15:12) and is `1010`, so bits 15 and 13 are set. Answer: bits 6, 13 and 15.',
      answer: { type: 'text', accept: ['^\\D*6\\D+13\\D+15\\D*$', '^\\D*15\\D+13\\D+6\\D*$'], nudge: 'List three bit numbers. Convert each non-zero hex digit to four binary digits and count positions from 0 at the right.' } },
    `## A harder case: assembling a multi-byte value

A sensor sends a 24-bit reading as three bytes, most significant first. On an MCU with a **16-bit \`int\`** (an AVR, an
MSP430), \`uint32_t v = (b[0] << 16) | (b[1] << 8) | b[2];\` is wrong twice: \`b[0] << 16\` shifts a 16-bit \`int\` by its
full width (undefined), and \`b[1] << 8\` can move a 1 into the sign bit. The portable form casts each byte to the
destination width *before* shifting:

\`uint32_t v = ((uint32_t)b[0] << 16) | ((uint32_t)b[1] << 8) | (uint32_t)b[2];\`

On a 32-bit MCU the uncast version happens to work for three bytes and fails for the fourth (\`b[0] << 24\` with the top
bit set). Write the casts every time and the code is correct on both.`,
    { t: 'refs', items: [
      { title: 'C11 draft N1570 §6.5.7 (bitwise shift operators), §6.5.3.3 (unary ~), §6.5.10–6.5.12', url: 'https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1570.pdf' },
      { title: 'GCC manual: integers implementation — right shift of negative values', url: 'https://gcc.gnu.org/onlinedocs/gcc/Integers-implementation.html' },
      { title: 'SEI CERT C: INT34-C. Do not shift an expression by a negative number of bits or by greater than or equal to the number of bits that exist in the operand', url: 'https://wiki.sei.cmu.edu/confluence/display/c/INT34-C.+Do+not+shift+an+expression+by+a+negative+number+of+bits+or+by+greater+than+or+equal+to+the+number+of+bits+that+exist+in+the+operand' },
    ] },
  ],
  quiz: [
    { q: 'Which expression is the mask for bits 11 down to 8 of a 32-bit register?', kind: 'code', choices: [
      { t: '`0xFu << 8`', ok: true, why: 'Four 1 bits (`0xF`) moved up so the lowest sits at bit 8: `0x0000_0F00`.' },
      { t: '`0x8u << 11`', why: 'That is a single bit, at position 14. A four-bit field needs four adjacent 1s.' },
      { t: '`0xFu << 11`', why: 'The shift count is the position of the field\'s *lowest* bit. This mask covers bits 14:11.' },
      { t: '`(1u << 11) | (1u << 8)`', why: 'That sets only the two end bits and leaves bits 10 and 9 out of the mask.' },
    ] },
    { q: 'Why should a mask for bit 31 be written `1u << 31` rather than `1 << 31`?', kind: 'concept', choices: [
      { t: '`1` is a signed `int`, and shifting a 1 into its sign bit is undefined', ok: true, why: 'The unsigned literal has no sign bit, so every one of its 32 bit positions is an ordinary value bit.' },
      { t: 'Because `1 << 31` evaluates to 0 when `int` is 32 bits wide', why: 'On common compilers it produces the bit pattern you wanted, which is why the bug goes unnoticed. The standard gives no guarantee.' },
      { t: 'The `u` suffix makes the constant 64 bits wide, so the shift cannot overflow', why: '`u` changes signedness only. The constant stays the width of `unsigned int`.' },
      { t: 'It is only a style convention; both forms compile to the same thing', why: 'There is a real semantic difference: one form is fully defined, the other is not, and sanitizers report it.' },
    ] },
    { q: '`uint8_t x = 0x0F;` Which condition is true?', kind: 'code', choices: [
      { t: '`(uint8_t)~x == 0xF0`', ok: true, why: 'The cast truncates the promoted result `0xFFFFFFF0` back to `0xF0` before comparing.' },
      { t: '`~x == (uint8_t)0xF0`', why: '`~` is applied after promotion to `int`, producing `0xFFFFFFF0`, which is not equal to 240.' },
      { t: '`!x == 0xF0`', why: '`!` is logical NOT: it yields 0 or 1, never a bit pattern.' },
      { t: '`-x == 0xF0`', why: 'Arithmetic negation gives −15. Two\'s complement negation is "invert, then add one", not inversion alone.' },
    ] },
    { q: 'A 12-bit ADC result arrives left-aligned in a 16-bit word (bits 15:4). Which expression gives the sample as a number 0–4095?', kind: 'code', choices: [
      { t: '`raw >> 4`', ok: true, why: 'Shifting right by 4 moves bit 4 to bit 0. With an unsigned 16-bit `raw`, zeros fill the top.' },
      { t: '`raw & 0xFFF0`', why: 'This clears the unused low bits but leaves the value 16 times too large.' },
      { t: '`raw << 4`', why: 'This moves the sample further up and, once stored in 16 bits, throws away its top four bits.' },
      { t: '`raw / 4`', why: 'Dividing by 4 is a shift by 2. Moving down four positions is a division by 16.' },
    ] },
    { q: 'What is `0x04 && 0x02`, and what is `0x04 & 0x02`?', kind: 'concept', choices: [
      { t: '1 and 0', ok: true, why: 'Logical AND asks "are both non-zero?" and yields 1. Bitwise AND compares bit positions, and these two values share none.' },
      { t: '0 and 0', why: 'Logical operators do not look at individual bits. Any non-zero operand counts as true.' },
      { t: '1 and 6', why: 'A result of 6 would be the bitwise OR of the two values.' },
      { t: '6 and 0', why: '`&&` always produces 0 or 1, never a combination of the operands\' bits.' },
    ] },
    { q: 'What does `x ^ x` evaluate to for any unsigned `x`, and why is XOR used for toggling?', kind: 'concept', choices: [
      { t: '0; XOR with 1 flips a bit and XOR with 0 leaves it unchanged', ok: true, why: 'Each bit XORed with itself is 0. With a mask, exactly the masked bits are inverted.' },
      { t: '`x`; XOR copies the bits that are set', why: 'Copying the set bits describes OR or AND with itself. XOR reports where two operands *differ*.' },
      { t: 'All ones; XOR sets every bit that appears in either of its operands', why: 'That describes OR followed by something else. Identical operands never differ in any position.' },
      { t: '`2 * x`; XOR adds without carry', why: 'XOR is addition without carry, but adding without carry cancels identical bits rather than doubling them.' },
    ] },
  ],
};

export default [cModel, pointers, ptrArith, bitwise];
