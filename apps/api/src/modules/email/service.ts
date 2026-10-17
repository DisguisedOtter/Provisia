import { type Db, emailLog, emailTemplates, notifications } from '@provisia/db';
import {
  builtInTemplate,
  companyFromSettings,
  isTemplateKey,
  renderEmail,
  SAMPLE_DATA,
  TEMPLATE_VARIABLES,
  validateTemplateSyntax,
} from '@provisia/email';
import {
  EMAIL_TEMPLATE_KEYS,
  type EmailLocale,
  type EmailLogDetail,
  type EmailLogEntry,
  type EmailLogQuery,
  type EmailSendJob,
  type EmailTemplate,
  type EmailTemplateKey,
  type Notification,
  type NotificationQuery,
  type Paginated,
  type PreviewEmailTemplate,
  pageOffset,
  paginate,
  type RenderedEmail,
  type UpsertEmailTemplate,
} from '@provisia/shared';
import { and, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { badRequest, notFound } from '../../lib/errors.js';
import { getAllSettings } from '../../lib/settings.js';

/* ------------------------------------------------ templates ------------------------------------------------ */

function assertKey(key: string): EmailTemplateKey {
  if (!isTemplateKey(key)) throw notFound('Template');
  return key;
}

function toView(
  key: EmailTemplateKey,
  locale: EmailLocale,
  row: typeof emailTemplates.$inferSelect | undefined,
): EmailTemplate {
  const builtIn = builtInTemplate(key, locale);
  return {
    id: row?.id ?? null,
    key,
    locale,
    name: row?.name ?? builtIn.name,
    subject: row?.subject ?? builtIn.subject,
    bodyHtml: row?.bodyHtml ?? builtIn.html,
    bodyText: row?.bodyText ?? null,
    useLayout: row?.useLayout ?? true,
    enabled: row?.enabled ?? true,
    customized: !!row,
    variables: TEMPLATE_VARIABLES[key],
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function listTemplates(db: Db, locale: EmailLocale): Promise<EmailTemplate[]> {
  const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.locale, locale));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return EMAIL_TEMPLATE_KEYS.map((key) => toView(key, locale, byKey.get(key)));
}

export async function getTemplate(
  db: Db,
  keyParam: string,
  locale: EmailLocale,
): Promise<EmailTemplate> {
  const key = assertKey(keyParam);
  const [row] = await db
    .select()
    .from(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.locale, locale)))
    .limit(1);
  return toView(key, locale, row);
}

export async function upsertTemplate(
  db: Db,
  keyParam: string,
  locale: EmailLocale,
  input: UpsertEmailTemplate,
): Promise<EmailTemplate> {
  const key = assertKey(keyParam);
  for (const [field, src] of [
    ['subject', input.subject],
    ['bodyHtml', input.bodyHtml],
    ['bodyText', input.bodyText ?? ''],
  ] as const) {
    const err = validateTemplateSyntax(src);
    if (err) throw badRequest(`Invalid handlebars in ${field}: ${err}`, { field });
  }
  // Render once with sample data so runtime errors surface at save time, not at send time.
  renderPreview(
    key,
    locale,
    { subject: input.subject, bodyHtml: input.bodyHtml, useLayout: input.useLayout },
    undefined,
    { name: 'Preview' },
  );
  const values = {
    key,
    locale,
    name: input.name ?? builtInTemplate(key, locale).name,
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    bodyText: input.bodyText ?? null,
    useLayout: input.useLayout,
    enabled: input.enabled,
  };
  const [row] = await db
    .insert(emailTemplates)
    .values(values)
    .onConflictDoUpdate({ target: [emailTemplates.key, emailTemplates.locale], set: values })
    .returning();
  return toView(key, locale, row);
}

/** Deletes the override so the built-in template is used again. */
export async function resetTemplate(
  db: Db,
  keyParam: string,
  locale: EmailLocale,
): Promise<EmailTemplate> {
  const key = assertKey(keyParam);
  await db
    .delete(emailTemplates)
    .where(and(eq(emailTemplates.key, key), eq(emailTemplates.locale, locale)));
  return toView(key, locale, undefined);
}

function renderPreview(
  key: EmailTemplateKey,
  locale: EmailLocale,
  source: { subject?: string; bodyHtml?: string; useLayout?: boolean } | undefined,
  stored: EmailTemplate | undefined,
  company: { name: string; address?: string; website?: string; logoUrl?: string },
  dataOverrides?: Record<string, unknown>,
): RenderedEmail {
  const base = stored?.customized
    ? {
        subject: stored.subject,
        bodyHtml: stored.bodyHtml,
        bodyText: stored.bodyText,
        useLayout: stored.useLayout,
      }
    : null;
  const override =
    source?.subject !== undefined || source?.bodyHtml !== undefined
      ? {
          subject: source.subject ?? base?.subject ?? builtInTemplate(key, locale).subject,
          bodyHtml: source.bodyHtml ?? base?.bodyHtml ?? builtInTemplate(key, locale).html,
          useLayout: source.useLayout ?? base?.useLayout ?? true,
        }
      : base;
  const data = {
    ...(SAMPLE_DATA[key] as unknown as Record<string, unknown>),
    ...(dataOverrides ?? {}),
  };
  return renderEmail({ key, locale, data, company, override });
}

export async function previewTemplate(
  db: Db,
  keyParam: string,
  locale: EmailLocale,
  input: PreviewEmailTemplate,
): Promise<RenderedEmail> {
  const key = assertKey(keyParam);
  const settings = await getAllSettings(db);
  const stored = await getTemplate(db, key, locale);
  try {
    return renderPreview(key, locale, input, stored, companyFromSettings(settings), input.data);
  } catch (err) {
    throw badRequest(
      `Template failed to render: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Job for a test send of a template with sample data. */
export function testSendJob(keyParam: string, to: string, locale: EmailLocale): EmailSendJob {
  const key = assertKey(keyParam);
  return {
    key,
    to,
    locale,
    data: SAMPLE_DATA[key] as unknown as Record<string, unknown>,
    related: { type: 'email_test', id: '00000000-0000-7000-8000-000000000000' },
  };
}

/* ------------------------------------------------ log ------------------------------------------------ */

function logView(row: typeof emailLog.$inferSelect): EmailLogEntry {
  const { bodyHtml: _h, bodyText: _t, payload: _p, ...rest } = row;
  return rest;
}

export async function listEmailLog(db: Db, q: EmailLogQuery): Promise<Paginated<EmailLogEntry>> {
  const where: SQL[] = [];
  if (q.status) where.push(eq(emailLog.status, q.status));
  if (q.templateKey) where.push(eq(emailLog.templateKey, q.templateKey));
  if (q.to) where.push(ilike(emailLog.toEmail, `%${q.to}%`));
  if (q.relatedType) where.push(eq(emailLog.relatedType, q.relatedType));
  if (q.relatedId) where.push(eq(emailLog.relatedId, q.relatedId));
  if (q.search) {
    const s = or(
      ilike(emailLog.subject, `%${q.search}%`),
      ilike(emailLog.toEmail, `%${q.search}%`),
    );
    if (s) where.push(s);
  }
  const cond = where.length ? and(...where) : undefined;
  const [total] = await db.select({ n: count() }).from(emailLog).where(cond);
  const rows = await db
    .select()
    .from(emailLog)
    .where(cond)
    .orderBy(desc(emailLog.createdAt))
    .limit(q.perPage)
    .offset(pageOffset(q));
  return paginate(rows.map(logView), total?.n ?? 0, q);
}

export async function getEmailLog(db: Db, id: string): Promise<EmailLogDetail> {
  const [row] = await db.select().from(emailLog).where(eq(emailLog.id, id)).limit(1);
  if (!row) throw notFound('Email');
  const { payload: _p, ...rest } = row;
  return rest;
}

/** Builds a fresh `email:send` job from a logged mail (re-rendered from its payload when templated). */
export async function resendJob(
  db: Db,
  id: string,
  to?: string,
): Promise<{ job: EmailSendJob; original: EmailLogDetail }> {
  const [row] = await db.select().from(emailLog).where(eq(emailLog.id, id)).limit(1);
  if (!row) throw notFound('Email');
  const related =
    row.relatedType && row.relatedId ? { type: row.relatedType, id: row.relatedId } : undefined;
  const job: EmailSendJob =
    row.templateKey && isTemplateKey(row.templateKey) && row.payload
      ? {
          key: row.templateKey,
          to: to ?? row.toEmail,
          toUserId: row.toUserId ?? undefined,
          locale: row.locale ?? undefined,
          data: row.payload,
          related,
          cc: row.cc.length ? row.cc : undefined,
        }
      : {
          to: to ?? row.toEmail,
          toUserId: row.toUserId ?? undefined,
          subject: row.subject,
          html: row.bodyHtml ?? undefined,
          text: row.bodyText ?? undefined,
          related,
          cc: row.cc.length ? row.cc : undefined,
        };
  const { payload: _p, ...original } = row;
  return { job, original };
}

/* ------------------------------------------------ notifications ------------------------------------------------ */

export async function listNotifications(
  db: Db,
  userId: string,
  q: NotificationQuery,
): Promise<Paginated<Notification>> {
  const where: SQL[] = [or(isNull(notifications.userId), eq(notifications.userId, userId)) as SQL];
  if (q.unread) where.push(isNull(notifications.readAt));
  if (q.level) where.push(eq(notifications.level, q.level));
  const cond = and(...where);
  const [total] = await db.select({ n: count() }).from(notifications).where(cond);
  const rows = await db
    .select()
    .from(notifications)
    .where(cond)
    .orderBy(desc(notifications.createdAt))
    .limit(q.perPage)
    .offset(pageOffset(q));
  return paginate(rows, total?.n ?? 0, q);
}

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        or(isNull(notifications.userId), eq(notifications.userId, userId)),
        isNull(notifications.readAt),
      ),
    );
  return row?.n ?? 0;
}

export async function markRead(db: Db, userId: string, id: string): Promise<Notification> {
  const [row] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, id),
        or(isNull(notifications.userId), eq(notifications.userId, userId)),
      ),
    )
    .returning();
  if (!row) throw notFound('Notification');
  return row;
}

export async function markAllRead(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        or(isNull(notifications.userId), eq(notifications.userId, userId)),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}
