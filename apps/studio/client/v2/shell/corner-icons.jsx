// client/v2/shell/corner-icons.jsx — V2-4.1: the folded form of the floating panels. A panel that is not
// showing — closed, or stepped aside by ⌘\ — leaves its icon in the corner it lives in: Canvases top-left,
// Inspector / Comments top-right, the AI chat's spark bottom (kit `PanelIcon at=left|insp|ai`). Each is a
// small `.island` and carries `data-occludes`, so Fit leaves room for it too (V2-1.2 §5.6).
//
// Words: the UI says "Hide / Show panels" — never fold, tuck or collapse (CONTRACT §3).

import { StIcon } from '../../shell/icons.jsx';
import FoldNeeds, { foldState } from '../ai/FoldNeeds.jsx';
import { useNeedsYou, useNeedsYouFeed } from '../ai/needs-you-store.js';

const FIRST_OF_KIND = {
  left: ['tree', 'layers', 'assets', 'changes', 'comments', 'inspector', 'sync'],
  right: ['inspector', 'comments', 'changes', 'sync', 'tree', 'layers', 'assets'],
};

/** The panel a side's corner icon opens: the first non-assistant panel assigned to that side, in the order
 *  people reach for them. null ⇒ the side has none, so it gets no icon. */
export function cornerTarget(side, ids) {
  const own = ids.filter((id) => id !== 'assistant');
  if (own.length === 0) return null;
  return FIRST_OF_KIND[side].find((id) => own.includes(id)) ?? own[0];
}

const LABEL = {
  tree: 'Canvases',
  layers: 'Layers',
  assets: 'Assets',
  inspector: 'Inspector',
  comments: 'Comments',
  changes: 'Changes',
  sync: 'Sync',
};

function Corner({ at, edge, icon, label, title, working, needs = 0, onClick, testid }) {
  return (
    <span
      className={`st-corner st-corner--${at} island${needs > 0 ? ' st-corner--needs' : ''}`}
      data-occludes={edge}
    >
      <button
        type="button"
        className="st-iconbtn"
        data-testid={testid}
        aria-label={label}
        title={title}
        onClick={onClick}
      >
        <StIcon name={icon} size={15} />
        {/* S5.13 (03 `ai-needs-hidden`): a chat waiting for YOU is an azure count and wins over the busy dot. */}
        {needs > 0 ? (
          <FoldNeeds count={needs} />
        ) : working ? (
          <i className="st-corner-dot" aria-hidden="true" />
        ) : null}
      </button>
    </span>
  );
}

/**
 * @param hidden ⌘\ is on — every panel steps aside, every available corner icon shows
 * @param leftActive / rightActive the panel showing in each slot (null = none)
 * @param leftIds / rightIds the panels assigned to each slot
 * @param assistant null (no AI chat here) or { side, shown, busy }
 * @param onOpen (id) => void — brings the panel up (the caller also un-hides)
 * @param onShow () => void — un-hide only
 */
export function CornerIcons({
  hidden,
  leftActive,
  rightActive,
  leftIds,
  rightIds,
  assistant,
  onOpen,
  onShow,
}) {
  const out = [];
  useNeedsYouFeed();
  const needsYou = useNeedsYou();
  const reveal = (active, id) => () => {
    if (hidden) onShow();
    if (!active) onOpen(id);
  };
  const leftTarget = cornerTarget('left', leftIds);
  if (leftTarget && (hidden || !leftActive))
    out.push(
      <Corner
        key="left"
        at="left"
        edge="left"
        icon="panel-left"
        testid="panel-icon-left"
        label={hidden ? 'Show panels' : `Open ${LABEL[leftTarget] ?? leftTarget}`}
        title={hidden ? 'Show panels (⌘\\)' : `${LABEL[leftTarget] ?? leftTarget}`}
        onClick={reveal(leftActive, leftTarget)}
      />
    );
  const rightTarget = cornerTarget('right', rightIds);
  if (rightTarget && (hidden || !rightActive))
    out.push(
      <Corner
        key="right"
        at="right"
        edge="right"
        icon="sliders"
        testid="panel-icon-right"
        label={hidden ? 'Show panels' : `Open ${LABEL[rightTarget] ?? rightTarget}`}
        title={hidden ? 'Show panels (⌘\\)' : `${LABEL[rightTarget] ?? rightTarget}`}
        onClick={reveal(rightActive, rightTarget)}
      />
    );
  if (assistant && (hidden || !assistant.shown))
    out.push(
      <Corner
        key="ai"
        at={assistant.side === 'left' ? 'ai-left' : 'ai'}
        edge={assistant.side}
        icon="sparkle"
        testid="panel-icon-assistant"
        label={
          foldState({ needs: needsYou, busy: assistant.busy }).kind === 'needs'
            ? 'Open Assistant — AI needs you'
            : hidden
              ? 'Show panels'
              : 'Open Assistant'
        }
        title={hidden ? 'Show panels (⌘\\)' : 'Assistant'}
        working={assistant.busy}
        needs={needsYou}
        onClick={() => {
          if (hidden) onShow();
          if (!assistant.shown) onOpen('assistant');
        }}
      />
    );
  return out.length ? <>{out}</> : null;
}
