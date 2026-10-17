param(
    [Parameter(Mandatory = $true)][string]$InputApk,
    [string]$OutputApk,
    [string]$SigningMetadata,
    [string]$BuildTools
)

# All signing operations stay on this computer. No network calls or secret output.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputApk) { $OutputApk = Join-Path $projectRoot '.tmp/android-release/WAVE-Player.apk' }
if (-not $SigningMetadata) { $SigningMetadata = Join-Path $projectRoot '.tmp/android-signing/signing.json' }
if (-not $BuildTools) { $BuildTools = Join-Path $projectRoot '.tmp/android-tooling/android-15' }
$inputPath = (Resolve-Path -LiteralPath $InputApk).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputApk)
if ($inputPath -eq $outputPath) { throw 'Choose a different output path from the unsigned APK.' }
$outputDirectory = Split-Path -Parent $outputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$alignedPath = Join-Path $outputDirectory 'wave-aligned-unsigned.apk'
$zipalign = Join-Path $BuildTools 'zipalign.exe'
$signer = Join-Path $BuildTools 'lib/apksigner.jar'
if (-not (Test-Path -LiteralPath $zipalign) -or -not (Test-Path -LiteralPath $signer)) {
    throw 'Android build tools not found. Supply -BuildTools with the SDK build-tools/35.0.0 directory.'
}
$signing = Get-Content -Raw -LiteralPath $SigningMetadata | ConvertFrom-Json
$previousStorePassword = $env:WAVE_LOCAL_STORE_PASSWORD
$previousKeyPassword = $env:WAVE_LOCAL_KEY_PASSWORD
try {
    $env:WAVE_LOCAL_STORE_PASSWORD = $signing.storePassword
    $env:WAVE_LOCAL_KEY_PASSWORD = $signing.keyPassword
    & $zipalign -f -p 4 $inputPath $alignedPath
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & java -jar $signer sign --ks $signing.keystorePath --ks-key-alias $signing.keyAlias --ks-pass env:WAVE_LOCAL_STORE_PASSWORD --key-pass env:WAVE_LOCAL_KEY_PASSWORD --out $outputPath $alignedPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & java -jar $signer verify --verbose --print-certs $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    & $zipalign -c 4 $outputPath
    if ($LASTEXITCODE -ne 0) { throw 'Signed APK alignment verification failed.' }
    $digest = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$digest  $([System.IO.Path]::GetFileName($outputPath))" | Set-Content -Encoding ascii -LiteralPath "$outputPath.sha256"
    Write-Output "Verified signed APK: $outputPath"
    Write-Output "SHA-256: $digest"
} finally {
    $env:WAVE_LOCAL_STORE_PASSWORD = $previousStorePassword
    $env:WAVE_LOCAL_KEY_PASSWORD = $previousKeyPassword
    $signing = $null
    # Delete only this script's known intermediate file; preserve source and signed APK.
    if (Test-Path -LiteralPath $alignedPath) { Remove-Item -LiteralPath $alignedPath }
}
