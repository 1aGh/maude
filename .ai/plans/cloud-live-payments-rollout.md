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
  `pricing.mdx` already publishes the net-vs-gross claim (€19 → €22.99 for a
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

- [ ] **L6 — dunning on live mode (D3-live).** **Precondition found 2026-10-02:
  `STRIPE_WEBHOOK_SECRET` is not set on the `maude-cloud` Worker** (only
  `STRIPE_SECRET_KEY` is). `worker.mjs` therefore rejects every Stripe webhook
  with a bare 400 today. The hourly reconcile sweep hides it ("a missed webhook
  costs at most an hour"), but on live mode payment events then arrive up to an
  hour late. Register the live endpoint, `wrangler secret put
  STRIPE_WEBHOOK_SECRET` with ITS signing secret, and see one event return 200
  before anything else in this task.
  Original scope: The ladder is already proven
  against a real Stripe **test clock** (trial → past_due → grace → suspend →
  export → warn → purge, with `do.send-export → ok` before any teardown). Live
  mode has no test clock, so this is a narrower check: confirm the live webhook
  endpoint is registered, signed, and that a real `invoice.payment_failed`
  reaches the reconciler. Do not re-prove the ladder; prove the wiring.

- [ ] **L7 — lift the pilot gate.** ~~`CELL_LIVE_PAIRING` is a per-tenant
  allowlist, `alligators` only.~~ **Already widened:** `apps/cells/wrangler.toml`
  has `CELL_LIVE_PAIRING = "*"` and `CELL_PROJECT_STORE = "*"` since 2026-09-25
  (followup-multiplayer-hardening G3a). The gate is therefore no longer "widen
  the allowlist" but **confirm the live cross-surface run is recorded green**
  (real cell, real desktop, real browser, one committer in `git log`) — STATE.md
  still lists it as unchecked; either link the evidence or run it. Also owner-gated and still open: **C3/C4**,
  the timed cold start measured by a non-technical human with a stopwatch, and
  the Windows certificate.

- [ ] **L7b — fleet ceiling.** `apps/cells/wrangler.toml` `max_instances = 5`.
  Customer #6 cannot get a container: their waiting room times out and
  provision-first ordering voids the sale (correct behaviour, no revenue).
  Before the first paid customer, decide the ceiling for the first wave and raise
  it — it is a billing decision as much as a capacity one (idle instances cost
  nothing only if cells sleep, see L7c).

- [ ] **L7c — unit economics: prove an idle cell sleeps.** Measured 2026-10-01/02
  (`archive/feature-cloud-cost-and-cold-start-ux.md`): a running `standard-1` cell costs
  ≈ $0.044/h (memory $0.036, CPU ~$0.006 after v1.6.5, disk $0.002). On the €19
  plan (~$20 net of Stripe) that is ~85 % margin at ~2 h/day, ~55 % for a busy
  team — and a **~$12/month loss** for a cell awake 24/7 (~$32). The hourly
  telemetry wake and the never-sleeping render are fixed (v1.6.1–v1.6.4);
  still unproven is that a cell sleeps while a paired desktop sits open and
  idle. Gate: one quiet night with no releases shows the Alligators cell at
  ~0 instance-hours (GraphQL `containersUsageAdaptiveGroups`). If it does not,
  fix idle detection before charging, or route always-on use to Dedicated
  (€99). Note the 14-day trial is pure cost — same rule applies.
  **2026-10-04 measurement (v1.6.11, scanner paths refused on a cold cell,
  `archive/feature-cells-no-wake-for-scanners.md`):** Alligators overnight
  (20–07Z) went from 3.07 to **1.41 instance-hours** (≈ $0.06/night). Not yet
  ~0: all 4 remaining wakes were anonymous bot `GET /` (Tencent Cloud, fake
  iPhone UA, plus one scanner sweep that opened on `/`), ~20 min each. No
  member woke it overnight, so idle detection itself works and the residue
  is a wake-policy problem. Next: members-only wake (design note in that plan).
  The gate stays open until a night measures ~0.

- [ ] **L8 — retract the pilot callouts.** Once L4–L7c are green, remove the
  "not yet taking live payments" callout from `pricing.mdx`, `terms.mdx`,
  `privacy.mdx` and `dpa.mdx` in the same change that makes them false — not
  later. A stale callout on a live funnel is worse than no callout.

## What the public post promised

The 2026-09-19 launch post says: registration is open, the pilot is **free**,
€19 per project is the **target** price, and pricing is per project rather than
per seat. Nothing there commits to a date. If L1–L8 slip, the post does not
become untrue — but a second post announcing "you can pay now" must not go out
before L8.
