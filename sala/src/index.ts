// Worker + Durable Object Sala: sala de texto em tempo real para dois celulares
// Cada sala aceita no máximo 2 conexões. Mensagens são repassadas sem persistir.

interface Env {
  SALA: DurableObjectNamespace;
}

// Tipo do dado anexado a cada WebSocket via serializeAttachment
interface DadosConexao {
  papel: string;
  idioma: string;
  cheia?: boolean;
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

// Worker principal
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Rota de saúde
    if (url.pathname === "/saude") {
      return Response.json({ ok: true });
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
    // Verificar limite de conexões
    const conexoesAtuais = this.state.getWebSockets();
    if (conexoesAtuais.length >= 2) {
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

  private manejarEntrar(
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
    };
    ws.serializeAttachment(dados);

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
}
