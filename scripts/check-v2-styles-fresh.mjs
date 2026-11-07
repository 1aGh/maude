#!/usr/bin/env node
// apps/studio/dist/styles.css is a committed release artifact (what is committed is what ships), built
// from client/styles/_index.css by `build.ts --release` (Lightning CSS, minified). Nothing checked that
// the committed copy still matches its sources: a CSS edit without the release rebuild shipped the OLD
// stylesheet while every gate stayed green (#171). This rebuilds the stylesheet exactly as build.ts does
// and compares bytes.
//
//   node scripts/check-v2-styles-fresh.mjs [--studio <apps/studio dir>]
//
// Exit 0 fresh · 1 stale or missing · 2 usage. Part of the V2-8.1 quality chain (scripts/v2-gates.mjs).

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
// lightningcss is a dependency of apps/studio (its own install, DDR-009), whichever studio dir is checked.
const requireStudio = createRequire(join(REPO, 'apps/studio/package.json'));

// The targets and options mirror apps/studio/build.ts `buildCss()` — change both together.
const TARGETS = ['Chrome >= 110', 'Safari >= 16', 'Firefox >= 110', 'Edge >= 110'];

/** The release stylesheet `build.ts --release` would write for `studio`, as a Buffer. */
export function buildStyles(studio) {
  const { bundle, browserslistToTargets } = requireStudio('lightningcss');
  const { code } = bundle({
    filename: join(studio, 'client/styles/_index.css'),
    minify: true,
    sourceMap: false,
    targets: browserslistToTargets(TARGETS),
    drafts: { customMedia: true },
  });
  return Buffer.from(code);
}

/** null when `<studio>/dist/styles.css` matches its sources, otherwise why not. */
export function staleStyles(studio) {
  const dist = join(studio, 'dist/styles.css');
  if (!existsSync(dist)) return 'dist/styles.css is missing';
  if (!existsSync(join(studio, 'client/styles/_index.css')))
    return 'client/styles/_index.css is missing';
  const built = buildStyles(studio);
  const have = readFileSync(dist);
  if (built.equals(have)) return null;
  return `dist/styles.css (${have.length} B) is not what its sources build (${built.length} B)`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--studio');
  const studio = i >= 0 ? resolve(args[i + 1] ?? '') : join(REPO, 'apps/studio');
  if (i >= 0 && !args[i + 1]) {
    console.error('usage: check-v2-styles-fresh.mjs [--studio <apps/studio dir>]');
    process.exit(2);
  }
  const why = staleStyles(studio);
  if (why) {
    console.error(
      `STALE  ${why}\n  rebuild: cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release  (then commit dist/styles.css)`
    );
    process.exit(1);
  }
  console.log('fresh  dist/styles.css matches client/styles/_index.css');
}
