# S4 ↔ S5: AI with annotations

Status: **contract** (Phase 5 contracts spike, 2026-10-18). Writer: S4 planner. Consumers: **S4.15** (AI in
the canvas), **S4.4** (Templates "describe it"), **S4.5** (the `annotate` verb, built), **S5.5** (run stages,
branch s5-5), **S5.8** (scope chip, built), **S5.9** (result card), **S5.6** (ACP prompt scope), **S2.19**
(⌘/ on elements — the sibling scope kind), **S12** (skill text). Canvas: `15 Annotations` an-ai-read,
an-ai-apply, an-ai-stickers, an-ai-write, an-templates; `03 AI Chat` ai-scope, ai-question.

## 1. Annotations as a ⌘/ scope kind

S5.8's scope (`client/v2/ai/scope.js`) is `{kind:'whole'} | {kind:'artboards', ids} | {kind:'none'}`. Two
kinds join it, one from each neighbour:

```ts
type Scope =
  | { kind: 'whole' } | { kind: 'artboards'; ids: string[] } | { kind: 'none' }
  | { kind: 'elements'; refs: ElementRef[] }                           // S2.19 (ai.ask-selection)
  | { kind: 'annotations'; file: string; ids: string[]; artboards: string[] };  // THIS contract
```

- **Where it comes from.** The canvas posts dgn **`annotation-selection { ids, kinds, artboards }`** (c2s,
  gate `active`, owner `annotations-layer`; coalesced ≤ 1 per 50 ms; `ids: []` clears it). `kinds` is a count
  per type (`{ sticky: 3 }`); `artboards` is the union of each item's `parentArtboard` and the artboards its
  bound arrow ends reach. The shell sets `file` to the active canvas itself (a canvas only names its own
  annotations). Annotation and element selections are exclusive (Preview vs Edit), so the chip follows
  whichever is non-empty.
- **⌘/** with annotations selected runs registry `annotation.ask-ai` (S4.12's row), which opens the composer
  with this scope. ⌘/ with elements selected stays `ai.ask-selection` (S2.19). Mode decides; they never race.
- **The chip** (`scopeLabel`): one type → "3 stickies", "1 sticky", "2 arrows"; mixed → "5 annotations".
  `scopeTitle`: "AI reads these 3 stickies". Stale (an id gone before send) → the existing `ai-scope--stale`.
- **What the prompt carries** (`scopeForPrompt`): `{ kind: 'annotations', file, ids, artboards }` — ids and
  artboards only, **never the sticky text**. The `[maude-scope …]` line reads
  `[maude-scope annotations: 3 on ui/Homepage.tsx — read them with: maude design read-annotations --selection <ids>]`.
  The agent reads the words through the verb, which already wraps them as untrusted data (S4.5). Sticky text
  is other people's input; inlining it in the prompt would make it instructions.
- **The run's lease scope** (V2-1.15): `RunScope { canvas: file, artboards }` from the same `artboards`; empty
  → the whole canvas. Annotation writes themselves take no lease (§2).

## 2. Annotation writes inside a run: `actionId: 'run:<runId>'`

Today `/_api/annotations/ops` proposes every batch at once, not stageable (an API write is a person's,
`projection.ts`). So an AI run's resolves and review stickies land as their **own** actions, outside the run,
and "Undo this chat" (S5.5: the chat's `ai` actions) misses them. The fix is a tag:

- **Wire.** The batch's `actionId` is `run:<runId>` (`runId` per `/^[A-Za-z0-9_-]{1,64}$/`).
  `validAnnotationWriteId` accepts exactly that one extra shape (`/^run:[A-Za-z0-9_-]{1,64}$/`).
- **Main origin only.** A run tag on the canvas-origin listener → 400 `run-tag-main-origin-only`, nothing
  written. A planted canvas must not be able to slip its writes into your AI run (they would then be undone,
  attributed and published as AI work).
- **The run must be open.** The studio asks the run registry (S5.3) for `runId`; not open (ended, held,
  someone else's, unknown) → 409 `run-not-open`, nothing written. Never "write it anyway as a person's" — it
  would escape the chat's undo.
- **Staging.** For a tagged batch the server applies the ops to the board as today, then calls
  `stage.claim(runId, slug, hashBytes(nextText))` and `proposeLane(slug, 'annotations', nextText,
  { baseText, writeId: actionId, stageable: true })`. The claim by hash makes `ownerOf` pick **this** run even
  when several are open. The run publishes the annotations lane with its other lanes as **one action**
  (`kind: 'ai'`, `origin.runId/chatId`) — one ⌘Z entry, one result-card Undo, and "Undo this chat" covers it.
  The live-room shortcut (`applyAnnotationOpsLive`) is skipped for tagged batches.
- **Who sends it.** `bin/_annotate-post.mjs` (S4.5, built) sends `run:<runId>` when the verb runs inside a chat:
  it reads `MAUDE_CHAT_ID`, finds its own row with `thisChat` in a live state (`_runs.mjs` `LIVE`) in `GET /_api/ai/runs`, and uses
  its `runId`. No chat or no running run → today's `ai-annotate-<rand>` (a terminal Claude's edit, an outside
  write). This is a change to the built S4.5 verb.
- **No lease.** Annotation lanes merge per element (DDR-242); another run holding an artboard does not stop
  this run from writing a sticky on it.

## 3. Templates "describe it" — prefill and send in one gesture

S4.4 (built) fills the composer through `sendToAskAI(text)` and the person presses send again. The canvas asks
for one gesture: type, press ↵ (or the Ask button), and the run starts.

- `sendToAskAI(text, target, opts?)` (`client/v2/search/search-env.js`) gains `opts = { send?: true,
  scope?: Scope, origin: 'templates' | 'palette' }`; the event detail carries them.
- The composer (`subscribeAskAI`, S5.8) **sends** only when `detail.send === true` **and**
  `navigator.userActivation?.isActive !== false` at the moment the event arrives (the panel dispatches it
  synchronously inside its own key or click handler); otherwise it fills, as today. ⌘K's "Ask AI" row keeps
  `send` absent (it fills).
- The text is the person's words verbatim behind the existing `DESCRIBE_PREFIX` ("Build this on the canvas: ").
  Scope `{ kind: 'whole' }`. The agent builds the board with `annotate` (`--board` / ops), tagged per §2, so
  the board lands as one AI action.
- The send goes through every gate a typed send meets (read-only refusal, offline outbox, allowance). A
  browser tab shows `NO_CHAT` as today.
- Change to built S4.4: `onDescribe(text)` → `askAI(text, { send: true, origin: 'templates' })`.

## 4. The "Make these changes" card

an-ai-read: AI reads the scope, outlines what the stickies mean, says the plan in one line, and offers one
button. Nothing has changed yet. The card is an **offer**: its button sends a canned follow-up, it never acts.

**Transport.** The agent ends its answer with one fenced block, which S5.9's feed parses out of the final
message (the block is not shown as text):

````
```maude-offer
{ "v": 1, "says": "…", "answers": ["s_a1", "s_b2", "s_c3"], "leaves": ["s_d4"],
  "targets": [{ "ref": "el:desktop/hero-picture", "name": "The hero picture" }] }
```
````

```ts
interface AnnotationOffer {
  v: 1;
  says: string;      // the plan in one line, ≤ 240 chars, plain text (rendered as text, never Markdown/HTML)
  answers: string[]; // annotation ids in the scope that this change answers (resolved by the apply run, §4.2)
  leaves: string[];  // ids in the scope it does NOT include — named in the card ("Tereza's “Warmer sun?” isn't included.")
  targets: Array<{ ref: string; name: string }>;  // `ab:<id>` | `el:<artboard>/<id>` + a short name ≤ 40
}
```

- **Validation (S5.9):** `answers` and `leaves` ⊆ the run's scope ids (others dropped); `targets[].ref` parse
  as host refs that resolve on the canvas (others dropped); at most 8 targets; a block that fails JSON or `v`
  is ignored and the answer reads as plain text.
- **Fixed words, not the agent's:** primary **Make these changes**, secondary **Not now** (CONTRACT copy). The
  agent writes only `says` and the names.
- **While the card is the latest message**, the shell posts `ai-seen { targets }` (s2c → the canvas, owner
  `annotations-layer`) and the canvas draws the spark outline + tag ("✦ The hero picture"). The outline goes
  when the card is answered or the chat moves on.
- **Make these changes** sends the text "Make these changes" with the same `annotations` scope, plus the
  hidden line `[maude-offer-accepted answers=<ids>]`. **Not now** sends nothing and folds the card.

### 4.2 Apply

The apply run edits the design and resolves `answers` with `maude design annotate --resolve <ids>`, tagged
per §2, so the design change and the resolves are **one action**: the result card's Undo, ⌘Z and "Undo this
chat" all revert both (an-ai-apply: "⌘Z undoes both"). Status stickers (an-ai-stickers, `--sticker
<pack>/<id>`) ride the same run. The result says, per `ai-describes-the-result`, what changed and that the
stickies stay, resolved.

## 5. Tests that pin this contract

- `annotations-run-tag.test.ts` (S4.15): tagged batch from the main origin with an open run → staged, published
  with the run's design change as **one** action; Undo this chat restores both; tag from the canvas origin →
  400; run not open → 409 and the board unchanged; two open runs → the claim picks the tagged one.
- `annotate-run-binding.test.mjs` (S4.5 follow-up): with `MAUDE_CHAT_ID` and a running row the verb sends
  `run:<id>`; without, `ai-annotate-*`.
- `v2-ai-scope.test.ts` (S5.8, extended): annotation scope labels, title, `scopeForPrompt` carries no text.
- `ask-ai-send-gesture.test.ts` (S4.4 follow-up): `send:true` with transient activation sends; without it
  fills; ⌘K still fills.
- `ai-offer-parse.test.ts` (S5.9): validation rules, fixed button words, a bad block reads as text.
- `annotations-ai-undo.test.ts` (S4.15, already planned) becomes the end-to-end of §4.2.

## 6. Open questions (default the run takes)

1. Offers on element scopes (S2.19) too? **Yes, same block** — `answers`/`leaves` empty, `targets` from the
   refs. S2.19 may adopt it; nothing here depends on it.
2. Should **Make these changes** go straight to Edit? **Yes** — the apply run's changes are in Edit (an-ai-apply
   shows Edit), and the layer goes quiet; the shell switches mode when the run starts.
3. An agent that resolves stickies outside `answers`? **Allowed** (strict writes still apply: no author changes,
   no locked items); the result names what it resolved.
