# S3 · On-click links — format, playback, opener

Slice S3.0 (contract), built by S3.10a (engine, route, playback, chip) and S3.10b (external targets). Spec rows:
`S3-slices.md` §2 D2–D4, §3 S3.10a/b. Builds on `V2-1.4-element-ids.md` (§4.6 canvas-only namespace, §5.3 check,
§5.5 strip), `V2-1.2-mode-toolbars.md` (Preview, per-window mode, Q6), `S2-slices.md` Q1 (`/_api/edit-op`),
Q4/Q5 (On click is S3, On hover is S2), `V2-1.12-file-formats.md` R6. Canvas: `04 Modes` md-edit (chip + On click
row), md-preview-follow (playback + back). Graph: `maude/v2-S3-links-data-cd-link`,
`maude/v2-S3-shell-resolves-links`, the zone-locked opener decision (`d_8d4d77161a0b76b299fa1eba`).

## 1 · Decision

1. **A link is one attribute in the TSX:** `data-cd-link="<target>"` on an element that carries a literal
   `data-cd-id`. Three target forms (§2). It is canvas-only metadata (V2-1.4 §4.6): versioned with the canvas,
   visible to Claude where it edits, stripped by every exporter (`stripCanvasOnly` already removes the prefix).
2. **Writing a link is one TSX write and one undo step.** The writer stamps the id (if missing) and sets the
   attribute in the same write, through S2's dispatch route `POST /_api/edit-op` with `op: 'element.set-link'` or
   `'element.clear-link'`. No new write route, no `.meta.json` write. `.meta.json` `links` stays reserved and unused.
3. **The canvas never hands the shell a target.** In Preview the canvas posts only `link-follow {elementId,
   artboardId}`. The trusted shell reads the target from the versioned TSX through a main-origin read route
   (`GET /_api/links`), checks it, and acts.
4. **External targets open only after a confirmation the shell draws.** A browser shell opens the page from the
   confirmation's click. The desktop needs a narrow opener, which is a **DDR-054 amendment** (§6). Until that lands,
   or if it is refused, the desktop confirmation shows the full URL with **Copy link** and opens nothing.
5. **On hover is S2's** (`data-hover="<preset>"`, outside `data-cd-*` because it is design and must export:
   `S2-slices.md` Q5, `S2-hover-format.md`). S3 adds no hover runtime. Preview plays hover because it is real CSS.

**Rejected:**
- `.meta.json` `links` keyed by element id. It takes two writes (stamp in TSX, link in meta), so it is two undo
  steps. It dangles when Claude rewrites an artboard, and Claude doesn't see it where it edits.
- The canvas posting the target URL or path. The canvas origin is untrusted (DDR-054), so the shell would be
  opening whatever a planted canvas asked for.
- A new `POST /_api/edit-link` route. S2 Q1 already funnels structural element writes through one dispatch route.
- `tauri-plugin-opener` or any general opener. DDR-054 and the zone-locked opener decision refuse it.
- Links that follow in Present. In Present a click means "next" (S3.2a). Links play in Preview only.

## 2 · Grammar (`bridge/link-target.ts`, pure, leaf; shared by canvas, shell, server, check)

The value is a plain JSX string literal (`data-cd-link="…"`). An expression value is invalid. Readers use the
parser's cooked value, which equals the DOM value.

| Form | Example | Rules |
| --- | --- | --- |
| same canvas | `#pricing-desktop` | `#` + artboard id `^[A-Za-z0-9_-]{1,64}$` (the meta schema's `artboardId`) |
| other canvas | `site/pricing.tsx#desktop` · `site/pricing.tsx` | designRoot-relative POSIX path, NFC, ending `.tsx`; split on the **last** `#`; no leading `/`, no `\`, no `:`, no empty / `.` / `..` segment, no segment starting `_` (runtime dirs). No artboard → the target canvas's first artboard in Present order (D5) |
| external | `https://cal.com/studio` | lowercase `http:` or `https:` only; WHATWG-parsed and stored as `new URL(v).href`; ≤ 2048 chars; host required; no userinfo; host not `localhost`, `*.localhost`, a loopback or link-local IP literal; no control or whitespace characters; no HTML character reference (`&name;`, `&#n;`: JSX would decode it) |

Anything else is **invalid**: `javascript:`, `data:`, `file:`, `blob:`, `mailto:`, a relative path that escapes the
design root, a bare word. Total length ≤ 2048.

```ts
// apps/studio/bridge/link-target.ts — no React, no DOM, no node:* (bundled into the canvas runtime too)
export const LINK_ATTR = 'data-cd-link';
export const LINK_MAX = 2048;
export type LinkTarget =
  | { kind: 'artboard'; artboard: string }                       // "#<id>"
  | { kind: 'canvas'; canvas: string; artboard: string | null }   // "<rel>.tsx[#<id>]"
  | { kind: 'external'; url: string; host: string };              // "https://…" (href-normalised)
export function parseLinkTarget(raw: unknown): LinkTarget | null;  // null = invalid
export function formatLinkTarget(t: LinkTarget): string;          // parse(format(t)) deep-equals t
/** "Go to Pricing" · "Go to Desktop" · "Opens cal.com/studio". The names come from the caller; fallback
 *  is the canvas file's basename without `.tsx`, words capitalised, and the artboard id. */
export function linkLabel(t: LinkTarget, names?: { canvas?: string; artboard?: string }): string;
export function externalDisplay(url: string): string;             // host + path, no scheme, no trailing "/"
```

## 3 · Writers and reader (`canvas-edit.ts`, S3.10a)

```ts
export class LinkTargetError extends Error { code: 'link-format' }
/** Stamp `id` if needed (ensureStamped) + set `data-cd-link` in ONE returned source. Idempotent.
 *  Replaces an existing value in place. Throws LinkTargetError on an invalid target. */
export function applySetLink(canvasAbsPath: string, source: string, id: string, target: string,
  opts?: { occurrence?: number; reserved?: Iterable<string> }): { source: string; id: ElementId };
/** Remove `data-cd-link`. The id stays (ids are never removed). No-op when absent. */
export function applyClearLink(canvasAbsPath: string, source: string, id: string,
  opts?: { occurrence?: number }): { source: string; id: ElementId };
/** Every link in a file, in source order. `target` null = invalid value (reported, never followed). */
export function readLinks(source: string, path: string): Array<{
  id: ElementId | null; artboardId: string | null; line: number; raw: string; target: LinkTarget | null }>;
```

- The attribute is written right after `data-cd-id` (`addCdAttr`, like `data-cd-locked`). External values are
  written in `href` form.
- **Duplicate, paste and insert keep `data-cd-link` on the copy.** A copied button still goes to Pricing. This
  differs from `data-cd-locked`, which a copy drops (V2-1.4 §5.5).
- Edit-op wiring (S2's dispatch): `edit-ops/set-link.ts` and `edit-ops/clear-link.ts` wrap the two writers.
  Body is S2.1's shape (`edit-ops/types.ts` `EditOpRequest`; decision `v2-lead-link-writes-use-edit-op-shape`):
  `{ file, op, targets: [{ artboard, element, occurrence? }], params: { target }, expectRev? }`. `params.target` is
  the `data-cd-link` value (`element.set-link` only; `element.clear-link` takes no params). Exactly one target.
  The dispatcher stamps `element` first, so the writer always sees an authored id. One accepted write = one V2-1.5
  action (`undo: 'step'`; the legacy undo is `revert {writeId}`). An AI hold → `409 held-by-ai`, a locked target →
  `409 locked`, an invalid target → `400 invalid`, as for every edit op. (An earlier draft of this section named a
  flat `{ op, canvas, id, … }` body; no code ever used it.)

## 4 · The read route (`routes/links.ts`, S3.10a)

```ts
{ method: 'GET', path: '/_api/links', origin: 'main', readOnly: 'allowed', handle }   // never 'canvas'
// GET /_api/links?file=<designRel .tsx>   → 200, Cache-Control: no-store
{ v: 1, file: string, links: Array<{
    id: string; artboard: string | null;                     // the linked element and the artboard it sits in
    target: string;                                          // the raw value
    kind: 'artboard' | 'canvas' | 'external' | 'invalid';
    canvas?: string; toArtboard?: string | null;             // canvas / artboard targets
    url?: string; host?: string;                             // external
    state: 'ok' | 'dangling' | 'invalid';
    label: string }> }                                      // linkLabel with the real artboard / canvas names
```

- Capability `read` on `file` (any role, Can view included: a view-only link opens in Preview and must follow links).
- **No existence oracle under canvas-scoped grants (V2-1.16):** a target canvas the session cannot read reports
  `state: 'dangling'` and the fallback label, exactly as a missing canvas does.
- 404 for a missing or unreadable `file` (one body for both). 400 for a bad `file` grammar.
- Parse budget: one oxc parse + walk, measured 26–44 ms on the largest v2 canvases by V2-1.4 §6.
- Classification: `sync/writer-registry.ts` `'/_api/links': { class: 'read' }`;
  `apps/hub/src/studio-manifest.mjs` `'/_api/links': { safe: 'read', unsafe: null }`.

## 5 · Playback (Preview only)

| Step | Who | What |
| --- | --- | --- |
| 1 | canvas (input-router, Preview branch) | A plain click whose `closest('[data-cd-link]')` also carries `data-cd-id` posts `link-follow {elementId, artboardId}` and calls `preventDefault`. ⌘-click inspects instead (S3.11). Edit, Viewing and Present never post it |
| 2 | shell | Gate `active`. The shell's **own** mode must be `preview`, no modal open, ≤ 4 follows per second. Otherwise the message is dropped silently |
| 3 | shell | `GET /_api/links?file=<active>`. The entry is looked up by `elementId` (+ `artboardId` when two match). No entry, or `invalid` → drop silently |
| 4a | shell · `artboard` | `run-action {id: 'view.zoom-to-artboard', params: {id}}` to the active canvas (existing lane). Push a back entry |
| 4b | shell · `canvas` | Open the target canvas in this window. Mode stays Preview (V2-1.2 Q6). On load, `run-action view.zoom-to-artboard` (the explicit artboard, or the first in Present order). Push a back entry. The PreviewBar shows "‹ <previous canvas>" |
| 4c | shell · `dangling` | Stay put. Toast: "That link goes to a canvas that isn't here any more." / "…to an artboard that isn't here any more." |
| 4d | shell · `external` | The trusted confirmation sheet (§6) |

**Back.** `client/v2/preview/preview-history.js`: a per-window stack of `{ canvas, camera }`, at most 50 entries,
in shell memory only. Leaving Preview clears it. `preview.back` pops one entry and restores that canvas and camera.
Esc order is unchanged: esc leaves Preview, it does not go back.

**Chip (Edit).** `link-chip-overlay.tsx` in the canvas shows "Go to Pricing" or "Opens cal.com/studio" while
exactly one selected element carries `data-cd-link`. The canvas derives the text from the attribute: `linkLabel`
gets the artboard labels it already has, and the file basename for other canvases. The chip is read-only and never
fetches. The inspector's On click row (S2's Interaction section) reads `/_api/links` for the real name and the
dangling state.

## 6 · External targets (S3.10b)

**Confirmation** (`client/v2/preview/external-link-confirm.jsx`, trusted shell chrome):
- Title "Open a website?". It shows the host in bold and `externalDisplay(url)` beneath it. Buttons: **Open**
  (primary), **Copy link**, Cancel. Esc cancels.
- Shown once per host per window session. Later follows to the same host open straight away. A host change always
  asks again.
- Browser shell: **Open** calls `window.open(url, '_blank', 'noopener,noreferrer')` inside the click handler.
- Desktop shell: **Open** calls `open_link_external` (below) when the build has it. Otherwise the sheet has no
  Open button. It shows the full URL as selectable text plus **Copy link** (primary), and the line "Paste it in
  your browser."

**DDR-054 amendment (lead + security pair), drafted:**
> Add a third opener, `open_link_external(url)`, granted to project webviews only. It may be called only from the
> shell's link confirmation: the Rust side cannot check intent, so the confirmation is the gate. Rust re-checks
> everything: `caller_project` (label and top-frame origin), `http`/`https` only, ≤ 2048 chars, no userinfo, the
> host is not loopback or link-local, the `open_cloud_url` metacharacter refusal set (CVE-2024-24576), at most one
> open per second per window. Registered at all four sites (`lib.rs`, `build.rs`, `capabilities/default.json`,
> `permissions/autogenerated/open_link_external.toml`). If the amendment is refused, the desktop keeps the
> Copy-link fallback for good. Record that as a Progress-log exception against S2's md-edit row.

## 7 · `maude design check` rules (S3.10a; `element-ids.ts` + `check`)

| Code | When | Severity | Message shape |
| --- | --- | --- | --- |
| `link-format` | `data-cd-link` is an expression, or `parseLinkTarget` returns null | error | `Button "See pricing" (line 212): data-cd-link must be "#<artboard>", "<canvas>.tsx#<artboard>" or "https://…".` |
| `link-no-id` | `data-cd-link` on an element without a literal `data-cd-id` | error | `… has a link but no data-cd-id — add one (lowercase words joined by -).` |
| `link-dangling` | an artboard or canvas target is not in the project | warning | `… links to site/pricing.tsx#desktop, which isn't in the project.` |

- **`data-cd-link` is the one `data-cd-*` attribute Claude may write.** `cdKey` (`element-ids.ts`) leaves it out,
  so adding, changing or removing a link is never `cd-attr-changed`. The three rules above judge it instead.
- A dangling link is a warning, never a block, because a link can point at a canvas that doesn't exist yet. The
  run result lists it.
- **Move and rename (S1).** Until S1's canvas move rewrites incoming links, moved targets dangle with the state
  above. Note for S1: a move or rename rewrites every `data-cd-link` whose canvas part equals the old path, in the
  same structural action.

## 8 · Agent path (S3.10a)

- Registry `element.set-link`: `TSX('Add data-cd-link="#<artboard>" | "<canvas>.tsx#<artboard>" | "https://…" to
  the element, next to its data-cd-id (add an id if it has none)')`. Registry `element.clear-link`:
  `TSX('Remove the element\'s data-cd-link')`. Both `minRole: 'edit'`, `undo: 'step'`,
  `server: { route: '/_api/edit-op', method: 'POST' }`.
- `apps/studio/schema/canvas-tsx.md`: one new row, "A link is `data-cd-link` on an element with a `data-cd-id`
  (S3-links-format §2)", checked by `link-format` · `link-no-id` · `link-dangling`.
- `plugins/design/skills/design/_guide-02-hard-contract-non-negotiable.md` rule 8, one new bullet: "*`data-cd-link`
  is the one `data-cd-*` you may write: it is the element's On click (`#<artboard>`, `<canvas>.tsx#<artboard>` or
  an `https://` address). Keep it when you keep the element. The element needs a `data-cd-id`.*"
- The generated `studio-actions` SKILL picks the rows up from the registry (`scripts/gen-actions.mjs`).

## 9 · Bridge messages (lead adds to `bridge/dgn-protocol.ts`)

```ts
// CanvasToShell
'link-follow': { elementId: Id; artboardId: Id | null };
// c2s spec
'link-follow': {
  gate: 'active',            // + shell mode === 'preview' + no modal + ≤ 4/s, in the handler
  status: 'new',             // → 'live' in S3.10a
  owner: 'S3 links (client/v2/preview/link-follow.js)',
  parse: p({ elementId: elementIdV, artboardId: nul(artboardIdV) }),
},
// elementIdV: str matching /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, ≤ 48, not /^[0-9a-f]{8}$/ (V2-1.4 §4.2)
// artboardIdV: str matching /^[A-Za-z0-9_-]{1,64}$/
```

No shell → canvas message is new. Same-canvas and cross-canvas playback use the existing `run-action`
(`view.zoom-to-artboard`). `mode-request` cause `'link'` stays unused by links, because following a link never
changes mode.

## 10 · Tests that prove it (red first)

| Test | Proves |
| --- | --- |
| `test/link-target.test.ts` | every §2 row both ways; refused: `javascript:`, `data:`, `file:`, `mailto:`, `//evil`, `../x.tsx`, `_draw/x.tsx`, `a:b.tsx`, userinfo, `localhost`, `127.0.0.1`, `[::1]`, `169.254.x`, entity references, 2049 chars; `parse(format(t))` round-trip; last-`#` split |
| `test/apply-set-link.test.ts` | one write stamps and links (byte diff = id + link only); the V2-1.5 recorder sees one action; idempotent; replace in place; clear keeps the id; a copy keeps the link and gets a new id |
| `test/links-route.test.ts` | absent from `CANVAS_SAFE_API` and the canvas routes map (canvas origin → 404); read-only session → 200; canvas-scoped session: an unreadable target reads `dangling` (byte-equal to a missing one); missing file and forbidden file give one body |
| `test/link-follow-shell.test.ts` | dropped outside Preview, from a background frame, with a modal, over the rate; a payload carrying `target`/`url` keys is stripped by `parse`; dangling stays put with the toast |
| `test/element-ids-link-check.test.ts` | `link-format`, `link-no-id`, `link-dangling`; changing a link is **not** `cd-attr-changed` (fails against today's `cdKey`) |
| `test/strip-canvas-only.test.ts` (extend) | handoff, HTML export and copy-as-code outputs carry no `data-cd-link` |
| `test/external-link.test.tsx` (S3.10b) | the scheme gate, the host shown, once per host, a browser `window.open` from the click only, the desktop fallback with no opener |
| Rust `open_link_external` (if amended) | caller check, refusal set, rate limit; listed by `every_granted_command_checks_its_caller` |

## 11 · Open questions (recommended default in bold)

- `mailto:` and `tel:` targets? **Not in v2.0.** The grammar refuses them, and `link-format` names the allowed forms.
- Links in Present · Artboards (prototype click-through)? **No. A click advances.** A later "Present as prototype"
  would be a new `PresentSpec.kind`.
- Should HTML export turn links into real `<a>` navigation between exported pages? **Not in v2.0: stripped.** S8 may
  map same-canvas links in a multi-page export later.
- Follow a link from Viewing (Can view's specs mode)? **No.** A Viewing click inspects (S3.11). Preview is one
  click away and follows links.
