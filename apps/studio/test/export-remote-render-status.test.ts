// #128 cloud comments 2–3 (T3.7, decision maude/burndown-d7-cloud-render-budget) — the cell's half
// of the render service's status and cancel routes:
//   - every job carries a random render id; while the render runs the cell polls
//     `/_render/status` with it and turns the answer into the job's progress and its
//     "waiting for another video" line;
//   - a job the cell aborts (its timeout) is cancelled on the service, so its slot is freed;
//   - a dropped render says "busy" when the service is busy and "waking up" only when it is not
//     answering at all (the alligators job said "waking up" while the render was busy).

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createBus } from '../context.ts';
import { createExportJobQueue } from '../exporters/jobs.ts';
import {
  RENDER_BUSY_WORDS,
  RENDER_LOST_WORDS,
  RENDER_WAITING_WORDS,
  RENDER_WAKING_WORDS,
  renderRemotely,
} from '../exporters/remote.ts';

const SECRET = 'cell-bearer';
const stops: Array<() => void> = [];
afterEach(() => {
  for (const s of stops.splice(0)) s();
});

const baseArgs = {
  format: 'mp4' as const,
  targets: [{ kind: 'element', file: 'a.tsx', artboardId: 'x' }] as never,
  options: {},
  canvas: { origin: 'https://canvas.example.test' },
};

interface Seen {
  renderBody?: { renderId?: string };
  statusIds: string[];
  statusAuth: string[];
  cancelled: Array<{ id: string; auth: string }>;
}

/** A fake render service: `/render` answers when `finish()` is called; status follows `script`. */
function fakeService(script: Array<{ state: string; progress?: unknown }>) {
  const seen: Seen = { statusIds: [], statusAuth: [], cancelled: [] };
  let finish!: () => void;
  const finished = new Promise<void>((r) => {
    finish = r;
  });
  let polls = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/render') {
        seen.renderBody = (await req.json()) as Seen['renderBody'];
        await Promise.race([finished, new Promise((r) => req.signal.addEventListener('abort', r))]);
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'video/mp4', 'x-maude-filename': 'out.mp4' },
        });
      }
      if (url.pathname === '/_render/status') {
        seen.statusIds.push(url.searchParams.get('id') ?? '');
        seen.statusAuth.push(req.headers.get('authorization') ?? '');
        const step = script[Math.min(polls, script.length - 1)];
        polls += 1;
        return Response.json(step);
      }
      if (url.pathname === '/_render/cancel' && req.method === 'POST') {
        const b = (await req.json()) as { id: string };
        seen.cancelled.push({ id: b.id, auth: req.headers.get('authorization') ?? '' });
        return Response.json({ cancelled: true });
      }
      return new Response('not found', { status: 404 });
    },
  });
  stops.push(() => server.stop(true));
  return { url: `http://127.0.0.1:${server.port}`, seen, finish, polls: () => polls };
}

async function until(pred: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await Bun.sleep(10);
  }
}

describe('renderRemotely — status, progress and the waiting line', () => {
  test('a waiting job says so, then reports frame progress by its random render id', async () => {
    const svc = fakeService([
      { state: 'waiting' },
      { state: 'running', progress: { current: 30, total: 90 } },
    ]);
    const waiting: boolean[] = [];
    const progress: Array<{ current: number; total: number }> = [];
    const pending = renderRemotely({
      ...baseArgs,
      service: { url: svc.url, secret: SECRET },
      pollMs: 15,
      onWaiting: (w) => waiting.push(w),
      onProgress: (p) => progress.push(p),
    });
    await until(() => progress.length > 0);
    svc.finish();
    const res = await pending;
    expect(res.filename).toBe('out.mp4');

    const id = svc.seen.renderBody?.renderId ?? '';
    expect(id).toMatch(/^[A-Za-z0-9_-]{22,64}$/);
    expect(svc.seen.statusIds.every((s) => s === id)).toBe(true);
    expect(svc.seen.statusAuth.every((a) => a === `Bearer ${SECRET}`)).toBe(true);
    expect(waiting[0]).toBe(true);
    expect(waiting.at(-1)).toBe(false); // the line clears once it runs and when it settles
    expect(progress[0]).toEqual({ current: 30, total: 90 });
  });

  test('two jobs never share a render id', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const svc = fakeService([{ state: 'running' }]);
      const p = renderRemotely({ ...baseArgs, service: { url: svc.url, secret: SECRET } });
      await until(() => !!svc.seen.renderBody);
      svc.finish();
      await p;
      ids.push(svc.seen.renderBody?.renderId ?? '');
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('the waiting words are the contract voice', () => {
    expect(RENDER_WAITING_WORDS).toBe('Waiting — another video is rendering first');
  });
});

describe('renderRemotely — an aborted job is cancelled on the service', () => {
  test('aborting sends POST /_render/cancel with the same id and the bearer', async () => {
    const svc = fakeService([{ state: 'running', progress: { current: 1, total: 10 } }]);
    const controller = new AbortController();
    const pending = renderRemotely({
      ...baseArgs,
      service: { url: svc.url, secret: SECRET },
      pollMs: 15,
      signal: controller.signal,
    });
    await until(() => svc.polls() > 0);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await until(() => svc.seen.cancelled.length > 0);
    expect(svc.seen.cancelled[0]).toEqual({
      id: svc.seen.renderBody?.renderId ?? '',
      auth: `Bearer ${SECRET}`,
    });
  });
});

/**
 * A raw TCP service that drops the `/render` connection without answering (what a container that
 * stops answering mid-render looks like to the cell) and answers `/_health` + status as told.
 */
function droppingService(opts: { health?: object; status?: object }) {
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      data(socket, chunk) {
        const line = Buffer.from(chunk).toString('utf8').split('\r\n')[0] ?? '';
        const reply = (body: object | undefined) => {
          if (!body) return socket.end();
          const text = JSON.stringify(body);
          socket.write(
            `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${text.length}\r\nconnection: close\r\n\r\n${text}`
          );
          socket.end();
        };
        if (line.startsWith('POST /render ')) {
          // hold it a moment (so a status poll can answer), then drop it unanswered
          setTimeout(() => socket.end(), 80);
          return;
        }
        if (line.startsWith('GET /_health')) return reply(opts.health);
        if (line.startsWith('GET /_render/status')) return reply(opts.status);
        socket.end();
      },
    },
  });
  stops.push(() => listener.stop(true));
  return `http://127.0.0.1:${listener.port}`;
}

describe('renderRemotely — busy versus waking up', () => {
  test('nothing answers at all → waking up', async () => {
    const url = droppingService({});
    await expect(
      renderRemotely({ ...baseArgs, service: { url, secret: SECRET }, pollMs: 15 })
    ).rejects.toThrow(RENDER_WAKING_WORDS);
  });

  test('the render dropped while the service is busy with other jobs → busy, never waking up', async () => {
    const url = droppingService({ health: { ok: true, running: 1, queued: 1 } });
    const err = await renderRemotely({
      ...baseArgs,
      service: { url, secret: SECRET },
      pollMs: 1000,
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe(RENDER_BUSY_WORDS);
    expect((err as Error).message).not.toContain('waking');
  });

  test('a full service (503) says busy', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response('render service busy', { status: 503 }),
    });
    stops.push(() => server.stop(true));
    await expect(
      renderRemotely({
        ...baseArgs,
        service: { url: `http://127.0.0.1:${server.port}`, secret: SECRET },
      })
    ).rejects.toThrow(RENDER_BUSY_WORDS);
  });

  test('the service had answered for this job, then dropped it → stopped answering', async () => {
    const url = droppingService({ status: { state: 'running' } });
    const err = await renderRemotely({
      ...baseArgs,
      service: { url, secret: SECRET },
      pollMs: 10,
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe(RENDER_LOST_WORDS);
  });
});

describe('the export job — cloud lane carries the service status to the row', () => {
  test('the job shows the waiting line, then the frame progress, and ends clean', async () => {
    const svc = fakeService([
      { state: 'waiting' },
      { state: 'waiting' },
      { state: 'running', progress: { current: 45, total: 90 } },
    ]);
    const repo = mkdtempSync(join(tmpdir(), 'maude-t37-'));
    const design = join(repo, '.design');
    mkdirSync(join(design, 'ui'), { recursive: true });
    writeFileSync(
      join(design, 'ui', 'Reel.tsx'),
      [
        "import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';",
        'export default function Canvas() {',
        '  return <DesignCanvas><DCArtboard id="reel" width={1080} height={1920} /></DesignCanvas>;',
        '}',
      ].join('\n')
    );
    const saved = {
      MAUDE_WORKSPACE_MODE: process.env.MAUDE_WORKSPACE_MODE,
      MAUDE_RENDER_URL: process.env.MAUDE_RENDER_URL,
      MAUDE_RENDER_SECRET: process.env.MAUDE_RENDER_SECRET,
    };
    process.env.MAUDE_WORKSPACE_MODE = '1';
    process.env.MAUDE_RENDER_URL = svc.url;
    process.env.MAUDE_RENDER_SECRET = SECRET;
    try {
      const seenWaiting: Array<string | undefined> = [];
      const queue = createExportJobQueue(createBus(), design, { remotePollMs: 15 });
      const { id, result } = queue.enqueue({
        format: 'mp4',
        scope: 'artboard',
        options: {},
        resolve: {
          activeJson: { active: '.design/ui/Reel.tsx', selected: null },
          designRoot: design,
          repoRoot: repo,
        },
        ctx: { designRoot: design, repoRoot: repo, serverOrigin: 'http://127.0.0.1:1' },
        remoteCanvas: { origin: 'https://tenant.example', token: 'tok' },
      });
      await until(() => {
        const j = queue.get(id);
        seenWaiting.push(j?.waiting);
        return !!j?.progress;
      });
      svc.finish();
      await result;
      expect(seenWaiting).toContain(RENDER_WAITING_WORDS);
      expect(queue.get(id)?.progress).toEqual({ current: 45, total: 90 });
      expect(queue.get(id)?.waiting).toBeUndefined();
      expect(queue.get(id)?.status).toBe('done');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('renderRemotely — the bearer never follows a redirect', () => {
  /** Another origin that records every request it gets. */
  function trap() {
    const hits: Array<{ path: string; auth: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        hits.push({
          path: new URL(req.url).pathname,
          auth: req.headers.get('authorization') ?? '',
        });
        return Response.json({ state: 'running' });
      },
    });
    stops.push(() => server.stop(true));
    return { url: `http://127.0.0.1:${server.port}`, hits };
  }

  /** A service that answers the named paths with a 307 to `to`; `/render` waits for `finish()` unless redirected. */
  function redirecting(to: string, paths: string[]) {
    let finish!: () => void;
    const finished = new Promise<void>((r) => {
      finish = r;
    });
    let polls = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/_render/status') polls += 1;
        if (paths.includes(url.pathname))
          return new Response(null, { status: 307, headers: { location: `${to}${url.pathname}` } });
        if (url.pathname === '/render') {
          await Promise.race([
            finished,
            new Promise((r) => req.signal.addEventListener('abort', r)),
          ]);
          return new Response(new Uint8Array([1]), {
            headers: { 'content-type': 'video/mp4', 'x-maude-filename': 'out.mp4' },
          });
        }
        return Response.json({ ok: true });
      },
    });
    stops.push(() => server.stop(true));
    return { url: `http://127.0.0.1:${server.port}`, finish, polls: () => polls };
  }

  test('/render answering a redirect fails the job; nothing reaches the other origin', async () => {
    const t = trap();
    const svc = redirecting(t.url, ['/render']);
    await expect(
      renderRemotely({ ...baseArgs, service: { url: svc.url, secret: SECRET }, pollMs: 10_000 })
    ).rejects.toThrow();
    expect(t.hits).toEqual([]);
  });

  test('/_render/status and /_render/cancel never follow a redirect', async () => {
    const t = trap();
    const svc = redirecting(t.url, ['/_render/status', '/_render/cancel']);
    const controller = new AbortController();
    const pending = renderRemotely({
      ...baseArgs,
      service: { url: svc.url, secret: SECRET },
      pollMs: 15,
      signal: controller.signal,
    });
    await until(() => svc.polls() > 2);
    controller.abort();
    await expect(pending).rejects.toThrow();
    await Bun.sleep(100);
    expect(t.hits).toEqual([]);
  });
});
