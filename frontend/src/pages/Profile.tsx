import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ImagePlus, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useProgress } from '../hooks/api';
import { useAuth } from '../hooks/useAuth';
import { LEVELS } from '../lib/constants';
import { Avatar, Button, Card, Input, LevelBadge, Loading, Modal, NumberInput, PageHeader, ProgressBar, useToast } from '../components/ui';
import { ProgressOverview } from '../components/dashboard/shared';

/** Reduz a imagem para 128×128 (JPEG) no navegador antes de enviar. */
async function resizeImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DETAIL_LABEL: Record<string, string> = {
  diasEstudados14: 'Dias estudados (14 dias)',
  metaDias14: 'Meta de dias (14 dias)',
  horas7: 'Horas (7 dias)',
  metaHoras7: 'Meta de horas (semana)',
  acerto30: 'Acertos (30 dias, %)',
  questoes30: 'Questões (30 dias)',
  questoes14: 'Questões (14 dias)',
  esperado14: 'Questões esperadas (14 dias)',
  previstas30: 'Revisões previstas (30 dias)',
  concluidas: 'Concluídas',
  noPrazo: 'No prazo',
  atrasadas: 'Atrasadas hoje',
  pendentes: 'Pendentes',
  metasConsideradas: 'Metas consideradas',
  conclusaoMedia: 'Conclusão média (%)',
  simulados60: 'Simulados (60 dias)',
  evolucao: 'Evolução',
};

/** "< 60% → 3 dias · 60–65% → 10 dias · …" */
function firstReviewText(tiers: { min: number; days: number }[]) {
  const sorted = [...tiers].sort((a, b) => a.min - b.min);
  return sorted
    .map((t, i) => {
      const next = sorted[i + 1];
      const range = i === 0 ? `< ${next?.min ?? 100}%` : next ? `${t.min}–${next.min - 1}%` : `≥ ${t.min}%`;
      return `${range} → ${t.days} ${t.days === 1 ? 'dia' : 'dias'}`;
    })
    .join(' · ');
}

interface AlgorithmConfig {
  version: string;
  ladder: number[];
  ladderLabels: string[];
  phases: string[];
  maxIntervalDays: number;
  bands: { key: string; min: number; label: string; rule: string; factor: number }[];
  score: { accuracyWeight: number; qualityWeight: number; qualityScores: Record<string, number>; qualityLabels: Record<string, string> };
  firstReview: { minQuestions: number; tiers: { min: number; days: number; stage: number }[] };
}

export default function ProfilePage() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const progress = useProgress();
  const algorithm = useQuery({ queryKey: ['algorithm'], queryFn: () => api.get<AlgorithmConfig>('/reviews/algorithm'), staleTime: Infinity });
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState(() => ({
    name: user?.name ?? '',
    timezone: user?.timezone ?? 'America/Sao_Paulo',
    weeklyStudyHoursTarget: user?.weeklyStudyHoursTarget ?? 20,
    weeklyStudyDaysTarget: user?.weeklyStudyDaysTarget ?? 5,
    dailyQuestionsTarget: user?.dailyQuestionsTarget ?? 30,
  }));
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePw, setDeletePw] = useState('');

  useEffect(() => {
    if (window.location.hash === '#indicador') setTimeout(() => document.getElementById('indicador')?.scrollIntoView({ behavior: 'smooth' }), 300);
  }, [progress.data]);

  const patch = useMutation({
    mutationFn: (body: Partial<User>) => api.patch<{ user: User }>('/me', body),
    onSuccess: ({ user }) => {
      setUser(user);
      qc.invalidateQueries({ queryKey: ['progress'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success('Alterações salvas.');
    },
    onError: toast.error,
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/me/password', pw),
    onSuccess: () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Senha alterada. Outras sessões foram encerradas.');
    },
    onError: toast.error,
  });
  const del = useMutation({
    mutationFn: () => api.del('/me', undefined, { password: deletePw }),
    onSuccess: async () => {
      await logout().catch(() => undefined);
      navigate('/entrar');
    },
    onError: toast.error,
  });

  if (!user) return <Loading />;

  return (
    <div className="space-y-5">
      <PageHeader title="Perfil e configurações" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Perfil">
          <div className="mb-4 flex items-center gap-4">
            <Avatar name={user.name} src={user.avatar} size={64} />
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>
                Trocar foto
              </Button>
              {user.avatar && (
                <Button variant="ghost" size="sm" onClick={() => patch.mutate({ avatar: null })}>
                  Remover
                </Button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) patch.mutate({ avatar: await resizeImage(file) });
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="space-y-3">
            <Input label="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="E-mail" value={user.email} disabled />
            <Input label="Fuso horário" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} hint="Define o que é “hoje” para revisões e metas." />
          </div>
        </Card>

        <Card title="Meu ritmo" subtitle="Usado nas metas do dashboard e no cálculo do indicador de progresso.">
          <div className="space-y-3">
            <NumberInput label="Horas de estudo por semana" min={1} max={100} value={form.weeklyStudyHoursTarget} onChange={(v) => setForm({ ...form, weeklyStudyHoursTarget: v ?? 1 })} />
            <NumberInput label="Dias de estudo por semana" min={1} max={7} value={form.weeklyStudyDaysTarget} onChange={(v) => setForm({ ...form, weeklyStudyDaysTarget: v ?? 1 })} />
            <NumberInput label="Questões por dia de estudo" min={0} max={1000} value={form.dailyQuestionsTarget} onChange={(v) => setForm({ ...form, dailyQuestionsTarget: v ?? 0 })} />
          </div>
          <div className="mt-4 flex justify-end">
            <Button loading={patch.isPending} onClick={() => patch.mutate(form)}>
              Salvar
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Privacidade no grupo">
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-1" checked={user.shareProgress} onChange={(e) => patch.mutate({ shareProgress: e.target.checked })} />
          <span className="text-sm">
            <span className="font-medium text-ink">Compartilhar meu resumo de progresso com o grupo</span>
            <span className="block text-ink2">
              O grupo vê apenas: barra de progresso geral (arredondada), status 🟢🟡🟠🔴 de estudos, questões, revisões, metas e simulados, e o percentual aproximado de metas. Nunca: número de
              questões, % de acertos, horas, assuntos, datas ou quantidade de revisões.
            </span>
          </span>
        </label>
      </Card>

      <section id="indicador" className="scroll-mt-20">
        <Card title="Meu indicador de progresso — cálculo detalhado" subtitle="Só você vê esta explicação. O grupo recebe apenas o resultado resumido.">
          {progress.isLoading || !progress.data ? (
            <Loading />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
              <ProgressOverview progress={progress.data} />
              <div className="space-y-4">
                <p className="rounded-xl bg-subtle p-3 text-sm text-ink">{progress.data.formula}</p>
                {progress.data.components.map((c) => (
                  <div key={c.key} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink">
                        {c.label} <span className="text-xs font-normal text-muted">peso {Math.round(c.weight * 100)}%</span>
                      </p>
                      <span className="flex items-center gap-2">
                        <span className="num text-sm font-semibold text-ink">{c.score ?? '—'}/100</span>
                        <LevelBadge level={c.level} label={c.statusLabel} />
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar value={c.score ?? 0} color={LEVELS[c.level].color} height={6} label={c.label} />
                    </div>
                    <p className="mt-2 text-xs text-ink2">{c.explanation}</p>
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {Object.entries(c.details).map(([k, v]) => (
                        <div key={k} className="flex gap-1">
                          <dt className="text-muted">{DETAIL_LABEL[k] ?? k}:</dt>
                          <dd className="num font-medium text-ink">{typeof v === 'number' ? v.toLocaleString('pt-BR') : (v ?? '—')}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
                <p className="text-xs text-muted">Faixas: 75+ 🟢 bom · 50–74 🟡 atenção · 25–49 🟠 precisa melhorar · abaixo de 25 🔴 crítico.</p>
              </div>
            </div>
          )}
        </Card>
      </section>

      {algorithm.data && (
        <Card title="Algoritmo de revisão" subtitle={`Versão ${algorithm.data.version}. Parâmetros ajustáveis no banco sem reconstruir a aplicação.`}>
          <div className="space-y-4 text-sm">
            <div>
              <p className="mb-2 font-medium text-ink">Escada de intervalos-base</p>
              <div className="flex flex-wrap gap-2">
                {algorithm.data.ladderLabels.map((l, i) => (
                  <span key={l} className="rounded-xl bg-subtle px-3 py-1.5">
                    <strong className="text-ink">{l}</strong> <span className="text-xs text-ink2">{algorithm.data.phases[i]}</span>
                  </span>
                ))}
                <span className="rounded-xl bg-subtle px-3 py-1.5 text-xs text-ink2">depois ×1,5 até {algorithm.data.maxIntervalDays} dias</span>
              </div>
            </div>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[480px] text-left">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="px-4 py-1.5 font-medium sm:px-0">Pontuação</th>
                    <th className="py-1.5 font-medium">Faixa</th>
                    <th className="py-1.5 font-medium">Regra</th>
                  </tr>
                </thead>
                <tbody>
                  {algorithm.data.bands.map((b) => (
                    <tr key={b.key} className="border-t border-line">
                      <td className="num px-4 py-1.5 sm:px-0">≥ {b.min}</td>
                      <td className="py-1.5 font-medium text-ink">{b.label}</td>
                      <td className="py-1.5 text-ink2">{b.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-ink2">
              Pontuação = {Math.round(algorithm.data.score.accuracyWeight * 100)}% acertos + {Math.round(algorithm.data.score.qualityWeight * 100)}% autoavaliação (
              {Object.entries(algorithm.data.score.qualityLabels)
                .reverse()
                .map(([k, label]) => `${label} = ${algorithm.data!.score.qualityScores[k]}`)
                .join(', ')}
              ). A 1ª revisão sai do percentual de acertos do primeiro contato (mínimo de {algorithm.data.firstReview.minQuestions} questões):{' '}
              {firstReviewText(algorithm.data.firstReview.tiers)}. Contato só de estudo/leitura
              (sem questões) agenda uma verificação com questões no dia seguinte, com mais questões que o normal, e mantém a etapa. Nas faixas de crescimento, o intervalo
              ainda é ajustado pela facilidade individual do assunto, tendência, dificuldade percebida e volume: fazer 1,5× ou 2× as questões sugeridas aumenta o intervalo.
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Segurança">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              changePw.mutate();
            }}
          >
            <Input label="Senha atual" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <Input label="Nova senha" type="password" autoComplete="new-password" minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <div className="flex justify-end">
              <Button type="submit" loading={changePw.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 8}>
                Alterar senha
              </Button>
            </div>
          </form>
        </Card>
        <Card title="Seus dados">
          <p className="mb-3 text-sm text-ink2">Baixe tudo o que você registrou (JSON) ou exclua sua conta definitivamente.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/api/me/export" className="inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-subtle">
              <Download className="h-4 w-4" /> Exportar meus dados
            </a>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>
              Excluir conta
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Excluir conta definitivamente?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={del.isPending} disabled={!deletePw} onClick={() => del.mutate()}>
              Excluir para sempre
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink2">Todos os seus estudos, revisões, metas e simulados serão apagados. Esta ação não pode ser desfeita.</p>
        <Input label="Confirme sua senha" type="password" value={deletePw} onChange={(e) => setDeletePw(e.target.value)} />
      </Modal>
    </div>
  );
}
