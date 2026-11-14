#include <string.h>
#include "app.h"
#include "hal.h"
#include "line_rx.h"
#include "ringbuf.h"

/* All module state is file-local. Other modules reach it only through app.h. */
static uint8_t   s_rx_storage[APP_RX_FIFO_SIZE];
static ringbuf_t s_rx;
static line_rx_t s_line;
static lock_t    s_lock;

static void reply(const char *s)
{
    while (*s != '\0') hal_uart_write((uint8_t)*s++);
    hal_uart_write('\n');
}

/* Compare without an early exit, so the time taken does not reveal how many leading
 * characters were right. (The security section explains the attack this prevents.) */
static bool pin_matches(const char *candidate)
{
    size_t n = strlen(APP_PIN);
    if (strlen(candidate) != n) return false;
    uint8_t diff = 0;
    for (size_t i = 0; i < n; i++) diff |= (uint8_t)(candidate[i] ^ APP_PIN[i]);
    return diff == 0;
}

static void handle_line(const char *line, uint32_t now)
{
    if (strncmp(line, "PIN ", 4) == 0) {
        if (s_lock.state == LOCK_LOCKOUT) { reply("LOCKOUT"); return; }
        if (s_lock.state == LOCK_UNLOCKED) { reply("OK"); return; }
        bool ok = pin_matches(line + 4);
        lock_dispatch(&s_lock, ok ? LOCK_EV_PIN_OK : LOCK_EV_PIN_BAD, now);
        if (ok) reply("OK");
        else reply(s_lock.state == LOCK_LOCKOUT ? "LOCKOUT" : "DENIED");
    } else if (strcmp(line, "LOCK") == 0) {
        lock_dispatch(&s_lock, LOCK_EV_LOCK, now);
        reply("OK");
    } else if (strcmp(line, "STATUS") == 0) {
        reply(lock_state_name(s_lock.state));
    } else if (strcmp(line, "VERSION") == 0) {
        reply(APP_VERSION);
    } else if (line[0] != '\0') {
        reply("ERR");
    }
}

void app_init(void)
{
    hal_init();
    (void)rb_init(&s_rx, s_rx_storage, APP_RX_FIFO_SIZE);
    line_init(&s_line);
    lock_init(&s_lock);
    hal_gpio_write(HAL_PIN_LATCH, false);
    hal_gpio_write(HAL_PIN_LED, false);
}

void app_on_rx_byte(uint8_t byte)
{
    (void)rb_put(&s_rx, byte);       /* a full FIFO drops the byte and counts it */
}

void app_poll(void)
{
    uint32_t now = hal_millis();
    uint8_t b;

    /* Ports without an RX interrupt are pumped here; ISR-driven ports return false. */
    while (hal_uart_read(&b)) app_on_rx_byte(b);

    while (rb_get(&s_rx, &b)) {
        if (line_feed(&s_line, b)) handle_line(s_line.buf, now);
    }

    lock_dispatch(&s_lock, LOCK_EV_TICK, now);

    /* Outputs are a pure function of state, written in one place. */
    hal_gpio_write(HAL_PIN_LATCH, lock_latch_open(&s_lock));
    hal_gpio_write(HAL_PIN_LED, s_lock.state == LOCK_LOCKOUT);
}

lock_state_t app_lock_state(void) { return s_lock.state; }
uint32_t app_rx_dropped(void) { return s_rx.dropped; }
