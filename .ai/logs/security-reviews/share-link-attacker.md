# Share-link attacker review

Date: 2026-09-14. Result: **PASS — no confirmed security blockers** in the uncommitted feature diff against `cf0fc4182af8aa0e93f2bdcf97bcb2c62c6f0ee9`.

Plan: `.ai/plans/feature-share-link-deeplink.md`. Reviewed the client file-address helpers, shell navigation, Share and foreign-project dialogs, both deep-link parsers and pending-slot logic, native resolver/IPC/navigation, Hub return-cookie code, its four redirect callers, and the focused JavaScript/Hub/Rust test sources. Default security floor: medium; AI review enabled. This was a static adversarial review; no exploits, live authentication, external writes, or additional tests were executed.

## Trust boundaries and attempted chains

- **Attacker link → authenticated Hub navigation.** I considered cookie tossing and query pollution (`/?open=a&next=//evil`), encoded separators/control characters, and nested escaping. The cookie value is untrusted when read. It must be canonical UTF-8 base64url (maximum 2048 characters); after decoding, its reconstructed target is accepted only as a canonical root `/?open=` address. Duplicate cookies, invalid UTF-8/base64 representations, oversized identities and malformed paths are rejected. Authentication still occurs before session issuance. The four changed redirects (OIDC success, signout, local-password success, cloud exchange success) all call the same validator/consumer; cookie appending preserves session/transaction cookies. Even a forged valid return cookie only selects a file within the existing project; it cannot change origin or confer membership. This is the narrow-destination pattern recommended by [OWASP's redirect guidance](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html).
- **URL file identifier → local file selection.** I traced `%252e%252e`, `%2f`, drive prefixes, controls, repeated separators and filenames containing literal `%`, `&`, `#` or `+`. Values are decoded once at the URL boundary; later transport encoding preserves them as data. Selection must match an actual loaded-tree entry before existing open/preview paths run. A double-encoded traversal string is a literal filename, not a second filesystem traversal pass. The native optional `open` argument is validated again and appended with URL query-pair serialization to an already checked loopback destination.
- **External `maude://` → privileged desktop action.** I considered mixing `code` and `open`, injecting an origin, using similar project names, and replacing a pending confirmation immediately before its click. File links accept only one `open` parameter and reject every other key; connect links reject `open` and duplicate `code`. The client retains the first pending item. Configured hub identity takes precedence over exact folder-slug fallback; resolution only returns remembered absolute project folders. A different project needs confirmation before the existing switch command, and a file link cannot attach cloud credentials. Same-project automatic navigation is intentional and opens an already available file.
- **Foreign-project fallback → OS browser.** The URL comes from local cloud configuration plus the parsed project/file identity, with a native opener as the last boundary. The final opener change permits only a single `open` field whose decoded identity passes the Rust validator, while preserving root-only routing, no fragment, approved cloud hosts and both raw/serialized unsafe-byte checks. I reviewed the final diff: encoded URLs still fail closed and the dialog offers copying as the fallback. No arbitrary route, extra query capability, origin override or OS-launch bypass was introduced.

## Exploit chains

No viable chain across defender findings. The original native browser-opener mismatch was repaired narrowly and the final policy does not combine with cookie or deep-link handling to elevate privilege. No confirmed attacker findings are being added to the defender's result.

## AI / MCP attack surface

N/A — this feature changes no model prompt, tool definition, MCP server, dependency, or model-output-to-system pipeline. Its new Rust IPC command is a deterministic local-project lookup, not an LLM/MCP tool. File identifiers stay structured navigation data; no new automatic model call or outbound agent action was found. Accordingly no new trifecta or cross-MCP confused-deputy path was introduced. Reviewed against [OWASP LLM01](https://genai.owasp.org/llmrisk/llm01-prompt-injection/); no AI-specific finding or applicable new-package CVE is claimed.

## Adversarial creativity pass

A malicious sibling tenant could try to seed a valid `maude_return` cookie or send a familiar-looking project slug so an authorized member opens an attacker-chosen canvas after sign-in. The chain stops at the project's existing file set/access boundary and at exact local identity matching; the link supplies neither file contents nor a writable origin nor a credential. This observation is not a vulnerability finding.

## Follow-ups and limits

- Final native opener and compact-cookie diffs re-reviewed: **PASS**, with 0 new findings. Reviewed the added Rust cases for extra/duplicate fields, traversal, non-root paths, fragments and OS-unsafe encoded/Unicode URLs. Reviewed the Hub cases for a 512 UTF-16-unit CJK identity, bounded cookie size, forged traversal/control identities, non-canonical base64, invalid UTF-8, excessive size and duplicate cookies. Parent executes these tests.
- The `deep_link.rs` trust-posture comment now accurately distinguishes current-project file navigation from foreign-project confirmation.
- Long Unicode links now keep the 512-unit identity limit while allowing its bounded percent-encoded address (maximum 4615 characters); canonical UTF-8 base64url keeps the cookie under browser size limits. This changes transport representation, not trust or authentication.
- Read the local-password and real-signed/fake-network OIDC integration tests and both JS/Rust validation tests. Their execution evidence belongs to the parent validation report, not this review.
- This review does not prove real deployed cookie behavior, signed-app OS scheme registration, or pre-existing canvas isolation/IPC implementation. It does not audit unrelated historical security findings.
