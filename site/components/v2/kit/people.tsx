// Ported once from .design/ui/v2/_kit.tsx on 2026-11-04; site/ is the source now.
import type { ReactNode } from 'react';

export type Tone = 'yellow' | 'green' | 'lilac' | 'coral' | 'sky' | 'grey';
type Person = { name: string; ini: string; tone: Tone };

export const PEOPLE: Record<string, Person> = {
  you: { name: 'You', ini: 'M', tone: 'yellow' },
  tereza: { name: 'Tereza', ini: 'T', tone: 'sky' },
  jonas: { name: 'Jonas', ini: 'J', tone: 'green' },
};

export type Who = string | Person;

export function person(w: Who): Person {
  if (typeof w !== 'string') return w;
  return PEOPLE[w.toLowerCase()] ?? { name: w, ini: w.slice(0, 1).toUpperCase(), tone: 'grey' };
}

/** A person's or an account's initial; people wear the canvas palette. */
export function Avatar({
  who,
  ini,
  tone,
  size = 'md',
}: {
  who?: Who;
  ini?: string;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
}) {
  const p = who ? person(who) : { name: ini ?? '', ini: ini ?? '', tone: tone ?? 'grey' };
  return (
    <span className={`k-av k-av--${tone ?? p.tone} k-av--${size}`} title={p.name}>
      {p.ini}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}
