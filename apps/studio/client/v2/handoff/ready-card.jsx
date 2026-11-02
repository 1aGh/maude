// client/v2/handoff/ready-card.jsx — S8.10 (09 ex-handoff-ready): Ready means ONE thing to copy.
// The web result is one command; the app and the animation give code. Advanced keeps the file on
// this Mac, the Claude Code command and the terminal verb — today's /design:handoff, /design:to-rn and
// /design:to-lottie, unchanged. Mono lives only inside Advanced.

import { useState } from 'react';
import { ADVANCED_COUNT, readyBody, readyTitle } from './targets.js';

async function copyText(text) {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ kind: string, name: string, ready: { copyLabel: string, copy: string|null, writes: string|null,
 *   snippet: string|null, lines: Array<{note: string, text: string}> }, content?: string|null }} props
 */
export function ReadyCard({ kind, name, ready, content = null }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const value = ready.copy ?? content ?? '';
  const anyMachine = ready.lines.some((l) => l.note === 'Any machine');
  return (
    <div className="ho-ready" data-testid="handoff-ready" data-kind={kind}>
      <p className="ho-ready-t">{readyTitle(kind, name)}</p>
      <p className="ho-ready-d">{readyBody(kind, { anyMachine })}</p>
      <span className="ho-ready-a">
        <button
          type="button"
          className="btn btn--sm btn--primary"
          data-testid="handoff-ready-copy"
          disabled={!value}
          onClick={async () => setCopied(await copyText(value))}
        >
          {copied ? 'Copied' : ready.copyLabel}
        </button>
      </span>
      <div className="k-adv ho-adv" data-open={open ? 'true' : 'false'}>
        <button
          type="button"
          className="k-adv-btn"
          aria-expanded={open}
          data-testid="handoff-ready-advanced"
          onClick={() => setOpen((v) => !v)}
        >
          Advanced<span className="k-adv-count">{ADVANCED_COUNT[kind] ?? ''}</span>
        </button>
        {open ? (
          <div className="ho-adv-body">
            {ready.writes ? (
              <span className="ho-kv">
                <span>Writes</span>
                <span className="k-mono">{ready.writes}</span>
              </span>
            ) : null}
            {ready.snippet ? <pre className="k-mono ho-pre">{ready.snippet}</pre> : null}
            {ready.lines.map((l, i) => (
              <span
                className="ho-cmd"
                key={`${l.note}-${i}`}
                data-testid={`handoff-ready-line-${i}`}
              >
                <span className="ho-cmd-n">{l.note}</span>
                <code className="k-mono">{l.text}</code>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label={`Copy: ${l.note}`}
                  onClick={() => copyText(l.text)}
                >
                  Copy
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
