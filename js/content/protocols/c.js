// Protocols, part C: framing, checksums and CRC, arbitration, troubleshooting.

// Build a test frame for the parser C lab: SOF, LEN, payload, sum8(LEN + payload).
const frame = (s) => {
  const body = [s.length, ...[...s].map((c) => c.charCodeAt(0))];
  return '\x7E' + String.fromCharCode(...body, body.reduce((a, x) => (a + x) & 0xFF, 0));
};

const CRC_REF = String.raw`/* crc_ref.c - integrity checks used in this section.
 * Build: gcc -Wall -Wextra -std=c11 crc_ref.c -o crc_ref && ./crc_ref */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

uint8_t sum8(const uint8_t *p, size_t n)
{
    uint8_t s = 0;
    while (n--) s = (uint8_t)(s + *p++);      /* wraps modulo 256 */
    return s;
}

uint8_t xor8(const uint8_t *p, size_t n)
{
    uint8_t x = 0;
    while (n--) x ^= *p++;
    return x;
}

/* CRC-8: poly 0x07, init 0x00, not reflected, xorout 0x00 */
uint8_t crc8(const uint8_t *p, size_t n)
{
    uint8_t crc = 0x00;
    while (n--) {
        crc ^= *p++;                              /* bring in the next 8 message bits */
        for (int i = 0; i < 8; i++)
            crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1);
    }
    return crc;
}

/* CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, not reflected, xorout 0x0000 */
uint16_t crc16_ccitt_false(const uint8_t *p, size_t n)
{
    uint16_t crc = 0xFFFF;
    while (n--) {
        crc ^= (uint16_t)(*p++ << 8);             /* MSB-first: byte enters at the top */
        for (int i = 0; i < 8; i++)
            crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    }
    return crc;
}

/* Reflected CRC-16, poly 0x8005 (written reflected as 0xA001).
 * init 0x0000 gives CRC-16/ARC; init 0xFFFF gives CRC-16/MODBUS. */
uint16_t crc16_reflected(const uint8_t *p, size_t n, uint16_t init)
{
    uint16_t crc = init;
    while (n--) {
        crc ^= *p++;                              /* LSB-first: byte enters at the bottom */
        for (int i = 0; i < 8; i++)
            crc = (crc & 1) ? (uint16_t)((crc >> 1) ^ 0xA001) : (uint16_t)(crc >> 1);
    }
    return crc;
}

/* CRC-32 (IEEE 802.3, zlib, PNG): poly 0x04C11DB7 reflected = 0xEDB88320,
 * init 0xFFFFFFFF, reflected, xorout 0xFFFFFFFF */
uint32_t crc32_ieee(const uint8_t *p, size_t n)
{
    uint32_t crc = 0xFFFFFFFFu;
    while (n--) {
        crc ^= *p++;
        for (int i = 0; i < 8; i++)
            crc = (crc & 1) ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
    }
    return crc ^ 0xFFFFFFFFu;
}

int main(void)
{
    const uint8_t msg[] = "123456789";            /* the conventional check string */
    const size_t n = 9;                           /* without the terminating NUL */
    int fail = 0;

    printf("sum8          = 0x%02X\n", (unsigned)sum8(msg, n));
    printf("xor8          = 0x%02X\n", (unsigned)xor8(msg, n));
    printf("CRC-8         = 0x%02X\n", (unsigned)crc8(msg, n));
    printf("CRC-16/CCITT-FALSE = 0x%04X\n", (unsigned)crc16_ccitt_false(msg, n));
    printf("CRC-16/ARC    = 0x%04X\n", (unsigned)crc16_reflected(msg, n, 0x0000));
    printf("CRC-16/MODBUS = 0x%04X\n", (unsigned)crc16_reflected(msg, n, 0xFFFF));
    printf("CRC-32        = 0x%08lX\n", (unsigned long)crc32_ieee(msg, n));

    fail |= sum8(msg, n) != 0xDD;
    fail |= xor8(msg, n) != 0x31;
    fail |= crc8(msg, n) != 0xF4;
    fail |= crc16_ccitt_false(msg, n) != 0x29B1;
    fail |= crc16_reflected(msg, n, 0x0000) != 0xBB3D;
    fail |= crc16_reflected(msg, n, 0xFFFF) != 0x4B37;
    fail |= crc32_ieee(msg, n) != 0xCBF43926u;

    /* A swap of two bytes: the sum cannot see it, the CRC can. */
    const uint8_t a[] = { 0x12, 0x34, 0x56 }, b[] = { 0x34, 0x12, 0x56 };
    printf("swap: sum8 %02X vs %02X, crc8 %02X vs %02X\n",
           (unsigned)sum8(a, 3), (unsigned)sum8(b, 3), (unsigned)crc8(a, 3), (unsigned)crc8(b, 3));
    fail |= sum8(a, 3) != sum8(b, 3);
    fail |= crc8(a, 3) == crc8(b, 3);

    puts(fail ? "FAIL" : "all check values match");
    return fail;
}
`;

const COBS_REF = String.raw`/* cobs.c - Consistent Overhead Byte Stuffing: remove every 0x00 from a packet
 * so that 0x00 can be used as an unambiguous frame delimiter.
 * Build: gcc -Wall -Wextra -std=c11 cobs.c -o cobs && ./cobs */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

/* Encodes n bytes; out needs n + n/254 + 1 bytes. Returns the encoded length (no delimiter). */
size_t cobs_encode(const uint8_t *in, size_t n, uint8_t *out)
{
    size_t w = 1, code_at = 0;                    /* out[code_at] is filled in later */
    uint8_t code = 1;                             /* distance to the next zero */
    for (size_t i = 0; i < n; i++) {
        if (in[i] == 0) {
            out[code_at] = code; code_at = w++; code = 1;
        } else {
            out[w++] = in[i];
            if (++code == 0xFF) {                 /* 254 non-zero bytes in a row */
                out[code_at] = code; code = 1;
                if (i + 1 < n) code_at = w++; else return w;
            }
        }
    }
    out[code_at] = code;
    return w;
}

/* Decodes n bytes (no delimiter). Returns the decoded length, or (size_t)-1 if malformed. */
size_t cobs_decode(const uint8_t *in, size_t n, uint8_t *out)
{
    size_t r = 0, w = 0;
    while (r < n) {
        uint8_t code = in[r++];
        if (code == 0 || r + code - 1 > n) return (size_t)-1;
        for (uint8_t i = 1; i < code; i++) {
            if (in[r] == 0) return (size_t)-1;    /* a zero inside a frame is corruption */
            out[w++] = in[r++];
        }
        if (code != 0xFF && r < n) out[w++] = 0;  /* the zero this code byte stood for */
    }
    return w;
}

static int check(const uint8_t *raw, size_t n, const uint8_t *want, size_t wn)
{
    uint8_t enc[600], dec[600];
    size_t en = cobs_encode(raw, n, enc);
    if (want && (en != wn || memcmp(enc, want, wn) != 0)) return 1;
    for (size_t i = 0; i < en; i++) if (enc[i] == 0) return 1;      /* never a zero */
    size_t dn = cobs_decode(enc, en, dec);
    return dn != n || memcmp(dec, raw, n) != 0;                      /* round trip */
}

int main(void)
{
    int fail = 0;
    const uint8_t r1[] = { 0x00 },                   e1[] = { 0x01, 0x01 };
    const uint8_t r2[] = { 0x00, 0x00 },             e2[] = { 0x01, 0x01, 0x01 };
    const uint8_t r3[] = { 0x11, 0x22, 0x00, 0x33 }, e3[] = { 0x03, 0x11, 0x22, 0x02, 0x33 };
    const uint8_t r4[] = { 0x11, 0x22, 0x33, 0x44 }, e4[] = { 0x05, 0x11, 0x22, 0x33, 0x44 };
    const uint8_t r5[] = { 0x11, 0x00, 0x00, 0x00 }, e5[] = { 0x02, 0x11, 0x01, 0x01, 0x01 };
    fail |= check(r1, sizeof r1, e1, sizeof e1);
    fail |= check(r2, sizeof r2, e2, sizeof e2);
    fail |= check(r3, sizeof r3, e3, sizeof e3);
    fail |= check(r4, sizeof r4, e4, sizeof e4);
    fail |= check(r5, sizeof r5, e5, sizeof e5);

    uint8_t big[520];                                /* pseudo-random round trips, all lengths */
    uint32_t x = 12345;
    for (size_t n = 0; n <= sizeof big; n++) {
        for (size_t i = 0; i < n; i++) { x = x * 1664525u + 1013904223u; big[i] = (uint8_t)((x >> 24) % 5 ? x >> 16 : 0); }
        fail |= check(big, n, NULL, 0);
    }
    for (size_t i = 0; i < 254; i++) big[i] = (uint8_t)(i + 1);     /* 254 non-zero bytes */
    uint8_t enc[600];
    fail |= cobs_encode(big, 254, enc) != 255 || enc[0] != 0xFF;

    const uint8_t bad[] = { 0x05, 0x11, 0x22 };      /* code points past the end */
    uint8_t tmp[16];
    fail |= cobs_decode(bad, sizeof bad, tmp) != (size_t)-1;

    puts(fail ? "FAIL" : "COBS vectors and round trips pass");
    return fail;
}
`;

const lessons = [
  // ------------------------------------------------------------------ 9
  {
    id: 'proto-framing', title: 'Data framing and packet structures', minutes: 50,
    summary: 'Turning a stream of bytes into messages: delimiters, byte stuffing, length fields, headers, and a parser that recovers from garbage.',
    skills: ['proto-frame-design'],
    blocks: [
      `## The problem
Two boards are linked by a UART. Board A sends a 6-byte reading every 100 ms. Board B calls "read 6 bytes" in a loop. It works for an hour. Then one byte is lost to noise, and from that moment every reading B decodes is made of the tail of one message and the head of the next. It never recovers, and every value is plausible enough not to look broken.

A UART delivers **bytes**. It has no idea where your messages start or end. Deciding that is **framing**, and it is your job. A framing scheme must answer three questions:

1. Where does a message **start**?
2. Where does it **end**?
3. After an error, how does the receiver **find the next start**? (resynchronisation)

The third is the one beginners leave out, and it is the difference between a link that glitches and a link that dies.

## Four ways to mark boundaries
**1. Time gaps.** A message is whatever arrives between two silences. Modbus RTU does this: frames are separated by at least 3.5 character times of idle line. No overhead, and it resynchronises at every gap, but it needs precise timing, and anything that inserts delays (a USB adapter, an operating-system buffer, a radio link) destroys the gaps.

**2. Delimiters in text.** Messages are lines ending in \`\\n\`. GPS receivers (NMEA sentences start with \`$\` and end with CR LF) and AT-command modems do this. Easy to read in a terminal, easy to resynchronise. Works because the payload is restricted to printable characters, which is also the cost: binary data must be converted to hex or Base64, roughly doubling or adding a third to its size.

**3. Delimiters with byte stuffing.** For binary payloads a delimiter value will eventually appear inside the data. **Byte stuffing** rewrites the payload so that it cannot.

- **SLIP** (RFC 1055) ends every frame with the byte 0xC0 (END). Inside the data, 0xC0 is replaced by the two bytes 0xDB 0xDC, and 0xDB itself by 0xDB 0xDD. Simple; the worst case doubles the frame.
- **COBS** (consistent overhead byte stuffing) removes all 0x00 bytes so that 0x00 can be the delimiter. It replaces each zero with a count of how many non-zero bytes follow before the next zero. The overhead is fixed and small: one byte per 254, whatever the data.

With either, resynchronisation is trivial and certain: wait for the next delimiter. A delimiter can never be data.

**4. Start marker plus length.** A start-of-frame byte, then a length field, then that many bytes. No transformation of the payload, and the receiver knows in advance how much to expect. But the start byte *can* occur inside the payload, so a receiver that is out of step may lock onto a false start. A check value over the frame (next lesson) is what exposes a false start; the parser then has to hunt again.`,
      { t: 'ascii', caption: 'COBS by example: each code byte says "the next zero (or the end) is this many bytes ahead"',
        text:
`raw:      11 22 00 33
encoded:  03 11 22 02 33  00
          |        |      +-- frame delimiter (the only zero on the wire)
          |        +-- 2: one data byte follows, then the end of the frame
          +-- 3: two data bytes follow, then there was a zero

raw:      11 00 00 00
encoded:  02 11 01 01 01  00` },
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'COBS encoder and decoder with self-test (compiled with gcc -Wall -Wextra -std=c11 and run; prints "COBS vectors and round trips pass")',
        code: COBS_REF,
        explain: [
          { lines: '10-26', md: 'The encoder keeps a hole in the output (`code_at`) for the code byte of the current run and fills it in when it meets a zero or the end. `code` counts the non-zero bytes written since the hole, plus one.' },
          { lines: '19-22', md: 'A run of 254 non-zero bytes fills the code byte to 0xFF, which means "254 data bytes follow and there was **no** zero". A new run then starts. This is where the one-byte-per-254 overhead comes from.' },
          { lines: '34-35', md: 'The decoder rejects a code that is zero or that points past the end of the buffer **before** it copies anything. A decoder that trusts the code byte is a buffer over-read waiting for a corrupted frame.' },
          { lines: '37', md: 'A zero inside the encoded data can only be corruption or a mis-detected frame boundary. Reject, do not guess.' },
        ] },
      `## Anatomy of a frame
A typical binary frame, the kind you will design in Lab B:`,
      { t: 'ascii', caption: 'A length-prefixed frame. The numbers are byte offsets.',
        text:
`  0      1      2      3      4      5 ... 4+LEN   5+LEN  6+LEN
+------+------+------+------+------+-------------+------+------+
| SOF  | VER  | TYPE | SEQ  | LEN  |   PAYLOAD   |   CRC-16    |
| 0x7E |      |      |      |      |  LEN bytes  |  hi  |  lo  |
+------+------+------+------+------+-------------+------+------+
        \\________________ covered by the CRC ___/` },
      `- **SOF** (start of frame): a fixed byte to hunt for.
- **VER**: protocol version. One byte now saves a painful migration later: a receiver can reject, or adapt to, frames from newer firmware instead of misreading them.
- **TYPE**: what the message is, which tells the receiver how to interpret the payload.
- **SEQ**: a sequence number. Lets a reply be matched to its request, and lets a receiver notice lost or repeated frames.
- **LEN**: how many payload bytes follow.
- **PAYLOAD**.
- **CRC**: a check over everything after SOF.

### Endianness on the wire
Any field wider than one byte needs a stated byte order. The value 0x1234 can be sent as 12 34 (**big-endian**, most significant byte first, also called network order) or 34 12 (**little-endian**). Neither is better; unstated is the bug. Write it in the protocol document, and never rely on the CPU's own order by copying a struct onto the wire: the layout of a C struct (padding, alignment, byte order) belongs to the compiler and the CPU, not to your protocol. Serialise field by field with shifts:

\`buf[0] = (uint8_t)(v >> 8); buf[1] = (uint8_t)v;\` &nbsp; and &nbsp; \`v = (uint16_t)((buf[0] << 8) | buf[1]);\`

That code produces the same bytes on every machine.`,
      { t: 'widget', name: 'endianness', props: { value: 0x12345678 }, caption: 'See the same 32-bit value laid out in both byte orders, then do the network-order task.' },
      `### TLV: fields that describe themselves
When messages will grow new optional fields, encode each one as **type, length, value**: a tag byte, a length byte, then the data. A receiver that meets an unknown tag reads its length and skips it. Old firmware keeps working with new messages. The cost is two bytes per field and a parser that must check every length against the bytes remaining.

## The receiver is a state machine
Bytes arrive one at a time, in an interrupt or a polling loop, and a frame may be split across any number of reads. So the parser cannot be written as "read header, then read payload". It must remember where it is between bytes. That is a **state machine**: one state per part of the frame, one byte in, at most one transition.`,
      { t: 'widget', name: 'state-machine', props: { machine: 'uart-parser' }, caption: 'Feed the parser bytes one at a time. Try a frame with a wrong check byte, and a byte of garbage before the SOF.' },
      { t: 'predict', q: 'A receiver uses SOF + LEN + payload + checksum framing with a 16-byte payload buffer. Noise corrupts a LEN byte from 0x04 to 0xC4 (196). The parser has no length check and no timeout. What happens next?',
        choices: [
          { t: 'It writes 196 bytes into the 16-byte buffer and swallows the following frames', ok: true, why: 'The parser believes the length. It keeps storing bytes past the end of the buffer and treats the next several real frames as payload of the damaged one.' },
          { t: 'The checksum fails at the end, so the frame is dropped and no harm is done', why: 'The checksum is only examined after the claimed number of bytes has been stored. The damage happens before that point.' },
          { t: 'It ignores the frame, because 196 is larger than any valid length', why: 'Nothing in the parser as described compares the length with a limit. A value is only invalid if code checks it.' },
        ],
        reveal: 'Both failures at once: a buffer overflow and a long loss of synchronisation. The length must be validated **the moment it arrives**, before it is used as a count. And a parser needs an inter-byte **timeout** so that a frame which never completes cannot hold it in the middle state for ever. A length field is attacker-controlled input as well as noise-controlled: this exact bug is a classic firmware vulnerability, and the security section returns to it.' },
      { t: 'widget', name: 'packet-explorer', props: { challenge: 'find-length-bug' }, caption: 'Make a receiver that trusts LEN write past its buffer, then choose the fix that actually closes the hole.' },
      `## Resynchronisation after garbage
When the parser detects an error — bad length, bad check, timeout — it must get back in step. The rules that make that work:

1. **Go back to hunting for SOF** after any error. Never assume the next byte starts a frame.
2. **Reset on silence.** If no byte arrives for longer than a frame could possibly take, return to the hunting state. This also cleans up after a sender that reset mid-frame.
3. **Never trust a field before the check passes**, except to bound the work: the length must be range-checked immediately; everything else waits for the CRC.
4. **Count what you drop.** Counters for bad checks, bad lengths and skipped bytes cost a few bytes of RAM and turn "it sometimes glitches" into a number you can watch.

With a start marker and length, a false SOF inside a payload can make the parser consume the beginning of the next real frame while it finds out. It will lose a frame or two and then recover. Protocols that cannot afford that use byte stuffing, where a delimiter is never ambiguous.

Now build one. The frame format here is deliberately small: SOF 0x7E, a LEN byte (1 to 8), LEN payload bytes, and a check byte equal to the sum of LEN and all payload bytes modulo 256.`,
      { t: 'widget', name: 'c-lab', title: 'Write a frame parser',
        props: {
          title: 'A resynchronising frame parser',
          prompt: `Bytes arrive on the Bench-MCU UART. Complete \`on_byte\` so that it recognises frames of the form

\`0x7E | LEN | payload (LEN bytes) | CHECK\`

where LEN is 1 to 8 and CHECK is the sum of LEN and every payload byte, modulo 256. The payload is ASCII text.

- For each valid frame print the payload in square brackets on its own line: \`[hi]\`
- If LEN is 0 or greater than 8, print \`LEN\` and go back to hunting for 0x7E.
- If CHECK is wrong, print \`BAD\` and go back to hunting.
- Bytes received while hunting that are not 0x7E are ignored silently.

\`main\` already polls the UART and passes each byte to \`on_byte\`.`,
          starter: String.raw`#include <stdint.h>
#include <stdio.h>

#define SOF      0x7E
#define MAX_LEN  8

enum state { WAIT_SOF, WAIT_LEN, IN_PAYLOAD, WAIT_CHECK };

static enum state st = WAIT_SOF;
static uint8_t buf[MAX_LEN + 1];      /* +1 for the terminating 0 */
static uint8_t len, idx, sum;

void on_byte(uint8_t b)
{
    switch (st) {
    case WAIT_SOF:
        if (b == SOF) st = WAIT_LEN;
        break;
    case WAIT_LEN:
        /* TODO: reject a bad length, otherwise remember it and start the sum */
        break;
    case IN_PAYLOAD:
        /* TODO: store the byte, add it to the sum, move on after LEN bytes */
        break;
    case WAIT_CHECK:
        /* TODO: compare, print, and return to WAIT_SOF */
        break;
    }
}

int main(void)
{
    UART_CTRL = UART_CTRL | 1u;
    for (;;) {
        if (UART_STATUS & UART_RX_AVAIL) {
            on_byte((uint8_t)UART_DATA);
        }
    }
    return 0;
}
`,
          solution: String.raw`#include <stdint.h>
#include <stdio.h>

#define SOF      0x7E
#define MAX_LEN  8

enum state { WAIT_SOF, WAIT_LEN, IN_PAYLOAD, WAIT_CHECK };

static enum state st = WAIT_SOF;
static uint8_t buf[MAX_LEN + 1];
static uint8_t len, idx, sum;

void on_byte(uint8_t b)
{
    switch (st) {
    case WAIT_SOF:
        if (b == SOF) st = WAIT_LEN;
        break;
    case WAIT_LEN:
        if (b == 0 || b > MAX_LEN) {
            puts("LEN");
            st = WAIT_SOF;
        } else {
            len = b; idx = 0; sum = b;
            st = IN_PAYLOAD;
        }
        break;
    case IN_PAYLOAD:
        buf[idx] = b;
        idx++;
        sum = (uint8_t)(sum + b);
        if (idx == len) st = WAIT_CHECK;
        break;
    case WAIT_CHECK:
        if (b == sum) {
            buf[len] = 0;
            printf("[%s]\n", (char *)buf);
        } else {
            puts("BAD");
        }
        st = WAIT_SOF;
        break;
    }
}

int main(void)
{
    UART_CTRL = UART_CTRL | 1u;
    for (;;) {
        if (UART_STATUS & UART_RX_AVAIL) {
            on_byte((uint8_t)UART_DATA);
        }
    }
    return 0;
}
`,
          tests: [
            { name: 'one valid frame', uartRx: frame('hi'), ticks: 1500, stdout: '[hi]\n' },
            { name: 'garbage before the frame, then a frame with a wrong check byte', uartRx: 'xx' + frame('hi') + '\x7E\x02ok\x00', ticks: 2500, stdout: '[hi]\nBAD\n' },
            { name: 'an oversized length must not be believed; the next frame still decodes', uartRx: '\x7E\xC8' + frame('bench'), ticks: 2500, stdout: 'LEN\n[bench]\n' },
            { name: 'two frames back to back', uartRx: frame('a') + frame('12345678'), ticks: 3500, stdout: '[a]\n[12345678]\n' },
            { name: 'a zero length is rejected too; the next frame still decodes', uartRx: '\x7E\x00' + frame('ok'), ticks: 2500, stdout: 'LEN\n[ok]\n' },
            { name: 'after a bad check byte the parser hunts again and decodes the next frame', uartRx: '\x7E\x02ok\x00' + frame('go'), ticks: 2500, stdout: 'BAD\n[go]\n' },
            { name: 'a payload byte equal to 0x7E is data, not a new start', uartRx: frame('a~b'), ticks: 2500, stdout: '[a~b]\n' },
          ],
          hints: [
            'For each state ask two questions: what must I remember from this byte, and which state comes next? Start with the error paths: where must *every* one of them lead?',
            'In `WAIT_LEN`, test the length first. Only if it is in range do you set `len = b; idx = 0; sum = b;` and move to `IN_PAYLOAD`.',
            'In `IN_PAYLOAD`: `buf[idx++] = b; sum = (uint8_t)(sum + b);` then, when `idx == len`, go to `WAIT_CHECK`.',
            'In `WAIT_CHECK`: if `b == sum`, write a 0 at `buf[len]` and print with `printf("[%s]\\n", (char *)buf)`. Either way, the next state is `WAIT_SOF`.',
          ],
          explain: 'Every path out of an error leads back to `WAIT_SOF`, and the length is judged before it is ever used as a count, so no input can make `idx` pass the end of `buf`. What this parser still lacks is the inter-byte timeout: a frame that stops halfway leaves it waiting in `IN_PAYLOAD`. Lab B adds that with a reset call.',
        } },
      { t: 'exercise', prompt: 'A frame format is: SOF (1 byte), LEN (1 byte), payload, CRC-16 (2 bytes). The link is a UART at 115200 baud, 8N1. How many milliseconds does a frame with a 60-byte payload take to transmit?',
        hints: ['Total bytes = 1 + 1 + 60 + 2.', '64 bytes, and each byte is 10 bits on the wire in 8N1.', '640 bits at 115 200 bits per second.'],
        solution: '64 bytes × 10 bits = 640 bits. 640 / 115 200 = 5.56 ms. This number sets your timeouts: an inter-byte timeout must exceed one byte time (87 µs) by a healthy factor, and a response timeout must exceed the request time plus the responder\'s processing time plus the response time.',
        answer: { type: 'number', value: 5.56, tol: 0.1, unit: 'ms' } },
      { t: 'callout', kind: 'mistake', title: 'Sending a struct',
        md: '`uart_write_bytes(port, &msg, sizeof msg)` with a C struct works between two identical boards running the same compiler, and breaks when either end changes: a different CPU pads the struct differently or orders bytes the other way, or a new field shifts every offset. The protocol becomes "whatever this compiler does". Define the wire format in a document, byte by byte, and write explicit encode and decode functions for it.' },
      { t: 'callout', kind: 'decision', title: 'Which framing should you choose?',
        md: `- **Humans will read it, speed is unimportant** → text lines. Debuggable with any terminal.
- **Binary, over a UART or anything stream-like, must recover instantly** → COBS or SLIP plus a CRC. The delimiter is never ambiguous.
- **Binary, simple, occasional loss of a frame or two is acceptable** → start marker + length + CRC, with strict length checks and a timeout.
- **A reliable transport already gives you message boundaries** (CAN frames, USB HID reports) → no framing needed; you still want type, sequence and version fields.` },
      `## A harder case
A firmware update protocol sends 1 KiB data blocks over a UART using SOF + 16-bit length + payload + CRC-32. A field report says an update "hung at 37 %" and needed a power cycle.

Work out a mechanism before reading on. A corrupted length field can claim up to 65 535 bytes. If the parser accepts any 16-bit length, it now waits for some 64 kB that will never come in one piece; the sender, getting no acknowledgement, retries the same 1 KiB block, which the receiver swallows as payload — about sixty retries' worth. If the sender gives up after a few retries, both sides wait for ever. The fixes are the rules above: reject any length above the largest block the protocol defines; reset the parser when the line is idle for longer than a byte or two; and bound the number of retries with an explicit abort message so that the failure is reported instead of hanging. Each rule costs a few lines. Leaving them out cost a site visit.`,
      { t: 'refs', items: [
        { title: 'RFC 1055: SLIP', url: 'https://www.rfc-editor.org/rfc/rfc1055', note: 'The original two-page description of SLIP framing, with C code. URL not load-tested from this environment.' },
      ] },
    ],
    quiz: [
      { q: 'A receiver reads fixed 6-byte messages from a UART with no framing. One byte is lost. What happens to the following messages?', kind: 'concept', choices: [
        { t: 'Every later message is assembled from parts of two messages, indefinitely', ok: true, why: 'With nothing marking a boundary, the receiver keeps counting from its shifted position and never realigns.' },
        { t: 'Only the message containing the lost byte is affected; the next one starts cleanly', why: 'That would require the receiver to find the start of the next message, which needs a marker, a gap or a check that it does not have.' },
        { t: 'The UART reports a framing error and the driver realigns on the next message', why: 'A UART framing error concerns the stop bit of one byte. The UART knows nothing about where your multi-byte messages begin.' },
      ] },
      { q: 'Why does byte stuffing (SLIP, COBS) give more certain resynchronisation than a start byte plus a length field?', kind: 'concept', choices: [
        { t: 'The delimiter value never appears inside an encoded frame', ok: true, why: 'The encoding removes the delimiter value from the data. With start+length, the start value can legitimately occur in a payload and be mistaken for a boundary.' },
        { t: 'Stuffed frames are shorter, so fewer of them are hit by noise', why: 'Stuffing adds bytes. Its benefit is an unambiguous boundary, bought with that overhead.' },
        { t: 'Stuffing includes error detection, so a damaged frame is recognised at once', why: 'Stuffing only reshapes the data so a delimiter can be used. Detecting corrupted content still needs a checksum or CRC.' },
      ] },
      { q: 'COBS-encode the two bytes `00 41`. What goes on the wire, including the delimiter?', kind: 'code', choices: [
        { t: '01 02 41 00', ok: true, why: 'The first code is 1 (a zero comes immediately). The second code is 2: one data byte follows before the end. Then the delimiter.' },
        { t: '02 41 01 00', why: 'That would decode to 41 00: the zero and the data byte have changed places.' },
        { t: '00 41 00', why: 'The encoded frame must not contain a zero, or the receiver would end the frame at the first byte.' },
      ] },
      { q: 'A protocol sends a 16-bit sensor value by copying a C `uint16_t` to the wire with `memcpy`. It is moved from a little-endian MCU to a big-endian one at one end only. What is the effect?', kind: 'code', choices: [
        { t: 'The two bytes are read in swapped order: 0x0102 becomes 0x0201', ok: true, why: 'memcpy sends the bytes in the CPU\'s memory order. The two CPUs disagree on which byte is the most significant.' },
        { t: 'Nothing changes, because memcpy preserves the value on any CPU', why: 'memcpy preserves the bytes in memory order, and it is exactly that order which differs between the two machines.' },
        { t: 'The bits within each byte are reversed, so 0x01 becomes 0x80', why: 'Endianness concerns the order of whole bytes. The bits inside a byte keep their significance.' },
      ] },
      { q: 'In a frame parser, when must the LEN field be range-checked?', kind: 'security', choices: [
        { t: 'Immediately when it is received, before any payload byte is stored', ok: true, why: 'The length controls how many bytes are written. Checking it later means the overflow has already happened.' },
        { t: 'After the CRC has been verified, since an unverified field should not be acted on', why: 'The CRC arrives after the payload. Waiting for it means storing an unchecked number of bytes first.' },
        { t: 'It need not be checked if the CRC is strong enough', why: 'A CRC detects accidental corruption after the fact, and anyone constructing a malicious frame can attach a correct CRC to an oversized length.' },
      ] },
      { q: 'What is the purpose of a version field in a frame header?', kind: 'arch', choices: [
        { t: 'So a receiver can recognise a layout it does not understand and reject it cleanly', ok: true, why: 'Devices in the field run mixed firmware versions. An explicit version turns silent misreads into a clean, reportable mismatch.' },
        { t: 'To detect transmission errors in the header before the payload is read', why: 'Error detection is the job of the check field. A version byte could be corrupted like any other.' },
        { t: 'To order frames so that duplicates and losses can be detected and discarded', why: 'Ordering and duplicate detection use the sequence number, which changes per frame. The version is constant for a given firmware.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 10
  {
    id: 'proto-crc', title: 'Checksums and CRC', minutes: 50,
    summary: 'What a sum, an XOR and a CRC each catch, how to compute a CRC by hand, why "CRC-16" is not a specification, and what none of them protect against.',
    skills: ['proto-crc'],
    blocks: [
      `## The problem
A motor controller receives the bytes \`7E 03 A1 B2 C3 …\` over a cable that runs past a relay. Once in a while one bit arrives flipped. Without a check, the controller acts on a wrong speed. You must add a few bytes that let the receiver detect a damaged frame — and you have to choose which few bytes.

All such schemes work the same way. The sender computes a short value from the message and appends it. The receiver recomputes it and compares. A mismatch proves the frame is damaged. A match does **not** prove it is intact: with an n-bit check, roughly one random corruption in 2ⁿ slips through. The question is which errors are *guaranteed* to be caught.

## The simple checks
**Additive checksum**: add all bytes, keep the low 8 bits. Cheap. Catches any single-bit error. Misses: two errors that cancel (one byte +1, another −1), bytes arriving in the wrong **order** (addition does not care about order), and extra 0x00 bytes.

**XOR (longitudinal redundancy check)**: XOR all bytes together. Catches any single-bit error and any odd number of errors in the same bit position. Misses: the same bit flipped in two different bytes, reordering, and inserted zeros.

**Fletcher checksums** keep two running sums, the second a sum of the first, which makes the result depend on position, so reordering is detected. Better than a plain sum at nearly the same cost; you will see Fletcher-16 and its relative Adler-32 in some protocols.

For the frame content \`03 A1 B2 C3\`: the sum is 0x03 + 0xA1 + 0xB2 + 0xC3 = 0x219, so the checksum is **0x19**.`,
      { t: 'predict', q: 'A message protected by an 8-bit additive checksum arrives with two of its bytes swapped: `12 34 56` became `34 12 56`. Does the receiver notice?',
        choices: [
          { t: 'No. The same bytes in a different order give the same sum', ok: true, why: 'Addition is commutative. Any reordering of the bytes leaves the checksum unchanged.' },
          { t: 'Yes. Any change to the message changes the checksum, including a reordering', why: 'Many changes leave a simple sum untouched: reordering, or two changes of equal size and opposite sign.' },
          { t: 'Only if the two swapped bytes differ by more than 127', why: 'The size of the difference is irrelevant. Both orders add up to exactly the same total.' },
        ],
        reveal: 'Both orders sum to 0x9C. A CRC-8 gives 0x7C for the first and 0x92 for the second (the reference program below prints both). Position-blindness is the main weakness of a plain sum or XOR.' },
      `## CRC: a remainder
A **cyclic redundancy check** treats the whole message as one long binary number and divides it by a fixed number, the **generator polynomial**. The **remainder** is the CRC. The division uses arithmetic in which there are no carries: addition and subtraction are both XOR. That is what makes it cheap in hardware — a shift register and a few XOR gates.

Why a remainder is a good check: every bit of the message influences the remainder through many steps of the division, so changes do not cancel in simple ways. A well-chosen n-bit CRC detects **every** single-bit error, **every** double-bit error within a specified message length, and **every burst** of errors no longer than n bits — and noise on a cable typically arrives in bursts.

### Worked example by hand
Message: \`110101\`. Generator: \`1011\` (4 bits, so the CRC has 3 bits; as a polynomial, x³ + x + 1).

1. Append 3 zero bits to the message: \`110101 000\`.
2. Divide. Working left to right: wherever the leading bit is 1, XOR the generator in underneath it; where it is 0, move on.`,
      { t: 'ascii', caption: 'Long division with XOR instead of subtraction. The quotient is not needed, only the remainder.',
        text:
`  1 1 0 1 0 1 0 0 0      message with three zeros appended
  1 0 1 1                leading bit is 1: XOR the generator
  -------
  0 1 1 0 0 1 0 0 0
    1 0 1 1              next bit is 1: XOR
    -------
  0 0 1 1 1 1 0 0 0
      1 0 1 1            XOR
      -------
  0 0 0 1 0 0 0 0 0
        1 0 1 1          XOR
        -------
  0 0 0 0 0 1 1 0 0
            1 0 1 1      (one position skipped: that bit was 0)
            -------
  0 0 0 0 0 0 1 1 1      remainder = 111

  transmitted: 110101 111     (message followed by the CRC)` },
      `The receiver divides the nine received bits \`110101111\` by the same generator. If nothing changed, the remainder is 000. Flip any single bit and it is not.

### The same thing as a shift register
Software and hardware do not do long division on paper; they keep an n-bit **register** and process one message bit at a time. For the common CRC-8 with generator x⁸ + x² + x + 1 — written **0x07**, because the leading x⁸ term is implied — the loop for each message byte is:

1. XOR the byte into the register.
2. Eight times: look at the top bit. Shift the register left by one. If the top bit was 1, XOR the register with 0x07.

**Worked: CRC-8 of the single byte 0x80**, register starting at 0x00.

| Step | Register before | Top bit | After shift | XOR 0x07? | Register after |
|---|---|---|---|---|---|
| load | 0x00 | | | | 0x80 |
| 1 | 0x80 | 1 | 0x00 | yes | 0x07 |
| 2 | 0x07 | 0 | 0x0E | no | 0x0E |
| 3 | 0x0E | 0 | 0x1C | no | 0x1C |
| 4 | 0x1C | 0 | 0x38 | no | 0x38 |
| 5 | 0x38 | 0 | 0x70 | no | 0x70 |
| 6 | 0x70 | 0 | 0xE0 | no | 0xE0 |
| 7 | 0xE0 | 1 | 0xC0 | yes | 0xC7 |
| 8 | 0xC7 | 1 | 0x8E | yes | **0x89** |

The CRC-8 of 0x80 is 0x89.`,
      { t: 'exercise', prompt: 'Compute by hand the CRC-8 (generator 0x07, register starts at 0x00, no reflection, no final XOR) of the single byte **0xC2**. Answer in hex.',
        hints: ['Load: register = 0x00 XOR 0xC2 = 0xC2. Then eight shift steps, as in the table above.', 'Step 1: top bit of 0xC2 is 1. Shift left → 0x84. XOR 0x07 → 0x83. Step 2: top bit of 0x83 is 1. Shift → 0x06. XOR 0x07 → 0x01.', 'From 0x01 the top bit stays 0 for the remaining six steps, so the register just doubles each time: 0x02, 0x04, 0x08, …'],
        solution: '0xC2 → 0x83 → 0x01 → 0x02 → 0x04 → 0x08 → 0x10 → 0x20 → **0x40**. Two steps XORed the generator in; the other six were plain shifts.',
        answer: { type: 'text', accept: ['^\\s*(0x)?40\\s*$'], nudge: 'Check the first two steps: both have the top bit set, so both XOR with 0x07 after shifting. After that the register is 0x01.' } },
      { t: 'widget', name: 'packet-explorer', props: { challenge: 'fix-crc' }, caption: 'A frame whose CRC-8 is wrong. Step the shift register through the covered bytes and repair it. Then flip single bits and watch each check react.' },
      `## "CRC-16" is not a specification
A CRC algorithm has **six** parameters. Two implementations interoperate only if all six match:

| Parameter | Meaning |
|---|---|
| **Width** | number of bits in the CRC |
| **Poly** | the generator, written without its top bit |
| **Init** | the register's starting value. Non-zero values make leading zero bytes affect the result |
| **RefIn** | whether each input byte is processed least significant bit first ("reflected") |
| **RefOut** | whether the final register is bit-reversed |
| **XorOut** | a constant XORed into the result at the end |

Reflected forms exist because UARTs and many other links send the least significant bit first, and the CRC is mathematically defined over bits in transmission order.

By convention every named CRC has a **check value**: its result for the nine ASCII characters \`123456789\`. That is how you test an implementation.

| Name | Width | Poly | Init | RefIn / RefOut | XorOut | Check |
|---|---|---|---|---|---|---|
| CRC-8 (SMBus) | 8 | 0x07 | 0x00 | no | 0x00 | 0xF4 |
| CRC-16/CCITT-FALSE | 16 | 0x1021 | 0xFFFF | no | 0x0000 | 0x29B1 |
| CRC-16/ARC | 16 | 0x8005 | 0x0000 | yes | 0x0000 | 0xBB3D |
| CRC-16/MODBUS | 16 | 0x8005 | 0xFFFF | yes | 0x0000 | 0x4B37 |
| CRC-32 (Ethernet, zip, PNG) | 32 | 0x04C11DB7 | 0xFFFFFFFF | yes | 0xFFFFFFFF | 0xCBF43926 |

Three different results all commonly called "CRC-16". When a datasheet says "CRC-16", look for the polynomial and the initial value, and if it gives an example frame, test your code against it. When you write a protocol document, give all six parameters **and** the check value, **and** two more things that are outside the CRC algorithm itself: exactly which bytes are covered, and the byte order of the CRC on the wire.`,
      { t: 'code', lang: 'c', status: 'host-tested', caption: 'Reference implementations with their check values (compiled with gcc -Wall -Wextra -std=c11 and run; prints the seven values in the table and "all check values match")',
        code: CRC_REF,
        explain: [
          { lines: '22-31', md: 'The CRC-8 from the worked table. `crc & 0x80` tests the top bit **before** the shift; the cast to `uint8_t` discards the bit that the shift pushes out of an 8-bit register (in C the arithmetic happens in `int`, so without the cast the register would grow).' },
          { lines: '34-43', md: 'Same structure at 16 bits. The message byte is XORed into the **top** of the register because bits are processed most significant first.' },
          { lines: '47-56', md: 'A reflected CRC shifts **right** and tests the **bottom** bit, with the polynomial bit-reversed (0x8005 becomes 0xA001). This processes each byte least significant bit first without reversing anything at run time.' },
          { lines: '93-98', md: 'The byte-swap experiment from the prediction above: the two sums are equal, the two CRCs differ.' },
        ] },
      { t: 'widget', name: 'c-lab', title: 'Implement the checks yourself',
        props: {
          title: 'Additive checksum and CRC-8',
          prompt: `Implement two functions over a byte buffer:

- \`sum8\`: the sum of all bytes modulo 256.
- \`crc8\`: CRC-8 with generator 0x07, register starting at 0x00, most significant bit first, no final XOR.

\`main\` prints the results for the check string \`123456789\`, for the single byte 0x80, and for two buffers that differ only in the order of their bytes. Do not change \`main\`.`,
          starter: String.raw`#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

uint8_t sum8(const uint8_t *data, size_t n)
{
    /* TODO */
    return 0;
}

uint8_t crc8(const uint8_t *data, size_t n)
{
    uint8_t crc = 0x00;
    /* TODO: for each byte: XOR it in, then 8 times: shift left,
     * and XOR with 0x07 if the bit shifted out was 1 */
    return crc;
}

int main(void)
{
    const char *check = "123456789";
    const uint8_t a[3] = { 0x12, 0x34, 0x56 };
    const uint8_t b[3] = { 0x34, 0x12, 0x56 };
    const uint8_t one[1] = { 0x80 };

    printf("sum8=%02X crc8=%02X\n", sum8((const uint8_t *)check, strlen(check)), crc8((const uint8_t *)check, strlen(check)));
    printf("one=%02X\n", crc8(one, 1));
    printf("swap sum %02X %02X\n", sum8(a, 3), sum8(b, 3));
    printf("swap crc %02X %02X\n", crc8(a, 3), crc8(b, 3));
    return 0;
}
`,
          solution: String.raw`#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

uint8_t sum8(const uint8_t *data, size_t n)
{
    uint8_t s = 0;
    for (size_t i = 0; i < n; i++) {
        s = (uint8_t)(s + data[i]);
    }
    return s;
}

uint8_t crc8(const uint8_t *data, size_t n)
{
    uint8_t crc = 0x00;
    for (size_t i = 0; i < n; i++) {
        crc ^= data[i];
        for (int bit = 0; bit < 8; bit++) {
            if (crc & 0x80) {
                crc = (uint8_t)((crc << 1) ^ 0x07);
            } else {
                crc = (uint8_t)(crc << 1);
            }
        }
    }
    return crc;
}

int main(void)
{
    const char *check = "123456789";
    const uint8_t a[3] = { 0x12, 0x34, 0x56 };
    const uint8_t b[3] = { 0x34, 0x12, 0x56 };
    const uint8_t one[1] = { 0x80 };

    printf("sum8=%02X crc8=%02X\n", sum8((const uint8_t *)check, strlen(check)), crc8((const uint8_t *)check, strlen(check)));
    printf("one=%02X\n", crc8(one, 1));
    printf("swap sum %02X %02X\n", sum8(a, 3), sum8(b, 3));
    printf("swap crc %02X %02X\n", crc8(a, 3), crc8(b, 3));
    return 0;
}
`,
          tests: [
            { name: 'check string: sum 0xDD, CRC-8 0xF4', stdoutIncludes: 'sum8=DD crc8=F4' },
            { name: 'single byte 0x80 gives 0x89', stdoutIncludes: 'one=89' },
            { name: 'the sum cannot see a byte swap, the CRC can', stdout: 'sum8=DD crc8=F4\none=89\nswap sum 9C 9C\nswap crc 7C 92\n' },
          ],
          hints: [
            '`sum8`: accumulate in a `uint8_t`. The cast `(uint8_t)(s + data[i])` makes the wrap to 8 bits explicit.',
            '`crc8`: test the top bit with `crc & 0x80` **before** shifting, because the shift discards it.',
            'Inner loop body: `if (crc & 0x80) crc = (uint8_t)((crc << 1) ^ 0x07); else crc = (uint8_t)(crc << 1);`',
          ],
          explain: 'Eight shifts per byte is the slow, clear form. Production code usually replaces the inner loop with a 256-entry lookup table (one table read per byte) or uses the MCU\'s CRC peripheral. Whatever the implementation, the check value for "123456789" is how you prove it is the CRC you meant.',
        } },
      { t: 'exercise', prompt: 'A frame is `7E | LEN | payload | CHECK`, where CHECK is the 8-bit additive checksum of LEN and the payload. For LEN = 0x02 and payload `4F 4B` ("OK"), what is CHECK? Answer in hex.',
        hints: ['Add 0x02 + 0x4F + 0x4B.', '0x4F + 0x4B = 0x9A. Add 0x02.'],
        solution: '0x02 + 0x4F + 0x4B = **0x9C**. The total did not exceed 0xFF, so nothing was discarded. (The CRC-8 of the same three bytes is 0xB8.)',
        answer: { type: 'text', accept: ['^\\s*(0x)?9c\\s*$'], nudge: 'Add the three covered bytes in hex. The SOF byte is not part of the sum.' } },
      { t: 'callout', kind: 'decision', title: 'Which check for which job?',
        md: `- **CRC-8**: short frames (up to a few tens of bytes) on a short, quiet link; sensor readings.
- **CRC-16**: general-purpose frames up to a few kilobytes. The usual choice for a UART protocol.
- **CRC-32**: large blocks: firmware images, files, long packets.
- **Plain sum or XOR**: only when you must interoperate with something that uses it, or as a quick sanity check on top of a link that already has a CRC.

A CRC's guarantees hold up to a maximum message length that depends on the polynomial. Beyond it, double-bit errors can slip through. If you design something safety-relevant, look the polynomial's properties up rather than picking the most familiar one.` },
      { t: 'callout', kind: 'mistake', title: 'A CRC that covers the wrong bytes',
        md: 'The most common CRC interoperability failures are not in the algorithm: one side includes the start byte and the other does not; one covers the length field and the other only the payload; one sends the CRC high byte first and the other low byte first. If the CRC does not cover the length and type fields, a corrupted header passes unnoticed. Cover everything after the start marker, and write the range and byte order down.' },
      `## What a CRC does not do
A CRC detects **accidental** damage. It offers no protection against anyone who changes a message on purpose. The algorithm has no secret: an attacker who alters the payload simply computes the correct CRC for the altered frame and appends it. CRCs are also linear, so an attacker can even work out how to fix up the CRC for a chosen bit-flip without knowing the rest of the message.`,
      { t: 'callout', kind: 'security', title: 'Integrity against noise is not integrity against people',
        md: 'To detect deliberate modification you need a check that depends on a **secret key**: a message authentication code (MAC) such as HMAC-SHA-256 or AES-CMAC, or a digital signature. Only a holder of the key can produce a valid tag. Even then a recorded valid message can be **replayed**, which is why authenticated protocols also carry a counter or nonce. A MAC does not replace the CRC on a noisy link either: the CRC is cheap and tells "line noise" apart from "someone is tampering", which you will want in your logs. The security section builds both, and its `replay-attack` and `crypto-lab` tools let you break and then fix a link that has only a CRC.' },
      `## A harder case
A team reports that their bootloader "verifies firmware with CRC-32, so a modified image cannot be installed". Evaluate that claim.

The CRC-32 will catch a download that was truncated or corrupted in transit, which is worth having. It does nothing to stop a modified image: whoever modifies it recomputes the four CRC bytes. The property the team wants — only firmware from the manufacturer installs — is **authenticity**, and it needs a signature verified with a key the attacker does not have, plus protection against installing an old, vulnerable version. Being exact about which property a mechanism provides is most of security engineering; "integrity" in a datasheet nearly always means "against accidents".`,
    ],
    quiz: [
      { q: 'Which error is an 8-bit additive checksum guaranteed to detect?', kind: 'concept', choices: [
        { t: 'A single flipped bit anywhere in the message', ok: true, why: 'One flipped bit changes one byte by a power of two, which always changes the sum modulo 256.' },
        { t: 'Two bytes exchanged with each other', why: 'The sum does not depend on the order of the bytes, so an exchange leaves it identical.' },
        { t: 'One byte increased by 1 and another decreased by 1', why: 'The two changes cancel exactly in the total, so the checksum is unchanged.' },
      ] },
      { q: 'In the CRC-8 shift-register algorithm (generator 0x07), the register holds 0x90. What does it hold after one shift step?', kind: 'code', choices: [
        { t: '0x27', ok: true, why: 'The top bit is 1. Shifting left gives 0x20 in 8 bits; XOR with 0x07 gives 0x27.' },
        { t: '0x20', why: 'That is the shift alone. Because the bit shifted out was 1, the generator must also be XORed in.' },
        { t: '0x97', why: 'That XORs the generator into the register without shifting. Each step shifts first.' },
        { t: '0x127', why: 'The register is 8 bits wide, so the bit shifted out of the top is dropped, not kept as a ninth bit.' },
      ] },
      { q: 'A datasheet says "the frame ends with a CRC-16". What else must you find out before you can implement it?', kind: 'concept', choices: [
        { t: 'Polynomial, initial value, reflection, final XOR, coverage and byte order', ok: true, why: 'Several incompatible CRCs share the name. All parameters, plus coverage and byte order, must match for the two ends to agree.' },
        { t: 'Only the polynomial; initial value and reflection follow from the 16-bit width', why: 'CRC-16/ARC and CRC-16/MODBUS use the same polynomial and give different results because their initial values differ.' },
        { t: 'Nothing: CRC-16 is a standard algorithm with one defined result', why: 'There is no single CRC-16. The name describes only the width.' },
      ] },
      { q: 'Your CRC-16/CCITT-FALSE function returns 0x29B1 for the ASCII string "123456789". What does that establish?', kind: 'code', choices: [
        { t: 'The algorithm and parameters are right; coverage and byte order are still unchecked', ok: true, why: 'The check value validates the function. Which bytes you feed it and how you place the result in the frame are separate decisions.' },
        { t: 'Your frames will interoperate with any device that uses CRC-16/CCITT-FALSE', why: 'Interoperability also needs the same covered range and the same byte order for the CRC field, which the check value says nothing about.' },
        { t: 'Nothing, since one matching value out of 65 536 could easily be a coincidence', why: 'A wrong 16-bit CRC matching by chance has odds of about 1 in 65 536. The check value is the accepted test for exactly this reason.' },
      ] },
      { q: 'An attacker can modify frames in transit on a link protected by CRC-32. What can they do?', kind: 'security', choices: [
        { t: 'Change the payload and recompute the CRC, producing a frame the receiver accepts', ok: true, why: 'The CRC involves no secret. Anyone can compute a valid one for any content.' },
        { t: 'Nothing, because any change to the payload makes the CRC fail', why: 'That holds only if the CRC bytes are left alone. An attacker replaces them with the correct value for the new content.' },
        { t: 'Only make changes that happen to leave the CRC unchanged, which takes about 2³² attempts', why: 'There is no need to search for a collision when the check field itself can be rewritten.' },
      ] },
      { q: 'Why do many CRCs start the register at a non-zero value such as 0xFFFF?', kind: 'concept', choices: [
        { t: 'With a zero start, leading zero bytes leave the register unchanged and go unnoticed', ok: true, why: 'Zero XORed in and shifted stays zero. A non-zero start makes every byte, including leading zeros, change the register.' },
        { t: 'It makes the computation faster, because fewer XOR steps are needed at the start', why: 'The starting constant has no effect on the amount of work, which is the same number of shifts and XORs.' },
        { t: 'It keeps the CRC secret from anyone who does not know the starting value', why: 'The initial value is published as part of the algorithm. Nothing about a CRC is secret.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 11
  {
    id: 'proto-arbitration', title: 'Bus arbitration: who talks when', minutes: 35,
    summary: 'How I2C and CAN resolve simultaneous senders on the wire, why SPI, UART and USB never have to, and what to do on RS-485, where the wire gives no help.',
    skills: ['proto-arbitration'],
    blocks: [
      `## The problem
Put more than one potential transmitter on a shared wire and sooner or later two will start at the same moment. Every multi-node bus needs an answer to "what then?". The answers fall into three families:

1. **Avoid the question**: only one device is ever allowed to start (SPI, USB, single-controller I2C), or each transmitter has its own wire (UART).
2. **Resolve it on the wire, losing nothing**: bitwise arbitration on a wired-AND bus (CAN, multi-controller I2C).
3. **Resolve it by protocol rules**, because the wire cannot help (RS-485 and other shared push-pull or differential lines).

## Family 1: no arbitration needed
- **UART**: TX and RX are separate wires with one driver each. Both ends may send at once without conflict.
- **SPI**: only the controller starts transfers, and it selects one peripheral with CS. A second controller on the same bus is outside what SPI defines; making it work needs extra handshake wires and care that both never drive at once.
- **USB**: the host polls. A device with urgent data waits to be asked.

The cost of having no arbitration is that peripherals cannot speak first, as the roles lesson showed.

## Family 2: bitwise arbitration
The principle, on any wired-AND bus where 0 overrides 1:

> Every transmitter **reads the bus while it writes**. A transmitter that sends 1 and reads 0 has lost and must stop at once.

The winner never sent a bit that the bus contradicted, so its frame is intact. Nothing is destroyed and no time is wasted. It works only if every node sees each bit before the next one begins, which is why arbitration limits the product of bit rate and bus length.

### CAN
Covered in the CAN lesson: arbitration runs over the identifier, lowest identifier wins, the loser retries when the bus is idle. Every frame is arbitrated; it is the bus's normal operation.

### I2C with several controllers
I2C allows more than one controller. The mechanism has two parts.

**Clock synchronisation.** SCL is wired-AND too. If two controllers generate clocks, the line is low as long as *either* holds it low, and each controller starts timing its high period only when it sees SCL actually rise. The result is a clock with the longest low period and the shortest high period of the two — one clock, which both follow.

**Data arbitration.** On each bit, each controller compares SDA with what it is sending. A controller that released SDA (sent 1) but reads 0 has lost: it stops driving and, because it may be the device being addressed, switches to listening as a target. Arbitration continues through the address, the R/W bit and into the data, for as long as the two transmissions are identical.

So on I2C the transfer with the **lowest address** wins, a write beats a read of the same address, and two controllers sending the identical message both "win" without ever noticing each other.

Two cases the specification does not allow arbitration to resolve: one controller sending a repeated START or a STOP at the same position where another sends a data bit. Multi-controller systems are designed so that this cannot occur — in practice by making every controller use the same transaction format for a given device.

In most small systems there is exactly one I2C controller and none of this is exercised. You need to know it for two reasons: a hardware I2C peripheral can report "arbitration lost" when **noise** or a too-slow rising edge makes it read a 0 where it sent a 1; and the 2024 eCTF reference design, like many real products, puts several microcontrollers on one I2C bus.`,
      { t: 'predict', q: 'Two I2C controllers issue START in the same instant. Controller A is writing to address 0x52; controller B is reading from address 0x50. Who wins?',
        choices: [
          { t: 'B: at the second-to-last address bit B sends 0 where A sends 1', ok: true, why: '0x52 = 1010010 and 0x50 = 1010000. The first five bits match; at the sixth, A sends 1 and B sends 0, so A reads a 0 it did not send and withdraws.' },
          { t: 'A: a write has priority over a read, whatever the two addresses are', why: 'The R/W bit only decides between transfers whose seven address bits are identical, because it is sent after them. Here the addresses differ first.' },
          { t: 'Neither: both transfers are corrupted and each controller retries after a STOP', why: 'The winner never has a bit overridden, so its transfer continues intact. Only the loser retries.' },
        ],
        reveal: 'Compare the address bytes most significant bit first: the first position where they differ decides, and the 0 wins. B continues its read undisturbed; A reports arbitration lost to its driver, waits for the STOP, and tries again.' },
      { t: 'widget', name: 'can-arbitration', props: { challenge: 'predict-winner' }, caption: 'The same wired-AND contest with CAN identifiers. Do the task first: write the three identifiers in binary and name the winner before you answer. Then switch to the Explore tab and try two nodes whose identifiers differ only in the last bit, then two identical identifiers.' },
      `## Family 3: when the wire cannot arbitrate — RS-485
An RS-485 driver actively drives both states. Two drivers enabled at once fight, the bus carries an undefined level, and neither can reliably tell from reading back that it lost. There is no bitwise arbitration. Access has to be organised by rules that all nodes follow:

**Single controller with polling.** One node (the controller, or "master" in Modbus documents) sends a request carrying a target address. Only the addressed node may reply, and only within a defined time. Nobody else ever transmits unprompted. This is Modbus RTU and the great majority of RS-485 systems. Simple and deterministic; the controller is a single point of failure, and events at other nodes wait for the next poll.

**Token passing.** A special frame, the token, travels from node to node; only the holder may transmit. No single node is in charge, at the cost of handling lost tokens and nodes that join or leave.

**Collision detection and back-off.** Each node listens before talking, checks that what it receives matches what it sent, and on a mismatch or a missing acknowledgement waits a random time before retrying. Needs a CRC and acknowledgements to detect collisions that corrupt frames, and gives no timing guarantee.

Whichever scheme is used, the half-duplex line imposes its own timing rules:

- **Driver enable.** A node enables its driver just before its start bit and must disable it right after the **last stop bit has left the pin** — not when the last byte was written to the UART, which is one or more byte times earlier. Releasing too early cuts off the frame; releasing too late collides with the reply. Use the UART's "transmission complete" event, or its hardware RS-485 mode if it has one (the ESP-IDF UART driver has such a mode).
- **Turnaround time.** After receiving a request, a responder waits a defined minimum before enabling its driver, so the requester has time to release the bus.
- **Idle biasing.** With all drivers disabled the pair floats; a pair of bias resistors (or fail-safe receivers) holds it in the idle state so that receivers do not see noise as start bits.`,
      { t: 'exercise', prompt: 'A controller polls 12 RS-485 nodes in turn at 19200 baud, 8N1. Each request is 8 bytes and each reply 12 bytes; allow 5 ms per node for turnaround and processing. How long is one complete polling cycle, in milliseconds?',
        hints: ['Bytes per node = 8 + 12 = 20; each byte is 10 bits.', '200 bits at 19 200 bit/s = 10.42 ms of transmission per node.', 'Add the 5 ms allowance: 15.42 ms per node. Multiply by 12.'],
        solution: 'Per node: 20 bytes × 10 bits / 19 200 = 10.42 ms on the wire, plus 5 ms = 15.42 ms. Twelve nodes: **≈185 ms**. So an event at a node can wait up to 185 ms before the controller hears of it. If that is too slow, raise the baud rate, shorten the frames, poll urgent nodes more often — or choose a bus where nodes can speak for themselves.',
        answer: { type: 'number', value: 185, tol: 2, unit: 'ms' } },
      `## How fast is each bus, really?
Arbitration and framing overhead are part of every bus's true throughput. Compare the time to move a 256-byte block:`,
      { t: 'exercise', prompt: 'How many milliseconds does it take to send 256 data bytes in one I2C write at 400 kHz? Count 9 clock periods per byte, one address byte, and one clock period each for START and STOP.',
        hints: ['Bytes on the wire: 1 address byte + 256 data bytes = 257.', '257 × 9 = 2313 clock periods, plus 2 for START and STOP = 2315.', '2315 / 400 000 s.'],
        solution: '(257 × 9 + 2) / 400 000 = **5.79 ms**. The same 256 bytes take 22.2 ms on a UART at 115200 baud (2560 bits) and 0.205 ms on SPI at 10 MHz (2048 bits, no per-byte overhead at all). On classical CAN at 500 kbit/s they need 32 frames of about 222 µs each, at least 7.1 ms, assuming no higher-priority traffic gets in between.',
        answer: { type: 'number', value: 5.79, tol: 0.06, unit: 'ms' } },
      { t: 'callout', kind: 'mistake', title: 'Disabling the RS-485 driver when the transmit buffer is empty',
        md: 'The "transmit register empty" flag rises when the last byte moves into the shift register, a full byte time before its stop bit ends. Firmware that drops driver-enable on that flag chops off the last byte: the receiver sees a frame with a damaged final byte or CRC, every time. The symptom ("CRC errors on every frame, but a capture at the sender\'s UART pin looks perfect") is typical. Wait for transmission *complete*.' },
      { t: 'callout', kind: 'decision', title: 'Matching arbitration to the system',
        md: 'If one device naturally runs the conversation, use a controller/peripheral bus and poll: no arbitration, fully predictable timing. If many nodes generate events and priority matters, use CAN and let the wire arbitrate. If you need long distance with simple hardware and can accept polling, RS-485 with a single controller. Avoid inventing collision-based schemes unless nothing else fits: they are the hardest to test, because the failure only happens when two nodes pick the same moment.' },
      `## A harder case
Two microcontrollers share a 3.3 V half-duplex single-wire UART link: each has TX and RX tied together onto one wire, and either may start a message. Their TX pins are push-pull.

First, the electrical problem: two push-pull outputs on one wire is contention whenever one sends a 0 while the other idles high. Before any protocol, change the outputs to open-drain with a pull-up — now the line is wired-AND and a collision is harmless.

Then notice what that has given you: each node hears its own transmission, and can compare. If it reads back a byte different from the one it sent, another node was transmitting. That is collision *detection* per byte (not CAN's lossless arbitration: by the time a byte mismatches, the frame is spoiled). Add a rule: on mismatch stop, wait a random time longer for the lower-priority node, retry; protect frames with a CRC; acknowledge them. You have reconstructed, from the properties of the wire, why CAN is built the way it is — and why it does the comparison per bit instead.`,
    ],
    quiz: [
      { q: 'What must a transmitter do for bitwise arbitration to work?', kind: 'concept', choices: [
        { t: 'Read the bus during every bit and stop at once if it sent 1 but reads 0', ok: true, why: 'Detecting that another node overrode your bit, and withdrawing before disturbing anything further, is what keeps the winning frame intact.' },
        { t: 'Wait a random time before each transmission so that two nodes rarely start together', why: 'Random delays reduce the chance of collisions on buses that cannot arbitrate. Bitwise arbitration resolves a simultaneous start directly.' },
        { t: 'Send its frame twice so that receivers can compare the two copies', why: 'Repetition detects damage after the fact. Arbitration prevents the damage by having all but one sender withdraw.' },
      ] },
      { q: 'Why can two RS-485 nodes not arbitrate bit by bit the way CAN nodes do?', kind: 'circuit', choices: [
        { t: 'Its drivers actively drive both states, so two different bits give contention', ok: true, why: 'Arbitration needs one state that is merely "not driving", which any other node can override. RS-485 has two driven states.' },
        { t: 'RS-485 is too slow for a node to read a bit back before the next one starts', why: 'Speed is not the obstacle. RS-485 runs at rates similar to or higher than CAN.' },
        { t: 'RS-485 transceivers cannot receive while their driver is enabled', why: 'Most transceivers can leave the receiver enabled during transmission. What is missing is a bus level that means "nobody is overriding me".' },
      ] },
      { q: 'Two I2C controllers start simultaneously and send exactly the same address and data. What happens?', kind: 'concept', choices: [
        { t: 'Neither detects a conflict; the target sees one normal transfer', ok: true, why: 'Arbitration is lost only when a controller reads a bit different from the one it sent. Identical transfers never differ.' },
        { t: 'Both lose arbitration at the first bit and retry after the bus is free', why: 'Losing requires sending 1 and reading 0. With identical bits that never occurs for either controller.' },
        { t: 'The bus locks up, because two controllers hold SCL at the same time', why: 'Both controllers drive the same levels and the same clock, which is electrically the same as a single controller.' },
      ] },
      { q: 'An I2C driver on a single-controller bus occasionally reports "arbitration lost". What should you suspect?', kind: 'circuit', choices: [
        { t: 'SDA read low when released: noise, a slow rising edge, or a misbehaving target', ok: true, why: 'The hardware reports arbitration lost whenever the line does not match what it sent, whatever the reason. With one controller the cause is electrical.' },
        { t: 'A second controller must be hidden somewhere on the bus, perhaps inside a module', why: 'Possible in principle, but with only one controller in the design the far more common cause is a line that did not reach the high level in time.' },
        { t: 'The target\'s address is too high to win arbitration against the controller', why: 'Address values decide between competing controllers. A target\'s address has no bearing when only one controller is transmitting.' },
      ] },
      { q: 'RS-485 firmware disables the driver as soon as the UART\'s transmit data register is empty. What does the receiving node see?', kind: 'code', choices: [
        { t: 'Frames with the last byte cut short, failing the CRC each time', ok: true, why: 'The flag rises while the final byte is still being shifted out. Turning the driver off then truncates it on the wire.' },
        { t: 'Correct frames, but with a longer gap than necessary before the reply', why: 'That is the result of waiting for transmission complete. Disabling on the empty flag acts roughly a byte time too early.' },
        { t: 'Every byte duplicated, because the driver is switched twice per byte', why: 'Driver-enable timing cannot repeat data. It only decides how much of the bit stream reaches the cable.' },
      ] },
      { q: 'Twenty sensor nodes on one cable each need to report rare alarms within 5 ms, with alarms prioritised. Which approach fits best?', kind: 'arch', choices: [
        { t: 'CAN, with the lowest identifiers given to the most urgent alarms', ok: true, why: 'Any node can transmit the moment the bus is idle, and simultaneous alarms are ordered by identifier without loss.' },
        { t: 'RS-485 with one controller polling every node in turn at a fixed rate', why: 'A polling cycle over twenty nodes takes far longer than 5 ms at ordinary baud rates, and an alarm must wait for its node\'s turn.' },
        { t: 'SPI with twenty chip selects, read by the controller in a loop', why: 'A peripheral cannot signal an alarm on SPI, so the controller would have to poll, and SPI is not suited to a long shared cable.' },
      ] },
    ],
  },

  // ------------------------------------------------------------------ 12
  {
    id: 'proto-debug', title: 'Communication errors and troubleshooting', minutes: 50,
    summary: 'A fixed order of checks from power to protocol, a catalogue of symptoms and what they mean, and how to use a logic analyser properly.',
    skills: ['proto-debug', 'proto-logic-analyzer'],
    blocks: [
      `## The problem
A sensor that worked yesterday returns nothing today. You could change the baud rate, swap two wires, re-flash, try another library, and add a delay — and after an hour you would have a different non-working system and no idea which change mattered.

Communication faults are layered. A fault at a lower layer makes everything above it meaningless: there is no point studying the bytes if the voltage is wrong. So debug **from the bottom up, in a fixed order, changing one thing at a time**, and write down what you measured.

## The ladder`,
      { t: 'ascii', caption: 'Check in this order. Do not skip a rung because you are sure it is fine.',
        text:
`6. PROTOCOL    right command? byte order? CRC parameters? state of the device?
5. ADDRESSING  right I2C address / chip select / CAN identifier / port?
4. TIMING      baud rate, clock mode, clock speed, bit order
3. WIRING      TX->RX crossed? SDA/SCL swapped? MISO/MOSI? continuity? pull-ups? termination?
2. LEVELS      3.3 V vs 5 V vs RS-232? idle levels correct? edges reach the rails?
1. POWER + GND supply voltage AT THE CHIP? common ground between the boards?

   tool:  1-3 multimeter (then oscilloscope)   4-6 logic analyser with decoders` },
      `**1. Power and ground.** Measure the supply at the device's own pins, not at the regulator. Check for a ground connection between every pair of boards. A device that is unpowered but connected to a bus can be partly powered *through* its signal pins by its protection diodes and behave bizarrely.

**2. Levels.** With the bus idle, measure every line with a multimeter. UART TX: the logic supply. SDA and SCL: the pull-up rail. CS: high. CAN_H and CAN_L: both about 2.5 V. Then compare logic families: a 5 V signal into a 3.3 V pin, or RS-232 anywhere near an MCU, is a fault to fix before going further.

**3. Wiring.** Trace every wire end to end. Check the crossover (TX→RX; SDO→MISO). Check pull-ups exist once per line, termination exists twice per CAN or RS-485 bus. On a breadboard, suspect the contacts and the split power rails.

**4. Timing.** Baud rate and frame format; SPI mode and bit order; a clock slow enough for the wiring. Measure rather than trust: read a bit time off a capture.

**5. Addressing.** Is the transaction reaching the right device? I2C address form (7-bit against 8-bit) and strap pins; the correct CS line and polarity; the right CAN identifier and filter; the right serial port on the PC.

**6. Protocol.** Only now look at content: the command byte, register number, byte order, the CRC's parameters and coverage, whether the device needs an initialisation or wake-up sequence, timeouts.`,
      { t: 'callout', kind: 'why', title: 'Why bottom-up, when the bug is usually in the software?',
        md: 'Because the rungs are not equally expensive. Rungs 1 to 3 take two minutes with a multimeter and eliminate the faults that make every higher-level observation misleading. Skipping them costs hours when the answer turns out to be a loose ground wire, and nothing when it does not.' },
      `## Symptoms and what they point to
| Symptom | Likely layer | First suspects |
|---|---|---|
| UART: complete silence | 3 | TX/RX not crossed, wrong pins, wrong port, no ground |
| UART: every character wrong | 4 or 2 | baud rate; inverted or RS-232 levels |
| UART: mostly right, some wrong, framing errors | 4, 1 | baud a few percent off, oscillator drift; noise; missing ground |
| UART: right letters, odd high-bit symbols | 4 | parity or data-bits mismatch |
| I2C: NACK on the address | 5, 3, 1 | wrong address or address form; device unpowered; no pull-ups; SDA/SCL swapped |
| I2C: SDA or SCL stuck low | 2, 3 | target left mid-byte (clock it out); short; missing pull-up |
| I2C: works slow, fails fast | 2 | pull-ups too large for the bus capacitance |
| SPI: all 0xFF | 3, 5 | CS not asserted, device unpowered, MISO floating |
| SPI: all 0x00 | 3, 6 | MISO stuck low; device not answering this command; MOSI/MISO swapped |
| SPI: values shifted by one bit | 4 | wrong CPHA/CPOL; clock too fast |
| CAN: endless retransmission | 5, 3 | no second node to ACK; bit-rate mismatch |
| Any: intermittent, worse with long wires | 2, 1 | capacitance, crosstalk, reflections, ground return shared with heavy loads |
| Any: works only with the probe attached | 1, 2 | the probe supplies the missing ground, or its capacitance tames a marginal edge |

**Intermittent faults** deserve their own paragraph. Long wires add capacitance (slow edges) and inductance (ringing). Parallel wires in a ribbon cable couple edges into each other (**crosstalk**): a fast SPI clock next to a quiet data line produces glitches that look like extra clocks or bits. A ground wire that also carries motor current has a voltage across it that moves every signal's reference. The experiments that separate these: lower the bit rate (timing or edge problem if it helps); separate or re-route the wires, pairing each signal with a ground (crosstalk); power the noisy load from a separate supply (shared-ground noise); and look at the analog waveform with an oscilloscope, because a logic analyser has already thrown that information away.`,
      `## The method, applied: three worked diagnoses
The table tells you where to look first. It does not tell you the cause; only a **measurement** does. Each case below is written the way your notes should be: the symptom, then what was measured on each rung in order, stopping at the first rung whose evidence is wrong.

**Case 1. Symptom: a terminal at 115200 baud shows a steady stream of wrong characters from a sensor board.**

| Rung | Measurement | Verdict |
|---|---|---|
| 1 Power, ground | 3.30 V at the board's regulator output and at the MCU; ground wire has continuity | pass |
| 2 Levels | TX idles at 3.3 V; both ends are 3.3 V logic | pass |
| 3 Wiring | characters do arrive, so TX reaches RX | pass |
| 4 Timing | narrowest pulse in a capture is 17.4 µs; 1 / 17.4 µs ≈ 57 500 | **fail** |

Cause: the board transmits at 57600 baud, half the terminal's rate. Evidence: the measured bit time, not the garbage itself. Nothing above rung 4 was examined, and nothing needed to be.

**Case 2. Symptom: an I2C sensor answers on the bench at 400 kHz but NACKs intermittently once a 30 cm cable is added.**

| Rung | Measurement | Verdict |
|---|---|---|
| 1 Power, ground | 3.29 V at the sensor's VDD pin at the far end of the cable; ground continuous | pass |
| 2 Levels | multimeter: SDA and SCL idle at 3.3 V. Oscilloscope: SCL rises from 30 % to 70 % in 620 ns | **fail** (limit 300 ns) |

Cause: the pull-ups are too large for the capacitance the cable added. The evidence even gives the numbers: with the 4.7 kΩ resistors fitted, C_b = t_r / (0.8473 × R_p) = 620 ns / (0.8473 × 4.7 kΩ) ≈ 156 pF, so R_p(max) at 400 kHz is 300 ns / (0.8473 × 156 pF) ≈ 2.27 kΩ. Fit 2.2 kΩ (still above the 967 Ω minimum) and measure the edge again. Notice that a multimeter passed this rung and a logic analyser would have decoded the bus happily; only the oscilloscope shows the edge.

**Case 3. Symptom: an SPI flash chip returns 0xFF for every byte, in every mode.**

| Rung | Measurement | Verdict |
|---|---|---|
| 1 Power, ground | 3.31 V at the chip's VCC pin | pass |
| 2 Levels | idle: CS 3.3 V, SCLK 0 V at the chip's pins | pass |
| 3 Wiring | capture taken **at the chip's pins**: SCLK shows 32 pulses, MOSI carries 9F 00 00 00, but CS stays high throughout | **fail** |

Cause: the firmware toggles a GPIO that is not the one routed to the chip's CS pin. The chip was never selected, so it never drove MISO, and the pull-up supplied the 0xFF. Changing the SPI mode (rung 4) or the command (rung 6) could never have helped. The evidence was one line that did not move.

In all three, the diagnosis is a sentence of the form "*this measurement* shows *this rung* is wrong". If you cannot yet say that sentence, you are still guessing: go back down the ladder and measure.`,
      { t: 'exercise', prompt: `A CAN node on a two-node bench network retransmits the same frame without end. You measure: 5.0 V at both transceivers' supply pins and a common ground; CAN_H and CAN_L both at about 2.5 V when idle; with the power off, **120 Ω** between CAN_H and CAN_L; both nodes configured for 500 kbit/s. Which rung of the ladder (1 to 6) does the evidence say is wrong?`,
        hints: ['Go up the ladder one rung at a time. For each measurement, ask: what value would a healthy bus give?', 'Supply, ground and idle levels are what a healthy bus shows. What should an unpowered, correctly terminated bus measure between CAN_H and CAN_L?', 'Two 120 Ω terminators in parallel read 60 Ω. A reading of 120 Ω means one of them is missing: which rung checks that termination exists at both ends?'],
        solution: 'Rung **3**, wiring. Rungs 1 and 2 pass (supply, ground, idle levels). The 120 Ω reading is the first evidence that fails: a correctly terminated bus reads 60 Ω, so one terminator is missing. With one end unterminated, reflections corrupt bits, the receiver never sees a valid frame to acknowledge, and the transmitter retries. The bit rate (rung 4) matched and was never the problem — and you would not have known that it was irrelevant without the resistance measurement.',
        answer: { type: 'number', value: 3, tol: 0 } },
      { t: 'exercise', prompt: 'An I2C bus with 3.3 kΩ pull-ups to 3.3 V fails at 400 kHz. On an oscilloscope you measure a 30 %–70 % rise time of 500 ns on SCL. Estimate the bus capacitance in picofarads from that measurement.',
        hints: ['Which formula from the I2C lesson links rise time, pull-up resistance and bus capacitance? You know two of the three.', 't_r = 0.8473 × R_p × C_b, so C_b = t_r / (0.8473 × R_p).', '500e-9 / (0.8473 × 3300), then convert farads to picofarads.'],
        solution: 'C_b = 500 ns / (0.8473 × 3.3 kΩ) ≈ **179 pF**. With that capacitance the largest resistor that meets 300 ns is 300 ns / (0.8473 × 179 pF) ≈ 1.98 kΩ, so 1.8 kΩ would do (the minimum is 967 Ω). Turning a waveform into a component value like this is the point of measuring instead of trying resistors at random.',
        answer: { type: 'number', value: 179, tol: 4, unit: 'pF' } },
      { t: 'predict', q: 'Two boards exchange UART data. A is powered from a laptop, B from a battery. Only A\'s TX and B\'s RX are joined. B receives erratic data: sometimes correct, sometimes garbage, and it changes when you touch the boards. What is the fault?',
        choices: [
          { t: 'There is no ground connection, so B has no stable reference for A\'s signal', ok: true, why: 'Without a shared ground the voltage B sees depends on stray coupling between the two supplies, which changes with touch and position.' },
          { t: 'The baud rates differ slightly, and touching the board shifts the oscillator', why: 'A small baud error gives errors that depend on the data and temperature, not on someone touching the board.' },
          { t: 'B\'s RX pin needs a pull-up, because nothing defines its level between bytes', why: 'A is actively driving the line both high and low. What is missing is the return path that gives those levels a meaning at B.' },
        ],
        reveal: 'Rung 1. "Changes when touched" is the signature of a floating reference: your body is completing a high-impedance path. Add the ground wire. The scenario below lets you find the same fault with a meter.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'no-common-ground' }, caption: 'Work up the ladder with the available measurements. Choose the diagnosis only when a measurement supports it.' },
      { t: 'widget', name: 'protocol-debug', props: { scenario: 'wrong-address' }, caption: 'The driver was written from the datasheet and every transaction is NACKed. Which rung is this?' },
      `## The logic analyser
A **logic analyser** samples several lines at a fixed rate, compares each with a threshold, and stores 0s and 1s against time. Cheap 8-channel USB units with the open-source PulseView/sigrok software are sufficient for everything in this section. What it gives you that nothing else does: the exact sequence of events on several lines at once, decoded.

### Using one well
1. **Ground first.** Connect the analyser's ground to the circuit's ground before any signal probe. No ground, no meaningful capture.
2. **Check the voltage.** Confirm the signal levels are within the analyser's input range and above its threshold. Many inexpensive analysers accept 0–5 V logic with a fixed threshold; they are not for RS-232 or for the CAN wires themselves (probe the transceiver's logic-side TX/RX instead).
3. **Choose the sample rate** (next heading).
4. **Trigger** on the start of the event: a falling edge on CS, on UART TX, or on SDA. Capture some time before the trigger as well.
5. **Add a decoder** and give it the settings you *believe* are in use. Decoder errors — framing errors, missing ACKs, odd bit counts — are information about which belief is wrong.
6. **Verify the decoder by hand once.** Decode one byte yourself with the cursors. Decoders faithfully decode with the wrong settings, too.

### Sample rate
The analyser sees the line only at its sample instants. An edge can be recorded up to one sample period late.

- For a **clocked** bus (SPI, I2C) you need at least a few samples in each half-period of the clock so that clock and data edges are placed in the right order: sample at **4 times the clock frequency as a minimum, 10 times for comfort**.
- For a **UART** the decoder must place samples in mid-bit just as a receiver does; again at least 4 samples per bit, preferably 10 or more. Measuring an unknown baud rate accurately needs more: with 10 samples per bit your bit-time measurement can be off by 10 %.
- To see **glitches** narrower than a bit you need a rate set by the glitch width, not the bit rate.

Too low a rate does not produce an error message. It produces a clean-looking capture that is wrong: missing clock pulses, data that appears to change on the wrong edge. If a decode looks impossible, raise the sample rate before believing it.

### What it cannot show
A logic analyser reports only "above threshold" or "below". It hides slow edges, ringing, levels that sit at 1.5 V, and contention. An I2C line with far too weak a pull-up may decode perfectly on the analyser — whose threshold happens to be lower than the target chip's — while the target sees nothing. Its input capacitance also loads the line slightly. When the digits look right and the system still fails, the fault is analog and you need an **oscilloscope**.`,
      { t: 'exercise', prompt: 'Your logic analyser samples at 24 MHz with all channels active. Applying the "at least 4 samples per clock period" rule, what is the highest SPI clock frequency, in MHz, that you should trust it to decode?',
        hints: ['Samples per clock period = sample rate ÷ clock frequency.', 'Set that ratio to 4 and solve for the clock frequency.'],
        solution: '24 MHz / 4 = **6 MHz**, and for a comfortable 10 samples per period only 2.4 MHz. To debug a 20 MHz SPI link with this analyser, slow the bus down for the capture: logic bugs remain, and if the fault vanishes at low speed you have learnt it is a timing or signal-integrity problem.',
        answer: { type: 'number', value: 6, tol: 0.1, unit: 'MHz' } },
      { t: 'exercise', prompt: 'You capture a 115200-baud UART at 1 MHz. How many samples fall within each bit (to one decimal place)?',
        hints: ['Bit time at 115200 baud is 8.68 µs.', 'The sample period at 1 MHz is 1 µs.'],
        solution: '1 000 000 / 115 200 = **8.7** samples per bit. Enough to decode, but a bit time read off this capture is uncertain by about 1 part in 9 — too coarse to tell 115200 from a rate 5 % away. Use a higher sample rate when the question is "what exactly is the baud rate?".',
        answer: { type: 'number', value: 8.7, tol: 0.1 } },
      { t: 'widget', name: 'logic-analyzer', props: { capture: 'mystery' }, caption: 'Four unlabelled test points. Use idle levels and edge patterns to decide which lines belong to a bus and which bus it is, before you add a decoder.' },
      { t: 'callout', kind: 'note', title: 'Identifying an unknown bus from its shape',
        md: `- One line idling high with irregular bursts of low pulses whose widths are multiples of one unit → **UART**. The unit is the bit time.
- Two lines idling high; one shows evenly spaced pulses in groups of nine, the other changes only while the first is low → **I2C** (the regular one is SCL).
- One line that goes low for the duration of a burst (CS), one with regular pulses in multiples of eight (SCLK), one or two with data → **SPI**. The clock's level before the burst gives CPOL.
- A line that never changes is power, ground, or an idle signal such as an interrupt or reset; a single pulse unrelated to the bursts is likely one of those too.` },
      { t: 'callout', kind: 'mistake', title: 'Changing two things at once',
        md: 'You swap TX and RX and change the baud rate in the same attempt, and it still does not work. You now do not know whether the wiring was right before. Change one thing, observe, and either keep it for a stated reason or put it back. Keep notes: a list of "measured 3.29 V at the sensor\'s VDD pin; SDA idle 3.3 V; SCL idle 0.1 V" is what lets you, or a colleague, see the answer.' },
      { t: 'callout', kind: 'security', title: 'The same tools read other people\'s buses',
        md: 'Everything in this lesson — identifying a bus from its idle levels, finding a baud rate from the narrowest pulse, decoding with a logic analyser — is also the first step of hardware security assessment: an unlabelled header on a product is often a UART console or a flash chip\'s SPI bus. Practise it on hardware you own. As a designer, assume anyone can do it to your product: debug consoles need authentication or removal, and secrets must not cross a board-level bus in the clear. The security section develops this.' },
      `## A harder case
A board reads an SPI accelerometer correctly on the bench. In the product, mounted next to a motor driver and connected by a 20 cm ribbon cable, roughly one reading in a thousand is wildly wrong. The firmware and all settings are identical.

Walk the ladder with what you know. Power: is the sensor's supply dipping when the motor switches? (Oscilloscope on its VDD pin, triggered on the motor PWM.) Ground: does motor current share the cable's ground wire? Levels and wiring: 20 cm of ribbon puts SCLK beside MISO — crosstalk — and adds capacitance that slows edges. Timing: is the SPI clock near the limit for that cable? Experiments, one at a time: lower the clock by a factor of ten; stop the motor; re-order the ribbon so each signal has a ground neighbour. Whichever experiment removes the errors names the mechanism. Then, because no cable is perfect, add what the protocol lacks: read the device's ID or status alongside the data as a sanity check, and reject implausible readings. Diagnosis first, then the fix, then defence in depth.`,
      { t: 'refs', items: [
        { title: 'sigrok wiki: protocol decoders', url: 'https://sigrok.org/wiki/Protocol_decoders', note: 'The decoders available in PulseView and sigrok-cli. URL not load-tested from this environment.' },
        { title: 'PulseView (source repository)', url: 'https://github.com/sigrokproject/pulseview' },
      ] },
    ],
    quiz: [
      { q: 'An I2C sensor never acknowledges. What do you check first?', kind: 'circuit', choices: [
        { t: 'Supply at the sensor\'s pins and the idle level of SDA and SCL, with a multimeter', ok: true, why: 'Power and levels are the lowest rungs. If the device is unpowered or a line is not pulled up, nothing higher can work.' },
        { t: 'The register address in the read command, against the datasheet\'s register map', why: 'A wrong register affects the data returned after the address is acknowledged. The address byte itself is failing here.' },
        { t: 'Whether a different I2C library, or the vendor\'s example code, gets an acknowledge', why: 'Swapping software before confirming power, levels and wiring tests the layer least likely to explain a total absence of acknowledgement.' },
      ] },
      { q: 'A capture of a 2 MHz SPI transfer taken at a 4 MHz sample rate shows data apparently changing on the sampling edge and some bytes with 7 clocks. What is the most probable explanation?', kind: 'concept', choices: [
        { t: 'The sample rate is too low: edges are misplaced and narrow pulses are missed', ok: true, why: 'Two samples per clock period cannot place clock and data edges in order or guarantee every pulse is seen. The capture, not the bus, is wrong.' },
        { t: 'The controller is using the wrong SPI mode, which moves data onto the sampling edge', why: 'A wrong mode still produces eight clocks per byte. Missing clock pulses point to the measurement.' },
        { t: 'The peripheral is stretching the clock, which hides one pulse in some bytes', why: 'SPI has no clock stretching: the peripheral cannot influence SCLK at all.' },
      ] },
      { q: 'A logic analyser decodes an I2C transaction perfectly, yet the target does not respond. An oscilloscope would most likely reveal:', kind: 'circuit', choices: [
        { t: 'Slow rising edges, or a high level that does not reach the target\'s threshold', ok: true, why: 'The analyser reduces the waveform to above or below its own threshold. A marginal analog signal can satisfy the analyser and not the chip.' },
        { t: 'A different sequence of bytes from the one the logic analyser decoded', why: 'Both instruments observe the same wire. The oscilloscope adds voltage and edge-shape information; it does not change the logical content.' },
        { t: 'A wrong I2C address in the first byte, which the decoder displayed incorrectly', why: 'A wrong address is visible in the decoded bytes, which is exactly what the logic analyser is good at showing.' },
      ] },
      { q: 'Which measurement tells you the most about a UART link that is completely silent, in the least time?', kind: 'circuit', choices: [
        { t: 'A multimeter reading of each board\'s TX and RX pins at idle', ok: true, why: 'A TX pin idles at the supply voltage. Two readings show which pins are outputs, whether they are crossed, and whether anything is driving the line.' },
        { t: 'A long logic-analyser capture with a UART decoder at several baud rates', why: 'That explores timing, a higher rung. If the wires are not crossed or a board is unpowered, there is nothing on the line to decode.' },
        { t: 'Reading the UART error counters in firmware', why: 'With no signal arriving the receiver records neither data nor errors, so the counters stay at zero and tell you nothing new.' },
      ] },
      { q: 'An SPI link fails about once per thousand transfers in the product but never on the bench. Slowing the clock from 8 MHz to 1 MHz makes the errors disappear. What have you learnt?', kind: 'arch', choices: [
        { t: 'The fault is timing margin or signal integrity, not the command sequence', ok: true, why: 'A logic error in the protocol would occur at any speed. Dependence on clock rate points to the physical layer.' },
        { t: 'The device\'s datasheet maximum clock is wrong and should be reported to the vendor', why: 'The datasheet figure assumes clean signals at the pins. The cable and environment have reduced the margin, which is a different matter.' },
        { t: 'The firmware has a race condition that only shows at high bus speeds', why: 'A race in firmware would depend on software timing, not on the bus clock. The experiment changed only the bus speed.' },
      ] },
      { q: 'Probing an unknown 4-pin header: pin 1 reads 0 V, pin 2 a steady 3.3 V that does not drop under a 10 kΩ load to ground, pin 3 sits at 3.3 V with brief bursts of low pulses at power-up, pin 4 floats near 3.3 V. What is the most likely function?', kind: 'security', choices: [
        { t: 'A UART: pin 1 ground, pin 2 supply, pin 3 TX, pin 4 RX', ok: true, why: 'A line idling high with bursts of pulses at boot is a transmitting UART; a weakly pulled-up line that never moves is its receive input.' },
        { t: 'An I2C bus: pin 2 pull-up supply, pin 3 SDA, pin 4 SCL', why: 'I2C needs a clock line that pulses in step with the data. A line that never changes while the other carries data is not SCL.' },
        { t: 'An SPI bus without chip select: pin 3 MOSI, pin 4 MISO', why: 'SPI activity needs a regular clock burst on one line. Only one line here shows any transitions.' },
      ] },
    ],
  },
];

export default { lessons };
