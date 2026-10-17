'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** When set, the user must type this value to enable the confirm button. */
  typeToConfirm?: string;
  loading?: boolean;
  onConfirm: () => undefined | Promise<unknown>;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  typeToConfirm,
  loading,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const disabled = loading || (typeToConfirm !== undefined && typed !== typeToConfirm);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('');
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {children}
        {typeToConfirm !== undefined ? (
          <div className="space-y-2">
            <Label htmlFor="confirm-typed">
              Type <span className="font-mono">{typeToConfirm}</span> to confirm
            </Label>
            <Input
              id="confirm-typed"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={disabled}
            onClick={async () => {
              await onConfirm();
            }}
          >
            {loading ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Button that opens a ConfirmDialog before running `onConfirm`. */
export function ConfirmButton({
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive,
  typeToConfirm,
  loading,
  children,
  ...button
}: Omit<ConfirmDialogProps, 'open' | 'onOpenChange'> &
  Omit<React.ComponentProps<typeof Button>, 'title' | 'onClick'>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...button} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        typeToConfirm={typeToConfirm}
        loading={loading}
        onConfirm={async () => {
          await onConfirm();
          setOpen(false);
        }}
      />
    </>
  );
}
