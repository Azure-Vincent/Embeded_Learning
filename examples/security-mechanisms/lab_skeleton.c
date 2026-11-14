/* valve_sec.c - host test bench for the lab. Build and run:
 *   gcc -Wall -Wextra -std=c11 -fsanitize=address,undefined -o valve_sec valve_sec.c && ./valve_sec
 * Several tests report FAIL until you implement the two functions marked TODO. */
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>

#define TAG_LEN      8u
#define MAX_PAYLOAD  16u

/* Routine 1. Return 1 if a and b hold the same n bytes, else 0.
 * Must examine all n bytes whatever the data is: no early exit. */
int ct_equal(const uint8_t *a, const uint8_t *b, size_t n)
{
    (void)a; (void)b; (void)n;
    return 0;   /* TODO */
}

/* Radio frame:  [0] type  [1] counter  [2] payload length L  [3..3+L) payload  [3+L..3+L+8) tag
 * Routine 2. Validate the layout of 'frame' (avail bytes were received).
 * On success return true and set *payload and *tag to point INTO frame and
 * *payload_len to L. Reject (return false, outputs untouched) when: any
 * pointer is NULL; the 3-byte header is incomplete; L > MAX_PAYLOAD; or the
 * frame is not EXACTLY 3 + L + TAG_LEN bytes long. */
bool frame_parse(const uint8_t *frame, size_t avail,
                 const uint8_t **payload, size_t *payload_len, const uint8_t **tag)
{
    (void)frame; (void)avail; (void)payload; (void)payload_len; (void)tag;
    return false;   /* TODO */
}

static int failures;
static void check(const char *name, bool ok)
{
    printf("%-48s %s\n", name, ok ? "ok" : "FAIL");
    if (!ok) failures++;
}

int main(void)
{
    uint8_t x[TAG_LEN] = { 1, 2, 3, 4, 5, 6, 7, 8 }, y[TAG_LEN] = { 1, 2, 3, 4, 5, 6, 7, 8 };
    check("ct: equal", ct_equal(x, y, TAG_LEN) == 1);
    y[0] ^= 1; check("ct: first byte differs", ct_equal(x, y, TAG_LEN) == 0); y[0] ^= 1;
    y[7] ^= 0x80; check("ct: last byte differs", ct_equal(x, y, TAG_LEN) == 0); y[7] ^= 0x80;
    check("ct: zero length", ct_equal(x, y, 0) == 1);

    uint8_t f[3 + MAX_PAYLOAD + TAG_LEN + 4] = { 0x01, 0x2a, 4, 'O', 'P', 'E', 'N' };
    const uint8_t *p = NULL, *t = NULL; size_t n = 99;
    check("frame: valid 4-byte payload", frame_parse(f, 3 + 4 + TAG_LEN, &p, &n, &t)
          && p == f + 3 && n == 4 && t == f + 7);
    p = NULL; t = NULL; n = 99;
    check("frame: one byte short", !frame_parse(f, 3 + 4 + TAG_LEN - 1, &p, &n, &t));
    check("frame: one byte long", !frame_parse(f, 3 + 4 + TAG_LEN + 1, &p, &n, &t));
    check("frame: header incomplete", !frame_parse(f, 2, &p, &n, &t));
    f[2] = MAX_PAYLOAD + 1;
    check("frame: payload too long", !frame_parse(f, 3 + MAX_PAYLOAD + 1 + TAG_LEN, &p, &n, &t));
    f[2] = 255;
    check("frame: length byte 255", !frame_parse(f, sizeof f, &p, &n, &t));
    f[2] = 0;
    check("frame: empty payload is allowed", frame_parse(f, 3 + TAG_LEN, &p, &n, &t) && n == 0);
    p = NULL; t = NULL; n = 99; f[2] = 4;
    check("frame: NULL output rejected", !frame_parse(f, 3 + 4 + TAG_LEN, NULL, &n, &t));
    check("frame: outputs untouched on reject", !frame_parse(f, 5, &p, &n, &t) && p == NULL && n == 99 && t == NULL);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
