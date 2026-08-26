-- The outreach draft queue.
--
-- A draft has to survive the gap between "the agent wrote it" and "it is
-- sitting in Gmail waiting to be read", and that gap crosses a network, a
-- Google account and a human. Holding it only in memory means a failed POST
-- loses work nobody knows was lost.
--
-- The states, and what each one actually means to a person looking at the
-- dashboard:
--
--   queued     written, not yet pushed anywhere. Safe to edit or delete.
--   delivered  it is in the Gmail drafts folder. A human still has to send it.
--   failed     the push was refused. `error` says why, in words.
--
-- There is deliberately no `sent` state. Nothing in this system can send an
-- email, so a `sent` column would be a field nobody could ever truthfully set,
-- and a dashboard that shows a state it cannot observe is worse than one that
-- admits the trail goes cold at the drafts folder.
CREATE TABLE drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_slug  TEXT,
  -- The address as it was when the draft was written. A client row can change
  -- afterwards; what was actually drafted must not.
  to_address    TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  -- Sent to Apps Script so a retry cannot produce a second identical draft.
  -- Stable per draft row, which is why it is stored rather than computed.
  idempotency_key TEXT NOT NULL UNIQUE,
  state         TEXT NOT NULL DEFAULT 'queued',
  -- Gmail's id for the created draft. Null until it lands.
  gmail_draft_id TEXT,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  delivered_at  TEXT
);

CREATE INDEX idx_drafts_state ON drafts(state);
CREATE INDEX idx_drafts_client ON drafts(client_id);
