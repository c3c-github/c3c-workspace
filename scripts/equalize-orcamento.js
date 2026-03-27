require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

const holidays = [
    "2025-06-19", "2025-12-25", "2026-01-01", "2026-02-16", "2026-02-17",
    "2026-04-03", "2026-04-21", "2026-05-01", "2026-06-04", "2026-09-07",
    "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25"
];

function countBusinessDays(start, end) {
    let days = 0;
    let cur = new Date(start);
    const stop = new Date(end);
    while (cur <= stop) {
        const d = cur.getUTCDay();
        const dStr = cur.toISOString().split('T')[0];
        if (d !== 0 && d !== 6 && !holidays.includes(dStr)) days++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
}

async function equalize() {
    console.log("--- INICIANDO EQUALIZAÇÃO DE ORÇAMENTO COMPETÊNCIA ---");
    try {
        const conn = await getSfConnection();

        // 1. Buscar Alocações de Serviços Ativos
        console.log("Buscando alocações de serviços ativos...");
        const alocRes = await conn.query(`
            SELECT Id, Servico__c, DataInicio__c, DataFimOriginal__c, Percentual__c, TaxaVenda__c, CustoHr__c 
            FROM Alocacao__c 
            WHERE Servico__r.Status__c = 'Ativo'
        `);
        console.log(`Encontradas ${alocRes.totalSize} alocações.`);

        const orcRecords = [];

        for (const aloc of alocRes.records) {
            if (!aloc.DataInicio__c || !aloc.DataFimOriginal__c) continue;

            const start = new Date(aloc.DataInicio__c);
            const end = new Date(aloc.DataFimOriginal__c);
            
            let cur = new Date(start.getUTCFullYear(), start.getUTCMonth(), 1);
            const endLimit = new Date(end.getUTCFullYear(), end.getUTCMonth(), 1);

            while (cur <= endLimit) {
                const mStart = new Date(cur.getUTCFullYear(), cur.getUTCMonth(), 1);
                const mEnd = new Date(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0);

                const overlapStart = start > mStart ? start : mStart;
                const overlapEnd = end < mEnd ? end : mEnd;

                const days = countBusinessDays(overlapStart.toISOString().split('T')[0], overlapEnd.toISOString().split('T')[0]);
                
                if (days > 0) {
                    const hours = days * 8 * ((aloc.Percentual__c || 0) / 100);
                    orcRecords.push({
                        Alocacao__c: aloc.Id,
                        Servico__c: aloc.Servico__c,
                        Competencia__c: mStart.toISOString().split('T')[0],
                        ReceitaPrevista__c: hours * (aloc.TaxaVenda__c || 0),
                        CustoPrevisto__c: hours * (aloc.CustoHr__c || 0)
                    });
                }
                cur.setUTCMonth(cur.getUTCMonth() + 1);
            }
        }

        if (orcRecords.length === 0) {
            console.log("Nenhum registro de orçamento a criar.");
            return;
        }

        console.log(`Preparando para inserir ${orcRecords.length} registros de OrcamentoCompetencia__c...`);
        
        // Limpeza opcional: O usuário quer "equalizar", então vamos remover os que já existem para estas alocações para evitar duplicação?
        // Sim, é mais seguro deletar e recriar para garantir que o número bata com a alocação atual.
        console.log("Limpando orçamentos existentes para estas alocações (em lotes)...");
        const alocIds = [...new Set(alocRes.records.map(a => a.Id))];
        
        for (let i = 0; i < alocIds.length; i += 100) {
            const batchIds = alocIds.slice(i, i + 100);
            const idsStr = batchIds.map(id => `'${id}'`).join(',');
            const exOrcs = await conn.query(`SELECT Id FROM OrcamentoCompetencia__c WHERE Alocacao__c IN (${idsStr})`);
            if (exOrcs.totalSize > 0) {
                const idsToDelete = exOrcs.records.map(r => r.Id);
                // Sub-lote de exclusão para respeitar limite de 200
                for (let j = 0; j < idsToDelete.length; j += 200) {
                    const subBatch = idsToDelete.slice(j, j + 200);
                    await conn.sobject('OrcamentoCompetencia__c').destroy(subBatch);
                }
                console.log(`   - Deletados ${idsToDelete.length} registros existentes.`);
            }
        }

        // Inserção em lotes de 200
        console.log(`Inserindo ${orcRecords.length} novos registros...`);
        for (let i = 0; i < orcRecords.length; i += 200) {
            const batch = orcRecords.slice(i, i + 200);
            const results = await conn.sobject('OrcamentoCompetencia__c').create(batch);
            const successCount = results.filter(r => r.success).length;
            console.log(`Lote ${i/200 + 1}: ${successCount} registros criados.`);
        }

        console.log("\n🚀 EQUALIZAÇÃO CONCLUÍDA COM SUCESSO!");

    } catch (e) {
        console.error("ERRO NA EQUALIZAÇÃO:", e);
    }
}

equalize();