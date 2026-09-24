# DDR-242 — Embedding origins are a framing list, separate from shell origins

- **Status:** Accepted — 2026-09-23
- **Extends:** DDR-054 (canvas origin split), DDR-209 (the hub proxies the real studio)
- **Related:** DDR-122 (collab origin gate), DDR-105 (same-origin write guard)

## Context

orbit (StudyFi's task tracker, `https://orbit.studyfi.com`) needs to show a live design from the
team's self-hosted hub (`https://design.studyfi.com`) next to a task. Framing needs two things the hub
did not have: the studio page and the canvas shell must name the embedder in `frame-ancestors`
(frame-ancestors checks EVERY ancestor, so the canvas iframe inside the studio page needs it too), and
a signed-out viewer must get something other than a redirect to the sign-in page, which refuses to be
framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`) because it collects a password.

The obvious lever was `MAUDE_EXTRA_SHELL_ORIGINS`, which already feeds the canvas shell's
`frame-ancestors`. But the hub's canvas door (`studio-proxy.mjs`) also reads that list as the set of
origins allowed to make **cross-origin canvas writes** with the ambient capability cookie. Adding an
embedder there would give the embedding app's pages write power over the canvas lanes — a framing
need answered with a write grant.

Separately, the studio page (`/`, `/index.html`) was served with no `X-Frame-Options` and no CSP at
all, so any site could frame a signed-in studio (clickjacking).

## Decision

1. **A new variable, `MAUDE_EMBED_ORIGINS`, is a framing list and nothing else.** Space/comma
   separated, each entry normalized to a bare origin; wildcards, credentials, non-http(s) schemes and
   the opaque `null` origin are dropped (fail closed). Parsed identically by the studio
   (`apps/studio/embed-origins.ts`) and the hub (`apps/hub/src/embed-page.mjs`). The hub passes it to
   the studio child (`childEnv`). It is NEVER read by the canvas door's write allowlist or by the
   collab socket origin gates — a test pins the 403.
2. **The studio page now always sends `frame-ancestors 'self' <shell origins>`, and adds the embed
   origins ONLY on a `?embed=1` request** — the full studio is never an embedder's to frame.
   Nothing legitimate frames it cross-origin today: the desktop navigates its webview to it
   top-level, and every iframe the studio creates is a canvas shell. The canvas shell's
   `frame-ancestors` gains the embed origins as well (every ancestor is checked). On `?embed=1`
   the page also sends **`frame-src 'self' <canvas origin>`**, so a hostile canvas cannot navigate
   its own frame to a foreign origin (a look-alike sign-in page) inside the embedding app.
3. **`?embed=1` is a separate client root, not a mode of `<App>`.** `client/embed-view.jsx` renders
   one canvas with `ro=1&comments=0&embed=1` and drives the existing Presentation Mode
   (`view-chrome` `present`) — so it persists no prefs, never rewrites the address bar, and mounts
   none of the shell. `embed=1` in the canvas URL stops the camera from being persisted.
   **Read-only is enforced server-side, not by the client flags.** The embed reads its config as
   `/_config?embed=1` (boot and every re-mint); the hub proxy answers that with a canvas capability
   minted at the viewer floor with a signed `ro` claim (`render-token.mjs`). The canvas door
   refuses every unsafe method carrying it (403 `read-only`, checked before the role table, so
   not even a viewer's comment lane), whether it arrives as `?t=` or as the cookie, and refuses
   the collab WebSocket for it (the HMR socket, which ignores inbound frames, stays open). The
   embed never holds or refreshes a full capability. A standalone studio (desktop) has no
   capabilities at all; there the flags are the UI and the loopback boundary is the guard, as before.
4. **The contract to the embedder is one-way and origin-pinned:**
   `{ source: 'maude-hub', v: 1, type: 'ready' | 'auth-required' | 'not-found' | 'escape', open, title? }`
   (`escape` added additively, 2026-09-23: keys inside a frame never reach the embedding page, so
   an unconsumed Escape in the canvas is relayed canvas → studio page (`dgn:'embed-escape'`,
   origin + source checked) → embedder, or posted directly when pressed on the studio page. The
   embed never takes focus on its own — the canvas's pointer-enter autofocus is off in embed
   mode — so a keyboard user in the embedder's dialog is never stranded),
   posted only to the parent's exact origin (`ancestorOrigins[0]`, else the referrer's origin) and
   only when it is on the embed list (exposed to the client via `/_config.embedOrigins`). Nothing is
   accepted from the parent.
5. **Signed out + `?embed=1` + a non-empty embed list ⇒ a frameable page** (401, no assets, script
   pinned by hash, `frame-ancestors 'self' <embed origins>`) that links to the normal sign-in in a
   new tab (returning to `/?open=<file>` via the validated return-to) and posts `auth-required`.
   Every other signed-out request keeps the existing redirect.

## Consequences

- An embedding app must be **same-site** with the hub: the `maude_studio` session cookie is
  `SameSite=Lax` and the canvas capability cookie `SameSite=Strict`; cross-site framing would need
  third-party cookies. Documented, not worked around.
- Adding `frame-ancestors` to the studio page changes behaviour for anyone who was framing it
  cross-origin without being a shell. No such consumer exists in this repo.
- Two parsers must stay in step (studio TS, hub mjs); both carry a twin comment.
- An embedded canvas gets no live collab socket: it follows source edits over HMR, but live
  annotation/comment updates arrive on the next load. Accepted — the embed is for looking.
- **Writes and sockets need the explicit capability (re-review, 2026-09-23).** The `maude_canvas`
  cookie is one per canvas origin, and the canvas origin is same-site with the embedder, so inside
  an embed it could hold the designer's FULL capability from another tab; canvas code omitting
  `?t=` would have written with it. The canvas door now authorises POST/PUT/PATCH/DELETE and every
  WebSocket upgrade ONLY from a valid `?t=`, never from a cookie; cookies authorise asset GETs
  only. Legitimate canvas code never built `?t=` itself (canvas-lib, annotations, media drop and
  use-collab use bare relative URLs), so the shell document (`templates/_shell.html`) wraps
  `fetch` (unsafe methods, same host) and `WebSocket` (same host) to append THIS frame's live
  capability — re-minted via `canvas-cap` — and does nothing on a desktop, which has none. This
  exposes nothing new: canvas code could always read `?t=` from its own URL. The embed's
  read-only capability is planted as a separate cookie, `maude_canvas_embed`, so an embed load
  never overwrites (downgrades) the designer's `maude_canvas`. Chosen over "a separate embed cookie
  only" because that alone would not stop an embedded canvas riding the full cookie for a write.

## Rejected

- **Reusing `MAUDE_EXTRA_SHELL_ORIGINS`** — grants write power to a read-only embed (see Context).
- **A chromeless mode inside `<App>`** — every shell side effect (prefs, address bar, panels, chat)
  would have to remember to check a flag; a separate root makes the safe behaviour the default.
- **Posting to `'*'`** — the message names which file a viewer is looking at; it goes to the one
  allowlisted parent or nowhere.
