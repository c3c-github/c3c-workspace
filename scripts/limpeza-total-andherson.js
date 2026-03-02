require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZDEwIAO'; // Andherson
    const limitDate = '2026-01-31';

    console.log(`🧹 Iniciando limpeza profunda de alocações antigas para Andherson...`);

    // Busca alocações que começaram antes de fevereiro e ainda estão "abertas"
    const query = `
        SELECT Id, Name, Servico__r.Name, DataInicio__c, DataFim__c 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}' 
        AND DataInicio__c < 2026-02-01
        AND (DataFim__c = NULL OR DataFim__c > ${limitDate})
    `;

    const result = await conn.query(query);

    if (result.totalSize === 0) {
        console.log("✅ Nenhuma alocação antiga encontrada para encerrar.");
        return;
    }

    console.log(`⚠️  Encontradas ${result.totalSize} alocações antigas para encerrar:`);
    const updates = result.records.map(r => {
        console.log(`   - [${r.Id}] ${r.Servico__r ? r.Servico__r.Name : r.Name} (Início: ${r.DataInicio__c})`);
        return { Id: r.Id, DataFim__c: limitDate };
    });

    try {
        const ret = await conn.sobject('Alocacao__c').update(updates);
        console.log(`✅ ${ret.filter(r => r.success).length} alocações antigas encerradas com sucesso.`);
    } catch (e) {
        console.error("❌ Erro:", e.message);
    }
}

run();
