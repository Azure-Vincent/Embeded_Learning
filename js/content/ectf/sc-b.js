// Practice scenarios 3, 4 and 5. Original course exercises; not MITRE material.
import { SCENARIO_NOTE, METHOD, refStep } from './sc-a.js';
import { UPDATE_SOL, UPDATE_START, KEYPOL_SOL, KEYPOL_START, FRAME_C, RELAY_REF, RELAY_REF_OUT, FIELDBUS_REF, FIELDBUS_REF_OUT, KEYKEEPER_REF, KEYKEEPER_REF_OUT } from './code.js';

const relay = {
  id: 'ectf-sc-relay',
  title: 'Scenario 3: Relay, firmware update and provisioning',
  kind: 'Scenario',
  minutes: 360,
  summary: 'Signed images, anti-rollback, per-device keys and device-to-device trust: review an update system that checks a CRC and replace it with one that verifies.',
  skills: ['ectf-sc-review-reference', 'ectf-sc-secure-update', 'ectf-sc-evidence'],
  requires: ['mcu-architecture', 'firmware-eng', 'security'],
  objectives: [
    'Trace an update from first received byte to first executed instruction and find where trust is assumed.',
    'Design an image format in which everything that affects the decision is covered by a signature.',
    'Design anti-rollback state that only moves forward and survives an interrupted update.',
    'Design provisioning in which no device holds anything that can authorise an update or impersonate another device.',
  ],
  hardware: [
    'None required: decision logic, image tooling and tests run in the app and on a PC.',
    'Optional: an ESP32 development board you own, to observe the vendor\'s own update and secure-boot mechanisms (read the irreversibility warning in the steps first).',
  ],
  software: [
    'This app: the `secure-boot-chain`, `vuln-device`, `firmware-inspector`, `crypto-lab`, `integer-overflow` and C lab tools.',
    'Optional: gcc and Python 3 on a PC for a host-side packaging tool and bootloader-logic tests.',
  ],
  requirements: {
    functional: [
      'F1. A deployment secrets step runs once. A per-device build then produces firmware for one device with a unique 32-bit device ID.',
      'F2. A host packaging tool turns an application binary and a version number into an update file for one deployment.',
      'F3. A device receives an update file over its serial port, installs it, and reports the running version on request.',
      'F4. If power is lost at any point during an update, the device still boots a valid image afterwards.',
      'F5. Two devices of the same deployment connected by a serial link can each establish that the other belongs to the deployment before exchanging application data.',
      'F6. The application image may be up to 128 KiB.',
      'F7. The device answers an update with one status: accepted or refused. A refused update leaves the running image, the stored version and every other part of flash exactly as they were.',
    ],
    security: [
      'S1. A device installs and runs only application images produced by the deployment\'s packaging tool with the deployment\'s release key.',
      'S2. A device never installs or runs an image whose version is not greater than the highest version it has previously accepted. No command, flag or mode overrides this.',
      'S3. An update file produced for one deployment is refused by devices of another deployment.',
      'S4. Extracting every secret from one device does not allow creating an acceptable update, nor impersonating a different device in F5.',
      'S5. No byte of an image influences the device before the image is verified, other than being stored in an inactive area; verification is repeated at every boot.',
      'S6. Header fields (length, version, target) are validated before use; a malformed update file cannot cause writes outside the inactive image area.',
    ],
  },
  background: [
    SCENARIO_NOTE,
    `## The system

Relay devices sit in the field and receive new firmware over a serial link. They also talk to each other. The adversary controls the serial link, holds old genuine update files, owns a device from a *different* deployment, and has opened one device of this deployment and read its flash.

${METHOD}`,
    { t: 'callout', kind: 'note', title: 'How this relates to real eCTF years',
      md: `In the 2024, 2025 and 2026 example designs, teams did not write the first-stage bootloader: a MITRE-supplied bootloader occupies the start of flash and the team's firmware starts at a fixed address after it. An earlier year (2017) had teams build a secure bootloader, and 2022 a firmware installation routine. This scenario teaches the general technique on a generic model. It does not reproduce any of those systems.` },
    `## Interface specification

**Reference update file** (to be replaced by your signed format). All integers are 32-bit little-endian.

| Offset | Size | Field | Meaning in the reference design |
|---|---|---|---|
| 0 | 4 | magic | the ASCII bytes \`RLY1\` |
| 4 | 4 | version | release number |
| 8 | 4 | length | number of image bytes that follow the header |
| 12 | 4 | flags | bit 0 = "force install" |
| 16 | 4 | crc | CRC-32 (reflected, polynomial 0xEDB88320, as used by zip) of the image bytes |
| 20 | length | image | the application |

**Device boundary in the host build.** Flash is an array. \`dev_factory(version, image, len)\` is the factory installation of the first image. \`dev_update(file, n)\` is called when an update file of \`n\` bytes has arrived and returns \`UPD_OK\` or \`UPD_REFUSED\` (F7). \`dev_boot()\` is a reset: it returns the version of the image that would start, or 0 if the device stays in its loader. \`dev_test_active_image()\` gives the tests a pointer to the bytes that would execute, so they can check that a *complete* genuine image is there and can alter flash behind the device's back (T-S5-1). \`pkg_make()\` is the packaging tool of F2.

**Power loss.** \`flash_budget\` is the number of flash operations (one erase, or one byte programmed) that still succeed; after that every flash operation is silently lost, which is the state the device would be found in at the next power-up. The harness sets it, calls \`dev_update()\`, restores it and calls \`dev_boot()\`. A real page interrupted mid-write can also hold indeterminate data; the model does not show that, so record it as residual risk.

**Signatures in the host build.** The reference design needs no key. Yours needs a signature to be created in \`pkg_make()\` and verified in the device part: link a maintained library (on a PC, OpenSSL's EVP interface with \`-lcrypto\`) and do not write the arithmetic yourself. A boolean stand-in is acceptable while you debug the slot logic, but it is not evidence for S1, S3 or S4.`,
    `## The insecure reference design

Rows marked † describe parts of the reference system that are not in the step 2 listing (the later symmetric-key variant and the device-to-device handshake); review them from the description.

| Aspect of the reference design | Requirement it falls short of | Why, at design level |
|---|---|---|
| Integrity check is a CRC-32 over the image | S1 | A CRC detects accidents. Anyone can compute a correct one for any image. |
| Header is \`{version, length, flags}\` and is not covered by any check | S2, S6 | The fields that drive the decision can be edited independently of the image. |
| \`flags\` bit 0 is "force install", used in the factory | S2 | A mode that overrides the version check exists and is reachable from the update file. |
| Version compared with "older than" only, so the same version re-installs | S2 | Non-strict comparison allows re-installation of a known image. |
| † One symmetric "update key" in every device of every deployment authenticates a later variant of the format | S1, S3, S4 | The key that verifies also creates; one opened device can authorise updates everywhere. |
| The loader erases the running application, then receives and checks | F4, S5 | Unverified data replaces the working image; failure leaves nothing bootable. |
| \`length\` from the header sizes the flash write | S6 | A length larger than the application area writes beyond it; arithmetic on it can wrap. |
| The check happens once, at install | S5 | Nothing re-examines the image if flash changes afterwards. |
| † Device-to-device "handshake" compares a deployment ID sent in clear | S4 | Identity is asserted, not proven. |`,
    `## Design notes

**Signature, not MAC, for S1 and S4.** The device stores the public half of the release key. Nothing extractable from a device can sign.

**What is signed.** One header containing a deployment identifier, the version, the image length and the image hash; the signature covers the whole header. The bootloader verifies the signature, then checks the fields, then hashes the image and compares. Since the hash is inside the signed header, the image is covered.

**Slots.** Two application areas, A and B, and a small record saying which is active and what the minimum version is. Receive into the inactive slot; verify; update the record as the final step.

**The minimum version.** A counter that only moves forward. Decide where it lives and when it is raised: raising it before the new image has proven it can boot risks a device that refuses both its images.

**Device-to-device trust (F5, S4).** Each device gets its own key pair at build time and a statement binding its device ID and public key, signed by a deployment key that exists only in the build system. A peer verifies the statement with the deployment public key, then requires a signature over a fresh nonce from the device key. Opening one device yields that device's private key and nothing that speaks for another.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'A generic flash layout and update file for this exercise. Addresses and sizes are yours to choose; this is not any real chip\'s layout.',
      text: `FLASH (generic model)                         UPDATE FILE
┌───────────────────────────┐              ┌────────────────────────────────┐
│ BOOTLOADER  (never updated)│              │ header (signed):               │
│  release public key        │              │   magic, format version        │
│  deployment ID             │              │   deployment ID                │
├───────────────────────────┤              │   image version                │
│ BOOT RECORD (two copies)   │              │   image length                 │
│  active slot, min version  │              │   SHA-256 of image             │
├───────────────────────────┤              ├────────────────────────────────┤
│ SLOT A  (application)      │              │ signature over header (ECDSA)  │
├───────────────────────────┤              ├────────────────────────────────┤
│ SLOT B  (application)      │              │ image bytes                    │
├───────────────────────────┤              └────────────────────────────────┘
│ DEVICE IDENTITY            │
│  device ID, device key pair│   Boot: read record → verify active slot → run it;
│  signed identity statement │         if it fails, verify the other slot; else stay in loader.
└───────────────────────────┘` },
    { t: 'widget', name: 'secure-boot-chain', props: { platform: 'generic' }, title: 'The chain you are designing', caption: 'Use this model while you design: tamper with a stage, swap a key, present an older version, and note at which stage each must be caught.' },
  ],
  steps: [
    { title: 'Requirements, assumptions and the trace',
      md: `Tabulate the requirements. Then write the **trace** of the reference design: a numbered list from "first byte of the update arrives" to "first instruction of the new image executes", with, at each step, what has been checked so far and what has been modified so far. Every step where "modified" runs ahead of "checked" is a finding.` },
    refStep('relay_ref', RELAY_REF, RELAY_REF_OUT, `The reference loader, its packaging tool and a model of flash are 70 lines of C. Use it to check the trace you wrote in step 1: put a \`printf\` after each flash operation if you want to watch "modified" run ahead of "checked".`),
    { title: 'Review the reference design',
      md: `Use the simulations to see three of the reference design's classes concretely: a rollback accepted by an updater, what an update image reveals when inspected, and a header length that passes a wrapping check. Write each as a finding with defence and verification test.`,
      blocks: [
        { t: 'widget', name: 'vuln-device', props: { device: 'rollback-updater' }, title: 'A simulated updater with the reference version logic', caption: 'Intentionally vulnerable simulation. Which requirement, and which negative test would have caught it?' },
        { t: 'widget', name: 'firmware-inspector', props: { image: 'updater' }, title: 'Inspect an update image', caption: 'A synthetic image bundled with the course. List the fields a device would have to believe, and anything present that S4 says no device should hold.' },
        { t: 'widget', name: 'integer-overflow', props: { challenge: 'length-check' }, title: 'A length check that can wrap', caption: 'Relate this to the header length field and S6, then write the check in a form that cannot wrap.' },
      ] },
    { title: 'Design the image format and verification order',
      md: `Specify the header byte by byte, with fixed sizes and byte order. Then write the bootloader's verification order and justify it:

1. Header length and magic (cheap, no trust involved).
2. **Signature over the header.** Nothing in the header is believed before this.
3. Deployment ID equals mine (S3).
4. Version strictly greater than the stored minimum (S2). No flag field exists.
5. Length greater than zero and not greater than the slot size (S6).
6. Hash of the received image equals the header's hash (S1).

Try signing and tampering in the tool below to see which changes a signature detects.`,
      blocks: [{ t: 'widget', name: 'crypto-lab', props: { tab: 'sign' }, title: 'ECDSA sign, verify, tamper', caption: 'Real WebCrypto ECDSA P-256 on data you type. Change one character of the signed text and verify again.' }] },
    { title: 'Implement the acceptance decision',
      md: `The decision function receives the header and the result of the signature verification. Fix the reference logic.`,
      blocks: [
        { t: 'widget', name: 'c-lab', title: 'C lab: the update acceptance decision',
          props: {
            title: 'Update decision',
            prompt: `\`update_decision()\` returns a code for each of eight update headers presented to device \`0x1001\`, whose stored minimum version is 7. (In this exercise the header's first field identifies the target; in your design it is the deployment ID.)

The reference logic honours the "force" flag, compares the version non-strictly, checks the signature late, and never looks at the target or the length.

Required output: \`01233441\`, meaning accepted, bad signature, wrong target, rollback (same version), rollback (old version with the force flag), bad length (too long), bad length (zero), and bad signature for a header in which *every* field is wrong: when the signature does not verify, that is the only thing the device may report, because nothing else in the header can be believed.

Fix \`update_decision()\`. Do not change \`main\`.`,
            starter: UPDATE_START,
            solution: UPDATE_SOL,
            tests: [{ name: 'forged, foreign, old, forced and oversized updates refused; signature checked first', stdout: '01233441\n' }],
            hints: [
              'Which check must come first, so that no later check reads a field nobody has vouched for?',
              'The fifth header sets the force flag. S2 says no flag overrides the version rule: the right amount of code handling that flag is none.',
              '"Not greater than the highest accepted version" includes equal. And bound the length on both sides: zero, and the slot size.',
            ],
            explain: `The order is the design: signature, target, version, length. The force flag is not checked and rejected; it is ignored, because a path that does not exist cannot be reached. On a device, \`sig_ok\` comes from a library verification call whose return value is compared against its one success value. This program was also compiled and run with gcc on a host.`,
          },
          caption: 'Runs in the app\'s C interpreter. The signature verification itself is represented by its boolean result.' },
      ] },
    { title: 'Design the boot record and power-loss behaviour',
      md: `Specify the boot record (active slot, minimum version, its own integrity check) and store two copies so that a write interrupted by power loss leaves one valid copy. Then write the update sequence as numbered steps and, after each step, answer: *if power is lost here, what does the next boot do?* Every answer must be "boots a verified image".

Decide when the minimum version is raised, and defend the decision in the S2 argument. Raising it only after the new image has started and confirmed itself protects against a signed-but-broken release; state what an adversary could do in the window before confirmation, if anything.` },
    { title: 'Design provisioning and the device-to-device handshake',
      md: `Write the secrets step and the per-device build step as lists of inputs and outputs. For every key: who generates it, from what randomness, where the private half is stored, and which devices hold the public half. Check the result against S4 by listing what the opened device contains and what each item allows.

Then specify the F5 handshake: each side sends its identity statement and a fresh nonce; each verifies the other's statement with the deployment public key and requires a signature, made with the device key, over both nonces and both device IDs.` },
    { title: 'Build the host tooling and tests; optional hardware observation',
      md: `Replace the device part of \`relay_ref.c\` with your design (two slots, the two-copy boot record, verification in \`dev_update()\` and again in \`dev_boot()\`) and \`pkg_make()\` with your signed format, keeping the function names so the harness links. Work until every harness line prints PASS under the sanitizer build. Then add the tests the harness lists at its end, and extend T-F4 into a loop that sets \`flash_budget\` to **every** value from 0 up to the number of operations a complete update needs: after each interrupted update a complete image must still run. That loop is the power-loss table of step 6, executed.

If you prefer a separate packaging tool (Python with a maintained cryptography library is suitable), have it write the same files and feed them to the harness. Generate the negative-test files with the tool: flipped bit, wrong key, older version, other deployment, oversized length.

**Optional, on an ESP32 you own:** the vendor's SDK already implements signed application images, rollback protection and two-slot updates. Reading how it does so, and running its update examples *without* enabling secure boot, is a useful comparison with your design. Do not enable Secure Boot or flash encryption on a board you want to reuse freely: both burn eFuses and are permanent. The available schemes depend on the chip and its revision (see the security section).` },
  ],
  walkthrough: `## What the important lines do

**\`if (!sig_ok) return UPD_BAD_SIG;\`** comes first. Until it has passed, the header is bytes of unknown origin. Reading \`h->version\` before this line would let unauthenticated data steer the control flow.

**\`h->device_id != my_id\`** compares a signed field with a constant stored in the bootloader's own region. An image that is authentic but meant for someone else is refused here; that is S3.

**\`h->version <= min_version\`** uses the stored minimum, which lives in the boot record that only the bootloader writes. Equality is refused. Nothing in the header can alter this comparison, and the flags field is never read.

**\`h->length == 0 || h->length > SLOT_SIZE\`** compares the field directly against a constant. There is no addition or multiplication before the comparison, so nothing can wrap.

**On the device**, receiving into the inactive slot means the flash write itself is the only effect of unverified data, and it is confined to an area that is never executed until verified. At boot the same verification runs again over the active slot, so a change made to flash after installation is caught before any of it executes.`,
  testing: [
    `Generate every negative-test file with your own packaging tool. The harness in step 2 automates T-F3, T-F4 (one interruption point), T-F6, T-S1-1, T-S1-4, T-S2-1, T-S2-2, a forced-rollback test, T-S5-1 and T-S6-1/2; note that it does not accept "the device reports version 2" as proof, it also compares the bytes that would execute with the genuine image.

| ID | Requirement | Test | You should see |
|---|---|---|---|
| T-F3 | F3 | Install version n+1; query version | Reports n+1 |
| T-F4 | F4 | Stop the transfer (or cut power) at 10 %, 50 %, 99 % and just before the record update | Device boots the previous version each time |
| T-F6 | F6 | Image of exactly the maximum size | Installs |
| T-S1-1 | S1 | Valid file with one image byte changed | Refused; active image unchanged |
| T-S1-2 | S1 | Valid file with one header byte changed | Refused |
| T-S1-3 | S1 | File signed with a different key | Refused |
| T-S1-4 | S1 | Reference-design file (correct CRC, no signature) | Refused |
| T-S2-1 | S2 | Correctly signed older version | Refused |
| T-S2-2 | S2 | Correctly signed file with the same version as installed | Refused |
| T-S2-3 | S2 | Install n+1, then n+2, then present n+1 | Refused |
| T-S3-1 | S3 | Correctly signed file from another deployment's secrets | Refused |
| T-S4-1 | S4 | Search a device image for the release private key and the deployment private key | Absent |
| T-S4-2 | S4 | F5 handshake using device 1's key with device 2's identity statement | Refused |
| T-S5-1 | S5 | Modify one byte of the active slot directly in a test harness, then boot | Bootloader refuses that slot; falls back or stays in loader |
| T-S6-1 | S6 | Header length = slot size + 1; length = 0; length = 0xFFFFFFFF | Refused before any write |
| T-S6-2 | S6 | Random and truncated update files against the host build under sanitizers | Refused; no sanitizer report |`,
    { t: 'callout', kind: 'sim', md: `Without hardware, T-F4 and T-S5-1 are run against a host model in which flash is an array and "power loss" is stopping the update function at a chosen step. That verifies your sequence logic. It does not verify flash behaviour on a real chip, where a write interrupted part-way can leave a page in an indeterminate state; your two-copy boot record is designed for exactly that case and needs hardware testing to confirm.` },
  ],
  troubleshooting: [
    { symptom: 'A valid update is refused with a signature error', cause: 'Packaging tool and device disagree on the exact bytes signed: field order, padding in a C struct, byte order, or signature encoding.', fix: 'Serialise the header explicitly byte by byte on both sides rather than signing a struct in memory; compare hex dumps; agree on raw versus DER signature encoding.' },
    { symptom: 'After a successful update the device refuses to boot either slot', cause: 'The minimum version was raised before the new image was confirmed, and the new image fails verification or crashes.', fix: 'Raise the minimum version only after the new image is verified and confirmed; keep the old slot valid until then.' },
    { symptom: 'Boot takes noticeably longer after adding verification at every boot', cause: 'Hashing the whole image and verifying a signature on a small core.', fix: 'Measure it. Hardware hash acceleration, if the chip has it, helps; do not remove the check. State the boot-time cost in the design.' },
    { symptom: 'The device image contains the release private key', cause: 'The secrets file is included wholesale into a generated header.', fix: 'Generate per-device headers containing only what that device needs; add the image search as an automated test.' },
  ],
  challenge: `Add **confidentiality** of the image in transit (a requirement S7 that you write) without weakening S4: the image must be unreadable to someone holding the update file, yet opening one device must not expose a key that decrypts updates for all other devices *and* must still allow one update file per release, not one per device. Decide whether both are achievable together, and if not, which requirement you would ask to have clarified. No solution is given.`,
  rubric: [
    { criterion: 'Trace and review of the reference design', points: 20, evidence: 'Step-by-step trace with checked/modified columns; one finding per FAIL line of the reference harness (CRC, force flag, non-strict version, erase-before-verify, unbounded length, install-only check) plus the two † rows; each names the failing test ID.' },
    { criterion: 'Image format and verification order', points: 20, evidence: 'Header table with offset, size and byte order of every field and the exact byte range signed; ordered checks with justification; C lab passed (`01233441`).' },
    { criterion: 'Anti-rollback and power-loss design (S2, F4)', points: 20, evidence: 'Boot record layout; per-step power-loss table; harness PASS for T-S2-1, T-S2-2, the forced-rollback test and T-S2-3; log of the T-F4 loop over every flash_budget value with a complete image running after each.' },
    { criterion: 'Provisioning and device-to-device trust (S3, S4)', points: 20, evidence: 'Key inventory (who generates, where stored, which devices hold which half); handshake message table; PASS for T-S3-1 and T-S4-2; `strings`/hex search of a device image showing no private release or deployment key.' },
    { criterion: 'Verify before use, every boot; bounded parsing (S5, S6)', points: 10, evidence: 'Harness PASS for T-S5-1 and T-S6-1/2 including length 0xFFFFFFFF; run of random and truncated files under -fsanitize=address,undefined ending without a report.' },
    { criterion: 'Security arguments and residual risk', points: 10, evidence: 'Six-part argument per requirement; honest statement about what the first boot stage and the hardware are relied on for.' },
  ],
  quiz: [
    { q: 'Why is a CRC-32 unsuitable for S1?', kind: 'security', choices: [
      { t: 'It is too short: a CRC-64 would give enough bits to be secure.', why: 'Length is not the issue. Consider who is able to compute a valid check value for a modified image.' },
      { t: 'No secret is involved, so anyone can compute a correct CRC.', ok: true, why: 'A CRC protects against accidental corruption. Authenticity needs something only the legitimate producer can create.' },
      { t: 'It is too slow to compute over a 128 KiB image on a small microcontroller.', why: 'CRCs are among the cheapest checks available and are often hardware-accelerated.' },
    ] },
    { q: 'The reference design has a "force install" flag for factory use. What is the correct treatment in the redesign?', kind: 'arch', choices: [
      { t: 'Keep it, but require the flag to be inside the signed header so nobody can add it.', why: 'Then every correctly signed old image with the flag set is a rollback. S2 says nothing overrides the version rule.' },
      { t: 'Keep it, but honour it only after a secret factory command has been sent.', why: 'A secret command is a leftover debug feature with a credential in the image; it remains reachable.' },
      { t: 'Remove it; the factory installs the first image by the normal path.', ok: true, why: 'A path that does not exist cannot be misused, and the first installation needs no exception to the version rule.' },
    ] },
    { q: 'An image is received into the inactive slot, verified, and then the boot record is updated. Power is lost while the record is being written. With two record copies, what should the next boot do?', kind: 'arch', choices: [
      { t: 'Use the copy of the record that passes its check, and verify the slot it names.', ok: true, why: 'One copy is always intact. Whichever it is points at an image that then passes verification: the old one or the new one.' },
      { t: 'Assume the update completed, since the image was already verified, and boot the new slot.', why: 'The record may not have been written. Acting on an assumption instead of on verified state is what the design is meant to avoid.' },
      { t: 'Erase both slots and wait for a new update, since the state is unknown.', why: 'That converts a harmless interruption into a device with no firmware, violating F4.' },
    ] },
    { q: 'After opening one device, an adversary has that device\'s private key and its signed identity statement. Why can they not impersonate device 2?', kind: 'security', choices: [
      { t: 'Because device IDs are secret values that never appear on the link.', why: 'Device IDs are sent in the handshake and are not secret.' },
      { t: 'Because only the deployment key can bind an ID to a key, and no device holds it.', ok: true, why: 'The identity statement binds an ID to a public key; without the deployment key a new binding cannot be made, and without device 2\'s private key its existing binding cannot be used.' },
      { t: 'Because the handshake is encrypted, so the adversary cannot read what device 2 would send.', why: 'Encryption hides content; impersonation is prevented by what must be signed, not by secrecy of the exchange.' },
    ] },
    { q: 'Which check order is correct for a received update header?', kind: 'code', choices: [
      { t: 'Version, length, signature.', why: 'The first two checks read fields that nobody has yet vouched for, so unauthenticated data drives the logic.' },
      { t: 'Signature, then target, version and length.', ok: true, why: 'After the signature verifies, every other field is known to come from the release system and can be evaluated.' },
      { t: 'Length, then copy the image, then signature.', why: 'Copying on the strength of an unverified length is the memory-safety weakness S6 names.' },
    ] },
  ],
};

const fieldbus = {
  id: 'ectf-sc-fieldbus',
  title: 'Scenario 4: Fieldbus, protected communication between nodes',
  kind: 'Scenario',
  minutes: 360,
  summary: 'A controller, two sensor nodes and an actuator on one shared bus, with sensitive readings on the wire and in flash.',
  skills: ['ectf-sc-review-reference', 'ectf-sc-protected-comms', 'ectf-sc-evidence'],
  requires: ['protocols', 'rtos', 'firmware-eng', 'security'],
  objectives: [
    'Review a multi-node bus protocol for spoofing, replay, redirection, reflection and parsing defects.',
    'Design an AEAD-protected frame with a nonce that cannot repeat, including across resets.',
    'Design pairwise keys so that one opened node does not expose the others.',
    'Protect a stored log so that it is confidential, tamper-evident and cannot be silently rolled back.',
  ],
  hardware: [
    'None required: frame handling, key design and tests run in the app and on a PC.',
    'Optional: three ESP32 development boards you own, two pull-up resistors (4.7 kΩ is a common starting value for a short 100 kHz I2C bus at 3.3 V), a breadboard and jumper wires.',
    'Optional: a logic analyser to observe the bus.',
  ],
  software: [
    'This app: the `packet-explorer`, `crypto-lab`, `replay-attack`, `integer-overflow`, `stack-smash` and `i2c-visualizer` tools.',
    'Optional: gcc on a PC with sanitizers; a library providing an AEAD (mbedTLS in ESP-IDF; wolfSSL is the optional example library named in recent eCTF example repositories).',
  ],
  requirements: {
    functional: [
      'F1. One controller and up to three nodes share a bus; the controller initiates every exchange. Node IDs are 1 to 3; the controller is 0.',
      'F2. The controller polls each sensor node once per second; the node returns a reading of up to 64 bytes.',
      'F3. The controller sends commands of up to 64 bytes to the actuator node; the actuator acknowledges.',
      'F4. A complete exchange (request and response) finishes within 100 ms.',
      'F5. The controller stores the 32 most recent readings in flash and can output them on its console after PIN login.',
      'F6. A node can be replaced by building a new node with the same ID for the same deployment, without rebuilding the others.',
      'F7. A frame that is not accepted is dropped silently: no reply, no action, no change of stored state. The controller treats a missing reply after 100 ms as a failed exchange and continues with the next poll.',
    ],
    security: [
      'S1. A device acts only on messages produced by the legitimate peer for this deployment; a modified message is rejected.',
      'S2. An observer of the bus learns nothing about reading or command contents beyond their length and timing.',
      'S3. A message is accepted at most once, only by the device it was addressed to, and only in the direction it was sent.',
      'S4. Readings stored in flash are confidential and tamper-evident, and a stored record cannot be replaced by an older valid record without detection.',
      'S5. Extracting all secrets from one node does not allow reading or forging traffic between the controller and any other node.',
      'S6. No received frame, whatever its contents, causes a read or write outside the receive buffer; malformed frames are dropped in bounded time and leave no state changed.',
    ],
  },
  background: [
    SCENARIO_NOTE,
    `## The system

Four devices share two wires. The adversary can attach to the bus, observe everything, inject frames, and has opened one sensor node and read its flash. They cannot read the controller's flash (record this assumption). A shared bus can always be jammed by anything attached to it, so availability against a bus-level attacker is **not** a requirement here; say so in your residual risks rather than implying otherwise.

The multi-board I2C arrangement resembles the general shape of the 2024 eCTF example system (one application processor as I2C controller, components as peripherals). This scenario is an original exercise on that generic shape and reproduces neither that system nor its requirements.

${METHOD}`,
    `## Interface specification

**Reference frame** (to be replaced): \`src(1) dst(1) len(1) payload(len) crc(1)\`, where \`crc\` is CRC-8 with polynomial 0x07 and initial value 0 over the first \`3 + len\` bytes, and \`len\` is at most 64. A poll request carries the one-byte payload \`R\`; a sensor answers with its reading; the actuator answers a command with the one-byte payload \`A\`.

**Device boundary in the host build.** One frame in, at most one frame out.

| Function | Contract |
|---|---|
| \`node_init(nd, deployment, id)\`, \`ctrl_init(c, deployment)\` | Stand for the secrets step and the per-device build. Different \`deployment\` numbers stand for different runs of the secrets step. |
| \`ctrl_poll(c, node, out)\`, \`ctrl_command(c, node, cmd, len, out)\` | The controller builds a request frame and returns its length. |
| \`node_rx(nd, frame, n, reply)\` | A node received \`n\` bytes. Returns the reply length, or 0 if the frame was dropped (F7). The actuator counts executed commands in \`ram.actions\`. |
| \`ctrl_rx(c, frame, n)\` | The controller received a reply. Returns 1 if accepted (the reading is stored and logged), 0 if dropped. |
| \`ctrl_log_read(c, i, out)\` | Log record \`i\` as the console would print it after login; \`-1\` if the record is empty or fails its integrity check. \`c.flash\` is the log's flash, which the tests may inspect and alter. |

The harness always passes frames in a 300-byte zero-filled buffer, so a device that believes an over-long length field reads defined bytes. The PIN login of F5 is scenario 1's mechanism and is not repeated in this harness. \`fixup()\` in the harness is "everything a party without keys can recompute after editing a frame": the CRC in the reference design, and nothing at all in yours.`,
    `## The insecure reference design

Rows marked † describe parts of the reference system that are not in the step 2 listing; review them from the description.

| Aspect of the reference design | Requirement it falls short of | Why, at design level |
|---|---|---|
| Frames are \`src, dst, len, payload, CRC-8\` in clear | S1, S2 | No secrecy; the CRC involves no key, so any device can produce valid frames. |
| A node acts on any frame whose \`dst\` is its own ID | S1, S3 | The source field is a claim nobody verifies. |
| No counter or nonce | S3 | Every valid frame remains valid indefinitely. |
| Request and response share one layout and no direction marker | S3 | With \`src\` and \`dst\` exchanged (both are unverified claims) the controller's own request is accepted as a node's reply. |
| Receiver copies \`len\` bytes into a 64-byte buffer, before checking the CRC | S6 | The length field is trusted; values above 64 write past the buffer, and the write happens even for a frame that is then dropped. |
| † A later revision "encrypts" payloads with one AES key compiled into every device, fixed IV | S2, S5 | Equal plaintexts give equal ciphertexts; one opened node reads everything; still no integrity. |
| Log records are written to flash in clear, appended in order | S4 | Readable from flash; any record can be altered or the log truncated. |
| † The actuator's handler runs in interrupt context and parses the frame there | S6 (supporting), F4 | Unbounded work on attacker-controlled input at the highest priority. |`,
    `## Design notes

**Keys.** Pairwise: \`k_n = KDF(deployment_secret, "bus" || node_id)\`, computed by the build system. Node \`n\` is built with \`k_n\`; the controller is built with all three (F6: a replacement node with the same ID gets the same \`k_n\`, which raises a question you must answer in step 4). The deployment secret itself is in no image. Derive separate subkeys per direction.

**Frame.** A header in clear (source, destination, counter, length), authenticated as associated data; payload encrypted; a 16-byte tag.

**Nonce.** Built from direction and counter, never transmitted separately, never random. The hard part is the reset: a counter in RAM restarts at zero under the same key. Either persist it (flash wear at one frame per second needs arithmetic), or establish a fresh session key at every start-up using a nonce from each side, and count within the session.

**Storage.** One AEAD record per reading, with the record's sequence number and slot index as associated data, under a storage key distinct from any bus key. A monotonic "latest sequence number" kept separately detects a log that has been rolled back or truncated.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Bus topology and the protected frame. Optional I2C wiring between ESP32 boards you own: choose SDA and SCL pins that are free on your boards (check the pinout; avoid strapping pins).',
      text: `                3.3 V
                 │   │
               [Rp] [Rp]            one pull-up pair for the whole bus
                 │   │
  SDA ───────────┴───┼──────────┬──────────────┬──────────────┐
  SCL ───────────────┴──────────┼──┬───────────┼──┬───────────┼──┐
                                │  │           │  │           │  │
                          ┌─────┴──┴───┐ ┌─────┴──┴───┐ ┌─────┴──┴───┐
   CONTROLLER (id 0) ─────┤ SENSOR  1  │ │ SENSOR  2  │ │ ACTUATOR 3 │
   holds k1, k2, k3       │ holds k1   │ │ holds k2   │ │ holds k3   │
                          └────────────┘ └────────────┘ └────────────┘
  GND common to every board (required)

  FRAME    src(1) dst(1) counter(4) len(1) │ ciphertext(len) │ tag(16)
           └──────── associated data ─────┘  encrypted          authenticates all of it` },
    { t: 'widget', name: 'i2c-visualizer', props: { device: 'eeprom' }, title: 'What an observer of the bus sees', caption: 'A reminder of what is on the wires: every address and data byte is visible to anything attached. This is the adversary\'s view assumed by S2.' },
  ],
  steps: [
    { title: 'Requirements, assumptions and threat model',
      md: `Tabulate the requirements with verification methods. Record the assumptions: bus fully observable and injectable; one sensor node extracted; controller flash not readable; jamming out of scope. List assets per device and the entry points: the bus (every frame type, both directions), the controller console, each device's flash.` },
    refStep('fieldbus_ref', FIELDBUS_REF, FIELDBUS_REF_OUT, `The reference controller and nodes are 60 lines of C. The reading used by the tests is the text \`21.5C;humidity=40\`; two tests simply search for its first bytes on the bus and in the controller's flash.`),
    { title: 'Review the reference design: frames',
      md: `Take one reference frame and ask the four protocol questions (replay, redirect, reflect, re-type), then walk the memory-safety class over the receive path. Use the simulations to examine a frame with a trusted length field and a check value that involves no key.`,
      blocks: [
        { t: 'widget', name: 'packet-explorer', props: { challenge: 'find-length-bug' }, title: 'A frame whose length field is believed', caption: 'Find the inconsistency a receiver must reject, and write the three length checks your parser will perform.' },
        { t: 'widget', name: 'stack-smash', props: { mitigation: 'bounds' }, title: 'The receive buffer with and without a bounds check', caption: 'Simulated stack. Switch the mitigation off to see the reference behaviour, then on; note the boundary tests that verify it.' },
        { t: 'widget', name: 'replay-attack', props: { defence: 'counter' }, title: 'A frame accepted twice', caption: 'Simulated link. Relate the counter defence to S3 and to the nonce construction you are about to design.' },
      ] },
    { title: 'Review the reference design: the "encrypted" revision and storage',
      md: `The later revision of the reference design adds encryption with a fixed IV and no authentication. Use the AEAD tool to see what a repeated nonce reveals and what a missing tag permits. Then review the stored log against S4: what can someone who can write flash do to a clear-text, append-only log?`,
      blocks: [{ t: 'widget', name: 'crypto-lab', props: { tab: 'aead' }, title: 'Nonce reuse and missing authentication', caption: 'Real WebCrypto AES-GCM on data you type. Encrypt two messages under one nonce and compare; then alter a ciphertext and decrypt.' }] },
    { title: 'Design keys, sessions and the frame',
      md: `Write the specification:

- **Key inventory**: for each device, exactly which keys it holds. Check it against S5 by listing what the extracted node holds.
- **Replacement (F6)**: a replacement node with the same ID has the same \`k_n\` as the node it replaces, including a stolen one. Decide what the deployment does about that (for example a per-node generation number in the derivation, at the cost of rebuilding the controller) and write the trade-off down; if you keep F6 as stated, list the consequence as residual risk.
- **Session establishment**: at start-up, and whenever a counter is about to run out, controller and node exchange fresh nonces and derive per-direction session keys from \`k_n\` and both nonces. Say what a node does on receiving a frame for a session it does not know.
- **Frame**: fields, sizes, byte order; associated data; nonce layout.
- **Receive order**: length checks; destination is me; source is a peer I have a session with; tag verifies; counter strictly greater than last accepted for that peer and direction; then update the counter and act.` },
    { title: 'Implement the frame parser and nonce construction',
      md: `This is the code at the trust boundary, for the protected frame of the design notes. Read it, compile it on your PC, and extend its tests. It parses a frame without trusting the length field and builds a nonce in which the two directions can never collide. You should see exactly this output:

\`\`\`
exact      0
counter    42
truncated  -1
trailing   -1
len=200    -1
tiny       -1
nonces differ by direction: 1
\`\`\`

Compare it line by line with the reference \`node_rx()\` from step 2: which of the three length checks does the reference have, and in which order relative to the copy?`,
      code: FRAME_C, lang: 'c', status: 'host-tested' },
    { title: 'Implement the protected exchange',
      md: `Replace the device part of \`fieldbus_ref.c\` with your design, built around \`parse_frame()\` and \`build_nonce()\`, keeping the function names and contracts of the interface specification. Call a library AEAD (on a PC, OpenSSL's EVP interface offers AES-GCM and ChaCha20-Poly1305; link with \`-lcrypto\`). Empty the body of \`fixup()\`, since in your design a party without keys can recompute nothing. Work until every harness line prints PASS under the sanitizer build, then add the tests listed at the end of the harness; for the reset tests, add a \`node_reset()\` and \`ctrl_reset()\` that clear exactly what a power cycle would clear.

On boards you own, the same files sit on top of the I2C driver. Keep the interrupt handler minimal: store bytes into a bounded buffer and wake a task; parse and verify in the task. Measure the time for a full exchange against F4, since AEAD on a small core is not free, and record the measurement method.` },
    { title: 'Design and test protected storage; write the report',
      md: `Specify the log record: sequence number, slot index, AEAD ciphertext of the reading, tag; storage key derived separately; the latest sequence number kept in a location updated last. Write the power-loss table for appending a record. Then run the full test plan and write findings, arguments and residual risks.` },
  ],
  walkthrough: `## What the important lines do

**\`if (n < HDR_LEN + TAG_LEN) return -1;\`** A frame shorter than a header plus a tag cannot be valid. This check runs before \`buf[6]\` is read, so the read of the length byte is itself in bounds.

**\`if (len > MAX_PAYLOAD) return -1;\`** bounds the field against the largest payload the specification allows, before it is used in any arithmetic.

**\`if (n != (size_t)HDR_LEN + len + TAG_LEN) return -1;\`** The number of bytes actually received must equal what the header implies. Shorter means a truncated frame; longer means trailing bytes nobody accounted for. The sum cannot wrap: \`len\` is at most 64 and the arithmetic is done in \`size_t\`.

**The counter is assembled byte by byte** with shifts. No pointer is cast to \`uint32_t *\`, so there is no alignment fault on cores that require aligned access and no dependence on the host's byte order.

**\`f->payload\` and \`f->tag\` point into the receive buffer.** Nothing is copied, so there is no second buffer whose size could be wrong. The parser returns these pointers only after all three length checks have passed.

**\`build_nonce\`** places source and destination in the nonce. A frame from controller to node 1 and a frame from node 1 to controller with the same counter value produce different nonces, so the two directions never collide even if they share a key. The program's last output line checks this.

**What the parser does not do** is decide authenticity. It establishes only that the bytes have the shape of a frame. The fields it returns are still claims until the AEAD tag verifies.`,
  testing: [
    `The harness in step 2 automates T-F2, T-F3, T-F5, T-S1-1, T-S1-2, T-S2-1 (two forms), T-S3-1, T-S3-2, T-S3-3, T-S4-1, T-S4-2 and T-S6-1 on single exchanges; the table is the full plan.

| ID | Requirement | Test | You should see |
|---|---|---|---|
| T-F2 | F2 | Poll both sensors for 60 s | 60 readings each, correct contents |
| T-F4 | F4 | Time 100 exchanges with maximum-length payloads | Each under 100 ms (hardware only; state how you measured) |
| T-F6 | F6 | Replace node 2 with a newly built node 2 | Works without rebuilding controller or other nodes |
| T-S1-1 | S1 | Flip one bit in header, in ciphertext, in tag (three tests) | Each dropped; no action taken |
| T-S1-2 | S1 | Frame built with another deployment's keys | Dropped |
| T-S2-1 | S2 | Send the same reading twice; compare ciphertexts | Different |
| T-S2-2 | S2 | Reset a node, send the same reading again; compare with the pre-reset ciphertext and nonce | Different (new session) |
| T-S3-1 | S3 | Deliver a valid frame twice | Second dropped |
| T-S3-2 | S3 | Change \`dst\` of a valid frame for node 1 to node 2 | Dropped by node 2 |
| T-S3-3 | S3 | Return a controller request to the controller as if it were a response | Dropped |
| T-S3-4 | S3 | Deliver frames out of order (counter 5, then 4) | 4 dropped |
| T-S4-1 | S4 | Search a flash dump of the test controller for a known reading | Absent |
| T-S4-2 | S4 | Alter one byte of a stored record; read the log | That record reported invalid |
| T-S4-3 | S4 | Replace the newest record with a copy of an older one; move a record to another slot | Detected |
| T-S5-1 | S5 | Using only node 1's key material, attempt to open or create node 2 traffic in the host harness | Fails |
| T-S5-2 | S5 | Compare key material in two node images | Nothing in common |
| T-S6-1 | S6 | Frames with \`len\` = 64, 65, 255; total length short by one; long by one | 64 accepted if authentic; others dropped |
| T-S6-2 | S6 | Host harness under sanitizers with one million random and mutated frames | No sanitizer report; counters unchanged by dropped frames |`,
    { t: 'callout', kind: 'sim', md: `The parser's listed output (exact frame accepted; truncated, trailing, over-long and tiny inputs rejected; nonces differ by direction) was produced by compiling and running the code with gcc on a host. The timing requirement F4 and anything about bus electrical behaviour can only be checked on hardware.` },
  ],
  troubleshooting: [
    { symptom: 'Nodes stop accepting frames after one of them resets', cause: 'The reset device restarted its counter while the peer kept the old one; or it restarted under the same key, which the peer correctly refuses.', fix: 'Trigger session establishment on start-up and when a peer reports an unknown session; never restart a counter under an existing key.' },
    { symptom: 'Every frame fails tag verification', cause: 'Associated data or nonce assembled differently on the two sides (byte order of the counter, field order).', fix: 'Dump associated data, nonce and key identifier as hex on both ends in a debug build and compare.' },
    { symptom: 'Exchanges exceed 100 ms', cause: 'Software AEAD on a small core, or parsing and cryptography done inside the interrupt handler blocking other work.', fix: 'Measure each stage; move work to a task; use the hardware AES engine through the vendor SDK if the chip has one.' },
    { symptom: 'I2C bus reads all ones or hangs', cause: 'Missing pull-up resistors, no common ground, or two devices configured as controller.', fix: 'Fit one pull-up pair to 3.3 V, join grounds, and confirm exactly one controller; check with a logic analyser.' },
  ],
  challenge: `Remove the assumption that the controller's flash cannot be read. The controller holds every node key, so today its extraction exposes the whole bus. Propose a redesign that limits what extraction of the controller yields about *past* traffic (the term to research is forward secrecy), estimate its cost in time per session on a small microcontroller, and state which requirement you would add to the specification to demand it. No solution is given.`,
  rubric: [
    { criterion: 'Review of the reference design', points: 20, evidence: 'One finding per FAIL line of the reference harness (unkeyed check, no deployment binding, clear payload, replay, re-addressing, reflection, trusted length, clear and unprotected log) plus the two † rows; each names the failing test ID.' },
    { criterion: 'Key and session design (S5, nonce uniqueness)', points: 20, evidence: 'Key inventory per device; session establishment specification; written argument that no (key, nonce) pair can repeat, including across resets.' },
    { criterion: 'Frame protection (S1, S2, S3)', points: 20, evidence: 'Frame table with every field, size and byte order, the associated-data bytes and the nonce layout; harness PASS for all T-S1, T-S2 and T-S3 lines with fixup() empty.' },
    { criterion: 'Boundary code (S6)', points: 15, evidence: 'Harness PASS for T-S6-1 at len 64, 65, 66 and 255; log of one million random and mutated frames under -fsanitize=address,undefined with no report and unchanged counters.' },
    { criterion: 'Protected storage (S4)', points: 15, evidence: 'Record layout with its associated data; power-loss table for an append; harness PASS for T-S4-1, T-S4-2 and your added T-S4-3 (older record substituted, record moved).' },
    { criterion: 'Security arguments and residual risk', points: 10, evidence: 'Argument per requirement; jamming, controller extraction and the F6 replacement trade-off stated plainly.' },
  ],
  quiz: [
    { q: 'Why are source and destination placed in the associated data rather than left unauthenticated?', kind: 'security', choices: [
      { t: 'To hide from an observer of the bus which nodes are communicating.', why: 'Associated data is sent in clear; it is authenticated, not hidden.' },
      { t: 'So a valid frame cannot be re-addressed or attributed to another sender.', ok: true, why: 'Changing either field invalidates the tag, which ties the frame to one sender, one receiver and one direction.' },
      { t: 'Because an AEAD refuses to encrypt unless some associated data is supplied.', why: 'Associated data is optional in an AEAD. It is used here for a specific protocol property.' },
    ] },
    { q: 'The nonce is built from (src, dst, counter) and the counter is held in RAM. Which additional mechanism makes nonce reuse impossible across a reset?', kind: 'arch', choices: [
      { t: 'A longer authentication tag, so that a repeated nonce cannot be exploited.', why: 'Tag length affects forgery probability, not whether a nonce repeats under a key.' },
      { t: 'A fresh session key at every start-up, from nonces of both sides.', ok: true, why: 'The counter may restart, but the key it restarts under has never been used before, so no (key, nonce) pair repeats.' },
      { t: 'Starting the counter at a random 32-bit value after every reset of the node.', why: 'A random 32-bit start can collide with a previously used range, and nothing detects it when it does.' },
    ] },
    { q: 'In `parse_frame`, why is `n != HDR_LEN + len + TAG_LEN` an equality test and not `n >= …`?', kind: 'code', choices: [
      { t: 'An equality comparison is faster to evaluate on a small core than an ordering.', why: 'The two comparisons cost the same. The difference is in what inputs each accepts.' },
      { t: 'Trailing bytes would be received but never authenticated.', ok: true, why: 'Accepting trailing bytes leaves data in the buffer that some later code might interpret. A frame has exactly one legal size for its declared length.' },
      { t: 'The I2C bus cannot deliver more bytes than the frame header announces.', why: 'A device on the bus can send any number of bytes; the receiver alone decides what it accepts.' },
    ] },
    { q: 'What does using the slot index and sequence number as associated data achieve for stored records?', kind: 'security', choices: [
      { t: 'It compresses the log, because index and sequence number need not be stored.', why: 'Associated data is not stored inside the ciphertext and has no effect on size.' },
      { t: 'A valid record that is moved or substituted fails verification.', ok: true, why: 'The tag is computed over the location and order as well as the content, so records cannot be rearranged undetected.' },
      { t: 'It hides from a reader of the flash how many records the log holds.', why: 'The number of records remains visible from the storage layout.' },
    ] },
    { q: 'Which statement belongs in the residual-risk section of this design?', kind: 'concept', choices: [
      { t: 'Anything on the bus can block it by holding the lines; this is not addressed.', ok: true, why: 'It is a real limitation of any shared bus and outside the stated requirements, so it is recorded rather than ignored.' },
      { t: 'AES may be broken at some point in the future by an attack that is not yet known.', why: 'This is true of any design and gives a reviewer no information specific to this system.' },
      { t: 'The tests might contain bugs that make a broken build look correct.', why: 'Test quality is addressed by reviewing the tests, not by listing it as accepted design risk.' },
    ] },
  ],
};

const keykeeper = {
  id: 'ectf-sc-keykeeper',
  title: 'Scenario 5: Keykeeper, a small key-handling device',
  kind: 'Scenario',
  minutes: 420,
  summary: 'A generic hardware-security-module-style device: keys go in or are generated, operations come out, and key material never does.',
  skills: ['ectf-sc-review-reference', 'ectf-sc-key-handling', 'ectf-sc-evidence'],
  requires: ['mcu-architecture', 'firmware-eng', 'security'],
  objectives: [
    'Review a command interface for every path by which key material or information about it can leave the device.',
    'Design and enforce a per-key usage policy with default deny.',
    'Make nonce and random-number generation the device\'s responsibility, with fail-closed behaviour.',
    'Design wrapped export to an authenticated peer device.',
  ],
  hardware: [
    'None required: the policy engine, command parser and tests run in the app and on a PC.',
    'Optional: one or two ESP32 development boards you own (two for the device-to-device export).',
  ],
  software: [
    'This app: the `threat-model`, `crypto-lab`, `vuln-device`, `timing-attack`, `integer-overflow` and C lab tools.',
    'Optional: gcc on a PC with sanitizers; a maintained cryptographic library.',
  ],
  requirements: {
    functional: [
      'F1. The device has 4 key slots. A slot holds a 256-bit symmetric key or a P-256 signing key, plus attributes fixed when the key is created.',
      'F2. Commands on the control interface: `login <pin>`, `logout`, `generate <slot> <type> <attrs>`, `list`, `encrypt <slot> <data>`, `decrypt <slot> <blob>`, `sign <slot> <data>`, `export <slot> <wrap-slot>`, `import <slot> <blob>`, `destroy <slot>`.',
      'F3. `list` returns, per slot, whether it is in use, the key type, the attributes, and for signing keys the public key.',
      'F4. Data for `encrypt`, `decrypt` and `sign` is up to 256 bytes per command.',
      'F5. A key exported from one Keykeeper can be imported by another Keykeeper of the same deployment over the transfer interface.',
      'F6. Every command completes within 2 seconds.',
      'F7. Every command line receives exactly one response line: `ok`, optionally followed by one result field, or `err`.',
    ],
    security: [
      'S1. No command, response, error or interface returns secret key material in clear.',
      'S2. Every command except `login` and `list` requires an authenticated session; PIN guesses are limited to 3 between successes, across resets and power loss.',
      'S3. A key is usable only for the operations its attributes allow; attributes cannot be changed after creation.',
      'S4. A key leaves the device only if it was created exportable, only encrypted under a wrapping-capable key, and only to an authenticated Keykeeper of the same deployment.',
      'S5. The device generates every nonce and key itself from its hardware random number generator; if that generator fails, the operation is refused. No (key, nonce) pair is ever used twice.',
      'S6. Responses to failed operations, in content and timing, do not let a caller distinguish why a cryptographic check failed or learn anything about a key.',
      'S7. No received command, whatever its contents, causes access outside its buffers or the slot table; no diagnostic function is reachable.',
    ],
  },
  background: [
    SCENARIO_NOTE,
    { t: 'callout', kind: 'note', title: 'Relationship to the 2026 eCTF theme',
      md: `MITRE's 2026 example design is described in its repository as a Hardware Security Module: a device that stores **files** in slots, with group-based read, write and receive permissions, a PIN, and two UARTs. Keykeeper is a different, generic device written for this course: it stores **keys** and performs operations with them. It shares only the general idea of a small device that guards something behind a PIN and talks to a peer. It is not that system, does not reproduce its requirements, and solving it is not a solution to any competition task. The 2026 security requirement texts could not be verified for this course and are not referred to.` },
    `## The system

A key-handling device exists so that keys can be *used* without being *seen*. The host asks for an operation; the device performs it inside and returns only the result. The adversary controls the host completely, so they can send any command sequence, knows the PIN in some tests and not in others (the threat model must cover both: a legitimate but curious user is an adversary for S1, S3 and S4), observes the transfer link, and owns a Keykeeper from another deployment.

${METHOD}`,
    `## Interface specification

The control interface is line-based ASCII, one command per line, fields separated by single spaces. Binary values are lowercase hex, two digits per byte.

| Command | Success response | Notes |
|---|---|---|
| \`login <pin>\` | \`ok\` | PIN is 6 decimal digits. |
| \`logout\` | \`ok\` | Ends the session. |
| \`generate <slot> <type> <attrs>\` | \`ok\` | \`<slot>\` is 0 to 3 and must be empty. \`<type>\` is \`aes\` (256-bit symmetric) or \`p256\`. \`<attrs>\` is a string of letters: \`e\` encrypt, \`d\` decrypt, \`s\` sign, \`w\` wrap, \`x\` exportable. |
| \`list\` | \`ok\` and four fields | One field per slot: \`<n>:-\` if empty, otherwise \`<n>:<type>:<attrs>\`, with \`:<public key hex>\` added for a signing key. |
| \`encrypt <slot> <data>\` | \`ok <blob>\` | 1 to 256 bytes of data. The blob contains the nonce the device chose, the ciphertext and the tag. |
| \`decrypt <slot> <blob>\` | \`ok <data>\` | |
| \`sign <slot> <data>\` | \`ok <signature>\` | 1 to 256 bytes of data. |
| \`export <slot> <wrap-slot>\` | \`ok <blob>\` | The key of \`<slot>\`, wrapped under the key of \`<wrap-slot>\`. |
| \`import <slot> <blob>\` | \`ok\` | \`<slot>\` must be empty. |
| \`destroy <slot>\` | \`ok\` | Erases the key and its attributes. |

**Every failure** (unknown command, wrong number of fields, bad hex, bad slot, no session, policy refusal, failed cryptographic check, random generator failure) is answered with the three characters \`err\` and nothing more, and changes no state.

In the host build, \`kk_line(in, out, cap)\` takes one command line and writes the response; \`kk_reset()\` is a reset or power cycle; \`kk_factory()\` is a freshly provisioned device (PIN \`271828\` in the reference build); \`kk_test_key(slot)\` gives the tests the key bytes of a slot so that they can search the device's output for them.

**Scope of the listing.** The step 2 reference design covers the symmetric commands (\`login\`, \`logout\`, \`generate … aes\`, \`list\`, \`encrypt\`, \`decrypt\`, \`export\`, \`destroy\`). So that it needs no library, its "cipher" is a labelled stand-in with none of the properties of encryption; that is one more finding, and your design replaces it with a library AEAD. \`sign\`, \`import\` and the transfer interface are specified here and left for you to build.`,
    `## The insecure reference design

Rows marked † describe parts of the reference system that are not in the step 2 listing; review them from the description.

| Aspect of the reference design | Requirement it falls short of | Why, at design level |
|---|---|---|
| \`export <slot>\` returns the raw key "for backup" | S1, S4 | The primary asset leaves in clear by design. |
| A second, undocumented export (\`ftest\`) exists "for factory test" and needs no login | S1, S2, S7 | An unauthenticated path to key material outside the specification. |
| Slot attributes are stored but only \`generate\` reads them | S3 | Policy is recorded and never enforced. |
| \`encrypt\` uses an IV supplied by the host as an extra field, or a constant if there is none | S5 | The party the device is protecting against controls nonce uniqueness. |
| Keys are generated with the C library pseudo-random generator seeded from uptime | S5 | Key material is predictable from a small, guessable seed. |
| \`decrypt\` returns "bad format" or "bad mac" as different errors, and other commands name their failure too | S6 | Distinguishable failures give a caller a way to learn about plaintext without the key. |
| The slot number is parsed as a signed integer and only checked against the upper bound | S7, S1 | A negative index addresses memory before the slot table. |
| The session flag is set at login and never cleared; the failed-PIN count is in RAM | S2 | Sessions outlive their user; resets restore guesses. |
| † Keys are copied to a stack buffer for each operation and left there | S1 (supporting) | Key bytes persist in RAM where another defect can expose them. |
| † Peer devices are "recognised" by a constant handshake string | S4 | Any device that sends the string is accepted as a Keykeeper. |`,
    `## Design notes

**Policy is data, enforcement is one function.** Every operation calls a single \`authorise(op, slot, …)\` before any key byte is touched. Its default result is refusal.

**No plaintext-export code exists.** S1 is easiest to argue when the firmware contains no function that writes key bytes to an output buffer. Wrapped export encrypts the key inside the device under a wrapping key, with the key's attributes as associated data so that an imported key keeps its policy.

**Usage separation.** A key that may both decrypt data and wrap keys can be used to unwrap an exported key by calling \`decrypt\` on the blob. That is why "wrap" is its own attribute and a wrapping key is not allowed to decrypt general data.

**Hardware.** The device headers of both recent eCTF microcontrollers list an AES engine and a true random number generator, and the MSPM0L2228's also lists a key-store controller (see the platform lessons). What protection those blocks provide for a key at rest is a datasheet question this course could not answer; do not claim a property for them in your argument without reading the manufacturer's documentation. On a general-purpose board, be honest in S1's assumptions about flash read-out.`,
  ],
  diagram: [
    { t: 'ascii', caption: 'Keykeeper architecture. The policy check sits between the parser and the only code that can reach key bytes.',
      text: `  HOST (untrusted, may know the PIN)                    KEYKEEPER
 ┌───────────────────────────┐  control   ╔══════════════════════════════════════════════╗
 │ login / generate / list   │   UART     ║ bounded parser ─▶ session check ─▶ authorise ║
 │ encrypt / decrypt / sign  │───────────▶║                                      │ deny  ║
 │ export / import / destroy │◀───────────║   uniform error ◀────────────────────┤       ║
 └───────────────────────────┘            ║                                      ▼ allow ║
                                          ║  ┌────────────── crypto core ─────────────┐  ║
                                          ║  │ slot table: key, type, attrs (fixed)   │  ║
        PEER KEYKEEPER                    ║  │ TRNG ─▶ nonces, new keys               │  ║
 ┌───────────────────────────┐ transfer   ║  │ only ciphertext, tags, signatures,     │  ║
 │ authenticated handshake,  │   UART     ║  │ public keys and wrapped blobs leave    │  ║
 │ then wrapped key blob     │◀──────────▶║  └────────────────────────────────────────┘  ║
 └───────────────────────────┘            ║  FLASH: wrapped slots, PIN verifier, counter ║
                                          ╚══════════════════════════════════════════════╝` },
    { t: 'ascii', caption: 'Optional wiring for device-to-device export between two ESP32 boards you own (3.3 V logic). Pick free UART pins from your board\'s pinout.',
      text: `Keykeeper A                 Keykeeper B
  transfer TX ────────────▶ transfer RX
  transfer RX ◀──────────── transfer TX
  GND ───────────────────── GND
  control interface of each: its own USB serial port to the PC` },
  ],
  steps: [
    { title: 'Requirements, assumptions and threat model',
      md: `Tabulate the requirements. Then build the threat model. Two adversaries need separate rows: an outsider without the PIN, and a **logged-in user** who should be able to use keys but never obtain them. Most of the interesting requirements here (S1, S3, S4, S5) are about the second.`,
      blocks: [{ t: 'widget', name: 'threat-model', props: { template: 'hsm' }, title: 'Threat model worksheet', caption: 'A generic key-handling template. List every command as an entry point and, for each, what it returns on success and on each failure. Export to your notebook.' }] },
    refStep('keykeeper_ref', KEYKEEPER_REF, KEYKEEPER_REF_OUT, `The reference device is 90 lines of C. Its storage is modelled as one array in which the device's own record (starting with the PIN) sits directly before key slot 0; keep that in mind when you read how the slot number is checked.`),
    { title: 'Review the reference design: what leaves the device',
      md: `For S1 the review question is exhaustive: for **every** command and **every** error path, what bytes are returned, and can any of them depend on secret key material other than as the intended cryptographic result? Add timing as an output. The simulations show three classes from the reference design; write a finding for each.`,
      blocks: [
        { t: 'widget', name: 'vuln-device', props: { device: 'format-leak' }, title: 'An error path that returns memory', caption: 'Intentionally vulnerable simulation. Class, requirement, defence, and the test that would catch it.' },
        { t: 'widget', name: 'vuln-device', props: { device: 'weak-prng' }, title: 'Predictable "random" values', caption: 'Simulated device. Relate it to key generation and nonces under S5.' },
        { t: 'widget', name: 'timing-attack', props: { defence: 'constant-time' }, title: 'Timing as an output', caption: 'Compare with the defence off and on. Which Keykeeper operations compare secret-dependent values, and so need this property?' },
      ] },
    { title: 'Review the reference design: nonces under host control',
      md: `The reference \`encrypt\` takes its IV from the host. Use the AEAD tool to see concretely what a caller gains by choosing the same nonce twice. Then write the finding: the class is a cryptographic implementation flaw, and the defence is structural (the device owns the nonce), not a check on the host's value.`,
      blocks: [{ t: 'widget', name: 'crypto-lab', props: { tab: 'aead' }, title: 'Why the device, not the host, chooses the nonce', caption: 'Real WebCrypto AES-GCM on data you type. Reuse a nonce and compare the two ciphertexts.' }] },
    { title: 'Design the policy and implement its enforcement',
      md: `Define the attributes (encrypt, decrypt, sign, wrap, exportable), which combinations \`generate\` accepts (for example: wrap excludes decrypt), and the table of which operation needs which attribute. Then make the reference \`authorise()\` enforce it.`,
      blocks: [
        { t: 'widget', name: 'c-lab', title: 'C lab: enforce the key usage policy',
          props: {
            title: 'Key policy',
            prompt: `\`authorise()\` is called before every operation. The slot table has a data key (0), a signing key (1), a wrapping key (2) and an exportable data key (3).

The reference version allows any operation to any logged-in caller, permits plaintext export to anyone, and checks only the upper bound of the slot index.

Make it enforce the policy. The test bench makes twelve requests; the required output is \`023303331111\`:

1. encrypt with the data key → 0 allowed
2. the same without a session → 2 not authenticated
3. sign with the data key → 3 denied
4. decrypt with the wrapping key → 3 denied
5. wrapped export of slot 3 under slot 2 → 0 allowed
6. wrapped export of the non-exportable signing key → 3 denied
7. wrapped export under slot 0, which is not a wrapping key → 3 denied
8. plaintext export → 3 denied, always
9. slot 7 → 1 no such slot
10. slot -1 → 1 no such slot
11. wrapped export under slot 9 → 1 no such slot
12. wrapped export under slot -1 → 1 no such slot

Do not change \`main\` or the slot table.`,
            starter: KEYPOL_START,
            solution: KEYPOL_SOL,
            tests: [{ name: 'usage policy, export rules and slot bounds enforced', stdout: '023303331111\n' }],
            hints: [
              'Start with the index: `slot` is a signed `int`. Which values does `slot >= SLOTS` fail to catch?',
              'Each operation needs one specific attribute bit. A `switch` on the operation with `default: return R_DENIED;` gives you default deny.',
              'Wrapped export has three conditions: the key is exportable, the wrap slot is valid, and the wrap slot has the wrap attribute. Plaintext export has none that can be satisfied.',
            ],
            explain: `The function touches no key bytes; it decides. Its \`default\` branch refuses, so an operation code added later is denied until someone writes its rule. Plaintext export is not a special case that gets rejected: it simply has no branch. In the real device, also delete the code that could perform it. This program was also compiled and run with gcc on a host.`,
          },
          caption: 'Runs in the app\'s C interpreter. Only the decision logic is modelled; no cryptography is performed.' },
      ] },
    { title: 'Design sessions, nonces, errors and key lifetime in RAM',
      md: `Specify each of these:

- **Session**: PIN verification with the persistent charge-first counter from scenario 1; the session ends on \`logout\`, on reset and after an idle timeout.
- **Nonces**: per-key counters stored with the slot, or random nonces with a documented limit on operations per key; in both cases generated inside the device. \`encrypt\` returns the nonce it used.
- **Random numbers**: the hardware generator through the vendor SDK, with its error status checked on every call; refusal if it reports failure.
- **Errors**: one error code for every failure of \`decrypt\`, \`import\` and the handshake.
- **Key bytes in RAM**: loaded into one buffer for the operation and overwritten on every exit path. A plain \`memset\` before return can be removed by an optimising compiler as a dead store; use the library's secure-wipe function or a volatile write loop, and confirm in the disassembly.
- **Storage**: slots wrapped under a storage key; state where that key comes from and what S1 assumes about flash read-out.` },
    { title: 'Design wrapped export and import between two devices',
      md: `Reuse scenario 3's device-to-device trust: each Keykeeper has a device key pair and an identity statement signed by a deployment key held only by the build system. The transfer handshake authenticates both sides over fresh nonces and derives a transfer key. The exported blob is the AEAD encryption of the key under the wrapping key, with type and attributes as associated data, then protected again by the transfer key.

Decide and document: how two devices come to share a wrapping key; whether an imported key keeps its exportable attribute; and what stops an exported blob being imported twice or into a different slot type.` },
    { title: 'Implement, test and report',
      md: `Replace the device part of \`keykeeper_ref.c\` with your design, keeping \`kk_line\`, \`kk_reset\`, \`kk_factory\` and \`kk_test_key\`: a bounded parser with one fixed format per command, the session logic, the \`authorise()\` function from the C lab, and a library for all cryptography and for random numbers (on a PC, OpenSSL's EVP interface and \`RAND_bytes()\`, linked with \`-lcrypto\`; check every return value). Convert slot numbers with \`strtol\`, check the end pointer and the range, and only then narrow to \`int\`.

Work until every harness line prints PASS under the sanitizer build, then add the tests listed at the end of the harness. Finally write the findings for the reference design, the argument for each of S1–S7 and the residual risks.` },
  ],
  walkthrough: `## What the important lines do

**\`if (slot < 0 || slot >= SLOTS || !slots[slot].used) return R_NO_SLOT;\`** The lower bound matters because \`slot\` is signed. In C, \`slots[-1]\` is address arithmetic that lands before the table, on whatever the linker placed there. The checks are evaluated left to right and stop at the first true one, so \`slots[slot]\` is only read once the index is known to be in range.

**\`if (!authed) return R_NOT_AUTH;\`** comes after the existence check here so that \`list\`-style information (which is public by F3) is consistent, and before any attribute is examined.

**\`uint8_t a = slots[slot].attrs;\`** reads the attributes fixed at creation. No command writes this field after \`generate\` or \`import\`, which is what "cannot be changed" means in code: search the source for every assignment to it.

**The \`switch\`** maps each operation to the one attribute bit it needs. \`OP_EXPORT_WRAPPED\` additionally validates the wrap slot with the same bounds discipline, refuses a key wrapping itself, and requires the wrap attribute on the wrapping key.

**\`default: return R_DENIED;\`** is default deny. \`OP_EXPORT_PLAIN\` falls here. So would any new operation code, and so would a corrupted one.

**What surrounds this function on a device.** The caller acts only on \`R_OK\`, compared explicitly. Any other value, including one this function was never written to return, is a refusal.`,
  testing: [
    `Run every policy test twice: without a session, and with a valid session. The second run is the one that tests S1, S3 and S4. The harness in step 2 automates one or more checks for each of T-F1, T-F3, T-S1-1, T-S2-1, T-S2-2, T-S3-1, T-S4-1, T-S4-3, T-S5-1, T-S5-3, T-S6-1, T-S7-1 and T-S7-2, plus a check that two fresh devices generate different keys. One line of the reference output is a warning about test design: T-S4-3 prints PASS on the reference only because its stand-in check value happens to reject the input, not because any policy exists. A PASS on the insecure design means the test cannot yet tell the two apart; note it, and confirm on your own design by temporarily disabling the wrap/decrypt separation and seeing the test fail.

| ID | Requirement | Test | You should see |
|---|---|---|---|
| T-F1 | F1–F4 | Generate a data key; encrypt then decrypt 1, 255 and 256 bytes; generate a signing key; sign and verify with the listed public key on the host | Round trips succeed |
| T-F5 | F5 | Export an exportable key from A, import into B, encrypt on A and decrypt on B | Plaintext matches |
| T-S1-1 | S1 | Generate a key with a test hook that records it; capture all output of every command and every error path; search for the key bytes | Never present |
| T-S1-2 | S1 | Image string and symbol search for any plaintext-export or diagnostic handler | Absent |
| T-S2-1 | S2 | Each command without login | Refused, except login and list |
| T-S2-2 | S2 | Three wrong PINs, reset, correct PIN | Refused |
| T-S2-3 | S2 | Login, reset, then a key command | Refused: session did not survive |
| T-S3-1 | S3 | For every (operation, slot) pair not permitted by attributes, with a valid session | Refused; C lab output \`023303331111\` |
| T-S3-2 | S3 | Any command sequence attempting to alter attributes of an existing slot | No such path; attributes unchanged in list |
| T-S4-1 | S4 | Export a non-exportable key; export under a non-wrapping key; export to a slot wrapping itself | Refused |
| T-S4-2 | S4 | Transfer handshake with a Keykeeper built from another deployment's secrets | Refused; no blob sent |
| T-S4-3 | S4 | Decrypt command given an exported blob and the wrapping slot | Refused (wrapping keys cannot decrypt data) |
| T-S4-4 | S4 | Import the same blob twice; import a blob with one bit flipped | Second refused (if your design requires it); flipped refused |
| T-S5-1 | S5 | Encrypt the same plaintext twice; again after a reset | Nonces and ciphertexts differ every time |
| T-S5-2 | S5 | Random generator forced to fail (test hook) during generate and encrypt | Refused; no key created |
| T-S5-3 | S5 | Supply a nonce field in the encrypt command | Rejected as malformed: the format has no such field |
| T-S6-1 | S6 | Decrypt with: wrong tag, truncated blob, wrong slot type, altered nonce | Identical error bytes |
| T-S6-2 | S6 | Time the failures of T-S6-1 over many runs | No distinguishable difference |
| T-S7-1 | S7 | Slot values -1, 4, 255, 2147483648, non-numeric | Uniform error; no state change |
| T-S7-2 | S7 | Data lengths 256, 257, 65535; random command bytes under sanitizers | Bounded; refused beyond 256; no sanitizer report |`,
    { t: 'callout', kind: 'sim', md: `T-S6-2 on a host measures your host build. Timing on a microcontroller depends on the compiled code and the hardware crypto path, so repeat the measurement on the board if you build one, and record how you measured.` },
  ],
  troubleshooting: [
    { symptom: 'Key bytes are found in a RAM dump of the test build after an operation', cause: 'The wipe was optimised away, or an intermediate copy (a library context, a second buffer) was missed.', fix: 'Use the library\'s secure-wipe function, free or clear the library context, and inspect the disassembly of the exit path.' },
    { symptom: 'An imported key can do more than the original', cause: 'Attributes travel beside the wrapped key instead of inside the authenticated data.', fix: 'Put type and attributes in the associated data of the wrap, and set the slot\'s attributes only from the verified blob.' },
    { symptom: 'Decryption fails after a reset although the key is intact', cause: 'A per-key nonce counter restarted and the design also uses it as a check, or the stored counter was not committed.', fix: 'Commit the nonce counter before releasing ciphertext; the decrypt side must take the nonce from the blob, not from its own counter.' },
    { symptom: 'The test for a negative slot index passes in the simulator but the parser crashes on the host', cause: 'The text-to-integer conversion accepts values outside the range of the variable it is stored in.', fix: 'Parse into a wider type, range-check, then narrow; treat any non-digit as a malformed command.' },
  ],
  challenge: `Add a requirement of your own: **S8. A user who knows the PIN must not be able to use the device as a general decryption service for data they did not encrypt with it.** Decide whether this is achievable with the command set in F2, what it would mean precisely, and which command semantics or attributes would have to change. Write the requirement in testable form, its negative tests and its security argument, or a reasoned explanation of why it conflicts with a functional requirement. No solution is given.`,
  rubric: [
    { criterion: 'Review of the reference design', points: 20, evidence: 'Per-command table of everything returned on success and failure; one finding per FAIL line of the reference harness (plaintext export, unauthenticated `ftest`, unenforced attributes, host-chosen and constant IV, predictable keys, distinguishable errors, signed index, session lifetime, RAM attempt counter) plus the stand-in cipher and the two † rows.' },
    { criterion: 'Policy design and enforcement (S3, S4)', points: 20, evidence: 'Attribute and operation table; C lab passed (`023303331111`); harness PASS for T-S3-1, T-S4-1 and T-S4-3 with a valid session, and T-S4-3 shown to FAIL when the wrap/decrypt separation is disabled.' },
    { criterion: 'No plaintext key exposure (S1, S7)', points: 20, evidence: 'Harness PASS for T-S1-1, T-S7-1 and T-S7-2; `strings` of the device object file with no export or diagnostic handler name; disassembly excerpt showing the key wipe present on the exit path.' },
    { criterion: 'Device-owned randomness and nonces (S5)', points: 15, evidence: 'Written nonce-uniqueness argument including resets; harness PASS for T-S5-1, T-S5-3 and the fresh-device key test; your added T-S5-2 (generator forced to fail) showing `err` and an empty slot.' },
    { criterion: 'Sessions and uniform failure (S2, S6)', points: 15, evidence: 'Harness PASS for T-S2-1 (both forms), T-S2-2 and T-S6-1; T-S6-2 timing table (failure type, number of runs, mean and spread) with the measurement method stated.' },
    { criterion: 'Security arguments and residual risk', points: 10, evidence: 'Argument for each of S1–S7; explicit assumptions about flash read-out and hardware key storage; no unverified claims about chip features.' },
  ],
  quiz: [
    { q: 'Why must a wrapping key not also be allowed to decrypt general data?', kind: 'security', choices: [
      { t: 'Each use wears a key out, and a wrapping key must last longer than a data key.', why: 'Keys do not wear out; usage limits exist for cryptographic reasons, and this restriction has a different purpose.' },
      { t: 'Decrypting an exported blob with it would return the wrapped key in clear.', ok: true, why: 'Two individually harmless operations combine into plaintext export. Separating the attributes removes the combination.' },
      { t: 'Decryption with a wrapping key is slower, which would break the two-second limit.', why: 'Speed is the same for any key of the same type.' },
    ] },
    { q: 'The host is allowed to supply the nonce for `encrypt`. A logged-in user wants to learn about another user\'s plaintext encrypted under the same key. What does the design give them?', kind: 'security', choices: [
      { t: 'Nothing: they still do not hold the key, and the nonce is not secret anyway.', why: 'They do not need the key. Consider what two ciphertexts under the same key and nonce reveal when one plaintext is known.' },
      { t: 'A repeated nonce, which relates plaintexts and enables forgery.', ok: true, why: 'Nonce uniqueness is the condition the cipher\'s security rests on, and the design has handed control of it to the adversary.' },
      { t: 'The ability to change the attributes of the key the nonce is used with.', why: 'Attributes are unrelated to the nonce; nothing in encrypt modifies them.' },
    ] },
    { q: 'Why does `authorise()` end its `switch` with `default: return R_DENIED;` rather than listing `OP_EXPORT_PLAIN` explicitly?', kind: 'code', choices: [
      { t: 'To save a line of code for each operation that has to be forbidden.', why: 'Brevity is incidental. The structure has a safety property worth naming.' },
      { t: 'So that any operation without an explicit rule is refused.', ok: true, why: 'Default deny means a missing rule fails closed. An explicit list of forbidden operations fails open for anything not on it.' },
      { t: 'Because C requires every switch statement to have a default branch.', why: 'C does not require one; omitting it would let unlisted values fall out of the switch into whatever code follows.' },
    ] },
    { q: 'Decrypt returns "bad MAC" for an altered tag and "bad format" for a truncated blob. Which requirement is at risk and why?', kind: 'concept', choices: [
      { t: 'S2, because a caller who triggers an error is handled before the login check.', why: 'The session check happens before decryption is attempted and is unaffected by which error is returned.' },
      { t: 'S6, because each distinct error reveals which check the input reached.', ok: true, why: 'Each distinct error is a bit of information about internal processing. A single uniform error removes that channel.' },
      { t: 'F6, because sending two different error messages takes longer than one.', why: 'Message text length has no meaningful effect on a two-second limit.' },
    ] },
    { q: 'Your security argument for S1 says "keys are protected by the microcontroller\'s key-store peripheral". What is missing?', kind: 'concept', choices: [
      { t: 'Nothing: storage in a dedicated hardware peripheral settles the question.', why: 'A peripheral\'s name is not a specification. What it guarantees, and under which configuration, must come from the manufacturer\'s documentation.' },
      { t: 'The documented property relied on and the configuration that enables it.', ok: true, why: 'An argument rests on stated, sourced assumptions. Without them a reviewer cannot check the claim.' },
      { t: 'A larger key size, since hardware storage is only as strong as the key in it.', why: 'Key size does not address whether stored key material can be read out.' },
    ] },
  ],
};

export default [relay, fieldbus, keykeeper];
