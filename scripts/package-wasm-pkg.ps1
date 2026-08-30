#!/usr/bin/env pwsh
# package-wasm-pkg.ps1 <src-dir> — Create a .wasm-pkg from a directory tree
param([string] $Src = ".", [string] $Out = ".")

$Src = Resolve-Path $Src
$manifest = Get-Content (Join-Path $Src "manifest.webmanifest") | ConvertFrom-Json
$name = $manifest.name
$entry = "index.html"
$icon = if ($manifest.icons) { $manifest.icons[0].src -replace "^\./", "" } else { "" }
$version = (Get-Content (Join-Path $Src "PORT_VERSION")).Trim()

$mimeMap = @{
    ".html" = "text/html"; ".css" = "text/css"; ".js" = "text/javascript"
    ".wasm" = "application/wasm"; ".json" = "application/json"
    ".png" = "image/png"; ".jpg" = "image/jpeg"; ".jpeg" = "image/jpeg"
    ".svg" = "image/svg+xml"; ".ico" = "image/x-icon"
    ".webmanifest" = "application/manifest+json"
    ".ts" = "video/mp2t"; ".m2ts" = "video/mp2t"
    ".pdi" = "application/octet-stream"; ".pda" = "application/octet-stream"
    ".bin" = "application/octet-stream"
}

$filesHash = @{}
Get-ChildItem $Src -Recurse -File | Sort-Object FullName | ForEach-Object {
    $rel = [System.IO.Path]::GetRelativePath($Src, $_.FullName)
    $ext = $_.Extension.ToLower()
    $mime = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { "application/octet-stream" }
    $data = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($_.FullName))
    $filesHash[$rel] = @{ data = $data; mime = $mime }
}

$out = Join-Path (Resolve-Path $Out) "$name-v$version.wasm-pkg"
$pkg = @{ packageFormat = 1; name = $name; version = $version; entry = $entry; icon = $icon; files = $filesHash }
$json = $pkg | ConvertTo-Json -Depth 10 -Compress
[System.IO.File]::WriteAllText($out, $json)
Write-Host "Wrote $out ($($filesHash.Count) files)"