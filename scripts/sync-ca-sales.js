require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const { getValidToken } = require('../src/services/contaAzulAuth');
const axios = require('axios');

const CA_API_URL = 'https://api-v2.contaazul.com/v1';

async function syncAllSales() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO SINCRONIZAÇÃO TOTAL (ESPELHO CA)...`);
    
    try {
        const token = await getValidToken();
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce e Conta Azul.");

        let page = 1;
        let hasMore = true;
        const allSales = [];

        while (hasMore) {
            console.log(`Buscando página ${page} de vendas...`);
            const response = await axios.get(`${CA_API_URL}/venda/busca?tamanho_pagina=100&pagina=${page}&campo_ordenado_descendente=DATA`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const sales = response.data.itens || response.data || [];
            if (sales.length === 0) hasMore = false;
            else { 
                allSales.push(...sales); 
                page++; 
                if (page > 100) hasMore = false; // Trava de segurança para 10k registros
            }
        }

        console.log(`Total de vendas para processar: ${allSales.length}`);
        const salesToUpsert = allSales.map(s => ({
            IDContaAzul__c: s.id,
            Name: `Venda ${s.numero}`,
            ValorTotal__c: s.valor_total || s.total || s.valor || 0,
            DataEmissao__c: s.data_emissao || s.data,
            Status__c: s.situacao ? s.situacao.nome : 'PENDENTE',
            Cliente__c: s.cliente ? s.cliente.nome : 'N/A'
        }));
        await bulkUpsert(conn, 'VendaContaAzul__c', 'IDContaAzul__c', salesToUpsert);

        console.log("Iniciando sincronização de parcelas...");
        let count = 0;
        for (const sale of allSales) {
            count++;
            if (count % 20 === 0) console.log(`Processando: ${count}/${allSales.length}`);
            try {
                await syncSaleInstallments(conn, token, sale.id);
            } catch (e) {
                console.error(`Erro na venda ${sale.id}:`, e.message);
            }
        }
        console.log(`\n🏁 SINCRONIZAÇÃO CONCLUÍDA!`);
    } catch (e) {
        console.error(`❌ ERRO NO PROCESSO:`, e.message);
        process.exit(1);
    }
}

async function syncSaleInstallments(conn, token, saleId) {
    const saleDetail = await axios.get(`${CA_API_URL}/venda/${saleId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const eventId = saleDetail.data.evento_financeiro ? saleDetail.data.evento_financeiro.id : null;
    if (!eventId) return;

    const response = await axios.get(`${CA_API_URL}/financeiro/eventos-financeiros/${eventId}/parcelas`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const installments = response.data || [];
    if (installments.length === 0) return;

    const installmentsToUpsert = installments.map(p => {
        let finalValue = (p.valor_composicao ? p.valor_composicao.valor_liquido : p.valor) || 0;
        if (p.baixas && p.baixas.length > 0) {
            finalValue = p.baixas.reduce((sum, b) => {
                const val = (b.valor_composicao ? b.valor_composicao.valor_liquido : b.valor_pago) || 0;
                return sum + val;
            }, 0);
        }

        return {
            IDContaAzul__c: p.id,
            VendaContaAzul__r: { IDContaAzul__c: saleId },
            Valor__c: finalValue,
            DataVencimento__c: p.data_vencimento,
            Status__c: p.status, // Status original do CA
            Descricao__c: p.descricao || `Parcela da venda ${saleId}`
        };
    });

    await conn.sobject('ParcelaFinanceira__c').upsert(installmentsToUpsert, 'IDContaAzul__c');
}

async function bulkUpsert(conn, object, externalIdField, data) {
    const CHUNK = 100;
    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        await conn.sobject(object).upsert(chunk, externalIdField);
    }
}

syncAllSales();
