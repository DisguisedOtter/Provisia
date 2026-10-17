'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/portal/i18n';

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success(t('common.copied'));
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error(t('common.somethingWrong'));
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
      {label ?? t('common.copy')}
    </Button>
  );
}
