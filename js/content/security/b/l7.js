import { C, code, widget, SCOPE } from './util.js';

const HARDENED = C`
#include <stddef.h>
#include <stdint.h>

/* Non-trivial status values: far apart in Hamming distance, neither is 0,
 * 1 or all-ones, so a single corrupted bit or a zeroed register is neither. */
#define SEC_PASS  0x3CA5965Au
#define SEC_FAIL  0xC35A69A5u

#define DIGEST_LEN 32u

void digest_compute(const uint8_t *img, size_t len, uint8_t out[DIGEST_LEN]);
void random_delay(void);                    /* platform: a few to a few hundred cycles, from the TRNG */
void fault_detected(void);                  /* platform: erase session keys, log, reset; never returns here in firmware */

/* Compare two digests; returns SEC_PASS only if every byte matches AND the
 * loop demonstrably ran to completion. */
static uint32_t digest_equal(const uint8_t *a, const uint8_t *b)
{
    volatile uint32_t diff = 0u;
    volatile size_t i;

    for (i = 0u; i < DIGEST_LEN; i++) {
        diff |= (uint32_t)(a[i] ^ b[i]);
    }
    if (i != DIGEST_LEN) {                  /* loop was cut short */
        return SEC_FAIL;
    }
    return (diff == 0u) ? SEC_PASS : SEC_FAIL;
}

uint32_t image_check(const uint8_t *img, size_t len, const uint8_t expected[DIGEST_LEN])
{
    uint8_t d1[DIGEST_LEN], d2[DIGEST_LEN];
    volatile uint32_t first = SEC_FAIL;     /* default is failure */
    volatile uint32_t second = SEC_FAIL;

    digest_compute(img, len, d1);
    first = digest_equal(d1, expected);
    if (first != SEC_PASS) {
        return SEC_FAIL;
    }

    random_delay();                         /* the second check is not at a fixed time */

    digest_compute(img, len, d2);           /* recomputed, not a copy of the first result */
    second = digest_equal(expected, d2);
    if (second != SEC_PASS) {
        fault_detected();                   /* first passed, second failed: not a normal error */
        return SEC_FAIL;
    }
    if ((first ^ second) != 0u) {           /* both must hold the same exact constant */
        fault_detected();
        return SEC_FAIL;
    }
    return SEC_PASS;
}
`;

const BOOT_FIXED = C`
#include <stdint.h>

#define SEC_PASS  0x3CA5965Au
#define SEC_FAIL  0xC35A69A5u

uint32_t image_verify(void);        /* returns SEC_PASS or SEC_FAIL */
void jump_to_app(void);
void halt_safe(void);               /* outputs safe, wait for watchdog reset */

void boot_decide(void)
{
    volatile uint32_t r = SEC_FAIL;

    r = image_verify();
    if (r == SEC_PASS) {
        if (r != SEC_PASS) {        /* repeated test: a skipped first branch lands here */
            halt_safe();
            return;
        }
        jump_to_app();
        return;
    }
    halt_safe();                    /* every other value, including a corrupted one */
}
`;

export default {
  id: 'sec-b-fault-injection',
  title: 'Fault injection and glitching',
  minutes: 50,
  summary: 'A disturbance lasting nanoseconds can make a processor skip one instruction. Why that matters, which code is fragile, and how to write checks that fail closed.',
  skills: ['sec-b-fault-hardening'],
  blocks: [
    `## The problem

A bootloader computes the hash of the application, verifies the signature, and executes this:

\`\`\`c
if (verify_signature(image) != 0) {
    halt();
}
jump_to_application();
\`\`\`

The cryptography is correct, the key is in ROM, and no software input makes \`verify_signature\` return 0 for a modified image. The security of the product now rests on one conditional branch instruction being executed correctly, once, at a predictable time after reset.

What if it is not executed correctly?

## What the weakness is

**[[Fault injection]]** is the deliberate, brief disturbance of a device's operating conditions so that it computes something other than what its program says: an instruction is skipped or altered, a value read from memory is wrong, a register bit flips. The disturbance is commonly called a **[[Glitch]]**. The weakness on the designer's side (CWE-1247 for voltage and clock glitches, CWE-1319 for electromagnetic fault injection, CWE-1332 for instruction-skip handling) is a design in which **one** such fault, at one moment, turns "deny" into "allow".

The principle matters to you for a simple reason: every earlier lesson assumed the processor executes the code you wrote. With physical access, that assumption becomes a parameter of the threat model.

## How it arises

Digital logic is built on timing and voltage margins. Recall from the architecture section that each clock edge captures the outputs of combinational logic into flip-flops, and that this works only if the signals have settled before the edge (setup time) and the supply holds the logic levels. A fault is what happens when those margins are violated for a moment:

- **Supply voltage.** A very short dip slows the logic so that the critical path has not settled at the next clock edge; a wrong value is latched. Too long or too deep, and the brown-out detector or power-on reset fires instead.
- **Clock.** An extra or shortened clock pulse gives the logic less than a full period to settle, with the same effect.
- **Electromagnetic pulse ([[EMFI]]).** A small coil near the package induces currents in the chip's internal wiring, disturbing a region of the die without any electrical connection to the board.
- **Light.** On a chip whose package has been opened, a focused flash generates charge carriers in the silicon and can flip individual cells. This needs the most preparation and gives the most spatial precision.

The common *fault models* a designer should assume: an instruction is **skipped** (effectively replaced by a no-op); a **loaded value is corrupted**, often to all zeros or all ones; a **comparison result or flag is wrong**; a loop **exits early**. You do not need to know which physical method produced the fault to design against these models.

**Why timing matters to the adversary, and to your countermeasures:** the disturbance has to coincide with the vulnerable instruction. Code that runs at a fixed number of clock cycles after an observable event (reset release, a UART byte, a GPIO edge) can be targeted by trial and error over the delay and the pulse shape. Most attempts do nothing or reset the chip; the adversary needs only occasional success and can retry indefinitely unless something counts the attempts.

## A vendor-acknowledged example

Espressif's security advisory **AR2023-005** (CVE-2023-35818), "Security Advisory Concerning Bypassing Secure Boot and Flash Encryption Using EMFI", applies to ESP32 chip revisions v3.0 and v3.1, as listed in the vulnerabilities page of the ESP-IDF documentation. Read the advisory itself for the affected products and the vendor's recommendations; this course states only what that listing states. The lesson for a designer is general: hardware security features on a general-purpose MCU are evaluated against a stated threat model, physical fault injection may be outside it, and the vendor's advisories page belongs in your design review inputs.

## What an adversary gains

Whatever the faulted decision was guarding: execution of an unsigned image, a debug port that should have stayed locked, a PIN check that returns success, a loop that copies more than it should, or a faulty cryptographic result from which key material can be derived by analysis. Conditions: physical possession of a unit, the ability to trigger the target operation repeatedly, a timing reference, and equipment whose cost ranges from modest (supply glitching) to substantial (laser). As with power analysis, the question for the threat model is not "is this difficult?" but "does someone with a bench and a week have a reason to do it to this product?"

## Which code patterns are fragile

| Pattern | Why one fault is enough |
|---|---|
| \`if (check() != 0) fail(); proceed();\` | skip the branch (or the call to \`fail\`) and execution falls through to success |
| \`bool ok = true; ... if (bad) ok = false;\` | default is the permissive value; skip the assignment |
| \`if (ok)\` where "true" is any non-zero | almost every corrupted value means "allowed" |
| \`while (!authenticated) { ... }\` followed by privileged code | corrupting the loop condition exits to the privileged code |
| Error handler that returns | a fault that reaches it continues into the protected path |
| A single read of a lock or lifecycle value from fuses or flash | one corrupted read at boot changes the device state for the whole session |
| Fixed timing from reset to the security decision | lets an adversary find the moment by sweeping a delay |`,
    { t: 'predict', q: 'A boot check is hardened by performing the signature comparison twice in a row, with identical code, and booting only if both pass. Assume a single well-timed disturbance can skip one branch with some probability. How much does the repetition help by itself?', choices: [
      { t: 'It helps, but only partly: a second fault can be aimed at a check that follows at a fixed distance', ok: true, why: 'The probability of success falls roughly to the product of two single-fault probabilities, and the adversary must now produce two faults; randomising the gap between the checks removes the fixed second target.' },
      { t: 'It makes the bypass impossible, because one glitch can only ever affect a single instruction', why: 'One disturbance affects a short window. Nothing prevents a second disturbance later, and a wide one may span adjacent instructions.' },
      { t: 'It does not help at all, because the compiler will merge the two checks', why: 'The compiler may merge them, and that must be prevented and verified, but a redundant check that is present in the binary does raise the bar.' },
      { t: 'It exactly halves the probability of a bypass, because there are now two checks', why: 'If one fault succeeds with probability p, two independent faults succeed with roughly p × p, which for small p is far less than half of p.' },
    ], reveal: 'Compare the three runs below. Remember that every number in this simulation is invented to make the shape of the result visible.' },
    { t: 'callout', kind: 'sim', title: 'The numbers are invented', md: SCOPE + `\n\nThe glitch simulation is a probability model. Its time offsets, widths, the size of the vulnerable window and every success rate were chosen for teaching and correspond to no real chip, clock speed or equipment. Its purpose is to show the *shape* of the problem — a narrow window, mostly failed attempts, and how defences change the statistics — not to provide parameters.` },
    widget('glitch-sim', { defence: 'none' }, 'Run 1, single check. Sweep offset and width and look at the map: where are the successes, and what happens at large widths?'),
    widget('glitch-sim', { defence: 'double-check' }, 'Run 2, redundant check. Same sweep. Compare the success rate inside the window with run 1, and note the new outcome that appears.'),
    widget('glitch-sim', { defence: 'random-delay' }, 'Run 3, random delay before the check. What has happened to the window?'),
    `### Debrief

- **Single check:** successes cluster in a narrow band of offsets and a middle range of widths; wide pulses cause resets. Most attempts fail, and that is no comfort, because attempts are free.
- **Redundant check:** a fault that skips one check is now usually *caught* by the other. "Caught" is a new piece of information: the device has seen behaviour that never occurs in normal operation, and it can react.
- **Random delay:** the vulnerable instruction no longer sits at a fixed offset, so there is no window to find in the model. On real hardware, jitter spreads the success probability thin instead of removing it, and an adversary may find another timing reference (for instance the power signature of the check itself). It is a multiplier on effort, to be combined with the others.

## How a team detects it

**Review questions** for every security decision (boot verification, debug unlock, authentication result, lifecycle check, bounds check on a critical copy):

- If exactly one instruction in this function were skipped, which instruction gives the worst outcome? Does that outcome grant access?
- What value does the result variable hold before the check? If the check never ran, would the code proceed?
- What are the encodings of "pass" and "fail"? How many bit flips separate them?
- Is the decision made once, or re-established at the point of use?
- Does any path that detects an inconsistency simply return an error and allow an immediate retry?
- Look at the disassembly: is the redundancy still there?

**Tools:** instruction-skip simulation in an emulator (replace each instruction of the function in turn with a no-op and record whether the protected action is reached) is practical for small, critical functions and can run in CI. Physical testing on your own boards with glitching equipment belongs with people trained to do it; for most teams the realistic inputs are review, emulator-based fault simulation, and the chip vendor's documentation and advisories.

## The defences

Software cannot prevent a fault. It can make sure that no *single* fault yields success, and that faults are noticed.

1. **Fail closed.** Initialise results to the failure value. Structure the code so that the protected action is inside the success branch, and falling through or skipping reaches the safe state.
2. **Non-trivial constants.** Encode pass and fail as multi-bit values with a large Hamming distance, and compare for equality with the pass value. A zeroed or all-ones register is then a failure.
3. **Redundant checks**, recomputed from the source data, with the comparison written differently the second time, and a final consistency test.
4. **Random delay** between redundant operations and before critical decisions, from a hardware random source.
5. **Loop completion checks** — confirm afterwards that the counter reached its bound.
6. **React to detection.** A failed redundant check is evidence of an attack or a serious malfunction: erase session keys, increment a persistent counter, reset, and after a threshold refuse to operate.
7. **Re-verify at the point of use** — check the authorisation again immediately before the privileged action, not only at the top of the function.
8. **Hardware detectors** where the chip has them: brown-out and supply monitors, clock monitors, and on security-oriented parts dedicated glitch, EM or light sensors. Enable them and route their events to the same reaction. A [[Brown-out detector]] is designed for slow supply failures and may not respond to very short pulses; do not count it as the only detector.`,
    code(HARDENED, 'host-tested', { caption: 'A redundant, fail-closed verification pattern. Functionally tested on the host (pass, each single-byte mismatch, forced disagreement between the two computations). A host test cannot show fault resistance; check that both comparisons survive in the target disassembly.', explain: [
      { lines: '6-7', md: 'Each constant is the bitwise complement of the other, so 32 bit flips separate them; neither is a value a cleared or saturated register would hold.' },
      { lines: '19-20', md: '`volatile` forces the compiler to perform every read and write of these variables, which stops it folding the loop or the repeated tests into one. It is a blunt tool: verify the result in the disassembly.' },
      { lines: '25-27', md: 'If a fault ends the loop early, `i` is not `DIGEST_LEN` and the function fails. Without this, an early exit leaves `diff` at zero, which reads as "equal".' },
      { lines: '34-35', md: 'Both results start as failure. Skipping either assignment leaves failure in place.' },
      { lines: '43', md: 'The delay makes the distance in time between the first and second decision different on every boot.' },
      { lines: '45-50', md: 'The digest is computed again and compared with the arguments in the other order. A mismatch here, after the first check passed, cannot happen in normal operation, so it is reported as a detected fault and not as an ordinary verification failure.' },
      { lines: '51-54', md: 'A final cross-check that both variables hold the identical pass constant, catching a corrupted value that slipped past one of the equality tests.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'Redundancy the compiler removed', md: `Writing \`if (ok) { if (ok) { boot(); } }\` in C does not put two tests in the binary. The optimiser proves the second is redundant and deletes it; that is its job. Use \`volatile\`, recompute from source data, vary the form of the comparison, and then **read the disassembly** of the release build to confirm two loads, two compares and two branches. Repeat after every toolchain or optimisation change.` },
    { t: 'callout', kind: 'decision', title: 'How much hardening, and where?', md: `These patterns cost code size, time and readability, and every hardened function needs its own review. Apply them to the few decisions that guard the product's assets — boot verification, debug and lifecycle state, authentication results, key-use authorisation, critical length checks — and write ordinary clear code elsewhere. If the threat model has no adversary with physical possession, fail-closed structure and non-trivial constants are still worth having because they are nearly free; redundant computation and random delays are for products, and competitions, where the board will be on someone's bench. If the asset justifies it, choose a microcontroller or secure element with documented fault countermeasures, and treat software hardening as the second layer.` },
    `## Verifying the defence

- **Functional tests** (host): the hardened function returns pass only for the correct input and fail for every single-byte corruption; stubs that make the two computations disagree must reach the fault handler.
- **Disassembly review** of the target build for each hardened function: both checks present, default-fail initialisation present, no fall-through from an error path into the protected action.
- **Instruction-skip simulation**: for each instruction in the decision function, run with that instruction skipped and assert that the protected action is not reached. Record the result per instruction; any single skip that reaches it is a finding.
- **Reaction test**: force the fault handler in a debug build and confirm keys are erased, the event is counted persistently, and the device resets to a safe state.
- **Detector configuration**: read back the brown-out and monitor settings at start-up in production firmware and refuse to continue if they are not as required.
- State the limit honestly in the report: simulation covers the single-skip model you tested, not every physical fault.`,
    { t: 'exercise', prompt: `Review this boot decision. Using the single-instruction-skip model, identify each instruction-level fault that would start an unverified application, then rewrite the function so that no single skip does.`, code: C`
int image_verify(void);             /* returns 0 if the image is valid */

void boot_decide(void)
{
    int bad = image_verify();
    if (bad) {
        halt_safe();
    }
    jump_to_app();
}`, hints: [
      'Walk through the compiled shape: call, store result, compare with zero, conditional branch, call `halt_safe`, call `jump_to_app`. Skip each in turn.',
      'What does `bad` contain if the call to `image_verify` is skipped, or its return value is corrupted to 0? What does C treat as "valid" here?',
      'Put `jump_to_app()` inside the success branch, make success a specific multi-bit constant, default to failure, and test twice.',
    ], solution: `**Single skips that boot an unverified image**

- Skip the conditional branch that guards the \`if\` body → depending on how the compiler laid out the code, execution continues into \`halt_safe()\` (harmless) or straight on to \`jump_to_app()\`. You do not control the layout, so assume the worse case.
- Skip the call to \`halt_safe()\` → falls through to \`jump_to_app()\` (and if \`halt_safe\` ever returns, the same happens with no fault at all).
- Skip the call to \`image_verify()\` → \`bad\` holds whatever was in the return register; zero means "valid".
- Corrupt the returned value to 0 → "valid". Zero is the easiest value to obtain by accident.

**Rewritten** (compiled and functionally tested on the host with stubs for all three outcomes):

\`\`\`c
${BOOT_FIXED}\`\`\`

Success is one exact 32-bit constant; the default is failure; \`jump_to_app()\` is reachable only through two reads and two tests of \`r\`; skipping any single branch or call ends in \`halt_safe()\`, in a second test that fails, or in a return from \`boot_decide\` without booting. That last case puts a requirement on the caller: the code after the call to \`boot_decide()\` must itself be a safe halt, never a fall-through into anything useful. Combine it with a verifier that is itself hardened (the code block above), and confirm in the disassembly that both tests of \`r\` exist.` },
    `## Harder application

A device grants a debug unlock when \`challenge_response_ok()\` returns true, by writing 1 to a memory-mapped \`DEBUG_ENABLE\` register. The function is constant-time and the protocol is sound. Apply this lesson: where are the single points of failure between the cryptographic check and the register write? Which of the eight defences apply, which do not, and what would you ask the chip vendor about the register itself (hint: does it take a one-bit value or a multi-bit key pattern, and can it be written more than once per boot)? Then decide what the device should do after three detected faults, remembering the lockout trade-off from lesson 3.`,
    { t: 'refs', items: [
      { title: 'ESP-IDF v6.1 security documentation: vulnerabilities (lists CVE-2023-35818 / AR2023-005)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/vulnerabilities.rst' },
      { title: 'Espressif security advisories', url: 'https://www.espressif.com/en/support/documents/advisories', note: 'Vendor index; not load-tested from this course\'s build environment.' },
      { title: 'CWE-1247: Improper Protection Against Voltage and Clock Glitches', url: 'https://cwe.mitre.org/data/definitions/1247.html' },
      { title: 'CWE-1319: Improper Protection against Electromagnetic Fault Injection (EM-FI)', url: 'https://cwe.mitre.org/data/definitions/1319.html' },
      { title: 'CWE-1332: Improper Handling of Faults that Lead to Instruction Skips', url: 'https://cwe.mitre.org/data/definitions/1332.html' },
    ] },
  ],
  quiz: [
    { q: 'Which single-instruction skip defeats this check?', code: C`
bool ok = true;
if (!signature_valid(img)) {
    ok = false;
}
if (ok) {
    boot(img);
}`, kind: 'code', choices: [
      { t: 'Skipping `ok = false`, or the branch that leads to it', ok: true, why: '`ok` keeps its permissive initial value. The default is "allowed" and only one instruction changes it, so that instruction is a single point of failure.' },
      { t: 'Skipping the initialisation `ok = true`', why: 'Skipping it leaves `ok` with whatever was on the stack. That is undesirable, but it is not a reliable route to success in the way the default-allow path is.' },
      { t: 'Skipping the call to `boot(img)`', why: 'Skipping the protected action fails safe: the device does not boot. That is a denial of service, not a bypass.' },
      { t: 'None: `signature_valid` is cryptographically sound, so no skip can change its answer', why: 'The fault model does not attack the mathematics. It attacks the few instructions that act on the result.' },
    ] },
    { q: 'Why encode a security result as `0x3CA5965A` / `0xC35A69A5` instead of `true` / `false`?', kind: 'concept', choices: [
      { t: 'A corrupted, zeroed or all-ones value then matches neither constant', ok: true, why: 'The code can treat everything except the precise pass value as failure. With a boolean, any non-zero value passes, and nearly every corruption is non-zero or exactly zero; multi-bit constants make a random fault very unlikely to produce "pass".' },
      { t: 'The constants are secret, so they cannot be guessed', why: 'They are in the firmware image and are not secrets. Their value lies in their distance from each other and from trivial values.' },
      { t: 'Thirty-two-bit comparisons are executed in constant time, unlike tests of a `bool`', why: 'Comparison timing is not the property in question here; a one-bit comparison is also constant-time.' },
      { t: 'It makes the code faster on a 32-bit core', why: 'Loading a 32-bit literal is slightly slower than loading 0 or 1. The cost is accepted for robustness.' },
    ] },
    { q: 'A reviewer finds a duplicated check in the source but only one compare-and-branch in the release disassembly. What is the correct conclusion?', kind: 'security', choices: [
      { t: 'The optimiser removed the check, so the hardening is absent from the product', ok: true, why: 'It must be rewritten so that it survives, then re-verified in the binary. Countermeasures against physical faults exist only if they are in the machine code. Source-level intent is not evidence.' },
      { t: 'The disassembler is wrong; the source code is authoritative', why: 'The device executes the binary. When the two disagree, the binary describes what will run.' },
      { t: 'No action is needed, because the compiler has shown the second check was unnecessary', why: 'The compiler reasons about a fault-free machine, in which the check is indeed redundant. The check exists for the case where that assumption fails.' },
      { t: 'Compile with optimisation disabled for the release', why: 'That may preserve the check by accident, at a cost across the whole program, and still guarantees nothing. Make the redundancy explicit and verify it.' },
    ] },
    { q: 'What does a random delay before a security check contribute, and what does it not?', kind: 'concept', choices: [
      { t: 'It removes the fixed moment a fault is aimed at; a fault that lands is still harmful', ok: true, why: 'It raises the number of attempts needed. Jitter spreads the vulnerable moment over a range. A fault that happens to land on it still works unless other measures catch it.' },
      { t: 'It prevents faults from occurring during the check itself', why: 'A delay is code. It has no influence on the supply voltage or the electromagnetic environment.' },
      { t: 'It makes the check constant-time, which hides its position', why: 'It does the opposite: it deliberately varies timing, for a different purpose.' },
      { t: 'It contributes nothing, because an adversary can always measure the delay and compensate', why: 'Synchronising on some other signal may be possible and must be considered, but it costs additional effort; the measure is useful, though incomplete.' },
    ] },
    { q: 'In the hardened pattern, the first verification passes and the second, recomputed one fails. What should the firmware do?', kind: 'security', choices: [
      { t: 'Treat it as a detected fault: erase volatile secrets, count the event, reset', ok: true, why: 'The count belongs in persistent storage and the reset must end in a safe state. Two computations over the same data cannot disagree in normal operation, so the disagreement is itself the alarm.' },
      { t: 'Retry both checks until they agree', why: 'Unlimited silent retries give whoever is disturbing the device as many attempts as they need.' },
      { t: 'Accept the image, since one of the two checks passed', why: 'Requiring only one of two checks is weaker than a single check: either fault now suffices.' },
      { t: 'Return the ordinary "bad signature" error and continue normally', why: 'An ordinary bad image fails the first check too. Reporting this case as routine discards the one signal that distinguishes an attack.' },
    ] },
    { q: 'What can a host unit test of a fault-hardened function establish?', kind: 'concept', choices: [
      { t: 'Its logic and its forced fault-handling paths, not its resistance to physical faults', ok: true, why: 'Fault resistance depends on the compiled code and the silicon. Host tests check logic, which is necessary and not sufficient.' },
      { t: 'That it resists voltage glitching, if the tests run under UBSan', why: 'Sanitizers detect undefined behaviour in a correctly executing program. They do not model a processor that mis-executes.' },
      { t: 'Nothing; hardened code can only be tested with glitching equipment on the real target', why: 'Logic errors in hardened code are common and are found exactly by ordinary tests; emulator-based skip simulation adds further evidence without equipment.' },
      { t: 'That the compiler kept the redundant checks', why: 'A test observes results, and redundant checks do not change results. Only the disassembly shows whether they are present.' },
    ] },
  ],
};
export const TESTED = { HARDENED, BOOT_FIXED };
