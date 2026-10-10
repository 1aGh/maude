// agent-evals/harness/common.mjs — shared by the prototype hook dispatcher and the stub verbs.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Nearest `<dir>/.design/config.json` above `start` → { repo, designRoot } or null. */
export function findDesignRoot(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.design', 'config.json')))
      return { repo: dir, designRoot: join(dir, '.design') };
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function inside(root, abs) {
  const r = relative(root, abs);
  return r !== '' && !r.startsWith('..') && !r.startsWith(sep) && !resolve(r).startsWith('..');
}

/** Runtime state per DDR-115: any path whose first segment starts with `_`. */
export function isRuntime(rel) {
  return rel.split('/')[0].startsWith('_');
}

export function runKey(sessionId) {
  return `r_${String(sessionId ?? 'nosession')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 12)}`;
}

export function runDir(designRoot, sessionId) {
  return join(designRoot, '_runs', runKey(sessionId));
}

export function readJson(p, dflt) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
}

export function writeJson(p, v) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
}

export function appendJsonl(p, v) {
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, `${JSON.stringify(v)}\n`);
}

export function encPath(rel) {
  return rel.replace(/[/\\]/g, '__');
}

export function slugOf(rel) {
  return rel
    .replace(/^\.\//, '')
    .replace(/\//g, '-')
    .replace(/ /g, '_')
    .toLowerCase()
    .replace(/\.(tsx|jsx|html?|css|json|md)$/, '');
}

/** The eval's stand-in for `GET /_api/ai/runs` (V2-1.15 §5.4): others' live runs + people's holds. */
export function liveState(designRoot) {
  const s = readJson(join(designRoot, '_state', 'eval-runs.json'), null);
  return s ?? { others: [], mine: [], holds: [] };
}
