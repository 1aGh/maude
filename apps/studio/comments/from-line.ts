/**
 * @file       comments/from-line.ts — S4.20: who a converted sticky "was from", in words
 * @scope      apps/studio/comments/from-line.ts
 * @purpose    A comment made from a sticky carries `from` (S4-S9-votes-comments §3.1). Its thread says
 *             "From Jonas's sticky · turned into a comment by You" (canvas 15 an-convert). An AI-authored
 *             sticky has no person's name: it reads "From AI's sticky" with the AI avatar (CONTRACT words),
 *             and a sticky nobody signed reads "From a sticky" — never "From 's sticky" with a "?" avatar.
 *             Pure: the thread and the tests read the same answer.
 */

/**
 * What `from.author` holds for an AI-authored sticky (the board's `author: { kind: 'ai' }` has no name).
 * The format has no author-kind field on `from` — adding one would be a versioned-file change — so the
 * word itself is the marker, written by the conversion route and read back here and by "Turn back".
 */
export const AI_FROM_AUTHOR = 'AI';

export interface FromLike {
  author?: unknown;
}

export interface FromWho {
  /** The name the thread card shows beside the avatar. */
  name: string;
  /** Draw the AI avatar. */
  ai: boolean;
  /** First name for the header line, or '' when the sticky was not signed. */
  first: string;
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || '';

export function fromWho(from: FromLike): FromWho {
  const name = typeof from.author === 'string' ? from.author.trim() : '';
  if (name === AI_FROM_AUTHOR) return { name, ai: true, first: name };
  return { name, ai: false, first: firstOf(name) };
}

/** "From Jonas’s sticky" · "From AI’s sticky" · "From a sticky". */
export function fromHeadline(from: FromLike): string {
  const w = fromWho(from);
  return w.first ? `From ${w.first}’s sticky` : 'From a sticky';
}
