// client/v2/export/advanced/advanced.jsx — S8.3: Export › Advanced (09 ex-advanced; 06 ad-export).
//
// The ONE "› Advanced" fold of the sheet (`panel="export"`, remembered per Mac like every fold), and it
// opens only the part for what is selected: an image, a print PDF, a video, where it renders — then the
// file-name pattern and the same export as a command at the foot. Mono is allowed in here and nowhere
// else in the sheet.

import { useCallback, useMemo } from 'react';
import { AdvancedFold } from '../../fold/advanced-fold.jsx';
import { FOLD_HINT, FOLD_HINT_BATCH } from './advanced-copy.js';
import { CommandPart } from './command.jsx';
import { ImagePart } from './image.jsx';
import { advancedParts, nameSamples, specFormats } from './model.js';
import { NamesPart } from './names.jsx';
import { PrintPart } from './print.jsx';
import { RenderPart } from './render.jsx';
import { VideoPart } from './video.jsx';

const VIDEO_FORMATS = ['mp4', 'webm', 'gif'];

/**
 * @param state   the sheet's state (`state.adv` = the fold's touched fields)
 * @param set     the sheet's state patch
 * @param spec    the spec the sheet would send NOW (the fold's fields already laid over it)
 * @param kinds   the artboard kinds the estimate says the spec reaches
 * @param facts   { project, canvas (designRoot-relative), label } — what the file-name preview needs
 */
export function AdvancedSection({ state, set, spec, kinds, exportLane, facts, batch, sheetScale }) {
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
  return (
    <AdvancedFold
      panel="export"
      hint={batch ? FOLD_HINT_BATCH : FOLD_HINT}
      testid="export-advanced"
      buttonTestid="export-advanced-toggle"
      classes={{ root: 'v2-fold ex-adv', body: 'v2-fold-body ex-adv-body' }}
    >
      <div className="ex-adv-cols" data-testid="export-adv-parts">
        {parts.image ? (
          <ImagePart adv={adv} setAdv={setAdv} sheetScale={sheetScale} jpg={formats.has('jpg')} />
        ) : null}
        {parts.print ? <PrintPart spec={spec} setAdv={setAdv} /> : null}
        {parts.video ? (
          <VideoPart
            spec={spec}
            formats={VIDEO_FORMATS.filter((f) => formats.has(f))}
            setAdv={setAdv}
          />
        ) : null}
        {parts.render ? (
          <RenderPart
            spec={spec}
            exportLane={exportLane}
            video={parts.video || formats.has('audio')}
            setAdv={setAdv}
          />
        ) : null}
      </div>
      <div className="ex-adv-foot">
        <NamesPart
          template={template}
          samples={samples}
          onChange={(nameTemplate) => setAdv({ nameTemplate })}
        />
        <CommandPart spec={spec} />
      </div>
    </AdvancedFold>
  );
}
