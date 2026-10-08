import { useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../hooks/useAuth';
import { Button, useToast } from '../ui';

// Aviso para confirmar o e-mail da conta (só aparece quando o site manda e-mails).
// "Agora não" esconde até fechar o navegador.

const HIDE_KEY = 'email-confirm-hidden';

function hiddenNow() {
  try {
    return sessionStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function EmailConfirmBar() {
  const { user } = useAuth();
  const toast = useToast();
  const [hidden, setHidden] = useState(hiddenNow);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!user?.emailConfirmationPending || hidden) return null;

  async function send() {
    setSending(true);
    try {
      const r = await api.post<{ email: string }>('/auth/verify-email/send');
      setSentTo(r.email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível enviar o e-mail agora.');
    } finally {
      setSending(false);
    }
  }

  function hide() {
    try {
      sessionStorage.setItem(HIDE_KEY, '1');
    } catch {
      /* navegador sem armazenamento: esconde só nesta tela */
    }
    setHidden(true);
  }

  return (
    <div role="status" className="flex items-center gap-x-3 border-b border-line bg-warn-wash px-4 py-1.5 text-xs text-ink2 sm:px-6 sm:text-sm">
      <MailCheck className="hidden h-4 w-4 shrink-0 text-ink sm:block" />
      <span className="min-w-0 flex-1">
        {sentTo ? (
          <>
            Link enviado para <strong className="text-ink [overflow-wrap:anywhere]">{sentTo}</strong>. Abra o e-mail e clique em “Confirmar e-mail” (veja também o spam).
          </>
        ) : (
          <>
            Confirme seu e-mail <strong className="text-ink [overflow-wrap:anywhere]">{user.email}</strong> para poder recuperar a senha se esquecer.
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button size="sm" variant="secondary" loading={sending} onClick={send}>
          {sentTo ? 'Reenviar' : 'Enviar link'}
        </Button>
        <button type="button" onClick={hide} aria-label="Agora não" title="Agora não" className="rounded-lg p-1 text-muted hover:bg-subtle hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </span>
    </div>
  );
}
