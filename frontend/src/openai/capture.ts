import {
  startFreeMicRecording,
  stopFreeMicRecording,
} from "@/src/audio/mediaTts";
import type { FreeRecordingStartResult } from "@/src/audio/mediaTts";

export type CaptureResult = {
  path: string;
  bytes: number;
  durationMs: number;
  info: FreeRecordingStartResult;
};

let currentInfo: FreeRecordingStartResult | null = null;

export async function startCapture(): Promise<FreeRecordingStartResult> {
  const info = await startFreeMicRecording();
  currentInfo = info;
  return info;
}

export async function stopCapture(): Promise<CaptureResult> {
  const result = await stopFreeMicRecording();
  const info = currentInfo;
  currentInfo = null;
  if (!info) throw new Error("Nenhuma gravação em andamento.");
  return {
    path: result.path,
    bytes: result.bytes,
    durationMs: result.durationMs,
    info,
  };
}
