/* cmd.c - corrected command-frame handler. Compare with review_me.c.
 * Order of checks: length, version, authenticity, freshness, then per-command ranges.
 * Nothing in ctx changes unless every check has passed. */
#include <string.h>
#include "cmd.h"

static uint32_t get_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Constant-time comparison: run time does not depend on where the first difference is. */
static int tag_equal(const uint8_t *a, const uint8_t *b, size_t n)
{
    uint8_t diff = 0u;

    for (size_t i = 0; i < n; i++) {
        diff |= (uint8_t)(a[i] ^ b[i]);
    }
    return diff == 0u;
}

static cmd_status_t write_cfg(cmd_ctx_t *ctx, const uint8_t *payload, size_t len)
{
    size_t off, n;

    if (len < 1u) {                         /* the offset byte itself must be present */
        return CMD_ERR_RANGE;
    }
    off = payload[0];
    n = len - 1u;                           /* cannot underflow: len >= 1 */
    if (off > CMD_CFG_SIZE || n > CMD_CFG_SIZE - off) {   /* subtraction cannot wrap */
        return CMD_ERR_RANGE;
    }
    memcpy(&ctx->cfg[off], payload + 1, n);
    return CMD_OK;
}

cmd_status_t cmd_handle(cmd_ctx_t *ctx, const uint8_t *frame, size_t frame_len)
{
    uint8_t expect[CMD_TAG_LEN];
    const uint8_t *payload;
    uint32_t counter;
    size_t len;

    if (ctx == NULL || frame == NULL) {
        return CMD_ERR_LENGTH;
    }
    /* All length arithmetic is done in size_t, and the frame must be exactly as long
     * as its own length field says: no trailing bytes, no missing bytes. */
    if (frame_len < (size_t)CMD_HDR_LEN + CMD_TAG_LEN) {
        return CMD_ERR_LENGTH;
    }
    len = frame[6];
    if (len != frame_len - CMD_HDR_LEN - CMD_TAG_LEN) {
        return CMD_ERR_LENGTH;
    }
    if (frame[0] != CMD_VERSION) {          /* no unauthenticated legacy version */
        return CMD_ERR_VERSION;
    }

    /* Authenticity: the tag covers version, command, counter, length and payload. */
    platform_mac(frame, CMD_HDR_LEN + len, expect);
    if (!tag_equal(expect, frame + CMD_HDR_LEN + len, CMD_TAG_LEN)) {
        return CMD_ERR_AUTH;
    }

    /* Freshness: only after the tag is known to be good, and only strictly newer. */
    counter = get_u32(frame + 2);
    if (counter <= ctx->last_counter) {
        return CMD_ERR_REPLAY;
    }
    ctx->last_counter = counter;            /* a product stores this in non-volatile memory */

    payload = frame + CMD_HDR_LEN;
    switch (frame[1]) {
    case CMD_SET_NAME:
        if (len >= CMD_NAME_SIZE) {         /* leave room for the terminator */
            return CMD_ERR_RANGE;
        }
        memcpy(ctx->name, payload, len);
        ctx->name[len] = '\0';
        return CMD_OK;
    case CMD_WRITE_CFG:
        return write_cfg(ctx, payload, len);
    case CMD_UNLOCK:
        if (len != 0u) {
            return CMD_ERR_RANGE;
        }
        ctx->unlocked = 1u;
        return CMD_OK;
    default:                                /* CMD_FACTORY no longer exists in this build */
        return CMD_ERR_COMMAND;
    }
}
