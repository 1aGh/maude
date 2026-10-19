// Phase 31 follow-up — the pure command model behind the ACP composer's
// autocomplete popover + inline command pill. No DOM, no React → unit-testable
// (apps/studio/test/slash-commands.test.ts).
//
// Two sources feed the model:
//   • STATIC_COMMANDS — a bootstrap list (slash-commands.gen.js) so autocomplete is
//     instant before any `claude` session exists. Generated from the design
//     plugin command frontmatter (`name` + `description` + `argument-hint`); plugin
//     markdown is NOT shipped to the client, so the list is baked in. (The `/flow:*` family
//     is intentionally omitted for now — 2026-07-03 — the chat ships design-only;
//     a user who installs flow themselves still gets it via the live catalogue.)
//   • live ACP `available_commands_update` — the drift-proof authority for which
//     commands ACTUALLY exist in the user's session (incl. their own custom
//     commands). Once present it wins for the "exists" set (badge gate).

/**
 * Bootstrap set. GENERATED (scripts/gen-plugin-surfaces.mjs, S12.2) from the design plugin's
 * `commands/*.md` frontmatter, so a new command reaches autocomplete without an edit here.
 * `name` is Claude Code's canonical slash form (`<plugin>:<verb>`).
 */
export { STATIC_COMMANDS } from './slash-commands.gen.js';

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

// ── S5.18 G8 (03 `ai-adv-edges`, `chat-cmd-menu`): the trimmed v2 menu ─────────────────────────────
//
// Typing "/" shows a short "Slash commands" list — the four design verbs people reach for, then the
// person's own commands — with one-line notes and no argument hints. NOTHING is removed: "More…" (and
// typing, which searches every command) reaches the whole catalogue, plugins' and the person's own.

/** The verbs the short list leads with, and the one-line note 03 draws under each. */
export const FEATURED = Object.freeze([
  { name: 'design:critic', note: 'Review this canvas' },
  { name: 'design:edit', note: 'Change the selection' },
  { name: 'design:screenshot', note: 'Capture an artboard' },
  { name: 'design:export', note: 'Export this canvas' },
]);

/** Rows the short list shows before "More…". */
export const MENU_ROWS = 5;
const NOTE_MAX = 44;

/** A command's one-line note: the featured words, else the description's first sentence, cut short. */
export function shortNote(c) {
  const f = FEATURED.find((x) => x.name === c.name);
  if (f) return f.note;
  const first = String(c.description ?? '')
    .split(/(?<=[.!?])\s/)[0]
    .trim()
    .replace(/[.!?]$/, '');
  if (first.length <= NOTE_MAX) return first;
  return `${first.slice(0, NOTE_MAX - 1).trimEnd()}…`;
}

/**
 * The rows of the "/" menu. `token` is the partial after the slash; `expanded` is "More…" picked.
 * @returns {{ items: Array, more: number }} items carry `note` (no argHint); `more` = what "More…" would add.
 */
export function trimmedCommands(all, token, { expanded = false } = {}) {
  const q = normalizeName(token);
  let rows;
  let total;
  if (q) {
    const hits = filterCommands(all, q, 200);
    total = hits.length;
    rows = expanded ? hits : hits.slice(0, MENU_ROWS);
  } else {
    total = all.length;
    if (expanded) rows = all;
    else {
      const byName = new Map(all.map((c) => [c.name, c]));
      const lead = FEATURED.map((f) => byName.get(f.name)).filter(Boolean);
      // the person's own commands (anything that is not the design plugin's) fill the rest of the short list
      const own = all.filter((c) => c.group !== 'design');
      rows = [...lead, ...own].slice(0, MENU_ROWS);
    }
  }
  const items = rows.map((c) => ({ ...c, argHint: '', note: shortNote(c) }));
  return { items, more: expanded ? 0 : Math.max(0, total - items.length) };
}
