#include "movavg.h"
#include <string.h>

void movavg_init(movavg_t *m) { memset(m, 0, sizeof *m); }

int32_t movavg_push(movavg_t *m, int32_t sample)
{
    if (m->count == MOVAVG_N)
        m->sum -= m->buf[m->head];      /* the oldest sample leaves the window */
    else
        m->count++;
    m->buf[m->head] = sample;
    m->sum += sample;
    m->head = (m->head + 1u) % MOVAVG_N;
    return m->sum / (int32_t)m->count;  /* average of what we have so far */
}
