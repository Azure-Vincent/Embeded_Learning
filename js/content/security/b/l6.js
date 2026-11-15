import { C, code, widget, SCOPE } from './util.js';

const CT_SELECT = C`
#include <stddef.h>
#include <stdint.h>

/* Returns a if choose_a is 1, b if choose_a is 0, without a branch.
 * choose_a must be exactly 0 or 1. */
uint32_t ct_select_u32(uint32_t choose_a, uint32_t a, uint32_t b)
{
    uint32_t mask = (uint32_t)0 - choose_a;     /* 0x00000000 or 0xFFFFFFFF */
    return (a & mask) | (b & ~mask);
}

/* Read table[secret_index] while touching every entry, so that neither the
 * time nor the sequence of addresses depends on the index. */
uint8_t ct_lookup(const uint8_t *table, size_t n, size_t secret_index)
{
    uint8_t result = 0u;

    for (size_t i = 0; i < n; i++) {
        size_t x = i ^ secret_index;                    /* 0 only when i == index */
        /* (x | -x) has its top bit set for every non-zero x */
        uint8_t is_eq = (uint8_t)(1u ^ (uint8_t)((x | ((size_t)0 - x)) >> (sizeof(size_t) * 8u - 1u)));
        result |= (uint8_t)(table[i] & (uint8_t)(0u - is_eq));
    }
    return result;
}
`;

const VERIFY_FIXED = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define TAG_LEN 16u

void mac_compute(const uint8_t *msg, size_t len, uint8_t tag[TAG_LEN]);
void audit_count(bool ok);                  /* does the same work for both outcomes */

bool msg_verify(const uint8_t *msg, size_t msg_len, const uint8_t *tag, size_t tag_len)
{
    uint8_t expect[TAG_LEN];
    uint8_t diff = 0u;
    bool ok;

    if (tag_len != TAG_LEN) {               /* a public property of the frame */
        return false;
    }
    mac_compute(msg, msg_len, expect);
    for (size_t i = 0; i < TAG_LEN; i++) {
        diff |= (uint8_t)(expect[i] ^ tag[i]);
    }
    ok = (diff == 0u);
    audit_count(ok);                        /* one path, whatever the result */
    return ok;
}
`;

export default {
  id: 'sec-b-side-channels',
  title: 'Side-channel leakage',
  minutes: 50,
  summary: 'Correct outputs can still leak secrets through time, supply current and electromagnetic emission. What leaks, why, and how to write and test code that does not.',
  skills: ['sec-b-side-channel', 'sec-b-constant-time'],
  blocks: [
    `## The problem

A device verifies a 16-byte MAC on each command and answers "rejected" to every forgery. The MAC algorithm is sound and the key never leaves the chip. A tester on the team connects an oscilloscope to the UART lines and plots the delay between the last byte of a command and the first byte of the reply. The delays fall into seventeen distinct groups.

Why seventeen, and what has the device just told the tester about a tag it was supposed to keep to itself?

## What the weakness is

A [[Side channel]] is information about secret data that escapes through the *physical behaviour* of a computation, not through its defined outputs. The function returns the right answer; how long it took, how much current it drew and what it radiated while computing depend on the values it handled. The three channels that matter for microcontrollers:

| Channel | What is observed | What it depends on |
|---|---|---|
| **Timing** | duration of an operation | which branches were taken, how many loop iterations ran, cache or flash-access behaviour |
| **Power** | supply current over time | which instructions execute and the bits of the data they process |
| **Electromagnetic** | field near the chip or its decoupling network | the same switching currents, observed locally |

CWE-208 covers timing discrepancies; CWE-1300 covers physical side channels.

## How it arises

**Timing.** A processor executes one instruction after another, each taking a number of clock cycles. If a secret decides *which* instructions run — an early \`return\` in a comparison, an \`if (key_bit)\` in a loop, a division or multiplication that takes a data-dependent number of cycles on some cores, a table lookup whose access time depends on the address — then the cycle count is a function of the secret. The seventeen groups in the opening problem are 0 to 16 leading bytes matching in an early-exit comparison.

**Power.** In CMOS logic, significant current flows from the supply only when a node changes state: charging a gate and wire capacitance to the supply voltage takes energy of roughly ½CV² per transition. When a 32-bit register is loaded, the number of bits that flip — and for precharged buses, the number of ones, the [[Hamming weight]] — sets how much charge moves in that clock cycle. The supply current therefore carries a small component proportional to the data being processed, superimposed on a large component that depends on the instruction sequence.

Two consequences follow, at concept level:

- A **single trace** can show the instruction sequence. If the code does different work for a 1 bit and a 0 bit of a key (as naïve modular exponentiation does), the bits can be read from the shape of one recording. This is called simple power analysis.
- With **many traces** and known inputs, statistics can pick the data-dependent component out of the noise. For each guess of one key byte, the analyst predicts the Hamming weight of an intermediate value for every recorded input and checks which guess correlates with the measurements. This is differential, or correlation, [[Power analysis]]. Its significance for a designer is that it attacks one key byte at a time, so the cost grows linearly with key length, not exponentially, and it works against a mathematically flawless cipher implemented without countermeasures.

**Electromagnetic.** The same currents flow through bond wires and power rails and radiate. A small probe near the package observes them without modifying the board, and can be positioned to favour one part of the die.

## What an adversary gains

The secret that the computation depends on: a PIN or MAC tag from a comparison, a key from a cipher. Conditions, which you should weigh in the threat model:

- **Timing:** the ability to submit inputs and measure response time. Coarse measurements over a network need large differences or many samples; a logic analyser on a local interface resolves single clock cycles.
- **Power and EM:** physical possession, measurement equipment, the ability to trigger many operations with known inputs or outputs, and time. This is a laboratory activity, and in an attack-and-defend competition or for a product whose value lies in its keys (a payment terminal, a pay-TV decoder, an HSM), a laboratory is exactly what the adversary has.

A software-only countermeasure that is perfect against timing does not stop power analysis; the channels need separate answers.`,
    { t: 'predict', q: 'In the timing model below, each matching byte adds 8 time units to a comparison and each measurement has random noise with a spread of about 6 units. With one measurement per candidate, the right candidate is often not the slowest. What does averaging 25 measurements per candidate do?', choices: [
      { t: 'The noise in each average shrinks about fivefold while the 8-unit difference stays', ok: true, why: 'The right candidate then separates clearly. Averaging N independent samples reduces random spread by √N. The systematic difference is not reduced, because it is the same every time.' },
      { t: 'Nothing useful: noise is random, so averaging cannot remove it', why: 'Randomness is what makes averaging work: independent errors partly cancel, and a fixed offset does not.' },
      { t: 'It reduces both the noise and the 8-unit difference by the same factor, so nothing is gained', why: 'The difference is present in every sample with the same sign, so the mean keeps it in full.' },
      { t: 'It makes the measurement 25 times more accurate', why: 'The improvement follows the square root of the number of samples, so 25 samples give a factor of 5.' },
    ], reveal: 'This is why "the difference is far smaller than the jitter" is not a defence: it sets the number of samples needed, and adding noise only raises that number.' },
    { t: 'callout', kind: 'sim', md: SCOPE + ` The timing values are produced by a model (base time plus a fixed cost per matching byte plus noise); they are not measurements of any processor.` },
    widget('timing-attack', { defence: 'none' }, 'You met this model in lesson 3. This time treat it as a measurement problem: raise the noise, lower the number of samples, and find the point at which the recovered digit becomes unreliable. Then find how many samples restore it.'),
    widget('timing-attack', { defence: 'constant-time' }, 'With the constant-time comparison, increase the samples as far as the widget allows. Does any candidate separate?'),
    `### Debrief

Against the early-exit comparison, more noise only meant more samples: the signal was always there. Against the constant-time comparison no number of samples helped, because the quantity being estimated does not depend on the guess. The first is *hiding* a leak; the second is *removing* it. Prefer removal wherever it is possible, and treat added noise or random delay as a way to raise cost for the leaks you cannot remove.

## How a team detects it

**Review questions:**

- Which variables are secret (keys, PINs, tags, nonces before use, intermediate cipher state)? Mark them in the code.
- Does any branch condition, loop bound, array index, or early return depend on a marked variable?
- Does anything *after* the secret-dependent operation differ between outcomes: a log write, a flash write to a failure counter, a longer error message?
- Which library performs the cryptography, and does its documentation claim constant-time behaviour and side-channel countermeasures for this platform?
- For the hardware: does the MCU's AES or public-key accelerator document side-channel resistance? Many general-purpose accelerators do not claim any; check the datasheet instead of assuming.

**Why this needs measurement, not only review.** Source code shows intent. The compiler is free to turn a branch-free expression into a branch, or a full loop into an early-exit one, if the observable result is the same; the processor may take a variable number of cycles for some instructions; the library call you did not write may branch internally. Whether the device leaks is a property of the binary on the silicon.

**Measurement approach for timing**, on hardware you own: drive two classes of input (for example "tag wrong in the first byte" and "tag wrong in the last byte", or fixed versus random inputs), record many execution times for each with a cycle counter or a GPIO toggled around the operation and a logic analyser, and compare the two distributions with a statistical test such as Welch's t-test. A consistent difference is a leak. The absence of one is evidence only at the resolution and sample count you used; say so in the report.

**For power and EM**, the equivalent is a leakage assessment on a measurement bench (the same fixed-versus-random idea applied to traces). It needs equipment and experience; for most teams the practical decisions are to use a library or secure element with evaluated countermeasures and to keep long-term keys away from general-purpose code.

## The defences

### Constant-time programming

Three rules, for every marked secret: **no secret-dependent branches, no secret-dependent loop counts, no secret-dependent memory addresses.** The comparison from lesson 3 follows the first two. Selection and table lookup need the same care:`,
    code(CT_SELECT, 'host-tested', { caption: 'Branch-free selection and a lookup that touches every entry. Functionally tested on the host for every index; whether the compiled code is branch-free must be checked in the disassembly of the target build.', explain: [
      { lines: '8', md: 'Subtracting 1 from 0 in unsigned arithmetic gives all ones; subtracting 0 gives zero. The mask is built with arithmetic, not with a comparison the compiler would turn into a conditional branch.' },
      { lines: '9', md: 'Both `a` and `b` are read and combined every time. On a Cortex-M this is a handful of AND/BIC/ORR instructions with no change of control flow.' },
      { lines: '18-23', md: 'Every table entry is read on every call, so the sequence of memory addresses is fixed. `is_eq` is 1 for exactly one iteration; its mask keeps that entry and zeroes the others.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'Assuming the compiler preserves constant-time source', md: `Optimisers reason about values, not time. A loop that ORs differences together can legally be compiled to exit early once the accumulator can no longer return to zero, and a mask-based select can become a conditional branch. Check the disassembly of the release build (\`arm-none-eabi-objdump -d\`) for conditional branches inside the function, repeat after every compiler upgrade or optimisation-level change, and prefer the constant-time primitives of a maintained cryptographic library, which are written and tested with this in mind.` },
    `Make the **whole path** uniform, not only the comparison: reject wrong lengths on public information only, do the same bookkeeping for success and failure, and answer after the same amount of work.

### Against power and EM analysis (concepts)

- **[[Masking]].** Before processing, split each secret value into two or more random shares (for example \`s = s1 XOR s2\` with \`s1\` fresh and random each run) and compute on the shares so that no register ever holds the secret itself. The power drawn in any one cycle then depends on random values, and averaging over many traces no longer converges on the key. Masking a cipher correctly is specialised work; use an implementation that has been evaluated.
- **Hiding.** Reduce the signal or desynchronise the measurements: random delays and shuffled operation order so that traces do not align, noise generation, balanced logic styles and on-chip regulation in dedicated hardware. Hiding raises the number of traces needed; it does not eliminate the leak.
- **Limiting use.** Fewer operations with one key means fewer traces: derive a session key per exchange, cap the number of failed operations (the limiter from lesson 3 doubles as a trace limiter), and keep long-term keys for rare operations.
- **Dedicated hardware.** A [[Secure element]] or a certified accelerator implements these countermeasures in silicon and keeps the key out of the application processor entirely.`,
    { t: 'callout', kind: 'decision', title: 'Software countermeasures or a secure element?', md: `If the threat model includes an adversary with physical possession and measurement equipment, and the asset is a long-term key shared by many devices, software on a general-purpose MCU is the weak choice: constant-time code answers timing only, and home-made masking is easy to get subtly wrong. Putting the key in a secure element, or using per-device keys so that one extracted key is worth one device, changes the economics more than any amount of code. If the model stops at remote adversaries, constant-time code and a rate limit are proportionate. In a competition where the hardware is fixed and opponents will have the board on a bench, do all the software measures and reduce what any one key is worth.` },
    `## Verifying the defence

- **Review plus disassembly** of every function that handles marked secrets: no conditional branch or variable-latency instruction that depends on them.
- **Two-class timing measurement** on the target, at release optimisation, with the result and its limits (resolution, sample count) recorded.
- **Uniform-path tests:** wrong first byte, wrong last byte, wrong length, correct — same response length, and the same side effects apart from the outcome.
- **For power/EM:** evidence from the supplier (evaluation report or certification of the library or element), or a leakage assessment by someone equipped to do one. "We did not see anything on a multimeter" is not evidence.`,
    { t: 'exercise', prompt: `Review this MAC verification. Find every way its externally observable behaviour depends on how much of the tag was right, and write a corrected version.`, code: C`
#define TAG_LEN 16u

bool msg_verify(const uint8_t *msg, size_t msg_len, const uint8_t *tag, size_t tag_len)
{
    uint8_t expect[TAG_LEN];

    mac_compute(msg, msg_len, expect);
    for (size_t i = 0; i < tag_len; i++) {
        if (expect[i] != tag[i]) {
            log_to_flash("bad tag at byte", i);    /* takes several milliseconds */
            return false;
        }
    }
    return true;
}`, hints: [
      'What decides the number of loop iterations in the failing case? In the passing case?',
      'The log call is slow, happens only on failure, and records something. What does it record, and who might read the log?',
      'What happens when `tag_len` is 0? When it is 200?',
    ], solution: `1. **Early exit** — time is proportional to the number of leading correct bytes (CWE-208).
2. **Failure-only slow operation** — the flash write makes the failing path milliseconds longer and is visible on the supply current too; worse, the log stores the index of the first wrong byte, which is the leak itself in persistent form.
3. **Sender-controlled comparison length** — \`tag_len == 0\` accepts everything (lesson 3's logic error); \`tag_len > 16\` reads past \`expect\` (lesson 1).

**Corrected version** (compiled and functionally tested on the host; timing must be confirmed on the target):

\`\`\`c
${VERIFY_FIXED}\`\`\`

The length test may return early because the tag length is visible to anyone watching the link. The bookkeeping records only pass/fail and does the same work for both.` },
    `## Harder application

A firmware team implements the PIN limiter of lesson 3 correctly: the attempt counter is written to flash before the comparison. A colleague points out that on their MCU a flash write is clearly visible as a rise in supply current lasting a few milliseconds, and that the *success* path performs a second write (to reset the counter) while the failure path does not. Explain what an observer of the supply current learns, whether it matters given that the device also replies "OK" or "denied", and in which variant of the design it would matter a great deal (hint: consider a design that decrements the counter only *after* a failed comparison, and an adversary who can cut power quickly). What does this tell you about analysing countermeasures in combination?`,
    { t: 'refs', items: [
      { title: 'CWE-208: Observable Timing Discrepancy', url: 'https://cwe.mitre.org/data/definitions/208.html' },
      { title: 'CWE-1300: Improper Protection of Physical Side Channels', url: 'https://cwe.mitre.org/data/definitions/1300.html' },
      { title: 'CWE-385: Covert Timing Channel', url: 'https://cwe.mitre.org/data/definitions/385.html' },
    ] },
  ],
  quiz: [
    { q: 'Why does the supply current of a CMOS microcontroller carry information about the data it is processing?', kind: 'circuit', choices: [
      { t: 'Current is drawn mainly when nodes switch, and how many bits switch depends on the data', ok: true, why: 'Dynamic power comes from charging and discharging capacitances; the count of switching bits varies with the data.' },
      { t: 'Because ones are stored at a higher voltage than zeros and therefore leak more', why: 'Static levels draw almost no current in CMOS. The data dependence comes from transitions.' },
      { t: 'Because the processor slows its clock when handling secret data', why: 'The clock is fixed by the oscillator and is unaware of what the data means.' },
      { t: 'It does not; current depends only on which instruction is executing', why: 'The instruction sets the large-scale shape of the current, but the operand bits modulate it measurably.' },
    ] },
    { q: 'Which line makes this function leak through timing?', code: C`
bool check(const uint8_t *in, const uint8_t *key, size_t n)   /* 1 */
{
    for (size_t i = 0; i < n; i++) {                            /* 2 */
        if (in[i] != key[i]) return false;                     /* 3 */
    }
    return true;                                                /* 4 */
}`, kind: 'code', choices: [
      { t: 'Line 3: the return inside the loop ends it at the first mismatch', ok: true, why: 'Duration then reveals the number of leading matching bytes. A secret-dependent early exit makes the iteration count, and therefore the time, a function of the secret.' },
      { t: 'Line 2: a `for` loop always has variable timing', why: 'A loop with a public, fixed bound runs the same number of iterations every time. It is the exit condition inside it that varies.' },
      { t: 'Line 4: returning `true` takes longer than returning `false`', why: 'Both returns are a register load and a branch. The difference lies in how many iterations preceded them.' },
      { t: 'Line 1: passing the key by pointer exposes its address', why: 'The address of the key is not the secret and is not what an observer of response time learns.' },
    ] },
    { q: 'A team adds a random delay of 0–2 ms before answering a PIN attempt, instead of making the comparison constant-time. What is the effect?', kind: 'security', choices: [
      { t: 'The leak remains: averaging more measurements recovers it, at higher cost', ok: true, why: 'Independent random delay averages out, while the systematic difference between candidates persists in the mean.' },
      { t: 'The leak is removed, because the response time is now random', why: 'The response time is the sum of a random part and a secret-dependent part. Adding randomness does not subtract the dependent part.' },
      { t: 'The leak becomes worse, because the added delays make each measurement easier to take', why: 'Added jitter makes each measurement less informative, which is some benefit. It just is not a complete one.' },
      { t: 'The comparison becomes constant-time on average', why: 'Constant-time is a property of the comparison code itself; a delay elsewhere does not change which instructions the comparison executes.' },
    ] },
    { q: 'Your constant-time compare passes code review. Which additional step addresses the largest remaining risk?', kind: 'concept', choices: [
      { t: 'Inspect the release disassembly and time two input classes on the target', ok: true, why: 'The compiler may have reintroduced a data-dependent branch. The property that matters belongs to the machine code running on the device, and optimisation can change it without changing results.' },
      { t: 'Run the unit tests under AddressSanitizer', why: 'ASan finds memory errors. A timing dependence involves no invalid access and is invisible to it.' },
      { t: 'Increase the optimisation level so the function runs faster', why: 'Speed is not the goal, and a higher optimisation level gives the compiler more freedom to restructure the loop.' },
      { t: 'Declare the key `const` so the compiler treats it as fixed', why: '`const` prevents writes through that name. It has no bearing on how long reads and comparisons take.' },
    ] },
    { q: 'What does first-order masking of a cipher implementation aim to achieve?', kind: 'concept', choices: [
      { t: 'No intermediate value depends on the secret alone, only on random shares of it', ok: true, why: 'Per-cycle power then no longer correlates with key-dependent data. Splitting secrets into random shares removes the direct statistical link between one measured point and the key.' },
      { t: 'The key is stored encrypted in flash and decrypted only at the moment it is used', why: 'Storage protection concerns the key at rest. Masking concerns the values that exist during the computation.' },
      { t: 'The cipher runs in constant time for every key and input', why: 'Timing and per-cycle power are different channels; a constant-time cipher can still leak its key through data-dependent current.' },
      { t: 'The power supply is filtered so current cannot be measured', why: 'Filtering is a hiding measure applied in hardware. Masking is a change to the computation itself.' },
    ] },
    { q: 'For which product is investing in a secure element with evaluated side-channel countermeasures most clearly justified?', kind: 'security', choices: [
      { t: 'A pay-TV decoder sold to the public, with the same content key in every unit', ok: true, why: 'Adversaries have unlimited physical access to a device they own, and one extracted key compromises the whole system.' },
      { t: 'A temperature logger whose only secret is a per-device Wi-Fi password chosen by its owner', why: 'The person with physical access is the owner, who already knows the password, and extraction affects one device.' },
      { t: 'A development board used in a classroom', why: 'There is no asset on it that outlives the exercise.' },
      { t: 'Any product at all, because software countermeasures never work', why: 'Constant-time code is effective against timing, and whether power analysis is in scope depends on the adversary and the asset.' },
    ] },
  ],
};
export const TESTED = { CT_SELECT, VERIFY_FIXED };
