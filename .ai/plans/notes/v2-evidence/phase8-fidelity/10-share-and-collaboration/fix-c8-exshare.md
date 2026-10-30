# 10 Share and collaboration — round 8 (p8-c8-exshare): done / open

Checklist: the MUST rows of `critic-bar3.md`. Verification: fail-first test (red on the feat tip), tsc + biome, release rebuild, `check-client-boots-source`, `opening-card-clears`, re-shoot with `_c8-harness-g4` on the Mac mini (`SCNS="s10 s10cm s10d"`, light + dark).

## Done

| id | what | tests |
|---|---|---|
| co-share-advanced | App link / This Mac / Hub values show whole (the mono field's width follows its text — `${len + 1}ch` — so the ellipsis only appears when the sheet itself is narrower); the extra hint "Opens the folder on this Mac only." is gone; the Role select is live on a Team only link (the link row's own sub-line already names a team link's role) | `share-advanced.test.tsx` (Role enabled, width of the three values, no hint) |
| co-ask-edit | **not a product bug**: with the same code the tip renders (shot locally in dark; on the mini in both themes once the drag repeats). The D5 mini shot lost it because the first drag landed before the canvas frame had installed its listener and the tip is transient (gone after release). Harness: the drag repeats until `access-view-tip` is visible, then the shot is taken while it shows. Viewer lands in Viewing for the shot: the harness presses Viewing first — a view-only link BOOTS in Preview by the owning board 04 (`md-edge-viewer`) and V2-1.2 §5.4 (`initialMode`), so the product default is unchanged | harness only (`_c8-harness-g4/s10d.mjs`) |
| co-comment-print | harness: View › Print guides is on (⌘K) — trim + safe-margin guides are in the shot | harness only (`s10cm.mjs`) |

## Open

- co-comment-print: the legend "Bleed 3 mm · trim · safe margin 5 mm" is a board text (also on 08 `ak-print-view`) that the product never drew. The kind overlay (`artboard-guides-overlay.tsx`) clips its content at the artboard (`overflow: hidden`), so a caption under the artboard needs its own un-clipped layer: an 08 / canvas-lib change, not started.
- co-sync-offline / co-sync-back: per-row "not sent" / "sending" labels are a **data gap**. The outbox (V2-1.14) holds INTENTS (AI prompts, invites, asks, cloud exports, handoffs); a canvas edit is the content lane, whose status carries a COUNT (`pending`, `/_sync-status`) and no per-canvas record (`file-ledger.ts` knows a file differs from its ancestor, but nothing exposes it). Needs a per-path pending list from the sync runtime first.
- co-sync-offline: the queued comment bubble ("Queued — sends when this Mac is online.") — same gap for comments (not an outbox kind).
- Viewer lands in Preview (boot rule from 04 / V2-1.2), the board 10 frame draws Viewing: harness presses Viewing; a product change would contradict the owning board.
