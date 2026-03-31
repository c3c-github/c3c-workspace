require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function distributeRevenue() {
    console.log(`[${new Date().toISOString()}] 🚀 INICIANDO MOTOR DE RATEIO PONDERADO POR VENDA...`);
    try {
        const conn = await getSfConnection();
        console.log("✅ Conectado ao Salesforce.");

        // --- STEP 0: LIMPEZA TOTAL (2025+) ---
        console.log("🧹 Buscando lançamentos de 2025 com receita para zerar...");
        const logsToResetRes = await conn.query("SELECT Id FROM LancamentoHora__c WHERE ValorReceita__c != 0 AND DiaPeriodo__r.Data__c >= 2025-01-01").execute({ autoFetch: true, maxFetch: 100000 });
        const logsToReset = Array.isArray(logsToResetRes) ? logsToResetRes : (logsToResetRes.records || []);

        if (logsToReset.length > 0) {
            console.log(`   Removendo cálculos anteriores de ${logsToReset.length} lançamentos...`);
            const resetData = logsToReset.map(r => ({ Id: r.Id, ValorReceita__c: 0 }));
            await bulkUpdate(conn, 'LancamentoHora__c', resetData);
        } else {
            console.log("   ✅ Nada para zerar.");
        }

        // --- STEP 1: BUSCAR VENDAS DISTINTAS ASSOCIADAS A SERVIÇOS ---
        const junctionResRaw = await conn.query("SELECT Venda__c, Servico__c FROM VendaServico__c WHERE Venda__c != null").execute({ autoFetch: true });
        const junctionRes = Array.isArray(junctionResRaw) ? junctionResRaw : (junctionResRaw.records || []);
        
        const saleToServices = new Map();
        const allTargetServices = new Set();
        const uniqueSaleIds = new Set();

        junctionRes.forEach(r => {
            if (!saleToServices.has(r.Venda__c)) saleToServices.set(r.Venda__c, []);
            saleToServices.get(r.Venda__c).push(r.Servico__c);
            allTargetServices.add(r.Servico__c);
            uniqueSaleIds.add(r.Venda__c);
        });
        console.log(`📊 Vendas vinculadas: ${uniqueSaleIds.size} | Serviços envolvidos: ${allTargetServices.size}`);

        // --- STEP 2: CONSOLIDAR RECEITA POR VENDA (2025+) ---
        const saleIdsArr = Array.from(uniqueSaleIds);
        const saleRevenueMap = new Map();
        
        // Chunking para buscar parcelas de muitas vendas
        for (let i = 0; i < saleIdsArr.length; i += 200) {
            const chunk = saleIdsArr.slice(i, i + 200);
            const paidResRaw = await conn.query(`
                SELECT VendaContaAzul__c, SUM(Valor__c) total 
                FROM ParcelaFinanceira__c 
                WHERE VendaContaAzul__c IN ('${chunk.join("','")}')
                AND Status__c IN ('Pago', 'Liquidado', 'QUITADO', 'PAGO')
                AND DataVencimento__c >= 2025-01-01
                GROUP BY VendaContaAzul__c
            `).execute();
            const paidRes = Array.isArray(paidResRaw) ? paidResRaw : (paidResRaw.records || []);
            paidRes.forEach(r => saleRevenueMap.set(r.VendaContaAzul__c, r.total));
        }
        console.log(`💰 Receita consolidada para ${saleRevenueMap.size} vendas.`);

        // --- STEP 3: BUSCAR E CONSOLIDAR LANÇAMENTOS POR SERVIÇO ---
        const serviceIdsArr = Array.from(allTargetServices);
        const logsByService = new Map();
        console.log(`🔍 Buscando lançamentos para ${serviceIdsArr.length} serviços...`);
        
        const allLogsResRaw = await conn.query(`SELECT Id, HorasCusto__c, Servico__c FROM LancamentoHora__c WHERE Servico__c IN ('${serviceIdsArr.join("','")}') AND DiaPeriodo__r.Data__c >= 2025-01-01`).execute({ autoFetch: true, maxFetch: 100000 });
        const allLogs = Array.isArray(allLogsResRaw) ? allLogsResRaw : (allLogsResRaw.records || []);
        
        allLogs.forEach(l => {
            if (!logsByService.has(l.Servico__c)) logsByService.set(l.Servico__c, []);
            logsByService.get(l.Servico__c).push(l);
        });
        console.log(`   ✅ ${allLogs.length} lançamentos carregados.`);

        // --- STEP 4: RATEIO POR TAXA MÉDIA DE VENDA ---
        const finalRevenueUpdates = new Map(); // LogId -> Valor acumulado
        const serviceVirtualRevenue = new Map(); // ServicoId -> Valor (quando não há logs)
        console.log(`🧮 Calculando rateio para ${saleRevenueMap.size} vendas...`);

        for (const [vendaId, totalRevenue] of saleRevenueMap.entries()) {
            const linkedServices = saleToServices.get(vendaId) || [];
            const poolLogs = [];
            let totalSaleHours = 0;

            // Agrupar todos os logs de todos os serviços vinculados a esta venda
            linkedServices.forEach(sId => {
                const logs = logsByService.get(sId) || [];
                logs.forEach(l => {
                    poolLogs.push(l);
                    totalSaleHours += (l.HorasCusto__c || 0);
                });
            });

            if (totalRevenue > 0) {
                if (totalSaleHours > 0) {
                    // Cálculo da Taxa Média da Venda (Recebido / Total de Horas do Pool)
                    const avgRate = totalRevenue / totalSaleHours;
                    
                    poolLogs.forEach(log => {
                        const hours = log.HorasCusto__c || 0;
                        const share = avgRate * hours;
                        const current = finalRevenueUpdates.get(log.Id) || 0;
                        finalRevenueUpdates.set(log.Id, current + share);
                    });
                } else {
                    // Se não há logs em nenhum serviço vinculado, a receita vai para o virtual
                    const sharePerService = totalRevenue / linkedServices.length;
                    linkedServices.forEach(sId => {
                        const current = serviceVirtualRevenue.get(sId) || 0;
                        serviceVirtualRevenue.set(sId, current + sharePerService);
                    });
                }
            }
        }

        // --- STEP 5: ATUALIZAÇÃO BULK ---
        const updatesArr = Array.from(finalRevenueUpdates.entries()).map(([id, val]) => ({
            Id: id,
            ValorReceita__c: parseFloat(val.toFixed(2))
        }));

        if (updatesArr.length > 0) {
            console.log(`📤 Enviando rateio para ${updatesArr.length} lançamentos...`);
            await bulkUpdate(conn, 'LancamentoHora__c', updatesArr);
        }

        // --- STEP 6: SINCRONIZAR TOTAIS NOS SERVIÇOS ---
        console.log("📊 Sincronizando totais nos registros de Serviço...");
        const serviceTotalsMap = new Map();
        
        // 6.1. Somar receita dos logs
        const logRevenueResRaw = await conn.query(`SELECT Servico__c, SUM(ValorReceita__c) total FROM LancamentoHora__c WHERE DiaPeriodo__r.Data__c >= 2025-01-01 AND Servico__c IN ('${serviceIdsArr.join("','")}') GROUP BY Servico__c`).execute({ autoFetch: true });
        const logRevenueRes = Array.isArray(logRevenueResRaw) ? logRevenueResRaw : (logRevenueResRaw.records || []);
        logRevenueRes.forEach(r => {
            serviceTotalsMap.set(r.Servico__c, (r.total || 0));
        });

        // 6.2. Somar receita virtual (sem logs)
        for (const [sId, virtualVal] of serviceVirtualRevenue.entries()) {
            const current = serviceTotalsMap.get(sId) || 0;
            serviceTotalsMap.set(sId, current + virtualVal);
        }

        const serviceUpdates = Array.from(serviceTotalsMap.entries()).map(([id, val]) => ({
            Id: id,
            ReceitaRealizada__c: parseFloat(val.toFixed(2))
        }));
        
        if (serviceUpdates.length > 0) {
            console.log(`📤 Atualizando ${serviceUpdates.length} serviços com totais (incluindo virtual)...`);
            await bulkUpdate(conn, 'Servico__c', serviceUpdates);
        }

        console.log(`\n🏁 RATEIO DEFINITIVO CONCLUÍDO!`);
    } catch (e) {
        console.error("❌ ERRO NO RATEIO:", e.message);
        process.exit(1);
    }
}

async function bulkUpdate(conn, object, data) {
    const CHUNK = 200;
    console.log(`📤 Iniciando atualização bulk de ${data.length} registros em ${object}...`);
    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, i + CHUNK);
        await conn.sobject(object).update(chunk);
        if (i % 1000 === 0 && i > 0) console.log(`   ✅ Processados ${i}/${data.length}...`);
    }
    console.log(`   ✨ Concluído: ${data.length} registros atualizados.`);
}

distributeRevenue();
