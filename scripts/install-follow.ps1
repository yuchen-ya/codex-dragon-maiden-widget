param([string]$DataDir, [switch]$NoStart, [switch]$NoStartup)
$ErrorActionPreference = 'Stop'
$whaleRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$DataDir) {
    $whaleCodex = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $DataDir = if ($env:WHALE_HOME) { $env:WHALE_HOME } else { Join-Path $whaleCodex 'dragon-maiden-widget' }
}
$DataDir = [IO.Path]::GetFullPath($DataDir)
$whaleElectron = Join-Path $DataDir 'desktop-runtime\node_modules\electron\dist\electron.exe'
if (!(Test-Path -LiteralPath $whaleElectron)) { throw 'Please run install-desktop.mjs first.' }
$whaleScript = Join-Path $whaleRoot 'desktop\supervisor.ps1'
$whaleLauncher = & (Join-Path $PSScriptRoot 'build-launcher.ps1') -DataDir $DataDir
if (!$whaleLauncher -or !(Test-Path -LiteralPath $whaleLauncher -PathType Leaf)) { throw 'The GUI launcher is unavailable.' }
$whaleQuotedData = '"' + [regex]::Replace($DataDir, '(\\+)$', '$1$1') + '"'
$whaleArguments = '--script "' + $whaleScript + '" --data ' + $whaleQuotedData
$whaleStartup = Join-Path (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup') 'Codex Dragon Maiden Widget.lnk'
$whaleShell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $whaleStartup) {
    $existing = $whaleShell.CreateShortcut($whaleStartup)
    if ($existing.TargetPath -ine $whaleLauncher -or $existing.Arguments -cne $whaleArguments) {
        throw 'The startup shortcut belongs to another installation.'
    }
}
if (!$NoStartup) {
    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $whaleStartup) -Force
    $shortcut = $whaleShell.CreateShortcut($whaleStartup)
    $shortcut.TargetPath = $whaleLauncher
    $shortcut.Arguments = $whaleArguments
    $shortcut.WorkingDirectory = $DataDir
    $shortcut.Description = 'Codex Dragon Maiden Widget'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
    $verified = $whaleShell.CreateShortcut($whaleStartup)
    if ($verified.TargetPath -ine $whaleLauncher -or $verified.Arguments -cne $whaleArguments) { throw 'Startup shortcut verification failed.' }
}
& (Join-Path $whaleRoot 'desktop\supervisor.ps1') -DataDir $DataDir -Stop
for ($attempt=0; $attempt -lt 60; $attempt++) {
    if (!(Test-Path -LiteralPath (Join-Path $DataDir 'supervisor-state.json'))) { break }
    Start-Sleep -Milliseconds 200
}
if (Test-Path -LiteralPath (Join-Path $DataDir 'supervisor-state.json')) { throw 'The previous supervisor did not stop.' }
@{ enabled=$true; pluginRoot=$whaleRoot; electronPath=$whaleElectron; launcherPath=$whaleLauncher; startupLink=$whaleStartup; mode='follow-codex'; revision='dragon-maiden-v1'; launchMode='startup-shortcut' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDir 'follow-config.json') -Encoding utf8
if (!$NoStart) {
    Start-Process -FilePath $whaleLauncher -ArgumentList $whaleArguments -WorkingDirectory $DataDir -WindowStyle Hidden
    $started = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        $stateFile = Join-Path $DataDir 'supervisor-state.json'
        if (Test-Path -LiteralPath $stateFile) {
            $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
            $worker = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$state.pid) -ErrorAction SilentlyContinue
            if ($worker -and $worker.CommandLine.Contains($whaleScript) -and $state.consoleAttached -eq $false) { $started=$true; break }
        }
        Start-Sleep -Milliseconds 200
    }
    if (!$started) { throw 'The GUI supervisor did not start. Check launcher-error.json.' }
}
@{ startupLink=$whaleStartup; hostPath=$whaleLauncher; pluginRoot=$whaleRoot; launchMode='startup-shortcut'; started=(!$NoStart); installedAt=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DataDir 'follow-install.json') -Encoding utf8
Write-Output 'Dragon Maiden login startup installed for the current user. No administrator access or terminal window required.'
