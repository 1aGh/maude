// client/v2/ds/off-system-host.jsx — S10.17: the shell's side of the off-system question (13 · ds-edge-suggest).
//
// When a canvas that follows a design system opens, has drawn again, or the system was written (ds-refresh.js,
// 2.0.5 — never on a clock), it asks the server for the hand-picked colours on the lines changed since the last commit (`GET /_api/ds/off-system`, the S1 rule of S10 Q12)
// and draws the first one the person has not put away as ONE quiet question. "Use <closest>" is an edit on the element
// that carries the colour (`ds.use-nearest`, one ⌘Z); "Add it to the system" is a waiting new colour (`ds.add-colour`);
// "Not now" puts the question away until the canvas is opened again. Mounted once, inside the DS review host.
//
// The server judges everything again; a stale question ("the colour moved") is read again, never forced.

import { useCallback, useEffect, useRef, useState } from 'react';
import { canvasDsSystem } from '../../canvas-url.js';
import { EDGE_WORDS, findingKey, nextFinding } from './edge-model.js';
import { addColourNow, fetchOffSystem, applyNearestNow } from './edge-write.js';
import { dsRefresh } from './ds-refresh.js';
import { OffSystemQuestion } from './off-system.jsx';
import { openCanvasRel } from './switch-host.jsx';

/** the first look comes a moment after the canvas opens: the question is a courtesy, never in the way */
export const OFF_SYSTEM_FIRST_MS = 2500;

/** "ui/Pricing.tsx" → "Pricing" */
const canvasNameOf = (rel) =>
  String(rel ?? '')
    .replace(/^.*\//, '')
    .replace(/\.tsx$/i, '');

export function DsOffSystemHost({
  cfg,
  activePath,
  toast,
  fetchImpl,
  frameFor,
  firstMs = OFF_SYSTEM_FIRST_MS,
}) {
  const rel = openCanvasRel(activePath, cfg);
  // only a canvas that follows a converted system can have an off-system colour
  const entry = rel ? canvasDsSystem(rel, cfg) : null;
  const canvas = entry && cfg?.dsConverted?.[entry.name] === true ? rel : null;
  const [answer, setAnswer] = useState(null);
  const [, bump] = useState(0);
  const dismissed = useRef(new Set());
  const live = useRef({ toast, fetchImpl, frameFor });
  live.current = { toast, fetchImpl, frameFor };
  const f = () => live.current.fetchImpl ?? globalThis.fetch;
  const refreshRef = useRef(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the canvas and the first delay are the triggers
  useEffect(() => {
    dismissed.current = new Set();
    setAnswer(null);
    if (!canvas) return undefined;
    let dead = false;
    let seq = 0;
    const read = async (fetchImpl) => {
      const n = ++seq;
      const got = await fetchOffSystem({ canvas }, fetchImpl);
      if (dead || n !== seq) return;
      // a refusal or an unreachable studio says nothing: the question is a courtesy, never an error
      setAnswer(got.ok ? got.answer : null);
    };
    // 2.0.5: a moment after the canvas opens, then on a redraw, a write or a return to the window
    const reads = dsRefresh(read, {
      fetchImpl: f,
      firstMs,
      frameFor: () => live.current.frameFor?.() ?? null,
    });
    refreshRef.current = reads.now;
    return () => {
      dead = true;
      reads.stop();
      refreshRef.current = null;
    };
  }, [canvas, firstMs]);

  const finding = nextFinding(answer?.findings, dismissed.current);
  const putAway = useCallback((fd) => {
    dismissed.current.add(findingKey(fd));
    bump((n) => n + 1);
  }, []);

  if (!canvas || !answer || !finding) return null;
  return (
    <OffSystemQuestion
      key={findingKey(finding)}
      finding={finding}
      systemLabel={answer.system}
      canvasName={canvasNameOf(rel)}
      onDismiss={() => putAway(finding)}
      onUse={async () => {
        const r = await applyNearestNow({ canvas, finding, css: finding.nearest?.css }, f());
        if (r.ok) {
          live.current.toast?.(EDGE_WORDS.used);
          putAway(finding);
          await refreshRef.current?.();
        } else if (r.code === 'stale' || r.code === 'failed') await refreshRef.current?.();
        return r;
      }}
      onAdd={async () => {
        const r = await addColourNow({ ds: answer.system, value: finding.literal }, f());
        if (r.ok) {
          live.current.toast?.(EDGE_WORDS.added);
          putAway(finding);
        }
        return r;
      }}
    />
  );
}
