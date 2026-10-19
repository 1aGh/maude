// client/v2/share/link-row.jsx — S9.20: the Share sheet's link row (10 co-share-sheet foot,
// co-share-advanced; 02 ob-local-moved).
//
//   🔗 Anyone with the link · Can view                       [Copy link]
//
// Drawn only where the hub has links (`/health.access.links`, Q13). For the owner, Copy link MAKES
// the project's link with the rules under Share › Advanced (`POST /_api/share/links` — the server
// refuses everyone else) and copies the address the hub answers; a second Copy copies the same
// link. Anyone else copies the location (`links.web`), which grants nothing — `team` is a place.

import { linkRowWords } from './share-model.js';

export function LinkRow({ project, rules, owner, made, busy, onCopy }) {
  const words = owner
    ? linkRowWords({ who: rules.who, role: rules.role, project })
    : linkRowWords({ who: 'team', project });
  return (
    <div className="v2sh-link" data-testid="share-link-row" data-who={owner ? rules.who : 'team'}>
      <span className="v2sh-link-t">
        {words.title}
        <span>{words.sub}</span>
      </span>
      <button
        type="button"
        className="btn btn--sm"
        data-testid="share-link-copy"
        disabled={busy}
        onClick={onCopy}
      >
        {made === 'copied' ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
