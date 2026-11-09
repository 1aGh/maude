// client/v2/shell/project-account-toast.js — 2.1.1 T2: told once, then it waits by the face (canvas 17
// · ac-toast). The first time this session finds THIS project's sign-in missing or stopped working, one
// toast says so with its one button ("Sign in" / "Sign in again"); after that the broken-link badge and
// the save word keep saying it and nothing else interrupts.
//
// "This session" = this window's session storage (a reload is the same session; a relaunch is a new
// one), keyed by project, server and state — so a missing sign-in fixed and later rejected is told again.

import { useEffect } from 'react';
import { signInToast } from './connection-state.js';

const PREFIX = 'maude.signin-toast:';
const told = new Set(); // this page, when session storage is unavailable

function seen(key) {
  if (told.has(key)) return true;
  try {
    return window.sessionStorage.getItem(PREFIX + key) === '1';
  } catch {
    return false;
  }
}
function mark(key) {
  told.add(key);
  try {
    window.sessionStorage.setItem(PREFIX + key, '1');
  } catch {
    /* private window / blocked storage: this page's memory is enough */
  }
}

/** Tests only. */
export function resetSignInToasts() {
  told.clear();
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) window.sessionStorage.removeItem(k);
    }
  } catch {
    /* nothing kept */
  }
}

/**
 * Toast a broken sign-in once per session.
 * @param conn    connectionState()
 * @param project this project's name
 * @param onFix   () => void — the toast's button (the menu's fix)
 * @param toast   the notice primitive (`notify`)
 */
export function useSignInToast({ conn, project, onFix, toast, enabled = true }) {
  const t = enabled ? signInToast(conn, { project }) : null;
  const key = t?.key ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the identity of the toast
  useEffect(() => {
    if (!t || seen(t.key)) return;
    mark(t.key);
    toast?.({
      id: t.id,
      title: t.title,
      kind: t.kind,
      action: { label: t.actionLabel, onClick: () => onFix?.() },
    });
  }, [key]);
}
