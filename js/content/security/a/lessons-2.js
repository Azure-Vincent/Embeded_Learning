// Security part A, lessons 5-8: data at rest, secure updates, debug and memory protection, security lifecycle.
import { VERSION_CHECK, IMG_HEADER, SLOT_SELECT, CHECKED_COPY,
  CLAB_VER_STARTER, CLAB_VER_SOLUTION, CLAB_LEN_STARTER, CLAB_LEN_SOLUTION } from './code.js';

const dataAtRest = {
  id: 'sec-a-data-at-rest',
  title: 'Flash encryption and protecting data at rest',
  minutes: 45,
  summary: 'What encrypting flash does and does not achieve, how ESP32 chips do it, and why confidentiality without integrity is half a mechanism.',
  skills: ['sec-a-data-rest'],
  blocks: [
    `## The problem

A Wi-Fi sensor stores the customer's network password in flash. The module uses an external SPI flash chip, as most ESP32 modules do. A returned unit ends up on a resale site. Whoever buys it can clip onto the flash chip, read every byte in under a minute, and search the dump for the SSID.

Secure boot does not help: it checks code, and it hides nothing. Locking the debug port does not help: the flash chip is a separate part with its own pins. The property you need is that the bytes on the chip are meaningless without something the reader does not have. That is encryption of data at rest, and its whole value depends on where the key is.`,

    `## What it is

[[Flash encryption]] stores ciphertext in flash and decrypts it transparently when the processor reads it. The key is held inside the microcontroller, in storage that software and debug tools cannot read. A direct read of the flash chip returns ciphertext.

**How it works at hardware level.** Between the CPU's memory-mapped view of flash and the SPI flash controller sits a decryption block. When code executes from flash or reads a mapped address, the block decrypts each cipher block using the key from OTP and a *tweak* derived from the block's flash offset. The tweak makes identical plaintext at two different addresses encrypt differently. Writes go through an encrypting path. The key itself is burned into OTP, then read-protected so that only the hardware block can use it.

Two properties of this arrangement shape everything else:

- **No expansion.** Ciphertext is exactly the size of plaintext, so every flash address still maps one-to-one. There is no room for a per-block authentication tag.
- **Deterministic per address.** Writing the same plaintext to the same address under the same key produces the same ciphertext.`,

    `## On real hardware: ESP32 flash encryption

From the ESP-IDF v6.1 flash encryption guide. The scheme differs between chip generations.

**Original ESP32.** Not XTS. It uses AES-256 with the key stored in the \`flash_encryption\` eFuse (BLOCK1). Each 32-byte block (two AES blocks) is encrypted with a key derived by XORing the main key with the block's flash offset (the "key tweak", controlled by the \`FLASH_CRYPT_CONFIG\` eFuse, recommended value \`0xF\`). The enable state is held in the \`FLASH_CRYPT_CNT\` eFuse: 7 bits, and an odd number of set bits means encryption is on. If the chip uses the 3/4 eFuse coding scheme, the key block is 192 bits.

**Newer chips.** [[XTS-AES]] as defined in IEEE Std 1619-2007. Chips such as the ESP32-S3 support a 256-bit or 512-bit key (named XTS_AES_128 and XTS_AES_256). Chips such as the ESP32-C3 and ESP32-C6 support the 256-bit key only (XTS_AES_128). The key is burned into one of the \`BLOCK_KEYN\` eFuses with a key-purpose eFuse that tells the hardware what it is for, and the counter eFuse is \`SPI_BOOT_CRYPT_CNT\`.

The naming is a trap worth noticing: XTS uses two keys, so "XTS_AES_128" has a 256-bit key block and "XTS_AES_256" a 512-bit one.

On the original ESP32 the offset tweak changes per 32-byte block, not per 16-byte AES block. The guide lists the consequence as a limitation: if the two 16-byte halves of one 32-byte block hold identical plaintext, their ciphertexts are identical too, so an observer can tell. Do not store secrets in a layout where that pattern carries information.

**How it gets switched on.** You flash plaintext. On the first boot the second-stage bootloader generates the key with the hardware RNG (unless you burned one yourself), writes it to eFuse with read and write protection, encrypts the flash in place, and sets the first bit of the counter eFuse. Encrypted by default: the second-stage bootloader, the partition table, the NVS key partition, otadata and every \`app\` partition. Any other partition is encrypted only if it carries the \`encrypted\` flag in the partition table. The \`nvs\` partition cannot use flash encryption at all (see below).

**Development and release modes.** The mode is a build option (\`CONFIG_SECURE_FLASH_ENCRYPTION_MODE\`, development by default) that decides which further eFuses the bootloader burns on that first boot. The guide states the difference like this:

| | Development mode | Release mode |
|---|---|---|
| Purpose | "Recommended for use only during development" | "Recommended for manufacturing and production" |
| Flashing plaintext over UART | Still possible: the ROM download mode accepts a new plaintext image and the bootloader encrypts it with the key in hardware. The guide notes that this "allows, indirectly, to read out the plaintext of the firmware in flash" | "Flashing plaintext firmware to the device without knowing the encryption key is no longer possible" |
| Original ESP32 eFuses | \`DISABLE_DL_DECRYPT\` and \`DISABLE_DL_CACHE\` set; \`FLASH_CRYPT_CNT\` left writable | Those two plus \`DISABLE_DL_ENCRYPT\`; \`FLASH_CRYPT_CNT\` write-protected |
| Newer chips (S3, C3, C6) | Download-mode cache access and JTAG disabled by default; \`SPI_BOOT_CRYPT_CNT\` left writable | Everything development mode sets, plus \`DIS_DOWNLOAD_MANUAL_ENCRYPT\`; \`SPI_BOOT_CRYPT_CNT\` write-protected |

Why development mode is not protection: whoever holds the board can put it in download mode and flash a plaintext program of their own. The chip encrypts it and runs it, and code running on the chip reads the rest of the flash already decrypted. No key was learned and none was needed. Release mode removes the ROM's encrypt-on-download path and freezes the counter, so the only way to change an encrypted app is an OTA update (or pre-encrypting on the host with a key you kept, which is its own key-management decision). The guide's own words: "For production use, flash encryption should be enabled in the release mode only."

On every platform the principle is the same: the convenient mode keeps a door open, and a product shipped in it is not protected.`,

    { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Checking the flash-encryption mode at start-up (ESP-IDF v6.1). Every call, type and constant was checked against esp_flash_encrypt.h in the v6.1 bootloader_support component; the block was not compiled as a whole or run on a board.',
      code: String.raw`#include "esp_log.h"
#include "esp_flash_encrypt.h"

static const char *TAG = "fe-state";

bool flash_encryption_is_production(void)
{
    if (!esp_flash_encryption_enabled()) {
        ESP_LOGE(TAG, "flash encryption is OFF");
        return false;
    }
    esp_flash_enc_mode_t mode = esp_get_flash_encryption_mode();
    if (mode != ESP_FLASH_ENC_MODE_RELEASE) {
        ESP_LOGE(TAG, "flash encryption is in development mode");
        return false;
    }
    return true;
}`,
      explain: [
        { lines: '8', md: 'Reads the counter eFuse. This is the state of the silicon, independent of how the firmware was configured at build time.' },
        { lines: '12-16', md: '`esp_get_flash_encryption_mode()` reads eFuses too: it reports release only when the counter eFuse is write-protected (or completely used up) **and** the download-mode disable bits for this chip are set. A unit that is encrypted but still in development mode has an open path by design, so a factory end-of-line test should refuse to pass it. The same header offers `esp_flash_encryption_cfg_verify_release_mode()`, which checks the full set of release-mode eFuses and logs each one that is missing.' },
      ] },

    `## What it stops, and what it does not

Meant to stop: reading firmware and stored secrets from the flash chip, cloning a device by copying its flash to another unit (each chip has its own key, so the copy decrypts to noise), and casual reverse engineering from a dump.

It does **not** give authenticity. This is the limit of encryption without integrity, and designs that forget it fail in predictable ways:

| What the adversary can still do | Why |
|---|---|
| **Corrupt chosen blocks.** Overwriting a ciphertext block makes it decrypt to unpredictable bytes. | No tag detects the change. If the block held a "locked" flag or a retry counter, unpredictable might be good enough for them. |
| **Replay old contents.** Copy the ciphertext of a region now, restore it later. | The same key and address decrypt it correctly again. A used-up PIN retry counter or a revoked permission returns. |
| **Compare.** See *which* blocks changed between two dumps, and whether a block returned to an earlier value. | Encryption is deterministic per address. |
| **Read it through the device.** A debug port, a console command or a firmware bug that prints memory returns plaintext. | The device decrypts for anything running on it. |

So flash encryption is paired with other mechanisms, never used alone: **secure boot** provides authenticity of code; an **authenticated record format** provides integrity of data; a **monotonic counter** outside the replayable region provides freshness; **debug and download-mode lockdown** closes the plaintext paths.`,

    { t: 'predict', q: 'A device with flash encryption (no secure boot) stores "failed PIN attempts" in an encrypted flash record and locks permanently at 5. An adversary can read and write the external flash chip but cannot decrypt it. How could the limit be defeated?',
      choices: [
        { t: 'Save the record\'s ciphertext while the count is 0 and write it back every few attempts', ok: true, why: 'The old ciphertext is still valid at that address under that key. Encryption gave confidentiality of the counter, which was never the property that mattered; the counter needed freshness.' },
        { t: 'It cannot be defeated: the adversary can neither read the counter nor produce a valid ciphertext for a lower value', why: 'Neither reading nor producing anything is necessary. Restoring a previous state requires only copying bytes, not understanding them.' },
        { t: 'By decrypting the record with the flash offset, which is the tweak', why: 'The tweak is public and is only one input. Without the key in eFuse nothing can be decrypted.' },
      ],
      reveal: 'Ask of every stored value which guarantee it needs. A retry counter needs to be un-rewindable: keep it in monotonic storage, or bind the record to a counter that is. A password needs confidentiality. A configuration flag needs integrity. They are different requirements with different mechanisms.' },

    `## Encrypted key-value storage

Application data usually lives in a key-value store or a small filesystem rather than at fixed raw addresses. ESP-IDF's NVS has its own encryption option because the way NVS updates entries does not suit whole-partition flash encryption; NVS encryption protects entries with its own keys, and those keys must themselves be protected (ESP-IDF documents a scheme that keeps them in a partition covered by flash encryption, and on newer chips an alternative based on a hardware-held key). Read the "NVS encryption" page for your chip and version for the exact options.

The design question is the same on any platform: **what encrypts the records, where is that key, and is each record authenticated?** If your storage layer does not authenticate records, add it yourself for the values that matter: store \`nonce || ciphertext || tag\` using an [[AEAD]] with a device-held key, and put the record's name and a version number in the associated data so a valid record cannot be moved to a different name or replaced with an older one unnoticed.`,

    { t: 'ascii', caption: 'A self-protecting record. The associated data is authenticated but not secret; it binds the ciphertext to its purpose and version.', text:
`  +---------+-----------+---------------------+----------+
  | version | nonce(12) | ciphertext (n)      | tag (16) |
  +---------+-----------+---------------------+----------+
       ^         ^                 ^               ^
       |         |                 |               +-- computed over AD + ciphertext
       |         |                 +-- AEAD(key, nonce, plaintext, AD)
       |         +-- unique per write under this key
       +-- also inside AD, with the record name:
           AD = "wifi.psk" || version

  on read:  recompute and check tag  ->  fail: treat record as absent
            version < stored floor   ->  fail: stale record` },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: treating "encrypted" as "tamper-proof"', md: 'A design note says "configuration is stored encrypted, so it cannot be modified". Encryption without authentication is malleable: the adversary cannot choose what the bytes become, but they can make them *different*, or make them *what they were last week*. If the firmware\'s response to a corrupt configuration block is "fall back to factory defaults" and the defaults include an open pairing mode, a random overwrite is a useful tool.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: whole-flash encryption, record-level AEAD, or both', md: '**Whole-flash encryption** protects everything including code, costs no flash space, and is transparent to the application, but gives no integrity and its key and configuration are one-way OTP decisions. **Record-level AEAD** gives integrity and confidentiality for the records you choose, costs a nonce and tag per record and some code, and works on chips with no flash-encryption hardware. **Both** is the usual answer for a product that stores credentials on external flash: flash encryption so a dump reveals nothing and clones do not work, secure boot so code is authentic, and authenticated records with a version for the handful of values where rollback or corruption would matter. If your MCU has only internal flash and a locked debug port, record-level AEAD alone may satisfy the threat model.' },

    `## How you detect that it is missing or misconfigured

On units you own:

- **Read the lifecycle bits.** The counter eFuse and the mode tell you whether encryption is on and whether the development paths are closed. On Espressif chips \`idf.py efuse-summary\` (read-only) shows them: an odd number of bits set in \`FLASH_CRYPT_CNT\` / \`SPI_BOOT_CRYPT_CNT\` means encrypted, and in release mode that field is write-protected and the download-mode encrypt bit (\`DISABLE_DL_ENCRYPT\` or \`DIS_DOWNLOAD_MANUAL_ENCRYPT\`) is set.
- **Dump the flash and look.** Run a strings search and an entropy estimate over the dump of a test unit. Readable strings (your log messages, an SSID you provisioned) mean that region is plaintext. Encrypted regions look uniformly random. The \`firmware-inspector\` tool in this app lets you practise that on synthetic images.
- **Check partition by partition.** It is common for the application to be encrypted while a data partition is not, because a flag was missed in the partition table.
- **Write a known marker** through the application, dump the flash, and search for it.
- **Look for plaintext paths:** an open debug port, a console command that dumps memory, a download mode that still reads flash.`,

    `## How to implement it properly

1. From the threat model, list each stored item and the guarantee it needs: confidentiality, integrity, freshness.
2. Choose mechanisms per item. Do not rely on one mechanism for a guarantee it does not give.
3. Let the device generate its own flash-encryption key from its TRNG where the platform supports that, so the key never exists outside the chip.
4. Enable flash encryption **together with** secure boot, and follow the vendor's documented order for enabling the pair.
5. Rehearse in development mode on boards you can lose. Then script the release-mode flow.
6. Mark every partition that holds sensitive data as encrypted, and review the partition table as a security artefact.
7. For values that need integrity or freshness, use authenticated records and a monotonic counter.
8. Close the plaintext paths (lesson 7).
9. Plan the consequences: after release mode, the serial flashing path is restricted, so your update mechanism must already work.`,

    { t: 'exercise',
      prompt: `A door controller stores these items in external flash. For each, state which of confidentiality, integrity and freshness it needs, and the mechanism you would use.

1. The application firmware.
2. The list of authorised card IDs (not secret; printed on the cards).
3. The administrator PIN verifier.
4. The count of consecutive failed PIN attempts.
5. The access log.`,
      hints: [
        'For each item ask separately: does it hurt if this is read? Changed? Rolled back to an old value?',
        'Card IDs are public in this product. What would an adversary want to do to the list?',
        'Item 4 was the subject of the prediction above.',
        'For the log, think about who relies on it afterwards and what they need to trust.',
      ],
      solution: `1. **Firmware:** integrity and authenticity (secure boot); confidentiality only if the code itself is worth hiding, or to slow down analysis by someone holding a unit (flash encryption); freshness (anti-rollback).
2. **Card list:** integrity and freshness, not confidentiality. An adversary wants to *add* an ID or restore a list from before a card was revoked. Authenticated record with a version bound to a monotonic counter.
3. **PIN verifier:** confidentiality and integrity. Store a salted, slow hash rather than the PIN, inside an AEAD record, with flash encryption underneath. Confidentiality matters because a 4- to 6-digit PIN can be searched offline from its hash.
4. **Failed-attempt count:** freshness above all. Keep it in monotonic storage, or increment it *before* checking the PIN in a way that cannot be rewound, so a restored flash image does not reset it.
5. **Access log:** integrity (so entries cannot be silently altered or removed) and probably confidentiality (it records people's movements). Authenticated, chained records; flash encryption or record encryption for privacy. Note that an adversary who can destroy the flash can always destroy the log: state that as an accepted limit or export the log elsewhere.` },

    `## Harder application: internal flash and no encryption hardware

Carry the reasoning to a part that executes from **internal** flash, such as the MSPM0L2228 used in the 2026 eCTF or the MAX78000 used in 2024 and 2025. There is no separate flash chip to clip onto, so the readout path is the debug port and the factory bootloader instead. Which of this lesson's mechanisms still apply? Whole-flash transparent encryption may not exist on the part; the confidentiality job shifts to debug and bootloader lockdown plus read protection (next lesson). The integrity and freshness jobs do not change at all: stored records that matter still need authentication and a version. Both of these chips have an AES engine you can use through the vendor SDK. On the MSPM0L2228 the engine supports GCM and CCM directly, with 128- or 256-bit keys (datasheet SLASF94A, Features and section 8.20), so record-level AEAD is available in hardware. For the MAX78000 the MSDK driver shows 128-, 192- and 256-bit keys; check its user guide for the supported modes, which this course has not verified.`,

    { t: 'callout', kind: 'security', title: 'Verification for data at rest', md: '1. Dump the flash of a production-configured test unit: no provisioned secret, SSID or log string is findable; entropy is uniform over encrypted partitions. 2. Copy the flash image of unit A onto unit B: B does not boot or does not yield A\'s data. 3. Flip one bit in a stored authenticated record: the firmware rejects the record and takes the documented safe action. 4. Restore an older copy of a versioned record: rejected as stale. 5. Lifecycle read-back shows release mode on every unit (on ESP32: the counter eFuse write-protected, the download-mode bits set, and the firmware\'s own start-up check above returning true). 6. On a release-mode test unit, try to flash a plaintext image over serial: the tool must fail or the unit must not boot it.' },
  ],
  quiz: [
    { q: 'Flash encryption is enabled on a device with external SPI flash. What does an adversary who desolders and reads the flash chip obtain?', kind: 'security',
      choices: [
        { t: 'Ciphertext, useless without the key held inside the microcontroller', ok: true, why: 'The key never leaves the SoC, so the bytes on the separate flash part are not useful on their own.' },
        { t: 'Plaintext, because the flash chip stores the key in its own status register', why: 'The flash part is an ordinary memory with no knowledge of the encryption. The key is in the microcontroller\'s OTP.' },
        { t: 'Nothing: the chip refuses to be read once encryption is enabled', why: 'The flash part still answers read commands normally. What changes is the meaning of the bytes it returns.' },
      ] },
    { q: 'According to the ESP-IDF flash encryption guide, how does the original ESP32 differ from chips such as the ESP32-C3?', kind: 'arch',
      choices: [
        { t: 'The ESP32 uses AES-256 with an offset-derived key tweak, not XTS; the C3 uses XTS-AES', ok: true, why: 'These are the two schemes the guide describes. Their eFuse names differ too: FLASH_CRYPT_CNT versus SPI_BOOT_CRYPT_CNT.' },
        { t: 'Both use XTS-AES as defined in IEEE 1619; only the key length differs between the two chips', why: 'The guide is explicit that the original chip\'s scheme predates and differs from the XTS one.' },
        { t: 'The original ESP32 has no flash encryption', why: 'It has flash encryption, with its key in an eFuse block; the scheme is simply an older design.' },
      ] },
    { q: 'Why can whole-flash transparent encryption not authenticate the data it protects?', kind: 'concept',
      choices: [
        { t: 'Ciphertext is the same size as plaintext, leaving no room for per-block tags', ok: true, why: 'Authentication needs extra stored bits. Length-preserving storage encryption has none, by design.' },
        { t: 'AES is unable to produce authentication tags', why: 'AES is used inside authenticated modes such as GCM and CMAC. The limitation here comes from the storage layout, not the cipher.' },
        { t: 'It does authenticate: decryption of a modified block fails and the chip raises a flash read error', why: 'Decryption of a modified block still produces output, just different output. Nothing signals an error.' },
      ] },
    { q: 'A record in flash is protected with AES-GCM. An adversary replaces it with a copy of the same record saved a month ago. Does the tag check fail?', kind: 'security',
      choices: [
        { t: 'No. The old record is genuine and correctly tagged; freshness needs a version check', ok: true, why: 'Authenticity says who made the data, not when. Freshness is a separate requirement.' },
        { t: 'Yes, because the nonce has been used before and GCM rejects a nonce it has already seen', why: 'The verifier does not remember which nonces it has seen unless you build that. A stored record legitimately keeps its nonce.' },
        { t: 'Yes, because GCM tags expire', why: 'A tag is a pure function of key, nonce, data and associated data. It has no notion of time.' },
      ] },
    { q: 'An ESP32 product ships with flash encryption enabled but left in development mode, without secure boot. A buyer has a USB-serial cable and no key. What can they do?', kind: 'security',
      choices: [
        { t: 'Flash their own plaintext program over serial; the chip encrypts it, runs it, and it reads the flash decrypted', ok: true, why: 'Development mode keeps the encrypt-on-download path so that boards can be re-flashed on the bench. The ESP-IDF guide notes that this indirectly allows the plaintext of the flash to be read out.' },
        { t: 'Nothing useful: the flash holds ciphertext in either mode, and the serial loader cannot decrypt it for them', why: 'The stored bytes are ciphertext in both modes. What differs is whether the chip will still encrypt and run an image handed to it over the serial port.' },
        { t: 'Read the encryption key out of eFuse over the serial port, since development mode leaves it readable', why: 'The key block is read-protected in both modes, so no tool returns it. The route that development mode leaves open does not need the key at all.' },
      ] },
    { q: 'Which stored item most needs freshness rather than confidentiality?', kind: 'concept',
      choices: [
        { t: 'A count of failed PIN attempts', ok: true, why: 'Its value is not secret. The harm comes from returning it to an earlier state.' },
        { t: 'A Wi-Fi password', why: 'Reading it is the harm. Restoring an older password mostly just breaks connectivity.' },
        { t: 'A device\'s private identity key', why: 'Disclosure is the primary harm for a private key.' },
      ] },
  ],
};

const secureUpdate = {
  id: 'sec-a-secure-update',
  title: 'Secure firmware updates and anti-rollback',
  minutes: 60,
  summary: 'An update mechanism that accepts only authentic, current firmware and survives losing power at any instant.',
  skills: ['sec-a-update', 'sec-a-secure-c'],
  blocks: [
    `## The problem

Version 1.2 of your lock firmware has a flaw in its pairing code. You fix it in 1.3, sign it and push it to the fleet. A month later someone with one lock and a copy of the 1.2 update file, which is correctly signed by you, installs 1.2 over 1.3 and uses the old flaw.

The signature check passed, as it should: the file is authentic. Authentic is not the same as current. And there is a second way this goes wrong that involves no adversary at all: a battery dies halfway through writing 1.3 and the lock never starts again.

The update mechanism is the most privileged feature a device has. It replaces everything else. It needs its own threat model.`,

    `## Threat model for the update path

| Threat | Asset | Mitigation in this lesson |
|---|---|---|
| Install modified or third-party firmware | Code integrity | Signature verified on the device before the image is made bootable, and again at every boot |
| Install an old, vulnerable, validly signed version | Fixes already shipped | [[Anti-rollback]] with a [[Monotonic counter]] |
| Install firmware meant for a different product or hardware revision | Device function | Product and hardware ID inside the signed header |
| Feed the parser a malformed image to corrupt memory | Bootloader integrity | Strict, length-checked header parsing before anything else |
| Interrupt the update (power, link) | Availability | [[A/B update]] slots, atomic switch, trial boot and automatic fallback |
| Exhaust the device (endless updates, flash wear, counter exhaustion) | Availability | Authenticate before erasing; bound the version range; rate-limit |
| Block updates so a flaw stays in the field | Fixes not yet shipped | Cannot be prevented by the device; detect in the back end |
| Read the image in transit | Code confidentiality | Encrypt the image for transport if the threat model asks for it |

The transport does not appear in the mitigation column. TLS to the update server is worth having, but the device must make its decision from the image itself, because the image may arrive through a different path one day: a phone, a USB stick, a factory fixture.`,

    `## Signed images: what is signed and when it is checked

A sound image format puts everything the loader acts on inside the signed range.

| Field | Why it is signed |
|---|---|
| Magic and format version | So a different file type is not parsed as an image |
| Product and hardware revision | So a correctly signed image for another product is refused |
| Security version | The anti-rollback input; unsigned, it could simply be edited |
| Payload length, load address, entry point | The loader uses these to copy and jump |
| Payload | The code |

Checks happen in a fixed order, cheapest and safest first:

1. Parse the header with strict bounds checks. Nothing is trusted, and nothing is acted on.
2. Verify the signature over header and payload.
3. Only now read header fields as facts: compare product ID, compare the security version with the floor.
4. Mark the slot as a candidate. The bootloader verifies it again at boot, because flash can be changed between download and reset.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'A length-checked image header parser with its host tests. Compiled with gcc -Wall -Wextra -std=c11 (also run under AddressSanitizer and UBSan); all cases passed.', code: IMG_HEADER,
      explain: [
        { lines: '25-29', md: 'Fields are assembled byte by byte. Casting the buffer to a struct pointer would depend on the buffer\'s alignment and the CPU\'s byte order, and on some cores an unaligned 32-bit load faults.' },
        { lines: '39', md: 'The first check is that the header itself is present. Until this passes, no byte of the buffer is read.' },
        { lines: '48', md: 'Unknown flag bits are rejected, not ignored. A parser that ignores what it does not understand lets a future or hostile image mean something different to different versions of the code.' },
        { lines: '50-54', md: 'The untrusted `payload_len` stands alone on one side of the comparison and the trusted limit is computed on the other. The tempting form `16 + payload_len + 64 <= SLOT_SIZE` wraps to a small number for `payload_len` near `0xFFFFFFFF`, and the check passes.' },
        { lines: '55', md: 'A second, separate question: are that many bytes actually in the buffer? `avail - IMG_HEADER_LEN` cannot wrap because line 39 already established `avail >= IMG_HEADER_LEN`.' },
        { lines: '57-58', md: 'Outputs are written only on success, so a caller that forgets to check the return value does not get half-filled data that looks plausible.' },
      ] },

    `## Anti-rollback: a version floor in monotonic storage

The device keeps a **minimum acceptable security version**, the floor, in storage that can only increase. An image whose signed security version is below the floor is refused.

Three design points decide whether it works:

**Where the floor lives.** If it is in ordinary flash, an adversary who can rewrite flash rewrites the floor. It has to be in [[OTP memory]] (eFuse bits used as a unary counter: each burned bit is one step), in a secure element's counter, or in flash that only the verified bootloader can write and that is itself protected against out-of-circuit rewriting.

**The security version is not the marketing version.** OTP counters are small: a unary counter has as many steps as bits. Increment the security version only for releases that fix a security flaw, so 1.3.0 through 1.9.7 might all be security version 4.

**When the floor moves.** Not when the new image is downloaded, and not when it first boots. The floor is raised after the new image has run and confirmed itself. Otherwise a release that fails on some hardware variant leaves those units with nothing they are allowed to run.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'Version check against a unary one-time-programmable counter, with host tests. The OTP word is modelled as a variable; on a target it would be an eFuse or OTP register accessed through the vendor API. Compiled with gcc -Wall -Wextra -std=c11 and run; all cases passed.', code: VERSION_CHECK,
      explain: [
        { lines: '10-15', md: 'The counter value is the number of 1 bits. This matches how OTP behaves physically: bits change one way only, so the count can only rise.' },
        { lines: '19-26', md: 'Advancing sets the low `target` bits. `|=` models the hardware: a write can add 1 bits and cannot remove them. The function reads back and compares, as provisioning code must.' },
        { lines: '33-38', md: 'The range check on line 35 matters as much as the rollback check. Without it, a signed image carrying a huge version (through a mistake in the release pipeline) would be accepted and could never be recorded, or would push the floor to its maximum and end the device\'s ability to take updates.' },
        { lines: '42-46', md: 'The commit is a separate step called by the new image after its self-test. `version_check` alone never moves the counter, which the test "check alone does not move the counter" pins down.' },
      ] },

    { t: 'predict', q: 'A design raises the anti-rollback floor in the bootloader as soon as a new image passes signature verification, before booting it. Release 7 has a bug that makes it crash at start-up on boards with a second-source flash chip. What happens to those boards?',
      choices: [
        { t: 'They are stuck: release 7 crashes and release 6 is now below the floor', ok: true, why: 'Raising the floor is irreversible. Doing it before the new image has proved it works turns a recoverable bad release into bricked units.' },
        { t: 'They fall back to release 6 and keep working', why: 'Falling back requires that release 6 is still acceptable. The floor has already been moved past it.' },
        { t: 'The bootloader lowers the floor again when it sees the trial image crash', why: 'The floor is in monotonic storage. No software step can reduce it, which is the property that makes it useful.' },
      ],
      reveal: 'Sequence: verify, trial boot, self-test, confirm, then raise the floor. There is a deliberate window in which rollback to the previous version is still possible; it closes when the new version confirms.' },

    { t: 'widget', name: 'c-lab', title: 'Exercise: implement the version floor check',
      props: {
        title: 'Monotonic version check',
        prompt: `The device's floor is a unary counter in \`otp_word\`: its value is the number of 1 bits (here \`0x7\`, so the floor is 3).

1. Fix \`floor_read()\` so it returns the number of set bits.
2. Fix \`version_ok(v)\` so it returns 1 only when \`v\` is at least the floor **and** no greater than 32 (the largest value a 32-bit unary counter can ever record).

Runs on the Bench-MCU simulator; \`otp_word\` is an ordinary variable standing in for OTP.`,
        starter: CLAB_VER_STARTER,
        solution: CLAB_VER_SOLUTION,
        tests: [
          { name: 'floor is 3; v2 rejected; v3, v4, v32 accepted; v33 and 0xFFFFFFFF rejected', stdout: 'floor=3\nv2=0 v3=1 v4=1 v32=1 v33=0 vmax=0\n' },
        ],
        hints: [
          'Counting bits: loop while the word is non-zero, add `w & 1`, shift right by one.',
          'Equal to the floor is acceptable: reinstalling the current version is not a rollback.',
          'Why reject 33 and above? Ask what the device would have to write into `otp_word` to remember that version.',
          '`if (v > 32u) return 0; if (v < floor_read()) return 0; return 1;`',
        ],
        explain: 'Both bounds matter. The lower bound stops rollback. The upper bound stops an image whose version could never be recorded, which would otherwise either be accepted forever without raising the floor or exhaust the counter.',
      } },

    `## A/B slots, trial boot and recovery

Never overwrite the image that is running. Keep two application slots. The running image writes the update into the *other* slot. A small metadata record says which slot to boot and in what state it is.

The states that matter are: **new** (written and verified, never booted), **trial** (booted once, not yet confirmed), **confirmed**, and **bad**. The bootloader's rule is short: if it finds a slot still in *trial* at boot, the image did not confirm itself last time, whatever the reason, so it marks it bad and boots the other slot.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'Slot selection with trial boot and automatic fallback, with host tests. Flash metadata is modelled as an array. Compiled with gcc -Wall -Wextra -std=c11 and run; all cases passed.', code: SLOT_SELECT,
      explain: [
        { lines: '17-21', md: 'A slot is bootable only if its signature verified **at this boot** and its state allows it. The signature result is never read from flash: a stored "verified" flag is something an adversary with flash access could set.' },
        { lines: '31-34', md: 'Seeing *trial* at boot means the previous attempt ended without confirmation: a crash, a hang ended by the watchdog, or power loss. All three are handled the same way, with no need to know which it was.' },
        { lines: '35-39', md: 'Among bootable slots the higher version wins. Combined with the trial rule, a new image gets exactly one chance.' },
        { lines: '45', md: 'The application calls this after its self-test. On a real device this is also the moment to raise the anti-rollback floor.' },
      ] },

    `### Power-fail safety

Assume power can vanish between any two flash operations, and design so that every intermediate state is one the bootloader handles.

- **The image write is not critical.** It goes to the inactive slot. If it is interrupted, the slot fails verification and is ignored.
- **The switch is the critical step,** so make it a single small write. Write the new metadata record to a fresh location with its own integrity check, verify it, and only then retire the old record. At every instant at least one valid record exists. Never erase the only copy and then write.
- **A watchdog** ends hangs in the trial image so that the fallback rule gets a chance to run.
- **The self-test must be meaningful:** reaching \`main\` is not enough. Check what the product needs to take the *next* update (storage, the radio stack, the update client), because an image that runs but cannot be updated is its own kind of brick.

You verify this by cutting power at every flash-operation boundary. On a host build this is a loop: run the update against a simulated flash, abort after operation *k*, "reboot", and check that the device boots a valid image, for every *k*. On hardware you own, a relay on the supply driven by a script does the same job more slowly.`,

    `## On real hardware: ESP-IDF OTA, app rollback and anti-rollback

ESP-IDF provides this structure: two or more OTA app partitions, an \`otadata\` partition recording which to boot, and an \`esp_ota_*\` API to write and select images. Two bootloader features map directly onto this lesson:

**App rollback** (\`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE\`, off by default). The states in \`otadata\` are this lesson's states under other names:

| This lesson | ESP-IDF state | Set by |
|---|---|---|
| new | \`ESP_OTA_IMG_NEW\` | \`esp_ota_set_boot_partition()\` after the download |
| trial | \`ESP_OTA_IMG_PENDING_VERIFY\` | the bootloader, when it selects a *new* image |
| confirmed | \`ESP_OTA_IMG_VALID\` | the app, with \`esp_ota_mark_app_valid_cancel_rollback()\` |
| bad | \`ESP_OTA_IMG_ABORTED\` (never confirmed) or \`ESP_OTA_IMG_INVALID\` (app rejected itself) | the bootloader on the next boot, or the app |

A reset for any reason while the image is pending-verify (the option's help text names power loss and the watchdog) ends in rollback to the previous app. With the option off, none of these states is used and a bad image simply keeps booting.

**Anti-rollback** (\`CONFIG_BOOTLOADER_APP_ANTI_ROLLBACK\`, which depends on app rollback being enabled). Each app carries a \`secure_version\` in its application description, set at build time by \`CONFIG_BOOTLOADER_APP_SECURE_VERSION\`. The chip keeps its floor in an eFuse field as a unary count, the number of bits set, exactly like the model above: 32 bits on the original ESP32, 16 on most other chips, 9 on the ESP32-C5 and only 4 on the ESP32-C2. The bootloader selects only apps whose version is at least the eFuse value, and the eFuse is advanced when the new app calls \`esp_ota_mark_app_valid_cancel_rollback()\`. Conditions the guide attaches: the partition table must be \`ota_0\` + \`ota_1\` with **no factory or test app** (those would be an unversioned way back), and on the original ESP32 the eFuse coding scheme must be "None". One exception to "the floor moves at confirm": if \`otadata\` is still blank and a higher-versioned app was flashed over serial, the bootloader advances the eFuse immediately.

An updater can ask \`esp_efuse_check_secure_version(new_version)\` after receiving the first block of an image, and stop a doomed download before erasing anything.`,

    { t: 'code', lang: 'c', status: 'idf-checked', caption: 'Confirming or rejecting a trial image (ESP-IDF v6.1). Every call, type and constant was checked against esp_ota_ops.h in the v6.1 app_update component; the block was not compiled as a whole or run on a board. It only has an effect when CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE is set.',
      code: String.raw`#include "esp_ota_ops.h"
#include "esp_log.h"

static const char *TAG = "ota-confirm";

extern bool self_test_passed(void);   /* your product's own checks */

void confirm_running_image(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state;

    if (esp_ota_get_state_partition(running, &state) != ESP_OK) {
        return;                        /* e.g. factory app: nothing to confirm */
    }
    if (state == ESP_OTA_IMG_PENDING_VERIFY) {
        if (self_test_passed()) {
            ESP_LOGI(TAG, "self-test passed, keeping this image");
            esp_ota_mark_app_valid_cancel_rollback();
        } else {
            ESP_LOGE(TAG, "self-test failed, rolling back");
            esp_ota_mark_app_invalid_rollback_and_reboot();
        }
    }
}`,
      explain: [
        { lines: '10', md: 'Asks which partition the currently executing app was loaded from.' },
        { lines: '16', md: 'Pending-verify is the "trial" state from the model above: the bootloader has booted this image once and is waiting for it to vouch for itself.' },
        { lines: '19', md: 'Records the image as valid in the OTA data partition. With anti-rollback enabled, this is also the point at which the stored secure version can advance, so call it only after the self-test.' },
        { lines: '22', md: 'Marks the image invalid and resets; the bootloader then selects the previous app. This call does not return.' },
      ] },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: verifying after writing over the only image', md: 'A single-slot updater erases the application, writes the download in its place, then checks the signature. If the check fails, or the download stops at 60%, there is no application. The same mistake in smaller form: acting on header fields (erasing "payload_len" bytes of flash) before the signature over that header has been verified.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: A/B slots versus a single slot with a recovery loader', md: '**A/B slots** cost twice the application flash and give full-function fallback with no user action. **Single slot plus a small, immutable recovery loader** costs little flash; after a failed update the device is alive but can do nothing except accept another image, which is acceptable only if someone or something will supply one. **Single slot with nothing** is not a design. For an unattended product such as the lock, choose A/B. The MSPM0L2228 secure-boot component in TI\'s SDK is sized on the same reasoning: its guide describes two roughly 110 kB image banks on the 256 kB device.' },

    `## How you detect a weak update path

- **Trace who can produce an acceptable image.** If the answer is "anyone who can compute a CRC", there is no authentication.
- **Look at what is signed.** Parse a release image and check whether the version and length fields are inside the signed range.
- **Find the floor.** Where is the minimum version stored? Can it be rewritten by reflashing? Is there one at all?
- **Read the updater for order of operations.** Erase before verify, and use of header fields before verification, are both visible in a code review.
- **Try the negative cases on a development unit** (the list in the exercise below). The \`vuln-device\` simulator in this app has a deliberately weak updater, \`rollback-updater\`, to practise on.`,

    { t: 'exercise',
      prompt: `Write the verification test list for the lock's update mechanism: signed images, anti-rollback with an OTP floor, A/B slots with trial boot. Give at least eight tests with the expected observation for each. All run on development units.`,
      hints: [
        'Take the threat table at the top of the lesson and write at least one test per row.',
        'Include the positive path, and the path where a good update is followed by confirmation.',
        'Power-fail is not one test; it is a family. How do you make it systematic?',
        'Do not forget the image that is valid but meant for different hardware.',
      ],
      solution: `1. **Valid newer image:** installs, boots on trial, confirms, floor advances (read it back), keeps booting after reset.
2. **Modified payload (one bit):** rejected before the slot is marked bootable; running image unaffected.
3. **Modified header (version or length field), signature unchanged:** rejected; proves the header is signed.
4. **Signed with the development key on a production unit:** rejected.
5. **Older security version, correctly signed:** rejected with the rollback error code.
6. **Same security version:** accepted (reinstall is allowed).
7. **Version above the recordable range:** rejected.
8. **Image for another hardware revision:** rejected on product/hardware ID.
9. **Malformed lengths** (zero, huge, larger than the slot, larger than the file): rejected, no crash, no flash erased. Run the parser under a fuzzer on a host build.
10. **Truncated download:** slot ignored; previous image boots.
11. **Trial image that never confirms** (build one that hangs): watchdog reset, bootloader marks it bad, previous image boots, floor has not moved.
12. **Power cut at every flash-operation boundary** during write and during the slot switch: after each cut the device boots a valid image. Automate on a simulated flash; sample on hardware with a switched supply.
13. **Flash rewritten between download and reboot:** bootloader's own verification at boot refuses it.
14. **Repeated rejected updates:** flash erase count does not grow (authentication happens before erase where the design allows), device stays responsive.` },

    `## Harder application: when the adversary controls the channel completely

Suppose updates are delivered by a phone app over BLE, and the adversary controls a phone. They cannot forge images. What is left to them? They can withhold updates so the device stays on a flawed version (the device cannot detect this alone; the back end can notice devices that never report the new version). They can offer the device a genuine image for a sibling product (signed header fields stop that). They can interrupt at the worst moment, repeatedly (power-fail safety and authenticate-before-erase stop that turning into a brick or worn-out flash). And they can replay an old "update available" message (the version floor makes it harmless). Work through each against your design and write down which test in your list covers it.`,
  ],
  quiz: [
    { q: 'An update file for an old firmware version carries a valid vendor signature. Without anti-rollback, what does the device do when offered it?', kind: 'security',
      choices: [
        { t: 'Installs it: the signature proves who made it, not that it is current', ok: true, why: 'Authenticity and currency are separate properties. A version floor in monotonic storage supplies the second.' },
        { t: 'Rejects it, because vendor signatures carry an expiry date that the device checks', why: 'A raw signature has no notion of time, and most small devices have no trusted clock to check one against.' },
        { t: 'Rejects it, because the hash differs from the installed image', why: 'Every update differs from the installed image; that difference cannot be a reason for rejection.' },
      ] },
    { q: 'Why must the anti-rollback floor be kept in OTP or equivalent monotonic storage and not in the normal flash configuration area?', kind: 'arch',
      choices: [
        { t: 'Whoever can rewrite flash to install an old image can rewrite the floor too', ok: true, why: 'The floor must be at least as hard to change as the thing it guards. One-way storage achieves that.' },
        { t: 'Flash is too slow to read during boot, while an OTP word is read in a single cycle', why: 'The bootloader already reads the whole application from flash. Read speed is not the issue.' },
        { t: 'OTP is larger than flash', why: 'OTP is far smaller, which is why the security version is kept separate from the release number.' },
      ] },
    { q: 'When should the floor be raised to the new image\'s security version?', kind: 'concept',
      choices: [
        { t: 'After the new image has booted, passed its self-test and confirmed itself', ok: true, why: 'Until then the previous image is the only known-good one, and it must remain acceptable.' },
        { t: 'As soon as the download completes', why: 'A downloaded image has not been shown to run. Raising the floor here removes the fallback for a bad release.' },
        { t: 'When the signature verifies in the bootloader, before the first boot', why: 'A valid signature shows the image is authentic, not that it works on this unit.' },
      ] },
    { q: 'What is wrong with this bounds check on an untrusted 32-bit length?', code: 'uint32_t len = header->payload_len;          /* from the image */\nif (HDR_LEN + len + SIG_LEN <= SLOT_SIZE) {  /* all uint32_t */\n    flash_write(slot, payload, len);\n}', kind: 'code',
      choices: [
        { t: 'For len near 0xFFFFFFFF the sum wraps to a small value', ok: true, why: 'Unsigned arithmetic is modulo 2^32. Keep the untrusted value alone on one side: len <= SLOT_SIZE - HDR_LEN - SIG_LEN.' },
        { t: '<= should be <, otherwise it is correct', why: 'An image that exactly fills the slot is legitimate. The comparison operator is not the flaw.' },
        { t: 'uint32_t is too small to hold HDR_LEN + SLOT_SIZE for a large flash', why: '32 bits address 4 GiB, far more than a microcontroller slot. The type\'s range is sufficient; the arithmetic on it is the issue.' },
      ] },
    { q: 'A new image is booted for the first time and hangs in an initialisation loop. In a correct A/B design, what brings the device back?', kind: 'arch',
      choices: [
        { t: 'The watchdog resets it; the bootloader sees the slot still on trial and boots the previous one', ok: true, why: 'The trial state persists across the reset precisely so that "did not confirm" is detectable without knowing why.' },
        { t: 'The new image detects its own hang with a software timer and rolls itself back', why: 'Code that is stuck cannot be relied on to run its own recovery. The decision belongs to the bootloader on the next boot.' },
        { t: 'Nothing; a user must re-flash it', why: 'This is the outcome of a single-slot design. Two slots and a trial state exist to avoid it.' },
      ] },
    { q: 'Why does the bootloader verify the application signature at every boot when the updater already verified it at download?', kind: 'security',
      choices: [
        { t: 'Flash can be changed after the download check', ok: true, why: 'Download-time verification protects the channel. Boot-time verification protects the storage.' },
        { t: 'Signatures decay and must be refreshed', why: 'A signature is a fixed value. Nothing about it changes with time.' },
        { t: 'It does not need to; the download check is enough and the boot check only adds delay', why: 'This assumes nothing can alter flash between the two moments, which is false for an adversary with physical access.' },
      ] },
  ],
};

const debugAndMemory = {
  id: 'sec-a-debug-memory-protection',
  title: 'Debug port protection and memory protection',
  minutes: 60,
  summary: 'Closing the doors that bypass everything else, and limiting what a bug in running firmware can reach.',
  skills: ['sec-a-debug-lock', 'sec-a-secure-c'],
  blocks: [
    `## The problem

The lock now has secure boot, encrypted flash and signed updates. A returned unit arrives on your bench. You connect a debug probe to the four pads next to the microcontroller, halt the CPU, and read the pairing key out of RAM.

Every mechanism so far assumed that the only way to interact with the chip is through the firmware. The debug port is a second way, and by design it has more authority than the firmware does: it can read and write any memory, set the program counter and single-step past any check. The ROM's serial download mode is a third way. Until these are closed, the rest is decoration.

The second half of this lesson deals with a different gap. Once the doors are closed, the remaining way in is a bug in the firmware itself. Memory protection decides how far such a bug reaches.`,

    `## Debug ports

**What it is.** JTAG and SWD connect an external probe to the debug logic inside the CPU. Through it a host can halt the core, read and write registers and memory, program flash and set breakpoints. This is what the debugging section of this course used, and during development it is indispensable.

**What an open port allows on a shipped unit.** Reading firmware and keys from flash and RAM; changing variables such as an "authenticated" flag; skipping a check by moving the program counter; reprogramming flash without going through the update mechanism.

**The options for production**, from weakest to strongest:

| Option | How it works | Trade-off |
|---|---|---|
| Leave the header unpopulated | Pads are still there | No protection; pads are found in minutes |
| Firmware reconfigures the debug pins as GPIO | Port unavailable once the app runs | The probe can connect under reset, before that code runs |
| Password or challenge-response authenticated debug | The chip keeps the port closed until the probe presents a secret | Allows failure analysis of returns; the secret must be per-device and well guarded |
| Disabled in OTP or boot configuration, reversible only by mass erase | Access can be restored, but everything is erased first | Good default for many products: service is possible, secrets are not exposed |
| Permanently disabled | An OTP bit removes the port for good | Strongest; no failure analysis ever, and no recovery from mistakes |

**On the hardware in this course:**

- **ESP32 family** (ESP-IDF v6.1 security guide and eFuse tables). Both doors are closed by eFuses, and the names differ per chip, so read the result back with \`idf.py efuse-summary\`.
  - *JTAG.* The guide states that the JTAG interface "stays disabled if any of the security features are enabled". The eFuse is \`JTAG_DISABLE\` on the original ESP32. Newer chips have \`DIS_PAD_JTAG\` for the pins and, where there is a built-in USB Serial/JTAG controller, \`DIS_USB_JTAG\` for that second path. Chips with the HMAC peripheral also have a *soft* disable (\`SOFT_DIS_JTAG\`) that can be re-enabled by presenting a secret key: that is the "authenticated debug" row of the table.
  - *ROM download mode.* The build option \`CONFIG_SECURE_UART_ROM_DL_MODE\` chooses between leaving it enabled (the guide: "should not be enabled for production"), permanently disabling it (\`UART_DOWNLOAD_DIS\` on the ESP32, \`DIS_DOWNLOAD_MODE\` on newer chips; after that esptool and espefuse no longer work on the unit), and, on every chip except the original ESP32, switching permanently to **Secure Download Mode** (\`ENABLE_SECURITY_DOWNLOAD\`). Secure Download Mode keeps only a few commands: updating the SPI configuration, changing baud rate, a basic flash write, and \`get-security-info\`, which returns a summary of the enabled security features. It cannot read memory or run downloaded code.
  - *Original ESP32 before chip revision v3.0.* The download-mode eFuse is valid only from v3.0, and the option above is not even offered for older revisions. On those chips the ROM loader cannot be switched off; flash encryption's download-mode eFuses limit what it can do instead. This is one more reason the security guides steer new designs to v3.0 or later.
- **MSPM0L2228.** The NONMAIN boot configuration (BCR) in the SDK's \`boot_config.h\` exposes: debug access *enabled*, *enabled with password* or *disabled*; SWD port enable or disable; a TI failure-analysis enable; mass erase and factory reset each as *enabled*, *password* or *disabled*; BSL (bootstrap loader) invocation and mode settings; and static write protection of NONMAIN itself. The technical reference manual (SLAU847F, sections 1.4.2 and 1.4.3) gives the semantics. There are three SWD security levels: 0, no restrictions (the factory default); 1, custom, with debug, mass erase and factory reset each enabled, password-protected (128-bit passwords) or disabled; 2, the SW-DP fully disabled. The BSL uses UART or I2C, is enabled by default and always requires a 256-bit password. Static write protection stops application code and the BSL from modifying protected sectors, but an SWD mass erase or factory reset **overrides** it unless those commands are password-protected or disabled. Critical fields are matched as 16-bit patterns, so a single flipped bit falls to the most secure state.
- **MAX78000.** This course has not verified its debug-lock options: Analog Devices' datasheet and user guide could not be read when the facts were checked. See the device's security chapter in the user guide. What is verified, from MITRE's 2025 rules, is that the chip has a serial boot ROM interface, entered by holding the UART0 RX and SWDCLK pads low at power-up.`,

    { t: 'callout', kind: 'hw', md: 'The MAX78000FTHR has an on-board debug adapter that appears as a DAPLink drive, and TI\'s LP-MSPM0L2228 LaunchPad has an XDS110 probe on board. On such a board the debugger is permanently attached. The 2026 eCTF board (the custom MSP-LITO-L2228) is different: it has no probe, and an external XDS110 is wired to its debug pins with jumpers, so anyone holding the board can do the same. Either way, "is debug locked?" is a question about the target chip\'s configuration, not about whether a header is fitted.' },

    `## ROM download modes and factory bootloaders

Most microcontrollers have code in ROM that can program flash over UART or USB when a pin is held at reset. On ESP32 chips this is the serial download mode entered through the boot strapping pin (GPIO0 on the original ESP32). On MSPM0 it is the BSL, which uses UART or I2C and always asks for a 256-bit password (TRM SLAU847F, section 1.4.3). It exists so that a blank chip can be programmed, and it is not part of your firmware, so nothing in your firmware guards it.

For production the ROM loader must be disabled, or restricted to a mode that cannot read memory or load arbitrary code, or protected by a password, using whatever the chip provides. Then the update mechanism from the previous lesson is the only way to change the firmware.`,

    `## Read-out protection

Many microcontroller families offer a setting that controls what the debug port and factory bootloader may do with flash. The common shape is a small number of levels: fully open; flash not readable from outside, with mass erase as the only way to regain access; and permanently locked. Names, the number of levels, and whether the strongest is reversible vary by vendor. Read-out protection settings and debug-disable settings are sometimes one mechanism and sometimes two, so check both.

The general idea to carry between chips: **the route back to an open device must pass through erasing the secrets.**`,

    { t: 'predict', q: 'A product disables SWD by having the application write a register that turns the SWD pins into GPIO, as its first statement in main(). An adversary has physical access. What is the weakness?',
      choices: [
        { t: 'A probe can connect under reset and halt the core before main() runs', ok: true, why: 'Anything done by application code takes effect only after that code executes. Debug logic is usable from the reset state unless the chip\'s own boot configuration disables it.' },
        { t: 'None: once the pins are reassigned as GPIO the probe has nothing left to talk to', why: 'True only once the reassignment has executed. There is a window between reset and that statement.' },
        { t: 'The pins can be changed back by sending the right UART command', why: 'There is no such general command. The weakness is about timing at reset, not about another interface.' },
      ],
      reveal: 'Lockdown has to live where it takes effect before any code runs: in OTP or boot configuration memory that the chip evaluates at reset.' },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: locking the prototype you still need', md: 'Someone tests the production lock sequence on the only board with the new sensor fitted, and the setting was the permanent one. Keep lockdown out of ordinary builds; make it a separate, deliberate provisioning step. Label locked boards. Practise on boards you can lose, and prefer the "mass erase to unlock" setting until the very last stage of validation.' },

    { t: 'callout', kind: 'decision', title: 'Design decision: permanent disable or erase-to-unlock', md: '**Erase-to-unlock** keeps secrets safe (they are destroyed on unlock) and lets a unit be reprogrammed and reused, so mistakes in the factory are recoverable. Its limit: after the erase an adversary can load their own code onto genuine hardware, so it must be combined with secure boot if running foreign code on your hardware matters. **Permanent disable** removes that path and with it all failure analysis; a field return that will not boot can never be examined. **Authenticated debug** suits products where returns analysis is essential, at the cost of managing per-device unlock secrets. For the lock: erase-to-unlock plus secure boot during pilot production, and a recorded decision about whether to go permanent for volume.' },

    `## How you detect an open door

On units you own or are authorised to assess:

- **Inspect the board:** unpopulated headers, test pads in a row near the MCU, pads labelled TX/RX/SWD/TCK. The datasheet pinout tells you which pins carry debug and boot functions; follow them.
- **Try to attach** a probe to a production-configured unit, including with reset held. The expected result is failure to connect or failure to read.
- **Try the ROM loader:** hold the boot pin at reset and see what answers on the UART or USB.
- **Read the configuration** from a unit through the vendor tool and compare it with the specification.
- **Watch the console** from power-on. A shell prompt, a boot menu with a timeout, or verbose logs are findings.`,

    `## Memory protection: limiting what a bug can do

Now assume the doors are shut and the firmware has a flaw, for instance a parser that writes one buffer too far. On a bare microcontroller with no protection, every byte of RAM, every peripheral and every flash-control register is reachable from every line of code. One bug owns the device.

The [[MPU]] changes that. It sits between the CPU and the bus and checks each access against a table of regions. Each region has a base, a size and attributes: readable or not, writable or not, executable or not, and whether unprivileged code may use it. An access that breaks the rules does not happen; the CPU takes a fault exception instead.

Both Arm cores in this course have one: the MAX78000's Cortex-M4 and the MSPM0L2228's Cortex-M0+ report an MPU as present in their device headers. Whether an MPU is fitted, and with how many regions, is the chip designer's choice (the \`DREGION\` field of the \`MPU_TYPE\` register tells you; on both of these cores the answer is 0 or 8). Both use the same register set (\`RNR\`, \`RBAR\`, \`RASR\`) and the same rules: a region's size is a power of two, its base is aligned to its size, and where regions overlap the highest-numbered one wins. Two differences to remember. The smallest region is **32 bytes on ARMv7-M (Cortex-M4) but 256 bytes on ARMv6-M (Cortex-M0+)**, so a 32-byte stack guard like the one below has to become a 256-byte one on the MSPM0. And the fault differs: Cortex-M4 (ARMv7-M) has a dedicated MemManage fault with status and address registers; Cortex-M0+ (ARMv6-M) has no separate MemManage exception, so an MPU violation arrives as a HardFault.

### Privilege separation

Cortex-M has two privilege levels in thread mode. **Privileged** code can change the MPU, mask interrupts and reach system registers. **Unprivileged** code cannot. The \`CONTROL\` register's \`nPRIV\` bit drops thread mode to unprivileged, and the only way back up is through an exception. Unprivileged code asks for services with the \`SVC\` instruction, which enters a privileged handler at a fixed entry point.

That gives a structure: a small privileged core (boot, key handling, flash writes, MPU setup) and a larger unprivileged application (protocol parsing, user interface). The SVC handler is a trust boundary inside the chip and must validate every argument it is given, pointers and lengths especially. An RTOS with MPU support applies the same idea per task.

### Execute-never and W^X

A classic way to exploit an overflow is to place bytes in a buffer and get the CPU to execute them. If RAM is marked [[Execute-never]], the first instruction fetch from the buffer faults. The general rule is [[W^X]]: no region is both writable and executable. Flash is executable and, in normal operation, not writable; RAM and peripherals are writable and never executable.

### Stack protection

Two independent measures:

- **A guard region below the stack.** The stack grows downward. A small MPU region with no access permissions placed at the stack limit turns a stack overflow (too much recursion, too large a local array) into an immediate fault, where otherwise it would silently overwrite whatever lies beneath.
- **A [[Stack canary]].** Building with \`-fstack-protector-strong\` makes the compiler place a guard value between local arrays and the saved return address in functions that have such arrays, and check it before return. If it changed, the function calls \`__stack_chk_fail\` and never returns through the corrupted frame. On bare metal you supply \`__stack_chk_guard\`, initialised from the TRNG early in boot, and \`__stack_chk_fail\`, which should log and reset.

The \`stack-smash\` tool in the other half of this section lets you see an overflow with and without a canary.`,

    { t: 'code', lang: 'c', status: 'reviewed', caption: 'ARMv7-M MPU setup on a Cortex-M4 using CMSIS register names: RAM execute-never, flash read-only, a no-access stack guard. Written against the Arm documentation and CMSIS core header; not compiled or run on a board here. Addresses and sizes are placeholders: take them from your linker script.',
      code: String.raw`#include "core_cm4.h"   /* normally pulled in by the device header */

/* RASR SIZE field: region is 2^(SIZE+1) bytes. 4 -> 32 B, 16 -> 128 KiB, 18 -> 512 KiB */
#define RASR_SIZE(n)   ((uint32_t)(n) << MPU_RASR_SIZE_Pos)
#define AP_NONE        (0x0u << MPU_RASR_AP_Pos)   /* no access at all            */
#define AP_RW          (0x3u << MPU_RASR_AP_Pos)   /* read/write, any privilege   */
#define AP_RO          (0x6u << MPU_RASR_AP_Pos)   /* read-only, any privilege    */

extern uint32_t __stack_limit;   /* lowest address of the stack, from the linker script */

static void region(uint32_t n, uint32_t base, uint32_t attr)
{
    MPU->RNR  = n;                               /* select region n            */
    MPU->RBAR = base;                            /* base, aligned to its size  */
    MPU->RASR = attr | MPU_RASR_ENABLE_Msk;      /* attributes + enable        */
}

void mpu_setup(void)
{
    __disable_irq();
    MPU->CTRL = 0;                                             /* off while editing */

    region(0, 0x10000000u, AP_RO | RASR_SIZE(18));             /* flash: RO, executable   */
    region(1, 0x20000000u, AP_RW | MPU_RASR_XN_Msk | RASR_SIZE(16)); /* RAM: RW, never executed */
    region(2, (uint32_t)&__stack_limit, AP_NONE | MPU_RASR_XN_Msk | RASR_SIZE(4)); /* guard */

    SCB->SHCSR |= SCB_SHCSR_MEMFAULTENA_Msk;                   /* MemManage as its own fault */
    MPU->CTRL = MPU_CTRL_ENABLE_Msk | MPU_CTRL_PRIVDEFENA_Msk; /* on; privileged default map */
    __DSB(); __ISB();                                          /* take effect before continuing */
    __enable_irq();
}`,
      explain: [
        { lines: '11-16', md: 'The ARMv7-M MPU is programmed one region at a time: select it with `RNR`, then write base and attributes. Regions must be a power of two in size and aligned to that size.' },
        { lines: '23', md: 'Flash is readable and executable but not writable through this mapping. The base and size shown match the MAX78000\'s flash (512 KB at `0x10000000`); use your own part\'s values.' },
        { lines: '24', md: '`XN` set on all of RAM: data can be read and written, never fetched as instructions. If your project runs any function from RAM, it needs its own small executable, non-writable region.' },
        { lines: '25', md: 'Higher-numbered regions take priority where they overlap, so this 32-byte no-access region wins over the RAM region and traps the first write below the stack limit. The linker script must align `__stack_limit` to 32 bytes. One trap: if the *main* stack is the one that overflows, the processor cannot push the exception frame either, and a handler that then uses the stack faults again and ends in HardFault or lockup. A robust fault handler starts in assembly by pointing the stack pointer at a small reserved area before it calls any C.' },
        { lines: '27', md: 'Without this the violation escalates to HardFault. With it, the MemManage handler can read `CFSR` and `MMFAR` to report what was accessed.' },
        { lines: '28', md: '`PRIVDEFENA` keeps the default memory map available to privileged code for anything not covered by a region (peripherals, system space). Unprivileged code gets only what the regions grant.' },
      ] },

    `## A bounds-checking exercise

Memory protection contains damage. It does not replace the length check that should have prevented the overflow. The frame handler below has the classic flaw: it trusts a length byte from the wire. A 9-byte name overruns an 8-byte buffer and lands on the flag stored next to it.`,

    { t: 'widget', name: 'c-lab', title: 'Exercise: length-check a frame before copying',
      props: {
        title: 'Length-checked frame handler',
        prompt: `\`handle()\` copies a name from a received frame into \`s.name\` (8 bytes), which sits directly before \`s.authorised\` in memory. Run it first: the frame \`big\` sets \`authorised\` to 1 without any authorisation logic running.

Add checks so that \`handle()\` returns -1 and copies nothing when

1. the frame is too short to contain the type and length bytes,
2. the length byte claims more name bytes than were actually received (\`avail\`), or
3. the name does not fit in \`s.name\`.

Reject oversized input; do not truncate it. The valid frame must still return 0.

Runs on the Bench-MCU simulator, where the out-of-bounds write really does overwrite the neighbouring field.`,
        starter: CLAB_LEN_STARTER,
        solution: CLAB_LEN_SOLUTION,
        tests: [
          { name: 'valid frame accepted, three malformed frames rejected, flag untouched', stdout: 'ok=0 big=-1 lies=-1 tiny=-1 authorised=0\n' },
        ],
        hints: [
          'Check `avail` before reading `frame[1]`: with a 1-byte frame that read is already out of bounds.',
          'There are two different limits: how many bytes arrived, and how many bytes the destination holds.',
          'Write the comparison so the untrusted length is alone on one side: `len > avail - 2` is safe once you know `avail >= 2`.',
          '`if (avail < 2) return -1; size_t len = frame[1]; if (len > avail - 2) return -1; if (len > sizeof s.name) return -1;`',
        ],
        explain: 'Three checks, each answering a different question: is the header there, does the frame contain what it claims, does it fit where it is going. With an MPU and a canary a missed check becomes a fault and a reset; with the checks, the malformed frame is simply refused.',
      } },

    `## Verification

**Debug and download lockdown** (production-configured test units):
1. Probe attach fails or cannot read memory, including when connecting under reset.
2. The ROM loader does not accept a connection, or accepts only what the restricted mode allows.
3. Configuration read-back matches the specification for every unit in the factory test.
4. If erase-to-unlock is used: after unlocking, the unit contains no secrets (dump and search), and with secure boot it refuses unsigned code.

**Memory protection** (deliberate violations in a test build):
1. Write to a flash address through a pointer: fault.
2. Copy a few instructions into a RAM buffer and call it: fault on the first fetch.
3. Recurse until the stack reaches the guard: fault at the guard, not corruption below it.
4. From unprivileged code, write an MPU or system control register, and read privileged RAM: fault.
5. Overflow a local buffer in a function built with the stack protector: \`__stack_chk_fail\` is called.
6. Pass an SVC a pointer into privileged memory: the handler rejects it.

A fault handler that records the fault type, address and stacked program counter turns each of these into a one-line pass or fail.`,

    { t: 'exercise',
      prompt: `You are writing the production lockdown specification for the lock on a microcontroller that offers: debug *enabled / password / disabled*, mass erase *enabled / password / disabled*, a ROM serial loader that can be *enabled / disabled*, and write protection of the configuration memory itself.

Choose a setting for each, explain the reason in one sentence, give the order in which the factory applies them, and state how a field-return unit would be analysed.`,
      hints: [
        'Start from the threat: what must an adversary with a probe not be able to do?',
        'If both debug and mass erase are disabled and the configuration is write-protected, what can you never do again?',
        'Which setting must be applied last, and why?',
        'For returns: is it acceptable that analysis destroys the secrets on the unit?',
      ],
      solution: `One defensible specification:

- **Debug: disabled.** A password-protected port is only as strong as the handling of the password; for a lock, no debug in the field.
- **Mass erase: enabled (or password).** It is the recovery path. Erase destroys the pairing key and application, so it exposes no secrets, and secure boot means erased hardware still only runs signed firmware.
- **ROM serial loader: disabled.** The signed OTA path is the only way to change firmware.
- **Configuration write protection: enabled, last.** So the settings above cannot be reverted by running code.

**Order in the factory:** program and verify firmware; provision keys and verify by use; run the functional test; write debug/loader/erase settings; read them back and compare; apply configuration write protection; power-cycle and run the end-of-line check, including a probe-attach attempt that must fail.

**Field returns:** read the unit's self-reported fault log through its normal authenticated interface first. If more is needed, mass-erase, which restores debug access on an empty device, then load diagnostic firmware (signed) to test the hardware. Data and keys from the field are gone by design; state that in the service procedure.

If the threat model had required that nobody can ever load other code even after erase and the chip had no secure boot, the answer would shift to mass erase disabled, accepting no failure analysis.` },

    `## Harder application: partitioning a design

The 2026 eCTF reference design holds files with per-group permissions behind a PIN, and talks to a host over one UART and to another HSM over a second. Sketch a privilege split for a design of that shape on a Cortex-M0+ with an MPU: which code is privileged, which is not, what each side's regions are, and what the call interface between them looks like. A useful test of your sketch: if the UART command parser were completely controlled by an adversary, list exactly what memory it could read and write, and what requests it could make. If the list includes the key material or raw flash writes, move the boundary. This is a course exercise, not official competition guidance.`,
  ],
  quiz: [
    { q: 'Why does an open debug port undermine secure boot and flash encryption?', kind: 'security',
      choices: [
        { t: 'It reads and writes memory and CPU state directly, bypassing the firmware', ok: true, why: 'Secure boot and flash encryption constrain what is loaded and what is stored. A debugger operates beneath both, on the running system.' },
        { t: 'It slows signature verification enough to cause time-outs, so the boot check is skipped', why: 'The port has no effect on verification speed when no probe is attached.' },
        { t: 'It does not; those mechanisms also encrypt debug traffic', why: 'Debug protocols carry plain register and memory values. Nothing in secure boot or flash encryption changes that.' },
      ] },
    { q: 'The MSPM0L2228 boot configuration offers debug access as enabled, enabled with password, or disabled, and mass erase as enabled, password, or disabled. Which pair keeps a recovery path while protecting secrets?', kind: 'arch',
      choices: [
        { t: 'Debug disabled, mass erase enabled or password-protected', ok: true, why: 'Access can be regained only by erasing, which destroys the secrets first. Recovery and confidentiality are both kept.' },
        { t: 'Debug enabled, mass erase disabled, header unpopulated', why: 'This leaves full memory access to anyone with a probe and removes the ability to wipe the device.' },
        { t: 'Debug disabled, mass erase disabled', why: 'Secrets are protected, but there is no way back from a mistake or for service; this is the permanent option, not the recoverable one.' },
      ] },
    { q: 'What does marking RAM execute-never achieve?', kind: 'concept',
      choices: [
        { t: 'The CPU faults on any instruction fetch from RAM, so injected bytes cannot run', ok: true, why: 'It removes the simplest route from "can write data" to "can run chosen code".' },
        { t: 'It prevents buffer overflows: a write past the end of a RAM buffer now raises a fault', why: 'The overflow still writes memory. The attribute changes what the overwritten bytes can be used for, not whether the write occurs.' },
        { t: 'It encrypts RAM contents', why: 'Region attributes control access type. They do not transform stored data.' },
      ] },
    { q: 'An unprivileged task needs a privileged service to write a flash page, and passes a pointer and a length through SVC. What must the SVC handler do first?', kind: 'security',
      choices: [
        { t: 'Check that the pointer, length and target page are all ones this caller may use', ok: true, why: 'The handler runs with full privilege on arguments chosen by less-trusted code. Unchecked, the caller can direct privileged reads and writes anywhere.' },
        { t: 'Disable the MPU for the duration of the call so the handler can reach the caller\'s buffer', why: 'Privileged code can already reach what it needs. Turning protection off inside the most sensitive path removes the safeguard exactly where it matters.' },
        { t: 'Nothing: arguments from the same firmware image can be trusted', why: 'The purpose of the split is that the unprivileged side may be under an adversary\'s control after a bug. Its arguments are untrusted input.' },
      ] },
    { q: 'On a Cortex-M0+ with the MPU enabled, a task writes to a region it has no permission for. What exception is taken?', kind: 'arch',
      choices: [
        { t: 'HardFault, because ARMv6-M has no separate MemManage exception', ok: true, why: 'The dedicated MemManage fault and its status registers belong to ARMv7-M cores such as the Cortex-M4.' },
        { t: 'MemManage, as on every Cortex-M core that has an MPU', why: 'That is the ARMv7-M behaviour. The smaller ARMv6-M exception model does not include it.' },
        { t: 'No exception; the write is silently ignored', why: 'An MPU violation always raises a fault. Silent discard would hide bugs and attacks alike.' },
      ] },
    { q: 'A stack canary is checked just before a function returns. Which defect does it detect?', kind: 'code',
      choices: [
        { t: 'A linear overflow of a local array toward the return address', ok: true, why: 'The guard value sits between the locals and the saved registers, so a contiguous overwrite changes it first.' },
        { t: 'A write through a wild pointer directly to the return address', why: 'A write that jumps straight to the target address leaves the guard untouched, so the check passes.' },
        { t: 'Too much recursion exhausting the stack', why: 'Exhaustion runs off the bottom of the stack region without touching any frame\'s guard value. A guard region at the stack limit handles that case.' },
      ] },
  ],
};

const lifecycle = {
  id: 'sec-a-security-lifecycle',
  title: 'A security lifecycle for a product',
  minutes: 55,
  summary: 'Where security work happens between the first requirement and the last supported device: requirements, review, coding rules, analysis, release hardening and response.',
  skills: ['sec-a-lifecycle', 'sec-a-secure-c'],
  blocks: [
    `## The problem

A product passes its penetration test in the week before launch. Two findings are fixed in a hurry. Eighteen months later a researcher reports a flaw in the update parser. There is no process for receiving the report, nobody knows which library versions are in the shipped image, the engineer who owned the signing key has left, and it turns out a third of the fleet was built with the development configuration because the factory used an old script.

None of that is a missing mechanism. Every mechanism in this section existed in the design. What was missing is the work around them: deciding, checking, recording and maintaining. This lesson lays that work out as a sequence you can follow on a project of any size.`,

    `## The phases

| Phase | What you produce | Who checks it |
|---|---|---|
| Requirements | Threat model; security requirements phrased as testable outcomes | Design review |
| Design | Chain of trust, key inventory, update design, lockdown specification, partition of privilege | Design review against the threat model |
| Implementation | Code following the secure coding rules; unit tests including negative cases | Code review, static analysis in CI |
| Verification | Fuzzing of every parser on host builds; the verification test lists from each mechanism; independent assessment | Test reports traced to threat rows |
| Release | Release-hardening checklist executed and recorded; SBOM; signed artefacts | A second person signs off |
| Production | Scripted provisioning; per-unit state read-back; quarantine of failures | Factory test records |
| Field | Vulnerability intake, triage, fix, signed update, advisory | Post-incident review |
| End of life | Final update policy; key and data disposal | Recorded decision |

The same threat table threads through all of it: each row gets a requirement, a design element, tests, a line on the release checklist and a plan for when it fails.`,

    `## Requirements and design review

Write security requirements as outcomes that can be tested: "A production unit shall not execute an application image that is not signed by the release key", not "the device shall be secure". Each one names its threat row.

A design review for security asks a fixed set of questions, and a "we have not decided" is a finding:

1. What is the root of trust, and what verifies each stage after it?
2. Where does every key in the inventory live, and what would its extraction from one unit expose?
3. Which interfaces accept input from outside a trust boundary, and where is each input validated?
4. What does the device do when each check fails? Is every failure state safe?
5. Which settings are irreversible, and when in the factory flow are they applied?
6. How is each mitigation verified, on every unit or by type test?
7. How does a fix reach devices, and what is the slowest device to receive it?`,

    `## Secure coding rules for C

C gives you no bounds checks, wrapping unsigned arithmetic, undefined signed overflow and return values that are easy to ignore. Most firmware flaws are one of four things. A short rule for each:

**1. Bounds.** Every index and every length that comes from outside is checked against the size of the thing it indexes before use. Pass buffer sizes alongside pointers. Prefer rejecting oversized input to truncating it.

**2. Integer handling.** Arithmetic on untrusted lengths can wrap. Check before you compute, with the untrusted value alone on one side of the comparison, or use helper functions that report overflow. Use unsigned types for sizes. Be careful with mixed signed and unsigned comparisons: a negative \`int\` compared with a \`size_t\` is converted to a very large value.

**3. Return values.** A verify function that fails and a caller that does not look is the same as no verification. Check every return value from crypto, storage and parsing functions. Initialise result variables to the *failure* state so that an early exit cannot leave "success" behind. Compilers and analysers can enforce this (\`-Wall -Wextra\`, a warn-unused-result attribute on security-critical functions).

**4. Constant-time handling of secrets.** Comparisons of MACs, PINs and keys use a constant-time routine (lesson 2). Do not branch on secret bits or use them as array indices in code you write. Clear secrets from RAM when finished, using a function the compiler will not optimise away.

Further habits worth making rules: no \`strcpy\`, \`sprintf\` or \`gets\`; no secrets or pointers in log output; one exit path that cleans up; fail closed on any unexpected state.`,

    { t: 'code', lang: 'c', status: 'host-tested', caption: 'Overflow-checked size arithmetic and a record copy that uses it, with host tests. Compiled with gcc -Wall -Wextra -std=c11 (also run under AddressSanitizer and UBSan); all cases passed.', code: CHECKED_COPY,
      explain: [
        { lines: '8-13', md: 'The test `a > SIZE_MAX - b` cannot itself overflow, because `SIZE_MAX - b` is always representable. The sum is computed only after it is known to fit.' },
        { lines: '16-21', md: 'The same idea for multiplication: the limit is computed by dividing the constant `SIZE_MAX`, which cannot overflow, and the product is formed only afterwards. The `b != 0` guard avoids dividing by zero.' },
        { lines: '34-35', md: '`count * rec_size` and `offset + total` are the two places where message-controlled numbers are combined. Each goes through a checked helper and each result is tested before the next step.' },
        { lines: '36-37', md: 'Two independent limits: reading past the source, and writing past the destination. Either alone is a vulnerability.' },
        { lines: '38', md: 'By the time `memcpy` runs, every quantity it uses has been proven in range. The copy is the last line, not the first.' },
      ] },

    { t: 'predict', q: 'What does this function return when crypto_verify() fails with -1?',
      code: String.raw`int image_ok(const uint8_t *img, size_t len, const uint8_t *sig)
{
    int ok = 1;                          /* assume good */
    if (len < HEADER_LEN) goto out;      /* too short: bail out */
    if (crypto_verify(img, len, sig) != 0) ok = 0;
out:
    return ok;
}`,
      choices: [
        { t: '0 for that case, but 1 for an image shorter than the header', ok: true, why: 'The default value decides what every unplanned path returns. Initialise to failure and set success in exactly one place, after all checks have passed.' },
        { t: '0 in every failure case, because ok is only left at 1 when crypto_verify succeeds', why: 'Trace the path where len is too small: the jump goes straight to the return with the initial value still in place.' },
        { t: '-1, the value from crypto_verify', why: 'The function returns its own variable, which is only ever 1 or 0.' },
      ],
      reveal: 'This "fail open" shape has appeared in real, widely used code. The rule is mechanical: result variables start as failure; success is assigned once, at the end.' },

    { t: 'callout', kind: 'mistake', title: 'Common mistake: ignoring a return value on the security path', md: '`crypto_verify(img, len, sig); boot(img);` compiles without complaint. So does `if (verify(...) == OK);` with a stray semicolon. Turn on warnings as errors, mark verification functions so the compiler warns when their result is unused, and include a negative test (a bad signature must not boot) that would catch either.' },

    `## Static analysis and fuzzing on host builds

The firmware's parsers, state machines and checks are ordinary C. Build them for your PC and you gain tools that do not fit on a microcontroller.

**Structure the code for it.** Keep protocol parsing, image validation and state logic in files that do not touch hardware registers. Put hardware access behind a thin interface that a host build replaces with a stub. Every routine in this half of the section was tested that way.

**Static analysis.** Compile with \`-Wall -Wextra -Werror\`. Add an analyser in CI: the compiler's own (\`gcc -fanalyzer\`, \`clang --analyze\`), \`cppcheck\`, or a commercial tool if a coding standard such as MISRA C or CERT C is required. Treat a new finding as a build failure.

**Sanitizers.** Build the host tests with \`-fsanitize=address,undefined\`. AddressSanitizer stops at the first out-of-bounds or use-after-free access and names the line. UndefinedBehaviorSanitizer reports signed overflow, bad shifts and misaligned access. A test that passes silently while reading one byte past a buffer now fails loudly.

**Fuzzing.** A fuzzer calls your parser millions of times with inputs it mutates to reach new code paths, under the sanitizers. The harness is a few lines: take a byte buffer and a length, call the parser, return. Any crash is a finding with a reproducing input. Fuzz everything that accepts bytes from outside a trust boundary: the image header parser, every protocol frame handler, configuration loaders. Keep the corpus of interesting inputs in the repository and replay it in CI.

What host testing does **not** tell you: timing on the target, behaviour of the real peripherals, and anything about physical attacks. Those need the target and the verification lists from earlier lessons.`,

    { t: 'code', lang: 'c', status: 'pseudo', caption: 'Shape of a fuzz harness for the image parser from lesson 6 (libFuzzer entry-point convention). Illustrative: not built or run here, because it needs a clang toolchain with the fuzzer runtime.',
      code: String.raw`#include <stdint.h>
#include <stddef.h>
#include "img_header.h"

/* Build (example): clang -g -O1 -fsanitize=fuzzer,address,undefined fuzz_img.c img_header.c */
int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    img_header_t h;
    size_t signed_len = 0;

    if (img_parse(data, size, &h, &signed_len) == IMG_OK) {
        /* Properties that must hold for every accepted input: */
        if (signed_len > size) __builtin_trap();
        if (h.payload_len == 0) __builtin_trap();
    }
    return 0;
}` ,
      explain: [
        { lines: '6', md: 'The fuzzer calls this function repeatedly with generated inputs. Any crash, sanitizer report or trap is recorded with the input that caused it.' },
        { lines: '11-15', md: 'Beyond "does not crash", the harness asserts invariants: an accepted image never claims more signed bytes than exist. Stating properties like this finds logic errors, not only memory errors.' },
      ] },

    { t: 'callout', kind: 'decision', title: 'Design decision: test security logic on the host first', md: '**Chosen:** security-relevant logic is hardware-independent C with host unit tests, sanitizers and fuzzing in CI; target tests cover integration and lockdown. **Alternative, test only on the target:** slow, hard to automate, no sanitizers, and negative cases such as "power fails at step 37" are impractical. **Alternative, rely on a pre-release penetration test:** it samples the design once, late, when fixes are most expensive, and says nothing about the next release. Host testing costs some discipline in code structure and repays it on every commit.' },

    `## Release hardening checklist

A release is hardened by a checklist that is executed and recorded, with the evidence attached, by someone who did not write the code. A reasonable starting list:

**Build**
- Built from a tagged commit by the release pipeline, not a developer machine. Build is reproducible or at least fully logged.
- Release configuration: assertions and logging at production levels; no debug console, test commands or backdoor accounts compiled in.
- Compiler hardening enabled: stack protector, warnings as errors.
- Static analysis clean; fuzz corpus replayed; all unit and negative tests pass.
- [[SBOM]] generated; third-party components checked against known vulnerabilities.

**Secrets**
- Repository and final binary scanned for key material and credentials: none.
- Image signed by the production key in the signing system; development-key signature absent.
- Security version reviewed and incremented if this release fixes a security flaw.

**Device state** (verified on units from the production flow)
- Secure boot enabled; trust-anchor digest reads back correctly; a tampered image is refused.
- Flash encryption or data-at-rest protection in its production mode; flash dump shows no plaintext secrets.
- Debug port and ROM download mode in their specified production state; probe attach fails.
- MPU configuration active; a deliberate violation faults (test build).
- Anti-rollback floor at the expected value; an older image is refused.
- Update from the previous release to this one succeeds, and an interrupted update recovers.

**Records**
- Test evidence stored with the release. Sign-off by a second person. Known residual risks listed.`,

    `## Incident response and updates in the field

Assume a vulnerability report will arrive. Prepare the path before it does.

1. **Intake.** A published contact for security reports and someone who reads it. Acknowledge quickly.
2. **Triage.** Reproduce on a unit you own. Use the threat model to rate it: which asset, which adversary capability, one device or the fleet, recoverable or not. Use the SBOM to find which products and versions contain the affected code.
3. **Fix.** Correct the flaw, add the failing input as a regression test and to the fuzz corpus, and look for the same pattern elsewhere.
4. **Release.** Increment the security version so the flawed version cannot be reinstalled. Run the full hardening checklist; urgency is when shortcuts cause the second incident.
5. **Deploy.** Staged rollout, watching the confirm rate from trial boots. The back end tracks which devices have not updated.
6. **Communicate.** Tell customers what is affected, what to do, and credit the reporter.
7. **If a key is involved,** run the revocation procedure from lesson 4.
8. **Review.** Which phase should have caught it, and what changes there.

Two questions decide how well this goes, and both are answered at design time: *can you update the devices?* and *can you stop the old version coming back?*`,

    { t: 'exercise',
      prompt: `A researcher reports that the lock's BLE "set name" command copies a name of up to 255 bytes into a 32-byte buffer. Firmware 1.3 (security version 4) is in the field on 12,000 locks. The lock has secure boot, signed A/B updates with anti-rollback, an MPU with RAM execute-never, and stack canaries.

Write the response plan: triage (how bad is it given the mitigations in place?), the fix and its tests, the release steps, and what you would change in the process.`,
      hints: [
        'Triage with the threat model: which adversary capability reaches this command? Is authentication needed before it?',
        'What do the canary and execute-never RAM turn this bug into? Is that outcome harmless?',
        'What must change in the release so that 1.3 cannot be put back?',
        'Which lifecycle phase had a tool that finds exactly this kind of bug?',
      ],
      solution: `**Triage.** Entry point: BLE, so a proximate adversary. Check whether "set name" requires an authenticated session; if not, anyone in radio range can reach it. Effect: stack buffer overflow. With a canary the function aborts and the lock resets; with execute-never RAM, injected bytes cannot run directly. So the likely worst case is a remote denial of service (repeated resets, a lock that will not respond), with code execution made much harder but not ruled out, since canaries and XN do not stop every technique. Fleet-wide, recoverable by update. Rate it high.

**Fix.** Check the length against the buffer size and reject oversized names; apply the three-question pattern (header present, claimed length within received bytes, fits destination). Review every other command handler for the same pattern. Tests: unit tests for 32, 33 and 255 bytes; add the frames to the fuzz corpus; run the command parser under the fuzzer with sanitizers.

**Release.** Version 1.4 with **security version 5**. Full hardening checklist. Staged rollout watching trial-boot confirmations. After confirmation the floor moves to 5 and 1.3 is refused. Track devices still on version 4.

**Communicate.** Advisory to customers; credit the researcher.

**Process change.** This flaw is what fuzzing finds in minutes. Add a fuzz harness for the BLE command parser to CI, add "all external length fields checked" to the code review checklist, and consider requiring authentication before any command that writes state.

Note what the mitigations bought: time and a lower severity, not immunity. That is their purpose.` },

    `## Harder application: fit it to a small team

You have three engineers and eight weeks, the situation of a competition team or a start-up. You cannot do everything in the table. Decide which five activities you would keep and defend the choice. One defensible selection: a one-page threat model in the first week; host-testable structure with sanitizers from the first commit; a fuzz harness on every parser; a scripted build that injects secrets and never commits them; and a release checklist run by someone other than the author. Then name what you dropped, such as a formal coding standard or an independent assessment, and what risk that leaves. Being able to state the residual risk is the difference between a decision and an omission.`,

    { t: 'callout', kind: 'security', title: 'How you detect a missing lifecycle', md: 'Ask for five artefacts: the threat model; the key inventory; the list of third-party components in the last release; the evidence from the last release checklist; and the name of the person who would receive a vulnerability report today. Each one that cannot be produced marks a phase that is not happening.' },
  ],
  quiz: [
    { q: 'Which is a well-formed security requirement?', kind: 'concept',
      choices: [
        { t: 'A production unit shall refuse to boot an image not signed by the release key (test SB-2)', ok: true, why: 'It states an outcome, names the condition, and points at the test that demonstrates it.' },
        { t: 'The firmware shall be secure against attackers with physical or remote access', why: 'There is no way to test or review this; it names neither an asset nor an adversary nor an observable behaviour.' },
        { t: 'The firmware shall use SHA-256', why: 'This names an algorithm without a purpose. Using a hash somewhere satisfies it and protects nothing in particular.' },
      ] },
    { q: 'What is wrong with this check?', code: '#define MAX_LEN 64                  /* an int constant */\nint n = get_len_from_packet();      /* attacker-controlled */\nif (n > MAX_LEN) return -1;\nmemcpy(buf, pkt, n);                /* buf is 64 bytes */', kind: 'code',
      choices: [
        { t: 'A negative n passes the signed comparison, then becomes a huge size_t', ok: true, why: 'Both operands of the comparison are signed, so -1 is less than 64. The call then converts -1 to the largest size_t value. Lengths should be unsigned and checked as such.' },
        { t: 'The comparison should be >= so that a 64-byte copy, which overruns buf by one, is rejected', why: 'Copying exactly 64 bytes into a 64-byte buffer is in bounds, so nothing overruns. Tightening the upper limit leaves the real gap open.' },
        { t: 'memcpy cannot take its length from an int variable', why: 'The argument is converted to size_t automatically. That conversion is what makes an unexpected sign dangerous, not what makes the call illegal.' },
      ] },
    { q: 'Why build firmware parsers for the host PC and run them under AddressSanitizer?', kind: 'concept',
      choices: [
        { t: 'An out-of-bounds access that silently "works" on the target is reported at once', ok: true, why: 'On a microcontroller a one-byte overread usually returns some neighbouring value and the test passes. The sanitizer instruments every access.' },
        { t: 'Host builds with sanitizers prove the code is memory-safe and constant-time on the target', why: 'Timing depends on the target\'s compiler output and CPU. A host run says nothing about it.' },
        { t: 'It removes the need to test on the target', why: 'Peripheral behaviour, lockdown state and timing can only be checked on the real device.' },
      ] },
    { q: 'A release fixes a security flaw. Which step makes sure the flawed version cannot be reinstalled later?', kind: 'security',
      choices: [
        { t: 'Incrementing the security version, so the floor rises once the new image confirms', ok: true, why: 'The old image stays correctly signed for ever. Only the version floor makes it unacceptable.' },
        { t: 'Deleting the old image from the download server and revoking its links, so no device can fetch it again', why: 'Copies of the old file already exist outside your control, and each one still carries a valid signature.' },
        { t: 'Signing the new image with a longer key', why: 'Key length has no bearing on whether previously signed images are still accepted.' },
      ] },
    { q: 'What is an SBOM for, when a vulnerability is announced in a third-party library?', kind: 'concept',
      choices: [
        { t: 'It tells you which products and versions contain the affected library', ok: true, why: 'Without the list, "are we affected?" means reverse-engineering your own releases under time pressure.' },
        { t: 'It patches the library automatically', why: 'An SBOM is an inventory document. It informs the fix; it does not perform one.' },
        { t: 'It proves to customers that the product contains no vulnerable components', why: 'It lists components. Whether those components have flaws is a separate question it helps you answer.' },
      ] },
    { q: 'Who should execute the release-hardening checklist?', kind: 'concept',
      choices: [
        { t: 'Someone other than the author of the change, recording evidence for each item', ok: true, why: 'Independent execution with attached evidence catches the "I am sure I enabled that" class of error, which is how development configurations reach the field.' },
        { t: 'Nobody: a green CI pipeline already covers every item on the list', why: 'CI covers what can be automated on a build. Device-state items such as lockdown and eFuse read-back need a unit from the production flow.' },
        { t: 'The developer, from memory, after the release has shipped', why: 'A checklist completed afterwards from memory records belief, not observation, and comes too late to stop a bad release.' },
      ] },
  ],
};

export default [dataAtRest, secureUpdate, debugAndMemory, lifecycle];
