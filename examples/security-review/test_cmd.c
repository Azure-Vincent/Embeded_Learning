/* test_cmd.c - host tests for the command handler. Build with ASan + UBSan (see Makefile).
 *
 * Every frame and the context are heap blocks of exactly the right size, so that a read
 * or write one byte past the end is reported by AddressSanitizer. ASan does NOT report an
 * overflow that stays inside one struct (name[] into unlocked), so those cases are caught
 * by ordinary assertions on the neighbouring fields. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cmd.h"

/* Stand-in MAC for host tests only: a keyed mixing function, NOT cryptographically secure.
 * A product links HMAC-SHA-256 or AES-CMAC from a reviewed library here. */
void platform_mac(const uint8_t *msg, size_t len, uint8_t tag[CMD_TAG_LEN])
{
    uint64_t h = 0x9E3779B97F4A7C15ull;     /* plays the role of the key */

    for (size_t i = 0; i < len; i++) {
        h ^= msg[i];
        h *= 0x100000001B3ull;
        h ^= h >> 29;
    }
    for (size_t i = 0; i < CMD_TAG_LEN; i++) {
        tag[i] = (uint8_t)(h >> (8u * i));
    }
}

static int failures;
#define CHECK(cond) do { if (!(cond)) { printf("  FAIL line %d: %s\n", __LINE__, #cond); failures++; } } while (0)

typedef struct { uint8_t *bytes; size_t len; } frame_t;

/* Build a frame whose length field says `len_field` but which really carries `n` payload
 * bytes, in an exactly-sized heap block. `sign` selects a valid tag or a zero tag. */
static frame_t make_frame(uint8_t version, uint8_t cmd, uint32_t counter, uint8_t len_field,
                          const uint8_t *payload, size_t n, int sign)
{
    frame_t f;

    f.len = CMD_HDR_LEN + n + CMD_TAG_LEN;
    f.bytes = malloc(f.len);
    if (f.bytes == NULL) { abort(); }
    f.bytes[0] = version;
    f.bytes[1] = cmd;
    for (unsigned i = 0; i < 4u; i++) { f.bytes[2u + i] = (uint8_t)(counter >> (8u * i)); }
    f.bytes[6] = len_field;
    if (n > 0u) { memcpy(f.bytes + CMD_HDR_LEN, payload, n); }
    memset(f.bytes + CMD_HDR_LEN + n, 0, CMD_TAG_LEN);
    if (sign) { platform_mac(f.bytes, CMD_HDR_LEN + n, f.bytes + CMD_HDR_LEN + n); }
    return f;
}

static cmd_ctx_t *new_ctx(void)
{
    cmd_ctx_t *c = calloc(1, sizeof *c);
    if (c == NULL) { abort(); }
    return c;
}

static cmd_status_t send(cmd_ctx_t *c, uint8_t version, uint8_t cmd, uint32_t counter,
                         const uint8_t *payload, size_t n, int sign)
{
    frame_t f = make_frame(version, cmd, counter, (uint8_t)n, payload, n, sign);
    cmd_status_t st = cmd_handle(c, f.bytes, f.len);
    free(f.bytes);
    return st;
}

static void test_happy_path(void)
{
    cmd_ctx_t *c = new_ctx();
    const uint8_t cfg[] = { 4, 0xAA, 0xBB };            /* offset 4, two bytes */

    CHECK(send(c, CMD_VERSION, CMD_SET_NAME, 1, (const uint8_t *)"door-7", 6, 1) == CMD_OK);
    CHECK(strcmp(c->name, "door-7") == 0);
    CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 2, cfg, sizeof cfg, 1) == CMD_OK);
    CHECK(c->cfg[4] == 0xAA && c->cfg[5] == 0xBB);
    CHECK(c->unlocked == 0u);
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 3, NULL, 0, 1) == CMD_OK);
    CHECK(c->unlocked == 1u);
    free(c);
}

static void test_name_bounds(void)                      /* buffer overflow, CWE-120 */
{
    cmd_ctx_t *c = new_ctx();
    uint8_t big[255];

    memset(big, 'A', sizeof big);
    CHECK(send(c, CMD_VERSION, CMD_SET_NAME, 1, big, 15, 1) == CMD_OK);      /* longest legal */
    CHECK(strlen(c->name) == 15u);
    CHECK(send(c, CMD_VERSION, CMD_SET_NAME, 2, big, 16, 1) == CMD_ERR_RANGE); /* off by one */
    CHECK(send(c, CMD_VERSION, CMD_SET_NAME, 3, big, 17, 1) == CMD_ERR_RANGE); /* would hit unlocked */
    CHECK(c->unlocked == 0u);
    CHECK(send(c, CMD_VERSION, CMD_SET_NAME, 4, big, 255, 1) == CMD_ERR_RANGE); /* past the struct */
    CHECK(c->unlocked == 0u && strlen(c->name) == 15u);
    free(c);
}

static void test_frame_length(void)                     /* integer wraparound, CWE-190 -> CWE-125 */
{
    cmd_ctx_t *c = new_ctx();
    uint8_t pay[8] = { 0 };
    static const uint8_t lens[] = { 1, 9, 100, 240, 241, 249, 250, 255 };
    uint8_t tiny[3] = { CMD_VERSION, CMD_UNLOCK, 0 };

    /* The length field claims more payload than the frame holds, including the values
     * where 7 + len + 8 no longer fits in 8 bits. */
    for (size_t i = 0; i < sizeof lens; i++) {
        frame_t f = make_frame(CMD_VERSION, CMD_SET_NAME, 1, lens[i], pay, 0, 1);
        CHECK(cmd_handle(c, f.bytes, f.len) == CMD_ERR_LENGTH);
        free(f.bytes);
    }
    {   /* Trailing bytes beyond the declared payload are also rejected. */
        frame_t f = make_frame(CMD_VERSION, CMD_SET_NAME, 1, 2, pay, 8, 1);
        CHECK(cmd_handle(c, f.bytes, f.len) == CMD_ERR_LENGTH);
        free(f.bytes);
    }
    CHECK(cmd_handle(c, tiny, 0) == CMD_ERR_LENGTH);
    CHECK(cmd_handle(c, tiny, sizeof tiny) == CMD_ERR_LENGTH);
    CHECK(c->last_counter == 0u && c->unlocked == 0u);
    free(c);
}

static void test_cfg_range(void)                        /* wraparound in offset + length */
{
    cmd_ctx_t *c = new_ctx();
    uint8_t pay[1 + 64];

    memset(pay, 0x5A, sizeof pay);
    pay[0] = 0;   CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 1, pay, 65, 1) == CMD_OK);        /* fills cfg exactly */
    pay[0] = 1;   CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 2, pay, 65, 1) == CMD_ERR_RANGE); /* one too many */
    pay[0] = 64;  CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 3, pay, 1, 1) == CMD_OK);         /* empty write at end */
    pay[0] = 64;  CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 4, pay, 2, 1) == CMD_ERR_RANGE);
    pay[0] = 250; CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 5, pay, 11, 1) == CMD_ERR_RANGE); /* 250 + 10 wraps in 8 bits */
    pay[0] = 255; CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 6, pay, 2, 1) == CMD_ERR_RANGE);
    CHECK(send(c, CMD_VERSION, CMD_WRITE_CFG, 7, pay, 0, 1) == CMD_ERR_RANGE);                /* len - 1 would underflow */
    free(c);
}

static void test_authentication(void)                   /* CWE-287, CWE-757, CWE-489 */
{
    cmd_ctx_t *c = new_ctx();

    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 1, NULL, 0, 0) == CMD_ERR_AUTH);    /* zero tag */
    for (size_t byte = 0; byte < CMD_HDR_LEN + CMD_TAG_LEN; byte++) {          /* any flipped bit */
        frame_t f = make_frame(CMD_VERSION, CMD_UNLOCK, 1, 0, NULL, 0, 1);
        cmd_status_t st;
        f.bytes[byte] ^= 0x01u;
        st = cmd_handle(c, f.bytes, f.len);
        CHECK(st != CMD_OK);
        free(f.bytes);
    }
    CHECK(send(c, 1, CMD_UNLOCK, 1, NULL, 0, 0) == CMD_ERR_VERSION);           /* downgrade, unsigned */
    CHECK(send(c, 1, CMD_UNLOCK, 1, NULL, 0, 1) == CMD_ERR_VERSION);           /* downgrade, signed */
    CHECK(send(c, 0, CMD_UNLOCK, 1, NULL, 0, 1) == CMD_ERR_VERSION);
    CHECK(send(c, 3, CMD_UNLOCK, 1, NULL, 0, 1) == CMD_ERR_VERSION);
    CHECK(send(c, CMD_VERSION, CMD_FACTORY, 1, NULL, 0, 0) != CMD_OK);         /* factory back door */
    CHECK(send(c, CMD_VERSION, CMD_FACTORY, 1, NULL, 0, 1) == CMD_ERR_COMMAND);
    CHECK(c->unlocked == 0u);
    free(c);
}

static void test_replay(void)                           /* CWE-294 */
{
    cmd_ctx_t *c = new_ctx();
    frame_t f = make_frame(CMD_VERSION, CMD_UNLOCK, 5, 0, NULL, 0, 1);

    CHECK(cmd_handle(c, f.bytes, f.len) == CMD_OK);
    c->unlocked = 0u;                                   /* the door closes again */
    CHECK(cmd_handle(c, f.bytes, f.len) == CMD_ERR_REPLAY);   /* same bytes, sent again */
    CHECK(c->unlocked == 0u);
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 4, NULL, 0, 1) == CMD_ERR_REPLAY);  /* older */
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 0, NULL, 0, 1) == CMD_ERR_REPLAY);
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 5, NULL, 0, 0) == CMD_ERR_AUTH);    /* forgery must not... */
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 900, NULL, 0, 0) == CMD_ERR_AUTH);
    CHECK(c->last_counter == 5u);                       /* ...move the counter */
    CHECK(send(c, CMD_VERSION, CMD_UNLOCK, 6, NULL, 0, 1) == CMD_OK);
    free(f.bytes);
    free(c);
}

int main(void)
{
    static const struct { const char *name; void (*fn)(void); } tests[] = {
        { "happy path", test_happy_path },       { "name bounds", test_name_bounds },
        { "frame length", test_frame_length },   { "cfg range", test_cfg_range },
        { "authentication", test_authentication }, { "replay", test_replay },
    };

    size_t count = sizeof tests / sizeof tests[0];

#ifdef HAPPY_ONLY
    count = 1;                                          /* `make happy`: what a demo-only test sees */
#endif
    for (size_t i = 0; i < count; i++) {
        printf("%s\n", tests[i].name);
        tests[i].fn();
    }
    printf(failures ? "%d check(s) FAILED\n" : "all checks passed\n", failures);
    return failures ? 1 : 0;
}
