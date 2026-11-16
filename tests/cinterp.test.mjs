// Tests for js/sim/cinterp.js, the Bench-MCU C interpreter. Run: node --test tests/cinterp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, runTest, layoutOf, layoutStruct, REGISTERS } from '../js/sim/cinterp.js';

const main = (body, pre = '') => `#include <stdio.h>\n#include <stdint.h>\n#include <string.h>\n${pre}\nint main(void) {\n${body}\nreturn 0;\n}\n`;
const out = (src, opts) => { const r = run(src, opts); assert.deepEqual(r.errors, [], 'unexpected error'); return r.stdout; };
const hasWarn = (r, re) => r.warnings.some((w) => re.test(w.msg));

// ---------------------------------------------------------------- basics
test('hello world, exit code, step count', () => {
  const r = run('#include <stdio.h>\nint main(void) { printf("Hello, bench\\n"); return 7; }');
  assert.equal(r.ok, true); assert.equal(r.stdout, 'Hello, bench\n'); assert.equal(r.exit, 7); assert.ok(r.steps > 0);
});
test('sizes follow ILP32', () => {
  assert.equal(out(main('printf("%u %u %u %u %u %u %u", (unsigned)sizeof(char), (unsigned)sizeof(short), (unsigned)sizeof(int), (unsigned)sizeof(long), (unsigned)sizeof(long long), (unsigned)sizeof(void *), (unsigned)sizeof(size_t));')), '1 2 4 4 8 4 4');
});
test('printf formats: width, zero pad, left, hex, char, string, percent, lengths', () => {
  assert.equal(out(main('printf("[%5d][%-5d][%05d][%x][%X][%08x][%c][%s][%%][%u]\\n", 42, 42, 42, 255, 255, 0xBEEF, 65, "ok", 4000000000u);')), '[   42][42   ][00042][ff][FF][0000beef][A][ok][%][4000000000]\n');
  assert.equal(out(main('long long big = -5000000000LL; unsigned char c = 200; printf("%lld %llu %hhd %hu %ld %lu %i", big, 18446744073709551615ULL, (signed char)c, (unsigned short)70000, -3L, 7UL, -9);')), '-5000000000 18446744073709551615 -56 4464 -3 7 -9');
  assert.equal(out(main('printf("%.3s|%10s|%-6s|%#x|%+d|%3c|", "abcdef", "hi", "ab", 255, 5, 90);')), 'abc|        hi|ab    |0xff|+5|  Z|');
});
test('%p prints an 8-digit address in SRAM for a local and in flash for a function', () => {
  const s = out(main('int x; printf("%p %p", (void *)&x, (void *)main);'));
  assert.match(s, /^0x2000f[0-9a-f]{3} 0x08000[0-9a-f]{3}$/);
});
test('putchar, puts, getchar read stdin until EOF', () => {
  assert.equal(out(main('int c; while ((c = getchar()) != EOF) putchar(c >= \'a\' && c <= \'z\' ? c - 32 : c); puts("!");'), { stdin: 'abc d' }), 'ABC D!\n');
});

// ---------------------------------------------------------------- integer semantics
test('uint8_t overflow wraps, int8_t wraps to negative', () => {
  assert.equal(out(main('uint8_t a = 250; a += 10; int8_t b = 127; b++; uint16_t c = 65535; c++; printf("%d %d %d", a, b, c);')), '4 -128 0');
});
test('integer promotion: uint8_t operands are computed as int', () => {
  assert.equal(out(main('uint8_t a = 200, b = 100; int s = a + b; uint8_t t = a + b; printf("%d %d %d", s, t, (uint8_t)~a);')), '300 44 55');
});
test('char is signed', () => {
  assert.equal(out(main('char c = (char)0x80; unsigned char u = 0x80; printf("%d %d %d", c, u, c < 0);')), '-128 128 1');
});
test('unsigned wraparound and subtraction below zero', () => {
  assert.equal(out(main('uint32_t a = 0; a--; uint32_t b = 3u - 5u; printf("%u %u %u", a, b, 0xFFFFFFFFu + 2u);')), '4294967295 4294967294 1');
});
test('signed/unsigned comparison pitfall: -1 < 1u is false, and it is flagged', () => {
  const r = run(main('int i = -1; unsigned u = 1; if (i < u) printf("less"); else printf("not less");'));
  assert.equal(r.stdout, 'not less');
  assert.ok(hasWarn(r, /signed and unsigned.*-1.*4294967295/));
});
test('signed overflow wraps and is flagged with the line', () => {
  const r = run(main('int x = 2147483647;\nx = x + 1;\nprintf("%d", x);'));
  assert.equal(r.stdout, '-2147483648');
  const w = r.warnings.find((v) => /signed integer overflow/.test(v.msg));
  assert.ok(w); assert.equal(w.line, 7);
});
test('division and modulo truncate toward zero; division by zero faults', () => {
  assert.equal(out(main('printf("%d %d %d %d %u", -7 / 2, -7 % 2, 7 / -2, 7 % -2, 7u / 2u);')), '-3 -1 -3 1 3');
  const r = run(main('int z = 0;\nprintf("%d", 5 / z);'));
  assert.equal(r.ok, false); assert.match(r.errors[0].msg, /division by zero/); assert.equal(r.errors[0].line, 7);
});
test('shifts: logical for unsigned, arithmetic for signed, count >= width flagged', () => {
  assert.equal(out(main('int n = -16; unsigned u = 0x80000000u; printf("%d %u %u %d", n >> 2, u >> 31, 1u << 31, 1 << 4);')), '-4 1 2147483648 16');
  const r = run(main('unsigned s = 32;\nprintf("%u", 1u << s);'));
  assert.equal(r.ok, false); assert.equal(r.errors[0].line, 7);
  assert.match(r.errors[0].msg, /undefined behaviour: shift count 32 >= width 32/);
  assert.match(run(main('int n = -1; printf("%d", 8 >> n);')).errors[0].msg, /undefined behaviour: shift count -1 is negative/);
  assert.match(run(main('uint8_t b = 1; int n = 40; printf("%d", b << n);')).errors[0].msg, /shift count 40 >= width 32/); // uint8_t promotes to int
  assert.match(run(main('uint64_t q = 1; int n = 64; q <<= n;')).errors[0].msg, /shift count 64 >= width 64/);
  assert.equal(out(main('uint64_t q = 1; int n = 63; q <<= n; printf("%llx %u", q, 1u << 31 >> 31);')), '8000000000000000 1');
  assert.ok(hasWarn(run(main('printf("%d", 1 << 31);')), /left shift overflows a signed int/));
});
test('truncation on assignment to narrower types and sign extension on widening', () => {
  assert.equal(out(main('int big = 0x12345678; uint8_t lo = big; uint16_t mid = big; int8_t neg = 0xF0; int wide = neg; uint32_t uw = (uint32_t)neg; printf("%x %x %d %x", lo, mid, wide, uw);')), '78 5678 -16 fffffff0');
});
test('64-bit arithmetic', () => {
  assert.equal(out(main('uint64_t a = 1; a <<= 40; uint64_t b = 0xFFFFFFFFu; b = b * b; int64_t c = -1; printf("%llu %llx %lld %llu", a, b, c >> 3, (uint64_t)(uint32_t)-1 + 1);')), '1099511627776 fffffffe00000001 -1 4294967296');
});
test('usual arithmetic conversions pick unsigned at equal rank, int below it', () => {
  assert.equal(out(main('unsigned u = 10; int i = -20; uint16_t h = 10; printf("%d %d", (u + i) > 0, (h + i) > 0);')), '1 0');
});
test('bitwise operators, compound assignment, ternary, comma, logical short circuit', () => {
  assert.equal(out(main('unsigned r = 0xF0; r |= 0x0F; r &= ~0x18u; r ^= 0x100; int n = 0; int t = (n && ++n) || (n == 0 ? 5 : 6); int c = (n++, n + 10); printf("%X %d %d %d", r, t, n, c);')), '1E7 1 1 11');
});
test('pre/post increment and operator precedence', () => {
  assert.equal(out(main('int a = 5; int b = a++ * 2; int c = ++a * 2; int d = 2 + 3 * 4 - 8 / 2 % 3; printf("%d %d %d %d", a, b, c, d);')), '7 10 14 13');
});
test('bool converts any non-zero value to 1', () => {
  assert.equal(out(main('bool b = 0x100; bool c = 0; printf("%d %d %u", b, c, (unsigned)sizeof(bool));', '#include <stdbool.h>')), '1 0 1');
});
test('integer constants: hex, octal, binary, char escapes, suffixes', () => {
  assert.equal(out(main('printf("%d %d %d %d %d %u %u", 0x1F, 017, 0b101, \'\\n\', \'\\x41\', (unsigned)sizeof(1), (unsigned)sizeof(1LL));')), '31 15 5 10 65 4 8');
});

// ---------------------------------------------------------------- control flow
test('loops: for, while, do-while, break, continue, nested', () => {
  assert.equal(out(main('int s = 0; for (int i = 0; i < 10; i++) { if (i == 3) continue; if (i == 7) break; s += i; } int w = 0; while (w < 5) w += 2; int d = 10; do { d--; } while (d > 20); printf("%d %d %d", s, w, d);')), '18 6 9');
});
test('switch: fallthrough, default, break', () => {
  const src = main('for (int i = 0; i < 5; i++) { switch (i) { case 0: printf("zero "); case 1: printf("one "); break; case 3: printf("three "); break; default: printf("other "); } }');
  assert.equal(out(src), 'zero one one other three other ');
});
test('recursion: factorial and fibonacci', () => {
  assert.equal(out(main('printf("%d %d", fact(10), fib(15));', 'int fib(int n);\nint fact(int n) { return n <= 1 ? 1 : n * fact(n - 1); }\nint fib(int n) { if (n < 2) return n; return fib(n - 1) + fib(n - 2); }')), '3628800 610');
});
test('runaway recursion ends with a stack overflow, not a hang', () => {
  const r = run(main('return down(1);', 'int down(int n) { int pad[16]; pad[0] = n; return down(n + 1) + pad[0]; }'));
  assert.equal(r.ok, false); assert.match(r.errors[0].msg, /stack overflow/);
});
test('infinite loop terminates with a clear message and line', () => {
  const r = run(main('int x = 0;\nwhile (1) { x++; }'));
  assert.equal(r.ok, false); assert.equal(r.stopped, 'limit');
  assert.match(r.errors[0].msg, /infinite loop/); assert.ok(r.errors[0].line >= 6);
  assert.equal(run(main('for(;;);'), { maxSteps: 5000 }).steps, 5001);
});
test('exit() stops the program with that code', () => {
  const r = run(main('printf("a"); exit(3); printf("b");'));
  assert.equal(r.stdout, 'a'); assert.equal(r.exit, 3); assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- pointers and arrays
test('pointer arithmetic scales by the pointed-to type', () => {
  const s = out(main('uint8_t b[16]; uint16_t *h = (uint16_t *)b; uint32_t *w = (uint32_t *)b; struct { int a; char c; } *sp = (void *)b; long long *q = (long long *)b;\nprintf("%d %d %d %d %d", (int)((uint8_t *)(b + 1) - b), (int)((uint8_t *)(h + 1) - b), (int)((uint8_t *)(w + 1) - b), (int)((uint8_t *)(sp + 1) - b), (int)((uint8_t *)(q + 2) - b));'));
  assert.equal(s, '1 2 4 8 16');
});
test('pointer difference, comparison, indexing and *(p + i) agree', () => {
  assert.equal(out(main('int a[5] = {10, 20, 30, 40, 50}; int *p = a + 1, *q = &a[4]; printf("%d %d %d %d %d %d", (int)(q - p), *(p + 2), p[2], 2[p], p < q, *--q);')), '3 40 40 40 1 40');
});
test('sizeof(array) vs sizeof(pointer), and the array-parameter trap is flagged', () => {
  const r = run(main('int a[10]; int *p = a; printf("%u %u %u %u", (unsigned)sizeof(a), (unsigned)sizeof(p), (unsigned)(sizeof(a) / sizeof(a[0])), (unsigned)len(a));', 'unsigned len(int v[]) { return sizeof(v) / sizeof(v[0]); }'));
  assert.equal(r.stdout, '40 4 10 1');
  assert.ok(hasWarn(r, /size of a pointer/));
});
test('pointer to pointer and swapping through pointers', () => {
  assert.equal(out(main('int a = 1, b = 2; int *pa = &a; int **pp = &pa; swap(&a, &b); **pp += 40; printf("%d %d", a, b);', 'void swap(int *x, int *y) { int t = *x; *x = *y; *y = t; }')), '42 1');
});
test('2D arrays and array of strings', () => {
  assert.equal(out(main('int m[2][3] = {{1, 2, 3}, {4, 5, 6}}; const char *names[] = {"red", "green", "blue"}; int s = 0; for (int i = 0; i < 2; i++) for (int j = 0; j < 3; j++) s += m[i][j] * (i + 1); printf("%d %u %s %c", s, (unsigned)sizeof(m), names[1], names[2][0]);')), '36 24 green b');
});
test('casting a pointer shows little-endian byte order', () => {
  assert.equal(out(main('uint32_t v = 0x11223344; uint8_t *p = (uint8_t *)&v; printf("%02x %02x %02x %02x", p[0], p[1], p[2], p[3]); *(uint16_t *)(p + 2) = 0xBEEF; printf(" %08x", v);')), '44 33 22 11 beef3344');
});
test('union type punning shows little-endian layout', () => {
  assert.equal(out(main('union { uint32_t w; uint16_t h[2]; uint8_t b[4]; } u; u.w = 0xDEADBEEF; printf("%x %x %x %x %u", u.b[0], u.b[3], u.h[0], u.h[1], (unsigned)sizeof(u));')), 'ef de beef dead 4');
});
test('NULL dereference is a bus fault with the line and a hint', () => {
  const r = run(main('int *p = NULL;\n*p = 5;'));
  assert.equal(r.ok, false); assert.equal(r.errors[0].line, 7);
  assert.match(r.errors[0].msg, /bus fault writing 4 bytes at 0x00000000.*NULL/);
  assert.match(run(main('struct N { int a; int b; }; struct N *n = 0; printf("%d", n->b);')).errors[0].msg, /bus fault reading 4 bytes at 0x00000004.*NULL plus 4/);
});
test('reading an unmapped address faults', () => {
  const r = run(main('volatile uint32_t *p = (volatile uint32_t *)0x50000000; uint32_t v = *p; (void)v;'));
  assert.match(r.errors[0].msg, /bus fault reading 4 bytes at 0x50000000/);
});
test('writing to a string literal or const global faults: flash is read-only', () => {
  const r = run(main('char *s = "hello";\ns[0] = \'H\';'));
  assert.match(r.errors[0].msg, /bus fault writing 1 byte at 0x0800.*read-only/);
  const r2 = run(main('int *p = (int *)&limit; *p = 5;', 'const int limit = 10;'));
  assert.match(r2.errors[0].msg, /bus fault writing 4 bytes at 0x0800/);
});
test('assigning to a const variable is a compile error', () => {
  const r = run(main('const int k = 3;\nk = 4;'));
  assert.equal(r.stopped, 'compile'); assert.equal(r.errors[0].line, 7); assert.match(r.errors[0].msg, /const/);
});
test('function pointers: tables, callbacks, typedef', () => {
  const pre = 'typedef int (*op_t)(int, int);\nint add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\nint apply(op_t f, int a, int b) { return f(a, b); }';
  assert.equal(out(main('op_t ops[2] = {add, &mul}; int (*g)(int, int) = ops[1]; printf("%d %d %d %d", ops[0](2, 3), (*g)(2, 3), apply(add, 10, 5), g == mul);', pre)), '5 6 15 1');
});
test('calling through a NULL or bogus function pointer faults', () => {
  assert.match(run(main('void (*f)(void) = 0; f();')).errors[0].msg, /NULL function pointer/);
  assert.match(run(main('void (*f)(void) = (void (*)(void))0x20000000; f();')).errors[0].msg, /not the address of a function/);
});

// ---------------------------------------------------------------- structs
test('struct layout: padding, sizeof, offsetof on the 32-bit ABI', () => {
  const pre = 'struct A { char c; int i; short s; };\nstruct B { int i; short s; char c; };\nstruct C { char c; long long q; char d; };\nstruct D { uint8_t a; uint16_t b; uint8_t c; uint32_t d; };';
  assert.equal(out(main('printf("%u %u %u | %u %u | %u %u %u | %u %u %u %u", (unsigned)sizeof(struct A), (unsigned)offsetof(struct A, i), (unsigned)offsetof(struct A, s), (unsigned)sizeof(struct B), (unsigned)offsetof(struct B, c), (unsigned)sizeof(struct C), (unsigned)offsetof(struct C, q), (unsigned)offsetof(struct C, d), (unsigned)sizeof(struct D), (unsigned)offsetof(struct D, b), (unsigned)offsetof(struct D, c), (unsigned)offsetof(struct D, d));', '#include <stddef.h>\n' + pre)), '12 4 8 | 8 6 | 24 8 16 | 12 2 4 8');
});
test('packed struct has no padding', () => {
  assert.equal(out(main('printf("%u %u", (unsigned)sizeof(struct P), (unsigned)offsetof(struct P, i));', 'struct __attribute__((packed)) P { char c; int i; short s; };')), '7 1');
});
test('struct members, ->, nested structs, struct assignment copies', () => {
  const pre = 'typedef struct { int x, y; } point_t;\ntypedef struct { point_t a, b; char tag[4]; } line_t;';
  assert.equal(out(main('line_t l = {{1, 2}, {3, 4}, "ab"}; line_t m = l; line_t *p = &m; p->b.y = 40; m.tag[0] = \'z\'; printf("%d %d %d %s %s %u", l.b.y, m.b.y, p->a.x, l.tag, p->tag, (unsigned)sizeof(line_t));', pre)), '4 40 1 ab zb 20');
});
test('struct passed and returned by value does not alias the original', () => {
  const pre = 'struct V { int x; int y; };\nstruct V bump(struct V v) { v.x += 100; return v; }';
  assert.equal(out(main('struct V a = {1, 2}; struct V b = bump(a); printf("%d %d %d %d", a.x, b.x, b.y, bump(b).x);', pre)), '1 101 2 201');
});
test('designated initialisers and zero fill of the rest', () => {
  assert.equal(out(main('struct S { int a; int b; int c; } s = {.c = 3, .a = 1}; int v[6] = {[4] = 9, 1}; int z[4] = {7}; printf("%d %d %d | %d %d %d | %d %d", s.a, s.b, s.c, v[0], v[4], v[5], z[0], z[3]);')), '1 0 3 | 0 9 1 | 7 0');
});
test('linked list on the stack through self-referential struct pointers', () => {
  const pre = 'struct node { int v; struct node *next; };';
  assert.equal(out(main('struct node c = {3, NULL}, b = {2, &c}, a = {1, &b}; int s = 0; for (struct node *n = &a; n; n = n->next) s = s * 10 + n->v; printf("%d", s);', pre)), '123');
});
test('enum values and typedef', () => {
  assert.equal(out(main('state_t s = RUN; s++; printf("%d %d %d %d", IDLE, RUN, s == DONE, ERR);', 'typedef enum { IDLE, RUN, DONE = 2, ERR = -1 } state_t;')), '0 1 1 -1');
});
test('struct overlay on a peripheral base address', () => {
  const pre = 'typedef struct { volatile uint32_t DIR, OUT, IN, SET, CLR, TOGGLE, PULLUP; } gpio_t;\n#define GPIO ((gpio_t *)GPIO_BASE)';
  const r = run(main('GPIO->DIR = 0xFF; GPIO->SET = 0x81; GPIO->TOGGLE = 0x03; printf("%x", GPIO->OUT);', pre));
  assert.equal(r.stdout, '82'); assert.equal(r.regs.GPIO_OUT, 0x82); assert.equal(r.regs.GPIO_DIR, 0xFF);
});

// ---------------------------------------------------------------- globals, statics, memory map
test('globals: .data and .bss in SRAM, const and strings in flash, statics keep state', () => {
  const pre = 'int counter = 5;\nint zeroed[4];\nconst uint8_t table[4] = {1, 2, 3, 4};\nstatic const char *msg = "hi";\nint next(void) { static int n = 100; return n++; }';
  const r = run(main('next(); next(); printf("%d %d %d %s %d", counter, zeroed[3], table[2], msg, next());', pre));
  assert.equal(r.stdout, '5 0 3 hi 102');
  assert.equal(r.symbol('counter').addr, 0x20000000);
  assert.equal(r.symbol('counter').section, 'data');
  assert.equal(r.symbol('zeroed').section, 'bss');
  assert.ok(r.symbol('zeroed').addr > r.symbol('counter').addr);
  assert.equal(r.symbol('table').addr >>> 16, 0x0800);
  assert.equal(r.readMem(r.symbol('table').addr, 4), 0x04030201);
  assert.equal(r.symbol('main').addr >>> 16, 0x0800);
  assert.equal(r.symbol('nope'), null);
  assert.equal(r.globals.find((g) => g.name === 'counter').value, '5');
});
test('uninitialised locals hold leftover stack bytes from an earlier call', () => {
  const pre = 'void dirty(void) { int secret = 0x5EC2E7; (void)secret; }\nint peek(void) { int x; return x; }';
  assert.equal(out(main('dirty(); printf("%x", peek());', pre)), '5ec2e7');
});
test('locals live on a downward-growing stack below 0x20010000', () => {
  const r = run(main('int a; printf("%d %d", addr_of_local() < (uint32_t)&a, (uint32_t)&a < 0x20010000u && (uint32_t)&a > 0x2000FF00u);', 'uint32_t addr_of_local(void) { int deeper; return (uint32_t)&deeper; }'));
  assert.equal(r.stdout, '1 1');
});

// ---------------------------------------------------------------- stack corruption
test('stack buffer overflow corrupts the adjacent local', () => {
  const src = main('int authenticated = 0;\nchar buf[8];\nstrcpy(buf, "AAAAAAAAB");\nprintf("%d", authenticated);');
  assert.equal(out(src), '66');
});
test('overflow by index walks into the neighbouring variable byte by byte', () => {
  assert.equal(out(main('uint32_t guard = 0; uint8_t buf[4]; for (int i = 0; i < 6; i++) buf[i] = 0xAA; printf("%08x", guard);')), '0000aaaa');
});
test('overwritten return address is reported when the function returns', () => {
  const pre = 'void victim(const char *s) {\n  char buf[8];\n  strcpy(buf, s);\n}';
  const r = run(main('victim("AAAAAAAABBBBCCCC");\nprintf("never");', pre));
  assert.equal(r.ok, false); assert.equal(r.stdout, '');
  assert.match(r.errors[0].msg, /'victim' tried to return to 0x43434343.*return address/);
  const r2 = run(main('victim("AAAAAAAABBBB");\nprintf("still here");', pre)); // only the saved frame pointer (and a NUL into the return address low byte)
  assert.equal(r2.ok, false);
});
test('saved frame pointer overwrite alone is flagged but the function still returns', () => {
  const pre = 'void victim(void) {\n  char buf[8];\n  memset(buf, 0x41, 12);\n}';
  const r = run(main('victim();\nprintf("back");', pre));
  assert.equal(r.stdout, 'back'); assert.ok(hasWarn(r, /saved frame pointer.*victim/));
});
test('return address overwritten with another function address continues there', () => {
  const pre = 'void unlock(void) { printf("UNLOCKED\\n"); exit(0); }\nvoid check(void) {\n  char buf[8];\n  gets(buf);\n}';
  const probe = run(main('check();', pre));
  const a = probe.symbol('unlock').addr;
  const payload = 'A'.repeat(12) + String.fromCharCode(a & 255, (a >> 8) & 255, (a >> 16) & 255, (a >> 24) & 255) + '\n';
  const r = run(main('check();\nprintf("normal return\\n");', pre), { stdin: payload });
  assert.equal(r.stdout, 'UNLOCKED\n'); assert.equal(r.exit, 0);
  assert.deepEqual(r.hijacks, [{ from: 'check', to: 'unlock' }]);
  assert.ok(hasWarn(r, /return address of 'check' was overwritten.*'unlock'/));
  assert.equal(run(main('check();\nprintf("normal return\\n");', pre), { stdin: 'short\n' }).stdout, 'normal return\n');
});
test('a hijacked function that returns crashes afterwards', () => {
  const pre = 'void win(void) { printf("win "); }\nvoid check(void) {\n  uint32_t buf[2];\n  buf[3] = (uint32_t)win;\n}';
  const r = run(main('check();', pre));
  assert.equal(r.stdout, 'win '); assert.equal(r.ok, false); assert.match(r.errors[0].msg, /hijacked return/);
});
test('frames snapshot at a breakpoint lists locals, parameters and the return address', () => {
  const src = '#include <stdio.h>\nint leaf(int n) {\n  char buf[4] = "abc";\n  int local = n * 2;\n  return local + buf[0];\n}\nint main(void) {\n  int x = leaf(21);\n  return x;\n}\n';
  const r = run(src, { breakLine: 5 });
  assert.equal(r.stopped, 'break'); assert.equal(r.ok, true);
  assert.deepEqual(r.frames.map((f) => f.func), ['leaf', 'main']);
  const f = r.frames[0];
  assert.equal(f.locals.find((l) => l.name === 'local').value, '42 (0x2A)');
  assert.equal(f.locals.find((l) => l.name === 'buf').value, '"abc\\0"');
  assert.equal(f.params[0].value, '21 (0x15)');
  assert.equal(f.retSym, 'main');
  assert.equal(f.params[0].addr, f.fp + 8);
  assert.ok(f.locals[0].addr < f.fp);
});

// ---------------------------------------------------------------- library
test('string functions', () => {
  assert.equal(out(main('char a[16] = "abc", b[16]; strcpy(b, a); strcat(b, "def"); char n[8]; strncpy(n, "xy", sizeof n); printf("%u %s %d %d %d %d %d %s %s", (unsigned)strlen(b), b, strcmp(a, "abc"), strcmp(a, "abd") < 0, strcmp("b", "a") > 0, strncmp("abcX", "abcY", 3), n[7], strchr(b, \'d\'), strstr(b, "cd"));')), '6 abcdef 0 1 1 0 0 def cdef');
});
test('memory functions', () => {
  assert.equal(out(main('uint8_t a[8] = {1, 2, 3, 4, 5, 6, 7, 8}, b[8]; memset(b, 0xEE, sizeof b); memcpy(b, a, 4); memmove(a + 2, a, 4); printf("%d %x %d %d %d %d", b[3], b[4], a[2], a[5], memcmp(a, b, 2), memcmp(b, a, 8) != 0);')), '4 ee 1 4 0 1');
});
test('a user-written strlen replaces the library one', () => {
  assert.equal(out(main('printf("%u", (unsigned)strlen("four"));', 'size_t strlen(const char *s) { size_t n = 0; while (s[n]) n++; return n + 100; }')), '104');
});
test('malloc, free, reuse, heap lives above the globals', () => {
  const r = run(main('int *p = malloc(4 * sizeof(int)); for (int i = 0; i < 4; i++) p[i] = i * i; int s = p[3] + p[2]; uint32_t first = (uint32_t)p; free(p); int *q = malloc(16); printf("%d %d %d", s, first >= 0x20000000u && first < 0x20001000u, (uint32_t)q == first); free(q);'));
  assert.equal(r.stdout, '13 1 1'); assert.deepEqual(r.warnings, []);
});
test('use after free reads stale data and is flagged', () => {
  const r = run(main('int *p = malloc(sizeof(int));\n*p = 1234;\nfree(p);\nprintf("%d", *p);'));
  assert.equal(r.stdout, '1234'); assert.equal(r.ok, true);
  const w = r.warnings.find((v) => /use after free/.test(v.msg));
  assert.ok(w); assert.equal(w.line, 9); assert.match(w.msg, /freed on line 8/);
});
test('double free and heap overflow are caught', () => {
  assert.match(run(main('char *p = malloc(8); free(p); free(p);')).errors[0].msg, /double free/);
  assert.ok(hasWarn(run(main('char *p = malloc(8); p[8] = 1; free(p);')), /heap overflow/));
  assert.equal(out(main('void *p = malloc(100000); printf("%d", p == NULL);')), '1');
});
test('abs, atoi, sprintf, snprintf, ctype', () => {
  assert.equal(out(main('char b[32]; int n = sprintf(b, "%d-%s", 12, "x"); char s[4]; snprintf(s, sizeof s, "%d", 123456); printf("%d %d %s %d %s %d%d%d %c", abs(-5), atoi(" -42x"), b, n, s, isdigit(\'7\'), isalpha(\'7\'), isspace(\' \'), toupper(\'q\'));', '#include <ctype.h>')), '5 -42 12-x 4 123 101 Q');
});
test('assert failure stops with the expression', () => {
  assert.match(run(main('int x = 3; assert(x == 4);')).errors[0].msg, /assertion failed: x == 4/);
});

// ---------------------------------------------------------------- preprocessor
test('object-like and function-like macros, nesting, stringify and paste', () => {
  const pre = '#define N 4\n#define SQ(x) ((x) * (x))\n#define BIT(n) (1u << (n))\n#define MAX(a, b) ((a) > (b) ? (a) : (b))\n#define STR(x) #x\n#define CAT(a, b) a##b\n#define MULTI(a) do { total += (a); \\\n  total += 1; } while (0)';
  assert.equal(out(main('int total = 0; int xy = 9; MULTI(5); printf("%d %d %u %d %s %d %d", N, SQ(N + 1), BIT(3) | BIT(0), MAX(SQ(2), N + 1), STR(a + b), CAT(x, y), total);', pre)), '4 25 9 5 a + b 9 6');
});
test('conditional compilation: #if 0, #ifdef, #ifndef, #else, #elif, defined()', () => {
  const pre = '#define DEBUG\n#define LEVEL 2\n#if 0\nthis is not C at all\n#endif\n#ifdef DEBUG\n#define A 1\n#else\n#define A 2\n#endif\n#ifndef NOPE\n#define B 3\n#endif\n#if LEVEL > 2\n#define C 10\n#elif LEVEL == 2 && defined(DEBUG)\n#define C 20\n#else\n#define C 30\n#endif';
  assert.equal(out(main('printf("%d %d %d", A, B, C);', pre)), '1 3 20');
});
test('the predefined header can be redefined by the exercise', () => {
  const src = '#define GPIO_OUT (*(volatile uint32_t *)0x40000004)\n#define MY_DIR (*(volatile unsigned int *)(0x40000000u))\ntypedef unsigned char uint8_t;\nint main(void) { MY_DIR = 3; GPIO_OUT = 2; return 0; }';
  const r = run(src);
  assert.deepEqual(r.errors, []); assert.equal(r.regs.GPIO_OUT, 2); assert.equal(r.regs.GPIO_DIR, 3);
});

// ---------------------------------------------------------------- GPIO
test('GPIO registers through volatile uint32_t pointers: set, clear, toggle bits', () => {
  const src = main('volatile uint32_t *dir = (volatile uint32_t *)0x40000000;\nvolatile uint32_t *out = (volatile uint32_t *)0x40000004;\n*dir |= (1u << 5) | (1u << 0);\n*out |= (1u << 5);\n*out |= 1u;\n*out &= ~(1u << 0);\n*out ^= (1u << 9);\nprintf("%04x", *out);');
  const r = run(src);
  assert.equal(r.stdout, '0220'); assert.equal(r.regs.GPIO_OUT, 0x220); assert.equal(r.regs.GPIO_DIR, 0x21);
});
test('GPIO_SET / GPIO_CLR / GPIO_TOGGLE only touch the bits written as 1', () => {
  const r = run(main('GPIO_DIR = 0xFFFF; GPIO_OUT = 0x00F0; GPIO_SET = 0x0003; GPIO_CLR = 0x0030; GPIO_TOGGLE = 0x8001; GPIO_SET = 0;'));
  assert.equal(r.regs.GPIO_OUT, 0x80C2);
  assert.deepEqual(r.gpioTrace.map((g) => g.value), [0x00F0, 0x00F3, 0x00C3, 0x80C2]);
  assert.equal(r.regs.GPIO_SET, 0);
});
test('GPIO is 16 bits wide; write-only registers read 0 with a warning; GPIO_IN is read-only', () => {
  const r = run(main('GPIO_OUT = 0x12345678; GPIO_IN = 5; printf("%x %x", GPIO_OUT, GPIO_SET);'));
  assert.equal(r.stdout, '5678 0');
  assert.ok(hasWarn(r, /GPIO_SET is write-only/)); assert.ok(hasWarn(r, /GPIO_IN is read-only/));
});
test('GPIO_IN: outputs read back the latch, inputs read the bench, pull-ups read 1 when undriven', () => {
  assert.equal(out(main('GPIO_DIR = 0x00FF; GPIO_OUT = 0xA5A5; printf("%04x", GPIO_IN);'), { gpioIn: 0x3C00 }), '3ca5');
  assert.equal(out(main('GPIO_DIR = 0x000F; GPIO_OUT = 0x0005; GPIO_PULLUP = 0x0300; printf("%04x", GPIO_IN);')), '0305');
  assert.equal(out(main('GPIO_PULLUP = 0x0003; printf("%04x", GPIO_IN);'), { gpioIn: { value: 0x0000, mask: 0x0001 } }), '0002');
});
test('gpioIn can change over time (button press schedule)', () => {
  const src = main('GPIO_PULLUP = 1; int presses = 0, last = 1; for (int i = 0; i < 100; i++) { int now = GPIO_IN & 1; if (last && !now) presses++; last = now; } printf("%d", presses);');
  assert.equal(out(src, { gpioIn: [[0, 1], [50, 0], [120, 1], [200, 0], [260, 1]] }), '2');
});
test('unknown peripheral address faults; byte access to a register works', () => {
  assert.match(run(main('REG32(0x40000020) = 1;')).errors[0].msg, /no peripheral register/);
  const r = run(main('GPIO_DIR = 0xFFFF; *(volatile uint8_t *)0x40000005 = 0xAB; printf("%x", *(volatile uint8_t *)0x40000005);'));
  assert.equal(r.stdout, 'ab'); assert.equal(r.regs.GPIO_OUT, 0xAB00);
});

// ---------------------------------------------------------------- UART
const UART_PUTS = 'void uart_putc(char c) { while (!(UART_STATUS & UART_TX_READY)) { } UART_DATA = c; }\nvoid uart_puts(const char *s) { while (*s) uart_putc(*s++); }';
test('UART transmit with TX_READY polling delivers every byte', () => {
  const r = run(main('UART_CTRL = 1; UART_BAUD = 115200; uart_puts("Hello\\r\\n");', UART_PUTS));
  assert.equal(r.uartTx, 'Hello\r\n'); assert.equal(r.stdout, ''); assert.deepEqual(r.warnings, []);
  assert.equal(r.regs.UART_BAUD, 115200);
});
test('UART transmit without polling loses bytes and says so', () => {
  const r = run(main('UART_CTRL = 1; const char *s = "Hello"; while (*s) UART_DATA = *s++;'));
  assert.notEqual(r.uartTx, 'Hello'); assert.equal(r.uartTx[0], 'H'); assert.ok(r.uartTx.length < 5);
  assert.ok(hasWarn(r, /TX_READY was 0.*lost/)); assert.ok(r.uart.lost > 0);
});
test('UART transmit is dropped while ENABLE is 0', () => {
  const r = run(main('uart_puts("x"); UART_CTRL = UART_ENABLE; uart_puts("y");', UART_PUTS));
  assert.equal(r.uartTx, 'y'); assert.equal(r.uart.dropped, 1); assert.ok(hasWarn(r, /ENABLE.*dropped/));
});
test('TX_READY goes low for a few ticks after a write', () => {
  assert.equal(out(main('UART_CTRL = 1; int before = UART_STATUS & 1; UART_DATA = 65; int after = UART_STATUS & 1; int n = 0; while (!(UART_STATUS & 1)) n++; printf("%d %d %d", before, after, n > 0 && n < 8);')), '1 0 1');
});
test('UART receive: poll RX_AVAIL, read pops bytes in order, 0 when empty', () => {
  const src = main('char buf[8]; int n = 0; while (n < 5) { if (UART_STATUS & UART_RX_AVAIL) buf[n++] = (char)UART_DATA; } buf[n] = 0; printf("%s %u %u", buf, UART_STATUS & UART_RX_AVAIL, UART_DATA);');
  assert.equal(out(src, { uartRx: 'hello' }), 'hello 0 0');
});
test('UART echo firmware with a tick budget', () => {
  const src = main('UART_CTRL = UART_ENABLE; for (;;) { if (UART_STATUS & UART_RX_AVAIL) { char c = (char)UART_DATA; while (!(UART_STATUS & UART_TX_READY)) { } UART_DATA = c >= \'a\' && c <= \'z\' ? c - 32 : c; } }');
  const r = run(src, { uartRx: 'ping\n', ticks: 2000 });
  assert.equal(r.ok, true); assert.equal(r.stopped, 'ticks'); assert.equal(r.exit, null); assert.equal(r.uartTx, 'PING\n'); assert.equal(r.steps, 2000);
});
test('UART receive overrun when the program does not read fast enough', () => {
  const src = main('int spin = 0; for (int i = 0; i < 400; i++) spin++; int st = UART_STATUS; int n = 0; while (UART_STATUS & UART_RX_AVAIL) { (void)UART_DATA; n++; } printf("%d %d %d", (st >> 2) & 1, n, (UART_STATUS >> 2) & 1);');
  const r = run(src, { uartRx: 'x'.repeat(20) });
  assert.equal(r.stdout, '1 16 0'); assert.ok(hasWarn(r, /overrun/));
});
test('UART RX interrupt fills a ring buffer', () => {
  const pre = 'volatile char rb[32]; volatile int head = 0;\nvoid uart_rx_isr(void) { rb[head++] = (char)UART_DATA; }';
  const src = main('irq_attach(IRQ_UART_RX, uart_rx_isr); UART_CTRL = UART_ENABLE | UART_RX_IRQ_EN; while (head < 4) { } rb[head] = 0; printf("%s", (const char *)rb);', pre);
  const r = run(src, { uartRx: 'data' });
  assert.equal(r.stdout, 'data'); assert.equal(r.irqCounts.IRQ_UART_RX, 4);
});

// ---------------------------------------------------------------- timer, ADC, interrupts
test('timer counts down once per tick and sets EXPIRED; write 1 clears it', () => {
  const src = main('TIM_LOAD = 50; TIM_CTRL = TIM_ENABLE; uint32_t first = TIM_COUNT; int polls = 0; while (!(TIM_STATUS & TIM_EXPIRED)) polls++; uint32_t end = TIM_COUNT; TIM_STATUS = TIM_EXPIRED; printf("%d %d %u %u", first < 50 && first > 40, polls > 20 && polls < 50, end, TIM_STATUS);');
  assert.equal(out(src), '1 1 0 0');
});
test('timer does not run while disabled; auto-reload restarts it', () => {
  assert.equal(out(main('TIM_LOAD = 10; for (int i = 0; i < 30; i++) { } printf("%u %u ", TIM_COUNT, TIM_STATUS); TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD; int n = 0; for (int i = 0; i < 3; i++) { while (!(TIM_STATUS & 1)) { } TIM_STATUS = 1; n++; } printf("%d %d", n, TIM_COUNT > 0);')), '10 0 3 1');
});
test('timer interrupt handler modifies a shared variable; flag must be cleared', () => {
  const pre = 'volatile uint32_t ticks = 0;\nvoid timer_isr(void) { TIM_STATUS = TIM_EXPIRED; ticks++; GPIO_TOGGLE = 1; }';
  const src = main('GPIO_DIR = 1; irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 20; TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD | TIM_IRQ_EN; while (ticks < 5) { } TIM_CTRL = 0; printf("ticks=%u", ticks);', pre);
  const r = run(src);
  assert.equal(r.stdout, 'ticks=5'); assert.equal(r.regs.GPIO_OUT, 1); assert.equal(r.irqCounts.IRQ_TIMER, 5);
});
test('__attribute__((interrupt)) handler is attached by the simulator', () => {
  const pre = 'volatile int fired = 0;\nvoid __attribute__((interrupt)) timer_handler(void) { TIM_STATUS = 1; fired++; }';
  assert.equal(out(main('TIM_LOAD = 5; TIM_CTRL = TIM_ENABLE | TIM_IRQ_EN; for (int i = 0; i < 20 && !fired; i++) { } printf("%d", fired);', pre)), '1');
});
test('interrupt between statements causes a lost update; irq_disable protects it', () => {
  const pre = 'volatile int shared = 0;\nvoid timer_isr(void) { TIM_STATUS = 1; shared = shared + 1; }\n';
  const body = (guard) => `irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 11; TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD | TIM_IRQ_EN;
    int mine = 0;
    for (int i = 0; i < 200; i++) { ${guard ? 'irq_disable();' : ''} int tmp = shared; tmp = tmp + 1; shared = tmp; ${guard ? 'irq_enable();' : ''} mine++; }
    TIM_CTRL = 0; printf("%d %d", shared, mine);`;
  const racy = run(main(body(false), pre)), safe = run(main(body(true), pre));
  assert.ok(racy.irqCounts.IRQ_TIMER > 10);
  const [rs, rm] = racy.stdout.split(' ').map(Number), [ss, sm] = safe.stdout.split(' ').map(Number);
  assert.equal(rm, 200); assert.equal(sm, 200);
  assert.ok(rs < rm + racy.irqCounts.IRQ_TIMER, 'some ISR increments must be lost'); // those that landed between the load and the store
  assert.ok(safe.irqCounts.IRQ_TIMER > 10);
  assert.equal(ss, sm + safe.irqCounts.IRQ_TIMER);
});
// ---- preemption inside a read-modify-write statement
const RMW_PRE = 'volatile uint32_t counter = 0;\nvolatile uint32_t isr_runs = 0;\nvoid timer_isr(void) { TIM_STATUS = TIM_EXPIRED; counter++; isr_runs++; }\n';
const rmwBody = (stmt) => `irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 9; TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD | TIM_IRQ_EN;
  uint32_t mine = 0;
  while (mine < 400) { ${stmt} mine++; }
  irq_disable(); TIM_CTRL = 0;
  printf("%u %u %u", counter, mine, isr_runs);`;
const rmwLost = (stmt) => { const r = run(main(rmwBody(stmt), RMW_PRE)); assert.deepEqual(r.errors, []); const [c, m, i] = r.stdout.split(' ').map(Number); assert.equal(m, 400); assert.ok(i > 20, 'the ISR must run'); return m + i - c; };
test('counter++ in main loses updates to a timer ISR that also increments it', () => {
  assert.ok(rmwLost('counter++;') > 0);
  assert.ok(rmwLost('counter += 1;') > 0);
  assert.ok(rmwLost('counter = counter + 1;') > 0);
  assert.ok(rmwLost('++counter;') > 0);
});
test('the same increments inside irq_disable/irq_enable lose nothing, and the run is reproducible', () => {
  assert.equal(rmwLost('irq_disable(); counter++; irq_enable();'), 0);
  assert.equal(rmwLost('irq_disable(); counter = counter + 1; irq_enable();'), 0);
  assert.equal(rmwLost('counter++;'), rmwLost('counter++;'));
});
test('read-modify-write through a pointer and a struct member is interruptible too; a plain local is not', () => {
  const pre = 'typedef struct { volatile uint32_t n; uint32_t isr; } stats_t;\nstats_t st;\nstats_t *sp = &st;\nvoid timer_isr(void) { TIM_STATUS = 1; sp->n = sp->n + 1; st.isr++; }\n';
  const body = (stmt) => `irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 9; TIM_CTRL = 7; volatile uint32_t *p = &st.n; uint32_t mine = 0; uint32_t local = 0;
    while (mine < 400) { ${stmt} mine++; } irq_disable(); TIM_CTRL = 0; printf("%u %u %u", st.n + local, mine, st.isr);`;
  const lost = (stmt) => { const [c, m, i] = out(main(body(stmt), pre)).split(' ').map(Number); return m + i - c; };
  assert.ok(lost('(*p)++;') > 0);
  assert.ok(lost('sp->n += 1;') > 0);
  assert.ok(lost('st.n = st.n + 1;') > 0);
  assert.equal(lost('local++;'), 0); // nothing else can reach a local, so no update is lost
});
test('GPIO_OUT |= bit in main loses an edge made by an ISR; GPIO_SET does not', () => {
  // The ISR toggles pin 1 an odd number of times in total only if none of its toggles is overwritten by main's stale write.
  const pre = 'volatile uint32_t isr_runs = 0;\nvoid timer_isr(void) { TIM_STATUS = TIM_EXPIRED; GPIO_TOGGLE = 1u << 1; isr_runs++; }\n';
  const body = (set, clr) => `GPIO_DIR = 3; irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 9; TIM_CTRL = TIM_ENABLE | TIM_AUTO_RELOAD | TIM_IRQ_EN;
    for (int i = 0; i < 300; i++) { ${set} ${clr} }
    irq_disable(); TIM_CTRL = 0; printf("%u %u", isr_runs & 1u, (GPIO_OUT >> 1) & 1u);`;
  const check = (set, clr) => { const [parity, pin] = out(main(body(set, clr), pre)).split(' ').map(Number); return parity === pin; };
  assert.equal(check('GPIO_OUT |= 1u;', 'GPIO_OUT &= ~1u;'), false, 'stale read-modify-write must undo an ISR toggle');
  assert.equal(check('GPIO_SET = 1u;', 'GPIO_CLR = 1u;'), true);
  assert.equal(check('irq_disable(); GPIO_OUT |= 1u; irq_enable();', 'irq_disable(); GPIO_OUT &= ~1u; irq_enable();'), true);
});
test('a read-modify-write of a memory object costs two ticks, of a local one', () => {
  const steps = (stmt) => run(main(`int local = 0; ${stmt}`, 'int global = 0;')).steps;
  assert.equal(steps('global++;') - steps('local++;'), 1);
  assert.equal(steps('global = global + 1;') - steps('global = local + 1;'), 1);
});
test('register misuse that happens to work is warned about, and noWarning turns it into a test failure', () => {
  const w1c = main('TIM_LOAD = 5; TIM_CTRL = 1; while (!(TIM_STATUS & 1)) { } TIM_STATUS |= TIM_EXPIRED; printf("%u", TIM_STATUS);');
  assert.equal(run(w1c).stdout, '0'); assert.ok(hasWarn(run(w1c), /write-1-to-clear/));
  assert.ok(hasWarn(run(main('TIM_STATUS = TIM_STATUS | 1u;')), /write-1-to-clear/));
  assert.deepEqual(run(main('TIM_STATUS = TIM_EXPIRED;')).warnings, []);
  assert.ok(hasWarn(run(main('unsigned pin = 16; GPIO_DIR |= 1u << pin;')), /bits 16-31/));
  assert.deepEqual(run(main('GPIO_DIR &= ~(1u << 3); GPIO_CLR = 0xFFFFFFFFu; GPIO_DIR |= 1u << 15;')).warnings, []);
  assert.equal(runTest(w1c, { stdout: '0' }).pass, true);
  const t = runTest(w1c, { stdout: '0', noWarning: ['write-only', 'write-1-to-clear'] });
  assert.equal(t.pass, false); assert.match(t.message, /the simulator flagged a problem on line 6: TIM_STATUS is write-1-to-clear/);
  assert.equal(runTest(main('GPIO_DIR = 1; GPIO_SET |= 1u;'), { regs: { GPIO_OUT: 1 }, noWarning: 'write-only' }).pass, false);
  assert.equal(runTest(main('GPIO_DIR = 1; GPIO_SET = 1u;'), { regs: { GPIO_OUT: 1 }, noWarning: 'write-only' }).pass, true);
});
test('an interrupt whose flag is never cleared starves main', () => {
  const pre = 'volatile int n = 0;\nvoid timer_isr(void) { n++; }';
  const r = run(main('irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 3; TIM_CTRL = TIM_ENABLE | TIM_IRQ_EN; while (n < 1000000) { } printf("done");', pre), { maxSteps: 20000 });
  assert.equal(r.stopped, 'limit'); assert.equal(r.stdout, '');
});
test('pending interrupt with no handler is reported', () => {
  assert.ok(hasWarn(run(main('TIM_LOAD = 2; TIM_CTRL = TIM_ENABLE | TIM_IRQ_EN; for (int i = 0; i < 10; i++) { }')), /no handler is attached/));
});
test('ADC returns the bench samples in order; START self-clears; DONE must be polled', () => {
  const pre = 'uint32_t adc_read(int ch) { ADC_CTRL = ADC_START | (ch << 4); while (!(ADC_STATUS & ADC_DONE)) { } return ADC_DATA; }';
  const r = run(main('uint32_t a = adc_read(0), b = adc_read(3), c = adc_read(1); printf("%u %u %u %x", a, b, c, ADC_CTRL);', pre), { adc: [100, 4095, 5000] });
  assert.equal(r.stdout, '100 4095 904 10'); assert.deepEqual(r.warnings, []);
  const early = run(main('ADC_CTRL = ADC_START; uint32_t v = ADC_DATA; printf("%u", v);'), { adc: [777] });
  assert.equal(early.stdout, '0'); assert.ok(hasWarn(early, /ADC_DATA was read while a conversion was still running/));
});
test('ADC samples can be given per channel', () => {
  const pre = 'uint32_t adc_read(int ch) { ADC_CTRL = ADC_START | (ch << 4); while (!(ADC_STATUS & ADC_DONE)) { } return ADC_DATA; }';
  assert.equal(out(main('printf("%u %u %u", adc_read(2), adc_read(0), adc_read(2));', pre), { adc: { 0: [5], 2: [20, 21] } }), '20 5 21');
});
test('all named registers are reported', () => {
  const r = run('int main(void) { return 0; }');
  assert.deepEqual(Object.keys(r.regs).sort(), Object.keys(REGISTERS).sort());
  assert.equal(r.regs.UART_STATUS, 1);
});
test('ticks: main returning early still lets interrupts run until the budget ends', () => {
  const pre = 'volatile int n = 0;\nvoid timer_isr(void) { TIM_STATUS = 1; n++; }';
  const r = run(main('irq_attach(IRQ_TIMER, timer_isr); TIM_LOAD = 100; TIM_CTRL = 7;', pre), { ticks: 1000 });
  assert.equal(r.stopped, 'ticks'); assert.equal(r.exit, 0);
  assert.equal(r.readMem(r.symbol('n').addr, 4), 9);
});

// ---------------------------------------------------------------- compile errors
const cerr = (src) => { const r = run(src); assert.equal(r.stopped, 'compile', 'expected a compile error, got: ' + JSON.stringify(r.errors) + r.stdout); assert.equal(r.ok, false); return r.errors[0]; };
test('compile errors carry the right line: missing semicolon', () => {
  const e = cerr('#include <stdio.h>\nint main(void) {\n  int x = 5\n  printf("%d", x);\n  return 0;\n}\n');
  assert.equal(e.line, 3); assert.match(e.msg, /missing ';' after '5'/);
});
test('compile errors: undeclared variable and function', () => {
  const e = cerr('int main(void) {\n  int count = 0;\n  cuont = 5;\n  return count;\n}');
  assert.equal(e.line, 3); assert.match(e.msg, /'cuont' is not declared/);
  const f = cerr('int main(void) {\n\n\n  return helper(2);\n}');
  assert.equal(f.line, 4); assert.match(f.msg, /function 'helper' is not declared/);
});
test('compile errors: unbalanced braces and parentheses', () => {
  assert.equal(cerr('int main(void) {\n  if (1) {\n    return 1;\n  return 0;\n}').line, 1);
  const e = cerr('int main(void) {\n  int x = (3 + 4;\n  return x;\n}');
  assert.equal(e.line, 2); assert.match(e.msg, /expected '\)'/);
});
test('compile errors: wrong argument count, bad member, wrong operator on pointer', () => {
  assert.match(cerr('int f(int a, int b) { return a + b; }\nint main(void) { return f(1); }').msg, /'f' takes 2 arguments, but 1 was given/);
  assert.match(cerr('struct S { int a; };\nint main(void) { struct S s; s.b = 1; return 0; }').msg, /no field named 'b'/);
  assert.match(cerr('struct S { int a; };\nint main(void) { struct S s; struct S *p = &s; p.a = 1; return 0; }').msg, /use '->a'/);
  assert.match(cerr('int main(void) { int x = 1; return *x; }').msg, /'\*' needs a pointer/);
});
test('unsupported features are rejected with an explanation', () => {
  assert.match(cerr('int main(void) { float f = 1.5; return 0; }').msg, /floating point is not supported/);
  assert.match(cerr('int main(void) { int x = 3.14; return 0; }').msg, /floating point is not supported/);
  assert.match(cerr('struct F { unsigned a : 3; };\nint main(void) { return 0; }').msg, /bit-fields are not supported/);
  assert.match(cerr('int main(void) { goto end; end: return 0; }').msg, /goto/);
  assert.match(cerr('int main(void) { int n = 4; int a[n]; return 0; }').msg, /variable-length arrays/);
  assert.match(cerr('int helper(void) { return 1; }').msg, /no main/);
});
test('compile errors: unknown type, unterminated string and comment, statement outside a function', () => {
  assert.match(cerr('uint33_t x;\nint main(void) { return 0; }').msg, /unknown type 'uint33_t'/);
  assert.equal(cerr('int main(void) {\n  char *s = "abc;\n  return 0;\n}').line, 2);
  assert.match(cerr('/* never closed\nint main(void) { return 0; }').msg, /unterminated/);
  assert.match(cerr('#include <stdio.h>\nprintf("hi");\nint main(void) { return 0; }').msg, /outside any function/);
});
test('helpful warnings: = in a condition, string ==, int to pointer, precedence of &', () => {
  assert.ok(hasWarn(run(main('int x = 0; if (x = 5) printf("y");')), /assigns, it does not compare/));
  assert.ok(hasWarn(run(main('const char *s = "a"; if (s == "a") printf("y");')), /strcmp/));
  assert.ok(hasWarn(run(main('uint8_t *p = 0x20000100; (void)p;')), /pointer.*from an integer without a cast/));
  assert.ok(hasWarn(run(main('unsigned r = 4; if (r & 4 == 4) printf("y");')), /binds less tightly/));
  assert.deepEqual(run(main('unsigned r = 4; if ((r & 4) == 4) printf("y");')).warnings, []);
  assert.ok(hasWarn(run(main('uint8_t v = 300; (void)v;')), /300 does not fit/));
  assert.ok(hasWarn(run(main('printf("%d\\n", 5LL);')), /printf.*64-bit|printf.*32-bit/));
  assert.ok(hasWarn(run('int f(int x) { if (x) return 1; }\nint main(void) { return f(0); }'), /without a return/));
});

// ---------------------------------------------------------------- runTest
test('runTest: stdout exact with trailing whitespace trimmed, stdoutIncludes, exit', () => {
  const src = '#include <stdio.h>\nint main(void) { printf("sum=%d\\n\\n", 7); return 2; }';
  assert.equal(runTest(src, { name: 't', stdout: 'sum=7' }).pass, true);
  assert.equal(runTest(src, { stdout: 'sum=7\n', exit: 2, stdoutIncludes: 'm=7' }).pass, true);
  const bad = runTest(src, { stdout: 'sum=8' });
  assert.equal(bad.pass, false); assert.match(bad.message, /expected output "sum=8", got "sum=7"/);
  assert.match(runTest(src, { exit: 0 }).message, /expected exit code 0, got 2/);
  assert.match(runTest(src, { stdoutIncludes: ['sum', 'zzz'] }).message, /contain "zzz"/);
  assert.match(runTest('#include <stdio.h>\nint main(void) { printf("a\\nb\\nc\\n"); return 0; }', { stdout: 'a\nB\nc\n' }).message, /first difference on output line 2: expected "B", got "b"/);
});
test('runTest: regs plain and masked, uartTx, inputs', () => {
  const src = main('GPIO_DIR = 0xFF; GPIO_OUT = (GPIO_IN >> 8) | 0x80; UART_CTRL = 1; UART_DATA = getchar(); while (!(UART_STATUS & 1)) { } while (!(UART_STATUS & UART_RX_AVAIL)) { } UART_DATA = UART_DATA + 1; ADC_CTRL = 1; while (!(ADC_STATUS & 1)) { } printf("%u", ADC_DATA);');
  const t = { stdin: 'Q', gpioIn: 0x2100, uartRx: 'a', adc: [321], stdout: '321', uartTx: 'Qb', regs: { GPIO_OUT: 0xA1, GPIO_DIR: { mask: 0x0F, value: 0x0F } } };
  assert.equal(runTest(src, t).message, 'ok');
  const m = runTest(src, { ...t, regs: { GPIO_OUT: { mask: 0x0F, value: 0x02 } }, uartTx: 'Qa' }).message;
  assert.match(m, /expected GPIO_OUT & 0xF to be 0x2, got 0x1 \(whole register 0xA1\)/); assert.match(m, /expected UART transmit "Qa", got "Qb"/);
});
test('runTest: mem by symbol and address, arrays and strings', () => {
  const src = 'unsigned int total = 0;\nunsigned char buf[4];\nchar name[8];\nshort neg;\nint main(void) { total = 0xCAFE; buf[0] = 1; buf[1] = 2; buf[3] = 9; name[0] = \'o\'; name[1] = \'k\'; neg = -2; return 0; }';
  assert.equal(runTest(src, { mem: [{ sym: 'total', size: 4, value: 0xCAFE }, { sym: 'total', value: 0xCAFE }, { addr: 0x20000000, size: 2, value: 0xCAFE }, { sym: 'buf', size: 1, value: [1, 2, 0, 9] }, { sym: 'name', value: 'ok' }, { sym: 'neg', size: 2, value: -2 }, { sym: 'buf', offset: 3, size: 1, value: 9 }] }).message, 'ok');
  assert.match(runTest(src, { mem: [{ sym: 'total', size: 4, value: 5 }] }).message, /expected 'total' to be 5, got 51966 \(0xCAFE\)/);
  assert.match(runTest(src, { mem: [{ sym: 'missing', size: 4, value: 5 }] }).message, /no global named 'missing'/);
});
test('runTest: compile errors, faults, ticks, simulator notes', () => {
  assert.match(runTest('int main(void) { return x; }', { exit: 0 }).message, /does not compile — line 1: 'x' is not declared/);
  const f = runTest(main('int *p = 0; printf("out"); *p = 1;'), { stdout: 'out' });
  assert.equal(f.pass, false); assert.match(f.message, /stopped with an error on line 6: bus fault/);
  assert.equal(runTest(main('int *p = 0; printf("out"); *p = 1;'), { stdout: 'out', fault: 'bus fault' }).pass, true);
  assert.equal(runTest(main('GPIO_DIR = 1; for (;;) { GPIO_TOGGLE = 1; }'), { ticks: 101, regs: { GPIO_OUT: 1 } }).pass, true);
  assert.match(runTest(main('for (;;) { }'), {}).message, /infinite loop/);
  assert.match(runTest(main('UART_DATA = 65;'), { uartTx: 'A' }).message, /expected UART transmit "A", got "".*simulator notes.*ENABLE/);
  assert.equal(runTest(main('GPIO_DIR = 3; GPIO_OUT = 1; GPIO_OUT = 3; GPIO_OUT = 3; GPIO_OUT = 0;'), { gpioTrace: [1, 3, 0] }).pass, true);
});

// ---------------------------------------------------------------- layout helpers
test('layoutStruct and layoutOf expose the ABI layout', () => {
  assert.deepEqual(layoutStruct([{ size: 1, align: 1 }, { size: 4, align: 4 }, { size: 2, align: 2 }]), { offsets: [0, 4, 8], size: 12, align: 4 });
  assert.deepEqual(layoutStruct([{ size: 1, align: 1 }, { size: 4, align: 4 }, { size: 2, align: 2 }], { packed: true }), { offsets: [0, 1, 5], size: 7, align: 1 });
  assert.deepEqual(layoutStruct([{ size: 1, align: 1 }, { size: 4, align: 4 }], { union: true }), { offsets: [0, 0], size: 4, align: 4 });
  const l = layoutOf('typedef struct { uint8_t id; uint32_t value; uint16_t crc; char tag[3]; void (*cb)(int); } pkt_t;');
  assert.equal(l.ok, true);
  const s = l.structs[0];
  assert.equal(s.name, 'pkt_t'); assert.equal(s.size, 20);
  assert.deepEqual(s.fields.map((f) => [f.name, f.offset, f.size]), [['id', 0, 1], ['value', 4, 4], ['crc', 8, 2], ['tag', 10, 3], ['cb', 16, 4]]);
  assert.deepEqual(s.padding, [{ offset: 1, size: 3 }, { offset: 13, size: 3 }]);
  assert.equal(s.fields[4].decl, 'void (*cb)(int)');
  assert.equal(layoutOf('struct A { char c; int i; };', { packed: true }).structs[0].size, 5);
  assert.equal(layoutOf('struct A { char c; int i }').ok, false);
});

// ---------------------------------------------------------------- cross-check against host gcc
// Only width-independent programs (fixed-width types, no long, no pointer printing), so plain 64-bit gcc agrees with ILP32.
const CROSS = {
  'integer promotions and wraparound': 'uint8_t a = 200, b = 100; uint8_t c = a + b; int d = a + b; int8_t e = (int8_t)a; uint16_t f = (uint16_t)(e * 3); uint32_t g = (uint32_t)e >> 28; int32_t h = e >> 2;\nprintf("%d %d %d %u %u %d %d\\n", c, d, e, f, g, h, (a << 4) | (b >> 3));',
  'bit manipulation': 'uint32_t r = 0xA5A5A5A5u; r &= ~(0xFu << 8); r |= (0x3u << 8); r ^= 1u << 31; uint32_t field = (r >> 4) & 0x3F; int pop = 0; for (uint32_t t = r; t; t &= t - 1) pop++;\nprintf("%08x %u %d %x %x\\n", r, field, pop, (uint32_t)(~r), (uint8_t)(r >> 13));',
  'crc8 and checksum': 'uint8_t data[] = {0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39}; uint8_t crc = 0; for (unsigned i = 0; i < sizeof data; i++) { crc ^= data[i]; for (int b = 0; b < 8; b++) crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x07) : (uint8_t)(crc << 1); } uint16_t sum = 0; for (unsigned i = 0; i < sizeof data; i++) sum += data[i];\nprintf("%02X %u %u\\n", crc, sum, (unsigned)(uint8_t)(~sum + 1));',
  'crc16 ccitt and fletcher': 'const char *s = "123456789"; uint16_t crc = 0xFFFF; for (const char *p = s; *p; p++) { crc ^= (uint16_t)((uint8_t)*p << 8); for (int i = 0; i < 8; i++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1); } uint16_t s1 = 0, s2 = 0; for (const char *p = s; *p; p++) { s1 = (s1 + (uint8_t)*p) % 255; s2 = (s2 + s1) % 255; }\nprintf("%04X %04X\\n", crc, (s2 << 8) | s1);',
  'signed arithmetic and division': 'int32_t v[] = {7, -7, 100, -100, 2147483647, -2147483647}; for (int i = 0; i < 6; i++) printf("%d %d %d %d|", v[i] / 3, v[i] % 3, v[i] >> 1, -v[i] / 7); printf("\\n");',
  'unsigned compare pitfalls': 'int32_t i = -1; uint32_t u = 1; uint8_t small = 255; int8_t s8 = -1; printf("%d %d %d %d %d\\n", i < (int32_t)u, (uint32_t)i > u, small == s8, (uint8_t)s8 == small, sizeof(int32_t) > (uint32_t)i);',
  '64-bit math': 'uint64_t a = 0x123456789ABCDEFull; int64_t b = -1234567890123ll; uint64_t m = a * 3 + (uint64_t)b; printf("%llx %lld %llu %lld %llu\\n", (unsigned long long)(a >> 12), (long long)(b / 1000), (unsigned long long)(m % 1000003), (long long)(b % 97), (unsigned long long)((a << 20) ^ a));',
  'strings and arrays': 'char buf[32] = "embedded"; char rev[32]; size_t n = strlen(buf); for (size_t i = 0; i < n; i++) rev[i] = buf[n - 1 - i]; rev[n] = 0; char up[16]; int k = 0; for (const char *p = "Bench-MCU"; *p; p++) up[k++] = (*p >= \'a\' && *p <= \'z\') ? *p - 32 : *p; up[k] = 0;\nstrcat(buf, "!"); printf("%s %s %s %d %d %d\\n", rev, up, buf, strcmp(buf, rev) > 0, (int)strlen(buf), memcmp("abc", "abd", 3) < 0);',
  'struct layout with fixed-width fields': 'struct A { uint8_t a; uint32_t b; uint16_t c; }; struct B { uint32_t b; uint16_t c; uint8_t a; }; struct C { uint8_t a; uint16_t c; uint8_t d; uint64_t q; uint8_t e; }; union U { uint32_t w; uint8_t b[4]; uint16_t h; }; union U u; u.w = 0x01020304;\nprintf("%u %u %u %u %u %u %x %x\\n", (unsigned)sizeof(struct A), (unsigned)sizeof(struct B), (unsigned)sizeof(struct C), (unsigned)offsetof(struct A, c), (unsigned)offsetof(struct C, q), (unsigned)offsetof(struct C, e), u.b[0], u.h);',
  'sorting and searching': 'int32_t v[] = {42, -3, 17, 0, 99, -50, 8, 23}; int n = 8; for (int i = 1; i < n; i++) { int32_t key = v[i]; int j = i - 1; while (j >= 0 && v[j] > key) { v[j + 1] = v[j]; j--; } v[j + 1] = key; } int lo = 0, hi = n - 1, at = -1; while (lo <= hi) { int mid = (lo + hi) / 2; if (v[mid] == 23) { at = mid; break; } if (v[mid] < 23) lo = mid + 1; else hi = mid - 1; }\nfor (int i = 0; i < n; i++) printf("%d ", v[i]); printf("%d\\n", at);',
  'switch state machine': 'enum { IDLE, HEADER, BODY, DONE } st = IDLE; const uint8_t in[] = {0, 0xAA, 3, 10, 20, 30, 0xAA, 1, 5}; int left = 0, sum = 0, frames = 0; for (unsigned i = 0; i < sizeof in; i++) { switch (st) { case IDLE: if (in[i] == 0xAA) st = HEADER; break; case HEADER: left = in[i]; st = left ? BODY : DONE; break; case BODY: sum += in[i]; if (--left == 0) st = DONE; if (st != DONE) break; /* fall through */ case DONE: frames++; st = IDLE; break; } }\nprintf("%d %d %d\\n", sum, frames, st);',
  'function pointers and recursion': 'printf("%d %d %d %u\\n", apply(sq, 7), apply(neg, 7), gcd(1071, 462), collatz(27));',
  'printf formats': 'printf("[%5d|%-5d|%05d|%x|%X|%08x|%c|%s|%10s|%-10s|%.2s|%%|%u|%3d|%+d]\\n", -42, 42, 42, 48879, 48879, 255, 90, "s", "right", "left", "cut", 4000000000u, 1000, 7);',
  'ring buffer': 'uint8_t rb[8]; uint8_t head = 0, tail = 0; int dropped = 0; for (int i = 0; i < 11; i++) { uint8_t nx = (uint8_t)((head + 1) & 7); if (nx == tail) { dropped++; continue; } rb[head] = (uint8_t)(i * 3); head = nx; } int sum = 0, cnt = 0; while (tail != head) { sum += rb[tail]; tail = (uint8_t)((tail + 1) & 7); cnt++; }\nprintf("%d %d %d\\n", sum, cnt, dropped);',
  'fixed-point and hex dump': 'uint16_t raw = 2731; uint32_t mv = (uint32_t)raw * 3300u / 4095u; int32_t c10 = ((int32_t)mv - 500) * 10 / 10; uint8_t bytes[4]; for (int i = 0; i < 4; i++) bytes[i] = (uint8_t)(mv >> (8 * i)); uint32_t be = ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) | ((uint32_t)bytes[2] << 8) | bytes[3];\nprintf("%u %d.%d %02x%02x%02x%02x %08x\\n", mv, c10 / 10, c10 % 10, bytes[0], bytes[1], bytes[2], bytes[3], be);',
  'macros': 'int x = 3; int sq1 = SQ(x + 1); int mx = MAX(x++, 2); printf("%d %d %u %d %s %d\\n", sq1, mx, BIT(5) | BIT(1), ARRAY_LEN(tbl), STR(hello world), x);',
};
const CROSS_PRE = '#include <stddef.h>\n#include <stdlib.h>\n#define SQ(x) ((x) * (x))\n#define MAX(a, b) ((a) > (b) ? (a) : (b))\n#define BIT(n) (1u << (n))\n#define ARRAY_LEN(a) ((int)(sizeof(a) / sizeof((a)[0])))\n#define STR(x) #x\nstatic const int tbl[] = {1, 2, 3, 4, 5};\nstatic int sq(int v) { return v * v; }\nstatic int neg(int v) { return -v; }\nstatic int apply(int (*f)(int), int v) { return f(v); }\nstatic int gcd(int a, int b) { return b ? gcd(b, a % b) : a; }\nstatic unsigned collatz(unsigned n) { unsigned steps = 0; while (n != 1) { n = (n & 1) ? 3 * n + 1 : n / 2; steps++; } return steps; }';
let gccDir = null;
function gccRun(src) {
  if (gccDir === false) return null;
  try {
    if (!gccDir) { execFileSync('gcc', ['--version'], { stdio: 'ignore' }); gccDir = mkdtempSync(join(tmpdir(), 'cinterp-')); }
    const c = join(gccDir, 'p.c'), exe = join(gccDir, 'p');
    writeFileSync(c, src);
    execFileSync('gcc', ['-std=c11', '-w', '-o', exe, c], { stdio: 'pipe' });
    return execFileSync(exe, { encoding: 'latin1' });
  } catch (e) { if (!gccDir) { gccDir = false; return null; } throw e; }
}
for (const [name, body] of Object.entries(CROSS)) {
  test(`matches host gcc: ${name}`, (t) => {
    const src = main(body, CROSS_PRE);
    const want = gccRun(src);
    if (want == null) return t.skip('gcc not available');
    const r = run(src);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stdout, want);
  });
}
test('cleanup', () => { if (gccDir) rmSync(gccDir, { recursive: true, force: true }); });
