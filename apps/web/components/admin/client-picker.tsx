'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { adminApi } from '@/lib/admin/api';
import { clientDisplayName } from '@/lib/admin/format';
import { cn } from '@/lib/utils';

/** Searchable client combobox (server-side search, debounced). */
export function ClientPicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ['clients', 'lookup', debounced],
    queryFn: () => adminApi.lookup.clients(debounced),
    enabled: open,
  });
  const selected = useQuery({
    queryKey: ['clients', value],
    queryFn: () => adminApi.clients.get(value as string),
    enabled: Boolean(value),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className="truncate">
            {value
              ? selected.data
                ? clientDisplayName(selected.data.data)
                : 'Loading…'
              : 'Select a client…'}
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name, email, company…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{list.isPending ? 'Searching…' : 'No clients found.'}</CommandEmpty>
            <CommandGroup>
              {list.data?.data.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.id}
                  onSelect={() => {
                    onChange(c.id === value ? null : c.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('size-4', value === c.id ? 'opacity-100' : 'opacity-0')} />
                  <div className="min-w-0">
                    <div className="truncate">{clientDisplayName(c)}</div>
                    <div className="truncate text-muted-foreground text-xs">{c.email}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
