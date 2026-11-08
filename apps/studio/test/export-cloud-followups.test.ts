// #128 cloud follow-ups (T3.7b) — the cell's half, against a fake render service on loopback:
//   - a video waiting in the render service's queue does not spend its own time budget (only
//     running time does), with a hard ceiling so a stuck queue still ends;
//   - a user Cancel aborts the job, which cancels it on the service (owner-scoped);
//   - a cloud video asked for a higher scale says it was rendered at 1×, on the degradation channel.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBus } from '../context.ts';
import { createJobBudget } from '../exporters/job-budget.ts';
import {
  CLOUD_SCALE_WORDS,
  createExportJobQueue,
  EXPORT_CANCELLED_WORDS,
} from '../exporters/jobs.ts';
import { RENDER_BUSY_WORDS } from '../exporters/remote.ts';

const SECRET = 'cell-bearer';
const ENV_KEYS = [
  'MAUDE_WORKSPACE_MODE',
  'MAUDE_RENDER_URL',
  'MAUDE_RENDER_SECRET',
  'MAUDE_EXPORT_VIDEO_TIMEOUT_MS',
] as const;
const ENV0: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((k) => [k, process.env[k]])
);
const stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const [k, v] of Object.entries(ENV0)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function until(pred: () => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await Bun.sleep(10);
  }
}

/**
 * A fake render service. `/render` answers once `finish()` is called (or its request is aborted);
 * `/_render/status` follows `stateAt(ms since the render arrived)`.
 */
function fakeService(stateAt: (sinceMs: number) => 'waiting' | 'running') {
  const cancelled: string[] = [];
  const bodies: Array<{ options?: Record<string, unknown> }> = [];
  let arrived = 0;
  let finish!: () => void;
  const finished = new Promise<void>((r) => {
    finish = r;
  });
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/render') {
        arrived = Date.now();
        bodies.push((await req.json()) as { options?: Record<string, unknown> });
        await Promise.race([finished, new Promise((r) => req.signal.addEventListener('abort', r))]);
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'video/mp4', 'x-maude-filename': 'out.mp4' },
        });
      }
      if (url.pathname === '/_render/status') {
        return Response.json({ state: stateAt(arrived ? Date.now() - arrived : 0) });
      }
      if (url.pathname === '/_render/cancel' && req.method === 'POST') {
        cancelled.push(((await req.json()) as { id: string }).id);
        return Response.json({ cancelled: true });
      }
      return new Response('not found', { status: 404 });
    },
  });
  stops.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}`, cancelled, bodies, finish };
}

const REEL = [
  "import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';",
  'export default function Canvas() {',
  '  return <DesignCanvas><DCArtboard id="reel" width={1080} height={1920} /></DesignCanvas>;',
  '}',
].join('\n');

/** A workspace-mode cell with one video canvas and a queue wired to `svc`. */
function cell(svc: { url: string }, deps: Parameters<typeof createExportJobQueue>[2] = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'maude-t37b-'));
  const design = join(repo, '.design');
  mkdirSync(join(design, 'ui'), { recursive: true });
  writeFileSync(join(design, 'ui', 'Reel.tsx'), REEL);
  process.env.MAUDE_WORKSPACE_MODE = '1';
  process.env.MAUDE_RENDER_URL = svc.url;
  process.env.MAUDE_RENDER_SECRET = SECRET;
  const queue = createExportJobQueue(createBus(), design, { remotePollMs: 15, ...deps });
  stops.push(() => rmSync(repo, { recursive: true, force: true }));
  const enqueue = (options: Record<string, unknown> = {}, session?: string) =>
    queue.enqueue({
      format: 'mp4',
      scope: 'artboard',
      options,
      resolve: {
        activeJson: { active: '.design/ui/Reel.tsx', selected: null },
        designRoot: design,
        repoRoot: repo,
      },
      ctx: { designRoot: design, repoRoot: repo, serverOrigin: 'http://127.0.0.1:1' },
      remoteCanvas: { origin: 'https://tenant.example', token: 'tok' },
      ...(session ? { session } : {}),
    });
  return { queue, enqueue };
}

describe('the job budget — waiting in the render queue is not render time', () => {
  function fakeClock() {
    let t = 0;
    const timers = new Map<number, { at: number; fn: () => void }>();
    let n = 0;
    return {
      now: () => t,
      setT: (fn: () => void, ms: number) => {
        n += 1;
        timers.set(n, { at: t + ms, fn });
        return n as unknown as ReturnType<typeof setTimeout>;
      },
      clearT: (h: ReturnType<typeof setTimeout>) => void timers.delete(h as unknown as number),
      advance(ms: number) {
        const end = t + ms;
        for (;;) {
          const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (!next || next[1].at > end) break;
          timers.delete(next[0]);
          t = next[1].at;
          next[1].fn();
        }
        t = end;
      },
    };
  }

  test('only running time spends the budget; the pause is bounded', () => {
    const c = fakeClock();
    const fired: string[] = [];
    const b = createJobBudget({
      budgetMs: 1000,
      maxPauseMs: 5000,
      onExpire: (why) => fired.push(why),
      now: c.now,
      setTimer: c.setT,
      clearTimer: c.clearT,
    });
    b.start();
    c.advance(600); // 600 of 1000 spent
    b.pause();
    c.advance(4000); // waiting: free
    expect(fired).toEqual([]);
    b.resume();
    c.advance(399); // 999 spent
    expect(fired).toEqual([]);
    c.advance(2); // 1001
    expect(fired).toEqual(['budget']);
  });

  test('a queue that never moves ends at the ceiling', () => {
    const c = fakeClock();
    const fired: string[] = [];
    const b = createJobBudget({
      budgetMs: 1000,
      maxPauseMs: 5000,
      onExpire: (why) => fired.push(why),
      now: c.now,
      setTimer: c.setT,
      clearTimer: c.clearT,
    });
    b.start();
    b.pause();
    c.advance(4999);
    expect(fired).toEqual([]);
    c.advance(2);
    expect(fired).toEqual(['queue']);
  });

  test('the ceiling is a total: several short waits add up', () => {
    const c = fakeClock();
    const fired: string[] = [];
    const b = createJobBudget({
      budgetMs: 100_000,
      maxPauseMs: 3000,
      onExpire: (why) => fired.push(why),
      now: c.now,
      setTimer: c.setT,
      clearTimer: c.clearT,
    });
    b.start();
    for (let i = 0; i < 3; i += 1) {
      b.pause();
      c.advance(900);
      b.resume();
      c.advance(10);
    }
    expect(fired).toEqual([]);
    b.pause();
    c.advance(400); // 2700 + 400 > 3000
    expect(fired).toEqual(['queue']);
  });

  test('stop() disarms everything', () => {
    const c = fakeClock();
    const fired: string[] = [];
    const b = createJobBudget({
      budgetMs: 100,
      maxPauseMs: 100,
      onExpire: (why) => fired.push(why),
      now: c.now,
      setTimer: c.setT,
      clearTimer: c.clearT,
    });
    b.start();
    b.pause();
    b.stop();
    c.advance(10_000);
    expect(fired).toEqual([]);
  });
});

describe('the export job — a video waiting in the render queue', () => {
  test('time spent waiting does not count against the job timeout', async () => {
    process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS = '600'; // the render budget
    // waits 1500 ms behind another video (2.5 × the budget), then runs for ~100 ms
    const svc = fakeService((since) => (since < 1500 ? 'waiting' : 'running'));
    const { queue, enqueue } = cell(svc, { queueWaitMs: 10_000 });
    const { id, result } = enqueue();
    await until(() => queue.get(id)?.waiting !== undefined);
    await until(() => queue.get(id)?.waiting === undefined, 5000);
    expect(queue.get(id)?.status).toBe('running'); // not aborted by its own timeout while it waited
    await Bun.sleep(100);
    svc.finish();
    await result;
    expect(queue.get(id)?.status).toBe('done');
  }, 15_000);

  test('running time still counts: a render that runs past its budget is stopped', async () => {
    process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS = '300';
    const svc = fakeService(() => 'running');
    const { queue, enqueue } = cell(svc, { queueWaitMs: 10_000 });
    const { id, result } = enqueue();
    await result.catch(() => {});
    expect(queue.get(id)?.status).toBe('failed');
    await until(() => svc.cancelled.length > 0); // and it was cancelled on the service
  }, 15_000);

  test('a queue that never moves still ends — at the ceiling, with the busy words', async () => {
    process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS = '60000';
    const svc = fakeService(() => 'waiting');
    const { queue, enqueue } = cell(svc, { queueWaitMs: 400 });
    const { id, result } = enqueue();
    const started = Date.now();
    await result.catch(() => {});
    expect(Date.now() - started).toBeLessThan(5000);
    expect(queue.get(id)?.status).toBe('failed');
    expect(queue.get(id)?.error).toBe(RENDER_BUSY_WORDS);
    await until(() => svc.cancelled.length > 0);
  }, 15_000);
});

describe('the export job — Cancel', () => {
  test('the requester cancels a running cloud job: aborted, cancelled on the service, in their words', async () => {
    process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS = '60000';
    const svc = fakeService(() => 'running');
    const { queue, enqueue } = cell(svc);
    const { id, result } = enqueue({}, 'aaaaaaaaaaaaaaaa');
    await until(() => queue.get(id, 'aaaaaaaaaaaaaaaa')?.status === 'running');
    await until(() => svc.bodies.length > 0);

    expect(queue.cancel(id, 'bbbbbbbbbbbbbbbb')).toEqual({ ok: false, reason: 'missing' });
    expect(queue.get(id, 'aaaaaaaaaaaaaaaa')?.status).toBe('running');

    expect(queue.cancel(id, 'aaaaaaaaaaaaaaaa')).toEqual({ ok: true });
    await result.catch(() => {});
    const job = queue.get(id, 'aaaaaaaaaaaaaaaa');
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe(EXPORT_CANCELLED_WORDS);
    await until(() => svc.cancelled.length > 0);

    // a finished job cannot be cancelled again
    expect(queue.cancel(id, 'aaaaaaaaaaaaaaaa')).toEqual({ ok: false, reason: 'not-running' });
    expect(queue.cancel('nope', 'aaaaaaaaaaaaaaaa')).toEqual({ ok: false, reason: 'missing' });
  }, 15_000);
});

describe('the export job — a cloud video asked for more than 1×', () => {
  async function run(options: Record<string, unknown>) {
    process.env.MAUDE_EXPORT_VIDEO_TIMEOUT_MS = '60000';
    const svc = fakeService(() => 'running');
    const { queue, enqueue } = cell(svc);
    const { id, result } = enqueue(options);
    await until(() => svc.bodies.length > 0);
    svc.finish();
    await result;
    return queue.get(id);
  }

  test('says it rendered at 1× in the cloud, on the degradation channel', async () => {
    const job = await run({ scale: 2 });
    expect(job?.status).toBe('done');
    expect(job?.degraded?.reason).toContain(CLOUD_SCALE_WORDS);
    expect(job?.degraded?.reason).toContain('2×');
    expect(job?.degraded?.reason).toStartWith('Rendered at 1× in the cloud');
    // not a quality failure: nothing was dropped
    expect(job?.degraded?.audioDropped).toBeUndefined();
  }, 15_000);

  test('a 1× (or unspecified) request has nothing to say', async () => {
    expect((await run({ scale: 1 }))?.degraded).toBeUndefined();
    expect((await run({}))?.degraded).toBeUndefined();
  }, 15_000);
});
