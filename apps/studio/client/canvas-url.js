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

export function urlOf(p) {
  return '/' + p.split('/').map(encodeURIComponent).join('/');
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
  // Phase 27 (E2) — DiffView renders a CLEAN canvas (no editor chrome: toolbar,
  // world minimap, devtools) so the before/after is just the design.
  if (opts?.hideChrome) params.set('hide-chrome', '1');
  // Cloud Phase 25 C2 — the linked hub vouched a viewer role at sign-in
  // (`/_config.readOnly`), so the canvas boots read-only: edit tools and
  // mutating interactions are ABSENT from the iframe chrome (read-only-mode.ts
  // reads this flag). Boot-static on purpose — a role is per-session, and a
  // query param can't race the way a post-load message could.
  if (cfg?.readOnly) params.set('ro', '1');
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
  const tokens = specMatch
    ? specDsEntry?.tokensCssRel || `system/${specMatch[1]}/colors_and_type.css`
    : uiDs?.tokensCssRel || cfg?.tokensCssRel;
  if (tokens) params.set('tokens', tokens);
  if (cfg?.componentsCssRel) params.set('components', cfg.componentsCssRel);
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
    if (!cfg?.componentsCssRel) {
      params.set('components', `${uiDs.path}/preview/_components.css`);
    }
  }
  // T2 (9.1-A) — load the iframe from the segregated canvas origin when the
  // server advertises one; fall back to a same-origin relative URL otherwise
  // (older server, tests). The trailing path + query are identical either way.
  const origin = cfg?.canvasOrigin || '';
  return `${origin}/_canvas-shell.html?${params.toString()}`;
}
