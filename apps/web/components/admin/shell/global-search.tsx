'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Globe, LifeBuoy, Search, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { adminNav } from '@/components/admin-nav';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { adminApi } from '@/lib/admin/api';
import { isMissingEndpoint } from '@/lib/admin/form-errors';
import { clientDisplayName } from '@/lib/admin/format';

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: ({ signal }) => adminApi.search(debounced, signal),
    enabled: open && debounced.length >= 2,
    retry: false,
  });

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  const data = results.data?.data;
  const nothing =
    data &&
    !data.clients.length &&
    !data.domains.length &&
    !data.invoices.length &&
    !data.tickets.length;

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-full max-w-sm justify-start gap-2 text-muted-foreground sm:w-64 md:w-80"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-sm">Search clients, domains, invoices…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline-block">
          ⌘K
        </kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Global search"
        description="Search clients, domains, invoices and tickets"
        className="sm:max-w-xl"
      >
        <CommandInput
          placeholder="Type a name, email, domain, invoice or ticket number…"
          value={q}
          onValueChange={setQ}
        />
        <CommandList>
          {debounced.length < 2 ? (
            <CommandGroup heading="Go to">
              {adminNav.map((n) => (
                <CommandItem key={n.href} value={`nav ${n.label}`} onSelect={() => go(n.href)}>
                  <n.icon /> {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {debounced.length >= 2 && results.isPending ? (
            <CommandEmpty>Searching…</CommandEmpty>
          ) : null}
          {results.isError ? (
            <CommandEmpty>
              {isMissingEndpoint(results.error)
                ? 'Search is not available yet (API endpoint missing).'
                : 'Search failed.'}
            </CommandEmpty>
          ) : null}
          {nothing ? <CommandEmpty>No results for “{debounced}”.</CommandEmpty> : null}
          {data?.clients.length ? (
            <CommandGroup heading="Clients">
              {data.clients.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`client ${c.id}`}
                  onSelect={() => go(`/admin/clients/${c.id}`)}
                >
                  <Users />
                  <span className="truncate">{clientDisplayName(c)}</span>
                  <span className="ml-auto truncate text-muted-foreground text-xs">
                    {(c as { email?: string }).email}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {data?.domains.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Domains">
                {data.domains.map((d) => (
                  <CommandItem
                    key={d.id}
                    value={`domain ${d.id}`}
                    onSelect={() => go(`/admin/domains/${d.id}`)}
                  >
                    <Globe /> {d.name}
                    <span className="ml-auto text-muted-foreground text-xs">{d.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {data?.invoices.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Invoices">
                {data.invoices.map((i) => (
                  <CommandItem
                    key={i.id}
                    value={`invoice ${i.id}`}
                    onSelect={() => go(`/admin/invoices/${i.id}`)}
                  >
                    <FileText /> {i.number ?? 'Draft'}
                    <span className="ml-auto text-muted-foreground text-xs">{i.status}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {data?.tickets.length ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Tickets">
                {data.tickets.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`ticket ${t.id}`}
                    onSelect={() => go(`/admin/tickets/${t.id}`)}
                  >
                    <LifeBuoy /> #{t.number} <span className="truncate">{t.subject}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
