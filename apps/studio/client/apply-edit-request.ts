// The shell half of an inline-edit undo/redo (`dgn:'apply-edit'`). The canvas
// iframe's edit-source command cannot reach the main-origin `/_api/edit-*`
// routes (DDR-054), so it posts the re-application here and the shell builds
// the request.
//
// `from` is the value the command expects the source to hold right now (the
// side it replaces FROM). For css/attr it becomes the route's `expected`
// precondition, so an undo cannot overwrite a newer value a teammate wrote
// (audit 2026-09-13 P1 #5). For text it keeps its existing job: targeting a
// `{variable}` edit at the right source string.

export interface ApplyEditMessage {
  op: unknown;
  canvas?: unknown;
  id?: unknown;
  key?: unknown;
  value?: unknown;
  from?: unknown;
  occurrence?: unknown;
}

export interface ApplyEditRequest {
  op: 'css' | 'text' | 'attr';
  url: string;
  body: Record<string, unknown>;
}

export function applyEditRequest(m: ApplyEditMessage): ApplyEditRequest | null {
  if (m.op !== 'css' && m.op !== 'text' && m.op !== 'attr') return null;
  if (typeof m.id !== 'string' || !m.id) return null;
  const value = typeof m.value === 'string' ? m.value : null;
  // Older canvas bundles send no `from`; they keep the legacy unconditional write.
  const expected =
    typeof m.from === 'string' || m.from === null ? { expected: m.from } : ({} as object);
  if (m.op === 'css') {
    const target = value == null ? { reset: true } : { value };
    return {
      op: 'css',
      url: '/_api/edit-css',
      body: { canvas: m.canvas, id: m.id, property: m.key, ...target, ...expected },
    };
  }
  if (m.op === 'attr') {
    const target = value == null ? { reset: true } : { value };
    return {
      op: 'attr',
      url: '/_api/edit-attr',
      body: { canvas: m.canvas, id: m.id, attr: m.key, ...target, ...expected },
    };
  }
  const body: Record<string, unknown> = { canvas: m.canvas, id: m.id, text: value ?? '' };
  if (typeof m.occurrence === 'number') body.occurrence = m.occurrence;
  if (typeof m.from === 'string') body.before = m.from;
  return { op: 'text', url: '/_api/edit-text', body };
}
