// client/v2/shell/project-account-bus.js — 2.1.1 T2/T4: how the registry reaches the avatar menu and the
// team-server dialog without a new key handler.
//
//   ACCOUNT_MENU_EVENT   `account.switch` (⌘K, the tab menu) opens the avatar menu on its Switch account
//                        list; the Share cluster host hears it (share-cluster-host.jsx).
//   LINK_SERVER_EVENT    `account.link-server` — "Link your server…" / "Sign in with custom server…". The one
//                        team-server dialog (2.1.1 T5) hears it and calls `preventDefault()`. Nobody did → the
//                        row opens Settings › Connections, where today's team-server dialog lives — a row never
//                        does nothing.

export const ACCOUNT_MENU_EVENT = 'maude:account-menu';
export const LINK_SERVER_EVENT = 'maude:link-server';

/** Open the avatar menu (`view`: 'menu' | 'switch'). */
export function openAccountMenu(view = 'switch') {
  window.dispatchEvent(new CustomEvent(ACCOUNT_MENU_EVENT, { detail: { view } }));
}

/**
 * `account.link-server`.
 * @param params `{ intent?: 'link' | 'sign-in', url?: string }` — sign-in = "Sign in with custom server…"
 * @param d      the menu runner's deps (`setSettingsOpen`)
 * @returns 'dialog' when the dialog took it, 'settings' when it fell back
 */
export function runLinkServer(params, d) {
  const detail = {
    intent: params?.intent === 'sign-in' ? 'sign-in' : 'link',
    ...(typeof params?.url === 'string' && params.url ? { url: params.url } : {}),
  };
  const ev = new CustomEvent(LINK_SERVER_EVENT, { detail, cancelable: true });
  window.dispatchEvent(ev);
  if (ev.defaultPrevented) return 'dialog';
  d?.setSettingsOpen?.('connections');
  return 'settings';
}
