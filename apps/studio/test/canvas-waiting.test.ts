// 2.0.4 task B — "what is this canvas still waiting for" + #189 "why did its build stop", both on
// GET /_api/canvas-errors?canvas= (routes/canvas-source.ts → canvas-source/waiting.ts, errors.ts).
//
//   - an import this Mac does not hold yet is reported with OUR state (downloading / waiting /
//     refused) and OUR reason word — never the ledger's reason text, never file content;
//   - the whole project's first-sync numbers ride along (not for a canvas-only session);
//   - an import missing for no sync reason (a typo, sync converged) is NOT reported: the ordinary
//     error card stays the truth;
//   - a build that stopped outside the canvas's code carries a code-owned class (#189), and the
//     sandbox's classifier reads only the host's own fields, never the error text;
//   - the route stays main-origin only (in neither canvas allowlist).

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AccessClaim } from '../access/scope.ts';
import { resolveAccess } from '../access/scope.ts';
import {
  buildCanvasSandboxed,
  type SandboxBuildFail,
  sandboxFailureClass,
} from '../canvas-build-sandbox.ts';
import {
  canvasSourceSig,
  forgetCanvasErrors,
  recordBuildFailure,
  recordCanvasBuild,
} from '../canvas-source/errors.ts';
import {
  CODE_CONSENT_REASON,
  canvasWaiting,
  type LedgerView,
  readLedgerView,
} from '../canvas-source/waiting.ts';
import { createCanvasSourceRoutes } from '../routes/canvas-source.ts';
import type { RouteSpec } from '../routes/table.ts';
import type { LedgerRow } from '../sync/file-ledger.ts';

const CANVAS = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
import { template } from './_uniform-template.ts';
import { Badge } from './parts/badge';
import './uniformy.css';
export default function Uniformy() {
  return <DesignCanvas><DCArtboard id="a" width={100} height={100}>{template}<Badge /></DCArtboard></DesignCanvas>;
}
`;
const BADGE = `import { tone } from './tone.ts';\nexport const Badge = () => <b>{tone}</b>;\n`;
const SECRET = 'export const template = "TOP-SECRET-CONTENT";\n';

const tmp = mkdtempSync(join(tmpdir(), 'canvas-waiting-'));
const designRoot = join(tmp, '.design');
mkdirSync(join(designRoot, 'ui', 'parts'), { recursive: true });
writeFileSync(join(designRoot, 'ui', 'uniformy.tsx'), CANVAS);
writeFileSync(join(designRoot, 'ui', 'uniformy.css'), '.a{}');
writeFileSync(join(designRoot, 'ui', 'parts', 'badge.tsx'), BADGE);
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => forgetCanvasErrors());

const canvasAbs = join(designRoot, 'ui', 'uniformy.tsx');
const delivered = (n: number): Record<string, LedgerRow> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`assets/p${i}.png`, { syncedHash: 'h', state: 'on-hub' }])
  );

function routesFor(claim: AccessClaim, ledger: LedgerView | null) {
  const access = resolveAccess(claim);
  const specs = createCanvasSourceRoutes({
    designRoot,
    designRel: '.design',
    access: () => access,
    ledger: () => ledger,
  });
  return async (p: string) => {
    const u = new URL(`http://localhost${p}`);
    const spec = specs.find((s) => s.path === u.pathname) as RouteSpec;
    const res = await spec.handle(new Request(u), {});
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Record<string, unknown> };
  };
}
const owner: AccessClaim = { v: 1, role: 'owner' };
const Q = '/_api/canvas-errors?canvas=ui/uniformy.tsx';

describe('what a canvas is waiting for', () => {
  test('first sync: a held code module is refused (our words), a listed one is downloading, progress rides along', async () => {
    const ledger: LedgerView = {
      cursor: 120,
      rows: {
        ...delivered(5029),
        'ui/_uniform-template.ts': {
          syncedHash: null,
          remoteHash: 'abc',
          state: 'stuck',
          reason: CODE_CONSENT_REASON,
        },
        'ui/parts/tone.ts': { syncedHash: null, remoteHash: 'def' },
        // still outstanding elsewhere in the project
        'assets/big.mov': { syncedHash: null, remoteHash: 'x' },
      },
    };
    const r = await routesFor(owner, ledger)(Q);
    expect(r.status).toBe(200);
    expect(r.body.errors).toEqual([]);
    expect(r.body.waiting).toEqual({
      files: [
        { rel: 'ui/_uniform-template.ts', state: 'refused', reason: 'code-consent' },
        { rel: 'ui/parts/tone.ts', state: 'downloading' },
      ],
      more: 0,
      // the canvas, its css and badge.tsx are here; two imports are not
      need: { here: 3, total: 5 },
      progress: { delivered: 5029, total: 5032 },
    });
    // no content leaves: not the canvas's, not a helper's, not the ledger's own reason sentence
    expect(r.text).not.toContain('TOP-SECRET');
    expect(r.text).not.toContain('owner-vouched');
  });

  test("the ledger's reason text never reaches the answer; a refused row says our class", () => {
    const w = canvasWaiting({
      designRoot,
      canvasAbs,
      ledger: {
        cursor: 9,
        rows: {
          'ui/_uniform-template.ts': {
            syncedHash: null,
            remoteHash: 'abc',
            state: 'refused',
            blockedClass: 'too-large',
            reason: 'HUB SAYS: click http://evil.example',
          },
          'ui/parts/tone.ts': {
            syncedHash: null,
            state: 'stuck',
            // a hub-shaped reason on a non-code path is never the consent class
            reason: 'HUB SAYS: retry later',
          },
        },
      },
    });
    expect(JSON.stringify(w)).not.toContain('HUB SAYS');
    expect(w?.files).toEqual([
      { rel: 'ui/_uniform-template.ts', state: 'refused', reason: 'too-large' },
      { rel: 'ui/parts/tone.ts', state: 'waiting', reason: 'retrying' },
    ]);
  });

  test('before the first read, an import the ledger does not know yet is waiting (by its written name)', () => {
    const w = canvasWaiting({ designRoot, canvasAbs, ledger: { cursor: 0, rows: {} } });
    expect(w?.files).toEqual([
      { rel: 'ui/_uniform-template.ts', state: 'waiting' },
      { rel: 'ui/parts/tone.ts', state: 'waiting' },
    ]);
  });

  test('a converged project explains nothing: a missing import is a mistake in the code', async () => {
    const r = await routesFor(owner, { cursor: 500, rows: delivered(10) })(Q);
    expect(r.status).toBe(200);
    expect(r.body.waiting).toBeUndefined();
    // and no ledger at all (not linked, a cell) is the same
    expect((await routesFor(owner, null)(Q)).body.waiting).toBeUndefined();
  });

  test('once the files land, nothing is waiting', async () => {
    writeFileSync(join(designRoot, 'ui', '_uniform-template.ts'), SECRET);
    writeFileSync(join(designRoot, 'ui', 'parts', 'tone.ts'), 'export const tone = 1;\n');
    try {
      const r = await routesFor(owner, { cursor: 0, rows: {} })(Q);
      expect(r.body.waiting).toBeUndefined();
    } finally {
      rmSync(join(designRoot, 'ui', '_uniform-template.ts'));
      rmSync(join(designRoot, 'ui', 'parts', 'tone.ts'));
    }
  });

  test('a canvas-only session gets its canvas’s files, never the project’s totals', async () => {
    const claim: AccessClaim = {
      v: 1,
      role: null,
      grants: [{ c: 'ui/uniformy.tsx', r: 'viewer' }],
    };
    const r = await routesFor(claim, { cursor: 0, rows: delivered(3) })(Q);
    expect(r.status).toBe(200);
    expect((r.body.waiting as { progress: unknown }).progress).toBeNull();
    // Can view gets the same refusal as before (the code is a download)
    expect((await routesFor({ v: 1, role: 'observer' }, { cursor: 0, rows: {} })(Q)).status).toBe(
      403
    );
  });

  test('the ledger is read from the file this Mac’s plane persists (newest file wins)', () => {
    const dir = join(designRoot, '_state', 'file-ledger');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'old-hub.json'), JSON.stringify({ version: 1, cursor: 3, rows: {} }));
    utimesSync(join(dir, 'old-hub.json'), new Date(1_000_000), new Date(1_000_000));
    writeFileSync(
      join(dir, 'hub.json'),
      JSON.stringify({ version: 1, cursor: 7, rows: { 'ui/x.ts': { syncedHash: null } } })
    );
    expect(readLedgerView(designRoot)).toEqual({
      cursor: 7,
      rows: { 'ui/x.ts': { syncedHash: null } },
    });
    rmSync(join(designRoot, '_state'), { recursive: true });
    expect(readLedgerView(designRoot)).toBeNull();
  });

  test("our consent sentence is the file plane's own (tripwire)", () => {
    const plane = readFileSync(join(import.meta.dir, '..', 'sync', 'file-plane.ts'), 'utf8');
    expect(plane).toContain(`'${CODE_CONSENT_REASON}'`);
  });

  test('the route is main origin only', () => {
    const spec = createCanvasSourceRoutes({ designRoot, designRel: '.design' }).find(
      (s) => s.path === '/_api/canvas-errors'
    );
    expect(spec?.origin).toBe('main');
  });
});

describe('#189 — a build that stopped outside the canvas’s code', () => {
  const fail = (f: Partial<SandboxBuildFail>): SandboxBuildFail => ({
    ok: false,
    kind: 'build',
    error: "Cannot find module '../../cli/lib/finding-text.mjs' from '/srv/studio/x.ts'",
    ...f,
  });

  test('the sandbox result → our class, from the host’s fields only', () => {
    expect(sandboxFailureClass(fail({ engine: true }))).toEqual({ class: 'engine' });
    expect(sandboxFailureClass(fail({ kind: 'runtime' }))).toEqual({ class: 'engine' });
    expect(sandboxFailureClass(fail({ kind: 'timeout' }))).toEqual({ class: 'timed-out' });
    expect(sandboxFailureClass(fail({ kind: 'memory' }))).toEqual({ class: 'memory' });
    expect(sandboxFailureClass(fail({ rejectedImports: 2 }))).toEqual({
      class: 'imports-refused',
      count: 2,
    });
    // the canvas's own syntax, or a build error with no host flag: not ours to classify
    expect(sandboxFailureClass(fail({ transpile: true, engine: true }))).toBeNull();
    expect(sandboxFailureClass(fail({}))).toBeNull();
  });

  test('canvas-errors carries the class (and nothing of the build text) while the source is unchanged', async () => {
    const sig = canvasSourceSig(CANVAS);
    recordBuildFailure(canvasAbs, sig, { class: 'engine' });
    const get = routesFor(owner, null);
    const r = await get(Q);
    expect(r.body.errors).toEqual([]);
    expect(r.body.buildFailure).toEqual({ class: 'engine' });
    expect(r.text).not.toContain('finding-text');
    // a later good build forgets it
    recordCanvasBuild(canvasAbs, sig, null);
    expect((await get(Q)).body.buildFailure).toBeUndefined();
    // and a failure recorded for another version of the source is not this one's
    recordBuildFailure(canvasAbs, 'other-sig', { class: 'timed-out' });
    expect((await get(Q)).body.buildFailure).toBeUndefined();
  });

  test('the worker flags a failure before its engine loaded (stage), never by message', () => {
    const worker = readFileSync(join(import.meta.dir, '..', 'canvas-build-worker.ts'), 'utf8');
    expect(worker).toMatch(/let stage: 'engine' \| 'build' = 'engine'/);
    expect(worker.indexOf("stage = 'build'")).toBeGreaterThan(
      worker.indexOf("await import(join(studioDir(), 'canvas-build.ts'))")
    );
  });

  test('a real sandbox whose engine cannot load (the 2.0.0 cell) reports the engine class', async () => {
    // the worker loads the studio from MAUDE_STUDIO_SRC: an empty folder is "Cannot find module …"
    const empty = mkdtempSync(join(tmpdir(), 'no-studio-'));
    try {
      const built = await buildCanvasSandboxed({
        designRoot,
        canvasAbs,
        env: { ...process.env, MAUDE_STUDIO_SRC: empty },
      });
      expect(built.ok).toBe(false);
      if (built.ok) return;
      expect(built.transpile).toBe(false);
      expect(sandboxFailureClass(built)).toEqual({ class: 'engine' });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 30_000);
});
