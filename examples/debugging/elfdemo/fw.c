/* fw.c - a freestanding program shaped like firmware, built for the x86-64 Linux host.
 *
 * It has no C library and no main(): the entry point is _start, exactly as a
 * bare-metal image starts at its reset handler. It exists so you can practise
 * readelf / objdump / nm / size / strings / objcopy on a tiny ELF and account
 * for every byte. It is NOT microcontroller firmware and will not run on one.
 *
 * Build and run:  make && ./fw.elf ; echo "exit=$?"
 */
#include <stdint.h>
#include <stddef.h>

#define FW_VERSION "bench-fw 1.4.2"

/* .rodata: constants. On an MCU these stay in flash. */
const char banner[] = FW_VERSION " (elf demo)\n";
/* static const and only read: the compiler folds 0x5A straight into an
 * instruction, so this constant gets no symbol and no storage at all. */
static const uint8_t crc_seed = 0x5A;

/* .data: initialised, writable. On an MCU the initial values are stored in
 * flash and copied to RAM by the startup code before main(). */
uint32_t boot_count = 3;
char device_key[] = "K3Y-0f-th3-d3m0";   /* demo secret: findable with strings */

/* .bss: zero-initialised, writable. Occupies RAM but no bytes in the file. */
uint8_t rx_buffer[256];
static uint32_t ticks;

/* Linux x86-64 system call: the host's stand-in for "write to the UART". */
static long sys3(long n, long a, long b, long c)
{
    long ret;
    __asm__ volatile("syscall"
                     : "=a"(ret)
                     : "a"(n), "D"(a), "S"(b), "d"(c)
                     : "rcx", "r11", "memory");
    return ret;
}

static size_t str_len(const char *s)
{
    size_t n = 0;
    while (s[n] != '\0') n++;
    return n;
}

void uart_puts(const char *s)
{
    sys3(1 /* write */, 1 /* stdout */, (long)s, (long)str_len(s));
}

/* A deliberately naive check, used again in the reverse-engineering lesson. */
int check_key(const char *candidate)
{
    size_t i;
    for (i = 0; device_key[i] != '\0'; i++) {
        if (candidate[i] != device_key[i]) return 0;
    }
    return candidate[i] == '\0';
}

uint8_t checksum(const uint8_t *p, size_t n)
{
    uint8_t c = crc_seed;
    while (n--) c ^= *p++;
    return c;
}

void _start(void)
{
    uart_puts(banner);
    boot_count++;
    ticks += boot_count;
    rx_buffer[0] = checksum((const uint8_t *)banner, sizeof banner - 1);
    int ok = check_key("guess");
    sys3(60 /* exit */, ok ? 0 : (long)(ticks & 0x7f), 0, 0);
    for (;;) { }
}
