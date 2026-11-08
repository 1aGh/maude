// #128 cloud comments 2–3 (T3.7, decision maude/burndown-d7-cloud-render-budget): the render
// service renders cloud video at scale 1 with JPEG intermediate frames, runs ONE video job at a
// time with a queue of one behind it, reports progress, and lets the job's own cell cancel it.
//
// The service is driven with a fake adapter runner and a fake canvas proxy: it must stay importable
// without the studio's exporters (render-deploy.yml runs `bun test apps/render/test` with only the
// Worker's own deps installed).

import { describe, expect, test } from 'bun:test';

import { cloudRenderOptions, createRenderService, type RunAdapter } from '../service.ts';

const SECRET = 'test-bearer';
const ORIGIN = 'https://canvas-a.example.test';

interface Call {
  format: string;
  options: Record<string, unknown>;
  signal?: AbortSignal;
  progress?: (p: { current: number; total: number }) => void;
  finish: () => void;
  aborted: Promise<void>;
}

/** A runner whose renders stay open until the test finishes (or the signal aborts) them. */
function fakeRunner() {
  const calls: Call[] = [];
  let notify: (() => void) | null = null;
  const run: RunAdapter = (format, _targets, options, _ctx, hooks) =>
    new Promise((resolve, reject) => {
      let abortedResolve!: () => void;
      const aborted = new Promise<void>((r) => {
        abortedResolve = r;
      });
      const call: Call = {
        format,
        options,
        signal: hooks.signal,
        progress: hooks.onProgress,
        aborted,
        finish: () =>
          resolve({
            filename: `out.${format}`,
            contentType: 'application/octet-stream',
            body: new Uint8Array([1, 2, 3]),
          }),
      };
      hooks.signal?.addEventListener('abort', () => {
        abortedResolve();
        reject(new Error('aborted'));
      });
      calls.push(call);
      notify?.();
    });
  const nth = async (n: number): Promise<Call> => {
    const deadline = Date.now() + 2000;
    while (calls.length <= n) {
      if (Date.now() > deadline) throw new Error(`render ${n} never started`);
      await new Promise<void>((r) => {
        notify = r;
        setTimeout(r, 20);
      });
    }
    return calls[n] as Call;
  };
  return { run, calls, nth };
}

function service(run: RunAdapter) {
  return createRenderService({
    secret: SECRET,
    allowedOrigins: [ORIGIN],
    run,
    rejectFormat: () => null,
    startProxy: () => ({ origin: 'http://127.0.0.1:1', stop() {}, log: () => '' }),
  });
}

const auth = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };

function renderReq(format: string, renderId?: string, options: Record<string, unknown> = {}) {
  return new Request('http://render/render', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      format,
      targets: [{ kind: 'element', file: 'a.tsx' }],
      options,
      canvas: { origin: ORIGIN },
      ...(renderId ? { renderId } : {}),
    }),
  });
}

const statusReq = (id: string, headers: Record<string, string> = auth) =>
  new Request(`http://render/_render/status?id=${encodeURIComponent(id)}`, { headers });
const cancelReq = (id: string, headers: Record<string, string> = auth) =>
  new Request('http://render/_render/cancel', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id }),
  });

const ID_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ID_C = 'cccccccccccccccccccccccc';

async function statusOf(svc: ReturnType<typeof service>, id: string) {
  const r = await svc.fetch(statusReq(id));
  return { code: r.status, body: r.status === 200 ? await r.json() : null };
}

describe('cloud render budget — scale 1 and JPEG frames', () => {
  test('a video renders at scale 1 with JPEG intermediates, whatever was asked', () => {
    expect(cloudRenderOptions('mp4', { scale: 2, fps: 30 })).toEqual({
      scale: 1,
      fps: 30,
      frameFormat: 'jpeg',
    });
    expect(cloudRenderOptions('webm', {})).toEqual({ scale: 1, frameFormat: 'jpeg' });
  });

  test('a GIF renders at scale 1 but keeps PNG frames (its palette already loses precision)', () => {
    expect(cloudRenderOptions('gif', { scale: 3 })).toEqual({ scale: 1 });
  });

  test('images and documents are untouched', () => {
    expect(cloudRenderOptions('png', { scale: 2 })).toEqual({ scale: 2 });
    expect(cloudRenderOptions('pdf', { dpi: 300 })).toEqual({ dpi: 300 });
  });

  test('the service hands the adapter the cloud options', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const pending = svc.fetch(renderReq('mp4', ID_A, { scale: 2 }));
    const call = await f.nth(0);
    expect(call.options.scale).toBe(1);
    expect(call.options.frameFormat).toBe('jpeg');
    call.finish();
    expect((await pending).status).toBe(200);
  });
});

describe('one video job at a time, a queue of one behind it', () => {
  test('a second mp4 waits with a waiting status; a third is refused as busy', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const first = await f.nth(0);
    const b = svc.fetch(renderReq('mp4', ID_B));
    await Bun.sleep(30);
    expect(f.calls.length).toBe(1); // B did not start beside A
    expect((await statusOf(svc, ID_A)).body).toMatchObject({ state: 'running' });
    expect((await statusOf(svc, ID_B)).body).toMatchObject({ state: 'waiting' });

    const c = await svc.fetch(renderReq('mp4', ID_C));
    expect(c.status).toBe(503);
    expect(await c.text()).toContain('busy');

    first.finish();
    expect((await a).status).toBe(200);
    const second = await f.nth(1);
    expect((await statusOf(svc, ID_B)).body).toMatchObject({ state: 'running' });
    second.finish();
    expect((await b).status).toBe(200);
    expect((await statusOf(svc, ID_B)).code).toBe(404); // finished jobs are forgotten
  });

  test('an image does not wait behind a video', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const v = svc.fetch(renderReq('mp4', ID_A));
    const video = await f.nth(0);
    const p = svc.fetch(renderReq('png', ID_B));
    const png = await f.nth(1);
    png.finish();
    expect((await p).status).toBe(200);
    video.finish();
    expect((await v).status).toBe(200);
  });
});

describe('progress', () => {
  test("the adapter's frame progress is the job's status", async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const call = await f.nth(0);
    call.progress?.({ current: 12, total: 90 });
    expect((await statusOf(svc, ID_A)).body).toEqual({
      state: 'running',
      progress: { current: 12, total: 90 },
    });
    call.finish();
    await a;
  });
});

describe('POST /_render/cancel', () => {
  test('cancel stops a running job and frees the slot for the waiting one', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const first = await f.nth(0);
    const b = svc.fetch(renderReq('mp4', ID_B));
    await Bun.sleep(20);

    const r = await svc.fetch(cancelReq(ID_A));
    expect(r.status).toBe(200);
    await first.aborted; // the adapter's signal fired
    const ra = await a;
    expect(ra.status).toBe(409);
    expect(await ra.text()).toContain('cancelled');

    const second = await f.nth(1); // B took the freed slot
    second.finish();
    expect((await b).status).toBe(200);
  });

  test('cancelling a waiting job removes it from the queue without rendering it', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const first = await f.nth(0);
    const b = svc.fetch(renderReq('mp4', ID_B));
    await Bun.sleep(20);
    expect((await svc.fetch(cancelReq(ID_B))).status).toBe(200);
    expect((await b).status).toBe(409);
    // the queue of one is free again: another video may wait
    const c = svc.fetch(renderReq('mp4', ID_C));
    await Bun.sleep(20);
    expect((await statusOf(svc, ID_C)).body).toMatchObject({ state: 'waiting' });
    first.finish();
    await a;
    (await f.nth(1)).finish();
    expect((await c).status).toBe(200);
    expect(f.calls.length).toBe(2); // B never rendered
  });

  test('status and cancel need the bearer, and only the job id its cell chose finds the job', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const call = await f.nth(0);
    const noAuth = { 'content-type': 'application/json' };
    expect((await svc.fetch(cancelReq(ID_A, noAuth))).status).toBe(401);
    expect((await svc.fetch(statusReq(ID_A, noAuth))).status).toBe(401);
    expect((await svc.fetch(cancelReq(ID_B))).status).toBe(404);
    expect(call.signal?.aborted).toBe(false);
    call.finish();
    expect((await a).status).toBe(200);
  });

  test('a job id that is not a long random handle is refused, and one already in use too', async () => {
    const f = fakeRunner();
    const svc = service(f.run);
    expect((await svc.fetch(renderReq('mp4', 'short'))).status).toBe(400);
    const a = svc.fetch(renderReq('mp4', ID_A));
    const call = await f.nth(0);
    expect((await svc.fetch(renderReq('png', ID_A))).status).toBe(409);
    call.finish();
    await a;
  });
});
