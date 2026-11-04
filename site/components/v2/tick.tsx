import type { ReactNode } from 'react';
import { Icon } from './kit/glyphs';

/** One list line with a check (or, for what a thing is not, a cross). */
export function Tick({ no = false, children }: { no?: boolean; children: ReactNode }) {
  return (
    <li>
      <span className={no ? 'ps-x' : 'ps-t'}>
        <Icon name={no ? 'close' : 'check'} size={14} />
      </span>
      <span>{children}</span>
    </li>
  );
}
