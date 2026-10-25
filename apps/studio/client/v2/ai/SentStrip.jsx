// client/v2/ai/SentStrip.jsx — P8 c10 (03 `ai-long`, `YouWith` / `Sent`): what an ask was sent with, above its bubble.
// A photo is a 56 px thumbnail; footage, a PDF and a folder are small read-only cards (name + what it is, no ×).
// Same chips live and after a reload (sent-attachments.js).

import { FileGlyph, FolderGlyph, ImageGlyph, Play } from './AChip.jsx';

function SentCard({ chip }) {
  return (
    <span
      className="ai-ach ai-ach--sent"
      data-testid="ai-sent-card"
      data-kind={chip.kind}
      title={chip.name}
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
        <span className="ai-att-m">{chip.meta}</span>
      </span>
    </span>
  );
}

/** @param {{ chips: Array<{kind:string,name:string,meta:string,src?:string}>, onOpen?: (src:string)=>void }} p */
export function SentStrip({ chips, onOpen }) {
  if (!chips?.length) return null;
  return (
    <span className="ai-sent" data-testid="ai-sent">
      {chips.map((c, i) =>
        c.kind === 'image' && c.src ? (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: a sent chip has no id; the list never reorders
            key={i}
            type="button"
            className="ai-sent-btn"
            aria-label={`Open ${c.name}`}
            onClick={() => onOpen?.(c.src)}
          >
            <img
              className="ai-sent-img"
              src={c.src}
              alt=""
              loading="lazy"
              data-testid="ai-sent-img"
            />
          </button>
        ) : c.kind === 'image' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <span key={i} className="ai-sent-img ai-sent-img--blank" title={c.name}>
            <ImageGlyph />
          </span>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: as above
          <SentCard key={i} chip={c} />
        )
      )}
    </span>
  );
}
