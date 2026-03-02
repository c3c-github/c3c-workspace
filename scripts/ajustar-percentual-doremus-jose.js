require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson

    console.log(`🔍 Ajustando percentual de Doremus para 100%...`);

    const query = `
        SELECT Id FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND Servico__r.Name = 'Doremus | Suporte'
        AND (DataFim__c = NULL OR DataFim__c >= TODAY)
        LIMIT 1
    `;

    const res = await conn.query(query);

    if (res.totalSize === 0) {
        console.error("❌ Alocação de Doremus não encontrada.");
        return;
    }

    try {
        await conn.sobject('Alocacao__c').update({
            Id: res.records[0].Id,
            Percentual__c: 100
        });
        console.log("✅ Doremus ajustado para 100%.");
    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

run();
