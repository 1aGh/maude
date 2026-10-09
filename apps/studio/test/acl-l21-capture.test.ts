// V2-2.8 S9 (V2-1.16 L21) — a capture never runs tenant canvas code on the MAIN origin.
//
// Export and screenshot captures used to load `/_canvas-shell.html` from the
// MAIN origin (`exporters/index.ts` `canvasShellUrl` with `ctx.serverOrigin`;
// `maude design screenshot` and the other headless helpers the same way, with no
// CSP at all). The canvas is untrusted code (DDR-054). On the main origin it is
// same-origin with every privileged route, so its requests pass
// `sameOriginWrite` + `isTrustedRequestHost`: planted code in a synced canvas
// could, while its owner exported it, change settings, read the project index
// and write files — `cspForCapture`'s `connect-src 'self'` IS the main origin.
// The probe from the V2-1.17 spike: a main-origin capture got `ui-prefs 200`.
//
// Fix (decision:maude/v2-2.8-read-only-capture-origin): while the origin split
// is on, the main origin answers the canvas shell — for every canvas the
// canvas origin can serve — with a 307 to a CAPTURE origin: a loopback
// listener that serves the one canvas-safe route table (`isCanvasSafeRoute` /
// CANVAS_SAFE_API, no third allowlist), GET/HEAD only, no WebSocket upgrades,
// under the strict canvas CSP the render worker already captures with
// (DDR-232). Every capture caller follows the redirect, so none of them
// changed. Maude's own local harnesses under runtime dirs (`_draw/`,
// `_photo/`), which the canvas-safe table refuses, stay on the main origin (a
// named residual).
//
// The tests below:
//   1. the main origin redirects every canvas-shell request for a canvas-safe
//      canvas, query intact; traversal cannot pick the main origin;
//   2. the capture origin refuses every write method (405), privileged GETs
//      (403 at the gate) and upgrades, serves canvas-safe reads, and carries
//      the strict CSP;
//   3. THE PROBE: a real PNG export of a canvas whose code tries a privileged
//      write, a canvas-safe write and a privileged read — none lands; the
//      export still succeeds;
//   4. parity: a static fixture exported through the capture origin has the
//      same pixels as the legacy main-origin capture (split off = the exact
//      pre-fix capture path).

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const PROBE_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

// Runs at module evaluation, BEFORE the canvas mounts — so the capture cannot
// finish until every probe request has been answered.
const out: Record<string, string> = {};
async function probe(name: string, path: string, init?: RequestInit) {
  try {
    const r = await fetch(path, init);
    out[name] = String(r.status);
  } catch {
    out[name] = "blocked";
  }
}
await Promise.all([
  probe("prefsWrite", "/_api/ui-prefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ theme: "dark" }),
  }),
  probe("metaWrite", "/_api/canvas-meta", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file: ".design/ui/Probe.tsx",
      patch: { layout: { artboards: [{ id: "probe", x: 7777, y: 7777 }] } },
    }),
  }),
  probe("indexRead", "/_index-data"),
]);

export default function Probe() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Probe">
        <DCArtboard id="probe" label="Probe" width={200} height={120}>
          <div style={{ background: "#204060", height: "100%" }} data-probe={JSON.stringify(out)} />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const STATIC_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

export default function Static() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="Static">
        <DCArtboard id="board" label="Board" width={320} height={200}>
          <div style={{ height: "100%", background: "linear-gradient(135deg,#1c2340,#3a1f47)", padding: 24 }}>
            <div style={{ width: 120, height: 60, background: "#e4572e", borderRadius: 10 }} />
            <div style={{ marginTop: 16, width: 200, height: 20, background: "#f2efe6" }} />
          </div>
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;

const BASE_ENV = { MAUDE_NO_AUTOBUILD: '1' };

async function captureOriginOf(port: number): Promise<string> {
  const r = await fetch(`http://localhost:${port}/_canvas-shell.html?canvas=ui/Probe.tsx`, {
    redirect: 'manual',
  });
  expect(r.status).toBe(307);
  const loc = r.headers.get('location') ?? '';
  return new URL(loc).origin;
}

async function exportPng(port: number, canvasFile: string): Promise<Uint8Array> {
  const r = await fetch(`http://localhost:${port}/_api/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ format: 'png', scope: 'canvas-whole', options: { canvasFile } }),
  });
  const body = new Uint8Array(await r.arrayBuffer());
  if (r.status !== 200) throw new Error(`export ${r.status}: ${new TextDecoder().decode(body)}`);
  return body;
}

/** Does a WebSocket upgrade OPEN? Resolves true on open, false on error/close. */
function upgradeOpens(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const done = (v: boolean) => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(v);
    };
    ws.addEventListener('open', () => done(true));
    ws.addEventListener('error', () => done(false));
    ws.addEventListener('close', () => done(false));
    setTimeout(() => done(false), 3000);
  });
}

describe('captures render on the read-only capture origin (V2-2.8 S9, V2-1.16 L21)', () => {
  test('the main origin redirects every canvas-shell request to the capture origin', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), PROBE_TSX);
    const port = nextPort();
    const proc = await bootServer(root, port, BASE_ENV);
    try {
      const capture = await captureOriginOf(port);
      expect(capture).not.toBe(`http://localhost:${port}`);
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      // A separate origin from the interactive canvas origin as well.
      expect(capture).not.toBe(info.canvasOrigin);

      for (const path of [
        '/_canvas-shell.html?canvas=ui%2FProbe.tsx&hide-chrome=1&tokens=system%2Fx.css', // ⌘E export
        '/_canvas-shell.html?canvas=ui/Probe.tsx', // maude design screenshot / smoke / perf
        '/_canvas-shell?canvas=ui/Probe.tsx',
      ]) {
        const r = await fetch(`http://localhost:${port}${path}`, { redirect: 'manual' });
        expect(r.status).toBe(307);
        const loc = new URL(r.headers.get('location') ?? '');
        expect(loc.origin).toBe(capture);
        expect(loc.pathname).toBe('/_canvas-shell.html');
        expect(loc.search).toBe(new URL(`http://x${path}`).search);
      }

      // A path traversal in `canvas=` cannot pick the main origin for a
      // canvas-group file: it is normalised before the decision.
      const sneaky = await fetch(
        `http://localhost:${port}/_canvas-shell.html?canvas=_draw/../ui/Probe.tsx`,
        { redirect: 'manual' }
      );
      expect(sneaky.status).toBe(307);

      // Named residual: Maude's OWN local harnesses under DDR-115 runtime dirs
      // (`maude design draw-proof` → `_draw/`, `photo-bg-remove` → `_photo/`)
      // are refused by the canvas-safe table, so they keep rendering on the
      // main origin exactly as before. They are generated on this machine and
      // never synced.
      const harness = await fetch(
        `http://localhost:${port}/_canvas-shell.html?canvas=_draw/mark.proof.tsx`,
        { redirect: 'manual' }
      );
      expect(harness.status).toBe(200);
    } finally {
      await killProc(proc);
    }
  }, 30_000);

  test('the capture origin: no writes, no privileged reads, no upgrades, strict CSP', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), PROBE_TSX);
    const port = nextPort();
    const proc = await bootServer(root, port, BASE_ENV);
    try {
      const capture = await captureOriginOf(port);
      const at = (p: string, init?: RequestInit) =>
        fetch(`${capture}${p}`, { ...init, signal: AbortSignal.timeout(5000) });

      // Every write method on every canvas-safe route (and on a privileged one).
      for (const route of [
        '/_api/canvas-meta',
        '/_api/annotations',
        '/_api/annotations/ops',
        '/_api/asset',
        '/_api/asset/chunk-start',
        '/_api/asset/chunk',
        '/_api/asset/chunk-finish',
        '/_api/photo-edit',
        '/_api/git-committers',
        '/_api/ai',
        '/_comments',
        '/_api/comments/abc123/reply',
        '/_api/ui-prefs',
        '/_api/git/push',
      ]) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const r = await at(route, { method, body: '{}' });
          expect(`${method} ${route} ${r.status}`).toBe(`${method} ${route} 405`);
        }
      }

      // Privileged GETs are refused at the canvas-safe gate.
      for (const p of [
        '/_api/ui-prefs',
        '/_api/git/log',
        '/_api/git/diff?sha=HEAD',
        '/_config',
        '/_index-data',
        '/_comments-all',
        '/_api/export-jobs',
      ]) {
        const r = await at(p);
        expect(`${p} ${r.status}`).toBe(`${p} 403`);
      }

      // Canvas-safe reads still serve (the capture must render).
      expect((await at('/.design/ui/Probe.tsx')).status).toBe(200);
      expect((await at('/_api/canvas-meta?file=.design/ui/Probe.tsx')).status).toBe(200);

      // The shell carries the STRICT canvas CSP — not the permissive capture CSP.
      const shell = await at('/_canvas-shell.html?canvas=ui/Probe.tsx&hide-chrome=1');
      expect(shell.status).toBe(200);
      const csp = shell.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self' 'sha256-");
      expect(csp).not.toContain("'unsafe-eval'");
      expect(csp).not.toContain("'unsafe-inline' 'unsafe-eval'");

      // No upgrades: neither the collab room nor the HMR feed opens here…
      const wsCapture = capture.replace(/^http/, 'ws');
      expect(await upgradeOpens(`${wsCapture}/_ws/collab/ui-probe`)).toBe(false);
      expect(await upgradeOpens(`${wsCapture}/_ws`)).toBe(false);
      // …while the interactive canvas origin's collab room still does (control).
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      const wsCanvas = String(info.canvasOrigin).replace(/^http/, 'ws');
      expect(await upgradeOpens(`${wsCanvas}/_ws/collab/ui-probe`)).toBe(true);
    } finally {
      await killProc(proc);
    }
  }, 60_000);

  test('THE PROBE: a planted canvas exported as PNG reaches no privileged route and writes nothing', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), PROBE_TSX);
    const prefs = join(root, 'prefs.json');
    writeFileSync(prefs, `${JSON.stringify({ theme: 'light' })}\n`);
    const port = nextPort();
    const proc = await bootServer(root, port, { ...BASE_ENV, MAUDE_UI_PREFS_PATH: prefs });
    try {
      const png = await exportPng(port, '.design/ui/Probe.tsx');
      // A real PNG came back — the capture itself still works.
      expect(Array.from(png.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);

      // The privileged write (main-origin settings) did not land.
      expect(JSON.parse(readFileSync(prefs, 'utf8')).theme).toBe('light');
      // The canvas-safe write (layout lane) did not land either: read-only.
      const meta = join(designRoot, 'ui', 'Probe.meta.json');
      expect(existsSync(meta) ? readFileSync(meta, 'utf8') : '').not.toContain('7777');
    } finally {
      await killProc(proc);
    }
  }, 120_000);

  test('parity: the capture origin exports the same pixels as the main-origin capture', async () => {
    const pngFor = async (env: Record<string, string>) => {
      const { root, designRoot } = makeSandbox();
      writeFileSync(join(designRoot, 'ui', 'Static.tsx'), STATIC_TSX);
      const port = nextPort();
      const proc = await bootServer(root, port, { ...BASE_ENV, ...env });
      try {
        return await exportPng(port, '.design/ui/Static.tsx');
      } finally {
        await killProc(proc);
      }
    };
    // Split OFF has no canvas origin, so its capture still runs on the main
    // origin under `cspForCapture` — byte-for-byte the pre-fix capture path.
    const before = await pngFor({ MAUDE_CANVAS_ORIGIN_SPLIT: '0' });
    const after = await pngFor({});
    if (Buffer.from(before).equals(Buffer.from(after))) return; // identical bytes

    const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
      launchChromium: () => Promise<{
        newContext: () => Promise<{ newPage: () => Promise<unknown> }>;
        close: () => Promise<void>;
      }>;
    };
    const browser = await launchChromium();
    try {
      // biome-ignore lint/suspicious/noExplicitAny: playwright page surface
      const page: any = await (await browser.newContext()).newPage();
      const verdict = await page.evaluate(
        async ([a, b]: [string, string]) => {
          const load = (src: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error('decode failed'));
              img.src = src;
            });
          const [ia, ib] = await Promise.all([load(a), load(b)]);
          const W = ia.naturalWidth;
          const H = ia.naturalHeight;
          const px = (img: HTMLImageElement) => {
            const c = document.createElement('canvas');
            c.width = W;
            c.height = H;
            const g = c.getContext('2d') as CanvasRenderingContext2D;
            g.drawImage(img, 0, 0);
            return g.getImageData(0, 0, W, H).data;
          };
          const pa = px(ia);
          const pb = px(ib);
          let sum = 0;
          for (let i = 0; i < pa.length; i += 4) {
            sum +=
              (Math.abs(pa[i] - pb[i]) +
                Math.abs(pa[i + 1] - pb[i + 1]) +
                Math.abs(pa[i + 2] - pb[i + 2])) /
              3;
          }
          return { aw: W, ah: H, bw: ib.naturalWidth, bh: ib.naturalHeight, mean: sum / (W * H) };
        },
        [
          `data:image/png;base64,${Buffer.from(before).toString('base64')}`,
          `data:image/png;base64,${Buffer.from(after).toString('base64')}`,
        ]
      );
      expect(verdict.bw).toBe(verdict.aw);
      expect(verdict.bh).toBe(verdict.ah);
      // Same engine, same page, same CSS: anything above anti-alias noise is a
      // real rendering difference.
      expect(verdict.mean).toBeLessThan(0.5);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
