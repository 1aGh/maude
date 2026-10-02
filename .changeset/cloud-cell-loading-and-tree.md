---
"@1agh/maude": patch
---

Cloud workspaces: the studio inside a cell no longer runs the file plane against its own hub (it pulled thousands of media files onto the disk the materializer keeps as a cache and stalled the studio for seconds every 20 s); the file tree lists media from the hub journal; canvases show an opaque loading screen until they report rendered; the image preview retries while the cloud fetches the photo; webfonts that failed on a cold cache heal themselves.
