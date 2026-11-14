/* app_logic.h - the decisions of the device, with no hardware in them.
 * Everything here compiles and is tested on a PC. */
#ifndef APP_LOGIC_H
#define APP_LOGIC_H

#include <stdbool.h>
#include <stdint.h>

/* ---- settings (stored in NVS on the device) ---- */
typedef struct {
    int16_t  alarm_on_c10;    /* alarm threshold, tenths of a degree C   */
    int16_t  hysteresis_c10;  /* how far below it we must fall to clear  */
    uint16_t report_period_s; /* Wi-Fi report interval                   */
} settings_t;

void settings_defaults(settings_t *s);
bool settings_valid(const settings_t *s);

/* ---- alarm state machine ---- */
typedef enum { AL_NORMAL, AL_ALARM, AL_SILENCED, AL_FAULT } alarm_state_t;

typedef enum {
    EV_SAMPLE,        /* a new temperature is available (value in arg) */
    EV_SENSOR_ERROR,  /* the sensor read failed                        */
    EV_BUTTON         /* the user pressed the button                   */
} app_event_t;

alarm_state_t alarm_step(alarm_state_t st, app_event_t ev, int16_t temp_c10,
                         const settings_t *cfg);
bool          alarm_buzzer_on(alarm_state_t st);

#endif
