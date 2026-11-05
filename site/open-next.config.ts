// OpenNext config for the Cloudflare Workers build (`pnpm cf:build`).
//
// The site is fully prerendered (every page, the OG cards, llms.txt, the sitemap),
// with no ISR and no on-demand revalidation. So the incremental cache is the
// read-only one that serves those prerendered entries out of the Worker's own
// static assets: no R2 bucket, no KV namespace, nothing to create in the account.
// If a page ever needs `revalidate`, switch to the R2 cache
// (https://opennext.js.org/cloudflare/caching) and add the bucket to wrangler.jsonc.
import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
