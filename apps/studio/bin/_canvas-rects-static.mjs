#!/usr/bin/env node
// _canvas-rects-static.mjs — offline, artboard-only fallback for the geometry
// manifest (feature-whiteboard-ai-toolkit). Used by canvas-rects.sh when no
// live dev server is reachable to drive a real render.
//
// Mirrors DesignCanvasInner's `initialArtboards()` merge (canvas-lib.tsx):
// JSX `width`/`height` props are size-authoritative (DDR-027); `.meta.json`
// `layout.artboards[]` only overrides x/y (a legacy entry that still carries
// w/h wins over the JSX default too — the same back-compat tolerance the
// client keeps for pre-4.2 files). Artboards are seeded in JSX render order
// (`harvestArtboards`), then laid out via the identical 3-col default-grid
// algorithm (`synthDefaultGrid`) when no stored position exists.
//
// No browser here, so there are NO element rects — `elements: []` with a
// stderr note. Regex-over-known-vocabulary (no AST parse), mirroring the
// discipline of read-annotations.mjs / sanitizeAnnotationSvg — this repo's
// house style for a headless reader of a small, fixed JSX vocabulary.
//
// Usage: _canvas-rects-static.mjs --rel <path-relative-to-designRoot> --root <repo>

import { existsSync, readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDesignRoot } from './read-annotations.mjs';

// Mirrors VP_GRID in canvas-lib.tsx — kept literal here so this shim stays a
// standalone Node script (no bundler, no TS import).
const VP_GRID = { cols: 3, w: 1280, h: 820, gutter: 80 };

function parseArgv(argv) {
  const out = { rel: null, root: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--rel') out.rel = argv[i + 1];
    else if (argv[i] === '--root') out.root = argv[i + 1];
  }
  return out;
}

function attr(tag, name) {
  const strMatch = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  if (strMatch) return strMatch[1];
  const exprMatch = tag.match(new RegExp(`\\b${name}\\s*=\\s*\\{\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\}`));
  return exprMatch ? exprMatch[1] : null;
}

/** Harvest `<DCArtboard id=".." width={N} height={N}>` in document order — the
 *  same render-order seeding `harvestArtboards()` does in canvas-lib.tsx. */
function harvestSeeds(source) {
  const seeds = [];
  const re = /<DCArtboard\b([^>]*)>/g;
  let auto = 0;
  let m = re.exec(source);
  while (m !== null) {
    const tag = m[1] ?? '';
    const id = attr(tag, 'id') || `__ab_${auto}`;
    const w = Number.parseFloat(attr(tag, 'width') ?? '') || VP_GRID.w;
    const h = Number.parseFloat(attr(tag, 'height') ?? '') || VP_GRID.h;
    seeds.push({ id, w, h });
    auto += 1;
    m = re.exec(source);
  }
  return seeds;
}

function synthDefaultGrid(seeds) {
  if (seeds.length === 0) return [];
  const cellW = seeds.reduce((mx, s) => Math.max(mx, s.w), 0) || VP_GRID.w;
  const cellH = seeds.reduce((mx, s) => Math.max(mx, s.h), 0) || VP_GRID.h;
  return seeds.map((seed, i) => {
    const col = i % VP_GRID.cols;
    const row = Math.floor(i / VP_GRID.cols);
    return {
      id: seed.id,
      x: col * (cellW + VP_GRID.gutter),
      y: row * (cellH + VP_GRID.gutter),
      w: seed.w,
      h: seed.h,
    };
  });
}

function loadMetaLayout(metaAbs) {
  if (!existsSync(metaAbs)) return [];
  try {
    const meta = JSON.parse(readFileSync(metaAbs, 'utf8'));
    const arr = meta?.layout?.artboards;
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function emptyManifest() {
  return { artboards: [], elements: [], elementsTruncated: false };
}

/**
 * The core merge — JSX seeds (render order + authoritative w/h) laid out by
 * the default grid, then x/y (or a legacy w/h) overridden per id from a
 * `.meta.json` `layout.artboards[]` array. Pure + exported so
 * `canvas-rects.test.ts` can assert it directly without touching disk.
 */
function resolveArtboards(source, layout) {
  const seeds = harvestSeeds(source);
  const defaults = synthDefaultGrid(seeds);
  const byId = new Map(
    (Array.isArray(layout) ? layout : [])
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => [r.id, r])
  );
  return defaults.map((d) => {
    const m = byId.get(d.id);
    if (!m) return d;
    return {
      id: d.id,
      x: Number.isFinite(m.x) ? m.x : d.x,
      y: Number.isFinite(m.y) ? m.y : d.y,
      w: typeof m.w === 'number' && m.w > 0 ? m.w : d.w,
      h: typeof m.h === 'number' && m.h > 0 ? m.h : d.h,
    };
  });
}

function main() {
  const args = parseArgv(process.argv.slice(2));
  if (!args.rel) {
    process.stderr.write('canvas-rects (static): missing --rel\n');
    process.exit(2);
  }
  const repoRoot = args.root ? args.root : process.cwd();
  const { designRoot } = resolveDesignRoot(repoRoot);
  // Security (feature-whiteboard-ai-toolkit review): --rel can carry an
  // origin-checked-but-untrusted value forwarded from `_active.json` (the
  // canvas can set its own `.active`, per inspect.ts's own containment note)
  // — reject anything that resolves outside designRoot, mirroring inspect.ts's
  // mtimeFor() containment check, before the file even reaches existsSync.
  const designRootAbs = resolve(designRoot);
  const canvasAbs = resolve(designRoot, args.rel);
  if (canvasAbs !== designRootAbs && !canvasAbs.startsWith(designRootAbs + sep)) {
    process.stderr.write(`canvas-rects (static): --rel escapes designRoot: ${args.rel}\n`);
    process.stdout.write(`${JSON.stringify(emptyManifest())}\n`);
    return;
  }
  if (!existsSync(canvasAbs)) {
    process.stderr.write(`canvas-rects (static): canvas not found: ${canvasAbs}\n`);
    process.stdout.write(`${JSON.stringify(emptyManifest())}\n`);
    return;
  }

  const source = readFileSync(canvasAbs, 'utf8');
  const metaAbs = canvasAbs.replace(/\.(tsx|html)$/i, '.meta.json');
  const artboards = resolveArtboards(source, loadMetaLayout(metaAbs));

  process.stderr.write(
    'canvas-rects (static): no live dev server — artboard positions/sizes only, elements: [] ' +
      '(run `maude design server-up` first for element context)\n'
  );
  process.stdout.write(
    `${JSON.stringify({ artboards, elements: [], elementsTruncated: false })}\n`
  );
}

export { harvestSeeds, loadMetaLayout, resolveArtboards, synthDefaultGrid };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
