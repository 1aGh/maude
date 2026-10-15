// V2-4.1 — the panel-layout store behind ⌘\ (Hide panels / Show panels) and View › Advanced › "Pin
// panels to the side", plus the key handler that drives it and the registry rebind (T → ⌘\).
import { describe, expect, test } from 'bun:test';
import { ACTIONS } from '../actions/index.ts';
import { chord } from '../actions/keys.ts';
import { SHELL_KEY_HANDLERS } from '../client/actions/shell-key-handlers.js';
import { createPanelLayout, PANELS_HIDDEN_HINT } from '../client/v2/shell/panel-layout.js';
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
