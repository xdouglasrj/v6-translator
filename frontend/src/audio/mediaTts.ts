import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { requireOptionalNativeModule } from "expo-modules-core";

export const TEST_PHRASE =
  "Teste de áudio. Se você está ouvindo esta mensagem nos dois intercomunicadores, o compartilhamento de áudio está funcionando.";

type NativeMediaTts = {
  prepare: () => Promise<Record<string, unknown>>;
  speak: (text: string, languageTag: string) => Promise<void>;
  stop: () => Promise<void>;
  getAudioSnapshot: () => Promise<AudioSnapshot>;
  addListener?: (event: string, listener: () => void) => { remove: () => void };
};

export type AudioSnapshot = {
  available: boolean;
  bluetoothConnected: boolean;
  deviceName: string;
  routeType: string;
  audioMode: string;
  audioModeCode?: number;
  scoActive: boolean;
  mediaActive: boolean;
  outputCount?: number;
  reason?: string;
};

const nativeTts = Platform.OS === "android"
  ? requireOptionalNativeModule<NativeMediaTts>("V6MediaTts")
  : null;

export const isNativeMediaTtsAvailable = Boolean(nativeTts);

export async function prepareMediaTts(): Promise<Record<string, unknown>> {
  if (nativeTts) return nativeTts.prepare();
  if (Platform.OS === "android") {
    throw new Error("O módulo nativo de mídia é necessário no Android para garantir USAGE_MEDIA.");
  }
  return { usage: "USAGE_MEDIA", contentType: "CONTENT_TYPE_SPEECH", stream: "STREAM_MUSIC" };
}

export function speakAsMedia(onDone?: () => void, onError?: (error: Error) => void): void {
  if (nativeTts) {
    nativeTts.speak(TEST_PHRASE, "pt-BR").then(onDone).catch((error: Error) => onError?.(error));
    return;
  }
  if (Platform.OS === "android") {
    onError?.(new Error("Módulo nativo de mídia não disponível. Nenhum áudio de chamada será usado."));
    return;
  }
  Speech.speak(TEST_PHRASE, {
    language: "pt-BR",
    rate: 0.9,
    onDone,
    onError,
  });
}

export async function stopMediaTts(): Promise<void> {
  if (nativeTts) {
    await nativeTts.stop();
  } else if (Platform.OS !== "android") {
    Speech.stop();
  }
}

export async function getAudioSnapshot(): Promise<AudioSnapshot> {
  if (nativeTts) return nativeTts.getAudioSnapshot();
  return {
    available: Platform.OS === "web",
    bluetoothConnected: false,
    deviceName: Platform.OS === "web" ? "Rota do dispositivo Android" : "Nome não disponível",
    routeType: Platform.OS === "web" ? "Prévia web" : "Speaker / outro",
    audioMode: "Não disponível nesta prévia",
    scoActive: false,
    mediaActive: false,
    reason: Platform.OS === "web" ? "A rota Bluetooth aparece no APK Android." : "Módulo nativo indisponível",
  };
}