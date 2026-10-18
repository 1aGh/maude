// client/v2/empty/empty.jsx — S11.1: the empty block — what's missing · why it's fine · ONE next step.
//
// Lifted from the DS specimen `.design/system/maude-v2/preview/empty-state.tsx` (anatomy) and 05 Empty States'
// `Empty`: optional spot art (or one 18 px glyph), the situation in the rounded face, the next step in the
// body face, chips, at most one action, an optional fine foot line. The words come from `empty-copy.js`
// (pass `copyId` + `vars`) or are given directly. A copy id in NO_DOOR (Version history before the first
// change, an empty Trash, "Shared with you") never renders a button, whatever the caller passes.

import { Kbd } from '../../shell/icons.jsx';
import { copy, NO_DOOR } from './empty-copy.js';
import { Spot } from './spot.jsx';
import { Suggestions } from './suggestions.jsx';

/* The family's 16-unit glyphs, 1.5 rounded stroke — the few an empty state uses (lifted from the specimen). */
const GLYPHS = {
  comment: (
    <path d="M5 2.5h6A2.5 2.5 0 0 1 13.5 5v8.5H5A2.5 2.5 0 0 1 2.5 11V5A2.5 2.5 0 0 1 5 2.5z" />
  ),
  history: <path d="M2.75 8A5.25 5.25 0 1 0 4.3 4.3M4.3 1.8v2.5h2.5M8 5.25V8l2 1.5" />,
  file: <path d="M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3" />,
  layers: <path d="M8 2.5l5.5 3L8 8.5 2.5 5.5zM2.5 8.5 8 11.5l5.5-3M2.5 11 8 14l5.5-3" />,
  export: (
    <>
      <path d="M8 9.5v-7M5.25 5.25 8 2.5l2.75 2.75" />
      <path d="M3 9.5v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3" />
    </>
  ),
  trash: (
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a1 1 0 0 0 1 .8h3.8a1 1 0 0 0 1-.8l.6-8.2M7 7v4M9 7v4" />
  ),
  offline: (
    <path d="M4.5 12.5a3 3 0 0 1-.4-5.97 4 4 0 0 1 7.6-.9 3.2 3.2 0 0 1-.2 6.87zM2.5 2.5l11 11" />
  ),
  people: (
    <>
      <circle cx="6" cy="5.5" r="2" />
      <path d="M2.5 13c0-2 1.6-3.5 3.5-3.5S9.5 11 9.5 13" />
      <circle cx="11" cy="6" r="1.6" />
      <path d="M11 9.3c1.6 0 2.8 1.2 2.8 3" />
    </>
  ),
  print: (
    <>
      <path d="M4.5 6V2.5h7V6M4.5 11.5h-1a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1h-1" />
      <path d="M4.5 9.5h7v4h-7z" />
    </>
  ),
  spark: <path d="M8 1.5l1.4 3.7 3.7 1.4-3.7 1.4L8 11.7 6.6 8 2.9 6.6l3.7-1.4L8 1.5z" />,
};

/** One 18 px glyph on a quiet tile. `spark` (the AI is the next step) takes the spark tint. */
export function Glyph({ name, size = 18 }) {
  const path = GLYPHS[name];
  if (!path) return null;
  const spark = name === 'spark';
  return (
    <span className={`es-glyph${spark ? ' es-glyph--spark' : ''}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill={spark ? 'currentColor' : 'none'}
        stroke={spark ? 'none' : 'currentColor'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {path}
      </svg>
    </span>
  );
}

/** Copy text → nodes: `[[C]]` is a key cap, a “quoted word” stays on one line. */
export function rich(text) {
  if (typeof text !== 'string') return text;
  let at = 0; // a part's offset in the text is its key: stable, and unique within the line
  return text.split(/(\[\[[^\]]+\]\]|“[^”]*”)/).map((part) => {
    const key = at;
    at += part.length;
    if (part.startsWith('[[')) return <Kbd key={key}>{part.slice(2, -2)}</Kbd>;
    if (part.startsWith('“')) {
      return (
        <span key={key} className="es-q">
          {part}
        </span>
      );
    }
    return part;
  });
}

/**
 * @param {{
 *   size?: 'panel'|'canvas',
 *   spot?: 'canvas'|'ai'|'none'|'comment'|'image'|'done'|'offline'|'trash',
 *   spotW?: number, quiet?: boolean, land?: boolean,
 *   glyph?: string,
 *   title?: import('react').ReactNode, next?: import('react').ReactNode,
 *   chips?: import('react').ReactNode | string[], onPickChip?: (text: string) => void,
 *   actions?: import('react').ReactNode, foot?: import('react').ReactNode,
 *   align?: 'center'|'left',
 *   copyId?: string, vars?: Record<string, string|number>,
 *   className?: string, testid?: string, children?: import('react').ReactNode
 * }} props
 */
export function Empty({
  size = 'panel',
  spot,
  spotW,
  quiet = false,
  land = false,
  glyph,
  title,
  next,
  chips,
  onPickChip,
  actions,
  foot,
  align = 'center',
  copyId,
  vars,
  className = '',
  testid,
  children,
}) {
  const words = copyId ? copy(copyId, vars) : null;
  const sit = title ?? words?.title;
  const step = next ?? children ?? words?.next;
  const chipList = chips ?? words?.chips;
  const fine = foot ?? words?.fine ?? words?.foot;
  const door = copyId && NO_DOOR.has(copyId) ? null : actions;
  const spotWidth = spotW ?? (size === 'canvas' ? 240 : 176);
  const cls = ['es-e', `es-e--${size}`, `es-e--${align}`, quiet ? 'es-e--quiet' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={cls}
      data-copy={copyId}
      data-testid={testid ?? (copyId ? `empty-${copyId}` : undefined)}
    >
      {spot ? <Spot name={spot} w={spotWidth} quiet={quiet} land={land} /> : null}
      {!spot && glyph ? <Glyph name={glyph} /> : null}
      <p className="es-sit">{rich(sit)}</p>
      {step ? <p className="es-next">{rich(step)}</p> : null}
      {chipList ? (
        <div className="es-chips">
          {Array.isArray(chipList) ? (
            <Suggestions items={chipList} onPick={onPickChip} />
          ) : (
            chipList
          )}
        </div>
      ) : null}
      {door ? <div className="es-acts">{door}</div> : null}
      {fine ? <p className="es-fine">{rich(fine)}</p> : null}
    </div>
  );
}
