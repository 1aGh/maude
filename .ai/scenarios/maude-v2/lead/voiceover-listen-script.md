# VoiceOver listen — rc soak (#162, V2-8.7)

About 15 minutes in the current rc on the Mac with Maude, in any project.

- **Turn VoiceOver on and off:** ⌘F5.
- **VO keys** = ⌃⌥ (Control+Option). VO+→ moves to the next item; Tab moves focus.
- **For each step, note:** does it say this, does it say it twice, or does it say nothing?

The DOM side is already checked (318/318 states). This is about what you *hear*.

## 1. Canvas: text and frames (board 14 Editing)
1. Open a canvas with a text. Click into the canvas and press Tab until the text has focus.
   **Expect:** "Text, text. Press Return to type." A second Tab on the same text says it again; it is not silent.
2. Focus a frame with 3 children laid out in a row that sits among 6 siblings, for example the "Services" frame on a landing page.
   **Expect:** "Services, frame, 3 items, in a row — 4 of 6. Press Return to go inside."
3. Press Return, then Esc.
   **Listen for:** does it say where you are after going in and after stepping back out?

## 2. Status word in the Share cluster (top right)
1. Change something on the canvas.
   **Expect:** a quiet "Saving…" then "Saved", read **once**, without interrupting what you are doing.
2. Turn Wi-Fi off for a moment.
   **Expect:** "Offline" (or the offline word), once. Turn Wi-Fi back on and it should say it is back.

## 3. Toolbar and mode switch
VO+→ through the bottom toolbar and the mode switch.
**Expect names like:** "Select (V)" … "Component (⇧I)", "Edit — click selects and edits", "Preview — the design is live", "Present", "Share".
**Listen for:** any button that says only "button" with no name.

## 4. AI chat (new in rc.2+)
1. Ask the AI something small.
   **Expect:** the activity line ("AI is reading …", "AI is drawing …") read now and then, at most every ~10 s, and never the timer.
2. In the composer, type "/".
   **Expect:** "Slash commands" list.
3. Move to the conversation.
   **Listen for:** is each new AI message read once, twice, or not at all? This decides whether the feed becomes `role="log"`; it is an open call.
4. Advanced › Permissions: move through the options.
   **Expect:** each option's description read after its name, and "Skip every check — risky" clearly as risky.
5. On a Mac where Claude is not connected yet (optional), click Connect.
   **Expect:** "Step 1 of 2 · Installing Claude Code…" read, not a silent disabled button.

## Report back
For each number above, write one of:
- OK
- silent
- read twice
- wrong words: "…"

That's enough for me to fix.
