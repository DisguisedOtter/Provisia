import { AuthGuard } from '@/components/auth-guard';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { ErrorBoundary } from '@/components/portal/error-boundary';
import { PortalProviders } from '@/components/portal/providers';
import { PortalShell } from '@/components/portal/shell';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProviders>
      <AuthGuard roles={['client', 'admin', 'staff']}>
        <ImpersonationBanner />
        <PortalShell>
          <ErrorBoundary>{children}</ErrorBoundary>
        </PortalShell>
      </AuthGuard>
    </PortalProviders>
  );
}
