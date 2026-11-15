#!/usr/bin/env bash
# Build every extracted ESP-IDF project for the esp32 target and print a pass/fail table.
#
#   tools/idf-check/build-all.sh                 extract, build everything, rewrite RESULTS.md
#   tools/idf-check/build-all.sh esp-p1-3 ...    extract, build only these ids (RESULTS.md untouched)
#   tools/idf-check/build-all.sh --clean [ids]   delete each project's build output first
#   tools/idf-check/build-all.sh --no-extract    build what is already in build/
#
# Environment: IDF_PATH (default /home/user/espressif/esp-idf), IDF_TARGET (default esp32).
# Exit status: 0 if every built project passed, 1 otherwise.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/build"
TARGET="${IDF_TARGET:-esp32}"
CLEAN=0; EXTRACT=1; IDS=()
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --no-extract) EXTRACT=0 ;;
    -h|--help) sed -n '2,11p' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) echo "unknown option $a" >&2; exit 2 ;;
    *) IDS+=("$a") ;;
  esac
done

# --- toolchain -------------------------------------------------------------
if ! command -v idf.py >/dev/null 2>&1; then
  export IDF_PATH="${IDF_PATH:-/home/user/espressif/esp-idf}"
  # dl.espressif.com (the pip constraints file) may be unreachable; the check is optional.
  export IDF_PYTHON_CHECK_CONSTRAINTS="${IDF_PYTHON_CHECK_CONSTRAINTS:-no}"
  if [ ! -f "$IDF_PATH/export.sh" ]; then
    echo "ESP-IDF not found at $IDF_PATH. Set IDF_PATH or see README.md." >&2; exit 2
  fi
  # shellcheck disable=SC1091
  . "$IDF_PATH/export.sh" >/dev/null 2>&1 || { echo "sourcing $IDF_PATH/export.sh failed; run it by hand to see why" >&2; exit 2; }
fi
IDF_VER="$(git -C "$IDF_PATH" describe --tags --always 2>/dev/null || true)"
IDF_VER_FILE="$(sed -n 's/^set(IDF_VERSION_\(MAJOR\|MINOR\|PATCH\) \([0-9]*\))/\2/p' "$IDF_PATH/tools/cmake/version.cmake" 2>/dev/null | paste -sd. -)"
GCC_VER="$(xtensa-esp32-elf-gcc -dumpversion 2>/dev/null || echo '?')"

# --- extract ---------------------------------------------------------------
if [ "$EXTRACT" = 1 ]; then
  node "$HERE/extract.mjs" >/dev/null || { echo "extract.mjs failed" >&2; exit 2; }
fi
[ -f "$OUT/ids.txt" ] || { echo "nothing extracted: run node $HERE/extract.mjs" >&2; exit 2; }
ALL=0
if [ "${#IDS[@]}" = 0 ]; then mapfile -t IDS < "$OUT/ids.txt"; ALL=1; fi

# --- build -----------------------------------------------------------------
first_error() {  # first compiler / linker / CMake error in a log, on one line
  local log="$1" line
  line="$(grep -m1 -E '(fatal error|error):|: undefined reference to|multiple definition of' "$log")"
  if [ -z "$line" ]; then
    line="$(grep -m1 -A3 -E '^CMake Error' "$log" | tr '\n' ' ' | sed 's/  */ /g')"
  fi
  [ -z "$line" ] && line="$(grep -m1 -E 'ninja: error|FAILED:|ERROR:|Error:' "$log")"
  [ -z "$line" ] && line="(no error line recognised; read $log)"
  # shorten absolute paths to something a reader can map back to the listing
  printf '%s' "$line" | sed -e "s#$OUT/##g" -e "s#$IDF_PATH/#\$IDF_PATH/#g" | cut -c1-400
}

RES="$OUT/results.tsv"; TMP="$(mktemp)"
pass=0; fail=0
printf '%-26s %-5s %5s %4s  %s\n' ID RESULT SECS WARN 'FIRST ERROR'
for id in "${IDS[@]}"; do
  dir="$OUT/$id"
  if [ ! -f "$dir/CMakeLists.txt" ]; then
    printf '%-26s %-5s %5s %4s  %s\n' "$id" "ERR" - - "no such project (see build/manifest.json; skipped listings are not built)"
    fail=$((fail+1)); printf '%s\tERR\t0\t0\tno such project\n' "$id" >> "$TMP"; continue
  fi
  [ "$CLEAN" = 1 ] && rm -rf "$dir/build" "$dir/sdkconfig" "$dir/sdkconfig.old"
  log="$dir/build.log"; t0=$SECONDS
  ( cd "$dir" && idf.py -B build -DIDF_TARGET="$TARGET" build ) >"$log" 2>&1
  rc=$?; secs=$((SECONDS-t0))
  # warnings in the course's own files only (main/), not in ESP-IDF
  warn="$(grep -E "$id/main/[^ ]*: warning:" "$log" | sort -u | wc -l)"
  if [ $rc -eq 0 ]; then
    status=PASS; err=""; pass=$((pass+1))
  else
    status=FAIL; err="$(first_error "$log")"; fail=$((fail+1))
  fi
  printf '%-26s %-5s %5s %4s  %s\n' "$id" "$status" "$secs" "$warn" "$err"
  printf '%s\t%s\t%s\t%s\t%s\n' "$id" "$status" "$secs" "$warn" "$err" >> "$TMP"
done
echo
echo "$pass passed, $fail failed (target $TARGET, ESP-IDF ${IDF_VER_FILE:-?} ${IDF_VER}, gcc $GCC_VER). Logs: $OUT/<id>/build.log"

if [ "$ALL" = 1 ]; then
  mv "$TMP" "$RES"
  IDF_VER="$IDF_VER" IDF_VER_FILE="$IDF_VER_FILE" GCC_VER="$GCC_VER" TARGET="$TARGET" node "$HERE/report.mjs" > "$HERE/RESULTS.md" \
    && echo "wrote $HERE/RESULTS.md"
else
  rm -f "$TMP"
fi
[ "$fail" -eq 0 ]
