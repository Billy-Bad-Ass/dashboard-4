import Link from 'next/link';
import { Icon } from './Icon';
import type { ConnectorHealth } from '@/lib/heartbeat';

/**
 * The banner that appears until the dashboard is actually wired up.
 *
 * It exists because the failure mode of a half-configured dashboard is not a
 * crash — it is a page full of zeroes that looks like a working dashboard
 * reporting a dead business. This says which of those two you are looking at.
 */
export function SetupNotice({
  configured,
  connectors,
}: {
  configured: boolean;
  connectors: ConnectorHealth[];
}) {
  const missing = connectors.filter((c) => c.status === 'unconfigured');
  const broken = connectors.filter((c) => c.status === 'failed');

  if (configured && missing.length === 0 && broken.length === 0) return null;

  return (
    <div className="notice notice-warn" role="status">
      <Icon name="triangle-exclamation" size={16} />
      <div>
        <strong>
          {!configured
            ? 'No database yet — every stored number on this page is empty by default, not by measurement.'
            : `${missing.length + broken.length} connector${missing.length + broken.length === 1 ? '' : 's'} not reporting.`}
        </strong>
        <div className="small muted" style={{ marginTop: 3 }}>
          {broken.length > 0 ? `Failing: ${broken.map((c) => c.name).join(', ')}. ` : ''}
          {missing.length > 0 ? `Not connected: ${missing.map((c) => c.name).join(', ')}. ` : ''}
          <Link href="/setup">Open setup</Link> for the exact commands.
        </div>
      </div>
    </div>
  );
}
