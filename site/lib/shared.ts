export const appName = 'maude';

/** The canvas lede, used for the home title, descriptions and the llms.txt intro. */
export const tagline = 'A design canvas built around AI, not bent to fit one.';
export const siteDescription = `${tagline} Draw it yourself or ask AI. Every design is a real file, in a project that is yours.`;

// Canonical production origin — used for metadataBase, sitemap.xml, and JSON-LD
// absolute URLs. Prefer the per-deploy env override; fall back to the real
// production domain so canonical / OG URLs stay correct even when the env var
// is unset (previously this fell back to localhost / the *.vercel.app URL,
// which would have leaked preview origins into canonical tags).
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://maude.sh';

export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const gitConfig = {
  user: '1aGh',
  repo: 'maude',
  branch: 'main',
};
