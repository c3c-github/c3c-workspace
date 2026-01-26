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

exports.getSalesByCustomer = async (customerId) => {
    if (!customerId) return [];
    try {
        const token = await getValidToken();
        const url = `${CA_API_URL}/venda/busca?ids_clientes=${customerId}&tamanho_pagina=1000&campo_ordenado_descendente=DATA`; 
        
        const response = await axios.get(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        let sales = [];
        // console.log("CA API Response Keys:", Object.keys(response.data)); // Debug

        if (response.data && response.data.itens && Array.isArray(response.data.itens)) {
            sales = response.data.itens;
        } else if (response.data && Array.isArray(response.data)) {
            sales = response.data;
        }

                return sales.map(s => {
                    const rawStatus = (s.situacao && s.situacao.nome) ? s.situacao.nome : (s.status || 'PENDENTE');
                    // Mapeamento para Title Case ou manter original se a picklist aceitar
                    let displayStatus = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase().replace('_', ' ');
                    
                    // Ajustes finos se necessário para bater com a Picklist
                    if (rawStatus.toUpperCase() === 'EM_ANDAMENTO') displayStatus = 'Em Andamento';
        
                    return {
                        id: s.id,
                        number: s.numero,
                        emissionDate: s.data_emissao || s.data,
                        total: s.valor_total || s.total || 0,
                        status: displayStatus
                    };
                });
    } catch (e) {
        console.error(`Erro ao buscar vendas do cliente ${customerId}:`, e.message);
        if (e.response && e.response.data) {
            console.error("Detalhes do erro Conta Azul:", JSON.stringify(e.response.data, null, 2));
        }
        return [];
    }
};

exports.getSaleInstallments = async (saleId) => {
    if (!saleId) return [];
    try {
        const token = await getValidToken();
        
        // 1. Buscar detalhes da venda para pegar o ID do evento financeiro
        // Endpoint no singular conforme descoberta: /v1/venda/{id}
        const saleUrl = `${CA_API_URL}/venda/${saleId}`;
        const saleResponse = await axios.get(saleUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        let eventId = null;
        if (saleResponse.data && saleResponse.data.evento_financeiro) {
            eventId = saleResponse.data.evento_financeiro.id;
        }

        if (!eventId) {
            console.warn(`Venda ${saleId} não possui evento financeiro vinculado.`);
            return [];
        }

        // 2. Buscar parcelas do evento financeiro
        const installmentsUrl = `${CA_API_URL}/financeiro/eventos-financeiros/${eventId}/parcelas`;
        const response = await axios.get(installmentsUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        // console.log("Installments Raw Response:", JSON.stringify(response.data, null, 2));

        if (response.data && Array.isArray(response.data)) {
            return response.data.map(p => {
                let normalizedStatus = 'Pendente';
                const rawStatus = p.status || '';
                if (['QUITADO', 'PAGO', 'CONFIRMADO'].includes(rawStatus.toUpperCase())) normalizedStatus = 'Pago';
                else if (rawStatus.toUpperCase() === 'VENCIDO') normalizedStatus = 'Atrasado';
                else if (rawStatus.toUpperCase() === 'CANCELADO') normalizedStatus = 'Cancelado';

                return {
                    ...p,
                    status: normalizedStatus,
                    financialEventId: eventId
                };
            });
        } else if (response.data && Array.isArray(response.data.value)) {
             return response.data.value.map(p => {
                let normalizedStatus = 'Pendente';
                const rawStatus = p.status || '';
                if (['QUITADO', 'PAGO', 'CONFIRMADO'].includes(rawStatus.toUpperCase())) normalizedStatus = 'Pago';
                else if (rawStatus.toUpperCase() === 'VENCIDO') normalizedStatus = 'Atrasado';
                else if (rawStatus.toUpperCase() === 'CANCELADO') normalizedStatus = 'Cancelado';

                return { ...p, status: normalizedStatus, financialEventId: eventId };
             });
        }
        
        return [];

    } catch (e) {
        console.error(`Erro ao buscar parcelas da venda ${saleId}:`, e.message);
        if (e.response && e.response.data) {
            console.error("Detalhes do erro Conta Azul (Parcelas):", JSON.stringify(e.response.data, null, 2));
        }
        return [];
    }
};