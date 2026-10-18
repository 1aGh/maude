// client/v2/preview/preview-chrome-host.jsx — S3.9: Preview's chrome, wired to the shell (04 md-motion).
//
// In Preview the shell shows two small islands and nothing else of its own: the PreviewBar (top centre —
// which canvas, what esc does) and the ZoomOnly readout (bottom left). The folded pill, the folded panels
// and the compact Share cluster are the mode's other half; they follow the same store. Edit, Viewing and
// Present show neither.
//
// `PreviewChrome` is the pure render (mode + caps + names in, islands out); `ShellPreviewChrome` collects
// the inputs from the shell and holds the islands on screen for the exit fade (the same frames in reverse).

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { notify } from '../../../notifications.tsx';
import { normalizeOpenPath } from '../../share-link.js';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { basename, displayName } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { capsFor } from '../shell/canvas-mode.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { ExternalLinkConfirmHost, externalLinks } from './external-link-confirm.jsx';
import { createLinkFollow } from './link-follow.js';
import { PreviewBar, previewHint } from './preview-bar.jsx';
import { clearPreviewBack, runPreviewBack, setPreviewBack } from './preview-back.js';
import { previewHistory } from './preview-history.js';
import { useViewportZoom, ZoomOnly } from './zoom-only.jsx';

/** The two islands, in Preview only. `state` is `in` while entering/showing, `out` for the exit fade. */
export function PreviewChrome({ mode, caps, name, zoom, back, onBack, state = 'in' }) {
  if (mode !== 'preview') return null;
  return (
    <>
      <PreviewBar name={name} hint={previewHint(caps)} back={back} onBack={onBack} state={state} />
      <ZoomOnly zoom={zoom} state={state} />
    </>
  );
}

/** Shell mode as a boolean, from the one store. */
export function usePreviewMode() {
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  return snap.mode === 'preview';
}

/** Keeps the islands mounted for `ms` after `on` goes false, so they can fade out. */
function useExitHold(on, ms) {
  const [hold, setHold] = useState(false);
  const prev = useRef(on);
  useEffect(() => {
    const wasOn = prev.current;
    prev.current = on;
    if (on) {
      setHold(false);
      return undefined;
    }
    if (!wasOn) return undefined;
    setHold(true);
    const t = setTimeout(() => setHold(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return hold && !on;
}

/** `--dur-panel`, read off the root (1 ms under reduced motion — the token collapses). */
function panelMs() {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-panel').trim();
    const m = /^([\d.]+)(ms|s)$/.exec(raw);
    if (m) return Number(m[1]) * (m[2] === 's' ? 1000 : 1);
  } catch {
    /* no computed style */
  }
  return 220;
}

// S3.10a — `preview.back` (registry) runs the mounted host's back (preview-back.js); re-exported for callers.
export { runPreviewBack };

const modalOpenNow = () =>
  typeof document !== 'undefined' && !!document.querySelector('[role="dialog"][aria-modal="true"]');

/** The tab path of a designRoot-relative canvas, in the form `activePath` has (with or without the prefix). */
export function tabPathFor(activePath, designRel, canvas) {
  const rel = normalizeOpenPath(activePath, designRel);
  if (!rel || !activePath.endsWith(rel)) return canvas;
  return `${activePath.slice(0, activePath.length - rel.length)}${canvas}`;
}

/**
 * S3.10a — plays `link-follow` from the active canvas (link-follow.js) and keeps the back stack, which is
 * cleared when the window leaves Preview (S3-links-format §5 "Back").
 */
function useLinkFollow({ live, previewing, cfg }) {
  const back = useSyncExternalStore(
    previewHistory.subscribe,
    previewHistory.get,
    previewHistory.get
  );
  useEffect(() => {
    if (!previewing) {
      previewHistory.clear();
      externalLinks.cancel(); // S3.10b: leaving Preview closes the website sheet
    }
  }, [previewing]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: everything live is read through `live`
  useEffect(() => {
    const designRel = cfg?.designRel || '.design';
    const frame = (p) => live.current.iframesRef.current?.get(p)?.contentWindow ?? null;
    const activeWin = () => {
      const p = live.current.activePath;
      return p && p !== SYSTEM_TAB ? frame(p) : null;
    };
    const zoomOn = (path, artboard, ladder) => {
      const post = () =>
        frame(path)?.postMessage(
          { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: artboard } },
          '*'
        );
      if (!ladder) return post();
      // a freshly opened canvas mounts its listener late — the ladder `maude design open` uses (ui-open.js)
      for (const ms of [50, 450, 1200, 2500]) setTimeout(post, ms);
    };
    const open = (path, artboard) => {
      live.current.openTab(path);
      if (artboard) zoomOn(path, artboard, true);
    };
    const lf = createLinkFollow({
      mode: () => shellMode.get().mode,
      modalOpen: modalOpenNow,
      now: () => Date.now(),
      activePath: () => live.current.activePath,
      fetchLinks: async (path) => {
        const r = await fetch(`/_api/links?file=${encodeURIComponent(path)}`, {
          credentials: 'same-origin',
        });
        return r.ok ? r.json() : null;
      },
      zoomTo: (artboard) => zoomOn(live.current.activePath, artboard, false),
      openCanvas: (canvas, artboard) =>
        open(tabPathFor(live.current.activePath, designRel, canvas), artboard),
      openTab: open,
      toast: (title) => notify({ title, kind: 'info' }),
      // S3.10b: a website goes to the shell's own confirmation; it opens from a human click only.
      external: (url) => externalLinks.request(url),
      history: previewHistory,
      nameOf: (path) => displayName(basename(path)),
    });
    const onMessage = (e) => {
      if (e.data?.dgn !== 'link-follow') return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: cfg?.canvasOrigin || window.location.origin,
        active: activeWin(),
      });
      if (m?.dgn === 'link-follow') void lf.follow(m);
    };
    window.addEventListener('message', onMessage);
    const mine = () => lf.back();
    setPreviewBack(mine);
    return () => {
      window.removeEventListener('message', onMessage);
      clearPreviewBack(mine);
    };
  }, [cfg?.canvasOrigin, cfg?.designRel]);
  const top = back.length ? back[back.length - 1] : null;
  return { backName: top?.name || null, onBack: () => runPreviewBack() };
}

export function ShellPreviewChrome() {
  const {
    shellCore: { activePath, cfg, iframesRef, viewerMode },
    tabs: { openTab },
  } = useShellStore();
  const previewing = usePreviewMode();
  const leaving = useExitHold(previewing, panelMs());
  const canvasOpen = !!activePath && activePath !== SYSTEM_TAB;
  const live = useRef({});
  live.current = { activePath, iframesRef, openTab };
  const link = useLinkFollow({ live, previewing, cfg });
  const zoom = useViewportZoom({
    canvasOrigin: cfg?.canvasOrigin || window.location.origin,
    activeWin: () => {
      const p = live.current.activePath;
      return p && p !== SYSTEM_TAB
        ? (live.current.iframesRef.current?.get(p)?.contentWindow ?? null)
        : null;
    },
  });
  if (!canvasOpen || (!previewing && !leaving)) return null;
  const caps = capsFor({ canEdit: !viewerMode, role: cfg?.cloud?.role });
  return (
    <>
      <PreviewChrome
        mode="preview"
        caps={caps}
        name={displayName(basename(activePath))}
        zoom={zoom}
        back={link.backName}
        onBack={link.onBack}
        state={previewing ? 'in' : 'out'}
      />
      <ExternalLinkConfirmHost active={previewing} />
    </>
  );
}
