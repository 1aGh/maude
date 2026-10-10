// actions/defs/native.ts — the desktop app's own menu bar items (V2-1.3 contract §5.8; V2-2.4
// step 6: v1's menu.rs items, same ids and keys). The native menu is BUILT from these through the
// generated `apps/desktop/src-tauri/menu.actions.json`; the layout (order, separators, the OS
// items) is `actions/native-menu.ts`. Accelerators are owned by AppKit — no web binding exists for
// them (invariant 4).

import type { ActionDef } from '../types.ts';
import { kb } from './_v1.ts';

const DESKTOP = { shell: ['desktop' as const] };

export const NATIVE_ACTIONS: ActionDef[] = [
  {
    id: 'project.new',
    label: 'New project…',
    kind: 'command',
    exec: 'native',
    // v1 File ▸ New Project… ⌘N (the webview opens the create-project dialog on
    // `menu://new-project`). C3 moves it to ⇧⌘N and gives ⌘N to New canvas — Phase 4.
    keys: [kb('⌘N', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 1 },
  },
  {
    id: 'project.open',
    label: 'Open project…',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘O', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 2 },
  },
  {
    id: 'app.check-updates',
    label: 'Check for updates…',
    kind: 'command',
    exec: 'native',
    native: { menu: 'App', order: 1 },
  },
];
