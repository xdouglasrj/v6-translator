import type { InterpreterConfig } from "./state";
import { getApiKey } from "@/src/openai";

type SessionEvent =
  | { type: "connected" }
  | { type: "disconnected"; code: number; reason: string }
  | { type: "error"; message: string }
  | { type: "raw"; data: Record<string, unknown> };

type SessionHandler = (event: SessionEvent) => void;

export type RealtimeSession = {
  send: (msg: Record<string, unknown>) => void;
  close: () => void;
};

export async function fetchClientSecret(
  serverUrl: string,
  instructions: string,
): Promise<{ value: string; expires_at: number; model: string }> {
  const res = await fetch(`${serverUrl}/api/realtime/client-secret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Servidor retornou ${res.status}`);
  }
  return res.json();
}

export async function resolveCredential(
  cfg: InterpreterConfig,
  instructions: string,
): Promise<string> {
  if (cfg.credentialOrigin === "CELULAR") {
    const key = await getApiKey();
    if (!key) {
      throw new Error("Sem chave salva");
    }
    return key;
  }
  const secret = await fetchClientSecret(cfg.serverUrl, instructions);
  return secret.value;
}

export function buildInstructions(cfg: InterpreterConfig): string {
  return `You are a professional interpreter standing between two people who speak different languages. Your only job is to interpret their conversation. ${cfg.myName} speaks ${cfg.myLanguage}. ${cfg.touristName} speaks ${cfg.touristLanguage}. When ${cfg.touristName} speaks, interpret the message for ${cfg.myName} in ${cfg.myLanguage}. When ${cfg.myName} speaks, interpret the message for ${cfg.touristName} in ${cfg.touristLanguage}. Before the interpretation, briefly identify who spoke, for example: ${cfg.touristName} disse: ... or ${cfg.myName} said: ... . Never answer questions asked by either person. Never take part in the conversation. Never give opinions or your own information. Never invent answers. Never act as an assistant. Never explain the translation. Never say you are an AI. Only interpret what one person said to the other. Preserve names, numbers, prices, times, places, questions, intent and context. Produce a natural interpretation in the target language.`;
}

export function openSession(
  clientSecret: string,
  instructions: string,
  handler: SessionHandler,
): RealtimeSession {
  const wsUrl = `wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1`;
  const protocol1 = "realtime";
  const protocol2 = `openai-insecure-api-key.${clientSecret}`;
  const ws = new WebSocket(wsUrl, [protocol1, protocol2]);

  const session: RealtimeSession = {
    send: (msg) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close: () => {
      ws.close();
    },
  };

  ws.onopen = () => {
    session.send({
      type: "session.update",
      session: {
        type: "realtime",
        instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            turn_detection: { type: "semantic_vad" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: "alloy",
          },
        },
      },
    });
    handler({ type: "connected" });
  };

  ws.onmessage = (evt) => {
    try {
      const data = JSON.parse(typeof evt.data === "string" ? evt.data : "") as Record<string, unknown>;
      handler({ type: "raw", data });
    } catch {
      // ignore unparseable messages
    }
  };

  ws.onerror = () => {
    handler({ type: "error", message: "WebSocket erro" });
  };

  ws.onclose = (evt) => {
    handler({ type: "disconnected", code: evt.code, reason: evt.reason });
  };

  return session;
}
