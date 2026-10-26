// client/v2/inspector/layers-row-tools.jsx — S2.6: the lock and the eye at the end of a Layers row
// (moved out of client/inspector/layers.jsx), and the one request both send.
//
// Lock and Hide are SHARED and live in the TSX (`data-cd-locked`, `data-cd-hidden`): the same
// `object.lock` / `object.hide` edit-ops the object menu and ⇧⌘L run (the canvas posts them, S2.6).
// A hidden object stays in the file and in Layers, greyed; a locked one shows its padlock. The
// buttons appear when the row is pointed at (and stay on while the state is on).

import { StIcon } from '../../shell/icons.jsx';

/**
 * The shell → canvas message that locks / hides (or undoes it) on one Layers node. The canvas runs it
 * through the same `runObjectOp` the object menu and ⇧⌘L use — one refusal line, one undo record, and
 * the canvas's own re-render shows the result. `value` true = lock / hide, false = unlock / show.
 * @param {'object.lock' | 'object.hide'} id
 * @param {{ id: string, index?: number }} node
 * @param {string} artboardId
 * @param {boolean} value
 */
export function layerOpMessage(id, node, artboardId, value) {
  return {
    dgn: 'run-action',
    v: 1,
    id,
    params: {
      targets: [
        {
          artboard: artboardId,
          element: node.id,
          ...(node.index ? { occurrence: node.index } : {}),
        },
      ],
      ...(id === 'object.lock' ? { locked: value } : { hidden: value }),
    },
  };
}

/** The padlock and the eye of a Layers row. `node` is a non-synthetic layer node. */
export function LayerRowTools({
  node,
  isLocked,
  isHidden,
  tabbable = true,
  onToggleLock,
  onToggleVisibility,
}) {
  return (
    <>
      {onToggleLock ? (
        <button
          type="button"
          className="sh-layer-lock"
          tabIndex={tabbable ? 0 : -1}
          data-on={isLocked ? 'true' : undefined}
          aria-label={isLocked ? `Unlock ${node.label}` : `Lock ${node.label}`}
          aria-pressed={isLocked}
          title={isLocked ? 'Unlock' : 'Lock'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(`${node.id}:${node.index}`, node);
          }}
        >
          <StIcon name={isLocked ? 'lock' : 'unlock'} size={12} />
        </button>
      ) : null}
      {onToggleVisibility ? (
        <button
          type="button"
          className="sh-layer-eye"
          tabIndex={tabbable ? 0 : -1}
          data-on={isHidden ? 'true' : undefined}
          aria-label={isHidden ? `Show ${node.label}` : `Hide ${node.label}`}
          aria-pressed={isHidden}
          title={isHidden ? 'Show' : 'Hide'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node);
          }}
        >
          <StIcon name={isHidden ? 'eye-off' : 'eye'} size={13} />
        </button>
      ) : null}
    </>
  );
}
