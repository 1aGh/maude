// client/v2/diagnostics/use-diagnostics-menu.js — V2-4.7b: the data behind Menu › Diagnostics' status
// words. Reads what the shell already has (sync payload, live socket), and — only once the menu has been
// opened — the AI-readiness probe and `GET /_api/diagnostics` (pid, version). Nothing polls: the words
// are refreshed each time the menu opens, which is the only time they are read.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReadiness } from '../../panels/ReadinessList.jsx';
import { setDiagnosticsFacts } from './diagnostics-bus.js';
import { diagnosticsInfo, hiddenMenuIds, menuStatuses } from './diagnostics-model.js';

/**
 * @returns `{ state: { status, hidden }, onMenuOpen }` — spread `state` into the menu's state and call
 *   `onMenuOpen()` when the menu opens.
 */
export function useDiagnosticsMenu({ syncStatus, project, wsConnected, cfg, fetchFn } = {}) {
  const [armed, setArmed] = useState(false);
  const { report, refresh } = useReadiness(armed);
  const [info, setInfo] = useState(null);
  const [unreachable, setUnreachable] = useState(false);
  const host = globalThis.location?.host ?? '';
  const cloud = !!cfg?.cloud;

  // The Advanced rows copy these; the address is known without asking the server, the folder only
  // from the guarded `/_api/diagnostics` answer (filled in when the menu opens).
  useEffect(() => {
    setDiagnosticsFacts({ address: host });
  }, [host]);

  const onMenuOpen = useCallback(() => {
    if (armed) refresh();
    else setArmed(true);
    const f = fetchFn ?? globalThis.fetch;
    Promise.resolve()
      .then(() => f('/_api/diagnostics'))
      .then((r) => r.json())
      .then((j) => {
        const next = diagnosticsInfo(cloud ? { ...j, projectFolder: '' } : j, { host });
        setInfo(next);
        setUnreachable(false);
        setDiagnosticsFacts(next);
      })
      .catch(() => setUnreachable(true));
  }, [armed, refresh, host, cloud, fetchFn]);

  const status = useMemo(
    () =>
      menuStatuses({
        syncStatus,
        project,
        wsConnected,
        report,
        unreachable,
        info: info ?? { address: host, folder: '' },
      }),
    [syncStatus, project, wsConnected, report, unreachable, info, host]
  );
  const hidden = useMemo(
    () => hiddenMenuIds({ cloud: cfg?.cloud ?? null, syncStatus }),
    [cfg?.cloud, syncStatus]
  );
  return { state: { status, hidden }, onMenuOpen };
}
