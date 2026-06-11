require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function checkVirtualRevenue() {
    try {
        const conn = await getSfConnection();
        const start = '2025-01-01';
        const end = '2025-12-31';

        // 1. Identificar Vendas com Execução (Ativas)
        const activeSalesRes = await conn.query(`
            SELECT Venda__c FROM VendaServico__c 
            WHERE Servico__c IN (SELECT Servico__c FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= ${start} AND DiaPeriodo__r.Data__c <= ${end})
            GROUP BY Venda__c
        `).execute();
        const activeSalesIds = new Set((activeSalesRes.records || activeSalesRes).map(r => r.Venda__c));

        // 2. Buscar Parcelas do Período
        const installmentsRes = await conn.query(`
            SELECT Id, Valor__c, VendaContaAzul__c, VendaContaAzul__r.Name
            FROM ParcelaFinanceira__c 
            WHERE DataVencimento__c >= ${start} AND DataVencimento__c <= ${end}
            AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
        `).execute({ autoFetch: true });
        const installments = Array.isArray(installmentsRes) ? installmentsRes : (installmentsRes.records || []);

        // 3. Buscar Vínculos
        const linksRes = await conn.query("SELECT Venda__c, Servico__c, Servico__r.Name FROM VendaServico__c").execute({ autoFetch: true });
        const links = Array.isArray(linksRes) ? linksRes : (linksRes.records || []);
        const saleToLinks = new Map();
        links.forEach(l => {
            if (!saleToLinks.has(l.Venda__c)) saleToLinks.set(l.Venda__c, []);
            saleToLinks.get(l.Venda__c).push(l);
        });

        console.log('\n--- DETALHAMENTO DE RECEITA VIRTUAL (NÃO DISTRIBUÍDA AOS LOGS) ---');
        const summary = [];
        installments.forEach(p => {
            if (activeSalesIds.has(p.VendaContaAzul__c)) return;

            const lks = saleToLinks.get(p.VendaContaAzul__c) || [];
            summary.push({
                venda: p.VendaContaAzul__r ? p.VendaContaAzul__r.Name : '?',
                valor: p.Valor__c,
                servicos: lks.map(l => l.Servico__r.Name).join(', ') || 'SEM VÍNCULO'
            });
        });

        summary.sort((a,b) => b.valor - a.valor);
        summary.slice(0, 20).forEach(s => {
            console.log(`- R$ ${s.valor.toLocaleString('pt-BR')} | ${s.venda} | Serviços: ${s.servicos}`);
        });

    } catch (e) { console.error(e); }
}
checkVirtualRevenue();
