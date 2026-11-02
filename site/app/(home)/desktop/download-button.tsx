'use client';

import { type KnownPlatform, PlatformGlyph, usePlatform } from '@/components/mdcc/platform';

// Platform-detected download button (Phase 32 / Task 3). Detects the visitor's OS
// and promotes the matching installer; the other platforms stay available as
// secondary links. The hrefs hit /desktop/download/<platform>, a tiny redirect
// that resolves the latest matching asset on the GitHub Release (falls back to the
// releases page). Rendered client-side because OS detection needs `navigator`.

const ORDER: KnownPlatform[] = ['macos', 'windows', 'linux'];
const LABEL: Record<KnownPlatform, string> = {
  macos: 'Download for Mac',
  windows: 'Download for Windows',
  linux: 'Download for Linux',
};
const SHORT: Record<KnownPlatform, string> = {
  macos: 'macOS',
  windows: 'Windows',
  linux: 'Linux',
};
const FILE: Record<KnownPlatform, string> = {
  macos: '.dmg · Apple Silicon & Intel',
  windows: '.msi · 64-bit',
  linux: '.deb · Debian/Ubuntu',
};

export function DownloadButton() {
  const platform = usePlatform();
  // Default to macOS for unknown/SSR so the primary CTA is never empty.
  const primary: KnownPlatform = platform === 'unknown' ? 'macos' : platform;
  const others = ORDER.filter((p) => p !== primary);

  return (
    <div className="mdcc-dl">
      <a className="mdcc-dl-primary" href={`/desktop/download/${primary}`}>
        <PlatformGlyph platform={primary} />
        <span className="mdcc-dl-primary-text">
          <span className="mdcc-dl-primary-label">{LABEL[primary]}</span>
          <span className="mdcc-dl-primary-file">{FILE[primary]}</span>
        </span>
        <svg className="mdcc-dl-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"
          />
        </svg>
      </a>
      <div className="mdcc-dl-alt">
        {others.map((p) => (
          <a key={p} href={`/desktop/download/${p}`}>
            {SHORT[p]}
          </a>
        ))}
        <span aria-hidden="true">·</span>
        <a href="https://github.com/1aGh/maude/releases/latest" target="_blank" rel="noreferrer">
          All downloads
        </a>
      </div>
    </div>
  );
}
