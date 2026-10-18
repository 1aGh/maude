// client/v2/export/advanced/advanced-copy.js — S8.3: every word the Export sheet's Advanced fold says
// (09 ex-advanced; CONTRACT §3–§4). Plain data, so the words lint reads them without mounting anything.

export const FOLD_HINT = 'File names, colour, scale';
export const FOLD_HINT_BATCH = 'File names, colour, per-canvas choices';

// ── image ────────────────────────────────────────────────────────────────────────────────────────
export const IMAGE_TITLE = 'Image — PNG · JPG';
export const SIZE_BY = 'Size by';
export const EXACT_SCALE = 'Exact scale';
export const EXACT_DPI = 'Exact dpi';
export const SIZE_NOTE =
  'Pick dpi for a print size (150 · 300 · 600); the one you pick here wins over the sheet’s 1× / 2×.';
export const COLOUR_PROFILE = 'Colour profile';
export const COLOUR_NOTE =
  'sRGB for Instagram and browsers; Display P3 keeps the brighter greens on Apple displays.';
export const JPG_QUALITY = 'JPG quality';
export const BACKGROUND = 'Background';

// ── print ────────────────────────────────────────────────────────────────────────────────────────
export const PRINT_TITLE = 'Print PDF';
export const IMAGES_INSIDE = 'Images inside';
export const BLEED = 'Bleed';
export const CROP_MARKS = 'Crop marks';
export const PRINT_COLOUR_NOTE =
  'RGB — the print shop converts to CMYK. If they ask for a profile, use theirs.';

// ── video ────────────────────────────────────────────────────────────────────────────────────────
export const VIDEO_TITLE = 'Video — MP4 · GIF · WebM';
export const FRAME_RATE = 'Frame rate';
export const FRAME_RATE_MADE = 'As made';
export const BITRATE = 'Bitrate';
export const BITRATE_AUTO = 'Automatic';
export const CODEC = 'Codec';
export const CODEC_WORDS = { mp4: 'H.264 (MP4)', webm: 'VP9 (WebM)', gif: 'GIF' };
export const VIDEO_NOTE = 'Size is the sheet’s Quality. WebM uses VP9.';

// ── where it renders ─────────────────────────────────────────────────────────────────────────────
export const RENDER_TITLE = 'Where it renders';
export const RENDER_VIDEO = 'Video';
export const RENDER_NOTE_VIDEO =
  'The sheet suggests the cloud for 4K and long videos; you choose. Or: always the cloud · always this Mac.';
export const RENDER_NOTE_IMAGES = 'Images and PDFs always export on this Mac, in seconds.';
export const RENDER_SERVICE = 'Render service';
export const RENDER_STATUS = 'Status';
export const RENDER_SERVICE_NAME = 'maude-render';

// ── file names and the command ───────────────────────────────────────────────────────────────────
export const NAMES_TITLE = 'File names';
export const NAMES_LABEL = 'File name pattern';
export const NAMES_PREVIEW = 'For example';
export const COMMAND_TITLE = 'The same export from a terminal';
export const COMMAND_COPY = 'Copy';
export const COMMAND_COPIED = 'Copied';
export const COMMAND_NOTE = {
  cli: 'Terminal',
  claude: 'Claude Code',
};
