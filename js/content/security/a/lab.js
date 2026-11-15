// Security part A lab: harden a design on paper and in code.
import { LAB_SKELETON, LAB_SOLUTION } from './code.js';

const lab = {
  id: 'sec-a-lab-harden',
  title: 'Harden a design on paper and in code',
  kind: 'Guided laboratory',
  minutes: 180,
  summary: 'Take a small product from a one-paragraph description to a threat model, a chosen set of mechanisms, a release-hardening checklist, a verification test list and two host-tested security routines.',
  skills: ['sec-a-threat-model', 'sec-a-crypto-choose', 'sec-a-secure-boot', 'sec-a-keys', 'sec-a-data-rest', 'sec-a-update', 'sec-a-debug-lock', 'sec-a-secure-c', 'sec-a-lifecycle'],
  requires: ['firmware-eng'],
  objectives: [
    'Write a threat model with assets, adversaries, entry points, prioritised threats, mitigations and verification steps',
    'Select protective mechanisms and justify each against a threat row, including what you chose not to do',
    'Write a release-hardening checklist and a verification test list that a second person could execute',
    'Implement a constant-time comparison and a strict frame parser in C and test them on the host with sanitizers',
  ],
  hardware: [
    'None. This lab is done on paper and on your PC.',
    'Optional, for the extension: any development board you own, to rehearse reading its security configuration. Do not burn eFuses or lock a board you need.',
  ],
  software: [
    'A C compiler on your PC: gcc or clang with -Wall -Wextra -std=c11',
    'AddressSanitizer and UndefinedBehaviorSanitizer (built into gcc and clang on Linux and macOS)',
    'The threat-model worksheet in this app, or a text editor',
  ],
  background: [
    `## The product

**FieldValve** is a battery- and solar-powered irrigation valve controller. A farm installs dozens of them along pipelines in open fields.

- A microcontroller with internal flash runs the application. An **external SPI flash** chip holds a second firmware slot and a log of valve operations.
- A **sub-GHz radio** links each valve to a gateway in the farm office. The gateway sends \`OPEN\`, \`CLOSE\` and \`SET-SCHEDULE\` commands and delivers firmware updates.
- A **latching solenoid driver** on two GPIO pins opens and closes the valve.
- The board has an unpopulated **SWD header** and a 3-pin **UART header** that prints boot logs and offers a service menu.
- The microcontroller has a ROM serial loader, a TRNG, an AES engine, an MPU and a small amount of OTP.
- The vendor wants to sell to water utilities next year.

Opening every valve at once can drain a reservoir or flood a crop. Closing them in a heatwave can kill one.

Everything in this lab is design work and host-side code. Nothing here was run on physical hardware, and you are not asked to attack anything.`,
    { t: 'callout', kind: 'why', md: 'This is the order real projects should follow and often do not: threats first, mechanisms second, tests third, code last. Writing the checklist and test list before the code tells you what the code must make observable.' },
  ],
  diagram: [
    { t: 'ascii', caption: 'FieldValve block diagram with the trust boundary. Everything outside the dashed line is reachable by someone standing in the field.', text:
`                         :
   gateway  ~~ radio ~~~>:   +-------------------+        +-----------+
   (farm office)         :   |  MCU              |==SPI===| ext flash |
                         :   |  ROM loader       |        | slot B    |
   anyone in range ~~~~~>:   |  bootloader       |        | op log    |
                         :   |  application      |        +-----------+
   person at the valve   :   |  TRNG AES MPU OTP |
    - UART header ------>:   |                   |---GPIO--> solenoid driver --> valve
    - SWD header ------->:   +---------^---------+
    - opens enclosure ...:.............|..........  (SPI and power are inside the box,
    - battery / solar ...:.............+             but the box is in an open field)
                         :
   - - - - - - - - - -  trust boundary  - - - - - - - - - -` },
    { t: 'ascii', caption: 'The radio command frame used in the coding steps. The tag is a truncated MAC over bytes 0 to 2+L, computed with the valve\'s own key.', text:
`  byte:   0      1         2        3 .. 3+L-1     3+L .. 3+L+7
        +------+---------+--------+--------------+---------------+
        | type | counter | len L  |  payload     |  tag (8)      |
        +------+---------+--------+--------------+---------------+
          L <= 16                       total length must be exactly 3 + L + 8` },
  ],
  steps: [
    { title: 'Write the asset and adversary lists',
      md: `Before reading further, write two short lists for FieldValve.

**Assets:** at least five. Think about what the farmer loses, what the vendor loses, and what the future utility customer would care about.

**Adversaries:** at least three, each with a capability level from the table in the threat-modelling lesson (remote, proximate, physical brief, physical invasive, insider) and a plausible goal.

Use the worksheet below (blank template) or a text file. Commit to your lists before moving on; the walkthrough at the end compares them with a reference.`,
      blocks: [ { t: 'widget', name: 'threat-model', props: { template: 'blank' }, title: 'Threat model worksheet: FieldValve' } ] },
    { title: 'Inventory the entry points',
      md: `Walk the block diagram and write one row for each entry point that exists on this board, using the inventory table from the threat-modelling lesson: debug port, serial console and ROM loader, on-board buses, external flash, update channel, radio, power and clock, manufacturing interfaces.

For each: what crosses it, and what could someone do through it if nothing were done.

You should end with at least seven rows. If you have fewer, look again at the UART service menu and at the SPI bus.` },
    { title: 'Write and prioritise the threats',
      md: `Combine the lists into threat rows: **asset, adversary and entry point, threat, impact, feasibility**. Aim for ten rows.

Rate impact and feasibility low, medium or high with one line of reasoning each. Then sort, applying the three rules: fleet-wide before per-device, unrecoverable before recoverable, cheap before exotic.

Mark your top five. Mark at least one threat you will **accept**, with the reason.` },
    { title: 'Choose the mechanisms',
      md: `For each of your top threats, choose a mechanism from this half of the section and write one sentence on why it addresses the row and one on what it does **not** cover. Work through these in order and write a decision for each, even if the decision is "not used, because…":

1. Radio command authentication and freshness: which primitive, which key, what provides freshness?
2. Key inventory: every key, where its secret half lives, how it gets there.
3. Chain of trust: what is the root, what verifies the bootloader, what verifies the application?
4. Update: image format, signed range, slot layout, anti-rollback floor and where it is stored, confirm step.
5. Data at rest: what is in external flash, and which of confidentiality, integrity and freshness does each item need?
6. Debug port, ROM loader and UART service menu: production setting for each, and the recovery path.
7. Memory protection: which code is privileged, what is execute-never, where are the guard regions?

Keep it to two pages. This is your design document.` },
    { title: 'Write the verification test list',
      md: `For every mechanism you chose, write the tests that show it works, in the form **what you do / what you expect to observe**. Include negative tests: one changed bit, wrong key, old version, truncated input, power removed.

Aim for at least twenty tests. Mark each as *host* (runs on a PC build), *target* (needs a development unit) or *per-unit factory* (run on every device made).

Then check coverage: every one of your top threat rows must be pointed at by at least one test.` },
    { title: 'Write the release-hardening checklist',
      md: `Write the checklist a second engineer would execute before a release ships, grouped as in the lifecycle lesson: build, secrets, device state, records. Each item must be checkable: it names a command, a read-back or a test from your list, and the expected result.

Include at least: the signing key used, the security version decision, a binary scan for secrets, the debug and ROM loader state, the UART service menu state, an update from the previous release, and the rollback refusal.` },
    { title: 'Implement and host-test two routines',
      md: `Now the code. The file below is a complete host test bench with two unimplemented functions:

- \`ct_equal\`: constant-time comparison for the 8-byte command tag.
- \`frame_parse\`: strict layout validation of a received radio frame, before any tag check or use of the payload.

Save it as \`valve_sec.c\`, build it with the command in its first comment, and run it. Several tests report \`FAIL\`. Implement both functions until the program prints \`all tests passed\` with no sanitizer report.

Rules: no early exit in \`ct_equal\`; in \`frame_parse\`, check before you read, keep the untrusted length alone on one side of each comparison, require the exact total length, and write the outputs only on success.

Do not open the walkthrough until your version passes.`,
      code: LAB_SKELETON, lang: 'c', status: 'host-tested' },
    { title: 'Review your own code as an adversary would',
      md: `With the tests passing, answer in writing:

1. In \`frame_parse\`, which line makes it safe to read \`frame[2]\`? What happens under AddressSanitizer if you delete it and run the "header incomplete" test with a 2-byte heap buffer?
2. Why does the parser demand the *exact* length and not "at least"?
3. \`ct_equal\` passed its tests. What have the tests **not** shown about it, and how would you check that on a target you own?
4. The parser runs before the tag check. Is that the right order? What would go wrong the other way round?
5. Add one more test of your own that the provided list misses.` },
  ],
  walkthrough: [
    `## Reference threat model (one reasonable answer)

**Assets:** control of the valves (safety and water); authenticity of the operation log (billing, disputes); the per-valve radio key; the firmware trust anchor; the ability to update the fleet; the vendor's reputation with utility customers.

**Adversaries:** (A1) a proximate person with a radio who wants to open or close valves; (A2) a physical, invasive person who takes one valve home for a week to learn how to control the others; (A3) a neighbour or thief with brief physical access at a valve; (A4) an insider or factory compromise.

**Top threats and mechanisms**

| # | Threat | Mechanism | Does not cover |
|---|---|---|---|
| 1 | A1 replays or forges OPEN/CLOSE over the radio | MAC over each frame with a per-valve key; counter in the MACed bytes checked against a stored last-seen value | Jamming; a counter stored where it can be rewound (so keep the high-water mark in protected storage); a counter too narrow to stay unique for the life of the key (the 1-byte counter in this lab's frame is for parser practice only: see the first extension) |
| 2 | A2 extracts one valve's secrets and controls the fleet | Per-valve keys derived in the back end; no fleet secret on any device | The one extracted valve |
| 3 | A2 or A3 reads or changes firmware through SWD or the ROM loader | Debug disabled with erase-to-unlock; ROM loader disabled; settings write-protected | Invasive attacks beyond the stated capability |
| 4 | A2 rewrites external flash slot B with modified firmware | Bootloader verifies the signature of any image before copying or booting it; root digest in OTP | A bug in correctly signed code |
| 5 | A1 with a captured old update file downgrades a valve | Security version in the signed header; floor in OTP; raised after confirm | Withholding updates |
| 6 | A3 uses the UART service menu to operate the valve | Service menu absent from production builds; logs carry no secrets | — |
| 7 | Tampering with the operation log in external flash | Authenticated, chained log records | Destruction of the flash chip (accepted) |
| 8 | Malformed radio frame corrupts memory | Strict parser, fuzzed; MPU with XN RAM and stack guard; canaries | Logic flaws in valid commands |

**Accepted:** physical destruction or theft of a valve; radio jamming (detected by the gateway as missing heartbeats, not prevented).

**Deliberately not chosen:** a secure element (per-device keys already cap the damage for the stated adversary; revisit for the utility market), and encryption of radio commands (valve commands are not confidential; authentication and freshness are what matter). Compare with your own choices: differences are fine if your reasoning is written down.`,
    `## Reference solution for the two routines

Compiled with \`gcc -Wall -Wextra -std=c11\`, also with \`-fsanitize=address,undefined\`, and run on the host; every test passed.`,
    { t: 'code', lang: 'c', status: 'host-tested', code: LAB_SOLUTION, caption: 'valve_sec.c with both routines implemented.',
      explain: [
        { lines: '14-21', md: '`ct_equal`: every byte pair is XORed and accumulated with OR. The loop count depends only on `n`. The final line maps zero to 1 and non-zero to 0 arithmetically.' },
        { lines: '32', md: 'Null checks first. A parser is called from many places; do not rely on every caller.' },
        { lines: '33', md: 'This is the line that makes reading `frame[2]` legal. Before it, no byte of the frame has been touched.' },
        { lines: '34-35', md: 'The length byte is widened to `size_t` and compared with the handler\'s capacity. A `uint8_t` cannot exceed 255, but 255 is far more than 16.' },
        { lines: '36', md: '`avail - 3` cannot wrap because of line 33. Requiring equality means there is no slack to hide extra bytes in and no ambiguity about where the tag is.' },
        { lines: '37-40', md: 'Outputs are assigned only after every check has passed, so a caller that ignores the return value is left with its own (ideally NULL) initial values.' },
      ] },
    `## Answers to the review questions

1. \`if (avail < 3u) return false;\`. Without it, the read of \`frame[2]\` is one byte past a 2-byte allocation and AddressSanitizer reports a heap-buffer-overflow at that line. On a target the read would quietly return whatever byte follows.
2. With "at least", trailing bytes are ignored by the parser but may not be ignored by other code (a logger, a forwarder, a later version). Two components disagreeing about where a message ends is a classic source of bypasses. Exact length removes the disagreement.
3. They show the *result* is right, not that the *timing* is independent of the data. Check the disassembly for data-dependent branches and measure on the target with matching and mismatching inputs, as described in the cryptography lesson.
4. Yes. The tag check needs to know where the payload ends and where the tag is, which is exactly what the parser establishes, and a MAC computed over an unvalidated length would itself read out of bounds. Parse strictly, authenticate, and only then act on the payload. What must *not* happen before the tag check is any action on the payload contents.
5. Examples: \`avail == 0\`; \`L == MAX_PAYLOAD\` exactly (must be accepted); a frame of the right length whose length byte disagrees by one.`,
  ],
  testing: [
    `## How to confirm your work

**Code.** \`gcc -Wall -Wextra -std=c11 -fsanitize=address,undefined -o valve_sec valve_sec.c && ./valve_sec\` should print \`ok\` for every line and \`all tests passed\`, with no sanitizer output and no compiler warnings. Then build once without the sanitizers and confirm the same result.

**Mutation check.** Break your own code on purpose and confirm a test catches each break: return early in \`ct_equal\` on the first mismatch (the tests still pass, which tells you these tests cannot see timing; note that in your answers); change \`!=\` to \`<\` in the exact-length check (the "one byte long" test must fail); remove the \`MAX_PAYLOAD\` check (the "payload too long" test must fail).

**Paper deliverables.** Trade documents with another learner, or put yours away for a day and reread it. Check:

- Every top threat row is pointed at by a mechanism, a test and a checklist item.
- Every mechanism names what it does not cover.
- Every checklist item can be executed by someone who was not in the room.
- Nothing in the design depends on a secret that is the same in two devices.

You should be able to answer "how would you know this unit is in its production security state?" with a list of read-backs and tests, not with "we enabled it".`,
  ],
  troubleshooting: [
    { symptom: 'The compiler warns about unused parameters in the skeleton', cause: 'You removed the (void) casts before using the parameters.', fix: 'Either leave the casts until the function is implemented or finish the implementation; the completed functions use every parameter.' },
    { symptom: 'AddressSanitizer reports a stack-buffer-overflow inside frame_parse', cause: 'A byte of the frame is read before the available length was checked, or the tag pointer was dereferenced.', fix: 'Move the avail check above the first read of frame[...]. The parser should compute pointers, not read through them.' },
    { symptom: '"frame: one byte long" fails', cause: 'The length test uses >= or < where it should require the exact size.', fix: 'Compare avail - 3 with len + TAG_LEN for equality, after confirming avail >= 3.' },
    { symptom: '"frame: outputs untouched on reject" fails', cause: 'The outputs are assigned before all checks have run.', fix: 'Use local variables during validation and assign *payload, *payload_len and *tag only immediately before returning true.' },
    { symptom: 'ct_equal returns 1 for buffers that differ', cause: 'The accumulator is overwritten each iteration (diff = a[i] ^ b[i]) so only the last byte counts.', fix: 'Accumulate with |= so any difference in any byte is kept.' },
    { symptom: 'Your threat table has thirty rows and no order', cause: 'Rows were collected but not rated.', fix: 'Rate impact and feasibility for the named adversaries, sort, and draw a line under the top five. The rest are recorded, not forgotten.' },
    { symptom: 'The checklist contains items such as "ensure the device is secure"', cause: 'The item states a goal, not a check.', fix: 'Rewrite each as an action with an expected observation: "attach a probe to a unit from the line: connection refused".' },
  ],
  challenge: [
    `## Extension, no solution given

1. **Add freshness, and find the flaw in the frame format.** Extend the test bench with \`bool counter_accept(uint8_t counter)\` that accepts a frame only if its counter is ahead of the last accepted one, and write the tests first. Then do the arithmetic the format invites: the counter is 8 bits and the key is fixed, so after 256 commands every counter value comes round again, and a frame recorded earlier carries a valid tag for a counter the valve will accept once more. A "wraparound window" does not fix that; it is the replay. Redesign the frame (a wider counter that never wraps in the product's life, or a session key renewed before the counter wraps), update the parser and its tests, and say how many commands per day your choice supports for ten years. Decide and justify where the last-accepted value is stored so that a power cycle or a restored flash image cannot rewind it.
2. **Fuzz the parser.** Write a harness as shown in the lifecycle lesson and run it with a fuzzer and sanitizers. State the invariants that must hold for every accepted frame.
3. **Re-target the threat model.** The vendor signs the utility contract. Add an adversary with a fault-injection bench and a budget. Which rows change rating, which mechanisms gain redundancy, and what would you ask the chip vendor?
4. **Rehearse a read-back.** On a development board you own, find the vendor tool that reads the security-relevant configuration (eFuse summary, boot configuration, option bytes) and record what an unprovisioned board reports. Read only; burn nothing.`,
  ],
  quiz: [
    { q: 'In FieldValve, why is a MAC with a per-valve key chosen for radio commands in place of encrypting them?', kind: 'security',
      choices: [
        { t: 'The threat is forged or replayed commands, which needs authenticity and freshness; the commands themselves are not secret', ok: true, why: 'The mechanism follows the threat row. Encryption would add cost for a guarantee nobody asked for, and by itself would not stop forgery.' },
        { t: 'Encryption is not possible on a microcontroller with a sub-GHz radio', why: 'The MCU has an AES engine. Capability is not the constraint; the requirement is.' },
        { t: 'A MAC also hides the command from eavesdroppers', why: 'A MAC leaves the message readable. It proves origin and integrity only.' },
      ] },
    { q: 'The parser requires the frame to be exactly 3 + L + 8 bytes. What does accepting "at least" that many risk?', kind: 'code',
      choices: [
        { t: 'Trailing bytes that this parser ignores may be interpreted by other code, so two components disagree about what the message was', ok: true, why: 'Ambiguity about message boundaries is a recurring source of security bugs. Exactness removes it.' },
        { t: 'Nothing; extra bytes are harmless padding', why: 'They are harmless only if every other piece of code that sees the frame ignores them in the same way, which you cannot guarantee over the product\'s life.' },
        { t: 'The tag would be computed over too few bytes', why: 'The tag covers the bytes the layout defines. The concern is the uncovered remainder and who might read it.' },
      ] },
    { q: 'Your tests for ct_equal all pass even after you add an early return on the first mismatch. What should you conclude?', kind: 'concept',
      choices: [
        { t: 'Functional tests cannot observe timing; that property needs code inspection and measurement on the target', ok: true, why: 'Knowing what a test suite cannot see is part of verification. Record it and cover the gap another way.' },
        { t: 'The early return is acceptable because the tests pass', why: 'Passing tests show only what the tests check. The timing leak is real and simply invisible to them.' },
        { t: 'The compiler removed the early return', why: 'Compilers preserve observable behaviour, and an early return is a legitimate way to produce the same result faster. Nothing removes it for you.' },
      ] },
    { q: 'Which checklist item is written correctly?', kind: 'concept',
      choices: [
        { t: 'Attach a debug probe to a unit taken from the production line, with reset held: expect connection refused; record the tool output', ok: true, why: 'It names an action, the expected observation and the evidence to keep, so anyone can execute it and anyone can audit it.' },
        { t: 'Debug is disabled', why: 'This asserts a state without saying how it was observed or by whom. It will be ticked from memory.' },
        { t: 'Make sure security features are on', why: 'No specific feature, action or result is named, so it cannot be executed or failed.' },
      ] },
    { q: 'The reference design keeps the radio counter\'s high-water mark in protected storage and not in the external flash log. Why?', kind: 'security',
      choices: [
        { t: 'External flash can be restored to an earlier image, which would rewind the counter and make old recorded commands acceptable again', ok: true, why: 'Freshness state must be at least as hard to roll back as the thing it protects.' },
        { t: 'External flash is too slow to update on every command', why: 'Write speed and wear are engineering concerns, but they are not why the location matters for security.' },
        { t: 'Counters must be encrypted', why: 'The counter value is sent in the clear in every frame. Its secrecy is not required; its monotonicity is.' },
      ] },
  ],
  requirements: {
    functional: [
      'Valves open and close on authenticated gateway commands and follow a stored schedule',
      'Firmware can be updated over the radio link and survives power loss at any point',
      'A failed unit can be returned to a programmable state for service',
    ],
    security: [
      'A valve shall act only on commands authenticated with its own key and fresher than the last accepted command',
      'Extracting all contents of one valve shall not enable control of any other valve',
      'A production valve shall execute only firmware signed by the release key, at a security version not lower than its stored floor',
      'A production valve shall expose no unauthenticated debug, ROM loader or console access',
      'A malformed radio frame shall be rejected without memory corruption',
    ],
  },
  rubric: [
    { criterion: 'Threat model', points: 25, evidence: 'Assets, adversaries with capability levels, complete entry-point inventory, at least ten rated threats, explicit accepted risks' },
    { criterion: 'Mechanism selection', points: 20, evidence: 'Each top threat mapped to a mechanism with a stated limit; key inventory with no fleet-wide secret on a device; decisions not to use a mechanism are justified' },
    { criterion: 'Verification test list', points: 20, evidence: 'Twenty or more tests in do/expect form including negative and power-fail cases; every top threat covered' },
    { criterion: 'Release-hardening checklist', points: 15, evidence: 'Items are executable with expected observations; covers build, secrets, device state, records' },
    { criterion: 'Code', points: 20, evidence: 'Both routines pass all provided tests under -Wall -Wextra and sanitizers; review questions answered; one additional test added' },
  ],
};

export default [lab];
