// client/v2/settings/theme-auto.js — Settings › General › Look › Theme "Auto" (02 ob-settings: Light · Dark · Auto).
//
// The shell's `theme` stays what it always was, 'light' | 'dark': every consumer (the <html data-theme>, the
// canvas iframes' chrome, the on-disk ui-prefs) keeps reading a real theme. Auto is one more fact on this Mac,
// `maude-theme-auto` = '1' in localStorage, and one follower (`useThemeAuto`, mounted once by the shell core)
// that sets `theme` to the system's while Auto is on: at start, when the system flips, and whenever something
// else set the other one (the ui-prefs hydration from disk). Picking Light or Dark — here or with
// ⌘K "Theme" / the View toggle — turns Auto off. A 1.x peer never sees the key (per-machine storage).

import { useEffect, useSyncExternalStore } from 'react';

export const THEME_AUTO_STORE = 'maude-theme-auto';
const QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set();

export function readThemeAuto() {
  try {
    return globalThis.localStorage?.getItem(THEME_AUTO_STORE) === '1';
  } catch {
    return false;
  }
}

export function writeThemeAuto(on) {
  try {
    if (on) globalThis.localStorage?.setItem(THEME_AUTO_STORE, '1');
    else globalThis.localStorage?.removeItem(THEME_AUTO_STORE);
  } catch {}
  for (const f of listeners) f();
}

function subscribe(f) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The system's theme, or null where it cannot be read (no matchMedia). */
export function systemTheme(mq = globalThis.matchMedia?.(QUERY)) {
  if (!mq) return null;
  return mq.matches ? 'dark' : 'light';
}

/** What the Theme control shows: 'auto' while Auto is on, else the theme. */
export function themeChoice(theme, auto) {
  return auto ? 'auto' : theme === 'light' ? 'light' : 'dark';
}

/** What a pick does: `{ auto, theme }` — Auto keeps the theme to the system's (null = leave it). */
export function pickTheme(choice, system) {
  if (choice === 'auto') return { auto: true, theme: system };
  return { auto: false, theme: choice === 'light' ? 'light' : 'dark' };
}

/** Is Auto on (re-renders on a change made anywhere in this window). */
export function useThemeAutoOn() {
  return useSyncExternalStore(subscribe, readThemeAuto, () => false);
}

/** The follower. Mounted once, beside the theme state. */
export function useThemeAuto(theme, setTheme) {
  const auto = useThemeAutoOn();
  useEffect(() => {
    if (!auto) return undefined;
    const mq = globalThis.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const apply = () => setTheme(systemTheme(mq));
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [auto, setTheme]);
  useEffect(() => {
    if (!auto) return;
    const sys = systemTheme();
    if (sys && sys !== theme) setTheme(sys);
  }, [auto, theme, setTheme]);
}
