/* Project 7: framed UART link between two ESP32 boards. Flash the same
 * program to both; set NODE_ID to 1 on one board and 2 on the other. */
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/uart.h"
#include "esp_err.h"
#include "esp_log.h"
#include "frame.h"

#define NODE_ID      1
#define LINK_UART    UART_NUM_1
#define PIN_LINK_TX  25
#define PIN_LINK_RX  26
#define LINK_BAUD    115200

#define TYPE_PING    0x01
#define TYPE_PONG    0x02

static const char *TAG = "p7";

static void link_send(uint8_t type, const uint8_t *payload, uint8_t len)
{
    uint8_t buf[FRAME_MAX_PAYLOAD + FRAME_OVERHEAD];
    size_t n = frame_encode(type, payload, len, buf, sizeof buf);
    if (n == 0) {
        ESP_LOGE(TAG, "frame too long (%u)", (unsigned)len);
        return;
    }
    uart_write_bytes(LINK_UART, buf, n);
}

static void rx_task(void *arg)
{
    (void)arg;
    frame_parser_t fp;
    frame_parser_init(&fp);
    uint8_t chunk[64];

    while (1) {
        /* Wait up to 50 ms for bytes. A return of 0 means the line was quiet. */
        int n = uart_read_bytes(LINK_UART, chunk, sizeof chunk, pdMS_TO_TICKS(50));
        if (n <= 0) {
            frame_parser_timeout(&fp);
            continue;
        }
        for (int i = 0; i < n; i++) {
            switch (frame_parser_feed(&fp, chunk[i])) {
            case FP_FRAME:
                ESP_LOGI(TAG, "rx type=0x%02X len=%u", fp.type, (unsigned)fp.len);
                if (fp.len > 0) ESP_LOG_BUFFER_HEX(TAG, fp.payload, fp.len);
                if (fp.type == TYPE_PING)
                    link_send(TYPE_PONG, fp.payload, fp.len);   /* echo it back */
                break;
            case FP_ERR_CRC:
                ESP_LOGW(TAG, "bad CRC (total %u)", (unsigned)fp.n_bad_crc);
                break;
            case FP_ERR_LEN:
                ESP_LOGW(TAG, "bad length (total %u)", (unsigned)fp.n_bad_len);
                break;
            case FP_NONE:
                break;
            }
        }
    }
}

void app_main(void)
{
    const uart_config_t cfg = {
        .baud_rate  = LINK_BAUD,
        .data_bits  = UART_DATA_8_BITS,
        .parity     = UART_PARITY_DISABLE,
        .stop_bits  = UART_STOP_BITS_1,
        .flow_ctrl  = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };
    /* 1024-byte RX ring buffer, no TX buffer (writes block until sent to the FIFO),
     * no event queue. */
    ESP_ERROR_CHECK(uart_driver_install(LINK_UART, 1024, 0, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(LINK_UART, &cfg));
    ESP_ERROR_CHECK(uart_set_pin(LINK_UART, PIN_LINK_TX, PIN_LINK_RX,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    xTaskCreate(rx_task, "link_rx", 4096, NULL, 5, NULL);

    uint16_t seq = 0;
    while (1) {
        uint8_t payload[3] = { NODE_ID, (uint8_t)(seq >> 8), (uint8_t)seq };
        link_send(TYPE_PING, payload, sizeof payload);
        ESP_LOGI(TAG, "tx PING seq=%u", (unsigned)seq);
        seq++;
        vTaskDelay(pdMS_TO_TICKS(NODE_ID == 1 ? 1000 : 1700));
    }
}
