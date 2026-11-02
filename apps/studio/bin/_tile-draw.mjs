// _tile-draw.mjs — the in-page half of an asset tile (V2-8.14), run by `_thumbs-playwright.mjs`
// through `page.evaluate`. Self-contained: Playwright ships the function's SOURCE to the page, so it
// may close over nothing. Its own module so a test can run it in a page of its own choosing.
//
// A picture is decoded, scaled into a 2D canvas and encoded IN THE PAGE (no screenshot, no layout,
// no paint wait); a video frame is placed for the shim to screenshot.

/**
 * @param {[string, number, boolean]} args  picture URL, longest edge in px, is it a video
 * @returns {Promise<{ w: number, h: number, jpeg?: string } | null>}
 */
export async function drawTile([src, size, video]) {
  document.getElementById('__maude_tile')?.remove();
  const host = document.createElement('div');
  host.id = '__maude_tile';
  host.style.cssText =
    'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;margin:0;background:#fff';
  document.body.appendChild(host);
  let el;
  let w;
  let h;
  if (video) {
    el = document.createElement('video');
    el.muted = true;
    el.preload = 'auto';
    el.src = src;
    await new Promise((res, rej) => {
      el.addEventListener('loadeddata', res, { once: true });
      el.addEventListener('error', rej, { once: true });
    });
    el.currentTime = Math.min(0.5, el.duration || 0.5);
    await new Promise((res) => {
      el.addEventListener('seeked', res, { once: true });
      setTimeout(res, 2000);
    });
    if (el.readyState < 2) return null;
    w = el.videoWidth;
    h = el.videoHeight;
  } else {
    el = new Image();
    el.src = src;
    await el.decode();
    w = el.naturalWidth;
    h = el.naturalHeight;
  }
  if (!w || !h) return null;
  const s = Math.min(1, size / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  if (!video) {
    // a picture is scaled and encoded in the page: no screenshot, no layout, no paint wait
    // (the screenshot path cost ~130 ms a tile). White under transparency, as the host had.
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cw, ch);
    g.imageSmoothingQuality = 'high';
    g.drawImage(el, 0, 0, cw, ch);
    // SYNCHRONOUS encode (V2-8.14 p8-perf-814): `toBlob` runs as an idle task with a 1 s
    // fallback, and a renderer that had served canvas pages got no idle period — every tile waited
    // ~1 s (194 pictures took 52 s). A 480 px JPEG encodes in ~10 ms on the main thread.
    const url = cv.toDataURL('image/jpeg', 0.8);
    const comma = url.indexOf(',');
    if (!url.startsWith('data:image/jpeg;base64,') || comma < 0) return null;
    return { w: cw, h: ch, jpeg: url.slice(comma + 1) };
  }
  el.style.cssText = `display:block;width:${cw}px;height:${ch}px`;
  host.appendChild(el);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return { w: cw, h: ch };
}
