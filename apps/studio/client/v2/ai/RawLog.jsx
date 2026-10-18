// client/v2/ai/RawLog.jsx — S5.12 (03 `ai-advanced`): the raw tool log, an island under Advanced.
//
// "Nothing removed, only hidden": the default feed says what AI did in plain words; the Raw log is the
// agent's own account — one mono line per tool call (Read · Edit · Bash …), in order. It is DERIVED from the
// thread's messages (advanced-model.js `rawLogLines`), so it costs nothing until the island is open and is
// never a second copy of the chat.

import { useThread } from '@assistant-ui/react';
import { useState } from 'react';
import { rawLogLines, rawLogText } from './advanced-model.js';

/** The island over a computed log. Pure view — `ConnectedRawLog` feeds it the live thread. */
export function RawLog({ chatTitle = '', log, onCopy }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = rawLogText(log);
    try {
      await (onCopy ? onCopy(text) : navigator.clipboard?.writeText(text));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the clipboard may be unavailable; the log is still on screen */
    }
  };
  return (
    <section className="ai-log" aria-label="Raw log" data-testid="ai-raw-log" tabIndex={-1}>
      <p className="ai-log-t">
        <span>Raw log</span>
        {chatTitle ? <span className="ai-log-chat">{chatTitle}</span> : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={copy}
          disabled={!log.total}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </p>
      {log.total === 0 ? (
        <p className="ai-log-empty">Nothing yet. Tool calls show here as AI makes them.</p>
      ) : (
        <div className="ai-log-lines" role="log" aria-live="off">
          {log.truncated ? (
            <span className="ai-log-note">
              The first {log.total - log.lines.length} calls are not shown.
            </span>
          ) : null}
          {log.lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
            <span key={i} className={`ai-log-line ai-log-line--${l.state}`}>
              <b>{l.verb}</b>
              {l.text ? ` ${l.text}` : ''}
              {l.state === 'failed' ? <em className="ai-log-bad"> failed</em> : null}
              {l.state === 'running' ? <em className="ai-log-run"> running…</em> : null}
            </span>
          ))}
          <span className="ai-log-sum">{log.summary}</span>
        </div>
      )}
    </section>
  );
}

/** The island over the thread it sits in (needs the assistant-ui provider — mounted only while open). */
export function ConnectedRawLog({ chatTitle }) {
  const messages = useThread((t) => t.messages);
  return <RawLog chatTitle={chatTitle} log={rawLogLines(messages)} />;
}
