'use client';

import { NavLink } from '@/components/nav-link';
import { useI18n } from '@/lib/portal/i18n';
import { PageHeader } from '../../page-header';

const TABS = [
  { href: '/portal/account', key: 'account.tab.profile' },
  { href: '/portal/account/contacts', key: 'account.tab.contacts' },
  { href: '/portal/account/payment-methods', key: 'account.tab.methods' },
  { href: '/portal/account/emails', key: 'account.tab.emails' },
  { href: '/portal/account/security', key: 'account.tab.security' },
] as const;

export function AccountLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div>
      <PageHeader title={t('account.title')} description={t('account.description')} />
      <nav className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.href}
            href={tab.href}
            className="-mb-px whitespace-nowrap border-transparent border-b-2 px-3 py-2 text-muted-foreground text-sm hover:text-foreground"
            activeClassName="border-foreground text-foreground font-medium"
          >
            {t(tab.key)}
          </NavLink>
        ))}
      </nav>
      {children}
    </div>
  );
}
