// client/v2/ai/use-run-versions.js — S5.19 G4 (03 `ai-done`, `ai-long`): the run's version and the one before it
// (the versions list), read once a run has ended having changed things. Shared by the chat's latest run
// (RunSurface.jsx) and every older turn's card (TurnResult.jsx).

import { useEffect, useState } from 'react';
import { compareView, fetchRunVersions } from './run-compare.js';

const PICTURE_RETRY_MS = 1500;
const PICTURE_RETRIES = 4;

/** `{ path, after, before }` for an ended run that changed things; null until read (or when there is no list). */
export function useRunVersions(run, designRel) {
  const [state, setState] = useState({ runId: null, versions: null });
  const runId = run?.runId ?? null;
  const wants = !!run && run.state === 'ended' && run.outcome === 'done';
  useEffect(() => {
    if (!wants || !runId) return undefined;
    let cancelled = false;
    let timer = null;
    let tries = 0;
    const read = async () => {
      const v = await fetchRunVersions(run, { designRel });
      if (cancelled) return;
      setState({ runId, versions: v });
      // pictures still being drawn: look again a few times, then settle for Compare alone
      if (v && compareView(v).pending && tries < PICTURE_RETRIES) {
        tries += 1;
        timer = setTimeout(read, PICTURE_RETRY_MS);
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: one read per ended run
  }, [wants, runId, designRel]);
  return state.runId === runId ? state.versions : null;
}
