// The Design system canvas a converted system really has (S10.12 writes it through `designSystemCanvasSource`).
//
// `_ds-engine-fixture.ts`'s `makeProject()` is a STUDIO unit-test fixture: its `design-system.tsx` is a stub
// (`<section><h1>Design system</h1><button className="btn">Go</button></section>`) with no board, no `ds-bar`, no
// swatches. The desktop scenarios drive the real board, so every seed that opens that canvas swaps the stub for the
// product's own source — and keeps whatever the engine already wrote into the meta (`dsPending`, …).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  designSystemCanvasMeta,
  designSystemCanvasSource,
} from '../../../studio/ds/board/template.ts';

export function installRealDsCanvas(root: string, ds: string, label = ds, path = `system/${ds}`) {
  const dir = join(root, '.design', path);
  writeFileSync(join(dir, 'design-system.tsx'), designSystemCanvasSource(ds, label));
  const metaFile = join(dir, 'design-system.meta.json');
  const kept = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  const meta = { ...kept, ...designSystemCanvasMeta(ds) };
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
}

/**
 * The project's `canvasGroups` entry for `system/` is the DESIGN SYSTEM group (`label: "Design system"`) — that label
 * is what makes the server list the systems as `dsFolders`, and the pinned system rows (and their ⋯ menu) are drawn
 * from those. The studio fixture's config leaves the group unlabelled, so the Canvases panel shows a plain `system`
 * folder and no pinned rows at all.
 */
export function labelDsGroup(root: string, path = 'system') {
  const file = join(root, '.design', 'config.json');
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  cfg.canvasGroups = (cfg.canvasGroups ?? []).map((g: { path: string; label?: string }) =>
    g.path === path ? { ...g, label: 'Design system' } : g
  );
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}
