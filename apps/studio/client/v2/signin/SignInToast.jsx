// client/v2/signin/SignInToast.jsx — the top toast after a sign-in (02 Onboarding ob-home-new /
// ob-edge-other-mac, S6.8). Words come from signin-model.js `signedInToast`. It speaks (role=status) and
// leaves by itself; reduced motion only removes the slide (signin.css), never the words.

import { useEffect } from 'react';

import { HIcon } from '../../home/home-icons.jsx';

export const TOAST_MS = 6000;

export function SignInToast({ text, onDone, ms = TOAST_MS }) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [text, onDone, ms]);
  return (
    <div className="si-toast island" role="status" data-testid="home-signin-toast">
      <HIcon name="done" size={16} />
      <span>{text}</span>
    </div>
  );
}
