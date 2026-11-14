#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <string.h>
#include <stdio.h>

/* a + b without wraparound. Returns false and leaves *sum alone on overflow. */
static bool size_add(size_t a, size_t b, size_t *sum)
{
    if (a > SIZE_MAX - b) return false;
    *sum = a + b;
    return true;
}

/* a * b without wraparound. */
static bool size_mul(size_t a, size_t b, size_t *prod)
{
    if (b != 0 && a > SIZE_MAX / b) return false;
    *prod = a * b;
    return true;
}

typedef enum { REC_OK, REC_ERR_ARG, REC_ERR_SIZE } rec_result_t;

/* Copy 'count' fixed-size records that start 'offset' bytes into a message
 * of 'msg_len' bytes into 'dst' (capacity 'dst_cap' bytes).
 * count, rec_size and offset all come from the message: none is trusted. */
static rec_result_t copy_records(uint8_t *dst, size_t dst_cap,
                                 const uint8_t *msg, size_t msg_len,
                                 size_t offset, size_t count, size_t rec_size)
{
    size_t total, end;
    if (dst == NULL || msg == NULL) return REC_ERR_ARG;
    if (!size_mul(count, rec_size, &total)) return REC_ERR_SIZE;
    if (!size_add(offset, total, &end)) return REC_ERR_SIZE;
    if (end > msg_len) return REC_ERR_SIZE;       /* would read past the message */
    if (total > dst_cap) return REC_ERR_SIZE;     /* would write past dst */
    memcpy(dst, msg + offset, total);
    return REC_OK;
}

static int failures;
static void check(const char *name, bool ok)
{
    printf("%-44s %s\n", name, ok ? "ok" : "FAIL");
    if (!ok) failures++;
}

int main(void)
{
    uint8_t msg[32], dst[16];
    for (size_t i = 0; i < sizeof msg; i++) msg[i] = (uint8_t)i;
    size_t r;

    check("add in range", size_add(10, 20, &r) && r == 30);
    check("add overflow detected", !size_add(SIZE_MAX, 1, &r));
    check("mul in range", size_mul(4, 8, &r) && r == 32);
    check("mul overflow detected", !size_mul(SIZE_MAX / 2 + 1, 2, &r));
    check("mul by zero is fine", size_mul(SIZE_MAX, 0, &r) && r == 0);

    check("3 records of 4 bytes copied",
          copy_records(dst, sizeof dst, msg, sizeof msg, 4, 3, 4) == REC_OK && dst[0] == 4 && dst[11] == 15);
    check("read past message rejected",
          copy_records(dst, sizeof dst, msg, sizeof msg, 28, 2, 4) == REC_ERR_SIZE);
    check("write past destination rejected",
          copy_records(dst, sizeof dst, msg, sizeof msg, 0, 5, 4) == REC_ERR_SIZE);
    check("count * size wraparound rejected",
          copy_records(dst, sizeof dst, msg, sizeof msg, 0, SIZE_MAX / 4 + 1, 4) == REC_ERR_SIZE);
    check("offset + total wraparound rejected",
          copy_records(dst, sizeof dst, msg, sizeof msg, SIZE_MAX - 3, 1, 8) == REC_ERR_SIZE);
    check("NULL rejected", copy_records(NULL, 16, msg, sizeof msg, 0, 1, 1) == REC_ERR_ARG);

    printf("%s\n", failures ? "FAILED" : "all tests passed");
    return failures ? 1 : 0;
}
