# Dropping v1: scope proposal (lead, 2026-10-29), waiting for Michal's confirmation

Michal: "Don't deal with v1. Nobody uses it, so everything gets rewritten and forced to v2." Nothing is deleted until he
confirms. The inventory behind this, with file:line references, is the scout report quoted in the lead session. Its key
facts are below.

## What converts automatically when the project opens (no opt-in dialog)

| Case | Automatic? | What the person sees |
| --- | --- | --- |
| A local / git / Syncthing project in format 1 | **yes**, always | A notice: "Updated for Maude 2. A copy of the old files is in Version history on this Mac." The migrator already makes a snapshot to `_history/_migrate/v2-<stamp>/`. It's deterministic and `--reverse` exists. |
| Annotation boards `.annotations.svg` → `.json` | already automatic at every boot (`server.ts:270`) | no change |
| A hub-linked format-1 project, or format 2 in legacy save mode | **yes, when** you're the owner, signed in, online, and the hub is ≥ 1.9.0 | The same notice, plus "it now saves with accepted revisions". |
| — the same, but you're not the owner / not signed in / offline / the hub is too old | not possible | A plain line with one action, and no dialog: "Sign in" / "Ask the owner" / "The team server needs an update" / "Waiting for the connection". Once the condition clears, the conversion runs by itself. |
| **A cloud project (a cell on cloud.maude.sh)** | **NO during the rc. Automatic only after the stable 2.0.0** | **Risk:** cells run studio 1.10.0 until a stable tag rolls the fleet (`apps/cells/wrangler.toml:46`). A project raised to format 2 would be view-only in the cloud tab for **everyone**. During the rc it stays a manual choice with a warning. |
| Design systems: folder → canvas (`ds convert`) | **yes**, deterministic, 1.x-safe, with a backup to `_history/_ds-convert/` | The notice "Design systems moved onto canvases." |
| Design systems: upgrading to the schema (`ds-upgrade`) | no. It needs AI and the person's choices | An offer that is always reachable (⋯ on the system row + ⌘K), and closing it never hides it for good. |

## What gets deleted (it can't be reached once conversion is automatic)
- The opt-in dialog "Update … for Maude 2?" (`format-update.jsx` confirm + `askedKey`). It's replaced by a notice. The
  view-only line stays only for the refusal cases above.
- Editing in legacy save mode: the edit path of the legacy lane, `MAUDE_SHARED_DOC=0`, `MAUDE_LOCAL_STORE=0`, the legacy
  canvas undo stack (`editing/undo-mode.ts` + the legacy half of `edit-op.ts`).
- The legacy offline-overlap (`sync/offline-overlap.ts` + its hooks, including today's F8 fix).
- The unused `newerOnly` in `format.ts`.

## What stays (for reading and migration)
- The whole `migrate/` and the readers of old formats (`annotations/migrate-*`, `v1-adapter`, `legacy/`).
- Reading a legacy hub project until it's converted. That part of `sync/index.ts` / `projection.ts` is large and
  tangled with the accepted lane, so it doesn't get deleted in this batch.
- The format fence on the hub (426 for 1.x writes). Thanks to it, a 1.x teammate gets "read only" instead of
  corruption.
- The `format.ts` gate and the refusal lines (not the owner, offline, an older hub, newer).

## Fixes that come with it
- **The hub flip isn't rolled back** if the local writes fail (`engine.ts:788` → `:841`). Fix: the hub is unflipped
  on failure.
- A failed automatic attempt mustn't retry in a loop. It needs a guard (per session + on a change of conditions).
- **The backup is only on the Mac that converted** (`_history` isn't synced). The notice says so.

## Release order
- An rc is allowed: the rc doesn't touch the fleet, and hubs ≥ 1.9.0 can take the format and mode switch. That's
  every cell and every current self-hosted hub.
- A 1.x teammate on a converted project: read only (the fence). A 1.x client older than 1.9 loops on 426. Michal
  says nobody uses v1, so that's accepted.
- Cloud projects convert automatically only after the stable 2.0.0 (it rolls the fleet). Until then the conversion
  is manual, with a warning.
- V2-8.12 "ships v1-compatible first": no hub change is needed. The fleet stays on 1.10.0 during the rc.

## Size
M–L, one Opus builder plus a security/sync review. Tests fail first: the automatic conversion of each case, the
refusals and their lines, the unflip of the hub, no loop, the cloud excluded during the rc. The 2A tests and the e2e
on the dialog need rewriting (`format-gate*`, `format-sync`, `detach-keeps-format`, the testids of the dialog).
