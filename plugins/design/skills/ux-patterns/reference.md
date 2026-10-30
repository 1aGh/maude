# UX composition patterns — full reference

The rationale behind every rule in `SKILL.md`. Each rule says **what to do, why, and how a reviewer checks it**.
Rule IDs (`UX-<area>-<n>`) are stable; cite them in findings.

## 0. Meta-patterns — how to think before applying any rule

These are worth more than any single rule — apply them before reaching for a specific one.

| # | Meta-pattern | What it means in practice |
| --- | --- | --- |
| M1 | **Content first, layout second** | List the content types, group and prioritize them; the layout falls out of the groups. Never start from boxes. |
| M2 | **Subtract before you add** | Most fixes are removals — borders, containers, numbers, dots, columns, content, icons, a second hero image. Default answer to "should this be here?" is *no* unless it carries meaning or speeds a decision. |
| M3 | **Design the decision, not the decoration** | Frame UI problems as user-decision problems: *decision friction*, *cognitive overload*, *signal vs noise*, "users don't know whether to choose this or that". A fix is good if the user decides faster. |
| M4 | **One of each** | One hero image, one primary CTA, one alignment anchor, one control per action, one icon library, one place for navigation controls. Plurality is the most common bug. |
| M5 | **Small named steps, before → after** | Each fix applies one principle to one element (contrast, weight, spacing, alignment, copy, anchor). That sequence *is* a critique recipe. |
| M6 | **Borrow proven patterns** | Platform tab-bar conventions over Dribbble novelty; icon libraries over custom icons; copy validated by Airbnb/Uber/Notion/Linear/Revolut. Novelty must beat expectation, it rarely does. |
| M7 | **Systems over eyeballing** | Spacing scale, radius formula, token naming, gradient steps, dark-mode opacity rule — numbers replace "looks about right". |
| M8 | **It isn't done until the other theme works** | A pattern must survive the second theme. |
| M9 | **Hierarchy has a time axis** | Layout gives spatial hierarchy; motion gives temporal hierarchy. Reveal in order of importance. |

---

## 1. Hierarchy & layout

**UX-HIER-1 · Build layout from content groups.** Inventory content types (e.g. user · activity · comment ·
actions), group and prioritize, then form the layout from the groups; highlighting the groups should reveal the
layout. *Why:* layout that mirrors meaning is scannable. *Check:* can every region be named as one content group?
An element belonging to no group is a removal candidate.

**UX-HIER-2 · Hierarchy tools inside a group: size → color → proximity → order.** Primary vs secondary by size
and color (name vs timestamp, value vs label); related items in tight proximity (metrics beside the map they
describe); meta rows (avatar · name · time) horizontal, not stacked; long-form text in descending order below.
Don't make media full-width just because you can — "the scale feels overwhelming".

**UX-HIER-3 · Lead with what it is, not the metadata.** If a secondary attribute (date) commands attention, the
hierarchy is wrong: lead with the subject (the event), demote the date, use the freed space for context that
builds meaning; scale up the true focal element.

**UX-HIER-4 · White space groups; borders and containers don't.** Borders make "the eye see the border, not the
hierarchy". Containers used for layout create boxy UI and visual noise. Group with spacing; reserve **surfaces
for emphasis** only. *Check:* count boxes — every border/card must justify itself as emphasis or an interactive
affordance.

**UX-HIER-5 · One alignment anchor.** Stacked centered lines create many anchors and are hard to read → left
align. Mixed rows (some with icons, some without) break the anchor → make them consistent. Then use proximity to
pair related blocks (heading + image, price + CTA). *Check:* more than one left edge in a text column = finding.

**UX-HIER-6 · One focal image.** Two hero images compete → cognitive overload; keep one.

**UX-HIER-7 · Equal items get equal cells.** Tabs/segments on a grid with equal widths → consistent rhythm and
larger targets.

**UX-HIER-8 · Weight the action where reading ends.** Image/atmosphere → message → form/action at the bottom,
following natural reading flow.

**UX-HIER-9 · Luminance encodes role on layered surfaces.** Containers/navigation darker, actionable items lighter
than their container, input fields recessed (darker + inner shadow) so "type here" reads as a well, and edge scrims
where text must stay legible.

## 2. Decisions, actions & buttons

**UX-ACT-1 · One primary action.** Multiple competing actions distract; one CTA with a verb ("Buy tickets").
Hero: caption → title → primary + secondary CTA to reduce decision friction.

**UX-ACT-2 · Brand color is a signal — ration it.** Overusing the brand/primary color creates decision friction.
Use the default (brand) button with intention, add tertiary/neutral buttons, keep surfaces neutral so the brand
color stands out.

**UX-ACT-3 · If the brand is red, destructive is not red.** Keep red for the default button; destructive actions
become a secondary/neutral button so danger and "go" don't share a color.

**UX-ACT-4 · Buttons have a minimum width.** Hug-content buttons vary with label length → uneven, awkward UI. Set
a min-width (balance + target size); stretch to align buttons that sit together. Full-width the primary button in
narrow capture forms/modals.

**UX-ACT-5 · One control, one position, multiple states.** Two controls for one action (separate open and close
buttons in different places) confuse; one toggle that changes state.

**UX-ACT-7 · Tier every action, then cut and disclose.** Sort actions into primary / secondary / tertiary before
styling; "every action primary" kills hierarchy and makes users hunt for the main action. Too many buttons (six) →
keep ~four visible and move the rest behind a "More" (progressive disclosure). Styling by tier: one primary;
secondary = neutral filled; tertiary/More = neutral outline.

**UX-ACT-8 · Decoration must not look like an action.** Icons styled as small primary buttons (e.g. transaction
icons) read as clickable → replace with logos/neutral small icons.

**UX-ACT-6 · Visual anchors speed comparison.** In option lists, a recognizable icon/shape per option lets users
recognize shape before reading text and scan vertically → faster decisions. Contrast with UX-HIER-5: anchors must
be consistent (all rows or none).

## 3. Navigation & wayfinding

**UX-NAV-1 · Respect the tab-bar pattern.** No floating/overlapping FAB in the bar — it breaks nav hierarchy and
users' expectation; make it a regular tab (icon + label). Aligned icon/label, one icon set, one clear active state
(the place for brand color), title-case labels, content scrolls beneath the bar.

**UX-NAV-2 · One control center.** Don't split nav controls left and right; group them in one place for
learnability.

**UX-NAV-3 · Mobile menus are single-column, grouped lists.** No multi-column menus to save vertical space;
remove inconsistent icons, tighten gaps, group into labeled categories. "Boring" is fast to scan.

**UX-NAV-4 · Carousel indicators show content, not progress.** Dots are progress indicators (onboarding). For
exploration use a thumbnail bar for wayfinding; if dots are unavoidable, ≥ 8px.

## 4. Forms & inputs

**UX-FORM-1 · Labels persist; placeholders hint.** Never the placeholder as the label — once typing starts the
context is gone → errors spike, completion slows. Always a visible label.
*Narrow exception:* a single-field capture (e.g. a newsletter dialog) whose heading already supplies the context
may use an unambiguous in-field prompt ("Enter your email address") instead of a separate label.

**UX-FORM-2 · Placeholder = actionable example or direct instruction.** "Example: …" or "Enter your full name";
never abstract ("Type here"); never "e.g." (not understood across languages, gets typed in, screen readers stumble).

**UX-FORM-3 · Form spacing scale.**

| Relationship | Gap |
| --- | --- |
| Input → helper text | 4px |
| Header → caption · label → input · button → button | 8px |
| Input → input | 20px (room for helpers) |
| Between content groups · last input → primary button | 24px |

Never cramp the form against a container or the screen edge. Same spacing in dark mode.
*Generalization (the 4px rule):* tighten related items to the 4px grid.

**UX-FORM-4 · Pickers carry decision data.** Readable contrast and medium/semibold weights (no thin), roomy rows,
single-letter weekday headers, and contextual data in cells (price per day) so the decision happens in the picker.

## 5. Dialogs & destructive flows

**UX-DLG-1 · Confirmation modal anatomy.** Three blocks (title · body · actions), left aligned, close ×. Title names
the action ("Delete folder"), not "Are you sure?". No decorative question-mark icon. Body states the consequence
concisely ("can't be undone"). Two CTAs: specific verb ("Delete", sentence case) + "Cancel" (not "Discard").

**UX-DLG-2 · Capture modals sell the outcome.** Heading and caption say what the user gets (benefit), not what you
want ("Subscribe to our newsletter"); button states the benefit, no shouting; dismiss + privacy note present.

## 6. Microcopy

**UX-COPY-1 · CTA = precise verb (+ noun).** Abstract single verbs are weak ("Book" also reads as a noun) → "Reserve
room/table", consistent across flows.

**UX-COPY-2 · Never ALL CAPS in buttons, labels, tabs.** Not scannable, "feels like shouting". Title/sentence case.

**UX-COPY-3 · Outcome-oriented headings.** Write from the user's side: the benefit, not the task.

## 7. Data display

**UX-DATA-1 · Your UI isn't a spreadsheet.** Separate unrelated stat groups (profile vs performance) with tabs
instead of rows in one panel. Each metric = **label · value · helper**; prefer visual form (chart tabs) over bare
read-only numbers that users skip. Don't fix readability just by scaling numbers up.

## 8. Content & imagery

**UX-CONT-1 · Real, varied content.** Cloned placeholder cards "all look the same" and hide layout problems.

**UX-CONT-2 · Real-world metaphor for authenticity — last, after hierarchy.** (Ticket cut-outs only once
hierarchy is sorted.)

**UX-CONT-3 · Don't add content to fill space.** Empty space isn't a problem to solve with more content.

## 9. Accessibility & legibility

**UX-A11Y-1 · Text must pass contrast — on images too.** Failing heading → fix or drop; put a gradient scrim behind
text over imagery.
**UX-A11Y-2 · Bigger, consistent targets** via grids and min widths (UX-HIER-7, UX-ACT-4).
**UX-A11Y-3 · Screen-reader-friendly copy** (no "e.g."), labels always visible (UX-FORM-1/2).

## 10. Tokens, color & theming

**UX-TOK-1 · Two tiers: primitives → semantic aliases per mode.** Components consume only semantic tokens; the theme
switch is free.

**UX-TOK-2 · Semantic name = `color-[element]-[priority]-[state]`.** Elements: background, surface, border, text,
icon. Depth = surfaces layered on the background.

**UX-TOK-3 · Dark mode desaturation (70/60 rule).** Saturated colors pop too hard in dark mode: warm colors at ~70%,
cool colors at ~60% opacity/strength.

**UX-TOK-4 · Gradients in HSL, in steps.** Constant hue; four steps light source → hold → fall-off → anchor; a palette
varies only hue. Avoid two-step dark→light ("grey limbo").

## 11. Shape

**UX-SHAPE-1 · Nested radius: outer = inner + padding.** Same radius inside and outside leaves an awkward gap.

## 12. Iconography

**UX-ICON-1 · Use one established icon library; don't draw custom icons.** Consistency beats bespoke.

## 13. Motion

**UX-MOT-1 · Motion is hierarchy over time (rule of 3).** Each section has primary · secondary · tertiary attention
layers; reveal sequentially (≈ +0.2s stagger), primary usually the heading; custom easing. If everything appears at
once, nothing stands out.

**UX-MOT-2 · Pick the transition by what changes.**

| Transition | When | Examples |
| --- | --- | --- |
| Context | content changes, structure stays | tab switch, filters, state change |
| Drill | moving between IA levels | list→item, feed→post, summary→full |
| Continuity | shared elements persist and morph | card→full screen, mini→full player, grid→product |

**UX-MOT-3 · Choreograph overlays.** Separate fixed controls (simple fade) from the primary element (scale + fade);
make room (nav slides away so a sheet can rise); depth via blur; secondary element enters with a delay. A dissolve
is "good", motion hierarchy is "great".

**UX-MOT-4 · Ease-out for entrances/expansions; content trails its container.**

**UX-MOT-5 · Design motion while designing, not afterwards.**

---

## 14. Review checklist

Yes/no checks, cite the rule ID in findings. Severity suggestion: **B** = blocker, **W** = warning.

| ID | Check | Sev |
| --- | --- | --- |
| UX-HIER-1 | Every screen region maps to one named content group; no orphan elements | W |
| UX-HIER-3 | The most prominent element is the subject, not metadata (date, count, ID) | W |
| UX-HIER-4 | Borders/cards/containers are used only for emphasis or affordance, not for layout grouping | W |
| UX-HIER-5 | Text blocks share one alignment anchor; no stacked multi-line centered text | W |
| UX-HIER-6 | At most one focal hero image per view | W |
| UX-ACT-1 | Exactly one primary CTA per view/section | B |
| UX-ACT-2 | Brand/primary color appears only on the most important action/state | W |
| UX-ACT-7 | Actions are tiered (primary/secondary/tertiary); overflow behind "More" when > ~4 | W |
| UX-ACT-8 | No decorative icon is styled like a button | W |
| UX-HIER-9 | Interactive elements are distinguishable from their container by luminance; inputs read as recessed | W |
| UX-ACT-3 | Destructive and primary actions are visually distinct (not the same color) | B |
| UX-ACT-4 | Buttons have a min width; side-by-side buttons are equal/aligned | W |
| UX-ACT-5 | One action = one control in one position (toggle states, not two buttons) | W |
| UX-ACT-6 | Option lists use consistent visual anchors (all rows or none) | W |
| UX-NAV-1 | Tab bar: no overlapping FAB, aligned icon+label, one active state, title case | W |
| UX-NAV-2 | Navigation controls grouped in one place | W |
| UX-NAV-3 | Mobile menus single-column, grouped with labels | W |
| UX-NAV-4 | Carousels use thumbnails/peek, not progress dots (dots ≥ 8px if used) | W |
| UX-FORM-1 | Every input has a persistent visible label | B |
| UX-FORM-2 | Placeholders are examples/instructions; no "e.g.", no "Type here" | W |
| UX-FORM-3 | Form gaps follow 4/8/20/24 scale; form not cramped to edges | W |
| UX-DLG-1 | Confirm dialogs: action-named title, consequence body, verb CTA + Cancel, close ×, no "Are you sure?" | B |
| UX-COPY-1 | CTAs are precise verb (+ noun) | W |
| UX-COPY-2 | No ALL CAPS labels/buttons/tabs | W |
| UX-COPY-3 | Headings state user benefit/outcome | W |
| UX-DATA-1 | Metrics shown as label·value·helper, grouped, visualized where possible | W |
| UX-CONT-1 | Realistic, varied content (no cloned placeholders) | W |
| UX-A11Y-1 | Text over imagery passes contrast (scrim/gradient) | B |
| UX-TOK-1/2 | Components reference semantic tokens named by element/priority/state | W |
| UX-TOK-3 | Saturated accents are toned down in dark mode | W |
| UX-SHAPE-1 | Nested radii satisfy outer = inner + padding | W |
| UX-ICON-1 | One icon family throughout | W |
| UX-MOT-1 | Entrance motion reveals primary → secondary → tertiary, staggered | W |
| UX-MOT-2 | Transition type matches the change (context / drill / continuity) | W |
| — | Every component checked in both light and dark mode | W |


## 15. Precedence with a project design system

The project's design system (`<designRoot>/system/<ds>/SKILL.md` + `README.md`) binds, overrides or exempts any rule
here; a deliberate DS choice is never a finding. Accessibility rules stay hard regardless. Px values in this file are
intent — map them to the nearest DS token.
