// The AI's directions, drawn on the Design system canvas (S10.16b, 13 · ds-make-directions / ds-make-mix).
//
// `<DSDirection id="a" />` is the body of the artboard `ds-dir-a`: one tile, moodboard-style, drawn from the draft
// revision's OWN tokens (the board model carries only the dozen values a tile needs, already checked as plain CSS
// values). A direction is an artboard, so a person can mark it up and compare it at full size; picking one is the
// shell's job (the direction bar in the inspector, `client/v2/ds/direction-bar.jsx`) — the canvas is untrusted
// and carries no write. Every child ignores the pointer, so a click on the tile selects the tile
// (`data-ds-direction`), not a swatch inside it.
//
// Until the AI has drafted it the artboard says so quietly (an outline, like a section that waits).

import type { CSSProperties } from 'react';
import { useBoardMode, useBoardModel } from './state.ts';
import { type BoardDirection, type BoardMode, type BoardModel, themeFor } from './types.ts';
import './directions.css';

/** The words (CONTRACT §3 voice). */
export const DIRECTION_WORDS = Object.freeze({
  waiting: (id: string) => `Direction ${id.toUpperCase()} — next`,
  picked: 'Picked',
});

export const directionName = (d: BoardDirection): string =>
  `Direction ${d.direction.toUpperCase()} · ${d.label}`;

/** The tile's own tokens for one mode, as inline custom properties (scoped to the tile). */
export function tileStyle(d: BoardDirection, theme: string): CSSProperties {
  const row = d.vars[theme] ?? Object.values(d.vars)[0] ?? {};
  return { ...row } as CSSProperties;
}

export function DirTile({
  direction,
  theme,
}: {
  direction: BoardDirection;
  /** the system's own theme name the Light | Dark switch shows */
  theme: string;
}) {
  return (
    <div
      className="ds-dir"
      data-ds-direction={direction.direction}
      data-picked={direction.picked ? 'true' : undefined}
      style={tileStyle(direction, theme)}
    >
      <span className="ds-dir-strip" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <strong className="ds-dir-h">{direction.label}</strong>
      <span className="ds-dir-p">
        The headline face, the body face and the colours they sit in.
      </span>
      <span className="ds-dir-row">
        <span className="ds-dir-btn">Primary</span>
        <span className="ds-dir-btn ds-dir-btn--line">Secondary</span>
      </span>
      <span className="ds-dir-pic" aria-hidden="true">
        <i />
        <b />
      </span>
      <span className="ds-dir-cards" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="ds-dir-meta">
        {direction.mood ? <b>{direction.mood}</b> : null}
        {direction.picked ? <em>{DIRECTION_WORDS.picked}</em> : null}
      </span>
    </div>
  );
}

export function DSDirection({
  id,
  model,
  mode,
}: {
  id: string;
  model?: BoardModel;
  mode?: BoardMode;
}) {
  const registered = useBoardModel();
  const stored = useBoardMode();
  const m = model ?? registered;
  const d = m?.directions?.find((x) => x.direction === id) ?? null;
  if (!m || !d) {
    return (
      <div className="ds-dir-wait" data-ds-direction-wait={id}>
        <span>{DIRECTION_WORDS.waiting(id)}</span>
      </div>
    );
  }
  return <DirTile direction={d} theme={themeFor(m, mode ?? stored)} />;
}
