// Specimen page → Design system section, at conversion (S10.12; S10 Q5, decision
// `v2-S10-deterministic-conversion-map`). A deterministic prefix rule, never AI:
//
//   logo · iconography · textures                       → Brand
//   colors-* · selection · focus · opacity              → Colour
//   type-*                                              → Type
//   spacing · radii · borders · elevation · grid        → Space & shape
//   motion                                              → Motion
//   components-* · empty-state · skeletons              → Components
//   anything else                                       → its own `ds-own-<slug>` artboard
//
// A name matches a word when it IS the word or starts with `<word>-` (`spacing-scale`, `type-mono`).
// Patterns start empty. Measured on this repo's two systems: everything maps except
// `ui_kits-desktop-{index,showcase}`, which stay as their own artboards (29 "showcases stay as their
// own artboards"). PURE — no fs; the caller lists `preview/`.

import type { SectionKind } from './board/types.ts';

const RULES: ReadonlyArray<readonly [SectionKind, readonly string[]]> = [
  ['brand', ['logo', 'iconography', 'textures']],
  ['colour', ['colors', 'selection', 'focus', 'opacity']],
  ['type', ['type']],
  ['space', ['spacing', 'radii', 'borders', 'elevation', 'grid']],
  ['motion', ['motion']],
  ['components', ['components', 'empty-state', 'skeletons']],
];

export const SECTION_ORDER: readonly SectionKind[] = [
  'brand',
  'colour',
  'type',
  'space',
  'motion',
  'components',
  'patterns',
];

/** An own artboard: a specimen page kept as it is. */
export interface OwnArtboard {
  /** the specimen's file stem (`ui_kits-desktop-showcase`) */
  slug: string;
  /** `ds-own-<slug>`, lower-case letters, digits and dashes */
  id: string;
  /** "Desktop showcase" */
  label: string;
  /** `preview/<file>` as the canvas's `<Specimen src>` names it */
  src: string;
}

export interface SpecimenMap {
  sections: Record<SectionKind, string[]>;
  own: OwnArtboard[];
}

/** The section a specimen stem folds into, or null (its own artboard). */
export function sectionOf(slug: string): SectionKind | null {
  const s = slug.toLowerCase();
  for (const [kind, words] of RULES)
    if (words.some((w) => s === w || s.startsWith(`${w}-`))) return kind;
  return null;
}

/** `ui_kits-desktop-showcase` → `ds-own-ui-kits-desktop-showcase` */
export function ownArtboardId(slug: string): string {
  const body = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ds-own-${body || 'specimen'}`.slice(0, 96);
}

/** `ui_kits-desktop-showcase` → "Desktop showcase" (the kit prefix is the folder's, not the page's). */
export function ownLabel(slug: string): string {
  const words = slug
    .replace(/^ui_kits?[-_]/i, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const w = words || slug;
  return (w.charAt(0).toUpperCase() + w.slice(1)).slice(0, 64);
}

/** A specimen page: a `.tsx` under `preview/` that is not a helper (`_layout`, `_components`…). */
export const isSpecimenFile = (name: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*\.tsx$/.test(name) && !name.startsWith('_');

/** Fold the specimen files of one `preview/` folder (names only, any order) into sections. */
export function mapSpecimens(files: readonly string[]): SpecimenMap {
  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, [] as string[]])) as Record<
    SectionKind,
    string[]
  >;
  const own: OwnArtboard[] = [];
  const seen = new Set<string>();
  for (const f of [...files].filter(isSpecimenFile).sort()) {
    const slug = f.replace(/\.tsx$/, '');
    const kind = sectionOf(slug);
    if (kind) {
      sections[kind].push(slug);
      continue;
    }
    let id = ownArtboardId(slug);
    for (let n = 2; seen.has(id); n++) id = `${ownArtboardId(slug)}-${n}`;
    seen.add(id);
    own.push({ slug, id, label: ownLabel(slug), src: `preview/${f}` });
  }
  return { sections, own };
}
