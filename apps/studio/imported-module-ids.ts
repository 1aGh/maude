// #151 T2.3b — which IMPORTED file an element id lives in.
//
// A canvas that renders components from a sibling file (a shared hi-fi library) gets those elements a
// `data-cd-id` at build time (canvas-pipeline.ts `stampImportedModule`) so they can be selected and
// commented. The edit engine reads only the canvas file, so an edit aimed at one cannot land. The id
// stays 8 hex (the hold, link and text-patch checks all match that shape), so it cannot carry the
// file; instead the server asks here, on the miss: walk the canvas's own relative imports, recompute
// the ids each stampable module gets (the same walk the build ran) and answer with the first module
// that holds the id. Every edit surface turns the answer into one refusal that names the file
// (`moduleRefusal`) instead of "not on this canvas" / "data-cd-id … not found in <abs path>".
//
// Pure of the network and of the canvas's build cache: it re-reads the files, so it is only asked once an
// id was not found in the canvas itself (a rare, failing path), never on a successful edit.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { relativeImportCandidates } from './access/closure.ts';
import { importedModuleIds, importedModuleScope } from './canvas-pipeline.ts';

/** A walk past this many files is not a hi-fi library but a planted import fan-out. */
const MAX_MODULES = 200;
const MAX_BYTES = 1024 * 1024;
const CODE_EXT_RE = /\.[cm]?[jt]sx?$/;
const STAMPED_EXT_RE = /\.[jt]sx$/;

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function readSmall(file: string): string | null {
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The design-root-relative path of the imported module (reached from `canvasAbs` through relative
 * imports, transitively) whose elements carry `id`, or null when the id is not an imported module's
 * (the canvas's own id, an unknown one, a design-system component).
 */
export function moduleOwningId(canvasAbs: string, designRoot: string, id: string): string | null {
  if (!id) return null;
  const root = real(designRoot);
  const first = readSmall(canvasAbs);
  if (first === null) return null;
  // real paths throughout: the import clamp compares prefixes, and macOS reports /var as /private/var
  const start = real(canvasAbs);
  const seen = new Set<string>([start]);
  const queue: Array<{ file: string; text: string }> = [{ file: start, text: first }];
  let visited = 0;
  for (let head = 0; head < queue.length; head++) {
    const { file, text } = queue[head] as { file: string; text: string };
    for (const cand of relativeImportCandidates(text, file, root)) {
      if (!CODE_EXT_RE.test(cand) || !existsSync(cand)) continue;
      const abs = real(cand);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if (++visited > MAX_MODULES) return null;
      const src = readSmall(abs);
      if (src === null) continue;
      if (STAMPED_EXT_RE.test(abs)) {
        const scope = importedModuleScope(abs, root);
        if (scope && importedModuleIds(abs, src, scope).has(id)) return scope;
      }
      queue.push({ file: abs, text: src });
    }
  }
  return null;
}

/**
 * The refusal a person reads (a toast, a panel line): what happened · what is safe · where the thing
 * is. Words: CONTRACT §3–§4 (no "we"/"I", no exclamation mark).
 */
export function moduleRefusal(module: string): string {
  return `That part comes from ${module}, another file, so it can’t be edited here. Nothing changed.`;
}

/** The same refusal for the AI (`maude design canvas-edit`): it can act on the file itself. */
export function moduleRefusalForAi(module: string): string {
  return `${moduleRefusal(module)} It is a file of its own: edit ${module} directly, or change what the canvas passes to the component.`;
}
