# UX audit of Maude v2 (rc.1) — brief for every critic seat

Repo root: `/Users/iagh/git/personal/maude/.claude/worktrees/lead-merge-2`. Only write your report file. Edit nothing
else: no code, no canvases, no other evidence.

**Read first:**
- **The rule source** (Michal's skill, binding): `plugins/design/skills/ux-patterns/SKILL.md` and `reference.md`. Rule IDs: UX-ACT-*, UX-HIER-*, UX-FORM-*, UX-NAV-*, UX-MOT-*, UX-TOK-*, UX-COPY-*, UX-CONT-*, UX-DLG-*, UX-DATA-*, UX-ICON-*, UX-SHAPE-*.
- **The evidence:** `.ai/plans/notes/v2-evidence/ux-audit-rc1/INDEX.md` (114 shots by task flow, "tried → happened", controls that did nothing) and `shots/<flow>/*.png`. They are headless Chromium shots of the real v2 studio at product `20b4215eb`. Read the shots that matter for your lens; you don't need all 114. Aim for ≤ 40 images.
- **Michal's own 20 findings** (already being fixed or decided, so do NOT re-report them as new):
  - `.ai/scenarios/maude-v2/lead/brief-michal-rc1-findings.md`;
  - his screenshots in the folder that brief names.
- **The Inspector rules already written** (IR-1..17, options O1–O4): `.ai/scenarios/maude-v2/lead/inspector-ux-rules.md`. Comment on them only if your lens disagrees.
- **The product contract** (words, menu tree, keys): `apps/studio/client/v2/contracts/CONTRACT.md`.

**Judge by task flow.** The flows are:
1. create a project;
2. the first canvas;
3. editing: text, shapes, images, path, frames;
4. the Inspector;
5. Preview vs Edit;
6. comments;
7. the AI chat;
8. the left panel and Assets;
9. Share and its Advanced section;
10. the design system;
11. ⌘K, the shortcuts sheet, Settings and menus.

Find:
- **(a) Too much:** duplicate controls or menu items, overloaded panels, things open by default that shouldn't be.
- **(b) Missing:** what a designer expects from a Figma/Framer-class tool and can't find or do.
- **(c) Unclear naming.**
- **(d) Preview vs Edit inconsistencies:** keys, selection, tools.
- **(e) Broken:** a control that does nothing, or a state that's wrong.

Every finding cites **a UX-* rule ID** (or "no rule: <proposed rule in the skill's style>") **and a shot path**.

**Severity:**
- **blocker:** breaks a core task or loses work.
- **before-merge:** a designer would hit it in the first hour.
- **rc-patch:** polish that can ship in an rc patch.

Write `.ai/plans/notes/v2-evidence/ux-audit-rc1/critics/<your-seat>.md`:
- a findings table with columns `id | flow | shot | rule | kind (a–e) | severity | what's wrong | recommended fix`;
- then a "taste decisions" list: only where the answer depends on Michal's taste, 2–3 options each, with your pick;
- then a fenced ```json {"blockers": N, "before_merge": N, "rc_patch": N}``` block.

Keep it tight: no essays, max ~40 findings. Return the report path plus your top 5.
