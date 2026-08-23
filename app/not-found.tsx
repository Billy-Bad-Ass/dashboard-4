import Link from 'next/link';
import { Icon } from './components/Icon';

export default function NotFound() {
  return (
    <div className="stack" style={{ maxWidth: 520, marginTop: 40 }}>
      <h1 className="page-title">Nothing here</h1>
      <p className="page-sub">
        That page does not exist. If you were looking for a project, it has to be registered in{' '}
        <span className="mono">config/portfolio.ts</span> before it gets a page.
      </p>
      <div>
        <Link href="/" className="btn btn-primary btn-sm">
          <Icon name="gauge-high" size={12} /> Back to the heartbeat
        </Link>
      </div>
    </div>
  );
}
