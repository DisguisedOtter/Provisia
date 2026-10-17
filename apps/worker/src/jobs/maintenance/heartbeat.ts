import type { JobHandler } from '../../context.js';
import type { JobData } from '../../queues.js';

/** Proves the worker and its schedulers are alive; the run itself is recorded in `jobs_log`. */
export const heartbeat: JobHandler<JobData<'maintenance', 'heartbeat'>> = async (ctx) => {
  ctx.logger.info('heartbeat');
  return { at: new Date().toISOString(), pid: process.pid };
};
