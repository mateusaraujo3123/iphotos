# Guia de integração — conectando o frontend estático a esta API

O frontend hoje usa dados mocados (arrays fixos em `<script>` e
`localStorage`). Abaixo, o mapeamento de **qual endpoint chamar em cada
arquivo**, com o `fetch` pronto pra colar. Defina no topo de cada HTML:

```html
<script>
  const API_URL = "https://SEU-BACKEND.onrender.com/api"; // troque pela URL real
</script>
```

## `login.html`
```js
async function fazerLogin(email, senha) {
  const resp = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha })
  });
  const dados = await resp.json();
  if (!resp.ok) return alert(dados.erro);

  localStorage.setItem('iphotos_token', dados.token);
  localStorage.setItem('iphotos_nome_usuario', dados.usuario.nome);
  localStorage.setItem('iphotos_papel', dados.usuario.papel);
  window.location.href = dados.usuario.papel === 'FOTOGRAFO' ? 'painel-fotografo.html' : 'index.html';
}
```

## `cadastro.html`
```js
async function cadastrar(dados) {
  // dados = { nome, email, senha, papel, whatsapp, chavePix }
  // OBS: não envie mais campo de estado/cidade — removido do backend.
  const resp = await fetch(`${API_URL}/auth/cadastro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados)
  });
  const json = await resp.json();
  if (!resp.ok) return alert(json.erro);
  localStorage.setItem('iphotos_token', json.token);
  localStorage.setItem('iphotos_nome_usuario', json.usuario.nome);
  localStorage.setItem('iphotos_papel', json.usuario.papel);
  window.location.href = json.usuario.papel === 'FOTOGRAFO' ? 'painel-fotografo.html' : 'index.html';
}
```

## `index.html`
Troque `carregarEventosDoServidor()` (hoje um array fixo) por:
```js
async function carregarEventosDoServidor() {
  const resp = await fetch(`${API_URL}/eventos`);
  eventosBD = await resp.json(); // já vem no formato { id, titulo, categoria, local, dataRealizacao, fotoCapaUrl }
  filtrarEventos();
}
```
`verificarStatusLoginHome()` já lê `localStorage.iphotos_nome_usuario` — não
precisa mudar, só garantir que `login.html`/`cadastro.html` gravem essa
chave (feito acima).

## `evento.html`
```js
const params = new URLSearchParams(location.search);
const eventoId = params.get('id'); // ajuste os links do index.html para evento.html?id=...

async function carregarEvento() {
  const resp = await fetch(`${API_URL}/eventos/${eventoId}`);
  const evento = await resp.json();
  // renderize evento.fotos: cada item tem { id, urlPublica, preco }
  // ao clicar "Adicionar ao carrinho", guarde o array de fotoIds selecionados
  // (ex.: em localStorage 'iphotos_carrinho') e mande pra carrinho.html
}
```

## `carrinho.html`
```js
async function finalizarCompra(fotoIds, codigoCupom) {
  const token = localStorage.getItem('iphotos_token');
  const resp = await fetch(`${API_URL}/pedidos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fotoIds, codigoCupom })
  });
  const pedido = await resp.json();
  if (!resp.ok) return alert(pedido.erro);
  // pedido.pixCopiaCola -> exibir no "Pix Copia e Cola"
  // pedido.pixQrCodeBase64 -> <img src="data:image/png;base64,${pedido.pixQrCodeBase64}">
  localStorage.setItem('iphotos_pedido_atual', pedido.id);
  // faça polling em GET /api/pedidos/:id até status virar "PAGO", depois redirecione a sucesso.html
}
```

## `sucesso.html`
```js
async function checarPagamento() {
  const id = localStorage.getItem('iphotos_pedido_atual');
  const token = localStorage.getItem('iphotos_token');
  const resp = await fetch(`${API_URL}/pedidos/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  const pedido = await resp.json();
  if (pedido.status === 'PAGO') { /* mostra confirmação + link pra minhas-compras.html */ }
}
```

## `minhas-compras.html`
```js
async function carregarCompras() {
  const token = localStorage.getItem('iphotos_token');
  const resp = await fetch(`${API_URL}/pedidos`, { headers: { Authorization: `Bearer ${token}` } });
  const pedidos = await resp.json(); // só pedidos PAGO, com itens.foto
}

async function baixarEmAltaResolucao(fotoId) {
  const token = localStorage.getItem('iphotos_token');
  const resp = await fetch(`${API_URL}/pagamentos/fotos/${fotoId}/download`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { url } = await resp.json();
  window.location.href = url; // URL assinada, expira em 5 minutos
}
```

## `painel-fotografo.html`
```js
const token = localStorage.getItem('iphotos_token');

// Criar cobertura
async function criarEvento(dados) {
  // dados = { titulo, categoria, local, dataRealizacao, precoPorFoto }
  const resp = await fetch(`${API_URL}/fotografo/eventos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(dados)
  });
  return resp.json();
}

// Envio de lote (input type="file" multiple, name="fotos")
async function enviarLote(eventoId, arquivos) {
  const form = new FormData();
  [...arquivos].forEach(f => form.append('fotos', f));
  const resp = await fetch(`${API_URL}/fotografo/eventos/${eventoId}/fotos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // NÃO defina Content-Type manualmente com FormData
    body: form
  });
  return resp.json();
}

// Faturamento (já líquido, sem "saldo aguardando")
async function carregarFaturamento() {
  const resp = await fetch(`${API_URL}/fotografo/faturamento`, { headers: { Authorization: `Bearer ${token}` } });
  return resp.json(); // { totalBrutoVendido, taxaComissaoPercentual, totalLiquido, saldoDisponivelParaSaque, ... }
}

// Solicitar saque
async function solicitarSaque(valor) {
  await fetch(`${API_URL}/fotografo/saques`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ valor })
  });
}
```

## `admin.html`
```js
// Login do admin (tela de senha)
async function loginAdmin(senha) {
  const resp = await fetch(`${API_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senha })
  });
  const json = await resp.json();
  if (!resp.ok) return alert(json.erro);
  localStorage.setItem('iphotos_admin_token', json.token);
}

const adminToken = () => localStorage.getItem('iphotos_admin_token');
const headersAdmin = () => ({ Authorization: `Bearer ${adminToken()}` });

// Catálogo de eventos (com Data de Realização)
fetch(`${API_URL}/admin/eventos`, { headers: headersAdmin() });

// Deletar Tudo
fetch(`${API_URL}/admin/eventos/${id}`, { method: 'DELETE', headers: headersAdmin() });

// Roteamento multi-cloud por fotógrafo
fetch(`${API_URL}/admin/fotografos/${id}/provedor-nuvem`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headersAdmin() },
  body: JSON.stringify({ provedorNuvem: 'S3' }) // ou 'R2'
});

// Taxa individual do fotógrafo
fetch(`${API_URL}/admin/fotografos/${id}/taxa`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headersAdmin() },
  body: JSON.stringify({ taxaComissao: 12.5 })
});

// Resetar senha / excluir usuário
fetch(`${API_URL}/admin/usuarios/${id}/resetar-senha`, { method: 'PUT', headers: {...}, body: JSON.stringify({ novaSenha }) });
fetch(`${API_URL}/admin/usuarios/${id}`, { method: 'DELETE', headers: headersAdmin() });

// Cupons
fetch(`${API_URL}/admin/cupons`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headersAdmin() },
  body: JSON.stringify({ codigo: 'BEMVINDO10', tipoDesconto: 'PERCENTUAL', valorDesconto: 10 })
});

// Fila de saques
fetch(`${API_URL}/admin/saques?status=PENDENTE`, { headers: headersAdmin() });
fetch(`${API_URL}/admin/saques/${id}/pagar`, { method: 'PUT', headers: headersAdmin() });
```

---

**Observação importante:** todas as rotas protegidas (`/fotografo/*`,
`/pedidos/*`, `/pagamentos/fotos/:id/download`, `/admin/*`) exigem o header
`Authorization: Bearer <token>`. Se um `fetch` voltar `401`, o token expirou
ou não foi enviado — redirecione para `login.html` (ou peça a senha do admin
de novo).
