// eCTF preparation: practice scenarios. Original course exercises modelled on the shape of
// eCTF work (specification, security requirements, insecure reference design, review, redesign).
// Not official MITRE challenges; no competition material is reproduced.
// Scenarios live in sc-a.js (1-2) and sc-b.js (3-5); shared C sources in code.js.
import a from './sc-a.js';
import b from './sc-b.js';

export default {
  skills: [
    { id: 'ectf-sc-review-reference', name: 'Review an insecure reference design against numbered security requirements and write actionable findings', track: 'competition' },
    { id: 'ectf-sc-secure-storage', name: 'Design authenticated release of a stored secret with an attempt limit that survives reset and power loss', track: 'competition' },
    { id: 'ectf-sc-mutual-auth', name: 'Design a two-device authentication and authorisation protocol with freshness and identity binding', track: 'competition' },
    { id: 'ectf-sc-secure-update', name: 'Design signed firmware updates with anti-rollback, per-device keys and device-to-device trust', track: 'competition' },
    { id: 'ectf-sc-protected-comms', name: 'Design AEAD-protected messaging and storage for a multi-node system with nonces that cannot repeat', track: 'competition' },
    { id: 'ectf-sc-key-handling', name: 'Design a key-handling device that enforces key usage policy and never releases key material in clear', track: 'competition' },
    { id: 'ectf-sc-evidence', name: 'Demonstrate each security requirement with negative tests and record the evidence against a rubric', track: 'competition' },
  ],
  lessons: [],
  labs: [...a, ...b],
  glossary: [
    { term: 'Reference design', def: 'A working implementation of the functional requirements supplied as a starting point. In these scenarios, as in eCTF\'s published "insecure example" repositories, it is deliberately written without security in mind and is reviewed, then replaced.' },
    { term: 'Finding', def: 'One recorded weakness: interface, class, requirement affected, observation, consequence, recommended defence, and the test that fails now and passes after the fix.' },
    { term: 'Challenge–response', def: 'A freshness mechanism in which the verifier sends an unpredictable nonce and accepts only a response computed over it with the right key.' },
    { term: 'Identity binding', def: 'Including both parties\' identifiers, the direction and the message type in the authenticated data, so a valid message cannot be used elsewhere.' },
    { term: 'Associated data', def: 'Input to an AEAD that is authenticated but not encrypted: typically header fields such as addresses, counters, slot numbers or key attributes.' },
    { term: 'Key wrapping', def: 'Encrypting one key under another so that it can be stored or moved without appearing in clear. The wrapped key\'s type and attributes are authenticated with it.' },
    { term: 'Key usage policy', def: 'Attributes fixed when a key is created that say which operations it may perform (encrypt, decrypt, sign, wrap) and whether it may be exported.' },
    { term: 'Default deny', def: 'An access decision that refuses unless an explicit rule allows; anything unanticipated is refused.' },
    { term: 'Boot record', def: 'A small persistent structure holding which image slot is active and the minimum acceptable version, stored redundantly so an interrupted write leaves one valid copy.' },
    { term: 'Rubric', def: 'The scoring table of a scenario: criterion, points, and the evidence that must exist to earn them.' },
  ],
  troubleshooting: [
    { symptom: 'A scenario test passes in the C lab but you are unsure the design is secure', area: 'Scenarios',
      causes: 'The C lab checks decision logic with simulated storage and a boolean standing in for cryptographic verification. It does not exercise real flash, real timing or a real library.',
      fix: 'Treat the C lab as evidence for the logic only. List in your residual risks what still needs a host build with a real library, and what needs hardware.' },
    { symptom: 'Your findings table for a reference design has fewer rows than there are security requirements', area: 'Scenarios',
      causes: 'The review followed the code\'s structure and stopped at the first issues, instead of walking every interface against every weakness class.',
      fix: 'Go requirement by requirement: for each, ask which aspect of the reference design would make its negative test fail.' },
    { symptom: 'Two devices built for the same scenario cannot authenticate each other', area: 'Scenarios',
      causes: 'They were built from different runs of the secrets step, or the two sides serialise the authenticated data differently.',
      fix: 'Generate secrets once per deployment and build every device from that file; compare hex dumps of the authenticated bytes on both sides.' },
  ],
  refs: [
    { org: 'MITRE', title: 'eCTF insecure example repositories, 2016–2025 (mitre-cyber-academy)', url: 'https://github.com/mitre-cyber-academy', note: 'For the shape of real reference designs. The scenarios in this course are original and reproduce none of them.' },
    { org: 'MITRE', title: 'eCTF 2026 insecure example: Hardware Security Module (ectfmitre)', url: 'https://github.com/ectfmitre/2026-ectf-insecure-example', note: 'Scenario 5 is a generic key-handling exercise and is not this system.' },
    { org: 'NIST', title: 'SP 800-38D: Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM) and GMAC', url: 'https://doi.org/10.6028/NIST.SP.800-38D', note: 'Nonce uniqueness. DOI not load-tested from this environment.' },
    { org: 'NIST', title: 'FIPS 186-5: Digital Signature Standard', url: 'https://doi.org/10.6028/NIST.FIPS.186-5', note: 'ECDSA. DOI not load-tested from this environment.' },
    { org: 'NIST', title: 'FIPS 180-4: Secure Hash Standard', url: 'https://doi.org/10.6028/NIST.FIPS.180-4', note: 'SHA-256. DOI not load-tested from this environment.' },
    { org: 'IETF', title: 'RFC 2104: HMAC: Keyed-Hashing for Message Authentication', url: 'https://www.rfc-editor.org/rfc/rfc2104', note: 'Not load-tested from this environment.' },
    { org: 'Espressif', title: 'ESP-IDF (source and documentation sources)', url: 'https://github.com/espressif/esp-idf', note: 'For the optional builds on an ESP32 you own.' },
  ],
};
