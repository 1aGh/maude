// S9.24 — the words of a day offline, of coming back, and of the sticky two Macs changed
// (client/v2/sync-states/, 10 · co-sync-offline, co-sync-back, co-conflict).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const model = () => import('../client/v2/sync-states/sync-states-model.js');
const NOW = new Date(2026, 9, 18, 9, 15).getTime();
const YESTERDAY = new Date(2026, 9, 17, 18, 20).getTime();

const row = (mine: string | null, theirs: string | null, author = 'Jonas Novák') => ({
  slug: 'ui-uniformy-2027',
  file: '.design/ui/Uniformy-2027.tsx',
  id: 's1',
  type: 'sticky',
  fields: ['text'],
  mine: mine === null ? null : { id: 's1', type: 'sticky', text: mine, author: { name: 'Michal' } },
  theirs:
    theirs === null ? null : { id: 's1', type: 'sticky', text: theirs, author: { name: author } },
  at: NOW,
});

describe('syncFoot (pure)', () => {
  test('offline with changes kept: "14 changes since yesterday 18:20 — kept on this Mac"', async () => {
    const { syncFoot } = await model();
    expect(syncFoot({ kind: 'offline', pending: 14, since: YESTERDAY, now: NOW })).toEqual({
      // P8 C7: no warn tone — the foot is fg-2 (`.k-cp-foot`); the warn colour is the cluster word's
      text: '14 changes since yesterday 18:20 — kept on this Mac',
    });
    expect(syncFoot({ kind: 'offline', pending: 1, since: null, now: NOW })?.text).toBe(
      '1 change — kept on this Mac'
    );
  });

  test('back online: "Sending 14 changes · 9 sent"; nothing waiting → no foot (the panel says its own)', async () => {
    const { syncFoot } = await model();
    expect(syncFoot({ kind: 'syncing', pending: 5, peak: 14 })?.text).toBe(
      'Sending 14 changes · 9 sent'
    );
    for (const s of [
      { kind: 'saved', pending: 0 },
      { kind: 'offline', pending: 0 },
      { kind: 'syncing', pending: 0, peak: 14 },
      { kind: 'local', pending: 3 },
    ])
      expect(syncFoot(s)).toBeNull();
  });

  test('the foot wins the panel: S9.24 publishes the `sync` foot, ahead of arriving', async () => {
    const slots = await import('../client/v2/canvases/row-slots.js');
    slots.resetRowSlots();
    slots.setFootSlot('arriving', { text: 'Getting Alligators brand · 41 of 93 canvases' });
    slots.setFootSlot('sync', { text: '14 changes since yesterday 18:20 — kept on this Mac' });
    expect(slots.getRowSlots().foot?.source).toBe('sync');
    slots.resetRowSlots();
  });
});

describe('backOnlineToast (pure)', () => {
  test('names the sticky only when a conflict waits, and only then offers Show', async () => {
    const { backOnlineToast, cameBackOnline } = await model();
    expect(backOnlineToast({ conflicts: 0 })).toEqual({
      title: 'Back online. Your changes are going up.',
      action: null,
    });
    expect(backOnlineToast({ conflicts: 1 })).toEqual({
      title: 'Back online. Your changes are going up; one sticky needs a look.',
      action: 'Show',
    });
    expect(backOnlineToast({ conflicts: 2 }).title).toContain('2 stickies need a look');
    expect(cameBackOnline('offline', 'syncing')).toBe(true);
    expect(cameBackOnline('offline', 'saved')).toBe(true);
    expect(cameBackOnline('saved', 'syncing')).toBe(false);
    expect(cameBackOnline('offline', 'offline')).toBe(false);
  });
});

describe('conflictCard (pure) — both directions', () => {
  test('you lost to Jonas: yours beside Jonas’s, Keep Jonas’s', async () => {
    const { conflictCard } = await model();
    const c = conflictCard(row('Číslo na zádech větší — 30 cm', 'Číslo 25 cm'), { me: 'Michal' });
    expect(c.title).toBe('You and Jonas both changed this sticky while offline.');
    expect([c.mine.text, c.theirs.text]).toEqual(['Číslo na zádech větší — 30 cm', 'Číslo 25 cm']);
    expect([c.keepMine, c.keepTheirs, c.keepBoth]).toEqual([
      'Keep yours',
      "Keep Jonas's",
      'Keep both',
    ]);
  });

  test('Jonas lost to you (his Mac): the card names you, never "You and You"', async () => {
    const { conflictCard } = await model();
    const c = conflictCard(row('Číslo 25 cm', 'Číslo na zádech větší — 30 cm', 'Michal Dovrtěl'), {
      me: 'Jonas',
    });
    expect(c.title).toBe('You and Michal both changed this sticky while offline.');
    const own = conflictCard(row('a', 'b', 'Michal'), { me: 'Michal' });
    expect(own.title).toBe('This sticky was changed on two Macs while you were offline.');
    expect(own.keepTheirs).toBe('Keep theirs');
  });

  test('a deleted side has no Keep both', async () => {
    const { conflictCard } = await model();
    expect(conflictCard(row(null, 'b'), {}).keepBoth).toBeNull();
    expect(conflictCard(row('a', null), {}).keepBoth).toBeNull();
  });

  test('conflictsFor: the active canvas only, repo- or designRoot-relative', async () => {
    const { conflictsFor } = await model();
    const list = [row('a', 'b'), { ...row('c', 'd'), file: '.design/ui/Other.tsx' }];
    expect(conflictsFor(list, 'ui/Uniformy-2027.tsx').length).toBe(1);
    expect(conflictsFor(list, '.design/ui/Uniformy-2027.tsx').length).toBe(1);
    expect(conflictsFor(list, null)).toEqual([]);
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

async function mount(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

describe('ConflictCard (render)', () => {
  test('draws both versions and runs the three registry picks', async () => {
    const { ConflictCard } = await import('../client/v2/sync-states/conflict-card.jsx');
    const picks: string[] = [];
    const el = await mount(
      <ConflictCard
        conflicts={[row('Číslo na zádech větší — 30 cm', 'Číslo 25 cm')]}
        me="Michal"
        onPick={(_c: unknown, a: string) => picks.push(a)}
        onClose={() => {}}
      />
    );
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    expect(q('sync-conflict-card')).toBeTruthy();
    expect(q('sync-conflict-mine').textContent).toContain('Číslo na zádech větší — 30 cm');
    expect(q('sync-conflict-theirs').textContent).toContain('Číslo 25 cm');
    for (const id of [
      'sync-conflict-keep-mine',
      'sync-conflict-keep-theirs',
      'sync-conflict-keep-both',
    ])
      await act(async () => q(id).click());
    expect(picks).toEqual([
      'sync.conflict.keep-mine',
      'sync.conflict.keep-theirs',
      'sync.conflict.keep-both',
    ]);
  });

  test('a person who cannot edit sees both versions, every pick disabled', async () => {
    const { ConflictCard } = await import('../client/v2/sync-states/conflict-card.jsx');
    const el = await mount(
      <ConflictCard conflicts={[row('a', 'b')]} canEdit={false} onPick={() => {}} />
    );
    const buttons = [...el.querySelectorAll('[data-action]')] as HTMLButtonElement[];
    expect(buttons.length).toBe(3);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });

  test('the "2 versions" mark marks this Mac’s version until the pick', async () => {
    const { ConflictMark } = await import('../client/v2/sync-states/conflict-card.jsx');
    let opened = 0;
    const el = await mount(<ConflictMark count={1} me="Michal" onOpen={() => opened++} />);
    const mark = el.querySelector('[data-testid="sync-conflict-mark"]') as HTMLElement;
    expect(mark.textContent).toContain('2 versions');
    await act(async () => mark.click());
    expect(opened).toBe(1);
  });
});
