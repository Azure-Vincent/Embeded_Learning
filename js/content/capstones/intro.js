// Capstone section: shared skills, the "how to run a project" intro lesson,
// and section-level glossary / troubleshooting / refs.

const skills = [
  { id: 'cap-method', name: 'Turn an open brief into requirements, milestones and a test plan', track: 'competition' },
  { id: 'cap-blockdiagram', name: 'Draw a block diagram and budget pins, tasks and timing for a multi-peripheral device', track: 'competition' },
  { id: 'cap-integrate', name: 'Integrate sensors, a bus and a display on one MCU without resource conflicts', track: 'competition' },
  { id: 'cap-linkproto', name: 'Design a framed MCU-to-MCU protocol with sequence numbers, CRC, timeouts and retries', track: 'competition' },
  { id: 'cap-interop', name: 'Write an interoperability and fault-injection test for a serial link', track: 'competition' },
  { id: 'cap-rtos-measure', name: 'Structure an RTOS application and measure jitter, deadline adherence and stack headroom', track: 'competition' },
  { id: 'cap-secure-update', name: 'Implement and test an authenticated firmware update and protected configuration', track: 'competition' },
  { id: 'cap-verify-defence', name: 'Write a test that proves a specific security control actually works', track: 'competition' },
  { id: 'cap-reverse', name: 'Analyse a firmware image, map its attack surface and recommend fixes', track: 'competition' },
  { id: 'cap-threat-system', name: 'Design a multi-device secure system from a threat model, with tests and documentation', track: 'competition' },
];

const introLesson = {
  id: 'cap-intro',
  title: 'How to run an open-ended project',
  minutes: 40,
  summary: 'Requirements, design, test plan, build, verify: the five steps, worked through once on a miniature project before you apply them to a real one.',
  skills: ['cap-method'],
  blocks: [
    `## The problem these projects set

Every lesson so far gave you a known-good answer to check against. A real project does not. You are handed a paragraph — "a device that logs temperature and shows it on a screen", "two boards that talk reliably over one wire", "a lock nobody can bypass" — and the first failure is almost never the soldering. It is that you built the wrong thing, or built the right thing with no way to tell whether it works.

A capstone is deliberately under-specified so that *turning the brief into something buildable and testable* is part of the work. This lesson is the method you will reuse in all six.`,

    { t: 'callout', kind: 'why', md: `**Why a method and not just effort.** Teams that lose at eCTF and projects that stall in industry rarely lack skill. They lack a loop: a written requirement, the smallest change that moves toward it, and a test that says whether the change worked. Without that loop you cannot tell progress from motion, and you cannot tell "done" from "I'm tired".` },

    `## The method

Five steps. The first three produce paper, and they come before any firmware.

1. **Requirements.** Turn the brief into a numbered list of statements that are each *testable*. "Fast" is not a requirement; "responds to a button within 50 ms" is. Split them into **functional** requirements (what it must do) and, where the brief has an adversary, **security** requirements (what an attacker must *not* be able to do). A security requirement is easiest to test when it is written as "an attacker who can *X* cannot *Y*". Competition specifications often state a property instead ("the device releases the record only with the correct PIN"); before you can test such a line you have to rewrite it in the attacker form, using the adversary the brief describes.
2. **Design and budgets.** A block diagram, a pin budget, a task/timing budget, a memory budget. You are deciding where every signal, every CPU-millisecond and every byte of RAM goes. Most integration failures are a budget you never wrote down: two peripherals wanting the same pin, two tasks wanting the same lock, an ISR that overruns its deadline.
3. **Test plan.** For every requirement, one row: the procedure a tester follows, and the observation that counts as a pass. Write it *now*, before the build. If you cannot write the row, the requirement is not testable yet, or the design gives you no way to observe it (no log line, no test pin), and both are far cheaper to fix on paper.
4. **Build in milestones.** Build the riskiest, most uncertain piece first as a thin slice that actually runs, then grow it. "Read one sensor and print it, then add the bus, then the display" beats "wire everything and flash once". Each milestone ends by running the test-plan rows it has made runnable.
5. **Verify and document.** Run every row and record the result with its evidence (a log excerpt, a capture, a photo), including the failures. Fix, then re-run *all* rows, not only the one that failed. Then write down what you built and why: the diagram, the decisions, the results. In a competition the documentation is part of the score; in a job it is the difference between a device and a liability.

The steps are a loop, not a waterfall. A measurement in step 4 will change a number in step 1; when it does, change the requirement on paper first, with the reason, and then the code.`,

    { t: 'callout', kind: 'note', md: `In the skills matrix, every capstone exercises the **competition** skill "turn an open brief into requirements, milestones and a test plan", and each adds skills of its own from the hardware, programming and security work you have already done. The rubric of each capstone lists the evidence it expects for each.` },

    `## Worked example: a night light, start to finish

A miniature project, small enough to hold in your head, taken through all five steps. The brief: *"An LED that comes on when it gets dark, with a button to force it on."* The numbers below are illustrative. Nobody built this for the course; the point is the shape of each artefact.

**Step 1: requirements.** Four statements, each with something a tester can observe.

- **FR-1:** with the light sensor covered, the LED is on within 1 s; with it uncovered under room lighting, the LED is off within 1 s.
- **FR-2:** at any steady light level, the LED does not flicker: it changes state at most once in 10 s.
- **FR-3:** each button press toggles "forced on", exactly once per press.
- **FR-4:** from reset until the first sensor reading has been taken, the LED is off.

Notice what writing them forced into the open. "When it gets dark" needed a definition (covered against room lighting). FR-2 did not appear in the brief at all; it came from asking "what would make this device annoying?", and it will turn out to dictate the design.

**Step 2: design and budgets.**

\`\`\`text
 light sensor (LDR + resistor divider) --> ADC1 input
 push button to GND ---------------------> GPIO input, internal pull-up
 GPIO output --> resistor --> LED

 Pin budget (original ESP32)
 Signal   Pin      Checked against
 sensor   GPIO34   ADC1 channel; input-only is fine for an analogue input
 button   GPIO27   has an internal pull-up; not a strapping pin (GPIO34-39 would not do: no pull-ups)
 LED      GPIO26   output-capable; not a strapping pin, so the LED cannot disturb boot

 Timing budget
 sample the sensor every 100 ms; decide on each sample  -> worst-case reaction about 0.1 s, inside FR-1's 1 s
 poll the button every 10 ms                            -> a press shorter than 10 ms could be missed; accepted

 Decision rule (for FR-2): turn on below a LOW threshold, off above a HIGH threshold, no change in between.
 The two thresholds are unknown until the sensor has been measured.
\`\`\`

The design step ended with a named unknown: the two threshold values. That tells you what the first milestone must be.

**Step 3: test plan**, written before any code.

| Test | For | Procedure | Pass if |
|---|---|---|---|
| T1 | FR-1 | Cover the sensor with a cup; remove it; ten times, timing each change with a stopwatch | Every change within 1 s |
| T2 | FR-2 | Shade the sensor partly with a sheet of paper until the LED has just switched; hold still for 60 s | At most one further change, counted from a log line printed on every change |
| T3 | FR-3 | Press the button 20 times at ordinary speed, reading a toggle counter from the log | Counter reads exactly 20 |
| T4 | FR-4 | In a dark room, press reset ten times while watching the LED | No flash before the first "reading" log line |

Writing T2 and T3 changed the design: both need a **log line with a counter**, which nobody would have thought to add for the device's own sake. That is the test plan doing its job before the build.

**Step 4: build in milestones.**

1. *Measure the sensor.* A ten-line program that prints the raw ADC reading twice a second. Record the readings covered and uncovered and choose the two thresholds between them, with a gap. This retires the biggest unknown, and until it is done no other code can be right.
2. *LED follows the light*, using the decision rule. Now T1, T2 and T4 can be run. Run them.
3. *Button override.* Now T3 can be run. Run all four.

**Step 5: verify and document.** Suppose the table comes back like this:

| Test | Result | Evidence |
|---|---|---|
| T1 | pass | ten timings, slowest 0.3 s |
| T2 | pass | 60 s log, one change |
| T3 | **fail** | counter read 23 after 20 presses |
| T4 | pass | ten resets, no flash |

T3 failed, and that is the method working: the fault was found by a test written before the code, not by a user. Three extra toggles from 20 presses points at contact bounce, a single press being seen as several. The fix is to require the button to read pressed on two consecutive 10 ms polls before counting it. Then **all four** tests are run again, because the fix touched the loop every other requirement depends on. The write-up records the failed run as well as the passing one; a reader trusts a table more when it shows that a test is able to fail.

The whole project fits on two pages: four requirements, one diagram with budgets, four test rows, three milestones, one results table. A capstone is the same five artefacts, larger.`,

    `## How this appears in practice

A requirement is only useful if a test can fail it. Compare two ways of writing the same intent:

| Vague | Testable |
|---|---|
| "The display updates quickly." | "FR-3: the displayed temperature is never more than 1 s behind the sensor; verified by stepping the sensor and timing the screen." |
| "Updates are secure." | "SR-1: an image not signed by the deployment key is rejected before any byte of it runs; verified by flashing a tampered image and observing the old firmware still boots." |

The right-hand column tells you what to build *and* how you will know you are done. The left-hand column tells you nothing, which is why projects written in the left-hand column never finish.`,

    { t: 'predict', q: 'You are given: "Build a door lock that only opens for authorised users." Which of these is a usable **security** requirement you could hand to a tester?',
      choices: [
        { t: 'The lock must be secure against attackers with physical or radio access, for the life of the product.', why: 'This names no attacker capability and no forbidden outcome, so no test can ever fail it. It restates the brief without making it testable.' },
        { t: 'An attacker who records the radio unlock message and replays it later cannot open the lock.', why: 'Correct: it names a specific attacker capability (record and replay) and a specific forbidden outcome (lock opens), so a tester can capture a message, replay it, and watch whether the lock stays shut.', ok: true },
        { t: 'The firmware must protect every unlock message with strong, standard cryptography and a 256-bit key.', why: 'A mechanism is not a requirement. Strong crypto used wrongly still fails; and nothing here tells a tester what to try or what counts as a pass.' },
        { t: 'The lock must take a skilled person a long time to open without the proper credentials.', why: '"Skilled" and "a long time" are not measurable, and no specific action is named, so two testers would disagree about whether it passed.' },
      ],
      reveal: `A security requirement names an attacker capability and the outcome it must not achieve. "An attacker who can record-and-replay cannot open the lock" is testable: capture, replay, observe. That single sentence also tells you what to build — a freshness mechanism such as a counter or nonce — which is how good requirements drive the design.` },

    { t: 'callout', kind: 'mistake', md: `**The most common capstone failure:** building bottom-up with no requirements, then writing the requirements afterward to match whatever you built. You end up unable to say what "working" means, you demo the happy path only, and the first adversarial or edge input breaks it. Write the testable list *first*, even a rough one, and let it change as you learn — but let it lead.` },

    { t: 'callout', kind: 'decision', md: `**Why milestones, not one big flash.** You could wire every peripheral and write all the firmware before the first run. Do not. The riskiest unknown — "will the I2C sensor and the SPI display coexist on this board?" — should be answered in hour one with a 20-line program, not in hour forty with a full application you then have to bisect. Front-load uncertainty; each milestone retires one risk.` },

    { t: 'exercise',
      prompt: `Take this brief: *"A battery sensor node that samples a temperature probe and sends readings to a base station; it should last a long time on one battery and not lose data if the link drops."* Write **four** numbered, testable requirements. At least one must be a reliability/availability requirement, and name the test for each.`,
      hints: [
        'Each requirement should contain a number or a yes/no observable outcome. If you cannot imagine the measurement, it is not testable yet.',
        'Turn "last a long time" into an average-current or runtime figure you could measure with a meter or a coulomb counter. Turn "not lose data" into behaviour on a dropped link (buffer and retry, acknowledge, sequence numbers).',
        'For each requirement write "verified by …": the action a tester performs and the observation that passes.',
      ],
      solution: `There is no single right list; a strong answer looks like this.

- **FR-1:** the node reports a temperature at least once every 60 s. *Verified by:* log timestamps at the base station over 10 minutes; no gap exceeds 60 s.
- **FR-2:** average current draw in steady state is below a stated budget (you set the number from the battery capacity and target runtime, e.g. "< 200 µA average for 6 months on 1000 mAh"). *Verified by:* measure average current with a meter or coulomb counter over a full duty cycle.
- **RR-1 (reliability):** if the link drops, no reading is lost; the node buffers readings and the base station receives every sequence number once the link returns. *Verified by:* disconnect the base station for 2 minutes, reconnect, and check the received sequence numbers have no gaps and no duplicates.
- **RR-2 (reliability):** a corrupted frame is detected and never shown as data. *Verified by:* inject a bit error on the line and confirm the base station rejects the frame rather than displaying garbage.

Notice each one tells you something to build (a timer, a low-power mode, a buffer with sequence numbers, a CRC) and exactly how a tester decides pass or fail.` },

    `## Transfer: a harder brief

Here is the shape of a competition brief, compressed: *"A multi-device system. A controller and several peripherals. The controller must boot only firmware signed by the deployment key, must authenticate each peripheral before trusting it, and must keep per-peripheral secrets even if one peripheral is removed and read out. Provide a threat model and automated tests."*

Do not design it yet — just apply step 1. Separate the functional requirements (boot, enumerate peripherals, run the application) from the security requirements, and for each security requirement write it as "an attacker who can *X* cannot *Y*". You will find three or four adversaries hiding in that paragraph: someone who can supply firmware, someone who can impersonate a peripheral, someone who can physically take a peripheral away. Capstone 6 is exactly this brief, and it starts here, with the list.`,
  ],
  quiz: [
    { q: 'Why insist that every requirement be testable before writing any firmware?', kind: 'concept',
      choices: [
        { t: `Because only a requirement that a test can fail tells you what to build and when you are done.`, why: 'Correct: testability is what turns a wish into an engineering target and gives you an unambiguous definition of "working".', ok: true },
        { t: `Because testable requirements are shorter, and a shorter list is quicker to implement.`, why: 'Length is irrelevant; a testable requirement is often longer than a vague one. The value is that it can be checked, not that it is brief.' },
        { t: `Because the compiler and static analysis tools can then check them automatically at build time.`, why: 'No compiler checks requirements; they are about system behaviour, verified by tests and observation, not by the build.' },
        { t: `Because a testable list replaces the design documentation, so none needs writing later.`, why: 'It does the opposite — testable requirements become your documentation and test plan; they add rigour, they do not remove work.' },
      ] },
    { q: 'A teammate says "let\'s wire up all the peripherals and write the whole application, then test at the end." What is the strongest objection?', kind: 'arch',
      choices: [
        { t: `The riskiest unknowns stay unanswered until the end, when a failure is hardest to localise among everything built.`, why: 'Correct: milestones exist to retire risk early and keep each failure small and bisectable; a single big-bang integration hides which of many changes broke it.', ok: true },
        { t: `Powering every peripheral from the first day draws more current than the regulator was budgeted for.`, why: `A power budget is a real concern, but it is the same whichever order you build in.` },
        { t: `A large program written in one go takes far longer to compile than the same code built up in stages.`, why: 'Program size is not the issue; toolchains build far larger applications. The problem is debuggability and unretired risk.' },
        { t: `Writing the whole application first makes it likely to overflow the flash before anything can be tested.`, why: 'Flash budget is a separate concern and not what the milestone approach is about; the point is localising failures and front-loading uncertainty.' },
      ] },
    { q: 'Which statement is a security requirement rather than a mechanism or a wish?', kind: 'security',
      choices: [
        { t: `The device encrypts and authenticates every stored record with AES-GCM under a per-device key.`, why: 'That is a chosen mechanism. A mechanism can be present and still misused; a requirement states the attacker outcome to forbid, not the primitive.' },
        { t: `An attacker who can write the config region cannot cause an unauthorised unlock.`, why: 'Correct: it names the attacker capability (write config) and the forbidden outcome (unauthorised unlock), so it is testable and it drives the design toward integrity-protected config.', ok: true },
        { t: `The device must be tamper-proof against every attacker with physical access.`, why: 'Nothing is tamper-proof, and "tamper-proof" names no capability or outcome, so no test can decide it. It is a wish, not a requirement.' },
        { t: `The firmware must follow secure-coding best practices and pass review.`, why: 'This is unmeasurable and names no adversary. A security requirement must say what a specific attacker must not be able to achieve.' },
      ] },
    { q: 'You finish a capstone and everything works in your demo. Why is documenting the design and the test results still part of the job?', kind: 'concept',
      choices: [
        { t: `Because it is how anyone else can check your claims and reproduce the result without you present.`, why: 'Correct: an undocumented working demo is an unverifiable claim; the write-up is what makes the result checkable and, in competition, scored.', ok: true },
        { t: `Because a documented design is exempt from the attack phase of a competition.`, why: `Nothing exempts a design from being tested or attacked. The write-up exists so that claims can be checked, not so that checking can be skipped.` },
        { t: `Because graders score only the written report and never examine the device itself.`, why: 'Graders may well examine the device, but that is not why you document; you document so the design and evidence are inspectable independently of a one-off demo.' },
        { t: `Because the build system needs the design document in order to generate the release image.`, why: 'The toolchain neither requires nor reads your documentation; the reason is verification and communication.' },
      ] },
    { q: `Your requirement reads "FR-2: the display is never more than 1 s behind the sensor". Your test steps the input and times the screen: 0.4 s on nine runs, 2.3 s on the tenth. What do you do next?`, kind: 'concept',
      choices: [
        { t: `Record FR-2 as failing, and find out what was different about the slow run.`, why: `Correct: "never" is failed by one counter-example. The slow run is the most informative result you have; it usually points at a blocked task or a shared bus.`, ok: true },
        { t: `Record FR-2 as passing, because the average of the ten runs is about 0.6 s, well inside the limit.`, why: `The requirement bounds the worst case, and an average hides exactly the run that broke it. A user who meets the 2.3 s case sees a stale display.` },
        { t: `Reword FR-2 as "usually within 1 s", so that the requirement matches what the device does.`, why: `That is writing the requirement to fit the build. A requirement may change, but for a reason that comes from what the device is for, and "usually" is no longer something a test can fail.` },
        { t: `Repeat the test until ten runs in a row pass, and record that set as the evidence.`, why: `Selecting the runs you like is not a test. The failing run happened, and nothing has changed in the device to stop it happening again.` },
      ] },
  ],
};

const glossary = [
  { term: 'Functional requirement', def: 'A testable statement of what the system must *do* (e.g. "reports a reading at least once per minute"). Distinguished from a security requirement, which states what an attacker must *not* be able to do.' },
  { term: 'Security requirement', def: 'A testable statement of the form "an attacker who can *X* cannot achieve *Y*". It names an adversary capability and a forbidden outcome, so a test can try *X* and check that *Y* did not happen.' },
  { term: 'Pin budget', def: 'A written assignment of every signal to a physical pin, checked against the pins the chosen pins can actually be (input-only pins, strapping pins, bus-dedicated pins) before any wiring.' },
  { term: 'Test plan', def: 'A table with one row per requirement: the procedure a tester follows and the observation that counts as a pass. Written before the build, so that an untestable requirement or an unobservable design is found on paper.' },
  { term: 'Milestone', def: 'A thin, runnable vertical slice of the project that retires one risk and can be demonstrated on its own. Projects grow as a sequence of milestones rather than one final integration.' },
  { term: 'Threat model', def: 'A structured list of assets, the adversaries who want them, the entry points they can reach, the threats at each point, and the mitigation for each threat. It turns a security brief into a list of security requirements.' },
  { term: 'Interoperability test', def: 'A test that confirms two independent implementations of the same protocol actually talk to each other, including under faults (dropped bytes, bit errors, resets), rather than only confirming that one implementation talks to itself.' },
  { term: 'Deadline adherence', def: 'In a real-time system, the fraction of task activations that complete before their deadline. Measured, not assumed; a missed deadline is a correctness failure, not just slowness.' },
  { term: 'Attack surface', def: 'The complete set of inputs and interfaces through which an adversary can influence a device: every bus, every parsed message, every pin, every stored secret, every debug port. Mapping it is the first step of both defending and analysing a device.' },
];

const troubleshooting = [
  { symptom: 'Two peripherals work alone but not together once integrated.', area: 'Integration',
    causes: 'A shared resource neither one owns exclusively: the same pin assigned twice, two drivers claiming one bus or DMA channel, a strapping pin repurposed, or an ISR from one peripheral starving the other. Almost always a budget that was never written down.',
    fix: 'Go back to the pin and resource budget and list, on paper, every pin, bus, DMA channel, timer and interrupt each peripheral uses. Find the collision. Re-run the two-peripheral milestone (just those two, nothing else) to confirm the fix before re-adding the rest.' },
  { symptom: 'The demo works every time you run it, but a grader or teammate hits a failure in minutes.', area: 'Method',
    causes: 'You tested only the happy path you built toward. The untested inputs — an unexpected message, a dropped link, a held button, a boundary value — were never exercised, so the first adversarial or edge input finds them.',
    fix: 'Write the test plan from the requirements, not from the demo. Include edge and adversarial inputs for every requirement. A requirement with no failing test is a requirement you have not actually met.' },
  { symptom: 'The project is "almost done" for days and never finishes.', area: 'Method',
    causes: 'Motion without a definition of done. With no testable requirement list, every change feels like progress and none of them closes anything out.',
    fix: 'Write the numbered requirement list and, next to each, its test and current pass/fail. "Done" is every requirement passing its test. Work the failing ones in risk order; stop polishing the ones that already pass.' },
  { symptom: 'You cannot tell whether a security control actually works.', area: 'Security',
    causes: 'The control was implemented but never attacked. Code that calls a verify function is not evidence that verification rejects a forged input; it may always return true.',
    fix: 'For each security control, write the negative test: supply the exact input the control is meant to reject (a tampered image, a replayed message, a corrupted record) and confirm the device refuses it. A control with no passing negative test is unverified.' },
];

const refs = [
  { org: 'MITRE', title: 'eCTF reference designs (mitre-cyber-academy, 2016–2025)', url: 'https://github.com/mitre-cyber-academy', note: 'Public insecure example designs; the shape these capstones are modelled on. Not official challenge material.' },
  { org: 'MITRE', title: 'eCTF 2026 insecure example (ectfmitre)', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example', note: 'The 2026 HSM reference design (TI MSPM0L2228).' },
  { org: 'MITRE', title: 'eCTF rules site (2026 current; 2024 and 2025 archived)', url: 'https://rules.ectf.mitre.org/', note: 'The official functional and security requirements, board and bootloader instructions for each of those years. The 2026 board is the custom MSP-LITO-L2228 (not sold); the LP-MSPM0L2228 LaunchPad is described as largely interchangeable.' },
  { org: 'Espressif', title: 'ESP-IDF (programming guide sources under docs/en)', url: 'https://github.com/espressif/esp-idf', note: 'The SDK the board-based capstones target; check the version tag you install.' },
  { org: 'FreeRTOS', title: 'FreeRTOS-Kernel', url: 'https://github.com/FreeRTOS/FreeRTOS-Kernel', note: 'Kernel source for queues, semaphores, timers and the stack high-water-mark API used in capstone 3.' },
  { org: 'NSA', title: 'Ghidra', url: 'https://github.com/NationalSecurityAgency/ghidra', note: 'Open-source reverse-engineering suite; the real-tool analogue of capstone 5.' },
];

export default { skills, lessons: [introLesson], labs: [], glossary, troubleshooting, refs };
