// The route manifest — Cloud Phase 27 A2 + E3, under DDR-209.
//
// DENY BY DEFAULT, AND THAT IS THE WHOLE POINT. The cell now runs the REAL
// studio, whose route table is 121 entries long and grows every phase. A proxy
// that allowlisted the dangerous ones would be a proxy that is correct until the
// next feature lands; this one refuses anything it has not been told about, so a
// new studio route is a RED BUILD (`test/studio-manifest.test.mjs`) rather than
// a silently-public endpoint.
//
// READS ARE CLASSIFIED TOO. It is tempting to wave GETs through — none of them
// change anything — but "cannot change" is not "may see". A cell holds one
// tenant's project and hands it to whoever the control plane vouched for; the
// question a read must still answer is whether THIS session is one of them, and
// a blanket GET allowance answers it with "yes" forever.
//
// THIS TABLE IS NOT THE ONLY GATE. The studio's own `readOnlyRefusal` stays
// (Cloud Phase 25 C2), and in a cloud build it defaults CLOSED. Two layers, on
// purpose: this one knows the session, that one knows the handler, and neither
// is trusted to be the last word.
//
// Every value is a capability from `role-matrix.mjs` — that is what makes the
// role model ONE table rather than two that agree today.

import { checkoutAssetRel, checkoutRelShape } from './assets.mjs';
import { CAPABILITIES, can } from './role-matrix.mjs';

/** Methods that cannot change anything. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Explicitly refused, with the reason. Distinct from "absent" so the manifest
 * records a DECISION rather than an oversight — an absent route is a route
 * nobody has classified yet, and the test tells you so.
 */
export const REFUSED = Object.freeze({ capability: null });

/**
 * path → { safe, unsafe } capability, or REFUSED.
 *
 * `safe` covers GET/HEAD/OPTIONS, `unsafe` everything else. `null` on either
 * side denies that half. Longest-prefix wins for the `/…/` entries at the
 * bottom; everything else is an exact path.
 */
export const STUDIO_ROUTES = Object.freeze({
  // ---- the application itself -------------------------------------------
  '/': { safe: 'read', unsafe: null },
  '/index.html': { safe: 'read', unsafe: null },
  '/_health': { safe: 'read', unsafe: null },
  '/_config': { safe: 'read', unsafe: null },

  // ---- reading the project ----------------------------------------------
  '/_index-data': { safe: 'read', unsafe: null },
  '/_system-data': { safe: 'read', unsafe: null },
  '/_sync-status': { safe: 'read', unsafe: null },
  '/_comments-all': { safe: 'read', unsafe: null },
  '/_api/canvas-source': { safe: 'read', unsafe: null },
  '/_api/component-map': { safe: 'read', unsafe: null },
  '/_api/preflight': { safe: 'read', unsafe: null },
  '/_api/setup-readiness': { safe: 'read', unsafe: null },
  '/_api/stickers': { safe: 'read', unsafe: null },
  '/_api/whats-new': { safe: 'read', unsafe: null },
  '/_api/git-user': { safe: 'read', unsafe: null },
  '/_api/git-committers': { safe: 'read', unsafe: null },
  '/_api/export-history': { safe: 'read', unsafe: null },
  // feature-cloud-export-render-workers — the export JOB lane. Enqueue is a
  // POST "because it takes work, exactly like the export lane on the hub"
  // (the git rows' reasoning), and `export` is an all-roles capability:
  // "look, comment and download" is what viewer means (role-matrix.mjs).
  // Nothing here evaluates in the cell — browser formats dispatch to the
  // render service; without one the studio refuses with a remedy (lane `none`).
  '/_api/export-jobs': { safe: 'read', unsafe: 'export' },
  '/_api/export-jobs/download': { safe: 'export', unsafe: null },
  // DDR-231 — the browser lane's assemble half: the member's browser captured
  // the artboard PNGs (canvas-lib export-capture bridge), this composes the
  // .pptx in-cell with PptxGenJS — pure JS over pure data, the zip containment
  // class. POST because it takes work; `export` is an all-roles capability.
  '/_api/export-assemble': { safe: null, unsafe: 'export' },
  // DDR-231 T7 — warm-up ping: a proxied render-service /_health GET so the
  // container wakes while the member is still picking options. Read-class.
  '/_api/export-warmup': { safe: 'read', unsafe: null },
  '/_api/assets': { safe: 'read', unsafe: null },
  '/_api/footage': { safe: 'read', unsafe: null },
  '/_api/comp-clips': { safe: 'read', unsafe: null },

  // ---- keeping your own place (D3) --------------------------------------
  //
  // Per-user runtime state, never versioned (DDR-115). A viewer holds every one
  // of these: a reviewer who cannot pan, zoom or open a second tab is not
  // reviewing. The SESSION dimension that keeps two members in one cell from
  // clobbering each other lives in the proxy (see `sessionKey`), not here.
  '/_active': { safe: 'read', unsafe: 'session' },
  '/_canvas-state': { safe: 'read', unsafe: 'session' },
  '/_hmr': { safe: 'read', unsafe: 'session' },
  '/_api/ui-prefs': { safe: 'read', unsafe: 'session' },
  '/_api/timeline-media': { safe: 'read', unsafe: 'session' },
  // A bug report is about MAUDE, not about the project — the same reason the
  // desktop's read-only gate lets a viewer file one. The diagnostic bundle it
  // would have attached is refused below; a report without it still works.
  '/_api/report': { safe: null, unsafe: 'session' },
  '/_api/report-fallback': { safe: null, unsafe: 'session' },
  // The viewport lane is per-user; the LAYOUT lane is a project change and the
  // studio refuses it in-handler for a read-only session (http.ts `/_api/
  // canvas-meta`). Classified `session` here because that in-handler split is
  // finer than a path can express — and it is exactly why the studio's own gate
  // is kept rather than replaced.
  '/_api/canvas-meta': { safe: 'read', unsafe: 'session' },

  // ---- the one write a viewer holds --------------------------------------
  '/_comments': { safe: 'read', unsafe: 'comment' },
  // An annotation is drawn ON the design and versioned with it
  // (`*.annotations.svg`, DDR-115), which is why the matrix files it with
  // `edit` and not with `comment`.
  '/_api/annotations': { safe: 'read', unsafe: 'annotate' },
  // A photo edit is a validated JSON sidecar next to the asset
  // (`assets/<sha8>.photo.json`) — the decode/compositing runs in the member's
  // browser, the exact division of labour that makes `/_canvas-shell`
  // servable. This was REFUSED for a while under a rationale that described
  // the CLI photo-adjust helpers, and the real effect was that photo edits
  // could not be saved in the cloud at all. Non-destructive adjustment of a
  // versioned asset files with `edit`.
  '/_api/photo-edit': { safe: 'read', unsafe: 'edit' },

  // ---- changing the project ----------------------------------------------
  '/_api/canvas': { safe: 'read', unsafe: 'edit' },
  '/_api/asset': { safe: 'read', unsafe: 'edit' },
  '/_api/import-asset': { safe: null, unsafe: 'edit' },
  '/_api/import-brand': { safe: null, unsafe: 'edit' },
  '/_api/edit-attr': { safe: null, unsafe: 'edit' },
  '/_api/edit-css': { safe: null, unsafe: 'edit' },
  '/_api/edit-text': { safe: null, unsafe: 'edit' },
  '/_api/edit-array-src': { safe: null, unsafe: 'edit' },
  // GET-only, READ-only in the studio: it parses the selection to render the
  // Local/Shared badge (http.ts — `if (req.method !== 'GET') 405`). It was filed
  // `{safe:null, unsafe:'edit'}`, the exact inverse of its handler, so the shell's
  // GET was refused 405 for every role, owner included. `read` on the safe side,
  // nothing on the unsafe side — it writes nothing (inspector-edits RCA).
  '/_api/edit-scope': { safe: 'read', unsafe: null },
  '/_api/insert-artboard': { safe: null, unsafe: 'edit' },
  '/_api/insert-element': { safe: null, unsafe: 'edit' },
  '/_api/insert-sequence': { safe: null, unsafe: 'edit' },
  '/_api/delete-artboard': { safe: null, unsafe: 'edit' },
  '/_api/delete-element': { safe: null, unsafe: 'edit' },
  '/_api/duplicate-artboard': { safe: null, unsafe: 'edit' },
  '/_api/duplicate-element': { safe: null, unsafe: 'edit' },
  '/_api/detach-component': { safe: null, unsafe: 'edit' },
  '/_api/convert-to-absolute': { safe: null, unsafe: 'edit' },
  '/_api/resize-artboard': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-guides': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-hug': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-kind': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-label': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-print': { safe: null, unsafe: 'edit' },
  '/_api/set-artboard-style': { safe: null, unsafe: 'edit' },
  '/_api/reorder': { safe: null, unsafe: 'edit' },
  '/_api/reorder-revert': { safe: null, unsafe: 'edit' },
  '/_api/reorder-sequence': { safe: null, unsafe: 'edit' },
  '/_api/remove-sequence': { safe: null, unsafe: 'edit' },
  '/_api/retime-sequence': { safe: null, unsafe: 'edit' },
  '/_api/toggle-hide': { safe: null, unsafe: 'edit' },
  '/_api/clip-edit': { safe: null, unsafe: 'edit' },
  '/_api/fs-mkdir': { safe: null, unsafe: 'edit' },
  '/_api/fs-move': { safe: null, unsafe: 'edit' },
  // The agent-activity signal is a claim that somebody is EDITING; a viewer
  // raising it would put "X is editing" on every other member's screen.
  '/_api/ai': { safe: 'read', unsafe: 'edit' },
  '/_api/ai/start': { safe: null, unsafe: 'edit' },
  '/_api/ai/end': { safe: null, unsafe: 'edit' },
  '/_api/ai/heartbeat': { safe: null, unsafe: 'edit' },

  // ---- git ---------------------------------------------------------------
  //
  // Reading history is reading the project; POST here is only because these
  // take work, exactly like the export lane on the hub.
  '/_api/git/status': { safe: 'read', unsafe: 'read' },
  '/_api/git/log': { safe: 'read', unsafe: 'read' },
  '/_api/git/diff': { safe: 'read', unsafe: 'read' },
  '/_api/git/branches': { safe: 'read', unsafe: 'read' },
  // Fetching moves remote-tracking refs and nothing else — no working tree, no
  // index. It stays a read.
  '/_api/git/fetch': { safe: null, unsafe: 'read' },
  // PULL AND CHECKOUT REWRITE THE WORKING TREE, AND IN A CELL THERE IS ONE OF
  // IT — Cloud Phase 27 D2.
  //
  // Both were `read`, on the reasoning that "looking at another branch is not
  // changing one", which the desktop's own read-only allowlist reaches for the
  // same reason. That reasoning is TRUE FOR ONE USER AT ONE CHECKOUT and false
  // here: this tree is shared by everyone in the project, so a viewer switching
  // branches replaces the files under an owner who is mid-edit, and a viewer
  // pulling merges into them. That is not reading — it is the most destructive
  // write in the product, performed by the role that is supposed to hold none.
  //
  // The desktop is unaffected: it never consults this manifest (it is the
  // cell's proxy table), and there the reasoning that made `read` right still
  // holds.
  '/_api/git/pull': { safe: null, unsafe: 'edit' },
  '/_api/git/checkout': { safe: null, unsafe: 'edit' },
  '/_api/git/branch': { safe: null, unsafe: 'edit' },
  '/_api/git/commit': { safe: null, unsafe: 'edit' },
  '/_api/git/discard': { safe: null, unsafe: 'edit' },
  '/_api/git/fold': { safe: null, unsafe: 'edit' },
  '/_api/git/resolve': { safe: null, unsafe: 'edit' },
  // Pushing sends this project somewhere else. Owner-only, same row as the
  // mirror lane it ends up driving (DDR-201).
  '/_api/git/push': { safe: null, unsafe: 'mirror' },

  // ---- accepted history (DDR-241, plan T27/T28) ---------------------------
  //
  // Reading the project's history is reading the project. Restore is a NEW
  // action any editor may take. Personal undo is REFUSED here: through the
  // door every browser editor proposes under the studio's one credential, so
  // "your own action" cannot be told apart from a teammate's — an undo would
  // be able to target someone else's work. It returns with per-person
  // attribution through the door.
  '/_api/project/history': { safe: 'read', unsafe: 'read' },
  '/_api/project/restore': { safe: null, unsafe: 'edit' },
  '/_api/project/undo': REFUSED,
  // Signs in and stores a credential on the machine that serves it — that is
  // the desktop's own copy-making step, never something a cell does for a
  // visitor (plan T21).
  '/_api/projects/prepare': REFUSED,
  // An unfinished AI edit is a desktop agent's (the cell runs no agent — the
  // chat lanes above are refused too).
  '/_api/project/ai-action': REFUSED,
  // A source conflict is a desktop checkout's (the cell's studio projects the
  // project, it holds no candidate of a person's).
  '/_api/project/conflict': REFUSED,
  // Preparing a device for offline work is a desktop's; a cell IS the copy.
  '/_api/sync/offline': REFUSED,

  // ---- refused in a cell, on the record ----------------------------------
  //
  // Every one of these is ALSO pruned out of the studio's own route table by
  // `pruneForWorkspace()`, so the proxy would 404 rather than 403 anyway. They
  // are named here because a manifest that only lists what it allows cannot
  // tell "denied on purpose" from "nobody has looked at it yet", and that
  // difference is the entire value of the E3 gate.
  // The SYNCHRONOUS render stays refused — in the cloud a render is always a
  // JOB (feature-cloud-export-render-workers): the cell enqueues, the
  // maude-render service evaluates (DDR amending DDR-209 A′1), the member
  // downloads. The job rows moved up into the "reading the project" section.
  '/_api/export': REFUSED,
  // Spawns a headless browser against the studio — the same evaluation
  // `/_api/export` is forbidden for, and there is no browser in a cell image.
  '/_api/shell-shot': REFUSED,
  '/_api/generate-jobs': REFUSED,
  '/_api/generate/audio-reuse': REFUSED,
  '/_api/generate/audio-search': REFUSED,
  '/_api/generate/keyframe-model': REFUSED,
  '/_api/generate/keys': REFUSED,
  '/_api/generate/prefs': REFUSED,
  '/_api/generate/providers': REFUSED,
  '/_api/generate/whisper-model': REFUSED,
  '/_api/acp/attachment': REFUSED,
  '/_api/acp/chat': REFUSED,
  '/_api/acp/chats': REFUSED,
  '/_api/acp/focus': REFUSED,
  '/_api/acp/status': REFUSED,
  '/_api/claude/install': REFUSED,
  '/_api/claude/install-status': REFUSED,
  '/_api/claude/signin': REFUSED,
  '/_api/claude/signin-cancel': REFUSED,
  '/_api/claude/signin-status': REFUSED,
  '/_api/cloud/attach': REFUSED,
  '/_api/cloud/attach/code': REFUSED,
  '/_api/cloud/projects': REFUSED,
  '/_api/cloud/signin/poll': REFUSED,
  '/_api/cloud/signin/start': REFUSED,
  '/_api/cloud/signout': REFUSED,
  '/_api/cloud/status': REFUSED,
  '/_api/github/clone': REFUSED,
  '/_api/github/create-project': REFUSED,
  '/_api/github/create-repo': REFUSED,
  '/_api/github/identity': REFUSED,
  '/_api/github/invite': REFUSED,
  '/_api/github/repos': REFUSED,
  '/_api/hub/link': REFUSED,
  '/_api/debug-bundle': REFUSED,
  '/_api/design/init': REFUSED,
  // Resync + the sweep cancel (v0.60.0) restart the SYNC RUNTIME of whatever
  // process serves this project. On a laptop that is the person's own studio
  // and the whole point of the button. On a cell it is shared infrastructure:
  // one member could tear down and re-link every document for everyone, on
  // demand, as often as they liked. That is an operator action, not a member
  // one — and a cell's assets already live on the cell, so there is nothing for
  // a sweep to fetch here anyway.
  '/_api/sync/resync': REFUSED,
  '/_api/sync/cancel-assets': REFUSED,
  // feature-before-first-external-users Task 2/3 — the sync Settings toggles,
  // ownership (adopt/detach) and the _trash restore/prune. Same reasoning as
  // resync, sharpened: on a cell these mutate the OPERATOR's checkout — its
  // config.json, its .gitignore + git index, its quarantined files — and can
  // restart the shared sync runtime. A browsing member gets none of those
  // levers; the desktop, where the person owns the machine, is their home.
  '/_api/sync/settings': REFUSED,
  '/_api/sync/ownership': REFUSED,
  '/_api/sync/trash': REFUSED,
  // Signing in to a workspace from INSIDE that workspace is a loop; the proxy
  // already knows who this is, and the control plane is the only authority that
  // could say otherwise (DDR-204).
  '/_api/workspace/sign-in': REFUSED,
  '/_api/workspace/disclosure': REFUSED,
  // A cell serves ONE project. Creating a second one on its disk is a control-
  // plane action, and there is no UI in a browser tab that should reach it.
  '/_api/project/create-local': REFUSED,
});

/**
 * Prefix rules, longest-match-wins, consulted only when no exact path matched.
 *
 * Deliberately short. Every entry here is a lane whose members are generated
 * (a file path, a comment id) rather than declared, so an exact table cannot
 * enumerate them — which is also why each one is read-only or narrowly scoped.
 */
export const STUDIO_PREFIXES = Object.freeze([
  // POST /_api/comments/<id>/reply — the dynamic half of the comment lane.
  { prefix: '/_api/comments/', safe: 'read', unsafe: 'comment' },
  // The client bundle + stylesheet + raw client sources the dev fallback serves.
  { prefix: '/_client/', safe: 'read', unsafe: null },
  // Bundled Maude-product media (the intro showreel) and sticker packs — ours,
  // not the tenant's.
  { prefix: '/_media/', safe: 'read', unsafe: null },
  { prefix: '/_stickers/', safe: 'read', unsafe: null },
]);

/**
 * The design-system asset read lane — `/<designRoot>/…/assets/…`.
 *
 * Why it needs its own matcher rather than a `STUDIO_PREFIXES` entry: a plain
 * prefix would expose the studio's fall-through, which serves the designRoot
 * AND everything else under the repo root. On a laptop that is right; on a cell
 * it would hand a viewer the whole tenant repository.
 *
 * The readable set is therefore defined as EXACTLY the writable set:
 * `checkoutAssetRel` is the same validator the desktop's asset PUT and the
 * presence probe already run, so "what a peer may push" and "what a member may
 * read back" cannot drift apart. It requires an `assets` path segment, caps
 * depth and length, refuses traversal and control characters, allows only
 * binary asset extensions — and, because every segment must START with an
 * alphanumeric, it rejects DDR-115 runtime state (`_history/`, `_chat/`,
 * `_comments/`, `_untrusted/`, …) without needing a second rule about it.
 *
 * Reported 2026-08-13: a design system's logos, fonts and photographs all 404'd
 * in the cloud file browser while the same files rendered inside canvases. The
 * canvas ORIGIN has always had this lane (`isCanvasSafe` in the studio's
 * http.ts); the main origin never did, so nothing had declared it here and the
 * default-closed `classify` refused it as `unclassified`.
 *
 * @returns {string | null} the matched prefix, or null when this is not one.
 */
function designAssetLane(pathname) {
  const root = (process.env.MAUDE_DESIGN_ROOT ?? '.design').replace(/^\/+|\/+$/g, '');
  if (!root) return null;
  const prefix = `/${root}/`;
  if (!pathname.startsWith(prefix)) return null;
  let rel = pathname.slice(prefix.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  return checkoutAssetRel(rel) === null ? null : prefix;
}

/**
 * The design-system tokens-CSS read lane — `/<designRoot>/…/*.css`.
 *
 * Reported 2026-08-13 (same day, same family as the asset lane above): the
 * inspector's Variables tab was empty on every cloud session — "No color
 * tokens", "No match" — while the desktop showed the full set. The client
 * fetches each DS's tokens CSS from the MAIN origin
 * (`/${designRel}/${ds.tokensCssRel}`, `useAllDsTokens` in client/app.jsx);
 * the asset lane refuses it — `.css` is deliberately outside
 * `CHECKOUT_ASSET_EXTS` so the asset PUT can never overwrite a stylesheet, and
 * a tokens file has no `assets` segment — so the default-closed `classify`
 * answered 404 and the shell had zero tokens. (Canvases still rendered styled:
 * the canvas ORIGIN serves designRoot files through its own `isCanvasSafe`
 * lane, which is why only the shell UI went blind.)
 *
 * Same shape discipline as the asset lane — `checkoutRelShape` is the shared
 * home for the segment rules (charset-safe, starts-alphanumeric ⇒ DDR-115
 * runtime state excluded, no traversal, depth/length caps) — with the
 * extension pinned to exactly `.css`. `CHECKOUT_ASSET_EXTS` itself must NOT
 * grow `.css`: that set also gates the WRITE surface, and this lane is
 * read-only by construction (`classify` grants it no unsafe capability).
 *
 * Exposure: any `.css` under designRoot becomes readable to authenticated
 * project members on the main origin — the same bytes the canvas origin
 * already serves to the same people, so no new trust boundary is crossed.
 *
 * @returns {string | null} the matched prefix, or null when this is not one.
 */
function designTokensLane(pathname) {
  const root = (process.env.MAUDE_DESIGN_ROOT ?? '.design').replace(/^\/+|\/+$/g, '');
  if (!root) return null;
  const prefix = `/${root}/`;
  if (!pathname.startsWith(prefix)) return null;
  let rel = pathname.slice(prefix.length);
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return null;
  }
  const parts = checkoutRelShape(rel);
  if (!parts) return null;
  const last = parts[parts.length - 1];
  const dot = last.lastIndexOf('.');
  if (dot < 1) return null;
  return last.slice(dot + 1).toLowerCase() === 'css' ? prefix : null;
}

/**
 * Classify one request.
 *
 * @returns {{ capability: string, matched: string } | { capability: null, matched: string | null }}
 */
export function classify(method, pathname) {
  const safe = SAFE_METHODS.has(method);
  const exact = Object.hasOwn(STUDIO_ROUTES, pathname) ? STUDIO_ROUTES[pathname] : null;
  if (exact) {
    if (exact === REFUSED) return { capability: null, matched: pathname };
    return { capability: safe ? exact.safe : exact.unsafe, matched: pathname };
  }
  // Read-only by construction: an unsafe method here yields a null capability
  // with a non-null `matched`, which `decide` reports as a METHOD refusal —
  // the same shape every other read-only prefix produces.
  const design = designAssetLane(pathname) ?? designTokensLane(pathname);
  if (design) return { capability: safe ? 'read' : null, matched: design };
  let best = null;
  for (const rule of STUDIO_PREFIXES) {
    if (!pathname.startsWith(rule.prefix)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  if (best) return { capability: safe ? best.safe : best.unsafe, matched: best.prefix };
  return { capability: null, matched: null };
}

/**
 * The proxy's verdict for one request.
 *
 * `reason` is the product surface: `unclassified` means nobody has decided
 * about this route and it is being refused for that reason alone, which is a
 * very different bug report from `role`.
 *
 * @returns {{ allow: true, capability: string } | { allow: false, reason: 'unclassified'|'refused'|'method'|'role', capability: string|null }}
 */
export function decide(method, pathname, role) {
  const { capability, matched } = classify(method, pathname);
  if (capability === null) {
    if (matched === null) return { allow: false, reason: 'unclassified', capability: null };
    // A path that exists in the table but denies this METHOD half is a method
    // refusal; one marked REFUSED outright is a policy refusal.
    const entry = Object.hasOwn(STUDIO_ROUTES, matched) ? STUDIO_ROUTES[matched] : null;
    if (entry === REFUSED) return { allow: false, reason: 'refused', capability: null };
    return { allow: false, reason: 'method', capability: null };
  }
  if (!can(role, capability)) return { allow: false, reason: 'role', capability };
  return { allow: true, capability };
}

/** Every capability the manifest names — the E3 gate cross-checks this set
 *  against `role-matrix.mjs` so a typo cannot become a silent allow. */
export function capabilitiesUsed() {
  const used = new Set();
  for (const entry of Object.values(STUDIO_ROUTES)) {
    if (entry === REFUSED) continue;
    if (entry.safe) used.add(entry.safe);
    if (entry.unsafe) used.add(entry.unsafe);
  }
  for (const rule of STUDIO_PREFIXES) {
    if (rule.safe) used.add(rule.safe);
    if (rule.unsafe) used.add(rule.unsafe);
  }
  return used;
}

/** Sanity, executed at import: no capability in the table is unknown to the
 *  matrix. A typo here would `can(role, 'edti')` → false → a route that is
 *  simply never reachable, which is the quietest possible failure. */
for (const capability of capabilitiesUsed()) {
  if (!CAPABILITIES.includes(capability)) {
    throw new Error(
      `studio-manifest: '${capability}' is not a capability in role-matrix.mjs — ` +
        `one table, one authority (Cloud Phase 25 C4).`
    );
  }
}
