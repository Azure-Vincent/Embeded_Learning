/* Build: gcc -Wall -Wextra -std=c11 net_util.c net_util_test.c -o net_util_test */
#include "net_util.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void)
{
    assert(backoff_ms(0) == 1000 && backoff_ms(1) == 2000 && backoff_ms(4) == 16000);
    assert(backoff_ms(5) == 30000 && backoff_ms(1000000) == 30000);

    char buf[96];
    int n = status_json(buf, sizeof buf, 75, 201344, -61);
    assert(n == (int)strlen(buf));
    assert(strcmp(buf, "{\"uptime_s\":75,\"free_heap\":201344,\"rssi_dbm\":-61}") == 0);
    printf("%s\n", buf);

    char tiny[16];
    assert(status_json(tiny, sizeof tiny, 75, 201344, -61) == -1 && tiny[0] == '\0');
    assert(status_json(NULL, 0, 0, 0, 0) == -1);

    printf("net_util: all checks passed\n");
    return 0;
}
