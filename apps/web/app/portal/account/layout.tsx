import { AccountLayout } from '@/components/portal/views/account/account-tabs';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <AccountLayout>{children}</AccountLayout>;
}
