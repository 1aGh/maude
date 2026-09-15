import { validAnnotationWriteId } from './annotations-sync.ts';
// HTTP layer for Bun.serve.
//
// Designed for extension — Phase 3.6 adds /ui/:slug + /_bun_hmr by appending to
// the route table without rewriting this module. The `fetch` export is the
// top-level fall-through for paths Bun's `routes` field doesn't cover.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, unlinkSync, watch } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
// Ownership mutations live with the CLI on purpose — see /_api/sync/ownership.
import { adoptToHub, detachToRepo, ownershipState } from '../../cli/lib/design-ownership.mjs';
import {
  cancelSignin,
  getClaudeAuthStatus,
  getInstallState,
  isSigninInFlight,
  startInstall,
  startSignin,
} from './acp/login-state.ts';
import { probeAcpAvailabilityAuthed } from './acp/probe.ts';
import { activitySnapshot, runningChats } from './acp/running.ts';
import {
  chatTranscriptSeq,
  deleteChat,
  listChats,
  readChatMessages,
  writeChatMeta,
} from './acp/transcript.ts';
import { type Api, ASSET_MAX_BYTES, ASSET_MAX_VIDEO_BYTES } from './api.ts';
import { ImportAssetError, importSvg, SVG_MAX_BYTES } from './bin/_import-asset.mjs';
import { ImportBrandError, importBrand } from './bin/_import-brand.mjs';
import { buildCanvasModule } from './canvas-build.ts';
import { buildCanvasSandboxed, buildStats } from './canvas-build-sandbox.ts';
import { canvasLibPath } from './canvas-lib-resolver.ts';
import { TranspileError } from './canvas-pipeline.ts';
import { createCloudEndpoints } from './cloud/endpoints.ts';
import type { AiActivity } from './collab/ai-activity.ts';
import type { Context } from './context.ts';
import { reloadConfig } from './context.ts';
import { buildDebugBundle } from './debug-bundle.ts';
import { probeSetupReadiness } from './design-setup-readiness.ts';
import { isScopeValidForFormat, scopeRefusalMessage } from './exporters/format-scopes.ts';
import { type Format, isFormat, isScope, type Scope } from './exporters/index.ts';
import { type ExportJobQueue, ExportQueueFullError } from './exporters/jobs.ts';
import type { ActiveJsonShape } from './exporters/scope.ts';
import { createFigmaEndpoints } from './figma/endpoints.ts';
import { generatedClipAnalysis } from './footage/schema.ts';
import { createFootageStore, FOOTAGE_MAX_BYTES } from './footage-store.ts';
import {
  type AudioMatch,
  type Candidate,
  rankMatches,
  sanitizeReuseText,
} from './generation/audio-library.ts';
import { localizeGenAsset } from './generation/download.ts';
import {
  downloadGemmaModel,
  ffmpegAvailable,
  getOllamaModel,
  listGemmaModels,
  listScoutModels,
  mlxSetup,
  mlxVlmAvailable,
  OLLAMA_RECOMMENDED_MODEL,
  ollamaSetupOptions,
  ollamaStatus,
  pullOllamaModel,
} from './generation/gemma-models.ts';
import { type GenerationJobQueue, GenerationQueueFullError } from './generation/jobs.ts';
import {
  configuredProviders,
  deleteProviderKey,
  getProviderKey,
  isConfigured,
  setProviderKey,
} from './generation/keys.ts';
import {
  isKeyframeEngine,
  isTranscriptionProvider,
  readKeyframeEngine,
  readTranscriptionProvider,
  writeKeyframeEngine,
  writeTranscriptionProvider,
} from './generation/prefs.ts';
import {
  createAdapter,
  getProviderDescriptor,
  hasProvider,
  listProviders,
} from './generation/registry.ts';
import { validateGenRequest } from './generation/types.ts';
import {
  downloadWhisperModel,
  getWhisperModel,
  listWhisperModels,
  removeWhisperModel,
  resolveAutoEngine,
  whisperSetup,
} from './generation/whisper-models.ts';
import { createGitEndpoints } from './git/endpoints.ts';
import { gitShowFile } from './git/service.ts';
import { createGitHubEndpoints } from './github/endpoints.ts';
import type { InspectRegistry } from './inspect.ts';
import { canvasSlug, writeLocator } from './locator.ts';
import { BIN_DIR, DEV_SERVER_ROOT, MEDIA_DIR, STICKERS_DIR } from './paths.ts';
import { createPhotoStore, PHOTO_EDIT_MAX_BYTES } from './photo-store.ts';
import { probeReadiness } from './readiness.ts';
import { getRuntimeBundle, packageForSlug } from './runtime-bundle.ts';
import { currentSession } from './session-scope.ts';
import { sanitizeForLog } from './sync/cell-pairing.ts';
import { linkHub } from './sync/hub-link.ts';
import { isHubReadOnly } from './sync/hubs-config.ts';
import { isFirstAnchorMode, readSyncSettings, writeSyncSettings } from './sync/settings.ts';
import { listTrash, pruneTrash, restoreFromTrash } from './sync/trash.ts';
import { prepareManagedProject } from './managed-projects.ts';
import { signInToWorkspace, workspaceDisclosure } from './sync/workspace-signin.ts';
import { readUiPrefs, type UiPrefs, writeUiPrefs } from './ui-prefs.ts';
import { loadWhatsNew, resolveMaudeVersion } from './whats-new.ts';
import { isWorkspaceMode, resolveRenderLane } from './workspace-mode.ts';
import { isLoopbackHost } from './ws.ts';

// Real disk install root — never the virtual `/$bunfs/root` of compiled bins.
// See paths.ts for the resolution logic + Phase 19.1 / v0.18.1 rationale.
const HERE = DEV_SERVER_ROOT;

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  // DDR-148 — video/audio media referenced by a video-comp `<Video>`/`<Audio>`.
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

function ext(p: string): string {
  const i = p.lastIndexOf('.');
  return i === -1 ? '' : p.slice(i).toLowerCase();
}

/**
 * T2 (9.1-A) — build the strict CSP for the canvas-content shell. Every inline
 * `<script>` (importmap, module bootstrap, inspector) is allowlisted by sha256
 * hash so we never resort to `'unsafe-inline'`. `connect-src 'self'` is locked
 * to the document's own origin so hub-pushed JSX can't beacon out / hit IMDS /
 * LAN — and `'self'` covers same-origin `ws:`/`wss:` (CSP3), so the HMR + collab
 * sockets (which connect to the canvas origin the iframe loads from) still work
 * while `ws://attacker` / `wss://attacker` exfil is refused. `style-src
 * 'unsafe-inline'` is intentional —
 * specimens use `style={{…}}` attributes + injected `<style>`; style injection
 * is not the F1 RCE vector (script + connect are). No `'unsafe-eval'` — the
 * POC verifies the runtime (motion/pixi/Bun.build output) doesn't need it.
 *
 * `webrtc 'block'` (A6, DDR-060 F1 re-audit) — `connect-src` governs only
 * fetch/XHR/WebSocket/sendBeacon; WebRTC does NOT flow through Fetch, so an
 * `RTCPeerConnection` with an attacker STUN/TURN hostname smuggles bytes out via
 * ICE DNS/STUN even under `connect-src 'self'`. ⚠️ This directive is specified
 * (CSP3) but UNIMPLEMENTED in shipping Chrome/Firefox as of 2026 (Chromium
 * #40188662, Firefox bug 1783489) — currently a NO-OP. The enforceable control
 * today is the RTC-constructor lockout in `templates/_shell.html`; this directive
 * is kept for when browsers honor it. WebRTC + self-navigation exfil remain
 * DOCUMENTED residuals of opt-in linked mode (the reachable data is collab
 * metadata, not repo files — traversal is closed). Do NOT treat this as a closed
 * exfil lane. The canvas runtime itself uses zero WebRTC.
 *
 * `frame-ancestors` (A6) — restricts who may embed the canvas document. The
 * legit embedder is the main dev-server origin, so we allowlist exactly that
 * (`mainOrigin` — a space-separated source list; server.ts advertises both
 * loopback spellings, `localhost` + `127.0.0.1`) plus `'self'`; an arbitrary
 * external page can no longer reframe the canvas. When `mainOrigin` is unknown
 * (tests / pre-boot) the directive is OMITTED rather than set to `'self'` —
 * `'self'` alone would forbid the legit cross-origin embed and blank the canvas.
 *
 * `connect-src` narrow exception (fix-photo-editor-followup-debt, Task 7):
 * `@imgly/background-removal`'s model weights (~11-44 MB) fetch from IMG.LY's
 * own CDN, `https://staticimgly.com`, on first client-side use — there is no
 * self-hosting mechanism today (a separate, larger follow-up; see DDR-054's
 * dated addendum for this decision, and `.ai/state/STATE.md` for tracking).
 * The inference itself stays 100% client-side (pixels never leave the
 * browser) — only the weight DOWNLOAD needs this one extra origin. This is
 * the ONLY documented exception to the `connect-src 'self'` invariant above —
 * do not read it as precedent for adding further hosts without the same
 * scrutiny (exact hostname, no wildcard subdomain, a DDR record).
 */
/**
 * A stable, non-revealing name for the tree this process is serving.
 *
 * `realpath` first, so a bind-mount and a symlink to the same checkout are the
 * same identity rather than two — the supervisor computes it from its own
 * configured path and the two must agree. Falls back to the path as given when
 * it cannot be resolved: an unresolvable root is a difference worth reporting,
 * not one worth hiding behind a throw.
 */
export function rootIdentity(root: string): string {
  let resolved = root;
  try {
    resolved = realpathSync(root);
  } catch {
    /* not on disk (yet) — hash what we were told */
  }
  return createHash('sha256').update(resolved, 'utf8').digest('hex').slice(0, 12);
}

export function cspForCanvasShell(html: string, mainOrigin?: string): string {
  const hashes: string[] = [];
  // Match inline <script> blocks only (no src=). `[^>]*` excludes any with src.
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop.
  while ((m = re.exec(html)) !== null) {
    const body = m[1] ?? '';
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.push(`'sha256-${digest}'`);
  }
  const scriptSrc = ["'self'", ...hashes].join(' ');
  const directives = [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "connect-src 'self' https://staticimgly.com",
    "img-src 'self' data: blob:",
    // DDR-148 — a video-comp's <Video>/<Audio> loads media from the canvas
    // origin's own designRoot (assets/). Same inert-bytes trust as img-src
    // 'self'; without it default-src 'none' blocks all media (black video, no
    // sound). `blob:` covers Remotion's processed-media URLs.
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "frame-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "webrtc 'block'",
  ];
  if (mainOrigin) directives.push(`frame-ancestors 'self' ${mainOrigin}`);
  return directives.join('; ');
}

/**
 * CSP for the EXPORT/CAPTURE render (DDR-148 security, attacker F1). The export
 * renders the (untrusted, DDR-054) canvas on the MAIN origin — where the normal
 * shell CSP is env-gated off — and the capture shim ACTIVELY primes+seeks every
 * `<video>`, so a canvas with `<Video src="http://169.254.169.254/…">` or comp
 * JS doing `fetch(internal)` would turn ⌘E into read-SSRF + exfil-via-artifact.
 *
 * The comp is arbitrary JS by design and the in-page encoder is injected via
 * `addScriptTag`, so restricting SCRIPT execution is neither possible nor the
 * threat — the threat is NETWORK EGRESS. This CSP therefore locks every network
 * sink to `'self'` (media/img/connect/font, no frames/objects/form posts) while
 * leaving script permissive. Legit designRoot media is same-origin → still
 * loads; every off-origin fetch/media/beacon is refused.
 */
export function cspForCapture(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "webrtc 'block'",
  ].join('; ');
}

/**
 * CSRF guard for the main-origin source-write routes (edit-css / edit-text /
 * edit-attr / reorder). Those routes are reachable only from the shell, which is
 * same-origin — but `readJson` enforces no `Content-Type`, so a cross-site page
 * could otherwise forge a `text/plain` CORS *simple-request* POST to
 * `http://localhost:<port>/_api/edit-*` (no preflight) and drive a write into
 * the user's source `.tsx`. The browser stamps every cross-origin POST with an
 * unspoofable `Origin` header, so we reject any request whose Origin is PRESENT
 * and ≠ the server's own origin. A request with NO Origin (bun:test, curl,
 * non-browser programmatic clients — none of which are the CSRF threat, which
 * requires a browser executing attacker markup that always sends Origin on a
 * cross-origin POST) is allowed through. This is layered on top of the DDR-054
 * origin-split (which blocks the untrusted canvas *iframe*); it closes the
 * *other* untrusted origin — a malicious top-level page in another tab.
 * Deliberately NOT applied to `/_api/asset` (that route is canvas-origin
 * reachable by design — drag-drop/paste upload runs inside the iframe). See
 * DDR-105. Exported for unit testing (the decision is a pure function of `req`).
 */
export function sameOriginWrite(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser / same-origin omitting Origin → allow
  try {
    // HOSTS, not full origins — the same reason isOwnShellOrigin (studio-proxy)
    // compares host-only for the collab WS upgrade. In a cell, TLS terminates at
    // the proxy, so the browser's `https://<host>` Origin reaches a studio that
    // serves plaintext and computes `req.url` as `http://<host>`; a full-origin
    // compare then rejects every legitimate shell write on the SCHEME alone
    // (403 "cross-origin write rejected" — the second half of the inspector-edits
    // RCA, found when the loopback fix uncovered it). Host+port still pins the
    // origin: the port rides in `host`, and scheme was never the CSRF
    // discriminator here — locally everything is http, and a real cross-site page
    // has a different host.
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/**
 * The DNS-rebind guard, mode-aware — Cloud Phase 27, the inspector-edits RCA
 * (`issue-cloud-inspector-edits-refused-by-loopback-guard`).
 *
 * `isLoopbackHost(req.headers.get('host'))` is right on a laptop: a malicious
 * page that resolves `evil.com` → 127.0.0.1 makes the browser send a FOREIGN
 * Host to the locally-bound dev server, and the guard rejects it. In a CELL that
 * same check can NEVER pass — the hub's authenticating proxy rewrites Host to the
 * project's public name (D4, `upstreamHeaders`) on purpose — so every shell edit
 * (Inspector CSS, artboard ops, insert/delete/reorder, edit-attr/text) 403'd
 * with "local request required (DNS-rebinding guard)". Annotations and comments
 * were spared only because their handlers carry no such guard; that split of
 * which routes worked was exactly the fingerprint of this bug.
 *
 * The cell doesn't NEED the Host check: the proxy already terminated the session,
 * authorized it against the one role table (studio-manifest's `decide()`), and
 * injects `x-maude-role` after stripping every inbound `x-maude-*` — so the
 * header's PRESENCE is unforgeable proof the request came through the hub. Same
 * `WORKSPACE ? x-maude-role` vouch the collab-WS upgrade already trusts
 * (server.ts, RCA issue-cloud-live-collaboration-dead). Outside workspace mode
 * this is the loopback check, verbatim.
 *
 * Safe against secret leakage by construction: a cell PRUNES every secret-bearing
 * route family out of its table (`pruneForWorkspace` + the boot-assert), so the
 * vouched path can only ever reach the project-editing surfaces that survive.
 */
export function isTrustedRequestHost(req: Request): boolean {
  if (isLoopbackHost(req.headers.get('host'))) return true;
  return isWorkspaceMode() && !!req.headers.get('x-maude-role');
}

/**
 * CSRF guard for a key-bearing / side-effecting GET (Task 2.5 audio-search —
 * ethical-hacker F1). A cross-site page can issue a `no-cors` GET to
 * `127.0.0.1:<port>` that passes the `isLoopbackHost` DNS-rebind guard AND may
 * omit `Origin` (browsers don't reliably stamp Origin on a simple cross-origin
 * GET), so `sameOriginWrite` alone can't fend it off. Browsers DO always send
 * the Fetch-Metadata `Sec-Fetch-Site` header, and non-browser clients (the CLI,
 * curl, bun:test) never do — so reject any request whose `Sec-Fetch-Site` is
 * present and is not `same-origin`/`none`. A missing header (CLI) is allowed.
 * Prevents a cross-site page from driving the user's key-bearing provider
 * fan-out + disk scan as a confused deputy.
 */
export function sameOriginRead(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (!site) return true; // non-browser client (CLI / curl) → allow
  return site === 'same-origin' || site === 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Phase 25 C2 — the local half of the read-only gate.
//
// When the project is linked to a hub that vouched a `viewer` role at sign-in
// (isHubReadOnly), the LOCAL dev-server refuses project-mutating writes too.
// The cell is the authority (Phase 25 C1 — it refuses whatever a patched
// client sends); this gate exists so a viewer's local clone never DIVERGES
// from the hub: a local write the cell would refuse to sync is a silent fork,
// which is worse than a refusal. Mirrors C1's posture — writes are
// default-denied with a short, explicit allowlist.
//
// What a read-only session may still write (per-user runtime state per
// DDR-115, plus the two role-granted verbs the cell itself allows —
// export ≈ `/api/export`, session management ≈ `/auth/logout`):
const READ_ONLY_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const READ_ONLY_ALLOWED_WRITES = new Set([
  '/_hmr', // build-watch rebuild hint — dev plumbing, not project state
  '/_canvas-state', // per-user camera / view state (DDR-115: never versioned)
  '/_api/canvas-meta', // viewport lane only — the layout lane is refused in-handler
  '/_api/ui-prefs', // per-user UI preferences
  '/_api/timeline-media', // per-user runtime media cache (scrub read path)
  '/_api/export', // "look, comment and download" — the cell allows /api/export too
  '/_api/export-jobs',
  '/_api/export-jobs/download',
  // DDR-231 Phase 2 T6 — the browser lane's ledger row. A viewer may already
  // EXPORT (the two entries above), so recording that they did is the same
  // class of write: it touches no project state, only the recent-exports list.
  // Refusing it here while allowing the export produced exactly the reported
  // symptom for viewers — a file downloads and nothing anywhere says so.
  '/_api/export-history',
  // …and the deck's composition half. The member's own browser captured the
  // PNGs; this route only packs bytes they already hold into a .pptx and hands
  // it back — it writes no project state. Missing from this list, a VIEWER's
  // PPTX export captured every artboard and then died on a 403 with the dialog
  // still saying "Capturing 10/10" (found by the T7 export E2E, which runs
  // unauthenticated and therefore as a viewer).
  '/_api/export-assemble',
  '/_api/report', // bug reports are about Maude, not the project
  '/_api/report-fallback',
  // Cloud Phase 27 — COMMENT IS THE ONE WRITE A VIEWER HOLDS. The role matrix
  // has said so since Phase 25 C4 (`viewer.comment === true`), the People page
  // promises it in those words, and the cell's proxy allows it — but this list
  // did not, so a viewer's comment was accepted by the authority and then
  // refused by the defence-in-depth layer behind it. Found by commenting as a
  // viewer against a real cell. A second gate that is STRICTER than the first is
  // still a gate that is wrong.
  '/_comments',
  '/_api/hub/link', // link/unlink ≈ session management (cell allows /auth/logout)
  '/_api/cloud/detach', // unlink — the same session-management class as hub/link
  '/_api/workspace/sign-in', // signing in is how the role is (re)learned
  '/_api/workspace/disclosure',
  '/_api/cloud/signin/start', // account session, not project state
  '/_api/cloud/signin/poll',
  '/_api/cloud/signout',
  // Fetch moves remote-tracking refs and nothing else — no working tree, no
  // index. It stays a read.
  '/_api/git/fetch',
  // `pull` and `checkout` USED TO BE HERE, on the reasoning that "viewing
  // another branch is not changing one". Cloud Phase 27 D2 retired that: both
  // rewrite the working tree, and the tree is SHARED — in a cell by every
  // member, and on a hub-linked desktop by whoever else has that project open.
  // A viewer switching branches replaces the files under someone mid-edit.
  //
  // The proxy's manifest already refuses them, but this gate is the one the
  // hub-linked desktop and self-host path consult (`isHubReadOnly`), where no
  // manifest runs at all — so leaving them here would have left the hole open
  // exactly where the proxy cannot reach. Two gates, and neither is trusted to
  // be the last word.
]);

/**
 * Write paths a read-only session may use whose members are GENERATED rather
 * than declared, so an exact-match set cannot name them.
 *
 * Deliberately one entry. Every regex here is a hole nobody can see by reading
 * the list above, so the bar for adding one is that an exact path genuinely
 * cannot express it.
 */
export const READ_ONLY_ALLOWED_WRITE_PATTERNS: RegExp[] = [
  /^\/_api\/comments\/[A-Za-z0-9_-]+\/reply$/,
];

/** The refusal a read-only session gets for a project-mutating write. */
export function readOnlyRefusalResponse(): Response {
  return Response.json(
    {
      error: 'read-only',
      reason: 'read-only',
      message: 'Your role in this project is viewer — editing is disabled.',
    },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}

function safePathUnderRoot(reqUrl: string, repoRoot: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(reqUrl, 'http://x').pathname);
  } catch {
    return null;
  }
  const sep = '/';
  const normalized = posix.normalize(posix.join(repoRoot, pathname));
  if (normalized !== repoRoot && !normalized.startsWith(repoRoot + sep)) return null;
  return normalized;
}

// `dist/` lives next to server.ts when running source-mode (bun run server.ts)
// and inside the standalone binary's embedded FS in --compile mode.
const DIST_DIR = join(HERE, 'dist');
const CLIENT_DIR = join(HERE, 'client');
// Templates stayed under the design *plugin* (plugins/design/templates) when the
// dev-server moved to apps/studio (DDR-095) — both ship in the npm tarball, so
// from DEV_SERVER_ROOT (apps/studio) reach across with ../../plugins/design.
const TEMPLATES_DIR = join(HERE, '..', '..', 'plugins', 'design', 'templates');

// In-memory transpile cache. Key = absolute canvas path. Repeat GETs against an
// unchanged source skip the parse + ID-injection + Bun.Transpiler + Bun.build
// entirely.
interface CanvasCacheEntry {
  /** Freshness signature over the .tsx AND every directly-imported sibling/
   *  relative `.css` it inlines (Bun.build extracts `import "./x.css"` into a
   *  `<style>` tag — there is no `<link>`). Rebuild when ANY of them changes.
   *  A prior version keyed only on the .tsx mtime, so editing a sibling
   *  `<canvas>.css` was a cache HIT: the HMR reload (mode:'module') re-served the
   *  stale inlined CSS and the edit only showed once the .tsx itself changed.
   *  (DDR-064 collab dogfooding finding, 2026-05-29.) */
  sig: string;
  etag: string;
  js: string;
  /** Absolute paths of the relative imports inlined into this build (`.css` +
   *  local `.tsx/.ts` modules, incl. unresolved extensionless candidates) —
   *  re-statted each request to recompute `sig` without re-reading the source. */
  deps: string[];
}
const canvasCache = new Map<string, CanvasCacheEntry>();

// Per-process boot id, folded into every canvas ETag. The canvas transpile
// BUNDLES the shared chrome (canvas-lib → tool-palette / annotations-layer /
// use-tool-mode / canvas-cursors / …), but the freshness sig + base etag only
// track the canvas file + its inlined CSS — NOT those chrome sources. So a
// chrome edit left the etag unchanged → the browser's `If-None-Match` matched →
// 304 → the user kept getting the STALE transpile even after a server restart
// (the recurring "my cursor / chrome change didn't show up" bug). Folding the
// boot id in means a restart — the expected workflow after a dev-server source
// edit (see CLAUDE.md) — changes every canvas etag, so a normal reload re-fetches
// fresh chrome. (DDR-067.)
/** When this server process started — anything it wrote is stamped after it. */
const PROCESS_STARTED_AT = Date.now();
const RUNTIME_BOOT_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// Bumped by the chrome source watchers (below) on every canvas-lib / dev-server
// `.tsx`/`.ts` edit. Folded into the canvas ETag so a LIVE chrome edit (no
// restart) also changes the etag — otherwise clearing `canvasCache` re-transpiles
// fresh on the server, but the unchanged canvas SOURCE yields the same
// `result.etag`, the browser's `If-None-Match` matches → 304 → the user still
// gets the stale bundle even after the HMR hard-reload. (DDR-067.)
let CHROME_EPOCH = 0;

/** Relative import specifiers in a canvas source → absolute paths (the files
 *  Bun.build inlines): sibling `.css`, and — RC6 of
 *  rca/issue-canvas-hmr-optimistic-update-consistency — imported local
 *  `.tsx/.ts/.jsx/.js` modules, which are inlined exactly like CSS (only
 *  RUNTIME_PACKAGES stay external, canvas-build.ts), so an edit to an imported
 *  sibling must bust the mtime-keyed cache the same way. Extensionless
 *  specifiers contribute EVERY resolution candidate (`.tsx`, `.ts`, …,
 *  `index.tsx`); missing candidates stat as 0, so a dep file APPEARING later
 *  also changes the signature. One level only — no transitive graph (the
 *  import-graph HMR re-emit is a tracked follow-up). Bare / virtual specifiers
 *  (`@maude/…`, npm) are skipped. Resolved paths are clamped to `designRoot`:
 *  a canvas source is attacker-influenced under linked mode (DDR-054), and
 *  these paths are `stat`-ed for mtime, so a `../../../etc/…` specifier must
 *  not let the freshness probe reach outside the design tree. Legit DS imports
 *  (`../../system/<ds>/…`) stay inside designRoot. */
export function localDepsFromSource(
  source: string,
  canvasAbsPath: string,
  designRoot: string
): string[] {
  const dir = dirname(canvasAbsPath);
  const root = resolve(designRoot);
  const deps: string[] = [];
  const seen = new Set<string>();
  const push = (abs: string) => {
    if (abs !== root && !abs.startsWith(root + sep)) return; // clamp (DDR-054)
    if (seen.has(abs)) return;
    seen.add(abs);
    deps.push(abs);
  };
  const specRes = [
    /\bimport\s+["']([^"']+)["']/g, // side-effect: import './x.css'
    /\bfrom\s+["']([^"']+)["']/g, // import … from / export … from
    /\bimport\(\s*["']([^"']+)["']\s*\)/g, // dynamic import('./x')
  ];
  for (const re of specRes) {
    for (let m = re.exec(source); m !== null; m = re.exec(source)) {
      const spec = m[1];
      if (!spec?.startsWith('.')) continue;
      const base = resolve(dir, spec);
      if (/\.(css|tsx|ts|jsx|js)$/i.test(spec)) {
        push(base);
      } else {
        for (const cand of [
          `${base}.tsx`,
          `${base}.ts`,
          `${base}.jsx`,
          `${base}.js`,
          resolve(base, 'index.tsx'),
          resolve(base, 'index.ts'),
        ])
          push(cand);
      }
    }
  }
  return deps;
}

/** mtime signature over the .tsx + every inlined relative dep (`.css` + local
 *  modules). A missing/unreadable file contributes 0 — a delete is itself a
 *  change (and a later create too), so the signature differs. */
function canvasFreshnessSig(tsxAbsPath: string, deps: string[]): string {
  const parts: string[] = [];
  for (const p of [tsxAbsPath, ...deps]) {
    const mt = Bun.file(p).lastModified;
    parts.push(`${p}@${Number.isFinite(mt) ? mt : 0}`);
  }
  return parts.join('|');
}

async function serveCanvasTsx(
  absPath: string,
  req: Request,
  ctx: Context,
  locatorAbsPath: string
): Promise<Response> {
  // Phase 27 (E2) — DiffView "before" pane. `?sha=<ref>` builds the canvas from
  // its source AT a past version (git show) instead of the working-tree file, so
  // the rendered before/after is real. Isolated additive branch — the normal
  // (no-sha) serve below is byte-identical to before. The historical build still
  // resolves sibling imports against the CURRENT on-disk files (an accepted
  // approximation: the canvas code at the sha, with today's DS/lib).
  const shaParam = new URL(req.url).searchParams.get('sha');
  if (shaParam) return serveHistoricalCanvas(absPath, shaParam, req, ctx);

  const file = Bun.file(absPath);
  if (!(await file.exists())) return new Response('Not found', { status: 404 });

  // Freshness = the .tsx mtime AND every inlined sibling `.css` mtime. Keying on
  // the .tsx alone meant a direct edit to `<canvas>.css` was a cache HIT, so the
  // HMR reload (mode:'module') re-served the stale inlined CSS — the edit only
  // surfaced once the .tsx itself changed (DDR-064 dogfooding finding).
  let cached = canvasCache.get(absPath);
  const sig = canvasFreshnessSig(absPath, cached?.deps ?? []);

  if (!cached || cached.sig !== sig) {
    const source = await file.text();
    const deps = localDepsFromSource(source, absPath, ctx.paths.designRoot);
    let result: Awaited<ReturnType<typeof buildCanvasModule>>;
    // DDR-209 A′2 — SAME ENGINE, DIFFERENT HOST. On a desktop the process that
    // parses your canvas is the process you own, so an in-process build costs
    // nothing. In a cell it holds HUB_SECRET and the tenant's storage
    // credentials, and the source is written by somebody who is not us — so the
    // build goes out of process, with an empty environment, an import allowlist
    // and wall-clock + RSS ceilings (Cloud Phase 25 A1's contract, unchanged).
    // This branch is also what `sandboxArmed` in the containment boot-assert
    // attests: the cell may serve the canvas surfaces BECAUSE this exists.
    if (isWorkspaceMode()) {
      const built = await buildCanvasSandboxed({
        designRoot: ctx.paths.designRoot,
        canvasAbs: absPath,
      });
      if (!built.ok) {
        return new Response(`Canvas build error: ${built.error}`, {
          status: built.kind === 'build' ? 422 : 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      result = {
        js: built.js,
        locator: built.locator,
        etag: built.etag,
      } as Awaited<ReturnType<typeof buildCanvasModule>>;
      cached = {
        sig: canvasFreshnessSig(absPath, deps),
        etag: `${result.etag}-${RUNTIME_BOOT_ID}-${CHROME_EPOCH}`,
        js: result.js,
        deps,
      };
      canvasCache.set(absPath, cached);
      await writeLocator(locatorAbsPath, canvasSlug(absPath, ctx.paths.designRoot), result.locator);
      return respondWithCanvasModule(req, cached);
    }
    try {
      result = await buildCanvasModule(absPath, source, {
        designRoot: ctx.paths.designRoot,
        // UNCONDITIONAL, desktop included (feature-sync-file-plane, Task 9 —
        // the binding debate's CONDITION on the `code-module` class): a
        // canvas import resolves inside the design root on EVERY runtime, so
        // a synced module cannot make the build read the wider filesystem.
        // The cell worker has always armed this (canvas-build-worker.ts).
        restrictImportsTo: ctx.paths.designRoot,
      });
    } catch (err) {
      if (err instanceof TranspileError) {
        return new Response(`Transpile error: ${err.message}`, {
          status: 500,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Canvas build error: ${msg}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    // Recompute the signature against the freshly-parsed deps — this very edit
    // may have added or removed a `.css` import.
    cached = {
      sig: canvasFreshnessSig(absPath, deps),
      // Fold in the boot id (restart) + chrome epoch (live edit) so a chrome
      // change busts the browser's cached transpile even when the canvas source
      // (hence result.etag) is unchanged. See RUNTIME_BOOT_ID / CHROME_EPOCH.
      etag: `${result.etag}-${RUNTIME_BOOT_ID}-${CHROME_EPOCH}`,
      js: result.js,
      deps,
    };
    canvasCache.set(absPath, cached);
    // Persist the locator map. Awaited so the inspector / Phase-12 layers
    // panel sees a consistent (cdId -> source) view by the time the canvas
    // mounts. Per-path mutex inside writeLocator() makes concurrent transpiles
    // safe.
    await writeLocator(locatorAbsPath, canvasSlug(absPath, ctx.paths.designRoot), result.locator);
  }

  return respondWithCanvasModule(req, cached);
}

/** The conditional-GET half of serving a built canvas module. Shared by the
 *  in-process (desktop) and sandboxed (cell) build paths so the two cannot
 *  disagree about caching semantics. */
function respondWithCanvasModule(req: Request, cached: { js: string; etag: string }): Response {
  const ifNoneMatch = req.headers.get('if-none-match');
  if (ifNoneMatch === cached.etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: cached.etag, 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(cached.js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      ETag: cached.etag,
      'Cache-Control': 'no-cache',
    },
  });
}

// Phase 27 (E2) — build + serve a canvas at a past git ref. Immutable per
// (path, sha) — historical content never changes, so the cache lives for the
// process (folding the boot id + chrome epoch into the etag so a chrome change
// still busts the browser copy, since the build inlines today's chrome).
// LRU-capped so a flood of distinct ?sha values (each minting a permanent entry)
// can't grow the heap unbounded — the route is reachable from the UNTRUSTED
// canvas origin (it's on the canvas-serve path), so a hub-pushed canvas could
// otherwise OOM the sidecar (security review — ethical-hacker, Finding 1).
const historicalCanvasCache = new Map<string, { js: string; etag: string }>();
const HIST_MAX_CACHE = 96;
// Rate-limit the EXPENSIVE miss path (git show + Bun.build, or a non-resolving
// git lookup) so a distinct-sha spray from the canvas origin can't starve the
// event loop. Cache HITS are free; only a NEW (path,sha) build consumes budget.
// Legit use (DiffView opens ~1–2 historical iframes per compare) is far under.
//
// TWO LOAD-BEARING INVARIANTS (security re-review — do not "optimize" away):
//   1. The limiter is DELIBERATELY GLOBAL, not per-origin/per-key — the attacker
//      controls the canvas (hence any origin/key), so a keyed limiter is
//      trivially defeated. The cost (a legit user 429s during an active flood) is
//      accepted; it only bites under attack.
//   2. `historicalBuildAllowed()` MUST stay ABOVE `gitShowFile` so the
//      non-resolving-sha spray (cheap git lookup, no build) is capped too —
//      moving it below would re-open the CPU vector. Guarded by the
//      "rate-limited — DoS guard" test in test/git-api.test.ts.
const HIST_WINDOW_MS = 10_000;
const HIST_MAX_BUILDS = 24;
let histWindowStart = Date.now();
let histBuilds = 0;

// Shas neither git NOR the linked cell could resolve (feature-cloud-managed-git-
// posture). Without it, every re-request of a bad sha costs a git lookup AND a
// network round trip to the hub — and the sha is attacker-influenceable from the
// untrusted canvas origin (DDR-054), so "it will fail again" must be cheap to
// say. Bounded like the positive cache; a miss is only ever a wasted retry.
const historicalMissCache = new Set<string>();
const HIST_MISS_MAX = 256;

/**
 * The linked cell's blob reader, or null when this project is not
 * cloud-managed.
 *
 * `createCloudEndpoints` is a pure closure factory (it touches disk only when a
 * method is CALLED), and `historyFile` already answers null unless the folder
 * is linked AND credentialed — which is exactly the cloud-managed condition.
 * So the posture is not re-derived here; it is asked of the module that owns
 * it. Memoized per repo root because a process serves one.
 */
let cloudHistoryFor: { root: string; api: ReturnType<typeof createCloudEndpoints> } | null = null;

/**
 * Forget every historical build and every remembered absence.
 *
 * Called when the project's LINK changes (Connect / Disconnect). Both caches
 * are keyed by `(path, sha)` and neither mentions which repo answered, so a
 * cloud-sourced entry — and, more importantly, an absence the CELL was
 * authoritative about — would otherwise outlive the link and be served to a
 * now-local project that may well have the object. (Security re-review of
 * 8134ca8f, finding F5.)
 */
export function clearHistoricalCaches(): void {
  historicalCanvasCache.clear();
  historicalMissCache.clear();
  cloudHistoryFor = null;
}
function cloudHistoryApi(ctx: Context): ReturnType<typeof createCloudEndpoints> {
  if (cloudHistoryFor?.root !== ctx.paths.repoRoot) {
    cloudHistoryFor = { root: ctx.paths.repoRoot, api: createCloudEndpoints(ctx) };
  }
  return cloudHistoryFor.api;
}

function historicalBuildAllowed(): boolean {
  const now = Date.now();
  if (now - histWindowStart >= HIST_WINDOW_MS) {
    histWindowStart = now;
    histBuilds = 0;
  }
  if (histBuilds >= HIST_MAX_BUILDS) return false;
  histBuilds++;
  return true;
}
async function serveHistoricalCanvas(
  absPath: string,
  sha: string,
  req: Request,
  ctx: Context
): Promise<Response> {
  const repoRel = relative(ctx.paths.repoRoot, absPath).replace(/\\/g, '/');
  const key = `${absPath}\0${sha}\0${RUNTIME_BOOT_ID}\0${CHROME_EPOCH}`;
  let cached = historicalCanvasCache.get(key);
  if (cached) {
    // LRU touch — re-insert so the hot entry isn't the next eviction victim.
    historicalCanvasCache.delete(key);
    historicalCanvasCache.set(key, cached);
  } else {
    if (!historicalBuildAllowed()) {
      return new Response('Too many version previews — try again in a moment.', {
        status: 429,
        headers: { 'Retry-After': '10', 'Cache-Control': 'no-store' },
      });
    }
    // LOCAL FIRST, THEN THE CLOUD. In cloud-managed posture the History rows
    // come from the cell, so the sha the user clicked may exist ONLY there —
    // the local repo has no commits at all. Local still goes first: it is a
    // disk read against a repo that may well have the object (a folder that was
    // committed to before it was linked), and it costs nothing to try.
    //
    // Everything downstream is unchanged — same build, same CSP, same LRU, same
    // DiffView. Historical content is immutable, so a cloud-sourced build
    // caches under the identical `(path, sha)` key.
    //
    // The sha is validated on BOTH sides: `/^[0-9a-f]{7,40}$/` here (via
    // `historyFile`) and again on the hub. It arrives from the untrusted canvas
    // origin, and "the other end checks it" is how a guard ends up on neither.
    // A sha that already failed AUTHORITATIVELY fails again — say so without
    // spending the git process or the round trip.
    if (historicalMissCache.has(key)) {
      return new Response('No saved version of this canvas', { status: 404 });
    }
    // ACCEPTED REVISIONS: `r<revision>` names a project revision (T27), read
    // from the project's store — immutable, so it caches like a sha.
    const acceptedRev = /^r(\d{1,12})$/.exec(sha);
    let source = acceptedRev
      ? ((await ctx.syncControl
          ?.current?.()
          ?.acceptedVersion?.(repoRel, Number(acceptedRev[1]))
          .catch(() => null)) ?? null)
      : await gitShowFile(ctx.paths.repoRoot, sha, repoRel);
    if (source == null && !acceptedRev) {
      const fromCloud = await cloudHistoryApi(ctx).historyFile(sha, repoRel);
      source = fromCloud.ok ? fromCloud.source : null;
      // ONLY AN AUTHORITATIVE ABSENCE IS REMEMBERED (security re-review of
      // 8134ca8f, finding F1). Two things must never be cached here:
      //
      //   1. A TRANSIENT failure. `unreachable` / `not-linked` mean the cell
      //      could not answer, not that the version is absent — remembering
      //      that outlives the outage and makes a real version permanently
      //      unpreviewable, with no way to clear it but a restart.
      //   2. A MUTABLE ref. The local engine's positional guard admits `HEAD`,
      //      branch and tag names, and DiffView's own "compare with saved"
      //      opens `?sha=HEAD`. Caching a miss for a moving name is a bug by
      //      construction: diff an as-yet-uncommitted canvas, commit it, and
      //      `HEAD` now resolves — but the cached miss short-circuits before
      //      `gitShowFile` is ever asked again. That is exactly the "read
      //      failure rendered as absence" this feature exists to delete.
      const authoritative = !fromCloud.ok && fromCloud.reason === 'not-found';
      if (source == null && authoritative && /^[0-9a-f]{7,40}$/.test(sha)) {
        historicalMissCache.add(key);
        if (historicalMissCache.size > HIST_MISS_MAX) {
          const oldest = historicalMissCache.values().next().value;
          if (oldest !== undefined) historicalMissCache.delete(oldest);
        }
      }
    }
    if (source == null) return new Response('No saved version of this canvas', { status: 404 });
    try {
      const result = await buildCanvasModule(absPath, source, {
        designRoot: ctx.paths.designRoot,
        // Same unconditional allowlist as the live build above — a HISTORICAL
        // source is still tenant/peer-authored content.
        restrictImportsTo: ctx.paths.designRoot,
      });
      cached = {
        js: result.js,
        etag: `${result.etag}-${sha}-${RUNTIME_BOOT_ID}-${CHROME_EPOCH}`,
      };
      historicalCanvasCache.set(key, cached);
      if (historicalCanvasCache.size > HIST_MAX_CACHE) {
        const oldest = historicalCanvasCache.keys().next().value;
        if (oldest !== undefined) historicalCanvasCache.delete(oldest);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Canvas build error: ${msg}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  }
  if (req.headers.get('if-none-match') === cached.etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: cached.etag, 'Cache-Control': 'no-cache' },
    });
  }
  return new Response(cached.js, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      ETag: cached.etag,
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * How long a served file may be reused — Cloud Phase 27 B2.
 *
 * `no-store` on everything is correct on a laptop, where the round trip is a
 * memcpy and the designer is editing the file you just served. Over the
 * internet it means a teammate re-downloads every photograph on every pan, on
 * a project whose media is 266 MB. So:
 *
 *   content-addressed name  →  immutable, a year. The name IS the content
 *                              (sha8), so a changed file is a changed URL and
 *                              a stale answer is impossible by construction.
 *   everything else         →  revalidate (`no-cache` + ETag). A designer
 *                              editing `hero.png` in place still sees their
 *                              edit; the wire cost of not having changed it is
 *                              a 304, not the file.
 *
 * Universal, not cloud-only: the rule is true on all three shells, and a
 * caching policy that differs per shell is a bug report nobody can reproduce.
 */
export function cacheControlFor(absPath: string): { cacheControl: string; addEtag: boolean } {
  const name = absPath.slice(absPath.lastIndexOf('/') + 1);
  // The shape every writer emits — timeline insert/replace/assemble, the asset
  // upload route, `maude design fetch-asset`: <sha8>.<ext>, lowercase hex.
  if (/^[0-9a-f]{8,64}\.[A-Za-z0-9]+$/.test(name)) {
    return { cacheControl: 'public, max-age=31536000, immutable', addEtag: false };
  }
  return { cacheControl: 'no-cache', addEtag: true };
}

/** A weak validator from the file's own metadata — no read, no hash. */
function etagFor(file: { size: number; lastModified: number }): string {
  return `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`;
}

/**
 * An SVG is a DOCUMENT, and a document runs script.
 *
 * `image/svg+xml` is inert as an `<img>`, a CSS `url()` or a `<use>` target —
 * none of those are browsing contexts. Navigate to one directly and it is a
 * page, with `<script>` in it, executing on whatever origin served it. On the
 * canvas origin that is a stored-XSS primitive: canvases carry the tenant's own
 * SVGs, only the shell HTML gets a CSP, and every other static response here
 * has carried `nosniff` and nothing else.
 *
 * `default-src 'none'; sandbox` costs the legitimate uses nothing (an image is
 * not a document, so the policy never applies to them) and makes the
 * navigate-to-it case a blank page instead of a foothold. Found by an
 * adversarial pass as step one of a three-link cross-tenant chain; the other
 * two links are closed in the same change, and this is the cheapest of the
 * three to break.
 */
const INERT_DOCUMENT_CSP = "default-src 'none'; sandbox";

async function serveFile(absPath: string, headers: Record<string, string> = {}): Promise<Response> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return new Response('Not found', { status: 404 });
  const e = ext(absPath);
  const policy = cacheControlFor(absPath);
  return new Response(file, {
    headers: {
      'Content-Type': MIME[e] || 'application/octet-stream',
      'Cache-Control': policy.cacheControl,
      ...(policy.addEtag ? { ETag: etagFor(file) } : {}),
      ...(e === '.svg' ? { 'Content-Security-Policy': INERT_DOCUMENT_CSP } : {}),
      ...headers,
    },
  });
}

/** Media (video/audio) extensions that get HTTP Range support when served. */
const RANGE_MEDIA_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.ogg']);

/**
 * DDR-150 dogfood (team finding) — serve a media file with HTTP Range support.
 * The plain `new Response(Bun.file(..))` lane answered `Range:` requests with a
 * 200 + full body: Chrome copes for small clips (buffers everything) but large
 * MP4s scrub terribly, and WKWebView (the native desktop app) can refuse to
 * play media from servers without Range support at all. Single-range only
 * (`bytes=a-b`, suffix `bytes=-n`, open `bytes=a-`); malformed ranges fall back
 * to a full 200; an unsatisfiable one gets an honest 416.
 */
async function serveMediaFile(
  absPath: string,
  req: Request,
  headers: Record<string, string> = {}
): Promise<Response> {
  const file = Bun.file(absPath);
  if (!(await file.exists())) return new Response('Not found', { status: 404 });
  const size = file.size;
  const base = {
    'Content-Type': MIME[ext(absPath)] || 'application/octet-stream',
    // B2 — same policy as serveFile. Media is the heaviest thing a member
    // fetches, so the content-addressed case matters most here.
    'Cache-Control': cacheControlFor(absPath).cacheControl,
    'Accept-Ranges': 'bytes',
    ...headers,
  };
  const range = req.headers.get('range');
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2]) && size > 0) {
    const start = m[1]
      ? Number.parseInt(m[1], 10)
      : Math.max(0, size - Number.parseInt(m[2] as string, 10));
    const end = m[1] && m[2] ? Math.min(Number.parseInt(m[2], 10), size - 1) : size - 1;
    if (Number.isFinite(start) && start >= 0 && start <= end && start < size) {
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          ...base,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      });
    }
    return new Response(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${size}` },
    });
  }
  return new Response(file, { headers: base });
}

export interface Http {
  routes: Record<string, (req: Request) => Response | Promise<Response>>;
  fetch(req: Request): Promise<Response>;
  /**
   * T2 (9.1-A) — build the canvas mount-harness response. `applyCsp` adds the
   * strict CSP (always on for the segregated canvas origin; the legacy main
   * origin keeps it env-gated for the POC). Shared so both listeners produce
   * byte-identical HTML.
   */
  serveCanvasShell(applyCsp: boolean, capture?: boolean): Promise<Response>;
  /**
   * T2 (9.1-A) — allowlist gate for the segregated canvas origin. Returns true
   * only for the routes the canvas runtime legitimately needs (shell, runtime
   * bundles, comment-mount, transpiled .tsx + CSS/assets under designRoot,
   * git-user, canvas-meta, health). Everything else is 403'd at the door so
   * hub-pushed JSX can't reach /_api/export, /_config, /_sync-status, comments,
   * the app shell, or arbitrary repo files. WS upgrades are gated in server.ts.
   */
  isCanvasSafeRoute(pathname: string): boolean;
}

export function createHttp(
  ctx: Context,
  api: Api,
  /** D3 — one inspector per member. `inspect()` resolves the ambient session's
   *  instance, which on a desktop is the single one this used to be. */
  inspects: InspectRegistry,
  ai: AiActivity,
  exportJobs: ExportJobQueue,
  generateJobs: GenerationJobQueue
): Http {
  /** The current request's inspector state (Cloud Phase 27 D3). Resolved per
   *  call rather than captured, because "whose" changes per request and a
   *  captured instance would hand one member another's open canvas. */
  const inspect = () => inspects.for(currentSession());

  // Task 2.7 (approach A) — in-flight whisper-model download state (one at a
  // time), polled by the Settings "Download model" card via GET
  // /_api/generate/whisper-model. Closure-scoped: one server, one download.
  let whisperDownload: {
    id: string;
    received: number;
    total: number;
    error?: string;
  } | null = null;

  // feature-scene-aware-keyframes — in-flight Gemma-model download state, polled by
  // the Settings "Scene-aware keyframes" card via GET /_api/generate/keyframe-model.
  // Closure-scoped: one server, one download.
  let keyframeDownload: { id: string; received: number; total: number; error?: string } | null =
    null;

  // Cache invalidation — when canvas-lib changes, every cached canvas bundle
  // is stale because canvas-lib is inlined into each one via the resolver
  // plugin. Drop the whole cache so the next request rebuilds with the fresh
  // lib. Without this, the HMR "hard reload" message reaches the browser but
  // the iframe re-fetches a stale-but-fresh-mtime bundle and the change never
  // takes effect.
  //
  // Per DDR-025 canvas-lib ships with the dev-server, so we watch the
  // dev-server-internal file directly instead of relying on the project-side
  // fs:any watcher. The synthetic `_lib/canvas-lib.tsx` rel-path lets the
  // existing hmr-broadcast classifier emit a hard reload without bespoke
  // wiring. The legacy `fs:any` _lib/ listener stays for downstream projects
  // still carrying a pre-4.0.5 `<designRoot>/_lib/`, but that file is now
  // ignored at build time — clearing the cache here is harmless.
  ctx.bus.on('fs:any', (rel: string) => {
    if (rel.startsWith('_lib/')) {
      canvasCache.clear();
      CHROME_EPOCH++;
    }
  });

  let libWatcher: ReturnType<typeof watch> | null = null;
  try {
    libWatcher = watch(canvasLibPath(), () => {
      canvasCache.clear();
      CHROME_EPOCH++;
      ctx.bus.emit('fs:any', '_lib/canvas-lib.tsx');
    });
  } catch (err) {
    console.warn(
      '[canvas-lib] failed to watch dev-server canvas-lib:',
      err instanceof Error ? err.message : err
    );
  }
  void libWatcher;

  // G7v2 — canvas-lib.tsx transitively imports many dev-server siblings
  // (canvas-shell, contextual-toolbar, equal-spacing-handles, tool-palette,
  // use-tool-mode, ...). Editing any of them invalidates the bundled canvas
  // output. Without watching them the mtime-keyed `canvasCache` keeps serving
  // the stale bundle and the user sees pre-edit behaviour even after a hard
  // iframe reload.
  //
  // Recursive watch over DEV_SERVER_ROOT, filtered to .tsx AND .ts: the chrome
  // graph includes plain `.ts` modules that DO reach the canvas
  // (`canvas-cursors.ts`, `canvas-arrowheads.ts`) — the prior `.tsx`-only filter
  // skipped them, so cursor edits never busted the cache (the recurring stale-
  // cursor bug, DDR-067). Server-only `.ts` (api / http / context) also clears
  // here, which is harmless (a needless rebuild, not a stale serve). Test files
  // (`test/`), built output (`dist/`, `client/`), and node_modules are skipped.
  let devSrcWatcher: ReturnType<typeof watch> | null = null;
  try {
    devSrcWatcher = watch(DEV_SERVER_ROOT, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      if (!filename.endsWith('.tsx') && !filename.endsWith('.ts')) return;
      if (filename.startsWith('test/') || filename.startsWith('test\\')) return;
      if (filename.startsWith('dist/') || filename.startsWith('client/')) return;
      if (filename.includes('node_modules')) return;
      canvasCache.clear();
      ctx.bus.emit('fs:any', `_lib/${filename}`);
    });
  } catch (err) {
    console.warn(
      '[dev-server-src] failed to watch source tree:',
      err instanceof Error ? err.message : err
    );
  }
  void devSrcWatcher;

  async function readJson<T = unknown>(req: Request, max = 256 * 1024): Promise<T | null> {
    try {
      // DDR-148 security (attacker F2): the global maxRequestBodySize is raised
      // to ~108 MB so the STREAMING /_api/asset route can accept large videos —
      // but a JSON route must never buffer that. `req.text()` would materialize
      // the whole body BEFORE the length check (a 107 MB body from the untrusted
      // canvas origin = memory-amplification DoS, reverting DDR-088). So: honest
      // content-length fast-reject, then read the stream and ABORT past `max`,
      // buffering at most ~max + one chunk.
      const cl = Number(req.headers.get('content-length'));
      if (Number.isFinite(cl) && cl > max) return null;
      const body = req.body;
      if (!body) return null;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        size += value.byteLength;
        if (size > max) {
          try {
            await reader.cancel();
          } catch {
            /* stream already closing */
          }
          return null;
        }
        chunks.push(value);
      }
      if (size === 0) return null;
      const buf = new Uint8Array(size);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      const text = new TextDecoder().decode(buf);
      return text ? (JSON.parse(text) as T) : null;
    } catch {
      return null;
    }
  }

  // Phase 27 (E2) — `/_api/git/*` orchestration. MAIN-ORIGIN ONLY: every git
  // route is intentionally absent from CANVAS_SAFE_API + startCanvasServer's
  // `routes` map (the dual-allowlist rule), so the untrusted canvas iframe origin
  // can never reach status/commit/publish/get-latest. http.ts owns the gating;
  // git/endpoints.ts owns the orchestration.
  const photoStore = createPhotoStore(ctx);
  // feature-footage-analysis-director — footage-analysis + EDL sidecars.
  // MAIN-ORIGIN ONLY (privileged): the `/_api/footage` route is intentionally
  // absent from CANVAS_SAFE_API + startCanvasServer's `routes` map, so the
  // untrusted canvas iframe origin can never read/write the director's analysis.
  const footageStore = createFootageStore(ctx);
  const gitApi = createGitEndpoints(ctx);
  // Phase 28 (E3) — `/_api/github/*`. Same dual-allowlist rule: main-origin only,
  // and every route is token-bearing (server-held keychain token via the loopback
  // bridge), so all four also carry a loopback-Host check.
  const githubApi = createGitHubEndpoints(ctx);
  // Cloud Phase 23 C3 — `/_api/cloud/*`. Same dual-allowlist rule as the
  // GitHub routes: MAIN-ORIGIN ONLY (absent from CANVAS_SAFE_API +
  // startCanvasServer) and loopback-Host gated — every route either bears or
  // stores the cloud credential.
  // A LIVE view of ctx, never a copy: server.ts attaches `ctx.syncControl`
  // after the route table is built, and a spread taken here froze it out —
  // Connect then linked the project and answered "Restart Maude to start
  // syncing" instead of starting the sync (cloud-attach E2E, since 2026-08-18).
  const cloudApi = createCloudEndpoints(
    Object.assign(Object.create(ctx) as Context, {
      // Connect and Disconnect both change WHO can answer for a past version.
      onLinkChanged: clearHistoricalCaches,
    })
  );
  // Figma import (DDR-216). Same dual-allowlist rule as the GitHub + cloud
  // routes: MAIN-ORIGIN ONLY, plus loopback-Host and same-origin gating on
  // every one of them — each either stores or spends the user's Figma PAT.
  const figmaApi = createFigmaEndpoints({
    // The import itself lives in the CLI helper — ONE implementation, so the
    // panel and `maude design import-figma` cannot drift apart in what they
    // sanitize, cap or report. Imported lazily so the studio's boot path never
    // pulls the import machinery (and its browser-backed SVG lane) into memory
    // for the 99% of sessions that never import anything.
    async runImport({ url, mode, dryRun }) {
      const mod = await import('./bin/_import-figma.mjs');
      const args = {
        url,
        root: ctx.paths.repoRoot,
        designRootRel: ctx.paths.designRel,
        dryRun: Boolean(dryRun),
      };
      if (mode === 'board') {
        const r = await mod.importBoard(args);
        return {
          summary: {
            mode,
            slug: r.slug,
            strokeCount: r.strokeCount,
            dispositions: r.report.entries,
          },
        };
      }
      if (mode === 'frames') {
        const r = await mod.importFrames(args);
        return {
          summary: {
            mode,
            frameCount: r.frameCount,
            written: r.written.map((w: { slug: string }) => w.slug),
            assets: { resolved: r.resolvedAssets, pending: r.pendingExports },
            dispositions: r.reports.flatMap((rep: { entries: unknown[] }) => rep.entries),
          },
        };
      }
      const r = await mod.importTokens(args);
      return {
        summary: {
          mode,
          source: r.source,
          count: r.count,
          path: r.path,
          dispositions: r.report.entries,
        },
      };
    },
    // `--explode` from the panel. Same lazy import and same ONE implementation
    // as the routes above — and note what is NOT here: the raw codegen response
    // never leaves the verb, so this route returns the same code-owned
    // accounting an agent would see on stdout (DDR-219 D10).
    async explode({ canvas, artboard, dryRun, confirmDocument }) {
      const mod = await import('./bin/_import-figma.mjs');
      const r = await mod.explodeArtboard({
        root: ctx.paths.repoRoot,
        designRootRel: ctx.paths.designRel,
        canvasRel: canvas,
        artboardId: artboard,
        dryRun: Boolean(dryRun),
        confirmDocument: Boolean(confirmDocument),
      });
      return {
        summary: {
          canvas: r.canvas,
          artboard: r.artboardId,
          route: 'codegen',
          endpoint: 'local',
          responseSha256: r.responseSha256,
          written: r.written,
          assets: r.assets ?? null,
          dispositions: r.report.entries,
        },
      };
    },
  });
  const gitJson = (r: { status: number; json: unknown }) =>
    Response.json(r.json, { status: r.status, headers: { 'Cache-Control': 'no-store' } });

  /**
   * A refused `/_api/sync/*` call, in the shape the Sync panel can actually
   * render: `{ ok: false, reason, detail }`.
   *
   * The panel falls back to a fixed string when a response carries no `detail`,
   * so every plain-text refusal on these routes surfaced as the same causeless
   * "Resync could not start." — the failure the 2026-08-13 report ends on. The
   * gate decisions are untouched; only the answer is.
   *
   * The `detail` is written for a person and names no request internals: which
   * origin or host was presented is in the server log, where it is diagnostic,
   * not in a body a canvas iframe could read back.
   */
  const syncRefusal = (reason: 'cross-origin' | 'untrusted-host', what: string): Response => {
    console.warn(`[sync] ${reason} request to a sync control route — refused.`);
    const detail =
      reason === 'cross-origin'
        ? `${what} from Maude itself, not from inside a canvas.`
        : `${what} from the Maude app or this machine's own browser tab.`;
    return gitJson({ status: 403, json: { ok: false, reason, detail } });
  };

  // Shared by /_api/export and /_api/export-jobs — build the exportJobs.enqueue()
  // args from a validated request body. `inspect.state` is the live `_active.json`;
  // readers narrow to the resolver's subset locally so the export pipeline doesn't
  // pin the wider ActiveState interface.
  function buildExportArgs(
    req: Request,
    body: { format: Format; scope: Scope; options?: Record<string, unknown> }
  ) {
    const activeJson = inspect().state as unknown as ActiveJsonShape;
    return {
      format: body.format,
      scope: body.scope,
      options: body.options ?? {},
      resolve: { activeJson, designRoot: ctx.paths.designRoot, repoRoot: ctx.paths.repoRoot },
      ctx: {
        designRoot: ctx.paths.designRoot,
        repoRoot: ctx.paths.repoRoot,
        // Adapters reach back into the server via this origin only when they
        // need Playwright rendering (PNG / PDF / SVG / HTML). The host that
        // received this request is, by definition, the one serving the canvas.
        serverOrigin: new URL(req.url).origin,
        // Mirror `client/app.jsx:85` — the per-DS tokensCssRel wins over the
        // legacy top-level default (which still points at the pre-multi-DS
        // layout `system/colors_and_type.css`). Without the per-DS path, the
        // standalone `_canvas-shell.html` 404s on the tokens link and the
        // rendered DOM uses `var(--bg-0)` unresolved → screenshots come out
        // blank. See canvasShellUrl().
        tokensCssRel: ctx.cfg.designSystems?.[0]?.tokensCssRel ?? ctx.cfg.tokensCssRel,
      },
      // DDR-230 — how the render service reaches this project's canvas when
      // the job dispatches remotely (workspace `remote` lane): the PUBLIC
      // canvas origin the member's own iframes load from, plus the member's
      // render token forwarded from THIS request. On a desktop both are
      // absent/loopback and the lane is `local`, so this is never read.
      remoteCanvas: {
        // MAUDE_RENDER_CANVAS_BASE overrides for deployments where the render
        // service reaches the canvas on a different address than the member's
        // browser does (the self-hosted sidecar fetches the hub over the
        // compose network, not the public domain).
        origin: process.env.MAUDE_RENDER_CANVAS_BASE ?? ctx.canvasOrigin ?? '',
        // The VIEWER-scoped render token (DDR-230 §c) the hub proxy injects —
        // NOT `x-maude-canvas-token`, which carries the member's own (up to
        // write-capable) role. The worker only reads, so it holds only read.
        token: req.headers.get('x-maude-render-token') ?? undefined,
        tokensCssRel: ctx.cfg.designSystems?.[0]?.tokensCssRel ?? ctx.cfg.tokensCssRel,
      },
    };
  }

  const routes = {
    '/_health': () =>
      Response.json({
        ok: true,
        app: 'design',
        project: ctx.cfg.name,
        // WHICH TREE THIS PROCESS IS ACTUALLY SERVING — Cloud Phase 27 D5.
        //
        // A supervisor that only asks "did something answer" cannot tell a
        // studio serving the tenant's checkout from one serving whatever was
        // left in the working directory, and "boots, looks fine, serves the
        // wrong root" is exactly the mistake `studioLaunch` warns about one
        // process up. A tag is not an identity; a hash is.
        //
        // The HASH and not the path: this route is on the canvas origin's
        // allowlist, so the tenant's own untrusted code can read it, and a
        // server filesystem path is not something it should learn. The
        // supervisor hashes its own expected root and compares.
        rootId: rootIdentity(ctx.paths.repoRoot),
        pid: process.pid,
        // Cloud Phase 26 Stage 4 — the build sandbox's own counters, so the
        // €3/cell model finally has figures instead of a prediction. Counts and
        // durations ONLY: never a canvas name, never a path, and never the text
        // of a rejected import specifier (that specifier is tenant-authored
        // content — the operational fact is that a rejection happened, not what
        // it said).
        //
        // On `/_health`, which the untrusted canvas origin may read, and that
        // is deliberate: every figure here is about the reader's OWN cell, so
        // it discloses nothing across a tenant boundary. Inventing a privileged
        // route would have meant inventing an auth path for the supervisor's
        // loopback probe, for data the tenant already has.
        render: buildStats(),
      }),

    '/_active': () => Response.json(inspect().state),

    // Phase 31 (DDR-123) — ACP chat readiness. Cheap, side-effect-free probe
    // (is the adapter present + is `claude` on PATH); no subprocess spawned.
    // MAIN-ORIGIN ONLY — absent from CANVAS_SAFE_API + startCanvasServer routes,
    // so the untrusted canvas iframe is 403'd. The native shell reads this to
    // decide between the enabled panel and the not-connected explainer.
    // Explicit CSRF + DNS-rebind gate added alongside DDR-166: this route's
    // `claudePath` field can now reveal a Maude-auto-installed binary's exact
    // path, and this file's other ACP-adjacent routes all double-gate —
    // security-review finding that this one had none at all, pre-existing
    // but newly worth closing given what this diff makes it able to reveal.
    '/_api/acp/status': async (req: Request) => {
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(await probeAcpAvailabilityAuthed(), {
        headers: { 'Cache-Control': 'no-store' },
      });
    },

    // DDR-128 — first-open AI-editing readiness. Read-only probe of the AI-editing
    // dependency chain (claude CLI · maude CLI · maude marketplace + plugins in the
    // paired Claude Code · optional agent-browser) with per-item remediation; it
    // installs/mutates nothing. MAIN-ORIGIN ONLY — absent from CANVAS_SAFE_API +
    // startCanvasServer routes, so the untrusted canvas iframe is 403'd. The probe
    // can shell out (login-shell fallback), so a cross-origin Origin-reject also
    // fronts it — a drive-by page can't fire the loopback endpoint to spawn-storm
    // the dev-server (DDR-128 hardening). The onboarding readiness card + the
    // ChatPanel not-connected explainer + the Help-menu modal read this.
    '/_api/preflight': async (req: Request) => {
      if (!sameOriginWrite(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(await probeReadiness(), { headers: { 'Cache-Control': 'no-store' } });
    },

    // DDR-166 plan, Phase 2 (T6) — design-setup readiness (project ✓ / design
    // system ✓ / first canvas ✓ / brand assets ✓), distinct from the AI-editing
    // dependency probe above. Read-only, cheap (a few existsSync/readdir calls
    // scoped to designRoot) — same double gate as every other privileged
    // read here even though it can't shell out, for consistency with the rest
    // of this file's onboarding-surface routes. The quick-setup checklist
    // (SetupChecklist.jsx) polls this.
    '/_api/setup-readiness': async (req: Request) => {
      if (!sameOriginWrite(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(await probeSetupReadiness(ctx), {
        headers: { 'Cache-Control': 'no-store' },
      });
    },

    // DDR-166 T0c (Addendum 2) — install Claude Code from Maude by running the
    // exact official one-liner once, ephemerally (no persistent Maude-managed
    // cache — that design was rejected on security review; see
    // installClaudeCli()'s own doc comment for the fix). MAIN-ORIGIN ONLY,
    // same CSRF + DNS-rebind double gate as every other privileged route.
    '/_api/claude/install': (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      // Fire-and-forget — the install can run past Bun's default 10s idle
      // timeout on a slow network, so this returns as soon as the spawn is
      // confirmed started; the panel polls /_api/claude/install-status for
      // the result, the same shape /_api/claude/signin-status already uses.
      const result = startInstall();
      return Response.json(result, {
        status: result.ok ? 200 : 409,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    // GET route with a real subprocess side effect downstream (signin-status
    // spawns `claude auth status`) — sameOriginWrite alone doesn't gate a GET
    // (browsers don't reliably stamp Origin on a simple cross-origin GET,
    // per this file's own sameOriginRead doc comment, written for exactly
    // this class of route after a prior ethical-hacker finding on
    // audio-search). Security-review finding against the first cut of these
    // two routes, which used the wrong guard.
    '/_api/claude/install-status': (req: Request) => {
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(getInstallState(), { headers: { 'Cache-Control': 'no-store' } });
    },

    // DDR-166 T0d — sign in to Claude from Maude, driving the user's OWN `claude`
    // CLI through its own `auth login`/`auth status` subcommands (never Maude's
    // own OAuth, never a token Maude holds). MAIN-ORIGIN ONLY — absent from
    // CANVAS_SAFE_API + startCanvasServer routes, same CSRF + DNS-rebind double
    // gate as every other privileged POST route (DDR-088). Zero new Tauri
    // commands (Decision 0) — this lives in the same Bun process as bridge.ts/
    // env.ts, so it reuses the literal scrubAgentEnv/resolveClaudePath the chat
    // spawn already uses.
    '/_api/claude/signin': (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const result = startSignin();
      return Response.json(result, {
        status: result.ok ? 200 : 409,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    '/_api/claude/signin-cancel': (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      cancelSignin();
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    },
    // Read-only poll target — the panel calls this (or /_api/preflight, which
    // folds the same status in) on an interval while a sign-in is in flight.
    // Narrowed fields only (never email/orgId/orgName — see login-state.ts).
    '/_api/claude/signin-status': async (req: Request) => {
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const status = await getClaudeAuthStatus();
      return Response.json(
        { ...status, inFlight: isSigninInFlight() },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // Phase 31 (DDR-123) — `/design:chat` focus hook. `maude design chat-open`
    // POSTs here; we emit a bus event the shell turns into "open the Assistant
    // panel" (app.jsx, native-only). MAIN-ORIGIN ONLY (off the canvas allowlist).
    '/_api/acp/focus': (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // CSRF parity with the other POST routes — the loopback `maude design
      // chat-open` driver omits Origin (allowed); a browser drive-by can't forge it.
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      ctx.bus.emit('acp-focus', {});
      return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    },

    // Addendum Task 9 — "is a chat mid-turn right now?", asked by
    // RepoBranchSwitcher.jsx before any of its three `window.location.reload()`
    // call sites. A `git checkout` moves the worktree under a running agent
    // (read on `draft-a`, written back after the checkout to `main` — a silent
    // cross-branch clobber that `_history/`, being per-canvas-slug with no
    // branch awareness, cannot undo), so this gates a confirm rather than
    // reloading silently. MAIN-ORIGIN ONLY, read-only, no chat CONTENT — just
    // how many are busy, so it says nothing the canvas origin could want.
    '/_api/acp/running': (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const running = runningChats();
      return Response.json(
        { running: running.length, chats: running },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-acp-turn-notifications Task 3 — the native shell's poller reads
    // this to decide whether to fire an OS notification for a NON-visible
    // project (Decision C). A sibling of `/_api/acp/running` above rather than
    // an extension of it — that route stays exactly as-is because the reaper's
    // `has_running_chat` (sidecar.rs) already depends on its `{running,chats}`
    // shape and has no reason to grow one. MAIN-ORIGIN ONLY, same gate, and —
    // load-bearing (Decision D) — NEVER a chat title, message text, or any
    // transcript content: just chat ids (opaque, already exposed by `running`
    // above) and a three-value state. Anyone adding a field here should ask
    // what it would look like rendered on a lock screen.
    '/_api/acp/activity': (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(activitySnapshot(), { headers: { 'Cache-Control': 'no-store' } });
    },

    // Phase 31 — repo-level chat list + history (for the chat switcher +
    // hydration). MAIN-ORIGIN ONLY. Read-only; ids are sanitized before disk.
    '/_api/acp/chats': () =>
      Response.json(listChats(ctx.paths.designRoot), {
        headers: { 'Cache-Control': 'no-store' },
      }),
    '/_api/acp/chat': async (req: Request) => {
      const id = (new URL(req.url).searchParams.get('id') ?? '')
        .replace(/[^a-z0-9_-]/gi, '')
        .slice(0, 64);
      if (req.method === 'DELETE') {
        const removed = id ? deleteChat(ctx.paths.designRoot, id) : false;
        return Response.json({ ok: removed }, { headers: { 'Cache-Control': 'no-store' } });
      }
      // Task C5 — Rename / Archive from the chat switcher's overflow menu.
      // Same CSRF + loopback gate as every other privileged write route
      // (DDR-088); id is already sanitized/contained above.
      if (req.method === 'PATCH') {
        if (!sameOriginWrite(req))
          return new Response('cross-origin write rejected', { status: 403 });
        if (!isTrustedRequestHost(req))
          return new Response('local request required (DNS-rebinding guard)', { status: 403 });
        if (!id) return new Response('missing id', { status: 400 });
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response('invalid JSON body', { status: 400 });
        }
        if (!body || typeof body !== 'object') return new Response('invalid body', { status: 400 });
        const b = body as { title?: unknown; archived?: unknown };
        const patch: { title?: string | null; archived?: boolean } = {};
        if ('title' in b) {
          if (b.title === null) patch.title = null;
          else if (typeof b.title === 'string') patch.title = b.title;
          else return new Response('title must be a string or null', { status: 400 });
        }
        if ('archived' in b) {
          if (typeof b.archived !== 'boolean')
            return new Response('archived must be a boolean', { status: 400 });
          patch.archived = b.archived;
        }
        const meta = writeChatMeta(ctx.paths.designRoot, id, patch);
        return Response.json(meta, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!id) return Response.json([], { headers: { 'Cache-Control': 'no-store' } });
      // Addendum Task 8 — the re-attach seam. Read the sequence marker BEFORE
      // the messages: a line appended between the two reads then shows up in
      // neither, and the client's `attach` will replay it. Reading it after
      // would risk the opposite (a line counted but not returned), which the
      // client would silently drop as "already hydrated" — a hole in the feed.
      // Shipped as a header rather than a body field so the response SHAPE
      // stays the plain message array every existing consumer expects.
      const seq = chatTranscriptSeq(ctx.paths.designRoot, id);
      return Response.json(readChatMessages(ctx.paths.designRoot, id), {
        headers: { 'Cache-Control': 'no-store', 'X-Maude-Chat-Seq': String(seq) },
      });
    },

    // Phase 31 follow-up — persist an image pasted straight into the ACP composer
    // (a clipboard screenshot has no path), returning an absolute path the chip
    // expands to so Claude can Read it. MAIN-ORIGIN ONLY: sameOriginWrite CSRF gate
    // on POST + deliberately absent from CANVAS_SAFE_API + startCanvasServer routes,
    // so the untrusted canvas iframe is 403'd. The disk caps live in
    // api.saveChatAttachment (magic-byte sniff / ASSET_MAX_BYTES / content-
    // addressed name / session write budget).
    //
    // GET ?name=<sha8>.<ext> serves the pasted image back to the chat feed
    // (thumbnail + lightbox). The name is regex-allowlisted in
    // api.resolveChatAttachment — content-addressed, never a caller path, so
    // traversal-proof by construction; content-addressed ⇒ immutable cache. No
    // CSRF gate on GET (sameOriginWrite is the POST/CSRF boundary) — the
    // main-origin posture above is what keeps the canvas origin out.
    '/_api/acp/attachment': async (req: Request) => {
      if (req.method === 'GET') {
        const name = new URL(req.url).searchParams.get('name');
        const abs = await api.resolveChatAttachment(name);
        if (!abs) return new Response('Not found', { status: 404 });
        return serveFile(abs, {
          'Cache-Control': 'public, max-age=31536000, immutable',
          // Uploaded bytes on the privileged main origin — never let the browser
          // MIME-sniff a polyglot into a richer type (mirrors the DDR-088 static
          // lane; the sniff/allowlist on write is the primary gate).
          'X-Content-Type-Options': 'nosniff',
        });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const declared = Number(req.headers.get('content-length') || '0');
      if (Number.isFinite(declared) && declared > ASSET_MAX_BYTES) {
        return Response.json(
          {
            ok: false,
            error: `attachment exceeds the ${Math.round(ASSET_MAX_BYTES / (1024 * 1024))} MB cap`,
          },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await req.arrayBuffer());
      } catch {
        return new Response('could not read request body', { status: 400 });
      }
      const result = await api.saveChatAttachment(bytes);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status ?? 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { path: result.path },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // Phase 9 Task 8 — offline-mode banner poll fallback. The linked-mode sync
    // runtime writes `_sync.json`; browser tabs also get live pushes over the
    // WS ('sync:status'). Returns `{ linked: false }` in solo mode.
    '/_sync-status': () => {
      const file = join(ctx.paths.designRoot, '_sync.json');
      if (!existsSync(file)) {
        return Response.json({ linked: false }, { headers: { 'Cache-Control': 'no-store' } });
      }
      try {
        const status = JSON.parse(readFileSync(file, 'utf8'));
        // The sync runtime lives in THIS process and stamps every payload it
        // writes. A file older than the process is a previous session's last
        // word — "offline" against a hub that may no longer be linked at all —
        // and showing it as the current state greeted the designer with
        // "Working offline" before anything had been tried.
        if (!(Number(status?.updatedAt) >= PROCESS_STARTED_AT)) {
          return Response.json({ linked: false }, { headers: { 'Cache-Control': 'no-store' } });
        }
        return Response.json(status, {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch {
        return Response.json({ linked: false }, { headers: { 'Cache-Control': 'no-store' } });
      }
    },

    // `readOnly` is COMPUTED, not stored in cfg: it comes from the role the
    // workspace vouched for at sign-in (Cloud Phase 25 C2), so the client
    // knows before it draws anything. It decides what the UI OFFERS and is
    // never what stops a write — the cell enforces that (Phase 25 C1),
    // whatever a patched client believes.
    '/_config': (req: Request) =>
      Response.json({
        ...ctx.cfg,
        canvasOrigin: ctx.canvasOrigin,
        readOnly: projectReadOnly(req),
        // WHICH RELEASE THIS IS. `/_config` reaches the browser in cloud mode,
        // so the bar for adding a field here is "would I publish it" — and a
        // version is the git tag, which is public. Nothing else rides along.
        //
        // Resolved through `resolveMaudeVersion`, the same function the What's
        // New feed uses: one answer, so the chip in the status bar and the feed
        // can never name different versions.
        version: resolveMaudeVersion(),
        // feature-cloud-export-render-workers — which export lane this server
        // holds (`local` | `remote` | `none`). The client gates the export
        // dialogs on it so a cell without a render service says WHY a format
        // is unavailable instead of firing a request the proxy 404s.
        exportLane: resolveRenderLane(),
        // Cloud Phase 27 (DDR-209) — the capability that opens the cookieless
        // canvas origin, minted per session by the proxy. Absent on a desktop,
        // where the canvas origin is loopback and needs none. `canvasUrl()`
        // appends it exactly the way it already appends `readOnly`, which is
        // what keeps this a FLAG on the shared client rather than a fork of it.
        ...(req.headers.get('x-maude-canvas-token')
          ? { canvasToken: req.headers.get('x-maude-canvas-token') }
          : {}),
        // Cloud Phase 27 C2/C4 — the ONE cloud-only input the shared client
        // takes. Its presence says "you are in a browser tab, on somebody
        // else's machine", which is what lets the client state the agent's
        // absence and offer a way back to the dashboard. A flag, not a fork:
        // every other difference between the three shells stays zero.
        ...(isWorkspaceMode()
          ? {
              cloud: {
                // PRESENCE IS THE SWITCH — never a default. `HUB_DASHBOARD_URL`
                // is written only by the managed fleet (cli/lib/cell-plan.mjs);
                // a self-hosted `maude hub workspace` never sets it and has no
                // multi-project dashboard to return to. Defaulting it to the
                // SaaS put a `← Dashboard` link in every self-hoster's menubar
                // that walked them off their own deployment onto cloud.maude.sh
                // — a dead end for an account most of them do not have. Same
                // rule the hub landing already keeps (server.mjs `isPlatform`)
                // and the auth pages already keep (browser-auth.mjs): no URL,
                // no link. Absent, not null, so the client's own check is the
                // single one — exactly like `canvasToken` two fields down.
                ...(process.env.HUB_DASHBOARD_URL
                  ? { dashboardUrl: process.env.HUB_DASHBOARD_URL }
                  : {}),
                projectName: process.env.MAUDE_PROJECT_NAME ?? ctx.cfg.name ?? null,
                // WHO the tab is signed in as, and WHAT that makes them —
                // per REQUEST, from the proxy's injected headers, never from
                // this process's environment (one cell serves an owner and a
                // viewer at the same time).
                //
                // The owner who could not edit his own project could not see
                // why: the stamp said VIEW ONLY and nothing on screen said
                // which account that verdict was about. Naming the account and
                // the role turns "this is broken" into "I am signed in as the
                // wrong person", which is a thing someone can act on — and the
                // sign-out beside it is how they act on it.
                user: req.headers.get('x-maude-user') || null,
                role: req.headers.get('x-maude-role') || null,
              },
            }
          : {}),
      }),

    // What's New feed (DDR-A) — read-only product-update list surfaced in the
    // Maude UI chrome. Main-origin only by omission from the canvas-origin
    // allowlist below (the untrusted canvas iframe never needs it).
    '/_api/whats-new': () =>
      Response.json(loadWhatsNew(), { headers: { 'Cache-Control': 'no-store' } }),

    // feature-bug-report-button — the scrubbed diagnostic bundle the Report-a-Bug
    // dialog previews for consent. PRIVILEGED (logs could reveal paths pre-scrub;
    // the scrubber runs here, server-side): MAIN-ORIGIN ONLY — absent from
    // CANVAS_SAFE_API + startCanvasServer routes — plus the same double gate as
    // /_api/acp/status (a drive-by page must not read logs via DNS rebinding).
    '/_api/debug-bundle': (req: Request) => {
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      return Response.json(
        buildDebugBundle({
          maudeVersion: resolveMaudeVersion(),
          projectName: ctx.cfg.name ?? null,
          activeCanvas: (inspect().state as { active?: string | null }).active ?? null,
          repoRoot: ctx.paths.repoRoot,
        }),
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-bug-report-button — capture the STUDIO SHELL (menubar, sidebar,
    // status bar, toasts) as a PNG. `/_api/export` can only ever render a canvas
    // headlessly, so Maude's own chrome — where most reported UI bugs actually
    // live — has never been capturable from inside the app. This shells out to
    // the same `screenshot.sh` spine every `/design:*` capture uses, in its
    // `--shell` mode, so it inherits engine resolution (the desktop bundle's
    // agent-browser via MAUDE_AGENT_BROWSER, DDR-144), one-time browser
    // provisioning, and the playwright fallback.
    //
    // The capture is a SEPARATE headless session, not a mirror of the user's
    // window: it reproduces the app's chrome and the active canvas, but not
    // transient state (an open dropdown, a stuck spinner). That's why the
    // dialog keeps the manual attach/paste lane alongside this.
    //
    // PRIVILEGED: main-origin only + double gate — it spawns a process and
    // renders the project, so the untrusted canvas origin must never reach it
    // (absent from CANVAS_SAFE_API + startCanvasServer routes, per DDR-088).
    '/_api/shell-shot': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      // Target the very server handling this request — no _server.json read, so
      // a stale/absent state file can't point the capture at another instance.
      const port = new URL(req.url).port;
      if (!/^\d+$/.test(port)) {
        return Response.json({ error: 'no port on the request URL' }, { status: 500 });
      }
      // Which canvas to open is the CLIENT's call, always sent explicitly —
      // `null` means "open nothing". The server's `_active.json` is global and
      // sticky (it outlives every closed tab and any session may write it), so
      // resolving it here would photograph a canvas the reporter never had open.
      const body = await readJson<{ canvas?: unknown }>(req);
      const canvas = typeof body?.canvas === 'string' ? body.canvas : '';
      const out = join(ctx.paths.designRoot, '_reports', `shell-${Date.now()}.png`);
      try {
        const proc = Bun.spawn(
          [
            'bash',
            join(BIN_DIR, 'screenshot.sh'),
            '--shell',
            '--port',
            port,
            '--out',
            out,
            '--root',
            ctx.paths.repoRoot,
            '--canvas',
            canvas,
          ],
          { stdout: 'ignore', stderr: 'pipe' }
        );
        // Booting a browser, loading the studio, opening the active canvas and
        // painting it runs well past a default fetch timeout on a cold cache;
        // the dialog shows a pending row meanwhile. Kill rather than hang.
        const timer = setTimeout(() => proc.kill(), 60_000);
        const code = await proc.exited;
        clearTimeout(timer);
        if (code !== 0 || !existsSync(out)) {
          const why = (await new Response(proc.stderr).text())
            .trim()
            .split('\n')
            .slice(-3)
            .join(' ');
          return Response.json({ error: `shell capture failed: ${why}` }, { status: 502 });
        }
        const png = await Bun.file(out).arrayBuffer();
        // The PNG is handed to the client and never needed again — leaving it on
        // disk would quietly grow `_reports/` on every dialog open.
        try {
          unlinkSync(out);
        } catch {
          /* already gone — nothing to clean up */
        }
        return new Response(png, {
          headers: { 'content-type': 'image/png', 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        return Response.json({ error: `shell capture failed: ${String(e)}` }, { status: 502 });
      }
    },

    // feature-bug-report-button — submit proxy. The client never talks to
    // cloud.maude.sh directly (no CORS surface to open, and the endpoint can be
    // overridden for self-hosters/tests via MAUDE_REPORT_URL). Forwards the
    // multipart body verbatim; the cloud route owns validation + quota.
    // PRIVILEGED: main-origin only + double gate (it triggers outbound network).
    '/_api/report': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const endpoint = process.env.MAUDE_REPORT_URL || 'https://cloud.maude.sh/report';
      try {
        // `globalThis.fetch` — NOT bare `fetch`: this module declares its own
        // `async function fetch(req: Request)` (the server fall-through handler)
        // in the same scope, which shadows the global. A bare call re-entered the
        // fall-through with a URL string, so `new URL(req.url)` threw
        // `"undefined" cannot be parsed as a URL` and every report died with a
        // plain-text HTTP 500 without ever leaving the machine.
        const upstream = await globalThis.fetch(endpoint, {
          method: 'POST',
          body: await req.formData(),
          signal: AbortSignal.timeout(30_000),
        });
        const body = await upstream.text();
        return new Response(body, {
          status: upstream.status,
          headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' },
        });
      } catch {
        // Unreachable/timeout — the client falls back to the local bundle path.
        return Response.json({ error: 'report service unreachable' }, { status: 502 });
      }
    },

    // feature-bug-report-button — offline/declined fallback: persist the bundle
    // locally under `<designRoot>/_reports/<ts>/` (gitignored runtime state,
    // DDR-115 taxonomy) so the user can attach it to a hand-filed issue.
    // PRIVILEGED: main-origin only + double gate (filesystem write).
    '/_api/report-fallback': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ report?: unknown; screenshots?: unknown }>(req);
      if (!body || typeof body.report !== 'object' || body.report === null) {
        return new Response('body must include { report }', { status: 400 });
      }
      const shots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, 3) : [];
      const dir = join(ctx.paths.designRoot, '_reports', String(Date.now()));
      await Bun.write(join(dir, 'report.json'), JSON.stringify(body.report, null, 2));
      let n = 0;
      for (const shot of shots) {
        if (typeof shot !== 'string') continue;
        const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(shot);
        if (!m || m[2].length > 7_000_000) continue; // ~5 MB decoded cap
        n += 1;
        await Bun.write(
          join(dir, `screenshot-${n}.${m[1] === 'png' ? 'png' : 'jpg'}`),
          Buffer.from(m[2], 'base64')
        );
      }
      return Response.json(
        { dir: relative(ctx.paths.repoRoot, dir), screenshots: n },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_index-data': async () =>
      Response.json(await api.buildIndexData(), { headers: { 'Cache-Control': 'no-store' } }),

    '/_system-data': async (req: Request) => {
      // DDR-048 — `?ds=<name>` scopes to one design system (per-DS tokens,
      // per-DS preview gallery). Omitted = legacy top-level scan for
      // backwards compat with single-DS projects.
      const dsName = new URL(req.url).searchParams.get('ds');
      const data = await api.buildSystemData(dsName);
      if (data === null) {
        return Response.json(
          { error: 'unknown design system', ds: dsName },
          { status: 404, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_comments-all': async () =>
      Response.json(await api.loadAllComments(), { headers: { 'Cache-Control': 'no-store' } }),

    '/_comments': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const file = new URL(req.url).searchParams.get('file');
      if (!file) return new Response('file query param required', { status: 400 });
      const comments = await api.loadCommentsForFile(file);
      return Response.json({ file, comments }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/canvas-meta': async (req: Request) => {
      // Phase 4 T5 — sibling `<canvas>.meta.json` read / merge.
      // GET ?file=<repo-relative-canvas-path>            → full meta or {}
      // PATCH (or POST) body { file, patch: {...} }      → shallow-merged meta
      const url = new URL(req.url);
      if (req.method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) return new Response('file query param required', { status: 400 });
        const meta = await api.loadCanvasMeta(file);
        return Response.json(meta ?? {}, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'PATCH' || req.method === 'POST') {
        const body = await readJson<{ file?: string; patch?: Record<string, unknown> }>(req);
        if (!body || typeof body.file !== 'string' || !body.file) {
          return new Response('body must include { file, patch }', { status: 400 });
        }
        if (!body.patch || typeof body.patch !== 'object') {
          return new Response('body.patch must be an object', { status: 400 });
        }
        // Cloud Phase 25 C2 — this route is on READ_ONLY_ALLOWED_WRITES for its
        // VIEWPORT lane only (per-user camera, split into `_canvas-state/` by
        // the api layer — DDR-115). The layout lane mutates the versioned
        // `.meta.json`, so a read-only session is refused here, in-handler,
        // where the two lanes are distinguishable.
        if (projectReadOnly(req) && 'layout' in body.patch) {
          return readOnlyRefusalResponse();
        }
        const next = await api.patchCanvasMeta(body.file, body.patch);
        if (!next) return new Response('Not found or rejected', { status: 404 });
        return Response.json(next, { headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_api/photo-edit': async (req: Request) => {
      // feature-photo-editor (Stage C, Task 8) — non-destructive PhotoEdit sidecar.
      //   GET ?asset=<sha8 | assets/<sha8>.<ext>>  → stored PhotoEdit or {}
      //   PUT/POST ?asset=<...> body { …PhotoEdit } → validated + persisted
      // CANVAS-SAFE (listed in BOTH CANVAS_SAFE_API below AND startCanvasServer's
      // `routes` map — Bun matches `routes` before `fetch`, so a one-list entry
      // 404s from the canvas iframe, the DDR-088 rollout bug). Reached from the
      // canvas origin by <PhotoLayer> (GET) and the headless bg-remove harness
      // (PUT), so NO sameOriginWrite (it would block the legit canvas origin);
      // the photo-store cap stack (sha8 validate + containment + validatePhotoEdit
      // + size cap) is the load-bearing mitigation. loopback-Host gates DNS-
      // rebinding on every method.
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const asset = new URL(req.url).searchParams.get('asset');
      if (req.method === 'GET') {
        const edit = await photoStore.getPhotoEdit(asset);
        return Response.json(edit ?? {}, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readJson<unknown>(req, PHOTO_EDIT_MAX_BYTES + 1024);
        if (body == null) return new Response('body required', { status: 400 });
        const result = await photoStore.savePhotoEdit(asset, body);
        if (!result.ok) {
          return Response.json(
            { ok: false, error: result.error },
            { status: result.status, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return Response.json(
          { ok: true, path: result.path, edit: result.edit },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_api/footage': async (req: Request) => {
      // feature-footage-analysis-director (Task 2) — FootageAnalysis + EDL sidecars.
      //   GET  ?asset=<sha8|assets/…>          → stored FootageAnalysis or {}
      //   GET  ?slug=<cut-slug>                → stored Edl or {}
      //   PUT/POST ?asset=<…> body {FootageAnalysis} → validated + persisted
      //   PUT/POST ?slug=<…>  body {Edl}             → validated + persisted
      // MAIN-ORIGIN ONLY (privileged — NOT in CANVAS_SAFE_API / startCanvasServer
      // routes): written by the footage-analyst / footage-director agents over
      // loopback, never the untrusted canvas iframe. A GET from the canvas origin
      // 403s at the gate (canvas-origin-gate.test.ts). loopback-Host gates
      // DNS-rebinding on every method; the footage-store cap stack (sha8/slug
      // validate + containment + validate{FootageAnalysis,Edl} + size cap) is the
      // load-bearing mitigation for the caller-derived write path.
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const params = new URL(req.url).searchParams;
      const asset = params.get('asset');
      const slug = params.get('slug');
      if (!asset && !slug) return new Response('asset or slug required', { status: 400 });
      const isEdl = !asset && !!slug;

      if (req.method === 'GET') {
        const data = isEdl
          ? await footageStore.getEdl(slug)
          : await footageStore.getAnalysis(asset);
        return Response.json(data ?? {}, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const body = await readJson<unknown>(req, FOOTAGE_MAX_BYTES + 1024);
        if (body == null) return new Response('body required', { status: 400 });
        const result = isEdl
          ? await footageStore.saveEdl(slug, body)
          : await footageStore.saveAnalysis(asset, body);
        if (!result.ok) {
          return Response.json(
            { ok: false, error: result.error },
            { status: result.status, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        // Spread FIRST: `result` carries its own `ok`, so the old ordering made
        // the literal dead. Same value either way (this branch is past the
        // `!result.ok` return), but the guarantee now reads as one.
        return Response.json({ ...result, ok: true }, { headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_api/canvas-source': async (req: Request) => {
      // DDR-148 — read-only raw .tsx source for the Timeline panel's sequence/
      // keyframe parser. GET ?file=<canvas rel or slug> → { source }.
      // MAIN-ORIGIN ONLY: intentionally absent from CANVAS_SAFE_API +
      // startCanvasServer's routes (dual-allowlist, DDR-054) — the untrusted
      // canvas iframe must never read arbitrary project source. Containment via
      // api.loadCanvasSource → resolveCanvasAbs (stays under designRoot).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // DNS-rebinding guard — a GET read of project source is CORS-readable once
      // a rebound page shares this origin; the dev-server always binds 127.0.0.1,
      // so a real browser (Host: localhost:<port>) passes and only a rebound
      // foreign hostname 403s. (No sameOriginWrite here — GET.)
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const file = new URL(req.url).searchParams.get('file');
      const r = await api.loadCanvasSource(file);
      if (!r.ok) {
        return Response.json(
          { ok: false, error: r.error },
          { status: r.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, source: r.source },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/git-committers': async (req: Request) => {
      // Phase 6 — feed for the @mention autocomplete in composer + reply box.
      // GET → top-20 committers on HEAD (`git shortlog -sne | head -20`)
      // already cached server-side for 60 s.
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const committers = await api.gitCommitters();
      return Response.json({ committers }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/git-user': async (req: Request) => {
      // Phase 8 — local `git config user.name` for the collab Awareness peer
      // identity. Color-hash derives from this; falls back to anonymous-<pid>
      // client-side when empty.
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // Cloud Phase 27 — IN A CELL, `git config user.name` IS THE MACHINE.
      //
      // It is "Maude Workspace", the committer the autosave agent signs with
      // (sync/autocommit.ts), and it is the right answer for a commit and the
      // wrong one for a person: a member opened their project and the presence
      // chip introduced them as the server. The proxy already vouches who this
      // is per request, so in a cell that is who it is.
      const vouched = req.headers.get('x-maude-user');
      if (isWorkspaceMode() && vouched) {
        return Response.json({ name: vouched }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const name = await api.gitCurrentUser();
      return Response.json({ name }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/ai': async (req: Request) => {
      // Phase 8 Task 4 — read-only snapshot of the current AI activity map.
      // GET → { entries: [{ file, author, startedAt, lastHeartbeat }, …] }
      // Clients use this on mount to backfill the banner state without
      // waiting for the next bus event.
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return Response.json({ entries: ai.list() }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/ai/start': async (req: Request) => {
      // Phase 8 Task 4 — `/design:edit` (or any external slash command driving
      // Claude work) POSTs here when work begins. body = { file, author }.
      // Replaces any prior entry for the file.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // CSRF guard: phase-30 bridges ai-activity onto room awareness, which
      // crosses the hub — a forged cross-origin POST would inject a fake
      // "<x> is editing <file>" presence to every connected peer. The loopback
      // slash-command driver omits Origin (→ allowed); a browser drive-by can't.
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ file?: string; author?: string }>(req);
      if (!body || typeof body.file !== 'string' || !body.file.trim()) {
        return new Response('body.file required', { status: 400 });
      }
      const author =
        typeof body.author === 'string' && body.author.trim()
          ? body.author.trim().slice(0, 120)
          : 'Claude';
      const entry = ai.start(body.file.trim(), author);
      // T16 — the edit is ONE project action: what the agent writes until
      // /end is published together (or held, if it fails).
      const name = body.file.trim().split('/').pop()?.replace(/\.(tsx|html)$/i, '') ?? 'canvas';
      ctx.syncControl?.current?.()?.beginAiAction?.(`edit:${body.file.trim()}`, `${author} edited ${name}`);
      return Response.json(entry, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/ai/heartbeat': async (req: Request) => {
      // Refresh the lastHeartbeat. Returns 404 if no entry — slash command
      // can treat that as "the server bounced; re-issue /start".
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ file?: string }>(req);
      if (!body || typeof body.file !== 'string' || !body.file.trim()) {
        return new Response('body.file required', { status: 400 });
      }
      const entry = ai.heartbeat(body.file.trim());
      if (!entry) return new Response('no active entry', { status: 404 });
      return Response.json(entry, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/ai/end': async (req: Request) => {
      // Explicit completion (normal or error). Banner clears immediately.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ file?: string; outcome?: string }>(req);
      if (!body || typeof body.file !== 'string' || !body.file.trim()) {
        return new Response('body.file required', { status: 400 });
      }
      // T16 — close the action BEFORE the banner clears: `done` publishes
      // what the agent wrote as one action, `failed` keeps it unpublished for
      // the person's decision. (No outcome = done, the pre-T16 contract.)
      const action = await ctx.syncControl
        ?.current?.()
        ?.endAiAction?.(`edit:${body.file.trim()}`, body.outcome === 'failed' ? 'failed' : 'done')
        .catch(() => null);
      const cleared = ai.end(body.file.trim());
      return Response.json(
        { cleared, ...(action ? { action } : {}) },
        { status: cleared ? 200 : 404, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/sync/offline': async (req: Request) => {
      // T19 — "Download everything for offline": every file of the project
      // now, instead of as the passes get to it.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req)) return new Response('local request required', { status: 403 });
      const r = await ctx.syncControl?.current?.()?.prepareOffline?.();
      if (!r) return Response.json({ ok: false, error: 'This project has no files to download.' }, { status: 409 });
      return Response.json({ ok: true, ...r }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/project/conflict': async (req: Request) => {
      // T28 — a held source conflict: GET the two sides, POST the decision.
      if (!isTrustedRequestHost(req)) return new Response('local request required', { status: 403 });
      const runtime = ctx.syncControl?.current?.();
      if (req.method === 'GET') {
        const file = new URL(req.url).searchParams.get('file') ?? '';
        const sides = runtime?.conflictVersions?.(file);
        if (!sides) return Response.json({ ok: false, error: 'No conflict on that canvas.' }, { status: 404 });
        return Response.json({ ok: true, ...sides }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ file?: string; choice?: string }>(req);
      const choice = body?.choice === 'mine' ? 'mine' : body?.choice === 'theirs' ? 'theirs' : null;
      if (!body?.file || !choice) return Response.json({ ok: false, error: 'file and choice required' }, { status: 400 });
      const r = await runtime?.resolveConflict?.(body.file, choice);
      if (!r) return Response.json({ ok: false, error: 'No conflict on that canvas.' }, { status: 404 });
      return Response.json({ ok: r.status !== 'rejected', ...r }, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/project/ai-action': async (req: Request) => {
      // T16 — the person's decision on an unfinished AI edit (held stage).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req)) return new Response('local request required', { status: 403 });
      const body = await readJson<{ choice?: string }>(req);
      const choice = body?.choice === 'discard' ? 'discard' : body?.choice === 'publish' ? 'publish' : null;
      if (!choice) return Response.json({ ok: false, error: 'choice must be publish or discard' }, { status: 400 });
      const r = await ctx.syncControl?.current?.()?.resolveAiAction?.(choice);
      if (!r) return Response.json({ ok: false, error: 'There is no unfinished AI edit.' }, { status: 409 });
      return Response.json(
        { ok: r.status !== 'rejected', ...r },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/annotations': async (req: Request) => {
      // Phase 5 — `<designRoot>/<slug>.annotations.svg` read / overwrite.
      // GET ?file=<repo-relative-canvas-path>           → SVG text (empty if absent)
      // PUT body { file, svg }                          → 204 on write, 4xx otherwise
      const url = new URL(req.url);
      if (req.method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) return new Response('file query param required', { status: 400 });
        const svg = await api.loadAnnotations(file);
        return new Response(svg ?? '', {
          status: 200,
          headers: {
            'Content-Type': 'image/svg+xml; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        // `base` (optional) is the SVG this edit was derived from — the hub
        // merges a concurrent peer's strokes from it (accepted revisions).
        const body = await readJson<{
          file?: string;
          svg?: string;
          writeId?: unknown;
          base?: unknown;
        }>(req, 2 * 1024 * 1024 + 2048);
        if (!body || typeof body.file !== 'string' || !body.file) {
          return new Response('body must include { file, svg }', { status: 400 });
        }
        if (typeof body.svg !== 'string') {
          return new Response('body.svg must be a string', { status: 400 });
        }
        if (body.writeId !== undefined && !validAnnotationWriteId(body.writeId)) {
          return new Response('invalid annotation writeId', { status: 400 });
        }
        if (body.base !== undefined && typeof body.base !== 'string') {
          return new Response('body.base must be a string', { status: 400 });
        }
        const ok = await api.saveAnnotations(
          body.file,
          body.svg,
          body.writeId as string | undefined,
          body.base as string | undefined
        );
        if (!ok) return new Response('rejected', { status: 400 });
        return new Response(null, { status: 204 });
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_api/canvas': async (req: Request) => {
      // Phase 22 — create + soft-delete a canvas from the browser file tree.
      // POST   body { name, kind?: "brief-board", group? } → 201 { file, rel, slug }
      // DELETE ?file=<rel>                                 → 200 { rel, slug, trashed[] }
      // MAIN ORIGIN ONLY: this route is intentionally absent from
      // startCanvasServer's allowlist (DDR-054) — the untrusted canvas iframe
      // origin must never reach a file-write/-delete endpoint. Validation lives in
      // api.createCanvas / api.deleteCanvas (containment + group allowlist).
      // DDR-150 P4 Task 12 — this route creates/deletes source `.tsx` (the
      // video-comp assemble writes real comp source), so it's CSRF-gated like the
      // other source-write routes: a cross-origin top-level page is rejected (the
      // DDR-054 split only blocks the canvas iframe). No-Origin (curl/tests) + the
      // same-origin shell pass. Closes a pre-existing gap on create/delete.
      if (req.method === 'DELETE' || req.method === 'POST') {
        if (!sameOriginWrite(req))
          return new Response('cross-origin write rejected', { status: 403 });
        if (!isTrustedRequestHost(req))
          return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      }
      if (req.method === 'DELETE') {
        const file = new URL(req.url).searchParams.get('file');
        const result = await api.deleteCanvas({ file });
        if (!result.ok) {
          return Response.json(
            { ok: false, error: result.error },
            { status: result.status, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        return Response.json(
          {
            ok: true,
            rel: result.rel,
            slug: result.slug,
            trashed: result.trashed,
            trashDir: result.trashDir,
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const body = await readJson<{
        name?: unknown;
        kind?: unknown;
        group?: unknown;
        clips?: unknown;
        fps?: unknown;
        width?: unknown;
        height?: unknown;
      }>(
        req,
        // DDR-150 P4 Task 12 — a video-comp assemble carries a clips[] array;
        // widen the read cap accordingly (still bounded well under abuse).
        64 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const duplicateOf = (body as { duplicateOf?: unknown }).duplicateOf;
      const result =
        duplicateOf !== undefined
          ? await api.duplicateCanvas({ file: duplicateOf })
          : await api.createCanvas(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, file: result.file, rel: result.rel, slug: result.slug },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-file-tree-drag-drop-folders (Task 5) — move/rename a canvas.
    // POST body { file, toDir } -> 200 { fromRel, toRel, fromSlug, toSlug, moved[] }
    // Same guard stack as /_api/canvas, copied verbatim: MAIN ORIGIN ONLY —
    // intentionally absent from BOTH startCanvasServer's allowlist and
    // CANVAS_SAFE_API (DDR-054/DDR-088) — the untrusted canvas iframe origin
    // must never reach a file-move endpoint. Validation lives in
    // api.moveCanvas (containment + non-DS-group allowlist + collision +
    // collab-pin guard).
    '/_api/fs-move': async (req: Request) => {
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const body = await readJson<{ file?: unknown; toDir?: unknown; toName?: unknown }>(
        req,
        4 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.moveCanvas(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      // WHO moved this file. A move is the one file-tree op that can make a
      // canvas seem to vanish, and the receiving side's log only ever names the
      // retirement — never the request that caused it. The caller (browser
      // webview vs. a script) is the fact that separates "the sync runtime did
      // something" from "someone asked for this".
      // SCRUBBED, ALL THREE VALUES. The User-Agent is caller-controlled and this
      // line's whole job is answering "who moved this canvas" — an unscrubbed
      // one lets a caller forge a second, convincing `[fs-move]` line and defeat
      // the record at exactly its own purpose (ANSI/ESC survives even where a
      // header parser rejects CR/LF). `fromRel`/`toRel` are CONTAINED but not
      // renderable: `moveCanvas` checks traversal and group membership, never
      // control characters.
      console.log(
        `[fs-move] ${sanitizeForLog(result.fromRel)} → ${sanitizeForLog(result.toRel)} ` +
          `(ua=${sanitizeForLog(req.headers.get('user-agent') || 'none').slice(0, 60)})`
      );
      return Response.json(
        {
          ok: true,
          fromRel: result.fromRel,
          toRel: result.toRel,
          fromSlug: result.fromSlug,
          toSlug: result.toSlug,
          moved: result.moved,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-file-tree-drag-drop-folders (Task 5) — create an empty folder.
    // POST body { parent?, name } -> 201 { dir }. Same guard stack, same
    // MAIN-ORIGIN-ONLY / dual-allowlist posture as /_api/fs-move above.
    '/_api/fs-mkdir': async (req: Request) => {
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const body = await readJson<{ parent?: unknown; name?: unknown }>(req, 4 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.createFolder(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, dir: result.dir },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // ── Phase 27 (E2) — in-UI git layer. Save version / Publish / Get latest /
    // History / visual diff. All MAIN-ORIGIN ONLY (see gitApi comment above).
    // POST routes add the sameOriginWrite CSRF guard (cross-site forged POST);
    // the token-bearing publish/get-latest routes add a loopback Host check so a
    // request carrying a GitHub token can only originate on this machine.
    '/_api/git/status': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // Local status only — fast, no network, no credentials. The remote
      // ahead/behind probe (the "Get latest" nudge) needs a token, which a GET
      // query string must NOT carry (it leaks via logs / Referer / history —
      // security review A3). That probe lands in phase-28 over the server-held
      // keychain token (server-side, never client-supplied), not here.
      const checkRemote = new URL(req.url).searchParams.get('remote') === '1';
      return gitJson(await gitApi.status({ checkRemote }));
    },

    '/_api/git/log': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // Optional `?path=` scopes History to one canvas (phase-27.1). MAIN-ORIGIN
      // ONLY (this route is absent from CANVAS_SAFE_API) — the path is
      // containment-validated in the endpoint before it reaches git.
      const u = new URL(req.url).searchParams;
      return gitJson(await gitApi.log(u.get('limit'), u.get('path')));
    },

    '/_api/git/diff': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return gitJson(await gitApi.diff(new URL(req.url).searchParams.get('sha')));
    },

    // ── Phase 29 (E4) — drafts (branches). MAIN-ORIGIN ONLY (absent from
    // CANVAS_SAFE_API + startCanvasServer routes); branch + checkout are POST/CSRF-
    // gated source mutations. Switching a draft moves HEAD, which the git-lifecycle
    // watcher turns into a Yjs flush + reload (DDR-051) — no logic duplicated here.
    '/_api/git/branches': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      return gitJson(await gitApi.branches());
    },

    '/_api/git/branch': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.createBranch(body));
    },

    '/_api/git/checkout': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.checkout(body));
    },

    // "Add this draft to the Shared version" — merges + PUBLISHES, so it is token-
    // bearing: same main-origin + loopback gate as /_api/git/push.
    '/_api/git/fold': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('adding a draft requires a local request', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.fold(body));
    },

    // "Refresh drafts" — token-bearing fetch (all remote heads) so a teammate's
    // new draft surfaces. Same main-origin + loopback gate as /_api/git/pull.
    '/_api/git/fetch': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('refresh requires a local request', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.fetchRemote(body));
    },

    '/_api/git/commit': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<unknown>(req, 256 * 1024);
      return gitJson(await gitApi.commit(body));
    },

    '/_api/git/discard': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<unknown>(req, 256 * 1024);
      return gitJson(await gitApi.discard(body));
    },

    '/_api/git/push': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      // Token-bearing: refuse anything not from a loopback Host (the server binds
      // 127.0.0.1, so this is belt-and-suspenders against a forwarded/rebound Host).
      if (!isTrustedRequestHost(req))
        return new Response('publish requires a local request', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.push(body));
    },

    '/_api/git/pull': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('get latest requires a local request', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.pull(body));
    },

    // Finish a Get-latest merge that hit a conflict (DiffView "Keep mine/theirs/
    // both"). Token-bearing (server-held; resolve completes the two-parent merge
    // commit) → same main-origin + loopback gate as pull. MAIN-ORIGIN ONLY:
    // absent from CANVAS_SAFE_API + startCanvasServer routes (dual-allowlist).
    '/_api/git/resolve': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('resolve requires a local request', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await gitApi.resolve(body));
    },

    // ── Phase 28 (E3) — GitHub identity & remote. Sign-in/out + keychain live in
    // the Tauri shell (oauth.rs/keychain.rs commands); these endpoints use the
    // server-held token (loopback bridge → token.ts) for the REST calls. MAIN-ORIGIN
    // ONLY (absent from CANVAS_SAFE_API + startCanvasServer) and loopback-Host gated
    // since every one is token-bearing. (Sign-out is the `github_sign_out` Tauri
    // command — the dev-server can't touch the OS keychain — so there is no
    // DELETE /_api/github/identity here; see DDR-114.)
    '/_api/cloud/status': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // isLoopbackHost is a DNS-rebind guard, not a CSRF guard: a cross-site
      // page can issue a no-cors GET at 127.0.0.1:<port>. These two GETs read
      // the cloud credential's identity and (for projects) make a Bearer call
      // whose 401 DELETES the stored credential — a confused deputy worth
      // closing (validate 2026-07-30, defender F6).
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(cloudApi.status());
    },
    '/_api/cloud/signin/start': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await cloudApi.signinStart());
    },
    '/_api/cloud/signin/poll': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = (await req.json().catch(() => ({}))) as { deviceCode?: string };
      return gitJson(await cloudApi.signinPoll(String(body.deviceCode ?? '')));
    },
    '/_api/cloud/signout': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(cloudApi.signout());
    },
    // feature-cloud-managed-git-posture — the history the cell is actually
    // writing. MAIN-ORIGIN ONLY (absent from CANVAS_SAFE_API + startCanvasServer
    // routes, DDR-088): the request is proxied onward under the stored hub
    // credential, which is exactly the shape the untrusted canvas origin must
    // never reach. `sameOriginRead` is the CSRF guard, `isTrustedRequestHost`
    // the DNS-rebind one — both mandatory on a token-bearing route.
    //
    // A hub 401 here is a plain read failure. It must NOT take the
    // `/_api/cloud/status` path that deletes the stored credential (F6): a cell
    // restarting mid-renewal would otherwise silently unlink a working project
    // because History polled at the wrong second.
    '/_api/cloud/history': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const u = new URL(req.url).searchParams;
      return gitJson(await cloudApi.history(u.get('path'), u.get('limit')));
    },
    '/_api/cloud/projects': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await cloudApi.projects());
    },
    '/_api/cloud/attach': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = (await req.json().catch(() => ({}))) as { project?: string };
      return gitJson(await cloudApi.attach(String(body.project ?? '')));
    },
    '/_api/cloud/attach/code': async (req: Request) => {
      // The maude:// lane (Phase 17): a one-time handoff code from a deep
      // link. Same gates as attach; the code is exchanged only against the
      // CONFIGURED cloud address, never one the link named.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = (await req.json().catch(() => ({}))) as { code?: string; project?: string };
      return gitJson(
        await cloudApi.attachCode(
          String(body.code ?? ''),
          typeof body.project === 'string' ? body.project : undefined
        )
      );
    },
    '/_api/cloud/detach': async (req: Request) => {
      // The in-app `maude design unlink` (fix 7, sync RCA 2026-08-10). Same
      // gates as attach; MAIN ORIGIN ONLY (absent from CANVAS_SAFE_API +
      // startCanvasServer routes — it rewrites config.json and drops a stored
      // credential).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await cloudApi.detach());
    },

    // ── Resync (feature-sync-resync-and-out-of-process-sweep) ───────────────
    // MAIN-ORIGIN ONLY: absent from BOTH CANVAS_SAFE_API and startCanvasServer's
    // `routes` map (DDR-088's two-allowlist rule). Canvas content is untrusted
    // (DDR-054) and must not be able to command the desktop to re-push a whole
    // project — a canvas that could would be an amplification primitive against
    // the person's own hub, and a way to spend their rate-limit budget.
    // ACCEPTED REVISIONS — the project's logical history (DDR-241, T27/T28).
    // Main origin only: history names people, restore and undo are writes.
    '/_api/project/history': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req)) return new Response('Forbidden', { status: 403 });
      const url = new URL(req.url);
      const runtime = ctx.syncControl?.current?.();
      const rows = runtime?.acceptedHistory
        ? await runtime
            .acceptedHistory({
              limit: Number(url.searchParams.get('limit') ?? 50) || 50,
              before: Number(url.searchParams.get('before') ?? 0) || null,
              path: url.searchParams.get('path'),
            })
            .catch(() => undefined)
        : null;
      if (rows === undefined) {
        return gitJson({ status: 200, json: { ok: false, reason: 'unreachable' } });
      }
      if (rows === null) return gitJson({ status: 200, json: { ok: false, reason: 'legacy' } });
      return gitJson({ status: 200, json: { ok: true, history: rows } });
    },
    '/_api/project/restore': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req) || !isTrustedRequestHost(req))
        return new Response('Forbidden', { status: 403 });
      const body = await readJson<{ path?: unknown; revision?: unknown }>(req, 4096);
      const revision = Number(body?.revision);
      if (typeof body?.path !== 'string' || !Number.isSafeInteger(revision) || revision < 0) {
        return new Response('body must include { path, revision }', { status: 400 });
      }
      const r = await ctx.syncControl?.current?.()?.acceptedRestore?.(body.path, revision);
      if (!r) return gitJson({ status: 200, json: { ok: false, reason: 'legacy' } });
      return gitJson({
        status: r.status === 'accepted' ? 200 : 409,
        json: { ok: r.status === 'accepted', ...r },
      });
    },
    '/_api/project/undo': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req) || !isTrustedRequestHost(req))
        return new Response('Forbidden', { status: 403 });
      const body = await readJson<{ actionId?: unknown; redo?: unknown }>(req, 4096);
      if (typeof body?.actionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.actionId)) {
        return new Response('body must include { actionId }', { status: 400 });
      }
      const r = await ctx.syncControl
        ?.current?.()
        ?.acceptedUndo?.(body.actionId, body.redo === true);
      if (!r) return gitJson({ status: 200, json: { ok: false, reason: 'legacy' } });
      return gitJson({
        status: r.status === 'accepted' ? 200 : 409,
        json: { ok: r.status === 'accepted', ...r },
      });
    },
    '/_api/sync/resync': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // REFUSALS ANSWER IN JSON, WITH A REASON.
      //
      // These were plain-text 403s, so the panel — which reads `json.detail` and
      // falls back to a fixed string — rendered every one of them as "Resync
      // could not start.", a sentence naming no cause and offering no next step.
      // A person hitting the gate legitimately (a canvas iframe, a stale tab,
      // the wrong host) got the same six words as a person hitting a bug, and
      // neither could tell which they had. The GATES are unchanged: what a
      // refusal SAYS is not a security property, and saying nothing was never
      // protecting anything.
      if (!sameOriginWrite(req)) return syncRefusal('cross-origin', 'Resync must be started');
      if (!isTrustedRequestHost(req))
        return syncRefusal('untrusted-host', 'Resync must be started');
      const control = ctx.syncControl;
      if (!control) {
        return gitJson({
          status: 200,
          json: { ok: false, reason: 'no-supervisor', detail: 'Restart Maude to start syncing.' },
        });
      }
      // REFUSED, not queued — see `SyncSupervisor.busy`. A second press must
      // not buy a second full re-link of every canvas.
      if (control.busy?.()) {
        return gitJson({
          status: 409,
          json: { ok: false, reason: 'busy', detail: 'Syncing is already restarting.' },
        });
      }
      // No argument: KEEP the configured hub. Only an explicit `null` unlinks,
      // and this route must never be able to.
      const sync = await control.restart();
      return gitJson({ status: 200, json: { ok: true, sync } });
    },

    // feature-before-first-external-users Task 2 — the three user-facing sync
    // toggles (syncFiles / propagateDeletes / resolveFirstAnchor), so the
    // breaker remediation stops meaning "edit JSON by hand" (DDR-177: the
    // target user has no terminal). MAIN-ORIGIN ONLY: absent from BOTH
    // CANVAS_SAFE_API and startCanvasServer's `routes` map (DDR-088) —
    // untrusted canvas content must not be able to turn delete-propagation on
    // or resolve a first-anchor hold against the user.
    '/_api/sync/settings': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(
          { settings: readSyncSettings(ctx.paths.repoRoot) },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return syncRefusal('cross-origin', 'Settings must be changed');
      const body = await readJson<{
        syncFiles?: unknown;
        propagateDeletes?: unknown;
        resolveFirstAnchor?: unknown;
      }>(req, 4 * 1024);
      const patch: Record<string, unknown> = {};
      if ('syncFiles' in (body ?? {})) {
        if (typeof body?.syncFiles !== 'boolean')
          return new Response('syncFiles must be a boolean', { status: 400 });
        patch.syncFiles = body.syncFiles;
      }
      if ('propagateDeletes' in (body ?? {})) {
        if (typeof body?.propagateDeletes !== 'boolean')
          return new Response('propagateDeletes must be a boolean', { status: 400 });
        patch.propagateDeletes = body.propagateDeletes;
      }
      if ('resolveFirstAnchor' in (body ?? {})) {
        if (!isFirstAnchorMode(body?.resolveFirstAnchor))
          return new Response('resolveFirstAnchor must be ask|keep-local|keep-cloud', {
            status: 400,
          });
        patch.resolveFirstAnchor = body.resolveFirstAnchor;
      }
      if (Object.keys(patch).length === 0)
        return new Response('nothing to change', { status: 400 });
      try {
        const settings = await writeSyncSettings(ctx.paths.repoRoot, patch);
        reloadConfig(ctx);
        // The toggles apply at sync boot, so a saved change asks the
        // supervisor for a restart — same refusal semantics as Resync: when a
        // cycle is already running the setting is SAVED and applies on the
        // next restart, and the response says which of the two happened.
        let applied = false;
        const control = ctx.syncControl;
        if (control && !control.busy?.()) {
          await control.restart();
          applied = true;
        }
        return Response.json(
          { ok: true, settings, applied },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        return gitJson({
          status: 400,
          json: {
            ok: false,
            detail: err instanceof Error ? err.message : 'settings write failed',
          },
        });
      }
    },

    // feature-before-first-external-users Task 2 — ownership (repo-owned vs
    // hub-owned) from the UI. `maude design adopt`/`detach` were CLI-only,
    // against DDR-177's own posture (the target user never opens a terminal),
    // and B11 flagged settleOwnership mutating `.gitignore`/index without
    // asking in non-TTY — here the dialog IS the asking: this route only ever
    // acts on an explicit user click. MAIN-ORIGIN ONLY, both allowlists absent
    // (it mutates `.gitignore` + the git index and can drop the hub link).
    //
    // Imports cli/lib/design-ownership.mjs DIRECTLY — deliberately not the
    // hubs-config.ts read-only-mirror pattern: these are MUTATIONS with safety
    // rules (narrow staging, refuse-on-malformed-gitignore, --cached only),
    // and two owners of that logic would drift exactly where drift is loss.
    // Both trees ship together (npm `files`, desktop resources), so the
    // relative import resolves in every install shape.
    '/_api/sync/ownership': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const linked = !!ctx.cfg.linkedHub?.url;
      if (req.method === 'GET') {
        const st = ownershipState(ctx.paths.repoRoot, { linked });
        return Response.json(
          {
            mode: st.mode,
            git: st.git,
            trackedCount: st.trackedCount,
            linked,
            hubUrl: ctx.cfg.linkedHub?.url ?? null,
            syncthingRoot: st.syncthingRoot ?? null,
            ...(st.stignoreLine ? { stignoreLine: st.stignoreLine } : {}),
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return syncRefusal('cross-origin', 'Ownership must be changed');
      const body = await readJson<{ action?: unknown }>(req, 4 * 1024);
      const action = body?.action;
      try {
        if (action === 'adopt') {
          // A → B: gitignore the design root, untrack (--cached — every byte
          // stays on disk). Only meaningful while linked: with no hub there
          // would be no owner left at all.
          if (!linked)
            return gitJson({
              status: 400,
              json: { ok: false, detail: 'Link a workspace first — adopt hands .design/ to it.' },
            });
          const res = adoptToHub(ctx.paths.repoRoot);
          if (res.action === 'refused-malformed')
            return gitJson({
              status: 409,
              json: {
                ok: false,
                detail:
                  '.gitignore carries an ownership block Maude did not write — fix it by hand, then retry.',
              },
            });
          return gitJson({ status: 200, json: { ok: true, ...res } });
        }
        if (action === 'detach') {
          // B → A: unlink (same path as the Cloud detach — credential dropped,
          // sync stopped NOW) and un-ignore so the person can commit again.
          // detachToRepo deliberately does NOT commit or `git add .design` —
          // what to commit and when stays theirs.
          const unlink = await cloudApi.detach();
          const res = detachToRepo(ctx.paths.repoRoot);
          if (res.action === 'refused-malformed')
            return gitJson({
              status: 409,
              json: {
                ok: false,
                detail:
                  'Unlinked, but .gitignore carries an ownership block Maude did not write — remove it by hand to finish.',
              },
            });
          return gitJson({
            status: 200,
            json: {
              ok: true,
              unlinked: (unlink.json as { detached?: boolean } | undefined)?.detached ?? false,
              ...res,
            },
          });
        }
        return new Response('action must be adopt|detach', { status: 400 });
      } catch (err) {
        return gitJson({
          status: 500,
          json: {
            ok: false,
            detail: err instanceof Error ? err.message : 'ownership change failed',
          },
        });
      }
    },

    // feature-before-first-external-users Task 3 (F-6) — `_trash/` becomes
    // discoverable, restorable and prunable. MAIN-ORIGIN ONLY, both DDR-088
    // allowlists absent: restore MOVES files into the live project and prune
    // DELETES quarantined copies — from the canvas origin either would let
    // untrusted content resurrect or destroy parked user work.
    '/_api/sync/trash': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        const entries = listTrash(ctx.paths.designRoot);
        const bytes = entries.reduce((n, e) => n + e.size, 0);
        return Response.json(
          // Cap the wire size; totals stay exact so the panel never lies.
          { entries: entries.slice(0, 500), total: entries.length, bytes },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return syncRefusal('cross-origin', 'Trash actions must be started');
      const body = await readJson<{
        action?: unknown;
        trashRel?: unknown;
        olderThanDays?: unknown;
      }>(req, 8 * 1024);
      if (body?.action === 'restore') {
        if (typeof body.trashRel !== 'string')
          return new Response('trashRel must be a string', { status: 400 });
        const res = restoreFromTrash(ctx.paths.designRoot, body.trashRel);
        return gitJson({ status: res.ok ? 200 : 400, json: res });
      }
      if (body?.action === 'prune') {
        const days = body.olderThanDays === undefined ? 30 : Number(body.olderThanDays);
        // ≥ 1 day: a 0-day prune is "empty the trash", which deserves its own
        // deliberate gesture, not a slider slipped to zero.
        if (!Number.isFinite(days) || days < 1)
          return new Response('olderThanDays must be a number ≥ 1', { status: 400 });
        const res = pruneTrash(ctx.paths.designRoot, days);
        return gitJson({ status: 200, json: { ok: true, ...res } });
      }
      return new Response('action must be restore|prune', { status: 400 });
    },

    '/_api/sync/cancel-assets': async (req: Request) => {
      // Cancel is scoped to the ASSET SWEEP: killing a reconnect mid-handshake
      // is not a meaningful gesture, killing a multi-hundred-megabyte upload
      // is. Safe by construction — uploads are idempotent and the hub writes
      // temp-then-rename, so no half-written asset can survive this.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return syncRefusal('cross-origin', 'Cancelling must be started');
      if (!isTrustedRequestHost(req))
        return syncRefusal('untrusted-host', 'Cancelling must be started');
      const cancelled = ctx.syncControl?.current?.()?.cancelAssetSweep() ?? false;
      return gitJson({ status: 200, json: { ok: true, cancelled } });
    },

    '/_api/github/identity': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await githubApi.identity());
    },

    '/_api/github/repos': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await githubApi.repos());
    },

    '/_api/github/create-repo': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.createRepo(body));
    },

    '/_api/github/invite': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.invite(body));
    },

    '/_api/github/clone': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.clone(body));
    },

    // ── Figma import (DDR-216 D2/D3) ────────────────────────────────────────
    // MAIN-ORIGIN ONLY: absent from BOTH CANVAS_SAFE_API and startCanvasServer's
    // `routes` map, so the untrusted canvas origin cannot reach them at all —
    // a canvas-reachable Figma route would be a token-exfiltration primitive AND
    // an SSRF primitive at once.
    //
    // Allowlist-omission alone proves the WRONG property, though: the main origin
    // is reachable from any website the user happens to visit while the server is
    // up. Without the two gates below, a CORS-simple POST from evil.example would
    // plant an attacker's PAT (`connect`) or spend the user's on an attacker-chosen
    // file key (`probe`) — opaque response, real side effect. So all three carry
    // `isTrustedRequestHost` + `sameOriginWrite` + a body cap, and `probe` counts
    // as a WRITE for gating purposes even though it stores nothing: it spends the
    // credential and reaches the network. (DDR-216 D3, Round-1 security finding.)
    '/_api/figma/status': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // `sameOriginRead`, not just `sameOriginWrite`: this is a GET, and browsers
      // do NOT reliably stamp `Origin` on a simple cross-origin GET — so the
      // write-side guard cannot see this one coming. Without it, any page the
      // user visits can probe whether they have Figma connected (a small but
      // real cross-site state leak, and the same shape as the Task-2.5
      // audio-search F1 finding this helper was added for).
      if (!sameOriginRead(req)) return new Response('cross-origin read rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(figmaApi.status());
    },

    '/_api/figma/connect': async (req: Request) => {
      if (req.method !== 'POST' && req.method !== 'DELETE')
        return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      if (req.method === 'DELETE') return gitJson(figmaApi.disconnect());
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(figmaApi.connect(body));
    },

    '/_api/figma/probe': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      return gitJson(await figmaApi.probe());
    },

    // Runs an import. Same triple gate as the other three, and for the same
    // reasons — it spends the PAT, it reaches the network, and it writes into
    // the design root. The body is validated into a fixed {mode, url, dryRun}
    // shape; a caller never gets to choose an output path.
    '/_api/figma/import': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await figmaApi.runImport(body));
    },

    // `--explode` — one artboard, via the LOCAL Dev Mode MCP (DDR-219 D2).
    //
    // Same triple gate, and it needs it more than the others: this route reaches
    // an unauthenticated loopback service that reads whatever Figma document the
    // user has open, and then WRITES into the design root. A canvas-reachable
    // version of it would hand the untrusted iframe (DDR-054) a primitive that
    // reads the user's open design — so it is in NEITHER canvas allowlist, the
    // same standing rule DDR-088 sets for every privileged route, asserted in
    // `test/canvas-origin-gate.test.ts` and by the grep test in
    // `cli/lib/figma-codegen-reachability.test.mjs`.
    '/_api/figma/explode': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await figmaApi.explode(body));
    },

    '/_api/github/create-project': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.createProject(body));
    },

    // Create a NEW *local-only* project: mkdir + git init + .design scaffold, NO
    // GitHub / no token (the "just local git, no remote" path). Same main-origin +
    // loopback + POST CSRF gate as create-project, and MAIN-ORIGIN ONLY — absent
    // from CANVAS_SAFE_API + startCanvasServer routes (dual-allowlist), so the
    // untrusted canvas iframe can't drive disk writes.
    '/_api/project/create-local': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.createLocalProject(body));
    },

    // Scaffold a bootable .design/ into an existing folder (the "open a non-Maude
    // repo → set it up?" fallback). No token / no GitHub — local FS only, but still
    // main-origin + loopback gated (it writes to disk).
    '/_api/design/init': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await githubApi.initDesign(body));
    },

    // Phase 29 (E4) Door C — connect to a team hub: validate + probe + save the hub
    // credential to the global ~/.config/maude/hubs.json (sync/hub-link.ts). MAIN
    // ORIGIN ONLY (omitted from CANVAS_SAFE_API + startCanvasServer routes) + loopback
    // + POST CSRF, mirroring /_api/github/*. The lean in-app counterpart to the CLI
    // `maude design link`; the in-UI Connect is the explicit trust grant (DDR-054 F2).
    '/_api/hub/link': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      return gitJson(await linkHub(body));
    },

    // Cloud Phase 3 Task 3 — "Sign in to workspace". The person-facing
    // counterpart to /_api/hub/link: an address plus an email and password,
    // rather than a token to paste. Same gates as the link route (MAIN ORIGIN
    // only, loopback, POST CSRF) for the same reason — this handler receives a
    // PASSWORD, so the untrusted canvas origin must never be able to reach it.
    // MANAGED PROJECTS (T21/T22): sign in / open, store the credential and
    // describe the project, so the native shell can create its own copy.
    // Main origin only — this mints and stores a credential.
    '/_api/projects/prepare': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req)) return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req)) return new Response('local request required', { status: 403 });
      const body = (await readJson<Record<string, unknown>>(req, 8 * 1024)) ?? {};
      const kind = body.kind;
      const str = (v: unknown) => (typeof v === 'string' ? v : '');
      const input =
        kind === 'cloud'
          ? { kind, projectId: str(body.projectId) }
          : kind === 'handoff'
            ? { kind, code: str(body.code), claimedProject: str(body.claimedProject) || undefined }
            : kind === 'hub'
              ? { kind, url: str(body.url), email: str(body.email), password: str(body.password) }
              : kind === 'known-hub'
                ? { kind, url: str(body.url) }
                : null;
      if (!input) return new Response('unknown kind', { status: 400 });
      const r = await prepareManagedProject(ctx, input as Parameters<typeof prepareManagedProject>[1]);
      return Response.json(r, {
        status: r.ok ? 200 : r.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    },
    '/_api/workspace/sign-in': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const body = await readJson<unknown>(req, 8 * 1024);
      const result = await signInToWorkspace((body ?? {}) as Record<string, unknown>);
      return Response.json(result.json, {
        status: result.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    },

    // The DDR-054 trust model in plain words, for the panel that replaces
    // DDR-079's terminal banner (DDR-192 §6). Read-only and main-origin — the
    // operator name is not secret, but this is UI chrome the canvas has no use
    // for, and every route the canvas can reach is one more thing to reason about.
    '/_api/workspace/disclosure': async (req: Request) => {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required', { status: 403 });
      const url = new URL(req.url);
      const linked = ctx.cfg.linkedHub?.url ?? null;
      const operator =
        url.searchParams.get('operator') || (linked ? new URL(linked).host : 'your team');
      return Response.json(
        {
          operator,
          workspace: linked,
          items: workspaceDisclosure({
            operator,
            aiAvailable: url.searchParams.get('ai') !== '0',
          }),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/edit-css': async (req: Request) => {
      // Phase 12 (DDR-103) — single-property inline CSS edit. POST body
      // { canvas, id, property, value } → writes one key into the element's
      // inline `style={{}}` object via api.editCss → editAttribute. MAIN ORIGIN
      // ONLY: intentionally absent from CANVAS_SAFE_API + startCanvasServer's
      // route allowlist (DDR-054) — the untrusted canvas iframe origin must never
      // reach a source-write endpoint. The CSS-knob UI lives in the shell (main
      // origin) and calls it directly.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        id?: unknown;
        property?: unknown;
        value?: unknown;
        reset?: unknown;
        idIndex?: unknown;
        expected?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.editCss(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error, ...(result.conflict ? { conflict: true } : {}) },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        {
          ok: true,
          delta: result.delta,
          ...('previous' in result ? { previous: result.previous } : {}),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/edit-text': async (req: Request) => {
      // Phase 12 (DDR-103) — inline element text-content edit. POST body
      // { canvas, id, text } → overwrites the element's single JSXText child
      // (JSX-escaped) via api.editText → editText. Same MAIN-ORIGIN-ONLY trust
      // boundary as /_api/edit-css + /_api/canvas. The inline contenteditable
      // editor reaches it via the dgn:* bus → shell relay (never the iframe).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        id?: unknown;
        text?: unknown;
        occurrence?: unknown;
        before?: unknown;
      }>(req, 16 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.editText(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, delta: result.delta },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/edit-attr': async (req: Request) => {
      // Phase 12.2 (DDR-104) — the CSS panel's "custom HTML attribute" escape
      // hatch. POST body { canvas, id, attr, value } → writes a plain JSX
      // attribute (data-*, aria-*, role, …) via api.editAttr → editAttribute's
      // non-`style.` path. Same MAIN-ORIGIN-ONLY trust boundary as
      // /_api/edit-css + /_api/edit-text (absent from CANVAS_SAFE_API +
      // startCanvasServer's route map; the untrusted iframe can never reach it).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        id?: unknown;
        attr?: unknown;
        value?: unknown;
        reset?: unknown;
        expected?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.editAttr(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error, ...(result.conflict ? { conflict: true } : {}) },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        {
          ok: true,
          delta: result.delta,
          seq: result.seq,
          ...('previous' in result ? { previous: result.previous } : {}),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/reorder': async (req: Request) => {
      // Phase 12.1 (DDR-138) — node-move reorder. POST body
      // { canvas, id, refId, position } → moves the element with data-cd-id `id`
      // to `position` ('before'|'after'|'inside-start'|'inside-end') relative to
      // `refId` (reparent-capable) via api.reorder → moveElement. Snapshots the
      // pre-move source for /design:rollback. Same MAIN-ORIGIN-ONLY trust boundary
      // as /_api/edit-css + /_api/edit-text + /_api/edit-attr: intentionally absent
      // from CANVAS_SAFE_API + startCanvasServer's route allowlist (DDR-054) — the
      // untrusted canvas iframe requests a reorder over the dgn:* bus and the shell
      // (main origin) performs this privileged write.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        id?: unknown;
        refId?: unknown;
        position?: unknown;
        idIndex?: unknown;
        refIndex?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.reorder(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        {
          ok: true,
          delta: result.delta,
          movedId: result.movedId,
          semanticId: result.semanticId,
          seq: result.seq,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/retime-sequence': async (req: Request) => {
      // DDR-148 — Timeline drag-to-retime. POST { canvas, index, durationInFrames?,
      // from? } → rewrites the index-th sequence's timing (const-preferring so a
      // derived total updates too). Same MAIN-ORIGIN-ONLY trust boundary as
      // /_api/reorder + /_api/edit-css (absent from CANVAS_SAFE_API +
      // startCanvasServer routes, DDR-054) — the source write is privileged; the
      // untrusted canvas iframe can only request it over the dgn:* bus.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        stableId?: unknown;
        artboardId?: unknown;
        contentHash?: unknown;
        index?: unknown;
        durationInFrames?: unknown;
        from?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.retimeSequenceOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/clip-edit': async (req: Request) => {
      // feature-enhanced-video-editing (Phase 2) — parametric clip verbs, one
      // dispatch route: POST { canvas, artboardId?, stableId, contentHash?,
      // verb: speed|trim-in|audio|detach-audio|framing|grade|transition, …verb
      // params }. Same MAIN-ORIGIN-ONLY trust boundary as the other source
      // writes (absent from CANVAS_SAFE_API + startCanvasServer routes,
      // DDR-054) — this is also the agent door for /design:edit's timeline
      // vocabulary.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        stableId?: unknown;
        contentHash?: unknown;
        verb?: unknown;
        rate?: unknown;
        deltaFrames?: unknown;
        muted?: unknown;
        volume?: unknown;
        framing?: unknown;
        grade?: unknown;
        presentation?: unknown;
        durationInFrames?: unknown;
        atFrame?: unknown;
        src?: unknown;
        mediaKind?: unknown;
        text?: unknown;
        toIndex?: unknown;
      }>(req, 16 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.clipEditOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq, ...result.extra },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/remove-sequence': async (req: Request) => {
      // DDR-150 P3 — remove a clip. POST { canvas, stableId, artboardId?,
      // contentHash? } → removeClip (fingerprint + semantic gate; refuses the
      // only clip; drops an adjacent transition in a series). Snapshots pre-remove
      // for /design:rollback. Same MAIN-ORIGIN-ONLY trust boundary as the other
      // source-writes (absent from CANVAS_SAFE_API + startCanvasServer routes).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        stableId?: unknown;
        artboardId?: unknown;
        contentHash?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.removeSequenceOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/insert-sequence': async (req: Request) => {
      // DDR-150 P4 — insert a clip. POST { canvas, artboardId, from,
      // durationInFrames, mediaTag?, src? } → insertClip (appends after the
      // comp's last clip; refuses TransitionSeries + empty comps; src contained).
      // MAIN-ORIGIN-ONLY (absent from CANVAS_SAFE_API + startCanvasServer routes).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        from?: unknown;
        durationInFrames?: unknown;
        mediaTag?: unknown;
        src?: unknown;
        lane?: unknown;
        index?: unknown;
        placeholder?: unknown;
      }>(req, 16 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.insertSequenceOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, stableId: result.stableId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/reorder-sequence': async (req: Request) => {
      // DDR-150 P5 — z-order reorder. POST { canvas, artboardId, stableId,
      // contentHash, refStableId, refContentHash, position } → reorderClip
      // (moves a standalone <Sequence> before/after a sibling via moveElement +
      // semantic gate; both clips fingerprint-checked; refuses TransitionSeries
      // clips + self-move). MAIN-ORIGIN-ONLY (absent from CANVAS_SAFE_API +
      // startCanvasServer routes — same dual-allowlist as the other clip writes).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        stableId?: unknown;
        contentHash?: unknown;
        refStableId?: unknown;
        refContentHash?: unknown;
        position?: unknown;
        mode?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.reorderSequenceOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, stableId: result.stableId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/toggle-hide': async (req: Request) => {
      // DDR-150 dogfood — hide/show a clip (gates its body behind {false && …};
      // the tag + time slot + TransitionSeries alternation stay). MAIN-ORIGIN-ONLY
      // + CSRF-gated like the other source writes.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        stableId?: unknown;
        artboardId?: unknown;
        contentHash?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.toggleHideOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, hidden: result.hidden, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/edit-array-src': async (req: Request) => {
      // DDR-150 dogfood — replace a media src stored in an array literal (the
      // showreel `const CLIPS = [{ src }, …]` fed via `<ClipShot clip={CLIPS[i]}>`),
      // addressed by the enumerator's mediaArrayRef. MAIN-ORIGIN-ONLY + CSRF-gated
      // (same dual-allowlist as the other source writes); value contained under
      // assets/ in the engine.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        arrayName?: unknown;
        index?: unknown;
        field?: unknown;
        value?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.editArraySrcOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/comp-clips': async (req: Request) => {
      // DDR-150 P2 — the single authoritative clip enumerator for a video-comp.
      // GET ?canvas=<rel>&artboardId=<id> → { ok, compName, clips:[{ stableId,
      // from, durationInFrames, mediaTag, mediaSrc, mediaCdId, contentHash }] }.
      // The Timeline addresses every clip op by the returned stableId (never a
      // regex document-order index — the multi-comp mis-hit defect). Read-only +
      // MAIN-ORIGIN-ONLY: absent from CANVAS_SAFE_API + the startCanvasServer
      // route map, so the untrusted canvas iframe can never reach it (DDR-054).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // DNS-rebinding guard — this GET echoes project source structure; loopback-
      // only Host (real browser passes, rebound hostname 403s). No sameOriginWrite (GET).
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const u = new URL(req.url);
      const result = await api.compClips({
        canvas: u.searchParams.get('canvas'),
        artboardId: u.searchParams.get('artboardId') ?? undefined,
      });
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/reorder-revert': async (req: Request) => {
      // Phase 12.1 follow-up — Cmd+Z / Cmd+Shift+Z for a reorder. POST body
      // { canvas, seq, dir:'undo'|'redo' } → api.reorderRevert swaps the whole
      // file back to the logged {before|after} content (id-churn-proof; refuses
      // 409 when the canvas changed since). Same MAIN-ORIGIN-ONLY boundary as
      // /_api/reorder — NOT in CANVAS_SAFE_API nor startCanvasServer's routes;
      // the canvas undo stack requests it over the dgn bus, the shell writes.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ canvas?: unknown; seq?: unknown; dir?: unknown }>(
        req,
        8 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.reorderRevert(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, dir: result.dir },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/delete-element': async (req: Request) => {
      // Stage I (feature-element-editing-robustness) — delete an element by
      // data-cd-id. POST { canvas, id, idIndex? } → api.deleteElementOp (reparse
      // gate; reused-component instance via idIndex). Logs a whole-file undo seq
      // (Cmd+Z via /_api/reorder-revert — a structural edit churns positional
      // ids so an inverse descriptor goes stale). Same MAIN-ORIGIN-ONLY trust
      // boundary as /_api/reorder: absent from CANVAS_SAFE_API + startCanvasServer
      // routes (DDR-054); sameOriginWrite CSRF + loopback-Host (DNS-rebinding) gated.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ canvas?: unknown; id?: unknown; idIndex?: unknown }>(
        req,
        8 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.deleteElementOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, deletedId: result.deletedId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/insert-element': async (req: Request) => {
      // Stage I — insert a synthesized div/text/image relative to `refId`, OR —
      // empty-artboard fallback — as a direct child of `artboardId` (exactly one
      // of the two). POST { canvas, refId|artboardId, position, kind, src?,
      // refIndex? } → api.insertElementOp. Returns the new element's
      // post-transpile id so the shell can select it.
      // Whole-file undo seq. MAIN-ORIGIN ONLY (absent from both allowlists);
      // sameOriginWrite + loopback-Host gated. An `image` src is contained to
      // assets/ in the engine (no remote hotlink / ../ / scheme).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        refId?: unknown;
        artboardId?: unknown;
        position?: unknown;
        kind?: unknown;
        src?: unknown;
        refIndex?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.insertElementOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, newId: result.newId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/convert-to-absolute': async (req: Request) => {
      // feature-4 T8 (convert-to-absolute, DDR-188) — "Remove auto layout": POST
      // { canvas, containerId, containerIdIndex?, containerSetRelative,
      //   children: [{ id, idIndex?, left, top, width, height }] } →
      // api.convertChildrenToAbsoluteOp. ONE whole-file undo seq. MAIN-ORIGIN
      // ONLY (absent from both allowlists); sameOriginWrite + loopback-Host gated
      // — same DDR-054 posture as /_api/insert-element.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        containerId?: unknown;
        containerIdIndex?: unknown;
        containerSetRelative?: unknown;
        allowShared?: unknown;
        children?: unknown;
        containers?: unknown;
        dissolve?: unknown;
      }>(req, 256 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.convertChildrenToAbsoluteOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/detach-component': async (req: Request) => {
      // feature-4 detach-component (2026-07-19) — POST { canvas, id, idIndex? }
      // → api.detachComponentOp (clone definition + repoint this usage; one
      // whole-file undo seq). MAIN-ORIGIN ONLY; sameOriginWrite + loopback-Host
      // gated — same DDR-054 posture as the other structural writes.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ canvas?: unknown; id?: unknown; idIndex?: unknown }>(
        req,
        8 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.detachComponentOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, detachedName: result.detachedName, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/duplicate-element': async (req: Request) => {
      // Cmd+D (Task L3) — duplicate an element (a copy as the next sibling). POST
      // { canvas, id, idIndex? } → api.duplicateElementOp. Whole-file undo seq.
      // MAIN-ORIGIN ONLY; sameOriginWrite + loopback-Host gated (dual-allowlist).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ canvas?: unknown; id?: unknown; idIndex?: unknown }>(
        req,
        8 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.duplicateElementOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, newId: result.newId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/insert-artboard': async (req: Request) => {
      // Stage I4 — insert a new EMPTY artboard from a screen-size preset. POST
      // { canvas, id, label, width, height } → api.insertArtboardOp (appends a
      // <DCArtboard id label width height></DCArtboard> after the last artboard;
      // size JSX-authoritative per DDR-027). Whole-file undo seq. MAIN-ORIGIN
      // ONLY (absent from both allowlists); sameOriginWrite + loopback-Host gated.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        id?: unknown;
        label?: unknown;
        width?: unknown;
        height?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.insertArtboardOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, artboardId: result.artboardId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/duplicate-artboard': async (req: Request) => {
      // feature-3-web-artboards T3 — "Duplicate at width…". POST
      // { canvas, artboardId, width } → api.duplicateArtboardOp (clones the
      // artboard as the next sibling with a suffixed id/label + the new
      // width; every other prop, incl. kind/guides/print, carries over
      // verbatim). Whole-file undo seq. MAIN-ORIGIN ONLY (absent from both
      // allowlists); sameOriginWrite + loopback-Host gated, same posture as
      // /_api/insert-artboard above.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        width?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.duplicateArtboardOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, artboardId: result.artboardId, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/assets': async (req: Request) => {
      // Stage F1 (feature-element-editing-robustness) — list content-addressed
      // image/video assets under <designRoot>/assets/ for the AssetPicker (Replace
      // image / insert image). GET → { assets:[{path,name,ext,kind,size,mtimeMs}] }.
      // MAIN-ORIGIN ONLY: the picker is a shell dialog; absent from CANVAS_SAFE_API
      // + startCanvasServer routes (dual-allowlist, DDR-054). Loopback-Host gated
      // (DNS-rebinding); read-only, so no sameOriginWrite (GET).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const r = await api.listAssets();
      return Response.json(
        { ok: true, assets: r.assets },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/stickers': async (req: Request) => {
      // Phase 4 (feature-whiteboard-annotation-improvements) — the bundled
      // sticker catalogue for the StickerPicker. GET → { packs:[{slug, name,
      // author, attributionUrl, license, stickers:[{file,keywords,url}]}] }.
      // MAIN-ORIGIN ONLY: the picker is a shell dialog, same posture as
      // /_api/assets above — absent from CANVAS_SAFE_API + startCanvasServer
      // routes (dual-allowlist, DDR-054). Loopback-Host gated (DNS-rebinding);
      // read-only, so no sameOriginWrite (GET).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const r = await api.listStickers();
      return Response.json(
        { ok: true, packs: r.packs },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/edit-scope': async (req: Request) => {
      // Stage H (feature-element-editing-robustness) — the INV-3 predictability
      // verdict. GET ?canvas&id&rendered → { ok, scope:'local'|'shared',
      // componentName, affects, reason }. READ-only (a parse the shell runs on
      // selection to render the Local/Shared badge). MAIN-ORIGIN ONLY: absent
      // from CANVAS_SAFE_API + startCanvasServer routes (dual-allowlist, DDR-054);
      // loopback-Host gated (DNS-rebinding); no sameOriginWrite (GET).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const url = new URL(req.url);
      const result = await api.editScopeOp({
        canvas: url.searchParams.get('canvas') ?? undefined,
        id: url.searchParams.get('id') ?? undefined,
        rendered: url.searchParams.get('rendered') ?? undefined,
      });
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/component-map': async (req: Request) => {
      // feature-4 T7a — Layers-panel purple instance rows. GET ?canvas →
      // { ok, map: { [cdId]: { component, root, usages } } }. READ-only parse
      // (same posture as /_api/edit-scope). MAIN-ORIGIN ONLY: absent from
      // CANVAS_SAFE_API + startCanvasServer routes (DDR-054); loopback-Host
      // gated; no sameOriginWrite (GET).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const url = new URL(req.url);
      const result = await api.componentMapOp({
        canvas: url.searchParams.get('canvas') ?? undefined,
      });
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/resize-artboard': async (req: Request) => {
      // Stage D4 — free-hand artboard resize. POST { canvas, artboardId, width?,
      // height? } → api.resizeArtboardOp (writes the NUMERIC width/height props on
      // the <DCArtboard id="…">, addressed by its `id` prop since the rendered
      // <article data-dc-screen> carries no data-cd-id; DDR-027). Whole-file undo
      // seq. MAIN-ORIGIN ONLY; sameOriginWrite + loopback-Host gated.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        width?: unknown;
        height?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.resizeArtboardOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-hug': async (req: Request) => {
      // Artboard "hug height" default — Hug ⇄ Fixed toggle in the CSS panel.
      // POST { canvas, artboardId, fixed, freezeHeight? } → api.setArtboardHugOp
      // (writes/removes the bare `fixed` prop on <DCArtboard id="…">; freezeHeight
      // optionally pins `height` at the board's current measured size so pinning
      // to Fixed doesn't snap the box). Whole-file undo seq. MAIN-ORIGIN ONLY;
      // sameOriginWrite + loopback-Host gated, mirrors /_api/resize-artboard.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        fixed?: unknown;
        freezeHeight?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardHugOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-style': async (req: Request) => {
      // Artboard "more settings" — background / padding / layout / gap, applied
      // to .dc-artboard-body. POST { canvas, artboardId, background?, padding?,
      // layout?, gap? } (each key: value to set, `null` to reset, absent to leave
      // untouched) → api.setArtboardStyleOp. Whole-file undo seq. MAIN-ORIGIN
      // ONLY; sameOriginWrite + loopback-Host gated, mirrors /_api/resize-artboard.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        background?: unknown;
        padding?: unknown;
        layout?: unknown;
        gap?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardStyleOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-kind': async (req: Request) => {
      // feature-1-artboard-kinds-foundation, T8. POST { canvas, artboardId,
      // kind: 'digital'|'print'|'web'|'video'|null } → api.setArtboardKindOp.
      // `null` clears the explicit prop back to the implicit default. Whole-
      // file undo seq. MAIN-ORIGIN ONLY; same gate pair as set-artboard-style
      // (the kind-switch surfaces — context menu, Inspector — are shell UI,
      // never reachable from the untrusted canvas origin).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        kind?: unknown;
      }>(req, 2 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardKindOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-label': async (req: Request) => {
      // Plan T25/L08 — rename an artboard. POST { canvas, artboardId, label }
      // → api.setArtboardLabelOp. The canvas iframe only REQUESTS this over
      // the dgn bus (double-click the name); the shell writes it. MAIN-ORIGIN
      // ONLY, same gate pair as set-artboard-kind.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        label?: unknown;
      }>(req, 2 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardLabelOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-guides': async (req: Request) => {
      // feature-1-artboard-kinds-foundation, T5. POST { canvas, artboardId,
      // guides: {...}|null } → api.setArtboardGuidesOp. REPLACE-whole-prop
      // (see applySetArtboardGuides doc comment) — the caller sends the full
      // merged object, not a delta. MAIN-ORIGIN ONLY; same gate pair as
      // set-artboard-style.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        guides?: unknown;
      }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardGuidesOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/set-artboard-print': async (req: Request) => {
      // feature-2-print-artboards T2. POST { canvas, artboardId, print:
      // {paper, orientation?, bleedMm?, marginsMm?}|null } → api.setArtboardPrintOp.
      // REPLACE-whole-prop (see applySetArtboardPrint's own doc comment) — the
      // caller sends the full merged object, not a delta. MAIN-ORIGIN ONLY;
      // same gate pair as set-artboard-guides (Inspector picker is shell UI,
      // never reachable from the untrusted canvas origin).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        canvas?: unknown;
        artboardId?: unknown;
        print?: unknown;
      }>(req, 2 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.setArtboardPrintOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/delete-artboard': async (req: Request) => {
      // Delete an artboard by its `id` prop (Backspace / context-menu on a frame).
      // POST { canvas, artboardId } → api.deleteArtboardOp (removes the
      // <DCArtboard id="…"> span; refuses the last one). Whole-file undo seq.
      // MAIN-ORIGIN ONLY; sameOriginWrite + loopback-Host gated (dual-allowlist).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{ canvas?: unknown; artboardId?: unknown }>(req, 8 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const result = await api.deleteArtboardOp(body);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { ok: true, seq: result.seq },
        { status: 200, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/asset': async (req: Request) => {
      // Phase 23 / DDR-148 — binary media upload from the canvas (drag-drop /
      // paste). POST raw bytes → content-addressed write under
      // <designRoot>/assets/<sha8>.<ext>, returns 201 { path }. This route is on
      // the canvas-origin allowlist (CANVAS_SAFE_API below) — a bigger grant than
      // the inert annotation-SVG write (binary, disk) — so the caps in
      // api.saveAssetFromStream (magic-byte sniff, per-category ceiling, content-
      // addressed name, traversal guard, no-SVG/script, dedupe, session budget)
      // are the load-bearing trust mitigation, NOT optional. DDR-088 + DDR-148:
      // the body is STREAMED to disk (no full-buffer of a 100 MB clip in RAM).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // Early reject on a declared oversize body (the streamed per-category cap in
      // saveAssetFromStream is the authoritative gate — Content-Length can be
      // omitted/lied; this only trims an obvious oversize before we open a temp).
      const declared = Number(req.headers.get('content-length') || '0');
      if (Number.isFinite(declared) && declared > ASSET_MAX_VIDEO_BYTES) {
        const mb = Math.round(ASSET_MAX_VIDEO_BYTES / (1024 * 1024));
        return Response.json(
          { ok: false, error: `media exceeds the ${mb} MB cap` },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (!req.body) return new Response('empty body', { status: 400 });
      const result = await api.saveAssetFromStream(req.body as ReadableStream<Uint8Array>);
      if (!result.ok) {
        return Response.json(
          { ok: false, error: result.error },
          { status: result.status ?? 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      return Response.json(
        { path: result.path },
        { status: 201, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // DDR-167 (Phase 3 / T10) — hardened LOCAL-file SVG ingestion for the
    // in-app Brand-upload panel (T12). Privileged + main-origin-only (Decision
    // 4): absent from CANVAS_SAFE_API + startCanvasServer's routes map — the
    // untrusted canvas iframe must never reach it. Raw-bytes body only, never
    // multipart (this dev server has no multipart parsing anywhere). The
    // `X-Import-Kind` header is a dispatch HINT ONLY — never trusted for the
    // security-relevant decision; the sanitize pipeline's own pre-parse
    // structural sniff decides. PDF import is wired but not yet available —
    // see the DDR's addendum on why the planned rasterization mechanism
    // (headless-Chromium navigating a file:// PDF) doesn't render content
    // under browser automation; a `kind: pdf` request 501s naming that.
    '/_api/import-asset': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const kind = (req.headers.get('x-import-kind') || 'svg').toLowerCase();
      if (kind !== 'svg') {
        return Response.json(
          {
            ok: false,
            error: 'PDF import is not yet available (DDR-167 addendum) — only SVG import is wired.',
          },
          { status: 501, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const declared = Number(req.headers.get('content-length') || '0');
      if (Number.isFinite(declared) && declared > SVG_MAX_BYTES) {
        return Response.json(
          { ok: false, error: `SVG exceeds the ${SVG_MAX_BYTES / (1024 * 1024)} MB cap` },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (!req.body) return new Response('empty body', { status: 400 });
      let svgText: string;
      try {
        svgText = await new Response(req.body).text();
      } catch {
        return new Response('could not read body', { status: 400 });
      }
      try {
        const result = await importSvg(svgText, {
          root: ctx.paths.repoRoot,
          designRootRel: ctx.paths.designRel,
        });
        return Response.json(
          { ok: true, path: result.path },
          { status: 201, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        const status =
          err instanceof ImportAssetError
            ? err.code === 3
              ? 400
              : err.code === 5
                ? 415
                : err.code === 6
                  ? 500
                  : 400
            : 500;
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          { ok: false, error: message },
          { status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    },

    // DDR-173 (Phase 3 / T12) — brand-file typed-cue extraction for the
    // in-app Brand-upload panel. Privileged + main-origin-only, same posture
    // as /_api/import-asset: absent from CANVAS_SAFE_API + startCanvasServer's
    // routes map. Takes a SERVER-GENERATED asset path from a prior
    // /_api/import-asset response — never a client-supplied filesystem path
    // (DDR-173 Decision 2: extraction operates only on DDR-167's already-
    // gated, already-sanitized output, no parallel ungated read). The path is
    // still realpath-contained + charset-asserted here, never trusted blindly
    // just because it LOOKS server-shaped.
    '/_api/import-brand': async (req: Request) => {
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      let body: { assetPath?: unknown };
      try {
        body = (await req.json()) as { assetPath?: unknown };
      } catch {
        return new Response('invalid JSON body', { status: 400 });
      }
      const assetPath = body.assetPath;
      if (typeof assetPath !== 'string' || !/^assets\/[a-z0-9]{8}\.svg$/.test(assetPath)) {
        return Response.json(
          { ok: false, error: 'assetPath must be a server-generated assets/<sha8>.svg path' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      const designAbs = resolve(ctx.paths.repoRoot, ctx.paths.designRel);
      const resolvedAsset = resolve(designAbs, assetPath);
      if (!resolvedAsset.startsWith(resolve(designAbs, 'assets') + sep)) {
        return Response.json(
          { ok: false, error: 'assetPath escapes the assets directory' },
          { status: 400, headers: { 'Cache-Control': 'no-store' } }
        );
      }
      try {
        const result = await importBrand({
          sanitizedSvgPath: resolvedAsset,
          root: ctx.paths.repoRoot,
          designRootRel: ctx.paths.designRel,
        });
        return Response.json(
          { ok: true, ...result },
          { status: 201, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        const status =
          err instanceof ImportBrandError
            ? err.code === 3
              ? 400
              : err.code === 4
                ? 404
                : err.code === 6
                  ? 500
                  : 400
            : 500;
        const message = err instanceof Error ? err.message : String(err);
        return Response.json(
          { ok: false, error: message },
          { status, headers: { 'Cache-Control': 'no-store' } }
        );
      }
    },

    '/_api/export-history': async (req: Request) => {
      // Phase 6.5 T10 — recent-exports feed for the dialog's Recent tab. For a
      // JOB, the write happens as a side-effect of completion (exporters/
      // jobs.ts persistAndEvict), not here.
      //
      // DDR-231 Phase 2 T6 — the browser lane has no job: the member's own
      // browser captures the artboard and saves the file, and this process
      // never sees the bytes. Phase 1 therefore left those exports INVISIBLE —
      // "v exports dialog nic nevidim" — so the POST exists to record one in
      // the same ledger. It stores a name and a timestamp, never a payload.
      if (req.method === 'GET') {
        const history = exportJobs.loadHistory();
        return Response.json({ history }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      // Same gates as every other write here: CSRF + DNS-rebinding. This route
      // is MAIN-ORIGIN only (absent from CANVAS_SAFE_API + the canvas server's
      // routes map) — the canvas iframe reaches it through the shell bridge.
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ format?: unknown; scope?: unknown; filename?: unknown }>(
        req,
        4 * 1024
      );
      if (!body) return new Response('body required', { status: 400 });
      if (!isFormat(body.format)) return new Response('unknown or missing format', { status: 400 });
      if (!isScope(body.scope)) return new Response('unknown or missing scope', { status: 400 });
      // The name is chosen in the browser, where tenant TSX shares the window
      // (DDR-231 F1) — reduce it to a bare, charset-limited basename before it
      // reaches the ledger that agents and future sessions read back.
      const raw = typeof body.filename === 'string' ? body.filename : '';
      const filename = basename(raw)
        .replace(/[^A-Za-z0-9._-]/g, '')
        .slice(0, 255);
      if (!filename || /^\.+$/.test(filename))
        return new Response('filename required', { status: 400 });
      const entry = exportJobs.recordBrowserExport({
        format: body.format,
        scope: body.scope,
        filename,
      });
      return Response.json(entry, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    },

    '/_api/export': async (req: Request) => {
      // feature-background-export-notification-center — thin wrapper over the
      // job queue: enqueue() then await the SAME job's result. Byte-for-byte
      // identical external contract to the old synchronous handler, so
      // `/design:export` (CLI) and any other blocking caller need zero changes.
      // sameOriginWrite CSRF + loopback-Host (DNS-rebinding) gated, matching
      // the write-route convention elsewhere in this file (e.g.
      // /_api/delete-element) — closed as part of the /flow:done security
      // fan-out (defender finding: this POST now has a disk-write + queue-
      // growth consequence a bare cross-origin form-POST could trigger).
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const body = await readJson<{
        format?: unknown;
        scope?: unknown;
        options?: Record<string, unknown>;
      }>(req, 64 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      if (!isFormat(body.format)) return new Response('unknown or missing format', { status: 400 });
      if (!isScope(body.scope)) return new Response('unknown or missing scope', { status: 400 });
      // DDR-231 Phase 2 T4 — the PAIR, not just each half. `pdf` + `project-raw`
      // is two individually-valid values that resolve to a `file-tree` target,
      // which the render service refuses as `invalid render job` — a refusal
      // that named neither the field nor the remedy. Reproduced locally against
      // a real maude-render; see test/export-format-scope-coherence.test.ts.
      if (!isScopeValidForFormat(body.format, body.scope)) {
        return new Response(scopeRefusalMessage(body.format, body.scope), { status: 400 });
      }
      const format = body.format;
      const scope = body.scope;
      try {
        const { result } = exportJobs.enqueue(
          buildExportArgs(req, { format, scope, options: body.options })
        );
        const finished = await result;
        // Bun.serve accepts Uint8Array directly; the cast satisfies the
        // SharedArrayBuffer-strict BodyInit narrowing on @types/bun.
        return new Response(finished.body as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type': finished.contentType,
            'Content-Disposition': `attachment; filename="${finished.filename}"`,
            'Cache-Control': 'no-store',
          },
        });
      } catch (err) {
        if (err instanceof ExportQueueFullError) {
          return new Response(err.message, { status: 429 });
        }
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`export failed: ${msg}`, { status: 500 });
      }
    },

    '/_api/export-jobs': async (req: Request) => {
      // feature-background-export-notification-center — the non-blocking
      // sibling of /_api/export: same body, returns 202 { jobId } immediately
      // without awaiting the render. MAIN-ORIGIN ONLY (absent from
      // CANVAS_SAFE_API + startCanvasServer routes, same trust boundary as
      // /_api/export today — DDR-060). loopback-Host gated on every method;
      // the mutating POST is additionally sameOriginWrite CSRF gated (same
      // /flow:done security fan-out fix as /_api/export above).
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(
          { jobs: exportJobs.list() },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{
        format?: unknown;
        scope?: unknown;
        options?: Record<string, unknown>;
      }>(req, 64 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      if (!isFormat(body.format)) return new Response('unknown or missing format', { status: 400 });
      if (!isScope(body.scope)) return new Response('unknown or missing scope', { status: 400 });
      // DDR-231 Phase 2 T4 — the PAIR, not just each half. `pdf` + `project-raw`
      // is two individually-valid values that resolve to a `file-tree` target,
      // which the render service refuses as `invalid render job` — a refusal
      // that named neither the field nor the remedy. Reproduced locally against
      // a real maude-render; see test/export-format-scope-coherence.test.ts.
      if (!isScopeValidForFormat(body.format, body.scope)) {
        return new Response(scopeRefusalMessage(body.format, body.scope), { status: 400 });
      }
      try {
        const { id, result } = exportJobs.enqueue(
          buildExportArgs(req, { format: body.format, scope: body.scope, options: body.options })
        );
        // This route deliberately doesn't await the render — the job's own
        // status (surfaced via GET /_api/export-jobs + the export:job WS
        // push) is the completion signal. A render failure still needs a
        // handler here or it's an unhandled rejection on every failed/timed-
        // out background job (security fan-out finding, /flow:done) — the
        // failure is already recorded on the job record, so this is a no-op.
        result.catch(() => {});
        return Response.json(
          { jobId: id },
          { status: 202, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        if (err instanceof ExportQueueFullError) {
          return new Response(err.message, { status: 429 });
        }
        throw err;
      }
    },

    '/_api/export-jobs/download': async (req: Request) => {
      // MAIN-ORIGIN ONLY, same boundary as /_api/export-jobs above.
      // loopback-Host gated (read-only — no sameOriginWrite needed — but an
      // unguessable job-scoped UUID plus this guard closes the DNS-rebinding
      // angle the /flow:done security fan-out checked for).
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const id = new URL(req.url).searchParams.get('id');
      if (!id) return new Response('id query param required', { status: 400 });
      const dl = await exportJobs.getBytes(id);
      if (!dl.ok) {
        return new Response(dl.reason === 'not-done' ? 'job not finished' : 'Not found', {
          status: dl.reason === 'not-done' ? 409 : 404,
        });
      }
      return new Response(dl.bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': dl.contentType,
          'Content-Disposition': `attachment; filename="${dl.filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    },

    '/_api/export-warmup': async (req: Request) => {
      // DDR-231 T7 — wake the render service while the member is still picking
      // export options: the dialog fires this on open (remote lane only), so
      // by the time a video/PDF job lands the multi-GB Chromium container is
      // already booting instead of starting cold. Proxies GET /_health — no
      // job body, no secret in the response, nothing evaluates.
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      // Side-effecting GET (it triggers an outbound fetch that wakes/bills a
      // container) → gate it like every other side-effecting GET, so a
      // cross-site page a member visits can't fire it as a keep-warm
      // amplification (DDR-231 security L2).
      if (!sameOriginRead(req)) return new Response('cross-origin rejected', { status: 403 });
      const serviceUrl = process.env.MAUDE_RENDER_URL;
      if (!serviceUrl) return Response.json({ ok: false, lane: resolveRenderLane() });
      try {
        // `globalThis.fetch`, never a bare `fetch(` — this module scope has
        // carried a same-named local handler before, and a bare call silently
        // resolved to it instead of the network (RCA
        // issue-report-a-bug-http-500). The handler is `handleFallthrough`
        // today; the rule stands so a rename can never reintroduce that, and
        // `report-proxy.test.ts` fails the build on any bare call site here.
        const r = await globalThis.fetch(`${serviceUrl.replace(/\/+$/, '')}/_health`, {
          signal: AbortSignal.timeout(8_000),
        });
        const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
        return Response.json(
          { ok: Boolean(body?.ok), lane: 'remote' },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch {
        // A timeout here usually MEANS the container is waking — that is the
        // point of the ping; report it calmly.
        return Response.json(
          { ok: false, waking: true, lane: 'remote' },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
    },

    '/_api/export-assemble': async (req: Request) => {
      // DDR-231 (hybrid export lanes) — the browser lane's ASSEMBLE half. The
      // member's browser captured the artboard PNGs (canvas-lib's
      // export-capture bridge — the only place the pixels exist in a
      // workspace); this composes them into a .pptx deck with PptxGenJS —
      // pure JS over pure data, the same containment class as zip: no tenant
      // TSX evaluates here and no browser enters the image. MAIN-ORIGIN ONLY
      // (absent from CANVAS_SAFE_API + the canvas-origin routes map) and
      // CSRF-gated like its jobs siblings.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      // Byte cap BEFORE parsing: 50 artboards at 3× are tens of MB; 96 MB sits
      // under Bun's global maxRequestBodySize (~108 MB) so formData() can't be
      // pushed past it, and still fits a large deck (PptxGenJS base64-encodes
      // every image → memory ~3× input). REQUIRE an honest content-length: a
      // chunked / absent-length body would otherwise skip this fast-reject and
      // buffer up to Bun's ceiling before the loop below could stop it
      // (adversarial pass). formData() itself is still Bun-capped as a backstop.
      const MAX_ASSEMBLE_BYTES = 96 * 1024 * 1024;
      const declared = Number(req.headers.get('content-length'));
      if (!Number.isFinite(declared) || declared <= 0)
        return new Response('content-length required', { status: 411 });
      if (declared > MAX_ASSEMBLE_BYTES)
        return new Response('assembly payload too large', { status: 413 });
      const form = await req.formData().catch(() => null);
      if (!form) return new Response('multipart form body required', { status: 400 });
      if (form.get('format') !== 'pptx')
        return new Response('unsupported assemble format', { status: 400 });
      const scale = Math.max(1, Math.min(8, Number(form.get('scale')) || 1));
      const images: Uint8Array[] = [];
      let total = 0;
      for (const [key, value] of form.entries()) {
        if (key !== 'image') continue;
        // Bun's FormData typings collapse the entry value; runtime-check the
        // Blob shape instead of trusting the declared union.
        const file = value as unknown;
        if (!(file instanceof Blob)) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        total += bytes.byteLength;
        if (images.length >= 100 || total > MAX_ASSEMBLE_BYTES)
          return new Response('assembly payload too large', { status: 413 });
        images.push(bytes);
      }
      if (!images.length) return new Response('no images to assemble', { status: 400 });
      try {
        const { assemblePngDeck } = await import('./exporters/pptx.ts');
        const body = await assemblePngDeck(images, scale);
        const name = String(form.get('name') || 'export').replace(/[^A-Za-z0-9._-]/g, '_');
        return new Response(body as unknown as BodyInit, {
          status: 200,
          headers: {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'Content-Disposition': `attachment; filename="${name}.pptx"`,
            'Cache-Control': 'no-store',
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return new Response(`deck assembly failed: ${msg}`, { status: 422 });
      }
    },

    // feature-ai-media-generation (DDR-16x) — the background AI-media generation
    // job queue. The privileged sibling of /_api/export-jobs: MAIN-ORIGIN ONLY
    // (absent from CANVAS_SAFE_API + startCanvasServer's routes — the untrusted
    // canvas iframe must never reach a route that resolves a provider KEY and
    // makes an outbound provider call; it sees only the produced /assets/<sha8>).
    // loopback-Host gated on every method; the mutating POST is additionally
    // sameOriginWrite CSRF-gated. See DDR-16x + the canvas-origin-gate test.
    '/_api/generate-jobs': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(
          { jobs: generateJobs.list() },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<Record<string, unknown>>(req, 64 * 1024);
      if (!body) return new Response('body required', { status: 400 });
      const check = validateGenRequest(body);
      if (!check.ok) return new Response(check.errors.join('; '), { status: 400 });
      const genReq = body as unknown as import('./generation/types.ts').GenRequest;
      if (!hasProvider(genReq.provider))
        return new Response(`unknown provider: ${genReq.provider}`, { status: 400 });
      const descriptor = getProviderDescriptor(genReq.provider);
      if (descriptor && !descriptor.modalities.includes(genReq.modality))
        return new Response(`provider ${genReq.provider} cannot do ${genReq.modality}`, {
          status: 400,
        });

      try {
        const { id } = generateJobs.enqueue({
          provider: genReq.provider,
          modality: genReq.modality,
          model: genReq.model,
          // The job's work: resolve the key AT RUN TIME (never cached), build the
          // per-request adapter context with the saveAsset-backed localizer, and
          // submit → result → localize each produced asset into assets/<sha8>.
          run: async (signal) => {
            const apiKey = await getProviderKey(genReq.provider);
            const adapter = createAdapter(genReq.provider, {
              apiKey,
              signal,
              localize: (asset) => localizeGenAsset(asset, { saveAsset: api.saveAsset }),
              // Task 1.2 — source-asset access for the maskless-edit / i2v flows
              // (Nano Banana reads the source into an inlineData part). Contained
              // to assets/ host-side; the adapter never touches the filesystem.
              readSourceAsset: (rel) => api.readAssetBytes(rel),
            });
            const job = await adapter.submit(genReq);
            const result = await job.result();
            const assets: string[] = [];
            for (const asset of result.assets) {
              // Task 2.6 — a CLOUD STT result (ElevenLabs Scribe / Groq) is
              // caption TEXT, not media: it lands as a `assets/<sha8>.srt|.vtt`
              // sidecar next to its source (the SAME path the local whisper verb
              // writes), never through the magic-byte media store. Everything
              // else (image/video/audio) localizes into the content-addressed
              // media store as before.
              if (asset.kind === 'transcription' && typeof asset.text === 'string') {
                if (!genReq.sourceAsset)
                  throw new Error('transcription result has no source asset to sidecar');
                const fmt = asset.mime === 'text/vtt' ? 'vtt' : 'srt';
                const saved = await api.writeCaptionSidecar(genReq.sourceAsset, fmt, asset.text);
                if (!saved.ok || !saved.path)
                  throw new Error(`caption sidecar write failed: ${saved.error ?? 'unknown'}`);
                assets.push(saved.path);
              } else {
                assets.push(await localizeGenAsset(asset, { saveAsset: api.saveAsset }));
              }
            }
            // Task 2.5 — record the AUDIO INTENT next to a generated audio asset
            // (the durable, semantic reuse index) so a later near-identical
            // request can offer the existing track instead of paying again.
            if (genReq.modality === 'audio' && assets.length > 0) {
              const kind = (genReq.params as Record<string, unknown> | undefined)?.audioKind;
              await api.writeAudioIntent(assets[0], {
                kind: typeof kind === 'string' ? kind : undefined,
                prompt: genReq.prompt,
                provider: genReq.provider,
                model: genReq.model,
              });
            }
            // Task 3.2 — a generated VIDEO clip gets a provenance FootageAnalysis
            // stub next to it (assets/<sha8>.footage.json), so it is immediately
            // KNOWN to the footage/reel pipeline: the director sees the clip is
            // synthetic (the `ai-generated` tag) and what it was made for (the
            // prompt), and the footage-analyst later fills the real shots. A
            // sidecar hiccup must NOT lose the (expensive) clip — best-effort.
            if (genReq.modality === 'video' && assets.length > 0) {
              try {
                await footageStore.saveAnalysis(
                  assets[0],
                  generatedClipAnalysis(assets[0], {
                    provider: genReq.provider,
                    model: genReq.model,
                    prompt: genReq.prompt,
                  })
                );
              } catch {
                /* provenance-only — the clip already landed in assets/ */
              }
            }
            return { assets, usage: result.usage };
          },
        });
        // Don't await the run — the job's own status (GET + the generate:job WS
        // push) is the completion signal. A failure is recorded on the job
        // record, so swallow the rejection here to avoid an unhandled rejection.
        return Response.json(
          { jobId: id },
          { status: 202, headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        if (err instanceof GenerationQueueFullError)
          return new Response(err.message, { status: 429 });
        throw err;
      }
    },

    // feature-ai-media-generation (DDR-16x) — inert provider catalogue for the
    // Settings panel + generate dialog: descriptors (id/label/modalities/notes/
    // keyUrl) + presence-only `configured` flags. NO secret ever crosses here.
    // MAIN-ORIGIN ONLY, loopback-gated.
    '/_api/generate/providers': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const configured = new Set(configuredProviders());
      return Response.json(
        {
          providers: listProviders().map((d) => ({ ...d, configured: configured.has(d.id) })),
        },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-ai-media-generation (DDR-16x) — key management. WRITE-ONLY from the
    // main origin: POST sets a key, DELETE removes one, GET reports presence only
    // ({configured:[...]}) — a key value is NEVER echoed back (mirrors
    // github_is_signed_in). MAIN-ORIGIN ONLY, loopback + sameOriginWrite gated.
    '/_api/generate/keys': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(
          { configured: configuredProviders() },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ provider?: unknown; key?: unknown }>(req, 16 * 1024);
      if (!body || typeof body.provider !== 'string')
        return new Response('provider required', { status: 400 });
      if (!hasProvider(body.provider))
        return new Response(`unknown provider: ${body.provider}`, { status: 400 });
      try {
        if (req.method === 'DELETE') {
          deleteProviderKey(body.provider);
          return Response.json({ configured: false }, { headers: { 'Cache-Control': 'no-store' } });
        }
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        if (typeof body.key !== 'string' || !body.key.trim())
          return new Response('key required', { status: 400 });
        setProviderKey(body.provider, body.key);
        // Presence flag only — never the key. Deliberately does not read the
        // value back so a proxy/log between here and the client can't capture it.
        return Response.json(
          { configured: isConfigured(body.provider) },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        return new Response(err instanceof Error ? err.message : 'key write failed', {
          status: 400,
        });
      }
    },

    // feature-ai-media-generation (Task 2.6, DDR-164) — NON-SECRET generation
    // preferences (the transcription-engine choice). GET returns the current
    // choice; POST persists it into `.design/config.json` and hot-reloads the
    // config so the next transcribe picks it up without a restart. MAIN-ORIGIN
    // ONLY, loopback + sameOriginWrite gated. NEVER touches a key — that's the
    // separate /_api/generate/keys route.
    '/_api/generate/prefs': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(
          {
            transcriptionProvider: readTranscriptionProvider(ctx.paths.repoRoot),
            keyframeEngine: readKeyframeEngine(ctx.paths.repoRoot),
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ transcriptionProvider?: unknown; keyframeEngine?: unknown }>(
        req,
        4 * 1024
      );
      // The panel POSTs ONE pref at a time (transcription engine OR keyframe engine).
      try {
        if ('keyframeEngine' in (body ?? {})) {
          const engine = body?.keyframeEngine;
          if (!isKeyframeEngine(engine))
            return new Response('keyframeEngine must be auto|gemma|ffmpeg|blind', { status: 400 });
          await writeKeyframeEngine(ctx.paths.repoRoot, engine);
          reloadConfig(ctx);
          return Response.json(
            { keyframeEngine: engine },
            { headers: { 'Cache-Control': 'no-store' } }
          );
        }
        const provider = body?.transcriptionProvider;
        if (!isTranscriptionProvider(provider))
          return new Response('transcriptionProvider must be auto|whisper|elevenlabs|groq', {
            status: 400,
          });
        await writeTranscriptionProvider(ctx.paths.repoRoot, provider);
        reloadConfig(ctx);
        return Response.json(
          { transcriptionProvider: provider },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      } catch (err) {
        return new Response(err instanceof Error ? err.message : 'prefs write failed', {
          status: 400,
        });
      }
    },

    // feature-unified-settings-modal — NON-SECRET UI / view preferences (theme +
    // the Canvas & View toggles), persisted to `~/.config/maude/prefs.json` so
    // they survive a restart and a cleared localStorage. GET returns the merged
    // prefs; POST merge-patches only the provided keys. MAIN-ORIGIN ONLY, loopback
    // + sameOriginWrite gated (never reachable from the untrusted canvas origin).
    '/_api/ui-prefs': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        return Response.json(readUiPrefs(), { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<Record<string, unknown>>(req, 4 * 1024);
      if (!body || typeof body !== 'object')
        return new Response('body must be a JSON object', { status: 400 });
      // Build a clean patch — only well-typed known keys pass through, so a bad
      // field is rejected rather than silently resetting a stored value.
      const patch: Partial<UiPrefs> = {};
      if ('theme' in body) {
        if (body.theme !== 'light' && body.theme !== 'dark')
          return new Response('theme must be light|dark', { status: 400 });
        patch.theme = body.theme;
      }
      for (const k of ['minimap', 'zoom', 'annotations', 'autoOpenInspector'] as const) {
        if (k in body) {
          if (typeof body[k] !== 'boolean')
            return new Response(`${k} must be a boolean`, { status: 400 });
          patch[k] = body[k] as boolean;
        }
      }
      if ('layersMode' in body) {
        if (body.layersMode !== 'separate' && body.layersMode !== 'in-inspector')
          return new Response('layersMode must be separate|in-inspector', { status: 400 });
        patch.layersMode = body.layersMode;
      }
      if ('panelSides' in body) {
        const ps = body.panelSides;
        if (!ps || typeof ps !== 'object' || Array.isArray(ps))
          return new Response('panelSides must be an object', { status: 400 });
        for (const v of Object.values(ps as Record<string, unknown>)) {
          if (v !== 'left' && v !== 'right')
            return new Response('panelSides values must be left|right', { status: 400 });
        }
        // writeUiPrefs → coerce keeps only known ids, so unknown keys are dropped.
        patch.panelSides = ps as UiPrefs['panelSides'];
      }
      try {
        return Response.json(writeUiPrefs(patch), { headers: { 'Cache-Control': 'no-store' } });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : 'ui-prefs write failed', {
          status: 500,
        });
      }
    },

    // feature-ai-media-generation (Task 2.5, DDR-164) — reuse-before-you-pay for
    // AUDIO. GET searches the project's OWN generated audio (intent sidecars) and,
    // when ElevenLabs is configured, the user's re-downloadable History (free —
    // already paid), returning ranked reuse candidates. MAIN-ORIGIN ONLY,
    // loopback-gated (it resolves the provider key server-side).
    '/_api/generate/audio-search': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      // F1 (ethical-hacker) — this GET resolves the user's key + fans out to the
      // provider, so it must NOT be cross-site-triggerable (a no-cors GET can slip
      // past the loopback guard). Fetch-Metadata gate: browser cross-site → 403;
      // the CLI (no Sec-Fetch-Site) → allowed.
      if (!sameOriginRead(req)) return new Response('cross-site read rejected', { status: 403 });
      const q = new URL(req.url).searchParams.get('q') ?? '';
      if (!q.trim()) return new Response('q query param required', { status: 400 });
      const local: AudioMatch[] = await api.searchAudioLibrary(q, 10);
      let history: AudioMatch[] = [];
      // Only reach the provider when its key is present (no key → local-only).
      if (isConfigured('elevenlabs')) {
        try {
          const apiKey = await getProviderKey('elevenlabs');
          const adapter = createAdapter('elevenlabs', {
            apiKey,
            localize: (asset) => localizeGenAsset(asset, { saveAsset: api.saveAsset }),
          });
          if (adapter.listHistory) {
            const items = await adapter.listHistory();
            const candidates: Candidate[] = items.map((it) => ({
              source: 'history' as const,
              ref: it.id,
              // History `text` is the user's own generation source, but a TTS of
              // attacker-supplied text could carry injection — sanitize before it
              // reaches the agent-facing output (F3).
              text: sanitizeReuseText(it.text),
              provider: 'elevenlabs',
              at: it.at,
            }));
            history = rankMatches(q, candidates, { limit: 10 });
          }
        } catch {
          // History is best-effort (rate limits / transient) — degrade to local.
          history = [];
        }
      }
      return Response.json({ local, history }, { headers: { 'Cache-Control': 'no-store' } });
    },

    // feature-ai-media-generation (Task 2.5) — reuse a History item: re-download
    // its bytes (NO credit — already paid) through the host's magic-byte-sniffed
    // saveAsset, localize into assets/<sha8>, and record the audio intent so the
    // reused track is itself searchable. MAIN-ORIGIN ONLY, loopback +
    // sameOriginWrite gated.
    '/_api/generate/audio-reuse': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ id?: unknown }>(req, 8 * 1024);
      const id = body?.id;
      if (typeof id !== 'string' || !id.trim())
        return new Response('history item id required', { status: 400 });
      if (!isConfigured('elevenlabs'))
        return new Response('no ElevenLabs key configured', { status: 400 });
      try {
        const apiKey = await getProviderKey('elevenlabs');
        const adapter = createAdapter('elevenlabs', {
          apiKey,
          localize: (asset) => localizeGenAsset(asset, { saveAsset: api.saveAsset }),
        });
        if (!adapter.fetchHistoryAudio)
          return new Response('provider has no history re-download', { status: 400 });
        const asset = await adapter.fetchHistoryAudio(id);
        const rel = await localizeGenAsset(asset, { saveAsset: api.saveAsset });
        await api.writeAudioIntent(rel, {
          kind: 'tts',
          prompt: `reused from ElevenLabs history ${id}`,
          provider: 'elevenlabs',
        });
        return Response.json({ asset: rel }, { headers: { 'Cache-Control': 'no-store' } });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : 'reuse failed', { status: 400 });
      }
    },

    // feature-ai-media-generation (Task 2.7 approach A, DDR-164) — managed local
    // whisper.cpp GGML models: GET lists the registry + which are downloaded +
    // any in-flight download; POST {id} downloads one (SSRF-hardened, from the
    // frozen ggerganov/whisper.cpp allowlist); DELETE {id} reclaims disk. This is
    // the "one-click local subtitles" model half — after a download,
    // `maude design transcribe --provider whisper` auto-resolves it. MAIN-ORIGIN
    // ONLY, loopback + sameOriginWrite gated.
    '/_api/generate/whisper-model': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        // `setup` tells the card whether the ENGINE is actually installed and
        // how to get it on THIS machine (no `brew install` without Homebrew);
        // `auto` reports what the automatic engine choice currently resolves
        // to, so the card can state it out loud rather than switch silently.
        const setup = whisperSetup();
        return Response.json(
          {
            models: listWhisperModels(),
            downloading: whisperDownload,
            setup,
            auto: resolveAutoEngine(configuredProviders(), setup.installed),
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ id?: unknown }>(req, 4 * 1024);
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!getWhisperModel(id)) return new Response('unknown model id', { status: 400 });

      if (req.method === 'DELETE') {
        const removed = await removeWhisperModel(id);
        return Response.json({ removed }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (whisperDownload && !whisperDownload.error)
        return new Response(`a download is already in progress (${whisperDownload.id})`, {
          status: 409,
        });
      // Kick off the streamed download; progress is polled via GET. Swallow the
      // rejection here (recorded on the state) to avoid an unhandled rejection.
      // A generous wall-clock timeout (ethical-hacker Finding 3) so a stalled
      // connection aborts → errors → frees the single slot instead of wedging it
      // forever (large models on a slow link can legitimately take many minutes).
      whisperDownload = { id, received: 0, total: 0 };
      void downloadWhisperModel(
        id,
        (received, total) => {
          if (whisperDownload && whisperDownload.id === id) {
            whisperDownload.received = received;
            whisperDownload.total = total;
          }
        },
        AbortSignal.timeout(45 * 60_000)
      )
        .then(() => {
          if (whisperDownload?.id === id) whisperDownload = null; // done → drops out of GET
        })
        .catch((err) => {
          if (whisperDownload?.id === id)
            whisperDownload = {
              id,
              received: whisperDownload.received,
              total: whisperDownload.total,
              error: err instanceof Error ? err.message : 'download failed',
            };
        });
      return Response.json(
        { started: id },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    // feature-scene-aware-keyframes — managed local Gemma-4 MLX scout models: GET
    // lists the registry + which are downloaded + any in-flight download + the two
    // availability signals (mlx-vlm runtime, ffmpeg) the Settings card needs to say
    // which tier will run; POST {id} downloads one via huggingface_hub (gated on
    // mlx-vlm being installed — the model is useless without it). MAIN-ORIGIN ONLY.
    '/_api/generate/keyframe-model': async (req: Request) => {
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      if (req.method === 'GET') {
        // The GET builds availability by spawning subprocesses (import mlx_vlm is
        // heavy). Gate it same-origin so a cross-origin no-cors flood can't drive a
        // spawn-storm against the loopback server (DDR-183 security finding — the
        // sibling audio-search GET added this guard for the same reason). The probes
        // are also TTL-cached in gemma-models.ts as defence-in-depth.
        if (!sameOriginRead(req))
          return new Response('cross-origin read rejected', { status: 403 });
        const ollama = await ollamaStatus();
        return Response.json(
          {
            // Both runtimes' models in one list, each tagged with the runtime
            // it needs — the card enables the button for whichever runtime this
            // machine actually has, instead of a dead "Needs mlx-vlm".
            models: listScoutModels(ollama),
            downloading: keyframeDownload,
            mlxVlmAvailable: mlxVlmAvailable(),
            ffmpegAvailable: ffmpegAvailable(),
            // Setup routes that actually work on THIS machine, best first — no
            // `brew install` without Homebrew, no venv one-liner without
            // python3, and "start it" rather than "install it" when the binary
            // is already there. Computed from the SAME paths the probes check,
            // so the shown command and the detection can't drift.
            mlx: mlxSetup(),
            ollama: {
              ...ollama,
              recommendedModel: OLLAMA_RECOMMENDED_MODEL,
              pullCommand: `ollama pull ${OLLAMA_RECOMMENDED_MODEL}`,
              setup: ollamaSetupOptions(ollama),
            },
          },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      }
      if (req.method === 'DELETE') {
        // Free a wedged download slot (a stalled HF connection) without waiting out
        // the 60-min abort timeout (DDR-183 F4). Same-origin write-gated.
        if (!sameOriginWrite(req))
          return new Response('cross-origin write rejected', { status: 403 });
        keyframeDownload = null;
        return Response.json({ cancelled: true }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      if (!sameOriginWrite(req))
        return new Response('cross-origin write rejected', { status: 403 });
      const body = await readJson<{ id?: unknown }>(req, 4 * 1024);
      const id = typeof body?.id === 'string' ? body.id : '';
      // One route, two runtimes: an `ollama:` id pulls through the local Ollama
      // server, anything else is an mlx HF snapshot. Each gates on ITS OWN
      // runtime — an Ollama user must not be blocked by a missing mlx-vlm.
      const isOllama = Boolean(getOllamaModel(id));
      if (!isOllama && !listGemmaModels().some((m) => m.id === id))
        return new Response('unknown model id', { status: 400 });
      if (isOllama) {
        const status = await ollamaStatus();
        if (!status.available)
          return new Response('Ollama is not running — start it (`ollama serve`) and try again.', {
            status: 400,
          });
      } else if (!mlxVlmAvailable())
        return new Response(
          'mlx-vlm not installed — run the install command shown in Settings → Video. (Ollama users don’t need this download: `ollama pull` fetches its own models.)',
          {
            status: 400,
          }
        );
      if (keyframeDownload && !keyframeDownload.error)
        return new Response(`a download is already in progress (${keyframeDownload.id})`, {
          status: 409,
        });
      keyframeDownload = { id, received: 0, total: 0 };
      const run = isOllama ? pullOllamaModel : downloadGemmaModel;
      void run(
        id,
        (received, total) => {
          if (keyframeDownload && keyframeDownload.id === id) {
            keyframeDownload.received = received;
            keyframeDownload.total = total;
          }
        },
        AbortSignal.timeout(60 * 60_000) // multi-GB snapshots on a slow link
      )
        .then(() => {
          if (keyframeDownload?.id === id) keyframeDownload = null;
        })
        .catch((err) => {
          if (keyframeDownload?.id === id)
            keyframeDownload = {
              id,
              received: keyframeDownload.received,
              total: keyframeDownload.total,
              error: err instanceof Error ? err.message : 'download failed',
            };
        });
      return Response.json(
        { started: id },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    },

    '/_api/timeline-media': async (req: Request) => {
      // Task 7 (enhanced-video-editing) — filmstrip/waveform cache. Runtime
      // state under `_canvas-state/timeline-media/` (DDR-115). MAIN-ORIGIN only
      // (shell UI cache — not in CANVAS_SAFE_API / startCanvasServer routes).
      // DNS-rebinding guard on BOTH methods (security review 2026-07-30): under
      // rebinding sameOriginWrite passes (page origin == req origin == attacker
      // host), so a remote page could otherwise READ the cache (filmstrip JPEG
      // dataURLs of local footage → disclosure) or WRITE arbitrary JSON later
      // rendered as <img src> in the trusted shell. The loopback-host check is
      // the same backstop every sibling privileged route carries.
      if (!isTrustedRequestHost(req))
        return new Response('local request required (DNS-rebinding guard)', { status: 403 });
      const url = new URL(req.url);
      const key = url.searchParams.get('key') ?? '';
      if (req.method === 'GET') {
        const data = await api.timelineMediaLoad(key);
        if (!data) return Response.json({ ok: false }, { status: 404 });
        return Response.json({ ok: true, data }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        if (!sameOriginWrite(req))
          return new Response('cross-origin write rejected', { status: 403 });
        const body = await readJson<Record<string, unknown>>(req, 8 * 1024 * 1024);
        if (!body) return new Response('body required', { status: 400 });
        const ok = await api.timelineMediaSave(key, body);
        return Response.json({ ok }, { status: ok ? 200 : 400 });
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_canvas-state': async (req: Request) => {
      const url = new URL(req.url);
      if (req.method === 'GET') {
        const file = url.searchParams.get('file');
        if (!file) return new Response('file query param required', { status: 400 });
        const state = await api.loadCanvasState(file);
        return Response.json(state ?? {}, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (req.method === 'POST') {
        const body = await readJson<{ file?: string }>(req);
        if (!body || typeof body.file !== 'string' || !body.file) {
          return new Response('body must include file (string)', { status: 400 });
        }
        await api.saveCanvasState(body.file, body as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }
      return new Response('Method not allowed', { status: 405 });
    },

    '/_hmr': async (req: Request) => {
      // Hint endpoint — the build:watch process POSTs `{ type, path, hash }`
      // after a rebuild; we forward it to all WS clients. Body is opaque; we
      // just emit on the bus and ws.ts handles broadcast.
      if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
      const body = await readJson<{ type: string; path?: string; hash?: number }>(req);
      if (!body || typeof body.type !== 'string') return new Response('bad body', { status: 400 });
      ctx.bus.emit('hmr', body);
      return new Response(null, { status: 204 });
    },

    '/': () => serveFile(join(CLIENT_DIR, 'index.html')),
    '/index.html': () => serveFile(join(CLIENT_DIR, 'index.html')),
  } satisfies Record<string, (req: Request) => Response | Promise<Response>>;

  // Named `handleFallthrough`, not `fetch` — a same-named local function shadows
  // the global `fetch` for every call site in this module's scope, which is how
  // the `/_api/report` route ended up calling itself instead of the network (see
  // the `globalThis.fetch` comment on that route; RCA issue-report-a-bug-http-500).
  async function handleFallthrough(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const pathname = url.pathname;

      // Phase 6 — POST /_api/comments/<id>/reply. Dynamic path, so it lives in
      // the fall-through instead of the static `routes` map. `<id>` is the
      // c_<hex> id of the parent comment; body is `{ body, author? }`. Bodies
      // share the same 4000-char cap as a top-level comment.
      const replyMatch = pathname.match(/^\/_api\/comments\/([A-Za-z0-9_]+)\/reply$/);
      if (replyMatch) {
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
        const id = replyMatch[1] ?? '';
        const body = await readJson<{ body?: string; author?: string }>(req);
        if (!body || typeof body.body !== 'string' || !body.body.trim()) {
          return new Response('body.body required', { status: 400 });
        }
        const next = await api.commentsAddReply(id, {
          body: body.body,
          author: typeof body.author === 'string' ? body.author : undefined,
        });
        if (!next) return new Response('Not found', { status: 404 });
        return Response.json(next, { headers: { 'Cache-Control': 'no-store' } });
      }

      // Bundled client assets (preferred path — bundle from dist/).
      if (pathname.startsWith('/_client/')) {
        const rel = decodeURIComponent(pathname.slice('/_client/'.length));
        if (rel.includes('..')) return new Response('Forbidden', { status: 403 });
        // Try dist/ first (built bundle + styles), fall back to client/ (raw source files).
        const distHit = join(DIST_DIR, rel);
        if (await Bun.file(distHit).exists()) return serveFile(distHit);
        const srcHit = join(CLIENT_DIR, rel);
        return serveFile(srcHit);
      }

      // React 19 runtime bundles for TSX canvases. The browser pulls these
      // through the importmap in _canvas-shell.html — each bundle is a single
      // package (react, react-dom/client, jsx-runtime, jsx-dev-runtime),
      // built once on first request, cached in-process for the session.
      if (pathname.startsWith('/_canvas-runtime/')) {
        const slugWithExt = decodeURIComponent(pathname.slice('/_canvas-runtime/'.length));
        const pkg = packageForSlug(slugWithExt);
        if (!pkg) return new Response('Not found', { status: 404 });
        try {
          const bundle = await getRuntimeBundle(pkg);
          const ifNoneMatch = req.headers.get('if-none-match');
          if (ifNoneMatch === bundle.etag) {
            return new Response(null, {
              status: 304,
              headers: { ETag: bundle.etag, 'Cache-Control': 'no-cache' },
            });
          }
          return new Response(bundle.js, {
            status: 200,
            headers: {
              'Content-Type': 'application/javascript; charset=utf-8',
              ETag: bundle.etag,
              'Cache-Control': 'no-cache',
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return new Response(`Runtime bundle error: ${msg}`, { status: 500 });
        }
      }

      // Canvas mount harness — served for iframes pointing at a .tsx canvas.
      // Static template ships under plugins/design/templates/_shell.html.
      // Query parameter ?canvas=<path-relative-to-designRoot> tells the shell
      // which canvas to import + mount. See plugins/design/templates/_shell.html.
      if (pathname === '/_canvas-shell.html' || pathname === '/_canvas-shell') {
        // The segregated canvas origin (server.ts) calls serveCanvasShell(true)
        // directly with CSP always on; on the legacy main origin the CSP stays
        // env-gated (MAUDE_CSP_POC) for the POC / backwards-compat. A capture
        // render (?hide-chrome=1 — ⌘E export / screenshot shim) ALWAYS gets the
        // network-locked capture CSP so it can't SSRF/exfil (attacker F1).
        const capture = url.searchParams.get('hide-chrome') === '1';
        return serveCanvasShell(process.env.MAUDE_CSP_POC === '1', capture);
      }

      // DDR-150 dogfood — canvas-relative assets alias. A comp's
      // `<Video src="assets/x.mp4">` resolves against the iframe root →
      // `/assets/x.mp4`; serve `designRoot/assets/x.mp4` (flat sha8-named
      // uploads, media extensions only — mirrors isCanvasSafeRoute's gate on
      // the canvas origin). Without this, every src the timeline insert /
      // replace / assemble writers emit 404'd in the Player.
      if (pathname.startsWith('/assets/')) {
        let name = '';
        try {
          name = decodeURIComponent(pathname.slice('/assets/'.length));
        } catch {
          return new Response('Bad request', { status: 400 });
        }
        // DDR-173 (Phase 3 / T12) — brand-logo assets live one level down at
        // `assets/logos/<sha8>.<ext>` (DDR-141's own convention). This is the
        // ONE legitimate subdirectory allowed here, matched by its own exact,
        // closed-charset shape — not a general "any subdirectory" opt-in,
        // which would widen this route's containment beyond what DDR-141
        // actually calls for.
        const isFlat =
          name &&
          !name.includes('/') &&
          !name.includes('\\') &&
          !name.includes('..') &&
          !name.startsWith('_') &&
          CANVAS_ASSET_EXTS.has(ext(name));
        const isLogoSubdir = /^logos\/[a-z0-9]{8}\.(svg|png)$/.test(name);
        if (isFlat || isLogoSubdir) {
          const abs = join(ctx.paths.designRoot, 'assets', name);
          // Range-aware for video/audio (scrubbing + WKWebView compat).
          if (RANGE_MEDIA_EXTS.has(ext(name))) {
            return serveMediaFile(abs, req, { 'X-Content-Type-Options': 'nosniff' });
          }
          // B2 — the SAME caching policy as every other static lane. This
          // route is the one a canvas's photographs actually come down, so
          // `no-store` here is the difference between a teammate re-fetching
          // 266 MB of media on every pan and re-fetching none of it. Content-
          // addressed names (`<sha8>.<ext>`, which is what every writer emits)
          // are immutable by construction; anything else revalidates.
          return serveFile(abs, { 'X-Content-Type-Options': 'nosniff' });
        }
      }

      // Phase 4 (feature-whiteboard-annotation-improvements) — bundled sticker
      // PNGs, served from MAUDE's OWN STICKERS_DIR (paths.ts, DDR-045), never
      // the served project's designRoot (unlike /assets/ above). MAIN-ORIGIN
      // ONLY: absent from CANVAS_SAFE_API + startCanvasServer's own routes
      // object (server.ts) — a canvas-origin request 404s via isCanvasSafeRoute
      // before ever reaching here (dual-allowlist, DDR-054/DDR-088).
      if (pathname.startsWith('/_stickers/')) {
        const rest = pathname.slice('/_stickers/'.length);
        let decoded = '';
        try {
          decoded = decodeURIComponent(rest);
        } catch {
          return new Response('Bad request', { status: 400 });
        }
        const parts = decoded.split('/');
        const [pack, name] = parts;
        if (
          parts.length === 2 &&
          pack &&
          name &&
          /^[a-z0-9-]+$/.test(pack) &&
          !name.includes('..') &&
          !name.includes('/') &&
          !name.includes('\\') &&
          ext(name) === '.png'
        ) {
          const abs = join(STICKERS_DIR, pack, name);
          const f = Bun.file(abs);
          if (await f.exists()) {
            return new Response(f, {
              headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'public, max-age=31536000, immutable', // bundled with this maude version, never changes at this URL
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
          return new Response('Not found', { status: 404 });
        }
        return new Response('Not found', { status: 404 });
      }

      // DDR-166 Phase 1 / T2 — bundled Maude-product media (the intro
      // showreel), served from MAUDE's OWN MEDIA_DIR (paths.ts, DDR-045),
      // never the served project's designRoot — every user of the canvas
      // browser sees the same intro regardless of which project is open.
      // Same shape as /_stickers/ above: MAIN-ORIGIN ONLY (absent from
      // CANVAS_SAFE_API + startCanvasServer's routes), Range-capable via
      // serveMediaFile (the wizard/Help player needs to scrub).
      if (pathname.startsWith('/_media/')) {
        const name = pathname.slice('/_media/'.length);
        let decoded = '';
        try {
          decoded = decodeURIComponent(name);
        } catch {
          return new Response('Bad request', { status: 400 });
        }
        if (
          decoded &&
          !decoded.includes('..') &&
          !decoded.includes('/') &&
          !decoded.includes('\\') &&
          RANGE_MEDIA_EXTS.has(ext(decoded))
        ) {
          const abs = join(MEDIA_DIR, decoded);
          if (await Bun.file(abs).exists()) {
            return serveMediaFile(abs, req, {
              'Cache-Control': 'public, max-age=31536000, immutable', // bundled with this maude version, never changes at this URL
              'X-Content-Type-Options': 'nosniff',
            });
          }
        }
        return new Response('Not found', { status: 404 });
      }

      // Fall-through: serve user repo files (designRoot + everything under repoRoot).
      const fp = safePathUnderRoot(req.url, ctx.paths.repoRoot);
      if (!fp) return new Response('Forbidden', { status: 403 });

      const file = Bun.file(fp);
      const exists = await file.exists();
      if (!exists) return new Response('Not found', { status: 404 });

      const e = ext(fp);
      const underDesignRoot = `${fp}/`.startsWith(`${ctx.paths.designRoot}/`);
      // .tsx under designRoot is a canvas — transpile + emit locator, return JS.
      if (e === '.tsx' && underDesignRoot) {
        return serveCanvasTsx(fp, req, ctx, join(ctx.paths.designRoot, '_locator.json'));
      }
      // Video/audio get Range support (scrubbing + WKWebView compat) — the
      // `/.design/assets/…` form comps reference goes through here.
      if (RANGE_MEDIA_EXTS.has(e)) {
        return serveMediaFile(fp, req, { 'X-Content-Type-Options': 'nosniff' });
      }
      // Bun.file streams transparently for binary content.
      //
      // B2 — THIS is the lane a design system's own photographs and webfonts
      // come down (`system/<ds>/assets/graphics/camo-bg.png`, 446 kB;
      // `…/fonts/*.woff2`). `no-store` here meant a teammate re-downloaded all
      // of it on every pan, across the internet, on a project whose media is
      // 266 MB. Verified against the real one after the first cloud deploy said
      // `no-store` on exactly these files.
      //
      // `cacheControlFor` gives content-addressed names a year and everything
      // else a revalidation — so a designer editing `hero.png` in place still
      // sees the edit, at the cost of a 304 rather than the file.
      const policy = cacheControlFor(fp);
      return new Response(file, {
        headers: {
          'Content-Type': MIME[e] || 'application/octet-stream',
          'Cache-Control': policy.cacheControl,
          ...(policy.addEtag
            ? {
                ETag: `W/"${file.size.toString(16)}-${Math.trunc(file.lastModified).toString(16)}"`,
              }
            : {}),
          // DDR-088 follow-up — never let a browser MIME-sniff a served file
          // (e.g. an uploaded GIF/WEBP polyglot) into a richer type. Assets are
          // only referenced via <image href> + the canvas CSP blocks script, so
          // this is defense-in-depth on the static lane.
          'X-Content-Type-Options': 'nosniff',
          // …and `nosniff` is not enough for the one type that is a DOCUMENT
          // whether you sniff it or not. See INERT_DOCUMENT_CSP: an SVG
          // NAVIGATED TO is a page with `<script>` in it, executing on this
          // origin, and "the canvas CSP blocks script" above is true only of
          // the shell — not of the asset served on its own.
          ...(e === '.svg' ? { 'Content-Security-Policy': INERT_DOCUMENT_CSP } : {}),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(`Server error: ${msg}`, { status: 500 });
    }
  }

  async function serveCanvasShell(applyCsp: boolean, capture = false): Promise<Response> {
    const shellHtml = await Bun.file(join(TEMPLATES_DIR, '_shell.html')).text();
    // Inject inspector overlay — Cmd+Click selection + add-comment flow.
    const injected = inspect().injectInspector(shellHtml);
    const headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    // A capture render (⌘E export / screenshot) ALWAYS carries the network-locked
    // capture CSP, even on the main origin where the normal shell CSP is off —
    // this is the SSRF/exfil boundary the export otherwise lacked (attacker F1).
    if (capture) headers['Content-Security-Policy'] = cspForCapture();
    else if (applyCsp)
      headers['Content-Security-Policy'] = cspForCanvasShell(injected, ctx.mainOrigin);
    return new Response(injected, { headers });
  }

  // Canvas assets the segregated origin may serve out of designRoot. Excludes
  // `.json` so no `*.meta.json` / `config.json` / `_comments/*.json` leaks via
  // the static lane (canvas-meta goes through the gated /_api route instead).
  const CANVAS_ASSET_EXTS = new Set([
    '.tsx',
    '.css',
    '.svg',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.ico',
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    // DDR-148 — video/audio media a video-comp `<Video>`/`<Audio>` loads from
    // assets/. Served like images (inert static bytes, `nosniff`, no script
    // execution under the canvas CSP) — the same read grant, widened for media.
    '.mp4',
    '.m4v',
    '.mov',
    '.webm',
    '.mp3',
    '.wav',
    '.m4a',
    '.ogg',
  ]);

  // Exact API paths the canvas iframe needs (collab + display data). See
  // isCanvasSafeRoute for the trust rationale. Mutations are limited to inert
  // collab data (annotations SVG, comment replies via the dynamic route).
  const CANVAS_SAFE_API = new Set([
    '/_api/git-user', // presence display name
    '/_api/canvas-meta', // layout/viewport sidecar (GET + PATCH)
    '/_api/annotations', // annotation SVG (GET + PUT) — drives the collab bridge
    '/_api/asset', // Phase 23 — capped binary image upload (sniff+category cap+sha8 name+no-SVG)
    '/_api/photo-edit', // feature-photo-editor — PhotoEdit sidecar GET/PUT (cap-stack gated). MIRROR in server.ts routes.
    '/_api/git-committers', // @mention autocomplete
    '/_api/ai', // AI-activity banner
    '/_comments', // per-file comment list (renders pins)
  ]);

  function isCanvasSafeRoute(pathname: string): boolean {
    // A1/A2 (DDR-060 F1 re-audit, phase-9.1-t2-f1-cross-origin-reaudit.md) —
    // DECODE + NORMALIZE before gating. `URL.pathname` preserves `%2f` (it does
    // NOT decode it to `/`), so a raw allowlist check on the encoded path is
    // fooled: `/.design/..%2fsite%2fx.css` reads as ONE opaque segment under the
    // designRoot with an asset ext (the `_`-segment + ext checks see no literal
    // slash to split on), yet `safePathUnderRoot` later DECODES the same `%2f`,
    // turns `..%2f` into a real `../`, and climbs out of the designRoot — re-
    // confined only to repoRoot. That decode mismatch let a hub-pushed canvas
    // read any repo `.tsx`/`.css`/`.svg`/font + `_history` snapshots. Decoding
    // here makes the gate agree with the resolver: `..%2f` → `../`, normalize
    // collapses it, and the path no longer matches designPrefix → 403. A
    // malformed escape (`%ZZ`) throws → reject. This gate runs ONLY on the
    // segregated canvas origin (server.ts), so the main origin is untouched.
    let safe: string;
    try {
      safe = posix.normalize(decodeURIComponent(pathname));
    } catch {
      return false;
    }
    if (safe === '/_canvas-shell.html' || safe === '/_canvas-shell') return true;
    if (safe === '/_health') return true;
    if (safe === '/_client/comment-mount.js') return true;
    // Canvas-chrome stylesheets (composer / thread / pin / cursor CSS). Inert
    // static assets from the dev-server distribution — no secrets, no code
    // exec, no repo content. Without this the cross-origin canvas 403s e.g.
    // `/_client/comments-overlay.css`, so the in-iframe comment composer renders
    // unstyled and, missing `position: fixed`, collapses to the top-left (0,0).
    // Allowed by pattern (not per-file) so future chrome CSS can't silently
    // regress the same way.
    if (safe.startsWith('/_client/') && ext(safe) === '.css') return true;
    if (safe.startsWith('/_canvas-runtime/')) return true;
    // Collab + display-data endpoints the canvas runtime legitimately calls from
    // inside the iframe. All are reads or inert collab writes (annotations SVG,
    // comment replies) — the "safe to sync" set per DDR-054. None expose code
    // execution, secrets, export, /_config, /_sync-status, or files outside
    // designRoot/annotations; the canvas origin's CSP `connect-src 'self'` still
    // confines the iframe so hub-pushed JSX can't reach IMDS/LAN/main-origin.
    if (CANVAS_SAFE_API.has(safe)) return true;
    // POST /_api/comments/<id>/reply — dynamic path (fetch-handled).
    if (/^\/_api\/comments\/[A-Za-z0-9_]+\/reply$/.test(safe)) return true;
    const designPrefix = `/${ctx.paths.designRel.replace(/^\/+|\/+$/g, '')}/`;
    if (safe.startsWith(designPrefix)) {
      const rest = safe.slice(designPrefix.length);
      // Reject runtime/state dirs+files (_comments, _sync.json, _history, …).
      //
      // FIRST SEGMENT ONLY, and that is the taxonomy rather than a relaxation.
      // Every runtime-state path DDR-115 names lives at the top level of the
      // designRoot — `_history/`, `_canvas-state/`, `_state/`, `_chat/`,
      // `_comments/`, `_untrusted/`, `_trash/`, `_draw/`, `_smoke/`,
      // `_server.json`, `_active.json` — so a first-segment test rejects the
      // whole of it, including everything nested underneath.
      //
      // Testing EVERY segment additionally rejected files that are versioned,
      // shipped, and required: a design system's `system/<ds>/preview/
      // _components.css` is the stylesheet the shell itself names in the
      // iframe URL, and the underscore there is the DS's own convention for
      // "aggregate, not a specimen". It 403'd, so every canvas rendered with
      // its component styles missing and looked broken in a way that pointed
      // nowhere near this line.
      if (rest.split('/')[0].startsWith('_')) return false;
      return CANVAS_ASSET_EXTS.has(ext(safe));
    }
    // DDR-150 dogfood — `/assets/<file>`: the canvas-RELATIVE form every writer
    // emits (`<Video src="assets/x.mp4">` from timeline insert / replace /
    // assemble, and what the video-comp skill teaches). It aliases to
    // `designRoot/assets/<file>` — flat single segment (uploads are sha8-named),
    // media/image extensions only, no `_` names. Same read-only trust class as
    // the designRel static lane above (DDR-088 widened media grant).
    if (safe.startsWith('/assets/')) {
      const rest = safe.slice('/assets/'.length);
      if (!rest || rest.includes('/') || rest.startsWith('_')) return false;
      return CANVAS_ASSET_EXTS.has(ext(safe));
    }
    return false;
  }

  // Cloud Phase 25 C2 — read-only gate over every write surface (~42 mutating
  // routes). Computed per-request so a role change lands on the next write
  // (workspace sign-in rewrites hubs.json; no restart needed). Wrapping here
  // covers all three doors at once: the main-origin `routes` table, the
  // canvas-origin `routes` allowlist in server.ts (it references these same
  // handlers), and the dynamic-path `fetch` fall-through (comment replies).
  function projectReadOnly(req?: Request): boolean {
    // ---- Cloud Phase 27 A3/A4 (DDR-209): the role is PER SESSION ----------
    //
    // In a cell this process serves an owner and a viewer at the same time, so
    // the on-disk answer below — one role per hub URL — is not merely stale, it
    // is the wrong SHAPE. The proxy in front vouches a role per request and
    // injects the capability it derived from the one role table.
    //
    // AND IT DEFAULTS CLOSED. The local path fails OPEN by design: `catch`
    // returns false, an unset `linkedHub` returns false, and a fully writable
    // studio is the correct answer for a tool running on your own laptop. On
    // the internet it is the whole ballgame — so in a cloud build read-only is
    // the default and an edit role requires positive proof.
    if (isWorkspaceMode()) {
      return req?.headers.get('x-maude-readonly') !== '0';
    }
    return ctx.cfg.linkedHub ? isHubReadOnly(ctx.cfg.linkedHub.url) : false;
  }

  function readOnlyRefusal(req: Request): Response | null {
    if (READ_ONLY_SAFE_METHODS.has(req.method)) return null;
    if (!projectReadOnly(req)) return null;
    let pathname: string;
    try {
      pathname = new URL(req.url).pathname;
    } catch {
      return readOnlyRefusalResponse();
    }
    if (READ_ONLY_ALLOWED_WRITES.has(pathname)) return null;
    // The dynamic half of the comment lane. An exact-match set cannot express
    // it, and leaving it out would mean a viewer may leave a comment but not
    // reply to one — a distinction nobody promised and nobody wants.
    if (READ_ONLY_ALLOWED_WRITE_PATTERNS.some((re) => re.test(pathname))) return null;
    return readOnlyRefusalResponse();
  }

  const guardedRoutes = Object.fromEntries(
    Object.entries(routes).map(([path, handler]) => [
      path,
      (req: Request) => readOnlyRefusal(req) ?? handler(req),
    ])
  ) as typeof routes;

  async function guardedFetch(req: Request): Promise<Response> {
    return readOnlyRefusal(req) ?? handleFallthrough(req);
  }

  return { routes: guardedRoutes, fetch: guardedFetch, serveCanvasShell, isCanvasSafeRoute };
}
