$ErrorActionPreference = 'Stop'
function Get-WhaleFullPath([string]$Path) { return [IO.Path]::GetFullPath($Path).TrimEnd('\') }
function Assert-WhalePlainPath([string]$Path) {
    $cursor = Get-WhaleFullPath $Path
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation and backup paths cannot contain links or junctions.' }
        $next = Split-Path -Parent $cursor
        if ($next -eq $cursor) { break }; $cursor = $next
    }
}
function Copy-WhaleTree([string]$Source, [string]$Destination, [string[]]$Exclude = @()) {
    Assert-WhalePlainPath $Source; Assert-WhalePlainPath $Destination
    $null = New-Item -ItemType Directory -Path $Destination -Force
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Name -in $Exclude) { continue }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to copy a link or junction.' }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-WhaleTree $item.FullName $target } else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
    }
}
function Write-WhaleReceipt([string]$Path, $Value) {
    $temporary = $Path + '.' + $PID + '.tmp'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Sync-WhaleCode([string]$Source, [string]$Destination, [string]$Retired) {
    # Some applications keep a directory handle open. Update validated code
    # files individually after a full checkpoint instead of renaming that root.
    foreach($location in @($Source,$Destination,$Retired)){Assert-WhalePlainPath $location}
    $sourceRoot=Get-WhaleFullPath $Source
    $destinationRoot=Get-WhaleFullPath $Destination
    $retiredRoot=Get-WhaleFullPath $Retired
    if($sourceRoot -ieq $destinationRoot){return}
    $files=@{}
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | ForEach-Object { $files[$_.FullName.Substring($sourceRoot.Length+1)]=$true }
    Copy-WhaleTree $sourceRoot $destinationRoot @('node_modules','.git')
    Get-ChildItem -LiteralPath $destinationRoot -Recurse -File -Force | ForEach-Object {
        $relative=$_.FullName.Substring($destinationRoot.Length+1)
        if($relative -match '^(node_modules|\.git)[\\/]'){return}
        if(!$files.ContainsKey($relative)){
            $old=Get-WhaleFullPath (Join-Path $retiredRoot $relative)
            if(!$_.FullName.StartsWith($destinationRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or !$old.StartsWith($retiredRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe code archive path.'}
            $null=New-Item -ItemType Directory -Path (Split-Path -Parent $old) -Force
            Move-Item -LiteralPath $_.FullName -Destination $old
        }
    }
}
function Find-WhaleNode {
    $candidates = @()
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    $candidates += Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    foreach ($node in $candidates) {
        if (!(Test-Path -LiteralPath $node -PathType Leaf)) { continue }
        $major = & $node -p 'parseInt(process.versions.node)'
        if ($LASTEXITCODE -eq 0 -and [int]$major -ge 24) {
            $env:PATH = (Split-Path -Parent $node) + ';' + $env:PATH
            return $node
        }
    }
    throw 'Install Node.js 24 or newer, including npm, then run the installer again.'
}
function Find-WhaleCodex([string]$Explicit) {
    $candidates = @()
    if ($Explicit) { $candidates += $Explicit }
    else {
        $desktopBins = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
        if (Test-Path -LiteralPath $desktopBins -PathType Container) { $candidates += @(Get-ChildItem -LiteralPath $desktopBins -Filter codex.exe -File -Recurse | Sort-Object LastWriteTimeUtc -Descending | Select-Object -ExpandProperty FullName) }
        $app = Get-AppxPackage -Name '*Codex*' -ErrorAction SilentlyContinue
        foreach ($package in $app) { foreach ($relative in @('app\resources\codex.exe','app\resources\bin\codex.exe','resources\codex.exe')) { $candidates += Join-Path $package.InstallLocation $relative } }
        $command = Get-Command codex.cmd,codex.exe -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { $candidates += $command.Source }
    }
    foreach ($candidate in $candidates) {
        if (!(Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $null = & $candidate plugin add --help 2>&1; $code = $LASTEXITCODE } finally { $ErrorActionPreference = $old }
        if ($code -eq 0) { return (Get-WhaleFullPath $candidate) }
    }
    throw 'A Codex CLI with plugin add support is required. Update Codex or pass -CodexCli with the desktop-bundled CLI path.'
}
function Invoke-WhaleCommand([string]$Command, [string[]]$Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw ('Command failed (exit ' + $LASTEXITCODE + '). Installation is not complete.') }
}
