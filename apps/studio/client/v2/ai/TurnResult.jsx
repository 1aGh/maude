// client/v2/ai/TurnResult.jsx — P8 c10 (03 `ai-long`, `ai-long-pinned`): an OLDER turn keeps its result.
//
// RunSurface (S5.9) draws the card for the chat's latest run at the foot of the feed. The board draws the same card
// under every earlier reply that changed the canvas — Before / After, Undo · Compare, "What AI did · N steps · T" —
// so a long chat reads as a record of what was done, not only of what was said. This file is that card under an
// earlier reply: ChatPanel hands the chat's runs down through `ChatMediaContext` (`chatRuns`); `TurnResult` finds the run of ITS turn by time
// (run-model.js `turnRunFor`) and draws the same ResultCard, minus "Keep going" and the follow-up chips (a
// finished turn has nothing to resume; the follow-ups belong to the newest one).

import { useMessage, useThread } from '@assistant-ui/react';
import { useCallback, useMemo, useState } from 'react';
import { compareStore } from '../history/compare-store.js';
import { viewingWords } from '../history/use-versions.js';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { ResultCard } from './Result.jsx';
import { compareView } from './run-compare.js';
import { redoRun, undoNote, undoRun } from './run-api.js';
import {
  changedSomething,
  partSteps,
  foldedSteps,
  stepsSummary,
  turnCardVerbs,
  turnRunFor,
} from './run-model.js';
import { useRunVersions } from './use-run-versions.js';

const stampOf = (m) => (m.createdAt instanceof Date ? m.createdAt.getTime() : null);

/**
 * The run of the assistant message this hook is called in: the one its ask started, when a LATER ask exists (the
 * newest turn is RunSurface's). null = none (no registry, no time, an answer, or the newest turn).
 */
export function useTurnRun(ctx) {
  const id = useMessage((m) => m.id);
  // a string selector: re-rendered only when the thread's ids, roles or ask times change
  const key = useThread((t) => JSON.stringify(t.messages.map((m) => [m.id, m.role, stampOf(m)])));
  return useMemo(() => {
    if (!ctx?.runs?.length) return null;
    const list = JSON.parse(key);
    const at = list.findIndex((m) => m[0] === id);
    if (at < 0) return null;
    let ask = null;
    for (let i = at - 1; i >= 0; i -= 1) {
      if (list[i][1] === 'user') {
        ask = list[i];
        break;
      }
    }
    const next = list.slice(at + 1).find((m) => m[1] === 'user');
    if (!ask || !next) return null;
    const run = turnRunFor(ctx.runs, ask[2], next[2]);
    return run && run.runId !== ctx.latestId ? run : null;
  }, [ctx, key, id]);
}

/** The card under an earlier reply. `run` from `useTurnRun`, `parts` the reply's own content. */
export function TurnResult({ run, parts, designRel = '.design' }) {
  const versions = useRunVersions(run, designRel);
  const view = useMemo(() => compareView(versions ?? { after: null, before: null }), [versions]);
  const verbs = useMemo(() => turnCardVerbs(run, { canCompare: view.canCompare }), [run, view]);
  const folded = useMemo(() => foldedSteps(partSteps(parts)), [parts]);
  const [ui, setUi] = useState({ status: 'idle', note: '' });

  const onVerb = useCallback(
    async (verb) => {
      if (verb === 'Undo' || verb === 'Redo') {
        const undoing = verb === 'Undo';
        setUi({ status: 'busy', note: '' });
        const out = await (undoing ? undoRun : redoRun)(run, { designRel });
        if (out.ok) setUi({ status: undoing ? 'undone' : 'idle', note: '' });
        else setUi({ status: undoing ? 'idle' : 'undone', note: undoNote(out.reason, out.line) });
        return;
      }
      if (verb === 'Compare') {
        const before = versions?.before;
        if (!before || !versions?.path) return;
        const words = viewingWords(before);
        shellMode.view(words);
        compareStore.start({ path: versions.path, a: words });
        return;
      }
      if (verb === 'Keep the copy') setUi({ status: 'kept', note: '' });
    },
    [run, designRel, versions]
  );

  if (!changedSomething(run) || !(verbs.length || folded.length)) return null;
  return (
    <div className="ai-turn-result" data-testid="ai-turn-result" data-run={run.runId}>
      <ResultCard
        verbs={verbs}
        onVerb={onVerb}
        status={ui.status}
        note={ui.note}
        steps={folded}
        stepsLabel={folded.length ? stepsSummary(folded, run) : ''}
        thumbs={view.thumbs}
      />
    </div>
  );
}
