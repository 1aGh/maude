// Share links — Maude v2 S9.8 (V2-1.7 §4.8, §5.6).
//
// A link gives Can view or Can comment, never more, to a canvas or the whole
// project. `team` is a LOCATION (today's behaviour): it grants nothing, and the
// person following it must already have access. `anyone` is any SIGNED-IN Maude
// account holding the link's secret: redeeming upserts a grant with
// `source = 'link:<id>'`, which never lowers what they already have. Turning
// the link off, or its expiry, ends exactly those grants and revokes the live
// sessions they opened. The secret is stored only as a SHA-256.
//
// The redeem lives HERE, on the control plane, at `/l/<id>.<secret>`. The page
// sends no Referer and carries no script; the redeem is a POST, so its answer
// (a 303 into the browser lane) replaces the URL that held the secret.

import {
  accessOf,
  accessWentDown,
  loadClaim,
  notifyAccessChanged,
  raiseMembership,
  writeGrant,
} from './access-forward.mjs';
import { publicPage, publicResponse } from './brand.mjs';
import { audit } from './db.mjs';

/** The roles a link may give. */
export const LINK_ROLES = Object.freeze(['observer', 'viewer']);

const LINK_ID = /^lnk_[0-9a-f]{16}$/;
const TOKEN = /^(lnk_[0-9a-f]{16})(?:\.([0-9a-f]{64}))?$/;

const hex = (bytes) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const urlFor = (id, secret) => (origin) => `${origin}/l/${id}${secret ? `.${secret}` : ''}`;

/** Create a link. Returns `{ id, url(origin) }` — the secret exists only in that URL. */
export async function createLink(
  db,
  { projectId, canvas = null, role, who, expiresAt = null, createdBy, now = Date.now() }
) {
  const id = `lnk_${randomHex(8)}`;
  const secret = who === 'anyone' ? randomHex(32) : null;
  await db
    .prepare(
      `INSERT INTO share_links (id, project_id, canvas_path, role, who, secret_hash, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      projectId,
      canvas,
      role,
      who,
      secret ? await sha256Hex(secret) : null,
      createdBy,
      now,
      expiresAt
    )
    .run();
  return { id, url: urlFor(id, secret) };
}

/** A link that is still on. Off and expired read the same. */
const live = (row, now) =>
  row && !row.revoked_at && (row.expires_at == null || row.expires_at > now);

/**
 * End every grant a link created: delete them, then revoke + notify each
 * person (their reach went down). Idempotent — a second call finds nothing.
 */
export async function endLinkGrants(env, link, { reason, now = Date.now(), ctx = null } = {}) {
  const source = `link:${link.id}`;
  const { results: canvasRows } = await env.DB.prepare(
    `SELECT DISTINCT a.email FROM canvas_grants g JOIN accounts a ON a.id = g.account_id
      WHERE g.project_id = ? AND g.source = ?`
  )
    .bind(link.project_id, source)
    .all();
  const { results: memberRows } = await env.DB.prepare(
    `SELECT DISTINCT a.email FROM project_members m JOIN accounts a ON a.id = m.account_id
      WHERE m.project_id = ? AND m.source = ?`
  )
    .bind(link.project_id, source)
    .all();
  await env.DB.prepare('DELETE FROM canvas_grants WHERE project_id = ? AND source = ?')
    .bind(link.project_id, source)
    .run();
  await env.DB.prepare('DELETE FROM project_members WHERE project_id = ? AND source = ?')
    .bind(link.project_id, source)
    .run();
  const emails = new Set([...(canvasRows ?? []), ...(memberRows ?? [])].map((r) => r.email));
  for (const email of emails)
    await accessWentDown(env, link.project_id, email, { reason, now, ctx });
  return { ended: emails.size };
}

/**
 * Change a link (the owner's PATCH). `off` ends it for good; `who: 'team'`
 * ends its grants (a team link grants nothing); a role change moves the
 * grants it made to the new role.
 */
export async function patchLink(
  env,
  { projectId, id, role, who, expiresAt, off, now = Date.now(), ctx }
) {
  const db = env.DB;
  if (!LINK_ID.test(String(id))) return { ok: false };
  const row = await db
    .prepare('SELECT * FROM share_links WHERE id = ? AND project_id = ? AND revoked_at IS NULL')
    .bind(id, projectId)
    .first();
  if (!row) return { ok: false };
  if (off) {
    await db.prepare('UPDATE share_links SET revoked_at = ? WHERE id = ?').bind(now, id).run();
    await endLinkGrants(env, row, { reason: 'link-off', now, ctx });
    return { ok: true };
  }
  let url = null;
  if (expiresAt !== undefined) {
    await db
      .prepare('UPDATE share_links SET expires_at = ? WHERE id = ?')
      .bind(expiresAt, id)
      .run();
  }
  if (who !== undefined && who !== row.who) {
    if (who === 'team') {
      await db
        .prepare("UPDATE share_links SET who = 'team', secret_hash = NULL WHERE id = ?")
        .bind(id)
        .run();
      await endLinkGrants(env, row, { reason: 'link-off', now, ctx });
    } else {
      const secret = randomHex(32);
      await db
        .prepare("UPDATE share_links SET who = 'anyone', secret_hash = ? WHERE id = ?")
        .bind(await sha256Hex(secret), id)
        .run();
      url = urlFor(id, secret);
    }
  }
  if (role !== undefined && role !== row.role) {
    await db.prepare('UPDATE share_links SET role = ? WHERE id = ?').bind(role, id).run();
    const source = `link:${id}`;
    const { results } = await db
      .prepare(
        `SELECT DISTINCT a.email FROM canvas_grants g JOIN accounts a ON a.id = g.account_id
          WHERE g.project_id = ? AND g.source = ?
         UNION SELECT DISTINCT a.email FROM project_members m JOIN accounts a ON a.id = m.account_id
          WHERE m.project_id = ? AND m.source = ?`
      )
      .bind(projectId, source, projectId, source)
      .all();
    await db
      .prepare('UPDATE canvas_grants SET role = ? WHERE project_id = ? AND source = ?')
      .bind(role, projectId, source)
      .run();
    await db
      .prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND source = ?')
      .bind(role, projectId, source)
      .run();
    const narrowed = LINK_ROLES.indexOf(role) < LINK_ROLES.indexOf(row.role);
    for (const { email } of results ?? []) {
      if (narrowed) await accessWentDown(env, projectId, email, { reason: 'link-off', now, ctx });
      else await notifyAccessChanged(env, projectId, { email, change: 'raised' }, { ctx });
    }
  }
  return { ok: true, ...(url ? { url } : {}) };
}

/**
 * The expiry sweep (hourly, with the reconcile cron): every expired link that
 * still has grants loses them. Idempotent by construction.
 */
export async function sweepExpiredLinks(env, { now = Date.now(), ctx = null, limit = 200 } = {}) {
  let rows = [];
  try {
    const res = await env.DB.prepare(
      `SELECT * FROM share_links l
        WHERE l.revoked_at IS NULL AND l.expires_at IS NOT NULL AND l.expires_at <= ?
          AND (EXISTS (SELECT 1 FROM canvas_grants g WHERE g.project_id = l.project_id AND g.source = 'link:' || l.id)
            OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = l.project_id AND m.source = 'link:' || l.id))
        LIMIT ?`
    )
      .bind(now, limit)
      .all();
    rows = res?.results ?? [];
  } catch {
    return { swept: 0 }; // pre-v17 D1: no links exist yet
  }
  let ended = 0;
  for (const link of rows)
    ended += (await endLinkGrants(env, link, { reason: 'expired', now, ctx })).ended;
  return { swept: rows.length, ended };
}

// ------------------------------------------------------------------ pages

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/**
 * A link page in the v2 public shell (brand.mjs, Maude v2 S9.14) — the same
 * skeleton, headers and words as the sign-in and invitation pages.
 */
function page(title, body, status = 200) {
  return publicResponse(publicPage({ title, body }), status);
}

export const LINK_OFF = 'This link was turned off.';
export const LINK_INVALID = 'This link is not valid. Ask the person who shared it for a new one.';
export const LINK_NO_ACCESS = 'This link is for people on the project. Ask its owner to add you.';

/**
 * A link that does not open: the first sentence is the heading, the rest is
 * the one thing to do about it ("This link was turned off." stands alone).
 */
function messagePage(message, status) {
  const cut = message.indexOf('. ');
  const heading = cut === -1 ? message : message.slice(0, cut + 1);
  const rest = cut === -1 ? null : message.slice(cut + 2);
  return publicResponse(publicPage({ title: heading, sub: rest, tab: 'Link' }), status);
}
const deadPage = (message) => messagePage(message, 404);

/** Resolve `<id>[.<secret>]` → `{ link }` or `{ message }`. */
async function resolveToken(db, token, now) {
  const m = TOKEN.exec(String(token ?? ''));
  if (!m) return { message: LINK_INVALID };
  let row = null;
  try {
    row = await db.prepare('SELECT * FROM share_links WHERE id = ?').bind(m[1]).first();
  } catch {
    /* unreadable is unknown */
  }
  if (!row) return { message: LINK_INVALID };
  if (row.who === 'anyone') {
    // Wrong or missing secret reads exactly like an unknown link.
    if (!m[2] || !timingSafeEqual(await sha256Hex(m[2]), row.secret_hash ?? '')) {
      return { message: LINK_INVALID };
    }
  }
  if (!live(row, now)) return { message: LINK_OFF };
  return { link: row };
}

const loginFor = (token) =>
  new Response(null, {
    status: 303,
    headers: {
      location: `/login?next=${encodeURIComponent(`/l/${token}`)}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });

/**
 * Route `/l/<id>.<secret>` (GET, the page) and `/l/redeem` (POST). Returns a
 * Response, or null when the path is not ours.
 */
export async function handleLinkRoutes(
  request,
  env,
  { account, ctx = null, now = Date.now() } = {}
) {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/l/redeem') {
    let token = '';
    try {
      token = String((await request.formData()).get('link') ?? '');
    } catch {
      return deadPage(LINK_INVALID);
    }
    const resolved = await resolveToken(env.DB, token, now);
    if (!resolved.link) return deadPage(resolved.message);
    if (!account) return loginFor(token);
    return redeem(env, resolved.link, account, { now, ctx });
  }

  const m = /^\/l\/([^/]+)$/.exec(url.pathname);
  if (!m || m[1] === 'redeem') return null;
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return page('Link', '<p>Not allowed.</p>', 405);
  const token = decodeURIComponent(m[1]);
  const resolved = await resolveToken(env.DB, token, now);
  if (!resolved.link) return deadPage(resolved.message);
  // Signed out → the existing sign-in page, coming straight back here.
  if (!account) return loginFor(token);
  // A POST, so the answer replaces this URL (the one holding the secret).
  return page(
    'Open in Maude',
    `<p class="fine">You are signed in as <strong>${esc(account.email)}</strong>.</p>
     <form method="post" action="/l/redeem">
       <input type="hidden" name="link" value="${esc(token)}">
       <button type="submit" class="wide">Open</button>
     </form>`
  );
}

/** Redeem a live link for a signed-in account, then run the browser lane. */
async function redeem(env, link, account, { now, ctx }) {
  const db = env.DB;
  const canvas = link.canvas_path ?? null;
  const { project } = await loadClaim(db, link.project_id, account.id);
  if (!project || project.state === 'purged') return deadPage(LINK_OFF);
  if (link.who === 'anyone') {
    // Never lowers (G1); an owner or a stronger member keeps what they have.
    const source = `link:${link.id}`;
    const changed = canvas
      ? (
          await writeGrant(db, {
            projectId: link.project_id,
            accountId: account.id,
            canvas,
            role: link.role,
            source,
            grantedBy: link.created_by,
            now,
          })
        ).changed
      : (
          await raiseMembership(db, {
            project,
            accountId: account.id,
            role: link.role,
            source,
            now,
          })
        ).changed;
    await audit(db, {
      accountId: account.id,
      projectId: link.project_id,
      actor: `customer:${account.email}`,
      action: 'link.redeem',
      detail: JSON.stringify({ link: link.id, role: link.role, canvas, changed }),
    });
    if (changed) {
      await notifyAccessChanged(
        env,
        link.project_id,
        { email: account.email, change: 'raised' },
        { ctx }
      );
    }
  }
  // A team link is a location: it opens only for someone who already sees it.
  const { verdict } = await loadClaim(db, link.project_id, account.id);
  const access = accessOf(verdict);
  if (!verdict.ok || (canvas ? !access.seesCanvas(canvas) : access.role === null)) {
    return messagePage(LINK_NO_ACCESS, 403);
  }
  const q = canvas ? `?canvas=${encodeURIComponent(canvas)}` : '';
  return new Response(null, {
    status: 303,
    headers: {
      location: `/projects/${link.project_id}/browser${q}`,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

/** Customer-facing strings, for the vocabulary lint. */
export function allLinkHtml() {
  return [LINK_OFF, LINK_INVALID, LINK_NO_ACCESS].join('\n');
}

/** The rendered link pages, for the page lint (S9.14). */
export async function allLinkPages() {
  const pages = [
    deadPage(LINK_OFF),
    deadPage(LINK_INVALID),
    messagePage(LINK_NO_ACCESS, 403),
    page(
      'Open in Maude',
      '<p class="fine">You are signed in as <strong>a@example.com</strong>.</p>'
    ),
  ];
  return (await Promise.all(pages.map((r) => r.text()))).join('\n');
}
