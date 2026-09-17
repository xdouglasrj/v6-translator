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
- Capturar o áudio do app oficial ChatGPT/Gemini: INVIÁVEL. A captura de áudio
  de outros apps só pega áudio de mídia/jogo/desconhecido; a voz desses apps é
  comunicação. Segue com a IA dentro do nosso app.

---

## [~] 1. Fase 2 — microfone do celular

TAREFA: teste-microfone
OBJETIVO: gravar 5 s pelo microfone do próprio celular e tocar a gravação como
mídia, provando que usar o microfone não derruba o compartilhamento nos dois V6.
ARQUIVOS: `frontend/modules/v6-media-tts/android/.../V6MediaTtsModule.kt`
(gravar e tocar), `frontend/app/index.tsx` (terceira aba "Microfone"),
`frontend/app.json` (permissão `RECORD_AUDIO`).
REGRAS APLICÁVEIS:
- Gravação com `MediaRecorder`/`AudioRecord` na fonte `MIC` (microfone do
  celular); proibido `VOICE_COMMUNICATION`, `startBluetoothSco`,
  `setCommunicationDevice`, mudar `AudioManager.mode`.
- Reprodução com `MediaPlayer` + `AudioAttributes` `USAGE_MEDIA`.
- Arquivo em pasta de cache do app, apagado ao gravar de novo e ao sair; nada
  guardado para sempre.
- Aviso antes de pedir permissão: "O aplicativo usa o microfone para gravar um
  teste de 5 segundos. A gravação fica só no celular e é apagada depois."
- Diagnóstico registra no log com horário: início/fim da gravação, modo do
  AudioManager antes e depois, rota de saída antes e depois.
TELA: "TESTE DE MICROFONE" · "Microfone selecionado: CELULAR" · botão
[GRAVAR 5 SEGUNDOS] (contagem regressiva) · botão [REPRODUZIR GRAVAÇÃO]
(desabilitado sem gravação) · [PARAR].
CASOS DE BORDA: permissão negada → mensagem e botão para abrir as
configurações; gravar durante reprodução → para a reprodução antes; app sai
de cena durante gravação → cancela e apaga.
PRONTO QUANDO: build no GitHub verde; no código não existe nenhum dos itens
proibidos (conferido por busca); APK instalado grava e toca; o log mostra o
modo `MODE_NORMAL` antes e depois; Douglas confirma que a gravação sai nos
dois V6.
FORA DE ESCOPO: microfone Bluetooth, reconhecimento de fala, IA.

## [ ] 2. Diagnóstico real mais completo
Falta: foco de áudio, aviso com horário quando a rota muda (antes/depois),
estado A2DP, "indisponível" onde a API não dá. Útil para a Fase 2 se algo mudar.

## [ ] 3. Fase 3 — IA por botão (Push To Talk)
SEGURE PARA FALAR → reconhecimento → IA (resposta curta) → voz como mídia.
Provedor trocável (OpenAI / Gemini). Chave fora do APK (servidor intermediário).
Medir tempos: captura, reconhecimento, IA, voz, total.
Pendente de decisão do Douglas: primeiro provedor e onde fica a chave.

## [ ] 4. Fase 4 — conversa automática
INICIAR/ENCERRAR; estados OUVINDO → FALA DETECTADA → PROCESSANDO → FALANDO;
detecção de voz com sensibilidade ajustável; não mandar a própria voz de volta
para a IA; serviço em primeiro plano com notificação e ação PARAR; retomar após
erro; avisos "Sem conexão" e "Bluetooth desconectado".

## [ ] 5. Fase 5 — tradução e otimização
Modo tradutor (idioma A ⇄ B, automático/manual), idiomas extras, latência,
ruído, telas para uso na moto, microfone Bluetooth experimental.
