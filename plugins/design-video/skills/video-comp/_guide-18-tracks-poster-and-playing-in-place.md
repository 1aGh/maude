## The four tracks, the poster frame, and playing in place (Maude 2)

The Timeline that comes with a video artboard draws four tracks, top to bottom = what covers what:
**Text · Graphics · Video · Music**. They are *derived* from the comp as it is — there is nothing to
write for a track, and no comp changes bytes to get one (the same reading `video/derive.ts` makes on
the server):

| Where the clip is | Track |
| --- | --- |
| a beat of the `<TransitionSeries>` / `<Series>` (the storyline) | Video |
| a standalone `<Sequence>` holding a video or an image, or loose media under the reel | Video 2 (drawn only when something is on it) |
| a standalone `<Audio>` (a clip or a bed); a second one playing at the same time | Music; Music 2 |
| a standalone `<Sequence>` with no media of its own | Text — or Graphics when its component is named like one (a logo bug, a badge, a banner, a call to action, a URL card) |

Name a scene for what it is (`LogoBug`, `TitleDrina`) and it lands where the person expects it.

### The poster frame

`artboardMeta.<artboardId>.poster` in the canvas `.meta.json` is a whole comp frame (0 up to the
last frame). It is the picture the video artboard rests on and the frame an export carries; with no
value it is 35 % of the length. Set it by writing that key (keep every other key in the file), or
through the studio's `video.poster.set` — the playhead's frame. Match the `<VideoComp id>` to the
enclosing `DCArtboard id`, or the canvas cannot find the poster.

### Playing in place

Tapping Space on a selected video artboard plays it right on the canvas, with sound; holding Space
pans, as everywhere. With the Timeline focused: **I** and **O** set a loop range at the playhead,
**←** / **→** step a frame, **⇧←** / **⇧→** a second, **S** (or **⌘B**) splits at the playhead.
None of this is written to the file — a loop range is playback state — so there is nothing for an
agent to author; to loop a part of a video for the person, tell them the range.
