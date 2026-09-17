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

Ponto de volta: tag local `phase-1-v6-media-validated` (commit `5b1ba19`) e
cópia do APK validado em `_descartavel/apk/fase1-validado.apk`.

## [~] 1. Fase 2 — microfone interno sem quebrar o áudio dos dois V6

TAREFA: fase2-microfone
OBJETIVO: gravar 5 s pelo microfone INTERNO do Samsung e tocar a gravação como
mídia, provando que usar o microfone não derruba o Music Sharing. Junto, o
diagnóstico passa a mostrar a rota real antes/durante/depois, para achar o
momento exato de uma eventual troca.
ARQUIVOS:
- `frontend/modules/v6-media-tts/android/src/main/java/expo/modules/v6mediatts/V6MediaTtsModule.kt`
  (gravar, tocar, diagnóstico, eventos de rota)
- `frontend/modules/v6-media-tts/src/*` (tipos/ponte JS do módulo, se existirem)
- `frontend/app/index.tsx` (nova área FASE 2 e campos novos do diagnóstico)
- `frontend/app.json` (permissão `RECORD_AUDIO`)
- `frontend/android/app/src/main/AndroidManifest.xml` (mesma permissão; a
  pasta `android` é versionada e o build usa ela, não o `app.json`)

REGRAS APLICÁVEIS:
- NÃO QUEBRAR A FASE 1. O `speak`/`stop`/`prepare` e o botão REPRODUZIR TESTE
  ficam como estão (mesmo `USAGE_MEDIA` + `CONTENT_TYPE_SPEECH` +
  `STREAM_MUSIC`). Nada de redesenho de tela.
- Microfone: `MediaRecorder` com `AudioSource.MIC`; em Android 6+ escolher o
  microfone interno com `setPreferredDevice(TYPE_BUILTIN_MIC)` quando existir.
- PROIBIDO no código: `startBluetoothSco`, `setBluetoothScoOn`,
  `setCommunicationDevice`, `setMode(`/`mode =`, `MODE_IN_COMMUNICATION`
  (exceto como rótulo de leitura), `STREAM_VOICE_CALL`,
  `USAGE_VOICE_COMMUNICATION`, `AudioSource.VOICE_COMMUNICATION`, escolher o
  V6 como entrada.
- Reprodução: `MediaPlayer` com `AudioAttributes` `USAGE_MEDIA` +
  `CONTENT_TYPE_SPEECH`, pedindo foco de áudio `AUDIOFOCUS_GAIN_TRANSIENT`
  com os mesmos atributos e devolvendo ao fim.
- Sequencial, sem full duplex. Estados: IDLE → RECORDING (5 s, para sozinho)
  → RECORDED → PLAYING_MEDIA → COMPLETED. Gravar com reprodução ativa para a
  reprodução antes.
- Arquivo só no cache privado do app (`cacheDir`), um arquivo só, substituído
  ao gravar de novo. Nada permanente.
- Permissão: só `RECORD_AUDIO` nova. Nenhuma outra (localização, arquivos,
  contatos, telefone, SMS). Antes do pedido, aviso: "O aplicativo usa o
  microfone para gravar um teste de 5 segundos. A gravação fica só no celular
  e é substituída na próxima."
- Diagnóstico real (o que a API não der → "indisponível", nunca inventar):
  - ANTES da gravação: `AudioManager.mode`, entradas disponíveis, saídas
    disponíveis, rota de saída atual, Bluetooth relevante, SCO.
  - AO INICIAR: horário, entrada realmente usada
    (`AudioRecordingConfiguration`/`MediaRecorder.getRoutedDevice` quando
    houver), mode, rota.
  - AO PARAR: horário, arquivo criado, duração, rota.
  - ANTES DE TOCAR: mode, rota, atributos usados, resultado do pedido de foco.
  - DURANTE: início/fim do player; troca de rota.
  - Troca de rota detectada por `AudioDeviceCallback` → linha "ROUTE CHANGE
    DETECTED · Antes: X · Agora: Y" com horário, em qualquer momento.
- Log visual no formato `HH:MM:SS - texto`, em português simples na frente e o
  nome técnico entre parênteses.

TELA (acrescentar, sem redesenhar):
```
FASE 1 · TESTE DE MÍDIA      [REPRODUZIR TESTE]  (o que já existe)
FASE 2 · TESTE DO MICROFONE
MICROFONE: Interno do celular
GRAVAÇÃO: Nenhuma / Gravando 3s… / Pronta
SAÍDA: Media
ROTA: <dado real>
[GRAVAR 5 SEGUNDOS]  (vira [GRAVAR NOVAMENTE] depois da primeira)
[REPRODUZIR GRAVAÇÃO] (desabilitado sem gravação)
[PARAR]
```

CASOS DE BORDA:
- Permissão negada → mensagem e botão para abrir as configurações do app.
- Negada com "não perguntar de novo" → mesmo botão, sem novo pedido.
- Celular sem `TYPE_BUILTIN_MIC` listado → grava com `MIC` padrão e registra
  "microfone interno não identificado".
- Entrada usada acaba sendo Bluetooth → registrar em destaque (resultado D).
- App vai para segundo plano durante gravação → cancela e apaga o arquivo.
- Foco de áudio negado → registra e não toca.
- Web (preview) → módulo nativo ausente; área mostra "só no Android".

PRONTO QUANDO:
1. Build do GitHub (`build-android`) verde e APK baixado; caminho informado.
2. Busca no código não acha nenhum item PROIBIDO fora de rótulo de leitura.
3. Diff não altera o caminho do `speak` da Fase 1 (conferido na leitura).
4. Manifesto do APK gerado tem `RECORD_AUDIO` e nenhuma permissão nova além dela.
5. Versão web abre sem erro e mostra as duas áreas.
6. Status final reportado como: IMPLEMENTAÇÃO CONCLUÍDA · BUILD CONCLUÍDO ·
   APK GERADO · AGUARDANDO TESTE FÍSICO.
7. Teste físico do Douglas, nesta ordem: (a) Fase 1 de novo nos dois V6;
   (b) gravar "Teste do microfone. Um, dois, três."; (c) reproduzir.
   Resultado A = aprovada. B (depois do microfone sai só em um V6), C (muda
   ao começar a gravar) ou D (não usou o microfone interno) → investigar com
   o log, sem mascarar.

FORA DE ESCOPO: IA (OpenAI, ChatGPT, Gemini), tradução, reconhecimento de fala,
Realtime, conversa contínua, detecção de voz, full duplex, microfone Bluetooth,
Fase 3.

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
