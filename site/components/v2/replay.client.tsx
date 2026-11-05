'use client';

// Ported once from .design/ui/Public Site v2.tsx on 2026-11-04; site/ is the source now.
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { at } from './clock';
import { Icon } from './kit/glyphs';

const SHOT_W = 1200;
const SHOT_H = 720;

/**
 * The frame around the product shot. The shot is server-rendered markup on a CSS clock; Replay
 * remounts it with the clock started at the AI's first question, so only the run plays again (the
 * window's own entrance plays once). The frame also scales the fixed 1200 px window down to the
 * space the page has. With JS off there is no Replay and the shot shows its final frame.
 */
export function ReplayShot({
  children,
  shotAt,
  replayAt,
  runFrom,
}: {
  children: ReactNode;
  /** the window's entrance on the intro clock (ms) */
  shotAt: number;
  /** when Replay appears (ms) */
  replayAt: number;
  /** where a replay starts the clock (ms), so run 1+ begins at once */
  runFrom: number;
}) {
  const [run, setRun] = useState(0);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setReady(true), []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / SHOT_W));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="ps-shot-wrap" ref={box}>
      <div className="ps-shot-fit" style={{ width: SHOT_W * scale, height: SHOT_H * scale }}>
        <div className="ps-shot-scale" style={{ transform: `scale(${scale})` }}>
          <div className="ps-shot ps-a ps-a--shot" style={at(shotAt)}>
            <div
              key={run}
              style={{ display: 'contents', ['--t0' as string]: run ? `${runFrom}ms` : '0ms' }}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
      {ready ? (
        <button
          type="button"
          className="ps-replay"
          style={at(replayAt)}
          onClick={() => setRun((n) => n + 1)}
        >
          <Icon name="play" size={14} /> Replay
        </button>
      ) : null}
    </div>
  );
}
