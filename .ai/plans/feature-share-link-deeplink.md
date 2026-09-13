# Feature: Share link + deep link for canvases and files (desktop · browser · cloud)

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

## Description

Every file the studio can open gets an **address**. Today the shell URL is always the root (`alligators.cloud.maude.sh`) no matter which canvas is open, the shell never reads or writes `location`, and there is no Share affordance anywhere — the read-only gallery of DDR-200 was deliberately deleted (Cloud Phase 25 C5: "share = the real project URL for people who have access"). This feature adds:

1. **A shell URL contract** — `/?open=<designRoot-relative path>` (e.g. `/?open=ui/Studio.tsx`), read on boot and kept in sync with the active tab (history push/pop), in all three shells (desktop, local browser, cloud).
2. **A Share dialog** reachable from the **topbar** (icon button + File menu + command palette) and from the **file-tree ⋯ menu** on any row, offering copyable **web link**, **app deep link** (`maude://…`) and, where that is all there is, a **this-Mac-only local link**.
3. **A `maude://open/<project>?open=<path>` deep link** that opens the desktop app on that project + file — same verb the cloud-connect handoff already uses, second param shape, same park-then-ask posture (DDR-109, `maude-protocol-deep-link-park-ask-exchange`).
4. **Cloud sign-in that returns to the shared file** — the hub remembers the requested `?open=` in a short-lived cookie and returns there after `/auth/browser?code=…` instead of always redirecting to `/`.

## User Story

As a Maude user (desktop, browser or cloud) I want to copy a link to the canvas or file I am looking at, so that a teammate opens exactly that file — in the cloud studio in their browser, or in their Maude desktop app — and so that the cloud address bar reflects what I have open.

## Problem

- `apps/studio/client/app.jsx:9647` — `activePath` is React state only; `openTab()` (`:11975`) never touches the URL. Cloud has an "auto-open first canvas" guess (`:12017`) because a link-follower lands on an empty pane.
- `apps/hub/src/browser-auth.mjs:306,370,446,536` — every sign-in completion does `redirect(response, '/')`; the control plane (`apps/cloud/handoff.mjs:124-128`) deliberately derives the return address from the project id and **never** takes one from the query, so a return target cannot ride through the control plane — the hub must keep it itself.
- `apps/studio/client/panels/CloudBar.jsx:113` `parseDeepLink` accepts only `maude://open/<project>?code=mhc_…`; any other shape is dropped (correct per DDR-109 — the allowlist must grow explicitly).
- No project-id → local-folder resolver on the desktop (`app_recent_projects` returns absolute paths only).
- No Share UI. `StIcon` already has `share` and `link` glyphs (`app.jsx:559`); the `share` glyph is used by "Handoff to production" only.

## Solution

**Contract A (debate outcome — shipper + breaker converged, builder's history-sync folded in, builder's `/f/<path>` path routing rejected):**

- **URL**: `<shell base>/?open=<rel>` where `<rel>` is the designRoot-relative path **with extension** (`ui/Studio.tsx`, `system/maude/README.md`). It is the same identifier `_canvas-shell.html?canvas=` already uses and the same spelling `resolveCanvasAbs()` accepts. It rides on `/`, the one path every layer already allows (studio `http.ts:5225`, hub manifest `studio-manifest.mjs:46`, cell pass-through `worker.mjs:107`), so **no new route** anywhere. The URL is built **relative** (`?open=…` against `location`), never origin-absolute (canvas-shell base decision, DDR-209 follow-on).
- **Public identity comes from configuration, never from the server's Host header** (`server.ts:650`). Client-side: on the cloud shell `location` *is* the typed address and is used; on desktop/local the web link is built from `linkedHub.url` (`/_api/cloud/status`), and if no hub is linked there is **no web link** — the dialog says so instead of emitting a localhost URL as if it were shareable.
- **Deep link**: `maude://open/<project>?open=<rel>`. Parser accepts `open/<project>` with **exactly one** of `code` (connect) or `open` (file); both → drop. Current-project match → open the file directly (nothing is written, nothing switches — no modal needed). Other project → decision modal naming both sides, resolved to a local folder by a new narrow Rust command; no match → "not on this Mac" with the web link as the way out. Never `openLocalProject()` straight from a URL.
- **Hub return-to**: a `maude_return` cookie (HttpOnly, Secure, SameSite=Lax, 10 min) set only when an HTML navigation to `/` carries a valid `?open=`; consumed once by a single `takeReturnTo()` helper used at all four redirect sites; value validated as `/?open=<rel>` and nothing else (no scheme, no `//`, no `\`, no `..`, ≤ 512 chars). Invalid → `/`.

**Rejected** (recorded here so `/flow:done` can DDR it): (B) `/c/<slug>` or `/f/<path>` path routing — three route tables (studio SPA fallback, hub manifest, cell) that must not drift (the DDR-088 two-allowlist class, now three), lossy slugs (`ui/Foo` vs `ui-foo` collide). Can be layered later as an alias that rewrites to `?open=` without breaking A. (C) `#open=` hash — dropped through the sign-in round trip; green for the author, dead for the recipient.

## Metadata

- **Ticket**: none yet (provider `github`) — open an issue at `/flow:done` if a PR is raised
- **Type**: New Capability
- **Complexity**: High
- **App/Package**: `apps/studio` (client + tests), `apps/hub` (browser-auth + server), `apps/desktop` (Rust deep-link/project resolver), `apps/desktop/e2e`, `site` docs
- **Affected Systems**: studio shell routing, topbar + file tree, cloud browser door sign-in, `maude://` allowlist, desktop project switch
- **Dependencies**: none new (tauri-plugin-deep-link, sonner notifications, StIcon all present)

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message** (multiple Read tool calls) — they're independent context loads.

- `apps/studio/client/app.jsx` (lines 9640-9700 `tabs`/`activePath`; 11970-12060 `openTab`, `wsSend tabs/active`; 12010-12040 cloud auto-open guess; 4265-4508 `Menubar` incl. right icon group 4473-4508; 3903-3935 `FileDropdown` items; 4337-4348 dispatch; 14670-14700 keyboard chords; 14870-14895 command palette entries; 2825-2870 `useRowMenu` + `rowMenuRootItems`; 2376-2388 + 2528-2540 kebab trigger; 243-251 `pathTestIdSlug`; 1510-1530 + 1824-2133 `ExportDialog` markup; 10179 `exportDialog` state; 16294-16311 dialog mount; 337-339 `shellToast`; 4290-4300 `cloud.dashboardUrl`) — Why: every client touch point lives here.
- `apps/studio/client/tree-row-menu.jsx` — Why: `rootItems = [{id,label,onSelect,disabled?,destructive?}]` is the shape the new `Share…` item must take.
- `apps/studio/client/canvas-url.js` — Why: the designRoot-relative `canvas` vocabulary the share link reuses; also the model for a pure, `bun:test`-able helper module.
- `apps/studio/test/canvas-url.test.ts` — Why: the test shape to mirror for `share-link.test.ts`.
- `apps/studio/client/panels/CloudBar.jsx` (lines 113-124 `parseDeepLink`; 425-470 local-identity hint incl. kebab-containment match; 473-519 deep-link consumption + `connectPending`; 641-656 `copyToClipboard`; 688-790 decision modal `cloud-deeplink-dialog`) — Why: the parser to extend, the modal family to reuse, the clipboard pattern.
- `apps/studio/client/github.js` (lines 10-28 `isNativeApp`/`invoke`/`listen`; 93-102 `openLocalProject`, `appRecentProjects`) — Why: the Tauri bridge the file deep link calls.
- `apps/studio/notifications.tsx` — Why: `notify({title, kind:'success'})` for "Link copied".
- `apps/studio/api.ts` (lines 3628-3653 `resolveCanvasAbs`) — Why: the normalization rules (`designRel` strip, reject absolute/`..`/`.`/empty) the client-side `normalizeOpenParam` must mirror exactly — one vocabulary, one set of rules.
- `apps/studio/http.ts` (lines 1785-1795 `/_config` cloud block; 2584-2600 `/_api/cloud/status` `{project, linkedHub}`; 5225-5226 `/` route) — Why: where the client learns hub URL + project; confirms `/` ignores the query.
- `apps/studio/server.ts` (lines 650-676) — Why: "PUBLIC IDENTITY COMES FROM CONFIGURATION, NEVER FROM THE REQUEST" — the rule the web-link builder must honour.
- `apps/hub/src/browser-auth.mjs` (lines 60-90 cookie helpers + `redirect`; 306, 370, 446, 536 the four `redirect(response,'/')` sites; 453-475 `/auth/browser` entry) — Why: the return-to consumption sites.
- `apps/hub/src/server.mjs` (lines 1477-1489 the `sign-in` verdict branch — HTML nav → 302, API → 401) — Why: where the return-to cookie is SET.
- `apps/hub/src/studio-door.mjs` (lines 140-172 `signInUrl`) — Why: the redirect target; confirms the control plane gets only `/auth/browser`.
- `apps/hub/test/studio-door.test.mjs`, `apps/hub/test/auth-hardening.test.mjs` — Why: hub test conventions (node test runner, request/response fakes).
- `apps/desktop/src-tauri/src/deep_link.rs` — Why: park-only handler; unchanged, but the trust comment (lines 11-16) is the contract.
- `apps/desktop/src-tauri/src/lib.rs` (lines 377-400 `open_local_project`/`remember_and_switch`; 486 command registration; 565-574 deep-link wiring; 655-656 stale "deferred to phase-29" comment) — Why: the switch entry point that gains an `open` param; 4-site command registration.
- `apps/desktop/src-tauri/src/sidecar.rs` (lines 776-845 `switch_project` → `window.navigate(loopback url)`) — Why: where `?open=` is appended to the navigate URL after a switch.
- `apps/desktop/src-tauri/src/app_state.rs` — Why: `recent_projects[]` the resolver searches.
- `apps/desktop/src-tauri/capabilities/default.json` + `apps/desktop/src-tauri/permissions/autogenerated/take_pending_deep_link.toml` + `.claude/rules/tauri-desktop.md` — Why: FOUR-site registration precedent for a new command.
- `apps/desktop/e2e/scenarios/cloud-attach.e2e.ts`, `apps/desktop/e2e/wdio.cloud.conf.ts` (lines 14-16 deep-link event stub), `apps/desktop/e2e/scenarios/export-formats.e2e.ts` — Why: e2e patterns for a dialog scenario and for injecting a `maude://deep-link` event.
- `.ai/archive/decisions/DDR-109-native-shell-security-model.md` (§3), `DDR-200-read-only-share-view-serves-bytes-not-code.md`, `DDR-209-one-studio-three-shells-the-cell-serves-the-studio.md` — Why: allowlist rule; why the gallery is gone; the three-shells model this feature must keep unified.

### Files to Create

- `apps/studio/client/share-link.js` — pure helpers: `normalizeOpenParam(raw, designRel)`, `readOpenParam(location)`, `withOpenParam(location, rel|null)` (relative URL, never origin-absolute), `buildShareLinks({rel, shell:'cloud'|'local'|'native', location, linkedHubUrl, project, localUrl})` → `{web: string|null, app: string|null, local: string|null, projectLabel}`, `projectIdFromHubUrl(url, zone)`, `parseFileDeepLink(url)`.
- `apps/studio/test/share-link.test.ts` — `bun:test` unit tests (hostile inputs, relative-URL invariant, no-hub → `web:null`).
- `apps/studio/client/share-dialog.jsx` — `ShareDialog({target, links, onClose})` on the `st-scrim`/`st-dialog` pattern.
- `apps/hub/src/return-to.mjs` — `RETURN_COOKIE`, `validateReturnTo(value)`, `setReturnTo(response, value)`, `takeReturnTo(request, response)` (returns `'/'` when absent/invalid, always clears the cookie).
- `apps/hub/test/return-to.test.mjs` — validator + take semantics.
- `apps/desktop/src-tauri/src/project_resolve.rs` — `resolve_project_for_link(project) -> Option<String>` + `validate_open_param(open) -> Option<String>` with `#[cfg(test)]` unit tests.
- `apps/desktop/src-tauri/permissions/autogenerated/resolve_project_for_link.toml` — generated by build.rs, must be committed.
- `apps/desktop/e2e/scenarios/share-link.e2e.ts` + `apps/desktop/e2e/wdio.share.conf.ts` (or extend `wdio.conf.ts`'s scenario list) — native scenario.
- `site/content/docs/share-links.mdx` (or a section in the existing cloud/browser doc) — public reference.

### Design canvases

| Canvas | Status | Tags | Notes |
| ------ | ------ | ---- | ----- |
| `.design/ui/Studio.tsx` | — | — | The studio shell mockup: topbar right icon cluster (line ~909 renders `share`/`code`/`download` icons) and the File menu group `["share", "Handoff to production", "⇧⌘H"]` (line 810). Ground the Share button placement and the File-menu wording here — it is the Tier-0 shell prior. No canvas exists for the Share dialog itself; mirror `ExportDialog`. |

### Documentation

- [Tauri deep-link plugin](https://v2.tauri.app/plugin/deep-linking/) — Why: `on_open_url` delivers the full URL string incl. query; nothing to change in Rust for parsing, only in the client. Already relied on by `?code=`.
- [MDN History API](https://developer.mozilla.org/en-US/docs/Web/API/History_API) — Why: `pushState`/`popstate` for tab ↔ URL sync; works in WKWebView.
- [MDN Set-Cookie SameSite=Lax](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#samesitesamesite-value) — Why: the return-to cookie set on `GET /` must still be sent on the top-level navigation back to `/auth/browser?code=` from the control plane — Lax sends cookies on cross-site top-level GETs, so it does.

### Patterns to Follow

Topbar icon button (`app.jsx:4473-4508`):

```jsx
<button className="st-mb-icon" data-testid="report-bug-btn" data-tip="Report a bug" aria-label="Report a bug" onClick={…}>
  <StIcon name="bug" size={15} />
</button>
```

Tree ⋯ menu items (`app.jsx:2838-2867`):

```js
const rowMenuRootItems =
  menuExtra?.kind === 'file'
    ? [{ id: 'move-to', label: 'Move to…', onSelect: () => rowMenu.showMoveTo() }]
    : …
```

Clipboard + flash (`CloudBar.jsx:641-656`):

```js
function copyToClipboard(text, mark) {
  navigator.clipboard?.writeText(text).then(() => { mark(true); setTimeout(() => mark(false), 1500); }).catch(() => {});
}
```

Deep-link consumption (`CloudBar.jsx:473-495`): `invoke('take_pending_deep_link')` on mount + `listen('maude://deep-link', consume)`; `setPending((current) => current ?? parsed)` — a second link never replaces a dialog already on screen.

Hub cookie (`browser-auth.mjs:71-79`): `` `${NAME}=${encodeURIComponent(v)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${n}` ``.

---

## Design Decisions

### Components (from registry)

| Component | Source | Notes |
| --------- | ------ | ----- |
| `st-dialog` family (`st-scrim`, `st-dialog-hd/bd/ft`, `st-iconbtn`, `btn btn--ghost/--primary`) | `apps/studio/client/app.jsx:1824-2133` (ExportDialog) + `client/styles/4-components.css` | ShareDialog reuses it verbatim; three "link rows": label + read-only input + Copy button. |
| `TreeRowMenu` / `useRowMenu` | `apps/studio/client/tree-row-menu.jsx` | Add `{ id:'share', label:'Share…' }` for `kind:'file'` (before `Move to…`). |
| `DropdownMenu` (File menu) | `app.jsx:3903-3935` | Add `{ id:'share', label:'Share link…' }` after Export. |
| Command palette entry | `app.jsx:14877-14890` | `{ id:'share-link', group:'Canvas', label:'Copy share link', icon:'link', run }`. |
| Decision modal (`gi-dialog` family, `cloud-deeplink-dialog`) | `CloudBar.jsx:688-790` | Reused for the "other project" branch of the file deep link — same testids family `cloud-deeplink-*` → new `file-deeplink-*`. |
| `notify()` | `apps/studio/notifications.tsx` | `notify({ title: 'Link copied', kind: 'success' })`. |

### Existing screens / blocks reused

| Screen / block | Source | Notes |
| -------------- | ------ | ----- |
| Studio shell topbar | `.design/ui/Studio.tsx` (Tier-0 shell prior) + `app.jsx` Menubar | Share icon goes into the right cluster, left of the Export badge. |

### Icons

| Icon | Library | Size | Usage |
| ---- | ------- | ---- | ----- |
| `share` | in-house `StIcon` (`app.jsx:559` STICONS) | 15 | topbar button |
| `link` | `StIcon` | 14/15 | palette entry, dialog row Copy buttons |
| `external` | `StIcon` | 14 | "Open in Maude app" anchor in browser shells |
| `check` | `StIcon` | 14 | copied state |

### Tokens

Studio client uses its own CSS (`client/styles/*.css`) with `st-*` classes — no Tailwind. No new colors; reuse `.st-dialog` tokens. Muted hint text uses the existing `.st-dialog-hint` / `.st-muted` class (verify name in `4-components.css` before use).

### Custom Components Needed

| Component | Reason | Extends |
| --------- | ------ | ------- |
| `ShareDialog` | no share surface exists | `ExportDialog` markup pattern |
| `FileDeepLinkDialog` (inside CloudBar or a sibling panel) | "open in another local project" confirm | `cloud-deeplink-dialog` |

---

## Tasks

Execute in order. Each task is atomic and testable.

Keywords: CREATE, UPDATE, ADD, REMOVE, REFACTOR, MIRROR

### Task 1: CREATE `apps/studio/client/share-link.js` + `apps/studio/test/share-link.test.ts`

- **Do**: Pure ES module (no React, no DOM globals at import time — takes `location`-like objects as args).
  - `normalizeOpenParam(raw, designRel='.design')`: decode once, strip a leading `<designRel>/`, reject `''`, absolute paths, `\`, control chars, any `..`/`.` segment, empty segments, length > 512; return the cleaned `rel` (`ui/Studio.tsx`) or `null`. Mirror `resolveCanvasAbs()` rules exactly (api.ts:3628).
  - `readOpenParam(location)`: `new URLSearchParams(location.search).get('open')` → normalize.
  - `withOpenParam(location, rel|null)`: returns a **relative** URL string (`?open=…` or `location.pathname` alone) — never `location.origin`. Encode with `encodeURIComponent` per path segment joined by `/` so slashes stay readable.
  - `projectIdFromHubUrl(url)`: first hostname label when the host has ≥ 3 labels, else `null` (self-host `http://127.0.0.1:port` → `null`, mirroring the CloudBar hint rule).
  - `buildShareLinks({ rel, shell, location, linkedHubUrl, project, localUrl })`:
    - `web`: `shell==='cloud'` → `location.origin + location.pathname + ?open=`; else `linkedHubUrl` → `new URL(linkedHubUrl)` origin + `/?open=`; else `null`.
    - `app`: `project ? 'maude://open/' + project + '?open=' + encoded : null` — `project` = `projectIdFromHubUrl` (cloud: `location.hostname` label; local: linkedHub) **else the folder basename** kebab-normalized, flagged `appIsLocalOnly:true`.
    - `local`: `shell !== 'cloud' && localUrl ? localUrl + '/?open=' : null`.
  - `parseFileDeepLink(url)`: `^maude:\/\/open\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)\/?\?(.*)$`; params must contain `open` and must NOT contain `code`; `open` goes through `normalizeOpenParam`; returns `{ project, rel }` or `null`.
- **Pattern**: `apps/studio/client/canvas-url.js` + `test/canvas-url.test.ts`.
- **Gotcha**: hostile inputs to test — `../.ai/x`, `/etc/passwd`, `ui/..%2F..`, `ui\\Foo`, `%00`, 600-char path, `maude://open/x?open=a&code=mhc_…` (both → null), `maude://join/…` (null), uppercase project (null).
- **Validate**: `cd apps/studio && bun test test/share-link.test.ts` — then `git status apps/studio/dist/` (bun test has clobbered `dist/` before; revert if dirty).

### Task 2: UPDATE `app.jsx` — URL ↔ active tab sync

- **Do**:
  - On boot, after `groups` (tree) has loaded: `const rel = readOpenParam(location)`; if `rel` matches a file in the tree → `openTab(<repo-relative path as the tree stores it>)`; if `rel` is valid but not in the tree → `notify({ title: 'Not here yet', description: '<rel> is not in this project (not synced yet?)', kind: 'info' })` and leave the pane empty; if invalid → ignore silently. **When `?open` is present, skip the cloud auto-open-first-canvas guess** (`:12017-12038`) — the guess stays only for a bare `/`.
  - In `openTab(path)`: after `setActivePath`, `history.pushState({ open: rel }, '', withOpenParam(location, rel))` — only when the URL's current `open` differs (avoids duplicate entries). Closing the last tab → `history.replaceState(null, '', withOpenParam(location, null))`.
  - `popstate` listener: read param → `openTab` **without** pushing (guard flag `navigatingFromHistory`).
  - Expose a small `useShareTarget()` = `{ rel: activeRel, shell: cfg.cloud ? 'cloud' : isNativeApp() ? 'native' : 'local' }`.
- **Pattern**: existing `wsSend({type:'active'})` site is where the URL write belongs — one place.
- **Gotcha**: the tree stores repo-relative paths with the `designRel` prefix (`.design/ui/Foo.tsx`); the URL carries the designRoot-relative form. Convert at the boundary with `normalizeOpenParam` / prefix-join, never compare raw strings. `history` calls must be relative — the canvas-shell base decision (`canvas-shell-base-and-local-data-plane-standin`) bit three times on origin-absolute URLs.
- **Validate**: `cd apps/studio && MAUDE_NO_AUTOBUILD=1 bun run server.ts --root /tmp/scratch-project` then `agent-browser open "http://localhost:<port>/?open=ui/Studio.tsx"` → `canvas-frame` testid present; click another canvas → address bar updates; browser back → previous canvas.

### Task 3: CREATE `apps/studio/client/share-dialog.jsx` + wire four entry points

- **Do**:
  - `ShareDialog({ target: {rel, label}, links, onClose })` — `st-scrim` + `st-dialog role="dialog" aria-label="Share <label>"`, `data-testid="share-dialog"`. Rows (only those with a value; `web:null` renders a muted hint "Connect this project to Maude Cloud to get a web link"):
    - **Web link** — `data-testid="share-web-url"` read-only input + Copy (`share-copy-web`).
    - **Open in Maude app** — `share-app-url` + Copy; in browser shells (`shell!=='native'`) also an `<a href={links.app}>Open in app</a>` (`share-open-app`); if `appIsLocalOnly` add hint "opens the folder on this Mac only".
    - **Local link (this Mac only)** — `share-local-url`, de-emphasized, native/local shells only.
  - Copy → `navigator.clipboard.writeText` (CloudBar pattern) → `notify({title:'Link copied', kind:'success'})`; button flips to `check` for 1.5 s.
  - State: `const [shareDialog, setShareDialog] = useState(null)` next to `exportDialog` (`:10179`); mount next to the ExportDialog mount (`:16294`). `links` computed via `buildShareLinks` with `linkedHubUrl` from `/_api/cloud/status` (already fetched by CloudBar — lift the value into shell state or re-fetch once on dialog open) and `localUrl` = `location.origin` for local/native shells.
  - Entry points: (a) topbar `<button className="st-mb-icon" data-testid="share-btn" data-tip="Share link" aria-label="Share link">` with `<StIcon name="share" size={15}/>`, placed left of `<ExportBadge>`; disabled with tooltip "Open a canvas to share it" when no active tab. (b) File menu item `{ id:'share', label:'Share link…' }` dispatched like `export`. (c) Command palette `{ id:'share-link', group:'Canvas', label:'Copy share link', icon:'link', run }` — copies the best link directly (web ?? app ?? local) with the toast, no dialog. (d) Tree ⋯ menu: `kind==='file'` gets `{ id:'share', label:'Share…', onSelect: () => setShareDialog({ path: menuExtra.path }) }` — targets **that row**, not the active tab.
- **Pattern**: `ExportDialog` (`app.jsx:1510`, markup `1824-2133`), `tree-row-menu.jsx` items.
- **Gotcha**: no keyboard chord is claimed in this pass (⇧⌘S is taken by the shell; ⇧⌘L is free but unverified against WKWebView) — palette + menu + button are the surfaces. `data-testid` convention: `<area>-<thing>[-<id>]`. Rename "Handoff to production"'s icon from `share` to `external`/`code` so `share` means Share.
- **Validate**: agent-browser: click `share-btn` → dialog; `share-web-url` value ends with `?open=ui/Studio.tsx` on a cloud-shaped run (`MAUDE_PUBLIC_CANVAS_ORIGIN` irrelevant — assert via a linkedHub stub in config.json) and `web` row absent on an unlinked local run; tree row ⋯ → `Share…` opens the dialog for that row.

### Task 4: UPDATE `CloudBar.jsx` — file deep link (`maude://open/<project>?open=<rel>`)

- **Do**:
  - Extend consumption: after `parseDeepLink(url)` returns null, try `parseFileDeepLink(url)`; keep the single-slot `setPending(current => current ?? parsed)` rule; tag `{ kind: 'file' }` vs `{ kind: 'connect' }`.
  - **Same project** (the existing hint logic — extract `localIdentityMatches(local, project)` from lines 425-470 into a helper so both dialogs share it: prefer `linkedHub` label, else kebab-containment of the folder basename) → `openTab(rel)` immediately; if `rel` is not in the tree → the same "Not here yet" notice as Task 2. No modal (nothing is written, nothing switches).
  - **Different project** → `FileDeepLinkDialog` (`data-testid="file-deeplink-dialog"`): "Open `<rel>` in **<project>**?" + the resolved local folder (from `invoke('resolve_project_for_link', { project })`), buttons `file-deeplink-open` / `file-deeplink-dismiss`. On open → `invoke('open_local_project', { path, open: rel })`. If the resolver returns `null` → the dialog says "<project> isn't on this Mac" and shows the web link (`https://<project>.<zone>/?open=<rel>`, zone from the configured cloud URL via `/_api/cloud/status` — **never** from a link param) as copy/open.
  - Fix the stale `lib.rs:655-656` "deferred to phase-29" comment while there.
- **Pattern**: `cloud-deeplink-dialog` (688-790), `connectPending` (497-519).
- **Gotcha**: the file link carries **no `origin` param and no code** — DDR-109 "secrets never in the link"; the zone comes from configuration only. `code` + `open` together → dropped (test in `cloud-endpoints.test.ts` next to the hostile-input block at lines 74-98).
- **Validate**: `cd apps/studio && bun test test/cloud-endpoints.test.ts test/share-link.test.ts`.

### Task 5: ADD Rust `resolve_project_for_link` + `open` param on `open_local_project`

- **Do**:
  - `apps/desktop/src-tauri/src/project_resolve.rs`: `pub fn resolve_project_for_link(app, project: String) -> Option<String>` — validate `project` with the same slug regex as the client; iterate `app_state::recent_projects()` + `last_project`; match (a) `.design/config.json` `linkedHub.url` first hostname label == project, then (b) kebab-normalized folder basename contains / is contained by project (mirror CloudBar containment). Return the first absolute path whose `.design/` exists. `pub fn validate_open_param(open: &str) -> Option<String>`: same rejection list as Task 1; used by `open_local_project`.
  - `lib.rs`: `open_local_project(path, open: Option<String>)` — validated `open` is appended as `?open=<encoded>` to the loopback URL `switch_project` navigates to (`sidecar.rs:776-845`, the `window.navigate(...)` site). Register the new command at **all four sites**: `generate_handler!`, `build.rs` `commands()`, `capabilities/default.json`, and commit the generated `permissions/autogenerated/resolve_project_for_link.toml`.
  - `github.js`: `resolveProjectForLink(project)` + `openLocalProject(path, open)` bridge signatures.
- **Pattern**: `take_pending_deep_link` registration (`.claude/rules/tauri-desktop.md`, memory in graph: "registration is FOUR sites").
- **Gotcha**: `#[cfg(test)]` unit tests for both functions (evil-project, `..`, absolute, `//`, unicode). `tauri dev` never receives real `maude://` links (scheme registers from the bundle) — verify the Rust piece via the e2e event stub + `cargo test`.
- **Validate**: `cd apps/desktop/src-tauri && cargo test project_resolve` and `cargo check`; `git status apps/desktop/src-tauri/permissions/autogenerated/` shows the new toml tracked.

### Task 6: CREATE `apps/hub/src/return-to.mjs` + wire set/take in the browser door

- **Do**:
  - `validateReturnTo(value)`: must match `^\/\?open=([^&#]+)$`, decoded rel passes the Task-1 rules (port the same regex — a `RETURN_RULES` comment names the client twin so they don't drift), no `//`, `\`, control chars, ≤ 512 → returns the canonical `/?open=<rel>` or `null`.
  - `setReturnTo(response, value)`: `maude_return=<v>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600` — **only** called from the `sign-in` branch in `server.mjs:1477-1489` when the request is an HTML navigation, `authPath === '/'` and the query validates. Append to any existing `set-cookie` array rather than overwriting.
  - `takeReturnTo(request, response)`: reads + validates the cookie, clears it (Max-Age=0), returns the value or `'/'`.
  - Replace the four `redirect(response, '/')` in `browser-auth.mjs` (306, 370, 446, 536) with `redirect(response, takeReturnTo(request, response))`. Note the `/studio/signin` local-mode POST is one of them — the cookie survives a form POST on the same site.
- **Pattern**: `setSessionCookie` / `clearSessionCookie` (`browser-auth.mjs:71-79`); tests like `apps/hub/test/auth-hardening.test.mjs`.
- **Gotcha**: open redirect is the top risk from the debate. Tests must prove: `https://evil`, `//evil`, `/\evil`, `/?open=../x`, `/admin`, `/?open=a&x=1`, 700-char value → `'/'`. The cookie is never set for API (non-HTML) requests. Both OIDC and local-password modes return to the target (one test each).
- **Validate**: `cd apps/hub && node --test test/return-to.test.mjs test/studio-door.test.mjs test/auth-hardening.test.mjs`.

### Task 7: MIRROR the shell URL in the cloud "back to dashboard" + docs

- **Do**: `site/content/docs/share-links.mdx` (or a section in the existing cloud docs page — check `site/content/docs/` for the browser-door page first): the URL contract, what each link kind means (web / app / this-Mac), that a link is a location not a token (access is still the project's membership). Run `pnpm --filter @maude/site gen:reference` if the docs index is generated.
- **Gotcha**: the `site-content` quality gate fails on a stale generated index.
- **Validate**: `pnpm --filter @maude/site build`.

### Task 8: ADD desktop e2e `share-link.e2e.ts` + rebuild the committed client bundle

- **Do**:
  - Scenario: boot on the fixture project → click `share-btn` → `share-dialog` visible, `share-app-url` value starts with `maude://open/` and ends with `?open=ui/…`; tree row `tree-row-menu-<slug>` → `Share…` → dialog for that row; then emit the `maude://deep-link` event through the existing stub pattern (`wdio.cloud.conf.ts:14-16`) with `maude://open/<fixture-project>?open=ui/<other>.tsx` → `canvas-row-<slug>` becomes active and no `file-deeplink-dialog` appears (same-project branch); emit one with a foreign project → `file-deeplink-dialog` visible and the active canvas is unchanged (park-and-ask). DOM-driven only, `data-testid` selectors (memory `feedback_prefer_dom_driven_e2e_not_computer_use`).
  - Rebuild: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` → commit `dist/client.bundle.js` + `dist/styles.css`.
- **Pattern**: `cloud-attach.e2e.ts`, `export-formats.e2e.ts`; skill `desktop-e2e`.
- **Gotcha**: `git status apps/studio/dist/` before and after every `bun test`; only the `--release` rebuild may change `dist/`.
- **Validate**: `pnpm test:e2e:desktop:build && pnpm test:e2e:desktop -- --spec scenarios/share-link.e2e.ts` (exact spec flag per the `desktop-e2e` skill).

### Task 9: ADD What's New entry + DDR sweep (at `/flow:done`)

- **Do**: `whats-new-entry` skill — "Share any canvas: a link that opens it in the browser or in Maude" with a spotlight step on `share-btn`. Record via `/flow:record-ddr` (graph-native): (1) *Shell URL contract `/?open=<rel>` — one identifier for iframe, share link and deep link; public identity from configuration* (REFERENCES `canvas-shell-base-and-local-data-plane-standin`, DDR-209); (2) *`maude://open/<project>?open=<rel>` — the file verb; exactly one of `code`/`open`; current-project links open directly, others park-and-ask* (EXTENDS `maude-protocol-deep-link-park-ask-exchange`, `cloud-connect-zone-locked-opener-and-deep-link-decision-modal`); (3) *Hub return-to cookie — the hub, not the control plane, remembers where a sign-in started* (REFERENCES DDR-200's replacement rationale). Rejected alternatives (B)/(C) go into (1).
- **Validate**: `kg search "shell url contract"` returns the new node; `pnpm --filter @maude/site gen:whatsnew` diff committed.

---

## Validation

Run these commands to confirm zero regressions:

1. **Lint**: `pnpm lint`
2. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
3. **Tests**: `pnpm test && cd apps/studio && bun test test/sync-*.test.ts test/share-link.test.ts test/cloud-endpoints.test.ts --timeout 20000` (run the studio suite **alone** — memory: parallel runs contaminate) + `cd apps/hub && node --test` + `cd apps/desktop/src-tauri && cargo test`
4. **Build**: `pnpm --filter @maude/site build`; `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`
5. **Cross-platform scenario** (UI tasks): spawn the `scenario-runner` subagent for the web lanes (web-desktop, web-mobile) — boot the studio on a scratch project, open `/?open=ui/<canvas>.tsx`, open the Share dialog from topbar and from the tree ⋯ menu. Native lanes: the desktop e2e scenario from Task 8 (the studio has no iOS/Android surface — mark those skipped with the reason).
6. **Design System Guard**: spawn the `design-system-guard` subagent — the dialog must use the `st-dialog` family only, no new colors.
7. **A11y**: spawn the `a11y-auditor` subagent — dialog `role="dialog" aria-modal aria-label`, focus trapped + returned, Copy buttons labelled, Esc closes.
8. **Security**: `/flow:validate-security` — return-to open redirect, `?open` traversal, deep-link drive-by; the security auditor + ethical hacker must both see the hub cookie tests and the four redirect sites.
9. **Manual**: sign out of a cloud project in the browser, open `https://<project>.cloud.maude.sh/?open=ui/<canvas>.tsx`, sign in → land on that canvas (not `/`). Copy the app link in the browser, click "Open in app" → the signed desktop build opens the project + file (only verifiable in a **bundled** app — scheme registration is bundle-time; add it to the DDR-177 release smoke list).

---

## Scenario Coverage (UI tasks — required)

**Existing scenarios covering affected flows:**

| Scenario | Covers | Status |
| -------- | ------ | ------ |
| `apps/desktop/e2e/scenarios/cloud-attach.e2e.ts` | connect deep link park-and-ask (must stay green — parser change) | ✅ existing |
| `apps/desktop/e2e/scenarios/app-boots-and-renders-canvas.e2e.ts` | boot + canvas render (URL sync must not break it) | ✅ existing |
| `apps/desktop/e2e/scenarios/file-tree-move.e2e.ts` | tree ⋯ menu (`Move to…` still first-class) | ✅ existing |

**New scenarios to create:**

- `share-link` (desktop e2e, Task 8) — flow: open canvas → topbar Share → dialog rows → copy → tree ⋯ Share… → same-project file deep link opens directly → foreign-project link parks and asks. Persona: project owner on the desktop. Fixtures: the existing e2e fixture project with ≥ 2 canvases.
- `share-link-web` (`.ai/scenarios/`, agent-browser) — flow: `GET /?open=<rel>` boots to that canvas → switch canvas updates the URL → back button restores → Share dialog on an unlinked project shows no web row. Persona: cloud member in the browser. Fixtures: scratch project with a `linkedHub` stub in `.design/config.json` for the linked variant.

`/done` runs `scenario-runner` across 5 platforms. A scenario missing runners blocks `/done` — the two native mobile lanes are N/A for the studio and must be recorded as skipped-with-reason, not missing.

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] `/flow:utils-verify` passes after each task (Edit-Verify Loop, max 3 iterations)
- [ ] `/validate` passes overall:
  - [ ] Static (types, lint, format)
  - [ ] Tests (full suite incl. `share-link.test.ts`, `return-to.test.mjs`, `cargo test project_resolve`)
  - [ ] Build (site + `--release` client bundle committed)
  - [ ] **`scenario-runner`: 0 blockers, parity_ok=true** across web lanes; native = desktop e2e green; mobile lanes skipped-with-reason
  - [ ] `design-system-guard` subagent: 0 blockers
  - [ ] `a11y-auditor` subagent: 0 blockers (dialog)
  - [ ] `/flow:validate-security`: return-to, `?open`, deep-link findings all closed by tests
- [ ] Cloud address bar shows `?open=<rel>` for the open canvas; a signed-out visitor with such a link lands on it after sign-in
- [ ] Share available from topbar, File menu, command palette and tree ⋯ on every shell
- [ ] `maude://open/<project>?open=<rel>` opens the file (same project) or asks (other project); `code`+`open` together is dropped
- [ ] No localhost URL is ever presented as a web link
- [ ] Scenario report linked in PR description
- [ ] What's New entry written (pending version); three DDRs recorded in the graph
- [ ] Code follows project conventions, no regressions; only this feature's files staged (the tree is Syncthing-shared and dirty)
