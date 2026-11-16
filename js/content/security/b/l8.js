import { C, code, widget, SCOPE } from './util.js';

const SECURE_ZERO = C`
#include <stddef.h>
#include <stdint.h>

/* Overwrite n bytes in a way the optimiser may not remove: each store goes
 * through a pointer to volatile, and every volatile access must be performed. */
void secure_zero(void *p, size_t n)
{
    volatile uint8_t *v = (volatile uint8_t *)p;

    while (n-- > 0u) {
        *v++ = 0u;
    }
}

#define KEY_LEN 32u

void key_load(uint8_t key[KEY_LEN]);                       /* platform: from protected storage */
void mac_with_key(const uint8_t key[KEY_LEN], const uint8_t *msg, size_t len, uint8_t tag[16]);

void tag_message(const uint8_t *msg, size_t len, uint8_t tag[16])
{
    uint8_t key[KEY_LEN];

    key_load(key);
    mac_with_key(key, msg, len, tag);
    secure_zero(key, sizeof key);       /* the stack copy does not outlive its use */
}
`;

const DERIVE_FIXED = C`
#include <stddef.h>
#include <stdint.h>

void secure_zero(void *p, size_t n);        /* the volatile-pointer wipe shown earlier */
void key_load(uint8_t key[32]);
void kdf(const uint8_t key[32], const uint8_t nonce[16], uint8_t out[32]);

void derive_session_key(const uint8_t nonce[16], uint8_t session[32])
{
    uint8_t master[32];

    key_load(master);                       /* from protected storage */
    kdf(master, nonce, session);
    secure_zero(master, sizeof master);     /* a call the optimiser cannot treat as a dead store */
}
`;

export default {
  id: 'sec-b-physical',
  title: 'Physical tampering and the limits of software',
  minutes: 45,
  summary: 'What changes when the adversary holds the board: reading memories, probing buses, replacing parts. Tamper evidence, tamper response, secure elements, and how all of it feeds the threat model.',
  skills: ['sec-b-physical-threats'],
  blocks: [
    `## The problem

A smart lock stores its pairing key in an external SPI flash chip. The firmware is carefully written: bounded copies, constant-time comparison, a persistent rate limit, authenticated updates, debug port disabled. A locksmith's apprentice, curious, unscrews the inside cover, clips a programmer onto the eight pins of the flash chip, and reads the whole memory in under a minute. The key is at offset 0x3F000.

No line of the firmware executed during that minute. Which of the previous seven lessons could have prevented it?

## What changes with physical access

None of them, and that is the point of this lesson. Software controls act when the processor runs the software. With the device in hand, an adversary can work *around* the processor:

| Action | What it reaches | Skill and equipment (roughly) |
|---|---|---|
| Read an external memory in circuit or after removing it ([[Chip-off]]) | everything stored there: firmware, configuration, keys, logs | low: a clip and a generic programmer |
| Listen to a bus (SPI, I²C, UART, parallel) with a logic analyser | everything that crosses it: keys loaded from an external chip, PINs from a keypad, decrypted data | low |
| Drive a bus or a pin | impersonate a sensor, a keypad, a secure element's "OK" line; hold a boot-mode pin | low to moderate |
| Replace a component | substitute the flash, the sensor, or the whole MCU for one the adversary controls | moderate |
| Use debug and boot interfaces | lesson 5 | low if open |
| Measure power or EM | lesson 6 | moderate, plus time |
| Inject faults | lesson 7 | moderate to high |
| Open the chip package and probe or image the die | internal memory and signals | high: laboratory |

Two things turn an individual success into a system failure: **shared secrets** (one opened unit yields a key valid for all units) and **scalable follow-up** (what was learned physically from one unit enables a remote attack on the rest).

This lesson therefore does not teach a new defect in code. It teaches how to revise the threat model from part A when "physical possession" is added to the adversary's capabilities, and which countermeasures are proportionate.

## How the exposure arises

Go back to the block diagram of an MCU system from the architecture section and look at every line that leaves a chip package.

- **External flash and EEPROM.** The interface is a public standard and the chip answers anyone who asserts chip-select. If the MCU can read it without a key, so can a programmer. Data here is protected only by encryption with a key that is kept somewhere else — inside the MCU — which is what flash encryption on the ESP32 family provides (part A).
- **Buses.** A key that is stored in a secure chip and then sent to the MCU over I²C in the clear has been exported onto a pair of probe-able wires. The same holds for a keypad matrix, a display bus showing a one-time code, or a "door open" GPIO driving a relay: whoever can touch the wire can read or drive it.
- **Single-wire decisions.** If a secure element verifies a PIN and signals the result by raising one line, the adversary does not need the PIN; they need a wire to that line. A component's verdict has to arrive in a form that cannot be forged by the wire: an authenticated message bound to a fresh challenge.
- **Trust in components.** Firmware usually assumes the flash chip is the flash chip that was fitted. A replacement that returns one image when hashed and another when executed, or a sensor emulator, breaks assumptions no code checked.
- **Internal memory** is much harder to reach than external memory, which is exactly why keys belong there; but "harder" depends on debug-port state, on fault-injection resistance of the lock, and at the top end on invasive techniques. General-purpose MCUs are not designed against the last of these.

## What an adversary gains

Depending on the design: stored secrets, the firmware (for analysis), the ability to make the device act (drive the relay, fake the sensor), a modified device returned to service (a supply-chain or "evil maid" scenario), or, where secrets are shared, the keys to every other unit. The conditions are possession and time; the main variable is whether the device must be visibly damaged, which is what tamper evidence addresses.`,
    { t: 'predict', q: 'A manufacturer covers the MCU and flash chip of a lock with black epoxy "so that nobody can read the firmware". The debug port is enabled, its pads are under the epoxy, and all units share one pairing key stored in the external flash. How much does the epoxy change the outcome for a determined adversary?', choices: [
      { t: 'Little: it costs hours on one sacrificed unit, and the shared key then works everywhere', ok: true, why: 'The other units are never touched. Potting raises the cost of the first extraction only. Because the secret is shared, the first extraction is the only one needed.' },
      { t: 'It prevents extraction, because the chips cannot be accessed without destroying them', why: 'Potting compounds can be removed with heat, solvents or careful milling, and a unit that is destroyed in the process has still given up its contents.' },
      { t: 'It prevents extraction, because the part markings are hidden and the chips cannot be identified', why: 'Packages, pin counts and bus signals identify memory chips well enough, and the standard interfaces work whatever the marking says.' },
      { t: 'It makes things worse, because epoxy conducts electricity', why: 'Potting compounds are insulators. The weakness is that they are a delay, not that they do electrical harm.' },
    ], reveal: 'Epoxy is an obstacle and, at best, a source of tamper evidence. It is not a control you can put in a threat model against the line "adversary with one unit and a week". The controls for that line are per-device keys, keys held inside a chip designed to keep them, encryption of external storage, and closed debug interfaces.' },
    `## How it appears on actual hardware

- **Tamper inputs and backed-up storage.** Some MCUs provide dedicated tamper pins and a small battery-backed memory that hardware erases when a tamper event occurs. TI's MSPM0 SDK includes examples for the MSPM0L2228 named for tamper I/O heartbeat, RTC tamper timestamp events and scratchpad erase-on-tamper; the datasheet (SLASF94A, LFSS description and Table 6-16) gives up to three tamper inputs (TIO0 to TIO2, depending on the package) in a battery-backed block with an RTC, tamper timestamps, an independent watchdog and a 32-byte scratchpad memory.
- **Key storage peripherals.** The MSPM0L2228 header lists a KEYSTORECTL module beside its AES engine, and the MAX78000 header lists AES key registers; the intent of such peripherals is that software can *use* a key without being able to *read* it back. TI's datasheet (SLASF94A, section 8.21) describes the MSPM0L2228 keystore as storage for up to four AES keys of 128 or 256 bits. Part A covers their use; for the MAX78000, check the datasheet for what is and is not guaranteed, which this course has not verified.
- **[[Secure element]]s.** Separate chips built to resist the whole table above: shielded and sensor-monitored dies, side-channel and fault countermeasures, keys generated inside and never exported, often with a certification report describing what was evaluated. They answer challenges; they do not hand out keys.
- **Enclosure features.** Switches or optical sensors that detect opening, conductive meshes around sensitive areas, seals and labels, security screws.

## How a team detects the exposure

This is a design review activity, performed on the schematic, the layout and the threat model, not on source code.

**Review questions:**

- For every memory device: what is stored in it, in what form, and where is the key for that form?
- For every bus and every signal between chips: what crosses it in the clear? What happens if an adversary reads it, drives it, or holds it at a fixed level?
- Is any security decision carried by a single unauthenticated wire?
- Which secrets are identical across units? What does one opened unit yield for the rest?
- What does the device assume about the identity of its own components, and is any of that assumption checked?
- If a unit were opened, modified and reassembled, who would notice, when, and how?
- Which test points, headers and boot-mode pins exist on the production board?

**Measurements on your own hardware:** read your own external flash with a programmer and look for anything sensitive; capture your own buses during pairing, login and key use and search the capture for key bytes; operate the production board with each boot-mode strap forced.

## The defences

**1. Reduce what a single unit is worth.** Per-device keys, derived or provisioned individually, so that an opened unit compromises itself and nothing else. This is the highest-value measure and it is an architecture decision, not a part on the board.

**2. Keep secrets inside a chip boundary.** Keys in internal protected storage or a secure element; never on a bus in the clear; external memory encrypted and authenticated with a key that stays inside.

**3. Authenticate between components** where the threat model includes substitution or bus driving: challenge–response with the secure element, authenticated firmware in external flash verified at each boot, plausibility checks on sensors.

**4. Minimise the lifetime of secrets in RAM.** Load a key, use it, erase the copy:`,
    code(SECURE_ZERO, 'host-tested', { caption: 'Erasing a temporary key copy so that the compiler cannot remove the erase. Tested on the host at -O2; where your C library provides memset_s or explicit_bzero, prefer it. Confirm the stores exist in the target disassembly.', explain: [
      { lines: '8-12', md: 'A plain `memset(key, 0, sizeof key)` just before `return` writes to an object that is never read again. The optimiser calls that a dead store and may delete it, leaving the key on the stack for whichever function runs next — or for a debugger, a memory-dump defect, or a cold restart. GCC and Clang perform every store made through a `volatile`-qualified lvalue, which is why this idiom works in practice; older C standards promise it outright only for objects that are themselves defined `volatile`, so the disassembly check named in the caption is part of the technique and not an optional extra.' },
      { lines: '24-26', md: 'The key exists in ordinary RAM only between these lines. This does not protect against an adversary who can halt the core at that moment; it removes the much larger window in which stale stack contents hold the key.' },
    ] }),
    `**5. [[Tamper evidence]].** Seals, labels and enclosures that cannot be opened without visible damage. Useful only where someone inspects the device and where "we can tell it was opened" has value: payment terminals, meters, voting equipment. It prevents nothing by itself.

**6. [[Tamper response]].** Detect opening or probing and erase keys held in battery-backed memory ([[Zeroisation]]). Effective when the detection is reliable and the keys really are only in that memory. Costs: a battery, false alarms that destroy healthy units, and an adversary who studies one unit to learn how to avoid the sensors on the next.

**7. Deny easy access.** No populated debug header, internal routing for sensitive nets where the board technology allows, security fasteners, potting. These are delaying measures. They belong in the design as cost multipliers, and never in the threat model as the reason an attack "cannot" happen.`,
    { t: 'callout', kind: 'mistake', title: 'Epoxy, sanded-off markings and custom screws listed as security controls', md: `Obscurity measures change how long the first unit takes. They do not change what is learned from it. A review that answers "the key is in external flash" with "but the board is potted" has not answered the finding. Record such measures as what they are — delay and, sometimes, evidence — and require a real control (per-device keys, internal storage, encryption) for the asset itself.` },
    { t: 'callout', kind: 'decision', title: 'How far to go?', md: `Match the countermeasure to the adversary and the asset, using the threat model. A consumer gadget whose only secret is its owner's Wi-Fi password needs per-device storage of that secret and a closed debug port; tamper response would be absurd. A lock or an access controller needs per-device keys, encrypted or internal storage, and authenticated internal links, because possession of a unit is expected. A device whose single key protects a whole system (content protection, payment, an HSM) needs a secure element or a security-evaluated MCU, tamper response, and a design that assumes units will be attacked in a laboratory. In a design-and-attack competition on a fixed development board, physical controls are not available to you: the proportionate response is architectural — minimise what each device holds, make secrets per-device, and harden the few decisions that matter (lesson 7).` },
    { t: 'callout', kind: 'sim', md: SCOPE + ` The worksheet below is a planning tool; it attacks nothing. If you read flash chips or probe buses for practice, do it on boards you own.` },
    widget('threat-model', { template: 'smart-lock' }, 'Before you open it, write down which one asset of a smart lock you expect to have no real control left once the adversary holds the device. Then open the smart-lock template. Add an adversary "has one unit for a week, basic lab tools". For each asset, add the physical entry points from the table above, write the threat, and assign a mitigation that is a control, not a delay. Save the result to your notebook.'),
    `### Debrief

Check your worksheet against these points:

- Every asset stored outside the MCU has either moved inside, or gained encryption with a key that is inside.
- No mitigation reads "potted", "hidden", "unmarked" or "nobody would".
- Shared secrets have been replaced by per-device ones, or the residual risk is written down and accepted by name.
- Each mitigation has a verification step you could perform on your own unit: read the flash and search it; capture the bus and search it; attempt a debug connection.
- Some threats remain open (invasive attacks on a general-purpose MCU, for instance). A threat model that lists them honestly is more useful than one that claims completeness.

## Verifying the defences

- **Flash audit:** dump the external memory of a provisioned production unit you own; search for keys, credentials and plaintext configuration; confirm the dump differs between two units where it should.
- **Bus audit:** capture every inter-chip bus through provisioning, authentication and normal use; search the captures for known key bytes and PINs.
- **Component substitution test:** swap the external flash between two of your units, or replace it with a blank one; the device must refuse to operate or fall back safely.
- **Tamper tests:** open the enclosure with power applied and removed; confirm detection, erasure and the recorded event; measure the false-trigger rate under vibration and temperature.
- **RAM lifetime:** in a debug build, break after the function that uses a key and inspect its stack frame for key bytes.
- **Review of evidence** for bought-in security: the secure element's certification or evaluation summary and its stated assumptions.`,
    { t: 'exercise', prompt: `Review this function from a device that stores a master key in protected internal storage and uses it to derive session keys. A colleague says "the master key never leaves the secure storage API, so we are fine." Find the defect and state the fix. Then answer: which physical-access scenarios does your fix help against, and which not?`, code: C`
void derive_session_key(const uint8_t nonce[16], uint8_t session[32])
{
    uint8_t master[32];

    key_load(master);                       /* from protected storage */
    kdf(master, nonce, session);
    memset(master, 0, sizeof master);       /* wipe before returning */
}`, hints: [
      'After the `memset`, is `master` ever read again? What is an optimising compiler allowed to do with a write that nothing reads?',
      'How could you check whether the wipe exists in your build?',
      'For the second part: think about when the key is in RAM at all, and who can observe RAM, and how.',
    ], solution: `**Defect:** the \`memset\` is a dead store: \`master\` goes out of scope immediately afterwards, so the compiler may remove the call (CERT C MSC06-C; CWE-14, compiler removal of code to clear buffers). The master key then remains in the stack frame until overwritten by later calls, in memory that the "secure storage API" no longer protects.

**Fix:** erase through a \`volatile\` pointer, as in \`secure_zero\` above, or use \`memset_s\`/\`explicit_bzero\` where the library provides one; then confirm in the disassembly of the release build that the stores are present:

\`\`\`c
${DERIVE_FIXED}\`\`\`

(Compiled with \`-Wall -Wextra -Wconversion\` and run on the host at \`-O2\` with a test \`kdf\`.) **Test:** on the target, in a debug build, break on return from \`derive_session_key\` and search its dead stack frame for the bytes of a known test key; for the release build, the evidence is the disassembly (\`objdump -d\`: the call to \`secure_zero\`, or its inlined byte stores, after the call to \`kdf\`). A host unit test cannot do this job, because reading a dead stack frame from C is itself undefined behaviour. Better still, if the hardware offers a key store that performs the derivation internally, never load the master key into RAM at all.

**What it helps against:** disclosure of stale stack contents through a memory-dump defect or over-read (lessons 1 and 2), through a debug port opened later, or through RAM that keeps its contents across a warm reset.

**What it does not help against:** an adversary who can observe the device *while* the key is loaded — a halted core, a fault that redirects execution during the window, power analysis of the KDF. Those need the key to stay inside hardware built to resist them. Erasing reduces exposure time; it is not a boundary.` },
    `## Harder application

Open the HSM template of the threat-model worksheet in the Workbench and adapt it to this variant: an HSM-style device stores files for several groups, protects operations with a PIN, and transfers files to a neighbouring device over a second UART. Suppose all devices in a deployment share one transfer key, and an adversary legitimately owns one device. Write the physical-access section of the threat model: what the owned device yields, how that affects the other devices, which of the weaknesses from lessons 1 to 7 become reachable as a result, and the three design changes that would most reduce the damage. Rank them by cost.

This closes the catalogue. The lab that follows asks you to apply lessons 1 to 4 in the form you will use them most: reviewing someone else's module, writing findings, and proving the fixes.`,
    { t: 'refs', items: [
      { title: 'CWE-1263: Improper Physical Access Control', url: 'https://cwe.mitre.org/data/definitions/1263.html' },
      { title: 'CWE-14: Compiler Removal of Code to Clear Buffers', url: 'https://cwe.mitre.org/data/definitions/14.html' },
      { title: 'CWE-312: Cleartext Storage of Sensitive Information', url: 'https://cwe.mitre.org/data/definitions/312.html' },
      { title: 'SEI CERT C Coding Standard', url: 'https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard', note: 'Recommendation MSC06-C: beware of compiler optimizations' },
      { title: 'TI MSPM0 SDK: LP_MSPM0L2228 driverlib examples (tamper I/O, scratchpad erase on tamper)', url: 'https://github.com/TexasInstruments/mspm0-sdk/tree/main/examples/nortos/LP_MSPM0L2228/driverlib' },
    ] },
  ],
  quiz: [
    { q: 'A device keeps its firmware and a device-unique key in external SPI flash, unencrypted. The MCU debug port is permanently disabled. What can someone with the device and a flash programmer obtain?', kind: 'security', choices: [
      { t: 'The firmware and the key, by reading the flash chip directly', ok: true, why: 'The MCU and its debug lock are not involved. An external memory answers any master on its bus. Protection of the MCU does not extend to a separate chip.' },
      { t: 'Nothing, because the debug port is disabled', why: 'The debug port guards the MCU\'s internals. The flash chip has its own interface that does not pass through it.' },
      { t: 'The firmware only, because keys in flash are automatically encrypted', why: 'Nothing is encrypted unless the design enables a flash-encryption feature and keeps its key elsewhere.' },
      { t: 'Nothing, unless they also know the SPI flash password', why: 'Standard SPI NOR flash read commands are not password protected by default.' },
    ] },
    { q: 'A secure element verifies a PIN and then drives its `AUTH_OK` pin high; the MCU opens the lock when it reads that pin as 1. Where is the weakness?', kind: 'circuit', choices: [
      { t: 'The verdict travels on one unauthenticated wire that can be driven from outside', ok: true, why: 'They do not need to know the PIN. A logic level cannot prove who set it. The result must come as an authenticated response to a fresh challenge.' },
      { t: 'Secure elements can store keys but cannot verify PINs', why: 'Many can. The verification is not the weak part here; how its result is conveyed is.' },
      { t: 'GPIO inputs are too slow to read the signal reliably', why: 'A static level is trivially readable. Speed is not the issue.' },
      { t: 'The MCU polls the pin too rarely and could miss a short pulse from the secure element', why: 'Polling frequency does not help when the level itself can be forced by a third party.' },
    ] },
    { q: 'Which statement about tamper evidence and tamper response is correct?', kind: 'concept', choices: [
      { t: 'Evidence shows a later inspector that interference happened; response erases secrets when it is detected', ok: true, why: 'Neither is useful without the rest of its process: inspection, or secrets held only in erasable memory. A seal nobody checks proves nothing to anyone, and an erase circuit protects only the keys it can actually erase.' },
      { t: 'Tamper evidence prevents the enclosure from being opened; tamper response reports it if it happens anyway', why: 'A seal or label breaks when the enclosure is opened; it records the event and does not stop it.' },
      { t: 'Tamper response is a software feature that runs in the main loop and needs no hardware support', why: 'It depends on sensors and on memory that can be erased without the main supply, which are hardware.' },
      { t: 'They are two names for the same mechanism, used by different industries', why: 'One is passive and concerns detection after the fact; the other is active and concerns protecting secrets at the moment of intrusion.' },
    ] },
    { q: 'Why may a compiler delete the last line of this function, and what is the consequence?', code: C`
void sign(const uint8_t *msg, size_t n, uint8_t *sig)
{
    uint8_t key[32];
    key_load(key);
    do_sign(key, msg, n, sig);
    memset(key, 0, sizeof key);
}`, kind: 'code', choices: [
      { t: '`key` is never read after the `memset`, so the write is a dead store', ok: true, why: 'If it is removed, the key stays in stale stack memory after the function returns. Optimisers remove writes that cannot affect the program\'s observable behaviour, and "an attacker reading the stack later" is not behaviour the C standard describes.' },
      { t: '`memset` cannot be used on arrays of `uint8_t`', why: '`memset` works on any object. The call is valid; it is just not guaranteed to survive optimisation.' },
      { t: 'The compiler deletes it because `key` is `const`', why: '`key` is not declared `const` here, and the removal has nothing to do with qualifiers on the array.' },
      { t: 'It cannot be deleted; compilers never remove function calls', why: 'Compilers understand standard library functions and treat a `memset` on a dying object like any other removable store.' },
    ] },
    { q: 'A fleet of 50,000 sensors shares one symmetric key for talking to the server. The team proposes potting each board to protect the key. What should the review recommend instead, as the first change?', kind: 'security', choices: [
      { t: 'Per-device keys, so that one extracted key compromises only one device', ok: true, why: 'They can be provisioned individually or derived from a server-side master and the device ID. The dominant risk is that one extraction scales to the fleet. Removing the scaling is worth more than raising the cost of the single extraction.' },
      { t: 'Thicker potting compound and security screws on the enclosure', why: 'More of a delay measure is still a delay measure, and the first successful extraction still yields the fleet key.' },
      { t: 'Storing the key twice, in two different chips, for redundancy', why: 'Redundant copies help availability and give an adversary twice as many places to find the key.' },
      { t: 'Rotating the shared key every year by firmware update, so a stolen key expires', why: 'Rotation limits how long a stolen key is useful, but each new shared key is exposed in the same way by the next opened unit or update image.' },
    ] },
    { q: 'You are verifying the claim "no key material crosses the I²C bus between the MCU and the secure element". Which test supports it best?', kind: 'security', choices: [
      { t: 'Capture the bus on your own unit in every phase and search it for the test keys', ok: true, why: 'Every phase means provisioning, authentication and normal use, decoded from a logic-analyser capture. The claim is about what is physically on the wires, so the evidence is a recording of the wires during every phase in which keys are handled.' },
      { t: 'Read the secure element\'s datasheet for its key-export commands', why: 'The datasheet describes what the part can do. Whether your firmware uses it without exporting keys is a property of your design.' },
      { t: 'Review the MCU source code for every call that reads a key from the secure element', why: 'Review is valuable, but a library call you did not write may transfer key material, and only the bus shows what was actually sent.' },
      { t: 'Check that the bus has pull-up resistors of the right value', why: 'Pull-ups make the bus work electrically. They have no bearing on what data it carries.' },
    ] },
  ],
};
export const TESTED = { SECURE_ZERO, DERIVE_FIXED };
