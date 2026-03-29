require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

/**
 * Script de Distribuição de Receita e Consolidação de Realizado (2025+)
 * Lógica:
 * 1. Buscar todas as receitas (parcelas pagas) desde 2025.
 * 2. Identificar os serviços vinculados a essas vendas.
 * 3. Buscar todos os lançamentos desses serviços (2025+).
 * 4. Calcular a Taxa Média de Venda (Receita / Total de Horas Ponderadas).
 * 5. Distribuir a receita nos lançamentos baseada nas horas.
 * 6. Sumarizar Custo e Receita no Serviço diretamente dos Lançamentos.
 */
async function distributeRevenue() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO RATEIO POR HORAS E CONSOLIDAÇÃO (2025+)...`);
    
    const START_DATE = '2025-01-01';
    
    try {
        const conn = await getSfConnection();

        // 1 & 2. Buscar serviços ativos e suas vendas vinculadas
        const serviceLinks = await conn.query("SELECT Servico__c FROM VendaServico__c WHERE Servico__r.Status__c = 'Ativo' GROUP BY Servico__c");
        const serviceIds = serviceLinks.records.map(r => r.Servico__c);

        if (serviceIds.length === 0) {
            console.log("Nenhum serviço ativo com vínculo de venda encontrado.");
            return;
        }

        console.log(`📊 Processando ${serviceIds.length} serviços...`);

        for (const serviceId of serviceIds) {
            console.log(`\n--- Serviço: ${serviceId} ---`);

            // Calcular Receita Recebida Efetiva
            const junctionRes = await conn.query(`
                SELECT Venda__c, Venda__r.ValorTotal__c, ValorAlocado__c 
                FROM VendaServico__c 
                WHERE Servico__c = '${serviceId}'
            `);

            let totalServiceRevenue = 0;
            for (const link of junctionRes.records) {
                const vendaId = link.Venda__c;
                const totalVenda = link.Venda__r.ValorTotal__c || 0;
                const valorAlocado = link.ValorAlocado__c || 0;
                if (totalVenda === 0) continue;

                const percentualAlocacao = valorAlocado / totalVenda;

                const paidRes = await conn.query(`
                    SELECT SUM(Valor__c) total 
                    FROM ParcelaFinanceira__c 
                    WHERE VendaContaAzul__c = '${vendaId}' 
                    AND Status__c IN ('Pago', 'Conciliado')
                    AND DataVencimento__c >= ${START_DATE}
                `);

                const totalPago = paidRes.records[0].total || 0;
                totalServiceRevenue += (totalPago * percentualAlocacao);
            }

            console.log(`   💰 Receita Total Recebida (2025+): R$ ${totalServiceRevenue.toFixed(2)}`);

            // Passo 3: Buscar todos os lançamentos do serviço (2025+)
            // Nota: Usando (Horas__c + 2*HorasExtras__c) como a lógica de horas-custo
            const logs = await conn.query(`
                SELECT Id, Horas__c, HorasExtras__c, ValorTotalLancamento__c 
                FROM LancamentoHora__c 
                WHERE Servico__c = '${serviceId}' 
                AND DiaPeriodo__r.Data__c >= ${START_DATE}
            `);
            
            const totalProjectHours = logs.records.reduce((sum, log) => sum + ((log.Horas__c || 0) + 2 * (log.HorasExtras__c || 0)), 0);

            // Passo 4 & 5: Distribuição Baseada em Horas
            if (totalProjectHours > 0 && totalServiceRevenue > 0) {
                const avgSaleRate = totalServiceRevenue / totalProjectHours;
                console.log(`   ⚖️ Taxa Média de Venda: R$ ${avgSaleRate.toFixed(2)}/h (Base: ${totalProjectHours.toFixed(1)}h)`);
                
                const updates = logs.records.map(log => {
                    const hoursWeight = (log.Horas__c || 0) + 2 * (log.HorasExtras__c || 0);
                    const logRevenue = avgSaleRate * hoursWeight;
                    return {
                        Id: log.Id,
                        ValorReceita__c: parseFloat(logRevenue.toFixed(2))
                    };
                });
                await bulkUpdate(conn, 'LancamentoHora__c', updates);
            } else if (logs.totalSize > 0) {
                const updates = logs.records.map(l => ({ Id: l.Id, ValorReceita__c: 0 }));
                await bulkUpdate(conn, 'LancamentoHora__c', updates);
            }

            // Passo 6: Sumarizar os valores no serviço (SUM DIRETO NOS LOGS)
            const summaryRes = await conn.query(`
                SELECT SUM(ValorTotalLancamento__c) cost, SUM(ValorReceita__c) rev 
                FROM LancamentoHora__c 
                WHERE Servico__c = '${serviceId}' 
                AND DiaPeriodo__r.Data__c >= ${START_DATE}
            `);

            const finalRev = summaryRes.records[0].rev || 0;
            const finalCost = summaryRes.records[0].cost || 0;
            const finalMargin = finalRev > 0 ? ((finalRev - finalCost) / finalRev) * 100 : (finalCost > 0 ? -100 : 0);

            await conn.sobject('Servico__c').update({
                Id: serviceId,
                ReceitaRealizada__c: parseFloat(finalRev.toFixed(2)),
                CustoRealizado__c: parseFloat(finalCost.toFixed(2)),
                MargemRealizada__c: parseFloat(finalMargin.toFixed(2))
            });
            
            console.log(`   ✅ Consolidado do Serviço: Rec R$ ${finalRev.toFixed(2)} | Custo R$ ${finalCost.toFixed(2)} | MG ${finalMargin.toFixed(1)}%`);
        }

        console.log(`\n🏁 RATEIO POR HORAS CONCLUÍDO!`);
    } catch (e) {
        console.error("❌ ERRO NO PROCESSO:", e.message);
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
