/*
 * Tela "Lixeira": o que foi excluído nos últimos 30 dias (ver js/trash.js), com
 * restaurar e excluir de vez. Também o aviso "… foi para a lixeira · Desfazer".
 */
(function (root) {
  'use strict';
  const FC = (root.FC = root.FC || {});
  FC.views = FC.views || {};
  const { h, button } = FC.ui;
  const U = FC.util;

  /** Aviso depois de excluir, com "Desfazer" (restaura o lote). */
  function toast(message, batch) {
    if (!batch) return FC.ui.toast(message);
    FC.ui.toast(message, {
      duration: 8000,
      action: {
        label: 'Desfazer',
        run: async () => {
          try {
            await FC.trash.restore(batch.id);
            FC.ui.toast('Restaurado.');
          } catch (e) {
            FC.ui.errorToast(e);
          }
        },
      },
    });
  }

  function what(b) {
    const parts = [];
    if (b.nodes) parts.push(U.plural(b.nodes, 'área/tema', 'áreas/temas'));
    if (b.decks) parts.push(U.plural(b.decks, 'baralho', 'baralhos'));
    if (b.cards) parts.push(U.plural(b.cards, 'card', 'cards'));
    return parts.join(' · ');
  }

  FC.views.trash = {
    title: 'Lixeira',
    render(ctx) {
      const { el } = ctx;
      let busy = false;
      const run = async (fn) => {
        if (busy) return;
        busy = true;
        try {
          await fn();
        } catch (e) {
          FC.ui.errorToast(e);
        } finally {
          busy = false;
          draw();
        }
      };

      const draw = async () => {
        const batches = await FC.trash.list();
        FC.ui.clear(el);
        FC.ui.add(
          el,
          h(
            'div',
            { class: 'page-head' },
            h('div', null, h('h1', { text: 'Lixeira' }), h('p', { text: 'Cards, baralhos e áreas excluídos ficam aqui por ' + FC.trash.KEEP_DAYS + ' dias. Restaurar devolve tudo ao lugar, com o histórico de revisões.' })),
            h(
              'div',
              { class: 'row' },
              batches.length
                ? button('Esvaziar lixeira', {
                    variant: 'danger',
                    icon: 'trash',
                    onClick: async () => {
                      if (!(await FC.ui.confirm('Excluir de vez tudo o que está na lixeira? Não dá para desfazer.', { danger: true, okText: 'Esvaziar' }))) return;
                      run(async () => {
                        await FC.trash.purge();
                        FC.ui.toast('Lixeira esvaziada.');
                      });
                    },
                  })
                : null,
            ),
          ),
        );
        if (!batches.length) {
          el.appendChild(h('section', { class: 'panel' }, FC.ui.empty({ icon: 'trash', title: 'A lixeira está vazia', text: 'Ao excluir cards, baralhos ou áreas, eles aparecem aqui e podem ser restaurados.' })));
          return;
        }
        const now = Date.now();
        el.appendChild(
          h(
            'section',
            { class: 'panel' },
            h(
              'div',
              { class: 'list trash-list' },
              batches.map((b) => {
                const days = Math.max(0, Math.ceil((b.expiresAt - now) / 86400000));
                return h(
                  'div',
                  { class: 'card-row trash-row' },
                  h(
                    'div',
                    { style: { minWidth: 0 } },
                    h('div', { class: 'q', text: b.label }),
                    h('div', { class: 'meta' }, h('span', { text: what(b) }), h('span', { class: 'crumb', text: '· excluído em ' + U.formatDateTime(b.deletedAt) }), h('span', { class: 'crumb', text: '· ' + (days <= 1 ? 'sai amanhã' : 'sai em ' + days + ' dias') })),
                  ),
                  h(
                    'div',
                    { class: 'row tight nowrap-row' },
                    button('Restaurar', {
                      size: 'sm',
                      icon: 'undo',
                      onClick: () =>
                        run(async () => {
                          const r = await FC.trash.restore(b.id);
                          FC.ui.toast('Restaurado' + (r.cards ? ': ' + U.plural(r.cards, 'card', 'cards') : '') + '.');
                        }),
                    }),
                    button('', {
                      size: 'sm',
                      variant: 'ghost',
                      icon: 'trash',
                      title: 'Excluir de vez',
                      onClick: async () => {
                        if (!(await FC.ui.confirm('Excluir de vez "' + b.label + '"? Não dá para desfazer.', { danger: true, okText: 'Excluir de vez' }))) return;
                        run(() => FC.trash.purge([b.id]));
                      },
                    }),
                  ),
                );
              }),
            ),
          ),
        );
      };
      draw();
      ctx.on('trash', U.debounce(draw, 200));
    },
  };

  FC.trashView = { toast };
})(typeof self !== 'undefined' ? self : globalThis);
