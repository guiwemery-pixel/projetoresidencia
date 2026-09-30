/*
 * Cronômetro/timer de estudo na tela (opcional: Configurações → "Cronômetro de estudo").
 * - Relógio no cabeçalho dos flashcards; tocar abre o painel: cronômetro ou timer,
 *   Iniciar · Pausar · Retomar · Zerar, e "Registrar estudo com este tempo".
 * - Pode iniciar sozinho ao começar uma revisão e pausar ao sair dela.
 * - Ao fim da sessão, o "Registrar estudo" usa o tempo do cronômetro: é assim que ele
 *   entra no tempo estudado do Projeto Residente. Depois de usado, o cronômetro zera
 *   (com "Desfazer"). Lógica em js/timer.js.
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  const { h, button, icon } = FC.ui;
  const T = () => FC.timer;
  const PRESETS = [5, 10, 15, 25, 30, 45, 60, 90];

  const enabled = () => !!FC.settings.get('studyTimer');
  const shown = () => T().state.mode === 'timer' ? T().remaining() : T().elapsed();

  let lastSubject = null; // assunto da última sessão (para o registro pelo painel)
  let panel = null; // painel aberto (um só)

  // ── Relógio do cabeçalho ──────────────────────────────────────────────────
  function chip() {
    const text = h('span', { class: 'num' });
    const el = h('button', { type: 'button', class: 'fc-timer', title: 'Cronômetro de estudo', 'aria-label': 'Cronômetro de estudo', onclick: () => openPanel() }, icon('clock', 15), text);
    const draw = () => {
      const s = T().state;
      el.classList.toggle('hidden', !enabled());
      el.classList.toggle('running', s.running);
      el.classList.toggle('paused', !s.running && (s.acc > 0 || s.finished));
      el.classList.toggle('done', s.finished);
      text.textContent = s.mode === 'timer' && !s.running && !s.acc ? FC.timer.format(s.target) : FC.timer.format(shown());
    };
    draw();
    const offTimer = T().on(draw);
    const offSettings = FC.store.on('settings', draw);
    el._cleanup = () => (offTimer(), offSettings());
    return el;
  }

  // ── Painel ────────────────────────────────────────────────────────────────
  function openPanel() {
    if (panel) return;
    const display = h('div', { class: 'timer-display num', 'aria-live': 'off' });
    const sub = h('p', { class: 'small ink2 timer-sub' });
    const modeTabs = FC.ui.tabs(
      [
        { key: 'stopwatch', label: 'Cronômetro' },
        { key: 'timer', label: 'Timer' },
      ],
      T().state.mode,
      (k) => {
        if (!T().setMode(k)) FC.ui.toast('Zere antes de trocar entre cronômetro e timer.', { error: true });
        draw();
      },
    );
    const custom = h('input', { type: 'number', min: '1', max: '360', class: 'input', style: { width: '90px' }, 'aria-label': 'Minutos do timer', placeholder: 'min' });
    custom.addEventListener('change', () => custom.value && T().setTarget(custom.value));
    const presets = h(
      'div',
      { class: 'row tight timer-presets' },
      PRESETS.map((m) => h('button', { type: 'button', class: 'chip-btn', dataset: { min: String(m) }, text: m + ' min', onclick: () => T().setTarget(m) })),
      custom,
    );
    const controls = h('div', { class: 'row timer-controls' });
    const registerText = h('p', { class: 'small ink2' });
    const registerBtn = button('Registrar estudo com este tempo', {
      icon: 'book',
      onClick: () => {
        const minutes = Math.round(T().elapsed() / FC.timer.MIN);
        if (minutes < 1) return;
        m.close();
        registerWithTimer({ method: 'FLASHCARDS', minutes, subject: lastSubject, notes: 'Flashcards (tempo do cronômetro).' });
      },
    });
    const register = FC.host && FC.host.registerStudy ? h('div', { class: 'panel flat stack' }, registerText, h('div', null, registerBtn)) : null;
    const auto = FC.ui.checkbox('Iniciar sozinho ao começar uma revisão (e pausar ao sair dela)', FC.settings.get('studyTimerAuto'), (v) => FC.settings.set({ studyTimerAuto: v }));

    // A cada segundo: só números e textos (os botões ficam, para o toque não se perder)
    function drawTime() {
      const s = T().state;
      display.textContent = s.mode === 'timer' && !s.running && !s.acc ? FC.timer.format(s.target) : FC.timer.format(shown());
      display.classList.toggle('running', s.running);
      display.classList.toggle('done', s.finished);
      sub.textContent =
        s.mode === 'timer'
          ? s.finished
            ? 'Tempo esgotado: ' + FC.timer.format(s.target) + ' de estudo.'
            : 'Contagem regressiva. Estudado até agora: ' + FC.timer.format(T().elapsed()) + '.'
          : s.running
            ? 'Contando o tempo de estudo.'
            : s.acc
              ? 'Pausado.'
              : 'Toque em Iniciar quando começar a estudar.';
      if (register) {
        const minutes = Math.round(T().elapsed() / FC.timer.MIN);
        registerText.textContent = minutes >= 1 ? 'Conte ' + minutes + ' min no seu tempo de estudo do Projeto Residente (método Flashcards).' : 'Com pelo menos 1 minuto marcado, dá para registrar o estudo com este tempo.';
        registerBtn.disabled = minutes < 1;
      }
    }

    // Mudou o estado (iniciou, pausou, zerou, trocou o modo): refaz os botões
    function draw() {
      const s = T().state;
      drawTime();
      modeTabs.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.k === s.mode)));
      const zero = !s.running && !s.acc;
      presets.classList.toggle('hidden', s.mode !== 'timer' || !zero);
      presets.querySelectorAll('[data-min]').forEach((b) => b.classList.toggle('on', Number(b.dataset.min) * FC.timer.MIN === s.target));
      FC.ui.clear(controls);
      if (s.running) controls.appendChild(button('Pausar', { icon: 'pause', variant: 'primary', onClick: () => T().pause() }));
      else if (s.acc && !s.finished) controls.appendChild(button('Retomar', { icon: 'play', variant: 'primary', onClick: () => T().resume() }));
      else if (!s.finished) controls.appendChild(button('Iniciar', { icon: 'play', variant: 'primary', onClick: () => T().start() }));
      controls.appendChild(button('Zerar', { icon: 'undo', disabled: zero && !s.finished, onClick: () => resetWithUndo('Cronômetro zerado.') }));
    }

    const content = h(
      'div',
      { class: 'stack loose timer-panel' },
      modeTabs,
      h('div', { class: 'stack', style: { alignItems: 'center' } }, display, sub),
      presets,
      controls,
      register,
      auto.el,
      h('p', { class: 'tiny muted', text: 'O cronômetro fica neste aparelho e continua contando se você trocar de aba ou recarregar a página.' }),
    );
    draw();
    const off = T().on((type) => (type === 'tick' ? drawTime() : draw()));
    const m = FC.ui.modal({
      title: 'Cronômetro de estudo',
      size: 'narrow',
      content,
      onClose: () => {
        off();
        panel = null;
      },
    });
    panel = m;
  }

  /** Zera com "Desfazer". */
  function resetWithUndo(message) {
    const snap = T().snapshot();
    T().reset();
    FC.ui.toast(message, { action: { label: 'Desfazer', run: () => T().restore(snap) } });
  }

  /**
   * Abre o "Registrar estudo" do site com o tempo do cronômetro. O cronômetro pausa e só
   * zera quando o estudo é salvo — cancelou o registro, o tempo continua lá.
   */
  function registerWithTimer(info) {
    T().pause();
    if (panel) panel.close();
    const snap = T().snapshot();
    FC.host.registerStudy(info, {
      onSaved: () => {
        // Não zera o que foi marcado depois (ex.: retomou o cronômetro com o registro aberto)
        const s = T().state;
        if (s.mode === snap.mode && s.acc === snap.acc && !s.running) T().reset();
      },
    });
  }

  /**
   * Registro do fim da sessão: com o cronômetro ligado e ≥ 1 min marcado, usa o tempo dele
   * no lugar da duração da sessão.
   */
  function forStudy(info) {
    if (info && info.subject) lastSubject = info.subject;
    if (!enabled() || !FC.settings.get('studyTimerForStudy')) return { info, fromTimer: false };
    const minutes = Math.round(T().elapsed() / FC.timer.MIN);
    if (minutes < 1) return { info, fromTimer: false };
    return { info: Object.assign({}, info, { minutes }), fromTimer: true };
  }

  // ── Sessões (revisão, Quick Review, cards da plataforma) ──────────────────
  function sessionStart() {
    if (!enabled() || !FC.settings.get('studyTimerAuto')) return;
    const s = T().state;
    if (s.running || s.finished) return;
    T().start();
  }

  function sessionEnd() {
    if (!enabled() || !FC.settings.get('studyTimerAuto')) return;
    T().pause();
  }

  // ── Timer esgotado: som, vibração e aviso ─────────────────────────────────
  function beep() {
    try {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      [0, 0.25, 0.5].forEach((d, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = i === 2 ? 1046 : 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.22);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + d);
        o.stop(ctx.currentTime + d + 0.25);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch (e) {
      /* sem áudio */
    }
  }

  let listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    T().on((type, p) => {
      if (type !== 'finished' || !enabled()) return;
      if (!p.late) {
        beep();
        if (root.navigator && root.navigator.vibrate) root.navigator.vibrate([200, 100, 200]);
      }
      const minutes = p.minutes;
      FC.ui.toast('⏰ Tempo esgotado: ' + minutes + ' min de estudo.', {
        duration: 12000,
        action: FC.host && FC.host.registerStudy ? { label: 'Registrar estudo', run: () => registerWithTimer({ method: 'FLASHCARDS', minutes, subject: lastSubject, notes: 'Flashcards (timer de ' + minutes + ' min).' }) } : null,
      });
    });
  }

  FC.timerView = { chip, openPanel, forStudy, registerWithTimer, sessionStart, sessionEnd, listen };
})(typeof self !== 'undefined' ? self : globalThis);
