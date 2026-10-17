import { readFile } from 'node:fs/promises';
import {
  type Db,
  type DepartmentMailboxConfig,
  emailLog,
  emailTemplates,
  ticketDepartments,
} from '@provisia/db';
import { decryptJson } from '@provisia/module-sdk';
import type { EmailSendJob, EmailTemplateKey, RenderedEmail, Settings } from '@provisia/shared';
import { and, eq } from 'drizzle-orm';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { type CompanyInfo, renderEmail, renderRaw } from './render.js';
import { loadSettings } from './settings.js';
import { isTemplateKey, normalizeLocale } from './templates/index.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  /** Upgrade with STARTTLS when the server offers it (nodemailer default); false forces plain. */
  requireTLS?: boolean;
  auth?: { user: string; pass: string };
  /** For logging/tests. */
  source: 'settings' | 'env' | 'department' | 'override';
}

export interface DkimConfig {
  domainName: string;
  keySelector: string;
  privateKey: string;
}

export interface ResolvedMailConfig {
  smtp: SmtpConfig;
  from: { name: string; address: string };
  replyTo?: string;
  bcc?: string;
  dkim?: DkimConfig;
}

/** Parses `smtp://user:pass@host:port` / `smtps://...` (the `SMTP_URL` env fallback). */
export function parseSmtpUrl(url: string): SmtpConfig {
  const u = new URL(url);
  const secure = u.protocol === 'smtps:';
  const port = u.port ? Number(u.port) : secure ? 465 : 587;
  const cfg: SmtpConfig = { host: u.hostname, port, secure, source: 'env' };
  if (u.username)
    cfg.auth = { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) };
  return cfg;
}

/** SMTP + from/DKIM from the `mail` settings group, falling back to `SMTP_URL` / `MAIL_FROM` env. */
export function resolveMailConfig(
  s: Settings,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedMailConfig {
  let smtp: SmtpConfig;
  if (s['mail.transport'] === 'smtp' && s['mail.smtpHost']) {
    const security = s['mail.smtpSecurity'];
    smtp = {
      host: s['mail.smtpHost'],
      port: s['mail.smtpPort'],
      secure: security === 'tls',
      requireTLS: security === 'starttls',
      source: 'settings',
    };
    if (s['mail.smtpUser']) smtp.auth = { user: s['mail.smtpUser'], pass: s['mail.smtpPassword'] };
  } else {
    smtp = parseSmtpUrl(env.SMTP_URL || 'smtp://localhost:1025');
  }
  const envFrom = parseMailFrom(env.MAIL_FROM);
  const from = {
    name: s['mail.fromName'] || envFrom?.name || 'Provisia',
    address: s['mail.fromAddress'] || envFrom?.address || 'noreply@example.com',
  };
  const out: ResolvedMailConfig = { smtp, from };
  if (s['mail.replyTo']) out.replyTo = s['mail.replyTo'];
  if (s['mail.bccAddress']) out.bcc = s['mail.bccAddress'];
  if (s['mail.dkimDomain'] && s['mail.dkimSelector'] && s['mail.dkimPrivateKey']) {
    out.dkim = {
      domainName: s['mail.dkimDomain'],
      keySelector: s['mail.dkimSelector'],
      privateKey: s['mail.dkimPrivateKey'],
    };
  }
  return out;
}

function parseMailFrom(value: string | undefined): { name: string; address: string } | null {
  if (!value) return null;
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: (m[1] ?? '').trim(), address: (m[2] ?? '').trim() };
  return { name: '', address: value.trim() };
}

export function companyFromSettings(s: Settings): CompanyInfo {
  return {
    name: s['company.name'],
    address: s['company.address'],
    website: s['company.website'],
    logoUrl: s['company.logoUrl'],
    email: s['company.email'],
  };
}

export function createTransport(
  cfg: ResolvedMailConfig,
): Transporter<SMTPTransport.SentMessageInfo> {
  const options: SMTPTransport.Options = {
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    requireTLS: cfg.smtp.requireTLS ?? false,
    auth: cfg.smtp.auth,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    dkim: cfg.dkim,
  };
  return nodemailer.createTransport(options);
}

/** Department SMTP override (ticket mail is sent from the department mailbox when configured). */
export async function departmentMailOverride(
  db: Db,
  departmentId: string,
  base: ResolvedMailConfig,
): Promise<ResolvedMailConfig> {
  const [dept] = await db
    .select({
      email: ticketDepartments.email,
      name: ticketDepartments.name,
      enc: ticketDepartments.mailboxConfigEncrypted,
    })
    .from(ticketDepartments)
    .where(eq(ticketDepartments.id, departmentId))
    .limit(1);
  if (!dept) return base;
  const out: ResolvedMailConfig = { ...base };
  if (dept.email) {
    out.from = { name: `${base.from.name} ${dept.name}`.trim(), address: dept.email };
    out.replyTo = dept.email;
  }
  if (dept.enc) {
    try {
      const cfg = decryptJson<DepartmentMailboxConfig>(dept.enc);
      if (cfg.smtp?.host) {
        out.smtp = {
          host: cfg.smtp.host,
          port: cfg.smtp.port,
          secure: cfg.smtp.secure,
          source: 'department',
          ...(cfg.smtp.user
            ? { auth: { user: cfg.smtp.user, pass: cfg.smtp.password ?? '' } }
            : {}),
        };
      }
    } catch {
      // Undecryptable config: fall back to the global transport rather than failing the send.
    }
  }
  return out;
}

export interface SendResult {
  logId: string;
  status: 'sent' | 'failed' | 'bounced' | 'skipped';
  messageId?: string;
  error?: string;
  /** True when the failure is permanent (5xx) — do not retry. */
  permanent?: boolean;
}

export interface SendOptions {
  env?: NodeJS.ProcessEnv;
  /** Existing log row to update (retry / resend); a new row is created when absent. */
  logId?: string;
  /** Test seam. */
  transport?: Transporter<SMTPTransport.SentMessageInfo>;
  webUrl?: string;
}

export class TemplateDisabledError extends Error {}

/** Loads the admin override for a key+locale (falls back to the `en` override, then built-in). */
export async function loadTemplateOverride(db: Db, key: EmailTemplateKey, locale: string) {
  const rows = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.locale, locale)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row;
}

/**
 * Renders (when `key` is set) and sends one message, recording the outcome in `email_log`.
 * Never throws for delivery problems: inspect `result.status` / `result.permanent`.
 */
export async function sendEmail(
  db: Db,
  job: EmailSendJob,
  opts: SendOptions = {},
): Promise<SendResult> {
  const settings = await loadSettings(db);
  const company = companyFromSettings(settings);
  const locale = normalizeLocale(job.locale ?? settings['localization.defaultLocale']);
  let rendered: RenderedEmail;
  let templateDisabled = false;

  if (job.key && isTemplateKey(job.key)) {
    const override = await loadTemplateOverride(db, job.key, locale);
    if (override && !override.enabled) templateDisabled = true;
    rendered = renderEmail({
      key: job.key,
      locale,
      data: job.data ?? {},
      company,
      override: override
        ? {
            subject: override.subject,
            bodyHtml: override.bodyHtml,
            bodyText: override.bodyText,
            useLayout: override.useLayout,
          }
        : null,
      webUrl: opts.webUrl,
    });
  } else {
    rendered = renderRaw({
      subject: job.subject ?? '(no subject)',
      html: job.html ?? job.text ?? '',
      company,
      locale,
    });
    if (job.text) rendered = { ...rendered, text: job.text };
  }

  let mail = resolveMailConfig(settings, opts.env);
  if (job.departmentId) mail = await departmentMailOverride(db, job.departmentId, mail);

  const attachments = await Promise.all(
    (job.attachments ?? []).map(async (a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.contentBase64
        ? Buffer.from(a.contentBase64, 'base64')
        : a.path
          ? await readFile(a.path)
          : Buffer.alloc(0),
    })),
  );

  const logValues = {
    toEmail: job.to,
    toUserId: job.toUserId ?? null,
    cc: job.cc ?? [],
    fromEmail: mail.from.address,
    templateKey: job.key ?? null,
    locale,
    subject: rendered.subject,
    bodyHtml: rendered.html,
    bodyText: rendered.text,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      size: a.content.length,
      contentType: a.contentType,
    })),
    relatedType: job.related?.type ?? null,
    relatedId: job.related?.id ?? null,
    payload: (job.data as Record<string, unknown> | undefined) ?? null,
  };

  let logId = opts.logId;
  if (logId) {
    await db
      .update(emailLog)
      .set({ ...logValues, status: 'queued' })
      .where(eq(emailLog.id, logId));
  } else {
    const [row] = await db
      .insert(emailLog)
      .values({ ...logValues, status: 'queued' })
      .returning({ id: emailLog.id });
    if (!row) throw new Error('failed to insert email_log');
    logId = row.id;
  }

  if (templateDisabled) {
    await db
      .update(emailLog)
      .set({ status: 'failed', error: 'template_disabled' })
      .where(eq(emailLog.id, logId));
    return { logId, status: 'skipped', error: 'template_disabled' };
  }

  const transport = opts.transport ?? createTransport(mail);
  try {
    const info = await transport.sendMail({
      from: { name: mail.from.name, address: mail.from.address },
      to: job.toName ? { name: job.toName, address: job.to } : job.to,
      cc: job.cc,
      bcc: mail.bcc,
      replyTo: job.replyTo ?? mail.replyTo,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments,
      headers: {
        'X-Provisia-Log-Id': logId,
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        ...(job.headers ?? {}),
      },
    });
    const rejected =
      Array.isArray(info.rejected) && info.rejected.length > 0 && info.accepted.length === 0;
    const status = rejected ? 'bounced' : 'sent';
    await db
      .update(emailLog)
      .set({
        status,
        messageId: info.messageId ?? null,
        sentAt: new Date(),
        error: rejected ? `rejected: ${info.response}` : null,
        attempts: (await currentAttempts(db, logId)) + 1,
      })
      .where(eq(emailLog.id, logId));
    return rejected
      ? { logId, status: 'bounced', error: info.response, permanent: true }
      : { logId, status: 'sent', messageId: info.messageId };
  } catch (err) {
    const e = err as Error & { responseCode?: number; code?: string };
    const permanent = isPermanentFailure(e);
    const message = e.message ?? String(err);
    await db
      .update(emailLog)
      .set({
        status: permanent ? 'bounced' : 'failed',
        error: message.slice(0, 2000),
        attempts: (await currentAttempts(db, logId)) + 1,
      })
      .where(eq(emailLog.id, logId));
    return { logId, status: permanent ? 'bounced' : 'failed', error: message, permanent };
  } finally {
    if (!opts.transport) transport.close();
  }
}

async function currentAttempts(db: Db, logId: string): Promise<number> {
  const [row] = await db
    .select({ attempts: emailLog.attempts })
    .from(emailLog)
    .where(eq(emailLog.id, logId))
    .limit(1);
  return row?.attempts ?? 0;
}

/** SMTP 5xx = permanent (bad address, policy rejection); everything else is worth a retry. */
export function isPermanentFailure(err: {
  responseCode?: number;
  code?: string;
  message?: string;
}): boolean {
  if (typeof err.responseCode === 'number')
    return err.responseCode >= 500 && err.responseCode < 600;
  if (err.code === 'EENVELOPE') return true;
  return false;
}

/** Opens a connection and authenticates; optionally sends a test message. */
export async function testSmtp(
  db: Db,
  opts: { to?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ ok: boolean; message: string; messageId?: string }> {
  const settings = await loadSettings(db);
  const mail = resolveMailConfig(settings, opts.env);
  const transport = createTransport(mail);
  try {
    await transport.verify();
    if (!opts.to)
      return {
        ok: true,
        message: `Connected to ${mail.smtp.host}:${mail.smtp.port} (${mail.smtp.source})`,
      };
    const rendered = renderRaw({
      subject: `${settings['company.name']} SMTP test`,
      html: `<h1>SMTP works</h1><p>This test message was sent via <code>${mail.smtp.host}:${mail.smtp.port}</code>${mail.dkim ? ' with DKIM signing' : ''}.</p>`,
      company: companyFromSettings(settings),
      locale: settings['localization.defaultLocale'],
    });
    const info = await transport.sendMail({
      from: mail.from,
      to: opts.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    await db.insert(emailLog).values({
      toEmail: opts.to,
      fromEmail: mail.from.address,
      subject: rendered.subject,
      bodyHtml: rendered.html,
      bodyText: rendered.text,
      status: 'sent',
      messageId: info.messageId,
      sentAt: new Date(),
      attempts: 1,
      relatedType: 'smtp_test',
    });
    return { ok: true, message: `Test message sent to ${opts.to}`, messageId: info.messageId };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}
