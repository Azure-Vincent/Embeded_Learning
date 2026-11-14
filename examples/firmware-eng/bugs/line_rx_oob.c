/* line_rx_oob.c - the line receiver as it was first written, with a classic bug.
 * The length check uses > where it needs >=, so a line of exactly LINE_CAP+1 bytes
 * stores one byte past the buffer and the terminator one further.
 * `make bug-demo` builds this with AddressSanitizer and shows the report. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#define LINE_CAP 24u

typedef struct {
    uint8_t len;
    char buf[LINE_CAP];
} line_rx_t;

static bool line_feed(line_rx_t *lr, uint8_t c)
{
    if (c == '\n') {
        lr->buf[lr->len] = '\0';
        lr->len = 0;
        return true;
    }
    if (lr->len > LINE_CAP) {      /* BUG: should be >= LINE_CAP - 1 for this layout */
        lr->len = 0;
        return false;
    }
    lr->buf[lr->len++] = (char)c;
    return false;
}

int main(void)
{
    line_rx_t lr = { 0 };
    const char *input = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n";   /* 30 bytes, then newline */
    int lines = 0;
    for (const char *p = input; *p != '\0'; p++) {
        if (line_feed(&lr, (uint8_t)*p)) lines++;
    }
    printf("lines=%d\n", lines);
    return 0;
}
