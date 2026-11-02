// p8-hub-folder-boundary (decision maude/v2-michal-hub-is-the-folder-boundary-before-config,
// option A; final security pair 2026-10-31, defender I2 / attacker L2).
//
// Until the owner declares canvas folders (no usable `canvasGroups` in the hub checkout's
// `.design/config.json`), a hub is the folder boundary: its kernel takes any folder
// (`allowUndeclaredGroup: !groups`), so its OWN paired studio (cell pairing) must take every folder
// the kernel takes — not "one extra folder, once, per boot" (the fresh-link relaxation, which
// closed after the first learned group and was gone after a reboot). No config is written there
// (seedProjectConfig's cellPairing early return stays). A desktop copy keeps the one-shot
// fresh-link relaxation exactly as before, and declared groups rule everywhere.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Context } from '../context.ts';
import { validateCanvasPath } from '../sync/canvas-path.ts';
import { createUndeclaredGroupGate, hubFolderBoundary, scanCanvases } from '../sync/index.ts';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'p8-hub-boundary-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const CANVAS = 'export default function C() { return null; }\n';

function put(rel: string, body = CANVAS): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

function declare(groups: unknown): void {
  writeFileSync(join(root, 'config.json'), JSON.stringify({ canvasGroups: groups }));
}

/** Does this copy take a canvas at `rel` (rules 1-7 + the group rule) under `allow`? */
function takes(rel: string, allow: boolean): boolean {
  const slug = rel.replace(/\.tsx$/, '').replace(/\//g, '-');
  return validateCanvasPath({ path: rel, slug, designRel: '.design', allowUndeclaredGroup: allow })
    .ok;
}

function ctxFor(): Context {
  mkdirSync(join(root, '_comments'), { recursive: true });
  return {
    canvasOrigin: 'http://canvas.localhost:1234',
    cfg: {
      name: 'test',
      // the studio's defaults — what a design root with no config.json boots with
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'Canvases', path: 'ui' },
      ],
      linkedHub: { url: 'http://127.0.0.1:1', linkedAt: 1 },
    },
    paths: { designRoot: root, designRel: '.design', commentsDir: join(root, '_comments') },
  } as unknown as Context;
}

describe('hubFolderBoundary — the kernel rule, for a paired studio only', () => {
  test('paired: no usable canvasGroups ⇒ the hub is the boundary', () => {
    expect(hubFolderBoundary(root, { cellPairing: true })).toBe(true);
    declare([]);
    expect(hubFolderBoundary(root, { cellPairing: true })).toBe(true);
    declare([{ label: 'x' }]);
    expect(hubFolderBoundary(root, { cellPairing: true })).toBe(true);
    writeFileSync(join(root, 'config.json'), '{ not json');
    expect(hubFolderBoundary(root, { cellPairing: true })).toBe(true);
  });

  test('paired: declared groups rule', () => {
    declare([{ label: 'Screens', path: 'screens' }]);
    expect(hubFolderBoundary(root, { cellPairing: true })).toBe(false);
  });

  test('a desktop copy (no pairing) is never the boundary', () => {
    expect(hubFolderBoundary(root, { cellPairing: false })).toBe(false);
  });
});

describe("a hub's paired studio takes every folder its kernel takes", () => {
  const paired = () => () => hubFolderBoundary(root, { cellPairing: true });

  test('two different non-default folders in one boot', () => {
    const gate = createUndeclaredGroupGate(true, paired());
    expect(takes('screens/home.tsx', gate.accepts())).toBe(true);
    // the first learned group closes the fresh-link moment (noteLearnedGroup)…
    gate.closeFreshLink();
    expect(gate.freshLink).toBe(false);
    // …and the second folder is still taken, at boot and by a later pull
    expect(takes('flows/checkout.tsx', gate.accepts())).toBe(true);
    expect(takes('flows/checkout.tsx', gate.accepts({ strict: true }))).toBe(true);
    // nothing was written
    expect(() => readFileSync(join(root, 'config.json'))).toThrow();
  });

  test('across a reboot (no fresh link any more)', () => {
    put('screens/home.tsx');
    const gate = createUndeclaredGroupGate(false, paired());
    expect(takes('screens/home.tsx', gate.accepts())).toBe(true);
    expect(takes('components/card.tsx', gate.accepts({ strict: true }))).toBe(true);
  });

  test('once the owner declares groups, an undeclared folder is refused again', () => {
    const gate = createUndeclaredGroupGate(false, paired());
    declare([{ label: 'Screens', path: 'screens' }]);
    expect(gate.accepts()).toBe(false);
    expect(gate.accepts({ strict: true })).toBe(false);
    expect(takes('flows/checkout.tsx', gate.accepts())).toBe(false);
  });

  test('the boot scan walks every folder the kernel would take, once each', async () => {
    put('ui/card.tsx');
    put('screens/home.tsx');
    put('flows/a/checkout.tsx');
    put('lib.v2/x.tsx'); // a dotted folder is outside the kernel's group charset
    put('_draw/proof.tsx'); // runtime state
    put('node_modules/pkg/x.tsx');
    const ctx = ctxFor();
    const all = (await scanCanvases(ctx, { undeclaredFolders: true })).canvases.map((c) => c.slug);
    expect(all.sort()).toEqual(['flows-a-checkout', 'screens-home', 'ui-card']);
    // without the boundary the scan is the declared (default) groups, as before
    const declared = (await scanCanvases(ctx)).canvases.map((c) => c.slug);
    expect(declared).toEqual(['ui-card']);
  });
});

describe('a desktop copy keeps the one-shot fresh-link relaxation', () => {
  const desktop = () => () => hubFolderBoundary(root, { cellPairing: false });

  test('one group, once; nothing after a reboot', () => {
    const gate = createUndeclaredGroupGate(true, desktop());
    expect(takes('screens/home.tsx', gate.accepts())).toBe(true);
    expect(gate.accepts({ strict: true })).toBe(false);
    gate.closeFreshLink();
    expect(takes('flows/checkout.tsx', gate.accepts())).toBe(false);
    const reboot = createUndeclaredGroupGate(false, desktop());
    expect(reboot.accepts()).toBe(false);
  });
});

describe('the runtime wires the gate', () => {
  const src = readFileSync(join(import.meta.dir, '../sync/index.ts'), 'utf8');

  test('no site closes the relaxation by assignment, and every path decision asks the gate', () => {
    expect(src).not.toMatch(/pathOpts\.allowUndeclaredGroup\s*=/);
    expect(src).not.toMatch(/allowUndeclaredGroup:\s*false/);
    expect(src).not.toMatch(/allowUndeclaredGroup:\s*freshLink/);
    expect([...src.matchAll(/undeclaredGate\.accepts\(/g)].length).toBeGreaterThanOrEqual(3);
  });

  test('every runtime scan passes the hub boundary', () => {
    const body = src.slice(src.indexOf('export function createSyncRuntime('));
    const inRuntime = body.slice(0, body.indexOf('\nfunction maxPinnedRooms('));
    const scans = [...inRuntime.matchAll(/scanCanvases\(ctx([^;\n]*)/g)].map((m) => m[1]);
    expect(scans.length).toBeGreaterThanOrEqual(3);
    for (const args of scans) expect(args).toMatch(/^, scanOpts\(\)\)/);
  });
});
