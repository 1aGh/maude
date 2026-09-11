# Security defender audit — issue #103

Date: 2026-09-11
Verdict: PASS (initial medium availability finding resolved on re-review)

## Evidence sources

- Working tree against HEAD `01bdcfdc157dbebb6983e28f9520d8896852b9a8` on `main`.
- Reviewed notification adapter, canvas bridge, shell listener, export/What's New/Undo/media/annotation integration, runtime packaging and import map, dependency manifests/lockfiles, and relevant regression tests. Generated bundles inspected for import surface; existing React DOM implementation explains generated unsafe-HTML pattern hits.
- Excluded unrelated `.claude/settings.json`.
- Config defaults: severity floor medium; classic, AI and supply-chain scopes enabled. Applied flow security-rules and defender catalog. Static analysis only; no exploit executed.

## Blockers

None remaining.

## Resolved finding

### Medium — unbounded cross-origin canvas notice retention (CWE-400) — RESOLVED

- Location: `apps/studio/notifications.tsx:43-48`; entrypoint `apps/studio/canvas-notice-message.ts:9-15`, dispatched by `apps/studio/client/app.jsx` canvas-notice branch.
- Evidence: every accepted message gets a fresh generated ID and appends to `entries` without a count limit. The receiver bounds individual text length to 4000 characters but does not limit message frequency or retained notice count. `NotificationHost` maps every retained entry to a mounted component while only the newest three can expire. Queued entries are paused indefinitely until they reach those slots.
- Reachable trigger: an active synced/sandboxed canvas posts many `{ dgn: 'canvas-notice', kind: 'error', message: 'x' }` messages to its parent. It satisfies the intended origin/source checks; that authenticates which canvas spoke, not whether its code is trustworthy. This causes retained shell memory growth and repeated whole-array/render work. Navigating away stops new accepted messages but does not discard the backlog; error notices drain at most three per ten seconds.
- Impact: the isolated canvas can degrade the trusted shell and delay legitimate export/Undo notices. This is session-local availability exposure, not remote code execution or data exfiltration.
- Fix: bound untrusted canvas notices independently (cap/coalesce and intake rate limit); avoid evicting trusted export/save notices. Add a regression test for a burst of accepted messages and retention/drain bounds. This is an additional availability finding rather than a forced match to an unrelated A1–A12 rule.

## Warnings

None.

## Dependency surface

- Added `sonner` exactly pinned to `2.0.8`; both Bun and pnpm lockfiles contain matching SHA-512 integrity and compatible React peers.
- Installed manifest and npm registry identify maintainer `emilkowalski`; version published 2026-08-09. No preinstall/install/postinstall scripts and no runtime dependencies beyond existing React/ReactDOM peers (optional React types).
- Runtime import map serves a local prebuilt `sonner.js`; React/ReactDOM remain external imports. No new remote CDN or dynamic package-name input.
- No package flagged. This is manifest/lockfile/publisher review, not a claim of a complete vulnerability database audit.

## Other boundary checks

- Origin plus exact active iframe source checks reject foreign or inactive frames and null source. Canvas messages are mapped into a fresh allowlisted object: no executable content, callback, HTML, caller ID, duration or shell action crosses the bridge.
- React escapes notice text and full export diagnostics; no new HTML injection sink. Existing full error visibility is moved into a collapsed details element, not expanded to another authorization audience.
- Save/download actions remain trusted closures; bridge messages cannot invoke them.
- No added credential prefixes or dynamic evaluation found in changed lines. No new auth, filesystem, server mutation or model/tool execution surface.
- Wildcard outbound parent postMessage is text-only and carries canvas-owned diagnostics; no parent secret is read. Existing frame-ancestors policy restricts split-origin embedding. No demonstrated new exfiltration finding.

## Remediation re-review

- Reviewed `notifyCanvasText` and both ingress call sites after correction. Embedded shell traffic reaches it only after the existing active-origin/source validator; standalone canvas toast calls also use it.
- Canvas publications now use exactly two reusable reserved IDs, with no caller-supplied IDs/actions and no access to trusted notice namespaces. Upserts cannot grow the canvas queue beyond two entries and preserve trusted notices. Informational Undo replaces its previous card.
- A fixed one-second window permits at most five publications per window; excess messages do not publish or grow the retained notification store. Updates reset the finite canvas timeout, and both slots drain after messages stop.
- Read the added 100-message burst, sustained-message retention, trusted-notice visibility, drain and Undo tests. The parent reports all 11 notification tests passing; this defender recheck remains static and does not independently claim a test run.
- Initial finding is resolved. Generic browser message transport flooding remains outside the retention bug; the new path no longer amplifies accepted notices into an unlimited mounted component backlog.

Summary: 0 blockers, 0 warnings; 1 initial finding resolved.
