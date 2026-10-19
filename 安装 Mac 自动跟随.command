#!/bin/zsh
set -e
cd "$(dirname "$0")"
exec /bin/zsh scripts/macos-launcher.command scripts/install-macos.mjs "$@"
