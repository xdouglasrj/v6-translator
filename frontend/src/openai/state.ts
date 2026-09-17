export type PipelinePhase =
  | "PRONTO"
  | "OUVINDO"
  | "PROCESSANDO"
  | "TRANSCREVENDO"
  | "INTERPRETANDO"
  | "GERANDO_VOZ"
  | "REPRODUZINDO"
  | "ERRO";

export type PipelineState = {
  phase: PipelinePhase;
  detectedLanguage: string;
  heard: string;
  interpretation: string;
  timings: {
    transcriptionMs: number;
    interpretationMs: number;
    speechMs: number;
    totalMs: number;
  };
  error: string | null;
};

export const initialPipelineState: PipelineState = {
  phase: "PRONTO",
  detectedLanguage: "",
  heard: "",
  interpretation: "",
  timings: {
    transcriptionMs: 0,
    interpretationMs: 0,
    speechMs: 0,
    totalMs: 0,
  },
  error: null,
};
