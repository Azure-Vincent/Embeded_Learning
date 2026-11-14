// C sources used by the eCTF preparation lessons and scenarios.
// Every program here was compiled with gcc -Wall -Wextra -std=c11, run on a host, and run in js/sim/cinterp.js.
// The *_START variants are deliberately flawed starting points for c-lab exercises.

export const FRESH_SOL = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

static uint32_t last_seen;   /* highest counter accepted so far; persistent on a real device */

/* tag_ok is the result of verifying the message's authentication tag over
   (counter || payload). The verification itself happens before this call. */
bool accept(uint32_t counter, bool tag_ok) {
    if (!tag_ok) return false;              /* an unauthenticated message changes nothing */
    if (counter <= last_seen) return false; /* equal or older: a repeat */
    last_seen = counter;                    /* state moves only on full acceptance */
    return true;
}

int main(void) {
    uint32_t ctr[8] = { 1, 1, 2, 900, 3, 2, 0xFFFFFFFFu, 0 };
    bool     ok[8]  = { true, true, true, false, true, true, true, true };
    for (int i = 0; i < 8; i++) printf("%d", accept(ctr[i], ok[i]) ? 1 : 0);
    printf("\n");
    return 0;
}
`;

export const FRESH_START = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

static uint32_t last_seen;   /* highest counter accepted so far; persistent on a real device */

/* tag_ok is the result of verifying the message's authentication tag over
   (counter || payload). The verification itself happens before this call. */
bool accept(uint32_t counter, bool tag_ok) {
    if (counter < last_seen) return false;
    last_seen = counter;
    return tag_ok;
}

int main(void) {
    uint32_t ctr[8] = { 1, 1, 2, 900, 3, 2, 0xFFFFFFFFu, 0 };
    bool     ok[8]  = { true, true, true, false, true, true, true, true };
    for (int i = 0; i < 8; i++) printf("%d", accept(ctr[i], ok[i]) ? 1 : 0);
    printf("\n");
    return 0;
}
`;

export const LIMITER_SOL = String.raw`#include <stdint.h>
#include <stdio.h>

#define PIN_LEN   6
#define MAX_FAILS 3

static const uint8_t stored_pin[PIN_LEN] = { '4', '0', '7', '7', '1', '9' };
static uint32_t nv_fails;   /* stands for a counter kept in flash: it survives a reset */
static int power_cut;       /* test bench: 1 = power is lost at POWER_POINT */
#define POWER_POINT() if (power_cut) return -1

/* Compare without an early exit: the time taken does not depend on where the first difference is. */
static int ct_equal(const uint8_t *a, const uint8_t *b, int n) {
    uint8_t diff = 0;
    for (int i = 0; i < n; i++) diff |= (uint8_t)(a[i] ^ b[i]);
    return diff == 0;
}

/* Returns 1 = released, 0 = refused, -1 = power lost part-way. */
int try_unlock(const uint8_t *pin) {
    if (nv_fails >= MAX_FAILS) return 0;   /* locked out: fail closed */
    nv_fails++;                            /* charge the attempt before looking at the guess */
    POWER_POINT();
    if (!ct_equal(pin, stored_pin, PIN_LEN)) return 0;
    nv_fails = 0;                          /* refund only after a proven success */
    return 1;
}

int main(void) {
    const uint8_t good[PIN_LEN] = { '4', '0', '7', '7', '1', '9' };
    const uint8_t bad[PIN_LEN]  = { '4', '0', '7', '7', '1', '8' };

    /* Run 1: an honest user mistypes twice, then gets it right, twice over. */
    int a = try_unlock(bad) + try_unlock(bad) + try_unlock(good);
    int b = try_unlock(bad) + try_unlock(bad) + try_unlock(good);
    printf("honest: %d %d fails=%u\n", a, b, (unsigned)nv_fails);

    /* Run 2: ten wrong guesses, each followed by loss of power before the
       function finishes. Then one correct guess with power held. */
    power_cut = 1;
    for (int i = 0; i < 10; i++) try_unlock(bad);
    power_cut = 0;
    printf("after power cuts: %d fails=%u\n", try_unlock(good), (unsigned)nv_fails);
    return 0;
}
`;

export const LIMITER_START = String.raw`#include <stdint.h>
#include <stdio.h>

#define PIN_LEN   6
#define MAX_FAILS 3

static const uint8_t stored_pin[PIN_LEN] = { '4', '0', '7', '7', '1', '9' };
static uint32_t nv_fails;   /* stands for a counter kept in flash: it survives a reset */
static int power_cut;       /* test bench: 1 = power is lost at POWER_POINT */
#define POWER_POINT() if (power_cut) return -1

/* Compare without an early exit: the time taken does not depend on where the first difference is. */
static int ct_equal(const uint8_t *a, const uint8_t *b, int n) {
    uint8_t diff = 0;
    for (int i = 0; i < n; i++) diff |= (uint8_t)(a[i] ^ b[i]);
    return diff == 0;
}

/* Returns 1 = released, 0 = refused, -1 = power lost part-way. */
int try_unlock(const uint8_t *pin) {
    if (nv_fails >= MAX_FAILS) return 0;
    int ok = ct_equal(pin, stored_pin, PIN_LEN);
    POWER_POINT();
    if (!ok) { nv_fails++; return 0; }
    nv_fails = 0;
    return 1;
}

int main(void) {
    const uint8_t good[PIN_LEN] = { '4', '0', '7', '7', '1', '9' };
    const uint8_t bad[PIN_LEN]  = { '4', '0', '7', '7', '1', '8' };

    /* Run 1: an honest user mistypes twice, then gets it right, twice over. */
    int a = try_unlock(bad) + try_unlock(bad) + try_unlock(good);
    int b = try_unlock(bad) + try_unlock(bad) + try_unlock(good);
    printf("honest: %d %d fails=%u\n", a, b, (unsigned)nv_fails);

    /* Run 2: ten wrong guesses, each followed by loss of power before the
       function finishes. Then one correct guess with power held. */
    power_cut = 1;
    for (int i = 0; i < 10; i++) try_unlock(bad);
    power_cut = 0;
    printf("after power cuts: %d fails=%u\n", try_unlock(good), (unsigned)nv_fails);
    return 0;
}
`;

export const UPDATE_SOL = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define SLOT_SIZE 0x8000u    /* room for one image in this example */

enum { UPD_OK = 0, UPD_BAD_SIG = 1, UPD_WRONG_DEVICE = 2, UPD_ROLLBACK = 3, UPD_BAD_LEN = 4 };

struct upd_header {          /* every field here is covered by the signature */
    uint32_t device_id;      /* which device this image was built for */
    uint32_t version;        /* monotonically increasing release number */
    uint32_t length;         /* image length in bytes */
    uint32_t flags;          /* bit 0 was "force install" in the reference design */
};

/* sig_ok: result of verifying the signature over header || image with the
   public key held in the bootloader. Nothing in the header is believed before it. */
int update_decision(const struct upd_header *h, bool sig_ok,
                    uint32_t my_id, uint32_t min_version) {
    if (!sig_ok) return UPD_BAD_SIG;
    if (h->device_id != my_id) return UPD_WRONG_DEVICE;
    if (h->version <= min_version) return UPD_ROLLBACK;   /* no flag overrides this */
    if (h->length == 0 || h->length > SLOT_SIZE) return UPD_BAD_LEN;
    return UPD_OK;
}

int main(void) {
    struct upd_header h[7] = {
        { 0x1001, 8, 0x4000, 0 },      /* good */
        { 0x1001, 8, 0x4000, 0 },      /* good header, signature does not verify */
        { 0x1002, 8, 0x4000, 0 },      /* signed for another device */
        { 0x1001, 7, 0x4000, 0 },      /* same version as installed */
        { 0x1001, 3, 0x4000, 1 },      /* old version with the force flag set */
        { 0x1001, 9, 0x9000, 0 },      /* longer than the slot */
        { 0x1001, 9, 0,      0 },      /* empty */
    };
    bool sig[7] = { true, false, true, true, true, true, true };
    for (int i = 0; i < 7; i++) printf("%d", update_decision(&h[i], sig[i], 0x1001, 7));
    printf("\n");
    return 0;
}
`;

export const UPDATE_START = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define SLOT_SIZE 0x8000u    /* room for one image in this example */

enum { UPD_OK = 0, UPD_BAD_SIG = 1, UPD_WRONG_DEVICE = 2, UPD_ROLLBACK = 3, UPD_BAD_LEN = 4 };

struct upd_header {          /* every field here is covered by the signature */
    uint32_t device_id;      /* which device this image was built for */
    uint32_t version;        /* monotonically increasing release number */
    uint32_t length;         /* image length in bytes */
    uint32_t flags;          /* bit 0 was "force install" in the reference design */
};

/* sig_ok: result of verifying the signature over header || image with the
   public key held in the bootloader. Nothing in the header is believed before it. */
int update_decision(const struct upd_header *h, bool sig_ok,
                    uint32_t my_id, uint32_t min_version) {
    (void)my_id;
    if ((h->flags & 1u) == 0 && h->version < min_version) return UPD_ROLLBACK;
    if (!sig_ok) return UPD_BAD_SIG;
    return UPD_OK;
}

int main(void) {
    struct upd_header h[7] = {
        { 0x1001, 8, 0x4000, 0 },      /* good */
        { 0x1001, 8, 0x4000, 0 },      /* good header, signature does not verify */
        { 0x1002, 8, 0x4000, 0 },      /* signed for another device */
        { 0x1001, 7, 0x4000, 0 },      /* same version as installed */
        { 0x1001, 3, 0x4000, 1 },      /* old version with the force flag set */
        { 0x1001, 9, 0x9000, 0 },      /* longer than the slot */
        { 0x1001, 9, 0,      0 },      /* empty */
    };
    bool sig[7] = { true, false, true, true, true, true, true };
    for (int i = 0; i < 7; i++) printf("%d", update_decision(&h[i], sig[i], 0x1001, 7));
    printf("\n");
    return 0;
}
`;

export const KEYPOL_SOL = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define SLOTS 4

/* What a key may be used for. Fixed when the key is created. */
#define USE_ENCRYPT 0x01u
#define USE_DECRYPT 0x02u
#define USE_SIGN    0x04u
#define USE_WRAP    0x08u   /* may encrypt other keys for export */
#define ATTR_EXPORTABLE 0x80u   /* may leave the device, and then only wrapped */

enum { OP_ENCRYPT, OP_DECRYPT, OP_SIGN, OP_EXPORT_WRAPPED, OP_EXPORT_PLAIN };
enum { R_OK = 0, R_NO_SLOT = 1, R_NOT_AUTH = 2, R_DENIED = 3 };

struct slot { bool used; uint8_t attrs; };
static struct slot slots[SLOTS] = {
    { true,  USE_ENCRYPT | USE_DECRYPT },                 /* 0: data key */
    { true,  USE_SIGN },                                  /* 1: signing key */
    { true,  USE_WRAP },                                  /* 2: wrapping key */
    { true,  USE_ENCRYPT | USE_DECRYPT | ATTR_EXPORTABLE } /* 3: exportable data key */
};

/* Decide whether an operation is allowed. No key byte is touched here:
   the decision is made first, and the default answer is "no". */
int authorise(int op, int slot, int wrap_slot, bool authed) {
    if (slot < 0 || slot >= SLOTS || !slots[slot].used) return R_NO_SLOT;
    if (!authed) return R_NOT_AUTH;
    uint8_t a = slots[slot].attrs;
    switch (op) {
    case OP_ENCRYPT: return (a & USE_ENCRYPT) ? R_OK : R_DENIED;
    case OP_DECRYPT: return (a & USE_DECRYPT) ? R_OK : R_DENIED;
    case OP_SIGN:    return (a & USE_SIGN)    ? R_OK : R_DENIED;
    case OP_EXPORT_WRAPPED:
        if (!(a & ATTR_EXPORTABLE)) return R_DENIED;
        if (wrap_slot < 0 || wrap_slot >= SLOTS || !slots[wrap_slot].used) return R_NO_SLOT;
        if (wrap_slot == slot) return R_DENIED;
        return (slots[wrap_slot].attrs & USE_WRAP) ? R_OK : R_DENIED;
    default:
        return R_DENIED;                 /* includes OP_EXPORT_PLAIN: there is no such path */
    }
}

int main(void) {
    printf("%d", authorise(OP_ENCRYPT, 0, -1, true));          /* 0 allowed */
    printf("%d", authorise(OP_ENCRYPT, 0, -1, false));         /* 2 not authenticated */
    printf("%d", authorise(OP_SIGN, 0, -1, true));             /* 3 data key cannot sign */
    printf("%d", authorise(OP_DECRYPT, 2, -1, true));          /* 3 wrapping key cannot decrypt data */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 2, true));    /* 0 exportable, under a wrapping key */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 1, 2, true));    /* 3 signing key is not exportable */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 0, true));    /* 3 slot 0 is not a wrapping key */
    printf("%d", authorise(OP_EXPORT_PLAIN, 3, -1, true));     /* 3 never */
    printf("%d", authorise(OP_ENCRYPT, 7, -1, true));          /* 1 no such slot */
    printf("%d", authorise(OP_ENCRYPT, -1, -1, true));         /* 1 negative index */
    printf("\n");
    return 0;
}
`;

export const KEYPOL_START = String.raw`#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

#define SLOTS 4

/* What a key may be used for. Fixed when the key is created. */
#define USE_ENCRYPT 0x01u
#define USE_DECRYPT 0x02u
#define USE_SIGN    0x04u
#define USE_WRAP    0x08u   /* may encrypt other keys for export */
#define ATTR_EXPORTABLE 0x80u   /* may leave the device, and then only wrapped */

enum { OP_ENCRYPT, OP_DECRYPT, OP_SIGN, OP_EXPORT_WRAPPED, OP_EXPORT_PLAIN };
enum { R_OK = 0, R_NO_SLOT = 1, R_NOT_AUTH = 2, R_DENIED = 3 };

struct slot { bool used; uint8_t attrs; };
static struct slot slots[SLOTS] = {
    { true,  USE_ENCRYPT | USE_DECRYPT },                 /* 0: data key */
    { true,  USE_SIGN },                                  /* 1: signing key */
    { true,  USE_WRAP },                                  /* 2: wrapping key */
    { true,  USE_ENCRYPT | USE_DECRYPT | ATTR_EXPORTABLE } /* 3: exportable data key */
};

/* Decide whether an operation is allowed. */
int authorise(int op, int slot, int wrap_slot, bool authed) {
    if (slot >= SLOTS) return R_NO_SLOT;
    if (op == OP_EXPORT_PLAIN) return R_OK;      /* "for factory test" */
    if (!authed) return R_NOT_AUTH;
    (void)wrap_slot;
    return R_OK;
}

int main(void) {
    printf("%d", authorise(OP_ENCRYPT, 0, -1, true));          /* 0 allowed */
    printf("%d", authorise(OP_ENCRYPT, 0, -1, false));         /* 2 not authenticated */
    printf("%d", authorise(OP_SIGN, 0, -1, true));             /* 3 data key cannot sign */
    printf("%d", authorise(OP_DECRYPT, 2, -1, true));          /* 3 wrapping key cannot decrypt data */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 2, true));    /* 0 exportable, under a wrapping key */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 1, 2, true));    /* 3 signing key is not exportable */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 0, true));    /* 3 slot 0 is not a wrapping key */
    printf("%d", authorise(OP_EXPORT_PLAIN, 3, -1, true));     /* 3 never */
    printf("%d", authorise(OP_ENCRYPT, 7, -1, true));          /* 1 no such slot */
    printf("%d", authorise(OP_ENCRYPT, -1, -1, true));         /* 1 negative index */
    printf("\n");
    return 0;
}
`;

export const FRAME_C = String.raw`#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

/* Wire format:  src(1) dst(1) counter(4, little-endian) len(1) payload(len) tag(16)
   src, dst, counter and len are authenticated as associated data; payload is encrypted. */
#define HDR_LEN     7
#define TAG_LEN     16
#define MAX_PAYLOAD 64

struct frame {
    uint8_t  src, dst, len;
    uint32_t counter;
    const uint8_t *payload;   /* points into the receive buffer */
    const uint8_t *tag;
};

/* Returns 0 and fills *f only if the buffer holds exactly one well-formed frame. */
int parse_frame(const uint8_t *buf, size_t n, struct frame *f) {
    if (n < HDR_LEN + TAG_LEN) return -1;            /* too short to hold a header and a tag */
    uint8_t len = buf[6];
    if (len > MAX_PAYLOAD) return -1;                /* bound the field before using it */
    if (n != (size_t)HDR_LEN + len + TAG_LEN) return -1;   /* received size must agree with the field */
    f->src = buf[0];
    f->dst = buf[1];
    f->counter = (uint32_t)buf[2] | ((uint32_t)buf[3] << 8) |
                 ((uint32_t)buf[4] << 16) | ((uint32_t)buf[5] << 24);
    f->len = len;
    f->payload = buf + HDR_LEN;
    f->tag = buf + HDR_LEN + len;
    return 0;
}

/* The 12-byte AEAD nonce is built from values both ends already know, so it
   never repeats under one key as long as (sender, counter) never repeats. */
void build_nonce(uint8_t nonce[12], uint8_t src, uint8_t dst, uint32_t counter) {
    memset(nonce, 0, 12);
    nonce[0] = src;
    nonce[1] = dst;
    nonce[8]  = (uint8_t)(counter);
    nonce[9]  = (uint8_t)(counter >> 8);
    nonce[10] = (uint8_t)(counter >> 16);
    nonce[11] = (uint8_t)(counter >> 24);
}

int main(void) {
    uint8_t buf[HDR_LEN + MAX_PAYLOAD + TAG_LEN + 8] = { 2, 1, 0x2A, 0, 0, 0, 4, 'd', 'a', 't', 'a' };
    struct frame f;
    printf("exact      %d\n", parse_frame(buf, HDR_LEN + 4 + TAG_LEN, &f));
    printf("counter    %u\n", (unsigned)f.counter);
    printf("truncated  %d\n", parse_frame(buf, HDR_LEN + 4 + TAG_LEN - 1, &f));
    printf("trailing   %d\n", parse_frame(buf, HDR_LEN + 4 + TAG_LEN + 1, &f));
    buf[6] = 200;                                    /* length field larger than any payload */
    printf("len=200    %d\n", parse_frame(buf, sizeof buf, &f));
    printf("tiny       %d\n", parse_frame(buf, 3, &f));
    uint8_t n1[12], n2[12];
    build_nonce(n1, 2, 1, 42);
    build_nonce(n2, 1, 2, 42);                       /* same counter, opposite direction */
    printf("nonces differ by direction: %d\n", memcmp(n1, n2, 12) != 0);
    return 0;
}
`;
