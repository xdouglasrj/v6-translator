export type InterpreterState =
  | "DESCONECTADO"
  | "CONECTANDO"
  | "OUVINDO"
  | "PESSOA_FALANDO"
  | "INTERPRETANDO"
  | "IA_FALANDO"
  | "ERRO";

export type InterpreterConfig = {
  serverUrl: string;
  myName: string;
  myLanguage: string;
  touristName: string;
  touristLanguage: string;
  resumeDelayMs: number;
};

export type InterpreterTimings = {
  speechStartedAt: number | null;
  speechEndedAt: number | null;
  responseCreatedAt: number | null;
  firstAudioReceivedAt: number | null;
  firstAudioPlayedAt: number | null;
  responseDoneAt: number | null;
};

export type InterpreterSnapshot = {
  state: InterpreterState;
  lastSpeech: string;
  lastInterpretation: string;
  timings: InterpreterTimings;
  latencyMs: number | null;
  error: string | null;
  attempts: number;
};

export const INITIAL_STATE: InterpreterSnapshot = {
  state: "DESCONECTADO",
  lastSpeech: "",
  lastInterpretation: "",
  timings: {
    speechStartedAt: null,
    speechEndedAt: null,
    responseCreatedAt: null,
    firstAudioReceivedAt: null,
    firstAudioPlayedAt: null,
    responseDoneAt: null,
  },
  latencyMs: null,
  error: null,
  attempts: 0,
};

export const DEFAULT_CONFIG: InterpreterConfig = {
  serverUrl: "http://192.168.0.10:8000",
  myName: "Douglas",
  myLanguage: "Português (Brasil)",
  touristName: "John",
  touristLanguage: "English",
  resumeDelayMs: 400,
};
