// ds/instance-info.ts — S2.17: what the inspector's Instance blocks show (ed-comp-instance).
//
// `GET /_api/edit-instance?file=&id=` answers this: whether the selected object is an instance of a
// design-system component, which one (by the system's own label — "Tlačítko"), its variant and the
// variants the system really has, the components it can be swapped for, and what it overrides. All of it
// is read from the TSX and the canvas's own system on the SERVER; the inspector draws it and the ops
// (edit-ops/swap-variant.ts, reset-overrides.ts) re-check everything they are given against the same reading.
//
// Labels are designer data, never instructions to any agent (DDR-172 D8): component-list.ts caps them.

import { RECIPES } from '../edit-ops/insert-component.ts';
import { overridesOf, readInstance, swappableWith } from '../edit-ops/instance-model.ts';
import { listPickerComponents, type PickerItem } from './component-list.ts';
import type { SystemConfig } from './system.ts';

export interface InstanceInfo {
  /** the `@maude/ds` export name */
  component: string;
  /** the system's word for it ("Tlačítko") */
  label: string;
  /** a `<div data-cd-id>` carries the id around a component that cannot forward it */
  wrapper: boolean;
  /** `primary`; null = the master's own look; 'code' = the file sets it in an expression */
  variant: string | null;
  variants: Array<{ key: string; label: string }>;
  /** the components it can become, itself first, by the system's labels */
  swappable: Array<{ name: string; label: string }>;
  /** the master holds words (Button, Chip …) — the Text row is drawn */
  holdsText: boolean;
  text: string | null;
  /** the words the master gives */
  defaultText: string;
  /** the words are code; they are not ours to edit */
  textInCode: boolean;
  overrides: { text: boolean; fill: boolean; props: string[]; count: number };
  /** it sits in a `.map()`: the ops refuse it; the inspector says so instead of offering them */
  repeats: boolean;
}

export type InstanceAnswer = { ok: true; instance: InstanceInfo | null };

/** The system's items by export name (brand + components). */
export function pickerItems(designRoot: string, sys: SystemConfig | null): Map<string, PickerItem> {
  const list = listPickerComponents(designRoot, sys);
  const by = new Map<string, PickerItem>();
  for (const it of [...list.brand, ...list.components]) by.set(it.name, it);
  return by;
}

export function instanceInfoFor(
  source: string,
  file: string,
  id: string,
  designRoot: string,
  sys: SystemConfig | null
): InstanceAnswer {
  const f = readInstance(source, file, id);
  if (!f) return { ok: true, instance: null };
  const items = pickerItems(designRoot, sys);
  const labelOf = (n: string) => items.get(n)?.label ?? n;
  const o = overridesOf(f);
  // only the components this system styles can be swapped in (a manifest lists what it styles)
  const offered = swappableWith(
    f.component,
    [...items.keys()].filter((n) => Object.hasOwn(RECIPES, n))
  );
  const swappable = (offered.includes(f.component) ? offered : [f.component, ...offered]).map(
    (name) => ({ name, label: labelOf(name) })
  );
  return {
    ok: true,
    instance: {
      component: f.component,
      label: labelOf(f.component),
      wrapper: f.wrapper,
      variant: f.variant,
      variants: items.get(f.component)?.variants ?? [],
      swappable,
      holdsText: f.recipe.children === 'text',
      text: f.text,
      defaultText: f.defaultText,
      textInCode: f.textInCode,
      overrides: o,
      repeats: f.repeats,
    },
  };
}
