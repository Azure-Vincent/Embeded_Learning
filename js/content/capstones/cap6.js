// Capstone 6: eCTF-style secure hardware system (final integrative project).
const lab = {
  id: 'cap-6',
  title: 'Capstone 6: an eCTF-style secure hardware system',
  kind: 'Capstone', minutes: 1500,
  summary: 'The final project: design, build, test and document a multi-device system against functional and security requirements, then attack it.',
  skills: ['cap-method', 'cap-threat-system', 'cap-verify-defence', 'cap-linkproto', 'cap-secure-update'],
  requires: ['ectf', 'security', 'rtos'],
  objectives: [
    'Work from a functional specification and security requirements to a complete, documented design.',
    'Build a controller and at least two peripherals that authenticate each other and communicate over a protected channel.',
    'Enforce authorisation for privileged operations and protect secrets at rest, per device.',
    'Ensure firmware integrity and a reproducible build with per-deployment secrets.',
    'Deliver a threat model, automated functional and security tests, and security documentation.',
    'Run an attack phase against your own (or a partner\'s, by agreement) design and respond to what it finds.',
  ],
  hardware: [
    'Three microcontroller boards you own (three ESP32-family boards is the default; the design should not depend on the family)',
    'Wiring for a shared bus (I2C with pull-ups) or point-to-point UARTs; common ground',
    'Logic analyser — in this project it is also your attacker\'s tool',
    'Fewer boards: two boards plus one host-simulated peripheral is acceptable if you document it; with none, the design, host-side protocol code, tests and documentation can still be completed and the on-target rows marked not run',
  ],
  software: [
    'ESP-IDF, or the SDK for whichever boards you use',
    'Python 3 for host tools, secret generation and the test harness',
    'A build that runs from a clean checkout with one command (a container is the usual way)',
    'Git, with secrets kept out of the repository',
  ],
  background: [
    `This project has the shape of MITRE eCTF work: a functional specification, a short list of security requirements, a design phase in which you build a system that meets both, and an attack phase in which designs are attacked. **It is an exercise written for this course, modelled on that shape. It is not an official MITRE challenge, and its requirements are not MITRE's.** For what the competition has actually used, year by year, see the eCTF preparation section; for example the 2024 reference design was an application processor with I2C components on MAX78000 boards, and the 2026 reference design is a hardware security module on a TI MSPM0L2228. Always read the current year's official rules for the real thing.`,
    `### The system: "Relay"

A **controller** manages two or more **peripherals** on a shared bus. A **host** PC talks to the controller over serial.

- The controller boots, discovers peripherals, and brings the system up only if the expected peripherals are present and genuine.
- Each peripheral holds a small **sealed record** (think calibration or identity data) that may be read only by an operator who supplies a PIN.
- A failed peripheral can be **replaced** by a new, genuinely provisioned one, by an operator who supplies a replacement token.
- After bring-up, controller and peripherals exchange application messages.
- Devices are provisioned per **deployment**: devices from a different deployment must not work with this one.`,
    { t: 'callout', kind: 'security', md: 'Assume the attacker of the competition model: they can read and inject on the bus and the host link, possess a genuine peripheral they can take away and examine, can supply their own firmware to a spare board, and have your source code and documentation — but not your deployment secrets. Security that depends on the design staying unknown does not count.' },
    { t: 'callout', kind: 'why', md: 'This is the last project because it uses everything: electronics and bus wiring, architecture and memory layout, C and build engineering, protocols, RTOS structure, debugging, reverse engineering, cryptography and threat modelling. The rubric is organised by those competencies.' },
    { t: 'widget', name: 'platform-compare', caption: 'If you were choosing a platform for this system, which security peripherals would matter? Use only what the comparison sources.' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
   HOST PC                         CONTROLLER                         PERIPHERAL 1
  +-----------+   serial    +----------------------+    bus     +------------------+
  | host tools|<----------->| command handler      |<---------->| identity + keys  |
  | test rig  |             | session manager      |            | sealed record    |
  +-----------+             | peripheral registry  |            +------------------+
        ^                   | secrets (deployment) |    bus     +------------------+
        |                   | firmware (verified)  |<---------->| PERIPHERAL 2     |
   build system             +----------------------+            +------------------+
   + secret generation               ^
   (per deployment)                  |  trust boundary: everything on the bus and the
                                     |  serial link is attacker-readable and -writable`, caption: 'Reference architecture. Mark the trust boundaries on your own version; every arrow crossing one needs a stated protection.' },
    { t: 'ascii', text: String.raw`
 Mutual authentication (one shape among several; design and justify your own)

 Controller                                  Peripheral
   | -- HELLO, id_c, nonce_c ----------------> |
   | <------- id_p, nonce_p, proof_p(nonce_c) -|   proves the peripheral holds its secret
   | -- proof_c(nonce_p) --------------------> |   proves the controller holds its secret
   |   both derive session keys from the exchange
   | == authenticated, encrypted, counted messages ==`, caption: 'Fresh nonces from both sides are what stop a recording of yesterday\'s exchange from working today.' },
    { t: 'ascii', text: String.raw`
 Secrets map (fill in: this table is half your security documentation)

 Secret                 Generated by     Stored on          Unique per   If extracted from one device...
 ---------------------  ---------------  -----------------  -----------  -------------------------------
 deployment root        host, at build   ?                  deployment   ?
 peripheral identity    ?                peripheral         device?      ?
 PIN verifier           ?                ?                  ?            ?
 replacement token      ?                ?                  ?            ?
 firmware verify key    host             all (public)       deployment   nothing gained (public)`, caption: 'The last column is the one that decides whether a stolen peripheral breaks the whole deployment.' },
  ],
  steps: [
    { title: 'Milestone 0: read the spec, write the threat model', md: `Restate every requirement below in your own words and note each ambiguity and how you resolve it. Then complete a threat model: assets, the adversary above, entry points, threats per entry point, mitigation per threat, and the test for each mitigation. Each security requirement must trace to at least one mitigation and one test.`,
      blocks: [{ t: 'widget', name: 'threat-model', props: { template: 'hsm' }, caption: 'Start from a template and rewrite it for Relay. Export it into your design document.' }] },
    { title: 'Milestone 1: an insecure reference that meets the functional spec', md: `Build the plainest system that passes every functional requirement with no security at all, plus host tools and an automated functional test suite. This is your baseline: it proves the functionality, gives you tests to keep green, and is the thing you will later attack to confirm your security tests can fail.

Before leaving this milestone, write a first, crude version of each security test S1 to S13 from the table below and run it against this reference. Every one should **fail**, and you should save that log. From here on, each later milestone has a visible goal: turn specific rows from failing to passing without turning a functional test red.` },
    { title: 'Milestone 2: build system and secrets', md: `Make the build reproducible from a clean checkout. Add a secret-generation step that runs per deployment and injects secrets into each device's build; nothing secret is committed. Fill in the secrets map and choose a key hierarchy in which extracting one peripheral's storage does not reveal other devices' secrets.` },
    { title: 'Milestone 3: message layer', md: `Reuse the framing discipline from capstone 2, then add what a hostile wire needs: authenticated encryption per message, a per-direction counter or nonce that never repeats under one key, and binding of each message to its session and direction so that it cannot be replayed, reflected back or redirected to another device. Unit-test this layer on the host.`,
      blocks: [
        { t: 'widget', name: 'crypto-lab', props: { tab: 'aead' }, caption: 'Real WebCrypto AES-GCM, including what nonce reuse gives away.' },
        { t: 'widget', name: 'packet-explorer', caption: 'Lay out your secure frame: which fields are encrypted, which are authenticated only, which are neither?' },
      ] },
    { title: 'Milestone 4: mutual authentication and session setup', md: `Design and implement the handshake. Write it as a message sequence with every field named, and for each field say what breaks if it is removed. Model each side as a state machine in which any unexpected or failed message returns to the unauthenticated state.`,
      blocks: [{ t: 'widget', name: 'replay-attack', props: { defence: 'nonce' }, caption: 'Simulation: capture and replay against a counter and against a challenge–response.' }] },
    { title: 'Milestone 5: authorisation for PIN and token operations', md: `Decide where the PIN and token are checked and in what form they are stored. Add constant-time comparison, a response to repeated wrong attempts (delay or lockout, with the delay surviving a reset), and make sure failure and success paths are indistinguishable until the check is complete.`,
      blocks: [{ t: 'widget', name: 'timing-attack', props: { defence: 'constant-time' }, caption: 'Simulation: what an early-exit comparison leaks, and what removing it changes.' }] },
    { title: 'Milestone 6: protected storage and firmware integrity', md: `Protect the sealed record and keys at rest as far as your platform genuinely allows, and write down exactly how far that is. Bring across the authenticated-update and anti-rollback work from capstone 4 if your system updates in the field. Explain what the chip's own secure boot and flash encryption would add and why you did or did not enable them (they are irreversible on ESP32 parts).`,
      blocks: [{ t: 'widget', name: 'secure-boot-chain', props: { platform: 'generic' }, caption: 'Simulation of a chain of trust and where it stops when a stage is altered.' }] },
    { title: 'Milestone 7: concurrency and robustness', md: `Structure each device as tasks with bounded queues; every wait on the bus has a timeout; malformed, oversize and out-of-order messages are rejected without crash or hang. Measure worst-case time for each host operation against the timing requirement, including under a flood of bad messages.`,
      blocks: [{ t: 'widget', name: 'rtos-scheduler', props: { scenario: 'starvation' }, caption: 'Simulation: can bus traffic starve the task that serves the host?' }] },
    { title: 'Milestone 8: automated security tests', md: `Harden the crude tests from milestone 1 into an attacker's toolkit: a bus tap that records, replays, modifies and injects; a rogue peripheral build; a peripheral from a second deployment. Each security requirement gets at least one automated negative test that asserts on the forbidden outcome itself. Run the finished suite against the insecure reference once more (every security test should still **fail** there) and then against the design.` },
    { title: 'Milestone 9: attack phase', md: `Freeze the design. Spend a fixed time attacking it as an outsider with the source and one genuine peripheral: capture traffic, analyse your own binaries as in capstone 5, look for the PIN, try the peripheral from another deployment. Better, exchange designs with another learner by agreement and attack each other's. Record every attempt, successful or not.` },
    { title: 'Milestone 10: documentation and response', md: `Deliver the design document (architecture, protocols, secrets map, threat model with traceability), the build and test instructions, the test results, the attack-phase log and, for each weakness found, the fix and its new regression test.` },
  ],
  walkthrough: [
    `The decisions that separate strong designs from weak ones. Answer each in the design document.

- **Symmetric or asymmetric identity?** A deployment-wide symmetric key is simple and falls completely when one peripheral is read out. Per-device keys derived from a root, or per-device key pairs with a deployment authority, limit the damage. What does the controller need to store in each case, and what does *its* extraction give away?
- **Where is the PIN checked?** On the controller, the peripheral, or both? Whichever device releases the sealed record must be the one that is convinced, or the check can be skipped by talking to that device directly.
- **What makes a replacement genuine?** The token authorises the operator; something else must prove the new peripheral belongs to this deployment.
- **What is bound into each message?** Session, direction, counter, message type. For each one omitted, name the attack that becomes possible.
- **What happens on any failure?** A single, uniform failure path with the same timing and the same reply gives the attacker the least to work with.
- **What do you assume about the hardware?** Without flash encryption or a locked debug port, an attacker with a board in hand can read its flash. Either enable the protection, or design so that what they read is limited to that one device, and say which.`,
    { t: 'callout', kind: 'mistake', md: 'Encrypting the bus and calling it secure. Encryption without authentication lets an attacker alter messages; authentication without freshness lets them replay; and both together under one key shared by every device fall to a single extracted peripheral. Check each property separately.' },
    { t: 'callout', kind: 'mistake', md: 'Inventing a cipher, a MAC or a handshake from primitives because it seems simpler. Use a vetted library and standard constructions, and spend your effort on key management and on tests.' },
    { t: 'callout', kind: 'decision', md: 'Building the insecure reference first costs a few days and pays twice: functional tests exist before security changes begin, and you own a known-vulnerable target against which every security test can be shown to fail.' },
    { t: 'widget', name: 'glitch-sim', props: { defence: 'random-delay' }, caption: 'Simulation: fault injection against a single decision. Decide whether physical faults are in or out of your threat model, and write the decision down.' },
  ],
  testing: [
    `Two suites, both automated, both run from one command.

**Functional** — one or more tests per FR, run on every build.

**Security** — at least these, each expecting a refusal:

| ID | Requirement | Attack performed by the test | You should see |
|---|---|---|---|
| S1 | SR-1 | Rogue peripheral with no deployment secrets answers discovery | Bring-up refused; controller reports an authentication failure |
| S2 | SR-1 | Genuine peripheral from a second deployment | Bring-up refused |
| S3 | SR-2 | Controller build from another deployment addresses a genuine peripheral | Peripheral does not activate or release data |
| S4 | SR-3 | Replay a recorded handshake and recorded application messages | Rejected; no state change |
| S5 | SR-3 | Flip a bit in a message in transit; reorder two messages; reflect a message to its sender | All rejected |
| S6 | SR-4 | Request the sealed record with a wrong PIN, with no PIN, and directly from the peripheral bypassing the controller | No record data returned in any case |
| S7 | SR-4 | 20 wrong PINs, with a reset between attempts | Attempt rate limited as specified; limit survives reset |
| S8 | SR-4 | Time at least 100 attempts for each of: PINs sharing 0, 1, 2… correct leading characters | The difference between any two group means is smaller than the spread within a group; report the means, the spread and the timer resolution |
| S9 | SR-5 | Replace with a wrong token; replace a peripheral with a rogue one using the right token | Both refused |
| S10 | SR-6 | Search bus captures and host output for record contents and secrets | None present in clear |
| S11 | SR-7 | Dump one peripheral's storage (your own board) and use only its contents to impersonate another device | Impersonation fails |
| S12 | SR-8 | Offer modified firmware, and an older signed image, through the update path | Refused |
| S13 | SR-9 | Fuzz every parser with malformed, truncated and oversize frames | No crash, hang or reset; timing requirement still met |

Every security test must fail against the insecure reference and pass against the final design; record both runs. Tests you could not run on hardware are listed as not run, with the reason.`,
    { t: 'widget', name: 'logic-analyzer', props: { capture: 'mystery' }, caption: 'Simulation: practise the attacker\'s first step, reading an unknown capture, before turning a real analyser on your own bus.' },
  ],
  troubleshooting: [
    { symptom: 'Handshake works on the bench, fails intermittently in the full system', cause: 'A timeout tuned for an idle bus, or a session state machine that cannot recover when a message is lost mid-handshake.', fix: 'Make every handshake failure return both sides to the unauthenticated state and retry from the start; derive timeouts from measured worst-case times.' },
    { symptom: 'Messages are rejected after one device resets', cause: 'Counters or session keys survive on one side only.', fix: 'Treat a reset as end of session and require a fresh handshake; never resume counters from RAM state the peer no longer has.' },
    { symptom: 'Security tests pass against the insecure reference', cause: 'The tests check that a command returned, not that the protected outcome was refused.', fix: 'Assert on the forbidden outcome itself (record bytes returned, peripheral activated) and re-run against the reference until they fail.' },
    { symptom: 'Devices from two deployments interoperate', cause: 'A constant or default key compiled into every build, or secret generation that is not run per deployment.', fix: 'Diff the secrets of two generated deployments and the two binaries; fail the build when a secret is missing rather than falling back to a default.' },
    { symptom: 'A clean checkout does not build, or builds a different binary', cause: 'Unpinned tool versions, files left out of version control, or secrets expected to exist already.', fix: 'Build in a container from a fresh clone as part of your test run.' },
    { symptom: 'Bring-up exceeds the time limit after adding cryptography', cause: 'Public-key operations on a small MCU are slow, and they may run several times per peripheral.', fix: 'Measure each operation, then reduce their number, move to symmetric operations after first contact, or renegotiate your own timing budget with justification.' },
  ],
  challenge: `Port one peripheral to a different microcontroller family that you own and make it interoperate without changing the protocol document. Then extend the threat model to an attacker with fault-injection or side-channel equipment: identify the three decisions in your firmware they would target, the countermeasures you would add, and how you would test each using equipment and boards you own. No solution is provided; this is the kind of open question an attack phase leaves you with.`,
  quiz: [
    { q: 'Every device in a deployment shares one symmetric key used for authentication. An attacker reads the flash of one peripheral they legitimately hold. What is the consequence?', kind: 'security', choices: [
      { t: `They can impersonate any device in that deployment, including the controller`, ok: true, why: 'Correct: a shared key means one extraction compromises every identity; per-device keys or key pairs contain the damage.' },
      { t: `Only that one peripheral is compromised, because each device stores its own copy of the key`, why: 'That would be true of a per-device secret; a shared key is by definition the same everywhere.' },
      { t: 'Nothing, because the key is only used for authentication and not encryption', why: 'An authentication key is precisely what lets its holder be accepted as genuine.' },
    ] },
    { q: 'The controller checks the PIN and then asks the peripheral for the sealed record with a plain "read record" message. What is the flaw?', kind: 'arch', choices: [
      { t: `The peripheral releases the record without any proof that the PIN was checked, so the check can be bypassed`, ok: true, why: 'Correct: authorisation must be enforced, or cryptographically proven, at the point where the asset is released.' },
      { t: `A PIN must never be checked on a controller, because the controller is the device attackers reach first`, why: 'A controller may check a PIN; the problem is that the peripheral releases the record without any proof that the check happened.' },
      { t: `The record should be fetched before the PIN is checked, so that a correct PIN gets a faster response`, why: 'That would move the data across the bus before any authorisation at all.' },
    ] },
    { q: 'Your messages are encrypted and authenticated with AES-GCM under a session key, but carry no counter. Which attack remains?', kind: 'security', choices: [
      { t: 'Replaying a recorded valid message within the same session', ok: true, why: 'Correct: the tag proves who made the message, not when; freshness needs a counter or nonce the receiver checks.' },
      { t: `Reading the plaintext of messages from the bus with a logic analyser`, why: 'Confidentiality is what the encryption provides; the gap is in freshness.' },
      { t: `Flipping a chosen bit of the ciphertext without the receiver noticing`, why: 'The authentication tag detects modification; an unmodified replay is what gets through.' },
    ] },
    { q: 'Why should every security test be run against the insecure reference design?', kind: 'concept', choices: [
      { t: `To show that each test fails when its defence is absent, so that a later pass means something`, ok: true, why: 'Correct: a test that passes on a system known to be vulnerable is not measuring the property.' },
      { t: `To prove that the insecure design is an acceptable fallback if the secure one is late`, why: 'The reference is expected to fail; its role is to validate the tests.' },
      { t: `Because the insecure design runs faster, so the whole suite finishes sooner there`, why: 'Speed is irrelevant here; the purpose is checking that the tests can detect a missing defence.' },
    ] },
    { q: 'You did not enable flash encryption or lock the debug port. Which statement belongs in your security documentation?', kind: 'security', choices: [
      { t: `A held device's flash can be read; the design limits the loss to that device's own secrets, shown by test S11`, ok: true, why: 'Correct: it states the real assumption, the mitigation and the evidence, which is what a reader needs.' },
      { t: `Secrets are safe because they are stored in a separate partition that the application marks private`, why: 'A partition name is not a protection; without encryption or readout protection the bytes can be read.' },
      { t: `Flash contents cannot be interpreted without the source code and the partition table`, why: 'Flash can be read with standard tools regardless of source availability.' },
    ] },
    { q: 'How does this project relate to the MITRE eCTF?', kind: 'concept', choices: [
      { t: `It borrows the shape of the competition but is a course exercise, not an official challenge`, ok: true, why: 'Correct: the official rules, hardware and requirements change yearly and must be read from MITRE\'s own material.' },
      { t: `It is the official MITRE practice challenge for the current competition year`, why: 'It is written for this course; nothing here is issued or endorsed by MITRE.' },
      { t: `It reproduces the current year's requirements, so completing it prepares the system that will be set`, why: 'Each year\'s system differs; what transfers is the method, not the specific design.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1 (build): one documented command builds controller and peripheral firmware from a clean checkout, given freshly generated deployment secrets.',
      'FR-2 (list): on a host command, the controller reports the IDs of provisioned peripherals and of peripherals currently present.',
      'FR-3 (bring-up): on a host command, the controller validates that every provisioned peripheral is present and brings the system up; it reports success or the reason for refusal within a time limit you state.',
      'FR-4 (read record): on a host command with the correct PIN, the controller returns a named peripheral\'s sealed record.',
      'FR-5 (replace): on a host command with the correct replacement token, the controller replaces one provisioned peripheral ID with another.',
      'FR-6 (messaging): after bring-up, controller and peripherals exchange application messages in both directions.',
      'FR-7 (timing): every host command completes, successfully or with an error, within a limit you state, including under malformed input.',
      'FR-8 (status): each device exposes version and error counters that reveal no secrets.',
    ],
    security: [
      'SR-1: the controller brings the system up only if every provisioned peripheral is present and genuine for this deployment.',
      'SR-2: a peripheral activates and releases data only for the genuine controller of its deployment.',
      'SR-3: an attacker who can read, modify, replay, reorder and inject bus traffic cannot forge, alter or replay a message that is then accepted.',
      'SR-4: the sealed record is disclosed only to an operator who supplies the correct PIN; PIN guessing is rate limited across resets and leaks nothing through timing or error behaviour.',
      'SR-5: replacement succeeds only with the correct token and only for a genuine peripheral of this deployment.',
      'SR-6: sealed records and secrets never appear unprotected on the bus or the host link.',
      'SR-7: extracting everything stored on one peripheral does not allow impersonation of the controller or of any other peripheral.',
      'SR-8: devices run only firmware built for the deployment; if field update is supported, modified and older images are refused.',
      'SR-9: malformed input on any interface causes rejection, never a crash, hang, memory corruption or secret disclosure.',
    ],
  },
  rubric: [
    { criterion: 'Requirements analysis and threat model (competition, security)', points: 12, evidence: 'Restated requirements with resolved ambiguities; threat model with every SR traced to mitigation and test.' },
    { criterion: 'Electronics and bus integration (hardware)', points: 6, evidence: 'Wiring diagram; pin budget; pull-up values and logic levels with the calculation or datasheet figure behind each; a bus capture of one complete transaction that decodes without errors.' },
    { criterion: 'Architecture and memory use (architecture)', points: 6, evidence: 'Block diagram with trust boundaries; where code, keys and records live in memory and flash.' },
    { criterion: 'Firmware engineering and build (programming, firmware engineering)', points: 10, evidence: 'One-command reproducible build; per-deployment secret generation; no secrets in the repository; checked return values.' },
    { criterion: 'Protocol design (protocols)', points: 12, evidence: 'Protocol document with every field justified; framing, counters and state machines; host unit tests.' },
    { criterion: 'Real-time structure and robustness (RTOS)', points: 8, evidence: 'Task and queue design; timeouts; measured worst-case command times, including under bad input.' },
    { criterion: 'Authentication, authorisation and key management (security)', points: 14, evidence: 'Handshake description; secrets map; PIN and token handling; results of S1–S9 and S11.' },
    { criterion: 'Data protection and firmware integrity (security)', points: 8, evidence: 'At-rest protection with stated platform limits; results of S10 and S12.' },
    { criterion: 'Automated tests (debugging, competition)', points: 10, evidence: 'Functional and security suites; logs of security tests failing on the reference and passing on the design.' },
    { criterion: 'Attack phase and analysis (debugging, reverse engineering)', points: 8, evidence: 'Dated log of attempts; analysis of own binaries and captures; findings with fixes and regression tests.' },
    { criterion: 'Security documentation and honesty (competition)', points: 6, evidence: 'Design document a stranger can follow; residual risks and untested rows stated plainly.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [
  { org: 'MITRE', title: '2024 eCTF insecure example (application processor and components)', url: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example', note: 'A real reference design of similar shape; read it for structure, not as a source of this project\'s requirements.' },
] };
