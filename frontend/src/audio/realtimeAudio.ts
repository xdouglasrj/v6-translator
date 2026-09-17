import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

type NativeRealtimeAudio = {
  startStreamCapture: () => Promise<StreamCaptureResult>;
  stopStreamCapture: () => Promise<void>;
  setCaptureMuted: (muted: boolean) => Promise<void>;
  startStreamPlayback: () => Promise<StreamPlaybackResult>;
  writeStreamChunk: (base64: string) => Promise<void>;
  stopStreamPlayback: () => Promise<void>;
  addListener?: (event: string, listener: (...args: unknown[]) => void) => { remove: () => void };
};

export type StreamCaptureResult = {
  sampleRate: number;
  bufferBytes: number;
  routedInput: string;
  mode: string;
};

export type StreamPlaybackResult = {
  sampleRate: number;
  bufferBytes: number;
  outputs: string[];
};

const nativeRealtime = Platform.OS === "android"
  ? requireOptionalNativeModule<NativeRealtimeAudio>("V6MediaTts")
  : null;

export const isRealtimeAudioAvailable = Boolean(nativeRealtime);

export async function startStreamCapture(): Promise<StreamCaptureResult> {
  if (nativeRealtime) return nativeRealtime.startStreamCapture();
  throw new Error("Módulo nativo indisponível. Disponível só no APK Android.");
}

export async function stopStreamCapture(): Promise<void> {
  if (nativeRealtime) return nativeRealtime.stopStreamCapture();
  throw new Error("Módulo nativo indisponível.");
}

export async function setCaptureMuted(muted: boolean): Promise<void> {
  if (nativeRealtime) return nativeRealtime.setCaptureMuted(muted);
  throw new Error("Módulo nativo indisponível.");
}

export async function startStreamPlayback(): Promise<StreamPlaybackResult> {
  if (nativeRealtime) return nativeRealtime.startStreamPlayback();
  throw new Error("Módulo nativo indisponível. Disponível só no APK Android.");
}

export async function writeStreamChunk(base64: string): Promise<void> {
  if (nativeRealtime) return nativeRealtime.writeStreamChunk(base64);
  throw new Error("Módulo nativo indisponível.");
}

export async function stopStreamPlayback(): Promise<void> {
  if (nativeRealtime) return nativeRealtime.stopStreamPlayback();
  throw new Error("Módulo nativo indisponível.");
}

export function addRealtimeListener(
  event: string,
  listener: (...args: unknown[]) => void,
): { remove: () => void } {
  if (nativeRealtime?.addListener) return nativeRealtime.addListener(event, listener);
  return { remove: () => {} };
}
