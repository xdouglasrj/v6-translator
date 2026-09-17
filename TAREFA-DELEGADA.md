# Correção pequena e exata. Só isto.

Arquivo: `frontend/src/realtime/session.ts`, função `openSession`.

O aplicativo apanhou este erro da OpenAI no aparelho:
"The Realtime Beta API is no longer supported. Please use /v1/realtime for the GA API."

A causa é o terceiro subprotocolo `openai-beta.realtime-v1`, que pertence à versão beta
já removida. Eu testei a conexão real aqui: com apenas dois subprotocolos
(`realtime` e `openai-insecure-api-key.<credencial>`) o servidor responde
`101 Switching Protocols`, aceita o `session.update` e devolve `session.created` e
`session.updated`, sem nenhum erro.

Faça exatamente isto:
1. Apague a variável `protocol3` e remova esse terceiro item da lista passada ao
   `new WebSocket(...)`, deixando só os dois primeiros.
2. Não mude a URL, o modelo, o `session.update`, os nomes de evento, nem qualquer outra
   coisa do arquivo.

Nada além disso: não reindente, não mexa em outro arquivo, não faça commit, não crie
docs, não faça pergunta.
