// client/v2/ai/AChip.jsx — S5.10: one attachment inside the prompt (03 AI Chat `AChip`). A photo is a
// thumbnail with its name on hover; footage, a PDF, a file and a folder say name + what. Every chip
// has its ×. A folder still waiting on consent (or after Not now) is marked: it won't be sent.

import { chipMeta } from './attach.js';

const g = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

/** Paperclip — the family's hand (16 grid, 1.5 round stroke), as drawn on the 03 canvas. */
export const Clip = ({ size = 16 }) => (
  <svg {...g} width={size} height={size}>
    <path d="M11 5.25L6.6 9.65a1.2 1.2 0 0 0 1.7 1.7l4.4-4.4a2.6 2.6 0 0 0-3.68-3.68L4.6 7.7a4 4 0 0 0 5.66 5.66l3.24-3.26" />
  </svg>
);
export const FileGlyph = () => (
  <svg {...g}>
    <path d="M9 2.5H4.75a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h6.5a1 1 0 0 0 1-1V5.75L9 2.5Z" />
    <path d="M9 2.5v3.25h3.25" />
  </svg>
);
export const FolderGlyph = () => (
  <svg {...g}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-7.5Z" />
  </svg>
);
export const ImageGlyph = () => (
  <svg {...g}>
    <rect x="2.5" y="3" width="11" height="10" rx="1" />
    <path d="M2.5 11l3-3 2.5 2.5L10 8.5l3.5 3.5" />
  </svg>
);
const Play = () => (
  <svg {...g} width={8} height={8}>
    <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" />
  </svg>
);
const Close = ({ size = 10 }) => (
  <svg {...g} width={size} height={size}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export function AChip({ chip, onRemove, index = 0 }) {
  const meta =
    chip.state === 'uploading'
      ? 'Attaching…'
      : chip.state === 'error'
        ? chip.error || 'Didn’t attach'
        : chip.state === 'wait'
          ? `${chipMeta(chip)} · not sent`
          : chipMeta(chip);
  const x = (
    <button
      type="button"
      className={chip.kind === 'image' ? 'ai-ach-x' : 'ai-att-x'}
      aria-label={`Remove ${chip.name}`}
      onClick={() => onRemove?.(chip.id)}
      data-testid={`ai-attach-chip-x-${index}`}
    >
      <Close size={chip.kind === 'image' ? 9 : 10} />
    </button>
  );
  const common = {
    role: 'listitem',
    'data-testid': `ai-attach-chip-${index}`,
    'data-state': chip.state,
    'data-kind': chip.kind,
  };
  if (chip.kind === 'image' && chip.state !== 'error') {
    return (
      <span
        {...common}
        className={`ai-ach ai-ach--img${chip.state === 'uploading' ? ' ai-ach--busy' : ''}`}
        title={chip.name}
      >
        {chip.thumb ? (
          <img className="ai-ach-thumb" src={chip.thumb} alt={chip.name} />
        ) : (
          <span className="ai-ach-thumb ai-ach-thumb--blank">
            <ImageGlyph />
          </span>
        )}
        {x}
      </span>
    );
  }
  return (
    <span
      {...common}
      className={`ai-ach${chip.state === 'wait' ? ' ai-ach--wait' : ''}${chip.state === 'error' ? ' ai-ach--error' : ''}`}
      title={chip.kind === 'folder' && chip.outsideProject && chip.root ? chip.root : chip.name}
    >
      {chip.kind === 'video' ? (
        <span className="ai-ach-pic">
          <span className="ai-ach-vthumb" />
          <span className="ai-ach-play">
            <Play />
          </span>
        </span>
      ) : (
        <span className="ai-ach-ic">
          {chip.kind === 'folder' ? <FolderGlyph /> : <FileGlyph />}
        </span>
      )}
      <span className="ai-att-txt">
        <span className="ai-att-n">{chip.name}</span>
        <span className="ai-att-m">{meta}</span>
      </span>
      {x}
    </span>
  );
}

/** The chips row inside the prompt, plus the one line that says what won't be sent. */
export function AttachChips({ attach }) {
  if (!attach || (!attach.chips.length && !attach.notice)) return null;
  const waiting = attach.chips.filter((c) => c.state === 'wait');
  return (
    <div className="ai-ask-chips-wrap">
      {attach.chips.length ? (
        <div
          className="ai-ask-chips"
          role="list"
          aria-label="Attachments"
          data-testid="ai-attach-chips"
        >
          {attach.chips.map((c, i) => (
            <AChip key={c.id} chip={c} index={i} onRemove={attach.remove} />
          ))}
        </div>
      ) : null}
      {waiting.length && !attach.consent ? (
        <p className="ai-att-note" data-testid="ai-attach-held">
          {waiting.length === 1
            ? `“${waiting[0].name}” isn’t sent`
            : `${waiting.length} folders aren’t sent`}{' '}
          — AI may not read it yet. Remove it, or choose it again to allow.
        </p>
      ) : null}
      {attach.notice ? (
        <p className="ai-att-note ai-att-note--warn" role="status" data-testid="ai-attach-notice">
          {attach.notice}
        </p>
      ) : null}
    </div>
  );
}
