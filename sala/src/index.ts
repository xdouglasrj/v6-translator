// Worker + Durable Object Sala: sala de texto em tempo real para dois celulares
// Cada sala aceita no máximo 2 conexões. Mensagens são repassadas sem persistir.

interface Env {
  SALA: DurableObjectNamespace;
  OPENROUTER_API_KEY?: string;
}

// Tipo do dado anexado a cada WebSocket via serializeAttachment
interface DadosConexao {
  papel: string;
  idioma: string;
  cheia?: boolean;
  visto: number;
}

// Mensagens recebidas
interface MensagemEntrar {
  tipo: "entrar";
  papel: "piloto" | "turista";
  idioma: string;
}

interface MensagemFala {
  tipo: "fala";
  papel: string;
  idiomaOrigem: string;
  idiomaDestino: string;
  original: string;
  traduzido: string;
  em: number;
}

interface MensagemIdioma {
  tipo: "idioma";
  idioma: string;
}

interface MensagemPing {
  tipo: "ping";
}

type MensagemRecebida =
  | MensagemEntrar
  | MensagemFala
  | MensagemIdioma
  | MensagemPing;

// Mapa de nomes de idiomas em inglês para a instrução do sistema
const NOMES_IDIOMAS: Record<string, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
};

// Validação de campos obrigatórios do /interpretar
function validarCampos(body: Record<string, unknown>): string | null {
  const campos = ["sala", "papel", "idiomaOrigem", "idiomaDestino", "audioBase64", "formato"];
  for (const c of campos) {
    if (!body[c] || typeof body[c] !== "string") return "campo invalido";
  }
  if (body.papel !== "piloto" && body.papel !== "turista") return "papel invalido";
  const idiomas = ["pt-BR", "en", "es", "fr"];
  if (!idiomas.includes(body.idiomaOrigem as string)) return "idiomaOrigem invalido";
  if (!idiomas.includes(body.idiomaDestino as string)) return "idiomaDestino invalido";
  const formatos = ["m4a", "wav", "mp3", "ogg"];
  if (!formatos.includes(body.formato as string)) return "formato invalido";
  return null;
}

// Chamar OpenRouter: transcrição
async function transcrever(
  apiKey: string,
  audioBase64: string,
  formato: string,
  idiomaOrigem: string
): Promise<{ text: string; usage: { seconds: number; cost: number } }> {
  const iso639: Record<string, string> = { "pt-BR": "pt", en: "en", es: "es", fr: "fr" };
  const resp = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openai/whisper-large-v3-turbo",
      input_audio: { data: audioBase64, format: formato },
      language: iso639[idiomaOrigem],
    }),
  });
  if (!resp.ok) throw new Error(`transcricao:${resp.status}`);
  return resp.json() as Promise<{ text: string; usage: { seconds: number; cost: number } }>;
}

// Chamar OpenRouter: tradução
async function traduzir(
  apiKey: string,
  texto: string,
  idiomaOrigem: string,
  idiomaDestino: string
): Promise<{ texto: string; modelo: string }> {
  const origem = NOMES_IDIOMAS[idiomaOrigem.replace("-BR", "")] ?? idiomaOrigem;
  const destino = NOMES_IDIOMAS[idiomaDestino.replace("-BR", "")] ?? idiomaDestino;
  const instrucao =
    `You are an interpreter. Translate the user message from ${origem} to ${destino}. ` +
    "Preserve names, numbers, prices, times and places. Do not answer questions. " +
    "Do not add information. Do not explain. Return only the translation.";

  const modelos = [
    "meta-llama/llama-3.1-8b-instruct",
    "inclusionai/ling-3.0-flash",
  ];

  for (const modelo of modelos) {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelo,
        temperature: 0.2,
        messages: [
          { role: "system", content: instrucao },
          { role: "user", content: texto },
        ],
      }),
    });
    if (!resp.ok) continue;
    const dados = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const traduzido = dados.choices?.[0]?.message?.content?.trim();
    if (traduzido) return { texto: traduzido, modelo };
  }

  throw new Error("traducao:falha");
}

// Worker principal
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/saude") {
      return Response.json({ ok: true });
    }

    // POST /interpretar: transcrever + traduzir + entregar
    if (url.pathname === "/interpretar" && request.method === "POST") {
      if (!env.OPENROUTER_API_KEY) {
        return Response.json({ erro: "chave nao configurada na sala" }, { status: 503 });
      }

      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return Response.json({ erro: "pedido invalido" }, { status: 400 });
      }

      const erroValidacao = validarCampos(body);
      if (erroValidacao) {
        return Response.json({ erro: "pedido invalido" }, { status: 400 });
      }

      const audio = body.audioBase64 as string;
      if (audio.length > 6_990_000) {
        return Response.json({ erro: "audio grande demais" }, { status: 413 });
      }

      const inicio = Date.now();
      let resultadoTranscricao: { text: string; usage: { seconds: number; cost: number } };

      try {
        resultadoTranscricao = await transcrever(
          env.OPENROUTER_API_KEY,
          audio,
          body.formato as string,
          body.idiomaOrigem as string
        );
      } catch {
        return Response.json({ erro: "falha ao transcrever" }, { status: 502 });
      }

      const texto = resultadoTranscricao.text.trim();
      if (!texto) {
        return Response.json({ vazio: true });
      }

      const msTranscricao = Date.now() - inicio;

      let resultadoTraducao: { texto: string; modelo: string };
      try {
        resultadoTraducao = await traduzir(
          env.OPENROUTER_API_KEY,
          texto,
          body.idiomaOrigem as string,
          body.idiomaDestino as string
        );
      } catch {
        return Response.json({ erro: "falha ao traduzir" }, { status: 502 });
      }

      const msTraducao = Date.now() - inicio - msTranscricao;

      // Entregar ao outro celular via método interno do DO
      const fala = {
        tipo: "fala" as const,
        papel: body.papel,
        idiomaOrigem: body.idiomaOrigem,
        idiomaDestino: body.idiomaDestino,
        original: texto,
        traduzido: resultadoTraducao.texto,
        em: Date.now(),
      };

      const id = env.SALA.idFromName(body.sala as string);
      const stub = env.SALA.get(id);
      try {
        await stub.fetch("https://sala/entregar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fala),
        });
      } catch (e) {
        console.error(`Entrega falhou: ${e}`);
      }

      console.log(
        `Sala: ${body.sala} | ${body.papel} | ` +
        `${resultadoTranscricao.usage.seconds}s audio | ` +
        `$${resultadoTranscricao.usage.cost} | ` +
        `transc: ${msTranscricao}ms | trad: ${msTraducao}ms`
      );

      return Response.json({
        original: texto,
        traduzido: resultadoTraducao.texto,
        modelo: resultadoTraducao.modelo,
        segundosAudio: resultadoTranscricao.usage.seconds,
        custo: resultadoTranscricao.usage.cost,
        ms: {
          transcricao: msTranscricao,
          traducao: msTraducao,
          total: Date.now() - inicio,
        },
      });
    }

    // Rota de sala: upgrade para WebSocket
    const salaMatch = url.pathname.match(/^\/sala\/(.+)$/);
    if (salaMatch && request.method === "GET") {
      const codigo = salaMatch[1];
      const id = env.SALA.idFromName(codigo);
      const stub = env.SALA.get(id);
      return stub.fetch(request);
    }

    return new Response("404 não encontrado", { status: 404 });
  },
};

// Durable Object Sala
export class Sala {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /entregar: receber mensagem do Worker e enviar ao outro celular
    if (url.pathname === "/entregar" && request.method === "POST") {
      const body = (await request.json()) as MensagemFala;
      const papelRemetente = body.papel;
      const destino = this.state.getWebSockets().find((ws) => {
        const d = ws.deserializeAttachment() as DadosConexao | null;
        return d && !d.cheia && d.papel !== papelRemetente;
      });
      if (destino) {
        destino.send(JSON.stringify(body));
      }
      return Response.json({ ok: true });
    }

    // Verificar limite de conexões - limpar conexões mortas primeiro
    const agora = Date.now();
    const conexoesAtuais = this.state.getWebSockets();
    let conexoesVivas = 0;
    for (const ws of conexoesAtuais) {
      const dados = ws.deserializeAttachment() as DadosConexao | null;
      if (dados && !dados.cheia && dados.visto && agora - dados.visto <= 90000) {
        conexoesVivas++;
      } else if (dados && !dados.cheia) {
        ws.close(4003, "sem sinal");
      }
    }
    if (conexoesVivas >= 2) {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ papel: "", idioma: "", cheia: true } as DadosConexao);
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }

    // Criar par de WebSocket
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Aceitar com hibernação
    this.state.acceptWebSocket(server);
    const alarmAtual = await this.state.storage.getAlarm();
    if (alarmAtual === null) {
      await this.state.storage.setAlarm(Date.now() + 30000);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  // Handler de mensagens WebSocket (hibernation API)
  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    // Verificar se conexão é da sala cheia
    const anexo = ws.deserializeAttachment() as DadosConexao | null;
    if (anexo?.cheia) {
      ws.send(JSON.stringify({ tipo: "erro", motivo: "sala cheia" }));
      ws.close(4001, "sala cheia");
      return;
    }

    // Verificar tamanho (8 KB)
    const tamanho =
      typeof data === "string" ? new TextEncoder().encode(data).length : data.byteLength;
    if (tamanho > 8192) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "mensagem grande demais" })
      );
      return;
    }

    // Tentar parsear JSON
    let mensagem: MensagemRecebida;
    try {
      mensagem = JSON.parse(data as string);
    } catch {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "mensagem invalida" })
      );
      return;
    }

    // Verificar tipo conhecido
    if (!mensagem || typeof mensagem.tipo !== "string") {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "mensagem invalida" })
      );
      return;
    }

    // Atualizar visto em toda mensagem válida
    const dados = this.obterDados(ws);
    if (dados) {
      dados.visto = Date.now();
      ws.serializeAttachment(dados);
    }

    switch (mensagem.tipo) {
      case "entrar":
        this.manejarEntrar(ws, mensagem);
        break;
      case "fala":
        this.manejarFala(ws, mensagem);
        break;
      case "idioma":
        this.manejarIdioma(ws, mensagem);
        break;
      case "ping":
        this.manejarPing(ws, mensagem);
        break;
      default:
        ws.send(
          JSON.stringify({ tipo: "erro", motivo: "mensagem invalida" })
        );
        break;
    }
  }

  // Handler de fechamento WebSocket
  webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): void {
    this.notificarRemocao(ws);
  }

  // Handler de erro WebSocket
  webSocketError(ws: WebSocket, _error: unknown): void {
    this.notificarRemocao(ws);
  }

  private obterDados(ws: WebSocket): DadosConexao | null {
    return ws.deserializeAttachment() as DadosConexao | null;
  }

  private obterOutroConexao(exeto: WebSocket): WebSocket | null {
    return this.state.getWebSockets().find((c) => {
      if (c === exeto) return false;
      const dados = c.deserializeAttachment() as DadosConexao | null;
      return dados && !dados.cheia;
    }) ?? null;
  }

  private notificarRemocao(ws: WebSocket): void {
    const dados = this.obterDados(ws);
    const outro = this.obterOutroConexao(ws);
    if (outro && dados) {
      outro.send(
        JSON.stringify({
          tipo: "presenca",
          papel: dados.papel,
          idioma: dados.idioma,
          conectado: false,
        })
      );
    }
  }

  private async manejarEntrar(
    ws: WebSocket,
    mensagem: MensagemEntrar
  ): void {
    if (this.obterDados(ws)) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "ja identificado" })
      );
      return;
    }

    // Validar papel
    if (mensagem.papel !== "piloto" && mensagem.papel !== "turista") {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "papel invalido" })
      );
      return;
    }

    // Validar idioma
    const idiomasValidos = ["pt-BR", "en", "es", "fr"];
    if (!idiomasValidos.includes(mensagem.idioma)) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "idioma invalido" })
      );
      return;
    }

    // Registrar dados da conexão via hibernation
    const dados: DadosConexao = {
      papel: mensagem.papel,
      idioma: mensagem.idioma,
      visto: Date.now(),
    };
    ws.serializeAttachment(dados);
    const alarmAtual = await this.state.storage.getAlarm();
    if (alarmAtual === null) {
      await this.state.storage.setAlarm(Date.now() + 30000);
    }

    // Avisar o outro lado sobre a presença
    const outro = this.obterOutroConexao(ws);
    if (outro) {
      const dadosOutro = this.obterDados(outro);
      if (dadosOutro) {
        ws.send(
          JSON.stringify({
            tipo: "presenca",
            papel: dadosOutro.papel,
            idioma: dadosOutro.idioma,
            conectado: true,
          })
        );
      }

      outro.send(
        JSON.stringify({
          tipo: "presenca",
          papel: dados.papel,
          idioma: dados.idioma,
          conectado: true,
        })
      );
    }

    console.log(
      `Sala: conexão entrando. Papel: ${dados.papel}, Idioma: ${dados.idioma}`
    );
  }

  private manejarFala(
    ws: WebSocket,
    mensagem: MensagemFala
  ): void {
    if (!this.obterDados(ws)) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "nao identificado" })
      );
      return;
    }

    const outro = this.obterOutroConexao(ws);
    if (outro) {
      outro.send(JSON.stringify(mensagem));
    } else {
      ws.send(
        JSON.stringify({ tipo: "naoentregue", em: mensagem.em })
      );
    }
  }

  private manejarIdioma(
    ws: WebSocket,
    mensagem: MensagemIdioma
  ): void {
    const dados = this.obterDados(ws);
    if (!dados) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "nao identificado" })
      );
      return;
    }

    const idiomasValidos = ["pt-BR", "en", "es", "fr"];
    if (!idiomasValidos.includes(mensagem.idioma)) {
      ws.send(
        JSON.stringify({ tipo: "erro", motivo: "idioma invalido" })
      );
      return;
    }

    dados.idioma = mensagem.idioma;
    dados.visto = Date.now();
    ws.serializeAttachment(dados);

    const outro = this.obterOutroConexao(ws);
    if (outro) {
      outro.send(
        JSON.stringify({
          tipo: "presenca",
          papel: dados.papel,
          idioma: dados.idioma,
          conectado: true,
        })
      );
    }
  }

  private manejarPing(
    ws: WebSocket,
    mensagem: MensagemPing
  ): void {
    ws.send(JSON.stringify({ tipo: "pong", em: mensagem.em ?? Date.now() }));
  }

  async alarm(): Promise<void> {
    const agora = Date.now();
    const conexoes = this.state.getWebSockets();
    let temViva = false;
    for (const ws of conexoes) {
      const dados = ws.deserializeAttachment() as DadosConexao | null;
      if (dados && !dados.cheia && dados.visto && agora - dados.visto <= 90000) {
        temViva = true;
      } else if (dados && !dados.cheia) {
        ws.close(4003, "sem sinal");
      }
    }
    if (temViva) {
      const alarmAtual = await this.state.storage.getAlarm();
      if (alarmAtual === null) {
        await this.state.storage.setAlarm(agora + 30000);
      }
    }
  }
}
