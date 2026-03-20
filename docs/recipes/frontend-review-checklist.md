# Frontend Review Checklist

> Derived from real issues found during SubtextAI development.
> Use this as a pre-launch and PR review reference for any frontend built on this scaffold.

---

## 1. Layout Consistency

- [ ] All page sections use the **same max-width** container (e.g., `max-w-5xl`). Mixed widths cause subtle misalignment that is easy to miss in code but obvious when scrolling.
- [ ] Card content is **centered by default**. Only left-align when there is a structural reason (e.g., a feature bullet list that reads better left-aligned).
- [ ] **Visually verify** alignment by scrolling through the full page at desktop width. Code-level review alone is not sufficient — a `max-w-4xl` next to a `max-w-5xl` section is hard to catch in a diff but immediately visible in the browser.
- [ ] Padding and gap values are consistent across sibling sections. Avoid mixing `p-6` and `p-8` between cards in the same row.

---

## 2. Internationalization (i18n)

### Navigation labels

- [ ] Nav items must be **short and similar length** across all supported languages. Long translations break horizontal nav layouts.
- [ ] Add `min-width` and `whitespace-nowrap` (Tailwind: `min-w-fit whitespace-nowrap`) to nav link containers so they never wrap or shrink.
- [ ] Create **separate translation keys** for nav CTAs vs. body/hero CTAs:
  ```
  navCta: "Try Free"            // short — fits nav bar
  ctaStart: "Analyze Your First Message Free"  // long — fits hero section
  ```
  Reusing one key for both contexts forces a compromise that looks wrong in at least one place.

### Language toggle

- [ ] Test that the language toggle **actually switches content** end-to-end. Common failures:
  - `LocaleProvider` not wrapping the entire app (or wrapped inside a component that remounts).
  - Hydration mismatch: server renders one locale, client picks up another from `localStorage`.
  - Missing translation keys that silently fall back to the default language.
- [ ] After toggling, check that **every** visible string changed — not just the hero section.

---

## 3. Authentication UI

### Login modal

- [ ] Password requirements (minimum length, complexity rules) should **only appear during registration**, not during login. Showing them on login implies the user's password might be wrong because it doesn't meet current rules.

### Registration form

- [ ] Must include a **password confirmation** field. Single-password registration leads to support requests from users who mistyped their password.

### Email validation

- [ ] Validate the **full email format** including domain and TLD, not just the presence of `@`.
  - Bad: `user@` passes validation.
  - Good: require `user@domain.tld` pattern at minimum.
- [ ] Consider a simple regex like `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` rather than overly strict RFC validation that rejects valid edge-case addresses.

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
  - **Live products**: white/active card style, clickable link.
  - **"Coming soon" products**: gray/muted/disabled card style, no link or a non-navigating click.
- [ ] "Powered by" footer text should reference the **actual brand name** (e.g., "Powered by SubtextAI"), not a generic label like "Powered by AI."

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

- [ ] Test every section at **mobile breakpoints** (375px, 390px, 414px at minimum). Common failures:
  - Horizontal overflow from fixed-width elements.
  - Text overlapping buttons or images.
  - Grid layouts that don't collapse to single-column.
- [ ] If using a **bottom tab bar** (mobile nav), verify:
  - Page content has enough bottom padding (`pb-20` or equivalent) so the last section is not hidden behind the tab bar.
  - The tab bar does not overlap floating action buttons or cookie banners.
- [ ] Test the **hamburger menu** (if used) opens and closes correctly, and that clicking a nav link closes the menu.
- [ ] Modals (login, signup) must be **scrollable** on short screens. A 700px-tall modal on a 667px screen (iPhone SE) is unusable if it cannot scroll.

---

## Quick Pre-Launch Sweep

Use this condensed checklist for a final pass:

1. Open the app at 1440px and scroll top to bottom — any alignment jumps?
2. Switch language — did everything change? Any layout shifts?
3. Open at 375px — any overflow, overlap, or hidden content?
4. Click every link in the footer — any `#` hrefs or dead links?
5. Try checkout without logging in — does it prompt login?
6. Check pricing math with a calculator.
7. Grep for token key inconsistencies.
8. Register a new account — is there a confirm-password field?

---

*Last updated: 2026-03-20 | Source: SubtextAI development retrospective*
