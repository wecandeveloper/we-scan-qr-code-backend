# Stripe SaaS (v2) — local testing

## Environment

Copy variables from `env.saas.example` into your real `.env` as `STRIPE_SAAS_*`.

## Stripe CLI

Listen and forward to the SaaS webhook (uses raw JSON body on this path only):

```bash
stripe listen --forward-to localhost:5030/api/v2/webhooks/stripe
```

Use the `whsec_...` signing secret printed by the CLI as `STRIPE_SAAS_WEBHOOK_SECRET` while testing locally.

## Test matrix

1. **Successful subscription**  
   Complete Checkout in test mode; confirm `checkout.session.completed` and `customer.subscription.updated` update `SaasSubscription` and `Restaurant.subscription` (unless `billingOverride.enabled`).

2. **Failed renewal**  
   Trigger `invoice.payment_failed` (Stripe test cards or Dashboard); confirm status becomes `past_due`, invoice row exists, and admin email is attempted (requires mail env).

3. **Pause / resume (admin)**  
   `POST /api/v2/subscriptions/admin/pause` then `resume`; confirm `pause_collection` toggles and internal status maps to `paused` when paused.

4. **Duplicate webhooks**  
   Replay the same event ID; server should return `{ received: true, duplicate: true }` and not double-apply side effects.

5. **Billing override**  
   Superadmin manual tier change (legacy `PUT /api/restaurant/update-subscription` or v2 `PUT /api/v2/subscriptions/admin/billing-override`) sets `billingOverride.enabled`; webhooks should not overwrite `Restaurant.subscription` until override is cleared.

## Products

Create recurring **Prices** (monthly + yearly per plan) in the Stripe Dashboard and map them in `env.saas.example` (e.g. `STRIPE_SAAS_PRICE_STANDARD_MONTHLY`, `…_YEARLY`, etc.). Legacy single-price envs are still supported as a fallback.
