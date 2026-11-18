import { AlertTriangle } from 'lucide-react';
import { useDialogStore } from '../../store/dialog';
import { Modal } from './Modal';

export function ConfirmHost() {
  const options = useDialogStore((state) => state.options);
  const close = useDialogStore((state) => state.close);

  return (
    <Modal
      open={Boolean(options)}
      onClose={() => close(false)}
      title={options?.title || ''}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>
            {options?.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            className={`btn ${options?.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => close(true)}
          >
            {options?.confirmLabel || 'Confirmar'}
          </button>
        </>
      }
    >
      <div className="confirm-body">
        {options?.danger && (
          <span className="confirm-icon">
            <AlertTriangle size={22} />
          </span>
        )}
        <p>{options?.message}</p>
      </div>
    </Modal>
  );
}
