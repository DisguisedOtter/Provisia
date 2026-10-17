import { describe, expect, it } from 'vitest';
import {
  canTransition,
  formatTicketNumber,
  parseTicketNumber,
  statusAfterReply,
  TICKET_TRANSITIONS,
  ticketSubjectToken,
} from './tickets.js';

describe('ticket status transitions', () => {
  it('allows the documented transitions', () => {
    expect(canTransition('open', 'answered')).toBe(true);
    expect(canTransition('open', 'closed')).toBe(true);
    expect(canTransition('answered', 'customer_reply')).toBe(true);
    expect(canTransition('customer_reply', 'answered')).toBe(true);
    expect(canTransition('on_hold', 'open')).toBe(true);
    expect(canTransition('closed', 'open')).toBe(true);
  });
  it('rejects transitions out of closed except reopen', () => {
    expect(canTransition('closed', 'answered')).toBe(false);
    expect(canTransition('closed', 'on_hold')).toBe(false);
    expect(canTransition('closed', 'customer_reply')).toBe(false);
  });
  it('treats same-state as a no-op', () => {
    for (const s of Object.keys(TICKET_TRANSITIONS) as Array<keyof typeof TICKET_TRANSITIONS>) {
      expect(canTransition(s, s)).toBe(true);
    }
  });
  it('derives the status after a reply', () => {
    expect(statusAfterReply('open', 'staff')).toBe('answered');
    expect(statusAfterReply('closed', 'staff')).toBe('answered');
    expect(statusAfterReply('open', 'client')).toBe('open');
    expect(statusAfterReply('answered', 'client')).toBe('customer_reply');
    expect(statusAfterReply('closed', 'client')).toBe('customer_reply');
    expect(statusAfterReply('on_hold', 'client')).toBe('customer_reply');
  });
});

describe('ticket numbers', () => {
  it('formats and parses the subject token', () => {
    expect(formatTicketNumber('1001')).toBe('#1001');
    expect(ticketSubjectToken(1001)).toBe('[#1001]');
    expect(parseTicketNumber('Re: [#1001] Help')).toBe('1001');
    expect(parseTicketNumber('Fwd: RE: [# 42 ] x')).toBe('42');
    expect(parseTicketNumber('no token #1001')).toBeNull();
    expect(parseTicketNumber(undefined)).toBeNull();
  });
});
