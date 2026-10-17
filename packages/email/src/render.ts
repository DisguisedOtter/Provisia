import type { EmailTemplateKey, RenderedEmail } from '@provisia/shared';
import Handlebars from 'handlebars';
import { builtInFooter, builtInTemplate, LAYOUT_HTML, normalizeLocale } from './templates/index.js';

/**
 * Isolated Handlebars environment: only the helpers below exist, prototype access is disabled, and
 * admin-supplied templates are compiled with `strict: false` so a typo renders empty, not an exception.
 */
const hbs = Handlebars.create();

const RUNTIME = {
  allowProtoPropertiesByDefault: false,
  allowProtoMethodsByDefault: false,
  allowCallsToHelperMissing: false,
};

const MONEY_LOCALE: Record<string, string> = { en: 'en-IE', nl: 'nl-NL' };

function fmtMoney(value: unknown, locale: string): string {
  if (!value || typeof value !== 'object') return '';
  const { amount, currency } = value as { amount?: unknown; currency?: unknown };
  if (typeof amount !== 'number' || typeof currency !== 'string') return '';
  try {
    return new Intl.NumberFormat(MONEY_LOCALE[locale] ?? 'en-IE', {
      style: 'currency',
      currency,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

function fmtDate(value: unknown, locale: string, withTime = false): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', {
    dateStyle: 'long',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: 'UTC',
  }).format(d);
}

hbs.registerHelper(
  'money',
  function (this: unknown, value: unknown, options?: Handlebars.HelperOptions) {
    const locale = (options?.data?.root as { locale?: string } | undefined)?.locale ?? 'en';
    return fmtMoney(value, locale);
  },
);
hbs.registerHelper(
  'date',
  function (this: unknown, value: unknown, options?: Handlebars.HelperOptions) {
    const locale = (options?.data?.root as { locale?: string } | undefined)?.locale ?? 'en';
    return fmtDate(value, locale);
  },
);
hbs.registerHelper(
  'datetime',
  function (this: unknown, value: unknown, options?: Handlebars.HelperOptions) {
    const locale = (options?.data?.root as { locale?: string } | undefined)?.locale ?? 'en';
    return fmtDate(value, locale, true);
  },
);
hbs.registerHelper('uppercase', (v: unknown) => String(v ?? '').toUpperCase());
hbs.registerHelper('lowercase', (v: unknown) => String(v ?? '').toLowerCase());
hbs.registerHelper('default', (...args: unknown[]) => {
  // last arg is Handlebars options
  for (const a of args.slice(0, -1)) if (a !== undefined && a !== null && a !== '') return a;
  return '';
});
hbs.registerHelper('eq', (a: unknown, b: unknown) => a === b);
hbs.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
hbs.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
hbs.registerHelper('lt', (a: unknown, b: unknown) => Number(a) < Number(b));
hbs.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
hbs.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
hbs.registerHelper('join', (list: unknown, sep: unknown) => {
  if (!Array.isArray(list)) return '';
  const s = typeof sep === 'string' ? sep : ', ';
  const escaped = list.map((x) => Handlebars.escapeExpression(String(x))).join(s);
  return new Handlebars.SafeString(escaped);
});
hbs.registerHelper('nl2br', (v: unknown) => {
  const escaped = Handlebars.escapeExpression(String(v ?? ''));
  return new Handlebars.SafeString(escaped.replace(/\r?\n/g, '<br>'));
});
hbs.registerHelper('truncate', (v: unknown, len: unknown) => {
  const s = String(v ?? '');
  const n = typeof len === 'number' ? len : 100;
  return s.length > n ? `${s.slice(0, n)}…` : s;
});

const cache = new Map<string, Handlebars.TemplateDelegate>();
function compile(source: string, noEscape = false): Handlebars.TemplateDelegate {
  const key = `${noEscape ? 't' : 'h'}:${source}`;
  let t = cache.get(key);
  if (!t) {
    t = hbs.compile(source, { strict: false, knownHelpersOnly: false, noEscape });
    if (cache.size > 500) cache.clear();
    cache.set(key, t);
  }
  return t;
}

/**
 * Renders a single handlebars string. HTML-escapes interpolations by default (email HTML, subjects);
 * pass `{ plainText: true }` for bodies that are stored as text/markdown and escaped later by the
 * renderer that displays them (canned responses), so names like O'Brien are not entity-encoded.
 */
export function renderString(
  source: string,
  data: Record<string, unknown>,
  opts: { plainText?: boolean } = {},
): string {
  return compile(source, opts.plainText === true)(data, RUNTIME);
}

/** Validates handlebars syntax without rendering. Returns the error message or null. */
export function validateTemplateSyntax(source: string): string | null {
  try {
    hbs.precompile(source);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Crude but dependable HTML → text for the `text/plain` part and for logs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(
      /<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, text: string) => {
        const t = text.replace(/<[^>]+>/g, '').trim();
        return t && t !== href ? `${t} (${href})` : href;
      },
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|li|table)>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface CompanyInfo {
  name: string;
  address?: string;
  website?: string;
  logoUrl?: string;
  email?: string;
}

export interface TemplateSource {
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  useLayout?: boolean;
}

export interface RenderOptions {
  key: EmailTemplateKey;
  locale?: string | null;
  data: Record<string, unknown>;
  company: CompanyInfo;
  /** Admin override from `email_templates`; falls back to the built-in template. */
  override?: TemplateSource | null;
  webUrl?: string;
}

/** Renders subject, html (inside the layout) and text for a template key. */
export function renderEmail(opts: RenderOptions): RenderedEmail {
  const locale = normalizeLocale(opts.locale);
  const source: TemplateSource = opts.override ?? {
    ...builtInTemplate(opts.key, locale),
    bodyHtml: builtInTemplate(opts.key, locale).html,
    useLayout: true,
  };
  const context = { ...opts.data, company: opts.company, locale, webUrl: opts.webUrl ?? '' };
  const subject = renderString(source.subject, context).replace(/\s+/g, ' ').trim();
  const body = renderString(source.bodyHtml, context);
  const html =
    source.useLayout === false
      ? body
      : renderString(LAYOUT_HTML, {
          ...context,
          subject,
          body,
          footer: renderString(builtInFooter(locale), context),
        });
  const text = source.bodyText ? renderString(source.bodyText, context) : htmlToText(body);
  return { subject, html, text };
}

/** Renders an arbitrary html body inside the layout (raw sends, test mails). */
export function renderRaw(opts: {
  subject: string;
  html: string;
  company: CompanyInfo;
  locale?: string | null;
}): RenderedEmail {
  const locale = normalizeLocale(opts.locale);
  const context = { company: opts.company, locale };
  const html = renderString(LAYOUT_HTML, {
    ...context,
    subject: opts.subject,
    body: opts.html,
    footer: renderString(builtInFooter(locale), context),
  });
  return { subject: opts.subject, html, text: htmlToText(opts.html) };
}
