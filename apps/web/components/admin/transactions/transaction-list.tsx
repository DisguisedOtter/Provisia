'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AdminPageHeader } from '../page-header';
import { TransactionDialog } from './transaction-dialog';
import { TransactionTable } from './transaction-table';

export function TransactionList() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <AdminPageHeader
        title="Transactions"
        crumbs={[{ label: 'Transactions' }]}
        description="Payments, refunds and credit movements across all gateways."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Record transaction
          </Button>
        }
      />
      <TransactionTable />
      {open ? <TransactionDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}
