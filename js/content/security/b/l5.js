import { C, code, widget, SCOPE } from './util.js';

const UPDATE_CHECK = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define IMG_MAGIC  0x424E4348u      /* identifies this product's image format */
#define SLOT_SIZE  0x38000u         /* size of the application slot in flash  */

typedef struct {
    uint32_t magic;
    uint32_t version;               /* security version, covered by the signature */
    uint32_t length;                /* bytes of code that follow the header        */
} img_hdr_t;

typedef enum { UPD_OK, UPD_BAD_FORMAT, UPD_BAD_SIGNATURE, UPD_ROLLBACK } upd_result_t;

/* Platform: verify the signature over header + body with the public key whose
 * hash is anchored in ROM or fuses. Returns true only for a valid signature. */
bool sig_verify(const img_hdr_t *hdr, const uint8_t *body, const uint8_t *sig);

upd_result_t update_check(const img_hdr_t *hdr, const uint8_t *body, const uint8_t *sig,
                          uint32_t min_version)
{
    if (hdr == NULL || body == NULL || sig == NULL) {
        return UPD_BAD_FORMAT;
    }
    if (hdr->magic != IMG_MAGIC || hdr->length == 0u || hdr->length > SLOT_SIZE) {
        return UPD_BAD_FORMAT;          /* cheap structural checks before any hashing */
    }
    if (!sig_verify(hdr, body, sig)) {
        return UPD_BAD_SIGNATURE;       /* nothing in the header is trusted before this */
    }
    if (hdr->version < min_version) {
        return UPD_ROLLBACK;            /* genuine, but older than this unit may run */
    }
    return UPD_OK;
}
`;

export default {
  id: 'sec-b-boot-update-debug',
  title: 'Insecure bootloaders, update paths and exposed debug interfaces',
  minutes: 55,
  summary: 'The routes by which code and data get into and out of a product: what goes wrong when they are left open, and how to close and test them.',
  skills: ['sec-b-update-review', 'sec-b-debug-lockdown'],
  blocks: [
    `## The problem

An irrigation controller verifies an ECDSA signature on every update. A defect in version 1.0.3 exposed a diagnostic command that prints the key store; version 1.4.2 removed it. A year later, units in the field are found running 1.0.3 again. Nobody broke the signature scheme.

Part A of this section explains how secure boot, signed updates, debug-port locking and flash encryption work. This lesson is the other side: the specific ways those mechanisms are left incomplete, and how you find the gaps in your own design.

## What the weaknesses are

Every product has paths that carry code in and paths that can carry memory out. Each is a weakness when left unauthenticated:

| Path | Weakness when open | CWE |
|---|---|---|
| Boot: ROM → bootloader → application | a stage runs the next without verifying it | CWE-1326, CWE-494 |
| Update: UART, USB, radio, SD card | any image is installed | CWE-494 |
| Update, signed | an **old** signed image is installed ([[Rollback]]) | CWE-1328 |
| [[Serial bootloader]] in ROM | reads or rewrites flash on request | CWE-1191 |
| SWD/JTAG debug port | halts the core, reads and writes all memory | CWE-1191 |
| UART console, test pads | shell or diagnostic commands | CWE-489 |
| The flash chip itself | contents read directly | CWE-312 |

## How they arise

**Unverified stages.** At reset the core starts from a fixed address. Recall the boot sequence from the architecture section: on a Cortex-M the first two words of the vector table give the initial stack pointer and the reset handler. A bootloader that finds an application simply loads those two words from the application's table and jumps. Unless it first checks a signature over the application with a key it trusts, it will jump into anything that occupies the slot. The *chain of trust* is only as long as its first unverified link.

**Verification that covers the wrong bytes.** The signature is checked over the body but the header (length, load address, version) is not signed; or the image is verified in a staging area and then a different copy is executed; or it is verified once at install time and never again at boot.

**Rollback.** A signature says "the vendor built this". It does not say "this is the current version". Every image the vendor ever signed stays valid forever unless the device keeps a minimum acceptable version in storage that an update cannot lower.

**Development keys and test signatures.** An engineering build accepts images signed with a test key that is in the source repository; the acceptance of that key ships.

**Interfaces that were needed yesterday.** The debug port was essential during bring-up. The ROM serial bootloader is how the production line programs the part. The UART console is how field failures are diagnosed. Each is enabled by default on a blank chip, and each stays enabled unless closing it is an explicit, verified step in manufacturing. On Arm cores the debug access port can halt the processor and read any address the processor can, so an open SWD port makes every software check in this course irrelevant.

**Firmware is readable.** Images are distributed as update files, stored in external SPI flash that any programmer can read, and readable through any debug port left open. So anything compiled into the image — strings, keys, PINs, URLs, the code of every check — must be assumed known to an adversary. This is the reason for the rule from lesson 3: a secret that is the same in every image is not a secret.

## How it appears on actual hardware

- **ESP32 family.** Secure Boot V2 has the ROM verify the second-stage bootloader, which verifies the application; flash encryption protects the external flash contents. Both are off until enabled by programming eFuses (ESP-IDF security documentation; part A covers the procedure).
- **MSPM0L2228** (2026 eCTF MCU). The NONMAIN boot configuration exposed in TI's SDK includes debug access (enabled, enabled with password, or disabled), SWD port enable, bootstrap-loader options, and mass-erase and factory-reset policy. These are configuration words programmed with the image; check TI's documentation for the exact semantics of each setting before relying on one.
- **MAX78000** (2024 and 2025 eCTF MCU). Check the device user guide for its debug-lock and ROM bootloader options; this course does not state them.

In every case the pattern is the same: the secure setting exists, it is not the default, and some settings are irreversible, so teams postpone them — sometimes past shipment.

## What an adversary gains

- From **unauthenticated boot or update**: arbitrary code on the device, which means every key the device can use and every action it can take. Condition: access to the update channel or to the flash.
- From **rollback**: the vulnerabilities of an old version, with a genuine signature. Condition: a copy of the old image, which update servers and archives provide.
- From an **open debug port or serial bootloader**: the whole image and the RAM contents, including keys, and the ability to alter them. Condition: physical access to pads on the board.
- From a **readable image**: every embedded secret, and a map of where to look for the other weaknesses in this half of the section.`,
    { t: 'callout', kind: 'sim', md: SCOPE },
    widget('secure-boot-chain', { platform: 'generic' }, 'Start with secure boot off and tamper with the application; see what the chain does. Turn secure boot on and repeat. Then, with anti-rollback off, install an older signed version.'),
    { t: 'predict', q: 'A device has secure boot enabled and accepts only images signed by the vendor. Anti-rollback is not implemented. Version 1.0.3, signed by the vendor two years ago, contained a diagnostic command that prints stored keys. The device runs 1.4.2. What happens when it is offered the 1.0.3 image?', choices: [
      { t: 'It verifies the signature, which is valid, installs 1.0.3 and the diagnostic command is back', ok: true, why: 'The signature answers "who built this", and the vendor did. Nothing in the check compares versions.' },
      { t: 'It rejects the image because the signature has expired', why: 'A signature is a mathematical relation between the image and the key and has no built-in lifetime. Expiry would need a trusted clock and a signed date, which small devices rarely have.' },
      { t: 'It rejects the image because secure boot only allows the newest version', why: 'Secure boot checks authenticity. Knowing which version is newest requires state that this device does not keep.' },
      { t: 'It installs 1.0.3 but the removed command stays removed', why: 'The command was removed by changing the code. The old image is the old code.' },
    ], reveal: 'Try it on the simulated updater below: its catalogue contains several signed images.' },
    widget('vuln-device', { device: 'rollback-updater' }, 'The updater checks signatures correctly. Read the release notes of each image in the catalogue before deciding what to try, and note which of the rejected images are rejected for the right reason.'),
    `### Debrief

The updater rejected the unsigned image and the image signed with the engineering key, as it should. It accepted an older release because "signed" was the only question it asked. The fix has two parts: the version must be inside the signed data, and the device must hold a minimum version that only moves up.

Now the other direction: what can be learned from an image.`,
    widget('firmware-inspector', { image: 'lockbox' }, 'A raw dump of a fictional keypad lock, as it would come from an update file or a flash chip. Use the strings and hex views to complete the tasks.'),
    `The service credential was a string constant. No disassembly was needed. Compare with the \`updater\` image in the Workbench: it contains a *public* key, which is meant to be public, and finding it gives an adversary nothing — provided the device cannot be made to replace it.

## How a team detects these

**Review questions:**

- Draw the boot chain. For each arrow: what is verified, over which bytes, with which key, and where is that key anchored? Is the first stage immutable?
- Is the image verified at install time, at every boot, or both? Between verification and execution, can the bytes change?
- Which keys does the release bootloader accept? Is any of them a development key?
- Where is the minimum version stored? Can the update process, or a flash programmer, lower it? When is it raised?
- List every physical interface, including unpopulated headers and test pads. For each: state in development, state in production, how the change is made, and how it is checked.
- If a stranger had the complete firmware image, what would they learn that they should not?

**Tests and measurements:**

- Offer the device a modified image, an unsigned image, an image signed with the development key, a truncated image, and each previously released image.
- On a production-configured unit of your own, attempt a debug connection and a ROM bootloader connection; both must fail in the way the vendor documents.
- Run \`strings\` and an entropy scan over the release image; search for key-shaped constants.
- Probe the console UART on a production unit: is there output at boot? Does it accept input?

## The defences

Part A describes the mechanisms. The review checklist, in dependency order:

1. **An immutable root** (ROM or write-protected first stage) holding or anchoring the verification key.
2. **Every stage verifies the next, every boot**, over header and body together.
3. **Structural checks, then signature, then version**, and only then any use of the image:`,
    code(UPDATE_CHECK, 'host-tested', { caption: 'Order of acceptance checks for an update image. Tested on the host with a stub sig_verify: bad magic, zero and oversized length, bad signature, older, equal and newer versions.', explain: [
      { lines: '26-28', md: 'Length is bounded by the slot before it is used for anything, including the hash. An unbounded length would make the verifier itself read outside the image (lessons 1 and 2).' },
      { lines: '29-31', md: 'The signature covers the header as well as the body, so `version` and `length` are trustworthy after this line and not before.' },
      { lines: '32-34', md: 'The rollback test uses the signed version. `min_version` comes from storage that an update cannot rewrite: one-time-programmable fuses or a protected flash region. Equal versions are accepted so that a unit can be re-flashed with the same release.' },
    ] }),
    `4. **Raise the minimum version only after the new image has booted and confirmed itself.** Raising it at install time turns a bad release into a permanently dead unit.
5. **Production keys only** in production bootloaders; fail the release build if a development key is present.
6. **Close or authenticate every service interface** as a manufacturing step: debug port, ROM bootloader, console. Where field diagnosis is needed, prefer an authenticated unlock tied to the individual device (challenge–response, lesson 4) over a port left open.
7. **No secrets in the image.** Per-device secrets go into protected storage at provisioning. Encrypt external flash where the platform supports it, with a key that never leaves the chip.`,
    { t: 'callout', kind: 'mistake', title: 'Treating "we removed the header" as closing the debug port', md: `Leaving connector J3 unpopulated, or removing the pull-up from a boot-select pin, changes how much soldering is needed, not whether the interface works. The pads are still on the board and the port is still enabled in silicon. Only the chip's own lock setting closes it, and only a connection attempt on a production unit proves that the setting was applied.` },
    { t: 'callout', kind: 'decision', title: 'Disable debug permanently, or keep an authenticated way back in?', md: `Permanent disable is the strongest setting and the simplest to reason about; it also means a returned unit cannot be examined, and a mistake on the production line cannot be undone. A password- or key-authenticated debug unlock (where the chip offers one) keeps failure analysis possible, but the credential must be per device, or the first leak opens the fleet, and the unlock logic becomes one more thing to protect against the fault attacks of lesson 7. For products holding secrets that matter after the sale, such as payment keys or content keys, disable permanently and design diagnostics into the application. For products where field repair matters more, use the authenticated option and erase secrets as part of the unlock.` },
    `## Verifying the defences

- A test matrix run on every release candidate: {valid, modified body, modified header, unsigned, development-signed, truncated, oversized length} × {current, older, newer version}, with the expected result for each cell written down beforehand.
- Power-fail tests during update: remove power at random points and confirm the unit boots either the old or the new image, never neither and never an unverified mixture.
- An end-of-line check on each manufactured unit that reads back the lock configuration, plus a periodic sample audit with a debug probe.
- A CI job that scans the release image for development keys, credentials and factory strings.
- After a field update that raises the minimum version: offer the previous release and expect a rollback rejection.`,
    { t: 'exercise', prompt: `Review this bootloader fragment. It runs at every reset. List the defects and say what each allows; then write the corrected order of operations in words or pseudocode.`, code: C`
void boot(void)
{
    const img_hdr_t *hdr = (const img_hdr_t *)APP_SLOT;

    if (uart_break_detected()) {
        serial_loader();                /* receive and flash a new image */
    }
    if (hdr->magic != IMG_MAGIC) {
        serial_loader();
    }
    if (hdr->flags & FLAG_VERIFIED) {   /* set by the updater after checking */
        jump_to(APP_SLOT + sizeof *hdr);
    }
    if (sig_verify(hdr, body_of(hdr), sig_of(hdr))) {
        jump_to(APP_SLOT + sizeof *hdr);
    }
    serial_loader();
}`, hints: [
      'Who can cause each call to `serial_loader()`, and what does that function check before writing flash?',
      'Where is the "verified" flag stored? Who can write that location?',
      'What does this code know about the version of the image?',
    ], solution: `1. **Unauthenticated serial loader reachable by anyone with the UART** — a break condition on the line, or a corrupted magic, enters a mode that flashes whatever is sent. Unless \`serial_loader\` itself verifies images before committing them, this is unauthenticated code installation; even if it does, the entry should be a deliberate production decision.
2. **"Verified" flag stored in the image header** — the flag lives in the same flash the adversary can write (through the loader or a programmer). Setting one bit skips verification completely. Verification results must not be cached in attacker-writable storage; verify at every boot.
3. **Is the header covered by the signature?** If \`flags\` is under the signature, the updater cannot set it afterwards; if it is not, it is unauthenticated. Either way the design is inconsistent.
4. **No rollback check.**
5. **Fail-open structure** — every failure path ends in a mode that accepts new code, and success is reached by several independent \`if\`s, each a single branch (lesson 7 returns to this).
6. \`sig_of(hdr)\` and \`body_of(hdr)\` use \`hdr->length\` before it has been bounded.

**Corrected order:** bound the header fields against the slot → verify the signature over header and body with the anchored key → compare the signed version with the protected minimum → jump. On any failure: stay in a state that accepts only an authenticated update, signalled by a status LED or message, and never a state that accepts arbitrary code. Enter the loader on request only if the loader applies the same checks before committing an image.` },
    `## Harder application

For the 2026 eCTF reference design, the linker script places a MITRE bootloader in the first 0x6000 bytes of flash and the team's firmware after it, and notes that the file allocation table address is fixed because the bootloader must know it. Using only that, list the questions you would need answered about that bootloader before you could say what your firmware may assume at start-up (what was verified, what state the debug port is in, what the bootloader leaves in RAM). Where would you look for each answer? Do not guess: the competition's own documentation is the source.`,
    { t: 'refs', items: [
      { title: 'CWE-494: Download of Code Without Integrity Check', url: 'https://cwe.mitre.org/data/definitions/494.html' },
      { title: 'CWE-1328: Security Version Number Mutable to Older Versions', url: 'https://cwe.mitre.org/data/definitions/1328.html' },
      { title: 'CWE-1191: On-Chip Debug and Test Interface With Improper Access Control', url: 'https://cwe.mitre.org/data/definitions/1191.html' },
      { title: 'ESP-IDF v6.1: Secure Boot V2', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst' },
      { title: 'TI MSPM0 SDK: boot_config.h for LP_MSPM0L2228 (NONMAIN options)', url: 'https://github.com/TexasInstruments/mspm0-sdk/blob/main/examples/nortos/LP_MSPM0L2228/boot_manager/customer_secure_image_with_bootloader/boot_config.h' },
      { title: 'MITRE eCTF 2026 insecure example design', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example' },
    ] },
  ],
  quiz: [
    { q: 'A bootloader verifies an ECDSA signature over the application body. The header, which holds the body length and the entry offset, is not covered. What can go wrong?', kind: 'security', choices: [
      { t: 'The header can be altered so that the verified region and the executed region differ, for example by changing the entry offset', ok: true, why: 'Fields outside the signature are attacker-controlled. If they influence what is hashed or where execution starts, the signature no longer protects what runs.' },
      { t: 'Nothing: the code itself is signed, and the header contains no code', why: 'The header decides which bytes count as "the code" and where execution begins, so it is as security-relevant as the code.' },
      { t: 'The signature becomes invalid whenever the header changes', why: 'That would be the desired behaviour, and it only happens if the header is part of the signed data.' },
      { t: 'ECDSA cannot sign data whose length is in a separate header', why: 'The algorithm signs a hash and has no knowledge of file formats. Coverage is a design decision.' },
    ] },
    { q: 'Where should a device keep the minimum firmware version used for rollback protection?', kind: 'arch', choices: [
      { t: 'In one-time-programmable fuses or a flash region that only the verified boot stage can write, and that an update image cannot contain', ok: true, why: 'The value must survive any update and any reflash of the application area, and must only ever increase.' },
      { t: 'In the header of the currently installed image', why: 'That header is replaced by the image being installed, so the incoming image would be supplying the limit it is checked against.' },
      { t: 'In a RAM variable initialised by the application', why: 'RAM is lost at every reset, which is exactly when the bootloader needs the value.' },
      { t: 'On the update server only', why: 'The server can refuse to offer old images, but the device must also refuse images that arrive by another route.' },
    ] },
    { q: 'A product ships with SWD pads unpopulated and the debug port left enabled in the chip configuration. How should a reviewer rate this?', kind: 'security', choices: [
      { t: 'As an open debug interface: anyone who opens the case can attach to the pads, halt the core and read flash and RAM', ok: true, why: 'Access control is a property of the chip setting. A missing connector is a matter of a few minutes with a soldering iron or spring probes.' },
      { t: 'As closed, because no connector is fitted', why: 'The electrical interface is the pads and the silicon behind them. A connector is only a convenience.' },
      { t: 'As low risk, because SWD requires the vendor\'s proprietary software', why: 'SWD is a documented Arm interface supported by open-source tools and inexpensive probes.' },
      { t: 'As acceptable if the firmware disables the SWD pins after start-up', why: 'Firmware-applied settings take effect only after the firmware runs, and a debugger can attach under reset before then.' },
    ] },
    { q: 'An engineer proposes hiding an API key in the firmware by XOR-ing it with a constant, "so it does not show up in `strings`". What is the correct response?', kind: 'security', choices: [
      { t: 'The image also contains the constant and the code that undoes the XOR, so anyone with the image can recover the key; it must be a per-device secret in protected storage instead', ok: true, why: 'Obscuring a value inside the same image that reveals how to recover it raises the effort slightly and changes nothing about who can do it.' },
      { t: 'It is sufficient, because the key no longer appears as readable text', why: 'Readable text is only the easiest way to find a constant. The decoding routine in the same image leads straight to it.' },
      { t: 'It is sufficient if the XOR constant is 32 bits or longer', why: 'The length of the constant does not matter when the constant is stored next to the data it protects.' },
      { t: 'It would be sufficient with AES instead of XOR, with the AES key in the firmware', why: 'A stronger cipher with its key in the same image has the same flaw: everything needed to decrypt is in one place.' },
    ] },
    { q: 'Which update test most directly checks rollback protection?', kind: 'code', choices: [
      { t: 'Update to a release that raises the minimum version, let it boot and confirm, then offer the previous signed release and expect rejection', ok: true, why: 'It exercises the full mechanism: the minimum is raised by a real update, and a genuinely signed older image is then refused.' },
      { t: 'Offer an unsigned image and expect rejection', why: 'That tests signature verification. A rollback image carries a valid signature.' },
      { t: 'Offer the current version again and expect rejection', why: 'Reinstalling the same version is normally permitted and reveals nothing about older ones.' },
      { t: 'Offer a newer image and expect acceptance', why: 'That is the normal update path and passes with or without rollback protection.' },
    ] },
    { q: 'A bootloader stores "image verified = 1" in a flash word after a successful install and, on later boots, skips signature verification when the word is 1 to save 200 ms. What is the weakness?', kind: 'arch', choices: [
      { t: 'Anything that can write flash — the update path, a programmer on the flash chip, a fault during the check — can set the word or change the image afterwards, and the image will run unverified', ok: true, why: 'A cached verdict is only as trustworthy as the storage it is in, and it says nothing about changes made after it was written.' },
      { t: 'Flash words can only be written once, so the flag cannot be cleared for the next update', why: 'Flash can be erased and rewritten; the problem is the opposite, that the flag is too easy to set.' },
      { t: 'There is none: the image was verified when it was installed', why: 'Verification at install time speaks for the bytes as they were then. Boot-time verification speaks for the bytes about to be executed.' },
      { t: 'Skipping verification makes the boot time vary, which is a timing side channel', why: 'Boot duration here reveals only the flag, which is not a secret. The issue is that verification can be switched off.' },
    ] },
  ],
};
export const TESTED = { UPDATE_CHECK };
