require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("🧹 Iniciando limpeza de vínculos de benefícios em períodos antigos...");

    try {
        // 1. Busca vínculos de benefícios 'Caju' em períodos que NÃO são Fevereiro 2026 em diante
        // Filtro: Nome do benefício contém 'Caju' E (Nome do período NÃO contém '2026' OU contém 'Janeiro 2026')
        // Vamos ser mais precisos: Manter apenas os que contém 'Fevereiro 2026'
        const q = `
            SELECT Id, BeneficioPessoa__r.Name, Periodo__r.Name 
            FROM BeneficioPeriodo__c 
            WHERE BeneficioPessoa__r.Name LIKE 'Caju %'
            AND (NOT Periodo__r.Name LIKE 'Fevereiro 2026%')
        `;
        
        const res = await conn.query(q);
        
        if (res.totalSize === 0) {
            console.log("✅ Nenhum vínculo indevido encontrado.");
            return;
        }

        console.log(`⚠️  Encontrados ${res.totalSize} vínculos para remover.`);
        const idsToDelete = res.records.map(r => r.Id);

        // 2. Exclui em lotes
        const batchSize = 200;
        let deletedCount = 0;
        for (let i = 0; i < idsToDelete.length; i += batchSize) {
            const batch = idsToDelete.slice(i, i + batchSize);
            const ret = await conn.sobject('BeneficioPeriodo__c').destroy(batch);
            deletedCount += ret.filter(r => r.success).length;
            console.log(`🗑️  Lote: ${deletedCount}/${idsToDelete.length} removidos.`);
        }

        console.log("\n✅ Limpeza concluída!");

    } catch (e) {
        console.error("❌ Erro fatal:", e.message);
    }
}

run();
