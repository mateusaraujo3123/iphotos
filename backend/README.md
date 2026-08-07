# iphotos — Backend

API, banco de dados, upload/processamento de imagens e pagamentos Pix da
plataforma **iphotos**. Este backend foi construído para ser consumido pelo
frontend estático já existente (`index.html`, `evento.html`, `admin.html` etc.)
hospedado no GitHub Pages.

## Stack escolhida (e por quê)

| Camada | Escolha | Motivo |
|---|---|---|
| Servidor | Node.js + Express | Simples, rápido de hospedar de graça (Render/Railway) e ótimo suporte a upload de arquivos |
| Banco de dados | PostgreSQL + Prisma ORM | Relacional (o domínio tem muitas relações: usuário → evento → foto → pedido), plano gratuito em Neon/Supabase/Railway |
| Storage de fotos | Cloudflare R2 **e/ou** Amazon S3 | R2 não cobra egress (baratíssimo para servir fotos pesadas); S3 fica disponível como alternativa por fotógrafo (roteamento multi-cloud pedido no briefing) |
| Compressão + marca d'água | Sharp | Biblioteca nativa mais rápida para processar imagem em Node |
| Pagamento Pix | Mercado Pago (Payments API) | Provedor mais usado no Brasil, aceita CPF, gera Pix copia-e-cola + QR Code prontos via API, webhook de confirmação |
| Autenticação | JWT (jsonwebtoken + bcryptjs) | Sem estado no servidor, fácil de escalar horizontalmente |
| Job agendado | node-cron | Roda a exclusão automática de eventos com 30+ dias sem precisar de infra extra |

## Modelo de dados (resumo das entidades)

```
Usuario (CLIENTE | FOTOGRAFO)
  ├─ provedorNuvem (S3 | R2)          -> roteamento multi-cloud individual
  ├─ taxaComissao (%)                 -> comissão da plataforma, editável por fotógrafo
  └─ chavePix / whatsapp

Evento (pertence a 1 Fotografo)
  ├─ categoria, local, dataRealizacao
  ├─ expiraEm = criadoEm + 30 dias    -> apagado pelo cron
  └─ Foto[] (1:N)

Foto
  ├─ chaveOriginal   -> objeto no bucket PRIVADO (alta resolução, nunca exposto)
  └─ urlPublica      -> objeto no bucket PÚBLICO (comprimido + marca d'água)

Pedido (pertence a 1 Cliente)
  ├─ status: PENDENTE | PAGO | EXPIRADO | CANCELADO
  ├─ cupomId?, descontoValor
  ├─ pixTxId, pixCopiaCola, pixQrCodeBase64
  └─ ItemPedido[] -> cada item aponta pra 1 Foto comprada

Cupom
  └─ tipoDesconto: PERCENTUAL | VALOR_FIXO

SolicitacaoSaque (pertence a 1 Fotografo)
  └─ status: PENDENTE | PAGO | RECUSADO   -> fila que o admin liquida

ConfiguracaoPlataforma (singleton) -> taxa base padrão, cor do tema
```

Veja o diagrama completo e comentado em `prisma/schema.prisma`.

## Como as regras de negócio do briefing foram implementadas

1. **Compressão + marca d'água** — `src/utils/watermark.js` usa Sharp para
   redimensionar e estampar um padrão de marca-d'água em diagonal (SVG
   composto sobre o JPEG). O original nunca é tocado: ele vai intacto para o
   bucket privado (`src/config/storage.js → salvarOriginalPrivado`), e só a
   versão processada vai para o bucket público
   (`salvarPublico`), que é a única exibida em `evento.html`.

2. **Pagamento e liberação** — `POST /api/pedidos` gera a cobrança Pix real
   via Mercado Pago. O webhook (`POST /api/pagamentos/webhook`) confirma o
   pagamento e marca o Pedido como `PAGO`, liberando automaticamente as fotos
   em `minhas-compras.html`. O botão "Baixar em Alta Resolução" chama
   `GET /api/pagamentos/fotos/:id/download`, que só responde 200 se o pedido
   estiver pago, e devolve uma URL assinada (S3/R2 `getSignedUrl`) válida por
   5 minutos.

3. **Saques sem saldo bloqueado** — `GET /api/fotografo/faturamento` soma
   tudo que já foi vendido (`status: PAGO`) e desconta a `taxaComissao`
   individual na hora — não existe estado de "aguardando liberação".
   `POST /api/fotografo/saques` entra na fila que o admin vê em
   `GET /api/admin/saques` e libera manualmente (o corte das 22h é
   operacional: o admin roda a liquidação nesse horário; se quiser
   automatizar 100%, dá pra acoplar isso a outro `node-cron`).

4. **Moderação e multi-cloud** — `DELETE /api/admin/eventos/:id` apaga o
   registro (cascade no Prisma remove Fotos e ItensPedido) e chama
   `excluirObjetos` para apagar fisicamente os binários no provedor certo.
   `PUT /api/admin/fotografos/:id/provedor-nuvem` troca o campo
   `provedorNuvem` do fotógrafo — o próximo upload dele já é roteado pro
   bucket escolhido (S3 ou R2), lido dinamicamente em
   `enviarLoteFotos` (`photographerController.js`).
   A expiração de 30 dias roda em `src/jobs/expirationCron.js` (cron diário
   às 03h).

5. **Sessão dinâmica** — `POST /api/auth/login` e `/cadastro` devolvem um
   JWT com o nome real do usuário. O frontend deve salvar esse JWT (ex.:
   `localStorage`) e usá-lo pra decidir se mostra "Login" ou "Olá, Fulano 👋"
   — ver `API_INTEGRATION.md` para o trecho de código exato.

### Itens extras pedidos depois

- **Senha do painel admin**: login único por senha (`ADMIN_PASSWORD` no
  `.env`) em `POST /api/admin/login`, que devolve um JWT separado
  (`ADMIN_JWT_SECRET`) usado em todas as rotas `/api/admin/*`.
- **Cupons de desconto**: CRUD completo em `/api/admin/cupons`, aplicados no
  carrinho via `POST /api/pedidos` (campo `codigoCupom`).
- **Taxa individual por fotógrafo**: campo `taxaComissao` no model
  `Usuario`, editável em `PUT /api/admin/fotografos/:id/taxa`.
- **Campo de localização removido do cadastro de fotógrafo**: o model
  `Usuario` não tem campo de estado/cidade — o cadastro
  (`POST /api/auth/cadastro`) só aceita nome, email, senha, WhatsApp e Chave
  Pix.

## Rodando localmente

```bash
cd backend
cp .env.example .env       # preencha DATABASE_URL, JWT secrets, credenciais de nuvem e do Mercado Pago
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                 # http://localhost:3000
```

## Deploy sugerido (barato/gratuito)

1. **Banco**: crie um Postgres gratuito em [neon.tech](https://neon.tech) ou
   [railway.app](https://railway.app) e cole a `DATABASE_URL` no `.env`.
2. **Storage**: crie 2 buckets no [Cloudflare R2](https://dash.cloudflare.com)
   (`iphotos-originais` privado e `iphotos-publico` com acesso público via
   R2.dev ou domínio customizado). Se algum fotógrafo específico for usar
   S3, crie os buckets equivalentes na AWS.
3. **Pix**: crie uma conta em
   [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers),
   gere um Access Token de produção e cole em `MERCADOPAGO_ACCESS_TOKEN`.
4. **Servidor**: suba este backend no [Render](https://render.com) ou
   [Railway](https://railway.app) (ambos têm plano free/hobby, build
   automático a partir do GitHub, e suportam `node-cron` rodando 24h).
5. No frontend (GitHub Pages), aponte todas as chamadas `fetch` para a URL
   pública do backend (ex.: `https://iphotos-backend.onrender.com/api`).

## Segurança

- Senhas de usuário sempre com `bcrypt` (hash, nunca texto puro).
- Buckets privados devem ter "Block Public Access" habilitado no provedor —
  o backend só os acessa via credenciais de servidor + URLs assinadas.
- Rotas administrativas exigem um JWT separado, emitido só após a senha
  master bater.
- Troque **todos** os segredos do `.env.example` antes de ir pra produção.
