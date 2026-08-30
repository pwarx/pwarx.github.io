#!/usr/bin/env pwsh
# unpack-wasm-pkg.ps1 – Extract a .wasm-pkg file into a directory tree
param(
    [Parameter(Mandatory=$true)] [string] $Pkg,
    [string] $Out = ""
)

$pkgJson = Get-Content $Pkg -Raw | ConvertFrom-Json
if (-not $Out) {
    $Out = $pkgJson.name
}
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$pkgJson.files.PSObject.Properties | ForEach-Object {
    $path = $_.Name
    $info = $_.Value
    $dest = Join-Path $Out $path
    $dir = Split-Path $dest -Parent
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bytes = [System.Convert]::FromBase64String($info.data)
    [System.IO.File]::WriteAllBytes($dest, $bytes)
}

Write-Host "Extracted $($pkgJson.files.PSObject.Properties.Count) files to $Out/"