# Legal readiness: public site v2 and Maude Cloud checkout

**Date:** 2026-11-04 · **Reviewed:** branch `feat/public-site-v2` (PR #193) at `8bc096ad2`, worktree `.claude/worktrees/public-site-v2`, the same as `origin/feat/public-site-v2`.
**Scope:** read-only. Nothing was edited, committed or deployed, and no key was used.

> **This is not legal advice.** It is a checklist of gaps for counsel (rollout gate L2) and for the accountant (L1). Statutory references are pointers that counsel must confirm. Sources are listed at the end.

---

## 0. Three findings that change the rest

1. **"Stripe is the merchant of record" is wrong as written.** Under Stripe Managed Payments the merchant of record is **Lemon Squeezy, trading as "Sold through Link", LLC**, a Utah company and Stripe affiliate. Customers see **Link** as the seller. Checkout and receipts say "Sold through Link", the card statement says `LINK.COM* <descriptor>`, and Link sends the invoices, receipts and trial emails. The buyer buys from Lemon Squeezy under *its* Buyer Terms. Those terms make refunds discretionary, put non-US consumers under English law, and cover the EU withdrawal right only for downloadable digital content. Michal's own terms then act as the service agreement (EULA) between him and the user.
   - The claim appears in `terms.mdx:52`, `pricing.mdx:27`, `pricing-plans.tsx:73` (implied), the comment in `checkout.mjs:182-199` and the kg decision `stripe-merchant-of-record-prices-are-net`.
   - Consequences: the terms must name the real merchant of record and point to its Buyer Terms. The privacy notice must list it as a separate controller for payment data. "Cancel from the billing page" must also mention link.com. Customers must be told what their statement and invoice will show.
2. **The prices in the repo differ from the brief.** The brief says €29/€290 with 25 GB and €129 with 250 GB. Both `apps/cloud/pricing.json` (same on `main`) and `site/lib/pricing.json` say **€19/€190 with 10 GB and €99 with 100 GB**, plus a €5 per 50 GB storage add-on. The site prints whatever that file says. The rollout plan's L4 and the Phase B runbook (`feature-public-site-v2.md:558`, "€19.00 + Czech VAT = €22.99") still use €19. Michal needs to settle the numbers before L4, because live prices are immutable once created.
3. **No consumer withdrawal flow exists anywhere.** There is no withdrawal information, no model form, no express-consent or acknowledgement step, no withdrawal function (the "button" of Directive 2023/2673) and no refund policy. This is the largest gap for selling to EU consumers.

---

## 1. Requirement table

Paths are relative to the worktree. "Site" means `site/`. "Cloud" means `apps/cloud/`, the sign-up, wizard and billing pages on `cloud.maude.sh`.

### A. Seller identity and imprint

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Name, IČO, address, register line (§435 OZ; CRD Art. 6(1)(b)-(c); §1820 OZ) | **partial** | `site/content/docs/legal/terms.mdx:14-21` (name, address, IČO, "Registered in the Czech Trade Licensing Register since 10 September 2014"). Repeated in `privacy.mdx:14` and `dpa.mdx:16`. Absent from the footer `site/components/v2/site-foot.tsx:57-59,78-80` and from every `cloud.maude.sh` page | An imprint line in the site footer and the cloud app footer. Name the trade licensing office (placeholder). Add a Czech-language form of the register line. |
| Contact e-mail | present | `terms.mdx:21`, `privacy.mdx:14` | Also put it in the footer imprint. Stripe's EEA terms ask for easy-to-find customer service contact (e-mail, and telephone where offered). Ask counsel whether a phone number is needed. |
| Merchant-of-record disclosure, correct entity | **wrong** | `terms.mdx:52`, `pricing.mdx:27`, `checkout-pages.mjs:105-107` ("handled by Stripe") | Name "Lemon Squeezy (Sold through Link, LLC)", link its Buyer Terms, and state the `LINK.COM*` descriptor. See §3. |

### B. Terms of service

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Terms in force for current pilot users | **gap** | `terms.mdx:6-8`: "Published before it is in force". Sign-up (`apps/cloud/pages.mjs:128-131`) and the wizard (`checkout-pages.mjs:102-104`) still say "By continuing you agree to the Terms" | Decide which text governs the free pilot today. A short "pilot terms apply until live payments" paragraph would do. |
| Subscription, auto-renewal | present (thin) | `terms.mdx:56` | State the renewal interval, the charge date, the reminder e-mails (Link sends a trial-ending reminder for trials over 7 days and a 12-month anniversary notice) and how to stop renewal. |
| Trial-to-paid conversion | **partial / inaccurate** | `terms.mdx:54`, `pricing.mdx:29`, `pricing-plans.tsx:77-78` ("card is authorised but not charged") | A Checkout trial saves and verifies the card. It places no authorisation hold. There is also a second trial path: the account trial needs **no card**, and *Choose a plan* (`account-pages.mjs:252-266`; `checkout.mjs:146-147`, `trialDays: null`) charges immediately. The terms must describe both paths accurately. |
| Cancellation | present | `terms.mdx:69-75`, `pricing.mdx:41-51` | Add that the subscription can also be cancelled at link.com. Say whether an annual plan is refunded pro rata on cancellation (today it is silent, so the answer is "no"). |
| Price changes | **missing** | `terms.mdx` has only general terms changes, at :79 | Add: notice period (for example 30 days), takes effect at the next renewal, right to cancel before it. |
| Changes to the terms | partial | `terms.mdx:79` ("reasonable notice") | Give a concrete notice period and the consumer's right to terminate. |
| Liability, warranty | **risk** | `terms.mdx:83-89` ("as is"; cap at 12 months of fees) | Consumers keep statutory conformity rights for digital services (Directive 2019/770; §2389a ff. OZ, the digital content rules in force from 2026-01-01). An "as is" clause must not purport to exclude them. Split the B2B cap from the consumer position. **Counsel.** |
| Governing law and jurisdiction | partial | `terms.mdx:91-93` | Add that a consumer may also sue in the courts of their own domicile (Brussels Ia). Reconcile with Lemon Squeezy's English-law Buyer Terms. |
| Consumer ADR (ČOI) | **missing** | none | Required: name ČOI as the ADR body (§14 Consumer Protection Act, ADR Directive). Wording in §3. |
| ODR platform link | n/a | none | The EU ODR platform closed on 20 July 2025 (Regulation 2024/3228). Do **not** add a link. |
| B2B vs B2C split | **missing** | none | Say who is a consumer, and which clauses apply only to businesses (liability cap, DPA, reverse charge). |

### C. Consumer withdrawal (14 days)

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Pre-contract information about the right of withdrawal (CRD Art. 6(1)(h); §1820(1)(g) OZ) | **missing** | none | A withdrawal section in the terms, linked from the wizard. |
| Express request to start the service early, plus acknowledgement (CRD Art. 7(3), 8(8), 14(3), 16(a)/(m); §1837 OZ) | **missing** | Checkout params `checkout.mjs:159-212` have no `consent_collection` or `custom_text` | **Trial path:** the contract starts at checkout and the 14-day trial covers the 14-day withdrawal period, so withdrawing costs nothing. Say so. **Choose-a-plan path (immediate charge):** the consumer needs a required checkbox before Checkout, the consent recorded with a timestamp, and the rule that withdrawing within 14 days refunds the fee minus the days used. A SaaS subscription is a *service*: the right lapses only on **full** performance, so "you lose your right" wording is wrong here. |
| Model withdrawal form (CRD Annex I(B); NV 363/2013 Sb.) | **missing** | none | Add it to the terms or as `/docs/legal/withdrawal`. |
| Online withdrawal function, two-step "withdraw from contract here" (Directive 2023/2673, new CRD Art. 11a, applies from 19 June 2026) | **missing** | the cancel ladder `checkout-routes.mjs:486-560` is cancellation, not withdrawal | Add a "Withdraw from contract" control on the billing page during the first 14 days, with a confirmation step and a durable-medium acknowledgement. Czech transposition was still in Parliament as of June 2026. **Counsel to confirm** whether it is in force in CZ, but build it anyway: it is the directive's date. |
| Confirmation on a durable medium (CRD Art. 8(7); §1824 OZ) | **missing** (our part) | `apps/cloud/email.mjs` has no order or terms e-mail. Link sends its own receipt. | A Maude e-mail after Checkout: plan, price, renewal, terms PDF or permalink version, withdrawal info, the consent given. |
| Refund policy | **missing** | none (the only refund promise is `terms.mdx:79`, unused part after a disadvantageous change) | A short refund policy. Stripe requires a "fair and neutral refund policy", and Link may refund on its own if Michal does not answer within 48 h. |

### D. Price display and auto-renew disclosure

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Consumer prices shown including VAT (UCPD Art. 7(4)(c); §12 Consumer Protection Act; PID 98/6 for goods) | **partial / risk** | Net prices with "Prices without VAT": `pricing-plans.tsx:25-79`, `cloud-band.tsx:52`, `pricing.mdx:14-27`. Wizard `checkout-pages.mjs:81,105-107`. A CZ example with VAT is given (`projectCz`) | For consumers, the headline price in an invitation to purchase should be the price including tax. Options: (a) a "Business / Personal" toggle where Personal shows the price including VAT, (b) "€X + VAT · €Y incl. 21 % CZ VAT" at equal prominence. **Counsel** to choose. |
| Currency | **risk** | Terms say euros (`terms.mdx:51`) | Managed Payments turns on **Adaptive Pricing** by default, so Checkout may show local currency. Turn it off, or disclose it. |
| Auto-renewal disclosure where the trial starts | **partial** | `checkout-pages.mjs:90` (trial free, stop any time), `pricing-plans.tsx:77-78` | Add next to the button: what is charged, when, how much, and how to stop. Wording in §3. The plan picker `account-pages.mjs:252-266` shows **no price, VAT note, renewal or terms link** at all. Fix that before live. |
| Storage add-on price | **missing on site** | `apps/cloud/pricing.json` addon, €5 per 50 GB | If it is sold, publish it. If not, say "not yet available". |

### E. Privacy (GDPR Art. 13)

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Controller identity and contact | present | `privacy.mdx:12-16` | — |
| Purposes and legal bases | present | `privacy.mdx:20-31, 58-64` | Map each table row to its basis. |
| Recipients and subprocessors | **partial** | `privacy.mdx:68`, `dpa.mdx:59-64` | Missing: **Lemon Squeezy / Link** (independent controller for checkout and billing), **Google** (sign-in), **GitHub** (the "automatic copy to your own GitHub" app), **Vercel Web Analytics** and Vercel hosting logs. Note that Anthropic is the user's own provider and receives nothing from the Cloud. |
| "No third-party analytics" | **false** | `privacy.mdx:33`. The site loads `@vercel/analytics` (`site/app/layout.tsx:1,115`). Also "tools without analytics" at `site/app/(home)/about/page.tsx:31` | Either remove Vercel Analytics or disclose it: cookieless, aggregated, Vercel Inc. as processor, legitimate interest, US transfer under the DPF/SCCs. |
| International transfers | partial | `privacy.mdx:70` (SCCs only) | Name the US providers (Cloudflare Inc., Stripe/Link, Resend, Vercel, Google, GitHub) and the mechanism for each (DPF or SCCs). |
| Retention | present | table `privacy.mdx:20-31` | Add website logs and analytics. Accountant to confirm the 10 years. |
| Statutory or contractual requirement to provide data; consequence of not providing it (Art. 13(2)(e)) | **missing** | none | One sentence. |
| Automated decisions (Art. 13(2)(f)) | **missing** | trial-abuse logic (`trial_claims`, email hash, `decideTrialProvision`) | State that there is none with legal effect, or describe it. |
| Website visitors (docs and marketing site) | **missing** | none | A short section on server logs and analytics. |
| Google sign-up skips the disclosure checkbox? | **verify** | `auth-routes.mjs:256-275` records `disclosure_accepted_at` for password sign-up only | Check the Google path, and record acceptance of the terms version too. |

### F. DPA (B2B)

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Art. 28(3) content | present (good) | `dpa.mdx` | — |
| Data location "EU" for Cloudflare | **unverified** | `dpa.mdx:61,86` | The R2 binding `apps/cloud/wrangler.toml:69-71` has no `jurisdiction = "eu"`. Confirm the bucket and Durable Objects jurisdiction, or soften the claim. Cloudflare Inc. is a US company either way, so name the transfer mechanism. |
| Subprocessor change notice period | partial | `dpa.mdx:57` | Give a number of days and the channel. |
| Applies to business customers only; accepted by use | partial | `dpa.mdx:12` | Say it applies when the customer acts as a business or controller. |

### G. Cookies and ePrivacy

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Consent banner on maude.sh | **probably n/a** | Fonts self-hosted (`layout.tsx:4,13`). No site code reads or writes localStorage or cookies. Vercel Web Analytics is cookieless | No banner needed if this holds. Disclose it in the privacy notice (E). Re-check if any embed, pixel or fumadocs `Banner` with a `globalKey` is added. |
| cloud.maude.sh | n/a | session cookie plus a 10-minute Google cookie (`privacy.mdx:33`), both strictly necessary | — (Stripe and Link cookies on their own domain are their responsibility) |

### H. Stripe and Managed Payments site requirements

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Clear product description | present | `/cloud`, `pricing.mdx`, terms §2 | — |
| Customer service contact | present (e-mail) | `terms.mdx:21` | Footer, see A. Keep the Dashboard support e-mail current: Link escalates to it, with a 48 h answer window. |
| Refund and cancellation policy | partial | cancellation yes, refund no | See C. |
| Terms and privacy URLs in Checkout settings | **unknown** | Dashboard | Set the ToS and privacy URLs in the Checkout settings. They then show in the Managed Payments footer. |
| Managed Payments available to a CZ sole-trader account in live mode | **unknown** | sandbox only | Confirm during L3. |

### I. Accessibility (EAA)

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| EAA for e-commerce services (Directive 2019/882; CZ Act 424/2023 Sb.) | **likely n/a** | — | Microenterprises providing **services** are exempt: fewer than 10 staff **and** turnover or balance sheet total of €2 M or less. An OSVČ with no staff qualifies. The exemption ends when either threshold is passed. A short voluntary accessibility statement is nice to have. The site already has a skip link (`layout.tsx:111`). |

### J. AI Act transparency and film credits

| Requirement | Status | Where | What to add |
| --- | --- | --- | --- |
| Art. 50(4) deployer disclosure for deep-fake audio or video (applies from 2 Aug 2026; the Omnibus did not delay it) | **unlabelled** | `site/components/v2/intro-film.tsx:17-29`. The voice-over is ElevenLabs stock voice "Sarah" and the music bed is generated (`feature-public-site-v2.md:716`) | A synthetic stock voice that impersonates nobody is arguably not a deep fake. A one-line label still costs nothing and removes the question. Add it under the player and in `intro.vtt`. **Counsel** for the final call. |
| Licence for commercial use (ElevenLabs voice and music) | **open** | `feature-public-site-v2.md:716` ("checks the music licence for commercial use") | Confirm the ElevenLabs plan allows commercial use without attribution, and the music source. Record it in `scripts/video/final/`. |
| Product-side AI features (BYOK generation) | out of scope | — | Mention in the terms that output from third-party AI providers falls under their terms. |

---

## 2. Priority

### Must fix before live payments (L4)
1. **Correct the merchant of record** everywhere it is named (terms, pricing docs, wizard copy, the code comment and the kg decision). Name Lemon Squeezy / Sold through Link, LLC, link its Buyer Terms, and disclose the `LINK.COM*` descriptor.
2. **Consumer withdrawal pack:**
   - the information in the terms;
   - the model form;
   - a required consent checkbox before an **immediate-charge** Checkout (Choose a plan), with the consent recorded;
   - a pro-rata refund rule;
   - a 2-step **withdrawal function** on the billing page;
   - a confirmation e-mail with the terms version and withdrawal info.
3. **ČOI ADR clause** in the terms.
4. **Consumer price display including VAT** (or counsel's written sign-off on net display), and a currency decision for Adaptive Pricing.
5. **Auto-renewal disclosure at the button**, in the wizard and in the plan picker. The picker today shows no price at all.
6. **Fix the inaccurate trial wording** ("authorised but not charged") and describe both trial paths.
7. **Privacy notice:**
   - remove "no third-party analytics" or remove Vercel Analytics;
   - add Link/Lemon Squeezy, Google, GitHub and Vercel;
   - name the transfer mechanisms;
   - add the Art. 13(2)(e)/(f) statements.
8. **Verify the "EU" data-location claim** in the DPA, or soften it.
9. **Footer imprint** (§435 OZ) on maude.sh and cloud.maude.sh.
10. **Settle the price figures** (€19 vs €29) before creating immutable live prices.
11. **Price-change clause** and a concrete notice period for changes to the terms.
12. Rollout gates L1 (accountant: identifikovaná osoba, VAT position under the merchant of record) and L2 (counsel) are still open. Every item above feeds L2.

### Should fix
- The consumer warranty and conformity carve-out in "as is" (terms §8); split B2B and B2C.
- Jurisdiction sentence for consumers; reconcile with the English-law Buyer Terms.
- A refund policy page (Stripe requirement).
- Say in the terms that cancellation also works at link.com; say the annual plan is not refunded pro rata (or that it is).
- Record terms-version acceptance (not only the disclosure). Check the Google sign-up path.
- State which pilot terms apply to today's free users.
- A label on the intro film (AI voice and music); confirm the commercial licences.
- Publish or hide the storage add-on price.
- DPA: a subprocessor notice period and "applies to business customers".

### Nice to have
- A voluntary accessibility statement.
- A Czech-language version of the terms for CZ consumers (ask counsel whether CZ consumer contracts need Czech).
- A phone contact.
- A "What's on your card statement" FAQ.

---

## 3. Copy and flow additions for the site session

Placeholders in `[[DOUBLE BRACKETS]]` need Michal's or counsel's input. The identity data shown is copied from `terms.mdx:16-19` and is **already published by Michal**. Nothing has been added to it.

### 3.1 Footer imprint: `site/components/v2/site-foot.tsx` (the `ps-foot-base` row, :78-80) and the cloud app shell footer
```
Bc. Michal Dovrtěl · IČO 03387666 · Houbalova 2088/5, 628 00 Brno, Czech Republic ·
registered in the Trade Licensing Register ([[ŽIVNOSTENSKÝ ÚŘAD — e.g. Úřad městské části / Magistrát města Brna]]) · cloud@maude.sh
```
Add a "Withdrawal & refunds" link under Legal (`site-foot.tsx:38-45`) and a `/withdrawal` redirect in `site/next.config.mjs:17-19`.

### 3.2 `site/content/docs/legal/terms.mdx` §4 Money: replace :52-53
> **Who sells you the subscription.** Payment, VAT and invoicing are handled by our reseller and merchant of record, **Lemon Squeezy (Sold through Link, LLC)**, a Stripe company. You buy the subscription from them under their [Buyer Terms](https://www.lemonsqueezy.com/buyer-terms). Your use of Maude Cloud is governed by these terms. Checkout, receipts and invoices show "Sold through Link", and your card statement shows `LINK.COM* [[STATEMENT DESCRIPTOR]]`. They calculate and add your country's VAT. A business that gives a valid VAT id is charged under reverse charge.
>
> [[ACCOUNTANT L1: one sentence on the provider's own VAT status, or delete]]

Replace :54 (trial):
> **Trial.** A new project is free for [[14]] days. If you start it through checkout, your card is saved and checked but not charged. Unless you cancel before the trial ends, the plan you chose starts automatically on [[the date shown at checkout]] and is charged then, and at every renewal after that. You are reminded by e-mail before the trial ends. If you start a free project from the desktop app, no card is needed, and nothing is charged until you choose a plan.

Add after :56:
> **Price changes.** We tell you at least [[30]] days before a new price applies. It applies from your next renewal, and you may cancel before then without cost.

### 3.3 New section in `terms.mdx`: "If you are a consumer: withdrawal"
> If you buy as a consumer in the EU, you may withdraw from the contract within **14 days** of concluding it, without giving a reason.
>
> - **If you started with a free trial**, the trial covers that period. Cancel before the trial ends and you pay nothing.
> - **If you chose a plan that starts immediately**, you asked us to start the service before the 14 days end. If you withdraw, we refund what you paid minus a proportionate amount for the days you used.
>
> To withdraw, use **Withdraw from contract** on your project's billing page. You can also send us a clear statement, for example using the [model form](/docs/legal/withdrawal), to cloud@maude.sh. We confirm by e-mail and refund within 14 days through the original payment method.
>
> [[COUNSEL: reconcile with the merchant of record's Buyer Terms. Who refunds, and who is the "trader" for withdrawal?]]

### 3.4 New page `site/content/docs/legal/withdrawal.mdx`: model withdrawal form
Use the standard text from CRD Annex I(B) / NV 363/2013 Sb.:
> To: Bc. Michal Dovrtěl, Houbalova 2088/5, 628 00 Brno, Czech Republic, cloud@maude.sh
> I/We (*) hereby give notice that I/We (*) withdraw from my/our (*) contract for the provision of the following service: Maude Cloud — project [[project id]]
> Ordered on (*) / received on (*): …
> Name of consumer(s): … Address of consumer(s): …
> Signature of consumer(s) (only if this form is notified on paper): … Date: …
> (*) Delete as appropriate.

### 3.5 Consumer disputes: `terms.mdx` §9 Law, after :93
> Consumers may also bring proceedings in the courts where they live. For out-of-court resolution of a consumer dispute you may contact the Czech Trade Inspection Authority (Česká obchodní inspekce), Štěpánská 567/15, 120 00 Praha 2, [adr.coi.cz](https://adr.coi.cz), which is the competent ADR body. [[COUNSEL: confirm the current ČOI ADR address and URL]]

### 3.6 Liability carve-out: `terms.mdx` §8, after :85
> If you are a consumer, nothing in this section limits your statutory rights when the service does not conform to the contract.

### 3.7 Wizard: `apps/cloud/checkout-pages.mjs:90-108` (and the plan picker `account-pages.mjs:252-266`, which needs a price, a VAT line and a terms link added)
Above the button:
> **Free for [[14]] days, then [[€X]] a month + VAT ([[€Y]] incl. 21 % Czech VAT; your country's rate applies).** It renews automatically every [[month/year]] until you cancel. Cancel any time before [[trial end date]] and nothing is charged. You can cancel on your project's billing page or at link.com.

Replace the passive "By continuing you agree…" (:102-104) with a required checkbox. Record the timestamp and terms version on the project or account, as `disclosure_accepted_at` already does:
> ☐ I agree to the [Terms](https://maude.sh/terms) and have read the [Privacy notice](https://maude.sh/privacy) and the [withdrawal information](https://maude.sh/withdrawal).

For an **immediate-charge** plan (Choose a plan, no trial), add a second required checkbox:
> ☐ I ask for the service to start now, before the 14-day withdrawal period ends. If I withdraw, I will pay for the days I have used.

Replace :105-107:
> Payment is processed by Lemon Squeezy (Sold through Link), our merchant of record, who add your country's VAT. The next screen shows the exact total. Nothing is charged today.

In Checkout (`checkout.mjs:checkoutSessionParams`), consider `consent_collection[terms_of_service]=required` plus `custom_text[terms_of_service_acceptance][message]` linking the terms. Check that Managed Payments accepts them; the terms URL is set in the Dashboard Checkout settings.

### 3.8 Public pricing: `site/components/v2/pricing-plans.tsx:72-79`, `cloud-band.tsx:52`, `pricing.mdx:27-29`
> Prices shown without VAT. **For individuals:** [[€Y]] a month including 21 % Czech VAT; other EU countries pay their own rate, shown before you pay. Businesses with a VAT id pay [[€X]] (reverse charge).
> The first [[14]] days are free. After that the plan renews automatically until you cancel.

Remove "Your card is authorised but not charged". It is not what a Checkout trial does.

### 3.9 Privacy: `site/content/docs/legal/privacy.mdx`
- :33: replace "no third-party analytics … sets no analytics cookies" with:
  > This website uses **Vercel Web Analytics**, which counts page views without cookies and without storing anything on your device. Vercel Inc. processes it for us under our legitimate interest in knowing which pages are read. [[or: remove `<Analytics />` from site/app/layout.tsx:115 and keep the old sentence]]
- :68: extend the recipients:
  > **Lemon Squeezy / Sold through Link, LLC** (a Stripe company): sells you the subscription, processes the payment and issues invoices, as an independent controller under [its privacy policy](https://stripe.com/privacy). **Google**: if you sign in with Google. **GitHub**: only if you connect the automatic copy to your own GitHub, at your instruction. **Vercel**: hosts this website and its analytics.
- :70: name the mechanism for each US recipient: [[EU-US Data Privacy Framework certification or SCCs, per provider]].
- New lines:
  > You need to give your e-mail address to have an account, and billing details to buy a plan; without them we cannot provide the service. We make no decisions about you by automated means alone that have legal or similarly significant effects. [[COUNSEL: check the trial-abuse rule, one free trial per e-mail address]]
- Fix `site/app/(home)/about/page.tsx:31` ("tools without analytics") if Vercel Analytics stays.

### 3.10 DPA: `site/content/docs/legal/dpa.mdx`
- :61 and :86: "EU" → [[confirm R2 `jurisdiction = "eu"` / DO jurisdiction]]. Otherwise write "EU where available; Cloudflare, Inc. (US) under SCCs/DPF".
- :57: "notice at least [[30]] days before".
- :12: "This addendum applies when you use the service as a business and act as a controller."

### 3.11 Intro film: `site/components/v2/intro-film.tsx` (under the `<video>`) and as the first cue of `site/public/intro.vtt`
> Voice-over generated with AI (ElevenLabs). Music generated with AI ([[tool]]). Screens are real recordings of Maude.

### 3.12 Code comment and kg
Correct `apps/cloud/checkout.mjs:182-199`. Supersede the kg decision `stripe-merchant-of-record-prices-are-net` with one that names Lemon Squeezy / Link as merchant of record. That is a decision record, so leave it to the owner's session.

---

## 4. Open questions only Michal or counsel can answer

1. **Prices:** €19/€190 with 10 GB and €99 with 100 GB (repo), or €29/€290 with 25 GB and €129 with 250 GB (brief)? The storage add-on: sold or not?
2. **Merchant of record:** under Managed Payments, is Michal still the "trader" toward consumers for withdrawal, conformity and pre-contract information, or does Lemon Squeezy carry it? How do Michal's terms sit alongside the Buyer Terms (English law, discretionary refunds)? (Counsel)
3. **Is Managed Payments available** for a Czech sole-trader account in **live** mode? Does it cover VAT for all target countries? Outside its covered countries the seller stays liable. (L3, Michal in the Dashboard)
4. **VAT and accounting (L1):** identifikovaná osoba status for services bought from abroad (Stripe fees) and the supply to Lemon Squeezy; who issues which document to whom; whether supplies to the merchant of record count toward the CZK 2 M VAT registration threshold. (Accountant)
5. **Consumer price display:** is net plus a CZ example enough, or must B2C prices lead with VAT included? Is a geo- or toggle-based display wanted? (Counsel)
6. **Adaptive Pricing:** keep local-currency presentment (and change "in euros"), or turn it off?
7. **Withdrawal button:** is the Czech transposition of Directive 2023/2673 in force now, with what wording? (Counsel)
8. **Do pilot users today** agree to the published terms, which say they are not in force, or to separate pilot terms?
9. **Data location:** were the R2 bucket and Durable Objects created with EU jurisdiction? If not, drop or qualify the "EU" claim.
10. **Liability cap and the "as is" clause** for consumers vs businesses; whether a Czech-language version of the terms is needed for CZ consumers. (Counsel)
11. **Trade licensing office** to name in the imprint, and whether a phone contact should be published.
12. **Intro film:** the ElevenLabs plan tier (commercial use, attribution) and the music source and licence; whether to label it as AI-generated.
13. **Refund policy beyond the law:** offer a goodwill window (for example the first annual payment within 14 days of renewal), or only the statutory minimum?

---

## Sources

- Stripe docs, "How Managed Payments works" (MoR handled by Link; "Sold through Link"; `LINK.COM*` descriptor; Adaptive Pricing on by default; Link sends receipts and trial e-mails; 48 h escalation; custom ToS in Checkout settings): https://docs.stripe.com/payments/managed-payments/how-it-works
- Link support, "Why does it say LemonSqueezy on my invoice": https://support.link.com/questions/why-does-it-say-lemonsqueezy-on-my-invoice
- Link support, "Sold through Link" refunds: https://support.link.com/questions/sold-through-link-refunds
- Lemon Squeezy Buyer Terms: https://lemonsqueezy.com/buyer-terms
- Stripe Managed Payments service terms (preview; names Lemon Squeezy LLC as "SMP" and MoR): https://stripe.com/nz/legal/managed-payments
- Stripe Services Agreement (refund policy, customer service contact, disclosure duties): https://stripe.com/legal/managed-payments
- Directive 2023/2673, withdrawal function (CRD Art. 11a, from 19 June 2026): https://www.iubenda.com/en/blog/the-new-online-withdrawal-function-what-eu-directive-2023-2673-means-for-your-business/ ; Czech status: https://dostupnyadvokat.cz/en/blog/online-stores-will-soon-have-a-cancel-order-button-but-the-czech-amendment-is-not-yet-finalized
- End of the ODR platform (Reg. 2024/3228, 20 July 2025) and the ADR information duty: https://cms.law/en/svk/legal-updates/the-odr-platform-is-closing-what-businesses-need-to-know ; https://www.taylorwessing.com/en/insights-and-events/insights/2025/01/abolition-of-the-odr-platform
- §1837 OZ / digital content (Czech): https://www.pravniprostor.cz/clanky/ostatni-pravo/rozhovor-jiri-kucera-o-digitalnich-sluzbach-digitalnim-obsahu ; https://www.podnikatel.cz/zakony/novy-obcansky-zakonik/f7485348/
- §435 OZ: https://www.podnikatel.cz/zakony/novy-obcansky-zakonik/zneni-20230106/f4580257/
- Czech 2023 consumer amendment (Act 374/2022 Sb.), auto-renewal: https://www.taylorwessing.com/zh-hant/insights-and-events/insights/2023/01/amendment-to-the-czech-consumer-protection-act ; https://dostupnyadvokat.cz/en/blog/automatic-subscription-renewal
- EAA microenterprise exemption: https://www.ccpc.ie/business/wp-content/uploads/sites/3/2025/04/Microenterprise-Guidelines-Consultation-Draft-1-3.pdf ; https://www.taylorwessing.com/de/interface/2025/accessibility/key-eu-accessibility-act-exemptions-and-the-challenges-they-pose
- AI Act Art. 50 from 2 Aug 2026, Omnibus grace only for 50(2): https://www.ictrecht.nl/en/blog/heads-up-ai-act-transparency-obligations-now-in-effect ; https://labs.cloudsecurityalliance.org/wp-content/uploads/2026/07/CSA_research_note_eu_ai_act_article_50_transparency_20260729-csa-styled-1.pdf

Not confirmed by search and left to counsel: the exact text of §12 of the Consumer Protection Act on prices including tax, Czech ADR contact details, and how Act 424/2023 Sb. words the microenterprise exemption.
