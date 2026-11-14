/* demo: a small "blink and report" firmware for the firmware inspector. Synthetic; never run on hardware. */
#include "bench.h"

#define LED_PIN 5u

/* .rodata: constants stay in flash */
static const char banner[] = "Bench demo firmware 1.0.3\r\n";
static const char build_id[] = "build: clang -Os, synthetic teaching image";
static const uint16_t blink_table[8] = {100, 200, 300, 400, 500, 400, 300, 200};

/* .data: initial values are stored in flash and copied to RAM by Reset_Handler */
uint32_t blink_period_ms = 250;
char device_name[16] = "bench-demo-01";
uint16_t calibration[4] = {0x0101, 0x0202, 0x0303, 0x0404};

/* .bss: zero-initialised, occupies RAM only */
uint32_t tick_count;
uint8_t rx_ring[64];
uint32_t last_crc;

static void uart_putc(char c)
{
    while ((UART_STATUS & UART_TX_READY) == 0) {
    }
    UART_DATA = (uint32_t)c;
}

__attribute__((noinline)) void uart_puts(const char *s)
{
    while (*s) {
        uart_putc(*s++);
    }
}

__attribute__((noinline)) uint32_t crc32_update(uint32_t crc, const uint8_t *data, uint32_t len)
{
    crc = ~crc;
    for (uint32_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint32_t bit = 0; bit < 8; bit++) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }
    return ~crc;
}

__attribute__((noinline)) void delay_ms(uint32_t ms)
{
    for (volatile uint32_t n = ms * 1000u; n != 0; n--) {
    }
}

__attribute__((noinline)) void led_toggle(void)
{
    GPIO_OUT ^= 1u << LED_PIN;
}

int main(void)
{
    GPIO_DIR |= 1u << LED_PIN;
    UART_CTRL = 1;
    uart_puts(banner);
    uart_puts(build_id);
    uart_puts("\r\nname: ");
    uart_puts(device_name);
    last_crc = crc32_update(0, (const uint8_t *)calibration, sizeof calibration);
    for (;;) {
        led_toggle();
        delay_ms(blink_period_ms + blink_table[tick_count & 7u]);
        rx_ring[tick_count & 63u] = (uint8_t)UART_DATA;
        tick_count++;
    }
}
