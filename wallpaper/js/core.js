/* ==========================================================
   JRT core: configuração, eventos, escala e o único loop de animação.
   Todos os módulos se registram aqui (scripts clássicos, sem import,
   porque o Lively abre o wallpaper via file://).
   ========================================================== */
(function () {
  'use strict';

  const root = document.documentElement;

  // Espelha os valores padrão do LivelyProperties.json
  const config = {
    showLogo: true,
    showClock: true,
    showCalendar: true,
    showHardware: true,
    showMedia: true,
    showAudio: true,
    showWeather: true,
    showDisk: false,
    use24h: false,
    showSeconds: true,
    weatherCity: '',
    weatherUnit: 0,          // 0 = °C, 1 = °F
    accentColor1: '#00FCA8',
    accentColor2: '#1CDAFF',
    glowIntensity: 60,
    cardOpacity: 55,
    uiScale: 100,
    bgStyle: 0,              // 0 = malha da marca, 1 = partículas, 2 = liso
    bgTileSize: 64,
    fpsLimit: 1,             // 0 = 30, 1 = 60, 2 = sem limite
    diskUsed: '',
    diskTotal: ''
  };

  const FPS_STEPS = [30, 60, 0];

  // Chave de visibilidade -> id do elemento do módulo
  const MODULE_TOGGLES = {
    showLogo: 'mod-logo',
    showClock: 'mod-clock',
    showCalendar: 'mod-calendar',
    showHardware: 'mod-hardware',
    showMedia: 'mod-media',
    showAudio: 'mod-audio',
    showWeather: 'mod-weather'
  };

  const state = {
    inLively: false,
    preview: false,
    paused: false,
    scale: 1,
    bass: 0,           // graves suavizados, 0..1
    bassTarget: 0,
    bassAvg: 0,        // média lenta dos graves, base para achar a batida
    beat: 0,           // 1 na batida, cai até 0
    lastBeatAt: 0,
    spectrum: null,    // último espectro do Lively (128 valores)
    lastAudioAt: 0,
    mouse: { x: -9999, y: -9999, at: 0 }
  };

  const modules = [];
  const listeners = {};

  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }

  function emit(evt, data) {
    (listeners[evt] || []).forEach(fn => {
      try { fn(data); } catch (e) { console.error('[JRT]', evt, e); }
    });
  }

  function register(mod) {
    modules.push(mod);
  }

  /* ---------- cores ---------- */
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgba(hex, a) {
    const c = hexToRgb(hex) || [0, 252, 168];
    return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  }

  function mix(hexA, hexB, t) {
    const a = hexToRgb(hexA) || [0, 252, 168];
    const b = hexToRgb(hexB) || [28, 218, 255];
    return [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  }

  /* ---------- escala: o layout é desenhado para 1080px de altura ---------- */
  const stage = document.getElementById('stage');

  const colRight = document.querySelector('.col-right');

  function applyScale() {
    const s = (window.innerHeight / 1080) * (config.uiScale / 100);
    state.scale = s;
    stage.style.zoom = s;
    stage.style.width = (window.innerWidth / s) + 'px';
    stage.style.height = (window.innerHeight / s) + 'px';

    // Barra de tarefas real (sempre visível): diferença entre a tela e a área útil
    const taskbar = Math.max(0, (window.screen.height || 0) - (window.screen.availHeight || 0));
    const reserve = (taskbar > 0 ? taskbar : 48) / s + 30;
    stage.style.setProperty('--safe-bottom', Math.round(reserve) + 'px');
    fitRight();
  }

  // Se clima + sistema + calendário não couberem, a coluna encolhe um pouco
  function fitRight() {
    if (!colRight) return;
    colRight.style.transform = '';
    const need = colRight.scrollHeight;
    const have = colRight.clientHeight;
    if (need > have + 1) colRight.style.transform = `scale(${(have / need).toFixed(4)})`;
  }

  /* ---------- configuração ---------- */
  function set(key, val) {
    if (!(key in config)) return;
    config[key] = val;

    if (key in MODULE_TOGGLES) {
      const el = document.getElementById(MODULE_TOGGLES[key]);
      if (el) el.classList.toggle('mod-off', !val);
    }

    switch (key) {
      case 'accentColor1':
        if (hexToRgb(val)) root.style.setProperty('--brand-1', val);
        break;
      case 'accentColor2':
        if (hexToRgb(val)) root.style.setProperty('--brand-2', val);
        break;
      case 'glowIntensity':
        root.style.setProperty('--glow', (Number(val) / 100).toFixed(2));
        break;
      case 'cardOpacity':
        root.style.setProperty('--card-alpha', (Number(val) / 100).toFixed(2));
        break;
      case 'uiScale':
        applyScale();
        emit('resize');
        break;
    }

    modules.forEach(m => {
      if (m.onConfig) {
        try { m.onConfig(key, val); } catch (e) { console.error('[JRT config]', key, e); }
      }
    });
  }

  /* ---------- loop único ---------- */
  let raf = 0;
  let lastFrame = 0;
  let pulseShown = -1;

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const fps = FPS_STEPS[config.fpsLimit] || 0;
    const elapsed = now - lastFrame;
    if (fps && elapsed < 1000 / fps - 1.5) return;
    const dt = Math.min(elapsed / 1000, 0.1);
    lastFrame = now;

    // Sem áudio por um tempo: os graves caem até zero
    if (now - state.lastAudioAt > 400) state.bassTarget *= 0.9;
    const k = state.bassTarget > state.bass ? 0.45 : 0.12;
    state.bass += (state.bassTarget - state.bass) * k;
    state.beat *= Math.exp(-dt * 7);

    const pulse = Math.round(state.bass * 100) / 100;
    if (pulse !== pulseShown) {
      root.style.setProperty('--pulse', pulse);
      pulseShown = pulse;
    }

    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      if (m.frame && (!m.isActive || m.isActive())) m.frame(now, dt);
    }
  }

  function setPaused(paused) {
    if (paused === state.paused) return;
    state.paused = paused;
    if (paused) {
      cancelAnimationFrame(raf);
    } else {
      lastFrame = performance.now();
      raf = requestAnimationFrame(loop);
    }
    emit('paused', paused);
  }

  /* ---------- relógio de 1 segundo, alinhado à virada do segundo ---------- */
  function scheduleTick() {
    setTimeout(() => {
      emit('tick', new Date());
      scheduleTick();
    }, 1000 - (Date.now() % 1000) + 8);
  }

  /* ---------- mouse (o Lively repassa com "Wallpaper Input: Mouse") ---------- */
  window.addEventListener('mousemove', e => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    state.mouse.at = performance.now();
  }, { passive: true });

  window.addEventListener('mouseleave', () => {
    state.mouse.at = 0;
  });

  window.addEventListener('mousedown', e => {
    emit('pointer-down', { x: e.clientX, y: e.clientY });
  });

  window.addEventListener('resize', () => {
    applyScale();
    emit('resize');
  });

  if (window.ResizeObserver && colRight) {
    let pending = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(fitRight);
    }).observe(colRight);
    Array.from(colRight.children).forEach(el => new ResizeObserver(() => requestAnimationFrame(fitRight)).observe(el));
  }

  /* ---------- batida: graves bem acima da média recente ---------- */
  function onAudioFrame(bass, spectrum) {
    const now = performance.now();
    state.spectrum = spectrum;
    state.bassTarget = Math.min(1, bass);
    state.lastAudioAt = now;
    state.bassAvg += (bass - state.bassAvg) * 0.04;
    if (bass > 0.25 && bass > state.bassAvg * 1.3 + 0.06 && now - state.lastBeatAt > 300) {
      const strength = Math.min(1, (bass - state.bassAvg) / (state.bassAvg + 0.08));
      state.lastBeatAt = now;
      state.beat = Math.max(state.beat, 0.4 + strength * 0.6);
      emit('beat', strength);
    }
  }

  function boot() {
    applyScale();
    modules.forEach(m => m.init && m.init());
    Object.keys(config).forEach(k => set(k, config[k]));
    lastFrame = performance.now();
    raf = requestAnimationFrame(loop);
    scheduleTick();
    emit('tick', new Date());
  }

  window.JRT = { config, state, on, emit, register, set, boot, setPaused, rgba, mix, hexToRgb, onAudioFrame, fitRight };
})();
