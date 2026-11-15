/* hal_esp32.c - HAL for an ESP32 running ESP-IDF.
 *
 * STATUS: compiled for the esp32 target with ESP-IDF v6.1 (together with main_esp32.c and
 * the portable sources, as the `main` component of a project). It has NOT been run on a
 * board. Check each call again if you use a different ESP-IDF version.
 *
 * Pin choices are for the original ESP32 and avoid strapping pins, the input-only pins
 * GPIO34-39 and the flash pins. Change them to suit your board.
 */
#include "hal.h"

#include "driver/gpio.h"
#include "driver/uart.h"
#include "esp_err.h"
#include "esp_timer.h"

#define LOCK_UART        UART_NUM_1
#define LOCK_UART_TX     GPIO_NUM_25
#define LOCK_UART_RX     GPIO_NUM_26
#define LOCK_PIN_LATCH   GPIO_NUM_32
#define LOCK_PIN_LED     GPIO_NUM_33
#define LOCK_RX_BUF      256            /* driver's own RX ring buffer, bytes */

void hal_init(void)
{
    const uart_config_t cfg = {
        .baud_rate  = 115200,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    const gpio_config_t out_cfg = {
        .pin_bit_mask = (1ULL << LOCK_PIN_LATCH) | (1ULL << LOCK_PIN_LED),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };

    /* The IDF driver installs its own RX interrupt and ring buffer (no TX buffer: writes
     * block until the bytes are in the hardware FIFO). A failure here is a programming
     * error in this file, so it aborts with file and line instead of being ignored. */
    ESP_ERROR_CHECK(uart_driver_install(LOCK_UART, LOCK_RX_BUF, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LOCK_UART, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(LOCK_UART, LOCK_UART_TX, LOCK_UART_RX,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    /* Latch level first, then direction: the pin must not glitch high while it becomes an output. */
    gpio_set_level(LOCK_PIN_LATCH, 0);
    gpio_set_level(LOCK_PIN_LED, 0);
    ESP_ERROR_CHECK(gpio_config(&out_cfg));
}

bool hal_uart_read(uint8_t *byte)
{
    return uart_read_bytes(LOCK_UART, byte, 1, 0) == 1;     /* timeout 0 ticks: never blocks */
}

void hal_uart_write(uint8_t byte)
{
    (void)uart_write_bytes(LOCK_UART, &byte, 1);
}

uint32_t hal_millis(void)
{
    return (uint32_t)(esp_timer_get_time() / 1000);         /* microseconds since boot -> ms */
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    gpio_set_level(pin == HAL_PIN_LATCH ? LOCK_PIN_LATCH : LOCK_PIN_LED, level ? 1 : 0);
}
