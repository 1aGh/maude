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
import { KEY_RE, thumbKey } from '../thumbs/keys.ts';
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

function setup() {
  const { root, designRoot } = makeSandbox();
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
    spawnShim: silentShim,
    freshDepsHash: freshDepsFor(root, designRoot),
    readVersion: (rel, at) =>
      'sha' in at
        ? gitShowFile(root, at.sha, relative(root, join(designRoot, rel)))
        : Promise.resolve(null),
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
  return { root, designRoot, index, svc, keyOf, edit };
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
      metaHash: 'b',
      depsHash: 'c',
    } as const;
    expect(thumbKey({ ...base, theme: 'light' })).not.toBe(thumbKey(base));
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
