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

function esperarMensagem(conexao, tipo, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando "${tipo}"`)), timeoutMs);
    conexao.resolvers[tipo] = (msg) => {
      clearTimeout(timer);
      resolve(msg);
    };
  });
}

async function executarTeste() {
  const audioBuffer = readFileSync(resolve(caminhoAudio));
  const audioBase64 = audioBuffer.toString("base64");

  const ext = caminhoAudio.split(".").pop().toLowerCase();
  const formato = ext === "m4a" || ext === "wav" || ext === "mp3" || ext === "ogg" ? ext : "wav";

  console.log(`Sala: ${salaCodigo}`);
  console.log(`Audio: ${caminhoAudio} (${formato}, ${audioBuffer.length} bytes)`);

  // Conectar turista
  const salaUrl = baseUrl.replace(/^http/, "ws") + `/sala/${salaCodigo}`;
  const turista = await criarConexao(salaUrl);
  console.log("Turista conectado");

  // Turista entra
  turista.ws.send(JSON.stringify({ tipo: "entrar", papel: "turista", idioma: "en" }));

  // Preparar para receber fala
  const falaRecebida = esperarMensagem(turista, "fala");

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
  console.log("Resposta contém original e traduzido: OK");

  // Verificar que turista recebeu fala
  const fala = await falaRecebida;
  assert.strictEqual(fala.tipo, "fala");
  assert.strictEqual(fala.traduzido, dados.traduzido);
  console.log("Turista recebeu fala com traduzido correto: OK");

  turista.ws.close();
  console.log("\nTESTE OK");
}

executarTeste().catch((erro) => {
  console.error("TESTE FALHOU:", erro.message);
  process.exit(1);
});
