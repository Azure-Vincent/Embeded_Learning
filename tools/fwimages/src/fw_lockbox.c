/* lockbox: an intentionally vulnerable keypad lock for the firmware inspector.
 * Vulnerability on purpose: a maintenance credential is compiled in as plain text.
 * Synthetic; never run on hardware. */
#include "bench.h"

#define STRIKE_PIN 3u

static const char product[] = "LOCKBOX-9 controller rev C";
static const char prompt[] = "Enter code: ";
static const char granted[] = "ACCESS GRANTED\r\n";
static const char denied[] = "ACCESS DENIED\r\n";
static const char maint_banner[] = "maintenance mode: logging enabled\r\n";
static const char maint_code[] = "svc:KESTREL-7741-open";

uint32_t failed_attempts;
char user_code[8] = "000000";
static char line[32];

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

__attribute__((noinline)) static void read_line(char *dst, uint32_t max)
{
    uint32_t n = 0;
    for (;;) {
        while ((UART_STATUS & UART_RX_AVAIL) == 0) {
        }
        char c = (char)UART_DATA;
        if (c == '\r' || c == '\n') {
            break;
        }
        if (n + 1 < max) {
            dst[n++] = c;
        }
    }
    dst[n] = '\0';
}

/* Early-exit compare: also leaks timing, see the timing-attack tool. */
__attribute__((noinline)) static int str_equal(const char *a, const char *b)
{
    while (*a != '\0' && *a == *b) {
        a++;
        b++;
    }
    return *a == *b;
}

__attribute__((noinline)) static void open_strike(void)
{
    GPIO_OUT |= 1u << STRIKE_PIN;
    for (volatile uint32_t n = 3000000u; n != 0; n--) {
    }
    GPIO_OUT &= ~(1u << STRIKE_PIN);
}

int main(void)
{
    GPIO_DIR |= 1u << STRIKE_PIN;
    UART_CTRL = 1;
    uart_puts(product);
    uart_puts("\r\n");
    for (;;) {
        uart_puts(prompt);
        read_line(line, sizeof line);
        if (str_equal(line, maint_code)) {
            uart_puts(maint_banner);
            open_strike();
        } else if (str_equal(line, user_code)) {
            uart_puts(granted);
            failed_attempts = 0;
            open_strike();
        } else {
            uart_puts(denied);
            failed_attempts++;
        }
    }
}
