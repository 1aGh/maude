// A device signs in — Cloud Phase 23 C1/C2 (the desktop's lane).
//
// The desktop app cannot ride a browser cookie, and pasting credentials into
// an app is the anti-pattern the whole arc exists to remove. So the app signs
// in the way the DESKTOP ALREADY KNOWS how to (its GitHub sign-in, DDR-108):
//
//   app asks for a code  →  POST /auth/device/code   {device_code, user_code}
//   human confirms       →  /activate (signed in on the dashboard, types the
//                           short code — or arrives with it prefilled)
//   app polls            →  POST /auth/device/token  → a personal token
//
// The personal token is the DEVICE's credential: stored hashed here, held in
// the OS keychain there, revocable from /account — which is the visible
// revocation surface the offline project-token story has needed all along.
// With it, a client calls GET /api/projects and POST /projects/open; the
// project token it receives is then exchanged at the cell over a POST body.

import { appShell, backToAppLink, isAppState, publicPage, publicResponse } from './brand.mjs';
import { STATE_COPY } from './dashboard.mjs';
import { audit } from './db.mjs';
import { landingAfterSignIn, pendingInviteCookieFor, redeemPendingInvite } from './invites.mjs';

const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_S = 5;

// No 0/O/1/I — the code is read from one screen and typed on another.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomFrom(alphabet, n) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function makeUserCode() {
  return `${randomFrom(CODE_ALPHABET, 4)}-${randomFrom(CODE_ALPHABET, 4)}`;
}

function b64hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
  return b64hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** The account a Bearer personal token belongs to, or null. */
export async function personalTokenAccount(env, request, { now = Date.now() } = {}) {
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer.startsWith('mpt_')) return null;
  const id = await sha256Hex(bearer);
  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, a.* FROM personal_tokens t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ? AND t.revoked_at IS NULL`
  )
    .bind(id)
    .first();
  if (!row) return null;
  // Best-effort freshness stamp — the Account page answers "is this device
  // still in use", and an unstamped token looks abandoned.
  try {
    await env.DB.prepare('UPDATE personal_tokens SET last_used_at = ? WHERE id = ?')
      .bind(now, row.token_id)
      .run();
  } catch {
    /* a failed stamp must not fail the request */
  }
  return row;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  });
}

// The public page headers (brand.mjs) — the same CSP, plus `frame-ancestors`
// and `base-uri`, which this module's own copy never had.
const html = (body, status = 200, extraHeaders = {}) => publicResponse(body, status, extraHeaders);

function redirect(to) {
  return new Response(null, { status: 303, headers: { location: to } });
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// -------------------------------------------------------------------- pages

const ACTIVATE_CSS = `
  .code-input {
    font-family: var(--font-mono); font-size: var(--type-xl); letter-spacing: 0.18em;
    text-transform: uppercase; text-align: center; max-width: 15rem;
  }
`;

/**
 * The app's return link (S6↔S9 §5.1 steps 6–7). `state` is the app's
 * per-attempt nonce, accepted only as 32 lowercase hex — anything else is
 * dropped and the page simply has no app links (invariant 2). The links are
 * NUDGES: `done` makes the app poll now, `cancelled` puts its card back. No
 * credential, e-mail or project name ever rides them (invariant 1).
 */
const appReturn = (kind, state) =>
  isAppState(state) ? `maude://auth/${kind}?state=${state}` : null;

export function activatePage({
  account,
  code = '',
  error = null,
  done = false,
  client = null,
  state = null,
}) {
  const s = isAppState(state) ? state : null;
  const doneUrl = appReturn('done', s);
  const DONE = "You're signed in — go back to Maude.";
  const body = done
    ? `<div class="card">${s ? '' : `<h2>${DONE}</h2>`}
       <p class="quiet">The app signs itself in within a few seconds. You can close this tab.</p>
       ${doneUrl ? `<p style="margin:0"><a class="btn" href="${doneUrl}">Open Maude</a></p>` : ''}</div>`
    : `${error ? `<p class="error">${esc(error)}</p>` : ''}
       ${
         client
           ? `<div class="card"><h2>${esc(client.name)} wants to use your account</h2>
                <p class="quiet" style="margin:0">Asked for ${esc(client.asked)}. If you did not
                just start that app on that machine, close this page — connecting it lets it act
                as you.</p></div>`
           : ''
}
       <div class="card">
         <form method="post" action="/activate">
           <label for="code">${client ? 'Confirm the code the app is showing' : 'Enter the code the app is showing'}</label>
           <input class="code-input" type="text" id="code" name="code" value="${esc(code)}"
                  placeholder="XXXX-XXXX" autocomplete="one-time-code" required>
           ${s ? `<input type="hidden" name="state" value="${s}">` : ''}
           <p style="margin-top:var(--space-4)"><button type="submit">Connect the app</button></p>
         </form>
         <p class="quiet" style="margin:0">Only enter a code you are looking at yourself, in an
           app you just started. Anyone with this code can act as you here.</p>
       </div>`;
  if (s) {
    // The app opened this page (S6↔S9 §5.1): it wears the public sign-in
    // shell, the done page hands the browser back with one `meta refresh`
    // (never a Location header — a `maude://` URL in a redirect is a URL a
    // proxy logs), and every other state carries the quiet way back.
    return publicPage({
      title: done ? DONE : 'Connect the app',
      sub: done ? null : 'A Maude app on this Mac is asking to use your account.',
      css: ACTIVATE_CSS,
      extraHead: done ? `<meta http-equiv="refresh" content="0;url=${doneUrl}">` : '',
      body: `${body}${done ? '' : backToAppLink(s)}`,
    });
  }
  return appShell({
    account,
    title: 'Connect an app',
    active: 'account',
    extraCss: ACTIVATE_CSS,
    lede: 'A Maude app on one of your devices is asking to use your account.',
    body,
  });
}

export function accountPage({ account, tokens = [], notice = null }) {
  const rows = tokens
    .map(
      (t) => `<tr>
        <td>${esc(t.label || 'A Maude app')}</td>
        <td class="quiet">added ${new Date(Number(t.created_at)).toISOString().slice(0, 10)}
            ${t.last_used_at ? `· last used ${new Date(Number(t.last_used_at)).toISOString().slice(0, 10)}` : '· never used'}</td>
        <td class="right"><form method="post" action="/account">
          <input type="hidden" name="revoke" value="${esc(t.id)}">
          <button type="submit" class="ghost">Disconnect</button>
        </form></td>
      </tr>`
    )
    .join('\n');
  return appShell({
    account,
    title: 'Account',
    active: 'account',
    extraCss: `
      table { width: 100%; border-collapse: collapse; background: var(--bg-1); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden; margin-bottom: var(--space-6); }
      td { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--border-subtle); font-size: var(--type-base); vertical-align: baseline; }
      tr:first-child td { border-top: 0; }
      td.right { text-align: right; white-space: nowrap; }
    `,
    lede: `Signed in as ${account.email}. Apps and devices connected to your account are listed here — disconnecting one signs it out the next time it checks in.`,
    body: `${notice ? `<p class="ok">${esc(notice)}</p>` : ''}
      ${tokens.length ? `<table><tbody>${rows}</tbody></table>` : '<p class="quiet">No apps are connected yet. The Maude desktop app connects itself when you sign in there.</p>'}`,
  });
}

// -------------------------------------------------------------------- routes

/**
 * Route the device-auth + client-API surfaces. Returns a Response or null.
 */
export async function handleDeviceAuth(request, env, { account, ctx = null }) {
  const url = new URL(request.url);
  const { pathname } = url;
  const now = Date.now();

  // ---- the app asks for a code (unauthenticated — the human approves later)
  if (request.method === 'POST' && pathname === '/auth/device/code') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      /* an empty body is fine — client_name is a nicety */
    }
    const deviceCode = `mdc_${b64hex(crypto.getRandomValues(new Uint8Array(24)))}`;
    const userCode = makeUserCode();
    await env.DB.prepare(
      `INSERT INTO device_codes (device_code, user_code, client_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(
        deviceCode,
        userCode,
        String(body?.client ?? 'Maude app').slice(0, 80),
        now,
        now + DEVICE_CODE_TTL_MS
      )
      .run();
    return json({
      device_code: deviceCode,
      user_code: userCode,
      verification_url: `${url.origin}/activate?code=${encodeURIComponent(userCode)}`,
      interval: POLL_INTERVAL_S,
      expires_in: DEVICE_CODE_TTL_MS / 1000,
    });
  }

  // ---- the app polls for its token
  if (request.method === 'POST' && pathname === '/auth/device/token') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid request' }, 400);
    }
    const row = await env.DB.prepare('SELECT * FROM device_codes WHERE device_code = ?')
      .bind(String(body?.device_code ?? ''))
      .first();
    if (!row || row.expires_at < now) return json({ error: 'expired' }, 400);
    if (!row.approved_account) return json({ pending: true, interval: POLL_INTERVAL_S }, 202);

    // Approved: mint the personal token, burn the code.
    const value = `mpt_${b64hex(crypto.getRandomValues(new Uint8Array(24)))}`;
    await env.DB.prepare(
      `INSERT INTO personal_tokens (id, account_id, label, created_at) VALUES (?, ?, ?, ?)`
    )
      .bind(await sha256Hex(value), row.approved_account, row.client_name, now)
      .run();
    await env.DB.prepare('DELETE FROM device_codes WHERE device_code = ?')
      .bind(row.device_code)
      .run();
    const who = await env.DB.prepare('SELECT email FROM accounts WHERE id = ?')
      .bind(row.approved_account)
      .first();
    await audit(env.DB, {
      accountId: row.approved_account,
      actor: `customer:${who?.email ?? row.approved_account}`,
      action: 'device.connected',
      detail: row.client_name,
    });
    // "Which project first" for a fresh install (S6↔S9 §5.2): derived NOW
    // from an invitation this address redeemed in the last half hour, and
    // re-checked against the claim. Additive — a 1.x app reads token + email.
    const landing = await landingAfterSignIn(env, {
      accountId: row.approved_account,
      email: who?.email ?? null,
      now,
    });
    return json({
      token: value,
      account: { email: who?.email ?? null },
      ...(landing ? { landing } : {}),
    });
  }

  // ---- the human half (dashboard session required)
  if (pathname === '/activate') {
    // The app's own additions (S6↔S9 §5.1 step 3): `state` (its per-attempt
    // nonce) and `invite` (when it is handling an invitation). Anything that
    // is not exactly the expected shape is dropped silently — the page works,
    // it just has no app links and remembers no invitation.
    const asked = url.searchParams.get('invite') ?? '';
    const inviteCookie =
      request.method === 'GET' && /^[0-9a-f-]{36}$/.test(asked)
        ? await pendingInviteCookieFor(env, asked, { now })
        : null;
    if (!account) {
      const to = `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
      return inviteCookie
        ? new Response(null, { status: 303, headers: { location: to, 'set-cookie': inviteCookie } })
        : redirect(to);
    }
    if (request.method === 'GET') {
      const state = url.searchParams.get('state');
      const prefilled = String(url.searchParams.get('code') ?? '')
        .trim()
        .toUpperCase();
      // A prefilled code with NOTHING named is the phishing shape: the page
      // asks for consent and the warning contradicts the prefill. If the code
      // is real and waiting, say which app asked and when (validate
      // 2026-07-30, defender F5).
      let client = null;
      if (prefilled) {
        const row = await env.DB.prepare(
          'SELECT client_name, created_at FROM device_codes WHERE user_code = ? AND approved_account IS NULL AND expires_at > ?'
        )
          .bind(prefilled, now)
          .first();
        if (row) {
          const age = Math.max(0, Math.round((now - Number(row.created_at)) / 1000));
          client = {
            name: row.client_name || 'A Maude app',
            asked: age < 90 ? 'a moment ago' : `${Math.round(age / 60)} minutes ago`,
          };
        }
      }
      return html(
        activatePage({ account, code: prefilled, client, state }),
        200,
        inviteCookie ? { 'set-cookie': inviteCookie } : {}
      );
    }
    if (request.method !== 'POST') return html('<p>Not allowed.</p>', 405);
    const form = await request.formData();
    const code = String(form.get('code') ?? '')
      .trim()
      .toUpperCase();
    // Bound to THIS attempt: the hidden field the app's own page carried.
    // Re-validated, never echoed raw.
    const state = String(form.get('state') ?? '');
    const row = await env.DB.prepare(
      'SELECT * FROM device_codes WHERE user_code = ? AND approved_account IS NULL'
    )
      .bind(code)
      .first();
    if (!row || row.expires_at < now) {
      return html(
        activatePage({
          account,
          state,
          error:
            'That code is not waiting for approval. Codes expire after a few minutes — ask the app for a fresh one.',
        }),
        400
      );
    }
    await env.DB.prepare('UPDATE device_codes SET approved_account = ? WHERE device_code = ?')
      .bind(account.id, row.device_code)
      .run();
    // A sign-in completion (S6↔S9 §5.1 step 5): an invitation this browser
    // remembered is redeemed into the account now, so the token the app is
    // about to collect already carries its landing.
    const pending = await redeemPendingInvite(env, request, account, { now, ctx });
    return html(
      activatePage({ account, done: true, state }),
      200,
      pending.clear ? { 'set-cookie': pending.clear } : {}
    );
  }

  // ---- account + connected devices
  if (pathname === '/account') {
    if (!account) return redirect('/login?next=%2Faccount');
    let notice = null;
    if (request.method === 'POST') {
      const form = await request.formData();
      const id = String(form.get('revoke') ?? '');
      await env.DB.prepare(
        'UPDATE personal_tokens SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL'
      )
        .bind(now, id, account.id)
        .run();
      await audit(env.DB, {
        accountId: account.id,
        actor: `customer:${account.email}`,
        action: 'device.disconnected',
      });
      notice = 'Disconnected. The app signs out the next time it checks in.';
    }
    const rows = await env.DB.prepare(
      'SELECT id, label, created_at, last_used_at FROM personal_tokens WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'
    )
      .bind(account.id)
      .all();
    return html(accountPage({ account, tokens: rows?.results ?? [], notice }));
  }

  // ---- the client API (Bearer personal token)
  if (request.method === 'GET' && pathname === '/api/projects') {
    const bearer = await personalTokenAccount(env, request, { now });
    if (!bearer) return json({ error: 'sign in from the app first' }, 401);
    const rows = await env.DB.prepare(
      `SELECT p.id, p.name, p.state,
              CASE WHEN p.account_id = ?1 THEN 'owner' ELSE m.role END AS role
         FROM projects p
         LEFT JOIN project_members m ON m.project_id = p.id AND m.account_id = ?1
        WHERE p.account_id = ?1 OR m.account_id IS NOT NULL
        ORDER BY p.name`
    )
      .bind(bearer.id)
      .all();
    const projects = (rows?.results ?? []).map((p) => ({
      ...p,
      stateLabel: (STATE_COPY[p.state] ?? { label: p.state }).label,
      url: `https://${p.id}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`,
    }));
    return json({ projects });
  }

  return null;
}

/** Every customer-facing string here, for the vocabulary lint. */
export function allDeviceHtml() {
  const account = { email: 'a@example.com' };
  return [
    activatePage({ account }),
    activatePage({ account, code: 'ABCD-EFGH' }),
    activatePage({
      account,
      code: 'ABCD-EFGH',
      client: { name: 'Maude Studio on darwin', asked: 'a moment ago' },
    }),
    activatePage({
      account,
      error:
        'That code is not waiting for approval. Codes expire after a few minutes — ask the app for a fresh one.',
    }),
    activatePage({ account, done: true }),
    activatePage({ account, code: 'ABCD-EFGH', state: 'a'.repeat(32) }),
    activatePage({ account, done: true, state: 'a'.repeat(32) }),
    accountPage({ account, tokens: [] }),
    accountPage({
      account,
      tokens: [
        {
          id: 'x',
          label: 'Maude Desktop on MacBook',
          created_at: 1753872000000,
          last_used_at: 1753872000000,
        },
      ],
      notice: 'Disconnected. The app signs out the next time it checks in.',
    }),
  ].join('\n');
}
