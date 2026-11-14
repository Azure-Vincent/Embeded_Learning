/* movavg.h - fixed-size moving average over the last MOVAVG_N samples.
 * Integer only, O(1) per sample, no ESP-IDF includes. */
#ifndef MOVAVG_H
#define MOVAVG_H

#include <stdint.h>

#define MOVAVG_N 8u

typedef struct {
    int32_t  buf[MOVAVG_N];
    int32_t  sum;
    uint32_t head;    /* index of the oldest sample = next slot to overwrite */
    uint32_t count;   /* how many slots hold real data (<= MOVAVG_N)         */
} movavg_t;

void    movavg_init(movavg_t *m);
int32_t movavg_push(movavg_t *m, int32_t sample);   /* returns the new average */

#endif
