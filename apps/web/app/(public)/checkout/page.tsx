import { CheckoutView } from '@/components/portal/views/order/checkout';

export const metadata = { title: 'Checkout', robots: { index: false, follow: false } };

export default function Page() {
  return <CheckoutView />;
}
