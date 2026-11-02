// client/v2/inspector/sections/row.jsx — S2.3: a labelled row inside a section body (14 Editing, `Row`).
// `name` is the testid suffix: insp-row-<name>.

import { useMemo, useRef, useState } from 'react';
import { ScrubLabelContext } from '../../../inspector-controls.jsx';

/**
 * The label of a number row is a scrub handle too (Figma). A scrubbing NumberField (or px length) inside registers
 * with the context; with exactly one the label scrubs it (ew-resize), with two ("X · Y") the label stays a plain
 * label because "which one?" has no answer. Returns the context for the Provider and the props for the label.
 */
export function useScrubLabel() {
  const fields = useRef(new Set());
  const [count, setCount] = useState(0);
  const ctx = useMemo(
    () => ({
      register(fn) {
        fields.current.add(fn);
        setCount(fields.current.size);
        return () => {
          fields.current.delete(fn);
          setCount(fields.current.size);
        };
      },
    }),
    []
  );
  const scrubbable = count === 1;
  const labelProps = {
    'data-scrub': scrubbable ? 'true' : undefined,
    title: scrubbable ? 'Drag to change · Shift ×10 · Alt fine' : undefined,
    onPointerDown: scrubbable
      ? (e) => {
          const [only] = fields.current;
          only?.(e);
        }
      : undefined,
  };
  return { ctx, labelProps };
}

export function Row({ k, name, dim = false, mod = false, children }) {
  const { ctx, labelProps } = useScrubLabel();
  return (
    <div className="insp-row" data-testid={`insp-row-${name}`} data-dim={dim ? 'true' : undefined}>
      <span className="insp-row-k" {...labelProps}>
        {k}
        {/* S2.12: a value this object sets over its style's — the dot says "Changed here" */}
        {mod ? (
          <i
            className="insp-mod"
            role="img"
            aria-label="Changed here"
            title="Changed here"
            data-testid={`insp-mod-${name}`}
          />
        ) : null}
      </span>
      <span className="insp-row-v">
        <ScrubLabelContext.Provider value={ctx}>{children}</ScrubLabelContext.Provider>
      </span>
    </div>
  );
}

/** A quiet line under a row: what is true, in one sentence. */
export function Quiet({ children, testid, line = false }) {
  return (
    // line = board 14's Line: the sentence in its own soft box (V2-8.5 c6)
    <p className={line ? 'insp-quiet insp-quiet--line' : 'insp-quiet'} data-testid={testid}>
      {children}
    </p>
  );
}

/** The measured size of the object in world px — what a Fixed value starts from. */
export const worldSize = (el) => ({
  width: Math.round(el?.worldW ?? el?.bounds?.w ?? 0),
  height: Math.round(el?.worldH ?? el?.bounds?.h ?? 0),
});

/** What an element's CSS says: what the file authored, over what the browser resolved for the layout keys. */
const LAYOUT_COMPUTED = ['display', 'flex-direction', 'justify-content', 'align-items', 'position'];
export function effectiveCss(el, authored) {
  const out = {};
  for (const k of LAYOUT_COMPUTED) {
    const v = el?.computed?.[k];
    if (v && v !== 'normal') out[k] = v;
  }
  return { ...out, ...authored };
}
