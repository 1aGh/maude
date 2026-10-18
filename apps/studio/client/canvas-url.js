// Canvas iframe URL builder — pure, dependency-free (URLSearchParams only) so it
// is unit-testable without booting React or a DOM. `app.jsx` imports both
// helpers; `test/canvas-url.test.ts` exercises the token-resolution branches.
//
// DDR-093 — a UI canvas resolves its tokens/components from its OWN design
// system (`meta.designSystem`, surfaced by the server as
// `cfg.canvasDesignSystems[path]`), NOT unconditionally from `designSystems[0]`.
// Before this, every `ui/*.tsx` authored under a non-default DS loaded the
// default DS's tokens — whose ladder is scoped to a different `.<rootClass>`
// subtree — so every `var(--*)` went undefined and the canvas rendered white.

// THE CANVAS CAPABILITY EXPIRES (render-token.mjs: 15 minutes) and cannot be
// revoked, so it is short on purpose. A tab open longer than that must carry a
// fresh one or its canvases stop loading and stop updating — every module
// re-import after a teammate's edit answers 401. The shell re-mints it on a
// timer (`refreshCanvasToken` in app.jsx) and records it here; a URL built
// after that carries the fresh capability. `null` until the first refresh:
// the one in `/_config` is then current.
let liveCanvasToken = null;
export function setLiveCanvasToken(token) {
  liveCanvasToken = typeof token === 'string' && token ? token : null;
}
export function currentCanvasToken(cfg) {
  return cfg?.canvasToken ? (liveCanvasToken ?? cfg.canvasToken) : null;
}

/**
 * When to re-mint a capability: at 60% of what is left of it, read off the
 * token's own expiry claim (`e`, ms — render-token.mjs), so the cadence
 * follows the hub's lifetime instead of a copy of it. Never sooner than 30 s
 * (a skewed clock cannot turn this into a busy loop) and never later than
 * 10 minutes; an unreadable token gets the ceiling.
 */
export function canvasTokenRefreshDelay(token, now = Date.now()) {
  const MIN = 30_000;
  const MAX = 10 * 60_000;
  try {
    const body = String(token).slice(0, String(token).lastIndexOf('.'));
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '==='.slice((b64.length + 3) % 4)));
    const left = Number(claims?.e) - now;
    if (!Number.isFinite(left)) return MAX;
    return Math.min(MAX, Math.max(MIN, Math.floor(left * 0.6)));
  } catch {
    return MAX;
  }
}

/**
 * The same canvas URL carrying a different capability. Used when a frame's
 * own document was refused as expired (a hard reload, a laptop that slept
 * past the re-mint): only `t` changes, so the frame comes back where it was.
 */
export function withCanvasToken(src, token) {
  try {
    const u = new URL(src);
    u.searchParams.set('t', token);
    return u.toString();
  } catch {
    return src;
  }
}

export function urlOf(p) {
  return '/' + p.split('/').map(encodeURIComponent).join('/');
}

// ---------------------------------------------------------------------------------------------------
// S10.4 — which design-system revision a canvas renders (V2-1.6 §5.8)
//
// The server puts `dsConverted` (system → bool), `systemHeads` (system → head id | null),
// `canvasDsRevs` (canvas → the revision it was left on) and `dsRevGaps` (revision id → the peer we
// wait for | null; the revision is referenced here but not on this disk) on the index payload. A
// converted system's followers load `revisions/<head>.{tokens,components}.css`, a left-out canvas the
// ones of its `dsRev`; the Design system canvas and the specimens keep the working files. A missing
// revision falls back dsRev → head → working files and says who it waits for.
// ---------------------------------------------------------------------------------------------------
const REV_ID = /^[0-9a-f]{64}$/;

function dsLookup(map, p, rel, designRel) {
  if (!map || typeof map !== 'object') return undefined;
  if (Object.hasOwn(map, p)) return map[p];
  const full = `${designRel}/${rel}`;
  return Object.hasOwn(map, full) ? map[full] : undefined;
}

function dsRenderFor(p, rel, uiDs, cfg, opts) {
  let ds = uiDs;
  let pinned = null;
  let preview = false;
  const pv = typeof opts?.dsPreview === 'string' ? opts.dsPreview : '';
  if (pv) {
    const at = pv.indexOf('@');
    const name = at < 0 ? pv : pv.slice(0, at);
    const id = at < 0 ? null : pv.slice(at + 1);
    const entry = cfg?.designSystems?.find((d) => d.name === name);
    // An unknown system or a malformed id is ignored: the override never invents a path.
    if (entry && (id === null || REV_ID.test(id))) {
      ds = entry;
      pinned = id;
      preview = true;
    }
  }
  if (!ds?.path || !ds.name) return null;
  // The Design system canvas renders the working files (plus its pending overlay): path-owned.
  if (!preview && rel === `${ds.path}/design-system.tsx`) return null;
  const working = () => ({
    tokens: ds.tokensCssRel || `${ds.path}/colors_and_type.css`,
    components: `${ds.path}/preview/_components.css`,
  });
  if (cfg?.dsConverted?.[ds.name] !== true) {
    // Previewing an unconverted system: its working files. Otherwise: today's path, untouched.
    return preview ? { rev: null, ...working(), waiting: null } : null;
  }
  const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  const head = cfg?.systemHeads?.[ds.name];
  const own = preview ? pinned : dsLookup(cfg?.canvasDsRevs, p, rel, designRel);
  const chain = [];
  for (const r of [own, head])
    if (typeof r === 'string' && REV_ID.test(r) && !chain.includes(r)) chain.push(r);
  const gaps = cfg?.dsRevGaps && typeof cfg.dsRevGaps === 'object' ? cfg.dsRevGaps : {};
  const rev = chain.find((r) => !Object.hasOwn(gaps, r)) ?? null;
  const first = chain[0];
  const waiting =
    first && rev !== first
      ? { rev: first, peer: typeof gaps[first] === 'string' ? gaps[first] : null }
      : null;
  if (!rev) {
    // Nothing usable yet: the working files (a preview still points at the previewed system's).
    return preview
      ? { rev: null, ...working(), waiting }
      : { rev: null, tokens: null, components: null, waiting };
  }
  return {
    rev,
    tokens: `${ds.path}/revisions/${rev}.tokens.css`,
    components: `${ds.path}/revisions/${rev}.components.css`,
    waiting,
  };
}

/**
 * What `canvasUrl` decided about the design-system revision, for the chrome that has to say so:
 * `{ rev, tokens, components, waiting }` (`waiting` = `{ rev, peer }` while the revision this canvas
 * wants has not reached this Mac, else null), or `null` when the canvas is on today's path (an
 * unconverted system, a specimen, the Design system canvas).
 */
export function canvasDsRender(p, cfg, opts) {
  if (!p.endsWith('.tsx')) return null;
  const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  let rel = p;
  if (rel.startsWith(designRel + '/')) rel = rel.slice(designRel.length + 1);
  if (/^system\/[^/]+\/preview\//.test(rel)) return null;
  const name = opts?.ds ?? dsLookup(cfg?.canvasDesignSystems, p, rel, designRel);
  const entry = name ? cfg?.designSystems?.find((d) => d.name === name) : null;
  return dsRenderFor(p, rel, entry || cfg?.designSystems?.[0], cfg, opts);
}

export function canvasUrl(p, cfg, opts) {
  if (!p.endsWith('.tsx')) return urlOf(p);
  const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  // Path under designRoot.
  let rel = p;
  if (rel.startsWith(designRel + '/')) rel = rel.slice(designRel.length + 1);
  // Pass `rel` to URLSearchParams RAW — it does encoding once. Pre-encoding
  // with encodeURIComponent then handing to URLSearchParams produced
  // `Docs%2520Site.tsx` (the `%` of `%20` got re-encoded as `%25`) and broke
  // every UI canvas with a space in its filename.
  const params = new URLSearchParams();
  params.set('canvas', rel);
  params.set('designRel', designRel);
  // Gallery thumbnails suppress the shell-owned comment layer (`?comments=0`)
  // so previews stay non-interactive; opening the same canvas as a real tab
  // omits the flag and gets comments. See canvas-comment-mount.tsx.
  if (opts?.thumbnail) params.set('comments', '0');
  // Phase 27 (E2) — DiffView "before" pane renders the canvas at a past version.
  if (opts?.sha) params.set('sha', opts.sha);
  // S1.14 — Version history's Viewing: the shell frames the past version `ref` (`r<n>` · `git:<sha>`)
  // read-only — `ro=1` (no tools, no drag, no inline edit), no comment layer — and the canvas itself
  // (`isHistoricalCanvas`) writes no camera or layout back and asks the shell for "now" on esc. The
  // chrome stays: it is the same canvas, looked at.
  if (opts?.viewing) {
    params.set('sha', opts.viewing);
    params.set('ro', '1');
    params.set('comments', '0');
  }
  // Phase 27 (E2) — DiffView renders a CLEAN canvas (no editor chrome: toolbar,
  // world minimap, devtools) so the before/after is just the design.
  if (opts?.hideChrome) params.set('hide-chrome', '1');
  // Cloud Phase 25 C2 — the linked hub vouched a viewer role at sign-in
  // (`/_config.readOnly`), so the canvas boots read-only: edit tools and
  // mutating interactions are ABSENT from the iframe chrome (read-only-mode.ts
  // reads this flag). Boot-static on purpose — a role is per-session, and a
  // query param can't race the way a post-load message could.
  if (cfg?.readOnly) params.set('ro', '1');
  // S9.22 — a Can comment session is read-only for the design but may still reply, resolve and reopen:
  // `/_config.canComment` (a role that holds `comment`) says so, and the thread offers those buttons.
  if (cfg?.readOnly && cfg?.canComment) params.set('cm', '1');
  // S9.23 (S9-slices Q9) — presence `surface`: a canvas open in a browser tab says so in the room
  // ("in a browser"). Only a studio window outside the Mac app; previews / embeds / follows publish nothing.
  if (
    !opts?.thumbnail &&
    !opts?.embed &&
    !opts?.follow &&
    typeof window !== 'undefined' &&
    window.location &&
    !window.__TAURI__
  )
    params.set('surf', 'browser');
  // DDR-247 — the chromeless `?embed=1` view another app frames. Read-only
  // whatever the viewer's role (the embed offers looking, nothing else), no
  // comment layer, and `embed=1` so the canvas keeps its camera to itself
  // instead of persisting the embed's fit over the designer's own view.
  if (opts?.embed) {
    params.set('ro', '1');
    params.set('comments', '0');
    params.set('embed', '1');
  }
  // S3.7a — the Present follower (client/v2/present/follow-view.jsx): read-only whatever the role, no
  // comment layer, and `follow=1` so the canvas follows the presenter, persists no camera and never
  // publishes a Present position of its own (read-only-mode.ts `isFollowCanvas`).
  if (opts?.follow) {
    params.set('ro', '1');
    params.set('comments', '0');
    params.set('follow', '1');
  }
  // Cloud Phase 27 (DDR-209) — the canvas origin's capability. On a desktop the
  // canvas origin is loopback and needs none, so this is absent and the URL is
  // byte-identical to before. In the cloud it is a cookieless, cross-site
  // origin: a cookie scoped widely enough to cover it would be readable by the
  // untrusted canvas content itself, which is the one thing the DDR-054 split
  // exists to prevent — so the capability lives in the URL instead.
  const token = currentCanvasToken(cfg);
  if (token) params.set('t', token);
  const ds0 = cfg?.designSystems?.[0];
  // Specimen detection: anything under `system/<ds>/preview/` belongs to that
  // specific DS, so it must render with *that* DS's tokens — not always the
  // first one. In a multi-DS project this is what keeps each design system's
  // preview distinct (beta previews use beta tokens, not alpha's).
  const specMatch = rel.match(/^system\/([^/]+)\/preview\//);
  const specDsEntry = specMatch
    ? cfg?.designSystems?.find(
        (d) => d.path === `system/${specMatch[1]}` || d.path.endsWith(`/${specMatch[1]}`)
      )
    : null;
  // For a UI canvas (NOT a specimen), honor its declared design system. The
  // explicit `opts.ds` wins (the unit-test seam); otherwise the server-surfaced
  // `cfg.canvasDesignSystems[path]` map tells us which DS this canvas authored
  // against. Unknown DS (single-DS / legacy / default-DS canvas) → `ds0`, which
  // keeps the historical behavior byte-for-byte. DDR-093.
  const uiDsName = !specMatch ? (opts?.ds ?? cfg?.canvasDesignSystems?.[p]) : null;
  const uiDsEntry = uiDsName ? cfg?.designSystems?.find((d) => d.name === uiDsName) : null;
  const uiDs = uiDsEntry || ds0;
  // Resolve tokens path. For a specimen, prefer the matching DS's tokensCssRel
  // (fall back to the `system/<ds>/colors_and_type.css` convention). Otherwise
  // prefer the canvas's own design system's tokensCssRel — falling back to ds0
  // then the legacy top-level `cfg.tokensCssRel` (`system/colors_and_type.css`,
  // usually absent post-bootstrap).
  let tokens = specMatch
    ? specDsEntry?.tokensCssRel || `system/${specMatch[1]}/colors_and_type.css`
    : uiDs?.tokensCssRel || cfg?.tokensCssRel;
  // S10.4 (V2-1.6 §5.8) — a converted system hands a canvas the revision it follows or was left on;
  // `null` (a specimen, an unconverted system, no field on the payload) leaves every line below as it was.
  const dsRender = specMatch ? null : dsRenderFor(p, rel, uiDs, cfg, opts);
  if (dsRender?.tokens) tokens = dsRender.tokens;
  if (tokens) params.set('tokens', tokens);
  if (dsRender?.components) params.set('components', dsRender.components);
  else if (cfg?.componentsCssRel) params.set('components', cfg.componentsCssRel);
  if (specMatch) {
    const dsName = specMatch[1];
    params.set('layout', `system/${dsName}/preview/_layout.css`);
    if (!cfg?.componentsCssRel) {
      params.set('components', `system/${dsName}/preview/_components.css`);
    }
  } else if (uiDs?.path) {
    // UI canvas — load the canvas's own DS `_components.css` so the dc-canvas /
    // dc-section / dc-artboard chrome (and any DS classes the canvas reuses)
    // renders correctly under the same DS as the tokens above.
    if (!cfg?.componentsCssRel && !dsRender?.components) {
      params.set('components', `${uiDs.path}/preview/_components.css`);
    }
  }
  // T2 (9.1-A) — load the iframe from the segregated canvas origin when the
  // server advertises one; fall back to a same-origin relative URL otherwise
  // (older server, tests). The trailing path + query are identical either way.
  const origin = cfg?.canvasOrigin || '';
  return `${origin}/_canvas-shell.html?${params.toString()}`;
}
