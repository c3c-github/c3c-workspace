require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGSvIAO'; // Ribamar
    
    console.log(`🔍 Buscando alocações de Carapreta, Coty e Audi para o Ribamar...`);

    const query = `
        SELECT Id, Servico__r.Name 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND DataInicio__c = 2026-02-01
        AND (Servico__r.Name LIKE '%Carapreta%' OR Servico__r.Name LIKE '%Coty%' OR Servico__r.Name LIKE '%Audi%')
    `;

    const res = await conn.query(query);

    if (res.totalSize === 0) {
        console.log("Nenhuma alocação encontrada para os critérios.");
        return;
    }

    const updates = res.records.map(r => ({
        Id: r.Id,
        Percentual__c: 33.33
    }));

    console.log(`Updating ${updates.length} records...`);
    
    try {
        const ret = await conn.sobject('Alocacao__c').update(updates);
        const successCount = ret.filter(r => r.success).length;
        console.log(`✅ ${successCount} alocações atualizadas com 33.33%.`);
    } catch (e) {
        console.error("Erro no update:", e.message);
    }
}

run();
