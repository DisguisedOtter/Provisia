'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { adminApi } from '@/lib/admin/api';
import { isMissingEndpoint } from '@/lib/admin/form-errors';
import { fmtRelative } from '@/lib/admin/format';
import { cn } from '@/lib/utils';

export const NOTIFICATIONS_KEY = ['notifications'] as const;

export function NotificationsBell() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => adminApi.notifications.list({ perPage: 20 }),
    refetchInterval: 60_000,
    retry: false,
  });
  const markAll = useMutation({
    mutationFn: () => adminApi.notifications.markAllRead(),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => adminApi.notifications.markRead(id),
    onSettled: () => qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
  const unread = q.data?.meta.unread ?? q.data?.data.filter((n) => !n.readAt).length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        >
          <Bell />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-medium text-[10px] text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="font-medium text-sm">Notifications</div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => markAll.mutate()}
            disabled={!unread || markAll.isPending}
          >
            <CheckCheck /> Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {q.isError ? (
            <p className="p-4 text-muted-foreground text-sm">
              {isMissingEndpoint(q.error)
                ? 'Notifications are not available yet.'
                : 'Could not load notifications.'}
            </p>
          ) : q.data && q.data.data.length === 0 ? (
            <p className="p-4 text-muted-foreground text-sm">You're all caught up.</p>
          ) : (
            <ul className="divide-y">
              {q.data?.data.map((n) => {
                const inner = (
                  <>
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          n.readAt ? 'bg-transparent' : 'bg-primary',
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{n.title}</div>
                        {n.body ? (
                          <div className="line-clamp-2 text-muted-foreground text-xs">{n.body}</div>
                        ) : null}
                        <div className="mt-0.5 text-muted-foreground text-xs">
                          {fmtRelative(n.createdAt)}
                        </div>
                      </div>
                    </div>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        className="block px-3 py-2 hover:bg-accent"
                        onClick={() => !n.readAt && markOne.mutate(n.id)}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="block w-full px-3 py-2 text-left hover:bg-accent"
                        onClick={() => !n.readAt && markOne.mutate(n.id)}
                      >
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
