import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Lock, Plus, Trash2, Upload } from 'lucide-react';
import { api } from '../api/client';
import { METHOD_LABEL } from '../lib/constants';
import { fmtShort, plural, todayLocal } from '../lib/format';
import { parseCsv } from '../lib/import/csv';
import { findResults, type ResultItem } from '../lib/import/results';
import {
  GROUP_FIELDS,
  batches,
  buildEvents,
  columnTitles,
  detectHeaderRow,
  guessMapping,
  pickSheet,
  type GroupField,
  type GroupMap,
  type Grid,
  type ImportEvent,
  type Mapping,
} from '../lib/import/sheet';
import { Button, Card, PageHeader, ProgressBar, Segmented, cx, useToast } from '../components/ui';

// Importar planilha: o arquivo é lido NO NAVEGADOR; só os estudos convertidos
// (data, assunto, questões, acertos, tempo, tipo) e as notas de simulados e
// provas vão para a conta da pessoa.

interface SheetData {
  name: string;
  grid: Grid;
}

interface Preview {
  studies: number;
  duplicates: number;
  questions: number;
  subjects: number;
  newSubjects: number;
  newAreas: string[];
  firstDate: string | null;
  lastDate: string | null;
  mocks: number;
  mockDuplicates: number;
  exams: number;
  examDuplicates: number;
  newBoards: string[];
}

interface RunResult {
  created: number;
  duplicates: number;
  subjects: number;
  mocks: number;
  exams: number;
}

type FoundResult = ResultItem & { include: boolean };

/** Simulados e provas marcados, no formato da API (sem data na planilha → a data escolhida). */
function resultPayload(results: FoundResult[], date: string) {
  const chosen = results.filter((r) => r.include);
  const base = (r: FoundResult) => ({ date: r.date ?? date, accuracy: r.accuracy, total: r.total, correct: r.correct });
  return {
    mocks: chosen.filter((r) => r.kind === 'mock').map((r) => ({ ...base(r), name: r.name.slice(0, 120), board: r.board?.slice(0, 80) ?? null, year: r.year })),
    exams: chosen
      .filter((r): r is FoundResult & { year: number; board: string } => r.kind === 'exam' && r.year !== null && !!r.board)
      .map((r) => ({ ...base(r), board: r.board.slice(0, 80), year: r.year })),
  };
}

const FIELD_LABEL: Record<GroupField, string> = {
  date: 'Data',
  total: 'Questões',
  correct: 'Acertos',
  wrong: 'Erros',
  percent: '% de acertos',
  minutes: 'Tempo',
  method: 'Tipo de estudo',
};

const TEMPLATE =
  'Data;Grande área;Subárea;Assunto;Questões;Acertos;Tempo (min);Tipo;Observações\n' +
  '01/09/2026;Clínica Médica;Cardiologia;Insuficiência cardíaca;20;16;60;Teoria + questões;\n' +
  '11/09/2026;Clínica Médica;Cardiologia;Insuficiência cardíaca;25;22;40;Questões;1ª revisão\n' +
  '12/09/2026;Pediatria;Neonatologia;Icterícia neonatal;;;45;Flashcards;\n';

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

async function readFile(file: File): Promise<SheetData[]> {
  if (/\.csv$/i.test(file.name) || file.type === 'text/csv') return [{ name: file.name, grid: parseCsv(await file.text()) }];
  if (/\.xls$/i.test(file.name)) throw new Error('Arquivos .xls (Excel antigo) não são lidos. Abra no Excel e use "Salvar como" → .xlsx.');
  const { default: readXlsxFile } = await import('read-excel-file/universal');
  try {
    const sheets = await readXlsxFile(file);
    return sheets.map((s) => ({ name: s.sheet, grid: s.data as unknown as Grid }));
  } catch {
    throw new Error('Não consegui abrir a planilha. Se ela tiver senha, remova (Arquivo → Informações → Proteger pasta de trabalho) e tente de novo.');
  }
}

function ColumnSelect({ value, onChange, columns, label }: { value: number | null; onChange: (v: number | null) => void; columns: string[]; label: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">—</option>
        {columns.map((c, i) => (
          <option key={i} value={i}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function ResultRow({ r, onToggle }: { r: FoundResult; onToggle: (include: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-subtle">
      <input type="checkbox" checked={r.include} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0 flex-1 truncate text-ink" title={r.name}>
        {r.name}
      </span>
      <span className="num shrink-0 font-medium text-ink">{Math.round(r.accuracy)}%</span>
    </label>
  );
}

/** Notas de simulados e provas antigas encontradas em outras abas. */
function ResultsCard({
  results,
  onChange,
  date,
  onDate,
  today,
}: {
  results: FoundResult[];
  onChange: (next: FoundResult[]) => void;
  date: string;
  onDate: (d: string) => void;
  today: string;
}) {
  const set = (match: (r: FoundResult) => boolean, include: boolean) => onChange(results.map((r) => (match(r) ? { ...r, include } : r)));
  const examples = results.filter((r) => r.placeholder);
  const undated = results.some((r) => r.include && !r.date);
  const sections = [
    { kind: 'mock' as const, title: 'Simulados', hint: 'Entram em Simulados, com a nota.' },
    { kind: 'exam' as const, title: 'Provas antigas', hint: 'Entram no banco de provas: a instituição vira banca, e cada ano, uma prova com o seu resultado.' },
  ];
  return (
    <Card title="3. Simulados e provas" subtitle="Notas encontradas nas outras abas da planilha. Desmarque o que não quiser trazer.">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {sections.map(({ kind, title, hint }) => {
          const items = results.filter((r) => r.kind === kind && !r.placeholder);
          if (!items.length) return null;
          const all = items.every((r) => r.include);
          return (
            <section key={kind}>
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">
                  {title} <span className="num font-normal text-muted">({items.filter((r) => r.include).length}/{items.length})</span>
                </h3>
                <button type="button" className="text-xs font-medium text-accent" onClick={() => set((r) => r.kind === kind && !r.placeholder, !all)}>
                  {all ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              </div>
              <p className="mb-2 text-xs text-ink2">{hint}</p>
              <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
                {items.map((r) => (
                  <ResultRow key={`${r.sheet}:${r.row}:${r.name}`} r={r} onToggle={(include) => set((x) => x === r, include)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {examples.length > 0 && (
        <label className="mt-3 flex items-start gap-2 text-sm text-ink2">
          <input
            type="checkbox"
            checked={examples.every((r) => r.include)}
            onChange={(e) => set((r) => r.placeholder, e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          />
          <span>
            Trazer também {plural(examples.length, 'nota', 'notas')} de nomes genéricos ({[...new Set(examples.map((r) => r.board))].slice(0, 2).join(', ')}…), que parecem exemplo da
            planilha.
          </span>
        </label>
      )}
      {undated && (
        <label className="mt-4 block max-w-xs">
          <span className="label">A planilha não diz quando você fez. Usar a data</span>
          <input type="date" className="input" max={today} value={date} onChange={(e) => e.target.value && onDate(e.target.value)} />
        </label>
      )}
    </Card>
  );
}

export default function ImportPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayLocal();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState<RunResult | null>(null);
  const [results, setResults] = useState<FoundResult[]>([]);
  const [resultsDate, setResultsDate] = useState(today);

  const grid = sheets[sheetIndex]?.grid ?? [];
  const built = useMemo(() => (mapping ? buildEvents(grid, mapping, today) : null), [grid, mapping, today]);
  const headerRow = mapping?.headerRow;
  const columns = useMemo(
    () => (headerRow === undefined ? [] : columnTitles(grid, headerRow).map((t, i) => `${colName(i)} · ${t || '(sem título)'}`)),
    [grid, headerRow],
  );
  const payloadResults = useMemo(() => resultPayload(results, resultsDate), [results, resultsDate]);
  const resultCount = payloadResults.mocks.length + payloadResults.exams.length;
  const events = built?.events ?? [];

  const update = (patch: Partial<Mapping>) => {
    setMapping((m) => (m ? { ...m, ...patch } : m));
    setPreview(null);
  };
  const updateGroup = (i: number, patch: Partial<GroupMap>) => update({ groups: mapping!.groups.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  async function load(file: File) {
    setReading(true);
    setPreview(null);
    setFinished(null);
    try {
      const data = (await readFile(file)).filter((s) => s.grid.length > 0);
      if (!data.length) throw new Error('A planilha está vazia.');
      const best = pickSheet(data, today);
      setSheets(data);
      setSheetIndex(best);
      setMapping(guessMapping(data[best].grid));
      setResults(findResults(data, today).map((r) => ({ ...r, include: !r.placeholder })));
      setFileName(file.name);
    } catch (err) {
      toast.error(err);
    } finally {
      setReading(false);
    }
  }

  function chooseSheet(i: number) {
    setSheetIndex(i);
    setMapping(guessMapping(sheets[i].grid));
    setPreview(null);
  }

  async function check() {
    if (!events.length && !resultCount) return;
    setChecking(true);
    try {
      setPreview(await api.post<Preview>('/import/preview', { events, ...payloadResults }));
    } catch (err) {
      toast.error(err);
    } finally {
      setChecking(false);
    }
  }

  async function run() {
    if (!events.length && !resultCount) return;
    // Poucos assuntos por vez: cada lote termina rápido mesmo com o banco longe
    const parts: { events: ImportEvent[]; mocks?: unknown[]; exams?: unknown[] }[] = batches(events).map((part) => ({ events: part }));
    if (resultCount) parts.push({ events: [], ...payloadResults });
    const total = events.length + resultCount;
    let done = 0;
    const sum: RunResult = { created: 0, duplicates: 0, subjects: 0, mocks: 0, exams: 0 };
    setProgress({ done, total });
    try {
      for (const part of parts) {
        const r = await api.post<RunResult>('/import/run', part);
        sum.created += r.created;
        sum.duplicates += r.duplicates;
        sum.subjects += r.subjects;
        sum.mocks += r.mocks;
        sum.exams += r.exams;
        done += part.events.length + (part.mocks?.length ?? 0) + (part.exams?.length ?? 0);
        setProgress({ done, total });
      }
      setFinished(sum);
      toast.success('Planilha importada!');
    } catch (err) {
      toast.error(
        done > 0
          ? new Error(`A importação parou no meio (${done} de ${total} registros já entraram). Tente de novo: o que já foi importado não se repete.`)
          : err,
      );
      if (done > 0) setPreview(null);
    } finally {
      setProgress(null);
      if (done > 0) await qc.invalidateQueries();
    }
  }

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-projeto-residente.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasDate = mapping?.groups.some((g) => g.include && g.date !== null);

  return (
    <div className="space-y-5">
      <PageHeader title="Importar planilha" subtitle="Traga seu histórico de estudos e revisões de uma planilha (.xlsx ou .csv)." />

      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-ink2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p>
          A planilha é lida <strong className="text-ink">no seu navegador</strong>. Só os estudos reconhecidos (data, assunto, questões, acertos, tempo e tipo) e as notas de simulados e provas vão
          para a <strong className="text-ink">sua</strong> conta, e as revisões são recalculadas pelo algoritmo do site. Importar de novo a mesma planilha não duplica nada.
        </p>
      </div>

      <Card title="1. Escolha a planilha" action={<Button variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={downloadTemplate}>Baixar modelo</Button>}>
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
            if (f) void load(f);
          }}
          className={cx('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition', dragging ? 'border-accent bg-accent-wash' : 'border-line')}
        >
          <FileSpreadsheet className="h-8 w-8 text-accent" aria-hidden />
          <p className="text-sm text-ink">{fileName ? <strong>{fileName}</strong> : 'Arraste o arquivo para cá ou escolha no computador/celular.'}</p>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" loading={reading} icon={<Upload className="h-4 w-4" />} onClick={() => inputRef.current?.click()}>
            {fileName ? 'Escolher outra' : 'Escolher arquivo'}
          </Button>
          <p className="text-xs text-muted">Excel (.xlsx) ou CSV. Planilha do Google: Arquivo → Fazer download → .xlsx. Se tiver senha, remova antes.</p>
        </div>
      </Card>

      {mapping && (
        <Card title="2. Confira as colunas" subtitle="Já tentei reconhecer tudo sozinho — ajuste se algo estiver errado.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {sheets.length > 1 && (
              <label className="block">
                <span className="label">Aba</span>
                <select className="input" value={sheetIndex} onChange={(e) => chooseSheet(Number(e.target.value))}>
                  {sheets.map((s, i) => (
                    <option key={i} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="label">Linha do cabeçalho</span>
              <select
                className="input"
                value={mapping.headerRow}
                onChange={(e) => {
                  setMapping(guessMapping(grid, Number(e.target.value)));
                  setPreview(null);
                }}
              >
                {grid.slice(0, 20).map((row, i) => (
                  <option key={i} value={i}>
                    Linha {i + 1}: {row.filter((c) => c !== null && c !== '').slice(0, 3).map(String).join(' · ').slice(0, 40) || '(vazia)'}
                    {i === detectHeaderRow(grid) ? ' (sugerida)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <ColumnSelect label="Grande área" value={mapping.area} onChange={(v) => update({ area: v })} columns={columns} />
            <ColumnSelect label="Subárea / especialidade" value={mapping.subarea} onChange={(v) => update({ subarea: v })} columns={columns} />
            <ColumnSelect label="Assunto (obrigatório)" value={mapping.subject} onChange={(v) => update({ subject: v })} columns={columns} />
            <ColumnSelect label="Observações" value={mapping.notes} onChange={(v) => update({ notes: v })} columns={columns} />
            <div>
              <span className="label">Tempo está em</span>
              <Segmented
                size="sm"
                ariaLabel="Unidade do tempo"
                value={mapping.minutesUnit}
                onChange={(v) => update({ minutesUnit: v })}
                options={[
                  { value: 'min', label: 'minutos' },
                  { value: 'h', label: 'horas' },
                ]}
              />
            </div>
            {built && built.percentOnly > 0 && (
              <label className="block">
                <span className="label">Registros só com o % de acertos</span>
                <select className="input" value={mapping.percentOnly} onChange={(e) => update({ percentOnly: e.target.value as Mapping['percentOnly'] })}>
                  <option value="quality">Autoavaliação</option>
                  <option value="estimate">Estimar nº de questões</option>
                </select>
              </label>
            )}
            {mapping.area !== null && (
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink2 sm:col-span-2">
                <input type="checkbox" checked={mapping.bigAreas} onChange={(e) => update({ bigAreas: e.target.checked })} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                Organizar nas grandes áreas (ex.: “NEFRO 2” → Clínica Médica › Nefrologia)
              </label>
            )}
          </div>

          <h3 className="mb-2 mt-5 text-sm font-semibold text-ink">Registros em cada linha</h3>
          <p className="mb-3 text-xs text-ink2">
            Cada registro vira um estudo com data. Planilhas com revisões lado a lado (D0, R1, R2…) têm vários registros por linha; datas previstas (ainda não feitas) ficam
            desmarcadas.
          </p>
          <div className="space-y-3">
            {mapping.groups.map((g, i) => (
              <div key={i} className={cx('rounded-2xl border p-3', g.include ? 'border-line' : 'border-dashed border-line opacity-60')}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input type="checkbox" checked={g.include} onChange={(e) => updateGroup(i, { include: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                    {g.label}
                  </label>
                  {mapping.groups.length > 1 && (
                    <button type="button" className="rounded-lg p-1 text-ink2 hover:bg-subtle" aria-label={`Remover ${g.label}`} onClick={() => update({ groups: mapping.groups.filter((_, j) => j !== i) })}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {GROUP_FIELDS.map((f) => (
                    <ColumnSelect key={f} label={FIELD_LABEL[f]} value={g[f]} onChange={(v) => updateGroup(i, { [f]: v })} columns={columns} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() =>
                update({
                  groups: [
                    ...mapping.groups,
                    { label: `Registro ${mapping.groups.length + 1}`, include: true, date: null, total: null, correct: null, wrong: null, percent: null, minutes: null, method: null },
                  ],
                })
              }
            >
              Adicionar registro
            </Button>
            {!hasDate && (
              <label className="block">
                <span className="label">Sem coluna de data: usar a data</span>
                <input type="date" className="input" max={today} value={mapping.fallbackDate ?? ''} onChange={(e) => update({ fallbackDate: e.target.value || null })} />
              </label>
            )}
          </div>
        </Card>
      )}

      {results.length > 0 && (
        <ResultsCard
          results={results}
          onChange={(next) => {
            setResults(next);
            setPreview(null);
          }}
          date={resultsDate}
          onDate={(d) => {
            setResultsDate(d);
            setPreview(null);
          }}
          today={today}
        />
      )}

      {built && mapping && (
        <Card
          title={`${results.length ? 4 : 3}. Prévia`}
          subtitle={
            built.events.length
              ? `${plural(built.events.length, 'estudo reconhecido', 'estudos reconhecidos')} em ${plural(new Set(built.events.map((e) => `${e.area}|${e.subarea}|${e.subject}`.toLowerCase())).size, 'assunto', 'assuntos')}.`
              : 'Nenhum estudo reconhecido ainda — confira as colunas acima (é preciso ao menos assunto e data).'
          }
        >
          {built.events.length > 0 && (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1.5 pl-4 font-medium sm:pl-0">Data</th>
                    <th className="py-1.5 font-medium">Assunto</th>
                    <th className="py-1.5 font-medium">Questões</th>
                    <th className="py-1.5 font-medium">Tempo</th>
                    <th className="py-1.5 font-medium">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {built.events.slice(0, 12).map((e: ImportEvent, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="num py-1.5 pl-4 text-ink sm:pl-0">{fmtShort(e.date)}</td>
                      <td className="py-1.5">
                        <span className="text-ink">{e.subject}</span>
                        <span className="block text-xs text-muted">{[e.area ?? 'Importados', e.subarea].filter(Boolean).join(' › ')}</span>
                      </td>
                      <td className="num py-1.5 text-ink">{e.total !== null ? `${e.correct}/${e.total}` : e.quality ? 'só %' : '—'}</td>
                      <td className="num py-1.5 text-ink2">{e.minutes ? `${e.minutes} min` : '—'}</td>
                      <td className="py-1.5 text-ink2">{e.methods.map((m) => METHOD_LABEL[m]).join(' + ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {built.events.length > 12 && <p className="mt-2 px-4 text-xs text-muted sm:px-0">… e mais {built.events.length - 12}.</p>}
            </div>
          )}
          {(built.skipped.length > 0 || built.future > 0 || built.percentOnly > 0) && (
            <ul className="mt-3 space-y-1 text-xs text-ink2">
              {built.future > 0 && <li>• {plural(built.future, 'registro com data futura foi ignorado', 'registros com data futura foram ignorados')} (revisões ainda não feitas).</li>}
              {built.percentOnly > 0 && (
                <li>
                  • {plural(built.percentOnly, 'registro tem', 'registros têm')} só o percentual, sem a quantidade de questões:{' '}
                  {mapping.percentOnly === 'estimate'
                    ? 'recebem uma quantidade estimada (a das outras revisões do mesmo assunto), anotada no estudo.'
                    : 'entram como questões com autoavaliação (o % fica anotado no estudo).'}
                </li>
              )}
              {built.skipped.slice(0, 6).map((s, i) => (
                <li key={i} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--warn)' }} aria-hidden /> Linha {s.row}: {s.reason}
                </li>
              ))}
              {built.skipped.length > 6 && <li>• … e mais {built.skipped.length - 6} linhas ignoradas.</li>}
            </ul>
          )}

          {(events.length > 0 || resultCount > 0) && !finished && (
            <div className="mt-4 space-y-3">
              {!preview ? (
                <Button loading={checking} onClick={check}>
                  Conferir com a minha conta
                </Button>
              ) : (
                <div className="rounded-2xl bg-subtle p-4 text-sm text-ink">
                  {events.length > 0 && (
                    <p>
                      <strong>{plural(preview.studies, 'estudo novo', 'estudos novos')}</strong> em {plural(preview.subjects, 'assunto', 'assuntos')} ({preview.newSubjects} novos)
                      {preview.questions > 0 && <>, com {preview.questions} questões</>}
                      {preview.firstDate && preview.lastDate && (
                        <>
                          {' '}
                          — de {fmtShort(preview.firstDate)} a {fmtShort(preview.lastDate)}
                        </>
                      )}
                      .
                    </p>
                  )}
                  {resultCount > 0 && (
                    <p className={cx(events.length > 0 && 'mt-1')}>
                      <strong>{plural(preview.mocks, 'simulado novo', 'simulados novos')}</strong> e{' '}
                      <strong>{plural(preview.exams, 'nota de prova antiga', 'notas de provas antigas')}</strong>
                      {preview.newBoards.length > 0 && <> (bancas novas: {preview.newBoards.join(', ')})</>}.
                    </p>
                  )}
                  {preview.duplicates + preview.mockDuplicates + preview.examDuplicates > 0 && (
                    <p className="mt-1 text-ink2">
                      Já estão na sua conta e serão ignorados:{' '}
                      {[
                        preview.duplicates && plural(preview.duplicates, 'estudo', 'estudos'),
                        preview.mockDuplicates && plural(preview.mockDuplicates, 'simulado', 'simulados'),
                        preview.examDuplicates && plural(preview.examDuplicates, 'nota de prova', 'notas de provas'),
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      .
                    </p>
                  )}
                  {preview.newAreas.length > 0 && <p className="mt-1 text-ink2">Áreas que serão criadas: {preview.newAreas.join(', ')}.</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button loading={!!progress} disabled={preview.studies + preview.mocks + preview.exams === 0} onClick={run} icon={<Upload className="h-4 w-4" />}>
                      Importar
                    </Button>
                    <Button variant="ghost" onClick={() => setPreview(null)} disabled={!!progress}>
                      Voltar
                    </Button>
                  </div>
                  {progress && (
                    <div className="mt-3">
                      <ProgressBar value={(progress.done / progress.total) * 100} label="Progresso da importação" />
                      <p className="num mt-1 text-xs text-ink2">
                        {progress.done} de {progress.total} registros…
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {finished && (
            <div className="mt-4 flex items-start gap-3 rounded-2xl p-4 text-sm" style={{ background: 'var(--good-wash)' }}>
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--good)' }} />
              <div>
                <p className="font-medium text-ink">
                  Pronto!{' '}
                  {[
                    (finished.created > 0 || finished.duplicates > 0 || !(finished.mocks || finished.exams)) &&
                      plural(finished.created, 'estudo importado', 'estudos importados') + (finished.duplicates > 0 ? ` (${finished.duplicates} já existiam)` : ''),
                    finished.mocks > 0 && plural(finished.mocks, 'simulado', 'simulados'),
                    finished.exams > 0 && plural(finished.exams, 'nota de prova antiga', 'notas de provas antigas'),
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  .{finished.created > 0 && ' As revisões foram recalculadas.'}
                </p>
                <p className="mt-1 flex flex-wrap gap-3">
                  <Link to="/revisoes" className="font-medium text-accent">
                    Ver revisões →
                  </Link>
                  <Link to="/assuntos" className="font-medium text-accent">
                    Áreas e assuntos →
                  </Link>
                  <Link to="/estudos" className="font-medium text-accent">
                    Estudos →
                  </Link>
                  {finished.mocks > 0 && (
                    <Link to="/simulados" className="font-medium text-accent">
                      Simulados →
                    </Link>
                  )}
                  {finished.exams > 0 && (
                    <Link to="/provas" className="font-medium text-accent">
                      Provas →
                    </Link>
                  )}
                </p>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
