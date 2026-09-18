import { type IdiomaCodigo, type Papel } from "./estado";

const SALA_HOST_PADRAO = "https://escuta-ai-sala.escuta-ai-sala.workers.dev";
const WS_BASE = "wss://escuta-ai-sala.escuta-ai-sala.workers.dev";
const FILA_MAX = 3;

export type MensagemSala =
  | { tipo: "entrar"; papel: Papel; idioma: IdiomaCodigo }
  | { tipo: "idioma"; idioma: IdiomaCodigo }
  | { tipo: "ping" };

export type MensagemRecebida =
  | { tipo: "presenca"; papel: Papel; idioma: IdiomaCodigo; conectado: boolean }
  | { tipo: "fala"; papel: Papel; idiomaOrigem: IdiomaCodigo; idiomaDestino: IdiomaCodigo; original: string; traduzido: string; em: number }
  | { tipo: "pong"; em: number }
  | { tipo: "erro"; motivo: string };

export type InterpretarResposta =
  | { original: string; traduzido: string; modelo: string; segundosAudio: number; custo: number; ms: { transcricao: number; traducao: number; total: number } }
  | { vazio: true };

export type SalaCallbacks = {
  onConexao?: () => void;
  onDesconexao?: (codigo: number, motivo: string) => void;
  onMensagem?: (msg: MensagemRecebida) => void;
  onErro?: (erro: string) => void;
};

let ws: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let fila: { base64: string; formato: string }[] = [];
let _callbacks: SalaCallbacks = {};
let _salaCodigo = "";
let _papel: Papel = "piloto";
let _idioma: IdiomaCodigo = "pt-BR";
let _idiomaOutro: IdiomaCodigo | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _reconnectDelay = 0;
let _encerrado = false;
let _bloqueado = false;

export function conectar(
  codigo: string,
  papel: Papel,
  idioma: IdiomaCodigo,
  callbacks: SalaCallbacks,
) {
  encerrar();
  _encerrado = false;
  _bloqueado = false;
  _callbacks = callbacks;
  _salaCodigo = codigo;
  _papel = papel;
  _idioma = idioma;
  _idiomaOutro = null;
  fila = [];
  _reconnectDelay = 0;

  const url = `${WS_BASE}/sala/${encodeURIComponent(codigo)}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    enviar({ tipo: "entrar", papel, idioma });
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        enviar({ tipo: "ping" });
      }
    }, 25_000);
    callbacks.onConexao?.();
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data as string) as MensagemRecebida;
      if (msg.tipo === "presenca") {
        _idiomaOutro = msg.conectado ? msg.idioma : null;
      } else if (msg.tipo === "erro" && msg.motivo === "sala cheia") {
        _bloqueado = true;
        limparPing();
        if (ws) {
          ws.onclose = null;
          ws.close();
          ws = null;
        }
      }
      callbacks.onMensagem?.(msg);
    } catch {
      // mensagem inválida
    }
  };

  ws.onclose = (evt) => {
    limparPing();
    if (!_encerrado) {
      callbacks.onDesconexao?.(evt.code, evt.reason);
      if (!_bloqueado) tentarReconectar();
    }
  };

  ws.onerror = () => {
    callbacks.onErro?.("Erro de conexão com a sala");
  };
}

export function encerrar() {
  _encerrado = true;
  limparPing();
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
  _reconnectDelay = 0;
  fila = [];
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
}

export function trocarIdioma(idioma: IdiomaCodigo) {
  _idioma = idioma;
  enviar({ tipo: "idioma", idioma });
}

export function enviarFala(base64: string, formato: string): boolean {
  if (ws?.readyState !== WebSocket.OPEN) {
    if (fila.length < FILA_MAX) {
      fila.push({ base64, formato });
    } else {
      fila.shift();
      fila.push({ base64, formato });
    }
    return false;
  }
  void interpretar(base64, formato);
  return true;
}

export function enviarFilaSePossivel() {
  if (ws?.readyState !== WebSocket.OPEN || fila.length === 0) return;
  const item = fila.shift()!;
  void interpretar(item.base64, item.formato);
}

export function obterSalaCodigo(): string {
  return _salaCodigo;
}

export function obterHost(): string {
  return SALA_HOST_PADRAO;
}

export function idiomaDoOutro(): IdiomaCodigo | null {
  return _idiomaOutro;
}

function enviar(msg: MensagemSala) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function limparPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

async function interpretar(base64: string, formato: string) {
  if (!_idiomaOutro) {
    _callbacks.onErro?.("Ninguém do outro lado ainda");
    return;
  }
  try {
    const resp = await fetch(`${SALA_HOST_PADRAO}/interpretar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sala: _salaCodigo,
        papel: _papel,
        idiomaOrigem: _idioma,
        idiomaDestino: _idiomaOutro,
        audioBase64: base64,
        formato,
      }),
    });
    if (!resp.ok) {
      _callbacks.onErro?.(`Erro na interpretação: ${resp.status}`);
      return;
    }
    const dados = await resp.json() as InterpretarResposta;
    if ("vazio" in dados) {
      _callbacks.onMensagem?.({
        tipo: "fala",
        papel: _papel,
        idiomaOrigem: _idioma,
        idiomaDestino: _idiomaOutro,
        original: "",
        traduzido: "",
        em: Date.now(),
      });
    } else {
      _callbacks.onMensagem?.({
        tipo: "fala",
        papel: _papel,
        idiomaOrigem: _idioma,
        idiomaDestino: _idiomaOutro,
        original: dados.original,
        traduzido: dados.traduzido,
        em: Date.now(),
      });
    }
  } catch {
    _callbacks.onErro?.("Falha ao enviar fala");
  }
}

function tentarReconectar() {
  if (_encerrado || _bloqueado) return;
  _reconnectDelay = _reconnectDelay === 0 ? 1000 : Math.min(_reconnectDelay * 2, 8000);
  _reconnectTimer = setTimeout(() => {
    if (!_encerrado && !_bloqueado) {
      conectar(_salaCodigo, _papel, _idioma, _callbacks);
    }
  }, _reconnectDelay);
}
