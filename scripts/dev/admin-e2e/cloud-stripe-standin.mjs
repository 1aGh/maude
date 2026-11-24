// A local Stripe stand-in for the cloud scenario harness (cloud-scenarios.mjs).
//
// In-memory, no network, no real Stripe key. It answers exactly the calls
// apps/cloud makes (checkout-routes.mjs `stripe()`, worker.mjs
// `fetchSubscription`) plus the two hosted pages a person meets: Checkout and
// the billing portal. The hosted Checkout page takes Stripe's published test
// cards: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.
//
// Webhooks are signed the way Stripe signs them (`t=<unix>,v1=<hmac-sha256 of
// "<t>.<body>">`, apps/cloud/stripe-webhook.mjs) and every sent event is kept,
// so a scenario can replay one.

import { createHmac, randomBytes } from 'node:crypto';

const id = (prefix) => `${prefix}_${randomBytes(12).toString('hex')}`;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const page = (body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Stripe stand-in</title><body data-standin="stripe">${body}</body>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );

export const CARD_OK = '4242424242424242';
export const CARD_DECLINED = '4000000000000002';

/**
 * @param {{ secretKey: string, webhookSecret: string, deliverWebhook: (rawBody: string, signature: string) => Promise<Response> }} opts
 */
export function createStripeStandin({ secretKey, webhookSecret, deliverWebhook }) {
  const customers = new Map();
  const sessions = new Map();
  const subscriptions = new Map();
  const portals = new Map();
  const taxIds = new Map();
  /** Every webhook this stand-in sent: { id, type, rawBody, status }. */
  const events = [];
  /** Every API call, for evidence: { method, path }. */
  const calls = [];
  /** When true, every API call answers 503 (Stripe outage). */
  let down = false;

  function sign(rawBody, t = Math.floor(Date.now() / 1000)) {
    const v1 = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex');
    return `t=${t},v1=${v1}`;
  }

  async function send(type, object) {
    const event = {
      id: id('evt'),
      object: 'event',
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    };
    const rawBody = JSON.stringify(event);
    const res = await deliverWebhook(rawBody, sign(rawBody));
    const record = { id: event.id, type, rawBody, status: res.status, body: await res.text() };
    events.push(record);
    return record;
  }

  /** Deliver a stored event again, freshly signed (Stripe retries re-sign too). */
  async function replay(eventId) {
    const stored = events.find((e) => e.id === eventId);
    if (!stored) throw new Error(`no such event ${eventId}`);
    const res = await deliverWebhook(stored.rawBody, sign(stored.rawBody));
    return { status: res.status, body: await res.text() };
  }

  function form(text) {
    const out = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  }
  function nested(params, prefix) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      const m = k.match(new RegExp(`^${prefix}\\[([^\\]]+)\\]$`));
      if (m) out[m[1]] = v;
    }
    return out;
  }

  /** api.stripe.com */
  async function api(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    calls.push({ method, path });
    if (down) return json({ error: { message: 'stand-in: Stripe is down' } }, 503);
    if (request.headers.get('authorization') !== `Bearer ${secretKey}`) {
      return json({ error: { message: 'Invalid API Key provided' } }, 401);
    }
    const params = method === 'POST' ? form(await request.text()) : {};
    let m;

    if (method === 'POST' && path === '/v1/customers') {
      const c = {
        id: id('cus'),
        object: 'customer',
        email: params.email ?? null,
        name: null,
        address: null,
        metadata: nested(params, 'metadata'),
      };
      customers.set(c.id, c);
      return json(c);
    }
    m = path.match(/^\/v1\/customers\/(cus_\w+)$/);
    if (m) {
      const c = customers.get(m[1]);
      if (!c) return json({ error: { message: 'No such customer' } }, 404);
      if (method === 'POST') {
        if ('name' in params) c.name = params.name;
        const address = nested(params, 'address');
        if (Object.keys(address).length) c.address = address;
      }
      return json(c);
    }
    m = path.match(/^\/v1\/customers\/(cus_\w+)\/tax_ids(?:\/(\w+))?$/);
    if (m) {
      const list = taxIds.get(m[1]) ?? [];
      if (method === 'GET') return json({ object: 'list', data: list });
      if (method === 'POST') {
        const t = { id: id('txi'), type: params.type, value: params.value };
        taxIds.set(m[1], [t]);
        return json(t);
      }
      if (method === 'DELETE') {
        taxIds.set(
          m[1],
          list.filter((t) => t.id !== m[2])
        );
        return json({ id: m[2], deleted: true });
      }
    }
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      if (!customers.has(params.customer))
        return json({ error: { message: 'No such customer' } }, 400);
      const s = {
        id: id('cs_test'),
        object: 'checkout.session',
        mode: params.mode,
        status: 'open',
        payment_status: 'unpaid',
        customer: params.customer,
        subscription: null,
        metadata: nested(params, 'metadata'),
        success_url: params.success_url,
        cancel_url: params.cancel_url,
        price: params['line_items[0][price]'],
        trial_period_days: params['subscription_data[trial_period_days]'] ?? null,
        subscription_metadata: nested(params, 'subscription_data[metadata]'),
      };
      // The key Stripe would see as `subscription_data[metadata][project_id]`.
      for (const [k, v] of Object.entries(params)) {
        const mm = k.match(/^subscription_data\[metadata\]\[([^\]]+)\]$/);
        if (mm) s.subscription_metadata[mm[1]] = v;
      }
      s.url = `https://checkout.stripe.com/c/pay/${s.id}`;
      sessions.set(s.id, s);
      return json(s);
    }
    m = path.match(/^\/v1\/checkout\/sessions\/(cs_\w+)$/);
    if (method === 'GET' && m) {
      const s = sessions.get(m[1]);
      return s ? json(s) : json({ error: { message: 'No such checkout.session' } }, 404);
    }
    m = path.match(/^\/v1\/subscriptions\/(sub_\w+)$/);
    if (m) {
      const sub = subscriptions.get(m[1]);
      if (!sub) return json({ error: { message: 'No such subscription' } }, 404);
      if (method === 'POST' && 'cancel_at_period_end' in params) {
        sub.cancel_at_period_end = params.cancel_at_period_end === 'true';
        await send('customer.subscription.updated', sub);
      }
      if (method === 'DELETE') {
        sub.status = 'canceled';
        sub.canceled_at = Math.floor(Date.now() / 1000);
        await send('customer.subscription.deleted', sub);
      }
      return json(sub);
    }
    if (method === 'POST' && path === '/v1/billing_portal/sessions') {
      const p = { id: id('bps'), customer: params.customer, return_url: params.return_url };
      p.url = `https://billing.stripe.com/p/session/${p.id}`;
      portals.set(p.id, p);
      return json(p);
    }
    if (method === 'GET' && path === '/v1/invoices') {
      const customer = url.searchParams.get('customer');
      const data = [...subscriptions.values()]
        .filter((s) => s.customer === customer)
        .map((s) => ({
          id: id('in'),
          number: `STANDIN-${s.id.slice(-6)}`,
          status: 'paid',
          created: s.created,
          amount_paid: 1900,
          total: 1900,
          currency: 'eur',
          hosted_invoice_url: `https://invoice.stripe.com/i/${s.id}`,
          invoice_pdf: null,
          lines: { data: [{ description: 'Cloud Project (stand-in)' }] },
        }));
      return json({ object: 'list', data });
    }
    return json({ error: { message: `stand-in: unhandled ${method} ${path}` } }, 404);
  }

  function payForm(s, error = null) {
    return page(
      `<h1>Pay for ${esc(s.metadata.project_name || s.metadata.project_id)}</h1>
       ${error ? `<p role="alert" id="card-error">${esc(error)}</p>` : ''}
       <form method="post" action="/c/pay/${s.id}">
         <label>Card number <input name="cardnumber" id="cardnumber" autocomplete="off"></label>
         <label>Expiry <input name="exp" id="exp" value="12 / 34"></label>
         <label>CVC <input name="cvc" id="cvc" value="123"></label>
         <button type="submit" id="pay">Subscribe</button>
       </form>
       <p><a id="back" href="${esc(s.cancel_url)}">Back</a></p>`,
      error ? 402 : 200
    );
  }

  /** Complete a Checkout Session as paid: the subscription exists, the webhooks go out. */
  async function completeSession(s) {
    const now = Math.floor(Date.now() / 1000);
    const trialDays = s.trial_period_days ? Number(s.trial_period_days) : 0;
    const sub = {
      id: id('sub'),
      object: 'subscription',
      customer: s.customer,
      status: trialDays ? 'trialing' : 'active',
      created: now,
      current_period_start: now,
      current_period_end: now + 30 * 86400,
      trial_end: trialDays ? now + trialDays * 86400 : null,
      cancel_at_period_end: false,
      metadata: s.subscription_metadata,
      items: { data: [{ price: { id: s.price } }] },
    };
    subscriptions.set(sub.id, sub);
    s.status = 'complete';
    s.payment_status = trialDays ? 'no_payment_required' : 'paid';
    s.subscription = sub.id;
    await send('checkout.session.completed', s);
    await send('customer.subscription.created', sub);
    return sub;
  }

  /** checkout.stripe.com + billing.stripe.com — the pages a person sees. */
  async function hosted(request) {
    const url = new URL(request.url);
    let m;
    if (url.pathname === '/__standin') return json({ standin: 'stripe' });
    m = url.pathname.match(/^\/c\/pay\/(cs_\w+)$/);
    if (m) {
      const s = sessions.get(m[1]);
      if (!s) return page('<h1>This checkout link is not valid.</h1>', 404);
      if (s.status === 'complete')
        return page('<h1>This checkout was already completed.</h1>', 409);
      if (request.method === 'GET') return payForm(s);
      const fields = form(await request.text());
      const card = String(fields.cardnumber ?? '').replace(/\s+/g, '');
      if (card === CARD_DECLINED) return payForm(s, 'Your card was declined.');
      if (card !== CARD_OK) return payForm(s, 'Your card number is invalid.');
      await completeSession(s);
      return new Response(null, {
        status: 303,
        headers: { location: s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) },
      });
    }
    m = url.pathname.match(/^\/p\/session\/(bps_\w+)(\/cancel)?$/);
    if (m) {
      const p = portals.get(m[1]);
      if (!p) return page('<h1>This link is not valid.</h1>', 404);
      const subs = [...subscriptions.values()].filter((s) => s.customer === p.customer);
      if (request.method === 'POST' && m[2]) {
        for (const sub of subs) {
          if (sub.status === 'canceled') continue;
          sub.cancel_at_period_end = true;
          await send('customer.subscription.updated', sub);
        }
        return new Response(null, { status: 303, headers: { location: `/p/session/${p.id}` } });
      }
      return page(
        `<h1>Billing portal</h1>
         <ul>${subs.map((s) => `<li data-sub="${s.id}">${s.status}${s.cancel_at_period_end ? ' — cancels at period end' : ''}</li>`).join('')}</ul>
         <form method="post" action="/p/session/${p.id}/cancel"><button id="cancel-plan">Cancel plan</button></form>
         <p><a id="return" href="${esc(p.return_url)}">Return</a></p>`
      );
    }
    return page('<h1>Not found (Stripe stand-in)</h1>', 404);
  }

  return {
    api,
    hosted,
    replay,
    send,
    events,
    calls,
    customers,
    sessions,
    subscriptions,
    setDown(v) {
      down = v;
    },
    /** What Stripe does at the end of a cancelled period (or a failed dunning run). */
    async endSubscription(subId, status = 'canceled') {
      const sub = subscriptions.get(subId);
      if (!sub) throw new Error(`no such subscription ${subId}`);
      sub.status = status;
      return send(
        status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
        sub
      );
    },
  };
}
