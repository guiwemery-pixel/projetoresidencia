import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ClipboardPaste, FileText, Lock, Plus, Upload } from 'lucide-react';
import { api } from '../api/client';
import type { AreaNode } from '../api/types';
import { useAuth } from '../hooks/useAuth';
import { useAreas } from '../hooks/api';
import { fmtShort, plural, todayLocal } from '../lib/format';
import type { PlanLine } from '../lib/plan/pdf-lines';
import { BIG_AREAS, addDays, parsePlan, schedulePlan, suggestedStart, textToLines, type DraftItem, type PlanDraft } from '../lib/plan/parse';
import { Button, Card, Input, PageHeader, Textarea, cx, useToast } from '../components/ui';
import { DEFAULT_DAYS, DEFAULT_MINUTES, StudyDaysFields, weekdaysText } from '../components/study/StudyDays';
import { DistributionPreview, type PlanDistribution } from '../components/study/DistributionPreview';
import { normalize } from '../components/study/SubjectPicker';

// Importar cronograma: o PDF (ou o texto colado) é lido no navegador; só a
// lista de assuntos com a semana de cada um vai para a conta da pessoa.

interface Preview {
  /** Como fica com os dias e horas escolhidos */
  distribution: PlanDistribution;
  items: number;
  weeks: number;
  firstWeek: string;
  lastWeek: string;
  newSubjects: number;
  existingSubjects: number;
  newAreas: string[];
  sameName: boolean;
}

const FALLBACK_AREA = 'Importados';
// Destino de um assunto no seletor: uma área/subárea da conta (`id:<id>`), uma grande área a
// criar (`new:<nome>`) ou "Importados" (procura o assunto pelo nome; senão, área Importados)
const AUTO = 'auto';
const isId = (v: string) => v.startsWith('id:');
const isNew = (v: string) => v.startsWith('new:');

/** Seletor de destino: as áreas e subáreas da pessoa (inclusive as que ela criou), áreas novas e "Importados". */
function AreaSelect({
  tree,
  newNames,
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: {
  tree: AreaNode[];
  newNames: string[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  return (
    <select className={cx('input', className)} value={value} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label={ariaLabel}>
      {placeholder && <option value="">{placeholder}</option>}
      {tree.map((a) => (
        <optgroup key={a.id} label={a.name}>
          <option value={`id:${a.id}`}>{a.name} (geral)</option>
          {[...(a.children ?? [])]
            .sort((x, y) => x.position - y.position)
            .map((c) => (
              <option key={c.id} value={`id:${c.id}`}>
                {a.name} › {c.name}
              </option>
            ))}
        </optgroup>
      ))}
      {newNames.length > 0 && (
        <optgroup label="Criar área nova">
          {newNames.map((n) => (
            <option key={n} value={`new:${n}`}>
              {n} (nova)
            </option>
          ))}
        </optgroup>
      )}
      <option value={AUTO}>{FALLBACK_AREA} (ou onde o assunto já existir)</option>
    </select>
  );
}
const fmtFull = (d: string) => d.split('-').reverse().join('/');

/** "CRONOGRAMA_EXTENSIVO_2025_ACESSO_DIRETO_1_202506_260927.pdf" → "Cronograma extensivo 2025 acesso direto 1" */
function nameFromFile(file: string) {
  const base = file
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^[0-9a-f]{8}[-_]/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/(\s\d{6,})+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = base.toLowerCase();
  return (lower.charAt(0).toUpperCase() + lower.slice(1)).slice(0, 120) || 'Cronograma';
}

export default function PlanImportPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = todayLocal();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [name, setName] = useState('');
  const [useFileDates, setUseFileDates] = useState(false);
  const [start, setStart] = useState(today);
  // Áreas da conta (as padrão e as que a pessoa criou) para escolher o destino de cada assunto
  const areas = useAreas();
  const tree = useMemo(() => [...(areas.data ?? [])].sort((a, b) => a.position - b.position), [areas.data]);
  // Valores: um destino do seletor (id:/new:/auto) ou, vindo do arquivo, o nome de uma grande área
  const [colorArea, setColorArea] = useState<Record<string, string>>({});
  // Sem cor nem palavra-chave de Pediatria/GO/Cirurgia/Preventiva: quase sempre é Clínica Médica
  const [defaultArea, setDefaultArea] = useState<string>(BIG_AREAS[0]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [customAreas, setCustomAreas] = useState<string[]>([]);
  const [newAreaName, setNewAreaName] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [bonus, setBonus] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  // Dias de estudo e horas por dia (ficam salvos para a pessoa ao criar)
  const { user } = useAuth();
  const [schedule, setSchedule] = useState({
    weekdays: user?.studyWeekdays?.length ? user.studyWeekdays : DEFAULT_DAYS,
    minutes: user?.dailyStudyMinutes ?? DEFAULT_MINUTES,
  });

  function load(lines: PlanLine[], title: string) {
    const d = parsePlan(lines, today);
    if (!d.weeks.length) throw new Error('Não encontrei semanas no arquivo. O cronograma precisa ter linhas como "Módulo 01 – 13/01/2025" ou "Semana 1", seguidas dos assuntos.');
    setDraft(d);
    setName(title);
    setUseFileDates(!!d.firstDate && suggestedStart(d, today) === d.firstDate);
    setStart(suggestedStart(d, today));
    setColorArea(Object.fromEntries(d.colors.map((c) => [c, d.legend[c] ?? ''])));
    setOverrides({});
    setExcluded(new Set());
    setPreview(null);
  }

  async function readFile(file: File) {
    setReading(true);
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Escolha um arquivo .pdf (ou cole o texto do cronograma).');
      const { readPdf } = await import('../lib/plan/pdf');
      load(await readPdf(file), nameFromFile(file.name));
      setFileName(file.name);
      setPasting(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setReading(false);
    }
  }

  function readText() {
    try {
      load(textToLines(pasted), 'Meu cronograma');
      setFileName(null);
    } catch (err) {
      toast.error(err);
    }
  }

  const keyOf = useMemo(() => {
    const map = new Map<DraftItem, string>();
    draft?.weeks.forEach((w, wi) => w.items.forEach((it, ii) => map.set(it, `${wi}:${ii}`)));
    return map;
  }, [draft]);

  /** Nome de grande área (legenda, palavra-chave, padrão) → destino: a área da conta com esse nome, ou criar. */
  const toValue = useCallback(
    (v: string | null | undefined) => {
      if (!v) return '';
      if (v === AUTO || isId(v) || isNew(v)) return v;
      if (v === FALLBACK_AREA) return AUTO;
      const top = tree.find((a) => normalize(a.name) === normalize(v));
      return top ? `id:${top.id}` : `new:${v}`;
    },
    [tree],
  );
  const areaOf = (item: DraftItem) => {
    const key = keyOf.get(item)!;
    return toValue(overrides[key] || (item.marker && colorArea[item.marker]) || item.area || defaultArea);
  };
  /** Rótulo de um destino ("Oftalmologia", "Clínica Médica › Cardiologia", "Neurologia (nova)"). */
  const labelOf = (v: string) => {
    if (v === AUTO) return FALLBACK_AREA;
    if (isNew(v)) return `${v.slice(4)} (nova)`;
    const id = v.slice(3);
    for (const a of tree) {
      if (a.id === id) return a.name;
      const c = a.children?.find((x) => x.id === id);
      if (c) return `${a.name} › ${c.name}`;
    }
    return '—';
  };
  /** Mandar vários assuntos (todos, ou uma semana) para um destino. */
  const sendTo = (keys: string[], v: string) => {
    setOverrides((cur) => ({ ...cur, ...Object.fromEntries(keys.map((k) => [k, v])) }));
    touch();
  };

  const chosen = useMemo(() => {
    if (!draft) return null;
    return { ...draft, weeks: draft.weeks.map((w) => ({ ...w, items: w.items.filter((it) => !excluded.has(keyOf.get(it)!) && (bonus || !it.bonus)) })) };
  }, [draft, excluded, bonus, keyOf]);

  const startDate = draft && useFileDates && draft.firstDate ? draft.firstDate : start;
  const planned = useMemo(
    () => (chosen ? schedulePlan(chosen, startDate, areaOf) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen, startDate, colorArea, overrides, defaultArea, toValue],
  );
  const lastWeek = planned.length ? planned[planned.length - 1].weekStart : null;
  // Grandes áreas que ainda não existem na conta e podem ser criadas (padrão, legenda do arquivo, digitadas)
  const newNames = useMemo(() => {
    const names = [...BIG_AREAS, ...Object.values(draft?.legend ?? {}), ...customAreas].filter(Boolean);
    const out: string[] = [];
    for (const n of names) if (!tree.some((a) => normalize(a.name) === normalize(n)) && !out.some((o) => normalize(o) === normalize(n))) out.push(n);
    return out;
  }, [draft, customAreas, tree]);
  // Quantos assuntos vão para cada destino (para conferir antes de criar)
  const destinations = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of planned) count.set(p.area ?? AUTO, (count.get(p.area ?? AUTO) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [planned]);
  const allKeys = useMemo(() => [...keyOf.values()], [keyOf]);
  const bonusCount = draft?.weeks.reduce((n, w) => n + w.items.filter((i) => i.bonus).length, 0) ?? 0;
  const noArea = draft?.weeks.reduce((n, w) => n + w.items.filter((i) => !i.marker && !i.area).length, 0) ?? 0;
  const touch = () => setPreview(null);

  const payload = () => ({
    name: name.trim() || 'Cronograma',
    source: fileName,
    items: planned.map((p) => {
      const v = p.area ?? AUTO;
      const where = isId(v) ? { areaId: v.slice(3), area: null } : isNew(v) ? { area: v.slice(4) } : { area: null };
      return { subject: p.subject, ...where, weekStart: p.weekStart, label: p.label, bonus: p.bonus };
    }),
    schedule: { weekdays: schedule.weekdays, dailyMinutes: schedule.minutes },
  });

  async function check() {
    setBusy(true);
    try {
      setPreview(await api.post<Preview>('/plans/preview', payload()));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const res = await api.post<{ id: string }>('/plans', payload());
      await qc.invalidateQueries();
      toast.success(`Cronograma criado! Os assuntos de cada semana estão distribuídos de ${weekdaysText(schedule.weekdays)}.`);
      navigate(`/cronograma?plano=${res.id}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Importar cronograma" subtitle="Traga o cronograma do seu cursinho e os assuntos de cada semana entram no seu calendário." />

      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          O arquivo é lido <strong className="text-ink">no seu navegador</strong>. Só a lista de assuntos, com a semana de cada um, vai para a sua conta. Quando você estuda um
          assunto, ele sai do cronograma e as revisões são agendadas; se a semana passar sem estudo, ele aparece como <strong className="text-ink">atrasado</strong>.
        </p>
      </div>

      <Card title="1. Escolha o cronograma">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void readFile(f);
          }}
          className={cx('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition', dragging ? 'border-accent bg-accent-wash' : 'border-line')}
        >
          <FileText className="h-8 w-8 text-accent" aria-hidden />
          <p className="max-w-full text-sm text-ink [overflow-wrap:anywhere]">{fileName ? <strong>{fileName}</strong> : 'Arraste o PDF do cronograma para cá ou escolha no computador/celular.'}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
              e.target.value = '';
            }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" loading={reading} icon={<Upload className="h-4 w-4" />} onClick={() => inputRef.current?.click()}>
              {fileName ? 'Escolher outro' : 'Escolher PDF'}
            </Button>
            <Button variant="ghost" icon={<ClipboardPaste className="h-4 w-4" />} onClick={() => setPasting((v) => !v)}>
              Colar o texto
            </Button>
          </div>
          <p className="text-xs text-muted">Funciona com cronogramas em que cada semana começa com “Módulo 01 – 13/01/2025”, “Semana 1”… e os assuntos vêm embaixo.</p>
        </div>
        {pasting && (
          <div className="mt-4 space-y-2">
            <Textarea
              label="Texto do cronograma"
              rows={8}
              placeholder={'MÓDULO 01 – 13/01/2025\nHipertensão arterial sistêmica\nHérnias e obstrução intestinal\nMÓDULO 02 – 20/01/2025\nInsuficiência cardíaca'}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <Button variant="secondary" disabled={!pasted.trim()} onClick={readText}>
              Ler texto
            </Button>
          </div>
        )}
      </Card>

      {draft && chosen && (
        <Card title="2. Confira" subtitle={`${plural(draft.weeks.length, 'semana', 'semanas')} com ${plural(planned.length, 'assunto', 'assuntos')}.`}>
          <div className="grid gap-4 lg:grid-cols-2">
            <Input
              label="Nome do cronograma"
              value={name}
              maxLength={120}
              onChange={(e) => {
                setName(e.target.value);
                touch();
              }}
            />
            <div>
              <span className="label">Quando começa</span>
              <div className="space-y-2">
                {draft.firstDate && (
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="radio" name="start" checked={useFileDates} onChange={() => (setUseFileDates(true), touch())} className="h-4 w-4 accent-[var(--accent)]" />
                    Datas do arquivo (a partir de {fmtFull(draft.firstDate)})
                  </label>
                )}
                <label className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  <input type="radio" name="start" checked={!useFileDates || !draft.firstDate} onChange={() => (setUseFileDates(false), touch())} className="h-4 w-4 accent-[var(--accent)]" />
                  {draft.weeks[0].label} começa em
                  <input
                    type="date"
                    className="input w-auto py-1"
                    value={start}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setStart(e.target.value);
                      setUseFileDates(false);
                      touch();
                    }}
                    aria-label="Data de início"
                  />
                </label>
                {lastWeek && (
                  <p className="flex items-center gap-1.5 text-xs text-ink2">
                    <CalendarRange className="h-3.5 w-3.5" /> De {fmtFull(startDate)} a {fmtFull(addDays(lastWeek, 6))}. As semanas seguem o espaçamento do arquivo.
                  </p>
                )}
                {draft.firstDate && draft.firstDate < addDays(today, -7) && useFileDates && (
                  <p className="text-xs text-ink2">⚠️ As datas do arquivo já passaram: os assuntos entram como atrasados.</p>
                )}
              </div>
            </div>
          </div>

          <section className="mt-5 rounded-2xl border border-line p-3">
            <h3 className="text-sm font-semibold text-ink">Para onde vão os assuntos</h3>
            <p className="mb-3 mt-0.5 text-xs text-ink2">
              Escolha a grande área ou a subárea de cada assunto — inclusive as que você criou em Áreas e assuntos. Dá para mandar todos de uma vez, uma semana inteira ou
              assunto por assunto (na lista de semanas abaixo).
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="label">Mandar todos os assuntos para</span>
                <AreaSelect tree={tree} newNames={newNames} value="" placeholder="Escolha a área…" onChange={(v) => (sendTo(allKeys, v), setDefaultArea(v))} ariaLabel="Mandar todos os assuntos para" />
              </label>
              <label className="block">
                <span className="label">{noArea > 0 ? plural(noArea, 'assunto sem área definida vai', 'assuntos sem área definida vão') : 'Assuntos sem área definida vão'} para</span>
                <AreaSelect tree={tree} newNames={newNames} value={toValue(defaultArea)} onChange={(v) => (setDefaultArea(v), touch())} ariaLabel="Área dos assuntos sem área definida" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Input
                label="Área que ainda não existe"
                placeholder="Ex.: Oftalmologia"
                value={newAreaName}
                maxLength={120}
                onChange={(e) => setNewAreaName(e.target.value)}
                className="sm:w-64"
              />
              <Button
                variant="secondary"
                icon={<Plus className="h-4 w-4" />}
                disabled={!newAreaName.trim()}
                onClick={() => {
                  const n = newAreaName.trim();
                  setCustomAreas((cur) => (cur.includes(n) ? cur : [...cur, n]));
                  setNewAreaName('');
                }}
              >
                Pôr na lista
              </Button>
            </div>

            {draft.colors.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-1 text-sm font-medium text-ink">Pela cor do arquivo</h4>
                <p className="mb-2 text-xs text-ink2">
                  {Object.keys(draft.legend).length ? 'Li a legenda de cores do arquivo. Ajuste se algo não bater.' : 'Diga a que área corresponde cada cor.'}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {draft.colors.map((c) => {
                    const count = draft.weeks.reduce((n, w) => n + w.items.filter((i) => i.marker === c).length, 0);
                    return (
                      <label key={c} className="flex items-center gap-2 text-sm">
                        <span className="h-4 w-4 shrink-0 rounded" style={{ background: c }} aria-hidden />
                        <AreaSelect
                          tree={tree}
                          newNames={newNames}
                          value={toValue(colorArea[c])}
                          placeholder="Escolha a área…"
                          onChange={(v) => {
                            setColorArea({ ...colorArea, [c]: v });
                            touch();
                          }}
                          className="min-w-0 flex-1 py-1.5"
                          ariaLabel={`Área da cor ${c}`}
                        />
                        <span className="num w-8 shrink-0 text-right text-xs text-muted">{count}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {destinations.length > 0 && (
              <p className="mt-3 text-xs text-ink2">
                <span className="font-medium text-ink">Vão para:</span> {destinations.map(([v, n]) => `${labelOf(v)} (${n})`).join(' · ')}
              </p>
            )}
          </section>

          <div className="mt-4 flex flex-wrap items-end gap-4">
            {bonusCount > 0 && (
              <label className="flex items-center gap-2 pb-2 text-sm text-ink">
                <input type="checkbox" checked={bonus} onChange={(e) => (setBonus(e.target.checked), touch())} className="h-4 w-4 accent-[var(--accent)]" />
                Incluir as {plural(bonusCount, 'aula bônus', 'aulas bônus')} (cada uma na semana da sua data)
              </label>
            )}
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Semanas</h3>
          <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
            {draft.weeks.map((w, wi) => {
              const weekPlanned = planned.find((p) => p.label === w.label && !p.bonus)?.weekStart;
              return (
                <section key={wi} className="rounded-2xl border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink">
                      {w.label}
                      {weekPlanned && <span className="num font-normal text-ink2"> · {`${fmtShort(weekPlanned)} a ${fmtShort(addDays(weekPlanned, 6))}`}</span>}
                      {w.date && !useFileDates && <span className="num text-xs font-normal text-muted"> (no arquivo: {fmtFull(w.date)})</span>}
                    </p>
                    <AreaSelect
                      tree={tree}
                      newNames={newNames}
                      value=""
                      placeholder="Mandar a semana para…"
                      onChange={(v) => sendTo(w.items.map((_, ii) => `${wi}:${ii}`), v)}
                      className="w-44 py-1 text-xs sm:w-56"
                      ariaLabel={`Mandar todos de ${w.label} para`}
                    />
                  </div>
                  <ul className="space-y-1">
                    {w.items.map((it, ii) => {
                      const key = `${wi}:${ii}`;
                      const off = excluded.has(key) || (!bonus && it.bonus);
                      return (
                        <li key={key} className={cx('flex items-center gap-2 text-sm', off && 'opacity-50')}>
                          <input
                            type="checkbox"
                            checked={!excluded.has(key)}
                            disabled={!bonus && it.bonus}
                            onChange={(e) => {
                              const next = new Set(excluded);
                              if (e.target.checked) next.delete(key);
                              else next.add(key);
                              setExcluded(next);
                              touch();
                            }}
                            className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                            aria-label={`Incluir ${it.subject}`}
                          />
                          {it.marker && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: it.marker }} aria-hidden />}
                          <span className="min-w-0 flex-1 truncate text-ink" title={it.original}>
                            {it.subject}
                            {it.bonus && <span className="text-xs text-muted"> · bônus{it.date ? ` ${fmtShort(it.date)}` : ''}</span>}
                          </span>
                          <AreaSelect
                            tree={tree}
                            newNames={newNames}
                            value={areaOf(it)}
                            onChange={(v) => {
                              setOverrides({ ...overrides, [key]: v });
                              touch();
                            }}
                            className="w-36 shrink-0 py-1 text-xs sm:w-56"
                            ariaLabel={`Área de ${it.subject}`}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </Card>
      )}

      {draft && planned.length > 0 && (
        <Card
          title="3. Seus dias de estudo"
          subtitle="Os assuntos de cada semana são distribuídos por estes dias, na ordem do cronograma e de forma regular. As horas por dia viram o tempo sugerido para cada assunto."
        >
          <StudyDaysFields
            weekdays={schedule.weekdays}
            minutes={schedule.minutes}
            onChange={(v) => {
              setSchedule(v);
              touch();
            }}
          />
        </Card>
      )}

      {draft && planned.length > 0 && (
        <Card title="4. Criar o cronograma">
          {!preview ? (
            <Button loading={busy} disabled={!schedule.weekdays.length} onClick={check}>
              Conferir com a minha conta
            </Button>
          ) : (
            <div className="rounded-2xl bg-subtle p-4 text-sm text-ink">
              <p>
                <strong>{plural(preview.items, 'assunto', 'assuntos')}</strong> em {plural(preview.weeks, 'semana', 'semanas')}, de {fmtFull(preview.firstWeek)} a{' '}
                {fmtFull(addDays(preview.lastWeek, 6))}.
              </p>
              <p className="mt-1 text-ink2">
                {preview.existingSubjects > 0 && `${plural(preview.existingSubjects, 'assunto já existe', 'assuntos já existem')} na sua conta e será usado. `}
                {preview.newSubjects > 0 && `${plural(preview.newSubjects, 'assunto novo será criado', 'assuntos novos serão criados')} nas áreas indicadas.`}
              </p>
              {preview.newAreas.length > 0 && <p className="mt-1 text-ink2">Áreas que serão criadas: {preview.newAreas.join(', ')}.</p>}
              {preview.sameName && <p className="mt-1 text-ink2">Você já tem um cronograma com esse nome; este será um segundo.</p>}
              <DistributionPreview distribution={preview.distribution} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button loading={busy} onClick={create} icon={<CalendarRange className="h-4 w-4" />}>
                  Criar cronograma
                </Button>
                <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                  Voltar
                </Button>
                <Link to="/cronograma" className="text-sm text-ink2 hover:underline">
                  Cancelar
                </Link>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
