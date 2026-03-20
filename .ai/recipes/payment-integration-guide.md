# Payment Integration Guide

> Practical guide for adding subscription payments to projects built on this scaffold.
> Uses Creem.io (Merchant of Record) as the primary example; principles apply to Stripe, Paddle, LemonSqueezy, etc.

---

## 1. Provider Selection

| Factor | MoR (Creem, Paddle, LemonSqueezy) | Direct (Stripe) |
|---|---|---|
| Tax & compliance | Handled by provider | You handle it |
| Payouts | Provider pays you net of fees | Stripe pays you, you file taxes |
| Complexity | Lower — fewer moving parts | Higher — more control |
| Best for | Indie / solo developers, small teams | Funded startups needing full control |

**Recommendation:** For indie and solo developers, use a **Merchant of Record (MoR)**. It removes the burden of sales tax, VAT, and compliance across jurisdictions.

---

## 2. Setup Checklist

### Account & Verification

- [ ] Register a merchant account with your chosen provider.
- [ ] Complete identity verification (KYC) — upload government-issued ID.
- [ ] Set up **payout method**.
  - For non-US developers: **Wise** is recommended — supports multi-currency payouts with low conversion fees.
  - For US developers: direct bank transfer works fine.

### Product Configuration

- [ ] Create products matching your pricing tiers (e.g., monthly, yearly, or whatever structure your project uses).
- [ ] Note the **product IDs** for each — you will need them as environment variables.

### API Credentials

- [ ] Generate an **API key** (start in test mode — switch to live when ready).
- [ ] Generate or copy the **webhook secret**.
- [ ] Configure the **webhook URL** in the provider dashboard:
  ```
  https://yourdomain.com/api/payment/webhook
  ```
  During development, use a tunnel (ngrok, Cloudflare Tunnel) to expose your local server.

---

## 3. Implementation Checklist

### Environment Variables

Add these to your `.env.local` (and later to your hosting provider):

```env
PAYMENT_API_KEY=xxxx               # test key during development, live key in production
PAYMENT_WEBHOOK_SECRET=whsec_xxxx
PAYMENT_PRODUCT_IDS=prod_monthly:prod_xxxx,prod_yearly:prod_xxxx
JWT_SECRET=your-jwt-secret         # for verifying auth tokens
```

### API Routes

You need three routes:

#### a) Checkout (`POST /api/payment/checkout`)

1. Verify the user's auth token (JWT or session).
2. Determine which product ID to use based on the selected plan.
3. Call the provider's Create Checkout Session API with the product ID, customer email, and success/cancel URLs.
4. Return the checkout URL to the frontend for redirect.

```
Request:  { plan: "monthly" | "yearly" }
Response: { url: "https://checkout.provider.com/session/xxx" }
```

#### b) Webhook (`POST /api/payment/webhook`)

1. Read the raw request body (do not parse JSON before signature verification).
2. Verify the webhook signature using the webhook secret.
3. Parse the event and handle relevant types:
   - `subscription.active` — activate the user's plan.
   - `subscription.cancelled` — downgrade to free.
   - `subscription.updated` — update plan details.
4. Implement **idempotency**: track processed event IDs and skip duplicates.
5. Always return `200 OK` — even if you skip a duplicate. Returning non-200 causes providers to retry.

#### c) Customer Portal (`POST /api/payment/portal`)

1. Verify the user's auth token.
2. Call the provider's Customer Portal API with the customer ID.
3. Return the portal URL for redirect (user can manage billing, cancel, update payment method).

### Frontend Integration

- [ ] Checkout button calls the checkout endpoint and redirects to the returned URL.
- [ ] **Auth guard**: if the user is not logged in when they click a pricing CTA, show the login modal first. Do not send unauthenticated requests to the checkout endpoint.
- [ ] After successful payment, the provider redirects to your success URL. On that page, fetch the updated user profile to reflect the new plan.

---

## 4. Testing

### Test Mode

- [ ] Use the **test API key** (not the live key) during development.
- [ ] Create **test products** in the provider dashboard (or use the same products — test mode transactions are typically isolated).

### Test Card

Most providers support the standard test card:

```
Card number: 4242 4242 4242 4242
Expiry:      any future date (e.g., 12/30)
CVC:         any 3 digits (e.g., 123)
```

### End-to-End Test Flow

Run through this sequence manually before going live:

1. Click checkout button (logged in) — verify redirect to checkout page.
2. Complete payment with the test card — verify redirect back to success page.
3. Check webhook received — verify the event was processed and user plan updated.
4. Open customer portal — verify the user can see their subscription.
5. Cancel subscription via portal — verify webhook fires and user plan reverts.

### Verification Queries

After the test flow, confirm in your database or state:

- User's plan field matches the expected tier.
- Subscription ID is stored.
- Customer ID is stored (needed for portal access).
- Event ID is recorded for idempotency.

---

## 5. Deployment Notes

### Environment Variables

- [ ] Add **all** payment-related env vars in your hosting provider's settings.
- [ ] Use the **live** API key for production (not the test key).
- [ ] Set `SITE_URL` / `PUBLIC_URL` to your production domain.

### Post-Domain Checklist

- [ ] Update the **webhook URL** in the provider dashboard to the production URL.
- [ ] Update success/cancel redirect URLs if they were hardcoded during development.
- [ ] Test the full checkout flow on the production domain.

### Cloudflare + Vercel Note

If using Cloudflare DNS with Vercel hosting: set DNS records to **DNS only** (gray cloud icon). Cloudflare's proxy can interfere with Vercel's SSL certificate provisioning, causing "too many redirects" errors. Refer to your hosting provider's docs for the correct DNS configuration.

---

## 6. Common Pitfalls

### Token Key Mismatch

**Symptom:** User is logged in but checkout returns 401.
**Cause:** Login code stores the token under one key (e.g., `auth_token`), but checkout code reads a different key (e.g., `authToken`).
**Fix:** Define the token key as a constant and import it everywhere:

```typescript
// constants/auth.ts
export const AUTH_TOKEN_KEY = 'auth_token';
```

### Webhook Idempotency

**Symptom:** User's plan gets toggled or duplicate records are created.
**Cause:** Provider retries webhook delivery if your endpoint was temporarily slow.
**Fix:** Track processed event IDs. For simple apps, an in-memory Set works; for production, store event IDs in your database with a unique constraint.

### Webhook Signature Verification Fails

**Symptom:** All webhooks return 400 — signature mismatch.
**Cause:** Some frameworks (e.g., Next.js App Router) automatically parse the request body as JSON. The signature must be verified against the **raw** body bytes.
**Fix:** Read the raw body before any JSON parsing:

```typescript
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-webhook-signature');
  // verify signature against rawBody, then JSON.parse(rawBody)
}
```

### Rate Limiting

**Symptom:** Users see raw error pages when hitting rate limits.
**Fix:** Handle 429 responses gracefully in the frontend — show a friendly message with retry guidance instead of a crash page. The API should return proper `429` status with a `Retry-After` header; the frontend should catch it and display a user-friendly message.

---

## Quick Reference: Full Flow Diagram

```
User clicks "Subscribe"
  → Frontend checks auth (show login modal if needed)
  → POST /api/payment/checkout { plan: "yearly" }
  → Server creates checkout session with provider
  → Server returns { url: "https://checkout.provider.com/..." }
  → Frontend redirects to provider checkout
  → User pays with card
  → Provider redirects to success URL
  → Provider sends webhook POST /api/payment/webhook
  → Server verifies signature, updates user plan
  → User sees updated plan on next page load
```

---

*Last updated: 2026-03-20 | Source: production integration retrospective*
