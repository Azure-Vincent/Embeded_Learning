// Security part A, lessons 1-4: threat modelling, crypto building blocks, secure boot, key management.
import { CT_EQUAL, CLAB_CT_STARTER, CLAB_CT_SOLUTION } from './code.js';

const threatModel = {
  id: 'sec-a-threat-model',
  title: 'Embedded threat modelling',
  minutes: 45,
  summary: 'Decide what you are protecting, from whom, and through which doors, before choosing a single mechanism.',
  skills: ['sec-a-threat-model'],
  blocks: [
    `## The problem

Your team is building a battery-powered smart lock. In the first design review three people propose three things: encrypt the flash, add a tamper switch, and move to a more expensive microcontroller with a secure element. Each costs money and schedule. Nobody can say which one matters, because nobody has written down what the lock is protecting or who is expected to attack it.

A **threat model** is the document that settles that argument. It is short, it is written before the design is fixed, and every protective mechanism in the rest of this section traces back to a line in it. A mechanism with no line in the threat model is cost without a reason. A line with no mechanism is a known, accepted risk, and you should be able to say who accepted it.`,

    `## Four questions

A threat model answers four questions in order.

1. **What are the assets?** List what would hurt if it were read, changed or made unavailable. For the lock: the ability to open the door, the pairing keys, the firmware signing trust, the access log, and the vendor's ability to update devices.
2. **Who is the adversary and what can they do?** Describe capability, not personality. Capability levels that are useful for embedded products:

| Level | Access | Typical means |
|---|---|---|
| Remote | Network or radio only | Crafted packets, replayed messages, a malicious update server |
| Proximate | Within radio range or on a shared bus | Sniffing and injecting radio or bus traffic |
| Physical, brief | Hands on the device for minutes, no opening | Buttons, exposed connectors, power cycling |
| Physical, invasive | Owns a unit, can open it, days of time | Debug headers, flash readout, bus probing, fault injection, side channels |
| Insider or supply chain | Access to build systems, factory, or keys | Leaked signing key, modified image at the factory |

3. **Where are the trust boundaries and entry points?** Draw the system and mark every place data or physical influence crosses from something the adversary controls into something you rely on.
4. **Which threats will you defend against, how, and how will you check?** Each threat gets a mitigation and a test, or an explicit "accepted" with a reason.`,

    { t: 'callout', kind: 'why', md: 'The capability table is what stops the review from drifting into "but a nation state could…". If the product statement says the adversary owns a unit and has a week, then debug-port locking and per-device keys are in scope and a laser fault-injection rig may be argued out of scope. Both decisions are now written down and reviewable.' },

    `## The hardware and firmware attack surface as an inventory

Software threat modelling tends to stop at network interfaces. An embedded device has more doors, and several of them are not data interfaces at all. Walk the board and the firmware with this list and write one row per item that exists on your product.

| Entry point | What crosses it | Design question it raises |
|---|---|---|
| Debug port (JTAG, SWD) | Full read and write of memory and CPU state | Is it locked, authenticated or disabled in production? How is that tested? |
| Serial console and ROM download mode | Commands, log output, sometimes flash programming | What can be typed or read with no authentication? Do logs contain secrets? |
| On-board buses (I2C, SPI, UART between chips) | Sensor data, commands, sometimes keys in the clear | Would a probe on this bus see or change anything that matters? |
| External flash or EEPROM | Firmware, configuration, stored secrets | If the chip is read or rewritten out of circuit, what is exposed or altered? |
| Update channel | New firmware | Who can produce an image the device accepts? Can an old image be reinstalled? |
| Radio (BLE, Wi-Fi, sub-GHz) | Packets from anyone in range | Are messages authenticated and fresh, or can they be replayed? |
| Power and clock | Voltage and timing the CPU depends on | Does any single branch decide a security outcome if the CPU misbehaves for one instruction? |
| Timing, power draw, EM emissions | Information leaking out | Does execution time or current depend on secret data? |
| Manufacturing and repair interfaces | Provisioning commands, test modes | Is there a test mode that survives into shipped units? |

The other half of this section covers each weakness class in detail. Here the inventory serves one purpose: nothing gets forgotten.`,

    { t: 'ascii', caption: 'Trust boundaries for a smart lock. Every arrow that crosses a dashed line needs authentication, validation, or a written acceptance.', text:
`  phone app ~~~~BLE~~~~>:                      :
                        :  +---------------+   :   +-----------+
  update server ~~~~~~~>:  |  MCU          |===SPI==| ext flash |
                        :  |  ROM > boot   |   :   +-----------+
  anyone at the door    :  |  > app        |---GPIO--> motor driver
   - button, keypad --->:  |               |   :
   - opens the case ....:..|.SWD header....|   :
   - controls the       :  +-------^-------+   :
     battery contacts ..:..........|...........:
                           power and clock
  - - - - - - - - - - - -  trust boundary  - - - - - - - - - - -` },

    `## Worked example: three rows for the lock

A useful row has six fields. Here are three, written the way they would appear in a design document.

| # | Asset | Adversary and entry point | Threat | Mitigation | Verification |
|---|---|---|---|---|---|
| T1 | Ability to open the door | Proximate; BLE | Record a valid "unlock" and send it again later | Challenge-response with a fresh random nonce per attempt; MAC over the nonce and command | Replay a captured exchange against a test unit: it must be rejected. Unit test with a repeated nonce. |
| T2 | Pairing key | Physical, invasive; SWD header | Read the key out of flash through the debugger | Disable or lock debug access in production; store the key in protected storage; per-device key so one unit does not unlock others | On a production-configured unit, a debug probe must fail to attach or read. Read the lifecycle setting back in the factory test. |
| T3 | Firmware trust | Physical, invasive; external flash | Rewrite flash with modified firmware that accepts any key | Secure boot from an immutable root; signed updates | Flip one bit of the app in flash on a test unit: it must refuse to boot. |

Notice what the rows do not say. They do not say "use AES-256". They say what must be true and how you will know. The algorithm is a detail under the mitigation.`,

    { t: 'predict', q: 'The lock team has budget for one mitigation this sprint. The product statement says the main adversary is a burglar who buys the same lock model to study it at home, then attacks other people\'s doors from outside without opening them. Which finding should be fixed first?',
      choices: [
        { t: 'Every lock ships with the same pairing master key in its flash, and the debug header is open', ok: true, why: 'The stated adversary owns one unit and attacks others. A fleet-wide secret that can be extracted once at home turns one afternoon of work into access to every door. That is the highest impact for the capability described.' },
        { t: 'The lock\'s case can be opened with a common screwdriver in under a minute', why: 'Opening a case matters when the attack happens at the victim\'s door. The stated adversary works on their own unit at home, where they can open any case given time, and does not open the victim\'s.' },
        { t: 'The access log is stored unencrypted', why: 'The log is an asset, but reading it requires the victim\'s unit to be opened and read, which the stated adversary does not do. It ranks below anything that opens doors remotely.' },
        { t: 'The firmware has no stack canaries', why: 'A missing hardening measure is a weakness, not a threat on its own. It needs a reachable memory-corruption bug behind an entry point before it ranks, and none has been identified here.' },
      ],
      reveal: 'Prioritising means multiplying impact by how well the threat fits the adversary you actually named. "Break once, break everywhere" findings (shared secrets, a shared signing key in the image) sit at the top for any adversary who can buy a unit.' },

    `## Prioritising

For each threat estimate two things on a coarse scale (low, medium, high) and write down the reasoning, not just the score:

- **Impact** if it succeeds: one device or the fleet? Recoverable by an update, or permanent? Safety, money, privacy?
- **Feasibility** for the named adversary: what access, equipment, skill and time does it need, and does it scale?

Then apply three rules of thumb that hold across products:

1. **Fleet-wide beats per-device.** Anything that turns one compromised unit into all units goes first.
2. **Unrecoverable beats recoverable.** A flaw in ROM or OTP cannot be patched; a flaw in the application can, if the update mechanism is sound. So the update mechanism and the boot chain deserve more review than their line count suggests.
3. **Cheap beats exotic.** An open UART console is more likely to be used than a decapsulated die, whatever is more interesting to talk about.`,

    { t: 'callout', kind: 'mistake', title: 'Common mistake: listing mechanisms instead of threats', md: 'A "security requirements" page that reads "AES-256, secure boot, encrypted flash" is a shopping list. It cannot be reviewed, because nobody can tell whether those three things cover the assets, and it cannot be tested, because there is no statement of what must not happen. Write the threat ("an adversary with SWD access must not be able to read the pairing key") and derive the mechanism from it.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: how much threat model is enough', md: 'Use a one-page table per product, revisited at every design review, rather than a formal methodology with tooling. The alternatives are no model (decisions get made by whoever argues longest) and a heavyweight process (it is done once, filed and never updated). A table that the firmware team edits in the same repository as the code is the version that stays true. STRIDE is useful as a prompt at each boundary, not as paperwork.' },

    { t: 'widget', name: 'threat-model', props: { template: 'smart-lock' }, title: 'Threat model worksheet: smart lock',
      caption: 'Fill in assets, adversaries and entry points, then write at least five threats with a mitigation and a verification step each. Export it to your notebook; the lab at the end of this half builds on it.' },

    { t: 'exercise',
      prompt: `A soil-moisture sensor node runs on a coin cell, reports over a sub-GHz radio to a gateway, stores a network key in external SPI flash, and has an unpopulated 4-pin header labelled TX RX 3V3 GND. The customer is a farm; nodes sit in open fields.

Write **three** threat rows (asset, adversary and entry point, threat, mitigation, verification). Then state one threat you would explicitly accept and why.`,
      hints: [
        'Start from assets: what would the farm lose? Wrong readings may matter more than secret readings.',
        'The nodes are unattended in a field. Which capability level does that give a curious or malicious person?',
        'Look at the inventory table: radio, external flash, serial header. One row each is a reasonable start.',
        'An accepted risk needs a reason tied to impact or adversary, such as "requires destroying the node, affects one node".',
      ],
      solution: `One reasonable answer:

| Asset | Adversary and entry point | Threat | Mitigation | Verification |
|---|---|---|---|---|
| Integrity of readings | Proximate; radio | Inject false readings so irrigation runs or stops | Authenticate every packet with a MAC and a message counter | Send a packet with a wrong tag and a replayed packet to the gateway: both dropped |
| Network key | Physical, invasive; SPI flash | Read the key from the flash chip of one stolen node and impersonate any node | Per-node keys derived from a master that never leaves the gateway/back end; a stolen node exposes only itself | Dump the flash of a test node; confirm the key found does not authenticate as another node |
| Node firmware | Physical, brief; serial header | Use the console or ROM loader to read or replace firmware | No unauthenticated console in production builds; restrict the ROM download mode | Connect to the header on a production-configured unit: no shell, no flash read |

**Accepted:** physical destruction or theft of a node (denial of service for that node). It affects one node, is visible to the farmer as a missing sensor, and no electronic measure prevents it.

Confidentiality of the moisture readings is also a candidate for acceptance: encrypting costs little if you already authenticate, but if energy is tight it is the first thing to drop, because the readings are not sensitive.` },

    `## Harder application: the same method on a different product

The 2026 MITRE eCTF reference design (MSPM0L2228) is a hardware security module that stores files in slots, each owned by a group, with read, write and receive permissions and a PIN. Its inventory is different from the lock's: two UARTs (a control interface and an HSM-to-HSM transfer interface) instead of a radio, internal flash holding a file table at a fixed address, and a debug port on a board the adversary holds in their hands.

Open the worksheet below and model it. Use the capability table: in a competition the adversary has the device, the source code of the reference design and weeks of time, so "physical, invasive" is the default, not the exception. This is a course exercise on a simulated worksheet, not official MITRE material. The competition's actual security requirements are published on its rules site, and there are three for 2026. Paraphrased: (1) no action on a file without a validly provisioned HSM that holds the matching permission for that file's group; (2) no PIN-protected action without prior knowledge of the PIN, and the PIN itself must not leak; (3) an HSM must only receive files that were generated by a valid HSM with write permission for that group. The rules also cap any operation with an invalid PIN at 5 seconds. Read the exact wording at [rules.ectf.mitre.org/2026/specs/security_reqs.html](https://rules.ectf.mitre.org/2026/specs/security_reqs.html) before you rely on this summary, and notice that each requirement names an outcome an attacker must not reach, which is the form this lesson asks for.`,

    { t: 'widget', name: 'threat-model', props: { template: 'hsm' }, title: 'Threat model worksheet: file-storing HSM' },

    { t: 'callout', kind: 'security', title: 'How you detect a missing or stale threat model', md: 'Ask three questions in a design review. Can anyone point to the document? Does it mention every connector, header and radio on the current board revision? Does each mitigation have a named test that exists in the test plan? A "no" to any of them is the finding. The verification of a threat model is the test list it generates: if a row has no test, you do not know whether its mitigation works.' },
  ],
  quiz: [
    { q: 'A team writes "the device shall use AES-256" as its security requirement. What is the main problem with that statement?', kind: 'concept',
      choices: [
        { t: 'It names a mechanism, not what must be protected or from whom', ok: true, why: 'A requirement must state an outcome ("X must not be readable by an adversary with Y access"). Only then can you judge whether a cipher, and which use of it, achieves it.' },
        { t: 'AES-256 is too slow for a battery-powered microcontroller, so the requirement cannot be met in practice', why: 'Many microcontrollers have AES hardware and software AES is practical on small cores. Speed is not what makes the statement a poor requirement.' },
        { t: 'It should say AES-128, the standard choice for embedded devices', why: 'Changing the key size leaves the same gap: nothing says what is encrypted, where the key lives or what threat is addressed.' },
      ] },
    { q: 'Which finding ranks highest for an adversary who can buy one unit and study it for a week?', kind: 'security',
      choices: [
        { t: 'A single pairing secret shared by all units is stored in the firmware image, readable from any one unit', ok: true, why: 'One extraction on the purchased unit compromises the whole fleet. Scale of impact dominates.' },
        { t: 'The device can be reset by removing the battery', why: 'Power cycling is expected behaviour. It only becomes a threat if some security state is lost on reset, which has not been shown.' },
        { t: 'A per-device key can be read out of that unit\'s RAM with a debug probe in a few minutes', why: 'That is a real finding, but its impact stops at the unit the adversary already owns. It ranks below anything that transfers to other units.' },
        { t: 'The enclosure has no tamper-evident seal', why: 'A seal tells the owner a unit was opened. The adversary here opens their own unit, where evidence of opening changes nothing.' },
      ] },
    { q: 'Why do power and clock inputs appear in a hardware attack-surface inventory even though no data is sent over them?', kind: 'arch',
      choices: [
        { t: 'Disturbing them can make the CPU misexecute an instruction that a security decision rests on', ok: true, why: 'They are a channel of physical influence. Listing them forces the question "what happens if this one check misbehaves?" during design.' },
        { t: 'Firmware updates are often delivered over the power line', why: 'Power-line communication exists in some products, but that would make it a data interface listed under the update channel. The reason these inputs are listed applies to every MCU.' },
        { t: 'They are listed so that brown-out resets are handled gracefully and no state is corrupted when the battery sags', why: 'Brown-out handling is a reliability concern. The inventory is about what an adversary can influence deliberately.' },
      ] },
    { q: 'A row in your threat table has a mitigation but the "verification" column is empty. What does that tell you?', kind: 'concept',
      choices: [
        { t: 'You do not know that the mitigation works, or that it is switched on', ok: true, why: 'An untested mitigation is an assumption. Many field failures are mechanisms that existed in the SDK but were never switched on in the shipped configuration.' },
        { t: 'Nothing: a mitigation that is a standard, vendor-tested SDK feature needs no test of your own', why: 'Standard features are exactly the ones that get left in their default, often disabled, state. A feature being available is different from it being active on the shipped unit.' },
        { t: 'The threat should be deleted from the table', why: 'The threat still exists whether or not you have a test for it. Removing the row hides the gap instead of closing it.' },
      ] },
    { q: 'The product is a toy with no network, no stored personal data, and firmware that the vendor is happy for hobbyists to modify. A reviewer asks for secure boot and flash encryption. What is the sound response?', kind: 'concept',
      choices: [
        { t: 'Write down assets and adversaries; if modified firmware harms no asset, record that secure boot is not required', ok: true, why: 'A threat model can conclude that a mechanism is unnecessary. Recording the reasoning is what makes the decision reviewable later when the product gains a radio.' },
        { t: 'Add both anyway: they cost nothing extra in the SDK, and more security is always better', why: 'Each mechanism adds cost, factory steps and ways to brick units. Without an asset it protects, that cost buys nothing.' },
        { t: 'Refuse without discussion: toys are never attacked, so the review time is better spent elsewhere', why: 'Product category does not decide it; assets do. A toy with a microphone and Wi-Fi would have a very different answer.' },
      ] },
    { q: 'Which statement about trust boundaries is correct?', kind: 'arch',
      choices: [
        { t: 'A bus between two chips on one board is a boundary if the adversary has physical access', ok: true, why: 'With physical access, on-board traces can be probed and driven. Whether two chips trust each other\'s traffic must then be a deliberate decision.' },
        { t: 'Trust boundaries exist only where the device connects to a network or radio, because that is where outside data arrives', why: 'This software-centric view misses debug ports, removable storage and on-board buses, which are the first things examined on a unit an adversary owns.' },
        { t: 'Everything inside the enclosure is on the trusted side', why: 'An enclosure delays access; it does not prevent it for anyone who owns the unit. The boundary follows the adversary\'s stated capability.' },
      ] },
  ],
};

const cryptoBlocks = {
  id: 'sec-a-crypto-blocks',
  title: 'Cryptographic building blocks for firmware engineers',
  minutes: 60,
  summary: 'Hashes, MACs, signatures and authenticated encryption: what each one guarantees, what it does not, and the conditions under which the guarantee holds.',
  skills: ['sec-a-crypto-choose', 'sec-a-secure-c'],
  blocks: [
    `## The problem

A bootloader accepts firmware images over UART. Each image ends with a CRC-32, and the bootloader refuses images whose CRC does not match. A colleague says the update path is therefore "protected against tampering".

It is not. Anyone who changes the image can recompute the CRC, because computing it needs no secret. The check detects a flipped bit on a noisy cable. It was never able to detect a person.

Almost every cryptographic failure in embedded products has this shape: a primitive is used for a guarantee it does not give. This lesson is a map of which primitive gives which guarantee. You will not implement any of them. You will learn to choose and to state the conditions each one needs.`,

    `## Four guarantees

| Guarantee | Meaning | Example requirement |
|---|---|---|
| **Confidentiality** | Only holders of a key can read the data | The Wi-Fi password in flash must not be readable from a chip dump |
| **Integrity** | Any change to the data is detected | A corrupted configuration record must be rejected |
| **Authenticity** | The data was produced by a holder of a specific key | Only the vendor can produce firmware the device will run |
| **Freshness** | The data is not an old valid message sent again | A recorded "unlock" must not work twice |

No single primitive gives all four. Freshness is never given by a primitive at all; it comes from protocol design (counters, nonces, timestamps) and is covered with replay defences in the other half of this section.`,

    `## Hash functions

A cryptographic hash such as SHA-256 (specified in FIPS 180-4) takes any number of bytes and returns a fixed-size digest, 32 bytes for SHA-256. Three properties matter: you cannot find an input for a given digest (*preimage resistance*), you cannot find a second input matching a given input's digest (*second-preimage resistance*), and you cannot find any two inputs that collide (*collision resistance*). Collisions are the cheapest of the three to look for: by the birthday effect a collision in an n-bit digest takes about 2^(n/2) attempts, so SHA-256 gives about 128 bits of collision resistance, not 256.

**How it works at the level you need:** the message is padded and cut into 64-byte blocks. A 256-bit internal state is mixed with each block through 64 rounds of additions, rotations and bitwise functions. Changing one input bit changes about half the output bits. Microcontrollers with a SHA accelerator do the rounds in hardware; you feed blocks into a register interface or call the vendor driver.

**What it gives:** a compact fingerprint. If you already hold a trusted digest, you can check that data matches it.

**What it does not give:** authenticity. There is no key. If the adversary can replace the data and the digest together, a hash proves nothing. A hash is the first step inside signatures and MACs, not a substitute for them.`,

    { t: 'widget', name: 'crypto-lab', props: { tab: 'hash' }, title: 'SHA-256: change one character',
      caption: 'Change a single character of the input and count how many output bits change. Then ask yourself: could an adversary who edits the input also produce the new digest?' },

    `## Symmetric and asymmetric keys

**Symmetric** algorithms (AES, HMAC) use one secret key shared by both parties. They are fast and small. The cost is in the trust model: every party that can *check* can also *create*. If a device holds the key that verifies firmware MACs, a key extracted from one device can produce firmware for all of them.

**Asymmetric** algorithms (RSA, ECDSA, defined in FIPS 186-5) use a key pair. The private key signs; the public key verifies. A device that holds only the public key can check a signature but cannot make one, so extracting everything from a device gives the adversary nothing that signs firmware. The cost is size and time: verification of an RSA-3072 or ECDSA P-256 signature takes much longer than a MAC on a small core, which is acceptable once per boot or per update and not per packet.

The usual division of labour follows from this: asymmetric signatures for things one party produces and many verify (firmware, certificates); symmetric MACs and AEAD for traffic between parties that already share a key; asymmetric key agreement (ECDH) to establish that shared key in the first place.`,

    `## MACs

A message authentication code is a tag computed from a message and a secret key. HMAC-SHA-256 is the standard construction from a hash; AES-CMAC is the standard one from a block cipher.

**What it gives:** integrity and authenticity between holders of the key.

**What it does not give:** confidentiality (the message is in the clear), freshness (an old message with its old tag verifies again), or non-repudiation (either key holder could have made the tag).

**Conditions:** the key is secret and random; the tag is compared in constant time; the tag is not truncated below what the design analysed; the same key is not reused for a different purpose.

A common wrong construction is \`hash(key || message)\`. With SHA-256 this allows *length extension*: given the digest, an adversary can compute a valid digest for the message with extra bytes appended, without knowing the key. HMAC exists to avoid that. Use HMAC from a library; do not build your own keyed hash.`,

    { t: 'widget', name: 'crypto-lab', props: { tab: 'hmac' }, title: 'HMAC: verify, then tamper',
      caption: 'Compute a tag, change the message, verify again. Then change the key by one character.' },

    `## Digital signatures

A signature scheme has three operations: generate a key pair, sign with the private key, verify with the public key. In practice the signer hashes the message and signs the digest.

**What it gives:** integrity and authenticity, verifiable by anyone with the public key, with no ability for the verifier to forge.

**What it does not give:** confidentiality, freshness, or any statement that the signed thing is *good*. A signature on a vulnerable firmware version from last year is still valid. That gap is what anti-rollback closes later in this section.

**Conditions:**
- The private key never leaves a controlled signing environment.
- The device's copy of the public key (or its digest) cannot be replaced by the adversary. A verifier that reads its trusted key from writable flash is verifying against whatever the adversary wrote there.
- ECDSA needs a fresh, unpredictable per-signature random value. If that value repeats or is predictable, the private key can be computed from the signatures. Use a library that derives it deterministically or from a proper [[DRBG]]. This matters for devices that sign; devices that only verify are not exposed to it.
- The whole signed range is covered, including version fields and lengths in the header.

### RSA-PSS or ECDSA

These are the two signature schemes you will meet in boot ROMs. At the sizes below they are rated at about the same strength (roughly 128 bits; see the size table later in this lesson), and they differ in everything else.

| | RSA-3072 with PSS padding | ECDSA on curve P-256 |
|---|---|---|
| Public key | 384-byte modulus plus a small exponent | 64 bytes (X and Y coordinates) |
| Signature | 384 bytes | 64 bytes (r and s) |
| Verifying | Cheap: one modular exponentiation with a small public exponent (normally 65537) | Several times dearer: two elliptic-curve scalar multiplications |
| Signing | Expensive: an exponentiation with the full-size private exponent | Cheap |
| Randomness when signing | PSS adds a random salt; a poor salt weakens the proof but does not hand over the key | Needs the per-signature secret described above; a repeated or biased value reveals the private key |

"RSA" alone does not name a signature scheme. The bare RSA operation on a digest is forgeable, so the digest is first expanded by a padding scheme. **PSS** (RFC 8017, section 8.1) is the current one: randomised, with a security proof. The older PKCS #1 v1.5 padding is deterministic and still widely deployed; several real forgeries came from verifiers that parsed its padding loosely. Either way the padding check is part of verification and belongs to the library, not to your code.

How this decides a design: a device that only **verifies** (a bootloader) cares about verification time and code size, and RSA verification is fast. The ESP-IDF Secure Boot V2 guide gives, for the ESP32-C6 ROM, about 10.2 ms for RSA-3072 against about 83.9 ms for ECDSA P-256, and recommends RSA where boot time matters and ECDSA where a shorter key matters. A device that must **sign** (a device identity key answering a challenge) usually chooses ECDSA, because RSA private-key operations are slow and the keys are large, and then the per-signature randomness becomes that device's problem.`,

    { t: 'widget', name: 'crypto-lab', props: { tab: 'sign' }, title: 'ECDSA P-256: sign, verify, tamper',
      caption: 'Sign a message, verify it, then alter one character of the message or swap in a different public key.' },

    `## Authenticated encryption

Encryption alone gives confidentiality and nothing else. With a stream-like mode such as AES-CTR, flipping a ciphertext bit flips the same plaintext bit after decryption, and the receiver cannot tell. An adversary who knows the layout of a message can change a field without ever knowing the key.

**Authenticated encryption with associated data** ([[AEAD]]) fixes this by producing ciphertext plus a tag in one operation. AES-GCM (NIST SP 800-38D) and ChaCha20-Poly1305 are the common choices. Inputs: key, nonce, plaintext, and *associated data* that is authenticated but sent in the clear (a header, a device ID, a message counter). Decryption either returns the plaintext or fails; on failure no plaintext may be used.

**The nonce requirement is absolute.** For AES-GCM, using the same nonce twice with the same key lets an observer XOR the two ciphertexts to cancel the keystream, and reveals enough to forge tags for that key. On a microcontroller the usual ways this happens are a nonce counter kept in RAM that restarts at zero after reset, and a random nonce from an unseeded generator. Sound designs use a counter stored so that it survives reset and never repeats, a fresh session key per boot derived with a random contribution, or a nonce-misuse-resistant mode from a vetted library where one is available.

Three numbers from SP 800-38D to design with:

- **Nonce length: 96 bits.** Other lengths are permitted, but they are hashed down to a counter block, and the simple "never repeat the nonce" argument no longer covers them. Use exactly 12 bytes.
- **Random nonces: at most 2^32 encryptions per key.** Two random 96-bit values can collide; the limit keeps that probability negligible. A counter nonce has no such limit, which is one reason to prefer it when you can store it.
- **Tag length: 128 bits** unless the protocol has been analysed for less. A short GCM tag is weaker than its length suggests, because each successful forgery also reveals information about the authentication key.

A counter that must survive reset does not need a flash write per message. Reserve nonces in blocks: store \`counter + 1000\` *before* using the next thousand values, and after any reset start from the stored value. Some nonces are skipped, which is harmless; none is ever used twice.`,

    { t: 'widget', name: 'crypto-lab', props: { tab: 'aead' }, title: 'AES-GCM: tamper and nonce reuse',
      caption: 'Encrypt, flip a ciphertext byte and decrypt. Then encrypt two messages with the same nonce and see what the demo recovers.' },

    { t: 'predict', q: 'A sensor encrypts each reading with AES-GCM under a fixed device key. The 96-bit nonce is a counter held in a RAM variable that starts at 0 on every boot. The device reboots nightly. What is the consequence?',
      choices: [
        { t: 'Nonces repeat after each reboot, so those messages lose both secrecy and tag security', ok: true, why: 'Same key, same nonce, different plaintext is exactly the forbidden case for GCM. The fix is to make the nonce unique across resets: persist the counter, or derive a new key each boot.' },
        { t: 'Nothing: the tag still protects the messages', why: 'The tag depends on the same uniqueness condition. With a repeated nonce the authentication key material can be recovered, which allows forgeries.' },
        { t: 'Decryption fails on the receiver after a reboot, because it has already seen those nonce values and rejects them', why: 'GCM decryption uses whatever nonce arrives with the message and keeps no memory of earlier ones, so decryption succeeds. The failure is silent, which is what makes it dangerous.' },
        { t: 'Only the first message after each boot is affected', why: 'Every counter value reached on a previous boot is reused, not just zero.' },
      ],
      reveal: 'State that must be unique forever cannot live only in RAM. This is the same lesson as the anti-rollback counter later: uniqueness and monotonicity are storage problems.' },

    `## Randomness

Keys, nonces chosen at random, challenge values and ECDSA per-signature values all need unpredictability. On an MCU that means the hardware [[TRNG]] (the MAX78000 and the MSPM0L2228 both have one in their peripheral list; TI's datasheet describes the MSPM0L2228's as producing 32-bit outputs intended as the entropy source for a DRNG, SLASF94A section 8.19; ESP32 chips provide a hardware RNG with conditions on when its output is true-random that are described in the ESP-IDF random number documentation), usually feeding a [[DRBG]] in the crypto library.

\`rand()\` is a small deterministic generator. Seeding it from a timer or an ADC reading does not make it unpredictable: the seed space is small enough to search. It is never acceptable for anything in this lesson.

**How you detect a problem:** search the code base for \`rand(\`, \`srand(\`, and for nonce or IV variables that are initialised to constants. In review, for every key and nonce ask "where do these bits come from, and what are they just after reset?". Check the vendor's notes on what must be enabled before the TRNG output is valid.`,

    `## Comparing secrets: a worked example

A MAC tag, a PIN or a password hash must be compared without revealing *where* the first difference is. \`memcmp\` returns as soon as it finds a mismatch, so the time taken tells an observer how many leading bytes were right, and a correct value can be found one byte at a time. The other half of this section demonstrates that against a simulated device. The defence is small enough to show in full.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'Constant-time equality with its host test. Compiled with gcc -Wall -Wextra -std=c11 and run in this repository\'s environment; all cases passed.', code: CT_EQUAL,
      explain: [
        { lines: '9-12', md: 'The loop always executes `n` times. `diff` collects the XOR of every byte pair with OR, so it ends as zero only if every pair was equal. There is no `if` on data inside the loop, so the instruction sequence the CPU runs is the same for every input.' },
        { lines: '9', md: '`volatile` discourages the compiler from recognising the pattern and replacing it with an early-exit `memcmp`. It is a mitigation, not a guarantee: inspect the generated assembly for your compiler and optimisation level.' },
        { lines: '13-15', md: 'Converting "is zero" to 1 or 0 without a comparison. If `diff` is 0, `diff - 1` wraps to `0xFFFFFFFF` and bit 8 is 1. For any `diff` from 1 to 255, `diff - 1` is at most 254 and bit 8 is 0.' },
        { lines: '39-45', md: 'A test that tries every possible single-byte difference. Security routines deserve exhaustive tests where the input space allows it.' },
      ] },

    { t: 'callout', kind: 'hw', md: 'A host test proves the *result* is right. It does not prove the *timing* is constant on your target, because that depends on the compiler output and the CPU. To check on hardware you own: read the disassembly for the function and confirm there is no branch that depends on `a[i]` or `b[i]`; then toggle a GPIO around the call and measure many runs with matching and mismatching inputs on an oscilloscope or logic analyser. The distributions should be indistinguishable. Prefer the comparison function shipped with your crypto library, which its authors have already checked for your architecture.' },

    { t: 'widget', name: 'c-lab', title: 'Exercise: remove the early exit',
      props: {
        title: 'Constant-time tag comparison',
        prompt: `\`tag_equal\` returns at the first mismatching byte. The global \`steps\` counts loop iterations so you can see the leak: a wrong first byte takes 1 step, a wrong last byte takes 4.

Rewrite \`tag_equal\` so that it always examines all \`n\` bytes and makes a single decision at the end. Keep the \`steps++\` line inside the loop. The results (1, 0, 0) must stay the same; only the step counts change.

This runs on the Bench-MCU simulator. Step counts stand in for time here; they are not a timing measurement.`,
        starter: CLAB_CT_STARTER,
        solution: CLAB_CT_SOLUTION,
        tests: [
          { name: 'same result, same number of steps for every input', stdout: 'same  -> 1 in 4 steps\nfirst -> 0 in 4 steps\nlast  -> 0 in 4 steps\n' },
        ],
        hints: [
          'The `return 0` inside the loop is the leak. What could you remember instead of returning?',
          'XOR of two equal bytes is 0. OR-ing every XOR result into one variable leaves it 0 only if all bytes matched.',
          'Declare `uint8_t diff = 0;` before the loop, do `diff |= a[i] ^ b[i];` inside it, and return `diff == 0` after it.',
        ],
        explain: 'All three calls now take 4 steps. An observer who can only see how long the comparison takes learns nothing about which byte was wrong. On a real target, confirm the property in the disassembly as described above.',
      } },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: inventing a scheme', md: 'XOR with a repeating key, a "custom scrambler", a CRC with a secret polynomial, `hash(key || data)`, or a home-made mode of AES. Each looks reasonable to its author because the author cannot break it. Cryptographic designs are judged by years of public analysis, and yours has had none. The same applies to implementations: a textbook AES written from the specification will usually leak its key through timing or power. Use standard primitives, in standard constructions, from a maintained library.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: library and hardware accelerator, not your own code', md: 'Use a vetted library (the eCTF reference designs name wolfSSL as their optional example; ESP-IDF ships mbedTLS and exposes hardware acceleration behind it) and let it use the chip\'s AES, SHA and TRNG peripherals. **Why:** the library has test vectors, constant-time code paths and security maintenance; the accelerator is faster and keeps round keys out of general-purpose code. **Why not write it yourself:** you inherit every side-channel and corner-case bug the library authors already fixed. **Why not use the accelerator registers directly:** you can, for a single well-understood primitive, but then known-answer tests against published vectors are your responsibility. Either way, record the library version in your [[SBOM]] so you can answer "are we affected?" when an advisory appears.' },

    { t: 'exercise',
      prompt: `For each requirement, name the primitive you would use and one thing it does **not** give you that the design must handle separately.

1. The bootloader must only run firmware built by the vendor. Devices can be bought and dissected.
2. Two boards that share a factory-installed key exchange commands over a cable that can be probed. Commands are not secret but must not be altered or invented.
3. A Wi-Fi password is stored in a flash record that an adversary might read or modify out of circuit.
4. A firmware download of 900 kB must be checked for corruption after transfer, before the expensive signature check.`,
      hints: [
        'For 1, ask what an adversary gains by extracting everything from one device under each option.',
        'For 2, confidentiality is not required. Which primitive gives integrity and authenticity with a shared key?',
        'For 3, both "read" and "modify" are in the threat. One primitive covers both.',
        'For 4, is an adversary part of this specific check, or only a noisy link?',
      ],
      solution: `1. **Digital signature** (public key or its digest in immutable storage on the device). Does not give: freshness or goodness. An old signed image still verifies, so add a version floor (anti-rollback). A MAC would be wrong here: its key would be in every device.
2. **MAC** (HMAC-SHA-256 or AES-CMAC) over each command. Does not give: freshness. Add a counter or challenge inside the MACed data so a recorded command cannot be replayed. Also not confidentiality, which was not required.
3. **AEAD** (for example AES-GCM) with a key held in hardware-protected storage. Does not give: protection against replacing the record with an older valid record, and it relies on a unique nonce per write. Store the nonce with the record and never reuse it.
4. **A plain hash or CRC** is acceptable for this step because the adversary is not what it guards against; the signature check that follows is. Does not give: authenticity. It must never be the only check.` },

    `## Choosing sizes: security strength

A key or digest size means something only as the amount of work the best known attack needs. That is quoted as "bits of security": n bits means about 2^n operations. NIST SP 800-57 Part 1 gives the comparison table that designs are sized from:

| Strength | Symmetric cipher | Hash, against collisions | RSA modulus | Elliptic curve |
|---|---|---|---|---|
| about 112 bits | (none in current use) | SHA-224 | 2048 bits | P-224 |
| about 128 bits | AES-128 | SHA-256 | 3072 bits | P-256 |
| about 192 bits | AES-192 | SHA-384 | 7680 bits | P-384 |
| about 256 bits | AES-256 | SHA-512 | 15360 bits | P-521 |

Three things follow from it.

1. **Asymmetric key lengths are not security levels.** An RSA-3072 key is not "3072-bit security". RSA is attacked by factoring the modulus and elliptic curves by solving a discrete logarithm, both far cheaper than trying every key, so the keys must be much longer for the same strength. This is why a boot ROM pairs RSA-3072 or P-256 with SHA-256: all three sit on the 128-bit row.
2. **The weakest primitive on a path sets the strength of that path.** AES-256 for storage does nothing for firmware that is verified with an RSA-1024 signature (about 80 bits, and long retired).
3. **A tag is guessed, not searched for offline.** Forging a MAC or AEAD tag without the key means sending guesses to the device, and each guess succeeds with probability 2^-t for a t-bit tag whatever the key size. So tag length is sized against how many guesses the device will entertain, and a design may truncate a tag when frames are short and the receiver limits attempts. It must do the arithmetic first.`,

    { t: 'exercise',
      prompt: `A radio command frame is authenticated with HMAC-SHA-256 under a 256-bit key, and the tag is truncated to **16 bits** to save air time. The receiver processes at most 100 frames per second and silently ignores frames whose tag is wrong. An adversary without the key chooses one command and sends it with every possible tag value in turn.

How many **seconds** does it take, in the worst case, until one of those frames has been accepted? Then work out the same figure in years for a 64-bit tag, and say what the 256-bit key contributed in each case.`,
      hints: [
        'What is the adversary guessing: the key, or the tag? How many different values can a 16-bit tag have?',
        'Each guess costs one frame, and the receiver handles 100 frames per second. The receiver gives no hint about how close a guess was, so the guesses cannot be narrowed down.',
        'Worst-case time = number of possible tags / frames per second. On average the right tag turns up after about half of that.',
      ],
      answer: { type: 'number', value: 655.36, tol: 1, unit: 's' },
      solution: `A 16-bit tag has 2^16 = 65,536 possible values. At 100 frames per second every one of them has been tried after 65,536 / 100 = **655.36 s**, about 11 minutes, and on average the right one turns up after about half that.

For a 64-bit tag: 2^64 / 100 = 1.8 × 10^17 s, about 5.8 × 10^9 years.

The 256-bit key contributed nothing to either figure. It makes *computing* the right tag infeasible; it does not make *guessing* it any harder. The numbers that matter here are the tag length and the rate at which the receiver accepts attempts. That is why a short tag needs a lockout or rate limit to go with it, and why 8 bytes is a common floor for radio frames. (The lab at the end of this half uses an 8-byte tag for this reason.)

Note also what a successful guess buys: one accepted frame. If the frame carries a counter that the receiver then advances, the same frame does not work twice. Freshness and tag length are separate decisions.` },

    `## Harder application: review a protocol sketch

A colleague proposes this for the lock: "The phone sends \`AES-CBC(key, command)\`. The lock decrypts and, if the result parses as a known command, executes it." Apply the map from this lesson. Confidentiality: yes. Integrity and authenticity: none, because nothing detects modified ciphertext, and "parses as a command" is a weak filter that an adversary can probe by sending altered ciphertexts and watching the lock's reaction. Freshness: none, so a recorded message works again. The repair is not to add a CRC inside the plaintext. It is to replace the construction with an AEAD and put a fresh challenge or counter inside the authenticated data.`,

    { t: 'callout', kind: 'security', title: 'How you verify cryptographic code in a product', md: '1. **Known-answer tests**: run the published test vectors for every primitive on the target (or its accelerator) at start-up or in the factory test. 2. **Negative tests**: for every verify or decrypt call there is a test that flips one bit of the message, one bit of the tag and one bit of the key, and expects failure. 3. **Return values**: static analysis or review confirms every verify/decrypt result is checked and that failure leads to no use of the output. 4. **Key and nonce provenance**: a written table of every key and nonce, where its bits come from and where it is stored.' },
  ],
  quiz: [
    { q: 'A bootloader checks a SHA-256 digest stored at the end of each firmware image and refuses images whose digest does not match. Against a person who can modify the image, what does this achieve?', kind: 'security',
      choices: [
        { t: 'Nothing: they recompute the digest for the modified image', ok: true, why: 'A hash has no key. Stored alongside the data it protects, it detects accidents only.' },
        { t: 'Full protection, because SHA-256 cannot be reversed', why: 'Irreversibility stops someone finding an input for a given digest. It does not stop them computing a fresh digest for an input of their choice.' },
        { t: 'Protection as long as the digest is stored in a different flash sector from the code', why: 'Location in the same writable medium does not help: whoever can rewrite one sector can rewrite the other.' },
      ] },
    { q: 'Why is firmware signed with an asymmetric key instead of authenticated with an HMAC key stored in each device?', kind: 'concept',
      choices: [
        { t: 'A device that can verify an HMAC also holds the key needed to create one', ok: true, why: 'With signatures the device holds only public material. Verification ability and signing ability are separated.' },
        { t: 'HMAC-SHA-256 is cryptographically weaker than RSA or ECDSA, so it is not trusted for firmware', why: 'HMAC-SHA-256 is not weak. The issue is who holds the key, not the strength of the algorithm.' },
        { t: 'Signatures are faster to verify on microcontrollers', why: 'The opposite is true: a MAC is far cheaper. Signatures are chosen despite their cost because of the trust model.' },
      ] },
    { q: 'What does AES-GCM require of its nonce?', kind: 'concept',
      choices: [
        { t: 'It must never repeat for the same key, but it does not need to be secret', ok: true, why: 'Uniqueness per key is the requirement. The nonce is normally sent in the clear alongside the ciphertext.' },
        { t: 'It must be secret but may repeat', why: 'Secrecy of the nonce is not required, and repetition is the one thing that breaks the mode.' },
        { t: 'It must be random and unpredictable; a simple counter is not allowed', why: 'A counter that never repeats satisfies the requirement well. Randomness is one way to get uniqueness, not the requirement itself.' },
        { t: 'It only matters for messages longer than one block', why: 'The keystream and the authentication both depend on the nonce from the first byte, whatever the message length.' },
      ] },
    { q: 'This check guards a 32-byte MAC tag. What is wrong with it?', code: 'if (memcmp(received_tag, expected_tag, 32) == 0) { accept(); }', kind: 'code',
      choices: [
        { t: 'memcmp can stop at the first differing byte, so timing shows how many leading bytes matched', ok: true, why: 'That turns guessing a 32-byte value into 32 separate one-byte searches for an observer who can time responses. Use a constant-time comparison.' },
        { t: 'memcmp stops at the first zero byte, so a tag containing 0x00 is only partly compared and forgeries slip through', why: 'That limitation belongs to the string functions such as strcmp. memcmp compares exactly the number of bytes it is given.' },
        { t: 'The comparison should use == on the two pointers', why: 'Comparing pointers tests whether they are the same address, not whether the contents match.' },
      ] },
    { q: 'A design encrypts a configuration block with AES-CTR and stores it in external flash. An adversary cannot learn the key. What can they still do?', kind: 'security',
      choices: [
        { t: 'Flip chosen ciphertext bits, which flips the same plaintext bits, undetected', ok: true, why: 'Encryption without authentication is malleable. If the adversary knows the layout, a flag or limit can be changed without reading anything.' },
        { t: 'Nothing: without the key the block is useless to them', why: 'This assumes confidentiality implies integrity. They are separate guarantees and CTR mode provides only the first.' },
        { t: 'Decrypt the block by trying every counter value, since the counter space is far smaller than the key space', why: 'The counter is not the secret; the key is. Searching counters reveals nothing.' },
      ] },
    { q: 'Where should the bits for a device\'s long-term key come from?', kind: 'arch',
      choices: [
        { t: 'A hardware TRNG, directly or through a DRBG seeded from it, or a provisioning system that uses one', ok: true, why: 'Keys need full unpredictability. A physical noise source, correctly enabled and conditioned, is the only on-chip source of it.' },
        { t: 'rand() seeded with the timer count at boot', why: 'The timer value at a given point after reset varies over a small range, so the set of possible keys is small enough to enumerate.' },
        { t: 'SHA-256 of the build date and device serial number, which is unique per device and 256 bits long', why: 'Both inputs are known or guessable to an adversary. Hashing guessable inputs produces a guessable key, however long and unique the output looks.' },
      ] },
    { q: 'A product encrypts stored data with AES-256 and hashes with SHA-256, but its old bootloader verifies firmware with an RSA-1024 signature. How strong is the protection against forged firmware?', kind: 'security',
      choices: [
        { t: 'Roughly 80 bits: RSA-1024 is the only thing authenticating firmware', ok: true, why: 'Each guarantee is as strong as the weakest primitive it depends on. Firmware authenticity depends on the signature scheme and the hash, and the 1024-bit modulus is the weak one.' },
        { t: 'About 256 bits, because AES-256 is the strongest key in the product and protects the image at rest', why: 'The storage cipher takes no part in deciding whether a signature is accepted. A strong primitive elsewhere does not lend its strength to a different guarantee.' },
        { t: 'About 1024 bits, because that is the length of the signing key', why: 'An RSA key is not attacked by trying every key. Factoring the modulus is far cheaper, so the key length overstates the work needed by a wide margin.' },
      ] },
  ],
};

const secureBoot = {
  id: 'sec-a-secure-boot',
  title: 'Secure boot and the chain of trust',
  minutes: 55,
  summary: 'How a device decides, starting from code that cannot be changed, that each stage it is about to run is authentic.',
  skills: ['sec-a-secure-boot'],
  blocks: [
    `## The problem

Your lock verifies a signature on every over-the-air update. A reviewer points out that the SPI flash chip can be lifted with hot air, rewritten on a programmer and soldered back in ten minutes. The update check is never involved. On the next power-up the microcontroller runs whatever is in flash.

Update verification protects the *channel*. It does nothing for the *storage*. To cover storage, the device has to check its own code every time it starts, and that check has to begin somewhere the adversary cannot rewrite. That starting point is the [[Root of trust]], and the sequence of checks that follows is the [[Chain of trust]].`,

    `## What it is

Secure boot is a rule enforced at every reset: **no stage runs until the stage before it has verified its signature against a key the device was provisioned to trust.**

Three ingredients:

1. **Immutable first code.** Mask ROM in the chip, fixed at manufacture. It cannot be reflashed, so it cannot be replaced by the adversary. It is also the one piece that cannot be patched, so it is kept small.
2. **An immutable trust anchor.** A public key, or more often a *digest* of a public key, in [[OTP memory]]. A digest is 32 bytes where an RSA-3072 key is 384, and OTP bits are scarce.
3. **Signed stages.** Each later stage carries a signature over its contents. A stage that stores the digest only also carries the full public key next to the signature; the verifier hashes that key and compares with the anchor before using it.`,

    `## How it works, step by step

1. **Reset.** The CPU starts executing ROM.
2. **ROM reads the second-stage bootloader** from flash into RAM, along with its signature block.
3. **ROM checks the key.** It hashes the public key in the signature block and compares the result with the digest in OTP. A mismatch means this image was signed by someone else: stop.
4. **ROM checks the signature.** It hashes the bootloader image and verifies the signature over that digest with the now-trusted public key. Failure: stop.
5. **ROM jumps to the bootloader.** The bootloader repeats the same pattern for the application: hash the image, verify the signature, check the version against the anti-rollback floor, then jump.
6. **The application** may in turn verify data it loads (configuration, models, scripts).

"Stop" must mean a safe state: no jump to unverified code, no fallback to an unauthenticated loader. What a real ROM does on failure (halt, reset loop, download mode) is chip-specific and belongs in your threat model.`,

    { t: 'widget', name: 'secure-boot-chain', props: { platform: 'generic' }, title: 'Chain of trust: tamper with a stage',
      caption: 'Before you click anything: predict at which stage boot stops if you (a) change one byte of the app, (b) re-sign the app with your own key, (c) install an older correctly signed app. Then try each.' },

    `## Authentication is not integrity

These two words are used loosely and the difference decides whether a boot check is worth anything.

- **[[Firmware integrity]]**: the image matches a reference value. A CRC or hash stored in flash next to the image gives integrity against *accidents*. It is useful, for example to detect a half-written image after power loss.
- **[[Firmware authentication]]**: the image was produced by the holder of a specific private key. Only a signature (or a MAC with a key the adversary cannot obtain) gives this.

A bootloader that checks a CRC and prints "image verified" has integrity checking. Many products have shipped with exactly that and called it secure boot. A further option exists on some chips: a boot-time *hash* check against a digest stored in protected configuration memory. That is stronger than a hash in open flash, because the reference is hard to change, but it pins one exact image and offers no way for the vendor to authorise a new one without rewriting that configuration.`,

    { t: 'predict', q: 'A product has a signed application verified by its bootloader. The bootloader itself lives in ordinary flash and nothing verifies it. The adversary can rewrite external flash. Where does the chain fail?',
      choices: [
        { t: 'At the bootloader: replace it with one that skips the signature check', ok: true, why: 'The first unverified, writable stage is the one the adversary replaces. Everything it would have checked is then unchecked.' },
        { t: 'Nowhere: the app signature still has to be valid', why: 'The signature is only examined by the code that the adversary has just replaced. A check that is not executed protects nothing.' },
        { t: 'At the application: with flash access its signature can be forged and then written back', why: 'No forgery is needed and none is possible without the private key. The adversary removes the checker instead of defeating the check.' },
      ],
      reveal: 'A chain of trust is exactly as strong as the first link that is both writable and unverified. Design reviews should walk the chain from reset and ask of each stage: who verified this, with what key, stored where?' },

    `## On real hardware: ESP32 Secure Boot V2

The facts below are from the ESP-IDF v6.1 documentation sources. They differ between chips, so check the guide for the exact part you are using.

- **Scheme.** Secure Boot V2's default scheme is **RSA-PSS with RSA-3072** keys; that is what the original ESP32, the ESP32-S3 and the ESP32-C3 use. Some newer chips use or also offer ECDSA: ECDSA only on ESP32-C2 and ESP32-C61 (ECDSA-256); a choice of RSA-3072 or ECDSA-256 on ESP32-C6, ESP32-H2 and ESP32-P4; and the ESP32-C5 adds ECDSA-384 to that choice. A device uses one scheme only. The guide's own comparison: P-256 is about as strong as RSA-3072 with a shorter key, but its verification takes considerably longer.
- **Chain.** The ROM bootloader verifies the second-stage bootloader, and the second-stage bootloader verifies the application. The same image format and verification method are used for both.
- **Trust anchor.** A signature block appended to the image carries the public key and the signature; the chip stores the SHA-256 digest of the public key in eFuse.
- **The three checks, in the guide's order.** (1) Hash the public key found in the signature block and compare it with the digest or digests in eFuse; no match, fail. (2) Compute the digest of the image and compare it with the image digest recorded in the signature block; no match, fail. (3) Verify the signature over that digest with the public key (RSA-PSS or ECDSA). Steps 1 and 3 are the generic steps 3 and 4 above.
- **Chip revisions.** On the original ESP32, V2 is available from chip revision **v3.0** onwards, and the menuconfig option only appears when \`CONFIG_ESP32_REV_MIN\` is set to v3.0 or higher. On ESP32-C3 it is available from v0.3 (ECO3).
- **Key slots and revocation.** ESP32 v3.0 stores **one** key digest (eFuse BLK2, with the \`ABS_DONE_1\` eFuse enabling the check), accepts one signature block per image and has no revocation. Chips such as the ESP32-S3 and ESP32-C3 can hold **up to three** digests in key blocks, accept up to three signature blocks, and have one revoke eFuse per digest. The guide says unused digest slots must be revoked before the device leaves the factory, otherwise someone who can write eFuses could add a key of their own.
- **Order matters.** After Secure Boot is enabled, read-protecting further eFuse blocks is blocked by default (so that nobody can read-protect the public-key digest and break the check). Keys that must be read-protected, such as the flash-encryption key, have to be burned before or together with enabling Secure Boot.
- **Secure Boot V1** is the older AES-based scheme for the original ESP32 before chip revision v3.0: a 256-bit AES secure-bootloader key in eFuse BLOCK2, the \`ABS_DONE_0\` eFuse to enable it permanently, and app images signed with an ECDSA key pair. For v3.0 and later, V2 is preferred.

On the original ESP32 the second-stage bootloader sits at flash offset \`0x1000\`; on ESP32-S3, C3 and C6 it is at \`0x0\`. The partition table defaults to \`0x8000\`. Enabling signature verification makes the bootloader larger, and it must still fit before the partition table.`,

    { t: 'widget', name: 'secure-boot-chain', props: { platform: 'esp32' }, title: 'ESP32 chain: ROM, second-stage bootloader, app' },

    { t: 'widget', name: 'boot-sequence', props: { platform: 'esp32' }, title: 'ESP32 boot sequence', caption: 'Step from reset to the application and note what is verified at each stage and by which code.' },

    { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Reporting the security state at start-up (ESP-IDF v6.1). Every call was checked against the v6.1 headers (esp_secure_boot.h and esp_flash_encrypt.h in the bootloader_support component, which the component must list in its REQUIRES); the block was not compiled as a whole or run on a board.',
      code: String.raw`#include "esp_log.h"
#include "esp_secure_boot.h"
#include "esp_flash_encrypt.h"

static const char *TAG = "sec-state";

void log_security_state(void)
{
    /* True when the secure-boot eFuse for this chip has been burned. */
    bool sb = esp_secure_boot_enabled();

    /* True when the flash-encryption counter eFuse says "encrypted". */
    bool fe = esp_flash_encryption_enabled();

    ESP_LOGI(TAG, "secure boot: %s, flash encryption: %s",
             sb ? "ON" : "off", fe ? "ON" : "off");

    if (!sb || !fe) {
        ESP_LOGW(TAG, "this unit is NOT in its production security state");
    }
}`,
      explain: [
        { lines: '10', md: 'Reads the secure-boot enable eFuse of the chip it runs on. A build can have secure boot selected in menuconfig while the unit it is flashed to has never had the eFuse burned; the eFuse is the truth. One catch on the original ESP32: the header picks the V1 or V2 eFuse according to which scheme the *build* selected, and returns false if the build selected neither, so run this check from the production configuration.' },
        { lines: '13', md: 'Reads the flash-encryption counter eFuse (`FLASH_CRYPT_CNT` on the original ESP32, `SPI_BOOT_CRYPT_CNT` on newer chips; lesson 5). For a stricter production check the same headers provide `esp_secure_boot_cfg_verify_release_mode()` and `esp_flash_encryption_cfg_verify_release_mode()`, which compare the whole set of security eFuses with the release configuration and return false if any is missing.' },
        { lines: '18-20', md: 'A factory end-of-line test can look for this line on the console and fail the unit. That turns "we enabled it" into a per-unit measurement.' },
      ] },

    `## What it stops, and how designs that get it wrong fail

Secure boot is meant to stop **persistent modification of code**: rewriting flash out of circuit, a compromised update writing an unsigned image, malware making itself permanent.

Designs fail in a small number of repeatable ways:

| Failure in the design | Why the mechanism no longer holds |
|---|---|
| Secure boot available in the SDK but never enabled on shipped units | Nothing is checked. The most common failure of all. |
| Trust anchor in writable flash | The adversary rewrites the anchor to their own key, then signs their own image. |
| First stage in flash is not verified by ROM | The checker itself can be replaced. |
| Integrity check (CRC, bare hash) mistaken for authentication | The adversary recomputes it. |
| Signature covers the code but not the header (length, version, load address) | Fields the loader acts on can be changed without invalidating the signature. |
| Development or test signing key accepted by production units | Test keys are widely copied and poorly guarded. |
| Fallback path on verification failure | "If verification fails, boot the recovery image" is only safe if the recovery image is verified too. |
| Debug port or ROM download mode left open | Code and keys can be read or changed without going through the boot check at all. Secure boot assumes these are closed. |
| A security outcome that rests on one conditional branch | A fault at the right moment can skip it. This is covered with fault injection in the other half; the design response is redundancy in the check. |

Secure boot also has limits you should state plainly. It does not stop a bug in correctly signed firmware from being exploited at run time, and it does not hide the firmware from someone reading flash. Those are the jobs of memory protection and flash encryption.`,

    { t: 'callout', kind: 'security', title: 'Published example: fault injection against boot verification', md: 'Espressif\'s own vulnerability list records CVE-2023-35818, advisory AR2023-005, "Security Advisory Concerning Bypassing Secure Boot and Flash Encryption Using EMFI", applicable to ESP32 chip revision v3.0/v3.1, for which the advisory offers no immediate mitigation. Revision v3 did add ROM checks against two earlier fault-injection attacks on the original ESP32 (CVE-2019-15894 on the Secure Boot digest check and CVE-2019-17391 on eFuse read protection), but that closed those two attacks, not fault injection as a class: this advisory is about v3 itself. The design lesson is general: a ROM-based chain raises the cost of an attack from "a flash programmer" to "a fault-injection bench and a device to practise on"; it does not make physical attacks impossible. Your threat model should say which side of that line your adversary is on. Read the advisory itself for the details and the vendor\'s recommendations.' },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: enabling secure boot for the first time on the production line', md: 'Secure boot involves irreversible steps: a key digest burned into OTP, and on most chips further bits that lock the configuration. A wrong digest means the unit will never boot your images again. Rehearse the complete flow on development boards you are prepared to lose, with a throwaway key, using the vendor\'s development or reflashable mode where one exists. Script it. Only then generate the production key, in its controlled environment, and run the same script.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: digest in OTP, key in the image', md: '**Chosen:** store a hash of the public key in OTP and ship the key itself in each image\'s signature block. **Alternative 1, full public key in OTP:** needs hundreds of bytes of OTP for RSA; few chips have it. **Alternative 2, public key in ordinary flash:** costs nothing and protects nothing, because the anchor is writable. **Alternative 3, symmetric key in OTP with a MAC over the bootloader** (the shape of ESP32 Secure Boot V1): workable, but the device now holds a secret whose extraction lets an adversary authorise bootloaders for that device, and it must be read-protected. The digest approach keeps only public material on the device. Where the chip allows several key digests, provision more than one so that a key can be revoked later.' },

    `## How you detect that it is missing or misconfigured

You are reviewing your own product or one you have been asked to assess.

- **Read the lifecycle state.** Every vendor provides a way to read the relevant OTP or configuration bits (on Espressif chips, \`idf.py efuse-summary\` or \`espefuse summary\`, which only read; on MSPM0, the NONMAIN boot configuration). The security state is whatever those bits say, not what the build configuration says. On an original ESP32 you are looking for \`ABS_DONE_1\` set and a write-protected digest in BLK2.
- **Read the boot log.** A second-stage bootloader normally reports whether it verified the application. Absence of any verification message is a finding to follow up.
- **Inspect the image.** Is there a signature block? Does the build system have a signing step, and which key does it use? A build that signs with a key stored in the repository is a development configuration.
- **Trace the anchor.** Find where the verifying code gets its public key or digest. If the address is in ordinary flash, the anchor is writable.`,

    `## How to implement it properly

1. Decide the chain on paper: every stage, who verifies it, which key, where the anchor is stored.
2. Generate the production signing key inside the environment that will hold it (see the next lesson). It never touches a developer laptop or the repository.
3. Sign in the release pipeline, not on the factory line. The factory receives signed images and public material only.
4. Make the signed range cover the header: image length, load address, version, hardware revision.
5. Verify before use. No field from an image is acted on until the signature over it has been checked, apart from the minimum needed to find the signature, which is bounds-checked first.
6. On failure, do not run the stage and do not fall back to anything unverified.
7. Close the doors secure boot assumes are closed: debug port and ROM download mode (lesson 7).
8. Provision in the factory with a script that reads back and compares before each irreversible step, and logs the result per serial number.`,

    `## A verification you can run today, with no board

The signing and verifying half of secure boot is ordinary host tooling, so you can watch a signature fail without burning anything. In an ESP-IDF v6.1 shell (so that \`espsecure\` is on the path), in an empty directory:`,

    { t: 'code', lang: 'bash', status: 'reviewed', caption: 'Sign, verify, tamper, verify again with espsecure, the host tool that idf.py calls for its secure-* commands. Subcommands and options were checked against the ESP-IDF v6.1 Secure Boot V2 guide and tools/idf_py_actions/serial_ext.py; the commands were not run in this repository\'s environment. The key is a throwaway: never reuse it for a product.',
      code: String.raw`# 1. A throwaway RSA-3072 signing key (Secure Boot V2 format)
espsecure generate-signing-key --version 2 --scheme rsa3072 test_key.pem

# 2. Something to sign: any file will do for the experiment
head -c 8192 /dev/urandom > image.bin

# 3. Sign it. The tool pads the data and appends a signature block.
espsecure sign-data --version 2 --keyfile test_key.pem --output image_signed.bin image.bin

# 4. Verify, and look at what the signature block contains
espsecure verify-signature --version 2 --keyfile test_key.pem image_signed.bin
espsecure signature-info-v2 image_signed.bin

# 5. Tamper: overwrite one byte in the middle of the signed data, verify again
cp image_signed.bin tampered.bin
printf 'ÿ' | dd of=tampered.bin bs=1 seek=100 conv=notrunc
espsecure verify-signature --version 2 --keyfile test_key.pem tampered.bin

# 6. Wrong key: a second key must not verify the first key's signature
espsecure generate-signing-key --version 2 --scheme rsa3072 other_key.pem
espsecure verify-signature --version 2 --keyfile other_key.pem image_signed.bin`,
      explain: [
        { lines: '8', md: 'Compare the sizes of `image.bin` and `image_signed.bin`. The guide gives the signed format as the data padded to a 4 KB boundary followed by a 4 KB signature block, so you should see 8192 bytes become 12288.' },
        { lines: '12', md: 'The second command prints the public-key digest for the block. That 32-byte value is what would be burned into eFuse: the device never stores the key itself, and never sees the private half at all.' },
        { lines: '15-17', md: 'You should see step 4 report a valid signature and this step report a failure. If a one-byte change (there is a 1-in-256 chance the byte was already 0xFF; pick another offset) still verifies, you are not verifying what you think you are.' },
        { lines: '20-21', md: 'This is step 1 of the ROM\'s check seen from the host: a different key is a different digest. On a device the comparison is against eFuse, so the image would be refused before its signature was even examined.' },
      ] },

    { t: 'callout', kind: 'hw', md: 'To rehearse the device side without spending a chip, the ESP-IDF security guide points to running the security features under QEMU, and the eFuse component has a virtual-eFuse option (`CONFIG_EFUSE_VIRTUAL`) that keeps "burned" values in RAM or flash instead of the real fuses. Both are for learning the flow. A unit with virtual eFuses is not protected, so that option must never reach a production build.' },

    { t: 'exercise',
      prompt: `Write the **verification test list** for secure boot on a product with ROM, a second-stage bootloader and an application. Give at least six tests. For each, state what you change and what you expect to observe. All tests run on development units you own.`,
      hints: [
        'One test per link in the chain, and one per row of the failure table that applies.',
        'Do not forget the positive case: an untouched, correctly signed image must boot.',
        'Think about what is signed besides code: the header fields.',
        'Include a test that checks the state of the unit, not its behaviour.',
      ],
      solution: `A test list that covers the chain:

1. **Positive.** Correctly signed bootloader and app: boots, log reports verification of each stage.
2. **App bit flip.** Change one byte in the middle of the app in flash: bootloader refuses, reports signature failure, does not jump.
3. **App re-signed with a different key.** Valid signature, wrong key: refused at the key-digest or signature step.
4. **Bootloader bit flip.** Change one byte of the second-stage bootloader: ROM refuses; the unit does not reach bootloader log output.
5. **Header tamper.** Change the length or version field without re-signing: refused, proving the header is inside the signed range.
6. **Unsigned image.** Flash an image with no signature block: refused.
7. **Development key.** Image signed with the development key on a production-provisioned unit: refused.
8. **State readback.** Read the OTP/configuration summary and compare against the expected production values, per unit, in the factory test.
9. **Truncated image.** Cut the image short: refused without a crash (the length check runs before the hash).
10. **Recovery path.** Force a verification failure and confirm the device does not enter any mode that accepts unauthenticated code.

Each test is a regression test: run them again whenever the bootloader, the signing pipeline or the partition layout changes.` },

    `## Harder application: other chips, same questions

Take the questions you just answered to a different part. For the MSPM0L2228, TI's SDK documents a *Customer Secure Code* stage based on MCUboot for the MSPM0L122x/L222x family. Per the SDK guide it verifies images with ECDSA P-256 and SHA-256, sets up write, read and IP-protect firewalls, the keystore and a bank-swap policy, and includes rollback protection. TI also states that it "does not guarantee a full secure boot implementation on a device", which is a reminder that an SDK component is a starting point and the chain is yours to complete and test. The device's NONMAIN boot configuration additionally offers a secure-boot application check that can be set to CRC, hash or disabled. The TRM describes the boot configuration routine's own check as a 32-bit CRC of application flash (SLAU847F, section 1.4.2). A CRC has no key, so anyone who can write the application can recompute it: it catches corruption, not a deliberate replacement.

Ask the same questions: what is immutable, where is the anchor, who verifies each stage, what does a CRC-mode app check actually prove, and what is the test for each link? For the MAX78000, this course's fact sheet does not cover its ROM bootloader or secure boot variants; read the security chapter of the device's user guide and answer the same list.`,

    { t: 'widget', name: 'boot-sequence', props: { platform: 'mspm0l2228' }, title: 'MSPM0L2228 boot sequence' },
  ],
  quiz: [
    { q: 'Why must the root of trust be immutable?', kind: 'concept',
      choices: [
        { t: 'Nothing runs before it, so a change to it could never be detected', ok: true, why: 'Every other stage is trusted because something earlier checked it. The first stage has no predecessor, so its trustworthiness has to come from being unchangeable.' },
        { t: 'ROM executes faster than flash', why: 'Execution speed is unrelated. The property that matters is that the adversary cannot rewrite it.' },
        { t: 'It contains the private signing key, which must never be overwritten or read', why: 'A private signing key should never be on the device at all. The device holds public material only.' },
      ] },
    { q: 'A device stores the SHA-256 digest of the vendor\'s public key in OTP, and each image carries the public key plus a signature. An adversary replaces the public key in the image with their own and re-signs the image. What happens?', kind: 'security',
      choices: [
        { t: 'The substituted key does not hash to the OTP digest, so verification stops', ok: true, why: 'The digest binds the device to one specific public key. A different key hashes to a different value.' },
        { t: 'The image is accepted, because its signature is valid for the key it carries', why: 'This would be true only if the device trusted whatever key arrived with the image. The OTP digest exists to prevent exactly that.' },
        { t: 'The image is accepted but flagged in the log', why: 'A chain of trust has no "accept with warning" outcome. A key that does not match the anchor is not trusted for anything.' },
      ] },
    { q: 'According to the ESP-IDF documentation, which statement about Secure Boot V2 on the original ESP32 is correct?', kind: 'arch',
      choices: [
        { t: 'It uses RSA-PSS with RSA-3072 keys and is available from chip revision v3.0 onwards', ok: true, why: 'Both facts are stated in the ESP-IDF Secure Boot V2 guide. Earlier revisions of the original ESP32 use the AES-based V1 scheme.' },
        { t: 'It uses ECDSA P-256 keys and works on every revision of the ESP32', why: 'The guide restricts V2 on the original ESP32 to later chip revisions, and the scheme it gives for that chip is not an elliptic-curve one.' },
        { t: 'It stores the RSA private key in eFuse', why: 'A private signing key is never placed on the device. The eFuse holds a digest of the public key.' },
        { t: 'The ROM verifies the application directly, with no bootloader check', why: 'The ROM verifies the second-stage bootloader; the bootloader is the stage that verifies the application.' },
      ] },
    { q: 'A bootloader computes a CRC-32 over the application and compares it with a value in the image header before jumping. What should the design document call this?', kind: 'concept',
      choices: [
        { t: 'An integrity check against accidental corruption', ok: true, why: 'Anyone can compute a CRC. It is useful after a power-fail during programming, and it says nothing about who made the image.' },
        { t: 'Secure boot', why: 'Secure boot requires that only a key holder can produce an acceptable image. A CRC involves no key.' },
        { t: 'A weak digital signature: authentication with only a 32-bit key', why: 'A CRC is a fixed public function of the data. There is no key of any size.' },
      ] },
    { q: 'Secure boot is enabled and tested. Which of these does it still NOT protect against?', kind: 'security',
      choices: [
        { t: 'A run-time exploit of a memory bug in the correctly signed application', ok: true, why: 'Secure boot checks what is loaded, once, before it runs. What the code does afterwards with hostile input is outside its scope.' },
        { t: 'An unsigned application written to the flash chip with an external programmer', why: 'This is the central case secure boot handles: the image fails verification at the next reset.' },
        { t: 'A modified second-stage bootloader', why: 'The ROM verifies the second-stage bootloader, so a modified one is refused.' },
      ] },
    { q: 'What is the safest order of work when bringing up secure boot on a new product?', kind: 'concept',
      choices: [
        { t: 'Rehearse with a throwaway key on development boards, script it, then run the script with the production key', ok: true, why: 'Irreversible steps should be performed by a script that has already succeeded many times, with read-back checks before each burn.' },
        { t: 'Burn the production key digest on the first prototypes so that all testing uses the real key', why: 'This exposes the production key to the development environment and risks permanently mis-provisioned prototypes before the flow is understood.' },
        { t: 'Enable it by hand on the first production batch and write the script afterwards', why: 'Manual one-way operations on shippable units are how batches get scrapped. The script must exist and be proven first.' },
      ] },
  ],
};

const keyManagement = {
  id: 'sec-a-key-management',
  title: 'Key management and secure key storage',
  minutes: 50,
  summary: 'Which keys exist, where each one lives, how devices get them, and what you do when one leaks.',
  skills: ['sec-a-keys'],
  blocks: [
    `## The problem

A fleet of 40,000 gateways authenticates to the cloud with a key. Every gateway has the same key, compiled into the firmware as a byte array. The firmware image is downloadable from the support site.

Nobody attacked the cipher. The key is simply in a file anyone can fetch, and once it is known it is known for every device, with no way to replace it short of touching each unit.

The cryptography in the previous lessons is only as good as the answers to four questions about every key: **Who has it? Where is it stored? How did it get there? What happens when it leaks?** Key management is the engineering of those answers. NIST SP 800-57 is the standard reference; this lesson applies its ideas to small devices.`,

    `## A key inventory

List every key before choosing where any of them lives. For a typical connected product:

| Key | Type | Who holds the secret part | On the device | If it leaks |
|---|---|---|---|---|
| Firmware signing key | Asymmetric | Release signing system only | Public key or its digest | Adversary can sign firmware for the whole fleet |
| Device identity key | Asymmetric, per device | The device only | Private key | That one device can be impersonated |
| Storage key (flash encryption, record encryption) | Symmetric, per device | The device only | The key, in hardware-protected storage | That one device's stored data can be read |
| Session keys | Symmetric, short-lived | Device and peer | In RAM only | One session |
| Provisioning or factory key | Either | Factory system | Ideally nothing after provisioning | Depends entirely on what it can still do in the field |

Two columns drive the design. "Who holds the secret part" should be as few places as possible. "If it leaks" should be as small as possible for the keys that are easiest to reach.`,

    `## Hierarchy: protect a few keys well, replace the rest cheaply

A [[Key hierarchy]] arranges keys so that the most valuable ones are used least.

- A **root key** is kept offline and used rarely, only to authorise the next level.
- **Intermediate or release keys** sign day-to-day artefacts. If one leaks, the root authorises a replacement and devices are told to stop accepting the old one.
- **Device keys** live in devices and are unique to each.
- **Session keys** are derived per connection and thrown away.

The property you are buying is that the keys most exposed to compromise (in devices, in CI systems) are the ones whose loss is smallest and whose replacement is cheapest.`,

    { t: 'ascii', caption: 'A small hierarchy. Arrows mean "authorises" or "is derived into".', text:
`  ROOT signing key  (offline, in an HSM, used a few times a year)
        |
        | signs
        v
  RELEASE signing key(s) (in the build system's HSM; revocable)
        |
        | signs                      device holds: digest(s) of public key(s) in OTP
        v
  firmware images  ------------------------------------------------>  DEVICE
                                                                       |
  MASTER derivation secret (back end HSM)                              |
        |  KDF(master, device_id)                                      |
        v                                                              v
  per-device key  ---- installed at provisioning ---->  protected storage on device
                                                              |
                                                              | KDF(device_key, "purpose", nonce)
                                                              v
                                                        session / purpose keys (RAM)` },

    `## Per-device keys and derivation

Give each device its own secrets. Then extracting everything from one unit yields that unit and nothing else. There are two ways to get per-device keys.

**Generate on the device.** At first boot in the factory, the device uses its [[TRNG]] to create a key pair. The private key never exists anywhere else. The device exports the public key, and the factory system records it or issues a certificate. This is the strongest option when the chip has protected storage and a good random source.

**Derive from a master secret.** The back end holds a master secret in an HSM and computes \`device_key = KDF(master, device_id)\` with a standard key-derivation function such as HKDF. The factory installs the result. The back end need not store 40,000 keys; it can recompute any of them. The weakness is concentration: the master secret can produce every device key, so it must be guarded like a root key and must never be present on a device or a factory PC.

Derivation is also used *inside* the device, to turn one stored key into separate keys per purpose (\`KDF(device_key, "log-encryption")\`, \`KDF(device_key, "pairing")\`), so that a weakness in one use does not expose the others.

Do not invent the KDF. \`key XOR device_id\` and \`SHA-256(master)\` truncated are not key-derivation functions in any analysed sense. Use the HKDF or CMAC-based KDF in your crypto library.`,

    { t: 'predict', q: 'A product derives each device key as KDF(master, serial_number). To "simplify provisioning", the master secret is compiled into the firmware so each device can compute its own key at first boot. An adversary extracts the firmware from one unit. What have they obtained?',
      choices: [
        { t: 'The master secret, and so the key of every device whose serial they can guess', ok: true, why: 'Derivation only isolates devices if the master stays off them. With the master in the image, per-device keys give no more protection than one shared key.' },
        { t: 'Only that one device\'s key: every unit derives a different key, so the others are unaffected', why: 'The keys differ per device, but the input that generates all of them is in the image. Uniqueness of the output does not help when the generator is exposed.' },
        { t: 'Nothing useful, because a KDF cannot be reversed', why: 'No reversal is needed. The adversary has the master and runs the KDF forwards with any serial number.' },
      ],
      reveal: 'Ask of every design: "what is the most valuable thing present on a single device?" If the answer is a fleet-wide secret, the hierarchy is upside down.' },

    `## Where keys can live on a device

| Location | What protects it | Suitable for | Watch for |
|---|---|---|---|
| Constant in firmware image | Nothing | Public keys only | Anyone with the image has it. Never for secrets. |
| Ordinary flash / NVS in the clear | Whatever protects flash readout (debug lock, read-out protection) | Low-value data | Out-of-circuit readout if the flash is external |
| Encrypted flash region or encrypted NVS | A hardware-held key (next lesson) | Per-device secrets on chips without a key store | The encryption key becomes the thing to protect |
| [[OTP memory]] / eFuse key blocks | Read- and write-protect bits; hardware use without software visibility | Flash-encryption keys, key digests, device-unique seeds | Limited space; one chance to write; software-readable unless read-protected |
| On-chip key store | Hardware isolation: firmware asks for an operation and never sees the key | Device identity, storage keys | Semantics are chip-specific; read the manual |
| [[Secure element]] (separate chip) | Tamper-resistant package; private keys never exported | Device identity, high-value keys | The bus to it can be probed; pair the MCU and the element and authenticate the link |
| RAM only | Lost at power-off | Session keys, derived keys | Clear after use; do not log |

Hardware you will meet in this course: the ESP32 family holds flash-encryption keys in eFuse blocks. The MAX78000's header shows an AES engine with dedicated AES key registers, and the MSDK driver accepts 128-, 192- and 256-bit keys. The MSPM0L2228's peripheral list includes a \`KEYSTORECTL\` module alongside its AES engine, and TI's Customer Secure Code sets up the keystore during boot. TI's datasheet (SLASF94A, sections 8.20 and 8.21) says the AES engine takes 128-bit or 256-bit keys (not 192) and supports GCM, CCM, CBC and CTR, and that the keystore holds up to four AES keys, intended to be loaded during customer secure code so that the AES engine can use them without exposing them to later software. For how keys are loaded and locked on the MSPM0L2228, read the keystore chapter of its technical reference manual. For the MAX78000, what its key registers protect against is a datasheet question this course has not verified.`,

    { t: 'callout', kind: 'decision', title: 'Design decision: where the lock\'s pairing key lives', md: '**Chosen:** a per-device key generated at provisioning, stored in the chip\'s hardware-protected key storage if it has one, otherwise in an encrypted partition whose key is in read-protected OTP. **Not a constant in the image:** fleet-wide exposure from one download. **Not plain external flash:** a clip-on programmer reads it in minutes. **A secure element?** It raises the bar against invasive attack and costs a part, a bus and factory pairing. The threat model decides: for an adversary with a week and one unit, the on-chip option with debug locked and per-device keys already limits the damage to that unit; if the stated adversary has a fault-injection or decapsulation capability and the asset justifies it, add the element.' },

    `## Provisioning at manufacture

Provisioning is the moment keys enter devices, and it is done by a contract manufacturer on equipment you do not operate. Design it as a hostile-ish environment.

1. **The factory gets as little as possible.** Signed firmware, public keys and digests. Not the signing key, not a master derivation secret.
2. **Secrets are generated on the device where the chip allows**, and only the public half leaves.
3. **Where secrets must be injected**, they come from an [[HSM]] or a provisioning service that issues one device's worth at a time, logs every issue against a serial number, and can be rate-limited and audited.
4. **Irreversible steps come last and are scripted**: write keys, read back or verify by use, then burn read/write-protect bits, then lock debug.
5. **Every unit's final state is read back and recorded.** A unit that fails any check is quarantined, not reworked by hand.
6. **Factory test firmware and test keys do not ship.** The last station confirms the production image and production lifecycle state.`,

    `## Rotation and revocation

Assume a key will leak or an algorithm will weaken during the product's life, and decide now what you would do.

- **Rotation** is planned replacement. Session keys rotate every connection. Device identity certificates can be reissued over an authenticated channel. A storage key is hard to rotate because data must be re-encrypted, so keep its scope small.
- **Revocation** makes a key permanently unacceptable. For firmware signing this needs hardware support planned from day one: several key-digest slots in OTP with a revoke bit per slot, so a signed update can retire a compromised key and move the fleet to the next. A device with a single digest slot and no revocation has exactly one signing key for life. Both kinds exist in one product family: per the ESP-IDF Secure Boot V2 guide, the ESP32 at chip revision v3.0 holds one key digest with no revocation, while chips such as the ESP32-S3 and ESP32-C3 hold up to three with a revoke eFuse each, and their unused slots must be revoked before the device leaves the factory so that nobody can add a key later.
- **Anti-rollback** (lesson 6) is part of revocation: after moving to a new key, old images signed by the old key must not be reinstallable.

Write the procedure down before you need it: who decides, how the new key is authorised, how devices learn of it, and what happens to devices that are offline for a year.`,

    `## What must never be in source control or a firmware image

- Private signing keys, of any environment that real devices trust.
- Master derivation secrets.
- Cloud credentials, API tokens, Wi-Fi passwords used in testing.
- A per-device secret pasted into a header "temporarily".
- Debug or factory unlock passwords.

A secret that has been committed is compromised, even if a later commit deletes it, because history keeps it and clones exist. The response is to rotate the key, not to rewrite history and hope.

In course and competition work the same rule applies in miniature. The eCTF reference designs generate deployment secrets with a host tool at build time and inject them into the build (the 2026 flow runs a script that turns a secrets file into a C header before \`make\`). That is acceptable there because the "factory" is the build. Keep the generated secrets file out of the repository.`,

    { t: 'callout', kind: 'mistake', title: 'Common mistake: one signing key for development and production', md: 'Developers need to sign builds dozens of times a day, so the key ends up on laptops, in CI variables and in chat messages. If production devices accept that key, the production trust anchor is effectively public. Use separate keys: a development key that only development-provisioned boards trust, and a production key that exists only in the release signing system. Add a test that a production unit refuses a development-signed image.' },

    `## How you detect key-handling problems

- **Scan the repository and its history** for key material: PEM headers, long hex or base64 constants, files named like keys. Run a secret scanner in CI so new ones are caught at commit time.
- **Scan the release binary.** Search for the byte patterns of known test keys, for PEM strings, and for high-entropy blocks of key-like length in data sections. Any private key or symmetric key in the image is a finding.
- **Compare two devices.** Dump the non-code storage of two units (development units you own). Per-device secrets should differ; identical secret-looking blocks suggest a shared key.
- **Trace each key in the inventory** to its storage location and its protection bits, and read those bits back on a production-configured unit.
- **Review the factory flow** for what the line PC holds, and what a person with access to it could copy.`,

    { t: 'exercise',
      prompt: `The 40,000-gateway product from the start of the lesson is being redesigned. Each gateway must authenticate to the cloud, accept only vendor firmware, and encrypt stored customer Wi-Fi credentials.

Produce the key inventory: for each key give its type, where the secret part lives, how it gets there, and the plan if it leaks. Then name the single most damaging thing a compromised factory PC could do in your design.`,
      hints: [
        'There are at least three keys: one for firmware, one for identity, one for storage.',
        'For identity, can the private key be created where it will be used?',
        'For firmware signing, plan for the day the key leaks: what must already be in the hardware?',
        'For the factory question, list what the PC holds and what it can ask other systems to do.',
      ],
      solution: `**Inventory**

| Key | Type | Secret lives | How it gets there | If it leaks |
|---|---|---|---|---|
| Root signing | Asymmetric | Offline HSM | Generated in the HSM, never exported | Worst case; mitigated by rarity of use and custody controls |
| Release signing (two or more) | Asymmetric | Build-system HSM | Generated in the HSM; public-key digests burned into separate OTP slots at provisioning | Signed update revokes that slot and moves to the next; anti-rollback floor raised |
| Device identity | Asymmetric, per device | On the device, in protected storage | Generated on the device at provisioning; public key exported and certified | Revoke that device's certificate in the back end |
| Storage key | Symmetric, per device | On the device, read-protected OTP or key store | Generated on the device from its TRNG | That device's stored credentials are exposed; customer changes Wi-Fi password |
| Session keys | Symmetric | RAM | Key agreement per connection | One session |

**Factory PC compromise.** In this design the PC holds no private or master keys. The worst it can do is get certificates issued for public keys that did not come from real devices (creating fake identities), or provision units with the wrong digests. Mitigations: the certificate service rate-limits and logs issuance per serial number, and digest values are checked by read-back against a signed manifest. Compare with the original design, where the factory image contained the fleet key.` },

    `## Harder application: a key ceremony on paper

Write a one-page procedure for generating the production release signing key for a five-person company. It must answer: where the key is generated; how many people must be present; where backups are and who can reach them; how a build gets signed (who requests, who approves, what is logged); how you would prove afterwards that no unsigned-off image was ever signed; and what happens when the person who set it up leaves. There is no single right answer. A good one has no step where one person alone, or one stolen laptop, is enough to sign firmware.`,

    { t: 'callout', kind: 'security', title: 'Verification for key management', md: '1. A production unit refuses an image signed with the development key. 2. Two units\' device secrets differ. 3. The release binary and the repository contain no secret key material (automated scan in CI and at release). 4. Read-protect and write-protect bits for key storage read back as set on every unit. 5. A dry run of the revocation procedure has been performed on development units: revoke slot 0, confirm images signed with key 0 are refused and images signed with key 1 boot.' },
  ],
  quiz: [
    { q: 'What is the main reason to give every device its own key instead of one key for the fleet?', kind: 'concept',
      choices: [
        { t: 'Extracting the secrets of one device then compromises only that device', ok: true, why: 'It caps the damage of a successful physical attack at one unit, which changes the economics for an adversary who can buy one.' },
        { t: 'Per-device keys can be longer than a shared key, so each is stronger', why: 'Key length is independent of whether keys are shared. The benefit is isolation, not strength.' },
        { t: 'It removes the need to protect the key in storage', why: 'A per-device key still needs protection: it is that device\'s whole identity or data confidentiality.' },
      ] },
    { q: 'A design derives device keys as HKDF(master, device_id). Where may the master secret exist?', kind: 'security',
      choices: [
        { t: 'Only in a protected back-end system such as an HSM', ok: true, why: 'The master can generate every device key. Its presence on any single device would undo the isolation that derivation is meant to give.' },
        { t: 'In each device\'s OTP, so the device can re-derive its key after a factory reset', why: 'OTP on a device the adversary owns is reachable with enough effort, and what they would find is the fleet secret.' },
        { t: 'In the firmware image, obfuscated with XOR', why: 'Obfuscation delays a reader by minutes. The image is available to anyone with a device or a download link.' },
      ] },
    { q: 'A chip has exactly one OTP slot for a secure-boot key digest and no revocation mechanism. What does that imply?', kind: 'arch',
      choices: [
        { t: 'The product has one firmware signing key for life, so custody of that key matters even more', ok: true, why: 'With no second slot, a leaked signing key cannot be retired on fielded units. The risk has to be managed by custody of the key rather than by rotation.' },
        { t: 'The key can still be rotated: a signed firmware update can carry the new public key to each device', why: 'An update can change code and data in flash, but the anchor that the ROM checks the bootloader against is in OTP and cannot be rewritten.' },
        { t: 'The device cannot use secure boot', why: 'One slot is enough to run secure boot. What is missing is the ability to change keys later.' },
      ] },
    { q: 'A developer removes a committed private key from the repository in the next commit. Is the key safe to keep using?', kind: 'security',
      choices: [
        { t: 'No. It is still in history and in every clone', ok: true, why: 'Version control keeps every past state. Deleting a file changes only the latest tree.' },
        { t: 'Yes, because the current tree no longer contains it and builds never read old commits', why: 'Anyone with a clone or access to history can still retrieve it. The latest tree is not the only thing that exists.' },
        { t: 'Yes, if the repository is private', why: 'Private repositories are read by contractors, CI systems and laptops that get lost. A signing key should never depend on repository access control.' },
      ] },
    { q: 'Which item is acceptable to hand to a contract manufacturer\'s programming station?', kind: 'concept',
      choices: [
        { t: 'Signed firmware images and the public-key digests to burn, since both are public material', ok: true, why: 'These are public material. Their disclosure gives no ability to sign or to derive device secrets.' },
        { t: 'The release signing private key, so the factory can sign the final image', why: 'Signing belongs in the release pipeline. A key on a factory PC is a key in an environment you do not control.' },
        { t: 'The master derivation secret, so the station can compute each device key', why: 'The station would then hold the ability to compute every device\'s key. Issue per-device values from a service instead.' },
      ] },
    { q: 'In a key hierarchy, why is the root key used as rarely as possible?', kind: 'concept',
      choices: [
        { t: 'Each use is an exposure; rare use keeps the frequently used keys replaceable', ok: true, why: 'The root\'s only job is to authorise the next level. Day-to-day signing by lower keys means a compromise there is recoverable.' },
        { t: 'Asymmetric keys wear out after a number of signatures', why: 'Keys do not wear out with use. The concern is exposure of the environment in which the key is used.' },
        { t: 'Root signatures use larger keys and take much longer to verify on the device', why: 'Verification time depends on the algorithm and key size, not on the key\'s position in the hierarchy.' },
      ] },
  ],
};

export default [threatModel, cryptoBlocks, secureBoot, keyManagement];
