// S1.11's patch requests, landed by S1.12 (V2-1.9 §5.6): a past version renders with ITS OWN
// same-name CSS and meta, read from the same source as its TSX.
//
//   - `serveCanvasTsx(?sha=r<rev>)` overlays the version's CSS lane; a version without one is built
//     over today's file and goes stale with it;
//   - the shell's `__canvas_meta_version__` carries the version's meta, escaped for a script tag;
//   - `acceptedVersion(repoRel, rev, lane)` on the local home (no CSS lane → null);
//   - the thumbnail service is handed the same reader.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Context } from '../context.ts';
import {
  cssOverridesFor,
  injectVersionMeta,
  laneAtRef,
  scriptSafeJson,
  siblingOf,
  VERSION_META_GLOBAL,
  versionMetaScript,
} from '../history/version-lanes.ts';
import { serveCanvasTsx } from '../http.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CANVAS = `import "./Poster.css";
export default function Poster() { return <div className="x">hi</div>; }
`;
const css = (word: string) => `.x { --lane: ${word}-lane; }\n`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 's1-12-overlay-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, 'ui', 'Poster.tsx'), CANVAS);
  writeFileSync(path.join(designRoot, 'ui', 'Poster.css'), css('today'));
  return { root, designRoot, abs: path.join(designRoot, 'ui', 'Poster.tsx') };
}

function ctxFor(
  p: ReturnType<typeof project>,
  lanes: Record<string, Record<number, string | null>>,
  calls: string[] = []
): Context {
  const runtime = {
    acceptedVersion: async (repoRel: string, rev: number, lane = 'html') => {
      calls.push(`${repoRel}:${rev}:${lane}`);
      return lanes[lane]?.[rev] ?? null;
    },
  };
  return {
    paths: { designRoot: p.designRoot, designRel: '.design', repoRoot: p.root },
    syncControl: { current: () => runtime },
  } as unknown as Context;
}

const get = (sha: string) => new Request(`http://localhost/.design/ui/Poster.tsx?sha=${sha}`);

describe('a past version renders with its own CSS lane', () => {
  test("?sha=r<rev> builds with the version's CSS, not today's", async () => {
    const p = project();
    const calls: string[] = [];
    const ctx = ctxFor(p, { html: { 3: CANVAS }, css: { 3: css('then') } }, calls);
    const res = await serveCanvasTsx(
      p.abs,
      get('r3'),
      ctx,
      path.join(p.designRoot, '_locator.json')
    );
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).toContain('then-lane');
    expect(js).not.toContain('today-lane');
    // CSS from the SAME source as the TSX: the store, at the same revision
    expect(calls).toEqual(['.design/ui/Poster.tsx:3:html', '.design/ui/Poster.tsx:3:css']);
  });

  test('a CSS-only change between two versions gives two different builds', async () => {
    const p = project();
    const ctx = ctxFor(p, {
      html: { 4: CANVAS, 5: CANVAS },
      css: { 4: css('four'), 5: css('five') },
    });
    const loc = path.join(p.designRoot, '_locator.json');
    const four = await serveCanvasTsx(p.abs, get('r4'), ctx, loc);
    const five = await serveCanvasTsx(p.abs, get('r5'), ctx, loc);
    expect(await four.text()).toContain('four-lane');
    expect(await five.text()).toContain('five-lane');
    expect(four.headers.get('etag')).not.toBe(five.headers.get('etag'));
  });

  test("a version without a CSS lane is built over today's file and goes stale with it", async () => {
    const p = project();
    const ctx = ctxFor(p, { html: { 7: CANVAS } });
    const loc = path.join(p.designRoot, '_locator.json');
    const first = await serveCanvasTsx(p.abs, get('r7'), ctx, loc);
    expect(await first.text()).toContain('today-lane');
    const cssFile = path.join(p.designRoot, 'ui', 'Poster.css');
    writeFileSync(cssFile, css('edited'));
    utimesSync(cssFile, new Date(5_000_000), new Date(5_000_000));
    const second = await serveCanvasTsx(p.abs, get('r7'), ctx, loc);
    expect(await second.text()).toContain('edited-lane');
  });
});

describe('the version lane reader', () => {
  test('one source per version: a sha asks git first, then the cell; a pinned source asks only it', async () => {
    const asked: string[] = [];
    const readers = {
      accepted: async (rel: string, rev: number, lane: string) => {
        asked.push(`store ${rel} ${rev} ${lane}`);
        return 'A';
      },
      git: async (sha: string, rel: string) => {
        asked.push(`git ${sha} ${rel}`);
        return null;
      },
      cloud: async (sha: string, rel: string) => {
        asked.push(`cloud ${sha} ${rel}`);
        return 'C';
      },
    };
    expect(await laneAtRef(readers, '.design/ui/P.tsx', 'abc1234', 'css')).toBe('C');
    expect(asked).toEqual(['git abc1234 .design/ui/P.css', 'cloud abc1234 .design/ui/P.css']);
    asked.length = 0;
    expect(await laneAtRef(readers, '.design/ui/P.tsx', 'abc1234', 'meta', 'git')).toBeNull();
    expect(asked).toEqual(['git abc1234 .design/ui/P.meta.json']);
    asked.length = 0;
    expect(await laneAtRef(readers, '.design/ui/P.tsx', 'r9', 'meta')).toBe('A');
    expect(asked).toEqual(['store .design/ui/P.tsx 9 meta']);
    // an r-ref from git, or a failing reader, is simply absent
    expect(await laneAtRef(readers, '.design/ui/P.tsx', 'r9', 'css', 'git')).toBeNull();
    expect(
      await laneAtRef(
        { git: async () => Promise.reject(new Error('x')) },
        'ui/P.tsx',
        'HEAD',
        'css'
      )
    ).toBeNull();
    expect(siblingOf('ui/P.tsx', 'meta')).toBe('ui/P.meta.json');
    expect(cssOverridesFor('/d/ui/P.tsx', null)).toBeUndefined();
    expect(cssOverridesFor('/d/ui/P.tsx', '.x{}')).toEqual({ '/d/ui/P.css': '.x{}' });
  });
});

describe("a past version's meta reaches the shell, and cannot break out of it", () => {
  const SHELL =
    '<html><head><title>x</title></head><body><script type="module">go()</script></body></html>';

  test('the meta is injected before </head> as the version global; the camera is dropped', () => {
    const meta = JSON.stringify({
      layout: { artboards: [{ id: 'a', x: 10 }] },
      viewport: { zoom: 3 },
    });
    const out = injectVersionMeta(SHELL, meta);
    expect(out.indexOf(VERSION_META_GLOBAL)).toBeLessThan(out.indexOf('</head>'));
    const json = /= (.*);<\/script>/.exec(out)?.[1] as string;
    expect(JSON.parse(json)).toEqual({ layout: { artboards: [{ id: 'a', x: 10 }] } });
  });

  test('a </script> or <!-- inside a past meta stays inside the string', () => {
    const evil = JSON.stringify({ title: '</script><script>alert(1)</script><!--', s: '\u2028' });
    const script = versionMetaScript(evil) as string;
    // exactly one closing tag: the script's own
    expect(script.match(/<\/script/gi)?.length).toBe(1);
    expect(script).not.toContain('<!--');
    expect(script).not.toContain('\u2028');
    const body = script.slice(script.indexOf('= ') + 2, script.lastIndexOf(';</script>'));
    expect(JSON.parse(body)).toEqual(JSON.parse(evil));
    expect(scriptSafeJson('<&>')).toBe('"\\u003c\\u0026\\u003e"');
  });

  test('no meta, invalid JSON or a non-object leaves the shell as it was', () => {
    expect(injectVersionMeta(SHELL, null)).toBe(SHELL);
    expect(injectVersionMeta(SHELL, '{nope')).toBe(SHELL);
    expect(injectVersionMeta(SHELL, '[1,2]')).toBe(SHELL);
    expect(injectVersionMeta(SHELL, '"x"')).toBe(SHELL);
  });

  test('the shell takes the version global under ?sha= and ignores live meta refreshes then', () => {
    const shell = readFileSync(
      path.join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
      'utf8'
    );
    expect(shell).toContain('shaParam && window.__canvas_meta_version__');
    expect(shell).toContain('versionMeta\n          ? Promise.resolve(versionMeta)');
    expect(shell).toContain('if (versionMeta) return;');
  });

  test('http.ts injects it before the CSP hashes the inline scripts, and thumbs get the same reader', () => {
    const http = readFileSync(path.join(import.meta.dir, '..', 'http.ts'), 'utf8');
    const shellFn = http.slice(http.indexOf('async function serveCanvasShell('));
    expect(shellFn.indexOf('injectVersionMeta(')).toBeGreaterThan(0);
    expect(shellFn.indexOf('injectVersionMeta(')).toBeLessThan(
      shellFn.indexOf('cspForCanvasShell(')
    );
    const thumbs = http.slice(http.indexOf('createThumbService({'));
    expect(thumbs.slice(0, thumbs.indexOf('onReady:'))).toContain(
      'readVersionLane: (rel, lane, at)'
    );
  });
});

describe('the local home answers a lane at a revision', () => {
  test('meta at a revision; no CSS lane locally', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 's1-12-local-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), 'export default () => <p>a</p>;\n');
    writeFileSync(
      path.join(designRoot, 'ui', 'a.meta.json'),
      JSON.stringify({ layout: { artboards: [{ id: 'one', x: 40, y: 0 }] } })
    );
    writeFileSync(path.join(designRoot, 'ui', 'a.css'), '.x{}');
    const h = openLocalHome({
      designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_mac_one', name: 'Mac one' },
      bootId: 'boot-1',
      lockRetryMs: 0,
      settleMs: 5,
      log: { warn() {}, error() {} },
    });
    homes.push(h);
    await h.ready();
    const [base] = await h.runtime.acceptedHistory({ path: '.design/ui/a.tsx' });
    const rev = (base as { revision: number }).revision;
    const meta = await h.runtime.acceptedVersion('.design/ui/a.tsx', rev, 'meta');
    expect(meta && JSON.parse(meta).layout.artboards[0].id).toBe('one');
    expect(await h.runtime.acceptedVersion('.design/ui/a.tsx', rev, 'css')).toBeNull();
    expect(await h.runtime.acceptedVersion('.design/ui/a.tsx', rev)).toContain('<p>a</p>');
  });
});
