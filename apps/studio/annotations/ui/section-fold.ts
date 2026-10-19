/**
 * @file       annotations/ui/section-fold.ts — a section's colours, Fold and its count line (S4.12)
 * @scope      apps/studio/annotations/ui/section-fold.ts
 * @purpose    Canvas 15 `an-section` ("A section is a named place"): wrap in a section, name it, colour it,
 *             and Fold it to one line that says what is inside — "6 stickies · 2 people". Folding hides the
 *             members from the DRAWING only: they stay in the file, move with the section and come back on
 *             Unfold. Pure and React-free.
 */

import type { SectionStroke, Stroke } from '../../annotations-model.ts';

/** The six section tones (canvas 15: grey · yellow · coral · green · sky · lilac), as section colours. */
export const SECTION_TONES = [
  { name: 'Grey', value: '#8b8b94' },
  { name: 'Yellow', value: '#d9a400' },
  { name: 'Coral', value: '#e8604c' },
  { name: 'Green', value: '#3f9e5c' },
  { name: 'Sky', value: '#3b82c4' },
  { name: 'Lilac', value: '#8a6fd1' },
] as const;

/** The tone name a section colour is, or null for a colour this palette doesn't carry. */
export function toneOf(color: string): string | null {
  return SECTION_TONES.find((t) => t.value.toLowerCase() === color.toLowerCase())?.name ?? null;
}

const isSection = (s: Stroke): s is SectionStroke => s.tool === 'section';

/** The strokes inside a section (nested containers included), by the layer's own containment. */
export function membersOf(
  strokes: readonly Stroke[],
  sectionId: string,
  contentsOf: (id: string) => readonly string[]
): Stroke[] {
  const inside = new Set(contentsOf(sectionId));
  return strokes.filter((s) => inside.has(s.id));
}

/** "6 stickies · 2 people": the count of what is inside, then how many people wrote it (two or more). */
export function foldSummary(members: readonly Stroke[], me?: string | null): string {
  const n = members.length;
  const onlyStickies = n > 0 && members.every((m) => m.tool === 'sticky');
  const noun = onlyStickies ? (n === 1 ? 'sticky' : 'stickies') : n === 1 ? 'item' : 'items';
  const people = new Set<string>();
  for (const m of members) {
    if (m.author === 'ai') people.add('ai');
    else if (m.authorName) people.add(m.authorName === me ? 'you' : m.authorName);
  }
  const count = `${n} ${noun}`;
  return people.size >= 2 ? `${count} · ${people.size} people` : count;
}

/** Fold or unfold one section. A section that is not there changes nothing. */
export function setFolded(strokes: readonly Stroke[], id: string, folded: boolean): Stroke[] {
  return strokes.map((s) => {
    if (!isSection(s) || s.id !== id) return s;
    if (folded) return s.folded ? s : { ...s, folded: true };
    if (!s.folded) return s;
    const { folded: _drop, ...rest } = s;
    return rest as Stroke;
  });
}

/** The ids drawn as nothing while their section is folded (every member, nested sections included). */
export function hiddenByFold(
  strokes: readonly Stroke[],
  contentsOf: (id: string) => readonly string[]
): Set<string> {
  const out = new Set<string>();
  for (const s of strokes) {
    if (isSection(s) && s.folded) for (const id of contentsOf(s.id)) out.add(id);
  }
  return out;
}

/** The strokes the layer draws: a folded section's members are left out of the DRAWING (not the file). */
export function withoutFolded(
  strokes: readonly Stroke[],
  contentsOf: (id: string) => readonly string[]
): readonly Stroke[] {
  if (!strokes.some((s) => isSection(s) && s.folded)) return strokes;
  const hidden = hiddenByFold(strokes, contentsOf);
  return hidden.size === 0 ? strokes : strokes.filter((s) => !hidden.has(s.id));
}

/** The menu / toolbar word for a selection of sections. */
export function foldVerb(
  strokes: readonly Stroke[],
  ids: readonly string[]
): 'fold' | 'unfold' | null {
  const want = new Set(ids);
  const secs = strokes.filter((s): s is SectionStroke => isSection(s) && want.has(s.id));
  if (secs.length === 0) return null;
  return secs.every((s) => s.folded) ? 'unfold' : 'fold';
}
