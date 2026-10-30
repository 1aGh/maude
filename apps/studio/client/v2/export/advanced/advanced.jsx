// client/v2/export/advanced/advanced.jsx — S8.3: Export › Advanced (09 ex-advanced; 06 ad-export).
//
// The ONE "› Advanced" fold of the sheet (`panel="export"`, remembered per Mac like every fold), and it
// opens only the part for what is selected: an image, a print PDF, a video, where it renders — then the
// file-name pattern and the same export as a command at the foot. Mono is allowed in here and nowhere
// else in the sheet.

import { useCallback, useMemo } from 'react';
import { StIcon } from '../../../shell/icons.jsx';
import { foldBodyId } from '../../fold/advanced-fold.jsx';
import { IMAGE_TITLE, PRINT_TITLE, RENDER_TITLE, VIDEO_TITLE } from './advanced-copy.js';
import { CommandPart } from './command.jsx';
import { ImagePart } from './image.jsx';
import { advancedParts, nameSamples, specFormats } from './model.js';
import { NamesPart } from './names.jsx';
import { PrintPart } from './print.jsx';
import { RenderPart } from './render.jsx';
import { VideoPart } from './video.jsx';

const VIDEO_FORMATS = ['mp4', 'webm', 'gif'];

/** 09 ex-advanced: each part sits under its own visible heading (Image · Print PDF · Video · Where it renders). */
function Col({ id, title, children }) {
  return (
    <div className="ex-adv-col" data-testid={`export-adv-${id}-col`}>
      <p className="ex-advp-h" data-testid={`export-adv-${id}-title`}>
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * 09 — the Advanced row lives in the sheet's footer: `› Advanced <hint>` at the left, Cancel and the verb at the
 * right. It is the shared fold's own button (same classes, same remembered state — `useFold('export')`), drawn where
 * the board puts it; its body opens above the summary (`AdvancedSection`).
 */
export function AdvancedToggle({ open, onToggle, hint }) {
  return (
    <button
      type="button"
      className="v2-fold-btn ex-adv-btn"
      data-testid="export-advanced-toggle"
      aria-expanded={open}
      aria-controls={open ? foldBodyId('export') : undefined}
      onClick={onToggle}
    >
      <span className="v2-fold-ch">
        <StIcon name="chevron-right" size={12} />
      </span>
      Advanced
      {hint ? <span className="v2-fold-hint">{hint}</span> : null}
    </button>
  );
}

/**
 * The part of Advanced that opens: only the knobs for what is selected. Closed, it draws nothing.
 * @param open    is the fold open (the sheet owns the state; the toggle is in the footer)
 * @param state   the sheet's state (`state.adv` = the fold's touched fields)
 * @param set     the sheet's state patch
 * @param spec    the spec the sheet would send NOW (the fold's fields already laid over it)
 * @param kinds   the artboard kinds the estimate says the spec reaches
 * @param facts   { project, canvas (designRoot-relative), label } — what the file-name preview needs
 */
export function AdvancedSection({
  open,
  state,
  set,
  spec,
  kinds,
  exportLane,
  facts,
  sheetScale,
  bleedMm = 3,
  extra = null,
}) {
  const adv = state.adv ?? {};
  const setAdv = useCallback(
    (patch) => set({ adv: { ...(state.adv ?? {}), ...patch } }),
    [set, state.adv]
  );
  const formats = useMemo(() => specFormats(spec), [spec]);
  const parts = advancedParts({ formats, kinds, exportLane });
  const template = adv.nameTemplate;
  const kindList = useMemo(() => [...kinds], [kinds]);
  const samples = useMemo(
    () => nameSamples(spec, template, kindList, facts),
    [spec, template, kindList, facts]
  );
  if (!open) return null;
  return (
    <div
      className="v2-fold ex-adv"
      data-fold="export"
      data-open="true"
      data-testid="export-advanced"
    >
      <div
        id={foldBodyId('export')}
        className="v2-fold-body ex-adv-body"
        data-testid="fold-export-body"
      >
        <div className="ex-adv-cols" data-testid="export-adv-parts">
          {parts.image ? (
            <Col id="image" title={IMAGE_TITLE}>
              <ImagePart adv={adv} setAdv={setAdv} sheetScale={sheetScale} />
            </Col>
          ) : null}
          {parts.print ? (
            <Col id="print" title={PRINT_TITLE}>
              <PrintPart spec={spec} setAdv={setAdv} bleedMm={bleedMm} />
            </Col>
          ) : null}
          {parts.video ? (
            <Col id="video" title={VIDEO_TITLE}>
              <VideoPart
                spec={spec}
                formats={VIDEO_FORMATS.filter((f) => formats.has(f))}
                setAdv={setAdv}
              />
            </Col>
          ) : null}
          {parts.render ? (
            <Col id="render" title={RENDER_TITLE}>
              <RenderPart
                spec={spec}
                exportLane={exportLane}
                video={parts.video || formats.has('audio')}
                setAdv={setAdv}
              />
            </Col>
          ) : null}
        </div>
        <div className="ex-adv-foot">
          {extra}
          <NamesPart
            template={template}
            samples={samples}
            onChange={(nameTemplate) => setAdv({ nameTemplate })}
          />
          <CommandPart spec={spec} />
        </div>
      </div>
    </div>
  );
}
