// The canvas origin's capability — Cloud Phase 25 A4.
//
// The rendered canvas runs in a SEGREGATED ORIGIN (DDR-054): the editing shell
// and the tenant's own code never share one, in the browser either. A separate
// origin means no cookies, which means the canvas origin cannot borrow the
// member's session — so the shell hands the iframe an explicit, short-lived,
// READ-ONLY capability instead.
//
// Why a token in a URL, when this repo's own /join decision says not to. The
// objection there was a token that grants ACCOUNT access travelling somewhere
// it can be logged and replayed. This one grants exactly "read the bytes of
// this project's canvases, for the next few minutes" — no mutation surface is
// reachable from the canvas origin at all — and it is the only mechanism that
// works: an opaque/foreign origin sends no cookie by construction.
//
// Stateless: HMAC over (project, subject, expiry) with the cell's own secret.
// No table, so no revocation — which is why the lifetime is minutes, and why
// the kill switch (A3) works at the ROUTE level rather than by invalidating
// tokens.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a render capability lives. Short: it cannot be revoked. */
export const RENDER_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * The canvas capability's lifetime on THIS hub. `MAUDE_CANVAS_TOKEN_TTL_MS`
 * may only SHORTEN it (floor one minute) — a shorter unrevocable token is
 * strictly safer — so a test rig can prove that open canvases keep working
 * across several expiries without waiting fifteen minutes for each. The
 * studio re-mints before expiry, reading the lifetime off the token itself.
 */
export function canvasTokenTtlMs(env = process.env) {
  const v = Number(env.MAUDE_CANVAS_TOKEN_TTL_MS);
  if (!Number.isFinite(v) || v <= 0) return RENDER_TOKEN_TTL_MS;
  return Math.min(RENDER_TOKEN_TTL_MS, Math.max(60_000, Math.floor(v)));
}

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Mint a capability for one member's canvas session.
 * `subject` is the member's email — it makes an audit line possible and binds
 * the token to a person rather than to "anyone who saw the page".
 *
 * `role` is the member's PROJECT role (role-matrix vocabulary), carried so the
 * canvas origin's live surfaces open at the member's real capability instead
 * of the viewer floor — the per-canvas collab WebSocket, and (since the
 * cloud-canvas-writes RCA) the HTTP writes to the lanes the iframe legitimately
 * co-authors (annotations, artboard layout, media, comment replies), which are
 * the iframe's ONLY persistence path. Both doors run the claim through the one
 * `decide()`/role-matrix authority, and the canvas origin still exposes no
 * source-write, export, or config route at any role (DDR-088 allowlist +
 * DDR-122 realm gate for the WS body lanes). An exfiltrated token is therefore
 * worth exactly the subject's own role on the inert collab surface, for the
 * TTL — the same grant the WS lane already made. Absent (older tokens) →
 * verifiers fall back to `viewer`.
 */
export function mintRenderToken({
  secret,
  project,
  subject,
  role = null,
  /** DDR-242 — a capability for the `?embed=1` view: reads only. The canvas
   *  door refuses EVERY unsafe method and every collab socket carrying it,
   *  whatever `role` says — the comment lane a viewer keeps included. */
  readOnly = false,
  now = Date.now(),
  ttlMs = RENDER_TOKEN_TTL_MS,
}) {
  if (!secret) throw new Error('a hub secret is required to mint a render token');
  // JSON, not a delimiter-joined string: the subject is an EMAIL ADDRESS and
  // addresses contain dots, so a `a.b.c` payload split back into the wrong
  // three fields and every token read as expired. Structured in, structured
  // out — no parsing rule to get subtly wrong.
  const payload = JSON.stringify({
    p: project,
    s: subject,
    ...(role ? { r: role } : {}),
    ...(readOnly ? { ro: 1 } : {}),
    e: now + ttlMs,
  });
  return `${Buffer.from(payload).toString('base64url')}.${sign(secret, payload)}`;
}

/** Verify a capability. Returns `{ok, project, subject, role}` or `{ok:false, reason}`. */
export function verifyRenderToken({ secret, token, project, now = Date.now() }) {
  if (!secret || typeof token !== 'string' || !token.includes('.')) {
    return { ok: false, reason: 'missing' };
  }
  const cut = token.lastIndexOf('.');
  const body = token.slice(0, cut);
  const mac = token.slice(cut + 1);
  let payload;
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const expected = sign(secret, payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return { ok: false, reason: 'bad-signature' };
  let claims;
  try {
    claims = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const exp = Number(claims?.e);
  if (!Number.isFinite(exp) || exp < now) return { ok: false, reason: 'expired' };
  if (project && claims?.p !== project) return { ok: false, reason: 'wrong-project' };
  return {
    ok: true,
    project: claims.p,
    subject: claims.s,
    // Fail toward the floor: a token without a role claim is a viewer's.
    role: typeof claims.r === 'string' ? claims.r : null,
    // DDR-242 — signed, so a holder cannot strip it to regain the role's writes.
    readOnly: claims.ro === 1,
  };
}
