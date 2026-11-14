/* frame_test.c - PC test for frame.c.
 * Build: gcc -Wall -Wextra -std=c11 frame.c frame_test.c -o frame_test */
#include "frame.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

/* Feed a buffer; return how many good frames came out, remember the last. */
static int feed(frame_parser_t *p, const uint8_t *buf, size_t n,
                fp_result_t *last_err)
{
    int good = 0;
    for (size_t i = 0; i < n; i++) {
        fp_result_t r = frame_parser_feed(p, buf[i]);
        if (r == FP_FRAME) good++;
        else if (r != FP_NONE && last_err) *last_err = r;
    }
    return good;
}

int main(void)
{
    /* 1. Published check value for this CRC variant. */
    assert(crc16_ccitt(0xFFFFu, (const uint8_t *)"123456789", 9) == 0x29B1u);

    /* 2. Byte-at-a-time CRC equals one-shot CRC. */
    uint16_t c = 0xFFFFu;
    for (int i = 0; i < 9; i++) c = crc16_ccitt(c, (const uint8_t *)"123456789" + i, 1);
    assert(c == 0x29B1u);

    /* 3. Encode a frame and print it so you can compare with a capture. */
    uint8_t buf[FRAME_MAX_PAYLOAD + FRAME_OVERHEAD];
    const uint8_t ping[2] = { 0x00, 0x2A };
    size_t n = frame_encode(0x01, ping, sizeof ping, buf, sizeof buf);
    assert(n == 7 && buf[0] == 0xA5 && buf[1] == 2 && buf[2] == 0x01);
    printf("PING frame:");
    for (size_t i = 0; i < n; i++) printf(" %02X", buf[i]);
    printf("\n");

    /* 4. Round trip. */
    frame_parser_t p;
    frame_parser_init(&p);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(p.type == 0x01 && p.len == 2 && memcmp(p.payload, ping, 2) == 0);

    /* 5. Every single-bit error in the frame is rejected (none yields a frame). */
    for (size_t bit = 0; bit < n * 8; bit++) {
        uint8_t bad[sizeof buf];
        memcpy(bad, buf, n);
        bad[bit / 8] ^= (uint8_t)(1u << (bit % 8));
        frame_parser_t q;
        frame_parser_init(&q);
        int good = feed(&q, bad, n, NULL);
        frame_parser_timeout(&q);          /* line goes quiet afterwards */
        assert(good == 0);
    }

    /* 6. Noise before the frame, then two frames back to back. */
    const uint8_t noise[] = { 0x00, 0xFF, 0x13, 0x37 };
    frame_parser_init(&p);
    assert(feed(&p, noise, sizeof noise, NULL) == 0);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(feed(&p, buf, n, NULL) == 1);
    assert(p.n_ok == 2);

    /* 7. Oversized LEN is refused before any payload byte is stored. */
    const uint8_t huge[] = { 0xA5, 0xFF };
    fp_result_t err = FP_NONE;
    frame_parser_init(&p);
    feed(&p, huge, sizeof huge, &err);
    assert(err == FP_ERR_LEN && p.n_bad_len == 1 && p.state == FP_WAIT_SOF);

    /* 8. A frame cut off half way, a silence, then a good frame. */
    frame_parser_init(&p);
    feed(&p, buf, 4, NULL);
    frame_parser_timeout(&p);
    assert(p.n_timeout == 1);
    assert(feed(&p, buf, n, NULL) == 1);

    /* 9. Zero-length payload and maximum-length payload. */
    n = frame_encode(0x7F, NULL, 0, buf, sizeof buf);
    assert(n == 5);
    frame_parser_init(&p);
    assert(feed(&p, buf, n, NULL) == 1 && p.len == 0);
    uint8_t big[FRAME_MAX_PAYLOAD];
    for (unsigned i = 0; i < sizeof big; i++) big[i] = (uint8_t)i;
    n = frame_encode(0x02, big, (uint8_t)sizeof big, buf, sizeof buf);
    assert(n == sizeof buf);
    assert(feed(&p, buf, n, NULL) == 1 && p.len == FRAME_MAX_PAYLOAD);
    assert(frame_encode(0x02, big, 33, buf, sizeof buf) == 0);
    assert(frame_encode(0x02, big, 8, buf, 12) == 0);

    printf("frame: all checks passed\n");
    return 0;
}
