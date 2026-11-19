import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Maximize2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  PictureInPicture2,
  Volume2,
} from 'lucide-react';
import { resolveMediaUrl } from '../../lib/api';
import { desktopBridge, pictureInPictureSupported } from '../../lib/desktop';
import { classNames, formatDuration } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { Avatar } from '../ui/Avatar';
import { useCall } from './call-context';

interface DockParticipant {
  id: string;
  name: string;
  avatarUrl: string | null;
  muted: boolean;
  screen: boolean;
  self: boolean;
}

interface DockCardProps {
  title: string;
  participants: DockParticipant[];
  durationSeconds: number;
  status: string;
  connecting: boolean;
  micEnabled: boolean;
  screenSharing: boolean;
  variant: 'dock' | 'pip';
  floating: boolean;
  floatingSupported: boolean;
  onToggleMic: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
  onExpand: () => void;
  onFloat: () => void;
}

function DockCard({
  title,
  participants,
  durationSeconds,
  status,
  connecting,
  micEnabled,
  screenSharing,
  variant,
  floating,
  floatingSupported,
  onToggleMic,
  onToggleScreen,
  onLeave,
  onExpand,
  onFloat,
}: DockCardProps) {
  const active = status === 'active';
  const label = title || 'Canal de voz';

  return (
    <section
      className={classNames('voice-dock', variant === 'pip' && 'voice-dock-pip')}
      aria-label={`Canal de voz: ${label}`}
    >
      <header className="voice-dock-head">
        <span className={classNames('voice-dock-live', active && 'active')} aria-hidden="true" />
        <div className="voice-dock-copy">
          <span className="voice-dock-kicker">
            <Volume2 size={12} /> Canal de voz
          </span>
          <strong className="voice-dock-title" title={label}>
            {label}
          </strong>
        </div>
        <span className="voice-dock-time">
          {active ? formatDuration(durationSeconds) : connecting ? 'Conectando…' : 'Aguardando'}
        </span>
        {variant === 'dock' && (
          <div className="voice-dock-head-actions">
            <button
              type="button"
              className={classNames('voice-dock-icon', floating && 'on')}
              onClick={onFloat}
              disabled={!floatingSupported}
              aria-label={floating ? 'Trazer widget de volta' : 'Flutuar widget na tela'}
              title={
                floating
                  ? 'Trazer widget de volta'
                  : floatingSupported
                    ? 'Flutuar widget na tela'
                    : 'Flutuar indisponível neste navegador'
              }
            >
              <PictureInPicture2 size={15} />
            </button>
            <button
              type="button"
              className="voice-dock-icon"
              onClick={onExpand}
              aria-label="Expandir canal de voz"
              title="Expandir canal de voz"
            >
              <Maximize2 size={15} />
            </button>
          </div>
        )}
      </header>

      <div className="voice-dock-people">
        {participants.map((participant) => (
          <span
            className={classNames('voice-dock-person', participant.self && 'self')}
            key={participant.id}
            title={participant.name + (participant.muted ? ' · microfone desligado' : '')}
          >
            <Avatar name={participant.name} src={participant.avatarUrl} size={30} />
            {participant.muted && (
              <span className="voice-dock-badge muted">
                <MicOff size={10} />
              </span>
            )}
            {participant.screen && (
              <span className="voice-dock-badge screen">
                <Monitor size={10} />
              </span>
            )}
          </span>
        ))}
        <span className="voice-dock-count">
          {participants.length} {participants.length === 1 ? 'conectado' : 'conectados'}
        </span>
      </div>

      <footer className="voice-dock-controls">
        <button
          type="button"
          className={classNames('voice-dock-control', !micEnabled && 'off')}
          onClick={onToggleMic}
          aria-label={micEnabled ? 'Desativar microfone' : 'Ativar microfone'}
          title={micEnabled ? 'Desativar microfone' : 'Ativar microfone'}
        >
          {micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
          <span>{micEnabled ? 'Mic' : 'Mudo'}</span>
        </button>
        <button
          type="button"
          className={classNames('voice-dock-control', screenSharing && 'on')}
          onClick={onToggleScreen}
          aria-label={screenSharing ? 'Parar compartilhamento de tela' : 'Compartilhar tela'}
          title={screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
        >
          {screenSharing ? <MonitorOff size={16} /> : <Monitor size={16} />}
          <span>Tela</span>
        </button>
        {variant === 'pip' && (
          <button
            type="button"
            className="voice-dock-control"
            onClick={onExpand}
            aria-label="Abrir o UNISON"
            title="Abrir o UNISON"
          >
            <Maximize2 size={16} />
            <span>Abrir</span>
          </button>
        )}
        <button
          type="button"
          className="voice-dock-control hangup"
          onClick={onLeave}
          aria-label="Sair do canal de voz"
          title="Sair do canal de voz"
        >
          <PhoneOff size={16} />
          <span>Sair</span>
        </button>
      </footer>
    </section>
  );
}

function copyStylesToWindow(target: Window, opener: Document) {
  const doc = target.document;
  doc.documentElement.dataset.theme = opener.documentElement.dataset.theme || 'dark';
  if (opener.documentElement.classList.contains('compact')) {
    doc.documentElement.classList.add('compact');
  }
  if (opener.documentElement.classList.contains('reduce-motion')) {
    doc.documentElement.classList.add('reduce-motion');
  }
  const accent = opener.documentElement.style.getPropertyValue('--accent');
  if (accent) doc.documentElement.style.setProperty('--accent', accent);

  for (const node of Array.from(
    opener.querySelectorAll('link[rel="stylesheet"], style'),
  )) {
    if (node.tagName === 'LINK') {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = (node as HTMLLinkElement).href;
      doc.head.appendChild(link);
    } else {
      doc.head.appendChild(node.cloneNode(true));
    }
  }

  const base = doc.createElement('style');
  base.textContent = `
    html, body { margin: 0; height: 100%; overflow: hidden; background: #07050a; }
    body.voice-pip-body { display: flex; padding: 0; }
    body.voice-pip-body #voice-pip-root { display: flex; flex: 1; min-width: 0; }
    .voice-dock-pip { position: static; width: 100%; max-width: none; height: 100%; border-radius: 0; border: 0; padding: 10px 11px 9px; }
  `;
  doc.head.appendChild(base);
  doc.title = 'UNISON — Voz';
}

export function VoiceDock({
  title,
  pinned,
  onExpand,
  onPinnedChange,
}: {
  title: string;
  pinned: boolean;
  onExpand: () => void;
  onPinnedChange: (pinned: boolean) => void;
}) {
  const {
    activeCall,
    micEnabled,
    screenSharing,
    connecting,
    durationSeconds,
    mediaStates,
    toggleMic,
    toggleScreen,
    leaveCall,
  } = useCall();
  const user = useAuthStore((state) => state.user);
  const [pipDoc, setPipDoc] = useState<Document | null>(null);
  const [pipOpening, setPipOpening] = useState(false);
  const pipRef = useRef<Window | null>(null);
  const bridgeAvailable = Boolean(desktopBridge());
  const pipSupported = pictureInPictureSupported() || bridgeAvailable;

  const participants = useMemo<DockParticipant[]>(() => {
    if (!activeCall) return [];
    return activeCall.participants
      .filter((participant) => participant.status === 'joined')
      .map((participant) => {
        const self = participant.userId === user?.id;
        const state = mediaStates[participant.userId];
        return {
          id: participant.userId,
          name: self ? 'Você' : participant.displayName || participant.username,
          avatarUrl: participant.avatarUrl,
          muted: self ? !micEnabled : state?.audio === false,
          screen: self ? screenSharing : Boolean(state?.screen),
          self,
        };
      });
  }, [activeCall, mediaStates, micEnabled, screenSharing, user?.id]);

  const closePip = useCallback(() => {
    const pip = pipRef.current;
    pipRef.current = null;
    setPipDoc(null);
    onPinnedChange(false);
    if (pip && !pip.closed) pip.close();
  }, [onPinnedChange]);

  useEffect(() => {
    return () => {
      const pip = pipRef.current;
      pipRef.current = null;
      if (pip && !pip.closed) pip.close();
    };
  }, []);

  async function toggleFloat() {
    const bridge = desktopBridge();
    if (bridge) {
      onPinnedChange(!pinned);
      return;
    }
    if (!window.documentPictureInPicture) {
      toast.info(
        'Flutuar não é suportado neste navegador',
        'No app para Windows o widget fica sempre visível e não bloqueia o mouse. No navegador, use Chrome ou Edge.',
      );
      return;
    }
    if (pipRef.current && !pipRef.current.closed) {
      closePip();
      return;
    }
    if (pipOpening) return;
    setPipOpening(true);
    try {
      const pip = await window.documentPictureInPicture.requestWindow({
        width: 330,
        height: 186,
        disallowReturnToOpener: true,
      });
      pipRef.current = pip;
      copyStylesToWindow(pip, document);
      pip.document.body.className = 'voice-pip-body';
      const root = pip.document.createElement('div');
      root.id = 'voice-pip-root';
      pip.document.body.appendChild(root);
      pip.addEventListener(
        'pagehide',
        () => {
          pipRef.current = null;
          setPipDoc(null);
          onPinnedChange(false);
        },
        { once: true },
      );
      setPipDoc(pip.document);
      onPinnedChange(true);
    } catch {
      toast.error(
        'Não foi possível abrir a janela flutuante',
        'Permita janelas pop-up para o UNISON e tente novamente.',
      );
    } finally {
      setPipOpening(false);
    }
  }

  const card = (
    <DockCard
      title={title}
      participants={participants}
      durationSeconds={durationSeconds}
      status={activeCall?.status || 'ringing'}
      connecting={connecting}
      micEnabled={micEnabled}
      screenSharing={screenSharing}
      variant={pipDoc ? 'pip' : 'dock'}
      floating={pinned}
      floatingSupported={pipSupported}
      onToggleMic={toggleMic}
      onToggleScreen={() => void toggleScreen()}
      onLeave={leaveCall}
      onExpand={() => {
        if (pipDoc) closePip();
        onExpand();
      }}
      onFloat={() => void toggleFloat()}
    />
  );

  return (
    <>
      {!pipDoc && card}
      {pipDoc &&
        (() => {
          const root = pipDoc.getElementById('voice-pip-root');
          return root ? createPortal(card, root) : null;
        })()}
    </>
  );
}

export function VoiceOverlaySync({
  pinned,
  onOpen,
}: {
  pinned: boolean;
  onOpen: () => void;
}) {
  const { activeCall, micEnabled, screenSharing, mediaStates, toggleMic, leaveCall } = useCall();
  const conversations = useAppStore((state) => state.conversations);
  const user = useAuthStore((state) => state.user);
  const isVoice = Boolean(activeCall?.channelId);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    if (!isVoice || !activeCall) {
      bridge.updateVoiceOverlay(null);
      return;
    }
    const conversation = conversations.find((item) => item.id === activeCall.conversationId);
    const title = (conversation?.title || 'Canal de voz').replace(/^#/, '');
    const participants = activeCall.participants
      .filter((participant) => participant.status === 'joined')
      .map((participant) => {
        const self = participant.userId === user?.id;
        return {
          id: participant.userId,
          name: self ? 'Você' : participant.displayName || participant.username,
          avatarUrl: participant.avatarUrl ? resolveMediaUrl(participant.avatarUrl) : null,
          muted: self ? !micEnabled : mediaStates[participant.userId]?.audio === false,
        };
      });
    bridge.updateVoiceOverlay({
      title,
      channelId: activeCall.channelId,
      startedAt: activeCall.startedAt,
      micEnabled,
      screenSharing,
      pinned,
      participants,
    });
  }, [
    activeCall,
    conversations,
    isVoice,
    mediaStates,
    micEnabled,
    pinned,
    screenSharing,
    user?.id,
  ]);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return undefined;
    return () => bridge.updateVoiceOverlay(null);
  }, []);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return undefined;
    return bridge.onVoiceOverlayCommand((command) => {
      if (command.action === 'toggle-mic') toggleMic();
      else if (command.action === 'leave') leaveCall();
      else if (command.action === 'open') onOpen();
    });
  }, [leaveCall, onOpen, toggleMic]);

  return null;
}
