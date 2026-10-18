// S8.11 — assets in the index: rows, usage, history refs, "Not used" (contract V2-1.17 §5.3/§5.5).
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { staticAssetRefs } from '../access/closure.ts';
import type { IndexContext } from '../index/extract.ts';
import { assetRefsOf } from '../index/extractors/asset-usage.ts';
import type { HistorySource } from '../index/history-refs.ts';
import { createIndexService, type IndexService } from '../index/service.ts';
import { pidOf, projectDir } from '../index/snapshot.ts';
import { assetKey } from '../thumbs/keys.ts';

let root: string;
let designRoot: string;
let indexDir: string;
const prevIndexDir = process.env.MAUDE_INDEX_DIR;
const services: IndexService[] = [];

const A = 'assets/aaaaaaaa.png'; // a.tsx + b.tsx
const B = 'assets/bbbbbbbb.png'; // a.tsx through ./_kit
const C = 'assets/cccccccc.mp4'; // b.css
const D = 'assets/dddddddd.png'; // the design system only
const E = 'assets/eeeeeeee.png'; // nobody
const F = 'assets/ffffffff.png'; // an older version of a.tsx only

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'maude-assets-'));
  designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  mkdirSync(path.join(designRoot, 'assets'), { recursive: true });
  mkdirSync(path.join(designRoot, 'system', 'ds'), { recursive: true });
  writeFileSync(path.join(designRoot, 'config.json'), '{"project":"t"}\n');
  indexDir = mkdtempSync(path.join(tmpdir(), 'maude-assets-cache-'));
  process.env.MAUDE_INDEX_DIR = indexDir;
  for (const a of [A, B, C, D, E, F]) put(a, `bytes of ${a}`);
  put(
    'ui/a.tsx',
    `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
import { Hero } from './_kit';
export default function X() {
  return <DesignCanvas><DCArtboard id="a1"><img src="../assets/aaaaaaaa.png" /><Hero /></DCArtboard></DesignCanvas>;
}
`
  );
  put('ui/_kit.tsx', `export const Hero = () => <img src="../assets/bbbbbbbb.png" />;\n`);
  put(
    'ui/b.tsx',
    `import './b.css';
export default () => <img src=".design/assets/aaaaaaaa.png" />;\n`
  );
  put('ui/b.css', `.hero { background: url(../assets/cccccccc.mp4); }\n`);
  put('system/ds/tokens.css', `.logo { background: url(../../assets/dddddddd.png); }\n`);
});
afterEach(() => {
  for (const s of services.splice(0)) s.stop();
  rmSync(root, { recursive: true, force: true });
  rmSync(indexDir, { recursive: true, force: true });
  if (prevIndexDir === undefined) delete process.env.MAUDE_INDEX_DIR;
  else process.env.MAUDE_INDEX_DIR = prevIndexDir;
});

function put(rel: string, text: string) {
  mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
  writeFileSync(path.join(designRoot, rel), text);
}
const ctx = (): IndexContext => ({
  designRoot,
  groups: [{ path: 'ui', label: 'UI' }],
  defaultDs: null,
  designSystems: [],
});

/** A history source whose answers the test controls. */
function history(
  versions: Record<string, Record<string, { html?: string; css?: string; meta?: string }>>,
  gate?: Promise<void>
): HistorySource & { fail: boolean } {
  const src = {
    fail: false,
    async versions(canvas: string) {
      if (gate) await gate;
      if (src.fail) throw new Error('unreachable');
      return versions[canvas] ? Object.keys(versions[canvas]) : null;
    },
    async text(canvas: string, ref: string, lane: 'html' | 'css' | 'meta') {
      return versions[canvas]?.[ref]?.[lane] ?? null;
    },
  };
  return src;
}

function make(
  opts: { history?: HistorySource | null; now?: () => number; persist?: boolean } = {}
) {
  const svc = createIndexService({
    root,
    designRel: '.design',
    context: ctx,
    project: () => ({
      name: 't',
      label: null,
      formatVersion: 1,
      linkedHub: null,
      managed: false,
    }),
    persist: opts.persist ?? false,
    history: opts.history ?? null,
    now: opts.now,
  });
  services.push(svc);
  return svc;
}
const row = (svc: IndexService, rel: string) => svc.assets().find((r) => r.rel === rel);

describe('usage', () => {
  test('rows carry kind, size and the canvases that use them (own source, imports, css)', () => {
    const svc = make();
    const rows = svc.assets();
    expect(rows.map((r) => r.rel).sort()).toEqual([A, B, C, D, E, F]);
    expect(row(svc, A)).toMatchObject({
      kind: 'image',
      size: `bytes of ${A}`.length,
      usedIn: ['ui/a.tsx', 'ui/b.tsx'],
      usedBy: 2,
    });
    // through `import { Hero } from './_kit'` — the canvas renders it
    expect(row(svc, B)?.usedIn).toEqual(['ui/a.tsx']);
    // through the sibling stylesheet `import './b.css'`
    expect(row(svc, C)).toMatchObject({ kind: 'video', usedIn: ['ui/b.tsx'] });
    expect(svc.usage(A).canvases).toEqual(['ui/a.tsx', 'ui/b.tsx']);
    expect(svc.usage(E).canvases).toEqual([]);
  });

  test('a reference from the design system is use without a canvas to name', () => {
    const svc = make();
    expect(row(svc, D)).toMatchObject({ usedBy: 0, usedElsewhere: true });
  });

  test('a canvas edit moves usage; a deleted or added file moves the rows', () => {
    const svc = make();
    expect(row(svc, E)?.usedBy).toBe(0);
    put('ui/b.tsx', `export default () => <img src="../assets/eeeeeeee.png" />;\n`);
    svc.update(['ui/b.tsx']);
    expect(row(svc, E)?.usedIn).toEqual(['ui/b.tsx']);
    expect(row(svc, A)?.usedIn).toEqual(['ui/a.tsx']);
    // a module no canvas imported becomes part of a canvas when the import appears
    put('ui/_extra.tsx', `export const X = () => <img src="../assets/ffffffff.png" />;\n`);
    svc.update(['ui/_extra.tsx']);
    expect(row(svc, F)).toMatchObject({ usedBy: 0, usedElsewhere: true });
    put('ui/a.tsx', `import './_extra';\nexport default () => null;\n`);
    svc.update(['ui/a.tsx']);
    expect(row(svc, F)?.usedIn).toEqual(['ui/a.tsx']);
    // the file itself
    rmSync(path.join(designRoot, E));
    svc.update([E]);
    expect(row(svc, E)).toBeUndefined();
    put('assets/99999999.webp', 'x');
    svc.update(['assets/99999999.webp']);
    expect(row(svc, 'assets/99999999.webp')).toMatchObject({ kind: 'image', usedBy: 0 });
  });

  test('sidecars of an asset are not rows; computed references are named, not guessed', () => {
    put('assets/aaaaaaaa.photo.json', '{"v":1}');
    put('assets/aaaaaaaa.bbbbbbbb.photo.json', '{"v":1}');
    put('assets/cccccccc.gen.json', '{"format":"maude.gen","v":1}');
    const svc = make();
    expect(svc.assets().map((r) => r.rel)).not.toContain('assets/aaaaaaaa.photo.json');
    expect(svc.assets()).toHaveLength(6);
    put(
      'ui/c.tsx',
      ['export default () => <img src={`../assets/', '$', '{name}.png`} />;\n'].join('')
    );
    svc.update(['ui/c.tsx']);
    expect(svc.dynamicReferences()).toEqual(['ui/c.tsx']);
  });

  test('the scanner reads references exactly as the access closure does', () => {
    const corpus = [
      `<img src="../assets/a.png" /> url(./assets/b.png) '.design/assets/c.png'`,
      `<img src="system/ds/assets/logo.svg" /> "../../system/x/assets/y.png"`,
      `fetch("assets/d.mp4?x=1") 'assets/e.webp#frag' \`assets/f.png\``,
      `const p = "assets/" + name; "assets/${'$'}{id}.png" /assets/g.png`,
    ].join('\n');
    expect(assetRefsOf(corpus).sort()).toEqual([...new Set(staticAssetRefs(corpus))].sort());
  });
});

describe('tiles', () => {
  test('a tile key is the thumbnail key of the bytes, once they are hashed', async () => {
    const svc = make();
    expect(row(svc, A)?.tile).toBeUndefined();
    await svc.settled();
    const sha = createHash('sha256').update(`bytes of ${A}`).digest('hex');
    expect(row(svc, A)).toMatchObject({ sha256: sha, tile: assetKey('card', sha) });
    expect(row(svc, C)?.tile).toBeDefined(); // video
    put('assets/aaaaaaaa.png', 'changed bytes');
    svc.update([A]);
    await svc.settled();
    expect(row(svc, A)?.sha256).toBe(createHash('sha256').update('changed bytes').digest('hex'));
  });
});

describe('Not used and older versions', () => {
  const versions = {
    'ui/a.tsx': {
      r1: { html: `<img src="../assets/ffffffff.png" />` },
      r2: { html: `<img src="../assets/aaaaaaaa.png" />` },
    },
    'ui/b.tsx': { r3: { html: 'x', css: '.x{background:url(../assets/eeeeeeee.png)}' } },
  };

  test('lists nothing until the history scan finishes, then keeps older-version pictures out', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const svc = make({ history: history(versions, gate) });
    // before the scan: no false "not used" — the verdict is "checking", the list is empty
    expect(row(svc, E)).toMatchObject({
      usedBy: 0,
      olderVersions: 'checking',
      notUsed: 'checking',
    });
    expect(svc.notUsed()).toEqual({ checking: true, assets: [] });
    expect(svc.assetsAnswer().history).toBe('checking');
    open();
    await svc.settled();
    // E and F are only in old versions (css lane counts); nothing else is left over
    expect(row(svc, E)).toMatchObject({ olderVersions: true, notUsed: false });
    expect(row(svc, F)).toMatchObject({ olderVersions: true, notUsed: false });
    expect(svc.usage(F)).toEqual({ canvases: [], olderVersions: true });
    // D is used by the design system, A..C by canvases: nobody is left to be unused
    expect(svc.notUsed()).toEqual({ checking: false, assets: [] });
    expect(svc.assetsAnswer().history).toBe('ready');
  });

  test('pruning a version that was the only reference makes the picture unused', async () => {
    const svc = make({ history: history(versions) });
    await svc.settled();
    svc.forgetVersion('ui/a.tsx', { rev: 1 });
    expect(row(svc, F)).toMatchObject({ olderVersions: false, notUsed: true });
    expect(svc.notUsed().assets.map((r) => r.rel)).toEqual([F]);
  });

  test('a version recorded after the scan adds its references', async () => {
    const svc = make({ history: history({ 'ui/a.tsx': { r1: { html: 'x' } } }) });
    await svc.settled();
    expect(row(svc, E)?.notUsed).toBe(true);
    svc.noteVersion('ui/a.tsx', 'r2', { html: `<img src="../assets/eeeeeeee.png" />` });
    expect(row(svc, E)).toMatchObject({ olderVersions: true, notUsed: false });
  });

  test('an unreachable history never concludes "not used"', async () => {
    const src = history(versions);
    src.fail = true;
    const svc = make({ history: src });
    await svc.settled();
    expect(row(svc, E)?.notUsed).toBe('checking');
    expect(svc.notUsed()).toEqual({ checking: true, assets: [] });
    src.fail = false;
    svc.startHistoryScan();
    await svc.settled();
    expect(row(svc, E)?.olderVersions).toBe(true);
    expect(svc.assetsAnswer().history).toBe('ready');
  });

  test('without a history source the verdict stays "checking" (the CLI says why)', () => {
    const svc = make();
    expect(svc.assetsAnswer().history).toBe('idle');
    expect(row(svc, E)?.notUsed).toBe('checking');
    expect(svc.notUsed().assets).toEqual([]);
  });

  test('the scan survives a restart: cached versions are not read again', async () => {
    let reads = 0;
    const src = history(versions);
    const text = src.text;
    src.text = async (...a) => {
      reads++;
      return text(...a);
    };
    const first = make({ history: src, persist: true });
    first.startHistoryScan();
    await first.settled();
    first.flush();
    expect(reads).toBeGreaterThan(0);
    const seen = reads;
    // a second server for the same project: same cache file under the machine dir
    const svc = createIndexService({
      root,
      designRel: '.design',
      context: ctx,
      project: () => ({
        name: 't',
        label: null,
        formatVersion: 1,
        linkedHub: null,
        managed: false,
      }),
      persist: true,
      history: src,
    });
    services.push(svc);
    svc.startHistoryScan();
    await svc.settled();
    expect(reads).toBe(seen);
    expect(row(svc, F)?.olderVersions).toBe(true);
    expect(projectDir(pidOf(root))).toContain(indexDir);
  });

  test("today's AI takes nobody placed are left out; older ones are listed", async () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    put(
      'assets/eeeeeeee.gen.json',
      JSON.stringify({ format: 'maude.gen', v: 1, at: '2026-10-18T09:12:00Z', extra: 1 })
    );
    put(
      'assets/ffffffff.gen.json',
      JSON.stringify({ format: 'maude.gen', v: 1, at: '2026-10-15T09:12:00Z' })
    );
    const svc = make({ history: history({}), now: () => now });
    await svc.settled();
    expect(row(svc, E)).toMatchObject({ recentTake: true, notUsed: false });
    expect(row(svc, F)).toMatchObject({ recentTake: false, notUsed: true });
    // a gen.json from a newer format is read as absent
    put(
      'assets/ffffffff.gen.json',
      JSON.stringify({ format: 'maude.gen', v: 2, at: '2026-10-18T09:00:00Z' })
    );
    svc.update(['assets/ffffffff.gen.json']);
    expect(row(svc, F)?.recentTake).toBe(false);
  });
});

describe('canvas-only sessions', () => {
  test('only assets used by granted canvases exist, and nothing about the rest leaks', async () => {
    const svc = make({
      history: history({ 'ui/b.tsx': { r1: { html: '<img src="../assets/eeeeeeee.png" />' } } }),
    });
    await svc.settled();
    const view = { canvases: new Set(['ui/b.tsx']) };
    const rows = svc.assets(view);
    expect(rows.map((r) => r.rel).sort()).toEqual([A, C]);
    expect(rows.find((r) => r.rel === A)).toMatchObject({
      usedIn: ['ui/b.tsx'],
      usedBy: 1,
      usedElsewhere: false,
      olderVersions: false,
      notUsed: false,
    });
    expect(svc.usage(A, view).canvases).toEqual(['ui/b.tsx']);
    // the design-system logo, the other canvas's kit picture, the old-version picture: not visible
    expect(svc.usage(B, view)).toEqual({ canvases: [], olderVersions: false });
    expect(svc.usage(E, view)).toEqual({ canvases: [], olderVersions: false });
    expect(svc.notUsed(view)).toEqual({ checking: false, assets: [] });
    expect(
      svc
        .assetsAnswer(view)
        .assets.map((r) => r.rel)
        .sort()
    ).toEqual([A, C]);
  });
});
