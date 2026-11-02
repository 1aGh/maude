// One-time handoff codes — Cloud Phase 23 B3 (and the server half of
// Phase 17's maude://).
//
// THE ONE EXCHANGE SHAPE. A signed-in person (browser session or Bearer
// personal token) asks for a code; whoever holds the code — the desktop app a
// deep link just opened, and nothing else — POSTs it back ONCE within two
// minutes and receives the same project token `/projects/open` would mint.
// From there every consumer follows the already-shipped lane: the token goes
// to the cell in a POST body (`/auth/login {token}`), never in a GET URL.
//
// Why a code exists at all: the browser cannot POST into an installed app.
// The only channel from a web page into the app is a `maude://` navigation —
// a URL — and a URL must never carry a bearer token (Referer headers, proxy
// logs, the repo's own /join decision). So the URL carries a claim ticket:
// single-use, 120-second, hashed at rest, and worth nothing after the app
// trades it in.
//
// Guessing is not a lane: 32 random bytes; the exchange burns the row on
// first use, win or lose downstream.

import { declaredAccessOf, peerTokenDoor } from '../studio/access/scope.ts';
import {
  accessOf,
  cellSupportsRolesV2,
  loadClaim,
  SERVER_UPDATE,
  validCanvasPath,
} from './access-forward.mjs';
import { DESKTOP_DOWNLOAD_URL } from './brand.mjs';
import { mintProjectToken } from './cell-token.mjs';
import { audit } from './db.mjs';
import { personalTokenAccount } from './device-auth.mjs';
import { landingForInvite } from './invites.mjs';
import { ACCESS_MESSAGES } from './project-access.mjs';

const CODE_TTL_MS = 2 * 60 * 1000;

function b64hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(s) {
  return b64hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-content-type-options': 'nosniff' },
  });
}

/**
 * Mint a one-time code for one project. Caller must already be resolved to an
 * account (session or personal token) — this function only decides access.
 *
 * Viewer is REFUSED here, exactly like the cell exchange (B2): a code that a
 * viewer could trade for an editing credential would be the silent escalation
 * the debate ruled out.
 */
export async function mintHandoffCode(
  env,
  { account, projectId, now = Date.now(), surface = 'app', declaredAccess = 1, canvas = null }
) {
  // The CLAIM, not only the project role (V2-1.7 §5.3): a canvas-only person
  // holds no membership row but does hold grants, and the browser lane is
  // exactly where they open their canvas.
  const { verdict } = await loadClaim(env.DB, projectId, account?.id ?? null);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  // The APP lane still refuses viewers — a desktop session is an editing
  // credential, and handing one to a viewer would be the silent escalation the
  // debate ruled out. The BROWSER lane (Cloud Phase 25 B1) does not: looking,
  // commenting and downloading is what the role means, and the browser is
  // where a viewer does it. The cell then holds them read-only (C1/C3), so the
  // rule is enforced where it cannot be argued with rather than by withholding
  // the door.
  //
  // V2-1.7 §5.4 (S9.2): a client that DECLARES `X-Maude-Access: 2` holds a
  // viewer read-only on the app lane too (the v2 desktop gates every write by
  // the role), so the refusal stands only for a client that did not say so —
  // a 1.x app, or the dashboard's own form, which cannot.
  if (surface !== 'browser' && verdict.role === 'viewer' && declaredAccess !== 2) {
    return { ok: false, reason: 'viewer-not-supported' };
  }

  // Where the app (or the browser lane) should land once the code is traded
  // (S9 Q6): a canvas the claim can see, else an invitation this person
  // redeemed in the last half hour. Never a place the claim cannot see.
  const access = accessOf(verdict);
  let landing = null;
  if (canvas && validCanvasPath(canvas) && access.seesCanvas(canvas)) {
    landing = { project: projectId, canvas };
  } else {
    landing = await landingForInvite(env.DB, { email: account.email, projectId, now });
    if (landing?.canvas && !access.seesCanvas(landing.canvas)) landing = { project: projectId };
  }

  const code = `mhc_${b64hex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const id = await sha256Hex(code);
  // NOT NULL since v9; a canvas-only claim has no project role to name.
  const role = verdict.role ?? '';
  try {
    await env.DB.prepare(
      `INSERT INTO handoff_codes (id, project_id, account_id, role, created_at, expires_at, surface, access, landing)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        projectId,
        account.id,
        role,
        now,
        now + CODE_TTL_MS,
        surface,
        // The claim captured at mint — a record; the exchange re-decides it.
        JSON.stringify({ v: 1, role: verdict.role, grants: verdict.grants }),
        landing ? JSON.stringify(landing) : null
      )
      .run();
  } catch {
    // A deploy meets its schema within the hour (the cron migrates), so for
    // that hour D1 may still be v16: no `access` / `landing` columns. The code
    // still works; only the record and the landing wait for the migration.
    await env.DB.prepare(
      `INSERT INTO handoff_codes (id, project_id, account_id, role, created_at, expires_at, surface)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, projectId, account.id, role, now, now + CODE_TTL_MS, surface)
      .run();
  }
  return { ok: true, code, role: verdict.role, expiresIn: CODE_TTL_MS / 1000 };
}

/** A stored landing, re-checked against the claim decided at exchange. */
function landingFrom(raw, projectId, access) {
  try {
    const l = JSON.parse(raw ?? 'null');
    if (!l || l.project !== projectId) return null;
    if (l.canvas && !(validCanvasPath(l.canvas) && access.seesCanvas(l.canvas))) {
      return { project: projectId };
    }
    return { project: projectId, ...(l.canvas ? { canvas: l.canvas } : {}) };
  } catch {
    return null;
  }
}

/**
 * Route the handoff surface. Returns a Response or null.
 *
 *   POST /projects/<id>/handoff     mint (session or Bearer personal token);
 *                                   HTML form POST → the maude:// launch page,
 *                                   JSON → { code, url, expires_in }
 *   POST /auth/handoff/exchange     { code } → project token (single use)
 */
export async function handleHandoff(request, env, { account }) {
  const url = new URL(request.url);
  const { pathname } = url;
  const now = Date.now();

  // ---- the BROWSER door (Cloud Phase 25 B1/B2) ---------------------------
  //
  // A GET, because it is a navigation: the member's browser lands here from
  // the cell, we authenticate the Maude account, decide access, and bounce
  // back with a claim ticket. Every refusal answers the SAME way (B2): what to
  // do next, and never whether the project exists.
  const browserMatch =
    request.method === 'GET' && /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/browser$/.exec(pathname);
  if (browserMatch) {
    const projectId = browserMatch[1];
    const zone = env.CELL_ZONE ?? 'cloud.maude.sh';
    // The return address is NOT taken from the query string — a redirect
    // target a stranger can set is an open redirect with a live code attached.
    // It is derived from the project id, which is the only cell that could
    // legitimately have sent this person here.
    const back = `https://${projectId}.${zone}/auth/browser`;
    if (!account) account = await personalTokenAccount(env, request, { now });
    if (!account) {
      // Sign in first, then come straight back to this same URL.
      const next = encodeURIComponent(`${url.pathname}${url.search}`);
      return new Response(null, {
        status: 302,
        // `/login` is the sign-in PAGE (GET); `/auth/login` is the form's
        // POST target and 404s on GET. Sending a signed-out member to the
        // latter dead-ended the whole browser door at the last step.
        headers: { location: `/login?next=${next}`, 'cache-control': 'no-store' },
      });
    }
    const minted = await mintHandoffCode(env, {
      account,
      projectId,
      now,
      surface: 'browser',
      // A link redeem may name the canvas to land on. A location, re-checked
      // against the claim — never a grant.
      canvas: url.searchParams.get('canvas'),
    });
    if (!minted.ok) {
      // ONE answer for "no access" and "no such project" — a distinct 404
      // would be a project-existence oracle for anyone with an account.
      return new Response(null, {
        status: 302,
        headers: { location: `${back}?denied=1`, 'cache-control': 'no-store' },
      });
    }
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'browser.open',
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: `${back}?code=${encodeURIComponent(minted.code)}`,
        'cache-control': 'no-store',
        // The code is live for two minutes and single-use; keep it out of the
        // next hop's Referer.
        'referrer-policy': 'no-referrer',
      },
    });
  }

  const mintMatch =
    request.method === 'POST' && /^\/projects\/([a-z0-9]+(?:-[a-z0-9]+)*)\/handoff$/.exec(pathname);
  if (mintMatch) {
    // A browser session and a device's personal token are the same person
    // through two doors — same rule as /projects/open.
    // The caller decides the medium, ONCE, for every answer this route gives
    // (Cloud Phase 24 A3). The success path always negotiated; the refusals did
    // not, so a customer who pressed "Open in Maude" as a viewer met raw JSON —
    // a regression introduced 2026-07-30 in this very lane.
    const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
    const refuse = (message, status, { projectId = null } = {}) =>
      wantsJson
        ? json({ error: message }, status)
        : htmlPage(refusalPage({ message, projectId }), status);

    if (!account) account = await personalTokenAccount(env, request, { now });
    if (!account) return refuse(ACCESS_MESSAGES['not-signed-in'], 401);
    const projectId = mintMatch[1];
    const minted = await mintHandoffCode(env, {
      account,
      projectId,
      now,
      declaredAccess: declaredAccessOf(request.headers.get('x-maude-access')),
    });
    if (!minted.ok) {
      if (minted.reason === 'viewer-not-supported') {
        // No gallery to send them to (Cloud Phase 25 C4 removes it), so this
        // says what IS true today: the dashboard is theirs, the app is not.
        return refuse(
          'You are on this project as a viewer, so you can follow it here on the dashboard. ' +
            'Opening it in the Maude app needs the member role — ask whoever runs the project.',
          403,
          { projectId }
        );
      }
      const status = minted.reason === 'not-signed-in' ? 401 : 404;
      return refuse(
        ACCESS_MESSAGES[minted.reason] ?? ACCESS_MESSAGES['no-access'],
        status,
        // A 404 must not confirm that the project exists, so it gets no
        // project-scoped link back.
        status === 404 ? {} : { projectId }
      );
    }
    await audit(env.DB, {
      accountId: account.id,
      projectId,
      actor: `customer:${account.email}`,
      action: 'app.handoff',
    });

    const deepLink = `maude://open/${encodeURIComponent(projectId)}?code=${encodeURIComponent(minted.code)}&origin=${encodeURIComponent(url.origin)}`;
    if (wantsJson) return json({ code: minted.code, url: deepLink, expires_in: minted.expiresIn });

    // The browser lane: a tiny no-script page whose meta refresh fires the
    // maude:// navigation, with the same link visible for when the browser
    // asks first — and honest fallbacks for "nothing happened".
    return htmlPage(launchPage({ projectId, deepLink }));
  }

  if (request.method === 'POST' && pathname === '/auth/handoff/exchange') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid request' }, 400);
    }
    const presented = String(body?.code ?? '');
    if (!presented.startsWith('mhc_')) return json({ error: 'that code is not valid' }, 400);
    const id = await sha256Hex(presented);

    // Burn first, decide after — a second presentation of the same code must
    // lose even if it races the first. D1 reports changed rows; zero means
    // someone else already burned it (or it never existed).
    const burn = await env.DB.prepare(
      'UPDATE handoff_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?'
    )
      .bind(now, id, now)
      .run();
    if (!burn?.meta?.changes) return json({ error: 'that code is not valid or has expired' }, 400);

    const row = await env.DB.prepare('SELECT * FROM handoff_codes WHERE id = ?').bind(id).first();
    const who = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?')
      .bind(row.account_id)
      .first();

    // Re-decide access at exchange time: a code must not outlive a removal
    // that happened in its two-minute window. The CLAIM (role + grants) is
    // read again; the one captured at mint is a record, not a ticket.
    const { verdict } = await loadClaim(env.DB, row.project_id, row.account_id);
    // Re-decided at exchange, and the surface decides the viewer rule (Phase
    // 25 B1) — the same asymmetry as the mint, applied to a code that may have
    // been minted two minutes ago and to a membership that may have changed
    // since. NULL surface = a code from before this lane existed = 'app'.
    const browserLane = row.surface === 'browser';
    // THE MINT DOOR (V2-1.7 §5.4) — the same decision the cell's /auth/login
    // makes, asked of the same table. The client declares what it understands;
    // the cell's browser sign-in (the browser lane) declares 2 itself.
    const declaredAccess = declaredAccessOf(request.headers.get('x-maude-access'));
    if (
      !verdict.ok ||
      (!browserLane && verdict.role === 'viewer' && declaredAccess !== 2) ||
      !who
    ) {
      return json({ error: 'that code is not valid or has expired' }, 400);
    }
    const door = peerTokenDoor(
      { v: 1, role: verdict.role, grants: verdict.grants },
      {
        declaredAccess,
        doorUrl: `https://${row.project_id}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`,
        browserLane,
      }
    );
    if (door.outcome === 'update' || door.outcome === 'browser-door') {
      return json(door.body, door.status);
    }
    if (door.outcome !== 'mint') {
      return json({ error: 'that code is not valid or has expired' }, 400);
    }
    // A v2 credential only for a cell that can hold it (V2-1.7 §5.8 step 4).
    // An older cell would read `m2.` as malformed anyway; saying why is what
    // lets the app tell the person instead of looping on a sign-in.
    if (door.v2 && !(await cellSupportsRolesV2(env, row.project_id))) {
      return json(SERVER_UPDATE, 409);
    }

    if (!env.CELL_SECRET_MASTER) {
      console.error('[handoff] CELL_SECRET_MASTER is not configured');
      return json({ error: 'This project cannot be opened right now. Try again shortly.' }, 503);
    }
    const { token, claims } = await mintProjectToken({
      master: env.CELL_SECRET_MASTER ?? '',
      project: row.project_id,
      email: who.email,
      role: door.claim.role,
      grants: door.claim.grants,
    });
    // Where to land (S9 Q6) — additive, so a v1 app ignores the key.
    const landing = landingFrom(row.landing, row.project_id, accessOf(verdict));
    return json({
      token,
      role: door.claim.role,
      project: row.project_id,
      url: `https://${row.project_id}.${env.CELL_ZONE ?? 'cloud.maude.sh'}`,
      expiresAt: claims.exp,
      ...(landing ? { landing } : {}),
    });
  }

  return null;
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// These pages carry a LIVE code, so they ship no script and no stylesheet
// (CSP `default-src 'none'`) — the styling is inline, and that is why it does
// not come from brand.mjs's shell.
const PAGE_STYLE = `
  body { font-family: -apple-system, system-ui, sans-serif; background:#111318; color:#f2f3f7;
         display:grid; place-items:center; min-height:100vh; margin:0; padding:24px; }
  main { max-width:26rem; text-align:center; }
  a.btn { display:inline-block; background:#7a86f8; color:#14162b; font-weight:600;
          padding:10px 18px; border-radius:10px; text-decoration:none; margin-top:12px; }
  p.quiet { color:#9aa0b0; font-size:14px; line-height:1.5; }
  a.plain { color:#aab3ff; }`;

function htmlPage(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
    },
  });
}

function launchPage({ projectId, deepLink }) {
  // No script (CSP default-src 'none'): the meta refresh fires the app, the
  // visible link covers browsers that ask before leaving the page.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="0;url=${esc(deepLink)}">
<title>Opening ${esc(projectId)} in Maude</title>
<style>${PAGE_STYLE}
</style></head><body><main>
  <h1>Opening in Maude…</h1>
  <p class="quiet">If nothing happened, use the button below.</p>
  <a class="btn" href="${esc(deepLink)}">Open ${esc(projectId)} in Maude</a>
  <p class="quiet">Don’t have the app yet? <a class="plain" href="${DESKTOP_DOWNLOAD_URL}">Get it at maude.sh/desktop</a>,
  then come back here and press the button again. The link works once and expires after two
  minutes — coming back later just needs another press of “Open in Maude” on the project page.</p>
</main></body></html>`;
}

/**
 * The same door, refused (Cloud Phase 24 A3).
 *
 * A browser form POST gets a page, never a JSON body — the mint path already
 * negotiated and the refusals did not, which is how "Open in Maude" could end
 * a non-technical customer's afternoon on `{"error":"..."}`.
 */
function refusalPage({ message, projectId = null }) {
  const back = projectId
    ? `<a class="btn" href="/projects/${esc(projectId)}/connect">Back to the project</a>`
    : '<a class="btn" href="/">Back to your projects</a>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cannot open this project — Maude</title>
<style>${PAGE_STYLE}
</style></head><body><main>
  <h1>Cannot open this</h1>
  <p class="quiet">${esc(message)}</p>
  ${back}
</main></body></html>`;
}

/** Customer-facing strings for the vocabulary lint. */
export function allHandoffHtml() {
  return [
    launchPage({
      projectId: 'alligators',
      deepLink: 'maude://open/alligators?code=mhc_x&origin=https://cloud.maude.sh',
    }),
    refusalPage({
      message:
        'You are on this project as a viewer, so you can follow it here on the dashboard. ' +
        'Opening it in the Maude app needs the member role — ask whoever runs the project.',
      projectId: 'alligators',
    }),
    refusalPage({ message: ACCESS_MESSAGES['no-access'] }),
  ].join('\n');
}
