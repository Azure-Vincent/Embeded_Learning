/* lock.h - door-lock controller as an explicit state machine.
 * Pure logic: no hardware access and no clock of its own. The caller passes events and
 * the current time, which is what makes it testable on a PC. */
#ifndef LOCK_H
#define LOCK_H

#include <stdbool.h>
#include <stdint.h>

#define LOCK_UNLOCK_MS   5000u   /* latch stays open this long, then relocks       */
#define LOCK_LOCKOUT_MS 30000u   /* PIN entry refused this long after too many bad */
#define LOCK_MAX_BAD        3u   /* consecutive wrong PINs before lockout          */

typedef enum { LOCK_LOCKED, LOCK_UNLOCKED, LOCK_LOCKOUT } lock_state_t;

typedef enum {
    LOCK_EV_PIN_OK,     /* a correct PIN was entered  */
    LOCK_EV_PIN_BAD,    /* a wrong PIN was entered    */
    LOCK_EV_LOCK,       /* explicit "lock now"        */
    LOCK_EV_TICK        /* time has passed; check deadlines */
} lock_event_t;

typedef struct {
    lock_state_t state;
    uint8_t bad_count;
    uint32_t deadline_ms;    /* meaning depends on state: relock time or end of lockout */
} lock_t;

void lock_init(lock_t *lk);
void lock_dispatch(lock_t *lk, lock_event_t ev, uint32_t now_ms);
bool lock_latch_open(const lock_t *lk);
const char *lock_state_name(lock_state_t s);

#endif
