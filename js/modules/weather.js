/* Clima via Open-Meteo (gratuito, sem chave). Cidade definida no painel do Lively. */
(function () {
  'use strict';

  const REFRESH_MS = 30 * 60 * 1000;
  const RETRY_MS = 5 * 60 * 1000;
  const CACHE_KEY = 'jrt.weather.v1';

  let els;
  let timer = 0;
  let debounce = 0;
  let reqId = 0;

  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  /* ---------- códigos WMO -> texto e ícone ---------- */
  function describe(code) {
    if (code === 0) return ['Céu limpo', 'clear'];
    if (code === 1) return ['Poucas nuvens', 'partly'];
    if (code === 2) return ['Parcialmente nublado', 'partly'];
    if (code === 3) return ['Nublado', 'cloud'];
    if (code === 45 || code === 48) return ['Neblina', 'fog'];
    if (code >= 51 && code <= 57) return ['Garoa', 'rain'];
    if (code >= 61 && code <= 67) return ['Chuva', 'rain'];
    if (code >= 71 && code <= 77) return ['Neve', 'snow'];
    if (code >= 80 && code <= 82) return ['Pancadas de chuva', 'rain'];
    if (code === 85 || code === 86) return ['Pancadas de neve', 'snow'];
    if (code >= 95) return ['Tempestade', 'storm'];
    return ['Tempo indefinido', 'cloud'];
  }

  // Ícones próprios; a chuva cai na mesma inclinação do logo
  const CLOUD = 'M15 34h19a7.5 7.5 0 0 0 .6-15A10.5 10.5 0 0 0 14.6 18 8 8 0 0 0 15 34z';
  const CLOUD_HIGH = 'M15 28h19a7.5 7.5 0 0 0 .6-15A10.5 10.5 0 0 0 14.6 12 8 8 0 0 0 15 28z';

  function icon(kind, isDay) {
    const sun = '<circle class="accent" cx="24" cy="24" r="8"/><path class="accent" d="M24 7v4M24 37v4M7 24h4M37 24h4M12 12l2.8 2.8M33.2 33.2 36 36M12 36l2.8-2.8M33.2 14.8 36 12"/>';
    const moon = '<path class="accent" d="M30 10a14 14 0 1 0 8 22A12 12 0 0 1 30 10z"/>';
    let body;
    switch (kind) {
      case 'clear':
        body = isDay ? sun : moon;
        break;
      case 'partly':
        body = (isDay
          ? '<circle class="accent" cx="17" cy="16" r="6"/><path class="accent" d="M17 5v2.5M6 16h2.5M9.2 8.2 11 10M24.8 8.2 23 10"/>'
          : '<path class="accent" d="M21 6a9 9 0 1 0 5 14A8 8 0 0 1 21 6z"/>') +
          '<path d="M17 38h17a7 7 0 0 0 .6-14A9.5 9.5 0 0 0 16.4 24 7 7 0 0 0 17 38z"/>';
        break;
      case 'rain':
        body = `<path d="${CLOUD_HIGH}"/><path class="accent" d="M18 33l-2 6M25 33l-2 6M32 33l-2 6M21.5 40l-1 3M28.5 40l-1 3"/>`;
        break;
      case 'snow':
        body = `<path d="${CLOUD_HIGH}"/><path class="accent" d="M17 35h.01M24 35h.01M31 35h.01M20.5 41h.01M27.5 41h.01" stroke-width="3"/>`;
        break;
      case 'storm':
        body = `<path d="${CLOUD_HIGH}"/><path class="accent" d="M25 30l-5 8h6l-4 7"/>`;
        break;
      case 'fog':
        body = '<path d="M9 18h30M13 25h26M9 32h26M15 39h20"/>';
        break;
      default:
        body = `<path d="${CLOUD}"/>`;
    }
    return `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
  }

  /* ---------- cache local ---------- */
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (e) { return null; }
  }

  function writeCache(c) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* sem storage: segue sem cache */ }
  }

  /* ---------- render ---------- */
  function showStatus(text) {
    els.status.textContent = text;
  }

  function showEmpty(text) {
    els.main.hidden = true;
    els.hours.hidden = true;
    showStatus(text);
  }

  function render(c) {
    const cur = c.data.current;
    const unit = '°';
    const [label, kind] = describe(cur.weather_code);
    els.icon.innerHTML = icon(kind, cur.is_day === 1);
    els.temp.textContent = `${Math.round(cur.temperature_2m)}${unit}`;
    els.cond.textContent = `${label}, sensação ${Math.round(cur.apparent_temperature)}${unit}`;
    els.place.textContent = c.place;
    els.place.title = c.placeFull || c.place;
    const d = c.data.daily;
    els.range.textContent = `máx ${Math.round(d.temperature_2m_max[0])}${unit}  mín ${Math.round(d.temperature_2m_min[0])}${unit}`;

    const h = c.data.hourly;
    let start = h.time.findIndex(t => t > cur.time);
    if (start < 0) start = 0;
    const cells = [];
    for (let i = start; i < Math.min(start + 6, h.time.length); i++) {
      const [, k] = describe(h.weather_code[i]);
      cells.push(
        `<div class="wh"><span class="wh-time">${h.time[i].slice(11, 13)}h</span>` +
        icon(k, h.is_day[i] === 1) +
        `<span class="wh-temp">${Math.round(h.temperature_2m[i])}${unit}</span></div>`
      );
    }
    els.hours.innerHTML = cells.join('');
    els.main.hidden = false;
    els.hours.hidden = cells.length === 0;
  }

  /* ---------- rede ---------- */
  async function getJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(refresh, ms);
  }

  async function refresh() {
    clearTimeout(timer);
    if (!JRT.config.showWeather) return;

    const city = String(JRT.config.weatherCity || '').trim();
    const fahrenheit = Number(JRT.config.weatherUnit) === 1;
    if (!city) {
      showEmpty('Digite sua cidade no painel do Lively, em Clima > Cidade, para ver o tempo aqui.');
      return;
    }

    const id = ++reqId;
    const cache = readCache();
    const cacheMatches = cache && cache.city === city && cache.fahrenheit === fahrenheit;
    if (cacheMatches) render(cache);
    else showEmpty(`Buscando o clima de ${city}...`);

    try {
      let geo = cacheMatches ? cache.geo : null;
      if (!geo) {
        const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt&format=json`);
        if (!g.results || !g.results.length) {
          if (id === reqId) showEmpty(`Não encontrei "${city}". Confira o nome da cidade no painel do Lively.`);
          return;
        }
        geo = g.results[0];
      }
      const url = 'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${geo.latitude}&longitude=${geo.longitude}` +
        '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
        '&hourly=temperature_2m,weather_code,is_day' +
        '&daily=temperature_2m_max,temperature_2m_min' +
        '&timezone=auto&forecast_days=2' +
        (fahrenheit ? '&temperature_unit=fahrenheit' : '');
      const data = await getJSON(url);
      if (id !== reqId) return;

      const c = {
        city, fahrenheit, geo, data,
        place: geo.name,
        placeFull: [geo.name, geo.admin1, geo.country].filter(Boolean).join(', '),
        at: Date.now()
      };
      writeCache(c);
      render(c);
      showStatus(`Atualizado às ${hhmm(new Date())}`);
      schedule(REFRESH_MS);
    } catch (e) {
      if (id !== reqId) return;
      if (cacheMatches) {
        showStatus(`Sem conexão. Mostrando dados de ${hhmm(new Date(cache.at))}.`);
      } else {
        showEmpty('Sem conexão com o serviço de clima. Nova tentativa em 5 minutos.');
      }
      schedule(RETRY_MS);
    }
  }

  JRT.register({
    init() {
      els = {
        main: $('weather-main'), icon: $('weather-icon'), temp: $('weather-temp'), cond: $('weather-cond'),
        place: $('weather-place'), range: $('weather-range'), hours: $('weather-hours'), status: $('weather-status')
      };
      window.addEventListener('online', () => refresh());
    },

    onConfig(key) {
      if (key === 'weatherCity' || key === 'weatherUnit' || key === 'showWeather') {
        clearTimeout(debounce);
        // Espera o usuário parar de digitar a cidade
        debounce = setTimeout(refresh, key === 'weatherCity' ? 900 : 50);
      }
    }
  });
})();
