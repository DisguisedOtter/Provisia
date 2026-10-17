import type { EmailTemplateKey } from '@provisia/shared';
import type { BuiltInTemplate } from './en.js';

const greeting = '<p>Beste {{client.firstName}},</p>';
const regards = '<p>Met vriendelijke groet,<br>{{company.name}}</p>';

export const NL_FOOTER = 'U ontvangt deze e-mail omdat u een account heeft bij {{company.name}}.';

export const NL_TEMPLATES: Record<EmailTemplateKey, BuiltInTemplate> = {
  'invoice.created': {
    name: 'Factuur aangemaakt',
    subject: 'Factuur {{invoice.number}} van {{company.name}}',
    html: `<h1>Nieuwe factuur {{invoice.number}}</h1>${greeting}
<p>Er staat een nieuwe factuur voor u klaar. Betaal deze a.u.b. vóór <strong>{{date invoice.dueDate}}</strong>.</p>
<table class="kv">
<tr><td>Factuurnummer</td><td>{{invoice.number}}</td></tr>
<tr><td>Factuurdatum</td><td>{{date invoice.issueDate}}</td></tr>
<tr><td>Vervaldatum</td><td>{{date invoice.dueDate}}</td></tr>
<tr><td>Te betalen</td><td><strong>{{money invoice.total}}</strong></td></tr>
</table>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Nu betalen</a><br>{{/if}}
<p class="muted">U kunt de factuur bekijken en downloaden in uw <a href="{{invoiceUrl}}">klantenportaal</a>. De PDF is bijgevoegd.</p>
${regards}`,
  },
  'invoice.reminder': {
    name: 'Betalingsherinnering',
    subject: 'Herinnering: factuur {{invoice.number}} vervalt',
    html: `<h1>Betalingsherinnering</h1>${greeting}
<p>Dit is een vriendelijke herinnering dat factuur <strong>{{invoice.number}}</strong> van <strong>{{money (default invoice.balance invoice.total)}}</strong> {{#if daysOverdue}}{{daysOverdue}} dag(en) geleden verviel{{else}}vervalt op {{date invoice.dueDate}}{{/if}}.</p>
<p>Heeft u al betaald? Dan kunt u dit bericht negeren.</p>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Factuur betalen</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">Factuur bekijken</a></p>
${regards}`,
  },
  'invoice.overdue': {
    name: 'Factuur verlopen',
    subject: 'Verlopen: factuur {{invoice.number}} ({{daysOverdue}} dagen)',
    html: `<h1>Factuur verlopen</h1>${greeting}
<p>Factuur <strong>{{invoice.number}}</strong> van <strong>{{money (default invoice.balance invoice.total)}}</strong> is nu <strong>{{daysOverdue}} dagen over de vervaldatum</strong>.</p>
{{#if suspendDate}}<p>Betaal vóór <strong>{{date suspendDate}}</strong> om onderbreking te voorkomen. Daarna worden de bijbehorende diensten opgeschort.</p>{{/if}}
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Nu betalen</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">Factuur bekijken</a></p>
${regards}`,
  },
  'invoice.paid': {
    name: 'Betalingsbevestiging',
    subject: 'Betaling ontvangen voor factuur {{invoice.number}}',
    html: `<h1>Bedankt voor uw betaling</h1>${greeting}
<p>Wij hebben uw betaling van <strong>{{money invoice.total}}</strong> voor factuur <strong>{{invoice.number}}</strong> ontvangen op {{date paidAt}}{{#if paymentMethod}} via {{paymentMethod}}{{/if}}.</p>
<p class="muted">De betaalde factuur is bijgevoegd en beschikbaar in uw <a href="{{invoiceUrl}}">klantenportaal</a>.</p>
${regards}`,
  },
  'invoice.late_fee': {
    name: 'Aanmaningskosten toegevoegd',
    subject: 'Aanmaningskosten toegevoegd aan factuur {{invoice.number}}',
    html: `<h1>Aanmaningskosten</h1>${greeting}
<p>Omdat factuur <strong>{{invoice.number}}</strong> na de vervaldatum ({{date invoice.dueDate}}) onbetaald bleef, zijn er aanmaningskosten van <strong>{{money lateFee}}</strong> toegevoegd. Het nieuwe openstaande bedrag is <strong>{{money (default invoice.balance invoice.total)}}</strong>.</p>
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Nu betalen</a><br>{{/if}}
<p class="muted"><a href="{{invoiceUrl}}">Factuur bekijken</a></p>
${regards}`,
  },
  'service.welcome': {
    name: 'Dienst geactiveerd (welkom)',
    subject: 'Uw {{service.productName}} is klaar',
    html: `<h1>Uw dienst is actief</h1>${greeting}
<p>Uw <strong>{{service.productName}}</strong>{{#if service.domain}} voor <strong>{{service.domain}}</strong>{{/if}} is ingericht. Dit zijn uw inloggegevens:</p>
<table class="kv">
{{#if credentials.panelUrl}}<tr><td>Controlepaneel</td><td><a href="{{credentials.panelUrl}}">{{credentials.panelUrl}}</a></td></tr>{{/if}}
{{#if credentials.username}}<tr><td>Gebruikersnaam</td><td><code>{{credentials.username}}</code></td></tr>{{/if}}
{{#if credentials.password}}<tr><td>Wachtwoord</td><td><code>{{credentials.password}}</code></td></tr>{{/if}}
{{#if credentials.serverIp}}<tr><td>Server-IP</td><td>{{credentials.serverIp}}</td></tr>{{/if}}
{{#if credentials.nameservers}}<tr><td>Nameservers</td><td>{{join credentials.nameservers "<br>"}}</td></tr>{{/if}}
{{#each credentials.extra}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}
</table>
<p>Wijzig het wachtwoord na uw eerste login. {{#if service.nextDueDate}}De volgende factuur vervalt op {{date service.nextDueDate}}.{{/if}}</p>
<a class="btn" href="{{serviceUrl}}">Dienst beheren</a>
${regards}`,
  },
  'service.suspended': {
    name: 'Dienst opgeschort',
    subject:
      'Dienst opgeschort: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Dienst opgeschort</h1>${greeting}
<p>Uw <strong>{{service.productName}}</strong>{{#if service.domain}} voor <strong>{{service.domain}}</strong>{{/if}} is opgeschort.</p>
{{#if reason}}<p>Reden: <em>{{reason}}</em></p>{{/if}}
<p>Voldoe openstaande facturen of neem contact op met support om de dienst weer te activeren.</p>
<a class="btn" href="{{serviceUrl}}">Dienst bekijken</a>
${regards}`,
  },
  'service.unsuspended': {
    name: 'Dienst heractiveerd',
    subject:
      'Dienst heractiveerd: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Dienst heractiveerd</h1>${greeting}
<p>Goed nieuws: uw <strong>{{service.productName}}</strong>{{#if service.domain}} voor <strong>{{service.domain}}</strong>{{/if}} is weer actief.</p>
<a class="btn" href="{{serviceUrl}}">Dienst bekijken</a>
${regards}`,
  },
  'service.terminated': {
    name: 'Dienst beëindigd',
    subject:
      'Dienst beëindigd: {{service.productName}}{{#if service.domain}} ({{service.domain}}){{/if}}',
    html: `<h1>Dienst beëindigd</h1>${greeting}
<p>Uw <strong>{{service.productName}}</strong>{{#if service.domain}} voor <strong>{{service.domain}}</strong>{{/if}} is beëindigd{{#if reason}} ({{reason}}){{/if}}. Alle gegevens van deze dienst zijn verwijderd.</p>
<p>Was dit onverwacht? Neem dan zo snel mogelijk contact op met support.</p>
${regards}`,
  },
  'domain.registered': {
    name: 'Domein geregistreerd',
    subject: 'Domein {{domain.name}} geregistreerd',
    html: `<h1>Domein geregistreerd</h1>${greeting}
<p>Het domein <strong>{{domain.name}}</strong> is succesvol geregistreerd.</p>
<table class="kv">
{{#if domain.registrationDate}}<tr><td>Geregistreerd op</td><td>{{date domain.registrationDate}}</td></tr>{{/if}}
{{#if domain.expiryDate}}<tr><td>Verloopt op</td><td>{{date domain.expiryDate}}</td></tr>{{/if}}
{{#if domain.nameservers}}<tr><td>Nameservers</td><td>{{join domain.nameservers "<br>"}}</td></tr>{{/if}}
</table>
<a class="btn" href="{{domainUrl}}">Domein beheren</a>
${regards}`,
  },
  'domain.transfer_initiated': {
    name: 'Domeinverhuizing gestart',
    subject: 'Verhuizing van {{domain.name}} gestart',
    html: `<h1>Domeinverhuizing gestart</h1>${greeting}
<p>We zijn begonnen met de verhuizing van <strong>{{domain.name}}</strong> naar ons. Afhankelijk van het register kan dit tot 5 dagen duren. Mogelijk ontvangt u een e-mail van uw huidige registrar om de verhuizing goed te keuren.</p>
<a class="btn" href="{{domainUrl}}">Verhuizing volgen</a>
${regards}`,
  },
  'domain.expiring': {
    name: 'Domein verloopt binnenkort',
    subject: 'Domein {{domain.name}} verloopt over {{daysLeft}} dagen',
    html: `<h1>Domein verloopt binnenkort</h1>${greeting}
<p>Het domein <strong>{{domain.name}}</strong> verloopt op <strong>{{date domain.expiryDate}}</strong> (over {{daysLeft}} dagen).</p>
{{#if domain.autoRenew}}<p>Automatisch verlengen staat aan: we verlengen het domein zodra de verlengingsfactuur is betaald.</p>{{else}}<p>Automatisch verlengen staat <strong>uit</strong>. Verleng op tijd om het domein niet te verliezen.</p>{{/if}}
<a class="btn" href="{{domainUrl}}">Domein beheren</a>
${regards}`,
  },
  'domain.renewed': {
    name: 'Domein verlengd',
    subject: 'Domein {{domain.name}} verlengd',
    html: `<h1>Domein verlengd</h1>${greeting}
<p><strong>{{domain.name}}</strong> is verlengd{{#if domain.years}} met {{domain.years}} jaar{{/if}}. De nieuwe vervaldatum is <strong>{{date domain.expiryDate}}</strong>.</p>
<a class="btn" href="{{domainUrl}}">Domein beheren</a>
${regards}`,
  },
  'ticket.opened': {
    name: 'Ticket geopend (aan aanvrager)',
    subject: '[#{{ticket.number}}] {{ticket.subject}}',
    html: `<h1>We hebben uw verzoek ontvangen</h1>
<p>Beste {{recipient.firstName}},</p>
<p>Uw ticket <strong>#{{ticket.number}}</strong> is geopend bij <strong>{{ticket.departmentName}}</strong>. We reageren zo snel mogelijk.</p>
{{#if message}}<div class="quote">{{message}}</div>{{/if}}
<p class="muted">Beantwoord deze e-mail of gebruik het klantenportaal om informatie toe te voegen. Laat <code>[#{{ticket.number}}]</code> in het onderwerp staan.</p>
<a class="btn" href="{{ticketUrl}}">Ticket bekijken</a>
${regards}`,
  },
  'ticket.reply': {
    name: 'Ticketreactie (aan klant)',
    subject: 'Re: [#{{ticket.number}}] {{ticket.subject}}',
    html: `<p>Beste {{recipient.firstName}},</p>
<p>{{default authorName "Ons supportteam"}} heeft gereageerd op ticket <strong>#{{ticket.number}}</strong>:</p>
<div class="quote">{{message}}</div>
<p class="muted">Beantwoord deze e-mail om te reageren, of open het ticket in het klantenportaal.</p>
<a class="btn" href="{{ticketUrl}}">Ticket bekijken</a>
${regards}`,
  },
  'ticket.reply.staff': {
    name: 'Ticketactiviteit (aan medewerker)',
    subject: '[#{{ticket.number}}] {{ticket.subject}} ({{ticket.status}})',
    html: `<p>Hoi {{recipient.firstName}},</p>
<p><strong>{{default authorName "Een klant"}}</strong> schreef op ticket <strong>#{{ticket.number}}</strong> ({{ticket.departmentName}}, prioriteit {{ticket.priority}}):</p>
<div class="quote">{{message}}</div>
<a class="btn" href="{{ticketUrl}}">Openen in beheer</a>`,
  },
  'ticket.closed': {
    name: 'Ticket gesloten',
    subject: 'Gesloten: [#{{ticket.number}}] {{ticket.subject}}',
    html: `<p>Beste {{recipient.firstName}},</p>
<p>Ticket <strong>#{{ticket.number}}</strong> is gesloten. Is uw probleem niet opgelost? Beantwoord dan deze e-mail; het ticket wordt dan heropend.</p>
<a class="btn" href="{{ticketUrl}}">Ticket bekijken</a>
${regards}`,
  },
  'auth.password_reset': {
    name: 'Wachtwoord herstellen',
    subject: 'Herstel uw wachtwoord voor {{company.name}}',
    html: `<h1>Wachtwoord herstellen</h1>
<p>Beste {{user.firstName}},</p>
<p>Er is een wachtwoordherstel aangevraagd voor <strong>{{user.email}}</strong>{{#if ip}} vanaf IP {{ip}}{{/if}}. Klik op de knop hieronder om een nieuw wachtwoord te kiezen. De link verloopt over {{default expiresIn "60 minuten"}}.</p>
<a class="btn" href="{{actionUrl}}">Wachtwoord herstellen</a>
<p class="muted">Heeft u dit niet aangevraagd? Dan kunt u deze e-mail negeren; uw wachtwoord wordt niet gewijzigd.</p>`,
  },
  'auth.welcome': {
    name: 'Account aangemaakt',
    subject: 'Welkom bij {{company.name}}',
    html: `<h1>Welkom, {{user.firstName}}!</h1>
<p>Uw account voor <strong>{{user.email}}</strong> is aangemaakt. In het klantenportaal beheert u uw diensten, domeinen, facturen en supporttickets.</p>
<a class="btn" href="{{actionUrl}}">Naar het klantenportaal</a>
${regards}`,
  },
  'auth.2fa_enabled': {
    name: 'Tweestapsverificatie ingeschakeld',
    subject: 'Tweestapsverificatie ingeschakeld',
    html: `<h1>Tweestapsverificatie ingeschakeld</h1>
<p>Beste {{user.firstName}},</p>
<p>Tweestapsverificatie is zojuist ingeschakeld op uw account <strong>{{user.email}}</strong>{{#if ip}} vanaf IP {{ip}}{{/if}}. Vanaf nu heeft u uw authenticator-app nodig om in te loggen.</p>
<p class="muted">Was u dit niet? <a href="{{actionUrl}}">Controleer direct uw beveiligingsinstellingen</a> en neem contact op met support.</p>`,
  },
  'order.confirmation': {
    name: 'Orderbevestiging',
    subject: 'Bestelling {{order.number}} bevestigd',
    html: `<h1>Bedankt voor uw bestelling</h1>${greeting}
<p>We hebben bestelling <strong>{{order.number}}</strong> ontvangen:</p>
<table class="kv">
{{#each order.items}}<tr><td>{{this.description}}{{#if this.cycle}} <span class="muted">({{this.cycle}})</span>{{/if}}</td><td>{{money this.amount}}</td></tr>{{/each}}
<tr><td><strong>Totaal</strong></td><td><strong>{{money order.total}}</strong></td></tr>
</table>
{{#if invoice}}<p>Factuur <strong>{{invoice.number}}</strong> is aangemaakt en vervalt op {{date invoice.dueDate}}. Uw diensten worden geactiveerd zodra de betaling binnen is.</p>{{/if}}
{{#if payUrl}}<a class="btn" href="{{payUrl}}">Nu betalen</a><br>{{/if}}
<p class="muted"><a href="{{orderUrl}}">Bestelling bekijken</a></p>
${regards}`,
  },
  'payment.failed': {
    name: 'Betaling mislukt',
    subject: 'Betaling mislukt voor factuur {{invoice.number}}',
    html: `<h1>Betaling mislukt</h1>${greeting}
<p>Uw betaling van <strong>{{money invoice.total}}</strong> voor factuur <strong>{{invoice.number}}</strong> via {{gateway}} kon niet worden verwerkt{{#if reason}}: <em>{{reason}}</em>{{/if}}.</p>
<p>Probeer het opnieuw of gebruik een andere betaalmethode.</p>
<a class="btn" href="{{payUrl}}">Opnieuw betalen</a>
${regards}`,
  },
  'admin.notification': {
    name: 'Beheerdersmelding',
    subject: '[{{company.name}}] {{title}}',
    html: `<h1>{{title}}</h1>
<p>{{message}}</p>
{{#if details}}<table class="kv">{{#each details}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}</table>{{/if}}
{{#if link}}<a class="btn" href="{{link}}">Openen</a>{{/if}}`,
  },
};
