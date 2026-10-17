import type { EmailTemplateKey } from '@provisia/shared';

export interface BuiltInTemplate {
  name: string;
  subject: string;
  html: string;
}

const greeting = '<p>Hi {{client.firstName}},</p>';
const regards = '<p>Kind regards,<br>{{company.name}}</p>';

export const EN_FOOTER =
  'You receive this email because you have an account with {{company.name}}.';

export const EN_TEMPLATES: Record<EmailTemplateKey, BuiltInTemplate> = {
  'invoice.created': {
    name: 'Invoice created',
    subject: 'Invoice {{invoice.number}} from {{company.name}}',
    html: `<h1>New invoice {{invoice.number}}</h1>${greeting}
<p>A new invoice is ready for you. Please pay it before <strong>{{date invoice.dueDate}}</strong>.</p>
<table class="kv">
<tr><td>Invoice number</td><td>{{invoice.number}}</td></tr>
<tr><td>Issue date</td><td>{{date invoice.issueDate}}</td></tr>
<tr><td>Due date</td><td>{{date invoice.dueDate}}</td></tr>
<tr><td>Amount due</td><td><strong>{{money invoice.total}}</strong></td></tr>
</table>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Pay now</a><br>{{/if}}
<p class="muted">You can view and download the invoice in your <a href="{{invoiceUrl}}">client area</a>. The PDF is attached.</p>
${regards}`,
  },
  'invoice.reminder': {
    name: 'Invoice payment reminder',
    subject: 'Reminder: invoice {{invoice.number}} is due',
    html: `<h1>Payment reminder</h1>${greeting}
<p>This is a friendly reminder that invoice <strong>{{invoice.number}}</strong> for <strong>{{money (default invoice.balance invoice.total)}}</strong> {{#if daysOverdue}}was due {{daysOverdue}} day(s) ago{{else}}is due on {{date invoice.dueDate}}{{/if}}.</p>
<p>If you have already paid, please ignore this message.</p>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Pay invoice</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">View invoice</a></p>
${regards}`,
  },
  'invoice.overdue': {
    name: 'Invoice overdue',
    subject: 'Overdue: invoice {{invoice.number}} ({{daysOverdue}} days)',
    html: `<h1>Invoice overdue</h1>${greeting}
<p>Invoice <strong>{{invoice.number}}</strong> for <strong>{{money (default invoice.balance invoice.total)}}</strong> is now <strong>{{daysOverdue}} days overdue</strong>.</p>
{{#if suspendDate}}<p>To avoid interruption, please pay before <strong>{{date suspendDate}}</strong>. After that date the related services will be suspended.</p>{{/if}}
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Pay now</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">View invoice</a></p>
${regards}`,
  },
  'invoice.paid': {
    name: 'Payment confirmation',
    subject: 'Payment received for invoice {{invoice.number}}',
    html: `<h1>Thank you for your payment</h1>${greeting}
<p>We received your payment of <strong>{{money invoice.total}}</strong> for invoice <strong>{{invoice.number}}</strong> on {{date paidAt}}{{#if paymentMethod}} via {{paymentMethod}}{{/if}}.</p>
<p class="muted">The paid invoice is attached and available in your <a href="{{invoiceUrl}}">client area</a>.</p>
${regards}`,
  },
  'invoice.late_fee': {
    name: 'Late fee applied',
    subject: 'Late fee added to invoice {{invoice.number}}',
    html: `<h1>Late fee applied</h1>${greeting}
<p>Because invoice <strong>{{invoice.number}}</strong> remained unpaid after its due date ({{date invoice.dueDate}}), a late fee of <strong>{{money lateFee}}</strong> has been added. The new amount due is <strong>{{money (default invoice.balance invoice.total)}}</strong>.</p>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Pay now</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">View invoice</a></p>
${regards}`,
  },
  'service.welcome': {
    name: 'Service activated (welcome)',
    subject: 'Your {{service.productName}} is ready',
    html: `<h1>Your service is active</h1>${greeting}
<p>Your <strong>{{service.productName}}</strong>{{#if service.domain}} for <strong>{{service.domain}}</strong>{{/if}} has been set up. Here are your login details:</p>
<table class="kv">
{{#if credentials.panelUrl}}<tr><td>Control panel</td><td><a href="{{credentials.panelUrl}}">{{credentials.panelUrl}}</a></td></tr>{{/if}}
{{#if credentials.username}}<tr><td>Username</td><td><code>{{credentials.username}}</code></td></tr>{{/if}}
{{#if credentials.password}}<tr><td>Password</td><td><code>{{credentials.password}}</code></td></tr>{{/if}}
{{#if credentials.serverIp}}<tr><td>Server IP</td><td>{{credentials.serverIp}}</td></tr>{{/if}}
{{#if credentials.nameservers}}<tr><td>Nameservers</td><td>{{join credentials.nameservers "<br>"}}</td></tr>{{/if}}
{{#each credentials.extra}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}
</table>
<p>Please change the password after your first login. {{#if service.nextDueDate}}The next invoice is due on {{date service.nextDueDate}}.{{/if}}</p>
<a class="btn" href="{{serviceUrl}}">Manage service</a>
${regards}`,
  },
  'service.suspended': {
    name: 'Service suspended',
    subject:
      'Service suspended: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Service suspended</h1>${greeting}
<p>Your <strong>{{service.productName}}</strong>{{#if service.domain}} for <strong>{{service.domain}}</strong>{{/if}} has been suspended.</p>
{{#if reason}}<p>Reason: <em>{{reason}}</em></p>{{/if}}
<p>Please settle any outstanding invoices or contact support to have the service reactivated.</p>
<a class="btn" href="{{serviceUrl}}">View service</a>
${regards}`,
  },
  'service.unsuspended': {
    name: 'Service reactivated',
    subject:
      'Service reactivated: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Service reactivated</h1>${greeting}
<p>Good news: your <strong>{{service.productName}}</strong>{{#if service.domain}} for <strong>{{service.domain}}</strong>{{/if}} is active again.</p>
<a class="btn" href="{{serviceUrl}}">View service</a>
${regards}`,
  },
  'service.terminated': {
    name: 'Service terminated',
    subject:
      'Service terminated: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Service terminated</h1>${greeting}
<p>Your <strong>{{service.productName}}</strong>{{#if service.domain}} for <strong>{{service.domain}}</strong>{{/if}} has been terminated{{#if reason}} ({{reason}}){{/if}}. All data belonging to this service has been removed.</p>
<p>If this was unexpected, please contact support as soon as possible.</p>
${regards}`,
  },
  'domain.registered': {
    name: 'Domain registered',
    subject: 'Domain {{domain.name}} registered',
    html: `<h1>Domain registered</h1>${greeting}
<p>The domain <strong>{{domain.name}}</strong> has been registered successfully.</p>
<table class="kv">
{{#if domain.registrationDate}}<tr><td>Registered on</td><td>{{date domain.registrationDate}}</td></tr>{{/if}}
{{#if domain.expiryDate}}<tr><td>Expires on</td><td>{{date domain.expiryDate}}</td></tr>{{/if}}
{{#if domain.nameservers}}<tr><td>Nameservers</td><td>{{join domain.nameservers "<br>"}}</td></tr>{{/if}}
</table>
<a class="btn" href="{{domainUrl}}">Manage domain</a>
${regards}`,
  },
  'domain.transfer_initiated': {
    name: 'Domain transfer initiated',
    subject: 'Transfer of {{domain.name}} started',
    html: `<h1>Domain transfer started</h1>${greeting}
<p>We have started the transfer of <strong>{{domain.name}}</strong> to us. Depending on the registry this can take up to 5 days. You may receive an email from your current registrar asking you to approve the transfer.</p>
<a class="btn" href="{{domainUrl}}">Track transfer</a>
${regards}`,
  },
  'domain.expiring': {
    name: 'Domain expiring',
    subject: 'Domain {{domain.name}} expires in {{daysLeft}} days',
    html: `<h1>Domain expiring soon</h1>${greeting}
<p>The domain <strong>{{domain.name}}</strong> expires on <strong>{{date domain.expiryDate}}</strong> ({{daysLeft}} days from now).</p>
{{#if domain.autoRenew}}<p>Auto-renew is enabled: we will renew it automatically once the renewal invoice is paid.</p>{{else}}<p>Auto-renew is <strong>disabled</strong>. Renew it in time to avoid losing the domain.</p>{{/if}}
<a class="btn" href="{{domainUrl}}">Manage domain</a>
${regards}`,
  },
  'domain.renewed': {
    name: 'Domain renewed',
    subject: 'Domain {{domain.name}} renewed',
    html: `<h1>Domain renewed</h1>${greeting}
<p><strong>{{domain.name}}</strong> has been renewed{{#if domain.years}} for {{domain.years}} year(s){{/if}}. The new expiry date is <strong>{{date domain.expiryDate}}</strong>.</p>
<a class="btn" href="{{domainUrl}}">Manage domain</a>
${regards}`,
  },
  'ticket.opened': {
    name: 'Ticket opened (to requester)',
    subject: '[#{{ticket.number}}] {{ticket.subject}}',
    html: `<h1>We received your request</h1>
<p>Hi {{recipient.firstName}},</p>
<p>Your ticket <strong>#{{ticket.number}}</strong> has been opened in <strong>{{ticket.departmentName}}</strong>. We will get back to you as soon as possible.</p>
{{#if message}}<div class="quote">{{message}}</div>{{/if}}
<p class="muted">Reply to this email or use the client area to add information. Keep <code>[#{{ticket.number}}]</code> in the subject.</p>
<a class="btn" href="{{ticketUrl}}">View ticket</a>
${regards}`,
  },
  'ticket.reply': {
    name: 'Ticket reply (to client)',
    subject: 'Re: [#{{ticket.number}}] {{ticket.subject}}',
    html: `<p>Hi {{recipient.firstName}},</p>
<p>{{default authorName "Our support team"}} replied to ticket <strong>#{{ticket.number}}</strong>:</p>
<div class="quote">{{message}}</div>
<p class="muted">Reply to this email to respond, or open the ticket in the client area.</p>
<a class="btn" href="{{ticketUrl}}">View ticket</a>
${regards}`,
  },
  'ticket.reply.staff': {
    name: 'Ticket activity (to staff)',
    subject: '[#{{ticket.number}}] {{ticket.subject}} ({{ticket.status}})',
    html: `<p>Hi {{recipient.firstName}},</p>
<p><strong>{{default authorName "A client"}}</strong> wrote on ticket <strong>#{{ticket.number}}</strong> ({{ticket.departmentName}}, priority {{ticket.priority}}):</p>
<div class="quote">{{message}}</div>
<a class="btn" href="{{ticketUrl}}">Open in admin</a>`,
  },
  'ticket.closed': {
    name: 'Ticket closed',
    subject: 'Closed: [#{{ticket.number}}] {{ticket.subject}}',
    html: `<p>Hi {{recipient.firstName}},</p>
<p>Ticket <strong>#{{ticket.number}}</strong> has been closed. If your issue is not resolved, simply reply to this email and the ticket will be reopened.</p>
<a class="btn" href="{{ticketUrl}}">View ticket</a>
${regards}`,
  },
  'auth.password_reset': {
    name: 'Password reset',
    subject: 'Reset your {{company.name}} password',
    html: `<h1>Reset your password</h1>
<p>Hi {{user.firstName}},</p>
<p>Someone requested a password reset for <strong>{{user.email}}</strong>{{#if ip}} from IP {{ip}}{{/if}}. Click the button below to choose a new password. The link expires in {{default expiresIn "60 minutes"}}.</p>
<a class="btn" href="{{actionUrl}}">Reset password</a>
<p class="muted">If you did not request this, you can safely ignore this email; your password will not change.</p>`,
  },
  'auth.welcome': {
    name: 'Account created',
    subject: 'Welcome to {{company.name}}',
    html: `<h1>Welcome, {{user.firstName}}!</h1>
<p>Your account for <strong>{{user.email}}</strong> has been created. Use the client area to manage your services, domains, invoices and support tickets.</p>
<a class="btn" href="{{actionUrl}}">Go to client area</a>
${regards}`,
  },
  'auth.2fa_enabled': {
    name: 'Two-factor authentication enabled',
    subject: 'Two-factor authentication enabled',
    html: `<h1>Two-factor authentication enabled</h1>
<p>Hi {{user.firstName}},</p>
<p>Two-factor authentication was just enabled on your account <strong>{{user.email}}</strong>{{#if ip}} from IP {{ip}}{{/if}}. From now on you need your authenticator app to log in.</p>
<p class="muted">Was this not you? <a href="{{actionUrl}}">Review your security settings</a> immediately and contact support.</p>`,
  },
  'order.confirmation': {
    name: 'Order confirmation',
    subject: 'Order {{order.number}} confirmed',
    html: `<h1>Thanks for your order</h1>${greeting}
<p>We received order <strong>{{order.number}}</strong>:</p>
<table class="kv">
{{#each order.items}}<tr><td>{{this.description}}{{#if this.cycle}} <span class="muted">({{this.cycle}})</span>{{/if}}</td><td>{{money this.amount}}</td></tr>{{/each}}
<tr><td><strong>Total</strong></td><td><strong>{{money order.total}}</strong></td></tr>
</table>
{{#if invoice}}<p>Invoice <strong>{{invoice.number}}</strong> has been generated and is due on {{date invoice.dueDate}}. Your services are activated as soon as payment is received.</p>{{/if}}
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Pay now</a><br>{{/if}}
<p class="muted"><a href="{{orderUrl}}">View order</a></p>
${regards}`,
  },
  'payment.failed': {
    name: 'Payment failed',
    subject: 'Payment failed for invoice {{invoice.number}}',
    html: `<h1>Payment failed</h1>${greeting}
<p>Your payment of <strong>{{money invoice.total}}</strong> for invoice <strong>{{invoice.number}}</strong> via {{gateway}} could not be processed{{#if reason}}: <em>{{reason}}</em>{{/if}}.</p>
<p>Please try again or use a different payment method.</p>
<a class="btn" href="{{payUrl}}">Retry payment</a>
${regards}`,
  },
  'admin.notification': {
    name: 'Admin notification',
    subject: '[{{company.name}}] {{title}}',
    html: `<h1>{{title}}</h1>
<p>{{message}}</p>
{{#if details}}<table class="kv">{{#each details}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}</table>{{/if}}
{{#if link}}<a class="btn" href="{{link}}">Open</a>{{/if}}`,
  },
};
