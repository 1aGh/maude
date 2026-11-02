// S1.8 — the Trash's words, pure: the header count, Today / Earlier, a row's name and sub, what each
// restore / clear-out answer is called, and the clear-out confirm (CONTRACT §3–§4, pn-trash).
import { describe, expect, test } from 'bun:test';
import {
  ARTBOARD_NOT_YET_LINE,
  clearOutcome,
  clearOutDialog,
  folderOf,
  groupTrash,
  itemName,
  itemSub,
  restoreOutcome,
  trashHeadCount,
  whenLabel,
  whoLabel,
} from '../client/v2/left-panel/trash-model.js';

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m, d, h, min, 0).getTime();

const AHOJ = {
  id: 'canvas:e1',
  kind: 'canvas',
  group: 'today',
  path: 'ahoj.tsx',
  actor: 'local:m1',
  at: NOW - 5_000,
};
const ARCH = {
  id: 'artboard:a1/arch2',
  kind: 'artboard',
  group: 'today',
  path: 'ui/Combine-kampan.tsx',
  artboard: 'arch2',
  label: 'Arch 2 · vnitřek',
  actor: 'hub:jonas',
  who: 'Jonas',
  at: at(9, 18, 14, 5),
};
const OLD = {
  id: 'canvas:e2',
  kind: 'canvas',
  group: 'earlier',
  path: 'legacy/letak-nabor-2022-old.tsx',
  actor: 'hub:tereza',
  who: 'Tereza',
  at: at(9, 3),
};

describe('S1.8 trash model — words', () => {
  test('the header count writes the real noun and leaves out a part that is not there', () => {
    expect(trashHeadCount([AHOJ, OLD, ARCH])).toBe('2 canvases · 1 artboard');
    expect(trashHeadCount([AHOJ])).toBe('1 canvas');
    expect(trashHeadCount([ARCH, { ...ARCH, id: 'artboard:a1/b' }])).toBe('2 artboards');
    expect(trashHeadCount([])).toBe('');
  });

  test('Today and Earlier keep the server order and leave an empty group out', () => {
    const g = groupTrash([AHOJ, ARCH, OLD], NOW);
    expect(g.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([
      ['Today', ['canvas:e1', 'artboard:a1/arch2']],
      ['Earlier', ['canvas:e2']],
    ]);
    expect(groupTrash([OLD], NOW).map((x) => x.title)).toEqual(['Earlier']);
    // no `group` from the server: today is decided by the calendar day
    expect(groupTrash([{ ...AHOJ, group: undefined }], NOW)[0]?.title).toBe('Today');
  });

  test('times: just now · 14:05 today · 3 Oct before today (the year only when it differs)', () => {
    expect(whenLabel(NOW - 5_000, NOW)).toBe('just now');
    expect(whenLabel(at(9, 18, 14, 5), NOW)).toBe('14:05');
    expect(whenLabel(at(9, 3), NOW)).toBe('3 Oct');
    expect(whenLabel(new Date(2025, 8, 28, 9, 0).getTime(), NOW)).toBe('28 Sep 2025');
  });

  test('who: You for this person, the server’s name, a people map, else Someone — never an id', () => {
    expect(whoLabel({ ...OLD, mine: true })).toBe('You');
    expect(whoLabel(OLD)).toBe('Tereza');
    expect(whoLabel({ actor: 'hub:x' }, { 'hub:x': 'Marek' })).toBe('Marek');
    expect(whoLabel({ actor: 'local:m1' })).toBe('You');
    expect(whoLabel({ actor: 'hub:9f3a' })).toBe('Someone');
  });

  test('a canvas row names its folder without the canvas group prefix (S1.23: "legacy", not "ui/legacy")', () => {
    const inUi = { ...OLD, path: 'ui/legacy/letak-nabor-2022-old.tsx' };
    expect(itemSub(inUi, { now: NOW })).toBe('legacy · Tereza, 3 Oct');
    expect(itemSub({ ...AHOJ, path: 'ui/ahoj.tsx' }, { now: NOW })).toBe('root · You, just now');
    expect(itemSub({ ...OLD, path: 'ui/2026/social/a.tsx' }, { now: NOW })).toBe(
      '2026/social · Tereza, 3 Oct'
    );
    // the project's own groups, when it names them
    expect(itemSub({ ...OLD, path: 'screens/web/a.tsx' }, { now: NOW, roots: ['screens'] })).toBe(
      'web · Tereza, 3 Oct'
    );
    expect(folderOf('ui/a.tsx')).toBe('root');
    expect(folderOf('ui/a/b/c.tsx')).toBe('a/b');
    // outside every group: as it is
    expect(folderOf('notes/a.tsx')).toBe('notes');
  });

  test('a row: name and the sub of pn-trash', () => {
    expect(itemName(AHOJ)).toBe('ahoj');
    expect(itemSub(AHOJ, { now: NOW })).toBe('root · You, just now');
    expect(itemName(ARCH)).toBe('Arch 2 · vnitřek');
    expect(itemSub(ARCH, { now: NOW })).toBe('artboard of Combine-kampan · Jonas, 14:05');
    expect(itemSub(OLD, { now: NOW })).toBe('legacy · Tereza, 3 Oct');
    expect(itemSub({ ...ARCH, canvasTrashed: true }, { now: NOW })).toContain('(in the trash)');
    // an artboard with no label is its id
    expect(itemName({ ...ARCH, label: null })).toBe('arch2');
  });

  test('the clear-out confirm: title and primary are the same verb, the body counts what goes', () => {
    const d = clearOutDialog([AHOJ, OLD, { ...OLD, id: 'canvas:e3' }, ARCH], 'Alligators brand');
    expect(d.title).toBe('Clear out the trash?');
    expect(d.primary).toBe('Clear out');
    expect(d.body).toBe(
      '3 canvases and 1 artboard go for good — for everyone on Alligators brand. Restore can’t bring them back after this.'
    );
    // a local project has no one else to name; one thing reads as one
    expect(clearOutDialog([AHOJ], '').body).toBe(
      '1 canvas goes for good. Restore can’t bring it back after this.'
    );
  });

  test('restore answers: ok, renamed, queued, not-yet (quiet), cleared, forbidden', () => {
    expect(restoreOutcome(AHOJ, { status: 200, body: { ok: true, path: 'ahoj.tsx' } }).line).toBe(
      'Restored “ahoj”.'
    );
    expect(
      restoreOutcome(AHOJ, { status: 200, body: { ok: true, path: 'ahoj 2.tsx', renamed: true } })
        .line
    ).toBe('Restored as “ahoj 2”.');
    expect(restoreOutcome(AHOJ, { status: 202, body: { ok: true, queued: true } }).line).toContain(
      'queued'
    );
    const notYet = restoreOutcome(ARCH, {
      status: 501,
      body: { ok: false, reason: 'not-yet', line: ARTBOARD_NOT_YET_LINE },
    });
    expect(notYet).toMatchObject({ ok: false, notYet: true, tone: 'quiet' });
    expect(notYet.line).toBe(`${ARTBOARD_NOT_YET_LINE}.`);
    // the server sent no line: the view has the same words
    expect(restoreOutcome(ARCH, { status: 501, body: null }).line).toBe(
      `${ARTBOARD_NOT_YET_LINE}.`
    );
    expect(restoreOutcome(AHOJ, { status: 409, body: { reason: 'cleared' } }).line).toContain(
      'cleared out'
    );
    expect(restoreOutcome(AHOJ, { status: 403, body: { reason: 'forbidden' } }).ok).toBe(false);
    // no answer at all (fetch threw) says nothing was changed
    expect(restoreOutcome(AHOJ, { status: 0, body: { reason: 'unreachable' } }).line).toContain(
      'Nothing was changed'
    );
  });

  test('clear-out answers: count, what stayed, the 403 line, queued', () => {
    expect(clearOutcome({ status: 200, body: { ok: true, cleared: ['a', 'b', 'c'] } }).line).toBe(
      'Cleared out 3.'
    );
    expect(
      clearOutcome({
        status: 200,
        body: { ok: true, cleared: ['a'], skipped: [{ id: 'b', reason: 'x' }] },
      }).line
    ).toBe('Cleared out 1. 1 left as it was.');
    const refused = clearOutcome({ status: 403, body: { ok: false, reason: 'forbidden' } });
    expect(refused).toMatchObject({
      ok: false,
      line: 'Only an owner clears out the trash. Nothing was changed.',
    });
    expect(clearOutcome({ status: 202, body: { ok: true, queued: true } }).line).toContain(
      'queued'
    );
  });
});
