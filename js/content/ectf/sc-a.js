// Practice scenarios 1 and 2. Original course exercises; not MITRE material.
import { FRAMING } from './prep-a.js';
import { LIMITER_SOL, LIMITER_START } from './code.js';

export const SCENARIO_NOTE = {
  t: 'callout', kind: 'note', title: 'An original course exercise',
  md: `This scenario was written for this course. It follows the *shape* of eCTF work (a functional specification, numbered security requirements, an insecure reference design to review and replace) but it is not an official MITRE challenge and reproduces no competition material. Everything runs against the course's in-browser simulations, host-compiled C, or hardware you own. Nothing here was run on physical hardware by the authors.`,
};

export const METHOD = `Your work in every scenario has the same five parts:

1. **Review** the reference design against the security requirements, interface by interface, using the catalogue from the lesson *Reviewing a design for weaknesses*.
2. **Write the findings** in the standard form (interface, class, requirement affected, defence, verification).
3. **Redesign**: threat model, keys and where they live, message or storage formats, and a security argument per requirement.
4. **Implement** what you can: decision logic in the app's C lab or host-compiled C; the full device on hardware you own if you have it.
5. **Demonstrate** with tests, including negative tests, that every security requirement now holds, and record the evidence.`;

const storage = {
  id: 'ectf-sc-strongbox',
  title: 'Scenario 1: Strongbox, a secure storage device',
  kind: 'Scenario',
  minutes: 240,
  summary: 'A device that releases one stored secret only after PIN authentication. Review the insecure reference design, redesign it, and prove each security requirement with tests.',
  skills: ['ectf-sc-review-reference', 'ectf-sc-secure-storage', 'ectf-sc-evidence'],
  requires: ['embedded-c', 'firmware-eng', 'security'],
  objectives: [
    'Review a small reference design against six numbered security requirements and write findings.',
    'Design PIN authentication with an attempt limit that survives reset and loss of power.',
    'Remove every path by which the secret leaves the device other than the authenticated one.',
    'Demonstrate each security requirement with at least one negative test.',
  ],
  hardware: [
    'None required: the scenario can be completed in the app and with a C compiler on a PC.',
    'Optional: an ESP32 development board you own, with its USB cable, to build the full device.',
  ],
  software: [
    'This app: the `vuln-device`, `firmware-inspector`, `timing-attack`, `stack-smash` and C lab tools.',
    'Optional: gcc on a PC (`gcc -Wall -Wextra -std=c11`) for host-compiled logic and tests.',
    'Optional: ESP-IDF, installed as described in the ESP32 section, if you build on your own board.',
  ],
  requirements: {
    functional: [
      'F1. At build time the device is provisioned with a 6-digit decimal PIN and a secret of 1 to 64 bytes.',
      'F2. The serial console accepts the commands `status`, `unlock <pin>`, `read` and `lock`, one per line, at 115200 baud.',
      'F3. `status` reports `locked` or `unlocked` and the number of attempts remaining, and nothing else.',
      'F4. After a correct `unlock`, `read` returns the secret; `lock`, or a reset, returns the device to the locked state.',
      'F5. Every command receives a response within 1 second.',
    ],
    security: [
      'S1. The secret is released only while the device is unlocked, and it is unlocked only by the provisioned PIN.',
      'S2. No more than 3 PIN guesses can be made between successful unlocks, including across resets and loss of power.',
      'S3. Neither the PIN nor the secret can be recovered from the delivered firmware update file or from any console output. (Assumption to state: whether direct read-out of the chip\'s flash is in scope.)',
      'S4. A response to a wrong PIN reveals nothing about which part of the PIN was wrong, in its content or in its timing.',
      'S5. No command other than those in F2 has any effect; no diagnostic or test function is reachable.',
      'S6. Malformed or over-long input never changes the lock state, the attempt count or memory outside the input buffer; the device stays locked.',
    ],
  },
  background: [
    SCENARIO_NOTE,
    `## The system

Strongbox is the smallest system that still has a real security problem: one device, one interface, one secret. The adversary has the device on their desk. They can type anything at the serial console, reset the device, remove power at any moment, measure how long responses take, and read the firmware update file. Whether they can also read the microcontroller's flash directly is an assumption you must write down for S3, because it changes what is achievable.

${METHOD}`,
    `## The insecure reference design

The reference design implements F1 to F5 and was written with no adversary in mind. It is described here at design level; you will meet the same weakness classes in the simulations.

| Aspect of the reference design | Requirement it falls short of | Why, at design level |
|---|---|---|
| PIN and secret are string constants compiled into the image | S3 | Anything in the image in clear is readable by anyone holding the update file. |
| PIN compared with a loop that stops at the first wrong digit | S4 | Work done, and so response time, depends on the number of correct leading digits. |
| Different messages for "wrong length" and "wrong PIN" | S4 | The response content classifies the guess. |
| Failed-attempt counter is a RAM variable, incremented after the comparison | S2 | A reset restores all attempts; power removed after the comparison means the attempt was never charged. |
| A \`dump\` command, used during development, prints memory | S1, S3, S5 | An unauthenticated path to the secret, outside the specified command set. |
| Input line read into a 16-byte stack buffer until newline | S6, S1 | Input length is never compared with buffer size, so input controls memory beyond the buffer, including the lock flag and saved registers. |
| \`read\` checks a global \`unlocked\` flag that sits next to the input buffer | S1 | The decision depends on a variable that S6's weakness can alter. |`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Strongbox: one trust boundary, at the serial line. The debug port and flash are in or out of scope according to the assumption you record for S3.',
      text: `   PC terminal (adversary)            STRONGBOX
  ┌──────────────────────┐        ╔════════════════════════════════════════╗
  │ status               │  UART  ║ line reader ─▶ command table            ║
  │ unlock <pin>         │───────▶║  (bounded)       │                      ║
  │ read                 │◀───────║                  ▼                      ║
  │ lock                 │        ║   try_unlock(): charge ─▶ compare       ║
  └──────────────────────┘        ║        │                  (const time)  ║
        reset, power ─ ─ ─ ─ ─ ─ ▶║        ▼                                ║
                                  ║   FLASH: fail counter, PIN verifier,    ║
        debug port ─ ─ ─ ─ ─ ─ ─ ▶║          protected secret               ║
                                  ╚════════════════════════════════════════╝` },
    { t: 'ascii', caption: 'Optional hardware build on an ESP32 board you own: the on-board USB-serial bridge is the console. No external wiring is needed.',
      text: `ESP32 dev board                PC
  USB connector  ───────────── USB port   (console at 115200 8N1, and flashing)
  on-board LED   optional: on = unlocked` },
  ],
  steps: [
    { title: 'Number the requirements and record assumptions',
      md: `Copy the requirements into your notebook as a table with columns *ID, statement, verification method, status*. For S3, write the assumption explicitly: "flash read-out through the debug port is **in** scope" or "**out** of scope", and note what each choice would demand of the hardware. For each S requirement write at least one negative test in words now, before looking at any code.` },
    { title: 'Review the reference design: the console',
      md: `Apply the interface list. Start with the serial console. The simulated devices below each exhibit one of the reference design's weaknesses. For each, record a finding: interface, class, requirement affected, defence, verification test.`,
      blocks: [
        { t: 'widget', name: 'vuln-device', props: { device: 'debug-backdoor' }, title: 'A console with more commands than the specification', caption: 'Simulated device. Which requirement does an undocumented command violate before you even know what it does?' },
        { t: 'widget', name: 'vuln-device', props: { device: 'hardcoded-pin' }, title: 'A credential in the image', caption: 'Simulated device. Relate what you find to S3 and to the provisioning requirement F1.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'overflow-auth' }, title: 'An input buffer beside the lock state', caption: 'Simulated device. Identify the missing check and which variable the decision depends on.' },
      ] },
    { title: 'Review the reference design: image, timing and power',
      md: `Now the interfaces that are not commands. Inspect the delivered image as a reviewer would; then look at response time as an output; then walk through \`try_unlock()\` in the reference design asking "what if power is lost here?" after every line.`,
      blocks: [
        { t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' }, title: 'The delivered image', caption: 'A synthetic image bundled with the course. List everything in it that S3 says must not be recoverable.' },
        { t: 'widget', name: 'timing-attack', props: { defence: 'none' }, title: 'Response time of an early-exit comparison', caption: 'Simulated timing. Record what the signal looks like, then what it looks like with the constant-time defence.' },
      ] },
    { title: 'Redesign',
      md: `Write the new design before any code. It must answer:

- **Input**: maximum line length, and what happens to a longer line (discard to end of line, respond with the single generic error, change nothing).
- **Command table**: exactly four entries; default is the generic error.
- **PIN storage**: not the PIN itself. Store a salted hash from a deliberately slow function, or a key derived from the PIN that is needed to unwrap the secret. State honestly that six digits give at most a million candidates, so the attempt limit and protection of stored data carry the weight.
- **Secret storage**: encrypted with an AEAD under a key that is not a constant shared by all devices. Say where that key comes from and what the S3 assumption implies for it.
- **Attempt counter**: in flash; incremented and committed before the comparison; reset only after success; write failure means refusal.
- **Responses**: one message for every failed unlock; constant-time comparison.
- **Lock state**: where it lives, and why malformed input cannot reach it.

Then write the six-part security argument for S1 to S6.` },
    { title: 'Implement the attempt limiter',
      md: `The core of S2 is the order of operations. Fix the reference design's \`try_unlock()\` in the C lab. The test bench plays an honest user, then an adversary who removes power after every guess.`,
      blocks: [
        { t: 'widget', name: 'c-lab', title: 'C lab: charge the attempt before the comparison',
          props: {
            title: 'Attempt limiter',
            prompt: `\`nv_fails\` stands for a counter in flash: it survives the simulated loss of power. \`POWER_POINT()\` marks the instant at which the test bench may cut power (the function returns immediately, as if the device died there).

The reference \`try_unlock()\` compares first and counts afterwards. Run it and read the last output line: after ten wrong guesses, each followed by loss of power, the counter is still 0 and the device still accepts the PIN.

Rewrite \`try_unlock()\` so that S2 holds. Required output:

\`honest: 1 1 fails=0\`
\`after power cuts: 0 fails=3\`

Do not change \`main\`, \`ct_equal\` or the position of \`POWER_POINT()\` relative to the comparison's result being used.`,
            starter: LIMITER_START,
            solution: LIMITER_SOL,
            tests: [{ name: 'honest user unaffected; power cuts do not give free guesses', stdout: 'honest: 1 1 fails=0\nafter power cuts: 0 fails=3\n' }],
            hints: [
              'In the starter, what has been written to `nv_fails` at the moment `POWER_POINT()` is reached?',
              'A guess must be paid for before the device looks at it. Move the increment above the comparison, and check the limit before that.',
              'An honest user must not be penalised for old mistakes: reset the counter, but only on the path where the comparison succeeded.',
            ],
            explain: `The counter is now committed before any information about the guess exists, so no moment of power loss yields a free guess. On real flash the increment is a write that must complete and be checked before the comparison starts; if it fails, refuse. Note the cost you accepted: an honest user who loses power during a correct attempt is charged one attempt. This program was also compiled and run with gcc on a host.`,
          },
          caption: 'Runs in the app\'s C interpreter. `nv_fails` models persistent storage; it is not a real flash driver.' },
      ] },
    { title: 'Implement the rest (host C, or your own ESP32)',
      md: `Write the bounded line reader and the four-entry command table as plain C with no hardware dependencies, plus a small host \`main\` that feeds it lines from standard input. Compile with \`gcc -Wall -Wextra -std=c11 -fsanitize=address,undefined\` and run your negative tests against it.

If you have an ESP32 board: put the same C files in an ESP-IDF project, read lines from the console UART, and keep the counter and protected secret in non-volatile storage. Use the library's AEAD and hash functions (ESP-IDF ships mbedTLS) rather than writing your own. Whether stored data is protected against flash read-out on your board depends on flash encryption, described in the security section; state in your S3 argument whether you enabled it. Enabling flash encryption or secure boot burns eFuses and is irreversible; do not do it on a board you need for other work.` },
    { title: 'Run the tests and write the report',
      md: `Execute the test plan in the Testing section. For each requirement record: test ID, input, expected result, observed result. Finish with the findings table for the reference design, the security arguments for your design, and a residual-risk list.` },
  ],
  walkthrough: `## What the important lines do

**\`if (nv_fails >= MAX_FAILS) return 0;\`** is the lock-out, checked before anything else. It reads persistent state, so it gives the same answer after a reset.

**\`nv_fails++;\`** before the comparison. On a microcontroller this is a flash write: erase-and-program, or programming one more bit of a field in which each attempt clears a bit (flash bits can be programmed from 1 to 0 without an erase, which makes a "one bit per attempt" counter cheap and hard to move backwards). The function must not proceed until the write has completed and been read back.

**\`diff |= a[i] ^ b[i]\`** in \`ct_equal\`. XOR gives zero only for equal bytes; OR accumulates any difference. The loop runs for every byte regardless of content, so the number of instructions executed does not depend on the guess. Check the compiler's output at your optimisation level: constant-time C is a property of the generated code, not of the source.

**\`nv_fails = 0;\`** only after success. This is the single path on which state becomes less restrictive, so it is the line a reviewer reads most carefully.

**The line reader** is the trust boundary. It counts bytes, and on the byte that would exceed the buffer it switches to a "discard until newline" state and reports the generic error, without writing that byte anywhere. The lock flag is not adjacent to anything input can index.`,
  testing: [
    `Run every test against the build you would deliver. "You should see" below describes the required behaviour of a correct design; nothing here was measured on hardware by the authors.

| ID | Requirement | Test | You should see |
|---|---|---|---|
| T-F1 | F1 | Build with two different PIN/secret pairs | Each build accepts only its own PIN and returns its own secret |
| T-F4 | F4 | \`unlock\` correct, \`read\`, \`lock\`, \`read\` | Secret, then refusal |
| T-F5 | F5 | Time every command including a maximum-length line | Under 1 s |
| T-S1-1 | S1 | \`read\` while locked | Refusal; no secret bytes |
| T-S1-2 | S1 | \`read\` after reset following an unlock | Refusal |
| T-S2-1 | S2 | Three wrong PINs, then the correct PIN | Fourth attempt refused |
| T-S2-2 | S2 | Two wrong PINs, reset, two wrong PINs | Lock-out after the third in total |
| T-S2-3 | S2 | Wrong PIN with power removed during the attempt, ten times | Counter reaches the limit (C lab test; on hardware, cut power with a switch) |
| T-S3-1 | S3 | Search the update file for the PIN digits and the secret | Not found |
| T-S3-2 | S3 | Capture all console output across every command and error | PIN and secret never appear, except the secret after a correct unlock |
| T-S4-1 | S4 | Wrong PINs of length 5, 6 and 7; wrong in first digit; wrong in last digit | Byte-identical response |
| T-S4-2 | S4 | Time many attempts with the first wrong digit at each position (on a build with the limit disabled for this test only) | No dependence on position |
| T-S5-1 | S5 | Every command name found in the reference design, plus random words | Generic error; no state change |
| T-S5-2 | S5 | String search of the image for diagnostic command names | Not found |
| T-S6-1 | S6 | Lines of maximum length, maximum + 1, and 10 000 bytes | Generic error; still locked; attempts unchanged |
| T-S6-2 | S6 | Host build under sanitizers fed long random input | No sanitizer report |`,
    { t: 'callout', kind: 'sim', md: `Tests T-S2-3 and T-S4-2 can be demonstrated in the app (the C lab and the timing simulation). They show that the *logic* is right. They do not show that a particular chip's flash write completes before the comparison, or that a compiler kept the comparison constant-time; those need hardware and an inspection of the generated code.` },
  ],
  troubleshooting: [
    { symptom: 'The honest-user test fails after adding the limiter', cause: 'The counter is never reset on success, so earlier mistakes accumulate.', fix: 'Reset the counter on the success path only, after the comparison has returned equal.' },
    { symptom: 'The device locks out after a single power-up', cause: 'Erased flash reads as all ones and the code interprets that as a large count.', fix: 'Define the encoding of the counter explicitly (for example bits cleared per attempt) and test the freshly provisioned state.' },
    { symptom: 'The PIN is still found in the image after switching to a hash', cause: 'The build script writes the PIN into a generated header that is still compiled in, or leaves it in a debug string.', fix: 'Generate only the verifier in the secrets step; search the image as an automated test.' },
    { symptom: 'Timing still varies with the guess', cause: 'A length check or digit validation returns early before the constant-time comparison.', fix: 'Normalise the input to a fixed-length buffer and always run the full comparison; fold the format check into the final result.' },
  ],
  challenge: `Extend the design to hold **four** secrets, each with its own PIN, without weakening S2 (a wrong PIN for one slot must not grant extra guesses at another) and without letting a holder of one PIN learn whether another slot is in use. Write the two new security requirements this implies, their negative tests, and the security arguments. No solution is given.`,
  rubric: [
    { criterion: 'Review of the reference design', points: 20, evidence: 'Findings table: at least one finding per security requirement, each with interface, class, defence and verification test.' },
    { criterion: 'Redesign and security arguments', points: 25, evidence: 'Design note covering input handling, PIN and secret storage, counter and responses; six-part argument for S1–S6 with assumptions for S3 stated.' },
    { criterion: 'Attempt limit holds across reset and power loss (S2)', points: 15, evidence: 'C lab passed; T-S2-1 to T-S2-3 results.' },
    { criterion: 'No unauthenticated path to the secret (S1, S3, S5)', points: 15, evidence: 'T-S1, T-S3 and T-S5 results, including the image string search.' },
    { criterion: 'Robust, uninformative input handling (S4, S6)', points: 15, evidence: 'T-S4 and T-S6 results; sanitizer run log from the host build.' },
    { criterion: 'Functional requirements still met', points: 10, evidence: 'T-F results on the same build as the security tests.' },
  ],
  quiz: [
    { q: 'Why must the attempt counter be written before the PIN is compared?', kind: 'security', choices: [
      { t: 'Flash writes are faster before a comparison.', why: 'Write speed does not depend on what the code does next; the order matters for a different reason.' },
      { t: 'So that no moment of power loss or reset leaves a guess evaluated but not counted.', ok: true, why: 'Once the result of the comparison exists, an adversary who controls power can prevent anything after it. Charging first removes that window.' },
      { t: 'So the honest user gets an extra attempt.', why: 'It does the opposite: an honest user can lose an attempt to an unlucky power cut. That is the accepted cost.' },
    ] },
    { q: 'The design stores a salted hash of a 6-digit PIN. What should the security argument for S3 say?', kind: 'concept', choices: [
      { t: 'The PIN cannot be recovered because hashes are one-way.', why: 'One-way means no shortcut from hash to input; it does not stop someone trying every possible input when there are only a million.' },
      { t: 'The hash slows an offline search of the million candidates; the protection relies on the attempt limit and on the stored data not being readable.', ok: true, why: 'This states what the mechanism achieves and what it depends on, which is what a reviewer needs.' },
      { t: 'The salt makes the PIN unguessable.', why: 'A salt prevents precomputed tables and makes equal PINs hash differently; it is stored beside the hash and does not enlarge the search.' },
    ] },
    { q: 'Which test verifies S5?', kind: 'security', choices: [
      { t: 'The four specified commands work.', why: 'That verifies function. S5 is about everything else being absent.' },
      { t: 'Unspecified commands are refused without effect, and the image contains no diagnostic command strings.', ok: true, why: 'It checks both behaviour and the delivered artefact for functions outside the specification.' },
      { t: 'The source code contains no function named dump.', why: 'The source is not what is delivered, and a function can be renamed while remaining reachable.' },
    ] },
    { q: 'A 20-byte line arrives for a 16-byte input buffer. What is the fail-closed handling?', kind: 'code', choices: [
      { t: 'Store the first 16 bytes and process them as the command.', why: 'Truncation turns one input into a different, attacker-influenced command, and the remaining bytes become the start of the next line.' },
      { t: 'Discard the whole line up to the newline, send the generic error, change no state.', ok: true, why: 'Over-long input is not a valid command, so nothing derived from it is executed and nothing is written beyond the buffer.' },
      { t: 'Enlarge the buffer to 32 bytes.', why: 'Any fixed size has a longer input. The missing element is the comparison between input length and buffer size.' },
    ] },
    { q: 'What does the C lab test with simulated power cuts *not* demonstrate?', kind: 'concept', choices: [
      { t: 'That the order of operations in the logic is correct.', why: 'That is exactly what the simulation does show.' },
      { t: 'That on a specific chip the counter write is complete and durable before the comparison starts.', ok: true, why: 'A simulated variable is updated instantly; real flash programming takes time and can be interrupted, which needs hardware testing.' },
      { t: 'That the honest user is not locked out.', why: 'The first output line of the test covers the honest sequence.' },
    ] },
  ],
};

const gatekeeper = {
  id: 'ectf-sc-gatekeeper',
  title: 'Scenario 2: Gatekeeper, a credential and a reader',
  kind: 'Scenario',
  minutes: 300,
  summary: 'Two devices: a credential that asks, a reader that decides. Authentication, authorisation and freshness between them.',
  skills: ['ectf-sc-review-reference', 'ectf-sc-mutual-auth', 'ectf-sc-evidence'],
  requires: ['protocols', 'firmware-eng', 'security'],
  objectives: [
    'Review a two-device protocol for replay, redirection, reflection and unauthenticated fields.',
    'Design a challenge–response or counter-based protocol and justify the choice.',
    'Bind identity, permission and freshness into the authenticated data.',
    'Provision per-credential keys so that one lost credential exposes only itself.',
  ],
  hardware: [
    'None required: the protocol can be designed, simulated and tested in the app and in host C.',
    'Optional: two ESP32 development boards you own, three jumper wires (TX, RX, GND) and two USB cables.',
  ],
  software: [
    'This app: the `replay-attack`, `vuln-device`, `crypto-lab` and `threat-model` tools.',
    'Optional: gcc on a PC; a library providing HMAC-SHA-256 (for example the OpenSSL development package on a PC, mbedTLS in ESP-IDF).',
  ],
  requirements: {
    functional: [
      'F1. A deployment consists of readers and credentials. Each has a 32-bit ID assigned at build time.',
      'F2. Each credential is built with a permission set: the list of reader IDs it may open (at most 8).',
      'F3. When the credential\'s button is pressed while it is connected to a reader, the reader grants or denies within 1 second and indicates the result.',
      'F4. A reader supports at least 16 credentials without being rebuilt when a new credential is issued.',
      'F5. Reader and credential communicate over a 3-wire UART link at 115200 baud.',
    ],
    security: [
      'S1. A reader grants only to a credential provisioned for the same deployment.',
      'S2. A recorded exchange cannot cause a grant at a later time.',
      'S3. A reader grants only if the credential\'s permission set, as issued at provisioning, includes that reader. The holder of a credential cannot extend its permissions.',
      'S4. Extracting all secrets from one credential does not allow impersonating any other credential.',
      'S5. An exchange with reader A cannot be used to obtain a grant from reader B, and a device\'s own messages cannot be returned to it to obtain a grant.',
      'S6. On malformed messages, timeouts or any verification failure the reader denies and keeps no partial state.',
    ],
  },
  background: [
    SCENARIO_NOTE,
    `## The system

A credential (a fob or card) asks a reader to open. The reader decides. The adversary can record and inject everything on the link, owns a genuine credential for a *different* reader in the same deployment, and can open one credential and read its flash. They cannot read a reader's flash (state this assumption; the challenge removes it).

${METHOD}`,
    `## The insecure reference design

| Aspect of the reference design | Requirement it falls short of | Why, at design level |
|---|---|---|
| On button press the credential sends a fixed 16-byte "open" code | S2 | The message is identical every time; a recording is as good as the credential. |
| The same code is compiled into every credential and reader | S1, S4 | One opened device yields the secret of all devices. |
| The credential sends its permission list as a plain field and the reader uses it | S3 | The requester states its own rights. |
| No reader ID or credential ID in the message | S5 | Nothing ties a message to one pair of devices. |
| The reader reads bytes into a struct until 20 arrive, with no timeout | S6 | A partial message leaves the reader waiting with half-filled state; the next bytes complete it. |
| The reader compares the code with \`memcmp\` | S1 (supporting) | Early-exit comparison leaks the position of the first mismatch through timing. |`,
    `## Design notes

**Who holds what.** S4 means per-credential keys. F4 means the reader cannot store a key per credential at build time. A standard resolution: each reader holds a reader key; the provisioning tool derives \`k = KDF(reader_key, "cred" || credential_id)\` for every reader a credential may open and stores those derived keys in the credential. The reader recomputes \`k\` from the credential ID in the message. A credential then holds keys only for readers it is permitted to open, which makes the permission set a consequence of the keys it has (S3): there is no permission field to alter.

**What a reader loses when opened.** In this design a reader key lets its holder derive every credential's key *for that reader*. That is why the assumption about reader flash is recorded, and why per-reader keys (not one deployment key) limit the damage to one door.

**Freshness.** The reader has a round trip available and may or may not have a good random number generator. Decide between a reader-chosen nonce and a counter, and write the decision down against S2.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'A challenge–response exchange that binds both identities, the direction and the nonce. One possible design, not the only one.',
      text: `  CREDENTIAL (id C, holds k = KDF(reader_key_R, "cred" || C))        READER (id R, holds reader_key_R)

      ── HELLO  { C } ──────────────────────────────────────────────▶
                                                              nonce N ← hardware RNG (16 bytes)
                                                              start 500 ms timer, remember (C, N)
      ◀───────────────────────────────────────── CHALLENGE { R, N } ──
  check R is a reader I hold a key for
  tag = HMAC(k, "open" || C || R || N)
      ── RESPONSE { tag } ──────────────────────────────────────────▶
                                                              k' = KDF(reader_key_R, "cred" || C)
                                                              constant-time compare tag with
                                                                HMAC(k', "open" || C || R || N)
                                                              forget N whatever the outcome
      ◀──────────────────────────────────────── GRANT or DENY ───────` },
    { t: 'ascii', caption: 'Optional wiring between two ESP32 boards you own. Both are 3.3 V devices. Choose UART pins that are free on your boards and are not strapping pins; check your board\'s pinout.',
      text: `Credential board            Reader board
  UART TX  ───────────────▶  UART RX
  UART RX  ◀───────────────  UART TX
  GND      ────────────────  GND        (common ground is required)
  each board powered from its own USB cable; do not connect the 3V3 pins together` },
  ],
  steps: [
    { title: 'Requirements, assumptions and threat model',
      md: `Tabulate F1–F5 and S1–S6 with a verification method each. Record the adversary's capabilities from the background section as assumptions. Fill in a threat model: assets (reader key, credential keys, the grant decision), entry points (the UART link in both directions, the button, each device's flash).`,
      blocks: [{ t: 'widget', name: 'threat-model', props: { template: 'smart-lock' }, title: 'Threat model worksheet', caption: 'Start from the smart-lock template and adapt it to the credential and reader. Export it to your notebook.' }] },
    { title: 'Review the reference design',
      md: `Draw the reference design's message sequence (it is one message). For that message, answer the four protocol questions from the review lesson: can it be **replayed**, **redirected** to another reader, **reflected**, or **re-typed**? Then walk the catalogue for authentication, access control and memory safety. Use the simulations to see the first of these concretely, then write the findings.`,
      blocks: [
        { t: 'widget', name: 'replay-attack', props: { defence: 'none' }, title: 'A fixed message between two devices', caption: 'Simulated link. Observe why a constant message fails S2, then record the finding.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'replay-fob' }, title: 'A simulated reader with the reference behaviour', caption: 'Intentionally vulnerable simulation. Identify the class and the requirement; note the negative test that would have caught it.' },
      ] },
    { title: 'Choose the freshness mechanism',
      md: `Compare both defences in the simulation. Then decide. If you choose a nonce, your design must say where its randomness comes from and what the reader does if the generator reports a failure. If you choose a counter, it must say where each side stores it and how a credential that has been used with another reader stays in step.`,
      blocks: [
        { t: 'widget', name: 'replay-attack', props: { defence: 'nonce' }, title: 'Counter and nonce defences', caption: 'Switch between the counter and nonce defences and repeat the capture-and-resend test against each.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'weak-prng' }, title: 'What a predictable nonce does to challenge–response', caption: 'Simulated device with a weak generator. This is the residual risk to state if you choose nonces: the class is a cryptographic implementation flaw, the defence is a hardware or cryptographic generator with a health check.' },
      ] },
    { title: 'Specify the protocol and the provisioning',
      md: `Write the specification a teammate could implement from:

- **Message formats**: every field with its size; a type byte; total length fixed per type. No optional fields.
- **Authenticated data**: exactly which bytes go into the MAC, in which order, with a constant label per message type and direction.
- **Reader state machine**: idle → challenged (holding C, N and a deadline) → idle. Every exit from "challenged" erases N.
- **Provisioning**: what the secrets step generates (one random key per reader, from the OS cryptographic source), what each credential build receives (its ID and one derived key per permitted reader), what each reader build receives.
- **Revocation** (needed by F4 in practice): how a reader learns that a credential ID is no longer valid.

Use the HMAC tab below to see the tag change when any bound field changes.`,
      blocks: [{ t: 'widget', name: 'crypto-lab', props: { tab: 'hmac' }, title: 'HMAC over bound fields', caption: 'Real WebCrypto HMAC. Change one character of the message (an ID, the nonce) and compare tags.' }] },
    { title: 'Implement the reader logic',
      md: `Implement the reader's state machine and message parser as hardware-independent C: a function that takes one received message and the current time and returns the reply and the decision. Take the MAC and random functions as parameters so that a host test can supply a library implementation and fixed test nonces. Compile with sanitizers and drive it from a test \`main\`.

On two ESP32 boards of your own, wrap the same files with UART read/write, use the hardware random number generator through the SDK's API, and mbedTLS for HMAC. Keep the UART receive path bounded: a fixed-size buffer, an inter-byte timeout, and a reset to idle on any length or type error.`,
      code: `/* Reader, on receiving RESPONSE while in state CHALLENGED. Shape only. */
decision = DENY;
if (now > st.deadline)                  goto done;      /* too late */
if (len != RESPONSE_LEN)                goto done;      /* exact length */
derive_key(reader_key, st.cred_id, k);                  /* per-credential key */
build_mac_input(buf, "open", st.cred_id, MY_ID, st.nonce);
hmac(k, buf, sizeof buf, expect);
if (!ct_equal(expect, msg->tag, TAG_LEN)) goto done;
if (is_revoked(st.cred_id))             goto done;
decision = GRANT;
done:
wipe(k, sizeof k); wipe(&st, sizeof st);                /* nonce is single-use */
st.state = IDLE;`,
      lang: 'c', status: 'pseudo' },
    { title: 'Test and report',
      md: `Run the tests in the Testing section against the host build (and the boards, if you have them). Write the findings for the reference design, the security argument for each of S1–S6, and the residual risks: random number quality, reader extraction, and live relay of an exchange (which no challenge–response protocol prevents without distance bounding; say so).` },
  ],
  walkthrough: `## What the important lines do

**\`decision = DENY\` first.** Every early exit denies. There is exactly one assignment of GRANT, after the last check.

**The deadline check** bounds how long a nonce is valid. Without it a response computed much later is still accepted, and a reader that never times out can be left holding state.

**Exact length.** RESPONSE has one legal size. Any other size is refused before a single byte of it is interpreted, which removes the parser as a source of memory errors.

**\`derive_key\`** recomputes the per-credential key from the credential's claimed ID. A credential that lies about its ID is asking the reader to verify with a key it does not hold, so the lie fails at the MAC comparison.

**\`build_mac_input\`** concatenates a constant label, both IDs and the nonce in a fixed layout. The label separates this message from any other MAC computed in the system; the reader ID stops use at another reader; the direction is implied by the label, so a reader's own output cannot be returned to it as a response.

**\`ct_equal\`** compares the full tag without an early exit.

**\`wipe(&st, …)\`** runs on every path. The nonce is used once whatever the outcome, which is what makes a second presentation of the same response fail.`,
  testing: [
    `| ID | Requirement | Test | You should see |
|---|---|---|---|
| T-F3 | F3 | Valid credential, permitted reader | Grant within 1 s |
| T-F4 | F4 | Issue a new credential after the reader was built | Grant without rebuilding the reader |
| T-S1-1 | S1 | Credential built from a different deployment's secrets | Deny |
| T-S1-2 | S1 | Response with one bit flipped (try several positions) | Deny |
| T-S2-1 | S2 | Present the same valid RESPONSE twice | Second: deny |
| T-S2-2 | S2 | Valid RESPONSE delivered after the deadline | Deny |
| T-S2-3 | S2 | Recorded HELLO/RESPONSE pair replayed against a new challenge | Deny |
| T-S3-1 | S3 | Genuine credential not permitted for this reader | Deny |
| T-S3-2 | S3 | Any message field altered to claim extra permission | Deny (or: there is no such field) |
| T-S4-1 | S4 | Credential 1's keys used with credential 2's ID | Deny |
| T-S4-2 | S4 | Compare the key bytes of two built credentials | No key in common |
| T-S5-1 | S5 | Response computed for reader A's challenge presented to reader B with the same nonce forced in a test build | Deny |
| T-S5-2 | S5 | Reader's own CHALLENGE bytes sent back as a RESPONSE | Deny |
| T-S6-1 | S6 | Truncated message, then a complete valid exchange | First ignored after timeout; second handled normally |
| T-S6-2 | S6 | Over-long and random messages under sanitizers | Deny; no sanitizer report; state idle |
| T-S6-3 | S6 | Random generator forced to report failure (test hook) | Reader denies and does not issue a challenge |

T-S5-1 needs a test build in which the nonce can be forced, because two readers will not otherwise choose the same one. Keep that hook out of the delivered build and show, by image inspection, that it is absent.`,
  ],
  troubleshooting: [
    { symptom: 'A genuine credential is denied every time', cause: 'The two sides build the MAC input differently: field order, integer byte order or label.', fix: 'Print the MAC input as hex on both sides in a debug build and compare byte for byte; define byte order in the specification.' },
    { symptom: 'Every second attempt fails', cause: 'The reader does not return to idle or does not erase its state after a completed exchange.', fix: 'Reset the state machine on every exit path, including grant.' },
    { symptom: 'Garbage characters on the link between two boards', cause: 'No common ground, TX and RX not crossed, or different baud rates.', fix: 'Connect grounds; TX of each board to RX of the other; confirm both are 115200 8N1 with a logic analyser.' },
    { symptom: 'The reader hangs after a partial message', cause: 'The receive loop waits for a fixed byte count without a timeout.', fix: 'Add an inter-byte timeout that discards the partial message and returns to idle.' },
  ],
  challenge: `Remove the assumption that reader flash cannot be read. Redesign so that extracting **one reader** does not allow making credentials for it. (Hint at the direction, not the solution: the reader would have to verify without holding anything that can create a valid response.) State what this costs on a small microcontroller, and how you would measure whether F3's one-second limit still holds on your hardware.`,
  rubric: [
    { criterion: 'Review of the reference design', points: 20, evidence: 'Findings covering replay, shared secret, self-asserted permissions, missing identity binding and unbounded receive, each with defence and test.' },
    { criterion: 'Protocol specification', points: 20, evidence: 'Message formats, authenticated data, state machine and provisioning written precisely enough to implement from.' },
    { criterion: 'Freshness decision justified and verified (S2)', points: 15, evidence: 'Decision note; T-S2-1 to T-S2-3 results.' },
    { criterion: 'Per-credential keys and permissions (S3, S4)', points: 15, evidence: 'Provisioning output for two credentials; T-S3 and T-S4 results.' },
    { criterion: 'Identity binding and fail-closed reader (S1, S5, S6)', points: 20, evidence: 'T-S1, T-S5, T-S6 results; sanitizer log.' },
    { criterion: 'Security arguments with residual risk', points: 10, evidence: 'Six-part argument per requirement; relay and random-number quality addressed honestly.' },
  ],
  quiz: [
    { q: 'Why does deriving credential keys from a per-reader key satisfy S3 without a permission field?', kind: 'arch', choices: [
      { t: 'Because the reader looks up the permission list in its flash.', why: 'In this design the reader stores no list of credentials; F4 rules out rebuilding it for each new credential.' },
      { t: 'Because a credential can only produce a valid response for readers whose derived key it was given at provisioning.', ok: true, why: 'Permission is expressed as possession of a key. There is nothing the holder can edit to gain a key they were not issued.' },
      { t: 'Because the credential ID encodes the permissions.', why: 'An ID is a public value that anyone can claim; it cannot carry authority by itself.' },
    ] },
    { q: 'The reader ID is omitted from the MAC input. Which requirement fails?', kind: 'security', choices: [
      { t: 'S2, freshness.', why: 'The nonce still prevents reuse over time at the same reader. Think about a second reader.' },
      { t: 'S5: a response is not tied to the reader that issued the challenge.', ok: true, why: 'Without the reader ID, if two readers use related keys or a relay supplies one reader\'s nonce to a credential facing another, nothing in the tag distinguishes them.' },
      { t: 'F3, the timing requirement.', why: 'One fewer field in the MAC input has no measurable effect on timing.' },
    ] },
    { q: 'The reader\'s random number generator returns an error. What should the reader do?', kind: 'security', choices: [
      { t: 'Use the previous nonce again.', why: 'A repeated nonce makes the earlier response valid again, which is precisely a replay.' },
      { t: 'Use a counter of milliseconds since start-up as the nonce.', why: 'Time since start-up is predictable and repeats after every reset, so responses can be gathered in advance.' },
      { t: 'Deny and issue no challenge.', ok: true, why: 'Without unpredictable nonces the freshness requirement cannot be met, so the fail-closed action is to refuse.' },
    ] },
    { q: 'Which attack does a correct challenge–response protocol *not* prevent?', kind: 'concept', choices: [
      { t: 'Replaying a recorded exchange the next day.', why: 'The next day\'s challenge carries a new nonce, so the old response does not verify.' },
      { t: 'Relaying a live exchange between a distant genuine credential and the reader.', ok: true, why: 'A relay forwards fresh, genuine messages in real time. Preventing it needs a different mechanism, such as tight timing bounds, and is honestly listed as residual risk.' },
      { t: 'Altering one bit of the response.', why: 'Any change to the response changes the tag comparison result.' },
    ] },
    { q: 'Why does the reader erase the nonce even after a failed verification?', kind: 'code', choices: [
      { t: 'To save RAM.', why: 'Sixteen bytes are not a memory concern; the reason is about how many tries one nonce allows.' },
      { t: 'So each challenge permits exactly one response, giving no opportunity for repeated guesses against the same nonce.', ok: true, why: 'If the nonce survived a failure, an adversary could submit many candidate responses to a single challenge.' },
      { t: 'Because the HMAC function requires it.', why: 'HMAC is a pure function of key and message and imposes no requirement on the caller\'s state.' },
    ] },
  ],
};

export default [storage, gatekeeper];
export { FRAMING };
