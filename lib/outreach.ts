/**
 * Writing the first-contact email, and putting it in the queue.
 *
 * This is the link that was missing. `lib/drafts.ts` could queue a draft and
 * push it to Gmail, and `lib/prospects.ts` could fill the CRM with people
 * worth writing to — but nothing in this dashboard ever called `queueDraft`.
 * The chain read as finished and carried nothing:
 *
 *   audits synced  →  prospects in the CRM  →  ???  →  queued  →  Gmail drafts
 *                                              ^^^
 *                                          this file
 *
 * Two rules shape everything below, and both are refusals.
 *
 * **It refuses to draft without the legal footer.** US commercial email must
 * identify the sender, carry a real postal address, and offer a working way to
 * opt out. None of those can be generated, so a missing one stops the job
 * rather than producing an email with a gap in it. An email drafted without a
 * footer is an email somebody eventually sends without one, and by then the
 * omission is invisible.
 *
 * **It refuses to draft without something the reader can check.** Every email
 * opens with one specific fact about their own website — the thing the audit
 * found. A prospect whose site could not be audited has no such fact, so it
 * gets no draft. Writing to them anyway would mean opening with a
 * pleasantry, which is what every other cold email does and the reason none of
 * them get read.
 *
 * Nothing here sends. `queueDraft` writes a row; the Apps Script it eventually
 * reaches has `createDraft` and no send call. A human presses send.
 */

import { execute, query, queryOne } from './db';
import { queueDraft } from './drafts';

/**
 * How many first emails one tick will write.
 *
 * Deliberately small. The first run after addresses arrive would otherwise put
 * forty unreviewed drafts in the mailbox at once — which is the moment a
 * mistake in the wording becomes forty mistakes. Ten an hour is faster than
 * anyone can review them anyway.
 */
const PER_TICK = 10;

export interface Sender {
  name: string;
  business: string | null;
  email: string;
}

export type OptOut = { kind: 'url'; url: string } | { kind: 'reply'; instruction: string };

export interface Compliance {
  postalAddress: string;
  optOut: OptOut;
}

export interface OutreachConfig {
  sender: Sender;
  compliance: Compliance;
}

/**
 * The settings this needs, and what to say when they are absent.
 *
 * Named individually rather than as "outreach is not configured" because the
 * person reading the cron report is the person who has to go and set them, and
 * "one of five things is missing" is not an instruction.
 */
export function configProblems(settings: Record<string, string>): string[] {
  const value = (key: string) => settings[key]?.trim() ?? '';
  const missing: string[] = [];

  if (!value('sender_name')) {
    missing.push('sender_name — the name that signs the email');
  }
  if (!value('sender_email')) {
    missing.push('sender_email — the address a reply goes to');
  }
  if (!value('postal_address')) {
    missing.push(
      'postal_address — a real address that receives mail. Required by law; it cannot be invented',
    );
  }
  if (!value('opt_out_url') && !value('opt_out_reply')) {
    missing.push('opt_out_url or opt_out_reply — how someone stops hearing from you');
  }

  return missing;
}

/** The settings as a config, or null when any of them is missing. */
export function outreachConfig(settings: Record<string, string>): OutreachConfig | null {
  if (configProblems(settings).length > 0) return null;

  const value = (key: string) => settings[key]?.trim() ?? '';
  const url = value('opt_out_url');

  return {
    sender: {
      name: value('sender_name'),
      business: value('sender_business') || null,
      email: value('sender_email'),
    },
    compliance: {
      postalAddress: value('postal_address'),
      optOut: url ? { kind: 'url', url } : { kind: 'reply', instruction: value('opt_out_reply') },
    },
  };
}

/**
 * The one checkable fact, pulled back out of the notes field.
 *
 * `lib/prospects.ts` writes the lead finding into the note as
 * `Opener: <the finding>.` — so that is where it is read from. Parsing prose
 * is not lovely, but the alternative is a second copy of the findings in this
 * database going stale against the first.
 *
 * Returns null for every note that has no opener: the unauditable sites, the
 * clean ones, and anything a human has since rewritten by hand. Null means no
 * draft, which is the intended outcome in all three cases — including the
 * third, because a note a human rewrote is a note this job should not be
 * mining for sales copy.
 */
export function openerFrom(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = /Opener:\s*([^.]+(?:\.[^\s][^.]*)*)\./.exec(notes);
  const opener = match?.[1]?.trim();
  return opener ? opener : null;
}

/** The host, without the scheme or `www.`. What the reader calls their own site. */
export function hostOf(website: string | null | undefined, fallback: string): string {
  if (!website) return fallback;
  try {
    return new URL(website).hostname.replace(/^www\./i, '');
  } catch {
    return website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
  }
}

/** The line that tells them where their address came from. Specific, not boilerplate. */
export function provenanceLine(host: string): string {
  return `You're getting this because ${host} is listed publicly and I ran a free check over it. No list was bought and your address isn't going anywhere.`;
}

export function optOutLine(optOut: OptOut): string {
  return optOut.kind === 'url'
    ? `To never hear from me again: ${optOut.url}`
    : optOut.instruction;
}

export interface ComposedEmail {
  subject: string;
  body: string;
}

/**
 * The email itself.
 *
 * Shorter than the one sitecheck-1 writes, and on purpose: that one offers an
 * attached report, and this route cannot attach anything. The Apps Script the
 * draft is pushed to takes a recipient, a subject and a body — nothing else.
 * Promising an attachment the draft does not carry would mean every send
 * needed a human to remember to add it, and one day one of them wouldn't.
 *
 * So this offers to send the report as a reply instead, which also does
 * something useful: it makes a reply the way to get it.
 */
export function composeFirstEmail(
  host: string,
  opener: string,
  config: OutreachConfig,
): ComposedEmail {
  const { sender, compliance } = config;

  // Lowercase the first letter of the finding so it reads as a sentence rather
  // than a heading pasted mid-paragraph — unless it starts with something that
  // is capitalised in its own right, like HTTPS or a domain.
  const phrase = /^[A-Z][a-z]/.test(opener)
    ? opener.charAt(0).toLowerCase() + opener.slice(1)
    : opener;

  const signOff = [sender.name];
  if (sender.business && sender.business !== sender.name) signOff.push(sender.business);
  signOff.push(sender.email);

  const body = [
    'Hi,',
    '',
    `I had a look at ${host} this week and noticed ${phrase}.`,
    '',
    "It's the kind of thing that's invisible from the inside — the site works fine when you already know your way around it — but it quietly costs you enquiries from people who don't.",
    '',
    `I checked a handful of other things on ${host} at the same time and wrote the lot up. Reply and I'll send it over: it says what each one costs you and how to fix it, in plain language your own developer can work from.`,
    '',
    "There's nothing to buy. If it's useful, use it. If you'd rather someone just did it, that's what I do — happy to talk, happy not to.",
    '',
    "Either way this is the only email you'll get from me unless you reply.",
    '',
    ...signOff,
    '',
    provenanceLine(host),
    compliance.postalAddress,
    optOutLine(compliance.optOut),
  ].join('\n');

  return { subject: `Something I noticed on ${host}`, body };
}

export interface OutreachResult {
  /** Prospects with an address and no draft yet. */
  eligible: number;
  written: number;
  /** Had an address but no checkable finding to open with. */
  skippedNoOpener: number;
  /** Why nothing was written, when nothing was. Never thrown: the cron must survive it. */
  problem: string | null;
}

interface DraftableClient {
  id: number;
  name: string;
  website: string | null;
  email: string;
  notes: string | null;
  project_slug: string | null;
}

/**
 * Write a first email for every prospect that has an address and no draft yet.
 *
 * "No draft yet" is checked against the drafts table rather than a flag on the
 * client, so a draft that was written, pushed and then deleted from Gmail by
 * hand does not come back on the next tick. Deleting it there was a decision.
 */
export async function draftOutreach(): Promise<OutreachResult> {
  const idle: OutreachResult = { eligible: 0, written: 0, skippedNoOpener: 0, problem: null };

  const rows = await query<{ key: string; value: string }>('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const missing = configProblems(settings);
  if (missing.length > 0) {
    return { ...idle, problem: `not configured: ${missing.join('; ')}` };
  }
  const config = outreachConfig(settings)!;

  const candidates = await query<DraftableClient>(
    `SELECT c.id, c.name, c.website, c.email, c.notes, c.project_slug
       FROM clients c
      WHERE c.email IS NOT NULL
        AND trim(c.email) <> ''
        AND c.status = 'prospect'
        AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.client_id = c.id)
      ORDER BY c.heat DESC, c.id ASC
      LIMIT ?`,
    [PER_TICK],
  );

  let written = 0;
  let skippedNoOpener = 0;

  for (const client of candidates) {
    const opener = openerFrom(client.notes);
    if (!opener) {
      skippedNoOpener += 1;
      continue;
    }

    const host = hostOf(client.website, client.name);
    const { subject, body } = composeFirstEmail(host, opener, config);

    await queueDraft({
      clientId: client.id,
      projectSlug: client.project_slug,
      toAddress: client.email.trim(),
      subject,
      body,
    });

    // The CRM row says what happened to it. A prospect with a draft waiting is
    // not the same as one nobody has written to, and the difference has to be
    // visible on the page rather than only in the drafts table.
    await execute(
      `UPDATE clients
          SET next_action = 'Read the draft in Gmail, then send it',
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
        WHERE id = ?`,
      [client.id],
    );

    written += 1;
  }

  return { eligible: candidates.length, written, skippedNoOpener, problem: null };
}

/** Prospects that would be drafted to the moment an address lands on them. */
export async function waitingOnAnAddress(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*) AS n FROM clients
      WHERE status = 'prospect'
        AND (email IS NULL OR trim(email) = '')
        AND notes LIKE '%Opener:%'`,
  );
  return Number(row?.n ?? 0);
}
