require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson
    const startDate = '2026-02-01';
    const originalEndDate = '2026-12-31';

    console.log(`🧹 Iniciando RESETE TOTAL de alocações para Jose Anderson (${targetId})...`);

    // 1. Busca TODAS as alocações existentes
    const qAll = `SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${targetId}'`;
    const resAll = await conn.query(qAll);
    
    if (resAll.totalSize > 0) {
        const idsToDelete = resAll.records.map(r => r.Id);
        await conn.sobject('Alocacao__c').destroy(idsToDelete);
        console.log(`🗑️  ${idsToDelete.length} alocações antigas removidas.`);
    }

    // 2. Busca IDs dos serviços alvo
    const targetServices = ['ADAMA | Suporte', 'Doremus | Suporte', 'C3C Software | Suporte'];
    const whereClause = targetServices.map(t => `Name = '${t}'`).join(' OR ');
    const qServ = `SELECT Id, Name FROM Servico__c WHERE ${whereClause}`;
    const resServ = await conn.query(qServ);

    console.log(`
📦 Criando novas alocações limpas:`);
    const newAllocs = resServ.records.map(s => {
        console.log(`   + ${s.Name}`);
        return {
            Pessoa__c: targetId,
            Servico__c: s.Id,
            DataInicio__c: startDate,
            DataFimOriginal__c: originalEndDate,
            Percentual__c: 0
        };
    });

    if (newAllocs.length > 0) {
        const ret = await conn.sobject('Alocacao__c').create(newAllocs);
        console.log(`✅ ${ret.filter(r => r.success).length} novas alocações criadas com sucesso.`);
    } else {
        console.error("❌ Erro: Serviços alvo não encontrados no Salesforce.");
    }
}

run();
