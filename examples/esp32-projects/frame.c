/* frame.c - CRC, encoder and receive state machine. Pure C11. */
#include "frame.h"
#include <string.h>

/* CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no bit
 * reflection, no final XOR. Check value for "123456789" is 0x29B1.
 * Pass 0xFFFF as crc for the first call; pass the previous result to
 * continue over more data. */
uint16_t crc16_ccitt(uint16_t crc, const uint8_t *data, size_t len)
{
    for (size_t i = 0; i < len; i++) {
        crc ^= (uint16_t)((uint16_t)data[i] << 8);
        for (int b = 0; b < 8; b++) {
            if (crc & 0x8000u)
                crc = (uint16_t)((crc << 1) ^ 0x1021u);
            else
                crc = (uint16_t)(crc << 1);
        }
    }
    return crc;
}

/* Returns the number of bytes written to out, or 0 if it does not fit. */
size_t frame_encode(uint8_t type, const uint8_t *payload, uint8_t len,
                    uint8_t *out, size_t out_size)
{
    size_t total = (size_t)len + FRAME_OVERHEAD;
    if (len > FRAME_MAX_PAYLOAD || out_size < total) return 0;
    if (len > 0 && payload == NULL) return 0;

    out[0] = FRAME_SOF;
    out[1] = len;
    out[2] = type;
    if (len > 0) memcpy(&out[3], payload, len);
    uint16_t crc = crc16_ccitt(0xFFFFu, &out[1], (size_t)len + 2u);
    out[3 + len] = (uint8_t)(crc >> 8);
    out[4 + len] = (uint8_t)(crc & 0xFFu);
    return total;
}

void frame_parser_init(frame_parser_t *p)
{
    memset(p, 0, sizeof *p);
    p->state = FP_WAIT_SOF;
}

/* Call when the line has been silent for longer than a frame can pause.
 * A half-received frame is abandoned so the next SOF starts cleanly. */
void frame_parser_timeout(frame_parser_t *p)
{
    if (p->state != FP_WAIT_SOF) {
        p->n_timeout++;
        p->state = FP_WAIT_SOF;
    }
}

fp_result_t frame_parser_feed(frame_parser_t *p, uint8_t byte)
{
    switch (p->state) {
    case FP_WAIT_SOF:
        if (byte == FRAME_SOF) p->state = FP_LEN;
        return FP_NONE;                      /* anything else is noise */

    case FP_LEN:
        if (byte > FRAME_MAX_PAYLOAD) {      /* check BEFORE using it  */
            p->n_bad_len++;
            p->state = FP_WAIT_SOF;
            return FP_ERR_LEN;
        }
        p->len = byte;
        p->idx = 0;
        p->crc_calc = crc16_ccitt(0xFFFFu, &byte, 1);
        p->state = FP_TYPE;
        return FP_NONE;

    case FP_TYPE:
        p->type = byte;
        p->crc_calc = crc16_ccitt(p->crc_calc, &byte, 1);
        p->state = (p->len == 0) ? FP_CRC_HI : FP_PAYLOAD;
        return FP_NONE;

    case FP_PAYLOAD:
        p->payload[p->idx++] = byte;         /* idx < len <= MAX here  */
        p->crc_calc = crc16_ccitt(p->crc_calc, &byte, 1);
        if (p->idx == p->len) p->state = FP_CRC_HI;
        return FP_NONE;

    case FP_CRC_HI:
        p->crc_rx = (uint16_t)((uint16_t)byte << 8);
        p->state = FP_CRC_LO;
        return FP_NONE;

    case FP_CRC_LO:
        p->crc_rx |= byte;
        p->state = FP_WAIT_SOF;
        if (p->crc_rx == p->crc_calc) {
            p->n_ok++;
            return FP_FRAME;
        }
        p->n_bad_crc++;
        return FP_ERR_CRC;
    }
    p->state = FP_WAIT_SOF;                  /* corrupted state: recover */
    return FP_NONE;
}
