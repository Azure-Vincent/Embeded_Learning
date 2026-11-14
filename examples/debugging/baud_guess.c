/* baud_guess.c - estimate a UART baud rate from pulse widths.
 *
 * Give it pulse widths in microseconds, as measured with scope or logic
 * analyser cursors. The shortest pulse is taken as one bit time; the result is
 * snapped to the nearest standard rate and the error is reported.
 *
 * Usage: ./baud_guess 104.2 208 8.7 ...
 * Build: gcc -Wall -Wextra -std=c11 -o baud_guess baud_guess.c
 */
#include <stdio.h>
#include <stdlib.h>

static const long standard[] = { 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880,
                                 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000 };

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: %s <pulse-us>...\n", argv[0]); return 2; }
    double shortest = 0;
    for (int i = 1; i < argc; i++) {
        double us = strtod(argv[i], NULL);
        if (us <= 0) { fprintf(stderr, "bad pulse width: %s\n", argv[i]); return 2; }
        if (shortest == 0 || us < shortest) shortest = us;
    }
    double raw = 1e6 / shortest;                 /* bits per second if that pulse is one bit */
    long best = standard[0];
    double best_err = 1e9;
    for (size_t i = 0; i < sizeof standard / sizeof standard[0]; i++) {
        double err = (raw - (double)standard[i]) / (double)standard[i];
        if (err < 0) err = -err;
        if (err < best_err) { best_err = err; best = standard[i]; }
    }
    printf("shortest pulse %.2f us -> %.0f bit/s raw\n", shortest, raw);
    printf("nearest standard rate %ld baud (%.1f%% away)\n", best, best_err * 100.0);
    if (best_err > 0.05)
        printf("more than 5%% off: either a non-standard rate, a mis-measured pulse, or not a UART\n");
    for (int i = 1; i < argc; i++) {
        double bits = strtod(argv[i], NULL) * (double)best / 1e6;
        printf("  %.2f us = %.2f bit times\n", strtod(argv[i], NULL), bits);
    }
    return 0;
}
