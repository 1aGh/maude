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
    // V2-1.1 §5.9 / V2-3.9: Show Home (File) / Back to Home (Menu) — activate the pinned Home tab
    // (`new_home_tab`). Disabled while Home is the active tab (menu.rs `apply_role`).
    id: 'home.open',
    label: 'Show Home',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘T', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 4 },
  },
  {
    // V2-4.2: "Back to Home" is the first row of the project pill's menu (CONTRACT §1) — the SAME
    // command as File ▸ Show Home (`home.open`, `new_home_tab`), worded for the Menu. ⌘T stays
    // `home.open`'s. A browser tab has no Home window (the cloud dashboard link is V2-4.9).
    id: 'nav.home',
    label: 'Back to Home',
    kind: 'command',
    icon: 'home',
    exec: 'native',
    visible: DESKTOP,
  },
  // ── V2-3.9: the own tab bar's tab commands (contract V2-3.7 §5). Native: the shell owns the
  // tab list, so lib.rs runs them; no web binding fires them (AppKit takes the accelerator). ──
  {
    // ⌘W: the strip's × path (the "Stop AI in …?" guard first). Disabled on Home.
    id: 'tab.close',
    label: 'Close tab',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘W', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'File', order: 5 },
  },
  {
    // The project tabs in strip order, then Home, wrapping.
    id: 'tab.next',
    label: 'Show next tab',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌃tab', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'Window', order: 1 },
  },
  {
    id: 'tab.prev',
    label: 'Show previous tab',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌃⇧tab', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'Window', order: 2 },
  },
  // Jump to project tab 1…8, and to the LAST project tab (Home is Show Home). ⌘<n>, as in Safari /
  // Chrome / Arc / Terminal (V2-3.11): Actual size moved to ⇧0, so ⌘1 is free. ⌥⌘<n> stays
  // view.jump-artboard. These are AppKit accelerators: no page may preventDefault a ⌘<digit>.
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(
    (n): ActionDef => ({
      id: `tab.select-${n}`,
      label: `Show tab ${n}`,
      kind: 'command',
      exec: 'native',
      keys: [kb(`⌘${n}`, 'global', { inText: true, when: DESKTOP })],
      native: { menu: 'Window', order: 2 + n },
    })
  ),
  {
    id: 'tab.select-last',
    label: 'Show last tab',
    kind: 'command',
    exec: 'native',
    keys: [kb('⌘9', 'global', { inText: true, when: DESKTOP })],
    native: { menu: 'Window', order: 11 },
  },
  {
    id: 'app.check-updates',
    label: 'Check for updates…',
    kind: 'command',
    exec: 'native',
    native: { menu: 'App', order: 1 },
  },
];
