// The Light | Dark pill at the top of every canvas (r4 #6, decision `v2-michal-r4-global-light-dark`).
//
// The same pill the Design system canvas has always had (`ds/board/ds-bar.tsx`, 13 `DsBar`) — same place (fixed, top
// centre), same form (system glyph · name · Light | Dark) — now on every ordinary canvas. It switches EVERY artboard
// at once (canvas-theme.ts → the follow rule in canvas-shell.tsx); the person's pick is remembered per canvas, per Mac.
// A canvas starts in its design system's own default theme (Light with none).
//
// Drawn on Maude's own HUD tokens like the DS bar — never the system's tokens — and tagged `data-dc-overlay`, so an
// export never carries it. It steps aside in Preview, Present, an embed, a Present follower, and on the Design system
// canvas (which draws its own bar over the same mode).

import { useEffect, useState } from 'react';
import { DsIcon } from './canvas-ds-icons.tsx';
import { getCanvasThemeSystemName, setCanvasTheme, useCanvasTheme } from './canvas-theme.ts';

/** The pill's chrome. Kept in step with the `.ds-bar` block of ds/board/board.css (same pill, other canvases). */
const PILL_CSS = `
.dc-theme-pill{position:fixed;left:50%;top:16px;translate:-50% 0;z-index:2147483000;display:flex;align-items:center;gap:8px;height:44px;padding:0 8px 0 12px;border-radius:var(--maude-hud-radius-lg,14px);background:var(--maude-hud-island-bg);color:var(--maude-chrome-fg-0);-webkit-backdrop-filter:saturate(1.4) blur(18px);backdrop-filter:saturate(1.4) blur(18px);box-shadow:var(--maude-hud-island-shadow),inset 0 0 0 .5px var(--maude-hud-island-edge);font:400 var(--maude-hud-type-sm,12px)/1 var(--maude-chrome-font-body);white-space:nowrap}
.dc-theme-pill-ic{display:grid;place-items:center;width:24px;height:24px;border-radius:var(--maude-hud-radius-xs,4px);background:var(--maude-hud-accent-muted);color:var(--maude-hud-accent-text)}
.dc-theme-pill b{font-weight:600}
.dc-theme-pill-seg{display:inline-flex;margin:0 0 0 8px;min-width:0;border:0;padding:2px;border-radius:var(--maude-hud-radius-md,10px);background:var(--maude-chrome-bg-3)}
.dc-theme-pill-seg:first-child{margin-left:0}
.dc-theme-pill-b{appearance:none;border:0;border-radius:calc(var(--maude-hud-radius-md,10px) - 2px);padding:4px 12px;background:transparent;color:var(--maude-chrome-fg-1);font:inherit;font-size:var(--maude-hud-type-xs,11px);cursor:pointer}
.dc-theme-pill-b[aria-pressed="true"]{background:var(--maude-chrome-bg-2);color:var(--maude-chrome-fg-0);box-shadow:var(--maude-hud-shadow-md),inset 0 0 0 1px var(--maude-hud-accent)}
.dc-theme-pill-b:disabled{opacity:.4;cursor:default}
.dc-theme-pill-b:focus-visible{outline:2px solid var(--maude-hud-focus-ring);outline-offset:1px}
@media (prefers-reduced-motion:reduce){.dc-theme-pill *{transition-duration:1ms !important;animation-duration:1ms !important}}
`;

/**
 * @param bothThemes  does the canvas's design system define Light AND Dark? Asked on every render (the answer can
 *                    arrive after first paint, once the system's stylesheet has parsed — the pill re-asks on load).
 */
export function CanvasThemePill({ bothThemes }: { bothThemes: () => boolean }) {
  const mode = useCanvasTheme();
  const [, tick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const again = () => tick((n) => n + 1);
    if (document.readyState === 'complete') again();
    else window.addEventListener('load', again, { once: true });
    return () => window.removeEventListener('load', again);
  }, []);
  const both = bothThemes();
  const name = getCanvasThemeSystemName();
  return (
    <>
      <style data-dc-theme-pill-css="">{PILL_CSS}</style>
      <div
        className="dc-theme-pill"
        data-dc-overlay=""
        data-testid="canvas-theme-pill"
        role="toolbar"
        aria-label="Canvas theme"
      >
        {name ? (
          <>
            <span className="dc-theme-pill-ic" aria-hidden="true">
              <DsIcon name="system" size={14} />
            </span>
            <b>{name}</b>
          </>
        ) : null}
        <fieldset className="dc-theme-pill-seg" aria-label="Show every artboard in">
          {(['light', 'dark'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="dc-theme-pill-b"
              data-testid={`canvas-theme-mode-${m}`}
              aria-pressed={mode === m}
              disabled={!both && mode !== m}
              title={!both && mode !== m ? 'This design system defines only one theme.' : undefined}
              onClick={() => setCanvasTheme(m)}
            >
              {m === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </fieldset>
      </div>
    </>
  );
}
