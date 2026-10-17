import { OrderConfigureView } from '@/components/portal/views/order/configure';

export const metadata = { title: 'Configure' };

export default async function Page({
  params,
}: {
  params: Promise<{ group: string; product: string }>;
}) {
  const { group, product } = await params;
  return <OrderConfigureView groupSlug={group} productSlug={product} />;
}
