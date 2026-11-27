// Starting a project, as the person sees it — Cloud Phase 14.
//
// Three pages: the wizard, the waiting room, and billing. Server-rendered, no
// script — the waiting room "polls" with a meta refresh, because a page whose
// whole job is to be honest while infrastructure is uncertain should not
// depend on any of it working.

import { formatDay } from './billing.mjs';
import { appShell, lockup, PAGE_CSS, PUBLIC_CSS } from './brand.mjs';
import { PROVISION_STEPS } from './provisioning.mjs';

const EXTRA_CSS = `
  .plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin: var(--space-4) 0 var(--space-2); }
  .plan {
    display: block; cursor: pointer;
    background: var(--bg-1); border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg); padding: var(--space-5);
    transition: border-color var(--dur-soft) var(--ease-out);
  }
  .plan:hover { border-color: var(--border-default); }
  .plan input { accent-color: var(--accent); margin-right: var(--space-2); }
  .plan .price { font-family: var(--font-display); font-size: var(--type-xl); line-height: var(--lh-xl); font-weight: 600; margin: var(--space-2) 0 0; }
  .plan .per { color: var(--fg-2); font-size: var(--type-sm); }
  .interval { display: flex; gap: var(--space-5); margin: var(--space-4) 0; font-size: var(--type-base); }
  .steps { list-style: none; margin: var(--space-6) 0; padding: 0; }
  .steps li { padding: var(--space-3) 0 var(--space-3) var(--space-6); position: relative; color: var(--fg-2); }
  .steps li::before { content: ''; position: absolute; left: var(--space-2); top: 50%; translate: 0 -50%; width: 8px; height: 8px; border-radius: var(--radius-pill); background: var(--bg-4); }
  .steps li.now { color: var(--fg-0); font-weight: 600; }
  .steps li.now::before { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
  .steps li.done { color: var(--fg-1); }
  .steps li.done::before { background: var(--status-success); }
  .card.reassure { box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--status-success); }
  .ma-plan.warn { box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--status-warn); }
  .ma-plan { margin-bottom: var(--space-4); }
  .card ul { margin: var(--space-3) 0 var(--space-4); padding-left: var(--space-6); line-height: 1.9; color: var(--fg-2); }
  .card ul strong { color: var(--fg-0); }
  .actions { display: flex; gap: var(--space-4); flex-wrap: wrap; margin: var(--space-5) 0 var(--space-4); }
  .pair { display: flex; gap: var(--space-4); align-items: flex-end; }
  .pair > div { flex: 1; }
  .plan { box-shadow: var(--shadow-sm), inset 0 0 0 0.5px var(--border-default); border: 0; }
  .plan:has(input:checked) { box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--accent); }
  .np { display: flex; flex-direction: column; gap: var(--space-4); max-width: 640px; }
  .np-card { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-4) var(--space-5); }
  .np-card input[type=text] { max-width: none; }
  .np-l { font-size: var(--type-sm); font-weight: var(--weight-semibold); color: var(--fg-0); margin: 0; }
  .np-hint { font-size: var(--type-xs); color: var(--fg-2); }
  .np-plans { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-2); }
  .np-plan { display: flex; align-items: center; gap: var(--space-3); margin: 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--bg-2); box-shadow: inset 0 0 0 0.5px var(--border-default); cursor: pointer; font-weight: var(--weight-regular); transition: box-shadow 140ms ease-out, background-color 140ms ease-out; }
  .np-plan:hover { box-shadow: inset 0 0 0 1px var(--fg-3); }
  .np-plan:has(input:checked) { background: var(--bg-1); box-shadow: var(--shadow-sm), inset 0 0 0 1.5px var(--accent); }
  .np-plan input { accent-color: var(--accent); margin: 0; }
  .np-plan-t { flex: 1; display: flex; flex-direction: column; font-size: var(--type-sm); }
  .np-plan-t strong { font-weight: var(--weight-semibold); color: var(--fg-0); }
  .np-plan-t span { font-size: var(--type-xs); color: var(--fg-2); }
  .np-price { font-family: var(--font-display); font-size: var(--type-lg); font-weight: var(--weight-semibold); color: var(--fg-0); white-space: nowrap; }
  .np-price small { margin-left: 2px; font-family: var(--font-body); font-size: var(--type-xs); font-weight: var(--weight-regular); color: var(--fg-2); }
  .np-int { max-width: 26rem; }
  .np-need { margin: 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-md); background: var(--accent-muted); font-size: var(--type-sm); line-height: var(--lh-sm); color: var(--fg-0); }
  .np-go { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .np-fine { font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); max-width: 34rem; }
`;
// The centered waiting room keeps the narrow column; inside the shell the
// column is the shell's own `.main-inner`.
const CSS = `${PAGE_CSS + PUBLIC_CSS + EXTRA_CSS}`;

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function page(title, body, { refreshSeconds = null } = {}) {
  const refresh = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${refresh}<title>${esc(title)} — Maude</title><style>${CSS}</style></head><body><main class="public"><div class="public-col"><div class="public-top">${lockup({ size: 44 })}</div>${body}</div></main></body></html>`;
}

function euros(minor) {
  if (minor === null || minor === undefined) return null;
  const major = minor / 100;
  return `€${Number.isInteger(major) ? major : major.toFixed(2)}`;
}

/**
 * The wizard. One page, three answers — a name, a plan, monthly or annual —
 * and the one thing a buyer must know before a card form (the bill of
 * materials), said in one line rather than a box. The id the name becomes is
 * decided server-side and shown on the NEXT page rather than live — no script.
 */
export function newProjectPage({ account = null, pricing, error = null, values = {} }) {
  const plans = pricing.plans
    .map((p) => {
      const monthly = euros(p.amounts.monthlyMinor);
      return `<label class="np-plan">
        <input type="radio" name="plan" value="${esc(p.id)}" ${(values.plan ?? pricing.plans[0].id) === p.id ? 'checked' : ''} required>
        <span class="np-plan-t"><strong>${esc(p.name)}</strong><span>${esc(p.summary)}</span></span>
        <span class="np-price">${monthly}<small>/ month</small></span>
      </label>`;
    })
    .join('\n');
  return appShell({
    account,
    title: 'Start a project',
    active: 'new',
    crumb: [{ label: 'Projects', href: '/projects' }],
    extraCss: EXTRA_CSS,
    lede: `The first ${pricing.trialDays} days are free. Nothing is charged today.`,
    body: `${error ? `<p class="error">${esc(error)}</p>` : ''}
     <form class="np" method="post" action="/projects/new">
       <section class="ma-card np-card">
         <label class="np-l" for="name">Name</label>
         <input type="text" id="name" name="name" required minlength="3" maxlength="60" autofocus
                value="${esc(values.name ?? '')}" placeholder="e.g. Brno Alligators">
         <span class="np-hint">One project is one workspace: its own address, people and design system.</span>
       </section>
       <section class="ma-card np-card">
         <span class="np-l">Plan</span>
         <div class="np-plans" role="radiogroup" aria-label="Plan">${plans}</div>
         <span class="seg ma-seg np-int" role="radiogroup" aria-label="Billed">
           <label class="ma-seg-b"><input type="radio" name="interval" value="monthly" ${values.interval !== 'annual' ? 'checked' : ''}>Monthly</label>
           <label class="ma-seg-b"><input type="radio" name="interval" value="annual" ${values.interval === 'annual' ? 'checked' : ''}>Annual — two months free</label>
         </span>
       </section>
       <p class="np-need"><strong>What you’ll need:</strong> a Mac or a PC (not a phone or a tablet) with the free Maude app, and
         <strong>your own Claude subscription</strong> — about €20 a month, paid to Anthropic, not to Maude. Your designs are drawn only on your machine.</p>
       <div class="np-go">
         <span class="np-fine">By continuing you agree to the <a href="https://maude.sh/terms">Terms</a> and the
           <a href="https://maude.sh/privacy">Privacy notice</a>. Stripe adds your country’s VAT and shows the total next.</span>
         <button type="submit" class="btn btn--primary btn--lg">Continue to payment details</button>
       </div>
     </form>`,
  });
}

/**
 * The waiting room. Named steps, never a percentage (DDR-203), and the
 * "you have not been charged" answer on the screen itself.
 */
export function waitingRoomPage({ project, room }) {
  const items = (() => {
    const stepIndex = PROVISION_STEPS.findIndex((s) => s.key === room.step);
    return PROVISION_STEPS.map((s, i) => {
      const cls = room.step === null ? '' : i < stepIndex ? 'done' : i === stepIndex ? 'now' : '';
      return `<li class="${cls}">${esc(s.label)}</li>`;
    }).join('\n');
  })();

  if (room.done && room.step === 'ready') {
    return page(
      `${project.name} is ready`,
      `<h1>${esc(project.name)} is ready</h1>
       <p class="quiet">${esc(room.note ?? '')}</p>
       <p><a class="btn" href="/projects/${esc(project.id)}/connect">Open your project</a></p>
       <p class="quiet"><a href="/">Back to your projects</a></p>`
    );
  }
  if (room.done) {
    return page(
      'Something went wrong',
      `<h1>Something went wrong</h1>
       <div class="card"><p style="margin:0">${esc(room.note ?? '')}</p></div>
       <p style="margin-top:var(--space-5)"><a class="btn" href="/projects/new">Try again</a>
         <a href="/" style="margin-left:var(--space-5)">Back to your projects</a></p>`
    );
  }
  return page(
    `Setting up ${project.name}`,
    `<h1>Setting up ${esc(project.name)}</h1>
     <ul class="steps">${items}</ul>
     <div class="card reassure"><p style="margin:0">${esc(room.note ?? '')}</p></div>
     <p class="quiet" style="margin-top:var(--space-5)">This page checks again every few seconds by itself.</p>`,
    { refreshSeconds: 5 }
  );
}

/**
 * Billing, per project.
 *
 * Stripe stays the source of everything that CHANGES money — cards and plan
 * changes open their portal, because it is the customer's billing relationship
 * and they should hold it directly. What moved here (Cloud Phase 24 A10,
 * canvas board D2) is everything they only need to READ or to decide:
 * the invoice list, what goes on the invoice, and cancelling — which Stripe's
 * own button cannot explain, because it knows nothing about the project.
 */
export function billingPage({
  account = null,
  project,
  stateCopy,
  canPortal,
  subscription = { exists: false, cancelling: false, periodEndMs: null },
  invoices = [],
  invoicesUnavailable = false,
  details = null,
  detailsUnavailable = false,
  pausedUntil = null,
  plan = null,
  promo = null,
  error = null,
  notice = null,
}) {
  const p = `/projects/${esc(project.id)}`;

  // The plan card (plan-copy.mjs `ownerPlan`), where the bare state card would
  // be. Promo says Promo where another owner sees a trial or Choose a plan
  // (canvas 16, cl-promo-owner); a trial shows the DATE it is free until, so
  // free time an operator gave is visible here; an operator's pause says so,
  // with no countdown — nothing is scheduled to be deleted.
  const choose = `<span class="ma-head-a"><a class="btn btn--primary" href="/account/plans">Choose a plan</a></span>`;
  const planBox = (kicker, title, body, { tone = '' } = {}) =>
    `<div class="ma-card ma-card--pad ma-plan${tone ? ` ${tone}` : ''}">
       <span class="ma-promo-l">${esc(kicker)}</span>
       <h2 class="ma-sheet-t">${title}</h2>
       ${body}
     </div>`;
  const planCard = promo
    ? planBox(
        promo.endingSoon ? `Plan · ends ${promo.ends}` : 'Plan',
        `<span class="ma-promo">Promo</span> ${esc(project.name)}`,
        `<dl class="ma-kv">
           <dt>Plan</dt><dd>${esc(promo.plan)}</dd>
           ${promo.storage ? `<dt>Storage</dt><dd>${esc(promo.storage)}</dd>` : ''}
           <dt>Ends</dt><dd>${esc(promo.ends)}</dd>
         </dl>
         ${
           promo.endingSoon
             ? `<p class="ma-sub">Pick a plan to keep editing after ${esc(promo.ends)}.
                  Nothing is deleted, and until you choose, everyone can still open and download
                  everything.</p>${choose}`
             : `<p class="ma-sub">No trial, no card, nothing to choose.</p>`
}`
      )
    : plan?.state === 'deleting'
      ? planBox(
          'Plan',
          `This project will be deleted on ${esc(plan.deletesOn)}`,
          `<p class="ma-sub">Maude support scheduled it, and the reason is on this
             project’s Activity page. Nothing has been deleted yet. If this is a mistake, reply to
             the e-mail about it before that date and the project comes back as it was.</p>
           <form method="post" action="${p}/download" style="margin:0">
             <button type="submit" class="btn btn--ghost">Download everything</button>
           </form>`,
          { tone: 'warn' }
        )
      : plan?.state === 'held'
        ? planBox(
            'Plan',
            'Paused by Maude',
            `<p class="ma-sub">Nothing has been deleted and no deletion is scheduled.
             The reason is on this project’s Activity page. You can still download everything.</p>`,
            { tone: 'warn' }
          )
        : plan?.state === 'trial'
          ? planBox(
              'Free trial',
              `Free until ${esc(formatDay(plan.freeUntil))}`,
              `<p class="ma-sub">${esc(plan.line)}. No card is needed. After that date
               you pick a plan to keep editing; nothing is deleted.</p>${choose}`
            )
          : plan?.state === 'paused'
            ? planBox(
                'Plan',
                'Choose a plan to keep editing',
                `<p class="ma-sub">The free time has ended. Nothing is deleted, and
                 everyone can still open and download everything.</p>${choose}`,
                { tone: 'warn' }
              )
            : plan?.state === 'paid'
              ? planBox(
                  'Plan',
                  esc(String(plan.line ?? 'A plan').replace(/ · plan chosen$/, '')),
                  '<p class="ma-sub">Billed by Stripe. The plan, the card and the invoices are below.</p>'
                )
              : plan
                ? planBox(
                    'Plan',
                    'Free — no plan',
                    '<p class="ma-sub">This project was made before plans existed, so nothing is billed.</p>'
                  )
                : null;
  const d = details ?? {
    company: '',
    line1: '',
    city: '',
    postalCode: '',
    country: '',
    vatId: '',
  };

  // Cancelled-but-still-running is the state the old page could not show at
  // all: everything worked, the customer had cancelled, and no Maude screen
  // said so (canvas E0, screen 2).
  const cancelBanner = subscription.cancelling
    ? `<div class="card warn">
         <h2>Cancelled — ends ${esc(formatDay(subscription.periodEndMs ?? Date.now()))}</h2>
         <p class="quiet">Everything works normally until then. You will not be charged again.</p>
         <form method="post" action="${p}/billing/resume" style="margin:0">
           <button type="submit">Keep ${esc(project.name)}</button>
         </form>
         <p class="quiet" style="margin:var(--space-3) 0 0">Changing your mind before then puts
           everything back exactly as it is now — same address, same people, nothing lost.</p>
       </div>`
    : '';

  const invoiceSection = invoicesUnavailable
    ? `<p class="quiet">Your invoices could not be loaded right now. They are always available in
         the billing portal.</p>`
    : invoices.length
      ? `<table><thead><tr><th>Date</th><th>What for</th><th></th><th></th></tr></thead><tbody>${invoices
          .map(
            (i) => `<tr>
             <td class="mono">${esc(formatDay(i.at))}</td>
             <td>${esc(i.description)}${i.unpaid ? ' <span class="quiet">— unpaid</span>' : ''}</td>
             <td class="right">${esc(i.amount)}</td>
             <td class="right"><a href="${esc(i.pdf)}">PDF</a></td>
           </tr>`
          )
          .join('\n')}</tbody></table>`
      : '<p class="quiet">No invoices yet. The first one arrives when the trial ends.</p>';

  const detailsSection = detailsUnavailable
    ? `<p class="quiet">Your billing details could not be loaded right now. Try again in a minute.</p>`
    : `<p class="quiet">What goes on the invoice. Changing it here changes every future one — and
         it is what decides which VAT you are charged.</p>
       <form method="post" action="${p}/billing/details">
         <label for="company">Billed to</label>
         <input type="text" id="company" name="company" value="${esc(d.company ?? '')}"
                placeholder="e.g. Brno Alligators z.s.">
         <label for="line1">Street and number</label>
         <input type="text" id="line1" name="line1" value="${esc(d.line1 ?? '')}">
         <div class="pair">
           <div>
             <label for="postalCode">Postcode</label>
             <input type="text" id="postalCode" name="postalCode" value="${esc(d.postalCode ?? '')}">
           </div>
           <div>
             <label for="city">City</label>
             <input type="text" id="city" name="city" value="${esc(d.city ?? '')}">
           </div>
           <div>
             <label for="country">Country</label>
             <input type="text" id="country" name="country" maxlength="2" placeholder="CZ"
                    value="${esc(d.country ?? '')}">
           </div>
         </div>
         <label for="vatId">VAT id <span class="quiet">— if you have one</span></label>
         <input type="text" id="vatId" name="vatId" value="${esc(d.vatId ?? '')}"
                placeholder="CZ26547891">
         <p style="margin-top:var(--space-4)"><button type="submit">Save</button></p>
       </form>`;

  return appShell({
    account,
    title: 'Billing',
    project,
    isOwner: true,
    active: 'billing',
    extraCss: EXTRA_CSS,
    pill: promo
      ? { tone: 'ok', label: 'Promo' }
      : pausedUntil || plan?.state === 'held' || plan?.state === 'deleting'
        ? { tone: 'stop', label: 'Paused' }
        : subscription.cancelling
          ? { tone: 'warn', label: `Ending ${formatDay(subscription.periodEndMs ?? Date.now())}` }
          : stateCopy.tone
            ? { tone: stateCopy.tone, label: stateCopy.label }
            : null,
    body: `${error ? `<p class="error">${esc(error)}</p>` : ''}
     ${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
     ${cancelBanner}
     ${
       // Paused, with the clock visible (A11, canvas E0 screen 3). A retention
       // window nobody can see the end of is not a promise, it is a surprise.
       pausedUntil && plan?.state !== 'deleting'
         ? `<div class="card warn">
              <h2>Paused — deleted in ${pausedUntil.daysLeft} day${pausedUntil.daysLeft === 1 ? '' : 's'}</h2>
              <p class="quiet">${esc(project.name)} stopped on ${esc(formatDay(pausedUntil.pausedOn))}.
                Nothing has been deleted yet. Everything goes on
                <strong>${esc(formatDay(pausedUntil.deletedOn))}</strong> unless you restart it.</p>
              <div class="actions" style="margin:0">
                <form method="post" action="${p}/billing/portal" style="margin:0">
                  <button type="submit">Restart ${esc(project.name)}</button>
                </form>
                <form method="post" action="${p}/download" style="margin:0">
                  <button type="submit" class="ghost">Download everything</button>
                </form>
              </div>
            </div>`
         : (planCard ??
           `<div class="card">
              <h2>${esc(stateCopy.label)}</h2>
              ${stateCopy.note ? `<p class="quiet" style="margin:0">${esc(stateCopy.note)}</p>` : ''}
            </div>`)
}
     ${
       canPortal
         ? `<div class="actions">
              <form method="post" action="${p}/billing/portal" style="margin:0">
                <button type="submit">Change plan or card</button>
              </form>
              ${
                subscription.cancelling
                  ? ''
                  : `<form method="get" action="${p}/billing/cancel" style="margin:0">
                       <button type="submit" class="ghost">Cancel subscription</button>
                     </form>`
              }
            </div>
            <p class="quiet">Cards and plan changes open Stripe, who handle the payment itself.</p>
            <h2 style="margin-top:var(--space-7)">Invoices</h2>
            ${invoiceSection}
            <h2 style="margin-top:var(--space-7)">Billing details</h2>
            ${detailsSection}`
         : plan?.state === 'paid'
           ? `<p class="quiet" style="margin-top:var(--space-5)">The card and the invoices cannot be
                reached just now. Try again in a minute.</p>`
           : ''
}`,
  });
}

/**
 * Cancelling, with every date on the screen before the click (A11, canvas E0).
 *
 * The download offer is ON this screen rather than a link to the page that
 * makes one: a gate that sends somebody hunting for the thing it just demanded
 * is a gate that gets abandoned, and this is the moment they are most likely to
 * want the copy.
 */
export function cancelPage({ account = null, project, schedule, hasExport = false, error = null }) {
  const p = `/projects/${esc(project.id)}`;
  return appShell({
    account,
    title: `Cancel ${project.name}?`,
    project,
    isOwner: true,
    active: 'billing',
    extraCss: EXTRA_CSS,
    body: `${error ? `<p class="error">${esc(error)}</p>` : ''}
     <div class="card warn">
       <h2>Here is what happens</h2>
       <ul>
         <li>${esc(project.name)} keeps working until
           <strong>${esc(formatDay(schedule.worksUntil))}</strong>, which you have already paid for.</li>
         <li>It pauses that day. Nothing is deleted and you can restart it.</li>
         <li><strong>${esc(formatDay(schedule.deletedOn))}</strong> — ${schedule.retentionDays} days
           later — everything is deleted from our computers. We email you before that happens.</li>
         <li>The copy you download stays yours, forever.</li>
       </ul>
     </div>
     <div class="card">
       <h2>Take your work with you first</h2>
       <p class="quiet">One file with every design and its full history. It takes a minute, and
         taking it changes nothing.</p>
       <form method="post" action="${p}/download" style="margin:0">
         <button type="submit" class="ghost">Download everything</button>
         ${hasExport ? '<span class="quiet" style="margin-left:var(--space-4)">you already have one — this makes a fresh copy</span>' : ''}
       </form>
     </div>
     <form method="post" action="${p}/billing/cancel">
       <label style="font-weight:400"><input type="checkbox" name="sure" value="yes" required>
         I understand ${esc(project.name)} will be deleted on ${esc(formatDay(schedule.deletedOn))}.</label>
       <p style="margin-top:var(--space-4)">
         <button type="submit">Cancel the subscription</button>
         <a href="${p}/billing" style="margin-left:var(--space-5)">Keep it running</a>
       </p>
     </form>`,
  });
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allCheckoutHtml({ pricing }) {
  const project = { id: 'alligators', name: 'Brno Alligators' };
  const account = { email: 'a@example.com' };
  return [
    newProjectPage({ account, pricing }),
    newProjectPage({
      account,
      pricing,
      error: 'Pick one of the plans.',
      values: { name: 'X', interval: 'annual' },
    }),
    waitingRoomPage({
      project,
      room: {
        step: 'workspace',
        steps: PROVISION_STEPS,
        done: false,
        note: 'This usually takes a minute or two. Your card has not been charged yet — that happens once your project is up.',
      },
    }),
    waitingRoomPage({
      project,
      room: { step: 'ready', steps: PROVISION_STEPS, done: true, note: 'Your project is ready.' },
    }),
    waitingRoomPage({
      project,
      room: {
        step: null,
        steps: PROVISION_STEPS,
        done: true,
        note: 'We could not set up your project, so you have not been charged.',
      },
    }),
    billingPage({ account, project, stateCopy: { label: 'Ready', note: null }, canPortal: true }),
    billingPage({
      account,
      project,
      stateCopy: { label: 'Setting up', note: 'This usually takes a minute or two.' },
      canPortal: false,
    }),
    // The four plan cards an owner can meet (plan-copy.mjs).
    ...[
      {
        promo: { plan: 'Promo from Maude · free', storage: '250 GB', ends: 'Never' },
        plan: { state: 'promo' },
      },
      {
        promo: {
          plan: 'Promo from Maude · free',
          storage: 'No storage limit',
          ends: '31 December 2026',
          endingSoon: true,
        },
        plan: { state: 'promo' },
      },
      { plan: { state: 'held' } },
      { plan: { state: 'deleting', deletesOn: '25 December 2026' } },
      { plan: { state: 'trial', freeUntil: 0, line: 'Free trial · 12 days left' } },
      { plan: { state: 'paused' } },
    ].map((extra) =>
      billingPage({
        account,
        project,
        stateCopy: { label: 'Ready', note: null },
        canPortal: false,
        ...extra,
      })
    ),
  ].join('\n');
}
