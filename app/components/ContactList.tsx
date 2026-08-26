'use client';

/**
 * The people attached to one project, with their addresses on show.
 *
 * The CRM board hides the address behind an envelope button, which is fine when
 * you are working one contact at a time and useless when the question is "who
 * is on this list, and can I mail them". Here the address is the point, so it
 * is text you can read and select, and the two things you actually want to do
 * with a list — copy it, or open a mail window addressed to all of it — are
 * buttons rather than a manual round trip through each row.
 *
 * Contacts with no address are counted, not hidden. Unknown and empty are
 * different states everywhere else in this dashboard and they are different
 * here too: five prospects with no addresses is a job to do, not an empty list.
 */

import { useState } from 'react';
import Link from 'next/link';
import { STATUS_META, type Client, type EmailableContact } from '@/lib/crm';
import { formatDate, relativeTime } from '@/lib/dates';
import { Icon } from './Icon';

export function ContactList({
  emailable,
  missingEmail,
  addresses,
  projectName,
}: {
  emailable: EmailableContact[];
  missingEmail: Client[];
  addresses: string[];
  projectName: string;
}) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);

  const joined = addresses.join(', ');

  async function copyAll() {
    setFallback(null);
    try {
      // Absent in an insecure context, and it can reject even where it exists.
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(joined);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Never leave the user with nothing: show the list so it can be selected
      // by hand. A dead button with no explanation is the worst outcome here.
      setFallback(joined);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">
          <Icon name="users" size={13} />
          People you can email
        </h2>
        <Link href="/clients" className="tiny">
          All contacts <Icon name="arrow-right" size={10} />
        </Link>
      </div>

      {emailable.length === 0 && missingEmail.length === 0 ? (
        <div className="empty">
          <strong>Nobody is on this project&rsquo;s list yet.</strong>
          Add contacts on the Clients page and set &ldquo;For project&rdquo; to {projectName}. They
          appear here with their addresses as soon as they exist.
        </div>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span className="tiny muted">
              {emailable.length} reachable
              {addresses.length !== emailable.length
                ? ` · ${addresses.length} unique ${addresses.length === 1 ? 'address' : 'addresses'}`
                : ''}
              {missingEmail.length > 0 ? ` · ${missingEmail.length} with no address on file` : ''}
            </span>
            {addresses.length > 0 ? (
              <div className="row" style={{ gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={copyAll}>
                  <Icon name={copied ? 'check' : 'envelope'} size={12} />
                  {copied
                    ? 'Copied'
                    : `Copy ${addresses.length} ${addresses.length === 1 ? 'address' : 'addresses'}`}
                </button>
                {/* bcc, not to: these people do not know each other. */}
                <a className="btn btn-sm" href={`mailto:?bcc=${encodeURIComponent(joined)}`}>
                  <Icon name="envelope" size={12} /> Email all (bcc)
                </a>
              </div>
            ) : null}
          </div>

          {fallback ? (
            <div className="stack" style={{ gap: 6 }}>
              <div className="tiny muted">
                The browser blocked the copy. Select the addresses below instead.
              </div>
              <textarea readOnly rows={3} value={fallback} aria-label="All addresses" />
            </div>
          ) : null}

          {emailable.length === 0 ? (
            <div className="empty">
              <strong>No addresses on file.</strong>
              {missingEmail.length} {missingEmail.length === 1 ? 'contact is' : 'contacts are'}{' '}
              attached to this project, and not one of them has an email address recorded. Open
              them and fill it in.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Status</th>
                    <th>Last contact</th>
                    <th>Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {emailable.map((contact) => (
                    <tr key={contact.id}>
                      <td>
                        <Link href={`/clients/${contact.id}`}>{contact.name}</Link>
                        {contact.company ? (
                          <div className="tiny faint">{contact.company}</div>
                        ) : null}
                      </td>
                      <td className="mono tiny">
                        <a href={`mailto:${contact.emailAddress}`}>{contact.emailAddress}</a>
                      </td>
                      <td>
                        <span className={`badge badge-${STATUS_META[contact.status]?.tone ?? 'neutral'}`}>
                          {STATUS_META[contact.status]?.label ?? contact.status}
                        </span>
                      </td>
                      <td className="tiny muted">
                        {contact.last_contact_on ? relativeTime(contact.last_contact_on) : 'never'}
                      </td>
                      <td className="tiny muted">
                        {contact.next_action ? (
                          <>
                            {contact.next_action}
                            {contact.next_action_on ? (
                              <span className="faint"> · {formatDate(contact.next_action_on)}</span>
                            ) : null}
                          </>
                        ) : (
                          // The dash is the house convention for "not recorded".
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {missingEmail.length > 0 ? (
            <div className="tiny faint" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <Icon name="circle-exclamation" size={11} /> No address on file:{' '}
              {missingEmail.map((contact, index) => (
                <span key={contact.id}>
                  {index > 0 ? ', ' : ''}
                  <Link href={`/clients/${contact.id}`}>{contact.name}</Link>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
