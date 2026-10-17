# @provisia/gateway-stripe

Stripe payment gateway for Provisia: Checkout Sessions or Payment Intents for one-off invoice payments
(cards, SEPA Direct Debit, iDEAL, Bancontact), saved payment methods through a `mode=setup` Checkout Session
(SetupIntent) with off-session charging for auto-pay, refunds, and signed webhooks.

The module talks to the Stripe REST API with the module-sdk `fetch` (no `stripe` SDK), so tests mock HTTP
with msw and never reach Stripe.

## Config (`configSchema`)

| Key | Description |
|---|---|
| `secretKey` | `sk_test_...` / `sk_live_...` |
| `publishableKey` | `pk_...`, returned to the portal for Stripe.js / Elements |
| `webhookSecret` | `whsec_...` of the webhook endpoint |
| `flow` | `checkout` (default, redirect to Stripe) or `payment_intent` (client secret for Elements) |
| `paymentMethods` | subset of `card`, `sepa_debit`, `ideal`, `bancontact` (default: all but bancontact) |
| `statementDescriptor` | optional suffix (max 22 chars) |

Secrets are stored encrypted in `payment_gateways.config_encrypted`.

## Sandbox setup

1. Create a Stripe account and switch to **Test mode**. Copy the test secret key and publishable key from
   *Developers → API keys*.
2. Enable iDEAL, SEPA Direct Debit and Bancontact under *Settings → Payment methods*.
3. Expose your local API (e.g. `stripe listen --forward-to localhost:3001/api/v1/public/webhooks/stripe`
   with the Stripe CLI, or an ngrok tunnel) and create a webhook endpoint for
   `https://<your-host>/api/v1/public/webhooks/stripe` with the events
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `checkout.session.completed`,
   `charge.refunded`, `setup_intent.succeeded`. Copy the signing secret (`whsec_...`).
4. In Provisia admin: `PUT /api/v1/admin/payments/gateways/stripe` with the keys above and `enabled: true`,
   then `POST /api/v1/admin/payments/gateways/stripe/test`.
5. Pay an invoice from the portal (`POST /api/v1/portal/invoices/:id/pay { "gateway": "stripe" }`) with test
   card `4242 4242 4242 4242`, iDEAL test bank, or SEPA IBAN `NL39 RABO 0300 0652 64`. Trigger failures with
   `stripe trigger payment_intent.payment_failed`.

## Behaviour notes

- Checkout returns the session id (`cs_...`) as pending txn id; the webhook reports the Payment Intent id
  (`pi_...`) so `checkout.session.completed` and `payment_intent.succeeded` both resolve to the same transaction
  and the ledger's `(gateway, gateway_txn_id)` uniqueness makes the second one a no-op.
- Off-session charges use an `Idempotency-Key` of `provisia:autopay:<invoice>:<method>:<day>`.
- iDEAL and Bancontact setups produce a SEPA Direct Debit mandate (`sepa_debit` payment method).

## Tests

`pnpm --filter @provisia/gateway-stripe test`
