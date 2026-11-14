/* Step 6: push a reading to your own HTTPS endpoint.
 * Extra includes: "esp_http_client.h" and "esp_crt_bundle.h". */
static esp_err_t report_post(const char *json, int len)
{
    esp_http_client_config_t cfg = {
        .url               = CONFIG_BENCH_REPORT_URL,     /* https://... */
        .method            = HTTP_METHOD_POST,
        .timeout_ms        = 8000,
        .crt_bundle_attach = esp_crt_bundle_attach,       /* verify the server's certificate */
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (c == NULL) return ESP_FAIL;

    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_post_field(c, json, len);

    esp_err_t err = esp_http_client_perform(c);           /* blocks: call from a task */
    if (err == ESP_OK)
        ESP_LOGI(TAG, "POST -> HTTP %d", esp_http_client_get_status_code(c));
    else
        ESP_LOGW(TAG, "POST failed: %s", esp_err_to_name(err));

    esp_http_client_cleanup(c);
    return err;
}

static void report_task(void *arg)
{
    (void)arg;
    char body[96];
    while (1) {
        xEventGroupWaitBits(s_net_events, CONNECTED_BIT, pdFALSE, pdTRUE, portMAX_DELAY);
        int n = status_json(body, sizeof body,
                            (uint32_t)(esp_timer_get_time() / 1000000),
                            esp_get_free_heap_size(), 0);
        if (n > 0) report_post(body, n);
        vTaskDelay(pdMS_TO_TICKS(60 * 1000));
    }
}
/* In app_main, after http_start():
 *     if (strlen(CONFIG_BENCH_REPORT_URL) > 0)
 *         xTaskCreate(report_task, "report", 8192, NULL, 4, NULL);          */
