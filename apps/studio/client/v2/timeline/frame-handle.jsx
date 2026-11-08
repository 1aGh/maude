// client/v2/timeline/frame-handle.jsx — #128 §5 (T3.6b): the shell's wiring of the on-canvas pan / zoom handle.
//
// The action `video.frame-handle` (⌘K, the clip inspector's "Move on canvas") turns it on and off. While it is on and a
// picture clip is selected in the Timeline, this host tells the ACTIVE canvas which clip (`video-frame-handle`) and
// listens for the canvas's report (`video-frame-commit`, from the active frame only); a report becomes ONE `video.reframe`
// through the Timeline's clip pipe — the write the inspector's Zoom / Focus rows make. Another clip, a closed Timeline or
// the action again takes the handle down. The rules are frame-handle-model.js; the drawing is editing/video-frame-handle.tsx.

import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { shellToast } from '../../shell/util.js';
import { ShellStoreContext } from '../../stores/shell-store.jsx';
import { disabledReason } from '../access/disabled-reason.js';
import { probeSize } from './fit-model.js';
import {
  frameCommitParams,
  frameHandleMessage,
  frameHandleRefusal,
  frameHandleUi,
} from './frame-handle-model.js';

/** The handle's on / off state (a per-viewer UI fact). */
export function useFrameHandleUi() {
  useSyncExternalStore(frameHandleUi.subscribe, frameHandleUi.version, frameHandleUi.version);
  return frameHandleUi.get();
}

/**
 * The lane for the canvas's reports: origin, the active frame and the payload checked by the table.
 * @param {{ canvasOrigin: () => string, activeWin: () => Window|null, onCommit: (m: any) => void }} deps
 */
export function createFrameCommitLane(deps) {
  return {
    onMessage(e) {
      if (e?.data?.dgn !== 'video-frame-commit') return;
      const m = acceptFromCanvas(e, {
        canvasOrigin: deps.canvasOrigin(),
        active: deps.activeWin(),
      });
      if (m?.dgn !== 'video-frame-commit') return;
      deps.onCommit(m);
    },
  };
}

/**
 * @param {{ seq: any|null, comp: { width: number, height: number }|null, fps: number, frame: number, name: string,
 *   artboardId: string|null, canEdit: boolean, url: string|null, run: (params: object) => Promise<any> }} p
 */
export function FrameHandleHost({ seq, comp, fps, frame, name, artboardId, canEdit, url, run }) {
  const ui = useFrameHandleUi();
  const store = useContext(ShellStoreContext);
  const core = store?.shellCore;
  const activePath = core?.activePath ?? null;
  const [src, setSrc] = useState(null);
  const [refused, setRefused] = useState(0);
  const stableId = seq?.stableId ?? null;
  const refusal = frameHandleRefusal(seq);

  // opening on something that cannot be moved says so, once; a different clip turns it off
  useEffect(() => {
    if (!ui) return;
    const why = !canEdit ? disabledReason('viewer') : refusal;
    if (why) {
      shellToast(why);
      frameHandleUi.close();
      return;
    }
    frameHandleUi.pin(stableId);
  }, [ui, canEdit, refusal, stableId]);

  useEffect(() => {
    if (!ui || !url) return undefined;
    let dead = false;
    probeSize(url).then((s) => {
      if (!dead) setSrc(s);
    });
    return () => {
      dead = true;
    };
  }, [ui, url]);

  const out = comp?.width > 0 && comp?.height > 0 ? { w: comp.width, h: comp.height } : null;
  const open = !!ui && canEdit && ui.stableId === stableId;
  const msg = frameHandleMessage({ open, seq, out, frame, fps, src, artboardId, label: name });

  // the live numbers the lane reads (it is mounted once)
  const live = useRef({});
  live.current = {
    activePath,
    iframesRef: core?.iframesRef,
    canvasOrigin: core?.cfg?.canvasOrigin,
    post: core?.postToActiveCanvas,
    seq,
    out,
    frame,
    fps,
    artboardId,
    run,
  };

  const key = `${JSON.stringify(msg)}|${refused}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the message's text + the canvas are the value identity
  useEffect(() => {
    live.current.post?.(msg);
  }, [key, activePath]);
  // the Timeline going away takes the handle with it
  useEffect(
    () => () => live.current.post?.({ dgn: 'video-frame-handle', v: 1, artboardId: null }),
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const lane = createFrameCommitLane({
      canvasOrigin: () => live.current.canvasOrigin || window.location.origin,
      activeWin: () => {
        const p = live.current.activePath;
        return p && p !== SYSTEM_TAB
          ? (live.current.iframesRef?.current?.get(p)?.contentWindow ?? null)
          : null;
      },
      onCommit: (m) => {
        const l = live.current;
        const on = frameHandleUi.get();
        if (
          !on ||
          !l.seq ||
          !l.out ||
          m.stableId !== l.seq.stableId ||
          m.artboardId !== l.artboardId
        )
          return;
        const params = frameCommitParams(l.seq, l.out, l.frame, l.fps, m);
        if (!params) return;
        // a refused write: say the file's numbers again, so the canvas lets go of where it was dragged
        Promise.resolve(l.run?.(params)).then(
          (j) => {
            if (j && j.ok === false) setRefused((n) => n + 1);
          },
          () => setRefused((n) => n + 1)
        );
      },
    });
    window.addEventListener('message', lane.onMessage);
    return () => window.removeEventListener('message', lane.onMessage);
  }, []);

  return null;
}
