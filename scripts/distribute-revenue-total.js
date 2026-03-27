require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function distributeRevenue() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO RATEIO DE RECEITA TOTAL...`);
    try {
        const conn = await getSfConnection();

        // 1. Buscar todos os serviços que têm vínculos com vendas
        const serviceLinks = await conn.query("SELECT Servico__c FROM VendaServico__c GROUP BY Servico__c");
        const serviceIds = serviceLinks.records.map(r => r.Servico__c);

        if (serviceIds.length === 0) {
            console.log("Nenhum serviço com vínculo de venda encontrado.");
            return;
        }

        console.log(`Processando ${serviceIds.length} serviços...`);

        for (const serviceId of serviceIds) {
            // 2. Buscar Receita Total Recebida (Parcelas Pagas deste serviço)
            const revenueRes = await conn.query(`SELECT SUM(Valor__c) total FROM ParcelaFinanceira__c WHERE Servico__c = '${serviceId}' AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')`);
            const totalRevenue = revenueRes.records[0].total || 0;

            // 3. Buscar Lançamentos e Custo Total
            const logs = await conn.query(`SELECT Id, ValorTotalLancamento__c FROM LancamentoHora__c WHERE Servico__c = '${serviceId}'`);
            const totalCost = logs.records.reduce((sum, log) => sum + (log.ValorTotalLancamento__c || 0), 0);

            if (totalRevenue === 0) {
                console.log(`Serviço ${serviceId}: Sem receita recebida. Zerando campos.`);
                if (logs.totalSize > 0) {
                    const updates = logs.records.map(l => ({ Id: l.Id, ValorReceita__c: 0 }));
                    await bulkUpdate(conn, 'LancamentoHora__c', updates);
                }
                continue;
            }

            if (totalCost === 0) {
                console.log(`Serviço ${serviceId}: Receita de ${totalRevenue} disponível, mas sem custos (lançamentos) para ratear.`);
                continue;
            }

            // 4. Calcular e preparar updates
            console.log(`Serviço ${serviceId}: Rateando ${totalRevenue} entre ${logs.totalSize} lançamentos (Custo Total: ${totalCost})`);
            const updates = logs.records.map(log => {
                const cost = log.ValorTotalLancamento__c || 0;
                const share = (totalRevenue * cost) / totalCost;
                return {
                    Id: log.Id,
                    ValorReceita__c: parseFloat(share.toFixed(2))
                };
            });

            // 5. Update em massa
            await bulkUpdate(conn, 'LancamentoHora__c', updates);
        }

        console.log(`\n🏁 RATEIO CONCLUÍDO!`);
    } catch (e) {
        console.error("❌ ERRO NO RATEIO:", e.message);
        process.exit(1);
    }
}

async function bulkUpdate(conn, object, data) {
    const CHUNK = 200;
    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        await conn.sobject(object).update(chunk);
    }
}

distributeRevenue();
