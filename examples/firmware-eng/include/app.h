/* app.h - door-lock application: command lines in, replies and latch control out. */
#ifndef APP_H
#define APP_H

#include <stdint.h>
#include "lock.h"

#define APP_VERSION "1.0.0"
#define APP_PIN     "4921"     /* demo only: a real product never compiles a shared PIN in */
#define APP_RX_FIFO_SIZE 64u   /* power of two */

void app_init(void);
void app_on_rx_byte(uint8_t byte);   /* producer side: call from the UART RX ISR, or from a poll pump */
void app_poll(void);                 /* consumer side: call from the main loop, never blocks */
lock_state_t app_lock_state(void);
uint32_t app_rx_dropped(void);

#endif
