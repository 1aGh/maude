// ds/component-list.ts — what ⇧I offers (S2.16; contract S2-slices.md Q13).
//
// `GET /_api/ds/components` answers this. Brand = Logo + Icon (`@maude/ds`'s brand pieces, V2-1.13
// §5.11); Components = the system's `components.json` (its core components, labelled in its own words,
// with the variants it really has), or the 14 defaults when the system ships no manifest; Patterns =
// empty until S10 serves them (the picker hides an empty group — Q13). Only components the writer can
// place (`RECIPES`, edit-ops/insert-component.ts) are listed, so a row never refuses on click.
//
// Labels are designer data, never instructions to any agent (DDR-172 D8): length-capped, one line.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RECIPES } from '../edit-ops/insert-component.ts';
import { canvasSystemFor } from './ds-resolver.ts';
import { readHead } from './head.ts';
import { type SystemConfig, systemConfigsFrom } from './system.ts';

export interface PickerVariant {
  key: string;
  label: string;
}
export interface PickerItem {
  /** the `@maude/ds` export name — what `component.insert` takes */
  name: string;
  /** the designer-facing name (components.json `label`, Czech allowed) */
  label: string;
  variants: PickerVariant[];
  /** Icon only: the glyph a click places */
  glyph?: string;
  /** Icon only: how many glyphs the system maps */
  glyphs?: number;
}
export interface PickerList {
  ok: true;
  system: { name: string; converted: boolean } | null;
  brand: PickerItem[];
  components: PickerItem[];
  /** S10 serves patterns; none before that */
  patterns: PickerItem[];
}

const BRAND = ['Logo', 'Icon'] as const;
const LABEL_MAX = 64;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const oneLine = (v: unknown, fallback: string): string => {
  if (typeof v !== 'string') return fallback;
  // a description a system writes after the name — "Tabs (this system switches views with …)" — is not the row's
  // name: 14 ed-comp-pick draws "Tabs" and nothing after it
  const t = v
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
  return t && t.length <= LABEL_MAX ? t : fallback;
};

/** `primary` → `Primary`, `x-spark` → `X spark` — a variant has no label of its own in the manifest. */
const variantLabel = (key: string): string => {
  const t = key.replace(/-/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function readJson(abs: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(abs, 'utf8'));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

/** The system a request means: the canvas's own, else the project's default. */
export function systemForPicker(designRoot: string, canvasAbs: string | null): SystemConfig | null {
  if (canvasAbs) return canvasSystemFor(designRoot, canvasAbs);
  const config = readJson(path.join(designRoot, 'config.json')) ?? {};
  const systems = systemConfigsFrom(config);
  const def = typeof config.defaultDesignSystem === 'string' ? config.defaultDesignSystem : null;
  return systems.find((s) => s.name === def) ?? systems[0] ?? null;
}

function variantsOf(name: string, manifest: Record<string, unknown> | null): PickerVariant[] {
  const defaults = RECIPES[name]?.variants ?? [];
  const declared = manifest && isObj(manifest.variants) ? manifest.variants : null;
  // The manifest is the system's own word: a variant it maps to `null` is a gap, not an offer.
  const keys = declared
    ? Object.entries(declared)
        .filter(([, cls]) => cls !== null)
        .map(([k]) => k)
    : [...defaults];
  return keys
    .filter((k) => /^[a-z][a-z0-9-]{0,31}$/.test(k))
    .slice(0, 12)
    .map((key) => ({ key, label: variantLabel(key) }));
}

export function listPickerComponents(designRoot: string, sys: SystemConfig | null): PickerList {
  const doc = sys ? readJson(path.join(designRoot, sys.path, 'components.json')) : null;
  const table = doc && isObj(doc.components) ? doc.components : null;
  const entry = (name: string): Record<string, unknown> | null => {
    const e = table?.[name];
    return isObj(e) ? e : null;
  };

  const components: PickerItem[] = [];
  // a manifest lists only what the system styles; without one, every default is offered
  const wanted = table ? Object.keys(table) : Object.keys(RECIPES);
  for (const name of wanted) {
    if (!Object.hasOwn(RECIPES, name) || (BRAND as readonly string[]).includes(name)) continue;
    const e = entry(name);
    components.push({
      name,
      label: oneLine(e?.label, name),
      variants: variantsOf(name, e),
    });
  }

  const brand: PickerItem[] = [
    { name: 'Logo', label: 'Logo', variants: variantsOf('Logo', entry('Logo')) },
  ];
  const map = doc && isObj(doc.icons) && isObj(doc.icons.map) ? doc.icons.map : null;
  const glyphs = map
    ? Object.entries(map)
        .filter(([, v]) => v !== null)
        .map(([k]) => k)
        .filter((k) => /^[a-z]+(?:-[a-z]+)*$/.test(k))
    : [];
  brand.push({
    name: 'Icon',
    label: 'Icon',
    variants: [],
    ...(glyphs.length ? { glyph: glyphs.includes('star') ? 'star' : (glyphs[0] as string) } : {}),
    ...(glyphs.length ? { glyphs: glyphs.length } : {}),
  });

  return {
    ok: true,
    system: sys
      ? {
          name: sys.name,
          converted: readHead(path.join(designRoot, sys.path)).state === 'ok',
        }
      : null,
    brand,
    components,
    patterns: [],
  };
}
