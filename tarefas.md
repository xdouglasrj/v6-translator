# Tarefas — Escuta Aí

Produto: dois aplicativos Android que deixam o piloto e o turista da garupa
conversarem em idiomas diferentes, cada um com seu próprio intercomunicador V6
Plus e seu próprio celular. Cada pessoa ouve, no fone do capacete, só a
tradução do que o outro disse, e lê o mesmo texto na tela.

- `Escuta Aí Piloto` — o celular do Douglas. Tem a conversa e, escondido, o
  diagnóstico.
- `Escuta Aí Turista` — o celular que ele entrega na garupa. Só bandeira,
  conversa e texto.

Os dois celulares são do Douglas, configurados por ele antes do passeio.

## Arquitetura decidida (17/09/2026)

```
piloto fala (pt-BR)
  → V6 do piloto (microfone, perfil de chamada)
  → celular do piloto: detecta fim da fala, transcreve, traduz
  → SALA (só texto) na Cloudflare
  → celular do turista: fala em inglês com a voz do Android e mostra o texto
  → V6 do turista
```
E o caminho inverso, do mesmo jeito. Ninguém aperta botão por frase.

Decisões e o porquê:
- **A sala carrega texto, não voz.** Áudio entre celulares gastaria dados,
  somaria atraso e cairia com sinal fraco de estrada. Texto é minúsculo.
- **Cada celular fala com a IA por conta própria.** Mandar áudio de um aparelho
  para o outro seria mais lento e mais caro.
- **Uma conta só, na OpenRouter** (o Douglas já tem crédito lá): transcrição e
  tradução. A Groq fica como reserva, com o código preparado para trocar.
- **Voz do Android no MVP**, que é gratuita, funciona sem internet e já foi
  validada na Fase 1. Voz natural paga fica para depois, atrás de uma chave.
- **Turnos livres**: qualquer um pode falar a qualquer momento. Travar a vez
  fica como opção para depois, se atrapalhar na prática.
- **Music Sharing sai do desenho.** Ele só era necessário quando um celular
  servia os dois capacetes. Com um V6 por celular, o V6 é um fone com
  microfone comum — e some o conflito que travou o projeto até aqui.

O que sobrevive do trabalho já feito: o módulo nativo Kotlin (voz como mídia,
captura contínua em PCM, diagnóstico de rota), validado no aparelho nas Fases 1
e 2. O que fica só no histórico do Git: as telas de teste das Fases 1 a 4 e a
sessão Realtime da OpenAI (branch `fase4-realtime`, tags
`phase-1-v6-media-validated` e `phase-2-mic-validated`).

## Regras do produto

- Nenhuma chave em código, em arquivo versionado ou no APK. A chave da
  OpenRouter é digitada uma vez em cada celular e guardada no cofre do Android.
- Sem login, sem cadastro, sem pagamento, sem loja de aplicativos.
- A tela do turista nunca mostra ajuste técnico, log ou nome de modelo.
- Idiomas do MVP: português (Brasil), inglês, espanhol e francês.
- Nada de gravação permanente de áudio. O texto da conversa vive só na sessão.

## Ainda não medido (só o teste físico responde)

1. Se o V6 entrega a voz ao celular com o capacete fechado, em cidade e devagar.
2. Se, com o microfone do V6 em uso, a voz do app sai no V6 ou no alto-falante
   do celular — e, se sair errado, qual ajuste de rota corrige.
3. Quanto tempo passa entre a pessoa parar de falar e o outro ouvir a tradução.

---

## [~] 1. Sala de texto na Cloudflare

TAREFA: sala-cloudflare
OBJETIVO: um endereço na internet onde os dois celulares se encontram e trocam
mensagens de texto na hora, funcionando em qualquer lugar com internet móvel.
ARQUIVOS: `sala/` (novo, na raiz do projeto).
REGRAS: Worker com Durable Object, conexão por WebSocket, uma sala fixa por
código combinado; a mensagem carrega quem falou, o idioma de origem, o idioma
de destino e o texto traduzido; nada de áudio; nada de guardar histórico.
CASOS DE BORDA: celular perde o sinal → reconecta sozinho e avisa na tela;
mensagem chega e o outro não está conectado → é descartada, com aviso local.
PRONTO QUANDO: os dois celulares trocam texto pela internet móvel, um fora da
rede do outro, e o texto aparece em menos de 1 segundo.
FORA DE ESCOPO: conta de usuário, várias salas, histórico, áudio.
PENDENTE DO DOUGLAS: criar a conta gratuita na Cloudflare.

## [ ] 2. Motor de conversa no celular

TAREFA: motor-conversa
OBJETIVO: o celular ouve pelo V6, percebe quando a pessoa parou de falar,
transcreve, traduz e manda o texto para a sala; e, ao receber texto da sala,
fala com a voz do Android e mostra na tela.
ARQUIVOS: módulo Kotlin existente (acrescentar o que faltar), mais
`frontend/src/conversa/` (novo).
REGRAS: microfone pelo V6; fim de fala detectado no próprio aparelho por
silêncio, com sensibilidade ajustável; transcrição e tradução pela OpenRouter,
com o provedor trocável; voz pelo mecanismo do Android, como já é feito hoje;
enquanto a voz da IA toca, o microfone do mesmo aparelho é ignorado.
CASOS DE BORDA: fala curta demais → descarta; sem internet → avisa e guarda a
vez; transcrição vazia → não fala nada; erro do provedor → mensagem simples.
PRONTO QUANDO: falando em português no celular A, o celular B fala em inglês, e
o contrário também, com os dois usando V6.
FORA DE ESCOPO: voz paga, biometria de voz, vários idiomas ao mesmo tempo.

## [ ] 3. Tela da conversa (os dois aplicativos)

TAREFA: telas
OBJETIVO: telas grandes, legíveis com capacete, sem interação durante o passeio.
- Turista: escolha do idioma por bandeira (Brasil, Reino Unido, Espanha,
  França), estado da conversa e o texto do que foi dito e traduzido.
- Piloto: o mesmo, mais um acesso escondido ao diagnóstico e à chave.
REGRAS: tema escuro, alto contraste, letras grandes, sem digitação durante o
passeio; a escolha do turista chega ao celular do piloto pela sala.
PRONTO QUANDO: o Douglas entrega o celular ao turista, ele toca na bandeira e a
conversa começa a funcionar sem mais nenhum toque.

## [ ] 4. Dois aplicativos a partir do mesmo código

TAREFA: dois-apps
OBJETIVO: gerar `Escuta Aí Piloto` e `Escuta Aí Turista`, que convivem
instalados sem se confundir (identificadores e ícones diferentes).
PRONTO QUANDO: os dois APKs saem do mesmo build do GitHub e instalam juntos.

## [ ] 5. Sobreviver com a tela apagada

TAREFA: primeiro-plano
OBJETIVO: a conversa continua com o celular no bolso e a tela apagada.
REGRAS: serviço em primeiro plano com notificação e ação de encerrar.
PRONTO QUANDO: 15 minutos de tela apagada sem perder fala nenhuma.

## [ ] 6. Depois do MVP
Voz natural paga como opção; travar a vez se as falas se atropelarem; mais
idiomas; reduzir atraso; microfone por cabo USB-C, se o vento atrapalhar.
