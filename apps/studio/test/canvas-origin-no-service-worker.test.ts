// #168 T5.4 S1 — no canvas installs a service worker. Under the canvas CSP `worker-src` falls
// back to `script-src 'self'`, so without a refusal a canvas could register a worker that
// outlives its frame and answers the next frame's requests on the shared canvas origin. The
// browser marks the worker script fetch with `Service-Worker: script`; the interactive canvas
// listener refuses it like the capture listener does — through the route table AND the fetch
// fall-through (Bun matches `routes` first).
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SW = { 'service-worker': 'script', 'sec-fetch-dest': 'serviceworker' };

describe('the canvas listener installs no service workers (boot)', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  afterAll(async () => {
    for (const p of procs) await killProc(p);
  });

  test('canvas origin: a worker script fetch is 403 on a module and on a route; capture stays 403', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), 'export default () => null;\n');
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    procs.push(proc);
    const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
    const canvas = info.canvasOrigin as string;
    expect(canvas).toBeTruthy();

    // the frame's capability, as the main origin's 307 hands it out
    const redirect = await fetch(
      `http://localhost:${port}/_canvas-shell.html?canvas=ui/Probe.tsx&hide-chrome=1`,
      { redirect: 'manual' }
    );
    const capture = new URL(redirect.headers.get('location') ?? '');
    const fc = capture.searchParams.get('fc') ?? '';
    const framed = (p: string) => `${p}${p.includes('?') ? '&' : '?'}fc=${encodeURIComponent(fc)}`;

    // the fetch fall-through (a canvas module) and the route table (`/_health`)
    for (const p of [
      framed('/.design/ui/Probe.tsx'),
      '/_health',
      framed('/_canvas-runtime/react.js'),
    ]) {
      const r = await fetch(`${canvas}${p}`, { headers: SW });
      expect(`${p} ${r.status}`).toBe(`${p} 403`);
      expect(await r.text()).toContain('service worker');
    }
    // the same requests without the worker marker still serve
    expect((await fetch(`${canvas}/_health`)).status).toBe(200);
    expect((await fetch(`${canvas}${framed('/.design/ui/Probe.tsx')}`)).status).toBe(200);

    // the capture listener keeps its own refusal
    const cap = await fetch(`${capture.origin}${framed('/.design/ui/Probe.tsx')}`, {
      headers: SW,
    });
    expect(cap.status).toBe(403);
  });
});
