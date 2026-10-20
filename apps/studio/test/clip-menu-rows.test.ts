// S7.9 — the clip right-click menu keeps all 17 v1 items (Gate 0 D15, S7-slices Q16): six drawn as plain rows,
// the other eleven under Advanced ▸, in a fixed order. Every row is a registry action `timeline.clip-menu.<id>`.

import { describe, expect, test } from 'bun:test';

import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS, ACTIONS_BY_ID } from '../actions/index.ts';
import {
  CLIP_MENU_ROWS,
  clipMenuActionId,
  clipMenuModel,
} from '../client/v2/timeline/edit/clip-menu.js';

const GOLDEN = [
  // drawn (6)
  'comment',
  'generate',
  'adjust',
  'hide',
  'show',
  'remove',
  // Advanced ▸ (11)
  'replace',
  'mute',
  'unmute',
  'detach-audio',
  'to-overlay',
  'to-storyline',
  'layer-up',
  'layer-down',
  'earlier',
  'later',
  'replace-layer',
];

const ALL = {
  comment: true,
  generate: true,
  verb: true,
  replace: true,
  reorder: true,
  hide: true,
  remove: true,
  replaceLayer: true,
};
const video = {
  stableId: 'a',
  label: 'Touchdown',
  series: true,
  mediaSrc: 'assets/t.mp4',
  mediaProps: { muted: false },
  replaceable: true,
};
const model = (seq: object, env: object = {}) =>
  clipMenuModel({ seq, index: 1, count: 4, has: ALL, rowKind: 'video', zLadder: null, ...env });
const ids = (m: { plain: { id: string }[]; advanced: { id: string }[] }) => [
  ...m.plain.map((r) => r.id),
  ...m.advanced.map((r) => r.id),
];

describe('17 rows, golden order', () => {
  test('the rows are the 17 v1 items: 6 drawn, 11 under Advanced, in this order', () => {
    expect(CLIP_MENU_ROWS.map((r) => r.id)).toEqual(GOLDEN);
    expect(CLIP_MENU_ROWS.filter((r) => r.drawn).length).toBe(6);
    expect(CLIP_MENU_ROWS.filter((r) => !r.drawn).length).toBe(11);
    expect(
      CLIP_MENU_ROWS.every((r) => clipMenuActionId(r.id) === `timeline.clip-menu.${r.id}`)
    ).toBe(true);
  });

  test('a menu keeps the golden order whatever the clip', () => {
    const order = (list: string[]) => list.map((id) => GOLDEN.indexOf(id));
    for (const m of [
      model(video),
      model({ ...video, mediaProps: { muted: true }, hidden: true }),
      model({ ...video, series: false }, { zLadder: { docIdx: 1, len: 3 } }),
      model({ ...video, placeholder: { kind: 'veo' } }),
    ]) {
      const o = order(ids(m));
      expect(o).toEqual([...o].sort((a, b) => a - b));
      expect(m.plain.every((r) => CLIP_MENU_ROWS.find((x) => x.id === r.id)?.drawn)).toBe(true);
      expect(m.advanced.every((r) => !CLIP_MENU_ROWS.find((x) => x.id === r.id)?.drawn)).toBe(true);
    }
  });

  test('together the situations reach all 17: nothing the old menu could do is lost', () => {
    const seen = new Set<string>();
    const add = (m: Parameters<typeof ids>[0]) => ids(m).forEach((i) => seen.add(i));
    add(model(video)); // series video, audible
    add(model({ ...video, mediaProps: { muted: true }, hidden: true })); // muted + hidden
    add(model({ ...video, series: false }, { zLadder: { docIdx: 1, len: 3 } })); // overlay layer
    add(model({ ...video, placeholder: { kind: 'veo' } })); // AI slate
    add(
      model(
        { ...video, layers: [{ kind: 'image', mediaCdId: 'x' }, { kind: 'video' }] },
        { layerIndex: 0 }
      )
    );
    expect([...seen].sort()).toEqual([...GOLDEN].sort());
  });
});

describe('what each situation shows', () => {
  test('a series video: move to the overlay layer, mute and detach, earlier / later by beat', () => {
    const m = model(video);
    expect(ids(m)).toEqual([
      'comment',
      'adjust',
      'hide',
      'remove',
      'replace',
      'mute',
      'detach-audio',
      'to-overlay',
      'earlier',
      'later',
    ]);
  });

  test('the first beat cannot go earlier, the last cannot go later (greyed, not gone)', () => {
    const first = model(video, { index: 0 });
    expect(first.advanced.find((r) => r.id === 'earlier')?.disabled).toBe(true);
    expect(first.advanced.find((r) => r.id === 'later')?.disabled).toBeFalsy();
    const last = model(video, { index: 3 });
    expect(last.advanced.find((r) => r.id === 'later')?.disabled).toBe(true);
  });

  test('a hidden clip offers Show, a muted one Unmute; Remove is the destructive row', () => {
    const m = model({ ...video, hidden: true, mediaProps: { muted: true } });
    expect(ids(m)).toContain('show');
    expect(ids(m)).not.toContain('hide');
    expect(ids(m)).toContain('unmute');
    expect(ids(m)).not.toContain('mute');
    expect(m.plain.find((r) => r.id === 'remove')?.destructive).toBe(true);
  });

  test('an overlay layer: layer up / down by its place in the stack, bring forward / send backward', () => {
    const m = model({ ...video, series: false }, { zLadder: { docIdx: 0, len: 3 } });
    expect(m.advanced.find((r) => r.id === 'layer-down')?.disabled).toBe(true);
    expect(m.advanced.find((r) => r.id === 'layer-up')?.disabled).toBeFalsy();
    expect(m.advanced.find((r) => r.id === 'earlier')?.label).toBe('Bring forward');
    expect(m.advanced.find((r) => r.id === 'to-storyline')).toBeTruthy();
  });

  test('a loose media row has one disabled note and nothing to do', () => {
    const m = model({ ...video, loose: true });
    expect(m.plain.length).toBe(1);
    expect(m.plain[0].disabled).toBe(true);
    expect(m.advanced).toEqual([]);
  });

  test('a layer inside a clip offers only Replace <kind>', () => {
    const m = model(
      { ...video, layers: [{ kind: 'image', mediaCdId: 'x' }, { kind: 'video' }] },
      { layerIndex: 0 }
    );
    expect(m.plain).toEqual([]);
    expect(m.advanced.map((r) => r.id)).toEqual(['replace-layer']);
    expect(m.advanced[0].label).toBe('Replace image…');
  });
});

describe('every row is a registry action with an agent path', () => {
  test('timeline.clip-menu.<id> × 17, in the menu’s order, none of them human-only', () => {
    const inRegistry = ACTIONS.map((a) => a.id).filter((id) =>
      id.startsWith('timeline.clip-menu.')
    );
    expect(inRegistry).toEqual(GOLDEN.map((id) => clipMenuActionId(id)));
    for (const id of inRegistry) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def?.exec).toBe('shell');
      expect(def?.search?.hidden).toBe(true); // the clip menu runs it, not ⌘K
      const ai = (AGENT_PATHS as Record<string, { agent: { path: string } } | undefined>)[id];
      expect(ai).toBeTruthy();
      expect(ai?.agent.path).not.toBe('human');
    }
  });

  test('Can comment may comment on a clip; everything else needs Can edit', () => {
    const role = (id: string) =>
      (ACTIONS_BY_ID.get(clipMenuActionId(id))?.enabled as { minRole?: string } | undefined)
        ?.minRole;
    expect(role('comment')).toBe('comment');
    for (const id of GOLDEN.filter((i) => i !== 'comment')) expect(role(id)).toBe('edit');
  });

  test('the three gestures are registry actions too, edit-op writes', () => {
    for (const id of ['timeline.trim', 'timeline.move-clip', 'timeline.add-clips']) {
      expect(ACTIONS_BY_ID.get(id)).toBeTruthy();
      const ai = (AGENT_PATHS as Record<string, { server?: { route: string }; minRole?: string }>)[
        id
      ];
      expect(ai?.server?.route).toBe('/_api/edit-op');
      expect(ai?.minRole).toBe('edit');
    }
  });
});
