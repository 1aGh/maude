// client/v2/export/advanced/names.jsx — S8.3: Advanced › File names.
//
// One pattern for every file of the export, the tokens as buttons, and a preview that is the SERVER'S
// own naming (`renderStem`, exporters/file-names.ts) run on example names — it changes as you type.

import { useRef } from 'react';
import { NAMES_LABEL, NAMES_PREVIEW, NAMES_TITLE } from './advanced-copy.js';
import { DEFAULT_NAME_TEMPLATE, TOKENS } from './model.js';

/**
 * @param template  the pattern in the box (the default until one is typed)
 * @param samples   example file names (`nameSamples`)
 * @param onChange  (template) => void
 */
export function NamesPart({ template, samples, onChange }) {
  const input = useRef(null);
  const value = template ?? DEFAULT_NAME_TEMPLATE;
  // a token lands where the caret is (else at the end), and the caret goes after it
  const insert = (token) => {
    const el = input.current;
    const at = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? at;
    const next = `${value.slice(0, at)}${token}${value.slice(to)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  return (
    <section className="ex-advp ex-names" data-testid="export-adv-names" aria-label={NAMES_TITLE}>
      <p className="ex-advp-h">{NAMES_TITLE}</p>
      <input
        ref={input}
        type="text"
        className="ex-field ex-field--wide ex-mono"
        aria-label={NAMES_LABEL}
        data-testid="export-adv-name-template"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => onChange(e.target.value)}
      />
      <span className="ex-tokens">
        {TOKENS.map((t) => (
          <button
            type="button"
            className="btn btn--ghost btn--sm ex-mono"
            key={t}
            data-testid={`export-adv-token-${t.slice(1, -1)}`}
            onClick={() => insert(t)}
          >
            {t}
          </button>
        ))}
      </span>
      <span className="ex-advp-n">{NAMES_PREVIEW}</span>
      <span className="ex-files ex-mono" data-testid="export-adv-name-preview">
        {samples.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </span>
    </section>
  );
}
