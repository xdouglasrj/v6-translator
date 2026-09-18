import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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

import { isEscutaAudioAvailable } from "@/src/audio/escutaAudio";
import { storage } from "@/src/utils/storage";
import { makeStyles, useTheme } from "@/src/theme";
import {
  type EstadoConversa,
  type Fala,
  type IdiomaCodigo,
  type Metricas,
  type Papel,
} from "@/src/conversa/estado";
import { idiomas, obterIdioma } from "@/src/conversa/idiomas";
import {
  iniciar as iniciarMotor,
  parar as pararMotor,
  alterarSensibilidade,
  obterEstado,
} from "@/src/conversa/motor";
import { obterHost, obterSalaCodigo, idiomaDoOutro as salaIdiomaDoOutro } from "@/src/conversa/sala";

const CHAVE_PAPEL = "escutaai:papel";
const CHAVE_IDIOMA = "escutaai:idioma";
const CHAVE_SALA = "escutaai:sala";
const CHAVE_HOST = "escutaai:host";
const CHAVE_SENSIBILIDADE = "escutaai:sensibilidade";

type Tela = "escolha" | "idioma" | "conversa";

const SALA_DEFAULT = "escuta-ai";

export default function Index() {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const [tela, setTela] = useState<Tela>("escolha");
  const [papel, setPapel] = useState<Papel | null>(null);
  const [idiomaCodigo, setIdiomaCodigo] = useState<IdiomaCodigo>("pt-BR");
  const [estado, setEstado] = useState<EstadoConversa>("DESLIGADO");
  const [conectado, setConectado] = useState(false);
  const [outroConectado, setOutroConectado] = useState(false);
  const [outroIdioma, setOutroIdioma] = useState<IdiomaCodigo | null>(null);
  const [idiomaOutroSala, setIdiomaOutroSala] = useState<IdiomaCodigo | null>(null);
  const [falas, setFalas] = useState<Fala[]>([]);
  const [nivel, setNivel] = useState(0);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [salaCodigo, setSalaCodigo] = useState(SALA_DEFAULT);
  const [salaHost, setSalaHost] = useState("");
  const [sensibilidade, setSensibilidade] = useState(1500);
  const [mostrarPainel, setMostrarPainel] = useState(false);
  const [logs, setLogs] = useState<{ time: string; text: string }[]>([]);

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback((text: string) => {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [{ time, text }, ...prev].slice(0, 50));
  }, []);

useEffect(() => {
    void (async () => {
      const p = await storage.getItem(CHAVE_PAPEL, null as Papel | null);
      const i = await storage.getItem(CHAVE_IDIOMA, "pt-BR" as IdiomaCodigo);
      const s = await storage.getItem(CHAVE_SALA, SALA_DEFAULT);
      const h = await storage.getItem(CHAVE_HOST, "");
      const sens = await storage.getItem(CHAVE_SENSIBILIDADE, 1500);
      if (p) {
        setPapel(p);
        if (p === "piloto") {
          setIdiomaCodigo("pt-BR");
          await storage.setItem(CHAVE_IDIOMA, "pt-BR");
        } else if (i) {
          setIdiomaCodigo(i);
        }
        if (s) setSalaCodigo(s);
        if (h !== null) setSalaHost(h);
        if (sens !== null) setSensibilidade(sens);
        setTela(p === "turista" ? "idioma" : "conversa");
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      pararMotor();
    };
  }, []);

  const iniciarSessao = async (p: Papel, i: IdiomaCodigo) => {
    if (Platform.OS === "android" && isEscutaAudioAvailable) {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        {
          title: "Permissão de microfone",
          message: "O Escuta Aí usa o microfone para captar e traduzir sua voz.",
          buttonPositive: "Permitir",
          buttonNegative: "Agora não",
        },
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        setErro("Permissão de microfone negada");
        return;
      }
    }

    const host = salaHost || obterHost();
    const codigo = salaCodigo || SALA_DEFAULT;

    setEstado("CONECTANDO");
    setErro(null);

    iniciarMotor(p, i, codigo, {
      onEstadoChange: (e) => setEstado(e),
      onFalaAdicionada: (f) => {
        setFalas((prev) => [f, ...prev].slice(0, 6));
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      },
      onMetricas: (m) => setMetricas(m),
      onOutroConectado: (c) => setOutroConectado(c),
      onOutroIdioma: (id) => {
        setOutroIdioma(id);
        setIdiomaOutroSala(salaIdiomaDoOutro());
      },
      onNivel: (rms) => setNivel(rms),
      onErro: (msg) => {
        setErro(msg);
        addLog(`Erro: ${msg}`);
      },
      onLog: (msg) => addLog(msg),
      onConexao: () => setErro(null),
      onFalaEnviada: () => setErro(null),
    });

    setConectado(true);
  };

  const handleEscolherPapel = async (p: Papel) => {
    setPapel(p);
    await storage.setItem(CHAVE_PAPEL, p);
    if (p === "piloto") {
      setIdiomaCodigo("pt-BR");
      await storage.setItem(CHAVE_IDIOMA, "pt-BR");
      setTela("conversa");
      void iniciarSessao(p, "pt-BR");
    } else {
      setTela("idioma");
    }
  };

  const handleEscolherIdioma = async (i: IdiomaCodigo) => {
    setIdiomaCodigo(i);
    await storage.setItem(CHAVE_IDIOMA, i);
    setTela("conversa");
    void iniciarSessao("turista", i);
  };

  const handleEncerrar = () => {
    pararMotor();
    setConectado(false);
    setEstado("DESLIGADO");
    setFalas([]);
    setOutroConectado(false);
    setTela("escolha");
    setPapel(null);
  };

  const handleSalvarPainel = async () => {
    await storage.setItem(CHAVE_SALA, salaCodigo);
    await storage.setItem(CHAVE_HOST, salaHost);
    await storage.setItem(CHAVE_SENSIBILIDADE, sensibilidade);
    alterarSensibilidade(sensibilidade);
    setMostrarPainel(false);
  };

  const handleLongPressStart = () => {
    longPressTimer.current = setTimeout(() => {
      setMostrarPainel(true);
    }, 2000);
  };

  const handleLongPressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const idiomaInfo = obterIdioma(idiomaCodigo);
  const estadoLabel = papel === "turista" ? _estadoTurista(estado, idiomaInfo) : _estadoPiloto(estado);

  if (tela === "escolha") {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
          <MaterialCommunityIcons name="motorbike" size={64} color={colors.brandPrimary} />
          <Text style={styles.titulo}>Escuta Aí</Text>
          <Text style={styles.subtitulo}>Tradução em tempo real para motociclistas</Text>
          <View style={styles.escolhaContainer}>
            <Pressable
              style={({ pressed }) => [styles.escolhaBtn, pressed && styles.btnPressed]}
              onPress={() => void handleEscolherPapel("piloto")}
            >
              <MaterialCommunityIcons name="steering" size={36} color={colors.onBrandPrimary} />
              <Text style={styles.escolhaBtnTexto}>SOU O PILOTO</Text>
              <Text style={styles.escolhaBtnSub}>Português</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.escolhaBtn, styles.escolhaBtnSecundario, pressed && styles.btnPressed]}
              onPress={() => void handleEscolherPapel("turista")}
            >
              <MaterialCommunityIcons name="passport" size={36} color={colors.brandPrimary} />
              <Text style={[styles.escolhaBtnTexto, { color: colors.brandPrimary }]}>SOU O TURISTA</Text>
              <Text style={[styles.escolhaBtnSub, { color: colors.muted }]}>Escolha o idioma</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (tela === "idioma") {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
          <Text style={styles.titulo}>Idioma</Text>
          <Text style={styles.subtitulo}>Qual idioma você fala?</Text>
          <View style={styles.idiomaGrid}>
            {idiomas.filter((i) => i.codigo !== "pt-BR").map((i) => (
              <Pressable
                key={i.codigo}
                style={({ pressed }) => [styles.idiomaBtn, pressed && styles.btnPressed]}
                onPress={() => void handleEscolherIdioma(i.codigo)}
              >
                <Text style={styles.idiomaBandeira}>{i.bandeira}</Text>
                <Text style={styles.idiomaNome}>{i.nome}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            style={({ pressed }) => [styles.voltarBtn, pressed && styles.btnPressed]}
            onPress={() => setTela("escolha")}
          >
            <Text style={styles.voltarTexto}>VOLTAR</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={[styles.content, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onLongPress={handleLongPressStart}
          onPressOut={handleLongPressEnd}
          style={styles.header}
        >
          <MaterialCommunityIcons name="motorbike" size={22} color={colors.brandPrimary} />
          <Text style={styles.headerTitle}>Escuta Aí</Text>
          {papel === "piloto" && (
            <MaterialCommunityIcons name="cog" size={16} color={colors.muted} />
          )}
        </Pressable>

        <View style={styles.conexaoBanner}>
          {outroConectado ? (
            <Text style={[styles.conexaoTexto, { color: colors.success }]}>
              {papel === "piloto"
                ? `CONECTADO COM O PASSAGEIRO — ${idiomaOutroSala ? obterIdioma(idiomaOutroSala).nome : "idioma desconhecido"}`
                : `CONECTADO COM O PILOTO — ${idiomaOutroSala ? obterIdioma(idiomaOutroSala).nome : "português"}`}
            </Text>
          ) : (
            <Text style={[styles.conexaoTexto, { color: colors.warning }]}>
              {papel === "piloto" ? "DESCONECTADO — aguardando o passageiro" : "DESCONECTADO — aguardando o piloto"}
            </Text>
          )}
        </View>

        <View style={styles.estadoContainer}>
          <View style={[styles.estadoIndicator, { backgroundColor: _corEstado(estado, colors) }]} />
          <Text style={styles.estadoTexto}>{estadoLabel}</Text>
        </View>

        <View style={styles.nivelContainer}>
          <View style={[styles.nivelBarra, { width: `${Math.min(nivel * 300, 100)}%` }]} />
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 80 }]}
          showsVerticalScrollIndicator={false}
        >
          {erro && (
            <View style={styles.erroContainer}>
              <MaterialCommunityIcons name="alert" size={18} color={colors.error} />
              <Text style={styles.erroTexto}>{erro}</Text>
            </View>
          )}

          {falas.map((f, idx) => (
            <View key={`${f.em}-${idx}`} style={styles.falaCard}>
              {f.original ? (
                <Text style={styles.falaOriginal}>{f.original}</Text>
              ) : null}
              <Text style={styles.falaTraduzida}>{f.traduzido}</Text>
            </View>
          ))}

          {falas.length === 0 && estado === "OUVINDO" && (
            <View style={styles.silencioContainer}>
              <MaterialCommunityIcons name="volume-low" size={32} color={colors.muted} />
              <Text style={styles.silencioTexto}>Aguardando fala...</Text>
            </View>
          )}
        </ScrollView>

        <View style={[styles.rodape, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.rodapeInfo}>
            <View style={styles.rodapeItem}>
              <View style={[styles.dot, { backgroundColor: outroConectado ? colors.success : colors.error }]} />
              <Text style={styles.rodapeTexto}>
                {outroConectado ? "Conectado" : "Aguardando"}
              </Text>
            </View>
            {outroIdioma && (
              <Text style={styles.rodapeTexto}>
                {obterIdioma(outroIdioma).bandeira} {obterIdioma(outroIdioma).nome}
              </Text>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [styles.encerrarBtn, pressed && styles.btnPressed]}
            onPress={handleEncerrar}
          >
            <MaterialCommunityIcons name="phone-off" size={20} color={colors.onError} />
            <Text style={styles.encerrarTexto}>ENCERRAR</Text>
          </Pressable>
        </View>
      </View>

      {mostrarPainel && papel === "piloto" && (
        <PainelAjustes
          salaCodigo={salaCodigo}
          setSalaCodigo={setSalaCodigo}
          salaHost={salaHost}
          setSalaHost={setSalaHost}
          sensibilidade={sensibilidade}
          setSensibilidade={setSensibilidade}
          metricas={metricas}
          logs={logs}
          onSalvar={handleSalvarPainel}
          onFechar={() => setMostrarPainel(false)}
          insets={insets}
          styles={styles}
          colors={colors}
        />
      )}
    </View>
  );
}

function PainelAjustes({
  salaCodigo,
  setSalaCodigo,
  salaHost,
  setSalaHost,
  sensibilidade,
  setSensibilidade,
  metricas,
  logs,
  onSalvar,
  onFechar,
  insets,
  styles,
  colors,
}: {
  salaCodigo: string;
  setSalaCodigo: (v: string) => void;
  salaHost: string;
  setSalaHost: (v: string) => void;
  sensibilidade: number;
  setSensibilidade: (v: number) => void;
  metricas: Metricas | null;
  logs: { time: string; text: string }[];
  onSalvar: () => void;
  onFechar: () => void;
  insets: ReturnType<typeof useSafeAreaInsets>;
  styles: ReturnType<typeof useStyles>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <View style={[styles.painelOverlay, { paddingTop: insets.top + 16 }]}>
      <View style={styles.painel}>
        <View style={styles.painelHeader}>
          <Text style={styles.painelTitulo}>Ajustes</Text>
          <Pressable onPress={onFechar}>
            <MaterialCommunityIcons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.painelLabel}>Código da sala</Text>
          <TextInput
            style={styles.painelInput}
            value={salaCodigo}
            onChangeText={setSalaCodigo}
            placeholder="escuta-ai"
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.painelLabel}>Endereço da sala</Text>
          <TextInput
            style={styles.painelInput}
            value={salaHost}
            onChangeText={setSalaHost}
            placeholder={obterHost()}
            placeholderTextColor={colors.muted}
          />

          <Text style={styles.painelLabel}>Sensibilidade: {sensibilidade}</Text>
          <View style={styles.sliderContainer}>
            <Text style={styles.sliderMin}>500</Text>
            <TextInput
              style={styles.sliderInput}
              value={String(sensibilidade)}
              onChangeText={(t) => {
                const n = parseInt(t, 10);
                if (!isNaN(n)) setSensibilidade(Math.max(500, Math.min(4000, n)));
              }}
              keyboardType="numeric"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.sliderMin}>4000</Text>
          </View>

          {metricas && (
            <View style={styles.metricasContainer}>
              <Text style={styles.painelLabel}>Métricas da última fala</Text>
              <Text style={styles.metricaTexto}>Fala: {metricas.falaMs}ms</Text>
              <Text style={styles.metricaTexto}>POST: {metricas.postMs}ms</Text>
              <Text style={styles.metricaTexto}>Tradução: {metricas.traducaoMs}ms</Text>
            </View>
          )}

          <Text style={styles.painelLabel}>Log ({logs.length})</Text>
          <View style={styles.logContainer}>
            {logs.map((l, i) => (
              <Text key={`${l.time}-${i}`} style={styles.logTexto}>
                {l.time} {l.text}
              </Text>
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.salvarBtn, pressed && styles.btnPressed]}
            onPress={onSalvar}
          >
            <Text style={styles.salvarTexto}>SALVAR</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

function _estadoPiloto(estado: EstadoConversa): string {
  switch (estado) {
    case "DESLIGADO": return "DESLIGADO";
    case "CONECTANDO": return "CONECTANDO...";
    case "OUVINDO": return "OUVINDO";
    case "FALANDO": return "FALANDO";
    case "ENVIANDO": return "ENVIANDO...";
    case "TRADUZINDO": return "TRADUZINDO...";
    case "OUVINDO_TRADUCAO": return "FALANDO A TRADUÇÃO";
    case "ERRO": return "SEM SINAL";
    default: return estado;
  }
}

function _estadoTurista(estado: EstadoConversa, idioma: ReturnType<typeof obterIdioma>): string {
  switch (estado) {
    case "DESLIGADO": return "OFF";
    case "CONECTANDO": return "...";
    case "OUVINDO": return idioma.estadoOuvindo;
    case "FALANDO": return idioma.estadoFalando;
    case "ENVIANDO": return idioma.estadoTraduzindo;
    case "TRADUZINDO": return idioma.estadoTraduzindo;
    case "OUVINDO_TRADUCAO": return idioma.estadoFalando;
    case "ERRO": return "NO SIGNAL";
    default: return estado;
  }
}

function _corEstado(estado: EstadoConversa, colors: ReturnType<typeof useTheme>["colors"]): string {
  switch (estado) {
    case "OUVINDO": return colors.success;
    case "FALANDO": return colors.warning;
    case "ENVIANDO":
    case "TRADUZINDO": return colors.info;
    case "OUVINDO_TRADUCAO": return colors.brandPrimary;
    case "ERRO": return colors.error;
    default: return colors.muted;
  }
}

const useStyles = makeStyles((colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 24 },
  titulo: { color: colors.onSurface, fontSize: 36, fontWeight: "900", marginTop: 20, letterSpacing: 1 },
  subtitulo: { color: colors.muted, fontSize: 14, marginTop: 8, textAlign: "center" },
  escolhaContainer: { width: "100%", marginTop: 48, gap: 16 },
  escolhaBtn: {
    minHeight: 100, borderRadius: 16, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", gap: 8, padding: 20,
  },
  escolhaBtnSecundario: { backgroundColor: "transparent", borderWidth: 2, borderColor: colors.brandPrimary },
  escolhaBtnTexto: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: "900", letterSpacing: 1 },
  escolhaBtnSub: { color: colors.onBrandPrimary, fontSize: 12, opacity: 0.8 },
  idiomaGrid: { width: "100%", marginTop: 32, gap: 16 },
  idiomaBtn: {
    minHeight: 80, borderRadius: 16, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, flexDirection: "row",
    alignItems: "center", gap: 16, padding: 20,
  },
  idiomaBandeira: { fontSize: 36 },
  idiomaNome: { color: colors.onSurface, fontSize: 20, fontWeight: "700" },
  voltarBtn: {
    marginTop: 24, minHeight: 48, paddingHorizontal: 32, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  voltarTexto: { color: colors.muted, fontSize: 14, fontWeight: "800", letterSpacing: 1 },
  btnPressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },

  content: { flex: 1, paddingHorizontal: 16 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  headerTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", flex: 1 },
  estadoContainer: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  estadoIndicator: { width: 12, height: 12, borderRadius: 6 },
  estadoTexto: { color: colors.onSurface, fontSize: 22, fontWeight: "900", letterSpacing: 1 },
  conexaoBanner: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
  },
  conexaoTexto: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  nivelContainer: {
    height: 4, backgroundColor: colors.surfaceTertiary, borderRadius: 2,
    marginBottom: 12, overflow: "hidden",
  },
  nivelBarra: { height: "100%", backgroundColor: colors.brandPrimary, borderRadius: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  erroContainer: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.error,
    borderRadius: 10, padding: 12, marginBottom: 12,
  },
  erroTexto: { color: colors.onError, fontSize: 13, fontWeight: "700", flex: 1 },
  falaCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: 12, borderWidth: 1,
    borderColor: colors.border, padding: 14, marginBottom: 8,
  },
  falaOriginal: { color: colors.muted, fontSize: 12, marginBottom: 4, fontStyle: "italic" },
  falaTraduzida: { color: colors.onSurface, fontSize: 16, fontWeight: "600" },
  silencioContainer: {
    alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 12,
  },
  silencioTexto: { color: colors.muted, fontSize: 14 },
  rodape: {
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surfaceSecondary, paddingHorizontal: 16, paddingTop: 12,
  },
  rodapeInfo: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 12 },
  rodapeItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rodapeTexto: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  encerrarBtn: {
    minHeight: 56, borderRadius: 12, backgroundColor: colors.error,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  encerrarTexto: { color: colors.onError, fontSize: 16, fontWeight: "900", letterSpacing: 0.5 },

  painelOverlay: {
    ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.85)",
    zIndex: 100, paddingHorizontal: 16,
  },
  painel: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, padding: 20, marginTop: 8,
  },
  painelHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  painelTitulo: { color: colors.onSurface, fontSize: 20, fontWeight: "900" },
  painelLabel: { color: colors.muted, fontSize: 12, fontWeight: "800", marginBottom: 6, marginTop: 16 },
  painelInput: {
    backgroundColor: colors.surfaceTertiary, borderRadius: 10, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, fontSize: 14,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  sliderContainer: { flexDirection: "row", alignItems: "center", gap: 12 },
  sliderMin: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  sliderInput: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, color: colors.onSurface,
    fontSize: 14, paddingHorizontal: 14, paddingVertical: 10, textAlign: "center",
  },
  metricasContainer: { marginTop: 8 },
  metricaTexto: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  logContainer: {
    backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 10,
    maxHeight: 200, marginTop: 8,
  },
  logTexto: { color: colors.muted, fontSize: 11, marginBottom: 2 },
  salvarBtn: {
    marginTop: 20, minHeight: 48, borderRadius: 12, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  salvarTexto: { color: colors.onBrandPrimary, fontSize: 14, fontWeight: "900", letterSpacing: 1 },
}));
