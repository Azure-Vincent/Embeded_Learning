import { C, code, widget, SCOPE } from './util.js';

const COUNTER = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define PROTO_VERSION   2u
#define HDR_LEN         10u     /* version, type, device id (4), counter (4) */
#define TAG_LEN         8u
#define COUNTER_WINDOW  64u     /* how far ahead a fob may legitimately be */

typedef struct {
    uint32_t device_id;
    uint32_t last_counter;      /* kept in non-volatile memory on a product */
} peer_t;

typedef enum { RX_OK, RX_MALFORMED, RX_VERSION, RX_NOT_FOR_US, RX_BAD_TAG, RX_REPLAY } rx_result_t;

/* Platform: MAC over msg[0..len) with the key shared with this peer. */
void mac_compute(const uint8_t *msg, size_t len, uint8_t tag[TAG_LEN]);
bool ct_equal(const uint8_t *a, const uint8_t *b, size_t n);

static uint32_t rd32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* frame = header | payload | tag. Returns RX_OK only for an authentic, fresh frame. */
rx_result_t frame_accept(peer_t *peer, const uint8_t *frame, size_t frame_len)
{
    uint8_t expect[TAG_LEN];
    uint32_t counter;
    size_t signed_len;

    if (frame_len < HDR_LEN + TAG_LEN) {
        return RX_MALFORMED;
    }
    signed_len = frame_len - TAG_LEN;           /* everything except the tag is covered */

    if (frame[0] != PROTO_VERSION) {
        return RX_VERSION;                      /* no fallback to older versions */
    }
    if (rd32(frame + 2) != peer->device_id) {
        return RX_NOT_FOR_US;
    }

    mac_compute(frame, signed_len, expect);     /* 1. authenticity */
    if (!ct_equal(expect, frame + signed_len, TAG_LEN)) {
        return RX_BAD_TAG;
    }

    counter = rd32(frame + 6);                  /* 2. freshness, only now */
    if (counter <= peer->last_counter || counter - peer->last_counter > COUNTER_WINDOW) {
        return RX_REPLAY;
    }
    peer->last_counter = counter;               /* 3. commit before acting */
    return RX_OK;
}
`;

const DOOR_FIXED = C`
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define DOOR_VERSION 2u
#define DOOR_HDR_LEN 6u         /* version, command, counter (4, LE) */
#define DOOR_TAG_LEN 8u
#define DOOR_WINDOW  64u

void mac_compute(const uint8_t *msg, size_t len, uint8_t tag[DOOR_TAG_LEN]);
bool ct_equal(const uint8_t *a, const uint8_t *b, size_t n);
uint32_t nv_counter_read(void);             /* platform: non-volatile storage */
void nv_counter_write(uint32_t value);
bool do_command(uint8_t command);

static uint32_t rd32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

bool door_rx(const uint8_t *rx, size_t n)
{
    uint8_t expect[DOOR_TAG_LEN];
    uint32_t counter, last;

    if (rx == NULL || n != DOOR_HDR_LEN + DOOR_TAG_LEN) {
        return false;                       /* exact length, before any byte is read */
    }
    if (rx[0] != DOOR_VERSION) {
        return false;                       /* untagged version 1 is no longer obeyed */
    }
    mac_compute(rx, DOOR_HDR_LEN, expect);  /* the tag covers the version byte as well */
    if (!ct_equal(expect, rx + DOOR_HDR_LEN, DOOR_TAG_LEN)) {
        return false;                       /* nothing has been stored or obeyed yet */
    }
    counter = rd32(rx + 2);
    last = nv_counter_read();
    if (counter <= last || counter - last > DOOR_WINDOW) {
        return false;                       /* replayed, old, or implausibly far ahead */
    }
    nv_counter_write(counter);              /* commit before acting */
    return do_command(rx[1]);
}
`;

export default {
  id: 'sec-b-replay',
  title: 'Replay and protocol manipulation',
  minutes: 50,
  summary: 'A valid MAC proves who wrote a message, not when. Freshness, what the MAC covers, and why old protocol versions must be refused.',
  skills: ['sec-b-freshness', 'sec-b-protocol-review'],
  blocks: [
    `## The problem

A gate remote sends \`UNLOCK\` with an HMAC computed under a key shared with the gate. Nobody without the key can produce a valid message. An observer with a radio receiver records one press of the button on Monday and transmits the same bytes on Tuesday. The gate checks the MAC; it is valid, because the key holder computed it. The gate opens.

## What the weakness is

A [[Message authentication code]] gives **authenticity** and **integrity**: the message was produced by a key holder and has not been altered. It says nothing about **[[Freshness]]**: whether the message is being delivered now, for the first time, in the context it was created for. Accepting a genuine message a second time is a **[[Replay attack]]** (CWE-294, authentication bypass by capture-replay).

Replay is the simplest member of a family. A message is a sequence of fields; a protocol is a sequence of messages. An adversary positioned on the wire, or on the air, can also:

- **reorder, delay or drop** genuine messages;
- **reflect** a device's own message back to it;
- **redirect** a message meant for unit A to unit B;
- **alter any field the MAC does not cover**, including length, type and version fields;
- **downgrade**: persuade both ends to use an older, weaker version of the protocol that they still support (CWE-757).

None of these requires the key.

## How it arises

Recall the frame model from the protocols section: preamble, length, type, payload, check value. A CRC detects accidental corruption; anyone can recompute it. Replacing the CRC with a MAC protects exactly the bytes that are fed into the MAC function, and nothing else.

The receiver is a state machine with almost no memory. Unless the firmware stores something that changes after each accepted message, two identical frames arriving a day apart are indistinguishable. The design has to *add* state:

- a **monotonic counter** stored on both sides: the sender includes the counter under the MAC and increments it; the receiver accepts only counters greater than the last one it accepted;
- or a **[[Nonce]]** chosen by the receiver for each exchange (**challenge–response**): the receiver sends a fresh random number and accepts only a MAC computed over that number;
- or a **timestamp**, which needs a trustworthy clock on both sides and so is rare on small devices.

Field coverage goes wrong in more mundane ways: the header was added to the protocol after the MAC was designed; a "flags" byte is outside the authenticated region for backward compatibility; the receiver acts on the type byte *before* verifying the tag.

Downgrade arises from compatibility. Version 1 of the protocol had no MAC. Version 2 added one. Firmware that still accepts version 1 frames "for old remotes" lets anyone send version 1 frames.

## What an adversary gains

The ability to cause any action that a genuine party once caused, or to change its meaning: open again, repeat a payment, re-apply an old configuration, re-install an old permission after it was revoked, make unit B obey a command addressed to unit A. Conditions: the adversary can observe the channel and inject onto it. For radio, infrared and any bus that leaves the enclosure, assume both. For a UART on an internal header, the question is whether your threat model includes someone with the case open (lesson 8).`,
    { t: 'predict', q: 'A lock accepts `UNLOCK | counter | HMAC(key, UNLOCK | counter)` if the HMAC is valid and `counter` is greater than the last accepted counter. The fob is pressed out of range of the lock three times while someone records the frames, which carry counters 41, 42 and 43. The lock last accepted 40. What can the recorder do later?', choices: [
      { t: 'Replay any one of the recorded frames once: the lock has not seen those counters', ok: true, why: 'Freshness is judged against the receiver\'s state. Frames the receiver never received have not been used up.' },
      { t: 'Nothing: the counter makes every frame single-use from the moment it is sent', why: 'A frame is used up when the receiver accepts it and advances its counter. These three never arrived.' },
      { t: 'Unlock as often as they like by replaying frame 43 repeatedly', why: 'After the first acceptance the lock\'s counter is 43, and 43 is no longer greater than it.' },
      { t: 'Compute the frame for counter 44 from the three examples', why: 'Producing a MAC for a new counter requires the key; three examples of a sound MAC do not reveal it.' },
    ], reveal: 'A counter stops re-delivery of messages the receiver has accepted. It does not stop first delivery of a message captured where the receiver could not hear it. Challenge–response closes that gap, at the cost of a two-way exchange.' },
    { t: 'callout', kind: 'sim', md: SCOPE + ` The fob and lock are both simulated, and the HMAC is computed with the browser's real cryptographic library.` },
    widget('replay-attack', { defence: 'none' }, 'Run 1: record an unlock and send it again. Note what the lock reports about the MAC.'),
    widget('replay-attack', { defence: 'counter' }, 'Run 2, counter. Replay a frame the lock has already accepted. The channel in this widget is perfect, so every press reaches the lock and it cannot act out the out-of-range presses of your prediction; use the counters it displays to reason about what the lock would do with a recorded frame it had never received.'),
    widget('replay-attack', { defence: 'nonce' }, 'Run 3, challenge–response. Replay a recording again and read the lock\'s reason for its decision. Would a response recorded out of range of the lock be of any use here?'),
    `### Debrief

- **None:** the MAC verified every time. The lock had no way to tell the copy from the original.
- **Counter:** an accepted frame could not be reused. The widget could not show the case from your prediction, but the rule it displayed decides it: a frame captured out of range carries a counter above the lock's stored value, so it stays valid until the lock moves past that counter, and the acceptance *window* (needed so that a few lost presses do not desynchronise the pair) defines how far ahead a frame may be.
- **Nonce:** a response is bound to one challenge that the lock chose and remembers. A recorded response answers a challenge that will not be issued again — provided the nonce is unpredictable and never repeats. A nonce taken from a counter that resets at power-up, or from a weak random generator, repeats, and old responses become valid again.

## What a MAC must cover

Everything the receiver uses to decide what to do:

| Field | If it is outside the MAC |
|---|---|
| Protocol version | downgrade to a weaker format |
| Message type / command | a signed "lock" becomes "unlock" |
| Sender and receiver identity | a frame for unit A is accepted by unit B; a reply is reflected to its sender |
| Counter or nonce | freshness value can be rewritten |
| Length | the payload boundary moves; trailing bytes are appended |
| Payload | obviously |

Use a different key, or at least a different direction byte, for each direction, so that a device never accepts a frame it could have produced itself. Fix the tag length in the receiver; never read it from the frame.`,
    widget('packet-explorer', { challenge: 'find-length-bug' }, 'A receiver that trusts its length field. This widget uses a CRC, not a MAC: work out which of its fields a sender can alter and still present a valid check value, then ask the same question of a frame protected by a MAC that covers only the payload.'),
    `### Debrief of the length field

The receiver used the length field to decide how many bytes to copy. Whoever builds the frame chooses that field and can recompute the CRC to match, so a correct check value said nothing about whether the length was honest. A MAC over the payload alone leaves the same gap: the tag still verifies while an altered length or type byte moves the payload boundary or changes the command. Two defences are needed together: the receiver bounds the length against its own buffer (lessons 1 and 2), and the tag covers every header field.

## How a team detects it

**Review questions:**

- Draw the frame and shade the bytes under the MAC. Is any unshaded byte read by the receiver?
- If this exact frame arrives twice, what distinguishes the second arrival? Where is that state stored, and does it survive a reset and a battery change?
- Is anything done with the frame's contents before the tag is verified, other than the minimum needed to find the tag?
- Which protocol versions does the receiver accept? Is the oldest accepted version as strong as the newest?
- Could a frame from this device be accepted by this device? By a sibling unit?
- Where do nonces come from, and what happens to that source across a power cycle?

**Tests:** capture and re-send in a bench set-up of your own devices (or in a host test that calls the receive function twice with the same bytes); flip each header bit in turn and expect rejection; send frames of every old version.

## The defence`,
    code(COUNTER, 'host-tested', { caption: 'Receive-side checks for a counter-based protocol, in the order they must happen. Tested on the host with a stand-in MAC: replay, reorder, bit flips in every header byte, wrong version, wrong device, window edge, counter at 0xFFFFFFFF.', explain: [
      { lines: '33-36', md: 'The tag length is a constant of the receiver. Everything in front of the tag is authenticated, so there is no unauthenticated header byte.' },
      { lines: '38-43', md: 'Version and addressee are checked before the MAC only to reject early; because both are also inside the MAC, a frame cannot be altered to pass these tests.' },
      { lines: '45-48', md: 'Authenticity first, with a constant-time comparison. Until this passes, no field of the frame is trusted and no state changes.' },
      { lines: '50-53', md: 'Freshness second. If the counter were checked and stored before the MAC, a forged frame with a huge counter would push `last_counter` forward and lock out the genuine sender. `counter - last_counter` is only evaluated when `counter > last_counter`, so it cannot wrap.' },
      { lines: '54', md: 'The new counter is stored before the caller acts on the frame, so a reset during the action cannot make the same frame acceptable again. On a product this is a write to non-volatile memory.' },
    ] }),
    { t: 'callout', kind: 'mistake', title: 'A counter that lives in RAM', md: `If \`last_counter\` returns to zero when the battery is changed, every frame ever recorded becomes fresh again. The counter must be stored in non-volatile memory (with wear in mind: flash endurance is finite, so write on change, or reserve a block of counter values per write) and the sender's counter must persist too. Decide in the design what happens at 0xFFFFFFFF: with the code above the peer stops being accepted and must be re-keyed, which is the safe outcome.` },
    { t: 'callout', kind: 'decision', title: 'Counter or challenge–response?', md: `A **counter** works on a one-way link (a fob that only transmits), needs non-volatile state on both sides, and leaves captured-but-undelivered frames usable within the window. **Challenge–response** needs a two-way link and a good random source in the verifier, needs no long-term state, and leaves nothing to replay. Use challenge–response when the link is bidirectional and the verifier has a hardware random number generator (the MAX78000 and MSPM0L2228 both list a TRNG among their peripherals); use a counter when the sender cannot listen. A timestamp is the right tool only when both ends have a clock an adversary cannot set.` },
    `**Versions.** Put the version inside the MAC, accept exactly the versions the product needs, and plan how old versions are retired: a minimum-version value in non-volatile memory that only moves upward is the protocol equivalent of the anti-rollback counter in lesson 5.

**Encryption does not help with any of this.** A replayed ciphertext decrypts to the same valid plaintext. Use an authenticated encryption mode and put the counter or nonce in its associated data; part A covers the building blocks.

## Verifying the defence

- A host test that feeds the same frame twice and expects \`RX_OK\` then \`RX_REPLAY\`; older counters; counters beyond the window.
- A forged frame with a high counter, followed by a genuine frame: the genuine one must still be accepted.
- A loop that flips each bit of the header and payload in turn and expects rejection for every one.
- Frames with each retired version number, with and without a valid tag.
- Reset and power-cycle between two deliveries of the same frame.
- For challenge–response: collect a few thousand nonces across power cycles and check for repeats; a repeat is a failure, and the absence of repeats is only weak evidence, so also review the source.`,
    { t: 'exercise', prompt: `Review this receive routine for a garage-door receiver. \`rx\` holds \`n\` received bytes: \`[0]\` version, \`[1]\` command, \`[2..5]\` counter, \`[6..13]\` tag over bytes 1 to 5. List the defects (there are at least four), give the consequence of each, and describe the corrected order of operations.`, code: C`
static uint32_t last_counter;            /* RAM */

bool door_rx(const uint8_t *rx, size_t n)
{
    uint8_t expect[8];
    uint32_t counter = rd32(rx + 2);

    if (counter <= last_counter) {
        return false;
    }
    last_counter = counter;

    if (rx[0] == 1) {                    /* v1 remotes have no tag */
        return do_command(rx[1]);
    }
    mac_compute(rx + 1, 5, expect);
    if (memcmp(expect, rx + 6, 8) != 0) {
        return false;
    }
    return do_command(rx[1]);
}`, hints: [
      'Go through the fields one at a time and ask: is this byte under the MAC? Is it used before the MAC is checked?',
      'What happens to `last_counter` when a forged frame with counter 0xFFFFFFFF arrives?',
      'What does a sender have to do to avoid the MAC check entirely? And what happens to `last_counter` at power-up?',
    ], solution: `1. **No length check** — \`n\` is never used; a short frame causes an out-of-bounds read (lesson 1).
2. **Counter updated before authentication** — a forged frame with a large counter is rejected at the MAC but has already advanced \`last_counter\`; the genuine remote is locked out (denial of service). A forged counter of 0xFFFFFFFF does it until the counter is cleared, which (defect 4) happens at the next power cut.
3. **Downgrade** — version 1 frames are obeyed with no tag. Any sender can choose version 1. The version byte is also outside the MAC, so even a tagged frame can have it rewritten.
4. **Counter in RAM** — a power cut resets it to zero and every recorded frame is fresh again.
5. **Variable-time comparison** with \`memcmp\` (lesson 3).
6. No receiver identity under the MAC: a frame for one door opens every door sharing the key. (Keys should be per pair in any case.)

**Corrected order:** check length → check version is exactly the supported one → compute the MAC over *all* bytes before the tag → constant-time compare → check \`counter > last_counter\` and within the window → store the counter in non-volatile memory → act. Retire version 1 remotes or give them a separate, explicitly weaker mode that the owner must enable.

**Corrected version** (compiled with \`-Wall -Wextra -Wconversion\` and tested on the host under ASan/UBSan with a stand-in MAC and a stub for the non-volatile counter). Version 2 frames now carry a tag over bytes 0 to 5, so the version byte is covered:

\`\`\`c
${DOOR_FIXED}\`\`\`

**Tests:** frames of 0, 13 and 15 bytes; the same frame twice; an older counter; a counter 65 ahead; a forged frame with counter 0xFFFFFFFF followed by the genuine next frame, which must still be accepted; version 1 frames with and without a tag; every single-bit change to a valid frame; a simulated restart between two deliveries of one frame. Receiver identity (defect 6) is handled here by giving each remote–door pair its own key.` },
    widget('c-lab', {
      title: 'Add the freshness check',
      prompt: `\`accept\` models the receiver after the MAC has been verified (\`tag_ok\` is 1 for an authentic frame). It currently obeys any authentic frame. Change it so that an authentic frame is obeyed only if its counter is strictly greater than \`last_counter\` and at most \`WINDOW\` ahead, and so that a frame that is not authentic never changes \`last_counter\`.`,
      starter: C`
#include <stdio.h>
#include <stdint.h>

#define WINDOW 16u

static uint32_t last_counter = 40;

int accept(int tag_ok, uint32_t counter)
{
    last_counter = counter;         /* defect: state changes before any check */
    if (!tag_ok) {
        return 0;
    }
    return 1;                       /* defect: no freshness check */
}

int main(void)
{
    printf("%d", accept(1, 41));            /* next press: accept */
    printf("%d", accept(1, 41));            /* same frame again: reject */
    printf("%d", accept(1, 39));            /* older frame: reject */
    printf("%d", accept(0, 5000));          /* forgery with a big counter: reject */
    printf("%d", accept(1, 44));            /* genuine fob, a few presses on: accept */
    printf("%d", accept(1, 44 + 17));       /* too far ahead: reject */
    printf("%d", accept(1, 44 + 16));       /* edge of the window: accept */
    printf(" last=%u\n", last_counter);
    return 0;
}
`,
      solution: C`
#include <stdio.h>
#include <stdint.h>

#define WINDOW 16u

static uint32_t last_counter = 40;

int accept(int tag_ok, uint32_t counter)
{
    if (!tag_ok) {
        return 0;
    }
    if (counter <= last_counter) {
        return 0;
    }
    if (counter - last_counter > WINDOW) {
        return 0;
    }
    last_counter = counter;
    return 1;
}

int main(void)
{
    printf("%d", accept(1, 41));            /* next press: accept */
    printf("%d", accept(1, 41));            /* same frame again: reject */
    printf("%d", accept(1, 39));            /* older frame: reject */
    printf("%d", accept(0, 5000));          /* forgery with a big counter: reject */
    printf("%d", accept(1, 44));            /* genuine fob, a few presses on: accept */
    printf("%d", accept(1, 44 + 17));       /* too far ahead: reject */
    printf("%d", accept(1, 44 + 16));       /* edge of the window: accept */
    printf(" last=%u\n", last_counter);
    return 0;
}
`,
      tests: [{ name: 'replay, reorder, forgery and window', stdout: '1000101 last=60' }],
      hints: [
        'Nothing about the frame may be trusted, or stored, until `tag_ok` has been tested.',
        'Fresh means strictly greater than the last accepted counter. Equal is a replay.',
        'Compute the distance as `counter - last_counter` only after you know `counter > last_counter`, then compare it with `WINDOW`.',
      ],
      explain: 'The order is authenticity, then freshness, then commit. In the starter the forged frame moved `last_counter` to 5000, so the genuine fob at 44 would have been refused from then on.',
    }),
    `## Harder application

In the 2025 eCTF the reference decoder handles frames that carry a 64-bit timestamp (\`timestamp_t\` in the reference source), and the 2025 rules make ordering a security requirement: paraphrased, a Decoder decodes only frames with strictly increasing timestamps, and the property need not hold across power cycles (2025 Security Requirement 3; the other two cover valid, active subscriptions and frames from the Satellite System the Decoder was provisioned for). Read the exact wording on the [2025 rules site](https://rules.ectf.mitre.org/2025/specs/security_reqs.html). What follows is a course design exercise, not official material. Sketch the receive-side state and checks for a broadcast, one-way link with several channels: what is stored, per what, where; what the MAC or AEAD covers; and what must happen at power-up. Then list the tests you would write first.`,
    { t: 'refs', items: [
      { title: 'CWE-294: Authentication Bypass by Capture-replay', url: 'https://cwe.mitre.org/data/definitions/294.html' },
      { title: 'CWE-757: Selection of Less-Secure Algorithm During Negotiation ("Algorithm Downgrade")', url: 'https://cwe.mitre.org/data/definitions/757.html' },
      { title: 'CWE-345: Insufficient Verification of Data Authenticity', url: 'https://cwe.mitre.org/data/definitions/345.html' },
      { title: 'MITRE eCTF 2025 insecure example design (decoder source)', url: 'https://github.com/mitre-cyber-academy/2025-ectf-insecure-example', note: 'Reference design only; the competition rules are published separately by MITRE.' },
      { title: 'MITRE eCTF 2025 rules: security requirements', url: 'https://rules.ectf.mitre.org/2025/specs/security_reqs.html' },
    ] },
  ],
  quiz: [
    { q: 'A sensor sends `reading | HMAC(key, reading)` to a controller over radio. Which statement is true?', kind: 'security', choices: [
      { t: 'The controller learns that a key holder produced the reading, but not when', ok: true, why: 'A second ago and last week look the same. A MAC binds content to a key. Time or sequence must be added to the content, and checked against stored state, to be protected.' },
      { t: 'The HMAC prevents replay because it cannot be computed without the key', why: 'A replayed message does not need to be computed. It was computed by the legitimate sender and is merely sent again.' },
      { t: 'Encrypting the reading as well would prevent replay', why: 'A recorded ciphertext decrypts to the same valid plaintext every time it is delivered.' },
      { t: 'Replay is impossible on radio links because each transmission has different noise', why: 'The receiver demodulates to bits before checking anything, so the same bits are recovered from the copy.' },
    ] },
    { q: 'A frame is `version | type | length | payload | tag`, where `tag = MAC(key, payload)`. Which manipulation succeeds without the key?', kind: 'security', choices: [
      { t: 'Changing `type` from "status" to "unlock" on a captured frame', ok: true, why: 'The payload and tag are kept as captured. The type byte is not an input to the MAC, so the tag still verifies after the byte is changed.' },
      { t: 'Changing one byte of the payload and leaving the tag alone', why: 'The payload is exactly what the MAC covers, so any change to it makes the tag wrong.' },
      { t: 'Replacing the tag with a tag from a frame with a different payload', why: 'A tag is valid only for the payload it was computed over.' },
      { t: 'Computing a new tag for a new payload from two captured examples', why: 'Forging a tag for unseen data is what a sound MAC prevents, however many examples are available.' },
    ] },
    { q: 'In a receive routine, why must the counter be compared and stored only *after* the MAC has been verified?', kind: 'code', choices: [
      { t: 'Otherwise a forged frame with a large counter advances the stored value', ok: true, why: 'Genuine frames are then rejected from that point on. State must change only on authenticated input. An unauthenticated counter is a number chosen by whoever is transmitting.' },
      { t: 'Because computing the MAC is slow and should be done first to save time', why: 'Doing the expensive operation first costs time; the ordering is about which data may be trusted, not about speed.' },
      { t: 'Because the counter is encrypted and must be decrypted by the MAC', why: 'A MAC does not decrypt anything. The counter is readable in the frame and merely not yet trustworthy.' },
      { t: 'The order does not matter as long as both checks are performed', why: 'Both checks reject the forged frame, but one ordering leaves a side effect behind from a frame that was rejected.' },
    ] },
    { q: 'A lock uses challenge–response. Its nonce is `boot_count * 65536 + message_count`, with both values held in RAM. What is the weakness?', kind: 'arch', choices: [
      { t: 'The same nonces are issued again after every power cycle', ok: true, why: 'Recorded responses become valid again. A nonce has to be unique for the life of the key. State that resets at power-up makes it repeat.' },
      { t: 'The nonce is too short: 32 bits can be guessed', why: 'A nonce does not need to be secret or unguessable to prevent replay of old responses; it needs to be one the verifier has never used before.' },
      { t: 'The nonce is sent in the clear, so an observer can read it', why: 'Challenges are public by design. Security rests on the response requiring the key.' },
      { t: 'Multiplication by 65536 can overflow', why: 'The arithmetic is not the security problem; a value that never overflowed but restarted from zero would be just as weak.' },
    ] },
    { q: 'Firmware 3.0 adds authenticated frames (version 2) but still accepts unauthenticated version 1 frames so that old handsets keep working. What is the right description?', kind: 'security', choices: [
      { t: 'A downgrade weakness: anyone can choose to send version 1 frames', ok: true, why: 'The product is only as secure as version 1. The receiver decides how strong the protocol is by what it is willing to accept, and the sender chooses the version.' },
      { t: 'Acceptable, because genuine new handsets always use version 2', why: 'What genuine handsets send is irrelevant to what a third party can send.' },
      { t: 'Acceptable, provided the version byte is included in the version 2 MAC', why: 'That protects version 2 frames from being relabelled. It does nothing about a frame that is version 1 from the start and has no MAC.' },
      { t: 'A replay weakness, fixed by adding a counter to version 2', why: 'A counter in version 2 does not constrain a sender who chooses the version without one.' },
    ] },
    { q: 'You are writing the regression test for a counter-based receiver. Which sequence gives the strongest evidence?', kind: 'code', choices: [
      { t: 'Accept a frame; reject it again; reject a forged huge counter; accept the next frame; reset; reject the first', ok: true, why: 'It covers replay, state changes caused by unauthenticated input, and persistence across reset, each with an observable expected result.' },
      { t: 'One hundred valid frames with increasing counters, sent across two resets, all accepted', why: 'That shows the receiver works for honest traffic. A receiver with no freshness check at all would also pass.' },
      { t: 'A frame with a wrong tag (reject), then the same frame with the right tag (accept)', why: 'That tests authenticity only. A replayed frame carries a correct tag.' },
      { t: 'The same frame sent twice, with a reset in between, both accepted', why: 'A second acceptance after a reset is the failure the test should detect, not the expected result.' },
    ] },
  ],
};
export const TESTED = { COUNTER, DOOR_FIXED };
