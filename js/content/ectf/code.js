// C sources used by the eCTF preparation lessons and scenarios.
// Every program here was compiled with gcc -Wall -Wextra -std=c11 and run on a host. The *_SOL / *_START
// pairs also run in js/sim/cinterp.js; the *_START variants are deliberately flawed starting points for c-labs.
// The *_REF programs are the scenarios' insecure reference designs with their test harnesses: host C only
// (also built and run with -fsanitize=address,undefined); their recorded output is in the *_REF_OUT strings.

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
    struct upd_header h[8] = {
        { 0x1001, 8, 0x4000, 0 },      /* good */
        { 0x1001, 8, 0x4000, 0 },      /* good header, signature does not verify */
        { 0x1002, 8, 0x4000, 0 },      /* signed for another device */
        { 0x1001, 7, 0x4000, 0 },      /* same version as installed */
        { 0x1001, 3, 0x4000, 1 },      /* old version with the force flag set */
        { 0x1001, 9, 0x9000, 0 },      /* longer than the slot */
        { 0x1001, 9, 0,      0 },      /* empty */
        { 0x1002, 3, 0x9000, 1 },      /* everything wrong, and the signature does not verify */
    };
    bool sig[8] = { true, false, true, true, true, true, true, false };
    for (int i = 0; i < 8; i++) printf("%d", update_decision(&h[i], sig[i], 0x1001, 7));
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
    struct upd_header h[8] = {
        { 0x1001, 8, 0x4000, 0 },      /* good */
        { 0x1001, 8, 0x4000, 0 },      /* good header, signature does not verify */
        { 0x1002, 8, 0x4000, 0 },      /* signed for another device */
        { 0x1001, 7, 0x4000, 0 },      /* same version as installed */
        { 0x1001, 3, 0x4000, 1 },      /* old version with the force flag set */
        { 0x1001, 9, 0x9000, 0 },      /* longer than the slot */
        { 0x1001, 9, 0,      0 },      /* empty */
        { 0x1002, 3, 0x9000, 1 },      /* everything wrong, and the signature does not verify */
    };
    bool sig[8] = { true, false, true, true, true, true, true, false };
    for (int i = 0; i < 8; i++) printf("%d", update_decision(&h[i], sig[i], 0x1001, 7));
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
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 9, true));    /* 1 no such wrapping slot */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, -1, true));   /* 1 negative wrapping slot */
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
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, 9, true));    /* 1 no such wrapping slot */
    printf("%d", authorise(OP_EXPORT_WRAPPED, 3, -1, true));   /* 1 negative wrapping slot */
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

export const STRONGBOX_REF = String.raw`/* strongbox_ref.c: Scenario 1, insecure reference design and test harness.
   A course exercise; not competition material.
   Build:  gcc -Wall -Wextra -std=c11 -o strongbox_ref strongbox_ref.c */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ===================== DEVICE: replace this part with your design ===================== */
#define PIN_LEN   6
#define MAX_FAILS 3

static const char    PIN[] = "407719";                               /* F1: build parameters,  */
static const uint8_t SECRET[] = { 0xC0, 0xFF, 0xEE, 0x15, 0x90, 0x0D }; /* in clear in the image */

/* The device's RAM, modelled as one object so that the reference design's write past the
   line buffer behaves identically on every host. A reset clears it. */
static struct { char line[16]; uint8_t unlocked; uint8_t fails; } ram;

/* Flash model: survives dev_reset(). The reference design never uses it. */
static uint8_t nv[64];

unsigned long dev_work;   /* bytes compared so far: a deterministic stand-in for response time */

void dev_factory(void) { memset(nv, 0xFF, sizeof nv); memset(&ram, 0, sizeof ram); dev_work = 0; }
void dev_reset(void)   { memset(&ram, 0, sizeof ram); }

static void hex(char *out, size_t cap, const char *prefix, const uint8_t *p, size_t n) {
    size_t at = (size_t)snprintf(out, cap, "%s", prefix);
    for (size_t i = 0; i < n && at + 3 <= cap; i++) at += (size_t)snprintf(out + at, cap - at, "%02x", p[i]);
}

/* One received line in, one response line out (no newline). */
void dev_line(const char *in, char *out, size_t cap) {
    unsigned char *mem = (unsigned char *)&ram;
    size_t i = 0;
    while (in[i] != '\0' && in[i] != '\n') {      /* nothing compares i with sizeof ram.line */
        if (i < sizeof ram) mem[i] = (unsigned char)in[i];   /* the model ends where RAM ends */
        i++;
    }
    if (i < sizeof ram.line) ram.line[i] = '\0';

    if (memcmp(ram.line, "status", 7) == 0) {
        snprintf(out, cap, "%s %d", ram.unlocked ? "unlocked" : "locked", MAX_FAILS - ram.fails);
    } else if (memcmp(ram.line, "unlock ", 7) == 0) {
        const char *guess = ram.line + 7;
        size_t n = 0;
        while (7 + n < sizeof ram.line && guess[n] != '\0') n++;
        if (ram.fails >= MAX_FAILS) { snprintf(out, cap, "denied"); return; }
        if (n != PIN_LEN) { snprintf(out, cap, "bad length"); return; }
        for (int k = 0; k < PIN_LEN; k++) {
            dev_work++;
            if (guess[k] != PIN[k]) { ram.fails++; snprintf(out, cap, "denied"); return; }
        }
        ram.fails = 0;
        ram.unlocked = 1;
        snprintf(out, cap, "ok");
    } else if (memcmp(ram.line, "read", 5) == 0) {
        if (ram.unlocked) hex(out, cap, "secret ", SECRET, sizeof SECRET);
        else snprintf(out, cap, "denied");
    } else if (memcmp(ram.line, "lock", 5) == 0) {
        ram.unlocked = 0;
        snprintf(out, cap, "ok");
    } else if (memcmp(ram.line, "dump", 5) == 0) {           /* left in from development */
        size_t at = (size_t)snprintf(out, cap, "pin %s ", PIN);
        hex(out + at, cap - at, "secret ", SECRET, sizeof SECRET);
    } else {
        snprintf(out, cap, "error");
    }
}

/* ===================== HARNESS: keep, and extend with your own tests ===================== */
static int failed;
static char resp[160];
static const char *cmd(const char *line) { dev_line(line, resp, sizeof resp); return resp; }
static int is(const char *line, const char *want) { return strcmp(cmd(line), want) == 0; }
static void check(const char *id, int ok, const char *what) {
    printf("%-7s %s  %s\n", id, ok ? "PASS" : "FAIL", what);
    failed += !ok;
}

int main(void) {
    char a[160], b[160], c[160], d[160];
    unsigned long w1, w2;
    int ok;

    dev_factory();
    check("T-F3", is("status", "locked 3"), "status reports state and attempts remaining");
    dev_factory();
    ok = is("unlock 407719", "ok") && is("read", "secret c0ffee15900d") && is("lock", "ok") && is("read", "denied");
    check("T-F4", ok, "unlock, read, lock, read");

    dev_factory();
    check("T-S1-1", is("read", "denied"), "read while locked is refused");
    dev_factory();
    cmd("unlock 407719"); dev_reset();
    check("T-S1-2", is("read", "denied"), "a reset locks the device");

    dev_factory();
    cmd("unlock 000000"); cmd("unlock 000001"); cmd("unlock 000002");
    check("T-S2-1", is("unlock 407719", "denied") && is("status", "locked 0"), "fourth guess refused even when correct");
    dev_factory();
    cmd("unlock 000000"); cmd("unlock 000001"); dev_reset();
    cmd("unlock 000002"); cmd("unlock 000003");
    check("T-S2-2", is("unlock 407719", "denied"), "a reset does not restore guesses");

    dev_factory(); strcpy(a, cmd("unlock 12345"));
    dev_factory(); strcpy(b, cmd("unlock 1234567"));
    dev_factory(); strcpy(c, cmd("unlock 507719"));
    dev_factory(); strcpy(d, cmd("unlock 407710"));
    check("T-S4-1", !strcmp(a, b) && !strcmp(b, c) && !strcmp(c, d), "every wrong guess gets the same response");
    dev_factory(); cmd("unlock 507719"); w1 = dev_work;
    dev_factory(); cmd("unlock 407710"); w2 = dev_work;
    check("T-S4-2", w1 == w2 && w1 > 0, "comparison work does not depend on where the guess is wrong");

    dev_factory();
    ok = is("dump", "error") && is("help", "error") && is("debug", "error") && is("status", "locked 3");
    check("T-S5-1", ok, "commands outside F2 answer error and change nothing");

    dev_factory();
    ok = is("AAAAAAAAAAAAAAA", "error")                                    /* 15: longest legal line */
      && is("AAAAAAAAAAAAAAAA", "error")                                   /* 16 */
      && is("AAAAAAAAAAAAAAAAA", "error")                                  /* 17 */
      && is("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "error")           /* 40 */
      && is("status", "locked 3") && is("read", "denied");
    check("T-S6-1", ok, "over-long lines change neither lock state nor attempts");

    printf("%d check(s) failed\n", failed);
    return failed != 0;
}
`;

export const STRONGBOX_REF_OUT = String.raw`T-F3    PASS  status reports state and attempts remaining
T-F4    PASS  unlock, read, lock, read
T-S1-1  PASS  read while locked is refused
T-S1-2  PASS  a reset locks the device
T-S2-1  PASS  fourth guess refused even when correct
T-S2-2  FAIL  a reset does not restore guesses
T-S4-1  FAIL  every wrong guess gets the same response
T-S4-2  FAIL  comparison work does not depend on where the guess is wrong
T-S5-1  FAIL  commands outside F2 answer error and change nothing
T-S6-1  FAIL  over-long lines change neither lock state nor attempts
5 check(s) failed
`;

export const GATEKEEPER_REF = String.raw`/* gatekeeper_ref.c: Scenario 2, insecure reference design and test harness.
   A course exercise; not competition material.
   Build:  gcc -Wall -Wextra -std=c11 -o gatekeeper_ref gatekeeper_ref.c */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ===================== DEVICES: replace this part with your design ===================== */
#define MAX_PERM 8
#define OPEN_LEN (16 + 4 * MAX_PERM)     /* reference OPEN message: code(16) perm[8] (u32 LE each) */
enum { NONE = 0, GRANT = 1, DENY = 2 };

/* The same constant is compiled into every reader and credential of every deployment. */
static const uint8_t OPEN_CODE[16] = { 0x6f, 0x70, 0x65, 0x6e, 0x2d, 0x73, 0x65, 0x73,
                                       0x61, 0x6d, 0x65, 0x2d, 0x32, 0x30, 0x32, 0x34 };

struct reader { uint32_t id; uint8_t rx[OPEN_LEN]; size_t have; int decision; };
struct cred   { uint32_t id; uint32_t perm[MAX_PERM]; uint8_t tx[OPEN_LEN]; size_t tx_len; };

static void put32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }
static uint32_t get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

/* Provisioning model: what the secrets step and the per-device builds put into each device.
   The reference design ignores the deployment number. */
void provision_reader(struct reader *r, int deployment, uint32_t id) {
    (void)deployment;
    memset(r, 0, sizeof *r);
    r->id = id;
}
void provision_cred(struct cred *c, int deployment, uint32_t id, const uint32_t *readers, int n) {
    (void)deployment;
    memset(c, 0, sizeof *c);
    c->id = id;
    for (int i = 0; i < n && i < MAX_PERM; i++) c->perm[i] = readers[i];
}

/* Credential: the button was pressed. */
void cred_press(struct cred *c) {
    memcpy(c->tx, OPEN_CODE, 16);
    for (int i = 0; i < MAX_PERM; i++) put32(c->tx + 16 + 4 * i, c->perm[i]);   /* its own rights */
    c->tx_len = OPEN_LEN;
}
/* Credential: bytes to send (returns the count and empties the queue); bytes received. */
size_t cred_tx(struct cred *c, uint8_t *out, size_t cap) {
    size_t n = c->tx_len <= cap ? c->tx_len : 0;
    memcpy(out, c->tx, n);
    c->tx_len = 0;
    return n;
}
void cred_rx(struct cred *c, const uint8_t *p, size_t n) { (void)c; (void)p; (void)n; }

/* Reader: bytes received at time now_ms; bytes to send; decision since the last call. */
void reader_rx(struct reader *r, const uint8_t *p, size_t n, uint32_t now_ms) {
    (void)now_ms;                                        /* no timeout */
    for (size_t i = 0; i < n; i++) {
        r->rx[r->have++] = p[i];
        if (r->have < OPEN_LEN) continue;
        r->have = 0;
        r->decision = DENY;
        if (memcmp(r->rx, OPEN_CODE, 16) != 0) continue; /* early-exit comparison */
        for (int k = 0; k < MAX_PERM; k++)
            if (get32(r->rx + 16 + 4 * k) == r->id) r->decision = GRANT;
    }
}
size_t reader_tx(struct reader *r, uint8_t *out, size_t cap) { (void)r; (void)out; (void)cap; return 0; }
int reader_take_decision(struct reader *r) { int d = r->decision; r->decision = NONE; return d; }

/* ===================== HARNESS: keep, and extend with your own tests ===================== */
static int failed;
static uint32_t now_ms;
static void check(const char *id, int ok, const char *what) {
    printf("%-7s %s  %s\n", id, ok ? "PASS" : "FAIL", what);
    failed += !ok;
}

/* Carries bytes both ways until both sides are quiet. Everything the credential sent is
   appended to rec (if not NULL), as an observer of the link would record it. */
static int exchange(struct cred *c, struct reader *r, uint8_t *rec, size_t *rec_len) {
    uint8_t buf[256];
    cred_press(c);
    for (int round = 0; round < 8; round++) {
        size_t n = cred_tx(c, buf, sizeof buf);
        if (n && rec) { memcpy(rec + *rec_len, buf, n); *rec_len += n; }
        if (n) reader_rx(r, buf, n, now_ms);
        size_t m = reader_tx(r, buf, sizeof buf);
        if (m) cred_rx(c, buf, m);
        if (!n && !m) break;
        now_ms += 5;
    }
    return reader_take_decision(r);
}

int main(void) {
    const uint32_t A = 0x0000A001, B = 0x0000B002, only_a[] = { 0x0000A001 }, both[] = { 0x0000A001, 0x0000B002 };
    struct reader ra, rb;
    struct cred c1, c2;
    uint8_t rec[1024];
    size_t rec_len;
    int d;

    provision_reader(&ra, 1, A); provision_cred(&c1, 1, 0x101, only_a, 1);
    check("T-F3", exchange(&c1, &ra, NULL, NULL) == GRANT, "permitted credential is granted");
    check("T-F3b", exchange(&c1, &ra, NULL, NULL) == GRANT, "and again on the next press");

    provision_reader(&ra, 1, A); provision_cred(&c2, 2, 0x101, only_a, 1);
    check("T-S1-1", exchange(&c2, &ra, NULL, NULL) != GRANT, "credential built for another deployment is denied");

    provision_reader(&ra, 1, A); provision_cred(&c1, 1, 0x101, only_a, 1);
    rec_len = 0; exchange(&c1, &ra, rec, &rec_len);
    now_ms += 60000;
    reader_rx(&ra, rec, rec_len, now_ms);
    check("T-S2-1", reader_take_decision(&ra) != GRANT, "recorded credential bytes replayed later are not granted");

    provision_reader(&rb, 1, B); provision_cred(&c1, 1, 0x101, only_a, 1);
    check("T-S3-1", exchange(&c1, &rb, NULL, NULL) != GRANT, "credential without permission for this reader is denied");

    /* Format-specific: rewrite for your message format, or delete once no permission field exists. */
    provision_reader(&rb, 1, B); provision_cred(&c1, 1, 0x101, only_a, 1);
    rec_len = 0; cred_press(&c1); rec_len = cred_tx(&c1, rec, sizeof rec);
    if (rec_len >= 24) put32(rec + 20, B);               /* the holder edits its own permission list */
    reader_rx(&rb, rec, rec_len, now_ms);
    check("T-S3-2", reader_take_decision(&rb) != GRANT, "holder cannot extend its permissions");

    /* Format-specific: point this at wherever your design keeps a credential's secret material. */
    provision_cred(&c1, 1, 0x101, only_a, 1); provision_cred(&c2, 1, 0x102, only_a, 1);
    cred_press(&c1); cred_press(&c2);
    check("T-S4-2", memcmp(c1.tx, c2.tx, 16) != 0, "two credentials share no secret");

    provision_reader(&ra, 1, A); provision_reader(&rb, 1, B); provision_cred(&c1, 1, 0x101, both, 2);
    rec_len = 0; exchange(&c1, &ra, rec, &rec_len);
    reader_rx(&rb, rec, rec_len, now_ms);
    check("T-S5-1", reader_take_decision(&rb) != GRANT, "bytes recorded at reader A do not open reader B");

    provision_reader(&ra, 1, A); provision_cred(&c1, 1, 0x101, only_a, 1);
    rec_len = 0; exchange(&c1, &ra, rec, &rec_len);      /* a good exchange, to have real bytes */
    reader_rx(&ra, rec, 10, now_ms);                     /* then only the first 10 bytes arrive */
    now_ms += 5000;                                      /* and the link goes quiet for 5 s */
    d = reader_take_decision(&ra);
    check("T-S6-1", d != GRANT && exchange(&c1, &ra, NULL, NULL) == GRANT, "a partial message is discarded; the next exchange works");

    printf("%d check(s) failed\n", failed);
    return failed != 0;
}
`;

export const GATEKEEPER_REF_OUT = String.raw`T-F3    PASS  permitted credential is granted
T-F3b   PASS  and again on the next press
T-S1-1  FAIL  credential built for another deployment is denied
T-S2-1  FAIL  recorded credential bytes replayed later are not granted
T-S3-1  PASS  credential without permission for this reader is denied
T-S3-2  FAIL  holder cannot extend its permissions
T-S4-2  FAIL  two credentials share no secret
T-S5-1  FAIL  bytes recorded at reader A do not open reader B
T-S6-1  FAIL  a partial message is discarded; the next exchange works
6 check(s) failed
`;

export const RELAY_REF = String.raw`/* relay_ref.c: Scenario 3, insecure reference update path and test harness.
   A course exercise on a generic flash model; not competition material and not any real chip.
   Build:  gcc -Wall -Wextra -std=c11 -o relay_ref relay_ref.c */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ===================== DEVICE: replace this part with your design ===================== */
#define SLOT_SIZE  (128u * 1024u)                 /* F6 */
#define HDR_LEN    20u     /* reference header: "RLY1" version length flags crc32, u32 little-endian */
#define REC_OFF    SLOT_SIZE                      /* boot record directly after the application */
#define FLASH_SIZE (SLOT_SIZE + 16u)
enum { UPD_OK = 0, UPD_REFUSED = 1 };

static uint8_t flash[FLASH_SIZE];
long flash_budget = -1;    /* test bench: flash operations left before power is lost; -1 = unlimited */

static int powered(void) { if (flash_budget == 0) return 0; if (flash_budget > 0) flash_budget--; return 1; }
static void flash_erase(uint32_t off, uint32_t n) { if (powered()) memset(flash + off, 0xFF, n); }
static void flash_write(uint32_t off, uint8_t b)  { if (off < FLASH_SIZE && powered()) flash[off] = b; }

static uint32_t get32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static void put32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }
static uint32_t crc32(const uint8_t *p, size_t n) {
    uint32_t c = 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320u & (0u - (c & 1u)));
    }
    return ~c;
}
static void write_record(uint32_t version, uint32_t length) {
    uint8_t r[8];
    put32(r, version); put32(r + 4, length);
    for (uint32_t i = 0; i < 8; i++) flash_write(REC_OFF + i, r[i]);
}

/* Factory installation of the first image. */
void dev_factory(uint32_t version, const uint8_t *img, uint32_t len) {
    flash_budget = -1;
    memset(flash, 0xFF, sizeof flash);
    memcpy(flash, img, len);
    write_record(version, len);
}

/* A complete update file has arrived on the serial port. */
int dev_update(const uint8_t *file, size_t n) {
    if (n < HDR_LEN || memcmp(file, "RLY1", 4) != 0) return UPD_REFUSED;
    uint32_t version = get32(file + 4), length = get32(file + 8), flags = get32(file + 12), crc = get32(file + 16);
    uint32_t running = get32(flash + REC_OFF);
    if ((flags & 1u) == 0 && version < running) return UPD_REFUSED;     /* "force" skips this */
    flash_erase(0, SLOT_SIZE);                                          /* the running image is gone */
    for (uint32_t i = 0; i < length; i++)                               /* length is believed */
        flash_write(i, HDR_LEN + i < n ? file[HDR_LEN + i] : 0xFF);     /* a silent serial line reads 0xFF */
    if (length > SLOT_SIZE || crc32(flash, length) != crc) return UPD_REFUSED;
    write_record(version, length);
    return UPD_OK;
}

/* Reset: returns the version of the image that starts, or 0 if the device stays in the loader. */
uint32_t dev_boot(void) {
    uint32_t version = get32(flash + REC_OFF);
    return version == 0xFFFFFFFFu ? 0 : version;        /* nothing examines the image at boot */
}
/* Test access to the bytes of the image that would boot. */
uint8_t *dev_test_active_image(void) { return flash; }

/* Packaging tool for the reference format. Needs no key: anyone can produce such a file. */
size_t pkg_make(uint8_t *out, uint32_t version, const uint8_t *img, uint32_t len, uint32_t flags) {
    memcpy(out, "RLY1", 4);
    put32(out + 4, version); put32(out + 8, len); put32(out + 12, flags); put32(out + 16, crc32(img, len));
    memcpy(out + HDR_LEN, img, len);
    return HDR_LEN + len;
}

/* ===================== HARNESS: keep, and extend with your own tests ===================== */
static int failed;
static void check(const char *id, int ok, const char *what) {
    printf("%-7s %s  %s\n", id, ok ? "PASS" : "FAIL", what);
    failed += !ok;
}
static uint8_t img[SLOT_SIZE], want[SLOT_SIZE], file[SLOT_SIZE + 256];
static void fill(uint8_t *p, uint8_t seed, uint32_t len) { for (uint32_t i = 0; i < len; i++) p[i] = (uint8_t)(seed + i * 7u); }
static void fresh_v2(void) { fill(img, 2, 4096); dev_factory(2, img, 4096); }
/* True if a reset starts this version AND the bytes that would execute are that complete image. */
static int runs(uint32_t version, uint8_t seed, uint32_t len) {
    fill(want, seed, len);
    return dev_boot() == version && memcmp(dev_test_active_image(), want, len) == 0;
}
#define RUNS_V2 runs(2, 2, 4096)

int main(void) {
    size_t n;

    fresh_v2(); fill(img, 3, 5000); n = pkg_make(file, 3, img, 5000, 0);
    check("T-F3", dev_update(file, n) == UPD_OK && runs(3, 3, 5000), "install version 3; version 3 runs");
    fresh_v2(); fill(img, 3, SLOT_SIZE); n = pkg_make(file, 3, img, SLOT_SIZE, 0);
    check("T-F6", dev_update(file, n) == UPD_OK && runs(3, 3, SLOT_SIZE), "image of exactly the slot size installs");

    fresh_v2(); fill(img, 3, 5000); n = pkg_make(file, 3, img, 5000, 0);
    flash_budget = 1000; dev_update(file, n); flash_budget = -1;
    check("T-F4", RUNS_V2 || runs(3, 3, 5000), "power lost during the transfer: a complete image still runs");

    fresh_v2(); fill(img, 3, 5000); n = pkg_make(file, 3, img, 5000, 0);
    file[HDR_LEN + 100] ^= 0x01;
    check("T-S1-1", dev_update(file, n) != UPD_OK && RUNS_V2, "altered image refused; version 2 still runs");
    fresh_v2(); fill(img, 9, 5000); n = pkg_make(file, 3, img, 5000, 0);
    /* Reference format: pkg_make needs no key. In your design, build this file WITHOUT the release key. */
    check("T-S1-4", dev_update(file, n) != UPD_OK && RUNS_V2, "file made without the release key is refused");

    fresh_v2(); fill(img, 1, 5000); n = pkg_make(file, 1, img, 5000, 0);
    check("T-S2-1", dev_update(file, n) != UPD_OK && RUNS_V2, "older version refused");
    fresh_v2(); fill(img, 7, 5000); n = pkg_make(file, 2, img, 5000, 0);
    check("T-S2-2", dev_update(file, n) != UPD_OK && RUNS_V2, "same version number refused");
    fresh_v2(); fill(img, 1, 5000); n = pkg_make(file, 1, img, 5000, 1);
    check("T-S2-4", dev_update(file, n) != UPD_OK && RUNS_V2, "older version with the force flag refused");

    fresh_v2(); fill(img, 3, 5000); n = pkg_make(file, 3, img, 5000, 0); dev_update(file, n);
    dev_test_active_image()[100] ^= 0x01;                /* flash changes after installation */
    check("T-S5-1", dev_boot() != 3, "image altered after installation does not start");

    fresh_v2(); fill(img, 3, 64); n = pkg_make(file, 3, img, 64, 0);
    put32(file + 8, SLOT_SIZE + 1);                      /* header claims one byte more than the slot */
    check("T-S6-1", dev_update(file, n) != UPD_OK && RUNS_V2, "length = slot size + 1 refused before any write");
    fresh_v2(); fill(img, 3, 64); n = pkg_make(file, 3, img, 64, 0);
    put32(file + 8, 0);
    check("T-S6-1b", dev_update(file, n) != UPD_OK && RUNS_V2, "length = 0 refused before any write");
    fresh_v2();
    check("T-S6-2", dev_update(file, 7) != UPD_OK && RUNS_V2, "truncated file refused, nothing changed");

    /* To add once your design has keys: T-S1-3 (signed with another key), T-S3-1 (other deployment),
       T-S4-1 (search the device image for private keys), T-S4-2 (handshake with a borrowed identity).
       Also add length = 0xFFFFFFFF to T-S6-1 (the reference design takes seconds to chew through it). */
    printf("%d check(s) failed\n", failed);
    return failed != 0;
}
`;

export const RELAY_REF_OUT = String.raw`T-F3    PASS  install version 3; version 3 runs
T-F6    PASS  image of exactly the slot size installs
T-F4    FAIL  power lost during the transfer: a complete image still runs
T-S1-1  FAIL  altered image refused; version 2 still runs
T-S1-4  FAIL  file made without the release key is refused
T-S2-1  PASS  older version refused
T-S2-2  FAIL  same version number refused
T-S2-4  FAIL  older version with the force flag refused
T-S5-1  FAIL  image altered after installation does not start
T-S6-1  FAIL  length = slot size + 1 refused before any write
T-S6-1b FAIL  length = 0 refused before any write
T-S6-2  PASS  truncated file refused, nothing changed
8 check(s) failed
`;

export const FIELDBUS_REF = String.raw`/* fieldbus_ref.c: Scenario 4, insecure reference bus protocol and test harness.
   A course exercise; not competition material.
   Build:  gcc -Wall -Wextra -std=c11 -o fieldbus_ref fieldbus_ref.c */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ===================== DEVICES: replace this part with your design ===================== */
#define MAX_PAYLOAD 64
#define BUS_MAX     300           /* the harness always hands over a buffer of this size */
#define LOG_SLOTS   32
/* Reference frame:  src(1) dst(1) len(1) payload(len) crc8(1)   (CRC-8, polynomial 0x07) */

struct node {                     /* a sensor (id 1, 2) or the actuator (id 3) */
    uint8_t id;
    /* RAM model: the receive buffer and the variables the linker placed after it. */
    struct { uint8_t rx[MAX_PAYLOAD]; uint8_t actions; uint8_t last_cmd; } ram;
    uint8_t reading[MAX_PAYLOAD]; uint8_t reading_len;      /* what a sensor would report */
};
struct ctrl {
    uint8_t last[4][MAX_PAYLOAD]; uint8_t last_len[4];      /* newest reading per node */
    uint8_t flash[LOG_SLOTS][1 + 1 + MAX_PAYLOAD];          /* log model: node, len, reading */
    unsigned log_next;
};

static uint8_t crc8(const uint8_t *p, size_t n) {
    uint8_t c = 0;
    for (size_t i = 0; i < n; i++) {
        c ^= p[i];
        for (int k = 0; k < 8; k++) c = (uint8_t)((c & 0x80) ? (c << 1) ^ 0x07 : c << 1);
    }
    return c;
}
static size_t build(uint8_t *out, uint8_t src, uint8_t dst, const uint8_t *payload, uint8_t len) {
    out[0] = src; out[1] = dst; out[2] = len;
    memcpy(out + 3, payload, len);
    out[3 + len] = crc8(out, 3u + len);
    return 4u + len;
}

/* Provisioning model. The reference design ignores the deployment number: it has no keys. */
void node_init(struct node *nd, int deployment, uint8_t id) { (void)deployment; memset(nd, 0, sizeof *nd); nd->id = id; }
void ctrl_init(struct ctrl *c, int deployment) { (void)deployment; memset(c, 0, sizeof *c); }

/* Controller: build a poll request (F2) or an actuator command (F3). Returns the frame length. */
size_t ctrl_poll(struct ctrl *c, uint8_t node, uint8_t *out) { (void)c; return build(out, 0, node, (const uint8_t *)"R", 1); }
size_t ctrl_command(struct ctrl *c, uint8_t node, const uint8_t *cmd, uint8_t len, uint8_t *out) { (void)c; return build(out, 0, node, cmd, len); }

/* Node: one frame received. Returns the reply length (0 = frame dropped, no reply). */
size_t node_rx(struct node *nd, const uint8_t *f, size_t n, uint8_t *reply) {
    uint8_t *mem = (uint8_t *)&nd->ram;
    if (n < 4 || f[1] != nd->id) return 0;
    uint8_t len = f[2];
    for (size_t i = 0; i < len; i++)                    /* the length field is believed */
        if (i < sizeof nd->ram) mem[i] = f[3 + i];      /* (the model ends where this RAM ends) */
    if (crc8(f, 3u + len) != f[3 + len]) return 0;      /* checked after the copy */
    if (nd->id == 3) {                                  /* actuator: act, then acknowledge */
        nd->ram.actions++;
        nd->ram.last_cmd = nd->ram.rx[0];
        return build(reply, nd->id, f[0], (const uint8_t *)"A", 1);
    }
    return build(reply, nd->id, f[0], nd->reading, nd->reading_len);   /* sensor: report */
}

/* Controller: one frame received. Returns 1 if it was accepted as a reply, 0 if dropped. */
int ctrl_rx(struct ctrl *c, const uint8_t *f, size_t n) {
    if (n < 4 || f[1] != 0 || f[2] > MAX_PAYLOAD || n != 4u + f[2]) return 0;
    if (crc8(f, 3u + f[2]) != f[3 + f[2]]) return 0;
    uint8_t src = f[0] & 3u;
    memcpy(c->last[src], f + 3, f[2]); c->last_len[src] = f[2];
    if (src != 3) {                                     /* F5: readings go to the log, in clear */
        uint8_t *rec = c->flash[c->log_next++ % LOG_SLOTS];
        rec[0] = src; rec[1] = f[2]; memcpy(rec + 2, f + 3, f[2]);
    }
    return 1;
}
/* Controller: read log record i back (after login, on the device). Returns length, or -1 if the
   record is empty or fails its integrity check. */
int ctrl_log_read(struct ctrl *c, unsigned i, uint8_t *out) {
    const uint8_t *rec = c->flash[i % LOG_SLOTS];
    if (rec[1] == 0 || rec[1] > MAX_PAYLOAD) return -1;
    memcpy(out, rec + 2, rec[1]);
    return rec[1];
}

/* ===================== HARNESS: keep, and extend with your own tests ===================== */
static int failed;
static void check(const char *id, int ok, const char *what) {
    printf("%-7s %s  %s\n", id, ok ? "PASS" : "FAIL", what);
    failed += !ok;
}
/* Everything a party WITHOUT any key can recompute after editing a frame. For the reference
   design that is the CRC-8. In your design it must be nothing: leave the body empty. */
static void fixup(uint8_t *f) { f[3 + f[2]] = crc8(f, 3u + f[2]); }

static int contains(const uint8_t *hay, size_t n, const uint8_t *needle, size_t m) {
    for (size_t i = 0; i + m <= n; i++) if (memcmp(hay + i, needle, m) == 0) return 1;
    return 0;
}

static struct ctrl c;
static struct node s1, s2, act, foreign;
static const uint8_t READING[] = "21.5C;humidity=40";
static void setup(void) {
    ctrl_init(&c, 1); node_init(&s1, 1, 1); node_init(&s2, 1, 2); node_init(&act, 1, 3);
    node_init(&foreign, 2, 1);
    memcpy(s1.reading, READING, sizeof READING - 1); s1.reading_len = sizeof READING - 1;
    memcpy(foreign.reading, "99.9C", 5); foreign.reading_len = 5;
}

int main(void) {
    uint8_t req[BUS_MAX], rsp[BUS_MAX], rsp2[BUS_MAX], out[MAX_PAYLOAD];
    size_t n, m, m2;
    int ok;

    setup(); memset(req, 0, sizeof req); memset(rsp, 0, sizeof rsp);
    n = ctrl_poll(&c, 1, req); m = node_rx(&s1, req, n, rsp);
    ok = m > 0 && ctrl_rx(&c, rsp, m) && c.last_len[1] == sizeof READING - 1 && !memcmp(c.last[1], READING, sizeof READING - 1);
    check("T-F2", ok, "poll: the controller obtains the sensor's reading");
    check("T-F5", ctrl_log_read(&c, 0, out) == (int)(sizeof READING - 1) && !memcmp(out, READING, sizeof READING - 1), "the reading can be read back from the log");
    check("T-S2-1", !contains(rsp, m, READING, 4), "the reading is not visible in the frame on the bus");
    check("T-S4-1", !contains((const uint8_t *)c.flash, sizeof c.flash, READING, 4), "the reading is not visible in the controller's flash");
    c.flash[0][5] ^= 0x01;                               /* someone alters one stored byte */
    check("T-S4-2", ctrl_log_read(&c, 0, out) == -1, "an altered log record is reported invalid");
    memset(req, 0, sizeof req); memset(rsp2, 0, sizeof rsp2);
    n = ctrl_poll(&c, 1, req); m2 = node_rx(&s1, req, n, rsp2);
    check("T-S2-1b", m2 > 0 && (m != m2 || memcmp(rsp, rsp2, m) != 0), "the same reading sent twice gives different frames");

    setup(); memset(req, 0, sizeof req);
    n = ctrl_command(&c, 3, (const uint8_t *)"\x10open", 5, req); m = node_rx(&act, req, n, rsp);
    check("T-F3", m > 0 && act.ram.actions == 1 && ctrl_rx(&c, rsp, m), "command: the actuator acts once and acknowledges");
    node_rx(&act, req, n, rsp);
    check("T-S3-1", act.ram.actions == 1, "the same command frame delivered twice acts once");

    setup(); memset(req, 0, sizeof req);
    n = ctrl_command(&c, 3, (const uint8_t *)"\x10open", 5, req);
    req[3] ^= 0x01; fixup(req);
    node_rx(&act, req, n, rsp);
    check("T-S1-1", act.ram.actions == 0, "a modified command is dropped");
    setup(); memset(req, 0, sizeof req);
    n = ctrl_poll(&c, 1, req); m = node_rx(&foreign, req, n, rsp);
    check("T-S1-2", m == 0 || !ctrl_rx(&c, rsp, m), "a node built for another deployment is not believed");

    setup(); memset(req, 0, sizeof req);
    n = ctrl_poll(&c, 1, req);
    req[1] = 2; fixup(req);                              /* re-address node 1's request to node 2 */
    check("T-S3-2", node_rx(&s2, req, n, rsp) == 0, "a re-addressed frame is dropped");
    setup(); memset(req, 0, sizeof req);
    n = ctrl_poll(&c, 1, req);
    req[0] = 1; req[1] = 0; fixup(req);                  /* the controller's own request, turned round */
    check("T-S3-3", !ctrl_rx(&c, req, n), "the controller's own frame is not accepted as a reply");

    setup(); memset(req, 0, sizeof req);
    req[0] = 0; req[1] = 3; req[2] = 66; memset(req + 3, 0x01, 66);    /* len = 66 > 64, bad check value */
    m = node_rx(&act, req, 4 + 66, rsp);
    check("T-S6-1", m == 0 && act.ram.actions == 0 && act.ram.last_cmd == 0, "over-long frame dropped; nothing outside the buffer changed");

    /* To add: T-S3-4 (out of order), T-S4-3 (old record substituted), T-S5 (key separation),
       T-S6-2 (a million random frames under sanitizers), and resets of each device. */
    printf("%d check(s) failed\n", failed);
    return failed != 0;
}
`;

export const FIELDBUS_REF_OUT = String.raw`T-F2    PASS  poll: the controller obtains the sensor's reading
T-F5    PASS  the reading can be read back from the log
T-S2-1  FAIL  the reading is not visible in the frame on the bus
T-S4-1  FAIL  the reading is not visible in the controller's flash
T-S4-2  FAIL  an altered log record is reported invalid
T-S2-1b FAIL  the same reading sent twice gives different frames
T-F3    PASS  command: the actuator acts once and acknowledges
T-S3-1  FAIL  the same command frame delivered twice acts once
T-S1-1  FAIL  a modified command is dropped
T-S1-2  FAIL  a node built for another deployment is not believed
T-S3-2  FAIL  a re-addressed frame is dropped
T-S3-3  FAIL  the controller's own frame is not accepted as a reply
T-S6-1  FAIL  over-long frame dropped; nothing outside the buffer changed
10 check(s) failed
`;

export const KEYKEEPER_REF = String.raw`/* keykeeper_ref.c: Scenario 5, insecure reference design (symmetric subset) and test harness.
   A course exercise; not competition material. Covers login, logout, generate, list, encrypt,
   decrypt, export and destroy for 256-bit symmetric keys. sign and import need a real library
   and are left to your design.
   Build:  gcc -Wall -Wextra -std=c11 -o keykeeper_ref keykeeper_ref.c */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ===================== DEVICE: replace this part with your design ===================== */
#define SLOTS    4
#define KEY_LEN  32
#define MAX_DATA 256
#define REC      (2 + KEY_LEN)      /* one stored record: used(1) attrs(1) key(32) */

static const char PIN[] = "271828";

/* Storage model. Record 0 is the device's own area (it starts with the PIN); key slots 0..3 are
   records 1..4. One array, so that a bad slot number behaves identically on every host. */
static uint8_t store[(1 + SLOTS) * REC];
static uint8_t *slot_rec(int slot) { return store + (1 + slot) * REC; }

static struct { int session; int fails; uint32_t uptime; } ram;     /* cleared by a reset */

void kk_factory(void) { memset(store, 0, sizeof store); memcpy(store, PIN, sizeof PIN); memset(&ram, 0, sizeof ram); }
void kk_reset(void)   { memset(&ram, 0, sizeof ram); }
/* Test access: the key bytes of a slot, so a test can search the device's output for them. */
const uint8_t *kk_test_key(int slot) { return slot_rec(slot) + 2; }

/* STAND-IN, NOT A CIPHER: a keyed byte-mixing function so that this listing needs no library.
   It has none of the properties of encryption. Your design calls a library AEAD here. */
static void toy_stream(const uint8_t *key, const uint8_t iv[4], uint8_t *data, size_t n) {
    uint32_t x = 0x9E3779B9u;
    for (int i = 0; i < KEY_LEN; i++) x = (x ^ key[i]) * 16777619u;
    for (int i = 0; i < 4; i++)       x = (x ^ iv[i]) * 16777619u;
    for (size_t i = 0; i < n; i++) { x = x * 1664525u + 1013904223u; data[i] ^= (uint8_t)(x >> 24); }
}
static uint8_t toy_sum(const uint8_t *p, size_t n) { uint8_t s = 0x5A; for (size_t i = 0; i < n; i++) s = (uint8_t)(s * 31u + p[i]); return s; }

static int unhex(const char *s, uint8_t *out, size_t cap) {      /* returns byte count or -1 */
    size_t n = strlen(s);
    if (n % 2 || n / 2 > cap) return -1;
    for (size_t i = 0; i < n; i++) {
        char ch = s[i];
        int v = ch >= '0' && ch <= '9' ? ch - '0' : ch >= 'a' && ch <= 'f' ? ch - 'a' + 10 : -1;
        if (v < 0) return -1;
        out[i / 2] = (uint8_t)(i % 2 ? out[i / 2] | v : v << 4);
    }
    return (int)(n / 2);
}
static void hexout(char *out, size_t cap, const uint8_t *p, size_t n) {
    size_t at = (size_t)snprintf(out, cap, "ok ");
    for (size_t i = 0; i < n && at + 3 <= cap; i++) at += (size_t)snprintf(out + at, cap - at, "%02x", p[i]);
}

/* One command line in (no newline), one response line out. */
void kk_line(const char *in, char *out, size_t cap) {
    char line[700], *arg[4] = { 0, 0, 0, 0 };
    uint8_t buf[4 + MAX_DATA + 1];
    int argc = 0, slot, n;

    snprintf(line, sizeof line, "%s", in);
    for (char *t = strtok(line, " "); t && argc < 4; t = strtok(NULL, " ")) arg[argc++] = t;
    if (argc == 0) { snprintf(out, cap, "err"); return; }
    ram.uptime++;

    if (!strcmp(arg[0], "login") && argc == 2) {
        if (ram.fails >= 3) { snprintf(out, cap, "err locked"); return; }
        if (strcmp(arg[1], (const char *)store) != 0) { ram.fails++; snprintf(out, cap, "err pin"); return; }
        ram.fails = 0; ram.session = 1;
        snprintf(out, cap, "ok"); return;
    }
    if (!strcmp(arg[0], "logout")) { snprintf(out, cap, "ok"); return; }        /* session stays set */
    if (!strcmp(arg[0], "list")) {
        size_t at = (size_t)snprintf(out, cap, "ok");
        for (int i = 0; i < SLOTS; i++)
            at += (size_t)snprintf(out + at, cap - at, slot_rec(i)[0] ? " %d:aes:%02x" : " %d:-", i, slot_rec(i)[1]);
        return;
    }
    if (!strcmp(arg[0], "ftest") && argc == 2) {                 /* "factory test": no login needed */
        hexout(out, cap, slot_rec(atoi(arg[1]) & 3) + 2, KEY_LEN); return;
    }
    if (!ram.session) { snprintf(out, cap, "err login"); return; }
    if (argc < 2) { snprintf(out, cap, "err"); return; }
    slot = atoi(arg[1]);
    if (slot >= SLOTS) { snprintf(out, cap, "err slot"); return; }      /* signed; upper bound only */
    uint8_t *rec = slot_rec(slot);

    if (!strcmp(arg[0], "generate") && argc == 4 && !strcmp(arg[2], "aes")) {
        srand(ram.uptime);                                       /* C library generator, seeded from uptime */
        for (int i = 0; i < KEY_LEN; i++) rec[2 + i] = (uint8_t)rand();
        rec[0] = 1; rec[1] = 0;
        for (const char *a = arg[3]; *a; a++)                    /* attributes: stored, never consulted */
            rec[1] |= (uint8_t)(*a == 'e' ? 1 : *a == 'd' ? 2 : *a == 's' ? 4 : *a == 'w' ? 8 : *a == 'x' ? 0x80 : 0);
        snprintf(out, cap, "ok");
    } else if (!strcmp(arg[0], "encrypt") && argc >= 3) {        /* blob = iv(4) ciphertext check(1) */
        memset(buf, 0, 4);
        if (argc == 4 && unhex(arg[3], buf, 4) != 4) { snprintf(out, cap, "err iv"); return; }   /* host-chosen IV */
        if ((n = unhex(arg[2], buf + 4, MAX_DATA)) < 1) { snprintf(out, cap, "err data"); return; }
        buf[4 + n] = toy_sum(buf + 4, (size_t)n);
        toy_stream(rec + 2, buf, buf + 4, (size_t)n);
        hexout(out, cap, buf, (size_t)n + 5);
    } else if (!strcmp(arg[0], "decrypt") && argc == 3) {
        if ((n = unhex(arg[2], buf, sizeof buf)) < 6) { snprintf(out, cap, "err bad format"); return; }
        toy_stream(rec + 2, buf, buf + 4, (size_t)n - 5);
        if (toy_sum(buf + 4, (size_t)n - 5) != buf[n - 1]) { snprintf(out, cap, "err bad mac"); return; }
        hexout(out, cap, buf + 4, (size_t)n - 5);
    } else if (!strcmp(arg[0], "export")) {                      /* raw key "for backup" */
        hexout(out, cap, rec + 2, KEY_LEN);
    } else if (!strcmp(arg[0], "destroy") && argc == 2) {
        memset(rec, 0, REC); snprintf(out, cap, "ok");
    } else {
        snprintf(out, cap, "err");
    }
}

/* ===================== HARNESS: keep, and extend with your own tests ===================== */
static int failed;
static char resp[1400], line[700];
static const char *cmd(const char *l) { kk_line(l, resp, sizeof resp); return resp; }
static int is(const char *l, const char *want) { return strcmp(cmd(l), want) == 0; }
static int okay(const char *l) { return strncmp(cmd(l), "ok", 2) == 0; }
static void check(const char *id, int ok, const char *what) {
    printf("%-7s %s  %s\n", id, ok ? "PASS" : "FAIL", what);
    failed += !ok;
}
static void keyhex(int slot, char *out) { for (int i = 0; i < KEY_LEN; i++) sprintf(out + 2 * i, "%02x", kk_test_key(slot)[i]); }
/* Fresh device, logged in, with: 0 data key (e,d)  1 encrypt-only  2 wrapping key  3 exportable data key. */
static void setup(void) {
    kk_factory(); cmd("login 271828");
    cmd("generate 0 aes ed"); cmd("generate 1 aes e"); cmd("generate 2 aes w"); cmd("generate 3 aes edx");
}

int main(void) {
    char k[2 * KEY_LEN + 1], k2[2 * KEY_LEN + 1], a[1400], b[1400];
    int ok;

    setup();
    strcpy(a, cmd("encrypt 0 00112233"));
    snprintf(line, sizeof line, "decrypt 0 %s", a + 3);
    check("T-F1", !strncmp(a, "ok ", 3) && is(line, "ok 00112233"), "encrypt then decrypt returns the data");
    check("T-F3", !strncmp(cmd("list"), "ok 0:aes", 8), "list shows slot 0 in use");

    setup(); ok = 1;
    for (int s = 0; s < SLOTS; s++) {
        keyhex(s, k);
        const char *all[] = { "list", "export 3 2", "export 0 2", "export 1", "encrypt 0 00", "decrypt 0 0000000000ff", "bogus" };
        for (size_t i = 0; i < sizeof all / sizeof all[0]; i++) if (strstr(cmd(all[i]), k)) ok = 0;
    }
    check("T-S1-1", ok, "no response contains the bytes of any key");

    setup(); kk_reset();
    ok = !okay("generate 0 aes ed") && !okay("encrypt 0 00") && !okay("export 3 2") && !okay("destroy 0") && okay("list");
    check("T-S2-1", ok, "without a session only login and list work");
    setup(); cmd("logout");
    check("T-S2-1b", !okay("encrypt 0 00"), "logout ends the session");
    kk_factory(); cmd("login 000000"); cmd("login 000001"); cmd("login 000002"); kk_reset();
    check("T-S2-2", !okay("login 271828"), "three wrong PINs lock the device across a reset");

    setup(); strcpy(a, cmd("encrypt 1 00112233"));
    snprintf(line, sizeof line, "decrypt 1 %s", a + 3);
    check("T-S3-1", !okay(line), "an encrypt-only key cannot decrypt");
    setup();
    check("T-S4-1", !okay("export 0 2") && !okay("export 3 0"), "export needs an exportable key and a wrapping key");
    setup(); strcpy(a, cmd("export 3 2"));
    snprintf(line, sizeof line, "decrypt 2 %s", strlen(a) > 3 ? a + 3 : "00");
    check("T-S4-3", !okay(line), "a wrapping key cannot be used through decrypt");

    setup(); strcpy(a, cmd("encrypt 0 00112233")); strcpy(b, cmd("encrypt 0 00112233"));
    check("T-S5-1", okay("encrypt 0 00112233") && strcmp(a, b) != 0, "the same data encrypted twice gives different blobs");
    check("T-S5-3", !okay("encrypt 0 00112233 01020304"), "the host cannot supply a nonce");
    setup(); keyhex(0, k); setup(); keyhex(0, k2);
    check("T-S5-4", strcmp(k, k2) != 0, "two factory-fresh devices generate different keys");

    setup(); strcpy(a, cmd("decrypt 0 0000000000ff")); strcpy(b, cmd("decrypt 0 00"));
    check("T-S6-1", !strcmp(a, b) && !strcmp(a, "err"), "every decrypt failure is the same response");

    setup();
    ok = is("ftest 0", "err") && is("help", "err") && is("export -1 2", "err") && is("destroy 4", "err")
      && is("destroy 2147483648", "err") && is("destroy x", "err") && !strncmp(cmd("list"), "ok 0:aes", 8);
    check("T-S7-1", ok, "unknown commands and bad slot numbers answer err and change nothing");
    setup(); memset(line, 0, sizeof line); strcpy(line, "encrypt 0 "); memset(line + 10, '0', 2 * MAX_DATA + 2);
    check("T-S7-2", !okay(line), "257 bytes of data are refused");

    /* To add: sign and import (T-F5, T-S4-2, T-S4-4), a failing random generator (T-S5-2),
       timing of failures (T-S6-2), and random command lines under sanitizers. */
    printf("%d check(s) failed\n", failed);
    return failed != 0;
}
`;

export const KEYKEEPER_REF_OUT = String.raw`T-F1    PASS  encrypt then decrypt returns the data
T-F3    PASS  list shows slot 0 in use
T-S1-1  FAIL  no response contains the bytes of any key
T-S2-1  PASS  without a session only login and list work
T-S2-1b FAIL  logout ends the session
T-S2-2  FAIL  three wrong PINs lock the device across a reset
T-S3-1  FAIL  an encrypt-only key cannot decrypt
T-S4-1  FAIL  export needs an exportable key and a wrapping key
T-S4-3  PASS  a wrapping key cannot be used through decrypt
T-S5-1  FAIL  the same data encrypted twice gives different blobs
T-S5-3  FAIL  the host cannot supply a nonce
T-S5-4  FAIL  two factory-fresh devices generate different keys
T-S6-1  FAIL  every decrypt failure is the same response
T-S7-1  FAIL  unknown commands and bad slot numbers answer err and change nothing
T-S7-2  PASS  257 bytes of data are refused
10 check(s) failed
`;
