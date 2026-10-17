import { EMAIL_TEMPLATE_KEYS } from '@provisia/shared';
import { describe, expect, it } from 'vitest';
import { htmlToText, renderEmail, renderString, validateTemplateSyntax } from './render.js';
import { SAMPLE_DATA } from './samples.js';
import { TEMPLATE_VARIABLES } from './templates/index.js';

const company = {
  name: 'Provisia Demo',
  address: 'Keizersgracht 1, Amsterdam',
  website: 'https://example.com',
};

describe('renderEmail', () => {
  for (const key of EMAIL_TEMPLATE_KEYS) {
    for (const locale of ['en', 'nl'] as const) {
      it(`renders ${key} (${locale})`, () => {
        const out = renderEmail({
          key,
          locale,
          data: SAMPLE_DATA[key] as unknown as Record<string, unknown>,
          company,
        });
        expect(out.subject.length).toBeGreaterThan(3);
        expect(out.subject).not.toMatch(/\{\{|undefined|\[object/);
        expect(out.html).not.toMatch(/\{\{|undefined|\[object/);
        expect(out.html).toContain('Provisia Demo');
        expect(out.text.length).toBeGreaterThan(10);
        expect({ subject: out.subject, text: out.text }).toMatchSnapshot();
      });
    }
    it(`${key} has a variables list`, () => {
      expect(TEMPLATE_VARIABLES[key].length).toBeGreaterThan(0);
    });
  }

  it('formats money and dates per locale', () => {
    const en = renderEmail({
      key: 'invoice.created',
      locale: 'en',
      data: SAMPLE_DATA['invoice.created'] as unknown as Record<string, unknown>,
      company,
    });
    const nl = renderEmail({
      key: 'invoice.created',
      locale: 'nl',
      data: SAMPLE_DATA['invoice.created'] as unknown as Record<string, unknown>,
      company,
    });
    expect(en.html).toContain('€60.39');
    expect(nl.html).toMatch(/€\s60,39/);
    expect(en.html).toContain('15 March 2026');
    expect(nl.html).toContain('15 maart 2026');
  });

  it('uses admin overrides and skips the layout when asked', () => {
    const out = renderEmail({
      key: 'ticket.closed',
      locale: 'en',
      data: SAMPLE_DATA['ticket.closed'] as unknown as Record<string, unknown>,
      company,
      override: {
        subject: 'Bye {{ticket.number}}',
        bodyHtml: '<b>{{recipient.firstName}}</b>',
        useLayout: false,
      },
    });
    expect(out).toEqual({ subject: 'Bye 1001', html: '<b>Jan</b>', text: 'Jan' });
  });

  it('escapes html in data and blocks prototype access', () => {
    expect(renderString('{{x}}', { x: '<script>' })).toBe('&lt;script&gt;');
    expect(renderString('{{x.constructor.name}}', { x: {} })).toBe('');
    expect(renderString('{{lookup this "__proto__"}}', {})).toBe('');
  });

  it('reports syntax errors', () => {
    expect(validateTemplateSyntax('{{#if x}}')).toMatch(/if/);
    expect(validateTemplateSyntax('{{x}}')).toBeNull();
  });

  it('falls back to en for unknown locales', () => {
    const out = renderEmail({
      key: 'auth.welcome',
      locale: 'de-DE',
      data: SAMPLE_DATA['auth.welcome'] as unknown as Record<string, unknown>,
      company,
    });
    expect(out.subject).toBe('Welcome to Provisia Demo');
  });

  it('htmlToText keeps links readable', () => {
    expect(htmlToText('<p>Go <a href="https://x.y">here</a><br>now</p>')).toBe(
      'Go here (https://x.y)\nnow',
    );
  });
});
