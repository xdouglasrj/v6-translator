# Tarefas — V6 Intercom Audio Tester

Objetivo da fila: ter o app instalado no celular Android do Douglas para testar
áudio e Bluetooth com o intercomunicador V6 Plus.

Decisão (17/09/2026): o app é gerado na nuvem da Expo (EAS Build), perfil de
teste interno (APK), não no computador local — a máquina não tem Android SDK e
só tem Java 8.

---

## [>] 1. Login na Expo (depende do Douglas)

TAREFA: login-expo
OBJETIVO: a máquina fica autenticada numa conta Expo do Douglas.
ARQUIVOS: nenhum.
REGRAS APLICÁVEIS: credencial é do dono; o assistente não digita senha nem cria conta.
CASOS DE BORDA: Douglas sem conta — ele cria em expo.dev (gratuita).
PRONTO QUANDO: `npx eas-cli whoami` (em `frontend/`) imprime o usuário dele.
FORA DE ESCOPO: plano pago da Expo.

Passo do Douglas: rodar `npx eas-cli login` num terminal e entrar com a conta.

## [>] 2. Configurar o build Android de teste

TAREFA: config-eas
OBJETIVO: o projeto passa a ter configuração de build que gera APK instalável direto no celular.
ARQUIVOS: `frontend/eas.json` (novo), `frontend/app.json` (recebe `extra.eas.projectId` via `eas init`).
REGRAS APLICÁVEIS: perfil `preview` com `"distribution": "internal"` e `"android": { "buildType": "apk" }`. Não mudar `android.package` (`com.emergent.v6intercomtester`).
CASOS DE BORDA:
- `package.json` tem `preinstall: ./scripts/cmd-guard.js`; se falhar no servidor da Expo, o build quebra — verificar se o arquivo existe e roda em Linux; se não existir, remover o `preinstall`.
- Existe a pasta `frontend/android` versionada: a Expo usa ela em vez de gerar uma nova. O módulo nativo `modules/v6-media-tts` precisa estar ligado nela.
- Falta `yarn.lock` no repositório original (foi gerado agora na instalação) — commitar junto para o servidor instalar as mesmas versões.
PRONTO QUANDO: `npx eas-cli build:configure` e `npx eas-cli init` terminam sem erro e `eas.json` tem o perfil `preview` acima.
FORA DE ESCOPO: iOS, publicação na Play Store, atualizar pacotes do Expo.

## [>] 3. Gerar o APK na nuvem

TAREFA: build-apk
OBJETIVO: existe um link de download do APK.
ARQUIVOS: nenhum.
REGRAS APLICÁVEIS: fila gratuita da Expo pode demorar; não trocar de caminho por demora.
CASOS DE BORDA: build falha no Gradle — o relatório de teste antigo (`test_reports/iteration_3.json`) já cita erro de `versionName` e `singleVariant('release')` em `frontend/modules/v6-media-tts/android/build.gradle`; conferir primeiro ali. Falha vira tarefa nova na fila, com o trecho do log.
PRONTO QUANDO: `npx eas-cli build -p android --profile preview` termina com status `finished` e imprime o link do APK.
FORA DE ESCOPO: consertar código do app além do necessário para compilar.

## [>] 4. Instalar e testar no celular (Douglas)

TAREFA: teste-celular
OBJETIVO: Douglas confirma se o áudio sai pelo V6 Plus.
ARQUIVOS: nenhum.
CASOS DE BORDA: Android bloqueia instalação — liberar "instalar apps desconhecidos" para o navegador.
PRONTO QUANDO: Douglas abre o link no celular, instala, abre o app e reporta, para cada botão (Tocar teste, Parar, Repetir, Diagnóstico, Limpar log), se funcionou, e o que a tela mostra no cartão Bluetooth com o V6 Plus pareado.
FORA DE ESCOPO: consertar o que falhar — cada falha vira tarefa nova.
