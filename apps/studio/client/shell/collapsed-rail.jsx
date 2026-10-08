// shell/collapsed-rail.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { StIcon } from './icons.jsx';

// Collapsed rail — a thin strip shown when the sidebar is collapsed, with a
// re-open affordance + quick search/files shortcuts (mockup CollapsedRail).
export function CollapsedRail({ shown, onExpand, onSearch }) {
  return (
    <div className={'st-rail' + (shown ? ' is-shown' : '')}>
      <div className="st-rail-inner">
        <button type="button" className="st-iconbtn" aria-label="Expand sidebar" title="Expand sidebar (T)" onClick={onExpand}>
          <StIcon name="panel-left" size={15} />
        </button>
        <button type="button" className="st-iconbtn" aria-label="Search" title="Search (/)" onClick={onSearch}>
          <StIcon name="search" size={15} />
        </button>
        <button type="button" className="st-iconbtn" aria-label="Files" title="Files" onClick={onExpand}>
          <StIcon name="folder" size={15} />
        </button>
      </div>
    </div>
  );
}
