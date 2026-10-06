// #134/#136 — comments anchored to an annotation, or to a world point.
//
// Two halves: the geometric hit test that turns a click on a sticky into an
// `annotationId` (in comment mode the annotation layer is not the hit target,
// which is why the click used to fall through to an unanchored comment), and
// the API trust boundary — both anchors are peer-supplied (DDR-054), so they
// are shape-checked where a comment is created AND where one is read (a
// peer-synced comment never passes commentsAdd).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { createApi } from '../api.ts';
import { annotationIdAt, isAnnotationId, isWorldPoint } from '../comment-anchor.ts';
import { type Context, createBus } from '../context.ts';
import { makeSandbox } from './_helpers.ts';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function giveRect(el: Element, x: number, y: number, w: number, h: number) {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y }) as DOMRect;
}

describe('annotationIdAt', () => {
  test('the smallest annotation under the point wins, and sections never do', () => {
    document.body.innerHTML = `<svg>
      <g data-id="s_section" data-tool="section"></g>
      <g data-id="s_big" data-tool="rect"></g>
      <g data-id="s_sticky" data-tool="sticky"></g>
    </svg>`;
    giveRect(document.querySelector('[data-id="s_section"]') as Element, 0, 0, 1000, 1000);
    giveRect(document.querySelector('[data-id="s_big"]') as Element, 100, 100, 400, 400);
    giveRect(document.querySelector('[data-id="s_sticky"]') as Element, 150, 150, 100, 80);
    expect(annotationIdAt(160, 160)).toBe('s_sticky');
    expect(annotationIdAt(450, 450)).toBe('s_big');
    expect(annotationIdAt(900, 900)).toBeNull(); // only the section is there
  });

  test('an id that fails the shape rule is never returned', () => {
    document.body.innerHTML = '<svg><g data-id="bad&quot;]" data-tool="sticky"></g></svg>';
    giveRect(document.querySelector('[data-tool]') as Element, 0, 0, 50, 50);
    expect(annotationIdAt(10, 10)).toBeNull();
  });
});

describe('anchor shapes', () => {
  test('annotation ids and world points are bounded', () => {
    expect(isAnnotationId('s_ab12cd34')).toBe(true);
    expect(isAnnotationId('x'.repeat(65))).toBe(false);
    expect(isAnnotationId('a"]')).toBe(false);
    expect(isWorldPoint({ x: 1.5, y: -20 })).toBe(true);
    expect(isWorldPoint({ x: Number.NaN, y: 0 })).toBe(false);
    expect(isWorldPoint({ x: 1e12, y: 0 })).toBe(false);
    expect(isWorldPoint({ x: '1', y: 0 })).toBe(false);
  });
});

function mkApi() {
  const { root, designRoot } = makeSandbox();
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    join(designRoot, 'ui', 'Board.tsx'),
    'export default function P(){return <main/>}\n'
  );
  mkdirSync(join(designRoot, '_comments'), { recursive: true });
  const ctx = {
    cfg: {} as Context['cfg'],
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
  } as Context;
  return { api: createApi(ctx, { onCommentsChanged: () => {} }), designRoot };
}

const FILE = '.design/ui/Board.tsx';

describe('the API keeps valid anchors and drops the rest', () => {
  test('commentsAdd stores annotationId and world', async () => {
    const { api } = mkApi();
    const c = await api.commentsAdd({
      file: FILE,
      text: 'on the sticky',
      author: 'Alice',
      annotationId: 's_sticky1',
      world: { x: 120, y: -40 },
    });
    expect(c?.annotationId).toBe('s_sticky1');
    expect(c?.world).toEqual({ x: 120, y: -40 });
    const read = await api.loadCommentsForFile(FILE);
    expect(read[0]?.annotationId).toBe('s_sticky1');
  });

  test('commentsAdd drops malformed anchors', async () => {
    const { api } = mkApi();
    const c = await api.commentsAdd({
      file: FILE,
      text: 'poisoned',
      author: 'Alice',
      annotationId: 'x"] , body { display:none',
      world: { x: Number.POSITIVE_INFINITY, y: 0 },
    } as Parameters<typeof api.commentsAdd>[0]);
    expect(c?.annotationId).toBeUndefined();
    expect(c?.world).toBeUndefined();
  });

  test('a peer-synced comment with a malformed anchor is cleaned on read', async () => {
    const { api, designRoot } = mkApi();
    writeFileSync(
      join(designRoot, '_comments', 'ui-board.json'),
      JSON.stringify([
        {
          id: 'c_peer',
          file: FILE,
          selector: '',
          text: 'from a peer',
          status: 'open',
          created: '2026-09-29T10:00:00.000Z',
          resolved_at: null,
          annotationId: '"]*',
          world: { x: 'far', y: 0 },
        },
      ])
    );
    const [c] = await api.loadCommentsForFile(FILE);
    expect(c?.id).toBe('c_peer');
    expect(c?.annotationId).toBeUndefined();
    expect(c?.world).toBeUndefined();
  });
});
