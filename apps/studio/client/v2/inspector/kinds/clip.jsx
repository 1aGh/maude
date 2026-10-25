// client/v2/inspector/kinds/clip.jsx — S7.10: the inspector of a clip you select on the Timeline (07 · ve-transition,
// ve-select; the `ClipInspector` of that canvas) and of a title (07 · ve-text).
//
//   Clip   Length · Speed · Volume · Framing        › Advanced: src · in · out, then Grade · Crop · Transition
//   Title  Text · Font · Colour · Motion · Length   › Advanced: enter · easing, Speed
//
// This is the home of every control the v1 `ClipInspector` dialog had (D15): its Speed, Audio, Crop, Grade, Text
// and Transition tabs are rows here or under Advanced — nothing was deleted, the dialog file went. Every write is
// the clip's own verb through the Timeline's ONE pipe (`selection.onVerb` → `/_api/edit-op` `clip.<verb>`, so the
// undo, the toast and the refusal are the same as a gesture's), the video.* ops through `selection.onOp`.
//
// The selection is not a canvas element: the Timeline publishes it (../../timeline/selection.js), the panel turns
// it into `{ tag, text, timeline }` and the two kinds below claim it.

import { NumberField, Select, SliderField, Toggle } from '../../../inspector-controls.jsx';
import { TITLE_MOTION_FRAMES } from '../../../../video/title-motion.ts';
import { AdvancedFold } from '../../fold/advanced-fold.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { FootageRows, footageAdvanced, useClipFootage } from '../../timeline/footage-rows.jsx';
import { otherTakesUi } from '../../timeline/other-takes.jsx';
import { reframeUi } from '../../timeline/reframe-island.jsx';
import { registerKind, singleOf } from './index.js';
import { registerSlot } from '../slots.js';
import {
  FRAMING_OPTIONS,
  GRADE_PRESETS,
  NO_CROP,
  cropIsNeutral,
  filterToGradeParams,
  framingValue,
  gradeMeaningful,
  hasSound,
  lengthWords,
  parseLengthFrames,
  speedOptions,
  srcInOut,
  volumeOf,
} from './clip-model.js';
import { MotionGrid, StyleRows, TextRows } from './title-rows.jsx';

const timelineOf = (selection) => singleOf(selection)?.timeline ?? null;

// ── the kinds ────────────────────────────────────────────────────────────────────────────────────────────
// ahead of every canvas kind (order 4 < multi-artboard's 5): a timeline selection is never also a canvas element
registerKind({
  id: 'clip',
  label: 'Clip',
  order: 3,
  match: (s) => timelineOf(s)?.kind === 'clip',
  // 07 ve-trim-split: Fit / Fill / Reframe, Length, Speed — not an element's Interaction or PNG/SVG Export
  sections: ['clip'],
  Advanced: ClipAdvanced,
  advancedHint: (s) => advancedHint(timelineOf(s)),
});
registerKind({
  id: 'title',
  label: 'Title',
  order: 4,
  match: (s) => timelineOf(s)?.kind === 'title',
  sections: ['title-motion'],
  Advanced: TitleAdvanced,
  advancedHint: (s) => advancedHint(timelineOf(s)),
});

function advancedHint(t) {
  if (!t) return undefined;
  if (t.kind === 'title') return '2 properties';
  const n =
    srcInOut(t.seq, t.fps).length + (hasSound(t.seq) ? 1 : 0) + 2 + (t.transitionAfter ? 1 : 0);
  return `${n} properties`;
}

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────
const visual = (seq) =>
  ['Video', 'OffthreadVideo', 'MaudeVideo', 'Img'].includes(seq?.mediaTag ?? '');
const rateOf = (seq) => (seq?.mediaProps?.playbackRate > 0 ? seq.mediaProps.playbackRate : 1);

/** Length: a fixed number trims the END (clip.retime) — the video is as long as its clips, the writer closes the gap. */
export function LengthRow({ t }) {
  const f = Math.max(1, Math.round(t.fps) || 30);
  const secs = (t.seq.duration ?? 0) / f;
  return (
    <Row k="Length" name="clip-length">
      <span data-testid="insp-clip-length">
        <NumberField
          value={Math.round(secs * 10) / 10}
          min={1 / f}
          step={0.1}
          scrub={false}
          format={(n) => lengthWords(Math.round(n * f), f)}
          parse={(raw) => {
            const frames = parseLengthFrames(raw, f);
            return frames == null ? null : frames / f;
          }}
          ariaLabel="Length in seconds"
          onCommit={(n) => {
            const frames = Math.max(1, Math.round(n * f));
            if (frames !== t.seq.duration) t.onVerb('retime', { durationInFrames: frames });
          }}
        />
      </span>
    </Row>
  );
}

export function SpeedRow({ t }) {
  const rate = rateOf(t.seq);
  return (
    <Row k="Speed" name="clip-speed">
      <Select
        value={String(rate)}
        options={speedOptions(rate)}
        ariaLabel="Speed"
        testId="insp-clip-speed"
        onChange={(v) => t.onVerb('speed', { rate: Number(v) })}
      />
    </Row>
  );
}

function VolumeRow({ t }) {
  const v = volumeOf(t.seq.mediaProps);
  return (
    <Row k="Volume" name="clip-volume">
      <span data-testid="insp-clip-volume">
        <SliderField
          value={Math.round(v * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          ariaLabel="Clip volume"
          onCommit={(n) => t.onVerb('audio', { volume: Math.round(n) / 100 })}
        />
      </span>
    </Row>
  );
}

function FramingRow({ t, ctx }) {
  return (
    <Row k="Framing" name="clip-framing">
      <Select
        value={framingValue(t.seq.fit)}
        options={FRAMING_OPTIONS}
        ariaLabel="How the picture sits"
        testId="insp-clip-framing"
        onChange={(fit) => t.onOp('fit', { fit })}
      />
      {/* S7.13 (07 · ve-reframe): where each format looks inside the picture — the Re-frame island */}
      <button
        type="button"
        className="insp-quietlink"
        data-testid="insp-clip-reframe"
        onClick={() =>
          typeof ctx?.onShellAction === 'function'
            ? ctx.onShellAction('video.reframe')
            : reframeUi.open()
        }
      >
        Re-frame…
      </button>
      {/* S7.15 (07 · ve-ai-adjust): the clip's other good moments, swapped in at the same length */}
      {['Video', 'OffthreadVideo', 'MaudeVideo'].includes(t.seq.mediaTag ?? '') &&
      t.seq.mediaSrc ? (
        <button
          type="button"
          className="insp-quietlink"
          data-testid="insp-clip-takes"
          onClick={() =>
            typeof ctx?.onShellAction === 'function'
              ? ctx.onShellAction('video.take.swap')
              : otherTakesUi.open()
          }
        >
          Other takes…
        </button>
      ) : null}
    </Row>
  );
}

function ClipRows({ el, ctx }) {
  const t = el?.timeline;
  if (!t) return null;
  const ph = t.seq.placeholder;
  return (
    <div data-testid="timeline-inspector">
      <FootageRows t={t} />
      <LengthRow t={t} />
      <SpeedRow t={t} />
      {hasSound(t.seq) ? <VolumeRow t={t} /> : null}
      {visual(t.seq) ? <FramingRow t={t} ctx={ctx} /> : null}
      {ph ? <TextRows t={t} /> : null}
    </div>
  );
}

function TitleRows({ el, ctx }) {
  const t = el?.timeline;
  if (!t) return null;
  return (
    <div data-testid="timeline-inspector">
      <StyleRows t={t} ctx={ctx} />
      <Row k="Motion" name="title-motion">
        <MotionGrid t={t} />
      </Row>
      <LengthRow t={t} />
    </div>
  );
}

// ── Advanced: clip ───────────────────────────────────────────────────────────────────────────────────────
/** `in`/`out` are the file's own seconds; Muted and Detach audio are the v1 Audio tab's other two controls. */
function ClipAdvanced({ el, ctx, open, onToggle }) {
  const t = el?.timeline;
  const footage = useClipFootage(t); // S7.16 — a clip whose file is not here also says so in Advanced
  if (!t) return null;
  const facts = [...srcInOut(t.seq, t.fps), ...footageAdvanced(t, footage)];
  return (
    <AdvancedFold panel="inspector" hint={advancedHint(t)} open={open} onToggle={onToggle}>
      <div className="insp-adv insp-adv--clip" data-testid="insp-adv-clip">
        {facts.map(([k, v]) => (
          <div className="insp-css" key={k} data-testid={`insp-adv-clip-${k}`}>
            <span className="insp-css-k k-mono">{k}</span>
            <span className="insp-css-v k-mono">{v}</span>
          </div>
        ))}
        {hasSound(t.seq) ? <AudioAdvanced t={t} /> : null}
        {visual(t.seq) ? <CropAdvanced t={t} /> : null}
        {visual(t.seq) ? <GradeAdvanced t={t} /> : null}
        <TransitionAdvanced t={t} ctx={ctx} />
      </div>
    </AdvancedFold>
  );
}

function AudioAdvanced({ t }) {
  const muted = !!t.seq.mediaProps?.muted;
  return (
    <div className="insp-adv-g" data-testid="insp-adv-audio">
      <p className="insp-adv-h insp-sub">
        <span>Audio</span>
      </p>
      <Row k="Muted" name="clip-muted">
        <Toggle
          checked={muted}
          ariaLabel="Mute clip"
          onChange={(v) => t.onVerb('audio', { muted: v })}
        />
      </Row>
      {t.seq.mediaTag === 'Video' ||
      t.seq.mediaTag === 'OffthreadVideo' ||
      t.seq.mediaTag === 'MaudeVideo' ? (
        <button
          type="button"
          className="insp-quietlink"
          data-testid="timeline-detach-audio"
          onClick={() => t.onVerb('detach-audio', {})}
        >
          Detach audio
        </button>
      ) : null}
    </div>
  );
}

function CropAdvanced({ t }) {
  const frame = t.seq.mediaProps?.framing ?? NO_CROP;
  const set = (next) => t.onVerb('framing', { framing: cropIsNeutral(next) ? null : next });
  const num = (label, key, min, max, step, name) => (
    <Row k={label} name={name} key={key}>
      <NumberField
        value={frame[key]}
        min={min}
        max={max}
        step={step}
        scrub={false}
        ariaLabel={`Crop ${key}`}
        onCommit={(v) => set({ ...frame, [key]: v })}
      />
    </Row>
  );
  return (
    <div className="insp-adv-g" data-testid="insp-adv-crop">
      <p className="insp-adv-h insp-sub">
        <span>Crop</span>
      </p>
      {num('Scale', 'scale', 1, 8, 0.05, 'clip-crop-scale')}
      {num('X %', 'x', -100, 100, 1, 'clip-crop-x')}
      {num('Y %', 'y', -100, 100, 1, 'clip-crop-y')}
      <div className="insp-chips">
        <button type="button" className="insp-chip" onClick={() => set(NO_CROP)}>
          Reset
        </button>
        {[1.2, 1.5].map((s) => (
          <button
            key={s}
            type="button"
            className="insp-chip"
            onClick={() => set({ ...frame, scale: s })}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}

function GradeAdvanced({ t }) {
  const params = filterToGradeParams(t.seq.mediaProps?.filter);
  const readOnly = params == null;
  const grade = params ?? {};
  const commit = (next) => t.onVerb('grade', { grade: gradeMeaningful(next) ? next : null });
  const slider = (label, key, min, max, step, neutral) => (
    <Row k={label} name={`clip-grade-${key}`} key={key}>
      <SliderField
        value={grade[key] ?? neutral}
        min={min}
        max={max}
        step={step}
        ariaLabel={label}
        onCommit={(v) => commit({ ...grade, [key]: v })}
      />
    </Row>
  );
  return (
    <div className="insp-adv-g" data-testid="insp-adv-grade">
      <p className="insp-adv-h insp-sub">
        <span>Grade</span>
      </p>
      {readOnly ? (
        <Quiet testid="timeline-grade-readonly">
          This clip carries a hand-written filter — edit it in code.
        </Quiet>
      ) : (
        <>
          <div className="insp-chips">
            {Object.entries(GRADE_PRESETS).map(([name, p]) => (
              <button
                key={name}
                type="button"
                className="insp-chip"
                data-testid={`timeline-grade-${name.toLowerCase()}`}
                onClick={() => commit(p ? { ...p } : {})}
              >
                {name}
              </button>
            ))}
          </div>
          {slider('Brightness', 'brightness', 0.2, 2, 0.01, 1)}
          {slider('Contrast', 'contrast', 0.2, 2, 0.01, 1)}
          {slider('Saturation', 'saturation', 0, 2, 0.01, 1)}
          {slider('Hue', 'hue', -180, 180, 1, 0)}
          {slider('Sepia', 'sepia', 0, 1, 0.01, 0)}
          {slider('Grayscale', 'grayscale', 0, 1, 0.01, 0)}
          <Quiet>
            Preview applies on the paused frame (WKWebView filter ceiling); exports are exact.
          </Quiet>
        </>
      )}
    </div>
  );
}

/** The join after this clip — its frames and the hard cut; the six tiles live in the join's own picker. */
function TransitionAdvanced({ t }) {
  const j = t.transitionAfter;
  if (!j) return null;
  return (
    <div className="insp-adv-g" data-testid="insp-adv-transition">
      <p className="insp-adv-h insp-sub">
        <span>Transition frames</span>
      </p>
      <Row k="Frames" name="clip-transition-frames">
        <NumberField
          value={j.dur}
          min={1}
          max={120}
          step={1}
          scrub={false}
          ariaLabel="Transition duration"
          onCommit={(v) => t.onJoin(j, { durationInFrames: v })}
        />
      </Row>
      <button
        type="button"
        className="insp-quietlink"
        data-testid="timeline-transition-remove"
        onClick={() => t.onRemoveJoin(j)}
      >
        Remove transition (hard cut)
      </button>
    </div>
  );
}

// ── Advanced: title ──────────────────────────────────────────────────────────────────────────────────────
function TitleAdvanced({ el, open, onToggle }) {
  const t = el?.timeline;
  if (!t) return null;
  const m = t.seq.titleMotion;
  const preset = m?.preset ?? 'none';
  return (
    <AdvancedFold panel="inspector" hint={advancedHint(t)} open={open} onToggle={onToggle}>
      <div className="insp-adv insp-adv--title" data-testid="insp-adv-title">
        {/* P8 C8 (07 · ve-text): the card is Font · Colour · Motion · Length; the words themselves live here */}
        <TextRows t={t} />
        <div className="insp-css" data-testid="insp-adv-title-enter">
          <span className="insp-css-k k-mono">enter</span>
          <span className="insp-css-v k-mono">
            {preset === 'none' ? 'none' : `${preset} ${m?.frames ?? TITLE_MOTION_FRAMES}f`}
          </span>
        </div>
        <div className="insp-css">
          <span className="insp-css-k k-mono">easing</span>
          <span className="insp-css-v k-mono">ease-out</span>
        </div>
        <SpeedRow t={t} />
      </div>
    </AdvancedFold>
  );
}

// ── the slots ────────────────────────────────────────────────────────────────────────────────────────────
export const CLIP_SLOTS = Object.freeze([
  ['clip', { id: 'clip.rows', order: 10, kinds: ['clip'], title: 'Clip', Body: ClipRows }],
  [
    'title-motion',
    { id: 'title-motion.rows', order: 10, kinds: ['title'], title: 'Title', Body: TitleRows },
  ],
]);

/** @returns {() => void} take the clip's sections back out of the registry */
export function registerClipSlots() {
  const offs = CLIP_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offClip = registerClipSlots();
