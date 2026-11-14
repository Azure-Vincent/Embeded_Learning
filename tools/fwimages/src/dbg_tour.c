/* tour: a first debug session. Sums a table, then blinks an LED forever. */
#include "bench.h"

#define LED_PIN 5u

static const uint8_t samples[6] = {12, 7, 30, 5, 9, 21};
uint32_t total;

static uint32_t checksum(const uint8_t *data, uint32_t len)
{
    uint32_t sum = 0;
    for (uint32_t i = 0; i < len; i++) {
        sum += data[i];
    }
    return sum;
}

static void led_toggle(void)
{
    GPIO_OUT ^= 1u << LED_PIN;
}

int main(void)
{
    volatile uint32_t count = 0;
    GPIO_DIR |= 1u << LED_PIN;
    total = checksum(samples, 6);
    for (;;) {
        led_toggle();
        count++;
    }
}
