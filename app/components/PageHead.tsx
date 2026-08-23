import { LiveClock } from './LiveClock';

export function PageHead({
  title,
  sub,
  generatedAt,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  generatedAt?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      <div className="row">
        {actions}
        {generatedAt ? <LiveClock generatedAt={generatedAt} /> : null}
      </div>
    </header>
  );
}
