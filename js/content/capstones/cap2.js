// Capstone 2: multi-microcontroller communication.
const FRAME_C = String.raw`#include <stdint.h>
#include <stddef.h>
#include <string.h>

/* CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000. */
uint16_t crc16_ccitt(const uint8_t *data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)data[i] << 8;
        for (int b = 0; b < 8; b++)
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
    return crc;
}

/* Frame on the wire: SOF(0x7E) SEQ LEN PAYLOAD[LEN] CRC_HI CRC_LO.
   CRC covers SEQ, LEN and PAYLOAD. Returns bytes written, or 0 if it would overflow. */
size_t frame_encode(uint8_t seq, const uint8_t *payload, uint8_t len,
                    uint8_t *out, size_t out_cap) {
    if ((size_t)len + 5 > out_cap) return 0;
    size_t n = 0;
    out[n++] = 0x7E;
    out[n++] = seq;
    out[n++] = len;
    memcpy(out + n, payload, len);
    n += len;
    uint16_t crc = crc16_ccitt(out + 1, (size_t)len + 2); /* seq,len,payload */
    out[n++] = (uint8_t)(crc >> 8);
    out[n++] = (uint8_t)(crc & 0xFF);
    return n;
}

/* Returns 1 and fills seq, payload and len on a good frame. Returns 0, writing nothing,
   on a bad marker, a length that disagrees with n, a payload larger than payload_cap, or a bad CRC. */
int frame_decode(const uint8_t *in, size_t n, uint8_t *seq,
                 uint8_t *payload, size_t payload_cap, uint8_t *len) {
    if (n < 5 || in[0] != 0x7E) return 0;
    uint8_t l = in[2];
    if ((size_t)l + 5 != n) return 0;
    if (l > payload_cap) return 0;          /* bound the copy before anything is copied */
    uint16_t want = ((uint16_t)in[n - 2] << 8) | in[n - 1];
    uint16_t got = crc16_ccitt(in + 1, (size_t)l + 2);
    if (want != got) return 0;
    *seq = in[1];
    *len = l;
    memcpy(payload, in + 3, l);
    return 1;
}`;

const lab = {
  id: 'cap-2',
  title: 'Capstone 2: multi-microcontroller communication',
  kind: 'Capstone', minutes: 540,
  summary: 'Design a framed protocol between two or more MCUs, make it survive errors, and prove it with an interoperability test.',
  skills: ['cap-method', 'cap-linkproto', 'cap-interop'],
  requires: ['protocols', 'embedded-c'],
  objectives: [
    'Write a protocol specification precise enough for someone else to implement from it.',
    'Implement framing, sequence numbers, CRC, acknowledgement, timeout and bounded retry.',
    'Write a streaming receiver as a state machine that resynchronises after garbage.',
    'Keep error counters and expose them, so link health is measured and not guessed.',
    'Define and run an interoperability test, including injected faults.',
  ],
  hardware: [
    'Two microcontroller boards you own (two ESP32 boards, or an ESP32 and any other MCU — different chips make a better test)',
    'Three jumper wires for UART (TX, RX, GND), or four for I2C/SPI plus pull-ups for I2C',
    'If the boards use different logic levels, a level shifter: check both datasheets before connecting anything',
    'Logic analyser or USB-UART adapter to observe and inject traffic (strongly recommended)',
  ],
  software: [
    'ESP-IDF (or the SDK for your second MCU)',
    'A host C compiler (`gcc`) to unit-test the protocol code off-target',
    'Python with pyserial, if you use a USB-UART adapter as a fault injector',
  ],
  background: [
    `A wire between two boards delivers bytes, sometimes. It does not tell the receiver where a message starts, whether a byte was damaged, whether a message was lost, or whether the other board has just reset. Everything a link needs beyond raw bytes is your protocol.

The brief: **one node (the controller) sends commands to at least one other node and receives responses and unsolicited events, reliably, over UART, I2C or SPI.** "Reliably" means every command is executed exactly once or reported as failed, even when bytes are corrupted or dropped.`,
    `### The four problems and the standard tools

| Problem | Tool | What you must decide |
|---|---|---|
| Where does a frame start and end? | Start marker plus length, or delimiter with byte stuffing | What happens when the marker value appears inside the payload |
| Was it damaged? | CRC over header and payload | Which CRC, which fields it covers, byte order on the wire |
| Was it lost or duplicated? | Sequence number plus acknowledgement | Width, wrap-around, what a duplicate looks like |
| Is the peer alive? | Timeout plus bounded retry | Timeout value derived from baud rate and frame size, retry count, what happens when retries run out |`,
    { t: 'callout', kind: 'security', md: 'A CRC detects accidental damage. It gives no protection against someone who changes a frame deliberately, because anyone can recompute it. Authenticated messages are capstones 4 and 6; say in your specification that this protocol assumes a non-hostile wire.' },
    { t: 'widget', name: 'packet-explorer', caption: 'Simulation: build a frame, flip a bit, and watch which checks catch it.' },
  ],
  diagram: [
    { t: 'ascii', text: String.raw`
  Node A (controller)                        Node B (peripheral)
  +-----------------+   TX ------------> RX  +-----------------+
  | app             |   RX <------------ TX  | app             |
  | link layer      |   GND ------------ GND | link layer      |
  | UART driver     |                        | UART driver     |
  +-----------------+                        +-----------------+
              \__ logic analyser / USB-UART tap on both lines __/`, caption: 'UART version. Common ground is not optional. For I2C or SPI, draw controller/peripheral roles and pull-ups.' },
    { t: 'ascii', text: String.raw`
 byte:   0      1     2     3 .. 3+LEN-1    last two
       +------+-----+-----+--------------+----------+
       | SOF  | SEQ | LEN |   PAYLOAD    |  CRC16   |
       | 0x7E |     |     |              | hi, lo   |
       +------+-----+-----+--------------+----------+
                \______ CRC covers these ______/`, caption: 'The starting frame used by the helper below. Your final format needs at least a type field; extending it is part of the work.' },
    { t: 'ascii', text: String.raw`
 A: DATA seq=5 ------------------>  B: CRC ok, new seq -> execute, ACK 5
 A: <------------------- ACK 5
 A: DATA seq=6 -----X (lost)
 A: timeout, resend DATA seq=6 -->  B: execute, ACK 6
 A: <-----X (ACK lost)
 A: timeout, resend DATA seq=6 -->  B: seq already seen -> do NOT execute, ACK 6 again`, caption: 'The three cases your implementation must handle: clean, lost frame, lost acknowledgement.' },
  ],
  steps: [
    { title: 'Milestone 0: write the specification', md: `Before any code, write a two-page specification: physical layer (bus, speed, levels), frame format with every field's size and byte order, CRC parameters with a test vector, message types, the acknowledgement rule, timeout and retry values with the arithmetic behind them, and behaviour after a peer reset. The test of a specification is whether a classmate could build a compatible node from it alone.` },
    { title: 'Milestone 1: frame encode/decode on the host', md: `Start from this helper. It was compiled with \`gcc -Wall -Wextra -std=c11\` and run on a host with a small test \`main\` (round trip, a one-bit corruption that must be rejected, a frame whose payload is larger than the caller's buffer, and the standard check value: the CRC of the ASCII string \`123456789\` is \`0x29B1\`). Read the order of the checks in \`frame_decode\`: marker, then length against what was received, then length against the destination buffer, then CRC, and only then the copy. Nothing from the wire is used as a size until it has been bounded. It was not run on a microcontroller. Extend it with a type field and write your own host tests first.`, code: FRAME_C, lang: 'c', status: 'host-tested' },
    { title: 'Milestone 2: a streaming receiver', md: `\`frame_decode\` assumes you already hold exactly one frame. A UART gives you one byte at a time, starting anywhere. Write the receiver as a state machine (WAIT_SOF, SEQ, LEN, PAYLOAD, CRC) fed one byte per call. Decide what it does on an impossible length, on a timeout in mid-frame, and when 0x7E appears inside a payload. Test it on the host by feeding it frames preceded by random garbage.`,
      blocks: [{ t: 'widget', name: 'state-machine', props: { machine: 'uart-parser' }, caption: 'Step a byte-at-a-time parser and see where bad input sends it.' }] },
    { title: 'Milestone 3: reliability layer', md: `Add stop-and-wait delivery: send, start a timer, wait for the matching ACK, retry a bounded number of times, then report failure to the application. On the receiving side, remember the last sequence number executed so a retransmitted command is acknowledged but not executed twice. Still on the host: connect two instances through a function that can drop or corrupt bytes on demand.` },
    { title: 'Milestone 4: bring it up on two boards', md: `Port the link layer unchanged; only the byte-in/byte-out functions should differ per board. Verify with a logic analyser that the bytes on the wire match the specification's test vector before debugging anything higher up.`,
      code: String.raw`/* The only board-specific surface the link layer should need. */
int  link_port_write(const uint8_t *buf, size_t n);          /* returns bytes queued */
int  link_port_read_byte(uint8_t *b, uint32_t timeout_ms);   /* 1 = got a byte, 0 = timeout */
uint32_t link_port_now_ms(void);`, lang: 'c', status: 'pseudo' },
    { title: 'Milestone 5: counters and a status command', md: `Count at least: frames sent, frames received, CRC failures, framing/length errors, timeouts, retransmissions, duplicates dropped, deliveries failed. Add a message type that returns them. These counters are what turns "it seems flaky" into a number.` },
    { title: 'Milestone 6: interoperability and fault tests', md: `Run the test plan below. If you can, swap specifications with another learner and test your node against theirs; every mismatch is either a bug or an ambiguity in a specification, and both are worth finding.` },
  ],
  walkthrough: [
    `Decisions to justify in your report:

- **Marker plus length, or stuffing (SLIP/COBS style)?** Marker plus length is simple but a corrupted length byte can make the receiver wait for bytes that never come; what bounds that wait? Stuffing makes resynchronisation certain at the cost of variable frame size.
- **How wide is the sequence number?** With stop-and-wait, even one bit distinguishes new from duplicate. More bits help diagnostics. What happens at wrap-around?
- **Where does the timeout come from?** Compute the time to transmit a maximum-size frame at your baud rate (ten bit times per byte for 8N1), add the peer's worst processing time and the ACK's transmit time, then add margin. A guessed timeout is either slow or produces false retries.
- **What happens when a node resets?** Its sequence state is gone. Does it resynchronise, or will it reject the peer's next frame as a duplicate?
- **Who may talk when?** On UART both ends can transmit at once; on I2C and SPI the peripheral cannot start a transfer. How do unsolicited events get out?`,
    { t: 'callout', kind: 'mistake', md: 'Executing a command before checking its CRC, or checking the length field against the buffer size after copying. Validate length against your buffer first, then CRC, then act — an unchecked length byte is the classic way a protocol parser overflows.' },
    { t: 'callout', kind: 'decision', md: 'Keeping the link layer free of board headers costs a small porting interface and buys host unit tests, a fault-injecting loopback and a second platform for free.' },
  ],
  testing: [
    `| Test | Procedure | You should see |
|---|---|---|
| Conformance | Capture one frame of each type with a logic analyser | Bytes identical to the specification's test vectors |
| Clean throughput | Send 10 000 commands | 10 000 executed, zero retries, zero CRC errors |
| Bit corruption | Inject frames with a flipped bit (host tap or a deliberately wrong CRC build) | CRC-failure counter rises by the number injected; no corrupted command executes |
| Frame loss | Break the TX wire briefly during traffic | Retransmissions counted; each command executed exactly once |
| ACK loss | Break the reverse wire briefly | Duplicates-dropped counter rises; no command executed twice |
| Peer reset | Reset node B during traffic | A reports failure or recovers per your specification, within a stated time; no hang |
| Garbage | Send random bytes, then a valid frame | The valid frame is received |
| Interoperability | Run against an independently written node | All of the above still pass |

"Exactly once" needs evidence: make the test command increment a counter on B and compare it with the number A believes succeeded.`,
    { t: 'widget', name: 'protocol-debug', props: { scenario: 'no-common-ground' }, caption: 'Simulation: a physical-layer fault that looks like a protocol bug.' },
  ],
  troubleshooting: [
    { symptom: 'Nothing received at all', cause: 'TX and RX not crossed, no common ground, or different baud rates.', fix: 'Check the wire with a logic analyser before touching the code; decode at the baud rate you believe you set.' },
    { symptom: 'CRC always fails between the two boards but passes on each alone', cause: 'The two implementations differ in CRC parameters, covered fields or byte order.', fix: 'Compare both against the specification test vector and fix the specification if it was ambiguous.' },
    { symptom: 'Commands occasionally execute twice', cause: 'The receiver does not remember the last executed sequence number, or forgets it on a path such as a CRC error.', fix: 'Run the ACK-loss test on the host loopback and step through the duplicate case.' },
    { symptom: 'Link locks up after a burst of noise', cause: 'The receiver is waiting for a payload whose corrupted length will never arrive.', fix: 'Add an inter-byte timeout that returns the parser to WAIT_SOF, and reject lengths above your maximum immediately.' },
    { symptom: 'Many retries on a clean wire', cause: 'Timeout shorter than the real frame time plus processing, or the receive buffer overflowing while a task is busy.', fix: 'Recompute the timeout from the baud rate, and check the driver\'s overflow indication and buffer size.' },
  ],
  challenge: `Replace stop-and-wait with a sliding window of at least four frames and measure the throughput gain at your baud rate. Then add a third node and decide how addressing and bus access work. State which of your original tests had to change, and why.`,
  quiz: [
    { q: 'The ACK for frame 6 is lost and the sender retransmits frame 6. What must the receiver do?', kind: 'arch', choices: [
      { t: 'Acknowledge it again without executing it', ok: true, why: 'Correct: the sender needs the ACK to move on, and executing again would break exactly-once delivery.' },
      { t: 'Ignore it silently because it is a duplicate', why: 'Without an acknowledgement the sender keeps retrying and finally reports a failure for a command that actually ran.' },
      { t: 'Execute it again and acknowledge', why: 'That runs the command twice, which is harmless for "read status" and wrong for "advance motor one step".' },
    ] },
    { q: 'At 115200 baud, 8N1, roughly how long does a 64-byte frame take to transmit?', kind: 'concept', choices: [
      { t: 'About 5.6 ms', ok: true, why: 'Correct: 64 bytes × 10 bit times = 640 bits, and 640 / 115200 s ≈ 5.6 ms.' },
      { t: 'About 0.56 ms', why: 'This forgets one factor of ten; each byte costs a start bit, eight data bits and a stop bit.' },
      { t: 'About 4.4 ms', why: 'This counts only the eight data bits per byte and leaves out the start and stop bits.' },
    ] },
    { q: 'A receiver copies LEN payload bytes into a 32-byte buffer and then verifies the CRC. What is wrong?', kind: 'security', code: 'memcpy(buf, in + 3, in[2]);\nif (crc_ok(in, n)) handle(buf);', choices: [
      { t: 'LEN is used before it is checked against the buffer size, so a bad frame overflows the buffer', ok: true, why: 'Correct: the length byte comes from the wire and can be up to 255; it must be bounded before any copy.' },
      { t: `The CRC is computed over the input, but it is the copy in \`buf\` that gets handled, so the two can differ`, why: 'Either location gives the same result; the fault is that the copy happens with an unvalidated length.' },
      { t: `memcpy is unsafe in protocol code; a byte-by-byte loop would have stopped at the end of the frame`, why: 'memcpy is fine when the length has been validated; the function is not the problem.' },
    ] },
    { q: 'Why does a CRC not protect against a deliberate attacker on the wire?', kind: 'security', choices: [
      { t: `It uses no secret, so anyone who alters a frame can compute a matching CRC`, ok: true, why: 'Correct: integrity against an adversary needs a keyed MAC or a signature.' },
      { t: `A 16-bit CRC misses a large share of single-bit errors, and an attacker needs only one`, why: 'CRCs are very good at accidental errors, including every single-bit error; the weakness is the absence of a key.' },
      { t: `16 bits is too few to resist guessing; a 32-bit CRC would be secure`, why: 'A longer CRC is still computable by anyone, so width does not add authentication.' },
    ] },
    { q: 'Why test against an independently written implementation?', kind: 'concept', choices: [
      { t: `Two nodes built from the same code share the same misreading of the specification, so they agree even when both are wrong`, ok: true, why: 'Correct: interoperability testing finds ambiguities and assumptions that self-testing cannot.' },
      { t: `A second implementation doubles the amount of traffic, so rare bit errors show up sooner`, why: `Traffic volume does not depend on who wrote the peer. Think about what two separate readings of one document can disagree on.` },
      { t: `Passing against an independent node shows the protocol is robust, so fault injection is no longer needed`, why: 'Fault tests are still required; interoperability and robustness are separate properties.' },
    ] },
  ],
  requirements: {
    functional: [
      'FR-1: at least two nodes exchange commands, responses and one unsolicited event type.',
      'FR-2: every frame carries a sequence number and a CRC covering header and payload.',
      'FR-3: a frame failing length or CRC checks is discarded and counted, and never acted on.',
      'FR-4: each command is executed exactly once or reported to the sender as failed after a bounded number of retries.',
      'FR-5: the receiver resynchronises after arbitrary garbage within one maximum frame time plus the inter-byte timeout.',
      'FR-6: each node exposes its error counters through the protocol.',
      'FR-7: a peer reset is detected or recovered from within a time you state; no node hangs.',
    ],
  },
  rubric: [
    { criterion: 'Protocol specification', points: 20, evidence: 'Document with frame layout, CRC parameters and test vector, state diagrams, timeout arithmetic.' },
    { criterion: 'Host unit tests', points: 15, evidence: 'Test source and output covering encode/decode, streaming parser with garbage, duplicate and loss cases.' },
    { criterion: 'Two-board operation', points: 20, evidence: 'Logic-analyser capture (or a byte dump from a serial tap) of one frame per type, annotated against the specification; counters from both nodes after the 10 000-command run.' },
    { criterion: 'Robustness', points: 20, evidence: 'Counter values before and after each fault test; exactly-once evidence from the remote counter.' },
    { criterion: 'Interoperability', points: 10, evidence: 'Results against an independent implementation, or a written list of specification ambiguities you found and fixed.' },
    { criterion: 'Code quality', points: 15, evidence: 'The command line that compiles the link layer on a host with no board headers, and its output; file and line of every check that bounds a length before it is used; the body of each ISR, showing no blocking call.' },
  ],
};

export default { skills: [], lessons: [], labs: [lab], glossary: [], troubleshooting: [], refs: [] };
