// Wave-B gate design polish 1 — source pins for the two shared root causes the design critics found
// (.ai/plans/notes/v2-evidence/waveB-gate/design-critic-{1,2}.md):
//
//   RC-A  v2 sheets mounted in the shell (beside `.sh-shell`, outside `.maude-v2`) inherited body's v1 mono face
//         and resolved none of the v2-only tokens (--scrim, --island-*, --w-*, --font-rounded …).
//   RC-B  class names lifted from the boards' `_kit.css` / the DS `_components.css` with no rule in the app's
//         stylesheets, so the element rendered as a UA button or bare text.
//   RC-E  dead classes / text with no size (the same check catches them).
//
// decision:maude/v2-gate-b-polish1-v2-tokens-additive-in-shell, decision:maude/v2-gate-b-polish1-kit-anatomy-floor

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { shellCss, shellCssFiles } from './_shell-css';

const STUDIO = join(import.meta.dir, '..');
const CLIENT = join(STUDIO, 'client');
const read = (p: string) => readFileSync(p, 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n !== 'node_modules' && n !== 'contracts') walk(p, out);
    } else out.push(p);
  }
  return out;
}
const FILES = walk(CLIENT);
const CSS = FILES.filter((p) => p.endsWith('.css'));
const V2_SRC = FILES.filter(
  (p) => p.includes('/client/v2/') && /\.(jsx|js|tsx)$/.test(p) && !/\.test\./.test(p)
);

/** Every selector (comma-split) of every rule in the client's stylesheets. */
const SELECTORS: { file: string; sel: string }[] = [];
for (const f of CSS) {
  const flat = stripComments(read(f));
  // the text between `}` / `{` boundaries that precedes a `{` is a selector list (or an at-rule prelude)
  for (const m of flat.matchAll(/([^{}]+)\{/g)) {
    const prelude = m[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;
    for (const sel of prelude.split(',')) SELECTORS.push({ file: f, sel: sel.trim() });
  }
}
/** Home's anatomy is scoped under `.home-root` (its own page); it styles nothing in the shell. */
const homeScoped = (s: { file: string; sel: string }) =>
  /\.home-root\b/.test(s.sel) && !s.file.includes('/client/v2/');
const DEFINED = new Set<string>();
for (const s of SELECTORS) {
  if (homeScoped(s)) continue;
  for (const m of s.sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) DEFINED.add(m[1]);
}
const defined = (t: string) =>
  DEFINED.has(t) || (t.includes('--') && DEFINED.has(t.slice(0, t.indexOf('--'))));

/** The static className strings of the v2 tree: `className="…"`, `{'…'}`, `{`…`}` and `v2Scope('…')`. */
function classStrings(src: string): { s: string; dynamic: boolean }[] {
  const out: { s: string; dynamic: boolean }[] = [];
  const re =
    /className=(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`))|v2Scope\(\s*['"`]([^'"`]*)['"`]/g;
  for (const m of src.matchAll(re)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? '';
    const stat = raw.replace(/\$\{[^}]*\}/g, ' ');
    out.push({ s: stat, dynamic: stat !== raw });
  }
  return out;
}
const tokensOf = (s: string) =>
  s.split(/\s+/).filter((t) => t && /^-?[_a-zA-Z][\w-]*$/.test(t) && !t.endsWith('-'));

// ── RC-B: the kit anatomy has ONE shell-wide rule ────────────────────────────────────────────
// A kit class must be styled where any v2 surface can use it, not only under one parent (`.home-root .icon-btn`,
// `.v2-code-hd .icon-btn` left the Exports panel's collapse button a UA grey button).
const KIT = [
  'icon-btn',
  'k-icon-sm',
  'seg',
  'k-seg-b',
  'chip',
  'field',
  'field-label',
  'input',
  'select',
  'textarea',
  'k-sw',
  'k-adv',
  'k-adv-btn',
  'k-adv-count',
  'k-mono',
  'k-ic',
  'k-dialog-a',
  'k-canvas--dots',
];
const unscoped = (cls: string) =>
  SELECTORS.some(
    ({ sel }) =>
      sel === `.${cls}` ||
      sel === `.maude .${cls}` ||
      sel === `:where(.maude) .${cls}` ||
      sel.startsWith(`:where(.maude) .${cls}:`)
  );

// ── RC-B: every v2 element has a styled class ────────────────────────────────────────────────
// An element whose static classes ALL lack a rule is unstyled (a UA control or bare text at the inherited size).
// A class that rides beside a styled one is a hook (`ex-seg ex-scope-seg`) and passes. `k-*` kit names never pass
// as hooks — they are look, not identity.
// HOOKS: elements that are styled by other means on purpose.
const HOOKS = new Set([
  // the error boundary draws with inline styles: it must render when the stylesheet itself failed
  'shell-error',
  'shell-error-card',
  'shell-error-title',
  'shell-error-body',
  // a design-page marker the board's _kit.css reads; the app keeps the page's own palette by other means
  'k-fixed',
  // hidden test hook (`hidden` attribute)
  'dsr-shown',
  // layout wrappers on this lane's sheets, reviewed in gate-B polish 1: the children carry the look
  'bi-hd', // Import a brand / from Figma: the header around .bi-title
  'ex-other-grp', // Other…: role=group around .ex-other-gh + rows
  'ex-other-l', // Other… row label: a flex child of .ex-other-row, which carries the look (the tick moved to the row's ::before, P8-C4)
  'ex-panel-day', // Exports panel: the section around .ex-panel-t + job rows
  'fi-dest-k', // Figma › Put in: the label word inside .fi-dest
  'fi-pick', // Figma frame picker: wrapper around .fi-pick-hd + .fi-frames
  'fi-sum-adv', // Figma summary: wrapper around the Advanced fold
  'ho-ready-a', // Handoff ready card: wrapper around the Copy button
]);
// DEBT: unstyled today, outside this lane's surfaces (the AI panel, history, timeline, DS, left panel —
// polish2 / polish3). The list may only SHRINK: a new unstyled class fails, and a class here that gains a rule
// must be removed from the list (the test says so).
const DEBT = new Set([
  'ai-ba-arrow',
  'ai-cl-menu-hint',
  'bi-role',
  'chat-foot-popover-row',
  'cmp-title',
  'cmp-who-t',
  'dsa-row-v',
  'dsm-ready-note',
  'dsr-group',
  'dst-stack',
  'insp-adv-kind',
  'lp-browse-run',
  'lp-trash-group',
  'ob-dialog',
  'sd-ct',
  'si-new-t',
  'sh-mode-g',
  'sh-plist-name',
  'tl-take-t',
  'v2-err-snip-t',
  'v2ac-tip-t',
  'vh-item',
  'vh-list',
  'vh-undo-chat',
  'vh-undo-chat-line',
]);

function unstyled(): Map<string, Set<string>> {
  const miss = new Map<string, Set<string>>();
  for (const f of V2_SRC) {
    for (const { s, dynamic } of classStrings(read(f))) {
      const toks = tokensOf(s);
      const bad = toks.filter((t) => t.startsWith('k-') && !defined(t));
      if (!dynamic && toks.length && !toks.some(defined))
        for (const t of toks) if (!bad.includes(t)) bad.push(t);
      for (const t of bad) {
        if (HOOKS.has(t)) continue;
        if (!miss.has(t)) miss.set(t, new Set());
        miss.get(t)?.add(relative(CLIENT, f));
      }
    }
  }
  return miss;
}

describe('RC-B · kit classes and unstyled v2 elements', () => {
  test('every kit anatomy class the app names has a shell-wide rule', () => {
    expect(KIT.filter((c) => !unscoped(c))).toEqual([]);
  });
  test('no v2 element is left with only unstyled classes (outside the shrinking DEBT list)', () => {
    const miss = unstyled();
    const fresh = [...miss]
      .filter(([t]) => !DEBT.has(t))
      .map(([t, fs]) => `${t} (${[...fs].join(', ')})`);
    expect(fresh).toEqual([]);
    // a DEBT entry that is styled (or gone) now: take it off the list
    expect([...DEBT].filter((t) => !miss.has(t))).toEqual([]);
  });
});

// ── RC-A: the shell face and the v2 tokens reach a sheet mounted beside `.sh-shell` ──────────
describe('RC-A · v2 surfaces resolve the body face and the v2 tokens in the shell', () => {
  test('`.maude` itself speaks var(--font-body) (body resolves the v1 mono stack at :root)', () => {
    const css = stripComments(shellCss());
    // the last bare `.maude {` rule that sets a font-family is the one that wins
    const faces = [...css.matchAll(/\n\s*\.maude\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((body) => /font-family:/.test(body));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces[faces.length - 1]).toMatch(/font-family:\s*var\(--font-body\)/);
  });

  test('every var(--x) without a fallback in client/v2 CSS is declared in the shell scope', () => {
    // P8 C0: one generated shell ladder (maude-v2 on <html> + .maude) replaced the three token files
    const SHELL_TOKEN_FILES = ['styles/1-tokens-shell.css'];
    const declared = new Set<string>();
    for (const rel of SHELL_TOKEN_FILES)
      for (const m of read(join(CLIENT, rel)).matchAll(/^\s*(--[\w-]+)\s*:/gm)) declared.add(m[1]);
    // a surface may declare its own local custom properties
    for (const f of CSS)
      if (!f.includes('1-tokens'))
        for (const m of stripComments(read(f)).matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g))
          declared.add(m[1]);
    // …or set one inline on an element (`style={{ '--bi-bg': … }}`)
    for (const f of FILES.filter((p) => /\.(jsx|js|tsx)$/.test(p)))
      for (const m of read(f).matchAll(/['"](--[\w-]+)['"]\s*:/g)) declared.add(m[1]);
    const missing = new Set<string>();
    for (const f of CSS.filter((p) => p.includes('/client/v2/')))
      for (const m of stripComments(read(f)).matchAll(/var\((--[\w-]+)\s*\)/g))
        if (!declared.has(m[1])) missing.add(`${m[1]} (${relative(CLIENT, f)})`);
    expect([...missing].sort()).toEqual([]);
  });

  test('the shell ladder carries the v2 names the gap-filler used to add (P8 C0: one ladder, no additive block)', () => {
    const shell = [
      ...read(join(CLIENT, 'styles/1-tokens-shell.css')).matchAll(/^\s*(--[\w-]+)\s*:/gm),
    ].map((m) => m[1]);
    for (const n of ['--scrim', '--island-bg', '--w-semibold', '--font-rounded'])
      expect(shell).toContain(n);
  });

  test('the kit and the shell token files load in the bundle, in order — the kit before every area file', () => {
    const files = shellCssFiles();
    const pos = (f: string) => files.indexOf(f);
    expect(pos('styles/1-tokens-shell.css')).toBeGreaterThan(-1);
    expect(pos('styles/1-tokens-shell.css')).toBeLessThan(pos('styles/3-kit-maude-v2.css'));
    expect(pos('styles/3-kit-maude-v2.css')).toBeGreaterThan(-1);
    expect(pos('styles/3-kit-maude-v2.css')).toBeLessThan(
      files.findIndex((f) => f.startsWith('v2/'))
    );
  });
});
