// ds/rename.ts — P8 round 7: "Rename…" in a system's own menu (13 · ds-multi-menu, registry `ds.rename`).
//
// The name a person reads is the system's `config.json` `designSystems[].label`; its `name` is the id that every
// canvas pin (`meta.designSystem`, `dsRev`), the folder `system/<name>/`, head.json and `defaultDesignSystem`
// carry. A rename therefore changes the label and ONLY the label: nothing that points at the system moves, so
// there is no reference to chase and the write is one atomic read-modify-write of one file (temp file + rename,
// like ds/default.ts) — every other key and the file's shape stay. `null` drops the label (the row shows the
// name again), which is also how the toast's Undo puts back a system that had no label.
//
// The label is other people's text (data, never instructions — DDR-172 D8): one line, 1–64 characters, no
// control characters, and not a name another system already shows (its label, or its bare name), case aside.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { stripSpoofChars } from '../spoof-chars.ts';

export const SYSTEM_LABEL_MAX = 64;

type RenameCode = 'ds-unknown-system' | 'ds-config-unreadable' | 'ds-bad-name' | 'ds-name-taken';

/** Same shape as the engine's refusals (`code` + `status`), so the route answers it the same way. */
class RenameError extends Error {
  constructor(
    readonly code: RenameCode,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'RenameError';
  }
}

export interface RenameResult {
  changed: boolean;
  /** the label before (null: the system showed its name) — what Undo writes back */
  previous: string | null;
  label: string | null;
}

/** The label as it is stored: spaces collapsed and trimmed; null for a refused one. */
export function cleanSystemLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029) return null;
  }
  // V2-8.9 defender L4: bidi overrides / isolates / tag characters would spoof the name in every
  // list — dropped with the exporters' set (spoof-chars.ts); a name of nothing else is refused below.
  const s = stripSpoofChars(raw.normalize('NFC')).replace(/\s+/g, ' ').trim();
  if (!s || [...s].length > SYSTEM_LABEL_MAX) return null;
  return s;
}

export function renameSystem(designRoot: string, ds: string, raw: string | null): RenameResult {
  const file = path.join(designRoot, 'config.json');
  let text: string;
  let cfg: Record<string, unknown>;
  try {
    text = readFileSync(file, 'utf8');
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    cfg = v as Record<string, unknown>;
  } catch {
    throw new RenameError('ds-config-unreadable', 'The project’s config could not be read.', 500);
  }
  const systems = (Array.isArray(cfg.designSystems) ? cfg.designSystems : []) as unknown[];
  const entry = systems.find(
    (s): s is Record<string, unknown> =>
      !!s && typeof s === 'object' && (s as { name?: unknown }).name === ds
  );
  if (!entry)
    throw new RenameError('ds-unknown-system', `no design system named ${ds.slice(0, 64)}`, 404);
  const label = raw === null ? null : cleanSystemLabel(raw);
  if (raw !== null && label === null)
    throw new RenameError(
      'ds-bad-name',
      `A system’s name is one line of 1–${SYSTEM_LABEL_MAX} characters.`,
      400
    );
  if (label !== null) {
    const fold = label.toLowerCase();
    const clash = systems.some((s) => {
      if (!s || typeof s !== 'object' || s === entry) return false;
      const o = s as { name?: unknown; label?: unknown };
      return [o.label, o.name].some(
        (v) => typeof v === 'string' && v.trim().toLowerCase() === fold
      );
    });
    if (clash)
      throw new RenameError('ds-name-taken', 'Another design system already has that name.', 409);
  }
  const previous = typeof entry.label === 'string' ? entry.label : null;
  if (previous === label) return { changed: false, previous, label };
  if (label === null) delete entry.label;
  else entry.label = label;
  // keep the file's own indentation and final newline
  const indent = /^\{\n( +|\t)"/.exec(text)?.[1] ?? '  ';
  const out = `${JSON.stringify(cfg, null, indent)}${text.endsWith('\n') ? '\n' : ''}`;
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, file);
  return { changed: true, previous, label };
}
