import { parseTicketNumber } from '@provisia/shared';
import { type AddressObject, type ParsedMail, simpleParser } from 'mailparser';

export interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  contentId?: string;
}

export interface ParsedInbound {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: { address: string; name: string } | null;
  to: string[];
  cc: string[];
  subject: string;
  /** Ticket number from a `[#1001]` token in the subject. */
  ticketNumber: string | null;
  /** Plain text with quoted replies and signatures removed. */
  text: string;
  /** Full plain text (fallback when stripping removed everything). */
  fullText: string;
  html: string | null;
  date: Date | null;
  attachments: InboundAttachment[];
  /** Auto-responder / bounce / mailing-list heuristics: never create or reply to tickets for these. */
  isAutoReply: boolean;
  autoReplyReason: string | null;
  headers: Record<string, string>;
}

function addresses(
  v: AddressObject | AddressObject[] | undefined,
): Array<{ address: string; name: string }> {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list.flatMap((a) =>
    a.value.map((x) => ({ address: (x.address ?? '').toLowerCase(), name: x.name ?? '' })),
  );
}

/** Detects auto-replies, bounces and list mail from headers/subject/sender. */
export function detectAutoReply(
  headers: Record<string, string>,
  subject: string,
  from: string | null,
): string | null {
  const h = (k: string) => (headers[k.toLowerCase()] ?? '').toLowerCase();
  const autoSubmitted = h('auto-submitted');
  if (autoSubmitted && autoSubmitted !== 'no') return `Auto-Submitted: ${autoSubmitted}`;
  if (h('x-auto-response-suppress')) return 'X-Auto-Response-Suppress';
  if (h('x-autoreply') || h('x-autorespond') || h('x-autoresponder')) return 'X-Autoreply';
  const precedence = h('precedence');
  if (['bulk', 'auto_reply', 'junk', 'list'].includes(precedence))
    return `Precedence: ${precedence}`;
  if (h('list-id') || h('list-unsubscribe')) return 'List mail';
  if (h('x-failed-recipients') || h('content-type').includes('multipart/report'))
    return 'Delivery report';
  if (h('x-provisia-log-id')) return 'Own outbound mail';
  const f = (from ?? '').toLowerCase();
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/.test(f)) return `Sender ${f}`;
  if (
    /^(auto(matic)?[ -]?(reply|response)|out of (the )?office|afwezig|automatisch antwoord|delivery (status notification|failure)|undeliver)/i.test(
      subject.trim(),
    )
  ) {
    return `Subject "${subject.trim().slice(0, 40)}"`;
  }
  return null;
}

const QUOTE_HEADER_PATTERNS: RegExp[] = [
  // "On Mon, 3 Mar 2026 at 10:00, Jan <jan@x> wrote:" (may wrap over 2 lines)
  /^On .{0,200}?wrote:\s*$/ims,
  /^Op .{0,200}?schreef .{0,120}?:\s*$/ims,
  /^Am .{0,200}?schrieb .{0,120}?:\s*$/ims,
  /^Le .{0,200}?a écrit\s*:\s*$/ims,
  /^-{2,}\s*(Original|Oorspronkelijk|Forwarded)\s+(Message|bericht|message)\s*-{2,}\s*$/im,
  /^_{5,}\s*$/m,
  /^(From|Van|Von|De)\s*:\s.+\n(Sent|Verzonden|Gesendet|Envoyé)\s*:/im,
  /^>?\s*(From|Van):\s.+?\n>?\s*(Sent|Date|Verzonden|Datum):\s.+?\n>?\s*(To|Aan):/ims,
  /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}.{0,60}<[^>]+@[^>]+>:\s*$/m,
];

/** Removes quoted previous messages and common signature delimiters, keeping only the new text. */
export function stripQuotedReply(text: string): string {
  let body = text.replace(/\r\n/g, '\n');
  // Cut at the first ">"-quoted block that runs to the end (allowing blank lines inside it).
  const lines = body.split('\n');
  let firstQuote = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*>/.test(lines[i] ?? '')) {
      const rest = lines.slice(i);
      if (rest.every((l) => /^\s*>/.test(l) || l.trim() === '')) {
        firstQuote = i;
        break;
      }
    }
  }
  if (firstQuote >= 0) body = lines.slice(0, firstQuote).join('\n');

  let cut = body.length;
  for (const re of QUOTE_HEADER_PATTERNS) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  body = body.slice(0, cut);
  // Signature delimiter "-- " and mobile boilerplate.
  const sig = /^-- ?$/m.exec(body);
  if (sig) body = body.slice(0, sig.index);
  body = body.replace(
    /^(Sent from my (iPhone|iPad|Android|Samsung).*|Verzonden vanaf mijn .*|Verstuurd vanaf mijn .*)$/gim,
    '',
  );
  return body.replace(/\n{3,}/g, '\n\n').trim();
}

/** Parses a raw RFC 822 message into the shape the ticket pipeline needs. */
export async function parseInboundEmail(raw: Buffer | string): Promise<ParsedInbound> {
  const mail: ParsedMail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true });
  const headers: Record<string, string> = {};
  for (const [k, v] of mail.headers) {
    headers[k.toLowerCase()] =
      typeof v === 'string' ? v : Array.isArray(v) ? v.map(String).join(', ') : headerToString(v);
  }
  const fromList = addresses(mail.from);
  const from = fromList[0] ?? null;
  const subject = mail.subject ?? '';
  const fullText = (mail.text ?? (mail.html ? htmlToPlain(mail.html) : ''))
    .replace(/\r\n/g, '\n')
    .trim();
  const stripped = stripQuotedReply(fullText);
  const refs = Array.isArray(mail.references)
    ? mail.references
    : mail.references
      ? [mail.references]
      : [];
  const autoReason = detectAutoReply(headers, subject, from?.address ?? null);
  return {
    messageId: mail.messageId ?? null,
    inReplyTo: mail.inReplyTo ?? null,
    references: refs,
    from,
    to: addresses(mail.to).map((a) => a.address),
    cc: addresses(mail.cc).map((a) => a.address),
    subject,
    ticketNumber: parseTicketNumber(subject),
    text: stripped || fullText,
    fullText,
    html: typeof mail.html === 'string' ? mail.html : null,
    date: mail.date ?? null,
    attachments: (mail.attachments ?? [])
      .filter((a) => a.content && a.content.length > 0)
      .map((a) => ({
        filename: a.filename ?? `attachment-${a.checksum.slice(0, 8)}`,
        contentType: a.contentType,
        size: a.size,
        content: a.content,
        contentId: a.cid,
      })),
    isAutoReply: autoReason !== null,
    autoReplyReason: autoReason,
    headers,
  };
}

function headerToString(v: unknown): string {
  if (v && typeof v === 'object' && 'text' in v) return String((v as { text: unknown }).text);
  if (v && typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value);
  return String(v ?? '');
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|blockquote)>/gi, '\n')
    .replace(/<blockquote[^>]*>/gi, '\n> ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
