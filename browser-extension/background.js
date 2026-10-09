/* JrTech Media Link: repassa o tempo do player para o JrTech Media Bridge
   e devolve para a aba uma busca pendente, se o wallpaper pediu uma. */
const BRIDGE = 'http://127.0.0.1:47833';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'jrtech-report') return false;
  const tab = `${sender.tab ? sender.tab.id : 'x'}:${sender.frameId || 0}`;
  const q = new URLSearchParams({
    tab,
    pos: Number(msg.pos).toFixed(2),
    dur: Number(msg.dur).toFixed(2),
    paused: msg.paused ? '1' : '0'
  });
  fetch(`${BRIDGE}/ext/report?${q}`, { cache: 'no-store' })
    .then(r => r.json())
    .then(reply => sendResponse(reply))
    .catch(() => sendResponse(null)); // Bridge desligado: segue em silêncio
  return true; // resposta assíncrona
});
