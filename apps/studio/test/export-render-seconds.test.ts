// Michal 2026-10-21 on S8.5b M2 (decision:maude/v2-michal-render-seconds-in-studio): the studio
// counts the seconds a tenant's export jobs spend rendering on a cloud lane and reports the
// running total since boot, with the boot time, in /_health (`render.renderSeconds` / `renderJobs` /
// `renderSecondsSince`).
//
// Counted: slot taken -> settled (done, failed, or aborted by the job timeout). Not counted: time
// queued, a job refused before it ran, and anything on this Mac's local lane.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { createBus } from '../context.ts';
import type { ExportContext, ExportResult } from '../exporters/index.ts';
import { createExportJobQueue, type EnqueueArgs } from '../exporters/jobs.ts';
import { _resetRenderSeconds, renderSecondsStats } from '../exporters/render-seconds.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SAVED = { ...process.env };
beforeEach(() => _resetRenderSeconds(1_000));
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
  const root = mkdtempSync(join(tmpdir(), 'rs-'));
  const design = join(root, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'Home.tsx'), 'export default function Home(){return null}\n');
  return design;
}

function args(design: string): EnqueueArgs {
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
    session: 'sessa',
  };
}

const OK: ExportResult = {
  body: new Uint8Array([1]),
  filename: 'a.zip',
  contentType: 'application/zip',
} as ExportResult;

/** A clock the test moves by hand. */
function clock(start = 10_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function cloudLane() {
  process.env.MAUDE_WORKSPACE_MODE = '1';
  process.env.MAUDE_RENDER_URL = 'http://127.0.0.1:1';
  process.env.MAUDE_RENDER_SECRET = 'shh';
}

describe('render seconds (queue)', () => {
  test('a finished cloud job adds the seconds it rendered', async () => {
    cloudLane();
    const c = clock();
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design, {
      now: c.now,
      runExport: async () => {
        c.advance(2_500);
        return OK;
      },
    });
    await q.enqueue(args(design)).result;
    expect(renderSecondsStats()).toMatchObject({
      renderSeconds: 2.5,
      renderJobs: 1,
      renderSecondsSince: 1_000,
    });
    await q.enqueue({ ...args(design), session: 'sessb' }).result;
    expect(renderSecondsStats()).toMatchObject({ renderSeconds: 5, renderJobs: 2 });
  });

  test('a failed (or aborted-by-timeout) job adds only the time it ran', async () => {
    cloudLane();
    const c = clock();
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design, {
      now: c.now,
      runExport: async () => {
        c.advance(700);
        throw new Error('boom');
      },
    });
    await expect(q.enqueue(args(design)).result).rejects.toThrow('boom');
    expect(renderSecondsStats()).toMatchObject({ renderSeconds: 0.7, renderJobs: 1 });
  });

  test('time spent queued behind another job is not render time', async () => {
    cloudLane();
    process.env.MAUDE_EXPORT_MAX_CONCURRENT = '1';
    const c = clock();
    const design = designRootFor();
    let release: (() => void) | undefined;
    let calls = 0;
    const q = createExportJobQueue(createBus(), design, {
      now: c.now,
      runExport: () => {
        calls++;
        if (calls === 1) return new Promise<ExportResult>((r) => (release = () => r(OK)));
        c.advance(300);
        return Promise.resolve(OK);
      },
    });
    const one = q.enqueue(args(design));
    const two = q.enqueue({ ...args(design), session: 'sessb' });
    await Bun.sleep(20);
    c.advance(60_000); // the second job waits a minute in the queue
    c.advance(1_000);
    release?.();
    await one.result;
    await two.result;
    // first: 61 s of its own render; second: only its own 0.3 s, not the minute it queued
    expect(renderSecondsStats()).toMatchObject({ renderSeconds: 61.3, renderJobs: 2 });
  });

  test('a job refused before it ran adds nothing', async () => {
    process.env.MAUDE_WORKSPACE_MODE = '1'; // no MAUDE_RENDER_URL: lane `none`, a browser format
    delete process.env.MAUDE_RENDER_URL;
    const c = clock();
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design, { now: c.now });
    await expect(
      q.enqueue({ ...args(design), format: 'png', scope: 'artboard' }).result
    ).rejects.toThrow();
    expect(renderSecondsStats()).toMatchObject({ renderSeconds: 0, renderJobs: 0 });
  });

  test('this Mac (local lane) counts nothing — the figure is cloud load', async () => {
    const c = clock();
    const design = designRootFor();
    const q = createExportJobQueue(createBus(), design, {
      now: c.now,
      runExport: async () => {
        c.advance(4_000);
        return OK;
      },
    });
    await q.enqueue(args(design)).result;
    expect(renderSecondsStats()).toMatchObject({ renderSeconds: 0, renderJobs: 0 });
  });

  test('a restart resets the total and moves renderSecondsSince', () => {
    expect(renderSecondsStats().renderSecondsSince).toBe(1_000);
    _resetRenderSeconds(9_000);
    expect(renderSecondsStats()).toEqual({
      renderSeconds: 0,
      renderJobs: 0,
      renderSecondsSince: 9_000,
    });
  });
});

// ── /_health in a booted cell ──────────────────────────────────────────────────────────────

const SRC = `import { DesignCanvas, DCArtboard } from "@maude/canvas-lib";
export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="a1" label="a1" width={200} height={100}><div>a1</div></DCArtboard>
    </DesignCanvas>
  );
}
`;
const MEMBER = {
  'x-maude-access': Buffer.from(JSON.stringify({ v: 1, role: 'member' })).toString('base64url'),
  'x-maude-readonly': '0',
  'x-maude-role': 'member',
  'x-maude-session': 'sessa',
  'content-type': 'application/json',
};

type Health = {
  render: { renderSeconds?: number; renderJobs?: number; renderSecondsSince?: number };
};

describe('/_health reports render seconds', () => {
  let proc: Subprocess | undefined;
  let base = '';
  let render: ReturnType<typeof Bun.serve> | undefined;
  beforeAll(async () => {
    // a fake maude-render that takes ~300 ms to answer with a one-pixel png
    render = Bun.serve({
      port: 0,
      fetch: async () => {
        await Bun.sleep(300);
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png', 'x-maude-filename': 'a.png' },
        });
      },
    });
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'a.tsx'), SRC);
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_WORKSPACE_MODE: '1',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
      MAUDE_PROJECT_NAME: 'Alligators',
      MAUDE_RENDER_URL: `http://127.0.0.1:${render.port}`,
      MAUDE_RENDER_SECRET: 'shh',
    });
    base = `http://localhost:${port}`;
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
    render?.stop(true);
  });

  const health = async () => (await (await fetch(`${base}/_health`)).json()) as Health;

  test('the fields are there from boot: zero seconds, zero jobs, a boot time', async () => {
    const r = (await health()).render;
    expect(r.renderSeconds).toBe(0);
    expect(r.renderJobs).toBe(0);
    expect(Math.abs((r.renderSecondsSince ?? 0) - Date.now())).toBeLessThan(120_000);
  });

  test('a finished job shows up in the total, boot time unchanged', async () => {
    const before = (await health()).render;
    const r = await fetch(`${base}/_api/export-jobs`, {
      method: 'POST',
      headers: { ...MEMBER, 'x-maude-render-token': 'R1' },
      body: JSON.stringify({
        v: 2,
        spec: { v: 2, scope: 'canvas', canvas: 'ui/a.tsx', format: 'png' },
      }),
    });
    expect(r.status).toBe(202);
    let after = before;
    for (let i = 0; i < 100 && (after.renderJobs ?? 0) < 1; i++) {
      await Bun.sleep(50);
      after = (await health()).render;
    }
    expect(after.renderJobs).toBe(1);
    expect(after.renderSeconds ?? 0).toBeGreaterThanOrEqual(0.25);
    expect(after.renderSeconds ?? 99).toBeLessThan(10);
    expect(after.renderSecondsSince).toBe(before.renderSecondsSince as number);
  }, 30_000);
});
