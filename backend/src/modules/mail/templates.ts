import type { Mail } from './mailer.js';

// Modelos dos e-mails do site. Cada um devolve assunto, HTML (com estilos na própria
// tag, que é o que os programas de e-mail entendem) e a versão em texto simples.
// Recibo e aviso de cobrança já ficam prontos para quando houver pagamento no site.

const BRAND = 'Projeto Residente';
const ACCENT = '#2a78d6';
const TZ = 'America/Sao_Paulo';

/** Prazos dos links (usados também nos textos). */
export const VERIFY_TTL_HOURS = 72;
export const RESET_TTL_MINUTES = 60;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export const brl = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const dateLong = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const dateTime = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

type Block = { p: string } | { button: { label: string; url: string } } | { rows: [string, string][] } | { small: string };

function render(opts: { to: string; subject: string; tag: string; preheader: string; title: string; blocks: Block[] }): Mail {
  const html = opts.blocks
    .map((b) => {
      if ('p' in b) return `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1f1f1f">${esc(b.p)}</p>`;
      if ('small' in b) return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#666">${esc(b.small)}</p>`;
      if ('rows' in b)
        return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border-collapse:collapse;font-size:14px">${b.rows
          .map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;color:#666">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;color:#1f1f1f;font-weight:600">${esc(v)}</td></tr>`)
          .join('')}</table>`;
      const { label, url } = b.button;
      return `<p style="margin:8px 0 22px"><a href="${esc(url)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(label)}</a></p>
<p style="margin:0 0 18px;font-size:12px;line-height:1.5;color:#666">Se o botão não funcionar, copie este endereço no navegador:<br><a href="${esc(url)}" style="color:${ACCENT};word-break:break-all">${esc(url)}</a></p>`;
    })
    .join('\n');

  const text = [
    opts.title,
    '',
    ...opts.blocks.flatMap((b) => {
      if ('p' in b) return [b.p, ''];
      if ('small' in b) return [b.small, ''];
      if ('rows' in b) return [...b.rows.map(([k, v]) => `${k}: ${v}`), ''];
      return [`${b.button.label}: ${b.button.url}`, ''];
    }),
    '—',
    `${BRAND}. Você recebeu este e-mail porque tem uma conta no site.`,
  ].join('\n');

  return {
    to: opts.to,
    subject: opts.subject,
    tag: opts.tag,
    text,
    html: `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(opts.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f4f4f2"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e7e7e4">
<tr><td style="padding:26px 26px 6px;font-size:13px;font-weight:700;letter-spacing:.02em;color:${ACCENT}">${BRAND}</td></tr>
<tr><td style="padding:6px 26px 10px"><h1 style="margin:0 0 16px;font-size:21px;line-height:1.3;color:#0b0b0b">${esc(opts.title)}</h1>
${html}
</td></tr></table>
<p style="margin:16px 0 0;font-size:12px;color:#888">${BRAND} · Você recebeu este e-mail porque tem uma conta no site.</p>
</td></tr></table>
</body></html>`,
  };
}

export function verifyEmailMail(to: string, name: string, url: string): Mail {
  return render({
    to,
    tag: 'confirmar-email',
    subject: `Confirme seu e-mail no ${BRAND}`,
    preheader: 'Falta só um passo: confirme que este e-mail é seu.',
    title: `Olá, ${firstName(name)}! Confirme seu e-mail`,
    blocks: [
      { p: 'Para terminar o cadastro, confirme que este e-mail é seu. Assim você consegue recuperar a senha e recebe os recibos e avisos da sua assinatura.' },
      { button: { label: 'Confirmar e-mail', url } },
      { small: `O link vale por ${VERIFY_TTL_HOURS / 24} dias. Se você não criou uma conta no ${BRAND}, ignore este e-mail.` },
    ],
  });
}

export function resetPasswordMail(to: string, name: string, url: string): Mail {
  return render({
    to,
    tag: 'nova-senha',
    subject: `Crie uma nova senha no ${BRAND}`,
    preheader: 'Use o link para criar uma nova senha.',
    title: `Olá, ${firstName(name)}! Vamos criar uma nova senha`,
    blocks: [
      { p: 'Recebemos um pedido para criar uma nova senha para a sua conta. Clique no botão e escolha a senha nova.' },
      { button: { label: 'Criar nova senha', url } },
      { small: `O link vale por ${RESET_TTL_MINUTES} minutos e só pode ser usado uma vez. Se não foi você que pediu, ignore este e-mail: a sua senha atual continua valendo.` },
    ],
  });
}

export function passwordChangedMail(to: string, name: string, when: Date, forgotUrl: string): Mail {
  return render({
    to,
    tag: 'senha-alterada',
    subject: `Sua senha do ${BRAND} foi alterada`,
    preheader: 'Aviso de segurança da sua conta.',
    title: `Olá, ${firstName(name)}! Sua senha foi alterada`,
    blocks: [
      { p: `A senha da sua conta foi alterada em ${dateTime(when)} (horário de Brasília). As sessões abertas em outros aparelhos foram encerradas.` },
      { p: 'Se foi você, não precisa fazer nada. Se não foi, crie uma nova senha agora:' },
      { button: { label: 'Criar nova senha', url: forgotUrl } },
    ],
  });
}

export interface ReceiptInfo {
  /** Nome do produto/plano (ex.: "Plano anual"). */
  product: string;
  amountCents: number;
  paidAt: Date;
  /** Ex.: "Pix", "Cartão de crédito final 4242". */
  method: string;
  /** Número do pedido ou da transação no meio de pagamento. */
  reference: string;
  /** Até quando o acesso está pago. */
  accessUntil?: Date;
  /** Página com a nota fiscal ou o comprovante completo. */
  invoiceUrl?: string;
}

export function receiptMail(to: string, name: string, r: ReceiptInfo): Mail {
  const rows: [string, string][] = [
    ['Produto', r.product],
    ['Valor', brl(r.amountCents)],
    ['Pago em', dateTime(r.paidAt)],
    ['Forma de pagamento', r.method],
    ['Pedido', r.reference],
  ];
  if (r.accessUntil) rows.push(['Acesso garantido até', dateLong(r.accessUntil)]);
  return render({
    to,
    tag: 'recibo',
    subject: `Recibo do seu pagamento — ${BRAND}`,
    preheader: `Pagamento de ${brl(r.amountCents)} confirmado.`,
    title: `Obrigado, ${firstName(name)}! Pagamento confirmado`,
    blocks: [
      { p: 'Recebemos o seu pagamento. Guarde este e-mail como recibo.' },
      { rows },
      ...(r.invoiceUrl ? [{ button: { label: 'Ver nota fiscal', url: r.invoiceUrl } }] : []),
      { small: 'Dúvidas sobre a cobrança? Responda a este e-mail.' },
    ],
  });
}

export type BillingNoticeKind = 'upcoming' | 'failed' | 'expired';

export interface BillingNoticeInfo {
  kind: BillingNoticeKind;
  product: string;
  amountCents: number;
  /** upcoming: data da renovação; failed: nova tentativa; expired: quando o acesso terminou. */
  date: Date;
  /** Página para pagar ou atualizar a forma de pagamento. */
  url: string;
}

export function billingNoticeMail(to: string, name: string, n: BillingNoticeInfo): Mail {
  const value = brl(n.amountCents);
  const when = dateLong(n.date);
  const copy = {
    upcoming: {
      subject: `Sua assinatura do ${BRAND} renova em ${when}`,
      title: 'Sua assinatura vai renovar',
      p: `A assinatura "${n.product}" será renovada em ${when}, no valor de ${value}. Não precisa fazer nada se quiser continuar.`,
      button: 'Ver minha assinatura',
    },
    failed: {
      subject: `Não conseguimos cobrar a sua assinatura do ${BRAND}`,
      title: 'Houve um problema com o pagamento',
      p: `Não conseguimos cobrar ${value} da assinatura "${n.product}". Vamos tentar de novo em ${when}. Para não perder o acesso, confira ou troque a forma de pagamento.`,
      button: 'Atualizar pagamento',
    },
    expired: {
      subject: `Seu acesso ao ${BRAND} foi pausado`,
      title: 'Seu acesso foi pausado',
      p: `A assinatura "${n.product}" venceu em ${when}. Seus estudos, revisões e flashcards continuam guardados: renove para voltar a usar.`,
      button: 'Renovar assinatura',
    },
  }[n.kind];
  return render({
    to,
    tag: `cobranca-${n.kind}`,
    subject: copy.subject,
    preheader: copy.p,
    title: `${firstName(name)}, ${copy.title.charAt(0).toLowerCase()}${copy.title.slice(1)}`,
    blocks: [{ p: copy.p }, { button: { label: copy.button, url: n.url } }, { small: 'Dúvidas sobre a cobrança? Responda a este e-mail.' }],
  });
}
