// Internal shim behind layout-check.sh (`maude design layout-check`). See layout-check.sh for usage.
import path from 'node:path';
import { layoutLint } from '../layout/free-space.ts';
import { loadRects, parseCommon } from './_rects-input.mjs';

const a = parseCommon(process.argv.slice(2));
if (a.error) {
  process.stderr.write(
    `maude design layout-check: ${a.error}\nusage: maude design layout-check [<canvas>] [--rects <file>] [--json]\n`
  );
  process.exit(2);
}
const r = loadRects(a, path.dirname(new URL(import.meta.url).pathname));
if (r.error) {
  process.stderr.write(`maude design layout-check: ${r.error}\n`);
  process.exit(r.code);
}
const findings = layoutLint(r.manifest, r.canvas);
const errors = findings.filter((f) => f.severity === 'error').length;
if (a.json)
  process.stdout.write(
    `${JSON.stringify({ canvas: r.canvas, ok: errors === 0, findings, elementsChecked: r.manifest.elements?.length ?? 0 })}\n`
  );
else {
  for (const f of findings)
    process.stdout.write(`${f.severity} [${f.code}] ${f.where} · ${f.what} · ${f.fix}\n`);
  process.stdout.write(
    errors
      ? `✗ ${errors} layout error(s)\n`
      : `✓ no layout errors (${findings.length} warning(s))\n`
  );
  if (!r.manifest.elements?.length)
    process.stdout.write('  (artboards only — no studio was up, so elements were not measured)\n');
}
process.exit(errors ? 1 : 0);
