// The Light | Dark pill at the top of every canvas (r4 #6, decision `v2-michal-r4-global-light-dark`).
//
// The same pill the Design system canvas has always had (`ds/board/ds-bar.tsx`, 13 `DsBar`) — same place (fixed, top
// centre), same form (system glyph · name · Light | Dark) — now on every ordinary canvas. It switches EVERY artboard
// at once (canvas-theme.ts → the follow rule in canvas-shell.tsx); the person's pick is remembered per canvas, per Mac.
// A canvas starts in its design system's own default theme (Light with none).
//
// Drawn on Maude's own HUD tokens like the DS bar — never the system's tokens — and tagged `data-dc-overlay`, so an
// export never carries it. It steps aside in Preview, Present, an embed, a Present follower, and on the Design system
// canvas (which draws its own bar over the same mode). It also steps aside while a people pill holds the same spot
// ("Following …" / "Everyone here is following you … Stop", presence/canvas-presence.tsx): the pill sat on top of it and
// took the Stop click.
//
// #217 — a dynamic island between the shell's top islands (Michal): two lines, the system's name over the canvas's path
// (smaller, grey), centred in the free band the shell reports with its `occluded-insets` (`topBand`, the stretch
// between the project pill and the Share cluster) and never wider than it. Short of room the path line goes first,
// then the name truncates. An older shell sends no band: the pill centres on the frame, as before.
//
// #225 — the Design system canvas's bar is the same island (`CanvasTopIsland`, its own controls on the row): it kept a
// copy of this chrome in ds/board/board.css and missed #217, so on that screen the bar sat elsewhere.

import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { canvasModeStore } from './bridge/canvas-mode-store.ts';
import type { TopBand } from './bridge/occlusion.ts';
import { DsIcon } from './canvas-ds-icons.tsx';
import { getCanvasThemeSystemName, setCanvasTheme, useCanvasTheme } from './canvas-theme.ts';
import { THEME_WORD, ThemeIcon } from './canvas-theme-icons.tsx';

/** The island's chrome — the canvas pill's AND the Design system bar's (#225: one copy, `CanvasTopIsland`). */
const PILL_CSS = `
.dc-theme-pill{position:fixed;left:50%;top:16px;translate:-50% 0;z-index:2147483000;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;min-height:44px;padding:4px 8px 5px;overflow:hidden;border-radius:var(--maude-hud-radius-lg,14px);background:var(--maude-hud-island-bg);color:var(--maude-chrome-fg-0);-webkit-backdrop-filter:saturate(1.4) blur(18px);backdrop-filter:saturate(1.4) blur(18px);box-shadow:var(--maude-hud-island-shadow),inset 0 0 0 .5px var(--maude-hud-island-edge);font:400 var(--maude-hud-type-sm,12px)/1 var(--maude-chrome-font-body);white-space:nowrap}
.dc-theme-pill-row{display:flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding-left:4px}
.dc-theme-pill-row>:not(.dc-theme-pill-text){flex:none}
.dc-theme-pill-ic{display:grid;place-items:center;width:24px;height:24px;border-radius:var(--maude-hud-radius-xs,4px);background:var(--maude-hud-accent-muted);color:var(--maude-hud-accent-text)}
.dc-theme-pill-text{display:flex;align-items:center;min-width:0;flex:0 1 auto}
.dc-theme-pill-title{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;font-weight:600;line-height:16px}
.dc-theme-pill-seg{display:inline-flex;margin:0 0 0 8px;min-width:0;border:0;padding:2px;border-radius:var(--maude-hud-radius-md,10px);background:var(--maude-chrome-bg-3)}
.dc-theme-pill-seg:first-child{margin-left:0}
.dc-theme-pill-b{appearance:none;border:0;border-radius:calc(var(--maude-hud-radius-md,10px) - 2px);padding:4px 12px;background:transparent;color:var(--maude-chrome-fg-1);font:inherit;font-size:var(--maude-hud-type-xs,11px);cursor:pointer}
.dc-theme-pill-b[aria-pressed="true"]{background:var(--maude-chrome-bg-2);color:var(--maude-chrome-fg-0);box-shadow:var(--maude-hud-shadow-md),inset 0 0 0 1px var(--maude-hud-accent)}
.dc-theme-pill-b:disabled{opacity:.4;cursor:default}
.dc-theme-pill-b--ic{display:grid;place-items:center;padding:4px 7px}
.dc-theme-pill-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.dc-theme-pill-path{appearance:none;display:block;border:0;border-radius:var(--maude-hud-radius-xs,4px);padding:0 4px;margin:0;background:transparent;color:var(--maude-chrome-fg-2);font:inherit;font-size:var(--maude-hud-type-2xs,10px);line-height:13px;font-family:var(--maude-chrome-font-mono,ui-monospace,monospace);text-align:center;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-theme-pill[data-path="hidden"] .dc-theme-pill-path{position:absolute;visibility:hidden;pointer-events:none}
.dc-theme-pill-path:hover{background:var(--maude-chrome-bg-3);color:var(--maude-chrome-fg-0)}
.dc-theme-pill-path:focus-visible{outline:2px solid var(--maude-hud-focus-ring);outline-offset:1px}
.dc-theme-pill-b:focus-visible{outline:2px solid var(--maude-hud-focus-ring);outline-offset:1px}
body:has(.dc-presence-pill) .dc-theme-pill{display:none}
@media (prefers-reduced-motion:reduce){.dc-theme-pill *{transition-duration:1ms !important;animation-duration:1ms !important}}
`;

/** The longest path the pill draws; a longer one loses its leading folders (`…/folder/File.tsx`), never its file name. */
const PATH_MAX = 36;

/** Shorten a project-relative path from the front, keeping the file name (and as many trailing folders as fit). */
export function shortenCanvasPath(path: string, max = PATH_MAX): string {
  if (path.length <= max) return path;
  const parts = path.split('/');
  let out = parts[parts.length - 1];
  for (let i = parts.length - 2; i >= 0; i--) {
    const next = `${parts[i]}/${out}`;
    if (next.length + 2 > max) break;
    out = next;
  }
  if (out.length + 2 > max) return `…${out.slice(out.length - (max - 1))}`;
  return `…/${out}`;
}

/** #217 — the room the pill keeps from each top island, and from the frame's edges with no band. */
export const PILL_BAND_GAP = 12;
/** #217 — the path line stays while it can show at least this much (an ellipsis eats the rest); narrower, it goes. */
export const PATH_MIN_PX = 96;

/**
 * #217 — where the pill sits: centred in the shell's free top band (clamped to the frame), never wider than the band
 * less a gap on each side. No band (an older shell, nothing usable) ⇒ the frame's centre, as before.
 * @returns `left` (px from the frame's left edge, the pill's centre) and `maxWidth` (px, ≥ 0)
 */
export function pillPlacement(
  band: Readonly<TopBand> | null,
  viewportWidth: number
): { left: number; maxWidth: number; banded: boolean } {
  const vw = Math.max(0, viewportWidth);
  if (band) {
    const l = Math.max(0, band.left);
    const r = Math.min(vw, band.right);
    if (r > l)
      return {
        left: Math.round((l + r) / 2),
        maxWidth: Math.max(0, Math.floor(r - l - 2 * PILL_BAND_GAP)),
        banded: true,
      };
  }
  return { left: Math.round(vw / 2), maxWidth: Math.max(0, vw - 2 * PILL_BAND_GAP), banded: false };
}

/**
 * #217 — does the path line stay? `avail` is the width the two-line text column may take (the pill's max width
 * less its icon, Light | Dark and the rest); `title` / `path` are the lines' natural widths. The path goes first:
 * it stays only while the name fits whole AND the path can show at least PATH_MIN_PX (or all of itself).
 */
export function showPathLine(avail: number, title: number, path: number): boolean {
  if (!(path > 0)) return false;
  return avail >= Math.max(title, Math.min(path, PATH_MIN_PX));
}

const noSub = () => () => {};

/** The laid-out width of an element's text, overflow or not (0 without layout). */
function textWidthOf(el: Element): number {
  try {
    const r = el.ownerDocument.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect().width;
  } catch {
    return 0;
  }
}

/** The shell's top band, live (null outside a browser document or before the shell sent one). */
function useTopBand(): Readonly<TopBand> | null {
  const s = typeof window === 'undefined' ? null : canvasModeStore(window);
  return useSyncExternalStore(
    s ? s.subscribe : noSub,
    () => s?.get().topBand ?? null,
    () => null
  );
}

/** The frame's width, live (the fallback centring and the band's clamp read it). */
function useViewportWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** The canvas's project-relative path (`.design/ui/v2/02 Onboarding.tsx`), as the shell stored it on the frame. */
function canvasFilePath(): string | null {
  if (typeof window === 'undefined') return null;
  const f = (window as unknown as { __canvas_meta_file__?: unknown }).__canvas_meta_file__;
  return typeof f === 'string' && f ? f : null;
}

/**
 * #225 — the one top-centre island every canvas draws: the canvas pill below, and the Design system canvas's bar
 * (ds/board/ds-bar.tsx), which used to keep its own copy of the chrome — still centred on the frame in the old one-row
 * form after #217, so on that screen the bar sat elsewhere. Placed in the shell's free top band (`pillPlacement`), a
 * column with the canvas's path on its own line above `children` (the host's controls row). Maude's chrome, so tagged
 * `data-dc-overlay` (an export never carries it) and stepping aside while a people pill holds the spot.
 */
export function CanvasTopIsland({
  testid,
  ariaLabel,
  rowTestid,
  pathTestid,
  children,
}: {
  testid: string;
  ariaLabel: string;
  rowTestid: string;
  pathTestid: string;
  /** the controls row, under the path line */
  children: ReactNode;
}) {
  // r5-8 — the canvas's path on the pill; a click copies it whole and the pill says so for a moment
  const [copied, setCopied] = useState<'no' | 'ok' | 'failed'>('no');
  useEffect(() => {
    if (copied === 'no') return undefined;
    const t = setTimeout(() => setCopied('no'), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const file = canvasFilePath();
  // #168 F5 — the pill only asks: `__canvas_meta_file__` is a global any canvas code can overwrite, so the shell
  // copies the path it holds for this (active) frame and says so itself if the copy fails
  const copyPath = () => {
    if (!file) return;
    try {
      window.parent.postMessage({ dgn: 'copy-canvas-path' }, '*');
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };
  // #217 — placed in the shell's free top band; the path line goes first when the band is short
  const band = useTopBand();
  const vw = useViewportWidth();
  const place = pillPlacement(band, vw);
  const pillRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<HTMLButtonElement>(null);
  const [pathShown, setPathShown] = useState(true);
  // how many characters of the path fit: it loses its leading folders first, never its file name
  const [pathChars, setPathChars] = useState(PATH_MAX);
  // file and copied change the path line's natural width; the row's own changes reach `fit` through the ResizeObserver
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) return undefined;
    const fit = () => {
      // the path has its own line under the controls (Michal, #217): it may take the pill's whole inner width
      const cs = getComputedStyle(pill);
      const avail =
        place.maxWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const btn = pathRef.current;
      let pathW = btn?.scrollWidth ?? 0;
      let chars = PATH_MAX;
      const shown = btn?.textContent ?? '';
      const textW = btn && file && copied === 'no' && shown ? textWidthOf(btn) : 0;
      if (btn && file && textW > 0) {
        // the path is set in a monospace face: one character's width prices the whole path and what fits
        const charW = textW / shown.length;
        const pad = Math.max(0, btn.scrollWidth - textW);
        pathW = charW * shortenCanvasPath(file).length + pad;
        chars = Math.max(8, Math.min(PATH_MAX, Math.floor((avail - pad) / charW)));
      }
      const next = showPathLine(avail, 0, pathW);
      setPathShown((cur) => (cur === next ? cur : next));
      setPathChars((cur) => (cur === chars ? cur : chars));
    };
    fit();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(fit); // Light | Dark and Canvas | Pages may change width after first paint
    ro.observe(pill);
    return () => ro.disconnect();
  }, [place.maxWidth, file, copied]);
  return (
    <>
      <style data-dc-theme-pill-css="">{PILL_CSS}</style>
      <div
        ref={pillRef}
        className="dc-theme-pill"
        data-dc-overlay=""
        data-testid={testid}
        data-band={place.banded ? 'band' : 'frame'}
        data-path={file ? (pathShown ? 'shown' : 'hidden') : undefined}
        style={{ left: `${place.left}px`, maxWidth: `${place.maxWidth}px` }}
        role="toolbar"
        aria-label={ariaLabel}
      >
        {file ? (
          <button
            ref={pathRef}
            type="button"
            className="dc-theme-pill-path"
            data-testid={pathTestid}
            title={`Copy relative path — ${file}`}
            aria-label={`Copy relative path ${file}`}
            aria-live="polite"
            onClick={copyPath}
          >
            {copied === 'ok'
              ? 'Copied'
              : copied === 'failed'
                ? 'Couldn’t copy'
                : shortenCanvasPath(file, pathChars)}
          </button>
        ) : null}
        <div className="dc-theme-pill-row" data-testid={rowTestid}>
          {children}
        </div>
      </div>
    </>
  );
}

/** The design system's glyph tile and name, as both islands draw them (the name truncates first, never a control). */
export function TopIslandTitle({
  name,
  textTestid,
  titleTestid,
}: {
  name: string;
  textTestid?: string;
  titleTestid?: string;
}) {
  return (
    <>
      <span className="dc-theme-pill-ic" aria-hidden="true">
        <DsIcon name="system" size={14} />
      </span>
      <span className="dc-theme-pill-text" data-testid={textTestid}>
        <b className="dc-theme-pill-title" data-testid={titleTestid}>
          {name}
        </b>
      </span>
    </>
  );
}

/**
 * @param bothThemes  does the canvas's design system define Light AND Dark? Asked on every render (the answer can
 *                    arrive after first paint, once the system's stylesheet has parsed — the pill re-asks on load).
 */
export function CanvasThemePill({
  bothThemes,
  onProbeStale,
  extra,
}: {
  bothThemes: () => boolean;
  /** subscribe to "the answer may have changed" (a stylesheet or the first artboard wrapper arrived) */
  onProbeStale?: (f: () => void) => () => void;
  /** 2.0.7 B2 — drawn after Light | Dark: the canvas's Canvas | Pages (canvas-pages-view.tsx) */
  extra?: ReactNode;
}) {
  const mode = useCanvasTheme();
  const [, tick] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const again = () => tick((n) => n + 1);
    if (document.readyState === 'complete') again();
    else window.addEventListener('load', again, { once: true });
    const off = onProbeStale?.(again);
    return () => {
      window.removeEventListener('load', again);
      off?.();
    };
  }, [onProbeStale]);
  const both = bothThemes();
  const name = getCanvasThemeSystemName();
  return (
    <CanvasTopIsland
      testid="canvas-theme-pill"
      ariaLabel="Canvas theme"
      rowTestid="canvas-theme-row"
      pathTestid="canvas-theme-path"
    >
      {name ? (
        <TopIslandTitle
          name={name}
          textTestid="canvas-theme-text"
          titleTestid="canvas-theme-title"
        />
      ) : null}
      <fieldset className="dc-theme-pill-seg" aria-label="Show every artboard in">
        {(['light', 'dark'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="dc-theme-pill-b dc-theme-pill-b--ic"
            data-testid={`canvas-theme-mode-${m}`}
            aria-pressed={mode === m}
            aria-label={THEME_WORD[m]}
            disabled={!both && mode !== m}
            // 2.0.7 — icons only (Michal): the name is the tooltip; a theme the canvas lacks says so there
            title={!both && mode !== m ? `This canvas has no ${THEME_WORD[m]}` : THEME_WORD[m]}
            onClick={() => setCanvasTheme(m)}
          >
            <ThemeIcon mode={m} />
          </button>
        ))}
      </fieldset>
      {!both ? (
        // read by a screen reader only; the greyed button's tooltip says the same to everyone else
        <span className="dc-theme-pill-sr" data-testid="canvas-theme-note">
          {`This canvas has no ${mode === 'light' ? 'Dark' : 'Light'}`}
        </span>
      ) : null}
      {extra}
    </CanvasTopIsland>
  );
}
