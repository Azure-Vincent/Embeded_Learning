/* hardfault: an event dispatcher that crashes after a few events. */
#include "bench.h"

typedef void (*handler_t)(void);

enum { EV_BUTTON, EV_TIMER, EV_UART, EV_COUNT };

static uint32_t presses;
static uint32_t ticks;

static void on_button(void)
{
    presses++;
}

static void on_timer(void)
{
    ticks++;
}

static handler_t handlers[EV_COUNT] = {
    [EV_BUTTON] = on_button,
    [EV_TIMER] = on_timer,
};

static const uint8_t script[5] = {EV_TIMER, EV_BUTTON, EV_TIMER, EV_UART, EV_BUTTON};

static void dispatch(uint32_t event)
{
    handler_t fn = handlers[event];
    fn();
}

int main(void)
{
    for (uint32_t i = 0; i < 5; i++) {
        dispatch(script[i]);
    }
    for (;;) {
    }
}
