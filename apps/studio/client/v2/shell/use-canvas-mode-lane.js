// client/v2/shell/use-canvas-mode-lane.js — V2-4.3b: the shell's mode lane, wired (pure core:
// canvas-mode.js).
//
//   the Share cluster switch → shellMode.select → fold (Preview) → insets → `set-mode` to every canvas
//   a canvas `mode-request`   → M4 (active canvas only, no modal, the role allows it) → the same path
//   a canvas `mode-changed`   → a clamp is adopted (the canvas is defence in depth behind the role)
//   a canvas `peers`          → the cluster's faces (active canvas only — the table's gate)
//   a canvas `present-position` → the store's Present position (S3.2b's counter reads it)
//   `loaded` / `canvas-rendered` / a new active canvas → that frame is seeded with the current mode
//
// S3.1 (D1): `shellMode` is the ONE mode owner, Present included. The shell's `presentMode` is
// `usePresentMode()` — derived from the store — and every way into Present (the switch, Present ⌄,
// ⌥⌘↵ / ⇧⌥⌘↵, View › Present the canvas, `maude design open --mode present`, a canvas request) goes
// through `presentFrom` / `shellMode.present`.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { acceptFromCanvas, postToCanvas } from '../../../bridge/dgn-protocol.ts';
import { foldsPanels } from '../../../bridge/mode-shows.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { presenterOn, presentRunStore, usePresenterState } from '../present/presenter-store.js';
import { presentZoomStore } from '../present/present-zoom-store.js';
import { shellToast } from '../../shell/util.js';
import {
  capsFor,
  createModeLane,
  createShellMode,
  decideModeRequest,
  effectiveMode,
  heldMode,
  presentingOf,
  presentSpecFor,
  sameCaps,
  shellEscDecision,
} from './canvas-mode.js';
import { SEED_LADDER_MS } from './occlusion-insets.js';
import { insetsLane } from './use-occluded-insets.js';
import { panelLayout, usePanelLayout } from './use-panel-layout.js';

/**
 * Do the Canvases / AI chat panels fold to their icons? Where the what-shows table says so — and only for a mode
 * someone CHOSE (nonce > 0): a view-only link's boot Preview keeps the panels, so the Canvases list is there to
 * open a canvas from.
 */
export const wantsFold = (mode, snap) => foldsPanels(mode, snap.present) && snap.nonce > 0;

/** The window's one mode store (mode is per project window, Q6). */
export const shellMode = createShellMode();

/** What Present starts from, kept current by the shell core (it owns the selection and the in-view
 *  artboard): `{ selectedArtboard, inViewArtboard }`. Read when Present is entered, never rendered. */
const presentSource = { selectedArtboard: null, inViewArtboard: null };
export function setPresentSource(next) {
  presentSource.selectedArtboard = next?.selectedArtboard ?? null;
  presentSource.inViewArtboard = next?.inViewArtboard ?? null;
}

/** Enter Present: 'selection' (⌥⌘↵, a click on Present), 'start' (⇧⌥⌘↵), 'canvas' (pan freely). */
export function presentFrom(kind) {
  return shellMode.present(presentSpecFor(kind, presentSource));
}

/** View › Present the canvas is a toggle (DDR-117): on presents the canvas, off leaves Present. */
export function togglePresentCanvas() {
  if (presentingOf(shellMode.get())) shellMode.back();
  else presentFrom('canvas');
}

/**
 * S3.12 — esc pressed with the shell focused: take the mode's one step back (`shellEscDecision`). `typing` is a
 * text field, `overlayOpen` any menu / sheet / popover that closes itself first. Returns what it did, or null.
 */
export function shellStepBack({ canEdit, typing = false } = {}) {
  const snap = shellMode.get();
  const overlayOpen =
    modalOpenNow() ||
    (typeof document !== 'undefined' &&
      !!document.querySelector('[role="menu"], [data-esc-owner], .st-overlay'));
  const d = shellEscDecision({
    mode: snap.mode,
    presenting: presentingOf(snap),
    viewing: !!snap.viewing,
    caps: capsFor({ canEdit: !!canEdit }),
    typing,
    overlayOpen,
  });
  if (!d) return null;
  if (d.kind === 'exit-viewing') shellMode.leaveViewing();
  else if (d.kind === 'exit-present') shellMode.back();
  else shellMode.select(d.mode);
  return d.kind;
}

/** The shell's DDR-117 setter, derived: `on` (or `(v) => on`) enters Present · Canvas / leaves. */
export function setPresenting(next) {
  const cur = presentingOf(shellMode.get());
  const on = typeof next === 'function' ? !!next(cur) : !!next;
  if (on === cur) return;
  if (on) presentFrom('canvas');
  else shellMode.back();
}

const presentingNow = () => presentingOf(shellMode.get());

/** D1 — `[presentMode, setPresentMode]` for the shell core: derived from the one store. */
export function usePresentMode() {
  const presentMode = useSyncExternalStore(shellMode.subscribe, presentingNow, presentingNow);
  return [presentMode, useCallback(setPresenting, [])];
}

// S3.2b — the shell's own controls (and the keys the shell hears) step the presenting canvas through the
// lane the mounted hook owns; there is one lane per window, so one registered stepper.
let presentStepper = null;
let presentMediaCommander = null;

/** Step Present · Artboards: 'next' · 'prev' · an index. Nothing outside Present. */
export function presentStep(to) {
  if (presentingOf(shellMode.get())) presentStepper?.(to);
}

/** S3.3 — the transport's buttons: 'play' · 'pause' · 'mute' · 'unmute' to the clip on the presented artboard. */
export function presentMediaCmd(op) {
  if (presentingOf(shellMode.get())) presentMediaCommander?.(op);
}

const modalOpenNow = () =>
  typeof document !== 'undefined' && !!document.querySelector('[role="dialog"][aria-modal="true"]');

export const ROLE_DENIAL = 'You can view this canvas. Ask a project owner for edit access.';

/**
 * @returns {{ mode, caps, peers, follow(clientID), select(mode), present(kind), step(to) }}
 *   `mode` is what the canvases are in; `peers` are the active canvas's
 */
export function useCanvasModeLane({ activePath, iframesRef, cfg, canEdit, role }) {
  const caps = useMemo(() => capsFor({ canEdit, role }), [canEdit, role]);
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const mode = effectiveMode(snap.mode, caps);
  const presenting = presentingOf(snap);
  // S1.14 — a past version held by the store (Version history's Viewing): the canvases are told Viewing with
  // no capabilities (`sent`), whatever the role; `mode` / `caps` below stay what the person is in.
  const sent = heldMode(snap, mode, caps);
  const [peers, setPeers] = useState([]);

  // S3.6b — presenter view on: a role that cannot edit still publishes its Present position, so the audience
  // window has a session to follow (`set-mode caps.present`, S3-present-session §3).
  const presenterView = presenterOn(usePresenterState());

  const live = useRef({});
  live.current = {
    activePath,
    cfg,
    caps,
    presenting,
    mode,
    present: snap.present,
    viewing: snap.viewing,
    sent,
    presenterView,
  };

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: activeWin reads live refs
  useEffect(() => {
    presentStepper = (to) => lane.step(activeWin(), to);
    presentMediaCommander = (op) => lane.media(activeWin(), op);
    return () => {
      presentStepper = null;
      presentMediaCommander = null;
    };
  }, [lane]);

  // The pill's zoom belongs to one Present: leaving it clears the number.
  useEffect(() => {
    if (!presenting) presentZoomStore.set(null);
  }, [presenting]);

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
      const want = wantsFold(mode, snap);
      if (panelLayout.get().folded !== want) {
        panelLayout.setFolded(want);
        return;
      }
    }
    const key = `${sent.mode}|${sent.caps.edit}|${sent.caps.annotate}|${sent.caps.comment}|${snap.nonce}|${snap.viewing ? 'v' : ''}|${presenterView}`;
    if (sentRef.current === key) return;
    sentRef.current = key;
    lane.broadcast({
      mode: sent.mode,
      caps: sent.caps,
      tool: snap.tool,
      present: snap.present,
      presenterView,
    });
  }, [
    mode,
    caps,
    sent.mode,
    sent.caps,
    snap.viewing,
    snap.nonce,
    snap.tool,
    snap.present,
    presenterView,
    lane,
    folded,
  ]);

  // A newly active canvas is seeded (it may have missed a change while in the background; it re-posts
  // its peers on the seed). The old canvas's faces leave with it.
  const seedOf = () => ({
    mode: live.current.sent.mode,
    caps: live.current.sent.caps,
    present: live.current.present,
    presenterView: live.current.presenterView,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: activePath is the trigger
  useEffect(() => {
    setPeers([]);
    const win = activeWin();
    if (win) lane.seed(win, seedOf());
  }, [activePath, lane]);

  useEffect(() => {
    const timers = new Set();
    const seedLater = (win) => {
      for (const ms of SEED_LADDER_MS) {
        const t = setTimeout(() => {
          timers.delete(t);
          if (frames().includes(win)) lane.seed(win, seedOf());
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
        else lane.seed(win, seedOf());
        return;
      }
      const m = acceptFromCanvas(e, { canvasOrigin, active: activeWin() });
      if (!m) return;
      if (m.dgn === 'peers') {
        setPeers(m.peers);
      } else if (m.dgn === 'present-position') {
        // Present · Artboards moved on (S3.2a's stage echoes every step); the canvas's own hold
        // (_shell.html) lands its held write on the same move. Active canvas only (the table's gate).
        shellMode.position(m);
      } else if (m.dgn === 'present-run') {
        // S3.6b — the artboards with their world rects, in canvas order: the presenter view's order map
        // (the canvas is the only place the live layout exists). Active canvas only, like the position.
        presentRunStore.set({ file: L.activePath, artboards: m.artboards });
      } else if (m.dgn === 'present-media') {
        // The clip on the presented artboard (S3.3): the transport mirrors it. Active canvas only.
        shellMode.media(m);
      } else if (m.dgn === 'viewport-zoom') {
        // Present the canvas: the pill shows the canvas's zoom (present/present-zoom.ts posts it).
        if (L.presenting) presentZoomStore.set(m.zoom);
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
          viewing: L.viewing,
        });
        if (!d) return;
        if (d.kind === 'deny') {
          if (d.reason === 'role') shellToast(ROLE_DENIAL);
          return;
        }
        if (d.kind === 'exit-viewing') {
          shellMode.leaveViewing();
          return;
        }
        if (d.kind === 'present') shellMode.present(d.present);
        else if (d.kind === 'exit-present') {
          if (d.next) shellMode.select(d.next.mode, { tool: d.next.tool ?? null });
          else shellMode.back();
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
    /** The Present spec while presenting (Artboards · Canvas), else null. */
    presentSpec: snap.present,
    peers,
    /** A peer's face in the cluster: Follow / Stop following on the active canvas (`peer.follow`). */
    follow(clientID) {
      const win = activeWin();
      if (!win || typeof clientID !== 'number') return;
      postToCanvas(win, 'run-action', { v: 1, id: 'peer.follow', params: { clientID } }, '*');
    },
    /** The switch: a click on Present starts from the selected artboard (04 md-present-menu). */
    select(m) {
      if (m === 'present') {
        presentFrom('selection');
        return;
      }
      shellMode.select(m);
    },
    /** Present ⌄: 'selection' · 'start' · 'canvas'. */
    present: presentFrom,
    /** Present · Artboards: next / prev / an index, on the active canvas (S3.2b's controls). */
    step(to) {
      if (!presentingOf(shellMode.get())) return;
      lane.step(activeWin(), to);
    },
  };
}
