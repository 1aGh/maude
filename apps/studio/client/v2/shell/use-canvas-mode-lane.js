// client/v2/shell/use-canvas-mode-lane.js — V2-4.3b: the shell's mode lane, wired (pure core:
// canvas-mode.js).
//
//   the Share cluster switch → shellMode.select → fold (Preview) → insets → `set-mode` to every canvas
//   a canvas `mode-request`   → M4 (active canvas only, no modal, the role allows it) → the same path
//   a canvas `mode-changed`   → a clamp is adopted (the canvas is defence in depth behind the role)
//   a canvas `peers`          → the cluster's faces (active canvas only — the table's gate)
//   `loaded` / `canvas-rendered` / a new active canvas → that frame is seeded with the current mode

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import {
  capsFor,
  createModeLane,
  createShellMode,
  decideModeRequest,
  effectiveMode,
  sameCaps,
} from './canvas-mode.js';
import { SEED_LADDER_MS } from './occlusion-insets.js';
import { insetsLane } from './use-occluded-insets.js';
import { panelLayout, usePanelLayout } from './use-panel-layout.js';

/** The window's one mode store (mode is per project window, Q6). */
export const shellMode = createShellMode();

const modalOpenNow = () =>
  typeof document !== 'undefined' && !!document.querySelector('[role="dialog"][aria-modal="true"]');

export const ROLE_DENIAL = 'You can view this canvas. Ask a project owner for edit access.';

/**
 * @returns {{ mode, segmentMode, caps, peers, select(mode), present(), exitPresent() }}
 *   `mode` is what the canvases are in (Present while presenting); `peers` are the active canvas's
 */
export function useCanvasModeLane({
  activePath,
  iframesRef,
  cfg,
  canEdit,
  role,
  presenting,
  togglePresent,
  exitPresent,
}) {
  const caps = useMemo(() => capsFor({ canEdit, role }), [canEdit, role]);
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const mode = effectiveMode(snap.mode, caps, presenting);
  const [peers, setPeers] = useState([]);

  const live = useRef({});
  live.current = { activePath, cfg, caps, presenting, mode, togglePresent, exitPresent };

  const activeWin = () => {
    const p = live.current.activePath;
    return p && p !== SYSTEM_TAB ? (iframesRef.current?.get(p)?.contentWindow ?? null) : null;
  };
  const frames = () => [...(iframesRef.current?.values() ?? [])].map((f) => f.contentWindow);
  const laneRef = useRef(null);
  if (!laneRef.current)
    laneRef.current = createModeLane({
      frames,
      active: activeWin,
      flushInsets: () => insetsLane.flushNow(),
    });
  const lane = laneRef.current;

  // A role change clamps (§5.4 "role change": demoted / promoted).
  const capsRef = useRef(null);
  useEffect(() => {
    if (sameCaps(capsRef.current, caps)) return;
    capsRef.current = caps;
    shellMode.clamp(caps);
  }, [caps]);

  // The transition, in two commits:
  //   1. the mode changed → Preview folds the Canvases / AI chat panels to their icons, any other mode
  //      unfolds (Present hides all chrome by its own `.is-present` rule, DDR-117) — and stop;
  //   2. the fold has committed to the DOM (`folded` changed, so this runs again) → `broadcast` flushes
  //      the TARGET layout's insets first (§5.6), then `set-mode` follows on the same lane.
  // The fold is applied once per mode change, so ⌘\ "Show panels" inside Preview is not undone.
  const { folded } = usePanelLayout();
  const foldedForRef = useRef(null);
  const sentRef = useRef(null);
  useLayoutEffect(() => {
    const foldKey = `${mode}:${snap.nonce > 0}`;
    if (foldedForRef.current !== foldKey) {
      foldedForRef.current = foldKey;
      // Only a mode someone CHOSE folds (nonce > 0): a view-only link's boot Preview keeps today's
      // panels, so the Canvases list is there to open a canvas from.
      const want = mode === 'preview' && snap.nonce > 0;
      if (panelLayout.get().folded !== want) {
        panelLayout.setFolded(want);
        return;
      }
    }
    const key = `${mode}|${caps.edit}|${caps.annotate}|${caps.comment}|${snap.nonce}`;
    if (sentRef.current === key) return;
    sentRef.current = key;
    lane.broadcast({ mode, caps, tool: snap.tool });
  }, [mode, caps, snap.nonce, snap.tool, lane, folded]);

  // A newly active canvas is seeded (it may have missed a change while in the background; it re-posts
  // its peers on the seed). The old canvas's faces leave with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activePath is the trigger
  useEffect(() => {
    setPeers([]);
    const win = activeWin();
    if (win) lane.seed(win, { mode: live.current.mode, caps: live.current.caps });
  }, [activePath, lane]);

  useEffect(() => {
    const timers = new Set();
    const seedLater = (win) => {
      for (const ms of SEED_LADDER_MS) {
        const t = setTimeout(() => {
          timers.delete(t);
          if (frames().includes(win))
            lane.seed(win, { mode: live.current.mode, caps: live.current.caps });
        }, ms);
        timers.add(t);
      }
    };
    const onMessage = (e) => {
      const L = live.current;
      const canvasOrigin = L.cfg?.canvasOrigin || window.location.origin;
      // `loaded` fires before the canvas runtime installed its listener: seed on the insets' ladder.
      const raw = e.data?.dgn;
      if (raw === 'loaded' || raw === 'canvas-rendered') {
        if (e.origin !== canvasOrigin) return;
        const win = frames().find((w) => w && w === e.source);
        if (!win) return;
        if (raw === 'loaded') seedLater(win);
        else lane.seed(win, { mode: L.mode, caps: L.caps });
        return;
      }
      const m = acceptFromCanvas(e, { canvasOrigin, active: activeWin() });
      if (!m) return;
      if (m.dgn === 'peers') {
        setPeers(m.peers);
      } else if (m.dgn === 'mode-changed') {
        if (m.cause === 'clamp' && m.mode !== 'present') {
          console.warn(`[maude] the canvas clamped the mode to ${m.mode}`);
          shellMode.adopt(m.mode);
        }
      } else if (m.dgn === 'mode-request') {
        const d = decideModeRequest(m, {
          caps: L.caps,
          presenting: L.presenting,
          mode: L.mode,
          modalOpen: modalOpenNow(),
        });
        if (!d) return;
        if (d.kind === 'deny') {
          if (d.reason === 'role') shellToast(ROLE_DENIAL);
          return;
        }
        if (d.kind === 'present') L.togglePresent?.();
        else if (d.kind === 'exit-present') {
          L.exitPresent?.();
          if (d.next) shellMode.select(d.next.mode, { tool: d.next.tool ?? null });
        } else shellMode.select(d.mode, { tool: d.tool ?? null });
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      for (const t of timers) clearTimeout(t);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: reads live refs
  }, [lane]);

  return {
    mode,
    caps,
    peers,
    select(m) {
      if (m === 'present') {
        if (!live.current.presenting) live.current.togglePresent?.();
        return;
      }
      if (live.current.presenting) live.current.exitPresent?.();
      shellMode.select(m);
    },
  };
}
