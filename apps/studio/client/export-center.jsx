// export-center.jsx — background export notification center
// (feature-background-export-notification-center; the surfaces are S8.4's).
//
//   useExportCenter()  → headless handle (hydrate + WS upsert + toast/panel state + the row actions:
//                        reveal / download / again / retry)
//   <ExportToast>       → completion notice (shim → v2/export/done-toast.jsx)
//   <ExportPanel>       → the last 20 exports (shim → v2/export/exports-panel.jsx)
//
// Driven by live WS `export:job` pushes (via `upsert`, called from app.jsx's WS message handler).
// The entry point is the Share cluster's Exports icon (v2/shell/share-cluster.jsx).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultScopeForFormat, isScopeValidForFormat } from '../exporters/format-scopes.ts';
import { notify } from '../notifications.tsx';
import { nativeSave } from './v2/export/native-save.js';
import { replayBody } from './v2/export/run-export.js';
import { retryItems } from './v2/export/exports-model.js';
import { isNativeApp } from './github.js';

async function fetchJobBytes(id) {
  const r = await fetch(`/_api/export-jobs/download?id=${encodeURIComponent(id)}`);
  if (!r.ok) return null;
  const disp = r.headers.get('Content-Disposition') || '';
  const filename = /filename="([^"]+)"/.exec(disp)?.[1] || null;
  const blob = await r.blob();
  return { blob, filename };
}

async function autoDownloadBlob(id, fallbackName) {
  const got = await fetchJobBytes(id);
  if (!got) return;
  const filename = got.filename || fallbackName || 'export';
  const url = URL.createObjectURL(got.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param {{ enabled?: boolean }} [opts] — `enabled` false suppresses the
 *   hydration fetch. The cloud shell passes false: `/_api/export-jobs` is
 *   refused there by design, so asking is guaranteed noise. It stays UNDEFINED
 *   until `/_config` answers, and undefined is not "false" here — see the
 *   tri-state note on `cfg.cloud`.
 */
export function useExportCenter({ enabled = true } = {}) {
  const [jobs, setJobs] = useState(() => new Map());
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [toastQueue, setToastQueue] = useState([]);
  const [savingIds, setSavingIds] = useState(() => new Set());
  const prevStatusRef = useRef(new Map());
  // Dedup guards (not state — re-rendering on these changing would be
  // pointless; they only gate one-shot side effects).
  const finalizedRef = useRef(new Set()); // auto-download fires at most once per job
  const startToastShownRef = useRef(new Set()); // "Exporting…" toast fires at most once per job
  const hydratedRef = useRef(new Set()); // seen at load: a snapshot, never a live finish
  const autoSavedRef = useRef(new Set()); // a spec with its own Save to saves at most once per run
  // job id → the path this Mac saved it to (Show in Finder reveals only what was saved this run)
  const [savedPaths, setSavedPaths] = useState(() => new Map());

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    fetch('/_api/export-jobs')
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        const m = new Map();
        for (const job of Array.isArray(j?.jobs) ? j.jobs : []) {
          m.set(job.id, job);
          // Hydration is a SNAPSHOT, not a live transition — seed both guards
          // so a page (re)load never replays a toast / auto-download for a
          // job that already reached this status before we opened.
          prevStatusRef.current.set(job.id, job.status);
          startToastShownRef.current.add(job.id);
          hydratedRef.current.add(job.id);
        }
        setJobs(m);
      })
      .catch(() => {
        /* offline / restart — the badge just stays empty until a push arrives */
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  const upsert = useCallback((job) => {
    if (!job || typeof job.id !== 'string') return;
    setJobs((prev) => {
      const next = new Map(prev);
      next.set(job.id, job);
      return next;
    });
  }, []);

  // One toast per job, morphing in place as the job's live status changes
  // (queued/running → done/failed) rather than stacking a separate "started"
  // and "finished" toast. Detects two kinds of transitions:
  //   - first time a job is seen active (queued/running) → surfaces it so the
  //     user knows it's running in the background right after the dialog closes.
  //   - a done/failed transition → surfaces it (or refreshes it in place if
  //     it's still the front-of-queue toast from the "started" step above).
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const toSurface = [];
    const justFinished = [];
    // Single pass — read `was` for every job BEFORE prevStatus gets mutated
    // below, so both the toast + auto-download decisions see the real
    // "did this change just now" transition, not an already-updated ref.
    for (const job of jobs.values()) {
      const was = prevStatus.get(job.id);
      const isActive = job.status === 'queued' || job.status === 'running';
      const isFinished = job.status === 'done' || job.status === 'failed';
      if (was === undefined && isActive && !startToastShownRef.current.has(job.id)) {
        startToastShownRef.current.add(job.id);
        toSurface.push(job.id);
      } else if (was !== job.status && isFinished) {
        toSurface.push(job.id);
        justFinished.push(job);
      }
    }
    for (const job of jobs.values()) prevStatus.set(job.id, job.status);

    if (toSurface.length) {
      setToastQueue((q) => {
        const merged = q.filter((id) => !toSurface.includes(id));
        return [...toSurface, ...merged];
      });
    }

    // Native (Tauri) never auto-pops the OS save dialog — it would interrupt
    // whatever the user is doing elsewhere. A spec that names where to save (the effect below) saves
    // itself; otherwise Show in Finder asks, once.
    if (isNativeApp() || !justFinished.length) return;
    for (const job of justFinished) {
      if (job.status !== 'done') continue;
      if (finalizedRef.current.has(job.id)) continue;
      // Focus-gated: avoids duplicate downloads when multiple tabs share one
      // dev-server and both receive the same WS push.
      if (!document.hasFocus()) continue;
      finalizedRef.current.add(job.id);
      void autoDownloadBlob(job.id, job.filename);
    }
  }, [jobs]);

  const list = useMemo(
    () =>
      Array.from(jobs.values()).sort((a, b) =>
        (b.createdAt || '').localeCompare(a.createdAt || '')
      ),
    [jobs]
  );
  const runningCount = list.filter((j) => j.status === 'running').length;
  const queuedCount = list.filter((j) => j.status === 'queued').length;

  const dismissToast = useCallback(
    (id) => setToastQueue((q) => q.filter((item) => item !== (id ?? q[0]))),
    []
  );
  const openPanel = useCallback((jobId) => {
    setSelectedJobId(typeof jobId === 'string' ? jobId : null);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const withSaving = useCallback(async (job, fn) => {
    setSavingIds((prev) => new Set(prev).add(job.id));
    try {
      return await fn();
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  }, []);

  const fail = useCallback((job, title, message) => {
    notify({
      id: `export-error-${job.id}`,
      group: 'exports',
      kind: 'error',
      title,
      description: message,
    });
  }, []);

  // Manual "Download" (web, unfocused-tab fallback) — the toast/panel row action in a browser. It
  // marks the job finalized so the focus-gated auto-download effect above doesn't ALSO fire for it
  // later, and tracks a busy state (`savingIds`) so the button shows it's working instead of going
  // silent while the bytes fetch.
  const download = useCallback(
    async (job) => {
      finalizedRef.current.add(job.id);
      await withSaving(job, () => autoDownloadBlob(job.id, job.filename));
    },
    [withSaving]
  );
  // Save the job's file on this Mac (the Mac app): where `spec.options.saveTo` says, else it asks
  // once. The bytes never pass through this page (S8.23, native-save.js). Remembers the path so
  // Show in Finder can reveal it.
  const save = useCallback(
    async (job) => {
      finalizedRef.current.add(job.id);
      return withSaving(job, async () => {
        const r = await nativeSave().save({
          jobId: job.id,
          filename: job.filename,
          saveTo: job.spec?.options?.saveTo,
        });
        if (r.ok && r.path) setSavedPaths((prev) => new Map(prev).set(job.id, r.path));
        else if (!r.ok && r.reason === 'refused')
          fail(job, "Couldn't save the export", r.error || 'Try again.');
        return r;
      });
    },
    [withSaving, fail]
  );
  // Show in Finder: reveal the saved file, saving it first when this run has not (one ask, then it
  // is remembered). A browser tab has no Finder; its rows download instead.
  const reveal = useCallback(
    async (job) => {
      let path = savedPaths.get(job.id);
      if (!path) {
        const saved = await save(job);
        if (!saved?.ok || !saved.path) return;
        path = saved.path;
      }
      const r = await withSaving(job, () => nativeSave().reveal(path));
      if (!r.ok && r.reason === 'refused')
        fail(job, "Couldn't show the file", r.error || "Maude didn't save that file.");
    },
    [savedPaths, save, withSaving, fail]
  );
  // Export again: the same spec (a v2 job) or the same v1 job, as the sheet's Recent row sends it.
  const again = useCallback(
    async (job) => {
      const body = replayBody(job, { isScopeValidForFormat, defaultScopeForFormat });
      try {
        const r = await fetch('/_api/export-jobs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) fail(job, "Couldn't export again", (await r.text()) || `Refused (${r.status})`);
      } catch (err) {
        fail(job, "Couldn't export again", err?.message || String(err));
      }
    },
    [fail]
  );
  // Retry: run again only the items that did not make it (POST /_api/export-jobs/retry). The job goes
  // back to running and its row and file update in place.
  const retry = useCallback(
    async (job) => {
      finalizedRef.current.delete(job.id);
      autoSavedRef.current.delete(job.id);
      try {
        const r = await fetch('/_api/export-jobs/retry', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: job.id, items: retryItems(job) }),
        });
        if (!r.ok)
          fail(
            job,
            "Couldn't retry",
            r.status === 404 || r.status === 409
              ? 'That export is no longer here. Export it again.'
              : (await r.text()) || `Refused (${r.status})`
          );
      } catch (err) {
        fail(job, "Couldn't retry", err?.message || String(err));
      }
    },
    [fail]
  );

  // A spec that names where to save (Downloads, or the remembered folder) saves itself on this Mac the
  // moment it is done — no dialog. Any other waits for Show in Finder, which asks once.
  useEffect(() => {
    if (!isNativeApp()) return;
    for (const job of jobs.values()) {
      if (job.status !== 'done' || !job.filename || job.deliveredInBrowser) continue;
      const to = job.spec?.options?.saveTo;
      if (to !== 'downloads' && to !== 'remembered') continue;
      if (hydratedRef.current.has(job.id) || autoSavedRef.current.has(job.id)) continue;
      if (finalizedRef.current.has(job.id) || !document.hasFocus()) continue;
      autoSavedRef.current.add(job.id);
      void save(job);
    }
  }, [jobs, save]);

  const toastJobId = panelOpen ? null : (toastQueue[0] ?? null);

  return {
    jobs: list,
    upsert,
    runningCount,
    queuedCount,
    busyCount: runningCount + queuedCount,
    panelOpen,
    selectedJobId,
    toastJobs: toastQueue.map((id) => jobs.get(id)).filter(Boolean),
    openPanel,
    closePanel,
    showToast: !!toastJobId,
    toastJob: toastJobId ? (jobs.get(toastJobId) ?? null) : null,
    dismissToast,
    download,
    save,
    reveal,
    again,
    retry,
    savedPaths,
    savingIds,
  };
}

// The surfaces moved to client/v2/export/ (S8.4). These two names stay so app.jsx — which mounts
// `<ExportToast center>` and `<ExportPanel center>` — and the v1 tests keep working.
export { DoneToast as ExportToast } from './v2/export/done-toast.jsx';
export { ExportsPanel as ExportPanel } from './v2/export/exports-panel.jsx';
