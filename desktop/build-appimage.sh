#!/usr/bin/env bash
# Packages dist/mitre-prep-tool-linux-x86_64 as dist/Mitre_Prep_Tool-x86_64.AppImage.
#
# A type-2 AppImage is the AppImage runtime (a small static ELF) followed by a SquashFS image of the
# application directory. This script assembles exactly that; it downloads nothing and runs nothing it
# did not build.
#
# Prerequisites:
#   - run ./desktop/build.sh first
#   - mksquashfs on PATH (Debian/Ubuntu: apt install squashfs-tools)
#   - the AppImage runtime for x86_64 from https://github.com/AppImage/type2-runtime/releases
#     (file runtime-x86_64); pass its path as the first argument or in $APPIMAGE_RUNTIME
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
runtime="${1:-${APPIMAGE_RUNTIME:-}}"
[ -n "$runtime" ] && [ -f "$runtime" ] || { echo "usage: $0 /path/to/runtime-x86_64" >&2; exit 2; }
[ -x "$repo/dist/mitre-prep-tool-linux-x86_64" ] || { echo "run ./desktop/build.sh first" >&2; exit 2; }
command -v mksquashfs >/dev/null || { echo "mksquashfs not found: install squashfs-tools" >&2; exit 2; }

work="$(mktemp -d)"
appdir="$work/MitrePrepTool.AppDir"
mkdir -p "$appdir/usr/bin" "$appdir/usr/share/applications" "$appdir/usr/share/icons/hicolor/scalable/apps"
cp "$repo/dist/mitre-prep-tool-linux-x86_64" "$appdir/usr/bin/mitre-prep-tool"
cp "$here/appimage/AppRun" "$appdir/AppRun"
chmod 755 "$appdir/AppRun" "$appdir/usr/bin/mitre-prep-tool"
cp "$here/appimage/mitre-prep-tool.desktop" "$appdir/mitre-prep-tool.desktop"
cp "$here/appimage/mitre-prep-tool.desktop" "$appdir/usr/share/applications/mitre-prep-tool.desktop"
cp "$here/appimage/mitre-prep-tool.svg" "$appdir/mitre-prep-tool.svg"
cp "$here/appimage/mitre-prep-tool.svg" "$appdir/usr/share/icons/hicolor/scalable/apps/mitre-prep-tool.svg"
cp "$here/appimage/mitre-prep-tool.svg" "$appdir/.DirIcon"

mksquashfs "$appdir" "$work/app.squashfs" -root-owned -noappend -comp gzip -quiet -no-progress
out="$repo/dist/Mitre_Prep_Tool-x86_64.AppImage"
cat "$runtime" "$work/app.squashfs" > "$out"
chmod 755 "$out"
echo "built dist/Mitre_Prep_Tool-x86_64.AppImage ($(stat -c %s "$out") bytes; filesystem image starts at offset $(stat -c %s "$runtime"))"
