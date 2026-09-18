import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Teste de integração: rota /interpretar (transcrição + tradução)
// Uso: node teste-interpretar.mjs <endereco-base> <caminho-audio>
// Exemplo: node teste-interpretar.mjs http://localhost:8787 audio.wav

const baseUrl = process.argv[2];
const caminhoAudio = process.argv[3];

if (!baseUrl || !caminhoAudio) {
  console.error("Uso: node teste-interpretar.mjs <endereco-base> <caminho-audio>");
  console.error("Exemplo: node teste-interpretar.mjs http://localhost:8787 audio.wav");
  process.exit(1);
}

const salaCodigo = "teste-interp-" + Date.now();

function criarConexao(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const mensagens = [];
    const resolvers = {};

    ws.addEventListener("open", () => resolve({ ws, mensagens, resolvers }));

    ws.addEventListener("message", (evento) => {
      try {
        const msg = JSON.parse(evento.data);
        mensagens.push(msg);
        const chave = msg.tipo;
        if (resolvers[chave]) {
          resolvers[chave](msg);
          delete resolvers[chave];
        }
      } catch {}
    });

    ws.addEventListener("error", (e) => reject(e));
  });
}

function esperarMensagemNaLista(mensagens, tipo, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const existente = mensagens.find((m) => m.tipo === tipo);
    if (existente) return resolve(existente);

    const inicio = Date.now();
    const intervalo = setInterval(() => {
      const msg = mensagens.find((m) => m.tipo === tipo);
      if (msg) {
        clearInterval(intervalo);
        resolve(msg);
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        reject(new Error(`Timeout esperando "${tipo}"`));
      }
    }, 50);
  });
}

async function executarTeste() {
  const audioBuffer = readFileSync(resolve(caminhoAudio));
  const audioBase64 = audioBuffer.toString("base64");

  const ext = caminhoAudio.split(".").pop().toLowerCase();
  const formato = ext === "m4a" || ext === "wav" || ext === "mp3" || ext === "ogg" ? ext : "wav";

  console.log(`Sala: ${salaCodigo}`);
  console.log(`Audio: ${caminhoAudio} (${formato}, ${audioBuffer.length} bytes)`);

  // Conectar piloto
  const salaUrl = baseUrl.replace(/^http/, "ws") + `/sala/${salaCodigo}`;
  const piloto = await criarConexao(salaUrl);
  console.log("Piloto conectado");

  piloto.ws.send(JSON.stringify({ tipo: "entrar", papel: "piloto", idioma: "pt-BR" }));

  // Conectar turista
  const turista = await criarConexao(salaUrl);
  console.log("Turista conectado");

  // Turista entra
  turista.ws.send(JSON.stringify({ tipo: "entrar", papel: "turista", idioma: "en" }));

  // POST /interpretar como piloto
  const resp = await fetch(`${baseUrl}/interpretar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sala: salaCodigo,
      papel: "piloto",
      idiomaOrigem: "pt-BR",
      idiomaDestino: "en",
      audioBase64,
      formato,
    }),
  });

  const dados = await resp.json();
  console.log("Resposta /interpretar:", JSON.stringify(dados, null, 2));

  // Verificar resposta
  assert.ok(dados.original, "original deve ser não vazio");
  assert.ok(dados.traduzido, "traduzido deve ser não vazio");
  assert.ok(dados.ms && typeof dados.ms.voz === "number", "ms.voz deve ser número");
  console.log("Resposta contém original, traduzido e ms.voz: OK");

  // Verificar que turista recebeu fala
  const fala = await esperarMensagemNaLista(turista.mensagens, "fala", 10000);
  assert.strictEqual(fala.tipo, "fala");
  assert.strictEqual(fala.traduzido, dados.traduzido);
  console.log("Turista recebeu fala com traduzido correto: OK");

  // Esperar mensagem audio (até 10s)
  const audio = await esperarMensagemNaLista(turista.mensagens, "audio", 10000);
  assert.strictEqual(audio.tipo, "audio");
  assert.strictEqual(audio.formato, "mp3");
  assert.strictEqual(audio.papel, "piloto");
  assert.strictEqual(audio.em, fala.em);
  const audioBytes = Buffer.from(audio.audioBase64, "base64");
  assert.ok(audioBytes.length > 5000, `audio deve ter >5000 bytes, tem ${audioBytes.length}`);
  console.log(`Turista recebeu audio: formato=${audio.formato}, bytes=${audioBytes.length}, ms.voz=${dados.ms.voz}, papel=${audio.papel}`);

  // Verificar que piloto NÃO recebeu audio nem fala
  const pilotoAudio = piloto.mensagens.find((m) => m.tipo === "audio");
  const pilotoFala = piloto.mensagens.find((m) => m.tipo === "fala");
  assert.strictEqual(pilotoAudio, undefined, "piloto não deve receber audio");
  assert.strictEqual(pilotoFala, undefined, "piloto não deve receber fala");
  console.log("Piloto não recebeu audio nem fala: OK");

  piloto.ws.close();
  turista.ws.close();
  console.log("\nTESTE OK");
}

executarTeste().catch((erro) => {
  console.error("TESTE FALHOU:", erro.message);
  process.exit(1);
});
