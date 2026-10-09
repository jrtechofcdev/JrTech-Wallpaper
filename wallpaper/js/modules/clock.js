/* Relógio e data */
(function () {
  'use strict';

  const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  let els;

  const pad = n => String(n).padStart(2, '0');

  function render(now) {
    const cfg = JRT.config;
    let h = now.getHours();
    let ampm = '';
    if (!cfg.use24h) {
      ampm = h < 12 ? 'AM' : 'PM';
      h = h % 12 || 12;
    }
    els.hours.textContent = pad(h);
    els.minutes.textContent = pad(now.getMinutes());
    els.ampm.textContent = ampm;
    els.seconds.textContent = pad(now.getSeconds());
    els.seconds.hidden = !cfg.showSeconds;

    els.weekday.textContent = WEEKDAYS[now.getDay()];
    els.day.textContent = `${pad(now.getDate())} de ${MONTHS[now.getMonth()]} de ${now.getFullYear()}`;
  }

  // Os dois-pontos marcam a passagem de cada segundo (útil com os segundos ocultos)
  function tickColon() {
    if (!JRT.config.showClock || JRT.state.paused || !els.colon.animate) return;
    els.colon.animate(
      [{ opacity: 1 }, { opacity: 0.35, offset: 0.35 }, { opacity: 1 }],
      { duration: 900, easing: 'ease-out' }
    );
  }

  JRT.register({
    init() {
      els = {
        hours: document.getElementById('clock-hours'),
        minutes: document.getElementById('clock-minutes'),
        colon: document.getElementById('clock-colon'),
        ampm: document.getElementById('clock-ampm'),
        seconds: document.getElementById('clock-seconds'),
        weekday: document.getElementById('clock-weekday'),
        day: document.getElementById('clock-day')
      };

      JRT.on('tick', now => {
        render(now);
        tickColon();
      });

      // Clique alterna 12h/24h nesta sessão (o padrão fica no painel do Lively)
      document.getElementById('clock-toggle').addEventListener('click', () => {
        JRT.set('use24h', !JRT.config.use24h);
      });
    },

    onConfig(key) {
      if (key === 'use24h' || key === 'showSeconds') render(new Date());
    }
  });
})();
