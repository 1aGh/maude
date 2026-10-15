// client/v2/shell/project-menu-model.js — V2-4.2: the one menu (CONTRACT §1) as a render model.
//
// PURE (no DOM, no React): `PROJECT_MENU` (actions/menu.ts — the tree, as data) + the registry
// (labels, keys, visibility, enabled) + a KeyCtx → the rows the project pill's menu draws. Nothing
// here names a label or a key; a row whose id the registry does not hold yet is left out, and the
// exact list of those is `PENDING_MENU_IDS` — each with the task that registers it, pinned by
// test/project-menu-model.test.ts so a missing id cannot be forgotten and a newly registered one
// must leave the list.
//
//   { type: 'item', id, label, keys, icon, disabled, toggle?, checked? }
//   { type: 'sub',  label, advanced, children }
//   { type: 'sep' }

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { formatChord } from '../../../actions/keys.ts';
import { PROJECT_MENU } from '../../../actions/menu.ts';
import { holds, isEnabled, isVisible } from '../../../actions/resolve.ts';

/** Menu ids the registry does not hold yet → the task that registers them. The menu renders only
 *  what the registry has, so these rows appear the day their action lands (and the test goes red
 *  until they are taken off this list). */
export const PENDING_MENU_IDS = Object.freeze({
  'edit.undo-history': 'S2 (undo history)',
  'view.assets': 'V2-4.4',
  'view.layers-panel': 'V2-4.4',
  'view.exports': 'V2-4.3',
  'diag.sync': 'V2-4.7',
  'diag.server': 'V2-4.7',
  'diag.ai': 'V2-4.7',
  'diag.logs': 'V2-4.7',
  'diag.ai-recheck': 'V2-4.7',
  'diag.address': 'V2-4.7',
  'diag.process': 'V2-4.7',
  'diag.project-folder': 'V2-4.7',
  'sync.resync': 'V2-4.7',
  'sync.download-all': 'V2-4.7',
});

/** The label a state-dependent row shows. CONTRACT §1: "Hide panels / Show panels". */
function labelFor(def, state) {
  if (def.id === 'view.panels') return state?.panelsHidden ? 'Show panels' : 'Hide panels';
  return def.label;
}

/** The key the row shows: the first non-alias binding that is live in this shell (a `when` naming
 *  another shell, or a fact that is not true, is skipped; focus is not the menu's business). */
export function keyHint(def, ctx) {
  const live = (def.keys ?? []).filter(
    (b) => !b.alias && holds({ ...b.when, focus: undefined, selection: undefined }, ctx)
  );
  return live[0] ? formatChord(live[0].chord) : '';
}

function itemOf(id, ctx, state, byId) {
  const def = byId.get(id);
  if (!def || !isVisible(def, ctx)) return null;
  const item = {
    type: 'item',
    id,
    label: labelFor(def, state),
    keys: keyHint(def, ctx),
    icon: def.icon ?? null,
    disabled: !isEnabled(def, ctx),
  };
  if (def.kind === 'toggle') {
    item.toggle = true;
    const on = state?.checked?.[id];
    if (on !== undefined) item.checked = !!on;
  }
  return item;
}

/** Drop a leading / trailing / doubled separator. */
function tidy(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'sep' && (out.length === 0 || out[out.length - 1].type === 'sep')) continue;
    out.push(n);
  }
  while (out.length && out[out.length - 1].type === 'sep') out.pop();
  return out;
}

function build(nodes, ctx, state, byId) {
  const out = [];
  for (const n of nodes) {
    if ('sep' in n) {
      out.push({ type: 'sep' });
    } else if ('submenu' in n) {
      const children = tidy(build(n.items, ctx, state, byId));
      if (children.length === 0) continue;
      out.push({ type: 'sub', label: n.submenu, advanced: !!n.advanced, children });
    } else {
      const item = itemOf(n.id, ctx, state, byId);
      if (item) out.push(item);
    }
  }
  return out;
}

/**
 * The menu a person sees now.
 * @param ctx KeyCtx (actions/types.ts) — role, shell, mode, facts. Use `menuCtx()` to make one.
 * @param state `{ panelsHidden, checked: { <toggle id>: boolean } }` — what the labels / ticks show.
 */
export function buildProjectMenu(ctx, state = {}, { tree = PROJECT_MENU, byId = ACTIONS_BY_ID } = {}) {
  return tidy(build(tree, ctx, state, byId));
}

/** Every action id a model renders, in order (the test's tree-order check). */
export function modelIds(model) {
  const out = [];
  for (const n of model) {
    if (n.type === 'item') out.push(n.id);
    else if (n.type === 'sub') out.push(...modelIds(n.children));
  }
  return out;
}

/** The KeyCtx the menu resolves with: the shell's, focus on chrome (the menu is chrome). */
export function menuCtx({ native = false, readOnly = false, canvasOpen = false, presenting = false } = {}) {
  const facts = new Set();
  if (native) facts.add('native');
  if (canvasOpen) facts.add('canvasOpen');
  if (presenting) facts.add('presenting');
  return {
    role: readOnly ? 'comment' : 'owner',
    shell: native ? 'desktop' : 'browser',
    mode: presenting ? 'present' : 'edit',
    focus: 'chrome',
    selection: 'none',
    facts,
  };
}
