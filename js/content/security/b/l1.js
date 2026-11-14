import { C, code, widget, SCOPE } from './util.js';

const BOUNDED_COPY = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

/* Copy src_len bytes into dst and terminate. Returns false, and leaves dst
 * untouched, if the result would not fit. */
bool copy_text(char *dst, size_t dst_size, const uint8_t *src, size_t src_len)
{
    if (dst == NULL || src == NULL || dst_size == 0u) {
        return false;
    }
    if (src_len >= dst_size) {          /* >= : one byte is reserved for '\0' */
        return false;                   /* reject; do not silently truncate   */
    }
    memcpy(dst, src, src_len);
    dst[src_len] = '\0';
    return true;
}
`;

const LINE_FIXED = C`
#include <stdbool.h>
#include <stddef.h>

#define LINE_MAX 32u

typedef struct {
    char   buf[LINE_MAX];
    size_t used;
    bool   overflowed;      /* the current line was too long; discard it at '\n' */
} line_rx_t;

/* Feed one received byte. Returns true when buf holds a complete line. */
bool line_rx_put(line_rx_t *rx, char ch)
{
    if (ch == '\n') {
        bool ok = !rx->overflowed;
        rx->buf[rx->used] = '\0';       /* used <= LINE_MAX - 1 is an invariant */
        rx->used = 0u;
        rx->overflowed = false;
        return ok;
    }
    if (rx->used < LINE_MAX - 1u) {     /* keep one byte for the terminator */
        rx->buf[rx->used++] = ch;
    } else {
        rx->overflowed = true;          /* remember, so a cut-off line is not obeyed */
    }
    return false;
}
`;

export default {
  id: 'sec-b-memory-safety',
  title: 'Memory-safety defects: buffer overflows',
  minutes: 50,
  summary: 'Why one missing length check lets input rewrite a flag or a return address, and how to prevent, detect and test for it.',
  skills: ['sec-b-find-overflow', 'sec-b-bounded-copy', 'sec-b-sanitizer-tests'],
  blocks: [
    { t: 'callout', kind: 'security', title: 'Scope of this half of the section', md: `The next eight lessons are a catalogue of the weakness classes that embedded products suffer from, taught so that you can recognise them in a design or a code review, prevent them, and test that your prevention works. Each lesson answers the same six questions in the same order: what the weakness is, how it arises, what an adversary gains, how a team detects it, how to defend, and how to verify the defence.\n\nAll practice is confined to the simulations built into this course, which run a fictional device in your browser, and to hardware you own. Testing equipment you do not own, or do not have written permission to test, is illegal in most places and is not what this course teaches.` },
    `## The problem

A door controller has a service console. The login routine reads a PIN into a local array, compares it, and sets a flag. In testing, every correct PIN opens the door and every wrong PIN is refused. The product ships. Months later a support engineer pastes a long line into the console by mistake and the door opens.

Nothing in the comparison was wrong. The defect is that the routine wrote more bytes than the array holds, and the bytes after the array happened to be the flag.

## What the weakness is

A **[[Buffer overflow]]** is a write (or read) past the end of the memory an object owns. C does not check array indices or the lengths passed to \`memcpy\`, \`strcpy\`, \`sprintf\` or \`gets\`; the language standard calls an out-of-bounds access [[Undefined behaviour]] and the compiler emits no check. Whatever lives next to the buffer is overwritten. MITRE catalogues the classic form as CWE-120 (buffer copy without checking size of input) and the general form as CWE-787 (out-of-bounds write) and CWE-125 (out-of-bounds read).

## How it arises

Recall the stack model from the architecture section. When a function is called, the processor (or the function prologue) saves the return address and some registers, then reserves space for local variables by moving the stack pointer down. On a Cortex-M the return address is in LR on entry and is pushed to the stack by any function that calls another function. Arrays are filled from low addresses to high addresses, and the saved values sit at higher addresses than the locals. So an array write that runs too far walks *towards* the saved registers and the return address.`,
    { t: 'ascii', text: `higher addresses
  +---------------------+
  | return address      |  <- loaded into PC when the function returns
  | saved frame pointer |
  | authorized (1 byte) |  <- the decision the function makes
  | buf[7]              |
  |  ...                |
  | buf[0]              |  <- copy starts here and moves UP
  +---------------------+
lower addresses         (stack pointer)`, caption: 'The frame the simulation uses. The exact order of locals is chosen by the compiler; the direction of the copy is not.' },
    `Three things make this worse on a microcontroller than on a desktop:

- **No memory protection by default.** Many small MCUs run everything in one privilege level with no [[MPU]] regions configured. A stray write is not stopped by a segmentation fault; it lands in whatever RAM is there, including other tasks' stacks and driver state.
- **Predictable layout.** There is no address-space randomisation. The firmware image is the same on every unit, so an address worked out on one unit is valid on all of them.
- **Everything is close together.** Tens of kilobytes of RAM hold stacks, heap, keys and peripheral state side by side.

The same mechanism applies to globals in \`.data\`/\`.bss\` (the neighbour is the next global the linker placed) and to heap blocks (the neighbour is allocator bookkeeping or another block).

## What an adversary gains

Conceptually there are three levels of consequence, each needing more control than the last:

1. **Crash or reset** — any overflow that reaches saved registers. On a device that should keep running, a remotely triggerable reset is already a denial of service.
2. **Changed data** — the overflow reaches a variable that a later decision depends on (a flag, a length, a pointer, a state variable). No knowledge of code addresses is needed.
3. **Changed control flow** — the overflow replaces the return address, so the function "returns" to a place the sender chose.

The conditions are simple: the adversary must be able to supply the input (a UART console, a radio packet, a file on an SD card) and the copy must be longer than the buffer. You will see all three levels in the simulation.`,
    { t: 'predict', q: 'The simulated function has `char buf[8]` followed in memory by a one-byte `authorized` flag that starts at 0. The copy has no length check. You type nine characters, the ninth being the letter `A` (0x41). The PIN you typed is wrong. What happens?', choices: [
      { t: 'The flag becomes 0x41, which is non-zero, so the code that tests `if (authorized)` treats the session as authorised', ok: true, why: 'The ninth byte lands on the flag. C treats any non-zero value as true, so the wrong PIN no longer matters.' },
      { t: 'The processor raises a fault as soon as the ninth byte is written', why: 'A fault needs something that checks the access: an MPU region, or an unmapped address. The byte after the array is ordinary, writable stack memory.' },
      { t: 'Nothing: the ninth byte is dropped because the array has only eight elements', why: 'Dropping the byte would require a bounds check, and C does not insert one. The array type only affects how the compiler computes addresses.' },
      { t: 'The return address is overwritten and the device resets', why: 'The return address is further up the frame. Nine bytes reach only the first neighbour of the array.' },
    ], reveal: 'The ninth byte overwrites the flag. Keep typing and you reach the saved frame pointer, then the return address. Try it below.' },
    { t: 'callout', kind: 'sim', md: SCOPE + ` The frame layout and the function addresses in the widget are illustrative.` },
    widget('stack-smash', { mitigation: 'none' }, 'Run 1, no mitigation. First make the flag non-zero with exactly one byte too many. Then write far enough to replace the return address and note what the "device" does on return.'),
    widget('stack-smash', { mitigation: 'canary' }, 'Run 2, stack canary. Repeat the same inputs. Which of your two results is stopped, and at what moment — during the copy or at function return?'),
    widget('stack-smash', { mitigation: 'bounds' }, 'Run 3, bounded copy. Repeat once more and compare what is written to memory.'),
    `### Debrief

- With **no mitigation** the copy wrote every byte you typed. One extra byte changed the decision; more bytes changed where the function returns.
- The **canary** is a known value placed between the locals and the saved registers; the function epilogue compares it before returning and aborts on a mismatch. It detected the overflow, but only *after* the copy, and only at return. The corrupted memory was still corrupted. Note where the simulation places the canary relative to the flag; real compilers also try to place arrays above scalar locals for this reason, but a canary never protects one field of a struct from the array before it.
- The **bounded copy** is the only run in which the extra bytes never reached memory. It removes the defect; the canary limits the damage of a defect you have not found yet.

## How a team detects it

**Review questions** to ask of every function that handles external bytes:

- Where does each length come from? Is it a constant, a \`sizeof\`, or a number the sender chose?
- For every write: what is the destination size, and where is it compared with the source length *before* the write?
- Is the terminator counted? A 16-byte array holds a 15-character string.
- Do loops that fill a buffer stop on the buffer size, or only on a delimiter the sender controls?

**Tools:**

- Compiler warnings: build with \`-Wall -Wextra\` and treat warnings as errors. GCC's \`-Wstringop-overflow\`, \`-Warray-bounds\` and \`-Wformat-overflow\` find cases where sizes are visible at compile time. They find nothing when the length arrives at run time.
- Static analysis: \`gcc -fanalyzer\`, the Clang static analyzer, or a commercial MISRA/CERT C checker. The SEI CERT C rules to know are ARR30-C (do not form out-of-range subscripts), ARR38-C (library functions must not form invalid pointers) and STR31-C (enough space for character data and the terminator).
- **Host builds with [[AddressSanitizer]].** Compile the parsing code for your PC with \`-fsanitize=address,undefined\` and run the unit tests. ASan surrounds every stack, global and heap object with poisoned "red zones" and stops at the first out-of-bounds access, naming the line. This is the highest-yield technique in this lesson, and it needs the protocol code to be separable from the hardware, which the firmware engineering section showed how to arrange.
- Fuzzing the same host build (for example with libFuzzer or AFL++) to generate the inputs you did not think of.`,
    { t: 'callout', kind: 'mistake', title: 'Trusting a sanitizer to see inside a struct', md: `ASan checks accesses against the boundaries of whole objects. If \`name[16]\` and \`unlocked\` are fields of the same struct, a 17-byte copy into \`name\` stays inside the struct and ASan reports nothing. Tests for that case must assert on the neighbouring field (or on the return code). The lab at the end of this half of the section shows both kinds of test.` },
    `## The defence

**Remove the defect: every copy is bounded by the destination.** Pass the destination size with the destination pointer, compare before writing, and decide explicitly what "too long" means. For commands and credentials the right answer is nearly always to *reject*, not to truncate: a truncated command is a different command.`,
    code(BOUNDED_COPY, 'host-tested', { caption: 'A bounded copy that rejects oversized input. Tested on the host with lengths 0, size-2, size-1, size and size+1 under ASan.', explain: [
      { lines: '9-11', md: 'Invalid arguments fail closed. A zero-size destination cannot even hold the terminator.' },
      { lines: '12-14', md: '`>=` and not `>`: when `src_len == dst_size` the data would fit but the terminator would be written one byte past the end. This off-by-one is the most common form of the defect.' },
      { lines: '15-16', md: 'Only now is memory written. `memcpy` receives a length that has been proven smaller than the destination.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'Replacing `strcpy` with `strncpy` and stopping there', md: `\`strncpy(dst, src, sizeof dst)\` never overflows, but if the source is as long as the destination it leaves **no terminator**, and the next \`strlen\` or \`printf("%s")\` reads past the end. It also silently truncates. If you use it, write the terminator yourself and check for truncation; better, use a function such as the one above or \`snprintf\` and check its return value against the buffer size.` },
    `**Limit the damage of the defects you have not found:**

- **Stack protector.** GCC and Clang insert a canary check with \`-fstack-protector-strong\` (functions with arrays or address-taken locals) or \`-fstack-protector-all\`. On a bare-metal target you must provide \`__stack_chk_guard\` (initialise it from a random source at boot if you have one) and \`__stack_chk_fail()\`, which should log and reset; check your toolchain's documentation for the exact symbols. Cost: a few instructions per protected function.
- **MPU.** Mark the stack and data non-executable, make flash read-only, and put a no-access guard region below each task stack so that a stack overflow faults instead of walking into another task. The Cortex-M4 in the MAX78000 and the Cortex-M0+ in the MSPM0L2228 both include an MPU (see the platform notes in this course); it does nothing until firmware programs it. Part A of this section covers memory protection configuration.
- **Fault handlers that fail safe.** A detected overflow should end in a controlled reset with the actuator in its safe state, not in a handler that returns.`,
    { t: 'callout', kind: 'decision', title: 'Canary, MPU or bounds checks?', md: `They answer different questions, so the choice is about order, not exclusivity. Bounds checks **prevent** the write and are the only one of the three that keeps the device working correctly; they cost one comparison. The canary and the MPU **detect** a write that already happened and turn silent corruption into a reset; they are worth having because review never finds every defect, but a device that resets on demand is still a device with a vulnerability. Fix the code first, then switch on the mitigations, and never count a mitigation as the fix in a review finding.` },
    `## Verifying the defence

- **Boundary tests** for every buffer of size N: lengths 0, N−1 (longest legal), N and N+1, plus the largest length the transport can carry. Assert on the return code *and* on the neighbouring state.
- Run those tests in a host build with \`-fsanitize=address,undefined -fno-sanitize-recover=all\` in continuous integration.
- Check that the mitigation is really in the image: \`arm-none-eabi-nm firmware.elf | grep __stack_chk\` should list the guard and the fail handler, and the disassembly of a function with a local array should load and compare the guard.
- Test the fail path once on purpose in a debug build: a deliberate overflow must end in your \`__stack_chk_fail\` or MemManage handler and a clean reset.`,
    { t: 'exercise', prompt: `Review this UART line receiver. It is called from the receive interrupt for every byte. State the defect, the input that triggers it, and write a corrected version that never obeys a line that was cut short.`, code: C`
#define LINE_MAX 32u
static char   line[LINE_MAX];
static size_t used;

bool line_rx_put(char ch)
{
    if (ch == '\n') {
        line[used] = '\0';
        used = 0u;
        return true;                /* a complete line is ready */
    }
    line[used++] = ch;
    return false;
}`, hints: [
      'Which condition ends the filling of `line`? Who controls when that condition becomes true?',
      'Consider a sender that transmits 100 bytes and no newline. What is `used` after the 33rd byte, and where is that byte stored?',
      'Bounding the write is half the fix. If you drop the extra characters and then act on the first 31, is that the command the sender typed?',
    ], solution: `**Defect:** the only stop condition is a newline, which the sender controls. Byte 33 onwards is written past \`line[31]\` into whatever the linker placed after it (CWE-120/CWE-787). Even exactly 32 characters followed by a newline writes the terminator out of bounds.

**Fix:** stop storing at \`LINE_MAX - 1\`, remember that the line overflowed, and report the line as invalid when the newline arrives. Keeping state in a struct also makes the function testable on the host.

\`\`\`c
${LINE_FIXED}\`\`\`

**Tests:** lines of 0, 30, 31, 32 and 200 characters; an overlong line followed by a normal one (the second must be accepted); run under ASan. This version was compiled and run that way.` },
    widget('c-lab', {
      title: 'Fix the login copy',
      prompt: `\`check_pin\` copies the received text into an 8-byte local and compares it with the stored PIN. The second test sends a wrong PIN that is long enough to disturb the neighbouring flag. Change \`check_pin\` so that input which does not fit is **rejected** and the flag can only become 1 through the comparison. Do not change \`main\`.`,
      starter: C`
#include <stdio.h>
#include <string.h>
#include <stdint.h>

struct session {
    char    pin[8];
    uint8_t authorized;
};

static const char STORED_PIN[] = "4921";

int check_pin(const char *input)
{
    struct session s;
    s.authorized = 0;
    strcpy(s.pin, input);                 /* defect: no length check */
    if (strcmp(s.pin, STORED_PIN) == 0) {
        s.authorized = 1;
    }
    return s.authorized;
}

int main(void)
{
    char input[64];
    int n = 0, c;
    while ((c = getchar()) > 0 && c != '\n' && n < 63) {
        input[n++] = (char)c;
    }
    input[n] = '\0';
    if (check_pin(input)) {
        puts("unlocked");
    } else {
        puts("denied");
    }
    return 0;
}
`,
      solution: C`
#include <stdio.h>
#include <string.h>
#include <stdint.h>

struct session {
    char    pin[8];
    uint8_t authorized;
};

static const char STORED_PIN[] = "4921";

int check_pin(const char *input)
{
    struct session s;
    s.authorized = 0;
    if (strlen(input) >= sizeof s.pin) {  /* would not fit with its terminator */
        return 0;
    }
    strcpy(s.pin, input);
    if (strcmp(s.pin, STORED_PIN) == 0) {
        s.authorized = 1;
    }
    return s.authorized;
}

int main(void)
{
    char input[64];
    int n = 0, c;
    while ((c = getchar()) > 0 && c != '\n' && n < 63) {
        input[n++] = (char)c;
    }
    input[n] = '\0';
    if (check_pin(input)) {
        puts("unlocked");
    } else {
        puts("denied");
    }
    return 0;
}
`,
      tests: [
        { name: 'correct PIN unlocks', stdin: '4921\n', stdout: 'unlocked' },
        { name: 'wrong PIN, nine characters', stdin: '000000001\n', stdout: 'denied' },
        { name: 'wrong PIN, short', stdin: '1234\n', stdout: 'denied' },
        { name: 'wrong PIN, 40 characters', stdin: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n', stdout: 'denied' },
        { name: 'seven characters still fit', stdin: '4921000\n', stdout: 'denied' },
      ],
      hints: [
        'The struct places `authorized` directly after `pin[8]`. Which byte of a nine-character input lands on it?',
        'Compare the length of the input with `sizeof s.pin` before copying. Remember the terminator needs a byte too.',
        'Return 0 for input that does not fit. Truncating a credential and comparing the rest is not a safe alternative.',
      ],
      explain: 'The check happens before any byte is written, so the flag is only ever set by the comparison. On Bench-MCU, as on a real target, the unfixed version does not crash: it simply gives the wrong answer, which is why this defect survives functional testing.',
    }, 'The interpreter keeps struct fields adjacent in real simulated memory, so the defect behaves as it would on a 32-bit MCU.'),
    `## Harder application

A sensor node receives radio packets into a 64-byte global \`rx_buf\`. The linker map shows the next global is \`tx_power_limit\`, which caps transmit power to stay inside the radio regulations, and after it the function pointer \`on_packet\`. The receive routine copies \`pkt_len\` bytes, where \`pkt_len\` is the first byte of the packet.

Work through the six questions without looking back: what is the weakness, why does the layout matter, what are the three levels of consequence *for this product*, which tool would have found it, what is the fix, and which four packet lengths must the regression test send? Then consider one more thing: the map file is not a secret, and neither is the firmware image (lesson 5), so "nobody knows what is after the buffer" is never a defence.`,
    { t: 'refs', items: [
      { title: 'CWE-120: Buffer Copy without Checking Size of Input ("Classic Buffer Overflow")', url: 'https://cwe.mitre.org/data/definitions/120.html' },
      { title: 'CWE-787: Out-of-bounds Write', url: 'https://cwe.mitre.org/data/definitions/787.html' },
      { title: 'SEI CERT C Coding Standard', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard', note: 'Rules ARR30-C, ARR38-C, STR31-C' },
      { title: 'GCC manual: Program Instrumentation Options', url: 'https://gcc.gnu.org/onlinedocs/gcc/Instrumentation-Options.html', note: '-fstack-protector-*, -fsanitize=address, -fsanitize=undefined' },
    ] },
  ],
  quiz: [
    { q: 'A code review finds this in a packet handler. `len` is the second byte of the received packet. What is the correct finding?', code: C`
uint8_t name[16];
uint8_t len = pkt[1];
memcpy(name, &pkt[2], len);`, kind: 'code', choices: [
      { t: 'Out-of-bounds write: `len` can be up to 255 and is never compared with `sizeof name`', ok: true, why: 'The sender chooses the length and the destination holds 16 bytes. The check must come before the copy.' },
      { t: 'No defect: `uint8_t` limits the length to a safe range', why: 'An 8-bit length still reaches 255, far more than the 16-byte destination. A narrow type limits the size of the problem, not its existence.' },
      { t: 'The defect is that `memcpy` should be `strncpy`', why: 'Changing the function does not help if the length passed to it is still the unchecked value from the packet.' },
      { t: 'The defect is only a possible crash, so it is a reliability issue rather than a security one', why: 'Whatever is stored after the array is overwritten with sender-chosen bytes; that can change decisions without any crash.' },
    ] },
    { q: 'A team enables `-fstack-protector-strong` and closes the review finding "unbounded copy in `cmd_login`" as fixed. Why is that wrong?', kind: 'security', choices: [
      { t: 'The canary is checked only at function return and sits beyond the locals, so a neighbouring local can still be corrupted and used before the check; and a detected overflow is still a remotely triggered reset', ok: true, why: 'A canary is a detector for one consequence. The defect and its other consequences remain.' },
      { t: 'Stack protectors do not work on Cortex-M processors', why: 'They are a compiler feature and work on any target, provided the firmware supplies the guard variable and the fail handler.' },
      { t: 'The canary value is secret, and secrets cannot be stored on a microcontroller', why: 'A guard value does have to be hard to guess, but that is a provisioning detail and not the reason the finding stays open.' },
      { t: 'Canaries slow the function so much that the watchdog will fire', why: 'The cost is a load and a compare per protected function, which is negligible next to a UART byte time.' },
    ] },
    { q: 'Your host test copies 17 bytes into `ctx.name[16]`, which is followed in the same struct by `ctx.unlocked`. The test runs under AddressSanitizer and ASan reports nothing. What should you conclude?', kind: 'concept', choices: [
      { t: 'ASan checks whole-object boundaries, so an overflow that stays inside the struct is invisible to it; the test needs an assertion on `ctx.unlocked` or on the return code', ok: true, why: 'Red zones are placed around objects, not between fields. Functional assertions cover the intra-object case.' },
      { t: 'The code is safe, because ASan detects every out-of-bounds write', why: 'ASan detects accesses that leave an object. Two fields of one struct are the same object as far as its shadow memory is concerned.' },
      { t: 'ASan does not work with `memcpy`', why: 'ASan intercepts `memcpy` and checks both ranges; the limitation here is about where the red zones are, not about which function did the write.' },
      { t: 'The test must be run on the target to mean anything', why: 'The overflow is a property of the C code and is reproducible on the host; what is missing is a check that can see it.' },
    ] },
    { q: 'Which statement about `strncpy(dst, src, sizeof dst)` is correct?', kind: 'code', choices: [
      { t: 'It never writes past `dst`, but leaves `dst` unterminated when `src` has `sizeof dst` or more characters', ok: true, why: 'The next string operation on `dst` then reads past its end, so the defect moves from a write to a read.' },
      { t: 'It always terminates `dst`', why: 'It pads with zeros only when the source is shorter than the count. A full-length source uses every byte for data.' },
      { t: 'It returns the number of characters that did not fit', why: 'It returns the destination pointer, so truncation goes unreported unless you test for it yourself.' },
      { t: 'It is unsafe because it can write more than `sizeof dst` bytes', why: 'It writes exactly the count given. Its problems are the missing terminator and silent truncation.' },
    ] },
    { q: 'A bare-metal product has no MPU regions configured. Which consequence of a stack buffer overflow does this make *more* likely than on a system with memory protection?', kind: 'arch', choices: [
      { t: 'The overflow silently corrupts unrelated state, such as another task\'s stack, because nothing faults on the stray write', ok: true, why: 'Without access permissions every RAM address is writable from every context, so the error is not contained.' },
      { t: 'The compiler refuses to build functions that contain arrays', why: 'The compiler has no knowledge of whether an MPU will be configured at run time.' },
      { t: 'The overflow is automatically detected by the watchdog', why: 'A watchdog detects code that stops feeding it. Corrupted data with a healthy main loop keeps feeding it.' },
      { t: 'The overflow cannot reach the return address', why: 'The frame layout is the same with or without an MPU; protection units police regions, not individual stack slots.' },
    ] },
    { q: 'You must choose the regression test for a fixed 32-byte line buffer. Which set of line lengths gives the most evidence for the least effort?', kind: 'security', choices: [
      { t: '0, 31, 32, 33 and the transport maximum, run under ASan, asserting on the result and on adjacent state', ok: true, why: 'Defects cluster at the boundary: the longest legal value, the first illegal one, and the off-by-one between them.' },
      { t: '5, 10, 15 and 20, because they are typical command lengths', why: 'Typical inputs exercise the path that already worked before the fix. None of them approaches the limit.' },
      { t: 'One line of 10,000 characters', why: 'A huge input shows that gross overflow is handled but says nothing about the off-by-one at the exact boundary.' },
      { t: '31 only, since it is the longest legal line', why: 'The longest legal case shows that the fix did not break valid input; it does not show that invalid input is refused.' },
    ] },
  ],
};
