// S4.12 (canvas 15 `an-convert`, `an-section`) — the small toolbar over a sole sticky says Resolve and
// Turn into a comment; over a sole section it shows the six tones, Fold and Ask AI about it. The canvas
// never calls a privileged route: it asks the shell, in words from the dgn table.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SECTION_TONES } from '../annotations/ui/section-fold.ts';
import { postToShell, scopeKey, selectionScope } from '../annotations/ui/shell-asks.ts';
import { AnnotationContextToolbar } from '../annotations-context-toolbar.tsx';
import { StrokesStoreContext, type StrokesStoreValue } from '../annotations-layer.tsx';
import type { SectionStroke, StickyStroke, Stroke } from '../annotations-model.ts';
import { C2S_ACTIVE, DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  AnnotationSelectionProvider,
  useAnnotationSelection,
} from '../use-annotation-selection.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const sticky = (o: Partial<StickyStroke> = {}): StickyStroke => ({
  id: 'st',
  tool: 'sticky',
  color: '#fce8a6',
  x: 0,
  y: 0,
  w: 200,
  h: 200,
  text: 'Photo feels small next to the headline',
  fontSize: 14,
  ...o,
});
const section = (o: Partial<SectionStroke> = {}): SectionStroke => ({
  id: 'sc',
  tool: 'section',
  x: 0,
  y: 0,
  w: 500,
  h: 300,
  label: 'Zpětná vazba',
  color: SECTION_TONES[0].value,
  ...o,
});

function Select({ ids }: { ids: string[] }) {
  const sel = useAnnotationSelection();
  // biome-ignore lint/correctness/useExhaustiveDependencies: select once
  useEffect(() => sel.replace(ids), []);
  return null;
}

async function mountToolbar(strokes: Stroke[], ids: string[]) {
  const ran: string[] = [];
  const colors: string[] = [];
  const store = {
    strokes,
    setStrokes: () => {},
    updateStroke: () => {},
    deleteStrokes: () => {},
    translateStrokes: () => {},
    applyToStrokes: (selected: readonly string[], fn: (s: Stroke) => Partial<Stroke> | null) => {
      for (const s of strokes) if (selected.includes(s.id)) colors.push(String(fn(s)?.color));
    },
    groupSelection: () => null,
    ungroupSelection: () => {},
    setLocked: () => {},
    runAction: (id: string) => {
      ran.push(id);
      return true;
    },
  } as unknown as StrokesStoreValue;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <AnnotationSelectionProvider>
        <StrokesStoreContext.Provider value={store}>
          <Select ids={ids} />
          <AnnotationContextToolbar editingId={null} />
        </StrokesStoreContext.Provider>
      </AnnotationSelectionProvider>
    )
  );
  return { host, ran, colors };
}
const byId = (host: Element, id: string) => host.querySelector(`[data-testid="${id}"]`);
const click = async (el: Element | null) => {
  if (!el) throw new Error('no such control');
  await act(async () => (el as HTMLElement).click());
};

describe('the small toolbar over a sticky', () => {
  test('Resolve and Turn into a comment run the registry actions', async () => {
    const { host, ran } = await mountToolbar([sticky()], ['st']);
    expect(byId(host, 'annot-ctx-resolve')?.textContent).toBe('Resolve');
    expect(byId(host, 'annot-ctx-to-comment')?.textContent).toBe('Turn into a comment');
    await click(byId(host, 'annot-ctx-resolve'));
    await click(byId(host, 'annot-ctx-to-comment'));
    expect(ran).toEqual(['annotation.resolve', 'annotation.to-comment']);
  });
  test('a resolved sticky offers Reopen, pressed', async () => {
    const { host } = await mountToolbar(
      [sticky({ resolved: { by: 'Jonas', at: '2026-10-19T10:00:00Z' } })],
      ['st']
    );
    const b = byId(host, 'annot-ctx-resolve');
    expect(b?.textContent).toBe('Reopen');
    expect(b?.getAttribute('aria-pressed')).toBe('true');
  });
  test("two stickies selected: no per-sticky words (a comment is one sticky's thread)", async () => {
    const { host } = await mountToolbar([sticky(), sticky({ id: 'st2' })], ['st', 'st2']);
    expect(byId(host, 'annot-ctx-resolve')).toBeNull();
    expect(byId(host, 'annot-ctx-to-comment')).toBeNull();
  });
  test('no section words on a sticky', async () => {
    const { host } = await mountToolbar([sticky()], ['st']);
    expect(byId(host, 'annot-ctx-fold')).toBeNull();
    expect(byId(host, 'annot-ctx-ask-ai')).toBeNull();
  });
});

describe('the small toolbar over a section', () => {
  test('six tones, Fold and ✦ Ask AI about it', async () => {
    const { host, ran, colors } = await mountToolbar([section()], ['sc']);
    const tones = [...host.querySelectorAll('[aria-label^="Section color"]')];
    expect(tones).toHaveLength(6);
    await click(tones[4] ?? null);
    expect(colors).toEqual([SECTION_TONES[4].value]);
    expect(byId(host, 'annot-ctx-fold')?.textContent).toBe('Fold');
    expect(byId(host, 'annot-ctx-ask-ai')?.textContent).toBe('✦ Ask AI about it');
    await click(byId(host, 'annot-ctx-fold'));
    await click(byId(host, 'annot-ctx-ask-ai'));
    expect(ran).toEqual(['annotation.fold', 'annotation.ask-ai']);
  });
  test('a folded section says Unfold', async () => {
    const { host } = await mountToolbar([section({ folded: true })], ['sc']);
    expect(byId(host, 'annot-ctx-fold')?.textContent).toBe('Unfold');
  });
});

describe('what the canvas asks the shell', () => {
  test('the AI scope is ids, a count per type and the artboards — never the words', () => {
    const strokes = [sticky({ id: 'a' }), sticky({ id: 'b' }), section({ id: 'c' })];
    const scope = selectionScope(strokes, ['a', 'b'], (id) => (id === 'a' ? 'desktop' : 'mobile'));
    expect(scope).toEqual({
      ids: ['a', 'b'],
      kinds: { sticky: 2 },
      artboards: ['desktop', 'mobile'],
    });
    expect(JSON.stringify(scope)).not.toContain('Photo feels');
    expect(selectionScope(strokes, [], () => undefined)).toEqual({
      ids: [],
      kinds: {},
      artboards: [],
    });
    expect(scopeKey(scope)).not.toBe(scopeKey(selectionScope(strokes, ['a'], () => 'desktop')));
  });

  test('a standalone canvas has no shell to ask', () => {
    expect(postToShell({ dgn: 'annotation-to-comment', id: 'st' })).toBe(false);
  });

  test('the words the canvas posts are in the dgn table, canvas → shell, active only', () => {
    for (const name of [
      'annotation-to-comment',
      'annotation-selection',
      'annotation-toast',
      'annotation-ask-ai',
    ]) {
      const row = (DGN_TABLE.c2s as unknown as Record<string, { gate?: string }>)[name];
      expect(row?.gate).toBe('active');
      expect(C2S_ACTIVE.has(name)).toBe(true);
    }
    const parse = (DGN_TABLE.c2s as unknown as Record<string, { parse: (v: unknown) => unknown }>)[
      'annotation-to-comment'
    ]?.parse;
    expect(parse?.({ id: 'st' })).not.toBeNull();
    expect(parse?.({ id: '<script>' })).toBeNull();
    expect(parse?.({})).toBeNull();
  });
});

describe('what the shell does with the ask (client/v2/annotations/annotation-asks.js)', () => {
  const reply = (status: number, body: unknown) =>
    (async () => ({ status, json: async () => body })) as unknown as typeof fetch;
  const calls: Array<{ url: string; body: unknown }> = [];
  const record = (status: number, body: unknown) =>
    (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { status, json: async () => body };
    }) as unknown as typeof fetch;

  test('the conversion goes to the S4.7 route with the shell’s file, and offers Undo by action id', async () => {
    const { turnIntoComment, undoConversion } = await import(
      '../client/v2/annotations/annotation-asks.js'
    );
    calls.length = 0;
    const r = await turnIntoComment({
      file: 'ui/Board.tsx',
      id: 'st',
      fetchImpl: record(200, { ok: true, commentId: 'c1', actionId: 'a9' }),
    });
    expect(calls[0]).toEqual({
      url: '/_api/annotations/to-comment',
      body: { file: 'ui/Board.tsx', id: 'st' },
    });
    expect(r).toEqual({
      ok: true,
      line: 'Turned into a comment.',
      commentId: 'c1',
      undo: { actionId: 'a9' },
    });
    calls.length = 0;
    expect((await undoConversion(r.undo, { fetchImpl: record(200, { ok: true }) })).ok).toBe(true);
    expect(calls[0]).toEqual({ url: '/_api/project/undo', body: { actionId: 'a9' } });
  });

  test('a legacy link undoes by token', async () => {
    const { undoConversion } = await import('../client/v2/annotations/annotation-asks.js');
    calls.length = 0;
    await undoConversion({ token: 't1' }, { fetchImpl: record(200, { ok: true }) });
    expect(calls[0]).toEqual({ url: '/_api/annotations/convert-undo', body: { token: 't1' } });
  });

  test('each refusal has its own line; a reply since says so', async () => {
    const { turnIntoComment, undoConversion, ASK_WORDS } = await import(
      '../client/v2/annotations/annotation-asks.js'
    );
    const ask = (status: number, body: unknown) =>
      turnIntoComment({ file: 'f', id: 'st', fetchImpl: reply(status, body) });
    expect((await ask(403, { reason: 'read-only' })).line).toBe(ASK_WORDS.forbidden);
    expect((await ask(404, { reason: 'gone' })).line).toBe(ASK_WORDS.gone);
    expect((await ask(409, { reason: 'empty' })).line).toBe(ASK_WORDS.empty);
    expect((await ask(409, { reason: 'not-a-sticky' })).line).toBe(ASK_WORDS.notSticky);
    expect((await ask(500, null)).line).toBe(ASK_WORDS.failed);
    const late = await undoConversion(
      { actionId: 'a9' },
      { fetchImpl: reply(409, { line: 'Tereza replied — resolve the thread instead.' }) }
    );
    expect(late).toEqual({ ok: false, line: 'Tereza replied — resolve the thread instead.' });
  });

  test('the AI scope is kept per canvas and cleared by an empty selection', async () => {
    const { noteAnnotationSelection, annotationScopeOf } = await import(
      '../client/v2/annotations/annotation-asks.js'
    );
    noteAnnotationSelection('ui/a.tsx', { ids: ['x'], kinds: { sticky: 1 }, artboards: ['d'] });
    expect(annotationScopeOf('ui/a.tsx')?.ids).toEqual(['x']);
    noteAnnotationSelection('ui/a.tsx', { ids: [], kinds: {}, artboards: [] });
    expect(annotationScopeOf('ui/a.tsx')).toBeNull();
  });
});
