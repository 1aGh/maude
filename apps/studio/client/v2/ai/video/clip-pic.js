// client/v2/ai/video/clip-pic.js — S7.15: where a picture of a clip comes from. The studio serves the project's
// files under `/<designRel>/…`; a clip's first frame is the same file with a media fragment, so no thumbnail
// route is needed and nothing is cached on the side.

/** `/.design/assets/9f3a.mp4` for `assets/9f3a.mp4`. */
export function assetUrlOf(designRel, asset) {
  const rel = String(designRel || '.design').replace(/^\/+|\/+$/g, '');
  return `/${rel}/${String(asset).replace(/^\/+/, '')}`;
}

/** The first frame of a video url (a media fragment: the player seeks there and shows it). */
export const posterSrc = (url) => (url ? `${url}#t=0.1` : '');
