/* Project 8: Wi-Fi station with reconnect and a small status server. */
#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"
#include "sdkconfig.h"
#include "net_util.h"

#define CONNECTED_BIT (1 << 0)

static const char *TAG = "p8";
static EventGroupHandle_t s_net_events;
static esp_timer_handle_t s_retry_timer;
static unsigned s_attempt;

static void retry_cb(void *arg)
{
    (void)arg;
    esp_wifi_connect();              /* returns at once; result arrives as an event */
}

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const wifi_event_sta_disconnected_t *d = data;
        uint32_t wait = backoff_ms(s_attempt++);
        xEventGroupClearBits(s_net_events, CONNECTED_BIT);
        ESP_LOGW(TAG, "disconnected, reason %d, retry in %u ms",
                 (int)d->reason, (unsigned)wait);
        /* Do NOT delay here: this runs in the event loop task. Arm a timer. */
        esp_timer_start_once(s_retry_timer, (uint64_t)wait * 1000u);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *e = data;
        ESP_LOGI(TAG, "got ip " IPSTR, IP2STR(&e->ip_info.ip));
        s_attempt = 0;
        xEventGroupSetBits(s_net_events, CONNECTED_BIT);
    }
}

static void wifi_start(void)
{
    s_net_events = xEventGroupCreate();

    const esp_timer_create_args_t targs = { .callback = retry_cb, .name = "wifi_retry" };
    ESP_ERROR_CHECK(esp_timer_create(&targs, &s_retry_timer));

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL, NULL));

    wifi_config_t wc = { 0 };
    strlcpy((char *)wc.sta.ssid, CONFIG_BENCH_WIFI_SSID, sizeof wc.sta.ssid);
    strlcpy((char *)wc.sta.password, CONFIG_BENCH_WIFI_PASSWORD, sizeof wc.sta.password);
    wc.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;   /* refuse open, WEP and WPA1 */

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
    ESP_ERROR_CHECK(esp_wifi_start());                /* -> WIFI_EVENT_STA_START */
}

static esp_err_t status_get(httpd_req_t *req)
{
    char body[96];
    int rssi = 0;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) rssi = ap.rssi;

    int n = status_json(body, sizeof body,
                        (uint32_t)(esp_timer_get_time() / 1000000),
                        esp_get_free_heap_size(), rssi);
    if (n < 0) return httpd_resp_send_500(req);

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, body, n);
}

static esp_err_t root_get(httpd_req_t *req)
{
    static const char page[] =
        "<!doctype html><meta charset=utf-8><title>Bench device</title>"
        "<h1>Bench device</h1><pre id=o>loading</pre>"
        "<script>setInterval(()=>fetch('/api/status').then(r=>r.text())"
        ".then(t=>o.textContent=t),2000)</script>";
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, page, HTTPD_RESP_USE_STRLEN);
}

static void http_start(void)
{
    httpd_handle_t server = NULL;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(httpd_start(&server, &cfg));

    static const httpd_uri_t root   = { .uri = "/",           .method = HTTP_GET, .handler = root_get };
    static const httpd_uri_t status = { .uri = "/api/status", .method = HTTP_GET, .handler = status_get };
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &root));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &status));
}

void app_main(void)
{
    if (strlen(CONFIG_BENCH_WIFI_SSID) == 0) {
        ESP_LOGE(TAG, "no SSID configured: run idf.py menuconfig -> Bench project 8");
        return;
    }

    /* The Wi-Fi driver keeps calibration data in NVS. */
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);

    wifi_start();
    xEventGroupWaitBits(s_net_events, CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
    http_start();
    ESP_LOGI(TAG, "status page is up");
}
