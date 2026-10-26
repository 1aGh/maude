// client/v2/shell/use-occluded-insets.js — V2-4.1: measures the shell's floating islands and tells the
// canvas iframe(s) what they cover (pure core: occlusion-insets.js). One ResizeObserver set + one
// MutationObserver on the body, nothing polled.

import { useEffect, useRef } from 'react';
import { postToCanvas } from '../../../bridge/dgn-protocol.ts';
import { setShellInsets } from './insets-now.js';
import { createInsetsPump, measureShellInsets, seedOnLadder } from './occlusion-insets.js';

/** V2-4.3b — the live pump's synchronous flush, for the mode lane (insets before `set-mode`). A no-op
 *  until the hook has mounted. */
export const insetsLane = { flushNow: () => {} };

/**
 * @param bodyRef the `.sh-body` element — the islands' positioning context
 * @param iframesRef Map<path, HTMLIFrameElement> (the shell's registered canvas frames)
 * @param presenting Present mode → zeros
 * @param layoutKey changes whenever the layout does (pinned / hidden / which panels are open) — re-measures
 *   in the frame the DOM settles; the observers catch the same changes, this is the cheap guarantee
 */
export function useOccludedInsets({ bodyRef, iframesRef, presenting, layoutKey }) {
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  const requestRef = useRef(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const frameEl = () => body.querySelector(':scope > .main');
    const measure = () =>
      measureShellInsets(frameEl(), body, { presenting: presentingRef.current });
    const frames = () => [...(iframesRef.current?.values() ?? [])];
    const pump = createInsetsPump({
      measure,
      send(seq, insets, to) {
        setShellInsets(insets); // P8 C5: shell surfaces that centre on the free canvas read the same value
        const targets = to ? [to] : frames().map((f) => f.contentWindow);
        for (const win of targets) postToCanvas(win, 'occluded-insets', { seq, insets }, '*');
      },
      schedule: (fn) => requestAnimationFrame(fn),
      cancel: (h) => cancelAnimationFrame(h),
    });

    const request = () => pump.request();
    requestRef.current = request;
    insetsLane.flushNow = () => pump.flushNow();
    const ro = new ResizeObserver(request);
    const watched = new Set();
    const sync = () => {
      const now = new Set([body, frameEl(), ...body.querySelectorAll('[data-occludes]')]);
      for (const el of watched)
        if (!now.has(el)) {
          ro.unobserve(el);
          watched.delete(el);
        }
      for (const el of now)
        if (el && !watched.has(el)) {
          ro.observe(el);
          watched.add(el);
        }
      request();
    };
    const mo = new MutationObserver(sync);
    mo.observe(body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'data-occludes'],
    });
    sync();

    // A canvas that has just loaded holds no insets yet (seq -1): seed it with the current value — on
    // the ladder, because its runtime listener is not installed yet when `loaded` arrives.
    const cancels = new Set();
    const onMessage = (e) => {
      const dgn = e.data?.dgn;
      if (dgn !== 'loaded' && dgn !== 'canvas-rendered') return;
      const win = frames().find((f) => f.contentWindow === e.source)?.contentWindow;
      if (!win) return;
      // `canvas-rendered` means the runtime is up for certain (a cold canvas can take seconds, longer
      // than the ladder): one more seed, so the canvas holds the insets for its next Fit.
      if (dgn === 'canvas-rendered') {
        pump.seed(win);
        return;
      }
      const cancel = seedOnLadder(pump, win, {
        alive: () => frames().some((f) => f.contentWindow === win),
      });
      cancels.add(cancel);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('resize', request);
    return () => {
      for (const c of cancels) c();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('resize', request);
      mo.disconnect();
      ro.disconnect();
      pump.dispose();
      requestRef.current = null;
      insetsLane.flushNow = () => {};
    };
  }, [bodyRef, iframesRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutKey is the trigger, not an input
  useEffect(() => {
    requestRef.current?.();
  }, [layoutKey, presenting]);
}
