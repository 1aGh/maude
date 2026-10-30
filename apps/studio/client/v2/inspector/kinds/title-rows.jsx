// client/v2/inspector/kinds/title-rows.jsx — S7.10: a title's own rows (07 · ve-text).
//
//   Text     the words the title says — the v1 dialog's Text tab, with its two testids          (clip.set-text)
//   Font     the design system's font tokens, written as var(--font-…)                        (video.title.style)
//   Colour   a token or a colour of its own, "Default" takes it off                           (video.title.style)
//   Motion   None · Fade · Slide up · Pop · Type on · Per word — a grid of six small pictures     (video.title.motion)

import { useMemo, useRef } from 'react';
import { paintFromCss, paintToCss } from '../../../../edit-ops/words-paint.ts';
import { TITLE_MOTION_LABELS, TITLE_MOTIONS } from '../../../../video/title-motion.ts';
import { Select } from '../../../inspector-controls.jsx';
import { ColorControl } from '../sections/color-control.jsx';
import { Row } from '../sections/row.jsx';
import { useDsFamilies } from '../token-chip.jsx';

const PIC = { 'slide-up': 'up', 'type-on': 'type', 'per-word': 'word' };

/** The words of the title, or the prompt of an AI slate: edited here, written when Apply is pressed. */
export function TextRows({ t }) {
  const slate = !!t.seq.placeholder;
  const text = slate ? (t.seq.placeholder.prompt ?? '') : (t.seq.text ?? '');
  const ref = useRef(null);
  return (
    <Row k={slate ? 'Prompt' : 'Text'} name="clip-text">
      <span className="insp-text">
        <textarea
          // a refetch that changed the words (a teammate's edit) starts the field from them
          key={`${t.stableId}:${text}`}
          ref={ref}
          className="insp-textarea"
          data-testid="timeline-inspector-text"
          defaultValue={text}
          rows={3}
          aria-label={slate ? 'Generation prompt' : 'Title text'}
          placeholder={slate ? 'Generation prompt…' : 'Title text…'}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          className="insp-quietlink"
          data-testid="timeline-inspector-text-apply"
          onClick={() => {
            const v = ref.current?.value;
            if (v?.trim()) t.onVerb('set-text', { text: v });
          }}
        >
          Apply text
        </button>
      </span>
    </Row>
  );
}

/** The six presets as small pictures; the one the title has is lit. */
export function MotionGrid({ t }) {
  const on = t.seq.titleMotion?.preset ?? 'none';
  return (
    <span
      className="insp-motion"
      data-testid="insp-title-motion"
      role="radiogroup"
      aria-label="Motion"
    >
      {TITLE_MOTIONS.map((id) => (
        // biome-ignore lint/a11y/useSemanticElements: a picture tile that is one of six; a native radio could not draw it
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={on === id}
          className="insp-motion-o"
          data-on={on === id ? 'true' : undefined}
          data-testid={`insp-title-motion-${id}`}
          onClick={() => on !== id && t.onOp('title.motion', { preset: id })}
        >
          <span className={`insp-motion-pic insp-motion-pic--${PIC[id] ?? id}`} aria-hidden="true">
            <i />
            {id === 'slide-up' || id === 'per-word' ? <i /> : null}
          </span>
          {TITLE_MOTION_LABELS[id]}
        </button>
      ))}
    </span>
  );
}

/** `--font-display` → "Display". */
function fontLabel(token) {
  const name = String(token)
    .replace(/^--font-?/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : String(token);
}

/** The DS's font tokens as the `var(--font-…)` values the file stores; a value the file has and the system lacks stays. */
function fontOptions(vals, current) {
  const opts = [{ value: '', label: 'Default' }];
  for (const k of Object.keys(vals || {}).filter((x) => /^--font-/.test(x)))
    opts.push({ value: `var(${k})`, label: fontLabel(k) });
  if (current && !opts.some((o) => o.value === current))
    opts.push({ value: current, label: current });
  return opts;
}

/** Font and Colour: the `style` of the title's words, one `video.title.style` per change (null = off). */
export function StyleRows({ t, ctx }) {
  const fam = useDsFamilies(ctx);
  const now = t.seq.titleStyle ?? { font: null, color: null };
  const fonts = useMemo(() => fontOptions(fam.vals, now.font), [fam.vals, now.font]);
  return (
    <>
      <Row k="Font" name="title-font">
        <Select
          value={now.font ?? ''}
          options={fonts}
          ariaLabel="Title font"
          testId="insp-title-font"
          onChange={(v) => t.onOp('title.style', { font: v || null })}
        />
      </Row>
      <Row k="Colour" name="title-colour">
        <ColorControl
          name="title-colour"
          label="Title colour"
          value={now.color ? { paint: paintFromCss(now.color), opacity: 100 } : null}
          colors={fam.color}
          allowNone
          noneLabel="Default"
          onChange={(v) => t.onOp('title.style', { color: v ? paintToCss(v.paint) : null })}
        />
      </Row>
    </>
  );
}
