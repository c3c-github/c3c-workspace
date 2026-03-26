require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');
const { getValidToken } = require('../src/services/contaAzulAuth');
const axios = require('axios');

const CA_API_URL = 'https://api-v2.contaazul.com/v1';

async function syncAllSales() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO SINCRONIZAÇÃO TOTAL DE VENDAS...`);
    
    try {
        const token = await getValidToken();
        const conn = await getSfConnection();

        // 1. Buscar todas as vendas do Conta Azul (paginado)
        let page = 1;
        let hasMore = true;
        const allSales = [];

        while (hasMore) {
            console.log(`Buscando página ${page} de vendas...`);
            const response = await axios.get(`${CA_API_URL}/venda/busca?tamanho_pagina=100&pagina=${page}&campo_ordenado_descendente=DATA`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            const sales = response.data.itens || response.data || [];
            if (sales.length === 0) {
                hasMore = false;
            } else {
                allSales.push(...sales);
                page++;
                if (page > 50) hasMore = false; // Trava de segurança para 5000 registros
            }
        }

        console.log(`Total de vendas encontradas no Conta Azul: ${allSales.length}`);

        // 2. Upsert de Vendas
        const salesToUpsert = allSales.map(s => ({
            IDContaAzul__c: s.id,
            Name: `Venda ${s.numero}`,
            ValorTotal__c: s.valor_total || s.total || 0,
            DataEmissao__c: s.data_emissao || s.data,
            Status__c: s.situacao ? s.situacao.nome : 'PENDENTE'
        }));

        console.log("Realizando upsert de vendas no Salesforce...");
        await bulkUpsert(conn, 'VendaContaAzul__c', 'IDContaAzul__c', salesToUpsert);

        // 3. Sincronizar Parcelas de todas as vendas
        console.log(`Sincronizando parcelas de ${allSales.length} vendas...`);
        let count = 0;
        for (const sale of allSales) {
            count++;
            if (count % 10 === 0) console.log(`Processando parcelas: ${count}/${allSales.length}`);
            try {
                await syncSaleInstallments(conn, token, sale.id);
            } catch (e) {
                console.error(`Erro na venda ${sale.id}:`, e.message);
            }
        }

        console.log(`\n🏁 SINCRONIZAÇÃO CONCLUÍDA!`);
    } catch (e) {
        console.error(`❌ ERRO:`, e.message);
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

    const installmentsToUpsert = installments.map(p => ({
        IDContaAzul__c: p.id,
        VendaContaAzul__r: { IDContaAzul__c: saleId },
        Valor__c: p.valor || 0,
        DataVencimento__c: p.data_vencimento,
        Status__c: p.status,
        Descricao__c: p.descricao || `Parcela da venda ${saleId}`,
        IDEventoFinanceiro__c: eventId
    }));

    await conn.sobject('ParcelaFinanceira__c').upsert(installmentsToUpsert, 'IDContaAzul__c');
}

async function bulkUpsert(conn, object, externalIdField, data) {
    const CHUNK = 200;
    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        await conn.sobject(object).upsert(chunk, externalIdField);
    }
}

syncAllSales();
