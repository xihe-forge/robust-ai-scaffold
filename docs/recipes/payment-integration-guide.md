# Payment Integration Guide

> Based on real experience integrating Creem.io with SubtextAI (Next.js on Vercel).
> Covers provider selection, setup, implementation, testing, deployment, and common pitfalls.

---

## 1. Provider Selection

| Factor | Creem.io (MoR) | Stripe (Direct) |
|---|---|---|
| Tax & compliance | Handled by provider | You handle it |
| Payouts | Provider pays you net of fees | Stripe pays you, you file taxes |
| Complexity | Lower — fewer moving parts | Higher — more control |
| Best for | Indie / solo developers, small teams | Funded startups needing full control |

**Recommendation:** For indie and solo developers, use a **Merchant of Record (MoR)** like Creem.io. It removes the burden of sales tax, VAT, and compliance across jurisdictions. You receive net payouts and do not need to register for tax collection in every region.

---

## 2. Setup Checklist

### Account & Verification

- [ ] Register a business account at [creem.io](https://creem.io).
- [ ] Complete **KYC verification** — upload government-issued ID.
  - Tip: If the front/back detection fails on first attempt, crop the image tighter and retry. This is a known UX quirk.
- [ ] Set up **payout method**.
  - For non-US developers: **Wise** is recommended — supports multi-currency payouts with low conversion fees.
  - For US developers: direct bank transfer works fine.

### Product Configuration

- [ ] Create **two products** (or more, depending on your tier structure):
  - Monthly plan (e.g., "Pro Monthly — $9.99/mo")
  - Yearly plan (e.g., "Pro Yearly — $99.99/yr")
- [ ] Note the **product IDs** for each — you will need them as environment variables.

### API Credentials

- [ ] Generate an **API key** (starts with test mode — switch to live when ready).
- [ ] Generate or copy the **webhook secret**.
- [ ] Configure the **webhook URL** in the Creem dashboard:
  ```
  https://yourdomain.com/api/creem/webhook
  ```
  During development, use a tunnel (ngrok, Cloudflare Tunnel) to expose your local server.

---

## 3. Implementation Checklist

### Environment Variables

Add these to your `.env.local` (and later to your hosting provider):

```env
CREEM_API_KEY=creem_test_xxxx          # or creem_live_xxxx for production
CREEM_WEBHOOK_SECRET=whsec_xxxx
CREEM_PRODUCT_MONTHLY=prod_xxxx        # monthly plan product ID
CREEM_PRODUCT_YEARLY=prod_xxxx         # yearly plan product ID
JWT_SECRET=your-jwt-secret             # for verifying auth tokens
```

### API Routes

You need three routes:

#### a) Checkout (`POST /api/creem/checkout`)

1. Verify the user's auth token (JWT or session).
2. Determine which product ID to use based on the selected plan (monthly/yearly).
3. Call Creem's Create Checkout Session API with the product ID, customer email, and success/cancel URLs.
4. Return the checkout URL to the frontend for redirect.

```
Request:  { plan: "monthly" | "yearly" }
Response: { url: "https://checkout.creem.io/session/xxx" }
```

#### b) Webhook (`POST /api/creem/webhook`)

1. Read the raw request body (do not parse JSON before signature verification).
2. Verify the webhook signature using `CREEM_WEBHOOK_SECRET`.
3. Parse the event and handle relevant types:
   - `subscription.active` — activate the user's plan.
   - `subscription.cancelled` — downgrade to free.
   - `subscription.updated` — update plan details.
4. Implement **idempotency**: track processed event IDs (in-memory `Set` for simple apps, database for production) and skip duplicates.
5. Always return `200 OK` — even if you skip a duplicate. Returning non-200 causes Creem to retry.

#### c) Portal (`POST /api/creem/portal`)

1. Verify the user's auth token.
2. Call Creem's Customer Portal API with the customer ID.
3. Return the portal URL for redirect (user can manage billing, cancel, update payment method).

### Frontend Integration

- [ ] Checkout button calls `/api/creem/checkout` and redirects to the returned URL.
- [ ] **Auth guard**: if the user is not logged in when they click a pricing CTA, show the login modal first. Do not send unauthenticated requests to the checkout endpoint.
- [ ] After successful payment, Creem redirects to your success URL. On that page, fetch the updated user profile to reflect the new plan.

---

## 4. Testing

### Test Mode

- [ ] Use the **test API key** (not the live key) during development.
- [ ] Create **test products** in the Creem dashboard (or use the same products — test mode transactions are isolated).

### Test Card

```
Card number: 4242 4242 4242 4242
Expiry:      any future date (e.g., 12/30)
CVC:         any 3 digits (e.g., 123)
```

### End-to-End Test Flow

Run through this sequence manually before going live:

1. Click checkout button (logged in) — verify redirect to Creem checkout page.
2. Complete payment with the test card — verify redirect back to success page.
3. Check webhook received — verify the event was processed and user plan updated.
4. Open customer portal — verify the user can see their subscription.
5. Cancel subscription via portal — verify webhook fires and user plan reverts.

### Verification Queries

After the test flow, confirm in your database or state:

- User's plan field matches the expected tier.
- Subscription ID is stored.
- Creem customer ID is stored (needed for portal access).
- Event ID is recorded for idempotency.

---

## 5. Deployment (Vercel)

### Repository & Project Setup

- [ ] **Hobby plan limitation**: Vercel's free (Hobby) plan cannot deploy from a GitHub **organization** private repo. Workarounds:
  - Use a **personal** GitHub account repo.
  - Or upgrade to Vercel Pro.
- [ ] If your project is a monorepo, set the **Root Directory** in Vercel project settings to the app subdirectory (e.g., `apps/my-app`).

### Environment Variables

- [ ] Add **all** env vars in the Vercel project settings (Settings → Environment Variables):
  - `CREEM_API_KEY` (use the **live** key for production)
  - `CREEM_WEBHOOK_SECRET`
  - `CREEM_PRODUCT_MONTHLY`
  - `CREEM_PRODUCT_YEARLY`
  - `JWT_SECRET`
  - `NEXT_PUBLIC_SITE_URL` (your production domain)

### Custom Domain Setup

- [ ] Add your domain in Vercel project settings (Settings → Domains).
- [ ] In your DNS provider, add:
  - **A record**: `@` → `76.76.21.21`
  - **CNAME record**: `www` → `cname.vercel-dns.com`
- [ ] If using **Cloudflare**, set the proxy status to **DNS only** (gray cloud icon). Cloudflare's proxy interferes with Vercel's SSL certificate provisioning.
- [ ] Wait for SSL certificate to be issued (usually a few minutes).

### Post-Domain Checklist

- [ ] Update `NEXT_PUBLIC_SITE_URL` to the production domain (e.g., `https://yourdomain.com`).
- [ ] Update the **Creem webhook URL** in the dashboard to the production URL.
- [ ] Update success/cancel redirect URLs if they were hardcoded.
- [ ] Test the full checkout flow on the production domain.

---

## 6. Common Pitfalls

### Cloudflare Proxy Breaks Vercel SSL

**Symptom:** Custom domain shows SSL error or "too many redirects."
**Cause:** Cloudflare's orange-cloud proxy terminates SSL before Vercel can issue its own certificate.
**Fix:** Set the DNS record to **DNS only** (gray cloud). If you need Cloudflare's CDN, configure SSL mode to "Full (strict)" — but DNS-only is simpler.

### Token Key Mismatch

**Symptom:** User is logged in but checkout returns 401.
**Cause:** Login code stores the token under one key (e.g., `localStorage.setItem('auth_token', ...)`), but checkout code reads a different key (e.g., `localStorage.getItem('authToken')`).
**Fix:** Define the token key as a constant and import it everywhere:

```typescript
// constants/auth.ts
export const AUTH_TOKEN_KEY = 'auth_token';
```

### Webhook Idempotency

**Symptom:** User's plan gets toggled or duplicate records are created.
**Cause:** Creem retries webhook delivery if your endpoint was temporarily slow. Without idempotency, the same event is processed multiple times.
**Fix:** Track processed event IDs. For simple apps:

```typescript
const processedEvents = new Set<string>();

function handleWebhook(event: CreemEvent) {
  if (processedEvents.has(event.id)) return; // skip duplicate
  processedEvents.add(event.id);
  // ... process event
}
```

For production, store event IDs in your database with a unique constraint.

### Rate Limit UX

**Symptom:** Users see a raw 429 error page when hitting rate limits.
**Cause:** API returns HTTP 429, frontend doesn't handle it gracefully.
**Fix:** Return `200` with a wait message in the response body for user-facing endpoints:

```json
{
  "status": "rate_limited",
  "message": "You're moving fast! Please wait a moment and try again.",
  "retryAfter": 30
}
```

Reserve HTTP 429 for machine-to-machine APIs where the client is expected to handle retry logic.

### Webhook Signature Verification Fails in Next.js

**Symptom:** All webhooks return 400 — signature mismatch.
**Cause:** Next.js API routes (App Router) automatically parse the request body as JSON. The signature must be verified against the **raw** body bytes.
**Fix:** Read the raw body before any JSON parsing:

```typescript
// app/api/creem/webhook/route.ts
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('creem-signature');
  // verify signature against rawBody, then JSON.parse(rawBody)
}
```

---

## Quick Reference: Full Flow Diagram

```
User clicks "Subscribe"
  → Frontend checks auth (show login modal if needed)
  → POST /api/creem/checkout { plan: "yearly" }
  → Server creates Creem checkout session
  → Server returns { url: "https://checkout.creem.io/..." }
  → Frontend redirects to Creem checkout
  → User pays with card
  → Creem redirects to success URL
  → Creem sends webhook POST /api/creem/webhook
  → Server verifies signature, updates user plan
  → User sees updated plan on next page load
```

---

*Last updated: 2026-03-20 | Source: SubtextAI + Creem.io integration retrospective*
