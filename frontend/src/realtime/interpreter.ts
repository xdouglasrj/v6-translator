import {
  startStreamCapture,
  stopStreamCapture,
  setCaptureMuted,
  startStreamPlayback,
  writeStreamChunk,
  stopStreamPlayback,
  addRealtimeListener,
} from "@/src/audio/realtimeAudio";
import type { InterpreterConfig, InterpreterSnapshot, InterpreterTimings } from "./state";
import { INITIAL_STATE, DEFAULT_CONFIG } from "./state";
import {
  fetchClientSecret,
  buildInstructions,
  openSession,
  type RealtimeSession,
} from "./session";

type InterpreterListener = (snapshot: InterpreterSnapshot) => void;

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAYS = [1000, 2000, 4000];

export function createInterpreter() {
  let snapshot: InterpreterSnapshot = { ...INITIAL_STATE };
  let session: RealtimeSession | null = null;
  let listener: InterpreterListener | null = null;
  let userDisconnected = false;
  let reconnectAttempt = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let micChunkSub: { remove: () => void } | null = null;
  let playbackStopSub: { remove: () => void } | null = null;
  let firstAudioSub: { remove: () => void } | null = null;
  let config: InterpreterConfig = { ...DEFAULT_CONFIG };

  function emit(partial: Partial<InterpreterSnapshot>) {
    snapshot = { ...snapshot, ...partial };
    listener?.(snapshot);
  }

  function emitTimings(partial: Partial<InterpreterTimings>) {
    const timings = { ...snapshot.timings, ...partial };
    snapshot = { ...snapshot, timings };
    listener?.(snapshot);
  }

  function clearResumeTimer() {
    if (resumeTimer !== null) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  }

  function now() {
    return Date.now();
  }

  async function handleRawEvent(data: Record<string, unknown>) {
    const type = data.type as string | undefined;
    if (!type) return;

    if (type === "input_audio_buffer.speech_started") {
      emitTimings({ speechStartedAt: now() });
      emit({ state: "PESSOA_FALANDO" });
      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      emitTimings({ speechEndedAt: now() });
      emit({ state: "INTERPRETANDO" });
      return;
    }

    if (type === "response.created") {
      emitTimings({ responseCreatedAt: now(), firstAudioPlayedAt: null, firstAudioReceivedAt: null });
      emit({ lastInterpretation: "" });
      return;
    }

    if (type === "response.output_audio.delta") {
      if (snapshot.state !== "IA_FALANDO") {
        emitTimings({ firstAudioReceivedAt: now() });
        emit({ state: "IA_FALANDO" });
        await setCaptureMuted(true).catch(() => {});
        clearResumeTimer();
      }
      const delta = data.delta as string | undefined;
      if (delta) {
        await writeStreamChunk(delta).catch(() => {});
      }
      return;
    }

    if (type === "response.output_audio.done") {
      emitTimings({ responseDoneAt: now() });
      scheduleResume();
      return;
    }

    if (type === "response.output_audio_transcript.delta") {
      const delta = data.delta as string | undefined;
      if (delta) {
        emit({ lastInterpretation: snapshot.lastInterpretation + delta });
      }
      return;
    }

    if (type === "response.output_audio_transcript.done") {
      // transcript complete, nothing extra to do
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = data.transcript as string | undefined;
      if (transcript) {
        emit({ lastSpeech: transcript });
      }
      return;
    }

    if (type === "response.done") {
      const endedAt = now();
      const speechEnded = snapshot.timings.speechEndedAt;
      const firstPlayed = snapshot.timings.firstAudioPlayedAt;
      const latencyMs =
        speechEnded && firstPlayed ? firstPlayed - speechEnded : null;
      emitTimings({ responseDoneAt: endedAt });
      emit({ latencyMs });
      return;
    }

    if (type === "error") {
      const msg = (data.error as { message?: string })?.message ?? "Erro desconhecido";
      emit({ state: "ERRO", error: msg });
      return;
    }

    // Unknown events go to debug log, never throw
    console.log("[realtime:unknown]", type);
  }

  function scheduleResume() {
    clearResumeTimer();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      setCaptureMuted(false).catch(() => {});
      emit({ state: "OUVINDO" });
    }, config.resumeDelayMs);
  }

  async function reconnect() {
    if (userDisconnected) return;
    if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      emit({ state: "ERRO", error: "Falha após 3 tentativas de reconexão" });
      return;
    }

    const delay = RECONNECT_DELAYS[reconnectAttempt] ?? 4000;
    reconnectAttempt++;
    emit({ state: "CONECTANDO", attempts: reconnectAttempt });

    await new Promise((r) => setTimeout(r, delay));
    if (userDisconnected) return;

    try {
      await doConnect();
    } catch {
      await reconnect();
    }
  }

  function teardownAudio() {
    micChunkSub?.remove();
    micChunkSub = null;
    playbackStopSub?.remove();
    playbackStopSub = null;
    firstAudioSub?.remove();
    firstAudioSub = null;
    stopStreamCapture().catch(() => {});
    stopStreamPlayback().catch(() => {});
  }

  async function doConnect() {
    teardownAudio();
    const instructions = buildInstructions(config);
    const secret = await fetchClientSecret(config.serverUrl, instructions);

    session = openSession(secret.value, instructions, (evt) => {
      if (evt.type === "connected") {
        reconnectAttempt = 0;
        emit({ state: "OUVINDO", error: null });
      } else if (evt.type === "disconnected") {
        if (!userDisconnected) {
          void reconnect();
        }
      } else if (evt.type === "error") {
        emit({ state: "ERRO", error: evt.message });
      } else if (evt.type === "raw") {
        void handleRawEvent(evt.data);
      }
    });

    // Send mic audio to WebSocket
    await startStreamCapture();
    micChunkSub = addRealtimeListener("onAudioChunk", (...args: unknown[]) => {
      const chunk = args[0] as { base64?: string };
      if (chunk?.base64 && session) {
        session.send({
          type: "input_audio_buffer.append",
          audio: chunk.base64,
        });
      }
    });

    // Start playback
    await startStreamPlayback();

    // Track first playback start
    playbackStopSub = addRealtimeListener("onStreamPlaybackStop", () => {
      if (snapshot.state === "IA_FALANDO") {
        scheduleResume();
      }
    });

    // Track first audio played
    firstAudioSub = addRealtimeListener("onStreamFirstAudio", () => {
      emitTimings({ firstAudioPlayedAt: now() });
    });
  }

  return {
    setListener(fn: InterpreterListener | null) {
      listener = fn;
    },

    setConfig(partial: Partial<InterpreterConfig>) {
      config = { ...config, ...partial };
    },

    getConfig(): InterpreterConfig {
      return { ...config };
    },

    getSnapshot(): InterpreterSnapshot {
      return { ...snapshot };
    },

    async connect() {
      if (snapshot.state !== "DESCONECTADO" && snapshot.state !== "ERRO") return;
      userDisconnected = false;
      reconnectAttempt = 0;
      emit({ ...INITIAL_STATE, state: "CONECTANDO", attempts: 0 });
      try {
        await doConnect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Falha ao conectar";
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Network request failed")) {
          emit({ state: "ERRO", error: "Servidor local não respondeu" });
        } else {
          emit({ state: "ERRO", error: msg });
        }
      }
    },

    async disconnect() {
      userDisconnected = true;
      clearResumeTimer();
      micChunkSub?.remove();
      micChunkSub = null;
      playbackStopSub?.remove();
      playbackStopSub = null;
      firstAudioSub?.remove();
      firstAudioSub = null;
      session?.close();
      session = null;
      await stopStreamCapture().catch(() => {});
      await stopStreamPlayback().catch(() => {});
      emit({ ...INITIAL_STATE });
    },
  };
}
