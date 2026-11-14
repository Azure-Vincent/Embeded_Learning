/* frame.h - a small framed protocol for a UART link. No ESP-IDF includes:
 * this file and frame.c compile unchanged on a PC.
 *
 *   SOF   LEN   TYPE   PAYLOAD[LEN]   CRC_HI  CRC_LO
 *   0xA5  0..32  any    LEN bytes      CRC-16/CCITT-FALSE over LEN..PAYLOAD
 */
#ifndef FRAME_H
#define FRAME_H

#include <stddef.h>
#include <stdint.h>

#define FRAME_SOF          0xA5u
#define FRAME_MAX_PAYLOAD  32u
#define FRAME_OVERHEAD     5u     /* SOF + LEN + TYPE + 2 CRC bytes */

typedef enum {
    FP_WAIT_SOF, FP_LEN, FP_TYPE, FP_PAYLOAD, FP_CRC_HI, FP_CRC_LO
} fp_state_t;

typedef enum {
    FP_NONE,      /* byte consumed, no complete frame yet            */
    FP_FRAME,     /* a valid frame is in .type / .len / .payload     */
    FP_ERR_LEN,   /* LEN field larger than FRAME_MAX_PAYLOAD         */
    FP_ERR_CRC    /* frame arrived complete but the CRC did not match */
} fp_result_t;

typedef struct {
    fp_state_t state;
    uint8_t    len;
    uint8_t    type;
    uint8_t    idx;
    uint8_t    payload[FRAME_MAX_PAYLOAD];
    uint16_t   crc_calc;   /* running CRC of what has arrived   */
    uint16_t   crc_rx;     /* CRC taken from the wire           */
    uint32_t   n_ok, n_bad_crc, n_bad_len, n_timeout;
} frame_parser_t;

uint16_t    crc16_ccitt(uint16_t crc, const uint8_t *data, size_t len);
size_t      frame_encode(uint8_t type, const uint8_t *payload, uint8_t len,
                         uint8_t *out, size_t out_size);
void        frame_parser_init(frame_parser_t *p);
void        frame_parser_timeout(frame_parser_t *p);
fp_result_t frame_parser_feed(frame_parser_t *p, uint8_t byte);

#endif
