// client/v2/ai/BackgroundStrip.jsx — issue #177: "Running in the background".
//
// AI can leave work running after its reply ends: subagents it launched, a command left running. The
// strip sits between the conversation and the composer and says what is still running, one line per
// task with its time, so a quiet stretch never reads as "nothing is happening":
//
//   one task    ● Review the Pricing canvas · Agent                 0:42
//   several     ● 3 agents working                           1:12  ▸   (expands to one row each)
//
// A task that ends shows "Finished" for a few seconds (background-model.js KEEP_FINISHED_MS), then goes;
// the strip goes with the last one. The counts are announced politely; the ticking clock never is.

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import {
  kindWord,
  pruneFinished,
  rowElapsed,
  rowLabel,
  runningCount,
  stripElapsed,
  summaryText,
  trackBackground,
} from './background-model.js';

/** The strip's items for a connection: folded from its task snapshots, ticking while there are any. */
export function useBackgroundItems(conn) {
  const [items, setItems] = useState([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!conn?.onBackgroundTasks) return undefined;
    return conn.onBackgroundTasks((tasks) => {
      const at = Date.now();
      setNow(at);
      setItems((prev) => trackBackground(prev, tasks, at));
    });
  }, [conn]);
  const any = items.length > 0;
  useEffect(() => {
    if (!any) return undefined;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setItems((prev) => pruneFinished(prev, at));
    }, 1000);
    return () => clearInterval(id);
  }, [any]);
  return { items, now };
}

function Row({ item, now }) {
  const done = item.state === 'finished';
  const time = rowElapsed(item, now);
  return (
    <li
      className={`ai-bg-row${done ? ' is-done' : ''}`}
      data-testid={`ai-background-row-${item.id}`}
      data-state={item.state}
    >
      <span className="ai-bg-dot" aria-hidden="true" />
      <span className="ai-bg-name">{rowLabel(item)}</span>
      <span className="ai-bg-kind">{done ? 'Finished' : kindWord(item.kind)}</span>
      {time ? <span className="ai-bg-time">{time}</span> : null}
    </li>
  );
}

export function BackgroundStrip({ conn }) {
  const { items, now } = useBackgroundItems(conn);
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const working = runningCount(items) > 0;
  const many = items.length > 1;
  const summary = summaryText(items);
  return (
    <section
      className={`ai-bg${working ? ' is-working' : ''}`}
      data-testid="ai-background"
      data-working={working ? 'true' : 'false'}
      aria-label="Running in the background"
    >
      <div className="ai-sr-only" role="status" aria-live="polite">
        {summary}
      </div>
      {many ? (
        <>
          <button
            type="button"
            className="ai-bg-head"
            data-testid="ai-background-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ai-bg-dot" aria-hidden="true" />
            <span className="ai-bg-name" data-testid="ai-background-summary">
              {summary}
            </span>
            {stripElapsed(items, now) ? (
              <span className="ai-bg-time">{stripElapsed(items, now)}</span>
            ) : null}
            <span className={`ai-bg-chev${open ? ' is-open' : ''}`} aria-hidden="true">
              <StIcon name="chevron-right" size={12} />
            </span>
          </button>
          {open ? (
            <ul className="ai-bg-list" data-testid="ai-background-list">
              {items.map((item) => (
                <Row key={item.id} item={item} now={now} />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <ul className="ai-bg-list ai-bg-list--one" data-testid="ai-background-list">
          <Row item={items[0]} now={now} />
        </ul>
      )}
    </section>
  );
}
