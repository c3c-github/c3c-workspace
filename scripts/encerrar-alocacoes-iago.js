require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEFsIAO'; // Iago
    const newEndDate = '2026-01-31';

    console.log(`🔍 Buscando alocações ativas para ${targetId}...`);

    const query = `
        SELECT Id, Name, DataFim__c 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND (DataFim__c = NULL OR DataFim__c > ${newEndDate})
    `;

    const result = await conn.query(query);

    if (result.totalSize === 0) {
        console.log("✅ Nenhuma alocação para encerrar.");
        return;
    }

    console.log(`⚠️  Encontradas ${result.totalSize} alocações para encerrar em ${newEndDate}:`);
    const updates = [];

    result.records.forEach(r => {
        console.log(`   - [${r.Id}] ${r.Name} (Fim atual: ${r.DataFim__c || 'Nulo'})`);
        updates.push({
            Id: r.Id,
            DataFim__c: newEndDate
        });
    });

    try {
        const ret = await conn.sobject('Alocacao__c').update(updates);
        const successCount = ret.filter(r => r.success).length;
        console.log(`
✅ Sucesso: ${successCount}/${updates.length} alocações atualizadas.`);
    } catch (e) {
        console.error("❌ Erro no update:", e.message);
    }
}

run();
