#!/usr/bin/env bash
# Builds the standalone launchers into dist/. Needs Go 1.22 or newer; cross-compiles from any platform.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
site="$here/site"
mkdir -p "$site" "$repo/dist"
# refresh the embedded copy of the web app
for d in css js; do
  mkdir -p "$site/$d"
  cp -R "$repo/$d/." "$site/$d/"
done
cp "$repo/index.html" "$site/index.html"

cd "$here"
build() { # os arch output
  GOOS="$1" GOARCH="$2" CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$repo/dist/$3" .
  echo "built dist/$3"
}
build linux   amd64 bench-linux-x86_64
build linux   arm64 bench-linux-arm64
build windows amd64 bench-windows-x86_64.exe
build windows arm64 bench-windows-arm64.exe
