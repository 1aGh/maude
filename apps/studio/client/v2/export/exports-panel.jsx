// client/v2/export/exports-panel.jsx — S8.4: the Exports panel (09 Export ex-history).
//
// The last 20 exports, newest first and grouped by day, under the Share cluster's Exports icon. Every
// row says where it runs and what it is doing; a finished one opens its folder or exports again; one
// that did not fully make it says "Exported 114 of 115" and retries just that item. Nothing to show
// uses the empty kit (es-panels-make.exports-none) — the same voice as every other empty place.
//
// Not a modal: the canvas behind stays live, Esc or the fold button closes it, and the icon toggles it
// (`view.exports`). `center` is `useExportCenter()` (client/export-center.jsx).

import { useEffect, useMemo } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { copy, Empty } from '../empty/index.js';
import { isNativeApp } from '../../github.js';
import { openExport } from './use-export-spec.js';
import { shellToast } from '../../shell/util.js';
import { JobRow } from './job-row.jsx';
import { useCoverOf } from '../ds/use-covers.js';
import {
  FOLD_LABEL,
  jobCanvasRel,
  jobFileNames,
  OPEN_FOLDER,
  PANEL_FOOT,
  PANEL_TITLE,
  panelGroups,
  RUNNING_FOOT,
} from './exports-model.js';

const EMPTY_ID = 'es-panels-make.exports-none';

export function ExportsPanel({
  center,
  native = isNativeApp(),
  onNewExport = openExport,
  projectName = '', // the shell hands over the open project's name (05 · es-panels-make: "of Studio site")
  coverOf: coverOfProp = null,
}) {
  const { panelOpen, closePanel, selectedJobId } = center;
  useEffect(() => {
    if (!panelOpen) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') closePanel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelOpen, closePanel]);

  const groups = useMemo(() => panelGroups(center.jobs), [center.jobs]);
  const hookCover = useCoverOf({ active: panelOpen });
  const coverOf = coverOfProp ?? hookCover;
  const vars = { project: projectName || center.projectName || 'this project' };
  if (!panelOpen) return null;
  // the folder button opens where the newest finished file landed
  const newest = [...(center.jobs ?? [])]
    .filter((j) => j.status === 'done' && !j.deliveredInBrowser && j.filename)
    .sort((a, b) => String(b.finishedAt || '').localeCompare(String(a.finishedAt || '')))[0];
  const running = (center.jobs ?? []).some((j) => j.status === 'queued' || j.status === 'running');

  const on = {
    reveal: center.reveal,
    download: center.download,
    again: center.again,
    retry: center.retry,
    renderHere: center.renderHere,
    // 09 ex-history — the row menu: the same settings in the sheet, the names on the clipboard, off the list
    againWith: (job) => {
      if (!job?.spec) return;
      center.closePanel();
      onNewExport?.(job.spec);
    },
    copyNames: (job) => {
      const names = jobFileNames(job);
      if (!names.length) return;
      Promise.resolve(globalThis.navigator?.clipboard?.writeText?.(names.join('\n')))
        .then(() =>
          shellToast(names.length === 1 ? 'Copied the file name.' : 'Copied the file names.')
        )
        .catch(() => {});
    },
    remove: (job) => center.removeFromList?.(job),
  };
  return (
    <div
      className="island island--pad ex-panel"
      role="dialog"
      aria-labelledby="st-export-panel-title"
      data-testid="exports-panel"
    >
      <div className="ex-panel-hd">
        <StIcon name="export" size={14} />
        <span id="st-export-panel-title">{PANEL_TITLE}</span>
        {native && newest ? (
          <button
            type="button"
            className="icon-btn k-icon-sm"
            data-testid="exports-panel-folder"
            title={OPEN_FOLDER}
            aria-label={OPEN_FOLDER}
            onClick={() => center.reveal(newest)}
          >
            <StIcon name="folder" size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="icon-btn k-icon-sm"
          data-testid="exports-panel-close"
          title={FOLD_LABEL}
          aria-label={FOLD_LABEL}
          onClick={closePanel}
        >
          <StIcon name="chevron-down" size={14} />
        </button>
      </div>
      <div className="ex-panel-body">
        {groups.length === 0 ? (
          <div data-testid="exports-panel-empty">
            <Empty
              size="panel"
              glyph="export"
              copyId={EMPTY_ID}
              vars={vars}
              actions={
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="exports-panel-new"
                  onClick={() => {
                    center.closePanel();
                    onNewExport?.();
                  }}
                >
                  <StIcon name="export" size={14} />
                  {copy(EMPTY_ID, vars).action}
                </button>
              }
            />
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="ex-panel-day" aria-label={g.label}>
              <p className="island-title ex-panel-t">{g.label}</p>
              {g.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  native={native}
                  selected={job.id === selectedJobId}
                  busy={center.savingIds.has(job.id)}
                  cover={coverOf(jobCanvasRel(job) ?? '')}
                  on={on}
                />
              ))}
            </section>
          ))
        )}
      </div>
      {groups.length > 0 ? (
        <p className="ex-panel-foot">{running ? RUNNING_FOOT : PANEL_FOOT}</p>
      ) : null}
    </div>
  );
}
