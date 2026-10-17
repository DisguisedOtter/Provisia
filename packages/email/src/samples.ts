import type { EmailTemplateData, EmailTemplateKey } from '@provisia/shared';

const client = { firstName: 'Jan', lastName: 'de Vries', companyName: 'Voorbeeld BV' };
const web = 'https://portal.example.com';

const invoice = {
  id: '01932b1e-0000-7000-8000-000000000001',
  number: '2026-000042',
  issueDate: '2026-03-01',
  dueDate: '2026-03-15',
  total: { amount: 6039, currency: 'EUR' },
  balance: { amount: 6039, currency: 'EUR' },
  status: 'unpaid',
};
const invoiceUrl = `${web}/portal/invoices/${invoice.id}`;
const payUrl = `${invoiceUrl}/pay`;

const service = {
  id: '01932b1e-0000-7000-8000-000000000002',
  productName: 'Starter Hosting',
  domain: 'voorbeeld.nl',
  nextDueDate: '2026-04-01',
  status: 'active',
};
const serviceUrl = `${web}/portal/services/${service.id}`;

const domain = {
  id: '01932b1e-0000-7000-8000-000000000003',
  name: 'voorbeeld.nl',
  registrationDate: '2026-03-01',
  expiryDate: '2027-03-01',
  years: 1,
  nameservers: ['ns1.example.com', 'ns2.example.com'],
  autoRenew: true,
};
const domainUrl = `${web}/portal/domains/${domain.id}`;

const ticket = {
  id: '01932b1e-0000-7000-8000-000000000004',
  number: '1001',
  subject: 'Website shows error 500',
  status: 'open',
  priority: 'high',
  departmentName: 'Technical Support',
};
const ticketUrl = `${web}/portal/tickets/${ticket.id}`;
const recipient = { firstName: 'Jan', lastName: 'de Vries' };

const user = { firstName: 'Jan', lastName: 'de Vries', email: 'jan@example.com' };

/** Realistic sample payload per key, used for previews and snapshot tests. */
export const SAMPLE_DATA: { [K in EmailTemplateKey]: EmailTemplateData[K] } = {
  'invoice.created': { client, invoice, invoiceUrl, payUrl },
  'invoice.reminder': { client, invoice, invoiceUrl, payUrl, daysOverdue: 3 },
  'invoice.overdue': {
    client,
    invoice,
    invoiceUrl,
    payUrl,
    daysOverdue: 7,
    suspendDate: '2026-03-22',
  },
  'invoice.paid': {
    client,
    invoice: { ...invoice, status: 'paid' },
    invoiceUrl,
    paidAt: '2026-03-10T14:03:00Z',
    paymentMethod: 'iDEAL',
  },
  'invoice.late_fee': {
    client,
    invoice,
    invoiceUrl,
    payUrl,
    lateFee: { amount: 1500, currency: 'EUR' },
  },
  'service.welcome': {
    client,
    service,
    serviceUrl,
    credentials: {
      panelUrl: 'https://server1.example.com:2083',
      username: 'voorbeel',
      password: 'Xk9#pLm2qR',
      serverIp: '203.0.113.10',
      nameservers: ['ns1.example.com', 'ns2.example.com'],
    },
  },
  'service.suspended': {
    client,
    service: { ...service, status: 'suspended' },
    serviceUrl,
    reason: 'Overdue invoice 2026-000042',
  },
  'service.unsuspended': { client, service, serviceUrl },
  'service.terminated': {
    client,
    service: { ...service, status: 'terminated' },
    serviceUrl,
    reason: 'Cancellation request',
  },
  'domain.registered': { client, domain, domainUrl },
  'domain.transfer_initiated': { client, domain, domainUrl },
  'domain.expiring': { client, domain, domainUrl, daysLeft: 30 },
  'domain.renewed': { client, domain: { ...domain, expiryDate: '2028-03-01' }, domainUrl },
  'ticket.opened': {
    recipient,
    ticket,
    ticketUrl,
    message:
      'Since this morning my website shows "HTTP 500 Internal Server Error". Nothing was changed.',
  },
  'ticket.reply': {
    recipient,
    ticket: { ...ticket, status: 'answered' },
    ticketUrl,
    authorName: 'Sanne (Support)',
    message:
      'Thanks for the report. The PHP memory limit was exhausted; we raised it to 512 MB. Could you check again?',
  },
  'ticket.reply.staff': {
    recipient: { firstName: 'Sanne' },
    ticket: { ...ticket, status: 'customer_reply' },
    ticketUrl: `${web}/admin/tickets/${ticket.id}`,
    authorName: 'Jan de Vries',
    message: 'Still broken after clearing cache, see attached screenshot.',
  },
  'ticket.closed': { recipient, ticket: { ...ticket, status: 'closed' }, ticketUrl },
  'auth.password_reset': {
    user,
    actionUrl: `${web}/reset-password?token=sample-token`,
    expiresIn: '60 minutes',
    ip: '198.51.100.7',
  },
  'auth.welcome': { user, actionUrl: `${web}/portal` },
  'auth.2fa_enabled': { user, actionUrl: `${web}/portal/security`, ip: '198.51.100.7' },
  'order.confirmation': {
    client,
    order: {
      id: '01932b1e-0000-7000-8000-000000000005',
      number: 'ORD-2026-0007',
      total: { amount: 6039, currency: 'EUR' },
      items: [
        {
          description: 'Starter Hosting — voorbeeld.nl',
          amount: { amount: 4990, currency: 'EUR' },
          cycle: 'annually',
        },
        {
          description: 'Domain registration voorbeeld.nl',
          amount: { amount: 1049, currency: 'EUR' },
          cycle: '1 year',
        },
      ],
    },
    invoice: { id: invoice.id, number: invoice.number, dueDate: invoice.dueDate },
    orderUrl: `${web}/portal/orders/01932b1e-0000-7000-8000-000000000005`,
    payUrl,
  },
  'payment.failed': {
    client,
    invoice: { id: invoice.id, number: invoice.number, total: invoice.total },
    gateway: 'Mollie',
    reason: 'Card declined',
    payUrl,
  },
  'admin.notification': {
    title: 'Provisioning failed for service #2',
    message: 'cPanel returned "Account already exists" while creating voorbeel on server1.',
    level: 'error',
    link: `${web}/admin/services/${service.id}`,
    details: { server: 'server1.example.com', module: 'cpanel', attempts: 3 },
  },
};
