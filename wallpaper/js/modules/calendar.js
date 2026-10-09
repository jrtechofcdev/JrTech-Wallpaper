/* Calendário mensal */
(function () {
  'use strict';

  const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let grid, monthEl, yearEl;
  // Sempre no dia 1: evita pular fevereiro quando hoje é dia 29, 30 ou 31
  let view = firstOfMonth(new Date());
  let lastDayKey = '';

  function firstOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function build(direction) {
    const today = new Date();
    const y = view.getFullYear();
    const m = view.getMonth();

    monthEl.textContent = MONTHS[m];
    yearEl.textContent = y;

    const frag = document.createDocumentFragment();
    WD.forEach(d => {
      const el = document.createElement('div');
      el.className = 'cal-wd';
      el.textContent = d;
      frag.appendChild(el);
    });

    const offset = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    for (let i = 0; i < offset; i++) frag.appendChild(document.createElement('div'));

    for (let d = 1; d <= days; d++) {
      const el = document.createElement('div');
      el.className = 'cal-d';
      el.textContent = d;
      const t = new Date(y, m, d).getTime();
      if (t === todayStart) el.classList.add('today');
      else if (t < todayStart) el.classList.add('past');
      frag.appendChild(el);
    }

    grid.replaceChildren(frag);

    grid.classList.remove('from-next', 'from-prev');
    if (direction) {
      void grid.offsetWidth;
      grid.classList.add(direction > 0 ? 'from-next' : 'from-prev');
    }
  }

  function shift(delta) {
    view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    build(delta);
  }

  function goToday() {
    const target = firstOfMonth(new Date());
    const dir = Math.sign(target - view);
    view = target;
    build(dir);
  }

  JRT.register({
    init() {
      grid = document.getElementById('cal-grid');
      monthEl = document.getElementById('cal-month');
      yearEl = document.getElementById('cal-year');

      document.getElementById('cal-prev').addEventListener('click', () => shift(-1));
      document.getElementById('cal-next').addEventListener('click', () => shift(1));
      document.getElementById('cal-title').addEventListener('click', goToday);

      // Roda do mouse sobre o calendário troca o mês
      let wheelLock = 0;
      document.getElementById('mod-calendar').addEventListener('wheel', e => {
        e.preventDefault();
        const now = performance.now();
        if (now < wheelLock) return;
        wheelLock = now + 220;
        shift(e.deltaY > 0 ? 1 : -1);
      }, { passive: false });

      // Virada do dia: atualiza o destaque de hoje
      JRT.on('tick', now => {
        const key = now.toDateString();
        if (key === lastDayKey) return;
        const wasShowingToday = !lastDayKey || view.getTime() === firstOfMonth(new Date(lastDayKey)).getTime();
        lastDayKey = key;
        if (wasShowingToday) view = firstOfMonth(now);
        build(0);
      });
    }
  });
})();
