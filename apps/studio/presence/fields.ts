/**
 * @file       presence/fields.ts — S9.23 (S9-slices Q9): the presence awareness fields, checked by value.
 * @purpose    `artboard`, `idleSince`, `surface`, `inComments`, `summon`, `followTarget` — additive on the
 *             awareness state, so a v1 peer renders only the fields it knows (the mixed-peer test).
 *             Foreign awareness is untrusted (DDR-054): each field is rebuilt from known shapes only and a
 *             bad one becomes its quiet default, never a partial value a UI would act on.
 *
 * Awareness never carries an e-mail address: names and a colour only (Q9). `presenceName` keeps that true
 * when the local user's only name is an address.
 */

/** Idle is 3 minutes without pointer or key input (Q9): the cursor greys and shrinks to an initial. */
export const IDLE_MS = 3 * 60_000;

export type Surface = 'app' | 'browser';

/** Bring everyone here: who asked (`id`, a fresh token per ask) and when (`at`, epoch ms). */
export interface Summon {
  id: string;
  at: number;
}

const ARTBOARD_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SUMMON_ID_RE = /^[a-z0-9]{8,32}$/;
const MAX_TIME = 2 ** 53 - 1;

export function sanitizeArtboard(v: unknown): string | null {
  return typeof v === 'string' && ARTBOARD_RE.test(v) ? v : null;
}

/** The epoch-ms of the person's last input, published only once idle; anything else is "active". */
export function sanitizeIdleSince(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= MAX_TIME ? v : null;
}

export function sanitizeSurface(v: unknown): Surface {
  return v === 'browser' ? 'browser' : 'app';
}

export function sanitizeInComments(v: unknown): boolean {
  return v === true;
}

export function sanitizeSummon(v: unknown): Summon | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 2 || !keys.includes('id') || !keys.includes('at')) return null;
  const { id, at } = o;
  if (typeof id !== 'string' || !SUMMON_ID_RE.test(id)) return null;
  if (typeof at !== 'number' || !Number.isSafeInteger(at) || at <= 0 || at > MAX_TIME) return null;
  return { id, at };
}

/** The clientID a peer's camera follows (Follow / a Bring), or null. */
export function sanitizeFollowTarget(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** A fresh token for one Bring (≥ 8 chars of [a-z0-9]). */
export function newSummonId(rand: () => number = Math.random): string {
  let s = '';
  while (s.length < 12) s += Math.floor(rand() * 36).toString(36);
  return s;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/** A name for awareness: never an e-mail address. An address becomes its local part (names + colour only). */
export function presenceName(name: string): string {
  const n = String(name ?? '').trim();
  if (!EMAIL_RE.test(n)) return n;
  const local = n
    .slice(0, n.indexOf('@'))
    .replace(/[._+-]+/g, ' ')
    .trim();
  return local || 'Someone';
}

/** Where this canvas is open: the shell appends `surf=browser` to a canvas URL outside the Mac app. */
export function surfaceFromSearch(search: string): Surface {
  try {
    return sanitizeSurface(new URLSearchParams(search).get('surf'));
  } catch {
    return 'app';
  }
}
