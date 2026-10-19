// client/v2/export/sections/batch.jsx — S8.3: many artboards at once (09 ex-batch-pick · ex-batch · ex-huge).
//
// Five artboards of two kinds, a folder, the whole project: one sheet, one button. The estimate says
// which kinds the spec reaches and each kind is a group with its OWN format row and its OWN default —
// a pick on one never moves another. Shared-parts canvases are left out BY NAME, and a big export says
// it is big (counts, size, time) and what the window may do next.

import { ANNOTATIONS_LABEL, ANNOTATIONS_SUB, summaryWords } from '../export-copy.js';
import { Check, Hint, Row } from '../parts.jsx';
import { Select } from '../advanced/fields.jsx';
import {
  bigWords,
  choiceFor,
  choicesFor,
  formatSkipLine,
  groupTitle,
  kindLabel,
  orderKinds,
  OTHER_ROW,
  PROJECT_ZIP_ACTION,
  PROJECT_ZIP_LINE,
  sharedPartsLine,
  WHERE_CLOUD,
  WHERE_THIS_MAC,
} from './batch-model.js';

/** One kind: its title, where it renders, and the format row for it. */
function Group({ kind, row, pick, cloud, onPick }) {
  const choice = choiceFor(kind, { [kind]: pick });
  const where = kind === 'video' ? (cloud ? WHERE_CLOUD : WHERE_THIS_MAC) : WHERE_THIS_MAC;
  return (
    <div className="ex-group" data-testid={`export-group-${kind}`} data-kind={kind}>
      <div className="ex-group-t">
        <strong data-testid={`export-group-${kind}-title`}>
          {groupTitle(kind, row.artboards)}
        </strong>
        <span className="ex-group-s">
          {where}
          {choice.note ? ` · ${choice.note}` : ''}
        </span>
      </div>
      <Select
        label={kindLabel(kind)}
        testid={`export-group-${kind}-format`}
        value={choice.id}
        options={choicesFor(kind).map((c) => [c.id, c.label])}
        onChange={onPick}
      />
    </div>
  );
}

/**
 * @param state    the sheet's state (`kindPicks`: { [kind]: choiceId })
 * @param set      patch the sheet's state
 * @param est      the server's estimate (`byKind`, `skipped`, `counts`, numbers)
 * @param other    the "Other…" button node (the sheet owns that menu)
 * @param setFormat  the sheet's format setter (Project ZIP instead)
 */
export function BatchSection({
  state,
  set,
  est,
  other,
  annotationsOff = false,
  annotationsNote,
  setFormat,
}) {
  const byKind = est?.byKind ?? {};
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
        <Hint
          icon="archive"
          action={PROJECT_ZIP_ACTION}
          onAction={() => setFormat('zip')}
          testid="export-project-zip"
        >
          {PROJECT_ZIP_LINE}
        </Hint>
      ) : null}
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
    </>
  );
}
