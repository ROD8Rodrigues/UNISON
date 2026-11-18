import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  message,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`}>
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}
