'use client';

import type { ApiKey, Session } from '@provisia/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api';
import { ME_KEY, useMe } from '@/lib/auth';

const errMsg = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;
const fmt = (d: Date | string | null) => (d ? new Date(d).toLocaleString() : '—');

// ------------------------------------------------------------------ password
function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password updated; other sessions were signed out');
      setCurrent('');
      setNext('');
    },
    onError: (err) => toast.error(errMsg(err, 'Could not change password')),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>At least 10 characters with letters and a number.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="next">New password</Label>
            <Input
              id="next"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
              minLength={10}
            />
          </div>
          <div>
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ 2FA
function BackupCodes({ codes }: { codes: string[] }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Store these backup codes somewhere safe. Each code works once if you lose your
        authenticator.
      </p>
      <pre className="grid grid-cols-2 gap-x-6 rounded-md bg-muted p-3 font-mono text-sm">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </pre>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Copied'))
        }
      >
        Copy codes
      </Button>
    </div>
  );
}

function TwoFactorCard({ enrollHint }: { enrollHint: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['auth', '2fa'],
    queryFn: () => api.auth.twoFactor.status().then((r) => r.data),
  });
  const [setupOpen, setSetupOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['auth', '2fa'] });
    qc.invalidateQueries({ queryKey: ME_KEY });
  };

  const setup = useMutation({
    mutationFn: () => api.auth.twoFactor.setup().then((r) => r.data),
    onSuccess: () => setSetupOpen(true),
    onError: (err) => toast.error(errMsg(err, 'Could not start setup')),
  });
  const confirm = useMutation({
    mutationFn: () => api.auth.twoFactor.confirm(code.trim()),
    onSuccess: ({ data }) => {
      setBackupCodes(data.backupCodes);
      setCode('');
      refresh();
      toast.success('Two-factor authentication enabled');
    },
    onError: (err) => toast.error(errMsg(err, 'Invalid code')),
  });
  const regenerate = useMutation({
    mutationFn: () => api.auth.twoFactor.regenerateBackupCodes(code.trim()),
    onSuccess: ({ data }) => {
      setBackupCodes(data.backupCodes);
      setCode('');
      refresh();
    },
    onError: (err) => toast.error(errMsg(err, 'Invalid code')),
  });
  const disable = useMutation({
    mutationFn: () => api.auth.twoFactor.disable({ password, code: code.trim() }),
    onSuccess: () => {
      setDisableOpen(false);
      setCode('');
      setPassword('');
      refresh();
      toast.success('Two-factor authentication disabled');
    },
    onError: (err) => toast.error(errMsg(err, 'Could not disable 2FA')),
  });

  const enabled = status.data?.enabled ?? false;
  return (
    <Card className={enrollHint && !enabled ? 'border-amber-400' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-factor authentication
          {enabled ? <Badge>Enabled</Badge> : <Badge variant="secondary">Off</Badge>}
          {status.data?.required && !enabled ? <Badge variant="destructive">Required</Badge> : null}
        </CardTitle>
        <CardDescription>
          {enabled
            ? `Enabled since ${fmt(status.data?.confirmedAt ?? null)} · ${status.data?.backupCodesRemaining ?? 0} backup codes left`
            : enrollHint
              ? 'Your organisation requires staff to use an authenticator app. Set it up to continue.'
              : 'Protect your account with a code from an authenticator app (TOTP).'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {backupCodes ? <BackupCodes codes={backupCodes} /> : null}
        <div className="flex flex-wrap gap-2">
          {!enabled ? (
            <Button onClick={() => setup.mutate()} disabled={setup.isPending}>
              Set up authenticator
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setSetupOpen(true)}>
                New backup codes
              </Button>
              <Button variant="destructive" onClick={() => setDisableOpen(true)}>
                Disable 2FA
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <Dialog
        open={setupOpen}
        onOpenChange={(o) => {
          setSetupOpen(o);
          if (!o) setCode('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {enabled ? 'Regenerate backup codes' : 'Set up your authenticator'}
            </DialogTitle>
            <DialogDescription>
              {enabled
                ? 'Enter a current code to replace all existing backup codes.'
                : 'Scan the QR code with Google Authenticator, 1Password, Aegis or a similar app, then enter the 6-digit code.'}
            </DialogDescription>
          </DialogHeader>
          {!enabled && setup.data ? (
            <div className="space-y-3">
              {/* biome-ignore lint/performance/noImgElement: data URL from the API */}
              <img
                src={setup.data.qrDataUrl}
                alt="TOTP QR code"
                width={200}
                height={200}
                className="mx-auto rounded-md border"
              />
              <p className="break-all text-center text-muted-foreground text-xs">
                Manual key: <code>{setup.data.secret}</code>
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="totp">Authenticator code</Label>
            <Input
              id="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => (enabled ? regenerate.mutate() : confirm.mutate())}
              disabled={code.trim().length !== 6 || confirm.isPending || regenerate.isPending}
            >
              {enabled ? 'Regenerate' : 'Enable 2FA'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disable two-factor authentication</DialogTitle>
            <DialogDescription>
              Confirm with your password and a current code (or a backup code).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="pw">Password</Label>
              <Input
                id="pw"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dcode">Code</Label>
              <Input
                id="dcode"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => disable.mutate()}
              disabled={!password || code.length < 6 || disable.isPending}
            >
              Disable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ------------------------------------------------------------------ sessions
function SessionsCard() {
  const qc = useQueryClient();
  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.auth.sessions.list().then((r) => r.data),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] });
  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.sessions.revoke(id),
    onSuccess: invalidate,
  });
  const revokeOthers = useMutation({
    mutationFn: () => api.auth.sessions.revokeOthers(),
    onSuccess: ({ data }) => {
      toast.success(`Signed out ${data.revoked} other session(s)`);
      invalidate();
    },
  });
  const rows: Session[] = sessions.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Active sessions</CardTitle>
        <CardDescription>Devices currently signed in to your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-md border">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.ip ?? 'unknown address'}</span>
                  {s.current ? <Badge>This device</Badge> : null}
                  {s.impersonated ? <Badge variant="secondary">Staff</Badge> : null}
                  {s.rememberMe ? <Badge variant="outline">30 days</Badge> : null}
                </div>
                <div className="truncate text-muted-foreground text-xs">{s.userAgent ?? '—'}</div>
                <div className="text-muted-foreground text-xs">
                  Last seen {fmt(s.lastSeenAt)} · expires {fmt(s.expiresAt)}
                </div>
              </div>
              {!s.current ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                >
                  Sign out
                </Button>
              ) : null}
            </li>
          ))}
          {rows.length === 0 && !sessions.isPending ? (
            <li className="p-3 text-muted-foreground text-sm">No sessions</li>
          ) : null}
        </ul>
        {rows.length > 1 ? (
          <Button
            variant="outline"
            onClick={() => revokeOthers.mutate()}
            disabled={revokeOthers.isPending}
          >
            Sign out all other sessions
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ API keys
function ApiKeysCard() {
  const qc = useQueryClient();
  const keys = useQuery({
    queryKey: ['auth', 'api-keys'],
    queryFn: () => api.auth.apiKeys.list().then((r) => r.data),
  });
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState('*');
  const [token, setToken] = useState<string | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['auth', 'api-keys'] });
  const create = useMutation({
    mutationFn: () =>
      api.auth.apiKeys.create({
        name,
        scopes: scopes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: ({ data }) => {
      setToken(data.token);
      setName('');
      invalidate();
    },
    onError: (err) => toast.error(errMsg(err, 'Could not create key')),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.auth.apiKeys.revoke(id),
    onSuccess: invalidate,
  });
  const rows: ApiKey[] = keys.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Use as <code>Authorization: Bearer pv_…</code>. Scopes are permission strings such as{' '}
          <code>invoices.read</code>; <code>*</code> means everything your account may do.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {token ? (
          <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm">
            <p>Copy your new key now; it will not be shown again.</p>
            <code className="block break-all font-mono">{token}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                navigator.clipboard.writeText(token).then(() => toast.success('Copied'))
              }
            >
              Copy
            </Button>
          </div>
        ) : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="kname">Name</Label>
            <Input
              id="kname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Zapier"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="kscopes">Scopes (comma separated)</Label>
            <Input
              id="kscopes"
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="*"
            />
          </div>
          <Button type="submit" disabled={create.isPending || !name}>
            Create key
          </Button>
        </form>
        <ul className="divide-y rounded-md border">
          {rows.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <div className="font-medium">
                  {k.name} <code className="text-muted-foreground text-xs">{k.prefix}…</code>
                </div>
                <div className="text-muted-foreground text-xs">
                  Scopes: {k.scopes.join(', ')} · last used {fmt(k.lastUsedAt)}
                  {k.lastUsedIp ? ` from ${k.lastUsedIp}` : ''}
                  {k.expiresAt ? ` · expires ${fmt(k.expiresAt)}` : ''}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => revoke.mutate(k.id)}
                disabled={revoke.isPending}
              >
                Revoke
              </Button>
            </li>
          ))}
          {rows.length === 0 && !keys.isPending ? (
            <li className="p-3 text-muted-foreground text-sm">No API keys</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  );
}

function SecurityPage() {
  const params = useSearchParams();
  const { data: me } = useMe();
  const enrollHint = params.get('enroll') === '1' || Boolean(me?.totpEnrollmentRequired);
  return (
    <>
      <PageHeader
        title="Security"
        description="Password, two-factor authentication, sessions and API keys."
      />
      <div className="grid gap-6">
        <TwoFactorCard enrollHint={enrollHint} />
        <PasswordCard />
        <SessionsCard />
        <ApiKeysCard />
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SecurityPage />
    </Suspense>
  );
}
