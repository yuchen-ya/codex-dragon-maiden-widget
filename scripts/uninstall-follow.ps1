param([string]$DataDir)
$ErrorActionPreference = 'Stop'
$whaleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$DataDir) {
    $whaleCodex = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $DataDir = if ($env:WHALE_HOME) { $env:WHALE_HOME } else { Join-Path $whaleCodex 'dragon-maiden-widget' }
}
$DataDir = [IO.Path]::GetFullPath($DataDir)
& (Join-Path $whaleRoot 'desktop\supervisor.ps1') -DataDir $DataDir -Stop
$configFile = Join-Path $DataDir 'follow-config.json'
if (Test-Path -LiteralPath $configFile) {
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $whaleRoot = $config.pluginRoot
    $config.enabled = $false
    $config | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding utf8
}
$startup = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup') 'Codex Dragon Maiden Widget.lnk'
if (Test-Path -LiteralPath $startup) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($startup)
    if (!$shortcut.Arguments.Contains((Join-Path $whaleRoot 'desktop\supervisor.ps1')) -or !$shortcut.Arguments.Contains($DataDir)) { throw 'The startup shortcut belongs to another installation.' }
    Remove-Item -LiteralPath $startup
}
Write-Output 'Automatic following disabled. Settings, resources and records are retained.'
