/* Build: gcc -Wall -Wextra -std=c11 app_logic.c app_logic_test.c -o app_logic_test */
#include "app_logic.h"
#include <assert.h>
#include <stdio.h>

int main(void)
{
    settings_t cfg;
    settings_defaults(&cfg);
    assert(settings_valid(&cfg));

    settings_t erased = { -1, -1, 0xFFFF };    /* what blank flash looks like */
    assert(!settings_valid(&erased));

    alarm_state_t st = AL_NORMAL;
    st = alarm_step(st, EV_SAMPLE, 299, &cfg);  assert(st == AL_NORMAL);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);    assert(st == AL_NORMAL);
    st = alarm_step(st, EV_SAMPLE, 300, &cfg);  assert(st == AL_ALARM);
    assert(alarm_buzzer_on(st));

    /* Hysteresis: hovering just under the threshold does not clear it. */
    st = alarm_step(st, EV_SAMPLE, 295, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_SAMPLE, 290, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_SAMPLE, 289, &cfg);  assert(st == AL_NORMAL);

    /* Silence: buzzer off, state remembered until it cools down. */
    st = alarm_step(st, EV_SAMPLE, 310, &cfg);  assert(st == AL_ALARM);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);    assert(st == AL_SILENCED);
    assert(!alarm_buzzer_on(st));
    st = alarm_step(st, EV_SAMPLE, 320, &cfg);  assert(st == AL_SILENCED);
    st = alarm_step(st, EV_SAMPLE, 200, &cfg);  assert(st == AL_NORMAL);

    /* Sensor fault from any state, recovery straight into the right state. */
    st = alarm_step(AL_SILENCED, EV_SENSOR_ERROR, 0, &cfg);  assert(st == AL_FAULT);
    st = alarm_step(st, EV_BUTTON, 0, &cfg);                 assert(st == AL_FAULT);
    st = alarm_step(st, EV_SAMPLE, 350, &cfg);               assert(st == AL_ALARM);
    st = alarm_step(AL_FAULT, EV_SAMPLE, 210, &cfg);         assert(st == AL_NORMAL);

    /* A corrupted state variable fails safe. */
    assert(alarm_step((alarm_state_t)99, EV_SAMPLE, 0, &cfg) == AL_FAULT);

    printf("app_logic: all checks passed\n");
    return 0;
}
