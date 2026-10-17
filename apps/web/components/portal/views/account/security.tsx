'use client';

import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLogout, useMe } from '@/lib/auth';
import { useI18n } from '@/lib/portal/i18n';

/**
 * Security entry points. The pages themselves (password change, 2FA enrolment, sessions) are owned by the
 * auth agent; the routes below are the conventional paths listed in ENDPOINTS.md ("Web routes").
 */
export function SecurityView() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const logout = useLogout();
  const totpEnabled = Boolean((me as { totpEnabled?: boolean } | null | undefined)?.totpEnabled);
  const rows = [
    {
      icon: KeyRound,
      title: t('account.changePassword'),
      hint: t('account.changePasswordHint'),
      href: '/account/password',
    },
    {
      icon: ShieldCheck,
      title: t('account.twoFactor'),
      hint: t('account.twoFactorHint'),
      href: '/account/two-factor',
      badge: totpEnabled ? t('common.on') : t('common.off'),
    },
    {
      icon: MonitorSmartphone,
      title: t('account.sessions'),
      hint: t('account.sessionsHint'),
      href: '/account/sessions',
    },
  ];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-medium">{t('account.security')}</h2>
        <p className="text-muted-foreground text-sm">{t('account.securityHint')}</p>
      </div>
      <Card className="divide-y p-0">
        {rows.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/50"
          >
            <r.icon className="size-5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-sm">{r.title}</div>
              <div className="text-muted-foreground text-xs">{r.hint}</div>
            </div>
            {r.badge ? (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{r.badge}</span>
            ) : null}
          </Link>
        ))}
        <div className="flex items-center gap-4 px-4 py-3">
          <LogOut className="size-5 text-muted-foreground" />
          <div className="flex-1 truncate text-sm">{me?.email}</div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            {t('account.logout')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
