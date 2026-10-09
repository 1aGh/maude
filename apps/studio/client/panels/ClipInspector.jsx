// ClipInspector — feature-enhanced-video-editing (Task 9). The per-clip
// parametric editing popover, scoped to the timeline selection: tabs
// Speed · Audio · Crop · Grade (media clips) and Transition (seam chips).
// Draggable, Esc closes, one instance (owned by TimelinePanel). Values come
// from the enumerator's authoritative `mediaProps`; every commit goes through
// `onVerb(verb, params)` → POST /_api/clip-edit (stableId + contentHash).

import { useCallback, useEffect, useRef, useState } from 'react';

import { NumberField, SliderField, Toggle } from '../inspector-controls.jsx';

const SPEED_PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];
const PRESENTATIONS = ['fade', 'slide', 'wipe', 'flip', 'clock-wipe', 'none'];
// Named grade "looks" — parameter bundles, still ONE flat filter string on disk.
const GRADE_PRESETS = {
  None: null,
  Mono: { saturation: 0, contrast: 1.05 },
  Warm: { hue: -12, saturation: 1.15, brightness: 1.03 },
  Cool: { hue: 12, saturation: 1.05, brightness: 0.98 },
  Punch: { contrast: 1.18, saturation: 1.25 },
};

/** Parse a CSS filter chain back to grade params (mirror of the server's
 *  filterToGrade). Null = unrecognized function → read-only badge. */
export function filterToGradeParams(filter) {
  if (!filter) return {};
  const out = {};
  let rest = String(filter).trim();
  const fnRe = /^([a-z-]+)\(([^)]*)\)\s*/;
  const keys = {
    brightness: 'brightness',
    contrast: 'contrast',
    saturate: 'saturation',
    'hue-rotate': 'hue',
    sepia: 'sepia',
    grayscale: 'grayscale',
    invert: 'invert',
  };
  while (rest.length) {
    const m = rest.match(fnRe);
    if (!m || !keys[m[1]]) return null;
    const v = Number.parseFloat(m[2]);
    if (!Number.isFinite(v)) return null;
    out[keys[m[1]]] = v;
    rest = rest.slice(m[0].length);
  }
  return out;
}

function TabBar({ tabs, active, onPick }) {
  return (
    <div className="tlci-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={active === t}
          className={`tlci-tab${active === t ? ' is-on' : ''}`}
          data-testid={`timeline-inspector-tab-${t.toLowerCase()}`}
          onClick={() => onPick(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export default function ClipInspector({
  mode = 'clip', // 'clip' | 'transition'
  clipLabel = '',
  mediaProps = null,
  kind = 'video', // rowKind of the clip
  transition = null, // { dur } when mode === 'transition'
  // Non-null = the clip carries editable text (Title literal / AI prompt).
  textValue = null,
  x = 200,
  y = 200,
  onVerb, // (verb, params) => void
  onClose,
}) {
  const tabs =
    mode === 'transition'
      ? ['Transition']
      : textValue != null && kind !== 'video' && kind !== 'audio'
        ? ['Text', 'Speed']
        : kind === 'audio'
          ? ['Speed', 'Audio']
          : textValue != null
            ? ['Speed', 'Audio', 'Crop', 'Grade', 'Text']
            : ['Speed', 'Audio', 'Crop', 'Grade'];
  const [tab, setTab] = useState(tabs[0]);
  const [pos, setPos] = useState({ x, y });
  const rootRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const beginDrag = useCallback(
    (e) => {
      if (e.target.closest('button, input, select')) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      const move = (ev) =>
        setPos({ x: start.px + ev.clientX - start.x, y: start.py + ev.clientY - start.y });
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [pos]
  );

  // Local knob state seeded from the authoritative props; commit on release.
  const rate = mediaProps?.playbackRate ?? 1;
  const volume = mediaProps?.muted ? 0 : (mediaProps?.volume ?? 1);
  const framing = mediaProps?.framing ?? null;
  const gradeParams = filterToGradeParams(mediaProps?.filter);
  const gradeReadOnly = gradeParams == null;
  const [grade, setGrade] = useState(gradeParams ?? {});
  const [frame, setFrame] = useState(framing ?? { scale: 1, x: 0, y: 0 });
  const [transDur, setTransDur] = useState(transition?.dur ?? 15);
  useEffect(() => {
    setGrade(filterToGradeParams(mediaProps?.filter) ?? {});
    setFrame(mediaProps?.framing ?? { scale: 1, x: 0, y: 0 });
  }, [mediaProps]);
  useEffect(() => {
    setTransDur(transition?.dur ?? 15);
  }, [transition]);

  const commitGrade = (next) => {
    setGrade(next);
    const meaningful = Object.entries(next).some(([k, v]) =>
      k === 'brightness' || k === 'contrast' || k === 'saturation' ? v !== 1 : v !== 0
    );
    onVerb?.('grade', { grade: meaningful ? next : null });
  };
  const commitFrame = (next) => {
    setFrame(next);
    onVerb?.('framing', {
      framing: next.scale === 1 && next.x === 0 && next.y === 0 ? null : next,
    });
  };

  const gradeSlider = (label, key, min, max, step, neutral) => (
    <label className="tlci-row" key={key}>
      <span className="tlci-lbl">{label}</span>
      <SliderField
        value={grade[key] ?? neutral}
        min={min}
        max={max}
        step={step}
        onCommit={(v) => commitGrade({ ...grade, [key]: v })}
        ariaLabel={label}
      />
    </label>
  );

  return (
    <div
      ref={rootRef}
      className="tlci"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={`Adjust ${clipLabel || 'clip'}`}
      data-testid="timeline-inspector"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="tlci-head" onPointerDown={beginDrag}>
        <span className="tlci-title">
          {clipLabel || (mode === 'transition' ? 'Transition' : 'Clip')}
        </span>
        <button type="button" className="tlci-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <TabBar tabs={tabs} active={tab} onPick={setTab} />

      {tab === 'Speed' && (
        <div className="tlci-body" role="tabpanel">
          <div className="tlci-presets">
            {SPEED_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={`tlci-chip${rate === p ? ' is-on' : ''}`}
                data-testid={`timeline-speed-${String(p).replace('.', '_')}`}
                onClick={() => onVerb?.('speed', { rate: p })}
              >
                {p}×
              </button>
            ))}
          </div>
          <label className="tlci-row">
            <span className="tlci-lbl">Custom</span>
            <NumberField
              value={rate}
              min={0.1}
              max={16}
              step={0.05}
              onCommit={(v) => onVerb?.('speed', { rate: v })}
              ariaLabel="Playback rate"
            />
          </label>
          <p className="tlci-note">Duration recomputes; the cut ripples to stay gapless.</p>
        </div>
      )}

      {tab === 'Audio' && (
        <div className="tlci-body" role="tabpanel">
          <label className="tlci-row">
            <span className="tlci-lbl">Muted</span>
            <Toggle
              checked={!!mediaProps?.muted}
              onChange={(v) => onVerb?.('audio', { muted: v })}
              ariaLabel="Mute clip"
            />
          </label>
          <label className="tlci-row">
            <span className="tlci-lbl">Volume</span>
            <SliderField
              value={volume}
              min={0}
              max={1}
              step={0.05}
              onCommit={(v) => onVerb?.('audio', { volume: v })}
              ariaLabel="Clip volume"
            />
          </label>
          {kind === 'video' ? (
            <button
              type="button"
              className="tlci-btn"
              data-testid="timeline-detach-audio"
              onClick={() => onVerb?.('detach-audio', {})}
            >
              Detach audio
            </button>
          ) : null}
        </div>
      )}

      {tab === 'Crop' && (
        <div className="tlci-body" role="tabpanel">
          <label className="tlci-row">
            <span className="tlci-lbl">Scale</span>
            <NumberField
              value={frame.scale}
              min={1}
              max={8}
              step={0.05}
              onCommit={(v) => commitFrame({ ...frame, scale: v })}
              ariaLabel="Crop scale"
            />
          </label>
          <label className="tlci-row">
            <span className="tlci-lbl">X %</span>
            <NumberField
              value={frame.x}
              min={-100}
              max={100}
              step={1}
              onCommit={(v) => commitFrame({ ...frame, x: v })}
              ariaLabel="Crop x offset"
            />
          </label>
          <label className="tlci-row">
            <span className="tlci-lbl">Y %</span>
            <NumberField
              value={frame.y}
              min={-100}
              max={100}
              step={1}
              onCommit={(v) => commitFrame({ ...frame, y: v })}
              ariaLabel="Crop y offset"
            />
          </label>
          <div className="tlci-presets">
            <button
              type="button"
              className="tlci-chip"
              onClick={() => commitFrame({ scale: 1, x: 0, y: 0 })}
            >
              Reset
            </button>
            <button
              type="button"
              className="tlci-chip"
              onClick={() => commitFrame({ ...frame, scale: 1.2 })}
            >
              1.2×
            </button>
            <button
              type="button"
              className="tlci-chip"
              onClick={() => commitFrame({ ...frame, scale: 1.5 })}
            >
              1.5×
            </button>
          </div>
        </div>
      )}

      {tab === 'Grade' && (
        <div className="tlci-body" role="tabpanel">
          {gradeReadOnly ? (
            <p className="tlci-note" data-testid="timeline-grade-readonly">
              This clip carries a hand-written filter — edit it in code.
            </p>
          ) : (
            <>
              <div className="tlci-presets">
                {Object.entries(GRADE_PRESETS).map(([name, params]) => (
                  <button
                    key={name}
                    type="button"
                    className="tlci-chip"
                    data-testid={`timeline-grade-${name.toLowerCase()}`}
                    onClick={() => commitGrade(params ? { ...params } : {})}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {gradeSlider('Brightness', 'brightness', 0.2, 2, 0.01, 1)}
              {gradeSlider('Contrast', 'contrast', 0.2, 2, 0.01, 1)}
              {gradeSlider('Saturation', 'saturation', 0, 2, 0.01, 1)}
              {gradeSlider('Hue', 'hue', -180, 180, 1, 0)}
              {gradeSlider('Sepia', 'sepia', 0, 1, 0.01, 0)}
              {gradeSlider('Grayscale', 'grayscale', 0, 1, 0.01, 0)}
              <p className="tlci-note">
                Preview applies on the paused frame (WKWebView filter ceiling); exports are exact.
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'Text' && (
        <div className="tlci-body" role="tabpanel">
          <textarea
            className="tlci-textarea"
            data-testid="timeline-inspector-text"
            defaultValue={textValue || ''}
            rows={4}
            placeholder={kind === 'placeholder' ? 'Generation prompt…' : 'Title text…'}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            className="tlci-btn"
            data-testid="timeline-inspector-text-apply"
            onClick={(e) => {
              const v = e.currentTarget.closest('.tlci-body')?.querySelector('textarea')?.value;
              if (v && v.trim()) onVerb?.('set-text', { text: v });
            }}
          >
            Apply text
          </button>
          <p className="tlci-note">
            {kind === 'placeholder'
              ? 'Updates the generation prompt on the slate.'
              : 'Rewrites the title text in the composition.'}
          </p>
        </div>
      )}

      {tab === 'Transition' && (
        <div className="tlci-body" role="tabpanel">
          <div className="tlci-presets" data-testid="timeline-transition-grid">
            {PRESENTATIONS.map((p) => (
              <button
                key={p}
                type="button"
                className="tlci-chip"
                data-testid={`timeline-transition-${p}`}
                onClick={() => onVerb?.('transition', { presentation: p })}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="tlci-row">
            <span className="tlci-lbl">Frames</span>
            <NumberField
              value={transDur}
              min={1}
              max={120}
              step={1}
              onCommit={(v) => {
                setTransDur(v);
                onVerb?.('transition', { durationInFrames: v });
              }}
              ariaLabel="Transition duration"
            />
          </label>
          <button
            type="button"
            className="tlci-btn"
            data-testid="timeline-transition-remove"
            onClick={() => {
              onVerb?.('remove-transition', {});
              onClose?.();
            }}
          >
            Remove transition (hard cut)
          </button>
        </div>
      )}
    </div>
  );
}
