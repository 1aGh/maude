// client/v2/annotations/v2-scope.js - S4.V4: the maude-v2 token scope for a shell-side panel.
//
// The shell root is still `.maude` (the v1 ladder); `.maude-v2[data-theme]` is where --object-*, --w-semibold,
// --font-body and the --island-* material live (styles/1-tokens-maude-v2.css). A panel that renders outside
// the Home page therefore had them undefined: blank object-coloured thumbnails, semibold runs at 400, the
// mono shell face. Each panel takes the scope ON ITS OWN ROOT with the shell's current theme - the shell
// root is never wrapped (a wide visual change).

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
