import { ServiceDetailView } from '@/components/portal/views/service-detail';

export const metadata = { title: 'Service' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ServiceDetailView id={id} />;
}
