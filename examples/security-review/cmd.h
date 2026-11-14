/* cmd.h - command-frame handler for a fictional lock controller (teaching example).
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
