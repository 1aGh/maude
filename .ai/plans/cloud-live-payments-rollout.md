# Cloud live payments — rollout plan

Drafted 2026-09-19, on the owner's request, while writing a post that promotes
Maude Cloud publicly. The post had to be re-framed ("free pilot, €19 later")
because the funnel cannot take money today, and the question "why can't it?"
deserved a written answer rather than a chat reply.

**Why the checkout cannot charge anyone right now.** Not a bug — three
deliberate brakes, all ours:

1. `apps/cloud/pricing.json` carries `live: { product: null, monthly: null,
   annual: null }` for both plans and the storage add-on. Nothing was ever
   created in Stripe live mode.
2. `pricing-core.mjs` `priceIdFor()` **throws** when the id for the current mode
   is missing — "no fallback to sandbox, ever. The throw is the feature." So a
   live key alone does not open the door; it produces a loud failure until the
   ids exist.
3. `stripeMode()` only reports `live` for an `sk_live_`/`rk_live_` key. The key
   in use is `rk_test_`, and the sandbox prices report `livemode: false`.

Plus two written promises that are gates, not intentions: `terms.mdx` says the
pack is reviewed by counsel **and** the VAT position settled with an accountant
before the first live charge, and `STATE.md` says nothing widens past the pilot
until the `CELL_LIVE_PAIRING` cross-surface run is green.

Prior art, do not re-derive: `archive/cloud-phase-8-stripe-pricing.md` (catalog +
resolver, live prices deliberately deferred) and
`archive/cloud-phase-24-self-service-ready.md` track D (D2 Stripe Tax and D5
pricing page shipped; D1, D3-live and D4's human half left open).

## Order matters

L1–L3 are off-code and can run in parallel with anything. **L4 is the one
irreversible step** and is gated on L1–L3 being done, because it is the moment a
stranger's card can be charged. L5–L7 are the proof that it worked.

## Tasks

- [ ] **L1 — accountant: the *identifikovaná osoba* question.** The open item
  named in `STATE.md` (2026-08-01). Stripe is merchant of record and remits VAT,
  but the CZ-side registration status decides what we invoice and report.
  `pricing.mdx` already publishes the net-vs-gross claim (€19 → €22,99 for a
  Czech customer) — confirm that claim is the accountant's, not ours.
  Output: a written note in `../docs/` recording the position and the date.

- [ ] **L2 — counsel review of the legal pack.** `terms.mdx`, `privacy.mdx`,
  `dpa.mdx`. Each carries a callout promising exactly this before the first live
  charge; shipping live money without it makes our own published text false.
  Extend `trust-claims.test.mjs` with anything the review changes, so the claim
  stays code-checked rather than prose.

- [ ] **L3 — Stripe account activated for live payments.** Business details,
  bank account, and the product/tax settings the sandbox already exercises
  (`automatic_tax` is wired — D2). Verify Stripe Tax is enabled in **live** mode
  too; a sandbox-only tax config is exactly the class of drift that produces a
  legally wrong first invoice.

- [ ] **L4 — create the live prices and fill the ids.** *Irreversible.* In
  Stripe **live** mode create: Cloud Project €19/mo + €190/yr, Dedicated €99/mo,
  storage add-on €5 per 50 GB block. Fill every `live` id in
  `apps/cloud/pricing.json`. Prices are immutable once created — a wrong number
  means a new price, never an edit, so read the amounts back before committing.
  Then run `assertAmountsMatchStripe` against live and let it, not the JSON, be
  the authority. `publicPricing()` must still carry no ids.

- [ ] **L5 — the ~€1 live purchase.** Phase 8's one unchecked acceptance
  criterion: *a real ~€1 live-mode purchase provisions a working cell
  unattended.* Use a throwaway live price, a real card, and watch it provision
  end to end without a hand on it. Refund afterwards. Then delete that price.

- [ ] **L6 — dunning on live mode (D3-live).** The ladder is already proven
  against a real Stripe **test clock** (trial → past_due → grace → suspend →
  export → warn → purge, with `do.send-export → ok` before any teardown). Live
  mode has no test clock, so this is a narrower check: confirm the live webhook
  endpoint is registered, signed, and that a real `invoice.payment_failed`
  reaches the reconciler. Do not re-prove the ladder; prove the wiring.

- [ ] **L7 — lift the pilot gate.** `CELL_LIVE_PAIRING` is a per-tenant
  allowlist, `alligators` only. Its unchecked acceptance criterion is the live
  cross-surface run (real cell, real desktop, real browser, one committer in
  `git log`). Green it, then widen. Also owner-gated and still open: **C3/C4**,
  the timed cold start measured by a non-technical human with a stopwatch, and
  the Windows certificate.

- [ ] **L8 — retract the pilot callouts.** Once L4–L7 are green, remove the
  "not yet taking live payments" callout from `pricing.mdx`, `terms.mdx`,
  `privacy.mdx` and `dpa.mdx` in the same change that makes them false — not
  later. A stale callout on a live funnel is worse than no callout.

## What the public post promised

The 2026-09-19 launch post says: registration is open, the pilot is **free**,
€19 per project is the **target** price, and pricing is per project rather than
per seat. Nothing there commits to a date. If L1–L8 slip, the post does not
become untrue — but a second post announcing "you can pay now" must not go out
before L8.
