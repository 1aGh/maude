import { cloneElement, useLayoutEffect, useRef } from 'react';

const ITEM = '[role="treeitem"]';

/** One tree tab stop. Arrow focus does not open files or change selection. */
export function FileTree({ children, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const tree = ref.current;
    const items = () => Array.from(tree.querySelectorAll(ITEM));
    const focusItem = (item, focus = true) => {
      if (!item) return;
      for (const row of items()) row.tabIndex = row === item ? 0 : -1;
      if (focus) item.focus();
    };
    const repairTabStop = () => {
      const rows = items();
      const current = rows.find((row) => row.tabIndex === 0);
      focusItem(
        current || rows.find((row) => row.getAttribute('aria-selected') === 'true') || rows[0],
        tree.ownerDocument.activeElement === tree
      );
      tree.tabIndex = rows.length ? -1 : 0;
    };
    const onFocus = (event) => {
      const item = event.target.closest?.(ITEM);
      if (item && tree.contains(item)) focusItem(item, false);
    };
    const onKey = (event) => {
      const item = event.target.closest?.(ITEM);
      if (!item || !tree.contains(item) || event.metaKey || event.ctrlKey || event.altKey) return;
      const row = item.querySelector(':scope > .st-row-wrap');
      const primary = row?.querySelector('[data-tree-primary]');
      // Extra buttons keep their native Enter/Space/Tab behavior. Escape
      // returns from a row action to the tree; open menus own their own keys.
      if (event.target !== item && event.target !== primary) {
        if (event.key === 'Escape') {
          event.preventDefault();
          focusItem(item);
        }
        return;
      }
      const rows = items();
      const index = rows.indexOf(item);
      const expanded = item.getAttribute('aria-expanded');
      const toggle = () => item.dispatchEvent(new Event('tree-toggle'));
      switch (event.key) {
        case 'ArrowDown':
          focusItem(rows[Math.min(index + 1, rows.length - 1)]);
          break;
        case 'ArrowUp':
          focusItem(rows[Math.max(index - 1, 0)]);
          break;
        case 'Home':
          focusItem(rows[0]);
          break;
        case 'End':
          focusItem(rows.at(-1));
          break;
        case 'ArrowRight':
          if (expanded === 'false') toggle();
          else if (expanded === 'true')
            focusItem(item.querySelector(':scope > [role="group"] ' + ITEM));
          break;
        case 'ArrowLeft':
          if (expanded === 'true') toggle();
          else focusItem(item.parentElement?.closest(ITEM));
          break;
        case 'Enter':
        case ' ':
          if (event.target !== item) return;
          if (item.getAttribute('aria-disabled') !== 'true') primary?.click();
          break;
        default: {
          if (event.key.length !== 1 || event.shiftKey) return;
          const ordered = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
          focusItem(
            ordered.find((candidate) =>
              candidate
                .getAttribute('aria-label')
                ?.toLocaleLowerCase()
                .startsWith(event.key.toLocaleLowerCase())
            )
          );
        }
      }
      event.preventDefault();
      event.stopPropagation();
    };
    repairTabStop();
    const observer = new MutationObserver(repairTabStop);
    observer.observe(tree, { childList: true, subtree: true });
    tree.addEventListener('focusin', onFocus);
    tree.addEventListener('keydown', onKey);
    return () => {
      observer.disconnect();
      tree.removeEventListener('focusin', onFocus);
      tree.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div {...props} ref={ref} className="st-tree" role="tree">
      {children}
    </div>
  );
}

/** Row actions belong to the item; descendants belong to its named group.
 * Native buttons remain the activation targets, never nested in a button. */
export function FileTreeItem({
  label,
  row,
  actions,
  expanded,
  selected,
  disabled,
  busy,
  onToggle,
  children,
  className = '',
}) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const item = ref.current;
    const toggle = () => onToggle?.();
    item.addEventListener('tree-toggle', toggle);
    return () => item.removeEventListener('tree-toggle', toggle);
  }, [onToggle]);
  const primary =
    row.type === 'button'
      ? cloneElement(row, {
          role: undefined,
          'aria-selected': undefined,
          tabIndex: -1,
          'data-tree-primary': '',
        })
      : row;
  return (
    <div
      ref={ref}
      className={`st-tree-item ${className}`}
      role="treeitem"
      tabIndex={-1}
      aria-label={label}
      aria-expanded={expanded}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      aria-busy={busy || undefined}
    >
      <div className="st-row-wrap">
        {primary}
        {actions}
      </div>
      {children && <div role="group">{children}</div>}
    </div>
  );
}
