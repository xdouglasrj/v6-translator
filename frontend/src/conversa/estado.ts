export type Papel = "piloto" | "turista";

export type IdiomaCodigo = "pt-BR" | "en" | "es" | "fr";

export type EstadoConversa =
  | "DESLIGADO"
  | "CONECTANDO"
  | "OUVINDO"
  | "FALANDO"
  | "ENVIANDO"
  | "TRADUZINDO"
  | "OUVINDO_TRADUCAO"
  | "ERRO";

export type Fala = {
  original: string;
  traduzido: string;
  em: number;
};

export type Metricas = {
  falaMs: number;
  postMs: number;
  traducaoMs: number;
};

export type EstadoSessao = {
  papel: Papel;
  idioma: IdiomaCodigo;
  salaCodigo: string;
  salaHost: string;
  estado: EstadoConversa;
  conectado: boolean;
  outroConectado: boolean;
  outroIdioma: IdiomaCodigo | null;
  falas: Fala[];
  metricas: Metricas | null;
  erro: string | null;
};
