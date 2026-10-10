// actions/native-menu.ts — the desktop app's menu bar layout (V2-1.3 contract §5.8). Nodes name
// registry actions; `scripts/gen-actions.mjs` joins them with the registry (accelerator from the
// action's binding) into `apps/desktop/src-tauri/menu.actions.json`, which menu.rs builds the menu
// from. OS-provided items stay predefined (About, Quit and the Edit items WKWebView needs).
//
// V2-2.4 keeps v1's menu exactly: same items, same menu-item ids (lib.rs matches on them), same
// v1 labels (verbatim — C3's File menu lands in Phase 3/4).

import type { ActionId } from './types.ts';

export type NativePredefined =
  | 'about'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select_all';

export type NativeNode =
  | {
      /** The registry action. */
      action: ActionId;
      /** The menu-item id lib.rs matches on (v1's). */
      nativeId: string;
      /** v1 label, verbatim. */
      label: string;
    }
  | { predefined: NativePredefined; macos?: true }
  | { separator: true; macos?: true };

export interface NativeSubmenu {
  title: string;
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
      { action: 'project.new', nativeId: 'new_project', label: 'New Project…' },
      { action: 'project.open', nativeId: 'open_project', label: 'Open Project…' },
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
    title: 'Help',
    items: [{ action: 'help.report-bug', nativeId: 'report_bug', label: 'Report a Bug…' }],
  },
];
