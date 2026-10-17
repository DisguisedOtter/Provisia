import type { DepartmentMailboxConfig } from '@provisia/db';
import { ImapFlow } from 'imapflow';

export type ImapConfig = NonNullable<DepartmentMailboxConfig['imap']>;

export interface PolledMessage {
  uid: number;
  raw: Buffer;
}

export interface PollResult {
  fetched: number;
  processed: number;
  failed: number;
  errors: string[];
}

export interface PollOptions {
  /** Max messages per poll (keeps a flood from blocking the queue). */
  limit?: number;
  logger?: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void };
}

/**
 * Connects to the mailbox, hands every unseen message to `handler`, then flags it `\Seen` and moves it
 * to `processedFolder` when configured. A handler that throws leaves the message unseen for the next run
 * (so transient DB errors retry) unless it throws `PermanentIngestError`, in which case the message is
 * flagged so it never blocks the queue again.
 */
export async function pollMailbox(
  cfg: ImapConfig,
  handler: (msg: PolledMessage) => Promise<void>,
  opts: PollOptions = {},
): Promise<PollResult> {
  const result: PollResult = { fetched: 0, processed: 0, failed: 0, errors: [] };
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
  });
  await client.connect();
  const folder = cfg.folder || 'INBOX';
  const lock = await client.getMailboxLock(folder);
  try {
    const uids = (await client.search({ seen: false }, { uid: true })) || [];
    const batch = uids.slice(0, opts.limit ?? 50);
    result.fetched = batch.length;
    for (const uid of batch) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      const raw = msg === false ? undefined : msg.source;
      if (!raw) continue;
      let ok = false;
      try {
        await handler({ uid, raw });
        ok = true;
        result.processed++;
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`uid ${uid}: ${message}`);
        opts.logger?.warn({ uid, err: message }, 'imap message failed');
        if (err instanceof PermanentIngestError) ok = true;
      }
      if (ok) {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        if (cfg.processedFolder) {
          try {
            await client.messageMove(String(uid), cfg.processedFolder, { uid: true });
          } catch (err) {
            opts.logger?.warn(
              { uid, err: String(err) },
              'could not move message to processed folder',
            );
          }
        }
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => client.close());
  }
  return result;
}

/** Thrown by the ingest handler for messages that must not be retried (malformed, rejected policy). */
export class PermanentIngestError extends Error {}

/** Connectivity check for the admin "test mailbox" button. */
export async function testImap(
  cfg: ImapConfig,
): Promise<{ ok: boolean; message: string; unseen?: number }> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    logger: false,
    disableAutoIdle: true,
  });
  try {
    await client.connect();
    const status = await client.status(cfg.folder || 'INBOX', { unseen: true });
    await client.logout();
    return {
      ok: true,
      message: `Connected; ${status.unseen ?? 0} unseen in ${cfg.folder || 'INBOX'}`,
      unseen: status.unseen,
    };
  } catch (err) {
    client.close();
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
