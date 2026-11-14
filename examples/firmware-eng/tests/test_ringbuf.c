#include "ringbuf.h"
#include "test.h"

static uint8_t storage[8];
static ringbuf_t rb;

static void test_init_rejects_bad_sizes(void)
{
    CHECK(!rb_init(&rb, storage, 0));
    CHECK(!rb_init(&rb, storage, 1));
    CHECK(!rb_init(&rb, storage, 6));        /* not a power of two */
    CHECK(!rb_init(NULL, storage, 8));
    CHECK(rb_init(&rb, storage, 8));
}

static void test_empty_after_init(void)
{
    uint8_t b = 0xEE;
    rb_init(&rb, storage, 8);
    CHECK(rb_count(&rb) == 0);
    CHECK(rb_free(&rb) == 7);                /* one slot is always kept empty */
    CHECK(!rb_get(&rb, &b));
    CHECK(b == 0xEE);                        /* a failed get must not touch the output */
}

static void test_fifo_order(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (uint8_t i = 1; i <= 5; i++) CHECK(rb_put(&rb, i));
    CHECK(rb_count(&rb) == 5);
    for (uint8_t i = 1; i <= 5; i++) { CHECK(rb_get(&rb, &b)); CHECK(b == i); }
    CHECK(rb_count(&rb) == 0);
}

static void test_full_drops_newest(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (uint8_t i = 0; i < 7; i++) CHECK(rb_put(&rb, i));
    CHECK(rb_free(&rb) == 0);
    CHECK(!rb_put(&rb, 99));                 /* eighth byte does not fit */
    CHECK(rb.dropped == 1);
    CHECK(rb_count(&rb) == 7);
    CHECK(rb_get(&rb, &b) && b == 0);        /* oldest data survived */
}

static void test_wraparound_many_times(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (int i = 0; i < 1000; i++) {         /* indices wrap 125 times */
        CHECK(rb_put(&rb, (uint8_t)i));
        CHECK(rb_put(&rb, (uint8_t)(i + 1)));
        CHECK(rb_get(&rb, &b) && b == (uint8_t)i);
        CHECK(rb_get(&rb, &b) && b == (uint8_t)(i + 1));
    }
    CHECK(rb_count(&rb) == 0);
    CHECK(rb.dropped == 0);
}

/* Regression: count must be right when head has wrapped and tail has not. */
static void test_count_when_head_behind_tail(void)
{
    uint8_t b;
    rb_init(&rb, storage, 8);
    for (int i = 0; i < 6; i++) rb_put(&rb, 1);
    for (int i = 0; i < 6; i++) rb_get(&rb, &b);     /* head = tail = 6 */
    for (int i = 0; i < 4; i++) rb_put(&rb, 2);      /* head wraps to 2 */
    CHECK(rb.head < rb.tail);
    CHECK(rb_count(&rb) == 4);
    CHECK(rb_free(&rb) == 3);
}

int main(void)
{
    RUN(test_init_rejects_bad_sizes);
    RUN(test_empty_after_init);
    RUN(test_fifo_order);
    RUN(test_full_drops_newest);
    RUN(test_wraparound_many_times);
    RUN(test_count_when_head_behind_tail);
    return TEST_REPORT("test_ringbuf");
}
