// Capstone 4: firmware security laboratory (build the defences, then prove them).
const lab = {
  id: 'cap-4',
  title: 'Capstone 4: firmware security laboratory',
  kind: 'Capstone', minutes: 660,
  summary: 'Add authenticated firmware updates, verified data and protected configuration to a device you own, then write the tests that prove each defence works.',
  skills: ['cap-method', 'cap-secure-update', 'cap-verify-defence'],
  requires: ['security', 'firmware-eng'],
  objectives: [
    'Write security requirements as attacker capability and forbidden outcome.',
    'Verify a signature over a firmware image before the image is accepted, and refuse older versions.',
    'Authenticate data records and detect corrupted or modified configuration.',
    'Handle keys so that the signing key never exists on the device.',
    'Write one negative test per defence and show the device rejecting the bad input.',
  ],
  hardware: [
    'An ESP32 development board that you own and are prepared to reflash many times',
    'USB cable; a second serial adapter is useful for an update channel separate from the console',
    'No board: the host-side signing tool, the image format, the verification logic compiled for a host, and the test harness can all be built and tested on a PC',
  ],
  software: [
    'ESP-IDF (OTA partitions, the `app_update` component, NVS, and its crypto library: v6.1 ships Mbed TLS 4.1, where hashing, MAC and signature verification are reached through the PSA Crypto API)',
    'Python 3 with the `cryptography` package, or OpenSSL, for the host signing tool',
    'A host C compiler if you unit-test the verification code off-target',
  ],
  background: [
    `A device that accepts any firmware it is given belongs to whoever gives it firmware. A device whose configuration can be edited freely has no access control. This capstone takes an ordinary application (capstone 1 will do) and adds three defences, each matched by a test that tries to defeat it.

Everything here is done to **your own device** with **keys you generate for this lab**. You are the designer and the tester; there is no third party's equipment involved.`,
    `### The three defences

1. **Authenticated update.** The host signs an image with a private key. The device holds only the public key and verifies the signature over the entire received image, and its version, before marking it bootable.
2. **Verified data.** Records the device stores or receives (log entries, commands) carry an authentication tag, so modification is detected.
3. **Protected configuration.** The configuration blob is integrity-protected (and encrypted if it contains secrets), and a failed check produces a defined safe state.`,
    { t: 'callout', kind: 'security', md: '**Scope.** This is application-level update authentication. It does not replace the chip\'s boot-time protections: ESP-IDF Secure Boot V2 makes the ROM verify the bootloader and the bootloader verify the app, and flash encryption protects contents at rest. Both burn eFuses and are **irreversible**. Do not enable them on a board for this lab unless you have read the ESP-IDF security guides and accept that the board may become unusable for other work. Describe in your report what they would add.' },
    { t: 'callout', kind: 'why', md: 'Signature and not checksum or shared-key MAC for updates: a checksum has no secret, and a MAC key stored on every device can be extracted from one device and used to forge updates for all of them. With a signature the device stores nothing that lets it create a valid image.' },
    { t: 'widget', name: 'crypto-lab', props: { tab: 'sign' }, caption: 'Real WebCrypto ECDSA P-256: sign, change one byte, verify.' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
   HOST (trusted, offline key)                 DEVICE (holds public key only)
  +---------------------------+              +-----------------------------------+
  | app.bin + version         |              | running app (slot A)              |
  | sign(header||image, priv) |--transport-->| receive into inactive slot B      |
  | -> update package         |  (UART etc.) | 1 parse header, bound all lengths |
  +---------------------------+              | 2 hash exactly what was written   |
                                             | 3 verify signature (public key)   |
                                             | 4 version > stored minimum?       |
                                             | 5 only then: set boot slot B      |
                                             | else: discard, stay on A, count   |
                                             +-----------------------------------+`, caption: 'Update flow. Nothing in slot B is executed before steps 1–4 pass.' },
    { t: 'ascii', text: String.raw`
 Update package (design your own; this is a starting point)
 +-------+---------+---------+----------+-----------------+-----------+
 | magic | hdr ver | fw ver  | img len  | image bytes ... | signature |
 +-------+---------+---------+----------+-----------------+-----------+
  \______________ signed region (header AND image) ______/`, caption: 'If a field is not inside the signed region, an attacker may change it freely.' },
    { t: 'widget', name: 'secure-boot-chain', props: { platform: 'esp32' }, caption: 'Simulation: tamper with a stage, swap a key, roll back a version — and see where a chain of trust stops.' },
  ],
  steps: [
    { title: 'Milestone 0: threat model and security requirements', md: `Fill in the worksheet for your device: assets (firmware integrity, configuration, keys), adversaries (someone on the update channel; someone who can write the config storage; someone holding an old, validly signed image), entry points and mitigations. Derive numbered security requirements from it. State what is out of scope (for example an attacker with a debugger attached, unless you address it).`,
      blocks: [{ t: 'widget', name: 'threat-model', props: { template: 'blank' }, caption: 'Export the result into your report.' }] },
    { title: 'Milestone 1: keys and the host signing tool', md: `Generate a lab key pair on the host. Write a tool that builds the update package and a second that verifies one, and test them against each other, including with a modified package. Decide where the private key lives (not in the firmware repository) and how the public key gets into the firmware build.` },
    { title: 'Milestone 2: verification logic, host-tested', md: `Write the device-side parser and verifier as plain C with no board dependencies, and unit-test it on the host against packages from your tool: valid, truncated, oversize length, flipped bit in header, flipped bit in image, flipped bit in signature, wrong key. Every length field is checked against the buffer and the slot size before use.`,
      code: String.raw`/* Shape of the decision. Every early return is a rejection that leaves the running firmware in place. */
update_result_t update_check(const pkg_header_t *h, const uint8_t digest[32],
                             const uint8_t *sig, size_t sig_len, uint32_t min_version)
{
    if (h->magic != PKG_MAGIC)                 return UPD_BAD_FORMAT;
    if (h->img_len == 0 || h->img_len > SLOT_SIZE) return UPD_BAD_LENGTH;
    if (!signature_valid(digest, sig, sig_len)) return UPD_BAD_SIGNATURE;  /* digest covers header + image */
    if (h->fw_version <= min_version)          return UPD_ROLLBACK;        /* only after the signature holds */
    return UPD_OK;
}`, lang: 'c', status: 'pseudo' },
    { title: 'Milestone 3: update transport on the device', md: `Add OTA partitions to the partition table and receive the package into the inactive slot using the ESP-IDF OTA API. Compute the digest over the bytes as you write them. The call that switches the boot partition is reached only when milestone 2's check returns OK.

What each call does to the device: \`esp_ota_get_next_update_partition(NULL)\` picks the OTA slot that is not running. \`esp_ota_begin\` erases it (the whole slot, with \`OTA_SIZE_UNKNOWN\`) and returns a handle. \`esp_ota_write\` programs each chunk into flash in order. \`esp_ota_end\` closes the handle and runs ESP-IDF's own validity check of the image format. None of these changes what boots next. Only \`esp_ota_set_boot_partition\` does, by updating the small \`otadata\` partition that the bootloader reads; a power cut at any earlier point leaves the old slot selected.

Every return value here depends on bytes an attacker supplies, so none of them goes through \`ESP_ERROR_CHECK\`: that macro aborts and resets the chip on any error, which would turn a malformed package into a reset on demand and break SR-7.`,
      code: String.raw`const esp_partition_t *slot = esp_ota_get_next_update_partition(NULL);
esp_ota_handle_t h;
if (slot == NULL || esp_ota_begin(slot, OTA_SIZE_UNKNOWN, &h) != ESP_OK) {
    count_rejection();
    return;                                /* still running slot A */
}
/* for each received chunk: update your SHA-256 context, then
   if (esp_ota_write(h, chunk, n) != ESP_OK) { esp_ota_abort(h); count_rejection(); return; } */
if (update_check(&hdr, digest, sig, sig_len, stored_min_version()) != UPD_OK) {
    esp_ota_abort(h);                      /* slot B is never selected */
    count_rejection();
    return;
}
if (esp_ota_end(h) != ESP_OK) {            /* ESP-IDF's own image-format check failed */
    count_rejection();
    return;
}
if (esp_ota_set_boot_partition(slot) != ESP_OK) {   /* the only call that changes what boots next */
    count_rejection();
    return;
}`, lang: 'c', status: 'idf-checked' },
    { title: 'Milestone 4: anti-rollback', md: `Store the minimum acceptable version somewhere an update cannot lower, and raise it only after the new firmware has booted and confirmed itself healthy. Decide what "confirmed" means. ESP-IDF also has a built-in anti-rollback feature tied to eFuses and Secure Boot; read its documentation and explain how your application-level counter differs in strength.` },
    { title: 'Milestone 5: verified data records', md: `Give each stored or received record an authentication tag (HMAC-SHA-256, or an AEAD if the content is confidential) covering the data and a monotonic counter. Compare tags in constant time. Decide where this key lives and say plainly what protects it on your board.`,
      blocks: [{ t: 'widget', name: 'crypto-lab', props: { tab: 'hmac' }, caption: 'HMAC verification, and what truncating or altering a message does to it.' }] },
    { title: 'Milestone 6: protected configuration', md: `Store configuration with an integrity tag over the whole blob including a format version. On boot, a blob that fails verification is not used: the device enters a defined safe state (defaults with privileged features off, or refuse to operate) and reports it. If the configuration holds secrets, evaluate ESP-IDF NVS encryption and state what it depends on.` },
    { title: 'Milestone 7: the negative tests', md: `Automate the test plan below as host scripts that drive the device over serial and check its responses and its state after reboot. A defence without a failing-input test is recorded as unverified.` },
  ],
  walkthrough: [
    `Decisions to justify:

- **What exactly is signed?** If the version or length sits outside the signed region, show the attack that follows.
- **Verify before or after writing to flash?** A large image cannot be held in RAM, so you write first and verify before *activating*. What stops unverified slot contents from ever being booted, including after a power cut mid-update?
- **Order of checks.** Why bound lengths before hashing, and why compare versions only after the signature holds?
- **Fail closed.** Every error path — parse error, timeout, allocation failure, crypto library error — ends in "keep running the current firmware". Find each path and show it.
- **Where do keys live?** A public key in firmware needs integrity, not secrecy. A MAC key on the device needs secrecy your board may not be able to give without flash encryption. Say so; do not overclaim.`,
    { t: 'callout', kind: 'mistake', md: 'Treating a library call\'s return value as a boolean. Many verify functions return 0 for success and a negative code for failure, so `if (verify(...))` accepts every forgery. Compare against the documented success value explicitly — and your tampered-image test is what catches this.' },
    { t: 'callout', kind: 'decision', md: 'Raising the minimum version only after the new image confirms itself trades a short window, in which the previous version is still acceptable, for the ability to recover from a bad update. Raising it immediately closes the window and can leave a device with nothing it is allowed to boot.' },
    { t: 'widget', name: 'glitch-sim', props: { defence: 'double-check' }, caption: 'Simulation: why a single branch on a signature result is a physical target, and what redundancy changes. Mention this in your out-of-scope or residual-risk section.' },
  ],
  testing: [
    `Each row is an attack you perform on your own device. The pass condition is always a **rejection you can observe**, plus the device still running the old firmware afterwards.

| ID | Defence under test | Procedure | You should see |
|---|---|---|---|
| T1 | Authentic update accepted | Send a correctly signed newer image | Reboot into the new version |
| T2 | Tampered image | Flip one byte in the image body | Rejection with a signature error; old version still boots |
| T3 | Tampered header | Change the version or length field without re-signing | Rejection |
| T4 | Wrong signer | Sign with a different key | Rejection |
| T5 | Replayed / rolled-back update | Send an older image that was validly signed | Rejection with a rollback error |
| T6 | Truncated or oversize package | Cut the package short; set a length larger than the slot | Rejection, no crash, no hang |
| T7 | Power loss mid-update | Reset during transfer | Old version boots; the partial image is never selected |
| T8 | Modified data record | Change one byte of a stored record | Record flagged invalid, never presented as data |
| T9 | Replayed data record | Resend an old valid record | Rejected by its counter |
| T10 | Corrupted config | Alter one byte of the stored configuration | Safe state entered and reported |
| T11 | Signing key absent (SR-6) | Search the firmware binary, a full flash dump of your board and the repository history (\`git log -p\`) for the private key's bytes and its PEM header | No match in any of the three |

Record the exact bytes changed and the device's response for each. Then run the mutation check: temporarily disable each defence in the source and confirm the matching test now **fails**. A test that passes with the defence removed is testing nothing.`,
    { t: 'widget', name: 'vuln-device', props: { device: 'rollback-updater' }, caption: 'A simulated device that lacks defence T5. Find its weakness, then confirm your own design does not share it.' },
  ],
  troubleshooting: [
    { symptom: 'Valid images are rejected on the device but verify on the host', cause: 'Host and device hash different bytes (padding, header included or not) or disagree on signature encoding (raw r||s versus DER) or byte order.', fix: 'Print the digest on both sides for the same package; once digests match, compare the signature format each library expects.' },
    { symptom: 'Tampered image is accepted', cause: 'Return value misread, digest computed over the wrong region, or the boot partition switched before the check.', fix: 'Unit-test the verifier on the host with the tampered package and step through; inspect the order of calls in the update path.' },
    { symptom: 'Device will not boot after an interrupted update', cause: 'The boot selection was changed before the image was complete and verified.', fix: 'Switch the boot partition only as the final step, and add test T7 to the automated set.' },
    { symptom: 'Rollback test passes once, then old images are accepted after a factory reset or config wipe', cause: 'The minimum version is stored inside the region that the wipe erases.', fix: 'Store it separately and treat a missing value as "reject", not as zero.' },
    { symptom: 'Signature verification overflows a task stack', cause: 'Public-key operations in mbedTLS need far more stack than typical tasks have.', fix: 'Measure the high-water mark of the verifying task and size its stack from the measurement.' },
  ],
  challenge: `Write a one-page residual-risk statement: the three strongest attacks your design does **not** stop (for example reading the MAC key out of unencrypted flash, a debugger attached to the running device, a fault injected at the signature branch), what each would require of an attacker, and the platform feature or design change that would address it. Implement one of them on your own board if it is reversible.`,
  quiz: [
    { q: 'Why does the device hold a public key and not a shared secret for update verification?', kind: 'security', choices: [
      { t: `Extracting everything stored on one device gives an attacker nothing that can sign an update`, ok: true, why: 'Correct: verification capability and signing capability are separated, so device compromise does not become update forgery.' },
      { t: `Public-key verification is faster than a MAC on a small microcontroller, so updates install sooner`, why: 'It is considerably slower; the reason is who can forge, not speed.' },
      { t: `A public key cannot be read out of flash, whereas a shared secret can`, why: 'They can be read like any other data; the point is that reading them does not help an attacker sign.' },
    ] },
    { q: 'The package header holds the firmware version, but only the image body is signed. What can an attacker do?', kind: 'security', choices: [
      { t: `Attach a high version number to an old, validly signed image and so pass the rollback check`, ok: true, why: 'Correct: any field outside the signed region is attacker-controlled, so the version check is meaningless.' },
      { t: `Nothing: the image cannot be changed without breaking the signature, and the image is what runs`, why: 'The image is intact, but the decision about whether to accept it uses the unsigned version field.' },
      { t: `Recover the private key, because unsigned fields beside a signature leak information about it`, why: 'Unsigned header fields do not leak key material; the weakness is in what the device trusts.' },
    ] },
    { q: 'What is wrong with this check, given that the function returns 0 on success and a negative value on failure?', kind: 'code', code: 'if (pk_verify(&ctx, hash, sig, sig_len)) {\n    activate_new_image();\n}', choices: [
      { t: `A failure code is non-zero and therefore true, so forgeries are activated`, ok: true, why: 'Correct: the test is inverted; it must compare explicitly against the success value.' },
      { t: `The hash and the signature are passed in the wrong order, so the comparison is always against zero`, why: 'Argument order is whatever the API defines; the fault is in how the result is interpreted.' },
      { t: `A single call cannot be trusted; verification must be repeated and both results combined`, why: 'Redundant checks can help against fault injection, but a single correct comparison is what is missing here.' },
    ] },
    { q: 'Your tampered-image test passes. You then comment out the signature check and the test still passes. What have you learned?', kind: 'concept', choices: [
      { t: `The test does not depend on the signature check; something else rejects the image`, ok: true, why: 'Correct: a test that cannot fail when the defence is removed is not evidence for that defence.' },
      { t: `The signature check is redundant, because another check already rejects tampered images`, why: 'Another check rejecting this particular tamper does not mean it rejects all of them; the signature is the only check that covers every byte.' },
      { t: `The device has two independent layers of defence against tampered images`, why: 'You have not shown that; you have only shown this test cannot tell the difference.' },
    ] },
    { q: 'On boot the configuration blob fails its integrity check. Which behaviour is defensible?', kind: 'arch', choices: [
      { t: `Do not use it; enter the documented safe state with privileged features off, and report the fault`, ok: true, why: 'Correct: failing closed means a corrupted or forged configuration cannot grant anything.' },
      { t: `Use it, but log a warning and raise an alert so that an operator can investigate later`, why: 'That makes the integrity check decorative: the forged values still take effect.' },
      { t: `Recompute the tag over the current contents, so that the next boot is clean, and continue`, why: 'Re-tagging blesses whatever is there, which is exactly what an attacker wants.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1: the device accepts a correctly signed, newer firmware image over a documented transport and boots it.',
      'FR-2: a failed or interrupted update leaves the device running its previous firmware.',
      'FR-3: the device reports its firmware version, last update result and rejection counters.',
      'FR-4: configuration persists across resets and can be changed through an authorised path.',
    ],
    security: [
      'SR-1: an attacker who can send arbitrary update packages cannot cause any image not signed by the lab signing key to be booted.',
      'SR-2: an attacker who holds an older validly signed image cannot cause the device to boot it.',
      'SR-3: an attacker who can modify header fields cannot change the device\'s accept/reject decision for a signed image.',
      'SR-4: an attacker who can modify stored or transmitted data records cannot have a modified or replayed record accepted as genuine.',
      'SR-5: an attacker who can modify the stored configuration cannot have the modified configuration used; the device enters its safe state.',
      'SR-6: the signing private key is never present on the device or in the firmware repository.',
      'SR-7: malformed packages (truncated, oversize, bad lengths) cause rejection and never a crash, hang or out-of-bounds write.',
    ],
  },
  rubric: [
    { criterion: 'Threat model and requirements', points: 15, evidence: 'Completed worksheet; SRs in capability/outcome form; stated out-of-scope items.' },
    { criterion: 'Authenticated update', points: 20, evidence: 'Package format with signed region marked; source of the update path; logs of T1–T4 showing the bytes changed, the device\'s response and the version running after reboot; T11 search output.' },
    { criterion: 'Rollback protection', points: 10, evidence: 'Where the minimum version is stored and when it is raised; T5 result.' },
    { criterion: 'Data and configuration protection', points: 15, evidence: 'Tag construction; T8–T10 results; safe-state description.' },
    { criterion: 'Robust parsing and fail-closed paths', points: 10, evidence: 'Host unit tests for malformed packages; T6 and T7 results; list of error paths.' },
    { criterion: 'Automated negative tests', points: 20, evidence: 'Test scripts and logs; mutation check showing each test fails when its defence is disabled.' },
    { criterion: 'Honest residual-risk statement', points: 10, evidence: 'What is not defended, what it would take, and which platform feature addresses it.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [
  { org: 'Espressif', title: 'ESP-IDF Secure Boot V2 guide (source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/secure-boot-v2.rst', note: 'Read before considering eFuse-based protections; they are irreversible.' },
  { org: 'Espressif', title: 'ESP-IDF flash encryption guide (source)', url: 'https://github.com/espressif/esp-idf/blob/v6.1/docs/en/security/flash-encryption.rst' },
] };
