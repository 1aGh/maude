## Artboards of a kind (S7.20 · S12.10)

Read this before `/design:new` chooses what to draft, and whenever a request adds an artboard ("add a mobile version", "make it an A5 flyer", "a story for Instagram"). It is the same catalogue the person's size picker offers (F over empty canvas), so what you write is what a click would have written. The catalogue is `apps/studio/kinds/presets.ts`; `apps/studio/test/artboards-guide.test.ts` holds the table below to it.

### The four kinds, five groups

The product has four artboard kinds. The picker groups them by **what you are making**: App · Web page · Social · Print · Video. App and Social both make a **Fixed size** artboard, the one designer word for `kind="digital"`; never call it a screen.

| Group | Kind | What it is | Layout |
| --- | --- | --- | --- |
| App | Fixed size (`digital`) | An app screen at exact pixels | Flow-first for screens; every box is placed |
| Web page | Web page (`web`) | A page that grows: the height is a floor | Flow-first, `@container` for reflow, never `vw` / `vh` |
| Social | Fixed size (`digital`) | A post, story or cover at exact pixels | Absolute-first: the person drags things anywhere |
| Print | Print (`print`) | A sheet of paper: the px size is trim + 2 × bleed | Absolute-first, backgrounds to the bleed edge, content inside the safe margin |
| Video | Video (`video`) | A moving picture with a length; selecting it brings the timeline | Frame-driven, in a `<VideoComp>` (skill `video-comp`) |

### The presets

Use a preset's exact numbers. Never guess a px size and never write `paper: "custom"` (Maude 1 throws on it).

| Group | Preset | id | The `<DCArtboard>` |
| --- | --- | --- | --- |
| App | Desktop | `app-desktop` | `<DCArtboard id="desktop" label="Desktop" kind="digital" fixed width={1440} height={1024}>` |
| App | Laptop | `app-laptop` | `<DCArtboard id="laptop" label="Laptop" kind="digital" fixed width={1280} height={800}>` |
| App | Mobile | `app-mobile` | `<DCArtboard id="mobile" label="Mobile" kind="digital" fixed width={390} height={844}>` |
| App | Tablet | `app-tablet` | `<DCArtboard id="tablet" label="Tablet" kind="digital" fixed width={834} height={1194}>` |
| Web page | Desktop | `web-desktop` | `<DCArtboard id="web-desktop" label="Web desktop" kind="web" width={1440} height={900}>` |
| Web page | Tablet | `web-tablet` | `<DCArtboard id="web-tablet" label="Web tablet" kind="web" width={834} height={1024}>` |
| Web page | Mobile | `web-mobile` | `<DCArtboard id="web-mobile" label="Web mobile" kind="web" width={390} height={844}>` |
| Web page | Laptop | `web-laptop` | `<DCArtboard id="web-laptop" label="Web laptop" kind="web" width={1280} height={800}>` |
| Social | Post 4:5 | `social-post-4-5` | `<DCArtboard id="post-4-5" label="Post 4:5" kind="digital" fixed width={1080} height={1350}>` |
| Social | Story 9:16 (still) | `social-story` | `<DCArtboard id="story-9-16" label="Story 9:16" kind="digital" fixed width={1080} height={1920}>` |
| Social | FB event cover | `social-fb-event` | `<DCArtboard id="fb-event-cover" label="FB event cover" kind="digital" fixed width={1920} height={1005}>` |
| Social | Post 1:1 | `social-post-1-1` | `<DCArtboard id="post-1-1" label="Post 1:1" kind="digital" fixed width={1080} height={1080}>` |
| Social | Link preview | `social-link-preview` | `<DCArtboard id="link-preview" label="Link preview" kind="digital" fixed width={1200} height={630}>` |
| Social | YouTube thumbnail | `social-youtube` | `<DCArtboard id="youtube-thumbnail" label="YouTube thumbnail" kind="digital" fixed width={1280} height={720}>` |
| Print | A4 | `print-a4` | `<DCArtboard id="a4" label="A4" kind="print" print={{"paper":"a4","orientation":"portrait"}} width={816} height={1145}>` |
| Print | A5 | `print-a5` | `<DCArtboard id="a5" label="A5" kind="print" print={{"paper":"a5","orientation":"portrait"}} width={581} height={816}>` |
| Print | A6 | `print-a6` | `<DCArtboard id="a6" label="A6" kind="print" print={{"paper":"a6","orientation":"portrait"}} width={419} height={581}>` |
| Print | Letter | `print-letter` | `<DCArtboard id="letter" label="Letter" kind="print" print={{"paper":"letter","orientation":"portrait"}} width={840} height={1080}>` |
| Print | A3 | `print-a3` | `<DCArtboard id="a3" label="A3" kind="print" print={{"paper":"a3","orientation":"portrait"}} width={1145} height={1609}>` |
| Print | A2 | `print-a2` | `<DCArtboard id="a2" label="A2" kind="print" print={{"paper":"a2","orientation":"portrait"}} width={1609} height={2267}>` |
| Print | Business card | `print-business-card` | `<DCArtboard id="business-card" label="Business card" kind="print" print={{"paper":"card-eu","orientation":"portrait"}} width={343} height={230}>` |
| Print | Custom size… | `print-custom` | `<DCArtboard id="custom" label="99 × 210 mm" kind="print" print={{"paper":"dl","orientation":"portrait","sizeMm":[99,210],"bleedMm":3}} width={…} height={…}>` |
| Video | Reels 9:16 (moving) | `video-reels` | `<DCArtboard id="reels-9-16" label="Reels 9:16" kind="video" width={1080} height={1920}>` + `<VideoComp component={VideoCut} durationInFrames={150} fps={30} width={1080} height={1920} />` |
| Video | Landscape 16:9 | `video-landscape` | `<DCArtboard id="landscape-16-9" label="Landscape 16:9" kind="video" width={1920} height={1080}>` + `<VideoComp component={VideoCut} durationInFrames={150} fps={30} width={1920} height={1080} />` |
| Video | Square 1:1 | `video-square` | `<DCArtboard id="square-1-1" label="Square 1:1" kind="video" width={1080} height={1080}>` + `<VideoComp component={VideoCut} durationInFrames={150} fps={30} width={1080} height={1080} />` |

What the rows leave out, on purpose:

- **A Web page has no `fixed`.** Its height is a floor the content grows past; every other kind but Video is exact.
- **Print px = trim + 2 × bleed.** A6 is 105 × 148 mm, plus a 3 mm bleed each side, which is 419 × 581 px. Always write the paper from the table; the px follow it. A **custom size** is `print={{ paper: "<nearest larger preset>", orientation, sizeMm: [w, h], bleedMm }}`: the `paper` is the closest preset that is at least as large (never `"custom"`), `sizeMm` is the trim in millimetres (10–5000 a side), `bleedMm` is always written, and the width and height are the trim + 2 × bleed in px (`print/units.ts` `resolvePrintArtboard`).
- **A Video artboard hosts a `<VideoComp>`** with `const VideoCut = () => (<AbsoluteFill …/>)` beside it and the `VideoComp` / `AbsoluteFill` imports. The comp's length and frames are the video skill's (`design:video-comp`).
- **Ids and labels.** The id is a readable slug of the label (`fb-event-cover`, then `fb-event-cover-2` when taken), starting with a letter; a repeated label gets " 2", " 3". Every artboard in a canvas has its own id, and an id never changes once it exists.

### Adding artboards to a canvas, in this order

1. **The first artboard of a blank canvas goes in a section.** A canvas the app made (⌘N, Home, `/design:new`) has an empty `<DesignCanvas>` that imports only `DesignCanvas`. Add `<DCSection id="main" title="Main">` inside it, the artboard inside that, and extend the import to `{ DesignCanvas, DCSection, DCArtboard }` (and `VideoComp`, `AbsoluteFill` for Video). A canvas that already has a section takes the artboard at the end of the last one, and only needs `DCArtboard` in the import.
2. **Every artboard empty first, with its kind and size,** in one Edit, so the person sees the shape of the canvas at once. An empty artboard is a non-self-closing `<DCArtboard …></DCArtboard>`.
3. **Then fill them** big before small, words last ([references/new](../../references/new/16-6-generate-preferred-fallback.md) step 6).
4. **The place is not a prop.** An artboard's `x` / `y` live in `layout.artboards[]` of the canvas's `.meta.json` (`{ "id": "mobile", "x": 1600, "y": 0 }`), never on the JSX. With no entry the runtime puts it in the next free slot of its default grid, which is usually right. When several kinds sit together, ask for the spot rather than computing it: `maude design place [<canvas>] --near <artboard> --size <W>x<H> [--gap 120] --json` answers `x` / `y` clear of everything else, and `maude design layout-check [<canvas>]` reports artboards that overlap.
5. **Do not change the kind of an existing artboard by editing the prop.** Changing the kind of a finished artboard is the person's "Change kind", which makes a scaled copy beside the original; to get another size, add a new artboard of that preset and fill it. Switching a `digital` artboard to Web page, or the reverse, never converts its layout.

The longer recipe and the exact bytes are in `apps/studio/schema/canvas-tsx.md` ("Add an artboard of a kind"). The shell's picker, the `artboard.insert-preset` edit and this guide produce the same result.

### Which group, from the brief

| The brief says | Group | Notes |
| --- | --- | --- |
| a screen, an app, a dashboard, an onboarding flow, mobile / iOS / Android | App | `--mobile` or a "Mobile" name picks Mobile; a flow is one artboard per step, all the same preset |
| a landing page, a website, a homepage, a marketing site, breakpoints | Web page | one artboard per breakpoint; Desktop first, then Tablet and Mobile |
| a social post, a story, a banner, a thumbnail, an event cover, an og image | Social | pick by the platform the brief names; Post 4:5 when it names none |
| a flyer, a poster, a business card, a brochure, a paper size | Print | A4 when it names no size; A6 for a flyer or postcard, Business card for a card |
| a video, a reel, an animation, a trailer, a title sequence | Video | Reels 9:16 for vertical, Landscape 16:9 otherwise |

A request that spans groups (a campaign: a landing page, a story and a flyer) is one canvas with one artboard per piece, each from its own group.

### A new canvas

A new canvas is made by the app's own create, never by hand, so its name, its folder and its design system match what ⌘N would have made:

- **The name.** "Untitled canvas", then "Untitled canvas 2", "Untitled canvas 3"; a canvas made from a sentence takes the artifact in it ("A poster for my open studio" → "Poster"). Letters, numbers, spaces, `-` and `_` only, 60 characters at most, not starting with `_`.
- **The design system.** The project's default design system. Inside a folder whose canvases all use one system, that one; a mixed folder falls back to the default. `--ds=<name>` wins. The canvas records it as `designSystem` in its `.meta.json`, and a canvas without one cannot be switched later.
- **The folder.** A folder the project configures, `NEW_CANVAS_DIR` by default.

The steps are in `/design:new` step 3. Text you write into Maude for the person follows skill `contract-voice`.
