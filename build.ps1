# Gera os pacotes prontos em dist/ (fora do Git):
#   dist/JrTech-Wallpaper-Lively.zip   -> arraste para a biblioteca do Lively
#   dist/JrTechMediaLink-firefox.xpi   -> extensão para o Firefox
# Uso:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

function New-Zip([string]$zipPath, [hashtable]$entries) {
  if (Test-Path -LiteralPath $zipPath) { [IO.File]::Delete($zipPath) }
  $zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    foreach ($name in $entries.Keys) {
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entries[$name], $name)
    }
  } finally { $zip.Dispose() }
}

# Wallpaper: o LivelyInfo.json precisa ficar na raiz do zip
$wp = Join-Path $root 'wallpaper'
$files = @{}
Get-ChildItem -LiteralPath $wp -Recurse -File | ForEach-Object {
  $files[$_.FullName.Substring($wp.Length + 1).Replace('\', '/')] = $_.FullName
}
$wpZip = Join-Path $dist 'JrTech-Wallpaper-Lively.zip'
New-Zip $wpZip $files

# Extensão do Firefox: usa o manifesto MV2 (manifest.firefox.json vira manifest.json)
$ext = Join-Path $root 'browser-extension'
$xpi = Join-Path $dist 'JrTechMediaLink-firefox.xpi'
New-Zip $xpi @{
  'manifest.json' = (Join-Path $ext 'manifest.firefox.json')
  'content.js'    = (Join-Path $ext 'content.js')
  'background.js' = (Join-Path $ext 'background.js')
  'icon128.png'   = (Join-Path $ext 'icon128.png')
}

Get-ChildItem -LiteralPath $dist | ForEach-Object { '{0,-34} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
