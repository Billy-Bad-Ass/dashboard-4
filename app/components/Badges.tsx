import { Icon } from './Icon';
import type { Health } from '@/lib/heartbeat';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { STAGE_LABEL, type Stage } from '@/config/portfolio';

const HEALTH_META: Record<Health, { tone: string; icon: string; label: string }> = {
  good: { tone: 'good', icon: 'circle-check', label: 'Healthy' },
  watch: { tone: 'warn', icon: 'triangle-exclamation', label: 'Watch' },
  stalled: { tone: 'bad', icon: 'circle-exclamation', label: 'Stalled' },
  idle: { tone: 'idle', icon: 'hourglass-half', label: 'Idle' },
};

export function HealthBadge({ health }: { health: Health }) {
  const meta = HEALTH_META[health];
  return (
    <span className={`badge badge-${meta.tone}`}>
      <Icon name={meta.icon} size={11} />
      {meta.label}
    </span>
  );
}

export function healthColor(health: Health): string {
  return {
    good: 'var(--good)',
    watch: 'var(--warn)',
    stalled: 'var(--bad)',
    idle: 'var(--idle)',
  }[health];
}

/** The throbbing dot. Only genuinely-live things throb; see `.still` in the CSS. */
export function PulseDot({ health }: { health: Health }) {
  const color = healthColor(health);
  const still = health === 'idle' || health === 'stalled';
  return (
    <span
      className={`pulse${still ? ' still' : ''}`}
      style={{ background: color, color }}
      aria-hidden="true"
    />
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  const tone =
    stage === 'earning' ? 'good' : stage === 'shipped' ? 'info' : stage === 'paused' ? 'idle' : 'neutral';
  return <span className={`badge badge-${tone}`}>{STAGE_LABEL[stage]}</span>;
}

const CONNECTOR_META: Record<ConnectorStatus, { tone: string; icon: string; label: string }> = {
  ok: { tone: 'good', icon: 'circle-check', label: 'Live' },
  degraded: { tone: 'warn', icon: 'triangle-exclamation', label: 'Degraded' },
  failed: { tone: 'bad', icon: 'circle-exclamation', label: 'Failed' },
  unconfigured: { tone: 'idle', icon: 'ban', label: 'Not connected' },
};

export function ConnectorBadge({ status }: { status: ConnectorStatus }) {
  const meta = CONNECTOR_META[status];
  return (
    <span className={`badge badge-${meta.tone}`}>
      <Icon name={meta.icon} size={11} />
      {meta.label}
    </span>
  );
}
