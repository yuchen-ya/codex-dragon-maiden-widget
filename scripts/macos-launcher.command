#!/bin/zsh
set -e
cd "$(dirname "$0")/.."

# Finder and launchd have a smaller PATH than an interactive terminal. Test the
# interpreter itself rather than assuming the first Homebrew binary is recent.
candidates=(
  "${WHALE_NODE_BIN:-}"
  "${commands[node]:-}"
  /opt/homebrew/bin/node /usr/local/bin/node
  /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  "$HOME/.volta/bin/node"
  "$HOME"/.nvm/versions/node/*/bin/node(NOn)
  "$HOME"/.local/share/mise/installs/node/*/bin/node(NOn)
)
for candidate in "${candidates[@]}"; do
  [[ -x "$candidate" ]] || continue
  if "$candidate" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
    exec "$candidate" "$@"
  fi
done
print -u2 '未找到 Node.js 24+。请安装 Node.js 24 或更新版本，或设置 WHALE_NODE_BIN 指向可用的 node。'
if [[ -t 0 ]]; then read -k 1 '?按任意键退出...'; fi
exit 1
