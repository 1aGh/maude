// The authenticating reverse proxy — Cloud Phase 27 A2/A3/A4, under DDR-209.
//
// The hub stops rendering UI. It terminates the session, resolves the role,
// checks the deny-by-default manifest, and forwards to the real studio on
// loopback. Everything a member sees is served by the same code the desktop
// runs, which is the entire point of the phase.
//
// THREE PROPERTIES THIS FILE EXISTS TO HOLD.
//
// 1. THE ROLE IS PER SESSION, NOT PER PROCESS. The studio's own gate reads a
//    per-PROCESS config file — one role per hub URL. Correct for a desktop with
//    one user; wrong for one cell serving an owner and a viewer at the same
//    time. So the proxy owns the role and INJECTS it per request. The studio's
//    gate stays as defence in depth, never as the authority (A3).
//
// 2. AN INBOUND `x-maude-*` HEADER IS AN ATTACK. The whole scheme is "the proxy
//    tells the studio who this is", so a client that can set that header is a
//    client that can be anyone. Every such header is STRIPPED before the
//    manifest is consulted, not after, and not conditionally.
//
// 3. FAIL CLOSED (A4). No session, no role, no manifest entry, no upstream —
//    each of those refuses. `isHubReadOnly()` returning `false` from its `catch`
//    is correct for a local tool and is the whole ballgame on the internet; this
//    proxy inverts that default and a test asserts it.

import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';

import { RENDER_TOKEN_TTL_MS } from './render-token.mjs';
import { isReadOnlyRole } from './role-matrix.mjs';
import { decide } from './studio-manifest.mjs';

/** Headers a client must never be able to speak. See property 2 above. */
export const INJECTED_HEADER_PREFIX = 'x-maude-';

/**
 * The canvas origin's capability, as a cookie ON THE CANVAS ORIGIN.
 *
 * WHY A COOKIE AFTER ALL, HAVING SAID NO TO ONE.
 *
 * The capability travels in the URL because the canvas origin is separate and
 * a separate origin sends no cookie. That is true of the URLs the SHELL builds
 * — the iframe, the module, the design system's CSS — and it is exactly false
 * of the ones it does not build. Canvas code is the tenant's own source, and
 * the tenant's own source says `<img src="/.design/system/x/assets/logo.svg">`.
 * That URL is emitted by the browser with no query string, because nothing in
 * the request path ever passes through code we wrote. Every asset, every font,
 * every photograph: 401. The page rendered and was empty of everything that
 * makes it a design.
 *
 * The shell cannot fix this. Rewriting the tenant's source to append a token
 * to every URL means parsing and rewriting arbitrary JSX, CSS `url()`, inline
 * styles and anything computed at runtime — the last of which is not solvable
 * at all. So the capability has to be ambient on that origin, which means a
 * cookie, which is the thing DDR-054 refused.
 *
 * WHAT MAKES IT DIFFERENT FROM THE ONE DDR-054 REFUSED. That objection was
 * about the SHELL's session cookie being scoped wide enough to reach the
 * canvas origin — the untrusted origin borrowing the trusted one's identity.
 * This is the opposite direction and a different credential:
 *
 *   · It is host-scoped to `canvas-<project>.<zone>`, an origin that exists per
 *     project (Phase 27) and serves one read-only allowlist. It is not sent to
 *     the shell, to another tenant, or to the control plane.
 *   · It IS the render token — same HMAC, same fifteen-minute life, same
 *     read-only grant. Nothing new is authorised; the same capability simply
 *     survives a URL the shell did not write.
 *   · `HttpOnly`, so the canvas's own scripts cannot read it — the canvas is
 *     untrusted code and must not be able to exfiltrate its own capability.
 *
 * `SameSite=Strict`, and the reasoning that first said `Lax` is written down
 * here because it was WRONG in a way that reads as right.
 *
 * The shell and the canvas origin are the same SITE — both under the
 * registrable domain — so the iframe's subresource requests carry the cookie
 * under either value. `Lax` was chosen on the strength of "a genuinely foreign
 * page gets nothing", which is true and is not the threat. Two things it
 * missed, both found by an adversarial pass rather than by reasoning:
 *
 *   · `Lax` IS sent on a cross-site top-level GET navigation. Any page
 *     anywhere can `window.open` a canvas-origin URL and the capability rides.
 *     That is precisely the request class this origin serves.
 *   · "Same site" is computed at the REGISTRABLE DOMAIN, so on a multi-tenant
 *     `*.<zone>` platform every tenant's canvas origin, every tenant's shell,
 *     the control plane and the marketing site are all same-site with each
 *     other. `SameSite` never expressed the tenant boundary the cell
 *     architecture exists to enforce; it is coarser than the origin, and the
 *     isolation that actually holds is the cookie's HOST scope plus the
 *     route allowlist.
 *
 * `Strict` costs nothing here — the legitimate flow is an iframe inside a
 * top-level document on the project's own shell origin, which is same-site —
 * and it removes the drive-by-navigation leg. It does NOT fix same-site script
 * execution; nothing a cookie attribute can say does.
 */
export const CANVAS_CAPABILITY_COOKIE = 'maude_canvas';

/**
 * DDR-242 — the `?embed=1` view's read-only capability, as a cookie of its own.
 * Same attributes, same host scope; it authorises asset GETs and nothing else
 * (so does `maude_canvas` now — writes and sockets need `?t=`), and it exists
 * so an embed never overwrites the designer's full cookie on the same origin.
 */
export const EMBED_CAPABILITY_COOKIE = 'maude_canvas_embed';

/**
 * Serialize it, with `Secure` DEFAULTED ON.
 *
 * The first version derived `Secure` from `MAUDE_PUBLIC_CANVAS_ORIGIN`
 * starting with `https://`, which means a missing, empty, scheme-less or
 * misspelled value silently drops the flag — a fail-OPEN on exactly the input
 * whose absence should fail closed, on a deployment that is otherwise https.
 * The flag now comes off only for a deployment that has positively declared
 * itself plaintext, which is the same signal the hub already refuses to serve
 * a public host without.
 */
export function canvasCapabilityCookie(token, env = process.env, name = CANVAS_CAPABILITY_COOKIE) {
  const plaintext =
    env.HUB_INSECURE_HTTP === '1' || (env.MAUDE_PUBLIC_CANVAS_ORIGIN ?? '').startsWith('http://');
  return (
    `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; ` +
    `SameSite=Strict; Max-Age=${canvasCookieMaxAge}${plaintext ? '' : '; Secure'}`
  );
}

/**
 * The cookie outlives the token by design, and that grants nothing.
 *
 * The signature carries its own expiry, so a stale cookie fails verification
 * exactly when a stale URL would. The extra window only avoids the browser
 * dropping a cookie moments before the shell reloads and replaces it — a
 * refresh is what re-mints, and a canvas left open all afternoon should meet
 * one clean 401 rather than an intermittent one.
 */
const canvasCookieMaxAge = Math.floor((RENDER_TOKEN_TTL_MS * 2) / 1000);

/** Read one cookie from a Node request without pulling in a parser. */
function cookieFrom(request, name) {
  const raw = request?.headers?.cookie;
  if (!raw) return null;
  for (const part of String(raw).split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** DDR-242 — a shell request made by the `?embed=1` view. */
function isEmbedRequest(request) {
  try {
    return new URL(request?.url ?? '/', 'http://cell.invalid').searchParams.get('embed') === '1';
  } catch {
    return false;
  }
}

/** The shell document — the one response allowed to plant the cookie. */
function isCanvasShellPath(rest) {
  return rest === '/_canvas-shell.html' || rest === '/_canvas-shell';
}

/** Normalize to a bare origin, or `null` for anything that is not a URL —
 *  including the literal `Origin: null` a sandboxed frame sends. */
function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** The same, down to `host[:port]` — what survives a tunnel that terminates TLS. */
function hostOf(value) {
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

/** Hop-by-hop headers — meaningless to forward, actively harmful to copy. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * The headers we send upstream: the client's, minus anything hop-by-hop, minus
 * anything it could have used to impersonate the proxy — plus the truth.
 */
export function upstreamHeaders(
  incoming,
  { role, user, sessionKey, publicUrl, canvasToken, renderToken, collabRealm }
) {
  const out = {};
  for (const [k, v] of Object.entries(incoming ?? {})) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key)) continue;
    if (key.startsWith(INJECTED_HEADER_PREFIX)) continue; // property 2
    if (key === 'host') continue; // D4 — identity comes from configuration
    out[k] = v;
  }
  // D4 again: the studio must not learn its own address from a header a tunnel
  // rewrote. It is told, once, what it is.
  //
  // A malformed configured URL omits the Host rather than throwing. Throwing
  // here fails the REQUEST, not the boot — so one scheme-less environment
  // variable turns every canvas load into a 502 with an `ERR_INVALID_URL`
  // buried in the cell's logs, which is a far worse way to learn about a typo
  // than the missing-Host path the next line already handles.
  if (publicUrl) {
    try {
      out.host = new URL(publicUrl).host;
    } catch {
      /* not a URL — leave the Host unset, which the studio already tolerates */
    }
  }
  out[`${INJECTED_HEADER_PREFIX}role`] = role;
  // The DERIVED capability, not just the label. The studio must not re-derive
  // what `viewer` means — that would be a second copy of the role model, in
  // another language, in a package that ships to end users on npm. One table
  // (`role-matrix.mjs`), one authority; everything else mirrors its answer.
  out[`${INJECTED_HEADER_PREFIX}readonly`] = isReadOnlyRole(role) ? '1' : '0';
  if (user) out[`${INJECTED_HEADER_PREFIX}user`] = user;
  // The capability that opens the cookieless canvas origin. The client appends
  // it to every canvas iframe URL; minting it here keeps the signing secret in
  // the process that already holds it.
  if (canvasToken) out[`${INJECTED_HEADER_PREFIX}canvas-token`] = canvasToken;
  // The VIEWER-scoped render capability (DDR-230 §c). The studio forwards THIS
  // — never the member's own canvas token — to the maude-render service, so
  // the browser-bearing worker can read the canvas and nothing more.
  if (renderToken) out[`${INJECTED_HEADER_PREFIX}render-token`] = renderToken;
  // D3 — the session dimension. `_active.json` and `<slug>.view.json` are
  // per-machine singletons by design (DDR-115); in one cell serving two members
  // that means they clobber each other's selection and camera, silently, and it
  // reads as flakiness rather than as a bug. The studio partitions its runtime
  // state by this key.
  if (sessionKey) out[`${INJECTED_HEADER_PREFIX}session`] = sessionKey;
  // Which realm a collab WebSocket was upgraded on. `canvas` marks the
  // untrusted canvas iframe origin — the studio stamps it onto the socket and
  // the room's DDR-122 origin gate applies. Injected (never trusted inbound —
  // the prefix strip above already removed any client-supplied value), so a
  // canvas-origin socket cannot claim the privileged shell realm.
  if (collabRealm) out[`${INJECTED_HEADER_PREFIX}collab-realm`] = collabRealm;
  return out;
}

/**
 * A stable, non-identifying per-session key.
 *
 * The email would work and is a worse choice: it would end up in file names on
 * disk, in a directory a support engineer might read, for a person who did not
 * agree to that. A hash of (project, email) is stable across reconnects, unique
 * per member, and says nothing.
 */
export function sessionKeyFor(project, email, hash) {
  return hash(`${project}\0${email}`).slice(0, 16);
}

function refuse(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

/** The sentence a refusal says. One wording, everywhere, matching the promise
 *  the People page makes — a viewer who is told something different by two
 *  surfaces concludes one of them is broken. */
export const READ_ONLY_MESSAGE =
  'You can look at this project, comment and download it, but not change it.';

/**
 * Build the proxy.
 *
 * @param {object} deps
 * @param {() => ({ ok: boolean, port: number })} deps.upstream  the supervised child's status
 * @param {() => ({ ok: boolean, port: number|null })} [deps.canvasUpstream]
 * @param {string} [deps.publicUrl]
 */
export function createStudioProxy({
  upstream,
  canvasUpstream = null,
  publicUrl = null,
  env = process.env,
  /** Mint the canvas origin's capability for this session. Injected so the
   *  signing secret never leaves the process that owns it. */
  mintCanvasToken = null,
  /** Mint a VIEWER-scoped render capability for this session — the token the
   *  cell forwards to the maude-render service (DDR-230 §c). Read-only by
   *  construction, never the member's own write-capable canvas token, so a
   *  Chromium-escaped worker holds no write grant. Separate closure so the
   *  signing secret still never leaves this process. */
  mintRenderToken = null,
  forward = defaultForward,
  forwardUpgrade = defaultForwardUpgrade,
  /**
   * Cloud Phase 27 B3 — called after a browser upload has actually landed.
   *
   * The asset write itself belongs to the studio (it owns the tree, the sniff,
   * the caps and the content-addressed name); what the studio cannot do in a
   * cell is reach object storage, because its credentials are deliberately not
   * in `childEnv()`. So the hub watches for the one request that creates an
   * asset and mirrors it — no fs watcher, no polling, and no widening of the
   * child's environment.
   */
  onAssetWritten = null,
} = {}) {
  /**
   * Handle one HTTP request destined for the studio.
   *
   * @returns {Promise<boolean>} true when this proxy answered (or forwarded).
   */
  async function handle({ request, response, pathname, method, session }) {
    // ---- A4: fail closed -------------------------------------------------
    //
    // Order matters. The session check comes BEFORE the manifest so an
    // unauthenticated request never learns which routes exist, and the upstream
    // check comes last so a signed-in member gets "starting up", not "sign in".
    if (!session?.role) {
      refuse(response, 401, { error: 'sign in to open this project', reason: 'no-session' });
      return true;
    }

    const verdict = decide(method, pathname, session.role);
    if (!verdict.allow) {
      if (verdict.reason === 'method') {
        refuse(response, 405, { error: 'method not allowed' });
        return true;
      }
      if (verdict.reason === 'unclassified' || verdict.reason === 'refused') {
        // 404, not 403. A cell should look like it never had the feature rather
        // than like it is refusing one — the same posture the containment
        // fall-through takes, and for the same reason: a refusal is a map.
        refuse(response, 404, { error: 'not found' });
        return true;
      }
      refuse(response, 403, {
        error: READ_ONLY_MESSAGE,
        reason: 'read-only',
        capability: verdict.capability,
      });
      return true;
    }

    const up = upstream();
    if (!up?.ok) {
      // 503 + Retry-After, because this is genuinely transient: the supervisor
      // is restarting the child and will succeed. Saying 500 here would make an
      // ordinary restart look like data loss to whoever is watching.
      response.writeHead(503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': '2',
      });
      response.end(
        JSON.stringify({
          error: 'This project is starting up. Your work is safe — try again in a moment.',
          reason: 'upstream-starting',
        })
      );
      return true;
    }

    await forward({
      request,
      response,
      port: up.port,
      headers: upstreamHeaders(request.headers, {
        role: session.role,
        user: session.email,
        sessionKey: session.sessionKey,
        publicUrl,
        // DDR-242 — the `?embed=1` view asks with `embed=1` (its `/_config`
        // and every re-mint) and is handed a READ-ONLY capability, so the
        // canvas it frames can never write, whatever the member's role.
        canvasToken:
          mintCanvasToken?.(session, isEmbedRequest(request) ? { readOnly: true } : undefined) ??
          null,
        renderToken: mintRenderToken?.(session) ?? null,
      }),
    });
    // B3 — only on a write that SUCCEEDED. The studio's own caps and sniff have
    // already run by the time it answered 2xx, so mirroring here inherits every
    // one of them rather than re-deciding what an asset is.
    if (
      method === 'POST' &&
      pathname === '/_api/asset' &&
      response.statusCode >= 200 &&
      response.statusCode < 300
    ) {
      try {
        onAssetWritten?.();
      } catch {
        /* the upload succeeded; a mirror failure must not un-succeed it */
      }
    }
    return true;
  }

  /**
   * The CANVAS origin lane.
   *
   * A different hostname, no browser session cookie, and that is deliberate: a
   * cookie scoped widely enough to cover `canvas.<zone>` would be readable by
   * the untrusted canvas origin, which defeats the DDR-054 split entirely. So
   * the capability lives in the URL (`?t=<render token>`) or the host-scoped
   * HttpOnly cookie the shell document planted, and it reaches the studio's
   * segregated canvas listener rather than its main one.
   *
   * NOT read-only any more (RCA: cloud canvas writes never reached disk). The
   * canvas iframe's ONLY persistence path for the lanes it legitimately
   * co-authors — annotation strokes (`PUT /_api/annotations`), artboard layout
   * (`PATCH /_api/canvas-meta`), media drops (`POST /_api/asset`), comment
   * replies — is plain HTTP on this origin; the collab WS only mirrors what
   * the studio wrote to disk. A blanket 405 here meant every one of those
   * writes died at this door (silently — the client swallows the failure), so
   * cursors crossed while the actual edits never synced, and a reload showed
   * nothing. Writes now pass at the capability's OWN role claim under two
   * gates: the browser-facing Origin check below (the CSWSH gate's HTTP twin —
   * the capability cookie is ambient, and SameSite cannot express this
   * boundary because every tenant origin on the zone is same-site), and the
   * same one-table `decide()` authority the shell door runs, so a viewer's
   * capability still writes nothing but the comment lane. What stays
   * canvas-reachable at all is bounded by the studio's own canvas-origin
   * allowlist (DDR-088 inert collab surface — no source, no export, no config).
   */
  async function handleCanvas({
    request,
    response,
    pathname,
    method,
    verifyToken,
    /** The path prefix THIS deployment's canvas origin carries, from
     *  `canvasOriginFor()` — `/alligators` on the fleet's shared
     *  `canvas.<zone>` hostname, and `''` when the tenant has an origin of its
     *  own. Passed in rather than derived from MAUDE_TENANT_ID: the tenant id
     *  exists in BOTH shapes, so assuming it meant a path prefix made every
     *  canvas request 404 on a per-tenant origin. The prefix belongs to the
     *  ORIGIN, so it comes from whatever decided the origin. */
    pathPrefix = '',
  }) {
    const unsafeMethod = method !== 'GET' && method !== 'HEAD';
    const url = new URL(request.url, 'http://cell.invalid');
    // Strip the prefix before forwarding — the studio serves one project and
    // knows nothing about tenants.
    let rest = pathname;
    if (pathPrefix) {
      if (rest === pathPrefix || rest.startsWith(`${pathPrefix}/`)) {
        rest = rest.slice(pathPrefix.length) || '/';
      } else {
        refuse(response, 404, { error: 'not found' });
        return true;
      }
    }
    // The VENDOR runtime bundles need no capability.
    //
    // They are our own React/motion builds, byte-identical for every tenant, and
    // they are named in a STATIC `<script type="importmap">` that has to be in
    // the document before any module loads — so there is no moment at which the
    // shell could append a token to them. Requiring one would mean rewriting the
    // importmap server-side and re-deriving the CSP script hashes over it, to
    // protect bytes that reveal nothing about anybody's project.
    //
    // Everything tenant-specific — the shell, the built module, the design
    // system's CSS, every asset — still requires the capability below.
    // The vendor bypass is for STATIC READS only — an unsafe method never gets
    // a free pass, whatever path it names.
    const isVendorRuntime = !unsafeMethod && rest.startsWith('/_canvas-runtime/');
    // The capability, from the URL the shell wrote or — for the URLs the shell
    // did NOT write, which is every asset the tenant's own canvas references —
    // from the host-scoped cookie the shell document planted. See
    // CANVAS_CAPABILITY_COOKIE for why the second one exists.
    const urlToken = url.searchParams.get('t');
    // ---- CROSS-SITE REQUEST FORGERY, the cookie lane's HTTP half -----------
    //
    // The mirror of handleCanvasUpgrade's CSWSH gate, for the same reason: the
    // capability cookie rides ambiently, and "site" is the registrable domain,
    // so script on ANY origin of the zone — another tenant's shell, the
    // marketing site — could fire a state-changing fetch at this door with the
    // victim's cookie attached. Two legitimate writers: the canvas origin
    // itself (the iframe's own fetches) and the project's shell. A missing
    // Origin is a non-browser client, which must then present an explicit
    // `?t=` — a URL token is proof of intent in a way an ambient cookie never
    // is. Reads stay ungated: images and module loads carry no Origin and
    // change nothing.
    if (unsafeMethod) {
      const origin = request.headers?.origin ?? null;
      if (origin) {
        const allowed = [
          env.MAUDE_PUBLIC_CANVAS_ORIGIN,
          publicUrl,
          // A cell may have MORE than one legit shell name (the local rig's
          // same-site `studio.cell.localhost` beside 127.0.0.1) — same list
          // the studio's frame-ancestors accepts.
          ...String(env.MAUDE_EXTRA_SHELL_ORIGINS ?? '').split(/[\s,]+/),
        ]
          .filter(Boolean)
          .map(originOf);
        if (!allowed.includes(originOf(origin))) {
          refuse(response, 403, { error: 'cross-origin canvas write refused' });
          return true;
        }
      }
      // DDR-242 — A WRITE NEEDS THE EXPLICIT CAPABILITY, from every client.
      // The cookie is one per canvas origin, so inside an embed (a frame on
      // another app, same site) it can hold ANOTHER tab's full capability —
      // canvas code there would write with it by simply omitting `?t=`. The
      // shell document appends this frame's own capability to every write it
      // makes (templates/_shell.html), so the cookie is left to what it was
      // invented for: the asset GETs no code of ours builds.
      if (!urlToken) {
        refuse(response, 401, { error: 'a canvas write requires an explicit capability' });
        return true;
      }
    }
    const verdict = isVendorRuntime ? { ok: true } : (verifyToken(urlToken) ?? { ok: false });
    // Reads only (see above). The full cookie first, then the embed's own
    // read-only one — which exists so an embed never overwrites the other.
    const cookieVerdict =
      !isVendorRuntime && !unsafeMethod && !verdict?.ok
        ? ([CANVAS_CAPABILITY_COOKIE, EMBED_CAPABILITY_COOKIE]
            .map((name) => verifyToken(cookieFrom(request, name)))
            .find((v) => v?.ok) ?? null)
        : null;
    if (!verdict?.ok && !cookieVerdict?.ok) {
      refuse(response, 401, { error: 'this canvas link has expired — reload the project' });
      return true;
    }
    // The capability that actually authenticated this request, and the role it
    // vouches. Older tokens carry no claim — the floor is `viewer`.
    const auth = verdict?.ok ? verdict : cookieVerdict;
    const role = auth?.role ?? 'viewer';
    // DDR-242 — an embed's capability reads and nothing else. Checked before
    // the role table on purpose: a viewer may still comment, an embed may not.
    if (unsafeMethod && auth?.readOnly) {
      refuse(response, 403, {
        error: 'this embedded view is read-only',
        reason: 'read-only',
      });
      return true;
    }
    // ---- One table, one authority (Cloud Phase 25 C4) ----------------------
    //
    // The same `decide()` the shell door runs, at the role the capability
    // vouches — so a viewer's capability gets the same 403 sentence at both
    // doors, `/_api/export` stays refused at both, and a write path the
    // manifest never classified fails closed here before it reaches the
    // studio. The studio's own gates (readOnlyRefusal + the canvas-origin
    // allowlist) still run behind this; two enforcement points that share one
    // table cannot drift.
    if (unsafeMethod) {
      const writeVerdict = decide(method, rest, role);
      if (!writeVerdict.allow) {
        if (writeVerdict.reason === 'method') {
          refuse(response, 405, { error: 'method not allowed' });
          return true;
        }
        if (writeVerdict.reason === 'unclassified' || writeVerdict.reason === 'refused') {
          refuse(response, 404, { error: 'not found' });
          return true;
        }
        refuse(response, 403, {
          error: READ_ONLY_MESSAGE,
          reason: 'read-only',
          capability: writeVerdict.capability,
        });
        return true;
      }
    }
    // Plant it on the shell document, and only there. Every other response on
    // this origin is a subresource of a shell that already carries one, so a
    // Set-Cookie on any of them would be noise — and the narrower the surface
    // that mints an ambient credential, the easier it is to reason about.
    if (!isVendorRuntime && verdict?.ok && urlToken && isCanvasShellPath(rest)) {
      // DDR-242 — an embed's read-only capability goes into a cookie of its
      // own: planting it as `maude_canvas` would downgrade the designer's open
      // studio tab on the same canvas origin.
      response.setHeader('set-cookie', [
        canvasCapabilityCookie(
          urlToken,
          env,
          verdict.readOnly ? EMBED_CAPABILITY_COOKIE : CANVAS_CAPABILITY_COOKIE
        ),
      ]);
    }
    const up = canvasUpstream?.();
    if (!up?.ok || !up.port) {
      response.writeHead(503, { 'cache-control': 'no-store', 'retry-after': '2' });
      response.end();
      return true;
    }
    await forward({
      request,
      response,
      port: up.port,
      path: `${rest}${url.search}`,
      headers: upstreamHeaders(request.headers, {
        // The role the CAPABILITY vouches, not an unconditional viewer floor.
        // The canvas iframe's writes to its co-authored lanes (annotations,
        // artboard layout, media, comment replies) arrive on THIS lane, and the
        // studio's readOnlyRefusal gate reads the readonly header derived from
        // this role — a hard-coded `viewer` here is exactly how cloud canvas
        // edits died at 403 while cursors kept crossing. What such a role can
        // REACH is still bounded twice over: `decide()` above (one table) and
        // the studio's own canvas-origin allowlist (DDR-088 — no source
        // routes, no export, no config exist on this origin at any role).
        role,
        // The MEMBER, not null: the capability names its subject, and
        // `/_api/git-user` on the canvas listener is where collab presence gets
        // its display name. Without this every cloud peer is `anonymous-…` (the
        // attribution half of the live-collaboration RCA).
        user: auth?.subject ?? null,
        sessionKey: null,
        publicUrl: env.MAUDE_PUBLIC_CANVAS_ORIGIN ?? null,
      }),
    });
    // B3 parity with the shell door: an asset that landed THROUGH THIS DOOR
    // (the iframe's media drop arrives here, not at the shell) must reach
    // object storage too, or it survives only until the container restarts.
    if (
      method === 'POST' &&
      rest === '/_api/asset' &&
      response.statusCode >= 200 &&
      response.statusCode < 300
    ) {
      try {
        onAssetWritten?.();
      } catch {
        /* the upload succeeded; a mirror failure must not un-succeed it */
      }
    }
    return true;
  }

  /**
   * The CANVAS origin's live surfaces — Cloud collab lane
   * (RCA issue-cloud-live-collaboration-dead).
   *
   * The per-canvas collab room (`/_ws/collab/:slug` — cursors, presence,
   * annotations, comment live-sync) and the HMR reload socket (`/_ws`) are
   * opened from INSIDE the canvas iframe, i.e. on the cookieless canvas origin.
   * `handleUpgrade` cannot serve them: it authenticates by browser session
   * cookie, which this origin never carries — by design (DDR-054). So this lane
   * authenticates the same way the rest of the canvas origin does: with the
   * render capability, from the URL (`?t=`) or the host-scoped HttpOnly cookie
   * the shell document planted (`CANVAS_CAPABILITY_COOKIE` — a same-site WS
   * connect sends it automatically).
   *
   * The socket is opened at the member's REAL role (the token's `r` claim,
   * viewer floor when absent) — an owner drawing an annotation is the point of
   * the channel — while the DDR-122 realm gate ('canvas', injected below) keeps
   * body lanes unwritable whoever is connected. HTTP on this origin stays
   * viewer-floor read-only; the role claim changes nothing there.
   */
  function handleCanvasUpgrade({ request, socket, head, verifyToken, pathPrefix = '' }) {
    const url = new URL(request.url, 'http://cell.invalid');
    let rest = url.pathname;
    if (pathPrefix) {
      if (rest === pathPrefix || rest.startsWith(`${pathPrefix}/`)) {
        rest = rest.slice(pathPrefix.length) || '/';
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return true;
      }
    }
    // Only the studio's live surfaces are upgradable on this origin.
    if (!rest.startsWith('/_ws')) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    // ---- CROSS-SITE WEBSOCKET HIJACKING (found by an adversarial pass) -----
    //
    // A WS handshake is exempt from the same-origin policy and carries cookies
    // anyway, so the moment this lane accepts the ambient capability cookie it
    // stops being protected by an unguessable URL. `SameSite` does not save it:
    // "site" is the REGISTRABLE DOMAIN, so every tenant's origins, the control
    // plane and the marketing site are mutually same-site — script on any one
    // of them could open `wss://canvas-<victim>.<zone>/_ws/collab/<slug>`, ride
    // the victim's cookie, and read the room's whole Y.Doc (and write the
    // annotation/comment lanes at the victim's role). Frames are fully readable
    // cross-origin; slug guessing is cheap and silent.
    //
    // `apps/studio/ws.ts` already has this primitive (`isSameOriginWs`) and
    // applies it only to the ACP socket. This is its mirror for the lane the
    // capability cookie reaches.
    //
    // Two legitimate origins: the canvas origin itself, and the project's own
    // shell (the tab the iframe lives in). A missing Origin is a non-browser
    // client, which must then present an explicit `?t=` — a URL token is proof
    // of intent in a way an ambient cookie never is.
    const urlToken = url.searchParams.get('t');
    const origin = request.headers?.origin ?? null;
    if (origin) {
      const allowed = [env.MAUDE_PUBLIC_CANVAS_ORIGIN, publicUrl].filter(Boolean).map(originOf);
      if (!allowed.includes(originOf(origin))) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return true;
      }
    } else if (!urlToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    // DDR-242 — sockets carry writes (the collab lanes), so like an HTTP write
    // they open only on the explicit capability, never on the ambient cookie:
    // inside an embed the cookie may be another tab's full one. The shell
    // document appends this frame's capability to every socket it opens.
    if (!urlToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    const verdict = verifyToken(urlToken) ?? { ok: false };
    if (!verdict.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    // DDR-242 — the collab socket carries WRITES (a viewer's comments among
    // them); an embed's read-only capability gets none. The HMR socket
    // (`/_ws`) ignores inbound frames and stays open, so the embed still
    // follows edits to the source.
    if (verdict.readOnly && rest !== '/_ws') {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    const up = canvasUpstream?.();
    if (!up?.ok || !up.port) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    forwardUpgrade({
      request,
      socket,
      head,
      port: up.port,
      path: `${rest}${url.search}`,
      headers: upstreamHeaders(request.headers, {
        role: verdict.role ?? 'viewer',
        user: verdict.subject ?? null,
        sessionKey: null,
        publicUrl: env.MAUDE_PUBLIC_CANVAS_ORIGIN ?? null,
        collabRealm: 'canvas',
      }),
    });
    return true;
  }

  /**
   * The origins allowed to open a socket on the SHELL door.
   *
   * Exactly one: the project's own shell. NOT the canvas origin — that origin
   * exists to run the tenant's untrusted code (DDR-054), and this lane is the
   * privileged one.
   *
   * A deployment that declared its public identity (D4 — every cell does) is
   * held to it. One that did not — a cell booted by hand, the local data-plane
   * stand-in — falls back to the classic same-origin comparison against the
   * request's own `Host`, which is safe for the same reason the check works at
   * all: a browser sets `Host` from the URL it is connecting to, so an
   * attacker's page can never make the two agree.
   */
  function isOwnShellOrigin(request) {
    // Hosts, not full origins: TLS terminates at the tunnel, so the browser's
    // `https://` Origin reaches a hub that is speaking plaintext to it.
    const from = hostOf(request?.headers?.origin ?? '');
    if (!from) return false; // absent, or the opaque `null` of a sandboxed frame
    const allowed = publicUrl ? hostOf(publicUrl) : (request?.headers?.host ?? null);
    return Boolean(allowed) && from === allowed;
  }

  /**
   * WebSocket upgrades.
   *
   * The studio's live surfaces — the inspector feed and the per-canvas collab
   * rooms — are WebSockets, so a proxy that only speaks HTTP delivers a studio
   * whose panels never update. Same gate: session first, manifest second.
   */
  function handleUpgrade({ request, socket, head, session }) {
    if (!session?.role) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    // ---- CROSS-SITE WEBSOCKET HIJACKING, on the lane that matters most -----
    //
    // The twin of the canvas lane's gate above, and the WORSE of the two: this
    // socket is upgraded at `realm: 'main'`, which the DDR-122 origin gate
    // leaves ungated, so it reaches the body lanes — a canvas's source, its
    // CSS, its meta — at the member's real role.
    //
    // The credential here is the browser SESSION cookie, and `SameSite=Lax`
    // does not express the boundary: "site" is the registrable domain, so
    // every tenant's shell, every tenant's canvas origin, the control plane
    // and the marketing site are mutually same-site. Script anywhere on
    // `*.<zone>` — a stored SVG on a canvas origin is the cheap way to get it
    // — could open `wss://<victim-shell>/_ws/collab/<slug>` and have the
    // victim's cookie ride along. WS handshakes are exempt from the
    // same-origin policy, and the frames are fully readable to the opener.
    //
    // Unlike the canvas lane there is no `?t=` here, so a missing Origin has
    // no way to prove intent and is simply refused. Browsers always send it.
    if (!isOwnShellOrigin(request)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    const up = upstream();
    if (!up?.ok) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return true;
    }
    forwardUpgrade({
      request,
      socket,
      head,
      port: up.port,
      headers: upstreamHeaders(request.headers, {
        role: session.role,
        user: session.email,
        sessionKey: session.sessionKey,
        publicUrl,
      }),
    });
    return true;
  }

  return { handle, handleCanvas, handleUpgrade, handleCanvasUpgrade };
}

/** Straight byte pipe to loopback. Streams both ways — the asset lane moves
 *  100 MB clips and buffering them here would put a tenant's video in the
 *  proxy's heap. */
function defaultForward({ request, response, port, path, headers }) {
  return new Promise((resolve) => {
    const upstreamReq = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: request.method,
        path: path ?? request.url,
        headers,
      },
      (upstreamRes) => {
        response.writeHead(
          upstreamRes.statusCode ?? 502,
          filterResponseHeaders(upstreamRes.headers)
        );
        upstreamRes.pipe(response);
        upstreamRes.on('end', resolve);
        upstreamRes.on('error', () => {
          response.destroy();
          resolve();
        });
      }
    );
    upstreamReq.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'the project server is not answering' }));
      } else {
        response.destroy();
      }
      resolve();
    });
    request.pipe(upstreamReq);
    request.on('error', () => {
      upstreamReq.destroy();
      resolve();
    });
  });
}

function filterResponseHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/** Raw socket splice for the WS handshake. `path` overrides `request.url`
 *  (the canvas lane strips its tenant prefix before forwarding). */
function defaultForwardUpgrade({ request, socket, head, port, path, headers }) {
  const upstreamSocket = netConnect(port, '127.0.0.1', () => {
    const lines = [`GET ${path ?? request.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    // Re-add the hop-by-hop headers the handshake IS.
    lines.push('Connection: Upgrade');
    lines.push(`Upgrade: ${request.headers.upgrade ?? 'websocket'}`);
    upstreamSocket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });
  upstreamSocket.on('error', () => socket.destroy());
  socket.on('error', () => upstreamSocket.destroy());
}
