/**
 * @file       presence/tones.ts — S9.23 (CONTRACT §6 C32): who wears which colour.
 * @purpose    People wear sky / green / yellow / lilac / grey and never coral — coral sits next to the
 *             AI's spark. A tone is stable per person: it is a pure function of the name, so every window
 *             that hashes "Tereza" lands on the same one. A crowd repeats tones; names carry it.
 *             "You" is yellow on your own screen (never on anyone else's).
 *
 * Pure and React-free: `use-collab.tsx` (cursor colours) and the shell (face rings, rows) both read it.
 * Tokens are the DS's `--object-<tone>`; the literals are the canvas-side fallback for a cursor, which
 * crosses a hub as an `oklch()` string (`PEER_COLOR` in the dgn table).
 */

export const PERSON_TONES = ['sky', 'green', 'yellow', 'lilac', 'grey'] as const;
export type PersonTone = (typeof PERSON_TONES)[number];

/** What "You" wears on your own screen (C32). */
export const YOU_TONE: PersonTone = 'yellow';

/** Mid-lightness literals — readable on both themes (the DS presence weight, L 0.7–0.8). */
export const TONE_COLOR: Readonly<Record<PersonTone, string>> = Object.freeze({
  sky: 'oklch(0.78 0.10 230)',
  green: 'oklch(0.74 0.13 152)',
  yellow: 'oklch(0.82 0.14 95)',
  lilac: 'oklch(0.76 0.10 290)',
  grey: 'oklch(0.70 0.01 250)',
});

/** djb2 over the name → one of the five tones. Empty name → the first. */
export function toneFor(name: string): PersonTone {
  if (!name) return PERSON_TONES[0];
  let hash = 5381;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) + hash + name.charCodeAt(i)) | 0;
  const idx = ((hash % PERSON_TONES.length) + PERSON_TONES.length) % PERSON_TONES.length;
  return PERSON_TONES[idx] ?? PERSON_TONES[0];
}

export const toneColor = (tone: PersonTone): string => TONE_COLOR[tone];
/** The DS token a ring / row paints with. */
export const toneVar = (tone: PersonTone): string => `var(--object-${tone})`;
