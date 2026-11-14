/* Callees for read_number(), kept in a separate file so the compiler cannot inline them. */
#include <stdint.h>

#define UART_DATA   (*(volatile uint32_t *)0x40001000u)
#define UART_STATUS (*(volatile uint32_t *)0x40001004u)

/* Deliberately unbounded: it copies until newline, whatever the size of dst. */
void uart_read_line(char *dst)
{
    for (;;) {
        while ((UART_STATUS & 2u) == 0) {
        }
        char c = (char)UART_DATA;
        if (c == '\n') {
            break;
        }
        *dst++ = c;
    }
    *dst = '\0';
}

uint32_t parse_number(const char *text)
{
    uint32_t value = 0;
    while (*text >= '0' && *text <= '9') {
        value = value * 10 + (uint32_t)(*text - '0');
        text++;
    }
    return value;
}

void _start(void)
{
    for (;;) {
    }
}
