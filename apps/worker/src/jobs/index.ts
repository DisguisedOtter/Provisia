import type { JobHandler } from '../context.js';
import type { JobName, JobPayloads, QueueName } from '../queues.js';
import { heartbeat } from './maintenance/heartbeat.js';

type Processors = {
  [Q in QueueName]: { [N in JobName<Q>]: JobHandler<JobPayloads[Q][N]> };
};

/** Every job must be mapped here; the worker refuses unknown job names. One line per job. */
export const processors: Processors = {
  billing: {},
  provisioning: {},
  domains: {},
  email: {},
  maintenance: {
    heartbeat,
  },
};
