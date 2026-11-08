# #122 — Cross-canvas clipboard: objects and artboards travel with what they read

Issue 1aGh/maude#122 ("copy/paste or cut/paste artboards or elements between canvases", reported on
1.2.0). Burndown T7.1 (this note) feeds T7.2 (build + e2e). Plan: `.ai/plans/feature-issues-burndown-2026-11.md`.

## 1. Question

Copy / cut / paste of artboards and elements across canvases, including their assets
(content-addressed `assets/<sha8>.<ext>`) and their relative imports (the target lacks the import: copy the
module, refuse, or carry the import?); id re-stamping; undo on both canvases (is a cut-and-paste one user
action or two?); cross-project paste; permissions (canvas-only sessions, the C4 frame capability); the
system clipboard format and what a non-Maude paste gets; the AI verb, if any. Through the action registry,
no new key handlers.

## 2. What exists today

Most of the clipboard shipped in v2 Phase 8 C7 / V2-8.9, after #122 was filed:

- **Server** `edit-ops/clipboard.ts`: `object.copy`, `artboard.copy` (reads), `object.cut`, `canvas.paste`
  (one write, one ⌘Z each), on the one edit-op route (`routes/edit.ts`, main origin). Copied **text stays on
  the server**, per subject (`ClipScope`: cell member or '' on a desktop), capped (16 per shelf, 16 MiB per
  shelf, 64 MiB per process), forgotten on restart. A copy answers a handle `{id, kind, count, from}`.
- **Ids.** Every `data-cd-id` / `data-cd-locked` is dropped on read and again on write; a pasted DOM root
  gets a fresh readable id; a pasted artboard gets `copyId` / `copyName` ("Desktop" → "Desktop 2").
- **Names an object reads** (`edit-ops/scope-names.ts` `needsOf` / `scopeAt`): a paste where the copied
  object reads a name the target cannot see is refused ("…reads W from where it was copied; it can't be
  pasted here. Copy the whole component instead.").
- **Shell** `client/clipboard-relay.ts`: the shell holds the handle and names it on every paste (the canvas
  can never choose what is pasted); a clip copied in **another canvas** pastes only after a click on the
  shell's own toast ("Paste 2 objects copied in Home?"), and only within 1 s of a paste the shell saw
  (`PASTE_INTENT_MS`, V2-8.9 L2). The canvas hears kind + count, never the handle (L3).
- **Canvas** `editing/clipboard.ts`: every entry (menus, chords, Edit › Cut/Copy/Paste, ⌘V) runs one
  `runClipAction`; ⌘V is WebKit's own paste event, claimed only when the system clipboard holds the marker
  `Maude · 2 objects · paste on a canvas (maude-clip)` (written synchronously in the copy gesture, r1-13).
- **Registry** `actions/defs/edit.ts`: `object.copy` ⌘C, `object.cut` ⌘X, `artboard.copy` ⌘C,
  `canvas.paste` (no chord: ⌘V is the paste event). `actions/agents.ts`: the agent writes the source itself
  ("the clipboard is the person's"). Menus: `editing/object-menu.tsx` (Cut / Copy / Paste),
  `editing/artboard-menu.tsx` (Copy / Paste).
- **Undo.** One op log; ⌘Z is your own actions projected **per canvas** (V2-1.5 §5.4); deleting an artboard
  is a `kind: 'trash'` action (`edit-ops/artboard-trash.ts`), so the Trash lists it.
- **Assets** are designRoot-relative `assets/<sha8>.<ext>` literals (`sync/asset-state.ts`
  `assetRefsInSource`, `access/closure.ts` `staticAssetRefs` / `perUsePhotoRefs`), the same path from every
  canvas of a project.
- **Desktop** runs one sidecar per project tab; the Rust shell reaches a sidecar with the per-spawn
  `MAUDE_SHELL_TOKEN` (`routes/shell.ts`).

kg: `v2-clipboard-objects-split`, `v2-p8-c7-clip-bytes-server-handle-in-shell`,
`v2-p8-c7-paste-via-native-event-marker`, `v2-r1-13-clip-marker-in-gesture`,
`v2-p8-clipboard-keyed-by-subject`, `v2-p8-paste-ask-needs-shell-seen-intent`,
`v2-p8-c7-cross-canvas-paste-shell-confirm`, `v2-p8-leftovers-paste-fallback-own-lane`,
`v2-lead-artboard-clipboard-deferred` (Copy/Paste rows were kept off the artboard menu for v2.0 — now
built), `v2-4-gate-role-gated-actions` (Cut/Paste greyed below Can edit, copy rows for every role).

**What is missing** (proved in §6): (1) a cross-canvas paste lands code that cannot resolve — 56 % of real
artboards and 20 % of objects read something from around them; an artboard is never checked at all, and an object's check misses **JSX tag names** (`<Card>`, `<Pill>`), so a
component the source imports or declares is pasted unresolved and the target shows an error card;
(2) no **artboard cut**; (3) no **cross-project** paste (the clip lives in one project's server, the
handle in one tab's shell).

## 3. Options

**A. What a paste does with the names the copy reads** (imports, module constants, local components):

1. **Carry them** (chosen): the clip records, for every name the copied range reads from module scope,
   either the import that binds it or the module-level declaration (transitively); the paste adds what the
   target lacks — the import re-relativised to the target's folder, the declaration inserted after the
   imports — reuses identical ones, and renames on a clash. Names from inside a function (props, hook state)
   still refuse, as today.
2. **Refuse** ("Copy the whole component instead"): honest, but §6 measures it refusing 56 % of all
   artboards (`W` / `H` constants, same-file components). Rejected as the default; it stays for function-scope names.
3. **Copy the module** into the target project/folder: duplicates a component (two sources of truth), can
   overwrite a different file at the same path, and drags its whole import closure. Rejected.
4. **Inline values** (`W` → `1440`): only works for literals, never for components. Rejected.

**B. Undo of a cut on canvas A and a paste on canvas B:**

1. **Two actions** (chosen): the cut is an action on A, the paste an action on B; each sits in its own
   canvas's ⌘Z. ⌘Z on B takes the paste back (the clip is still held, paste again); ⌘Z on A puts the
   originals back. Matches every editor; the cut is complete on its own (it may never be pasted).
2. **One action across two documents** (a run already can touch several canvases): would need the cut
   amended after the fact (the log is immutable) or the cut held pending until a paste. Rejected. A one-
   gesture "Move to canvas…" that IS one action is a separate future feature (Q2).

**C. Cross-project paste:**

1. **Through the Rust shell** (chosen, desktop only): the copying tab tells Rust its handle; a paste in
   another project's tab asks Rust to carry the clip — Rust reads it from the source sidecar and hands it to
   the target sidecar, both over shell-token routes. Text only ever comes from a Maude server that read it
   from its own disk; no webview and no other app supplies JSX.
2. **The source JSX on the system clipboard** (a custom pasteboard type): any app can write that type, so a
   paste would write foreign JSX into the person's file, and every canvas frame's paste event could read
   the copied source (the C4 frame scope). Rejected.
3. **The target server reads the source project from disk**: a server reading another root is a new
   path-traversal surface. Rejected.
4. **Not at all** (refuse with words): kept for cloud-cell tabs and the browser.

**D. System clipboard:** keep **one `text/plain` marker line** (chosen). Rejected: the JSX as text (leaks
source to canvas frames and other apps, invites forged pastes); a PNG beside the marker (the paste bar
would claim the picture first; "Copy as PNG" is its own action already).

**E. AI verb:** **none** (chosen). The agent edits the source with the whole file in view; the clipboard is
the person's (`actions/agents.ts`). The carry rules are documented for it in the `design:design` skill.

## 4. Decision (DDR draft)

**Title:** The object clipboard carries what the copy reads; cut and paste are two actions; projects meet
through the Rust shell.

**Decision.**
1. A copy records `carry`: the imports and module-level declarations the copied range reads (identifiers
   **and JSX tag names**, transitively). A paste on another canvas adds what the target lacks, reuses what
   is identical, renames what clashes (`W` → `W2`, `Card as Card2`), and rewrites only the copied text's own
   references. Function-scope names still refuse.
2. The module behind a carried import is never copied. A carried import is refused when its module is a
   canvas (`isCanvasSource` — "move the shared part into a component"), not an importable extension
   (`IMPORTABLE_EXT_RE`), under a `_` runtime folder, or outside the design root.
3. New `artboard.cut`: `artboard.copy` + the `artboard.trash` removal in ONE write, `kind: 'trash'` — so a cut
   artboard that is never pasted is in the Trash, not only in a forgettable server clip.
4. Cut and paste stay two actions, each in its own canvas's ⌘Z.
5. Assets need nothing within a project (same `assets/` path everywhere). Across projects the carried clip
   brings the referenced asset files (and their photo sidecars) into the target's `assets/`, content-
   addressed and verified, written only after the person confirmed the paste.
6. Cross-project = desktop project tabs only, through Rust (`clip_note` / `clip_take`), always behind the
   shell's confirm toast. Cloud-cell tabs and the browser answer in words.
7. System clipboard: the marker line only. No AI verb.

**Rejected.** See §3 A2–A4, B2, C2–C3, D, E.

## 5. Contract

### 5.1 The clip (server, `edit-ops/clipboard.ts` + new `edit-ops/clip-carry.ts`)

```ts
interface Clip extends ClipHandle {           // existing fields stay
  items: string[]; names: …; artboard: string | null; bytes: number;
  needs: string[];                            // function-scope names (refuse elsewhere) — now for artboards too
  carry: Carry;                               // NEW
}
interface Carry {
  imports: CarriedImport[];                   // source order
  decls: CarriedDecl[];                       // module-level, dependency order (a decl after what it reads)
  assets: string[];                           // `assets/<sha8>.<ext>` (+ `.photo.json` sidecars) the items name
}
interface CarriedImport {
  local: string;                              // the name the items use
  imported: string | 'default' | '*';         // what the module exports under it
  spec: string;                               // as written in the source
  module: string | null;                      // designRoot-relative resolved file; null = bare / virtual (`react`, `@maude/canvas-lib`, `@maude/ds/…`)
  typeOnly?: boolean;
}
interface CarriedDecl {
  name: string;
  text: string;                               // the whole top-level statement, `export` dropped
  kind: 'const' | 'function' | 'class' | 'type';
}
```

Limits (refuse in words when crossed, nothing kept): `MAX_CARRIED = 32` imports + decls; carried text
counts toward `bytes`. Never carried: `let` / `var` (mutable), a declaration with a side effect at module
level other than `const x = <expr>`, the default export, anything that renders `DesignCanvas`.

New in `edit-ops/scope-names.ts`: `freeRefsOf(source, from, to) → Array<{ name, start, end, jsx: boolean }>` —
`needsOf` plus JSX tag roots (`<Card>`, `<Icons.Star>` → `Icons`), TS type references, with positions; each
classified `import | module | function | global`. `needsOf` keeps its signature (= the `function` names).

### 5.2 Paste rules (`canvas.paste`)

- **Same canvas:** nothing carried (the names are already there) — today's behaviour.
- **Another canvas, same project:**
  - import, target already imports the same `imported` from the same `module`/`spec` under the same local →
    nothing; same module under another local → rewrite the items' refs to that local; the local name is
    bound to something else → alias (`import { Card as Card2 }`) and rewrite; else add the specifier to an
    existing import of that module, or a new import line after the last import. The specifier is
    re-relativised from the target's folder (`./`-prefixed, extension as the source wrote it).
  - decl, target has a top-level binding of that name with identical normalised text → reuse; different →
    rename (`W2`, `W3`, …) in the decl, in carried decls that read it, and in the items; else insert after
    the last import, in dependency order.
  - any `needs` name the target cannot see at the paste spot → refused (today's words).
  - before the write: every import the paste ADDS must pass the rule the C4 import walk applies
    (`access/closure.ts`: importable extension, not a canvas, not under `_`, resolves) — evaluated on the
    would-be source text, not the disk. `closureFor` works on a project's grants, so 122-A adds a small
    `importAllowed(spec, fromRel, project)` export there that both share; refused → nothing written. A
    canvas-only session's grant is re-derived from content after the write as today (`c4l`).
- **Artboards** get the same `needs` / carry treatment (today they get none).
- The written source must parse and re-walk (`walkIdElements`) — else "That paste would break the canvas;
  nothing changed." (existing).
- Result `detail.carried = { imports: n, decls: n, renamed: [{from, to}] }`; the canvas toast says it:
  "Pasted the artboard · added 2 imports" / "· renamed W to W2".

### 5.3 Cut

| op | kind | label | effect |
| --- | --- | --- | --- |
| `object.cut` (exists) | edit | "Cut 2 objects" | ranges leave the file |
| `artboard.cut` (new) | trash | "Cut “Desktop”" / "Cut 3 artboards" | `artboard.copy` + `artboard.trash`'s removal and `layout.remove` in one write; `origin.trashed` as trash does; the canvas keeps ≥ 1 artboard |

### 5.4 Undo (V2-1.5, unchanged model)

| Gesture | ⌘Z on A | ⌘Z on B |
| --- | --- | --- |
| Copy on A, paste on B | — (a read) | removes the paste; carried imports/decls leave with it (same write) |
| Cut objects on A, paste on B | puts the objects back | removes the paste |
| Cut artboard on A, never pasted | puts it back (also restorable from the Trash) | — |
| Cross-project paste into B | — | removes the paste; copied asset files stay in B's `assets/` (unused, like an import) |

Two entries, two canvases; Undo history and Version history show "Cut …" on A and "Paste …" on B.

### 5.5 Registry, menus, words (no new key handler)

- `actions/defs/edit.ts`: new `artboard.cut` — `label: 'Cut artboard'`, `exec: 'canvas'`,
  `enabled: { ...EDITS, selection: ['artboard'] }`, `keys: [kb('⌘X', 'selection', { when: { ...OBJ, mode: ['edit'], selection: ['artboard'] } })]`,
  `search: { hidden: true }`, `help: { group: 'objects', order: 904 }`. `actions/agents.ts`: `artboard.cut` →
  TSX "Move the artboard's JSX in the source (the clipboard is the person's)".
- `editing/clipboard.ts`: `CLIP_ACTIONS` + `clipActionForEdit('edit.cut')` → `artboard.cut` for an artboard
  selection. `client/clipboard-relay.ts`: `CLIP_COPY_OPS` gains `artboard.cut`.
- `editing/artboard-menu.tsx`: rows Cut ⌘X · Copy ⌘C · Paste ⌘V (deps `cut?`).
- `node scripts/gen-actions.mjs` regen (manifest, `keymap.gen.ts`, help block, `studio-actions` skill).

### 5.6 Cross-project (desktop)

```
copy in tab A ─► shell A: noteClipResult ─► Rust clip_note({id, kind, count, from})      (seq++)
⌘V in tab B  ─► canvas B: canvas.paste ─► shell B: shapeClipRequest
                 └ Rust clip_latest() → { seq, mine: false, kind, count, from, project }
                 └ toast "Paste 2 objects copied in Home · Acme site?" · Paste   (intent gate as today)
                 └ Rust clip_take() → GET  A /_api/shell/clip-export?id=<id>     (shell token, A's sidecar)
                                     → POST B /_api/shell/clip-import {clip, assets…} (shell token)
                                     ← { handle }   (a clip on B's desktop shelf)
                 └ shell B runs canvas.paste with that handle (the ordinary path, its own ⌘Z)
```

- Rust (`apps/desktop/src-tauri/src/clip_bridge.rs`): `clip_note` / `clip_latest` / `clip_take` accept only
  `p-*` project webviews at their own loopback origin (label + origin check, as every command). It keeps the
  latest `{tab, root, id, kind, count, from, seq}` in memory; never written to disk. `clip_latest.mine` =
  the latest copy was in the calling tab (then the shell uses its own handle — last copy wins, like the
  system clipboard).
- `GET /_api/shell/clip-export` → `{ kind, items, names, needs, carry, from, project, modules: [{path, sha256}],
  assets: [{rel, size}] }` for a clip on the desktop shelf; `GET /_api/shell/clip-asset?id=&rel=` streams one
  asset of that clip (≤ 256 MiB per clip in all). `POST /_api/shell/clip-import` validates every item with the
  paste's own `checkItem`, re-checks every asset's bytes against its `<sha8>` name, writes the asset (and
  sidecars) atomically to `assets/` (skip when present), and keeps the clip. Shell-token gates exactly as
  `/_api/shell/status` (no token → 404, a browser `Origin` → 403, wrong token → 401). Main origin only;
  never in either canvas allowlist.
- A carried **relative** import across projects is kept only when the target has a file at the same
  designRoot-relative path with the same sha256; otherwise the paste is refused: "That artboard uses Card
  from components/Card.tsx, which this project doesn't have. Copy that file over first."
- Source tab resting (server stopped) or restarted: "That copy is gone; copy it again." — nothing woken.
- Cloud-cell tab or browser, with a marker but no handle of its own: "Paste between projects works for
  projects on this Mac." (cell) / today's "Nothing to paste…" (browser).

### 5.7 Permissions

| Step | Needs | Where checked |
| --- | --- | --- |
| Copy | sight of A (any role) | edit-op route + `fc` frame cap for A |
| Cut | Can edit on A | edit-op route (role gate) |
| Paste | Can edit on B **and** still sees A (`ClipScope.sees(clip.from)`, existing) | edit-op route; `fc` for B |
| Carried imports | each added import passes the C4 import rule | `importAllowed` pre-check (§5.2) |
| Cross-canvas | the shell's own toast within 1 s of a seen paste (existing L2) | `clipboard-relay.ts` |
| Cross-project | desktop project tabs only; Rust-only shell-token routes | `clip_bridge.rs`, `routes/shell.ts` |

The canvas still never learns a handle (L3); `detail.carried` counts are fine to show it.

### 5.8 System clipboard

`text/plain` = the existing marker (`clipMarker`, unchanged words): pasting into Slack, Mail or a text
field gives "Maude · 2 objects · paste on a canvas (maude-clip)". No HTML, no source, no picture.

## 6. Evidence

**Prototype** (`proto-paste.ts`, scratchpad, against `edit-ops/clipboard.ts` on main `d93680b17`): canvas A
imports `Card` from `../components/Card`, declares `const W = 1440` and a local `function Pill`; B has none.

| Case | Today |
| --- | --- |
| `artboard.copy` of `<DCArtboard width={W}>…<Pill/>…<Card/>` → paste on B | **pasted**, `W`, `Pill`, `Card` unresolved in B |
| `object.copy` of `<Pill>New</Pill>` → paste on B | **pasted**, `Pill` unresolved (JSX tags are not in `needsOf`) |
| `object.copy` of `<Card title="Hi"/>` → paste on B | **pasted**, `Card` unresolved |

**Count over real canvases** (296 files rendering `DesignCanvas` under `~/git/**/.design/`, read-only;
`artboard-needs.ts` / `jsx-needs.ts`): 3,223 artboards; **1,162 (36 %) read a module-level name** of their own
file (top: `W` 822, `H` 694, `nb` 296); 100 canvases (34 %) have ≥ 1 relative import; 70 reference
`assets/<sha8>`.

Counting JSX tag names too (`jsx-needs.ts`; objects = the first 4,000 direct children of an artboard):

| | artboards (3,223) | objects (4,000) |
| --- | --- | --- |
| read nothing from around them — paste anywhere today | 1,404 (44 %) | 3,201 (80 %) |
| read a same-file declaration (const, helper, component) | 1,737 (54 %) | 734 (18 %) |
| read only relative imports | 82 (3 %) | 65 (2 %) |
| render a same-file component as a JSX tag | 1,656 (51 %) | — |
| render a relatively imported component as a JSX tag | 506 (16 %) | — |
| contain a name today's `needsOf` does not see (JSX tags) | 2,095 (65 %) | 955 (24 %) |

Relative imports that point at another canvas module: 2 of 176 (the C4 refusal case is rare).
So: refusing (option A2) would refuse more than half of all artboard pastes and a fifth of object pastes,
and today most of them are not refused at all but pasted broken — hence carry, and the JSX-tag fix.

## 7. Tests that will prove it (red first)

| Test | Proves |
| --- | --- |
| `test/clip-carry.test.ts` | the §6 three cases: red today (pasted unresolved), green = carried; identical decl reused; clash renamed in items + decls; alias on a local clash; re-relativised spec from `ui/a/` to `ui/b/c/`; transitive decl order; `let` / side-effect / >32 refused |
| `test/clip-carry-closure.test.ts` | carried import of a canvas module refused with the component words; `_`-folder and non-importable ext refused; canvas-only subject whose closure would break → refused, nothing written |
| `test/scope-names-free-refs.test.ts` | JSX tag roots, member tags, type refs, shadowing by map-callback params |
| `test/artboard-cut.test.ts` | one write, `kind: 'trash'`, Trash lists it, ⌘Z restores it, last artboard refused, relay keeps the handle |
| `test/clip-undo-two-canvases.test.ts` | cut on A + paste on B = two actions; each canvas's projection holds its own; ⌘Z on B leaves A cut |
| `test/shell-clip-routes.test.ts` | export/import/asset gates (404 / 403 / 401), sha mismatch refused, asset written once, items re-checked, never in canvas allowlists (`canvas-origin-parity` unchanged) |
| Rust `clip_bridge` unit tests | non-project webview refused; `mine` flag; seq ordering; nothing on disk |
| e2e `test/e2e/clipboard-cross-canvas.e2e.mjs` | copy an artboard on Home, paste on About (toast → Paste), renders without an error card; cut an object, ⌘Z on each canvas |
| desktop e2e lane `clip` (`wdio.clip.conf.ts`) | two project tabs; copy in one, ⌘V in the other, toast, pasted with its picture |

## 8. Feeds — builder slices (T7.2)

| Slice | Owns | Model | Done when |
| --- | --- | --- | --- |
| **122-A Carry + artboard cut (server)** | new `edit-ops/clip-carry.ts`; `access/closure.ts` (`importAllowed` export only), `edit-ops/clipboard.ts`, `edit-ops/scope-names.ts`, `edit-ops/dispatch.ts` (register `artboard.cut`); tests above (carry, closure, free-refs, artboard-cut, undo) | Opus (scope-aware AST rewrite + C4) | §7 server tests red→green; no change to the 64 KiB body bound or the handle-only rule |
| **122-B Registry, menus, words, e2e** | `actions/defs/edit.ts`, `actions/agents.ts`, `editing/clipboard.ts`, `editing/clipboard-actions.ts`, `editing/artboard-menu.tsx`, `client/clipboard-relay.ts` (`CLIP_COPY_OPS`), carried-toast words; regen `gen-actions.mjs`; `test/e2e/clipboard-cross-canvas.e2e.mjs`; `plugins/design/skills/design/` carry paragraph | Sonnet | registry tests + e2e green; boot check green; needs client rebuild |
| **122-C Cross-project (desktop)** | new `apps/desktop/src-tauri/src/clip_bridge.rs` (+ `lib.rs` registration, project-webview capability); `routes/shell.ts` (three shell-token routes, existing factory); `client/clipboard-relay.ts` (`clip_latest` / `clip_take` path); desktop e2e lane `clip` | Opus (trust boundary, Rust) | §5.6 + shell-route tests green; desktop lane run once alone, green; `check-bundle-completeness` unaffected |

122-C depends on 122-A (the `Carry` shape); 122-B can run beside 122-A once the `artboard.cut` op id is
fixed (it is: `artboard.cut`). Builders must not: put source on the system clipboard, let a canvas name a
handle, add a key handler, add the shell routes to any canvas allowlist, or copy a module file.

## 9. Open questions (default the run takes)

- **Q1 — Comments, votes, annotations and Present notes of a copied artboard.** Default: **none travel**
  (they are about the original; ⌘D Duplicate does the same). Annotations riding with the artboard
  (`parentArtboard`) could follow later.
- **Q2 — A one-gesture "Move to canvas…" (one action across two documents).** Default: **not built** here;
  cut + paste covers it. Product call for Michal if he wants it.
- **Q3 — Cross-project into a cloud-cell tab.** Default: refused in words; a cell has no shell token and
  its own subject model.
