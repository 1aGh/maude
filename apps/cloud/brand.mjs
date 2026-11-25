// Maude Cloud wears the Maude design system — the v2 one.
//
// These pages were first dressed in the v1 system: a dark grid shell with a
// left sidebar. The product's design moved on. Canvas 16, "Team Server and
// Cloud Admin", draws every signed-in page as a LIGHT page on `--bg-0` with
// one floating nav island and no sidebar, and this module is that design,
// ported for server-rendered HTML.
//
// WHAT IS LIFTED, AND FROM WHERE:
//
//   tokens  — brand-tokens.mjs: a subset of the maude-v2 token file, same
//             names, values verbatim, light by default and dark when the
//             person's system asks (the DS declares both). brand.test.mjs
//             compares every value with the source.
//   chrome  — brand-css.mjs: the DS primitives and the canvas's own `ad-*`
//             page pieces. Sizes, radii, spacing, type and colour are the
//             canvas's.
//   mark    — the tile and the star of the DS logo, path for path. A brand
//             mark in a surface IS the stored specimen's mark (DDR-141); a
//             redrawn mark is a second mark.
//
// ONE SHELL. Every signed-in page goes through `appShell`: the nav island
// (mark, "Maude Cloud", whose place this is, the tabs this person has, search,
// and the avatar menu), then the page head, then the body. The operator wears
// an ink band and their own island, and reaches it from the avatar menu.
// Every signed-out page goes through `publicPage`: one centred column.
//
// Server-rendered, no script. Menus are native `<details>`; a sheet is its own
// address that renders the page with the sheet over it.

import { AD_CSS, CHROME } from './brand-css.mjs';
import { TOKENS } from './brand-tokens.mjs';
import { pageCsp } from './edge.mjs';

export { AD_CSS, CHROME, TOKENS };

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

export function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

// ───────────────────────────────── Pieces ─────────────────────────────────

/**
 * The glyphs the canvas uses, from the kit's icon set: 16 × 16, 1.5px stroke,
 * round caps, `currentColor`.
 */
const ICONS = {
  people:
    '<circle cx="6" cy="5.5" r="2.25"/><path d="M2 13a4 4 0 0 1 8 0M10.5 3.5a2.25 2.25 0 0 1 0 4.25M12 9.25A4 4 0 0 1 14 13"/>',
  server:
    '<rect x="2.5" y="2.75" width="11" height="4.25" rx="1.5"/><rect x="2.5" y="9" width="11" height="4.25" rx="1.5"/><path d="M5 4.9h.01M5 11.1h.01"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  more: '<g fill="currentColor" stroke="none"><circle cx="3.5" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12.5" cy="8" r="1.1"/></g>',
  folder:
    '<path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h2.5L8 4.5h4A1.5 1.5 0 0 1 13.5 6v5.5A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5z"/>',
  'chevron-r': '<path d="M6.5 5l3 3-3 3"/>',
  chevron: '<path d="M5 6.5l3 3 3-3"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25l3.25 3.25"/>',
  export:
    '<path d="M8 2.5V10M5.25 7.25L8 10l2.75-2.75"/><path d="M2.75 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5v-1.5"/>',
  sync: '<path d="M3 7.25a5 5 0 0 1 8.6-3L13 5.5M13 2.5v3h-3M13 8.75a5 5 0 0 1-8.6 3L3 10.5M3 13.5v-3h3"/>',
  laptop: '<rect x="3.5" y="3.5" width="9" height="6.5" rx="1.25"/><path d="M1.75 12.5h12.5"/>',
  file: '<path d="M4 2.5h5.25l2.75 2.75v8.25H4z"/><path d="M9 2.5v3h3"/>',
  clock: '<circle cx="8" cy="8" r="5.75"/><path d="M8 5v3l2 1.25"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  pulse: '<path d="M1.75 8.5h2.5l1.5-4 2.5 7.5 1.75-5.5 1 2h3.25"/>',
  link: '<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.75.75M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.75-.75"/>',
  edit: '<path d="M9.5 3.5l2 2L6 11l-2.75.75L4 9z"/><path d="M3 13.5h10"/>',
  web: '<rect x="2" y="3" width="12" height="10" rx="2.5"/><path d="M2 6.25h12M4.5 4.65h.01M6.25 4.65h.01"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.75"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
};

/** One icon by name. Decorative: the words next to it carry the meaning. */
export function icon(name, size = 16) {
  return `<svg class="k-ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.file}</svg>`;
}

const MARK_TILE = 'M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z';
const MARK_STAR = 'M16 5l2.8 8.2L27 16l-8.2 2.8L16 27l-2.8-8.2L5 16l8.2-2.8z';

/**
 * The mark: the star on its tile, with the tile's squared bottom-right corner
 * — the thing that makes it the Maude mark rather than a star in a rounded
 * box. `invert` is the mark as it sits ON an azure button.
 */
export function mark(size = 24, { invert = false } = {}) {
  const tile = invert ? 'var(--accent-fg)' : 'var(--accent)';
  const star = invert ? 'var(--accent)' : 'var(--accent-fg)';
  return `<svg class="k-ic mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="${MARK_TILE}" fill="${tile}"/><path d="${MARK_STAR}" fill="${star}"/></svg>`;
}

/** The mark and the name, as the way home. */
export function lockup({ size = 26, words = 'Maude Cloud', href = '/' } = {}) {
  // A LINK, not a decoration (Cloud Phase 23 A2). Every page wearing the mark
  // gets the way home for free — the return leg people reach for first.
  return `<a class="lockup" href="${href}">${mark(size)}<span class="word">${words}</span></a>`;
}

export const LOCKUP_CSS = `
  .lockup { display: inline-flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-5); text-decoration: none; }
  .lockup:hover { text-decoration: none; }
  .word { font-weight: var(--weight-semibold); font-size: var(--type-base); line-height: 1; color: var(--fg-0); }
`;

const TONES = ['sky', 'green', 'lilac', 'yellow', 'coral', 'grey'];

/** A person's colour: the same seed always lands on the same tone. */
export function toneFor(seed) {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

/** The first letter a person is known by. */
export function initialOf(label) {
  const first = [...String(label ?? '').trim()][0];
  return first ? first.toUpperCase() : '?';
}

/**
 * A face: an initial on one of the object colours. There are no pictures of
 * people on the control plane, so a face is the first letter of the name or
 * address, coloured by the address so it is the same face on every page.
 */
export function avatar(label, { size = 'md', seed = label, tone = null } = {}) {
  return `<span class="k-av k-av--${tone ?? toneFor(seed)} k-av--${size}" aria-hidden="true">${esc(initialOf(label))}</span>`;
}

/** A face with a name and one quiet line under it. `name` and `sub` are plain text. */
export function who({ name, sub = null, seed = null, href = null, lead = null }) {
  const inner = `${lead ?? avatar(name, { size: 'lg', seed: seed ?? sub ?? name })}<span class="ad-who-t"><strong>${esc(name)}</strong>${sub ? `<span>${esc(sub)}</span>` : ''}</span>`;
  return href
    ? `<a class="ad-who" href="${esc(href)}">${inner}</a>`
    : `<span class="ad-who">${inner}</span>`;
}

/** A state said in a word, with a dot — never by colour alone. `text` is plain text. */
export function statusWord(state, text) {
  const s = ['ok', 'warn', 'error', 'busy', 'off'].includes(state) ? state : 'ok';
  return `<span class="k-sw k-sw--${s}"><i></i>${esc(text)}</span>`;
}

/**
 * One stat tile. `value` and `unit` are plain text; `foot` is trusted markup.
 * With `href` the whole tile is the link to the list behind the number.
 */
export function stat({ label, glyph, value, unit = null, foot = null, spark = null, href = null }) {
  const inner = `${href ? `<span class="ad-stat-go">${icon('chevron-r', 14)}</span>` : ''}<span class="ad-stat-l">${icon(glyph, 14)}${esc(label)}</span><span class="ad-stat-v">${esc(value)}${unit ? `<small> ${esc(unit)}</small>` : ''}</span>${
    spark?.length
      ? `<span class="ad-spark" aria-hidden="true">${spark.map((v) => `<i style="height:${Math.max(0, Math.min(100, Math.round(v)))}%"></i>`).join('')}</span>`
      : ''
  }${foot ? `<span class="ad-stat-f">${foot}</span>` : ''}`;
  return href
    ? `<a class="ad-card ad-stat" href="${esc(href)}">${inner}</a>`
    : `<div class="ad-card ad-stat">${inner}</div>`;
}

/** One line of a log. `body` is trusted markup; `when` is plain text. */
export function logLine({ glyph = 'pulse', body, when = '' }) {
  return `<div class="ad-ev"><span class="ad-ev-ic">${icon(glyph, 13)}</span><span class="ad-ev-t">${body}</span>${when ? `<time>${esc(when)}</time>` : ''}</div>`;
}

/** The neutral picture a project wears: three artboards on a canvas. Nothing here knows what is in a project. */
export function thumb(cls = '') {
  return `<span class="ad-thumb${cls ? ` ${cls}` : ''}" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

// ───────────────────────────── Google's button ─────────────────────────────

/**
 * The "Continue with Google" button, and the rules it needs.
 *
 * Lives HERE rather than on the signup surface because it is needed on three
 * unrelated pages — signup, sign-in, and the invitation's join screen (Cloud
 * Phase 24 A12b). A second copy of a brand-constrained button is how two of
 * them drift.
 *
 * The official multicolor "G" is inline so a page stays a single request and
 * works under the strict CSP. Google's brand rules allow the standard G on a
 * neutral button; the button chrome itself wears our tokens.
 */
export const GOOGLE_BUTTON_CSS = `
  .btn-google { background: var(--bg-2); color: var(--fg-0); box-shadow: inset 0 0 0 0.5px var(--border-strong); }
  .btn-google:hover { background: var(--bg-3); color: var(--fg-0); }
  .btn-google svg { flex: none; }
  .or {
    display: flex; align-items: center; gap: var(--space-3);
    color: var(--fg-2); font-size: var(--type-xs);
    margin: var(--space-3) 0;
  }
  .or::before, .or::after { content: ""; flex: 1; border-top: 0.5px solid var(--border-strong); }
`;

const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.2-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.2C40.7 35.7 44 30.3 44 24c0-1.2-.1-2.4-.4-3.5z"/></svg>`;

export function googleButton({ next = null, wide = false } = {}) {
  const href = next ? `/auth/google?next=${encodeURIComponent(next)}` : '/auth/google';
  return `<a class="btn btn--lg btn-google${wide ? ' wide' : ''}" href="${href}">${GOOGLE_G} Continue with Google</a>`;
}

/** Everything a cloud page needs, in one string. */
export const PAGE_CSS = TOKENS + CHROME + LOCKUP_CSS + AD_CSS;

// ─────────────────────────── The public page ───────────────────────────
//
// The pages a person reaches from OUTSIDE (sign in, an invitation, a shared
// link, the device prompt) share one shell: the canvas's web card (`ts-invitee`
// — one centred column on the page, the mark on top, one sentence of title,
// one of help, full-width buttons, the fine print under them, and — when the
// app sent you — a quiet way back to it).

/** The headers every public page answers with. Stricter than the edge floor, never looser. */
export const PUBLIC_PAGE_HEADERS = Object.freeze({
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'content-security-policy': pageCsp(),
  'referrer-policy': 'no-referrer',
});

export const PUBLIC_CSS = `
  main.public { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: var(--space-6) var(--space-4); }
  .public-col { width: 100%; max-width: 380px; }
  .public-col > :last-child { margin-bottom: 0; }
  .public-top { display: flex; flex-direction: column; align-items: center; gap: var(--space-2); text-align: center; margin-bottom: var(--space-5); }
  .public-top .lockup { margin-bottom: var(--space-2); }
  .public-top .word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .public-top h1 { font-size: var(--type-lg); line-height: var(--lh-lg); letter-spacing: 0; }
  .public-who { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
  .public-who .lockup { margin: 0; }
  .ad-web-role { display: inline-flex; align-items: center; gap: var(--space-1); height: 26px; margin-top: var(--space-1); padding: 0 var(--space-3); border-radius: var(--radius-pill); background: var(--bg-3); font-size: var(--type-xs); color: var(--fg-1); }
  main.public details > summary { cursor: pointer; text-align: center; }
  main.public .card { margin-top: var(--space-3); }
  .public-top .sub { margin: 0; color: var(--fg-1); font-size: var(--type-sm); line-height: var(--lh-sm); }
  main.public .btn.wide, main.public button.wide, main.public form > button:not([class]) { display: flex; width: 100%; height: 40px; font-size: var(--type-base); border-radius: var(--radius-lg); }
  .btn.secondary { background: var(--bg-3); color: var(--fg-0); }
  .btn.secondary:hover { background: var(--bg-4); color: var(--fg-0); }
  .stack { display: grid; gap: var(--space-2); margin-bottom: var(--space-4); }
  .fine { text-align: center; font-size: var(--type-xs); line-height: var(--lh-xs); }
  .back-to-app { display: block; text-align: center; margin-top: var(--space-5); color: var(--fg-2); font-size: var(--type-sm); }
  .who { display: flex; gap: var(--space-3); align-items: flex-start; }
  .who strong { display: block; }
  .steps { display: grid; gap: var(--space-2); padding: 0; margin: 0 0 var(--space-4); list-style: none; color: var(--fg-1); font-size: var(--type-sm); line-height: var(--lh-sm); counter-reset: step; }
  .steps li { counter-increment: step; display: flex; gap: var(--space-3); align-items: baseline; }
  .steps li::before { content: counter(step); font-variant-numeric: tabular-nums; font-weight: var(--weight-semibold); color: var(--fg-0); min-width: 1.2em; }
`;

/**
 * One public page.
 *
 * `title` and `sub` are plain text (escaped here); `body` is trusted markup the
 * caller built with its own escaping. `extraHead` is trusted markup for
 * `<head>` — only the sign-in done page uses it, for its one `meta refresh`.
 */
export function publicPage({
  title,
  sub = null,
  body = '',
  extraHead = '',
  css = '',
  tab = null,
  lead = null,
  pill = null,
}) {
  // `lead` is trusted markup beside the mark (the inviter's face, ts-invitee);
  // `pill` is plain text — what the invitation lets you do.
  const top = lead
    ? `<span class="public-who">${lockup({ size: 48 })}${lead}</span>`
    : lockup({ size: 44 });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">${extraHead}<title>${esc(tab ?? title)} — Maude</title><style>${PAGE_CSS}${GOOGLE_BUTTON_CSS}${PUBLIC_CSS}${css}</style></head><body><main class="public"><div class="public-col"><div class="public-top">${top}<h1>${esc(title)}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}${pill ? `<span class="ad-web-role">${icon('edit', 12)}${esc(pill)}</span>` : ''}</div>${body}</div></main></body></html>`;
}

/** A public page as a Response. */
export function publicResponse(markup, status = 200, extraHeaders = {}) {
  const headers = new Headers(PUBLIC_PAGE_HEADERS);
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) for (const one of v) headers.append(k, one);
    else if (v != null) headers.set(k, v);
  }
  return new Response(markup, { status, headers });
}

/**
 * The quiet way back to the app on a page the app opened (S6↔S9 §5.1 step 7).
 *
 * A plain link and nothing else: no server state changes, the sign-in code
 * simply runs out. `state` must already be validated by `appState` — anything
 * that is not 32 lowercase hex never reaches markup (invariant 2).
 */
export function backToAppLink(state) {
  if (!isAppState(state)) return '';
  return `<a class="back-to-app" href="maude://auth/cancelled?state=${state}">Cancel and go back to the app</a>`;
}

/** The app's per-attempt sign-in nonce: 16 random bytes as 32 lowercase hex. */
export const APP_STATE = /^[0-9a-f]{32}$/;
export const isAppState = (s) => typeof s === 'string' && APP_STATE.test(s);

// ───────────────────────────── The signed-in shell ─────────────────────────────

/** What every operator page says across its top (canvas 16, cl-operator). */
export const OPERATOR_BAND =
  'Operator — you are looking at every account on Maude Cloud. Changes here are logged as yours.';

/** The promise under every signed-in page. */
const PROMISE =
  'Everything here is yours to take — every project can be downloaded in full, at any time, including after you stop paying for it.';

/** What a person is called in the corner: their name, or the part of the address before the @. */
export function displayName(account) {
  const name = String(account?.name ?? '').trim();
  if (name) return name;
  return String(account?.email ?? '').split('@')[0] || 'You';
}

const firstName = (account) => displayName(account).split(/\s+/)[0];

function navTab({ href, label, current, count = null, quiet = false }) {
  return `<a class="ad-nav-tab" href="${esc(href)}"${current ? ' aria-current="page"' : ''}>${esc(label)}${count ? `<span class="ad-count${quiet ? ' ad-count--quiet' : ''}">${esc(count)}</span>` : ''}</a>`;
}

/** Which tab a page's `active` key lights, on the island a customer sees. */
const TAB_OF = {
  overview: 'overview',
  projects: 'projects',
  new: 'projects',
  people: 'people',
  account: 'settings',
  settings: 'settings',
};

/** The project's own strip of doors, for the pages that are about ONE project. */
function projectTabs({ project, isOwner, active }) {
  const p = `/projects/${esc(project.id)}`;
  const tab = (key, label, { danger = false } = {}) =>
    `<a class="ad-tab${danger ? ' danger' : ''}" href="${p}/${key}"${active === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="ad-ptabs" aria-label="${esc(project.name || project.id)}">
    ${tab('connect', 'Open')}
    ${tab('people', 'People')}
    ${isOwner ? tab('billing', 'Billing') : ''}
    ${isOwner ? tab('mirror', 'GitHub copy') : ''}
    ${isOwner ? tab('saving', 'Saving') : ''}
    ${tab('audit', 'Activity')}
    ${tab('download', 'Download everything')}
    ${isOwner ? tab('delete', 'Delete project…', { danger: true }) : ''}
  </nav>`;
}

/**
 * A sheet over the page: the veil is the way back, the sheet sits on the right.
 *
 * These pages ship no script, so a sheet is its own address — the server
 * renders the page with the sheet on top, and Cancel (and the veil) are links
 * back to the page without it.
 *
 * @param {object} sheet
 * @param {string} sheet.title  plain text
 * @param {string|null} [sheet.sub]  plain text
 * @param {string} sheet.body   trusted markup — usually one `<form>`
 * @param {string} sheet.back   where Cancel goes (a path on this origin)
 */
function sheetMarkup(sheet, { op }) {
  const back = esc(sheet.back);
  return `<a class="ad-veil" href="${back}" aria-label="Close" tabindex="-1"></a>
<section class="ad-sheet ad-sheet--side${op ? ' ad-sheet--op' : ''}" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
  <h2 class="ad-sheet-t" id="sheet-title">${esc(sheet.title)}</h2>
  ${sheet.sub ? `<p class="ad-sheet-s">${esc(sheet.sub)}</p>` : ''}
  ${sheet.body}
</section>`;
}

/** The foot of a sheet: who it is logged as, Cancel, and the one action. `submit` is plain text. */
export function sheetActions({ back, submit, note = null }) {
  return `<div class="ad-sheet-a">${note ? `<span class="ad-quiet">${esc(note)}</span>` : ''}<span class="ad-sp"></span><a class="btn" href="${esc(back)}">Cancel</a><button type="submit" class="btn btn--primary">${esc(submit)}</button></div>`;
}

/**
 * The signed-in shell. Server-rendered, no script.
 *
 * @param {object} args
 * @param {{email: string, name?: string, owns?: number, operator?: boolean}} args.account
 * @param {string} args.title            document title, and the page's h1 unless `heading` is given
 * @param {string} args.body             main-column HTML (already escaped)
 * @param {string|null} [args.heading]   the h1, when it differs from the document title (plain text)
 * @param {string|null} [args.lede]      one quiet line under the h1 (plain text)
 * @param {string} [args.actions]        trusted markup for the head's action buttons
 * @param {object|null} [args.project]   {id, name} — adds the project's strip of doors
 * @param {boolean} [args.isOwner]       owner-only doors on that strip
 * @param {string} [args.active]         which tab is lit: overview|projects|new|people|account, a
 *   project door (connect|people|billing|mirror|saving|audit|download|delete), or operator[-…]
 * @param {{tone: string, label: string}|null} [args.pill]  the state, said next to the h1
 * @param {boolean} [args.wide]          the body spans the page (dashboards, tables) rather than one column
 * @param {object|null} [args.sheet]     a sheet over the page — see `sheetMarkup`
 * @param {{people?: number, fleet?: number}} [args.counts]  the small counts on the tabs
 * @param {boolean} [args.isOperator]    Cloud Phase 26 — this person is the allowlisted operator.
 *   Default false: the operator surface must not exist in a page a tenant can
 *   render, not as a link and not as a word (project-admin.test.mjs).
 */
export function appShell({
  account,
  title,
  body,
  heading = null,
  project = null,
  isOwner = false,
  isOperator = false,
  active = '',
  pill = null,
  lede = null,
  actions = '',
  wide = false,
  sheet = null,
  counts = {},
  extraCss = '',
}) {
  const operator = isOperator || account?.operator === true;
  const op = operator && String(active).startsWith('operator');
  const owns = Number(account?.owns ?? 0) > 0 || isOwner;
  const name = displayName(account);

  let tabs;
  let place;
  let search = '';
  if (op) {
    const on = (key) => active === key;
    tabs = [
      navTab({ href: '/operator', label: 'Overview', current: on('operator') }),
      navTab({ href: '/operator/accounts', label: 'Accounts', current: on('operator-accounts') }),
      navTab({ href: '/operator/projects', label: 'Projects', current: on('operator-projects') }),
      navTab({
        href: '/operator/fleet',
        label: 'Fleet',
        current: on('operator-fleet'),
        count: counts.fleet || null,
      }),
      navTab({ href: '/operator/events', label: 'Events', current: on('operator-events') }),
    ];
    place = '<small>Whole service</small><span class="ad-op-tag">Operator</span>';
    search = `<form class="ad-nav-search" role="search" method="get" action="/operator/accounts">${icon('search', 14)}<input type="search" name="q" placeholder="Search" aria-label="Search accounts"><span class="kbd" aria-hidden="true">⌘K</span></form>`;
  } else {
    const lit = project ? 'projects' : (TAB_OF[active] ?? '');
    tabs = [
      navTab({ href: '/', label: 'Overview', current: lit === 'overview' }),
      navTab({ href: '/projects', label: 'Projects', current: lit === 'projects' }),
    ];
    if (owns) {
      tabs.push(
        navTab({
          href: '/account/people',
          label: 'People',
          current: lit === 'people',
          count: counts.people || null,
        }),
        navTab({ href: '/account', label: 'Settings', current: lit === 'settings' })
      );
      search = `<form class="ad-nav-search" role="search" method="get" action="/account/people">${icon('search', 14)}<input type="search" name="q" placeholder="Search" aria-label="Search people"><span class="kbd" aria-hidden="true">⌘K</span></form>`;
    }
    place = `<small>${esc(name)}</small>`;
  }

  // The avatar menu: what is about YOU, on every page. The operator's way in
  // lives here and nowhere else, and only in the operator's own pages.
  const menu = [
    '<a href="/account">Account</a>',
    owns ? '<a href="/account/billing">Billing</a>' : '',
    '<a href="/account/macs">Your Macs</a>',
    operator
      ? op
        ? '<div class="menu-sep"></div><a href="/">Your own account</a>'
        : '<div class="menu-sep"></div><a href="/operator">Operator — Fleet and accounts</a>'
      : '',
    '<div class="menu-sep"></div>',
    '<form method="post" action="/auth/logout"><button type="submit" class="ghost">Sign out</button></form>',
  ].join('');
  const me = `${esc(firstName(account))}${!op && owns ? ' · Owner' : ''}`;

  const head = `<div class="ad-head"><div>${
    project
      ? `<p class="ad-crumb"><a href="/projects">Projects</a> › ${esc(project.name || project.id)}</p>`
      : ''
  }<div class="ad-h1-row"><h1 class="ad-h1">${esc(heading ?? title)}</h1>${
    pill ? `<span class="state">${statusWord(PILL_TONE[pill.tone] ?? 'ok', pill.label)}</span>` : ''
  }</div>${lede ? `<p class="ad-sub">${esc(lede)}</p>` : ''}</div>${
    actions ? `<div class="ad-head-a">${actions}</div>` : ''
  }</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} — Maude</title><style>${PAGE_CSS}${extraCss}</style></head><body>
${op ? `<div class="ad-band" role="note">${icon('server', 13)}<span>${OPERATOR_BAND}</span></div>` : ''}
<div class="ad-nav-wrap"><nav class="island ad-nav${op ? ' ad-nav--op' : ''}" aria-label="Maude Cloud">
  <a class="ad-nav-id" href="${op ? '/operator' : '/'}">${mark(24)}Maude Cloud${place}</a>
  <span class="ad-nav-tabs">${tabs.join('')}</span>
  <span class="ad-nav-sp"></span>
  ${search}
  <details class="menu ad-me"><summary class="ad-nav-me">${avatar(name, { seed: account?.email ?? name })}${me}<span class="ad-sr"> — signed in as ${esc(account?.email ?? '')}, account menu</span></summary><div class="menu-list"><div class="menu-hd">${esc(account?.email ?? '')}</div>${menu}</div></details>
</nav></div>
<main class="ad-main">
  ${head}
  ${project ? projectTabs({ project, isOwner, active }) : ''}
  ${wide ? body : `<div class="ad-col">${body}</div>`}
  <p class="ad-foot">${PROMISE}</p>
</main>
${sheet ? sheetMarkup(sheet, { op }) : ''}
</body></html>`;
}

/** The old three-tone state pill, said the DS way: a word with a dot. */
const PILL_TONE = { ok: 'ok', warn: 'warn', stop: 'off' };
