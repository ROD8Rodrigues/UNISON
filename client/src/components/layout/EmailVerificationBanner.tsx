import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, MailWarning, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

export function EmailVerificationBanner() {
  const user = useAuthStore((state) => state.user);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devToken, setDevToken] = useState(
    () => sessionStorage.getItem('tw:dev-verify-token') || '',
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!user || user.emailVerified || dismissed) return null;

  const verifyUrl = devToken
    ? `${window.location.origin}/verify-email?token=${encodeURIComponent(devToken)}`
    : '';

  async function resend() {
    setBusy(true);
    try {
      const data = await api.post<{ delivered: boolean; token?: string }>(
        '/auth/resend-verification',
      );
      if (data.token) {
        setDevToken(data.token);
        sessionStorage.setItem('tw:dev-verify-token', data.token);
        setModalOpen(true);
      }
      toast.success(
        data.delivered ? 'Email reenviado' : 'Link de verificação gerado',
        data.delivered ? 'Confira sua caixa de entrada.' : 'O envio de email não está configurado neste ambiente.',
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ALREADY_VERIFIED') {
        toast.success('Email já verificado');
        void useAuthStore.getState().refreshUser().catch(() => undefined);
      } else {
        toast.error('Não foi possível reenviar', error instanceof ApiError ? error.message : undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(verifyUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Não foi possível copiar o link');
    }
  }

  return (
    <>
      <div className="email-banner">
        <MailWarning size={17} />
        <p>
          Confirme seu email para proteger sua conta.{' '}
          <Link to="/app/settings">Configurações</Link>
        </p>
        <div className="email-banner-actions">
          {devToken && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModalOpen(true)}>
              Abrir link
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void resend()} disabled={busy}>
            {busy ? <Spinner size={14} /> : null}
            Reenviar
          </button>
          <button
            type="button"
            className="icon-btn ghost"
            onClick={() => setDismissed(true)}
            aria-label="Dispensar aviso"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Verificação de email"
        description="O envio de email não está configurado neste ambiente. Use este link para validar a conta."
        size="md"
      >
        <div className="dev-box">
          <strong>Link de verificação</strong>
          <p className="mono-break">{verifyUrl}</p>
          <div className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyLink()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copiado' : 'Copiar link'}
            </button>
            <Link to={verifyUrl.replace(window.location.origin, '')} className="btn btn-primary btn-sm">
              Verificar agora
            </Link>
          </div>
        </div>
      </Modal>
    </>
  );
}
