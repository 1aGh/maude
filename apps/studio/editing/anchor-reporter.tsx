// editing/anchor-reporter.tsx — S7.7: mounts the artboard-anchor reporter (anchor-report.ts) in the canvas.
// It renders nothing. It asks for a measurement when the selection changes and when the document's structure
// changes (an artboard became a video, was removed); while a video artboard is selected the reporter's own
// frame loop keeps its rect current through pan and zoom, so the timeline island follows the camera.

import { useEffect, useRef } from 'react';

import { postToShell } from '../bridge/dgn-protocol.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { createAnchorReporter } from './anchor-report.ts';
import { EMPTY_CHROME_SEL } from './empty-report.ts';
import { selectedArtboardOf } from './empty-reporter.tsx';

export function ArtboardAnchorReporter(): null {
  const { selected } = useSelectionSet();
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedArtboardOf(selected);
  const requestRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const reporter = createAnchorReporter({
      doc: document,
      selectedArtboard: () => selectedRef.current,
      post: (m) =>
        postToShell(window, 'artboard-anchor', {
          artboardId: m.artboardId,
          ...(m.kind !== undefined ? { kind: m.kind } : {}),
          ...(m.label !== undefined ? { label: m.label } : {}),
          ...(m.rect !== undefined ? { rect: m.rect } : {}),
        }),
    });
    requestRef.current = reporter.request;
    reporter.request();
    let obs: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined') {
      obs = new MutationObserver((records) => {
        // chrome churn (halos, pins, the activity rim) is not structure
        const structural = records.some(
          (r) =>
            r.type === 'childList' &&
            [...r.addedNodes, ...r.removedNodes].some(
              (n) => n.nodeType === 1 && !(n as Element).closest?.(EMPTY_CHROME_SEL)
            )
        );
        if (structural) reporter.request();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      obs?.disconnect();
      reporter.cancel();
      requestRef.current = null;
    };
  }, []);

  // a new selection is a new question
  // biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is the trigger, the id is read from the ref
  useEffect(() => {
    requestRef.current?.();
  }, [selected]);

  return null;
}
