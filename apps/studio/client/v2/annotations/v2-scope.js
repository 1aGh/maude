// client/v2/annotations/v2-scope.js - S4.V4: the maude-v2 token scope for a shell-side panel.
//
// P8 C0: the shell root `.maude` and <html> now resolve the maude-v2 ladder themselves (styles/1-tokens-shell.css),
// so this wrapper only re-states what the panel already inherits (same values; the island material is the one
// difference — translucent under `.maude-v2`, solid in the shell). Kept until the V2-8.0 cleanup drops its callers.

/** The shell's theme, 'light' | 'dark' (light, the v2 default, when nothing says otherwise). */
export function shellTheme() {
  try {
    const t = document.querySelector('.maude[data-theme]')?.getAttribute('data-theme');
    return t === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** Props that put an element under the v2 token scope: spread them and join `className`. */
export function v2Scope(className = '') {
  return { className: `${className} maude-v2`.trim(), 'data-theme': shellTheme() };
}
