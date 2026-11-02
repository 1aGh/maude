// Settings › Advanced — S11.13 (contract S11 Q10, decision v2-S11-c34-unbuilt-rows-absent).
//
// Two small READ routes behind the "This Mac" and "Decision memory" rows of 06 ad-settings:
//
//   GET /_api/kg/summary       { active, decisions, engine }  — what the knowledge graph holds, as a
//                              NUMBER. Never a title, a rationale or a path: counts only, so a count
//                              is safe to hand to any main-origin tab. It shells out to nothing — it
//                              counts `assert` ops in the committed ndjson log (`.kgai/store/log`),
//                              which is the knowledge itself (CLAUDE.md "Store layout"). `active:false`
//                              is the row's "Not set up".
//   GET /_api/settings/about   { runtime, plugins }           — "Bun 1.3.4 · built in" and the bundled
//                              plugin versions ("design 2.0.0 · flow 2.0.0"), read from the bundle.
//
// MAIN ORIGIN ONLY: neither is canvas-safe (a canvas has no business asking what is in the graph or
// which runtime serves it). Both are reads; a read-only session is allowed them, and Settings ›
// Advanced is absent there anyway (settings-model.js).

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { DEV_SERVER_ROOT, pluginDirFrom } from '../paths.ts';
import type { RouteSpec } from './table.ts';

const json = (body: unknown) =>
  Response.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });

export interface SettingsRouteDeps {
  /** The served project's root (`ctx.paths.repoRoot`). */
  repoRoot: string;
  /** The studio's own root, for the bundled plugin manifests. Tests inject one. */
  devServerRoot?: string;
}

export interface KgSummary {
  active: boolean;
  /** Decisions in the graph, or `null` when it is not set up here. */
  decisions: number | null;
  engine: 'kgai';
}

const NOT_SET_UP: KgSummary = { active: false, decisions: null, engine: 'kgai' };

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The folders a kgai store may live in, most specific first: the config's, `.kgairc`'s, the default. */
function storeCandidates(root: string): string[] {
  const out: string[] = [];
  const add = (s: unknown) => {
    if (typeof s !== 'string' || s.length === 0) return;
    out.push(isAbsolute(s) ? s : resolve(root, s));
  };
  const kg = readJson(join(root, '.ai', 'workflows.config.json'))?.knowledgeGraph as
    | { store?: unknown }
    | undefined;
  add(kg?.store);
  add(readJson(join(root, '.kgairc'))?.store);
  add(join(root, '.kgai', 'store'));
  add(join(root, '.kgai'));
  return out;
}

/** `<store>/log` or `<store>/store/log`, whichever holds ndjson files. */
function logFiles(store: string): string[] {
  for (const dir of [join(store, 'log'), join(store, 'store', 'log')]) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.ndjson'));
      if (files.length > 0) return files.map((f) => join(dir, f));
    } catch {
      /* not a log folder */
    }
  }
  return [];
}

// A 7 MB log is re-counted only when it changed (size + mtime): Settings opens often.
const counted = new Map<string, { sig: string; n: number }>();
const ASSERT = '"op":"assert"';

function countAsserts(file: string): number {
  const st = statSync(file);
  const sig = `${st.size}:${st.mtimeMs}`;
  const hit = counted.get(file);
  if (hit && hit.sig === sig) return hit.n;
  let n = 0;
  // Chunked, with a seam overlap, so a big log is never held whole.
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let tail = '';
    for (;;) {
      const got = readSync(fd, buf, 0, buf.length, null);
      if (got <= 0) break;
      const text = tail + buf.toString('utf8', 0, got);
      let at = text.indexOf(ASSERT);
      while (at !== -1) {
        n++;
        at = text.indexOf(ASSERT, at + ASSERT.length);
      }
      tail = text.slice(-(ASSERT.length - 1));
    }
  } finally {
    closeSync(fd);
  }
  counted.set(file, { sig, n });
  return n;
}

/** What the graph holds for this project, as counts only. Never throws. */
export function kgSummary(repoRoot: string): KgSummary {
  try {
    const kg = readJson(join(repoRoot, '.ai', 'workflows.config.json'))?.knowledgeGraph as
      | { mode?: unknown }
      | undefined;
    if (kg?.mode === 'off') return NOT_SET_UP;
    for (const store of storeCandidates(repoRoot)) {
      if (!existsSync(store)) continue;
      const files = logFiles(store);
      if (files.length === 0) continue;
      let decisions = 0;
      for (const f of files) decisions += countAsserts(f);
      return { active: true, decisions, engine: 'kgai' };
    }
  } catch {
    /* an unreadable store is "not set up", never a 500 on a settings row */
  }
  return NOT_SET_UP;
}

export interface AboutThisMac {
  /** "Bun 1.3.4" — the runtime that serves this project (the row appends "· built in"). */
  runtime: string;
  /** The bundled plugins and their versions; empty in an npm layout that does not ship them. */
  plugins: Array<{ name: 'design' | 'flow'; version: string }>;
}

export function aboutThisMac(devServerRoot: string = DEV_SERVER_ROOT): AboutThisMac {
  const plugins: AboutThisMac['plugins'] = [];
  for (const name of ['design', 'flow'] as const) {
    const dir = pluginDirFrom(devServerRoot, name);
    const v = dir ? readJson(join(dir, '.claude-plugin', 'plugin.json'))?.version : undefined;
    if (typeof v === 'string' && v.length > 0 && v !== '0.0.0') plugins.push({ name, version: v });
  }
  const bun = (globalThis as { Bun?: { version?: string } }).Bun?.version;
  return { runtime: bun ? `Bun ${bun}` : 'Bun', plugins };
}

export function createSettingsRoutes(deps: SettingsRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/kg/summary',
      origin: 'main',
      readOnly: 'allowed',
      handle: () => json(kgSummary(deps.repoRoot)),
    },
    {
      method: 'GET',
      path: '/_api/settings/about',
      origin: 'main',
      readOnly: 'allowed',
      handle: () => json(aboutThisMac(deps.devServerRoot)),
    },
  ];
}
