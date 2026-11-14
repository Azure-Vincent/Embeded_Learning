// Generated from examples/security-review/ (cmd.h, review_me.c). Regenerate if those files change.
export const CMD_H = String.raw`/* cmd.h - command-frame handler for a fictional lock controller (teaching example).
 *
 * Frame layout (all on one UART or radio link):
 *   [0]      version   (CMD_VERSION)
 *   [1]      command
 *   [2..5]   counter, little-endian, must increase with every frame
 *   [6]      payload length n
 *   [7..]    payload, n bytes
 *   [7+n..]  tag, CMD_TAG_LEN bytes: MAC over bytes [0 .. 7+n)
 */
#ifndef CMD_H
#define CMD_H

#include <stddef.h>
#include <stdint.h>

#define CMD_VERSION   2u
#define CMD_HDR_LEN   7u
#define CMD_TAG_LEN   8u
#define CMD_NAME_SIZE 16u
#define CMD_CFG_SIZE  64u

enum { CMD_SET_NAME = 0x01, CMD_WRITE_CFG = 0x02, CMD_UNLOCK = 0x03, CMD_FACTORY = 0xFE };

typedef enum {
    CMD_OK = 0, CMD_ERR_LENGTH, CMD_ERR_VERSION, CMD_ERR_AUTH, CMD_ERR_REPLAY, CMD_ERR_COMMAND, CMD_ERR_RANGE
} cmd_status_t;

typedef struct {
    char     name[CMD_NAME_SIZE];   /* NUL-terminated device name */
    uint8_t  unlocked;              /* sits directly after name[] on purpose */
    uint8_t  cfg[CMD_CFG_SIZE];
    uint32_t last_counter;          /* highest counter accepted so far */
} cmd_ctx_t;

/* Provided by the platform (HMAC or CMAC truncated to CMD_TAG_LEN on a product).
 * The host tests link a stand-in that is NOT cryptographically secure. */
void platform_mac(const uint8_t *msg, size_t len, uint8_t tag[CMD_TAG_LEN]);

cmd_status_t cmd_handle(cmd_ctx_t *ctx, const uint8_t *frame, size_t frame_len);

#endif
`;
export const REVIEW_ME = String.raw`/* review_me.c - the module under review. It compiles without warnings and passes a
 * "happy path" test, and it contains several seeded security defects.
 * Do not ship or copy this file; cmd.c is the corrected version. */
#include <string.h>
#include "cmd.h"

static uint32_t get_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static int tag_ok(const uint8_t *frame, uint8_t len)
{
    uint8_t expect[CMD_TAG_LEN];

    platform_mac(frame, (size_t)CMD_HDR_LEN + len, expect);
    return memcmp(expect, frame + CMD_HDR_LEN + len, CMD_TAG_LEN) == 0;
}

static cmd_status_t write_cfg(cmd_ctx_t *ctx, const uint8_t *payload, uint8_t len)
{
    uint8_t off = payload[0];
    uint8_t n = (uint8_t)(len - 1u);
    uint8_t end = (uint8_t)(off + n);

    if (end > CMD_CFG_SIZE) {
        return CMD_ERR_RANGE;
    }
    memcpy(&ctx->cfg[off], payload + 1, n);
    return CMD_OK;
}

cmd_status_t cmd_handle(cmd_ctx_t *ctx, const uint8_t *frame, size_t frame_len)
{
    int authed = 1;
    uint8_t version, cmd, len, need;
    uint32_t counter;
    const uint8_t *payload;

    if (frame_len < CMD_HDR_LEN) {
        return CMD_ERR_LENGTH;
    }
    version = frame[0];
    cmd = frame[1];
    counter = get_u32(frame + 2);
    len = frame[6];
    payload = frame + CMD_HDR_LEN;

    need = (uint8_t)(CMD_HDR_LEN + len + CMD_TAG_LEN);
    if (need > frame_len) {
        return CMD_ERR_LENGTH;
    }

    /* Version 1 units in the field cannot compute tags; keep them working. */
    if (version >= 2u && !tag_ok(frame, len)) {
        authed = 0;
    }
    if (cmd == CMD_FACTORY) {
        authed = 1;                 /* production line fixture has no key */
    }
    if (!authed) {
        return CMD_ERR_AUTH;
    }
    ctx->last_counter = counter;

    switch (cmd) {
    case CMD_SET_NAME:
        memcpy(ctx->name, payload, len);
        ctx->name[len] = '\0';
        return CMD_OK;
    case CMD_WRITE_CFG:
        return write_cfg(ctx, payload, len);
    case CMD_UNLOCK:
    case CMD_FACTORY:
        ctx->unlocked = 1u;
        return CMD_OK;
    default:
        return CMD_ERR_COMMAND;
    }
}
`;
