import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clients,
  createDb,
  notifications,
  settings as settingsTable,
  ticketDepartments,
  users,
} from '@provisia/db';
import { runMigrations } from '@provisia/db/migrate';
import { seed } from '@provisia/db/seed';
import { notify } from '@provisia/email';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { hashPassword } from '../../lib/password.js';

const queued: Array<{ name: string; data: Record<string, unknown> }> = [];
vi.mock('@provisia/worker/queues', () => ({
  QUEUE_NAMES: ['billing', 'provisioning', 'domains', 'email', 'maintenance'],
  getQueue: () => ({
    add: async (name: string, data: Record<string, unknown>) => {
      queued.push({ name, data });
      return { id: 'job' };
    },
  }),
  enqueue: async (_q: string, name: string, data: Record<string, unknown>) => {
    queued.push({ name, data });
    return { id: 'job' };
  },
  closeQueues: async () => {},
}));

const TEST_URL = process.env.DATABASE_URL_TEST;
const stamp = Date.now().toString(36);
const ADMIN = { email: `tk-admin-${stamp}@example.com`, password: 'integration-pass-1' };
const CLIENT = { email: `tk-client-${stamp}@example.com`, password: 'client-pass-123' };
const ORIGIN = { origin: 'http://localhost:3000' };

describe.skipIf(!TEST_URL)('tickets + email api', () => {
  let app: FastifyInstance;
  let admin = '';
  let client = '';
  let adminId = '';
  let clientId = '';
  let deptId = '';
  let ticketId = '';
  let ticketNumber = '';

  const login = async (email: string, password: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(res.statusCode).toBe(200);
    return `pv_session=${res.cookies.find((c) => c.name === 'pv_session')?.value}`;
  };
  const call = (
    cookie: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie, ...ORIGIN },
      payload: payload as never,
    });

  beforeAll(async () => {
    const url = TEST_URL as string;
    await runMigrations(url);
    const { db, close } = createDb(url, { max: 1 });
    await seed(db, { adminEmail: ADMIN.email, adminPassword: ADMIN.password });
    const [cu] = await db
      .insert(users)
      .values({
        email: CLIENT.email,
        passwordHash: await hashPassword(CLIENT.password),
        role: 'client',
        firstName: 'Jan',
        lastName: 'de Vries',
      })
      .returning({ id: users.id });
    const [c] = await db
      .insert(clients)
      .values({ userId: cu!.id, companyName: 'Voorbeeld BV', language: 'nl' })
      .returning({ id: clients.id });
    clientId = c!.id;
    const [a] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN.email));
    adminId = a!.id;
    await db
      .insert(settingsTable)
      .values({ key: 'support.notifyEmail', value: 'team@example.com' })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: 'team@example.com' } });
    await close();
    process.env.STORAGE_PATH = await mkdtemp(path.join(os.tmpdir(), 'provisia-tickets-'));
    app = await buildApp({
      config: loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: url,
        APP_KEY: '11'.repeat(32),
        SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
      }),
      logger: false,
    });
    await app.ready();
    admin = await login(ADMIN.email, ADMIN.password);
    client = await login(CLIENT.email, CLIENT.password);
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    queued.length = 0;
  });

  it('creates a department with an encrypted mailbox and never returns the password', async () => {
    const res = await call(admin, 'POST', '/admin/tickets/departments', {
      name: `Support ${stamp}`,
      email: `support-${stamp}@example.com`,
      imapEnabled: true,
      mailbox: { imap: { host: 'imap.example.com', user: 'support', password: 'secret-imap' } },
    });
    expect(res.statusCode).toBe(201);
    const d = res.json().data;
    deptId = d.id;
    expect(d.mailbox.imap).toMatchObject({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      hasPassword: true,
    });
    expect(JSON.stringify(res.json())).not.toContain('secret-imap');
    const [row] = await app.db
      .select()
      .from(ticketDepartments)
      .where(eq(ticketDepartments.id, deptId));
    expect(row?.mailboxConfigEncrypted?.startsWith('enc:v1:')).toBe(true);

    // Update without a password keeps the stored one.
    const upd = await call(admin, 'PATCH', `/admin/tickets/departments/${deptId}`, {
      mailbox: { imap: { host: 'imap2.example.com', user: 'support' } },
    });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().data.mailbox.imap).toMatchObject({
      host: 'imap2.example.com',
      hasPassword: true,
    });
    expect(upd.json().data.mailbox.smtp).toBeNull();

    const portal = await call(client, 'GET', '/portal/tickets/departments');
    expect(portal.statusCode).toBe(200);
    expect(portal.json().data.find((x: { id: string }) => x.id === deptId)).toEqual({
      id: deptId,
      name: `Support ${stamp}`,
      description: null,
      sortOrder: 0,
    });
  });

  it('client opens a ticket: number sequence, status open, staff notified', async () => {
    const res = await call(client, 'POST', '/portal/tickets', {
      departmentId: deptId,
      subject: 'Site down',
      body: 'HTTP 500 since this morning',
      priority: 'high',
    });
    expect(res.statusCode).toBe(201);
    const t = res.json().data;
    ticketId = t.id;
    ticketNumber = t.number;
    expect(Number(t.number)).toBeGreaterThanOrEqual(1001);
    expect(t).toMatchObject({
      status: 'open',
      priority: 'high',
      clientId,
      lastReplyBy: 'client',
      replyCount: 1,
      clientName: 'Voorbeeld BV',
    });
    expect(t.replies[0].body).toBe('HTTP 500 since this morning');
    expect(t.notes).toEqual([]);
    // client gets ticket.opened (nl), unassigned → support.notifyEmail gets ticket.reply.staff
    expect(queued.map((q) => [q.data.key, q.data.to, q.data.locale])).toEqual([
      ['ticket.opened', CLIENT.email, 'nl'],
      ['ticket.reply.staff', 'team@example.com', 'en'],
    ]);
    expect((queued[0]!.data.data as { ticket: { number: string } }).ticket.number).toBe(t.number);

    const second = await call(client, 'POST', '/portal/tickets', {
      departmentId: deptId,
      subject: 'Second',
      body: 'x',
    });
    expect(Number(second.json().data.number)).toBe(Number(t.number) + 1);
  });

  it('lists with filters and search; portal sees only own tickets', async () => {
    const all = await call(
      admin,
      'GET',
      `/admin/tickets?departmentId=${deptId}&status=open&search=${ticketNumber}`,
    );
    expect(all.statusCode).toBe(200);
    expect(all.json().data.map((t: { id: string }) => t.id)).toEqual([ticketId]);
    const unassigned = await call(
      admin,
      'GET',
      `/admin/tickets?assignedToUserId=unassigned&priority=high&departmentId=${deptId}`,
    );
    expect(unassigned.json().meta.total).toBe(1);
    const mine = await call(client, 'GET', '/portal/tickets');
    expect(mine.json().data.every((t: { clientId: string }) => t.clientId === clientId)).toBe(true);
    const other = await call(client, 'GET', '/admin/tickets');
    expect(other.statusCode).toBe(403);
  });

  it('staff replies with internal note + canned response → answered, client emailed', async () => {
    const canned = await call(admin, 'POST', '/admin/tickets/canned-responses', {
      title: 'Greeting',
      body: 'Hi {{client.firstName}}, this is {{staff.firstName}} from {{company.name}}.',
    });
    expect(canned.statusCode).toBe(201);
    const preview = await call(admin, 'POST', `/admin/tickets/${ticketId}/canned-preview`, {
      cannedResponseId: canned.json().data.id,
    });
    expect(preview.json().data.body).toBe('Hi Jan, this is Admin from Provisia Demo Hosting.');

    const res = await call(admin, 'POST', `/admin/tickets/${ticketId}/replies`, {
      body: 'We raised the memory limit.',
      internalNote: 'php-fpm restarted',
      cannedResponseId: canned.json().data.id,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.ticket).toMatchObject({ status: 'answered', lastReplyBy: 'staff' });
    expect(res.json().data.ticket.firstResponseAt).toBeTruthy();
    expect(res.json().data.reply.body).toBe(
      'Hi Jan, this is Admin from Provisia Demo Hosting.\n\nWe raised the memory limit.',
    );
    expect(res.json().data.note.body).toBe('php-fpm restarted');
    expect(queued.map((q) => [q.data.key, q.data.to])).toEqual([['ticket.reply', CLIENT.email]]);

    const adminView = await call(admin, 'GET', `/admin/tickets/${ticketId}`);
    expect(adminView.json().data.notes).toHaveLength(1);
    const clientView = await call(client, 'GET', `/portal/tickets/${ticketId}`);
    expect(clientView.json().data.notes).toEqual([]);
    expect(clientView.json().data.replies).toHaveLength(2);
    expect(clientView.json().data.replies[1].authorEmail).toBeNull();
  });

  it('client reply → customer_reply and assignee/watcher get staff mail; client cannot set other statuses', async () => {
    await call(admin, 'POST', `/admin/tickets/${ticketId}/assign`, { assignedToUserId: adminId });
    const [staff2] = await app.db
      .insert(users)
      .values({
        email: `tk-staff-${stamp}@example.com`,
        passwordHash: 'x',
        role: 'staff',
        firstName: 'Sanne',
        lastName: 'S',
      })
      .returning({ id: users.id });
    const w = await call(admin, 'POST', `/admin/tickets/${ticketId}/watchers`, {
      userId: staff2!.id,
    });
    expect(w.statusCode).toBe(204);
    queued.length = 0;

    const bad = await call(client, 'POST', `/portal/tickets/${ticketId}/replies`, {
      body: 'x',
      status: 'on_hold',
    });
    expect(bad.statusCode).toBe(400);
    const res = await call(client, 'POST', `/portal/tickets/${ticketId}/replies`, {
      body: 'Still broken',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.ticket.status).toBe('customer_reply');
    expect(queued.map((q) => [q.data.key, q.data.to]).sort()).toEqual([
      ['ticket.reply.staff', ADMIN.email],
      ['ticket.reply.staff', `tk-staff-${stamp}@example.com`],
    ]);
    const detail = await call(admin, 'GET', `/admin/tickets/${ticketId}`);
    expect(detail.json().data.watchers.map((x: { userId: string }) => x.userId)).toEqual([
      staff2!.id,
    ]);
    expect(detail.json().data.assigneeName).toBe('Admin User');
  });

  it('enforces status transitions, close/reopen and priority/department changes', async () => {
    const hold = await call(admin, 'POST', `/admin/tickets/${ticketId}/status`, {
      status: 'on_hold',
    });
    expect(hold.statusCode).toBe(200);
    const bad = await call(admin, 'POST', `/admin/tickets/${ticketId}/status`, {
      status: 'customer_reply',
    });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().error.code).toBe('invalid_transition');
    const prio = await call(admin, 'PATCH', `/admin/tickets/${ticketId}`, { priority: 'urgent' });
    expect(prio.json().data.priority).toBe('urgent');

    queued.length = 0;
    const close = await call(admin, 'POST', `/admin/tickets/${ticketId}/close`);
    expect(close.json().data.status).toBe('closed');
    expect(close.json().data.closedAt).toBeTruthy();
    expect(queued.map((q) => q.data.key)).toEqual(['ticket.closed']);
    const again = await call(admin, 'POST', `/admin/tickets/${ticketId}/status`, {
      status: 'answered',
    });
    expect(again.statusCode).toBe(409);
    const reopen = await call(admin, 'POST', `/admin/tickets/${ticketId}/reopen`);
    expect(reopen.json().data.status).toBe('open');

    // client reply on a closed ticket reopens it as customer_reply
    await call(client, 'POST', `/portal/tickets/${ticketId}/close`);
    const r = await call(client, 'POST', `/portal/tickets/${ticketId}/replies`, {
      body: 'not fixed',
    });
    expect(r.json().data.ticket.status).toBe('customer_reply');
  });

  it('uploads, downloads and links attachments with limits', async () => {
    const boundary = 'XXBOUNDARY';
    const body = (name: string, type: string, content: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const headers = {
      cookie: client,
      ...ORIGIN,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    const up = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/tickets/${ticketId}/attachments`,
      headers,
      payload: body('../../etc/passwd.txt', 'text/plain', 'hello attachment'),
    });
    expect(up.statusCode).toBe(201);
    const att = up.json().data;
    expect(att.name).toBe('passwd.txt');
    expect(att.size).toBe(16);
    expect(att.path).toBeUndefined();

    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/tickets/${ticketId}/attachments`,
      headers,
      payload: body('evil.exe', 'application/octet-stream', 'MZ'),
    });
    expect(bad.statusCode).toBe(400);

    const reply = await call(client, 'POST', `/portal/tickets/${ticketId}/replies`, {
      body: 'see file',
      attachmentIds: [att.id],
    });
    expect(reply.statusCode).toBe(201);
    const detail = await call(client, 'GET', `/portal/tickets/${ticketId}`);
    const last = detail.json().data.replies.at(-1);
    expect(last.attachments[0].id).toBe(att.id);

    const dl = await app.inject({
      method: 'GET',
      url: `/api/v1/portal/tickets/${ticketId}/attachments/${att.id}/download`,
      headers: { cookie: client },
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toBe('hello attachment');
    expect(dl.headers['content-disposition']).toContain('passwd.txt');
    const adminDl = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/tickets/${ticketId}/attachments/${att.id}/download`,
      headers: { cookie: admin },
    });
    expect(adminDl.statusCode).toBe(200);
  });

  it('admin opens a guest ticket on behalf and merges tickets', async () => {
    const guest = await call(admin, 'POST', '/admin/tickets', {
      departmentId: deptId,
      subject: 'Guest question',
      body: 'hi',
      requesterEmail: 'guest@example.org',
      requesterName: 'Guest Person',
    });
    expect(guest.statusCode).toBe(201);
    expect(guest.json().data).toMatchObject({
      status: 'answered',
      clientId: null,
      requesterEmail: 'guest@example.org',
      clientName: 'Guest Person',
    });
    expect(queued.map((q) => [q.data.key, q.data.to])).toEqual([
      ['ticket.opened', 'guest@example.org'],
    ]);

    const dup = await call(client, 'POST', '/portal/tickets', {
      departmentId: deptId,
      subject: 'Site down again',
      body: 'duplicate',
    });
    const merge = await call(admin, 'POST', `/admin/tickets/${ticketId}/merge`, {
      sourceTicketIds: [dup.json().data.id],
    });
    expect(merge.statusCode).toBe(200);
    expect(merge.json().data.replies.some((r: { body: string }) => r.body === 'duplicate')).toBe(
      true,
    );
    expect(merge.json().data.notes.at(-1).body).toContain('Merged ticket');
    const src = await call(admin, 'GET', `/admin/tickets/${dup.json().data.id}`);
    expect(src.json().data).toMatchObject({ status: 'closed', mergedIntoTicketId: ticketId });
    const conflict = await call(admin, 'POST', `/admin/tickets/${dup.json().data.id}/replies`, {
      body: 'x',
    });
    expect(conflict.statusCode).toBe(409);
    const cross = await call(admin, 'POST', `/admin/tickets/${ticketId}/merge`, {
      sourceTicketIds: [guest.json().data.id],
    });
    expect(cross.statusCode).toBe(200); // guest (no client) may merge into a client ticket
  });

  it('email templates: list, override, preview, reset, test-send', async () => {
    const list = await call(admin, 'GET', '/admin/email/templates?locale=nl');
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(23);
    expect(
      list.json().data.find((t: { key: string }) => t.key === 'invoice.created'),
    ).toMatchObject({
      customized: false,
      subject: 'Factuur {{invoice.number}} van {{company.name}}',
    });

    const badSyntax = await call(admin, 'PUT', '/admin/email/templates/invoice.created/en', {
      subject: 'x',
      bodyHtml: '{{#if}}',
    });
    expect(badSyntax.statusCode).toBe(400);
    const put = await call(admin, 'PUT', '/admin/email/templates/invoice.created/en', {
      subject: 'Custom {{invoice.number}}',
      bodyHtml: '<p>{{client.firstName}} owes {{money invoice.total}}</p>',
      useLayout: false,
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().data.customized).toBe(true);
    const preview = await call(
      admin,
      'POST',
      '/admin/email/templates/invoice.created/en/preview',
      {},
    );
    expect(preview.json().data).toEqual({
      subject: 'Custom 2026-000042',
      html: '<p>Jan owes €60.39</p>',
      text: 'Jan owes €60.39',
    });
    const unsaved = await call(admin, 'POST', '/admin/email/templates/invoice.created/en/preview', {
      bodyHtml: '<i>{{invoice.number}}</i>',
      data: { invoice: { number: 'X-1', total: { amount: 1, currency: 'EUR' } } },
    });
    expect(unsaved.json().data.html).toBe('<i>X-1</i>');
    const unknown = await call(admin, 'GET', '/admin/email/templates/nope.key/en');
    expect(unknown.statusCode).toBe(404);
    const reset = await call(admin, 'DELETE', '/admin/email/templates/invoice.created/en');
    expect(reset.json().data.customized).toBe(false);

    queued.length = 0;
    const test = await call(admin, 'POST', '/admin/email/templates/service.welcome/test-send', {
      to: 'me@example.com',
      locale: 'nl',
    });
    expect(test.statusCode).toBe(202);
    expect(queued[0]?.data).toMatchObject({
      key: 'service.welcome',
      to: 'me@example.com',
      locale: 'nl',
    });
  });

  it('email log lists, filters and resends; smtp test reaches mailpit when available', async () => {
    const { emailLog } = await import('@provisia/db');
    const [row] = await app.db
      .insert(emailLog)
      .values({
        toEmail: 'log@example.com',
        templateKey: 'invoice.paid',
        locale: 'en',
        subject: 'Paid',
        bodyHtml: '<p>x</p>',
        status: 'failed',
        error: 'boom',
        relatedType: 'invoice',
        relatedId: '01932b1e-0000-7000-8000-000000000001',
        payload: {
          client: { firstName: 'A' },
          invoice: { number: '1', total: { amount: 1, currency: 'EUR' } },
        },
      })
      .returning({ id: emailLog.id });
    const list = await call(admin, 'GET', '/admin/email/log?status=failed&to=log@');
    expect(list.json().data[0]).toMatchObject({ id: row!.id, status: 'failed', error: 'boom' });
    expect(list.json().data[0].bodyHtml).toBeUndefined();
    const detail = await call(admin, 'GET', `/admin/email/log/${row!.id}`);
    expect(detail.json().data.bodyHtml).toBe('<p>x</p>');
    queued.length = 0;
    const resend = await call(admin, 'POST', `/admin/email/log/${row!.id}/resend`, {
      to: 'other@example.com',
    });
    expect(resend.statusCode).toBe(202);
    expect(queued[0]?.data).toMatchObject({
      key: 'invoice.paid',
      to: 'other@example.com',
      related: { type: 'invoice' },
    });

    const smtp = await call(admin, 'POST', '/admin/email/smtp/test', {
      to: 'smtp-test@example.com',
    });
    expect(smtp.statusCode).toBe(200);
    expect(typeof smtp.json().data.ok).toBe('boolean');
  });

  it('notifications: notify() helper, list, unread count, mark read', async () => {
    const n = await notify(app.db, {
      level: 'error',
      type: 'provisioning.failed',
      title: 'cPanel failed',
      body: 'boom',
      link: '/admin/services/x',
    });
    expect(n?.id).toBeTruthy();
    await notify(app.db, { userId: adminId, type: 'ticket.assigned', title: 'Assigned to you' });
    const list = await call(admin, 'GET', '/admin/notifications?unread=true');
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((x: { title: string }) => x.title)).toEqual([
      'Assigned to you',
      'cPanel failed',
    ]);
    const count = await call(admin, 'GET', '/admin/notifications/unread-count');
    expect(count.json().data.unread).toBeGreaterThanOrEqual(2);
    const read = await call(admin, 'POST', `/admin/notifications/${n!.id}/read`);
    expect(read.json().data.readAt).toBeTruthy();
    const all = await call(admin, 'POST', '/admin/notifications/read-all');
    expect(all.json().data.updated).toBeGreaterThanOrEqual(1);
    expect((await call(admin, 'GET', '/admin/notifications/unread-count')).json().data.unread).toBe(
      0,
    );
    // invalid input never throws
    expect(await notify(app.db, { type: '', title: '' })).toBeNull();
    const [row] = await app.db.select().from(notifications).where(eq(notifications.id, n!.id));
    expect(row?.level).toBe('error');
  });
});
