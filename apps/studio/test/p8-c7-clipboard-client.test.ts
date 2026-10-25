// V2-clipboard-objects — the canvas and shell halves: Cut / Copy / Paste go through the ONE edit-op path
// (`runEditOp` → the shell relay → POST /_api/edit-op), a cut and a paste each push ONE revert record on the
// canvas's undo stack (a copy pushes none), the shell — never the canvas — names what is pasted, and a clip
// from another canvas waits for the shell's own confirm. The menus carry exactly the rows 14 draws.

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  _setHeldClip,
  heldClip,
  NOTHING_TO_PASTE,
  noteClipResult,
  shapeClipRequest,
} from '../client/clipboard-relay.ts';
import type { MenuItem, MenuSection } from '../context-menu.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import { artboardMenuSections } from '../editing/artboard-menu.tsx';
import { clipActionForEdit, isClipMarker, runClipAction } from '../editing/clipboard.ts';
import { EDIT_OP_KIND } from '../editing/edit-op.ts';
import { objectMenuSections } from '../editing/object-menu.tsx';
import type { CommandRecord } from '../undo-stack.ts';

const ok = (extra: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
  ok: true,
  actionId: null,
  writeId: 'w_0123456789abcdef',
  rev: '0123456789abcdef',
  refs: [],
  ...extra,
});

function fakeDeps(result: EditOpResult) {
  const asks: Array<{ op: string; targets: unknown[]; params?: Record<string, unknown> }> = [];
  const records: CommandRecord[] = [];
  const marks: string[] = [];
  const selected: unknown[] = [];
  return {
    asks,
    records,
    marks,
    selected,
    deps: {
      run: async (a: { op: string; targets: unknown[]; params?: Record<string, unknown> }) => {
        asks.push(a);
        return result;
      },
      record: (r: CommandRecord) => records.push(r),
      mark: (t: string) => marks.push(t),
      select: (c: unknown) => selected.push(c),
      toast: () => {},
    },
  };
}

const obj = { artboard: 'desktop', element: 'title' };
const handle = {
  id: 'c_0123456789abcdef',
  kind: 'objects' as const,
  count: 1,
  from: 'ui/Home.tsx',
};

describe('runClipAction — one edit-op, one undo step', () => {
  test('paste asks `canvas.paste` on the edit-op path and pushes ONE edit-op undo record', async () => {
    const f = fakeDeps(ok({ created: [{ artboard: 'desktop', element: 'brand-systems' }] }));
    await runClipAction('canvas.paste', { objects: [obj], artboards: [] }, f.deps);
    expect(f.asks).toEqual([
      { op: 'canvas.paste', targets: [obj], params: { artboard: 'desktop' } },
    ]);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      kind: EDIT_OP_KIND,
      label: 'Paste',
      payload: { writeId: 'w_0123456789abcdef' },
    });
    expect(f.selected).toHaveLength(1);
  });

  test('the canvas never names what is pasted', async () => {
    const f = fakeDeps(ok());
    await runClipAction('canvas.paste', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.asks[0]?.params).not.toHaveProperty('clip');
  });

  test('cut is one undo step; copy is none and leaves the marker', async () => {
    const cut = fakeDeps(ok({ detail: { clip: handle } }));
    await runClipAction('object.cut', { objects: [obj], artboards: [] }, cut.deps);
    expect(cut.records.map((r) => r.label)).toEqual(['Cut']);
    const copy = fakeDeps(ok({ writeId: '', detail: { clip: handle } }));
    await runClipAction('object.copy', { objects: [obj], artboards: [] }, copy.deps);
    expect(copy.records).toEqual([]);
    expect(copy.marks).toHaveLength(1);
    expect(isClipMarker(copy.marks[0])).toBe(true);
  });

  test('⌘C on an artboard selection copies the artboards', async () => {
    const f = fakeDeps(ok({ writeId: '' }));
    await runClipAction('object.copy', { objects: [], artboards: ['desktop'] }, f.deps);
    expect(f.asks[0]).toEqual({
      op: 'artboard.copy',
      targets: [],
      params: { artboards: ['desktop'] },
    });
  });

  test('an op-log write (actionId) pushes nothing here — the kernel undoes it', async () => {
    const f = fakeDeps(ok({ actionId: 'a_1', writeId: '' }));
    await runClipAction('canvas.paste', { objects: [obj], artboards: [] }, f.deps);
    expect(f.records).toEqual([]);
  });

  test('Edit › Cut / Copy / Paste map to the clipboard for the selection', () => {
    expect(clipActionForEdit('edit.copy', { objects: [obj], artboards: [] })).toBe('object.copy');
    expect(clipActionForEdit('edit.copy', { objects: [], artboards: ['a'] })).toBe('artboard.copy');
    expect(clipActionForEdit('edit.cut', { objects: [], artboards: ['a'] })).toBeNull();
    expect(clipActionForEdit('edit.paste', { objects: [], artboards: [] })).toBe('canvas.paste');
  });
});

describe('the shell holds the clipboard', () => {
  beforeEach(() => _setHeldClip(null));
  const paste = (file: string, params: Record<string, unknown> = {}) => ({
    file,
    op: 'canvas.paste',
    targets: [],
    params,
  });

  test('nothing held: refused in the shell, nothing forwarded', () => {
    const s = shapeClipRequest(paste('.design/ui/Home.tsx'));
    expect(s).toEqual({
      kind: 'reply',
      result: { ok: false, code: 'invalid', message: NOTHING_TO_PASTE },
    });
  });

  test('a copy answer becomes the clipboard; a paste names the SHELL handle, whatever the canvas sent', () => {
    noteClipResult(
      { file: '.design/ui/Home.tsx', op: 'object.copy', targets: [] },
      ok({ writeId: '', detail: { clip: handle } })
    );
    expect(heldClip()).toEqual(handle);
    const s = shapeClipRequest(paste('.design/ui/Home.tsx', { clip: 'c_ffffffffffffffff' }));
    expect(s.kind).toBe('forward');
    expect(s.kind === 'forward' && s.body.params?.clip).toBe(handle.id);
  });

  test('a clip from another canvas is not run on the canvas’s word: queued + the shell asks', () => {
    _setHeldClip(handle);
    const s = shapeClipRequest(paste('.design/ui/Other.tsx'));
    expect(s.kind).toBe('confirm');
    if (s.kind !== 'confirm') return;
    expect(s.line).toBe('Paste the object copied in Home?');
    expect(s.reply).toMatchObject({ ok: true, writeId: '', queued: true });
    expect(s.body.params?.clip).toBe(handle.id);
  });

  test('a malformed handle, a failed copy or another op never changes the clipboard', () => {
    _setHeldClip(handle);
    noteClipResult(
      { file: 'f', op: 'object.copy', targets: [] },
      ok({ detail: { clip: { id: 'x' } } })
    );
    noteClipResult(
      { file: 'f', op: 'object.lock', targets: [] },
      ok({ detail: { clip: { ...handle, id: 'c_1111111111111111' } } })
    );
    noteClipResult(
      { file: 'f', op: 'object.copy', targets: [] },
      { ok: false, code: 'invalid', message: 'no' }
    );
    expect(heldClip()).toEqual(handle);
  });
});

// ── the menus 14 draws ────────────────────────────────────────────────────────────────────────

const noop = () => {};
const labels = (secs: MenuSection[]) => secs.map((s) => s.map((i: MenuItem) => i.label));

describe('menus', () => {
  test('object menu: Cut ⌘X · Copy ⌘C · Paste ⌘V lead the Duplicate group, and run the clipboard', () => {
    const ran: string[] = [];
    const v1: MenuSection[] = [[{ id: 'duplicate-element', label: 'Duplicate', onSelect: noop }]];
    const secs = objectMenuSections(v1, {
      elementsFor: () => [],
      run: noop,
      selectMatching: noop,
      clip: (a) => ran.push(a),
    });
    const group = secs.find((s) => s.some((i) => i.id === 'duplicate-element')) as MenuItem[];
    expect(group.slice(0, 4).map((i) => [i.label, i.shortcut])).toEqual([
      ['Cut', '⌘X'],
      ['Copy', '⌘C'],
      ['Paste', '⌘V'],
      ['Duplicate', '⌘D'],
    ]);
    for (const i of group.slice(0, 3)) i.onSelect({} as never);
    expect(ran).toEqual(['object.cut', 'object.copy', 'canvas.paste']);
  });

  test('artboard menu: exactly the rows ed-ab-menu draws (no Add comment, vote or Advanced)', () => {
    const v1: MenuSection[] = [
      [{ id: 'add-comment', label: 'Add comment', onSelect: noop }],
      [{ id: 'fit-one', label: 'Fit just this artboard', onSelect: noop }],
      [{ id: 'export-artboard', label: 'Export', onSelect: noop }],
      [{ id: 'delete-artboard', label: 'Delete', onSelect: noop }],
    ];
    const secs = artboardMenuSections(v1, {
      duplicate: noop,
      duplicateAtWidth: noop,
      customWidth: noop,
      rename: noop,
      resetPosition: noop,
      copy: noop,
      paste: noop,
    });
    expect(labels(secs)).toEqual([
      ['Ask AI about this artboard'],
      ['Duplicate', 'Duplicate at another width', 'Rename'],
      ['Copy', 'Paste'],
      ['Export…'],
      ['Move to trash'],
    ]);
  });
});
