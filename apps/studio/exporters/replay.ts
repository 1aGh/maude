// replay.ts — the job a history entry re-submits ("Export again"; V2-2.8 D3, V2-2.4b S8 verb).
//
// One rule, two callers that must agree (contract V2-1.11 §5.8 invariant 7): the shell Export
// sheet's Recent row (client/dialogs/export-dialog.jsx `exportAgain`) and `maude design exports
// again <id>` (bin/_exports.mjs). The entry's own options go out verbatim; a (format, scope) pair
// that is not legal — or never was — falls back to that format's default scope, the rule the
// in-canvas dialog's rerunLast() had. test/exports-again-parity.test.tsx holds the two equal.
//
// Leaf: imports only format-scopes.ts.

import { defaultScopeForFormat, isScopeValidForFormat } from './format-scopes.ts';

export interface ReplayJob {
  format: string;
  scope: string;
  options: Record<string, unknown>;
}

export function replayExportJob(entry: {
  format?: unknown;
  scope?: unknown;
  options?: unknown;
}): ReplayJob {
  const format = String(entry?.format || '');
  const scope =
    typeof entry?.scope === 'string' && isScopeValidForFormat(format, entry.scope)
      ? entry.scope
      : defaultScopeForFormat(format);
  // `{ ...(h.options ?? {}) }`, byte for byte what the sheet sends; the server validates options.
  const options = { ...((entry?.options ?? {}) as Record<string, unknown>) };
  return { format, scope, options };
}
