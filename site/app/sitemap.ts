import type { MetadataRoute } from 'next';
import { PRICING_ON } from '@/components/v2/pilot';
import { siteUrl } from '@/lib/shared';
import { source } from '@/lib/source';

export const revalidate = false;

type ChangeFreq = NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;

// Static, hand-maintained routes. `/whats-new` is intentionally absent — it is a
// permanent redirect to /changelog, not an indexable page.
const STATIC_ROUTES: { path: string; changeFrequency: ChangeFreq; priority: number }[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.9 },
  ...(PRICING_ON
    ? [{ path: '/cloud', changeFrequency: 'monthly' as ChangeFreq, priority: 0.8 }]
    : []),
  { path: '/changelog', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/desktop', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/roadmap', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/about', changeFrequency: 'yearly', priority: 0.4 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: new URL(route.path, siteUrl).href,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const docEntries: MetadataRoute.Sitemap = source.getPages().map((page) => ({
    url: new URL(page.url, siteUrl).href,
    lastModified,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  return [...staticEntries, ...docEntries];
}
