// client/v2/inspector/kinds/artboard-print-advanced.jsx — S7.23: a print artboard's Advanced fold (08 ak-advanced).
// "Every number, under Advanced." Registered through client/v2/kinds/advanced-rows.js (S11.8's append-only registry):
//
//   Exact size       artboard · trim · bleed · margin, in px and mm
//   Resolution       canvas 96 px per inch · print PDF 300 dpi · vector text
//   Colour           "Designed in sRGB. RGB — the print shop converts to CMYK; …"
//   Guides  + Add    columns · rows · grid (the artboard's `guides` prop — View-only chrome, never exported)
//   Look and layout  Body layout (Theme sits above, for every artboard)
//   In code          the DCArtboard as the file carries it
//
// Clip content and Kind keep their rows in artboard-advanced-rows.jsx, like the other three kinds.

import { useState } from 'react';

import { Select } from '../../../inspector-controls.jsx';
import { Row as AdvRow } from '../advanced-rows-default.jsx';
import { writeGuides } from '../print-write.js';
import { LAYOUT_OPTIONS, artboardFacts } from './artboard-model.js';
import {
  COLOUR_WORDS,
  GUIDE_DEFAULTS,
  RESOLUTION_FACTS,
  codeOf,
  guideFacts,
  printExactFacts,
} from './artboard-print-model.js';

const H = ({ children, aside }) => (
  <p className="insp-adv-h insp-sub">
    <span>{children}</span>
    {aside ? <span className="insp-sub-a">{aside}</span> : null}
  </p>
);

const guidesOf = (el) => {
  try {
    const raw = el?.attrs?.['data-dc-guides'];
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function PrintExactSize({ el }) {
  const f = artboardFacts(el);
  return (
    <div className="insp-adv-block" data-testid="insp-pr-exact">
      <H>Exact size</H>
      {printExactFacts(f, f.print).map(([k, v]) => (
        <AdvRow key={k} k={k} mono testid={`insp-pr-exact-${k.replace(/\W+/g, '-')}`}>
          {v}
        </AdvRow>
      ))}
    </div>
  );
}

export function PrintResolution() {
  return (
    <div className="insp-adv-block" data-testid="insp-pr-resolution">
      <H>Resolution</H>
      {RESOLUTION_FACTS.map(([k, v]) => (
        <AdvRow key={k} k={k} mono testid={`insp-pr-res-${k.replace(/\W+/g, '-')}`}>
          {v}
        </AdvRow>
      ))}
    </div>
  );
}

export function PrintColour() {
  return (
    <div className="insp-adv-block" data-testid="insp-pr-colour-adv">
      <H>Colour</H>
      <p className="insp-quiet">{COLOUR_WORDS}</p>
    </div>
  );
}

export function PrintGuides({ el, ctx }) {
  const f = artboardFacts(el);
  const canvas = ctx?.canvasFile ?? el?.file ?? null;
  const guides = guidesOf(el) ?? {};
  const [said, setSaid] = useState('');
  const can = !!f.id && !!canvas && ctx?.canEdit !== false;
  const off = Object.keys(GUIDE_DEFAULTS).filter((k) => !guides[k]);
  const put = async (next) => {
    setSaid('');
    const r = await writeGuides({
      canvas,
      artboardId: f.id,
      guides: Object.keys(next).length ? next : null,
    });
    if (!r.ok) setSaid(r.message);
  };
  return (
    <div className="insp-adv-block" data-testid="insp-pr-guides-adv">
      <H
        aside={
          can && off.length ? (
            <Select
              value=""
              ariaLabel="Add a guide"
              testId="insp-pr-guides-add"
              options={[
                { value: '', label: 'Add…' },
                ...off.map((k) => ({ value: k, label: k[0].toUpperCase() + k.slice(1) })),
              ]}
              onChange={(k) => k && put({ ...guides, [k]: GUIDE_DEFAULTS[k] })}
            />
          ) : null
        }
      >
        Guides
      </H>
      {guideFacts(guides).map(([k, v]) => (
        <AdvRow key={k} k={k} mono testid={`insp-pr-guide-${k}`}>
          {v}
          {can && guides[k] ? (
            <>
              {' '}
              <button
                type="button"
                className="insp-link"
                data-testid={`insp-pr-guide-${k}-remove`}
                onClick={() => {
                  const { [k]: _gone, ...rest } = guides;
                  put(rest);
                }}
              >
                Remove
              </button>
            </>
          ) : null}
        </AdvRow>
      ))}
      {said ? (
        <p className="insp-quiet" data-testid="insp-pr-guides-said">
          {said}
        </p>
      ) : null}
    </div>
  );
}

export function PrintLookAndLayout({ el, ctx }) {
  const f = artboardFacts(el);
  const h = ctx?.artboard || {};
  if (!h.onSetArtboardStyle) return null;
  return (
    <div className="insp-adv-block" data-testid="insp-pr-look">
      <H>Look and layout</H>
      <AdvRow k="Body layout" testid="insp-pr-body-layout">
        <Select
          value={f.layout}
          ariaLabel="Artboard body layout"
          testId="insp-pr-body-layout-select"
          options={LAYOUT_OPTIONS}
          onChange={(v) => f.id && h.onSetArtboardStyle(f.id, { layout: v || null })}
        />
      </AdvRow>
    </div>
  );
}

export function PrintInCode({ el }) {
  const f = artboardFacts(el);
  return (
    <div className="insp-adv-block" data-testid="insp-pr-code">
      <H>In code</H>
      <pre className="insp-code" data-testid="insp-pr-code-text">
        {codeOf(f, f.print, guidesOf(el))}
      </pre>
    </div>
  );
}
