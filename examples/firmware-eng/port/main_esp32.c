/* main_esp32.c - ESP-IDF entry point for the door-lock application.
 * STATUS: compiled for the esp32 target with ESP-IDF v6.1; not run on a board (see hal_esp32.c). */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "app.h"

void app_main(void)
{
    app_init();
    for (;;) {
        app_poll();
        vTaskDelay(pdMS_TO_TICKS(10));   /* yield: lets the idle task run and feed its watchdog */
    }
}
