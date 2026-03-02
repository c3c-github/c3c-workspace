require('dotenv').config();
const { getSfConnection } = require('../src/config/salesforce');

async function run() {
    const conn = await getSfConnection();
    const targetId = 'a14N5000009ZGPiIAO'; // Jose Anderson

    console.log(`🚀 RESETE TOTAL: José Anderson (${targetId})`);

    // 1. Busca TODAS as alocações
    const res = await conn.query(`SELECT Id FROM Alocacao__c WHERE Pessoa__c = '${targetId}'`);
    if (res.totalSize > 0) {
        const ids = res.records.map(r => r.Id);
        await conn.sobject('Alocacao__c').destroy(ids);
        console.log(`✅ ${ids.length} alocações antigas/erradas deletadas.`);
    }

    // 2. Busca IDs dos serviços permitidos
    const services = ['ADAMA | Suporte', 'Doremus | Suporte', 'C3C Software | Suporte'];
    const qServ = `SELECT Id, Name FROM Servico__c WHERE Name IN ('${services.join("','")}')`;
    const resServ = await conn.query(qServ);

    const newAllocs = resServ.records.map(s => ({
        Pessoa__c: targetId,
        Servico__c: s.Id,
        DataInicio__c: '2026-02-01',
        DataFimOriginal__c: '2026-12-31',
        Percentual__c: 0
    }));

    if (newAllocs.length > 0) {
        await conn.sobject('Alocacao__c').create(newAllocs);
        console.log(`✅ 3 novas alocações criadas (ADAMA, Doremus, C3C).`);
    }
}

run();
