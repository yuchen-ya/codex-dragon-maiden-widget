param([string]$Receipt, [string]$DataDir, [switch]$CheckOnly)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') { throw 'Use Windows PowerShell (powershell.exe).' }
. (Join-Path $PSScriptRoot 'package-common.ps1')
if (!$Receipt) {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    if (!$DataDir) { $DataDir = if ($env:WHALE_HOME) { $env:WHALE_HOME } else { Join-Path $codexHome 'dragon-maiden-widget' } }
    $pointer = Get-Content -LiteralPath (Join-Path $DataDir 'package-installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Receipt=$pointer.receipt
}
$Receipt=Get-WhaleFullPath $Receipt
$saved=Get-Content -LiteralPath $Receipt -Raw -Encoding UTF8 | ConvertFrom-Json
$expectedTarget=Get-WhaleFullPath (Join-Path $env:USERPROFILE 'plugins\codex-dragon-maiden-widget')
$backup=Get-WhaleFullPath (Split-Path -Parent $Receipt)
if ($saved.format -ne 1 -or $saved.plugin -cne 'codex-dragon-maiden-widget' -or (Get-WhaleFullPath $saved.target) -ine $expectedTarget -or (Get-WhaleFullPath $saved.backup) -ine $backup) { throw 'Invalid rollback receipt.' }
foreach($location in @($backup,$expectedTarget,$saved.dataDir)){Assert-WhalePlainPath $location}
$priorSource=Join-Path $backup 'plugin'
if ($saved.previousVersion) {
    $priorManifest=Get-Content -LiteralPath (Join-Path $priorSource '.codex-plugin\plugin.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($priorManifest.name -cne 'codex-dragon-maiden-widget' -or $priorManifest.version -cne $saved.previousVersion){throw 'Backup plugin identity mismatch.'}
}
$cli=Find-WhaleCodex $saved.codexCli
$node=Find-WhaleNode
$marketReceipt=Join-Path $backup 'marketplace-entry.json'
if(Test-Path -LiteralPath $marketReceipt){Invoke-WhaleCommand $node @((Join-Path $PSScriptRoot 'marketplace-helper.mjs'),'check-restore',$marketReceipt)}
if($CheckOnly){@{ok=$true;restoreVersion=$saved.previousVersion;preserveCurrentData=$true;stage=$saved.stage}|ConvertTo-Json;return}
$checkpoint=Join-Path $backup ('before-rollback-'+[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$null=New-Item -ItemType Directory -Path $checkpoint
# The invoking script may live in the plugin cache removed by `plugin remove`.
# Keep the self-contained helper outside both the cache and installation tree.
$stableMarketHelper=Join-Path $checkpoint 'marketplace-helper.mjs'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'marketplace-helper.mjs') -Destination $stableMarketHelper
if(Test-Path -LiteralPath $expectedTarget){Copy-WhaleTree $expectedTarget (Join-Path $checkpoint 'plugin') @('node_modules','.git')}
if(Test-Path -LiteralPath $saved.dataDir){Copy-WhaleTree $saved.dataDir (Join-Path $checkpoint 'data') @('desktop-runtime','desktop-profile','native','npm-cache')}
if(Test-Path -LiteralPath (Join-Path $expectedTarget 'scripts\uninstall-follow.ps1')) { & (Join-Path $expectedTarget 'scripts\uninstall-follow.ps1') -DataDir $saved.dataDir }
if(!$saved.previousVersion -and (Test-Path -LiteralPath (Join-Path $expectedTarget 'scripts\uninstall-interaction-hooks.mjs'))){
    Invoke-WhaleCommand $node @((Join-Path $expectedTarget 'scripts\uninstall-interaction-hooks.mjs'))
}
if($saved.stage -in @('plugin-registered','complete')) { Invoke-WhaleCommand $cli @('plugin','remove',('codex-dragon-maiden-widget@'+$saved.marketplace),'--json') }
if(Test-Path -LiteralPath $expectedTarget){
    $retired=Join-Path $checkpoint 'retired-source'
    Assert-WhalePlainPath $expectedTarget; Assert-WhalePlainPath $retired
    try { Move-Item -LiteralPath $expectedTarget -Destination $retired -ErrorAction Stop }
    catch [System.IO.IOException] { if(!$saved.previousVersion){throw}; Sync-WhaleCode $priorSource $expectedTarget (Join-Path $checkpoint 'retired-files') }
    catch [System.UnauthorizedAccessException] { if(!$saved.previousVersion){throw}; Sync-WhaleCode $priorSource $expectedTarget (Join-Path $checkpoint 'retired-files') }
}
if($saved.previousVersion){Copy-WhaleTree $priorSource $expectedTarget}
if(Test-Path -LiteralPath $marketReceipt){Invoke-WhaleCommand $node @($stableMarketHelper,'restore',$marketReceipt)}
if($saved.previousVersion){Invoke-WhaleCommand $cli @('plugin','add',('codex-dragon-maiden-widget@'+$saved.marketplace),'--json')}
if($saved.previousStartup -and $saved.previousVersion) { & (Join-Path $expectedTarget 'scripts\install-follow.ps1') -DataDir $saved.dataDir }
# Restore only installation metadata; newer settings, resources and usage remain.
$installationPointer=Get-WhaleFullPath (Join-Path $saved.dataDir 'package-installation.json')
$priorPointer=Join-Path (Join-Path $backup 'data') 'package-installation.json'
Assert-WhalePlainPath $installationPointer
Assert-WhalePlainPath $priorPointer
if(Test-Path -LiteralPath $priorPointer -PathType Leaf){
    Copy-Item -LiteralPath $priorPointer -Destination $installationPointer -Force
}elseif(Test-Path -LiteralPath $installationPointer -PathType Leaf){
    $currentPointer=Get-Content -LiteralPath $installationPointer -Raw -Encoding UTF8|ConvertFrom-Json
    if($currentPointer.receipt -and (Get-WhaleFullPath $currentPointer.receipt) -ieq $Receipt){
        Remove-Item -LiteralPath $installationPointer -Force
    }
}
Write-Output ('Rollback complete. Current settings, resources and ledger retained. Private checkpoint: '+$checkpoint)
