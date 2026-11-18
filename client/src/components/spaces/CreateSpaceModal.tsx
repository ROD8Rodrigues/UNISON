import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Globe, Lock, Plus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Space } from '../../lib/types';
import { useAppStore } from '../../store/app';
import { toast } from '../../store/toast';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export function CreateSpaceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const refreshSpaces = useAppStore((state) => state.refreshSpaces);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setDescription('');
    setVisibility('private');
    setError('');
  }, [open]);

  async function submit() {
    if (name.trim().length < 2) {
      setError('O nome precisa ter pelo menos 2 caracteres.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api.post<{ space: Space; defaultChannelId: string }>('/spaces', {
        name: name.trim(),
        description: description.trim(),
        visibility,
      });
      await refreshSpaces();
      toast.success('Espaço criado', data.space.name);
      onClose();
      navigate(`/app/spaces/${data.space.id}`);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível criar o espaço.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Criar espaço"
      description="Um espaço reúne canais, cargos e a sua comunidade."
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner size={16} /> : <Plus size={16} />}
            Criar espaço
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span>Nome do espaço</span>
          <div className={`input-shell${error ? ' invalid' : ''}`}>
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
              placeholder="Ex.: Estúdio UNISON"
              maxLength={48}
              autoFocus
            />
          </div>
          {error && <small className="field-error">{error}</small>}
        </label>
        <label className="field">
          <span>Descrição</span>
          <textarea
            className="textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Do que este espaço trata?"
            maxLength={300}
            rows={3}
          />
          <small className="field-hint">{description.length}/300</small>
        </label>
        <div className="field">
          <span>Visibilidade</span>
          <div className="radio-cards">
            <button
              type="button"
              className={`radio-card${visibility === 'private' ? ' selected' : ''}`}
              onClick={() => setVisibility('private')}
            >
              <Lock size={18} />
              <div>
                <strong>Privado</strong>
                <p>Só entra quem receber um convite.</p>
              </div>
            </button>
            <button
              type="button"
              className={`radio-card${visibility === 'public' ? ' selected' : ''}`}
              onClick={() => setVisibility('public')}
            >
              <Globe size={18} />
              <div>
                <strong>Público</strong>
                <p>Qualquer pessoa pode descobrir e entrar.</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
