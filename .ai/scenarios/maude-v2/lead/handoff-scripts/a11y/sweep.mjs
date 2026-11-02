// Manual contrast sweep: real text vs the pixels actually behind it (text hidden, screenshot, sample).
// usage: node sweep.mjs <label> — the page must already be in the state to measure (the caller drives it).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as d from './drv.mjs';

const COLLECT = `(() => {
  const out = [];
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const p = cx.getImageData(0, 0, 1, 1).data; return { r: p[0], g: p[1], b: p[2], a: p[3] / 255 }; };
  const walk = (doc, ox, oy, where) => {
    const view = doc.defaultView;
    for (const el of doc.querySelectorAll('body *')) {
      if (el.closest('.dc-artboard-body')) continue;
      if (['SCRIPT','STYLE','NOSCRIPT','svg','path'].includes(el.tagName)) continue;
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
      own = own.replace(/\\s+/g, ' ').trim();
      if (!own) continue;
      const cs = view.getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      // the text's own box, not the element's (a round avatar's corners are not behind its letter)
      const rg = doc.createRange();
      let tr = null;
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) { rg.selectNodeContents(n); const b = rg.getBoundingClientRect(); if (b.width > 0 && b.height > 0) tr = tr ? { left: Math.min(tr.left, b.left), top: Math.min(tr.top, b.top), right: Math.max(tr.right, b.right), bottom: Math.max(tr.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; }
      if (tr) {
        // clipped to the element (an ellipsised line's range runs on past its box)
        const L = Math.max(tr.left, r.left), T = Math.max(tr.top, r.top), R = Math.min(tr.right, r.right), B = Math.min(tr.bottom, r.bottom);
        r = { left: L, top: T, width: R - L, height: B - T };
      }
      if (r.width < 2 || r.height < 2) continue;
      const topEl = doc.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (topEl && !el.contains(topEl) && !topEl.contains(el)) continue; // covered by something else: what is read is that
      const x = r.left + ox, y = r.top + oy;
      if (x + r.width < 0 || y + r.height < 0 || x > innerWidth || y > innerHeight) continue;
      let op = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) op *= Number(view.getComputedStyle(e).opacity);
      if (op === 0) continue;
      // clipped away by an overflow ancestor? skip when the centre is not the element (covered by something else is fine: that is the point)
      const fg = parse(cs.color); if (!fg) continue;
      const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight) || 400;
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
      const disabled = el.closest('[disabled],[aria-disabled="true"]') !== null;
      out.push({ where, text: own.slice(0, 40), cls: (el.className && el.className.baseVal === undefined ? String(el.className) : '').slice(0, 50), tag: el.tagName.toLowerCase(), x, y, w: r.width, h: r.height, fg, op, fs, fw, large, disabled });
    }
  };
  walk(document, 0, 0, 'shell');
  for (const f of document.querySelectorAll('iframe')) {
    const fr = f.getBoundingClientRect();
    try { walk(f.contentDocument, fr.left, fr.top, 'canvas'); } catch {}
  }
  return JSON.stringify(out);
})()`;

const HIDE = `(() => {
  const css = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } input::placeholder, textarea::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }';
  const add = (doc) => { const s = doc.createElement('style'); s.id = '__hide_text'; s.textContent = css; doc.head.appendChild(s); };
  add(document);
  for (const f of document.querySelectorAll('iframe')) { try { add(f.contentDocument); } catch {} }
  return 1;
})()`;

const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export function sweep(label, { quiet = false } = {}) {
  const els = JSON.parse(d.ev(COLLECT));
  d.ev(HIDE);
  d.sleep(400);
  const png = `${d.OUT}/sweep-${label}.png`;
  d.ab('screenshot', png);
  const ident = spawnSync('magick', ['identify', '-format', '%w %h', png], { encoding: 'utf8' }).stdout.split(' ').map(Number);
  const raw = `${d.OUT}/sweep-${label}.rgb`;
  spawnSync('magick', [png, '-depth', '8', `rgb:${raw}`]);
  const buf = readFileSync(raw);
  const [W, H] = ident;
  const scale = W / 1600;
  const bad = [];
  let n = 0;
  for (const e of els) {
    if (e.disabled) continue;
    const x0 = Math.max(0, Math.floor(e.x * scale)), y0 = Math.max(0, Math.floor(e.y * scale));
    const x1 = Math.min(W - 1, Math.ceil((e.x + e.w) * scale)), y1 = Math.min(H - 1, Math.ceil((e.y + e.h) * scale));
    if (x1 <= x0 || y1 <= y0) continue;
    const ratios = [];
    let sr = 0, sg = 0, sb = 0, c = 0;
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        const i = (y * W + x) * 3;
        const br = buf[i], bg = buf[i + 1], bb = buf[i + 2];
        const a = e.fg.a * e.op;
        const fr = e.fg.r * a + br * (1 - a), fg = e.fg.g * a + bg * (1 - a), fb = e.fg.b * a + bb * (1 - a);
        ratios.push(ratio(lum(fr, fg, fb), lum(br, bg, bb)));
        sr += br; sg += bg; sb += bb; c++;
      }
    if (!ratios.length) continue;
    ratios.sort((p, q) => p - q);
    const p10 = ratios[Math.floor(ratios.length * 0.5)]; // the median: a round badge's corners are not behind its letter
    const need = e.large ? 3 : 4.5;
    n++;
    if (p10 < need) bad.push({ ...e, p10: +p10.toFixed(2), min: +ratios[0].toFixed(2), need, bg: `rgb(${Math.round(sr / c)},${Math.round(sg / c)},${Math.round(sb / c)})` });
  }
  console.log(`sweep ${label}: ${n} text elements measured, ${bad.length} under their threshold`);
  if (!quiet)
    for (const b of bad.slice(0, 40))
      console.log(`   ${b.where} <${b.tag}.${b.cls.split(' ')[0]}> "${b.text}" ${b.fs}px/${b.fw} p10=${b.p10} min=${b.min} need=${b.need} fg=rgb(${b.fg.r},${b.fg.g},${b.fg.b})@${(b.fg.a * b.op).toFixed(2)} bg~${b.bg} @${Math.round(b.x)},${Math.round(b.y)}`);
  return bad;
}
