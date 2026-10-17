# @provisia/gateway-mollie

Mollie gateway for Provisia: Payments API v2 with iDEAL, SEPA bank transfer, credit card and Bancontact
(configurable), mandates for auto-pay (`sequenceType: first` payment → mandate → `recurring` payments),
refunds, and id-only webhooks that are resolved by fetching the payment from the API.

## Config (`configSchema`)

| Key | Description |
|---|---|
| `apiKey` | `test_...` or `live_...` (Dashboard → Developers → API keys) |
| `methods` | subset of `ideal`, `banktransfer`, `creditcard`, `bancontact`, `paypal`, `sofort`, `directdebit`; default the first four |
| `mandateAmount` | minor units charged by the mandate-creating first payment (default 1 = €0.01) |
| `locale` | hosted checkout locale, e.g. `nl_NL` |
| `bankTransferDueDays` | days a bank transfer stays payable (default 14) |

## Sandbox setup

1. Create a Mollie account; it starts in test mode. Enable iDEAL, Bank transfer, Cards and Bancontact under
   *Settings → Website profiles → Payment methods*. Enable **Recurring** payments for the profile if you want
   mandates (SEPA Direct Debit / cards).
2. Copy the **Test API key**.
3. Mollie must reach your API for webhooks: expose it (ngrok) and set `APP_URL` to the public URL; the module
   passes `webhookUrl = <APP_URL>/api/v1/public/webhooks/mollie` on every payment, nothing to register.
4. Configure: `PUT /api/v1/admin/payments/gateways/mollie` with `{ "config": { "apiKey": "test_..." }, "enabled": true }`
   and `POST /api/v1/admin/payments/gateways/mollie/test`.
5. Pay an invoice from the portal; the Mollie test checkout lets you pick the resulting status (paid, failed,
   expired...). The webhook arrives, Provisia fetches `GET /v2/payments/tr_...` and books the payment.
6. Saved methods: `POST /api/v1/portal/payments/methods { "gateway": "mollie" }` starts a €0.01 first payment;
   after it is paid the webhook stores the mandate, and the auto-pay job charges it with `sequenceType: recurring`.

## Notes

- Mollie webhooks carry no signature; the body is never trusted, only the `id`, and the status is read from the
  API. Unknown ids make the webhook fail (404), which Mollie retries and then drops.
- Idempotency: event id is `<paymentId>:<status>`, transactions are unique on `(mollie, tr_...)`.
- `fee` is derived from `settlementAmount` when present (same currency).
- Recurring SEPA payments stay `pending` for several days; the webhook or the reconciliation job completes them.

## Tests

`pnpm --filter @provisia/gateway-mollie test`
