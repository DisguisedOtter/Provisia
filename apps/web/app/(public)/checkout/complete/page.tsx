import { CheckoutCompleteView } from '@/components/portal/views/order/checkout';

export const metadata = { title: 'Order placed', robots: { index: false, follow: false } };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ number?: string; invoice?: string }>;
}) {
  const { number, invoice } = await searchParams;
  return <CheckoutCompleteView orderNumber={number ?? ''} invoiceId={invoice ?? null} />;
}
