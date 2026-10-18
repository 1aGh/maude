// client/v2/inspector/crumbs.jsx — S2.1 (artboard ed-obj-enter): "Desktop › Services › Brand systems"
// + esc above the inspector's name.
//
// The rungs come from the canvas with the selection (`select-set` `crumbs`, S2-edit-ops.md §7): the
// artboard, every frame the object sits in, the object. Every rung but the last is a button that
// selects that level (the artboard rung selects the artboard), so the path is also the way out; esc
// steps out one level on the canvas (`object.step-out`). An old canvas bundle sends no crumbs: the
// frame then passes the layer-tree path (plain words, not buttons).

import { StIcon } from '../../shell/icons.jsx';

/** `crumbs` = [{ label, ref }] (ref null = the artboard; undefined = not clickable). */
export function InspectorCrumbs({ crumbs, onPick }) {
  if (!Array.isArray(crumbs) || crumbs.length < 2) return null;
  const last = crumbs.length - 1;
  const stepsOut = crumbs[last]?.ref != null;
  return (
    <nav className="insp-crumbs" data-testid="inspector-crumbs" aria-label="Where this is">
      {crumbs.map((c, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a path can repeat a name; position is its identity
        <span key={`${i}:${c.label}`} className="insp-crumb-wrap">
          {i ? (
            <span className="insp-crumb-ch" aria-hidden="true">
              <StIcon name="chevron-right" size={10} />
            </span>
          ) : null}
          {i < last && c.ref !== undefined && onPick ? (
            <button
              type="button"
              className="insp-crumb insp-crumb--btn"
              data-testid={`inspector-crumb-${i}`}
              title={`Select ${c.label}`}
              onClick={() => onPick(c.ref)}
            >
              {c.label}
            </button>
          ) : (
            <span
              className="insp-crumb"
              data-testid={`inspector-crumb-${i}`}
              data-last={i === last ? 'true' : undefined}
              aria-current={i === last ? 'location' : undefined}
            >
              {c.label}
            </span>
          )}
        </span>
      ))}
      {stepsOut ? (
        <kbd
          className="insp-crumbs-esc"
          data-testid="inspector-crumbs-esc"
          title="esc steps out one level"
        >
          esc
        </kbd>
      ) : null}
    </nav>
  );
}

/** The layer-tree path (strings) as unclickable rungs — the fallback for an old canvas bundle. */
export function crumbsFromPath(path) {
  return Array.isArray(path) ? path.map((label) => ({ label, ref: undefined })) : [];
}
