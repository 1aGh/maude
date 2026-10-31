// One face per comment author — the pin on the canvas, the thread card and the Comments panel's row all
// read this, so the three never disagree (rc.1 F08: the pin wore a "?" and a blue disc while the list wore a
// "U" on yellow, and a thread card spelled the name with two letters).
//
// Pure and React-free (the overlay runs in the canvas iframe, the panel in the shell).
//   - the viewer's own comments are "You" (CONTRACT §4 People), on the tone "You" wears on your own screen;
//   - a record nobody signed ('' or the old literal 'unknown') is "Someone", grey — never a "?";
//   - anybody else wears the colour their name hashes to, with their first letter.

import { type PersonTone, toneFor, YOU_TONE } from '../presence/tones.ts';

export const SOMEONE = 'Someone';

/** Did nobody sign this? (an old record has no author, or the literal 'unknown' an earlier build wrote) */
export const isUnsigned = (author: unknown): boolean => {
  if (typeof author !== 'string') return true;
  const a = author.trim().toLowerCase();
  return a === '' || a === 'unknown';
};

export interface AuthorFace {
  /** what the card writes: "You", the person's name, or "Someone" */
  name: string;
  /** the one letter on the face (pin, row, thread card) */
  letter: string;
  tone: PersonTone;
  you: boolean;
}

/** `viewer` is this Mac's own name (`/_api/git-user`) — the one new comments are signed with. */
export function authorFace(author: unknown, viewer?: string | null): AuthorFace {
  if (isUnsigned(author)) return { name: SOMEONE, letter: 'S', tone: 'grey', you: false };
  const name = (author as string).trim();
  const you = !!viewer && viewer.trim() === name;
  return {
    name: you ? 'You' : name,
    letter: name.charAt(0).toUpperCase(),
    tone: you ? YOU_TONE : toneFor(name),
    you,
  };
}
