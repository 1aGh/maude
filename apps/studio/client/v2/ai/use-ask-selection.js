// client/v2/ai/use-ask-selection.js — S2.19: the composer's side of ⌘/ on a selection.
//
// The bubble (AskSelectionHost) hands over the person's words and an `elements` scope. This hook takes the scope
// FIRST (so the frozen context and the run's scope are the selection's), then sends through the composer's own
// runtime once the chip has taken it — every gate a typed send meets, one run, one undo step.
//
// It lives here, not in Composer.jsx: the ⌘K "Ask AI" contract is that the composer FILLS and never sends
// (test/v2-ai-host.test.ts pins it), and this is the one door that does — because the person pressed ↵ in the
// bubble, which is the same gesture as ↵ in the field.

import { useEffect, useState } from 'react';
import { subscribeAskSelection } from './ask-selection.js';
import { sameScope } from './scope.js';

/** How long the panel's chip keeps the asked elements after the send (the adapter freezes the context at send). */
export const SCOPE_RESET_MS = 100;

/**
 * @param {{ composerRuntime: { setText(t: string): void, send(): void }, scope: object,
 *   onChooseScope?: (scope: object|null) => void }} i
 */
export function useAskSelection({ composerRuntime, scope, onChooseScope }) {
  const [pending, setPending] = useState(null);
  useEffect(
    () =>
      subscribeAskSelection((d) => {
        onChooseScope?.(d.scope);
        composerRuntime.setText(d.text);
        setPending(d);
      }),
    [composerRuntime, onChooseScope]
  );
  useEffect(() => {
    if (!pending || !sameScope(scope, pending.scope)) return;
    setPending(null);
    composerRuntime.send();
    // The chip then follows the selection again, so the NEXT typed ask in the panel is not silently about
    // these elements. (No cleanup on purpose: `setPending(null)` re-runs this effect at once.)
    setTimeout(() => onChooseScope?.(null), SCOPE_RESET_MS);
  }, [pending, scope, composerRuntime, onChooseScope]);
}
