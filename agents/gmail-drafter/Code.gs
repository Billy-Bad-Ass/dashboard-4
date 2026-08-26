/**
 * gmail-drafter — the half of the outreach pipeline that runs inside Google.
 *
 * THIS FILE IS THE MASTER COPY. The copy that actually runs lives in Apps
 * Script at script.google.com, pasted by hand. They can drift; when you change
 * this file, paste it again and redeploy. See README.md next to it.
 *
 * Why it exists at all: putting a draft into a consumer @gmail.com mailbox
 * needs one of three things, and two of them are unusable.
 *
 *   - Gmail API + OAuth — drafts need a *restricted* scope, and an unverified
 *     app on a consumer account has its refresh token killed every 7 days.
 *     Escaping that needs Google's full verification with a security review.
 *   - IMAP APPEND + an app password — works, but an app password is total
 *     mailbox access (read everything, send as you) sitting in a CI secret.
 *   - This. The script runs as Billy, inside his own account, and the only
 *     Gmail call it can make is createDraft.
 *
 * Direction of travel is deliberate. The dashboard is behind Cloudflare Access
 * at Worker scope, so a script polling it would need an Access service token
 * plus the dashboard bearer — two credentials living in Google. Pushing the
 * other way, this script holds nothing and knows nothing about Cloudflare.
 *
 * What it will never do:
 *   - send. There is no call to send() anywhere in this file, by design.
 *   - read the mailbox. createDraft is the whole surface.
 */

/**
 * There is no password in this file, and that is a decision rather than an
 * oversight.
 *
 * The deployment URL Google mints is itself the credential: ~60 characters of
 * unguessable id, held only by the dashboard's `settings` table. A second
 * shared secret would have to live in the code, which means it would have to
 * travel to Billy on a page or in a chat message to get pasted — putting a
 * long-lived secret somewhere more exposed than the thing it protects.
 *
 * That trade is only acceptable because of how little this URL can do. Someone
 * who guessed it could put a draft into a drafts folder. They could not send
 * it, read anything, or spend anything. Rotation is one action: redeploy, hand
 * over the new URL, and the old one is dead.
 *
 * If this script ever grows a capability worth more than that, it needs real
 * authentication first.
 */

/** Max drafts accepted in one request. A runaway loop upstream stops here. */
var MAX_BATCH = 50;

/** How long an idempotency key is remembered, in days. */
var KEY_TTL_DAYS = 60;

/**
 * The only entry point. Expects:
 *
 *   POST { drafts: [ { key, to, subject, body } ] }
 *
 * Returns { ok, results: [ { key, status, draftId?, error? } ] }.
 *
 * `key` is the caller's idempotency key — anything stable per intended draft
 * (the dashboard sends "client-<id>-<queued_at>"). A key already seen is
 * answered "duplicate" without creating a second draft, because the honest
 * failure mode of a retrying agent is two identical drafts in the mailbox and
 * no way to tell which one you already edited.
 */
function doPost(e) {
  try {
    var payload = parseBody(e);
    if (!payload) return reply({ ok: false, error: 'Body was not JSON.' });

    var drafts = payload.drafts;
    if (!Array.isArray(drafts)) return reply({ ok: false, error: 'drafts must be an array.' });
    if (drafts.length > MAX_BATCH) {
      return reply({ ok: false, error: 'Too many drafts in one request (max ' + MAX_BATCH + ').' });
    }

    var results = [];
    for (var i = 0; i < drafts.length; i++) {
      results.push(createOne(drafts[i]));
    }

    pruneKeys();
    return reply({ ok: true, results: results });
  } catch (err) {
    // A thrown error would render as Google's HTML error page, which the agent
    // cannot read. Always answer JSON.
    return reply({ ok: false, error: String(err) });
  }
}

/** GET exists only so opening the URL in a browser says something useful. */
function doGet() {
  return reply({
    ok: true,
    service: 'gmail-drafter',
    note: 'POST only. This script creates Gmail drafts and can neither send nor read mail.',
  });
}

function createOne(draft) {
  var key = String((draft && draft.key) || '').trim();
  var to = String((draft && draft.to) || '').trim();
  var subject = String((draft && draft.subject) || '').trim();
  var body = String((draft && draft.body) || '');

  if (!key) return { key: key, status: 'error', error: 'Missing key.' };
  if (!looksLikeEmail(to)) return { key: key, status: 'error', error: 'Not an email address.' };
  if (!subject) return { key: key, status: 'error', error: 'Missing subject.' };
  if (!body) return { key: key, status: 'error', error: 'Missing body.' };

  var props = PropertiesService.getScriptProperties();
  var seen = props.getProperty(keyProp(key));
  if (seen) {
    var previous = null;
    try {
      previous = JSON.parse(seen);
    } catch (ignored) {
      previous = null;
    }
    return { key: key, status: 'duplicate', draftId: previous ? previous.id : null };
  }

  var created = GmailApp.createDraft(to, subject, body);
  var id = created.getId();

  props.setProperty(keyProp(key), JSON.stringify({ id: id, at: new Date().toISOString() }));
  return { key: key, status: 'created', draftId: id };
}

/**
 * Deliberately loose. This is a guard against "undefined" and a name with no
 * address, not an RFC 5322 validator — the address came from the dashboard,
 * which is the place that should be strict about it.
 */
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function keyProp(key) {
  return 'done_' + key;
}

/**
 * Drop remembered keys older than the TTL. The property store is capped at
 * 500KB, and a store that fills up would start failing writes — which would
 * show up as duplicate drafts months from now, with nothing pointing here.
 */
function pruneKeys() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var cutoff = Date.now() - KEY_TTL_DAYS * 24 * 60 * 60 * 1000;

  for (var name in all) {
    if (name.indexOf('done_') !== 0) continue;
    var at = null;
    try {
      at = JSON.parse(all[name]).at;
    } catch (ignored) {
      at = null;
    }
    // An unparseable or undated entry is stale by definition — it predates the
    // current format and cannot be reasoned about.
    if (!at || new Date(at).getTime() < cutoff) props.deleteProperty(name);
  }
}

function parseBody(e) {
  if (!e || !e.postData || !e.postData.contents) return null;
  try {
    return JSON.parse(e.postData.contents);
  } catch (ignored) {
    return null;
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
