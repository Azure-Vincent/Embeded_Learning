/* gdb_practice.c - a small hosted program with one memory-corruption bug, for
 * practising GDB commands on the host before using them on a target.
 *
 * Build: gcc -Wall -Wextra -std=c11 -g -O0 -fno-stack-protector -o gdb_practice gdb_practice.c
 * Run:   ./gdb_practice        (prints a wrong "armed" value; no compiler warning)
 * Debug: gdb -q ./gdb_practice (see README.md in this directory for a session to try)
 */
#include <stdint.h>
#include <stdio.h>
#include <string.h>

struct sensor_state {
    char    name[8];      /* 8 bytes */
    uint32_t armed;       /* sits directly after name[] in memory */
    uint32_t samples;
};

static struct sensor_state state = { "idle", 0, 0 };

static void set_name(struct sensor_state *s, const char *new_name)
{
    /* BUG: copies the terminating NUL too, and never checks the destination size. */
    memcpy(s->name, new_name, strlen(new_name) + 1);
}

static uint32_t take_samples(struct sensor_state *s, unsigned n)
{
    for (unsigned i = 0; i < n; i++) s->samples += i;
    return s->samples;
}

int main(void)
{
    take_samples(&state, 4);
    set_name(&state, "pressure-A");     /* 10 characters + NUL into an 8-byte field */
    printf("name=%.8s armed=0x%08x samples=%u\n", state.name, (unsigned)state.armed, (unsigned)state.samples);
    return state.armed ? 1 : 0;
}
