/* ==========================================================
   Ponte com o Lively Wallpaper. O Lively chama estas funções globais
   quando os argumentos do LivelyInfo.json estão ativos:
   --system-information, --audio, --system-nowplaying, --pause-event.
   Fora do Lively entra o modo prévia, com dados simulados e um selo
   avisando isso na tela.
   ========================================================== */
(function () {
  'use strict';

  const badge = document.getElementById('preview-badge');
  let simTimers = [];

  function parse(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return null; }
  }

  function markLively() {
    if (JRT.state.inLively) return;
    JRT.state.inLively = true;
    stopPreview();
  }

  // Ganho automático: o nível que o Lively manda varia muito com o volume do PC.
  // Normaliza pelo pico recente (cai devagar) para tudo reagir na mesma escala.
  let agcPeak = 0.3;
  let norm = null;

  function feedAudio(arr) {
    if (!arr || !arr.length) return;
    if (!norm || norm.length !== arr.length) norm = new Float32Array(arr.length);
    let max = 0;
    for (let i = 0; i < arr.length; i++) max = Math.max(max, arr[i] || 0);
    agcPeak = Math.max(0.05, max > agcPeak ? max : agcPeak * 0.997);
    for (let i = 0; i < arr.length; i++) norm[i] = Math.min(1, (arr[i] || 0) / agcPeak);

    let sum = 0;
    const n = Math.min(6, norm.length);
    for (let i = 0; i < n; i++) sum += norm[i];
    // Silêncio de verdade continua silêncio (não amplifica ruído)
    const gate = max < 0.01 ? 0 : 1;
    JRT.onAudioFrame((sum / n) * gate, norm);
    JRT.emit('audio', norm);
  }

  /* ---------- API do Lively ---------- */
  window.livelyPropertyListener = function (name, val) {
    markLively();
    JRT.set(name, val);
  };

  window.livelySystemInformation = function (data) {
    markLively();
    const obj = parse(data);
    if (obj) JRT.emit('sysinfo', obj);
  };

  window.livelyAudioListener = function (audioArray) {
    markLively();
    feedAudio(audioArray);
  };

  window.livelyCurrentTrack = function (data) {
    markLively();
    JRT.emit('track', parse(data));
  };

  window.livelyWallpaperPlaybackChanged = function (data) {
    const obj = parse(data);
    JRT.setPaused(!!(obj && obj.IsPaused));
  };

  /* ---------- modo prévia (navegador comum) ---------- */
  function startPreview() {
    if (JRT.state.inLively) return;
    JRT.state.preview = true;
    badge.hidden = false;

    const sim = { cpu: 22, gpu: 14, ramAvail: 7800, down: 400e3, up: 60e3 };
    const walk = (v, step, min, max) => Math.max(min, Math.min(max, v + (Math.random() - 0.48) * step));

    const sysTick = () => {
      sim.cpu = walk(sim.cpu, 14, 3, 96);
      sim.gpu = walk(sim.gpu, 10, 1, 80);
      sim.ramAvail = walk(sim.ramAvail, 400, 2500, 10500);
      sim.down = walk(sim.down, 900e3, 5e3, 9e6);
      sim.up = walk(sim.up, 150e3, 2e3, 1.5e6);
      JRT.emit('sysinfo', {
        NameCpu: 'Processador (simulado)',
        NameGpu: 'Placa de vídeo (simulada)',
        NameNetCard: 'Adaptador de rede (simulado)',
        CurrentCpu: sim.cpu,
        CurrentGpu3D: sim.gpu,
        TotalRam: 16384,
        CurrentRamAvail: sim.ramAvail,
        CurrentNetDown: sim.down,
        CurrentNetUp: sim.up
      });
    };

    const spectrum = new Array(128).fill(0);
    const audioTick = () => {
      const t = performance.now() / 1000;
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.05)), 12);
      for (let i = 0; i < 128; i++) {
        const f = i / 128;
        const body = 0.55 * Math.exp(-f * 4) + 0.18 * Math.sin(t * 1.7 + i * 0.35) ** 2 * (1 - f);
        spectrum[i] = Math.max(0, body * (0.55 + beat * 0.7 * Math.exp(-f * 6)) + Math.random() * 0.05);
      }
      feedAudio(spectrum);
    };

    sysTick();
    simTimers.push(setInterval(sysTick, 1000));
    simTimers.push(setInterval(audioTick, 33));
  }

  function stopPreview() {
    simTimers.forEach(clearInterval);
    simTimers = [];
    JRT.state.preview = false;
    badge.hidden = true;
  }

  JRT.boot();
  setTimeout(startPreview, 2500);
})();
