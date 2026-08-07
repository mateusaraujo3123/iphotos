// Exemplo prático de como o painel Admin controlará as cores do site
// Quando você criar o banco de dados, você substituirá este objeto pelos dados vindos da sua API
const configuracoesDoPainelAdmin = {
  corPrimaria: "#ea580c",        // Laranja padrão (mude aqui para testar outra cor)
  corPrimariaHover: "#c2410c",   // Laranja escuro do hover
  corFundoTopo: "#121212",       // Cor do Menu
  corTextoTopo: "#ffffff"        // Letra do Menu
};

// Função que lê os dados do Admin e altera o CSS globalmente
function aplicarTemaDoAdmin(config) {
  const root = document.documentElement;
  
  if(config.corPrimaria) root.style.setProperty('--cor-primaria', config.corPrimaria);
  if(config.corPrimariaHover) root.style.setProperty('--cor-primaria-hover', config.corPrimariaHover);
  if(config.corFundoTopo) root.style.setProperty('--cor-topo-fundo', config.corFundoTopo);
  if(config.corTextoTopo) root.style.setProperty('--cor-topo-texto', config.corTextoTopo);
}

// Executa a aplicação do tema assim que a página carrega
window.addEventListener('DOMContentLoaded', () => {
  aplicarTemaDoAdmin(configuracoesDoPainelAdmin);
});
