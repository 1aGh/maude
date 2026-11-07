// #167 T5.3 item 6 (lead decision, option A — decision maude/burndown-t5-3-item6-option-a).
//
// An owner's desktop copy with canvases outside system/ui and no config listing them uploaded
// `screens/x.tsx` through the file plane as code, and the undeclared hub refused it (under its folder
// boundary it is a canvas). Now the owner's desktop never offers a `.tsx` that renders `DesignCanvas`
// (`isCanvasSource`) from outside its canvas folders while the project declares none: the file stays
// here, held with the reason "a canvas outside your canvas folders" and the Open canvas folders action.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane } from '../sync/file-plane.ts';
import { canvasOutsideFoldersDetail, filePlaneHeld } from '../sync/index.ts';

const HUB = 'https://hub.test';
const CANVAS = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function X() {
  return <DesignCanvas><DCArtboard id="a" width={100} height={100} /></DesignCanvas>;
}
`;
const CODE = 'export const helper = () => 1;\n';

let root: string;
let ledger: FileLedger;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'canvas-outside-'));
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), text);
}

/** A hub with an empty journal that takes every PUT; it records what it was offered. */
function hub() {
  const offered: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = (init?.method ?? 'GET').toUpperCase();
    if (u.pathname === '/api/journal') {
      return new Response(
        JSON.stringify({ epoch: 'e1', head: 0, entries: [], truncated: false, held: [] }),
        { status: 200 }
      );
    }
    if (method !== 'GET' && method !== 'HEAD') {
      offered.push(decodeURIComponent(u.pathname));
      return new Response(JSON.stringify({ ok: true, seq: 1 }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { offered, fetchImpl };
}

const pass = (fetchImpl: typeof fetch, owner = true) =>
  createFilePlane({
    designRoot: root,
    hubUrl: HUB,
    token: () => 'tok',
    ledger,
    allowCodeModules: true,
    canUploadCodeModules: owner,
    label: 'owner-mac',
    fetchImpl,
    log: { log() {}, warn() {} },
    now: () => 1_700_000_000_000,
  }).reconcile();

describe('a canvas outside the canvas folders, while the project declares none', () => {
  test('the owner’s desktop does not offer it, and reports it held', async () => {
    put('screens/x.tsx', CANVAS);
    put('lib/helper.tsx', CODE); // owner code outside the folders: still goes, as before
    const h = hub();
    const result = await pass(h.fetchImpl);
    expect(h.offered.some((p) => p.includes('screens/x.tsx'))).toBe(false);
    expect(h.offered.some((p) => p.includes('lib/helper.tsx'))).toBe(true);
    expect(result.canvasOutsideFolders).toEqual(['screens/x.tsx']);

    const row = filePlaneHeld(result).find((r) => r.kind === 'canvas-outside-folders');
    expect(row).toEqual({
      kind: 'canvas-outside-folders',
      count: 1,
      paths: ['screens/x.tsx'],
      detail: canvasOutsideFoldersDetail(1),
    });
    expect(row?.detail).toContain('a canvas outside your canvas folders');
    expect(row?.detail).toContain('Nothing was removed.');
    expect(row?.detail).not.toMatch(/\bwe\b|\bI\b|!/);
    expect(canvasOutsideFoldersDetail(2)).toContain('2 files');
  });

  test('once the project declares canvas folders, the rule is off (the hub boundary is gone)', async () => {
    writeFileSync(join(root, 'config.json'), JSON.stringify({ canvasGroups: [{ path: 'ui' }] }));
    put('screens/x.tsx', CANVAS);
    const h = hub();
    const result = await pass(h.fetchImpl);
    expect(result.canvasOutsideFolders ?? []).toEqual([]);
    expect(h.offered.some((p) => p.includes('screens/x.tsx'))).toBe(true);
  });

  test('a canvas inside the default folders is a canvas here, never offered as code', async () => {
    put('ui/y.tsx', CANVAS);
    const h = hub();
    const result = await pass(h.fetchImpl);
    expect(result.canvasOutsideFolders ?? []).toEqual([]);
    expect(h.offered.some((p) => p.includes('ui/y.tsx'))).toBe(false);
  });
});
