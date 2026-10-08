# D · Implementation inventory — 07 Video Editing · 08 Artboard Kinds · 09 Export · 12 Import and Assets

Source: `.design/ui/v2/{07 Video Editing,08 Artboard Kinds,09 Export,12 Import and Assets}.tsx` + `.meta.json`, `_video.tsx`, `_kit.tsx`, `system/maude-v2/CONTRACT.md`, `.ai/plans/notes/v2-feature-inventory.md` (INV §n), `v2-open-questions.md` (OQ). Spot-checked against code: `apps/studio/exporters/*`, `cli/commands/design.mjs`, `apps/studio/bin/*`.

Legend: **EXISTS** (today's feature, ref) → where it moves in v2 · **NEW** (not in today's app) · **PROPOSED** (drawn, flagged for Michal / OQ). Artboard ids in [brackets]. Quoted strings are verbatim copy.

---

## 07 · Video Editing (26 artboards, 8 sections)

Framing: Michal's triage decision — "Timeline only when a video artboard is selected". Timeline is an **island**, never a docked bar. Source of truth for the timeline = `_video.tsx` (shared with 08 `ak-video` and 09's filmstrip data).

### 1. Surfaces / components

**A. Timeline island (`Timeline` in `_video.tsx`)** — EXISTS as `TimelinePanel` (`P/TimelinePanel.jsx:1390`, bottom dock, ⌘⇧T) → MOVES to a floating island tied to the selected video artboard.
- Two sizes:
  - **Compact** (default): 900 px wide, centred under the selected video artboard's centre (clamped 16 px from window edges), `bottom: 80` (above the toolbar). A **notch** on its top edge points at the artboard. No track names, icon-only track labels. Header shows **Expand** button (`expand` glyph, title "Expand the timeline").
  - **Full**: edge to edge above the toolbar (`bottom: 80`); track names; zoom slider (− bar +, title "Zoom the timeline"); **Fit** button; **Compact** button (title "Make the timeline compact"); a top **grip** (title "Drag to make the timeline taller"); **Advanced** disclosure at its foot (hint "Frame numbers, codec, keyframes, the cut as code").
  - Size switch is a header button only — **no key** ([ve-deselect] rule "Expand · Compact — The button at the right of its header. No key.").
- Header (left→right): Play/Pause (title "Play — tap space" / "Pause — tap space"; pressed state when playing; optional drawn tooltip) · Loop toggle (pressed when on) · time "`0:04 / 0:15`" (tabular; can show "0:07 + 2 frames" while stepping, or timecode in Advanced) · name with video glyph ("Hype trailer · Reels") · **status chip slot** · spacer · tools: **Split at the playhead · S** (scissors), **Add text**, **Captions from speech**, **Add music** · divider · size controls.
- Status chips seen: "Kept open" (pin glyph, [ve-deselect] step 4) · "AI is cutting" (spark, [ve-ai-scrub]) · "Made by AI · 14 shots" ([ve-ai-proposal]) · "Shared by 3 formats" (link glyph, [ve-formats]) · "3 clips still preparing" (sync glyph, [ve-footage]) · "Sound on" with a 3-bar level meter ([ve-play]).
- **Four tracks, fixed order top→bottom = what covers what: Text · Graphics · Video · Music.**
  - Label column: icon (+ name and a per-track button in Full): Text/Graphics → eye ("view"), Video/Music → volume; Video shows `mute` glyph when every clip is muted.
  - Text track: 24 px, or 48 px with **two lanes** (titles lane 0, caption words lane 1). Items: `title` (type glyph), `word` (caption word, no glyph), `cue` (captions glyph). States: selected, highlighted (word being spoken), editing (caret), AI-made, peer-owned (Tereza), locked, cut (struck).
  - Graphics track: items (`image` glyph) e.g. "Logo v rohu", "alligators.cz/nabor", "Kilián · obránce, 2. sezóna".
  - Video track (46 px compact / 52 full): clips as filmstrip thumbnails (photo repeated sideways) + name label; optional duration badge ("2.4 s"), mute badge (title "No sound"), progress bar, trim handle (l/r). Clip states: `off` (waiting for another device — clock glyph), `prep` (preparing, %), `ghost`, `lift` (dragging, translated), `gap`, `dim`, `land` (AI shot landing), `ai`. **Joins** = a dot between clips (transition glyph), selectable.
  - Music track (30 px): waveform, label ("Hype instrumental · 120 BPM"), **beat ticks** across the lane (every 4th = bar, taller), **duck curve** (volume line dipping under speech) with label "Lower under speech".
  - Ruler: m:ss ticks auto-stepped (1/3/5/10/30/60 s by span) or frame numbers (Advanced), **Poster** flag at poster time, **markers** (flag glyph + label), loop range band (ruler + lane tint).
  - Playheads: yours (azure line), **AI's edge** (spark-coloured line with tag "AI"), **peer playhead** (thin sky line, Tereza).
  - Fold: a track can fold to a 10 px bar labelled "Text · 18" / "Graphics · 6" ([ve-long]).
  - Empty-row hints: Video "✦ Shots land here as AI places them." · Music "No sound in this video. **Add music** or ask AI for a track".
  - Popovers anchored to a clip/join render above lanes, never clipped (`pop` slot).
- Hidden with ⌘\ like any panel.

**B. Video artboard on canvas** — EXISTS (kind="video" artboards, `/design:reel`) → v2 visuals:
- Label carries length: "Hype trailer · Reels · 0:15"; video kind glyph; size tag "1080 × 1920" when selected.
- Picture = **poster frame** (NEW); a centred play button plays **in place, with sound**.
- On-artboard overlays: titles, live captions (current word underlined), safe-zone bands (Reels: "Profile row" top 11 %, "Caption and sound" bottom 20 %, right-side band), scrub bar (play/pause + progress + "0:07 / 0:30"), offline overlay "Waiting for Jonas's Mac", AI working tag ("AI is watching footage", "AI is cutting · 7 of 14") placed **below** the artboard, no AI cursor.
- Drop zone over artboard while dragging clips: chip "Or drop here — adds at the end".

**C. Video inspector (`VideoInspector`, shared with 08)** — EXISTS partly (`ArtboardKnobs` kind/size) → NEW row set: **Size** (select "Reels 9:16") · **Length** (clock, "0:15"; follows clips) · **Poster frame** (thumb + time + **Change**) · **Sound** (fill-style chip "Hype instrumental 80 %" or "None yet") · **Export** (button "MP4"). Advanced: `kind video · fps 30 · durationInFrames 450 · codec h264 · poster frame 120`. Frame rate lives only under Advanced.

**D. Clip inspector (`ClipInspector`, local in 07)** — EXISTS as `P/ClipInspector.jsx` (tabs Speed/Audio/Crop/Grade/Text/Transition, opened via "Adjust…") → MOVES into the right inspector on clip select, flattened: **Length** · **Speed** ("1×") · **Volume** (slider 70 %) · **Framing** (select: "All formats" / "Follows #1") · extras. Advanced: `src`, `in`, `out`, `track subject #1 · 98 %`. Grade/Crop tabs not drawn → presumably Advanced (gap, see cross-cutting).

**E. Title inspector** ([ve-text]) — EXISTS partially (+ Title, ClipInspector Text tab) → Font ("Club Display") · Colour ("Club green") · **Motion** grid of 6 animated presets: None · Fade · Slide up · Pop · Type on · Per word · Length ("2.2 s"). Advanced: `enter slide-up 12f · easing ease-out · exit fade 8f`. On-artboard selection label "Title · Slide up". Motion presets are NEW as a designer picker.

**F. Captions inspector** ([ve-captions]) — NEW: Font · Highlight (colour "Club yellow") · Position (Top/Middle/Bottom) · Words at a time (1 / 3 / Line) · **Also as a file** (switch). Advanced: `srt video-nabor.srt · lang cs · maxChars 32`.

**G. Transcript panel** ([ve-captions]) — NEW, occupies the **left panel slot** (island): header "Transcript" + source clip "Rozhovor · Kilián"; paragraphs with timestamps ("0:03", "0:08"); current word highlighted; struck words; tip "Struck “Ehm…” — cut 0.4 s from the interview"; foot "Select words and press delete to cut them. Fix a misheard word by typing over it." How it opens is not drawn (likely the Captions-from-speech tool or selecting caption words) — ambiguity.

**H. Music inspector** ([ve-music]) — NEW mostly: Volume (80 %) · **Lower under speech** (switch) · **Snap to the beat** (switch) · Fade in · out ("0.5 s · 1.5 s") · Song (**Change…**). Advanced: `bpm 120 (detected) · duck −12 dB · 200 ms · gainDb −2`.

**I. Transition picker popover** ([ve-transition]) — EXISTS (seam "+", transition chip; transitions Cut/Fade/Slide/Wipe/Flip/Clock wipe) → NEW presentation: anchored at the clicked join; title "Oslava → Logo"; 6 tiles with **hover-to-play previews using the two real shots**; Length slider ("0.5 s"); foot "Hover a tile to play it."

**J. Re-frame island** ([ve-reframe]) — NEW: title "Frame “Touchdown” for [Reels 9:16 | 16:9 | 1:1]"; full source frame with subject track box "#1 · followed", motion path, crop window tagged "Reels 9:16" (draggable); foot: **Follow a subject** switch + subject chip "#1 ⌄" · **Reset** · **Done**.

**K. Formats (linked versions)** ([ve-formats]) — NEW: inspector "Formats" list rows with link glyph: "Reels 9:16 · this one", "16:9 · 1920 × 1080", "1:1 · 1080 × 1080", "+ Add a format"; **Safe zones** select ("Instagram Reels"); **Make an unlinked copy** (duplicate glyph). Canvas: link-line glyphs between linked artboards; unlinked copy tag "Unlinked copy — its own cut". Advanced: `linkedTo recap.edit · framing per format`.

**L. Fit/Fill popover for vertical clips** ([ve-fit-fill]) — NEW: "IMG_5120 is vertical — how should it sit?" options **Fill** ("Crops to the player, follows the player") · **Fit** ("Whole picture, dark bars") · **Blur behind** ("Whole picture, soft sides"); checkbox "Same for every vertical clip". Asked once at the clip.

**M. Other takes popover** ([ve-ai-adjust]) — NEW: "Other takes · caaftv-td-run"; 3 take tiles with in–out ranges ("0:01–0:03.5", "0:03–0:05.5", "0:04.5–0:07"), AI's pick marked "✦ AI's pick", others "2.5 s"; foot "Click a take to swap it in. Same length, same beat."

**N. AI chat panel, video flavour (`VeAI`)** — EXISTS (ChatPanel) → v2 03 geometry: title ("Recap from 12 clips"), New chat (+), hide (chevron); scope chip "◆ Recap · Reels"; attachment card **ClipsAttached** "12 clips · 1:20 of footage · from Assets › footage"; progress card "Watching 12 clips… 7 done" with per-clip thumb grid (✓ done, spark = now, dimmed = waiting) and "found" list ("0:03 Touchdown run — caaftv-td-run", "0:02 The hardest hit — caaftv-tackle", "0:05 Flag run-out — promo-runout-vlajka"); Working line with **Stop**; Result card (what changed + **Undo** · **Keep going**); suggestion chips; send button azure + white spark.

**O. Full-screen preview** ([ve-fullscreen]) — EXISTS partly (Present mode) → NEW video presentation: only the video, top-left format switch (Reels 9:16 / 16:9 / 1:1), "esc Back to the canvas", transport bar: pause · loop · "0:10 / 0:15" · scrub (with loop in/out ticks) · volume · captions toggle. Entered via **Present** in the Share cluster mode switch with the video selected; loop carries over.

**P. Export sheet for video** ([ve-export]) and **render states** ([ve-render]) — see 09 (same model). 07-specific bits: Scope select "This canvas · 4 artboards"; "Formats · 3 of 4 ticked" with tickable tiles (Reels 9:16, 16:9, 1:1, "16:9 copy · 0:15" unticked); Format MP4/GIF/Sound only + hint "Sound only makes one file — the formats share their sound."; Quality 1080p/4K; Captions Burned in/As a file/Both/Off ("Both"); Where: "In the cloud — About 2 min. Keeps going if this Mac sleeps." / "On this Mac — About 6 min. Keep this window open until it's done."; Advanced + summary "3 videos + 1 caption file · about 48 MB"; primary "Export 3 videos"; title "Export “Recap”".

**Q. Exports panel + ring** ([ve-render]) — EXISTS as Export center (`C/export-center.jsx`: badge, toast, panel) → MOVES into the Share cluster as an **Exports icon** with a progress **ring**; click opens the Exports panel top-right under it. Panel header: export glyph · "Exports" · folder button ("Open the Downloads folder") · fold chevron ("Fold into the Exports icon"). Rows: "Recap · Reels — Ready" (check), "Recap · 16:9 — Rendering… 64 % · about 1 min" + bar, "Recap · 1:1 — Queued" (clock). Foot "In the cloud — keeps going if this Mac sleeps or the window closes."

### 2. User flows

1. **Summon** [ve-none→ve-select]: nothing selected → no timeline, no hint. Select video artboard → compact timeline slides out of its bottom edge (motion cue), notch at it; inspector shows video rows.
2. **Switch** [ve-deselect]: select another video → timeline slides over to it; **each video keeps its own playhead** (Reels stays at 0:04).
3. **Deselect**: select non-video (feed post) or **esc** → slides back into the artboard (compact or full alike); nothing else on canvas moves.
4. **Keep open**: ⇧⌘T → stays whatever is selected, showing the last video, status "Kept open"; ⇧⌘T again hides. Mirrors Menu › View › Advanced › "Keep timeline open ⇧⌘T" (checked).
5. **Drop footage** [ve-drop]: drag clips from Finder or Assets; over timeline → insert line + tip "Drop 3 clips at 0:09 · the video grows by 0:20"; over artboard → appended at end. Image tool (I) picks clips without dragging.
6. **Trim** [ve-trim-split]: drag a clip edge → tip "Touchdown · 2.4 s · −0.6 s · video 0:14"; rest closes up (ripple); **video length = sum of clips**; a fixed Length in the inspector trims the end instead.
7. **Split**: **S** at playhead (⌘B still works) → toast "Split Oslava at 0:10." [Undo].
8. **Move** [ve-move-transition]: drag clip → lifts, insert line + "Drop before Touchdown"; old place closes; length unchanged.
9. **Transition** [ve-transition]: click join dot → picker; hover plays tile; pick + length.
10. **Title + motion** [ve-text]: Add text → title item; inspector Motion preset.
11. **Captions from speech** [ve-text]: header tool → words land one by one on text lane 1; toast "Captions added — 15 words from the interview." [Undo]; spoken word highlights during playback.
12. **Edit by transcript** [ve-captions]: select words, delete → clip cut there (0.4 s), captions follow, video 0:30 → 0:29; type over a misheard word to fix it.
13. **Music bed** [ve-music]: Add music → beats detected; Snap to the beat; Lower under speech auto-ducks.
14. **AI cut** [ve-ai-cut→ve-ai-adjust]: user asks "Make a 30 s recap from these 12 clips" with 12 clips attached → AI creates/targets a new "Recap · Reels · 0:30" artboard → watches clips (progress in words, liked shots) → states left-outs with reasons → places shots on beats one by one (landing animation, island "Placing shot 7 · Tackle 2 / caaftv-tackle, 0:03–0:04.5 · on the beat at 0:11.5"); user can scrub placed part; AI edge never moves user's playhead; **Stop keeps what's placed** → Done: no accept step; Undo removes all; chips "Use another song" · "Shorter" · "More touchdowns"; "Use them anyway" restores left-outs → hand edits (swap take) are normal edits; ⌘Z undoes your edits first, then AI's (AI run = one undo step, CONTRACT §7).
15. **Formats** [ve-formats/ve-reframe]: Add a format → linked artboard sharing the cut; trims/titles propagate; framing + text position per format; Make an unlinked copy → own cut; per-clip re-frame per format with subject following.
16. **Play** [ve-play]: tap Space plays/pauses with sound; hold Space+drag = Hand; I / O set loop range; ←/→ step a frame, ⇧←/→ a second (time shows frames).
17. **Full screen** [ve-fullscreen]: Present → video only; switch format live; esc back.
18. **Export** [ve-export→ve-render]: ⇧⌘E with nothing selected → Scope This canvas; tick formats; render cloud/Mac → ring + Exports panel → done toast or partial toast.
19. **Edge** [ve-footage]: clip on Jonas's Mac → "Waiting for Jonas's Mac" (quiet); 4K .mov → "prep" clips with %; edit continues.
20. **Edge** [ve-together]: Tereza edits a caption word while you trim; her word is locked to her until she leaves it.
21. **Edge** [ve-long]: 40 clips/4:12 → zoom out, names hidden until hover, fold tracks, markers, ⌘K finds clip by name, ⌘+/⌘− over timeline zoom it, grip → taller.
22. **Edge** [ve-fit-fill]: vertical clip on 16:9 → ask once; all-mute video → music empty hint.
23. **Advanced** [ve-advanced]: open foot disclosure → ruler in frames, keyframes on items, easing curve editor + render settings + EDL/code panels open beside.

### 3. States & copy (verbatim)

- Notes: "A video artboard looks like any other until you pick it." · "Select it, and the timeline slides out of its bottom edge." · "One key, one meaning." · "The video is as long as its clips."
- Rules box "The timeline, in five rules": "Select a video artboard — The timeline slides out of it. Another video takes it over." · "Select anything else · esc — It slides back in — compact or full." · "⇧⌘T — Shows or hides the timeline. Shown this way, it stays open." · "Expand · Compact — The button at the right of its header. No key." · "⌘\ — Hides it with the other panels, like any panel."
- Drag chip "caaftv-mixzone-8s.mp4 and 2 more"; tip "Drop 3 clips at 0:09" / "the video grows by 0:20"; "Or drop here — adds at the end".
- Toasts: "Split Oslava at 0:10." [Undo] · "Captions added — 15 words from the interview." [Undo] · "3 videos are ready." [Show in Finder] · "Exported 2 of 3 — Recap · 16:9 didn't render. The connection dropped at 0:21; your edit is safe." [Retry].
- AI: "Watching 12 clips… 7 done" · "Watching archiv08-akce-1 — 8 of 12" · "Watched all 12. Left out 3: archiv-orange-nastup and promo-kabina are too dark; dron-areal-klesani is shaky." · "Placing shots on the beat — 7 of 14" · "Done — Recap · Reels is a 0:30 cut: 14 shots from 9 of your 12 clips, on the beat of Hype instrumental." · "Left out: … ." + "Use them anyway" · hero copy "Left out 3 — two too dark, one shaky".
- Hero [ve-ai-cut] (close-up, illustrative — NOT a UI surface, but its three claims are product requirements): "Every cut on a beat." / "The best seconds of each clip." / "Left out, with a reason."
- Footage: clip label "Dron klesá · waiting for Jonas's Mac"; inspector "Your edit is safe. It plays once the file arrives."; Advanced `status waiting · on Jonas's Mac`.
- Together: "Tereza is fixing a caption".
- Render panel: "Ready" · "Rendering… 64 % · about 1 min" · "Queued"; cloud foot as above; partial caption: "The full render log stays in Menu › Diagnostics › Logs."
- Advanced: foot mono "30 fps · frame 354 of 900 · 00:00:11:24" + seg Timecode/Frames; Easing panel "Easing · NAUČÍME TĚ HRÁT" chip "y · opacity", curve with two handles, labels "frame 330"/"frame 342", rows `easing cubic-bezier(0.22, 1, 0.36, 1)`, `y 48px → 0px`; Render settings `fps 30 · durationInFrames 900 · codec h264 · webm · gif · bitrate 12 Mb/s (auto) · colour Rec. 709`; "The cut as code" seg EDL/Code, JSON EDL excerpt, "video-nabor.edl.json · **Open in code view**".

### 4. Keys & menus

- ⇧⌘T Keep timeline open (Menu › View › Advanced). Today ⇧⌘T toggles the dock (INV §19) — meaning shifts.
- Space: tap = play/pause selected video; hold = Hand (always). Today Space plays only when timeline focused.
- **S** split at playhead (NEW key) + ⌘B (kept).
- I / O loop in/out; ←/→ frame, ⇧←/→ second (EXISTS while timeline focused, INV §13).
- ⌘+/⌘− zoom the timeline when pointer over it; ⌘K finds a clip by name.
- esc deselect → timeline slides in; esc leaves full screen.
- delete on transcript words cuts.
- Menu › File › Assemble clips into a video (CONTRACT §1).
- ⌘\ hides timeline with panels.

### 5. Classification

- EXISTS→moves: TimelinePanel (dock→island, ⌘⇧T semantics), ClipInspector (dialog tabs→inspector rows), transitions (6, same set), split ⌘B, ←/→ stepping, loop, mute, volume, comment pins on clips (not drawn in v2!), "+ AI clip"/Generate ✨ (not drawn here; see 12 "Generate a clip"), `/design:reel` (AI cut is its UI), footage analysis sidecars `*.footage.json` (footage-analyst), EDL (`<slug>.edl.json`, footage-director), cloud render (`apps/render` maude-render), export MP4/GIF/WebM, Remotion code view, keyframe markers.
- NEW (OQ lists): word-by-word captions from speech + caption styling + .srt, edit-by-transcript, beat detection + Snap to the beat, music ducking ("Lower under speech"), poster frame, linked formats + per-format framing + subject tracking/follow, safe zones on video, Sound-only export, 4K preset, Fit/Fill/Blur-behind for vertical clips, compact/full island with notch, per-video playhead memory, AI cut live placement UI (watch progress, landing shots, AI playhead), Other takes, peer playhead/locking per caption word, track folding, markers, poster flag on ruler, hover-preview transitions, title motion preset grid, easing curve editor, transcript panel.
- PROPOSED: S split key; tap/hold Space split; ⇧⌘T semantics (CONTRACT §7 "proposed").

### 6. Backend / native / render needs

- Transcription → word timings (exists: `maude design transcribe`, whisper.cpp/ElevenLabs Scribe/Groq per Settings › Subtitles) → caption items model on the comp + srt writer; transcript-edit → compute cuts on the source clip (in/out splits) and re-time captions.
- Beat detection: BPM + beat grid from audio (`audio-search` exists for music search; beat detection NEW — e.g. aubio/essentia or ffmpeg-based onset), snap engine in timeline drag.
- Ducking: speech-region detection (from transcript) → gain envelope in the Remotion comp (`duck −12 dB · 200 ms`).
- Poster frame: stored per video artboard (meta), used for canvas thumbnail + export poster.
- Linked formats: shared edit model (`linkedTo recap.edit`) — one EDL/comp, N artboards with per-format framing + text position overrides; "Make an unlinked copy" forks the EDL.
- Subject tracking (#1 followed, 98 %): NEW vision pipeline (per-clip tracker → crop path keyframes per format). Could reuse footage-analyst for subject IDs; needs a tracker.
- AI cut streaming: `/design:reel` today writes an EDL at the end; v2 needs incremental shot placement events (shot n of N, beat time) streamed to the client, AI playhead position, "Stop keeps what's placed", whole run = one undo step, left-out reasons from footage-analyst `usable`/quality.
- Other takes: footage analysis "good moments" per clip → candidate in/out ranges of same length.
- Footage proxies ("footage/ keeps only light copies"; "3 clips still preparing") — EXISTS (`ingest-footage`, `probe-footage`, `smart-frames`); surface % progress per clip.
- Sync state per asset ("Waiting for Jonas's Mac") — hub/file-plane needs "exists on device X, not here" vs "no device has it" (shared with 12).
- Co-editing: presence per timeline item (peer playhead, per-word lock) over the sync/hub layer.
- Export: maude-render cloud vs local, captions burn-in vs sidecar, audio-only (mp3/wav/m4a?) render, 4K, per-format batch → see 09.
- Easing curve editor writes cubic-bezier to the comp source; Timecode/Frames toggle.

### 7. Dependencies

- 09 Export sheet + Exports panel + ring (shared); 08 video kind + VideoInspector + ak-video; 12 Assets (footage group, "from Assets › footage"), sync states; 03 AI chat panel anatomy (Result card, Working/Stop, chips, run list); 04 Present mode / mode switch in Share cluster; 14 Editing (undo history, AI run = one step, object keys); CONTRACT §2/§7.

---

## 08 · Artboard Kinds (19 artboards, 7 sections)

Words: picker groups by what you're making — **App · Web page · Social · Print · Video** — over **four kinds**: `digital` = "**Fixed size**" (App and Social both), `web` = "Web page", `print` = "Print", `video` = "Video". Never "Screen".

### 1. Surfaces / components

**A. New-artboard size picker (`SizePicker`, kit candidate)** — NEW (today: Artboard kind select in context menu + ArtboardKnobs preset select; Edit › Advanced ▸ New artboard list in CONTRACT) → opens with **F over empty canvas**, a menu-style popover **above the toolbar** (left ~518, bottom 84):
- Search field "Search sizes — “A5”, “story”, “1920”".
- **Recent** row: chips with kind glyph ("FB event cover", "Post 4:5", "A6").
- Groups, each: icon, title, **badge** (App/Social "Fixed size" with lock glyph · Web "Grows as you add" chevron · Print "mm, with bleed" · Video "Has a timeline"), "All N ›" / "Fewer" toggle; 3 top tiles shown, rest on expand.
- Presets: App — Desktop 1440 × 1024, Laptop 1280 × 800, Mobile 390 × 844, (Tablet 834 × 1194). Web — Desktop 1440 wide, Tablet 834 wide, Mobile 390 wide, (Laptop 1280 wide). Social — Post 4:5 1080 × 1350, Story 9:16 (still) 1080 × 1920, FB event cover 1920 × 1005, (Post 1:1, Link preview 1200 × 630, YouTube thumbnail 1280 × 720). Print — A4, A5, A6, (Letter 8.5 × 11 in, A3, A2, Business card 85 × 55 mm) + **Custom size…** "mm, any bleed" (only when expanded). Video — Reels 9:16 (moving), Landscape 16:9, Square 1:1.
- Tile = tiny shape picture (closed box = fixed; open fading box + chevron = grows; dashed inner = bleed; play mark = timeline), name, size.
- Foot "Or press F and drag to draw any size."
- On hover/highlight a **ghost** dashed outline on the canvas shows where it lands, labelled with kind glyph + name + size ("FB event cover 1920 × 1005").
- **Custom print size** island ([ak-picker-full]): Width/Height (mm inputs), Orientation Portrait/Landscape, Bleed (mm), Safe margin (mm), note "DL leaflet size. The artboard is drawn 3 mm larger on every side so colour can run past the cut.", Cancel / **Add artboard**.
- Legend copy ([ak-picker-full]): "The kind travels on the label" / "App and Social are both Fixed size — the same kind, different preset sizes." + per kind: Fixed size "Exact px. Place things anywhere. From App or Social." · Web page "Content flows top to bottom; the height grows. Other widths sit beside it." · Print "Paper in mm, with bleed and a safe margin. Exports a print PDF." · Video "Has a length. Selecting it brings the timeline."

**B. Web page artboard + inspector** ([ak-web-hug], [ak-web-widths]) — EXISTS (kind web, Hug/Fixed, Duplicate at width with 4 widths, body layout) → v2 inspector (kind chip "Web page"): Width (select "Desktop · 1440") · **Height** seg "Fits content | Fixed" + note "1573 now — grows as you add." · Layout ("Top to bottom") · Fill · **Other widths** button "Add a width" (duplicate glyph). Advanced: `kind web · width 1440px · height auto · min 900px · display flex · column`. Canvas: growth tag "+ 373 px" beside the artboard when content added.
- Duplicate at width: Tablet + Mobile beside Desktop, each reflows; toast "Tablet and Mobile are beside Desktop. Their layout reflowed to fit." [Undo].

**C. Fixed-size (social/app) artboard + inspector** ([ak-social]) — EXISTS (digital kind) → inspector kind chip "Fixed size": Size select ("Story 9:16 (still)") + W×H · Fill · **Safe zones** select ("Instagram story") · **Show on canvas** switch · **Export** button "PNG · 1×". Advanced `kind digital · width 1080px · height 1920px · fixed · position absolute children`.

**D. Safe zones overlay + menu** ([ak-safe-zones]) — NEW: bands drawn on artboard, **never exported**: Story (top 13 % "Profile and progress bar", bottom 17.7 % "Reply bar"); Reels (top 11.5 %, bottom 21.9 % "Caption and audio", right 13 % "Buttons"; flag "Under the caption" on content that sits under it); Profile grid (1:1 shown as 3:4 crop, pale sides cut). Menu "Safe zones": None · Instagram story · Instagram Reels · Instagram profile grid · TikTok · YouTube Shorts · Facebook event cover; foot "Shown on the canvas only — never exported. Zones as each platform publishes them, checked Oct 2026."

**E. Print artboard + inspector** ([ak-print-letak]) — EXISTS (print kind, paper presets, Portrait/Landscape, Bleed mm, print guides overlay) → inspector kind chip "Print": Paper (A6) · Size in mm (105 × 148) · Orientation seg · Bleed ("3 mm") · Safe margin ("5 mm", NEW as a field?) · **Print guides** switch (per-artboard, NEW location) · Colour note "RGB — the print shop converts to CMYK." · Export button "Print PDF". Advanced `kind print · paper a6 · portrait · size 419 × 581 px · bleed 11 px`. Size tag shows "105 × 148 mm".
- Print guides overlay: bleed tint outside trim, solid trim line, dashed safe margin, optional columns.
- [ak-print-view]: Menu › View › Advanced › **Print guides** (checked) turns guides on for every print artboard on the canvas (EXISTS: View › Show print guides, stored per canvas in `view.json overlays.print`). Paired web artboard tag "Same text as the flyer · edited separately".

**F. Video artboard** ([ak-video]) — same as 07 (imports `_video`): compact timeline under the selected Reels artboard; VideoInspector.

**G. Kind filter chips (`KindChips`, kit candidate)** — NEW: chips All · Fixed size · Web page · Print · Video with counts; active chip shows its word, others icon + count; zero-count chips dimmed; aria-label "Print, 2". Used in:
- **Layers** tab ([ak-mixed-fit]): filtering dims all other artboards on canvas; panel foot "19 other artboards are dimmed. Show all".
- **Canvases** tab ([ak-mixed-filter]): filters 93 canvases; hits show thumb, name, folder path ("2026 › combine"), kind glyphs, "N of M" artboards matching; foot "12 of 93 canvases have video — 3 more below. A canvas counts once under each kind it has."
- Labels keep their kind glyph when truncated at low zoom.

**H. Multi-kind selection inspector** ([ak-mixed-select]) — NEW: title "2 artboards", chip "2 kinds"; rows Kinds (glyph + word each) · Fill "Mixed" · Horizontal (Left/Centre/Right) · Vertical (Top/Middle/Bottom) · note "Size and paper differ. Select one to change it." · Export "2 files…". Advanced `kind digital · print · selected 2 artboards`.

**I. Change-kind dialog** ([ak-convert]) — EXISTS partially (Artboard kind select converts in place) → NEW: choosing "A6 · 105 × 148 mm" in a Fixed-size artboard's **Size** select opens Dialog "Make “Oznámení události” an A6 print?" → primary **Make A6 print**, Cancel. Body: "Size becomes 105 × 148 mm with 3 mm bleed. The design scales to the A6 width; the extra 13 % of height is filled with its background colour, Ink. Text stays text." "Check after" list: "Fotka týmu is 640 px wide — at A6 it may print a little soft." · "Two layers sit where the paper is cut." Info: "Instagram safe zones turn off — print has its own safe margin." Switch (on): "Keep the post; make the A6 from a copy".
- After ([ak-convert-after]): copy lands beside original; tags "Unchanged" (under post), "+ 13 % height · Ink fill", "Bleed 3 mm · trim · safe margin 5 mm"; label warn mark "2 things to check"; inspector top rows InWarn with verbs **Replace…** and **Show**; "Made from: Oznámení události · 4:5"; toast "The A6 copy is beside the post. The post is unchanged." [Undo].

**J. Warnings model** ([ak-warnings]) — NEW: one home = **mark beside artboard label** (problem glyph, tooltip "1 thing to check") + **row at top of its inspector** with one verb. Never modal, never blocking. Three drawn:
- Crosses the cut: "The QR code crosses the cut — its corner would be trimmed." → **Move inside**; on-artboard ring "Crosses the cut".
- Longer than one export: "2:40 long — one export goes up to 2 min (3600 frames at 30 fps)." → **Allow longer**.
- Not quite paper size: "1 px narrower than A4 landscape with bleed (1145 × 816)." → **Fix size**.
- Plus [ak-web-widths]: "Partneři is 960 px wide — wider than Mobile." → **Fit to width**.

**K. Advanced (print)** ([ak-advanced]) — inspector Advanced open: Exact size (`artboard 419 × 581 px`, `trim 397 × 559 px · 105 × 148 mm`, `bleed · margin 11 px · 19 px`) · Resolution (`canvas 96 px per inch`, `print PDF 300 dpi · vector text`) · Colour prose "Designed in sRGB. RGB — the print shop converts to CMYK; if they ask for a profile, use theirs." · Guides + **Add** (`columns 2 · gutter 16 · margin 30`, `rows · grid off`) · Look and layout (Theme "DS default", Body layout "Column", Grid tracks "Edit tracks…", Layout "Convert to absolute…") · In code snippet `<DCArtboard kind="print" print={{ paper: "a6", bleedMm: 3 }} width={419} height={581} fixed guides={{ columns: { count: 2, gutter: 16, margin: 30 } }}>`. Plain rows above: Paper "A6 · Portrait", Bleed · margin.

**L. Real artboards** ([ak-real-about/-print/-web]) — reference only: real `kind="print"` with `print={{ paper: "a6", orientation: "portrait", bleedMm: 3 }}` at 419 × 581 **without `fixed`** (bug workaround) and real `kind="web"` at 834 hug.

### 2. User flows

1. F over empty canvas → picker → hover tile shows ghost → click → artboard lands at ghost, kind set by group. Search/Recent shortcuts. "All 7" expands print; Custom size… → custom island → Add artboard.
2. F with an artboard selected → draws a **frame inside** it (no picker). F + drag → draws any size, skips picker (kind default? unspecified).
3. Web: add a section → height grows (Fits content); switch Height to Fixed to cap. Add a width → Tablet + Mobile duplicates side by side, reflowed; overflow warnings.
4. Social: pick safe zone preset in inspector → overlay drawn; toggle Show on canvas.
5. Print: inspector speaks mm; toggle per-artboard Print guides or View › Advanced › Print guides for all.
6. Video: select → timeline (07).
7. Mixed: ⌘0 fits all 21; Layers chip Print → dims others; Show all resets. Canvases chip Video → filtered list across project.
8. Multi-select across kinds → shared rows only; Export "2 files…".
9. Change kind via Size select → dialog → copy (default) → warnings in inspector.
10. Warnings: click verb fixes (Move inside / Allow longer / Fix size / Fit to width / Replace… / Show).

### 3. States & copy

- Notes: "F over empty canvas opens the size picker." · "Add a section; the page gets longer." · "Same page, three widths, side by side." · "Fixed size; put things anywhere." · "Paper first, millimetres throughout." · "Guides for the whole canvas live in View." · "Only a video artboard brings a timeline." · "Twenty-one artboards, two kinds." · "Find every video in the project." · "Several kinds: only what they share." · "Changing kind says what changes." · "The kind changed; nothing was lost." · "Shown, never blocking — always in the same place." · "Every number, under Advanced."
- Safe zone note: "One overlay instead of a check artboard." (replaces Alligators' "kontrola safe zóny (nenahrávat)" copy artboard).
- [ak-advanced] note: "Print PDF at 300 dpi is new in v2 — today it's 96 dpi unless set."
- [ak-real-about]: "today a fixed artboard counts its 24 px label inside the height, so the page would lose its bottom 24 px."

### 4. Keys & menus

- F = Frame tool: over empty canvas opens picker; inside artboard draws frame; F+drag draws artboard.
- ⌘0 Zoom to fit.
- Menu › View › Advanced › Print guides (toggle, checked state).
- Menu › Edit › Advanced ▸ New artboard (Desktop · Laptop · Tablet · Mobile · A4 · Letter) — CONTRACT §1 (not drawn here; must agree with picker presets).

### 5. Classification

- EXISTS→moves: artboard kinds (digital/print/web/video, `canvas-lib` `kind=` + `print` prop + `resolvePrintArtboard` in `apps/studio/print/units.ts`); ArtboardKnobs (presets, Hug/Fixed, kind select, Portrait/Landscape, Bleed) → kind-specific inspectors; Duplicate at width (context menu, 4 widths) → "Add a width"; print guides overlay (`artboard-guides-overlay.tsx`, View menu, per-canvas `view.json`); layout guides `guides` prop (T5, exists in canvas-lib); Convert layout to absolute; body layout / grid tracks editor; theme per artboard.
- NEW: grouped size picker with search/recent/badges/ghost; custom print size dialog; "Fixed size" word; safe-zone overlays (story/reels/grid/TikTok/Shorts/FB) — none in canvas-lib; kind filter chips in Layers + Canvases with counts; cross-kind multi-select inspector; change-kind dialog with copy + "Check after" analysis (low-res image detection, layers crossing cut, extra height fill); warnings system (label mark + inspector row + verb); per-artboard Print guides switch; Safe margin as a print field; 300 dpi print PDF default; growth tag.
- PROPOSED: "Fixed size" naming, picker groups (OQ "Words"); Print guides location (View vs inspector switch, OQ).

### 6. Backend / native needs

- Preset catalogue (shared by picker, Edit › Advanced ▸ New artboard, Size select) with kind mapping + search index.
- Safe-zone definitions dataset with a "checked" date; overlay renderer in canvas-lib (export pipeline must exclude it — same mechanism as print guides/annotations).
- Kind counts per canvas: project-wide index (canvases × artboard kinds) for the Canvases filter — server endpoint (tree API extension).
- Convert-kind analysis: image native resolution vs print size at 300 dpi (effective ppi), layer bounding boxes vs trim, extra-height computation, "Made from" provenance in meta.
- Warning detectors: element bbox crossing trim/safe margin; video duration vs `maxFrames` (exporter default 3600, ceiling 18000 — `exporters/video.ts`); artboard px vs paper-with-bleed mismatch; element wider than web artboard width. Need a per-artboard lint pass (server or canvas-side) feeding label marks + inspector.
- "Allow longer" → persists a per-artboard `maxFrames` (exporter supports `options.maxFrames`).
- 300 dpi print PDF default: change `exporters/pdf.ts` default `dpi` for print artboards (today absent dpi → scale 1 = 96 dpi).
- Fix the `fixed` artboard 24 px label bug in canvas-lib before relying on `fixed` print artboards.

### 7. Dependencies

- 07 timeline (`_video`), 09 export (inspector Export buttons, Print PDF), 06 Advanced/inspector ("Look and layout as 06 · ad-inspector"), 01 Canvases panel (filter lives there), 14 Editing (F tool, frames), CONTRACT §1 View › Advanced, §7 print colour line.

---

## 09 · Export (21 artboards, 7 sections)

Brief: every export path that exists today stays reachable (PNG · PDF · SVG · HTML · PowerPoint · MP4 · GIF · WebM · Canva · Project ZIP · AI handoff; print PDF with bleed + crop marks; cloud render; Exports history; `/design:handoff`, `/design:to-rn`, `/design:to-lottie`).

### 1. Surfaces / components

**A. The Export sheet (`ExSheet`)** — EXISTS as `ExportDialog` "Export & handoff" (`C/app.jsx:1539`, 10 format cards, scope select) + a duplicate in-canvas `S/export-dialog.tsx` → REPLACED by one adaptive sheet (k-dialog over Veil), width 640–780:
- Header: title "Export “<artboard>”" (or "Export 5 artboards", "Export “social” — 31 canvases", "Export everything in Alligators brand") + sub (canvas · folder · kind, e.g. "LetakA6 · print", "2026/combine · nothing was selected").
- **Scope bar** (always, top): label "Scope" + segmented **Selection · This canvas · Folder · Whole project**, each with its artboard **count** under the word ("—" + disabled when n/a, e.g. no Selection when nothing selected, no Folder for root canvases), trailing unit "artboards". Narrow sheets use the **compact** form: a Scope select row "Selection · 3 artboards".
- Body: preview column (optional) + rows column. Rows use `Row` (label + value + optional quiet note).
- Optional `lead` hint above body; `extra` below (filmstrip, hints).
- **Summary line**: files · size · time · where ("1 file · about 1.4 MB · a second", "2 videos · about 280 MB · about 2 min in the cloud").
- Footer: **Advanced** disclosure with hint of what's inside ("Scale, colour, file names" default) · Cancel · primary verb with a quiet **↵** glyph ("Export", "Export 2 videos", "Export 21 artboards"…). Return runs it.
- Sheet variants by kind of the selection:
  - **Fixed size / social** [ex-social]: preview pic + "1080 × 1350 · Post 4:5"; Format seg **PNG | JPG** + "Other…"; Size seg "1× 1080 × 1350 | 2× 2160 × 2700" note "Instagram resizes anything larger."; **Annotations** row; File name field "DOMA · Post 4-5 — feed matchday.png"; Save to select "Downloads".
  - **Print** [ex-print]: live **paper preview** = the PDF: art incl. 3 mm bleed (tinted), crop marks outside bleed **animate drawing in from corners**, page stack (back under front), pager with page thumbnails (‹ › and current ringed), caption "Page 1 of 2 · A6 · 105 × 148 mm", legend "Bleed 3 mm · Cut (· Safe 5 mm)". Rows: Format seg **Print PDF | PDF | PNG** + Other…; Print checks: **Bleed** ("colour runs 3 mm past the cut"), **Crop marks** ("where to cut — outside the bleed"), **Add “B · zadní (FLAG)”** ("page 2 — the back of this leták"); Colour "RGB — the print shop converts to CMYK."; Annotations (disabled: "Print files never carry them — pick PDF for a review copy."); File name "LetakA6 — FLAG.pdf"; Save to. Unticking Bleed updates the paper.
  - **Web** [ex-web]: preview of full-length page with dashed visible-area line, caption "1440 × 3120 / dashed: visible area"; Format **Image | PDF** + Other…; Area "Full page 1440 × 3120 | Visible area 1440 × 900"; Size "PNG 1× | PNG 2× | JPG 2×" note "2× stays sharp on Retina screens."; Annotations; File name "Homepage — Desktop@2x.png"; Save to; foot link row "Code for a developer? **Handoff to production…** ⇧⌘H".
  - **Video** [ex-video] (`VideoSheet`): sub "video-hype · 0:15 · Reels 9:16 selected"; preview still with scrub "Frame at 0:04 / scrub the strip below"; **filmstrip** under body (title lane, clip lane with thumbs, music lane, playhead "0:04", ticks) — scrub picks preview frame; Formats (tick tiles Reels 9:16 + 16:9, note "Its linked 16:9 is ticked too — 1 artboard selected, 2 videos."); Format **MP4 | GIF | Sound only** + Other…; Quality "1080p 1080 × 1920 | 4K 2160 × 3840"; Sound switch "Music, mixed as on the timeline"; Captions "Burned in | As a file | Both | Off" + "No speech to caption"; Render options (radio tiles): "In the cloud — About 2 min. Keeps going if this Mac sleeps." / "On this Mac — About 9 min. Keep this window open until it's done."; File names "Hype trailer · Reels 9-16 — 4K.mp4 and 1 more"; Save to; Advanced hint "Frame rate, codec, bitrate, file names"; primary "Export 2 videos"; width 720.
  - **Batch** [ex-canvas]/[ex-batch-pick]/[ex-batch]/[ex-huge]: kind **groups** (`Group`: kind icon, "Fixed size · 19" + sub list, thumbs, per-group format select "PNG · 2×"/"Print PDF"/"MP4 · 1080p"/"PNG · 2×" for web, quiet note "Bleed + crop marks" / "In the cloud"); Folders select ("One folder" / "One per canvas") with example path; File names select "Canvas — artboard" + example; Save to ("Downloads › social"); hints.
- **"Other…"** button → menu [ex-formats] grouped: Image (PNG ✓ "Transparent where empty", JPG "Smaller, no transparency · new", SVG "Shapes and text stay sharp") · Document (PDF "One page per artboard", Print PDF "Needs a print artboard" disabled, PowerPoint "Whole canvas, a slide each") · Video (MP4 · GIF · WebM "Needs a video artboard" disabled, Sound only "Needs a video artboard · new" disabled) · For other tools (Canva "A deck Canva opens", Web page (HTML) "Opens in any browser", Code… ⇧⌘H "Handoff to production") · Whole project (Project ZIP "Canvases, assets, design system").
- Kind defaults table [ex-formats]: Fixed size — up front PNG · JPG, default 1× preset size, under Other… SVG · PDF · Canva · Print — Print PDF · PDF · PNG, bleed + crop marks on, back as page 2; Other… SVG · PowerPoint · Canva · Web — Image · PDF, Full page PNG 2×, Code → Handoff ⇧⌘H; Other… HTML · SVG · PowerPoint · Video — MP4 · GIF · Sound only, 1080p, cloud suggested for 4K; Other… WebM · a still as PNG.
- **Annotations row** (all non-print sheets): checkbox "Include annotations" (default **off**) + sub "Stickies, arrows and stickers stay out unless you include them" (EXISTS `includeAnnotations`, 9eff034b).

**B. Inspector export row** [ex-inspector] — NEW: in a fixed-size artboard inspector, section "Export" with "+" (Add a size); preset rows (scale select + format select + "−" remove): "1× PNG", "2× JPG"; button "Export 2 files"; lines "Copy as PNG ⇧⌘C" and "Export… — every option ⇧⌘E". Toast "Copied “DOMA · Post 4:5” as a PNG — paste it anywhere." Inspector also shows Preset "Instagram post 4:5".

**C. Exports panel + Share-cluster Exports slot** — EXISTS (`export-center.jsx` badge/toast/panel, history "last 20", job words) → MOVES: Share cluster gains an **Exports icon** (kit candidate `ShareCluster exports={{ ring?, open? }}`), ring = overall %; clears when all Ready. Panel opens top-right under it (width 360/400): header (export glyph, "Exports", folder "Open the Downloads folder", chevron "Fold into the Exports icon"); job rows: thumb, name, meta (where — cloud/laptop glyph — + % + time left, or format · time ago), progress bar, status word or actions. Day groups "Today" / "Yesterday". Foot copy. Hover row actions: Show in Finder (folder), Export again (sync), More (…) → menu: Show in Finder · **Export again** · Export again with other settings… · Copy file names · Remove from list. Failed/partial row: "social · 114 of 115 / Recap — waiting for Jonas's Mac" + button **Retry Recap**. Warning row "Ready · no sound". Searchable: "Also in Search: “Exports”."

**D. Toasts** [ex-states]: done — "Exported 21 artboards to Downloads › Combine-kampan." [Show in Finder]; partial — clock icon "Exported 114 of 115. Recap is waiting for its music from Jonas's Mac." [Retry Recap]; ready-with-problem — "Exported “Nábor trailer” — without sound." [Show in Finder].

**E. Share vs Export** [ex-share-vs]: Export sheet hint (once, when people already in project): link glyph "Tereza and Jonas are in this project. A link shows them the latest, with comments." [Copy link]. Share sheet (10's, reproduced): "Share “Combine-kampan”", This canvas / Whole project seg, Name or email + role select + **Invite**, people list (You Owner, Tereza Can edit, Jonas Can comment), link row "Anyone in Alligators with the link · Can view" [Copy link], Advanced "Hub, link rules, GitHub invite". "Which one?" card: Link vs File copy. Local project card: "Portfolio 2026 is a local project" / "A link needs the cloud. Move the project to cloud.maude.sh, or export a file — nothing leaves this Mac." [Move to cloud…].

**F. Handoff to production sheet** [ex-handoff] — EXISTS (⇧⌘H opens ExportDialog in handoff mode; "AI handoff" copies `/design:handoff`) → NEW dedicated sheet: title "Hand off “Pricing” to production", sub "Desktop, Tablet, Mobile · Studio design system"; target radio tiles from project settings: **Studio web** ("Web components for the Next.js site — a shadcn registry item on studio.cloud.maude.sh", chip "Last used") · **Studio app** ("A React Native component for the iPhone app") · **Lottie animation** (disabled: "For motion — needs an animated frame; Pricing has none"); checkbox "Use the design system" ("colours, type and spacing come from Studio's tokens"); hint "Last review: no blockers. AI takes about a minute — keep working."; Advanced "Targets, the command, the registry file"; Cancel / **Hand off**.

**G. Handoff results** [ex-handoff-ready] (islands): 
- Web: "Pricing is ready for developers" / "One command adds it to the site, on any machine. Tereza and Jonas can run it as is; a developer outside Studio site needs Can view first." [Copy command]; Advanced: `bunx shadcn add https://studio.cloud.maude.sh/r/pricing.json` (Any machine), registry JSON excerpt, `bunx shadcn add file://~/Maude/Studio site/.design/ui/Pricing.registry.json` (**This Mac only**), `/design:handoff ui/Pricing.tsx` (Claude Code), `maude design handoff ui/Pricing.tsx .design` (Terminal).
- RN: "Pricing is ready as an app component" / "One component, styled from Studio's tokens." [Copy code]; Advanced Writes `src/components/Pricing.tsx`, `/design:to-rn "ui/Pricing.tsx" --out src/components/Pricing.tsx`.
- Lottie: "Welcome loop is ready as an animation" / "Plays the same on the web and in the app, 3 s on a loop." [Copy code]; Advanced Writes `.design/assets/welcome-loop.json`, LottieView snippet, `/design:to-lottie "ui/Onboarding.tsx" --verify`.

**H. Handoff edge states** [ex-handoff-edges]: not connected → "Connect your Claude account to let AI draft this." + "Handoff to production has AI write the code. Cloud doesn't include AI — use your own Claude subscription or API key." [Cancel][Connect] → runs after connecting; offline → Exports row "Hand off “Pricing” · Studio web — Queued — starts when this Mac is online"; blockers → warn hint "The last review found 2 blockers: Tablet price text is 3.9 : 1 (needs 4.5 : 1); Mobile's Start button is 38 px tall." [Show on canvas] + "Both go to the developer as notes with the code. Fix them first, or hand off now." [Hand off].

**I. Edge sheets**: [ex-offline] same video rows, cloud option "Waits for a connection, then starts by itself.", Mac "Starts now. About 3 min — keep this window open until it's done." (selected), 1080p, summary "2 videos · about 76 MB · starts now on this Mac, about 3 min". [ex-huge] Whole project: 4 groups (Fixed size · 424 on this Mac; Web page · 30 full pages; Print · 46 pages; Video · 24 in the cloud), Include checks "All 5 folders" + "test, Test2, ahoj, ahoj2" (root canvases), hint "Moving or backing up the project? A ZIP of canvases, assets and the design system is about 2.1 GB." [Project ZIP instead], summary "524 files · about 5.9 GB · images and PDFs about 6 min on this Mac · videos about 12 min in the cloud". [ex-print-warn] paper ring "2 mm to the cut" + warn hints "The QR code is 2 mm from the cut — past the 5 mm safe margin. The trim may clip it." [Show on canvas] and (type glyph) "Avenir Next Condensed Heavy can't be embedded — the headline prints as shapes (same look). The alligators .ttf embeds."; Print checks row incl. unticked "Add the back"; export still allowed. [ex-edges] viewer: lead hint "You can view this project. Exporting is fine — it makes a copy and changes nothing."; AI mid-change: lead AI hint "AI is changing this artboard right now — “Make the date bigger”." + Version radio "From 14:05 — The last finished version. Exports now." / "Wait for AI — Exports by itself when AI is done."; summary "1 file · the version from 6 Oct, 14:05".

**J. Advanced fold** [ex-advanced] (opens under the sheet, only the part for what's selected; mono only here):
- Image: Size by **Scale | dpi**; Exact scale "2.5×"; note "Pick dpi for a print size (150 · 300 · 600); the one you pick here wins over the sheet's 1× / 2×."; **Colour profile** sRGB | Display P3 (+ note); **JPG quality** "85 %"; Background select "As on the artboard".
- Print PDF: Images inside "300 dpi"; Text "Keep as text" (or "check the fonts are embedded · turn text into shapes (print-safe)"); Bleed "3 mm"; Crop marks switch; Registration marks switch; Paper "Same as artboard"; note "…use theirs (e.g. FOGRA39 or FOGRA51)."
- Video: Frame rate "30 fps — as made"; Codec "H.264 (MP4)"; Bitrate "High"; GIF colours "256"; Long videos "Up to 3 600 frames"; note "WebM uses VP9. Frames past the limit need a higher cap, set per export."
- Where it renders: Video "Suggest each time" (or always cloud / always this Mac); "Images and PDFs always export on this Mac, in seconds."; Render service `maude-render`; Status "Ready".
- **File names** template field `{canvas} — {artboard}@{scale}` + token chips `{project} {folder} {canvas} {artboard} {kind} {size} {scale} {date}` + live examples.
- **The same export from a terminal**: `maude design export png --scope artboard --option scale=2` · `maude design export pdf --scope artboard --option includeBleed=true --option marks=crop` · `maude design export mp4 --scope artboard --option fps=30 --out ~/Downloads` · Claude Code `/design:export png --scope artboard --option scale=2`; each with Copy.

### 2. User flows

1. Open: ⇧⌘E · Menu › Export… · Menu › File › Export… · right-click artboard › Export… · right-click folder › Export folder… · Inspector › Export · ⌘K ("export", "pdf", "mp4", "canva" — each format is a result).
2. Scope resolution: selection → Selection; **nothing selected → This canvas** (never project); folder context → Folder; Whole project only by explicit choice.
3. Pick format/size → Export (↵) → sheet closes → ring on Exports icon → toast on completion.
4. Batch: groups per kind each with own default; changing one group leaves others.
5. Exports panel: open from icon; Show in Finder / Export again / with other settings / Copy file names / Remove; Retry only failed item.
6. Link vs file: hint offers Copy link once; local project → Move to cloud.
7. Handoff: ⇧⌘H → target → Hand off (AI, ~1 min, background) → result island with one copy action → Advanced commands. Edge: connect / queued offline / blockers travel as notes.
8. Edge: offline video defaults to this Mac; cloud waits. Viewer can export (not handoff). AI mid-change → choose version.

### 3. States & copy

- Notes: "Two formats, two sizes, done." · "The preview is the PDF the print shop gets." · "A web page exports whole." · "Video: which formats, how sharp, where it renders." · "The quickest export skips the sheet." · "Nothing selected means this canvas — not the project." · "Mixed kinds, one sheet, one button." · "A folder sorts itself by kind." · "Exports run in the background, in words." · "One action per moment." · "The last 20 exports, ready to do again." · "Export points at Share when a link would do." · "Code goes where the developer works." · "Say what's in the way, keep the one verb." · "Offline, nothing is blocked." · "A big export says it's big, then gets out of the way." · "Warnings inform; Export still exports." · "Every knob today's dialog has, plus the ones it hid."
- Folder hint: "_broadcast, _social and _video hold shared parts, not artboards — left out." (eye-off glyph).
- Panel foot: "Cloud renders keep going if this Mac sleeps or the window closes. Exports on this Mac need the window open — images and PDFs take seconds."
- Job metas: "In the cloud · 64 % · about 1 min left" · "100 PNGs ready · videos 9 of 15 · about 4 min" · "On this Mac · 12 slides · a few seconds" · "On this Mac · Print PDF · 2 pages".
- Status words (= today): Queued · Rendering… · Ready · Ready · no sound · Failed.
- Captions under states: "Close the lid." / "Keep this window open." / "One icon, a ring." / "Retry Recap waits for the music to sync from Jonas's Mac, then renders by itself."
- "Decided: viewing includes exporting — an export is a copy and changes nothing (today's app allows it too)." / "Also open to viewers: Copy link. Handoff to production writes code into the project, so it needs Can edit."

### 4. Keys & menus

- ⇧⌘E Export (selection, or this canvas when nothing selected). ⇧⌘H Handoff to production. ⇧⌘C **Copy as PNG** (NEW, OQ). ↵ runs sheet primary; esc/Cancel closes.
- Menu › Export… (top level) and Menu › File › Export… ⇧⌘E; Menu › File › Handoff to production ⇧⌘H; right-click artboard › Export…; right-click folder › Export folder…; Menu › Diagnostics › Logs (render log).

### 5. Classification

- EXISTS→moves: PNG (1×/2×/3×, 150/300/600 dpi → sheet 1×/2× + Advanced Scale/dpi), PDF (image quality → "Images inside", text keep/embed/outline → Advanced Text, bleed, crop + registration marks), SVG, HTML, PPTX, Canva, ZIP (→ Other… › Whole project / hint in huge export), MP4/GIF/WebM (WebM → Other…/Advanced codec), audio on, fps from comp, maxFrames 3600 (→ "Long videos"), long-comp notice (→ 08 warning), scope select (selection/artboard/canvas-as-separate/project-raw → Scope bar), recent exports (→ Exports panel, last 20), export center badge/toast/panel (→ Share-cluster ring + panel), lane note "no render service" (→ Advanced Where it renders/Status), AI handoff `/design:handoff` copy (→ Handoff sheet), `/design:to-rn`, `/design:to-lottie`, `maude design export` CLI, `includeAnnotations`, viewers may export, ⇧⌘E/⇧⌘H keys. Duplicate in-canvas `S/export-dialog.tsx` + palette Export ⌘E → REMOVE (one sheet).
- NEW: JPG (+ quality), Sound only, Scope bar with counts incl. **Folder** scope (no CLI scope today) and Whole project as chosen scope, per-kind batch groups, live paper preview + animated crop marks + page stack/pager, "Add the back as page 2" pairing, filmstrip, linked formats ticking, cloud-vs-this-Mac per export with time estimates, size/time estimate summary, file-name templates/tokens, Folders layout option (one folder / one per canvas), Save to select, inspector export presets + Copy as PNG ⇧⌘C, Exports panel Show in Finder / Export again / with other settings / Copy file names / Remove / per-item Retry, partial-failure accounting ("114 of 115"), share-link hint in Export, local-project "Move to cloud…", handoff target tiles from project settings, hosted registry URL (`studio.cloud.maude.sh/r/pricing.json`), last-review blocker integration, handoff queued offline, colour profile (sRGB/Display P3), font-licence/embed check, safe-margin check in sheet, "Export the version from 14:05" / Wait for AI, render location preference.
- PROPOSED: all items in OQ list for 09; ⇧⌘C.

### 6. Backend / render-service / CLI needs

- Export API (`POST /_api/export`, `exporters/*`): add `jpg` (+quality), `sound-only` audio render, `folder` scope (+ project per-folder include), multi-group batch job (one job, N sub-jobs per kind/format), file-name template renderer, output folder layout, Save-to destination (native dialog/Tauri), per-sub-job status for partial accounting + targeted retry, "export again with same settings" (persist job spec in history), history beyond in-memory (last 20, day grouping, persisted).
- Estimates: size/time per format and lane (cloud vs local) before running.
- Render lane choice per job: client-selected `cloud|local` (today lane auto by service availability); offline → queue cloud job until online; cloud job results downloaded to this Mac automatically after reconnect.
- Print: default 300 dpi images for print PDF; page pairing (front/back artboards → multi-page PDF — need a pairing convention/meta); live preview = client-side render of the same geometry (`print/marks.ts computeMarksGeometry`); safe-margin intrusion detection; font embeddability check (`pdf-fonts.ts` exists — surface licence/embedding failure → outline fallback).
- Colour profile tagging (sRGB vs Display P3) for PNG/JPG.
- Version export: export a past version snapshot (Version history/`_history`) while AI edits; "Wait for AI" = deferred job triggered on AI run end.
- Viewer export permission (hub roles) — already allowed; Handoff requires Can edit.
- Handoff: target catalogue in project settings (`workflows`/design config), hosted registry endpoint on the cloud hub (`/r/<name>.json`, auth = project membership), AI review result lookup (blockers from last critic run), queued handoff jobs in Exports, results surfaced as cards.
- CLI: `maude design export` must accept the commands shown — **`--option marks=crop` is ignored today** (exporter expects `marks: { crop: true }` object; CLI only coerces true/false strings → `marks="crop"` dropped) and `scale=2` arrives as string "2"; add `--scope folder`; `export zip` without scope rejected (OQ bug). `jpg` and sound-only not in `VALID_FORMATS`.

### 7. Dependencies

- 07 (video sheet, formats, render states), 08 (kinds, print geometry, warnings, inspector export buttons), 10 Share sheet + roles, 03 AI connect sheet + offline queue, 06 Diagnostics/Advanced, 01 Canvases panel (folder right-click), 05 Version history (14:05 version), CONTRACT §7 (Export done/scope/print colour).

---

## 12 · Import and Assets (22 artboards, 8 sections)

### 1. Surfaces / components

**A. Drag-and-drop onto canvas** [ia-drop-photos] — EXISTS partly (drag media onto canvas/timeline, AssetPicker Upload) → NEW behaviours:
- **DragStack** cursor badge: fanned 3 thumbs + count "6" + name "IMG_2231.jpg + 5 more" + "+" badge.
- **DropTarget**: azure outline over the artboard (or a frame) under pointer + pill copy "Drop to place 6 photos in Fotky ze zápasu" / "Drop to replace the photo".
- Rules: drop on artboard → inside it, **empty frames fill in order**, else a tidy grid; drop on bare canvas → loose; Image tool (I) does the same without drag.
- After drop [ia-placed]: photos placed AND selected (group selection tag "6 photos"); thin upload bars on cells still uploading; Share cluster status "Syncing…"; Assets › **Just added** group first (tiles with upload bars); asset count updates ("253 assets · 1.4 GB"); toast "Placed 6 photos in Fotky ze zápasu. They're in Assets too." [Undo].

**B. More ways in** [ia-more-ways]:
- ⌘V paste screenshot → lands under the pointer, in the artboard under it; caption file name "Snímek obrazovky 2026-10-06 v 14.05.png"; paste again reuses same picture (content-addressed).
- Drop .mov files → clip cards on canvas, each "Preparing… 62 %" + bar + caption "IMG_4471.mov · 4K · 0:42"; playable once prepared; floating offer island "3 clips" + **Assemble into a video** (= Menu › File › Assemble clips into a video) → new video artboard, in order; cut works while preparing.
- Drop logo SVG/PDF → placed; quiet line "Logo cleaned up for the canvas" + **Details**; copy: "gator_badge_roundel.svg kept its shapes and colours; two links to other sites and a script were left out. A PDF logo comes in as a picture of its first page."
- "Assets · Just added 5" strip.

**C. Assets tab (left panel's third tab)** [ia-assets-panel] — EXISTS as AssetPicker dialog (`C/app.jsx:1234`, Insert ▸ Image / Replace media) → MOVES to kit `CanvasesPanel tab="assets"` (Canvases · Layers · Assets). Opened by Menu › View › Assets, ⌘K (no key). Body (`AssetsBody`):
- Search field "Search assets" (clear ×).
- Bar: kind filter chip "All kinds ⌄", toggle chip **Not used**, icons: **Generate an image** (spark), **Add files…** (+).
- Grouped list, pictures first: **Photos 120 ›** (3-col grid) · **Video 34** (2-col, duration badge) · **Sound 9** (rows: play button, name, "✦ Made by AI · 0:15", waveform) · **Logos & icons 66** (on transparency checker) · **Generated 18** (spark badge). Group heading with count + "›" widens to browse view.
- Foot: "247 assets · 1.4 GB".
- Tile: picture first; name on **hover AND keyboard focus** ("IMG_2231.jpg / Used in 4 canvases"); states: selected, focused, dragging, picked (checkbox), prep ("Preparing…"/%), local ("On this Mac"), up (upload bar), match label (search), "seen" box (where AI saw the word), AI badge, duration badge.
- Empty state (kit): "Drop photos, video or sound here."
- Drag tile onto artboard/frame → drop target "Drop to replace the photo".

**D. Keyboard placement + tile menu** [ia-assets-keys] — NEW: select an artboard, then a tile → **↵** places it there. Tile menu (right-click): **Place in MVP zápasu ↵** · Show details ⌘I · Rename… · Copy ⌘C · — · Move to trash. "+" adds files from Finder.

**E. Browse view** [ia-assets-browse] — NEW: click a group heading → Assets widens (~820 px) over the canvas: back "‹ Assets", title "Photos 120", search "Search photos", sort chip "Newest first ⌄", size seg Large/Small; day groups "Zápas vs. Panthers · 27 Sep", "Trénink · 24 Sep"; tiles with checkboxes + file names; ⇧/⌘ multi-select; bottom bar "**6 selected** · 18.4 MB" · Clear · "or drag them onto an artboard" · **Place 6 in Fotky ze zápasu ↵** (fills six frames in order).

**F. Search inside pictures** [ia-assets-find] — NEW (CONTRACT §7):
- First search: results "In the name or tags"; inline offer "**Search what's in the pictures too?** AI can describe every picture and clip once, so a word finds IMG_2231.jpg as well." [Turn on…]; foot "Searched 247 assets — names and tags".
- Sheet "Describe the pictures in Alligators brand?" — "Let AI describe your pictures so search can find what's in them." bullets: "Uses your Claude account — one short look at each of 238 pictures and clips." · "New pictures are described when they arrive." · "The words stay next to each file, so search works offline." · "Only for Alligators brand. Turn it off in Settings › General." [Cancel][Describe pictures].
- After: groups "Seen in the picture" (with seen-box overlay + match "touchdown · noc", clip hit "0:03 skóruje #27") then "In the name or tags"; foot "5 results · 35 pictures still being described".
- AI not connected: names only + "Connect your Claude account to search what's in pictures, too." [Connect…]; foot "Searched 247 assets — names only".
- Per project: Studio site still name-only until someone says yes there.

**G. Tidy** [ia-assets-tidy] — NEW: "dron" query → "In the name" (4) + "Seen in the picture" (2); **Not used** filter: note "Not counted: 12 kept only by older versions, 3 AI takes from today."; groups; foot "31 assets · 212 MB" + **Move 31 to the trash…**. "Where the words come from" card: picture with seen-box "touchdown", clip scrub "0:03 / 0:07", name, "AI saw" quote (Czech), tags chips, fine "Described on 6 Oct with your Claude account, in the project's language. Picking a hit jumps the clip to the moment — here, 0:03."

**H. Asset details** [ia-asset-details] — NEW (replaces the list, "‹ Assets" back, "…" menu). Per kind:
- Photo: picture, name, Size "4032 × 3024 · 3.1 MB · JPG", Added (avatar "Jonas · 27 Sep, 21:40"), AI saw tags, **Place in MVP zápasu ↵**, "Used in 4 canvases" rows (thumb, canvas, artboard, ›; click opens the artboard), Advanced "file name · original path".
- Made by AI: "✦ Made by AI" chip, title, Prompt quote, Made with "Google · Nano Banana Pro · 5 Oct", Size, licence line "May carry an invisible SynthID watermark. Check Google's terms before commercial use.", Place, Used in, **Generate more like this**.
- Clip: scrub, Size "1280 × 720 · 0:07 · 3.4 MB", AI saw, **Good moments** chips ("0:01–0:04 běh", "0:05 oslava"), **Place in Reels 9:16 ↵** (clip/sound go on a video artboard), Used in, Advanced "file name · what AI saw, as data".
- Sound made by AI: big play + waveform, Prompt, Made with "ElevenLabs Music · 28 Sep", Length "0:15 · 240 KB · MP3", "Commercial use depends on your ElevenLabs plan.", Place, Used in, Advanced "file name · prompt, as data".

**I. Photo inspector (`PhotoInsp`)** [ia-photo-inspector] — EXISTS as `PhotoKnobs` (Inspector Photo tab: 8 Adjustment sliders, Duotone, Grain, Pattern, Mask, Background removal; own undo) → v2 designer layer: header file name + chip "Photo"; **Placement** Fill/Fit/Crop; **Look** grid of 8 named presets with live thumbs: Original · Brighter · Warmer · Cooler · Punchy · Mono · Club green · Night; sliders **Light** (+12) and **Colour** (+24); **Remove background** button with spark (→ after: row "✦ Background removed" + switch); Replace… · Reset; scope box "✓ Only this use changes" / "IMG_2247.jpg is in 3 more canvases — they keep the original. Reset brings this one back too." [Apply to every use…]; Advanced "sliders · grain · mask" (today's full PhotoKnobs).

**J. Photo steps** [ia-photo-steps]: Crop — drag crop box edges, label "4:5 · from the artboard", "The whole photo stays — only the frame moves."; Remove background — artboard AI tag "AI is removing the background" (cursor on the photo); Done — tag "✦ Background removed by AI", mini switch "Background removed" + "Off shows the original photo. This use only."; Apply sheet "Apply Punchy and the cut-out to every use?" — "IMG_2247.jpg is in 3 more canvases. They change too:" + UsedRows + "Each use can still be changed on its own afterwards. Undo works as anywhere." [Cancel][Apply to every use]. Note: cut-out **runs on this Mac**, result is a mask on top.

**K. Generate an image / clip** [ia-gen-ask], [ia-gen-placed] — EXISTS as `GenerateDialog` (Prompt, Provider, Model, Aspect, Place on canvas) + timeline "+ AI clip" → MOVES into AI chat panel **Generate mode** (also Assets › Generate spark): mode chips "Generate an image" / "Generate a clip"; options chips "4:5 · from Gameweek 5 ⌄" (shape from selected artboard), "4 variants ⌄"; scope chip "◆ Post 4:5 · Gameweek 5"; hint line "About 30 s · billed to your Google key"; fine line "Images may carry an invisible SynthID watermark. Check Google's terms for commercial use."; intro "Describe what should be in the picture. AI makes four takes in the artboard's shape and puts the best one in the frame; the others are one key away."; chips "Use our photos as a style", "Daylight instead".
- Result: best take (3 of 4) placed in the frame, selected; on-canvas tag "✦ Picture made by AI" (on the picture, not the artboard); takes pill "‹ Take 3 of 4 › ← →"; chat AI message "Done — four takes in 4:5. The third is in Gameweek 5; ← → on the canvas tries the others."; 4 variant thumbs ("In the frame" ✓, hover "Place instead"); meta "24 s · 4 images · Google · Nano Banana Pro"; toast "Placed take 3 in Gameweek 5. The other three are in Assets › Generated." [Undo].

**L. Import from Figma** [ia-figma-sheets], [ia-figma-arrived] — EXISTS as `FigmaImportPanel` (Quick setup; URL, mode Design frames/FigJam/Styles, Preview, Import; token in Settings › Figma) + `import-figma.sh` (render-first, `--explode`) → MOVES to Menu › File › Import from Figma… one sheet:
1. Paste a link: field "Figma link"; callout "**Figma isn't connected yet.** Connect once to read this file." [Connect…]; fine "A board from FigJam works too — it comes in as annotations."; Import disabled.
2. Connect Figma (Settings › Connections): steps "In Figma, open Settings › Security." / "Create a personal access token with File content: read." / "Paste it here."; Access token field (masked); fine "Kept in this Mac's keychain. Used only to read files you import; Settings › Connections removes it." [Connect].
3. Pick frames: file row "Uniformy-2027 · Jonas · page Dresy 2027" + StatusWord "Connected"; frame thumbs with checkboxes; "Put them in" destination select "2026/dresy › New canvas"; fine "Uniformy-2027 is already in 2026/dresy, so this one is called **Uniformy-2027 (Figma)**. Pick it in the list to add to it instead."; options "Comments, as stickies" (on), "Colours and text styles, into the project's style" (off); fine "Each frame arrives as Figma's exact picture. Make editable turns one artboard into layers later — it needs Figma Dev Mode on a paid seat." [Import 6 frames].
- Arrived: canvas banner "From Figma — Uniformy-2027 by Jonas · imported 6 Oct, 14:05"; artboards at Figma sizes; comment pins; inspector for imported artboard: chip "Artboard", Size, callout "**Figma's exact picture.** Its text and shapes can't be changed until it's made editable." [Make editable] + fine "Turns this one artboard into layers. Needs the Figma desktop app open on this file, in Dev Mode — a paid Dev or Full seat."; **import summary** island bottom-right: ✓ "6 artboards, at their Figma sizes, as pictures" · ✓ "3 comments came across as comments (1 resolved)" · ⚠ "2 fonts not on this Mac — Druk Wide shows as Inter Tight, Gotham as Inter, once made editable" · ⚠ "1 video fill kept as a still" · skip "4 hidden layers left out"; Advanced "node ids · reason codes".

**M. FigJam → whiteboard** [ia-figjam] — EXISTS (FigJam board mode) → opens in **Preview** on the annotation layer (toolbar = annotate, tool sticky): banner "From FigJam — Nábor 2027 — retro by Tereza"; sections, stickies, connectors intact; unsupported widget box "**Hlasování** — a FigJam widget; it can't come across" with connector ending at the box; summary: "24 stickies, 3 sections, 2 pictures" · "8 connectors, still attached" · ⚠ "1 voting widget can't come across — its connector ends at the box" · "5 comments → stickies".

**N. Import a brand** [ia-brand-steps], [ia-brand] — EXISTS as `BrandUploadPanel` (Quick setup; SVG → palette + fonts, "Copy command") + `import-brand.sh` (SVG only, DDR-173) → MOVES to Menu › File › Import a brand… one sheet:
1. Drop zone with logo ("studio-brno-logo.svg · Logo · or drop another — SVG, PNG or PDF") + field "Website (optional)"; fine "Colours come from the logo; fonts and more colours from the website. Nothing changes until you choose."
2. Reading: rows StatusWord "Read" "studio-brno-logo.svg — 4 colours" / "Reading…" "studio-brno.cz — fonts and colours" + progress; fine "Usually under 10 seconds. The site is read once; nothing is sent to it."
3. Edge: callout "**Couldn't read studio-brno.cz.** It didn't answer in 20 s. The logo's colours are kept." [Try again]; fine "Without the site, fonts stay as they are — pick one on the next step."; primary "Continue with the logo".
4. Result sheet "Use this brand as Studio site's style?": From (logo dropped, website read once); Colours "4 found · click a role to change it" — Coral → Accent, Ink → Text, Paper → Background, Sky → Second colour (role dropdowns); Fonts: Found "Inter — headings and text, from the website"; Not found "The logo's lettering is drawn as shapes, so its font can't be read." [Pick a font…]; live Preview — Homepage; fine "Your canvases keep their content; colours and type follow the style. Version history keeps the old one." [Cancel][Use as the project's style].

**O. Waiting / Missing** [ia-missing], [ia-missing-gone] — NEW distinction (CONTRACT §7):
- Waiting: placeholder over the frame (clock, name "acko-hero2.png", "Waiting for Jonas's Mac"); inspector StatusWord warn "Waiting for Jonas's Mac" + "Added on Jonas's Mac, 2 Oct, 18:12, and not synced yet. Your design is safe — the picture fills in by itself."; "Have it here?" [Relink…]; Advanced `assets/7f3e21c4.png`.
- Missing: red hatch placeholder "Missing — no device has it" + [Relink…]; inspector StatusWord error "Missing" + "Added by Tereza on 1 Oct and removed from her Mac before it synced. No device has it now; the rest of the design is safe." [Relink…][Replace…].

**P. Nine edge arrivals** [ia-edges] (one line each): A 500 MB 4K clip "Preparing **stadion-dron-4K.mov** — keeps working in the background. About 4 min." · B duplicate "IMG_2231.jpg is already in Assets — placed the same one, not a copy." (tag "Used in 5 canvases now") · C .psd "Its flat picture is placed; the layers stay in Photoshop. A .psd without one asks for a PNG or JPG." + toast "Placed the flat picture from dres-2027-final.psd. Its layers stay in Photoshop." · D offline "Kept on this Mac — goes up by itself once it's online." (tiles "On this Mac", cluster "Offline") · E Tereza's photo card "Added by Tereza / Yesterday, 18:20 · from her Mac / Used in 2 canvases · yours and hers / A look you set changes only your use. Hers stays as she left it." · F link "Saved a copy from the link — the page can change, your copy won't." · G Figma no access "**Your Figma account can't open this file.** Ask its owner to share it with you, then paste the link again." + "Nothing is imported until it opens; the link stays in the sheet." · H no Google key sheet "Connect a Google key?" — "Connect a Google AI key to make this image. Images are billed to your own key; the cloud plan doesn't include them." [Connect] + "After Connect, the waiting prompt runs — nothing to type again." · I HEIC "IMG_5012.HEIC came in as a JPG the canvas can show. The original stays under Advanced."

**Q. Advanced storage** [ia-advanced]: details Advanced rows (mono, Copy): Stored as `assets/d34bb59d.jpg` · Original `~/Pictures/Alligators/2026-09-27 Panthers/IMG_2247.jpg` · Edits `assets/d34bb59d.photo.json` · Cut-out `assets/0a293589.png` · In canvases `<img src="assets/d34bb59d.jpg">` · command `maude design import-asset ~/Pictures/…/IMG_2247.jpg --kind raster` [Copy]; "Edits: MVP zápasu — Punchy, background removed · 3 other uses untouched". Disk listing `.design/assets/` "247 assets · 31 sidecars · 14 caption files" with types (photo.json, footage.json, .srt, audio.json, footage/ proxies). Proposed per-use sidecar JSON `{ version: 2, source, uses: { "social/matchday#post-mvp-zapasu": { placement, look, backgroundRemoved: { maskAsset } } }, everyUse: null }`. Other verbs listed: `fetch-asset · photo-adjust · photo-bg-remove · generate · ingest-footage · transcribe · import-figma · import-brand`.

### 2. User flows

1. Finder drag → artboard highlight + pill → drop → place/fill frames + select + upload in background + Assets › Just added + toast Undo.
2. Paste ⌘V → under pointer; duplicate reuse.
3. Drop .mov → prepare in place → Assemble into a video.
4. Drop logo → sanitized → placed + quiet line + Details.
5. Assets: open (View › Assets / ⌘K) → hover/focus tile → drag to artboard/frame (replace) or select tile + ↵ (places on selected artboard) or tile menu Place; ⌘I details; + add files.
6. Browse: click group heading → wide view → multi-select → Place N ↵ (fills frames in order) or drag.
7. Search: names/tags → offer → sheet (once per project) → descriptions run (progress "35 pictures still being described") → content hits with seen boxes; clip hit jumps to moment.
8. Not used → review → Move N to the trash… (excludes versions-only + today's AI takes).
9. Photo: select → inspector → Placement/Look/Light/Colour → Remove background (local AI) → toggle → Apply to every use… sheet (optional).
10. Generate: ask in chat Generate mode (or Assets spark) → cost/time line → 4 takes → best in frame → ← → cycles / pick in chat → others in Assets › Generated → Undo.
11. Figma: Menu › File › Import from Figma… → link → connect once (token) → frames + destination + options → Import → artboards as pictures + summary → Make editable per artboard (Dev Mode).
12. FigJam link → annotations in Preview.
13. Brand: Menu › File › Import a brand… → logo and/or website → reading → (fail → Continue with the logo / Try again) → roles/fonts/preview → Use as the project's style.
14. Missing/waiting → wait or Relink…/Replace….

### 3. States & copy (additional notes)

- Notes: "Drop on an artboard and the photos go inside it." · "Placed at once; the cloud catches up." · "Video prepares itself; logos are made safe without asking." · "Assets is the left panel's third tab." · "Every tile places by keyboard." · "A group heading widens Assets into a browse view." · "Asked once per project, never assumed." · "Tidy up without losing history." · "Made by AI is said once, plainly." · "Edits stay with this one use." · "The cut-out happens on this Mac." · "Say the picture; the artboard decides the shape." · "The choice happens in the frame." · "Connecting is a step, not a detour." · "Exact first, editable on request." · "FigJam boards land as stickies, not pictures." · "A failed website doesn't lose the logo." · "What was found, which role it gets, and a preview." · "Not here yet is quiet, not an error." · "Missing means nobody has it — then Relink is the fix." · "Nothing blocks the canvas." · "Mono, paths and commands live only here."

### 4. Keys & menus

- Menu › View › Assets; ⌘K → Assets (no dedicated key). ↵ place selected tile on selected artboard; ⌘I show details; ⌘C copy; ⇧/⌘-click multi-select in browse; ← → cycle generated takes on canvas; ⌘V paste under pointer; Image tool I (place without drag).
- Menu › File › Import from Figma… · Import a brand… · Assemble clips into a video. Menu › Edit › Paste ⌘V. Settings › Connections (Figma token, presumably Google/ElevenLabs keys), Settings › General (picture descriptions toggle).

### 5. Classification

- EXISTS→moves: content-addressed storage `assets/<sha8>.<ext>` + dedupe; `import-asset` (SVG sanitize DDR-167, raster; PDF worker present but header says PDF "not yet available" — verify), `fetch-asset` (link drop), AssetPicker (→ Assets tab), media drag to canvas/timeline, Assemble dropped clips, footage ingest/proxies (`ingest-footage`, `assets/footage/`), `*.footage.json` (what AI saw: shots, good moments, tags), `*.audio.json`, PhotoKnobs (→ Advanced of photo inspector), `photo-adjust` (sidecar per asset), `photo-bg-remove` (local), GenerateDialog + providers (Google Nano Banana, ElevenLabs Music, Veo/Gemini clips) + BYOK keys, FigmaImportPanel + `import-figma` (render-first, `--explode` Dev Mode), FigJam → annotations, BrandUploadPanel + `import-brand` (SVG only), Figma token (Settings › Figma → Settings › Connections).
- NEW: drop target pill + fill-frames-in-order, auto-select after drop, Just added group, upload progress per tile/cell, paste under pointer, prep progress cards + Assemble offer island, logo-cleaned quiet line, Assets as left-panel tab with kind groups + Not used + browse view + sort/size + multi-place, keyboard placement ↵ + tile menu, hover/focus names, asset details view (Used in, Added by, AI saw, Good moments, Made with, licence line, Generate more like this), **search inside pictures** (opt-in per project AI descriptions for photos — today only footage gets analysis), seen-box localisation, Not used accounting (excluding version-only and today's AI takes), Looks presets in words, Light/Colour simplified sliders, Placement Fill/Fit/Crop + crop box, **per-use photo edits** + Apply to every use sheet, generate-in-chat with 4 takes + best-pick + ← → cycling + cost/time line, Figma connect-in-sheet + destination/naming "(Figma)" + options + import summary + per-artboard Make editable, **brand import from website** + colour roles + font found/not found + live preview + "Use as the project's style", waiting vs missing distinction + Relink…, PSD flat composite, HEIC→JPG, offline-kept-local uploads, Added-by attribution.
- PROPOSED: per-use sidecar schema v2; search in pictures (OQ); brand from website (OQ); Assets third tab; per-use photo edits (OQ).

### 6. Backend / native needs

- Asset index service: list/group/count by kind, size, usage ("Used in N canvases" with artboard + time for clips), added-by/added-at/origin path, "Not used" computed over current canvases excluding version-history-only refs and today's AI takes; trash move for assets.
- Upload/sync pipeline per asset with progress + device-presence ("on Jonas's Mac, not synced" vs "no device has it") from hub file plane; offline local-first queue.
- Drop handling (Tauri native file drop + browser): frame detection inside artboard, fill order, grid layout.
- Paste image from clipboard → import-asset.
- Converters: PSD flattened composite extraction, HEIC→JPG (keep original under Advanced), PDF first page raster.
- AI descriptions: per-project opt-in flag (Settings › General), batch describe job using the user's Claude account (238 items), incremental on arrival, sidecar per file (`<sha8>.describe.json`?), localized to project language, bounding boxes for "seen" hits, clip timestamps; search index over names/tags/descriptions working offline.
- Photo: per-use edit sidecar (key = canvas#artboard/element) — **today `photo-adjust.sh` writes one set per asset**; renderer must apply per-use edits; look presets map onto existing filters; mask asset for bg removal.
- Generate: N variants per request, aspect from target artboard, best-pick ranking (AI judge), take cycling state on the placed element, cost/time estimate, provider metadata + licence lines in `*.json` sidecars; missing-key flow resumes queued prompt.
- Figma: token in keychain via Settings › Connections; file access error mapping; destination naming collision "(Figma)"; comment import (as comments vs stickies — see contradictions); style import into project DS; summary with reason codes + node ids; Make editable per artboard requiring Figma desktop Dev Mode bridge.
- Brand: website reader (fetch once, CSS colour/font extraction, 20 s timeout, no data sent), merge with logo palette, role assignment → writes DS tokens (interaction with "Design system lives on a canvas" review flow), preview render.
- CLI: `maude design import-asset … --kind raster` exists; others listed exist.

### 7. Dependencies

- 01 Canvases panel (kit tab), 03 AI chat (Generate mode, connect sheet), 06 Sync/Advanced storage words (06 ad-sync-wait path must be corrected to `assets/7c40e2b1.mov · 412 MB`), 07 (clips, Assemble, footage), 08 (artboard shapes for generate), 15 Annotations (FigJam → stickies, Preview mode), Settings (Connections, General), CONTRACT §7 rules (Assets, search in pictures, Figma import, not here yet vs missing, photo edits).

---

## Cross-cutting notes

### Contradictions between canvases

1. **07 [ve-export] vs 09 export sheet.** 07 draws an older `Dialog` with InSeg rows; 09's `ExSheet` is canonical (Scope bar with counts, Advanced hint, ↵ primary, File names, Save to, Sound switch, filmstrip, Other…). Differences: 07 Scope is a select "This canvas · 4 artboards" (OK only as 09's "compact" form, but 07's sheet is 560 wide, not narrow); 07 Captions default "Both" vs 09 "Off"; 07 "On this Mac — About 6 min" vs 09 "About 9 min" (4K) — estimates must be computed, not copy; 07 puts render location as radio pair without icons, 09 as Option tiles with cloud/laptop icons; 07 summary "3 videos + 1 caption file · about 48 MB" (48 MB for 3×30 s 1080p looks low vs 09's 280 MB for 2×15 s 4K). Implement 09's sheet; treat 07 as content (multi-format ticks incl. unlinked copy unticked).
2. **Retry action label**: CONTRACT §7 "offers one Retry"; 07 toast action "Retry"; 09 toast + panel "Retry Recap". Pick one pattern (09's named retry is more specific). 09 also says Retry "waits for the music to sync…, then renders by itself" — is it a button or automatic? Ambiguous.
3. **Inspector export row**: 08 draws single buttons ("PNG · 1×", "Print PDF", "MP4", "2 files…"); 09 [ex-inspector] draws a multi-preset Export section (+/−, "Export 2 files", Copy as PNG). Need one model per kind; does clicking 08's "Print PDF"/"MP4" export directly or open the sheet?
4. **Video length limit**: 08 [ak-warnings] warns at 2:40 ("one export goes up to 2 min (3600 frames at 30 fps)", Allow longer); 09 Advanced "Up to 3 600 frames … higher cap, set per export"; but 07 [ve-long] shows a **4:12** match video (7560 frames) with no warning mark or row, and 09 [ex-huge] exports 24 videos without mention. Also 09 says cap is "per export" while 08's "Allow longer" reads as per-artboard. Exporter ceiling today 18000 frames (10 min @30 fps).
5. **S key**: 07 makes **S = Split** at the playhead; CONTRACT §2 makes **S = Section** (annotation key that switches to Preview). Also **I / O** loop (07) vs **I = Image** tool (CONTRACT §2, and 07/12 use I for placing clips/photos); **E** fine; **←/→** step frames (07) vs arrows nudge 1 px (CONTRACT §2 proposed) vs ← → cycle generated takes (12). **⌘+/⌘−** zoom timeline when hovered vs canvas zoom. Needs a focus/selection-scoped key resolution spec (timeline focused / video selected / generated image selected).
6. **⇧⌘E double meaning (known bug)**: today shell ⇧⌘E opens Export (`C/app.jsx:15585`), while in-canvas `S/export-dialog.tsx:414` maps ⌘E = open, **⌘⇧E = re-run last export**, and the palette/context menu show "Export (⌘E)". v2: ⇧⌘E only opens the sheet (selection or this canvas); remove ⌘E and re-run-last (Exports panel "Export again" replaces it).
7. **Figma comments**: sheet option "Comments, as stickies" (on) but [ia-figma-arrived] summary says "3 comments came across as comments (1 resolved)" and renders comment pins (code comment: pins show in Edit; stickies only in Preview); FigJam summary "5 comments → stickies". Decide: Figma design comments → comment pins; FigJam comments → stickies; fix the option label.
8. **Figma frames' kind**: [ia-figma-arrived] draws imported jersey frames as `kind="print"` artboards. Imported Figma frames should arrive as **Fixed size** (digital) at Figma px; likely a canvas slip. Confirm.
9. **Export toast "done" vs Show in Finder for cloud**: consistent (CONTRACT §7). But 09 [ex-states] "the file downloads to this Mac when it's back online" → needs an auto-download queue; Exports panel row state for "rendered in cloud, not yet downloaded" is not drawn.
10. **Clip inspector** (07) lacks today's Grade/Crop/Transition-frames/Detach audio/Move to overlay/Replace/Comment on clip/Hide/Generate ✨ (INV §13 clip context menu ~17 items). Not drawn anywhere in v2; 07 Advanced claims "Everything the old timeline had, one disclosure down … Nothing was deleted" — implementer must still place these (clip right-click menu not designed).
11. **Video tracks model**: today's timeline has storyline + overlay + audio + expanded layers + "new layer" zone; v2 has exactly four fixed tracks (Text · Graphics · Video · Music). Overlay video (picture-in-picture), multiple music/SFX tracks, image clips on overlay — not addressed. Migration of existing comps with overlay lanes is unspecified.
12. **Print guides**: 08 adds a per-artboard "Print guides" switch in the print inspector AND keeps Menu › View › Advanced › Print guides (canvas-wide). Precedence undefined (OQ asks).
13. **"Safe margin"**: 08 inspector has a Safe margin field (5 mm), 09 warns relative to "the 5 mm safe margin" — today print props have `bleedMm` only; safe margin as a stored prop is NEW (08 Advanced code snippet doesn't include it either).
14. **Photo sliders**: 12 photo inspector has Light/Colour + Looks; 07 drew nothing for photo/clip grade; 12 Advanced "sliders · grain · mask" holds today's 8 sliders, duotone, grain, pattern, mask. Pattern and Duotone mapping to "Club green" look must be defined.
15. **"Move to trash" wording**: tile menu "Move to trash"; Not used "Move 31 to the trash…"; CONTRACT §7 "moved to the trash". Minor — standardise.
16. **Generate key/billing**: 12 says "billed to your Google key" / "the cloud plan doesn't include them" — fine, but CONTRACT §7 AI = Claude account; generation uses separate provider keys in Settings (today Settings › AI generation tab; v2 Settings has only General · Connections · Advanced — keys must land in Connections).
17. **06 path drift**: 12 header notes 06 `ad-sync-wait` still lists "assets/footage/combine-40yd.mov · 412 MB" — should be "assets/7c40e2b1.mov · 412 MB".

### Ambiguities / gaps

- Transcript panel entry point (07) — which action opens it, and does it replace the Canvases panel in the left slot?
- "F + drag skips the picker" — what kind does a drawn artboard get? (Probably Fixed size.) Also Edit › Advanced ▸ New artboard preset list (Desktop · Laptop · Tablet · Mobile · A4 · Letter) must reconcile with picker groups (web vs app Desktop?).
- AI cut target: does AI create the "Recap · Reels" artboard itself, or must the user create/select it first? [ve-ai-watch] shows it already present and selected with "AI is watching footage".
- Linked formats: what exactly propagates (clips, trims, titles text) vs per-format (framing, text position, safe zone)? Adding a 4th format from Formats list — which presets?
- "Sound only" output format/codec not specified (mp3? m4a? wav?).
- Captions "As a file" → .srt only? (07 Advanced shows `srt`); Captions Burned-in styling = captions inspector.
- Exports panel when nothing ran: Exports icon always present in Share cluster or only when history exists? (09 draws it at rest with no ring in [ex-history].)
- "Save to" choices beyond Downloads; Tauri native folder picker vs browser downloads in cloud tab.
- File-name template is global, per project, or per export? Where persisted.
- Folder scope count semantics: [ex-social] Folder = 115, [ex-canvas] Folder = 38 — counts are artboards in the canvas's folder; Whole project 524 everywhere (good) but Studio site web counts "—" for folder.
- Handoff targets "from the project settings" — the settings UI for defining targets isn't drawn.
- Search-in-pictures cost disclosure (238 looks on the user's Claude account) — any rate limit/progress UI beyond the foot line?
- Brand import "Use as the project's style" vs CONTRACT §7 Design-system canvas review ("Update N canvases") — does brand import go through that review?
- Per-use photo edits identity key: "social/matchday#post-mvp-zapasu" — keyed by canvas + artboard; what if the same photo appears twice on one artboard?
- Asset tile "Place" for a clip when no video artboard is selected — behaviour undefined.
- Generate "best of four" — who ranks (AI judge) and is it shown why?

### Easy to forget

- Timeline **remembers playhead per video**; slides with motion (use `--dur-panel`, reduced-motion collapse).
- Timeline compact positioning clamps to window; must re-anchor on pan/zoom of the canvas (notch follows artboard centre).
- ⌘\ hides timeline + Exports panel with all panels.
- AI shots never move the user's playhead; Stop keeps placed shots; AI run = one undo step; hand edits undone first.
- Safe zones, print guides, AI tags, label warnings, "Made by AI" marks — **never exported**; annotations export only when "Include annotations" ticked; **print files never carry annotations**.
- User designs pinned light (`.k-fixed`) — captures/exports must not flip theme.
- Print colour line exact: "RGB — the print shop converts to CMYK." (no CMYK option in v2).
- 300 dpi print PDF default (today 96).
- Viewers can export; Handoff needs Can edit; Copy link available to viewers.
- Every tile placeable by keyboard; tile names visible on keyboard focus (a11y).
- Content-addressed dedupe message ("placed the same one, not a copy").
- "Waiting for X's Mac" is never an error colour; only "Missing" is.
- Exports history: last 20, day groups, searchable via ⌘K "Exports".
- Tabular figures for all live numbers (time, %, sizes) — CONTRACT §5.
- Advanced-only mono: EDL/code, file paths, commands, render settings — never in the plain layer.
- Partial export accounting must never say "Exported 115" beside a failure.
- Local projects: link features route to "Move to cloud…".
- Combine-kampan real counts (21 = 19 fixed + 2 print) used across 08/09 — test fixture candidate.

### Known bugs referenced

1. **Fixed artboards lose 24 px** (canvas-lib): a `fixed` artboard counts its 24 px label strip inside its height, so the page loses its bottom 24 px ([ak-real-about]; OQ "Found bugs"). Real print artboard drawn without `fixed` as a workaround. Must fix before print/fixed-size exports are trusted.
2. **CLI print-PDF options ignored**: `maude design export pdf --option marks=crop` — `cli/commands/design.mjs` coerces only `true/false` strings, so `marks` arrives as the string `"crop"`, while `exporters/pdf.ts` expects `marks: { crop: true, registration, colorBars, pageInfo }` → marks silently dropped (and numeric options like `scale=2` arrive as strings). The command shown in 09 [ex-advanced] would not produce crop marks today. Also from OQ: `export zip` without `--scope` is rejected.
3. **⇧⌘E means two things**: shell = open Export dialog; canvas iframe = ⌘⇧E re-run last export (and ⌘E opens the in-canvas dialog; palette/context menu label "⌘E"). v2: single meaning per CONTRACT §1 (⇧⌘E Export…), delete the in-canvas dialog + ⌘E.
4. Combine-kampan score card hand-typed 1144 px (1 px off A4 landscape + bleed 1145) — real data that the "Fix size" warning should catch ([ak-warnings]).
5. Print PDF 96 dpi default (today) vs 300 dpi intended ([ak-advanced]).
