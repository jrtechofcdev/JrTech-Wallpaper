# Instala o JrTech Media Bridge para iniciar junto com o Windows (só para o seu usuário).
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'JrTechMediaBridge'
$startup = [Environment]::GetFolderPath('Startup')
$ps1 = Join-Path $dest 'JrTechMediaBridge.ps1'
$vbs = Join-Path $dest 'iniciar-oculto.vbs'

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'JrTechMediaBridge.ps1') $ps1

# Inicia sem abrir nenhuma janela
@"
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$ps1""", 0, False
"@ | Set-Content -Encoding ASCII $vbs

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut((Join-Path $startup 'JrTech Media Bridge.lnk'))
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = "`"$vbs`""
$lnk.WorkingDirectory = $dest
$lnk.Description = 'Controles de música do wallpaper JR_TECH_OFC'
$lnk.Save()

# Reinicia se já estiver rodando
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*JrTechMediaBridge.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 500
Start-Process wscript.exe -ArgumentList "`"$vbs`""

Write-Host 'JrTech Media Bridge instalado e rodando.' -ForegroundColor Green
Write-Host "Arquivos: $dest"
Write-Host 'Ele inicia sozinho com o Windows. Para remover, rode desinstalar.cmd.'
