// client/v2/ai/RunSurface.jsx — S5.9: the tail of the AI chat's feed. It says where the chat's run is:
//
//   working   one line — "AI is making it greener" · the step · Stop            (03 `ai-working`)
//   finished  the result card — Undo · Keep going / Compare / Keep the copy,
//             "What AI did · N steps · T" folded, follow-up chips                 (03 `ai-done`)
//
// plus the one polite live region that announces each state of a run once. It replaces v1's ActivityBar
// (the "still working" row), which it covers: a turn in flight OR a running tool OR a live run.
// The run is the registry's (S5.3) via the chat's `{t:'run'}` frames; a server without them still gets
// the working line from the thread itself, and Stop falls back to cancelling the thread.

import { useThread, useThreadRuntime } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { activityLabel } from '../../panels/acp-runtime.js';
import { sendToAskAI } from '../search/search-env.js';
import { focusComposer } from './panel-focus.js';
import { ResultCard } from './Result.jsx';
import { keepGoingRun, redoRun, stopRun, undoNote, undoRun } from './run-api.js';
import {
  createAnnouncer,
  describeResult,
  followUps,
  interruptedText,
  isWorking,
  lastAssistantDigest,
  resultVerbs,
  runCutShort,
  stepsSummary,
  workingText,
} from './run-model.js';
import { RunLiveRegion, useRunClock, WorkingLine } from './Working.jsx';
import { useChatRuns } from './use-chat-runs.js';

const IDLE = { runId: null, status: 'idle', note: '' };
const ANNOUNCE_MAX = 240;

export function RunSurface({ conn, chatId, tools = [], artboards = [], designRel = '.design' }) {
  const { run, refresh } = useChatRuns(conn, chatId);
  const threadRuntime = useThreadRuntime();
  const running = useThread((t) => t.isRunning);
  // A string selector: the digest is rebuilt only when the last reply's words or steps change.
  const digestKey = useThread((t) => JSON.stringify(lastAssistantDigest(t.messages)));
  const digest = useMemo(() => JSON.parse(digestKey), [digestKey]);

  const live = running || tools.length > 0 || isWorking(run);
  const needsYou = run?.state === 'needs-you';
  const showWorking = live && !needsYou;
  const ended = !!run && run.state === 'ended';
  const cutShort = runCutShort(run);
  const verbs = useMemo(() => resultVerbs(run), [run]);
  const showResult = !live && ended && (verbs.length > 0 || cutShort);
  const elapsed = useRunClock(run?.startedAt, showWorking);

  // ── a turn just ended: the registry may have closed its run since the last frame ──
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) refresh();
    wasLive.current = live;
  }, [live, refresh]);

  // ── the live region: each state of a run, once ──
  const announcer = useRef(createAnnouncer());
  const counter = useRef(0);
  const [message, setMessage] = useState(null);
  useEffect(() => {
    if (!run || (run.state === 'ended' && live)) return;
    const sentence = digest.text
      ? digest.text.replace(/\s+/g, ' ').slice(0, ANNOUNCE_MAX)
      : run.outcome === 'done'
        ? describeResult(run, artboards)
        : '';
    const text = announcer.current.next(run, sentence);
    if (text) {
      counter.current += 1;
      setMessage({ id: counter.current, text });
    }
  }, [run, live, digest.text, artboards]);

  // ── Stop ──
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    if (!live) setStopping(false);
  }, [live]);
  const onStop = useCallback(async () => {
    setStopping(true);
    const target = run && run.state !== 'ended' ? run : null;
    const out = target ? await stopRun(target.runId) : { ok: false };
    // No registry run (an older server) or it was already over: the thread is what is working.
    if (!out.ok) threadRuntime.cancelRun();
  }, [run, threadRuntime]);

  // ── the result's verbs ──
  const [ui, setUi] = useState(IDLE);
  const runId = run?.runId ?? null;
  const cur = ui.runId === runId ? ui : IDLE;
  /** The card's state for THIS run; anything not named goes back to idle. */
  const mark = useCallback((next) => setUi({ runId, status: 'idle', note: '', ...next }), [runId]);
  const root = useRef(null);

  const onVerb = useCallback(
    async (verb) => {
      if (!run) return;
      if (verb === 'Undo' || verb === 'Redo') {
        const undoing = verb === 'Undo';
        mark({ status: 'busy' });
        const out = await (undoing ? undoRun : redoRun)(run, { designRel });
        if (out.ok) mark({ status: undoing ? 'undone' : 'idle' });
        else mark({ status: undoing ? 'idle' : 'undone', note: undoNote(out.reason, out.line) });
        return;
      }
      if (verb === 'Keep the copy') {
        mark({ status: 'kept' });
        return;
      }
      if (verb === 'Keep going') {
        if (!cutShort) {
          // A finished run has nothing left to resume: carrying on is the next ask. Focus is the way on.
          focusComposer(root.current?.closest('.ai-island') ?? document);
          return;
        }
        const out = await keepGoingRun(run.runId);
        if (!out.ok) mark({ note: "Couldn't keep going. Try again in a moment." });
      }
    },
    [run, designRel, cutShort, mark]
  );

  const onFollowUp = useCallback((text) => {
    sendToAskAI(text);
    focusComposer(root.current?.closest('.ai-island') ?? document);
  }, []);

  const headline = cutShort
    ? interruptedText(run)
    : digest.text
      ? ''
      : describeResult(run, artboards);

  return (
    <>
      <RunLiveRegion message={message} />
      {showWorking ? (
        <WorkingLine
          text={workingText(run)}
          step={tools.length ? activityLabel(tools) : ''}
          elapsed={elapsed}
          onStop={onStop}
          stopping={stopping}
        />
      ) : null}
      {showResult ? (
        <div ref={root}>
          <ResultCard
            headline={headline}
            verbs={verbs}
            onVerb={onVerb}
            status={cur.status}
            note={cur.note}
            steps={digest.steps}
            stepsLabel={digest.steps.length ? stepsSummary(digest.steps, run) : ''}
            followUps={followUps(run, artboards)}
            onFollowUp={onFollowUp}
          />
        </div>
      ) : null}
    </>
  );
}
