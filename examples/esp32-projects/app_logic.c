#include "app_logic.h"

void settings_defaults(settings_t *s)
{
    s->alarm_on_c10    = 300;   /* 30.0 C */
    s->hysteresis_c10  = 10;    /*  1.0 C */
    s->report_period_s = 60;
}

/* Never trust what comes out of storage: a fresh chip, a half-written
 * page or an old firmware's layout can all hand you nonsense. */
bool settings_valid(const settings_t *s)
{
    return s->alarm_on_c10 >= -400 && s->alarm_on_c10 <= 1250 &&
           s->hysteresis_c10 >= 1  && s->hysteresis_c10 <= 100 &&
           s->report_period_s >= 5 && s->report_period_s <= 3600;
}

alarm_state_t alarm_step(alarm_state_t st, app_event_t ev, int16_t temp_c10,
                         const settings_t *cfg)
{
    int16_t off_below = (int16_t)(cfg->alarm_on_c10 - cfg->hysteresis_c10);

    if (ev == EV_SENSOR_ERROR) return AL_FAULT;       /* from any state */

    switch (st) {
    case AL_NORMAL:
        if (ev == EV_SAMPLE && temp_c10 >= cfg->alarm_on_c10) return AL_ALARM;
        return AL_NORMAL;

    case AL_ALARM:
        if (ev == EV_BUTTON) return AL_SILENCED;
        if (ev == EV_SAMPLE && temp_c10 < off_below) return AL_NORMAL;
        return AL_ALARM;

    case AL_SILENCED:                 /* still too hot, but acknowledged */
        if (ev == EV_SAMPLE && temp_c10 < off_below) return AL_NORMAL;
        return AL_SILENCED;

    case AL_FAULT:                    /* leave only on a good sample */
        if (ev == EV_SAMPLE)
            return temp_c10 >= cfg->alarm_on_c10 ? AL_ALARM : AL_NORMAL;
        return AL_FAULT;
    }
    return AL_FAULT;                  /* unknown state: fail safe */
}

bool alarm_buzzer_on(alarm_state_t st) { return st == AL_ALARM; }
