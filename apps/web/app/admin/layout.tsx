import { AdminShell } from '@/components/admin/shell/admin-shell';
import { AuthGuard } from '@/components/auth-guard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard roles={['admin', 'staff']}>
      <AdminShell>{children}</AdminShell>
    </AuthGuard>
  );
}
