/* ihex_check.c - read an Intel HEX file, verify every record checksum and
 * print the address ranges that the file actually programs.
 *
 * Usage: ./ihex_check file.hex
 * Build: gcc -Wall -Wextra -std=c11 -o ihex_check ihex_check.c
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int hex_nibble(int c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    return -1;
}

/* Convert "1A2B.." into bytes. Returns the byte count or -1 on a bad digit. */
static int hex_bytes(const char *s, uint8_t *out, int max)
{
    int n = 0;
    while (s[0] != '\0' && s[0] != '\r' && s[0] != '\n') {
        int hi = hex_nibble((unsigned char)s[0]);
        int lo = hex_nibble((unsigned char)s[1]);
        if (hi < 0 || lo < 0 || n >= max) return -1;
        out[n++] = (uint8_t)((hi << 4) | lo);
        s += 2;
    }
    return n;
}

int main(int argc, char **argv)
{
    if (argc != 2) { fprintf(stderr, "usage: %s file.hex\n", argv[0]); return 2; }
    FILE *fp = fopen(argv[1], "r");
    if (!fp) { perror(argv[1]); return 2; }

    char line[600];
    uint8_t rec[280];
    uint32_t upper = 0;            /* bits 31..16, set by type-04 records */
    uint32_t run_start = 0, run_end = 0;
    int have_run = 0, lineno = 0, bad = 0;
    unsigned long total = 0;

    while (fgets(line, sizeof line, fp)) {
        lineno++;
        if (line[0] != ':') continue;                 /* anything else is ignored */
        int n = hex_bytes(line + 1, rec, (int)sizeof rec);
        if (n < 5 || n != rec[0] + 5) { printf("line %d: malformed record\n", lineno); bad++; continue; }

        /* The checksum is chosen so that ALL bytes of the record sum to 0 mod 256. */
        uint8_t sum = 0;
        for (int i = 0; i < n; i++) sum = (uint8_t)(sum + rec[i]);
        if (sum != 0) { printf("line %d: checksum error\n", lineno); bad++; continue; }

        uint8_t len = rec[0], type = rec[3];
        uint32_t addr = upper | ((uint32_t)rec[1] << 8) | rec[2];
        if (type == 0x00) {                           /* data */
            if (have_run && addr == run_end) {
                run_end += len;
            } else {
                if (have_run) printf("data 0x%08lX..0x%08lX (%lu bytes)\n", (unsigned long)run_start,
                                     (unsigned long)(run_end - 1), (unsigned long)(run_end - run_start));
                run_start = addr; run_end = addr + len; have_run = 1;
            }
            total += len;
        } else if (type == 0x04 && len == 2) {        /* extended linear address */
            upper = ((uint32_t)rec[4] << 24) | ((uint32_t)rec[5] << 16);
        } else if (type == 0x05 && len == 4) {        /* start linear address (entry point) */
            printf("entry point 0x%02X%02X%02X%02X\n", rec[4], rec[5], rec[6], rec[7]);
        } else if (type == 0x01) {                    /* end of file */
            break;
        }
    }
    if (have_run) printf("data 0x%08lX..0x%08lX (%lu bytes)\n", (unsigned long)run_start,
                         (unsigned long)(run_end - 1), (unsigned long)(run_end - run_start));
    printf("%lu data bytes, %d bad record(s)\n", total, bad);
    fclose(fp);
    return bad ? 1 : 0;
}
