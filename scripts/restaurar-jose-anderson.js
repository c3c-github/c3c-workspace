require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson

    console.log(`🛠️  Restaurando alocações para Jose Anderson...`);

    const query = `
        SELECT Id, Servico__r.Name 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND DataFim__c = 2026-01-31
    `;

    const res = await conn.query(query);

    if (res.totalSize === 0) {
        console.log("✅ Nenhuma alocação para restaurar encontrada.");
        return;
    }

    const updates = res.records.map(r => ({
        Id: r.Id,
        DataFim__c: null
    }));

    try {
        const ret = await conn.sobject('Alocacao__c').update(updates);
        console.log(`✅ ${ret.filter(r => r.success).length} alocações restauradas (Data Fim removida).`);
    } catch (e) {
        console.error("❌ Erro ao restaurar:", e.message);
    }
}

run();
