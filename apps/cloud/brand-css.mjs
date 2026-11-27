// The stylesheet every cloud page wears, in two parts.
//
//   CHROME — the page itself and the design system's primitives: buttons,
//            fields, the island material, chips, avatars, status words. Ported
//            from `system/maude-v2/preview/_components.css` and
//            `ui/v2/_kit.css`.
//   AD_CSS — the admin pages' own pieces (prefix `ad-`), ported from the
//            canvas's stylesheet, `ui/v2/16 Team Server and Cloud Admin.css`:
//            the nav island, cards, stat tiles, bars, tables, sheets, the role
//            matrix, the operator band.
//
// PORTED, NOT RE-DERIVED. Sizes, radii, spacing, type and colour are the
// canvas's rules with the canvas's token names. Two kinds of rule differ, both
// on purpose:
//
//   - PLACEMENT. An artboard is a fixed 1440 × 980 picture, so its nav, main,
//     sheet and bulk bar are `position: absolute` inside a browser frame. A
//     real page scrolls and has any width: here the nav island sticks to the
//     top of the page, main is in normal flow, and the sheet, its veil and the
//     bulk bar are fixed to the window.
//   - ELEMENTS. The canvas draws a button as a `<span class="btn">`. These
//     pages have real `<button>`, `<input>`, `<select>` and `<table>`, so the
//     element rules below give the bare elements the same look, and a form a
//     page has not been re-marked for still reads as one system.
//
// NO CSS COMMENTS inside these strings. They are shipped to every visitor, and
// the vocabulary lint reads the rendered HTML — a comment saying "tokens" would
// put our word for our thing in front of a customer.
//
// NO COLOUR LITERALS either: every colour is a token (brand.test.mjs).

export const CHROME = `
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--type-base);
    line-height: var(--lh-base);
    font-weight: var(--weight-regular);
    color: var(--fg-0);
    background: var(--bg-0);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--type-2xl); line-height: var(--lh-2xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
  }
  h2 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-display);
    font-size: var(--type-md); line-height: var(--lh-md);
    font-weight: var(--weight-semibold);
  }
  h3 { margin: 0 0 var(--space-1); font-size: var(--type-base); font-weight: var(--weight-semibold); }
  p { margin: 0 0 var(--space-3); }
  ul, ol { margin: 0 0 var(--space-3); padding-left: var(--space-5); }
  dl, dd { margin: 0; }
  strong, b { font-weight: var(--weight-semibold); }
  small { font-size: var(--type-sm); }
  code, .mono { font-family: var(--font-mono); font-size: var(--type-xs); color: var(--fg-1); }
  time { font-variant-numeric: tabular-nums; }
  a { color: var(--accent-text); text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; border-radius: var(--radius-xs); }
  .quiet, .note, .lede, .fine { color: var(--fg-1); font-size: var(--type-sm); line-height: var(--lh-sm); }
  .note, .fine { color: var(--fg-2); }
  .error { color: var(--status-error-text); font-weight: var(--weight-semibold); }
  .ok { color: var(--status-success-text); font-weight: var(--weight-semibold); }
  .num { font-variant-numeric: tabular-nums; }
  .right { text-align: right; white-space: nowrap; }
  form.inline { display: inline; }

  .island {
    background: var(--island-bg);
    backdrop-filter: blur(var(--island-blur)) saturate(1.4);
    -webkit-backdrop-filter: blur(var(--island-blur)) saturate(1.4);
    border-radius: var(--radius-lg);
    box-shadow: var(--island-shadow), inset 0 0 0 0.5px var(--island-edge);
    color: var(--fg-0);
  }

  button, .btn {
    appearance: none;
    display: inline-flex; align-items: center; justify-content: center;
    gap: var(--space-2);
    height: 32px; padding: 0 var(--space-3);
    border: 0; border-radius: var(--radius-md);
    font: inherit; font-size: var(--type-sm); font-weight: var(--weight-semibold); line-height: 1;
    white-space: nowrap; text-decoration: none; cursor: pointer;
    background: var(--bg-3); color: var(--fg-0);
    transition: background var(--dur-flip) var(--ease-out), transform var(--dur-flip) var(--ease-out), box-shadow var(--dur-flip) var(--ease-out);
  }
  button:hover, .btn:hover { background: var(--bg-4); text-decoration: none; }
  button:active, .btn:active { transform: scale(0.97); }
  button:focus-visible, .btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  button[disabled], .btn[disabled] { color: var(--fg-3); cursor: not-allowed; transform: none; }
  .btn--primary, button:not([class]), button.primary, button.wide:not(.ghost):not(.secondary) { background: var(--accent); color: var(--accent-fg); }
  .btn--primary:hover, button:not([class]):hover, button.primary:hover, button.wide:not(.ghost):not(.secondary):hover { background: var(--accent-hover); }
  .btn--primary:active, button:not([class]):active, button.primary:active { background: var(--accent-active); }
  .btn--primary[disabled], button:not([class])[disabled] { background: var(--bg-3); color: var(--fg-3); }
  .btn--ghost, button.ghost { background: transparent; color: var(--fg-1); }
  .btn--ghost:hover, button.ghost:hover { background: var(--bg-3); color: var(--fg-0); }
  .btn--lg { height: 40px; padding: 0 var(--space-4); font-size: var(--type-base); border-radius: var(--radius-lg); }
  .btn--sm, td button:not([class]), li button:not([class]), .ma-need button:not([class]) {
    height: 26px; padding: 0 var(--space-2); font-size: var(--type-xs); border-radius: var(--radius-sm);
  }
  td button:not([class]), li button:not([class]), .ma-need button:not([class]) { background: var(--bg-3); color: var(--fg-0); }
  td button:not([class]):hover, li button:not([class]):hover, .ma-need button:not([class]):hover { background: var(--bg-4); }
  .btn.k-btn-danger, button.danger { background: var(--status-error); color: var(--accent-fg); }
  .btn.wide, button.wide { display: flex; width: 100%; }
  .btn svg, button svg { flex: none; }

  label { display: block; margin: var(--space-3) 0 var(--space-1); font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1); }
  input[type=text], input[type=email], input[type=password], input[type=search], input[type=number],
  input[type=date], input[type=url], input:not([type]), select, textarea {
    font: inherit; font-size: var(--type-sm);
    width: 100%; height: 34px; padding: 0 var(--space-3);
    color: var(--fg-0); background: var(--bg-3);
    border: 0; border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 1px var(--fg-2);
    transition: box-shadow var(--dur-flip) var(--ease-out), background var(--dur-flip) var(--ease-out);
  }
  textarea { height: auto; min-height: 72px; padding: var(--space-2) var(--space-3); line-height: var(--lh-sm); resize: vertical; }
  input::placeholder, textarea::placeholder { color: var(--fg-2); }
  input:focus, select:focus, textarea:focus { outline: none; box-shadow: inset 0 0 0 1.5px var(--accent); }
  input[type=checkbox], input[type=radio] { width: 14px; height: 14px; margin: 0 var(--space-2) 0 0; vertical-align: -2px; accent-color: var(--accent); }
  input[type=checkbox]:focus-visible, input[type=radio]:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
  label:has(> input[type=checkbox]), label:has(> input[type=radio]) { font-size: var(--type-sm); font-weight: var(--weight-regular); color: var(--fg-0); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); }
  .field > label, .field-label { margin: 0; font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1); }
  .field-hint { font-size: var(--type-xs); color: var(--fg-2); }

  .chip {
    display: inline-flex; align-items: center; gap: var(--space-1);
    height: 22px; padding: 0 var(--space-2); border-radius: var(--radius-sm);
    font-size: var(--type-xs); font-weight: var(--weight-medium); color: var(--fg-1); background: var(--bg-3);
    white-space: nowrap;
  }
  .chip--accent { color: var(--accent-text); background: var(--accent-muted); }
  .kbd {
    display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 var(--space-1);
    border-radius: var(--radius-xs); font-size: var(--type-xs); font-family: var(--font-body);
    color: var(--fg-1); background: var(--bg-2);
    box-shadow: inset 0 -1px 0 var(--border-default), inset 0 0 0 0.5px var(--border-default);
  }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--bg-3); }

  .k-ic { display: block; flex: none; }
  .k-av {
    display: inline-grid; place-items: center; flex: none;
    border-radius: var(--radius-pill);
    font-family: var(--font-rounded); font-weight: var(--weight-semibold); line-height: 1;
    color: var(--object-ink);
  }
  .k-av--sm { width: 16px; height: 16px; font-size: var(--type-xs); }
  .k-av--md { width: 24px; height: 24px; font-size: var(--type-xs); }
  .k-av--lg { width: 32px; height: 32px; font-size: var(--type-sm); }
  .k-av--sky { background: var(--object-sky); }
  .k-av--green { background: var(--object-green); }
  .k-av--lilac { background: var(--object-lilac); }
  .k-av--yellow { background: var(--object-yellow); }
  .k-av--coral { background: var(--object-coral); }
  .k-av--grey { background: var(--object-grey); }
  .k-sw { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--type-xs); color: var(--fg-1); white-space: nowrap; }
  .k-sw i { width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--status-success); flex: none; }
  .k-sw--warn i { background: var(--status-warn); }
  .k-sw--error i { background: var(--status-error); }
  .k-sw--busy i { background: var(--status-info); }
  .k-sw--off i { background: var(--presence-offline); }

  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--type-sm); }
  th {
    height: 30px; padding: 0 var(--space-3); text-align: left;
    font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1);
    background: var(--bg-3); white-space: nowrap;
  }
  td { padding: var(--space-3); vertical-align: middle; box-shadow: inset 0 -0.5px 0 var(--border-subtle); }
  th:first-child, td:first-child { padding-left: var(--space-5); }
  th:last-child, td:last-child { padding-right: var(--space-5); }
  tbody tr:last-child td { box-shadow: none; }
  table:not(.ma-table) {
    margin: var(--space-2) 0 var(--space-5);
    background: var(--bg-1); border-radius: var(--radius-lg); overflow: hidden;
    box-shadow: var(--shadow-sm), inset 0 0 0 0.5px var(--border-default);
  }

  .card {
    position: relative; margin: 0 0 var(--space-4); padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-lg); background: var(--bg-1);
    box-shadow: var(--shadow-sm), inset 0 0 0 0.5px var(--border-default);
  }
  .card > :last-child { margin-bottom: 0; }
  .card p { font-size: var(--type-sm); line-height: var(--lh-sm); }
  .card.danger, .danger-card { box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--status-error); }
  .card.warn { box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--status-warn); }

  .menu { position: relative; display: inline-block; }
  .menu > summary {
    list-style: none; cursor: pointer;
    display: inline-grid; place-items: center;
    height: 26px; min-width: 26px; padding: 0 var(--space-2);
    border-radius: var(--radius-sm); color: var(--fg-1);
    font-size: var(--type-xs); font-weight: var(--weight-semibold);
  }
  .menu > summary::-webkit-details-marker { display: none; }
  .menu > summary:hover, .menu[open] > summary { background: var(--bg-3); color: var(--fg-0); }
  .menu-list {
    position: absolute; right: 0; top: calc(100% + var(--space-1)); z-index: 20;
    min-width: 220px; padding: var(--space-1);
    display: flex; flex-direction: column; gap: 1px; text-align: left;
    border-radius: var(--radius-md); background: var(--bg-2);
    box-shadow: var(--shadow-lg), inset 0 0 0 0.5px var(--border-strong);
  }
  .menu-list a, .menu-list button {
    display: flex; align-items: center; justify-content: flex-start; gap: var(--space-2);
    width: 100%; height: 30px; padding: 0 var(--space-2);
    border-radius: var(--radius-sm); background: transparent;
    color: var(--fg-0); font-size: var(--type-sm); font-weight: var(--weight-regular); text-decoration: none;
  }
  .menu-list a:hover, .menu-list button:hover { background: var(--bg-3); text-decoration: none; }
  .menu-list a.danger, .menu-list button.danger { background: transparent; color: var(--status-error-text); }
  .menu-list form { margin: 0; }
  .menu-sep { height: 0.5px; margin: var(--space-1) var(--space-2); background: var(--border-default); }
  .menu-hd { padding: var(--space-1) var(--space-2); font-size: var(--type-xs); color: var(--fg-2); }
`;

export const AD_CSS = `
  .ma-band {
    display: flex; align-items: center; justify-content: center; gap: var(--space-2);
    min-height: 32px; padding: var(--space-1) var(--space-4);
    background: var(--fg-0); color: var(--bg-1);
    font-size: var(--type-sm); font-weight: var(--weight-medium); text-align: center;
  }
  .ma-nav {
    position: sticky; z-index: 5; top: var(--space-4);
    display: flex; align-items: center; gap: var(--space-4);
    min-height: 52px; margin: var(--space-4) var(--space-5) 0;
    padding: 0 var(--space-3) 0 var(--space-4);
  }
  .ma-nav--op { top: var(--space-3); margin-top: var(--space-3); }
  .ma-nav-id { display: flex; align-items: center; gap: var(--space-2); font-weight: var(--weight-semibold); font-size: var(--type-base); white-space: nowrap; color: var(--fg-0); }
  .ma-nav-id:hover { text-decoration: none; }
  .ma-nav-id small { font-weight: var(--weight-regular); font-size: var(--type-sm); color: var(--fg-2); max-width: 16rem; overflow: hidden; text-overflow: ellipsis; }
  .ma-nav-tabs { display: flex; gap: var(--space-1); margin-left: var(--space-3); }
  .ma-nav-tab { display: inline-flex; align-items: center; gap: var(--space-1); height: 32px; padding: 0 var(--space-3); border-radius: var(--radius-md); font-size: var(--type-sm); color: var(--fg-1); white-space: nowrap; }
  .ma-nav-tab:hover { background: var(--bg-3); color: var(--fg-0); text-decoration: none; }
  .ma-nav-tab[aria-current="page"] { background: var(--bg-3); color: var(--fg-0); font-weight: var(--weight-semibold); }
  .ma-nav-tab .ma-count { margin-left: 2px; }
  .ma-nav-sp { flex: 1; }
  .ma-nav-search { white-space: nowrap; display: flex; align-items: center; gap: var(--space-2); width: 220px; height: 32px; margin: 0; padding: 0 var(--space-3); border-radius: var(--radius-md); background: var(--bg-3); font-size: var(--type-sm); color: var(--fg-2); box-shadow: inset 0 0 0 1px var(--fg-2); }
  .ma-nav-search:focus-within { box-shadow: inset 0 0 0 1.5px var(--accent); }
  .ma-nav-search input { flex: 1; min-width: 0; height: 30px; padding: 0; background: transparent; box-shadow: none; border-radius: 0; font-size: var(--type-sm); }
  .ma-nav-search .kbd { margin-left: auto; }
  .ma-hover-menu { opacity: 0; transition: opacity var(--dur-flip) var(--ease-out); }
  :hover > .ma-hover-menu, .ma-hover-menu:focus-within, .ma-hover-menu[open], tr:hover .ma-hover-menu, .ma-proj:hover .ma-hover-menu { opacity: 1; }
  .ma-nav-search input:focus { box-shadow: none; }
  .ma-me { position: relative; }
  .ma-me > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: var(--space-2); height: 32px; min-width: 0; padding: 0 var(--space-2); border-radius: var(--radius-md); font-size: var(--type-sm); font-weight: var(--weight-regular); color: var(--fg-1); }
  .ma-me > summary::-webkit-details-marker { display: none; }
  .ma-me > summary:hover, .ma-me[open] > summary { background: var(--bg-3); }
  .ma-nav-me { display: flex; align-items: center; gap: var(--space-2); font-size: var(--type-sm); color: var(--fg-1); white-space: nowrap; }
  .ma-me .menu-list { top: calc(100% + var(--space-2)); }
  .ma-count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: var(--radius-pill); background: var(--accent); color: var(--accent-fg); font-size: var(--type-xs); font-weight: var(--weight-semibold); }
  .ma-count--quiet { background: var(--bg-4); color: var(--fg-1); }

  .ma-main { max-width: 1440px; margin: var(--space-5) auto 0; padding: var(--space-5) var(--space-7) var(--space-7); }
  .ma-nav-wrap { max-width: 1440px; margin: 0 auto; }
  .ma-col { max-width: 46rem; }
  /* Every page spans the same width as the nav above it (owner, 2026-11-25:
     a page that was half as wide as the next one read as a different app).
     What has to stay readable is held inside: a line of prose, a text field. */
  .ma-main p, .ma-main li { max-width: 80ch; }
  .ma-main input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=search]), .ma-main select, .ma-main textarea { max-width: 34rem; }
  .ma-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--space-5); margin-bottom: var(--space-5); }
  .ma-h1 { margin: 0; font-family: var(--font-display); font-size: var(--type-2xl); line-height: var(--lh-2xl); font-weight: var(--weight-semibold); letter-spacing: var(--tracking-tight); }
  .ma-h1-row { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
  .ma-sub { margin: var(--space-1) 0 0; font-size: var(--type-sm); color: var(--fg-1); }
  .ma-head-a { display: flex; flex-wrap: wrap; gap: var(--space-2); flex: none; }
  .ma-head-a form { margin: 0; }
  .ma-crumb { margin: 0 0 var(--space-2); font-size: var(--type-sm); color: var(--fg-2); }
  .ma-ptabs { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); margin: 0 0 var(--space-5); padding: 0; }
  .ma-foot { margin: var(--space-7) 0 0; font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); }

  .ma-card { position: relative; border-radius: var(--radius-lg); background: var(--bg-1); box-shadow: var(--shadow-sm), inset 0 0 0 0.5px var(--border-default); }
  .ma-card--pad { padding: var(--space-4) var(--space-5); }
  .ma-card--clip { overflow: hidden; }
  .ma-card-h { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin: 0; padding: var(--space-4) var(--space-5) var(--space-2); font-family: var(--font-body); font-size: var(--type-base); line-height: var(--lh-base); font-weight: var(--weight-semibold); }
  .ma-card-h small { font-weight: var(--weight-regular); font-size: var(--type-sm); color: var(--fg-2); }
  .ma-card-h .ma-link { font-weight: var(--weight-regular); }
  .ma-card-p { margin: 0; padding: 0 var(--space-5) var(--space-4); font-size: var(--type-sm); line-height: var(--lh-sm); color: var(--fg-1); }
  .ma-link { font-size: var(--type-sm); color: var(--accent-text); white-space: nowrap; }

  .ma-stats { display: grid; grid-template-columns: repeat(var(--n, 4), 1fr); gap: var(--space-3); margin-bottom: var(--space-4); }
  .ma-stat { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-4) var(--space-5); color: var(--fg-0); }
  a.ma-stat:hover { text-decoration: none; box-shadow: var(--shadow-md), inset 0 0 0 0.5px var(--border-strong); }
  .ma-stat-l { display: flex; align-items: center; gap: var(--space-1); font-size: var(--type-sm); color: var(--fg-1); }
  .ma-stat-v { font-family: var(--font-display); font-size: var(--type-2xl); line-height: 1.1; font-weight: var(--weight-semibold); letter-spacing: var(--tracking-tight); font-variant-numeric: tabular-nums; }
  .ma-stat-v small { margin-left: 0; font-size: var(--type-base); font-weight: var(--weight-regular); color: var(--fg-2); letter-spacing: 0; }
  .ma-stat-f { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); font-size: var(--type-xs); color: var(--fg-2); }
  .ma-stat-f .ma-up { color: var(--status-success-text); }
  .ma-stat-go { position: absolute; right: var(--space-4); top: var(--space-4); color: var(--fg-3); }

  .ma-spark { display: flex; align-items: flex-end; gap: 2px; height: 28px; }
  .ma-spark i { flex: 1; min-width: 3px; border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--fg-2); }
  .ma-spark i:last-child { background: var(--accent); opacity: 1; }
  .ma-bars { display: flex; align-items: flex-end; gap: 6px; height: 150px; padding: 0 var(--space-5); }
  .ma-bars i { position: relative; flex: 1; border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--bg-4); }
  .ma-bars i b { position: absolute; left: 0; right: 0; bottom: 0; border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--fg-2); }
  .ma-bars i:last-child b { background: var(--accent); }
  .ma-bars-x { display: flex; justify-content: space-between; padding: var(--space-2) var(--space-5) var(--space-4); font-size: var(--type-xs); color: var(--fg-2); }
  .ma-legend { display: flex; gap: var(--space-4); font-size: var(--type-xs); font-weight: var(--weight-regular); color: var(--fg-1); }
  .ma-legend span { display: inline-flex; align-items: center; gap: var(--space-1); }
  .ma-legend i { width: 8px; height: 8px; border-radius: var(--radius-xs); background: var(--fg-2); }
  .ma-legend i.ma-lg-a { background: var(--accent); }

  .ma-cols { display: grid; gap: var(--space-4); align-items: start; }
  .ma-cols--2-1 { grid-template-columns: 1.7fr 1fr; }
  .ma-cols--1-1 { grid-template-columns: 1fr 1fr; }
  .ma-cols > * { min-width: 0; }
  .ma-stack { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
  .ma-gap { margin-top: var(--space-4); }
  .ma-gap-b { margin-bottom: var(--space-4); }

  .ma-need { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); box-shadow: inset 0 0.5px 0 var(--border-subtle); }
  .ma-need--first { box-shadow: none; }
  .ma-need > .k-ic { color: var(--fg-0); }
  .ma-need-t { flex: 1; min-width: 0; font-size: var(--type-sm); line-height: var(--lh-sm); }
  .ma-need-t strong { font-weight: var(--weight-semibold); }
  .ma-need-t span { display: block; color: var(--fg-2); font-size: var(--type-xs); }
  .ma-need-a { display: flex; gap: var(--space-1); flex: none; }
  .ma-need-a form { margin: 0; }

  .ma-feed { padding: var(--space-1) 0 var(--space-3); }
  .ma-ev { display: flex; align-items: flex-start; gap: var(--space-3); padding: var(--space-2) var(--space-5); font-size: var(--type-sm); line-height: var(--lh-sm); }
  .ma-ev-t { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ma-ev-t span { color: var(--fg-1); }
  .ma-ev time { flex: none; font-size: var(--type-xs); color: var(--fg-2); font-variant-numeric: tabular-nums; }
  .ma-ev-ic { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: var(--radius-pill); background: var(--bg-3); color: var(--fg-1); }

  .ma-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1); padding: var(--space-3) var(--space-4) var(--space-2); }
  .ma-tab { display: inline-flex; align-items: center; gap: var(--space-1); height: 28px; padding: 0 var(--space-3); border-radius: var(--radius-md); font-size: var(--type-sm); color: var(--fg-1); white-space: nowrap; }
  .ma-tab:hover { background: var(--bg-3); color: var(--fg-0); text-decoration: none; }
  .ma-tab[aria-current="page"], .ma-tab[aria-current="true"], .ma-tab[aria-pressed="true"] { background: var(--bg-3); color: var(--fg-0); font-weight: var(--weight-semibold); }
  .ma-tab.danger { color: var(--status-error-text); }
  .ma-tab .ma-count { background: var(--bg-4); color: var(--fg-1); }
  .ma-tab .ma-count--hot { background: var(--accent); color: var(--accent-fg); }
  .ma-tabs-sp { flex: 1; }
  .ma-filter { display: flex; align-items: center; gap: var(--space-2); width: 200px; height: 28px; margin: 0; padding: 0 var(--space-2); border-radius: var(--radius-sm); background: var(--bg-3); font-size: var(--type-sm); color: var(--fg-2); box-shadow: inset 0 0 0 1px var(--fg-2); }
  .ma-filter:focus-within { box-shadow: inset 0 0 0 1.5px var(--accent); }
  .ma-filter input { flex: 1; min-width: 0; height: 26px; padding: 0; background: transparent; box-shadow: none; border-radius: 0; }
  .ma-filter input:focus { box-shadow: none; }

  .ma-scroll { overflow-x: auto; }
  .ma-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--type-sm); }
  .ma-table th { height: 30px; padding: 0 var(--space-3); text-align: left; font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1); background: var(--bg-3); white-space: nowrap; }
  .ma-table th:first-child { padding-left: var(--space-5); }
  .ma-table td { height: 52px; padding: 0 var(--space-3); vertical-align: middle; box-shadow: inset 0 -0.5px 0 var(--border-subtle); white-space: nowrap; }
  .ma-table td:first-child { padding-left: var(--space-5); }
  .ma-table td:last-child, .ma-table th:last-child { padding-right: var(--space-5); text-align: right; }
  .ma-table tr.is-hl td { background: var(--bg-3); }
  .ma-table tr.is-picked td, .ma-table tr:has(.ma-pick-box:checked) td { background: var(--accent-muted); }
  .ma-table tr.is-dim td { color: var(--fg-2); }
  .ma-table .ma-num { text-align: right; font-variant-numeric: tabular-nums; }
  .ma-table .ma-quiet, .ma-quiet { color: var(--fg-2); }
  .ma-table td.ma-wrap { white-space: normal; }
  .ma-pick-box { margin-right: var(--space-3); }

  .ma-who { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--fg-0); text-align: left; }
  a.ma-who:hover { text-decoration: none; }
  a.ma-who:hover strong { text-decoration: underline; }
  .ma-who-t { display: flex; flex-direction: column; line-height: 1.25; }
  .ma-who-t strong { font-weight: var(--weight-semibold); }
  .ma-who-t span { font-size: var(--type-xs); color: var(--fg-2); }
  .ma-row-a { display: inline-flex; align-items: center; gap: var(--space-1); justify-content: flex-end; }
  .ma-row-a form { margin: 0; }

  .ma-thumb {
    position: relative; display: block; flex: none; overflow: hidden;
    border-radius: var(--radius-xs); background: var(--bg-3);
    box-shadow: inset 0 0 0 0.5px var(--border-default);
  }
  .ma-thumb > i { position: absolute; display: block; border-radius: var(--radius-xs); background: var(--bg-1); box-shadow: inset 0 0 0 0.5px var(--border-default); }
  .ma-thumb > i:nth-child(1) { left: 12%; top: 20%; width: 30%; height: 60%; }
  .ma-thumb > i:nth-child(2) { left: 48%; top: 32%; width: 20%; height: 48%; }
  .ma-thumb > i:nth-child(3) { left: 74%; top: 20%; width: 14%; height: 36%; }
  .ma-thumb--row { width: 48px; height: 32px; }

  .ma-sheet { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5); border-radius: var(--radius-xl); background: var(--bg-2); box-shadow: var(--shadow-lg), inset 0 0 0 0.5px var(--border-strong); }
  .ma-sheet--side { position: fixed; z-index: 10; right: 28px; top: 108px; width: 420px; max-width: calc(100vw - 2 * var(--space-4)); max-height: calc(100vh - 108px - var(--space-5)); overflow-y: auto; }
  .ma-sheet--op { top: 140px; max-height: calc(100vh - 140px - var(--space-5)); }
  .ma-sheet form { display: flex; flex-direction: column; gap: var(--space-4); margin: 0; }
  .ma-sheet-t { margin: 0; font-family: var(--font-display); font-size: var(--type-lg); line-height: var(--lh-lg); font-weight: var(--weight-semibold); }
  .ma-sheet-s { margin: calc(var(--space-1) * -2) 0 0; font-size: var(--type-sm); color: var(--fg-1); }
  .ma-sheet-a { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-1); }
  .ma-sheet-a .ma-sp { flex: 1; }
  .ma-sheet-a .ma-quiet { font-size: var(--type-xs); }
  .ma-sheet-h4 { margin: 0 0 var(--space-1); font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1); }
  .ma-pick { display: flex; flex-direction: column; gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--bg-3); }
  .ma-pick-o { display: flex; align-items: flex-start; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--type-sm); font-weight: var(--weight-regular); color: var(--fg-0); cursor: pointer; }
  .ma-pick-o:has(input:checked) { background: var(--bg-1); box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--accent); }
  .ma-pick-o input { margin-top: 2px; }
  .ma-pick-o strong { display: block; font-weight: var(--weight-semibold); }
  .ma-pick-o span span { display: block; font-size: var(--type-xs); color: var(--fg-1); }
  .seg.ma-seg { display: flex; }
  .ma-seg-b { position: relative; flex: 1; display: grid; place-items: center; height: 30px; margin: 0; border-radius: var(--radius-sm); font-size: var(--type-xs); font-weight: var(--weight-regular); color: var(--fg-1); cursor: pointer; }
  .ma-seg-b input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
  .ma-seg-b:has(input:checked) { background: var(--bg-2); color: var(--fg-0); font-weight: var(--weight-semibold); box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--accent); }
  .ma-seg-b:has(input:focus-visible) { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  .ma-promise { display: flex; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-md); background: var(--accent-muted); font-size: var(--type-sm); line-height: var(--lh-sm); color: var(--fg-0); }
  .ma-promise .k-ic { flex: none; color: var(--accent-text); margin-top: 2px; }
  .ma-veil { position: fixed; inset: 0; z-index: 8; background: color-mix(in oklch, var(--fg-0) 12%, transparent); cursor: default; }

  .ma-kv { display: grid; grid-template-columns: 120px 1fr; gap: var(--space-1) var(--space-3); font-size: var(--type-sm); }
  .ma-kv dt { color: var(--fg-2); }
  .ma-kv--card { padding: 0 var(--space-5) var(--space-4); }

  .ma-projects { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: var(--space-3); padding: 0 var(--space-5) var(--space-5); }
  .ma-proj { position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: var(--radius-md); background: var(--bg-2); box-shadow: inset 0 0 0 0.5px var(--border-default); color: var(--fg-0); }
  .ma-proj .ma-thumb { width: 100%; height: 92px; border-radius: 0; box-shadow: inset 0 -0.5px 0 var(--border-default); }
  .ma-proj-b { display: flex; flex-direction: column; gap: 2px; padding: var(--space-2) var(--space-3) var(--space-3); font-size: var(--type-sm); }
  .ma-proj-b strong { font-weight: var(--weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ma-proj-b strong a { color: var(--fg-0); }
  .ma-proj-b strong a::after { content: ""; position: absolute; inset: 0; }
  .ma-proj-m { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 16px; font-size: var(--type-xs); color: var(--fg-2); }
  .ma-proj-n { font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); }
  .ma-proj .menu { position: absolute; right: var(--space-2); top: var(--space-2); z-index: 2; }
  .ma-proj .menu > summary { background: var(--island-bg); box-shadow: inset 0 0 0 0.5px var(--island-edge); color: var(--fg-0); }
  .ma-proj:has(.menu[open]) { overflow: visible; z-index: 3; }
  .ma-faces { display: inline-flex; }
  .ma-faces .k-av { box-shadow: 0 0 0 1.5px var(--bg-2); }
  .ma-faces .k-av + .k-av { margin-left: -5px; }
  .ma-proj--new { align-items: center; justify-content: center; gap: var(--space-2); min-height: 150px; color: var(--accent-text); font-size: var(--type-sm); background: transparent; box-shadow: inset 0 0 0 1px var(--border-default); border-radius: var(--radius-md); }
  a.ma-proj--new:hover { text-decoration: none; background: var(--bg-1); }
  .ma-proj--new .ma-plus { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--radius-pill); background: var(--accent-muted); }
  .ma-empty { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); padding: var(--space-7) var(--space-5); text-align: center; }
  .ma-empty p { margin: 0; }

  .ma-matrix td.ma-at { text-align: left; }
  .ma-matrix th a { color: inherit; }
  .ma-mrole { display: inline-flex; align-items: center; height: 24px; padding: 0 var(--space-2); border-radius: var(--radius-sm); font-size: var(--type-xs); color: var(--fg-0); background: var(--bg-3); white-space: nowrap; }
  .ma-mrole--own { background: var(--accent-muted); color: var(--accent-text); font-weight: var(--weight-semibold); }
  .ma-mrole--none { background: transparent; color: var(--fg-2); }
  details.ma-at-d { position: relative; display: inline-block; }
  details.ma-at-d > summary { list-style: none; cursor: pointer; border-radius: var(--radius-sm); }
  details.ma-at-d > summary::-webkit-details-marker { display: none; }
  details.ma-at-d > summary:hover .ma-mrole { box-shadow: inset 0 0 0 1px var(--fg-2); }
  details.ma-at-d > .ma-pop { position: absolute; left: 0; top: calc(100% + var(--space-1)); z-index: 20; width: 240px; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); white-space: normal; text-align: left; border-radius: var(--radius-md); background: var(--bg-2); box-shadow: var(--shadow-lg), inset 0 0 0 0.5px var(--border-strong); }
  .ma-pop form { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; }
  /* An open role panel is never cut off by the card or the scroller it sits in. */
  .ma-card--clip:has(details.ma-at-d[open]), .ma-scroll:has(details.ma-at-d[open]) { overflow: visible; }
  details.ma-at-d[open] { z-index: 30; }
  details.ma-at-d > .ma-pop { animation: ma-drop 140ms ease-out backwards; }
  details.ma-at-d > .ma-pop { width: 300px; }
  .ma-pop form .btn { align-self: flex-start; }
  body { counter-reset: picked; }
  .ma-pick-box:checked { counter-increment: picked; }
  .ma-bulk { position: fixed; z-index: 6; left: 50%; bottom: var(--space-5); transform: translateX(-50%); display: none; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--space-2); margin: 0; padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4); font-size: var(--type-sm); width: max-content; max-width: calc(100vw - 2 * var(--space-4)); }
  body:has(.ma-pick-box:checked) .ma-bulk, .ma-bulk:focus-within { display: flex; }
  .ma-bulk-n::before { content: counter(picked) " selected"; }
  body:has(.ma-pick-box:checked) .ma-main { padding-bottom: 140px; }
  .ma-bulk-sure { display: inline-flex; align-items: center; margin: 0; max-width: 14rem; font-size: var(--type-xs); font-weight: var(--weight-regular); color: var(--fg-1); line-height: var(--lh-xs); }
  .ma-who-row { display: inline-flex; align-items: center; }
  .ma-who-row .ma-pick-box, .ma-pick-sp { flex: none; width: 14px; margin: 0 var(--space-3) 0 0; }
  a.ma-pick-o { color: var(--fg-0); }
  a.ma-pick-o:hover { background: var(--bg-1); text-decoration: none; }
  .ma-pop select { width: 100%; }
  .ma-pop .btn { justify-content: flex-start; }
  .ma-bulk strong { margin-right: var(--space-2); font-weight: var(--weight-semibold); white-space: nowrap; }
  .ma-bulk select { width: auto; height: 26px; font-size: var(--type-xs); border-radius: var(--radius-sm); }

  .ma-op-tag { display: inline-flex; align-items: center; gap: var(--space-1); height: 22px; margin-left: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-pill); background: var(--fg-0); font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--bg-1); }
  .ma-alarm { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-5); font-size: var(--type-sm); box-shadow: inset 0 0.5px 0 var(--border-subtle); }
  .ma-alarm .k-sw { min-width: 92px; }
  .ma-alarm > span:nth-child(2) { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .ma-alarm > span:last-child { margin-left: auto; font-size: var(--type-xs); color: var(--fg-2); white-space: nowrap; }
  a.ma-alarm--go { color: var(--fg-0); transition: background-color 140ms ease-out; }
  a.ma-alarm--go:hover { background: var(--bg-3); text-decoration: none; }
  a.ma-alarm--go > span:last-child { color: var(--fg-3); }

  .ma-promo { display: inline-flex; align-items: center; gap: var(--space-1); height: 22px; padding: 0 var(--space-2); border-radius: var(--radius-pill); background: var(--accent-muted); color: var(--accent-text); font-size: var(--type-xs); font-weight: var(--weight-semibold); white-space: nowrap; }
  .ma-promo-l { font-size: var(--type-xs); font-weight: var(--weight-semibold); color: var(--fg-1); }
  .ma-promo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
  .ma-promo-grid .ma-card, .ma-plan { display: flex; flex-direction: column; gap: var(--space-3); }
  .ma-promo-grid .ma-sheet-t, .ma-plan .ma-sheet-t { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .ma-plan .ma-sub { margin: 0; }
  .ma-menu-key { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-5) var(--space-4); font-size: var(--type-xs); color: var(--fg-2); }
  .ma-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  .ma-web { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) var(--space-4); }
  .ma-web-card { width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: var(--space-2); }
  .ma-web-top { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center; margin-bottom: var(--space-3); }
  .ma-web-t { margin: 0; font-family: var(--font-display); font-size: var(--type-lg); line-height: var(--lh-lg); font-weight: var(--weight-semibold); letter-spacing: 0; }
  .ma-web-s { margin: 0; font-size: var(--type-sm); color: var(--fg-1); }
  .ma-web-fine { margin-top: var(--space-2); font-size: var(--type-xs); line-height: var(--lh-xs); color: var(--fg-2); text-align: center; }

  /* ---- Settings: one page of cards (canvas 16, ts-settings) — a card is one
     area with its state word and one or two actions; detail pages sit behind it. */
  .ma-set { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: stretch; }
  .ma-set > .ma-card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4) var(--space-5); }
  .ma-set > .ma-card--wide { grid-column: 1 / -1; }
  .ma-set-h { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-family: var(--font-body); font-size: var(--type-base); line-height: var(--lh-base); font-weight: var(--weight-semibold); }
  .ma-set-h .k-ic { color: var(--fg-1); }
  .ma-set-h .k-sw { margin-left: auto; font-weight: var(--weight-regular); }
  .ma-set-p { margin: 0; font-size: var(--type-sm); line-height: var(--lh-sm); color: var(--fg-1); }
  .ma-set-a { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: auto; padding-top: var(--space-1); }
  .ma-set-a form { margin: 0; }
  .ma-set .ma-kv { grid-template-columns: 9rem 1fr; }
  .ma-set .ma-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .ma-set-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
  .ma-set-list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); max-width: none; padding: var(--space-2) 0; font-size: var(--type-sm); box-shadow: inset 0 -0.5px 0 var(--border-subtle); }
  .ma-set-list li:last-child { box-shadow: none; }
  .ma-set-list a { color: var(--fg-0); font-weight: var(--weight-medium); }
  .ma-card--danger .ma-set-h { color: var(--status-error-text); }
  .ma-card--danger .ma-set-h .k-ic { color: var(--status-error-text); }
  .ma-crumb a { color: var(--accent-text); }
  .ma-back { display: inline-flex; align-items: center; gap: var(--space-1); }

  /* ---- Search results: the nav's field answers with a page of hits */
  .ma-results { display: flex; flex-direction: column; gap: var(--space-4); }
  .ma-hit { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-5); box-shadow: inset 0 0.5px 0 var(--border-subtle); color: var(--fg-0); font-size: var(--type-sm); }
  .ma-hit:first-of-type { box-shadow: none; }
  a.ma-hit:hover { background: var(--bg-3); text-decoration: none; }
  .ma-hit .ma-who-t { flex: 1; min-width: 0; }
  .ma-hit mark { background: color-mix(in oklch, var(--accent) 22%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
  .ma-hit-k { font-size: var(--type-xs); color: var(--fg-2); white-space: nowrap; }

  /* ---- People: which project — a row of project chips above the table */
  .ma-chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0 0 var(--space-4); }
  .ma-chip { display: inline-flex; align-items: center; gap: var(--space-2); height: 30px; padding: 0 var(--space-3); border-radius: var(--radius-pill); background: var(--bg-1); box-shadow: inset 0 0 0 0.5px var(--border-default); font-size: var(--type-sm); color: var(--fg-1); white-space: nowrap; }
  .ma-chip:hover { color: var(--fg-0); text-decoration: none; box-shadow: inset 0 0 0 1px var(--fg-3); }
  .ma-chip[aria-current="page"] { background: var(--fg-0); color: var(--bg-1); box-shadow: none; font-weight: var(--weight-semibold); }
  .ma-chip[aria-current="page"] .ma-count { background: color-mix(in oklch, var(--bg-1) 22%, transparent); color: var(--bg-1); }
  .ma-chip .ma-count { background: var(--bg-3); color: var(--fg-1); }
  .ma-matrix th.ma-pcol { text-align: left; }
  .ma-matrix th.ma-pcol a { display: inline-flex; align-items: center; gap: var(--space-1); }
  details.ma-more { margin: 0; padding: var(--space-3) var(--space-5) var(--space-4); font-size: var(--type-xs); color: var(--fg-2); }
  details.ma-more > summary { cursor: pointer; color: var(--fg-1); }
  details.ma-more p { margin: var(--space-2) 0 0; line-height: var(--lh-xs); }

  /* ---- Equal heights: a row of cards is one height, the foot sits at the bottom */
  .ma-stats { align-items: stretch; }
  .ma-stats > .ma-stat { height: 100%; }
  .ma-stat-f { margin-top: auto; }
  .ma-cols--even { align-items: stretch; }
  .ma-cols--even > .ma-card { height: 100%; }

  /* ---- Motion. A page's content rises in, cards and controls answer the
     pointer, a sheet slides in, a menu drops. Two rules keep it safe:
     - the content's rise moves \`top\` on a relative box, never \`transform\` —
       a transform (even a finished one, even a stalled one) makes every card a
       containing block, and the position:fixed bulk bar inside it is caught
       and clipped;
     - nothing overlays the page while it moves (no cross-document view
       transition): a click must never wait for an animation to finish.
     All of it collapses to nothing under prefers-reduced-motion. */
  @keyframes ma-rise { from { opacity: 0; top: 6px; } to { opacity: 1; top: 0; } }
  @keyframes ma-drop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
  @keyframes ma-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ma-slide { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
  /* backwards, never both: a finished animation must leave no transform behind,
     or every position:fixed child (the bulk bar) is caught inside its card. */
  .ma-main > * { position: relative; animation: ma-rise 240ms var(--ease-out, cubic-bezier(.2,.8,.2,1)) backwards; }
  .ma-main > :nth-child(2) { animation-delay: 30ms; }
  .ma-main > :nth-child(3) { animation-delay: 60ms; }
  .ma-main > :nth-child(n+4) { animation-delay: 90ms; }
  .ma-veil { animation: ma-fade 200ms ease-out backwards; }
  .ma-sheet--side { animation: ma-slide 240ms var(--ease-out, cubic-bezier(.2,.8,.2,1)) backwards; }
  .ma-card, .ma-stat, .ma-proj, .ma-chip, .ma-tab, .ma-nav-tab, .btn, .ma-hit, .ma-mrole, .ma-nav-search, .ma-filter, .ma-me > summary {
    transition: background-color 140ms ease-out, box-shadow 160ms ease-out, color 140ms ease-out, transform 160ms ease-out, opacity 140ms ease-out;
  }
  a.ma-stat:hover, a.ma-proj:hover, .ma-proj:has(a:hover) { transform: translateY(-1px); box-shadow: var(--shadow-md), inset 0 0 0 0.5px var(--border-strong); }
  .btn:active { transform: translateY(0.5px); }
  .menu-list { animation: ma-drop 140ms ease-out backwards; }
  .ma-bars i b { transform-origin: bottom; animation: ma-grow 420ms var(--ease-out, cubic-bezier(.2,.8,.2,1)) backwards; }
  @keyframes ma-grow { from { transform: scaleY(0); } to { transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }

  @media (max-width: 1100px) {
    .ma-main { padding: var(--space-4) var(--space-5) var(--space-6); }
    .ma-stats { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    .ma-cols--2-1, .ma-cols--1-1, .ma-promo-grid, .ma-set { grid-template-columns: 1fr; }
    .ma-projects { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .ma-nav-search { width: 160px; }
  }
  @media (max-width: 760px) {
    .ma-nav { position: static; flex-wrap: wrap; gap: var(--space-2); margin: var(--space-3) var(--space-3) 0; padding: var(--space-2) var(--space-3); }
    .ma-nav-tabs { order: 3; width: 100%; margin-left: 0; overflow-x: auto; }
    .ma-nav-search { display: none; }
    .ma-nav-id small { display: none; }
    .ma-main { margin-top: var(--space-3); padding: var(--space-3) var(--space-4) var(--space-6); }
    .ma-head { flex-direction: column; align-items: flex-start; }
    .ma-sheet--side { left: var(--space-3); right: var(--space-3); top: var(--space-5); width: auto; max-height: calc(100vh - 2 * var(--space-5)); }
  }
`;
