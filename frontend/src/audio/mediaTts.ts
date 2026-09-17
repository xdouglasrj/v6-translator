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
  startRecording: () => Promise<RecordingStartResult>;
  stopRecording: () => Promise<void>;
  startPlayback: () => Promise<PlaybackStartResult>;
  stopPlayback: () => Promise<void>;
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

export type RecordingStartResult = {
  mode: string;
  inputs: string[];
  outputs: string[];
  scoActive: boolean;
  routedInput: string;
  builtInMicFound: boolean;
};

export type PlaybackStartResult = {
  mode: string;
  outputs: string[];
  usage: string;
  contentType: string;
  focus: string;
};

export type RecordingStopEvent = {
  path: string;
  bytes: number;
  durationMs: number;
  mode: string;
  outputs: string[];
};

export type RouteChangeEvent = {
  before: string;
  after: string;
  time: number;
};

export async function startMicRecording(): Promise<RecordingStartResult> {
  if (nativeTts) return nativeTts.startRecording();
  throw new Error("Módulo nativo indisponível. Disponível só no APK Android.");
}

export async function stopMicRecording(): Promise<void> {
  if (nativeTts) return nativeTts.stopRecording();
  throw new Error("Módulo nativo indisponível.");
}

export async function startMicPlayback(): Promise<PlaybackStartResult> {
  if (nativeTts) return nativeTts.startPlayback();
  throw new Error("Módulo nativo indisponível. Disponível só no APK Android.");
}

export async function stopMicPlayback(): Promise<void> {
  if (nativeTts) return nativeTts.stopPlayback();
  throw new Error("Módulo nativo indisponível.");
}

export function addMicListener(
  event: string,
  listener: (...args: unknown[]) => void,
): { remove: () => void } {
  if (nativeTts?.addListener) return nativeTts.addListener(event, listener);
  return { remove: () => {} };
}