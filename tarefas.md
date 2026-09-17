# Tarefas — V6 AI Voice Bridge

Objetivo: conversar por voz com uma IA (OpenAI / Gemini, provedor trocável) e
ouvir a resposta nos DOIS V6 Plus pelo Music Sharing. Tradução é uma função em
cima disso. Cada fase só começa se o teste físico da anterior passar.

Regra número 1: toda voz do app sai como ÁUDIO DE MÍDIA (`USAGE_MEDIA`), nunca
como chamada (`MODE_IN_COMMUNICATION`, `STREAM_VOICE_CALL`,
`USAGE_VOICE_COMMUNICATION`, SCO forçado, VoIP).
Não fazer: login, cadastro, assinatura, pagamento, painel, landing, perfil,
Play Store. Chave de API nunca dentro do APK.

Como gerar o APK: push na branch `build-android` dispara
`.github/workflows/android-apk.yml` (~25 min); o APK sai como artefato
`v6-app-apk`. A Expo (EAS) também está configurada, mas a fila grátis passa de 40 min.

Histórico de decisões:
- 17/09/2026 — FASE 1 APROVADA: TTS com `USAGE_MEDIA` + `CONTENT_TYPE_SPEECH`
  saiu nos dois V6 Plus (Samsung, teste do Douglas).
- 17/09/2026 — FASE 2 APROVADA: gravação do microfone interno tocada como mídia
  saiu nos dois V6 Plus. Tags: phase-1-v6-media-validated, phase-2-mic-validated.
- Capturar o áudio do app oficial ChatGPT/Gemini: INVIÁVEL. A captura de áudio
  de outros apps só pega áudio de mídia/jogo/desconhecido; a voz desses apps é
  comunicação. Segue com a IA dentro do nosso app.

---

Pontos de volta: tags `phase-1-v6-media-validated` e `phase-2-mic-validated`;
APK da Fase 1 em `_descartavel/apk/fase1-validado.apk`, da Fase 2 em `_descartavel/apk2/`.

## [~] 3. Fase 3 — OpenAI como intérprete de voz (Push To Talk)

TAREFA: fase3-interprete
OBJETIVO: falar segurando um botão e ouvir, nos dois V6, a mesma fala
interpretada no outro idioma (português do Brasil ⇄ inglês), passando por
gravação → OpenAI → voz → áudio de MÍDIA. A IA interpreta, nunca responde.
ARQUIVOS:
- `frontend/src/openai/*` (novo: cliente HTTP, provedor, intérprete)
- `frontend/src/audio/mediaTts.ts` (tocar arquivo de áudio recebido, se preciso)
- `frontend/modules/v6-media-tts/android/.../V6MediaTtsModule.kt` (tocar um
  arquivo de caminho arbitrário como mídia; reaproveitar o player da Fase 2)
- `frontend/app/index.tsx` (área FASE 3)
- nada em `android/` além do que já existe (INTERNET já está no manifesto)

PIPELINE ESCOLHIDO (conferido na documentação da OpenAI em 17/09/2026):
1. Transcrever: `POST https://api.openai.com/v1/audio/transcriptions`,
   multipart com `file` (o m4a da gravação) e `model=gpt-transcribe`.
   A resposta traz `text` e `languages: [{code}]` (vazio quando não há certeza).
2. Interpretar: `POST https://api.openai.com/v1/responses`,
   `model=gpt-5.6-luna`, com a instrução de sistema do dono (abaixo) e o texto
   transcrito. Saída: só a frase interpretada.
3. Gerar voz: `POST https://api.openai.com/v1/audio/speech`,
   `model=gpt-4o-mini-tts`, `voice=alloy`, `response_format=mp3`, salvar em
   cache e tocar pelo caminho de MÍDIA já validado.

INSTRUÇÃO DE SISTEMA (usar este texto):
"You are a live interpreter between Brazilian Portuguese and English. If the
speaker uses Brazilian Portuguese, interpret their speech naturally into
English. If the speaker uses English, interpret their speech naturally into
Brazilian Portuguese. Preserve meaning, intent, questions, numbers, names,
places, prices and relevant tone. Do not answer the speaker's questions. Do
not provide explanations. Do not add information. Do not say that you are
translating. Return only the interpreted utterance."

CHAVE DA OPENAI (decisão do assistente, 17/09/2026): nenhuma chave no código,
no APK ou no Git. O dono digita a chave uma vez na própria tela do app e ela é
guardada em `expo-secure-store` (já instalado), que usa o cofre do Android.
Campo de senha (texto escondido), botão "Salvar chave" e "Apagar chave".
A chave nunca aparece no log, nem em mensagem de erro, nem na tela depois de
salva (mostrar só "sk-…" com os 4 últimos). Para distribuir o app a outras
pessoas no futuro, a chave sai do aparelho e vai para um servidor
intermediário — fora do escopo desta fase.

REGRAS APLICÁVEIS:
- NÃO QUEBRAR as Fases 1 e 2: nenhuma linha alterada no `speak`, `stop`,
  `prepare`, gravação e reprodução da gravação; as duas áreas continuam na tela.
- Saída sempre `USAGE_MEDIA` + `CONTENT_TYPE_SPEECH`, com foco de áudio como na
  Fase 2. PROIBIDO: `startBluetoothSco`, `setCommunicationDevice`, mudar
  `AudioManager.mode`, `STREAM_VOICE_CALL`, `USAGE_VOICE_COMMUNICATION`,
  `AudioSource.VOICE_COMMUNICATION`, microfone Bluetooth.
- Microfone: o interno do celular, como na Fase 2.
- Estados: PRONTO → OUVINDO → PROCESSANDO → TRANSCREVENDO → INTERPRETANDO →
  GERANDO VOZ → REPRODUZINDO → PRONTO. Enquanto reproduz, não aceita gravar.
- Push To Talk: [SEGURE PARA FALAR] (`onPressIn`/`onPressOut`); soltar encerra a
  gravação e dispara o resto sozinho. Sem gravação contínua, sem detecção de voz.
- Na tela, para depuração: idioma detectado, "OUVIDO: …" e "INTERPRETAÇÃO: …".
- Tempos medidos e mostrados: transcrição, IA, voz, total (ms), e no log as
  marcas de início/fim de cada etapa.
- Incerteza: `languages` vazio ou texto vazio → "Não foi possível entender." e
  NÃO gerar voz nenhuma. Nunca inventar frase.
- Sem internet → "Sem conexão com a internet." e volta para PRONTO.
- Erro da OpenAI → mensagem curta na tela, código HTTP no log, sem segredo.
  Nunca derrubar o app.
- Módulos separados: cliente da OpenAI, intérprete (regras/prompt), captura,
  saída de mídia, diagnóstico e máquina de estados em arquivos distintos.

CASOS DE BORDA: chave ausente → a área pede a chave e o botão fica desabilitado;
chave inválida (401) → "Chave recusada pela OpenAI"; gravação de menos de 1 s →
descarta e avisa; soltar o botão depois de sair da tela → cancela; resposta de
voz vazia → erro tratado; web → "Disponível só no APK Android".

PRONTO QUANDO:
1. `node_modules/.bin/tsc --noEmit` sem erro.
2. Busca no código não acha item proibido nem `sk-` literal.
3. `git diff` não toca o código das Fases 1 e 2.
4. Build do GitHub verde e APK baixado.
5. Teste físico do dono: (a) Fases 1 e 2 continuam saindo nos dois V6;
   (b) "Olá, seja bem-vindo ao Rio de Janeiro." → sai em inglês nos dois V6;
   (c) "How long does the tour take?" → sai em português;
   (d) "Where are we going now?" → sai interpretado, não respondido;
   (e) "The tour costs 150 reais." → preserva 150 reais;
   (f) nomes Rocinha, Vidigal, Cristo Redentor, Copacabana, Ipanema preservados.

FORA DE ESCOPO: Gemini, Realtime, microfone sempre aberto, detecção de voz,
palavra de ativação, full duplex, segundo plano, outros idiomas, login,
pagamento, histórico, Play Store, servidor intermediário.


## [ ] 4. Diagnóstico extra
Foco de áudio no painel, estado A2DP, "indisponível" onde a API não dá.

## [ ] 5. Fase 4 — conversa automática
INICIAR/ENCERRAR; estados OUVINDO → FALA DETECTADA → PROCESSANDO → FALANDO;
detecção de voz com sensibilidade ajustável; não mandar a própria voz de volta
para a IA; serviço em primeiro plano com notificação e ação PARAR; retomar após
erro; avisos "Sem conexão" e "Bluetooth desconectado"; avaliar Realtime da
OpenAI para cortar latência.

## [ ] 6. Fase 5 — otimização e distribuição
Latência, ruído, telas para uso na moto, idiomas extras, microfone Bluetooth
experimental, servidor intermediário para a chave da OpenAI sair do aparelho.
