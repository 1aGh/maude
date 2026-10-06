/**
 * @file       annotations/migrate-cli.ts — run the v1 → v2 board migration by hand
 * @scope      apps/studio/annotations/migrate-cli.ts
 * @purpose    `bun apps/studio/annotations/migrate-cli.ts <designRoot> [--in-place]`
 *
 *             Default: the boot migration (`migrateAnnotationsV2`) — originals
 *             kept under `_history/` + `_trash/`. `--in-place` converts each
 *             `*.annotations.svg` to its `.json` sibling and removes the SVG,
 *             with NO runtime dirs — for committed fixtures, where git holds
 *             the original.
 */

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { migrateAnnotationsV2 } from './migrate-boot.ts';
import { migrateSvg } from './migrate-v1.ts';
import { serializeBoard } from './schema.ts';

const [root, flag] = process.argv.slice(2);
if (!root) {
  console.error('usage: migrate-cli.ts <designRoot> [--in-place]');
  process.exit(2);
}
if (flag === '--in-place') {
  for (const name of readdirSync(root).filter((n) => n.endsWith('.annotations.svg'))) {
    const abs = path.join(root, name);
    const { elements, report } = migrateSvg(readFileSync(abs, 'utf8'));
    writeFileSync(abs.replace(/\.svg$/, '.json'), serializeBoard(elements));
    rmSync(abs);
    console.log(
      `${name} → ${elements.length} elements${report.length ? ` (${report.length} not carried over)` : ''}`
    );
  }
} else {
  const r = migrateAnnotationsV2({ designRoot: root });
  console.log(`${r.length} board file(s) processed`);
}
