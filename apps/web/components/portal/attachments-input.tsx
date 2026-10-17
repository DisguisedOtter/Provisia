'use client';

import { TICKET_ATTACHMENT_ALLOWED_TYPES } from '@provisia/shared';
import { Paperclip, X } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/portal/i18n';

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function AttachmentsInput({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <input
        ref={ref}
        type="file"
        multiple
        accept={TICKET_ATTACHMENT_ALLOWED_TYPES.join(',')}
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []).filter(
            (f) => f.size <= MAX_ATTACHMENT_BYTES,
          );
          onChange([...files, ...picked].slice(0, MAX_ATTACHMENTS));
          e.target.value = '';
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => ref.current?.click()}
          disabled={files.length >= MAX_ATTACHMENTS}
        >
          <Paperclip className="size-4" /> {t('tickets.attachments')}
        </Button>
        <span className="text-muted-foreground text-xs">{t('tickets.attachmentsHint')}</span>
      </div>
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${f.lastModified}`}
              className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <span className="max-w-48 truncate">{f.name}</span>
              <span className="text-muted-foreground">({Math.ceil(f.size / 1024)} KB)</span>
              <button
                type="button"
                aria-label={t('common.remove')}
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
