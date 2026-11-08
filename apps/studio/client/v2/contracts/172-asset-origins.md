# #172 — "Added by Tereza" travels with the project (asset-origins sync)

Writer: burndown T2.6 (#172 ia-edges remainder), 2026-11-08. Extends `S8-asset-sidecars.md` §5.4; does not change it.

## Question

Today "Added by <name>" comes from `_canvas-state/asset-origins.json` (`by`), a per-Mac runtime file: only the Mac that
imported the picture says who added it. Every peer's Assets details should say it. How does the name travel?

## Options

| Option | Verdict |
| --- | --- |
| Make `asset-origins.json` versioned / synced | **Rejected.** It holds a home-folder path (`/Users/jonas/Pictures/…`); S8 Q7 and `v2-S8-asset-origin-per-mac` keep it per Mac. Splitting the file still leaves one project-wide map that every import rewrites: concurrent imports on two Macs conflict on one file. No DDR-115 list changes. |
| Put `by` in an existing synced sidecar | **No fit.** `.photo.json` has a strict v1 reader (R8); `.footage.json`/`.edl.json` are frozen (R8); `.gen.json` means "Made by AI" (it puts the picture in Generated and exempts it from Not used); `.audio.json` is a sound's intent record. Most imported pictures have no sidecar at all. |
| The hub's asset metadata (journal) | **Rejected.** The journal records the writing lane for forensics, never a person, and is never authority; a git-only project has no hub. |
| **A per-asset companion sidecar `assets/<stem>.added.json`** | **Chosen.** One small file per asset, named by the asset's stem (an import's sha8), so it rides the asset's closure, trash and rename (the asset-trash stem rule) and two Macs adding different pictures never touch the same file. |

## Contract

**File.** `assets/<stem>.added.json` (`<stem>` = the asset name before its first dot; an import's sha8), format
`maude.added` v1:

```json
{ "format": "maude.added", "v": 1, "by": "Tereza", "at": "2026-11-08T09:12:00Z" }
```

- `by` — a display name (≤ 80 chars, no control character, never contains `@`: an e-mail is not a name). Required.
- `at` — ISO-8601 UTC; optional. File ≤ 4 KiB. Lenient reader: unknown keys kept, `v > 1` or a wrong `format` → absent.
- **Write-once** (exclusive create; no temp file in `assets/`, which is on the plane). The first person who brings the
  bytes in is the one who added them; the same bytes again (same sha8, so the same asset) never rewrite the record. Written only by the studio (`asset-added.ts`
  `recordAssetAdded`) and the CLI (`maude design import-asset --added-by`), never by canvas code. No FormatId (it
  checks as plain `json`); agents never write it.
- **Who.** In a cell, the proxy-vouched member; on a Mac, the git `user.name` (the comments/Figma-importer rule). A
  server-derived value with `@` is reduced to its local part's words (the `displayNameOf` rule), then cleaned; an
  explicit `--added-by` e-mail names nobody (the origin-record rule). Nothing left → no file.
- **Never** a path, an e-mail or an account id. The home path stays in `_canvas-state/asset-origins.json` (unchanged).

**Classification.** Versioned project content, not runtime state: none of the four DDR-115 lists changes. The file
plane carries it as `companion-text` — `.added.json` joins `COMPANION_SIDECAR_SUFFIXES` in `sync/file-membership.ts`
and its byte-identical hub mirror; `asset-trash.ts` and `access/closure.ts` sidecar lists gain it so it moves to the
Trash, renames and is admitted with its asset. `test/sync-file-membership.test.ts` pins the path as plane +
not-runtime on both copies.

**Older hubs (additive, v1-compatible).** A hub that takes the file advertises the capability `asset-added-v1`. A 1.x
door refuses every 2.0 `.json` class already (`olderDoorRefuses`); a 2.0 hub without the word would refuse this one.
The studio holds `.added.json` for such a hub with the existing older-hub reason and offers it the pass the word
appears — the asset itself syncs either way; only the line is missing on the peer.

**Readers.** `/_api/asset-details` answers `addedBy` from the sidecar to every session that may see the asset (the
route's table gate already admits a canvas-only session only for a picture its canvases show — names stay inside the
grant, never a project-wide list; the Generated listing stays empty for it). The per-Mac `asset-origins.json` `by` is
the fallback, still told only to a project session on a Mac. Synced text is untrusted: capped and drawn as text only.

**Edge.** Two people adding the identical bytes at the same moment write two different records for one path; the file
plane's normal conflict rule applies (no merge). Rare by construction (content-addressed name).

## Tests

`asset-added.test.ts` (shape, write-once, no e-mail), `sync-file-membership.test.ts` + hub `file-membership-s8`
(classifier, both copies), `asset-details.test.ts` (peer with no origin record says "Added by"), `sync-file-plane`
(held for a hub without the word), `sync-asset-added-two-peer.test.ts` (real hub under Node 24, A → B and B → A).
