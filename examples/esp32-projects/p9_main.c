/* Project 9: three tasks, a queue, a mutex, an ISR-given semaphore,
 * stack monitoring and the task watchdog. */
#include <limits.h>
#include <stdint.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_attr.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "movavg.h"

#define PIN_BUTTON   27               /* to GND when pressed; internal pull-up */
#define ADC_CH       ADC_CHANNEL_6    /* ADC1 channel 6 = GPIO34 on the original ESP32 */
#define SAMPLE_MS    100

typedef struct {
    uint32_t t_ms;
    int      raw;
} sample_t;

typedef struct {
    int      last, avg, min, max;
    uint32_t count;
    uint32_t dropped;
} stats_t;

static const char *TAG = "p9";
static QueueHandle_t     s_samples;       /* sensor -> process, holds sample_t by value */
static SemaphoreHandle_t s_button;        /* binary: given by the ISR */
static SemaphoreHandle_t s_stats_lock;    /* mutex: guards s_stats */
static stats_t           s_stats = { .min = INT_MAX, .max = INT_MIN };
static TaskHandle_t      s_h_sensor, s_h_process, s_h_report;
static adc_oneshot_unit_handle_t s_adc;

static void IRAM_ATTR button_isr(void *arg)
{
    (void)arg;
    BaseType_t woke = pdFALSE;
    xSemaphoreGiveFromISR(s_button, &woke);
    if (woke) portYIELD_FROM_ISR();       /* run the waiting task right after the ISR */
}

static void sensor_task(void *arg)
{
    (void)arg;
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    TickType_t next = xTaskGetTickCount();
    while (1) {
        sample_t s = { .t_ms = (uint32_t)(xTaskGetTickCount() * portTICK_PERIOD_MS) };
        if (adc_oneshot_read(s_adc, ADC_CH, &s.raw) == ESP_OK) {
            if (xQueueSend(s_samples, &s, 0) != pdTRUE) {      /* full: drop, do not wait */
                xSemaphoreTake(s_stats_lock, portMAX_DELAY);
                s_stats.dropped++;
                xSemaphoreGive(s_stats_lock);
            }
        }
        esp_task_wdt_reset();
        vTaskDelayUntil(&next, pdMS_TO_TICKS(SAMPLE_MS));      /* fixed period, no drift */
    }
}

static void process_task(void *arg)
{
    (void)arg;
    ESP_ERROR_CHECK(esp_task_wdt_add(NULL));
    movavg_t filter;
    movavg_init(&filter);
    sample_t s;
    while (1) {
        if (xQueueReceive(s_samples, &s, pdMS_TO_TICKS(1000)) == pdTRUE) {
            int avg = (int)movavg_push(&filter, s.raw);        /* work OUTSIDE the lock */
            xSemaphoreTake(s_stats_lock, portMAX_DELAY);
            s_stats.last = s.raw;
            s_stats.avg  = avg;
            if (s.raw < s_stats.min) s_stats.min = s.raw;
            if (s.raw > s_stats.max) s_stats.max = s.raw;
            s_stats.count++;
            xSemaphoreGive(s_stats_lock);
        } else {
            ESP_LOGW(TAG, "no samples for 1 s");
        }
        esp_task_wdt_reset();
    }
}

static void report_task(void *arg)
{
    (void)arg;
    TickType_t last_press = 0;
    while (1) {
        /* Wake on a button press, or every 2 s to print anyway. */
        BaseType_t pressed = xSemaphoreTake(s_button, pdMS_TO_TICKS(2000));
        TickType_t now = xTaskGetTickCount();
        if (pressed == pdTRUE && (now - last_press) < pdMS_TO_TICKS(200))
            continue;                                          /* contact bounce */

        stats_t snap;
        xSemaphoreTake(s_stats_lock, portMAX_DELAY);
        if (pressed == pdTRUE) {
            last_press = now;
            s_stats.min = INT_MAX;
            s_stats.max = INT_MIN;
        }
        snap = s_stats;                                        /* copy, then release */
        xSemaphoreGive(s_stats_lock);

        ESP_LOGI(TAG, "%s last=%d avg=%d min=%d max=%d n=%u dropped=%u",
                 pressed == pdTRUE ? "[reset]" : "[tick] ",
                 snap.last, snap.avg, snap.min, snap.max,
                 (unsigned)snap.count, (unsigned)snap.dropped);
        ESP_LOGI(TAG, "stack free (bytes): sensor=%u process=%u report=%u",
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_sensor),
                 (unsigned)uxTaskGetStackHighWaterMark(s_h_process),
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
    }
}

void app_main(void)
{
    s_samples    = xQueueCreate(8, sizeof(sample_t));
    s_button     = xSemaphoreCreateBinary();
    s_stats_lock = xSemaphoreCreateMutex();
    configASSERT(s_samples && s_button && s_stats_lock);

    adc_oneshot_unit_init_cfg_t unit = { .unit_id = ADC_UNIT_1 };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit, &s_adc));
    adc_oneshot_chan_cfg_t chan = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(s_adc, ADC_CH, &chan));

    const gpio_config_t btn = {
        .pin_bit_mask = 1ULL << PIN_BUTTON,
        .mode         = GPIO_MODE_INPUT,
        .pull_up_en   = GPIO_PULLUP_ENABLE,
        .intr_type    = GPIO_INTR_NEGEDGE,
    };
    ESP_ERROR_CHECK(gpio_config(&btn));
    ESP_ERROR_CHECK(gpio_install_isr_service(0));
    ESP_ERROR_CHECK(gpio_isr_handler_add(PIN_BUTTON, button_isr, NULL));

    /* Stack sizes are in bytes in ESP-IDF. Higher number = higher priority. */
    xTaskCreate(sensor_task,  "sensor",  3072, NULL, 6, &s_h_sensor);
    xTaskCreate(process_task, "process", 3072, NULL, 5, &s_h_process);
    xTaskCreate(report_task,  "report",  4096, NULL, 4, &s_h_report);
}
