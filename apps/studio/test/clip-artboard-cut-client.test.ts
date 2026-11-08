// #122 slice 122-B — the client half of the cross-canvas clipboard: `artboard.cut` (⌘X on an artboard) in the
// action registry and the clipboard path, the artboard menu's Cut · Copy · Paste rows, the words a carried
// paste says, and the short refusal a cloud tab gives a copy it does not hold. The server op (`artboard.cut`,
// the carry) is slice 122-A; everything here codes against its name only.

import { beforeEach, describe, expect, test } from 'bun:test';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS } from '../actions/index.ts';
import {
  _setHeldClip,
  CELL_NO_CROSS_PROJECT,
  CLIP_COPY_OPS,
  frameClipResult,
  heldClip,
  NOTHING_TO_PASTE,
  noteClipResult,
  shapeClipRequest,
} from '../client/clipboard-relay.ts';
import type { MenuItem, MenuSection } from '../context-menu.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import { artboardMenuSections } from '../editing/artboard-menu.tsx';
import { clipWords } from '../editing/clip-words.ts';
import {
  CLIP_ACTIONS,
  clipActionForEdit,
  isClipMarker,
  runClipAction,
} from '../editing/clipboard.ts';
import { resolveClipKey } from '../editing/object-keys.ts';
import type { CommandRecord } from '../undo-stack.ts';

const noop = () => {};
const ok = (extra: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
  ok: true,
  actionId: null,
  writeId: 'w_0123456789abcdef',
  rev: '0123456789abcdef',
  refs: [],
  ...extra,
});

function fake(result: EditOpResult) {
  const asks: Array<{ op: string; targets: unknown[]; params?: Record<string, unknown> }> = [];
  const records: CommandRecord[] = [];
  const marks: string[] = [];
  const toasts: Array<[string, string | undefined]> = [];
  return {
    asks,
    records,
    marks,
    toasts,
    deps: {
      run: async (a: { op: string; targets: unknown[]; params?: Record<string, unknown> }) => {
        asks.push(a);
        return result;
      },
      record: (r: CommandRecord) => records.push(r),
      mark: (t: string) => marks.push(t),
      select: noop,
      toast: (m: string, k?: 'info' | 'error') => toasts.push([m, k]),
    },
  };
}

const handle = {
  id: 'c_0123456789abcdef',
  kind: 'artboards' as const,
  count: 1,
  from: 'ui/Home.tsx',
};

describe('artboard.cut — registry', () => {
  test('is a canvas action with ⌘X on an artboard selection in Edit, hidden from ⌘K, on the "?" sheet', () => {
    const def = ACTIONS.find((a) => a.id === 'artboard.cut');
    expect(def).toBeDefined();
    expect(def?.exec).toBe('canvas');
    expect(def?.label).toBe('Cut artboard');
    expect(def?.search).toEqual({ hidden: true });
    expect(def?.help).toEqual({ group: 'objects', order: 904 });
    expect(def?.keys?.map((k) => k.chord)).toEqual(['⌘X']);
  });

  test('the agent writes the source itself — the clipboard is the person’s', () => {
    expect(AGENT_PATHS['artboard.cut']).toBeDefined();
  });

  test('⌘X resolves to artboard.cut on an artboard selection, object.cut on an object one', () => {
    const e = { key: 'x', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false };
    const st = (selection: 'artboard' | 'object') => ({
      typing: false,
      mode: 'edit' as const,
      selection,
      singleKeys: true,
    });
    expect(resolveClipKey(e as never, st('artboard'))).toBe('artboard.cut');
    expect(resolveClipKey(e as never, st('object'))).toBe('object.cut');
  });
});

describe('artboard.cut — the clipboard path', () => {
  test('is a clipboard action; Edit › Cut maps to it for an artboard selection', () => {
    expect(CLIP_ACTIONS).toContain('artboard.cut');
    expect(clipActionForEdit('edit.cut', { objects: [], artboards: ['a'] })).toBe('artboard.cut');
    expect(
      clipActionForEdit('edit.cut', { objects: [{ artboard: 'a', element: 'x' }], artboards: [] })
    ).toBe('object.cut');
    expect(clipActionForEdit('edit.cut', { objects: [], artboards: [] })).toBeNull();
  });

  test('asks the whole artboards, leaves the marker in the gesture, and no legacy record (the op log holds the undo)', async () => {
    const f = fake(ok({ detail: { clip: handle } }));
    let now = '';
    const r = await runClipAction(
      'artboard.cut',
      { objects: [], artboards: ['desktop', 'mobile'] },
      {
        ...f.deps,
        markNow: (t) => {
          now = t;
          return true;
        },
      }
    );
    expect(r?.ok).toBe(true);
    expect(f.asks).toEqual([
      { op: 'artboard.cut', targets: [], params: { artboards: ['desktop', 'mobile'] } },
    ]);
    expect(isClipMarker(now)).toBe(true);
    expect(now).toContain('2 artboards');
    expect(f.marks).toEqual([]); // written in the gesture, not again
    expect(f.records).toEqual([]);
  });

  test('nothing selected asks nothing', async () => {
    const f = fake(ok());
    expect(await runClipAction('artboard.cut', { objects: [], artboards: [] }, f.deps)).toBeNull();
    expect(f.asks).toEqual([]);
  });

  test('an op-log write pushes nothing here — the kernel undoes it', async () => {
    const f = fake(ok({ actionId: 'a_1', writeId: '', detail: { clip: handle } }));
    await runClipAction('artboard.cut', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.records).toEqual([]);
  });

  test('a refusal is said in the server’s words, nothing recorded', async () => {
    const f = fake({
      ok: false,
      code: 'invalid',
      message: 'A canvas keeps at least one artboard.',
    });
    await runClipAction('artboard.cut', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.toasts).toEqual([['A canvas keeps at least one artboard.', 'error']]);
    expect(f.records).toEqual([]);
  });
});

describe('artboard.cut — the shell relay', () => {
  beforeEach(() => _setHeldClip(null));
  const body = { file: '.design/ui/Home.tsx', op: 'artboard.cut', targets: [], params: {} };

  test('a cut answer’s handle becomes the clipboard (a paste elsewhere has something to paste)', () => {
    expect(CLIP_COPY_OPS.has('artboard.cut')).toBe(true);
    noteClipResult(body as never, ok({ detail: { clip: handle } }));
    expect(heldClip()).toEqual(handle);
  });

  test('the canvas hears kind + count, never the handle', () => {
    const heard = frameClipResult(body as never, ok({ detail: { clip: handle } }));
    expect(heard.ok && heard.detail).toEqual({ clip: { kind: 'artboards', count: 1 } });
  });

  test('a cut that failed leaves the clipboard as it was', () => {
    noteClipResult(body as never, { ok: false, code: 'invalid', message: 'no' });
    expect(heldClip()).toBeNull();
  });
});

describe('the artboard menu', () => {
  const v1: MenuSection[] = [
    [{ id: 'export-artboard', label: 'Export', onSelect: noop }],
    [{ id: 'delete-artboard', label: 'Delete', onSelect: noop }],
  ];
  const base = {
    duplicate: noop,
    duplicateAtWidth: noop,
    customWidth: noop,
    rename: noop,
    resetPosition: noop,
  };

  test('Cut ⌘X · Copy ⌘C · Paste ⌘V, in that order, and each runs its dep', () => {
    const ran: string[] = [];
    const secs = artboardMenuSections(v1, {
      ...base,
      cut: () => ran.push('cut'),
      copy: () => ran.push('copy'),
      paste: () => ran.push('paste'),
    });
    const group = secs.find((s) => s.some((i) => i.id === 'copy-artboard')) as MenuItem[];
    expect(group.map((i) => [i.id, i.label, i.shortcut])).toEqual([
      ['cut-artboard', 'Cut', '⌘X'],
      ['copy-artboard', 'Copy', '⌘C'],
      ['paste-artboard', 'Paste', '⌘V'],
    ]);
    for (const i of group) i.onSelect({} as never);
    expect(ran).toEqual(['cut', 'copy', 'paste']);
  });

  test('without a cut dep there is no Cut row (a viewer’s or a read-only menu)', () => {
    const secs = artboardMenuSections(v1, { ...base, copy: noop, paste: noop });
    const group = secs.find((s) => s.some((i) => i.id === 'copy-artboard')) as MenuItem[];
    expect(group.map((i) => i.id)).toEqual(['copy-artboard', 'paste-artboard']);
  });
});

describe('the words', () => {
  test('a paste that carried nothing says nothing (today’s quiet paste)', () => {
    expect(clipWords({ created: [{ artboard: 'b2', element: 'b2' }], detail: {} })).toBeNull();
    expect(
      clipWords({
        created: [{ artboard: 'b2', element: 'b2' }],
        detail: { carried: { imports: 0, decls: 0, renamed: [] } },
      })
    ).toBeNull();
  });

  test('imports, declarations and renames, in the contract’s words', () => {
    const board = [{ artboard: 'b2', element: 'b2' }];
    expect(
      clipWords({ created: board, detail: { carried: { imports: 2, decls: 0, renamed: [] } } })
    ).toBe('Pasted the artboard · added 2 imports');
    expect(
      clipWords({ created: board, detail: { carried: { imports: 1, decls: 0, renamed: [] } } })
    ).toBe('Pasted the artboard · added 1 import');
    expect(
      clipWords({
        created: board,
        detail: { carried: { imports: 0, decls: 1, renamed: [{ from: 'W', to: 'W2' }] } },
      })
    ).toBe('Pasted the artboard · added 1 declaration · renamed W to W2');
    expect(
      clipWords({
        created: [
          { artboard: 'a', element: 'a' },
          { artboard: 'b', element: 'b' },
        ],
        detail: { carried: { imports: 1, decls: 0, renamed: [] } },
      })
    ).toBe('Pasted 2 artboards · added 1 import');
    expect(
      clipWords({
        created: [{ artboard: 'a', element: 'hero' }],
        detail: { carried: { imports: 0, decls: 2, renamed: [] } },
      })
    ).toBe('Pasted the object · added 2 declarations');
  });

  test('several renames are named, then counted', () => {
    const renamed = [
      { from: 'W', to: 'W2' },
      { from: 'H', to: 'H2' },
      { from: 'nb', to: 'nb2' },
    ];
    expect(
      clipWords({
        created: [{ artboard: 'a', element: 'a' }],
        detail: { carried: { imports: 0, decls: 0, renamed } },
      })
    ).toBe('Pasted the artboard · renamed W to W2, H to H2 and 1 more');
  });

  test('a malformed carried block says nothing and throws nothing', () => {
    for (const carried of [null, 'x', 3, { imports: 'two' }, { renamed: 'W' }])
      expect(clipWords({ created: [], detail: { carried } })).toBeNull();
    expect(clipWords({ detail: undefined })).toBeNull();
  });

  test('the paste toast is said on this canvas once it is carried', async () => {
    const f = fake(
      ok({
        created: [{ artboard: 'b2', element: 'b2' }],
        detail: { carried: { imports: 2, decls: 0, renamed: [] } },
      })
    );
    await runClipAction('canvas.paste', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.toasts).toEqual([['Pasted the artboard · added 2 imports', 'info']]);
  });

  test('a plain paste toasts nothing', async () => {
    const f = fake(ok({ created: [{ artboard: 'b2', element: 'b2' }] }));
    await runClipAction('canvas.paste', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.toasts).toEqual([]);
  });
});

describe('a copy this tab does not hold', () => {
  beforeEach(() => _setHeldClip(null));
  const paste = { file: '.design/ui/About.tsx', op: 'canvas.paste', targets: [], params: {} };

  test('a browser tab keeps today’s words', () => {
    const s = shapeClipRequest(paste as never);
    expect(s).toEqual({
      kind: 'reply',
      result: { ok: false, code: 'invalid', message: NOTHING_TO_PASTE },
    });
  });

  test('a cloud tab gets the short refusal about projects on this Mac', () => {
    const s = shapeClipRequest(paste as never, { cloudTab: true });
    expect(s).toEqual({
      kind: 'reply',
      result: { ok: false, code: 'invalid', message: CELL_NO_CROSS_PROJECT },
    });
    expect(CELL_NO_CROSS_PROJECT).toBe('Paste between projects works for projects on this Mac.');
  });

  test('a cloud tab that DOES hold a copy pastes it as any tab does', () => {
    _setHeldClip(handle);
    const s = shapeClipRequest({ ...paste, file: '.design/ui/Home.tsx' } as never, {
      cloudTab: true,
    });
    expect(s.kind).toBe('forward');
  });
});
