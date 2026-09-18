import {
  iniciarSessao,
  encerrarSessao,
  definirSensibilidade,
  falar,
  aoEvento,
} from "@/src/audio/escutaAudio";
import {
  conectar as conectarSala,
  encerrar as encerrarSala,
  enviarFala,
  enviarFilaSePossivel,
  type MensagemRecebida,
} from "./sala";
import { type EstadoConversa, type Fala, type IdiomaCodigo, type Metricas, type Papel } from "./estado";

const MAX_FALAS = 6;
const ESPERA_POS_FALA_MS = 400;

type MotorCallbacks = {
  onEstadoChange: (estado: EstadoConversa) => void;
  onFalaAdicionada: (fala: Fala) => void;
  onMetricas: (m: Metricas) => void;
  onOutroConectado: (conectado: boolean) => void;
  onOutroIdioma: (idioma: IdiomaCodigo) => void;
  onNivel: (rms: number) => void;
  onErro: (msg: string) => void;
  onLog: (msg: string) => void;
  onConexao?: () => void;
  onFalaEnviada?: () => void;
};

let _callbacks: MotorCallbacks | null = null;
let _papel: Papel = "piloto";
let _idioma: IdiomaCodigo = "pt-BR";
let _estado: EstadoConversa = "DESLIGADO";
let _falas: Fala[] = [];
let _listeners: { remove: () => void }[] = [];
let _falaInicioMs = 0;
let _outroConectado = false;

export function iniciar(
  papel: Papel,
  idioma: IdiomaCodigo,
  salaCodigo: string,
  callbacks: MotorCallbacks,
) {
  parar();
  _callbacks = callbacks;
  _papel = papel;
  _idioma = idioma;
  _falas = [];
  _estado = "CONECTANDO";
  callbacks.onEstadoChange("CONECTANDO");

  void _iniciarAudio(callbacks);

  conectarSala(salaCodigo, papel, idioma, {
    onConexao: () => {
      callbacks.onLog("Sala conectada");
      callbacks.onConexao?.();
      mudarEstado("OUVINDO");
    },
    onDesconexao: (_code, motivo) => {
      callbacks.onLog(`Desconectado: ${motivo}`);
      mudarEstado("ERRO");
    },
    onMensagem: (msg) => _tratarMensagem(msg, callbacks),
    onErro: (erro) => {
      callbacks.onErro(erro);
      mudarEstado("ERRO");
    },
  });
}

export function parar() {
  _listeners.forEach((l) => l.remove());
  _listeners = [];
  void encerrarSessao();
  encerrarSala();
  _estado = "DESLIGADO";
  _falas = [];
  _outroConectado = false;
  _callbacks = null;
}

export function alterarSensibilidade(limiar: number) {
  void definirSensibilidade(limiar);
}

export function obterEstado(): EstadoConversa {
  return _estado;
}

export function obterFalas(): Fala[] {
  return _falas;
}

async function _iniciarAudio(callbacks: MotorCallbacks) {
  try {
    await iniciarSessao();
    callbacks.onLog("Sessão de áudio iniciada");

    _listeners.push(
      aoEvento("onFalaComecou", (dados) => {
        if (!("em" in dados)) return;
        _falaInicioMs = Date.now();
        mudarEstado("FALANDO");
      }),
    );

    _listeners.push(
      aoEvento("onFalaPronta", (dados) => {
        if (!("base64" in dados)) return;
        if (!_outroConectado) {
          callbacks.onLog("Outro lado não conectado — fala descartada");
          mudarEstado("OUVINDO");
          return;
        }
        const falaMs = Date.now() - _falaInicioMs;
        mudarEstado("ENVIANDO");
        callbacks.onLog(`Fala capturada: ${(dados.ms / 1000).toFixed(1)}s`);

        const postInicio = Date.now();
        const ok = enviarFala(dados.base64, "wav");
        const postMs = Date.now() - postInicio;

        if (!ok) {
          callbacks.onLog("Fala enfileirada (sala offline)");
          mudarEstado("OUVINDO");
        } else {
          callbacks.onFalaEnviada?.();
        }

        callbacks.onMetricas({ falaMs, postMs, traducaoMs: 0 });
      }),
    );

    _listeners.push(
      aoEvento("onNivel", (dados) => {
        if (!("rms" in dados)) return;
        callbacks.onNivel(dados.rms);
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao iniciar áudio";
    callbacks.onErro(msg);
    mudarEstado("ERRO");
  }
}

function _tratarMensagem(msg: MensagemRecebida, callbacks: MotorCallbacks) {
  switch (msg.tipo) {
    case "presenca":
      _outroConectado = msg.conectado;
      callbacks.onOutroConectado(msg.conectado);
      if (msg.conectado) {
        callbacks.onOutroIdioma(msg.idioma);
        callbacks.onLog(`Outro ${msg.conectado ? "conectado" : "desconectou"}`);
      }
      break;

    case "fala":
      if (msg.papel === _papel) {
        if (msg.original) {
          _falas = [{ original: msg.original, traduzido: msg.traduzido, em: msg.em }, ..._falas].slice(0, MAX_FALAS);
          callbacks.onFalaAdicionada(_falas[0]);
        }
        mudarEstado("OUVINDO");
        return;
      }

      if (!msg.traduzido) {
        mudarEstado("OUVINDO");
        return;
      }
      mudarEstado("OUVINDO_TRADUCAO");
      callbacks.onLog(`Recebendo tradução: ${msg.traduzido.slice(0, 40)}...`);

      void (async () => {
        try {
          await Promise.race([
            falar(msg.traduzido, _idioma),
            new Promise((_, reject) => setTimeout(() => reject(new Error("falar timeout")), 20_000)),
          ]);
          await new Promise((r) => setTimeout(r, ESPERA_POS_FALA_MS));
          mudarEstado("OUVINDO");
          enviarFilaSePossivel();
        } catch {
          callbacks.onLog("falar falhou ou timeout, seguindo");
          mudarEstado("OUVINDO");
        }
      })();

      if (msg.original) {
        _falas = [{ original: msg.original, traduzido: msg.traduzido, em: msg.em }, ..._falas].slice(0, MAX_FALAS);
        callbacks.onFalaAdicionada(_falas[0]);
      }
      break;

    case "pong":
      break;

    case "erro":
      callbacks.onErro(msg.motivo);
      if (msg.motivo === "sala cheia") {
        mudarEstado("ERRO");
      }
      break;
  }
}

function mudarEstado(estado: EstadoConversa) {
  _estado = estado;
  _callbacks?.onEstadoChange(estado);
}
