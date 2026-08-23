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
      how: 'Cloudflare → your icon → API Tokens → Create Token → custom → Account Analytics: Read.',
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
      how: 'Google Calendar → gear → Settings → tap the calendar → "Secret address in iCal format".',
    },
    {
      name: 'DASHBOARD_TOKEN',
      set: Boolean(env?.DASHBOARD_TOKEN ?? process.env.DASHBOARD_TOKEN),
      what: 'Guards every write endpoint and lets agents report their runs.',
      how: 'Any long random string, like a password.',
      critical: true,
    },
    {
      name: 'ANTHROPIC_API_KEY',
      set: Boolean(env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY),
      what: 'The Ask page. Everything else works without it.',
      how:
        'platform.claude.com → API keys. Billed separately from a Claude Pro or Max ' +
        'subscription — those cover the app, not the API.',
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
                empty — and they will read as zeroes rather than errors. Run the{' '}
                <strong>Set up the dashboard</strong> workflow in the repository&rsquo;s Actions tab
                first; it creates everything and deploys.
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
                this Worker can add spend rows and edit clients. Fine while it is only running on
                your own machine; not fine once it is deployed. Set the token, and put{' '}
                <strong>Cloudflare Access</strong> in front of the Worker (Zero Trust → Access →
                Applications) for real protection — free on the plan you already pay for.
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
          <div className="tiny faint" style={{ marginTop: 12 }}>
            Everything here except <span className="mono">ANTHROPIC_API_KEY</span> is covered by
            the Cloudflare plan already being paid for. The Ask page calls the Claude API, which
            is billed separately from a Claude subscription — roughly £0.09 a question, or a fifth
            of that with an <span className="mono">ASK_MODEL</span> variable set to{' '}
            <span className="mono">claude-haiku-4-5</span>.
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">
              <Icon name="database" size={13} />
              First-time setup
            </h2>
            <span className="tiny faint">no terminal needed</span>
          </div>

          <div className="notice notice-info" style={{ marginBottom: 14 }}>
            <Icon name="bolt" size={16} />
            <div>
              <strong>Everything below is done in a browser.</strong>
              <div className="small muted" style={{ marginTop: 3 }}>
                A GitHub Actions runner does the command-line work. Full tap-by-tap version:{' '}
                <a
                  href="https://github.com/Billy-Bad-Ass/Project-4/blob/main/docs/IPAD.md"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  docs/IPAD.md
                </a>
                .
              </div>
            </div>
          </div>

          <Steps
            steps={[
              {
                title: 'Give GitHub access to Cloudflare',
                body: [
                  'Cloudflare → your icon (top right) → API Tokens → Create Token',
                  '→ "Edit Cloudflare Workers" template, then ADD a permission row:',
                  '   Account → D1 → Edit',
                  '',
                  'Then in this repo: Settings → Secrets and variables → Actions,',
                  'add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.',
                ].join('\n'),
                note: 'The account id is in the right-hand panel of Workers & Pages.',
              },
              {
                title: 'Press the button',
                body: 'GitHub → Actions → "Set up the dashboard" → Run workflow',
                note:
                  'Creates the database, cache and bucket, sets up the tables and deploys. ' +
                  'About three minutes. Your URL is in the run summary. Safe to re-run.',
              },
              {
                title: 'Lock it down — before adding any keys',
                body: [
                  'Cloudflare → Zero Trust → Access → Applications → Add an application',
                  '→ Self-hosted → public hostname: your worker URL',
                  '→ policy: Include → Emails → your address',
                ].join('\n'),
                note:
                  'Until this is on, anyone with the URL can read your finances and edit your ' +
                  'clients. Free for up to 50 people on the plan you already pay for.',
              },
              {
                title: 'Add the keys above',
                body: [
                  'Cloudflare → Workers & Pages → bba-heartbeat → Settings',
                  '→ Variables and Secrets → Add → type: Secret',
                ].join('\n'),
                note: 'All optional. Add what you want; this page keeps showing what is missing.',
              },
              {
                title: 'Redeploy so the keys take effect',
                body: 'GitHub → Actions → "Deploy" → Run workflow',
                note: 'Adding a secret does not restart the Worker. This does.',
              },
              {
                title: 'Let the agents report in',
                body: [
                  'This repo → Settings → Secrets and variables → Actions:',
                  '  DASHBOARD_URL      this dashboard\'s URL',
                  '  DASHBOARD_TOKEN    the same value you set above',
                  '',
                  'For the agents to run free on a Claude Max plan, also add:',
                  '  CLAUDE_CODE_OAUTH_TOKEN   from `claude setup-token`',
                ].join('\n'),
                note:
                  'Without the first two the agents still run, their results just never reach ' +
                  'the Agents page.',
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
