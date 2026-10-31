// Specimen page → Design system section, at conversion (S10.12; S10 Q5, decision
// `v2-S10-deterministic-conversion-map`). A deterministic prefix rule, never AI:
//
//   logo · iconography · textures                       → Brand
//   colors-* · selection · focus · opacity              → Colour
//   type-*                                              → Type
//   spacing · radii · borders · elevation · grid        → Space & shape
//   motion                                              → Motion
//   components-* · empty-state · skeletons              → Components
//   anything else                                       → no section (a showcase; Patterns draws it)
//
// A name matches a word when it IS the word or starts with `<word>-` (`spacing-scale`, `type-mono`).
// Measured on this repo's two systems: everything maps except `ui_kits-desktop-{index,showcase}`.
//
// AND every page stays on the canvas as itself (Michal, rc.1 finding 9, option A — decision
// `v2-michal-ds-specimens-own-artboards`, superseding the fold-only shape of S10 Q5): each page is its
// own `ds-own-<slug>` artboard, in one row under the section it belongs to (a page no section claims
// sits in the Patterns row). The generated sections stay; the pages are what the folder drew.
// `pages` is every page in canvas order (section order, then file name); `own` is the subset no
// section claims (the dialog's showcases, Patterns' tiles). PURE — no fs; the caller lists `preview/`.

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

/** Every page on the canvas: an own artboard plus the section whose row it sits in. */
export interface PageArtboard extends OwnArtboard {
  /** `patterns` for a page no section claims */
  section: SectionKind;
}

export interface SpecimenMap {
  sections: Record<SectionKind, string[]>;
  /** the pages no section claims (showcases, kits) — the dry run's `own[]`, unchanged in shape */
  own: OwnArtboard[];
  /** every specimen page as its own artboard, in canvas order — none is ever dropped. Not on the
   *  wire: `maude.ds-convert/1` stays frozen (its `specimens` already counts them). */
  pages: PageArtboard[];
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

/** Map the specimen files of one `preview/` folder (names only, any order): sections + every page. */
export function mapSpecimens(files: readonly string[]): SpecimenMap {
  const sections = Object.fromEntries(SECTION_ORDER.map((k) => [k, [] as string[]])) as Record<
    SectionKind,
    string[]
  >;
  const all: PageArtboard[] = [];
  const seen = new Set<string>();
  // ids are given in file-name order, so a page's id never depends on the section it lands in
  for (const f of [...new Set(files)].filter(isSpecimenFile).sort()) {
    const slug = f.replace(/\.tsx$/, '');
    const kind = sectionOf(slug);
    if (kind) sections[kind].push(slug);
    let id = ownArtboardId(slug);
    for (let n = 2; seen.has(id); n++) id = `${ownArtboardId(slug)}-${n}`;
    seen.add(id);
    all.push({ slug, id, label: ownLabel(slug), src: `preview/${f}`, section: kind ?? 'patterns' });
  }
  const pages = SECTION_ORDER.flatMap((k) => all.filter((p) => p.section === k));
  const own: OwnArtboard[] = all
    .filter((p) => sectionOf(p.slug) === null)
    .map(({ slug, id, label, src }) => ({ slug, id, label, src }));
  return { sections, own, pages };
}
