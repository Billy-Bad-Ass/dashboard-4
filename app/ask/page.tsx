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
              Get one from console.anthropic.com, then{' '}
              <span className="mono">wrangler secret put ANTHROPIC_API_KEY</span>. The same key
              powers the scheduled agents.
            </div>
          </div>
        </div>
      ) : null}

      <AskPanel configured={hasDatabase()} />
    </>
  );
}
