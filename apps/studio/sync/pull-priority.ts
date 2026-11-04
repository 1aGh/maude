// What the open canvas needs, so a first sync fetches it first — issue #204.
//
// A fresh link of a 5 000-file project used to deliver in size order: the forty pictures on the
// canvas a person is looking at waited behind thousands of thumbnails they are not. The plane already
// puts annotation-referenced assets first (DDR-223); this puts the ACTIVE canvas's closure ahead of
// that: its sidecars, the modules it imports (transitively, as far as they are on disk yet) and the
// assets those files name.
//
// CHEAP AND BEST-EFFORT ON PURPOSE. It only ORDERS work the plane already decided to do — it never
// admits a path, never names one the hub did not offer, and a wrong answer costs a slower first
// paint, never a wrong file. So a regex scan is enough: no transpiler, no build, a bounded walk.
// Everything it reads is this machine's own disk (`_active.json` is written by the studio itself).

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Files the walk reads at most — a canvas imports a handful, a design system a few dozen. */
const MAX_FILES_READ = 64;
/** Bytes read per file at most. */
const MAX_READ_BYTES = 512 * 1024;

const IMPORT_RES = [
  /\bimport\s*["']([^"'\n]+)["']/g,
  /\bfrom\s*["']([^"'\n]+)["']/g,
  /\b(?:import|require)\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  /@import\s+url\(\s*["']?([^"')\s]+)["']?\s*\)/g,
];
/** A path that ends in an extension, inside quotes or `url()` — asset references in JSX/CSS/JSON. */
const QUOTED_PATH_RE = /["'`(]((?:\.{1,2}\/|\/)?[A-Za-z0-9_\-./]+\.[A-Za-z0-9]{1,8})["'`)]/g;
const MODULE_EXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|css)$/i;
const RESOLVE_EXTS = ['.tsx', '.ts', '.jsx', '.js', '.css', '/index.tsx', '/index.ts'];
const SIDECARS = ['.meta.json', '.annotations.json', '.annotations.svg', '.css'];

function readCapped(abs: string): string | null {
  try {
    const buf = readFileSync(abs);
    return buf.subarray(0, MAX_READ_BYTES).toString('utf8');
  } catch {
    return null;
  }
}

/** A design-root-relative POSIX path, or null when it leaves the root. */
function inRoot(rel: string): string | null {
  const norm = path.posix.normalize(rel).replace(/^\/+/, '');
  if (norm === '' || norm === '.' || norm.startsWith('../') || norm === '..') return null;
  return norm;
}

/**
 * The active canvas's want-set, as design-root-relative paths. Empty when no canvas is open or
 * `_active.json` is missing/unreadable. Paths may not exist yet — that is the point: they are the
 * ones the hub should send first.
 */
export function activeCanvasWants(designRoot: string): Set<string> {
  const wants = new Set<string>();
  let active: unknown = null;
  try {
    const parsed = JSON.parse(readFileSync(path.join(designRoot, '_active.json'), 'utf8')) as {
      active?: unknown;
    };
    active = parsed?.active;
  } catch {
    return wants;
  }
  if (typeof active !== 'string' || active.length === 0 || active.length > 1024) return wants;
  // `_active.json` names the canvas by its design-root-relative path; a stray absolute or `.design/`
  // prefix is tolerated, anything that leaves the root is not.
  const start = inRoot(active.replace(/^\.design\//, ''));
  if (start === null) return wants;

  const queue: string[] = [start];
  const seen = new Set<string>();
  let read = 0;
  while (queue.length > 0 && read < MAX_FILES_READ) {
    const rel = queue.shift() as string;
    if (seen.has(rel)) continue;
    seen.add(rel);
    wants.add(rel);
    if (rel === start) {
      const stem = rel.replace(/\.(tsx|jsx|html)$/i, '');
      for (const s of SIDECARS) wants.add(`${stem}${s}`);
    }
    if (!MODULE_EXT_RE.test(rel)) continue;
    const text = readCapped(path.join(designRoot, rel));
    if (text === null) continue;
    read += 1;
    const dir = path.posix.dirname(rel);
    for (const re of IMPORT_RES) {
      re.lastIndex = 0;
      for (let m = re.exec(text); m !== null; m = re.exec(text)) {
        const spec = m[1] ?? '';
        if (!spec.startsWith('.')) continue;
        const base = inRoot(path.posix.join(dir, spec));
        if (base === null) continue;
        if (/\.[A-Za-z0-9]{1,8}$/.test(spec)) {
          wants.add(base);
          if (MODULE_EXT_RE.test(base)) queue.push(base);
          continue;
        }
        for (const ext of RESOLVE_EXTS) {
          const cand = `${base}${ext}`;
          wants.add(cand);
          queue.push(cand);
        }
      }
    }
    QUOTED_PATH_RE.lastIndex = 0;
    for (let m = QUOTED_PATH_RE.exec(text); m !== null; m = QUOTED_PATH_RE.exec(text)) {
      const ref = m[1] ?? '';
      // Relative to the file, and — the house convention for assets — relative to the root.
      const rel1 = ref.startsWith('.') ? inRoot(path.posix.join(dir, ref)) : null;
      const rel2 = inRoot(ref.replace(/^\.design\//, ''));
      if (rel1) wants.add(rel1);
      if (rel2) wants.add(rel2);
    }
  }
  return wants;
}
