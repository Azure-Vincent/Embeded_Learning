/* stack_hog.c - three functions with very different stack appetites.
 * `make su` compiles this with -fstack-usage and prints the .su file. */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

uint32_t checksum(const uint8_t *data, uint32_t len)
{
    uint32_t sum = 0;
    for (uint32_t i = 0; i < len; i++) sum += data[i];
    return sum;
}

/* A "temporary" buffer on the stack: 512 bytes every time this is called. */
uint32_t format_report(uint32_t value)
{
    char line[512];
    int n = snprintf(line, sizeof line, "value=%lu", (unsigned long)value);
    return checksum((const uint8_t *)line, (uint32_t)n);
}

/* Recursion: the frame is small, but there is one per level and the depth is data-dependent. */
uint32_t depth_sum(uint32_t n)
{
    volatile uint32_t pad[4] = { n, n, n, n };
    if (n == 0) return pad[0];
    return pad[1] + depth_sum(n - 1);
}

/* Variable-length array: the frame size is not known until run time. */
uint32_t echo_copy(const uint8_t *src, uint32_t len)
{
    uint8_t copy[len];
    memcpy(copy, src, len);
    return checksum(copy, len);
}

int main(void)
{
    static const uint8_t msg[] = "hello";
    printf("%lu %lu %lu\n", (unsigned long)format_report(42),
           (unsigned long)depth_sum(10), (unsigned long)echo_copy(msg, 5));
    return 0;
}
