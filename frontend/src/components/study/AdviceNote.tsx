import { Lightbulb } from 'lucide-react';
import type { StudyAdvice } from '../../api/types';
import { cx } from '../ui';

/** "Como estudar": questões, teoria ou o plano da etapa, pelos últimos estudos do assunto. */
export function AdviceNote({ advice, compact }: { advice: StudyAdvice; compact?: boolean }) {
  if (advice.focus === 'EQUILIBRIO')
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-ink2" title={advice.reason}>
        <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted" /> {advice.title}
      </p>
    );
  return (
    <div className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-line bg-accent-wash px-2 py-1.5 text-xs text-ink">
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
      <p className={cx('min-w-0', compact && 'line-clamp-3')}>
        <strong>{advice.title}.</strong> <span className="text-ink2">{advice.reason}</span>
      </p>
    </div>
  );
}
