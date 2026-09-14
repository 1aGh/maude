# Share-link security defender review

Status: **PASS** for AppSec after focused re-review of the closeout fixes. 0 security blockers, 0 security warnings. The functional browser-opener integration issue is corrected.

## Evidence and scope

- Diff base: `cf0fc4182af8aa0e93f2bdcf97bcb2c62c6f0ee9` (merge-base with main); no committed changes beyond base. Included uncommitted and untracked source.
- Applied `plugins/flow/agents/security-auditor.md`, its regex catalog and flow security rules A1–A12. Config uses default medium severity floor and classic/AI/supply-chain scope.
- Static review only. No exploits, servers, production mutations, or test suites run by this reviewer.
- 27 source/config files scanned (including the subsequently changed Rust oauth/deep-link modules): desktop E2E scenario/config, Rust build/capability/permission/lib/sidecar/resolver; hub browser-auth/server/return-to and both changed tests; studio app/github/CloudBar/file-deep-link-dialog/share-dialog/share-link/styles, two changed tests and What's New feed; docs index and generated What's New feed. Generated JS/CSS bundles are represented by source review rather than a second minified-source audit.
- The final `oauth.rs` browser-open policy and Tauri capability boundary were reviewed, including the root-query extension and hostile-query test cases.
- No manifests or lockfiles changed; no dependencies added.

## Security findings

None at or above the severity floor; none below it.

## Boundary assessment

- **A9 paths:** `share-link.js:6` validates a once-decoded file identity and rejects absolute paths, empty/dot segments, controls, drive prefixes and backslashes. `app.jsx:12020` resolves an incoming identity against the loaded tree before opening a canvas or preview. The link is not concatenated into a filesystem read. Rust `project_resolve.rs:17` revalidates the IPC file value; `sidecar.rs:842` appends it through URL query serialization to an already validated loopback URL.
- **A5 redirect / A7 cookies:** `return-to.mjs:5` permits only canonical `/?open=...` destinations. It rejects malformed escaping, extra query fields, fragments and traversal. `takeReturnTo` revalidates an unsigned cookie, rejects duplicates, preserves existing session cookies and clears the return cookie. Cookies are host-only, HttpOnly, Secure, SameSite=Lax and expire in ten minutes. The revised encoding stores at most 2048 base64url characters for the decoded 512-code-unit identity. The consumer requires a strict alphabet and exact UTF-8/base64url round trip before rebuilding and validating the root URL; malformed UTF-8, noncanonical padding and forged traversal cannot bypass validation. Existing authentication and project-access checks still run before redirect.
- **A3 identity / credentials:** file deep links permit one `open` field and no `code`, origin or arbitrary extra parameter; the existing connect parser also rejects `open` and duplicate codes. Configured project identity precedes exact folder slug fallback. The native resolver only inspects remembered absolute project roots and does not switch them. Foreign-project changes require the existing explicit dialog action, while same-project navigation performs a file selection. The link carries no credential or grant of membership.
- **A1/A6/A8:** new labels use React text escaping. New URLs use scheme-constrained constructors/encoders. No new dynamic execution, shell string, raw HTML sink or unsafe deserializer. E2E clipboard commands use fixed executable names and arguments.
- **A2/A4/A10/A11/A12:** regex candidates were comments, test data, existing non-security labels/identifiers, Set/Map operations and pre-existing log descriptions. No added secrets, crypto changes, dependency changes or credential logging.

## Focused closeout re-review

- `apps/desktop/src-tauri/src/oauth.rs:416`: the compiled cloud-zone arm now permits a root URL containing exactly one `open` pair validated with the native path validator. Fragments, asset/deep routes and additional parameters remain refused. Both pre-parse and serialized unsafe-byte checks remain intact, as do HTTPS, port, dot-boundary and compiled-zone constraints. This repairs the ordinary ASCII file-link browser action without introducing a general opener.
- `apps/studio/client/panels/file-deep-link-dialog.jsx:43`: launcher rejection now gives an explicit instruction to copy the web link. Percent-encoded or Unicode paths remain refused by the existing native launcher hardening; that limitation is visible and the copy action remains available.
- `apps/hub/src/return-to.mjs`: the expanded encoded-address bound applies the original 512 limit to decoded file identity, allowing long Unicode names while bounding cookie storage. Strict canonical base64url/UTF-8 decoding, repeated path validation, duplicate-cookie rejection and normal authentication remain in place. Static review of added tests covers forged traversal, invalid UTF-8, padding, oversize values, duplicates and the 512-unit Unicode boundary.
- `apps/desktop/src-tauri/src/deep_link.rs`: the updated trust comment accurately distinguishes same-project file navigation from project-switch confirmation.

Summary: 0 security blockers, 0 security warnings. The one functional integration issue identified by this reviewer is corrected; runtime checks are owned by the parent.
