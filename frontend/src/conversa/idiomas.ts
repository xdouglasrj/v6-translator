import { type IdiomaCodigo } from "./estado";

export type IdiomaInfo = {
  codigo: IdiomaCodigo;
  bandeira: string;
  nome: string;
  nomeCurto: string;
  estadoOuvindo: string;
  estadoFalando: string;
  estadoTraduzindo: string;
};

export const idiomas: IdiomaInfo[] = [
  {
    codigo: "pt-BR",
    bandeira: "🇧🇷",
    nome: "Português",
    nomeCurto: "PT",
    estadoOuvindo: "OUVINDO",
    estadoFalando: "FALANDO",
    estadoTraduzindo: "TRADUZINDO",
  },
  {
    codigo: "en",
    bandeira: "🇬🇧",
    nome: "English",
    nomeCurto: "EN",
    estadoOuvindo: "LISTENING",
    estadoFalando: "SPEAKING",
    estadoTraduzindo: "TRANSLATING",
  },
  {
    codigo: "es",
    bandeira: "🇪🇸",
    nome: "Español",
    nomeCurto: "ES",
    estadoOuvindo: "ESCUCHANDO",
    estadoFalando: "HABLANDO",
    estadoTraduzindo: "TRADUCIENDO",
  },
  {
    codigo: "fr",
    bandeira: "🇫🇷",
    nome: "Français",
    nomeCurto: "FR",
    estadoOuvindo: "ÉCOUTANT",
    estadoFalando: "PARLANT",
    estadoTraduzindo: "TRADUISANT",
  },
];

export function obterIdioma(codigo: IdiomaCodigo): IdiomaInfo {
  return idiomas.find((i) => i.codigo === codigo) ?? idiomas[0];
}
