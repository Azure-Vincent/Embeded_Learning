import { CMD_H, REVIEW_ME } from './lab-src.js';

const FINDING_TEMPLATE = `Finding <n>: <short title>
Location:     file, function, line(s)
Class:        CWE-<number> <name>
Description:  what the code does, and what it should have checked
Trigger:      the input or condition that reaches the defect (described, not weaponised)
Consequence:  what changes in the device, and what an adversary gains
Severity:     high / medium / low, with one sentence of reasoning
Fix:          the code change, in one or two sentences
Test:         the test that fails before the fix and passes after it`;

export default {
  id: 'sec-b-lab-review',
  title: 'Lab: security review of a small firmware module',
  kind: 'Guided laboratory',
  minutes: 150,
  summary: 'Review an 80-line command handler with seeded defects, write findings with class, consequence, fix and test, apply the fixes, and prove them with host tests under AddressSanitizer and UBSan.',
  skills: ['sec-b-security-review', 'sec-b-find-overflow', 'sec-b-safe-length', 'sec-b-auth-review', 'sec-b-freshness', 'sec-b-sanitizer-tests'],
  objectives: [
    'Read a C module the way a reviewer does: by tracing every externally supplied value to the places it is used.',
    'Classify each defect with a CWE number and state its consequence for this product.',
    'Write a finding that another engineer can act on without asking you a question.',
    'Fix each defect at its cause and keep the order: length, version, authenticity, freshness, range.',
    'Prove each fix with a test that fails on the original code and passes on the corrected code, run under sanitizers.',
    'State what host tests cannot prove.',
  ],
  hardware: ['None. This lab runs entirely on your computer.'],
  software: [
    'GCC (or Clang) with AddressSanitizer and UndefinedBehaviorSanitizer runtime libraries, and GNU Make. On Debian or Ubuntu the `build-essential` package provides them.',
    'The course repository directory `examples/security-review/`: `cmd.h`, `review_me.c` (the module under review), `cmd.c` (a corrected version — do not open it until step 6), `test_cmd.c`, `Makefile`.',
    'A text editor and your lab notebook.',
  ],
  background: [
    `The module is the command-frame handler of a fictional lock controller. Frames arrive from a UART or radio driver as a byte array and a length. The handler authenticates the frame and then performs one of three commands: set the device name, write bytes into a configuration block, or unlock.

A colleague wrote \`review_me.c\`. It compiles without warnings under \`-Wall -Wextra -Werror -Wshadow -Wconversion\`, and its happy-path test passes. Your job is the security review before it is merged.

The file contains **seven seeded defects** drawn from lessons 1 to 4 of this half of the section (memory safety, integer handling, authentication, replay and protocol manipulation), plus one design weakness that review can identify and host tests cannot prove fixed. You are not told where they are.`,
    { t: 'callout', kind: 'security', md: `This is a review of code you have been given, on your own computer. The tests feed malformed frames to a function in a host process so that sanitizers can report what the code does with them. That is how a design team tests its own parser. It is not a procedure for use against a product.` },
    { t: 'callout', kind: 'note', title: 'About the MAC in the tests', md: `\`cmd.h\` declares \`platform_mac()\`, which a product would implement with HMAC-SHA-256 or AES-CMAC from a reviewed library. The host tests link a small keyed mixing function in its place. It is **not** cryptographically secure and must not be copied into firmware; it exists so that the handler's logic can be tested without a crypto library.` },
  ],
  diagram: [
    { t: 'ascii', text: `frame (frame_len bytes, from the link driver)
+---------+---------+------------------+--------+-------------------+----------------+
| version | command | counter (4, LE)  | len n  | payload (n bytes) | tag (8 bytes)  |
+---------+---------+------------------+--------+-------------------+----------------+
  [0]       [1]       [2..5]             [6]      [7 .. 7+n)          [7+n .. 7+n+8)
  |<------------------------- covered by the tag ------------------->|

cmd_ctx_t (device state)
+----------------+-----------+---------------+----------------+
| name[16]       | unlocked  | cfg[64]       | last_counter   |
+----------------+-----------+---------------+----------------+
                   ^ directly after name[], as in the stack-smash simulation`, caption: 'Frame layout and the state the handler modifies. Keep this beside the code while you review.' },
    { t: 'code', lang: 'c', code: CMD_H, status: 'host-tested', caption: 'cmd.h — the interface. Shared by the defective and the corrected module.' },
  ],
  steps: [
    { title: 'Build and run the happy-path test',
      md: `In \`examples/security-review/\` run \`make happy\`. This builds \`review_me.c\` **without** sanitizers and runs only the first test, which sends three well-formed frames. You should see \`all checks passed\`.

Write in your notebook: what has this test shown, and what has it not shown? Keep the answer; you will compare it with the result of step 5.` },
    { title: 'Read the module and trace the inputs',
      md: `Read \`review_me.c\` (below, or in your editor). Do not run anything yet.

Make a table with one row for every value that comes from the frame: \`frame_len\`, \`version\`, \`cmd\`, \`counter\`, \`len\`, the payload bytes, the tag. For each row write: its type, its possible range, every place it is used, and what has been checked about it before each use.

Then ask the review questions from lessons 1 to 4:

- For every \`memcpy\` and every array index: destination size, source length, where compared?
- For every \`+\` and \`-\` on a value from the frame: in which type, and can it wrap?
- What is the value of \`authed\` before any check runs? Which paths set it?
- If this exact frame arrives twice, what is different the second time?
- Which bytes does the tag cover, and is any decision made on a frame whose tag was not checked?`,
      code: REVIEW_ME, lang: 'c', status: 'host-tested' },
    { title: 'Write the findings',
      md: `Write one finding per defect, using this template. Aim for seven. A finding is complete when a colleague could fix and test the defect from your text alone.

Order them by severity for *this product* (a lock), and say why. "Any sender can unlock without the key" outranks "a sender who already has the key can corrupt the configuration", even though the second is the classic memory-safety bug.`,
      code: FINDING_TEMPLATE, lang: 'text', status: 'pseudo' },
    { title: 'Write a failing test for each finding',
      md: `Open \`test_cmd.c\` and read \`make_frame()\` and \`send()\`. Note three deliberate choices:

- every frame is a heap block of exactly the frame's size, so a read past the end is reported by AddressSanitizer;
- the context is a heap block, so a write past the end of the struct is reported;
- \`make_frame()\` can produce a frame whose length field disagrees with its real size, and a frame with a zero tag.

For each of your findings, find the test that exercises it (or write your own first, then compare). For each test, predict before running: will the defective module fail by an **ASan report**, a **UBSan report**, or a **failed assertion**? The distinction matters: sanitizers catch memory and arithmetic errors; only assertions catch "the door unlocked when it should not have".` },
    { title: 'Run the full tests against the defective module',
      md: `Run \`make test-vuln\`. This builds \`review_me.c\` with \`-fsanitize=address,undefined -fno-sanitize-recover=all\` and all tests. The target is written to succeed only if the test program **fails**, so you should see a sanitizer report or failed checks followed by make finishing without error.

The sanitizers stop at the first error, so you see one defect per run. To see the others, temporarily reorder or comment out entries in the \`tests[]\` table in \`main()\` and run again. Record, for each test function, how the defective module fails. Compare with your predictions from step 4 and with your notebook answer from step 1.` },
    { title: 'Fix the module',
      md: `Copy \`review_me.c\` to a file of your own (for example \`my_cmd.c\`) and fix every finding. Rules:

- Fix the cause, not the test. If a test sends length 241, the fix is not \`if (len == 241)\`.
- Do all length arithmetic in \`size_t\`. Require the frame to be exactly as long as its length field implies.
- Decide the order of checks and write it as a comment at the top of the function: length, version, authenticity, freshness, then per-command ranges.
- Nothing in \`ctx\` may change unless every check has passed.
- Remove what should not exist; do not hide it behind a flag.

Build your version against the tests:

\`gcc -std=c11 -Wall -Wextra -Werror -Wshadow -Wconversion -g -O1 -fsanitize=address,undefined -fno-sanitize-recover=all test_cmd.c my_cmd.c -o build/test_mine && ./build/test_mine\`

(create the \`build\` directory first if it does not exist). Iterate until every test passes with no sanitizer output. Only then open \`cmd.c\` and compare it with yours line by line. Where they differ, decide which is better and why.` },
    { title: 'Run the reference and the analyser',
      md: `Run \`make test\`. You should see the six test names followed by \`all checks passed\`. Then run \`make analyze\`, which runs GCC's static analyser over both versions. Note what it reports and what it does not: most of the seeded defects depend on run-time values and on intent (a missing replay check is not a memory error), which is why review and tests are both needed.` },
    { title: 'Write the residual-risk note',
      md: `Finish the review with a short note listing what your evidence does **not** cover. At minimum:

- The tag comparison is now constant-time *in the source*. Whether the compiled code on the target has data-independent timing was not measured (lesson 6).
- \`last_counter\` is in RAM in this module. On a product it must be stored in non-volatile memory, and that storage has not been designed or tested here.
- The stand-in MAC proves nothing about the real MAC or its key handling.
- Nothing here addresses fault injection on the authentication decision (lesson 7) or physical access (lesson 8).

A review that states its limits is more useful than one that implies it found everything.` },
  ],
  walkthrough: [
    `Read this after you have attempted steps 2 to 6. It is the reference list of findings for \`review_me.c\`.

**Finding 1 — CWE-757 downgrade; CWE-306 missing authentication**

- **Where:** \`cmd_handle\`: \`if (version >= 2u && !tag_ok(...))\`
- **Consequence:** A frame with version 0 or 1 is never authenticated. Any sender can issue any command, including unlock.
- **Fix:** Accept exactly \`CMD_VERSION\`; reject others before anything else is used.
- **Test:** \`test_authentication\` (version 0, 1, 3)

**Finding 2 — CWE-489 active debug code; CWE-912 hidden functionality**

- **Where:** \`cmd_handle\`: \`if (cmd == CMD_FACTORY) authed = 1;\`
- **Consequence:** The factory command sets \`authed\` regardless of the tag and then unlocks.
- **Fix:** Remove the command from the release module; unknown commands return \`CMD_ERR_COMMAND\`.
- **Test:** \`test_authentication\` (factory, signed and unsigned)

**Finding 3 — CWE-294 capture-replay**

- **Where:** \`cmd_handle\`: \`ctx->last_counter = counter;\` with no comparison
- **Consequence:** A recorded unlock frame is accepted again, indefinitely.
- **Fix:** After the tag check: reject \`counter <= last_counter\`, then store.
- **Test:** \`test_replay\`

**Finding 4 — CWE-190 wraparound leading to CWE-125 out-of-bounds read**

- **Where:** \`cmd_handle\`: \`need = (uint8_t)(CMD_HDR_LEN + len + CMD_TAG_LEN)\`
- **Consequence:** For \`len\` ≥ 241 the sum exceeds 255 and wraps to a small number, so a short frame passes the length check; the MAC and the copies then read far past the end of the frame.
- **Fix:** Compute in \`size_t\`; require \`len == frame_len - HDR - TAG\` after checking \`frame_len >= HDR + TAG\`.
- **Test:** \`test_frame_length\` (ASan: heap-buffer-overflow read)

**Finding 5 — CWE-120 / CWE-787 out-of-bounds write**

- **Where:** \`CMD_SET_NAME\`: \`memcpy(ctx->name, payload, len); ctx->name[len] = 0\`
- **Consequence:** \`len\` up to 255 into a 16-byte array. With 16 the terminator lands on \`unlocked\`; with 17 or more, payload bytes overwrite \`unlocked\` and \`cfg\`; longer still, the write leaves the struct.
- **Fix:** Reject \`len >= CMD_NAME_SIZE\`.
- **Test:** \`test_name_bounds\` (UBSan index report at 16; assertion on \`unlocked\`; ASan past the struct)

**Finding 6 — CWE-190 wraparound and CWE-191 underflow leading to CWE-787**

- **Where:** \`write_cfg\`: \`end = (uint8_t)(off + n)\` and \`n = len - 1\`
- **Consequence:** \`off = 250, n = 10\` gives \`end = 4\`, which passes; the write starts 186 bytes past \`cfg\`. With \`len = 0\`, \`payload[0]\` is not part of the payload and \`n\` becomes 255.
- **Fix:** Require \`len >= 1\`; use \`size_t\`; test \`off <= SIZE\` then \`n <= SIZE - off\`.
- **Test:** \`test_cfg_range\`

**Finding 7 — CWE-208 observable timing discrepancy**

- **Where:** \`tag_ok\`: \`memcmp(...) == 0\`
- **Consequence:** Response time depends on the number of leading tag bytes that are correct, which can allow a tag to be found byte by byte.
- **Fix:** Constant-time comparison.
- **Test:** Functional only (every single-bit change rejected); timing needs measurement on the target

**Design weakness beyond the seven:** \`authed\` is initialised to 1 and cleared on failure — a fail-open structure (lesson 7). The corrected module has no such variable: each check returns an error, and the commands are reachable only after all of them.

### Why the order of checks is what it is

1. **Length first**, because every later step indexes into the frame. Until \`frame_len\` and the length field agree, even reading \`frame[6]\` or the tag is unsafe.
2. **Version next**, because it selects the format that the remaining checks assume.
3. **Authenticity** before any field is believed. The tag covers version, command, counter, length and payload, so after this line all of them are the sender's genuine values.
4. **Freshness** only for authentic frames, so that a forgery cannot move \`last_counter\`. \`test_replay\` checks exactly this: two forged frames with counters 5 and 900 must leave the counter at 5.
5. **Per-command ranges last.** These are needed even for authentic frames: a key holder's bug, or a compromised peer, must not be able to corrupt memory.

### What each kind of evidence showed

- The happy-path test passed on the defective code. Functional tests with valid input say almost nothing about security.
- UBSan reported the index-16 terminator write, a one-byte overflow that stays inside the struct. ASan alone would not have seen it.
- ASan reported the reads past the frame and the writes past the struct.
- Only assertions caught findings 1, 2 and 3: the program did nothing illegal in C terms; it simply unlocked.
- Nothing on the host can demonstrate finding 7 fixed. It is closed by review, disassembly and measurement.`,
  ],
  testing: `You should see, for \`make test\`:

\`\`\`
happy path
name bounds
frame length
cfg range
authentication
replay
all checks passed
\`\`\`

and for \`make test-vuln\`, a sanitizer report naming a line in \`review_me.c\` (with the test order as shipped, UBSan reports an out-of-bounds index in the \`CMD_SET_NAME\` case), after which make exits successfully because the failure was expected.

Your own fixed module is done when it passes all six tests with no sanitizer output, compiles cleanly with \`-Wconversion\`, and you can explain each difference between it and \`cmd.c\`.

These results were produced on the host with GCC 13 when this lab was written. Nothing in this lab was run on a microcontroller.`,
  troubleshooting: [
    { symptom: 'Link error mentioning `libasan` or `libubsan`', cause: 'The sanitizer runtime libraries are not installed for your compiler.', fix: 'Install your distribution\'s sanitizer runtime packages (they come with `build-essential` on current Ubuntu), or build with Clang: `make CC=clang test`.' },
    { symptom: '`make test-vuln` prints a long ASan report and you think the lab is broken', cause: 'That is the expected result: the defective module is supposed to fail.', fix: 'Read the first lines of the report: error type, the line in `review_me.c`, and whether it was a read or a write. Match it to one of your findings.' },
    { symptom: 'Only one defect is ever reported', cause: '`-fno-sanitize-recover=all` stops the program at the first error.', fix: 'Reorder the entries of the `tests[]` table, or run one test at a time, to see how each test fails.' },
    { symptom: 'Your fixed module passes `test_name_bounds` but fails `test_frame_length`', cause: 'The frame length check still uses a narrow type, or accepts frames with trailing bytes.', fix: 'Do the arithmetic in `size_t` and require exact equality between the length field and `frame_len - CMD_HDR_LEN - CMD_TAG_LEN`.' },
    { symptom: '`test_replay` fails on the line that checks `last_counter == 5u`', cause: 'Your code stores the counter before verifying the tag, so forged frames move it.', fix: 'Move the freshness check and the store to after the tag comparison.' },
    { symptom: '`-Wconversion` errors after changing types', cause: 'Mixed `uint8_t`/`size_t` arithmetic now needs explicit, checked conversions.', fix: 'Convert frame fields to `size_t` once, where they are read, and keep them in `size_t`. Avoid casting warnings away.' },
  ],
  challenge: `Extend the module and its tests, without a reference solution:

1. **Persistent counter.** Add \`nv_read\`/\`nv_write\` hooks for \`last_counter\`, decide when the write happens relative to the command being executed, and write a test that simulates power loss between any two steps. No sequence may allow a frame to be accepted twice.
2. **Counter window.** Reject counters more than a fixed distance ahead, and write the tests for both edges and for \`last_counter\` near \`0xFFFFFFFF\`.
3. **Fail-closed hardening.** Apply the non-trivial-constant and double-check pattern of lesson 7 to the authentication decision, then confirm in the disassembly (\`objdump -d\`) that both comparisons are present at \`-O2\`.
4. **Fuzz it.** Write a libFuzzer or AFL++ harness that calls \`cmd_handle\` with arbitrary bytes under the sanitizers, run it against \`review_me.c\` and against your fixed module, and note which of the seven findings fuzzing finds unaided and which it cannot.`,
  quiz: [
    { q: 'The happy-path test passes on `review_me.c`. What does that establish?', kind: 'concept', choices: [
      { t: 'That well-formed, correctly tagged frames are handled as intended; it says nothing about malformed, replayed or unauthenticated frames', ok: true, why: 'Security defects live in the inputs a cooperative sender never produces, and a test of valid input does not reach them.' },
      { t: 'That the module has no memory-safety defects, because nothing crashed', why: 'Valid frames stay inside every buffer. The absence of a crash on inputs that fit says nothing about inputs that do not.' },
      { t: 'That authentication works, because the frames in the test were tagged', why: 'Showing that tagged frames are accepted is different from showing that untagged frames are refused.' },
      { t: 'Nothing at all; happy-path tests are useless', why: 'They show that the fix did not break legitimate use, which every security fix must also preserve.' },
    ] },
    { q: 'In `review_me.c`, `need = (uint8_t)(CMD_HDR_LEN + len + CMD_TAG_LEN)` with a 7-byte header and an 8-byte tag. For which `len` does a 15-byte frame pass `if (need > frame_len) reject`?', kind: 'code', choices: [
      { t: 'Any `len` from 241 to 255, because 15 + len then exceeds 255 and the stored sum wraps to between 0 and 14', ok: true, why: 'The sum is computed as an int and truncated to 8 bits on the cast, so large lengths produce a small `need`.' },
      { t: 'Only `len` = 0', why: 'A zero length gives need = 15, which legitimately fits. The defect concerns lengths that should not fit and are accepted anyway.' },
      { t: 'No value: the addition is done in `int` because of promotion', why: 'Promotion applies to the addition, but the result is then cast to an 8-bit type, which discards the high bits.' },
      { t: 'Any `len` above 15', why: 'Lengths from 1 to 240 give a sum between 16 and 255, which is correctly greater than 15 and rejected.' },
    ] },
    { q: 'Why does the corrected module compare the counter only after verifying the tag?', kind: 'security', choices: [
      { t: 'So that an unauthenticated frame cannot change `last_counter`, which would let a forger lock out the genuine sender', ok: true, why: 'Device state may only be modified by input that has been authenticated.' },
      { t: 'Because the counter is encrypted until the tag has been checked', why: 'The counter is sent in the clear and covered by the tag. Verification makes it trustworthy, not readable.' },
      { t: 'To save time on replayed frames', why: 'Checking the counter first would be faster for replays; the order is chosen for safety, at some cost in speed.' },
      { t: 'The order is arbitrary as long as both checks exist', why: 'With the other order a rejected forgery still leaves a side effect behind.' },
    ] },
    { q: 'A 16-byte name is sent to the defective `CMD_SET_NAME`. ASan alone reports nothing, yet the device state is wrong afterwards. Why, and what catches it?', kind: 'code', choices: [
      { t: 'The terminator is written to `name[16]`, which is the `unlocked` field of the same struct; ASan checks object boundaries only, while UBSan\'s bounds check or an assertion on the result catches it', ok: true, why: 'The write stays inside one heap object. Detecting it needs either index checking against the array type or a functional check of the neighbouring field.' },
      { t: 'ASan is not active for heap memory', why: 'ASan instruments heap allocations thoroughly. The limitation is about fields within a single allocation.' },
      { t: 'Sixteen bytes fit in a 16-byte array, so nothing is wrong', why: 'The data fits; the string terminator that follows it does not.' },
      { t: 'The overflow only happens on the target, not on the host', why: 'The struct layout is the same in both builds for these types, and the same byte is overwritten.' },
    ] },
    { q: 'Which finding from this lab cannot be shown to be fixed by any host test, and how is it closed?', kind: 'security', choices: [
      { t: 'The variable-time tag comparison: it is closed by review of the source, inspection of the target disassembly and a timing measurement on the target', ok: true, why: 'Timing is a property of the compiled code on the real processor. Host tests can only confirm that the new comparison is functionally correct.' },
      { t: 'The missing replay check: replay can only be tested with a radio', why: 'Calling the handler twice with the same bytes reproduces a replay exactly, with no hardware involved.' },
      { t: 'The buffer overflow in `CMD_SET_NAME`: memory layout differs on the target', why: 'The out-of-bounds index is visible to sanitizers and assertions on the host, whatever the eventual layout.' },
      { t: 'The factory command: it only exists in production builds', why: 'The command is in the source under review and is exercised directly by the authentication test.' },
    ] },
  ],
  rubric: [
    { criterion: 'Findings', points: 35, evidence: 'Seven findings, each with location, CWE class, trigger described without a ready-made exploit, consequence for this product, fix and test. Five points each.' },
    { criterion: 'Severity reasoning', points: 10, evidence: 'Findings ordered by consequence for a lock, with authentication bypasses ranked above defects that require the key.' },
    { criterion: 'Fixes', points: 25, evidence: 'Your module passes all six tests under ASan and UBSan with no output from either, and builds with -Wconversion -Werror. Checks are in the order length, version, authenticity, freshness, range.' },
    { criterion: 'Tests', points: 20, evidence: 'For each finding, a test that fails on review_me.c and passes on your module, with a note of whether the failure is an ASan report, a UBSan report or an assertion.' },
    { criterion: 'Residual-risk note', points: 10, evidence: 'States what was not verified: target timing, counter persistence, the real MAC, fault and physical attacks.' },
  ],
};
