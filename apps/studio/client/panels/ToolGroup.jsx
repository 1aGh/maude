// Collapsed consecutive-tool-call summary row (Task C1) — folds a RUN of 2+
// back-to-back tool-call parts into one "Ran N tools" line, expandable to the
// individual ChatToolCards. A single isolated tool call renders as-is (no
// wrapper) so the common case stays exactly as it was.

import { useState } from 'react';

/**
 * Pure grouping fn (exported for tests): `parts` (a message's raw content
 * array, or the continuation tail's parts) → an ordered list of
 * `{ type:'single', part }` | `{ type:'tool-group', parts:[...] }`. Only
 * CONSECUTIVE tool-call parts fold into a group; anything else (text,
 * reasoning) — or a lone tool-call with no neighbor — passes through single.
 */
export function groupToolCalls(parts) {
  const list = Array.isArray(parts) ? parts : [];
  const out = [];
  let i = 0;
  while (i < list.length) {
    const p = list[i];
    if (p?.type === 'tool-call') {
      const run = [];
      let j = i;
      while (j < list.length && list[j]?.type === 'tool-call') {
        run.push(list[j]);
        j++;
      }
      out.push(
        run.length > 1 ? { type: 'tool-group', parts: run } : { type: 'single', part: run[0] }
      );
      i = j;
    } else {
      out.push({ type: 'single', part: p });
      i++;
    }
  }
  return out;
}

/** "Ran N × Write file" when every entry in the run shares one title, else a
 *  short "Ran N tools — A, B, C…" listing the distinct titles seen. */
export function summarizeGroup(parts) {
  const names = parts.map((p) => p.toolName || 'tool');
  const uniq = [...new Set(names)];
  if (uniq.length === 1) return `Ran ${parts.length} × ${uniq[0]}`;
  const shown = uniq.slice(0, 3).join(', ');
  return `Ran ${parts.length} tools — ${shown}${uniq.length > 3 ? '…' : ''}`;
}

export default function ToolGroup({ parts, ToolCard, forceOpen = false, verbose = false }) {
  const [open, setOpen] = useState(forceOpen);
  const allDone = parts.every((p) => p.result !== undefined);
  const anyError = parts.some((p) => p.isError);
  return (
    <details
      className="chat-toolgroup"
      open={forceOpen || open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      data-testid="chat-tool-group"
    >
      <summary className="chat-toolgroup-sum">
        <span
          className={`chat-tool-dot ${allDone ? 'chat-tool-dot--done' : 'chat-tool-dot--run'}`}
        />
        <span>{summarizeGroup(parts)}</span>
        {anyError ? <span className="del"> · error</span> : null}
      </summary>
      <div className="chat-toolgroup-body">
        {parts.map((p, i) => (
          <ToolCard
            key={p.toolCallId || i}
            toolName={p.toolName}
            args={p.args}
            result={p.result}
            isError={p.isError}
            verbose={verbose}
            flat
          />
        ))}
      </div>
    </details>
  );
}
