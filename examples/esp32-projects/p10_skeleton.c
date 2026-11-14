/* Project 10 reference skeleton. It shows the SHAPE of the firmware:
 * who owns which peripheral, what flows through which queue, where the
 * state machine runs. Every TODO is a design decision that is yours. */
#include <stdbool.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_err.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "app_logic.h"

/* One message type for everything the controller reacts to. */
typedef struct {
    app_event_t ev;
    int16_t     temp_c10;      /* valid when ev == EV_SAMPLE */
} app_msg_t;

/* What the display and the network need to know. Sent BY VALUE so the
 * receivers never touch the controller's own variables. */
typedef struct {
    alarm_state_t state;
    int16_t       temp_c10;
    bool          sensor_ok;
} view_t;

static const char *TAG = "p10";
static QueueHandle_t s_events;     /* sensor task, button task -> controller */
static QueueHandle_t s_view_ui;    /* controller -> display task  (length 1) */
static QueueHandle_t s_view_net;   /* controller -> network task  (length 1) */
static settings_t    s_cfg;        /* written only by the controller task    */

/* ---- settings in NVS ---- */
static void settings_load(settings_t *out)
{
    settings_defaults(out);
    nvs_handle_t h;
    if (nvs_open("app", NVS_READONLY, &h) != ESP_OK) return;    /* first boot */
    settings_t tmp;
    size_t len = sizeof tmp;
    if (nvs_get_blob(h, "cfg", &tmp, &len) == ESP_OK &&
        len == sizeof tmp && settings_valid(&tmp)) {
        *out = tmp;
    } else {
        ESP_LOGW(TAG, "stored settings missing or invalid, using defaults");
    }
    nvs_close(h);
}

static esp_err_t settings_save(const settings_t *in)
{
    if (!settings_valid(in)) return ESP_ERR_INVALID_ARG;
    nvs_handle_t h;
    esp_err_t err = nvs_open("app", NVS_READWRITE, &h);
    if (err != ESP_OK) return err;
    err = nvs_set_blob(h, "cfg", in, sizeof *in);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err;
}

/* ---- tasks ---- */
static void sensor_task(void *arg)
{
    (void)arg;
    /* This task is the ONLY code that touches the sensor. If the display
     * shares the I2C bus, decide now: one bus-owner task, or a mutex. */
    while (1) {
        app_msg_t m = { .ev = EV_SENSOR_ERROR };
        /* TODO: read your sensor; on success set m.ev = EV_SAMPLE and
         *       m.temp_c10. Range-check the value before you believe it. */
        xQueueSend(s_events, &m, 0);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

static void controller_task(void *arg)
{
    (void)arg;
    alarm_state_t st = AL_NORMAL;
    view_t v = { .state = st };
    app_msg_t m;
    while (1) {
        if (xQueueReceive(s_events, &m, portMAX_DELAY) != pdTRUE) continue;

        st = alarm_step(st, m.ev, m.temp_c10, &s_cfg);
        if (m.ev == EV_SAMPLE)       { v.temp_c10 = m.temp_c10; v.sensor_ok = true; }
        if (m.ev == EV_SENSOR_ERROR) { v.sensor_ok = false; }
        v.state = st;

        /* TODO: drive the alarm output from alarm_buzzer_on(st) (LEDC PWM). */
        xQueueOverwrite(s_view_ui, &v);      /* latest value wins; never blocks */
        xQueueOverwrite(s_view_net, &v);
    }
}

static void display_task(void *arg)
{
    (void)arg;
    view_t v;
    while (1) {
        if (xQueueReceive(s_view_ui, &v, portMAX_DELAY) == pdTRUE) {
            /* TODO: draw to your display. Until it exists, a serial dashboard: */
            ESP_LOGI(TAG, "state=%d temp_c10=%d sensor=%s", (int)v.state,
                     (int)v.temp_c10, v.sensor_ok ? "ok" : "FAULT");
        }
    }
}

/* TODO: button_task  - debounced press -> EV_BUTTON into s_events (project 9).
 * TODO: network_task - Wi-Fi with reconnect; every s_cfg.report_period_s take the
 *                      latest view from s_view_net and report it (project 8).
 *                      The device must keep measuring and alarming with no network. */

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    settings_load(&s_cfg);
    (void)settings_save;           /* call it from your settings UI */

    s_events   = xQueueCreate(8, sizeof(app_msg_t));
    s_view_ui  = xQueueCreate(1, sizeof(view_t));
    s_view_net = xQueueCreate(1, sizeof(view_t));
    configASSERT(s_events && s_view_ui && s_view_net);

    xTaskCreate(controller_task, "ctrl",    4096, NULL, 6, NULL);
    xTaskCreate(sensor_task,     "sensor",  4096, NULL, 5, NULL);
    xTaskCreate(display_task,    "display", 4096, NULL, 3, NULL);
}
