// The people a comment can @mention (S9.22; canvas 10/co-comment-thread "@Te … Can edit").
//
// The source is `GET /api/access/people?canvas=<c>` (S9.6): the hub already answers only with people who
// can open THAT canvas, and a non-owner's answer has no e-mails (L17). This module is the second lock:
// whatever a caller hands in, what reaches the popover is a name and a role word — never an address,
// never a pending invitation or request (they cannot open anything yet), never the person typing.
//
// Pure, erasable TypeScript (the overlay and the shell both import it).

export interface MentionRow {
  /** the hub's opaque id — only used to dedupe, never shown */
  id: string;
  name: string;
  /** the role word, when the source knew the role ("Can edit"); absent for a git-committer fallback */
  role?: string;
}

/** The words people see (CONTRACT §3 · A6/A19): never "viewer"/"member". */
export const ROLE_WORDS = Object.freeze({
  observer: 'Can view',
  viewer: 'Can comment',
  member: 'Can edit',
  owner: 'Owner',
} as const);

export const roleWord = (role: unknown): string | undefined =>
  typeof role === 'string' && Object.hasOwn(ROLE_WORDS, role)
    ? ROLE_WORDS[role as keyof typeof ROLE_WORDS]
    : undefined;

const MAX_ROWS = 200;

/**
 * Rows for the popover from a hub `people` answer. Pending rows (`state` set: invited / requested)
 * and rows without a usable name are dropped; `me` (a display name) is left out — mentioning
 * yourself nudges nobody.
 */
export function mentionRows(people: unknown, me?: string | null): MentionRow[] {
  if (!Array.isArray(people)) return [];
  const out: MentionRow[] = [];
  const seen = new Set<string>();
  const mine = (me ?? '').trim().toLowerCase();
  for (const p of people.slice(0, MAX_ROWS)) {
    if (!p || typeof p !== 'object') continue;
    const row = p as { id?: unknown; name?: unknown; role?: unknown; state?: unknown };
    if (row.state !== undefined && row.state !== null && row.state !== '') continue;
    if (typeof row.name !== 'string' || !row.name.trim()) continue;
    const name = row.name.trim().slice(0, 120);
    if (mine && name.toLowerCase() === mine) continue;
    const id = typeof row.id === 'string' && row.id ? row.id : name;
    if (seen.has(id)) continue;
    seen.add(id);
    const role = roleWord(row.role);
    out.push(role ? { id, name, role } : { id, name });
  }
  return out;
}

/** The names-only fallback when no hub answers (a local project): git committers, no role, no address. */
export function committerRows(committers: unknown, me?: string | null): MentionRow[] {
  if (!Array.isArray(committers)) return [];
  return mentionRows(
    committers.map((c) => ({ name: (c as { name?: unknown } | null)?.name })),
    me
  );
}
