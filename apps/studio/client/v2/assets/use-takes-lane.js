// client/v2/assets/use-takes-lane.js — the shell's takes lane (S8.16): ask about the selected picture, tell the open
// canvas which of its pictures have other takes (`gen-takes`), and run a step — from a shell key
// (`image.next-take` / `image.prev-take`), the overlay's arrows, or a `take-step` the canvas sent.

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import { ROLE_DENIAL } from '../shell/use-canvas-mode-lane.js';
import {
  cachedTakes,
  selectedPicture,
  stepTake,
  subscribeTakes,
  takeAssetsOf,
  takesOf,
} from './takes.js';

const canvasOf = (activePath) => (activePath && activePath !== SYSTEM_TAB ? activePath : null);

/**
 * One take step for the shell: the session's role first (a viewer hears the one denial line; the server refuses as
 * well), then `stepTake` with the canvas's undo stack as the record sink.
 * @param {'next' | 'prev'} dir
 * @param {{ activePath?: string, selected?: unknown, viewerMode?: boolean, postToActiveCanvas?: (m: object) => void,
 *   toast?: (line: string) => void, fetch?: typeof fetch }} d
 */
export async function runTakeStep(dir, d) {
  const toast = d.toast ?? shellToast;
  const canvas = canvasOf(d.activePath);
  if (!canvas) return { ok: false };
  if (d.viewerMode) {
    toast(ROLE_DENIAL);
    return { ok: false };
  }
  const r = await stepTake(dir, {
    canvas,
    selected: d.selected,
    fetch: d.fetch,
    record: (payload) => d.postToActiveCanvas?.({ dgn: 'record-edit', payload }),
  });
  if (!r.ok && r.message) toast(r.message);
  return r;
}

/** What the mounted lane last saw — the menu row (⌘K) and a canvas `take-step` run over it. */
let env = null;

/** `image.next-take` / `image.prev-take` from a menu row or the canvas: over the shell's current selection. */
export function runTakeStepNow(dir) {
  return env ? runTakeStep(dir, env) : Promise.resolve({ ok: false });
}

/**
 * Canvas → shell `take-step`: only from the active canvas, on the canvas origin, while that frame holds the focus of a
 * focused window (the key was pressed there — the `undo-key` gate). The shell's own selection and role decide the rest.
 */
export function acceptTakeStep(e, o) {
  if (e?.data?.dgn !== 'take-step') return null;
  const m = acceptFromCanvas(e, { canvasOrigin: o.canvasOrigin, active: o.active });
  if (m?.dgn !== 'take-step') return null;
  if (!o.focused()) return null;
  return m.dir;
}

/**
 * Ask about the selected picture, keep the open canvas's `gen-takes` set current, and answer its `take-step`.
 * `iframesRef`: Map<path, HTMLIFrameElement>; `cfg.canvasOrigin` the canvas origin.
 */
export function useTakesLane({
  activePath,
  selected,
  viewerMode,
  postToActiveCanvas,
  iframesRef,
  cfg,
}) {
  env = { activePath, selected, viewerMode, postToActiveCanvas };
  const live = useRef(env);
  live.current = { ...env, iframesRef, cfg };
  useEffect(() => {
    const onMessage = (e) => {
      const l = live.current;
      const frame = l.activePath ? l.iframesRef?.current?.get(l.activePath) : null;
      const dgn = e?.data?.dgn;
      if (
        (dgn === 'loaded' || dgn === 'canvas-rendered') &&
        frame &&
        e.source === frame.contentWindow
      ) {
        // a reloaded canvas starts with no set
        const c = canvasOf(l.activePath);
        if (c) l.postToActiveCanvas?.({ dgn: 'gen-takes', assets: takeAssetsOf(c) });
        return;
      }
      const dir = acceptTakeStep(e, {
        canvasOrigin: l.cfg?.canvasOrigin || window.location.origin,
        active: frame?.contentWindow ?? null,
        focused: () => !!frame && document.hasFocus() && document.activeElement === frame,
      });
      if (dir) void runTakeStep(dir, l);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const canvas = canvasOf(activePath);
  const pic = selectedPicture(selected);
  const asset = pic?.asset ?? null;
  useEffect(() => {
    if (canvas && asset) void takesOf(canvas, asset);
  }, [canvas, asset]);
  useEffect(() => {
    if (!canvas) return undefined;
    let last = '';
    const send = (force) => {
      const assets = takeAssetsOf(canvas);
      const k = assets.join('\n');
      if (!force && k === last) return;
      last = k;
      postToActiveCanvas?.({ dgn: 'gen-takes', assets });
    };
    // a selection change re-sends the set: a reloaded canvas lost it
    send(true);
    return subscribeTakes(() => send(false));
  }, [canvas, asset, postToActiveCanvas]);
}

let version = 0;
let counting = false;
const takesVersion = () => version;
const subscribeVersion = (fn) => {
  if (!counting) {
    counting = true;
    subscribeTakes(() => {
      version += 1;
    });
  }
  return subscribeTakes(fn);
};

/** What the overlay shows for the selected picture: { label, madeByAi } or null. */
export function useSelectedTakes(activePath, selected) {
  const canvas = canvasOf(activePath);
  useSyncExternalStore(subscribeVersion, takesVersion, takesVersion);
  const pic = selectedPicture(selected);
  const a = pic && canvas ? cachedTakes(canvas, pic.asset) : null;
  if (!a) return null;
  if (!a.madeByAi && !(a.takes.length > 1)) return null;
  return { label: a.takes.length > 1 ? a.label : null, madeByAi: a.madeByAi };
}
