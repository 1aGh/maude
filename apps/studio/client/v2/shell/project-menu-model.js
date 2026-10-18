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
  // S10.0 (client/v2/contracts/S10-ds-review-entry.md): not menu rows — the entries into the DS review
  // that S2.12 / S2.17 hide their rows behind until S10 registers them.
  'ds.review-update': 'S10 (S10.8 review update)',
  'ds.go-to': 'S10 (S10.6 go to master)',
  'ds.instance-update': 'S10 (S10.8 instance update)',
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
  // V2-4.7b: a row the shell knows is not offered here (Resync for a cloud member) leaves no row.
  if (state?.hidden?.includes(id)) return null;
  const item = {
    type: 'item',
    id,
    label: labelFor(def, state),
    keys: keyHint(def, ctx),
    icon: def.icon ?? null,
    disabled: !isEnabled(def, ctx),
  };
  // V2-4.7b: Diagnostics rows carry a status word / value ({ word, tone, mono? }) the shell computed.
  const status = state?.status?.[id];
  if (status?.word) item.status = status;
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
 * @param state `{ panelsHidden, checked: { <toggle id>: boolean }, status: { <id>: { word, tone, mono? } },
 *   hidden: [<id>] }` — what the labels / ticks / status words show, and the rows left out.
 */
export function buildProjectMenu(
  ctx,
  state = {},
  { tree = PROJECT_MENU, byId = ACTIONS_BY_ID } = {}
) {
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

/**
 * The project menu's rows as ⌘K commands (V2-4.2: "⌘K finds every row"). One row per action id the
 * menu shows (a row the tree names twice is one command), minus rows `existing` already lists under
 * a label that contains the menu's; group = the top-level submenu the row lives in. They appear once
 * something is typed.
 */
export function menuPaletteRows(ctx, { existing = [], run, state } = {}) {
  const rows = [];
  const seen = new Set();
  const had = new Map(existing.map((e) => [e.id, String(e.label).toLowerCase()]));
  const walk = (nodes, group) => {
    for (const n of nodes) {
      if (n.type === 'sub') walk(n.children, group ?? n.label);
      else if (n.type === 'item' && !seen.has(n.id)) {
        seen.add(n.id);
        // The palette already lists it under a label that a search for the menu's own words finds.
        if (had.get(n.id)?.includes(n.label.toLowerCase())) continue;
        rows.push({
          // A palette row with this id exists under another label: the twin gets its own key.
          id: had.has(n.id) ? `menu:${n.id}` : n.id,
          actionId: n.id,
          group: group ?? 'Menu',
          label: n.label,
          icon: 'chevron-right',
          ...(n.keys ? { kbd: n.keys } : {}),
          run: () => run(n.id),
          onlyWhenSearched: true,
        });
      }
    }
  };
  walk(buildProjectMenu(ctx, state), null);
  return rows;
}

/** Move to… destinations: every canvas group's folder, as the Files tree's row menu lists them
 *  (tree/tree.jsx `destinations`). The design-system group is never a destination. */
export function moveDestinations(groups) {
  const out = [];
  for (const g of groups ?? []) {
    if (g.label === 'Design system' || g.kind !== 'canvas') continue;
    out.push({ path: g.fullPath, label: g.fullPath.replace(/^\.[^/]+\//, '') || g.fullPath });
    for (const dir of g.dirs || []) out.push({ path: dir, label: dir.replace(/^\.[^/]+\//, '') });
  }
  return out;
}

/** The KeyCtx the menu resolves with: the shell's, focus on chrome (the menu is chrome). */
export function menuCtx({
  native = false,
  cloudTab = false,
  readOnly = false,
  canvasOpen = false,
  presenting = false,
  linkedHub = false,
  observer = false,
} = {}) {
  const facts = new Set();
  if (native) facts.add('native');
  // S3.7b — a desktop project linked to a cloud hub (Copy presentation link is enabled there).
  if (linkedHub) facts.add('linkedHub');
  if (canvasOpen) facts.add('canvasOpen');
  if (presenting) facts.add('presenting');
  return {
    // S3.12 — Can view (`observer`) is the registry's `view` rank, not `comment`: a rule-12 predicate with a
    // `minRole: 'comment'` must hide from it. Callers that know the cloud role pass `observer`.
    role: readOnly ? (observer ? 'view' : 'comment') : 'owner',
    // A tab served by a hub is the `cloud` shell (V2-4.8a: "Back to Home" is its dashboard link).
    shell: native ? 'desktop' : cloudTab ? 'cloud' : 'browser',
    mode: presenting ? 'present' : 'edit',
    focus: 'chrome',
    selection: 'none',
    facts,
  };
}
