// V2-2.4b gate (Phase 2 F1) — no repo-provided DOCUMENT executes on the main origin.
//
// The main origin's static fall-through serves any file under the repo root.
// An `.svg` already carried INERT_DOCUMENT_CSP, but an `.html` went out as a live
// `text/html` page with no CSP: same-origin with every privileged route, so its
// inline script passed `sameOriginWrite` + `isTrustedRequestHost`. Two ways in:
//   (a) the AI agent writes `.design/x.html` (an in-project write nothing polices)
//       and opens `http://localhost:<port>/.design/x.html` with an auto-tier
//       browser verb → `/_api/ui-prefs`, `/_config`, git push, paid generation;
//   (b) no write at all: the npm-shipped `plugins/design/templates/_shell.html`
//       (under `node_modules/@1agh/maude/…`, pnpm `.pnpm` layout included) is
//       repo content too — opened with `?canvas=<peer-synced.tsx>` it renders a
//       canvas on the main origin, which the shell's 307 exists to prevent.
//
// Fix (decision:maude/v2-2.4b-gate-repo-html-opaque-origin): a repo `.html` is
// served under `sandbox allow-scripts; connect-src 'none'` — an OPAQUE origin
// (no `allow-same-origin`), so it shares nothing with the main origin and its
// requests carry `Origin: null` (refused by `sameOriginWrite`), and it can open
// no fetch/XHR/WebSocket at all. A legacy `.html` canvas — the one v1 flow that
// iframes repo HTML from the main origin (`canvasUrl` → `urlOf`) — still runs its
// scripts and loads its stylesheets and images; it talks to the studio only
// through the frame's `load` event, which an opaque frame still fires.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const SHELL_TEMPLATE = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  'plugins',
  'design',
  'templates',
  '_shell.html'
);

const BASE_ENV = { MAUDE_NO_AUTOBUILD: '1' };

// A planted page: probes privileged routes from its own document, then stamps
// the answers on <body>. It also proves the page still RUNS (the attribute is
// written by script) and still STYLES (a repo stylesheet sets #out's colour).
const PLANTED_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="/.design/legacy.css"></head>
<body><div id="out">pending</div><script>
(async () => {
  const out = {};
  const probe = async (name, path, init) => {
    try { const r = await fetch(path, init); out[name] = String(r.status); }
    catch { out[name] = 'blocked'; }
  };
  await Promise.all([
    probe('prefsWrite', '/_api/ui-prefs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    }),
    probe('configRead', '/_config'),
    probe('indexRead', '/_index-data'),
  ]);
  out.ws = await new Promise((res) => {
    try {
      const ws = new WebSocket('ws://' + location.host + '/_ws/collab/ui-probe');
      ws.onopen = () => { res('open'); ws.close(); };
      ws.onerror = () => res('blocked');
      setTimeout(() => res('timeout'), 3000);
    } catch { res('blocked'); }
  });
  document.body.setAttribute('data-probe', JSON.stringify(out));
})();
</script></body></html>
`;

const PROBE_TSX = `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";

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

// A canvas with no bare imports: the repo shell's relative importmap cannot
// resolve `react` from a nested path, but a module that needs nothing from it
// runs its top-level code all the same — a peer-synced canvas can be this.
const BARE_TSX = `const out: Record<string, string> = {};
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
  probe("indexRead", "/_index-data"),
]);
document.body.setAttribute("data-probe", JSON.stringify(out));
export default function Bare() {
  return null;
}
`;

/** The shell template wherever an installed maude puts it under a project. */
const SHELL_COPIES = [
  'node_modules/@1agh/maude/plugins/design/templates/_shell.html',
  'node_modules/.pnpm/@1agh+maude@1.9.0/node_modules/@1agh/maude/plugins/design/templates/_shell.html',
];

function plant(root: string, designRoot: string, prefs: string) {
  writeFileSync(join(designRoot, 'x.html'), PLANTED_HTML);
  writeFileSync(join(designRoot, 'X.HTML'), PLANTED_HTML);
  writeFileSync(join(designRoot, 'legacy.css'), '#out { color: rgb(1, 2, 3); }\n');
  writeFileSync(join(designRoot, 'ui', 'Probe.tsx'), PROBE_TSX);
  writeFileSync(join(designRoot, 'ui', 'Bare.tsx'), BARE_TSX);
  writeFileSync(join(designRoot, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(designRoot, 'a.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(designRoot, 'f.woff2'), new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
  writeFileSync(join(designRoot, 'v.mp4'), new Uint8Array(16));
  for (const name of ['p.htm', 'p.xhtml', 'p.xml'])
    writeFileSync(join(designRoot, name), PLANTED_HTML);
  const shell = readFileSync(SHELL_TEMPLATE, 'utf8');
  for (const rel of SHELL_COPIES) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), shell);
  }
  writeFileSync(prefs, `${JSON.stringify({ theme: 'light' })}\n`);
}

function opaqueSandbox(csp: string): boolean {
  const sandbox = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === 'sandbox' || d.startsWith('sandbox '));
  return !!sandbox && !sandbox.includes('allow-same-origin');
}

describe('no repo document executes on the main origin (V2-2.4b gate F1)', () => {
  test('headers: repo HTML is an opaque, connection-less document; SVG and plain assets unchanged', async () => {
    const { root, designRoot } = makeSandbox();
    const prefs = join(root, 'prefs.json');
    plant(root, designRoot, prefs);
    const port = nextPort();
    const proc = await bootServer(root, port, { ...BASE_ENV, MAUDE_UI_PREFS_PATH: prefs });
    try {
      const at = (p: string) => fetch(`http://localhost:${port}${p}`, { redirect: 'manual' });

      for (const p of ['/.design/x.html', '/.design/X.HTML', ...SHELL_COPIES.map((r) => `/${r}`)]) {
        const r = await at(`${p}?canvas=ui/Probe.tsx`);
        expect(`${p} ${r.status}`).toBe(`${p} 200`);
        const csp = r.headers.get('content-security-policy') ?? '';
        expect(`${p} opaque=${opaqueSandbox(csp)}`).toBe(`${p} opaque=true`);
        expect(`${p} ${csp}`).toContain("connect-src 'none'");
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      }

      // The SVG keeps the stricter inert-document policy, verbatim.
      const svg = await at('/.design/logo.svg');
      expect(svg.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");

      // HTML-family names that are NOT in MIME go out as inert bytes, never a page.
      for (const p of ['/.design/p.htm', '/.design/p.xhtml', '/.design/p.xml']) {
        const r = await at(p);
        expect(`${p} ${r.headers.get('content-type')}`).toBe(`${p} application/octet-stream`);
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      }

      // Plain assets are unchanged: their type, nosniff, and no CSP.
      for (const [p, type] of [
        ['/.design/a.png', 'image/png'],
        ['/.design/f.woff2', 'font/woff2'],
        ['/.design/v.mp4', 'video/mp4'],
        ['/.design/legacy.css', 'text/css; charset=utf-8'],
      ] as const) {
        const r = await at(p);
        expect(`${p} ${r.status} ${r.headers.get('content-type')}`).toBe(`${p} 200 ${type}`);
        expect(r.headers.get('x-content-type-options')).toBe('nosniff');
        expect(`${p} ${r.headers.get('content-security-policy')}`).toBe(`${p} null`);
      }

      // The studio's own pages never go through the repo fall-through.
      const index = await at('/');
      expect(index.status).toBe(200);
      expect(index.headers.get('content-security-policy') ?? '').not.toContain('sandbox');
    } finally {
      await killProc(proc);
    }
  }, 30_000);

  test('THE PROBE: a planted page and the repo shell reach no privileged route in a real browser', async () => {
    const { root, designRoot } = makeSandbox();
    const prefs = join(root, 'prefs.json');
    plant(root, designRoot, prefs);
    const port = nextPort();
    const proc = await bootServer(root, port, { ...BASE_ENV, MAUDE_UI_PREFS_PATH: prefs });
    const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
      launchChromium: () => Promise<{
        newContext: () => Promise<{ newPage: () => Promise<unknown> }>;
        close: () => Promise<void>;
      }>;
    };
    const browser = await launchChromium();
    const main = `http://localhost:${port}`;
    try {
      // (a) the planted page: its script still runs and its stylesheet still
      // applies (a legacy .html canvas keeps working), but nothing it asks for
      // on the main origin answers.
      {
        // biome-ignore lint/suspicious/noExplicitAny: playwright page surface
        const page: any = await (await browser.newContext()).newPage();
        await page.goto(`${main}/.design/x.html`);
        const handle = await page.waitForSelector('[data-probe]', {
          state: 'attached',
          timeout: 20_000,
        });
        const out = JSON.parse((await handle.getAttribute('data-probe')) ?? '{}');
        expect(out.prefsWrite).not.toBe('200');
        expect(out.configRead).not.toBe('200');
        expect(out.indexRead).not.toBe('200');
        expect(out.ws).not.toBe('open');
        const color = await page.evaluate(
          () => getComputedStyle(document.getElementById('out') as HTMLElement).color
        );
        expect(color).toBe('rgb(1, 2, 3)');
        expect(JSON.parse(readFileSync(prefs, 'utf8')).theme).toBe('light');
      }

      // (b) the repo copy of the canvas shell, pointed at a canvas: whatever it
      // manages to mount, it is not the main origin's. (Unfixed, BARE_TSX ran
      // here and `/_api/ui-prefs` answered 200.)
      const canvas = 'ui/Bare.tsx';
      for (const rel of SHELL_COPIES) {
        // biome-ignore lint/suspicious/noExplicitAny: playwright page surface
        const page: any = await (await browser.newContext()).newPage();
        // The shell resolves every URL under its own path (`base`); a
        // `designRel` of enough `..` climbs back to the real design root.
        const climb = encodeURIComponent(`${'../'.repeat(12)}.design`);
        await page.goto(`${main}/${rel}?canvas=${canvas}&designRel=${climb}`);
        const handle = await page
          .waitForSelector('[data-probe]', { state: 'attached', timeout: 10_000 })
          .catch(() => null);
        const out = handle ? JSON.parse((await handle.getAttribute('data-probe')) ?? '{}') : {};
        expect(`${rel} ${canvas} ${out.prefsWrite}`).not.toBe(`${rel} ${canvas} 200`);
        expect(`${rel} ${canvas} ${out.indexRead}`).not.toBe(`${rel} ${canvas} 200`);
        expect(JSON.parse(readFileSync(prefs, 'utf8')).theme).toBe('light');
      }
    } finally {
      await browser.close();
      await killProc(proc);
    }
  }, 120_000);
});
