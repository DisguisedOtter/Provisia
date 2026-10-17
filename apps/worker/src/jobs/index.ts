import type { JobHandler } from '../context.js';
import type { JobName, JobPayloads, QueueName } from '../queues.js';
import { billingJobs } from './billing.js';
import { domainJobs } from './domains.js';
import { emailJobs } from './email.js';
import { heartbeat } from './maintenance/heartbeat.js';
import { maintenanceJobs } from './maintenance.js';
import { paymentJobs } from './payments.js';
import { provisioningJobs } from './provisioning.js';
import { ticketJobs } from './tickets.js';

type Processors = {
  [Q in QueueName]: { [N in JobName<Q>]: JobHandler<JobPayloads[Q][N]> };
};

/** Every job must be mapped here; the worker refuses unknown job names. One line per job. */
export const processors: Processors = {
  billing: { ...billingJobs, ...paymentJobs },
  provisioning: provisioningJobs,
  domains: domainJobs,
  email: emailJobs,
  maintenance: {
    heartbeat,
    ...maintenanceJobs,
    ...ticketJobs,
  },
};
