/* test.h - the smallest useful unit-test harness: count checks, report failures, exit non-zero. */
#ifndef TEST_H
#define TEST_H

#include <stdio.h>
#include <string.h>

static int t_checks, t_failures;

#define CHECK(cond) do { \
        t_checks++; \
        if (!(cond)) { t_failures++; printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); } \
    } while (0)

#define CHECK_STR(actual, expected) do { \
        t_checks++; \
        if (strcmp((actual), (expected)) != 0) { \
            t_failures++; \
            printf("  FAIL %s:%d: got \"%s\", expected \"%s\"\n", __FILE__, __LINE__, (actual), (expected)); \
        } \
    } while (0)

#define RUN(test_fn) do { test_fn(); printf("  ran %s\n", #test_fn); } while (0)

#define TEST_REPORT(name) \
    (printf("%s: %d checks, %d failures\n", (name), t_checks, t_failures), t_failures ? 1 : 0)

#endif
