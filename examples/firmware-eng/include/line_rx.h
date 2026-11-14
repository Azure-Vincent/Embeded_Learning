/* line_rx.h - assemble bytes into newline-terminated lines.
 * A two-state machine: COLLECT bytes, or DISCARD the rest of a line that was too long. */
#ifndef LINE_RX_H
#define LINE_RX_H

#include <stdbool.h>
#include <stdint.h>

#define LINE_CAP 24u            /* longest accepted line, excluding the terminator */

typedef enum { LINE_COLLECT, LINE_DISCARD } line_state_t;

typedef struct {
    line_state_t state;
    uint8_t len;
    char buf[LINE_CAP + 1u];    /* +1 for the NUL terminator */
    uint32_t overlong;          /* lines thrown away because they did not fit */
} line_rx_t;

void line_init(line_rx_t *lr);

/* Feed one received byte. Returns true exactly when a complete line is ready in
 * lr->buf (NUL-terminated, without '\r' or '\n'). The buffer is reused on the next call. */
bool line_feed(line_rx_t *lr, uint8_t c);

#endif
