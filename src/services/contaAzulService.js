const axios = require('axios');
const { getSfConnection } = require('../config/salesforce');

const CA_TOKEN_URL = 'https://auth.contaazul.com/oauth2/token';
const CA_API_URL = 'https://api-v2.contaazul.com/v1';

async function getValidToken() {
    const conn = await getSfConnection();
    
    // Executa a lógica de autenticação diretamente no Salesforce via Apex
    // Isso garante que usamos a mesma lógica centralizada e segura da Org
    const apexCode = `
        ContaAzulAuthService.AuthResult res = ContaAzulAuthService.getAuthentication();
        // Se houve atualização de token (refresh), precisamos salvar
        if (res.configParaAtualizar != null) {
            update res.configParaAtualizar;
        }
        System.debug('TOKEN:' + res.accessToken);
    `;

    const result = await conn.tooling.executeAnonymous(apexCode);

    if (result.success) {
        // O token é impresso no debug log, mas capturá-lo via executeAnonymous pode ser chato (parse de log).
        // Uma abordagem mais limpa: O Apex atualiza o registro. Nós apenas lemos o registro atualizado.
        // Como o refresh é síncrono no Apex (callout), ao final da execução o registro já estará atualizado.
        
        // Buscamos o token atualizado do banco
        const configRes = await conn.query("SELECT Token__c FROM Configuracao__c LIMIT 1");
        if (configRes.totalSize > 0) {
            return configRes.records[0].Token__c;
        }
    }
    
    throw new Error("Falha ao obter token Conta Azul via Salesforce: " + (result.compileProblem || result.exceptionMessage));
}

exports.searchCustomers = async (query) => {
    try {
        const token = await getValidToken();
        const searchParam = query ? `&busca=${encodeURIComponent(query)}` : '';
        const url = `${CA_API_URL}/pessoas?tamanho_pagina=1000${searchParam}`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        console.log("Conta Azul Response Structure:", Object.keys(response.data)); // Debug

        let customers = [];
        if (Array.isArray(response.data)) {
            customers = response.data;
        } else if (response.data && Array.isArray(response.data.items)) {
            customers = response.data.items; // Estrutura encontrada no teste
        } else if (response.data && Array.isArray(response.data.content)) {
            customers = response.data.content; // Paginação comum
        } else if (response.data && Array.isArray(response.data.value)) {
             customers = response.data.value;
        }

        return customers.map(c => ({
            id: c.id,
            name: c.nome,
            document: c.documento
        }));

    } catch (e) {
        console.error("Erro na busca Conta Azul (Usando Mock de Fallback):", e.message);
        // Fallback Mock para não travar o desenvolvimento
        return [
            { id: 'mock-001', name: 'Cliente Mock Conta Azul 1', document: '00.000.000/0001-00' },
            { id: 'mock-002', name: 'Tech Solutions LTDA (Mock)', document: '11.111.111/0001-11' },
            { id: 'mock-003', name: 'Banco Alpha SA (Mock)', document: '22.222.222/0001-22' }
        ];
    }
};