/* main_posix.c - superloop for the PC port. Try:  make demo  then type  PIN 4921  */
#define _POSIX_C_SOURCE 200809L
#include <time.h>
#include "app.h"

int main(void)
{
    app_init();
    for (;;) {
        app_poll();
        struct timespec nap = { 0, 5 * 1000 * 1000 };   /* 5 ms: be polite to the host CPU */
        nanosleep(&nap, NULL);
    }
}
