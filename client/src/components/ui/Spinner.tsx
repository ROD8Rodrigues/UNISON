import { Loader2 } from 'lucide-react';
import { classNames } from '../../lib/utils';

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={classNames('spinner', className)} aria-hidden="true" />;
}

export function LoadingScreen({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="loading-screen">
      <Spinner size={26} />
      <p>{label}</p>
    </div>
  );
}
