// client/v2/import/frame-picker.jsx — S8.17: "Pick frames" (canvas 12 · ia-figma-sheets, step 3).
//
// One tile per frame on the linked page: a check, the frame's label and its Figma size. The label is the
// server's `attrValue` form of a third-party string (DDR-216 D6) and React renders it as text. There is no
// thumbnail from Figma: a picture of the frame would be a hotlink to Figma's CDN (or a second download per
// frame before the person picked anything) — the size box stands in, drawn at the frame's own proportions.

/** @param {{ frames: Array<{id:string,name:string,width:number,height:number}>, picked: Set<string>, onToggle: (id:string) => void, onAll: (on:boolean) => void, disabled?: boolean }} props */
export default function FramePicker({ frames, picked, onToggle, onAll, disabled = false }) {
  const all = frames.length > 0 && frames.every((f) => picked.has(f.id));
  return (
    <div className="fi-pick" data-testid="figma-import-mode-frames">
      <div className="fi-pick-hd">
        <span>
          {picked.size} of {frames.length} {frames.length === 1 ? 'frame' : 'frames'}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={disabled || frames.length === 0}
          onClick={() => onAll(!all)}
          data-testid="figma-frames-all"
        >
          {all ? 'Pick none' : 'Pick all'}
        </button>
      </div>
      <ul className="fi-frames" aria-label="Frames">
        {frames.map((f) => {
          const on = picked.has(f.id);
          const ratio = Math.max(0.25, Math.min(4, f.width / Math.max(1, f.height)));
          return (
            <li key={f.id}>
              <label className="fi-frame" data-on={on ? 'true' : undefined}>
                <span className="fi-frame-th" aria-hidden="true">
                  <span className="fi-frame-box" style={{ '--fi-ratio': String(ratio) }} />
                </span>
                <span className="fi-frame-n">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={() => onToggle(f.id)}
                    data-testid={`figma-frame-${f.id.replace(/[^0-9a-z]+/gi, '-')}`}
                  />
                  <span className="fi-frame-t">{f.name}</span>
                </span>
                <span className="fi-frame-sz">
                  {f.width} × {f.height}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
