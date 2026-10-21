// client/v2/export/sections/print.jsx — S8.7: a print artboard → Print PDF, on paper (09 ex-print, ex-print-warn).
//
// "The preview is the PDF the print shop gets": crop marks draw in at the corners, the bleed past the cut is
// tinted, the back sits under the front as page 2, and untick Bleed and the paper changes with it. Under the
// rows the sheet WARNS and never blocks — an element past the safe margin (Show on canvas), a font that will
// not embed (the text prints as shapes, same look) — and says the one colour line. Print never carries
// annotations (S4 policy: the box is greyed with the reason).
//
// The three choices that shape the file (Bleed, Crop marks, Add the back) live in `state.adv` — the same fields
// Advanced › Print PDF writes — so ticking one here and flipping the switch there are one setting.

import { useMemo, useState } from 'react';
import { ANNOTATIONS_LABEL, ANNOTATIONS_SUB, OTHER_GROUPS } from '../export-copy.js';
import { Check, Hint, Row, Seg } from '../parts.jsx';
import { fontLine, OUTLINES_ON } from '../preflight/fonts.js';
import { Paper } from '../preflight/paper.jsx';
import { safeMarginLine, SHOW_ON_CANVAS } from '../preflight/safe-margin.js';
import {
  BACK_SUB,
  backLabel,
  BLEED_LABEL,
  bleedSub,
  COLOUR_LINE,
  COLOUR_ROW,
  CROP_LABEL,
  CROP_SUB,
  LEGEND,
  PAPER_NONE,
  PAPER_PENDING,
  PRINT_FORMATS,
  PRINT_ROW,
  pageCaption,
} from './print-copy.js';

const labelOf = (format) =>
  OTHER_GROUPS.flatMap((g) => g.items).find((i) => i.format === format && !i.needs)?.label ??
  String(format).toUpperCase();

/** What the person has chosen for the print file, with the defaults the kind offers first. */
export function printChoices(state, preflight) {
  const adv = state.adv ?? {};
  const printPdf = state.format === 'pdf' && state.printPdf !== false;
  const back = preflight?.boards?.[0]?.back ?? null;
  return {
    printPdf,
    bleed: adv.bleed ?? true,
    crop: adv.crop ?? true,
    registration: adv.registration ?? false,
    outlines: adv.text === 'outline',
    back,
    // page 2 exists only in a Print PDF, only when the pairing was found and the box is on
    withBack: printPdf && !!back && (adv.back ?? true),
  };
}

export function PrintSection({
  state,
  set,
  setFormat,
  other,
  annotationsOff = false,
  annotationsNote,
  preflight = null,
  onShowOnCanvas,
}) {
  const c = printChoices(state, preflight);
  const adv = state.adv ?? {};
  const setAdv = (patch) => set({ adv: { ...adv, ...patch } });
  const [page, setPage] = useState(0);
  const board = preflight?.boards?.[0] ?? null;
  const paper = board?.paper ?? null;
  const pages = c.withBack ? 2 : 1;
  const at = Math.min(page, pages - 1);
  const findings = useMemo(() => preflight?.safeMargin ?? [], [preflight]);
  const safeLine = safeMarginLine(findings);
  const fonts = fontLine(preflight?.fonts ?? [], c.outlines);

  const group = c.printPdf
    ? 'print-pdf'
    : state.format === 'pdf' || state.format === 'png'
      ? state.format
      : state.format;
  const options = PRINT_FORMATS.map(([id, label]) => ({
    id,
    label,
    testid: `export-print-format-${id}`,
  }));
  if (!['print-pdf', 'pdf', 'png'].includes(group))
    options.push({ id: group, label: labelOf(group), testid: `export-format-${group}` });

  const pick = (id) => {
    if (id === 'print-pdf') {
      setFormat('pdf');
      set({ printPdf: true });
    } else if (id === 'pdf') {
      setFormat('pdf');
      set({ printPdf: false });
    } else setFormat(id);
  };

  return (
    <div className="ex-print" data-testid="export-print" data-pages={pages}>
      <div className="ex-print-prev" data-testid="export-print-preview">
        {paper ? (
          <>
            <span className="ex-pic ex-pic--paper">
              <Paper
                paper={paper}
                bleed={c.printPdf ? c.bleed : false}
                marks={c.printPdf && c.crop}
                registration={c.printPdf && c.registration}
                findings={at === 0 ? findings : []}
                stack={pages > 1 && at === 0}
              />
            </span>
            {pages > 1 ? (
              <span className="ex-pages" data-testid="export-print-pages">
                {Array.from({ length: pages }, (_, i) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: pages are positions
                    key={i}
                    type="button"
                    className="ex-pg-th"
                    data-on={i === at ? 'true' : undefined}
                    data-testid={`export-print-page-${i + 1}`}
                    aria-label={`Page ${i + 1}`}
                    aria-pressed={i === at}
                    onClick={() => setPage(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </span>
            ) : null}
            <span className="ex-prev-cap" data-testid="export-print-caption">
              {pageCaption({ page: at, pages, paper })}
            </span>
            <span className="ex-legend" data-testid="export-print-legend">
              {c.printPdf && c.bleed ? (
                <span>
                  <i className="ex-lg ex-lg--tint" />
                  {LEGEND.bleed(paper.bleedMm)}
                </span>
              ) : null}
              <span>
                <i className="ex-lg ex-lg--cut" />
                {LEGEND.cut}
              </span>
              {findings.length > 0 ? (
                <span>
                  <i className="ex-lg ex-lg--safe" />
                  {LEGEND.safe(paper.marginMm[0])}
                </span>
              ) : null}
            </span>
          </>
        ) : (
          <>
            <span
              className="ex-pic ex-pic--paper ex-paper-blank"
              data-testid="export-print-pending"
              data-state={preflight ? 'none' : 'measuring'}
              aria-hidden="true"
            >
              <span className="ex-paper-blank-page" />
            </span>
            <span className="ex-prev-cap" data-testid="export-print-caption">
              {preflight ? PAPER_NONE : PAPER_PENDING}
            </span>
          </>
        )}
      </div>

      <div className="ex-print-rows">
        <Row k="Format" testid="export-row-format">
          <Seg
            label="Format"
            testid="export-print-format"
            options={options}
            value={group}
            onPick={pick}
          />
          {other}
        </Row>
        {c.printPdf ? (
          <Row k={PRINT_ROW} top testid="export-row-print">
            <span className="ex-checks">
              <Check
                checked={c.bleed}
                sub={bleedSub(paper?.bleedMm ?? 0)}
                testid="export-print-bleed"
                onChange={(bleed) => setAdv({ bleed })}
              >
                {BLEED_LABEL}
              </Check>
              <Check
                checked={c.crop}
                sub={CROP_SUB}
                testid="export-print-crop"
                onChange={(crop) => setAdv({ crop })}
              >
                {CROP_LABEL}
              </Check>
              {c.back ? (
                <Check
                  checked={c.withBack}
                  sub={BACK_SUB}
                  testid="export-print-back"
                  onChange={(back) => setAdv({ back })}
                >
                  {backLabel(c.back)}
                </Check>
              ) : null}
            </span>
          </Row>
        ) : null}
        {c.printPdf && safeLine ? (
          <Hint
            icon="problem"
            tone="warn"
            testid="export-print-safe-warn"
            action={SHOW_ON_CANVAS}
            onAction={() => onShowOnCanvas?.(findings[0])}
          >
            {safeLine}
          </Hint>
        ) : null}
        {c.printPdf && fonts ? (
          <Hint icon="type" tone="warn" testid="export-print-font-warn">
            {fonts}
          </Hint>
        ) : null}
        {c.printPdf && c.outlines && (preflight?.fonts ?? []).some((f) => !f.embeddable) ? (
          <Hint icon="type" testid="export-print-font-ok">
            {OUTLINES_ON}
          </Hint>
        ) : null}
        <Row k={COLOUR_ROW} testid="export-row-colour">
          <span className="ex-val" data-testid="export-print-colour">
            {COLOUR_LINE}
          </span>
        </Row>
        <Row k="Annotations" note={annotationsNote} testid="export-row-annotations">
          <Check
            checked={state.annotations && !annotationsOff}
            disabled={annotationsOff}
            sub={ANNOTATIONS_SUB}
            testid="export-include-annotations"
            onChange={(annotations) => set({ annotations })}
          >
            {ANNOTATIONS_LABEL}
          </Check>
        </Row>
      </div>
    </div>
  );
}
