/* hal_esp32.c - HAL for an ESP32 running ESP-IDF.
 *
 * STATUS: written against the ESP-IDF driver API (driver/uart.h, driver/gpio.h, esp_timer.h).
 * It has NOT been compiled or run here: this repository has no ESP-IDF toolchain and no board.
 * Treat it as a reviewed starting point and check each call against the ESP-IDF version you use.
 *
 * Pin choices are for the original ESP32 and avoid strapping pins, the input-only pins
 * GPIO34-39 and the flash pins. Change them to suit your board.
 */
#include "hal.h"

#include "driver/gpio.h"
#include "driver/uart.h"
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
        .baud_rate = 115200,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    };
    /* The IDF driver installs its own RX interrupt and ring buffer. */
    uart_driver_install(LOCK_UART, LOCK_RX_BUF, 0, 0, NULL, 0);
    uart_param_config(LOCK_UART, &cfg);
    uart_set_pin(LOCK_UART, LOCK_UART_TX, LOCK_UART_RX, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);

    gpio_set_direction(LOCK_PIN_LATCH, GPIO_MODE_OUTPUT);
    gpio_set_direction(LOCK_PIN_LED, GPIO_MODE_OUTPUT);
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
