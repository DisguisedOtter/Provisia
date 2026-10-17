'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { adminApi } from '@/lib/admin/api';
import { errorMessage, isMissingEndpoint } from '@/lib/admin/form-errors';
import { clientDisplayName } from '@/lib/admin/format';
import { CLIENT_STATUS } from '@/lib/admin/status';
import { ME_KEY } from '@/lib/auth';
import { ActivityLogTable } from '../activity-log';
import { ConfirmDialog } from '../confirm-dialog';
import { DomainTable } from '../domains/domain-table';
import { EmailLogTable } from '../email-log';
import { InvoiceTable } from '../invoices/invoice-table';
import { AdminPageHeader } from '../page-header';
import { QueryState } from '../query-state';
import { ServiceTable } from '../services/service-table';
import { StatusBadge } from '../status-badge';
import { TicketTable } from '../tickets/ticket-table';
import { TransactionTable } from '../transactions/transaction-table';
import { ClientContacts } from './client-contacts';
import { ClientNotes } from './client-notes';
import { ClientSummary } from './client-summary';

const TABS = [
  'summary',
  'contacts',
  'services',
  'domains',
  'invoices',
  'transactions',
  'tickets',
  'emails',
  'activity',
  'notes',
] as const;

export function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '')
    ? (sp.get('tab') as string)
    : 'summary';
  const [deleteOpen, setDeleteOpen] = useState(false);

  const q = useQuery({ queryKey: ['clients', id], queryFn: () => adminApi.clients.get(id) });
  const client = q.data?.data;

  const loginAs = useMutation({
    mutationFn: () => adminApi.clients.loginAs(client?.userId as string),
    onSuccess: (res) => {
      qc.removeQueries({ queryKey: ME_KEY });
      const url = (res?.data as { redirectUrl?: string } | null)?.redirectUrl ?? '/portal';
      window.open(url, '_blank', 'noopener');
      toast.success('Impersonation session started in a new tab');
    },
    onError: (err) =>
      toast.error(
        isMissingEndpoint(err)
          ? 'Login-as is not available yet (auth endpoint missing)'
          : errorMessage(err),
      ),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.clients.remove(id),
    onSuccess: () => {
      toast.success('Client deleted');
      qc.invalidateQueries({ queryKey: ['clients'] });
      router.push('/admin/clients');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setTab = (t: string) => {
    const next = new URLSearchParams();
    if (t !== 'summary') next.set('tab', t);
    router.replace(`/admin/clients/${id}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <>
      <AdminPageHeader
        crumbs={[
          { label: 'Clients', href: '/admin/clients' },
          { label: client ? clientDisplayName(client) : '…' },
        ]}
        title={client ? clientDisplayName(client) : 'Client'}
        description={client?.email}
        badges={client ? <StatusBadge value={client.status} map={CLIENT_STATUS} /> : null}
        actions={
          client ? (
            <>
              <Button
                variant="outline"
                onClick={() => loginAs.mutate()}
                disabled={loginAs.isPending}
              >
                <LogIn /> Login as client
              </Button>
              <Button asChild>
                <Link href={`/admin/clients/${id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="More actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/invoices/new?clientId=${id}`}>
                      <Plus /> New invoice
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/tickets/new?clientId=${id}`}>
                      <Plus /> New ticket
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href={`/admin/services?clientId=${id}&new=1`}>
                      <Plus /> New service
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete client
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null
        }
      />
      <QueryState isPending={q.isPending} error={q.error} refetch={q.refetch}>
        {client ? (
          <Tabs value={tab} onValueChange={setTab}>
            <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
              <TabsList variant="line" className="w-max">
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="contacts">Contacts</TabsTrigger>
                <TabsTrigger value="services">Services</TabsTrigger>
                <TabsTrigger value="domains">Domains</TabsTrigger>
                <TabsTrigger value="invoices">Invoices</TabsTrigger>
                <TabsTrigger value="transactions">Transactions</TabsTrigger>
                <TabsTrigger value="tickets">Tickets</TabsTrigger>
                <TabsTrigger value="emails">Emails</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>
            </div>
            <div className="mt-4">
              <TabsContent value="summary">
                <ClientSummary client={client} />
              </TabsContent>
              <TabsContent value="contacts">
                <ClientContacts clientId={id} />
              </TabsContent>
              <TabsContent value="services">
                <ServiceTable clientId={id} />
              </TabsContent>
              <TabsContent value="domains">
                <DomainTable clientId={id} />
              </TabsContent>
              <TabsContent value="invoices">
                <InvoiceTable
                  clientId={id}
                  toolbar={
                    <Button asChild size="sm">
                      <Link href={`/admin/invoices/new?clientId=${id}`}>
                        <Plus /> New invoice
                      </Link>
                    </Button>
                  }
                />
              </TabsContent>
              <TabsContent value="transactions">
                <TransactionTable clientId={id} />
              </TabsContent>
              <TabsContent value="tickets">
                <TicketTable
                  clientId={id}
                  toolbar={
                    <Button asChild size="sm">
                      <Link href={`/admin/tickets/new?clientId=${id}`}>
                        <Plus /> New ticket
                      </Link>
                    </Button>
                  }
                />
              </TabsContent>
              <TabsContent value="emails">
                <EmailLogTable to={client.email} />
              </TabsContent>
              <TabsContent value="activity">
                <ActivityLogTable entityType="client" entityId={id} />
              </TabsContent>
              <TabsContent value="notes">
                <ClientNotes clientId={id} />
              </TabsContent>
            </div>
          </Tabs>
        ) : null}
      </QueryState>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this client?"
        description="Only possible when the client has no invoices. Services, domains and tickets will be removed."
        destructive
        confirmLabel="Delete client"
        typeToConfirm={client?.email}
        loading={remove.isPending}
        onConfirm={() => remove.mutateAsync()}
      />
    </>
  );
}
