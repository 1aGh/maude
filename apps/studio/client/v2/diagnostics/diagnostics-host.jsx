// client/v2/diagnostics/diagnostics-host.jsx — V2-4.7b: mounts the Diagnostics sheet under the shell
// store. It opens when something calls `openDiagnostics(view)` (the menu rows, ⌘K), reads
// `GET /_api/diagnostics` while open, and passes the sheet the pieces the shell already owns.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReadiness } from '../../panels/ReadinessList.jsx';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { OPEN_DIAGNOSTICS_EVENT, takeDiagnosticsRequest } from './diagnostics-bus.js';
import { diagnosticsInfo, menuStatuses } from './diagnostics-model.js';
import DiagnosticsSheet from './diagnostics-sheet.jsx';

export default function DiagnosticsHost({ toast }) {
  const {
    shellCore: {
      activePath,
      cfg,
      gitLifecycle,
      gitStatus,
      groups,
      project,
      setGitLifecycle,
      syncStatus,
      wsConnected,
    },
    gitActions: { gitGetLatest },
  } = useShellStore();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('logs');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const { report, loading, refresh } = useReadiness(open);

  // A request that arrived before this mounted, or one that arrives now.
  useEffect(() => {
    const take = () => {
      const req = takeDiagnosticsRequest();
      if (!req) return;
      setView(req.view);
      setOpen(true);
      if (req.recheck) Promise.resolve().then(() => refresh?.());
    };
    take();
    window.addEventListener(OPEN_DIAGNOSTICS_EVENT, take);
    return () => window.removeEventListener(OPEN_DIAGNOSTICS_EVENT, take);
  }, [refresh]);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/_api/diagnostics');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError('');
    } catch (e) {
      setError(String(e?.message || e));
    }
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const info = useMemo(
    () =>
      diagnosticsInfo(cfg?.cloud ? { ...data, projectFolder: '' } : data, {
        host: globalThis.location?.host ?? '',
      }),
    [data, cfg?.cloud]
  );
  const projectName = cfg?.cloud?.projectName || project;
  const words = useMemo(
    () =>
      menuStatuses({
        syncStatus,
        project: projectName,
        wsConnected,
        report,
        unreachable: !!error && !data,
        info,
      }),
    [syncStatus, projectName, wsConnected, report, error, data, info]
  );

  const onCopy = useCallback(
    async (text, label) => {
      try {
        await navigator.clipboard.writeText(text);
        toast?.(`${label} copied.`);
      } catch {
        toast?.(`Couldn’t copy the ${String(label).toLowerCase()}.`);
      }
    },
    [toast]
  );
  const onCopyReport = useCallback(async () => {
    try {
      const r = await fetch('/_api/diagnostics/report');
      if (!r.ok) throw new Error(String(r.status));
      await navigator.clipboard.writeText(await r.text());
      toast?.('Diagnostic report copied.');
    } catch {
      toast?.('Couldn’t copy the diagnostic report.');
    }
  }, [toast]);

  if (!open) return null;
  return (
    <DiagnosticsSheet
      view={view}
      onView={setView}
      onClose={() => setOpen(false)}
      words={{
        logs: null,
        server: words['diag.server'],
        ai: words['diag.ai'],
        sync: words['diag.sync'],
      }}
      data={data}
      error={error}
      onRefresh={load}
      onCopyReport={onCopyReport}
      onCopy={onCopy}
      info={info}
      wsConnected={wsConnected}
      activePath={activePath === SYSTEM_TAB ? null : activePath}
      isSystem={activePath === SYSTEM_TAB}
      repoChanged={
        gitLifecycle
          ? {
              reload: () => {
                try {
                  window.location.reload();
                } catch {}
              },
              dismiss: () => setGitLifecycle(null),
            }
          : null
      }
      ai={{ report, loading, recheck: refresh }}
      sync={{
        status: syncStatus,
        word: words['diag.sync'],
        project: projectName,
        cloud: cfg?.cloud ?? null,
        groupPaths: (groups || []).map((g) => g.path).filter(Boolean),
        behind: gitStatus?.behind || 0,
        onGetLatest: gitGetLatest,
        onCopy,
      }}
    />
  );
}
