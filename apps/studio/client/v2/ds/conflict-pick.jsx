// client/v2/ds/conflict-pick.jsx — S10.11: "Accent changed in two places" (13 · ds-truth-conflict, V2-1.6 §5.11 b)
// and "Published in two places" (§5.7, drawn like 12).
//
// A clash keeps both versions, side by side, until the person picks one. Canvases keep head meanwhile — nothing
// follows either side. "Use this" on the canvas side writes the canvas value into the files; on the file side the
// file stays as it is and the waiting canvas edit is dropped. The one not picked stays in Version history.
//
// "Published in two places" is the same pick between two HEAD revisions, when two Macs published from one head
// at once: Plane B renamed one copy of head.json aside, and both revisions exist. Picking is a publish whose
// expectHead is the surviving head — nothing is lost.
//
// Cards draw what they are given; the host (truth-host.jsx) runs the pick.

import { StIcon } from '../../shell/icons.jsx';
import { valueWords } from './colour-words.js';
import { safeColour, TRUTH_WORDS, whoWords } from './truth-model.js';
import { agoWords } from './update-model.js';

function Side({ label, value, name, who, ago, testid, busy, onUse }) {
  const colour = safeColour(value);
  return (
    <span className="dst-cf-c" data-testid={testid}>
      <em>{label}</em>
      {colour ? (
        <i className="dst-cf-chip" style={{ background: colour }} aria-hidden="true" />
      ) : null}
      <b>{valueWords(name, value)}</b>
      <span className="dst-cf-who">{[who, ago].filter(Boolean).join(' · ')}</span>
      <button
        type="button"
        className="btn btn--sm"
        data-testid={`${testid}-use`}
        disabled={busy}
        onClick={onUse}
      >
        {TRUTH_WORDS.useThis}
      </button>
    </span>
  );
}

/**
 * One token that changed in two places.
 * @param {{ card: any, fileName: string, busy?: boolean, note?: string | null,
 *           onPick: (css: string, use: 'canvas' | 'file') => void }} props
 */
export function ConflictPick({ card, fileName, busy = false, note = null, onPick }) {
  if (!card) return null;
  return (
    <section
      className="dst"
      data-testid="ds-conflict"
      data-css={card.css}
      aria-label={`${card.label} changed in two places`}
    >
      <p
        className="dst-title"
        data-testid="ds-conflict-title"
      >{`${card.label} changed in two places`}</p>
      <p className="dst-src" data-testid="ds-conflict-lead">
        <StIcon name="problem" size={14} />
        <span>
          Pick one. Until then canvases keep{' '}
          {card.keeps ? <b>{card.keeps}</b> : 'the value they have'}.
        </span>
      </p>
      <span className="dst-cf">
        <Side
          testid="ds-conflict-canvas"
          label="On this canvas"
          value={card.canvas.value}
          name={card.canvas.name}
          who={card.canvas.who}
          ago={card.canvas.ago}
          busy={busy}
          onUse={() => onPick(card.css, 'canvas')}
        />
        <Side
          testid="ds-conflict-file"
          label={`In ${fileName || 'the file'}`}
          value={card.file.value}
          name={card.file.name}
          who={card.file.who}
          ago={card.file.ago}
          busy={busy}
          onUse={() => onPick(card.css, 'file')}
        />
      </span>
      <p className="dst-fine" data-testid="ds-conflict-fine">
        {TRUTH_WORDS.conflictFine}
      </p>
      {note ? (
        <p className="dst-err" role="status" data-testid="ds-conflict-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}

const shortId = (id) => (typeof id === 'string' ? id.slice(0, 8) : '');

/**
 * Two heads. `places` is the server's `publishedInTwoPlaces`: `{ file, head, by, at, summary }` each.
 * @param {{ places: any[], busy?: boolean, note?: string | null, onPick: (head: string) => void, now?: number }} props
 */
export function PublishedTwice({ places, busy = false, note = null, onPick, now }) {
  if (!Array.isArray(places) || places.length < 2) return null;
  return (
    <section className="dst" data-testid="ds-twice" aria-label={TRUTH_WORDS.twiceTitle}>
      <p className="dst-title" data-testid="ds-twice-title">
        {TRUTH_WORDS.twiceTitle}
      </p>
      <p className="dst-src" data-testid="ds-twice-lead">
        <StIcon name="problem" size={14} />
        <span>{TRUTH_WORDS.twiceLead}</span>
      </p>
      <span className="dst-cf">
        {places.slice(0, 2).map((p, i) => (
          <span className="dst-cf-c" key={p.head} data-testid="ds-twice-place" data-head={p.head}>
            <em>{i === 0 ? 'This copy' : 'The other copy'}</em>
            <b>
              {typeof p.summary === 'string' && p.summary
                ? p.summary
                : `Version ${shortId(p.head)}`}
            </b>
            <span className="dst-cf-who">
              {[p.by ? whoWords(p.by) : null, agoWords(p.at, now ?? Date.now())]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              data-testid="ds-twice-use"
              disabled={busy}
              onClick={() => onPick(p.head)}
            >
              {TRUTH_WORDS.useThis}
            </button>
          </span>
        ))}
      </span>
      {note ? (
        <p className="dst-err" role="status" data-testid="ds-twice-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}
