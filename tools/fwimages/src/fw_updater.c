/* updater: a bootloader-style image for the firmware inspector.
 * It hashes a candidate image and would check an ECDSA signature against an embedded public key.
 * The signature maths is NOT implemented (ecdsa_p256_verify is a stub that always refuses);
 * the point of this image is its layout: version string, key blob, compressed payload, erased padding.
 * Synthetic; never run on hardware. */
#include "bench.h"
#include "sha256.h"
#include "blobs.h"

#define APP_BASE   0x08008000u
#define APP_MAGIC  0x42454e43u /* "CNEB" little-endian */

struct image_header {
    uint32_t magic;
    uint32_t length;
    uint32_t version;
    uint8_t signature[64];
};

struct key_slot {
    char magic[4];      /* "PKEY" */
    uint8_t algorithm;  /* 1 = ECDSA P-256 with SHA-256 */
    uint8_t length;     /* bytes of key material that follow */
    uint8_t reserved[2];
    uint8_t key[65];    /* SEC1 uncompressed point: 0x04 || X || Y */
};

static const char version[] = "BenchBoot updater v2.4.1";
static const char build[] = "built 2026-03-02 for Bench-MCU (synthetic)";
static const char msg_wait[] = "waiting for image header\r\n";
static const char msg_magic[] = "bad image magic\r\n";
static const char msg_sig[] = "ecdsa-p256-sha256 signature check failed\r\n";
static const char msg_boot[] = "signature ok, booting application\r\n";

__attribute__((section(".keystore"), used))
static const struct key_slot vendor_key = {
    .magic = {'P', 'K', 'E', 'Y'},
    .algorithm = 1,
    .length = 65,
    .key = VENDOR_PUBKEY_BYTES,
};

/* A zlib-compressed block of recovery-console text: what compressed data looks like in an image. */
__attribute__((section(".payload"), used))
static const uint8_t recovery_blob[] = RECOVERY_ZLIB_BYTES;

uint32_t boot_count = 1;
static uint8_t digest[32];

static void uart_putc(char c)
{
    while ((UART_STATUS & UART_TX_READY) == 0) {
    }
    UART_DATA = (uint32_t)c;
}

__attribute__((noinline)) static void uart_puts(const char *s)
{
    while (*s) {
        uart_putc(*s++);
    }
}

/* Stub: a real updater calls a vetted ECDSA implementation here. This one refuses every image. */
__attribute__((noinline)) static int ecdsa_p256_verify(const uint8_t *pubkey, const uint8_t *hash,
                                                       const uint8_t *signature)
{
    (void)pubkey;
    (void)hash;
    (void)signature;
    return 0;
}

__attribute__((noinline)) static void jump_to_app(void)
{
    const uint32_t *vectors = (const uint32_t *)APP_BASE;
    void (*reset)(void) = (void (*)(void))vectors[1];
    reset();
}

int main(void)
{
    const struct image_header *hdr = (const struct image_header *)APP_BASE;
    UART_CTRL = 1;
    uart_puts(version);
    uart_puts("\r\n");
    uart_puts(build);
    uart_puts("\r\n");
    uart_puts(msg_wait);
    boot_count++;
    if (hdr->magic != APP_MAGIC || hdr->length > 0x7000u) {
        uart_puts(msg_magic);
    } else {
        sha256((const uint8_t *)(hdr + 1), hdr->length, digest);
        if (ecdsa_p256_verify(vendor_key.key, digest, hdr->signature)) {
            uart_puts(msg_boot);
            jump_to_app();
        }
        uart_puts(msg_sig);
    }
    for (;;) {
    }
}
