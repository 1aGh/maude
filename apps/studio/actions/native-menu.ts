// actions/native-menu.ts — the desktop app's menu bar layout (V2-1.3 contract §5.8). Nodes name
// registry actions; `scripts/gen-actions.mjs` joins them with the registry (accelerator from the
// action's primary binding, `exec` for the click route) into
// `apps/desktop/src-tauri/menu.actions.json`, which menu.rs builds the menu from. OS-provided
// items stay predefined (About, Quit, the Edit items WKWebView needs, the Window items).
//
// V2-3.4 — C3's File menu (New Canvas ⌘N · New Project… ⇧⌘N · Open Project… ⌘O · Show Home ⌘T —
// V2-3.9 renamed New Home Tab) and a Window menu. `windowsMenu` makes it NSApp's Windows menu, so
// AppKit appends the window list. V2-3.9: Close Tab ⌘W and the Window menu's tab items (next /
// previous ⌃Tab / ⌃⇧Tab, Tab 1…8 ⌃⌘1…⌃⌘8, Last Tab ⌃⌘9) drive Maude's own tab bar (V2-3.7);
// nothing is native-tabbed, so AppKit adds no tab items of its own. A click on an `exec:'shell'` item
// sends `menu://action {id}` to the focused window; an `exec:'native'` item has a lib.rs arm.

import type { ActionId } from './types.ts';

export type NativePredefined =
  | 'about'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select_all'
  | 'minimize'
  | 'zoom'
  | 'bring_all_to_front';

export type NativeNode =
  | {
      /** The registry action. */
      action: ActionId;
      /** The menu-item id (lib.rs matches an `exec:'native'` action's arm on it). */
      nativeId: string;
      /** The menu label (title case). */
      label: string;
      /** S1.22b: the accelerator is this ALIAS chord of the action, not its primary binding — a
       *  menu item carries one accelerator, so a second key for the same action is its own item. */
      chord?: string;
      /** S1.22b (macOS): not drawn in the menu; its accelerator still works
       *  (`allowsKeyEquivalentWhenHidden`, menu.rs). Only with `chord`. */
      hidden?: true;
    }
  | { predefined: NativePredefined; macos?: true }
  | { separator: true; macos?: true };

export interface NativeSubmenu {
  title: string;
  /** macOS: this submenu is `NSApp.windowsMenu` (AppKit adds the tab items and window list). */
  windowsMenu?: true;
  items: NativeNode[];
}

export const NATIVE_MENU: readonly NativeSubmenu[] = [
  {
    // The first submenu is the macOS app menu.
    title: 'Maude',
    items: [
      { predefined: 'about' },
      { separator: true },
      { action: 'app.check-updates', nativeId: 'check_updates', label: 'Check for Updates…' },
      { separator: true },
      { predefined: 'quit' },
    ],
  },
  {
    title: 'File',
    items: [
      { action: 'canvas.new', nativeId: 'new_canvas', label: 'New Canvas' },
      { action: 'project.new', nativeId: 'new_project', label: 'New Project…' },
      { action: 'project.open', nativeId: 'open_project_folder', label: 'Open Project…' },
      { action: 'home.open', nativeId: 'show_home', label: 'Show Home' },
      { separator: true },
      { action: 'tab.close', nativeId: 'close_tab', label: 'Close Tab' },
    ],
  },
  {
    // Load-bearing on macOS: WKWebView only receives ⌘X/C/V/A when the app menu exposes the
    // matching predefined items. Undo / Redo are macOS-only.
    title: 'Edit',
    items: [
      { predefined: 'undo', macos: true },
      { predefined: 'redo', macos: true },
      { separator: true, macos: true },
      { predefined: 'cut' },
      { predefined: 'copy' },
      { predefined: 'paste' },
      { predefined: 'select_all' },
    ],
  },
  {
    title: 'Window',
    windowsMenu: true,
    items: [
      { predefined: 'minimize' },
      { predefined: 'zoom' },
      { separator: true },
      // V2-3.9: our own tab bar's tabs (no window is native-tabbed any more).
      { action: 'tab.next', nativeId: 'next_tab', label: 'Show Next Tab' },
      { action: 'tab.prev', nativeId: 'prev_tab', label: 'Show Previous Tab' },
      // S1.22b: ⇧⌘] / ⇧⌘[ — the same commands, hidden (Safari's second pair).
      {
        action: 'tab.next',
        nativeId: 'next_tab_alt',
        label: 'Show Next Tab',
        chord: '⇧⌘]',
        hidden: true,
      },
      {
        action: 'tab.prev',
        nativeId: 'prev_tab_alt',
        label: 'Show Previous Tab',
        chord: '⇧⌘[',
        hidden: true,
      },
      { action: 'tab.overview', nativeId: 'show_all_tabs', label: 'Show All Tabs' },
      { separator: true },
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        action: `tab.select-${n}`,
        nativeId: `select_tab_${n}`,
        label: `Tab ${n}`,
      })),
      { action: 'tab.select-last', nativeId: 'select_tab_last', label: 'Last Tab' },
      { separator: true, macos: true },
      { predefined: 'bring_all_to_front', macos: true },
    ],
  },
  {
    title: 'Help',
    items: [{ action: 'help.report-bug', nativeId: 'report_bug', label: 'Report a Bug…' }],
  },
];
