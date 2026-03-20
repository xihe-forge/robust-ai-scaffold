# Frontend Review Checklist

> Practical checklist derived from real production bugs.
> Use this as a pre-launch and PR review reference for any frontend built on this scaffold.

---

## 1. Layout Consistency

- [ ] All page sections use the **same max-width** container. Mixed widths (e.g., one section at 960px and the next at 1120px) cause subtle misalignment that is easy to miss in code but obvious when scrolling.
- [ ] Padding and gap values are consistent across sibling sections. Avoid mixing different spacing values between cards in the same row.
- [ ] **Visually verify** alignment by scrolling through the full page at desktop width. Code-level review alone is not sufficient for catching layout inconsistencies.
- [ ] Text alignment matches the page type:
  - **Landing pages / marketing**: centered content is common.
  - **Dashboards / forms / articles**: left-aligned content is standard.
  - Don't force one alignment everywhere — match the context.

---

## 2. Internationalization (i18n)

### Navigation labels

- [ ] Nav items must be **short and similar length** across all supported languages. Long translations break horizontal nav layouts.
- [ ] Nav link containers should prevent wrapping or shrinking (e.g., `white-space: nowrap; min-width: fit-content`).
- [ ] Create **separate translation keys** for nav CTAs vs. body/hero CTAs:
  ```
  navCta: "Try Free"            // short — fits nav bar
  ctaStart: "Analyze Your First Message Free"  // long — fits hero section
  ```
  Reusing one key for both contexts forces a compromise that looks wrong in at least one place.

### Language toggle

- [ ] Test that the language toggle **actually switches content** end-to-end. Common failures:
  - Locale provider not wrapping the entire app (or wrapped inside a component that remounts).
  - Hydration mismatch: server renders one locale, client picks up another from `localStorage`.
  - Missing translation keys that silently fall back to the default language.
- [ ] After toggling, check that **every** visible string changed — not just the hero section.

---

## 3. Authentication UI

### Login modal

- [ ] Password requirements (minimum length, complexity rules) should **only appear during registration**, not during login. Showing them on login implies the user's password might be wrong because it doesn't meet current rules.

### Registration form

- [ ] Consider including a **password confirmation** field, OR use email verification as an alternative recovery path. Single-password registration without email verification leads to support requests from users who mistyped their password.

### Email validation

- [ ] Validate the **full email format** including domain and TLD, not just the presence of `@`.
  - Bad: `user@` passes validation.
  - Good: require `user@domain.tld` pattern at minimum.
- [ ] Use a simple regex like `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` rather than overly strict RFC validation that rejects valid edge-case addresses.

### Token storage

- [ ] The auth token storage key must be **identical** in every file that reads or writes it. A mismatch (e.g., `auth_token` in login code but `authToken` in checkout code) causes silent auth failures.
- [ ] Grep the codebase for all token key references before shipping:
  ```bash
  grep -rn "auth.token\|authToken\|auth_token\|AUTH_TOKEN" src/
  ```

---

## 4. Footer & Links

- [ ] **Never use `href="#"`** for placeholder links. Options:
  - Use a real route if the page exists.
  - Use `mailto:` for contact links.
  - Use `button` with `disabled` + a tooltip ("Coming soon") if the destination doesn't exist yet.
- [ ] Cross-promotion ads for sibling products:
  - **Live products**: active card style, clickable link.
  - **"Coming soon" products**: muted/disabled card style, no link or a non-navigating click.
- [ ] "Powered by" footer text should reference the **actual product/brand name**, not a generic label like "Powered by AI."

---

## 5. Pricing Section

- [ ] **Verify annual savings math** manually:
  ```
  monthly_price × 12 = annual_baseline
  annual_price = actual_charge
  savings = annual_baseline - annual_price
  savings_percent = (savings / annual_baseline) × 100
  ```
  Display the rounded percentage and the absolute dollar amount. Double-check that both match.
- [ ] Checkout buttons must **check authentication state** before initiating payment. If the user is not logged in, show the login/register modal first — do not redirect to a payment page that will fail.
- [ ] Currency symbol and code must be **consistent** across:
  - Pricing cards in the UI
  - Checkout session creation (API)
  - Marketing copy and documentation
  - Invoices / receipts (if applicable)

---

## 6. Mobile & Responsive

- [ ] Test every section at the project's **target breakpoints** (check `.planning/config.json` `responsive_breakpoints`; if not configured, use common mobile widths: 375px, 390px, 414px). Common failures:
  - Horizontal overflow from fixed-width elements.
  - Text overlapping buttons or images.
  - Grid layouts that don't collapse to single-column.
- [ ] If using a **bottom tab bar** (mobile nav), verify:
  - Page content has enough bottom padding so the last section is not hidden behind the tab bar.
  - The tab bar does not overlap floating action buttons or cookie banners.
- [ ] Test the **hamburger menu** (if used) opens and closes correctly, and that clicking a nav link closes the menu.
- [ ] Modals (login, signup) must be **scrollable** on short screens. A tall modal on a short viewport is unusable if it cannot scroll.

---

## Quick Pre-Launch Sweep

Use this condensed checklist for a final pass:

1. Open the app at desktop width and scroll top to bottom — any alignment jumps?
2. Switch language (if i18n) — did everything change? Any layout shifts?
3. Open at a mobile breakpoint — any overflow, overlap, or hidden content?
4. Click every link in the footer — any `#` hrefs or dead links?
5. Try checkout without logging in — does it prompt login?
6. Check pricing math with a calculator.
7. Grep for token key inconsistencies.
8. Register a new account — does the flow handle password errors gracefully?

---

*Last updated: 2026-03-20 | Source: production bug retrospective*
