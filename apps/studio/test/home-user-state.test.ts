// V2-3.3 — `_canvas-state/_pins.json` + `_recent.json` (V2-1.1 §5.5): the shared module, the
// runtime-state classification, and the project server's move / trash / open hooks.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApi } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { isMaudeRuntimeState } from '../git/service.ts';
import {
  dropPin,
  isCanvasKey,
  RECENT_CAP,
  readPins,
  readRecent,
  rekeyUserState,
  setPin,
  stampRecent,
} from '../home/user-state.ts';
import { createInspect } from '../inspect.ts';
import { isRuntimeStateRel } from '../sync/file-membership.ts';
import { makeSandbox } from './_helpers.ts';

function mkCtx(root: string, designRoot: string): Context {
  return {
    cfg: {
      canvasGroups: [
        { label: 'Design system', path: 'system' },
        { label: 'Canvases', path: 'ui' },
      ],
    } as Context['cfg'],
    projectLabel: 'test',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
}

function api(ctx: Context) {
  return createApi(ctx, {
    onCommentsChanged: () => {},
    isRoomPinned: () => false,
    flushAndDropRoom: async () => {},
  });
}

const tmpDesign = () => {
  const d = join(mkdtempSync(join(tmpdir(), 'maude-us-')), '.design');
  mkdirSync(d, { recursive: true });
  return d;
};

describe('the two files are runtime state (DDR-115: no list changes)', () => {
  test('git and the sync file plane both classify them as never-versioned', () => {
    for (const rel of ['.design/_canvas-state/_pins.json', '.design/_canvas-state/_recent.json'])
      expect(isMaudeRuntimeState(rel)).toBe(true);
    for (const rel of ['_canvas-state/_pins.json', '_canvas-state/_recent.json'])
      expect(isRuntimeStateRel(rel)).toBe(true);
  });
});

describe('user-state module', () => {
  test('keys: designRoot-relative canvas paths only', () => {
    expect(isCanvasKey('ui/2026/combine/Combine-kampan.tsx')).toBe(true);
    for (const bad of [
      '/abs.tsx',
      '../x.tsx',
      'ui/../x.tsx',
      'ui/x.meta.json',
      'ui/_history/x.tsx',
      'ui\\x.tsx',
      '',
      'a//b.tsx',
    ])
      expect(isCanvasKey(bad)).toBe(false);
  });

  test('_recent.json keeps the newest 200', () => {
    const d = tmpDesign();
    for (let i = 0; i < RECENT_CAP + 5; i++) stampRecent(d, `ui/c${i}.tsx`, 1000 + i);
    const opened = readRecent(d).opened;
    expect(Object.keys(opened)).toHaveLength(RECENT_CAP);
    expect(opened['ui/c0.tsx']).toBeUndefined();
    expect(opened[`ui/c${RECENT_CAP + 4}.tsx`]).toBe(1000 + RECENT_CAP + 4);
  });

  test('no in-memory cache: a second writer’s pin survives the first writer’s next toggle', () => {
    const d = tmpDesign();
    setPin(d, 'ui/a.tsx', true);
    // another process writes the file behind our back
    const file = join(d, '_canvas-state', '_pins.json');
    const other = JSON.parse(readFileSync(file, 'utf8'));
    other.pins.push({ canvas: 'ui/b.tsx', at: 1 });
    writeFileSync(file, JSON.stringify(other));
    setPin(d, 'ui/c.tsx', true);
    expect(readPins(d).pins.map((p) => p.canvas)).toEqual(['ui/a.tsx', 'ui/b.tsx', 'ui/c.tsx']);
  });

  test('rekey moves pins + opened; dropPin removes one pin', () => {
    const d = tmpDesign();
    setPin(d, 'ui/f/a.tsx', true, 5);
    setPin(d, 'ui/keep.tsx', true, 6);
    stampRecent(d, 'ui/f/a.tsx', 7);
    rekeyUserState(d, [['ui/f/a.tsx', 'ui/g/a.tsx']]);
    expect(readPins(d).pins).toEqual([
      { canvas: 'ui/g/a.tsx', at: 5 },
      { canvas: 'ui/keep.tsx', at: 6 },
    ]);
    expect(readRecent(d).opened).toEqual({ 'ui/g/a.tsx': 7 });
    dropPin(d, 'ui/keep.tsx');
    expect(readPins(d).pins.map((p) => p.canvas)).toEqual(['ui/g/a.tsx']);
  });
});

describe('project server hooks', () => {
  test('moveCanvas carries the pin and last-opened to the new key', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Card.tsx'), 'export default function C(){return null}');
    setPin(designRoot, 'ui/Card.tsx', true, 11);
    stampRecent(designRoot, 'ui/Card.tsx', 12);
    const r = await api(mkCtx(root, designRoot)).moveCanvas({
      file: 'ui/Card.tsx',
      toDir: 'ui/sub',
    });
    expect(r.ok).toBe(true);
    expect(readPins(designRoot).pins).toEqual([{ canvas: 'ui/sub/Card.tsx', at: 11 }]);
    expect(readRecent(designRoot).opened).toEqual({ 'ui/sub/Card.tsx': 12 });
  });

  test('a folder move carries every nested canvas', async () => {
    const { root, designRoot } = makeSandbox();
    mkdirSync(join(designRoot, 'ui', 'kit'), { recursive: true });
    writeFileSync(
      join(designRoot, 'ui', 'kit', 'A.tsx'),
      'export default function A(){return null}'
    );
    writeFileSync(
      join(designRoot, 'ui', 'kit', 'B.tsx'),
      'export default function B(){return null}'
    );
    mkdirSync(join(designRoot, 'ui', 'dest'), { recursive: true });
    setPin(designRoot, 'ui/kit/A.tsx', true, 1);
    stampRecent(designRoot, 'ui/kit/B.tsx', 2);
    const r = await api(mkCtx(root, designRoot)).moveCanvas({ file: 'ui/kit', toDir: 'ui/dest' });
    expect(r.ok).toBe(true);
    expect(readPins(designRoot).pins.map((p) => p.canvas)).toEqual(['ui/dest/kit/A.tsx']);
    expect(Object.keys(readRecent(designRoot).opened)).toEqual(['ui/dest/kit/B.tsx']);
  });

  test('a canvas sent to the trash drops its pin', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Gone.tsx'), 'export default function G(){return null}');
    setPin(designRoot, 'ui/Gone.tsx', true);
    setPin(designRoot, 'ui/fixture-other.tsx', true);
    const r = await api(mkCtx(root, designRoot)).deleteCanvas({ file: 'ui/Gone.tsx' });
    expect(r.ok).toBe(true);
    expect(readPins(designRoot).pins.map((p) => p.canvas)).toEqual(['ui/fixture-other.tsx']);
  });

  test('opening a canvas stamps _recent.json; a path the canvas made up does not', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Open.tsx'), 'export default function O(){return null}');
    const inspect = createInspect(mkCtx(root, designRoot), async () => []);
    inspect.setActive('.design/ui/Open.tsx');
    expect(Object.keys(readRecent(designRoot).opened)).toEqual(['ui/Open.tsx']);
    inspect.setActive('.design/ui/Ghost.tsx');
    inspect.setActive('.design/../../etc/passwd.tsx');
    inspect.setActive('../outside.tsx');
    expect(Object.keys(readRecent(designRoot).opened)).toEqual(['ui/Open.tsx']);
  });
});
