# Portal UI — assumed API endpoints

Every call the client portal and public order flow make, with the shape the UI expects. Paths are
relative to `/api/v1`. All responses use the `{ data }` / `{ data, meta }` envelope and the
`{ error: { code, message } }` error shape from ARCHITECTURE.md section 6. Where a shared zod schema
exists in `packages/shared`, the UI is typed against it (named in the "Shape" column); the rest are
local types in `apps/web/lib/portal/types.ts` to be replaced once the backend agent adds the schema.

The UI degrades gracefully: a `404` on any collection/action endpoint renders a "Not available yet"
state instead of an error (`ErrorState` in `components/portal/error-boundary.tsx`).

Client code: `apps/web/lib/portal/api.ts` (`portalApi`, `publicApi`).

## Auth (auth agent)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| POST | `/auth/login` | `loginRequestSchema` (email, password) | `{ data: AuthUser }` | inline login at checkout |
| POST | `/auth/register` | `registerRequestSchema` (incl. `acceptTerms: true`, `language`) | `registerResponseSchema` | inline registration at checkout; `409` is shown as "email already exists" |
| GET | `/auth/me` | — | `{ data: AuthUser }` | existing; `totpEnabled` read opportunistically for the security badge |

## Portal — account

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/portal/account` | — | `{ data: Client }` | also drives the UI locale (`client.language`) |
| PATCH | `/portal/account` | subset of `updateClientSchema` (company, VAT, address, phone, language) | `{ data: Client }` | |
| POST | `/portal/account/validate-vat` | — | `{ data: VatValidationResult }` | triggers a VIES check of the stored VAT number; `unavailable: true` shown as a warning |
| GET | `/portal/account/contacts` | — | `{ data: ClientContact[] }` | |
| POST | `/portal/account/contacts` | `createClientContactSchema` + optional `password` | `{ data: ClientContact }` | `password` creates a sub-user login (extension; ignore if unsupported) |
| PATCH | `/portal/account/contacts/:id` | `updateClientContactSchema` + optional `password` | `{ data: ClientContact }` | |
| DELETE | `/portal/account/contacts/:id` | — | 204 | |
| GET | `/portal/account/emails` | `?page&perPage` | `Paginated<EmailLogEntry>` (`emailLogSchema`) | email history of this client |
| GET | `/portal/announcements` | — | `{ data: Announcement[] }` (`{ id, title, body, publishedAt }`) | optional; dashboard shows a placeholder when 404 |

## Portal — services (provisioning agent)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/portal/services` | `serviceListQuerySchema` (`status`, `page`, `perPage`) | `Paginated<Service & { product?: { id, name, type, module } }>` | `product` is optional but strongly preferred for list labels |
| GET | `/portal/services/:id` | — | `{ data: Service & { product?, capabilities?: { loginUrl, changePassword, power, usage, changePackage } } }` | `capabilities` from `provisionerDescriptorSchema.capabilities`; buttons hide when `false` |
| POST | `/portal/services/:id/login-url` | — | `{ data: ProvisioningLoginUrl }` | opened in a new tab |
| POST | `/portal/services/:id/change-password` | `{ password }` (`provisioningChangePasswordBodySchema`) | `{ data: QueuedJob }` | |
| GET | `/portal/services/:id/change-package/options` | — | `{ data: Array<{ product: {id,name,slug,description,type}, prices: ProductPrice[] }> }` | other products in the same group |
| POST | `/portal/services/:id/change-package/preview` | `{ productId, billingCycle }` | `{ data: ProrationPreview }` (`credit`, `charge`, `subtotal`, `taxTotal`, `total`, `nextDueDate`, `currency`) | billing proration preview, nothing persisted |
| POST | `/portal/services/:id/change-package` | `changeServicePackageSchema` (`productId`, `billingCycle`) | `{ data: { invoiceId: string \| null, serviceId } }` | UI redirects to the invoice pay flow when `invoiceId` is set |
| POST | `/portal/services/:id/cancel` | `{ type: 'immediate' \| 'end_of_term', reason? }` | `{ data: Service }` | sets `cancellationRequestedAt` |
| POST | `/portal/services/:id/power` | `provisioningPowerBodySchema` (`start\|stop\|shutdown\|reboot`) | `{ data: QueuedJob }` | VPS only |
| GET | `/portal/services/:id/usage` | `?range=1h\|24h\|7d` | `{ data: ServiceUsage & { cpuPercent?, memoryUsedMb?, memoryLimitMb?, powerState?, history?: Array<{ t, cpu?, memMb?, netInMb?, netOutMb? }> } }` | VPS extras may also live in `extra` (`cpuPercent`, `memoryUsedMb`, `powerState`); `normalizeUsage()` reads both |

## Portal — domains (domains agent)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/portal/domains` | `?page&perPage&status` | `Paginated<PortalDomain>` | |
| GET | `/portal/domains/:id` | — | `{ data: PortalDomain }` | |
| PATCH | `/portal/domains/:id` | `updateDomainSchema` (`nameservers`, `autoRenew`, `locked`, `idProtection`, `contacts`) | `{ data: PortalDomain }` | |
| POST | `/portal/domains/:id/epp-code` | — | `eppCodeResponseSchema` | `eppCode: null` + `job` → UI asks to retry |
| POST | `/portal/domains/:id/renew` | `renewDomainRequestSchema` (`years`) | `domainActionResponseSchema`, optionally `+ { invoiceId }` | if an invoice is created first, return `invoiceId` so the UI can jump to payment |
| POST | `/portal/orders` with `{ type: 'domain_transfer', domainName, billingCycle: 'annually', config: { eppCode, years } }` | see Orders | | transfer-in is placed as an order, per the domains README ("invoicing is the orders module's job") |

## Portal — invoices & payments (billing + payments agents)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/portal/invoices` | `invoiceListQuerySchema` (`status`, `page`, `perPage`) | `Paginated<Invoice>` | |
| GET | `/portal/invoices/:id` | — | `{ data: InvoiceWithItems }` | `taxSummary` used when present |
| GET | `/portal/invoices/:id/transactions` | — | `{ data: Transaction[] }` | optional ("no payments recorded" on 404) |
| GET | `/portal/invoices/:id/pdf` | — | `application/pdf` | plain link, cookie auth |
| POST | `/portal/invoices/:id/pay` | `payInvoiceSchema` `{ gateway }` **+ optional** `paymentMethodId`, `saveMethod`, `returnUrl` | `{ data: PaymentStart }` | `redirectUrl` → browser redirect; `clientSecret` → Stripe Elements (`publicConfig.publishableKey` or `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`); neither → treated as charged (saved method / credit). Return URL: `/portal/invoices/:id/payment/return?gateway=` — please use it as the gateway return/cancel URL |
| GET | `/portal/payments/gateways` | — | `{ data: PortalGateway[] }` | |
| GET | `/portal/payments/methods` | — | `{ data: PaymentMethod[] }` | |
| POST | `/portal/payments/methods` | `addPaymentMethodSchema` `{ gateway }` + optional `returnUrl` | `{ data: SetupStart }` | `clientSecret` → Stripe `confirmSetup` |
| DELETE | `/portal/payments/methods/:id` | — | 204 | |
| POST | `/portal/payments/methods/:id/default` | — | `{ data: PaymentMethod }` | |
| GET | `/portal/payments/auto-pay` | — | `{ data: AutoPaySettings }` | |
| PUT | `/portal/payments/auto-pay` | `Partial<AutoPaySettings>` (`enabled`) | `{ data: AutoPaySettings }` | |

Payment return page: `/portal/invoices/:id/payment/return` polls `GET /portal/invoices/:id` every 3 s
(max ~1 min) and reads `redirect_status` (Stripe) / `status` (`failed|canceled|expired`) as a hint only.

## Portal — tickets (support agent)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/portal/tickets` | `?page&perPage&status=closed` | `Paginated<TicketListItem>` | default = everything except closed |
| GET | `/portal/tickets/:id` | — | `{ data: TicketDetail }` | internal replies filtered client-side too |
| GET | `/portal/tickets/departments` | — | `{ data: PublicTicketDepartment[] }` | |
| POST | `/portal/tickets/attachments` | multipart, field `file` | `{ data: { id, name, size, mimeType } }` | uploaded before create/reply; ids passed as `attachmentIds` |
| POST | `/portal/tickets` | `createTicketSchema` (`departmentId`, `subject`, `body`, `priority`, `serviceId?`, `domainId?`, `attachmentIds`) | `{ data: Ticket }` | |
| POST | `/portal/tickets/:id/replies` | `createTicketReplySchema` (`body`, `attachmentIds`) | `{ data: TicketReply }` | |
| POST | `/portal/tickets/:id/close` | — | `{ data: Ticket }` | alternative accepted: reply with `status: 'closed'` |
| GET | `/portal/tickets/:id/attachments/:attachmentId` | — | file | download link |

## Portal — orders (orders/billing agent)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| POST | `/portal/orders` | `createOrderSchema` (`items: CartItem[]`, `promoCode?`, `notes?`) | `{ data: OrderWithItems }` | `invoiceId` is used to redirect to payment. Domain items carry `config.years`, transfers `config.eppCode`; product items with a domain carry `domainName` + `config.domainMode` (`register\|transfer\|existing`) |
| POST | `/portal/orders/quote` | `{ items, promoCode? }` | `{ data: CartQuote }` | not used yet (public quote covers logged-in users via country/VAT from profile) |

## Public (catalog, domains, quote)

| Method | Path | Body / Query | Shape | Notes |
|---|---|---|---|---|
| GET | `/public/products/groups` | — | `{ data: ProductGroup[] }` | hidden groups filtered client-side too |
| GET | `/public/products` | `?groupId` | `{ data: ProductWithPrices[] }` | **not paginated** (a `Paginated` envelope also works since `.data` is read) |
| GET | `/public/products/:idOrSlug` | — | `{ data: ProductWithPrices & { configurableOptions?: ConfigurableOption[] } }` | `configurableOptions` is a UI assumption (`types.ts`); omit if not modelled |
| GET | `/public/domains/availability` | `availabilityQuerySchema` (`domain` or `sld`, `limit`) | `availabilityResponseSchema` | |
| GET | `/public/domains/tlds` | — | `{ data: PublicTld[] }` | prices with `years: 1` used for the table |
| POST | `/public/orders/quote` | `{ items: CartItem[], country, vatNumber?, promoCode? }` | `{ data: CartQuote & { promoValid?: boolean \| null, discount?: number } }` | tax estimate for guests; `discount`/`promoValid` are optional extensions |

## Web routes assumed to exist (auth agent)

Linked from `/portal/account/security`: `/account/password`, `/account/two-factor`, `/account/sessions`,
and `/login?next=…`. Rename the links in `components/portal/views/account/security.tsx` if the auth
agent picks different paths.

## Environment

- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — fallback when `PaymentStart.publicConfig.publishableKey` is absent.
