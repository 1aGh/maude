// client/v2/timeline/advanced/render-settings.jsx — S7.18: "This video" (06 ad-timeline) / "Render settings"
// (07 ve-advanced), and the "+ track" under it (CONTRACT C35). Rows are mono and read-only: what the engine
// reads. The one thing here a person changes is how long an export may be (C22) — "Allow longer".

import { ADV_WORDS, renderRows } from './model.js';

/**
 * @param {{ fps: number, total: number, cap: ReturnType<import('./video-cap.js').capView>, canEdit: boolean,
 *   onCap: (action: 'allow'|'back') => void, have: string[], onAddTrack: (id: string) => void }} p
 */
export function RenderSettings({ fps, total, cap, canEdit, onCap, have, onAddTrack }) {
  return (
    <section className="tla-sec" data-testid="timeline-render-settings">
      <h3 className="tla-h">{ADV_WORDS.thisVideo}</h3>
      {renderRows({ fps, total }).map((r) => (
        <div className="tla-row" key={r.k}>
          <span className="tla-k">{r.k}</span>
          <span className="tla-v">{r.v}</span>
        </div>
      ))}
      <div className="tla-long" data-testid="timeline-cap" data-kind={cap.kind}>
        <span className="tla-k tla-k--plain">{ADV_WORDS.longVideos}</span>
        <p className="tla-note tla-note--cap" data-testid="timeline-cap-line">
          {cap.line}
        </p>
        {cap.action && canEdit ? (
          <button
            type="button"
            className="tla-btn"
            data-testid={
              cap.action === 'allow' ? 'timeline-allow-longer' : 'timeline-allow-longer-off'
            }
            onClick={() => onCap(cap.action)}
          >
            {cap.actionLabel}
          </button>
        ) : null}
      </div>
      <div className="tla-tracks" data-testid="timeline-add-track">
        <span className="tla-k tla-k--plain">{ADV_WORDS.addTrack}</span>
        <span className="tla-trackbtns">
          {['video2', 'music2'].map((id) => {
            const there = have.includes(id);
            return (
              <button
                key={id}
                type="button"
                className="tla-btn"
                disabled={there}
                aria-label={`Add ${ADV_WORDS.trackNames[id]}`}
                data-testid={`timeline-add-track-${id}`}
                onClick={() => onAddTrack(id)}
              >
                {ADV_WORDS.trackNames[id]}
              </button>
            );
          })}
        </span>
      </div>
    </section>
  );
}
