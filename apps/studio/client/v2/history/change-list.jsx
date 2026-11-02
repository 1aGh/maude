// client/v2/history/change-list.jsx — S1.15: Compare's list of changes, in words (11 · pn-compare).
//
//   ●  Venkovní dres   Dres: černá → zelená                    ✦ Made by AI, 14:32
//   ●  Helma z boku    Logo na helmě: added                    (T) Tereza, 11:20
//
// One line per change, grouped by artboard, each naming the version that made it (a face or the spark and the
// time) — or "changed in between" when no row of its own made it. A click focuses that artboard in both frames.
// A reworked artboard is one line ("Reworked Helma — 624 changes") that opens to its own lines.

import { useState } from 'react';
import { initialsOf, StIcon } from '../../shell/icons.jsx';
import { COMPARE_WORDS as W, makerOf, makerWords } from './blame.js';

function Maker({ maker, index }) {
  return (
    <span
      className={`cmp-who${maker ? '' : ' is-none'}`}
      data-testid={`cmp-who-${index}`}
      data-maker={maker ? maker.kind : 'none'}
    >
      {maker?.kind === 'ai' ? (
        <span className="vh-ai" aria-hidden="true">
          <StIcon name="sparkle" size={10} />
        </span>
      ) : maker ? (
        <span className="vh-face" aria-hidden="true">
          {initialsOf(maker.you ? 'You' : maker.name)}
        </span>
      ) : null}
      <span className="cmp-who-t">{makerWords(maker)}</span>
    </span>
  );
}

const isReworked = (change, detail) =>
  /^Reworked /.test(change.words ?? '') && !!detail?.[change.artboards?.[0] ?? ''];

/**
 * @param p.groups  `groupByArtboard(changes, labels)`
 * @param p.blame   line index → row id (the server's)
 * @param p.rows    the panel's rows, to name the maker
 * @param p.detail  collapsed artboard key → its own lines
 * @param p.focus   the artboard id both frames are on
 * @param p.onFocus (artboardId) → void
 */
export function ChangeList({ groups, blame, rows, detail, focus, onFocus }) {
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <ul className="cmp-list" data-testid="cmp-list" aria-label="Changes">
      {groups.flatMap((g) =>
        g.lines.map(({ index, change }) => {
          const key = change.artboards?.[0] ?? '';
          const lines = isReworked(change, detail) ? detail[key] : null;
          const expanded = lines && open.has(key);
          return (
            <li key={index} className="cmp-item">
              <button
                type="button"
                className={`cmp-line${focus === g.id && g.id ? ' is-focus' : ''}`}
                aria-current={focus === g.id && g.id ? 'true' : undefined}
                data-testid={`cmp-line-${index}`}
                data-artboard={g.id}
                onClick={() => g.id && onFocus?.(g.id)}
              >
                <b className="cmp-dot" aria-hidden="true" />
                <span className="cmp-ab">{g.label}</span>
                <span className="cmp-words">{change.words}</span>
                <Maker maker={makerOf(index, blame, rows)} index={index} />
              </button>
              {lines ? (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm cmp-expand"
                  data-testid={`cmp-expand-${index}`}
                  aria-expanded={expanded ? 'true' : 'false'}
                  onClick={() => toggle(key)}
                >
                  {expanded ? W.collapse : W.expand(lines.length)}
                </button>
              ) : null}
              {expanded ? (
                <ul className="cmp-sub" data-testid={`cmp-sub-${index}`}>
                  {lines.map((l, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the lines are a fixed list from the server
                    <li key={i}>{l.words}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })
      )}
    </ul>
  );
}
