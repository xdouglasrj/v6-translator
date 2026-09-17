# V6 Intercom Audio Tester — PRD

## Problem statement
Validar, antes de construir o tradutor completo, se uma voz sintetizada enviada pelo celular chega aos dois intercomunicadores Bluetooth V6 Plus através do compartilhamento de áudio de mídia. A saída deve permanecer mídia (`USAGE_MEDIA`/`STREAM_MUSIC`) e nunca usar áudio de chamada, VoIP, `MODE_IN_COMMUNICATION` ou Bluetooth SCO.

## Architecture
- **Mobile:** Expo SDK 57 + React Native, Android-first, tela única com navegação entre Teste V6 e Diagnóstico.
- **Native audio:** módulo Expo local `modules/v6-media-tts`, envolvendo Android `TextToSpeech` com `AudioAttributes.USAGE_MEDIA`, `CONTENT_TYPE_SPEECH` e `STREAM_MUSIC`.
- **Routing diagnostics:** módulo nativo lê `AudioManager` e exibe rota Bluetooth, dispositivo disponível, tipo de saída, modo, SCO e estado de mídia.
- **Web preview:** fallback visual e `expo-speech` somente na prévia web; no Android sem o módulo nativo o app falha com segurança e não usa TTS potencialmente tratado como comunicação.
- **Backend:** não necessário na Fase 1; não há API ou banco envolvidos.

## User personas
- **Piloto:** precisa de botões grandes, alto contraste e pouca interação durante o passeio.
- **Passageiro/turista:** precisa ouvir a mensagem de teste nos dois V6 Plus para validar o compartilhamento.
- **Pessoa responsável pelo teste técnico:** precisa inspecionar rota, modo e eventos de áudio sem depender de suposições.

## Core requirements (static)
1. Reproduzir a frase exata de teste como mídia.
2. Nunca solicitar microfone ou localização na Fase 1.
3. Nunca solicitar ou ativar chamada, VoIP, `MODE_IN_COMMUNICATION`, `STREAM_VOICE_CALL` ou SCO.
4. Mostrar status Bluetooth e nome da saída quando o Android fornecer.
5. Oferecer Reproduzir Teste, Parar e Repetir.
6. Exibir Diagnóstico de Áudio com `USAGE_MEDIA`, `STREAM_MUSIC`, modo, rota, dispositivo e log temporal.
7. Manter a interface legível, escura, profissional e segura para consulta rápida.

## Implemented
- **2026-09-17:** tema escuro de alto contraste e layout Teste V6 com frase exata, status Bluetooth/saída e controles grandes.
- **2026-09-17:** módulo Android nativo `V6MediaTts` com `AudioAttributes` de mídia, stream musical, callbacks de início/fim/erro e leitura do `AudioManager`.
- **2026-09-17:** permissão Android mínima para Bluetooth (`BLUETOOTH`, `BLUETOOTH_CONNECT`), sem microfone/localização.
- **2026-09-17:** tela Diagnóstico de Áudio, logs de sessão, limpar log e teste de som.
- **2026-09-17:** fallback Android inseguro bloqueado: sem módulo nativo, nenhuma fala é enviada pelo `expo-speech`; a prévia web continua funcional para inspeção visual.
- **2026-09-17:** TypeScript, ESLint, autolinking Expo e fluxo de preview 390×844 validados; relatórios em `test_reports/iteration_1.json` e `iteration_2.json`.
- **2026-09-17:** correção do `build.gradle` do módulo local `v6-media-tts` (adicionado `defaultConfig{versionCode/versionName}` e bloco `publishing{singleVariant('release'){withSourcesJar()}}`) para resolver a falha do EAS: `versionName is not defined` + `SoftwareComponent with name 'release' not found`. Regressão JS validada em `test_reports/iteration_3.json`.

## Prioritized backlog

### P0 — próxima validação obrigatória
- Gerar o APK/dev build com o módulo nativo compilado.
- Instalar em aparelho Android com os dois V6 Plus e compartilhamento de música ativo.
- Confirmar fisicamente que a frase chega aos dois intercomunicadores.
- Registrar no diagnóstico o modo/rota observados durante a reprodução.

### P1 — somente após a confirmação física
- Fase 2: microfone do próprio celular e gravação de 5 segundos.
- Reprodução da gravação sempre como mídia.
- Teste de posição do celular para captar piloto e passageiro.

### P2 — fases posteriores, fora desta entrega
- Speech-to-Text, tradução PT↔EN e TTS modular.
- Push-to-talk, detecção de idioma e detecção de atividade de voz.
- Anti-loop, métricas STT/tradução/TTS, histórico temporário e tratamento de conectividade.
- Foreground Service, notificação persistente e idiomas adicionais.

## Remaining next tasks
1. Compilar o Android fora deste container, que não possui Java/JAVA_HOME.
2. Fazer o teste físico com os dois V6 Plus.
3. Decidir se a arquitetura de mídia está validada antes de iniciar a Fase 2.