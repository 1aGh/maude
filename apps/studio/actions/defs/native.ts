// actions/defs/native.ts — the desktop app's own menu bar items (V2-1.3 contract §5.8; V2-3.4:
// C3's File menu, V2-1.1 §5.9 rows). The native menu is BUILT from these through the generated
// `apps/desktop/src-tauri/menu.actions.json`; the layout (order, separators, the OS items) is
// `actions/native-menu.ts`. Accelerators are owned by AppKit — no web binding exists for them
// (invariant 4).

import type { ActionDef } from '../types.ts';
import { kb } from './_v1.ts';

const DESKTOP = { shell: ['desktop' as const] };

export const NATIVE_ACTIONS: ActionDef[] = [
  {
    id: 'project.new',
    label: 'New project…',
    kind: 'command',
    // V2-1.1 §5.9: exec shell — the menu sends `menu://action {id:'project.new'}` to the focused
    // window. A project window opens IdentityBar's create dialog; Home's create sheet is the
    // target ("focus/open Home, then emit to it") once Home has one.
    exec: 'shell',
    keys: [kb('⇧⌘N', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 2 },
  },
  {
    id: 'project.open',
    label: 'Open project…',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘O', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 3 },
  },
  {
    // V2-1.1 §5.9: New Home tab (File) / Back to Home (Menu) — focus Home, or open it as a tab
    // of the focused window (`new_home_tab`).
    id: 'home.open',
    label: 'New Home tab',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘T', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 4 },
  },
  {
    id: 'app.check-updates',
    label: 'Check for updates…',
    kind: 'command',
    exec: 'native',
    native: { menu: 'App', order: 1 },
  },
];
