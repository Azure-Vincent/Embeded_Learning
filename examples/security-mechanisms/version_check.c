#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

/* A one-time-programmable word used as a unary counter: the value is the
 * number of bits that have been programmed to 1. Bits can be set, never
 * cleared, so the counter can only go up. 32 bits give 32 steps. */
static uint32_t otp_word;   /* stands in for an eFuse / OTP word on the host */

static uint32_t otp_counter_read(void)
{
    uint32_t w = otp_word, n = 0;
    while (w) { n += w & 1u; w >>= 1; }
    return n;
}

/* Program bits until the counter equals 'target'. Refuses to go backwards
 * (that is physically impossible anyway) and refuses values that do not fit. */
static bool otp_counter_advance(uint32_t target)
{
    if (target > 32u) return false;
    if (target < otp_counter_read()) return false;
    uint32_t want = (target == 32u) ? 0xFFFFFFFFu : ((1u << target) - 1u);
    otp_word |= want;                 /* a write can only add 1 bits */
    return otp_counter_read() == target;
}

typedef enum { VER_ACCEPT, VER_REJECT_ROLLBACK, VER_REJECT_RANGE } ver_result_t;

/* Decide whether an already-authenticated image may be installed.
 * Call this only after the signature over the header (which contains
 * security_version) has been verified. */
static ver_result_t version_check(uint32_t security_version)
{
    if (security_version > 32u) return VER_REJECT_RANGE;
    if (security_version < otp_counter_read()) return VER_REJECT_ROLLBACK;
    return VER_ACCEPT;
}

/* Called by the new image itself once it has run its self-test. Only now
 * is the floor raised, so a bad update can still fall back to the old one. */
static bool version_commit(uint32_t security_version)
{
    if (version_check(security_version) != VER_ACCEPT) return false;
    return otp_counter_advance(security_version);
}

static int failures;
static void check(const char *name, bool ok)
{
    printf("%-44s %s\n", name, ok ? "ok" : "FAIL");
    if (!ok) failures++;
}

int main(void)
{
    check("fresh device counter is 0", otp_counter_read() == 0);
    check("v1 accepted on fresh device", version_check(1) == VER_ACCEPT);
    check("commit v3", version_commit(3) && otp_counter_read() == 3);
    check("v2 rejected as rollback", version_check(2) == VER_REJECT_ROLLBACK);
    check("v3 re-install accepted", version_check(3) == VER_ACCEPT);
    check("v4 accepted", version_check(4) == VER_ACCEPT);
    check("check alone does not move the counter", otp_counter_read() == 3);
    check("v33 rejected (cannot be recorded)", version_check(33) == VER_REJECT_RANGE);
    check("0xFFFFFFFF rejected (exhaustion attempt)", version_check(0xFFFFFFFFu) == VER_REJECT_RANGE);
    check("commit backwards refused", !version_commit(1) && otp_counter_read() == 3);
    check("commit v32 fills the word", version_commit(32) && otp_word == 0xFFFFFFFFu);
    check("v31 rejected at the end of life", version_check(31) == VER_REJECT_ROLLBACK);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
