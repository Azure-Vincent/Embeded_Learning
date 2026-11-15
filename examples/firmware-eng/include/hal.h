/* hal.h - the only hardware interface the application is allowed to use.
 *
 * It is written in the application's vocabulary ("the latch", "milliseconds since boot"),
 * not the chip's ("GPIO port 2 bit 0", "TIMER0 count register").
 * Each target provides one .c file implementing these five functions; the linker picks
 * the implementation (link-time substitution). See port/. */
#ifndef HAL_H
#define HAL_H

#include <stdbool.h>
#include <stdint.h>

typedef enum { HAL_PIN_LATCH, HAL_PIN_LED, HAL_PIN_COUNT } hal_pin_t;

void     hal_init(void);
bool     hal_uart_read(uint8_t *byte);         /* true if a byte was fetched; never blocks */
void     hal_uart_write(uint8_t byte);         /* may wait for the transmitter, bounded    */
uint32_t hal_millis(void);                     /* monotonic, wraps after 2^32 ms           */
void     hal_gpio_write(hal_pin_t pin, bool level);

#endif
