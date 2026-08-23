import type { Metadata } from 'next';
import { hasDatabase } from '@/lib/db';
import { cfEnv } from '@/lib/db';
import { PageHead } from '@/app/components/PageHead';
import { AskPanel } from '@/app/components/AskPanel';
import { Icon } from '@/app/components/Icon';

export const metadata: Metadata = { title: 'Ask' };
export const dynamic = 'force-dynamic';

export default function AskPage() {
  const env = cfEnv();
  const hasKey = Boolean(env?.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY);

  return (
    <>
      <PageHead
        title="Ask"
        sub="Ask about the business in plain English. It reads the live ledger, the CRM and the connectors, runs the actual query, and shows you what it looked up."
      />

      {!hasKey ? (
        <div className="notice notice-warn" style={{ marginBottom: 14 }}>
          <Icon name="triangle-exclamation" size={16} />
          <div>
            <strong>No Anthropic API key set.</strong>
            <div className="small muted" style={{ marginTop: 3 }}>
              Get one from{' '}
              <a href="https://platform.claude.com" target="_blank" rel="noreferrer noopener">
                platform.claude.com
              </a>
              , add it as <span className="mono">ANTHROPIC_API_KEY</span> under Cloudflare →
              Workers &amp; Pages → bba-heartbeat → Settings → Variables and Secrets, then
              redeploy.
              <br />
              This is the one part of the dashboard that costs money per use: the Claude API is
              billed separately from a Pro or Max subscription, which covers the Claude app rather
              than the API. Roughly £0.09 a question, or a fifth of that with an{' '}
              <span className="mono">ASK_MODEL</span> variable set to{' '}
              <span className="mono">claude-haiku-4-5</span>.
            </div>
          </div>
        </div>
      ) : null}

      <AskPanel configured={hasDatabase()} />
    </>
  );
}
