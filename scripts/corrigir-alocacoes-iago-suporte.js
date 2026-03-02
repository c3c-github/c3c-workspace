require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZEFsIAO';

    console.log("🔍 Buscando alocações de Serviços que NÃO são Suporte...");

    const query = `
        SELECT Id, Servico__r.Name, Servico__r.Tipo__c 
        FROM Alocacao__c 
        WHERE Pessoa__c = '${targetId}'
        AND DataInicio__c = 2026-02-01
        AND Servico__r.Tipo__c != 'Suporte'
    `;

    const res = await conn.query(query);

    if (res.totalSize === 0) {
        console.log("✅ Nenhuma alocação inválida encontrada.");
        return;
    }

    console.log(`⚠️  Encontradas ${res.totalSize} alocações para remover (Tipo != Suporte):`);
    const idsToDelete = res.records.map(r => {
        console.log(`   - [${r.Id}] ${r.Servico__r.Name} (${r.Servico__r.Tipo__c})`);
        return r.Id;
    });

    try {
        const ret = await conn.sobject('Alocacao__c').destroy(idsToDelete);
        const successCount = ret.filter(r => r.success).length;
        console.log(`
🗑️  ${successCount} alocações excluídas.`);
    } catch (e) {
        console.error("Erro ao excluir:", e.message);
    }
}

run();
