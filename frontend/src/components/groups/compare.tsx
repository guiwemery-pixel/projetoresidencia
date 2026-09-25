import { Minus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import type { CompareDim, GroupCompare, MixKey, PulseChange, RelLevel } from '../../api/types';
import { Avatar, Card, Segmented, cx } from '../ui';

// Comparativos do grupo: só posições relativas à média de quem compartilha.
// Nenhum número de ninguém chega ao navegador (ver backend progress/group-compare.ts).

export const DIMS: Record<CompareDim, { label: string; long: string; emoji: string; top: string }> = {
  questoes: { label: 'Questões', long: 'Quantidade de questões', emoji: '📝', top: 'Mais questões' },
  acertos: { label: 'Acertos', long: 'Aproveitamento nas questões', emoji: '🎯', top: 'Melhor aproveitamento' },
  tempo: { label: 'Tempo', long: 'Tempo de estudo', emoji: '⏱️', top: 'Mais tempo de estudo' },
  flashcards: { label: 'Flashcards', long: 'Flashcards/recall', emoji: '🃏', top: 'Mais flashcards/recall' },
  constancia: { label: 'Constância', long: 'Dias com estudo', emoji: '📅', top: 'Mais constante' },
  revisoes: { label: 'Revisões', long: 'Revisões feitas', emoji: '🔄', top: 'Mais revisões feitas' },
  assuntos: { label: 'Assuntos', long: 'Variedade de assuntos', emoji: '🧭', top: 'Mais variedade de assuntos' },
};
const DIM_ORDER = Object.keys(DIMS) as CompareDim[];

const LEVEL_TEXT: Record<RelLevel, string> = {
  'muito-acima': 'bem acima da média',
  acima: 'acima da média',
  media: 'na média',
  abaixo: 'abaixo da média',
  'muito-abaixo': 'bem abaixo da média',
  'sem-registro': 'sem registro no período',
};
const levelText = (dim: CompareDim, l: RelLevel) => (dim === 'acertos' && l === 'sem-registro' ? 'poucas questões para comparar' : LEVEL_TEXT[l]);

const SLOT: Partial<Record<RelLevel, number>> = { 'muito-abaixo': 0, abaixo: 1, media: 2, acima: 3, 'muito-acima': 4 };
const polarity = (slot: number) => (slot > 2 ? 'var(--div-pos)' : slot < 2 ? 'var(--div-neg)' : 'var(--div-mid)');

/** Régua de 5 posições; o traço do meio é a média do grupo. */
export function LevelTrack({ level, label, size = 'sm' }: { level: RelLevel; label: string; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 72 : 132;
  const h = 18;
  const pad = 7;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / 4;
  const slot = SLOT[level];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <line x1={x(0)} x2={x(4)} y1={h / 2} y2={h / 2} stroke="var(--grid)" strokeWidth={2} strokeLinecap="round" />
      {[0, 1, 3, 4].map((i) => (
        <circle key={i} cx={x(i)} cy={h / 2} r={1.75} fill="var(--axis)" />
      ))}
      <line x1={x(2)} x2={x(2)} y1={3} y2={h - 3} stroke="var(--axis)" strokeWidth={2} strokeLinecap="round" />
      {slot !== undefined && <circle cx={x(slot)} cy={h / 2} r={5.5} fill={polarity(slot)} stroke="var(--surface)" strokeWidth={2} />}
    </svg>
  );
}

function TrackLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink2">
      <span className="inline-flex items-center gap-1.5">
        <LevelTrack level="muito-abaixo" label="bem abaixo da média" /> bem abaixo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LevelTrack level="media" label="na média do grupo" /> traço do meio = média do grupo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LevelTrack level="muito-acima" label="bem acima da média" /> bem acima
      </span>
      <span className="text-muted">— sem registro no período</span>
    </div>
  );
}

function Highlights({ data }: { data: GroupCompare }) {
  const periodText = data.period === 7 ? 'da semana' : 'do mês';
  if (data.sharingCount < 2) {
    return (
      <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-ink2">
        Os destaques e comparações aparecem quando pelo menos duas pessoas do grupo compartilham o progresso.
      </p>
    );
  }
  if (!data.highlights.length) {
    return <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-ink2">Ainda não há registros no período para destacar ninguém.</p>;
  }
  return (
    <section aria-label={`Destaques ${periodText}`}>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Sparkles className="h-4 w-4 text-accent" /> Destaques {periodText}
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {data.highlights.map((h) => (
          <li key={h.key} className="rounded-2xl border border-line bg-surface p-3">
            <p className="text-xs text-ink2">
              <span aria-hidden>{DIMS[h.key].emoji}</span> {DIMS[h.key].top}
            </p>
            <p className="mt-1 truncate font-semibold text-ink" title={h.names.join(', ')}>
              {h.names.join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Você está acima da média em questões e constância, e abaixo em flashcards." */
function meSummary(levels: Record<CompareDim, RelLevel>) {
  const list = (dims: CompareDim[]) => {
    const names = dims.map((d) => DIMS[d].long.toLowerCase());
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];
  };
  const above = DIM_ORDER.filter((d) => levels[d] === 'acima' || levels[d] === 'muito-acima');
  const below = DIM_ORDER.filter((d) => levels[d] === 'abaixo' || levels[d] === 'muito-abaixo');
  if (!above.length && !below.length) return 'Você está na média do grupo em tudo o que dá para comparar.';
  const parts = [];
  if (above.length) parts.push(`acima da média do grupo em ${list(above)}`);
  if (below.length) parts.push(`${above.length ? 'abaixo em' : 'abaixo da média do grupo em'} ${list(below)}`);
  return `Você está ${parts.join(', e ')}.`;
}

function MeCard({ data }: { data: GroupCompare }) {
  const me = data.me;
  return (
    <Card title="Você em relação ao grupo" subtitle={me ? `Comparado com ${me.comparedWith === 1 ? '1 colega' : `${me.comparedWith} colegas`} que compartilham o progresso.` : undefined}>
      {!me ? (
        <p className="text-sm text-ink2">Quando outra pessoa do grupo compartilhar o progresso, sua posição aparece aqui.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink">{meSummary(me.levels)}</p>
          <ul className="space-y-1.5">
            {DIM_ORDER.map((d) => (
              <li key={d} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate text-ink sm:w-48">
                  <span aria-hidden>{DIMS[d].emoji}</span> <span className="sm:hidden">{DIMS[d].label}</span>
                  <span className="hidden sm:inline">{DIMS[d].long}</span>
                </span>
                <span className="sm:hidden">
                  <LevelTrack level={me.levels[d]} label={`${DIMS[d].long}: ${levelText(d, me.levels[d])}`} />
                </span>
                <span className="hidden sm:inline">
                  <LevelTrack level={me.levels[d]} label={`${DIMS[d].long}: ${levelText(d, me.levels[d])}`} size="md" />
                </span>
                <span className="min-w-0 whitespace-nowrap text-xs text-ink2">{levelText(d, me.levels[d])}</span>
              </li>
            ))}
          </ul>
          {!me.sharing && <p className="mt-3 text-xs text-muted">Você não compartilha seu progresso: esta comparação é só para você.</p>}
        </>
      )}
    </Card>
  );
}

function PulseRow({ dim, change }: { dim: CompareDim; change: PulseChange }) {
  const Icon = change.direction === 'up' || change.direction === 'new' ? TrendingUp : change.direction === 'down' ? TrendingDown : Minus;
  const color = change.direction === 'up' || change.direction === 'new' ? 'var(--div-pos)' : change.direction === 'down' ? 'var(--div-neg)' : 'var(--muted)';
  const text =
    change.direction === 'new'
      ? 'começou neste período'
      : change.direction === 'none'
        ? 'sem registros'
        : change.direction === 'steady'
          ? 'estável'
          : `${change.percent! > 0 ? '+' : ''}${change.percent}%`;
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="text-ink">
        <span aria-hidden>{DIMS[dim].emoji}</span> {DIMS[dim].long}
      </span>
      <span className="num inline-flex items-center gap-1.5 text-ink2">
        <Icon className="h-4 w-4" style={{ color }} aria-hidden /> {text}
      </span>
    </li>
  );
}

function PulseCard({ data }: { data: GroupCompare }) {
  const prev = data.period === 7 ? 'aos 7 dias anteriores' : 'aos 30 dias anteriores';
  const acc = data.pulse.acertos;
  return (
    <Card title="Ritmo do grupo" subtitle={`Todos que compartilham, somados, em relação ${prev}.`}>
      <ul className="space-y-2">
        {(['questoes', 'tempo', 'flashcards', 'revisoes'] as const).map((d) => (
          <PulseRow key={d} dim={d} change={data.pulse[d]} />
        ))}
        <li className="flex items-center justify-between gap-2 text-sm">
          <span className="text-ink">
            <span aria-hidden>{DIMS.acertos.emoji}</span> Aproveitamento
          </span>
          <span className="num text-ink2">
            {acc === null ? 'poucas questões para comparar' : acc.points === 0 ? 'estável' : `${acc.points > 0 ? '+' : ''}${acc.points} ${Math.abs(acc.points) === 1 ? 'ponto' : 'pontos'}`}
          </span>
        </li>
      </ul>
      <p className="mt-4 rounded-xl bg-subtle px-3 py-2 text-sm text-ink">
        <strong>{data.activeCount}</strong> de <strong>{data.sharingCount}</strong> {data.sharingCount === 1 ? 'pessoa' : 'pessoas'} que compartilham estudaram{' '}
        {data.period === 7 ? 'nesta semana' : 'neste mês'}
        {data.sharingCount < data.memberCount && <span className="text-ink2"> · {data.memberCount - data.sharingCount} preferem não compartilhar</span>}
      </p>
    </Card>
  );
}

function CompareMatrix({ data }: { data: GroupCompare }) {
  const rows = data.members;
  return (
    <Card title="Comparativo por integrante" subtitle="Posição de cada pessoa em relação à média do grupo. Sem números: faixas largas, para ninguém descobrir os dados dos outros.">
      <div className="-mx-4 overflow-x-auto sm:mx-0">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-surface py-2 pl-4 pr-3 font-medium sm:pl-0">
                Integrante
              </th>
              {DIM_ORDER.map((d) => (
                <th key={d} scope="col" className="px-1 py-2 text-center font-medium">
                  <span aria-hidden>{DIMS[d].emoji}</span> {DIMS[d].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.userId}>
                <th scope="row" className={cx('sticky left-0 z-10 border-t border-line py-2 pl-4 pr-3 font-medium sm:pl-0', m.isMe ? 'bg-accent-wash' : 'bg-surface')}>
                  <span className="flex items-center gap-2">
                    <Avatar name={m.name} src={m.avatar} size={24} />
                    <span className="max-w-[9rem] truncate text-ink">{m.name}</span>
                    {m.isMe && <span className="text-[10px] font-semibold text-ink2">você</span>}
                  </span>
                </th>
                {m.shared && m.levels ? (
                  DIM_ORDER.map((d) => (
                    <td key={d} className={cx('border-t border-line px-1 py-2 text-center', m.isMe && 'bg-accent-wash')}>
                      {m.levels![d] === 'sem-registro' ? (
                        <span className="text-muted" title={levelText(d, 'sem-registro')} aria-label={`${m.name} — ${DIMS[d].long}: ${levelText(d, 'sem-registro')}`}>
                          —
                        </span>
                      ) : (
                        <span className="inline-flex justify-center">
                          <LevelTrack level={m.levels![d]} label={`${m.name} — ${DIMS[d].long}: ${levelText(d, m.levels![d])}`} />
                        </span>
                      )}
                    </td>
                  ))
                ) : (
                  <td colSpan={DIM_ORDER.length} className="border-t border-line px-2 py-2 text-xs text-ink2">
                    Preferiu não compartilhar o progresso.
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <TrackLegend />
      </div>
    </Card>
  );
}

const MIX: { key: MixKey; label: string; color: string }[] = [
  { key: 'questoes', label: 'Questões', color: 'var(--series-1)' },
  { key: 'teoria', label: 'Teoria e leitura', color: 'var(--series-2)' },
  { key: 'flashcards', label: 'Flashcards e recall', color: 'var(--series-3)' },
  { key: 'simulados', label: 'Simulados', color: 'var(--series-4)' },
];

function MixBar({ mix, name }: { mix: Record<MixKey, number>; name: string }) {
  const parts = MIX.filter((p) => mix[p.key] > 0);
  const text = parts.map((p) => `${p.label} ${mix[p.key]}%`).join(' · ');
  return (
    <div className="min-w-0 flex-1">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded" role="img" aria-label={`Como ${name} estuda: ${text}`}>
        {parts.map((p) => (
          <div key={p.key} className="h-full first:rounded-l last:rounded-r" style={{ width: `${mix[p.key]}%`, background: p.color }} title={`${p.label}: cerca de ${mix[p.key]}%`} />
        ))}
      </div>
      <p className="num mt-1 text-xs text-ink2">{text}</p>
    </div>
  );
}

function MixList({ data }: { data: GroupCompare }) {
  const shared = data.members.filter((m) => m.shared);
  if (!shared.length) return null;
  return (
    <Card title="Como cada um estuda" subtitle="Divisão do próprio tempo de estudo no período, em faixas de 10% — sem horas.">
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink2" aria-label="Legenda">
        {MIX.map((p) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden /> {p.label}
          </li>
        ))}
      </ul>
      <ul className="space-y-3">
        {shared.map((m) => (
          <li key={m.userId} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex shrink-0 items-center gap-2 sm:w-40">
              <Avatar name={m.name} src={m.avatar} size={24} />
              <span className="truncate text-sm text-ink">{m.isMe ? `${m.name} (você)` : m.name}</span>
            </span>
            {m.mix ? <MixBar mix={m.mix} name={m.name} /> : <span className="text-xs text-muted">sem registros no período</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Seção de comparativos da página do grupo. */
export function GroupComparisons({ data, period, onPeriod }: { data: GroupCompare; period: 7 | 30; onPeriod: (p: 7 | 30) => void }) {
  return (
    <section className="space-y-4" aria-label="Comparativos do grupo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Comparativos</h2>
        <Segmented
          ariaLabel="Período"
          size="sm"
          value={period}
          onChange={onPeriod}
          options={[
            { value: 7, label: 'Últimos 7 dias' },
            { value: 30, label: 'Últimos 30 dias' },
          ]}
        />
      </div>
      <Highlights data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <MeCard data={data} />
        <PulseCard data={data} />
      </div>
      {data.sharingCount >= 2 && <CompareMatrix data={data} />}
      <MixList data={data} />
    </section>
  );
}

/** "Destaque em questões e constância" para o cartão do integrante. */
export function strengthsText(dims: CompareDim[] | undefined) {
  if (!dims?.length) return null;
  const names = dims.map((d) => DIMS[d].long.toLowerCase());
  return `Destaque em ${names.join(' e ')}`;
}
