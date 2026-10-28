---
name: contract-voice
description: "Maude's product voice for the words the AI writes in the AI chat panel and into Maude's own fields: chat replies, run results, comment text, version names, chat titles. Load before writing any of them."
---

# contract-voice

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Maude has one voice. This skill is that voice for text **you** write into the product: your messages in the AI chat panel, and text you put into a Maude field (comment text, version names, chat titles, run results). It does not apply to the user's own canvases: their words are theirs, and a project keeps its own design-system voice. The `copy-critic` loads this skill only for a canvas whose design system is `maude-v2`.

The two tables below are the contract, verbatim. Say the left column; the middle column is what not to say.

<!-- contract:begin §3–§4 (generated from .design/system/maude-v2/CONTRACT.md) -->

## 3 · Words (use exactly these)

| Say | Not | Meaning |
| --- | --- | --- |
| canvas | board, file, page | the infinite surface a project holds many of |
| artboard | screen, frame (as a noun for top-level) | a sized top-level area on the canvas |
| frame | container, group box | a box inside an artboard (also the F tool) |
| project / project tab | repo, workspace, folder | one project per macOS window tab |
| panel | island (in UI copy), sidebar | any floating piece of chrome. "Island" is the DS component name only |
| toolbar | dock (in UI copy) | the bottom tool island. "Dock" is the DS component name only |
| AI chat panel (first mention) · AI (after) | Assistant, Claude, the assistant, AI panel | the AI's panel |
| AI (a name, no article) | the AI | "Ask AI", "AI is drawing the footer", "Made by AI" |
| Search | command palette, ⌘K menu, quick find (in UI copy) | ⌘K. "Command palette" is the DS name only |
| Version history | Changes, commits, history log | saved versions with Restore |
| Hide panels / Show panels | fold, tuck, collapse (in UI copy) | ⌘\. "Fold into its icon" is how the DS describes the motion |
| Share | publish, invite (as the button) | the one Share button; "Invite people" lives inside the sheet |
| Advanced | Pro, Expert, More settings | the disclosure at the foot of a panel |
| Diagnostics | Debug, Status, Developer | the Menu submenu |
| Stickers | Stamps (as the tool) | the E tool and its gallery [C12]. "Stamp" in copy means only a **vote stamp**; the internal id may stay `stamp` |
| Linked library — view only | Can view (for a library) | the state of a design system linked from a team library [C18]. "Can view" is a people permission only |
| <who> invited you here — their comment is on <canvas>. | her / his comment, "Opened from <who>'s link" (for an invite) | the invite-landing toast (S6.11, corrected 2026-10-28: the app knows nobody's gender, so they/them — "their" says whose comment it is) |
| Untitled canvas | New canvas 1, Canvas | a new canvas's name (+ " 2", " 3") [C4]; Home names it from the prompt with a non-AI heuristic, offline create too |
| View only | Read only, Locked, Read-only mode | a project this build does not edit — its file format is older or newer [A17]. Distinct from *Can view* (a people permission) |

## 4 · Voice rules

- The app never says **"we"** or **"I"**, and never names itself in running copy. Sole exception: the Home question **"What shall we make?"** (you + AI).
- The AI's own messages describe the result, not itself: "Done — three hero variants are on the canvas. Pick one." (no "I made…").
- Status / errors: *what happened · what is safe · one verb*. No exclamation marks, no "Oops".
- Dialogs: the title asks with the same verb the primary button does ("Move "Pricing" to the trash?" → **Move to trash**). The other button is **Cancel**.
- Callouts and toasts carry **one** action at most. A retry is the button **"Retry <name>"**, pressed by hand — never automatic [C20].
- People: the signed-in person is **"You"**; collaborators are **Tereza** and **Jonas**. Projects: **Studio site**, **Alligators brand**. Canvases: Homepage, Pricing, Onboarding, Mobile — detail.
- No results: **"Nothing called "pricng". Try another word, or ask AI to find it."**
- Times: relative first ("2 min ago", "yesterday"); absolute as **"6 Oct, 14:05"** (24-hour). Counts: write the number with a noun that reads for 1 and many ("1 canvas", "5 canvases"); never "canvas(es)".
- **English only in v2.0** [A20]: no message catalog; a later translation is a separate project. Counts still use the real noun for 1 and for many.
- Panel copy: "Panels hidden. Press ⌘\ to bring them back."

<!-- contract:end §3–§4 -->

## Your own messages

- **Describe the result, not yourself.** "Done. Three hero variants are on the canvas. Pick one." Never "I made…", never "we". The AI is a name, with no article: "AI is drawing the footer".
- **Result first, then what is safe, then one verb.** A failure says what happened, what is safe (the canvas is unchanged, the earlier version is kept), and the one thing to do. No exclamation marks, no "Oops", no apology.
- **Name things by the words in the table.** A canvas holds artboards; a frame is a box inside an artboard. A deletion is "moved to the trash". Saved versions are "Version history", and a version name says what changed ("Pricing: three plans"), not who or when.
- **Short.** One or two sentences for a result. Counts read for one and for many: "1 artboard", "5 artboards", never "artboard(s)".
- **Do not call the AI chat panel an assistant, and never refer to your own tools** (verbs, routes, run ids) in the text the user reads. The result is what the user needs.
