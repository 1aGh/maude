// client/v2/ds/convert-host.jsx — S10.12: the shell's side of "Convert system folders". It answers `ds.convert` (the
// banner on today's folder view, the registry row) through DS_CONVERT_EVENT, reads the server's dry run, draws the
// dialog and does the one write. Mounted next to the other design-system hosts (review-host.jsx). The server judges
// the role and re-plans under its locks: what the dialog showed is what it converts, or it refuses and says why.

import { useCallback, useEffect, useState } from 'react';
import { DsConvertDialog } from './convert-dialog.jsx';
import {
  CONVERT_WORDS,
  convertSystems,
  DS_CONVERT_EVENT,
  dialogModel,
  fetchConvertPlan,
} from './convert-model.js';

export function DsConvertHost({ toast, fetchImpl, target = globalThis.window }) {
  const [model, setModel] = useState(null);
  const f = useCallback(() => ({ fetchImpl: fetchImpl ?? globalThis.fetch }), [fetchImpl]);
  const say = useCallback((m, ok = true) => toast?.(m, ok), [toast]);

  useEffect(() => {
    if (!target?.addEventListener) return undefined;
    const on = async (ev) => {
      ev.preventDefault();
      const r = await fetchConvertPlan(null, f());
      if (!r.ok) return say(r.message, false);
      const m = dialogModel(r.body);
      if (!m.rows.length) return say(CONVERT_WORDS.nothing);
      setModel(m);
    };
    target.addEventListener(DS_CONVERT_EVENT, on);
    return () => target.removeEventListener(DS_CONVERT_EVENT, on);
  }, [target, f, say]);

  if (!model) return null;
  return (
    <DsConvertDialog
      model={model}
      onClose={() => setModel(null)}
      onConvert={async () => {
        const r = await convertSystems(
          model.rows.map((x) => x.name),
          f()
        );
        if (!r.ok) return r;
        say(r.message);
        setModel(null);
        return { ok: true };
      }}
    />
  );
}
