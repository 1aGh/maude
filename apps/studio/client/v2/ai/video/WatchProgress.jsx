// client/v2/ai/video/WatchProgress.jsx — S7.15 (07 · ve-ai-watch): "Watching 12 clips… 7 done". One tile per
// attached clip (a tick when watched, the spark on the one AI is on, dimmed while it waits) and the last few
// things AI liked so far — the second, what is in it, and the clip. Presentational: `model` is card-model.js
// `watchModel`, which is built from the run's progress (files), never from the model's words.

import { Spark } from '../icons.jsx';
import { Check } from '../icons.jsx';
import { posterSrc } from './clip-pic.js';

const STATE_WORD = { done: 'watched', now: 'watching now', wait: 'waiting' };

export function WatchProgress({ model, urlOf }) {
  if (!model) return null;
  return (
    <div
      className="ai-vcard"
      data-testid="ai-watch-card"
      data-done={model.done}
      data-total={model.total}
    >
      <p className="ai-vcard-t" data-testid="ai-watch-title">
        <Spark size={14} />
        {model.title}
      </p>
      <ul className="ai-vwatch" aria-label="The clips AI is watching">
        {model.tiles.map((c) => (
          <li
            key={c.asset}
            className={`ai-vwatch-c${c.state === 'wait' ? ' ai-vwatch-c--wait' : ''}`}
            data-state={c.state}
            title={c.name}
            aria-label={`${c.name}: ${STATE_WORD[c.state] ?? c.state}`}
          >
            <video
              src={posterSrc(urlOf(c.asset))}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
            />
            {c.state === 'done' ? (
              <span className="ai-vwatch-st" aria-hidden="true">
                <Check size={10} />
              </span>
            ) : c.state === 'now' ? (
              <span className="ai-vwatch-st ai-vwatch-st--now" aria-hidden="true">
                <Spark size={9} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {model.found.length ? (
        <div className="ai-vfound" data-testid="ai-watch-found">
          {model.found.map((f) => (
            <span key={f.asset}>
              <b>{f.at}</b>
              {f.line}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
