#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdio.h>

#define IMG_MAGIC       0x42494D47u   /* "GMIB" in memory, little-endian */
#define IMG_HEADER_LEN  16u
#define IMG_SIG_LEN     64u
#define SLOT_SIZE       0x8000u       /* size of the update slot in flash */

typedef struct {
    uint32_t magic;
    uint32_t security_version;
    uint32_t payload_len;
    uint32_t flags;
} img_header_t;

typedef enum {
    IMG_OK, IMG_ERR_ARG, IMG_ERR_SHORT, IMG_ERR_MAGIC,
    IMG_ERR_LENGTH, IMG_ERR_FLAGS
} img_result_t;

/* Read a 32-bit little-endian value from bytes. No pointer cast, so there
 * is no alignment or endianness assumption about the host or target. */
static uint32_t rd32le(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Parse and bounds-check an image header from 'buf' holding 'avail' bytes.
 * On IMG_OK, *out is filled and *signed_len is the number of bytes the
 * signature must cover (header + payload). Nothing is trusted yet: the
 * caller still has to verify the signature before using any field. */
img_result_t img_parse(const uint8_t *buf, size_t avail,
                       img_header_t *out, size_t *signed_len)
{
    if (buf == NULL || out == NULL || signed_len == NULL) return IMG_ERR_ARG;
    if (avail < IMG_HEADER_LEN) return IMG_ERR_SHORT;

    img_header_t h;
    h.magic            = rd32le(buf + 0);
    h.security_version = rd32le(buf + 4);
    h.payload_len      = rd32le(buf + 8);
    h.flags            = rd32le(buf + 12);

    if (h.magic != IMG_MAGIC) return IMG_ERR_MAGIC;
    if (h.flags != 0u) return IMG_ERR_FLAGS;      /* unknown bits: reject */

    /* Compare against what is LEFT, by subtraction on the trusted side.
     * Writing "IMG_HEADER_LEN + payload_len + IMG_SIG_LEN <= SLOT_SIZE"
     * would wrap for payload_len near 0xFFFFFFFF and pass. */
    if (h.payload_len == 0u) return IMG_ERR_LENGTH;
    if (h.payload_len > SLOT_SIZE - IMG_HEADER_LEN - IMG_SIG_LEN) return IMG_ERR_LENGTH;
    if (avail - IMG_HEADER_LEN < (size_t)h.payload_len + IMG_SIG_LEN) return IMG_ERR_SHORT;

    *out = h;
    *signed_len = IMG_HEADER_LEN + (size_t)h.payload_len;
    return IMG_OK;
}

static void wr32le(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}

static int failures;
static void check(const char *name, bool ok)
{
    printf("%-46s %s\n", name, ok ? "ok" : "FAIL");
    if (!ok) failures++;
}

int main(void)
{
    static uint8_t img[IMG_HEADER_LEN + 100 + IMG_SIG_LEN];
    img_header_t h; size_t n = 0;

    wr32le(img + 0, IMG_MAGIC); wr32le(img + 4, 7); wr32le(img + 8, 100); wr32le(img + 12, 0);
    check("valid image accepted", img_parse(img, sizeof img, &h, &n) == IMG_OK);
    check("fields decoded", h.security_version == 7 && h.payload_len == 100 && n == 116);
    check("NULL arguments rejected", img_parse(NULL, 16, &h, &n) == IMG_ERR_ARG);
    check("15-byte buffer rejected", img_parse(img, 15, &h, &n) == IMG_ERR_SHORT);
    check("truncated by one byte rejected", img_parse(img, sizeof img - 1, &h, &n) == IMG_ERR_SHORT);

    wr32le(img + 8, 0xFFFFFFFFu);
    check("payload_len 0xFFFFFFFF rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_LENGTH);
    wr32le(img + 8, 0xFFFFFFB0u);   /* 16 + len + 64 wraps to 0 in 32 bits */
    check("wrapping payload_len rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_LENGTH);
    wr32le(img + 8, SLOT_SIZE - IMG_HEADER_LEN - IMG_SIG_LEN + 1u);
    check("one byte larger than the slot rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_LENGTH);
    wr32le(img + 8, 0);
    check("empty payload rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_LENGTH);

    wr32le(img + 8, 100); wr32le(img + 12, 0x80000000u);
    check("unknown flag bit rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_FLAGS);
    wr32le(img + 12, 0); wr32le(img + 0, IMG_MAGIC ^ 1u);
    check("bad magic rejected", img_parse(img, sizeof img, &h, &n) == IMG_ERR_MAGIC);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
