# @provisia/gateway-paypal

PayPal gateway for Provisia built on the REST **Orders v2** API: create order → payer approves on PayPal →
server-side capture (on the browser return and/or on the `CHECKOUT.ORDER.APPROVED` webhook, idempotent),
refunds through Payments v2, and webhook verification through `POST /v1/notifications/verify-webhook-signature`.
Sandbox and live are a config switch (`mode`).

No PayPal SDK: the module uses the module-sdk `fetch`, and tests mock every endpoint with msw.

## Config (`configSchema`)

| Key | Description |
|---|---|
| `clientId`, `clientSecret` | REST app credentials (sandbox or live app) |
| `mode` | `sandbox` (default) or `live`; selects `api-m.sandbox.paypal.com` / `api-m.paypal.com` |
| `webhookId` | Id of the webhook registered for your app; PayPal needs it to verify signatures |
| `brandName` | Optional name shown on the PayPal approval page |

## Sandbox setup

1. Go to https://developer.paypal.com → *Apps & Credentials* → **Sandbox** → create a REST app. Copy client id
   and secret.
2. In the app, add a webhook with URL `https://<your-host>/api/v1/public/webhooks/paypal` (use an ngrok tunnel
   locally) subscribed to `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`,
   `PAYMENT.CAPTURE.REFUNDED`. Copy the **Webhook ID**.
3. Configure in Provisia: `PUT /api/v1/admin/payments/gateways/paypal` with
   `{ "config": { "clientId": "...", "clientSecret": "...", "mode": "sandbox", "webhookId": "..." }, "enabled": true }`
   and run `POST /api/v1/admin/payments/gateways/paypal/test`.
4. Pay an invoice from the portal with a sandbox personal account (*Sandbox → Accounts*). PayPal redirects the
   payer to `/api/v1/public/payments/paypal/return?token=<order>&invoice=<id>`, where Provisia captures the order
   and redirects to the portal invoice page. The webhook captures as well when the return never happens.
5. Simulate webhooks with the dashboard's *Webhooks simulator* (signature verification works for simulated
   events as long as `webhookId` matches).

## Notes

- The pending transaction id is the **order id**; the recorded payment uses the **capture id** (`custom_id`
  carries the Provisia invoice id). `ORDER_ALREADY_CAPTURED` is treated as success and resolved with a GET.
- Verification embeds the raw webhook bytes into the verification request; re-serialising the JSON breaks the
  signature check.
- Saved methods / vaulting are not implemented (`capabilities.savedMethods = false`).

## Tests

`pnpm --filter @provisia/gateway-paypal test`
