import { env, isProduction } from '../../config/env.js';

// Envio de e-mails pelo Resend (https://resend.com), pela API HTTP — sem SDK.
// - Com RESEND_API_KEY: envia de verdade.
// - Sem a chave, em produção: e-mails desligados (o site esconde "Esqueci minha senha"
//   e o aviso de confirmar o e-mail).
// - Sem a chave, em desenvolvimento: o e-mail aparece no terminal (com o link).
// - Nos testes: nunca envia; guarda na caixa `outbox` para os testes lerem.

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Categoria do e-mail (aparece no painel do Resend). */
  tag?: string;
}

const RESEND_URL = 'https://api.resend.com/emails';
const isTest = () => process.env.NODE_ENV === 'test';

/** E-mails enviados durante os testes (o mais recente por último). */
export const outbox: Mail[] = [];

/** O site consegue mandar e-mails? (em desenvolvimento, sim: eles saem no terminal) */
export const mailEnabled = () => isTest() || Boolean(env.RESEND_API_KEY) || !isProduction;

/** Situação do envio, para a página de Administração. */
export function mailStatus() {
  return {
    mode: env.RESEND_API_KEY ? ('resend' as const) : isProduction ? ('off' as const) : ('terminal' as const),
    from: env.EMAIL_FROM,
    // O remetente de teste do Resend só entrega para o e-mail dono da conta do Resend
    testSender: /@resend\.dev>?\s*$/i.test(env.EMAIL_FROM),
    appUrl: env.APP_URL ?? null,
  };
}

export class MailError extends Error {}

export async function sendMail(mail: Mail): Promise<void> {
  if (isTest()) {
    outbox.push(mail);
    return;
  }
  if (!env.RESEND_API_KEY) {
    if (isProduction) throw new MailError('Envio de e-mails não configurado (RESEND_API_KEY)');
    console.info(`\n✉️  E-mail (não enviado: falta RESEND_API_KEY)\nPara: ${mail.to}\nAssunto: ${mail.subject}\n\n${mail.text}\n`);
    return;
  }
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
      ...(mail.tag ? { tags: [{ name: 'tipo', value: mail.tag }] } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new MailError(`Resend respondeu ${res.status}: ${detail.slice(0, 300)}`);
  }
}

/** Envia sem interromper quem chamou (ex.: o cadastro não falha se o e-mail falhar). */
export async function trySendMail(mail: Mail): Promise<boolean> {
  try {
    await sendMail(mail);
    return true;
  } catch (err) {
    console.error(`Falha ao enviar e-mail "${mail.tag ?? mail.subject}"`, err);
    return false;
  }
}
