/* hal_fake.c - HAL implementation for host unit tests.
 * Inputs are scripted, outputs are recorded, and time only moves when a test says so. */
#include <assert.h>
#include <string.h>
#include "hal_fake.h"

#define FAKE_BUF 512u

static uint8_t  s_rx[FAKE_BUF];
static uint32_t s_rx_len, s_rx_pos;
static char     s_tx[FAKE_BUF];
static uint32_t s_tx_len;
static uint32_t s_now;
static bool     s_pins[HAL_PIN_COUNT];

void fake_reset(void)
{
    s_rx_len = s_rx_pos = s_tx_len = 0;
    s_tx[0] = '\0';
    s_now = 0;
    memset(s_pins, 0, sizeof s_pins);
}

void fake_rx_push(const char *text)
{
    size_t n = strlen(text);
    assert(s_rx_len + n <= FAKE_BUF);
    memcpy(&s_rx[s_rx_len], text, n);
    s_rx_len += (uint32_t)n;
}

const char *fake_tx(void) { return s_tx; }
void fake_tx_clear(void) { s_tx_len = 0; s_tx[0] = '\0'; }
void fake_advance_ms(uint32_t ms) { s_now += ms; }
void fake_set_ms(uint32_t ms) { s_now = ms; }
bool fake_pin(hal_pin_t pin) { assert(pin < HAL_PIN_COUNT); return s_pins[pin]; }

void hal_init(void) { }

bool hal_uart_read(uint8_t *byte)
{
    if (s_rx_pos == s_rx_len) return false;
    *byte = s_rx[s_rx_pos++];
    return true;
}

void hal_uart_write(uint8_t byte)
{
    assert(s_tx_len + 1u < FAKE_BUF);
    s_tx[s_tx_len++] = (char)byte;
    s_tx[s_tx_len] = '\0';
}

uint32_t hal_millis(void) { return s_now; }

void hal_gpio_write(hal_pin_t pin, bool level)
{
    assert(pin < HAL_PIN_COUNT);
    s_pins[pin] = level;
}
