// Mentions — parsed from the comment, never from a client-stated list (S9.7, S9-slices Q7).
//
// The one parser. The studio stores the `@handle` tokens a thread holds (`Comment.mentions`); the
// hub decides who a NEW token reaches. A token reaches a person only when that person can open the
// canvas — the caller passes the people WITH access, so "nobody by that name" and "somebody without
// access" are the same empty answer, and the door that delivers says nothing either way (V2-1.16
// L10: "a mention of someone without access to that canvas is stored as text: no notification, no
// grant, no e-mail"). AI-written text never mentions (C3).
//
// Erasable TypeScript only (the hub imports it under Node).

/** `@` then a word character, then word characters, dots and dashes — `api.ts parseMentions`. */
const MENTION_RE = /@[\w][\w.-]*/g;

/** The `@handle` tokens of `text`, in order, deduped, literal (`"@ada @lin @ada"` → 2). */
export function parseMentions(text: unknown): string[] {
  const out: string[] = [];
  if (typeof text !== 'string' || !text) return out;
  const seen = new Set<string>();
  for (const m of text.matchAll(MENTION_RE)) {
    const tok = m[0];
    if (!tok || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

interface Authored {
  text?: unknown;
  body?: unknown;
  authorKind?: unknown;
}

/** Text a person wrote (an AI-authored part never mentions — C3). */
const personText = (part: Authored, key: 'text' | 'body'): string =>
  part.authorKind === 'ai' || typeof part[key] !== 'string' ? '' : (part[key] as string);

/** Every token a thread holds: the comment's text and every person-written reply. */
export function mentionsOf(c: Authored & { thread?: unknown }): string[] {
  const replies = Array.isArray(c.thread) ? (c.thread as Authored[]) : [];
  return parseMentions(
    [personText(c, 'text'), ...replies.map((r) => personText(r ?? {}, 'body'))].join('\n')
  );
}

/** The tokens in `after` that `before` did not hold — what one op newly mentions. */
export function addedMentions(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before.map(normalizeHandle));
  return after.filter((t) => !had.has(normalizeHandle(t)));
}

/** `@Ada.` → `ada`: the comparison form (a sentence's full stop is not part of a name). */
export function normalizeHandle(token: string): string {
  return String(token)
    .replace(/^@/, '')
    .replace(/[.-]+$/, '')
    .toLowerCase();
}

/** What the autocomplete inserts for a name (`comments-overlay.tsx firstNameSlug`). */
export function handleOfName(name: string): string {
  const first =
    String(name ?? '')
      .trim()
      .split(/\s+/)[0] ?? '';
  return first.replace(/[^\w.-]/g, '').toLowerCase();
}

/** A person who can open the canvas. `id` is how the hub knows them (never sent to a client). */
export interface MentionPerson {
  id: string;
  name: string;
}

/** The handles a person answers to: their first name, and an address's local part. */
export function handlesOf(person: MentionPerson): string[] {
  const out = new Set<string>();
  const byName = handleOfName(person.name);
  if (byName) out.add(normalizeHandle(byName));
  const at = person.id.indexOf('@');
  if (at > 0) out.add(normalizeHandle(person.id.slice(0, at)));
  out.delete('');
  return [...out];
}

/**
 * Who `tokens` reach among `people` (the people with access to the canvas). Unknown and
 * no-access tokens resolve to nothing — the caller cannot tell them apart, by design.
 * `exclude` is the author: mentioning yourself nudges nobody.
 */
export function resolveMentions(
  tokens: readonly string[],
  people: readonly MentionPerson[],
  { exclude }: { exclude?: string } = {}
): MentionPerson[] {
  const wanted = new Set(tokens.map(normalizeHandle).filter(Boolean));
  if (wanted.size === 0) return [];
  const out = new Map<string, MentionPerson>();
  for (const p of people) {
    if (!p || typeof p.id !== 'string' || p.id === exclude || out.has(p.id)) continue;
    if (handlesOf(p).some((h) => wanted.has(h))) out.set(p.id, p);
  }
  return [...out.values()];
}
