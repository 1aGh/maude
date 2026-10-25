# 10 Share and collaboration — round 7 (p8-c7-ex10): done / open

## Done

| id | what | tests |
|---|---|---|
| co-share-advanced | the copy values are `<input readonly>`s: the UA's inset border drew the white outline the board never has; `border: 0`, the value takes the row's free width right-aligned. Harness window 1200 px so the footer line "Sync details live in Menu > Diagnostics > Sync." is in frame (it was cut by the shot's window, not clipped by the sheet) | — (CSS) |
| co-comment-print | the inspect size tag (`.dc-cv-inspect-tag`) drew white on a hard-coded `#0d99ff` (about 2.9:1); now the HUD tokens (`--maude-hud-accent` / `-fg`), fallback `oklch(0.530 0.175 238)` (white on it is above 4.5:1). Harness turns View › Print guides on for this shot | `inspect-overlay.test.tsx` pin (no hard-coded blue, token text colour) |
| co-browser-view | harness only: the frame is shot in the plain-browser context (no `__TAURI__` stub), so the "Open in the Mac app" island is drawn | — |
| co-trashed | the ghost row's sub ("In the trash · open here") no longer truncates: it keeps its width, the name gives way | — (CSS) |

## Open

- co-comment-video: the timeline strip with comment markers and "2 comments on this video" (not built).
- co-conflict: the decision card on the canvas under the pair with "Keep both" attached (today a top banner over the Canvases panel).
- co-trashed: the two-line ghost row with thumbnail, and the Edit cluster kept (the shell is in Viewing).
- co-ask-edit: the tip anchored beside the pointer (anchored under the cluster).
- co-share-advanced: the extra hint "Opens the folder on this Mac only." under App link.
