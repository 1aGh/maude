import { Analytics } from '@vercel/analytics/next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google';
import { appName, gitConfig, siteUrl } from '@/lib/shared';
import stats from '@/lib/stats.json';
import './global.css';

// maude type system — Inter (body/UI), Inter Tight (display headings),
// JetBrains Mono (code + numerics). Wired to --font-body / --font-display /
// --font-mono in global.css. See DDR-09X token retarget.
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mdcc-mono',
  weight: ['400', '500', '700'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const interTight = Inter_Tight({
  subsets: ['latin'],
  variable: '--font-inter-tight',
  weight: ['500', '600', '700'],
  display: 'swap',
});

// Site-wide structured data (schema.org). Disambiguates "Maude" (this Claude
// Code toolkit) from the many other "Maude" entities — the rewriting-logic
// language, getmaude.com, etc. — for search engines and AI answer engines.
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${siteUrl}/#website`,
      url: `${siteUrl}/`,
      name: 'Maude',
      description: 'A Mac app for designing with AI. Real files, real git.',
      inLanguage: 'en',
      publisher: { '@id': `${siteUrl}/#person` },
    },
    {
      '@type': 'Person',
      '@id': `${siteUrl}/#person`,
      name: 'Michal Dovrtěl',
      url: `${siteUrl}/about`,
      sameAs: [`https://github.com/${gitConfig.user}`],
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${siteUrl}/#software`,
      name: appName,
      alternateName: '@1agh/maude',
      applicationCategory: 'DesignApplication',
      applicationSubCategory: 'Desktop app for designing with AI',
      operatingSystem: 'macOS, Windows, Linux',
      softwareVersion: stats.version.replace(/^v/, ''),
      description:
        'A desktop app for designing with AI. Canvases are real TSX files in your git repo, so the work does not disappear with the chat. Also ships as two Claude Code plugins (design + flow), a CLI and an optional self-hosted sync hub. Open-source, MIT, no telemetry.',
      url: `${siteUrl}/`,
      downloadUrl: `${siteUrl}/desktop`,
      installUrl: 'https://www.npmjs.com/package/@1agh/maude',
      codeRepository: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
      license: 'https://opensource.org/licenses/MIT',
      isAccessibleForFree: true,
      author: { '@id': `${siteUrl}/#person` },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'maude, how it works mostly',
    template: '%s | maude',
  },
  description:
    'A Mac app for designing with AI. Built around AI, not bent to fit one: real files, real git history, a real design system. Download it, or install the plugins and CLI from a terminal.',
  openGraph: {
    title: 'maude',
    description:
      'A Mac app for designing with AI. Built around AI, not bent to fit one: real files, real git history, a real design system.',
    type: 'website',
    siteName: 'maude',
  },
  twitter: { card: 'summary_large_image' },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${jetbrains.variable} ${inter.variable} ${interTight.variable} mdcc`}
      data-theme="light"
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static, build-time JSON-LD structured data
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <a className="mdcc-skip-link" href="#main-content">
          Skip to main
        </a>
        <RootProvider>{children}</RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
