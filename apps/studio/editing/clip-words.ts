// editing/clip-words.ts — the words a paste says about what travelled with it (#122, contract
// 122-cross-canvas-clipboard.md §5.2): "Pasted the artboard · added 2 imports" / "· renamed W to W2".
// Pure. The server answers `detail.carried = { imports, decls, renamed: [{from, to}] }` (edit-ops/clipboard.ts,
// slice 122-A); a paste that carried nothing says nothing, as a paste always has. Used by the canvas (a paste it
// ran itself) and by the shell (a paste the person confirmed on the shell's own toast).

import type { ElementRef } from '../edit-ops/types.ts';

const MAX_NAMED = 2;
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const name = (v: unknown): string => (typeof v === 'string' ? v.slice(0, 60) : '');

/** What was pasted, from the refs the paste created: whole artboards, else objects. */
function pastedWhat(created: readonly ElementRef[] | undefined): string {
  const list = created ?? [];
  const boards = list.length > 0 && list.every((r) => r.artboard === r.element);
  const n = list.length;
  if (boards) return n === 1 ? 'the artboard' : `${n} artboards`;
  return n <= 1 ? 'the object' : `${n} objects`;
}

/** The toast line for a paste that carried imports, declarations or renames; null when it carried none. */
export function clipWords(result: {
  created?: readonly ElementRef[];
  detail?: unknown;
}): string | null {
  const carried = (result.detail as { carried?: unknown } | undefined)?.carried;
  if (!carried || typeof carried !== 'object') return null;
  const c = carried as { imports?: unknown; decls?: unknown; renamed?: unknown };
  const imports = num(c.imports);
  const decls = num(c.decls);
  const renamed = (Array.isArray(c.renamed) ? c.renamed : []).flatMap((r) => {
    const from = name((r as { from?: unknown } | null)?.from);
    const to = name((r as { to?: unknown } | null)?.to);
    return from && to ? [`${from} to ${to}`] : [];
  });
  const parts: string[] = [];
  if (imports) parts.push(`added ${count(imports, 'import', 'imports')}`);
  if (decls) parts.push(`added ${count(decls, 'declaration', 'declarations')}`);
  if (renamed.length) {
    const named = renamed.slice(0, MAX_NAMED).join(', ');
    const more = renamed.length - MAX_NAMED;
    parts.push(`renamed ${named}${more > 0 ? ` and ${more} more` : ''}`);
  }
  if (parts.length === 0) return null;
  return `Pasted ${pastedWhat(result.created)} · ${parts.join(' · ')}`;
}
