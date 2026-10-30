// V2-2.17 — thumbnail keys (contract V2-1.17 §5.8 "Key").
//
// A key changes when anything the build used changes — the canvas source, its sidecar, an import,
// the design system's CSS — and stays put for an unrelated canvas. A version whose source equals
// another version's is the SAME key: an unchanged artboard across versions is one picture.
// No browser: the renderer is a shim that never answers, so every result here is `pending`.

import { afterAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { gitShowFile } from '../git/service.ts';
import { pidOf } from '../index/snapshot.ts';
import { KEY_RE, RENDERER, thumbKey } from '../thumbs/keys.ts';
import { createThumbService, type ShimHandle, type ThumbService } from '../thumbs/service.ts';
import { makeSandbox } from './_helpers.ts';
import { freshDepsFor, indexFor, writeFiles } from './_thumbs-helpers.ts';

const CANVAS = (
  fill: string
) => `import { DesignCanvas, DCSection, DCArtboard } from "@maude/canvas-lib";
import { Part } from "./_parts";
export default function A() {
  return (
    <DesignCanvas>
      <DCSection id="s" title="A">
        <DCArtboard id="one" label="One" width={320} height={200}><Part fill="${fill}" /></DCArtboard>
        <DCArtboard id="cover" label="Named cover" width={320} height={200}><Part fill="#000" /></DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const PART = (r: number) =>
  `export function Part({ fill }: { fill: string }) { return <div style={{ background: fill, borderRadius: ${r} }} />; }\n`;

const silentShim = (): ShimHandle => ({
  send() {},
  onMessage() {},
  exited: new Promise<number>(() => {}),
  kill() {},
});

const services: ThumbService[] = [];
afterAll(() => {
  for (const s of services) s.stop();
});

function setup(opts: { lanes?: boolean } = {}) {
  const { root, designRoot } = makeSandbox();
  const sent: Array<Record<string, unknown>> = [];
  const recordingShim = (): ShimHandle => ({ ...silentShim(), send: (m) => void sent.push(m) });
  const atRel = (rel: string) => relative(root, join(designRoot, rel));
  writeFiles(designRoot, {
    'ui/A.tsx': CANVAS('#e4572e'),
    'ui/_parts.tsx': PART(4),
    'ui/A.meta.json': JSON.stringify({ layout: { artboards: [] } }),
    'ui/B.tsx': CANVAS('#204060').replace('./_parts', './_parts.tsx'),
    'system/demo/tokens.css': ':root { --bg-0: #111; }\n',
  });
  const index = indexFor(root, designRoot);
  const svc = createThumbService({
    pid: pidOf(root),
    designRoot,
    index,
    config: () => ({ theme: 'dark', tokensCssRel: 'system/demo/tokens.css' }),
    serverOrigin: () => 'http://localhost:1',
    captureOrigin: () => 'http://localhost:2',
    spawnShim: recordingShim,
    freshDepsHash: freshDepsFor(root, designRoot),
    readVersion: (rel, at) =>
      'sha' in at ? gitShowFile(root, at.sha, atRel(rel)) : Promise.resolve(null),
    // what http.ts wires together with the historical build's CSS / meta overlay (S1.11)
    ...(opts.lanes === false
      ? {}
      : {
          readVersionLane: (
            rel: string,
            _lane: 'css' | 'meta',
            at: { rev: number } | { sha: string }
          ) => ('sha' in at ? gitShowFile(root, at.sha, atRel(rel)) : Promise.resolve(null)),
        }),
  });
  services.push(svc);
  const keyOf = async (
    canvas = 'ui/A.tsx',
    extra: { artboard?: string | null; size?: 'card' | 'row'; at?: { sha: string } } = {}
  ) => {
    const r = await svc.thumb({
      canvas,
      artboard: extra.artboard ?? null,
      size: extra.size ?? 'card',
      at: extra.at,
      priority: 'background',
    });
    if (r.status !== 'pending') throw new Error(`expected pending, got ${JSON.stringify(r)}`);
    expect(r.key).toMatch(KEY_RE);
    return r.key;
  };
  const edit = (rel: string, text: string) => {
    writeFileSync(join(designRoot, rel), text);
    index.update([rel]);
  };
  /** the `&sha=` of every render the service asked the shim for (null = a live build) */
  const renderedAt = () =>
    sent
      .filter((m) => m.op === 'render' && typeof m.url === 'string')
      .map((m) => new URL(m.url as string).searchParams.get('sha'));
  return { root, designRoot, index, svc, keyOf, edit, renderedAt };
}

async function git(root: string, ...args: string[]) {
  const p = Bun.spawn(['git', '-C', root, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
    },
  });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0)
    throw new Error(`git ${args.join(' ')}: ${await new Response(p.stderr).text()}`);
  return out.trim();
}

describe('thumbnail keys (V2-2.17)', () => {
  test('full 64 hex, and every rendered dimension is part of the key', async () => {
    const { keyOf } = setup();
    const cover = await keyOf();
    expect(await keyOf()).toBe(cover); // stable
    expect(await keyOf('ui/A.tsx', { size: 'row' })).not.toBe(cover);
    expect(await keyOf('ui/A.tsx', { artboard: 'one' })).not.toBe(cover);
    // an artboard literally named "cover" is not the cover
    expect(await keyOf('ui/A.tsx', { artboard: 'cover' })).not.toBe(cover);
    const base = {
      size: 'card',
      theme: 'dark',
      canvas: 'ui/A.tsx',
      artboard: null,
      srcHash: 'a',
      cssHash: null,
      metaHash: 'b',
      depsHash: 'c',
    } as const;
    expect(thumbKey({ ...base, theme: 'light' })).not.toBe(thumbKey(base));
    expect(thumbKey({ ...base, cssHash: 'd' })).not.toBe(thumbKey(base));
    expect(thumbKey({ ...base, canvas: 'ui/B.tsx' })).not.toBe(thumbKey(base));
  });

  test('changes on source, sidecar, import and design-system CSS; stable for an unrelated canvas', async () => {
    const { keyOf, edit } = setup();
    const k0 = await keyOf();
    const b0 = await keyOf('ui/B.tsx');

    edit('ui/A.tsx', CANVAS('#00ff00'));
    const k1 = await keyOf();
    expect(k1).not.toBe(k0);

    edit('ui/A.meta.json', JSON.stringify({ layout: { artboards: [{ id: 'one', x: 9, y: 9 }] } }));
    const k2 = await keyOf();
    expect(k2).not.toBe(k1);

    edit('ui/_parts.tsx', PART(12));
    const k3 = await keyOf();
    expect(k3).not.toBe(k2);

    edit('system/demo/tokens.css', ':root { --bg-0: #222; }\n');
    const k4 = await keyOf();
    expect(k4).not.toBe(k3);

    // B imports the same module, so the import and the DS CSS re-keyed it; its own source did not
    const b1 = await keyOf('ui/B.tsx');
    expect(b1).not.toBe(b0);
    edit('ui/A.tsx', CANVAS('#0000ff'));
    expect(await keyOf()).not.toBe(k4);
    expect(await keyOf('ui/B.tsx')).toBe(b1); // an unrelated canvas's edit leaves B alone
  });

  test('one key for an unchanged artboard across versions', async () => {
    const { root, keyOf, edit } = setup();
    await git(root, 'init', '-q');
    await git(root, 'add', '-A');
    await git(root, 'commit', '-qm', 'one');
    const c1 = await git(root, 'rev-parse', 'HEAD');
    edit('ui/B.tsx', CANVAS('#abcdef'));
    await git(root, 'commit', '-qam', 'two: only B changed');
    const c2 = await git(root, 'rev-parse', 'HEAD');

    const now = await keyOf();
    expect(await keyOf('ui/A.tsx', { at: { sha: c1 } })).toBe(now);
    expect(await keyOf('ui/A.tsx', { at: { sha: c2 } })).toBe(now);

    edit('ui/A.tsx', CANVAS('#123456'));
    await git(root, 'commit', '-qam', 'three: A changed');
    const c3 = await git(root, 'rev-parse', 'HEAD');
    const now2 = await keyOf();
    expect(now2).not.toBe(now);
    expect(await keyOf('ui/A.tsx', { at: { sha: c3 } })).toBe(now2);
    // the old version is still the old picture (same source, today's meta / deps / DS CSS)
    expect(await keyOf('ui/A.tsx', { at: { sha: c1 } })).toBe(now);
  });

  // S1.11 — the collision `thumb/1` had: a version whose TSX matched today's but whose CSS / meta
  // lane did not got today's key AND a live build, so the history row showed the live canvas.
  const visibleKey = async (svc: ThumbService, at?: { sha: string }): Promise<string> => {
    const r = await svc.thumb({
      canvas: 'ui/A.tsx',
      artboard: null,
      size: 'row',
      at,
      priority: 'visible',
    });
    if (r.status !== 'pending') throw new Error(`expected pending, got ${JSON.stringify(r)}`);
    return r.key;
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  test('the key names the renderer thumb/2 and the canvas CSS lane', async () => {
    expect(RENDERER).toBe('thumb/2');
    const { keyOf, edit } = setup();
    const k0 = await keyOf();
    edit('ui/A.css', '.x { --lane: today; }\n'); // the same-name lane re-keys today's picture
    expect(await keyOf()).not.toBe(k0);
  });

  test('a version that differs only in its CSS lane is a version, never the live picture', async () => {
    const { root, svc, edit, renderedAt } = setup();
    edit('ui/A.css', '.x { --lane: then; }\n');
    await git(root, 'init', '-q');
    await git(root, 'add', '-A');
    await git(root, 'commit', '-qm', 'one');
    const c1 = await git(root, 'rev-parse', 'HEAD');
    edit('ui/A.css', '.x { --lane: now; }\n'); // TSX and meta unchanged

    const now = await visibleKey(svc);
    const then = await visibleKey(svc, { sha: c1 });
    expect(then).not.toBe(now);
    await settle();
    // the version is BUILT as the version (`&sha=`), the live one without
    expect(renderedAt()).toEqual([null, c1]);
  });

  test('a version that differs only in its meta lane is a version too', async () => {
    const { root, svc, edit, renderedAt } = setup();
    await git(root, 'init', '-q');
    await git(root, 'add', '-A');
    await git(root, 'commit', '-qm', 'one');
    const c1 = await git(root, 'rev-parse', 'HEAD');
    edit('ui/A.meta.json', JSON.stringify({ layout: { artboards: [{ id: 'one', x: 40, y: 0 }] } }));

    const now = await visibleKey(svc);
    expect(await visibleKey(svc, { sha: c1 })).not.toBe(now);
    await settle();
    expect(renderedAt()).toEqual([null, c1]);
  });

  test("without the lane overlay wired, a version keys the lanes the build uses — today's", async () => {
    const { root, svc, edit, renderedAt } = setup({ lanes: false });
    edit('ui/A.css', '.x { --lane: then; }\n');
    await git(root, 'init', '-q');
    await git(root, 'add', '-A');
    await git(root, 'commit', '-qm', 'one');
    const c1 = await git(root, 'rev-parse', 'HEAD');
    edit('ui/A.css', '.x { --lane: now; }\n');
    const now = await visibleKey(svc);
    expect(await visibleKey(svc, { sha: c1 })).toBe(now);
    await settle();
    expect(renderedAt().filter((s) => s !== null)).toEqual([]); // no version build
  });

  test('an unreadable version is unavailable, never a guess', async () => {
    const { svc } = setup();
    expect(
      await svc.thumb({
        canvas: 'ui/A.tsx',
        artboard: null,
        size: 'card',
        at: { sha: 'deadbeef' },
        priority: 'visible',
      })
    ).toEqual({ status: 'unavailable', reason: 'failed' });
    expect(
      await svc.thumb({ canvas: 'ui/Nope.tsx', artboard: null, size: 'card', priority: 'visible' })
    ).toEqual({ status: 'unavailable', reason: 'not-in-scope' });
  });
});
