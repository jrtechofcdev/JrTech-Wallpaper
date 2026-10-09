/* Fundo interativo: malha de paralelogramos no ângulo do logo.
   Peças perto do cursor acendem, um clique solta uma onda e uma faixa de
   luz varre a tela devagar. Com música: cada batida solta uma onda a partir
   do logo gigante e um equalizador sobe pelas peças de baixo.
   No modo partículas, elas tremem e são empurradas na batida, e o logo
   gigante vibra como a membrana de um alto-falante. */
(function () {
  'use strict';

  const TAN = Math.tan(16 * Math.PI / 180);
  const MOUSE_R = 190;
  const MAX_RIPPLES = 8;
  const EQ_COLS = 48;

  let canvas, ctx, logoEl;
  let W = 0, H = 0, dpr = 1;
  let tiles = [];
  let base = null;            // camada estática pré-desenhada
  let ripples = [];
  let parX = 0, parY = 0;
  let particles = [];
  let logoC = { x: 0, y: 0 }; // centro do logo gigante, em px do canvas
  const eq = new Float32Array(EQ_COLS);
  const membrane = { x: 0, v: 0 }; // deslocamento e velocidade da "membrana"

  /* ---------- PRNG fixo: a malha é sempre a mesma em cada boot ---------- */
  function rng(seed) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function tileColor(t) {
    const c = JRT.mix(JRT.config.accentColor1, JRT.config.accentColor2, t);
    return `${c[0]},${c[1]},${c[2]}`;
  }

  /* ---------- geometria ---------- */
  function buildTiles() {
    const T = Math.max(32, Number(JRT.config.bgTileSize) || 64) * dpr;
    const gap = Math.max(3, T * 0.12);
    const cols = Math.ceil((W + H * TAN) / T) + 2;
    const rows = Math.ceil(H / T) + 1;
    const used = new Uint8Array(cols * rows);
    const rand = rng(20240917);
    tiles = [];

    const add = (c, r, span) => {
      // Cada linha recua pela inclinação: as colunas viram diagonais como no logo
      const x = c * T - r * T * TAN - T;
      const y = r * T;
      const w = span * T - gap;
      const h = span * T - gap;
      const k = h * TAN;
      // Base em (x, y+h), topo deslocado k para a direita
      const pts = [x + k, y, x + k + w, y, x + w, y + h, x, y + h];
      const cx = x + w / 2 + k / 2, cy = y + h / 2;
      if (cx < -T * 2 || cx > W + T * 2) return;
      // Gradiente da marca: verde em cima à esquerda, ciano embaixo à direita
      const t = Math.min(1, Math.max(0, (cx / W) * 0.55 + (cy / H) * 0.45));
      const col = Math.min(EQ_COLS - 1, Math.max(0, Math.floor(cx / W * EQ_COLS)));
      tiles.push({ pts, cx, cy, t, col, rgb: tileColor(t), e: 0, big: span > 1 });
    };

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (used[r * cols + c]) continue;
        // Como no logo: algumas peças grandes no meio das pequenas
        const canBig = c + 1 < cols && r + 1 < rows &&
          !used[r * cols + c + 1] && !used[(r + 1) * cols + c] && !used[(r + 1) * cols + c + 1];
        if (canBig && rand() < 0.07) {
          used[r * cols + c] = used[r * cols + c + 1] = used[(r + 1) * cols + c] = used[(r + 1) * cols + c + 1] = 1;
          add(c, r, 2);
        } else {
          used[r * cols + c] = 1;
          add(c, r, 1);
        }
      }
    }
    buildBase();
  }

  function path(c, p) {
    c.beginPath();
    c.moveTo(p[0], p[1]);
    c.lineTo(p[2], p[3]);
    c.lineTo(p[4], p[5]);
    c.lineTo(p[6], p[7]);
    c.closePath();
  }

  function buildBase() {
    base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    const b = base.getContext('2d');
    b.lineWidth = Math.max(1, dpr);
    tiles.forEach(tl => {
      path(b, tl.pts);
      b.fillStyle = `rgba(${tl.rgb},${tl.big ? 0.022 : 0.012})`;
      b.fill();
      b.strokeStyle = `rgba(${tl.rgb},${tl.big ? 0.08 : 0.065})`;
      b.stroke();
    });
  }

  function measureLogo() {
    const r = logoEl.getBoundingClientRect();
    logoC = { x: (r.left + r.width / 2 - parX) * dpr, y: (r.top + r.height / 2 - parY) * dpr };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.round(window.innerWidth * dpr);
    H = canvas.height = Math.round(window.innerHeight * dpr);
    buildTiles();
    initParticles();
    measureLogo();
  }

  /* ---------- equalizador: espectro do Lively em 48 colunas suavizadas ---------- */
  function updateEq(dt) {
    const sp = JRT.state.spectrum;
    const live = sp && performance.now() - JRT.state.lastAudioAt < 500;
    const fall = Math.exp(-dt * 4);
    for (let c = 0; c < EQ_COLS; c++) {
      let v = 0;
      if (live) {
        const a = Math.floor(64 * Math.pow(c / EQ_COLS, 1.5));
        const b = Math.max(a + 1, Math.floor(64 * Math.pow((c + 1) / EQ_COLS, 1.5)));
        for (let j = a; j < b && j < sp.length; j++) v = Math.max(v, sp[j] || 0);
        v = Math.min(1, v * (0.75 + c / EQ_COLS * 0.6));
      }
      eq[c] = v > eq[c] ? eq[c] + (v - eq[c]) * 0.5 : eq[c] * fall;
    }
  }

  /* ---------- modo malha ---------- */
  function frameMesh(now, dt) {
    const st = JRT.state;
    const mouseOn = now - st.mouse.at < 2500;
    const mx = st.mouse.x * dpr, my = st.mouse.y * dpr;
    const R = MOUSE_R * dpr;
    const decay = Math.exp(-dt * 2.4);
    updateEq(dt);

    // Faixa de luz diagonal: mostra que o fundo está vivo mesmo sem mouse
    const span = W + H;
    const sweep = ((now / 15000) % 1) * (span + 600 * dpr) - 300 * dpr;
    const band = 160 * dpr;

    // Ondas: cliques e batidas da música
    ripples = ripples.filter(rp => (now - rp.t0) < rp.life);
    const ripR = ripples.map(rp => ({
      x: rp.x, y: rp.y, r: (now - rp.t0) * rp.speed * dpr, f: (1 - (now - rp.t0) / rp.life) * rp.amp
    }));
    const ripW = 70 * dpr;

    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, 0.7 + st.bass * 0.3);
    ctx.drawImage(base, 0, 0);
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, 1.2 * dpr);

    for (let i = 0; i < tiles.length; i++) {
      const tl = tiles[i];
      let e = tl.e * decay;

      if (mouseOn) {
        const dx = tl.cx - mx, dy = tl.cy - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const f = 1 - Math.sqrt(d2) / R;
          e = Math.max(e, f * f * 0.95);
        }
      }

      const sd = Math.abs(tl.cx + tl.cy - sweep);
      if (sd < band) e = Math.max(e, (1 - sd / band) * 0.14);

      // Equalizador: as colunas de peças sobem do rodapé conforme o som
      const lv = eq[tl.col];
      if (lv > 0.03) {
        const top = H * (1 - lv * 0.42);
        if (tl.cy > top) e = Math.max(e, 0.04 + 0.16 * ((tl.cy - top) / (H - top + 1)));
      }

      for (let j = 0; j < ripR.length; j++) {
        const rp = ripR[j];
        const d = Math.hypot(tl.cx - rp.x, tl.cy - rp.y);
        const off = Math.abs(d - rp.r);
        if (off < ripW) e = Math.max(e, (1 - off / ripW) * rp.f * 0.85);
      }

      tl.e = e;
      if (e < 0.012) continue;
      path(ctx, tl.pts);
      ctx.fillStyle = `rgba(${tl.rgb},${(e * 0.3).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${tl.rgb},${Math.min(1, e * 0.9).toFixed(3)})`;
      ctx.stroke();
    }
  }

  /* ---------- modo partículas ---------- */
  function initParticles() {
    const n = Math.round(110 * (W * H) / (1920 * 1080 * dpr * dpr));
    particles = [];
    for (let i = 0; i < n; i++) {
      const t = Math.random();
      const x = Math.random() * W, y = Math.random() * H;
      particles.push({
        x, y, dx: x, dy: y,
        vx: (Math.random() - 0.5) * 12 * dpr, vy: (Math.random() - 0.5) * 12 * dpr,
        r: (Math.random() * 1.6 + 0.6) * dpr, t, rgb: tileColor(t)
      });
    }
  }

  // Batida empurra as partículas para longe do logo, como uma onda de som
  function kickParticles(strength) {
    const R = 700 * dpr;
    for (const p of particles) {
      const dx = p.x - logoC.x, dy = p.y - logoC.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > R) continue;
      const f = (1 - d / R) * strength * 160 * dpr;
      p.vx += dx / d * f;
      p.vy += dy / d * f;
    }
  }

  function frameParticles(now, dt) {
    const st = JRT.state;
    const mouseOn = now - st.mouse.at < 2500;
    const mx = st.mouse.x * dpr, my = st.mouse.y * dpr;
    const link = 130 * dpr;
    // Tremor proporcional à batida: cada partícula é desenhada um pouco deslocada
    const shake = (st.beat * 7 + st.bass * 2.5) * dpr;
    const cruise = 9 * dpr;
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      if (mouseOn) {
        const dx = mx - p.x, dy = my - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 220 * dpr && d > 1) { p.vx += dx / d * 20 * dt * dpr; p.vy += dy / d * 20 * dt * dpr; }
      }
      // O empurrão da batida se dissipa; a deriva lenta continua
      const damp = Math.hypot(p.vx, p.vy) > cruise ? Math.exp(-dt * 2.2) : 0.995;
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
      p.dx = p.x + (Math.random() - 0.5) * 2 * shake;
      p.dy = p.y + (Math.random() - 0.5) * 2 * shake;
    }

    ctx.lineWidth = 0.8 * dpr;
    const lineA = 0.16 + st.beat * 0.14;
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        if (dx > link || dx < -link) continue;
        const dy = a.y - b.y;
        if (dy > link || dy < -link) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < link) {
          ctx.strokeStyle = `rgba(${a.rgb},${((1 - d / link) * lineA).toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.dx, a.dy); ctx.lineTo(b.dx, b.dy); ctx.stroke();
        }
      }
    }

    const boost = Math.min(1, 0.35 + st.bass * 0.5 + st.beat * 0.35);
    const grow = 1 + st.beat * 0.7;
    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.rgb},${boost.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(p.dx, p.dy, p.r * grow, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* ---------- logo gigante: parallax do mouse + membrana de som ---------- */
  function frameLogo(dt) {
    const st = JRT.state;
    const active = performance.now() - st.mouse.at < 2500;
    const tx = active ? -(st.mouse.x / window.innerWidth - 0.5) * 28 : 0;
    const ty = active ? -(st.mouse.y / window.innerHeight - 0.5) * 18 : 0;
    const k = 1 - Math.exp(-dt * 2.5);
    parX += (tx - parX) * k;
    parY += (ty - parY) * k;

    // Mola amortecida: a batida dá um "soco" e a membrana volta oscilando
    const h = Math.min(dt, 1 / 30);
    const accel = -260 * (membrane.x - st.bass * 0.5) - 13 * membrane.v;
    membrane.v += accel * h;
    membrane.x = Math.max(-0.6, Math.min(1.6, membrane.x + membrane.v * h));

    const particlesMode = Number(JRT.config.bgStyle) === 1;
    const m = membrane.x;
    const scale = 1 + m * (particlesMode ? 0.07 : 0.025);
    const alpha = particlesMode ? 0.075 + Math.max(0, m) * 0.09 : 0.045 + Math.max(0, m) * 0.03;
    logoEl.style.opacity = alpha.toFixed(3);
    logoEl.style.transform = `translate3d(${parX.toFixed(2)}px, ${parY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
  }

  function onBeat(strength) {
    const style = Number(JRT.config.bgStyle);
    if (style === 2) return;
    membrane.v += (2.5 + strength * 5) * (style === 1 ? 1 : 0.6);
    if (style === 1) kickParticles(0.5 + strength * 0.5);
    // Onda só nas batidas fortes, para a malha não virar um pisca-pisca
    if (style === 0 && strength > 0.3) {
      ripples.push({ x: logoC.x, y: logoC.y, t0: performance.now(), life: 1300, speed: 1.3, amp: 0.25 + strength * 0.3 });
      if (ripples.length > MAX_RIPPLES) ripples.shift();
    }
  }

  function applyStyle() {
    const style = Number(JRT.config.bgStyle);
    canvas.hidden = style === 2;
    logoEl.hidden = style === 2;
    if (style === 2) ctx.clearRect(0, 0, W, H);
  }

  JRT.register({
    init() {
      canvas = document.getElementById('bg');
      ctx = canvas.getContext('2d');
      logoEl = document.getElementById('bg-logo');
      resize();
      JRT.on('resize', resize);
      JRT.on('beat', onBeat);
      JRT.on('pointer-down', p => {
        if (Number(JRT.config.bgStyle) !== 0) return;
        ripples.push({ x: p.x * dpr, y: p.y * dpr, t0: performance.now(), life: 1800, speed: 1.1, amp: 1 });
        if (ripples.length > MAX_RIPPLES) ripples.shift();
      });
    },

    isActive() {
      return Number(JRT.config.bgStyle) !== 2;
    },

    frame(now, dt) {
      if (Number(JRT.config.bgStyle) === 1) frameParticles(now, dt);
      else frameMesh(now, dt);
      frameLogo(dt);
    },

    onConfig(key) {
      if (key === 'bgStyle') applyStyle();
      if (key === 'bgTileSize') buildTiles();
      if (key === 'accentColor1' || key === 'accentColor2') {
        tiles.forEach(tl => { tl.rgb = tileColor(tl.t); });
        particles.forEach(p => { p.rgb = tileColor(p.t); });
        buildBase();
      }
    }
  });
})();
