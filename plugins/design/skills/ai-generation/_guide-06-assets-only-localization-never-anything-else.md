## Assets-only localization (never anything else)

Every produced artifact is **downloaded into `assets/<sha8>.<ext>`** (content-addressed, magic-byte-sniffed, capped) before it is referenced anywhere. On the canvas, reference it as `assets/<sha8>.<ext>` (leading-slash `/assets/…` resolves the same from the iframe root). **Never** a `data:` URL, **never** a remote/expiring provider URL, **never** an SVG/HTML blob (rejected on save). Generated images are ordinary assets: they appear in the AssetPicker and are ⌘-click-editable in the **Photo tab**.
