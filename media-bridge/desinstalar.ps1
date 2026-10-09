# Remove o JrTech Media Bridge: para o processo, tira da inicialização e apaga os arquivos.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*JrTechMediaBridge.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'JrTech Media Bridge.lnk'
if (Test-Path $lnk) { Remove-Item -Force $lnk }

$dest = Join-Path $env:LOCALAPPDATA 'JrTechMediaBridge'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }

Write-Host 'JrTech Media Bridge removido.' -ForegroundColor Yellow
