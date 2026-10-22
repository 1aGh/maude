// V2-4.1 — the panel-layout store behind ⌘\ (Hide panels / Show panels) and View › Advanced › "Pin
// panels to the side", plus the key handler that drives it and the registry rebind (T → ⌘\).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS } from '../actions/index.ts';
import { chord } from '../actions/keys.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';
import {
  createPanelLayout,
  PANELS_HIDDEN_HINT,
  panelOpenDecision,
} from '../client/v2/shell/panel-layout.js';
import { panelLayout } from '../client/v2/shell/use-panel-layout.js';

function rig() {
  const said: Array<Record<string, unknown>> = [];
  const unsaid: string[] = [];
  const persisted: Array<Record<string, unknown>> = [];
  const store = createPanelLayout({
    persist: (p) => persisted.push(p),
    say: (n) => said.push(n),
    unsay: (id) => unsaid.push(id),
  });
  return { store, said, unsaid, persisted };
}

describe('panel layout store', () => {
  test('starts floating and showing', () => {
    expect(rig().store.get()).toEqual({
      hidden: false,
      pinned: false,
      folded: false,
      userHidden: false,
    });
  });

  test('⌘\\ hides everything, says the voice-rule hint once, and the next press shows again', () => {
    const { store, said, unsaid } = rig();
    store.toggleHidden();
    expect(store.get().hidden).toBe(true);
    expect(said).toEqual([{ id: 'panels-hidden', title: PANELS_HIDDEN_HINT, kind: 'info' }]);
    expect(PANELS_HIDDEN_HINT).toBe('Panels hidden. Press ⌘\\ to bring them back.');
    store.toggleHidden();
    expect(store.get().hidden).toBe(false);
    expect(unsaid).toEqual(['panels-hidden']); // the hint steps away with the thing it explains
    store.show(); // idempotent
    expect(unsaid).toHaveLength(1);
  });

  test('pin persists to prefs.json pin.on; hydrate does not write back; hide survives a pin toggle', () => {
    const { store, persisted } = rig();
    store.hide();
    store.setPinned(true);
    expect(store.get()).toEqual({ hidden: true, pinned: true, folded: false, userHidden: true });
    expect(persisted).toEqual([{ pin: { on: true } }]);
    store.setPinned(true); // no change → no write
    expect(persisted).toHaveLength(1);
    store.hydrate({ pin: { on: false } });
    expect(store.get().pinned).toBe(false);
    expect(persisted).toHaveLength(1);
    store.hydrate({ pin: {} });
    store.hydrate(null);
    expect(store.get().pinned).toBe(false);
  });

  test('subscribers hear a real change only', () => {
    const { store } = rig();
    let n = 0;
    const off = store.subscribe(() => n++);
    store.show(); // no-op
    store.hide();
    store.hide(); // no-op
    store.togglePinned();
    off();
    store.show();
    expect(n).toBe(2);
  });
});

describe('⌘\\ in the registry and the shell handler', () => {
  test('view.panels is ⌘\\ and no longer T; view.pin-panels exists with no key', () => {
    const panels = ACTIONS.find((a) => a.id === 'view.panels');
    const keys = (panels?.keys ?? []).map((b) => JSON.stringify(b.chord));
    expect(keys).toContain(JSON.stringify(chord('⌘\\')));
    expect(keys).not.toContain(JSON.stringify(chord('T')));
    const pin = ACTIONS.find((a) => a.id === 'view.pin-panels');
    expect(pin?.label).toBe('Pin panels to the side');
    expect(pin?.keys ?? []).toHaveLength(0);
  });

  test('the view.panels handler toggles the layout store, not the Files panel', () => {
    let prevented = 0;
    let treeToggles = 0;
    const before = panelLayout.get().hidden;
    SHELL_KEY_HANDLERS['view.panels'](
      { togglePanel: () => treeToggles++ },
      { event: { preventDefault: () => prevented++ } }
    );
    expect(panelLayout.get().hidden).toBe(!before);
    expect(prevented).toBe(1);
    expect(treeToggles).toBe(0);
    panelLayout.show();
  });
});

// P8 C5 (04 R4) — Preview's fold holds whatever opens: only leaving Preview or a corner icon ends it.
describe('panelOpenDecision — a panel opening while the panels are not showing', () => {
  const none = { l: null, r: null, ai: false };
  const dec = (a: Parameters<typeof panelOpenDecision>[0]) => panelOpenDecision(a);
  test('⌘\\ hidden: any opening brings every panel back (unchanged)', () => {
    expect(
      dec({ prev: none, next: { ...none, l: 'canvases' }, userHidden: true, folded: false }).show
    ).toBe(true);
    expect(
      dec({ prev: none, next: { ...none, ai: true }, userHidden: true, folded: true }).show
    ).toBe(true);
  });
  test('Preview fold: a canvas open, the Comment tool, a ⌘-click or an AI prompt never unfolds', () => {
    for (const next of [
      { ...none, l: 'canvases' },
      { ...none, r: 'comments' },
      { ...none, r: 'inspector' },
      { ...none, ai: true },
    ])
      expect(dec({ prev: none, next, userHidden: false, folded: true }).show).toBe(false);
  });
  test('Preview fold: a right panel opened DURING the fold shows by itself; one carried in from Edit does not', () => {
    const inspect = { ...none, r: 'inspector' };
    expect(dec({ prev: none, next: inspect, userHidden: false, folded: true }).rightInFold).toBe(
      true
    );
    // the Inspector was open in Edit: entering Preview folds it (no change of id → not opened in the fold)
    expect(dec({ prev: inspect, next: inspect, userHidden: false, folded: true }).rightInFold).toBe(
      false
    );
    // kept while it stays open; closing it or leaving the fold ends it
    expect(
      dec({ prev: inspect, next: inspect, userHidden: false, folded: true, rightInFold: true })
        .rightInFold
    ).toBe(true);
    expect(
      dec({ prev: inspect, next: none, userHidden: false, folded: true, rightInFold: true })
        .rightInFold
    ).toBe(false);
    expect(
      dec({ prev: inspect, next: inspect, userHidden: false, folded: false, rightInFold: true })
        .rightInFold
    ).toBe(false);
  });
  test('the shell asks it (app.jsx) instead of unfolding on any opening', () => {
    const app = readFileSync(join(import.meta.dir, '../client/app.jsx'), 'utf8');
    expect(app).toContain('panelOpenDecision(');
  });
});
