import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { fmtRelative } from '../../lib/format';
import { Button, ConfirmDialog, ErrorState, Loading, Modal, Segmented, Select } from '../ui';

// Sincronizar com o Google Agenda: o site gera um link iCal secreto que o Google Agenda
// (ou Apple/Outlook) assina e relê sozinho. Ver backend/src/modules/calendar.

interface FeedOptions {
  plan: boolean;
  flashcards: boolean;
  time: string | null;
  duration: number;
  group: boolean;
}

type Feed =
  | { enabled: false; options: FeedOptions }
  | { enabled: true; url: string; webcalUrl: string; options: FeedOptions; createdAt: string; lastFetchedAt: string | null; lastClient: string | null };

const KEY = ['calendar-feed'] as const;

/** Página do Google Agenda que já abre "Adicionar agenda" com o link. */
const googleAddUrl = (webcalUrl: string) => `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;

export function GoogleCalendarDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: KEY, queryFn: () => api.get<Feed>('/me/calendar'), enabled: open, staleTime: 0 });
  // Ao abrir, relê (mostra a última leitura feita pelo Google Agenda)
  useEffect(() => {
    if (open) qc.invalidateQueries({ queryKey: KEY });
  }, [open, qc]);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<'regenerate' | 'disable' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (feed: Feed | null) => qc.setQueryData(KEY, feed ?? undefined);
  const enable = useMutation({
    mutationFn: (regenerate: boolean) => api.post<Feed>('/me/calendar', { regenerate }),
    onSuccess: (feed) => {
      set(feed);
      setConfirm(null);
    },
  });
  const save = useMutation({
    mutationFn: (patch: Partial<FeedOptions>) => api.patch<Feed>('/me/calendar', patch),
    onSuccess: (feed) => {
      set(feed);
      setSaveError(null);
    },
    onError: (err) => setSaveError(err instanceof Error ? err.message : String(err)),
  });
  const disable = useMutation({
    mutationFn: () => api.del('/me/calendar'),
    onSuccess: () => {
      setConfirm(null);
      qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão: o campo fica selecionado para copiar à mão */
    }
  };

  const opts = data?.options;
  const feed = data?.enabled ? data : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Sincronizar com o Google Agenda"
        footer={
          feed ? (
            <>
              <Button variant="ghost" icon={<RefreshCw className="h-4 w-4" />} onClick={() => setConfirm('regenerate')}>
                Gerar novo link
              </Button>
              <Button variant="secondary" onClick={() => setConfirm('disable')}>
                Desligar
              </Button>
              <Button onClick={onClose}>Concluir</Button>
            </>
          ) : undefined
        }
      >
        {isLoading && <Loading />}
        {error && <ErrorState error={error} />}
        {data && !feed && (
          <div className="space-y-4 text-sm text-ink2">
            <p>
              Suas revisões aparecem no <strong className="text-ink">Google Agenda</strong> — também no celular, pelo app do Google Agenda — e se atualizam sozinhas:
              revisão feita some, revisão nova aparece.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Revisões pendentes, cada uma no seu dia (as atrasadas aparecem hoje).</li>
              <li>Os assuntos do cronograma, semana a semana.</li>
              <li>Quantos flashcards há para revisar em cada dia.</li>
            </ul>
            <p className="text-xs text-muted">Também funciona com o Calendário da Apple e o Outlook.</p>
            {enable.error && <ErrorState error={enable.error} />}
            <Button icon={<CalendarPlus className="h-4 w-4" />} loading={enable.isPending} onClick={() => enable.mutate(false)}>
              Ligar sincronização
            </Button>
          </div>
        )}
        {feed && opts && (
          <div className="space-y-5 text-sm">
            <section className="space-y-2">
              <h3 className="font-semibold text-ink">1. Adicione ao Google Agenda</h3>
              <a
                href={googleAddUrl(feed.webcalUrl)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong"
              >
                <ExternalLink className="h-4 w-4" /> Abrir no Google Agenda
              </a>
              <p className="text-xs text-muted">
                Abre o Google Agenda já com a agenda para adicionar: confirme em <em>Adicionar</em>. Faça isso uma vez, no computador ou no navegador do celular (o
                app do Google Agenda não adiciona agendas por link). Depois ela aparece também no app.
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={feed.url}
                  aria-label="Link da agenda"
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-subtle px-3 py-2 text-xs text-ink2"
                />
                <Button variant="secondary" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={() => copy(feed.url)}>
                  {copied ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
              <details className="rounded-xl border border-line px-3 py-2 text-xs text-ink2">
                <summary className="cursor-pointer font-medium text-ink">Adicionar à mão (ou em outro calendário)</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5">
                  <li>
                    Abra <strong>calendar.google.com</strong> no computador.
                  </li>
                  <li>
                    Na coluna da esquerda, ao lado de <strong>Outras agendas</strong>, clique em <strong>+</strong> → <strong>Do URL</strong>.
                  </li>
                  <li>
                    Cole o link acima e clique em <strong>Adicionar agenda</strong>.
                  </li>
                  <li>No celular, se não aparecer: app do Google Agenda → Configurações → a agenda "Revisões · Projeto Residente" → Sincronizar.</li>
                </ol>
                <p className="mt-2">
                  iPhone/Mac:{' '}
                  <a href={feed.webcalUrl} className="font-medium text-accent underline">
                    abrir no Calendário da Apple
                  </a>
                  . Outlook: Adicionar calendário → Assinar da Web → cole o link.
                </p>
              </details>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold text-ink">2. O que entra na agenda</h3>
              <div className="space-y-1.5 text-ink2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked disabled /> Revisões pendentes
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={opts.plan} onChange={(e) => save.mutate({ plan: e.target.checked })} /> Cronograma (assuntos da semana)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={opts.flashcards} onChange={(e) => save.mutate({ flashcards: e.target.checked })} /> Flashcards para revisar no dia
                </label>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">Revisões</p>
                <Segmented
                  size="sm"
                  ariaLabel="Como mostrar as revisões"
                  value={opts.group ? 'group' : 'each'}
                  onChange={(v) => save.mutate({ group: v === 'group' })}
                  options={[
                    { value: 'each', label: 'Uma por assunto' },
                    { value: 'group', label: 'Todas num evento por dia' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted">Horário</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    size="sm"
                    ariaLabel="Horário dos eventos"
                    value={opts.time ? 'time' : 'allday'}
                    onChange={(v) => save.mutate({ time: v === 'time' ? opts.time ?? '19:00' : null })}
                    options={[
                      { value: 'allday', label: 'Dia inteiro' },
                      { value: 'time', label: 'Horário fixo' },
                    ]}
                  />
                  {opts.time && (
                    <>
                      <input
                        type="time"
                        aria-label="Hora"
                        defaultValue={opts.time}
                        key={opts.time}
                        onBlur={(e) => e.target.value && e.target.value !== opts.time && save.mutate({ time: e.target.value })}
                        className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm text-ink"
                      />
                      <Select aria-label="Duração" value={opts.duration} onChange={(e) => save.mutate({ duration: Number(e.target.value) })} className="!w-auto">
                        {[30, 60, 90, 120].map((m) => (
                          <option key={m} value={m}>
                            {m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : `${m / 60} h`}
                          </option>
                        ))}
                      </Select>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {opts.time ? 'Revisões e flashcards no horário escolhido (o cronograma fica como a semana inteira).' : 'Os eventos aparecem no topo do dia, sem ocupar horário.'} Os
                  lembretes (notificações) se ajustam no próprio Google Agenda, nas configurações dessa agenda.
                </p>
              </div>
              {saveError && <p className="text-xs text-crit-text">{saveError}</p>}
            </section>

            <section className="space-y-1 rounded-xl bg-subtle px-3 py-2.5 text-xs text-ink2">
              <p>
                {feed.lastFetchedAt
                  ? `Última leitura ${Date.now() - Date.parse(feed.lastFetchedAt) < 60_000 ? 'agora há pouco' : fmtRelative(feed.lastFetchedAt)}${feed.lastClient ? ` pelo ${feed.lastClient}` : ''}.`
                  : 'Ainda não foi lida por nenhuma agenda.'}{' '}
                O Google Agenda relê sozinho algumas vezes por dia: o que muda aqui pode levar algumas horas para aparecer lá.
              </p>
              <p>O link é secreto: quem tiver o link vê as suas revisões. Não compartilhe.</p>
            </section>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={confirm === 'regenerate'}
        title="Gerar novo link?"
        message="O link atual para de funcionar. Depois, adicione o novo link no Google Agenda (e remova a agenda antiga de lá)."
        confirmLabel="Gerar novo link"
        loading={enable.isPending}
        onConfirm={() => enable.mutate(true)}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'disable'}
        title="Desligar a sincronização?"
        message="O link deixa de funcionar e as revisões param de ser atualizadas no Google Agenda. Para tirar a agenda de lá, remova-a no próprio Google Agenda."
        confirmLabel="Desligar"
        danger
        loading={disable.isPending}
        onConfirm={() => disable.mutate()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
