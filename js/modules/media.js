/* Player de música.
   Informação: livelyCurrentTrack (Lively, --system-nowplaying).
   Controles (tocar, pausar, passar, voltar, tempo, volume): JrTech Media Bridge,
   um servidor local em 127.0.0.1 que fala com os Controles de Mídia do Windows.
   Sem o Bridge o card mostra só a música, sem botões que não funcionam. */
(function () {
  'use strict';

  const BRIDGE = 'http://127.0.0.1:47833';
  const POLL_MS = 1000;
  const RETRY_MS = 5000;

  let els;
  let livelyTrack = null;
  let bridge = { online: false, session: null, volume: null };
  let pollTimer = 0;
  let lastTitleKey = '';
  let lastCoverSrc = '';
  let posBase = 0, posAt = 0;
  let shownPos = -1;
  let seek, vol;

  const clamp = v => Math.max(0, Math.min(1, v));

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  function parseTrack(data) {
    if (!data) return null;
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      return obj && (obj.Title || obj.Artist) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- slider reutilizável (tempo e volume) ---------- */
  function makeSlider(el, opts) {
    let value = 0;
    const api = { dragging: false };

    function paint(v) {
      value = clamp(v);
      el.style.setProperty('--p', (value * 100).toFixed(2) + '%');
      el.setAttribute('aria-valuenow', Math.round(value * 100));
    }

    function fromEvent(e) {
      const r = el.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width);
    }

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      api.dragging = true;
      el.classList.add('dragging');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue pelo move */ }
      paint(fromEvent(e));
      opts.onInput && opts.onInput(value);
    });

    el.addEventListener('pointermove', e => {
      if (!api.dragging) return;
      paint(fromEvent(e));
      opts.onInput && opts.onInput(value);
    });

    const end = () => {
      if (!api.dragging) return;
      api.dragging = false;
      el.classList.remove('dragging');
      opts.onCommit && opts.onCommit(value);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('keydown', e => {
      const step = opts.step || 0.05;
      let v = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value + step;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value - step;
      if (e.key === 'Home') v = 0;
      if (e.key === 'End') v = 1;
      if (v === null) return;
      e.preventDefault();
      paint(v);
      opts.onCommit && opts.onCommit(value);
    });

    if (opts.wheel) {
      el.addEventListener('wheel', e => {
        e.preventDefault();
        paint(value + (e.deltaY < 0 ? opts.wheel : -opts.wheel));
        opts.onCommit && opts.onCommit(value);
      }, { passive: false });
    }

    api.set = v => { if (!api.dragging) paint(v); };
    api.get = () => value;
    return api;
  }

  /* ---------- comunicação com o Media Bridge ---------- */
  async function call(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(BRIDGE + path, { signal: ctrl.signal, cache: 'no-store' });
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (!JRT.config.showMedia || JRT.state.paused) {
      pollTimer = setTimeout(poll, RETRY_MS);
      return;
    }
    try {
      const st = await call('/state');
      bridge = { online: !!st.ok, session: st.session || null, volume: st.volume || null };
      const s = bridge.session;
      if (s) { posBase = s.position || 0; posAt = performance.now(); }
      pollTimer = setTimeout(poll, POLL_MS);
    } catch (e) {
      bridge = { online: false, session: null, volume: null };
      pollTimer = setTimeout(poll, RETRY_MS);
    }
    render();
  }

  async function cmd(name, query) {
    try {
      await call(`/cmd/${name}${query ? '?' + query : ''}`);
    } catch (e) { /* o próximo poll mostra o estado real */ }
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, 180);
  }

  /* ---------- capa e cor de destaque ---------- */
  function accentFromCover(img) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 24;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const px = ctx.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let i = 0; i < px.length; i += 4) {
        const R = px[i], G = px[i + 1], B = px[i + 2];
        const max = Math.max(R, G, B), min = Math.min(R, G, B);
        const sat = max ? (max - min) / max : 0;
        const w = sat * sat * (max / 255);
        r += R * w; g += G * w; b += B * w; wsum += w;
      }
      if (wsum < 2) return null;
      let rgb = [r / wsum, g / wsum, b / wsum];
      const lum = Math.max(...rgb);
      if (lum < 170) rgb = rgb.map(v => v * (170 / lum));
      return `rgb(${rgb.map(v => Math.min(255, Math.round(v))).join(',')})`;
    } catch (e) {
      return null;
    }
  }

  function setCover(src) {
    if (src === lastCoverSrc) return;
    lastCoverSrc = src;
    if (!src) {
      els.cover.removeAttribute('src');
      els.card.style.setProperty('--media-accent', 'var(--brand-1)');
      return;
    }
    els.cover.onload = () => {
      els.card.style.setProperty('--media-accent', accentFromCover(els.cover) || 'var(--brand-1)');
    };
    els.cover.src = src;
  }

  function updateMarquee() {
    const { title, titleWrap } = els;
    title.classList.remove('marquee');
    const overflow = title.scrollWidth - titleWrap.clientWidth;
    titleWrap.classList.toggle('overflowing', overflow > 4);
    if (overflow > 4) {
      // Passa um pouco do fim para a última palavra sair da faixa esmaecida
      title.style.setProperty('--marquee-shift', `-${Math.round(overflow + titleWrap.clientWidth * 0.13)}px`);
      title.style.setProperty('--marquee-dur', `${Math.max(6, overflow / 18)}s`);
      title.classList.add('marquee');
    }
  }

  function setText(name, who) {
    const key = name + '|' + who;
    if (key === lastTitleKey) return;
    lastTitleKey = key;
    els.title.textContent = name;
    els.artist.textContent = who;
    requestAnimationFrame(updateMarquee);
  }

  /* ---------- render ---------- */
  function render() {
    const s = bridge.online && bridge.session && (bridge.session.title || bridge.session.artist) ? bridge.session : null;

    if (s) {
      els.card.hidden = false;
      els.card.classList.remove('info-only');
      const where = s.app ? ` no ${s.app}` : '';
      els.label.textContent = s.status === 'playing' ? `Tocando${where}` : `Pausado${where}`;
      setText(s.title || 'Sem título', [s.artist, s.album].filter(Boolean).join(' · '));

      if (s.thumbKey) setCover(`${BRIDGE}/thumb?k=${encodeURIComponent(s.thumbKey)}`);
      else if (livelyTrack && livelyTrack.Thumbnail && livelyTrack.Title === s.title) setCover(livelyThumb(livelyTrack));
      else setCover('');

      els.play.classList.toggle('playing', s.status === 'playing');
      els.play.disabled = !s.canToggle;
      els.prev.disabled = !s.canPrev;
      els.next.disabled = !s.canNext;

      els.seekRow.classList.toggle('disabled', !s.canSeek);
      els.dur.textContent = s.canSeek ? fmtTime(s.duration) : '--:--';
      if (!s.canSeek) {
        els.pos.textContent = '--:--';
        seek.set(0);
        els.hint.hidden = false;
        els.hint.textContent = s.linkSeen
          ? 'Aguardando o tempo da música vindo do navegador...'
          : `${s.app || 'Este navegador'} não passa o tempo da música ao Windows. Instale a extensão JrTech Media Link (pasta extension) para ver e arrastar a barra.`;
      } else {
        els.hint.hidden = true;
      }

      if (bridge.volume) {
        vol.set(bridge.volume.level);
        els.volVal.textContent = bridge.volume.muted ? 'mudo' : Math.round(bridge.volume.level * 100) + '%';
        els.mute.classList.toggle('muted', bridge.volume.muted);
        els.mute.title = els.mute.ariaLabel = bridge.volume.muted ? 'Tirar do mudo' : 'Silenciar';
      }
      return;
    }

    if (livelyTrack) {
      // Sem o Media Bridge: só informação
      els.card.hidden = false;
      els.card.classList.add('info-only');
      els.label.textContent = 'Tocando agora';
      setText(livelyTrack.Title || 'Sem título',
        [livelyTrack.Artist || livelyTrack.AlbumArtist || livelyTrack.Subtitle, livelyTrack.AlbumTitle].filter(Boolean).join(' · '));
      setCover(livelyTrack.Thumbnail ? livelyThumb(livelyTrack) : '');
      els.hint.hidden = false;
      els.hint.textContent = 'Para controlar a música por aqui, rode o instalar.cmd da pasta helper do wallpaper (JrTech Media Bridge).';
      return;
    }

    els.card.hidden = true;
    lastTitleKey = '';
  }

  function livelyThumb(t) {
    return t.Thumbnail.startsWith('data:') ? t.Thumbnail : `data:image/png;base64,${t.Thumbnail}`;
  }

  JRT.register({
    init() {
      const $ = id => document.getElementById(id);
      els = {
        card: $('mod-media'), cover: $('media-cover'), label: $('media-label'),
        titleWrap: $('media-title-wrap'), title: $('media-title'), artist: $('media-artist'),
        seekRow: $('media-seek-row'), pos: $('media-pos'), dur: $('media-dur'),
        prev: $('mc-prev'), play: $('mc-play'), next: $('mc-next'),
        mute: $('mc-mute'), volVal: $('media-vol-val'), hint: $('media-hint')
      };
      // A capa vem do Bridge (outra origem); precisa disso para ler a cor
      els.cover.crossOrigin = 'anonymous';

      seek = makeSlider($('media-seek'), {
        step: 0.02,
        onInput: f => {
          const s = bridge.session;
          if (s && s.canSeek) els.pos.textContent = fmtTime(f * s.duration);
        },
        onCommit: f => {
          const s = bridge.session;
          if (!s || !s.canSeek) return;
          const t = f * s.duration;
          posBase = t; posAt = performance.now();
          cmd('seek', 't=' + t.toFixed(2));
        }
      });

      let volSentAt = 0;
      vol = makeSlider($('media-vol'), {
        step: 0.05,
        wheel: 0.05,
        onInput: f => {
          els.volVal.textContent = Math.round(f * 100) + '%';
          const now = performance.now();
          if (now - volSentAt > 80) { volSentAt = now; cmd('volume', 'v=' + f.toFixed(3)); }
        },
        onCommit: f => {
          els.volVal.textContent = Math.round(f * 100) + '%';
          cmd('volume', 'v=' + f.toFixed(3));
        }
      });

      els.play.addEventListener('click', () => {
        els.play.classList.toggle('playing'); // resposta imediata; o poll confirma
        cmd('playpause');
      });
      els.prev.addEventListener('click', () => cmd('prev'));
      els.next.addEventListener('click', () => cmd('next'));
      els.mute.addEventListener('click', () => cmd('mute', 'm=toggle'));

      JRT.on('track', data => { livelyTrack = parseTrack(data); render(); });
      JRT.on('resize', () => { if (!els.card.hidden) updateMarquee(); });
      JRT.on('paused', p => { if (!p) poll(); });
      poll();
    },

    isActive() {
      return JRT.config.showMedia && !els.card.hidden;
    },

    // A posição anda sozinha entre um poll e outro
    frame(now) {
      const s = bridge.session;
      if (!s || !s.canSeek || !(s.duration > 0) || seek.dragging) return;
      const pos = Math.min(s.duration, posBase + (s.status === 'playing' ? (now - posAt) / 1000 : 0));
      const sec = Math.floor(pos);
      seek.set(pos / s.duration);
      if (sec !== shownPos) {
        shownPos = sec;
        els.pos.textContent = fmtTime(pos);
      }
    },

    onConfig(key, val) {
      if (key === 'showMedia' && val) poll();
    }
  });
})();
