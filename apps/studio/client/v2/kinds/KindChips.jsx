// client/v2/kinds/KindChips.jsx — S7.24: the kind filter chips (08 · KindChips, shared by Canvases and Layers).
//
//   All 93 · [fixed size] 61 · [web page] 9 · [print] 8 · [video] 12
//
// A row of five toggles. The chip that is on shows its word ("Video 12"); the others are a glyph and a count,
// so five of them fit in the 300 px panel. Each chip's accessible name is "Print, 2" (the word and the count).
// A chip with nothing behind it (count 0) stays pressable — a filter that hides everything says which one it is
// and undoes in one click (the Empty block) — but is quieter. Pressing the chip that is on clears the filter.
// It owns no state: `on` and `onPick(kind)` come from the caller (the shared store, kind-filter-store.js).

import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from '../canvases/canvas-icons.jsx';
import { chipName, KIND_CHIPS, KIND_WORD } from './kind-filter-model.js';

const ICON = { digital: DigitalIcon, web: WebIcon, print: PrintIcon, video: VideoIcon };

export function KindChips({
  counts,
  on = 'all',
  onPick,
  label = 'Filter by kind',
  testid = 'kind-chips',
  chipPrefix = 'kind-chip', // Layers passes its own, so two panels never share a testid
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar-style row of toggle buttons, not a form group
    <div className="kf-chips" role="group" aria-label={label} data-testid={testid} data-on={on}>
      {KIND_CHIPS.map((k) => {
        const n = counts?.[k] ?? 0;
        const Icon = ICON[k];
        const active = on === k;
        const word = KIND_WORD[k];
        return (
          <button
            key={k}
            type="button"
            className="kf-chip"
            data-testid={`${chipPrefix}-${k}`}
            data-on={active ? 'true' : undefined}
            data-zero={n === 0 ? 'true' : undefined}
            aria-pressed={active}
            aria-label={chipName(k, n)}
            title={active && k !== 'all' ? `${word} · ${n} — press to clear` : `${word} · ${n}`}
            onClick={() => onPick?.(k)}
          >
            {Icon ? <Icon size={12} /> : null}
            {k === 'all' || active ? <span className="kf-chip-w">{word}</span> : null}
            <span className="kf-chip-n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
