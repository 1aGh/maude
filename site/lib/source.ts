import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { PRICE } from '@/components/v2/price';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
});

export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `${docsImageRoute}/${segments.join('/')}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: `${docsContentRoute}/${segments.join('/')}`,
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  // <CloudPrice of="…" /> renders a generated price on the page; the markdown copy gets the value.
  const processed = (await page.data.getText('processed')).replace(
    /<CloudPrice of="(\w+)" \/(?:>|&#x3E;)/g,
    (_, k: keyof typeof PRICE) => (k.endsWith('Gb') ? `${PRICE[k]} GB` : String(PRICE[k] ?? ''))
  );

  return `# ${page.data.title} (${page.url})

${processed}`;
}
