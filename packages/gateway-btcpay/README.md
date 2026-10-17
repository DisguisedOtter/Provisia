# @provisia/gateway-btcpay

BTCPay Server gateway for Provisia via the **Greenfield API**: invoices with a redirect back to the portal,
webhooks verified with the `BTCPay-Sig` HMAC, `Settled` / `Expired` / `Invalid` handling, partial payments
(booked as a partial transaction, invoice stays unpaid) and overpayments (the full received fiat value is booked,
the ledger credits the surplus to the client's credit balance per ARCHITECTURE.md), refunds as pull payments.

## Config (`configSchema`)

| Key | Description |
|---|---|
| `serverUrl` | `https://btcpay.example.com` |
| `storeId` | Store id (Store settings → General) |
| `apiKey` | Greenfield API key (Account → Manage account → API keys) with `btcpay.store.cancreateinvoice`, `btcpay.store.canviewinvoices`, `btcpay.store.canviewstoresettings`, `btcpay.store.cancreatenonapprovedpullpayments` |
| `webhookSecret` | the secret you set on the store webhook |
| `expirationMinutes`, `speedPolicy` | optional checkout overrides |

## Sandbox setup

1. Use a BTCPay instance on **testnet/signet** (e.g. the public `https://testnet.demo.btcpayserver.org` or your
   own docker deployment with `NBITCOIN_NETWORK=testnet`). Create a store and a wallet.
2. Create a Greenfield API key with the permissions above, restricted to the store.
3. *Store settings → Webhooks → Create webhook*: payload URL `https://<your-host>/api/v1/public/webhooks/btcpay`
   (ngrok locally), set a secret, enable `InvoiceSettled`, `InvoiceExpired`, `InvoiceInvalid` (others are
   accepted and ignored). Enable "Automatic re-delivery".
4. Configure in Provisia: `PUT /api/v1/admin/payments/gateways/btcpay` with the config and `enabled: true`, then
   `POST /api/v1/admin/payments/gateways/btcpay/test`.
5. Pay an invoice from the portal with a testnet wallet. Pay less than due and let it expire to see a partial
   payment, pay more to see a credit-balance top-up. BTCPay's webhook page has a "Redeliver" button to test
   idempotency.

## Notes

- Fiat value received = Σ `totalPaid × rate` over the invoice's payment methods, rounded half-up to cents.
- Transaction ids: `<btcpay invoice id>` for settled invoices, `<btcpay invoice id>:partial` for partial payments.
- Event id for idempotency: `originalDeliveryId` (redeliveries) or `deliveryId`.
- Refunds create a pull payment (`refundVariant: Custom`, invoice currency); the customer claims it from the
  returned link in BTCPay, so refunds are reported `pending`.

## Tests

`pnpm --filter @provisia/gateway-btcpay test`
