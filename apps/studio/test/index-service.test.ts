// V2-2.17 — the project index: matcher, static extractor, incremental updates, crash staleness.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { extractCanvas, type IndexContext, listCanvases, stampOf } from '../index/extract.ts';
import { fold, match, withinOneEdit } from '../index/match.ts';
import { createIndexService } from '../index/service.ts';
import { isFresh, pidOf, projectDir, readSnapshot, writeSnapshot } from '../index/snapshot.ts';

let root: string;
let designRoot: string;
let indexDir: string;
const prevIndexDir = process.env.MAUDE_INDEX_DIR;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'maude-index-'));
  designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui', 'club'), { recursive: true });
  writeFileSync(path.join(designRoot, 'config.json'), '{"project":"t"}\n');
  indexDir = mkdtempSync(path.join(tmpdir(), 'maude-index-cache-'));
  process.env.MAUDE_INDEX_DIR = indexDir;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(indexDir, { recursive: true, force: true });
  if (prevIndexDir === undefined) delete process.env.MAUDE_INDEX_DIR;
  else process.env.MAUDE_INDEX_DIR = prevIndexDir;
});

const ctx = (): IndexContext => ({
  designRoot,
  groups: [{ path: 'ui', label: 'UI' }],
  defaultDs: 'maude',
  designSystems: [],
});
const put = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
  writeFileSync(path.join(designRoot, rel), text);
};
const canvas = (boards: string) => `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function C() {
  return <DesignCanvas>${boards}</DesignCanvas>;
}
`;

describe('matcher', () => {
  test('accents fold, word order is free, every word must match', () => {
    expect(fold('Trenéři')).toBe('treneri');
    const rows = [
      { key: 'a', name: 'Combine-kampaň', meta: 'ui/2026' },
      { key: 'b', name: 'Trenéři', meta: 'ui/club' },
      { key: 'c', name: 'Pricing', meta: 'ui/web' },
    ];
    expect(match(rows, 'kampan combine').map((h) => h.row.key)).toEqual(['a']);
    expect(match(rows, 'treneri').map((h) => h.row.key)).toEqual(['b']);
    expect(match(rows, 'treneri pricing')).toEqual([]);
    // marks point into the UNFOLDED name
    const [hit] = match(rows, 'kampan');
    expect(hit).toBeDefined();
    const [from, to] = (hit as NonNullable<typeof hit>).marks[0] as [number, number];
    expect((hit as NonNullable<typeof hit>).row.name.slice(from, to)).toBe('kampaň');
  });

  test('one typo in a word of 4+ letters is a close match; shorter words must be exact', () => {
    expect(withinOneEdit('unifromy', 'uniformy')).toBe(true); // swap of neighbours
    expect(withinOneEdit('pricng', 'pricing')).toBe(true); // one missing letter
    expect(withinOneEdit('pricing', 'prizzing')).toBe(false);
    const rows = [{ key: 'u', name: 'Uniformy 2026', meta: '' }];
    const [hit] = match(rows, 'unifromy');
    expect(hit?.close).toBe(true);
    expect(match([{ key: 'x', name: 'Map', meta: '' }], 'mop')).toEqual([]);
  });
});

describe('static extractor', () => {
  test('literal artboards are listed with id, label, kind and size', () => {
    put(
      'ui/club/home.tsx',
      canvas(`<DCArtboard id="hero" label="Hero" width={1440} height={900} kind="web" />
        <DCArtboard id="poster" label="Plakát A3" width={842} height={1191} kind="print" />`)
    );
    const row = extractCanvas(ctx(), 'ui/club/home.tsx');
    expect(row.artboards).toEqual([
      { id: 'hero', label: 'Hero', kind: 'web', w: 1440, h: 900 },
      { id: 'poster', label: 'Plakát A3', kind: 'print', w: 842, h: 1191 },
    ]);
    expect(row.dynamic).toBe(false);
    expect(row.ds).toBe('maude');
    expect(row.folder).toBe('ui/club');
    expect(row.parse).toBe('ok');
  });

  test('artboards a parse cannot list make the canvas dynamic', () => {
    put('ui/mapped.tsx', canvas(`{[1, 2].map((n) => <DCArtboard key={n} id={'p' + n} />)}`));
    put('ui/computed.tsx', canvas(`<DCArtboard id={ID} />`));
    put('ui/club/_render.tsx', 'export const R = () => <DCArtboard id="x" />;\n');
    put('ui/club/wrapped.tsx', `import { R } from './_render';\nexport default () => <R />;\n`);
    expect(extractCanvas(ctx(), 'ui/mapped.tsx').dynamic).toBe(true);
    expect(extractCanvas(ctx(), 'ui/computed.tsx').dynamic).toBe(true);
    const wrapped = extractCanvas(ctx(), 'ui/club/wrapped.tsx');
    expect(wrapped.dynamic).toBe(true);
    expect(wrapped.hasArtboards).toBe(true);
    // the local module is part of depsHash
    const before = wrapped.depsHash;
    put('ui/club/_render.tsx', 'export const R = () => <DCArtboard id="y" />;\n');
    expect(extractCanvas(ctx(), 'ui/club/wrapped.tsx').depsHash).not.toBe(before);
  });

  test('a relative import that leaves the project is never read', () => {
    const outside = path.join(path.dirname(root), `maude-outside-${path.basename(root)}.tsx`);
    writeFileSync(outside, 'export const X = () => <DCArtboard id="o" />;\n');
    try {
      put(
        'ui/escape.tsx',
        `import { X } from '../../../${path.basename(outside).replace(/\.tsx$/, '')}';\nexport default () => <X />;\n`
      );
      const row = extractCanvas(ctx(), 'ui/escape.tsx');
      expect(row.dynamic).toBe(false); // the outside module's DCArtboard was not looked at
    } finally {
      rmSync(outside, { force: true });
    }
  });

  test('the sidecar gives kind, design system and AI authorship; _modules are not canvases', () => {
    put('ui/a.tsx', canvas('<DCArtboard id="a" />'));
    put(
      'ui/a.meta.json',
      JSON.stringify({
        designSystem: 'maude-v2',
        kind: 'brief-board',
        artboardMeta: { a: { madeBy: 'ai' } },
      })
    );
    put('ui/_kit.tsx', 'export const K = 1;\n');
    const row = extractCanvas(ctx(), 'ui/a.tsx');
    expect(row.ds).toBe('maude-v2');
    expect(row.kind).toBe('brief-board');
    expect(row.madeByAi).toBe(true);
    expect(listCanvases(ctx())).toEqual(['ui/a.tsx']);
  });
});

describe('incremental updates', () => {
  test('create, change, meta change and delete each update one row and bump seq', () => {
    put('ui/a.tsx', canvas('<DCArtboard id="a1" />'));
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
      persist: false,
    });
    const events: string[][] = [];
    svc.on('changed', (e) => events.push(e.rels));
    expect(svc.counts().canvases).toBe(1);

    put('ui/b.tsx', canvas('<DCArtboard id="b1" /><DCArtboard id="b2" />'));
    svc.update(['ui/b.tsx']);
    expect(svc.counts()).toMatchObject({ canvases: 2, artboards: 3 });

    put('ui/a.tsx', canvas('<DCArtboard id="a1" /><DCArtboard id="a2" kind="video" />'));
    svc.update(['ui/a.tsx']);
    expect(svc.canvas('ui/a.tsx')?.artboards.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(svc.counts().byKind.video).toBe(1);

    put('ui/a.meta.json', '{"designSystem":"maude-v2"}');
    svc.update(['ui/a.meta.json']);
    expect(svc.canvas('ui/a.tsx')?.ds).toBe('maude-v2');

    rmSync(path.join(designRoot, 'ui', 'b.tsx'));
    svc.update(['ui/b.tsx']);
    expect(svc.canvas('ui/b.tsx')).toBeUndefined();
    expect(events).toEqual([['ui/b.tsx'], ['ui/a.tsx'], ['ui/a.tsx'], ['ui/b.tsx']]);
    expect(svc.search('a2').rows[0]?.key).toBe('ui/a.tsx#a2');
    svc.stop();
  });
});

describe('crash safety', () => {
  test('a snapshot written before an edit made while no server ran reads as stale', () => {
    put('ui/a.tsx', canvas('<DCArtboard id="a1" />'));
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
    });
    svc.flush();
    svc.stop();
    const pid = pidOf(root);
    const snap = readSnapshot(pid);
    expect(snap?.canvases.map((c) => c.rel)).toEqual(['ui/a.tsx']);
    expect(isFresh(snap!, stampOf(ctx()))).toBe(true);
    // the "server" is gone; terminal Claude Code edits the canvas
    put('ui/a.tsx', canvas('<DCArtboard id="a1" /><DCArtboard id="a2" />'));
    utimesSync(path.join(designRoot, 'ui', 'a.tsx'), new Date(), new Date(Date.now() + 5000));
    expect(isFresh(snap!, stampOf(ctx()))).toBe(false);
    // a new canvas while closed is stale too
    put('ui/b.tsx', canvas(''));
    expect(isFresh(snap!, stampOf(ctx()))).toBe(false);
  });

  test('writes are atomic (no temp left) and a dead writer’s old temp file is swept on boot', () => {
    put('ui/a.tsx', canvas('<DCArtboard id="a1" />'));
    const pid = pidOf(root);
    mkdirSync(projectDir(pid), { recursive: true });
    const deadTmp = path.join(projectDir(pid), 'index.json.tmp-999-dead');
    writeFileSync(deadTmp, '{');
    utimesSync(deadTmp, new Date(0), new Date(Date.now() - 2 * 60 * 60 * 1000));
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
    });
    svc.flush();
    svc.stop();
    expect(existsSync(deadTmp)).toBe(false);
    expect(readdirSync(projectDir(pid)).filter((n) => n.includes('.tmp-'))).toEqual([]);
    // a torn file reads as missing, never as a half index
    writeFileSync(
      path.join(projectDir(pid), 'index.json'),
      '{"format":"maude.project-index","v":1,"canv'
    );
    expect(readSnapshot(pid)).toBeNull();
    // and a restart reuses nothing it cannot trust but rebuilds
    const again = createIndexService({
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
    });
    expect(again.counts().canvases).toBe(1);
    again.flush();
    again.stop();
    expect(readSnapshot(pid)?.canvases.length).toBe(1);
    void writeSnapshot; // exported for Home's rebuild-of-closed (V2-1.1)
  });
});
