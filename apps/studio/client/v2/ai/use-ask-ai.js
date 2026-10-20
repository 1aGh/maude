// client/v2/ai/use-ask-ai.js — S10.16c: the composer's side of `askAI(text, { send, origin })`.
//
// The hook always FILLS the composer with the ask (⌘K, the templates and the rest only ever do that). It also
// SENDS — as the person's own message, one run — when the ask names a design-system origin (search-env.js
// ASK_AI_SEND_ORIGINS) with `send: true`: a person pressed Make / Switch / Upgrade / Review, and the brief in the
// composer is what they asked for. Every gate a typed send meets still applies; on a gate the text stays in the
// composer and nothing is sent:
//   unavailable   Claude Code is not connected (the composer would only keep the prompt and open the connect sheet)
//   running       a run is in progress
//   viewer        the Can-view role writes nothing
//   active        this composer's chat is not the one in front (the chats stay mounted, hidden)
//
// It lives here, not in Composer.jsx, for the same reason use-ask-selection.js does: Composer.jsx never calls
// `send` (test/v2-ai-host.test.ts pins it) — the two files here are the doors that do.

import { useEffect, useRef, useState } from 'react';
import { subscribeAskAI } from '../search/search-env.js';

/** @param {{ active: boolean, unavailable: boolean, viewer: boolean, running: boolean }} g */
export function canSendAskAI(g) {
  return !!g && g.active === true && !g.unavailable && !g.viewer && !g.running;
}

/**
 * @param {{ composerRuntime: { setText(t: string): void, send(): void }, active?: boolean,
 *   unavailable?: boolean, viewer?: boolean, running?: boolean }} i
 */
export function useAskAI({
  composerRuntime,
  active = true,
  unavailable = false,
  viewer = false,
  running = false,
}) {
  const gates = useRef({ active, unavailable, viewer, running });
  gates.current = { active, unavailable, viewer, running };
  const [pending, setPending] = useState(0);
  const toSend = useRef(false);

  useEffect(
    () =>
      subscribeAskAI(
        (text, { send }) => {
          composerRuntime.setText(text);
          if (send && canSendAskAI(gates.current)) {
            toSend.current = true;
            setPending((n) => n + 1);
          }
        },
        globalThis,
        { accepts: () => gates.current.active }
      ),
    [composerRuntime]
  );

  // the send waits one render, so the composer holds the text when it goes (and the gates are read again)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pending` is the trigger
  useEffect(() => {
    if (!toSend.current) return;
    toSend.current = false;
    if (canSendAskAI(gates.current)) composerRuntime.send();
  }, [pending, composerRuntime]);
}
