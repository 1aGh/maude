// Mention e-mails — Maude v2 S9.18 (canvas 10 co-mention-notify, "Maude closed").
//
// A mention finds you once, wherever you are: a toast in the app, a Mac
// notice in the background (S9.17), and — with Maude closed — ONE e-mail from
// here. The cell's comment door (`apps/hub/src/routes-v2/comments.mjs`) has
// already delivered to every live connection; what it could not reach it
// forwards to `POST /internal/mentions`. A self-hosted hub has no forwarder and
// sends none.
//
//   POST /internal/mentions        cell → cloud only: the project's derived
//                                  cell secret, the vouched author in
//                                  `x-maude-actor` (the cell's VERIFIED session)
//   GET|POST /account/emails       the switch, per account — cookie session,
//                                  the S9.16 session-derived CSRF field
//   GET|POST /emails/unsubscribe   the link in every mention e-mail: a
//                                  single-purpose 'unsub' token that turns
//                                  mention e-mails off and does nothing else
//
// WHO GETS ONE IS DECIDED HERE, FROM D1. The cell sends the `@handle` tokens it
// parsed and the people it already reached; it never names a recipient. The
// author must hold `comment` on the canvas, each recipient must be able to
// `read` it — re-decided from the rows, so a cell that lies gains nothing it
// could not already send through its own comment lane. A canvas-only person
// hears only about their canvas; a mention with no canvas is the project scope.
//
// WHAT THE E-MAIL SAYS: the author's NAME, the project and canvas names, one
// short line of the words that mentioned you (words you can already read in
// the thread), and links. Never an address but the recipient's own `To`.
//
// LIMITS: one e-mail per (thread, person) per hour — a re-forwarded mention is
// still one nudge — and a daily cap per project, so a misbehaving cell cannot
// turn this into a mailing list.

import { resolveMentions } from '../studio/comments/mentions.ts';
import { accessOf, decideClaim, projectFacts, validCanvasPath } from './access-forward.mjs';
import { accountCsrf, DELETED_EMAIL_DOMAIN, postAllowed } from './account-pages.mjs';
import { getAccountByEmail, normalizeEmail } from './accounts.mjs';
import { SESSION_COOKIE } from './auth-routes.mjs';
import { appShell, publicPage, publicResponse } from './brand.mjs';
import { deriveCellSecret, secretsMatch } from './cell-token.mjs';
import { audit } from './db.mjs';
import { MENTION_EXCERPT_MAX, mentionEmail, oneLine, sendEmail } from './email.mjs';
import { consumeEmailToken, mintEmailToken, peekEmailToken } from './email-tokens.mjs';
import { canvasName } from './people-page.mjs';

export const MENTIONS_PATH = '/internal/mentions';
export const EMAIL_PREFS_PATH = '/account/emails';
export const UNSUBSCRIBE_PATH = '/emails/unsubscribe';

/** Mention e-mails one project may send per rolling day. */
export const MENTION_EMAILS_PER_PROJECT_PER_DAY = 200;
/** The same thread mails the same person at most once in this window. */
export const MENTION_REPEAT_MS = 3_600_000;

const DAY_MS = 86_400_000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_TOKENS = 20;
const MAX_REACHED = 500;
const PROJECT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A comment thread id (`c_<hex>` from the door; the S6↔S9 invite shape). */
const THREAD = /^[A-Za-z0-9_-]{1,64}$/;
const TOKEN = /^@?[\w][\w.-]{0,63}$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ----------------------------------------------------------------- the switch

/** Does this account get mention e-mails? No row = yes (the default). */
export async function mentionEmailsOn(db, accountId) {
  try {
    const row = await db
      .prepare('SELECT mentions FROM email_prefs WHERE account_id = ?')
      .bind(accountId)
      .first();
    return row ? row.mentions === 1 : true;
  } catch {
    // Unreadable prefs must not mean "mail them anyway": fail closed.
    return false;
  }
}

/** Turn mention e-mails on or off for one account. */
export async function setMentionEmails(db, accountId, on, { now = Date.now() } = {}) {
  await db
    .prepare(
      `INSERT INTO email_prefs (account_id, mentions, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET mentions = excluded.mentions, updated_at = excluded.updated_at`
    )
    .bind(accountId, on ? 1 : 0, now)
    .run();
}

// ------------------------------------------------------------ who it reaches

/**
 * Everyone who can open `canvas` (null = the project), as `resolveMentions`
 * wants them: `id` the address, `name` the account name. The owner, members,
 * and canvas grantees — each claim re-decided by `decideClaim`.
 */
async function peopleWhoCanRead(db, facts, canvas) {
  const accounts = new Map();
  const note = (id, email, name) => {
    if (id && email && !accounts.has(id)) accounts.set(id, { id, email, name });
  };
  if (facts.project?.account_id) {
    const owner = await db
      .prepare('SELECT id, email, name FROM accounts WHERE id = ?')
      .bind(facts.project.account_id)
      .first();
    if (owner) note(owner.id, owner.email, owner.name);
  }
  for (const m of facts.members) note(m.account_id, m.email, m.name);
  for (const g of facts.grants) note(g.account_id, g.email, g.name);
  const out = [];
  for (const a of accounts.values()) {
    const email = String(a.email).toLowerCase();
    if (email.endsWith(`@${DELETED_EMAIL_DOMAIN}`)) continue;
    const access = accessOf(decideClaim({ accountId: a.id, ...facts }));
    if (access.can('read', canvas)) {
      out.push({ id: email, name: String(a.name ?? ''), accountId: a.id });
    }
  }
  return out;
}

async function sentRecently(db, { projectId, accountId, thread, now }) {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM mention_emails
        WHERE project_id = ? AND account_id = ? AND thread = ? AND sent_at > ? LIMIT 1`
    )
    .bind(projectId, accountId, thread, now - MENTION_REPEAT_MS)
    .first();
  return Boolean(row);
}

async function sentToday(db, projectId, now) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM mention_emails WHERE project_id = ? AND sent_at > ?')
    .bind(projectId, now - DAY_MS)
    .first();
  return Number(row?.n ?? 0);
}

async function readBoundedJson(request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return { tooLarge: true };
  let text;
  try {
    text = await request.text();
  } catch {
    return {};
  }
  if (text.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : {};
  } catch {
    return {};
  }
}

const stringList = (v, max, re = null) =>
  Array.isArray(v) &&
  v.length <= max &&
  v.every((s) => typeof s === 'string' && s.length <= 254 && (!re || re.test(s)));

/** `POST /internal/mentions`. */
async function forwardedMention(request, env, { send, now }) {
  const read = await readBoundedJson(request);
  if (read.tooLarge) return json({ error: 'too large' }, 413);
  const body = read.value ?? {};
  const tenant = typeof body.tenant === 'string' ? body.tenant : '';
  // The project's own cell, and nobody else: its derived secret, failing closed.
  const offered = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!env.CELL_SECRET_MASTER || !PROJECT_ID.test(tenant) || !offered) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (!secretsMatch(offered, await deriveCellSecret(env.CELL_SECRET_MASTER, tenant))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const canvas = body.canvas ?? null;
  if (canvas !== null && !validCanvasPath(canvas)) return json({ error: 'canvas' }, 422);
  if (typeof body.thread !== 'string' || !THREAD.test(body.thread)) {
    return json({ error: 'thread' }, 422);
  }
  if (!stringList(body.tokens, MAX_TOKENS, TOKEN)) return json({ error: 'tokens' }, 422);
  if (!stringList(body.reached ?? [], MAX_REACHED)) return json({ error: 'reached' }, 422);
  const thread = body.thread;
  const reached = new Set((body.reached ?? []).map((e) => e.trim().toLowerCase()));

  const db = env.DB;
  const facts = await projectFacts(db, tenant);
  if (!facts.project) return json({ error: 'no-access' }, 404);

  // The author: the cell's verified session, re-decided here. Commenting is
  // what makes a mention; someone who could not have written it sends nothing.
  const authorEmail = normalizeEmail(request.headers.get('x-maude-actor') ?? '');
  const author = authorEmail ? await getAccountByEmail(db, authorEmail) : null;
  const authorAccess = accessOf(decideClaim({ accountId: author?.id ?? null, ...facts }));
  if (!author || !authorAccess.can('comment', canvas)) {
    return json({ error: 'not-allowed' }, 403);
  }

  const people = await peopleWhoCanRead(db, facts, canvas);
  const recipients = resolveMentions(body.tokens, people, { exclude: authorEmail }).filter(
    (p) => !reached.has(p.id)
  );

  const origin = new URL(request.url).origin;
  const fromName =
    oneLine(author.name, 80) ||
    oneLine(typeof body.from === 'string' && !body.from.includes('@') ? body.from : '', 80) ||
    'Someone';
  const excerpt =
    typeof body.excerpt === 'string' ? body.excerpt.slice(0, MENTION_EXCERPT_MAX * 2) : '';
  const openUrl =
    `${origin}/projects/${encodeURIComponent(tenant)}/connect` +
    `?${canvas ? `canvas=${encodeURIComponent(canvas)}&` : ''}thread=${encodeURIComponent(thread)}`;

  let sent = 0;
  let budget = MENTION_EMAILS_PER_PROJECT_PER_DAY - (await sentToday(db, tenant, now));
  for (const r of recipients) {
    const accountId = r.accountId;
    if (!accountId || budget <= 0) continue;
    if (!(await mentionEmailsOn(db, accountId))) continue;
    if (await sentRecently(db, { projectId: tenant, accountId, thread, now })) continue;
    // Recorded BEFORE the send: a retried forward after a slow provider must
    // not mail twice, and a lost send costs one nudge, never a duplicate.
    await db
      .prepare(
        'INSERT INTO mention_emails (project_id, account_id, thread, sent_at) VALUES (?, ?, ?, ?)'
      )
      .bind(tenant, accountId, thread, now)
      .run();
    budget -= 1;
    const { token } = await mintEmailToken(db, { accountId, purpose: 'unsub' }, { now });
    const mail = mentionEmail({
      fromName,
      projectName: facts.project.name,
      canvasName: canvas ? canvasName(canvas) : null,
      excerpt,
      openUrl,
      unsubscribeUrl: `${origin}${UNSUBSCRIBE_PATH}?t=${token}`,
      settingsUrl: `${origin}${EMAIL_PREFS_PATH}`,
    });
    const result = await send({ to: r.id, ...mail });
    if (result?.ok) sent += 1;
  }
  if (recipients.length) {
    // Counts only: who was mailed is not the audit trail's to spread.
    await audit(db, {
      accountId: author.id,
      projectId: tenant,
      actor: 'cell',
      action: 'mention.email',
      detail: JSON.stringify({ sent }),
    }).catch(() => {});
  }
  return json({ sent }, 202);
}

// ------------------------------------------------------------------ the pages

const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
};

const html = (body, status = 200) => new Response(body, { status, headers: PAGE_HEADERS });

const redirect = (to) =>
  new Response(null, { status: 303, headers: { location: to, 'cache-control': 'no-store' } });

function cookieValue(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/** The preferences page: one switch, for now (canvas 10: "Change which e-mails you get"). */
export function emailPrefsPage({ account, mentions, csrf, saved = false }) {
  return appShell({
    account,
    title: 'E-mails',
    active: 'account',
    lede: 'Which e-mails Maude Cloud sends you.',
    body: `${saved ? '<p class="ok">Saved.</p>' : ''}
      <form method="post" action="${EMAIL_PREFS_PATH}">
        <input type="hidden" name="csrf" value="${esc(csrf ?? '')}">
        <p><label><input type="checkbox" name="mentions"${mentions ? ' checked' : ''}>
          E-mail me when someone mentions you and Maude is closed</label></p>
        <p class="quiet">One e-mail per mention, never a digest. In the app you get a notice instead.</p>
        <p><button type="submit">Save</button> <a href="/account" style="margin-left:1rem">Back to the account</a></p>
      </form>`,
  });
}

const DEAD_LINK_PAGE = () =>
  publicPage({
    title: 'This link no longer works',
    sub: 'Change which e-mails you get in Settings › General.',
    body: `<p class="fine"><a href="${EMAIL_PREFS_PATH}">Open your e-mail settings</a></p>`,
  });

async function prefsRoute(request, env, { account, now }) {
  const url = new URL(request.url);
  if (!account) return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  const csrf = await accountCsrf(
    cookieValue(request, SESSION_COOKIE),
    env.CELL_SECRET_MASTER ?? ''
  );
  if (request.method === 'POST') {
    let form;
    try {
      form = await request.formData();
    } catch {
      form = new FormData();
    }
    if (!(await postAllowed(request, env, url, form))) {
      return html('<p>That request could not be verified. Reload the page and try again.</p>', 403);
    }
    await setMentionEmails(env.DB, account.id, form.get('mentions') === 'on', { now });
    return redirect(`${EMAIL_PREFS_PATH}?saved=1`);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return html('<p>Not allowed.</p>', 405);
  return html(
    emailPrefsPage({
      account,
      mentions: await mentionEmailsOn(env.DB, account.id),
      csrf,
      saved: url.searchParams.get('saved') === '1',
    })
  );
}

/**
 * The unsubscribe link. GET only LOOKS (a link preview or a mail scanner's
 * prefetch must not change anything) and asks; the POST spends the 'unsub'
 * token and turns mention e-mails off. No session is created or read: the
 * token is the whole authority, and it can do this one thing.
 */
async function unsubscribeRoute(request, env, { now }) {
  const db = env.DB;
  if (request.method === 'POST') {
    let form;
    try {
      form = await request.formData();
    } catch {
      form = new FormData();
    }
    const spent = await consumeEmailToken(db, String(form.get('t') ?? ''), 'unsub', { now });
    if (!spent.ok) return publicResponse(DEAD_LINK_PAGE(), 410);
    await setMentionEmails(db, spent.accountId, false, { now });
    return publicResponse(
      publicPage({
        title: 'No more mention e-mails',
        sub: 'You will still see mentions in the app. Change which e-mails you get in Settings › General.',
      })
    );
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return publicResponse(DEAD_LINK_PAGE(), 405);
  }
  const t = new URL(request.url).searchParams.get('t') ?? '';
  const seen = await peekEmailToken(db, t, 'unsub', { now });
  if (!seen.ok) return publicResponse(DEAD_LINK_PAGE(), 410);
  return publicResponse(
    publicPage({
      title: 'Stop mention e-mails?',
      sub: 'You will still see mentions in the app.',
      body: `<form method="post" action="${UNSUBSCRIBE_PATH}">
          <input type="hidden" name="t" value="${esc(t)}">
          <button type="submit" class="wide">Stop mention e-mails</button>
        </form>`,
    })
  );
}

/**
 * Route S9.18's surfaces. Returns a Response, or null when the path is not
 * ours. `account` is the COOKIE session's (worker.mjs `currentAccount`); the
 * internal route ignores it entirely — a browser session is not a cell.
 * `send` is the e-mail transport (default: `sendEmail`, which without a
 * provider key sends nothing); tests hand in a fake.
 */
export async function handleMentionRoutes(
  request,
  env,
  { account = null, send = null, now = Date.now() } = {}
) {
  const { pathname } = new URL(request.url);
  if (pathname === MENTIONS_PATH) {
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    return forwardedMention(request, env, { send: send ?? ((m) => sendEmail(env, m)), now });
  }
  if (pathname === EMAIL_PREFS_PATH) return prefsRoute(request, env, { account, now });
  if (pathname === UNSUBSCRIBE_PATH) return unsubscribeRoute(request, env, { now });
  return null;
}
