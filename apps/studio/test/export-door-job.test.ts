// S8.5b-1 — the studio half of the cloud render door (contract S8.5b §5, §7, threats T2/T3/T5/T11).
//
// The desktop's outbox record id becomes the cell's job id, owner-scoped: the same member asking
// again gets the job it already has; anyone else gets 409 and never that job. A queued job takes
// the fresher render token every status read brings. `x-maude-door-job` counts only in a cell.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { createBus } from '../context.ts';
import type { ExportContext } from '../exporters/index.ts';
import {
  createExportJobQueue,
  type EnqueueArgs,
  ExportJobIdError,
  type ExportJobQueue,
} from '../exporters/jobs.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const ID = 'i_abcdefghij0123456789';
const ID2 = 'i_zyxwvutsrq9876543210';

// ── the queue ────────────────────────────────────────────────────────────────────────────────

const SAVED = { ...process.env };
afterEach(() => {
  for (const k of [
    'MAUDE_WORKSPACE_MODE',
    'MAUDE_RENDER_URL',
    'MAUDE_RENDER_SECRET',
    'MAUDE_EXPORT_MAX_CONCURRENT',
  ]) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

function designRootFor(): string {
  const root = mkdtempSync(join(tmpdir(), 's85b1-q-'));
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'Home.tsx'), 'export default function Home(){return null}\n');
  return design;
}

function args(
  design: string,
  over: Partial<EnqueueArgs> & { format?: EnqueueArgs['format']; scope?: EnqueueArgs['scope'] }
): EnqueueArgs {
  const repoRoot = join(design, '..');
  const ctx: ExportContext = { designRoot: design, repoRoot, serverOrigin: 'http://127.0.0.1:1' };
  return {
    format: 'zip',
    scope: 'project-raw',
    options: {},
    resolve: {
      activeJson: { active: '.design/ui/Home.tsx', selected: null },
      designRoot: design,
      repoRoot,
    },
    ctx,
    ...over,
  };
}

function refusal(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ExportJobIdError ? e.reason : `other: ${String(e)}`;
  }
}

describe('client job id (queue)', () => {
  test('it becomes the job id; a replay by its owner is the same job, nothing new queued', async () => {
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design);
    const first = q.enqueue(args(design, { clientId: ID, session: 'sessa' }));
    expect(first.id).toBe(ID);
    expect(first.already).toBeUndefined();
    const again = q.enqueue(args(design, { clientId: ID, session: 'sessa' }));
    expect(again).toMatchObject({ id: ID, already: true });
    expect(q.list('sessa')).toHaveLength(1);
    await first.result;
    // finished: still the same job, and a replay does not render it again
    const late = q.enqueue(args(design, { clientId: ID, session: 'sessa' }));
    expect(late).toMatchObject({ id: ID, already: true });
    await expect(late.result).rejects.toThrow();
    expect(q.list('sessa')).toHaveLength(1);
  });

  test('T2: another owner, or the same owner with a different export, is refused — never that job', async () => {
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design);
    await q.enqueue(args(design, { clientId: ID, session: 'sessa' })).result;
    expect(refusal(() => q.enqueue(args(design, { clientId: ID, session: 'sessb' })))).toBe(
      'taken'
    );
    expect(
      refusal(() =>
        q.enqueue(args(design, { clientId: ID, session: 'sessa', options: { quality: 1 } }))
      )
    ).toBe('taken');
    expect(q.get(ID, 'sessb')).toBeUndefined();
    expect((await q.getBytes(ID, 'sessb')).ok).toBe(false);
    expect(q.list('sessb')).toHaveLength(0);
  });

  test('a malformed id, or one with no owner to scope it to, is refused', () => {
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design);
    for (const bad of ['', '../../etc', 'i_ABCDEFGHIJ0123456789', `${ID}x`, 'i_short']) {
      expect(refusal(() => q.enqueue(args(design, { clientId: bad, session: 'sessa' })))).toBe(
        'invalid'
      );
    }
    expect(refusal(() => q.enqueue(args(design, { clientId: ID, session: '' })))).toBe('no-owner');
    expect(q.list('')).toHaveLength(0);
  });

  test('after a restart the ledger still knows whose id it is', async () => {
    const design = designRootFor();
    const q1 = createExportJobQueue(createBus(), design);
    await q1.enqueue(args(design, { clientId: ID, session: 'sessa' })).result;
    const q2 = createExportJobQueue(createBus(), design);
    expect(q2.enqueue(args(design, { clientId: ID, session: 'sessa' }))).toMatchObject({
      id: ID,
      already: true,
    });
    expect(refusal(() => q2.enqueue(args(design, { clientId: ID, session: 'sessb' })))).toBe(
      'taken'
    );
  });
});

/** A fake maude-render that holds every request until `release()`; records each canvas token. */
function holdingRender() {
  const seen: Array<string | undefined> = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const body = (await req.json()) as { canvas?: { token?: string } };
      seen.push(body.canvas?.token);
      await gate;
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png', 'x-maude-filename': 'a.png' },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, release: () => open(), server };
}

describe('render token swap (queue, T11)', () => {
  test('a queued remote job renders with the newest token its owner brought', async () => {
    const render = holdingRender();
    try {
      process.env.MAUDE_WORKSPACE_MODE = '1';
      process.env.MAUDE_RENDER_URL = render.url;
      process.env.MAUDE_RENDER_SECRET = 'shh';
      process.env.MAUDE_EXPORT_MAX_CONCURRENT = '1';
      const design = designRootFor();
      const q: ExportJobQueue = createExportJobQueue(createBus(), design);
      const png = { format: 'png' as const, scope: 'artboard' as const };
      const one = q.enqueue(
        args(design, {
          ...png,
          session: 'sessa',
          remoteCanvas: { origin: 'https://c', token: 't1' },
        })
      );
      const two = q.enqueue(
        args(design, {
          ...png,
          clientId: ID2,
          session: 'sessa',
          remoteCanvas: { origin: 'https://c', token: 'old' },
        })
      );
      for (let i = 0; i < 100 && render.seen.length === 0; i++) await Bun.sleep(10);
      expect(q.get(ID2, 'sessa')?.status).toBe('queued');
      expect(q.refreshRenderToken(ID2, 'R-new', 'sessb')).toBe(false); // not theirs: like missing
      expect(q.refreshRenderToken(ID2, '', 'sessa')).toBe(false);
      expect(q.refreshRenderToken(ID2, 'R-new', 'sessa')).toBe(true);
      render.release();
      await one.result;
      await two.result;
      expect(render.seen).toEqual(['t1', 'R-new']);
      expect(q.refreshRenderToken(ID2, 'R-later', 'sessa')).toBe(false); // finished
    } finally {
      render.server.stop(true);
    }
  });
});

// ── the route (a booted cell) ──────────────────────────────────────────────────────────────────

const SRC = (id: string) => `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="${id}" label="${id}" width={200} height={100}><div>${id}</div></DCArtboard>
    </DesignCanvas>
  );
}
`;
const claim = (c: AccessClaim, readonly: string) => ({
  'x-maude-access': Buffer.from(JSON.stringify(c)).toString('base64url'),
  'x-maude-readonly': readonly,
});
const member = (session: string) => ({
  ...claim({ v: 1, role: 'member' } as AccessClaim, '0'),
  'x-maude-role': 'member',
  'x-maude-session': session,
});
const ONLY_A = {
  ...claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] }, '1'),
  'x-maude-session': 'sessc',
};
const SPEC_A = { v: 2, scope: 'canvas', canvas: 'ui/a.tsx', format: 'png' };
const NOT_IN_SCOPE = { error: 'not-in-scope', reason: 'not-in-scope' };

async function call(
  base: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: text };
  }
}

describe('POST /_api/export-jobs in a cell with x-maude-door-job', () => {
  let proc: Subprocess | undefined;
  let cell = '';
  let render: ReturnType<typeof holdingRender>;
  beforeAll(async () => {
    render = holdingRender();
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC('a1'));
    writeFileSync(join(designRoot, 'ui', 'b.tsx'), SRC('b1'));
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Alligators',
      MAUDE_RENDER_URL: render.url,
      MAUDE_RENDER_SECRET: 'shh',
      MAUDE_EXPORT_MAX_CONCURRENT: '1',
    });
    cell = `http://localhost:${port}`;
  }, 60_000);
  afterAll(async () => {
    render.release();
    if (proc) await killProc(proc);
    render.server.stop(true);
  });

  test('the job id is the door id; a replay is 200 already; another member gets 409, never the job', async () => {
    const door = { 'x-maude-door-job': ID, 'x-maude-render-token': 'R1' };
    const a = await call(
      cell,
      '/_api/export-jobs',
      { ...member('sessa'), ...door },
      { v: 2, spec: SPEC_A }
    );
    expect(a).toEqual({ status: 202, json: { jobId: ID } });
    const again = await call(
      cell,
      '/_api/export-jobs',
      { ...member('sessa'), ...door },
      { v: 2, spec: SPEC_A }
    );
    expect(again).toEqual({ status: 200, json: { jobId: ID, already: true } });
    const b = await call(
      cell,
      '/_api/export-jobs',
      { ...member('sessb'), ...door },
      { v: 2, spec: SPEC_A }
    );
    expect(b).toEqual({ status: 409, json: { code: 'id-taken' } });
    const bad = await call(
      cell,
      '/_api/export-jobs',
      { ...member('sessa'), 'x-maude-door-job': '../x' },
      { v: 2, spec: SPEC_A }
    );
    expect(bad).toEqual({ status: 400, json: { code: 'bad-job-id' } });
  });

  test('GET ?id= is owner-scoped: the owner sees one job, anyone else a 404', async () => {
    const mine = await call(cell, `/_api/export-jobs?id=${ID}`, member('sessa'));
    expect(mine.status).toBe(200);
    const jobs = (mine.json as { jobs: Array<{ id: string }> }).jobs;
    expect(jobs.map((j) => j.id)).toEqual([ID]);
    const theirs = await call(cell, `/_api/export-jobs?id=${ID}`, member('sessb'));
    expect(theirs.status).toBe(404);
    expect(
      (await call(cell, '/_api/export-jobs?id=i_00000000000000000000', member('sessa'))).status
    ).toBe(404);
  });

  test('T11: a queued job renders with the token the latest status read brought', async () => {
    // the first job holds the one render slot; this one waits queued with R-old
    const r = await call(
      cell,
      '/_api/export-jobs',
      { ...member('sessa'), 'x-maude-door-job': ID2, 'x-maude-render-token': 'R-old' },
      { v: 2, spec: SPEC_A }
    );
    expect(r.status).toBe(202);
    await call(cell, `/_api/export-jobs?id=${ID2}`, {
      ...member('sessb'),
      'x-maude-render-token': 'R-evil',
    });
    await call(cell, `/_api/export-jobs?id=${ID2}`, {
      ...member('sessa'),
      'x-maude-render-token': 'R-new',
    });
    render.release();
    for (let i = 0; i < 300 && render.seen.length < 2; i++) await Bun.sleep(20);
    expect(render.seen).toEqual(['R1', 'R-new']);
  }, 30_000);

  test('T3: a canvas-only door session reaches neither Folder, Whole project, nor an ungranted canvas', async () => {
    const door = { ...ONLY_A, 'x-maude-door-job': 'i_cccccccccccccccccccc' };
    for (const spec of [
      { v: 2, scope: 'folder', folder: 'ui', format: 'png' },
      { v: 2, scope: 'project', format: 'png' },
      { v: 2, scope: 'canvas', canvas: 'ui/b.tsx', format: 'png' },
      { v: 2, scope: 'canvas', canvas: 'ui/nope.tsx', format: 'png' },
    ]) {
      expect(await call(cell, '/_api/export-jobs', door, { v: 2, spec })).toEqual({
        status: 403,
        json: NOT_IN_SCOPE,
      });
    }
    // an artboard of another canvas, named under its own: not a job
    const foreign = await call(cell, '/_api/export-jobs', door, {
      v: 2,
      spec: {
        v: 2,
        scope: 'selection',
        canvas: 'ui/a.tsx',
        selection: { artboards: ['b1'] },
        format: 'png',
      },
    });
    expect([202, 200]).not.toContain(foreign.status);
    expect((await call(cell, '/_api/export-jobs?id=i_cccccccccccccccccccc', ONLY_A)).status).toBe(
      404
    );
  });
});

describe('POST /_api/export-jobs on this Mac (local lane)', () => {
  let proc: Subprocess | undefined;
  let base = '';
  beforeAll(async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    proc = await bootServer(root, port, {});
    base = `http://localhost:${port}`;
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  test('T5: x-maude-door-job is ignored — the job gets its own id', async () => {
    const r = await call(
      base,
      '/_api/export-jobs',
      { 'x-maude-door-job': ID },
      { v: 2, spec: { v: 2, scope: 'project', format: 'zip' } }
    );
    expect(r.status).toBe(202);
    expect((r.json as { jobId: string }).jobId).not.toBe(ID);
  });
});
