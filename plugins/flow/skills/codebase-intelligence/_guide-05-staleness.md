## Staleness

A snapshot should be refreshed when:

- **File count changed by >20%** — significant structural change
- **Dependencies changed** — major version bumps or new dependencies
- **New app/package added** — monorepo structure changed
- **Snapshot >7 days old** — general staleness threshold
- **CI configuration changed** — workflow modifications

Staleness detection: compare the `Last updated` timestamp in the snapshot header against the current date.
