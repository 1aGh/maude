'use client';

import { usePlatform } from '@/components/mdcc/platform';

const WORD = { macos: 'Mac', windows: 'Windows', linux: 'Linux' } as const;

/** "Download for Mac" follows the visitor's platform; the server render says Mac (never empty). */
export function DownloadLabel({ suffix = '' }: { suffix?: string }) {
  const platform = usePlatform();
  const p = platform === 'unknown' ? 'macos' : platform;
  return <>{`Download for ${WORD[p]}${suffix}`}</>;
}
