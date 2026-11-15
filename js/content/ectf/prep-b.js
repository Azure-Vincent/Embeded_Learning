// eCTF preparation, lessons 4-6: reproducible builds and documentation, design review, readiness.
import { FRAMING } from './prep-a.js';

const builds = {
  id: 'ectf-prep-builds',
  title: 'Reproducible builds, testing and security documentation',
  minutes: 50,
  summary: 'A build anyone can repeat, tests for both kinds of requirement, and a written argument for each security requirement.',
  skills: ['ectf-prep-repro-build', 'ectf-prep-security-argument', 'ectf-prep-negative-tests'],
  blocks: [
    `## The problem

The firmware works on the laptop of the one team member who set up the toolchain in week one. On the day of hand-over it is built on a clean machine, by someone else, from the repository alone. The build fails because a package has moved on; or, worse, it succeeds and produces different firmware, because a newer compiler laid the code out differently and the timing-sensitive comparison everyone tested is no longer the code that ships.

A design that cannot be rebuilt identically has not been tested, because what was tested is not what was delivered.`,
    FRAMING,
    `## What "reproducible" means

A build is **reproducible** when the same source and the same documented inputs give the same output on any machine. Three things have to be fixed:

1. **The tools**: compiler, linker, vendor SDK, Python and its packages, each at an exact version.
2. **The inputs**: source at a known commit, and the provisioning parameters (device ID, secrets file).
3. **The environment**: no dependence on the builder's home directory, locale, clock or installed software.

The secrets are an input, not part of the tool. Given the same secrets file, two builds for the same device should be byte-identical; that is a property you can test with a hash.`,
    `## How the example repositories do it

| Year | Build environment in the public example | Pinned components visible in the repository |
|---|---|---|
| 2024 | Nix (\`shell.nix\`) plus Poetry for the Python tooling | Analog Devices MSDK at tag \`v2023_06\`; Arm GCC, Python and a custom OpenOCD package from the Nix expression |
| 2025 | Docker (\`decoder/Dockerfile\`, based on \`ubuntu:24.04\`), plain venv and pip for host Python | MSDK tag \`v2024_02\`; \`gcc-arm-none-eabi\` from the distribution's packages |
| 2026 | Docker (\`firmware/Dockerfile\`, based on \`ubuntu:24.04\`), \`uv\` for host Python | TI MSPM0 SDK \`mspm0_sdk_2_06_00_05\`; TI Arm Clang \`ti-cgt-armllvm_4.0.3.LTS\` (not arm-none-eabi-gcc) |

In 2025 and 2026 the firmware is built by running the container with the repository and the secrets mounted and the device parameters passed as environment variables (a decoder ID in 2025; a PIN and a permission string in 2026). The whole build is one command that somebody else runs. Whatever your Dockerfile does when that command runs is your build.`,
    { t: 'code', lang: 'dockerfile', status: 'pseudo', caption: 'Illustrative Dockerfile showing what to pin. Names and versions are placeholders, not a working recipe for any year.',
      code: `# Base image: a tag such as "ubuntu:24.04" can be re-published with updates.
# Pinning the digest fixes the exact image.
FROM ubuntu:24.04@sha256:<digest-you-recorded>

# Distribution packages: fix versions, or accept and record that they float.
RUN apt-get update && apt-get install -y --no-install-recommends \\
      make=<version> gcc-arm-none-eabi=<version> python3=<version> \\
    && rm -rf /var/lib/apt/lists/*

# Vendor SDK: fetch an exact tag and check its hash before using it.
RUN curl -L -o sdk.zip https://example.invalid/sdk/<exact-tag>.zip \\
    && echo "<sha256>  sdk.zip" | sha256sum -c - \\
    && unzip sdk.zip -d /opt/sdk

# Python tools: a lock file with hashes, not "pip install <name>".
COPY requirements.lock /tmp/
RUN pip install --require-hashes -r /tmp/requirements.lock

WORKDIR /work
ENTRYPOINT ["/work/build.sh"]`,
      explain: [
        { lines: '3', md: 'A tag is a moving name. A digest names one image. Whether to pin by digest is a trade-off between exactness and receiving base-image fixes; decide it deliberately and document it.' },
        { lines: '6-8', md: 'The compiler version decides code layout, inlining and timing. If it floats, two builds a month apart may differ.' },
        { lines: '11-13', md: 'Checking a hash of a downloaded SDK means a changed or corrupted download stops the build instead of silently changing the firmware.' },
        { lines: '16-17', md: 'A lock file records every transitive Python dependency. Host tools generate secrets, so their dependencies are part of the security-relevant build.' },
      ] },
    { t: 'callout', kind: 'why', title: 'Why determinism is a security property',
      md: `Three reasons. **What you tested is what you ship**: constant-time code, stack layout and the placement of secrets all depend on the compiler. **Reviewability**: a reviewer can rebuild and confirm the binary matches the source, so nothing was added by hand. **Secrets hygiene**: a build that reads secrets only from one declared input makes it possible to check that nothing else (debug keys, a developer's test PIN) reached the image.` },
    `## Sources of non-determinism to remove

- Timestamps and build paths embedded in the binary (\`__DATE__\`, \`__TIME__\`, absolute paths in debug strings).
- Unpinned downloads during the build.
- File-system ordering: a wildcard that lists source files in a different order on another machine changes link order.
- Random values generated at build time *outside* the secrets step. Randomness belongs in the secrets file, generated once from the operating system's cryptographic source; the firmware build then consumes it deterministically.
- Host-specific tools that happen to be on one developer's PATH.

The check is mechanical: build twice in fresh containers with the same secrets, and compare SHA-256 hashes of the outputs. Build once more on a second machine. Make that a routine job, not a one-off.`,
    `## Worked example: find and remove a difference

You can try the check on any PC with gcc, with no board. Save this as \`stamp.c\`:`,
    { t: 'code', lang: 'c', status: 'host-tested', caption: 'stamp.c: one source file, built with and without a compiled-in timestamp',
      code: String.raw`#include <stdio.h>

int main(void) {
#ifdef STAMP
    printf("firmware built %s %s\n", __DATE__, __TIME__);
#else
    printf("firmware 1.4.0\n");
#endif
    return 0;
}
`,
      explain: [
        { lines: '5', md: '`__DATE__` and `__TIME__` are replaced by the compiler with the moment of compilation, so the string constant placed in the object file is different on every build.' },
        { lines: '7', md: 'A version string that comes from the source (or from the commit) is the same on every build of that commit.' },
      ] },
    `Compile each variant twice, a second apart, and hash the object files:

\`\`\`
gcc -std=c11 -DSTAMP -c -o a1.o stamp.c; sleep 1; gcc -std=c11 -DSTAMP -c -o a2.o stamp.c
gcc -std=c11         -c -o b1.o stamp.c; sleep 1; gcc -std=c11         -c -o b2.o stamp.c
sha256sum a1.o a2.o b1.o b2.o
\`\`\`

You should see two **different** hashes for \`a1.o\` and \`a2.o\` and two **identical** hashes for \`b1.o\` and \`b2.o\` (that is what gcc 13 on Linux produced when this was checked; the hash values themselves depend on your compiler version, which is the point of pinning it). To find *where* two builds differ, compare them byte by byte with \`cmp -l a1.o a2.o\`, or dump the strings of each and \`diff\` them: the differing bytes are the time.

Two more causes can be reproduced the same way:

- **Build path.** Copy \`stamp.c\` into two different directories and compile with \`-g\` in each: the hashes differ, because debug information records the directory. Adding \`-ffile-prefix-map=$PWD=.\` to both builds makes them equal.
- **A timestamp you cannot remove from the source.** With the environment variable \`SOURCE_DATE_EPOCH\` set to a fixed number of seconds, gcc uses that instant for \`__DATE__\` and \`__TIME__\`, and the two \`-DSTAMP\` builds become identical. Set it from the commit time, not from the clock.

Both were checked with gcc 13; other compilers (including the TI Arm Clang used in the 2026 example) have their own options, so test rather than assume.`,
    { t: 'predict',
      q: `A team's secrets generator seeds a pseudo-random generator with the current time in seconds and derives all deployment keys from it. The build is perfectly reproducible given the secrets file. Is there a problem?`,
      choices: [
        { t: 'No: reproducibility was the goal and it was achieved.', why: 'Reproducibility concerns the build. This question is about how unpredictable the keys are to someone who was not there.' },
        { t: 'Yes: the keys come from a value with only a few million plausible possibilities.', ok: true, why: 'Anyone who can estimate when the secrets were generated can try each second in that window and regenerate every key. The key length is irrelevant when the seed is guessable.' },
        { t: 'Yes: time-based seeds make the build non-deterministic.', why: 'The seed is used once in the secrets step; after that the secrets file is a fixed input and the build is deterministic. The weakness is elsewhere.' },
      ],
      reveal: `Key material must come from the operating system's cryptographic random source (in Python, the \`secrets\` module or \`os.urandom\`), never from a general-purpose generator or a clock. A reviewer recognises the weakness by reading the secrets generator first: it is short, it is host code, and everything else depends on it.` },
    `## Testing both kinds of requirement

Build the test plan from the requirements list of lesson 1, one row per requirement.

| Requirement type | Test style | Runs where |
|---|---|---|
| Functional | Positive tests at typical values and at each limit (maximum length, maximum count, timing bound) | Host-side script driving the device or a host build of the logic |
| Security | Negative tests: the input an insecure implementation would accept, and the check that state did not change | Same harness |
| Parsers and decision logic | Unit tests compiled for the host; long randomised input runs under a sanitizer build | Host only: fast, and repeatable |
| Build | Two clean builds compared by hash; image searched for strings and secrets that must not be present | CI |

Design the firmware so that this is possible: keep protocol parsing and decision logic in plain C files with no hardware dependencies, behind a thin layer that talks to UART and flash. That logic then compiles with \`gcc\` on a PC, where a test takes milliseconds and tools such as AddressSanitizer and UndefinedBehaviorSanitizer catch memory errors the microcontroller would silently survive.`,
    { t: 'callout', kind: 'mistake', title: 'Common mistake: the test build is not the delivered build',
      md: `A team tests with debug printing enabled and optimisation off, then delivers a release build. The release build has different timing, a different stack layout and, sometimes, a debug command that was supposed to be compiled out but was guarded by the wrong macro. Run the full test suite, including the search for leftover strings, against the exact image you will hand over.` },
    `## Writing a security argument

For each security requirement, the design document contains a short, fixed-form argument. Reviewers read these first, and writing them is the most reliable way to find your own gaps.

| Part | Content |
|---|---|
| **Claim** | The requirement, by ID, in one sentence. |
| **Assumptions** | What the adversary can and cannot do; what the hardware is relied on for. |
| **Mechanism** | What in the design enforces it: which key, which check, in which function, on which device. |
| **Why it holds** | A few sentences walking each interface from the threat model and saying why the claim survives it. |
| **Evidence** | Test IDs (negative tests named), and code locations. |
| **Residual risk** | What is not covered, stated plainly. |

### Worked example

> **S2. A recorded unlock exchange cannot be used to unlock later.**
> *Assumptions:* the adversary can record and inject all traffic between credential and reader; cannot read either device's flash.
> *Mechanism:* the reader generates a 16-byte nonce from the hardware random number generator for each attempt (\`reader_begin()\`); the credential returns HMAC-SHA-256 over (reader ID, credential ID, nonce, command) under the pairing key; the reader accepts one response per nonce and discards the nonce on any outcome, including timeout.
> *Why it holds:* a recorded response is bound to a nonce the reader will not issue again except with negligible probability; a response to a different reader fails because the reader ID is in the MAC.
> *Evidence:* tests T-S2-1 (same response twice), T-S2-2 (response after timeout), T-S2-3 (response captured from reader B presented to reader A); \`reader.c\` lines 80–140.
> *Residual risk:* depends on the random number generator's quality; start-up self-test T-RNG-1 only detects gross failure. Relay of a live exchange is out of scope per the specification.

An argument that cannot fill in "Mechanism" or "Evidence" has found a hole in the design. That is its purpose.`,
    { t: 'callout', kind: 'decision', title: 'Why write the argument before the code is finished',
      md: `Written afterwards, an argument describes the code. Written first, it specifies the code: the mechanism paragraph becomes the function's contract and the evidence line becomes the test list. It also costs an hour, where finding the same gap in the final week costs a redesign.` },
    { t: 'exercise',
      prompt: `Write the security argument (all six parts) for this requirement of a storage device: *"S2. No more than 3 PIN guesses can be made between successful unlocks, including across resets and loss of power."* Assume the adversary controls the serial port and the power supply but cannot write the flash directly.`,
      hints: [
        'The adversary controls power. At which moments during an attempt would losing power help them, in a naive design?',
        'The mechanism needs: where the counter is stored, when it is changed relative to the comparison, and what happens if storing it fails.',
        'Evidence means named negative tests. One of them must involve removing power mid-attempt.',
      ],
      solution: `**Claim** S2: at most 3 guesses between successful unlocks, across resets and power loss.
**Assumptions**: adversary sends arbitrary serial input and can cut power at any instant; cannot write flash except through the firmware; flash retains a completed write.
**Mechanism**: a failed-attempt counter is stored in flash. \`try_unlock()\` refuses if the counter is 3 or more; otherwise it increments and commits the counter **before** comparing the PIN, and resets it only after a successful comparison. If the counter write fails, the attempt is refused. The comparison is constant-time.
**Why it holds**: every evaluation of a guess is preceded by a committed increment, so cutting power at any later point leaves the attempt charged; cutting power earlier means no guess was evaluated. A reset does not affect flash. The serial port offers no other command that evaluates or reveals the PIN (see S5).
**Evidence**: T-S2-1 fourth guess refused even when correct; T-S2-2 reset between guesses does not restore attempts; T-S2-3 power removed after each guess, counter still reaches 3; T-S2-4 injected flash-write failure causes refusal; \`auth.c\` \`try_unlock()\`.
**Residual risk**: an honest user who loses power during a correct attempt loses one attempt. Flash wear from the counter is bounded by the lock-out. Fault injection on the comparison itself is not addressed.

Scenario 1 has you implement and test exactly this.` },
    `## Harder application: a build parameter that is a secret

In the 2026 example flow the PIN reaches the firmware build as an environment variable. Consider what that implies in general for any design where a secret is a build input: the value passes through shell history, container logs, CI configuration and any generated header left in the build directory. Your build script decides whether it is echoed, whether the generated header is deleted, and whether the PIN is stored in the image as given or transformed first.

Write down the path a secret takes from the secrets step to the flash image, as a list of files and processes, and for each one say who can read it and when it is erased. Then add a test that searches the build output directory and the final image for the literal value.`,
    { t: 'refs', items: [
      { title: 'MITRE eCTF 2024 insecure example (Nix + Poetry build)', url: 'https://github.com/mitre-cyber-academy/2024-ectf-insecure-example' },
      { title: 'MITRE eCTF 2025 insecure example (Docker build)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example' },
      { title: 'MITRE eCTF 2026 insecure example (Docker build)', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example' },
    ] },
  ],
  quiz: [
    { q: 'Which statement about the public example builds is correct?', kind: 'concept', choices: [
      { t: 'The 2026 example compiles with TI Arm Clang inside Docker.', ok: true, why: 'The 2026 Dockerfile installs the TI MSPM0 SDK and the TI Arm Clang toolchain rather than arm-none-eabi-gcc.' },
      { t: 'The 2025 example builds with Nix and Poetry.', why: 'Nix and Poetry were the 2024 arrangement; the 2025 repository provides a Dockerfile and uses venv and pip for host Python.' },
      { t: 'The 2024 example builds in a Docker container based on Ubuntu 24.04.', why: 'That base image appears in the 2025 and 2026 Dockerfiles; the 2024 example used a Nix shell.' },
    ] },
    { q: 'Two clean builds from the same commit and the same secrets file give different hashes. Which is the least likely cause?', kind: 'concept', choices: [
      { t: 'A build timestamp compiled into the image.', why: 'This is one of the most frequent causes: the date and time macros change on every build.' },
      { t: 'An unpinned compiler package that was updated between builds.', why: 'A different compiler version commonly produces different code from identical source.' },
      { t: 'The use of a signature scheme in the update format.', ok: true, why: 'The firmware containing signature-verification code does not make the build vary. (Signing the output with a randomised scheme changes the signature bytes, which is why hashes are compared before signing.)' },
    ] },
    { q: 'Why keep protocol parsing in hardware-independent C files?', kind: 'arch', choices: [
      { t: 'It makes the firmware smaller.', why: 'Size is not noticeably affected by how files are organised.' },
      { t: 'It can then be compiled and tested on a PC, quickly and under sanitizers.', ok: true, why: 'Host builds run thousands of malformed inputs per second and report out-of-bounds accesses that a microcontroller would not.' },
      { t: 'The vendor SDK requires it.', why: 'No SDK imposes this; it is a design choice made for testability.' },
    ] },
    { q: 'In a security argument, what belongs under "residual risk"?', kind: 'concept', choices: [
      { t: 'Nothing; a good design has none.', why: 'Every design rests on assumptions. Claiming none tells a reviewer that the limits were not examined.' },
      { t: 'What the mechanism does not cover, and assumptions that might not hold.', ok: true, why: 'Stating limits makes the argument credible and tells the team where further work would go.' },
      { t: 'A list of the tests that currently fail.', why: 'Failing tests are defects to fix before hand-over, not accepted risk.' },
    ] },
    { q: 'A secrets generator uses Python\'s `random` module to produce keys. What should a reviewer conclude?', kind: 'security', choices: [
      { t: 'It is fine as long as the keys are 256 bits long.', why: 'Output length does not add unpredictability; the generator\'s internal state determines every bit it produces.' },
      { t: 'The keys are predictable in principle, because that generator is not designed for secrets; use the OS cryptographic source.', ok: true, why: 'General-purpose generators are built for statistical quality and speed, and their state can be reconstructed or guessed from the seed.' },
      { t: 'It is fine because the secrets file is not published.', why: 'Predictable keys can be regenerated without ever seeing the file.' },
    ] },
  ],
};

const review = {
  id: 'ectf-prep-review',
  title: 'Reviewing a design for weaknesses',
  minutes: 90,
  summary: 'A structured method: list the interfaces, check each against a catalogue of weakness classes, and record findings with a defence and a test.',
  skills: ['ectf-prep-design-review', 'ectf-prep-negative-tests'],
  blocks: [
    `## The problem

Your design passes all its tests. In a week it will be examined by people whose only job is to find where it fails. Reading the code again from top to bottom, hoping to notice something, finds little: you wrote it, so you read what you meant.

A review needs a method that does not depend on inspiration: a fixed list of places to look and a fixed list of things to look for. The cross product of the two is the work plan.`,
    FRAMING,
    { t: 'callout', kind: 'security', title: 'Scope of this lesson',
      md: `The method is taught as something a design team applies to **its own** system so that weaknesses are fixed before hand-over. The practice targets are the course's intentionally vulnerable simulations. For each weakness class you get four things: the class, how a reviewer recognises it, the defence, and the test that proves the defence. Apply the method only to systems you built, own, or are explicitly authorised to assess.` },
    `## Step 1: list the interfaces

Take the block diagram and the threat model from lesson 2 and list every interface, whether or not you think it matters.

| Interface | Questions to answer before reviewing it |
|---|---|
| **Hardware debug port** (SWD/JTAG) | Is it enabled in the delivered configuration? What can be read or written through it? Who decides that: you, or a supplied bootloader? |
| **Serial console / host protocol** | Every command, every argument, every response and error string. |
| **Buses between devices** (I2C, UART, SPI, radio) | Every message type, in both directions; who can observe and who can inject. |
| **Update path** | What is accepted, what is checked, when, and by which code. |
| **Stored data** | Every item in flash: format, who writes it, who believes it when it is read back. |
| **Build and provisioning** | What goes into the image; where secrets come from. |
| **Physical** | Timing, power, reset, and what an owner of the board can do to it. |`,
    `## Step 2: check each interface against the catalogue

Eight classes cover most findings in designs of this size. For each: what it is, how you recognise it, how you defend, how you verify.

### 1. Missing or weak authentication
**Class.** An operation that should need proof of identity needs none, or needs something guessable or constant.
**Recognise it.** List the handlers; for each, find the line that checks authentication. Handlers with no such line are findings. Look for constant credentials in the source or image, for secrets shared by every device, and for comparisons that exit at the first mismatch.
**Defence.** One authentication gate that every sensitive handler passes through; per-device secrets; constant-time comparison; attempt limiting that survives reset.
**Verify.** Call every sensitive operation without authenticating and require refusal. Measure that response time does not depend on how many leading characters of a guess are right.

### 2. Cryptographic implementation flaws
**Class.** The primitive is sound and its use is not.
**Recognise it.** Find every call into the crypto library and write down: key, nonce or IV source, what is authenticated. Flags: a constant or reset-to-zero nonce; encryption with no tag; a tag that is computed but not compared, or compared after the plaintext is used; an ignored return value; a hash or CRC standing in for a MAC; keys or seeds from a non-cryptographic generator; home-made constructions.
**Defence.** AEAD with a nonce that provably never repeats per key; verify before use; check every return value; keys from a cryptographic source via a KDF.
**Verify.** Capture two outputs and confirm the nonces differ, including across a reset. Flip one bit of ciphertext, of the tag and of the header in turn; each must be refused.

### 3. Insecure communication protocols
**Class.** Each message is fine alone, and the conversation is not.
**Recognise it.** Draw the message sequence. For each message ask: can it be repeated later? Sent to a different device? Reflected back to its sender? Presented as a different message type? Is every field that affects behaviour inside the authenticated data?
**Defence.** Freshness (counter or verifier nonce); identities, direction and type bound into the authenticated data; separate keys per pair and per direction.
**Verify.** Replay, redirect, reflect and re-type a valid message; all four refused.

### 4. Memory-safety defects
**Class.** Input causes a read or write outside the intended object.
**Recognise it.** At every trust boundary, find where a length or index from the message is used. Flags: a copy whose size comes from the message; a fixed buffer filled until a terminator; arithmetic on lengths before the bounds check (it can wrap); an index used before it is range-checked, especially a signed one; \`printf\`-style calls whose format string is input.
**Defence.** Validate length and index against the destination before use; reject rather than truncate; do the arithmetic in a way that cannot wrap; constant format strings; compiler stack protection as a second line, not the first.
**Verify.** Boundary tests at maximum, maximum plus one, zero and the largest representable value; a long randomised run of the host-compiled parser under sanitizers.

### 5. Access-control gaps
**Class.** The requester is authenticated and is allowed more than the policy says.
**Recognise it.** Write the permission table from the specification. For each handler, find where the table is consulted. Flags: checks present in some handlers only; the permission taken from the request; a check on one field while another field selects the object.
**Defence.** Default deny; one authorisation function called immediately before the operation on the device that owns the object.
**Verify.** For each role and each operation it should not have, attempt it and require refusal with no state change.

### 6. Insecure bootloaders and update paths
**Class.** Unauthorised or outdated code can be installed or run.
**Recognise it.** Trace an update from first byte to first instruction executed. Flags: integrity by CRC or unkeyed hash; signature checked after writing over the running image; version outside the signed data or compared non-strictly; verification at install only; a recovery or "force" path with weaker checks.
**Defence.** Signature over header and image, verified by immutable code before use and at every boot; monotonic minimum version; two slots or a resumable loader.
**Verify.** The negative tests of lesson 3, section 4.

### 7. Leftover debug features
**Class.** Something built for development is still reachable.
**Recognise it.** Search the delivered image, not the source, for strings; look for commands not in the specification, verbose errors, test credentials, conditional compilation that depends on a macro the release build might define.
**Defence.** Remove rather than disable; a release configuration that is the only one ever tested; an automated check of the image for forbidden strings.
**Verify.** Every command not in the specification is refused; the string search of the final image is clean.

### 8. Physical exposure
**Class.** The adversary holds the board.
**Recognise it.** Ask what is readable through the debug port and from the flash; whether secrets are in the image in clear; whether timing, reset or loss of power at a chosen moment changes a security decision; whether a single skipped instruction would turn a refusal into an acceptance.
**Defence.** Lock or disable debug access as the platform and rules allow; do not store what you can derive or avoid; charge counters before the operation; constant-time handling of secrets; redundant checks on the critical decision where fault injection is in scope.
**Verify.** Review of the delivered configuration; power-loss tests around every state update; timing measurements. Fault-injection resistance can be argued and partly simulated, and is honestly listed as residual risk if you cannot test it.`,
    { t: 'callout', kind: 'mistake', title: 'Common mistake: reviewing the source instead of the image',
      md: `The source says the debug command is inside \`#ifdef DEBUG\`. The image is what is delivered. Inspect the built artefact: its strings, its size, its sections. If the two disagree, the image is right about what you shipped.` },
    `## Step 3: record findings

A finding nobody can act on is not worth writing down. Use one fixed form:

| Field | Content |
|---|---|
| **ID and title** | R-07: Failed-attempt counter is lost on reset |
| **Interface** | Serial console, power |
| **Class** | Missing or weak authentication (attempt limiting) |
| **Requirement affected** | S2 |
| **Observation** | What the design does, with the code location. Factual; no narrative. |
| **Consequence** | Which requirement fails and under which adversary capability. |
| **Severity** | High / medium / low, with the reason. |
| **Recommended defence** | The design change. |
| **Verification** | The test that will fail now and pass after the fix. |

Rank by which security requirement is defeated and how little capability it takes. A finding that defeats a requirement using only the serial port outranks one that needs the board opened.`,
    `## Practice on the course simulations

Each widget below is an intentionally vulnerable simulation written for this course. For each one, your task is the same: identify the **interface** and the **class**, then write the finding in the form above, including the defence and the verification test, in your notebook.`,
    { t: 'widget', name: 'vuln-device', props: { device: 'debug-backdoor' }, title: 'Practice 1: a serial console',
      caption: 'Simulated device. Enumerate its commands the way step 1 says. Which catalogue class applies, and what would the image-inspection test have shown before delivery?' },
    { t: 'widget', name: 'firmware-inspector', props: { image: 'lockbox' }, title: 'Practice 2: the delivered image',
      caption: 'A synthetic firmware image bundled with the course. Review it as you would your own release artefact: what is in it that a requirement says must not be recoverable?' },
    { t: 'predict',
      q: `A PIN check compares the entered PIN with the stored one byte by byte and returns at the first difference. The console prints only "denied" either way. Does the device reveal anything about the PIN?`,
      choices: [
        { t: 'No: the message is identical for every wrong PIN.', why: 'The text is identical. Consider what else about the response differs between a guess whose first digit is right and one whose first digit is wrong.' },
        { t: 'Yes: the time to respond depends on how many leading bytes are correct.', ok: true, why: 'An early exit does less work the sooner the mismatch occurs, so response time carries information about the position of the first wrong byte.' },
        { t: 'Only if the attacker can read the flash.', why: 'Reading flash would be a different weakness. This one needs nothing beyond the ability to send guesses and measure responses.' },
      ],
      reveal: `This is class 1 seen through class 8: an authentication check whose **duration** is an output. The defence is a comparison that always processes every byte and combines the differences, plus an attempt limit so that few measurements are possible. The test is statistical: time many guesses with the first mismatch at different positions and show the distributions are indistinguishable. Try it below with the defence off, then on.` },
    { t: 'widget', name: 'timing-attack', props: { defence: 'none' }, title: 'Practice 3: comparison time as an output',
      caption: 'Simulated comparison timing. Observe the signal, then switch the defence to constant-time and confirm it disappears. Record the measurement you would use as the verification test.' },
    { t: 'widget', name: 'stack-smash', props: { mitigation: 'none' }, title: 'Practice 4: a fixed buffer at a trust boundary',
      caption: 'A simulated stack frame. See what an over-long input overwrites, then enable the bounds-check mitigation and state the boundary test (maximum, maximum plus one) that verifies it.' },
    { t: 'widget', name: 'integer-overflow', props: { challenge: 'length-check' }, title: 'Practice 5: arithmetic before the check',
      caption: 'A length check that does arithmetic in a fixed width. Find the input class that passes the check and still exceeds the buffer, then write the check so that it cannot wrap.' },
    { t: 'callout', kind: 'decision', title: 'Why review by interface and class instead of by file',
      md: `Reading file by file follows the author's structure, and weaknesses sit where the author's mental model was incomplete, which is usually *between* files: a length validated in one and trusted in another. Interfaces follow the adversary's structure instead. The catalogue stops a review from ending when the first interesting issue is found, because every cell of the table still has to be answered.` },
    { t: 'exercise',
      prompt: `You have now reviewed five simulations. Write a short review report: a one-paragraph scope statement, then a findings table with one row per simulation (ID, interface, class, requirement affected, defence, verification test), ordered by severity. Then answer: which two findings would the *same* single test in an automated suite have caught before delivery?`,
      hints: [
        'Scope statement: what was reviewed (course simulations), by what method (interfaces × catalogue), and what was out of scope.',
        'Severity: which finding defeats a requirement with the least capability?',
        'For the last question, think about a test that inspects the delivered image rather than talking to the device.',
      ],
      solution: `A model answer, abbreviated:

**Scope.** Five intentionally vulnerable course simulations, reviewed interface by interface against the eight-class catalogue. No physical hardware. Fault injection out of scope.

| ID | Interface | Class | Defence | Verification |
|---|---|---|---|---|
| R-1 | Serial console | Leftover debug feature | Remove the command from the release build | Every command outside the specification is refused; image string search clean |
| R-2 | Delivered image | Physical exposure / weak authentication (secret stored in clear) | Do not store the secret in clear; per-device provisioning | Image search for provisioned values finds nothing |
| R-3 | Serial console (timing) | Weak authentication | Constant-time compare and persistent attempt limit | Timing distributions indistinguishable; fourth attempt refused |
| R-4 | Serial input buffer | Memory safety | Bounds check before copy; reject over-long input | Max and max+1 tests; sanitizer run on host build |
| R-5 | Message length field | Memory safety (integer wrap) | Check without wrapping arithmetic | Largest-value and boundary tests |

R-1 and R-2 would both be caught by one automated job that searches the release image for strings and values that must not be there. That job costs minutes to write, which is why it belongs in every build.` },
    `## Harder application: a finding that is not in the code

A two-device design authenticates every message with a MAC under a pairwise key, with a counter. Every cell of your table passes. Then you look at provisioning: the pairwise key is derived from the two device IDs alone, with no secret input.

No handler is wrong. The weakness is in a build-time script, and its class is a cryptographic implementation flaw: the "key" is a public function of public values. This is why build and provisioning is a row in the interface list, and why the review covers the host code that generates secrets with the same care as the firmware.`,
    { t: 'refs', items: [
      { title: 'MITRE Common Weakness Enumeration (CWE)', url: 'https://cwe.mitre.org/', note: 'Reference catalogue of weakness classes; useful for naming findings consistently. Not load-tested from this environment.' },
    ] },
  ],
  quiz: [
    { q: 'What are the two lists whose combination forms the review plan?', kind: 'concept', choices: [
      { t: 'Source files and team members.', why: 'That organises who reads what, and follows the author\'s structure, which is where blind spots are.' },
      { t: 'Interfaces and weakness classes.', ok: true, why: 'Every interface is checked against every class, so coverage does not depend on noticing something by chance.' },
      { t: 'Functional requirements and test cases.', why: 'That pairing verifies function. A review looks for behaviour nobody specified.' },
    ] },
    { q: 'A handler copies `msg.len` bytes into a 64-byte buffer after checking `if (msg.len + 4 > 68) return;` where `len` is a `uint8_t` promoted to `int`. A colleague proposes storing the sum in a `uint8_t` first. What changes?', kind: 'code', choices: [
      { t: 'Nothing; the check is equivalent.', why: 'The types differ. Work out the value of 255 + 4 when the result must fit in eight bits.' },
      { t: 'The sum can now wrap to a small number, so a large length passes the check.', ok: true, why: '255 + 4 is 259, which stored in eight bits is 3. The check passes and 255 bytes are copied into 64. Arithmetic on a length before its bounds check must not be able to wrap.' },
      { t: 'The check becomes stricter.', why: 'A narrower type cannot represent large sums at all, so large inputs appear small rather than being rejected.' },
    ] },
    { q: 'Which observation indicates an access-control gap rather than an authentication problem?', kind: 'security', choices: [
      { t: 'The PIN is compared with an early-exit loop.', why: 'That concerns how identity is proven, which is authentication.' },
      { t: 'A logged-in user with read-only permission can issue the write command successfully.', ok: true, why: 'Identity was established correctly; the policy for what that identity may do was not enforced.' },
      { t: 'The same key is used on every device.', why: 'That is a key-management weakness affecting authentication between devices.' },
    ] },
    { q: 'Why is "verification" a mandatory field of a finding?', kind: 'concept', choices: [
      { t: 'It makes the report longer and more convincing.', why: 'Length is not the point; the field has a specific engineering use.' },
      { t: 'It defines a test that fails now and passes after the fix, so the fix can be demonstrated and kept from regressing.', ok: true, why: 'Without it there is no objective way to show the weakness is gone, or to notice if it returns.' },
      { t: 'Reviewers are not allowed to suggest defences.', why: 'Recommending a defence is part of the form. Verification is what shows the defence works.' },
    ] },
    { q: 'An update path verifies a signature when an image is installed but not when it boots. Which adversary capability turns this into a failure of "only vendor images run"?', kind: 'arch', choices: [
      { t: 'The ability to observe the serial port.', why: 'Observation alone changes nothing in flash; consider what must happen between install and boot.' },
      { t: 'Any way to change flash contents after installation, such as a memory-safety defect or an open debug port.', ok: true, why: 'The check guards one moment. If the image can be altered afterwards, nothing looks at it again before it runs.' },
      { t: 'Knowledge of the public key.', why: 'A public key is not secret and does not allow producing signatures.' },
    ] },
    { q: 'Which is the best evidence that a debug command is absent from the delivered firmware?', kind: 'security', choices: [
      { t: 'The source places it inside a conditional-compilation block.', why: 'That shows intent. Whether the release configuration defines the macro is a separate fact.' },
      { t: 'An automated search of the release image finds neither the command string nor its handler, and the command is refused when sent.', ok: true, why: 'Evidence comes from the artefact that is shipped and from its behaviour, repeated on every build.' },
      { t: 'The command is not listed in the user documentation.', why: 'Documentation describes what users are told, not what the firmware contains.' },
    ] },
  ],
};

const readiness = {
  id: 'ectf-prep-readiness',
  title: 'Readiness: a checklist and a plan for the design phase',
  minutes: 35,
  summary: 'Check yourself against the skills this course tracks, and lay out the weeks of a design phase so the security work is not left to the end.',
  skills: ['ectf-prep-plan'],
  blocks: [
    `## The problem

A team has six weeks. For four of them it works on making the reference design's features work on the real board. In week five it starts on security. In week six it discovers that the protocol it needs requires a persistent counter, that the flash layout has no room for one, and that the host tools must change too. It delivers the reference design with encryption added on top.

The failure was scheduling. Security properties are architectural, so they have to be decided while the architecture can still change.`,
    FRAMING,
    `## A readiness checklist

Tick an item only if you could do it today without help. Each line names the part of this course that trains it; the Skills page shows your recorded progress.

**Electronics and bring-up**
- Power a board safely, find a ground reference, and confirm supply voltage with a multimeter. *(Electronics)*
- Wire a UART between two 3.3 V devices and explain what happens if TX and RX are swapped. *(Communication protocols)*
- Capture and decode UART and I2C with a logic analyser. *(Communication protocols, Hardware debugging)*

**Firmware**
- Read a linker script and say where code, data and a fixed-address table live. *(Microcontroller architecture)*
- Write and review C that parses a length-prefixed message without trusting the length. *(Embedded C, Firmware engineering)*
- Explain what an interrupt may and may not touch in shared state. *(Real-time systems)*
- Step through a fault with GDB and OpenOCD and find the faulting line. *(Hardware debugging)*

**Security engineering**
- Produce a threat model with assets, adversaries, entry points and mitigations. *(Embedded security; lesson 2 here)*
- Choose between MAC, signature and AEAD for a stated requirement, and say what must be in the authenticated data. *(Lesson 3)*
- Explain nonce reuse, replay, rollback and early-exit comparison, each with its defence and its test. *(Embedded security; lessons 3 and 5)*
- Review a design by interface and weakness class and write findings a teammate can act on. *(Lesson 5)*

**Process**
- Turn a specification into numbered requirements with a verification method each. *(Lesson 1)*
- Build firmware from a clean checkout in a container, twice, and compare hashes. *(Lesson 4)*
- Write a six-part security argument for a requirement. *(Lesson 4)*

**Platform**
- State, for the year you are preparing for, the microcontroller, the toolchain and how firmware gets onto the board, and say which of those facts you have personally confirmed from the official documentation. *(Platform lessons in this section)*`,
    { t: 'callout', kind: 'warn', title: 'Check the current year yourself',
      md: `The hardware has changed between years (a MAX78000 board in 2024 and 2025; a TI MSPM0L2228 in 2026) and so has the tooling. Several details, including the exact 2026 board name and the behaviour of the supplied bootloaders, could not be verified for this course. Before planning around any platform detail, read the current year's official material.` },
    `## Planning the weeks

The durations below are a template for a design phase of about six weeks; scale them to the real schedule, which you take from the official rules.

| Period | Goal | Output that must exist at the end |
|---|---|---|
| **Days 1–3** | Understand | Reference design built and running unmodified; numbered requirements list; open questions sent |
| **Rest of week 1** | Model | Threat model; trust-boundary diagram; a review of the *reference design* by interface and class (it tells you what the specification's authors expect you to fix) |
| **Week 2** | Decide | Architecture document: keys and where they live, message formats, storage layout, security argument drafted for every S requirement; reproducible build working in CI |
| **Weeks 3–4** | Build | Implementation, with host-compiled unit tests for parsers and decision logic; negative tests added as each mechanism lands |
| **Week 5** | Review | Feature freeze. Full self-review of your own design by people who did not write each part; fix findings; timing and power-loss tests on hardware |
| **Week 6** | Harden and hand over | Only fixes with a test. Clean-machine build, hash comparison, image inspection, documentation complete |

Three rules make the plan hold:

1. **The reference design keeps working at every commit.** Functional tests run in CI from day three, so a security change that breaks a functional requirement is seen the same day.
2. **Nothing is "done" without its negative test.**
3. **Freeze before the last week.** New mechanisms introduced in the final days are the ones nobody has reviewed.`,
    { t: 'predict',
      q: `With five days left, a teammate proposes replacing the working counter-based freshness scheme with a challenge–response handshake that is "more secure". The current scheme passes all its negative tests. What should the team do?`,
      choices: [
        { t: 'Adopt it: more security is always better.', why: 'A new protocol brings new code at a trust boundary and no review history. Whether it is more secure in practice depends on an implementation that does not yet exist.' },
        { t: 'Keep the tested scheme unless the proposal fixes a specific finding against a requirement.', ok: true, why: 'The existing design is demonstrated; the replacement is not. A change this late is justified only by an identified failure, with the test that shows it.' },
        { t: 'Implement both and select one with a build flag.', why: 'That doubles the code at the trust boundary and creates a configuration that may never be tested as delivered.' },
      ],
      reveal: `Ask the review question: *which requirement does the current design fail, and what test shows it?* If there is an answer, it is a finding and gets fixed. If there is none, the proposal is a preference, and it goes in the notes for next time.` },
    { t: 'callout', kind: 'mistake', title: 'Common mistake: one person holds the whole security design',
      md: `If only one team member understands the key hierarchy and the protocol, nobody can review that person's work, and the design stops when they are unavailable. The architecture document and security arguments exist so that a second person can check each claim against the code.` },
    { t: 'callout', kind: 'decision', title: 'Why review the reference design first',
      md: `It is tempting to start building immediately. Spending two days reviewing the insecure reference design against the security requirements pays back in three ways: you learn the code base by asking pointed questions of it, you get a list of everything that must change (which is your work breakdown), and you practise the review method on code you did not write, which is easier than on your own.` },
    { t: 'exercise',
      prompt: `Your team has 4 people and 5 weeks. The system has two device types and a host tool. Draft the plan: for each week, one goal and the artefact that proves it; and name which role owns (a) the requirements list, (b) the build and CI, (c) the protocol and key design, (d) the self-review. One person may hold more than one role, but (c) and (d) must not be the same person. Say why.`,
      hints: [
        'Compress the six-week template: which two periods can share a week without moving security decisions later?',
        'CI with functional tests should exist before any security change is merged.',
        'Think about what the reviewer of a protocol needs to be able to do that its author cannot.',
      ],
      solution: `One workable plan:

- **Week 1**: reference design running; requirements list; threat model; review of the reference design. *Artefacts:* requirements table, findings list, CI running functional tests.
- **Week 2**: architecture and security arguments; provisioning and message formats fixed. *Artefact:* design document reviewed by the whole team.
- **Weeks 3–4 (first half)**: implementation with negative tests. *Artefact:* test report, every S requirement with at least one passing negative test.
- **Week 4 (second half)**: freeze and self-review. *Artefact:* review report in the lesson 5 form.
- **Week 5**: fixes with tests, clean build, documentation. *Artefact:* reproducible image hash, final test report.

Owners: (a) one person, who is also the contact for clarifications; (b) one person, from day one; (c) and (d) different people, because an author reads their own protocol as intended rather than as written, and a reviewer must be free to say the design is wrong.` },
    `## Harder application: when the schedule slips

At the end of week 3 of the plan above, one of five security requirements has no working mechanism, and its design needs a persistent counter that the flash layout does not yet support. You cannot do everything. Decide in this order:

1. **Functional requirements first.** A design that does not work is usually worth nothing in any scheme; confirm this against the real rules.
2. **Rank the security requirements** by how little capability defeats each in your current state. Fix those that fail to an adversary with only the normal interface before those that need the board opened.
3. **Prefer a simple mechanism you can test over a strong one you cannot finish.**
4. **Document what is not met**, in the residual-risk part of its security argument. A known, stated gap is an engineering result; an unknown one is a surprise.

Then write down what the plan should have done differently, while you remember. That note is where the next plan starts.`,
  ],
  quiz: [
    { q: 'When should the security architecture be decided?', kind: 'arch', choices: [
      { t: 'After all functional features work, so there is something to secure.', why: 'By then storage layout, message formats and host tools are settled, and security mechanisms that need changes to them no longer fit.' },
      { t: 'Early, while message formats, storage layout and provisioning can still change.', ok: true, why: 'Freshness, per-device keys and update protection all impose structure on formats and storage, so they are architectural decisions.' },
      { t: 'During the final review, when weaknesses are known.', why: 'A review finds defects in a design; it is too late a point to choose the design itself.' },
    ] },
    { q: 'What is the purpose of a feature freeze before the final week?', kind: 'concept', choices: [
      { t: 'To give the team a rest.', why: 'The week is spent on review and fixes, which is work; the freeze has a technical purpose.' },
      { t: 'So that everything delivered has been reviewed and tested as delivered.', ok: true, why: 'Code added after the review has, by definition, not been reviewed.' },
      { t: 'Because the build system cannot handle late changes.', why: 'A reproducible build handles any commit. The limit is on what humans can still verify.' },
    ] },
    { q: 'Why must the protocol designer and the self-review owner be different people?', kind: 'concept', choices: [
      { t: 'To spread the workload evenly.', why: 'Workload could be balanced in many ways; this separation has a specific reason.' },
      { t: 'An author tends to read the design as intended; an independent reader checks it as written.', ok: true, why: 'The gaps are where the author\'s mental model differs from the code, which the author is least able to see.' },
      { t: 'Reviewers need less technical skill than designers.', why: 'Reviewing a protocol requires at least as much understanding as designing one.' },
    ] },
    { q: 'A platform detail for the coming year is listed in this course as unverified. What should you do before relying on it?', kind: 'concept', choices: [
      { t: 'Assume it matches the previous year.', why: 'The microcontroller, toolchain and build system have all changed between recent years.' },
      { t: 'Confirm it in the current year\'s official documentation and the manufacturer\'s datasheet.', ok: true, why: 'Primary sources for the current year are the only reliable basis for a design decision.' },
      { t: 'Ask a search engine and use the first answer.', why: 'Summaries may be out of date or describe another year; they are leads to a primary source, not a substitute.' },
    ] },
    { q: 'Late in the schedule, one security requirement cannot be fully met. Which response is best?', kind: 'security', choices: [
      { t: 'Say nothing and hope it is not noticed.', why: 'The gap exists whether or not it is documented, and the team loses the chance to reduce its impact deliberately.' },
      { t: 'Implement the simplest testable mitigation and state the remaining gap as residual risk.', ok: true, why: 'A tested partial defence with an honest statement of limits is a sound engineering outcome.' },
      { t: 'Remove a functional feature so the requirement no longer applies.', why: 'Functional requirements are not optional, and removing one usually costs more than the unmet security requirement.' },
    ] },
  ],
};

export default [builds, review, readiness];
