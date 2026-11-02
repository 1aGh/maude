// ds/default.ts — S10.13: the project's default design system (`config.json` `defaultDesignSystem`).
//
// "Default for new canvases" (13 · ds-multi-menu, registry `ds.set-default`). The default is the system a canvas
// made outside a folder that shares one follows (client/v2/ds/new-canvas-default.js) and the one a canvas with no
// `meta.designSystem` reads. It lives in the project's own config, so this is one small read-modify-write:
// every other key and the file's shape stay, the write is atomic (temp file + rename), and a name the project
// does not hold is refused before anything is written. The studio's config watcher re-reads the file.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Same shape as the engine's refusals (`code` + `status`), so the route answers it the same way. */
class DefaultError extends Error {
  constructor(
    readonly code: 'ds-unknown-system' | 'ds-config-unreadable',
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'DefaultError';
  }
}

export interface DefaultResult {
  changed: boolean;
  previous: string | null;
  default: string;
}

export function setDefaultSystem(designRoot: string, ds: string): DefaultResult {
  const file = path.join(designRoot, 'config.json');
  let text: string;
  let cfg: Record<string, unknown>;
  try {
    text = readFileSync(file, 'utf8');
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    cfg = v as Record<string, unknown>;
  } catch {
    throw new DefaultError('ds-config-unreadable', 'The project’s config could not be read.', 500);
  }
  const systems = Array.isArray(cfg.designSystems) ? (cfg.designSystems as unknown[]) : [];
  const names = systems.map((s) =>
    s && typeof s === 'object' ? (s as { name?: unknown }).name : null
  );
  if (!names.includes(ds))
    throw new DefaultError('ds-unknown-system', `no design system named ${ds.slice(0, 64)}`, 404);
  const previous = typeof cfg.defaultDesignSystem === 'string' ? cfg.defaultDesignSystem : null;
  if (previous === ds) return { changed: false, previous, default: ds };
  cfg.defaultDesignSystem = ds;
  // keep the file's own indentation and final newline
  const indent = /^\{\n( +|\t)"/.exec(text)?.[1] ?? '  ';
  const out = `${JSON.stringify(cfg, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, file);
  return { changed: true, previous, default: ds };
}
