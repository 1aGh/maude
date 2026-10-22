// V2-7.1 — the docs describe the v2 window, not the v1 one.
//
// Maude 2 removed the status bar, the in-app menu bar, View → History, the Assistant, the Inspector
// vocabulary switch, the Dock and the banners (CONTRACT §1–§4 in .design/system/maude-v2/CONTRACT.md).
// A docs page that still names them tells a reader to click something that is not there. This walks
// site/content/docs/**/*.mdx and fails on those words. The words are the CONTRACT's "Not" column plus
// the v1 chrome the plan names (V2-7.1: status bar, menubar, View → History, ⌘⇧G, Inspector words).
//
// A page that names an old word ON PURPOSE (the "where did it go" page) says so in ALLOW, with the
// reason. An allowance is per file AND per rule, so a migration page cannot hide an unrelated slip.
//
//   node --test scripts/test/docs-no-old-chrome.test.mjs
//
// DOCS_DIR_UNDER_TEST=<dir> points it at another tree (how the red-first run proved it fails on the
// pre-V2-7.1 pages).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS = process.env.DOCS_DIR_UNDER_TEST
  ? resolve(process.env.DOCS_DIR_UNDER_TEST)
  : join(ROOT, 'site', 'content', 'docs');

/**
 * [id, regex, what to write instead]. Case-insensitive unless the rule says otherwise in `cs`.
 * "Dock" and "Assistant" are checked case-sensitively: lower-case "assistant" is a plain English
 * noun (the legal pages say "the AI assistant you sign in to"), the capitalised UI words are not.
 */
export const RULES = [
  ['status-bar', /status ?bar/i, 'the Share cluster (one save word) and Menu › Diagnostics'],
  [
    'menubar',
    /(?<!Mac['’]s own )(?<!macOS )(?<!native )menu ?bar/i,
    'the project pill menu ("Menu ›"); the Mac’s own menu bar may be named as such',
  ],
  ['view-history', /view\s*(?:→|->|>|›)\s*history/i, 'Version history (⌥⌘H, top level of Menu)'],
  ['history-chip', /\bchanges chip\b|\bHistory tab\b/i, 'Version history'],
  [
    'history-shortcut',
    /⌘⇧G|⇧⌘G|cmd\+shift\+g|<kbd>\s*Cmd\s*<\/kbd>\s*\+\s*<kbd>\s*Shift\s*<\/kbd>\s*\+\s*<kbd>\s*G\s*<\/kbd>/i,
    'Version history is ⌥⌘H; ⇧⌘G removes a frame',
  ],
  ['export-shortcut', /(?<![⇧⌥])⌘E\b|\bcmd\+e\b/i, '⇧⌘E Export… (⌘E is unbound in Maude 2)'],
  [
    'inspector-vocabulary',
    /inspector words|vocabulary (?:toggle|switch)|designer\s*\/\s*advanced/i,
    'Inspector › Advanced (the raw editor); there is no vocabulary switch',
  ],
  ['dock', /\bDock\b(?!er)/, 'toolbar (the bottom tool island)'],
  ['rail', /\brail\b/i, 'panel'],
  ['mode-stamp', /mode stamp/i, 'the Edit · Preview · Present switch in the Share cluster'],
  [
    'path-bar',
    /path ?bar|breadcrumb bar/i,
    'Search ⌘K shows where a thing lives (Menu › File › …)',
  ],
  ['banner', /\bbanners?\b/i, 'a callout (one action at most) or a toast'],
  ['topbar', /\btop ?bar\b/i, 'the Share cluster / the project pill'],
  ['sidebar', /\bsidebar\b/i, 'panel (the left panel: Canvases · Layers · Assets)'],
  ['command-palette', /command palette|⌘K menu/i, 'Search (⌘K)'],
  ['assistant', /\bAssistant\b/, 'AI chat panel (first mention), then AI'],
  [
    'canvas-browser',
    /canvas browser|\bBrowse tool\b|file tree|tabbed iframe/i,
    'the Canvases panel; Preview mode',
  ],
  ['cmd-click', /cmd\+click|⌘-?click to (?:edit|select)/i, 'select with V, then click'],
  ['sync-panel', /\bSync panel\b/, 'Menu › Diagnostics › Sync'],
  ['export-dialog', /export dialog/i, 'the Export sheet (⇧⌘E)'],
  ['icon-menu', /\bicon menu\b/i, 'Menu (under the project pill)'],
  [
    'file-share-link',
    /file\s*(?:→|->|›)\s*share link/i,
    'Share… (opens the Share sheet; Copy link is inside it)',
  ],
];

/**
 * Allowances: `file` (relative to the docs dir) → rule ids → why. Keep this short; every row is a
 * page that names an old word on purpose.
 */
export const ALLOW = {
  'moving-from-1.mdx': {
    why: 'the "where did it go" page names every v1 control so a Maude 1 user can find its new home',
    rules: '*',
  },
};

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.mdx')) out.push(p);
  }
  return out;
}

function allowed(rel, id) {
  const a = ALLOW[rel];
  return !!a && (a.rules === '*' || a.rules.includes(id));
}

export function findOldChrome(dir = DOCS) {
  const hits = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split('\\').join('/');
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const [id, re, instead] of RULES) {
        const m = re.exec(line);
        if (m && !allowed(rel, id)) {
          hits.push(`${rel}:${i + 1} [${id}] "${m[0]}" — write: ${instead}`);
        }
      }
    });
  }
  return hits;
}

test('the docs name no Maude 1 chrome (status bar, menubar, View → History, ⌘⇧G, Inspector words, …)', () => {
  assert.deepEqual(findOldChrome(), [], 'a docs page still describes a control Maude 2 removed');
});

test('every ALLOW row names a page that exists and says why', () => {
  for (const [file, a] of Object.entries(ALLOW)) {
    assert.ok(a.why && a.why.length > 20, `${file}: an allowance needs a reason`);
    assert.ok(statSync(join(DOCS, file)).isFile(), `${file}: allowed but not in the docs tree`);
  }
});

test('the rules catch what they name (a rule that matches nothing guards nothing)', () => {
  const sample = {
    'status-bar': 'the changes chip in the status bar',
    menubar: 'the menubar names the project',
    'view-history': 'from View → History',
    'history-chip': 'the changes chip',
    'history-shortcut': '<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>',
    'export-shortcut': 'the export dialog (⌘E)',
    'inspector-vocabulary': 'the Inspector words switch',
    dock: 'the Dock',
    rail: 'the rail',
    'mode-stamp': 'the mode stamp',
    'path-bar': 'the path bar',
    banner: 'a yellow banner',
    topbar: 'Share link in the topbar',
    sidebar: 'at the bottom of the sidebar',
    'command-palette': 'in the command palette',
    assistant: 'describe it to the Assistant',
    'canvas-browser': 'the canvas browser',
    'cmd-click': 'Cmd+Click any element',
    'sync-panel': 'listed in the Sync panel',
    'export-dialog': 'the PNG export dialog',
    'icon-menu': 'the icon menu',
    'file-share-link': 'File → Share link…',
  };
  for (const [id, re] of RULES) {
    assert.ok(sample[id], `${id}: add a sample line`);
    assert.ok(re.test(sample[id]), `${id}: does not match its own sample "${sample[id]}"`);
  }
  // The shapes that must NOT trip it.
  const fine = [
    ['menubar', "the Mac's own menu bar keeps Maude, Edit and Help"],
    ['dock', 'docker compose up -d'],
    ['export-shortcut', 'Export… ⇧⌘E'],
    ['assistant', 'the AI assistant you sign in to'],
  ];
  for (const [id, line] of fine) {
    const re = RULES.find(([rid]) => rid === id)[1];
    assert.ok(!re.test(line), `${id}: wrongly matches "${line}"`);
  }
});
