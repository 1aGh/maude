// V2-3.6 N-M2 (b) — the interactive canvas origin refuses a top-level document
// load (so it can never be a window's top frame, where an inline script would
// run with Tauri IPC present before the native guard bounces it), while canvas
// IFRAMES, headless captures and the bg-remove harness keep working.
import { afterAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasTopLevelRefusal, isTopLevelDocument } from '../canvas-top-level.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:5555${path}`, { headers });
const DOC = { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' };
const IFRAME = { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' };

describe('canvasTopLevelRefusal (pure)', () => {
  test('a top-level document is refused with an inert, script-free 403', async () => {
    for (const path of ['/_canvas-shell.html?canvas=ui/x.tsx', '/ui/logo.svg', '/_health', '/']) {
      const r = canvasTopLevelRefusal(req(path, DOC));
      expect(r?.status).toBe(403);
      expect(r?.headers.get('content-security-policy')).toContain('sandbox');
      expect(r?.headers.get('content-type')).toStartWith('text/plain');
      expect(await r?.text()).not.toContain('<script');
    }
  });

  test('iframes, sub-resources and non-browser clients pass', () => {
    expect(canvasTopLevelRefusal(req('/_canvas-shell.html?canvas=ui/x.tsx', IFRAME))).toBeNull();
    expect(canvasTopLevelRefusal(req('/ui/x.tsx', { 'sec-fetch-dest': 'script' }))).toBeNull();
    expect(canvasTopLevelRefusal(req('/_ws', { 'sec-fetch-mode': 'websocket' }))).toBeNull();
    expect(canvasTopLevelRefusal(req('/_canvas-shell.html?canvas=ui/x.tsx'))).toBeNull();
  });

  test('partial metadata: navigate mode without a dest counts as top-level', () => {
    expect(isTopLevelDocument(req('/', { 'sec-fetch-mode': 'navigate' }))).toBe(true);
    expect(isTopLevelDocument(req('/', { 'Sec-Fetch-Dest': 'DOCUMENT' }))).toBe(true);
  });

  test('only the exact bg-remove harness shape is exempt', () => {
    const ok = '/_canvas-shell.html?canvas=_photo/hero-1.bgremove.tsx';
    expect(canvasTopLevelRefusal(req(ok, DOC))).toBeNull();
    for (const bad of [
      `${ok}&designRel=ui`, // an extra parameter could re-point the module
      '/_canvas-shell.html?canvas=_photo/../ui/evil.bgremove.tsx',
      '/_canvas-shell.html?canvas=_draw/x.proof.tsx', // proofs render on the capture origin
      '/_canvas-shell.html?canvas=ui/x.bgremove.tsx',
      '/_photo/hero-1.bgremove.tsx',
    ]) {
      expect(canvasTopLevelRefusal(req(bad, DOC))?.status).toBe(403);
    }
  });
});

describe('the canvas listener applies it (boot)', () => {
  const procs: Array<ReturnType<typeof Bun.spawn>> = [];
  afterAll(async () => {
    for (const p of procs) await killProc(p);
  });

  test('canvas origin: document 403, iframe 200; capture origin: document still renders', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), 'export default () => null;\n');
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    procs.push(proc);
    const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
    const canvas = info.canvasOrigin as string;
    const shell = '/_canvas-shell.html?canvas=ui/Probe.tsx';

    const top = await fetch(`${canvas}${shell}`, { headers: DOC });
    expect(top.status).toBe(403);
    expect(await top.text()).not.toContain('<script');
    // the routes table is gated too (Bun matches `routes` before `fetch`)
    expect((await fetch(`${canvas}/_health`, { headers: DOC })).status).toBe(403);

    const framed = await fetch(`${canvas}${shell}`, { headers: IFRAME });
    expect(framed.status).toBe(200);
    expect(await framed.text()).toContain('<script');
    expect((await fetch(`${canvas}/_health`)).status).toBe(200);

    const redirect = await fetch(`http://localhost:${port}${shell}`, { redirect: 'manual' });
    const capture = new URL(redirect.headers.get('location') ?? '').origin;
    const cap = await fetch(`${capture}${shell}`, { headers: DOC });
    expect(cap.status).toBe(200);
  });
});
