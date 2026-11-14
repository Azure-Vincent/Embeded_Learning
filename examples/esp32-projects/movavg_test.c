/* Build: gcc -Wall -Wextra -std=c11 movavg.c movavg_test.c -o movavg_test */
#include "movavg.h"
#include <assert.h>
#include <stdio.h>

int main(void)
{
    movavg_t m;
    movavg_init(&m);
    assert(movavg_push(&m, 100) == 100);          /* one sample: no dilution by zeros */
    assert(movavg_push(&m, 200) == 150);
    for (int i = 0; i < 6; i++) movavg_push(&m, 200);
    assert(m.count == MOVAVG_N && m.sum == 100 + 7 * 200);
    assert(movavg_push(&m, 200) == 200);          /* the 100 has left the window */

    /* A step from 0 to 4095 takes exactly MOVAVG_N samples to settle. */
    movavg_init(&m);
    for (unsigned i = 0; i < MOVAVG_N; i++) movavg_push(&m, 0);
    int steps = 0;
    while (movavg_push(&m, 4095) != 4095) steps++;
    assert(steps == (int)MOVAVG_N - 1);

    /* Long run: the running sum never drifts from a recomputed sum. */
    uint32_t x = 12345;
    for (int i = 0; i < 100000; i++) {
        x = x * 1664525u + 1013904223u;
        movavg_push(&m, (int32_t)(x >> 20));      /* 0..4095 like a 12-bit ADC */
    }
    int32_t check = 0;
    for (unsigned i = 0; i < MOVAVG_N; i++) check += m.buf[i];
    assert(check == m.sum);

    printf("movavg: all checks passed\n");
    return 0;
}
