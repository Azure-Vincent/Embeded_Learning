#include "ringbuf.h"

bool rb_init(ringbuf_t *rb, uint8_t *storage, uint16_t size)
{
    if (rb == NULL || storage == NULL) return false;
    if (size < 2 || (size & (size - 1u)) != 0) return false;   /* power of two only */
    rb->buf = storage;
    rb->mask = (uint16_t)(size - 1u);
    rb->head = 0;
    rb->tail = 0;
    rb->dropped = 0;
    return true;
}

bool rb_put(ringbuf_t *rb, uint8_t byte)
{
    uint16_t head = rb->head;
    uint16_t next = (uint16_t)((head + 1u) & rb->mask);
    if (next == rb->tail) {          /* advancing would make head == tail, which means "empty" */
        rb->dropped++;
        return false;                /* overflow policy: drop the newest byte, keep the old ones */
    }
    rb->buf[head] = byte;            /* store first ...                                   */
    rb->head = next;                 /* ... publish second: the consumer never sees a slot
                                        that has not been written yet                     */
    return true;
}

bool rb_get(ringbuf_t *rb, uint8_t *byte)
{
    uint16_t tail = rb->tail;
    if (tail == rb->head) return false;          /* empty */
    *byte = rb->buf[tail];
    rb->tail = (uint16_t)((tail + 1u) & rb->mask);
    return true;
}

size_t rb_count(const ringbuf_t *rb)
{
    return (size_t)((rb->head - rb->tail) & rb->mask);
}

size_t rb_free(const ringbuf_t *rb)
{
    return (size_t)rb->mask - rb_count(rb);
}
