import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Explanation } from '../../api/types';
import { fmtShort, pct, plural } from '../../lib/format';

const TREND = {
  melhora: { label: 'Melhora', icon: <TrendingUp className="h-3.5 w-3.5" style={{ color: 'var(--good)' }} /> },
  queda: { label: 'Queda', icon: <TrendingDown className="h-3.5 w-3.5" style={{ color: 'var(--crit)' }} /> },
  estavel: { label: 'Estável', icon: <Minus className="h-3.5 w-3.5 text-muted" /> },
  'sem-historico': { label: 'Sem histórico', icon: <Minus className="h-3.5 w-3.5 text-muted" /> },
} as const;

const TIMING = { 'no-prazo': 'no dia previsto', antecipada: 'antecipada', atrasada: 'atrasada' } as const;

/** Explica, em linguagem simples, por que a revisão foi agendada. */
export function WhyPanel({ explanation: e }: { explanation: Explanation }) {
  const i = e.inputs;
  const facts: [string, React.ReactNode][] = [
    ['Último desempenho', e.score !== null ? pct(e.score) : 'sem medida'],
    ['Desempenho anterior', i.previousScore !== null ? pct(i.previousScore) : '—'],
    [
      'Tendência',
      <span className="inline-flex items-center gap-1" key="t">
        {TREND[i.trend].icon}
        {TREND[i.trend].label}
      </span>,
    ],
    ['Último contato', i.lastContactOn ? `${fmtShort(i.lastContactOn)}${i.elapsedDays !== null ? ` (${plural(i.elapsedDays, 'dia', 'dias')})` : ''}` : 'primeiro contato'],
    ['Intervalo anterior', i.previousIntervalDays !== null ? plural(i.previousIntervalDays, 'dia', 'dias') : '—'],
    ['Novo intervalo', <strong key="n">{plural(e.newIntervalDays, 'dia', 'dias')}</strong>],
  ];

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-subtle px-3 py-2">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2 text-xs text-ink2">
        <span className="rounded-full border border-line px-2 py-0.5">
          Etapa {e.stage.fromLabel} → {e.stage.toLabel}
        </span>
        {e.band && <span className="rounded-full border border-line px-2 py-0.5">Faixa: {e.band.label}</span>}
        {i.timing && <span className="rounded-full border border-line px-2 py-0.5">Revisão {TIMING[i.timing]}</span>}
        <span className="rounded-full border border-line px-2 py-0.5">Revisões feitas: {i.reviewsDone}</span>
        {e.checkup && <span className="rounded-full border border-line px-2 py-0.5">Próxima: revisão D1 (questões, flashcards ou teoria)</span>}
      </div>

      <ol className="space-y-2 border-l-2 border-line pl-4">
        {e.steps.map((s, idx) => (
          <li key={idx}>
            <span className="font-medium text-ink">{s.label}</span>
            <span className="text-ink2"> — {s.detail}</span>
          </li>
        ))}
      </ol>

      {e.modifiers.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-ink2">Ajustes aplicados ao intervalo-base de {plural(e.baseIntervalDays, 'dia', 'dias')}</p>
          <ul className="flex flex-wrap gap-2">
            {e.modifiers.map((m) => (
              <li key={m.key} className="rounded-lg bg-subtle px-2 py-1 text-xs text-ink">
                {m.label} <span className="num font-semibold">×{m.factor.toLocaleString('pt-BR')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-muted">Algoritmo {e.algorithm}. Os parâmetros ficam visíveis em Perfil → Algoritmo.</p>
    </div>
  );
}
