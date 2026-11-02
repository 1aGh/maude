// V2-3.6 NEW-1 — a studio port holds BOTH loopback families, so a same-user
// `[::1]:<port>` listener can never answer the `http://localhost:<port>` origin
// a project window trusts (WebKit resolves `localhost` to ::1 first).
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listenLoopback, V4_LOOPBACK, V6_LOOPBACK } from '../loopback-listen.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const serve = (tag: string) => (hostname: string, port: number) =>
  Bun.serve({ hostname, port, fetch: () => new Response(`${tag}@${hostname}`) });

async function textOf(url: string): Promise<string | null> {
  try {
    return await (await fetch(url, { signal: AbortSignal.timeout(1000) })).text();
  } catch {
    return null;
  }
}

describe('listenLoopback', () => {
  test('binds 127.0.0.1 and [::1] on the same port; stop() releases both', async () => {
    const s = listenLoopback(serve('ours'), 0);
    const port = s.port as number;
    expect(await textOf(`http://127.0.0.1:${port}/`)).toBe(`ours@${V4_LOOPBACK}`);
    expect(await textOf(`http://[::1]:${port}/`)).toBe(`ours@${V6_LOOPBACK}`);
    // `localhost` resolves to ::1 first — the twin, i.e. still ours.
    expect(await textOf(`http://localhost:${port}/`)).toStartWith('ours@');
    s.stop(true);
    expect(await textOf(`http://127.0.0.1:${port}/`)).toBeNull();
    expect(await textOf(`http://[::1]:${port}/`)).toBeNull();
  });

  test('a squatted [::1]:<port> is a hard EADDRINUSE and leaves IPv4 unbound', async () => {
    const squat = Bun.serve({ hostname: V6_LOOPBACK, port: 0, fetch: () => new Response('squat') });
    const port = squat.port as number;
    try {
      let err: (Error & { code?: string }) | null = null;
      try {
        listenLoopback(serve('ours'), port);
      } catch (e) {
        err = e as Error & { code?: string };
      }
      expect(err?.code).toBe('EADDRINUSE');
      expect(err?.message).toContain(`[::1]:${port}`);
      // the IPv4 half was given back, not left serving a half-trusted origin
      expect(await textOf(`http://127.0.0.1:${port}/`)).toBeNull();
    } finally {
      squat.stop(true);
    }
  });

  test('port 0 re-rolls when the assigned port has its ::1 twin taken', () => {
    let calls = 0;
    const fake = (hostname: string, port: number) => {
      calls++;
      if (hostname === V6_LOOPBACK && calls < 4) throw new Error('in use');
      return { port: port || 40000 + calls, stop: () => undefined };
    };
    const s = listenLoopback(fake, 0, { v6: () => true });
    expect(s.port).toBe(40003);
    expect(calls).toBe(4);
  });

  test('a host with no IPv6 loopback serves IPv4 alone (nothing can squat ::1)', () => {
    const fake = (hostname: string, port: number) => {
      if (hostname === V6_LOOPBACK) throw new Error('no ::1');
      return { port: port || 41000, stop: () => undefined };
    };
    expect(listenLoopback(fake, 0, { v6: () => false }).port).toBe(41000);
  });
});

describe('studio boot holds [::1] on every localhost listener (V2-3.6 NEW-1)', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  afterAll(async () => {
    for (const p of procs) await killProc(p);
  });

  test('main, canvas and capture ports answer on [::1] with OUR server', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    procs.push(proc);
    const health = JSON.parse((await textOf(`http://[::1]:${port}/_health`)) ?? '{}');
    expect(health.pid).toBe(proc.pid);
    const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
    const canvasPort = Number(new URL(info.canvasOrigin).port);
    // the canvas origin refuses a non-allowlisted path with ITS 403 on both families — asked
    // from inside a frame (gate-b-c4: a frame-less request gets the frame gate's not-in-scope)
    const fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/x.tsx');
    for (const host of ['127.0.0.1', '[::1]']) {
      const r = await fetch(withFc(`http://${host}:${canvasPort}/not-canvas-safe`, fc));
      expect(r.status).toBe(403);
      expect(await r.text()).toContain('canvas origin');
      const bare = await fetch(`http://${host}:${canvasPort}/not-canvas-safe`);
      expect(bare.status).toBe(403);
      expect(await bare.text()).toContain('not-in-scope');
    }
    // capture origin: reached through the main origin's 307, then over ::1
    const r = await fetch(`http://[::1]:${port}/_canvas-shell.html?canvas=ui/x.tsx`, {
      redirect: 'manual',
    });
    expect(r.status).toBe(307);
    const capturePort = Number(new URL(r.headers.get('location') ?? '').port);
    const w = await fetch(`http://[::1]:${capturePort}/_canvas-shell.html`, { method: 'POST' });
    expect(w.status).toBe(405); // the capture gate, i.e. our listener
  });

  test('boot fails rather than serve localhost on IPv4 only when [::1]:<port> is taken', async () => {
    const squat = Bun.serve({ hostname: V6_LOOPBACK, port: 0, fetch: () => new Response('squat') });
    const port = squat.port as number;
    const { root } = makeSandbox();
    const proc = Bun.spawn({
      cmd: [
        'bun',
        'run',
        join(import.meta.dir, '..', 'server.ts'),
        '--port',
        String(port),
        '--root',
        root,
      ],
      cwd: join(import.meta.dir, '..'),
      env: { ...process.env, NO_OPEN: '1', NODE_ENV: 'test', MAUDE_NO_AUTOBUILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    procs.push(proc);
    try {
      const code = await Promise.race([proc.exited, Bun.sleep(15000).then(() => 'timeout')]);
      expect(code).not.toBe('timeout');
      expect(code).not.toBe(0);
      expect(await textOf(`http://127.0.0.1:${port}/_health`)).toBeNull();
    } finally {
      squat.stop(true);
    }
  });
});
