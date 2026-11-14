/* net_util.h - pure helpers for the Wi-Fi project. No ESP-IDF includes. */
#ifndef NET_UTIL_H
#define NET_UTIL_H

#include <stddef.h>
#include <stdint.h>

#define BACKOFF_FIRST_MS   1000u
#define BACKOFF_MAX_MS    30000u

/* Delay before reconnect attempt number attempt (0 = first retry). */
uint32_t backoff_ms(unsigned attempt);

/* Write the status JSON into out. Returns its length, or -1 if it did
 * not fit (out is then an empty string, never a truncated document). */
int status_json(char *out, size_t out_size,
                uint32_t uptime_s, uint32_t free_heap, int rssi_dbm);

#endif
