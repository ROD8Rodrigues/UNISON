import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Call } from '../../lib/types';
import { playNotificationSound } from '../../lib/utils';
import { connectSocket, emitWithAck, getSocket } from '../../lib/socket';
import { useAuthStore } from '../../store/auth';
import { toast } from '../../store/toast';
import { CallContext, type CallContextValue, type IncomingCall, type ParticipantMediaState } from './call-context';
import { CallOverlay } from './CallOverlay';

interface PeerWrapper {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  allowNegotiation: boolean;
  pending: RTCIceCandidateInit[];
}

interface SignalPayload {
  callId: string;
  fromUserId: string;
  signal: {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
}

interface MediaStatePayload {
  callId: string;
  userId: string;
  audio: boolean;
  video: boolean;
  screen: boolean;
}

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [];
  const stun = (
    (import.meta.env.VITE_STUN_URLS as string | undefined) ||
    'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const url of stun) servers.push({ urls: url });
  const turnUrl = (import.meta.env.VITE_TURN_URL as string | undefined)?.trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: (import.meta.env.VITE_TURN_USERNAME as string | undefined) || '',
      credential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) || '',
    });
  }
  return servers;
}

function errorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Tente novamente em instantes.';
}

export function CallProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const myId = user?.id || '';
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [mediaStates, setMediaStates] = useState<Record<string, ParticipantMediaState>>({});
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenAudioEnabled, setScreenAudioEnabled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const activeRef = useRef<Call | null>(null);
  const incomingRef = useRef<IncomingCall | null>(null);
  const peersRef = useRef(new Map<string, PeerWrapper>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const outboundRef = useRef<MediaStream | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenAudioSendersRef = useRef(new Map<string, RTCRtpSender>());
  const micRef = useRef(true);
  const cameraRef = useRef(false);
  const screenRef = useRef(false);
  const ringTimerRef = useRef<number | null>(null);

  const stopRinging = useCallback(() => {
    if (ringTimerRef.current !== null) {
      window.clearInterval(ringTimerRef.current);
      ringTimerRef.current = null;
    }
  }, []);

  const startRinging = useCallback(() => {
    stopRinging();
    playNotificationSound(0.05);
    ringTimerRef.current = window.setInterval(() => playNotificationSound(0.05), 2600);
  }, [stopRinging]);

  const applyCall = useCallback((call: Call | null) => {
    activeRef.current = call;
    setActiveCall(call);
    if (call?.startedAt) {
      setStartedAt((current) => current ?? new Date(call.startedAt as string).getTime());
    }
  }, []);

  const cleanup = useCallback(() => {
    stopRinging();
    for (const wrapper of peersRef.current.values()) {
      try {
        wrapper.pc.onicecandidate = null;
        wrapper.pc.ontrack = null;
        wrapper.pc.onnegotiationneeded = null;
        wrapper.pc.onconnectionstatechange = null;
        wrapper.pc.close();
      } catch {
        // Closing a peer twice is harmless.
      }
    }
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenTrackRef.current?.stop();
    screenAudioTrackRef.current?.stop();
    screenAudioSendersRef.current.clear();
    localStreamRef.current = null;
    outboundRef.current = null;
    audioTrackRef.current = null;
    cameraTrackRef.current = null;
    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    activeRef.current = null;
    incomingRef.current = null;
    micRef.current = true;
    cameraRef.current = false;
    screenRef.current = false;
    setActiveCall(null);
    setIncoming(null);
    setLocalStream(null);
    setScreenStream(null);
    setRemoteStreams({});
    setMediaStates({});
    setMicEnabled(true);
    setCameraEnabled(false);
    setScreenSharing(false);
    setScreenAudioEnabled(false);
    setConnecting(false);
    setStartedAt(null);
    setDurationSeconds(0);
  }, [stopRinging]);

  const activeCallId = activeCall?.id;
  const activeCallStatus = activeCall?.status;

  useEffect(() => {
    if (!activeCallId || !startedAt || activeCallStatus !== 'active') {
      setDurationSeconds(0);
      return;
    }
    const update = () => setDurationSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeCallId, activeCallStatus, startedAt]);

  const sendSignal = useCallback(
    (targetUserId: string, signal: SignalPayload['signal']) => {
      const call = activeRef.current;
      const socket = getSocket();
      if (!call || !socket?.connected) return;
      socket.emit('webrtc:signal', { callId: call.id, targetUserId, signal });
    },
    [],
  );

  const broadcastMediaState = useCallback((callIdOverride?: string) => {
    const callId = callIdOverride || activeRef.current?.id;
    if (!callId) return;
    getSocket()?.emit('call:media-state', {
      callId,
      audio: micRef.current,
      video: cameraRef.current,
      screen: screenRef.current,
    });
  }, []);

  const negotiatePeer = useCallback(
    async (peerId: string) => {
      const wrapper = peersRef.current.get(peerId);
      if (
        !wrapper ||
        !wrapper.allowNegotiation ||
        wrapper.makingOffer ||
        wrapper.pc.signalingState === 'closed'
      ) {
        return;
      }
      try {
        wrapper.makingOffer = true;
        await wrapper.pc.setLocalDescription();
        if (wrapper.pc.localDescription) {
          sendSignal(peerId, { description: wrapper.pc.localDescription });
        }
      } catch {
        // A parallel negotiation may win; the perfect-negotiation flow recovers.
      } finally {
        wrapper.makingOffer = false;
      }
    },
    [sendSignal],
  );

  const flushCandidates = useCallback(async (wrapper: PeerWrapper) => {
    if (!wrapper.pc.remoteDescription) return;
    const queued = wrapper.pending.splice(0, wrapper.pending.length);
    for (const candidate of queued) {
      try {
        await wrapper.pc.addIceCandidate(candidate);
      } catch {
        // Candidates that arrive too late can be safely ignored.
      }
    }
  }, []);

  const ensurePeer = useCallback(
    (peerId: string, initiate = false) => {
      let wrapper = peersRef.current.get(peerId);
      if (wrapper) {
        if (initiate) {
          wrapper.allowNegotiation = true;
          void negotiatePeer(peerId);
        }
        return wrapper;
      }

      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      wrapper = {
        pc,
        polite: myId.localeCompare(peerId) > 0,
        makingOffer: false,
        ignoreOffer: false,
        allowNegotiation: false,
        pending: [],
      };
      peersRef.current.set(peerId, wrapper);

      const outbound = outboundRef.current;
      if (outbound) {
        for (const track of outbound.getTracks()) {
          try {
            const sender = pc.addTrack(track, outbound);
            if (track === screenAudioTrackRef.current) {
              screenAudioSendersRef.current.set(peerId, sender);
            }
          } catch {
            // A track can disappear during device changes.
          }
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) sendSignal(peerId, { candidate: event.candidate.toJSON() });
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        setRemoteStreams((current) => ({ ...current, [peerId]: stream }));
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {
            // Reconnection is best-effort.
          }
        }
      };
      pc.onnegotiationneeded = () => {
        if (wrapper?.allowNegotiation) void negotiatePeer(peerId);
      };

      const created = wrapper;
      if (initiate) {
        created.allowNegotiation = true;
        window.setTimeout(() => {
          if (
            peersRef.current.get(peerId) === created &&
            created.pc.signalingState === 'stable' &&
            !created.pc.localDescription
          ) {
            void negotiatePeer(peerId);
          }
        }, 140);
      }
      return created;
    },
    [myId, negotiatePeer, sendSignal],
  );

  const handleSignal = useCallback(
    async (payload: SignalPayload) => {
      if (!activeRef.current || payload.callId !== activeRef.current.id) return;
      if (!payload.fromUserId || !payload.signal) return;
      const wrapper = ensurePeer(payload.fromUserId);

      if (payload.signal.candidate) {
        if (wrapper.ignoreOffer) return;
        if (wrapper.pc.remoteDescription) {
          try {
            await wrapper.pc.addIceCandidate(payload.signal.candidate);
          } catch {
            // Ignore late candidates.
          }
        } else {
          wrapper.pending.push(payload.signal.candidate);
        }
        return;
      }

      const description = payload.signal.description;
      if (!description) return;
      const collision =
        description.type === 'offer' &&
        (wrapper.makingOffer || wrapper.pc.signalingState !== 'stable');
      wrapper.ignoreOffer = !wrapper.polite && collision;
      if (wrapper.ignoreOffer) return;

      try {
        if (collision && wrapper.polite && wrapper.pc.signalingState === 'have-local-offer') {
          await wrapper.pc.setLocalDescription({ type: 'rollback' });
        }
        await wrapper.pc.setRemoteDescription(description);
        wrapper.ignoreOffer = false;
        await flushCandidates(wrapper);
        if (description.type === 'offer') {
          await wrapper.pc.setLocalDescription();
          if (wrapper.pc.localDescription) {
            sendSignal(payload.fromUserId, { description: wrapper.pc.localDescription });
          }
        }
        if (!wrapper.allowNegotiation) {
          wrapper.allowNegotiation = true;
          wrapper.pc.onnegotiationneeded = () => {
            if (wrapper?.allowNegotiation) void negotiatePeer(payload.fromUserId);
          };
        }
      } catch {
        // Negotiation errors usually mean the other side already left.
      }
    },
    [ensurePeer, flushCandidates, negotiatePeer, sendSignal],
  );

  const closePeer = useCallback((peerId: string) => {
    const wrapper = peersRef.current.get(peerId);
    if (wrapper) {
      try {
        wrapper.pc.close();
      } catch {
        // Already closed.
      }
      peersRef.current.delete(peerId);
    }
    screenAudioSendersRef.current.delete(peerId);
    setRemoteStreams((current) => {
      if (!current[peerId]) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
    setMediaStates((current) => {
      if (!current[peerId]) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  async function acquireStream(kind: 'audio' | 'video') {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Seu navegador não oferece acesso a câmera e microfone neste contexto.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video:
          kind === 'video'
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            : false,
      });
      return stream;
    } catch (error) {
      if (kind === 'video') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          toast.info('Câmera indisponível', 'A chamada continuará somente com áudio.');
          return stream;
        } catch {
          // Fall through to the common error below.
        }
      }
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        throw new Error('Permissão de microfone/câmera negada. Autorize o acesso e tente novamente.', {
          cause: error,
        });
      }
      if (name === 'NotFoundError') {
        throw new Error('Nenhum microfone ou câmera foi encontrado neste dispositivo.', {
          cause: error,
        });
      }
      throw new Error('Não foi possível acessar o microfone. Verifique as permissões do navegador.', {
        cause: error,
      });
    }
  }

  const setupLocalStream = useCallback((stream: MediaStream) => {
    const outbound = new MediaStream();
    stream.getTracks().forEach((track) => outbound.addTrack(track));
    localStreamRef.current = stream;
    outboundRef.current = outbound;
    audioTrackRef.current = stream.getAudioTracks()[0] || null;
    cameraTrackRef.current = stream.getVideoTracks()[0] || null;
    micRef.current = Boolean(audioTrackRef.current?.enabled);
    cameraRef.current = Boolean(cameraTrackRef.current?.enabled);
    setLocalStream(stream);
    setMicEnabled(micRef.current);
    setCameraEnabled(cameraRef.current);
  }, []);

  const startCall = useCallback(
    async (conversationId: string, kind: 'audio' | 'video') => {
      if (activeRef.current || incomingRef.current) {
        toast.info('Você já está em uma chamada');
        return;
      }
      setConnecting(true);
      let acquired: MediaStream | null = null;
      try {
        acquired = await acquireStream(kind);
        setupLocalStream(acquired);
        const data = await emitWithAck<{ call: Call }>('call:start', { conversationId, kind });
        applyCall(data.call);
        setStartedAt(null);
        broadcastMediaState(data.call.id);
      } catch (error) {
        acquired?.getTracks().forEach((track) => track.stop());
        cleanup();
        toast.error('Chamada não iniciada', errorText(error));
      } finally {
        setConnecting(false);
      }
    },
    [applyCall, broadcastMediaState, cleanup, setupLocalStream],
  );

  const joinVoice = useCallback(
    async (channelId: string) => {
      const current = activeRef.current;
      if (current?.channelId === channelId) return;
      if (current || incomingRef.current) {
        toast.info('Você já está em uma chamada');
        return;
      }
      if (connecting) return;
      setConnecting(true);
      let acquired: MediaStream | null = null;
      let callId: string | null = null;
      try {
        acquired = await acquireStream('audio');
        setupLocalStream(acquired);
        const data = await emitWithAck<{ call: Call; participants: Call['participants'] }>(
          'call:join-voice',
          { channelId },
        );
        callId = data.call.id;
        applyCall(data.call);
        setStartedAt(data.call.startedAt ? new Date(data.call.startedAt).getTime() : Date.now());
        for (const participant of data.participants || []) {
          if (participant.userId !== myId && participant.status === 'joined') {
            ensurePeer(participant.userId, true);
          }
        }
        broadcastMediaState(data.call.id);
      } catch (error) {
        acquired?.getTracks().forEach((track) => track.stop());
        if (callId) getSocket()?.emit('call:leave', { callId });
        cleanup();
        toast.error('Não foi possível entrar no canal de voz', errorText(error));
      } finally {
        setConnecting(false);
      }
    },
    [applyCall, broadcastMediaState, cleanup, connecting, ensurePeer, myId, setupLocalStream],
  );

  const acceptIncoming = useCallback(async () => {
    const pending = incomingRef.current;
    if (!pending) return;
    if (activeRef.current) {
      toast.info('Você já está em outra chamada');
      return;
    }
    if (connecting) return;
    setConnecting(true);
    let acquired: MediaStream | null = null;
    let accepted = false;
    try {
      acquired = await acquireStream(pending.call.kind);
      setupLocalStream(acquired);
      const data = await emitWithAck<{ call: Call; participants: Call['participants'] }>(
        'call:accept',
        { callId: pending.call.id },
      );
      accepted = true;
      stopRinging();
      incomingRef.current = null;
      setIncoming(null);
      applyCall(data.call);
      for (const participant of data.participants || []) {
        if (participant.userId !== myId && participant.status === 'joined') {
          ensurePeer(participant.userId, true);
        }
      }
      broadcastMediaState(pending.call.id);
    } catch (error) {
      acquired?.getTracks().forEach((track) => track.stop());
      const socket = getSocket();
      if (accepted) socket?.emit('call:leave', { callId: pending.call.id });
      else socket?.emit('call:reject', { callId: pending.call.id });
      cleanup();
      toast.error('Não foi possível atender', errorText(error));
    } finally {
      setConnecting(false);
    }
  }, [
    applyCall,
    broadcastMediaState,
    cleanup,
    connecting,
    ensurePeer,
    myId,
    setupLocalStream,
    stopRinging,
  ]);

  const rejectIncoming = useCallback(() => {
    const pending = incomingRef.current;
    if (!pending) return;
    getSocket()?.emit('call:reject', { callId: pending.call.id });
    incomingRef.current = null;
    setIncoming(null);
    stopRinging();
  }, [stopRinging]);

  const leaveCall = useCallback(() => {
    const call = activeRef.current;
    if (call) getSocket()?.emit('call:leave', { callId: call.id });
    cleanup();
  }, [cleanup]);

  const toggleMic = useCallback(() => {
    const track = audioTrackRef.current;
    if (!track) {
      toast.info('Nenhum microfone disponível');
      return;
    }
    track.enabled = !track.enabled;
    micRef.current = track.enabled;
    setMicEnabled(track.enabled);
    broadcastMediaState();
  }, [broadcastMediaState]);

  const toggleCamera = useCallback(() => {
    if (screenRef.current) {
      toast.info('Pare o compartilhamento para usar a câmera');
      return;
    }
    const track = cameraTrackRef.current;
    if (!track) {
      toast.info('Nenhuma câmera disponível');
      return;
    }
    track.enabled = !track.enabled;
    cameraRef.current = track.enabled;
    setCameraEnabled(track.enabled);
    broadcastMediaState();
  }, [broadcastMediaState]);

  const stopScreenShare = useCallback(async () => {
    const screenTrack = screenTrackRef.current;
    const screenAudio = screenAudioTrackRef.current;
    if (!screenTrack && !screenAudio) return;

    screenTrackRef.current = null;
    screenAudioTrackRef.current = null;
    screenRef.current = false;
    setScreenSharing(false);
    setScreenAudioEnabled(false);
    setScreenStream(null);

    const camera = cameraTrackRef.current;
    const outbound = outboundRef.current;
    if (outbound) {
      outbound.getVideoTracks().forEach((track) => outbound.removeTrack(track));
      if (camera) outbound.addTrack(camera);
      if (screenAudio) outbound.removeTrack(screenAudio);
    }

    await Promise.all([
      ...(screenTrack
        ? [...peersRef.current.values()].map(async (wrapper) => {
            const sender =
              wrapper.pc.getSenders().find((item) => item.track === screenTrack) ||
              wrapper.pc.getSenders().find((item) => item.track?.kind === 'video');
            if (sender) {
              try {
                await sender.replaceTrack(camera || null);
              } catch {
                // The peer may be closing.
              }
            }
          })
        : []),
      ...[...screenAudioSendersRef.current.values()].map(async (sender) => {
        try {
          await sender.replaceTrack(null);
        } catch {
          // The peer may be closing.
        }
      }),
    ]);

    screenTrack?.stop();
    screenAudio?.stop();
    broadcastMediaState();
  }, [broadcastMediaState]);

  const toggleScreen = useCallback(async () => {
    if (screenRef.current) {
      await stopScreenShare();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error('Compartilhamento indisponível', 'Este navegador não oferece captura de tela.');
      return;
    }
    try {
      let display: MediaStream | null = null;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'TypeError' || name === 'NotSupportedError') {
          display = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30 } },
            audio: false,
          });
          toast.info('Áudio da tela indisponível', 'Este navegador só compartilha a imagem.');
        } else {
          throw error;
        }
      }
      if (!display) throw new Error('Nenhuma tela foi selecionada.');

      const track = display.getVideoTracks()[0];
      if (!track) throw new Error('Nenhuma tela foi selecionada.');
      const audio = display.getAudioTracks()[0] || null;
      if (audio) audio.contentHint = 'music';

      track.onended = () => {
        void stopScreenShare();
      };
      screenTrackRef.current = track;
      screenAudioTrackRef.current = audio;
      screenRef.current = true;
      setScreenStream(display);
      setScreenSharing(true);
      setScreenAudioEnabled(Boolean(audio));

      if (!audio) {
        toast.info(
          'Tela compartilhada sem áudio',
          'Para transmitir o som, marque "Compartilhar áudio" na janela de seleção.',
        );
      }

      const outbound = outboundRef.current;
      if (outbound) {
        outbound.getVideoTracks().forEach((item) => outbound.removeTrack(item));
        outbound.addTrack(track);
        if (audio) outbound.addTrack(audio);
      }

      await Promise.all(
        [...peersRef.current.entries()].map(async ([peerId, wrapper]) => {
          if (wrapper.pc.signalingState === 'closed') return;
          const videoSender = wrapper.pc.getSenders().find((item) => item.track?.kind === 'video');
          try {
            if (videoSender) await videoSender.replaceTrack(track);
            else if (outbound) wrapper.pc.addTrack(track, outbound);
          } catch {
            // The peer may be renegotiating.
          }
          if (!audio) return;
          const audioSender = screenAudioSendersRef.current.get(peerId);
          if (audioSender) {
            try {
              await audioSender.replaceTrack(audio);
            } catch {
              // The peer may be renegotiating.
            }
          } else if (outbound) {
            try {
              screenAudioSendersRef.current.set(peerId, wrapper.pc.addTrack(audio, outbound));
            } catch {
              // The peer may be renegotiating.
            }
          }
        }),
      );
      broadcastMediaState();
    } catch (error) {
      if (screenTrackRef.current) await stopScreenShare();
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        toast.info('Compartilhamento cancelado');
      } else {
        toast.error('Não foi possível compartilhar a tela', errorText(error));
      }
    }
  }, [broadcastMediaState, stopScreenShare]);

  useEffect(() => {
    const socket = connectSocket();
    if (!socket.connected) socket.connect();

    const onIncoming = (payload: IncomingCall) => {
      if (!payload?.call) return;
      if (activeRef.current || incomingRef.current) {
        socket.emit('call:reject', { callId: payload.call.id });
        toast.info('Chamada recusada', 'Você já está em outra chamada.');
        return;
      }
      incomingRef.current = payload;
      setIncoming(payload);
      startRinging();
    };

    const onParticipantJoined = (payload: {
      callId: string;
      participants?: Call['participants'];
      call?: Call;
    }) => {
      if (!activeRef.current || activeRef.current.id !== payload.callId) return;
      if (payload.call) applyCall(payload.call);
      broadcastMediaState(payload.callId);
    };

    const onParticipantLeft = (payload: { callId: string; userId: string; call?: Call }) => {
      if (!activeRef.current || activeRef.current.id !== payload.callId) return;
      closePeer(payload.userId);
      if (payload.call) applyCall(payload.call);
    };

    const onParticipantDeclined = (payload: {
      callId: string;
      participant?: { displayName?: string };
      call?: Call;
    }) => {
      if (!activeRef.current || activeRef.current.id !== payload.callId) return;
      if (payload.call) applyCall(payload.call);
      if (payload.participant?.displayName) {
        toast.info(`${payload.participant.displayName} recusou a chamada`);
      }
    };

    const onMediaState = (payload: MediaStatePayload) => {
      if (!activeRef.current || activeRef.current.id !== payload.callId) return;
      setMediaStates((current) => ({
        ...current,
        [payload.userId]: {
          audio: payload.audio,
          video: payload.video,
          screen: payload.screen,
        },
      }));
    };

    const onCallEnded = (payload: { callId: string; reason?: string }) => {
      const wasActive = activeRef.current?.id === payload.callId;
      const wasIncoming = incomingRef.current?.call.id === payload.callId;
      if (!wasActive && !wasIncoming) return;
      cleanup();
      if (payload.reason === 'declined') toast.info('Chamada recusada');
      else if (payload.reason === 'no-answer') toast.info('Chamada não atendida');
      else if (payload.reason === 'missed') toast.info('Chamada perdida');
      else toast.info('Chamada encerrada');
    };

    const onDisconnect = () => {
      if (activeRef.current || incomingRef.current) {
        cleanup();
        toast.error('Chamada encerrada', 'A conexão com o servidor foi interrompida.');
      }
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:participant-joined', onParticipantJoined);
    socket.on('call:participant-left', onParticipantLeft);
    socket.on('call:participant-declined', onParticipantDeclined);
    socket.on('call:media-state', onMediaState);
    socket.on('call:ended', onCallEnded);
    socket.on('webrtc:signal', handleSignal);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:participant-joined', onParticipantJoined);
      socket.off('call:participant-left', onParticipantLeft);
      socket.off('call:participant-declined', onParticipantDeclined);
      socket.off('call:media-state', onMediaState);
      socket.off('call:ended', onCallEnded);
      socket.off('webrtc:signal', handleSignal);
      socket.off('disconnect', onDisconnect);
      cleanup();
    };
  }, [
    applyCall,
    broadcastMediaState,
    cleanup,
    closePeer,
    handleSignal,
    startRinging,
  ]);

  const value = useMemo<CallContextValue>(
    () => ({
      activeCall,
      incoming,
      localStream,
      screenStream,
      remoteStreams,
      mediaStates,
      micEnabled,
      cameraEnabled,
      screenSharing,
      screenAudioEnabled,
      connecting,
      durationSeconds,
      startCall,
      joinVoice,
      acceptIncoming,
      rejectIncoming,
      leaveCall,
      toggleMic,
      toggleCamera,
      toggleScreen,
    }),
    [
      acceptIncoming,
      activeCall,
      cameraEnabled,
      connecting,
      durationSeconds,
      incoming,
      joinVoice,
      leaveCall,
      localStream,
      mediaStates,
      micEnabled,
      rejectIncoming,
      remoteStreams,
      screenSharing,
      screenAudioEnabled,
      screenStream,
      startCall,
      toggleCamera,
      toggleMic,
      toggleScreen,
    ],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <CallOverlay />
    </CallContext.Provider>
  );
}
