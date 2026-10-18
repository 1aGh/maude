// The Design system canvas source (S10.6, V2-1.6 §5.2): `ds/design-system.tsx.tpl` with the
// system's name and label filled in. S10.12 (convert) and S10.16 (make) write it to
// `<ds.path>/design-system.tsx`; this is the one place that reads the template.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEV_SERVER_ROOT } from '../../paths.ts';
import { SECTIONS } from './types.ts';

export const DS_CANVAS_TEMPLATE = path.join(DEV_SERVER_ROOT, 'ds', 'design-system.tsx.tpl');

/** Block comments and JSX text must not be broken out of by a hostile label. */
const plain = (s: string) =>
  Array.from(s, (ch) => (ch.charCodeAt(0) < 0x20 || '*/<>{}`$\\'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The canvas's `.meta.json` at creation: the system it renders under, and the sections placed as
 * 13 draws them (the default grid would spread seven artboards over 5 000 px). Both keys are
 * ones the meta already carries (`designSystem`, `layout.artboards`); nothing new is versioned.
 */
export function designSystemCanvasMeta(ds: string): Record<string, unknown> {
  return {
    designSystem: ds,
    layout: {
      artboards: SECTIONS.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
    },
  };
}

export function designSystemCanvasSource(ds: string, label: string = ds): string {
  const tpl = readFileSync(DS_CANVAS_TEMPLATE, 'utf8');
  return tpl.replaceAll('{{ds}}', plain(ds)).replaceAll('{{label}}', plain(label) || plain(ds));
}
