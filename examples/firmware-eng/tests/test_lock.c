#include "lock.h"
#include "test.h"

static lock_t lk;

static void test_starts_locked(void)
{
    lock_init(&lk);
    CHECK(lk.state == LOCK_LOCKED);
    CHECK(!lock_latch_open(&lk));
}

static void test_good_pin_unlocks_then_relocks_on_timeout(void)
{
    lock_init(&lk);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, 1000);
    CHECK(lk.state == LOCK_UNLOCKED);
    CHECK(lock_latch_open(&lk));
    lock_dispatch(&lk, LOCK_EV_TICK, 1000 + LOCK_UNLOCK_MS - 1);
    CHECK(lk.state == LOCK_UNLOCKED);            /* one millisecond early: still open */
    lock_dispatch(&lk, LOCK_EV_TICK, 1000 + LOCK_UNLOCK_MS);
    CHECK(lk.state == LOCK_LOCKED);
}

static void test_explicit_lock(void)
{
    lock_init(&lk);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, 0);
    lock_dispatch(&lk, LOCK_EV_LOCK, 10);
    CHECK(lk.state == LOCK_LOCKED);
}

static void test_three_bad_pins_cause_lockout(void)
{
    lock_init(&lk);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 1);
    CHECK(lk.state == LOCK_LOCKED);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 2);
    CHECK(lk.state == LOCK_LOCKOUT);
}

static void test_correct_pin_is_refused_during_lockout(void)
{
    lock_init(&lk);
    for (int i = 0; i < 3; i++) lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, 100);
    CHECK(lk.state == LOCK_LOCKOUT);
    lock_dispatch(&lk, LOCK_EV_TICK, LOCK_LOCKOUT_MS - 1);
    CHECK(lk.state == LOCK_LOCKOUT);
    lock_dispatch(&lk, LOCK_EV_TICK, LOCK_LOCKOUT_MS);
    CHECK(lk.state == LOCK_LOCKED);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, LOCK_LOCKOUT_MS + 1);
    CHECK(lk.state == LOCK_UNLOCKED);
}

static void test_good_pin_resets_bad_count(void)
{
    lock_init(&lk);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, 0);
    lock_dispatch(&lk, LOCK_EV_LOCK, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    lock_dispatch(&lk, LOCK_EV_PIN_BAD, 0);
    CHECK(lk.state == LOCK_LOCKED);              /* 2 + 2 bad attempts, never 3 in a row */
}

/* Regression: the relock timeout must survive the 32-bit millisecond counter wrapping. */
static void test_timeout_across_counter_wrap(void)
{
    uint32_t t = 0xFFFFF000u;                    /* 4096 ms before the wrap */
    lock_init(&lk);
    lock_dispatch(&lk, LOCK_EV_PIN_OK, t);
    lock_dispatch(&lk, LOCK_EV_TICK, t + 4000u); /* still before the wrap */
    CHECK(lk.state == LOCK_UNLOCKED);
    lock_dispatch(&lk, LOCK_EV_TICK, t + 4999u); /* after the wrap: now_ms is a small number */
    CHECK(lk.state == LOCK_UNLOCKED);
    lock_dispatch(&lk, LOCK_EV_TICK, t + 5000u);
    CHECK(lk.state == LOCK_LOCKED);
}

static void test_corrupt_state_recovers_locked(void)
{
    lock_init(&lk);
    lk.state = (lock_state_t)77;
    lock_dispatch(&lk, LOCK_EV_PIN_OK, 0);
    CHECK(lk.state == LOCK_LOCKED);
}

int main(void)
{
    RUN(test_starts_locked);
    RUN(test_good_pin_unlocks_then_relocks_on_timeout);
    RUN(test_explicit_lock);
    RUN(test_three_bad_pins_cause_lockout);
    RUN(test_correct_pin_is_refused_during_lockout);
    RUN(test_good_pin_resets_bad_count);
    RUN(test_timeout_across_counter_wrap);
    RUN(test_corrupt_state_recovers_locked);
    return TEST_REPORT("test_lock");
}
