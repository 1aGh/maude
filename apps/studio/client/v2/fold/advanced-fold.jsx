// client/v2/fold/advanced-fold.jsx — V2-4.10: the one "› Advanced" fold (06 Advanced, `ad-fold`).
//
// A single quiet row at the foot of a panel. Closed: the row alone (children are not rendered — the
// default view stays calm and nothing hidden costs anything). Open: the body, where mono and raw words
// are allowed. Open or closed is REMEMBERED per panel per Mac (fold-store.js → prefs.json `fold`), the
// same in every project; ⌘K "Open / Close all Advanced sections" and Settings › Advanced › Reset move
// every fold at once. The Inspector's Advanced (S2) uses this same component with `panel="inspector"`.
//
//   <AdvancedFold panel="left.canvases" hint="Files, folder, Trash">…</AdvancedFold>
//
// Uncontrolled by default (state from the store by `panel`). A caller that already owns the state passes
// `open` + `onToggle`. `classes` lets a panel keep its own look (and its characterization snapshot) —
// the markup is the same, only the class names differ.

import { StIcon } from '../../shell/icons.jsx';
import { useFold, useFoldRemembered } from './use-fold.js';

/** The kit fold anatomy (_kit.css `.k-adv*`, Phase 8 C1-kit): on EVERY fold, beside a panel's own classes,
 *  so the row reads the same in every panel (30 px, type-sm semibold fg-1, the "›" in fg-2). */
const KIT = Object.freeze({
  root: 'k-adv',
  btn: 'k-adv-btn',
  ch: 'k-adv-ch',
  hint: 'k-adv-count',
  body: 'k-adv-body',
});

export const FOLD_CLASSES = Object.freeze({
  root: 'v2-fold',
  btn: 'v2-fold-btn',
  ch: 'v2-fold-ch',
  hint: 'v2-fold-hint',
  body: 'v2-fold-body',
});

/** A DOM id for the body: the panel key made safe for `aria-controls`. */
export function foldBodyId(panel) {
  return `fold-body-${String(panel).replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export function AdvancedFold({
  panel,
  label = 'Advanced',
  hint,
  children,
  testid,
  buttonTestid,
  classes,
  open: openProp,
  onToggle,
}) {
  const [stored, setStored] = useFold(panel);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : stored;
  const own = { ...FOLD_CLASSES, ...classes };
  const c = Object.fromEntries(Object.entries(own).map(([k, v]) => [k, `${KIT[k]} ${v}`]));
  const bodyId = foldBodyId(panel);
  // 06 Advanced: open by a remembered choice → "kept open" (the pin says it stays open next time)
  const remembered = useFoldRemembered(panel) && open;
  return (
    <div
      className={c.root}
      data-fold={panel}
      data-open={open ? 'true' : undefined}
      data-testid={testid ?? `fold-${panel}`}
    >
      <button
        type="button"
        className={c.btn}
        data-testid={buttonTestid ?? `fold-${panel}-toggle`}
        aria-expanded={open}
        // only while the body exists: a closed fold controls nothing, and a dangling id is noise
        aria-controls={open ? bodyId : undefined}
        onClick={() => (onToggle ? onToggle() : setStored((v) => !v))}
      >
        <span className={c.ch}>
          <StIcon name="submenu" size={12} />
        </span>
        {label}
        {remembered ? (
          <span className="ad-kept" title="Stays open next time">
            <StIcon name="pin" size={11} />
            kept open
          </span>
        ) : null}
        {/* what's inside (≤ 3 nouns) — said while closed; open, the body says it (06 Advanced.tsx Fold) */}
        {hint && !open ? <span className={c.hint}>{hint}</span> : null}
      </button>
      {open ? (
        <div id={bodyId} className={c.body} data-testid={`fold-${panel}-body`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
