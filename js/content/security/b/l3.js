import { C, code, widget, SCOPE } from './util.js';

const CT_EQUAL = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Compare two equal-length byte strings in time that does not depend on
 * their contents. n must be a public value (a fixed tag or PIN length). */
bool ct_equal(const uint8_t *a, const uint8_t *b, size_t n)
{
    uint8_t diff = 0u;

    for (size_t i = 0; i < n; i++) {
        diff |= (uint8_t)(a[i] ^ b[i]);     /* collects every differing bit */
    }
    return diff == 0u;                      /* one decision, after the whole loop */
}
`;

const AUTH_TRY = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define PIN_LEN        6u
#define MAX_FAILURES   5u

typedef struct {
    uint8_t  pin[PIN_LEN];      /* per-device secret, provisioned at manufacture */
    uint8_t  failures;          /* stored in non-volatile memory on a product    */
    uint32_t not_before;        /* earliest time (s) the next attempt is allowed */
} auth_t;

typedef enum { AUTH_OK, AUTH_DENIED, AUTH_WAIT, AUTH_LOCKED } auth_result_t;

bool ct_equal(const uint8_t *a, const uint8_t *b, size_t n);
void nv_commit(const auth_t *a);            /* platform: write state to NVM */

auth_result_t auth_try(auth_t *a, const uint8_t *input, size_t input_len, uint32_t now_s)
{
    uint8_t candidate[PIN_LEN] = { 0 };
    bool match;

    if (a->failures >= MAX_FAILURES) {
        return AUTH_LOCKED;                 /* needs an authenticated reset procedure */
    }
    if (now_s < a->not_before) {
        return AUTH_WAIT;
    }

    /* Charge the attempt BEFORE comparing, and make it durable. */
    a->failures++;
    a->not_before = now_s + (1u << a->failures);    /* 2, 4, 8, 16, 32 s */
    nv_commit(a);

    /* Fixed-length compare: wrong-length input is copied into a zero-padded
     * buffer and compared anyway, so length is checked without an early exit. */
    for (size_t i = 0; i < PIN_LEN && i < input_len; i++) {
        candidate[i] = input[i];
    }
    match = ct_equal(candidate, a->pin, PIN_LEN) && (input_len == PIN_LEN);

    if (!match) {
        return AUTH_DENIED;
    }
    a->failures = 0u;                       /* success refunds the attempt */
    a->not_before = now_s;
    nv_commit(a);
    return AUTH_OK;
}
`;

const PIN_CMP_FIXED = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define PIN_LEN 6u

bool pin_matches(const char *input, const uint8_t stored[PIN_LEN])
{
    uint8_t candidate[PIN_LEN] = { 0 };
    uint8_t diff = 0u;
    size_t n = strlen(input);

    for (size_t i = 0; i < PIN_LEN && i < n; i++) {
        candidate[i] = (uint8_t)input[i];
    }
    for (size_t i = 0; i < PIN_LEN; i++) {
        diff |= (uint8_t)(candidate[i] ^ stored[i]);
    }
    return (diff == 0u) && (n == PIN_LEN);
}
`;

export default {
  id: 'sec-b-authentication',
  title: 'Authentication weaknesses and bypasses',
  minutes: 55,
  summary: 'Shared secrets, leftover factory features, logic slips, unlimited guessing and leaky comparisons: five ways a login stops meaning anything.',
  skills: ['sec-b-auth-review', 'sec-b-constant-time'],
  blocks: [
    `## The problem

A key cabinet has a service port protected by a six-digit installer PIN. The firmware compares the PIN correctly and locks after three wrong attempts. The manufacturer has shipped forty thousand units, and each of them has the same PIN, compiled into the firmware.

One installer leaves the company. How many cabinets must now be considered open?

## What the weakness is

[[Authentication]] is the step in which a device decides *who* is asking, before deciding what they may do. It fails in five recurring ways, which this lesson takes in turn:

| Weakness | CWE | In one line |
|---|---|---|
| Hard-coded or shared credentials | CWE-798 | the secret is in the firmware image, identical on every unit |
| Leftover factory or debug features | CWE-489, CWE-912 | a path that skips the check was never removed |
| Logic errors in the check | CWE-287, CWE-697 | the comparison accepts something it should not |
| No limit on attempts | CWE-307 | a short secret can simply be tried exhaustively |
| Observable comparison | CWE-208 | the time taken reveals how much of a guess was right |

## How each one arises

**Hard-coded credentials.** The PIN is a string literal. The compiler places it in \`.rodata\`, the linker places \`.rodata\` in flash, and the same image is programmed into every unit. Anyone with one unit, or one update file, has the bytes; lesson 5 shows how little effort that takes. The secret is then valid for the entire fleet and cannot be changed without a firmware update.

**Leftover factory features.** Production lines need to write serial numbers, calibrate sensors and read back memory, and they need to do it before any key is provisioned. The convenient implementation is a console command or a magic packet that bypasses authentication, enabled by a build flag. The defect is a release build with the flag still set, or a command that is hidden from \`help\` and still in the dispatch table.

**Logic errors.** The comparison is written, but it compares the wrong thing: the wrong length, an inverted sense, an uninitialised result, an error code treated as success. These pass every test that uses the right PIN and one wrong PIN.

**No rate limit.** A six-digit PIN has 10⁶ values. At ten guesses a second over a UART that is about 28 hours for the whole space, and half that on average. A lockout stored only in RAM is reset by a power cycle.

**Observable comparison.** \`memcmp\` and \`strcmp\` return at the first differing byte. A guess with a correct first byte takes one loop iteration longer than a guess with a wrong first byte. If the adversary can measure response time precisely enough, the secret can be found one byte at a time: 10 × 6 = 60 candidates for a six-digit PIN instead of 10⁶.

## What an adversary gains

Whatever the authenticated role can do: open the cabinet, read the audit log, change configuration, install firmware. The conditions differ by weakness and that difference drives your priorities:

- A shared credential needs **one** leak, from any unit, any installer or any firmware file, and then scales to every device with no further effort. This is why it is usually the most serious finding in a review.
- A factory back door needs knowledge of the command, which the firmware image provides.
- A logic error needs only the right malformed input.
- Guessing needs time and an interface that keeps answering.
- A timing leak needs many precise measurements, so it is harder over a noisy network and easy with physical access to a UART.`,
    { t: 'callout', kind: 'sim', md: SCOPE + ` You will use two simulated devices and one timing model. Use only what the simulated console and its side panels give you.` },
    widget('vuln-device', { device: 'debug-backdoor' }, 'Device 1: a thermostat whose release firmware still contains something from the factory. Before you type anything, compare the `help` output with the strings panel and write down what you expect to find.'),
    widget('vuln-device', { device: 'hardcoded-pin' }, 'Device 2: a key cabinet with a three-attempt lockout. The lockout works. Ask yourself where else the PIN exists besides the installer\'s memory. Note also what the lockout does to a legitimate owner once an outsider has used up the attempts.'),
    `### Debrief of the two devices

The thermostat authenticated nothing on its factory command; hiding the command from the help text was the only barrier. The cabinet authenticated properly and limited attempts properly, and neither mattered, because the secret was the same constant in every image. Both were found by reading, not by guessing.

The cabinet also shows a design tension: its lockout is permanent ("factory service required"), so three wrong PINs from anyone with access to the port take the product out of service. A limiter is itself an interface an adversary can use, and it has to be designed with that in mind.`,
    { t: 'predict', q: 'A PIN check uses a loop that returns `false` at the first wrong digit. The PIN is `7319`. An observer times many attempts of each of these guesses. Which takes longest on average?', choices: [
      { t: '`7300`', ok: true, why: 'Two leading digits match, so the loop runs three iterations before it finds a difference; the other guesses fail on the first or second.' },
      { t: '`0319`', why: 'Three digits are right, but the first is wrong, and the loop stops at the first mismatch without looking at the rest.' },
      { t: '`7000`', why: 'One leading digit matches, so the loop exits on its second iteration, earlier than a guess with a longer correct prefix.' },
      { t: 'All four take the same time because all four are wrong', why: 'They all return the same value, but they do not all do the same amount of work before returning it.' },
    ], reveal: 'Time grows with the length of the correct prefix. That turns a search over all PINs into a search over one digit at a time.' },
    widget('timing-attack', { defence: 'none' }, 'The model returns a comparison time with noise. Recover the first digits and note how many samples you need before the best candidate is clearly separated.'),
    widget('timing-attack', { defence: 'constant-time' }, 'Same procedure against a constant-time comparison. Look at the spread of the candidates\' mean times.'),
    `With the constant-time comparison every candidate takes the same time apart from noise, so the measurement carries no information about the secret. Lesson 6 returns to this model to look at noise, sample counts and other channels.

## How a team detects these

**Review questions:**

- Is any credential, key or token identical across units? Where is each one generated, and by whom?
- List every interface (UART, USB, BLE, test pads, bootloader). For each command on each interface: what is checked before it runs? A table with an empty cell is a finding.
- Which code is compiled only for the factory? Is there a build-time check that it is absent from release builds?
- For each check: what is the value of the result variable *before* the check runs? What happens for empty input, over-long input, and when a called function returns an error?
- How many guesses per day does each interface allow, and does that survive a reset?
- Which function compares the secret, and does it return early?

**Tools and tests:**

- Run \`strings\` on the release binary and grep for credentials, \`debug\`, \`test\`, \`factory\`, \`TODO\`. Secret scanners in continuous integration do the same for the source tree.
- Diff the command tables of factory and release builds.
- Negative tests: empty input, one character, correct prefix, correct PIN plus extra characters, every command without logging in.
- For the limiter: wrong attempts, power cycle, check the count.
- For timing: measurement, covered in lesson 6.

## The defences

**Per-device secrets.** Generate each unit's credential at manufacture from a random source, store it in the chip's protected storage (part A covers key storage), and print or deliver it out of band. Where the product has a back-end, prefer per-device keys and a challenge–response (next lesson) over anything a person types.

**Factory features compiled out, not hidden.** Guard them with the preprocessor and make the release build fail if the guard is set. The simulation's debrief shows the pattern: an \`#error\` when both \`MFG_TEST\` and \`RELEASE_BUILD\` are defined.

**Fail-closed checks.** Initialise the result to "denied", set it to "allowed" in exactly one place, and compare fixed lengths.

**Constant-time comparison of secrets:**`,
    code(CT_EQUAL, 'host-tested', { caption: 'Constant-time equality. Functionally tested on the host; timing behaviour must be confirmed on the target (lesson 6).', explain: [
      { lines: '11-13', md: 'The loop always runs `n` times. XOR gives zero for equal bytes; OR accumulates any non-zero bit. The source has no branch that depends on the data. Whether the compiled code keeps that property is up to the compiler, so it is confirmed in the disassembly and by measurement (lesson 6).' },
      { lines: '14', md: 'The only data-dependent decision happens once, after all bytes were processed, and reveals only equal/not equal — which the response reveals anyway.' },
    ] }),
    `**A limiter that survives resets and is charged first:**`,
    code(AUTH_TRY, 'host-tested', { caption: 'Attempt limiter with increasing delay. Tested on the host with a stub nv_commit, including a simulated power loss between the charge and the comparison.', explain: [
      { lines: '31-34', md: 'The failure count is incremented and written to non-volatile memory **before** the comparison. If the count were updated only after a failed compare, cutting power in the gap between "compare failed" and "count written" would give unlimited free guesses.' },
      { lines: '36-41', md: 'The input is copied into a fixed-size, zero-padded buffer, so the comparison always processes `PIN_LEN` bytes. The length test is combined with `&&` after the comparison has already run.' },
      { lines: '46-48', md: 'Only a success resets the count. The delay doubles with each failure, so an owner who mistypes once or twice only waits a few seconds, while `MAX_FAILURES` consecutive failures end in `AUTH_LOCKED`, which needs a separate, authenticated recovery procedure. Whether that hard limit suits a product is the decision discussed below.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'Comparing with the length the sender supplied', md: `\`strncmp(input, pin, strlen(input)) == 0\` compares only as many characters as were typed. An empty input compares zero characters and matches; a single correct first digit matches. The same slip appears with MACs when the tag length is taken from the message. The length of a comparison must come from the *verifier's* side.` },
    { t: 'callout', kind: 'decision', title: 'Permanent lockout or increasing delay?', md: `A hard lockout after N failures gives the strongest bound on guessing (N guesses, ever) and hands anyone with access to the interface a way to disable the product. An exponentially increasing delay bounds guessing to a few attempts per hour and recovers by itself, but must persist across power cycles and needs a trustworthy notion of time, or a counter in non-volatile memory with a wait enforced after reset. Choose from the threat model: for an HSM-like device holding high-value keys, a hard limit with an authenticated recovery path is defensible; for a door that people must get through, it usually is not. Whatever you choose, write down how many guesses per day it permits and compare that with the size of the secret.` },
    `## Verifying the defences

- **Uniqueness:** read the credential from several production units and confirm they differ; grep the release image for any of them.
- **Factory code absent:** a CI step that greps the release binary for factory strings; a test that sends every factory command to a release build and expects "unknown command".
- **Check logic:** the negative tests listed above, plus forcing each called function to return an error.
- **Limiter:** N wrong attempts, then reset and power-cycle, then confirm the correct PIN is still delayed or refused; remove power immediately after sending a wrong PIN and confirm the count still rose.
- **Timing:** review that every secret comparison uses the constant-time function, inspect the disassembly for an early exit, and measure (lesson 6).`,
    { t: 'exercise', prompt: `Review this PIN check from a service console. \`input\` is the NUL-terminated text the user typed. Find two defects that let a wrong input be accepted or help an adversary find the PIN, and write a corrected function.`, code: C`
#define PIN_LEN 6u

bool pin_matches(const char *input, const uint8_t stored[PIN_LEN])
{
    return strncmp(input, (const char *)stored, strlen(input)) == 0;
}`, hints: [
      'What does `strncmp` return when asked to compare zero characters?',
      'Who chooses the third argument? Try the inputs "" and a single digit.',
      'After fixing the length, look at how `strncmp` behaves when the first character differs versus the last.',
    ], solution: `**Defect 1 — logic error (CWE-287/CWE-697):** the comparison length is \`strlen(input)\`, chosen by the user. An empty line compares zero characters and returns "equal". A one-digit input needs at most ten tries; each further digit ten more.

**Defect 2 — timing leak (CWE-208):** \`strncmp\` stops at the first difference.

(Also: \`stored\` is not NUL-terminated, so treating it as a C string is fragile.)

**Corrected version** (compiled and tested on the host):

\`\`\`c
${PIN_CMP_FIXED}\`\`\`

**Tests:** empty input, "7", the correct PIN, the correct PIN with one digit changed at each position, the correct PIN followed by an extra character, a 200-character input. Then put the call behind the attempt limiter: the function above decides *whether* a guess is right; it does nothing about *how many* guesses are allowed.` },
    `## Harder application

A BLE-connected lock accepts an "owner" command set after pairing and a "service" command set when the first byte of a packet is \`0xA5\` followed by the last four digits of the lock's serial number, which is printed on a label on the outside of the case and included in the BLE advertisement. Classify this design against the five weaknesses, state for each whether it applies, and propose the smallest change that makes the service role mean something. What would you ask the manufacturing team before making your proposal?`,
    { t: 'refs', items: [
      { title: 'CWE-798: Use of Hard-coded Credentials', url: 'https://cwe.mitre.org/data/definitions/798.html' },
      { title: 'CWE-489: Active Debug Code', url: 'https://cwe.mitre.org/data/definitions/489.html' },
      { title: 'CWE-307: Improper Restriction of Excessive Authentication Attempts', url: 'https://cwe.mitre.org/data/definitions/307.html' },
      { title: 'CWE-208: Observable Timing Discrepancy', url: 'https://cwe.mitre.org/data/definitions/208.html' },
      { title: 'CWE-287: Improper Authentication', url: 'https://cwe.mitre.org/data/definitions/287.html' },
    ] },
  ],
  quiz: [
    { q: 'A review finds `static const char ADMIN_PW[] = "k9!Tz#2q";` in firmware used on every unit. The password is long and random. What is the finding?', kind: 'security', choices: [
      { t: 'A hard-coded shared credential: one firmware image reveals it for the whole fleet', ok: true, why: 'Its strength is irrelevant once it can be read. The weakness is where the secret lives and how many devices share it, not how hard it is to guess.' },
      { t: 'No finding: eight random characters cannot be guessed in a practical time', why: 'Guessing resistance only matters if guessing is the easiest route. Here the bytes can simply be read.' },
      { t: 'The finding is that the password should be stored in RAM instead of flash', why: 'A constant has to be loaded from the image to reach RAM, so it is still in the image and still identical everywhere.' },
      { t: 'The finding is that `const` data can be modified at run time', why: 'Being read-only is not the issue; being readable and shared is.' },
    ] },
    { q: 'Which change removes a factory test command from the release product most reliably?', kind: 'security', choices: [
      { t: 'Compile it out, and make the release build fail if the factory flag is set', ok: true, why: 'Add `#error` when `MFG_TEST` and `RELEASE_BUILD` are both defined, and grep the release binary for the command\'s strings in CI. The code is absent from the image, the build cannot be misconfigured silently, and an independent check confirms it.' },
      { t: 'Remove the command from the `help` output so that users cannot discover it', why: 'The dispatch table still contains it. Help text is documentation, not access control.' },
      { t: 'Rename the command to a long random string that only the factory knows', why: 'The new name is a string in the firmware image like any other and becomes a shared hard-coded credential.' },
      { t: 'Check a run-time flag in RAM that the factory tool sets before each test', why: 'The code path still exists in every shipped unit and is one memory write, or one fault, away from being enabled.' },
    ] },
    { q: 'What is wrong with this limiter?', code: C`
if (!pin_ok(input)) {
    failures++;
    nv_write(&failures);
    return DENIED;
}`, kind: 'code', choices: [
      { t: 'The attempt is recorded only after a failed comparison, so cutting power in between hides the guess', ok: true, why: 'The durable charge must come before the comparison, with a refund on success.' },
      { t: '`failures` should be decremented rather than incremented', why: 'Counting up to a limit and counting down from one are equivalent; the direction is not the defect.' },
      { t: 'Writing to non-volatile memory on every failure wears out the flash, so the count should stay in RAM', why: 'A RAM counter is cleared by a reset, which the person guessing controls. Wear is managed by limiting attempts, which is the purpose of the counter.' },
      { t: 'Nothing: the failure is stored in non-volatile memory', why: 'It is stored, but at a moment the adversary can prevent from being reached.' },
    ] },
    { q: 'An engineer replaces `memcmp(tag, expect, 8) == 0` with a loop that ORs together the XOR of each byte pair and compares the result with zero at the end. Which property changed?', kind: 'concept', choices: [
      { t: 'Execution time no longer depends on the position of the first differing byte', ok: true, why: 'Every byte is processed for every input, so the duration carries no information about how many leading bytes were right.' },
      { t: 'The comparison now also authenticates the message length, because every byte is visited', why: 'Both versions compare a fixed eight bytes. Length handling is a separate check.' },
      { t: 'The comparison is faster for wrong tags, which are the common case', why: 'It is slower for wrong tags, because it no longer stops early. That uniformity is the point.' },
      { t: 'The tag is now encrypted by the XOR while it is being compared', why: 'XOR with the expected value is arithmetic for finding differences, not encryption.' },
    ] },
    { q: 'A product authenticates the service port with a 4-digit PIN and allows 3 attempts, after which it waits 60 seconds and allows 3 more. The counter is held in RAM. Roughly how is its guessing resistance best described?', kind: 'security', choices: [
      { t: 'Poor: a reset clears the counter, and 10,000 values are few', ok: true, why: 'The real limit is how fast the device reboots. The limiter must persist across resets to bound guesses, and even then 4,320 guesses a day against 10,000 values is under three days.' },
      { t: 'Good: three attempts out of 10,000 is a 0.03% chance', why: 'That is the chance for the first three guesses only. The device goes on to allow three more every minute, indefinitely.' },
      { t: 'Good: 60 seconds is long enough to deter anyone', why: 'An automated sender is not deterred by waiting. The question is how many guesses fit into the time available.' },
      { t: 'It cannot be assessed without knowing the PIN', why: 'Guessing resistance is a property of the space of possible secrets and the rate allowed, independent of the particular value.' },
    ] },
    { q: 'Which test would have caught `strncmp(input, pin, strlen(input)) == 0` before release?', kind: 'code', choices: [
      { t: 'A negative test with an empty string and a one-character correct prefix', ok: true, why: 'Both must be denied. The defect only appears for inputs shorter than the secret, which positive tests and full-length wrong PINs never exercise.' },
      { t: 'A positive test that submits the correct PIN', why: 'The correct PIN is accepted by both the defective and the correct implementation, so it cannot tell them apart.' },
      { t: 'A negative test with a wrong PIN of the correct length', why: 'A full-length wrong PIN is compared in full and rejected, so the defective code passes this test.' },
      { t: 'Running the correct-PIN test under AddressSanitizer and UBSan in a host build', why: 'No memory is accessed out of bounds here. The defect is in what the code decides, not where it reads or writes.' },
    ] },
  ],
};
export const TESTED = { CT_EQUAL, AUTH_TRY, PIN_CMP_FIXED };
