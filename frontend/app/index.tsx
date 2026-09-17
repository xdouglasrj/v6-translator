import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getAudioSnapshot,
  isNativeMediaTtsAvailable,
  prepareMediaTts,
  speakAsMedia,
  stopMediaTts,
  TEST_PHRASE,
  type AudioSnapshot,
  startMicRecording,
  stopMicRecording,
  startMicPlayback,
  stopMicPlayback,
  addMicListener,
  type RecordingStartResult,
  type RecordingStopEvent,
  type RouteChangeEvent,
  playAudioFile,
  saveBase64Audio,
} from "@/src/audio/mediaTts";
import {
  getApiKey,
  setApiKey,
  removeApiKey,
  maskKey,
  transcribe,
  interpret,
  generateSpeech,
  type PipelinePhase,
  type PipelineState,
  initialPipelineState,
  startCapture,
  stopCapture,
} from "@/src/openai";
import {
  createInterpreter,
  DEFAULT_CONFIG,
  type InterpreterSnapshot,
  type CredentialOrigin,
} from "@/src/realtime";
import { storage } from "@/src/utils/storage";
import { makeStyles, useTheme } from "@/src/theme";

type LogItem = { id: string; time: string; text: string; tone?: "accent" | "good" | "warn" };
type Screen = "test" | "diagnostics";

const F4_STORAGE_KEY = "fase4_config";

const initialSnapshot: AudioSnapshot = {
  available: false,
  bluetoothConnected: false,
  deviceName: "Verificando rota...",
  routeType: "Verificando",
  audioMode: "Verificando",
  scoActive: false,
  mediaActive: false,
};

export default function Index() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const [screen, setScreen] = useState<Screen>("test");
  const [snapshot, setSnapshot] = useState<AudioSnapshot>(initialSnapshot);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);

  const [micRecording, setMicRecording] = useState<"idle" | "recording" | "recorded">("idle");
  const [micPlaying, setMicPlaying] = useState(false);
  const [micCountdown, setMicCountdown] = useState(0);
  const [micRecordingInfo, setMicRecordingInfo] = useState<RecordingStartResult | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const [pipeline, setPipeline] = useState<PipelineState>(initialPipelineState);
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState<string>("");
  const [keyInput, setKeyInput] = useState("");
  const [keySaving, setKeySaving] = useState(false);
  const pipelineAbort = useRef(false);

  const [f4ServerUrl, setF4ServerUrl] = useState(DEFAULT_CONFIG.serverUrl);
  const [f4MyName, setF4MyName] = useState(DEFAULT_CONFIG.myName);
  const [f4MyLanguage, setF4MyLanguage] = useState(DEFAULT_CONFIG.myLanguage);
  const [f4TouristName, setF4TouristName] = useState(DEFAULT_CONFIG.touristName);
  const [f4TouristLanguage, setF4TouristLanguage] = useState(DEFAULT_CONFIG.touristLanguage);
  const [f4CredentialOrigin, setF4CredentialOrigin] = useState<CredentialOrigin>(DEFAULT_CONFIG.credentialOrigin);
  const [f4Snapshot, setF4Snapshot] = useState<InterpreterSnapshot>({
    state: "DESCONECTADO",
    lastSpeech: "",
    lastInterpretation: "",
    timings: {
      speechStartedAt: null,
      speechEndedAt: null,
      responseCreatedAt: null,
      firstAudioReceivedAt: null,
      firstAudioPlayedAt: null,
      responseDoneAt: null,
    },
    latencyMs: null,
    error: null,
    attempts: 0,
  });
  const interpreterRef = useRef<ReturnType<typeof createInterpreter> | null>(null);

  const addLog = useCallback((text: string, tone?: LogItem["tone"]) => {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((current) => [{ id: `${Date.now()}-${text}`, time, text, tone }, ...current].slice(0, 20));
  }, []);

  const refreshAudio = useCallback(async (withLog = false) => {
    const next = await getAudioSnapshot();
    setSnapshot(next);
    if (withLog) {
      addLog(next.bluetoothConnected ? "Bluetooth detectado" : "Nenhuma rota Bluetooth ativa", next.bluetoothConnected ? "good" : "warn");
      addLog(`Rota: ${next.deviceName} · ${next.routeType}`);
    }
    setLoading(false);
  }, [addLog]);

  useEffect(() => {
    let mounted = true;
    const requestBluetoothPermission = async () => {
      if (Platform.OS === "android" && Number(Platform.Version) >= 31) {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, {
          title: "Acesso ao Bluetooth",
          message: "Necessário para mostrar a rota de áudio ativa do V6 Plus.",
          buttonPositive: "Permitir",
          buttonNegative: "Agora não",
        });
      }
      if (mounted) await refreshAudio(true);
    };
    void requestBluetoothPermission();
    const interval = setInterval(() => void refreshAudio(), 2500);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [refreshAudio]);

  useEffect(() => {
    void getApiKey().then((key) => {
      if (key) {
        setApiKeyState(key);
        setApiKeyMasked(maskKey(key));
      }
    });
  }, []);

  useEffect(() => {
    void storage.getItem(F4_STORAGE_KEY, "").then((raw) => {
      if (raw && typeof raw === "string") {
        try {
          const cfg = JSON.parse(raw) as Partial<typeof DEFAULT_CONFIG>;
          if (cfg.serverUrl) setF4ServerUrl(cfg.serverUrl);
          if (cfg.myName) setF4MyName(cfg.myName);
          if (cfg.myLanguage) setF4MyLanguage(cfg.myLanguage);
          if (cfg.touristName) setF4TouristName(cfg.touristName);
          if (cfg.touristLanguage) setF4TouristLanguage(cfg.touristLanguage);
          if (cfg.credentialOrigin) setF4CredentialOrigin(cfg.credentialOrigin);
        } catch { /* ignore */ }
      }
    });
  }, []);

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    if (!trimmed) return;
    setKeySaving(true);
    await setApiKey(trimmed);
    setApiKeyState(trimmed);
    setApiKeyMasked(maskKey(trimmed));
    setKeyInput("");
    setKeySaving(false);
    addLog("Chave da OpenAI salva", "good");
  };

  const handleRemoveKey = async () => {
    await removeApiKey();
    setApiKeyState(null);
    setApiKeyMasked("");
    addLog("Chave da OpenAI removida", "warn");
  };

  const handlePlay = async () => {
    if (playing || preparing) return;
    setPreparing(true);
    addLog("Preparando TTS como mídia...");
    try {
      const mediaContract = await prepareMediaTts();
      addLog(`AudioAttributes: ${String(mediaContract.usage ?? "USAGE_MEDIA")}`, "accent");
      addLog(`Stream: ${String(mediaContract.stream ?? "STREAM_MUSIC")}`, "accent");
      addLog("Modo de comunicação não solicitado", "good");
      setPlaying(true);
      addLog("Reprodução iniciada", "good");
      speakAsMedia(
        () => {
          setPlaying(false);
          addLog("Reprodução encerrada", "good");
          void refreshAudio();
        },
        (error) => {
          setPlaying(false);
          addLog(`Falha no TTS: ${error.message}`, "warn");
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "não foi possível preparar o mecanismo de voz";
      addLog(`TTS indisponível: ${message}`, "warn");
    } finally {
      setPreparing(false);
    }
  };

  const handleStop = async () => {
    await stopMediaTts();
    setPlaying(false);
    addLog("Reprodução interrompida pelo usuário", "warn");
  };

  const handleRepeat = async () => {
    if (playing) await handleStop();
    setTimeout(() => void handlePlay(), 120);
  };

  useEffect(() => {
    const subs = [
      addMicListener("onRecordingStop", (...args: unknown[]) => {
        const evt = args[0] as RecordingStopEvent;
        setMicRecording("recorded");
        setMicCountdown(0);
        addLog(`Gravação encerrada · ${(evt.bytes / 1024).toFixed(1)} KB · ${evt.durationMs}ms`, "good");
        addLog(`Modo: ${evt.mode}`);
        void refreshAudio();
      }),
      addMicListener("onPlaybackStart", (...args: unknown[]) => {
        setMicPlaying(true);
        addLog("Reprodução da gravação iniciada", "good");
      }),
      addMicListener("onPlaybackStop", (...args: unknown[]) => {
        setMicPlaying(false);
        addLog("Reprodução da gravação encerrada", "good");
        void refreshAudio();
      }),
      addMicListener("onRouteChange", (...args: unknown[]) => {
        const evt = args[0] as RouteChangeEvent;
        addLog(`TROCA DE ROTA · ${evt.before} → ${evt.after}`, "warn");
      }),
    ];
    return () => { subs.forEach((s) => s.remove()); };
  }, [addMicListener, addLog, refreshAudio]);

  const handleMicRecord = async () => {
    if (micRecording === "recording") return;
    if (micPlaying) {
      await stopMicPlayback().catch(() => {});
      setMicPlaying(false);
    }
    if (Platform.OS === "android" && isNativeMediaTtsAvailable) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Permissão de microfone",
          message: "O aplicativo usa o microfone para gravar um teste de 5 segundos. A gravação fica só no celular e é substituída na próxima.",
          buttonPositive: "Permitir",
          buttonNegative: "Agora não",
        },
      );
      if (result === PermissionsAndroid.RESULTS.DENIED || result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        setMicPermissionDenied(true);
        addLog("Permissão de microfone negada", "warn");
        return;
      }
    }
    setMicPermissionDenied(false);
    addLog("Preparando gravação...");
    try {
      const info = await startMicRecording();
      setMicRecordingInfo(info);
      setMicRecording("recording");
      setMicCountdown(5);
      addLog("Gravando 5 segundos...", "accent");
      addLog(`Modo: ${info.mode}`);
      addLog(`Entradas: ${info.inputs.length} · Saídas: ${info.outputs.length}`);
      addLog(`Microfone interno: ${info.builtInMicFound ? "detectado" : "não identificado"}`, info.builtInMicFound ? "good" : "warn");
      if (info.routedInput !== "indisponível") {
        addLog(`Entrada real: ${info.routedInput}`, "accent");
      }
      const interval = setInterval(() => {
        setMicCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "falha ao gravar";
      addLog(`Falha na gravação: ${msg}`, "warn");
    }
  };

  const handleMicStopRecording = async () => {
    if (micRecording !== "recording") return;
    try {
      await stopMicRecording();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "falha ao parar";
      addLog(`Falha ao parar gravação: ${msg}`, "warn");
      setMicRecording("idle");
      setMicCountdown(0);
    }
  };

  const handleMicPlay = async () => {
    if (micPlaying || micRecording === "recording") return;
    addLog("Preparando reprodução da gravação...");
    try {
      const info = await startMicPlayback();
      addLog(`Modo: ${info.mode} · Foco: ${info.focus}`, info.focus === "concedido" ? "good" : "warn");
      addLog(`Uso: ${info.usage} · Tipo: ${info.contentType}`, "accent");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "falha ao reproduzir";
      addLog(`Falha na reprodução: ${msg}`, "warn");
    }
  };

  const handleMicStop = async () => {
    if (!micPlaying) return;
    await stopMicPlayback().catch(() => {});
    setMicPlaying(false);
    addLog("Reprodução da gravação interrompida", "warn");
  };

  const handleSaveF4Config = async () => {
    const cfg = { serverUrl: f4ServerUrl, myName: f4MyName, myLanguage: f4MyLanguage, touristName: f4TouristName, touristLanguage: f4TouristLanguage, credentialOrigin: f4CredentialOrigin };
    await storage.setItem(F4_STORAGE_KEY, JSON.stringify(cfg));
    interpreterRef.current?.setConfig(cfg);
    addLog("Configuração do intérprete salva", "good");
  };

  const handleF4Connect = async () => {
    await handleSaveF4Config();
    const interp = createInterpreter();
    interpreterRef.current = interp;
    interp.setConfig({ serverUrl: f4ServerUrl, myName: f4MyName, myLanguage: f4MyLanguage, touristName: f4TouristName, touristLanguage: f4TouristLanguage, credentialOrigin: f4CredentialOrigin });
    interp.setListener((snap) => {
      setF4Snapshot(snap);
      if (snap.state === "ERRO" && snap.error) {
        addLog(`Intérprete: ${snap.error}`, "warn");
      }
      if (snap.state === "OUVINDO") {
        addLog("Intérprete ouvindo...", "good");
      }
      if (snap.state === "IA_FALANDO") {
        addLog("IA interpretando...", "accent");
      }
      if (snap.timings.responseDoneAt && snap.timings.speechEndedAt && snap.timings.firstAudioPlayedAt) {
        const ms = snap.timings.firstAudioPlayedAt - snap.timings.speechEndedAt;
        addLog(`Fala encerrada → primeiro áudio tocado: ${ms}ms`, "accent");
      }
    });
    await interp.connect();
  };

  const handleF4Disconnect = async () => {
    await interpreterRef.current?.disconnect();
    interpreterRef.current = null;
    addLog("Intérprete encerrado", "warn");
  };

  const canPtt = apiKey && pipeline.phase === "PRONTO" && isNativeMediaTtsAvailable;

  const handlePttPressIn = async () => {
    if (!canPtt) return;
    if (micPlaying) {
      await stopMicPlayback().catch(() => {});
      setMicPlaying(false);
    }
    if (Platform.OS === "android" && isNativeMediaTtsAvailable) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Permissão de microfone",
          message: "O aplicativo usa o microfone para gravar e interpretar sua fala.",
          buttonPositive: "Permitir",
          buttonNegative: "Agora não",
        },
      );
      if (result === PermissionsAndroid.RESULTS.DENIED || result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        setMicPermissionDenied(true);
        addLog("Permissão de microfone negada", "warn");
        return;
      }
    }
    setMicPermissionDenied(false);
    pipelineAbort.current = false;
    setPipeline({ ...initialPipelineState, phase: "OUVINDO" });
    addLog("Segurando... falhe agora", "accent");
    try {
      await startCapture();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "falha ao gravar";
      addLog(`Falha na gravação: ${msg}`, "warn");
      setPipeline({ ...initialPipelineState, error: msg });
    }
  };

  const handlePttPressOut = async () => {
    if (pipeline.phase !== "OUVINDO") return;
    addLog("Soltou — processando...", "accent");
    setPipeline((prev) => ({ ...prev, phase: "PROCESSANDO" }));
    try {
      const capture = await stopCapture();
      if (capture.durationMs < 1000) {
        addLog("Gravação muito curta — descartada", "warn");
        setPipeline({ ...initialPipelineState });
        return;
      }
      if (pipelineAbort.current) {
        setPipeline({ ...initialPipelineState });
        return;
      }

      const key = apiKey!;
      const t0 = Date.now();

      setPipeline((prev) => ({ ...prev, phase: "TRANSCREVENDO" }));
      addLog("Transcrevendo...", "accent");
      const t1 = Date.now();
      const transcribed = await transcribe(key, `file://${capture.path}`, "fala.m4a");
      const transcriptionMs = Date.now() - t1;
      addLog(`Transcrição: ${transcriptionMs}ms`, "accent");

      if (!transcribed.text || !transcribed.text.trim()) {
        addLog("Não foi possível entender.", "warn");
        setPipeline({ ...initialPipelineState });
        return;
      }
      if (transcribed.languages && transcribed.languages.length > 0 && transcribed.languages[0].code) {
        addLog(`Idioma detectado: ${transcribed.languages[0].code}`, "accent");
      }
      const lang = transcribed.languages?.[0]?.code || "";
      addLog(`OUVIDO: ${transcribed.text}`, "accent");

      if (!lang) {
        addLog("Não foi possível entender.", "warn");
        setPipeline({ ...initialPipelineState });
        return;
      }

      if (pipelineAbort.current) {
        setPipeline({ ...initialPipelineState });
        return;
      }

      setPipeline((prev) => ({ ...prev, phase: "INTERPRETANDO", heard: transcribed.text, detectedLanguage: lang }));
      addLog("Interpretando...", "accent");
      const t2 = Date.now();
      const interpreted = await interpret(key, transcribed.text);
      const interpretationMs = Date.now() - t2;
      addLog(`Interpretação: ${interpretationMs}ms`, "accent");

      if (!interpreted.text || !interpreted.text.trim()) {
        addLog("Não foi possível entender.", "warn");
        setPipeline({ ...initialPipelineState });
        return;
      }
      addLog(`INTERPRETAÇÃO: ${interpreted.text}`, "accent");

      if (pipelineAbort.current) {
        setPipeline({ ...initialPipelineState });
        return;
      }

      setPipeline((prev) => ({ ...prev, phase: "GERANDO_VOZ", interpretation: interpreted.text }));
      addLog("Gerando voz...", "accent");
      const t3 = Date.now();
      const speech = await generateSpeech(key, interpreted.text);
      const speechMs = Date.now() - t3;
      addLog(`Voz: ${speechMs}ms`, "accent");

      if (pipelineAbort.current) {
        setPipeline({ ...initialPipelineState });
        return;
      }

      const fileName = `fase3-voz-${Date.now()}.mp3`;
      const audioPath = await saveBase64Audio(speech.audioBase64, fileName);
      addLog(`Salvo: ${audioPath}`, "accent");

      setPipeline((prev) => ({ ...prev, phase: "REPRODUZINDO" }));
      addLog("Reproduzindo...", "accent");
      await playAudioFile(audioPath);

      const totalMs = Date.now() - t0;
      addLog(`Total: ${totalMs}ms`, "good");
      addLog(`Tempos — transcrição: ${transcriptionMs}ms · IA: ${interpretationMs}ms · voz: ${speechMs}ms · total: ${totalMs}ms`, "accent");
      setPipeline({ ...initialPipelineState });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "erro desconhecido";
      if (msg.includes("CHAVE_RECUSADA")) {
        addLog("Chave recusada pela OpenAI", "warn");
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Network request failed")) {
        addLog("Sem conexão com a internet.", "warn");
      } else {
        addLog(`Erro: ${msg}`, "warn");
      }
      setPipeline({ ...initialPipelineState, error: msg });
    }
  };

  const nativeLabel = Platform.OS === "android"
    ? (isNativeMediaTtsAvailable ? "MÓDULO MEDIA ATIVO" : "MÓDULO NATIVO NECESSÁRIO")
    : "PRÉVIA · MEDIA NO APK";

  return (
    <View style={styles.root} testID="v6-app">
      <StatusBar style="light" />
      <View style={[styles.content, { paddingTop: insets.top + 16 }]}>
        <Header nativeLabel={nativeLabel} />
        <View style={styles.statusRow}>
          <StatusCard
            icon="bluetooth"
            label="BLUETOOTH"
            value={snapshot.bluetoothConnected ? "Conectado" : "Não conectado"}
            detail={snapshot.deviceName}
            active={snapshot.bluetoothConnected}
            styles={styles}
          />
          <StatusCard
            icon="volume-high"
            label="SAÍDA"
            value={snapshot.routeType}
            detail={snapshot.deviceName}
            active={snapshot.routeType === "Bluetooth"}
            styles={styles}
          />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {screen === "test" ? (
            <TestScreen
              snapshot={snapshot}
              loading={loading}
              playing={playing}
              preparing={preparing}
              onPlay={handlePlay}
              onStop={handleStop}
              onRepeat={handleRepeat}
              logs={logs}
              styles={styles}
              micRecording={micRecording}
              micPlaying={micPlaying}
              micCountdown={micCountdown}
              micRecordingInfo={micRecordingInfo}
              micPermissionDenied={micPermissionDenied}
              onMicRecord={handleMicRecord}
              onMicStopRecording={handleMicStopRecording}
              onMicPlay={handleMicPlay}
              onMicStop={handleMicStop}
              pipeline={pipeline.phase}
              apiKey={apiKey}
              apiKeyMasked={apiKeyMasked}
              keyInput={keyInput}
              keySaving={keySaving}
              onKeyInputChange={setKeyInput}
              onKeySave={handleSaveKey}
              onKeyRemove={handleRemoveKey}
              onPttPressIn={handlePttPressIn}
              onPttPressOut={handlePttPressOut}
              canPtt={!!canPtt}
              f4ServerUrl={f4ServerUrl}
              f4MyName={f4MyName}
              f4MyLanguage={f4MyLanguage}
              f4TouristName={f4TouristName}
              f4TouristLanguage={f4TouristLanguage}
              f4Snapshot={f4Snapshot}
              f4CredentialOrigin={f4CredentialOrigin}
              onF4ServerUrlChange={setF4ServerUrl}
              onF4MyNameChange={setF4MyName}
              onF4MyLanguageChange={setF4MyLanguage}
              onF4TouristNameChange={setF4TouristName}
              onF4TouristLanguageChange={setF4TouristLanguage}
              onF4CredentialOriginChange={setF4CredentialOrigin}
              onF4Connect={handleF4Connect}
              onF4Disconnect={handleF4Disconnect}
            />
          ) : (
            <DiagnosticsScreen
              snapshot={snapshot}
              logs={logs}
              onClear={() => setLogs([])}
              onTest={() => void handlePlay()}
              styles={styles}
            />
          )}
        </ScrollView>
      </View>
      <BottomNav screen={screen} onChange={setScreen} styles={styles} />
    </View>
  );
}

function Header({ nativeLabel }: { nativeLabel: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.brandMark}>
        <MaterialCommunityIcons name="motorbike" size={22} color={colors.onBrandPrimary} />
      </View>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>V6 INTERCOM AUDIO TESTER</Text>
        <Text style={styles.headerTitle}>Teste V6</Text>
      </View>
      <View style={styles.mediaBadge}>
        <View style={styles.mediaDot} />
        <Text style={styles.mediaBadgeText}>{nativeLabel}</Text>
      </View>
    </View>
  );
}

function StatusCard({
  icon,
  label,
  value,
  detail,
  active,
  styles,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
  detail: string;
  active: boolean;
  styles: ReturnType<typeof useStyles>;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.statusCard}>
      <View style={[styles.statusIcon, active && styles.statusIconActive]}>
        <MaterialCommunityIcons name={icon} size={18} color={active ? colors.brandPrimary : colors.muted} />
      </View>
      <Text style={styles.cardLabel}>{label}</Text>
      <View style={styles.statusValueRow}>
        <View style={[styles.statusIndicator, { backgroundColor: active ? colors.success : colors.muted }]} />
        <Text style={styles.statusValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.statusDetail} numberOfLines={1}>{detail}</Text>
    </View>
  );
}

function TestScreen({
  snapshot,
  loading,
  playing,
  preparing,
  onPlay,
  onStop,
  onRepeat,
  logs,
  styles,
  micRecording,
  micPlaying,
  micCountdown,
  micRecordingInfo,
  micPermissionDenied,
  onMicRecord,
  onMicStopRecording,
  onMicPlay,
  onMicStop,
  pipeline,
  apiKey,
  apiKeyMasked,
  keyInput,
  keySaving,
  onKeyInputChange,
  onKeySave,
  onKeyRemove,
  onPttPressIn,
  onPttPressOut,
  canPtt,
  f4ServerUrl,
  f4MyName,
  f4MyLanguage,
  f4TouristName,
  f4TouristLanguage,
  f4Snapshot,
  f4CredentialOrigin,
  onF4ServerUrlChange,
  onF4MyNameChange,
  onF4MyLanguageChange,
  onF4TouristNameChange,
  onF4TouristLanguageChange,
  onF4CredentialOriginChange,
  onF4Connect,
  onF4Disconnect,
}: {
  snapshot: AudioSnapshot;
  loading: boolean;
  playing: boolean;
  preparing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRepeat: () => void;
  logs: LogItem[];
  styles: ReturnType<typeof useStyles>;
  micRecording: "idle" | "recording" | "recorded";
  micPlaying: boolean;
  micCountdown: number;
  micRecordingInfo: RecordingStartResult | null;
  micPermissionDenied: boolean;
  onMicRecord: () => void;
  onMicStopRecording: () => void;
  onMicPlay: () => void;
  onMicStop: () => void;
  pipeline: PipelinePhase;
  apiKey: string | null;
  apiKeyMasked: string;
  keyInput: string;
  keySaving: boolean;
  onKeyInputChange: (text: string) => void;
  onKeySave: () => void;
  onKeyRemove: () => void;
  onPttPressIn: () => void;
  onPttPressOut: () => void;
  canPtt: boolean;
  f4ServerUrl: string;
  f4MyName: string;
  f4MyLanguage: string;
  f4TouristName: string;
  f4TouristLanguage: string;
  f4Snapshot: InterpreterSnapshot;
  f4CredentialOrigin: CredentialOrigin;
  onF4ServerUrlChange: (v: string) => void;
  onF4MyNameChange: (v: string) => void;
  onF4MyLanguageChange: (v: string) => void;
  onF4TouristNameChange: (v: string) => void;
  onF4TouristLanguageChange: (v: string) => void;
  onF4CredentialOriginChange: (v: CredentialOrigin) => void;
  onF4Connect: () => void;
  onF4Disconnect: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View testID="v6-test-screen">
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>V6 AUDIO TEST</Text>
        <Text style={styles.sectionSubtitle}>Valide primeiro o compartilhamento de mídia.</Text>
      </View>
      <View style={styles.routeBanner}>
        <MaterialCommunityIcons name={snapshot.bluetoothConnected ? "check-circle" : "information-outline"} size={20} color={snapshot.bluetoothConnected ? colors.success : colors.warning} />
        <View style={styles.routeCopy}>
          <Text style={styles.routeTitle}>{snapshot.bluetoothConnected ? "Rota Bluetooth detectada" : "Rota Bluetooth não detectada"}</Text>
          <Text style={styles.routeDescription}>{snapshot.bluetoothConnected ? "O áudio de mídia será enviado para a rota ativa." : "Conecte e ative o compartilhamento de música no V6 Plus."}</Text>
        </View>
      </View>
      <View style={styles.phraseCard}>
        <View style={styles.phraseHeader}>
          <MaterialCommunityIcons name="text-box-outline" size={18} color={colors.brandPrimary} />
          <Text style={styles.cardLabel}>MENSAGEM DE TESTE</Text>
        </View>
        <Text style={styles.phrase}>{TEST_PHRASE}</Text>
        <View style={styles.mediaRule}>
          <MaterialCommunityIcons name="music-note" size={16} color={colors.brandPrimary} />
          <Text style={styles.mediaRuleText}>USAGE_MEDIA · STREAM_MUSIC · fala</Text>
        </View>
      </View>
      <View style={styles.actionStack}>
        <Pressable
          testID="play-test-button"
          accessibilityRole="button"
          accessibilityLabel="Reproduzir teste"
          onPress={onPlay}
          disabled={playing || preparing}
          style={({ pressed }) => [styles.primaryButton, (pressed || playing || preparing) && styles.buttonPressed]}
        >
          {preparing ? <ActivityIndicator color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="play" size={24} color={colors.onBrandPrimary} />}
          <Text style={styles.primaryButtonText}>{playing ? "REPRODUZINDO" : "REPRODUZIR TESTE"}</Text>
        </Pressable>
        <View style={styles.secondaryActions}>
          <ActionButton icon="stop" label="PARAR" onPress={onStop} disabled={!playing} testID="stop-test-button" styles={styles} />
          <ActionButton icon="repeat" label="REPETIR" onPress={onRepeat} disabled={preparing} testID="repeat-test-button" styles={styles} />
        </View>
      </View>
      <LogPreview logs={logs} styles={styles} />
      {loading ? <Text style={styles.loadingText}>Consultando AudioManager...</Text> : null}

      <View style={[styles.sectionHeading, { marginTop: 28 }]}>
        <Text style={styles.sectionTitle}>FASE 2 · TESTE DO MICROFONE</Text>
        <Text style={styles.sectionSubtitle}>Grave e reproduza para validar o microfone sem derrubar o Music Sharing.</Text>
      </View>

      {Platform.OS === "web" || !isNativeMediaTtsAvailable ? (
        <View style={styles.diagnosticCard}>
          <Text style={styles.metricValue}>Disponível só no APK Android</Text>
        </View>
      ) : (
        <>
          <View style={styles.diagnosticCard}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>MICROFONE</Text>
              <Text style={styles.metricValue}>Interno do celular</Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>GRAVAÇÃO</Text>
              <Text style={[styles.metricValue, micRecording === "recording" && { color: colors.warning }]}>
                {micRecording === "idle" ? "Nenhuma" : micRecording === "recording" ? `Gravando ${micCountdown}s…` : "Pronta"}
              </Text>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>SAÍDA</Text>
              <Text style={styles.metricValue}>{snapshot.routeType}</Text>
            </View>
            <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.metricLabel}>ROTA</Text>
              <Text style={styles.metricValue}>{snapshot.deviceName}</Text>
            </View>
          </View>

          {micPermissionDenied && (
            <Pressable
              accessibilityRole="button"
              onPress={() => Linking.openSettings()}
              style={({ pressed }) => [styles.outlineButton, pressed && styles.buttonPressed]}
            >
              <MaterialCommunityIcons name="cog" size={20} color={colors.warning} />
              <Text style={[styles.outlineButtonText, { color: colors.warning }]}>ABRIR CONFIGURAÇÕES</Text>
            </Pressable>
          )}

          <View style={styles.actionStack}>
            {micRecording === "recording" ? (
              <Pressable
                accessibilityRole="button"
                onPress={onMicStopRecording}
                style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.warning }, pressed && styles.buttonPressed]}
              >
                <MaterialCommunityIcons name="stop" size={24} color={colors.onSurface} />
                <Text style={[styles.primaryButtonText, { color: colors.onSurface }]}>PARAR GRAVAÇÃO</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={onMicRecord}
                disabled={micPlaying}
                style={({ pressed }) => [styles.primaryButton, (pressed || micPlaying) && styles.buttonPressed]}
              >
                <MaterialCommunityIcons name="microphone" size={24} color={colors.onBrandPrimary} />
                <Text style={styles.primaryButtonText}>{micRecording === "recorded" ? "GRAVAR NOVAMENTE" : "GRAVAR 5 SEGUNDOS"}</Text>
              </Pressable>
            )}
            <View style={styles.secondaryActions}>
              <ActionButton
                icon="play"
                label="REPRODUZIR GRAVAÇÃO"
                onPress={onMicPlay}
                disabled={micRecording !== "recorded" || micPlaying}
                testID="mic-play-button"
                styles={styles}
              />
              <ActionButton
                icon="stop"
                label="PARAR"
                onPress={onMicStop}
                disabled={!micPlaying}
                testID="mic-stop-button"
                styles={styles}
              />
            </View>
          </View>
        </>
      )}

      <View style={[styles.sectionHeading, { marginTop: 28 }]}>
        <Text style={styles.sectionTitle}>FASE 3 · INTÉRPRETE OPENAI</Text>
        <Text style={styles.sectionSubtitle}>Push To Talk: segure para falar, solte para interpretar.</Text>
      </View>

      {!apiKey ? (
        <View style={styles.diagnosticCard}>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>CHAVE OPENAI</Text>
            <Text style={[styles.metricValue, { color: colors.warning }]}>Necessária</Text>
          </View>
          <TextInput
            style={{ color: colors.onSurface, fontSize: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginTop: 8, backgroundColor: colors.surfaceTertiary }}
            placeholder="sk-..."
            placeholderTextColor={colors.muted}
            value={keyInput}
            onChangeText={onKeyInputChange}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onKeySave}
            disabled={keySaving || !keyInput.trim()}
            style={({ pressed }) => [styles.primaryButton, { marginTop: 10 }, (keySaving || !keyInput.trim()) && styles.disabledButton, pressed && styles.buttonPressed]}
          >
            {keySaving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="key-variant" size={20} color={colors.onBrandPrimary} />}
            <Text style={styles.primaryButtonText}>SALVAR CHAVE</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.diagnosticCard}>
          <View style={styles.metricRow}>
            <Text style={styles.metricLabel}>CHAVE</Text>
            <Text style={styles.metricValue}>{apiKeyMasked}</Text>
          </View>
          <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.metricLabel}>STATUS</Text>
            <Text style={[styles.metricValue, { color: colors.success }]}>Configurada</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onKeyRemove}
            style={({ pressed }) => [styles.outlineButton, { marginTop: 10 }, pressed && styles.buttonPressed]}
          >
            <MaterialCommunityIcons name="key-remove" size={18} color={colors.warning} />
            <Text style={[styles.outlineButtonText, { color: colors.warning }]}>APAGAR CHAVE</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.diagnosticCard}>
        <View style={styles.metricRow}>
          <Text style={styles.metricLabel}>PIPELINE</Text>
          <Text style={[styles.metricValue, pipeline !== "PRONTO" && { color: colors.brandPrimary }]}>
            {pipeline === "PRONTO" ? "Aguardando" : pipeline === "OUVINDO" ? "Ouvindo..." : pipeline === "PROCESSANDO" ? "Processando..." : pipeline === "TRANSCREVENDO" ? "Transcrevendo..." : pipeline === "INTERPRETANDO" ? "Interpretando..." : pipeline === "GERANDO_VOZ" ? "Gerando voz..." : pipeline === "REPRODUZINDO" ? "Reproduzindo..." : "Erro"}
          </Text>
        </View>
        <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.metricLabel}>MICROFONE</Text>
          <Text style={styles.metricValue}>Interno do celular</Text>
        </View>
      </View>

      {Platform.OS === "web" || !isNativeMediaTtsAvailable ? (
        <View style={styles.diagnosticCard}>
          <Text style={styles.metricValue}>Disponível só no APK Android</Text>
        </View>
      ) : (
        <View style={styles.actionStack}>
          <Pressable
            accessibilityRole="button"
            onPressIn={onPttPressIn}
            onPressOut={onPttPressOut}
            disabled={!canPtt}
            style={({ pressed }) => [
              styles.primaryButton,
              pipeline === "OUVINDO" && { backgroundColor: colors.warning },
              (!canPtt) && styles.disabledButton,
              pressed && styles.buttonPressed,
            ]}
          >
            {pipeline !== "PRONTO" ? (
              <ActivityIndicator color={colors.onBrandPrimary} />
            ) : (
              <MaterialCommunityIcons name="microphone" size={24} color={colors.onBrandPrimary} />
            )}
            <Text style={styles.primaryButtonText}>
              {pipeline === "PRONTO"
                ? "SEGURE PARA FALAR"
                : pipeline === "OUVINDO"
                  ? "GRAVANDO..."
                  : "PROCESSANDO..."}
            </Text>
          </Pressable>
        </View>
      )}

      <View style={[styles.sectionHeading, { marginTop: 28 }]}>
        <Text style={styles.sectionTitle}>FASE 4 · IA INTÉRPRETE</Text>
        <Text style={styles.sectionSubtitle}>Conversa presencial com interpretação em tempo real.</Text>
      </View>

      {Platform.OS === "web" || !isNativeMediaTtsAvailable ? (
        <View style={styles.diagnosticCard}>
          <Text style={styles.metricValue}>Disponível só no APK Android</Text>
        </View>
      ) : (
        <>
          <View style={styles.diagnosticCard}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>ORIGEM DA CHAVE</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onF4CredentialOriginChange("CELULAR")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    f4CredentialOrigin === "CELULAR" && { backgroundColor: colors.brandTertiary },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <MaterialCommunityIcons name="cellphone" size={16} color={f4CredentialOrigin === "CELULAR" ? colors.brandPrimary : colors.muted} />
                  <Text style={[styles.secondaryButtonText, f4CredentialOrigin === "CELULAR" && { color: colors.brandPrimary }]}>CELULAR</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onF4CredentialOriginChange("SERVIDOR")}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    f4CredentialOrigin === "SERVIDOR" && { backgroundColor: colors.brandTertiary },
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <MaterialCommunityIcons name="server" size={16} color={f4CredentialOrigin === "SERVIDOR" ? colors.brandPrimary : colors.muted} />
                  <Text style={[styles.secondaryButtonText, f4CredentialOrigin === "SERVIDOR" && { color: colors.brandPrimary }]}>SERVIDOR</Text>
                </Pressable>
              </View>
            </View>
            {f4CredentialOrigin === "CELULAR" && (
              <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
                <MaterialCommunityIcons name="shield-lock-outline" size={14} color={colors.muted} />
                <Text style={[styles.metricValue, { color: colors.muted, marginLeft: 6 }]}>A chave fica só neste celular, no cofre do Android.</Text>
              </View>
            )}
          </View>

          {f4CredentialOrigin === "CELULAR" && !apiKey && (
            <View style={[styles.routeBanner, { backgroundColor: colors.error + "15", borderColor: colors.error }]}>
              <MaterialCommunityIcons name="key-variant" size={20} color={colors.error} />
              <View style={styles.routeCopy}>
                <Text style={[styles.routeTitle, { color: colors.error }]}>Chave necessária</Text>
                <Text style={styles.routeDescription}>Salve a chave da OpenAI na área da Fase 3 para usar o intérprete.</Text>
              </View>
            </View>
          )}

          <View style={styles.diagnosticCard}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>SERVIDOR</Text>
              <TextInput
                style={{ color: colors.onSurface, fontSize: 13, flex: 1, textAlign: "right" }}
                value={f4ServerUrl}
                onChangeText={onF4ServerUrlChange}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>MEU NOME</Text>
              <TextInput
                style={{ color: colors.onSurface, fontSize: 13, flex: 1, textAlign: "right" }}
                value={f4MyName}
                onChangeText={onF4MyNameChange}
              />
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>MEU IDIOMA</Text>
              <TextInput
                style={{ color: colors.onSurface, fontSize: 13, flex: 1, textAlign: "right" }}
                value={f4MyLanguage}
                onChangeText={onF4MyLanguageChange}
              />
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>TURISTA</Text>
              <TextInput
                style={{ color: colors.onSurface, fontSize: 13, flex: 1, textAlign: "right" }}
                value={f4TouristName}
                onChangeText={onF4TouristNameChange}
              />
            </View>
            <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.metricLabel}>IDIOMA TURISTA</Text>
              <TextInput
                style={{ color: colors.onSurface, fontSize: 13, flex: 1, textAlign: "right" }}
                value={f4TouristLanguage}
                onChangeText={onF4TouristLanguageChange}
              />
            </View>
          </View>

          <View style={styles.diagnosticCard}>
            <View style={styles.metricRow}>
              <Text style={styles.metricLabel}>ESTADO</Text>
              <Text style={[styles.metricValue, f4Snapshot.state === "ERRO" ? { color: colors.error } : f4Snapshot.state === "DESCONECTADO" ? { color: colors.muted } : { color: colors.success }]}>
                {f4Snapshot.state === "DESCONECTADO" ? "DESCONECTADO" : f4Snapshot.state === "CONECTANDO" ? "CONECTANDO..." : f4Snapshot.state === "OUVINDO" ? "OUVINDO" : f4Snapshot.state === "PESSOA_FALANDO" ? "PESSOA FALANDO" : f4Snapshot.state === "INTERPRETANDO" ? "INTERPRETANDO..." : f4Snapshot.state === "IA_FALANDO" ? "IA FALANDO" : "ERRO"}
              </Text>
            </View>
            {f4Snapshot.error ? (
              <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.metricLabel}>ERRO</Text>
                <Text style={[styles.metricValue, { color: colors.error }]} numberOfLines={2}>{f4Snapshot.error}</Text>
              </View>
            ) : null}
          </View>

          {f4Snapshot.lastSpeech ? (
            <View style={styles.diagnosticCard}>
              <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.metricLabel}>ÚLTIMA FALA</Text>
                <Text style={styles.metricValue} numberOfLines={3}>{f4Snapshot.lastSpeech}</Text>
              </View>
            </View>
          ) : null}

          {f4Snapshot.lastInterpretation ? (
            <View style={styles.diagnosticCard}>
              <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.metricLabel}>INTERPRETAÇÃO</Text>
                <Text style={[styles.metricValue, { color: colors.brandPrimary }]} numberOfLines={3}>{f4Snapshot.lastInterpretation}</Text>
              </View>
            </View>
          ) : null}

          {f4Snapshot.latencyMs !== null ? (
            <View style={styles.diagnosticCard}>
              <View style={[styles.metricRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.metricLabel}>TEMPO ATÉ A VOZ</Text>
                <Text style={[styles.metricValue, { color: colors.brandPrimary }]}>{f4Snapshot.latencyMs}ms</Text>
              </View>
            </View>
          ) : null}

          <View style={styles.actionStack}>
            {f4Snapshot.state === "DESCONECTADO" || f4Snapshot.state === "ERRO" ? (
              <Pressable
                accessibilityRole="button"
                onPress={onF4Connect}
                disabled={f4CredentialOrigin === "CELULAR" && !apiKey}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (f4CredentialOrigin === "CELULAR" && !apiKey) && styles.disabledButton,
                  pressed && styles.buttonPressed,
                ]}
              >
                <MaterialCommunityIcons name="connection" size={24} color={colors.onBrandPrimary} />
                <Text style={styles.primaryButtonText}>CONECTAR INTÉRPRETE</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={onF4Disconnect}
                style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.error }, pressed && styles.buttonPressed]}
              >
                <MaterialCommunityIcons name="connection" size={24} color={colors.onError} />
                <Text style={[styles.primaryButtonText, { color: colors.onError }]}>ENCERRAR</Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

function ActionButton({ icon, label, onPress, disabled, testID, styles }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; onPress: () => void; disabled: boolean; testID: string; styles: ReturnType<typeof useStyles> }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabledButton, pressed && styles.buttonPressed]}>
      <MaterialCommunityIcons name={icon} size={20} color={disabled ? colors.muted : colors.onSurface} />
      <Text style={[styles.secondaryButtonText, disabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );
}

function DiagnosticsScreen({ snapshot, logs, onClear, onTest, styles }: { snapshot: AudioSnapshot; logs: LogItem[]; onClear: () => void; onTest: () => void; styles: ReturnType<typeof useStyles> }) {
  const { colors } = useTheme();
  const rows = useMemo(() => [
    ["Bluetooth", snapshot.bluetoothConnected ? "Conectado" : "Não conectado"],
    ["Dispositivo de saída", snapshot.deviceName],
    ["Tipo de saída", snapshot.routeType],
    ["Microfone", "Não solicitado nesta fase"],
    ["Audio Mode", snapshot.audioMode],
    ["Uso da reprodução", "USAGE_MEDIA"],
    ["Stream", "STREAM_MUSIC"],
    ["Bluetooth SCO", snapshot.scoActive ? "Ativo — investigar" : "Não solicitado"],
  ], [snapshot]);
  return (
    <View testID="audio-diagnostics-screen">
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>DIAGNÓSTICO DE ÁUDIO</Text>
        <Text style={styles.sectionSubtitle}>Leitura do estado atual do AudioManager.</Text>
      </View>
      <View style={styles.diagnosticCard}>
        {rows.map(([label, value]) => (
          <View style={styles.metricRow} key={label}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={[styles.metricValue, label === "Uso da reprodução" && { color: colors.brandPrimary }]} numberOfLines={2}>{value}</Text>
          </View>
        ))}
      </View>
      <Pressable testID="diagnostic-test-button" accessibilityRole="button" onPress={onTest} style={({ pressed }) => [styles.outlineButton, pressed && styles.buttonPressed]}>
        <MaterialCommunityIcons name="volume-high" size={20} color={colors.brandPrimary} />
        <Text style={styles.outlineButtonText}>TESTAR SOM</Text>
      </Pressable>
      <View style={styles.logHeader}>
        <View>
          <Text style={styles.sectionTitle}>LOG DE EVENTOS</Text>
          <Text style={styles.sectionSubtitle}>Últimos eventos da sessão.</Text>
        </View>
        <Pressable testID="clear-log-button" accessibilityRole="button" onPress={onClear} hitSlop={8}>
          <Text style={styles.clearText}>LIMPAR</Text>
        </Pressable>
      </View>
      <LogPreview logs={logs} styles={styles} expanded />
    </View>
  );
}

function LogPreview({ logs, styles, expanded = false }: { logs: LogItem[]; styles: ReturnType<typeof useStyles>; expanded?: boolean }) {
  const { colors } = useTheme();
  const visibleLogs = expanded ? logs : logs.slice(0, 4);
  return (
    <View style={styles.logSection}>
      {visibleLogs.length === 0 ? (
        <View style={styles.emptyLog}>
          <MaterialCommunityIcons name="text-box-outline" size={20} color={colors.muted} />
          <Text style={styles.emptyLogText}>Os eventos aparecerão aqui.</Text>
        </View>
      ) : visibleLogs.map((log) => (
        <View style={styles.logRow} key={log.id}>
          <Text style={styles.logTime}>{log.time}</Text>
          <View style={[styles.logDot, { backgroundColor: log.tone === "warn" ? colors.warning : log.tone === "good" ? colors.success : colors.brandPrimary }]} />
          <Text style={styles.logText}>{log.text}</Text>
        </View>
      ))}
    </View>
  );
}

function BottomNav({ screen, onChange, styles }: { screen: Screen; onChange: (screen: Screen) => void; styles: ReturnType<typeof useStyles> }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bottomNav}>
      <NavButton icon="volume-high" label="Teste V6" active={screen === "test"} onPress={() => onChange("test")} testID="test-tab" styles={styles} />
      <NavButton icon="chart-box-outline" label="Diagnóstico" active={screen === "diagnostics"} onPress={() => onChange("diagnostics")} testID="diagnostics-tab" styles={styles} />
      <View style={styles.navMediaState}>
        <View style={{ backgroundColor: colors.brandPrimary, width: 6, height: 6, borderRadius: 3 }} />
        <Text style={styles.navMediaText}>MEDIA</Text>
      </View>
    </View>
  );
}

function NavButton({ icon, label, active, onPress, testID, styles }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string; active: boolean; onPress: () => void; testID: string; styles: ReturnType<typeof useStyles> }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.navButton, active && styles.navButtonActive, pressed && styles.buttonPressed]}>
      <MaterialCommunityIcons name={icon} size={21} color={active ? colors.brandPrimary : colors.muted} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { flex: 1, paddingHorizontal: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 },
  brandMark: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.brandPrimary, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  headerTitle: { color: colors.onSurface, fontSize: 24, fontWeight: "800", marginTop: 2 },
  mediaBadge: { alignItems: "flex-end", gap: 4 },
  mediaDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  mediaBadgeText: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  statusRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  statusCard: { flex: 1, minHeight: 112, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 12 },
  statusIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginBottom: 9 },
  statusIconActive: { backgroundColor: colors.brandTertiary },
  cardLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.7 },
  statusValueRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  statusIndicator: { width: 7, height: 7, borderRadius: 4 },
  statusValue: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  statusDetail: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 4 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  sectionHeading: { marginBottom: 14 },
  sectionTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800", letterSpacing: 0.4 },
  sectionSubtitle: { color: colors.muted, fontSize: 13, marginTop: 5 },
  routeBanner: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, marginBottom: 12 },
  routeCopy: { flex: 1 },
  routeTitle: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  routeDescription: { color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  phraseCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 },
  phraseHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 13 },
  phrase: { color: colors.onSurfaceSecondary, fontSize: 16, lineHeight: 25, fontWeight: "600" },
  mediaRule: { flexDirection: "row", alignItems: "center", gap: 7, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 12, marginTop: 14 },
  mediaRuleText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  actionStack: { gap: 10, marginBottom: 22 },
  primaryButton: { minHeight: 60, borderRadius: 12, backgroundColor: colors.brandPrimary, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10 },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "900", letterSpacing: 0.7 },
  secondaryActions: { flexDirection: "row", gap: 10 },
  secondaryButton: { flex: 1, minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceTertiary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  secondaryButtonText: { color: colors.onSurface, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  disabledButton: { opacity: 0.45 },
  disabledText: { color: colors.muted },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  loadingText: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 6 },
  logSection: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 13, minHeight: 62 },
  logRow: { flexDirection: "row", alignItems: "center", minHeight: 28, gap: 8 },
  logTime: { color: colors.muted, fontSize: 10, fontVariant: ["tabular-nums"], width: 62 },
  logDot: { width: 5, height: 5, borderRadius: 3 },
  logText: { color: colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
  emptyLog: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  emptyLogText: { color: colors.muted, fontSize: 12 },
  diagnosticCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, marginBottom: 12 },
  metricRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 12 },
  metricLabel: { color: colors.muted, fontSize: 13, flex: 1 },
  metricValue: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", textAlign: "right", flex: 1 },
  outlineButton: { minHeight: 56, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 26 },
  outlineButtonText: { color: colors.brandPrimary, fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },
  logHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  clearText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "900", letterSpacing: 0.7, padding: 10 },
  bottomNav: { minHeight: 72, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 6 },
  navButton: { minHeight: 52, minWidth: 96, flex: 1, borderRadius: 10, alignItems: "center", justifyContent: "center", gap: 3 },
  navButtonActive: { backgroundColor: colors.brandTertiary },
  navLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  navLabelActive: { color: colors.brandPrimary },
  navMediaState: { width: 56, alignItems: "center", justifyContent: "center", gap: 4 },
  navMediaText: { color: colors.muted, fontSize: 9, fontWeight: "900", letterSpacing: 0.4 },
}));