// Maude Cloud wears the Maude design system — Cloud Phase 22.
//
// The cloud pages were built on `system-ui` and a couple of hand-picked greys,
// which is exactly the thing this project's own rules forbid: when a project
// has a design system, that system IS the spec. These pages are the first
// thing anyone sees of Maude, and they were the one surface not using it.
//
// WHAT IS LIFTED, AND FROM WHERE:
//
//   tokens  — a SUBSET of `.design/system/maude/colors_and_type.css`, copied
//             verbatim. Not re-derived, not "close enough": a drift test
//             asserts every value here still matches the source (brand.test.mjs).
//   mark    — the spark-on-bubble from `system/maude/preview/logo.tsx`, path
//             and all, with the bubble's squared bottom-right corner. A brand
//             mark in a canvas IS the stored specimen's mark (DDR-141); it is
//             never redrawn from memory, because a redrawn mark is a second
//             mark.
//
// WHY A SUBSET RATHER THAN THE WHOLE FILE. These are small server-rendered
// pages with no external stylesheet (the share view's CSP forbids one, and the
// dashboard deliberately ships nothing it does not need). Inlining 187 lines
// of tokens into every response to use fifteen of them would be waste. The
// drift test is what makes a subset safe.

/**
 * The ONE address every "get the app" link in the product points at
 * (Cloud Phase 24 A7).
 *
 * Not a release list, not a GitHub page: one page that hands a non-technical
 * person the right file for their machine, and that is also where the honest
 * warning about the unsigned Windows build lives. A second download address is
 * a second place that can go stale while somebody is following instructions.
 */
export const DESKTOP_DOWNLOAD_URL = 'https://maude.sh/desktop';

/**
 * Tokens, verbatim from the design system. Dark is the default theme there,
 * and it is the default here — same reason: this is app chrome, not a
 * document.
 */
export const TOKENS = `
:root {
  --bg-0: oklch(0.165 0.012 255);
  --bg-1: oklch(0.198 0.012 255);
  --bg-2: oklch(0.232 0.013 255);
  --bg-3: oklch(0.270 0.013 252);
  --bg-4: oklch(0.310 0.014 252);
  --border-subtle:  oklch(0.290 0.012 255);
  --border-default: oklch(0.360 0.013 252);
  --border-strong:  oklch(0.450 0.014 250);
  --fg-0: oklch(0.955 0.005 250);
  --fg-1: oklch(0.790 0.008 250);
  --fg-2: oklch(0.660 0.010 250);
  --fg-3: oklch(0.500 0.010 250);
  --accent:        oklch(0.680 0.180 268);
  --accent-hover:  oklch(0.730 0.170 268);
  --accent-active: oklch(0.630 0.180 268);
  --accent-fg:     oklch(0.180 0.030 268);
  --accent-muted:  oklch(0.460 0.110 268);
  --accent-tint:   color-mix(in oklab, var(--accent) 16%, transparent);
  --status-success: oklch(0.760 0.150 162);
  --status-warn:    oklch(0.800 0.130 78);
  --status-error:   oklch(0.660 0.190 25);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.40);
  --shadow-md: 0 4px 14px rgba(0, 0, 0, 0.46);
  --radius-xs: 3px;
  --radius-sm: 5px;
  --radius-md: 7px;
  --radius-lg: 10px;
  --radius-xl: 14px;
  --radius-pill: 999px;
  --space-1: 2px;
  --space-2: 4px;
  --space-3: 8px;
  --space-4: 12px;
  --space-5: 16px;
  --space-6: 24px;
  --space-7: 32px;
  --space-8: 48px;
  --font-display: "Inter Tight", "Inter", system-ui, -apple-system, sans-serif;
  --font-body:    "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono:    "JetBrains Mono", "Geist Mono", ui-monospace, "SF Mono", Menlo, monospace;
  --type-xs:   11px;   --lh-xs:   16px;
  --type-sm:   12px;   --lh-sm:   18px;
  --type-base: 14px;   --lh-base: 20px;
  --type-md:   16px;   --lh-md:   24px;
  --type-lg:   19px;   --lh-lg:   26px;
  --type-xl:   23px;   --lh-xl:   30px;
  --type-2xl:  28px;   --lh-2xl:  34px;
  --tracking-tight: -0.014em;
  --dur-soft:  120ms;
  --dur-flip:  140ms;
  --ease-out:  cubic-bezier(0.2, 0, 0, 1);
  --canvas-dot: oklch(0.340 0.012 255);
  --canvas-grid: 24px;
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-soft: 1ms; --dur-flip: 1ms; }
}
`;

/**
 * The shared chrome.
 *
 * The dotted canvas is the DS's signature surface (the `--canvas-*` family), so
 * the pages that frame somebody's design work sit on it rather than on flat
 * grey — that is the one visual idea this product has, and leaving it off the
 * front door was the whole problem. Panels share ONE material: same hairline,
 * same radius, same elevation, because cohesion is the identity, in the design
 * system's own words.
 *
 * NO CSS COMMENTS inside these strings. They are shipped to every visitor, and
 * the vocabulary lint reads the rendered HTML — a comment saying "tokens" put
 * our word for our thing in front of a customer. Explanations belong here, in
 * bytes nobody downloads.
 */
export const CHROME = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: var(--space-8) var(--space-5) calc(var(--space-8) * 2);
    font-family: var(--font-body);
    font-size: var(--type-md);
    line-height: var(--lh-md);
    color: var(--fg-0);
    background-color: var(--bg-0);
    background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
    background-size: var(--canvas-grid) var(--canvas-grid);
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 {
    font-family: var(--font-display);
    font-size: var(--type-2xl); line-height: var(--lh-2xl);
    letter-spacing: var(--tracking-tight);
    font-weight: 600; margin: 0 0 var(--space-2);
  }
  h2 {
    font-family: var(--font-display);
    font-size: var(--type-lg); line-height: var(--lh-lg);
    letter-spacing: var(--tracking-tight);
    font-weight: 600; margin: 0 0 var(--space-1);
  }
  p { margin: 0 0 var(--space-5); }
  .quiet { color: var(--fg-2); font-size: var(--type-base); line-height: var(--lh-base); }
  a { color: var(--accent); text-decoration-color: var(--accent-muted); text-underline-offset: 2px; }
  a:hover { color: var(--accent-hover); }
  .card {
    background: var(--bg-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: var(--space-5) var(--space-6);
    box-shadow: var(--shadow-sm);
  }
  .btn { display: inline-block; text-decoration: none; }
  button, .btn {
    font: inherit; font-weight: 600;
    font-size: var(--type-base); line-height: var(--lh-base);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: var(--accent); color: var(--accent-fg);
    cursor: pointer;
    transition: background var(--dur-soft) var(--ease-out);
  }
  button:hover, .btn:hover { background: var(--accent-hover); }
  button:active, .btn:active { background: var(--accent-active); }
  button.ghost {
    background: var(--bg-2); color: var(--fg-1);
    border-color: var(--border-default);
  }
  button.ghost:hover { background: var(--bg-3); color: var(--fg-0); }
  input[type=email], input[type=password], input[type=text], select {
    font: inherit; font-size: var(--type-base);
    width: 100%; padding: var(--space-3) var(--space-4);
    color: var(--fg-0); background: var(--bg-3);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
  }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px;
  }
  label { display: block; font-size: var(--type-sm); font-weight: 600; color: var(--fg-1); margin: var(--space-5) 0 var(--space-2); }
  .error { color: var(--status-error); font-weight: 600; }
  .ok { color: var(--status-success); font-weight: 600; }
  footer { margin-top: var(--space-8); padding-top: var(--space-5); border-top: 1px solid var(--border-subtle); color: var(--fg-2); font-size: var(--type-sm); line-height: var(--lh-sm); }
`;

/**
 * The "Continue with Google" button, and the rules it needs.
 *
 * Lives HERE rather than on the signup surface because it is now needed on
 * three unrelated pages — signup, sign-in, and the invitation's join screen
 * (Cloud Phase 24 A12b). A second copy of a brand-constrained button is how
 * two of them drift.
 *
 * The official multicolor "G" is inline so a page stays a single request and
 * works under the strict CSP. Google's brand rules allow the standard G on a
 * neutral button; the button chrome itself wears our tokens.
 */
export const GOOGLE_BUTTON_CSS = `
  .btn-google {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    background: var(--bg-2); color: var(--fg-0); border: 1px solid var(--border-subtle);
  }
  .btn-google:hover { background: var(--bg-3); color: var(--fg-0); }
  .btn-google:active { background: var(--bg-3); }
  .btn-google svg { flex: none; }
  .btn-google.wide { display: flex; width: 100%; }
  .or {
    display: flex; align-items: center; gap: var(--space-4);
    color: var(--fg-3); font-size: var(--type-sm);
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: var(--space-5) 0;
  }
  .or::before, .or::after { content: ""; flex: 1; border-top: 1px solid var(--border-subtle); }
`;

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.2C40.7 35.7 44 30.3 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>`;

export function googleButton({ next = null, wide = false } = {}) {
  const href = next ? `/auth/google?next=${encodeURIComponent(next)}` : '/auth/google';
  return `<a class="btn btn-google${wide ? ' wide' : ''}" href="${href}">${GOOGLE_G} Continue with Google</a>`;
}

/**
 * The mark: the spark on its bubble tile.
 *
 * Path and geometry lifted verbatim from `system/maude/preview/logo.tsx` +
 * `logo.css` — including the squared bottom-right corner, which is the thing
 * that makes it the Maude mark rather than a generic star in a rounded box.
 */
export function lockup({ size = 26, words = 'Maude Cloud', href = '/' } = {}) {
  // A LINK, not a decoration (Cloud Phase 23 A2). Every page wearing the mark
  // gets the way home for free — the return leg people reach for first.
  return `<a class="lockup" href="${href}">
    <span class="mark" style="width:${size}px;height:${size}px">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z" fill="currentColor"/>
      </svg>
    </span>
    <span class="word">${words}</span>
  </a>`;
}

// `border-radius: 24% 24% 0 24%` is TL · TR · BR(square) · BL — the bubble.
// The squared bottom-right corner is what makes it the Maude mark rather than
// a star in a rounded box.
export const LOCKUP_CSS = `
  .lockup { display: inline-flex; align-items: center; gap: 0.34em; margin-bottom: var(--space-6); text-decoration: none; }
  .mark {
    display: grid; place-items: center; flex: none;
    background: var(--accent); color: var(--accent-fg);
    border-radius: 24% 24% 0 24%;
    box-shadow: 0 0 0 3px var(--accent-tint);
  }
  .mark svg { width: 66%; height: 66%; display: block; }
  .word {
    font-family: var(--font-display); font-weight: 600;
    font-size: var(--type-lg); letter-spacing: -0.03em; line-height: 1;
    color: var(--fg-0);
  }
`;

/** Everything a cloud page needs, in one string. */
export const PAGE_CSS = TOKENS + CHROME + LOCKUP_CSS;

// ───────────────────────────── The admin shell ─────────────────────────────
//
// Lifted from the DS platform showcase (`ui_kits-desktop-showcase`), the
// Tier-0 prior for shell chrome: a GRID with 1px hairline seams (the seam
// colour is the grid's background showing through the gaps), ONE material
// (--bg-1) across every chrome region, the dotted canvas as the deepest
// surface framed by the chrome, panel headers in mono uppercase XS, a thin
// status bar, and the accent used sparingly — the active nav row is a raised
// fill (--bg-4), exactly like the showcase's active tool.

export const SHELL_CSS = `
  html, body { height: 100%; }
  body {
    margin: 0; padding: 0;
    font-family: var(--font-body); font-size: var(--type-base); line-height: var(--lh-base);
    color: var(--fg-0); background: var(--bg-0);
    -webkit-font-smoothing: antialiased;
  }
  .shell {
    display: grid; min-height: 100vh;
    grid-template-columns: 232px 1fr;
    grid-template-rows: 52px 1fr 32px;
    grid-template-areas: "top top" "nav main" "foot foot";
    gap: 1px; background: var(--border-default);
  }
  .shell > * { background: var(--bg-1); min-width: 0; }

  .top { grid-area: top; display: flex; align-items: center; gap: var(--space-4); padding: 0 var(--space-5); }
  .top .lockup { margin: 0; }
  .top .word { font-size: var(--type-md); }
  .top-spacer { flex: 1; }
  .who-mail { color: var(--fg-2); font-size: var(--type-sm); }
  .top form { margin: 0; }

  .nav { grid-area: nav; display: flex; flex-direction: column; overflow-y: auto; padding-bottom: var(--space-5); }
  .nav-hd {
    padding: var(--space-4) var(--space-4) var(--space-2) var(--space-5);
    font-family: var(--font-mono); font-size: var(--type-xs);
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-2);
  }
  .nav-item {
    display: flex; align-items: center; gap: var(--space-3);
    margin: 0 var(--space-3); padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    color: var(--fg-1); font-size: var(--type-base); text-decoration: none;
    transition: background var(--dur-soft) var(--ease-out), color var(--dur-soft) var(--ease-out);
  }
  .nav-item:hover { background: var(--bg-2); color: var(--fg-0); }
  .nav-item[aria-current="page"] { background: var(--bg-4); color: var(--fg-0); font-weight: 600; }
  .nav-item .g { color: var(--fg-2); }
  .nav-item[aria-current="page"] .g { color: var(--accent); }
  .nav-item.danger { color: var(--status-error); }
  .nav-item.danger .g { color: var(--status-error); }
  .nav-sep { height: 1px; background: var(--border-subtle); margin: var(--space-4) var(--space-5); flex: none; }
  .nav-foot { margin-top: auto; }

  .g { width: 15px; height: 15px; display: block; flex: none; }
  .g path, .g rect, .g circle, .g line, .g polyline {
    fill: none; stroke: currentColor; stroke-width: 1.25;
    stroke-linecap: round; stroke-linejoin: round;
  }

  .main {
    /* CHROME's document-page rule (main { max-width; margin auto }) must not
       shrink the shell's main REGION — the column lives in .main-inner. */
    max-width: none; margin: 0;
    grid-area: main; overflow-y: auto;
    background-color: var(--bg-0);
    background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
    background-size: var(--canvas-grid) var(--canvas-grid);
    padding: var(--space-7) var(--space-8) calc(var(--space-8) * 1.5);
  }
  .main-inner { max-width: 46rem; }
  .page-hd { display: flex; align-items: baseline; gap: var(--space-4); flex-wrap: wrap; margin: 0 0 var(--space-2); }
  .page-hd h1 { margin: 0; }
  .lede { color: var(--fg-2); font-size: var(--type-base); line-height: var(--lh-base); margin: 0 0 var(--space-6); max-width: 40rem; }

  .foot {
    /* CHROME's document-footer rule (margin-top + padding-top) would push
       this out of its 32px grid row. */
    margin: 0; padding-top: 0;
    grid-area: foot; display: flex; align-items: center; gap: var(--space-5);
    padding: 0 var(--space-5); font-size: var(--type-xs); color: var(--fg-2);
    border-top: 1px solid var(--border-subtle); white-space: nowrap; overflow: hidden;
  }
  .foot .promise { overflow: hidden; text-overflow: ellipsis; }
  .foot-spacer { flex: 1; }

  .state {
    font-size: var(--type-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: var(--space-1) var(--space-3); border-radius: var(--radius-pill);
    border: 1px solid transparent; white-space: nowrap;
  }
  .state.ok   { color: var(--status-success); border-color: color-mix(in oklab, var(--status-success) 32%, transparent); }
  .state.warn { color: var(--status-warn);    border-color: color-mix(in oklab, var(--status-warn) 32%, transparent); }
  .state.stop { color: var(--status-error);   border-color: color-mix(in oklab, var(--status-error) 32%, transparent); }

  @media (max-width: 760px) {
    .shell { grid-template-columns: 1fr; grid-template-rows: 52px auto 1fr 32px; grid-template-areas: "top" "nav" "main" "foot"; }
    .nav { flex-direction: row; flex-wrap: wrap; align-items: center; padding: var(--space-2) var(--space-3); }
    .nav-hd, .nav-sep { display: none; }
    .nav-foot { margin-top: 0; }
    .main { padding: var(--space-6) var(--space-5); }
  }
`;

/** 1px-stroke glyphs, showcase recipe (fill:none, currentColor). */
export const GLYPHS = {
  grid: '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>',
  plus: '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>',
  open: '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3H3v10h10v-3"/><path d="M9 3h4v4"/><line x1="13" y1="3" x2="7" y2="9"/></svg>',
  people:
    '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="5.5" r="2.5"/><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4"/><path d="M11 9.2c1.7.4 3 1.9 3 3.8"/><path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.6"/></svg>',
  card: '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="4" width="12" height="8" rx="1.5"/><line x1="2" y1="7" x2="14" y2="7"/></svg>',
  branch:
    '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="4" r="1.8"/><circle cx="4.5" cy="12" r="1.8"/><circle cx="11.5" cy="6" r="1.8"/><path d="M4.5 5.8v4.4"/><path d="M11.5 7.8c0 2.4-3 2.2-5 3.2"/></svg>',
  clock:
    '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><polyline points="8 5 8 8 10.5 9.5"/></svg>',
  down: '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7"/><polyline points="5 7 8 10 11 7"/><path d="M3 12.5h10"/></svg>',
  trash:
    '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 5h9"/><path d="M6.5 5V3.5h3V5"/><path d="M5 5l.6 8h4.8L11 5"/></svg>',
  share:
    '<svg class="g" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="4" r="1.8"/><circle cx="12" cy="12" r="1.8"/><line x1="5.6" y1="7.2" x2="10.4" y2="4.8"/><line x1="5.6" y1="8.8" x2="10.4" y2="11.2"/></svg>',
};

function escAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function navItem({ href, label, glyph, active = false, danger = false }) {
  return `<a class="nav-item${danger ? ' danger' : ''}" href="${escAttr(href)}"${active ? ' aria-current="page"' : ''}>${GLYPHS[glyph] ?? ''}<span>${escAttr(label)}</span></a>`;
}

/**
 * The signed-in admin shell. Server-rendered, no script — the same grid the
 * DS showcase stages, worn by the product's own control surface.
 *
 * @param {object} args
 * @param {{email: string}} args.account
 * @param {string} args.title            document + page title
 * @param {string} args.body             main-column HTML (already escaped)
 * @param {object|null} [args.project]   {id, name} — adds the project section
 * @param {boolean} [args.isOwner]       owner-only nav entries
 * @param {string} [args.active]         nav key: projects|new|connect|people|billing|mirror|audit|download|delete|operator
 * @param {{tone: string, label: string}|null} [args.pill]  state pill next to the h1
 * @param {string|null} [args.lede]      one quiet sentence under the h1
 * @param {boolean} [args.isOperator]    Cloud Phase 26 — the fleet section, for
 *   the allowlisted operator ONLY. Default false, so a customer's shell is
 *   byte-identical to what it was; the surface must not exist in a page a
 *   tenant can render (project-admin.test.mjs guards the phrasing).
 */
export function appShell({
  account,
  title,
  body,
  project = null,
  isOwner = false,
  isOperator = false,
  active = '',
  pill = null,
  lede = null,
  extraCss = '',
}) {
  const p = project ? `/projects/${escAttr(project.id)}` : '';
  const projectNav = project
    ? `<div class="nav-sep"></div>
       <div class="nav-hd">${escAttr(project.name || project.id)}</div>
       ${navItem({ href: `${p}/connect`, label: 'Open', glyph: 'open', active: active === 'connect' })}
       ${navItem({ href: `${p}/people`, label: 'People', glyph: 'people', active: active === 'people' })}
       ${isOwner ? navItem({ href: `${p}/billing`, label: 'Billing', glyph: 'card', active: active === 'billing' }) : ''}
       ${isOwner ? navItem({ href: `${p}/mirror`, label: 'GitHub copy', glyph: 'branch', active: active === 'mirror' }) : ''}
       ${isOwner ? navItem({ href: `${p}/saving`, label: 'Saving', glyph: 'clock', active: active === 'saving' }) : ''}
       ${navItem({ href: `${p}/audit`, label: 'Activity', glyph: 'clock', active: active === 'audit' })}
       ${navItem({ href: `${p}/download`, label: 'Download everything', glyph: 'down', active: active === 'download' })}
       ${isOwner ? navItem({ href: `${p}/delete`, label: 'Delete project…', glyph: 'trash', active: active === 'delete', danger: true }) : ''}`
    : '';
  // Cloud Phase 26 — the fleet, for the one person allowed to see all of it.
  // Gated at the SHELL as well as at the route: a nav entry a customer can see
  // but not open is an invitation to try, and this section's existence is
  // itself information they have no reason to hold.
  const operatorNav = isOperator
    ? `<div class="nav-sep"></div>
       <div class="nav-hd">Fleet</div>
       ${navItem({ href: '/operator', label: 'Overview', glyph: 'grid', active: active === 'operator' })}
       ${navItem({ href: '/operator/projects', label: 'All projects', glyph: 'open', active: active === 'operator-projects' })}
       ${navItem({ href: '/operator/accounts', label: 'All accounts', glyph: 'people', active: active === 'operator-accounts' })}
       ${navItem({ href: '/operator/events', label: 'Usage', glyph: 'clock', active: active === 'operator-events' })}`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escAttr(title)} — Maude</title><style>${TOKENS}${CHROME}${LOCKUP_CSS}${SHELL_CSS}${extraCss}</style></head><body>
<div class="shell">
  <header class="top">
    ${lockup()}
    <span class="top-spacer"></span>
    <span class="who-mail">${escAttr(account?.email ?? '')}</span>
    <form method="post" action="/auth/logout"><button type="submit" class="ghost">Sign out</button></form>
  </header>
  <nav class="nav" aria-label="Main">
    <div class="nav-hd">Workspace</div>
    ${navItem({ href: '/', label: 'Your projects', glyph: 'grid', active: active === 'projects' })}
    ${navItem({ href: '/projects/new', label: 'Start a project', glyph: 'plus', active: active === 'new' })}
    ${navItem({ href: '/account', label: 'Account', glyph: 'people', active: active === 'account' })}
    ${projectNav}
    ${operatorNav}
  </nav>
  <main class="main"><div class="main-inner">
    <div class="page-hd"><h1>${escAttr(title)}</h1>${pill ? `<span class="state ${escAttr(pill.tone)}">${escAttr(pill.label)}</span>` : ''}</div>
    ${lede ? `<p class="lede">${escAttr(lede)}</p>` : ''}
    ${body}
  </div></main>
  <footer class="foot">
    <span>Maude Cloud</span>
    <span class="foot-spacer"></span>
    <span class="promise">Everything here is yours to take — every project can be downloaded in full, at any time, including after you stop paying for it.</span>
  </footer>
</div>
</body></html>`;
}
