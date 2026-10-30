// client/v2/export/sections/render-row.jsx — S8.5: the video's Render row (09 ex-offline).
//
//   Render   ( ) In the cloud   Waits for a connection, then starts by itself.
//            (•) On this Mac    Starts now. About 3 min — keep this window open until it's done.
//
// Shown only when the estimate says the cloud is on offer for this spec (`est.render.cloud`: a video,
// a cloud door on this Mac, sRGB, today's version). Images and PDFs never get the row — they always
// export on this Mac, in seconds, offline too. The choice itself is `client/export-lane.js`
// `renderChoice`; this file only draws it. Radios, ← → move and pick, one tab stop.

import { useRef } from 'react';
import { RENDER_ROW } from '../../../export-lane.js';
import { StIcon } from '../../../shell/icons.jsx';
import { Row } from '../parts.jsx';

/**
 * @param {{ choice: ReturnType<typeof import('../../../export-lane.js').renderChoice>,
 *           onPick: (lane: 'cloud' | 'this-mac') => void }} props
 */
export function RenderRow({ choice, onPick }) {
  const refs = useRef({});
  if (!choice?.show) return null;
  const ids = choice.options.map((o) => o.id);
  const move = (e) => {
    if (
      e.key !== 'ArrowRight' &&
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowUp'
    )
      return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const to = ids[(ids.indexOf(choice.lane) + step + ids.length) % ids.length];
    onPick(to);
    refs.current[to]?.focus();
  };
  return (
    <Row k={RENDER_ROW} top testid="export-row-render" note={choice.why}>
      {/* biome-ignore lint/a11y/useSemanticElements: a radio group of cards, the design's control */}
      <span
        className="ex-opts"
        role="radiogroup"
        aria-label={RENDER_ROW}
        data-testid="export-render"
        data-value={choice.lane}
      >
        {choice.options.map((o) => {
          const on = o.id === choice.lane;
          return (
            // biome-ignore lint/a11y/useSemanticElements: see the group
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              className="ex-opt"
              data-on={on ? 'true' : undefined}
              data-testid={`export-render-${o.id}`}
              ref={(el) => {
                refs.current[o.id] = el;
              }}
              onClick={() => onPick(o.id)}
              onKeyDown={move}
            >
              <span className="ex-radio" data-on={on ? 'true' : undefined} />
              <span className="ex-opt-ic">
                <StIcon name={o.icon} size={16} />
              </span>
              <span className="ex-opt-t">
                <strong>{o.title}</strong>
                <small>{o.sub}</small>
              </span>
            </button>
          );
        })}
      </span>
    </Row>
  );
}
