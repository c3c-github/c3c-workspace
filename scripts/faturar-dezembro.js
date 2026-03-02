require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    console.log("🚀 Faturando lançamentos de Dezembro 2025...");

    const q = `
        SELECT Id, Name, Status__c 
        FROM LancamentoHora__c 
        WHERE Periodo__r.Name LIKE 'Dezembro 2025%' 
        AND Status__c != 'Faturado'
    `;
    const res = await conn.query(q);

    if (res.totalSize === 0) {
        console.log("✅ Todos os lançamentos de Dezembro 2025 já estão faturados.");
        return;
    }

    const updates = res.records.map(r => ({
        Id: r.Id,
        Status__c: 'Faturado'
    }));

    try {
        const ret = await conn.sobject('LancamentoHora__c').update(updates);
        console.log(`✅ ${ret.filter(r => r.success).length} lançamentos atualizados para 'Faturado'.`);
    } catch (e) {
        console.error("Erro no update:", e.message);
    }
}

run();
