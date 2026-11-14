/* Host check for sha256.c: gcc -Wall -Wextra -std=c11 sha256.c sha256_hosttest.c && ./a.out */
#include <stdio.h>
#include <string.h>
#include "sha256.h"

static int check(const char *msg, const char *want)
{
    uint8_t d[32];
    char hex[65];
    sha256((const uint8_t *)msg, (uint32_t)strlen(msg), d);
    for (int i = 0; i < 32; i++) {
        sprintf(hex + 2 * i, "%02x", d[i]);
    }
    return strcmp(hex, want) != 0;
}

int main(void)
{
    int bad = 0;
    bad += check("", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    bad += check("abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    bad += check("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
                 "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    /* 70 bytes: forces the two-block padding path; expected value from coreutils sha256sum */
    bad += check("0123456789012345678901234567890123456789012345678901234567890123456789",
                 "57445fa40b08c60cdcba7ca39c756de614d11482e3f15a925f548688c19e58f4");
    printf(bad ? "sha256: FAIL\n" : "sha256: OK\n");
    return bad;
}
