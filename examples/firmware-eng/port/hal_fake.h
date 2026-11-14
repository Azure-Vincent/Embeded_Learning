/* hal_fake.h - test-only controls for the fake HAL. Never included by application code. */
#ifndef HAL_FAKE_H
#define HAL_FAKE_H

#include <stdbool.h>
#include <stdint.h>
#include "hal.h"

void        fake_reset(void);
void        fake_rx_push(const char *text);   /* bytes the "UART" will deliver */
const char *fake_tx(void);                    /* everything the app has transmitted */
void        fake_tx_clear(void);
void        fake_advance_ms(uint32_t ms);
void        fake_set_ms(uint32_t ms);
bool        fake_pin(hal_pin_t pin);

#endif
