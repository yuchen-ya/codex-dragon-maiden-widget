param([string]$DataDir, [string]$CodexCli)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'package-common.ps1')
$target = Join-Path $env:USERPROFILE 'plugins\codex-dragon-maiden-widget'
$manifest = Get-Content -LiteralPath (Join-Path $target '.codex-plugin\plugin.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.name -cne 'codex-dragon-maiden-widget') { throw 'The installed directory belongs to another plugin.' }
$node = Find-WhaleNode
$cli = Find-WhaleCodex $CodexCli
$marketplace = & $node (Join-Path $PSScriptRoot 'marketplace-helper.mjs') inspect
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine this plugin marketplace.' }
$marketplaceName = ($marketplace | ConvertFrom-Json).marketplaceName
& (Join-Path $target 'scripts\uninstall-follow.ps1') -DataDir $DataDir
Invoke-WhaleCommand $node @((Join-Path $target 'scripts\uninstall-interaction-hooks.mjs'))
Invoke-WhaleCommand $cli @('plugin','remove',('codex-dragon-maiden-widget@'+$marketplaceName),'--json')
Write-Output 'Dragon Maiden integration removed. User settings, media and source files are retained.'
