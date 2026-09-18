import assert from "node:assert";

// Teste de integração: sala de texto em tempo real
// Uso: node teste.mjs <endereco-da-sala>
// Exemplo: node teste.mjs ws://localhost:8787/sala/teste

const enderecoSala = process.argv[2];
if (!enderecoSala) {
  console.error("Uso: node teste.mjs <endereco-da-sala>");
  console.error("Exemplo: node teste.mjs ws://localhost:8787/sala/teste");
  process.exit(1);
}

function criarConexao(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const mensagens = [];
    const resolvers = {};

    ws.addEventListener("open", () => {
      resolve({ ws, mensagens, resolvers });
    });

    ws.addEventListener("message", (evento) => {
      const texto = evento.data;
      try {
        const msg = JSON.parse(texto);
        mensagens.push(msg);
        const chave = msg.tipo;
        if (resolvers[chave]) {
          resolvers[chave](msg);
          delete resolvers[chave];
        }
      } catch (e) {
        // Ignorar mensagens que não são JSON
      }
    });

    ws.addEventListener("error", (e) => reject(e));
  });
}

function esperarMensagem(conexao, tipo, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout esperando mensagem tipo "${tipo}"`));
    }, timeoutMs);

    conexao.resolvers[tipo] = (msg) => {
      clearTimeout(timer);
      resolve(msg);
    };
  });
}

async function executarTeste() {
  console.log(`Conectando a ${enderecoSala}...`);

  // Criar duas conexões
  const piloto = await criarConexao(enderecoSala);
  const turista = await criarConexao(enderecoSala);

  console.log("Duas conexões abertas");

  // Preparar promise para presença do turista antes de entrar com piloto
  const presencaTurista = esperarMensagem(piloto, "presenca");

  // Piloto entra
  piloto.ws.send(
    JSON.stringify({ tipo: "entrar", papel: "piloto", idioma: "pt-BR" })
  );
  console.log("Piloto entrou");

  // Preparar promise para presença do piloto no turista
  const presencaPiloto = esperarMensagem(turista, "presenca");

  // Turista entra
  turista.ws.send(
    JSON.stringify({ tipo: "entrar", papel: "turista", idioma: "en" })
  );
  console.log("Turista entrou");

  // Piloto deve receber a presença do turista
  const presenca1 = await presencaTurista;
  assert.strictEqual(presenca1.tipo, "presenca");
  assert.strictEqual(presenca1.papel, "turista");
  assert.strictEqual(presenca1.idioma, "en");
  assert.strictEqual(presenca1.conectado, true);
  console.log("Piloto recebeu presença do turista: OK");

  // Turista deve receber a presença do piloto
  const presenca2 = await presencaPiloto;
  assert.strictEqual(presenca2.tipo, "presenca");
  assert.strictEqual(presenca2.papel, "piloto");
  assert.strictEqual(presenca2.idioma, "pt-BR");
  assert.strictEqual(presenca2.conectado, true);
  console.log("Turista recebeu presença do piloto: OK");

  // Preparar promise para fala no turista
  const falaRecebida = esperarMensagem(turista, "fala");
  const timestamp = Date.now();

  // Piloto manda uma fala
  piloto.ws.send(
    JSON.stringify({
      tipo: "fala",
      papel: "piloto",
      idiomaOrigem: "pt-BR",
      idiomaDestino: "en",
      original: "Olá, tudo bem?",
      traduzido: "Hello, how are you?",
      em: timestamp,
    })
  );
  console.log("Piloto mandou fala");

  // Turista deve receber a fala
  const fala = await falaRecebida;
  assert.strictEqual(fala.tipo, "fala");
  assert.strictEqual(fala.original, "Olá, tudo bem?");
  assert.strictEqual(fala.traduzido, "Hello, how are you?");
  assert.strictEqual(fala.em, timestamp);
  console.log("Turista recebeu fala: OK");

  // Verificar que o piloto NÃO recebeu de volta a fala que mandou
  const msgsPiloto = piloto.mensagens.filter((m) => m.tipo === "fala");
  assert.strictEqual(msgsPiloto.length, 0, "Piloto não deve receber sua própria fala");
  console.log("Piloto não recebeu própria fala: OK");

  // Testar ping
  const pongPromise = esperarMensagem(piloto, "pong");
  const pingTimestamp = Date.now();
  piloto.ws.send(JSON.stringify({ tipo: "ping", em: pingTimestamp }));
  const pong = await pongPromise;
  assert.strictEqual(pong.tipo, "pong");
  assert.strictEqual(pong.em, pingTimestamp);
  console.log("Ping/Pong: OK");

  // Testar sala cheia: terceira conexão recebe mensagem ou fechamento 4001
  // ENQUANTO piloto e turista ainda estão conectados
  console.log("\nTestando sala cheia...");
  const terceira = await criarConexao(enderecoSala);
  // Enviar "entrar" como o app faria, para acionar o handler
  terceira.ws.send(JSON.stringify({ tipo: "entrar", papel: "piloto", idioma: "pt-BR" }));
  const sinalCheia = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout esperando sinal de sala cheia")), 5000);
    terceira.ws.addEventListener("message", (evento) => {
      try {
        const msg = JSON.parse(evento.data);
        if (msg.tipo === "erro" && msg.motivo === "sala cheia") {
          clearTimeout(timer);
          resolve({ tipo: "mensagem", msg });
        }
      } catch {}
    });
    terceira.ws.addEventListener("close", (evento) => {
      clearTimeout(timer);
      resolve({ tipo: "fechamento", code: evento.code, reason: evento.reason });
    });
  });
  if (sinalCheia.tipo === "mensagem") {
    console.log("Sala cheia recebeu mensagem de erro: OK");
  } else {
    assert.strictEqual(sinalCheia.code, 4001, `Código de fechamento deve ser 4001, recebeu ${sinalCheia.code}`);
    assert.strictEqual(sinalCheia.reason, "sala cheia", "Razão deve ser 'sala cheia'");
    console.log("Sala cheia recebeu código 4001: OK");
  }

  // Fechar conexões
  piloto.ws.close();
  turista.ws.close();
  terceira.ws.close();

  console.log("\nTESTE OK");
}

executarTeste().catch((erro) => {
  console.error("TESTE FALHOU:", erro.message);
  process.exit(1);
});
