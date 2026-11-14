#include "line_rx.h"

void line_init(line_rx_t *lr)
{
    lr->state = LINE_COLLECT;
    lr->len = 0;
    lr->buf[0] = '\0';
    lr->overlong = 0;
}

bool line_feed(line_rx_t *lr, uint8_t c)
{
    if (c == '\r') return false;                 /* accept both "\n" and "\r\n" endings */

    switch (lr->state) {
    case LINE_COLLECT:
        if (c == '\n') {
            lr->buf[lr->len] = '\0';             /* len <= LINE_CAP, so this index is in bounds */
            lr->len = 0;
            return true;
        }
        if (lr->len >= LINE_CAP) {               /* no room: do not store, drop the whole line */
            lr->len = 0;
            lr->overlong++;
            lr->state = LINE_DISCARD;
            return false;
        }
        lr->buf[lr->len++] = (char)c;
        return false;

    case LINE_DISCARD:
        if (c == '\n') lr->state = LINE_COLLECT; /* resynchronise at the next line boundary */
        return false;
    }
    return false;
}
