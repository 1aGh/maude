// editing/empty-reporter.tsx — S11.2: mounts the empty-state reporter (empty-report.ts) in the canvas.
// It renders nothing. It asks for a measurement when the selection changes and when the document's structure
// changes (a layer drawn, an artboard added or deleted); while an empty artboard is selected the reporter's own
// frame loop keeps the hint's rect on the artboard through pan and zoom.

import { useEffect, useRef } from 'react';

import { postToShell } from '../bridge/dgn-protocol.ts';
import { useSelectionSet } from '../use-selection-set.tsx';
import { createEmptyReporter, EMPTY_CHROME_SEL } from './empty-report.ts';

/** A whole-artboard selection (no element id) → that artboard's id; anything else → null. */
export function selectedArtboardOf(
  selected: ReadonlyArray<{ id?: string | null; artboardId?: string | null }>
): string | null {
  if (selected.length !== 1) return null;
  const s = selected[0];
  return !s.id && typeof s.artboardId === 'string' ? s.artboardId : null;
}

export function EmptyArtboardReporter(): null {
  const { selected } = useSelectionSet();
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedArtboardOf(selected);
  const requestRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const reporter = createEmptyReporter({
      doc: document,
      selectedArtboard: () => selectedRef.current,
      post: (m) => {
        if (m.dgn === 'artboards') postToShell(window, 'artboards', { count: m.count });
        else
          postToShell(window, 'artboard-empty', {
            artboardId: m.artboardId,
            rect: m.rect,
            ...(m.label !== undefined ? { label: m.label } : {}),
            ...(m.from !== undefined ? { from: m.from } : {}),
          });
      },
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
