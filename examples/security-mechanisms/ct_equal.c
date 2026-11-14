#include <stdint.h>
#include <stddef.h>
#include <stdio.h>

/* Returns 1 when the two buffers hold the same n bytes, otherwise 0.
 * The loop always runs n times and has no data-dependent branch. */
int ct_equal(const uint8_t *a, const uint8_t *b, size_t n)
{
    volatile uint8_t diff = 0;
    for (size_t i = 0; i < n; i++) {
        diff |= (uint8_t)(a[i] ^ b[i]);
    }
    /* diff is 0 only when every byte matched. Map 0 -> 1, non-zero -> 0
     * with arithmetic instead of a comparison on secret data. */
    return (int)(1u & (((uint32_t)diff - 1u) >> 8));
}

static int failures;
static void check(const char *name, int got, int want)
{
    printf("%-28s %s\n", name, got == want ? "ok" : "FAIL");
    if (got != want) failures++;
}

int main(void)
{
    const uint8_t tag[8]   = { 0x3a, 0x91, 0x00, 0xff, 0x10, 0x7e, 0x55, 0xc2 };
    uint8_t same[8], first[8], last[8];
    for (size_t i = 0; i < 8; i++) { same[i] = tag[i]; first[i] = tag[i]; last[i] = tag[i]; }
    first[0] ^= 0x01;   /* differs in the first byte */
    last[7]  ^= 0x80;   /* differs in the last byte  */

    check("equal buffers", ct_equal(tag, same, 8), 1);
    check("first byte differs", ct_equal(tag, first, 8), 0);
    check("last byte differs", ct_equal(tag, last, 8), 0);
    check("zero length", ct_equal(tag, first, 0), 1);
    check("prefix only", ct_equal(tag, last, 7), 1);

    /* Exhaustive single-byte check: every one of the 255 non-zero
     * differences must be reported as "not equal". */
    int all = 1;
    for (unsigned d = 1; d < 256; d++) {
        uint8_t x = 0x5a, y = (uint8_t)(0x5a ^ d);
        if (ct_equal(&x, &y, 1) != 0) all = 0;
    }
    check("all 255 one-byte differences", all, 1);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
