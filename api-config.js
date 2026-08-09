// ============================================================
// iphotos — Configuração de API e helpers de autenticação
// Incluído em todas as páginas via <script src="api-config.js">
// ============================================================

// ⚠️ ÚNICO LUGAR QUE VOCÊ PRECISA EDITAR ⚠️
// Depois de publicar o backend no Railway, cole a URL pública aqui embaixo
// (ex.: "https://iphotos-backend-production.up.railway.app/api").
// Enquanto estiver vazia/local, o site inteiro continua abrindo normalmente
// (index, login, cadastro, painéis) — só as chamadas de API vão falhar
// mostrando um erro amigável, nada quebra.
const API_URL = window.IPHOTOS_API_URL || "https://iphotos-production.up.railway.app/api";

const AuthStorage = {
  getToken: () => localStorage.getItem('iphotos_token'),
  getNome: () => localStorage.getItem('iphotos_nome_usuario'),
  getPapel: () => localStorage.getItem('iphotos_papel'),
  getAdminToken: () => localStorage.getItem('iphotos_admin_token'),

  salvarSessao(usuario, token) {
    localStorage.setItem('iphotos_token', token);
    localStorage.setItem('iphotos_nome_usuario', usuario.nome);
    localStorage.setItem('iphotos_papel', usuario.papel);
    localStorage.setItem('iphotos_user_id', usuario.id);
  },

  limparSessao() {
    localStorage.removeItem('iphotos_token');
    localStorage.removeItem('iphotos_nome_usuario');
    localStorage.removeItem('iphotos_papel');
    localStorage.removeItem('iphotos_user_id');
  },

  limparSessaoAdmin() {
    localStorage.removeItem('iphotos_admin_token');
  }
};

function headersAutenticados(extra = {}) {
  const token = AuthStorage.getToken();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function headersAdmin(extra = {}) {
  const token = AuthStorage.getAdminToken();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

/**
 * Wrapper de fetch que já injeta o header de autenticação do usuário logado
 * e trata erros de forma padronizada (mostra JSON.erro em alert).
 */
async function apiFetch(caminho, opcoes = {}) {
  const resp = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: headersAutenticados({ 'Content-Type': 'application/json', ...(opcoes.headers || {}) }),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401) {
      AuthStorage.limparSessao();
    }
    throw new Error(dados.erro || 'Erro inesperado ao comunicar com o servidor.');
  }
  return dados;
}

/**
 * Mesma coisa, mas para as rotas /api/admin/* (usa o token do admin).
 */
async function apiFetchAdmin(caminho, opcoes = {}) {
  const resp = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: headersAdmin({ 'Content-Type': 'application/json', ...(opcoes.headers || {}) }),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401) {
      AuthStorage.limparSessaoAdmin();
      window.location.href = 'admin.html';
    }
    throw new Error(dados.erro || 'Erro inesperado ao comunicar com o servidor.');
  }
  return dados;
}

function efetuarLogoutSistema() {
  AuthStorage.limparSessao();
  window.location.href = 'index.html';
}
