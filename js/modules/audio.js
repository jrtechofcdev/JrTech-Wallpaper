/* Visualizador de áudio (livelyAudioListener, requer --audio) */
(function () {
  'use strict';

  const BARS = 44;
  const TAN = Math.tan(16 * Math.PI / 180);

  let canvas, ctx, W = 0, H = 0;
  let spectrum = new Float32Array(128);
  const level = new Float32Array(BARS);
  const peak = new Float32Array(BARS);
  const peakHold = new Float32Array(BARS);
  let ranges = [];
  let grad = null;

  // Mais barras para graves e médios, onde está a música
  function buildRanges(bins) {
    ranges = [];
    for (let i = 0; i < BARS; i++) {
      const a = Math.floor(bins * Math.pow(i / BARS, 1.7));
      const b = Math.max(a + 1, Math.floor(bins * Math.pow((i + 1) / BARS, 1.7)));
      ranges.push([a, Math.min(b, bins)]);
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = canvas.width = Math.max(1, Math.round(r.width * dpr));
    H = canvas.height = Math.max(1, Math.round(r.height * dpr));
    grad = null;
  }

  function gradient() {
    if (!grad) {
      grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, JRT.config.accentColor1);
      grad.addColorStop(1, JRT.config.accentColor2);
    }
    return grad;
  }

  function onAudio(arr) {
    if (!arr || !arr.length) return;
    if (arr.length !== spectrum.length) {
      spectrum = new Float32Array(arr.length);
      buildRanges(arr.length);
    }
    for (let i = 0; i < arr.length; i++) spectrum[i] = arr[i] || 0;
  }

  JRT.register({
    init() {
      canvas = document.getElementById('viz-canvas');
      ctx = canvas.getContext('2d');
      buildRanges(spectrum.length);
      resize();
      JRT.on('audio', onAudio);
      JRT.on('resize', resize);
    },

    isActive() {
      return JRT.config.showAudio;
    },

    frame(now, dt) {
      if (!W) resize();
      const silent = now - JRT.state.lastAudioAt > 600;
      const fall = Math.exp(-dt * 5);

      for (let i = 0; i < BARS; i++) {
        let v = 0;
        if (!silent) {
          const [a, b] = ranges[i];
          for (let j = a; j < b; j++) v = Math.max(v, spectrum[j]);
          // Agudos chegam mais fracos; compensação leve
          v = Math.min(1, v * (1 + i / BARS * 1.4));
        }
        level[i] = v > level[i] ? level[i] + (v - level[i]) * 0.6 : level[i] * fall;
        if (level[i] >= peak[i]) { peak[i] = level[i]; peakHold[i] = 0.5; }
        else if (peakHold[i] > 0) peakHold[i] -= dt;
        else peak[i] = Math.max(0, peak[i] - dt * 0.6);
      }

      ctx.clearRect(0, 0, W, H);
      const gap = W * 0.006;
      const lean = H * TAN;
      const bw = (W - lean - gap * (BARS - 1)) / BARS;
      const base = Math.max(2, H * 0.04);
      ctx.fillStyle = gradient();

      for (let i = 0; i < BARS; i++) {
        const x = i * (bw + gap);
        const h = base + level[i] * (H - base);
        const k = h * TAN;
        ctx.globalAlpha = 0.28 + level[i] * 0.72;
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x + bw, H);
        ctx.lineTo(x + bw + k, H - h);
        ctx.lineTo(x + k, H - h);
        ctx.closePath();
        ctx.fill();

        // Marca de pico: um tracinho inclinado que segura e depois cai
        if (peak[i] > 0.04) {
          const py = H - (base + peak[i] * (H - base)) - H * 0.05;
          const pk = (H - py) * TAN;
          const th = Math.max(1.5, H * 0.03);
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.moveTo(x + pk, py);
          ctx.lineTo(x + bw + pk, py);
          ctx.lineTo(x + bw + pk + th * TAN, py - th);
          ctx.lineTo(x + pk + th * TAN, py - th);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },

    onConfig(key) {
      if (key === 'accentColor1' || key === 'accentColor2') grad = null;
      if (key === 'showAudio') requestAnimationFrame(resize);
    }
  });
})();
