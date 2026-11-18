import { useEffect, useState } from 'react';
import { Hash, Lock, Plus, Volume2 } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { Channel } from '../../lib/types';
import { toast } from '../../store/toast';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export function CreateChannelModal({
  open,
  spaceId,
  onClose,
  onCreated,
}: {
  open: boolean;
  spaceId: string;
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}) {
  const [name, setName] = useState('');
  const [channelType, setChannelType] = useState<'text' | 'voice'>('text');
  const [topic, setTopic] = useState('');
  const [category, setCategory] = useState('Geral');
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setChannelType('text');
    setTopic('');
    setCategory('Geral');
    setIsPrivate(false);
    setError('');
  }, [open]);

  async function submit() {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (!normalized) {
      setError('Informe um nome para o canal.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api.post<{ channel: Channel }>(`/spaces/${spaceId}/channels`, {
        name: normalized,
        topic: topic.trim(),
        category: category.trim() || 'Geral',
        isPrivate,
        type: channelType,
      });
      toast.success(
        channelType === 'voice' ? 'Canal de voz criado' : 'Canal criado',
        channelType === 'voice' ? data.channel.name : `#${data.channel.name}`,
      );
      onCreated(data.channel);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'Não foi possível criar o canal.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Criar canal"
      description={
        channelType === 'voice'
          ? 'Canais de voz permitem conversar por áudio sem iniciar uma chamada.'
          : 'Canais organizam as conversas do espaço por assunto.'
      }
      size="md"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Spinner size={16} /> : <Plus size={16} />}
            Criar canal
          </button>
        </>
      }
    >
      <div className="form-stack">
        <div className="field">
          <span>Tipo do canal</span>
          <div className="segmented">
            <button
              type="button"
              className={channelType === 'text' ? 'active' : ''}
              onClick={() => setChannelType('text')}
            >
              <Hash size={15} /> Texto
            </button>
            <button
              type="button"
              className={channelType === 'voice' ? 'active' : ''}
              onClick={() => setChannelType('voice')}
            >
              <Volume2 size={15} /> Voz
            </button>
          </div>
        </div>
        <label className="field">
          <span>Nome do canal</span>
          <div className={`input-shell${error ? ' invalid' : ''}`}>
            {channelType === 'voice' ? <Volume2 size={16} /> : <Hash size={16} />}
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setError('');
              }}
              placeholder={channelType === 'voice' ? 'ex.: sala-de-jogos' : 'ex.: anúncios'}
              maxLength={32}
              autoFocus
            />
          </div>
          {error ? (
            <small className="field-error">{error}</small>
          ) : (
            <small className="field-hint">Letras minúsculas, números e hífens.</small>
          )}
        </label>
        <label className="field">
          <span>Tópico</span>
          <div className="input-shell">
            <input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Sobre o que é este canal?"
              maxLength={200}
            />
          </div>
        </label>
        <label className="field">
          <span>Categoria</span>
          <div className="input-shell">
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="Geral"
              maxLength={40}
            />
          </div>
          <small className="field-hint">Agrupa canais na barra lateral.</small>
        </label>
        <div className="field">
          <span>Privacidade</span>
          <div className="radio-cards">
            <button
              type="button"
              className={`radio-card${!isPrivate ? ' selected' : ''}`}
              onClick={() => setIsPrivate(false)}
            >
              <Hash size={18} />
              <div>
                <strong>Público</strong>
                <p>Todos os membros do espaço podem entrar e ler.</p>
              </div>
            </button>
            <button
              type="button"
              className={`radio-card${isPrivate ? ' selected' : ''}`}
              onClick={() => setIsPrivate(true)}
            >
              <Lock size={18} />
              <div>
                <strong>Privado</strong>
                <p>Só entra quem for adicionado por um administrador.</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
