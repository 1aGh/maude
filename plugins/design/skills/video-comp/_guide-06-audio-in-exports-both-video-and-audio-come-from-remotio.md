## Audio in exports: BOTH `<Video>` and `<Audio>` come from `@remotion/media`

MP4 export with audio goes through exactly one path — `renderMediaOnWeb`
(`@remotion/web-renderer`) — and that path supports **only `@remotion/media`
media elements**. Two elements from `remotion` are rejected outright:

| Don't import from `remotion` | Import from `@remotion/media` | Why |
| --- | --- | --- |
| `OffthreadVideo` | `Video` | rejected by the renderer |
| `Audio` | `Audio` | `remotion`'s `Audio` **IS** `Html5Audio`, rejected by the renderer |

```tsx
import { Audio, Video } from '@remotion/media';   // ← both, always

<Video src="assets/clip.mp4" trimBefore={30} trimAfter={120} volume={0.8} />
<Audio src="assets/music.mp3" volume={0.6} trimBefore={30} />
```

Both are 1:1 prop swaps (`src`, `trimBefore`, `trimAfter`, `style`, `muted`,
`playbackRate`, `volume` — including the function form of `volume`).

**Pass `disallowFallbackToHtml5Audio` when the audio is essential.**
`@remotion/media`'s `Audio` can itself fall back to `Html5Audio` under some
conditions (see its `fallbackHtml5AudioProps`), which would reopen the exact
failure this section exists to prevent.

> **This cost a real user two full export cycles** (RCA
> `issue-mp4-audio-export-html5audio-silent-degrade`). A 9:16 comp with a
> saxophone bed exported **muted** four times while the job reported `done`; the
> sibling 16:9 artboard in the same file was fine because it had no `<Audio>` at
> all. The export also ran **~40× slower** (~37 min vs ~45 s) because the
> rejection drops it onto the frame-step fallback. The export now **refuses**
> this comp up front with the one-line fix rather than degrading silently, so a
> comp authored against an older version of this page fails loudly instead of
> quietly.

**After every export that should have audio, verify the artifact, not the job
status** — a `done` status proves the render finished, not that the file is
correct:

```sh
ffprobe -v error -show_entries stream=codec_type -of csv=p=0 out.mp4
```

If `renderMediaOnWeb` hangs or fails even with `<Video>` on a complex comp
(rare, but see "Export cost & reliability" below), compose audio separately
and mux it in with `-c:v copy` so the picture stays bit-identical. For social
delivery, target **−14 LUFS / true peak below −1 dBTP**. `loudnorm` in dynamic
mode can compress loudness range without hitting the loudness target (e.g. LRA
14.9 → 4.3 while still missing −14 LUFS) — when that happens, prefer plain
`volume` + `alimiter` and dial the level by hand (the limiter's makeup gain
means *lowering* `limit` raises perceived loudness, not the reverse).
