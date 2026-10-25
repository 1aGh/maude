// client/v2/export/sections/batch.jsx — S8.3: many artboards at once (09 ex-batch-pick · ex-batch · ex-huge).
//
// Five artboards of two kinds, a folder, the whole project: one sheet, one button. The estimate says
// which kinds the spec reaches and each kind is a group with its OWN format row and its OWN default —
// a pick on one never moves another. Shared-parts canvases are left out BY NAME, and a big export says
// it is big (counts, size, time) and what the window may do next.

import { ANNOTATIONS_LABEL, ANNOTATIONS_SUB, summaryWords } from '../export-copy.js';
import { Check, Hint, Row } from '../parts.jsx';
import { Select } from '../advanced/fields.jsx';
import { DigitalIcon, PrintIcon, VideoIcon, WebIcon } from '../../canvases/canvas-icons.jsx';
import {
  allFoldersLabel,
  bigWords,
  choiceFor,
  choicesFor,
  formatSkipLine,
  groupTitle,
  INCLUDE_ROW,
  kindLabel,
  looseLabel,
  OTHER_ROW,
  orderKinds,
  PROJECT_ZIP_ACTION,
  PROJECT_ZIP_LINE,
  sharedPartsLine,
  WHERE_CLOUD,
  WHERE_THIS_MAC,
} from './batch-model.js';

const KIND_ICON = {
  digital: DigitalIcon,
  fixed: DigitalIcon,
  web: WebIcon,
  print: PrintIcon,
  video: VideoIcon,
};

/** "Release plan, 4 FB event covers, the carousel…" — the first names of what the group holds. */
export function namesLine(boards, { max = 3 } = {}) {
  const names = boards.map((b) => String(b.label ?? b.id).trim()).filter(Boolean);
  if (names.length === 0) return '';
  const head = names.slice(0, max).join(', ');
  return names.length > max ? `${head}…` : head;
}

/** One kind: its icon, title, the names it holds, where it renders, and the format row for it. */
/** Up to three stills of what this kind holds, overlapped (09 ex-batch: the row's thumbnail stack). */
export function stillsOf(pictures, kind, max = 3) {
  return (pictures ?? [])
    .filter((i) => i?.kind === kind && i?.picture?.status === 'ready' && i.picture.url)
    .slice(0, max)
    .map((i) => ({ url: i.picture.url, label: i.label }));
}

function Group({ kind, row, pick, cloud, onPick, boards = [], canvases = 0, stills = [] }) {
  const Icon = KIND_ICON[kind] ?? DigitalIcon;
  const choice = choiceFor(kind, { [kind]: pick });
  // 09: the small note under the value — what the format adds (print: "Bleed + crop marks"), or that a video renders in
  // the cloud; nothing for the ordinary "on this Mac"
  const note = choice.note ?? (kind === 'video' && cloud ? WHERE_CLOUD : null);
  return (
    <div className="ex-group" data-testid={`export-group-${kind}`} data-kind={kind}>
      <span className="ex-grp-ic" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="ex-group-t">
        <strong data-testid={`export-group-${kind}-title`}>
          {groupTitle(kind, row.artboards)}
        </strong>
        <span className="ex-group-s" data-testid={`export-group-${kind}-names`}>
          {canvases > 1 ? `from ${canvases} canvases — ` : ''}
          {namesLine(boards) || (kind === 'video' && cloud ? WHERE_CLOUD : WHERE_THIS_MAC)}
        </span>
      </div>
      {stills.length ? (
        <span
          className="ex-grp-stack"
          data-testid={`export-group-${kind}-stack`}
          aria-hidden="true"
        >
          {stills.map((s) => (
            <img key={s.url} src={s.url} alt="" loading="lazy" draggable={false} />
          ))}
        </span>
      ) : null}
      <span className="ex-grp-v">
        <Select
          label={kindLabel(kind)}
          testid={`export-group-${kind}-format`}
          value={choice.id}
          options={choicesFor(kind).map((c) => [c.id, c.label])}
          onChange={onPick}
        />
        {note ? <small className="ex-grp-note">{note}</small> : null}
      </span>
    </div>
  );
}

/**
 * 09 ex-huge — "Include": which parts of the project a Whole project takes. Two ticks, as the board draws them:
 * the folders ("All 5 folders") and the canvases loose at the top ("test, Test2, ahoj…"). Unticking one is the
 * spec's `exclude`; a part with nothing in it draws no tick.
 */
function IncludeRow({ state, set, counts }) {
  const folderNames = counts?.folderNames ?? [];
  const looseNames = counts?.looseNames ?? [];
  if (!folderNames.length && !looseNames.length) return null;
  const ex = state.exclude ?? {};
  const foldersOn = !(ex.folders?.length > 0);
  const looseOn = ex.loose !== true;
  return (
    <Row k={INCLUDE_ROW} testid="export-row-include">
      <span className="ex-checks ex-checks--row">
        {folderNames.length ? (
          <Check
            checked={foldersOn}
            testid="export-include-folders"
            onChange={(on) => set({ exclude: { ...ex, folders: on ? [] : folderNames } })}
          >
            {allFoldersLabel(counts?.folders ?? folderNames.length)}
          </Check>
        ) : null}
        {looseNames.length ? (
          <Check
            checked={looseOn}
            testid="export-include-loose"
            onChange={(on) => set({ exclude: { ...ex, loose: !on } })}
          >
            {looseLabel(looseNames, counts?.loose ?? looseNames.length)}
          </Check>
        ) : null}
      </span>
    </Row>
  );
}

/**
 * @param state    the sheet's state (`kindPicks`: { [kind]: choiceId })
 * @param set      patch the sheet's state
 * @param est      the server's estimate (`byKind`, `skipped`, `counts`, numbers)
 * @param setFormat  the sheet's format setter (Project ZIP instead)
 */
export function BatchSection({ state, set, est, setFormat, pictures }) {
  const byKind = est?.byKind ?? {};
  const boards = est?.boards ?? [];
  const kinds = orderKinds(Object.keys(byKind));
  const picks = state.kindPicks ?? {};
  const cloud = est?.lane === 'cloud';
  const shared = sharedPartsLine(est?.skipped);
  const unit = formatSkipLine(est?.skipped);
  const big = bigWords(est, { summary: summaryWords(est), hasVideo: kinds.includes('video') });
  return (
    <>
      <div
        className="ex-groups"
        data-testid="export-groups"
        role="group"
        aria-label="Formats by kind"
      >
        {kinds.map((kind) => (
          <Group
            key={kind}
            kind={kind}
            row={byKind[kind]}
            pick={picks[kind]}
            cloud={cloud}
            boards={boards.filter((b) => (b.kind ?? 'digital') === kind)}
            canvases={
              new Set(boards.filter((b) => (b.kind ?? 'digital') === kind).map((b) => b.canvas))
                .size
            }
            stills={stillsOf(pictures, kind)}
            onPick={(id) => set({ kindPicks: { ...picks, [kind]: id } })}
          />
        ))}
      </div>
      {shared ? (
        <Hint icon="eye-off" testid="export-shared-parts">
          {shared}
        </Hint>
      ) : null}
      {unit ? (
        <Hint icon="eye-off" testid="export-format-skipped">
          {unit}
        </Hint>
      ) : null}
      {big ? (
        <Hint icon="download" testid="export-big">
          {big}
        </Hint>
      ) : null}
      {state.scope === 'project' ? (
        <IncludeRow state={state} set={set} counts={est?.canvasCounts} />
      ) : null}
      {state.scope === 'project' ? (
        <Hint
          icon="archive"
          action={PROJECT_ZIP_ACTION}
          onAction={() => setFormat('zip')}
          testid="export-project-zip"
        >
          {PROJECT_ZIP_LINE}
        </Hint>
      ) : null}
    </>
  );
}

/**
 * 09 draws no "Other format" and no "Annotations" row in the batch sheet: each kind's own select is the format
 * choice. The two stay reachable under Advanced, where the sheet's less common knobs live.
 */
export function BatchAdvancedRows({ state, set, other, annotationsOff = false, annotationsNote }) {
  return (
    <div className="ex-adv-extra" data-testid="export-adv-extra">
      <Row k={OTHER_ROW} testid="export-row-other">
        {other}
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
  );
}
