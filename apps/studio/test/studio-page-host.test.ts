// 2.0.7 — the studio page is served on the canvas origin's site (studio-page-host.ts).
//
// WebKit cuts a cross-site frame's Referer to the bare origin, so with the studio on 127.0.0.1 and
// the canvas frames on localhost every picture lost its frame capability (403, "Picture not
// found"). A browser navigation to the page on a loopback IP literal goes to localhost instead;
// the canvas origin's capability check is unchanged (a picture with no capability stays refused).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { studioPageHostRedirect } from '../studio-page-host.ts';
import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const NAV = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
const MAIN = 'http://localhost:4399 http://127.0.0.1:4399';
const CANVAS = 'http://localhost:4400';
const req = (url: string, headers: Record<string, string> = NAV, method = 'GET') =>
  new Request(url, { headers, method });

describe('studioPageHostRedirect', () => {
  test('a navigation on 127.0.0.1 or [::1] goes to the same port on localhost, path and query kept', () => {
    for (const host of ['127.0.0.1', '[::1]']) {
      const r = studioPageHostRedirect(req(`http://${host}:4399/?open=ui%2FA.tsx&x=1`), {
        canvasOrigin: CANVAS,
        mainOrigin: `${MAIN} http://[::1]:4399`,
        workspace: false,
      });
      expect(r?.status).toBe(307);
      expect(r?.headers.get('location')).toBe('http://localhost:4399/?open=ui%2FA.tsx&x=1');
      expect(r?.headers.get('cache-control')).toBe('no-store');
    }
    const idx = studioPageHostRedirect(req('http://127.0.0.1:4399/index.html'), {
      canvasOrigin: CANVAS,
      mainOrigin: MAIN,
      workspace: false,
    });
    expect(idx?.headers.get('location')).toBe('http://localhost:4399/index.html');
  });

  test('nothing else is redirected', () => {
    const base = { canvasOrigin: CANVAS, mainOrigin: MAIN, workspace: false };
    // already on localhost
    expect(studioPageHostRedirect(req('http://localhost:4399/'), base)).toBeNull();
    // not a browser navigation: a fetch, a frame, a CLI without Fetch Metadata, a POST
    expect(studioPageHostRedirect(req('http://127.0.0.1:4399/', {}), base)).toBeNull();
    expect(
      studioPageHostRedirect(
        req('http://127.0.0.1:4399/', { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' }),
        base
      )
    ).toBeNull();
    expect(
      studioPageHostRedirect(
        req('http://127.0.0.1:4399/', { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }),
        base
      )
    ).toBeNull();
    expect(studioPageHostRedirect(req('http://127.0.0.1:4399/', NAV, 'POST'), base)).toBeNull();
    // a port this studio does not serve on
    expect(studioPageHostRedirect(req('http://127.0.0.1:5555/'), base)).toBeNull();
    // the split off, a workspace, a canvas origin that is not localhost
    expect(
      studioPageHostRedirect(req('http://127.0.0.1:4399/'), { ...base, canvasOrigin: undefined })
    ).toBeNull();
    expect(
      studioPageHostRedirect(req('http://127.0.0.1:4399/'), { ...base, workspace: true })
    ).toBeNull();
    expect(
      studioPageHostRedirect(req('http://127.0.0.1:4399/'), {
        ...base,
        canvasOrigin: 'https://canvas.acme.com',
      })
    ).toBeNull();
  });
});

async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('a booted studio', () => {
  test('sends a 127.0.0.1 page navigation to localhost; pictures still need the capability', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    mkdirSync(join(designRoot, 'assets'), { recursive: true });
    writeFileSync(
      join(designRoot, 'ui', 'A.tsx'),
      `import { DesignCanvas } from '@maude/canvas-lib';\nexport default function A(){return <DesignCanvas><img src="/.design/assets/pic.png"/></DesignCanvas>}\n`
    );
    writeFileSync(
      join(designRoot, 'assets', 'pic.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
    );
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_CANVAS_ORIGIN_SPLIT: '1' });
    try {
      const canvas = await readCanvasOrigin(designRoot);
      expect(new URL(canvas).hostname).toBe('localhost');

      // The browser's own navigation on 127.0.0.1 → the same page on localhost.
      for (const path of ['/', '/?open=ui%2FA.tsx', '/index.html']) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          headers: NAV,
          redirect: 'manual',
        });
        expect(res.status).toBe(307);
        expect(res.headers.get('location')).toBe(`http://localhost:${port}${path}`);
      }
      // On localhost, and for anything that is not a navigation, the page is served as before.
      const local = await fetch(`http://localhost:${port}/`, { headers: NAV, redirect: 'manual' });
      expect(local.status).toBe(200);
      const plain = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
      expect(plain.status).toBe(200);
      const health = await fetch(`http://127.0.0.1:${port}/_health`, {
        headers: NAV,
        redirect: 'manual',
      });
      expect(health.status).toBe(200);

      // C4 unchanged: a picture whose Referer is the bare canvas origin (what WebKit sends from a
      // cross-site frame) is refused; the same picture with the frame's capability is served.
      const pic = `${canvas}/.design/assets/pic.png`;
      const bare = await fetch(pic, { headers: { referer: `${canvas}/` } });
      expect(bare.status).toBe(403);
      const fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/A.tsx');
      const shellUrl = withFc(`${canvas}/_canvas-shell.html?canvas=ui%2FA.tsx`, fc);
      const capped = await fetch(pic, { headers: { referer: shellUrl } });
      expect(capped.status).toBe(200);
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
