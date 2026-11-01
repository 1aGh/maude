/**
 * @file       video-natural.ts — what a video file is, and how big it lands on a canvas
 * @scope      apps/studio/video-natural.ts
 * @purpose    r3 (Michal: "nemůžu vkládat videa do canvas"): the one place that says which files are placeable videos
 *             (mp4 · mov · m4v · webm — what the asset route stores, `sniffAssetType` in api.ts; sound is not placed) and
 *             reads a video's size from its metadata. Shared by the Image (I) picker (client/v2/shell/image-pick.js) and the
 *             Finder drop (editing/finder-drop.tsx), so both place a video the same way: the same `image.place` write,
 *             the same size. DOM-light and React-free; nothing here trusts the file — the server sniffs the bytes.
 */

const VIDEO_NAME = /\.(mp4|mov|m4v|webm)$/i;
const VIDEO_TYPE = /^video\/(mp4|quicktime|x-m4v|webm)$/i;

type Typed = { type?: string; name?: string };

/** Is this file a placeable video? The type says so; a file the system could not type is judged by its extension. */
export function isVideoFile(f: Typed | null | undefined): boolean {
  if (!f) return false;
  const type = String(f.type ?? '');
  if (type !== '') return VIDEO_TYPE.test(type);
  return VIDEO_NAME.test(String(f.name ?? ''));
}

/** Does this file NAME look like a placeable video? (the native picker hands names, not typed files) */
export const isVideoName = (name: string): boolean => VIDEO_NAME.test(name);

/** The longest side a placed video is measured at: a 4K clip lands as big as a big picture, not wider than a page. */
export const VIDEO_MAX_SIDE = 1280;

/** `size` scaled down (never up) so its longer side is at most {@link VIDEO_MAX_SIDE}, aspect kept. */
export function fitVideoSize(size: { w: number; h: number }): { w: number; h: number } {
  const k = Math.min(1, VIDEO_MAX_SIDE / Math.max(size.w, size.h));
  return { w: Math.max(1, Math.round(size.w * k)), h: Math.max(1, Math.round(size.h * k)) };
}

/** A video's size from its metadata, fitted; null when the file cannot be read (then no size is sent). Never rejects. */
export async function videoNaturalOf(file: unknown): Promise<{ w: number; h: number } | null> {
  try {
    if (
      typeof document === 'undefined' ||
      typeof URL === 'undefined' ||
      !URL.createObjectURL ||
      typeof Blob === 'undefined' ||
      !(file instanceof Blob)
    )
      return null;
    const url = URL.createObjectURL(file);
    try {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const size = await new Promise<{ w: number; h: number } | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 4000);
        v.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve(
            v.videoWidth > 0 && v.videoHeight > 0 ? { w: v.videoWidth, h: v.videoHeight } : null
          );
        };
        v.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        v.src = url;
      });
      return size ? fitVideoSize(size) : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
