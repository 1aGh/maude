## Assets: `assets/` only, no network

Media lives in `<designRoot>/assets/` (content-addressed on drop). Reference it
**relatively** — `src="assets/<name>.mp4"`. NEVER fetch from a URL and never
inline a data: URL. Drop a video/audio file onto the canvas to upload it; large
files (>20 MB) ride git + collab sync, so keep clips lean.
