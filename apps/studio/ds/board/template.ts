// The Design system canvas source (S10.6, V2-1.6 §5.2): `ds/design-system.tsx.tpl` with the
// system's name and label filled in. S10.12 (convert) and S10.16 (make) write it to
// `<ds.path>/design-system.tsx`; this is the one place that reads the template.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEV_SERVER_ROOT } from '../../paths.ts';
import { SECTIONS } from './types.ts';

/** A specimen page kept as its own artboard (S10.12 conversion, 29: showcases stay as they are). */
export interface OwnSpecimenArtboard {
  id: string;
  label: string;
  /** `preview/<file>.tsx`, relative to the system folder */
  src: string;
}

/** Own artboards sit in one row under Patterns, at a showcase's size (V2-1.6 §5.2's example). */
export const OWN_ARTBOARD = { w: 1440, h: 900, y: 1860, gap: 48 } as const;

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
export function designSystemCanvasMeta(
  ds: string,
  own: readonly OwnSpecimenArtboard[] = []
): Record<string, unknown> {
  return {
    designSystem: ds,
    layout: {
      artboards: [
        ...SECTIONS.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
        ...own.map((o, i) => ({
          id: o.id,
          x: i * (OWN_ARTBOARD.w + OWN_ARTBOARD.gap),
          y: OWN_ARTBOARD.y,
          w: OWN_ARTBOARD.w,
          h: OWN_ARTBOARD.h,
        })),
      ],
    },
  };
}

const OWN_ID = /^ds-own-[a-z0-9-]{1,96}$/;
const OWN_SRC = /^preview\/[A-Za-z0-9][A-Za-z0-9._-]*\.tsx$/;

/**
 * The canvas source. `own` (S10.12) adds one `<DCArtboard id="ds-own-…"><Specimen src="…" />` per kept
 * specimen page after the seven sections; ids and paths are checked here, labels go through `plain`.
 */
export function designSystemCanvasSource(
  ds: string,
  label: string = ds,
  own: readonly OwnSpecimenArtboard[] = []
): string {
  const tpl = readFileSync(DS_CANVAS_TEMPLATE, 'utf8');
  let out = tpl.replaceAll('{{ds}}', plain(ds)).replaceAll('{{label}}', plain(label) || plain(ds));
  if (!own.length) return out;
  for (const o of own)
    if (!OWN_ID.test(o.id) || !OWN_SRC.test(o.src))
      throw new Error(`not an own artboard: ${String(o.id).slice(0, 80)}`);
  const boards = own
    .map(
      (o) =>
        `      <DCArtboard id="${o.id}" label="${plain(o.label).replace(/"/g, ' ') || o.id}" width={${OWN_ARTBOARD.w}} height={${OWN_ARTBOARD.h}}>\n` +
        `        <Specimen src="${o.src}" />\n` +
        '      </DCArtboard>\n'
    )
    .join('');
  out = out.replace(
    'import { DSSection, DsBar } from "@maude/ds/board";',
    'import { DSSection, DsBar, Specimen } from "@maude/ds/board";'
  );
  const end = out.lastIndexOf('    </DesignCanvas>');
  if (end < 0 || !out.includes('Specimen } from')) throw new Error('the canvas template changed');
  return out.slice(0, end) + boards + out.slice(end);
}
