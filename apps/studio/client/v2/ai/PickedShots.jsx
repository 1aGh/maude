// client/v2/ai/PickedShots.jsx — P8 r11 (03 `ai-long-pinned`, `.ai-six`): the shots a reply picked, six small
// thumbnails under its words. The files come from the reply's own tool calls (picked-shots.js), never from its text.

import { pickedShots } from './picked-shots.js';

/** @param {{ parts: Array<object>, designRel?: string, onOpen?: (src: string) => void }} p */
export function PickedShots({ parts, designRel = '.design', onOpen }) {
  const shots = pickedShots(parts, designRel);
  if (!shots.length) return null;
  return (
    <span className="ai-six" data-testid="ai-six">
      {shots.map((s) => (
        <button
          key={s.src}
          type="button"
          className="ai-six-btn"
          aria-label={`Open ${s.name}`}
          title={s.name}
          onClick={() => onOpen?.(s.src)}
        >
          <img
            className="ai-six-th"
            src={s.src}
            alt=""
            loading="lazy"
            draggable="false"
            data-testid="ai-six-th"
          />
        </button>
      ))}
    </span>
  );
}
