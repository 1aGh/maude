// client/v2/canvases/jump-list.jsx — S1.3: a canvas row opens into its artboards (11 · pn-jump).
//
// Three small pieces the Canvases panel draws between canvas rows:
//   JumpToggle    the disclosure twisty on a canvas row (`canvas-jump-toggle-<slug>`)
//   JumpBoardRow  one artboard — its kind glyph, its name (marked while searching), the one in view highlighted;
//                 a click jumps there (`jump-artboard-<slug>-<artboardId>`)
//   JumpNoteRow   what a dynamic canvas admits: its artboards are made when it runs

import { StIcon } from '../../shell/icons.jsx';
import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from './canvas-icons.jsx';
import { KIND_LABEL } from './jump-model.js';
import { splitMarks } from './panel-search.js';

const KIND_GLYPH = { web: WebIcon, digital: DigitalIcon, print: PrintIcon, video: VideoIcon };

/** `text` with its marked runs wrapped in <mark> (the same mark the search rows use everywhere). */
export function Marked({ text, marks }) {
  if (!marks?.length) return text;
  return splitMarks(text, marks).map((p, i) =>
    p.m ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one string, never reordered
      <mark key={i} className="cv-mark">
        {p.t}
      </mark>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: runs of one string, never reordered
      <span key={i}>{p.t}</span>
    )
  );
}

export function JumpToggle({ open, slug, name, onToggle, left }) {
  return (
    <button
      type="button"
      className="cv-jt"
      data-testid={`canvas-jump-toggle-${slug}`}
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} the artboards in ${name}`}
      title={`${open ? 'Hide' : 'Show'} artboards`}
      tabIndex={-1}
      style={{ left }}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <StIcon name="chevron-right" className={`cv-chev${open ? ' is-open' : ''}`} size={12} />
    </button>
  );
}

export function JumpBoardRow({ row, index, style, tabStop, slug, padStyle, onJump }) {
  const Glyph = KIND_GLYPH[row.kind] || WebIcon;
  const word = KIND_LABEL[row.kind] || row.kind;
  return (
    <div
      className="cv-item"
      role="treeitem"
      aria-level={row.level}
      aria-posinset={row.posinset}
      aria-setsize={row.setsize}
      aria-selected={row.current}
      aria-label={row.name}
      data-index={index}
      tabIndex={tabStop ? 0 : -1}
      style={style}
    >
      <div className={`cv-row cv-row--board${row.current ? ' is-sel' : ''}`}>
        <button
          type="button"
          className="cv-main"
          data-tree-primary=""
          data-testid={`jump-artboard-${slug}-${row.artboardId}`}
          data-kind={row.kind}
          aria-current={row.current ? 'true' : undefined}
          tabIndex={-1}
          style={padStyle}
          title={`${row.name} — ${word}`}
          onClick={() => onJump(row)}
        >
          <span className="cv-bk" role="img" aria-label={word}>
            <Glyph size={12} />
          </span>
          <span className="cv-name">
            <Marked text={row.name} marks={row.nameMarks} />
          </span>
        </button>
      </div>
    </div>
  );
}

export function JumpNoteRow({ row, style, slug, padStyle }) {
  return (
    <div className="cv-note" style={{ ...style, ...padStyle }} data-testid={`jump-dynamic-${slug}`}>
      {row.text}
    </div>
  );
}
