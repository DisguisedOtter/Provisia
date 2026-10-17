import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseInboundEmail, stripQuotedReply } from './parse.js';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

describe('parseInboundEmail', () => {
  it('parses a reply, strips the quoted thread and finds the ticket token', async () => {
    const mail = await parseInboundEmail(await fixture('reply-with-quote.eml'));
    expect(mail.ticketNumber).toBe('1001');
    expect(mail.from).toEqual({ address: 'jan@example.com', name: 'Jan de Vries' });
    expect(mail.inReplyTo).toBe('<ticket-01932b1e-0000-7000-8000-000000000004@provisia>');
    expect(mail.isAutoReply).toBe(false);
    expect(mail.text).toBe(
      'Thanks, that fixed it! The site loads again.\n\nOne more thing: can you also raise the upload limit?',
    );
    expect(mail.fullText).toContain('wrote:');
  });

  it('parses an html-only new ticket from an unknown sender with cc', async () => {
    const mail = await parseInboundEmail(await fixture('new-ticket.eml'));
    expect(mail.ticketNumber).toBeNull();
    expect(mail.subject).toBe('Question about invoice');
    expect(mail.cc).toEqual(['boekhouding@newcustomer.example.org']);
    expect(mail.text).toContain('I did not receive invoice 2026-000042 by mail.');
    expect(mail.text).toContain('Can you resend it?');
    expect(mail.text).not.toContain('<p>');
  });

  it('extracts attachments and drops the signature', async () => {
    const mail = await parseInboundEmail(await fixture('with-attachment.eml'));
    expect(mail.text).toBe('Screenshot attached.');
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]?.filename).toBe('error.log');
    expect(mail.attachments[0]?.content.toString()).toContain('Allowed memory size exhausted');
  });

  it('flags auto-replies so they never loop', async () => {
    const mail = await parseInboundEmail(await fixture('auto-reply.eml'));
    expect(mail.isAutoReply).toBe(true);
    expect(mail.autoReplyReason).toMatch(/Auto-Submitted/);
  });

  it('strips Outlook / Dutch quoted headers', async () => {
    const mail = await parseInboundEmail(await fixture('outlook-quote.eml'));
    expect(mail.text).toBe(
      'Nog steeds kapot na het legen van de cache.\n\nMet vriendelijke groet,\nJan',
    );
  });
});

describe('stripQuotedReply', () => {
  it('keeps text when nothing is quoted', () => {
    expect(stripQuotedReply('Hello\n\nWorld')).toBe('Hello\n\nWorld');
  });
  it('removes trailing > quotes and mobile signatures', () => {
    expect(stripQuotedReply('Yes please\n\nSent from my iPhone\n\n> old\n> text')).toBe(
      'Yes please',
    );
  });
  it('cuts at "Original Message" separators', () => {
    expect(stripQuotedReply('New\n-----Original Message-----\nFrom: x')).toBe('New');
  });
});
