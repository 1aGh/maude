// S2.6 (artboard ed-obj-order) — the canvas half of the object ops: `runEditOp`'s first real caller
// (`runObjectOp`), the object menu's layout and states, the Edit/Preview chord scope, the lock badge,
// and what the arrows read out. The server half is test/edit-ops-object.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { canvasKeyIndex } from '../actions/canvas-keys.ts';
import { canvasKeyCtx } from '../actions/ctx.ts';
import { chordFromEvent } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import { LayerRowTools, layerOpMessage } from '../client/v2/inspector/layers-row-tools.jsx';
import type { ContextTarget, MenuItem } from '../context-menu.tsx';
import { matchSignature, styleDeclarations } from '../edit-ops/select-matching.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { runEditOp } from '../editing/edit-op.ts';
import { lockedName, lockedUnder, lockLine } from '../editing/lock-badge.tsx';
import { distancesToParent, nudgeTag } from '../editing/nudge.tsx';
import { resolveObjectKey } from '../editing/object-keys.ts';
import { isUnframable, objectMenuSections, objectState } from '../editing/object-menu.tsx';
import { layerParams, OBJECT_OP_ACTIONS, refsOf, runObjectOp } from '../editing/object-ops.ts';

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

const FIXTURE = `
<article class="dc-artboard" data-dc-screen="desktop">
  <div class="dc-artboard-body">
    <section data-cd-id="services" class="services">
      <b data-cd-id="dot"></b>
      <strong data-cd-id="title" class="t">Brand systems</strong>
      <img data-cd-id="logo" data-cd-locked alt="Logo" src="/l.svg" />
    </section>
    <p data-cd-id="note" data-cd-hidden="" style="display: none">Hidden</p>
    <p data-cd-id="words">Some <b>bold</b> words</p>
  </div>
</article>`;
const q = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as Element;

// ── runObjectOp: the first real caller of runEditOp ───────────────────────────────────────────

describe('runEditOp round trip', () => {
  function fakeWindow() {
    const posted: Array<Record<string, unknown>> = [];
    const parent = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const listeners: Array<(e: unknown) => void> = [];
    const win = {
      parent,
      addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
    } as unknown as Window;
    const answer = (data: Record<string, unknown>, source: unknown = parent) =>
      listeners.forEach((fn) => fn({ source, data: { dgn: 'edit-op-result', ...data } }));
    return { win, posted, answer, parent };
  }

  test('posts the op with its targets and settles on the answer carrying its requestId', async () => {
    const { win, posted, answer } = fakeWindow();
    const p = runEditOp(
      {
        op: 'object.lock',
        targets: [{ artboard: 'desktop', element: 'title' }],
        params: { locked: true },
      },
      win
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      dgn: 'edit-op',
      op: 'object.lock',
      targets: [{ artboard: 'desktop', element: 'title' }],
      params: { locked: true },
    });
    answer({
      requestId: posted[0]?.requestId,
      ok: true,
      actionId: null,
      writeId: 'w_1',
      rev: 'a'.repeat(16),
      refs: [{ artboard: 'desktop', element: 'title' }],
    });
    const r = await p;
    expect(r.ok && r.writeId).toBe('w_1');
  });

  test('a refusal arrives as ok:false with the server’s own words; a foreign frame cannot answer', async () => {
    const { win, posted, answer } = fakeWindow();
    const p = runEditOp(
      { op: 'object.hide', targets: [{ artboard: 'desktop', element: 'logo' }] },
      win
    );
    const id = posted[0]?.requestId;
    answer({ requestId: id, ok: true, writeId: 'w_x' }, { not: 'the parent' }); // ignored
    answer({ requestId: id, ok: false, code: 'locked', message: 'Logo is locked · ⇧⌘L unlocks' });
    expect(await p).toEqual({ ok: false, code: 'locked', message: 'Logo is locked · ⇧⌘L unlocks' });
  });
});

describe('runObjectOp', () => {
  const ref = { artboard: 'desktop', element: 'title' };
  const okResult = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
    ok: true,
    actionId: null,
    writeId: 'w_7',
    rev: 'b'.repeat(16),
    refs: [ref],
    ...over,
  });

  test('nothing selected runs nothing', async () => {
    let called = false;
    const r = await runObjectOp('object.lock', [], {
      run: async () => {
        called = true;
        return okResult();
      },
    });
    expect(r).toBeNull();
    expect(called).toBe(false);
  });

  test('it asks for the registry op with the targets and params, and on a legacy link records ONE revert', async () => {
    const asked: unknown[] = [];
    const recorded: unknown[] = [];
    await runObjectOp(
      'object.lock',
      [ref],
      { run: async (a) => (asked.push(a), okResult()), record: (r) => recorded.push(r) },
      { locked: true }
    );
    expect(asked).toEqual([{ op: 'object.lock', targets: [ref], params: { locked: true } }]);
    expect(recorded).toEqual([{ kind: 'edit-op', label: 'Lock', payload: { writeId: 'w_7' } }]);
  });

  test('a write the runtime already knows as an action is not pushed (S5 owns that undo)', async () => {
    const recorded: unknown[] = [];
    await runObjectOp('object.frame', [ref], {
      run: async () => okResult({ actionId: 'act_9' }),
      record: (r) => recorded.push(r),
    });
    expect(recorded).toEqual([]);
  });

  test('a refusal says the server’s words once and records nothing', async () => {
    const toasts: unknown[] = [];
    const recorded: unknown[] = [];
    const r = await runObjectOp('object.hide', [ref], {
      run: async () => ({ ok: false, code: 'locked', message: 'Title is locked · ⇧⌘L unlocks' }),
      toast: (m, k) => toasts.push([m, k]),
      record: (x) => recorded.push(x),
    });
    expect(r?.ok).toBe(false);
    expect(toasts).toEqual([['Title is locked · ⇧⌘L unlocks', 'error']]);
    expect(recorded).toEqual([]);
  });

  test('the frame a write created is selected', async () => {
    const created = { artboard: 'desktop', element: 'frame' };
    const selected: unknown[] = [];
    await runObjectOp('object.frame', [ref], {
      run: async () => okResult({ created: [created] }),
      select: (r) => selected.push(r),
    });
    expect(selected).toEqual([[created]]);
  });

  test('every op the slice owns is a registry action the keys can resolve', () => {
    expect(OBJECT_OP_ACTIONS.sort()).toEqual([
      'object.bring-forward',
      'object.bring-front',
      'object.frame',
      'object.hide',
      'object.lock',
      'object.send-back',
      'object.send-backward',
      'object.unframe',
    ]);
  });

  test('refsOf keeps the occurrence of a repeat and drops a bare artboard', () => {
    expect(
      refsOf([
        { id: 'row', selector: '', artboardId: 'desktop', index: 2 },
        { id: 'title', selector: '', artboardId: 'desktop' },
        { selector: '', artboardId: 'desktop' },
      ])
    ).toEqual([
      { artboard: 'desktop', element: 'row', occurrence: 2 },
      { artboard: 'desktop', element: 'title' },
    ]);
  });

  test('a Layers row names its target and value; junk is ignored', () => {
    expect(
      layerParams({ targets: [{ artboard: 'desktop', element: 'logo' }], locked: false })
    ).toEqual({ refs: [{ artboard: 'desktop', element: 'logo' }], params: { locked: false } });
    expect(
      layerParams({ targets: [{ artboard: '../x', element: 'logo' }], hidden: 'yes' })
    ).toEqual({
      refs: undefined,
      params: undefined,
    });
    expect(layerParams(undefined)).toEqual({ refs: undefined, params: undefined });
  });
});

// ── the object menu ───────────────────────────────────────────────────────────────────────────

describe('object menu', () => {
  const noop = () => {};
  const v1 = (ids: string[]): MenuItem[][] => [
    ids.map((id) => ({ id, label: id, onSelect: noop })),
  ];
  const V1_IDS = [
    'add-comment',
    'copy-css',
    'copy-id',
    'inspect',
    'edit-photo',
    'select-layer',
    'insert-element',
    'replace-media',
    'convert-to-absolute',
    'export-selection',
    'duplicate-element',
    'copy-style',
    'paste-style',
    'delete-element',
    'hide',
    'deselect',
  ];
  const calls: string[] = [];
  const sections = (els: Element[]) =>
    objectMenuSections(v1(V1_IDS), {
      elementsFor: () => els,
      run: (a) => calls.push(a),
      selectMatching: () => calls.push('match'),
    });
  const target = (el: Element): ContextTarget =>
    ({
      kind: 'element',
      el,
      cdId: null,
      artboardId: 'desktop',
      clientX: 0,
      clientY: 0,
    }) as ContextTarget;
  const live = (items: MenuItem[], t: ContextTarget) =>
    items.filter((i) => !(typeof i.hidden === 'function' ? i.hidden(t) : i.hidden));

  test('the rows are the inventory’s, in its order, with its shortcuts', () => {
    document.body.innerHTML = FIXTURE;
    const t = target(q('title'));
    const s = sections([q('title')]);
    expect(
      s.map((sec) => live(sec, t).map((i) => `${i.label}${i.shortcut ? ` ${i.shortcut}` : ''}`))
    ).toEqual([
      ['Ask AI about this ⌘/'], // S2.22 — its label names the object per click (labelOf)
      ['Duplicate ⌘D', 'Copy properties ⌥⌘C', 'Paste properties ⌥⌘V', 'Select matching'],
      ['Frame selection ⌥⌘G', 'Remove frame ⇧⌘G'],
      ['Bring to front ⌘]', 'Bring forward ]', 'Send backward [', 'Send to back ⌘['],
      ['Lock ⇧⌘L', 'Hide'],
      ['Advanced'],
      ['Remove ⌫'],
    ]);
  });

  test('nothing is deleted: every v1 row is in the list or under Advanced ▸, ids (testids) unchanged', () => {
    document.body.innerHTML = FIXTURE;
    const s = sections([q('title')]);
    const top = s.flat().filter((i) => i.id !== 'advanced');
    const adv = s.flat().find((i) => i.id === 'advanced');
    const reachable = new Set([
      ...top.map((i) => i.id),
      ...((adv?.submenu as MenuItem[]) ?? []).map((i) => i.id),
    ]);
    for (const id of V1_IDS) expect(reachable.has(id)).toBe(true);
    // the three D6 / A-copy-* rows
    expect(((adv?.submenu as MenuItem[] | undefined) ?? []).map((i) => i.id)).toEqual(
      expect.arrayContaining(['copy-css', 'copy-id', 'export-selection', 'inspect', 'select-layer'])
    );
    expect(top.map((i) => i.id)).toEqual(expect.arrayContaining(['copy-style', 'paste-style']));
  });

  test('Lock / Unlock and Hide / Show follow the selection; Remove frame greys unless it applies', () => {
    document.body.innerHTML = FIXTURE;
    const rows = (els: Element[]) => {
      const t = target(els[0] as Element);
      const s = sections(els).flat();
      const by = (id: string) => s.find((i) => i.id === id) as MenuItem;
      return {
        lock: live([by('lock'), by('unlock')], t).map((i) => i.label),
        hide: live([by('hide'), by('show')], t).map((i) => i.label),
        unframeOff: (by('unframe').disabled as (t: ContextTarget) => boolean)(t),
      };
    };
    expect(rows([q('title')])).toEqual({ lock: ['Lock'], hide: ['Hide'], unframeOff: true });
    expect(rows([q('logo')]).lock).toEqual(['Unlock']);
    expect(rows([q('note')]).hide).toEqual(['Show']);
    expect(rows([q('title'), q('logo')]).lock).toEqual(['Lock']); // a mixed selection locks first
    expect(rows([q('services')]).unframeOff).toBe(false);
  });

  test('a row runs its op through the shared runner', () => {
    document.body.innerHTML = FIXTURE;
    calls.length = 0;
    const t = target(q('title'));
    const flat = sections([q('title')]).flat();
    for (const id of ['frame', 'bring-front', 'lock'])
      (flat.find((i) => i.id === id) as MenuItem).onSelect(t);
    (flat.find((i) => i.id === 'select-matching') as MenuItem).onSelect(t);
    expect(calls).toEqual(['object.frame', 'object.bring-front', 'object.lock', 'match']);
  });

  test('object state and what a frame is', () => {
    document.body.innerHTML = FIXTURE;
    expect(objectState([q('logo')]).locked).toBe(true);
    expect(objectState([q('note')]).hidden).toBe(true);
    expect(objectState([]).canUnframe).toBe(false);
    expect(isUnframable(q('services'))).toBe(true); // only objects inside
    expect(isUnframable(q('words'))).toBe(false); // has loose words
    expect(isUnframable(q('dot'))).toBe(false); // a leaf
    expect(isUnframable(document.querySelector('[data-dc-screen]') as Element)).toBe(false);
  });

  test('"same style" is the tag, the classes and the inline declarations, in any order', () => {
    expect(matchSignature({ tag: 'DIV', className: 'b a', style: 'color: red; margin:0' })).toBe(
      matchSignature({ tag: 'div', className: 'a  b', style: 'margin: 0;color:red;' })
    );
    expect(matchSignature({ tag: 'div', className: 'a' })).not.toBe(
      matchSignature({ tag: 'div', className: 'a b' })
    );
    expect(styleDeclarations('Color : red ;; ')).toEqual(['color:red']);
  });
});

// ── chords: Edit means objects, Preview means annotations ─────────────────────────────────────

describe('chord scope', () => {
  const ev = (key: string, mods: Partial<Record<'metaKey' | 'altKey' | 'shiftKey', boolean>>) => ({
    key,
    ...mods,
  });
  const edit = (e: ReturnType<typeof ev>, over: Record<string, unknown> = {}) =>
    resolveObjectKey(e, { typing: false, mode: 'edit', selection: 'object', ...over });

  test('⌥⌘G and ⌘G frame, ⇧⌘G unframes, ⇧⌘L locks — in Edit, on an object', () => {
    expect(edit(ev('g', { metaKey: true, altKey: true }))).toBe('object.frame');
    expect(edit(ev('g', { metaKey: true }))).toBe('object.frame');
    expect(edit(ev('g', { metaKey: true, shiftKey: true }))).toBe('object.unframe');
    expect(edit(ev('L', { metaKey: true, shiftKey: true }))).toBe('object.lock');
  });

  test('order: ⌘] front, ] forward, [ backward, ⌘[ back', () => {
    expect(edit(ev(']', { metaKey: true }))).toBe('object.bring-front');
    expect(edit(ev(']', {}))).toBe('object.bring-forward');
    expect(edit(ev('[', {}))).toBe('object.send-backward');
    expect(edit(ev('[', { metaKey: true }))).toBe('object.send-back');
  });

  test('the same chords do nothing in Preview, with nothing selected, or while typing', () => {
    const lock = ev('L', { metaKey: true, shiftKey: true });
    expect(edit(lock, { mode: 'preview' })).toBeNull();
    expect(edit(lock, { mode: 'present' })).toBeNull();
    expect(edit(lock, { selection: 'none' })).toBeNull();
    expect(edit(lock, { selection: 'annotation' })).toBeNull(); // a quiet sticky is never hit in Edit
    expect(edit(ev(']', {}), { typing: true })).toBeNull();
    expect(edit(ev(']', {}), { singleKeys: false })).toBeNull(); // WCAG 2.1.4: bare ] [ switch off
  });

  test('in Preview the board keeps its chords: ⌘G groups, ⇧⌘L locks, and not in Edit', () => {
    const board = canvasKeyIndex([
      'annotation.group',
      'annotation.ungroup',
      'annotation.lock',
      'annotation.to-front',
      'annotation.forward',
    ]);
    const run = (key: string, mods: object, mode: 'edit' | 'preview') =>
      resolveChord(
        board,
        chordFromEvent({ key, ...mods }),
        canvasKeyCtx({ typing: false, readOnly: false, mode, selection: 'annotation' })
      )?.action.id ?? null;
    expect(run('g', { metaKey: true }, 'preview')).toBe('annotation.group');
    expect(run('L', { metaKey: true, shiftKey: true }, 'preview')).toBe('annotation.lock');
    expect(run('g', { metaKey: true }, 'edit')).toBeNull();
    expect(run('L', { metaKey: true, shiftKey: true }, 'edit')).toBeNull();
    expect(run(']', {}, 'edit')).toBeNull();
  });

  test('V2-5 A4 — the board’s own document listener (⌘G / ⇧⌘L / ] [) stands down in Edit', async () => {
    const { boardChordsLive } = await import('../annotations-layer.tsx');
    let seq = 1000;
    const setMode = (mode: string) =>
      window.dispatchEvent(
        new window.MessageEvent('message', {
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: ++seq,
            mode,
            present: null,
            caps: { edit: true, annotate: true, comment: true },
          },
          source: window.parent as unknown as MessageEventSource,
        })
      );
    boardChordsLive(window); // the store starts listening on its first read
    setMode('edit');
    expect(boardChordsLive(window)).toBe(false);
    setMode('preview');
    expect(boardChordsLive(window)).toBe(true);
    // …and the listener asks it before anything else.
    const src = await Bun.file(new URL('../annotations-layer.tsx', import.meta.url)).text();
    const at = src.indexOf('FigJam v3 — manipulation shortcuts');
    const body = src.slice(src.indexOf('const onKey = (e: KeyboardEvent) => {', at));
    expect(body.split('\n')[1]?.trim()).toBe('if (!boardChordsLive(window)) return;');
  });
});

// ── the lock badge, the Layers tools, the arrows ───────────────────────────────────────────────

describe('lock badge', () => {
  test('finds the locked object under the pointer and says why in the contract’s words', () => {
    document.body.innerHTML = FIXTURE;
    expect(lockedUnder(q('logo'))).toBe(q('logo'));
    expect(lockedUnder(q('title'))).toBeNull();
    expect(lockedName(q('logo'))).toBe('Logo');
    expect(lockLine('Logo')).toBe('Logo is locked · ⇧⌘L unlocks');
  });
});

describe('Layers row tools', () => {
  test('the message a row sends names its artboard, element, occurrence and the value', () => {
    expect(layerOpMessage('object.lock', { id: 'logo', index: 0 }, 'desktop', true)).toEqual({
      dgn: 'run-action',
      v: 1,
      id: 'object.lock',
      params: { targets: [{ artboard: 'desktop', element: 'logo' }], locked: true },
    });
    expect(layerOpMessage('object.hide', { id: 'row', index: 3 }, 'desktop', false).params).toEqual(
      {
        targets: [{ artboard: 'desktop', element: 'row', occurrence: 3 }],
        hidden: false,
      }
    );
  });

  test('the padlock and the eye call back with the row’s key and node', async () => {
    const seen: unknown[] = [];
    const node = { id: 'logo', index: 0, label: 'Logo' };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <LayerRowTools
          node={node}
          isLocked
          isHidden={false}
          onToggleLock={(k: string, n: unknown) => seen.push(['lock', k, n])}
          onToggleVisibility={(n: unknown) => seen.push(['hide', n])}
        />
      )
    );
    const lock = host.querySelector('.sh-layer-lock') as HTMLButtonElement;
    const eye = host.querySelector('.sh-layer-eye') as HTMLButtonElement;
    expect(lock.getAttribute('aria-label')).toBe('Unlock Logo');
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    expect(eye.getAttribute('aria-label')).toBe('Hide Logo');
    await act(async () => lock.click());
    await act(async () => eye.click());
    expect(seen).toEqual([
      ['lock', 'logo:0', node],
      ['hide', node],
    ]);
  });
});

describe('nudge readout', () => {
  test('vertical arrows read Y, horizontal read X, in whole world px', () => {
    expect(nudgeTag('ArrowDown', 120.4, 434.2)).toBe('Y 434');
    expect(nudgeTag('ArrowLeft', 119.6, 434)).toBe('X 120');
    expect(nudgeTag('Enter', 1, 2)).toBeNull();
  });

  test('⌥ distances are to the frame’s edges, in world units (zoom divided out)', () => {
    const inner = { left: 120, top: 220, right: 220, bottom: 260 };
    const outer = { left: 100, top: 200, right: 400, bottom: 300 };
    expect(distancesToParent(inner, outer, 1)).toEqual({
      top: 20,
      right: 180,
      bottom: 40,
      left: 20,
    });
    expect(distancesToParent(inner, outer, 2)).toEqual({
      top: 10,
      right: 90,
      bottom: 20,
      left: 10,
    });
  });
});
