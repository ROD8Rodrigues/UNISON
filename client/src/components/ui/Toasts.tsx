import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useToastStore } from '../../store/toast';

export function Toasts() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast toast-${item.type}`}>
          <span className="toast-icon">
            {item.type === 'success' && <CheckCircle2 size={18} />}
            {item.type === 'error' && <AlertCircle size={18} />}
            {item.type === 'info' && <Info size={18} />}
          </span>
          <div className="toast-copy">
            <strong>{item.title}</strong>
            {item.message && <p>{item.message}</p>}
          </div>
          <button
            type="button"
            className="toast-close"
            onClick={() => dismiss(item.id)}
            aria-label="Fechar aviso"
          >
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
