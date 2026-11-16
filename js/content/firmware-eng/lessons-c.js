// Firmware engineering, part C: build pipeline and debugging tools, cross toolchains, testing.
// Tool output quoted in these lessons was produced with GCC 13.3 / Binutils 2.42 on x86-64 Linux in this repository.
import { clSanitizerFix, clParseTests } from './clabs.js';

const C = String.raw;

/* ============================================================== 7. Compile, link, debug */
const build = {
  id: 'fw-build', title: 'Compilation, linking and the tools that inspect the result', minutes: 75,
  summary: 'What each build stage produces, how to read object files, symbols, sections and the map file, why code behaves differently when optimised, and how warnings, static analysis and sanitizers find bugs before hardware does.',
  skills: ['fw-toolchain-inspect', 'fw-link-errors', 'fw-sanitizers'],
  blocks: [
    `## The problem

Three messages every firmware developer meets in their first month:

\`\`\`
undefined reference to \`hal_uart_write'
multiple definition of \`counter'; first defined here
region \`RAM' overflowed by 1200 bytes
\`\`\`

None of them comes from the compiler, and none points at a line of your C. They come from the **linker**, a different program with a different view of your code: it sees *symbols* and *sections*, not statements. If you do not know what it is doing, these messages are riddles. Once you do, each one tells you exactly what is wrong.

This lesson uses the host compiler on real files so you can run every command yourself. The same tools exist for each target with a prefix: \`arm-none-eabi-nm\`, \`riscv32-esp-elf-objdump\` and so on.`,

    `## Four stages

"Compiling" is four programs run in sequence. \`gcc\` is a driver that calls them.

| Stage | Tool | Input → output | Stop here with |
|---|---|---|---|
| 1. Preprocess | \`cpp\` | \`.c\` + headers → one expanded C file (a *translation unit*) | \`gcc -E\` |
| 2. Compile | \`cc1\` | translation unit → assembly text | \`gcc -S\` |
| 3. Assemble | \`as\` | assembly → **object file** \`.o\` (machine code with holes) | \`gcc -c\` |
| 4. Link | \`ld\` | objects + libraries + linker script → executable (**ELF**) | (default) |

Take this file:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'stages.c',
      code: C`#include <stdint.h>
#define LED_PIN 5u
#define BIT(n) (1u << (n))

uint32_t led_mask(void)
{
    return BIT(LED_PIN);
}` },
    `**Preprocess** (\`gcc -E -P stages.c\`): after the contents of \`<stdint.h>\`, the function has become

\`\`\`c
uint32_t led_mask(void)
{
    return (1u << (5u));
}
\`\`\`

Macros are gone: the compiler proper never sees \`LED_PIN\` or \`BIT\`. This is why a macro error is reported at the place it was *used*, and why \`-E\` is the tool for debugging a macro.

**Compile** (\`gcc -O1 -S\`): the function body in x86-64 assembly is

\`\`\`
led_mask:
	movl	$32, %eax
	ret
\`\`\`

The shift was evaluated at compile time: \`1 << 5\` is the constant 32. On a Cortex-M the same source becomes \`movs r0, #32\` / \`bx lr\`.

**Assemble** (\`gcc -c\`), then inspect the object:

\`\`\`
$ file stages.o
stages.o: ELF 64-bit LSB relocatable, x86-64, version 1 (SYSV), not stripped
$ nm stages.o
0000000000000000 T led_mask
\`\`\`

*Relocatable* means the code has no final address yet: \`led_mask\` is at offset 0 of this file's \`.text\` section. The linker decides where it really goes.`,

    `## Object files: sections and symbols

An object file is a set of **sections** plus a **symbol table**.

| Section | Contains | On an MCU it lives in |
|---|---|---|
| \`.text\` | machine code | flash |
| \`.rodata\` | \`const\` data, string literals | flash |
| \`.data\` | variables with a non-zero initial value | RAM, **with a copy of the initial values in flash** |
| \`.bss\` | variables that start as zero | RAM (occupies no space in the image) |

A file with one variable of each kind:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'sect.c: where each object ends up',
      code: C`#include <stdint.h>
#include <stdio.h>

uint32_t calibration = 1234;           /* initialised, writable  -> .data   */
uint32_t sample_count;                 /* zero-initialised       -> .bss    */
uint8_t rx_buffer[1024];               /* zero-initialised       -> .bss    */
const uint16_t crc_table[4] = { 0x0000, 0x1021, 0x2042, 0x3063 };   /* read-only -> .rodata */

int main(void)
{
    rx_buffer[0] = (uint8_t)calibration;
    sample_count += crc_table[1] + rx_buffer[0];
    printf("%lu\n", (unsigned long)sample_count);
    return 0;
}` },
    `Compiled with \`gcc -std=c11 -O1 -c sect.c\`:

\`\`\`
$ size sect.o
   text	   data	    bss	    dec	    hex	filename
    169	      4	   1028	   1201	    4b1	sect.o
$ nm -S sect.o
0000000000000000 r .LC0
                 U __printf_chk
0000000000000000 0000000000000004 D calibration
0000000000000000 0000000000000008 R crc_table
0000000000000000 000000000000004c T main
0000000000000000 0000000000000400 B rx_buffer
0000000000000400 0000000000000004 B sample_count
\`\`\`

Reading \`size\`: note that \`size\`'s "text" column counts \`.text\` **plus** \`.rodata\` (everything that goes to flash and is read-only; on this PC build it also includes the unwind tables in \`.eh_frame\`, which a typical MCU build does not have); "data" is the 4 bytes of \`calibration\`; "bss" is 1024 + 4. On a microcontroller:

- **Flash used** = text + data (code, constants, and the initial values of \`.data\`).
- **RAM used** = data + bss, plus stack and heap, which \`size\` does not show.

Reading \`nm\`: each line is address (or offset), size with \`-S\`, a **type letter** and the name.

| Letter | Meaning |
|---|---|
| \`T\` / \`t\` | code in \`.text\` |
| \`D\` / \`d\` | initialised data |
| \`B\` / \`b\` | zero-initialised data |
| \`R\` / \`r\` | read-only data |
| \`U\` | **undefined**: used here, defined somewhere else |

**Upper case = global** (external linkage: visible to other object files). **Lower case = local** (\`static\`: invisible to the linker's cross-file matching).`,
    { t: 'callout', kind: 'hw', title: 'Why .data needs start-up code', md: `\`calibration\` must be writable, so it lives in RAM, but RAM is random at power-on. Its initial value 1234 is stored in flash, and **start-up code that runs before \`main\`** copies the whole \`.data\` image from flash to RAM and fills \`.bss\` with zeros. On a PC the operating system's loader does this. On a microcontroller it is a dozen lines in the startup file, driven by addresses the linker script exports. If that code is missing or the linker script is wrong, initialised globals contain garbage while everything else looks fine, a classic bring-up bug (see the troubleshooting list).` },

    `### Symbols across files

Here is \`nm\` on the application module of this section's example (\`examples/firmware-eng/src/app.c\`, compiled alone with \`-O1\`), trimmed of string-literal labels:

\`\`\`
                 U __stack_chk_fail
000000000000002d T app_init
0000000000000346 T app_lock_state
000000000000008d T app_on_rx_byte
00000000000000aa T app_poll
0000000000000351 T app_rx_dropped
                 U hal_gpio_write
                 U hal_init
                 U hal_millis
                 U hal_uart_read
                 U hal_uart_write
                 U line_feed
                 U line_init
                 U lock_dispatch
                 U lock_init
                 U lock_latch_open
                 U lock_state_name
                 U rb_get
                 U rb_init
                 U rb_put
0000000000000000 t reply
0000000000000020 b s_line
0000000000000000 b s_lock
0000000000000050 b s_rx
0000000000000080 b s_rx_storage
                 U strcmp
                 U strlen
                 U strncmp
\`\`\`

This one listing is the module's architecture, verified by a tool:

- Five \`T\` symbols: exactly the public functions declared in \`app.h\`.
- \`reply\` is \`t\` and the four state variables are \`b\`: \`static\`, private to this file.
- The \`U\` list is everything the module depends on: the HAL, the three services, three C library functions, and \`__stack_chk_fail\`, which the compiler itself added for this host's default stack protector. There is no \`U\` for anything in a layer above.
- \`handle_line\` and \`pin_matches\` do not appear at all: they were \`static\` and the optimiser inlined them into \`app_poll\`.

The **linker's job** is to match every \`U\` with exactly one definition, place all sections at final addresses, and patch the holes (*relocations*) in the code with those addresses.`,

    { t: 'predict', q: 'The Makefile links `app.o`, `ringbuf.o`, `line_rx.o` and `lock.o` into a program but, by mistake, no `hal_*.c` file. Which stage fails, and how?',
      choices: [
        { t: 'The linker, with "undefined reference" for each `hal_` function', ok: true, why: 'Each file compiled fine on its own, because `hal.h` declared the functions. Only the linker tries to find their definitions, and none of the objects has them.' },
        { t: 'The compiler, when it reaches the first `hal_` call in `app.c`', why: 'The compiler only needs declarations, which `hal.h` provides. It has no knowledge of which other files will be linked.' },
        { t: 'Nothing fails: the unresolved calls are linked as empty functions and do nothing at run time', why: 'A call needs a target address. With no definition there is no address to patch in, and the linker refuses to produce an image.' },
        { t: 'The preprocessor, because `hal.h` has no matching `.c` file', why: 'The preprocessor only pastes text; it has no notion of a header needing an implementation.' },
      ],
      reveal: 'This is the real output of that link in this repository:\n\n```\n/usr/bin/ld: /tmp/cc7WfsJC.o: in function `reply\':\napp.c:(.text+0x15): undefined reference to `hal_uart_write\'\n/usr/bin/ld: /tmp/cc7WfsJC.o: in function `app_init\':\napp.c:(.text+0x36): undefined reference to `hal_init\'\napp.c:(.text+0x75): undefined reference to `hal_gpio_write\'\n/usr/bin/ld: /tmp/cc7WfsJC.o: in function `app_poll\':\napp.c:(.text+0xcb): undefined reference to `hal_millis\'\napp.c:(.text+0xe7): undefined reference to `hal_uart_read\'\ncollect2: error: ld returned 1 exit status\n```\n\nRead it as: *in object file X, in function Y, I need symbol Z and nobody defines it.* The fix is never in the line of C; it is in what gets linked.' },

    `### The two classic link errors

Three small files reproduce both:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'shared.h, multi_a.c and multi_b.c: deliberately wrong. The link fails with the output below.',
      code: C`/* ---- shared.h ---- */
#ifndef SHARED_H
#define SHARED_H
int counter = 0;      /* a DEFINITION in a header: every .c file that includes it gets its own */
int helper(void);
#endif

/* ---- multi_a.c ---- */
#include "shared.h"
int main(void) { counter++; return helper(); }

/* ---- multi_b.c ---- */
#include "shared.h"
static int helper_impl(void) { return counter; }
int other(void) { return helper_impl(); }` },
    `\`\`\`
$ gcc -std=c11 -Wall -Wextra multi_a.c multi_b.c -o multi
/usr/bin/ld: /tmp/ccYb98KE.o:(.bss+0x0): multiple definition of \`counter'; /tmp/ccf39Pyy.o:(.bss+0x0): first defined here
/usr/bin/ld: /tmp/ccf39Pyy.o: in function \`main':
multi_a.c:(.text+0x18): undefined reference to \`helper'
collect2: error: ld returned 1 exit status
\`\`\`

**Multiple definition.** \`int counter = 0;\` in a header is a *definition*: it creates the variable. Both \`.c\` files include the header, so both objects contain a global \`counter\` and the linker has two candidates. The rule:

- In the header: \`extern int counter;\` (a **declaration**: "this exists somewhere").
- In exactly one \`.c\` file: \`int counter = 0;\` (the **definition**).

Better still, make it \`static\` in one file and export a function, as the previous lesson argued.

**Undefined reference.** \`helper\` is declared in the header and called in \`multi_a.c\`, but no file defines a function with that exact name. \`multi_b.c\` has \`helper_impl\`, and it is \`static\`, so even with the right name the linker could not see it. Causes of an undefined reference, in order of likelihood: the file that defines it is not in the build; the name is misspelled or the function is \`static\`; a library is missing from the link line or listed before the objects that need it; or a C function is being called from C++ without \`extern "C"\`.`,
    { t: 'exercise', prompt: 'A project has `uint8_t rx_buf[64];` written in `uart.h`, and `uart.h` is included by `uart.c`, `main.c` and `cli.c`. Which linker error results? Answer with the two-word error name.',
      hints: ['Is that line a declaration or a definition?', 'How many object files will contain a global symbol named `rx_buf`?'],
      answer: { type: 'text', accept: ['multiple definitions?( of.*)?', 'duplicate (symbol|definition)s?'], nudge: 'Think about how many objects define the same global.' },
      solution: 'A **multiple definition** error for `rx_buf`: three objects each define it. (Older GCC versions defaulted to `-fcommon`, which silently merged such tentative definitions; GCC 10 and later default to `-fno-common` and report the error. Code that "used to link" may depend on the old behaviour.) Fix: `extern uint8_t rx_buf[64];` in the header and the definition in `uart.c`, or keep the buffer `static` inside `uart.c`.' },

    `## The linked image and the map file

After linking, the same tools work on the final ELF. For the example's PC build (\`make inspect\`):

\`\`\`
$ size build/doorlock
   text	   data	    bss	    dec	    hex	filename
   5071	    688	    248	   6007	   1777	build/doorlock
$ nm --size-sort -S build/doorlock | tail -n 8
0000000000001269 0000000000000052 T rb_init
0000000000001947 0000000000000054 T hal_gpio_write
000000000000182a 0000000000000057 T hal_init
00000000000014fb 0000000000000060 T app_init
00000000000018cd 000000000000007a T hal_millis
0000000000001374 000000000000007c T line_feed
0000000000001406 000000000000008c T lock_dispatch
0000000000001578 000000000000029c T app_poll
$ readelf -S -W build/doorlock | grep -E ' \\.(text|rodata|data|bss) '
  [16] .text             PROGBITS        0000000000001180 001180 000861 00  AX  0   0 16
  [18] .rodata           PROGBITS        0000000000002000 002000 000062 00   A  0   0  4
  [26] .data             PROGBITS        0000000000004000 003000 000010 00  WA  0   0  8
  [27] .bss              NOBITS          0000000000004020 003010 0000f8 00  WA  0   0 32
\`\`\`

- \`nm --size-sort\` answers "what is using my flash?". Here \`app_poll\` is by far the largest function (668 bytes) because the command handler was inlined into it.
- \`readelf -S\` lists sections with address, file offset, size and flags: \`A\` = occupies memory at run time, \`X\` = executable, \`W\` = writable. \`.bss\` is \`NOBITS\`: it has a size in memory but occupies nothing in the file.
- \`readelf -h\` shows the header. For this build it reports \`Class: ELF64\`, \`Machine: Advanced Micro Devices X86-64\`. A firmware ELF for a Cortex-M would say \`ELF32\` and \`ARM\`: the quickest check that you built for the right target.
- \`objdump -d\` disassembles. \`rb_count\` from the example, at \`-O1\`:

\`\`\`
00000000000000c2 <rb_count>:
  c2:	endbr64
  c6:	movzwl 0xa(%rdi),%eax
  ca:	movzwl 0xc(%rdi),%edx
  ce:	sub    %edx,%eax
  d0:	and    0x8(%rdi),%ax
  d4:	movzwl %ax,%eax
  d7:	ret
\`\`\`

Two 16-bit loads (\`head\` at offset 10, \`tail\` at offset 12 of the struct), a subtract, an AND with \`mask\` at offset 8. That is \`(head - tail) & mask\`, and you can see that each index is read exactly once.

### The map file

Ask the linker for a **map file** (\`-Wl,-Map=build/doorlock.map\`, already in the example Makefile). It records where every input section of every object file was placed. An excerpt from the real one:

\`\`\`
.text           0x0000000000001180      0x861
 .text          0x0000000000001269       0xf1 /tmp/ccfrR6V7.o
                0x0000000000001269                rb_init
                0x00000000000012bb                rb_put
                0x00000000000012f6                rb_get
                0x000000000000132b                rb_count
                0x0000000000001341                rb_free
 .text          0x000000000000135a       0x96 /tmp/cc6gEt2d.o
                0x000000000000135a                line_init
                0x0000000000001374                line_feed
 .text          0x00000000000014ce      0x35c /tmp/ccwts1XP.o
                0x00000000000014fb                app_init
                0x0000000000001578                app_poll
.bss            0x0000000000004020       0xf8
 .bss           0x0000000000004040       0xc0 /tmp/ccwts1XP.o
 .bss           0x0000000000004100       0x12 /tmp/cc68TwUJ.o
\`\`\`

(The objects have temporary names because this Makefile compiles and links in one command; a build that keeps \`.o\` files shows \`ringbuf.o\`, \`app.o\` and so on.) Use the map file to answer:

- **Which module uses the RAM?** The application object contributes \`0xc0\` = 192 bytes of \`.bss\` (its FIFO storage and state), the HAL \`0x12\`.
- **Why is my image so big?** Look for large contributions from the C library: pulling in \`printf\` with float support is a common multi-kilobyte surprise on an MCU.
- **What is at this address?** A fault handler reports a PC; the map (or \`addr2line -e image.elf <address>\`) turns it into a function.
- **What sits next to the variable that keeps getting corrupted?** Its neighbour, overflowing, is the first suspect.`,

    `## Optimisation levels and debugging

| Level | What the compiler does | Effect on debugging |
|---|---|---|
| \`-O0\` | Almost a literal translation: every variable lives in memory, every statement has code | Stepping matches the source; largest and slowest |
| \`-Og\` | Optimisations that do not disturb debugging much | Recommended for debug builds |
| \`-O1\`, \`-O2\` | Inlining, register allocation, dead-code removal, reordering | Variables show \`<optimized out>\`; stepping jumps around; some functions vanish |
| \`-Os\` | Like \`-O2\` but prefers smaller code | Typical firmware release setting |

Object size of the example's \`app.c\` at each level (text bytes, x86-64): \`-O0\` 1406, \`-O1\` 1158, \`-O2\` 1336, \`-Os\` 984.

**Optimisation does not introduce bugs. It exposes ones that were already there.** The compiler assumes your program follows the language rules; where it does not (undefined behaviour, or data shared with an interrupt without \`volatile\`), the unoptimised build happens to do what you meant and the optimised build does what you wrote. A demonstration you can run:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'flag.c: works at -O0, hangs at -O2. A signal handler plays the part of an interrupt.',
      code: C`#define _POSIX_C_SOURCE 200809L
#include <signal.h>
#include <stdio.h>
#include <unistd.h>

static int done;                       /* BUG: shared with an asynchronous handler, not volatile */

static void on_alarm(int sig) { (void)sig; done = 1; }

int main(void)
{
    signal(SIGALRM, on_alarm);         /* stands in for a timer interrupt */
    alarm(1);
    while (!done) { }                  /* wait for the "ISR" to set the flag */
    puts("flag seen");
    return 0;
}`,
      explain: [
        { lines: '6', md: 'A plain `int`. Nothing tells the compiler it can change outside the visible flow of `main`.' },
        { lines: '14', md: 'At `-O2` the compiler reasons: nothing in this loop writes `done`, so read it once. If it was 0, loop for ever. The generated code is a load, a test and a jump-to-self.' },
      ] },
    `\`\`\`
$ gcc -std=c11 -Wall -Wextra -O0 flag.c -o flag0 && timeout 3 ./flag0; echo "exit=$?"
flag seen
exit=0
$ gcc -std=c11 -Wall -Wextra -O2 flag.c -o flag2 && timeout 3 ./flag2; echo "exit=$?"
exit=124
\`\`\`

Exit status 124 is \`timeout\` killing a program that never finished. No warning was printed at either level. Declaring the flag \`static volatile int done;\` makes the \`-O2\` build print \`flag seen\` again: \`volatile\` obliges the compiler to perform every read.`,
    { t: 'callout', kind: 'decision', title: 'Debug and release builds', md: `Develop at \`-Og -g\`. But **test what you ship**: run the full test suite on the release configuration too, and keep the \`.elf\` with debug symbols for every released image (symbols live in the ELF, not in the flashed binary, so \`-g\` costs no flash). A bug that only appears in release is a real bug in your code; switching the release to \`-O0\` hides it and leaves it for the next compiler version to expose.` },

    `## Let the tools find bugs: warnings

The compiler can prove many mistakes without running anything, if you ask:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'warn.c: compiles silently with default flags and prints 0. Four diagnostics appear with -Wall -Wextra.',
      code: C`#include <stdint.h>
#include <stdio.h>

int find(const uint8_t *buf, int len, uint8_t key)
{
    for (unsigned i = 0; i < len; i++) {
        if (key = buf[i]) return i;
    }
}

int main(void)
{
    uint8_t data[4] = { 1, 2, 3, 4 };
    int unused;
    printf("%d\n", find(data, 4, 3));
    return 0;
}` },
    `\`\`\`
$ gcc -std=c11 warn.c -o warn        # no output at all
$ ./warn
0
$ gcc -std=c11 -Wall -Wextra warn.c -o warn
warn.c: In function 'find':
warn.c:6:28: warning: comparison of integer expressions of different signedness: 'unsigned int' and 'int' [-Wsign-compare]
warn.c:7:13: warning: suggest parentheses around assignment used as truth value [-Wparentheses]
warn.c: In function 'main':
warn.c:14:9: warning: unused variable 'unused' [-Wunused-variable]
warn.c: In function 'find':
warn.c:9:1: warning: control reaches end of non-void function [-Wreturn-type]
\`\`\`

(Source excerpts and carets trimmed.) Line 7 is the real bug: \`=\` where \`==\` was meant, so the function returns index 0 for any non-zero first byte. Line 9 is a second one: if nothing matches, the function returns whatever happens to be in the return register.

The standard baseline for firmware is

\`\`\`
-Wall -Wextra -Werror
\`\`\`

\`-Werror\` turns warnings into errors so they cannot accumulate. A build with 300 warnings is a build where nobody will notice warning 301. The example Makefile adds \`-Wshadow -Wconversion\`: the second is noisy but catches silent narrowing such as storing a \`uint32_t\` into a \`uint8_t\`.`,

    `## Static analysis

A **static analyser** follows paths through the code looking for sequences that go wrong: a NULL pointer dereferenced on one branch, memory used after free, a buffer index that can exceed its bound. GCC has one built in (\`-fanalyzer\`, GCC 10 and later). On this function:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'an.c: compiled with gcc -fanalyzer -c. Two real defects.',
      code: C`#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct { uint8_t *data; uint32_t len; } packet_t;

packet_t *packet_new(const uint8_t *src, uint32_t len)
{
    packet_t *p = malloc(sizeof *p);
    p->data = malloc(len);
    if (p->data == NULL) {
        free(p);
        return p;
    }
    memcpy(p->data, src, len);
    p->len = len;
    return p;
}` },
    `\`\`\`
$ gcc -std=c11 -Wall -Wextra -fanalyzer -c an.c
an.c: In function 'packet_new':
an.c:13:16: warning: pointer 'p' used after 'free' [-Wuse-after-free]
   13 |         return p;
an.c:12:9: note: call to 'free' here
   12 |         free(p);
an.c:10:13: warning: dereference of possibly-NULL 'p' [CWE-690] [-Wanalyzer-possible-null-dereference]
   10 |     p->data = malloc(len);
  'packet_new': events 1-2
    |    9 |     packet_t *p = malloc(sizeof *p);
    |      |                   (1) this call could return NULL
    |   10 |     p->data = malloc(len);
    |      |             (2) 'p' could be NULL: unchecked value from (1)
\`\`\`

(Trimmed.) It reports the *path*: step 1 the allocation that may fail, step 2 the use. Running the analyser over this section's example sources (\`make analyze\`) printed no findings.

Other widely used analysers are **cppcheck** and **clang-tidy** / the Clang static analyser. cppcheck is not installed in this repository's environment, so no cppcheck output is shown here; its usual invocation is \`cppcheck --enable=warning,style,portability src/\`. Coding standards such as **MISRA C** and **SEI CERT C** define rule sets that commercial and some open-source analysers check; MISRA is common in automotive and other regulated work, and its documents are purchased from MISRA. Analysers produce false positives and miss real bugs: they complement tests, they do not replace them.`,

    `## Sanitizers: run-time checking on the host

A **sanitizer** is instrumentation the compiler adds to the program. \`-fsanitize=address\` (ASan) surrounds every stack variable, global and heap block with poisoned "red zones" and checks each memory access. \`-fsanitize=undefined\` (UBSan) checks operations whose behaviour C leaves undefined: out-of-bounds indexing of arrays with known size, signed overflow, shifts by too much, misaligned or NULL dereferences.

They need megabytes of RAM and an operating system, so they do not run on a small MCU. They run on the **host build of your portable code**, which is one more reason to have one.

The example contains an early, buggy version of the line receiver (\`bugs/line_rx_oob.c\`). Built normally and fed a 30-character line:

\`\`\`
$ gcc -std=c11 -Wall -Wextra -O1 bugs/line_rx_oob.c -o oob_plain && ./oob_plain; echo "exit=$?"
lines=1
exit=0
\`\`\`

No warning, plausible output, success status. With both sanitizers (\`make bug-demo\`):

\`\`\`
bugs/line_rx_oob.c:27:24: runtime error: store to address 0x7fe5c8a00039 with insufficient space for an object of type 'char'
\`\`\`

and with ASan alone:

\`\`\`
==6247==ERROR: AddressSanitizer: stack-buffer-overflow on address 0x7f1b03400039 at pc 0x5589de2b2466 ...
WRITE of size 1 at 0x7f1b03400039 thread T0
    #0 0x5589de2b2465 in line_feed bugs/line_rx_oob.c:27
    #1 0x5589de2b2465 in main bugs/line_rx_oob.c:37
Address 0x7f1b03400039 is located in stack of thread T0 at offset 57 in frame
    #0 0x5589de2b2278 in main bugs/line_rx_oob.c:32
  This frame has 1 object(s):
    [32, 57) 'lr' (line 33) <== Memory access at offset 57 overflows this variable
SUMMARY: AddressSanitizer: stack-buffer-overflow bugs/line_rx_oob.c:27 in line_feed
\`\`\`

(Paths shortened.) Read it from the top: the kind of error, the access (a 1-byte write), the stack trace of the access (line 27, called from line 37), and which variable was overrun: \`lr\` occupies frame offsets 32 to 56, and the write hit offset 57, one byte past its end. You are told the file, the line and the object. Now fix it:`,
    { t: 'widget', name: 'c-lab', props: clSanitizerFix },
    { t: 'callout', kind: 'mistake', title: '"It runs, so the memory handling is fine"', md: `Out-of-bounds writes and uninitialised reads usually produce *no visible symptom* at the moment they happen. The stray byte lands in padding, in a variable not used for a while, or in one whose corruption shows up three functions later. Absence of a crash is not evidence. Sanitizers on host tests turn "probably fine" into "every access during this test was checked".` },

    `## Harder application

In \`examples/firmware-eng\`: (1) Run \`make inspect\` and use \`nm --size-sort\` and the map file to answer: which object file contributes the most \`.text\`, and which the most \`.bss\`? (2) Change \`APP_RX_FIFO_SIZE\` in \`include/app.h\` to 256 and predict the new \`.bss\` size of the application object before rebuilding. (3) Add \`int app_debug_counter = 0;\` to \`include/app.h\`, run \`make test\`, and explain the result from the error text alone. (4) In \`src/line_rx.c\`, change \`>=\` to \`>\` in the length check and run \`make test\`: which test fails, and what does the sanitizer print before it?

For (2): the storage array grows from 64 to 256 bytes, so the object's \`.bss\` grows by 192 bytes (from \`0xc0\` to about \`0x180\`; alignment may add a few).`,
    { t: 'refs', items: [
      { title: 'GNU ld manual (linker, linker scripts, map files)', url: 'https://sourceware.org/binutils/docs/ld/' },
      { title: 'GNU Binutils manual (nm, objdump, size, readelf, addr2line)', url: 'https://sourceware.org/binutils/docs/binutils/' },
      { title: 'GCC manual: Options to request or suppress warnings', url: 'https://gcc.gnu.org/onlinedocs/gcc/Warning-Options.html' },
      { title: 'GCC manual: Options that control optimization', url: 'https://gcc.gnu.org/onlinedocs/gcc/Optimize-Options.html' },
      { title: 'GCC manual: Static analyzer options (-fanalyzer)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Static-Analyzer-Options.html' },
      { title: 'GCC manual: Program instrumentation options (-fsanitize)', url: 'https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html' },
      { title: 'SEI CERT C Coding Standard', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard' },
    ] },
  ],
  quiz: [
    { q: '`nm driver.o` shows the line `                 U board_clock_hz`. What does it mean?', kind: 'code', choices: [
      { t: '`driver.o` uses the symbol but does not define it; the linker must find it elsewhere', ok: true, why: '`U` marks an undefined symbol: a reference with no definition in this file. It is normal for every cross-file call or variable.' },
      { t: 'The symbol is unused in `driver.o` and will be removed by the linker', why: '`U` is the opposite of unused: the object needs this symbol and cannot be linked without a definition for it.' },
      { t: 'The variable is uninitialised, so it will have no address until the start-up code has run', why: 'Zero-initialised variables are shown as `B` or `b` with an address. `U` has no address because the symbol lives elsewhere.' },
      { t: 'The symbol has an `unsigned` type; `nm` prints the first letter of the type', why: '`nm` shows linkage and section, not C types. Type information is in the debug data, not the symbol letter.' },
    ] },
    { q: 'A firmware\'s `size` output is `text 41200  data 800  bss 6000`. The MCU has 64 KiB flash and 8 KiB RAM. Does it fit?', kind: 'arch', choices: [
      { t: 'Flash fits (42 000 of 65 536). RAM: 6800 used, about 1400 left for stack and heap, which is tight', ok: true, why: 'Flash = text + data; RAM = data + bss + stack + heap. The static part alone uses 83 % of RAM, and `size` does not show the stack.' },
      { t: 'Flash holds text + data + bss = 48 000 of 65 536 bytes; RAM holds only data, 800 of 8192: plenty of room', why: '`.bss` occupies no flash: it is only zeroed at start-up, and it then lives in RAM for the whole run. This answer puts it on the wrong side of the ledger twice.' },
      { t: 'Yes, comfortably: flash holds 41 200 bytes of text, and RAM only the 800 bytes of data', why: '`.bss` variables live in RAM for the whole run even though they take no space in the image; ignoring them misses most of the RAM use.' },
    ] },
    { q: 'A program works at `-O0` and fails at `-O2`. What is the most productive first assumption?', kind: 'concept', choices: [
      { t: 'The code has undefined behaviour or a missing `volatile` that the `-O0` build happened to tolerate', ok: true, why: 'Optimisers rely on the language rules. Code that breaks them works only by accident at `-O0`; finding the violation fixes all build types.' },
      { t: 'The optimiser has a bug in this compiler version; report it and pin an older release', why: 'Compiler bugs exist but are rare compared with latent undefined behaviour. Blaming the tool first usually wastes days.' },
      { t: 'Optimised code is unsafe on microcontrollers in general, so the fix is to ship the `-O0` build', why: 'Nearly all production firmware is optimised, for size if nothing else. Disabling it hides the defect without removing it.' },
    ] },
    { q: 'Why can AddressSanitizer find bugs in firmware logic even though it cannot run on the microcontroller?', kind: 'concept', choices: [
      { t: 'Portable modules compile unchanged for the host, where every memory access the tests make is checked', ok: true, why: 'An off-by-one in a parser is the same bug on x86-64 and on Cortex-M. Host tests under ASan find it wherever the code is portable.' },
      { t: 'ASan disassembles the Arm binary on the PC and checks every access without running it', why: 'ASan is run-time instrumentation of a host build; it never looks at the target binary.' },
      { t: 'It cannot: a memory error found on a 64-bit PC says nothing about the same source on a 32-bit MCU', why: 'Memory-safety and undefined-behaviour bugs in portable C are properties of the source, and most reproduce on any platform.' },
    ] },
    { q: 'What does `static` on a file-scope function change, as seen by the linker?', kind: 'code', choices: [
      { t: 'The symbol becomes local to its object file (`t` in `nm`), invisible to other files', ok: true, why: 'Internal linkage removes the name from cross-file resolution. Two files can each have their own `static void reset(void)` without conflict.' },
      { t: 'The function is placed in `.data` with other statics, and so is stored in RAM instead of flash', why: 'Linkage does not affect placement: static functions are code in `.text` like any other.' },
      { t: 'The function keeps the values of its local variables from one call to the next', why: 'That is `static` applied to a *local variable*. On a function it only changes visibility.' },
    ] },
    { q: 'A HardFault handler logged the faulting PC `0x08001E44`. Which artefact turns this into a function name?', kind: 'arch', choices: [
      { t: 'The map file or `addr2line` on the ELF of exactly that build', ok: true, why: 'Both record which function occupies each address range. They must come from the same build as the flashed image, which is why release ELFs are archived.' },
      { t: 'The C source alone, by counting bytes from the start of `main.c`', why: 'Source has no addresses; placement is decided by the linker for a particular build.' },
      { t: 'The `.su` stack-usage files, which list every function with a number', why: 'Those list frame sizes per function and contain no addresses.' },
    ] },
    { q: 'Which statement about `-Werror` is the strongest argument for using it?', kind: 'concept', choices: [
      { t: 'It keeps the warning count at zero, so a new warning cannot go unnoticed', ok: true, why: 'The value of warnings depends on noticing them. A permanently clean build makes every new diagnostic visible the moment it appears.' },
      { t: 'It lets the compiler assume warning-free code and so generate faster output', why: 'Diagnostic flags do not change code generation; they only change what the compiler reports and whether it stops.' },
      { t: 'A build that passes `-Wall -Wextra -Werror` is guaranteed free of memory errors', why: 'Warnings catch a class of mistakes. Logic errors, races and most memory errors produce no warning at all.' },
    ] },
  ],
};

/* ============================================================== 8. Cross-compilation */
const cross = {
  id: 'fw-cross', title: 'Cross-compilation, toolchains and reproducible builds', minutes: 60,
  summary: 'What a cross toolchain consists of, what the C library, startup file and linker script each contribute, how ESP-IDF, the MSDK and the TI SDK wrap it, and why a build must be reproducible.',
  skills: ['fw-cross-build', 'fw-repro-build'],
  blocks: [
    `## The problem

You compile \`printf("hello\\n");\` for a microcontroller. The link fails with undefined references to \`_write\`, \`_sbrk\`, \`_close\`, \`_fstat\`... functions you never called. Or it links, you flash it, and nothing is printed.

On your PC the same line works because an operating system is underneath: it provides files, a terminal and memory. A microcontroller has none of that. Building for one means supplying every piece yourself, or knowing which part of the SDK supplies it for you.

A second problem appears the day a teammate cannot build your code: "works on my machine" with a different compiler version, a different SDK tag, a different result. In a competition such as the eCTF, where organisers build and attackers examine your design, a build that only works on one laptop is a failed submission.`,

    `## Cross-compiling and target triplets

A **native** compiler produces code for the machine it runs on. A **cross-compiler** runs on one machine (the *host*: your PC) and produces code for another (the *target*: the MCU). The target cannot compile its own firmware: it has no file system and a few kilobytes of RAM.

Toolchains are named by a **target triplet** (really "architecture-vendor-os-abi", with parts omitted):

| Prefix | Target | Used for |
|---|---|---|
| \`x86_64-linux-gnu-\` | 64-bit x86, Linux, GNU libc | Your PC (this is what \`gcc -dumpmachine\` printed in this repository) |
| \`arm-none-eabi-\` | Arm, **no** OS, embedded ABI | Cortex-M microcontrollers: MAX78000 (2024–2025 eCTF builds used apt's \`gcc-arm-none-eabi\`), STM32, nRF... |
| \`xtensa-esp32-elf-\` | Xtensa, ESP32 variant | ESP32 (Xtensa cores); \`xtensa-esp32s3-elf-\` for the S3 |
| \`riscv32-esp-elf-\` | 32-bit RISC-V | ESP32-C3, ESP32-C6 |

"\`none\`" and "\`elf\`" mean **bare metal**: no operating system, output in ELF format. Every tool carries the prefix: \`arm-none-eabi-gcc\`, \`arm-none-eabi-ld\`, \`arm-none-eabi-objdump\`, \`arm-none-eabi-size\`, \`arm-none-eabi-gdb\`.

GCC is not the only option. The 2026 eCTF reference design for the MSPM0L2228 builds with **TI Arm Clang** (\`tiarmclang\`, an LLVM-based compiler) and converts the result with \`tiarmobjcopy\`; it is explicitly *not* \`arm-none-eabi-gcc\` (docs/FACTS, from that design's Dockerfile). Flags and linker-file syntax differ between GCC and the TI tools, so a Makefile does not move between them unchanged.`,
    { t: 'callout', kind: 'note', title: 'The core must be named too', md: `\`arm-none-eabi-gcc\` can generate code for dozens of Arm cores. Flags select one: the 2026 eCTF design passes \`-mcpu=cortex-m0plus -march=thumbv6m -mfloat-abi=soft\` for the MSPM0L2228. A Cortex-M4 with FPU, such as the MAX78000's Arm core, uses a different \`-mcpu\` and can use hardware floating point. Code compiled for the wrong core may link without complaint and then fault on the first instruction the CPU does not have. All objects *and libraries* in a link must agree on these flags.` },

    `## What is in a firmware image besides your code

### 1. The C library

\`memcpy\`, \`strlen\`, \`printf\`, \`malloc\` come from a C library built for bare metal:

| Library | Notes |
|---|---|
| **newlib** | The standard library shipped with \`arm-none-eabi-gcc\`. Complete, but its \`printf\` and \`malloc\` are large for small parts |
| **newlib-nano** | A size-reduced build of newlib, selected with \`--specs=nano.specs\`. Smaller \`printf\` (no float formatting unless you opt in), simpler allocator |
| **picolibc** | A newer library for small systems, derived from newlib and AVR libc, with tiny stdio. Selected with \`--specs=picolibc.specs\` where the toolchain provides it |

The library implements \`printf\` down to "write these bytes to file descriptor 1" and then calls a **system call stub** that *you* must provide, because the library cannot know what your hardware's console is.

### 2. Retargeting: why "hello world" needs \`_write\`

In newlib, \`printf\` → \`_write(fd, buf, len)\`. \`malloc\` → \`_sbrk(increment)\` to obtain heap. On a PC these end in the kernel. On an MCU you implement them (this is called **retargeting**), or link \`--specs=nosys.specs\`, which supplies stubs that just fail, silencing the link errors and printing nothing.`,
    { t: 'code', lang: 'c', status: 'reviewed', caption: 'Retargeting newlib\'s output to a UART. Written against newlib\'s documented syscall interface; not built for a target here. hal_uart_write is this section\'s HAL function.',
      code: C`#include <sys/stat.h>
#include "hal.h"

/* newlib calls this for every write() on any file descriptor, including stdout. */
int _write(int fd, const char *buf, int len)
{
    (void)fd;                                   /* stdout and stderr both go to the console */
    for (int i = 0; i < len; i++) {
        if (buf[i] == '\n') hal_uart_write('\r');   /* terminals expect CR LF */
        hal_uart_write((uint8_t)buf[i]);
    }
    return len;                                 /* number of bytes consumed */
}`,
      explain: [
        { lines: '5', md: 'The name and signature are fixed by newlib. Once this symbol exists in your link, `printf` output appears on the UART. picolibc uses a different mechanism (a `FILE` object with a put-character function), so check the library you actually link.' },
        { lines: '8-11', md: 'Each character goes through the blocking UART write. A `printf` of 80 characters at 115200 baud therefore stalls the caller for about 7 ms: fine for bring-up, a problem inside a control loop or an ISR.' },
      ] },
    `SDKs do this for you. ESP-IDF routes \`stdout\` to its console UART (or USB Serial/JTAG) before \`app_main\` runs; note that ESP-IDF v6.1 links **picolibc** by default, not newlib (the \`LIBC_PICOLIBC\` choice in its Kconfig), so a \`_write\` you add to an IDF project is not what its \`printf\` calls. The MSDK's board support code initialises the console UART (UART0 at 115200 on the MAX78000FTHR, per the \`FTHR_RevA\` board files). When you start from an empty project with a bare toolchain, it is your job.

### 3. The startup file

The CPU does not begin at \`main\`. After reset a Cortex-M core loads the initial stack pointer from the first word of the vector table and the address of the **reset handler** from the second, and jumps there. The reset handler (in a file usually named \`startup_<device>.c\` or \`.S\`) must:

1. copy the initial values of \`.data\` from flash to RAM,
2. fill \`.bss\` with zeros,
3. optionally run early system setup (clocks, FPU enable) and C library initialisation,
4. call \`main\`.`,
    { t: 'code', lang: 'c', status: 'reviewed', caption: 'The essential part of a Cortex-M reset handler. Illustrative: symbol names vary between vendors\' startup files and linker scripts.',
      code: C`extern uint32_t _sidata;   /* start of .data's initial values, in flash (set by the linker script) */
extern uint32_t _sdata;    /* start of .data in RAM  */
extern uint32_t _edata;    /* end of .data in RAM    */
extern uint32_t _sbss;     /* start of .bss          */
extern uint32_t _ebss;     /* end of .bss            */

int main(void);

void Reset_Handler(void)
{
    uint32_t *src = &_sidata;
    for (uint32_t *dst = &_sdata; dst < &_edata; ) *dst++ = *src++;   /* initialise .data */
    for (uint32_t *dst = &_sbss; dst < &_ebss; ) *dst++ = 0u;         /* zero .bss        */
    main();
    for (;;) { }                                                      /* main must not return */
}`,
      explain: [
        { lines: '1-5', md: 'These are not variables with storage. They are *symbols* the linker script defines; only their addresses mean anything, which is why the code takes `&_sdata`.' },
        { lines: '12', md: 'Without this loop, `uint32_t calibration = 1234;` reads as whatever was in RAM at power-on.' },
        { lines: '13', md: 'Without this one, `static` counters and flags do not start at zero.' },
      ] },
    `### 4. The linker script

The linker script tells the linker what memory exists and which sections go where. The two essential parts:

\`\`\`
MEMORY
{
    FLASH (rx)  : ORIGIN = 0x10000000, LENGTH = 512K     /* MAX78000: flash base and size per the MSDK */
    SRAM  (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}

SECTIONS
{
    .text : { KEEP(*(.isr_vector)) *(.text*) *(.rodata*) } > FLASH
    .data : { _sdata = .; *(.data*) . = ALIGN(4); _edata = .; } > SRAM AT > FLASH   /* runs in RAM, stored in flash */
    _sidata = LOADADDR(.data);
    .bss  : { _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > SRAM
}
\`\`\`

(A simplified sketch, not the MSDK's actual file. Its syntax and the addresses below were checked by linking a small test object with it using GNU ld 2.42 on the host; it was not used to build a target image.) Things to recognise:

- \`MEMORY\` is the chip's address map. Get an origin wrong and the image is built for addresses that do not exist. The numbers differ per chip: TI's linker file for the MSPM0L2228 (and the 2026 eCTF design) places SRAM at \`0x20200000\`. That chip maps the same 32 KB at three addresses with different error checking, and \`0x20000000\` is one of the other two (docs/FACTS), so always take the origin from the vendor's file for your part instead of assuming it.
- \`> SRAM AT > FLASH\`: the section's **run address** (VMA) is in RAM, its **load address** (LMA) is in flash. That one line is the reason for the copy loop in the startup file.
- \`. = ALIGN(4)\` before \`_edata\` and \`_ebss\` rounds each end up to a word boundary, because the startup loops above copy and clear whole 32-bit words. Without it a section whose size is not a multiple of 4 would have the loop write up to three bytes past its end.
- \`KEEP(*(.isr_vector))\`: put the vector table first, and keep it even when the link uses \`--gc-sections\` to discard unreferenced sections. Nothing in the C code refers to the table (only the CPU reads it, at reset), so the garbage collector would otherwise throw it away.

**The two addresses, step by step.** In the test link, \`objdump -h\` and \`nm\` showed:

\`\`\`
Name     Size      VMA         LMA
.text    00000098  10000000    10000000     runs where it is stored
.data    00000008  20000000    10000098     runs in RAM, stored in flash right after .text
.bss     00000004  20000008    (none)       NOBITS: nothing stored at all
_sdata = 0x20000000   _edata = 0x20000008   _sidata = 0x10000098
\`\`\`

1. The compiler generated code that reads \`calibration\` at \`0x20000000\`. That is its VMA: the only address the *code* ever uses.
2. The programmer writes the image to flash. The 8 bytes of initial values land at \`0x10000098\`: the LMA. RAM is not touched by programming, and would not keep the values without power anyway.
3. At every reset the startup loop copies \`_edata − _sdata\` = 8 bytes from \`_sidata\` (flash) to \`_sdata\` (RAM). Only now does a read of \`0x20000000\` return 1234.

For \`.text\` and \`.rodata\` the two addresses are equal, which is why nobody notices that there are two until \`.data\` goes wrong.
- When an image must coexist with a bootloader, the team's \`FLASH\` region does not start at the beginning of flash. In the 2024 and 2025 eCTF designs the MITRE bootloader occupied \`0x10000000\`–\`0x1000E000\` and team firmware started at \`0x1000E000\`; in 2026 the team region starts at \`0x00006000\` (docs/FACTS, from each year's \`firmware.ld\`).

TI's own linker uses **linker command files** (\`.cmd\`) with a different syntax for the same ideas; the MSPM0 SDK ships them per device and compiler.`,
    { t: 'widget', name: 'memory-map', props: { platform: 'max78000' }, caption: 'The address ranges a linker script\'s MEMORY block must match.' },
    { t: 'predict', q: 'A linker script places `.data` in RAM but omits the `AT > FLASH` part, and the image is written to flash as a raw binary. After reset, what value does a global declared as `uint32_t baud = 115200;` hold?',
      choices: [
        { t: 'Unpredictable: nothing ever put 115200 into RAM', ok: true, why: 'RAM contents do not survive power-off and a raw flash image cannot contain RAM. Without a load address in flash the initial values are simply not part of what gets programmed.' },
        { t: '115200, because the compiler emits code that stores the initial value before `main`', why: 'The compiler only records the initial value in the object file. Getting it into RAM at run time is the job of the startup code, using a copy that the linker script must place in flash.' },
        { t: '0, because the hardware clears all RAM at reset', why: 'Hardware does not clear RAM at reset. Only `.bss` is zeroed, and that too is done by the startup code.' },
      ],
      reveal: 'Without `AT > FLASH` the load address of `.data` equals its run address: the linker records "these bytes belong at 0x20000000". A flash programmer cannot put them there, and `_sidata` now equals `_sdata`, so the startup loop copies RAM onto itself. The symptom is distinctive: `const` data and code are fine, zero-initialised variables are fine, but every variable with a non-zero initialiser is wrong. A second tell-tale appears at build time: `objcopy -O binary` fills the gap between the flash and RAM addresses, so the `.bin` balloons (in the test link behind this lesson\'s sketch, from 160 bytes to 256 MB). If you see either during bring-up, read the linker script and the startup file before anything else.' },

    `## How SDK build systems wrap all this

You rarely write the startup file and linker script from scratch. Each vendor's SDK supplies them and a build system that selects the right ones.

| | ESP-IDF | Analog Devices MSDK | TI MSPM0 SDK |
|---|---|---|---|
| Build system | **CMake** driven by \`idf.py\` (with Ninja underneath) | **GNU Make**: the project Makefile includes the SDK's makefiles | Makefiles per example and toolchain, or Code Composer Studio projects; configuration generated by **SysConfig** |
| Unit of code | *Component*: a directory with a \`CMakeLists.txt\` calling \`idf_component_register(...)\` | Source directories plus SDK peripheral-driver and board libraries | Source files plus DriverLib |
| Configuration | Kconfig → \`sdkconfig\` (\`idf.py menuconfig\`) | Make variables (target, board) and \`MAXIM_PATH\` pointing at the SDK | SysConfig \`.syscfg\` file generating \`ti_msp_dl_config.c/.h\` |
| Compiler | \`xtensa-esp32-elf-gcc\` or \`riscv32-esp-elf-gcc\` | \`arm-none-eabi-gcc\` (and a RISC-V GCC for the second core) | TI Arm Clang, GCC, IAR or Keil |
| Linker script and startup | Generated and supplied by IDF; you edit the partition table, not the script | Supplied per device under the SDK's CMSIS device directory | Supplied per device and toolchain (\`.cmd\` for TI Clang) |
| Typical commands | \`idf.py set-target esp32\`, \`idf.py build\`, \`idf.py flash monitor\` | \`make\` in the project directory | \`make\` in the example's toolchain directory, or build in CCS |

This table is at the level of detail in docs/FACTS and the vendors' repositories; for variable names and options, read the ESP-IDF build system guide, the MSDK user guide and the MSPM0 SDK documentation for the version you install.

Two practical points:

- **Find the actual compiler commands.** Every one of these can print them (\`idf.py -v build\`, \`make V=1\` or \`make VERBOSE=1\` depending on the makefiles). When a build misbehaves, the command line with its \`-mcpu\`, \`-I\`, \`-D\` and \`-T\` flags is the ground truth.
- **Your portable modules do not care.** \`ringbuf.c\`, \`line_rx.c\` and \`lock.c\` from this section are added to an IDF component's source list or an MSDK Makefile's source variable unchanged. Only the HAL file is per target.`,
    { t: 'code', lang: 'cmake', status: 'idf-checked', caption: 'The two CMake files of an ESP-IDF project that pulls in the portable modules. Checked by building this project by hand, with this section\'s port files (port/main_esp32.c, port/hal_esp32.c), for the esp32 target with ESP-IDF v6.1 (`idf.py build` exited 0). Not run on a board.',
      code: C`# CMakeLists.txt  (project root)
cmake_minimum_required(VERSION 3.22)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(doorlock)

# main/CMakeLists.txt
idf_component_register(
    SRCS         "main_esp32.c" "hal_esp32.c"
                 "../shared/src/app.c" "../shared/src/ringbuf.c"
                 "../shared/src/line_rx.c" "../shared/src/lock.c"
    INCLUDE_DIRS "../shared/include"
    PRIV_REQUIRES esp_driver_uart esp_driver_gpio esp_timer
)`,
      explain: [
        { lines: '2-4', md: 'The three lines every IDF project needs, in this order. `project.cmake` is IDF\'s build system: including it is what brings in the cross-compiler, the flags, the startup code, the generated linker scripts and FreeRTOS. `project()` names the output (`build/doorlock.elf`, `.bin`, `.map`).' },
        { lines: '7-11', md: 'One function call declares a component: its sources (paths are relative to the component directory and may point outside it) and the include directories its sources need.' },
        { lines: '12', md: '`PRIV_REQUIRES` lists the components whose headers these sources include: `driver/uart.h` lives in `esp_driver_uart`, `driver/gpio.h` in `esp_driver_gpio`, `esp_timer.h` in `esp_timer`. Private, because no header of *this* component exposes them. The component named `main` is special: by default it automatically requires every other component, so this line could be omitted there, but any other component needs it, and so does `main` when the project sets the `MINIMAL_BUILD` property to trim the build.' },
      ] },

    `## Reproducible builds

A build is **reproducible** if the same source produces a bit-for-bit identical image, on any machine, at any time. It is worth real effort:

- **Trust.** If anyone can rebuild a release and get the same hash, a binary can be checked against its source. That is the basis for auditing what is actually flashed, and for spotting a tampered build machine.
- **Debugging.** The ELF you rebuild next year has the same addresses as the image in the field, so a crash PC still maps to the right line.
- **Teams and competitions.** The eCTF organisers build your design from your repository with your documented procedure. In 2024 the environment was pinned with Nix (\`shell.nix\`) and Poetry and the MSDK at tag \`v2023_06\`; in 2025 a Dockerfile (\`FROM ubuntu:24.04\`) installed \`gcc-arm-none-eabi\` and MSDK tag \`v2024_02\`; in 2026 a Dockerfile installs a specific MSPM0 SDK release and a specific TI Arm Clang version (docs/FACTS). The pattern is constant: **the environment is part of the source**.

What breaks reproducibility, and the fix for each:

| Source of variation | Fix |
|---|---|
| Different compiler or SDK version | Pin exact versions in a Dockerfile, Nix file or lock file; never "latest" |
| Unpinned base image (\`ubuntu:24.04\` gets updates) | Pin the image by digest, or accept and document the residual drift |
| \`__DATE__\`, \`__TIME__\`, build timestamps in the image | Do not use them; or set \`SOURCE_DATE_EPOCH\` |
| Absolute paths embedded via \`__FILE__\` and debug info | \`-ffile-prefix-map=$(pwd)=.\` |
| File order from directory listing (\`wildcard\`, globbing) | Sort source lists explicitly |
| Random seeds or per-build secrets | Generate secrets in a separate, explicit step, not inside the compile |`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'ver.c: a build timestamp makes two builds of identical source differ.',
      code: C`#include <stdio.h>
int main(void) { puts("built " __DATE__ " " __TIME__); return 0; }` },
    `Built twice a second apart, then twice with a fixed \`SOURCE_DATE_EPOCH\` (first 16 hex digits of each SHA-256):

\`\`\`
$ gcc -std=c11 -Wall -Wextra ver.c -o v1; sha256sum v1
a3c6569858f33792...
$ gcc -std=c11 -Wall -Wextra ver.c -o v1; sha256sum v1
8e22acd9633a4bf1...                      <- same source, different image
$ SOURCE_DATE_EPOCH=1700000000 gcc -std=c11 -Wall -Wextra ver.c -o v2; sha256sum v2
e9ebc849abe412a8...
$ SOURCE_DATE_EPOCH=1700000000 gcc -std=c11 -Wall -Wextra ver.c -o v2; sha256sum v2
e9ebc849abe412a8...                      <- identical
$ ./v2
built Nov 14 2023 22:13:20
\`\`\`

GCC honours \`SOURCE_DATE_EPOCH\` for \`__DATE__\` and \`__TIME__\`. The cleaner fix is to embed the git commit hash instead of a time.`,
    { t: 'code', lang: 'dockerfile', status: 'reviewed', caption: 'Skeleton of a pinned build container. Version strings are placeholders: take real ones from your SDK\'s release page and record them.',
      code: C`FROM ubuntu:24.04

# 1. Toolchain from the distribution, at whatever version this base image provides.
RUN apt-get update && apt-get install -y --no-install-recommends \
        make git ca-certificates gcc-arm-none-eabi libnewlib-arm-none-eabi \
    && rm -rf /var/lib/apt/lists/*

# 2. SDK at an exact tag, never a branch.
ARG SDK_TAG=v0000_00
RUN git clone --depth 1 --branch ${"$"}{SDK_TAG} https://github.com/analogdevicesinc/msdk.git /opt/msdk
ENV MAXIM_PATH=/opt/msdk

# 3. The build is one command, run on the source tree mounted at /src.
WORKDIR /src
CMD ["make", "-C", "/src", "release"]`,
      explain: [
        { lines: '1', md: 'A tag such as `ubuntu:24.04` moves when the image is patched. Pin `ubuntu@sha256:…` if you need bit-exact results months apart.' },
        { lines: '9-10', md: 'The SDK version is an explicit, reviewable argument.' },
        { lines: '14-15', md: 'Anyone with Docker runs the same compiler on the same SDK: `docker build -t fw . && docker run --rm -v "$(pwd)":/src fw`. The outputs appear in the mounted tree. (The 2025 eCTF design goes one step further and mounts a separate output directory, so the source tree can be mounted read-only.)' },
      ] },
    { t: 'callout', kind: 'mistake', title: 'Committing build outputs, not the recipe', md: `Checking a working \`.bin\` into the repository "so everyone has one that works", while the instructions for producing it live in one person's shell history. Six weeks later a one-line change is needed and nobody can rebuild. The repository must contain the **recipe**: Dockerfile or equivalent, pinned versions, and one documented command. Verify it by building from a fresh clone on a different machine before every milestone.` },
    { t: 'callout', kind: 'security', md: `Reproducibility interacts with secrets. If a build bakes a per-device key into the image, images legitimately differ between devices, and the key-generation step must be separate, explicit and kept out of the public repository (the eCTF reference designs generate secrets with dedicated scripts before the firmware build). Reproducible means: same source **and same secrets** give the same image.` },

    { t: 'exercise', prompt: 'A teammate\'s build of an unchanged commit differs from yours in size by 1.2 KB. You both use the project\'s Makefile. List what you would compare, in order, to find the cause. Then give the single most likely culprit in one word.',
      hints: [
        'Start with what the Makefile does not control.',
        'Run `arm-none-eabi-gcc --version` on both machines.',
        'A Makefile calls whatever `arm-none-eabi-gcc` is first in each person\'s PATH.',
      ],
      answer: { type: 'text', accept: ['.*(compiler|toolchain|gcc).*', '.*version.*'], nudge: 'What does the Makefile take from each developer\'s machine without pinning it?' },
      solution: 'Compare, in order: (1) compiler version (`arm-none-eabi-gcc --version`); (2) C library variant and version (newlib vs newlib-nano); (3) SDK tag (`git describe` in the SDK directory); (4) flags actually used (verbose build log); (5) environment variables the Makefile reads; (6) the map files, to see which object or library section differs. The most likely culprit is the **toolchain version**: a different GCC release optimises differently and ships a different libc build. The cure is to stop comparing laptops and build in the pinned container.' },

    `## Harder application

Write the build specification for a team project targeting a Cortex-M board: one page that a new member, or a competition organiser, could follow on a clean machine. It must state: the base image and how it is pinned; the exact toolchain and SDK versions; the one command that builds; where outputs appear and what they are (\`.elf\`, \`.bin\`, \`.map\`); how the firmware version and git revision get into the image; and how someone verifies that their build matches yours.

Then test it against this section's host example: clone the repository into a fresh directory and run \`make -C examples/firmware-eng test\`. What did you have to have installed that the README did not mention? That list is what a Dockerfile exists to remove.`,
    { t: 'refs', items: [
      { title: 'ESP-IDF Programming Guide: Build System', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/build-system.html' },
      { title: 'CMake documentation', url: 'https://cmake.org/cmake/help/latest/' },
      { title: 'GNU Make manual', url: 'https://www.gnu.org/software/make/manual/make.html' },
      { title: 'GNU ld manual: Linker Scripts (MEMORY, SECTIONS, LMA and VMA)', url: 'https://sourceware.org/binutils/docs/ld/Scripts.html' },
      { title: 'newlib: system calls (the stubs to retarget)', url: 'https://sourceware.org/newlib/libc.html#Syscalls' },
      { title: 'picolibc', url: 'https://github.com/picolibc/picolibc' },
      { title: 'Analog Devices MSDK: MAX78000 GCC linker script', url: 'https://github.com/analogdevicesinc/msdk/blob/main/Libraries/CMSIS/Device/Maxim/MAX78000/Source/GCC/max78000.ld' },
      { title: 'TI MSPM0 SDK: MSPM0L2228 linker command file (TI Clang)', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/source/ti/devices/msp/m0p/linker_files/ticlang/mspm0l2228.cmd' },
      { title: 'MITRE eCTF 2025 insecure example: decoder/Dockerfile', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example/blob/master/decoder/Dockerfile' },
      { title: 'MITRE eCTF 2026 insecure example: firmware/Dockerfile', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example/blob/release/firmware/Dockerfile' },
      { title: 'Reproducible Builds: SOURCE_DATE_EPOCH specification', url: 'https://reproducible-builds.org/docs/source-date-epoch/' },
    ] },
  ],
  quiz: [
    { q: 'What does the `none` in `arm-none-eabi-gcc` tell you?', kind: 'concept', choices: [
      { t: 'No operating system: bare metal, with startup code and syscalls supplied by you or an SDK', ok: true, why: 'The OS field of the triplet is "none", so the toolchain\'s libraries assume nothing underneath them and leave the system-call layer to be provided.' },
      { t: 'No optimisation: this build of the compiler always behaves as if `-O0` were given', why: 'Optimisation is chosen with `-O` flags and is unrelated to the toolchain\'s name.' },
      { t: 'No vendor: the toolchain comes from no chip maker, which is why vendor SDKs cannot be built with it', why: 'The field in question is the operating system. The toolchain is the standard, widely supported one for Cortex-M, and vendor SDKs such as the MSDK are built with it.' },
    ] },
    { q: 'A bare-metal link fails with `undefined reference to _sbrk`. You never call `_sbrk`. Why is it needed?', kind: 'code', choices: [
      { t: 'Something you linked uses the heap, and newlib obtains its heap memory through an `_sbrk` you supply', ok: true, why: 'newlib implements the portable parts and calls down to a small set of system stubs. Without an OS, each stub the linked code needs has to come from you or the SDK.' },
      { t: 'The toolchain is installed incorrectly: a complete installation provides `_sbrk` itself', why: 'This is the normal, expected state of a bare-metal toolchain: the library deliberately leaves these functions for the platform.' },
      { t: '`_sbrk` is the reset handler that the vector table refers to, and no startup file was linked', why: 'It is the heap-growth primitive. Reset handling lives in the startup file.' },
    ] },
    { q: 'In a linker script, `.data : { ... } > RAM AT > FLASH` means:', kind: 'arch', choices: [
      { t: 'The section is addressed in RAM at run time; its initial contents are stored in flash', ok: true, why: 'Run address (VMA) and load address (LMA) differ. The image carries the bytes in flash; the reset handler copies them to where the code expects them.' },
      { t: 'The section is kept in both RAM and flash, and each write updates both copies for redundancy', why: 'There is one working copy, in RAM. The flash copy is only the source for initialisation at each boot and is never written at run time.' },
      { t: 'The section goes to RAM, unless RAM is full, in which case the linker places it in flash', why: 'Placement is fixed at link time. If a region overflows, the link fails; there is no fallback.' },
    ] },
    { q: 'Which of these breaks build reproducibility?', kind: 'concept', choices: [
      { t: 'A version string built from `__DATE__` and `__TIME__`', ok: true, why: 'The image then contains the moment of compilation, so no two builds match unless the timestamp is pinned.' },
      { t: 'Compiling with `-Os`, because size optimisation is heuristic', why: 'Optimisation is deterministic: the same compiler with the same flags and input produces the same output.' },
      { t: 'Embedding the git commit hash of the source in the image', why: 'The hash is a function of the source revision: identical for every build of that revision.' },
      { t: 'Using a Makefile instead of CMake to drive the compiler', why: 'The build tool does not matter as long as its inputs and tool versions are pinned.' },
    ] },
    { q: 'The 2025 eCTF reference design built in Docker with apt\'s `gcc-arm-none-eabi` and a pinned MSDK tag; the 2026 design uses TI Arm Clang and the MSPM0 SDK. What should a team take from this when moving its own code between years?', kind: 'arch', choices: [
      { t: 'Portable modules behind a HAL carry over; compiler flags, linker files and SDK calls are redone', ok: true, why: 'Toolchain and SDK are per-target facts. Portable C with host tests survives the change; code written directly against one SDK does not.' },
      { t: 'Nothing needs to change: both are Arm Cortex-M targets and standard C compiles for either', why: 'The language is shared, but register maps, driver APIs, startup code, linker files and even compiler flags differ between the two environments.' },
      { t: 'Only the Dockerfile needs the new board name; the Makefile, linker file and sources stay as they are', why: 'The Dockerfile installs a different compiler and SDK from the ones the new target needs, and the flags, linker file syntax and driver calls differ as well.' },
    ] },
    { q: 'You flash a new board and globals with non-zero initialisers hold garbage, while `const` tables and zero-initialised variables are correct. Where do you look first?', kind: 'arch', choices: [
      { t: 'The startup code\'s `.data` copy loop and the linker-script symbols that it relies on', ok: true, why: 'Only `.data` depends on the flash-to-RAM copy. `.rodata` is read in place and `.bss` is merely zeroed, so the pattern points squarely at that step.' },
      { t: 'The UART baud-rate setting, since a wrong divisor corrupts values on the way out', why: 'A wrong baud rate garbles serial output; it cannot change the contents of variables in RAM.' },
      { t: 'The optimisation level, since `-O2` may drop initialisers it thinks unused', why: 'Optimisation does not decide whether initial values reach RAM; the startup code does, at every level.' },
    ] },
  ],
};

/* ============================================================== 9. Testing */
const testing = {
  id: 'fw-testing', title: 'Testing firmware', minutes: 55,
  summary: 'Unit tests on the host, what a fake HAL makes testable, where hardware-in-the-loop fits, how to derive test cases from requirements, and why every bug gets a regression test.',
  skills: ['fw-host-test', 'fw-sanitizers'],
  blocks: [
    `## The problem

"I flashed it and it works" describes one path through the code, on one board, on one afternoon. It says nothing about the third wrong PIN, a line of exactly the maximum length, a byte arriving while the latch is closing, or the 49th day of uptime.

Testing those by hand on hardware is slow (flash, connect, type, watch), hard to repeat exactly, and impossible for some cases (how do you make a flash write fail on demand?). So in practice it is not done, and the cases are first exercised by a customer or an attacker.

The alternative: make the computer run hundreds of precise checks in a second, every time the code changes. That requires code that *can* run on the computer, which is what the last five lessons arranged.`,

    `## The test pyramid for firmware

| Level | What runs | Where | Speed | Finds |
|---|---|---|---|---|
| **Unit tests** | One module, real code | Host | Milliseconds | Logic errors, boundary errors, memory errors (with sanitizers) |
| **Integration tests on a fake HAL** | The whole application above the HAL | Host | Milliseconds | Wrong interactions between modules, protocol and timeout behaviour |
| **Simulator / emulator** | The real target binary | Host (QEMU, Renode, vendor simulators) | Seconds | Startup, linker-script and some driver errors, where the peripheral models are good enough |
| **Hardware-in-the-loop (HIL)** | The real binary on the real board, driven and observed by a test rig | Bench | Seconds to minutes | Timing, electrical behaviour, real peripherals, driver bugs |
| **Manual / exploratory** | A person | Bench | Slow | What nobody thought to automate |

Most tests should be at the top of the table, because they are fast and exact. The lower levels are still needed: no host test tells you that the UART pins are swapped or that the ISR takes too long. The mistake is to do *everything* at the bottom.

The eCTF has used both ends: its 2022 reference design could run in an emulator (a custom QEMU image) as well as on the physical board, per that year's repository.`,

    `## Unit tests on the host

A unit test calls a function with chosen inputs and checks the result. You do not need a framework to start. This is the entire harness used by the examples:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/tests/test.h (excerpt)',
      code: C`static int t_checks, t_failures;

#define CHECK(cond) do { \
        t_checks++; \
        if (!(cond)) { t_failures++; printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); } \
    } while (0)

#define CHECK_STR(actual, expected) do { \
        t_checks++; \
        if (strcmp((actual), (expected)) != 0) { \
            t_failures++; \
            printf("  FAIL %s:%d: got \"%s\", expected \"%s\"\n", __FILE__, __LINE__, (actual), (expected)); \
        } \
    } while (0)

#define RUN(test_fn) do { test_fn(); printf("  ran %s\n", #test_fn); } while (0)

#define TEST_REPORT(name) \
    (printf("%s: %d checks, %d failures\n", (name), t_checks, t_failures), t_failures ? 1 : 0)
`,
      explain: [
        { lines: '3-6', md: '`CHECK` records a failure with file and line and **keeps going**, so one run reports every failing check. `#cond` turns the expression into the text printed on failure.' },
        { lines: '16', md: '`RUN` names each test as it executes: when a test crashes outright (or a sanitizer aborts), the last name printed tells you where.' },
        { lines: '18-19', md: 'The process exit status is non-zero if anything failed. That is what lets `make test`, or a CI server, stop on failure.' },
      ] },
    `And tests for the ring buffer:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'examples/firmware-eng/tests/test_ringbuf.c (excerpt)',
      code: C`static void test_full_drops_newest(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (uint8_t i = 0; i < 7; i++) CHECK(rb_put(&rb, i));
    CHECK(rb_free(&rb) == 0);
    CHECK(!rb_put(&rb, 99));                 /* eighth byte does not fit */
    CHECK(rb.dropped == 1);
    CHECK(rb_count(&rb) == 7);
    CHECK(rb_get(&rb, &b) && b == 0);        /* oldest data survived */
}

static void test_wraparound_many_times(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (int i = 0; i < 1000; i++) {         /* indices wrap 250 times */
        CHECK(rb_put(&rb, (uint8_t)i));
        CHECK(rb_put(&rb, (uint8_t)(i + 1)));
        CHECK(rb_get(&rb, &b) && b == (uint8_t)i);
        CHECK(rb_get(&rb, &b) && b == (uint8_t)(i + 1));
    }
    CHECK(rb_count(&rb) == 0);
    CHECK(rb.dropped == 0);
}`,
      explain: [
        { lines: '1-11', md: 'A boundary test: fill to exactly the capacity (7), try one more, and check *three* things: the put was refused, the drop was counted, and the old data is intact.' },
        { lines: '13-25', md: 'A thousand rounds of put-put-get-get make the indices wrap 250 times. A wrap bug that needs the head at one particular index cannot hide.' },
      ] },
    `\`make test\` builds each test program with \`-fsanitize=address,undefined\` and runs it:

\`\`\`
test_ringbuf: 4043 checks, 0 failures
test_line_rx: 18 checks, 0 failures
test_lock: 18 checks, 0 failures
test_app: 28 checks, 0 failures
ALL TESTS PASSED
\`\`\`

(The \`ran test_…\` lines are omitted.) When a project outgrows a header of macros, **Unity** and **CppUTest** are small frameworks widely used for embedded C, and ESP-IDF integrates Unity for both host and on-target tests.`,
    { t: 'callout', kind: 'note', title: 'What a host test cannot tell you', md: `The host is a 64-bit little-endian machine with a different compiler back end. Host tests do not prove: timing; behaviour that depends on \`int\` being 32 bits versus pointer size (use fixed-width types and this mostly disappears); alignment faults (x86 tolerates unaligned access, Cortex-M0+ does not); anything in the HAL port itself; stack depth on the target. Compile the host tests with \`-m32\` where available to get closer to the target's type sizes, and run a smaller set of tests on the target as well.` },

    `## Deriving tests from requirements

Good tests are not "whatever I thought of". They are derived. Write the requirements as numbered, checkable sentences, then for each one produce test cases by four techniques.

Requirements for the door lock:

- **R1** A correct PIN in state LOCKED opens the latch.
- **R2** The latch closes 5000 ms after opening, or at once on a LOCK command.
- **R3** Three consecutive wrong PINs cause a 30 000 ms lockout during which every PIN is refused.
- **R4** A command line longer than 24 characters is ignored and does not affect the next line.

| Technique | Idea | Cases for the lock |
|---|---|---|
| **Equivalence classes** | Split inputs into groups that should behave alike; test one of each | correct PIN; wrong PIN of right length; too short; too long; empty; non-PIN command |
| **Boundary values** | Bugs live at edges: test at, just below and just above each limit | 4999 ms vs 5000 ms (R2); 2 vs 3 wrong PINs (R3); 24 vs 25 characters (R4); 29 999 vs 30 000 ms |
| **State coverage** | Every state × every event, including "should be ignored" | correct PIN in LOCKOUT; LOCK in LOCKED; wrong PIN in UNLOCKED |
| **Error and abuse cases** | What a hostile or broken sender does | all 256 byte values; a flood larger than the FIFO; a command split across polls; PIN with a correct prefix |

Each row of the right-hand column is a test in \`tests/test_lock.c\`, \`tests/test_line_rx.c\` or \`tests/test_app.c\`. Trace it: \`test_latch_closes_after_timeout\` checks R2 at \`LOCK_UNLOCK_MS - 1\` (still open) and one millisecond later (closed).`,
    { t: 'predict', q: 'Requirement R3 says "three consecutive wrong PINs". A developer tests: three wrong PINs → lockout. Passes. Which additional test is most likely to find a real bug?',
      choices: [
        { t: 'Two wrong, one correct, LOCK, two wrong: must NOT lock out', ok: true, why: 'This probes the word "consecutive". An implementation that never resets the counter on success passes the simple test and fails this one, locking out a legitimate user who mistyped twice last week.' },
        { t: 'Four wrong PINs in a row', why: 'Useful, but after three the device is already in lockout; the fourth mostly re-tests that lockout ignores input.' },
        { t: 'The same three wrong PINs again, to make sure the result is repeatable', why: 'Repeating a passing deterministic test adds no information about untested behaviour.' },
        { t: 'One wrong PIN', why: 'It checks that one failure does not lock out, which the three-PIN test already implies on its way there.' },
      ],
      reveal: 'It exists as `test_good_pin_resets_bad_count` in `tests/test_lock.c`. The habit: for each requirement, ask which *word* an implementation could plausibly get wrong, and test that word.' },
    { t: 'widget', name: 'c-lab', props: clParseTests },

    `## A regression test for every bug

When a bug is found, in the field, on the bench or by a sanitizer:

1. **Reproduce it in a test first.** Write the smallest test that fails because of the bug. Run it and watch it fail. (A test you have never seen fail may be testing nothing.)
2. **Fix the code.** The test passes.
3. **Keep the test for ever.** It is now a *regression test*: if anyone reintroduces the bug, the build breaks that day.

A real example from writing this section. The first version of the flood test in \`tests/test_app.c\` did this:

\`\`\`c
for (int i = 0; i < 100; i++) app_on_rx_byte('x');   /* flood: FIFO holds 63 */
send("\\n");                                          /* end the garbage line */
send("STATUS\\n");
CHECK_STR(fake_tx(), "LOCKED\\n");
\`\`\`

and \`make test\` reported:

\`\`\`
  FAIL tests/test_app.c:107: got "", expected "LOCKED
"
\`\`\`

The application was right and the test's assumption was wrong, in an instructive way: the FIFO was still full when the \`'\\n'\` arrived, so the newline itself was dropped, the parser stayed in its discard state, and the following \`STATUS\` line was swallowed as the tail of the garbage. That is correct behaviour for drop-newest overflow, and it is exactly what a real device does when flooded. The fixed test drains the FIFO first, and the comment in the file records why. Writing the test taught something about the design that reading the code had not.`,
    { t: 'callout', kind: 'mistake', title: 'Tests that cannot fail', md: `A test with no checks, a check on a value the test itself just set, or \`CHECK(result == result)\`. It adds a green line and no information. For every new test, break the code on purpose once (change \`>=\` to \`>\`) and confirm the test goes red. Techniques that do this systematically are called *mutation testing*.` },

    `## Hardware-in-the-loop, as an idea

A HIL rig makes the *board* testable by a script. A host program (usually Python) flashes the firmware, drives the board's inputs, and checks its outputs:

\`\`\`
  test script (PC) ── USB-serial ──► UART RX of device under test
        ▲                              │
        │◄── USB-serial ── UART TX ◄───┘
        ├── GPIO adapter / second MCU ──► buttons, door sensor input
        └── logic analyser / ADC ◄────── latch pin, LED pin
\`\`\`

The test cases are the same ones as on the fake HAL ("send three wrong PINs, expect LOCKOUT, expect the LED pin high"), which is no coincidence: the fake-HAL tests are a model of the HIL tests with the physics removed. HIL then adds what only hardware has: real timing (is the latch pulse 5.00 s?), real electrical behaviour, and the HAL port itself.

Design the firmware to be HIL-friendly: a \`VERSION\` command so the rig knows what it is testing, deterministic responses, and no test-only back doors left in a release build. The security section shows what happens to debug commands that ship.`,
    { t: 'callout', kind: 'decision', title: 'How much testing is enough?', md: `There is no number. A workable policy: every requirement has at least one test; every boundary in the requirements has tests on both sides; every state/event pair that matters for safety or security has a test; every bug ever found has a regression test; and the whole suite runs under sanitizers on every commit in under a minute, so that nobody is tempted to skip it. Coverage tools (\`gcc --coverage\` with \`gcov\`) show which lines the tests never executed: untested lines are a fact worth knowing, while 100 % line coverage proves much less than it sounds.` },

    `## Harder application

Add a feature test-first. New requirement **R5**: *a \`PIN\` command is refused with \`BUSY\` if it arrives less than 500 ms after the previous \`PIN\` command, whether that one was right or wrong; the refused attempt does not count as a wrong PIN.*

1. Before touching \`src/\`, add tests to \`examples/firmware-eng/tests/test_app.c\`. Derive them with the table above: at 499 ms, at 500 ms, the first PIN after boot, a refused attempt followed by a correct one, the counter wrap. Run \`make test\` and confirm they fail for the right reason.
2. Implement R5 in \`src/app.c\`. Where does the "time of last attempt" live, and how do you represent "there has been no attempt yet" without a magic timestamp that breaks at wrap?
3. Run \`make test\` until everything passes, including all the old tests.

Notice step 2's question: at boot \`hal_millis()\` is 0 and the "last attempt" variable is 0, so a naive implementation refuses the first PIN for the first 500 ms. A separate \`bool\` for "an attempt has been made" is cleaner than a special time value. Your test "the first PIN after boot is accepted" catches it.`,
    { t: 'refs', items: [
      { title: 'ESP-IDF Programming Guide: Unit Testing (Unity)', url: 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/unit-tests.html' },
      { title: 'Unity test framework for C', url: 'https://github.com/ThrowTheSwitch/Unity' },
      { title: 'GCC manual: gcov, a test coverage program', url: 'https://gcc.gnu.org/onlinedocs/gcc/Gcov.html' },
      { title: 'MITRE eCTF 2022 insecure example (emulated and physical modes)', url: 'https://github.com/mitre-cyber-academy/2022-ectf-insecure-example/blob/master/getting_started.md' },
    ] },
  ],
  quiz: [
    { q: 'Why should a new regression test be seen to fail before the bug is fixed?', kind: 'concept', choices: [
      { t: 'To prove the test detects the bug: one that passes before and after checks nothing', ok: true, why: 'Only a red-then-green sequence demonstrates that the test is sensitive to the defect it was written for.' },
      { t: 'Because test frameworks need to see one failing run before they will record a baseline', why: 'Frameworks have no such rule. The reason is about evidence, not tooling.' },
      { t: 'To measure, from red to green, how long the bug takes to fix', why: 'Timing the fix is unrelated; the point is validating the test itself.' },
    ] },
    { q: 'A function accepts a length from 1 to 64. Which set of test inputs is the best small selection?', kind: 'code', choices: [
      { t: '0, 1, 64, 65, and one mid-range value', ok: true, why: 'Both boundaries are tested on both sides, plus one representative of the valid class. Off-by-one errors show up exactly at 0/1 and 64/65.' },
      { t: '10, 20, 30, 40, 50', why: 'All five are from the middle of the same equivalence class and behave alike; neither edge is exercised.' },
      { t: 'Every value from 1 to 64, so that nothing in the range is missed', why: 'Thorough inside the valid range but never tries an invalid length, which is where missing checks hide.' },
      { t: 'A random value each run', why: 'Random inputs rarely hit the exact boundaries and make failures hard to reproduce.' },
    ] },
    { q: 'Which bug can a host unit test on a fake HAL NOT find?', kind: 'arch', choices: [
      { t: 'The real UART driver configures the wrong baud-rate divisor', ok: true, why: 'The fake replaces the driver entirely, so nothing in the port is executed. Only a test with the real hardware, or a faithful simulator, runs that code.' },
      { t: 'The lock opens for a correct PIN during lockout', why: 'That is pure logic above the HAL and is exactly what fake-HAL tests exercise.' },
      { t: 'A 25-character line overflows the line buffer', why: 'A parser overflow reproduces on the host, where a sanitizer reports it immediately.' },
      { t: 'The relock timeout fails when the millisecond counter wraps', why: 'The fake\'s controllable clock makes this easy to test on the host.' },
    ] },
    { q: 'What is the main purpose of running host tests under ASan and UBSan?', kind: 'concept', choices: [
      { t: 'To turn silent memory and undefined-behaviour errors into immediate, located failures', ok: true, why: 'Many such errors produce correct-looking output. Instrumentation checks every access and operation and reports the exact line.' },
      { t: 'To make the tests run faster, since instrumented code skips redundant checks', why: 'Sanitizers slow execution and use more memory; they are used for the checking, not speed.' },
      { t: 'To measure which lines of the code the tests execute', why: 'Coverage is a different instrument (`--coverage`/gcov). Sanitizers detect errors, not which lines ran.' },
    ] },
    { q: 'A hardware-in-the-loop rig is most valuable for which kind of requirement?', kind: 'arch', choices: [
      { t: '"The latch output stays high for 5 s ± 1 % after a valid command"', ok: true, why: 'Real timing and pin behaviour exist only on hardware. A fake HAL can check the logic of the timeout but not what the pin physically does.' },
      { t: '"A PIN of the wrong length is rejected and counted as a wrong attempt"', why: 'Pure input validation is checked faster and more precisely by a host unit test.' },
      { t: '"The checksum function returns 0x26 for the bytes a, b, c"', why: 'A deterministic computation needs no board at all.' },
    ] },
    { q: 'A suite reports 100 % line coverage. What does that establish?', kind: 'concept', choices: [
      { t: 'Every line ran at least once; not that the results were checked or that all inputs were tried', ok: true, why: 'Coverage measures execution, not verification. A line can run in a test that asserts nothing, and a line can be correct for the tested inputs and wrong for others.' },
      { t: 'The code has no remaining bugs on any path the tests can reach', why: 'Executing a line with one input says nothing about its behaviour with others, such as boundary values.' },
      { t: 'Every requirement has been implemented and has at least one test that exercises it', why: 'Coverage is measured against code, not requirements. A requirement that was never implemented has no lines to cover.' },
    ] },
  ],
};

export default [build, cross, testing];
