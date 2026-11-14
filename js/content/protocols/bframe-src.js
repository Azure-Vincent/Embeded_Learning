// Lab B reference source (bframe.c), in four parts. Generated from files that were compiled together with
// gcc -Wall -Wextra -std=c11 and run; keep the parts in this order.
export const BF_PART1 = String.raw`/* bframe.c, part 1: frame layout, CRC and encoder.
 * Wire format (all fields one byte unless noted):
 *   SOF 0x7E | VER | TYPE | SEQ | LEN | PAYLOAD (LEN bytes, 0..32) | CRC16 high | CRC16 low
 * CRC-16/CCITT-FALSE over VER..PAYLOAD, sent big-endian. */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#define BF_SOF          0x7E
#define BF_VERSION      1
#define BF_MAX_PAYLOAD  32
#define BF_OVERHEAD     7
#define BF_MAX_FRAME    (BF_MAX_PAYLOAD + BF_OVERHEAD)

enum { BF_PING = 0x01, BF_READ = 0x02, BF_ADD = 0x03, BF_RESP = 0x80, BF_NAK = 0xFF };
enum { BF_E_VERSION = 1, BF_E_LENGTH = 2, BF_E_TYPE = 3 };      /* NAK payload[0] */

typedef struct {
    uint8_t ver, type, seq, len;
    uint8_t payload[BF_MAX_PAYLOAD];
} bf_frame_t;

static uint16_t crc16_update(uint16_t crc, uint8_t b)
{
    crc ^= (uint16_t)(b << 8);
    for (int i = 0; i < 8; i++)
        crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    return crc;
}

/* Serialises f into out. Returns the number of bytes written, 0 if it does not fit. */
size_t bf_encode(const bf_frame_t *f, uint8_t *out, size_t cap)
{
    if (f->len > BF_MAX_PAYLOAD || cap < (size_t)f->len + BF_OVERHEAD) return 0;
    size_t n = 0;
    out[n++] = BF_SOF;
    out[n++] = f->ver;
    out[n++] = f->type;
    out[n++] = f->seq;
    out[n++] = f->len;
    memcpy(&out[n], f->payload, f->len);
    n += f->len;
    uint16_t crc = 0xFFFF;
    for (size_t i = 1; i < n; i++) crc = crc16_update(crc, out[i]);   /* SOF is not covered */
    out[n++] = (uint8_t)(crc >> 8);
    out[n++] = (uint8_t)(crc & 0xFF);
    return n;
}
`;
export const BF_PART2 = String.raw`/* bframe.c, part 2: the receive parser. One byte in, one verdict out. */
typedef enum { BF_NONE, BF_FRAME, BF_ERR_LEN, BF_ERR_CRC } bf_result_t;
typedef enum { ST_SOF, ST_HEADER, ST_PAYLOAD, ST_CRC_HI, ST_CRC_LO } bf_state_t;

typedef struct {
    bf_state_t st;
    uint8_t idx, crc_hi;
    uint16_t crc;
    bf_frame_t f;                                   /* valid when bf_feed returns BF_FRAME */
    uint32_t n_ok, n_crc, n_len, n_skipped;         /* error counters */
} bf_parser_t;

/* Call at start-up and whenever the line has been silent for longer than the inter-byte timeout. */
void bf_reset(bf_parser_t *p) { p->st = ST_SOF; }

bf_result_t bf_feed(bf_parser_t *p, uint8_t b)
{
    switch (p->st) {
    case ST_SOF:
        if (b == BF_SOF) { p->st = ST_HEADER; p->idx = 0; p->crc = 0xFFFF; }
        else p->n_skipped++;                        /* noise between frames */
        return BF_NONE;

    case ST_HEADER:
        p->crc = crc16_update(p->crc, b);
        switch (p->idx++) {
        case 0: p->f.ver = b; break;
        case 1: p->f.type = b; break;
        case 2: p->f.seq = b; break;
        default:
            p->f.len = b;
            if (b > BF_MAX_PAYLOAD) {               /* check BEFORE using it as a count */
                p->n_len++; p->st = ST_SOF;
                return BF_ERR_LEN;
            }
            p->idx = 0;
            p->st = b ? ST_PAYLOAD : ST_CRC_HI;
        }
        return BF_NONE;

    case ST_PAYLOAD:
        p->crc = crc16_update(p->crc, b);
        p->f.payload[p->idx++] = b;                 /* idx < len <= BF_MAX_PAYLOAD */
        if (p->idx == p->f.len) p->st = ST_CRC_HI;
        return BF_NONE;

    case ST_CRC_HI:
        p->crc_hi = b; p->st = ST_CRC_LO;
        return BF_NONE;

    default: /* ST_CRC_LO */
        p->st = ST_SOF;
        if ((uint16_t)((p->crc_hi << 8) | b) == p->crc) { p->n_ok++; return BF_FRAME; }
        p->n_crc++;
        return BF_ERR_CRC;
    }
}
`;
export const BF_PART3 = String.raw`/* bframe.c, part 3: the responder. It owns a 32-bit counter:
 * PING echoes the payload, READ returns the counter, ADD adds payload[0] and returns the counter. */
typedef struct {
    uint32_t counter;
    int dedupe;                 /* 1 = replay the cached response to a repeated SEQ */
    int have_last;
    uint8_t last_seq;
    bf_frame_t last_resp;
    uint32_t n_dup;
} bf_responder_t;

static void nak(bf_frame_t *resp, uint8_t code)
{
    resp->type = BF_NAK; resp->len = 1; resp->payload[0] = code;
}

void bf_respond(bf_responder_t *r, const bf_frame_t *req, bf_frame_t *resp)
{
    if (r->dedupe && r->have_last && req->seq == r->last_seq) {
        *resp = r->last_resp;                       /* a retry: answer again, do NOT act again */
        r->n_dup++;
        return;
    }
    memset(resp, 0, sizeof *resp);
    resp->ver = BF_VERSION;
    resp->seq = req->seq;                           /* the response carries the request's SEQ */
    resp->type = (uint8_t)(req->type | BF_RESP);

    if (req->ver != BF_VERSION) nak(resp, BF_E_VERSION);
    else if (req->type == BF_PING) { resp->len = req->len; memcpy(resp->payload, req->payload, req->len); }
    else if (req->type == BF_READ || req->type == BF_ADD) {
        if (req->len != (req->type == BF_ADD ? 1 : 0)) nak(resp, BF_E_LENGTH);
        else {
            if (req->type == BF_ADD) r->counter += req->payload[0];
            resp->len = 4;                          /* big-endian on the wire */
            resp->payload[0] = (uint8_t)(r->counter >> 24);
            resp->payload[1] = (uint8_t)(r->counter >> 16);
            resp->payload[2] = (uint8_t)(r->counter >> 8);
            resp->payload[3] = (uint8_t)(r->counter);
        }
    }
    else nak(resp, BF_E_TYPE);

    r->have_last = 1; r->last_seq = req->seq; r->last_resp = *resp;
}
`;
export const BF_PART4 = String.raw`/* bframe.c, part 4: the requester, a simulated lossy wire, and the tests. */
#define BF_RETRIES 3

static uint32_t rng_state = 1;                      /* small LCG: repeatable "randomness" */
static uint32_t rng(void) { rng_state = rng_state * 1664525u + 1013904223u; return rng_state >> 8; }

/* The wire: loses loss_pct % of frames whole and flips one bit in corrupt_pct % of the rest. */
static size_t wire(uint8_t *buf, size_t n, unsigned loss_pct, unsigned corrupt_pct)
{
    if (rng() % 100 < loss_pct) return 0;
    if (rng() % 100 < corrupt_pct) buf[rng() % n] ^= (uint8_t)(1u << (rng() % 8));
    return n;
}

typedef struct {
    uint8_t seq;
    bf_parser_t rx;
    uint32_t n_retry, n_timeout, n_fail;
} bf_requester_t;

typedef struct { bf_responder_t app; bf_parser_t rx; uint32_t n_reached; } peer_t;
static unsigned g_loss = 0, g_corrupt = 0;

/* One request/response transaction with retries. Returns 1 and fills *resp on success. */
static int transact(bf_requester_t *q, peer_t *peer, uint8_t type,
                    const uint8_t *payload, uint8_t len, bf_frame_t *resp)
{
    bf_frame_t req = { .ver = BF_VERSION, .type = type, .seq = ++q->seq, .len = len };
    memcpy(req.payload, payload, len);
    int reached = 0;

    for (int attempt = 0; attempt <= BF_RETRIES; attempt++) {
        uint8_t buf[BF_MAX_FRAME];
        bf_frame_t answer;
        int answered = 0;
        if (attempt) q->n_retry++;

        size_t n = wire(buf, bf_encode(&req, buf, sizeof buf), g_loss, g_corrupt);
        bf_reset(&peer->rx);                        /* silence before each frame = inter-byte timeout */
        for (size_t i = 0; i < n; i++)
            if (bf_feed(&peer->rx, buf[i]) == BF_FRAME) {
                if (!reached) { reached = 1; peer->n_reached++; }
                bf_respond(&peer->app, &peer->rx.f, &answer);
                answered = 1;
            }
        if (answered) {
            n = wire(buf, bf_encode(&answer, buf, sizeof buf), g_loss, g_corrupt);
            bf_reset(&q->rx);
            for (size_t i = 0; i < n; i++)
                if (bf_feed(&q->rx, buf[i]) == BF_FRAME && q->rx.f.seq == req.seq) {
                    *resp = q->rx.f;
                    return 1;
                }
        }
        q->n_timeout++;                             /* on hardware: no valid response before the deadline */
    }
    q->n_fail++;
    return 0;
}

static uint32_t run_link(int dedupe, uint32_t *reached, bf_requester_t *q_out)
{
    bf_requester_t q; peer_t peer; bf_frame_t resp;
    memset(&q, 0, sizeof q); memset(&peer, 0, sizeof peer);
    peer.app.dedupe = dedupe;
    rng_state = 2024; g_loss = 10; g_corrupt = 10;
    const uint8_t one = 1;
    for (int i = 0; i < 2000; i++) transact(&q, &peer, BF_ADD, &one, 1, &resp);
    g_loss = g_corrupt = 0;
    *reached = peer.n_reached; *q_out = q;
    return peer.app.counter;
}

int main(void)
{
    int fail = 0;
    uint8_t buf[BF_MAX_FRAME];
    bf_parser_t p;
    memset(&p, 0, sizeof p);

    /* 1. Known vector: PING, seq 1, payload "hi". */
    bf_frame_t f = { .ver = BF_VERSION, .type = BF_PING, .seq = 1, .len = 2, .payload = { 'h', 'i' } };
    size_t n = bf_encode(&f, buf, sizeof buf);
    printf("vector:");
    for (size_t i = 0; i < n; i++) printf(" %02X", (unsigned)buf[i]);
    printf("\n");
    const uint8_t want[] = { 0x7E, 0x01, 0x01, 0x01, 0x02, 0x68, 0x69, 0x86, 0x39 };
    fail |= n != sizeof want || memcmp(buf, want, n) != 0;

    /* 2. Round trip at every payload length. */
    for (unsigned len = 0; len <= BF_MAX_PAYLOAD; len++) {
        bf_frame_t g = { .ver = BF_VERSION, .type = BF_PING, .seq = (uint8_t)len, .len = (uint8_t)len };
        for (unsigned i = 0; i < len; i++) g.payload[i] = (uint8_t)(rng() >> 4);
        n = bf_encode(&g, buf, sizeof buf);
        bf_result_t r = BF_NONE;
        for (size_t i = 0; i < n; i++) r = bf_feed(&p, buf[i]);
        fail |= r != BF_FRAME || p.f.len != len || memcmp(p.f.payload, g.payload, len) != 0;
    }
    fail |= bf_encode(&(bf_frame_t){ .len = BF_MAX_PAYLOAD + 1 }, buf, sizeof buf) != 0;

    /* 3. Corruption: flip every single bit, then every pair of bits, of one frame. None may be accepted. */
    f.len = 8; memcpy(f.payload, "ABCDEFGH", 8);
    n = bf_encode(&f, buf, sizeof buf);
    unsigned accepted = 0, tried = 0;
    for (size_t a = 0; a < n * 8; a++)
        for (size_t b = a; b < n * 8; b++) {
            uint8_t bad[BF_MAX_FRAME];
            memcpy(bad, buf, n);
            bad[a / 8] ^= (uint8_t)(1u << (a % 8));
            if (b != a) bad[b / 8] ^= (uint8_t)(1u << (b % 8));
            bf_reset(&p);
            for (size_t i = 0; i < n; i++) if (bf_feed(&p, bad[i]) == BF_FRAME) accepted++;
            tried++;
        }
    printf("bit-flip test: %u corrupted frames, %u accepted\n", tried, accepted);
    fail |= accepted != 0;

    /* 4. Garbage: a million random bytes must not crash the parser; then it must still work. */
    memset(&p, 0, sizeof p);
    rng_state = 7;
    for (int i = 0; i < 1000000; i++) bf_feed(&p, (uint8_t)(rng() >> 3));
    printf("garbage test: skipped %lu, bad length %lu, bad CRC %lu, falsely accepted %lu\n",
           (unsigned long)p.n_skipped, (unsigned long)p.n_len, (unsigned long)p.n_crc, (unsigned long)p.n_ok);
    unsigned tries = 0;
    bf_result_t r = BF_NONE;
    while (r != BF_FRAME && tries < 10) {           /* no reset: resynchronise from the stream alone */
        for (size_t i = 0; i < n; i++) if (bf_feed(&p, buf[i]) == BF_FRAME) r = BF_FRAME;
        tries++;
    }
    printf("resynchronised after %u frame(s)\n", tries);
    fail |= r != BF_FRAME;

    /* 5. Lossy link, 2000 ADD(1) requests: with duplicate detection every request acts at most once. */
    uint32_t reached; bf_requester_t q;
    uint32_t counter = run_link(1, &reached, &q);
    printf("dedupe on : counter %lu, requests that reached the peer %lu, retries %lu, failed %lu\n",
           (unsigned long)counter, (unsigned long)reached, (unsigned long)q.n_retry, (unsigned long)q.n_fail);
    fail |= counter != reached;
    counter = run_link(0, &reached, &q);
    printf("dedupe off: counter %lu, requests that reached the peer %lu  <- acted more than once\n",
           (unsigned long)counter, (unsigned long)reached);
    fail |= counter <= reached;

    puts(fail ? "FAIL" : "all protocol tests pass");
    return fail;
}
`;
