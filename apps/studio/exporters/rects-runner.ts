// exporters/rects-runner.ts — S8.7: the canvas geometry the safe-margin check measures.
//
// `maude design canvas-rects <rel>` (bin/canvas-rects.sh) renders a canvas headlessly and prints the
// WORLD-coordinate manifest `window.__maudeCanvasRects()` builds — every artboard and every meaningful
// element. The Print preflight asks for the same thing, so what the sheet warns about is what the person
// sees on the canvas. This wraps that script for the server:
//
//   - one render at a time (the browser session behind the script is single);
//   - a short memory per file version (path + mtime + size), so ticking a box or reopening the sheet does
//     not render again;
//   - any failure — no browser, a timeout, a page that is not a canvas, output that is not a manifest — is
//     `null`: "unmeasured". The sheet then shows the paper with no safe-margin line; it never shows an error
//     for a check that only ever informs.
// The script's static fallback (no live server) returns artboards and NO elements; that is also "unmeasured".
// The injected `spawn` is what a test replaces; production uses Bun.spawn with a hard kill.

import { statSync } from 'node:fs';
import path from 'node:path';

import type { RectsManifest } from './print-preflight.ts';

export interface SpawnResult {
  code: number;
  stdout: string;
}

export interface RectsRunnerOptions {
  repoRoot: string;
  designRoot: string;
  /** absolute path of bin/canvas-rects.sh */
  script: string;
  spawn?: (cmd: string[], timeoutMs: number) => Promise<SpawnResult>;
  timeoutMs?: number;
}

const MEMORY = 8;
const MAX_ELEMENTS = 1000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The manifest, or null when the text is not one. Numbers only for geometry; text is cut short. */
export function parseRects(stdout: string): RectsManifest | null {
  const line = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  const m = raw as { artboards?: unknown; elements?: unknown };
  if (!m || !Array.isArray(m.artboards) || !Array.isArray(m.elements)) return null;
  const artboards: RectsManifest['artboards'] = [];
  for (const a of m.artboards as Array<Record<string, unknown>>) {
    if (typeof a?.id === 'string' && finite(a.x) && finite(a.y) && finite(a.w) && finite(a.h))
      artboards.push({ id: a.id, x: a.x, y: a.y, w: a.w, h: a.h });
  }
  const elements: RectsManifest['elements'] = [];
  for (const e of (m.elements as Array<Record<string, unknown>>).slice(0, MAX_ELEMENTS)) {
    if (!finite(e?.x) || !finite(e.y) || !finite(e.w) || !finite(e.h)) continue;
    elements.push({
      cdId: typeof e.cdId === 'string' ? e.cdId : null,
      artboard: typeof e.artboard === 'string' ? e.artboard : null,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      tag: typeof e.tag === 'string' ? e.tag.slice(0, 24) : undefined,
      text: typeof e.text === 'string' ? e.text.slice(0, 80) : undefined,
    });
  }
  return { artboards, elements };
}

async function bunSpawn(cmd: string[], timeoutMs: number): Promise<SpawnResult> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const stdout = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return { code, stdout };
  } finally {
    clearTimeout(timer);
  }
}

export function createRectsRunner(
  o: RectsRunnerOptions
): (canvasRel: string) => Promise<RectsManifest | null> {
  const run = o.spawn ?? bunSpawn;
  const timeoutMs = o.timeoutMs ?? 25_000;
  const memory = new Map<string, RectsManifest | null>();
  let chain: Promise<unknown> = Promise.resolve();
  return (rel) => {
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..') || !/\.tsx$/i.test(rel))
      return Promise.resolve(null);
    let key: string;
    try {
      const st = statSync(path.join(o.designRoot, rel));
      key = `${rel}\u0000${st.mtimeMs}\u0000${st.size}`;
    } catch {
      return Promise.resolve(null);
    }
    if (memory.has(key)) return Promise.resolve(memory.get(key) ?? null);
    const next = chain.then(async () => {
      if (memory.has(key)) return memory.get(key) ?? null;
      let manifest: RectsManifest | null = null;
      try {
        const res = await run(['bash', o.script, rel, '--root', o.repoRoot], timeoutMs);
        manifest = res.code === 0 ? parseRects(res.stdout) : null;
      } catch {
        manifest = null;
      }
      // a render with no elements is the script's static fallback: unmeasured, and worth asking again
      if (manifest && manifest.elements.length === 0) manifest = null;
      if (manifest) {
        memory.set(key, manifest);
        if (memory.size > MEMORY) memory.delete(memory.keys().next().value as string);
      }
      return manifest;
    });
    chain = next.catch(() => null);
    return next;
  };
}
