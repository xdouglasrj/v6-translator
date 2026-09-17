import { SYSTEM_PROMPT } from "./interpreter";

const BASE = "https://api.openai.com/v1";

type TranscribeResult = {
  text: string;
  languages: Array<{ code: string }>;
};

type InterpretResult = {
  text: string;
};

type SpeechResult = {
  audioBase64: string;
};

export async function transcribe(
  apiKey: string,
  fileUri: string,
  fileName: string,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("model", "gpt-transcribe");
  form.append("file", {
    uri: fileUri,
    name: fileName,
    type: "audio/m4a",
  } as unknown as Blob);

  const res = await fetch(`${BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401) throw new Error("CHAVE_RECUSADA");
    throw new Error(`TRANSCRIBE_${status}`);
  }

  return res.json() as Promise<TranscribeResult>;
}

export async function interpret(
  apiKey: string,
  text: string,
): Promise<InterpretResult> {
  const res = await fetch(`${BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      instructions: SYSTEM_PROMPT,
      input: text,
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401) throw new Error("CHAVE_RECUSADA");
    throw new Error(`INTERPRET_${status}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const outputText = data.output_text as string | undefined;
  if (outputText) return { text: outputText };

  const output = data.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
  if (output && Array.isArray(output)) {
    for (const item of output) {
      if (item.content && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c.text) return { text: c.text };
        }
      }
    }
  }

  return { text: "" };
}

export async function generateSpeech(
  apiKey: string,
  text: string,
): Promise<SpeechResult> {
  const res = await fetch(`${BASE}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: text,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    const status = res.status;
    if (status === 401) throw new Error("CHAVE_RECUSADA");
    throw new Error(`SPEECH_${status}`);
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const audioBase64 = btoa(binary);
  return { audioBase64 };
}
