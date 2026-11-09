// client/v2/settings/connection-row.jsx — S11.14: the mono "k · value" line a connection keeps under its
// own Advanced (06 ad-edge-hub): addresses, the masked token, versions. 2.1.1 T6: the connection ROW itself
// became the Settings card (settings-card.jsx), the same in every tab.

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
