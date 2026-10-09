<#
  JrTech Media Bridge
  Servidor local (só 127.0.0.1) que deixa o wallpaper controlar a música
  tocando no Windows (Chrome, Edge, Firefox, Spotify...) e o volume geral.

  Usa os Controles de Mídia do Windows (os mesmos dos botões de mídia do
  teclado). Nada é instalado e nada sai do seu PC.

  Rotas (GET):
    /state                      estado da música e do volume (JSON)
    /thumb?k=<chave>            capa da música atual (imagem)
    /cmd/playpause | /cmd/next | /cmd/prev
    /cmd/seek?t=<segundos>
    /cmd/volume?v=<0..1>
    /cmd/mute?m=<0|1|toggle>
#>

$ErrorActionPreference = 'Stop'
$Port = 47833

# Uma instância só
$mutex = New-Object System.Threading.Mutex($false, 'Global\JrTechMediaBridge')
if (-not $mutex.WaitOne(0)) { exit }

# ---------- Volume geral (Core Audio) ----------
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace JrTech {
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out int pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  }

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int NotImpl1();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  class MMDeviceEnumeratorComObject { }

  public static class Audio {
    static IAudioEndpointVolume Vol() {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static float GetVolume() { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    public static void SetVolume(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), Guid.Empty)); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    public static void SetMute(bool m) { Marshal.ThrowExceptionForHR(Vol().SetMute(m, Guid.Empty)); }
  }
}
'@

# ---------- Controles de mídia do Windows (WinRT) ----------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTaskOp = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]

function Await($op, [type]$type) {
  $task = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(4000)) { throw 'timeout' }
  $task.Result
}

$T_MGR = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$T_PROPS = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$T_STREAM = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]

$script:mgr = Await ($T_MGR::RequestAsync()) $T_MGR
$script:thumb = @{ key = ''; bytes = $null; type = 'image/png' }
$script:asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [type[]]@([Windows.Storage.Streams.IInputStream]))

# O Firefox se registra no Windows com um código (hash da pasta de instalação)
$script:firefoxIds = @()
foreach ($k in 'HKLM:\SOFTWARE\Mozilla\Firefox\TaskBarIDs', 'HKCU:\SOFTWARE\Mozilla\Firefox\TaskBarIDs') {
  if (Test-Path $k) {
    $item = Get-Item $k
    foreach ($n in $item.GetValueNames()) { $script:firefoxIds += "$($item.GetValue($n))".ToLower() }
  }
}

function Get-Session {
  $s = $script:mgr.GetCurrentSession()
  if ($s) { return $s }
  # Sem sessão "atual": pega a primeira que estiver tocando
  foreach ($x in $script:mgr.GetSessions()) {
    if ($x.GetPlaybackInfo().PlaybackStatus -eq 'Playing') { return $x }
  }
  return $null
}

function Get-AppName([string]$aumid) {
  $a = $aumid.ToLower()
  if ($a -match 'msedge') { return 'Edge' }
  if ($a -match 'chrome') { return 'Chrome' }
  if ($a -match 'firefox' -or $a -match '308046b0af4a39cb' -or $script:firefoxIds -contains $a) { return 'Firefox' }
  if ($a -match 'spotify') { return 'Spotify' }
  if ($a -match 'opera') { return 'Opera' }
  if ($a -match 'brave') { return 'Brave' }
  if ($a -match 'zunemusic|mediaplayer') { return 'Media Player' }
  return ''
}

function Read-Thumb($props, [string]$key) {
  if ($script:thumb.key -eq $key) { return }
  $script:thumb = @{ key = $key; bytes = $null; type = 'image/png' }
  if (-not $props.Thumbnail) { return }
  try {
    $stream = Await ($props.Thumbnail.OpenReadAsync()) $T_STREAM
    # Chamada por reflexão: o PowerShell não acha a sobrecarga sozinho
    $net = $script:asStreamForRead.Invoke($null, @($stream))
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $net.Dispose()
    $b = $ms.ToArray()
    $script:thumb.bytes = $b
    $script:thumb.type = if ($b.Length -gt 2 -and $b[0] -eq 0xFF -and $b[1] -eq 0xD8) { 'image/jpeg' } else { 'image/png' }
  } catch { }
}

# ---------- Extensão do navegador (JrTech Media Link) ----------
# Alguns navegadores (ex.: Firefox + YouTube Music) não passam o tempo da música
# ao Windows. A extensão lê o player da página e manda para cá; a busca volta
# para ela como um comando pendente.
$script:ext = @{}      # aba -> @{ pos; dur; paused; at }
$script:pending = @{}  # aba -> segundos para buscar
$BROWSERS = @('Firefox', 'Chrome', 'Edge', 'Opera', 'Brave', '')

function Get-ExtReport {
  $now = [DateTime]::UtcNow
  $best = $null
  foreach ($k in @($script:ext.Keys)) {
    $r = $script:ext[$k]
    if (($now - $r.at).TotalSeconds -gt 4) { $script:ext.Remove($k); continue }
    if (-not $best -or ($best.paused -and -not $r.paused) -or ($best.paused -eq $r.paused -and $r.at -gt $best.at)) { $best = $r }
  }
  return $best
}

function Set-ExtReport($q) {
  $inv = [Globalization.CultureInfo]::InvariantCulture
  $tab = "$($q['tab'])"
  $script:ext[$tab] = @{
    tab    = $tab
    pos    = [double]::Parse($q['pos'], $inv)
    dur    = [double]::Parse($q['dur'], $inv)
    paused = $q['paused'] -eq '1'
    at     = [DateTime]::UtcNow
  }
  $reply = @{ ok = $true }
  if ($script:pending.ContainsKey($tab)) {
    $reply.seek = $script:pending[$tab]
    $script:pending.Remove($tab)
  }
  return $reply
}

function Get-State {
  $vol = $null
  try { $vol = @{ level = [math]::Round([JrTech.Audio]::GetVolume(), 3); muted = [JrTech.Audio]::GetMute() } } catch { }

  $session = $null
  $s = Get-Session
  if ($s) {
    $props = Await ($s.TryGetMediaPropertiesAsync()) $T_PROPS
    $info = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $status = "$($info.PlaybackStatus)".ToLower()
    $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
    $pos = ($tl.Position - $tl.StartTime).TotalSeconds
    # A posição vem do último update do player; avança o tempo decorrido se está tocando
    if ($status -eq 'playing' -and $tl.LastUpdatedTime.Year -gt 2000) {
      $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
    }
    if ($dur -gt 0) { $pos = [math]::Max(0, [math]::Min($dur, $pos)) } else { $pos = 0 }
    $canSeek = [bool]($info.Controls.IsPlaybackPositionEnabled -and $dur -gt 0)
    $app = Get-AppName $s.SourceAppUserModelId
    $seekVia = 'windows'

    # Sem tempo vindo do Windows: usa o que a extensão leu do player
    if ($dur -le 0 -and $BROWSERS -contains $app) {
      $r = Get-ExtReport
      if ($r -and $r.dur -gt 0) {
        $dur = $r.dur
        $pos = $r.pos
        if (-not $r.paused) { $pos += ([DateTime]::UtcNow - $r.at).TotalSeconds }
        $pos = [math]::Max(0, [math]::Min($dur, $pos))
        $canSeek = $true
        $seekVia = 'extension'
      }
    }

    $key = '{0}|{1}|{2}' -f $props.Title, $props.Artist, $props.AlbumTitle
    $key = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($key)).Replace('/', '_').Replace('+', '-').TrimEnd('=')
    Read-Thumb $props $key

    $session = @{
      app       = $app
      title     = $props.Title
      artist    = $props.Artist
      album     = $props.AlbumTitle
      status    = $status
      position  = [math]::Round($pos, 2)
      duration  = [math]::Round($dur, 2)
      canSeek   = $canSeek
      seekVia   = $seekVia
      linkSeen  = [bool]($script:ext.Count -gt 0)
      canNext   = [bool]$info.Controls.IsNextEnabled
      canPrev   = [bool]$info.Controls.IsPreviousEnabled
      canToggle = [bool]($info.Controls.IsPlayPauseToggleEnabled -or $info.Controls.IsPlayEnabled -or $info.Controls.IsPauseEnabled)
      thumbKey  = $(if ($script:thumb.bytes) { $key } else { '' })
    }
  }
  return @{ ok = $true; session = $session; volume = $vol }
}

function Invoke-Cmd([string]$name, $query) {
  if ($name -eq 'volume') {
    $v = [double]::Parse($query['v'], [Globalization.CultureInfo]::InvariantCulture)
    [JrTech.Audio]::SetVolume([float]$v)
    if ($v -gt 0 -and [JrTech.Audio]::GetMute()) { [JrTech.Audio]::SetMute($false) }
    return $true
  }
  if ($name -eq 'mute') {
    $m = $query['m']
    $target = if ($m -eq 'toggle') { -not [JrTech.Audio]::GetMute() } else { $m -eq '1' }
    [JrTech.Audio]::SetMute($target)
    return $true
  }
  $s = Get-Session
  if (-not $s) { return $false }
  switch ($name) {
    'playpause' { return Await ($s.TryTogglePlayPauseAsync()) ([bool]) }
    'next' { return Await ($s.TrySkipNextAsync()) ([bool]) }
    'prev' { return Await ($s.TrySkipPreviousAsync()) ([bool]) }
    'seek' {
      $t = [double]::Parse($query['t'], [Globalization.CultureInfo]::InvariantCulture)
      $tl = $s.GetTimelineProperties()
      if (($tl.EndTime - $tl.StartTime).TotalSeconds -le 0) {
        # O Windows não conhece o tempo: a extensão aplica a busca no player
        $r = Get-ExtReport
        if (-not $r) { return $false }
        $script:pending[$r.tab] = $t
        $r.pos = $t
        $r.at = [DateTime]::UtcNow
        return $true
      }
      $start = $tl.StartTime
      $ticks = [long](($start.TotalSeconds + $t) * 10000000)
      return Await ($s.TryChangePlaybackPositionAsync($ticks)) ([bool])
    }
  }
  return $false
}

function Send($ctx, [int]$code, [byte[]]$body, [string]$type) {
  $res = $ctx.Response
  $res.StatusCode = $code
  $res.Headers['Access-Control-Allow-Origin'] = '*'
  $res.Headers['Access-Control-Allow-Private-Network'] = 'true'
  $res.Headers['Cache-Control'] = 'no-store'
  $res.ContentType = $type
  if ($body) {
    $res.ContentLength64 = $body.Length
    $res.OutputStream.Write($body, 0, $body.Length)
  }
  $res.OutputStream.Close()
}

function Send-Json($ctx, $obj, [int]$code = 200) {
  $json = $obj | ConvertTo-Json -Depth 5 -Compress
  Send $ctx $code ([Text.Encoding]::UTF8.GetBytes($json)) 'application/json; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $req = $ctx.Request
    $path = $req.Url.AbsolutePath.TrimEnd('/')
    if ($req.HttpMethod -eq 'OPTIONS') {
      $ctx.Response.Headers['Access-Control-Allow-Methods'] = 'GET'
      Send $ctx 204 $null 'text/plain'
    }
    elseif ($path -eq '/state') {
      Send-Json $ctx (Get-State)
    }
    elseif ($path -eq '/thumb') {
      if ($script:thumb.bytes -and $req.QueryString['k'] -eq $script:thumb.key) {
        Send $ctx 200 $script:thumb.bytes $script:thumb.type
      } else {
        Send $ctx 404 $null 'text/plain'
      }
    }
    elseif ($path -eq '/ext/report') {
      Send-Json $ctx (Set-ExtReport $req.QueryString)
    }
    elseif ($path -like '/cmd/*') {
      $ok = Invoke-Cmd ($path.Substring(5)) $req.QueryString
      Send-Json $ctx @{ ok = [bool]$ok }
    }
    else {
      Send-Json $ctx @{ ok = $false; error = 'rota desconhecida' } 404
    }
  } catch {
    try { Send-Json $ctx @{ ok = $false; error = "$($_.Exception.Message)" } 500 } catch { }
  }
}
