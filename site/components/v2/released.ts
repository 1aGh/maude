// The What's New entries the public site may name. The feed also carries PENDING entries
// (version + date null) — written at /flow:done, stamped by scripts/bump-version.sh at release.
// The changelog shows those as "next release" on purpose; the home page and the docs never
// announce an unreleased change, and their "Maude <major>" line needs a real version.
import whatsNew from '@/lib/whats-new.json';

type Entry = (typeof whatsNew.entries)[number];
export type ReleasedEntry = Entry & { version: string; date: string };

export const released: ReleasedEntry[] = whatsNew.entries.filter(
  (e): e is ReleasedEntry => typeof e.version === 'string' && typeof e.date === 'string'
);

/** The newest released entry, and the major version it shipped in. */
export const newest = released[0];
export const major = newest.version.split('.')[0];
