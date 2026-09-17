import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
} from "@/src/audio/mediaTts";
import { makeStyles, useTheme } from "@/src/theme";

type LogItem = { id: string; time: string; text: string; tone?: "accent" | "good" | "warn" };
type Screen = "test" | "diagnostics";

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