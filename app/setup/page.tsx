import type { Metadata } from 'next';
import { pulse } from '@/lib/heartbeat';
import { hasDatabase, cfEnv } from '@/lib/db';
import { PageHead } from '@/app/components/PageHead';
import { Icon } from '@/app/components/Icon';
import { ConnectorBadge } from '@/app/components/Badges';

export const metadata: Metadata = { title: 'Setup' };
export const dynamic = 'force-dynamic';

/**
 * The wiring-up page.
 *
 * It shows what is connected and the exact command to connect what is not.
 * Deliberately shows no secret values — only whether each one is set, because
 * "is my Stripe key configured" is a question worth answering on a page and
 * "what is my Stripe key" is not.
 */
export default async function SetupPage() {
  const snapshot = await pulse();
  const env = cfEnv();

  const secrets = [
    {
      name: 'STRIPE_SECRET_KEY',
      set: Boolean(env?.STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY),
      what: 'Revenue, refunds, disputes and balance for Project 2.',
      how: 'Stripe dashboard → Developers → API keys → restricted key, read-only scopes.',
    },
    {
      name: 'GITHUB_TOKEN',
      set: Boolean(env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN),
      what: 'Repository heartbeat. Optional for public repos, required for private ones.',
      how: 'Fine-grained PAT, read-only on contents/metadata/actions for the four repos.',
    },
    {
      name: 'CLOUDFLARE_API_TOKEN',
      set: Boolean(env?.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN),
      what: 'Worker traffic — what the £5/month is actually buying.',
      how: 'Cloudflare → My Profile → API Tokens → custom token with Account Analytics: Read.',
    },
    {
      name: 'CLOUDFLARE_ACCOUNT_ID',
      set: Boolean(env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID),
      what: 'Which account the analytics query targets.',
      how: 'The hex string in your Cloudflare dashboard URL.',
    },
    {
      name: 'CALENDAR_ICS_URL',
      set: Boolean(env?.CALENDAR_ICS_URL ?? process.env.CALENDAR_ICS_URL),
      what: 'Read-only feed for bbacentralworkspace@gmail.com.',
      how: 'Google Calendar → Settings → the calendar → "Secret address in iCal format".',
    },
    {
      name: 'DASHBOARD_TOKEN',
      set: Boolean(env?.DASHBOARD_TOKEN ?? process.env.DASHBOARD_TOKEN),
      what: 'Guards every write endpoint and lets agents report their runs.',
      how: 'Any long random string. Generate with `openssl rand -hex 32`.',
      critical: true,
    },
  ];

  const db = hasDatabase();

  return (
    <>
      <PageHead
        title="Setup"
        sub="What is connected, what is not, and the exact command for each. No secret values are shown here — only whether they are set."
        generatedAt={snapshot.generatedAt}
      />

      <div className="stack">
        {!db ? (
          <div className="notice notice-warn">
            <Icon name="database" size={16} />
            <div>
              <strong>No D1 binding.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                Until the database exists, the ledger, CRM, metric history and agent log are all
                empty — and they will read as zeroes rather than errors. Create it first.
              </div>
            </div>
          </div>
        ) : null}

        {!secrets.find((s) => s.name === 'DASHBOARD_TOKEN')?.set ? (
          <div className="notice notice-warn">
            <Icon name="shield-halved" size={16} />
            <div>
              <strong>Write endpoints are unauthenticated.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                With no <span className="mono">DASHBOARD_TOKEN</span> set, anything that can reach
                this Worker can add spend rows and edit clients. That is fine on{' '}
                <span className="mono">wrangler dev</span> and not fine once deployed. Set the token,
                and put Cloudflare Access in front of the Worker for real protection.
              </div>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="tower-broadcast" size={13} />
              Connectors
            </h2>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {snapshot.connectors.map((c) => (
              <div key={c.name}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong style={{ fontSize: 14 }}>{c.name}</strong>
                  <ConnectorBadge status={c.status} />
                </div>
                <div className="small muted" style={{ marginTop: 2 }}>
                  {c.detail}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="gear" size={13} />
              Secrets
            </h2>
            <span className="tiny faint">
              {secrets.filter((s) => s.set).length} of {secrets.length} set
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Set</th>
                  <th>What it unlocks</th>
                  <th>Where to get it</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((secret) => (
                  <tr key={secret.name}>
                    <td className="mono tiny">{secret.name}</td>
                    <td>
                      <span className={`badge badge-${secret.set ? 'good' : secret.critical ? 'bad' : 'idle'}`}>
                        <Icon name={secret.set ? 'check' : 'xmark'} size={10} />
                        {secret.set ? 'set' : 'missing'}
                      </span>
                    </td>
                    <td className="small muted">{secret.what}</td>
                    <td className="small muted">{secret.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="database" size={13} />
              First-time setup
            </h2>
          </div>
          <Steps
            steps={[
              {
                title: 'Create the database and cache',
                body: `wrangler d1 create bba-heartbeat
wrangler kv namespace create CACHE
wrangler r2 bucket create bba-heartbeat-archive`,
                note: 'Paste the printed database_id and KV id into wrangler.jsonc, replacing the REPLACE_WITH_ placeholders.',
              },
              {
                title: 'Apply the schema',
                body: `npm run db:migrate:local && npm run db:seed:local   # local
npm run db:migrate:remote && npm run db:seed:remote  # production`,
                note: 'The seed inserts exactly one row: the £5/month Cloudflare subscription. No fake clients, no sample revenue.',
              },
              {
                title: 'Set the secrets',
                body: `wrangler secret put STRIPE_SECRET_KEY
wrangler secret put GITHUB_TOKEN
wrangler secret put CLOUDFLARE_API_TOKEN
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CALENDAR_ICS_URL
wrangler secret put DASHBOARD_TOKEN`,
                note: 'For local development put the same names in .dev.vars, which is gitignored.',
              },
              {
                title: 'Deploy',
                body: 'npm run cf:deploy',
                note: 'The cron triggers in wrangler.jsonc start firing on the first successful deploy.',
              },
              {
                title: 'Let the agents report in',
                body: `# In each project repo's GitHub settings → Secrets:
DASHBOARD_URL   = https://bba-heartbeat.<your-subdomain>.workers.dev
DASHBOARD_TOKEN = the same value you set above`,
                note: 'Without these the workflows still run — their results just never reach the agents console.',
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}

function Steps({ steps }: { steps: { title: string; body: string; note?: string }[] }) {
  return (
    <ol className="stack" style={{ gap: 16, paddingLeft: 0, listStyle: 'none', margin: 0 }}>
      {steps.map((step, i) => (
        <li key={step.title}>
          <div className="row" style={{ gap: 9, marginBottom: 6 }}>
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 700,
                flex: 'none',
              }}
            >
              {i + 1}
            </span>
            <strong style={{ fontSize: 14 }}>{step.title}</strong>
          </div>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: '10px 12px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              overflowX: 'auto',
              fontSize: 12,
              lineHeight: 1.65,
            }}
          >
            {step.body}
          </pre>
          {step.note ? (
            <div className="tiny faint" style={{ marginTop: 5 }}>
              {step.note}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
