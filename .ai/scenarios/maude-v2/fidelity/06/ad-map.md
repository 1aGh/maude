# 06/ad-map — Where every v1 control went

Status: **built** (S11.19, 2026-10-20). Code and tests exist; the state could not be shot here (see Open).

## Evidence
- no frame
- test: `scripts/test/v2-nothing-deleted-v1-names.test.mjs`
- test: `scripts/check-v2-nothing-deleted.mjs`

## Checked
- No `v2.where` names a v1 component (criterion 4 of the gate, derived list; red first: D9, D10, D12 named ModeBanner, DiffView, SyncBanner / CloudRoleBanner).
- Mapping, homes, rows and v2.where lint are 100 %.

## Open
- `kept actions/hooks reachable` is 97.5 % (11 of 446): `reachability.json` is stale (sync-panel, asset-upload-bar(s), ds-bar-review, ds-outline-<kind>, [data-ds-direction], help.add-guides, four video-* hooks). The lead re-runs `scripts/v2-manifest/probe-reach.mjs`; the row is `verified` when the gate prints 100 %.

## Critics
- design-critic, a11y-critic, copy-critic and the DS keeper: not run by S11.19; the lead runs them at the gate.
