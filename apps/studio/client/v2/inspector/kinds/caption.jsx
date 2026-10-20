// client/v2/inspector/kinds/caption.jsx — S7.11: the inspector of the captions (07 · ve-captions, "Captions get a
// style in the inspector: font, highlight, position, words at a time").
//
//   Captions  Font · Highlight · Position · Words at a time · Also as a file
//             › Advanced: srt · lang · maxChars
//
// The captions are ONE `<Captions>` per video; every row is a prop of it, written as one edit op
// (`video.captions.add` with the changed prop — styleCaptions in transcript/captions-api.js), so the undo, the
// refusal and the role gate are the Timeline's. A caption word you select on the Text track shows these rows;
// the words themselves are edited in the Transcript panel. "Also as a file" is the export sheet's switch (S8):
// the row exists once S8 has registered its store (transcript/captions-file-flag.js).

import { useMemo, useSyncExternalStore } from 'react';
import { paintFromCss, paintToCss } from '../../../../edit-ops/words-paint.ts';
import { Segmented, Select, Toggle, NumberField } from '../../../inspector-controls.jsx';
import { styleCaptions } from '../../transcript/captions-api.js';
import { captionsFileFlag } from '../../transcript/captions-file-flag.js';
import { AdvancedFold } from '../../fold/advanced-fold.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { ColorControl } from '../sections/color-control.jsx';
import { registerSlot } from '../slots.js';
import { useDsFamilies } from '../token-chip.jsx';
import { registerKind, singleOf } from './index.js';

const timelineOf = (selection) => singleOf(selection)?.timeline ?? null;

const POSITIONS = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];
const WORDS_AT_A_TIME = [
  { value: '1', label: '1' },
  { value: '3', label: '3' },
  { value: 'line', label: 'Line' },
];
/** The §5.3 default line length — what Advanced shows while the file says nothing. */
export const DEFAULT_MAX_CHARS = 32;

registerKind({
  id: 'caption',
  label: 'Captions',
  order: 3,
  match: (s) => timelineOf(s)?.kind === 'caption',
  Advanced: CaptionsAdvanced,
  advancedHint: () => '3 properties',
});

/** `--font-display` → "Display". */
export function fontLabel(token) {
  const name = String(token)
    .replace(/^--font-?/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : String(token);
}

/** The DS's font tokens, as `var(--font-…)` values the file stores. */
export function fontOptions(vals, current) {
  const tokens = Object.keys(vals || {}).filter((k) => /^--font-/.test(k));
  const opts = [{ value: '', label: 'Default' }];
  for (const k of tokens) opts.push({ value: `var(${k})`, label: fontLabel(k) });
  if (current && !opts.some((o) => o.value === current))
    opts.push({ value: current, label: current });
  return opts;
}

/** `captions.highlight` ("var(--accent)") as the colour control reads it. */
export const highlightValue = (css) => (css ? { paint: paintFromCss(css), opacity: 100 } : null);

function useFileFlag() {
  useSyncExternalStore(
    captionsFileFlag.subscribe,
    captionsFileFlag.version,
    captionsFileFlag.version
  );
  return captionsFileFlag.available();
}

function CaptionRows({ el, ctx }) {
  const t = timelineOf(el);
  const fam = useDsFamilies(ctx);
  const fonts = useMemo(
    () => fontOptions(fam.vals, t?.seq.captions?.font),
    [fam.vals, t?.seq.captions?.font]
  );
  const hasFlag = useFileFlag();
  if (!t) return null;
  const c = t.seq.captions;
  if (!c) return <Quiet testid="insp-captions-none">This video has no captions yet.</Quiet>;
  return (
    <div data-testid="insp-captions">
      <Row k="Font" name="captions-font">
        <Select
          value={c.font ?? ''}
          options={fonts}
          ariaLabel="Caption font"
          testId="insp-captions-font"
          onChange={(v) => styleCaptions({ font: v || null })}
        />
      </Row>
      <Row k="Highlight" name="captions-highlight">
        <ColorControl
          name="captions-highlight"
          label="Highlight colour"
          value={highlightValue(c.highlight)}
          colors={fam.color}
          allowNone
          noneLabel="Default"
          onChange={(v) => styleCaptions({ highlight: v ? paintToCss(v.paint) : null })}
        />
      </Row>
      <Row k="Position" name="captions-position">
        <span data-testid="insp-captions-position">
          <Segmented
            value={c.position}
            options={POSITIONS}
            ariaLabel="Caption position"
            onChange={(v) => styleCaptions({ position: v })}
          />
        </span>
      </Row>
      <Row k="Words at a time" name="captions-words">
        <span data-testid="insp-captions-words">
          <Segmented
            value={String(c.words)}
            options={WORDS_AT_A_TIME}
            ariaLabel="Words at a time"
            onChange={(v) => styleCaptions({ words: v === 'line' ? 'line' : Number(v) })}
          />
        </span>
      </Row>
      {hasFlag ? (
        <Row k="Also as a file" name="captions-file">
          <span data-testid="insp-captions-file">
            <Toggle
              checked={captionsFileFlag.get(t.canvas, t.artboardId)}
              ariaLabel="Also export the captions as a file"
              onChange={(on) => captionsFileFlag.set(t.canvas, t.artboardId, on)}
            />
          </span>
        </Row>
      ) : null}
    </div>
  );
}

const slug = (canvas) =>
  String(canvas ?? '')
    .replace(/^.*\//, '')
    .replace(/\.tsx$/, '');

function CaptionsAdvanced({ el, open, onToggle }) {
  const t = timelineOf(el);
  if (!t?.seq.captions) return null;
  const c = t.seq.captions;
  return (
    <AdvancedFold panel="inspector" hint="3 properties" open={open} onToggle={onToggle}>
      <div className="insp-adv insp-adv--captions" data-testid="insp-adv-captions">
        <div className="insp-css" data-testid="insp-adv-captions-srt">
          <span className="insp-css-k k-mono">srt</span>
          <span className="insp-css-v k-mono">{`${slug(t.canvas)}.srt`}</span>
        </div>
        <div className="insp-css" data-testid="insp-adv-captions-lang">
          <span className="insp-css-k k-mono">lang</span>
          <span className="insp-css-v k-mono">{t.seq.lang ?? 'unknown'}</span>
        </div>
        <Row k="maxChars" name="captions-maxchars">
          <span data-testid="insp-captions-maxchars">
            <NumberField
              value={c.maxChars ?? DEFAULT_MAX_CHARS}
              min={8}
              max={200}
              step={1}
              scrub={false}
              ariaLabel="Characters per caption line"
              onCommit={(n) => styleCaptions({ maxChars: Math.round(n) })}
            />
          </span>
        </Row>
      </div>
    </AdvancedFold>
  );
}

// ── the slot ─────────────────────────────────────────────────────────────────────────────────────────────
export const CAPTION_SLOTS = Object.freeze([
  [
    'captions',
    { id: 'captions.rows', order: 10, kinds: ['caption'], title: 'Captions', Body: CaptionRows },
  ],
]);

/** @returns {() => void} take the captions' section back out of the registry */
export function registerCaptionSlots() {
  const offs = CAPTION_SLOTS.map(([section, entry]) => registerSlot(section, entry));
  return () => {
    for (const off of offs) off();
  };
}

export const offCaption = registerCaptionSlots();
