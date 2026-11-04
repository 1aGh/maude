import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Cloud Phase 24 A8/A9. The legal pack lives in the docs tree (one content
  // system, one search index), but Google's OAuth consent screen and the
  // checkout wizard both want short, memorable, permanent addresses — and a
  // legal URL that moves is a legal URL that 404s in somebody's records. These
  // three are the canonical entry points; the docs paths are where they live.
  async redirects() {
    return [
      // The v2 site names the page Maude Cloud; the old address keeps working.
      { source: '/pricing', destination: '/cloud', permanent: true },
      { source: '/terms', destination: '/docs/legal/terms', permanent: false },
      { source: '/privacy', destination: '/docs/legal/privacy', permanent: false },
      { source: '/dpa', destination: '/docs/legal/dpa', permanent: false },
    ];
  },
};

export default withMDX(config);
