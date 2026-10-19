#!/bin/zsh
set -e
cd "$(dirname "$0")"
exec /bin/zsh scripts/macos-launcher.command scripts/control.mjs desktop "$@"
