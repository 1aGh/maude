# S4 ↔ S9: formal votes (A18) and sticky ↔ comment

Status: **contract** (Phase 5 contracts spike, 2026-10-18). Writer: S4 planner. S9 names this file in its §2
table (it used to say `S4-votes-ballots.md`). Binding: Gate 0 **A18**, V2-1.7 (matrix), V2-1.15 (the runs
precedent this copies), V2-1.16 (L3 pokes, U1 scope), V2-1.5 (one action = one ⌘Z), V2-1.12 (R1/R3 additive
fields), `S4-slices.md` Q5, Q6, Q9, `S1-trash.md` (branch s1-6). Prior decisions it builds on (kg):
`maude/v2-S4-votes-a18-storage`, `maude/v2-S4.5-people-only-types`, and the S4.1 `vote` / `ballot` models
(`annotations/elements/{vote,ballot}.model.ts`, built).

Consumers: **S4.6** (hub vote store), **S9.13** (hub vote routes), **S4.14** (vote sheet, bar and store),
**S4.7** (conversion routes), **S4.12** (sticky menu), **S9.7** (comment door and schema), **S9.22** (thread
header and ⋯), **S9.9** (local gate, D5), **S5.5** (undo route guard).

## 1. Where a vote lives

| Project | Ballots and timer | What the board holds |
| --- | --- | --- |
| **Linked to a hub that advertises `votes-v1`** (every cloud cell, and a self-hosted hub on this release) | The hub (§2). Never in a file, a Y doc or a replica. | One `vote` element: `targets`, `title`, `perVoter`, `startedBy`, `startedAt`, `endsAt`. At the end, `state: 'ended'`, `endedAt`, `votersDone`, `tallies`, and the result section `voteResultId(id)`. |
| **Local** (no hub) | `ballot` elements, one per voter (S4.1 shape). Other people's are hidden in the UI until `state: 'ended'`. The sheet says: "Anyone who can open this project's files can see the votes." | The `vote` element and the ballots. |
| **Linked to a hub without `votes-v1`** (an older self-hosted hub) | **Votes are off.** "Start a vote…" is disabled with "This team server can't keep votes secret yet — ask whoever runs it to update." | — |

Why the third row is off rather than local: on a linked project, board ballots would sync to every peer,
including v1 peers who read the raw file. "Hidden in the UI" is the promise A18 accepts for local projects
only. Rejected: falling back to board ballots on an old hub (it quietly breaks A18 in a team project).

## 2. Hub vote API (cloud cells and self-hosted hubs)

### 2.1 Ownership split

| Part | Owner | File |
| --- | --- | --- |
| Store: tables + methods, pure, synchronous over `sql` (the `runs-core.mjs` rules: one method = one transaction = one RPC; refusals are data; the hub clock is the only clock; lazy expiry) | **S4.6** | new `apps/hub/src/votes.mjs` (`VOTES_DDL`, `createVotesCore(sql, now)`), `apps/hub/test/votes-core.test.mjs` |
| Mounting the store in both homes | lead patch requested by S4.6 | `project-transactions/store-core.mjs` (spread `VOTES_DDL`, mount the methods), `store-remote.mjs` `METHODS` + `apps/cells/project-store.mjs` `STORE_METHODS` (+ the five names below), `hub-format-store.test.mjs` pin |
| Routes, gate rows, poke, `/health` word | **S9.13** | new `apps/hub/src/routes-v2/votes.mjs` (rows + handlers), its tests |
| The `vote` capability | lead patch requested by S9.13 (the matrix file is S9.1's, already built) | `apps/studio/access/roles.ts` + the three vocabulary pins (§2.3) |
| Desktop proxy + client | **S4.14** | `client/v2/annotations/vote-store.js`, new `routes/votes.ts` (studio proxy; `allSpecs` entry = lead patch) |

### 2.2 Store methods (`votes.mjs`)

```js
// Every method sweeps lapsed votes first, inside its own transaction (endsAt <= now → end it, §2.5).
votesStart({ project, canvas, targets, title, perVoter, durationS, expected, actor, now })
  → { vote: VoteRow } | { refused: 'invalid' | 'vote-open' | 'capacity' }
votesCast({ project, voteId, actor, picks, now })        // upsert (voteId, actor); {} withdraws
  → { vote: VoteRow, mine: Picks } | { refused: 'invalid' | 'ended' | 'not-found' }
votesEnd({ project, voteId, actor, now })                 // reveal, atomically (§2.5)
  → { vote: VoteRow } | { refused: 'ended' | 'not-found' }
votesGet({ project, voteId, actor, now })  → { vote: VoteRow, mine?: Picks } | { refused: 'not-found' }
votesList({ project, canvases?, after?, actor, now })     // open + ended within retention
  → { seq: number, votes: VoteRow[] }                     // no `mine`: one GET per vote you voted in

type Picks = Record<string /* target */, number /* ≥ 1 */>;
interface VoteRow {
  id: string;              // 'vote-' + 10 lowercase base36 — a valid annotation id (the board element shares it)
  canvas: string;          // designRoot-relative canvas path (scope key)
  targets: string[];       // 1–32, each an annotation id or an `ab:` / `el:` ref (S4.1 targetField)
  title: string;           // ≤ 200, plain
  perVoter: number;        // 1–10 (A18 default 3)
  state: 'open' | 'ended';
  startedBy: string; startedAt: number; endsAt: number; endedAt?: number;
  done: string[];          // person ids who hold a non-empty ballot — WHO voted, never WHAT
  expected?: number;       // display only (§2.5)
  tallies?: Record<string, number>;   // ONLY when state === 'ended'
  voters?: number;                    // ONLY when state === 'ended'
}
```

Tables (additive, `CREATE TABLE IF NOT EXISTS`, no schema bump):
`votes (project, id, canvas, body_json, state, ends_at, seq, PRIMARY KEY (project, id))`,
`ballots (project, vote_id, voter, picks_json, cast_at, PRIMARY KEY (project, vote_id, voter))`,
`votes_meta (project PRIMARY KEY, seq)`. Caps: 1 open vote per canvas (`vote-open`), 20 open per project
(`capacity`), `durationS` 30–3600 (default 120), body ≤ 8 KiB, ended rows kept 30 days.

**Picks rule** (same as `tallyBallots`, so a local and a hub tally agree): keys ⊆ `targets`, integers ≥ 1,
sum ≤ `perVoter`; anything else is `invalid` (never clamped). The voter is the **session's person**, never a
body field.

### 2.3 The `vote` capability

`CAPABILITIES` gains `'vote'` after `'comment'`. Held by **viewer (Can comment), member, owner**; not by
observer (Can view). It is not `PROJECT_ONLY`: a canvas grant may confer it. Start and end need **`edit`**
(S4 Q6). Why a capability of its own instead of reusing `comment`: the gate reads which word a route needs,
and "may vote" and "may comment" are separate promises in the Share sheet's role copy. Folding them would make
a later "comment, but no votes" role a matrix migration. Rejected: `annotate` (Can comment couldn't vote,
breaking Q6).

This changes the built S9.1 vocabulary. Three pins move together: `apps/studio/test/access-roles.test.ts`
("twelve capabilities" → thirteen, the list), `apps/hub/test/role-matrix.test.mjs` (the list),
and R3 stays green (no pre-existing capability changes). `apps/cloud` has its own control-plane word list
and does not gain `vote` (votes never reach the control plane).

### 2.4 Routes (`routes-v2/votes.mjs`, one table, S9 Q12)

All under `/api/projects/:p/v1/votes`, bearer auth, in **neither** canvas allowlist, `canvasDoor: true`
(the handler checks the vote's `canvas` against the session's closure; out of scope answers exactly as a
missing vote, U1).

| Method · path | `cap` | Scope | Store call | Answer |
| --- | --- | --- | --- | --- |
| `GET votes?canvas=<path>&after=<seq>` | `read` | `filtered` | `votesList` | 200 `{ seq, votes }` (only canvases the session sees) |
| `GET votes/:id` | `read` | `canvas` | `votesGet` | 200 `{ vote, mine? }` — `mine` only when the caller holds `vote` |
| `POST votes` `{ canvas, targets, title?, perVoter?, durationS?, expected? }` | `edit` | `canvas` | `votesStart` | 201 `{ vote }` · 409 `vote-open` · 429 `capacity` |
| `POST votes/:id/ballot` `{ picks }` | **`vote`** | `canvas` | `votesCast` | 200 `{ vote, mine }` · 409 `ended` |
| `POST votes/:id/end` | `edit` | `canvas` | `votesEnd` | 200 `{ vote }` (with tallies) · 409 `ended` |

`/health` capabilities gain **`votes-v1`** (next to `runs-v1`). A v1 desktop never calls these routes; its
board shows a `vote` element as an unknown type kept verbatim (R4).

### 2.5 Timer and reveal

- `endsAt = now + durationS` on the hub clock. Every store method ends lapsed votes first (lazy, as runs).
  The route module also arms a best-effort in-process timer at the nearest `endsAt` that only sends the poke;
  correctness never depends on it (a sleeping container ends the vote on its next request).
- **End = one transaction:** compute `tallies` + `voters` from the ballots, set `state: 'ended'`, `endedAt`,
  **delete the vote's ballot rows**, bump `seq`. After the end no surface — hub, studio, backup, export — can
  tell who picked what. Your own picks are not kept either; the result section carries the counts.
- **Before the end nothing aggregates:** no partial tally, no per-target count, no other person's `mine`. The
  only live signal is `done` (who has voted), which the vote bar shows as faces ("4 of 5 done").
- "5" in "4 of 5 done" is the number of people with `vote` on that canvas who are **in the project's presence
  on that canvas when the vote starts**, sent by the starter as `expected` (display only, 1–99, stored in the
  row). The vote never ends on its own when everyone is done (open question 3).

### 2.6 Ballot secrecy — the lanes a ballot must never reach

A ballot (any `picks`, and any count derived from them before the end) appears in **exactly two places**: the
`ballots` table and the voter's own `POST ballot` / `GET votes/:id` response. Every other lane is a test:

| Lane | Rule | Test (owner) |
| --- | --- | --- |
| Yjs documents (board replica, comments, `maude.files`) | No vote client writes picks to any Y doc. The cloud board's `vote` element gains `tallies` only after `ended`. | `votes-secrecy.test.mjs` sweeps every Y update during a vote for the canary target id paired with a pick (S9.13); `votes-cloud-client.test.ts` (S4.14) |
| Awareness | No vote client publishes picks. The hub drops the awareness keys `ballot`, `picks`, `vote` from every client state (defence in depth, `beforeHandleAwareness` — lead patch on S9.5's body). | `votes-awareness-strip.test.mjs` (S9.13) |
| Pokes | `{ t: 'votes', seq }` on `maude.files`, coalesced 100 ms, payload-free like `{t:'runs'}`. A canvas-only connection hears it only when the vote's canvas is in its closure: `createPokeVisibility` gains `votesVisible(connection, canvasPath)` (additive change to S9.4's `access-files.mjs`). | `votes-poke-scope.test.mjs` (A-only socket hears nothing for a vote on B) |
| History | Votes are not kernel actions: no `actions` / `effects` row, nothing in `/api/history`, Version history or `undo-stack`. | `votes-secrecy.test.mjs` asserts history row count unchanged |
| Bootstrap / manifest | `kernel.bootstrap()` and `v1/bootstrap` list store docs and heads only; the vote tables are never in them. | `votes-secrecy.test.mjs` |
| Export, download everything, backup restore drill | Export and "download everything" never read the vote tables. A backup copies the store, so a backup taken **during** a vote holds live ballots; they are deleted at the end. The hub operator is trusted with live ballots (A18 says the hub holds them). | `votes-secrecy.test.mjs` (export), note in the self-host docs (S12) |
| Logs, admin, tenant stats | Never log `picks`; admin and stats show vote counts per project only. | grep pin in `log-safety` tests |
| AI | The agent has no vote verb. `read-annotations` already hides ballots (S4.5 decision); cloud boards carry none. | existing S4.5 projection test |
| Studio → canvas iframe | The iframe gets `vote-state` (s2c) with `VoteRow` fields and **your own** `mine` only. Never another person's picks. | `vote-state` parser test (S4.14) |

**Per role** (`votes-roles.test.mjs`, S9.13): observer → 403 on ballot, start, end; viewer → ballot 200,
start/end 403; member/owner → all 200; canvas-only on A → B's vote 404 (as missing), A's 200; a forged
`voter` in the body is ignored.

## 3. Sticky ↔ comment

### 3.1 The comment record's `from` field (S9.7 owns the schema; additive, R1/R3)

```ts
interface Comment {                 // today's record, unchanged …
  author: string;                   // = the CONVERTER (the session's person). See below.
  // … plus:
  from?: {
    kind: 'sticky';                 // open word (a later 'ai-note' is not a reshape)
    id: string;                     // the sticky's annotation id
    author: string;                 // the sticky's author, display name, ≤ 120 (read from the board, never the body)
    authorId?: string;              // the sticky's author id when the board has one
    convertedBy: string;            // = author
    at: string;                     // ISO time of the conversion
    spot?: { x: number; y: number; artboard?: string };  // where the sticky sat, for "Turn back"
    fill?: string;                  // its paper, a palette colour (#rgb / #rrggbb / #rrggbbaa)   — A5 lead,
    w?: number; h?: number;         // its size, 0 < n ≤ 4096                    decision v2-lead-from-carries-sticky-look
  };
}
```

**The comment's `author` is the converter, not the sticky's author.** S9.7's door ignores a forged author
(a comment's author is the session). Keeping that rule without an exception is worth more than literal
authorship: the thread renders its first message with `from.author`'s face and name, so it still reads as
Jonas's words, and the header says who moved them. Rejected: an author-forgery exception for conversions (the
hub cannot check that the sticky existed, so it would be a way to sign comments as anyone).

The hub (S9.7) delivers **no mention** from a root message that carries `from`: the words were a sticky, not
a message to anyone. Replies mention as usual.

A v1 reader keeps `from` (`backfillComment` spreads unknown keys) and shows the comment as the converter's.

### 3.2 One conversion = one action, two lanes

Comments are a lane of the canvas document in accepted mode (`proposeLane(slug, 'comments', …)`), like
`annotations` and `meta`. So a conversion is **one kernel proposal with two `lane.replace` operations** —
`annotations` (sticky removed) and `comments` (thread added), or the reverse — `kind: 'edit'`, label
`Turned “<first 40 chars>” into a comment` / `Turned a comment back into a sticky`. One action means:

- ⌘Z (S5.5 projection), the toast's **Undo** and the header's **Undo** are all `POST /_api/project/undo
  { actionId }`. The kernel restores both lanes together. There is no second undo mechanism.
- It is the one `edit` action that touches the comments lane, and it is in your ⌘Z stack on purpose. V2-1.5
  Q4 keeps `kind: 'comment'` actions (people's messages) out; this is an edit that moved a note.

New runtime method (S4.7 adds it; `sync/index.ts` + the local home are shared files → lead patch):
`proposeLanes(slug, lanes: Array<{ lane: 'annotations' | 'comments' | 'meta', text, baseText }>,
{ writeId, kind, label })` → one proposal. The same method serves the artboard-move rider
(`S2-S4-artboard-motion-ids.md`).

**All or nothing.** The kernel's three-way undo would undo the sticky lane and skip a comments lane that
gained a reply since — the sticky back and the thread still there. So S4.7 registers an **undo guard** that
S5.5's `POST /_api/project/undo` runs before calling the runtime (patch to `routes/project-undo.ts`, S5.5 on
branch s5-5): for each target action whose comments-lane effect **added** comments (after-ids − before-ids,
from the effect bodies), refuse with 409 `{ reason: 'has-replies', line: "Tereza replied — resolve the thread
instead." }` when any of those comments now has a reply by someone other than the undoing person. Your own
replies go with the thread (the toast says "…and your reply"). A reply landing between the check and the
commit can still make the kernel skip the comments lane; the result is a duplicate, never a loss (accepted,
open question 4).

**Legacy link / no op log:** S4.7 writes both stores and returns `undoToken`; Undo calls
`POST /_api/annotations/convert-undo { token }` (in-memory, 200 per server, `stale` after a restart) — the
S2.1 revert-fallback pattern.

### 3.3 Routes (S4.7, `routes/annotations.ts`, main origin only, CSRF + loopback, never canvas-safe)

| Route | Body | Needs | Answer |
| --- | --- | --- | --- |
| `POST /_api/annotations/to-comment` | `{ file, id }` | `annotate` **and** `comment` | 200 `{ ok, commentId, actionId }` · 403 `read-only` · 404 `gone` · 409 `not-a-sticky` · 409 `empty` (a sticky with no words has nothing to say as a comment) |
| `POST /_api/comments/to-sticky` | `{ commentId }` (a comment with `from.kind === 'sticky'`) | `annotate` | 200 `{ ok, stickyId, actionId }` · 409 `has-replies` (replies by anyone but the caller) · 409 `not-converted` |

- A locked sticky converts (lock is a UX guard, DDR-246; the menu row is a deliberate act).
- The thread anchors where the sticky's arrow pointed (its bound `el:` / `ab:` host) else at the sticky's
  world centre (`world`), never at the trashed sticky's id.
- "Turn back into a sticky" re-creates the sticky with its old id when that id is free, else a new id, at
  `from.spot`, colour (`from.fill`) and size (`from.w` / `from.h`, recorded at the conversion; a `from` without
  them gets the default 200 × 200 sticky) and author from `from` — authorship of a sticky is a board field, and the board is the
  editor's to write (`annotate` = edit).
- The canvas asks through the shell: dgn `annotation-to-comment { id }` (c2s, active; S4.12's row). The shell
  sets `file` itself.

### 3.4 What S9.22 draws (thread)

- Header, only when `from` is present:
  **"From Jonas's sticky · turned into a comment by You · Undo"** — `from.author` (first name), "You" when
  `convertedBy` is you, else their name. **Undo** shows only to the converter, only while this app session
  has the conversion's `actionId` (the shell's convert map, filled from the S4.7 answer and `project:action`),
  and only while the guard would pass (no foreign reply). After a relaunch the header has no Undo, like ⌘Z.
- Thread ⋯ → **"Turn back into a sticky"** for any editor on a thread with `from`; disabled with the guard's
  line when someone else replied. Threads without `from` don't offer it in v2.0.
- testids: `comment-from-<commentId>`, `comment-from-undo-<commentId>`, `comment-menu-to-sticky-<commentId>`.

## 4. Local refusal of annotation writes for Can comment (finding D5) — S9.9

The studio's read-only gate is binary today, so Can view may comment and nothing distinguishes the two
read-only roles. S9.9 makes it capability-based:

- `/_api/annotations/ops` (main **and** canvas origin listener), the canvas-meta `annotations` rider, and both
  §3.3 routes need `annotate`: Can comment and Can view get 403 `read-only`, locally and through the hub door
  (hub `annotate` = edit, already).
- `/_comments` writes need `comment`: Can view gets 403.
- Votes need `vote` (studio proxy `routes/votes.ts` asks the same gate before forwarding).
- Rows in `test/_role-refusals.ts` for each; `access-role-matrix.test.ts` (observer + viewer columns).

## 5. Tests that pin this contract

S4.6: `votes-core.test.mjs` (picks rule ≡ `tallyBallots` on a shared fixture; lazy end; end deletes ballots;
upsert; withdraw), the 300-round concurrent-cast race (two voters, never one overwriting the other).
S9.13: `votes-secrecy`, `votes-roles`, `votes-timer`, `votes-poke-scope`, `votes-awareness-strip`; v1 compat
(a 1.9.1 client never sees `votes-v1` routes change anything). S4.14: `votes-local`, `votes-cloud-client`.
S4.7: `annotations-convert.test.ts` (both directions, one action with two lanes, ⌘Z restores both
byte-for-byte, guard refuses after a foreign reply, author = converter, 403 for Can comment). S9.7: comments
schema accepts `from`; mixed v1/v2 round trip keeps it; no mention from a `from` root.

## 6. Open questions (default the run takes)

1. Should anyone see who picked what after the end? **No** (counts only; ballots deleted).
2. Votes on a hub without `votes-v1`: **off with the line** (§1).
3. End automatically when `done.length === expected`? **No** — the timer or End vote ends it.
4. A reply racing an Undo: **duplicate accepted**, never a loss; revisit if seen in dogfood.
5. "Turn into a sticky" for an ordinary comment (no `from`): **not in v2.0**.
