## Trimming, moving, dropping footage and the clip menu (Maude 2)

Everything a person does with the pointer on the Timeline is written to the comp as literal props, so an agent
makes the same edit by changing the same props. In the studio each gesture is ONE edit op (one write, one undo
step: ⌘Z takes back exactly that gesture), refused below Can edit.

| The person… | The comp changes | Edit op |
| --- | --- | --- |
| drags a clip's right edge | that `<Sequence>` / `<TransitionSeries.Sequence>` `durationInFrames`; the beats after it close up and the comp's `durationInFrames` follows the last clip | `clip.retime` |
| drags a layer sideways | that standalone `<Sequence>`'s `from` (a series beat has no `from`; the series computes its place) | `clip.retime` |
| drags a beat to a new place | the beat moves before or after another beat, **with its transition**, so the beat / transition alternation holds | `clip.move` |
| drops footage on the timeline | a new `<Sequence>` holding the media: a beat at the caret, or a layer at the playhead; the comp grows by its length | `clip.insert` |
| drops footage on the artboard | the same, at the end of the video | `clip.insert` |
| presses S (or ⌘B) | the clip under the playhead becomes two sequences at that frame | `clip.split` |

The video is as long as its clips. Trim a 3 s beat by 0.6 s and the video is 0.6 s shorter; a layer that reaches
past the last beat keeps the video that long. Dropping three clips is one `clip.insert` with `items`, not three.

### The clip menu

Right-clicking a clip offers 17 rows. Six are drawn (comment, generate for an AI slate, adjust, hide / show,
remove) and eleven sit under Advanced ▸ (replace, mute / unmute, detach audio, move to the overlay layer or the
storyline, layer up / down, move earlier / later, replace a layer's media). Each is a registry action
`timeline.clip-menu.<row>`; an agent does the same by editing the props named in `maude design help`:
`muted` on the clip's `<Video>`, a `{false && …}` gate around a hidden clip's body, the order of the standalone
`<Sequence>`s for the stacking order, and `src` for a replace.
