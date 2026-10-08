# Implementation inventory — canvases 13 Design System · 14 Editing · 15 Annotations

Sources read: `.design/system/maude-v2/CONTRACT.md` (all), `.design/ui/v2/_kit.tsx` (header + Toolbar/CanvasesPanel/ShareCluster/ModeSwitch), the three `.tsx` canvases line-by-line + their `.meta.json`, `.ai/plans/notes/v2-feature-inventory.md` (§3 canvas/toolbar, §4 inspector, §5 whiteboard, §6 comments, §19 keys, flags, inconsistencies), `apps/studio/client/panels/StickerPicker.jsx`, `apps/studio/annotations-model.ts` (palettes, `STICKER_DROP_SIZE = 160`, element `tool` union), `apps/studio/stickers/*/manifest.json`.

Inventory refs use the inventory's legend: `C/` = apps/studio/client, `P/` = client/panels, `S/` = apps/studio (canvas side).
Classification: **EXISTS** (ref → where it moves) · **NEW** (not shipped, settled in the canvas) · **PROPOSED** (canvas or CONTRACT tags it "proposed", pending Michal).

---

## 13 Design System (`ds-*`, 25 artboards, 8 sections)

**Premise (CONTRACT §7, all PROPOSED):** a project's design system is ONE canvas called "Design system" in UI copy, pinned above every canvas. It has seven sections as artboards (Brand · Colour · Type · Space & shape · Motion · Components · Patterns). Every colour has a Light and a Dark value. Tokens and components are edited in place, and changes reach canvases after a review. For designers the canvas is the source. The files (tokens CSS/JSON, specimens) are generated from it and are the source for code. Today's `system/<ds>/` folder becomes its Advanced layer: "Nothing that exists today is deleted — it is one fold down."

### 1. Surfaces / components

**A. Entry points: where it lives** [ds-where-studio, ds-where-gator]
- **Pinned "Design system" row** at the top of the Canvases tab, above Recent and the project list. Kit: `CanvasesPanel system={name,meta,selected,ai}`.
  - The canvas draws it as TWO lines. Line 1: "Design system". Line 2: "`<system name>` · used by N projects", e.g. "Studio site system · used by 1 project", "Alligators brand system · used by 3 projects". In a linked project: "Alligators brand system · linked library".
  - The kit row is one line. Kit candidate: `system.sub`.
  - Optional AI spark while AI builds it.
  - Hidden while the panel search is active (`system && !search`).
- **Inspector link "Uses `<system name>` ›"** (ds-uses / ed-uses). It sits at the foot of the artboard inspector, on frames, text and instances. It opens the DS canvas on that token. Note 1: "opens it on that colour".
- **⌘K "design system"** results, three groups:
  - "Design system": the system row, meta "Design system · used by 3 projects · 7 sections".
  - "In the Design system" (aside: "colours, type and components by name"): colours ("Colour · brand · used in 88 canvases"), type styles ("Type style · 120–200"), components ("Component · used in 34 canvases"). Czech names must be findable.
  - "Actions": "Check the system" (where: "Design system › Advanced") and "Switch design system…" (where: "Design system row").
- Section subtitle: "The project menu gains nothing." There is NO DS entry in Menu (CONTRACT §1).

**B. The Design system canvas** [ds-board-studio, ds-board-dark, ds-board-gator]
- **Fixed section layout** at real size, in design px:
  - Brand 0,0 560×620
  - Colour 608,0 1000×620
  - Type 1656,0 600×620
  - Space & shape 0,700 680×560
  - Motion 728,700 440×560
  - Components 1216,700 1040×560
  - Patterns 0,1340 2256×440
- Sections are artboards: selectable, size tag when selected, AI working tag (`aiAt="corner"`), "Made by AI" mark.
- **Header (100 % close-up):**
  - Title: "Design system · Studio site system · used by Studio site".
  - Summary: "7 sections · 22 colours, each with a Light and a Dark value · 6 type styles · 6 components with their states · used by 5 canvases. Everything here is live — select a swatch, a style or a component and edit it in place."
  - Light | Dark seg, presence faces, zoom.
- **DsBar** (canvas header island while on the DS canvas), a kit candidate:
  - System glyph + name.
  - Light · Dark seg.
  - Optional view text ("22 colours in their dark values").
  - Pending edits: dot + "1 change waiting" + **Review…** (primary). Edits are batched, so "nothing opens a dialog mid-drag".
- **Brand section:**
  - "Logo · clear space" with clear-space markers, logo on 3 tiles (paper / ink / mark-only).
  - Studio: "Icons · line, 1.5 stroke, 16 grid" (10 icons).
  - Alligators: "Signs · 12 wordmark glyphs".
  - "Voice": one line, plus "**Say** X **not** Y".
  - "Rules for AI and code": tick list, caption "Written to SKILL.md — Claude Code and other agents follow them too."
- **Colour section:**
  - Legend: "Each swatch: **Light** | **Dark**".
  - Swatch = split chip (light half / dark half) + name in words + usage ("Used in N canvases" / "Not used yet").
  - Groups. Studio: Surfaces, Text, Accent, Status, Brand and illustration, Links and focus. Alligators: "Brand — locked, same in both" (lock glyph, title "Brand colour — locked"), Lines, "Surfaces — paper in Light, one green in five steps in Dark", Text, Status.
  - Swatch flags: "Changed outside" and "2 versions" (warn). Swatch states: `data-sel`, `data-presence` (another person's ring).
  - "Text on surfaces — contrast, Light | Dark": pair tiles "Aa" in each mode, ratios "15.1 | 16.2", warn suffix " — large text only in Dark".
- **Type section:**
  - Rows: name + "size · weight" meta + a real sample sentence. Selectable, with a presence ring.
  - Foot captions. Studio: "System sans for everything — SF Pro on Mac, Segoe on Windows. Same sizes in Light and Dark." Alligators: "Avenir Next Condensed for shouting, Gators for talking."
- **Space & shape section:**
  - Corners (XS…XL, Round ∞).
  - Spacing bars. Studio: 4 8 12 16 24 32 48 64. Alligators: 4 8 16 24 32 48 64 96.
  - Elevation. Studio: Flat/Resting/Floating/Sheet. Alligators: Flat/Soft/Lifted.
  - Layout grid. Studio: "12 columns · gutter 24 · max 1200" + breakpoints Desktop 1440 / Tablet 834 / Mobile 390. Alligators: "6 columns · margin 48" + formats Post 1080 × 1350 / Story 1080 × 1920 / Leták A5.
- **Motion section:**
  - Curve cards (curve drawn, name, ms, job). Studio: Quick 120 / Soft 160 / Panel 220 / Spring 420.
  - Foot: "Reduce motion on this Mac: every curve becomes an instant cut."
- **Components section:**
  - Master tiles: system glyph + name + usage.
  - The Button master spans 3 columns with a **Variants × States** grid (Default · Hover · Pressed · Focus · Disabled) + a Sizes row (Large/Medium/Small).
  - Other masters: Field (default/focus/error), Toggle, Service card, Price tile, Panel.
  - Alligators masters: Tlačítko (Plné/Obrys), Štítek, Výsledek, Zápas, Pole formuláře, Karta hráče.
- **Patterns section:** real screens built from the tokens. Each is a figure + caption "**Name** tokens/components used", e.g. "Homepage — hero · Display · Accent · Service card".
- **System Dark mode is the system's own mode, NOT the app theme.** The switch flips every section (swatches, components, Patterns) to dark values. The app chrome keeps its theme. User designs are pinned `.k-fixed` light, and the DS dark uses a section class `.ds-dark`.

**C. Editing a token** [ds-edit-colour]
- Select a swatch: the inspector shows "Accent" with chip "Colour".
  - Row "Editing": Light | Dark seg.
  - "Light": named colour ("Deeper azure"), plus a drawn picker (lightness/chroma square + hue rail).
  - "Dark": "Follows Light".
  - "Dark follows automatically" switch.
  - Live contrast line: "5.6:1 on white · 4.8:1 on the dark page".
  - Usage line: "Used in 5 canvases · was Azure" + **Show**.
  - Advanced count "OKLCH" → `light 0.50 0.190 255` / `dark 0.60 0.175 255` / `token --accent`.
- Presence: Tereza is on another token (Heading). Note 6: "nothing locks".
- Colour names are human words ("Azure", "Deeper azure", "Sea blue"). Implies naming of picked colours (AI or a colour-name table).

**D. Reach view, "Show"** [ds-edit-reach] (close-up 2400×1250)
- Token card: "Colour › Accent", L/D chip, "Azure › **Deeper azure**", contrast line, "Used in 5 canvases · showing" + **Hide**.
- Lines run from the swatch to Patterns and to every canvas artboard. Every Accent spot is ringed (`data-ring`).
- Count tags: "4 patterns · 21 places", "14 places", "11 places".
- Overflow line: "Onboarding, Mobile — detail and Landing page are in the review too".
- An inline review panel: "Update canvases with the new Accent?" + rows + Cancel / **Update 4 canvases**.

**E. "Update N canvases" review** [ds-edit-review, ds-edit-master]
- Dialog title: "Update canvases with the new Accent?". Primary "Update 4 canvases", secondary Cancel. Width 640.
- Before→after strip: "Azure › Deeper azure", ok badge "Fine in Light and Dark".
- Header tick (mixed) + "4 of 5 canvases in Studio site" + **Before | After** seg.
- Rows: tick · thumbnail of that canvas with Accent spots ringed · name · places sub-line, e.g.:
  - "14 places — buttons, links, cards"
  - "11 places — Tereza has it open"
  - "Left out — keeps Azure, gets an update dot"
- Fine print: "Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes. Tereza's open Pricing updates when she next looks at it."
- **Component master variant** [ds-edit-master]:
  - Title "Update canvases with the new Tlačítko?", primary "Update 28 canvases".
  - Strip shows old/new button, "Corners 2 → 6".
  - Header "28 of 34 canvases use Tlačítko" + "by folder".
  - Folder rows with ticks and counts. A left-out folder "2026/combine · 6 canvases · left out" expands to unticked canvas rows with thumbs; one is annotated "at the printer".
  - Fine print: "Left-out canvases keep 2 px corners and show an update dot. Cancel puts the master back — nothing changes."

**F. A left-out canvas, "update available"** [ds-edit-instance]
- A small update dot on the instance on the canvas (`ds-upd`).
- Instance inspector:
  - "Tlačítko" chip "Component", Uses link, Text field.
  - Block: "● Update available" / "Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update." / **Update** (primary) · **Detach** (ghost).
  - Advanced count "Instance of Tlačítko".
- Note 10: "A quiet dot, not a nag … A new one placed with Component (⇧I) arrives current."

**G. Source of truth: outside change and conflict** [ds-truth-outside, ds-truth-conflict]
- **Outside change**, inspector titled "2 tokens changed outside the app":
  - Source line: "**colors_and_type.css** was edited by Claude Code, 4 min ago".
  - Per-token rows with before→after: "Quiet · Text · Light value darker · 4.9 → 5.6:1 on Well"; "Corner M · 10 → 12 px · cards, fields, panels".
  - Fine: "Keep makes them part of the system. Canvases then follow after the usual review."
  - Actions **Undo** · **Keep** (primary). Undo writes the old values back to the file.
  - On-canvas swatches marked "Changed outside" until reviewed. Corner M is marked as well.
- **Conflict**, inspector "Accent changed in two places":
  - Warn line "Pick one. Until then canvases keep **Azure**."
  - Two cards. "On this canvas · Deeper azure · You · 10 min ago · Use this". "In colors_and_type.css · Sea blue · Jonas · git pull, 2 min ago · Use this".
  - Fine: "Both stay on the swatch, marked “2 versions”. The one you don't pick stays in Version history."
  - The file is rewritten with the pick.

**H. Making a design system with AI** [ds-make-inputs → ds-make-done]
- **Entry:** a Home starter "A design system · for Studio site", or the pinned row of a project without one ("Make a design system"). That empty-row state is NOT drawn.
- **Dialog "Make a design system for Studio site"** (custom `k-dialog ds-make`):
  1. "Say what the brand is, in a sentence" (textarea; the only required input).
  2. "Anything to learn from? *Optional*" source tiles: Logo (file, ticked "studio-logo.png") · Website ("Paste a link") · Figma library ("Connect") · Your canvases ("5 in Studio site", ticked).
  3. "Mostly for" seg: Websites · Apps · Print and social · A bit of everything.
  - Fine: "✦ AI puts three directions on a new Design system canvas, each in Light and Dark. Your canvases don't change until you choose."
  - Buttons Cancel / **✦ Make three directions** (azure, spark glyph).
- **Three directions** [ds-make-directions]:
  - Artboards "Direction A · Calm daylight", "B · Warm paper", "C · Night shift". Each tile: palette strip, hero sentence, buttons, picture, cards, meta (mood + "why", e.g. "From your logo's coral dot.").
  - Shown in **Preview** (annotate toolbar), so they can be marked up.
  - AI message: "Three directions are on the Design system canvas — read from your sentence, the logo and 5 canvases. Figma wasn't connected, so no library was used."
  - Inline AI question: "One question first: is Studio site mostly for people or for companies? …" → **Mostly people** / Mostly companies.
- **Pick or mix** [ds-make-mix]:
  - Selected direction gets size tag "Picked"; the others dim.
  - Floating pick bar under it: **Use A** · **Mix with… ⌄**.
  - Menu groups "From B · Warm paper" (B's type — serif headlines, B's colours) and "From C · Night shift" (C's colours, C's rounder corners).
  - AI chips "Use A as it is", "A with B's serif". Chat works too.
- **Filling in** [ds-make-filling]:
  - Sections land one by one. Done ones show "Made by AI"; the current one shows the AI working tag "AI is setting the type" + cursor; pending ones are dashed ghosts "✦ Type — next".
  - AI panel working + step "Brand and Colour done · 5 sections to go".
  - Finished sections are editable already. "Stop it any time" means Stop in the AI chat.
- **Done** [ds-make-done]:
  - Patterns has an empty slot "✦ Onboarding needs real copy" / caption "Onboarding waiting for copy".
  - AI: "Done — seven sections are on the Design system canvas. Two things are partial: … the logo is a 120 px PNG — an SVG keeps it sharp." Chips "Draw Onboarding with sample copy", "Check the system".
  - Top banner island: "Studio site system is ready." sub "Studio site's 5 canvases update after a review." action **Use as Studio site's style**.

**I. Many systems** [ds-many-switch, ds-many-library, ds-many-linked]
- **Row menu** (from the pinned row; how it opens is unspecified):
  - Group "Design systems": Studio site system ✓ "in use" · Warm paper "draft · previewing" · Alligators brand system (people icon) "team library".
  - Then: "Open the Design system ↵" · "Make a design system…" · "Link a team library…".
- **Whole-project preview**: ↑↓ previews each system in every canvas, ↵ switches, esc steps back. Banner "Previewing Studio site in Warm paper." sub "5 canvases shown in it · esc to stop" action **Switch to Warm paper**.
- **Drafts**: direction B is "kept as a draft on the same Design system canvas".
- **Team library on cloud.maude.sh** (close-up):
  - Library card: GatorMark, "Alligators brand system", "Team library · alligators.cloud.maude.sh".
  - "Used by 3 projects" rows with project avatar + status: "Where it's edited" / "3 updates waiting" (warn) / "Up to date".
  - "Can edit the library": faces + "You and Tereza · others use it".
  - Buttons "Open the Design system" · **Share…**.
- **Library update review** (in the linking project):
  - "Update from Alligators brand system? 3 changes". Rows: "Tlačítko corners 2 → 6 · 8 canvases here"; "Linka — jemná moved to the trash · uses switch to Linka — střední"; "New · Výhra added to Status".
  - Fine: "By Tereza, yesterday. The next step lists every canvas here with a tick. Updating keeps a version — Version history can restore it."
  - Cancel / **Update**. It is two steps: changes first, then the canvas tick list.
- **Linked project** [ds-many-linked]:
  - Pinned row "Design system / Alligators brand system · linked library".
  - The canvas is view only. ShareCluster `mode="viewing" canEdit={false} access="Can view"`.
  - Banner "Linked from Alligators brand." sub "View only here — every update arrives as a review." action **Open in Alligators brand**.

**J. Edge cases** [ds-edge-*]
- **Contrast break** [ds-edge-contrast]:
  - Inspector "Terciární" Colour, Editing = Dark, Dark "Šedozelená", Light "Unchanged", Role "Text on green — hints".
  - Warn line "3.1:1 on Pole and Hover" + action **Lighten to 4.5:1** (one-step fix).
  - Quiet line "Falls short in 3 canvases" + **Show**. Never blocks.
- **Token to trash** [ds-edge-trash]:
  - Dialog "Move “Linka — jemná” to the trash?" → **Move to trash** / Cancel.
  - Body: "40 canvases use it. They switch to **Linka — střední**, the closest line colour, so nothing breaks." + swatch arrow + fine "Restore from the Trash puts it back in all 40."
- **Off-system colour** [ds-edge-suggest]:
  - Badge inspector: Fill "Blue" + "off-system" tag. Uses link.
  - AI panel (chat "Pricing", scope "Badge") asks with no messages, question only: "The blue on “Save two months” was picked by hand and isn't in Studio site system. The closest is **Accent**." → **Use Accent** / Add it to the system.
  - Proactive AI detection. Trigger is unspecified.
- **Migration of old folder** [ds-edge-migrate]:
  - Dialog "Convert system/alligators into the Design system canvas?" → **Convert**.
  - Body "42 specimen pages fold into 7 sections. The files stay exactly where they are."
  - Mapping table (section · source pages · count): Brand 6 · Colour 7 · Type 2 · Space & shape 5 · Motion 1 · Components 18 · Patterns 1 · "Own artboards — desktop showcase · desktop index — kept as they are" 2.
  - Fine "Version history keeps the folder view — Restore undoes the conversion."
  - Note: "files keep working for code, agents and Tereza's older Maude. Other system folders become their own Design system canvases (24); only one that no canvas uses becomes a draft." (amended 2026-10-08, A12)
- **Several systems in one project** [ds-multi-panel, ds-multi-switch, ds-multi-menu, ds-multi-migrate] (added 2026-10-08, A12): pinned "Design systems" group (Alligators brand system · Default · 87 canvases / Combine 2026 · 6 canvases · 2026/combine / Alligators 2023 · Draft · no canvas uses it); inspector "Uses Combine 2026 ›" + line "This canvas uses Combine 2026, like the rest of 2026/combine."; dialog "Switch canvases to Alligators brand system?" with Scope seg (This canvas · Folder · 2026/combine · Whole project), tick list "5 of 6 canvases in 2026/combine", left-out row "Left out — keeps Combine 2026", fine print on name matching + off-system leftovers, primary "Switch 5 canvases", preview banner "Previewing 2026/combine in Alligators brand system." · "6 canvases shown in it · esc to stop"; systems menu: Design systems group (✓ default · 87 canvases / 6 canvases / draft), Open Combine 2026 ↵, Use for new canvases, Switch canvases to another system…, Make a design system…, Link a team library…; rule: new canvas ⌘N uses the default, inside a folder whose canvases share a system it uses that one; migration dialog "Convert 3 system folders into Design system canvases?" → two Design system canvases + one Draft, primary "Convert".

**K. Advanced** [ds-advanced] (nothing selected on the DS canvas → inspector shows the system)
- Header "Studio site system" chip "Design system".
- Rows: Used by "Studio site · 5 canvases" · Modes "Light · Dark" · Check: button "Check the system".
- Advanced (count "Tokens · files"):
  - **CSS | JSON** seg + code block (`:root{…}` + `[data-theme="dark"]{…}`, elided "… /* 94 more */").
  - "Files" tree: `system/studio-site/`, then `colors_and_type.css · tokens.json`, `README.md · SKILL.md · CONTRACT.md` *voice, rules*, `preview/` *38 specimen pages*, `assets/` *logo, icons, fonts*.
  - Actions: **Hand off tokens ⇧⌘H** · Reveal in Finder.
- "Which way changes flow" island, 3 rows (canvas writes files · files are what code/agents read · outside change → review Keep/Undo; clash keeps both).
- **System Version history** "— Studio site system ⌥⌘H". Rows by You / Claude Code (file glyph) / AI, with relative and absolute times. **Restore…**.
- **Check the system** "ran 1 min ago":
  - Contrast "41 of 42 text pairs pass 4.5:1, Light and Dark".
  - Warn "Quiet on Well · Dark: 4.2:1 — large text only" + Show.
  - Complete "7 sections, both modes, reduced motion".
  - Mono: "critic panel: a11y · completeness · keeper".

### 2. User flows

1. **Open the DS.** Click the pinned row, or ⌘K "design system", or the inspector "Uses X ›" (opens focused on that token) → the DS canvas, Edit mode. ProjectPill canvas = "Design system".
2. **Edit a colour.**
   1. Select the swatch. The inspector opens with Editing = Light.
   2. Drag the picker. Contrast re-checks live in both modes. Dark follows if the switch is on.
   3. The DsBar shows "1 change waiting".
   4. Optional: Show → reach view.
   5. Review… → dialog → untick canvases → **Update N canvases**.
   6. Ticked canvases re-render. Unticked ones get the update dot. ⌘Z after Update reverts all N.
   7. Cancel puts the swatch back.
3. **Edit a component master.** Select the master tile → edit (e.g. corners) → Review → the folder-level tick list (untick a folder; expand it to see its canvases) → Update.
4. **Pick up a left-out update.** On a canvas with the dot, select the instance → "Update available" block → Update (adopt) or Detach (becomes a plain frame).
5. **Outside change.**
   1. The file watcher sees `colors_and_type.css` change (Claude Code, git pull, agent).
   2. Changed tokens show the new values on the canvas, flagged "Changed outside".
   3. The inspector review lists them.
   4. **Keep** accepts; canvases then follow via the normal "Update N canvases" review. **Undo** rewrites the file with the old values.
6. **Conflict.** The canvas edit and the file edit touch the same token → swatch "2 versions" → pick "Use this" on one → the file is rewritten. The loser goes to Version history. Canvases keep the old value until the pick.
7. **Make with AI.** Starter → 3-input dialog → Make three directions → AI asks one question → answer → Use A / Mix with… → the build streams section by section (stoppable) → partial results stated → **Use as `<project>`'s style** → the canvas review.
8. **Switch systems.** Row menu → arrow over a system = live preview of every canvas in it + banner → ↵ / "Switch to X" → (presumably) the update review. esc → back.
9. **Share as a team library.** Library card → Share… (cloud) → another project uses "Link a team library…" → its row becomes "linked library", view only → each library update = "Update from X? N changes" → per-canvas tick list.
10. **Trash a token.** Select → ⌫ / menu → dialog → Move to trash → usages switch to the nearest token → Restore from Trash re-applies everywhere.
11. **Migrate.** Open a project with an old `system/<ds>/` folder → dialog → Convert → the 7-section canvas is built. Files untouched; Version history can undo.
- Edge flows: a contrast warning fixed with "Lighten to 4.5:1" · an off-system colour question · a library update arriving while some canvases are open (Tereza's open Pricing "updates when she next looks at it").

### 3. Key copy (verbatim)
- "Design system" · "Uses Studio site system" · "Studio site system · used by 1 project" · "… · linked library"
- "Each swatch: Light | Dark" · "Used in 5 canvases" · "Not used yet" · "Changed outside" · "2 versions" · "Brand colour — locked"
- "Text on surfaces — contrast, Light | Dark" · " — large text only in Dark"
- "Rules for AI and code" · "Written to SKILL.md — Claude Code and other agents follow them too."
- "Reduce motion on this Mac: every curve becomes an instant cut."
- "1 change waiting" · "Review…" · "Dark follows automatically" · "Follows Light" · "5.6:1 on white · 4.8:1 on the dark page" · "Used in 5 canvases · was Azure" (Show) · "Used in 5 canvases · showing" (Hide)
- "Update canvases with the new Accent?" · "Update 4 canvases" · "Fine in Light and Dark" · "4 of 5 canvases in Studio site" · "Before" / "After" · "Left out — keeps Azure, gets an update dot"
- "Unticked canvases keep the old Accent and show an update dot. Cancel puts the swatch back — nothing changes. Tereza's open Pricing updates when she next looks at it."
- "28 of 34 canvases use Tlačítko" · "by folder" · "6 canvases · left out" · "at the printer"
- "Update available" · "Corners 2 → 6, by You, 10 min ago. 2026/combine was left out of that update." · Update · Detach
- "2 tokens changed outside the app" · "colors_and_type.css was edited by Claude Code, 4 min ago" · "Keep makes them part of the system. Canvases then follow after the usual review." · Undo · Keep
- "Accent changed in two places" · "Pick one. Until then canvases keep Azure." · "On this canvas" · "In colors_and_type.css" · "Jonas · git pull, 2 min ago" · "Use this" · "Both stay on the swatch, marked “2 versions”. The one you don't pick stays in Version history."
- "Make a design system for Studio site" · "Say what the brand is, in a sentence" · "Anything to learn from? Optional" · "Paste a link" · "Connect" · "Mostly for" · "AI puts three directions on a new Design system canvas, each in Light and Dark. Your canvases don't change until you choose." · "Make three directions"
- "Use A" · "Mix with…" · "AI is setting the type" · "Brand and Colour done · 5 sections to go" · "Onboarding needs real copy" · "Studio site system is ready." · "Use as Studio site's style" · "Studio site's 5 canvases update after a review."
- "Previewing Studio site in Warm paper." · "5 canvases shown in it · esc to stop" · "Switch to Warm paper" · "draft · previewing" · "team library" · "Open the Design system" · "Make a design system…" · "Link a team library…"
- "Team library · alligators.cloud.maude.sh" · "Used by 3 projects" · "Where it's edited" · "3 updates waiting" · "Up to date" · "Can edit the library" · "You and Tereza · others use it"
- "Update from Alligators brand system? 3 changes" · "By Tereza, yesterday. The next step lists every canvas here with a tick. Updating keeps a version — Version history can restore it."
- "Linked from Alligators brand." · "View only here — every update arrives as a review." · "Open in Alligators brand"
- "3.1:1 on Pole and Hover" · "Lighten to 4.5:1" · "Falls short in 3 canvases"
- "Move “Linka — jemná” to the trash?" · "40 canvases use it. They switch to Linka — střední, the closest line colour, so nothing breaks." · "Restore from the Trash puts it back in all 40."
- "off-system" · "Use Accent" · "Add it to the system"
- "Convert system/alligators into the Design system canvas?" · "42 specimen pages fold into 7 sections. The files stay exactly where they are." · "Version history keeps the folder view — Restore undoes the conversion."
- "Hand off tokens" · "Reveal in Finder" · "Which way changes flow" · "Check the system" · "ran 1 min ago" · "41 of 42 text pairs pass 4.5:1, Light and Dark"

### 4. Keys & menu paths
- ⌘K: "design system", every token, style and component by name, "Check the system", "Switch design system…".
- Row menu: ↑↓ preview a system across the project · ↵ switch · esc stop previewing.
- ⇧⌘H "Hand off tokens" (= Menu › File › Handoff to production). ⌥⌘H Version history (the system's own).
- ⇧I places a component that "arrives current". ⌘Z after Update reverts every updated canvas (one step).
- No Menu entry for the DS (deliberate).

### 5. Classification
- **EXISTS → moves:**
  - DS view `SystemView` (C/app.jsx:5115; S key, DS row, palette; DS picker select, raw `systemDir`, token ladders, preview/UI-kit galleries) → replaced by the DS canvas. The S key is gone (S = Section in v2). Raw path → Advanced files tree. The DS picker → the row menu "Design systems".
  - `/design:setup-ds` wizard + ux-research directions + moodboard Stage 3 → "Make a design system" dialog + 3 direction artboards.
  - Critic panel (a11y / completeness critic / design-system-keeper) → "Check the system".
  - Token popover + ColorPicker (C/app.jsx:6315, 6129) → swatch inspector + picker.
  - Edit-scope strip "Shared · N places" + Detach (C/app.jsx:9779) → instance "Update available / Detach" + "Used in N canvases".
  - Handoff (⇧⌘H) → "Hand off tokens".
  - Version history → system history.
  - Multi-DS per project (DS picker) → "Design systems" menu.
  - `/design:import-brand` / Figma import → "Figma library · Connect".
- **NEW:** pinned row, Uses link, DS canvas with 7 sections, Light|Dark per token, DsBar pending batch, reach view, per-canvas tick review, update dot, outside-change review, conflict pick, AI 3-input make flow, pick/mix bar, section streaming, project-wide preview in another system, contrast warn + one-click fix, token trash with nearest replacement, off-system colour question, folder → canvas migration, CSS|JSON token view, Check-the-system summary.
- **PROPOSED:** the entire DS-as-canvas model, source-of-truth rules, team library on cloud.maude.sh + linked read-only projects (CONTRACT §7 marks both "proposed").

### 6. Backend / native / canvas-lib / file-format needs
- **DS canvas storage.** Decide where the canvas lives: under `system/<ds>/`, or a designated canvas flagged `system: true` in `.meta.json`. Decide how the canvas tree pins it and how it is excluded from "N canvases" counts.
- **Token model.** id, display name (any language, accent-insensitive search), group/role, Light + Dark value (OKLCH), "dark follows light" flag + derivation rule, locked flag (brand), type/space/radius/elevation/motion tokens. `tokens.json` schema needed (unspecified; DTCG?).
- **Generator canvas → files:** `colors_and_type.css` (`:root` + `[data-theme="dark"]`), `tokens.json`, SKILL.md rules from the Brand section, README/CONTRACT. Deterministic output, so outside-change diffing works.
- **Outside-change detection.** Watch the token files and keep a base snapshot (last app-written state, e.g. `_state/ds-<id>.base.json`, which is runtime state, so update the DDR-115 four lists). Diff by token; 3-way merge (base / canvas / file). Clash = both kept and flagged.
  - Author attribution: "Claude Code", "Jonas · git pull". Needs a git log / hub sync identity / ACP session marker.
  - Undo = write old values; Keep = accept.
- **Usage index.** Which canvases (and how many "places") use each token or master: scan canvas TSX for `var(--token)` and component imports. Feeds "Used in N canvases", "14 places", the reach rings, the review rows and thumbnails with rings.
- **Per-canvas version pinning.** Each canvas (or instance) records the DS revision it follows, which enables partial updates + the "update available" dot + "Update" later. Today a token change hits every canvas at once via CSS, so partial adoption needs per-canvas token snapshots or override layers. **This is the biggest architectural ask.**
- **Atomic multi-canvas update** as one undo step + one Version history entry. Open-by-others canvases update "when she next looks" (sync/hub notification).
- **Component masters registry** (variants × states × sizes) + instance links in canvases + overrides (ties into 14 instance inspector) + Detach.
- **Contrast engine.** WCAG ratios per text/surface pair in both modes, live while dragging; "Lighten to 4.5:1" solver; "Falls short in N canvases" scan.
- **Nearest-token resolver** (ΔE in OKLCH) for trash replacement and off-system suggestion. Restore from Trash re-points usages (the trash must store the usage map).
- **Project-wide preview.** Inject an alternate token stylesheet into every canvas iframe without writing files. Drafts = alternate token sets on the same DS canvas.
- **AI build pipeline.** Directions as artboards (Light + Dark), inputs (logo file, URL fetch, Figma library via the import path, existing canvases), a streaming section build with per-section "made"/"ai"/"ghost" state, a partial-result report, assigning the DS to the project.
- **Migration converter.** Map 42 preview pages → 7 sections (+ showcases as own artboards). The mapping table must be data-driven. Files stay.
- **Team library (hub/cloud).** Publish a DS to `<team>.cloud.maude.sh`; link from other projects (read-only replica); change feed (changed / trashed-with-replacement / added); per-project status; edit permission list.
- **Search index** entries for tokens, type styles and components (⌘K).
- **Version history** scoped to the DS (author kinds You / Claude Code / AI).
- **Critic panel** invoked headless for "Check the system", with a summarised result + run time.
- **Off-system colour detection** hook (when a raw colour is set in the inspector or found in JSX) → AI panel question.

### 7. Dependencies
- 11 Projects and Navigation (CanvasesPanel, pinned row, ⌘K), 03 AI Chat (AIPanel `question`, working tags, Stop), 04 Modes (Preview for direction markup), 10 Share and Collaboration (presence, access words, cloud), 12 Import and Assets (Figma library, logo upload), 09 Export / Handoff (⇧⌘H), Version history + Trash (shared), **14 Editing** (token chips, instance inspector, Uses link, ⇧I picker).

---

## 14 Editing (`ed-*`, 26 artboards, 9 sections)

**Scope:** artboards + objects inside them + the inspector. The toolbar is the kit **Edit toolbar** everywhere: Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I · More (Line · Ellipse · Polygon · Crop · Export area). Every ShareCluster is `mode="edit"`.

**Today → v2 mapping** (from the header; "nothing deleted"):
- ⌘-click / ⌘⇧-click selection → plain click + ⇧-click; double-click enters a frame.
- dc-snap-guide + distance pills → smart guides + spacing chips in a **guide colour**: magenta `oklch(0.55 0.20 328)`, never selection azure (DDR-046). New token `--guide`.
- Artboard hug height → Height "Fits content".
- Inspector Layout Row/Column, Hug/Fixed, Space between, Start/Center/End/Stretch → a Layout section with token chips.
- "Convert to absolute" → Layout › Advanced › "Convert layout to absolute".
- Raw CSS / Copy CSS → Advanced at the inspector foot.
- Purple instance rows + Detach → Instance inspector (Go to Tlačítko · Detach).
- Layers tree (Hidden/Visible, locked) → the Layers tab, synced with the canvas.
- Bring forward / Send backward → the object menu.

**Names rule:** every token chip, menu row and variant uses 13's names (Studio: corners XS 4 … XL 20 · Round; "Space 24" → `var(--space-24)`; elevation Flat/Resting/Floating/Sheet; Alligators: Flat/Soft/Lifted, Tlačítko Plné/Obrys).

**Kinds:** a button is kind "Button" with a Border row + Interaction section. Border on boxes; **Stroke** only on lines and Pen paths. Corners is its own section.

### 1. Surfaces / components

**A. Artboards** [ed-ab-*]
- **Select** [ed-ab-select]:
  - Click the name or an edge. The name turns azure with a size tag "1440 × 1573". **8 handles** (kit Artboard draws 4 corners; add 4 mid-edge handles = kit candidate). Resize cursor on the edge.
  - Artboard inspector, kind chip "Web page", advCount "6 properties":
    - Artboard: Preset "Desktop · 1440", Size W/H, Height seg **Fits content | Fixed**, Clip content switch.
    - Fill: Background token "Page".
    - Layout: Content "Top to bottom".
    - Export (+): PNG "2×".
    - "Other widths": **Add a width**.
- **Resize** [ed-ab-resize]:
  - Dragging an edge snaps to presets on a **preset ruler** above the artboard (Tablet 834 · Laptop 1280 · Desktop 1440). The lit preset follows the pointer.
  - Original outline stays as a ghost. Magenta guide at the edge.
  - Accent bubble "Laptop · 1280 × 1573". Hint "⌘ ignores presets · ⌥ from the centre".
  - The page reflows live; height keeps fitting content.
  - Inspector line "Drag the bottom edge to fix the height at a number." (dragging the bottom edge switches to Fixed).
- **Move with smart guides** [ed-ab-arrange]:
  - Dragged artboard gets a lifted shadow. Top-edge guide (+ soft bottom guide). **Equal-gap chips** ("80" ×3, magenta).
  - Dark bubble "X 3480 · Y 0".
  - Inspector kind "Fixed size": Preset "Post 1:1 · 1080", Position X/Y (focused), Size, Fill token "Klubová zelená 100 %".
- **Multi-select artboards** [ed-ab-tidy]:
  - Marquee or ⇧-click. Thin rings on each + one parent box with 8 handles.
  - **Align bar** island over the selection: count "4 artboards" · align L / H-centre / R / T / V-middle / B · distribute H / V · **Tidy up** button.
  - Tooltip "One row, even gaps". Dashed outlines preview the tidy result on the lowest one's line.
  - Inspector "4 artboards": Preset, Size, Position "Mixed", Fill mixed swatches "Mixed", Export "4 files · 2×", line "Changes go to all 4."
- **Artboard context menu** [ed-ab-menu]:
  - "Ask AI about “Desktop”" ⌘/ · Duplicate ⌘D · **Duplicate at another width ▸** (Laptop 1280 · Tablet 834 · Mobile 390 · Custom width…) · Rename · Copy ⌘C · Paste ⌘V · Export… ⇧⌘E · Move to trash ⌫.
- **⌘D**: the copy lands to the right at the gap the row already uses, selected ("Desktop 2"). Pressing again keeps the rhythm. ⌥+drag duplicates.
- **Rename in place**: double-click the name → a field that grows to the full name (háčky kept; the label truncates on canvas, never in the field). ↵ saves · esc cancels · **tab moves to the next artboard's name**.

**B. Objects** [ed-obj-*]
- **Enter frames** [ed-obj-enter]:
  - Click selects the top object; double-click goes inside. The frame you are inside shows a **dashed parent outline**. Hover outline on siblings.
  - Selection tag "Brand systems · 400 × 232".
  - **Breadcrumb in the inspector** "Desktop › Services › Brand systems" + esc kbd. esc steps out one level.
  - Layers tab mirrors the selection.
  - Inspector (Frame):
    - Position: "In Services: Set by Services · 2 of 3"; **Place freely** switch (off); line "In auto layout, ← → move it earlier or later."
    - Size: W 400 Fill, H 232 Hug.
    - Layout: direction icon seg (row / column / grid / free), Gap "Space 8", Padding "Space 24".
    - Fill "Leaf 30 %". Corners "L 14".
    - Uses link.
- **Multi-select objects** [ed-obj-multi]:
  - ⇧-click. Shared values, "Mixed" where they differ. Fill mixed swatches. Opacity.
  - Align bar without Tidy ("3 objects"), "Align left" tooltip, magenta guide + chip "X 64".
  - **Rotate handle** just outside a corner + hint "Rotate · ⇧ 15°". Rotation row.
  - Line "Changes go to all 3. Text settings show when only text is selected."
- **Nudge / frame / order / lock / hide** [ed-obj-order]:
  - Nudge: ↓ 1 px · ⇧↓ 10 px · ⌥ shows distances. The selection tag shows "Y 434" + a 10 px gap chip.
  - **Frame selection ⌥⌘G (or ⌘G)**: wraps 3 objects into "Frame · stacked ↓" (auto layout column by default). Mini layer lists before/after.
  - **Object context menu**: "Ask AI about “Book a call”" ⌘/ · Cut ⌘X · Copy ⌘C · Paste ⌘V · Duplicate ⌘D · Copy properties ⌥⌘C · Paste properties ⌥⌘V · Select matching ("same style") · Frame selection ⌥⌘G · Remove frame ⇧⌘G (disabled when n/a) · Bring to front ⌘] · Bring forward ] · Send backward [ · Send to back ⌘[ · Lock ⇧⌘L · Hide (no key) · Advanced ▸ ("Copy CSS · element id") · Remove ⌫.
  - **Locked object**: a lock badge with its name on canvas; clicking it selects the parent (hover outline on the locked one); tooltip "Logo is locked · ⇧⌘L unlocks".
  - **Layers hover tools**: pointing at a row reveals lock + eye at its end. Hidden rows are greyed. Copy: "A hidden object stays in the file and in Layers, greyed. It never exports." "Selecting a row selects it on the canvas, and the other way round."

**C. Layout** [ed-lay-*]
- **Auto layout** [ed-lay-auto]:
  - Padding and gap bands tinted in the guide colour, with value chips. The hot band is the one being dragged.
  - Selection tag "Services → Auto layout".
  - **Token ruler** over a dragged gap: the system's space stops (12 · 16 · 24 · 32 · 48), the lit stop under the pointer. Hint "⌘ any number · ⌥ every gap at once".
  - Gap dropdown menu: group "Gap · Space in Studio site system" → Space 4 … Space 64 (✓ Space 24) · "Auto" note "space between" · "A number, no token…".
  - Inspector (Frame, crumbs Desktop › Services):
    - Layout section aside "Auto": Direction, Gap (token, focused), Padding (token + per-side toggle), Align (3×3 pad).
    - Size: W Fill, H Hug.
    - Line "3 cards, each Fills the width."
    - Advanced open: **Convert layout to absolute** + note "Each card keeps where it is now; the frame stops arranging them. ⌘Z brings the layout back." + CSS rows (`display flex`, `gap var(--space-24)`, `padding var(--space-24)`).
- **Drag to reorder, signature** [ed-lay-reorder]:
  - The card lifts and follows the pointer 1:1. Tag "Small apps · moves to 1 of 3". Neighbours slide. An empty **numbered slot** opens with gaps measured; motion trails.
  - Hints: "Let go — it moves here" · "esc puts it back" · "⌥ while dragging — a copy" · "Drag out of the frame — place it freely".
  - Filmstrip 0 / 40 / 90 / 150 / 220 ms on `--dur-panel` 220 ms `--ease-out`. Reduce motion: neighbours jump, the slot fades in.
  - Layers shows the same slot; rows are draggable there with the same rules.
- **Free placement + constraints** [ed-lay-free]:
  - Datum pinned **Right · Top** keeps 64 from the corner on the Post and on its 9:16 copy (soft gap chips).
  - Inspector: Position X/Y, Rotation, "Constraints" sub-header + **constraint widget** (box with 4 edge pins) + Right/Top selects.
  - Line "Post places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner; its yellow is Podklad, the shape inside."
  - Fill (+) dim "None".

**D. Text** [ed-text-*]
- **Edit in place** [ed-text-edit]:
  - Double-click → a caret in the canvas text, with an edit-tone ring; selection highlight (`mark`).
  - Inspector Text (crumbs, Uses):
    - Style "Aa Plakát ⌄". Font select. Size · weight. Line · letter. Align seg (L / C / R / Justify).
    - **Resizing** Width | Height | Fixed. **Case** As typed | AA. **Language** select "Čeština".
    - Line "Čeština: one-letter words stay with the next word (the ties under “v” and “s”), „quotes“ turn Czech."
    - Fill Colour token "Bílá".
  - Czech ties: one-letter words (v k s z o u i a) glued to the next word with NBSP; tie arcs drawn while editing.
- **Style states** [ed-text-style], three panes:
  - (1) Follows Plakát: "from Plakát" labels; line "Change Plakát in the Design system and this follows."
  - (2) One thing changed: **dot** on the row label (title "Changed here"); "Size differs from Plakát." + **Reset**; quiet link "Update Plakát for every canvas…".
  - (3) Detached: style "No style"; no Uses link; line "Keeps its look; stops following Plakát. Nothing else changes." + **Use a style**.

**E. Shapes and Pen** [ed-shape, ed-pen]
- **Shape**:
  - On-canvas **corner-radius dots** inside each corner (the lit one is being dragged) + value chip "8". Selection tag "Podklad · 216 × 216". Toolbar Shape pressed with **More popover open**.
  - Inspector Shape: Kind "Rectangle", W·H.
  - Corners with **unlink** toggle → 4 fields ↖ ↗ ↙ ↘.
  - Fill (+) token. Border (+) token + width + Position Inside / Centre / Outside.
  - Effects (+) Shadow seg from DS elevation (Flat / Soft / Lifted).
- **Pen** (close-up):
  - Editing an existing path: point squares, the selected point, handles; the previous curve drawn dashed; chips "Smooth" / "Sharp".
  - Drawing new: a rubber-band segment, a 45° chip, a close target "Click here to close".
  - Hints: "Click — a sharp point" · "Drag — a smooth one" · "⇧ 45° steps" · "↵ or esc — finish, open".
  - Inspector "Path" chip "Pen · 4 points":
    - Point: Corner seg smooth/sharp, X/Y.
    - Stroke token + width 28 + Ends Round / Flat.
    - **Combine shapes** (union / subtract / intersect / exclude), disabled for one ("Two or more").
    - Key list: Click add · Drag bend · ⌥ drag break a handle · Double-click sharp↔smooth · ⌫ remove point · ↵ esc done.

**F. Images** [ed-img]
- I → the left panel switches to the **Assets** tab: "Search assets", "Photos 120", tiles with names + a ✓ placed badge, "From this Mac…".
- Drop on a frame (or from Finder) → fills it, cropped to fit.
- Double-click → **crop mode**: the whole photo shown faded beyond the frame, crop-corner brackets, outer image handles. Tag "Hráč · foto · crop". Hint "↵ done · esc cancel".
- Inspector Image:
  - Thumb + filename + "4032 × 3024" + **Replace…**.
  - Fit seg **Fill · Fit · Crop · Tile**. Zoom "128 %".
  - Adjust: Look **Adjust…**; Background **✦ Remove background**.
  - Line "Both open Photo (12). Edits apply to this use only; Remove background is AI's job, so it wears the spark."

**G. Components** [ed-comp-*]
- **Component picker (⇧I)** popover above the toolbar:
  - "Search components"; system name line.
  - Groups mirror the DS canvas:
    - **Brand**: Logo "2 variants", Signs "12 glyphs".
    - **Components**: Tlačítko "2 variants" with variant chips Plné / Obrys, Štítek, Výsledek, Zápas, Pole formuláře, Karta hráče.
    - **Patterns**: Klubový web — hero, Leták A5, Matchday post, Story 9:16.
  - Footer **Open Design system**.
  - Placement: a ghost "Tlačítko · Plné" follows the pointer, snaps to the artboard's centre guide, click places it (linked). **↵ places it in the selected frame.**
- **Instance** [ed-comp-instance]:
  - Inspector kind "Instance", crumbs, Uses.
  - Component select; Variant select (focused) → menu "Tlačítko · variant" Plné ✓ / Obrys + disabled note "Your text and colour come along".
  - Content: Text (dot), Fill (dot), Icon switch.
  - Line "2 changes from Tlačítko." + **Reset**; link "Update Tlačítko for every canvas…".
  - Main component: **Go to Tlačítko** (→ 13) · **Detach**; line "Detach keeps this exact look as a plain frame. Nothing breaks; it stops following Tlačítko."
  - Swapping the whole component also keeps text.

**H. The full inspector** [ed-inspector] (one button; numbered sections 1–10 + Advanced)
1. **Position**: X·Y, Rotation, Constraints widget + selects.
2. **Size**: W/H + Hug / Fill / Fixed select, Clip content.
3. **Layout**: Direction, Gap token, **Spacing** seg Packed | Space between, Padding H token / V raw "10" with **Bind**, Align pad.
4. **Fill** (+): token "Ink 100 %". "+ adds another fill — a colour, a gradient or an image."
5. **Corners** (unlink): "Round".
6. **Border** (+): "None" (dim).
7. **Effects** (+): Shadow seg Flat / Resting / Floating / Sheet, Opacity.
8. **Type** (aside "text inside"): Style "Link", size · weight, Colour token.
9. **Interaction** (+): On click "Open cal.com/studio", On hover "Lift to Floating"; line "Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes." On canvas: a link chip "Opens cal.com/studio".
10. **Export** (+): PNG 2× / SVG, **Export Book a call**.
- **Advanced** (count "CSS · tokens · id", last, folded): CSS rows; "Tokens it uses" chips; "Element id" field `book-call`; **Copy CSS** · **Convert layout to absolute**.
- On-canvas: padding bands, a selection tag "Book a call · 148 × 44 · Hug", chip "V 10 · not a token".
- **Words → CSS table** (contract for the generator):
  - Hug → `width: fit-content`
  - Fill → `flex: 1`
  - Fixed 148 → `width: 148px`
  - Gap Space 8 → `gap: var(--space-8)`
  - Space between → `justify-content: space-between`
  - Padding H 24 · V 10 → `padding: 10px var(--space-24)`
  - Fill Ink → `background: var(--ink)`
  - Corners Round → `border-radius: var(--radius-round)`
  - Border Ink 1.5 → `border: 1.5px solid var(--ink)`
  - Shadow Resting / Floating / Sheet → `box-shadow: var(--shadow-*)`
  - Clip content → `overflow: hidden`
  - Constraints Right · Top → `right: 72px; top: 22px`
  - On click Open link → `<a href>`
  - Hidden → `display: none (kept in Layers)`
  - Locked → "— (canvas only, never in the CSS)"
- Explainer copy per section (verbatim set in the canvas), e.g. Size: "Hug wraps the content, Fill takes the room the frame gives, Fixed is a number."; Effects: "Shadows are the system's elevation — Flat, Resting, Floating, Sheet — the lowered, soft kind."

**I. Edge cases** [ed-edge-*]
- **AI + you in one artboard** [ed-edge-ai]:
  - AI's spark-dashed outline only on Footer, tag "AI is drawing the footer"; the agent cursor sits there.
  - You keep typing in Headline (edit ring).
  - Clicking the footer → tooltip "Footer is AI's until it's done · Stop in the AI chat".
  - Inspector line "AI is changing Footer in this artboard. Everything else stays yours."
  - AIPanel working, step "Links done · newsletter field next", scope "Footer".
  - "A token it uses can still change; AI picks up the new value."
- **⌘/ on a selection** [ed-edge-ask]:
  - 3 cards selected → ⌘/ → an inline prompt bubble anchored under the selection (avatar + text + ⌘/ kbd).
  - AI outline on the selection only, tag "AI is adding a link to 3 cards"; skeleton lines in each card.
  - Hint "One step — ⌘Z undoes all of it · the rest of the page stays yours".
  - The folded AI icon shows a dot.
- **Co-editing soft lock** [ed-edge-tereza]:
  - Tereza's sky ring + "Tereza" tag on the object, her cursor.
  - You can select; the inspector goes **view mode** (`ed-insp--view`, rows `view` = readable, quiet field chrome), every value readable incl. Interaction.
  - Line with her avatar "Tereza is editing See pricing. You can look; the fields open when she moves on." + **Comment**.
- **6000 px page** [ed-edge-huge]:
  - The artboard name **sticks to the window top** with its size.
  - **Minimap** island appears while working inside: page bar with sections + viewport box, section list (Úvod, Zápasy, Tým, Combine 2026, Novinky, Partneři, Patička), click to jump.
  - Inspector line "You're looking at 1727–5636 of 6000." ⌘0 fits.
- **Undo history** [ed-edge-undo]:
  - Popover "Undo history · newest first", "Opened from Menu › Edit › Undo history".
  - Rows: AI (spark) / You (avatar) · text · "AI · now". The top row shows ⌘Z, e.g. "Footer — 14 changes, one step", "Hero picture — kept try 2 of 3", "Duplicated Desktop at Tablet".
  - Hovering a row lights the affected area on canvas: "Would undo · 14 changes".
  - Foot "Tereza's changes are hers to undo." + row "Version history ⌥⌘H".
- **Paste from Figma** [ed-edge-paste]:
  - Arrives as an image of the frame. Paste bar: "Pasted from Figma as an image of “Hero / v3”." + **Make editable**.
  - Inspector Image: From "Figma · Hero / v3", W·H, Fit Fill / Fit; line "Make editable needs Figma Dev Mode on a paid seat. Some text may come back as pictures."
- **Keyboard only** [ed-edge-keys]:
  - Tab-order badges 1…6 and 4.1…4.3. **Focus ring** thicker with a halo (never mistaken for selection).
  - VoiceOver: "Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside."

### 2. User flows
1. **Select / resize an artboard.** Click name/edge → 8 handles + inspector → drag an edge → preset snap (⌘ = free, ⌥ = from centre) → release. A bottom-edge drag switches Height to Fixed.
2. **Arrange.** Drag an artboard → guides + equal-gap chips → release, guides vanish. Multi: marquee / ⇧-click → align bar → Tidy up (preview, then press).
3. **Duplicate / rename.** Right-click → Duplicate at another width ▸ Mobile 390 (a reflowed copy) · ⌘D repeat · double-click name → type → tab to the next → ↵.
4. **Drill in.** Double-click frame → double-click child → edit → esc ×N back out (at top: the artboard).
5. **Auto layout.** Select a frame → drag a gap band (token ruler) or pick from the Gap menu → reorder by dragging a child (slot opens) → esc cancels / ⌥ copies / drag out = free placement (Place freely on).
6. **Wrap.** Select objects → ⌥⌘G → a new frame (stacked ↓). ⇧⌘G removes the frame.
7. **Text.** Double-click → type → change size → dot + Reset → or Detach → or "Update Plakát for every canvas…" (→ 13 review).
8. **Shape.** R → drag → drag a corner dot → unlink corners → Border + → Effects.
9. **Pen.** P → click / drag points → click first point (close) or ↵ / esc (open) → double-click the path to edit points.
10. **Image.** I → Assets → drag a tile onto a frame (or ↵ places onto the selected artboard per CONTRACT §7) → double-click → crop → ↵. Adjust… / Remove background → Photo.
11. **Component.** ⇧I → pick variant → click to place (snaps) or ↵ into the selected frame → override → Reset / swap variant / Detach / Go to main.
12. **Ask AI on a selection.** ⌘/ → type → AI works only there → one undo step.
13. **Undo across AI.** ⌘Z steps interleaved You/AI. Menu › Edit › Undo history… → hover preview → click to undo to there (implied).
- Edge flows: clicking an AI-owned object → tooltip, no edit; clicking an object Tereza is editing → read-only inspector + Comment; clicking a locked object → selects the parent; pasting a Figma frame → image + Make editable.

### 3. Key copy (verbatim)
- "Fits content" · "Fixed" · "Clip content" · "Add a width" · "Other widths" · "Drag the bottom edge to fix the height at a number." · "Laptop · 1280 × 1573" · "⌘ ignores presets · ⌥ from the centre" · "X 3480 · Y 0"
- "One row, even gaps" · "Tidy up" · "Changes go to all 4." · "Mixed" · "4 files · 2×"
- "Duplicate at another width" · "Custom width…" · "↵ saves · esc cancels" · "tab moves to the next artboard's name — rename a whole row without the mouse." · "Long Czech names keep every háček; the label truncates on the canvas, never in the field." · "⌥ + drag duplicates too."
- "Set by Services · 2 of 3" · "Place freely" · "In auto layout, ← → move it earlier or later."
- "Changes go to all 3. Text settings show when only text is selected." · "Rotate · ⇧ 15°"
- "Select matching" ("same style") · "Copy properties" · "Paste properties" · "Frame selection" · "Remove frame" · "Logo is locked · ⇧⌘L unlocks" · "Point at a row: lock and eye appear at its end." · "A hidden object stays in the file and in Layers, greyed. It never exports."
- "Gap · Space in Studio site system" · "Auto" ("space between") · "A number, no token…" · "⌘ any number · ⌥ every gap at once" · "3 cards, each Fills the width." · "Convert layout to absolute" · "Each card keeps where it is now; the frame stops arranging them. ⌘Z brings the layout back."
- "Small apps · moves to 1 of 3" · "Let go — it moves here" · "esc puts it back" · "⌥ while dragging — a copy" · "Drag out of the frame — place it freely"
- "Constraints" · "Post places things freely — no auto layout. …"
- "Čeština: one-letter words stay with the next word (the ties under “v” and “s”), „quotes“ turn Czech." · "from Plakát" · "Size differs from Plakát." · "Reset" · "Update Plakát for every canvas…" · "No style" · "Keeps its look; stops following Plakát. Nothing else changes." · "Use a style" · "Change Plakát in the Design system and this follows."
- "Combine shapes" · "Two or more" · "Click here to close" · "Smooth" · "Sharp"
- "Replace…" · "Fill · Fit · Crop · Tile" · "Adjust…" · "Remove background" · "Both open Photo (12). Edits apply to this use only; Remove background is AI's job, so it wears the spark." · "From this Mac…" · "Search assets"
- "Search components" · "Open Design system" · "Your text and colour come along" · "2 changes from Tlačítko." · "Update Tlačítko for every canvas…" · "Go to Tlačítko" · "Detach keeps this exact look as a plain frame. Nothing breaks; it stops following Tlačítko."
- "V 10 · not a token" · "Bind" · "Opens cal.com/studio" · "Tokens it uses" · "Element id" · "Copy CSS"
- "AI is drawing the footer" · "Footer is AI's until it's done · Stop in the AI chat" · "AI is changing Footer in this artboard. Everything else stays yours."
- "AI is adding a link to 3 cards" · "One step — ⌘Z undoes all of it · the rest of the page stays yours"
- "Tereza is editing See pricing. You can look; the fields open when she moves on." · "Comment"
- "You're looking at 1727–5636 of 6000."
- "Undo history" · "newest first" · "Opened from Menu › Edit › Undo history" · "Would undo · 14 changes" · "Tereza's changes are hers to undo."
- "Pasted from Figma as an image of “Hero / v3”." · "Make editable" · "Make editable needs Figma Dev Mode on a paid seat. Some text may come back as pictures."
- "Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside."

### 4. Keys (Edit mode, complete)
- **Tools:** V Select · H Hand (hold Space) · F Frame · R Shape · P Pen · T Text · I Image (opens Assets) · ⇧I Component · More = Line / Ellipse / Polygon / Crop / Export area (no keys).
- **Selection:** click · ⇧-click add · marquee · double-click enter · esc step out · ⌘A select all · tab / ⇧tab next/prev object in reading order · ↵ go inside / start typing · F6 cycle panels ↔ canvas.
- **Move / resize:** arrows 1 px · ⇧ 10 px · ⌘+arrows resize 1 px from right/bottom (⇧ 10) · in auto layout ← → reorder · ⌥ shows distances · ⌥-drag duplicate · ⇧ rotate in 15° steps.
- **Artboard resize:** ⌘ ignores presets · ⌥ from centre.
- **Gap drag:** ⌘ any number · ⌥ every gap at once.
- **Object:** ⌘D duplicate · ⌫ remove · ⌥⌘G (⌘G alias) frame selection · ⇧⌘G remove frame · ] / [ forward/backward · ⌘] / ⌘[ front/back · ⇧⌘L lock · ⌥⌘C / ⌥⌘V copy/paste properties · ⌘X/C/V · ⌘/ Ask AI (selection attached) · Hide has no key.
- **Pen:** click / drag / ⌥-drag / double-click point / ⌫ point / ⇧ 45° / ↵ esc finish.
- **Crop:** ↵ done · esc cancel.
- **Rename:** ↵ / esc / tab.
- **Keyboard creation:** a tool key (R / T / F) then ↵ adds one at its default size.
- **Global:** ⌘Z / ⇧⌘Z (includes AI) · ⌘0 fit · ⌘1 actual · ? all shortcuts · ⇧⌘E Export · ⌥⌘H Version history.
- **Menu paths:** Menu › Edit › Undo history… · Menu › Edit › Copy / Paste properties · Menu › View › Advanced ▸ Minimap / Layers as a panel / Inspector ⇧⌘I / Open inspector on select · Menu › Edit › Advanced ▸ New artboard (Desktop · Laptop · Tablet · Mobile · A4 · Letter).

### 5. Classification
- **EXISTS → moves:**
  - Canvas toolbar `DEFAULT_TOOLS` (S/use-tool-mode.tsx:87) → Edit toolbar. Today Pen is B, Highlighter I, Eraser E, Section ⇧S, Sticky N, Comment C in one palette. Annotation tools move to Preview's toolbar (15); I is now Image; Browse is dropped (Preview).
  - Insert element Div / Text / Image (S/tool-palette.tsx:591) → Frame F / Text T / Image I.
  - Artboard right-click (S/canvas-shell.tsx:1447–2329): Duplicate at width, Rename, Duplicate, Export this artboard, Delete artboard → v2 artboard menu. **Theme, Artboard kind, Fit just this artboard, Reset position, Convert layout to absolute, Open Timeline are not in the v2 artboard menu.** Kind and Theme placement is undrawn.
  - Element right-click (Copy CSS, Copy data-cd-id, Inspect, Edit Photo…, Select layer, Insert ▸, Replace image…, Convert children to absolute, Duplicate, Copy/Paste style, Delete, Hide, Lock, Export selection…) → object menu + Advanced ▸ (Copy CSS · element id) + Image inspector (Replace…, Adjust…).
  - Multi-select align/distribute + contextual toolbar "Tidy up" (S/contextual-toolbar.tsx) → align bar.
  - Inspector (C/app.jsx:9274): Inspect tab (read-only pos/size/tag/class) → Position/Size sections + Advanced; CSS tab Designer mode, 11 clusters (C/app.jsx:6715) → designer sections; CSS Advanced mode → inspector Advanced (raw property rows, custom attributes — the drawn Advanced shows only CSS/tokens/id).
  - ArtboardKnobs (C/app.jsx:8821) → artboard inspector. Print Portrait/Landscape + Bleed are not drawn in 14.
  - Layers tab/panel (C/app.jsx:9884; ⌥↑↓ move) → Layers tab in the left panel (CONTRACT §7 Canvases · Layers · Assets).
  - Component instance purple rows + edit-scope strip → instance inspector.
  - Measure/snap guides, minimap, zoom HUD, undo HUD (S/undo-hud.tsx), participants (S/participants-chrome.tsx), AI activity banner (S/ai-banner.tsx) → smart guides (magenta), contextual minimap, ZoomUndo, Undo history, presence rings, AI per-object outline.
  - AssetPicker (C/app.jsx:1234) → Assets tab.
  - Photo panel → Adjust… / Remove background.
  - Hug height → "Fits content".
- **NEW:**
  - Preset snapping ruler, equal-gap chips, Tidy preview outlines, ⌘D same-gap rhythm, tab-to-next rename.
  - Breadcrumb + esc ladder, Place freely switch, token ruler on gap drag, reorder slot animation, constraints widget.
  - Czech ties + Language select, Case seg, text style override dots + Reset + Detach.
  - Per-corner radius dots, Pen point editor UI, Combine shapes, crop mode with ghost.
  - ⇧I picker grouped like the DS, variant swap keeps overrides.
  - Interaction section (On click / On hover).
  - Per-object Export, element id field, Bind on raw values, words→CSS table.
  - AI object-level ownership tooltip, ⌘/ inline prompt bubble, AI run = one undo step, Undo history popover with hover preview.
  - Co-editing soft lock, sticky artboard name + contextual minimap, Figma paste bar, F6/tab keyboard model + VoiceOver strings, focus ring with halo.
  - `--guide` magenta token.
- **PROPOSED:** object keys (CONTRACT §2 "proposed, 14 Editing"); co-editing rules (CONTRACT §7 "proposed, 14 Editing"); ⌘G alias.

### 6. Backend / native / canvas-lib / file-format needs
- **Stable element ids** for every object (today `data-cd-id`), surviving AI rewrites. Needed by Layers, breadcrumbs, locks, Undo history scopes, co-editing and 15's bound arrows.
- **Canvas-only metadata** (lock, hide-in-editor, Place freely, override markers): where stored? Lock must stay "canvas only, never in the CSS". Hidden → `display:none` but kept in Layers + excluded from export. Likely `.meta.json` per element id or `data-*` attributes; must not leak to export/handoff.
- **TSX writer for designer ops:** flex/grid layout with token vars, padding H/V, Hug/Fill/Fixed, constraints → absolute right/top, convert-to-absolute (exists), reorder children (JSX node move), wrap in frame / unwrap, z-order (DOM order or z-index), per-corner radius, border position (inside → box-shadow inset or outline?), shadow tokens, object-fit / position / zoom for crop, Interaction → `<a href>` + hover style, element id rename. Every write must keep tokens as `var(--…)` and plain numbers raw.
- **Token awareness:** read the DS token set (13) to offer stops, chips and "not a token" detection; "Bind" converts raw → nearest token.
- **Text styles** as DS type tokens + per-property override detection (computed vs style) + reset + detach (inline the values). Czech typography pass: `lang` attr, NBSP after one-letter words, Czech quotes; applies on write.
- **Component instances:** registry of masters (13), instance → master + variant + override map; swap preserving overrides; detach → inline JSX; "Update for every canvas…" → 13 review; Go to main → navigate to DS canvas + select master.
- **Pen:** SVG path model with point types and handles; boolean ops (union / subtract / intersect / exclude) — the draw engine `apps/studio/draw/` geometry may help.
- **Snapping engine:** artboard presets (per kind), sibling edges, equal gaps, centre guides on placement, token stops for gaps.
- **Undo:** a unified op log across user and AI with author, grouped transactions (one AI run = one step), per-user stacks ("Tereza's changes are hers to undo"), hover preview of the affected region, jump-to-entry.
- **Co-editing over sync:** presence publishes "editing object id"; others get the object read-only (soft lock, no server enforcement implied); releases on selection change / blur / disconnect (timeout undefined). AI ownership similarly per object for the duration of a run; "Stop in the AI chat".
- **AI scoping:** ⌘/ attaches the selection (element ids) to the ACP prompt; AI writes restricted to those ids; outline overlay driven by AI-run scope.
- **Figma clipboard:** detect a Figma paste payload → rasterise / fetch the frame image → "Make editable" via Figma API (Dev Mode seat) → layers.
- **Minimap per long artboard** with section detection (top-level children) + viewport range readout.
- **Accessibility:** canvas focus model (tab order = reading order of element tree), F6 region cycling across native chrome + iframe, ARIA live strings.
- **Export per object** (PNG / SVG) via existing export.

### 7. Dependencies
- **13** (tokens, type styles, components, Uses link, update review), **12** Import and Assets (Assets tab, Photo, Figma import), **04** Modes (Interaction plays in Preview, toolbar per mode), **03** AI Chat (⌘/, Stop, working tags), **10** Share (presence colours, Comment), **09** Export (⇧⌘E, per-object export), **15** (needs stable element ids from here), **07** Video (timeline on video artboards; not drawn here).

---

## 15 Annotations (`an-*`, 31 artboards, 9 sections)

**Ground truth:** today's whiteboard layer, all kept:
- `<slug>.annotations.json` (DDR-242). Element types (annotations-model.ts `tool`): pen (highlighter = pen flag), rect, ellipse, polygon, arrow, text, sticky, image, link, mediaref, section, element.
- STICKY_PALETTE 10, STROKE_PALETTE 9, HIGHLIGHTER_PALETTE 4 × widths 10 / 18 / 28.
- Arrows store binds to board items only (annotations-bindings.ts); a pointer end on the design is a fixed point (`--pin`).
- Lock (DDR-246); author `ai` / authorName / authorId.
- `read-annotations` / `annotate` / `canvas-rects`; `--board` templates; StickerPicker 4 packs; `--from-figjam`; `includeAnnotations` opt-in export; comments are a separate layer.

**Decisions drawn (proposed):**
- Annotations show in BOTH modes. In Edit they are quiet, with click-through. ⇧P hides them in any mode. Comment pins show in Edit + Preview, never in Present.
- "Resolve" is one word for comments and stickies.
- AI writes on paper with a spark edge + spark arrows.
- Can comment = Hand + Comment only.
- Stickers (E) is ONE gallery: stamps on top, Recent, 4 packs; a pick follows the pointer and lands at 160 px (today it lands mid-view).

**Toolbar:** Preview's annotate toolbar = Hand H | Sticky N · Comment C · Marker M · Arrow A · Shape R · Text T · Stickers E · Section S. 48 px buttons, FigJam-style icons (`AnnotateIcon`).

### 1. Surfaces / components

**A. Entering annotate** [an-enter, an-place, an-sticky, an-today]
- **Mode entry:** N (or C M A E S) in Edit → Preview with that tool. The toolbar morphs (220 ms `--ease-out`, kit `ToolbarMorph`), the Share-cluster switch moves to Preview, quiet stickies brighten. **No banner, no toast.**
- **Preview bar** (top centre, lifted from 04): ModeGlyph · "Previewing **Homepage**" · "esc to edit".
- In Preview the design stays live: links, hovers, scroll, video work; a drag pans.
- In Present, N first drops back into Preview.
- esc ladder: tool → Hand → Edit.
- **Sticky colour row** opens above the Sticky tool. The last colour is remembered **per person**.
- **Placement** [an-place]: four on-canvas callouts.
  1. On an artboard, it **rides with that artboard** (PROPOSED).
  2. Between artboards, it stays put.
  3. Dropped on another sticky, it **stacks** 12 px down-right.
  4. Typing grows it to 5 lines, then wider.
- **Sticky up close** [an-sticky]:
  - Square paper, Maude rounded face.
  - **Auto-size:** "grows to five lines, then wider, never a scrollbar. Text gets smaller only past 120 words."
  - **Tilt:** −2°…+2° derived from the sticky id (stable on every screen), flat while typing.
  - **Stack + Fan out:** right-click menu Fan out · Bring to front · Send to back.
  - **10 papers:** 5 up front (yellow, coral, green, sky, lilac) + "+5" (white, grey, peach, aqua, pink). FigJam stickies keep their tint.
  - **Author line:** on hover/selected, "Jonas · 2 h ago". The live typist's cursor colour edges the sticky. Imported ones say where they came from.
  - **Sticky context toolbar:** colour dots (+5) · text size select (Small…Huge) · List · Lock · **Turn into a comment** (PROPOSED) · more.
  - ⌘D duplicates; ⌫ moves to trash; ⌘Z restores.
- **Everything kept** [an-today], 8 cells:
  1. Text T: sizes Small 12 / Medium 16 / Large 24 / Extra large 36 / Huge 64 + any 8–200; B / I; L / C / R.
  2. Shape R: rectangle, ellipse, diamond, triangle, triangle down; fill & stroke picked apart; dashed; double-click writes a label inside.
  3. Pictures + link cards by paste/drop (link card = site + title).
  4. Video / audio files dropped → chip with name + length + play.
  5. Group ⌘G / ⇧⌘G, align, distribute via the small toolbar.
  6. Dashed strokes / arrows; bullet & numbered lists in stickies / text.
  7. Palettes: sticky 10, marker 9 inks black-first, highlighter 4 × 3 widths.
  8. "Where each one lives" table: R · T → toolbar; ⌘V → paste; ⌘G group; "Above it" → small toolbar; ⌘K finds all by name.

**B. Arrows** [an-arrow-bind, an-follow, an-rebind, an-arrow-kinds]
- **Bind to an element inside an artboard** (PROPOSED):
  - While aiming, faint candidate outlines on elements.
  - The snapped element gets an azure ring + tag "**Button** · See the work".
  - Over an artboard's edge, the whole artboard lights (`an-edge`) and the end sticks to the nearest side, sliding along it.
- **Follow, signature** (PROPOSED):
  - Dragging Desktop past Mobile: the bound elbow arrow re-routes live (0 ms straight down; 120 ms under Mobile; on release, over Mobile on the shortest clean path, settling on `--dur-soft` 160 ms).
  - The straight line that would cross Mobile is refused: tag "the straight line would cross Mobile".
  - Marker loop + sun sticky on Desktop ride along; the loose note "Homepage review · 6 Oct — stays where it is".
  - Rules: "Bound ends follow." · "Around, never through." · "Drawn on it, moves with it." · "Sections carry their members." (shipped) · "Locked still follows."
  - Chips "live while dragging", "settles on --dur-soft · 160 ms"; Reduce motion: "the route jumps, nothing eases."
- **AI rewrites the target** (PROPOSED):
  - (1) Same element rewritten → the arrow stays bound; ring tag "**Button** · See our work · rewritten by AI".
  - (2) Replaced by a different element → the arrow keeps its end, dashed, with an open circle; card "Pointed at the old **“See the work”** — replaced by AI" + **Point to…**; ⌘Z brings the button back and re-attaches.
- **Kinds** [an-arrow-kinds]:
  - Arrow context toolbar: seg Straight · Curved · Elbow · head picker · ink dots (4 + "+5") · Lock.
  - Default new arrow = Curved with a filled head.
  - **Label on the line:** double-click; it follows re-routes; AI reads it.
  - Heads: None · Line · Triangle · Triangle (outline) · Circle · Diamond, either end; two heads = Two-way.

**C. Marker** [an-marker]
- Marker popover above the tool: seg **Marker · Highlighter · Eraser** · 5 inks (Ink default, red, amber, green, blue) + "+4" (orange, purple, pink, grey) · 2 thickness options.
- Eraser rubs out strokes only, never stickies.
- Strokes belong to the artboard under them (PROPOSED). Hover shows a "belongs" outline + tag "On Post 1:1 · moves with it".
- Highlighter is drawn as a translucent wide stroke.

**D. Sections + templates** [an-section, an-templates, an-plan]
- **Section:**
  - Titled container, colour tone, editable title with caret.
  - Section context toolbar: colours (grey, yellow, coral, green, sky, lilac) · **Fold** (PROPOSED) · **✦ Ask AI about it** · Lock · more.
  - Folded section = one line with twisty + title + count ("6 stickies · 2 people", "3 stickies").
  - Created via "Wrap in section" or S + drag.
  - Members move with it (shipped). Arrows can go from a section to an artboard.
- **Templates panel** (S tool, above the toolbar; also ⌘K):
  - Header "Templates · or drag on the canvas for a blank one".
  - 8 tiles with thumbs: Kanban "To do · Doing · Done", Retro "Went well · To improve · Actions", Flowchart "Steps and decisions", Content calendar "One column a day", Roadmap "One column a month", Brainstorm "A topic and ideas round it", Checklist "One section, ticks", Blank section "Draw it, name it".
  - An Ask field ("describe it", azure send with spark) → AI builds it with your items in the prompt's language.
  - The picked template ghost follows the pointer until click.
- **Plan example:**
  - Kanban sections (Nápady / Rozpracované / Hotovo with counts), cards colour-coded by channel with a legend (Instagram / Tisk / Web / Video).
  - Stamps on cards. Arrows from Done cards to the artboards they became.

**E. Stickers** [an-stk-gallery, an-stk-search, an-stk-drop, an-stamps, an-vote]
- **Gallery** (E), island above the toolbar:
  - Header "Stickers [E]"; search field "Search stickers…".
  - Sections in order:
    1. **Stamps** "vote · one each · they count" (PROPOSED tag): Yes, No, Star, Love it, Question, +1. Drawn glyphs, never emoji.
    2. **Recent** "yours, last placed first" (6).
    3. Packs (order: Project status 80 · by Iconfinder; FigJam Doodle 24 · CJ Xue; Life Style 15 · Pelin Şenoğlu; Opposing Thoughts 20 · Erik Leib). 5 shown + "+N" tile each.
  - Credits footer: "Packs from the Figma Community: Project status — Iconfinder (source) · …".
- **Search** "done":
  - Chips "All · 6", "done · 4", "almost-done · 2", "finished · 2", "approved · 2".
  - Pack block "Project status · 6 of 80", tiles with keyword captions.
  - Line "No “done” in FigJam Doodle, Life Style or Opposing Thoughts · no stamp either".
  - Empty state "hotovo": "**No stickers match “hotovo”** Sticker words are English — try [done] [finished] [approved]".
  - Search covers the stamps too ("yes", "star", "+1").
- **Drop** [an-stk-drop]:
  - Lands at 160 px, selected, size tag "160 × 160"; corner handles (square resize).
  - Sticker context toolbar: **Replace…** (swap in place, same spot / size) · **Flip** (mirror) · Lock ⇧⌘L · Duplicate ⌘D · more.
  - "It is never part of the design."
- **Stamps** [an-stamps] (PROPOSED element type):
  - A stamp shows the voter's avatar face. Several on one spot gather into a cluster with a count (e.g. 5), one per person per kind.
  - Hover card "**5 stamps** on Směr B" listing stamp · avatar · name · stamp name.
  - After one stamp, the gallery **folds to a stamp row** island ("Stamps" + 6 + chevron to all stickers).
- **Vote** [an-vote] (PROPOSED):
  - Start: right-click › Start a vote… or ⌘K on selected artboards. That entry is only in meta.
  - Vote bar (top): "**Vote** 3 directions · **0 left** of your 3 · ⏱ 1:42 · faces '4 of 5 done' · **End vote**".
  - Your votes show as your avatar dots + "yours" on each artboard. Others hidden until the end.
  - Result persists as a section, e.g. "Hlasování · Helmy · 1 Oct" with bars + counts + "Last week's vote · 5 people · 3 votes each · 2 min". AI can read it.

**F. Comments vs annotations** [an-vs, an-convert]
- Side-by-side explainer + 8-row table (verbatim):
  - Lives: "On one spot of an artboard or element" / "On the layer above the artboards".
  - Made with: "C — Comment" / "N · M · A · R · T · E · S".
  - Who can: "Can comment and up" / "Can edit".
  - Talking: "Replies, @mentions, notifications" / "No replies — a sticker or a stamp for a quick yes".
  - When it's done: "Resolve: moves to Resolved, kept" / "Resolve: struck through in place, kept".
  - Show and hide: "Comments ⇧⌘M · pins in Edit and Preview, never in Present" / "Annotations ⇧P · quiet in Edit, never in Present".
  - AI: "Reads a thread you point it at" / "Reads the whole layer; writes notes and arrows".
  - Export: "Never" / "Only with Include annotations".
- **Sticky right-click menu:** Turn into a comment · Resolve · Lock ⇧⌘L · Copy ⌘C · Duplicate ⌘D · Bring to front · "Ask AI about this sticky" ⌘/ · Move to trash ⌫.
- **Convert** (PROPOSED):
  - The thread appears where the sticky's arrow pointed (or where it sat), signed by its author.
  - Header "From Jonas's sticky · turned into a comment by You · Undo". The sticky goes to the trash.
  - A thread's ⋯ turns it back.

**G. AI with annotations** [an-ai-read, an-ai-apply, an-ai-stickers, an-ai-write]
- **Read:**
  - Marquee-selected stickies ("3 stickies" tag) become the AI scope chip.
  - AI outlines the element they mean (spark ring + tag "✦ The hero picture").
  - Says it back in one line; inline question "Hero picture: from 616 to 720 wide, to the right edge; the headline keeps its two lines. Tereza's “Warmer sun?” isn't included." → **Make these changes** / Not now.
- **Apply (Edit):**
  - AI changes the artboard ("Made by AI"). The answered stickies become **resolved** (tick badge, struck through, kept); the layer is quiet.
  - AI message "Done — the hero picture fills the right half of Desktop. The 3 stickies that asked for it are resolved and stay where they were." Chips "Do “Warmer sun?” too", "Show what changed".
  - ⌘Z undoes both.
- **Status stickers:** AI places Done! on resolved stickies and Flagged on one that needs you, each with a spark badge ("Placed by AI"). Chips "Do “Warmer sun?” too", "Remove the stickers".
- **Write a review:** AI stickies (plain paper, spark edge + "AI" author line) + spark-coloured arrows to elements. Bound ends PROPOSED; today they are fixed points. Message "Done — 4 notes on Pricing, each pointing at what it means. The design didn't change." Chips "Make these changes", "Put them in a section".

**H. Managing the layer** [an-layers, an-visibility]
- **Layers tab in Preview** = the annotation list:
  - Title "Annotations 24".
  - Person filter chips Everyone · Tereza · Jonas · You · AI (spark).
  - Rows grouped by section (twisty, count), member stickies with colour dots and lock state, arrows ("Arrow to Post 1:1"), marker ("Marker on Post 1:1").
  - Foot "Hidden by the filter: Jonas 9 · You 4 · AI 5". The filter hides; it does not remove.
- **Locked sticky:** context toolbar "🔒 Locked · Unlock ⇧⌘L"; a drag attempt → tooltip "Locked — unlock to move it". Readable, selectable.
- **Visibility, 4 states:**
  1. Preview full strength.
  2. Edit quiet: faded paper, words ≥ 4.5:1, clicks go to the design.
  3. ⇧P hidden in any mode: toast "Annotations hidden. Press ⇧P to bring them back." + Show.
  4. ⇧⌘A select all: in Edit it switches to Preview first. Marquee + context toolbar "**5 annotations** · Lock all · Wrap in section · Move to trash".
- **⌘K "resolved":** "Move resolved stickies to the trash" (meta "6 on this canvas") · "Show resolved stickies" · "Select resolved stickies". Toast "6 stickies moved to the trash" + Undo.

**I. Edge cases** [an-dangling … an-figjam]
- **Dangling** (PROPOSED): target moved to trash → dashed arrow end + card "Pointed at **“Book a call”** — moved to the trash by Jonas" + **Point to…**. Restore re-attaches.
- **Crowd:**
  - Below 25 % zoom, stickies draw as colour-block mosaics; sections show counts. Tiny artboards labelled "Combine-kampan · 15 artboards".
  - Hover card "**Nápady** · 84 stickies", faces "+ 8 people", "Click to zoom to it".
- **Video sticky** (PROPOSED):
  - A sticky placed on a playing video is pinned to a time range (0:12–0:15), has a time chip "🕒 0:12", fades (≈ 0.32) at other times.
  - Timeline header: play, "0:12 / 0:30", artboard name, "2 notes · 1 comment". Note marks (coloured range bars) + comment pin marks on the track; click jumps.
- **Print:**
  - Note over a print area gets a "🖨 Not printed" tag. Bleed + crop marks drawn.
  - Export dialog row "Annotations": **Include annotations** disabled for print formats; copy "Stickies, arrows and stickers stay out unless you include them." / "Print files never carry them — pick PDF for a review copy."
  - Other rows: Scope seg, Format "PDF for print · A6, 3 mm bleed", Colour "RGB — the print shop converts to CMYK", estimate "2 artboards · 2 pages · about 4 s".
- **Can comment:**
  - Toolbar `only={["hand","comment"]}`, ShareCluster viewing + "Can comment", no Preview bar, the **AI panel not rendered**.
  - Everyone's annotations shown read-only.
  - Pressing N / M / A / E → island "[N] Stickies need Can edit. **Ask to edit**".
- **FigJam import:**
  - Import from Figma… accepts a FigJam link → one section "Combine brainstorm 2025" with chip "From FigJam".
  - Stickies, shapes (ellipse / diamond / rect), connectors and text arrive editable, authors kept ("Klára").
  - Widgets arrive as pictures ("Widget “Voting” — as a picture").
  - Toast "46 items from FigJam arrived as annotations" + Undo.

### 2. User flows
1. **Sticky from Edit.** Press N → Preview + Sticky + colour row → click → type (flat, grows) → esc (Hand) → esc (Edit; stickies go quiet).
2. **Stack / fan out.** Drop a sticky on a sticky → offset stack → right-click › Fan out.
3. **Arrow to an element.** A → drag from a sticky → hover elements (candidates) → release on the button (ring + name) → later move the artboard (re-route live) → AI rewrites the button (stays bound) or replaces it (dangling → Point to…).
4. **Mark up.** M → pick ink / Highlighter / Eraser → draw over an artboard (belongs to it) → erase strokes.
5. **Section / template.** Select stickies → Wrap in section (or S drag) → name / colour → Fold → Ask AI about it. Or S → template panel → pick / describe → place.
6. **Sticker.** E → gallery → search / chip → pick → follows pointer → click lands 160 px → Replace… / Flip / Lock.
7. **Stamp vote.** E → stamp → gallery folds to stamp row → stamp more. Clusters count, one per person per kind.
8. **Formal vote.** Select artboards → right-click › Start a vote… → each gets 3 votes, 2 min, hidden → End vote or timer → results revealed → result section persists.
9. **Convert.** Right-click sticky › Turn into a comment → thread at the target → Undo in the header. A thread's ⋯ → back to a sticky.
10. **AI loop.** Select stickies → Ask AI → AI outlines the target + offers the change → Make these changes → Edit, change applied, stickies resolved (+ optional Done! / Flagged stickers) → ⌘Z undoes all.
11. **AI review.** Ask "review Pricing" → AI notes + arrows on the layer → "Make these changes" / "Put them in a section".
12. **Clean up.** ⌘K "resolved" → Move resolved stickies to the trash → toast Undo.
13. **Filter / lock.** Layers (Preview) → person chip → work → ⇧⌘L lock settled items.
14. **Visibility.** ⇧P toggle (any mode) · Menu › View › Annotations ⇧P (ticked) · ⇧⌘A select all.
- Edge flows: Can comment presses N → denial + Ask to edit · print export with annotations disallowed · video note pinned to a time · FigJam import + Undo · 200 stickies at low zoom.

### 3. Key copy (verbatim)
- "Previewing Homepage" · "esc to edit"
- "Press N in Edit. Preview opens with Sticky in hand."
- "Same key, same tool, from anywhere." · "The design stays live." · "Colours stay where you left them."
- "Fan out" · "+5" · "+4"
- "Turn into a comment" · "Lock all" · "Wrap in section" · "Move to trash"
- "Button · See the work" · "the straight line would cross Mobile" · "Let go — the shortest clean path, over Mobile · 160 ms" · "Homepage review · 6 Oct — stays where it is"
- "Pointed at the old “See the work” — replaced by AI" · "Point to…" · "Pointed at “Book a call” — moved to the trash by Jonas"
- "Straight · Curved · Elbow" · "None · Line · Triangle · Triangle (outline) · Circle · Diamond" · "Two-way" · "slides along the edge"
- "Marker · Highlighter · Eraser" · "On Post 1:1 · moves with it" · "Ink — the default"
- "Fold" · "Ask AI about it" · "Templates" · "or drag on the canvas for a blank one" · Kanban / Retro / Flowchart / Content calendar / Roadmap / Brainstorm / Checklist / Blank section + their sub-lines
- "Stickers" · "Search stickers…" · "Stamps" · "vote · one each · they count" · "Recent" · "yours, last placed first" · "80 · by Iconfinder" · "Packs from the Figma Community: … (source)" · "6 of 80" · "All · 6" · "No “done” in FigJam Doodle, Life Style or Opposing Thoughts · no stamp either" · "No stickers match “hotovo”" · "Sticker words are English — try"
- "160 × 160" · "Replace…" · "Flip"
- "5 stamps on Směr B" · Yes / No / Star / Love it / Question / +1
- "Vote" · "3 directions" · "0 left of your 3" · "4 of 5 done" · "End vote" · "yours" · "Last week's vote · 5 people · 3 votes each · 2 min"
- "From Jonas's sticky · turned into a comment by You · Undo" · "Resolve" · "Reply…"
- "The hero picture" · "Make these changes" · "Not now" · "Do “Warmer sun?” too" · "Show what changed" · "Remove the stickers" · "Put them in a section" · "Placed by AI"
- "Annotations 24" · Everyone / Tereza / Jonas / You / AI · "Hidden by the filter: Jonas 9 · You 4 · AI 5" · "Locked" · "Unlock ⇧⌘L" · "Locked — unlock to move it"
- "Annotations hidden. Press ⇧P to bring them back." (Show) · "Move resolved stickies to the trash" · "Show resolved stickies" · "Select resolved stickies" · "6 stickies moved to the trash" (Undo)
- "Click to zoom to it" · "+ 8 people"
- "2 notes · 1 comment" · "Not printed" · "Include annotations" · "Stickies, arrows and stickers stay out unless you include them." · "Print files never carry them — pick PDF for a review copy."
- "Stickies need Can edit." · "Ask to edit"
- "From FigJam" · "46 items from FigJam arrived as annotations" · "Widget “Voting” — as a picture"

### 4. Keys & menu paths
- **Preview toolbar:** H Hand (Space hold) · N Sticky · C Comment · M Marker · A Arrow · R Shape · T Text · E Stickers · S Section. N C M A E S from Edit or Present switch to Preview with that tool. esc: tool → Hand → Edit.
- **On the layer:** ⌘G group · ⇧⌘G ungroup · ⇧⌘L lock / unlock · ⌘D duplicate · ⌫ move to trash · ⌘Z restore · ⌘C / ⌘V · ⌘/ "Ask AI about this sticky" · double-click arrow = label · double-click shape = label inside.
- **Visibility:** ⇧P hide/show annotations (Menu › View › Annotations, ticked) · ⇧⌘A Menu › Edit › Select all annotations (switches to Preview) · ⇧⌘M Comments (separate).
- **⌘K:** templates, "resolved" actions, Start a vote (meta), every annotation tool by name.
- **Right-click:** sticky menu (above) · stack › Fan out / Bring to front / Send to back · artboards › Start a vote… (PROPOSED).
- **Import:** Menu › File › Import from Figma… accepts FigJam links. **Export:** Menu › File › Export… ⇧⌘E › Include annotations.

### 5. Classification
- **EXISTS → moves:**
  - Annotation tools in the single canvas palette `DEFAULT_TOOLS` (S/use-tool-mode.tsx:87): Sticky N, Comment C, Arrow A, Text T, Shape R (6 kinds), Pen B, Highlighter I, Eraser E, Section ⇧S → Preview toolbar. Pen + Highlighter + Eraser merge into Marker M (3 tips; Eraser loses its key). Section moves ⇧S → S. Stickers (from palette S/tool-palette.tsx:624) → E.
  - Annotation context toolbar (S/annotations-context-toolbar.tsx; colours, stroke, dashed, fill, font sizes, B/I/U/S, lists, link URL/title, image alt, mediaref, group/ungroup, delete) → per-type small toolbars (sticky / arrow / section / sticker / multi).
  - Arrow styles / heads / sizes (canvas-lib labels) kept.
  - Visibility ⇧P / View ▸ Annotations / Settings (§5) kept. Select all ⇧⌘A kept (it was also Assistant in the shell keys).
  - AssetPicker "Add as annotation" → paste / drop.
  - Lock (DDR-246) kept.
  - StickerPicker (P/StickerPicker.jsx: search across keywords, pack grids with "by author", credits + source link, `onPick` → mid-view drop) → Gallery popover + Recent + stamps + follow-pointer placement.
  - `--board` templates → Templates panel.
  - `read-annotations` / `annotate` → AI read / apply / write.
  - `--from-figjam` → Import from Figma… with FigJam link.
  - `includeAnnotations` export → export dialog row.
  - Comments panel (C/app.jsx:5429) unchanged as a layer.
- **NEW (non-proposed):** quiet-in-Edit rendering with click-through, per-person last colour, stable id-based tilt, stack offset + Fan out, author line, Recent stickers, keyword chips, sticker Replace… / Flip, drop at the pointer (160 px kept), templates AI "describe it", Layers-as-annotation-list with person filter, ⌘K resolved actions, Resolve for stickies (struck through), LOD mosaic below 25 %, "Not printed" tag, Can-comment denial line, FigJam section chip.
- **PROPOSED:** arrows bound to an artboard edge / an element inside an artboard + live elbow re-route around artboards + dangling state; annotations (stickies, marker, stickers, text) riding with their artboard; stamps as an element type + clusters; vote sessions; sticky ↔ comment conversion; video time-pinned stickies; section Fold; AI-written arrow ends bound.

### 6. Backend / file-format / canvas-lib needs
- **`.annotations.json` (DDR-242) element additions:**
  - `parentArtboard` (artboard id) + artboard-relative coords, so annotations ride with the artboard.
  - `resolved: true` (+ by / at).
  - `tilt` derived from id (no storage) or stored.
  - Sticker metadata on image elements: `{pack, stickerId, keywords, flip}` for Replace / Flip.
  - New element `stamp {kind, authorId, target?}` + aggregation rule (one per person per kind per spot).
  - `vote` session record `{targets[], votesPerPerson, durationSec, state, ballots(hidden until end), result}` → materialises a result section.
  - `timeRange {start, end, artboardId}` on stickies over video.
  - Section `folded`.
  - Arrow bind targets extended: `{kind: "board" | "artboard-edge" | "element", id, side?, lastLabel, lastBox}`; dangling state derived when the target is missing (keep lastBox + label for the card).
  - Imported provenance (`source: "figjam"`, original author name).
  - Arrow label exists?
- **Element-id stability** (shared with 14): AI rewrites must preserve `data-cd-id` for "same element"; a heuristic or AI contract for "rewritten vs replaced". `canvas-rects` already resolves element geometry. It must update live during artboard drags for arrow routing.
- **Live routing:** A* elbow router (draw engine / annotations) with artboards as obstacles, running per frame while dragging; settle animation 160 ms; reduce-motion jump.
- **Mode-aware rendering** in the annotations layer: Preview full; Edit quiet (opacity on paper only, text contrast ≥ 4.5:1, `pointer-events: none` passthrough); hidden (⇧P, persisted per user?); Present never.
- **Per-user preferences:** last sticky colour / ink, Recent stickers (synced per account or local), annotation visibility.
- **Sync / permissions:** Can comment = read-only on the annotation layer (enforced in hub, not just UI); stamps count per person (identity from presence); vote ballots hidden from others until the end (needs server-side secrecy or at least non-broadcast); the timer runs server-side.
- **Comment ↔ sticky conversion:** cross-store transaction (annotations.json ↔ comments store) with Undo; thread anchor = the arrow target element or the sticky position; author preserved.
- **AI verbs:**
  - `read-annotations` scoped to a selection + target outline.
  - `annotate` gains: set resolved, place status stickers (pack sticker ids), author ai on arrows, bound ends.
  - Locked items untouched (exists).
  - One undo step covering design change + resolves.
- **⌘K index** of annotation tools, templates, resolved-actions, Start a vote.
- **LOD renderer** at < 25 % zoom (mosaic, counts, hover cards).
- **Video:** link sticky to the timeline (07 Video); markers in the timeline track; opacity by playhead.
- **Export:** `includeAnnotations` disabled for print formats (PDF for print, etc.); "Not printed" overlay is editor-only.
- **FigJam import:** existing `--from-figjam` path → UI entry in Import from Figma…; wrap in one section; widgets rasterised; summary toast with Undo (one transaction).
- **Sticker assets:** bundled `apps/studio/stickers/<pack>/manifest.json` (keywords, author, attributionUrl, license). A picked sticker is re-uploaded as a project asset (`assets/<sha8>.png`, as the canvas did). Total 139 (80 + 24 + 15 + 20). Stamps are vector glyphs, not assets: need a glyph set + tone mapping.

### 7. Dependencies
- **04 Modes** (Preview / Edit / Present switch, toolbar morph, Preview bar, Present behaviour), **14** (stable element ids, artboard moves, ⇧⌘L semantics, ⌘G collision), **10 Share and Collaboration** (roles, presence colours, Ask to edit), **03 AI Chat** (scope chip, inline question, chips), **09 Export** (Include annotations, print), **07 Video Editing** (timeline markers), **12 Import and Assets** (Figma / FigJam import, paste/drop media), **11** (⌘K, Layers tab in left panel), comments (C/app.jsx:5429).

---

## Cross-cutting notes

### Contradictions
1. **Kit header vs labels.** The kit header says ANNOTATE_TOOLS "… Stamp E …" and comments "Stamp a filled disc"; the actual `ANNOTATE_TOOLS` label is "Stickers" (id `stamp`). CONTRACT §2 says **Stickers (E)**. 15 also uses "Stamps" for the vote-stamp sub-feature. Implementation: tool label "Stickers", internal id may stay `stamp`, but "stamp" must mean only the vote stamps in UI copy. Fix the kit header comment.
2. **Pack order.** CONTRACT §2 lists packs "FigJam Doodle · Life Style · Opposing Thoughts · Project status"; 15's gallery orders Project status first. Pack display names also differ from manifests ("Project status stickers", "FigJam Doodle Stickers", "Pelin ŞENOĞLU" vs canvas "Pelin Şenoğlu"). Decide order + display-name trimming.
3. **Kit swatches vs 15.**
   - Kit `SwatchPop` for Marker shows Marker · Highlighter only and the 5 sticky colours as inks (default ink "coral").
   - 15 draws Marker · Highlighter · **Eraser**, inks Ink (black, default) / red / amber / green / blue + "+4".
   - Kit sticky swatches have no "+5" overflow.
   - The kit needs updating, or 15 wins (it cites the shipped palettes).
4. **⇧⌘G and ⌘G by mode.**
   - Edit: ⌘G = frame selection alias, ⇧⌘G = remove frame (CONTRACT §2).
   - Preview: ⌘G = Group, ⇧⌘G = ungroup (15 an-today).
   - Today ⇧⌘G = Changes (git) panel; v2 must re-home or drop that shortcut.
   - Same physical keys, mode-dependent meaning: acceptable but must be documented in "?" (all shortcuts).
5. **⇧⌘A.** v2 = Select all annotations (CONTRACT §1, 15); today = Assistant (N-only). Assistant moves to the AI chat panel (no key given in v2 other than ⌘/).
6. **I key.** v2 I = Image (opens Assets). CONTRACT §7 says Assets "Menu › View › Assets and ⌘K open it (no key)". 14 shows I switching the left panel to Assets. That is a de-facto key; reconcile wording. Today I = Highlighter.
7. **S key.** Today S = Design system view and ⇧S = Section; v2 S = Section and the DS view loses its key (13 adds no key). Today E = Eraser → v2 E = Stickers (Eraser keyless inside Marker). Today B = Pen → v2 P.
8. **Token names.**
   - 13's Advanced CSS and 14's words→CSS table write `--page`, `--ink`, `--accent`, `--link`, `--radius-m`, `--radius-round`, `--space-24`, `--shadow-resting`, `--type-display`.
   - The repo's DS template NAME contract (DDR-043: `--bg-0..4`, `--fg-0..3`, `--accent*`, `--dur-*`) and existing `colors_and_type.css` files use different names.
   - The generator must either adopt new names (breaking existing systems / critics / keeper) or map designer names → contract names. **Needs a decision.**
9. **Counts in 13.** The hero says "6 type styles", but the Studio Type section draws 8 rows (Display, Heading, Title, Body, Small, Caption, Link, Numbers). The Advanced tree says `preview/` "38 specimen pages", while migration says "42 specimen pages fold into 7 sections" (different systems; fine, but double-check). The Signs header says "12 wordmark glyphs" but 7 are drawn (sample).
10. **"Remove" vs "Move to trash".** 14's artboard menu uses "Move to trash ⌫"; the object menu uses "Remove ⌫"; CONTRACT §2 says "⌫ removes (⌘Z and Version history bring it back)"; CONTRACT §7 says things are "moved to the trash, never deleted". Do removed objects inside an artboard go to Trash or only to undo/history? Define it.
11. **Linked library access word.** 13 ds-many-linked uses ShareCluster `access="Can view"`, which is CONTRACT §6's people-permission word, for a *project-level read-only library canvas*, even though Jonas presumably can edit the junior project. This overloads the access status; a distinct state may be needed.
12. **"Auto" vs "Space between".** 14 ed-lay-auto's Gap menu has "Auto · space between"; ed-inspector has a separate Spacing seg "Packed | Space between". Two controls for one CSS property. Pick one.
13. **Inspector kind chip semantics.** ed-ab-select chip "Web page" (artboard kind) vs ed-ab-arrange / tidy chip "Fixed size" (a height mode). The chip should mean one thing.
14. **an-convert scene mismatch.** The selected sticky is Tereza's "Photo feels small next to the headline", but the resulting thread is "From Jonas's sticky … Mobile: button above the fold?". Spec intent: the thread carries the converted sticky's words + author.
15. **Print export copy.** an-print says "Print files never carry them — pick PDF for a review copy." while the selected format is "PDF for print". Needs a clearer distinction (e.g. "PDF for review").
16. **Can comment and AI.** an-viewer renders no AI panel (`ai={<Fragment/>}`). It is undecided whether Can comment loses AI entirely; CONTRACT is silent.
17. **Resolved stickies.** an-vs says resolved stickies are "struck through in place, kept", but ⌘K offers "Show resolved stickies", which implies they can be hidden. Define the hide state for resolved items.
18. **Annotation file format in docs.** CLAUDE.md's runtime-state taxonomy lists `*.annotations.svg` as VERSIONED, while DDR-242 / 15 / repo files use `.annotations.json`. New element types land in JSON; update the taxonomy doc and the four lists if names change.
19. **Edit-mode annotations vs ⇧⌘L.** CONTRACT §2: ⇧⌘L locks objects in Edit, annotations in Preview. With annotations visible (quiet, click-through) in Edit, ⇧⌘L in Edit must never hit a quiet sticky. Consistent with click-through, but worth an explicit test.

### Ambiguities / undrawn
- **13:**
  - The pinned row's empty state ("Make a design system") and how the row menu opens (click? chevron? right-click?) are undrawn.
  - ↵ conflicts in the row menu ("Open the Design system ↵" vs "↵ switches").
  - What follows "Switch to Warm paper" (presumably the Update N canvases review).
  - Who may edit the DS canvas in a project (co-edit of the same token not drawn; 13 shows "nothing locks" for different tokens only).
  - Whether the DS canvas appears in "N canvases" counts and in Export / Share.
  - How Tereza's "older Maude" coexists (files must keep the old schema).
  - Where "Reveal in Finder" goes in cloud/browser.
  - Light/Dark of *components* when Dark doesn't follow.
  - Interaction between per-canvas pinned DS versions and AI generation (which version does AI use on a left-out canvas?).
- **14:**
  - Artboard **Kind**, **Theme** (DS default / Light / Dark / Follow chrome), Print orientation / bleed, Fit just this artboard, Reset position, Open Timeline, artboard Lock / Hide: where do they live in v2? None are in the drawn artboard menu or inspector.
  - CSS Advanced mode's ~33 raw properties + custom attribute rows: only CSS / tokens / id are drawn.
  - Co-edit lock release timing and how AI ownership interacts with human soft locks.
  - Undo history: is clicking a row a jump (multi-step undo)?
  - "Select matching (same style)" definition.
  - Copy / paste properties scope.
- **15:**
  - The vote's entry point is only in meta (right-click › Start a vote… / ⌘K); a non-editor's view of a vote is undrawn.
  - Stamps for Can comment are excluded (stamps need Can edit), which makes voting editor-only. Intended?
  - Recent stickers per device or per account.
  - The Edit-mode "Turn into a comment" path.
  - Whether stickies placed in Edit (via N) are possible without leaving Edit: no, the key switches mode.

### Easy to forget
- `--guide` magenta token (14) is a DS addition; white chip text 5.4:1 both themes.
- The kit candidates listed by canvases:
  - CanvasesPanel `system.sub` (two-line row), Artboard mid-edge handles, an Insp with free blocks, the Uses link.
  - DsBar, Banner, Picker, Tick, Sel / Gap / Band / TokRuler / Bubble / Hint / AlignBar.
  - Local glyphs (dir-*, al-*, dist-*, tidy, token, rotate, unlink, ta-*, pt-*, boolean ops, speaker; list / group / dist / align-top / audio; flip; stamp glyphs).
- **Theme pinning:** user designs, sticker art and DS sections render in the light `.k-fixed` scope; the DS's own Dark is a section class, never the app theme.
- **Reduced motion everywhere:** reorder slot, arrow settle, toolbar morph, DS motion curves ("instant cut").
- **Accessibility strings:** VoiceOver line format, focus-ring halo, F6, tab order.
- **Undo:** ⌘Z must undo multi-canvas DS updates and AI runs as one step each, and include annotation resolves made by AI.
- **Copy rules (CONTRACT §4):** "Move to trash" as the dialog verb, Cancel secondary, one action per toast / callout, no "we"/"I", "AI" without article (13/14/15 comply).
- **AI buttons:** azure with a white spark (CONTRACT §7). Make three directions, Ask send in templates, and Remove background all carry the spark.
- **Sticker drop size constant:** `STICKER_DROP_SIZE = 160`. Placement changes from mid-view to follow-pointer.
- **Inventory "N" key collision:** today N = New board composer in the shell vs Sticky on canvas; v2 N is Sticky only (⌘N = New canvas). Remove the shell N binding.
