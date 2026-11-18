import { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Monitor,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
} from 'lucide-react';
import { formatDuration } from '../../lib/utils';
import { useAppStore } from '../../store/app';
import { useAuthStore } from '../../store/auth';
import { Avatar } from '../ui/Avatar';
import { useCall } from './call-context';

function VideoTile({
  stream,
  muted,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.srcObject !== stream) element.srcObject = stream;
    if (stream) {
      element.play().catch(() => undefined);
    }
    return () => {
      if (element.srcObject === stream) element.srcObject = null;
    };
  }, [stream]);

  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

function LocalTile() {
  const {
    activeCall,
    localStream,
    screenStream,
    screenSharing,
    screenAudioEnabled,
    cameraEnabled,
    micEnabled,
  } = useCall();
  const user = useAuthStore((state) => state.user);
  const preview = screenSharing ? screenStream : localStream;
  const showVideo = Boolean(preview && (screenSharing || (activeCall?.kind === 'video' && cameraEnabled)));

  return (
    <div className={`call-tile local${screenSharing ? ' sharing' : ''}`}>
      {showVideo ? (
        <VideoTile
          stream={preview}
          muted
          className={`call-video${screenSharing ? '' : ' mirrored'}`}
        />
      ) : (
        <div className="call-tile-empty">
          <Avatar name={user?.displayName || 'Você'} src={user?.avatarUrl} size={72} />
          <span className="call-tile-name">Você</span>
        </div>
      )}
      <span className="call-tile-label">
        {!micEnabled && <MicOff size={13} />}
        Você
        {screenSharing ? (screenAudioEnabled ? ' · tela + áudio' : ' · tela') : ''}
      </span>
      {screenSharing && (
        <span className="call-screen-badge">
          {screenAudioEnabled ? 'Compartilhando tela + áudio' : 'Compartilhando tela'}
        </span>
      )}
    </div>
  );
}

function RemoteTile({ userId, callKind }: { userId: string; callKind: 'audio' | 'video' }) {
  const { activeCall, remoteStreams, mediaStates } = useCall();
  const participant = activeCall?.participants.find((item) => item.userId === userId);
  const stream = remoteStreams[userId] || null;
  const state = mediaStates[userId];
  const videoVisible = Boolean(
    stream && (state ? state.video || state.screen : callKind === 'video'),
  );

  return (
    <div className="call-tile">
      {videoVisible ? (
        <VideoTile stream={stream} muted={false} className="call-video" />
      ) : (
        <>
          {stream && <VideoTile stream={stream} muted={false} className="call-video hidden-media" />}
          <div className="call-tile-empty">
            <Avatar
              name={participant?.displayName || participant?.username || 'Participante'}
              src={participant?.avatarUrl}
              size={72}
            />
            <span className="call-tile-name">
              {participant?.displayName || participant?.username || 'Participante'}
            </span>
          </div>
        </>
      )}
      <span className="call-tile-label">
        {state?.audio === false && <MicOff size={13} />}
        {participant?.displayName || participant?.username || 'Participante'}
        {state?.screen ? ' · tela' : ''}
      </span>
    </div>
  );
}

export function CallOverlay() {
  const {
    activeCall,
    incoming,
    leaveCall,
    rejectIncoming,
    acceptIncoming,
    toggleMic,
    toggleCamera,
    toggleScreen,
    micEnabled,
    cameraEnabled,
    screenSharing,
    connecting,
    durationSeconds,
    remoteStreams,
    mediaStates,
  } = useCall();
  const conversations = useAppStore((state) => state.conversations);
  const user = useAuthStore((state) => state.user);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (activeCall?.id) setMinimized(false);
  }, [activeCall?.id]);

  if (!activeCall && !incoming) return null;

  if (activeCall) {
    const conversation = conversations.find((item) => item.id === activeCall.conversationId);
    const title = conversation?.title || conversation?.otherUser?.displayName || 'Chamada';
    const joined = activeCall.participants.filter((participant) => participant.status === 'joined');
    const remoteParticipants = joined.filter((participant) => participant.userId !== user?.id);
    const invited = activeCall.participants.filter((participant) => participant.status === 'invited');
    const waiting = remoteParticipants.length === 0 && invited.length > 0;
    const hasRemoteVideo = remoteParticipants.some((participant) => {
      const state = mediaStates[participant.userId];
      return Boolean(
        remoteStreams[participant.userId] &&
          (state ? state.video || state.screen : activeCall.kind === 'video'),
      );
    });

    return (
      <div className="call-overlay" role="region" aria-label="Chamada em andamento">
        <div className={`call-window${minimized ? ' minimized' : ''}`}>
          <header className="call-header">
            <div>
              <span className="call-kind">
                {activeCall.kind === 'video' ? <Video size={15} /> : <Phone size={15} />}
                Chamada de {activeCall.kind === 'video' ? 'vídeo' : 'áudio'}
              </span>
              <h2>{title}</h2>
              <p>
                {activeCall.status === 'active'
                  ? formatDuration(durationSeconds)
                  : connecting
                    ? 'Conectando…'
                    : 'Chamando…'}
                <span className="call-participant-count">
                  {joined.length} {joined.length === 1 ? 'participante' : 'participantes'}
                </span>
              </p>
            </div>
            <div className="call-header-actions">
              <span className={`call-live-dot${activeCall.status === 'active' ? ' active' : ''}`} />
              <button
                type="button"
                className="call-window-toggle"
                onClick={() => setMinimized((value) => !value)}
                aria-label={minimized ? 'Expandir chamada' : 'Minimizar chamada'}
                title={minimized ? 'Expandir chamada' : 'Minimizar chamada'}
              >
                {minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
              </button>
            </div>
          </header>

          <div
            className={`call-stage${remoteParticipants.length <= 1 ? ' call-stage-single' : ''}${
              hasRemoteVideo && remoteParticipants.length > 1 ? ' call-stage-many' : ''
            }`}
          >
            <LocalTile />
            {remoteParticipants.map((participant) => (
              <RemoteTile
                key={participant.userId}
                userId={participant.userId}
                callKind={activeCall.kind}
              />
            ))}
            {waiting && (
              <div className="call-waiting">
                <span className="ring-pulse" />
                <h3>Aguardando alguém atender…</h3>
                <p>A chamada está tocando para os outros participantes.</p>
              </div>
            )}
          </div>

          <footer className="call-controls">
            <button
              type="button"
              className={`call-control${micEnabled ? '' : ' off'}`}
              onClick={toggleMic}
              aria-label={micEnabled ? 'Desativar microfone' : 'Ativar microfone'}
            >
              {micEnabled ? <Mic size={21} /> : <MicOff size={21} />}
              <span>{micEnabled ? 'Microfone' : 'Mudo'}</span>
            </button>
            {activeCall.kind === 'video' && (
              <button
                type="button"
                className={`call-control${cameraEnabled ? '' : ' off'}`}
                onClick={toggleCamera}
                aria-label={cameraEnabled ? 'Desativar câmera' : 'Ativar câmera'}
                disabled={screenSharing}
              >
                {cameraEnabled && !screenSharing ? <Video size={21} /> : <VideoOff size={21} />}
                <span>Câmera</span>
              </button>
            )}
            <button
              type="button"
              className={`call-control${screenSharing ? ' on' : ''}`}
              onClick={() => void toggleScreen()}
              aria-label={screenSharing ? 'Parar compartilhamento' : 'Compartilhar tela'}
            >
              <Monitor size={21} />
              <span>{screenSharing ? 'Parar tela' : 'Tela'}</span>
            </button>
            <button
              type="button"
              className="call-control hangup"
              onClick={leaveCall}
              aria-label="Sair da chamada"
            >
              <PhoneOff size={21} />
              <span>Sair</span>
            </button>
          </footer>
        </div>
      </div>
    );
  }

  if (!incoming) return null;

  return (
    <div className="call-overlay incoming-overlay" role="dialog" aria-modal="true" aria-label="Chamada recebida">
      <div className="incoming-card">
        <span className="incoming-pulse" />
        <Avatar
          name={incoming.caller.displayName}
          src={incoming.caller.avatarUrl}
          size={96}
          presence={incoming.caller.presence}
        />
        <span className="call-kind centered">
          {incoming.call.kind === 'video' ? <Video size={15} /> : <Phone size={15} />}
          Chamada de {incoming.call.kind === 'video' ? 'vídeo' : 'áudio'}
        </span>
        <h2>{incoming.caller.displayName}</h2>
        <p>
          {incoming.conversationType === 'group'
            ? `Grupo · ${incoming.conversationTitle || 'Conversa'}`
            : 'Chamada direta'}
        </p>
        <div className="incoming-actions">
          <button
            type="button"
            className="call-round reject"
            onClick={rejectIncoming}
            aria-label="Recusar chamada"
          >
            <PhoneOff size={24} />
          </button>
          <button
            type="button"
            className="call-round accept"
            onClick={() => void acceptIncoming()}
            disabled={connecting}
            aria-label="Atender chamada"
          >
            <Phone size={24} />
          </button>
        </div>
        <span className="incoming-hint">
          {connecting ? 'Preparando microfone e câmera…' : 'Atender usa seu microfone e câmera'}
        </span>
      </div>
    </div>
  );
}
