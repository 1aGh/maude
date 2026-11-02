// Shared set-up for the thumbnail tests (V2-2.17): a sandbox project, a real studio server, and an
// in-process index + thumbnail service pointed at it — the service is what renders, the server is
// what the shim navigates (and what redirects it onto the capture origin).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Subprocess } from 'bun';

import { extractCanvas, type IndexContext } from '../index/extract.ts';
import { createIndexService, type IndexService } from '../index/service.ts';
import { pidOf } from '../index/snapshot.ts';
import {
  createThumbService,
  type ThumbService,
  type ThumbServiceOptions,
} from '../thumbs/service.ts';
import { bootServer, makeSandbox, nextPort } from './_helpers.ts';

export interface ThumbRig {
  root: string;
  designRoot: string;
  port: number;
  main: string;
  capture: string | null;
  proc: Subprocess;
  index: IndexService;
  svc: ThumbService;
}

export function writeFiles(designRoot: string, files: Record<string, string>) {
  for (const [rel, src] of Object.entries(files)) {
    mkdirSync(dirname(join(designRoot, rel)), { recursive: true });
    writeFileSync(join(designRoot, rel), src);
  }
}

/** The capture origin the main origin redirects shells to (null when the split is off). */
export async function captureOriginOf(port: number): Promise<string | null> {
  const r = await fetch(`http://localhost:${port}/_canvas-shell.html?canvas=ui/x.tsx`, {
    redirect: 'manual',
  });
  if (r.status !== 307) return null;
  return new URL(r.headers.get('location') ?? '').origin;
}

export const contextFor = (root: string, designRoot: string): IndexContext => ({
  designRoot,
  repoRoot: root,
  groups: [
    { label: 'System', path: 'system' },
    { label: 'UI', path: 'ui' },
  ],
  defaultDs: null,
  designSystems: [],
});

/** what http.ts wires: the canvas's imports re-resolved now (the index row lags an import edit) */
export const freshDepsFor = (root: string, designRoot: string) => (rel: string) => {
  try {
    return extractCanvas(contextFor(root, designRoot), rel).depsHash;
  } catch {
    return null;
  }
};

export function indexFor(root: string, designRoot: string): IndexService {
  return createIndexService({
    root,
    designRel: '.design',
    context: () => contextFor(root, designRoot),
    project: () => ({
      name: 'test',
      label: null,
      formatVersion: 1,
      linkedHub: null,
      managed: false,
    }),
    persist: false,
  });
}

export async function rig(
  files: (main: string) => Record<string, string>,
  opts: {
    env?: Record<string, string>;
    service?: Partial<ThumbServiceOptions>;
  } = {}
): Promise<ThumbRig> {
  const { root, designRoot } = makeSandbox();
  const port = nextPort();
  const main = `http://localhost:${port}`;
  writeFiles(designRoot, files(main));
  // per-sandbox prefs: a planted canvas that DID reach the main origin must never write the
  // person's own ~/.config/maude/prefs.json (it did once, during a fail-first run)
  const proc = await bootServer(root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    MAUDE_UI_PREFS_PATH: join(root, 'prefs.json'),
    ...opts.env,
  });
  const capture = await captureOriginOf(port);
  const index = indexFor(root, designRoot);
  const svc = createThumbService({
    pid: pidOf(root),
    designRoot,
    index,
    config: () => ({ theme: 'dark' }),
    serverOrigin: () => main,
    captureOrigin: () => capture ?? undefined,
    freshDepsHash: freshDepsFor(root, designRoot),
    ...opts.service,
  });
  return { root, designRoot, port, main, capture, proc, index, svc };
}

/** thumb() until it settles (ready / unavailable), draining the queue in between. */
export async function settle(svc: ThumbService, req: Parameters<ThumbService['thumb']>[0]) {
  let r = await svc.thumb(req);
  for (let i = 0; i < 4 && r.status === 'pending'; i++) {
    await svc.idle();
    r = await svc.thumb(req);
  }
  return r;
}
