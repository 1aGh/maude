// client/v2/timeline/edit/clip-menu.jsx — S7.9: the clip right-click menu (Gate 0 D15). The model (which rows, in
// what order, which under Advanced ▸) is clip-menu.js; this binds each row to what the Timeline can do for the
// clip and draws it with the same context-menu component the canvas uses.

import { ContextMenuView } from '../../../../context-menu.tsx';
import { clipMenuModel } from './clip-menu.js';

/**
 * @param {{
 *   x: number, y: number,                 // where the menu opens (client px)
 *   model: Parameters<typeof clipMenuModel>[0],
 *   run: Record<string, () => void>,      // row id → what it does
 *   onClose: () => void,
 * }} p
 */
export function ClipMenu({ x, y, model, run, onClose }) {
  const { plain, advanced } = clipMenuModel(model);
  const item = (r) => ({
    id: r.id,
    label: r.label,
    ...(r.disabled ? { disabled: true } : {}),
    ...(r.destructive ? { destructive: true } : {}),
    onSelect: () => run[r.id]?.(),
  });
  const sections = [];
  if (plain.length) sections.push(plain.filter((r) => r.id !== 'remove').map(item));
  const tail = [];
  if (advanced.length) {
    tail.push({
      id: 'advanced',
      label: 'Advanced',
      onSelect: () => {},
      submenu: advanced.map(item),
    });
  }
  const remove = plain.find((r) => r.id === 'remove');
  if (remove) tail.push(item(remove));
  if (tail.length) sections.push(tail);
  // a note-only menu (loose media, a layer with nothing to replace) keeps its single disabled row
  const flat = sections.filter((s) => s.length);
  return (
    <ContextMenuView
      target={{ kind: 'element', el: null, cdId: null, artboardId: null, clientX: x, clientY: y }}
      sections={flat}
      onClose={onClose}
    />
  );
}
