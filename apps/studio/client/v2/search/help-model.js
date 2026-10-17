// client/v2/search/help-model.js — V2-4.6: the "?" sheet as a render model (06 ad-search).
//
// PURE. Built from the registry's keymap at call time — a chord is read from the action, never typed
// here, so V2-4.5b's tool re-binding shows up the moment it lands. Groups are `HELP_GROUPS`
// (actions/help.ts). An action's group is its own `help.group` when the registry carries one, else
// `HELP_FALLBACK` below (the registry has no `help` fields yet — patch request). The Advanced fold
// holds the keys whose home passes through a View › Advanced / Diagnostics group, with the path, then
// "Keys and tools that moved".

import { ACTIONS, ACTIONS_BY_ID } from '../../../actions/index.ts';
import { HELP_GROUPS } from '../../../actions/help.ts';
import { BROWSER_RESERVED, formatChord } from '../../../actions/keys.ts';
import { menuPaths } from '../../../actions/menu.ts';
import { holds, isVisible } from '../../../actions/resolve.ts';
import { toolbarOf } from './search-model.js';
import { movedKeys } from './moved-keys.js';
import { fold } from '../../../index/match.ts';

/** Explicit placement for the registry's non-tool actions until they carry `help.group`. */
const HELP_FALLBACK = Object.freeze({
  'canvas.new': 'file',
  'project.new': 'file',
  'project.open': 'file',
  'home.open': 'file',
  'tab.close': 'file',
  'history.open': 'file',
  'export.open': 'file',
  'handoff.open': 'file',
  'settings.open': 'file',
  'edit.undo': 'canvas',
  'edit.redo': 'canvas',
  'ui.step-back': 'canvas',
  'view.zoom-in': 'canvas',
  'view.zoom-out': 'canvas',
  'view.zoom-fit': 'canvas',
  'view.zoom-actual': 'canvas',
  'view.jump-artboard': 'canvas',
  'view.annotations': 'canvas',
  'view.panels': 'panels-ai',
  'view.comments': 'panels-ai',
  'view.assets': 'panels-ai',
  'view.design-system': 'panels-ai',
  'ai.chat': 'panels-ai',
  'search.open': 'panels-ai',
  'canvases.search': 'panels-ai',
  'canvases.find': 'panels-ai',
  'canvases.refresh': 'panels-ai',
  'help.shortcuts': 'panels-ai',
  'help.guides': 'panels-ai',
  'present.canvas': 'present',
});

const PREFIX_GROUP = Object.freeze([
  [/^timeline\./, 'timeline'],
  [/^(object|annotation|select)\./, 'objects'],
  [/^edit\.(copy|cut|paste|copy-properties|paste-properties)$/, 'objects'],
  [/^tab\./, 'file'],
]);

/** ⌘1–9 are one row, not nine. */
const TAB_DIGITS = /^tab\.select-/;

const modeOf = (bar) => (bar === null ? null : /^Preview/.test(bar) ? 'preview' : 'edit');

/** The sheet group an action belongs in. */
export function helpGroupOf(def) {
  if (def.help?.group) return def.help.group;
  if (def.kind === 'tool')
    return modeOf(toolbarOf(def)) === 'preview' ? 'preview-tools' : 'edit-tools';
  if (HELP_FALLBACK[def.id]) return HELP_FALLBACK[def.id];
  for (const [re, g] of PREFIX_GROUP) if (re.test(def.id)) return g;
  return 'canvas';
}

const uniq = (xs) => [...new Set(xs)];
const MODS = /^[⌃⌥⇧⌘]+/;
const baseOf = (chord) => chord.replace(MODS, '');

/**
 * The chords a row shows: the live primaries first, then aliases ("or"). One chord bound in two
 * focus lanes is one key, and a v1 "any modifier" alias set (three or more modifier spellings of
 * a primary's key — Step back on ⌥⇧⌘Esc) is not a shortcut anyone learns, so it is not listed.
 */
function chordsOf(def, ctx) {
  const live = (def.keys ?? []).filter(
    (b) => !b.hold && holds({ ...b.when, focus: undefined, selection: undefined }, ctx)
  );
  const main = uniq(live.filter((b) => !b.alias).map((b) => b.chord));
  const alt = uniq(live.filter((b) => b.alias).map((b) => b.chord)).filter(
    (c) => !main.includes(c)
  );
  const perBase = new Map();
  for (const c of alt) perBase.set(baseOf(c), (perBase.get(baseOf(c)) ?? 0) + 1);
  const mainBases = new Set(main.map(baseOf));
  return {
    main,
    alt: alt.filter((c) => !(mainBases.has(baseOf(c)) && perBase.get(baseOf(c)) >= 3)),
  };
}

/** A key a browser keeps for itself is shown as the menu path that does the same (§5.10). */
function shownKeys(chords, ctx, path) {
  const browserKeeps = ctx.shell !== 'desktop' && chords.some((c) => BROWSER_RESERVED.has(c));
  if (browserKeeps && path) return { text: path, path: true };
  return null;
}

/**
 * @param ctx KeyCtx (`menuCtx()` — native decides `shell`)
 * @returns {{ groups: {id,label,note?,rows:{id,label,keys:string[],alt:string[],path?:string}[]}[],
 *   advanced: {id,label,keys:string[],path:string}[], moved: {was,now}[], count: number }}
 */
export function buildHelpSheet(ctx, { actions = ACTIONS, byId = ACTIONS_BY_ID, moved } = {}) {
  const paths = menuPaths(byId);
  const visible = (def) => ['edit', 'preview'].some((mode) => isVisible(def, { ...ctx, mode }));
  const byGroup = new Map(HELP_GROUPS.map((g) => [g.id, []]));
  const advanced = [];
  let tabRow = false;
  for (const def of actions) {
    if (!def.keys?.length || !visible(def)) continue;
    if (def.search?.hidden && !def.help) continue;
    if (TAB_DIGITS.test(def.id)) {
      tabRow = true;
      continue;
    }
    if (/^tab\.(next|prev)$/.test(def.id)) continue;
    const { main, alt } = chordsOf(def, ctx);
    if (main.length === 0 && alt.length === 0) continue;
    const menu = paths.get(def.id) ?? [];
    const inAdvanced = menu.some((p) => p.advanced || /^Menu › Diagnostics/.test(p.path));
    const path = (menu.find((p) => p.advanced) ?? menu[0])?.path;
    const keys = main.map((c) => formatChord(c));
    const row = { id: def.id, label: def.label, keys, alt: alt.map((c) => formatChord(c)) };
    if (inAdvanced) {
      advanced.push({ ...row, path: path ?? '' });
      continue;
    }
    const shown = shownKeys(main, ctx, path);
    if (shown) row.path = shown.text;
    byGroup.get(helpGroupOf(def))?.push({ ...row, order: def.help?.order ?? 1000 });
  }
  if (tabRow) {
    byGroup
      .get('file')
      .push({ id: 'tab.select', label: 'Show tab 1–9', keys: ['⌘1–9'], alt: [], order: 2000 });
  }
  // Two actions that read the same and take the same keys (Nudge for objects and for
  // annotations) are one row on a sheet that says what a key does, not which handler runs it.
  // The row keeps the merged ids in `also`, so "every visible key is on the sheet" still holds.
  const merged = (rows) => {
    const first = new Map();
    return rows.filter((r) => {
      const k = `${r.label}\u0000${r.keys.join(' ')}\u0000${r.alt.join(' ')}`;
      const kept = first.get(k);
      if (kept) {
        kept.also = [...(kept.also ?? []), r.id];
        return false;
      }
      first.set(k, r);
      return true;
    });
  };
  const groups = HELP_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    ...(g.note ? { note: g.note } : {}),
    rows: merged((byGroup.get(g.id) ?? []).sort((a, b) => a.order - b.order)),
  })).filter((g) => g.rows.length > 0);
  const keyOf = (id) => {
    const def = byId.get(id);
    const k = def ? chordsOf(def, ctx).main[0] : null;
    return k ? formatChord(k) : '';
  };
  const movedRows = moved ?? movedKeys(keyOf);
  const count = groups.reduce((n, g) => n + g.rows.length, 0) + advanced.length;
  return { groups, advanced, moved: movedRows, count };
}

/** "Find a shortcut": the ⌘K matcher's fold + every word (sanitised, any order) over label + keys. */
export function filterHelpSheet(sheet, query) {
  const words = fold(String(query ?? '').replace(/[^\p{L}\p{N}⌘⇧⌥⌃]+/gu, ' '))
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return sheet;
  const hit = (row) => {
    const hay = fold([row.label, ...row.keys, ...row.alt, row.path ?? ''].join(' '));
    return words.every((w) => hay.includes(w));
  };
  const groups = sheet.groups
    .map((g) => ({ ...g, rows: g.rows.filter(hit) }))
    .filter((g) => g.rows.length);
  const advanced = sheet.advanced.filter(hit);
  const moved = sheet.moved.filter((m) =>
    words.every((w) => fold(`${m.was} ${m.now}`).includes(w))
  );
  return {
    groups,
    advanced,
    moved,
    count: groups.reduce((n, g) => n + g.rows.length, 0) + advanced.length,
  };
}
