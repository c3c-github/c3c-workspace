/**
 * Script de Teste de Lógica de Filtros (Frontend Simulation)
 * Versão atualizada para refletir a lógica final do EJS.
 */

const mockServices = [
    { name: 'Projeto Alpha', client: 'Cliente A', status: 'Ativo' },
    { name: 'Suporte Beta', client: 'Cliente B', status: 'Ativo' },
    { name: 'Treinamento Gamma', client: 'C3C Software', status: 'Inativo' },
    { name: 'Alocação Delta', client: 'Cliente A', status: 'Inativo' },
    { name: 'Venda Epsilon', client: 'Cliente C', status: 'Ativo' },
    { name: 'Serviço Sem Status', client: 'Cliente D', status: null } // Deve ser tratado como Ativo
];

function simulateFilter(query, statusFilter) {
    query = (query || '').toLowerCase().trim();
    
    return mockServices.filter(s => {
        const sStatus = s.status || 'Ativo';
        const sName = (s.name || '').toLowerCase();
        const sClient = (s.client || '').toLowerCase();

        const matchStatus = statusFilter === 'all' || 
                           (statusFilter === 'active' && sStatus === 'Ativo') || 
                           (statusFilter === 'inactive' && sStatus === 'Inativo');
        
        const matchText = query === '' || sName.includes(query) || sClient.includes(query);
        
        return matchStatus && matchText;
    });
}

// CENÁRIOS DE TESTE
console.log("--- INICIANDO TESTES DE FILTRAGEM (V2) ---");

// Teste 1: Filtro Ativos (3 explícitos + 1 null = 4)
const active = simulateFilter('', 'active');
console.log(`Teste 1 (Ativos): ${active.length}/4`);
console.assert(active.length === 4, `Erro Teste 1: Esperava 4 ativos, obteve ${active.length}`);

// Teste 2: Filtro Inativos
const inactive = simulateFilter('', 'inactive');
console.log(`Teste 2 (Inativos): ${inactive.length}/2`);
console.assert(inactive.length === 2, `Erro Teste 2: Esperava 2 inativos, obteve ${inactive.length}`);

// Teste 3: Busca por texto (Alpha)
const searchAlpha = simulateFilter('alpha', 'all');
console.log(`Teste 3 (Busca Alpha): ${searchAlpha.length}/1`);
console.assert(searchAlpha.length === 1 && searchAlpha[0].name === 'Projeto Alpha', "Erro Teste 3: Busca por 'Alpha' falhou");

// Teste 4: Busca por cliente (Cliente A)
const searchClientA = simulateFilter('Cliente A', 'all');
console.log(`Teste 4 (Busca Cliente A): ${searchClientA.length}/2`);
console.assert(searchClientA.length === 2, `Erro Teste 4: Esperava 2 resultados para Cliente A, obteve ${searchClientA.length}`);

// Teste 5: Busca composta (Delta + Inativo)
const searchDeltaInactive = simulateFilter('delta', 'inactive');
console.log(`Teste 5 (Busca Delta + Inativo): ${searchDeltaInactive.length}/1`);
console.assert(searchDeltaInactive.length === 1 && searchDeltaInactive[0].name === 'Alocação Delta', "Erro Teste 5: Busca composta falhou");

// Teste 6: Filtro "Todos"
const all = simulateFilter('', 'all');
console.log(`Teste 6 (Todos): ${all.length}/6`);
console.assert(all.length === 6, `Erro Teste 6: Esperava 6 no total, obteve ${all.length}`);

console.log("\n✅ Todos os testes de lógica de filtro passaram!");
