/* Register map of the fictional Bench-MCU teaching target (see docs/BENCH_MCU.md).
 * No address here matches a real chip. */
#ifndef BENCH_H
#define BENCH_H
#include <stdint.h>

#define REG32(addr) (*(volatile uint32_t *)(addr))

#define GPIO_DIR     REG32(0x40000000u)
#define GPIO_OUT     REG32(0x40000004u)
#define GPIO_IN      REG32(0x40000008u)

#define UART_DATA    REG32(0x40001000u)
#define UART_STATUS  REG32(0x40001004u)
#define UART_CTRL    REG32(0x40001008u)
#define UART_TX_READY (1u << 0)
#define UART_RX_AVAIL (1u << 1)

#define ADC_CTRL     REG32(0x40003000u)
#define ADC_STATUS   REG32(0x40003004u)
#define ADC_DATA     REG32(0x40003008u)
#define ADC_START    (1u << 0)
#define ADC_DONE     (1u << 0)

#endif
