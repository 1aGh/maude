// client/v2/export/advanced/command.jsx — S8.3: Advanced › The same export from a terminal.
//
// Two lines — `maude design export …` and `/design:export …` — that replay the exact export the sheet
// would run (command.js is the one place that writes them; a test feeds each back through the CLI's
// own parser and holds it equal to the spec). Mono lives here, inside the fold, and nowhere else.

import { useEffect, useState } from 'react';
import { COMMAND_COPIED, COMMAND_COPY, COMMAND_NOTE, COMMAND_TITLE } from './advanced-copy.js';
import { commandLines } from './command.js';

export function CommandPart({ spec }) {
  const lines = commandLines(spec);
  const [copied, setCopied] = useState(null);
  const key = lines[0]?.text ?? '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed export un-copies the line
  useEffect(() => setCopied(null), [key]);
  // V2-8.9 attacker L1: a name the line refuses to carry (command.js `shellQuote`) prints no line
  if (!lines.length) return null;
  const copy = (line) => {
    Promise.resolve(navigator.clipboard?.writeText(line.text)).catch(() => {});
    setCopied(line.id);
  };
  return (
    <section
      className="ex-advp ex-names"
      data-testid="export-adv-command"
      aria-label={COMMAND_TITLE}
    >
      <p className="ex-advp-h">{COMMAND_TITLE}</p>
      {lines.map((line) => (
        <div className="ex-cmd" key={line.id}>
          <code className="ex-mono ex-cmd-t" data-testid={`export-adv-cmd-${line.id}`}>
            {line.text}
          </code>
          <span className="ex-cmd-a">
            <span className="ex-advp-n">{COMMAND_NOTE[line.id]}</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid={`export-adv-copy-${line.id}`}
              onClick={() => copy(line)}
            >
              {copied === line.id ? COMMAND_COPIED : COMMAND_COPY}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
