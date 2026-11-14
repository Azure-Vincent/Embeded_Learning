#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

/* Per-slot metadata kept in its own flash sector and written atomically
 * (write the new record, verify it, then retire the old one). */
typedef enum { SLOT_EMPTY, SLOT_NEW, SLOT_TRIAL, SLOT_CONFIRMED, SLOT_BAD } slot_state_t;

typedef struct {
    slot_state_t state;
    uint32_t     version;
    bool         signature_ok;   /* result of verifying this slot at this boot */
} slot_t;

#define NO_SLOT (-1)

static bool bootable(const slot_t *s)
{
    return s->signature_ok &&
           (s->state == SLOT_NEW || s->state == SLOT_TRIAL || s->state == SLOT_CONFIRMED);
}

/* Decide which slot to boot and update the trial bookkeeping.
 * NEW   -> becomes TRIAL and is booted once.
 * TRIAL -> seen again at boot means the image never confirmed itself
 *          (crash, hang, watchdog reset, power loss): mark it BAD.
 * Returns 0 or 1, or NO_SLOT when nothing can be booted (stay in the
 * bootloader's recovery mode instead of running unverified code). */
int slot_select(slot_t slots[2])
{
    for (int i = 0; i < 2; i++) {
        if (slots[i].state == SLOT_TRIAL) slots[i].state = SLOT_BAD;
        if (!slots[i].signature_ok && slots[i].state != SLOT_EMPTY) slots[i].state = SLOT_BAD;
    }
    int pick = NO_SLOT;
    for (int i = 0; i < 2; i++) {
        if (!bootable(&slots[i])) continue;
        if (pick == NO_SLOT || slots[i].version > slots[pick].version) pick = i;
    }
    if (pick != NO_SLOT && slots[pick].state == SLOT_NEW) slots[pick].state = SLOT_TRIAL;
    return pick;
}

/* Called by the application after its self-test passes. */
void slot_confirm(slot_t *s) { if (s->state == SLOT_TRIAL) s->state = SLOT_CONFIRMED; }

static int failures;
static void check(const char *name, bool ok)
{
    printf("%-50s %s\n", name, ok ? "ok" : "FAIL");
    if (!ok) failures++;
}

int main(void)
{
    slot_t s[2] = { { SLOT_CONFIRMED, 4, true }, { SLOT_NEW, 5, true } };

    check("new image is picked for a trial boot", slot_select(s) == 1 && s[1].state == SLOT_TRIAL);
    /* The new image hangs; the watchdog resets the device. */
    check("unconfirmed trial falls back to the old slot", slot_select(s) == 0 && s[1].state == SLOT_BAD);
    check("bad slot stays bad on later boots", slot_select(s) == 0);

    slot_t t[2] = { { SLOT_CONFIRMED, 4, true }, { SLOT_NEW, 5, true } };
    int b = slot_select(t);
    slot_confirm(&t[b]);
    check("confirmed image keeps booting", slot_select(t) == 1 && t[1].state == SLOT_CONFIRMED);

    slot_t u[2] = { { SLOT_CONFIRMED, 4, true }, { SLOT_NEW, 9, false } };
    check("bad signature is never booted", slot_select(u) == 0 && u[1].state == SLOT_BAD);

    slot_t v[2] = { { SLOT_EMPTY, 0, false }, { SLOT_NEW, 1, false } };
    check("nothing valid: stay in recovery", slot_select(v) == NO_SLOT);

    slot_t w[2] = { { SLOT_CONFIRMED, 4, false }, { SLOT_CONFIRMED, 3, true } };
    check("corrupted active slot: boot the other one", slot_select(w) == 1);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
