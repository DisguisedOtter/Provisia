import { TicketDetailView } from '@/components/portal/views/ticket-detail';

export const metadata = { title: 'Ticket' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TicketDetailView id={id} />;
}
