/* hal_posix.c - a second "target": the application running as a PC program.
 * UART = stdin/stdout, time = the monotonic clock, pins = messages on stderr. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include "hal.h"

static bool s_pins[HAL_PIN_COUNT];
static struct timespec s_t0;

void hal_init(void)
{
    clock_gettime(CLOCK_MONOTONIC, &s_t0);
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    if (flags != -1) (void)fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);   /* reads must not block */
}

bool hal_uart_read(uint8_t *byte)
{
    return read(STDIN_FILENO, byte, 1) == 1;
}

void hal_uart_write(uint8_t byte)
{
    (void)!write(STDOUT_FILENO, &byte, 1);
}

uint32_t hal_millis(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (uint32_t)((t.tv_sec - s_t0.tv_sec) * 1000 + (t.tv_nsec - s_t0.tv_nsec) / 1000000);
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    static const char *const names[HAL_PIN_COUNT] = { "LATCH", "LED" };
    if (pin >= HAL_PIN_COUNT || s_pins[pin] == level) return;
    s_pins[pin] = level;
    fprintf(stderr, "[pin] %s = %d\n", names[pin], level ? 1 : 0);
}
