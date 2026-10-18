// client/v2/sync-states/back-online.jsx — S9.24: reconnecting is quiet (10 · co-sync-back).
//
// One toast, said once per reconnect: "Back online. Your changes are going up." It names the sticky
// that needs a look ONLY when a conflict is actually waiting on this Mac (`GET /_api/sync/conflicts`),
// and only then carries Show (which opens the conflict card). The conflict may arrive a moment after
// the reconnect — the replay of the outbox is what learns of it — so the toast is re-said, same id,
// when the count goes from none to some while the reconnect is still fresh.

import { useEffect, useRef } from 'react';
import { dismissNotice, notify } from '../../../notifications.tsx';
import { backOnlineToast, cameBackOnline } from './sync-states-model.js';

export const BACK_ONLINE_ID = 'sync-back-online';
/** How long after a reconnect a late-arriving conflict still updates the toast. */
const FRESH_MS = 30_000;

/**
 * @param {{ kind: string, conflicts: number, onShow: () => void, now?: () => number }} o
 */
export function useBackOnline({ kind, conflicts, onShow, now = Date.now }) {
  const s = useRef({ prev: kind, at: 0, said: -1 });
  const show = useRef(onShow);
  show.current = onShow;

  useEffect(() => {
    const st = s.current;
    const say = (n) => {
      const t = backOnlineToast({ conflicts: n });
      st.said = n;
      notify({
        id: BACK_ONLINE_ID,
        title: t.title,
        kind: 'info',
        timerKey: `back-online-${st.at}-${n > 0 ? 'look' : 'quiet'}`,
        ...(t.action
          ? {
              action: {
                label: t.action,
                onClick: () => {
                  dismissNotice(BACK_ONLINE_ID);
                  show.current?.();
                },
              },
            }
          : {}),
      });
    };
    if (cameBackOnline(st.prev, kind)) {
      st.at = now();
      say(conflicts);
    } else if (st.at && conflicts > 0 && st.said === 0 && now() - st.at < FRESH_MS) {
      say(conflicts);
    }
    st.prev = kind;
  }, [kind, conflicts, now]);
}
