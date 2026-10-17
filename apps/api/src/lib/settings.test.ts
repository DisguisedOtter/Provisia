import { SECRET_MASK, settingsGroups } from '@provisia/shared';
import { describe, expect, it } from 'vitest';
import { maskSecrets } from './settings.js';

describe('settings masking (unit)', () => {
  it('masks non-empty secrets and leaves empty ones empty', () => {
    const mail = settingsGroups.mail.parse({ smtpPassword: 'hunter2', smtpHost: 'smtp.example' });
    const masked = maskSecrets('mail', mail);
    expect(masked.smtpPassword).toBe(SECRET_MASK);
    expect(masked.smtpHost).toBe('smtp.example');
    const empty = maskSecrets('mail', settingsGroups.mail.parse({}));
    expect(empty.smtpPassword).toBe('');
  });

  it('does not touch groups without secrets', () => {
    const billing = settingsGroups.billing.parse({});
    expect(maskSecrets('billing', billing)).toEqual(billing);
  });
});
