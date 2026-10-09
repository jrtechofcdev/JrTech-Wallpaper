/* Sistema: CPU, GPU, memória, rede, bateria e disco (manual) */
(function () {
  'use strict';

  const HISTORY = 60;
  const MISSING = 'O Lively não enviou este dado';

  const series = { cpu: [], gpu: [], ram: [], down: [], up: [] };
  const target = { cpu: null, gpu: null, ram: null };
  const shown = { cpu: 0, gpu: 0, ram: 0 };
  const drawn = { cpu: -1, gpu: -1, ram: -1 };
  const shownText = { cpu: '', gpu: '', ram: '' };
  let els = {};

  const $ = id => document.getElementById(id);

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) return +v;
    return null;
  }

  const fmt = (v, d = 0) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

  function fmtRate(bytes) {
    if (bytes >= 1024 * 1024) return [fmt(bytes / 1048576, bytes >= 10 * 1048576 ? 0 : 1), 'MB/s'];
    return [fmt(bytes / 1024, 0), 'KB/s'];
  }

  function push(arr, v) {
    arr.push(v);
    if (arr.length > HISTORY) arr.shift();
  }

  function stats(arr) {
    const vals = arr.filter(v => v !== null);
    if (!vals.length) return null;
    let min = Infinity, max = -Infinity, sum = 0;
    vals.forEach(v => { min = Math.min(min, v); max = Math.max(max, v); sum += v; });
    return { min, max, avg: sum / vals.length };
  }

  function percentStats(key) {
    const s = stats(series[key]);
    els[key + 'Stats'].textContent = s
      ? `Último minuto: mín ${fmt(s.min)}%, média ${fmt(s.avg)}%, máx ${fmt(s.max)}%`
      : '';
  }

  /* ---------- sparkline (curva suave, reaproveitada da v2) ---------- */
  function drawSpark(canvas, lines, maxValue) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width * dpr);
    const H = Math.round(rect.height * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    const px = dpr * JRT.state.scale;
    const pad = 2 * px;
    ctx.clearRect(0, 0, W, H);

    lines.forEach(({ data, color }) => {
      const pts = data.map(v => (v === null ? 0 : v));
      const n = pts.length;
      if (n < 2) return;
      const step = (W - pad * 2) / (HISTORY - 1);
      const x0 = W - pad - (n - 1) * step;
      const yOf = v => H - pad - (Math.min(v, maxValue) / maxValue) * (H - pad * 2);

      ctx.beginPath();
      ctx.moveTo(x0, yOf(pts[0]));
      for (let i = 1; i < n; i++) {
        const xp = x0 + (i - 1) * step;
        const x = x0 + i * step;
        const cx = (xp + x) / 2;
        ctx.bezierCurveTo(cx, yOf(pts[i - 1]), cx, yOf(pts[i]), x, yOf(pts[i]));
      }

      const stroke = ctx.createLinearGradient(x0, 0, W, 0);
      stroke.addColorStop(0, JRT.rgba(color, 0.15));
      stroke.addColorStop(1, JRT.rgba(color, 1));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.6 * px;
      ctx.lineJoin = 'round';
      ctx.stroke();

      ctx.lineTo(W - pad, H);
      ctx.lineTo(x0, H);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, H);
      fill.addColorStop(0, JRT.rgba(color, 0.22));
      fill.addColorStop(1, JRT.rgba(color, 0));
      ctx.fillStyle = fill;
      ctx.fill();

      // Ponto no valor atual
      ctx.beginPath();
      ctx.arc(W - pad, yOf(pts[n - 1]), 2.2 * px, 0, Math.PI * 2);
      ctx.fillStyle = JRT.rgba(color, 1);
      ctx.fill();
    });
  }

  function drawAllSparks() {
    const c1 = JRT.config.accentColor1;
    const c2 = JRT.config.accentColor2;
    drawSpark(els.cpuSpark, [{ data: series.cpu, color: c1 }], 100);
    drawSpark(els.gpuSpark, [{ data: series.gpu, color: c2 }], 100);
    // Rede: escala pelo pico do último minuto, não por um teto fixo
    const peak = Math.max(64 * 1024, ...series.down.map(v => v || 0), ...series.up.map(v => v || 0));
    drawSpark(els.netSpark, [{ data: series.up, color: c1 }, { data: series.down, color: c2 }], peak * 1.15);
  }

  /* ---------- dados do Lively ---------- */
  function onSysInfo(obj) {
    const cpu = num(obj.CurrentCpu);
    const gpu = num(obj.CurrentGpu3D);
    const totalRam = num(obj.TotalRam);
    const availRam = num(obj.CurrentRamAvail);
    const ramPct = totalRam && availRam !== null ? ((totalRam - availRam) / totalRam) * 100 : null;
    const down = num(obj.CurrentNetDown);
    const up = num(obj.CurrentNetUp);

    target.cpu = cpu === null ? null : Math.max(0, Math.min(100, cpu));
    target.gpu = gpu === null ? null : Math.max(0, Math.min(100, gpu));
    target.ram = ramPct === null ? null : Math.max(0, Math.min(100, ramPct));

    push(series.cpu, target.cpu);
    push(series.gpu, target.gpu);
    push(series.ram, target.ram);
    push(series.down, down);
    push(series.up, up);

    setName(els.cpuName, obj.NameCpu);
    setName(els.gpuName, obj.NameGpu);
    setName(els.netName, obj.NameNetCard);

    setTemp(els.cpuTemp, num(obj.CpuTemp));
    setTemp(els.gpuTemp, num(obj.GpuTemp));

    els.ramDetail.textContent = totalRam && availRam !== null
      ? `${fmt((totalRam - availRam) / 1024, 1)} de ${fmt(totalRam / 1024, 1)} GB`
      : '';

    ['cpu', 'gpu', 'ram'].forEach(k => {
      els[k + 'Bar'].classList.toggle('warn', target[k] !== null && target[k] >= 75 && target[k] < 90);
      els[k + 'Bar'].classList.toggle('crit', target[k] !== null && target[k] >= 90);
      els[k + 'Row'].title = target[k] === null ? MISSING : '';
      percentStats(k);
    });

    if (down === null || up === null) {
      els.netDown.textContent = els.netUp.textContent = 'n/d';
      els.netDownU.textContent = els.netUpU.textContent = '';
      els.netRow.title = MISSING;
    } else {
      const d = fmtRate(down), u = fmtRate(up);
      els.netDown.textContent = d[0]; els.netDownU.textContent = d[1];
      els.netUp.textContent = u[0]; els.netUpU.textContent = u[1];
      els.netRow.title = '';
      const pd = Math.max(...series.down.map(v => v || 0));
      const pu = Math.max(...series.up.map(v => v || 0));
      els.netStats.textContent = `Pico no último minuto: download ${fmtRate(pd).join(' ')}, upload ${fmtRate(pu).join(' ')}`;
    }

    drawAllSparks();
  }

  function setName(el, name) {
    const v = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    el.textContent = v || 'Nome não informado pelo Lively';
  }

  function setTemp(el, t) {
    if (t === null || t <= 0) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = `${fmt(t)}°C`;
    el.style.color = t >= 85 ? 'var(--crit)' : t >= 70 ? 'var(--warn)' : '';
  }

  /* ---------- disco: o Lively não informa, então é manual ---------- */
  function renderDisk() {
    const on = JRT.config.showDisk;
    els.diskRow.hidden = !on;
    if (!on) return;
    const parse = v => parseFloat(String(v).replace(',', '.'));
    const used = parse(JRT.config.diskUsed);
    const total = parse(JRT.config.diskTotal);
    if (!(used >= 0) || !(total > 0)) {
      els.diskVal.textContent = 'n/d';
      els.diskDetail.textContent = '';
      els.diskBar.style.setProperty('--p', '0%');
      els.diskNote.textContent = 'Preencha "usado" e "total" em GB no painel do Lively';
      return;
    }
    const pct = Math.min(100, (used / total) * 100);
    els.diskVal.textContent = fmt(pct);
    els.diskDetail.textContent = `${fmt(used)} de ${fmt(total)} GB`;
    els.diskBar.style.setProperty('--p', pct + '%');
    els.diskBar.classList.toggle('warn', pct >= 75 && pct < 90);
    els.diskBar.classList.toggle('crit', pct >= 90);
    els.diskNote.textContent = 'Valor manual, definido no painel do Lively';
  }

  /* ---------- bateria: API do próprio navegador (WebView2) ---------- */
  function initBattery() {
    if (!navigator.getBattery) return;
    navigator.getBattery().then(b => {
      const render = () => {
        const pct = Math.round(b.level * 100);
        els.battery.hidden = false;
        els.batteryVal.textContent = `${pct}%${b.charging ? ' na tomada' : ''}`;
        els.batteryFill.setAttribute('width', (18 * b.level).toFixed(1));
        els.battery.classList.toggle('charging', b.charging);
        els.battery.classList.toggle('low', pct <= 20 && !b.charging);
        els.battery.title = b.charging ? 'Carregando' : 'Na bateria';
      };
      render();
      b.addEventListener('levelchange', render);
      b.addEventListener('chargingchange', render);
    }).catch(() => {});
  }

  JRT.register({
    init() {
      els = {
        cpuVal: $('cpu-val'), cpuBar: $('cpu-bar'), cpuName: $('cpu-name'), cpuTemp: $('cpu-temp'), cpuSpark: $('cpu-spark'), cpuStats: $('cpu-stats'), cpuRow: $('row-cpu'),
        gpuVal: $('gpu-val'), gpuBar: $('gpu-bar'), gpuName: $('gpu-name'), gpuTemp: $('gpu-temp'), gpuSpark: $('gpu-spark'), gpuStats: $('gpu-stats'), gpuRow: $('row-gpu'),
        ramVal: $('ram-val'), ramBar: $('ram-bar'), ramDetail: $('ram-detail'), ramStats: $('ram-stats'), ramRow: $('row-ram'),
        netDown: $('net-down'), netDownU: $('net-down-u'), netUp: $('net-up'), netUpU: $('net-up-u'), netName: $('net-name'), netSpark: $('net-spark'), netStats: $('net-stats'), netRow: $('row-net'),
        diskRow: $('row-disk'), diskVal: $('disk-val'), diskBar: $('disk-bar'), diskDetail: $('disk-detail'), diskNote: document.querySelector('#row-disk .hw-note'),
        battery: $('battery'), batteryVal: $('battery-val'), batteryFill: $('battery-fill')
      };
      JRT.on('sysinfo', onSysInfo);
      JRT.on('resize', drawAllSparks);
      initBattery();
    },

    isActive() {
      return JRT.config.showHardware;
    },

    // Valores e barras deslizam até o dado novo em vez de saltar
    frame(now, dt) {
      const k = 1 - Math.exp(-dt * 6);
      ['cpu', 'gpu', 'ram'].forEach(key => {
        const t = target[key];
        if (t === null) {
          if (shownText[key] !== 'n/d') {
            els[key + 'Val'].textContent = shownText[key] = 'n/d';
            els[key + 'Bar'].style.setProperty('--p', '0%');
            drawn[key] = -1;
          }
          return;
        }
        shown[key] += (t - shown[key]) * k;
        const bar = Math.round(shown[key] * 10) / 10;
        if (bar !== drawn[key]) {
          els[key + 'Bar'].style.setProperty('--p', bar + '%');
          drawn[key] = bar;
        }
        const txt = String(Math.round(shown[key]));
        if (txt !== shownText[key]) {
          els[key + 'Val'].textContent = shownText[key] = txt;
        }
      });
    },

    onConfig(key) {
      if (key === 'showDisk' || key === 'diskUsed' || key === 'diskTotal') renderDisk();
      if (key === 'accentColor1' || key === 'accentColor2') drawAllSparks();
      if (key === 'showHardware') requestAnimationFrame(drawAllSparks);
    }
  });
})();
