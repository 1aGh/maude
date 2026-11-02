'use client';

import { type KnownPlatform, PlatformGlyph, usePlatform } from './platform';

// Compact download CTA for the docs home (`/docs`). Same platform detection +
// glyph as the desktop-page DownloadButton, trimmed to a single primary button
// plus a quiet "other platforms · about the app" line. The hrefs hit the
// /desktop/download/<platform> redirect (newest matching asset on the Release).

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

export function DownloadNative() {
  const platform = usePlatform();
  const primary: KnownPlatform = platform === 'unknown' ? 'macos' : platform;
  const others = ORDER.filter((p) => p !== primary);

  return (
    <div className="mdcc-dl mdcc-dl--compact" data-native-download>
      <a className="mdcc-dl-primary" href={`/desktop/download/${primary}`}>
        <PlatformGlyph platform={primary} />
        <span className="mdcc-dl-primary-text">
          <span className="mdcc-dl-primary-label">{LABEL[primary]}</span>
          <span className="mdcc-dl-primary-file">{FILE[primary]} · free, no signup</span>
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
        <a href="/desktop">About the desktop app</a>
      </div>
    </div>
  );
}
