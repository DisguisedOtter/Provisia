import { createDb, emailLog, settings as settingsTable } from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isPermanentFailure,
  parseSmtpUrl,
  resolveMailConfig,
  sendEmail,
  testSmtp,
} from './mailer.js';
import { SAMPLE_DATA } from './samples.js';
import { loadSettings } from './settings.js';

const TEST_URL = process.env.DATABASE_URL_TEST;
const SMTP_URL = process.env.SMTP_URL ?? 'smtp://localhost:1025';
const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';

describe('smtp config', () => {
  it('parses SMTP_URL', () => {
    expect(parseSmtpUrl('smtp://localhost:1025')).toMatchObject({
      host: 'localhost',
      port: 1025,
      secure: false,
    });
    expect(parseSmtpUrl('smtps://u%40x.y:p%3Ass@mail.example.com')).toMatchObject({
      host: 'mail.example.com',
      port: 465,
      secure: true,
      auth: { user: 'u@x.y', pass: 'p:ss' },
    });
  });
  it('classifies permanent failures', () => {
    expect(isPermanentFailure({ responseCode: 550 })).toBe(true);
    expect(isPermanentFailure({ responseCode: 451 })).toBe(false);
    expect(isPermanentFailure({ code: 'ECONNREFUSED' })).toBe(false);
    expect(isPermanentFailure({ code: 'EENVELOPE' })).toBe(true);
  });
});

/**
 * Real delivery through mailpit (compose.dev.yml: SMTP :1025, UI/API :8025).
 * Run: DATABASE_URL_TEST=postgres://provisia:provisia@localhost:5432/provisia_support pnpm --filter @provisia/email test
 * Then open http://localhost:8025 to see the messages.
 */
describe.skipIf(!TEST_URL)('sendEmail via mailpit', () => {
  let client: ReturnType<typeof createDb>;
  let mailpitUp = false;

  beforeAll(async () => {
    const url = TEST_URL as string;
    await runMigrations(url);
    client = createDb(url, { max: 1 });
    await client.db
      .insert(settingsTable)
      .values({ key: 'company.name', value: 'Provisia Test' })
      .onConflictDoNothing();
    mailpitUp = await fetch(`${MAILPIT_API}/api/v1/info`)
      .then((r) => r.ok)
      .catch(() => false);
  });
  afterAll(async () => {
    await client?.close();
  });

  it('resolves settings → env fallback', async () => {
    const s = await loadSettings(client.db);
    const cfg = resolveMailConfig(s, { SMTP_URL, MAIL_FROM: 'Provisia <noreply@example.com>' });
    expect(cfg.smtp.source).toBe('env');
    expect(cfg.from.address).toBeTruthy();
  });

  it('sends a templated mail with an attachment and logs it', async () => {
    const to = `mailpit-${Date.now()}@example.test`;
    const res = await sendEmail(
      client.db,
      {
        key: 'invoice.created',
        to,
        toName: 'Jan de Vries',
        locale: 'nl',
        data: SAMPLE_DATA['invoice.created'] as unknown as Record<string, unknown>,
        attachments: [
          {
            filename: 'invoice.pdf',
            contentType: 'application/pdf',
            contentBase64: Buffer.from('%PDF-1.4 test').toString('base64'),
          },
        ],
        related: { type: 'invoice', id: '01932b1e-0000-7000-8000-000000000001' },
      },
      { env: { SMTP_URL, MAIL_FROM: 'Provisia <noreply@example.com>' } },
    );
    expect(res.status).toBe('sent');
    expect(res.messageId).toBeTruthy();
    const [row] = await client.db
      .select()
      .from(emailLog)
      .where(eq(emailLog.id, res.logId))
      .limit(1);
    expect(row).toMatchObject({
      toEmail: to,
      status: 'sent',
      templateKey: 'invoice.created',
      locale: 'nl',
      relatedType: 'invoice',
      attempts: 1,
    });
    expect(row?.subject).toBe('Factuur 2026-000042 van Provisia Test');
    expect(row?.attachments).toEqual([
      { filename: 'invoice.pdf', size: 13, contentType: 'application/pdf' },
    ]);

    if (mailpitUp) {
      const found = await fetch(
        `${MAILPIT_API}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
      ).then(
        (r) => r.json() as Promise<{ messages: Array<{ Subject: string; Attachments: number }> }>,
      );
      expect(found.messages[0]?.Subject).toBe('Factuur 2026-000042 van Provisia Test');
      expect(found.messages[0]?.Attachments).toBe(1);
    }
  });

  it('sends a raw mail and verifies SMTP', async () => {
    const res = await sendEmail(
      client.db,
      { to: 'raw@example.test', subject: 'Raw test', html: '<p>Hello <b>raw</b></p>' },
      { env: { SMTP_URL } },
    );
    expect(res.status).toBe('sent');
    const [row] = await client.db
      .select()
      .from(emailLog)
      .orderBy(desc(emailLog.createdAt))
      .limit(1);
    expect(row?.bodyText).toBe('Hello raw');
    const t = await testSmtp(client.db, { env: { SMTP_URL } });
    expect(t.ok).toBe(true);
  });

  it('records a failure when the SMTP host is unreachable (retryable)', async () => {
    const res = await sendEmail(
      client.db,
      { to: 'x@example.test', subject: 'nope', html: 'x' },
      { env: { SMTP_URL: 'smtp://127.0.0.1:1' } },
    );
    expect(res.status).toBe('failed');
    expect(res.permanent).toBeFalsy();
  });
});
