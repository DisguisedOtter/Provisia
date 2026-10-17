import { OrderProductsView } from '@/components/portal/views/order/products';

export const metadata = { title: 'Products' };

export default async function Page({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  return <OrderProductsView groupSlug={group} />;
}
