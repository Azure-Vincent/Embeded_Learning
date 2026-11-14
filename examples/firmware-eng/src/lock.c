#include "lock.h"

/* Wrap-safe "has the deadline passed?". Works across the 49.7-day rollover of a
 * 32-bit millisecond counter as long as deadlines are less than 2^31 ms away. */
static bool time_reached(uint32_t now_ms, uint32_t deadline_ms)
{
    return (int32_t)(now_ms - deadline_ms) >= 0;
}

void lock_init(lock_t *lk)
{
    lk->state = LOCK_LOCKED;      /* fail secure: power-up state is locked */
    lk->bad_count = 0;
    lk->deadline_ms = 0;
}

void lock_dispatch(lock_t *lk, lock_event_t ev, uint32_t now_ms)
{
    switch (lk->state) {
    case LOCK_LOCKED:
        if (ev == LOCK_EV_PIN_OK) {
            lk->bad_count = 0;
            lk->deadline_ms = now_ms + LOCK_UNLOCK_MS;
            lk->state = LOCK_UNLOCKED;
        } else if (ev == LOCK_EV_PIN_BAD) {
            lk->bad_count++;
            if (lk->bad_count >= LOCK_MAX_BAD) {
                lk->deadline_ms = now_ms + LOCK_LOCKOUT_MS;
                lk->state = LOCK_LOCKOUT;
            }
        }
        break;

    case LOCK_UNLOCKED:
        if (ev == LOCK_EV_LOCK ||
            (ev == LOCK_EV_TICK && time_reached(now_ms, lk->deadline_ms))) {
            lk->state = LOCK_LOCKED;
        }
        break;                    /* PIN events are ignored while open */

    case LOCK_LOCKOUT:
        /* Every PIN event is ignored here, including a correct one. */
        if (ev == LOCK_EV_TICK && time_reached(now_ms, lk->deadline_ms)) {
            lk->bad_count = 0;
            lk->state = LOCK_LOCKED;
        }
        break;

    default:                      /* corrupted state variable: recover to the safe state */
        lock_init(lk);
        break;
    }
}

bool lock_latch_open(const lock_t *lk)
{
    return lk->state == LOCK_UNLOCKED;
}

const char *lock_state_name(lock_state_t s)
{
    switch (s) {
    case LOCK_LOCKED:   return "LOCKED";
    case LOCK_UNLOCKED: return "UNLOCKED";
    case LOCK_LOCKOUT:  return "LOCKOUT";
    }
    return "?";
}
