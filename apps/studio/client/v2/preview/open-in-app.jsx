// client/v2/preview/open-in-app.jsx — S9.21c (10 co-browser-view): "Open in the Mac app", bottom right.
//
// A link opened in a plain browser lands in Preview (a view-only role's boot posture, canvas-modes.ts
// `initialMode`): the faces, no toolbar, the zoom readout — and this one island, the way from looking in a
// browser to working in the app. It is a plain link to the canvas' own `maude://open/<project>?open=<rel>`
// (share-link.js `buildShareLinks().app`, the same link Share copies): the browser hands it to the OS and the
// Mac app opens that canvas. Nothing is written and no route is called, so there is no role to enforce here —
// what the viewer may do in the app is the hub's answer there, as everywhere (hidden ≠ refused).
//
// Where: a browser tab on a cloud cell only. The desktop app IS the Mac app (no island), and a local studio
// in a browser has no cloud link to hand over. The link is built by the shell from its own location and the
// open tab — never from anything a canvas posted (DDR-054: the canvas origin stays untrusted).

import { parseMaudeLink } from '../../share-link.js';
import { Mark } from '../shell/project-pill.jsx';

export const OPEN_IN_APP_WORDS = Object.freeze({ label: 'Open in the Mac app' });

/**
 * The island's link, or null when it does not show.
 * @param native the desktop app (Tauri) — it is the Mac app already
 * @param cloud  the tab is served by a cloud cell (`cfg.cloud`)
 * @param appLink `buildShareLinks().app` for the open canvas
 */
export function openInAppLink({ native, cloud, appLink } = {}) {
  if (native || !cloud || typeof appLink !== 'string') return null;
  const parsed = parseMaudeLink(appLink);
  return parsed && parsed.kind !== 'connect' ? appLink : null;
}

/** The island. `href` is `openInAppLink(...)`; `state` is `in` | `out` (the Preview chrome's fade). */
export function OpenInApp({ href, state = 'in' }) {
  if (!href) return null;
  return (
    <a
      className="st-openapp island"
      data-testid="preview-open-app"
      data-occludes="bottom"
      data-state={state}
      href={href}
    >
      <Mark size={18} />
      {OPEN_IN_APP_WORDS.label}
    </a>
  );
}
