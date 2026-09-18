import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

type NativeEscutaAudio = {
  iniciarSessao: () => Promise<IniciarSessaoResult>;
  encerrarSessao: () => Promise<void>;
  definirSensibilidade: (limiar: number) => Promise<void>;
  silenciarEntrada: (silenciado: boolean) => Promise<void>;
  falar: (texto: string, idioma: string) => Promise<void>;
  pararFala: () => Promise<void>;
  tocarAudio: (base64: string, formato: string) => Promise<void>;
  addListener: (event: string, listener: () => void) => { remove: () => void };
};

export type IniciarSessaoResult = {
  taxaAmostragem: number;
  rotaEntrada: string;
  rotaSaida: string;
  modo: string;
};

export type FalaProntaEvent = {
  base64: string;
  ms: number;
  rms: number;
};

export type FalaComecouEvent = {
  em: number;
};

export type NivelEvent = {
  rms: number;
};

const nativeModule = Platform.OS === "android"
  ? requireOptionalNativeModule<NativeEscutaAudio>("EscutaAudio")
  : null;

export const isEscutaAudioAvailable = Boolean(nativeModule);

export async function iniciarSessao(): Promise<IniciarSessaoResult> {
  if (nativeModule) return nativeModule.iniciarSessao();
  throw new Error("Disponível só no aplicativo Android");
}

export async function encerrarSessao(): Promise<void> {
  if (nativeModule) return nativeModule.encerrarSessao();
  throw new Error("Disponível só no aplicativo Android");
}

export async function definirSensibilidade(limiar: number): Promise<void> {
  if (nativeModule) return nativeModule.definirSensibilidade(limiar);
  throw new Error("Disponível só no aplicativo Android");
}

export async function silenciarEntrada(silenciado: boolean): Promise<void> {
  if (nativeModule) return nativeModule.silenciarEntrada(silenciado);
  throw new Error("Disponível só no aplicativo Android");
}

export async function falar(texto: string, idioma: string): Promise<void> {
  if (nativeModule) return nativeModule.falar(texto, idioma);
  throw new Error("Disponível só no aplicativo Android");
}

export async function pararFala(): Promise<void> {
  if (nativeModule) return nativeModule.pararFala();
  throw new Error("Disponível só no aplicativo Android");
}

export async function tocarAudio(base64: string, formato: string): Promise<void> {
  if (nativeModule) return nativeModule.tocarAudio(base64, formato);
  throw new Error("Disponível só no aplicativo Android");
}

export function aoEvento(
  nome: "onFalaPronta" | "onFalaComecou" | "onNivel",
  ouvinte: (dados: FalaProntaEvent | FalaComecouEvent | NivelEvent) => void
): { remove: () => void } {
  if (nativeModule?.addListener) {
    return nativeModule.addListener(nome, ouvinte as any);
  }
  return { remove: () => {} };
}