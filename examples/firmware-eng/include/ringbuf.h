/* ringbuf.h - byte FIFO for one producer and one consumer.
 *
 * The producer (typically a UART RX interrupt) is the only writer of `head`.
 * The consumer (typically the main loop) is the only writer of `tail`.
 * With that discipline no lock is needed on a single-core MCU.
 *
 * One slot is always left empty, so a buffer of `size` bytes holds size-1.
 * `size` must be a power of two so that wrapping is a mask, not a division.
 */
#ifndef RINGBUF_H
#define RINGBUF_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    uint8_t *buf;            /* storage supplied by the caller          */
    uint16_t mask;           /* size - 1                                */
    volatile uint16_t head;  /* next slot to write (producer only)      */
    volatile uint16_t tail;  /* next slot to read  (consumer only)      */
    volatile uint32_t dropped; /* bytes refused because the FIFO was full */
} ringbuf_t;

/* Returns false if size is not a power of two in 2..32768. */
bool   rb_init(ringbuf_t *rb, uint8_t *storage, uint16_t size);
bool   rb_put(ringbuf_t *rb, uint8_t byte);   /* producer side; false = full, byte dropped */
bool   rb_get(ringbuf_t *rb, uint8_t *byte);  /* consumer side; false = empty */
size_t rb_count(const ringbuf_t *rb);         /* bytes waiting */
size_t rb_free(const ringbuf_t *rb);          /* bytes that can still be put */

#endif
