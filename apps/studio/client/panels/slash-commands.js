// Phase 31 follow-up — the pure command model behind the ACP composer's
// autocomplete popover + inline command pill. No DOM, no React → unit-testable
// (apps/studio/test/slash-commands.test.ts).
//
// Two sources feed the model:
//   • STATIC_COMMANDS — a curated bootstrap list (below) so autocomplete is
//     instant before any `claude` session exists. Hand-sourced from the design
//     plugin command frontmatter (`name` + `description`); plugin markdown is NOT
//     shipped to the client, so the list is baked in here. (The `/flow:*` family
//     is intentionally omitted for now — 2026-07-03 — the chat ships design-only;
//     a user who installs flow themselves still gets it via the live catalogue.)
//   • live ACP `available_commands_update` — the drift-proof authority for which
//     commands ACTUALLY exist in the user's session (incl. their own custom
//     commands). Once present it wins for the "exists" set (badge gate).

/**
 * Curated bootstrap set. `name` is Claude Code's canonical slash form
 * (`<plugin>:<verb>`). Keep descriptions short — the popover truncates.
 */
export const STATIC_COMMANDS = [
  // ── design (the panel's primary surface) ──
  {
    name: 'design:edit',
    description: 'Iterate on the active canvas in place',
    argHint: '"<feedback>"',
  },
  {
    name: 'design:new',
    description: 'Scaffold a new multi-artboard canvas',
    argHint: 'Name "<brief>"',
  },
  {
    name: 'design:setup-ds',
    description: 'Create a new design system',
    argHint: '<name> ["<brief>"]',
  },
  {
    name: 'design:critic',
    description: 'Run the critic panel on the active canvas',
    argHint: '[--agent <name>]',
  },
  {
    name: 'design:draw',
    description: 'Draw a production-grade SVG via the geometry engine',
    argHint: '"<what to draw>"',
  },
  { name: 'design:screenshot', description: 'Capture a screenshot of the active canvas' },
  { name: 'design:browse', description: 'Open the local design browser' },
  { name: 'design:export', description: 'Export the active canvas (PNG / PDF / SVG / …)' },
  { name: 'design:rollback', description: 'Revert the last edit snapshot', argHint: '[--steps N]' },
  { name: 'design:handoff', description: 'Emit a shadcn registry-item sidecar' },
  { name: 'design:smoke', description: 'Batch-screenshot every canvas + preview specimen' },
  { name: 'design:setup-docs', description: 'Refresh the design root README + INDEX' },
  { name: 'design:to-lottie', description: 'Productionize an animation to a .lottie from code' },
  { name: 'design:to-rn', description: 'Generate a react-native-svg + Reanimated component' },
  { name: 'design:init', description: 'One-time project env init for the design plugin' },
  { name: 'design:help', description: 'List all design commands' },
];

/**
 * Fold a raw command name to a match key. Strips a leading `/`, lowercases, trims.
 * Claude Code's slash form is `<plugin>:<verb>`; we match on that verbatim.
 *
 * CONFIRMED against a live `claude` ACP session (plan Task 8): the adapter's
 * `available_commands_update` reports plugin commands in the colon+prefix form
 * (`design:edit`) — no separator/prefix massaging needed. User skills come
 * through prefix-less (`desktop-e2e`) → group `other`.
 */
export function normalizeName(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('/')) s = s.slice(1);
  return s.toLowerCase();
}

/** The plugin group of a normalized name (`design:edit` → `design`). */
export function groupOf(name) {
  const i = name.indexOf(':');
  return i > 0 ? name.slice(0, i) : 'other';
}

function sortCmd(a, b) {
  if (a.group !== b.group) return a.group < b.group ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Merge the static bootstrap list with the live ACP list.
 * @returns {{ all: Array, existsSet: Set<string> }}
 *  - `all` — deduped union, each `{ name, description, argHint, group, live }`.
 *  - `existsSet` — the authoritative "this command exists" set for the badge gate:
 *    the live names once we have any (strict), else the static keys (optimistic —
 *    the shipped design verbs are safe to badge before the first warm-up).
 */
export function buildCommandModel(staticList, liveList) {
  const live = Array.isArray(liveList) ? liveList : [];
  const liveSet = new Set(live.map((c) => normalizeName(c?.name)).filter(Boolean));
  const byName = new Map();

  for (const c of staticList) {
    const key = normalizeName(c.name);
    if (!key) continue;
    byName.set(key, {
      name: key,
      description: c.description || '',
      argHint: c.argHint || '',
      group: groupOf(key),
      live: liveSet.has(key),
    });
  }
  for (const c of live) {
    const key = normalizeName(c?.name);
    if (!key) continue;
    const existing = byName.get(key);
    if (existing) {
      existing.live = true;
      if (!existing.description && c.description) existing.description = c.description;
    } else {
      byName.set(key, {
        name: key,
        description: c?.description || '',
        argHint: '',
        group: groupOf(key),
        live: true,
      });
    }
  }

  const existsSet = liveSet.size ? liveSet : new Set(byName.keys());
  const all = [...byName.values()].sort(sortCmd);
  return { all, existsSet };
}

/**
 * Inspect the composer text for a LEADING slash command (commands are the first
 * token, matching Claude Code — mid-string `/` is out of scope).
 * @returns {{ token: string, full: string|null, typing: boolean } | null}
 *  - `typing: true`  — first token still being typed (no space yet) → open the popover.
 *    `token` is the partial after `/` (may be '' right after typing `/`).
 *  - `typing: false` — a command token followed by whitespace → highlight it.
 *    `full` is the `/command` token (for the pill).
 */
export function matchLeadingCommand(text) {
  const t = (text || '').replace(/^\s+/, '');
  if (!t.startsWith('/')) return null;
  const typing = t.match(/^\/([\w:-]*)$/);
  if (typing) return { token: typing[1], full: null, typing: true };
  const done = t.match(/^\/([\w:-]+)(?=\s)/);
  if (done) return { token: done[1], full: `/${done[1]}`, typing: false };
  return null;
}

/**
 * Rank commands for the popover against the partial `token` (no leading `/`).
 * Prefix matches first, then substring (name or description). Capped.
 */
export function filterCommands(all, token, limit = 8) {
  const q = normalizeName(token);
  if (!q) return all.slice(0, limit);
  const prefix = [];
  const substr = [];
  for (const c of all) {
    if (c.name.startsWith(q)) prefix.push(c);
    else if (c.name.includes(q) || c.description.toLowerCase().includes(q)) substr.push(c);
  }
  return [...prefix, ...substr].slice(0, limit);
}
