// Capstone 5: reverse engineering an intentionally vulnerable image supplied by the course.
const lab = {
  id: 'cap-5',
  title: 'Capstone 5: embedded device reverse engineering',
  kind: 'Capstone', minutes: 480,
  summary: 'Analyse the course\'s intentionally vulnerable firmware images, map the attack surface, and write an assessment with recommended fixes.',
  skills: ['cap-method', 'cap-reverse', 'cap-verify-defence'],
  requires: ['debugging', 'security'],
  objectives: [
    'Recover the structure of a raw firmware image: vector table, code, data, strings.',
    'Infer what a device does from its image and its console behaviour.',
    'Map the attack surface and rank the weaknesses you find.',
    'Confirm each finding against the simulated device, and state what evidence supports it.',
    'Write a short professional assessment whose main content is the fixes.',
  ],
  hardware: [
    'None required: the targets are synthetic images and simulated devices bundled with this app',
    'Optional: a board you own running firmware you built (capstone 1 or 4), as a second target for the extension',
  ],
  software: [
    'This app: the firmware inspector, disassembly lab and vulnerable-device console',
    'A notebook for timestamped observations',
    'Optional, for the extension on your own firmware: Ghidra, `arm-none-eabi-objdump` or `riscv32-esp-elf-objdump`, `strings`',
  ],
  background: [
    `Defenders reverse engineer constantly: to audit a supplier's binary, to check what their own build really contains, to understand a field failure with no source at hand. The skill is reading a device from the outside and writing down, with evidence, what it does and where it is weak.

**Scope, stated once and meant.** The targets are this course's own synthetic firmware images and simulated devices, written to be vulnerable, plus — optionally — firmware you built for hardware you own. Analysing or attacking anyone else's device without written permission is outside this course and in most places illegal. The deliverable is an assessment and a list of fixes. A working attack on the simulation is evidence for a finding; it is not the product.`,
    { t: 'callout', kind: 'sim', md: 'The images are synthetic teaching material, not dumps of real products, and the consoles are simulations. Product names in them are invented. Report what you observe in the simulation as simulation results.' },
    `### Method

1. **Triage**: size, entropy by eye, strings, anything that looks like a header or vector table.
2. **Structure**: where is the code loaded, where does execution start, which handlers exist.
3. **Function**: follow from reset and from each input (console command, bus message) to what it reaches.
4. **Attack surface**: list every input, every stored secret, every privileged function.
5. **Findings**: hypothesis → test on the simulated device → evidence → severity → fix.`,
    { t: 'callout', kind: 'why', md: 'On a Cortex-M image the first word is the initial stack pointer and the second is the reset handler address (with bit 0 set to indicate Thumb). Those two values usually give away the RAM range and the load address, which is what turns a bag of bytes into something you can disassemble.' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
  firmware image (bytes)        simulated device (behaviour)
        |                               |
  [firmware-inspector]            [vuln-device console]
   hex / strings / vectors         commands, responses, errors
        |                               |
  [disasm-lab]                          |
   what the key functions do            |
        \________________ ______________/
                         v
        attack-surface map  ->  ranked findings  ->  recommended fixes
                         |
                 written assessment (the deliverable)`, caption: 'Workflow. Static analysis proposes; the simulated device confirms.' },
    { t: 'ascii', text: String.raw`
Attack-surface table (one row per input or asset)

Interface / asset     Reachable by         Parsed by / stored where   Checks present   Notes
--------------------  -------------------  -------------------------  ---------------  -----
UART console          anyone with a cable  command parser @ ?         ?                ?
hidden/debug command  ?                    ?                          ?                ?
credential / key      image reader         offset ? in image          none?            ?
update path           ?                    ?                          version? sig?    ?`, caption: 'Fill this in before you rank anything.' },
  ],
  steps: [
    { title: 'Milestone 0: rules of engagement and notebook', md: `Write three lines at the top of your notebook: what the targets are, that they are course simulations, and what the deliverable is. Then log every observation with what you did and what you saw. An assessment is only as good as its notes.` },
    { title: 'Milestone 1: triage the primary image', md: `Open the \`lockbox\` image. Without disassembling anything, record: size, the vector table values and what they imply about load address and RAM, every string that suggests a command, a message, a version or a secret, and any region that looks like data rather than code. Write down three hypotheses about what the device does.`,
      blocks: [{ t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' }, caption: 'Synthetic image. Complete the built-in tasks, but keep your own notes — they feed the report.' }] },
    { title: 'Milestone 2: read the code that matters', md: `You never read a whole image. Pick the functions that inputs reach: the comparison that decides access, the loop that copies input, the call that follows a successful check. For each, write one sentence of what it does and what input controls it.`,
      blocks: [{ t: 'widget', name: 'disasm-lab', props: { arch: 'thumb' }, caption: 'Practise recognising a compare, a copy loop and a call in annotated Thumb disassembly.' }] },
    { title: 'Milestone 3: map the attack surface', md: `Fill in the attack-surface table for the image. Include what is *stored* (credentials, keys, debug strings) as well as what is *parsed*. Mark each row with the checks you could and could not find.` },
    { title: 'Milestone 4: confirm on simulated devices', md: `Static findings are hypotheses. Confirm the classes of weakness on the simulated consoles. Work through at least three devices of different kinds — for example a hidden maintenance interface, an unbounded input and an update or replay weakness — and for each record the exact input, the response, and why that response demonstrates the weakness.`,
      blocks: [
        { t: 'widget', name: 'vuln-device', props: { device: 'debug-backdoor' }, caption: 'Simulated device 1.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'overflow-auth' }, caption: 'Simulated device 2.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'rollback-updater' }, caption: 'Simulated device 3. Others are available in the Workbench.' },
      ] },
    { title: 'Milestone 5: analyse the updater image', md: `Repeat triage and surface mapping on the \`updater\` image, focusing on one question: what does it check before accepting new firmware, and what does it not check? Compare against the requirements you wrote for capstone 4.`,
      blocks: [{ t: 'widget', name: 'firmware-inspector', props: { image: 'updater' }, caption: 'Synthetic image.' }] },
    { title: 'Milestone 6: rank and recommend', md: `For each finding write: title, affected component, what an attacker needs (access, equipment, skill), what they gain, evidence, severity with your reasoning, the root cause in design terms, the fix, and the test that would verify the fix. Rank by impact and ease together.` },
    { title: 'Milestone 7: write the assessment', md: `Three to five pages: scope and method, a one-paragraph summary a manager could act on, the device description, the attack-surface map, findings in rank order, and a prioritised fix plan. State what you did not examine.` },
  ],
  walkthrough: [
    `Judgement calls you will have to make, and should explain:

- **How do you know the load address?** State the evidence (vector table values, absolute addresses that point at strings) and how confident you are.
- **Finding or observation?** "Contains a version string" is an observation. "Contains the maintenance password in clear text at offset X, accepted by the console" is a finding. The difference is demonstrated impact.
- **Severity.** A weakness that needs a cable and ten seconds outranks one needing a decapped chip, even if the second gives more. Say what the attacker needs.
- **Root cause over symptom.** "Remove the hidden command" fixes one instance. "Debug features are compiled out of release builds and the release build is checked for them" fixes the class.
- **What you did not find.** Absence of evidence in a partial analysis is not assurance. Say which areas you did not cover.`,
    { t: 'callout', kind: 'mistake', md: 'Reporting the flag or the trick and stopping. A list of ways in, with no root causes and no fixes, is useless to the people who must repair the device — and it is not what this capstone grades.' },
    { t: 'callout', kind: 'decision', md: 'Static analysis first, device second: reading before poking tells you which inputs are worth trying and stops you from mistaking a simulation quirk for a finding. On real hardware it also avoids locking or damaging the only sample you have.' },
  ],
  testing: [
    `Here the "system under test" is your report. Check it against these before submitting.

| Check | How | Pass condition |
|---|---|---|
| Reproducibility | Follow your own steps for each finding from a fresh page load | Same result, using only what the report says |
| Evidence | For each finding, locate the offset, string, instruction or console transcript cited | Every claim points at something a reader can open and see |
| Coverage | Compare the attack-surface table with the findings | Every interface is either covered by a finding, stated clean with reason, or listed as not examined |
| Fix verification | For each fix, read the test you proposed | It is a negative test that would fail on the current device and pass on a fixed one |
| Peer review | Give the report to someone who has not seen the images | They can state the top three risks and what to do first |

For the fixes, link back to your own work: which of the tests from capstone 4 would have caught each finding?`,
    { t: 'widget', name: 'debug-session', props: { scenario: 'tour' }, caption: 'Simulation: what dynamic inspection with a debugger adds to static reading, for the method section of your report.' },
  ],
  troubleshooting: [
    { symptom: 'Disassembly looks like nonsense', cause: 'Wrong load address, wrong instruction set, or you are disassembling data.', fix: 'Re-derive the base from the vector table; confirm absolute addresses in code land on sensible strings or functions.' },
    { symptom: 'A string looks like a secret but the console rejects it', cause: 'It may be a default, a test vector, a decoy, or transformed before comparison.', fix: 'Find the code that references the string\'s address and read what is done with it before the compare.' },
    { symptom: 'You have many observations and no findings', cause: 'Observations were never turned into hypotheses with a test.', fix: 'For each, write "if this is exploitable then input X should produce Y" and try it on the simulated device.' },
    { symptom: 'Findings all rank as critical', cause: 'Severity assigned by impact alone.', fix: 'Add the attacker-requirements column and re-rank on both.' },
    { symptom: 'You cannot reproduce yesterday\'s result', cause: 'Notes recorded conclusions, not inputs.', fix: 'Log exact inputs and outputs as you go; redo the step and write it down properly.' },
  ],
  challenge: `Turn the method on yourself. Take the release binary of firmware **you built** (capstone 1 or 4), and analyse it as an outsider would: run \`strings\` on it, open it in Ghidra or with \`objdump\`, and list everything it gives away — debug messages, key material, format strings, version details, leftover test commands. Write the findings and fix your own build. No solution is given; your binary is not like anyone else's.`,
  quiz: [
    { q: 'A raw Cortex-M image begins with the words 0x20008000 and 0x08000199. What can you infer?', kind: 'arch', choices: [
      { t: 'The stack starts at the top of RAM near 0x20008000, and the reset handler is Thumb code at 0x08000198, so the image is probably loaded at 0x08000000', ok: true, why: 'Correct: word 0 is the initial stack pointer, word 1 the reset vector with bit 0 marking Thumb state; the handler address suggests the flash base.' },
      { t: 'The image is 0x20008000 bytes long and its checksum is 0x08000199', why: 'Neither value is a length or checksum; they are the first two vector table entries.' },
      { t: 'Execution starts at the odd address 0x08000199', why: 'The low bit is a state flag, not part of the address; the instruction is at the even address below it.' },
    ] },
    { q: 'You find the string "mfg-unlock" in an image. What is the correct next step?', kind: 'security', choices: [
      { t: 'Treat it as a hypothesis: find what code references it and test the behaviour on the simulated device', ok: true, why: 'Correct: a string is a lead; it becomes a finding only when you show what it does.' },
      { t: 'Report a critical backdoor immediately', why: 'Without showing that it is reachable and what it grants, you have an observation, and the severity is unknown.' },
      { t: 'Ignore it, since strings are not code', why: 'Strings are among the best leads in a binary because code that uses them reveals intent.' },
    ] },
    { q: 'Which recommendation addresses a root cause?', kind: 'security', choices: [
      { t: 'Build release firmware with debug commands compiled out, and add a release check that fails if they are present', ok: true, why: 'Correct: it removes the whole class and adds a test that keeps it removed.' },
      { t: 'Rename the hidden command to something harder to guess', why: 'The command remains in the image and in the strings; obscurity does not remove the capability.' },
      { t: 'Remove the help text that mentions the hidden command', why: 'Hiding documentation leaves the function reachable by anyone who reads the binary.' },
    ] },
    { q: 'Two findings: (A) a default PIN readable from the image, usable over the console in seconds; (B) a key recoverable only with fault-injection equipment and weeks of work. How should they be ranked?', kind: 'concept', choices: [
      { t: 'A above B: severity combines impact with what the attacker needs, and A needs almost nothing', ok: true, why: 'Correct: ease of attack is half of risk; the cheap attack will happen first and most often.' },
      { t: 'B above A, because keys matter more than PINs', why: 'Impact alone ignores likelihood; a costly attack on a bigger asset can still be the lower risk.' },
      { t: 'Equal, since both are vulnerabilities', why: 'A ranking exists to tell the owner what to fix first; refusing to rank gives them no guidance.' },
    ] },
    { q: 'Why is this capstone limited to course images and firmware you built yourself?', kind: 'concept', choices: [
      { t: 'Analysing and attacking devices you do not own or have permission to test is unlawful in most places and is not needed to learn the method', ok: true, why: 'Correct: the technique is identical on a legitimate target, and authorisation is part of professional practice.' },
      { t: 'Real firmware cannot be disassembled', why: 'It can, with the same tools; the restriction is about authorisation, not feasibility.' },
      { t: 'Real devices have no vulnerabilities worth finding', why: 'They do; that is exactly why testing them requires permission and care.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1: the report describes what each analysed image does, with the evidence for each claim.',
      'FR-2: the report contains an attack-surface table covering every interface and stored asset identified.',
      'FR-3: at least five findings across at least two images/devices, each with attacker requirements, impact, evidence and severity.',
      'FR-4: every finding has a root cause, a recommended fix and a test that would verify the fix.',
      'FR-5: every finding is reproducible from the report alone.',
    ],
    security: [
      'SR-1: all analysis and testing is confined to the course\'s simulated images and devices and to firmware and hardware the learner owns; the report states this scope.',
      'SR-2: the report states what was not examined and makes no assurance claims about it.',
    ],
  },
  rubric: [
    { criterion: 'Scope and method', points: 10, evidence: 'Stated targets, rules of engagement, tools and steps; notebook excerpts.' },
    { criterion: 'Structural analysis', points: 15, evidence: 'Load address, vector table interpretation and memory layout with supporting offsets.' },
    { criterion: 'Functional understanding', points: 15, evidence: 'Description of device behaviour tied to strings, code and console transcripts.' },
    { criterion: 'Attack-surface map', points: 15, evidence: 'Completed table; each row covered, cleared or marked not examined.' },
    { criterion: 'Findings', points: 20, evidence: 'Five or more reproducible findings with evidence and reasoned severity.' },
    { criterion: 'Recommended fixes', points: 20, evidence: 'Root-cause fix and a verifying negative test for each finding; prioritised plan.' },
    { criterion: 'Communication', points: 5, evidence: 'One-paragraph summary a non-specialist can act on; limits of the analysis stated.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [] };
