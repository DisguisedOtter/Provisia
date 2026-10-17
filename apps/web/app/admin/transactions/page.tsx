import { Suspense } from 'react';
import { TransactionList } from '@/components/admin/transactions/transaction-list';

export const metadata = { title: 'Transactions' };

export default function Page() {
  return (
    <Suspense>
      <TransactionList />
    </Suspense>
  );
}
