# Canvas source vocabulary and UI operations

Plan `feature-reliable-project-multiplayer` T23–T25 (DDR-241). Generated counts
come from `bun scripts/dev/source-vocabulary.ts <designRoot>... --md` (aggregate
counts only — no source text leaves the machine); re-run it on a project before
relying on the percentages for that project.

## What canvases are made of

| Construct | Count | Structured operations |
|---|---:|---|
| Canvases (parse errors) | 77 (0) | broken TSX travels as a held candidate |
| JSX elements | 10819 | addressable by print: delete / duplicate / move |
| — with a unique print | 9029 (83%) | re-found after a concurrent structural change; the rest re-apply only when nothing moved |
| — authored `data-cd-id` | 6 | stable by construction |
| — custom component usages | 1744 | edited at the usage; the definition is code |
| Literal text children | 4376 | text op (87% of text) |
| Expression text children | 667 | code candidate (the `{var}` resolver covers traced literals) |
| Literal attributes | 13057 | set / remove (90% of attributes) |
| Expression attributes | 1526 | code candidate |
| Spread attributes | 12 | code candidate |
| Inline style objects | 904 | style.* set / remove per property |
| — literal style properties | 2330 | 86% of style properties |
| — expression style properties | 364 | code candidate |
| Style expressions (not an object literal) | 22 | code candidate |
| Artboards (literal id + width) | 134 (124) | artboard ops by authored id |
| `.map()`-rendered lists | 167 | edits reach the array literal; structure is code |
| Conditionally rendered JSX | 125 | code candidate |
| Imports (relative) | 291 (206) | preserved verbatim; never rewritten |

Corpora: maude (73 canvases), project (4 canvases).

## How a UI edit travels

Every persistent canvas change is still a lane proposal with the base it was
made from (`lane.replace`, three-way merged by the hub from that base). What
T24/T25 add is that an edit made **through the UI** also says what it *is*
(`apps/studio/sync/source-ops.ts`): the operation, its arguments, and the
target element's **print**.

| Operation | Emitted by | Target identity |
|---|---|---|
| `text` | `/_api/edit-text` | print without the element's own text |
| `set` / `remove` (attributes, `style.*` properties) | `/_api/edit-attr`, `/_api/edit-css` | print without the edited attribute |
| `delete`, `duplicate` | `/_api/delete-element`, `/_api/duplicate-element` | print |
| `move` (reorder / reparent) | `/_api/reorder` | print of the element and of its reference |
| `artboard` (resize, hug, style, kind, guides) | the artboard routes | the artboard's authored `id` |

A **print** (`canvas-edit.ts` `elementPrint`) is the enclosing component, the
tag, the chain of ancestor tags, the element's literal attributes (minus the
pipeline's `data-cd-*` and the edited one) and its own literal text. The
positional `data-cd-id` is kept as a hint: it is tried first, and only when the
element there no longer carries the print is the one element that does looked
for (`relocateElement`). None, or more than one, is ambiguous — never guessed.

When a UI edit's proposal loses a race (`base-conflict`), the projection
re-applies the operation onto the version that won and proposes again (at most
three times). The effect is **acceptance order per property**: two people
setting the same colour end with the later one, nothing else of either
person's is lost, and History keeps both actions. An operation that cannot be
re-applied (its target was deleted or became ambiguous, the rebased source does
not validate, the file changed again meanwhile) is a genuine conflict and goes
to the person (SourceConflictPanel).

## Code candidates

Everything outside the table's operations — expression text and attributes,
spreads, computed styles, `.map()` structure, conditional rendering, custom
component definitions, imports, and any hand or agent edit of the source —
travels exactly as written: merged three-way from its base, preserved
byte-for-byte, and turned into a conflict (never a lossy conversion) when it
touches a concurrent change. Timeline clip operations address clips by their
own stable id and content hash; a race on the same clip is a conflict.
Transient previews (a drag in progress, text being typed) never propose; the
gesture's end is one action.

## Fidelity and limits (T23, checked against the whole corpus)

`apps/studio/test/sync-structured-actions.test.ts` runs every canvas of this
repo's `.design/` through the UI operations:

- **No-op is byte-identical.** Setting a literal attribute to the value it has,
  or a text to the text it shows, changes no byte — quote style, line breaks in
  multi-line JSX text and the author's spelling survive.
- **Types survive.** `height={400}`, `durationInFrames={30}`, `hidden={false}`
  and `gap={-8}` stay numbers and booleans when edited to another number or
  boolean (they used to come back as strings — a silent type change for any
  component that does arithmetic on its prop). A number edited into words
  (`auto`) becomes a quoted string, the only honest spelling.
- **Round trip and determinism.** A change and its reversal return the exact
  original bytes; the same operation on the same base yields the same bytes.
- **Addressing by print.** Every element whose print is unique is re-found with
  a deliberately wrong positional hint.
- **Source-size limit.** On the largest canvas in the corpus (79.8 KB, 785 JSX
  elements) a print lookup takes ~3 ms; the check fails above 250 ms. A re-apply
  after a lost race is a handful of lookups, so canvases an order of magnitude
  larger stay interactive; beyond that, edits still work but a lost race costs
  proportionally more.
