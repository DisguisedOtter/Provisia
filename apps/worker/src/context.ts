import type { Db } from '@provisia/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

/** Shared dependencies handed to every job processor. */
export interface JobContext {
  db: Db;
  redis: Redis;
  logger: Logger;
  appUrl: string;
  webUrl: string;
}

export type JobHandler<TData> = (ctx: JobContext, data: TData, job: Job<TData>) => Promise<unknown>;
