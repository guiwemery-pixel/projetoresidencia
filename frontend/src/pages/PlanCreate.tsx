import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronDown, Plus, Search, X } from 'lucide-react';
import { api } from '../api/client';
import type { AreaNode, Subject } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { useAreas, usePlan, useSubjects } from '../hooks/api';
import { addDaysStr, fmtShort, plural, startOfWeekStr, todayLocal } from '../lib/format';
import { AreaDot, Button, Card, ErrorState, Input, Loading, NumberInput, PageHeader, Segmented, Spinner, cx, useToast } from '../components/ui';
import { DEFAULT_DAYS, DEFAULT_MINUTES, StudyDaysFields } from '../components/study/StudyDays';
import { DistributionPreview, type PlanDistribution } from '../components/study/DistributionPreview';
import { normalize } from '../components/study/SubjectPicker';

// Montar um cronograma na plataforma (sem PDF de cursinho): escolher os assuntos da conta
// (ou novos), o ritmo (N por semana ou até uma data) e a ordem; o backend monta as semanas
// (plans/compose.ts) e distribui cada semana pelos dias de estudo. Com ?plano=<id>, os
// assuntos são acrescentados a um cronograma que já existe.

type PaceKind = 'perWeek' | 'until';
type Order = 'interleave' | 'sequence';
interface NewSubject {
  name: string;
  area: string;
}
interface ComposePreview {
  items: number;
  skipped: number;
  newSubjects: number;
  newAreas: string[];
  firstWeek: string;
  lastWeek: string;
  weeks: { weekStart: string; label: string; subjects: { name: string; area: string | null }[] }[];
  distribution: PlanDistribution;
}

const fmtFull = (d: string) => d.split('-').reverse().join('/');

/** Caixa de marcar com o estado "alguns" (área com parte dos assuntos escolhidos). */
function TriCheckbox({ checked, some, onChange, label }: { checked: boolean; some: boolean; onChange: (v: boolean) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = some && !checked;
  }, [some, checked]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />;
}

export default function PlanCreatePage() {
  const today = todayLocal();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const planId = params.get('plano') ?? undefined;
  const plan = usePlan(planId);
  const areas = useAreas();
  const subjects = useSubjects();

  const thisMonday = startOfWeekStr(today);
  const nextMonday = thisMonday === today ? today : addDaysStr(thisMonday, 7);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<NewSubject[]>([]);
  const [newName, setNewName] = useState('');
  const [newArea, setNewArea] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [start, setStart] = useState(nextMonday);
  const [paceKind, setPaceKind] = useState<PaceKind>('perWeek');
  const [perWeek, setPerWeek] = useState<number | null>(5);
  const [until, setUntil] = useState(addDaysStr(nextMonday, 7 * 12 - 1));
  const [order, setOrder] = useState<Order>('interleave');
  const [schedule, setSchedule] = useState({
    weekdays: user?.studyWeekdays?.length ? user.studyWeekdays : DEFAULT_DAYS,
    minutes: user?.dailyStudyMinutes ?? DEFAULT_MINUTES,
  });
  const [name, setName] = useState('Meu cronograma');
  const [preview, setPreview] = useState<ComposePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Acrescentar a um cronograma: começa na semana seguinte à última dele
  const appendStart = plan.data?.lastWeek ? addDaysStr(plan.data.lastWeek, 7) : null;
  useEffect(() => {
    if (appendStart && appendStart > nextMonday) setStart(appendStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendStart]);
  const inPlan = useMemo(() => new Set((plan.data?.items ?? []).filter((i) => i.status === 'PENDING').map((i) => i.subject.id)), [plan.data]);

  const tree = useMemo(() => [...(areas.data ?? [])].sort((a, b) => a.position - b.position), [areas.data]);
  const byArea = useMemo(() => {
    const map = new Map<string, Subject[]>();
    for (const s of subjects.data ?? []) if (!s.archived) map.set(s.areaId, [...(map.get(s.areaId) ?? []), s]);
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return map;
  }, [subjects.data]);
  const colorOf = useMemo(() => new Map(tree.map((a) => [a.name, a.color])), [tree]);

  const q = normalize(query.trim());
  const matches = (s: Subject) => !q || normalize(s.name).includes(q);
  /** Assuntos de uma área (os dela e os das subáreas), na ordem da tela. */
  const idsOf = (area: AreaNode) => [area, ...[...(area.children ?? [])].sort((a, b) => a.position - b.position)].flatMap((a) => (byArea.get(a.id) ?? []).filter((s) => !inPlan.has(s.id)).map((s) => s.id));
  const setMany = (ids: string[], on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  // O que vai para o backend: na ordem das áreas (os novos no fim da área deles)
  const payload = useMemo(() => {
    const list: ({ subjectId: string } | { name: string; area: string })[] = [];
    for (const area of tree) {
      for (const id of idsOf(area)) if (selected.has(id)) list.push({ subjectId: id });
      for (const n of extra.filter((x) => x.area === area.name)) list.push({ name: n.name, area: n.area });
    }
    return {
      ...(planId ? { planId } : { name: name.trim() || 'Meu cronograma' }),
      start,
      pace: paceKind === 'perWeek' ? { kind: 'perWeek' as const, perWeek: perWeek ?? 1 } : { kind: 'until' as const, until },
      order,
      subjects: list,
      schedule: { weekdays: schedule.weekdays, dailyMinutes: schedule.minutes },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, byArea, selected, extra, planId, name, start, paceKind, perWeek, until, order, schedule, inPlan]);
  const count = payload.subjects.length;
  const valid = count > 0 && schedule.weekdays.length > 0 && (paceKind === 'perWeek' ? (perWeek ?? 0) >= 1 : until >= start);

  // Prévia ao vivo (o nome não muda a prévia)
  const previewKey = JSON.stringify({ ...payload, name: undefined });
  const seq = useRef(0);
  useEffect(() => {
    if (!valid) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.post<ComposePreview>('/plans/compose/preview', payload);
        if (mine === seq.current) (setPreview(r), setPreviewError(null));
      } catch (err) {
        if (mine === seq.current) (setPreview(null), setPreviewError(err));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, valid]);

  const addNew = () => {
    const n = newName.trim();
    const a = newArea || tree[0]?.name;
    if (!n || !a) return;
    setExtra((cur) => (cur.some((x) => normalize(x.name) === normalize(n) && x.area === a) ? cur : [...cur, { name: n, area: a }]));
    setNewName('');
  };

  async function create() {
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>('/plans/compose', payload);
      await qc.invalidateQueries();
      toast.success(planId ? 'Assuntos acrescentados ao cronograma.' : 'Cronograma criado! Cada assunto já está no seu dia de estudo.');
      navigate(`/cronograma?plano=${res.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (areas.isLoading || subjects.isLoading || (planId && plan.isLoading)) return <Loading />;
  if (areas.error || subjects.error) return <ErrorState error={areas.error ?? subjects.error} />;
  if (planId && plan.error) return <ErrorState error={plan.error} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title={planId ? `Acrescentar assuntos · ${plan.data?.name ?? ''}` : 'Criar cronograma'}
        subtitle={
          planId
            ? 'Escolha os assuntos e o ritmo: eles entram nas semanas seguintes do cronograma, distribuídos pelos seus dias de estudo.'
            : 'Monte o seu cronograma com os assuntos da plataforma: escolha os assuntos, o ritmo e os dias em que você estuda.'
        }
      />

      <Card title="1. Escolha os assuntos" subtitle={count ? `${plural(count, 'assunto escolhido', 'assuntos escolhidos')}.` : 'Marque uma grande área inteira, uma subárea ou assuntos soltos.'}>
        <label className="relative mb-3 block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Buscar assunto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar assunto" />
        </label>
        <div className="space-y-2">
          {tree.map((area) => {
            const ids = idsOf(area);
            const chosen = ids.filter((id) => selected.has(id)).length;
            const subs = [...(area.children ?? [])].sort((a, b) => a.position - b.position);
            const isOpen = !!q || open[area.id];
            const visible = (a: AreaNode) => (byArea.get(a.id) ?? []).filter(matches);
            if (q && ![area, ...subs].some((a) => visible(a).length)) return null;
            const row = (s: Subject) => {
              const already = inPlan.has(s.id);
              return (
                <label key={s.id} className={cx('flex items-center gap-2 rounded-lg px-2 py-1 text-sm', already ? 'opacity-60' : 'hover:bg-subtle')}>
                  <input
                    type="checkbox"
                    disabled={already}
                    checked={selected.has(s.id)}
                    onChange={(e) => setMany([s.id], e.target.checked)}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">{s.name}</span>
                  {already && <span className="shrink-0 text-xs text-muted">já no cronograma</span>}
                  {!already && s.learning && <span className="shrink-0 text-xs text-muted">já estudado</span>}
                </label>
              );
            };
            return (
              <section key={area.id} className="rounded-xl border border-line">
                <header className="flex items-center gap-2 px-3 py-2">
                  <TriCheckbox checked={ids.length > 0 && chosen === ids.length} some={chosen > 0} onChange={(v) => setMany(ids, v)} label={`Todos de ${area.name}`} />
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => ({ ...o, [area.id]: !o[area.id] }))} aria-expanded={isOpen}>
                    <AreaDot color={area.color} />
                    <span className="truncate font-medium text-ink">{area.name}</span>
                    <span className="num shrink-0 text-xs text-muted">
                      {chosen}/{ids.length}
                    </span>
                    <ChevronDown className={cx('ml-auto h-4 w-4 shrink-0 text-muted transition', isOpen && 'rotate-180')} />
                  </button>
                </header>
                {isOpen && (
                  <div className="space-y-2 border-t border-line px-3 py-2">
                    {visible(area).map(row)}
                    {subs.map((sub) => {
                      const list = visible(sub);
                      if (!list.length) return null;
                      const subIds = list.filter((s) => !inPlan.has(s.id)).map((s) => s.id);
                      const subChosen = subIds.filter((id) => selected.has(id)).length;
                      return (
                        <div key={sub.id}>
                          <label className="flex items-center gap-2 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink2">
                            <TriCheckbox checked={subIds.length > 0 && subChosen === subIds.length} some={subChosen > 0} onChange={(v) => setMany(subIds, v)} label={`Todos de ${sub.name}`} />
                            {sub.name}
                          </label>
                          <div className="pl-4">{list.map(row)}</div>
                        </div>
                      );
                    })}
                    {!ids.length && !visible(area).length && <p className="px-2 py-1 text-sm text-muted">Nenhum assunto nesta área ainda. Crie abaixo.</p>}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="mt-4 rounded-xl border border-dashed border-line p-3">
          <p className="mb-2 text-sm font-medium text-ink">Assunto que ainda não existe</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="input min-w-0 sm:flex-1"
              placeholder="Ex.: Pancreatite aguda"
              value={newName}
              maxLength={160}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNew())}
              aria-label="Nome do assunto novo"
            />
            <select className="input sm:w-auto" value={newArea || tree[0]?.name || ''} onChange={(e) => setNewArea(e.target.value)} aria-label="Grande área do assunto novo">
              {tree.map((a) => (
                <option key={a.id} value={a.name}>
                  {a.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" className="self-start sm:self-auto" icon={<Plus className="h-4 w-4" />} disabled={!newName.trim()} onClick={addNew}>
              Incluir
            </Button>
          </div>
          {extra.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {extra.map((n) => (
                <li key={`${n.area}|${n.name}`} className="chip text-xs text-ink">
                  <AreaDot color={colorOf.get(n.area)} /> {n.name}
                  <button type="button" aria-label={`Tirar ${n.name}`} onClick={() => setExtra((cur) => cur.filter((x) => x !== n))} className="text-muted hover:text-ink">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="2. Ritmo e ordem">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <Input label="Começa em" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
            <div>
              <span className="label">Ritmo</span>
              <Segmented<PaceKind>
                value={paceKind}
                onChange={setPaceKind}
                ariaLabel="Ritmo"
                options={[
                  { value: 'perWeek', label: 'Assuntos por semana' },
                  { value: 'until', label: 'Terminar até uma data' },
                ]}
              />
            </div>
            {paceKind === 'perWeek' ? (
              <NumberInput label="Assuntos por semana" min={1} max={60} value={perWeek} onChange={setPerWeek} />
            ) : (
              <Input label="Terminar até (ex.: a data da prova)" type="date" min={start} value={until} onChange={(e) => e.target.value && setUntil(e.target.value)} />
            )}
          </div>
          <div>
            <span className="label">Ordem dos assuntos</span>
            <Segmented<Order>
              value={order}
              onChange={setOrder}
              ariaLabel="Ordem dos assuntos"
              options={[
                { value: 'interleave', label: 'Intercalar as áreas' },
                { value: 'sequence', label: 'Uma área de cada vez' },
              ]}
            />
            <p className="mt-2 text-xs text-ink2">
              {order === 'interleave'
                ? 'Cada grande área fica espalhada pelo cronograma inteiro: toda semana tem um pouco de cada uma.'
                : 'Uma grande área inteira, depois a próxima, na ordem da lista acima.'}
            </p>
          </div>
        </div>
      </Card>

      <Card title="3. Seus dias de estudo" subtitle="Os assuntos de cada semana são distribuídos por estes dias; as horas por dia viram o tempo sugerido de cada assunto.">
        <StudyDaysFields weekdays={schedule.weekdays} minutes={schedule.minutes} onChange={setSchedule} />
      </Card>

      <Card title={planId ? '4. Confira e acrescente' : '4. Confira e crie'}>
        {!count ? (
          <p className="text-sm text-muted">Escolha os assuntos no passo 1 para ver como fica.</p>
        ) : previewError ? (
          <ErrorState error={previewError} />
        ) : !preview ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="h-4 w-4" /> Montando as semanas…
          </div>
        ) : (
          <div className={cx('space-y-4 transition-opacity', loading && 'opacity-60')}>
            <div className="text-sm text-ink">
              <p>
                <strong>{plural(preview.items, 'assunto', 'assuntos')}</strong> em {plural(preview.weeks.length, 'semana', 'semanas')}, de {fmtFull(preview.firstWeek)} a{' '}
                {fmtFull(addDaysStr(preview.lastWeek, 6))}.
              </p>
              <p className="mt-1 text-ink2">
                {preview.newSubjects > 0 && `${plural(preview.newSubjects, 'assunto novo será criado', 'assuntos novos serão criados')}. `}
                {preview.skipped > 0 && `${plural(preview.skipped, 'assunto repetido ficou de fora', 'assuntos repetidos ficaram de fora')}.`}
              </p>
            </div>
            <DistributionPreview distribution={preview.distribution} />
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {preview.weeks.map((w) => (
                <section key={w.weekStart} className="rounded-xl border border-line p-3">
                  <p className="text-sm font-medium text-ink">
                    {w.label}
                    <span className="num font-normal text-ink2">
                      {' '}
                      · {fmtShort(w.weekStart)} a {fmtShort(addDaysStr(w.weekStart, 6))} · {plural(w.subjects.length, 'assunto', 'assuntos')}
                    </span>
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {w.subjects.map((s) => (
                      <li key={`${s.area}|${s.name}`} className="chip py-1 text-xs text-ink">
                        <AreaDot color={s.area ? colorOf.get(s.area) : null} /> {s.name}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {!planId && <Input label="Nome do cronograma" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className="sm:w-80" />}
              <Button loading={busy} disabled={loading || !valid} icon={<CalendarPlus className="h-4 w-4" />} onClick={create}>
                {planId ? 'Acrescentar ao cronograma' : 'Criar cronograma'}
              </Button>
              <Link to={planId ? `/cronograma?plano=${planId}` : '/cronograma'} className="pb-2 text-sm text-ink2 hover:underline">
                Cancelar
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
