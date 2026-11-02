// _brand-site.mjs — S8.18: read a brand's colours and fonts from its website, and answer the
// `/_api/import-brand` request (logo, website, or both).
//
// The website is UNTRUSTED on two axes, and each has one control:
//   • REACH (SSRF): every byte comes through the fetch-asset gate's `fetchPublicText` — https
//     only, port 443, public addresses only (v4 + v6, incl. a rebinding answer), the connection
//     pinned to the checked address, every redirect hop re-checked, one size + time budget, no
//     cookies, no proxy. Stylesheets are read only from the page's own site (a reach control —
//     the IP gate still applies to each), at most MAX_SHEETS of them.
//   • CONTENT (prompt injection, DDR-173 Decision 1): the page is parsed for TYPED values only —
//     colours (re-emitted as `#rrggbb`) and font names that exact-match Maude's curated allowlist
//     (`classifyFontFamilyList`). No title, description, alt text, copy or URL from the site is
//     returned, logged or put in an error, so nothing the site wrote can reach a model as text.
//     The host label shown back is the one the PERSON typed, charset-cleaned.

import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { brandColours, toHex } from './_brand-colours.mjs';
import { classifyFontFamilyList } from './_brand-fonts.mjs';
import { FetchAssetError, fetchPublicText } from './_fetch-asset.mjs';
import { ImportBrandError, importBrand } from './_import-brand.mjs';

const PAGE_MAX_BYTES = 2 * 1024 * 1024;
const SHEET_MAX_BYTES = 1024 * 1024;
const MAX_SHEETS = 4;
const TIME_BUDGET_S = 20; // the whole read — page + stylesheets ("It didn't answer in 20 s.")
const FONTS_MAX = 3;
const PALETTE_MAX = 8;

/** What the person typed → an https URL, or a `refused` FetchAssetError. `http://` is upgraded. */
export function normalizeSiteUrl(raw) {
  if (typeof raw !== 'string') throw new FetchAssetError(3, 'no website', 'refused');
  let s = raw.trim();
  if (!s || s.length > 2048 || /\s/.test(s))
    throw new FetchAssetError(3, 'not a website address', 'refused');
  if (/^http:\/\//i.test(s)) s = `https://${s.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new FetchAssetError(3, 'not a website address', 'refused');
  }
  if (u.protocol !== 'https:') throw new FetchAssetError(3, 'only websites (https)', 'refused');
  if (u.username || u.password)
    throw new FetchAssetError(3, 'an address with a password', 'refused');
  u.hash = '';
  return u.href;
}

/** A host as a short label for the sheet ("studio-brno.cz"): DNS charset only, no `www.`. */
export function siteLabel(host) {
  return (
    String(host ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9.-]/g, '')
      .replace(/^www\./, '')
      .slice(0, 253) || 'the site'
  );
}

const COLOUR_RE =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g;
const FONT_DECL_RE = /font-family\s*:\s*([^;{}]{1,400})/gi;
const HINT_RE =
  /--[\w-]*(?:primary|accent|brand)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]{1,60}\))/gi;
const GOOGLE_FONTS_RE = /https?:\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>]{1,1000}/gi;

/** Typed cues from CSS text: colour counts, accent hints, allowlisted font names. */
export function extractCssCues(css) {
  const text = String(css ?? '').slice(0, 4 * 1024 * 1024);
  const counts = new Map();
  for (const m of text.matchAll(COLOUR_RE)) {
    const hex = toHex(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const hints = new Set();
  for (const m of text.matchAll(HINT_RE)) {
    const hex = toHex(m[1]);
    if (hex) hints.add(hex);
  }
  const fontCounts = new Map();
  for (const m of text.matchAll(FONT_DECL_RE)) {
    for (const name of classifyFontFamilyList(m[1]))
      fontCounts.set(name, (fontCounts.get(name) ?? 0) + 1);
  }
  for (const m of text.matchAll(GOOGLE_FONTS_RE)) {
    for (const name of googleFontFamilies(m[0]))
      fontCounts.set(name, (fontCounts.get(name) ?? 0) + 2);
  }
  return { counts, hints, fontCounts };
}

/** Family names in a Google Fonts stylesheet URL, allowlist-matched (the URL is never fetched). */
export function googleFontFamilies(href) {
  let u;
  try {
    u = new URL(href.replace(/&amp;/g, '&'));
  } catch {
    return [];
  }
  const out = [];
  for (const fam of u.searchParams.getAll('family')) {
    for (const part of fam.split('|')) {
      const name = part.split(':')[0].replace(/\+/g, ' ');
      out.push(...classifyFontFamilyList(name));
    }
  }
  return out;
}

const ATTR = (name) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
const attrOf = (tag, name) => {
  const m = ATTR(name).exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
};

/** The page's own CSS (`<style>`, `style=""`), its stylesheet links, its theme colour. */
export function extractHtmlCues(html, baseUrl) {
  const text = String(html ?? '').slice(0, PAGE_MAX_BYTES);
  const css = [];
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css.push(m[1]);
  let n = 0;
  for (const m of text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    css.push(m[1] ?? m[2] ?? '');
    if (++n > 2000) break;
  }
  const sheets = [];
  let themeColour = null;
  for (const m of text.matchAll(/<(link|meta)\b[^>]*>/gi)) {
    const tag = m[0];
    if (m[1].toLowerCase() === 'meta') {
      if ((attrOf(tag, 'name') ?? '').toLowerCase() === 'theme-color') {
        themeColour = toHex(attrOf(tag, 'content') ?? '') ?? themeColour;
      }
      continue;
    }
    const rel = (attrOf(tag, 'rel') ?? '').toLowerCase().split(/\s+/);
    const href = attrOf(tag, 'href');
    if (!href || !rel.includes('stylesheet')) continue;
    let abs;
    try {
      abs = new URL(href.replace(/&amp;/g, '&'), baseUrl).href;
    } catch {
      continue;
    }
    if (/^https?:\/\/fonts\.googleapis\.com\//i.test(abs)) css.push(`@import url(${abs});`);
    else sheets.push(abs);
  }
  return { css: css.join('\n'), sheets, themeColour };
}

/** A stylesheet may be read only from the page's own site: the same host, or the typed host and
 *  its subdomains (www.studio.cz → studio.cz, cdn.studio.cz). */
export function sameSite(sheetUrl, pageHost) {
  let h;
  try {
    h = new URL(sheetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  const site = String(pageHost)
    .toLowerCase()
    .replace(/^www\./, '');
  return h === pageHost.toLowerCase() || h === site || h.endsWith(`.${site}`);
}

/**
 * Read a website for brand cues. Returns `{ host, palette: [{value, count, hint}], fonts }` —
 * typed values only. Throws a FetchAssetError whose `kind` says why (refused, timeout, …).
 */
export async function readBrandSite({ url, deps, maxTime = TIME_BUDGET_S }) {
  const started = Date.now();
  const target = normalizeSiteUrl(url);
  const page = await fetchPublicText({
    url: target,
    maxBytes: PAGE_MAX_BYTES,
    maxTime,
    accept: ['text/html', 'application/xhtml+xml'],
    pinPort443: true,
    deps,
  });
  const html = extractHtmlCues(page.text, page.url);
  const cssTexts = [html.css];
  for (const sheet of html.sheets.filter((s) => sameSite(s, page.host)).slice(0, MAX_SHEETS)) {
    const left = maxTime - Math.ceil((Date.now() - started) / 1000);
    if (left < 2) break;
    try {
      const r = await fetchPublicText({
        url: sheet,
        maxBytes: SHEET_MAX_BYTES,
        maxTime: left,
        maxHops: 2,
        accept: ['text/css'],
        pinPort443: true,
        deps,
      });
      cssTexts.push(r.text);
    } catch {
      // one unreadable stylesheet costs its colours, never the page's
    }
  }
  const cues = extractCssCues(cssTexts.join('\n'));
  if (html.themeColour) {
    cues.hints.add(html.themeColour);
    cues.counts.set(html.themeColour, (cues.counts.get(html.themeColour) ?? 0) + 1);
  }
  const palette = [...cues.counts.entries()]
    .map(([value, count]) => ({ value, count, hint: cues.hints.has(value) ? 'accent' : null }))
    .sort((a, b) => Number(!!b.hint) - Number(!!a.hint) || b.count - a.count)
    .slice(0, PALETTE_MAX);
  const fonts = [...cues.fontCounts.entries()]
    .filter(
      ([name]) => !/^(serif|sans-serif|monospace|system-ui|ui-[a-z-]+|cursive|fantasy)$/.test(name)
    )
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, FONTS_MAX);
  return { host: siteLabel(new URL(target).hostname), palette, fonts };
}

const SITE_ERROR_STATUS = 422;

function siteFailure(err, rawUrl) {
  let host = 'the site';
  try {
    host = siteLabel(new URL(normalizeSiteUrl(rawUrl)).hostname);
  } catch {
    // an address that does not parse keeps the generic label
  }
  const reason = err instanceof FetchAssetError ? err.kind : 'unreachable';
  return { ok: false, host, reason };
}

const json = (status, body) => ({ status, body });

/**
 * The body of `POST /_api/import-brand` (http.ts keeps the method / CSRF / host / role guards).
 * `{ assetPath }` (v1: a server-generated `assets/<sha8>.svg` from /_api/import-asset), `{ url }`
 * (a website), or both. The logo's result keeps its v1 top-level shape; the site's goes under
 * `site`; `colours` is the merged, named, role-tagged list.
 */
export async function importBrandRequest(body, { repoRoot, designRel, deps } = {}) {
  const assetPath = body?.assetPath;
  const url = body?.url;
  if (assetPath === undefined && url === undefined) {
    return json(400, { ok: false, error: 'give assetPath (a logo) or url (a website)' });
  }
  if (url !== undefined && (typeof url !== 'string' || url.length > 2048)) {
    return json(400, { ok: false, error: 'url must be a website address' });
  }
  let logo = null;
  if (assetPath !== undefined) {
    if (typeof assetPath !== 'string' || !/^assets\/[a-z0-9]{8}\.svg$/.test(assetPath)) {
      return json(400, {
        ok: false,
        error: 'assetPath must be a server-generated assets/<sha8>.svg path',
      });
    }
    const designAbs = resolve(repoRoot, designRel);
    const resolvedAsset = resolve(designAbs, assetPath);
    if (!resolvedAsset.startsWith(resolve(designAbs, 'assets') + sep)) {
      return json(400, { ok: false, error: 'assetPath escapes the assets directory' });
    }
    if (!existsSync(resolvedAsset)) {
      return json(404, { ok: false, error: 'that logo is not in assets/' });
    }
    try {
      logo = await importBrand({
        sanitizedSvgPath: resolvedAsset,
        root: repoRoot,
        designRootRel: designRel,
      });
    } catch (err) {
      const code = err instanceof ImportBrandError ? err.code : 1;
      const status =
        code === 3
          ? 400
          : code === 4
            ? 404
            : code === 6
              ? 500
              : err instanceof ImportBrandError
                ? 400
                : 500;
      return json(status, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  let site = null;
  if (url !== undefined) {
    try {
      site = { ok: true, ...(await readBrandSite({ url, deps })) };
    } catch (err) {
      site = siteFailure(err, url);
    }
  }
  if (!logo && site && !site.ok) {
    return json(SITE_ERROR_STATUS, { ok: false, code: 'site-unreadable', site });
  }
  const colours = brandColours({ logo: logo?.palette ?? [], site: site?.ok ? site.palette : [] });
  return json(201, {
    ok: true,
    ...(logo ?? {}),
    ...(site ? { site } : {}),
    colours,
    // the logo's lettering is drawn as shapes when it carried no live <text>
    logoLettering: logo ? (logo.hadWordmarkText ? 'text' : 'shapes') : null,
  });
}
