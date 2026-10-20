## Music: beats, Snap to the beat, Lower under speech, Cut to the beat (Maude 2)

A song on the Music track knows its beat. The Timeline draws a tick on every beat (a tall one on every
bar when the analysis was sure of the bar), the tempo on the clip ("120 BPM"), and — when the song sits
in a `<Duck>` — the volume line dipping under speech. All of it is **derived** from the comp and the
song's `assets/<sha8>.beats.json` (see the sidecars guide): nothing here is written to the comp, so it
follows every trim, move and speed change.

| What the person sees | What an agent writes |
| --- | --- |
| Find the beat (a new song gets it on its own) | `maude design beats assets/<song>` — writes the sidecar; `--bpm N` re-tracks at that tempo and keeps the bar phase. **Half** / **Double** in the inspector are `--bpm` at half and twice the detected tempo (an octave fix) |
| Volume | the literal `volume={0.8}` on the one music `<Audio>` (`video.music.volume`; 1 removes the prop). A bed under the whole video and a song that is a clip of its own are written the same way |
| Lower under speech | wrap that `<Audio>` in `<Duck db={-12} attackMs={200} releaseMs={400}>` (`video.music.duck`; turning it off unwraps). It is on by default when the video has speech: add the `<Duck>` when you add music to a comp whose clips have a transcript |
| Snap to the beat | `artboardMeta.<artboardId>.snap` in the canvas `.meta.json`: `"beat"` or `"off"` (`video.snap`; the studio writes it through the same route as the poster). Absent = on when a song has a clear beat |
| Cut to the beat | `maude design cut-to-beat <canvas>#<artboard> [--every 1\|2\|4]` — each cut between two storyline shots rolls to the nearest beat within half a beat; the video stays the same length, and a cut with no spare footage stays where it is and is reported |

A song with no clear beat (tempo strength under 0.15) has no ticks to land on: Snap to the beat stays
off and Cut to the beat is not offered. Do not invent beats — a fake grid makes every cut wrong.

Read the same numbers the Timeline draws with `GET /_api/comp-media?canvas=<rel>&artboard=<id>`: its
`music[]` lists each song with its `grid` (`bpm`, `bpmSource`, `beats` and `bars` as comp frames), its
`volume` and its `duck`; `speech[]` is where the music dips.
