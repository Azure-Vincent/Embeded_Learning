/* Functions for the disassembly-reading lab. Compiled for Thumb (ARMv6-M) and RV32I with -Os. */
#include <stdint.h>

#define GPIO_OUT (*(volatile uint32_t *)0x40000004u)

void uart_read_line(char *dst);
uint32_t parse_number(const char *text);

int scale_add(int a, int b)
{
    return a * 5 + b - 3;
}

uint32_t sum_array(const uint32_t *values, uint32_t count)
{
    uint32_t sum = 0;
    for (uint32_t i = 0; i < count; i++) {
        sum += values[i];
    }
    return sum;
}

void led_on(void)
{
    GPIO_OUT |= 1u << 5;
}

int str_equal(const char *a, const char *b)
{
    while (*a != '\0' && *a == *b) {
        a++;
        b++;
    }
    return *a == *b;
}

uint8_t stored_pin[4] = {'4', '9', '2', '1'};

int check_pin(const uint8_t *entered)
{
    const uint8_t *expected = stored_pin;
    for (uint32_t left = 4; left != 0; left--) {
        if (*entered++ != *expected++) {
            return 0;
        }
    }
    return 1;
}

uint32_t read_number(void)
{
    char line[20];
    uart_read_line(line);
    return parse_number(line) + 1;
}
