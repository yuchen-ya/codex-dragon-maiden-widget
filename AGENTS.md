# Repository Guidelines

## Project Structure & Module Organization

This repository adapts Codex-Whale-Public into a dragon-maiden desktop companion. The first image and variant A are selectable builtins; the UI reads Codex subscription quota. Approved quotes use the native quota bubble; the menu opens settings directly. Installer identity is `codex-dragon-maiden-widget`, with independent data and startup tasks. Preserve these boundaries when changing installation code.

- `runtime/`: configuration, provider balances, session usage, accounting, and MCP services.
- `lib/`: resource storage, media validation, widget hosting, and workshop logic.
- `desktop/`: Electron host and native window helpers; `desktop/ui/` contains the renderer.
- `assets/`: character images, audio, animations, and the existing widget script.
- `scripts/`: launch, installation, rollback, packaging, and verification tools.
- `tests/`: automated tests, fixtures, and manual audit utilities.
- `docs/`: media attribution, public quote sources, and validation records.
- `.codex-plugin/` and `skills/`: plugin metadata and integration instructions.
- `dist/` and `qa-output/`: ignored release archives and isolated verification output.

Use this checkout as the sole project workspace. Keep media drafts, build scripts, previews, and verification artifacts here; place intermediate files in ignored `qa-output/`. Installed plugin directories are deployment targets, not development workspaces.

## Build, Test, and Development Commands

Use Node.js 24+ from the repository root. No application compilation step is required.

- `npm test`: run the Node test suite.
- `node --test tests/core.test.mjs`: run one focused suite.
- `node scripts/check-package.mjs`: verify release metadata, required files, and module imports.
- `node scripts/install-desktop.mjs`: provision the Electron runtime before first launch.
- `python scripts/build-release.py --release-tag v0.1.2`: build clean installation/source ZIPs; never uploads.
- `npm start`: open the widget; `npm run desktop` selects standalone desktop mode.

For development and tests, isolate local data using PowerShell:

```powershell
$env:CODEX_HOME = "$PWD/qa-output/dev/codex"
$env:WHALE_HOME = "$PWD/qa-output/dev/whale"
```

On macOS, use `export CODEX_HOME="$PWD/qa-output/dev/codex"` and
`export WHALE_HOME="$PWD/qa-output/dev/whale"`. The Finder launchers locate Node
24+; `zsh scripts/macos-launcher.command --test tests/*.test.mjs` uses that same
interpreter selection. After installing Electron into the isolated data home,
run `npm run smoke:mac` and `npm run smoke:mac-follow` sequentially. Both open
native windows, so concurrent runs can interfere with foreground/focus checks.

## Coding Style & Naming Conventions

Match surrounding code: two-space JavaScript indentation, semicolons, and single-quoted strings. Use `.mjs` for Node ES modules, `.cjs` for Electron CommonJS modules, kebab-case filenames, camelCase functions, and PascalCase classes. No formatter or linter is configured.

Prefer existing modules and platform APIs. Validate external inputs, keep changes focused, and avoid blanket renaming of internal `whale` symbols.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`, with `*.test.mjs` filenames. Cover changed observable behavior and regressions using temporary directories and fake credentials. No numeric coverage threshold is configured. Run relevant suites and package validation; run the full suite for runtime changes. Visually check artwork cropping, transparency, dragging, and click regions when changing character assets.

## Commit & Pull Request Guidelines

This repository starts from one clean source snapshot. Use `feat:`, `fix:`, `docs:`, or `art:` prefixes for new commits. Write concise, scoped commit subjects. PRs should explain the resulting behavior, link relevant issues, report validation, and include screenshots for visual changes.

## Security & Attribution

Never commit credentials, IPC tokens, private configuration, or ledgers. Preserve `LICENSE`, `PROVENANCE.md`, and media attribution; code licensing does not automatically cover artwork. Follow `SECURITY.md` for private vulnerability reporting.
