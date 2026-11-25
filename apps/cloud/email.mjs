// Sending email — Cloud Phase 22, the invite's missing half.
//
// An invitation that only writes a row is a message nobody receives. This
// module is the ONE place the control plane talks to the email provider
// (Resend), so "which address do we send from" and "what happens when sending
// fails" are each decided exactly once.
//
// Posture:
//   - Content is built by pure functions (testable, vocabulary-lintable).
//   - `sendEmail` NEVER throws. An invitation whose email bounced is still an
//     invitation — the caller decides what to tell the person on screen, and a
//     provider outage must not turn into a 500 on a form submit.
//   - The API key is read at call time from env, never captured or logged.

/** Is sending configured at all? Absent key = local dev / tests. */
export function emailConfigured(env) {
  return Boolean(env?.RESEND_API_KEY);
}

/**
 * The sender.
 *
 * SENDING AND RECEIVING ARE DIFFERENT DOMAINS, ON PURPOSE (2026-08-01).
 * Mail goes out from the `notif.maude.sh` subdomain, which is what is verified
 * at Resend; the apex `maude.sh` carries Cloudflare Email Routing's MX so the
 * addresses printed in the legal pack actually receive. Verifying the apex for
 * sending instead would have put two systems in charge of one domain's mail.
 *
 * The default below is the FALLBACK, and it is deliberately the receiving
 * address: if `EMAIL_FROM` is ever unset, Resend refuses the send with a 403
 * rather than mail going out from a domain nobody reads. That is the failure
 * we want — this default was live for two days and every invitation silently
 * 403'd, because `sendEmail` reports rather than throws.
 */
export function fromAddress(env) {
  return env?.EMAIL_FROM || 'Maude Cloud <cloud@maude.sh>';
}

/**
 * Where a reply goes.
 *
 * A person answering an automated mail is answering a HUMAN — they have a
 * problem and they hit reply. Without this, the reply lands at the sending
 * subdomain, which has no inbox at all (`receiving: disabled` at Resend), and
 * the person hears nothing back and concludes there is nobody there.
 */
export function replyToAddress(env) {
  return env?.EMAIL_REPLY_TO || 'cloud@maude.sh';
}

/**
 * The invitation email, plain text.
 *
 * Plain text deliberately: an invite from a person reads like mail, not like
 * marketing, and text-only mail with one link has the best odds with both
 * spam filters and skeptical recipients. The link is the whole payload.
 */
export function inviteEmail({ projectName: rawProject, role, inviteUrl, invitedBy: rawBy }) {
  // Both are chosen by a person (a project name, an inviter's address/name): one line each, so neither can add a
  // header to the subject or a fake paragraph to the body (gate-b-sec3 finding 3).
  const projectName = oneLine(rawProject, 80) || 'a project';
  const invitedBy = oneLine(rawBy, 80) || 'Someone';
  const doing =
    role === 'viewer' ? 'look at the work and leave comments' : 'design and edit alongside them';
  return {
    subject: `${invitedBy} invited you to ${projectName}`,
    text: [
      `${invitedBy} invited you to the project “${projectName}” on Maude Cloud,`,
      `where you can ${doing}.`,
      '',
      'Accept the invitation here:',
      '',
      `  ${inviteUrl}`,
      '',
      'The link is yours alone and stops working after 14 days.',
      'If you were not expecting this, you can simply ignore it —',
      'nothing has been created in your name.',
    ].join('\n'),
  };
}

/**
 * "Confirm this is your address" — RCA 2026-08-04.
 *
 * Says WHY rather than just asking: a confirmation mail that gives no reason
 * reads like the ones people have learned to ignore. The reason here is
 * concrete and immediate — until the address is confirmed, the Google button
 * refuses this account, which is the exact wall the recipient just hit.
 */
export function verifyEmail({ verifyUrl }) {
  return {
    subject: 'Confirm your email address',
    text: [
      'Somebody — we think you — asked to confirm this address for Maude Cloud.',
      '',
      'Confirm it here:',
      '',
      `  ${verifyUrl}`,
      '',
      'Once it is confirmed you can also sign in with Google, using this same',
      'address, instead of typing a password.',
      '',
      'The link is yours alone and stops working after a day. If you were not',
      'expecting this, you can ignore it — nothing changes until you follow it.',
    ].join('\n'),
  };
}

/**
 * "Choose a new password."
 *
 * Deliberately does NOT confirm whether an account exists — the mail only ever
 * reaches an address that has one, and the PAGE says the same neutral sentence
 * either way (auth-routes.mjs). The pair is what closes the oracle; either one
 * alone leaks.
 */
export function passwordResetEmail({ resetUrl }) {
  return {
    subject: 'Choose a new password',
    text: [
      'Somebody asked to reset the password for your Maude Cloud account.',
      '',
      'Choose a new one here:',
      '',
      `  ${resetUrl}`,
      '',
      'The link works once and stops working after an hour. Using it also signs',
      'out anything already signed in as you, on every device.',
      '',
      'If this was not you, ignore this mail — your password has not changed,',
      'and whoever asked cannot see this message.',
    ].join('\n'),
  };
}

/**
 * `1753...` ms → `28 August 2026`. The same format the billing pages use; a
 * date that reads one way on screen and another in the inbox is a date nobody
 * trusts.
 */
function day(ms) {
  return new Date(Number(ms)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * "Your project has paused, and here is your copy" — Cloud Phase 24 B3/A11.
 *
 * THE EXPORT GUARANTEE'S ACTUAL DELIVERY. DDR-193 §3 says an export always
 * goes out before any teardown, and until this phase the reconciler computed
 * that intent and sent nothing. This is the email; it carries both halves,
 * because a pause notice with no copy attached is the notice people ignore.
 */
export function projectPausedEmail({ projectName: raw, downloadUrl, deletesAt }) {
  const projectName = oneLine(raw, 80) || 'Your project';
  return {
    subject: `${projectName} has paused`,
    text: [
      `Your subscription ended, so “${projectName}” is paused.`,
      'Nothing has been deleted.',
      '',
      `A complete copy of your work has been prepared and is waiting here:`,
      '',
      `  ${downloadUrl}`,
      '',
      `On ${day(deletesAt)} the project is deleted from our computers.`,
      'Restart it before then and everything comes back exactly as it was —',
      'same address, same people, nothing lost.',
      '',
      'The copy you download stays yours, whatever you decide.',
    ].join('\n'),
  };
}

/** The last-chance notice, two days out (canvas board E0, email 2). */
export function deletionWarningEmail({ projectName: raw, downloadUrl, deletesAt }) {
  const projectName = oneLine(raw, 80) || 'your project';
  return {
    subject: `Two days left to keep ${projectName}`,
    text: [
      `“${projectName}” will be deleted on ${day(deletesAt)}.`,
      '',
      'If you want a copy, this is the moment — it takes a minute and it is',
      'yours to keep afterwards:',
      '',
      `  ${downloadUrl}`,
      '',
      'Restarting the subscription before that date keeps everything instead.',
    ].join('\n'),
  };
}

/**
 * "<project> is free until <date>" — the one e-mail an operator's free time
 * sends (canvas 16, cl-op-account).
 *
 * `projects` is every project the gift touched, each with ITS date: free time
 * is added on top of what a project already had, so two projects of one
 * account can end on different days. One project is one sentence; several are
 * a short list — still one e-mail. No reason is quoted: the operator's reason
 * is on the project's Activity page.
 */
export function freeTimeEmail({ projects = [], billingUrl }) {
  const rows = projects.map((p) => ({
    name: oneLine(p.name, 80) || 'Your project',
    until: day(p.until),
  }));
  const one = rows.length === 1 ? rows[0] : null;
  return {
    subject: one ? `${one.name} is free until ${one.until}` : 'Your projects have more free time',
    text: [
      ...(one
        ? [`“${one.name}” is free until ${one.until}.`]
        : [
            'These projects are free for longer:',
            '',
            ...rows.map((r) => `  ${r.name} — until ${r.until}`),
          ]),
      '',
      'No card is needed and nothing changes for the people on them.',
      'After that date you pick a plan to keep editing; nothing is deleted,',
      'and everyone can still open and download everything.',
      '',
      'Plans are here whenever you want one:',
      '',
      `  ${billingUrl}`,
    ].join('\n'),
  };
}

/** "Promo ends on <date>" — sent once, PROMO_NOTICE_DAYS before the end (canvas 16, cl-promo-owner). */
export function promoEndingEmail({ projectName: raw, endsAt, billingUrl }) {
  const projectName = oneLine(raw, 80) || 'Your project';
  return {
    subject: `Promo for ${projectName} ends on ${day(endsAt)}`,
    text: [
      `“${projectName}” is on Promo until ${day(endsAt)}.`,
      '',
      'Pick a plan to keep editing after that:',
      '',
      `  ${billingUrl}`,
      '',
      'Nothing is deleted, and until you choose, everyone can still open and',
      'download everything.',
    ].join('\n'),
  };
}

/**
 * "A project was made for you" — the one e-mail the owner of an operator-made
 * project gets (canvas 16, cl-operator).
 *
 * `setPasswordUrl` is present only for an address that had no account: nobody
 * chose a password for it, so the mail carries the ordinary single-use
 * password link (email-tokens.mjs `reset`) and says how to get another once it
 * has expired. An existing account just gets the way in.
 */
export function projectMadeEmail({
  projectName: raw,
  dashboardUrl,
  setPasswordUrl = null,
  forgotUrl,
}) {
  const projectName = oneLine(raw, 80) || 'A project';
  return {
    subject: `${projectName} is ready for you on Maude Cloud`,
    text: [
      `Maude made the project “${projectName}” for you. It is yours: you decide`,
      'who is on it, and you can download everything in it at any time.',
      '',
      ...(setPasswordUrl
        ? [
            'An account was made for this address, with no password. Choose one here:',
            '',
            `  ${setPasswordUrl}`,
            '',
            'That link works once and stops working after an hour. After that, ask',
            'for a new one — or sign in with Google using this same address:',
            '',
            `  ${forgotUrl}`,
          ]
        : ['Sign in to open it:', '', `  ${dashboardUrl}`]),
      '',
      'If you were not expecting this, reply to this e-mail.',
    ].join('\n'),
  };
}

/**
 * "<project> will be deleted on <date>" — an operator scheduled the deletion
 * (D1 v23). Sent at once, before anything else happens, and again in the same
 * words when the copy is ready (`copyReady`). It says who decided, where the
 * copy is, and how to stop it: this is the ordinary thirty-day ladder, and
 * replying inside it is enough.
 */
export function deletionScheduledEmail({
  projectName: raw,
  downloadUrl,
  deletesAt,
  copyReady = false,
}) {
  const projectName = oneLine(raw, 80) || 'Your project';
  return {
    subject: `${projectName} will be deleted on ${day(deletesAt)}`,
    text: [
      `Maude support scheduled “${projectName}” for deletion. It is paused now,`,
      `and on ${day(deletesAt)} it is deleted from our computers.`,
      'Nothing has been deleted yet.',
      '',
      copyReady
        ? 'A complete copy of your work has been prepared and is waiting here:'
        : 'You can download a complete copy of your work here:',
      '',
      `  ${downloadUrl}`,
      '',
      'If this is a mistake, reply to this e-mail before that date and the',
      'project comes back exactly as it was — same address, same people.',
      'The reason is on the project’s Activity page.',
    ].join('\n'),
  };
}

/** "<name> wants to make you the owner of <project>" — the offer, never the hand-over itself. */
export function transferOfferEmail({ projectName: raw, fromName: rawFrom, acceptUrl, expiresAt }) {
  const projectName = oneLine(raw, 80) || 'a project';
  const fromName = oneLine(rawFrom, 80) || 'The owner';
  return {
    subject: `${fromName} wants to make you the owner of ${projectName}`,
    text: [
      `${fromName} offered to make you the owner of “${projectName}” on Maude Cloud.`,
      'The owner decides who is on the project, and is the one who pays for it',
      'when it has a plan.',
      '',
      'Nothing changes unless you accept. Accept or decline here:',
      '',
      `  ${acceptUrl}`,
      '',
      `The offer stops working on ${day(expiresAt)}.`,
    ].join('\n'),
  };
}

/**
 * One line of untrusted text, safe for a subject or a quote: control
 * characters and line breaks become spaces (no header can be smuggled into a
 * subject, no fake paragraph into the body), runs collapse, and anything past
 * `max` is cut with an ellipsis.
 */
export function oneLine(raw, max = 120) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  const flat = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
  const s = flat.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** How much of the comment the mention e-mail quotes (canvas 10: one sentence). */
export const MENTION_EXCERPT_MAX = 200;

/**
 * "Jonas mentioned you" — Maude v2 S9.18, canvas 10 co-mention-notify (the
 * "Maude closed" lane). One mention, one e-mail, never a digest.
 *
 * WHAT IT MAY SAY. The caller has already decided the recipient can open the
 * canvas, so the quoted words are words they could read in the thread anyway;
 * nothing else from the project travels. `fromName` is a NAME (the author's
 * address never appears), `canvasName` is null when the mention named no
 * canvas, and the excerpt is one short line or nothing.
 */
export function mentionEmail({
  fromName,
  projectName,
  canvasName = null,
  excerpt = '',
  openUrl,
  unsubscribeUrl,
  settingsUrl,
}) {
  const who = oneLine(fromName, 80) || 'Someone';
  const project = oneLine(projectName, 80) || 'your project';
  const canvas = canvasName ? oneLine(canvasName, 80) : '';
  const quote = oneLine(excerpt, MENTION_EXCERPT_MAX);
  return {
    subject: `${who} mentioned you in ${project}`,
    text: [
      canvas
        ? `${who} mentioned you on ${canvas} in ${project}.`
        : `${who} mentioned you in ${project}.`,
      ...(quote ? ['', `  “${quote}”`] : []),
      '',
      'Open in the Mac app:',
      '',
      `  ${openUrl}`,
      '',
      'Change which e-mails you get in Settings › General.',
      `  ${settingsUrl}`,
      '',
      'Or stop mention e-mails right away:',
      `  ${unsubscribeUrl}`,
    ].join('\n'),
  };
}

/**
 * Send one email through Resend. Resolves `{ ok, id?, error? }`; never throws.
 */
export async function sendEmail(env, { to, subject, text }, { fetchImpl = fetch } = {}) {
  if (!emailConfigured(env)) return { ok: false, error: 'email is not configured' };
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(env),
        reply_to: replyToAddress(env),
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      // The provider's reason goes to logs; callers get a boolean. Nothing in
      // a Resend error body belongs in front of a customer.
      const detail = await res.text().catch(() => '');
      console.warn(`[email] send to ${to} failed: ${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, error: `send failed (${res.status})` };
    }
    const body = await res.json().catch(() => ({}));
    return { ok: true, id: body?.id ?? null };
  } catch (err) {
    console.warn(`[email] send to ${to} failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
