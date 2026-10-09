/* JrTech Media Link: lê o tempo do player da página e aplica buscas vindas
   do wallpaper. Só conversa com o JrTech Media Bridge (127.0.0.1). */
(() => {
  'use strict';

  let timer = 0;
  let lastSent = 0;

  // O player que importa: o que está tocando; senão, o último com tempo
  function pickMedia() {
    let best = null;
    for (const m of document.querySelectorAll('video, audio')) {
      if (!(m.duration > 0) || !isFinite(m.duration)) continue;
      if (!m.paused) return m;
      if (!best || m.currentTime > best.currentTime) best = m;
    }
    return best;
  }

  function report() {
    clearTimeout(timer);
    const m = pickMedia();
    // Tocando: 2x por segundo (busca responde rápido); parado: devagar
    timer = setTimeout(report, m && !m.paused ? 500 : 2000);
    if (!m) return;
    lastSent = Date.now();
    try {
      chrome.runtime.sendMessage({
        type: 'jrtech-report',
        pos: m.currentTime,
        dur: m.duration,
        paused: m.paused
      }, reply => {
        if (chrome.runtime.lastError || !reply) return;
        if (typeof reply.seek === 'number' && isFinite(reply.seek)) {
          m.currentTime = Math.max(0, Math.min(m.duration - 0.25, reply.seek));
        }
      });
    } catch (e) {
      // Extensão recarregada: este script antigo para de reportar
      clearTimeout(timer);
    }
  }

  // Eventos do player: reporta na hora (com um respiro para não repetir)
  ['play', 'pause', 'seeked', 'loadedmetadata', 'durationchange'].forEach(ev => {
    document.addEventListener(ev, () => {
      if (Date.now() - lastSent > 150) report();
    }, true);
  });

  report();
})();
