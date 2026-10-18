// client/v2/ai/use-chat-runs.js — S5.9: this chat's run, live. The ACP socket pushes a `{t:'run'}` frame
// every time a run of the chat changes (conn.onRun, S5.6); a snapshot from `GET /_api/ai/runs` fills the
// gap for a panel that opened after the run started, and closes a run whose last frame was missed.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchChatRuns } from './run-api.js';
import { emptyRuns, latestRun, reduceRuns, seedRuns } from './run-model.js';

export function useChatRuns(conn, chatId) {
  const [state, setState] = useState(emptyRuns);

  useEffect(
    () => conn?.onRun?.((run) => setState((s) => reduceRuns(s, { t: 'run', run }))),
    [conn]
  );

  const refresh = useCallback(() => {
    let live = true;
    fetchChatRuns(chatId).then((runs) => {
      if (live && runs.length) setState((s) => seedRuns(s, runs));
    });
    return () => {
      live = false;
    };
  }, [chatId]);

  useEffect(() => refresh(), [refresh]);

  const run = useMemo(() => latestRun(state), [state]);
  return { run, refresh };
}
