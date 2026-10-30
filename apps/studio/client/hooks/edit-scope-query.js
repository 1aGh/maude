// client/hooks/edit-scope-query.js — the query string of the shell's "edit scope" question (GET /_api/edit-scope),
// or null when there is nothing to ask. The Design system tab (SYSTEM_TAB) is not a canvas file: the server has no
// such canvas, so asking about it only draws a 500 (p8-sweep-advanced).
import { SYSTEM_TAB } from '../shell/constants.js';

/**
 * @param activePath the open canvas file (or SYSTEM_TAB, or null)
 * @param selected   the shell's selection: one element, or an array
 * @returns the query string, or null
 */
export function editScopeQuery(activePath, selected) {
  const one = Array.isArray(selected) ? (selected.length === 1 ? selected[0] : null) : selected;
  const id = one && typeof one.id === 'string' ? one.id : null;
  if (!id || !activePath || activePath === SYSTEM_TAB) return null;
  return new URLSearchParams({ canvas: activePath, id }).toString();
}
