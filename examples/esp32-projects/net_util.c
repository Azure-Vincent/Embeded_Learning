#include "net_util.h"
#include <inttypes.h>
#include <stdio.h>

uint32_t backoff_ms(unsigned attempt)
{
    uint32_t d = BACKOFF_FIRST_MS;
    while (attempt-- > 0 && d < BACKOFF_MAX_MS) d *= 2u;   /* 1 s, 2 s, 4 s ... */
    return d > BACKOFF_MAX_MS ? BACKOFF_MAX_MS : d;
}

int status_json(char *out, size_t out_size,
                uint32_t uptime_s, uint32_t free_heap, int rssi_dbm)
{
    if (out == NULL || out_size == 0) return -1;
    int n = snprintf(out, out_size,
                     "{\"uptime_s\":%" PRIu32 ",\"free_heap\":%" PRIu32 ",\"rssi_dbm\":%d}",
                     uptime_s, free_heap, rssi_dbm);
    if (n < 0 || (size_t)n >= out_size) {   /* snprintf reports the length it WANTED */
        out[0] = '\0';
        return -1;
    }
    return n;
}
