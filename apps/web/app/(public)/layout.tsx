import { ErrorBoundary } from '@/components/portal/error-boundary';
import { PortalProviders } from '@/components/portal/providers';
import { PublicShell } from '@/components/portal/shell';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProviders>
      <PublicShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </PublicShell>
    </PortalProviders>
  );
}
