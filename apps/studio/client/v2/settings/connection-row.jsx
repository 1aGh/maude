// client/v2/settings/connection-row.jsx — S11.14: one connection in Settings › Connections (06 ad-edge-hub).
//
//   (icon)  Maude Cloud                                   [Sign out]
//           Signed in as You
//           › Advanced                      ← its own fold, remembered per Mac (`connections.<row>`)
//
// The row is the plain-words half (what it is, whether it works, one action); the mono words —
// addresses, the masked token, versions — live only under that row's Advanced. `children` is what
// stays visible under the row (the cloud project list, the key cards while Manage is open).

import { StIcon } from '../../shell/icons.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { connectionFoldId } from './connections-model.js';

export function ConnectionRow({
  row,
  icon,
  title,
  status,
  tone,
  action,
  advanced,
  children,
  testid,
  rowTestid,
}) {
  return (
    <section
      className="v2s-conn"
      aria-label={title}
      data-testid={testid ?? `settings-conn-${row}`}
      data-conn={row}
    >
      <div className="v2s-conn-r" data-testid={rowTestid}>
        <span className="v2s-conn-ic" aria-hidden="true">
          <StIcon name={icon} size={16} />
        </span>
        <span className="v2s-conn-t">
          <strong>{title}</strong>
          <span
            className={tone === 'ok' ? 'v2s-conn-s v2s-conn-s--ok' : 'v2s-conn-s'}
            data-testid={`settings-conn-${row}-status`}
          >
            {status}
          </span>
        </span>
        {action ? <span className="v2s-conn-a">{action}</span> : null}
      </div>
      {children}
      {advanced ? (
        <div className="v2s-conn-fold">
          <AdvancedFold panel={connectionFoldId(row)}>{advanced}</AdvancedFold>
        </div>
      ) : null}
    </section>
  );
}

/** One "k · value" line under a connection's Advanced; `copy` adds a Copy button for the value. */
export function ConnField({ k, mono, copy, children, testid }) {
  return (
    <div className="v2s-conn-k" data-testid={testid}>
      <span className="v2s-conn-kk">{k}</span>
      <span className={mono ? 'v2s-conn-kv v2s-conn-kv--mono' : 'v2s-conn-kv'}>{children}</span>
      {copy ? (
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          aria-label={`Copy ${k.toLowerCase()}`}
          onClick={() => navigator.clipboard?.writeText(copy).catch?.(() => {})}
        >
          Copy
        </button>
      ) : null}
    </div>
  );
}
