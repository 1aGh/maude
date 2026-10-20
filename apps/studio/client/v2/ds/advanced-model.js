// client/v2/ds/advanced-model.js — S10.19: the words and small decisions of Design system › Advanced
// (13 · ds-advanced). Pure.

import { agoWords } from './update-model.js';

export const ADVANCED_WORDS = Object.freeze({
  title: 'Design system',
  check: 'Check the system',
  checking: 'Checking…',
  neverRan: 'Not checked yet',
  show: 'Show',
  advanced: 'Advanced',
  advancedHint: 'Tokens · files',
  files: 'Files',
  css: 'CSS',
  json: 'JSON',
  handoff: 'Hand off tokens',
  reveal: 'Reveal in Finder',
  flowTitle: 'Which way changes flow',
  historyTitle: 'Version history',
  restore: 'Restore…',
  nothingPublished: 'Nothing published yet.',
  askAi: 'Ask AI to review',
  panel: 'critic panel: a11y · completeness · keeper',
  noFile: 'This file is not here yet.',
  refused: 'You can’t check this design system.',
  failed: 'Couldn’t check the system.',
});

/** The three ways round, as the drawing says them. */
export const FLOW_ROWS = Object.freeze([
  {
    id: 'canvas',
    icon: 'layers',
    lead: 'Design system canvas',
    rest: 'where designers edit. It writes the files.',
  },
  {
    id: 'files',
    icon: 'file',
    lead: 'The files',
    rest: 'what code, Claude Code and other agents read.',
  },
  {
    id: 'outside',
    icon: 'sync',
    lead: 'Changed outside the app',
    rest: 'comes back as a review: Keep or Undo. A clash keeps both until one is picked.',
  },
]);

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Light · Dark" from the board's themes. */
export function modesLine(themes) {
  if (!themes) return '';
  const names = [themes.light, themes.dark].filter(Boolean);
  return names.map(cap).join(' · ');
}

/** "5 canvases" · "1 canvas" · "No canvases yet"; null when the usage index has not said. */
export function usedByLine(canvases) {
  if (!Number.isFinite(canvases)) return null;
  if (canvases === 0) return 'No canvases yet';
  return `${canvases} ${canvases === 1 ? 'canvas' : 'canvases'}`;
}

/** "ran 1 min ago" — or the quiet word before the first run. */
export function ranWords(check, now = Date.now()) {
  if (!check?.at) return ADVANCED_WORDS.neverRan;
  const ago = agoWords(check.at, now);
  return ago ? `ran ${ago}` : ADVANCED_WORDS.neverRan;
}

/** The rows of the card; a stored answer is data, so every field is judged before it is drawn. */
export function checkRows(check) {
  const lines = Array.isArray(check?.lines) ? check.lines : [];
  return lines
    .filter((l) => l && typeof l === 'object' && typeof l.title === 'string')
    .map((l) => ({
      id: ['contrast', 'pair', 'complete', 'schema'].includes(l.id) ? l.id : 'pair',
      ok: l.ok === true,
      title: l.title.slice(0, 120),
      text: typeof l.text === 'string' ? l.text.slice(0, 240) : '',
      show: typeof l.show === 'string' && /^--[A-Za-z0-9_-]{1,128}$/.test(l.show) ? l.show : null,
    }));
}

/** One line for a toast after a run: the first thing that is not well, else the head of the card. */
export function checkToast(check) {
  const rows = checkRows(check);
  if (!rows.length) return ADVANCED_WORDS.failed;
  const r = rows.find((x) => !x.ok) ?? rows[0];
  return `${r.title}: ${r.text}`;
}

/** The folder to reveal, project-relative: `.design/system/acme`. null for anything that is not a plain folder. */
export function revealRel(designRel, folder) {
  const d = String(designRel ?? '.design').replace(/^\/+|\/+$/g, '');
  const f = String(folder ?? '').replace(/^\/+|\/+$/g, '');
  if (!f || f.split('/').includes('..')) return null;
  return d ? `${d}/${f}` : f;
}

/** What "Ask AI to review" puts in the composer. It never sends: pressing send is the person's. */
export function askAiText(ds, label) {
  const name = label || ds;
  return `Review the design system “${name}” with /design:critic --system-only. Start from maude design ds check-system ${ds} --json, then look at accessibility, completeness and the schema.`;
}
