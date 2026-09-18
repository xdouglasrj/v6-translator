# Sala - Escuta Aí

Sala de texto em tempo real para dois celulares conversarem em idiomas diferentes.

## Como publicar

1. Instale o Node e o npm
2. Entre na pasta `sala/`
3. Rode `npm install`
4. Faça login na Cloudflare: `npx wrangler login`
5. Publique: `npx wrangler deploy`

## Endereço

Depois de publicar, o Worker fica em:
`https://escuta-ai-sala.SEU_SUBDOMINIO.workers.dev`

Para testar a saúde: `GET /saude` deve retornar `{"ok":true}`

## Como testar

1. Rode `npx wrangler dev` para ambiente local
2. Em outro terminal, rode `node teste.mjs ws://localhost:8787/sala/teste`

## Protocolo

Cada sala aceita no máximo 2 conexões WebSocket. As mensagens são JSON com campo `tipo`:

- `entrar` — identifica papel e idioma
- `fala` — texto traduzido entre os dois lados
- `idioma` — muda o idioma depois de entrar
- `ping` / `pong` — mede atraso
- `presenca` — notifica conexão/desconexão
- `naoentregue` — avisa quando o outro lado não está conectado
- `erro` — mensagem inválida ou grande demais
