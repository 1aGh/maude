// client/v2/export/done-toast.jsx — S8.4: the export toast (09 Export ex-states "Done · partly done · ready
// with a problem"). One toast per export, morphing in place as the job moves (running → done), with ONE
// action (`rule/one-verb-per-dialog-one-action-per-toast`):
//   done                Show in Finder  (a browser tab: Download — it has no Finder to show)
//   partly done         Retry <name>    ("Exported 114 of 115")
//   ready with problem  Show in Finder, and the problem in its own line
//   failed / running    Show details / Open Exports  (the row in the panel)
// The words are `toastWords` (exports-model.js), so the toast and the panel row say the same thing.

import { useEffect } from 'react';
import { dismissNotice, notify } from '../../../notifications.tsx';
import { isNativeApp } from '../../github.js';
import { DegradedNote, ProgressBar } from './job-row.jsx';
import { progressPct, toastWords } from './exports-model.js';

const folderOf = (p) =>
  typeof p === 'string' && p ? (p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? null) : null;

function JobNotice({ job, center, say, native }) {
  const saving = center.savingIds.has(job.id);
  const pending = job.status === 'queued' || job.status === 'running';
  const id = `export-${job.id}`;
  const folder = folderOf(center.savedPaths?.get(job.id));
  const w = toastWords(job, { native, folder });

  useEffect(() => {
    const act = () => {
      if (w.action === 'reveal') void center.reveal(job);
      else if (w.action === 'download') void center.download(job);
      else if (w.action === 'retry') void center.retry(job);
      else center.openPanel(job.id);
    };
    say({
      id,
      group: 'exports',
      title: w.title,
      description: w.text,
      kind: w.kind,
      duration: pending ? Infinity : undefined,
      timerKey: pending ? 'active' : `${job.status}:${job.retryable ? 'partial' : 'whole'}`,
      paused: saving,
      onDismiss: () => center.dismissToast(job.id),
      content: (
        <>
          {pending && <ProgressBar pct={progressPct(job)} />}
          {job.status === 'done' && <DegradedNote degraded={job.degraded} compact />}
          <div className="st-toast-actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              data-testid={`export-toast-action-${job.id}`}
              data-action={w.action}
              disabled={saving}
              onClick={act}
            >
              {saving && <span className="st-btn-spin" aria-hidden="true" />}
              {w.label}
            </button>
          </div>
        </>
      ),
    });
  }, [
    id,
    job,
    pending,
    saving,
    w.title,
    w.text,
    w.kind,
    w.label,
    w.action,
    center.dismissToast,
    center.openPanel,
    center.reveal,
    center.download,
    center.retry,
    say,
  ]);
  useEffect(() => () => dismissNotice(id), [id]);
  return null;
}

/** `say` is where the notice goes (the shell's `notify`) and `native` whether this is the Mac app; a test hands its own. */
export function DoneToast({ center, say = notify, native = isNativeApp() }) {
  return center.toastJobs.map((job) => (
    <JobNotice key={job.id} job={job} center={center} say={say} native={native} />
  ));
}
