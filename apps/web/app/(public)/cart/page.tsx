import { CartView } from '@/components/portal/views/order/cart';

export const metadata = { title: 'Cart', robots: { index: false, follow: false } };

export default function Page() {
  return <CartView />;
}
