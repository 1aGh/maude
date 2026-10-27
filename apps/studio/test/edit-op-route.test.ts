// S2.1 — `POST /_api/edit-op` as a table route (contract client/v2/contracts/S2-edit-ops.md §1):
// main origin only (in neither canvas allowlist), refused read-only, GET → 405, a real write that
// announces its base, AI holds read from the run registry. The viewer's 403 through a booted studio
// is a row of test/access-role-matrix.test.ts; the canvas origin's 403 a row of canvas-origin-gate.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyEdit } from '../canvas-edit.ts';
import type { EditOp } from '../edit-ops/types.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import { createEditRoutes, resolveCanvasRel } from '../routes/edit.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
const PAINT: EditOp = {
  id: 'test.paint',
  apply: (src, r) => ({
    source: r.targets.reduce(
      (s, t) => applyEdit(r.file, s, t.element, 'style.color', "'red'").source,
      src
    ),
  }),
};

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'maude-edit-op-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, '_history'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Home.tsx'), SRC);
  writeFileSync(join(designRoot, '_history', 'Snap.tsx'), SRC);
  return { root, designRoot };
}
const post = (body: unknown) =>
  new Request('http://localhost/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/_api/edit-op in the one table', () => {
  test('main origin only: in neither canvas allowlist; a viewer is refused by the read-only gate', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/edit-op');
    expect(specs.map((s) => [s.method, s.origin, s.readOnly])).toEqual([
      ['POST', 'main', 'refused'],
    ]);
    const mounted = mountRoutes(allSpecs(stubDeps()));
    expect(mounted.canvasPaths).not.toContain('/_api/edit-op');
    expect(CANVAS_SAFE_API.has('/_api/edit-op')).toBe(false);
    expect(mounted.readOnlyAllowed.exact).not.toContain('/_api/edit-op');
  });

  test('GET → 405 on the main origin', async () => {
    const { exact } = mountRoutes(
      createEditRoutes({ designRoot: '/x', designRel: '.design', repoRoot: '/', emit: () => {} })
    );
    const r = await (exact['/_api/edit-op'] as (q: Request) => Promise<Response>)(
      new Request('http://localhost/_api/edit-op')
    );
    expect(r.status).toBe(405);
  });
});

describe('/_api/edit-op handler', () => {
  test('one write on disk: base announced, snapshot taken, the answer carries rev + refs', async () => {
    const { root, designRoot } = sandbox();
    const events: Array<[string, unknown]> = [];
    const snaps: string[] = [];
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: (e, p) => events.push([e, p]),
      snapshot: async (rel, _b, reason) => void snaps.push(`${rel} ${reason}`),
      actionFor: (repoRel) => (repoRel === '.design/ui/Home.tsx' ? 'act_9' : null),
      ops: [PAINT],
    });
    const r = await spec.handle(
      post({
        file: '.design/ui/Home.tsx',
        op: 'test.paint',
        targets: [{ artboard: 'desktop', element: 'footer' }],
      }),
      {}
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      actionId: 'act_9',
      refs: [{ artboard: 'desktop', element: 'footer' }],
    });
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toContain("color: 'red'");
    // S2.23 (G4): the write is announced with its bytes, so the local home records it as the person's
    // `edit` (one ⌘Z step) and not as an `outside` row the undo stack leaves out.
    const written = readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8');
    expect(events).toEqual([
      ['activity:suppress', 'ui/Home.tsx'],
      // S2.20b (p8-e2e-fix-r9): said before the bytes land too — the local home's note, so a ⌘Z or the
      // watcher arriving before `source-written` (the snapshot is written in between) finds the edit
      ['source-writing', { rel: 'ui/Home.tsx', content: written, label: 'Paint' }],
      [
        'source-written',
        {
          rel: 'ui/Home.tsx',
          content: readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8'),
          // S2.24 G3: and says what it was, so the history row reads it
          label: 'Paint',
        },
      ],
    ]);
    expect(snaps).toEqual(['ui/Home.tsx pre-test.paint']);
  });

  test('held by a live AI run → 409 held-by-ai, file untouched; a waiting run holds nothing', async () => {
    const { root, designRoot } = sandbox();
    let state = 'running';
    const runs = {
      canvasKey: (rel: string) => `path:.design/${rel}`,
      live: () => [
        {
          state,
          objects: [{ canvas: 'path:.design/ui/Home.tsx', artboard: 'desktop', element: 'footer' }],
          scope: null,
        },
      ],
      view: () => ({ others: [] }),
    } as never;
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
      runs,
      ops: [PAINT],
    });
    const req = {
      file: 'ui/Home.tsx',
      op: 'test.paint',
      targets: [{ artboard: 'desktop', element: 'footer' }],
    };
    const r = await spec.handle(post(req), {});
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      ok: false,
      code: 'held-by-ai',
      message: "footer is AI's until it's done · Stop in the AI chat",
    });
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toBe(SRC);
    state = 'waiting';
    expect((await spec.handle(post(req), {})).status).toBe(200);
  });

  test('junk JSON → 400 invalid; an oversized body → 413', async () => {
    const [spec] = createEditRoutes({
      designRoot: '/x',
      designRel: '.design',
      repoRoot: '/',
      emit: () => {},
    });
    const junk = new Request('http://localhost/_api/edit-op', { method: 'POST', body: '{' });
    expect((await spec.handle(junk, {})).status).toBe(400);
    const big = new Request('http://localhost/_api/edit-op', {
      method: 'POST',
      body: 'x'.repeat(70 * 1024),
    });
    expect((await spec.handle(big, {})).status).toBe(413);
  });

  test('a file resolves only to an existing canvas inside the design root, never runtime state', () => {
    const { designRoot } = sandbox();
    expect(resolveCanvasRel(designRoot, '.design', '.design/ui/Home.tsx')).toBe('ui/Home.tsx');
    expect(resolveCanvasRel(designRoot, '.design', 'ui/Home')).toBe('ui/Home.tsx');
    expect(resolveCanvasRel(designRoot, '.design', 'ui/../../etc/passwd')).toBeNull();
    expect(resolveCanvasRel(designRoot, '.design', '_history/Snap.tsx')).toBeNull();
    expect(resolveCanvasRel(designRoot, '.design', 'ui/Missing.tsx')).toBeNull();
  });
});
