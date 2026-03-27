require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function distributeRevenue() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO RATEIO DE RECEITA PONDERADO...`);
    try {
        const conn = await getSfConnection();

        // 1. Buscar todos os serviços que têm vínculos com vendas
        const serviceLinks = await conn.query("SELECT Servico__c FROM VendaServico__c GROUP BY Servico__c");
        const serviceIds = serviceLinks.records.map(r => r.Servico__c);

        if (serviceIds.length === 0) {
            console.log("Nenhum serviço com vínculo de venda encontrado.");
            return;
        }

        for (const serviceId of serviceIds) {
            console.log(`\nProcessando Serviço: ${serviceId}`);

            // 2. Calcular Receita Total Efetiva do Serviço baseada no VendaServico__c
            // Precisamos saber quanto de cada venda pertence a este serviço
            const junctionRes = await conn.query(`
                SELECT Venda__c, Venda__r.ValorTotal__c, ValorAlocado__c 
                FROM VendaServico__c 
                WHERE Servico__c = '${serviceId}'
            `);

            let totalEffectiveRevenue = 0;

            for (const link of junctionRes.records) {
                const vendaId = link.Venda__c;
                const totalVenda = link.Venda__r.ValorTotal__c || 0;
                const valorAlocadoAoServico = link.ValorAlocado__c || 0;

                if (totalVenda === 0) continue;

                // Percentual da venda que pertence a este serviço
                const percentualAlocacao = valorAlocadoAoServico / totalVenda;

                // Somar quanto já foi pago desta venda (parcelas liquidadas)
                const paidRes = await conn.query(`
                    SELECT SUM(Valor__c) total 
                    FROM ParcelaFinanceira__c 
                    WHERE VendaContaAzul__c = '${vendaId}' 
                    AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
                `);

                const totalPagoVenda = paidRes.records[0].total || 0;
                
                // A receita que este serviço "recebeu" desta venda é proporcional ao seu vínculo
                totalEffectiveRevenue += (totalPagoVenda * percentualAlocacao);
            }

            console.log(`Receita Total Recebida (Efetiva): ${totalEffectiveRevenue.toFixed(2)}`);

            // 3. Atualizar a Receita Realizada no Objeto Serviço
            await conn.sobject('Servico__c').update({
                Id: serviceId,
                ReceitaRealizada__c: parseFloat(totalEffectiveRevenue.toFixed(2))
            });

            // 4. Buscar Lançamentos e Custo Total do Serviço para rateio
            const logs = await conn.query(`SELECT Id, ValorTotalLancamento__c FROM LancamentoHora__c WHERE Servico__c = '${serviceId}'`);
            const totalCost = logs.records.reduce((sum, log) => sum + (log.ValorTotalLancamento__c || 0), 0);

            if (totalEffectiveRevenue === 0 || totalCost === 0) {
                if (totalCost === 0 && totalEffectiveRevenue > 0) {
                    console.log(`Receita registrada no serviço, mas sem custos para ratear nos lançamentos.`);
                } else {
                    console.log(`Sem receita ou sem custos. Zerando campos de lançamentos.`);
                }
                
                if (logs.totalSize > 0) {
                    const updates = logs.records.map(l => ({ Id: l.Id, ValorReceita__c: 0 }));
                    await bulkUpdate(conn, 'LancamentoHora__c', updates);
                }
                continue;
            }

            // 5. Rateio Ponderado: Receita = ReceitaEfetiva * (CustoLancamento / CustoTotal)
            console.log(`Rateando entre ${logs.totalSize} lançamentos...`);
            const updates = logs.records.map(log => {
                const cost = log.ValorTotalLancamento__c || 0;
                const share = (totalEffectiveRevenue * cost) / totalCost;
                return {
                    Id: log.Id,
                    ValorReceita__c: parseFloat(share.toFixed(2))
                };
            });

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
