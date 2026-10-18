# v1-keys golden vs feat after integration A3 — delta report

Status: **report only, golden NOT refreshed.** The golden (`apps/studio/test/characterization/v1/keys.txt`)
was last refreshed at the V2-4 gate (`0d19c46c`); since then the A1, A2 and A3 integrations merged. A refresh
is the lead's call (header of `v1-keys.test.ts`: "only in Phase 4, or for a lead-approved delta").

## How it was taken

- Tree: `suite-fix-a3` = `feat/maude-v2` at `58ac858d` + the three suite-fix commits (test-only, plus
  `canvas-notifications.tsx`, none of them touching the shell bundle). Shell bundle: the committed
  `apps/studio/dist/client.bundle.js` (`c0d436bb`, "rebuild the release client bundle over the A3 merges").
- One run through the lane: `V1_KEYS_BODY_OUT=<scratch> bun test test/characterization/v1-keys.test.ts`
  (4 lanes, the golden's dealing). The golden was never written (no `V1_KEYS_UPDATE`).
- Result: 240 cases in both, **52 changed**, `- 453 / + 414` lines — the same count the integrator's full
  suite run reported, so the delta is stable across two runs.
- Per-case `-`/`+` lines: [`v1-keys-delta-A3.cases.txt`](v1-keys-delta-A3.cases.txt).

## The headline

| record field | cases changed | meaning |
| --- | --- | --- |
| `keydown` (who sees the key, PREVENTED or default) | **0** | no key changed owner, binding or prevent |
| `to-shell` | 0 | no new or lost canvas→shell message |
| `writes` | 0 | no key writes anything new |
| `canvas` (canvas DOM) | 0 | |
| `to-canvas` | 4 | message **order** only, Present esc (S3.1) |
| `shell` (shell DOM after the key) | 50 | the panels the key opens/leaves look different |

So every changed case is a changed **surface**, not a changed **key**: the same key does the same thing,
and the shell DOM it lands on was redesigned by an A1–A3 slice.

## By slice

| slice (merge) | cases | what changed in the record |
| --- | --- | --- |
| **S3.1** Present in the one mode owner (A2, `7e8f7d39`) | `presenting/chrome Escape`, `presenting/chrome Shift+Escape`, `presenting/text Escape`, `presenting/canvas Escape` | `to-canvas` order on leaving Present: was `view-chrome · occluded-insets · set-mode mode=edit · comments-set`, now `occluded-insets · set-mode mode=edit · view-chrome · comments-set` (same set, `back()` sets the mode before the chrome). The two `text`/`canvas` ones also carry the S2.2–S2.4 inspector delta below. |
| **S2.2** Inspector frame (A1, `b4169acd`) | `in-canvas/canvas Meta+0`, `Meta+d`, `Enter` (×2 focus sets); `Meta+Shift+I` (canvas/chrome, canvas/text, shell/chrome) | the frame header: `inspector-crumbs` nav, `inspector-title` ("main"), crumb chevrons appear; the two header `svg` icons of the v1 panel header are gone. `Meta+d`'s old height/transform-origin readouts (the named one-off variant) are now the frame. |
| **S2.3 + S2.4** Position/Size/Layout + paint sections (A1, `42c7d230`, `3e623add`) | `canvas/chrome t`, `canvas/select t`, `canvas/range t`, `in-canvas/canvas t`, `Escape`, `Shift+Escape`, `Meta+Escape`, `Meta+Shift+I`, `Meta+Shift+M`, `Backspace`, `Meta+a`, `Meta+Shift+A`, `Enter`; `in-canvas-text/canvas Meta+Shift+I`; `in-canvas-selected/canvas Escape`, `Backspace`, `Enter`, `Meta+a`, `Meta+Shift+A`; `tauri/in-canvas/canvas Meta+Shift+A` | the v1 controls (`st-cp-*` segment buttons, scrub box inputs `padding-*`, section resets, `raw override` provenance) are replaced by v2 `insp-chip` (Fill, Text colour, Text size), `insp-num-*` (Padding H/V, Width/Height) and `insp-sides`; opening (`t`) is +199 lines instead of +550, closing (`Escape`…) −2xx instead of −538. |
| **S2.5** Interaction + Export slot (A2, `fdc58f1c`) | inside the same `t` cases | `insp-add-interaction` joins `insp-add-border` / `-effects` / `-fill`. |
| **S1.1** Canvases panel at scale (A1, `16fb7dcd`) | `canvas/text Slash`, `t`, `Shift+T`, `h`, `s`, `n`, `c`, `Space`, `Digit0`, `Shift+Slash`; `timeline/text Space` | the left panel rows are now `cv-*` (`cv-item`, `cv-main`, `cv-head`, `canvases-head-project`, `canvases-sort` "Recent", `canvases-foot`, `canvases-other-files` tree) instead of v1 `st-row` / `st-tree-item` / `st-row-del`. |
| **S1.2** row menu / pin / rename (A1, `ec13fea2`) | same cases | `canvas-pin-<slug>` and `tree-row-menu-<slug>` on the `cv-act` row instead of `has-delete-sibling` + `Delete canvas …` button. |
| **S1.3** panel search + jump list (A1, `5d9f24bb`) | same cases | `canvas-jump-toggle-<slug>` ("Show the artboards in Home"). |
| **S1.4** ⌘K day-one state, close matches (A2, `586a2c97`) | `canvas/text Meta+k`, `Meta+Shift+K`; `canvas/select Meta+k`; `canvas/range Meta+k`; `in-canvas/canvas Meta+k`; `in-canvas-text/canvas Meta+k` | the open palette now renders `palette-list` with group headers "Recent" / "Start here" and `palette-row-start:*` rows (canvas.new, help.shortcuts, import.figma, project.open) instead of the flat 125-row action list (`text` focus: +45 lines instead of +125). |
| **S1.5** ⌘K across projects (A3, `a37caa5c`) | `canvas/chrome Meta+k`, `Meta+Shift+K` | first row is `palette-row-recent:ui/Home.tsx` (recent canvas), `canvas.new` second; +133 lines instead of +125. (S1.4 and S1.5 both shape this list; the record cannot split them further.) |
| **S4.3** Stickers gallery in the shell (A1, `f784c608`) | `in-canvas/canvas e` | `stickers-search`, `sticker-figjam-*` tiles; the v1 sticker picker's markup is gone. |
| registry rows added since V2-4 (S1.2, S2.2, S3.1, S4.4, S5.3/S5.4 …) | `canvas/chrome Shift+Slash`, `Meta+Shift+Slash`, `canvas/select Shift+Slash` | the "?" sheet is +591 lines instead of +581 (`… 114 more` vs `… 112 more`): more shortcut rows. The snapshot is truncated, so it does not name them. |

No case changed for: **S2.1** (name tag, parent outline, esc step-out — not merged on feat yet; its esc cases
are unchanged), **S5.x AI panel** (S5.8 host/composer/⌘/; both `Meta+Slash` cases are identical), S3.2a
(the stage runs in the canvas; beyond S3.1's esc order the 5 `presenting/*` cases show nothing new),
S4.1/4.2/4.4/4.5, S5.1–S5.7, S9.x.

## What a refresh would approve

All 52 are explained by the slices above; none is an unexplained key-behaviour change. If the lead refreshes,
the header note would read: "A1–A3: shell DOM of the inspector (S2.2–S2.5), canvases panel (S1.1–S1.3), ⌘K
(S1.4/S1.5), stickers gallery (S4.3), shortcut rows; Present esc message order (S3.1). keydown/to-shell/writes
unchanged in all 240." Verify identical on a second run before committing it (the V2-4 gate's rule).
