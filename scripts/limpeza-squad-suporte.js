require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const leaderId = 'a14N5000009ZDEwIAO'; // Andherson
    const memberId = 'a14N5000009ZGPiIAO'; // Jose Anderson
    const limitDate = '2026-01-31';

    console.log("🧹 Iniciando faxina nas alocações...");

    // --- PARTE 1: Jose Anderson (Encerrar Doremus etc) ---
    const qMember = `SELECT Id, Servico__r.Name FROM Alocacao__c WHERE Pessoa__c = '${memberId}' AND DataInicio__c < 2026-02-01 AND (DataFim__c = NULL OR DataFim__c > ${limitDate})`;
    const resMember = await conn.query(qMember);
    if(resMember.totalSize > 0) {
        const upds = resMember.records.map(r => ({ Id: r.Id, DataFim__c: limitDate }));
        await conn.sobject('Alocacao__c').update(upds);
        console.log(`✅ ${upds.length} alocações antigas de Jose Anderson encerradas.`);
    }

    // --- PARTE 2: Andherson Grangeiro (Remover duplicatas) ---
    // Busca todas as alocações recentes dele
    const qLeader = `SELECT Id, Servico__c FROM Alocacao__c WHERE Pessoa__c = '${leaderId}' AND DataInicio__c = 2026-02-01`;
    const resLeader = await conn.query(qLeader);
    
    if(resLeader.totalSize > 0) {
        // Lógica para manter apenas UMA por serviço
        const seen = new Set();
        const toDelete = [];
        resLeader.records.forEach(r => {
            if (seen.has(r.Servico__c)) { toDelete.push(r.Id); }
            else { seen.add(r.Servico__c); }
        });

        if(toDelete.length > 0) {
            await conn.sobject('Alocacao__c').destroy(toDelete);
            console.log(`🗑️  ${toDelete.length} duplicidades de Andherson Grangeiro removidas.`);
        }
    }
}

run();
