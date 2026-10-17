import multipart from '@fastify/multipart';
import type { EmailSendJob } from '@provisia/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { activityLog } from '../../lib/activity-log.js';
import { requireClient, requirePermission, requireStaff } from '../../lib/auth.js';
import { badRequest, forbidden, unauthorized } from '../../lib/errors.js';
import { queueEmails } from '../email/queue.js';
import {
  addWatcherSchema,
  assignTicketSchema,
  cannedQuerySchema,
  cannedResponseSchema,
  createCannedResponseSchema,
  createTicketDepartmentSchema,
  createTicketNoteSchema,
  createTicketReplySchema,
  createTicketSchema,
  dataSchema,
  idParamsSchema,
  mailboxTestResultSchema,
  mergeTicketsSchema,
  paginatedSchema,
  portalReplySchema,
  portalTicketListQuerySchema,
  publicTicketDepartmentSchema,
  renderCannedSchema,
  renderedCannedSchema,
  setTicketStatusSchema,
  ticketAttachmentSchema,
  ticketDepartmentSchema,
  ticketDetailSchema,
  ticketListItemSchema,
  ticketListQuerySchema,
  ticketNoteSchema,
  ticketReplySchema,
  ticketSchema,
  ticketSubParamsSchema,
  updateCannedResponseSchema,
  updateTicketDepartmentSchema,
  updateTicketSchema,
} from './schemas.js';
import {
  addWatcher,
  closeTicket,
  createCannedResponse,
  createDepartment,
  createNote,
  createTicket,
  deleteAttachment,
  deleteCannedResponse,
  deleteDepartment,
  deleteNote,
  getDepartment,
  getTicket,
  listCannedResponses,
  listDepartments,
  listTickets,
  loadTicket,
  mergeTickets,
  openAttachment,
  removeWatcher,
  renderCannedResponse,
  reopenTicket,
  replyToTicket,
  testDepartmentMailbox,
  updateCannedResponse,
  updateDepartment,
  updateTicket,
  uploadAttachment,
} from './service.js';

const replyResponseSchema = dataSchema(
  z.object({ ticket: ticketSchema, reply: ticketReplySchema, note: ticketNoteSchema.nullable() }),
);

const routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(multipart, { limits: { files: 1, fileSize: 100 * 1024 * 1024, fields: 5 } });
  const env = () => ({ appUrl: app.config.APP_URL, webUrl: app.config.WEB_URL });
  const user = (req: { auth: { user: import('@provisia/shared').AuthUser } | null }) => {
    if (!req.auth) throw unauthorized();
    return req.auth.user;
  };
  const dispatch = async (jobs: EmailSendJob[], log: { warn: (o: object, m: string) => void }) => {
    if (!jobs.length) return;
    try {
      await queueEmails(jobs);
    } catch (err) {
      log.warn({ err, count: jobs.length }, 'could not enqueue ticket emails');
    }
  };
  const T = ['tickets'];

  /* ------------------------------------------ admin: departments ------------------------------------------ */

  app.get(
    '/admin/tickets/departments',
    {
      preHandler: requirePermission('tickets.read'),
      schema: { tags: T, response: { 200: dataSchema(z.array(ticketDepartmentSchema)) } },
    },
    async () => ({
      data: await listDepartments(app.db, { includeHidden: true }),
    }),
  );

  app.post(
    '/admin/tickets/departments',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        body: createTicketDepartmentSchema,
        response: { 201: dataSchema(ticketDepartmentSchema) },
      },
    },
    async (req, reply) => {
      const d = await createDepartment(app.db, req.body);
      await activityLog(req, {
        action: 'ticket_department.create',
        entityType: 'ticket_department',
        entityId: d.id,
      });
      return reply.status(201).send({ data: d });
    },
  );

  app.get(
    '/admin/tickets/departments/:id',
    {
      preHandler: requirePermission('tickets.read'),
      schema: {
        tags: T,
        params: idParamsSchema,
        response: { 200: dataSchema(ticketDepartmentSchema) },
      },
    },
    async (req) => ({
      data: await getDepartment(app.db, req.params.id),
    }),
  );

  app.patch(
    '/admin/tickets/departments/:id',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: updateTicketDepartmentSchema,
        response: { 200: dataSchema(ticketDepartmentSchema) },
      },
    },
    async (req) => {
      const d = await updateDepartment(app.db, req.params.id, req.body);
      const { mailbox: _m, ...diff } = req.body;
      await activityLog(req, {
        action: 'ticket_department.update',
        entityType: 'ticket_department',
        entityId: d.id,
        diff: { after: diff, mailboxChanged: req.body.mailbox !== undefined },
      });
      return { data: d };
    },
  );

  app.delete(
    '/admin/tickets/departments/:id',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteDepartment(app.db, req.params.id);
      await activityLog(req, {
        action: 'ticket_department.delete',
        entityType: 'ticket_department',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/admin/tickets/departments/:id/test-mailbox',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        summary: 'Connects to the department IMAP mailbox',
        params: idParamsSchema,
        response: { 200: dataSchema(mailboxTestResultSchema) },
      },
    },
    async (req) => ({ data: await testDepartmentMailbox(app.db, req.params.id) }),
  );

  /* ------------------------------------------ admin: canned responses ------------------------------------------ */

  app.get(
    '/admin/tickets/canned-responses',
    {
      preHandler: requirePermission('tickets.read'),
      schema: {
        tags: T,
        querystring: cannedQuerySchema,
        response: { 200: dataSchema(z.array(cannedResponseSchema)) },
      },
    },
    async (req) => ({
      data: await listCannedResponses(app.db, req.query.departmentId),
    }),
  );
  app.post(
    '/admin/tickets/canned-responses',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        body: createCannedResponseSchema,
        response: { 201: dataSchema(cannedResponseSchema) },
      },
    },
    async (req, reply) => {
      const c = await createCannedResponse(app.db, req.body);
      await activityLog(req, {
        action: 'canned_response.create',
        entityType: 'canned_response',
        entityId: c.id,
      });
      return reply.status(201).send({ data: c });
    },
  );
  app.patch(
    '/admin/tickets/canned-responses/:id',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: updateCannedResponseSchema,
        response: { 200: dataSchema(cannedResponseSchema) },
      },
    },
    async (req) => {
      const c = await updateCannedResponse(app.db, req.params.id, req.body);
      await activityLog(req, {
        action: 'canned_response.update',
        entityType: 'canned_response',
        entityId: c.id,
      });
      return { data: c };
    },
  );
  app.delete(
    '/admin/tickets/canned-responses/:id',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: idParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteCannedResponse(app.db, req.params.id);
      await activityLog(req, {
        action: 'canned_response.delete',
        entityType: 'canned_response',
        entityId: req.params.id,
      });
      return reply.status(204).send(null);
    },
  );

  /* ------------------------------------------ admin: tickets ------------------------------------------ */

  app.get(
    '/admin/tickets',
    {
      preHandler: requirePermission('tickets.read'),
      schema: {
        tags: T,
        querystring: ticketListQuerySchema,
        response: { 200: paginatedSchema(ticketListItemSchema) },
      },
    },
    async (req) => listTickets(app.db, req.query, { internal: true, userId: user(req).id }),
  );

  app.post(
    '/admin/tickets',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        summary: 'Open a ticket on behalf of a client or guest',
        body: createTicketSchema,
        response: { 201: dataSchema(ticketDetailSchema) },
      },
    },
    async (req, reply) => {
      const { ticket, emails } = await createTicket(app.db, req.body, user(req), env());
      await activityLog(req, {
        action: 'ticket.create',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { number: ticket.number },
      });
      await dispatch(emails, req.log);
      return reply
        .status(201)
        .send({ data: await getTicket(app.db, ticket.id, { internal: true }) });
    },
  );

  app.get(
    '/admin/tickets/:id',
    {
      preHandler: requirePermission('tickets.read'),
      schema: {
        tags: T,
        params: idParamsSchema,
        response: { 200: dataSchema(ticketDetailSchema) },
      },
    },
    async (req) => ({
      data: await getTicket(app.db, req.params.id, { internal: true }),
    }),
  );

  app.patch(
    '/admin/tickets/:id',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        summary: 'Change subject/priority/department/assignee/status/references',
        params: idParamsSchema,
        body: updateTicketSchema,
        response: { 200: dataSchema(ticketDetailSchema) },
      },
    },
    async (req) => {
      const { ticket, before, emails } = await updateTicket(
        app.db,
        req.params.id,
        req.body,
        user(req),
        env(),
      );
      await activityLog(req, {
        action: 'ticket.update',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { before: pick(before, req.body), after: req.body },
      });
      await dispatch(emails, req.log);
      return { data: await getTicket(app.db, ticket.id, { internal: true }) };
    },
  );

  app.post(
    '/admin/tickets/:id/replies',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: createTicketReplySchema,
        response: { 201: replyResponseSchema },
      },
    },
    async (req, reply) => {
      const res = await replyToTicket(
        app.db,
        req.params.id,
        req.body,
        user(req),
        { internal: true },
        env(),
      );
      await activityLog(req, {
        action: 'ticket.reply',
        entityType: 'ticket',
        entityId: res.ticket.id,
        diff: { replyId: res.reply.id, status: res.ticket.status },
      });
      await dispatch(res.emails, req.log);
      return reply.status(201).send({
        data: { ticket: res.ticket, reply: { ...res.reply, attachments: [] }, note: res.note },
      });
    },
  );

  app.post(
    '/admin/tickets/:id/assign',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: assignTicketSchema,
        response: { 200: dataSchema(ticketSchema) },
      },
    },
    async (req) => {
      const { ticket } = await updateTicket(
        app.db,
        req.params.id,
        { assignedToUserId: req.body.assignedToUserId },
        user(req),
        env(),
      );
      await activityLog(req, {
        action: 'ticket.assign',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { assignedToUserId: req.body.assignedToUserId },
      });
      return { data: ticket };
    },
  );

  app.post(
    '/admin/tickets/:id/status',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: setTicketStatusSchema,
        response: { 200: dataSchema(ticketSchema) },
      },
    },
    async (req) => {
      const { ticket, before, emails } = await updateTicket(
        app.db,
        req.params.id,
        { status: req.body.status },
        user(req),
        env(),
      );
      await activityLog(req, {
        action: 'ticket.status',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { before: before.status, after: ticket.status },
      });
      await dispatch(emails, req.log);
      return { data: ticket };
    },
  );

  app.post(
    '/admin/tickets/:id/close',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: idParamsSchema, response: { 200: dataSchema(ticketSchema) } },
    },
    async (req) => {
      const { ticket, emails } = await closeTicket(
        app.db,
        req.params.id,
        user(req),
        { internal: true },
        env(),
      );
      await activityLog(req, { action: 'ticket.close', entityType: 'ticket', entityId: ticket.id });
      await dispatch(emails, req.log);
      return { data: ticket };
    },
  );

  app.post(
    '/admin/tickets/:id/reopen',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: idParamsSchema, response: { 200: dataSchema(ticketSchema) } },
    },
    async (req) => {
      const ticket = await reopenTicket(app.db, req.params.id, { internal: true });
      await activityLog(req, {
        action: 'ticket.reopen',
        entityType: 'ticket',
        entityId: ticket.id,
      });
      return { data: ticket };
    },
  );

  app.post(
    '/admin/tickets/:id/merge',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        summary: 'Merge other tickets into this one',
        params: idParamsSchema,
        body: mergeTicketsSchema,
        response: { 200: dataSchema(ticketDetailSchema) },
      },
    },
    async (req) => {
      const ticket = await mergeTickets(app.db, req.params.id, req.body.sourceTicketIds, user(req));
      await activityLog(req, {
        action: 'ticket.merge',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { sources: req.body.sourceTicketIds },
      });
      return { data: await getTicket(app.db, ticket.id, { internal: true }) };
    },
  );

  app.post(
    '/admin/tickets/:id/canned-preview',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        summary: 'Render a canned response for this ticket',
        params: idParamsSchema,
        body: renderCannedSchema,
        response: { 200: dataSchema(renderedCannedSchema) },
      },
    },
    async (req) => {
      const t = await loadTicket(app.db, req.params.id, { internal: true });
      return {
        data: { body: await renderCannedResponse(app.db, req.body.cannedResponseId, t, user(req)) },
      };
    },
  );

  app.post(
    '/admin/tickets/:id/notes',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: createTicketNoteSchema,
        response: { 201: dataSchema(ticketNoteSchema) },
      },
    },
    async (req, reply) => {
      const note = await createNote(app.db, req.params.id, user(req), req.body.body);
      await activityLog(req, {
        action: 'ticket.note',
        entityType: 'ticket',
        entityId: req.params.id,
        diff: { noteId: note.id },
      });
      return reply.status(201).send({ data: note });
    },
  );
  app.delete(
    '/admin/tickets/:id/notes/:subId',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: ticketSubParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteNote(app.db, req.params.id, req.params.subId);
      await activityLog(req, {
        action: 'ticket.note_delete',
        entityType: 'ticket',
        entityId: req.params.id,
        diff: { noteId: req.params.subId },
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/admin/tickets/:id/watchers',
    {
      preHandler: requirePermission('tickets.write'),
      schema: {
        tags: T,
        params: idParamsSchema,
        body: addWatcherSchema,
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      await addWatcher(app.db, req.params.id, req.body.userId);
      await activityLog(req, {
        action: 'ticket.watch',
        entityType: 'ticket',
        entityId: req.params.id,
        diff: { userId: req.body.userId },
      });
      return reply.status(204).send(null);
    },
  );
  app.delete(
    '/admin/tickets/:id/watchers/:subId',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: ticketSubParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await removeWatcher(app.db, req.params.id, req.params.subId);
      await activityLog(req, {
        action: 'ticket.unwatch',
        entityType: 'ticket',
        entityId: req.params.id,
        diff: { userId: req.params.subId },
      });
      return reply.status(204).send(null);
    },
  );

  /* ------------------------------------------ attachments (admin + portal) ------------------------------------------ */

  for (const [prefix, guard, internal] of [
    ['/admin', requireStaff, true],
    ['/portal', requireClient, false],
  ] as const) {
    const scope = (req: { auth: { user: import('@provisia/shared').AuthUser } | null }) => {
      if (internal) return { internal: true };
      const clientId = user(req).clientId;
      // Without a client record the scope would be unfiltered; never fall through to that.
      if (!clientId) throw forbidden('No client account');
      return { internal: false, clientId };
    };

    app.post(
      `${prefix}/tickets/:id/attachments`,
      {
        preHandler: guard,
        schema: {
          tags: T,
          summary: 'multipart/form-data upload (field `file`); link via attachmentIds on reply',
          consumes: ['multipart/form-data'],
          params: idParamsSchema,
          response: { 201: dataSchema(ticketAttachmentSchema) },
        },
      },
      async (req, reply) => {
        const u = user(req);
        if (!internal && !u.clientId) throw forbidden();
        const file = await req.file();
        if (!file) throw badRequest('No file uploaded (field `file`)');
        const att = await uploadAttachment(
          app.db,
          req.params.id,
          { filename: file.filename, mimetype: file.mimetype, stream: file.file },
          u,
          scope(req),
        );
        if (file.file.truncated) throw badRequest('File truncated');
        await activityLog(req, {
          action: 'ticket.attachment_upload',
          entityType: 'ticket',
          entityId: req.params.id,
          diff: { attachmentId: att.id, name: att.name, size: att.size },
        });
        return reply.status(201).send({ data: att });
      },
    );

    app.get(
      `${prefix}/tickets/:id/attachments/:subId/download`,
      { preHandler: guard, schema: { tags: T, params: ticketSubParamsSchema } },
      async (req, reply) => {
        const f = await openAttachment(app.db, req.params.id, req.params.subId, scope(req));
        return reply
          .header('content-type', f.mimeType)
          .header('content-length', f.size)
          .header('content-disposition', f.disposition)
          .header('x-content-type-options', 'nosniff')
          .send(f.stream);
      },
    );
  }

  app.delete(
    '/admin/tickets/:id/attachments/:subId',
    {
      preHandler: requirePermission('tickets.write'),
      schema: { tags: T, params: ticketSubParamsSchema, response: { 204: z.null() } },
    },
    async (req, reply) => {
      await deleteAttachment(app.db, req.params.id, req.params.subId);
      await activityLog(req, {
        action: 'ticket.attachment_delete',
        entityType: 'ticket',
        entityId: req.params.id,
        diff: { attachmentId: req.params.subId },
      });
      return reply.status(204).send(null);
    },
  );

  /* ------------------------------------------ portal ------------------------------------------ */

  const portalScope = (req: { auth: { user: import('@provisia/shared').AuthUser } | null }) => {
    const u = user(req);
    if (!u.clientId) throw forbidden('No client account');
    return { internal: false, clientId: u.clientId };
  };

  app.get(
    '/portal/tickets/departments',
    {
      preHandler: requireClient,
      schema: { tags: T, response: { 200: dataSchema(z.array(publicTicketDepartmentSchema)) } },
    },
    async () => ({
      data: (await listDepartments(app.db, { includeHidden: false })).map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        sortOrder: d.sortOrder,
      })),
    }),
  );

  app.get(
    '/portal/tickets',
    {
      preHandler: requireClient,
      schema: {
        tags: T,
        querystring: portalTicketListQuerySchema,
        response: { 200: paginatedSchema(ticketListItemSchema) },
      },
    },
    async (req) =>
      listTickets(app.db, { ...req.query, sort: 'lastReplyAt', order: 'desc' }, portalScope(req)),
  );

  app.post(
    '/portal/tickets',
    {
      preHandler: requireClient,
      schema: {
        tags: T,
        body: createTicketSchema.omit({
          clientId: true,
          requesterEmail: true,
          requesterName: true,
          assignedToUserId: true,
        }),
        response: { 201: dataSchema(ticketDetailSchema) },
      },
    },
    async (req, reply) => {
      const scope = portalScope(req);
      const { ticket, emails } = await createTicket(
        app.db,
        { ...req.body, attachmentIds: [] },
        user(req),
        env(),
      );
      await activityLog(req, {
        action: 'ticket.create',
        entityType: 'ticket',
        entityId: ticket.id,
        diff: { number: ticket.number },
      });
      await dispatch(emails, req.log);
      return reply.status(201).send({ data: await getTicket(app.db, ticket.id, scope) });
    },
  );

  app.get(
    '/portal/tickets/:id',
    {
      preHandler: requireClient,
      schema: {
        tags: T,
        params: idParamsSchema,
        response: { 200: dataSchema(ticketDetailSchema) },
      },
    },
    async (req) => ({
      data: await getTicket(app.db, req.params.id, portalScope(req)),
    }),
  );

  app.post(
    '/portal/tickets/:id/replies',
    {
      preHandler: requireClient,
      schema: {
        tags: T,
        params: idParamsSchema,
        body: portalReplySchema,
        response: { 201: replyResponseSchema },
      },
    },
    async (req, reply) => {
      const res = await replyToTicket(
        app.db,
        req.params.id,
        { ...req.body, internalNote: undefined, cannedResponseId: undefined },
        user(req),
        portalScope(req),
        env(),
      );
      await activityLog(req, {
        action: 'ticket.reply',
        entityType: 'ticket',
        entityId: res.ticket.id,
        diff: { replyId: res.reply.id, status: res.ticket.status },
      });
      await dispatch(res.emails, req.log);
      return reply.status(201).send({
        data: { ticket: res.ticket, reply: { ...res.reply, attachments: [] }, note: null },
      });
    },
  );

  app.post(
    '/portal/tickets/:id/close',
    {
      preHandler: requireClient,
      schema: { tags: T, params: idParamsSchema, response: { 200: dataSchema(ticketSchema) } },
    },
    async (req) => {
      const { ticket, emails } = await closeTicket(
        app.db,
        req.params.id,
        user(req),
        portalScope(req),
        env(),
      );
      await activityLog(req, { action: 'ticket.close', entityType: 'ticket', entityId: ticket.id });
      await dispatch(emails, req.log);
      return { data: ticket };
    },
  );
};

function pick<T extends object>(obj: T, keys: object): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(keys) as Array<keyof T>) if (k in obj) out[k] = obj[k];
  return out;
}

export default routes;
