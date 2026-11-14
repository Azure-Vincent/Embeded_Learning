/* hal_benchmcu.c - HAL for Bench-MCU, the fictional teaching MCU in this course
 * (docs/BENCH_MCU.md). Register addresses are Bench-MCU's and match no real chip.
 * `make port-check` compiles this file to prove it satisfies hal.h; it is run only
 * inside the course's C lab simulator, never on the host. */
#include "hal.h"

#define REG32(addr)   (*(volatile uint32_t *)(addr))
#define GPIO_DIR      REG32(0x40000000u)
#define GPIO_SET      REG32(0x4000000Cu)
#define GPIO_CLR      REG32(0x40000010u)
#define UART_DATA     REG32(0x40001000u)
#define UART_STATUS   REG32(0x40001004u)
#define UART_CTRL     REG32(0x40001008u)
#define TIM_CTRL      REG32(0x40002000u)
#define TIM_LOAD      REG32(0x40002004u)
#define TIM_STATUS    REG32(0x4000200Cu)
#define UART_TX_READY (1u << 0)
#define UART_RX_AVAIL (1u << 1)

#define PIN_LATCH_BIT (1u << 4)
#define PIN_LED_BIT   (1u << 5)
#define TICKS_PER_MS  1000u          /* board constant: timer ticks per millisecond */
#define TX_WAIT_LIMIT 10000u

static uint32_t s_ms;

void hal_init(void)
{
    GPIO_DIR |= PIN_LATCH_BIT | PIN_LED_BIT;
    UART_CTRL = 1u;                              /* ENABLE */
    TIM_LOAD = TICKS_PER_MS;
    TIM_CTRL = (1u << 0) | (1u << 1);            /* ENABLE | AUTO_RELOAD, polled */
}

bool hal_uart_read(uint8_t *byte)
{
    if ((UART_STATUS & UART_RX_AVAIL) == 0) return false;
    *byte = (uint8_t)UART_DATA;                  /* reading DATA pops the byte */
    return true;
}

void hal_uart_write(uint8_t byte)
{
    uint32_t guard = TX_WAIT_LIMIT;
    while ((UART_STATUS & UART_TX_READY) == 0) {
        if (--guard == 0) return;                /* transmitter stuck: give up, do not hang */
    }
    UART_DATA = byte;
}

uint32_t hal_millis(void)
{
    if (TIM_STATUS & 1u) {                       /* EXPIRED: one millisecond has elapsed */
        TIM_STATUS = 1u;                         /* write 1 to clear */
        s_ms++;
    }
    return s_ms;
}

void hal_gpio_write(hal_pin_t pin, bool level)
{
    uint32_t bit = (pin == HAL_PIN_LATCH) ? PIN_LATCH_BIT : PIN_LED_BIT;
    if (level) GPIO_SET = bit; else GPIO_CLR = bit;
}
