# fix-c9-ui — phase 8 stage C round 9, 01 Create flow (branch p8-c9-ui)

Source: the D6 critic of 01 (`critic-bar4.md`). Three small product fixes, no re-shot this round (the lead re-shoots).

## Done (product)

| id | root cause | fix | where | tests (red -> green) |
|---|---|---|---|---|
| cf-panel-search | WebKit (WKWebView too) draws a native cancel button on `input[type="search"]` beside Maude's own x; only `home.css` hid it | one shared shell-layer rule hides `::-webkit-search-cancel-button` + `::-webkit-search-decoration` for every search input | `styles/3-kit-maude-v2.css` | `p8-c9-ui` |
| cf-open-big (Share) | the C8 zen rule `.st-share[data-zen] > :not(...)` was in `@layer shell`; the Share button is a `.maude .btn` whose `display: inline-flex` is set in `@layer components`, and a later layer beats a higher-specificity rule in an earlier one | moved the zen rule into the `@layer components` block of `share-cluster.css` (specificity (0,4,0) > (0,2,0) there) | `v2/shell/share-cluster.css` | `p8-c9-ui`, `p8-c8-misc-zen` |
| cf-open-big (notice) | not a stale right inset: sonner positions the toast `absolute` inside its 640 px toaster, and `margin-inline: auto` + `width: fit-content` centres only when `left` and `right` are both set; with neither the pill hugged the toaster's left edge (centre ~622 px of 1600, the toaster itself is centred at 800) | the toast rule gets `left: 0; right: 0` (every notice, top and bottom, now centres in the window) | `notifications.tsx` (`NOTICE_CSS`) | `p8-c9-ui`, `p8-c4-toast-rule` |

## Open

- 04 md-inspect harness: skipped (lead handles in the re-shoot).
- No re-shoot of 01 this round; `cf-panel-search`, `cf-open-big` need the lead's pass.
